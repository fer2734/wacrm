CREATE TABLE public.advisor_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 180),
 kind text NOT NULL DEFAULT 'task' CHECK(kind IN ('task','interview','video','call')),
 starts_at timestamptz NOT NULL,
 duration_minutes integer NOT NULL DEFAULT 30 CHECK(duration_minutes BETWEEN 5 AND 1440),
 client_name text NOT NULL DEFAULT '', client_phone text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '', completed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.advisor_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_advisor_tasks ON public.advisor_tasks FOR ALL TO authenticated
 USING(user_id=(SELECT auth.uid()) AND public.is_account_member(account_id))
 WITH CHECK(user_id=(SELECT auth.uid()) AND public.is_account_member(account_id)
 AND (contact_id IS NULL OR EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=advisor_tasks.contact_id AND c.account_id=advisor_tasks.account_id)));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.advisor_tasks TO authenticated;
CREATE INDEX advisor_tasks_user_schedule ON public.advisor_tasks(user_id,starts_at);

ALTER TABLE public.account_invitations ADD COLUMN signup_user_id uuid;
CREATE FUNCTION public.require_signup_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,extensions AS $$
DECLARE v_token text; v_inv public.account_invitations%ROWTYPE;
BEGIN
 v_token:=NEW.raw_user_meta_data->>'invitation_token';
 IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9_-]{43}$' THEN
  RAISE EXCEPTION 'El registro requiere un enlace de invitación válido' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_inv FROM public.account_invitations
 WHERE token_hash=encode(extensions.digest(v_token,'sha256'),'hex') FOR UPDATE;
 IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.expires_at<=now()
 OR (v_inv.signup_user_id IS NOT NULL AND v_inv.signup_user_id<>NEW.id) THEN
  RAISE EXCEPTION 'La invitación no es válida, ya se usó o venció' USING ERRCODE='42501';
 END IF;
 UPDATE public.account_invitations SET signup_user_id=NEW.id WHERE id=v_inv.id;
 -- Do not leave the bearer token in editable user metadata.
 NEW.raw_user_meta_data:=NEW.raw_user_meta_data-'invitation_token';
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_signup_invitation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_signup_invitation BEFORE INSERT ON auth.users
 FOR EACH ROW EXECUTE FUNCTION public.require_signup_invitation();
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

