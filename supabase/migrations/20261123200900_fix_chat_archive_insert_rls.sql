-- Fix per-user archive insert. The UI must use INSERT, not UPSERT:
-- authenticated users intentionally have no UPDATE permission on this table.
DROP POLICY IF EXISTS own_conversation_archives ON public.conversation_archives;
CREATE POLICY own_conversation_archives ON public.conversation_archives FOR ALL TO authenticated
USING(
 user_id=(SELECT auth.uid())
 AND public.is_account_member(conversation_archives.account_id)
 AND EXISTS(SELECT 1 FROM public.conversations c
  WHERE c.id=conversation_archives.conversation_id
  AND c.account_id=conversation_archives.account_id)
)
WITH CHECK(
 user_id=(SELECT auth.uid())
 AND public.is_account_member(conversation_archives.account_id)
 AND EXISTS(SELECT 1 FROM public.conversations c
  WHERE c.id=conversation_archives.conversation_id
  AND c.account_id=conversation_archives.account_id)
);
