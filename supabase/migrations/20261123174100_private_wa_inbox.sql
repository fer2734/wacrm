BEGIN;
CREATE TABLE IF NOT EXISTS public.private_wa_connections (
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 phone text,
 state text NOT NULL DEFAULT 'not_connected' CHECK (state IN ('not_connected','pairing','connected','disconnected','error')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.private_wa_leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 chat_id text NOT NULL,
 phone text NOT NULL,
 name text NOT NULL DEFAULT '',
 locality text NOT NULL DEFAULT '',
 summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary)='object'),
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,user_id,chat_id)
);
CREATE INDEX IF NOT EXISTS private_wa_leads_user_idx ON public.private_wa_leads(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.private_wa_bot_configs(
 account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
 config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(config)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.private_wa_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_wa_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_wa_bot_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_wa_connections,public.private_wa_leads,public.private_wa_bot_configs FROM anon;
GRANT SELECT ON public.private_wa_connections,public.private_wa_leads,public.private_wa_bot_configs TO authenticated;
GRANT UPDATE(read_at) ON public.private_wa_leads TO authenticated;
GRANT INSERT,UPDATE ON public.private_wa_bot_configs TO authenticated;
DROP POLICY IF EXISTS private_connections_read ON public.private_wa_connections;
CREATE POLICY private_connections_read ON public.private_wa_connections FOR SELECT TO authenticated
 USING(auth.uid()=user_id OR public.is_account_member(account_id,'admin'::public.account_role_enum));
DROP POLICY IF EXISTS private_leads_read ON public.private_wa_leads;
CREATE POLICY private_leads_read ON public.private_wa_leads FOR SELECT TO authenticated
 USING(auth.uid()=user_id OR public.is_account_member(account_id,'admin'::public.account_role_enum));
DROP POLICY IF EXISTS private_leads_mark_read ON public.private_wa_leads;
CREATE POLICY private_leads_mark_read ON public.private_wa_leads FOR UPDATE TO authenticated
 USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
DROP POLICY IF EXISTS private_bot_config_read ON public.private_wa_bot_configs;
CREATE POLICY private_bot_config_read ON public.private_wa_bot_configs FOR SELECT TO authenticated USING(public.is_account_member(account_id));
DROP POLICY IF EXISTS private_bot_config_insert ON public.private_wa_bot_configs;
CREATE POLICY private_bot_config_insert ON public.private_wa_bot_configs FOR INSERT TO authenticated WITH CHECK(public.is_account_member(account_id,'admin'::public.account_role_enum));
DROP POLICY IF EXISTS private_bot_config_update ON public.private_wa_bot_configs;
CREATE POLICY private_bot_config_update ON public.private_wa_bot_configs FOR UPDATE TO authenticated
 USING(public.is_account_member(account_id,'admin'::public.account_role_enum))
 WITH CHECK(public.is_account_member(account_id,'admin'::public.account_role_enum));
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK(type IN ('conversation_assigned','private_lead'));
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='private_wa_leads') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.private_wa_leads;
 END IF;
END$$;
COMMIT;