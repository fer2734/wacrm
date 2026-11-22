
-- Harden financial transitions and make delivery control atomic.
create or replace function public.erp_guard_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare quota numeric(15,2); already numeric(15,2);
begin
 if TG_OP='UPDATE' then
   if OLD.status in ('rechazado','revertido') and row(NEW.status,NEW.amount,NEW.installment_id,NEW.sale_id,NEW.paid_at,NEW.method,NEW.reference)
       is distinct from row(OLD.status,OLD.amount,OLD.installment_id,OLD.sale_id,OLD.paid_at,OLD.method,OLD.reference) then
     raise exception 'Los pagos rechazados o revertidos son inmutables. Informá un nuevo pago.';
   end if;
   if OLD.status='confirmado' then
     if NEW.status not in ('confirmado','revertido') then raise exception 'Un pago confirmado solo se puede revertir'; end if;
     if row(NEW.amount,NEW.installment_id,NEW.sale_id,NEW.paid_at,NEW.method,NEW.reference)
        is distinct from row(OLD.amount,OLD.installment_id,OLD.sale_id,OLD.paid_at,OLD.method,OLD.reference) then
       raise exception 'No se puede alterar un pago confirmado';
     end if;
   end if;
   if NEW.status='confirmado' and OLD.status not in ('pendiente','confirmado') then
     raise exception 'Transición de pago no permitida';
   end if;
 end if;
 if NEW.status='confirmado' then
   select amount into quota from public.erp_installments
   where id=NEW.installment_id and sale_id=NEW.sale_id for update;
   if not found then raise exception 'Cuota inexistente'; end if;
   select coalesce(sum(p.amount),0) into already from public.erp_payments p
   where p.installment_id=NEW.installment_id and p.status='confirmado' and p.id<>NEW.id;
   if already+NEW.amount>quota then raise exception 'El pago supera el saldo restante de la cuota'; end if;
 end if;
 return NEW;
end $$;
revoke all on function public.erp_guard_payment() from public;
create trigger erp_guard_payment_before before insert or update on public.erp_payments
for each row execute function public.erp_guard_payment();

create or replace function public.erp_save_delivery(p_sale uuid,p_credit text,p_status text,
p_planned date,p_delivered date,p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare s record;
begin
 select account_id into s from public.erp_sales where id=p_sale for update;
 if not found or not public.erp_is_admin(s.account_id) then raise exception 'No tenés permiso de entregas'; end if;
 if p_credit not in('pendiente','en_gestion','aprobado','rechazado') or
    p_status not in('pendiente','documentacion','credito','vehiculo','programada','entregada','cancelada') then
    raise exception 'Estado inválido';
 end if;
 if p_status='entregada' and (p_credit<>'aprobado' or p_delivered is null) then
   raise exception 'Para entregar se necesita crédito aprobado y fecha efectiva de entrega';
 end if;
 update public.erp_sales set credit_status=p_credit,
 stage=case when p_status='entregada' then 'entregado'
 when p_status in('documentacion','credito','vehiculo','programada') then 'entrega_en_gestion'
 else stage end,updated_at=now()
 where id=p_sale;
 insert into public.erp_deliveries(account_id,sale_id,status,planned_at,delivered_at,notes,updated_by,updated_at)
 values(s.account_id,p_sale,p_status,p_planned,p_delivered,left(p_notes,3000),(select auth.uid()),now())
 on conflict(sale_id) do update set
 status=excluded.status,planned_at=excluded.planned_at,delivered_at=excluded.delivered_at,
 notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end $$;
revoke all on function public.erp_save_delivery(uuid,text,text,date,date,text) from public;
grant execute on function public.erp_save_delivery(uuid,text,text,date,date,text) to authenticated;

create index if not exists erp_documents_sale_idx on public.erp_documents(sale_id,created_at desc);
create index if not exists erp_followups_sale_idx on public.erp_followups(sale_id,created_at desc);
create index if not exists erp_payments_account_status_idx on public.erp_payments(account_id,status,created_at desc);
create index if not exists erp_deliveries_account_idx on public.erp_deliveries(account_id);
create index if not exists erp_inventory_account_idx on public.erp_inventory(account_id,status);
