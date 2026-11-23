-- Each agent's linked number and customer summaries are strictly private.
DROP POLICY IF EXISTS private_leads_read ON public.private_wa_leads;
CREATE POLICY private_leads_read ON public.private_wa_leads FOR SELECT TO authenticated
 USING ((select auth.uid()) = user_id AND public.is_account_member(account_id));
DROP POLICY IF EXISTS private_connections_read ON public.private_wa_connections;
CREATE POLICY private_connections_read ON public.private_wa_connections FOR SELECT TO authenticated
 USING ((select auth.uid()) = user_id AND public.is_account_member(account_id));
