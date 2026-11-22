-- Validación o reversión atómica de un comprobante aplicado a varias cuotas
create or replace function public.erp_review_payment_batch(p_batch uuid,p_action text)
returns integer language plpgsql security definer set search_path='' as $$
declare acc uuid; old_status text; total_rows integer; all_rows integer;
begin
 select account_id into acc from public.erp_payment_batches where id=p_batch for update;
 if not found or not public.erp_is_admin(acc) then raise exception 'Solo administración puede validar pagos';end if;
 if p_action not in('confirmado','rechazado','revertido') then raise exception 'Acción de pago inválida';end if;
 old_status:=case when p_action='revertido' then 'confirmado' else 'pendiente' end;
 select count(*) into all_rows from public.erp_payments where batch_id=p_batch;
 select count(*) into total_rows from public.erp_payments where batch_id=p_batch and status=old_status;
 if all_rows<1 or all_rows<>total_rows then raise exception 'El lote tiene movimientos con estados incompatibles';end if;
 update public.erp_payments set status=p_action,reviewed_by=(select auth.uid()),reviewed_at=now()
 where batch_id=p_batch and status=old_status;
 return total_rows;
end; $$;
revoke all on function public.erp_review_payment_batch(uuid,text) from public;
grant execute on function public.erp_review_payment_batch(uuid,text) to authenticated;
