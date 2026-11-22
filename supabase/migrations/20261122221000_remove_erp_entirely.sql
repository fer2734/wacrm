-- Eliminar completamente el ERP activo. Resguardo previo privado: esquema respaldo_20261122.
-- Preservar CRM, contactos, conversaciones, flujo comercial y WhatsApp Cloud API.
BEGIN;
-- La RPC de invitaciones comparte dependencias con las tablas ERP: redefinir primero.
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
    UNION ALL SELECT 1 FROM member_deletion_jobs WHERE account_id = v_old_account_id
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
;

-- Storage RLS del ERP, sin tocar otras reglas de objetos.
DROP POLICY IF EXISTS erp_private_files_read ON storage.objects;
DROP POLICY IF EXISTS erp_private_files_add ON storage.objects;
DROP POLICY IF EXISTS erp_admin_storage_read ON storage.objects;
DROP POLICY IF EXISTS erp_admin_storage_add ON storage.objects;

-- No existen llaves foráneas desde tablas CRM hacia estas tablas ERP.
DROP TABLE IF EXISTS public.erp_admin_documents CASCADE;
DROP TABLE IF EXISTS public.erp_audit_log CASCADE;
DROP TABLE IF EXISTS public.erp_commissions CASCADE;
DROP TABLE IF EXISTS public.erp_contract_settings CASCADE;
DROP TABLE IF EXISTS public.erp_contract_templates CASCADE;
DROP TABLE IF EXISTS public.erp_credit_applications CASCADE;
DROP TABLE IF EXISTS public.erp_customers CASCADE;
DROP TABLE IF EXISTS public.erp_deliveries CASCADE;
DROP TABLE IF EXISTS public.erp_delivery_checklist CASCADE;
DROP TABLE IF EXISTS public.erp_documents CASCADE;
DROP TABLE IF EXISTS public.erp_expenses CASCADE;
DROP TABLE IF EXISTS public.erp_fiscal_documents CASCADE;
DROP TABLE IF EXISTS public.erp_followups CASCADE;
DROP TABLE IF EXISTS public.erp_installment_revisions CASCADE;
DROP TABLE IF EXISTS public.erp_installments CASCADE;
DROP TABLE IF EXISTS public.erp_inventory CASCADE;
DROP TABLE IF EXISTS public.erp_memberships CASCADE;
DROP TABLE IF EXISTS public.erp_payment_batches CASCADE;
DROP TABLE IF EXISTS public.erp_payments CASCADE;
DROP TABLE IF EXISTS public.erp_sale_applications CASCADE;
DROP TABLE IF EXISTS public.erp_sales CASCADE;
DROP TABLE IF EXISTS public.erp_signing_requests CASCADE;
DROP TABLE IF EXISTS public.erp_suppliers CASCADE;
DROP TABLE IF EXISTS public.erp_tasks CASCADE;
DROP TABLE IF EXISTS public.erp_treasury_accounts CASCADE;
DROP TABLE IF EXISTS public.erp_treasury_movements CASCADE;
DROP TABLE IF EXISTS public.erp_vehicle_costs CASCADE;
DROP TABLE IF EXISTS public.erp_vehicle_purchases CASCADE;

-- Retirar toda función específica ERP, incluida la de roles y las de disparadores.
DO $drop_erp$
DECLARE function_row record;
BEGIN
 FOR function_row IN
   SELECT p.oid::regprocedure::text AS signature
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'erp_%'
 LOOP
   EXECUTE 'DROP FUNCTION IF EXISTS ' || function_row.signature;
 END LOOP;
END
$drop_erp$;

-- Los tres buckets del ERP están vacíos. Supabase Storage prohíbe eliminarlos
-- por SQL (storage.protect_delete); eliminarlos con la API de Storage cuando
-- esté disponible. Las políticas de lectura/escritura ya se retiraron arriba.

COMMIT;
