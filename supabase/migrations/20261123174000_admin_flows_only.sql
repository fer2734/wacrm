-- Restrict all flow management to administrators and owners, including direct RPC calls.
BEGIN;
DROP POLICY IF EXISTS flows_insert ON public.flows;
CREATE POLICY flows_insert ON public.flows FOR INSERT TO authenticated
 WITH CHECK (public.is_account_member(account_id,'admin'::public.account_role_enum));
DROP POLICY IF EXISTS flows_update ON public.flows;
CREATE POLICY flows_update ON public.flows FOR UPDATE TO authenticated
 USING (public.is_account_member(account_id,'admin'::public.account_role_enum))
 WITH CHECK (public.is_account_member(account_id,'admin'::public.account_role_enum));
DROP POLICY IF EXISTS flows_delete ON public.flows;
CREATE POLICY flows_delete ON public.flows FOR DELETE TO authenticated
 USING (public.is_account_member(account_id,'admin'::public.account_role_enum));
DROP POLICY IF EXISTS flow_nodes_modify ON public.flow_nodes;
CREATE POLICY flow_nodes_modify ON public.flow_nodes FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.flows f WHERE f.id=flow_id AND public.is_account_member(f.account_id,'admin'::public.account_role_enum)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.flows f WHERE f.id=flow_id AND public.is_account_member(f.account_id,'admin'::public.account_role_enum)));
CREATE OR REPLACE FUNCTION public.replace_flow_nodes(p_flow_id uuid,p_nodes jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_account_id uuid;v_cancelled integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';END IF;
 IF p_nodes IS NULL OR jsonb_typeof(p_nodes)<>'array' THEN RAISE EXCEPTION 'Nodes must be JSON array' USING ERRCODE='22023';END IF;
 SELECT account_id INTO v_account_id FROM public.flows WHERE id=p_flow_id FOR UPDATE;
 IF v_account_id IS NULL OR NOT public.is_account_member(v_account_id,'admin'::public.account_role_enum) THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501';END IF;
 DELETE FROM public.flow_nodes WHERE flow_id=p_flow_id;
 INSERT INTO public.flow_nodes(flow_id,node_key,node_type,config,position_x,position_y)
 SELECT p_flow_id,n->>'node_key',n->>'node_type',COALESCE(n->'config','{}'::jsonb),
 COALESCE((n->>'position_x')::integer,0),COALESCE((n->>'position_y')::integer,0)
 FROM jsonb_array_elements(p_nodes) n;
 UPDATE public.flow_runs r SET status='cancelled',ended_at=NOW(),end_reason='current_node_removed'
 WHERE r.flow_id=p_flow_id AND r.status='active'
 AND NOT EXISTS(SELECT 1 FROM public.flow_nodes fn WHERE fn.flow_id=p_flow_id AND fn.node_key=r.current_node_key);
 GET DIAGNOSTICS v_cancelled=ROW_COUNT;
 RETURN v_cancelled;
END $$;
CREATE OR REPLACE FUNCTION public.replace_flow_graph(p_flow_id uuid,p_nodes jsonb,p_flow jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_account uuid;v_cancelled integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';END IF;
 SELECT account_id INTO v_account FROM public.flows WHERE id=p_flow_id;
 IF v_account IS NULL OR NOT public.is_account_member(v_account,'admin'::public.account_role_enum) THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501';END IF;
 IF p_flow IS NULL OR jsonb_typeof(p_flow)<>'object' THEN RAISE EXCEPTION 'Flow must be JSON object' USING ERRCODE='22023';END IF;
 v_cancelled:=public.replace_flow_nodes(p_flow_id,p_nodes);
 UPDATE public.flows SET
 name=CASE WHEN p_flow?'name' THEN p_flow->>'name' ELSE name END,
 description=CASE WHEN p_flow?'description' THEN p_flow->>'description' ELSE description END,
 trigger_type=CASE WHEN p_flow?'trigger_type' THEN p_flow->>'trigger_type' ELSE trigger_type END,
 trigger_config=CASE WHEN p_flow?'trigger_config' THEN p_flow->'trigger_config' ELSE trigger_config END,
 entry_node_id=CASE WHEN p_flow?'entry_node_id' THEN p_flow->>'entry_node_id' ELSE entry_node_id END,
 fallback_policy=CASE WHEN p_flow?'fallback_policy' THEN p_flow->'fallback_policy' ELSE fallback_policy END,
 updated_at=NOW() WHERE id=p_flow_id;
 RETURN v_cancelled;
END $$;
COMMIT;
