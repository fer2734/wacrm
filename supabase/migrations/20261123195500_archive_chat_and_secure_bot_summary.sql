-- Non-destructive per-user chat archiving. Other advisors keep their own lists.
CREATE TABLE IF NOT EXISTS public.conversation_archives (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS conversation_archives_user_idx ON public.conversation_archives(account_id,user_id);
ALTER TABLE public.conversation_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_archives FROM anon;
GRANT SELECT,INSERT,DELETE ON public.conversation_archives TO authenticated;
DROP POLICY IF EXISTS own_conversation_archives ON public.conversation_archives;
CREATE POLICY own_conversation_archives ON public.conversation_archives FOR ALL TO authenticated
USING (
 user_id=(SELECT auth.uid()) AND public.is_account_member(account_id)
 AND EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND c.account_id=account_id)
)
WITH CHECK (
 user_id=(SELECT auth.uid()) AND public.is_account_member(account_id)
 AND EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND c.account_id=account_id)
);
-- Read-only summaries from bot runs, restricted to assigned advisor or admin.
CREATE OR REPLACE FUNCTION public.get_conversation_intake_summary(p_conversation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_conversation public.conversations%rowtype; v_vars jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthenticated' USING errcode='42501'; END IF;
 SELECT * INTO v_conversation FROM public.conversations WHERE id=p_conversation_id;
 IF NOT FOUND OR NOT public.is_account_member(v_conversation.account_id) THEN
   RAISE EXCEPTION 'Conversation not available' USING errcode='42501';
 END IF;
 IF v_conversation.assigned_agent_id IS DISTINCT FROM auth.uid()
    AND NOT public.is_account_member(v_conversation.account_id,'admin'::public.account_role_enum) THEN
   RAISE EXCEPTION 'Conversation not assigned to user' USING errcode='42501';
 END IF;
 SELECT vars INTO v_vars FROM public.flow_runs
 WHERE conversation_id=p_conversation_id AND account_id=v_conversation.account_id
 ORDER BY started_at DESC LIMIT 1;
 RETURN coalesce(v_vars,'{}'::jsonb);
END;$$;
REVOKE ALL ON FUNCTION public.get_conversation_intake_summary(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_intake_summary(uuid) TO authenticated;
