-- Conversations store auth user IDs; deals reference profiles.id.
DROP POLICY deals_assigned_agent_scope ON public.deals;
CREATE POLICY deals_assigned_agent_scope ON public.deals AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_account_member(account_id) AND (
    NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.account_role = 'agent')
    OR (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.id = deals.conversation_id AND c.account_id = deals.account_id
        AND c.assigned_agent_id = auth.uid()))
    OR (conversation_id IS NULL AND assigned_to = (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()) AND EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.id = deals.contact_id AND c.account_id = deals.account_id))
  ))
  WITH CHECK (public.is_account_member(account_id) AND (
    NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.account_role = 'agent')
    OR (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.id = deals.conversation_id AND c.account_id = deals.account_id
        AND c.assigned_agent_id = auth.uid()))
    OR (conversation_id IS NULL AND assigned_to = (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()) AND EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.id = deals.contact_id AND c.account_id = deals.account_id))
  ));

CREATE OR REPLACE FUNCTION public.validate_sales_deal() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
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
    SELECT p.id INTO v_assignee FROM public.conversations c
      LEFT JOIN public.profiles p ON p.user_id = c.assigned_agent_id AND p.account_id = c.account_id
      WHERE c.id = NEW.conversation_id
      AND c.account_id = NEW.account_id AND c.contact_id = NEW.contact_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is not accessible' USING ERRCODE = '42501'; END IF;
    NEW.assigned_to := v_assignee;
  ELSIF NEW.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.assigned_to AND p.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Advisor does not belong to this account' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN NEW.status := v_status; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_sales_deal() FROM PUBLIC;


-- Trigger-only privilege: incoming webhooks and assignment changes must keep
-- opportunities in sync even when the former advisor cannot see them anymore.
CREATE OR REPLACE FUNCTION public.sync_conversation_sales_deal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE v_pipeline uuid; v_stage uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.id, s.id INTO v_pipeline, v_stage FROM public.pipelines p
      JOIN public.pipeline_stages s ON s.pipeline_id = p.id
      WHERE p.account_id = NEW.account_id ORDER BY p.created_at, p.id, s.position, s.id LIMIT 1;
    IF v_stage IS NOT NULL THEN
      INSERT INTO public.deals(user_id,account_id,pipeline_id,stage_id,contact_id,conversation_id,assigned_to,title,currency)
        SELECT NEW.user_id,NEW.account_id,v_pipeline,v_stage,NEW.contact_id,NEW.id,(SELECT p.id FROM public.profiles p WHERE p.user_id = NEW.assigned_agent_id AND p.account_id = NEW.account_id),
          COALESCE(NULLIF(c.name,''),NULLIF(c.phone,''),'Consulta de WhatsApp'),'ARS'
        FROM public.contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
        ON CONFLICT (conversation_id,pipeline_id) WHERE conversation_id IS NOT NULL DO NOTHING;
    END IF;
  ELSE
    UPDATE public.deals SET assigned_to = (SELECT p.id FROM public.profiles p WHERE p.user_id = NEW.assigned_agent_id AND p.account_id = NEW.account_id)
      WHERE conversation_id = NEW.id AND account_id = NEW.account_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_conversation_sales_deal() FROM PUBLIC;


