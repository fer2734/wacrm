-- Protect old ERP account data during invitation acceptance
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

  -- An empty personal ERP membership is not customer/business data.
  -- Removing it avoids a dangling FK on accounts for users accepting
  -- an invitation to an existing team. The delete is rolled back if
  -- the subsequent data guard refuses the invitation.
  DELETE FROM erp_memberships WHERE account_id = v_old_account_id
    AND user_id = v_caller_id;

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
    UNION ALL SELECT 1 FROM erp_memberships WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_customers WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_sales WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_installments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_payments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_followups WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_inventory WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_expenses WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_deliveries WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_audit_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_tasks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_treasury_accounts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_treasury_movements WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_suppliers WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_vehicle_purchases WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_vehicle_costs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_commissions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_delivery_checklist WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_credit_applications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_installment_revisions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_contract_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_fiscal_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_admin_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM erp_payment_batches WHERE account_id = v_old_account_id
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
