-- The contact form inserts as authenticated; RLS already controls account and role scope.
-- Production lacked INSERT, rejecting even the owner before evaluating those policies.
GRANT INSERT ON TABLE public.contacts TO authenticated;
