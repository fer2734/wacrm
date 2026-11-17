-- A sales opportunity follows its conversation and its current advisor.
ALTER TABLE public.pipeline_stages ADD COLUMN deal_status text NOT NULL DEFAULT 'open'
  CHECK (deal_status IN ('open', 'won', 'lost'));
-- Only stage changes are exposed to authenticated clients; existing RLS still applies.
GRANT UPDATE (stage_id) ON public.deals TO authenticated;

-- One stage per conversation in each pipeline, including concurrent changes.
CREATE UNIQUE INDEX deals_conversation_pipeline_unique ON public.deals(conversation_id, pipeline_id)
  WHERE conversation_id IS NOT NULL;

DROP POLICY deals_assigned_agent_scope ON public.deals;
CREATE POLICY deals_assigned_agent_scope ON public.deals AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_account_member(account_id) AND (
    NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.account_role = 'agent')
    OR (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.id = deals.conversation_id AND c.account_id = deals.account_id
        AND c.assigned_agent_id = auth.uid()))
    OR (conversation_id IS NULL AND assigned_to = auth.uid() AND EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.id = deals.contact_id AND c.account_id = deals.account_id))
  ))
  WITH CHECK (public.is_account_member(account_id) AND (
    NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.account_role = 'agent')
    OR (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.id = deals.conversation_id AND c.account_id = deals.account_id
        AND c.assigned_agent_id = auth.uid()))
    OR (conversation_id IS NULL AND assigned_to = auth.uid() AND EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.id = deals.contact_id AND c.account_id = deals.account_id))
  ));

CREATE FUNCTION public.validate_sales_deal() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = public AS $$
DECLARE v_status text; v_assignee uuid;
BEGIN
  SELECT s.deal_status INTO v_status FROM public.pipeline_stages s
    JOIN public.pipelines p ON p.id = s.pipeline_id
    WHERE s.id = NEW.stage_id AND p.id = NEW.pipeline_id AND p.account_id = NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage does not belong to this account and pipeline' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND current_user = 'authenticated' AND EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_role = 'agent'
  ) AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    RAISE EXCEPTION 'Only administrators can change opportunity ownership' USING ERRCODE = '42501';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Contact does not belong to this account' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL THEN
    SELECT assigned_agent_id INTO v_assignee FROM public.conversations c WHERE c.id = NEW.conversation_id
      AND c.account_id = NEW.account_id AND c.contact_id = NEW.contact_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is not accessible' USING ERRCODE = '42501'; END IF;
    NEW.assigned_to := v_assignee;
  ELSIF NEW.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.assigned_to AND p.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Advisor does not belong to this account' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN NEW.status := v_status; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_sales_deal() FROM PUBLIC;
CREATE TRIGGER a_validate_sales_deal BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.validate_sales_deal();

-- Trigger-only privilege: incoming webhooks and assignment changes must keep
-- opportunities in sync even when the former advisor cannot see them anymore.
CREATE FUNCTION public.sync_conversation_sales_deal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE v_pipeline uuid; v_stage uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.id, s.id INTO v_pipeline, v_stage FROM public.pipelines p
      JOIN public.pipeline_stages s ON s.pipeline_id = p.id
      WHERE p.account_id = NEW.account_id ORDER BY p.created_at, p.id, s.position, s.id LIMIT 1;
    IF v_stage IS NOT NULL THEN
      INSERT INTO public.deals(user_id,account_id,pipeline_id,stage_id,contact_id,conversation_id,assigned_to,title,currency)
        SELECT NEW.user_id,NEW.account_id,v_pipeline,v_stage,NEW.contact_id,NEW.id,NEW.assigned_agent_id,
          COALESCE(NULLIF(c.name,''),NULLIF(c.phone,''),'Consulta de WhatsApp'),'ARS'
        FROM public.contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
        ON CONFLICT (conversation_id,pipeline_id) WHERE conversation_id IS NOT NULL DO NOTHING;
    END IF;
  ELSE
    UPDATE public.deals SET assigned_to = NEW.assigned_agent_id
      WHERE conversation_id = NEW.id AND account_id = NEW.account_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_conversation_sales_deal() FROM PUBLIC;
CREATE TRIGGER sync_conversation_sales_deal AFTER INSERT OR UPDATE OF assigned_agent_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_sales_deal();

CREATE FUNCTION public.set_conversation_stage(p_conversation_id uuid, p_stage_id uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_conversation public.conversations%ROWTYPE; v_pipeline uuid; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_conversation FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_conversation.account_id,'agent') THEN
    RAISE EXCEPTION 'Conversation is not accessible' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_pipeline FROM public.pipeline_stages s JOIN public.pipelines p ON p.id = s.pipeline_id
    WHERE s.id = p_stage_id AND p.account_id = v_conversation.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage is not accessible' USING ERRCODE = '42501'; END IF;
  UPDATE public.deals SET stage_id = p_stage_id
    WHERE conversation_id = v_conversation.id AND pipeline_id = v_pipeline
      AND account_id = v_conversation.account_id
    RETURNING id INTO v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No opportunity in this pipeline' USING ERRCODE = 'P0002'; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.set_conversation_stage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_conversation_stage(uuid,uuid) TO authenticated;

-- Seed Valle's first sales pipeline without changing any existing pipeline.
DO $$
DECLARE v_pipeline uuid;
BEGIN
  IF EXISTS(SELECT 1 FROM public.accounts WHERE id = 'b16cd4cb-2330-444a-a97e-c4e11c2b104b')
    AND NOT EXISTS(SELECT 1 FROM public.pipelines WHERE account_id = 'b16cd4cb-2330-444a-a97e-c4e11c2b104b') THEN
    INSERT INTO public.pipelines(user_id,account_id,name)
      VALUES ('f8a2cc7d-b65a-4b80-bbee-0b39d82ce936','b16cd4cb-2330-444a-a97e-c4e11c2b104b','Embudo de ventas') RETURNING id INTO v_pipeline;
    INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,deal_status) VALUES
      (v_pipeline,'Nuevo lead','#3b82f6',0,'open'),
      (v_pipeline,'Aún no responde','#eab308',1,'open'),
      (v_pipeline,'Contactado','#06b6d4',2,'open'),
      (v_pipeline,'Interesado / Potable','#8b5cf6',3,'open'),
      (v_pipeline,'Propuesta enviada','#f97316',4,'open'),
      (v_pipeline,'En seguimiento','#6366f1',5,'open'),
      (v_pipeline,'Quiere venta directa','#0d9488',6,'open'),
      (v_pipeline,'Venta concretada','#16a34a',7,'won'),
      (v_pipeline,'No le interesa','#dc2626',8,'lost');
    INSERT INTO public.deals(user_id,account_id,pipeline_id,stage_id,contact_id,conversation_id,assigned_to,title,currency)
      SELECT c.user_id,c.account_id,v_pipeline,s.id,c.contact_id,c.id,c.assigned_agent_id,
        COALESCE(NULLIF(ct.name,''),NULLIF(ct.phone,''),'Consulta de WhatsApp'),'ARS'
      FROM public.conversations c JOIN public.contacts ct ON ct.id = c.contact_id
      JOIN public.pipeline_stages s ON s.pipeline_id = v_pipeline AND s.position = 0
      WHERE c.account_id = 'b16cd4cb-2330-444a-a97e-c4e11c2b104b'
      ON CONFLICT (conversation_id,pipeline_id) WHERE conversation_id IS NOT NULL DO NOTHING;
  END IF;
END $$;
