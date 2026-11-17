-- The bot runs exclusively on the server with the service role.
GRANT SELECT ON public.accounts,public.profiles,public.flow_runs,public.flow_run_events,public.contact_notes TO service_role;
GRANT UPDATE (sales_last_assignee) ON public.accounts TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.flows,public.flow_nodes TO service_role;
GRANT INSERT,UPDATE ON public.flow_runs TO service_role;
GRANT INSERT ON public.flow_run_events,public.contact_notes TO service_role;
-- Configuration-only reads for the existing admin UI. No customer run data.
GRANT SELECT ON public.flows,public.flow_nodes TO authenticated;
