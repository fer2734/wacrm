-- Preserve company records before removing a member's authentication identity.
CREATE TABLE public.member_deletion_jobs (
 user_id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 last_error text
);
ALTER TABLE public.member_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_deletion_jobs FROM anon, authenticated;
GRANT SELECT,UPDATE ON public.member_deletion_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_caller_account_id uuid; v_caller_role public.account_role_enum;
 v_target_account_id uuid; v_target_role public.account_role_enum;
 v_owner uuid; v_name text; v_table text; v_other boolean; v_chats uuid[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM profiles WHERE user_id IN(auth.uid(),p_user_id) ORDER BY user_id FOR UPDATE;
 SELECT account_id,account_role INTO v_caller_account_id,v_caller_role FROM profiles WHERE user_id=auth.uid();
 IF v_caller_account_id IS NULL OR v_caller_role NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE='42501';
 END IF;
 IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'Cannot remove yourself' USING ERRCODE='22023'; END IF;
 SELECT account_id,account_role,full_name INTO v_target_account_id,v_target_role,v_name FROM profiles WHERE user_id=p_user_id;
 IF v_target_account_id IS NULL OR v_target_account_id<>v_caller_account_id THEN
  RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE='42501';
 END IF;
 IF v_target_role='owner' OR EXISTS(SELECT 1 FROM accounts WHERE owner_user_id=p_user_id) THEN
  RAISE EXCEPTION 'Cannot delete an account owner; transfer ownership first' USING ERRCODE='22023';
 END IF;
 SELECT a.owner_user_id INTO v_owner FROM accounts a JOIN profiles p ON p.user_id=a.owner_user_id
  AND p.account_id=a.id WHERE a.id=v_target_account_id FOR UPDATE OF a;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Account owner unavailable' USING ERRCODE='22023'; END IF;

 -- Lock the account to serialize this operation with the sales rotation.
 PERFORM 1 FROM conversations WHERE account_id=v_target_account_id AND assigned_agent_id=p_user_id FOR UPDATE;
 SELECT array_agg(id) INTO v_chats FROM conversations WHERE account_id=v_target_account_id AND assigned_agent_id=p_user_id;
 UPDATE conversations SET assigned_agent_id = NULL
 WHERE account_id = v_target_account_id AND assigned_agent_id = p_user_id;
 -- The second update also covers closed conversations; the administrator
 -- explicitly decides their next advisor instead of restarting the bot.
 UPDATE conversations SET status='pending',ai_autoreply_disabled=true
 WHERE account_id=v_target_account_id AND id=ANY(v_chats);
 UPDATE flow_runs SET status='handed_off',ended_at=now(),end_reason='advisor_removed'
 WHERE account_id=v_target_account_id AND conversation_id=ANY(v_chats) AND status='active';

 -- Move every company-owned row that would otherwise cascade on auth deletion.
 FOREACH v_table IN ARRAY ARRAY['contacts','contact_notes','conversations','tags','custom_fields',
  'message_templates','pipelines','deals','broadcasts','automations','automation_logs',
  'automation_pending_executions','flows','flow_runs','quick_replies','advisor_tasks'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE user_id=$1 AND account_id IS DISTINCT FROM $2)',v_table)
   INTO v_other USING p_user_id,v_target_account_id;
  IF v_other THEN RAISE EXCEPTION 'Member has records in another account; review before deleting' USING ERRCODE='22023'; END IF;
 END LOOP;
 UPDATE advisor_tasks SET notes=concat_ws(E'\n', 'Actividad transferida por baja del asesor: '||v_name,notes),
  alarm_fired_for=CASE WHEN completed THEN alarm_fired_for ELSE NULL END
 WHERE user_id=p_user_id AND account_id=v_target_account_id;
 UPDATE contact_notes SET note_text='Nota de '||v_name||E' (usuario dado de baja):\n'||note_text
 WHERE user_id=p_user_id AND account_id=v_target_account_id;
 FOREACH v_table IN ARRAY ARRAY['contacts','contact_notes','conversations','tags','custom_fields',
  'message_templates','pipelines','deals','broadcasts','automations','automation_logs',
  'automation_pending_executions','flows','flow_runs','quick_replies','advisor_tasks'] LOOP
  EXECUTE format('UPDATE public.%I SET user_id=$1 WHERE user_id=$2 AND account_id=$3',v_table)
   USING v_owner,p_user_id,v_target_account_id;
 END LOOP;
 UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE created_by=p_user_id;
 UPDATE ai_configs SET handoff_agent_id=NULL WHERE handoff_agent_id=p_user_id;
 -- No personal account is created. Removing the profile immediately revokes
 -- all membership-based RLS access, including for an existing JWT session.
 INSERT INTO member_deletion_jobs(user_id,account_id,requested_by) VALUES(p_user_id,v_target_account_id,auth.uid());
 DELETE FROM profiles WHERE user_id=p_user_id;
 RETURN p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.remove_account_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
