-- Retiro definitivo de datos específicos de WAHA del CRM.
-- Elimina únicamente tablas de la integración experimental: no toca WhatsApp Cloud API,
-- chats oficiales, contactos del CRM, clientes, ventas ni comprobantes del ERP.
BEGIN;
DROP TABLE IF EXISTS public.waha_lab_preview_cache;
DROP TABLE IF EXISTS public.waha_lab_chat_cache;
DROP TABLE IF EXISTS public.waha_lab_chat_settings;
DROP TABLE IF EXISTS public.waha_lab_snapshots;
DROP TABLE IF EXISTS public.waha_lab_inboxes;
COMMIT;
