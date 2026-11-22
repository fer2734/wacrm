-- Retirar por completo la integración anterior basada en Baileys.
-- En el ambiente productivo se confirmó que estas cuatro tablas no contienen registros.
begin;
drop table if exists public.private_whatsapp_messages;
drop table if exists public.private_whatsapp_chats;
drop table if exists public.private_whatsapp_addressbook;
drop table if exists public.private_whatsapp_inboxes;
drop function if exists public.apply_private_whatsapp_profiles(uuid,jsonb);
drop function if exists public.assign_private_whatsapp_default_stage();
drop function if exists public.erase_private_whatsapp_data(uuid);
drop function if exists public.ingest_private_whatsapp_batch(uuid,bigint,bigint,jsonb);
drop function if exists public.match_private_whatsapp_addressbook();
commit;
