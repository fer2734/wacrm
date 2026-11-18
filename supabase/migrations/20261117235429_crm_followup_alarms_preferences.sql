ALTER TABLE public.advisor_tasks ADD COLUMN alarm_fired_for timestamptz;
CREATE FUNCTION public.claim_my_task_alarms() RETURNS SETOF public.advisor_tasks LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
 UPDATE public.advisor_tasks SET alarm_fired_for=starts_at WHERE id IN (
  SELECT id FROM public.advisor_tasks WHERE user_id=auth.uid() AND NOT completed AND starts_at<=now() AND alarm_fired_for IS DISTINCT FROM starts_at
  ORDER BY starts_at FOR UPDATE SKIP LOCKED LIMIT 10
 ) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_my_task_alarms() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_my_task_alarms() TO authenticated;
-- The account check remains enforced even after a chat is reassigned.
CREATE UNIQUE INDEX contacts_id_account_identity ON public.contacts(id,account_id);
ALTER TABLE public.advisor_tasks ADD CONSTRAINT task_contact_same_account FOREIGN KEY(contact_id,account_id) REFERENCES public.contacts(id,account_id);
DROP POLICY own_advisor_tasks ON public.advisor_tasks;
CREATE POLICY own_advisor_tasks ON public.advisor_tasks FOR ALL TO authenticated
 USING(user_id=(SELECT auth.uid()) AND public.is_account_member(account_id))
 WITH CHECK(user_id=(SELECT auth.uid()) AND public.is_account_member(account_id));

CREATE TABLE public.contact_aliases (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 alias text NOT NULL CHECK(length(alias)<=180), PRIMARY KEY(user_id,contact_id),
 FOREIGN KEY(contact_id,account_id) REFERENCES public.contacts(id,account_id)
);
ALTER TABLE public.contact_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_contact_aliases ON public.contact_aliases FOR ALL TO authenticated
 USING(user_id=auth.uid() AND public.is_account_member(account_id))
 WITH CHECK(user_id=auth.uid() AND public.is_account_member(account_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.contact_aliases TO authenticated;
CREATE TABLE public.user_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 preferences jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_user_preferences ON public.user_preferences FOR ALL TO authenticated
 USING(user_id=auth.uid() AND public.is_account_member(account_id))
 WITH CHECK(user_id=auth.uid() AND public.is_account_member(account_id));
GRANT SELECT,INSERT,UPDATE ON public.user_preferences TO authenticated;

CREATE FUNCTION public.claim_idle_sales_runs() RETURNS SETOF public.flow_runs LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
 UPDATE public.flow_runs SET status='handed_off',ended_at=now(),end_reason='idle_five_minutes'
 WHERE id IN (
  SELECT r.id FROM public.flow_runs r JOIN public.flows f ON f.id=r.flow_id
  JOIN public.conversations c ON c.id=r.conversation_id AND c.account_id=r.account_id
  WHERE r.status='active' AND f.status='active' AND f.trigger_config->>'sales_intake'='true'
    AND c.assigned_agent_id IS NULL AND NOT COALESCE(c.ai_autoreply_disabled,false)
    AND r.last_advanced_at<=now()-interval '5 minutes'
    AND NOT EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='customer' AND m.created_at>now()-interval '5 minutes')
    AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.account_id=r.account_id AND p.account_role='agent')
  ORDER BY r.last_advanced_at FOR UPDATE OF r SKIP LOCKED LIMIT 25
 ) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_idle_sales_runs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idle_sales_runs() TO service_role;

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.signup_user_id IS NOT NULL AND v_inv.signup_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Invitation belongs to a different signup' USING ERRCODE = '42501';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM advisor_tasks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_aliases WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM user_preferences WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$

