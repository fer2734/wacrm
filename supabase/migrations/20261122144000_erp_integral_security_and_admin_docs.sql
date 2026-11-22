-- Finanzas ERP: integridad, controles de entrega y soportes de gastos
create or replace function public.erp_completed_installments(p_sale uuid)
returns integer language sql stable security definer set search_path=''
as $$
 select count(*)::integer from public.erp_installments i
 where i.sale_id=p_sale and public.erp_can_access_sale(p_sale)
   and i.amount <= (select coalesce(sum(p.amount),0) from public.erp_payments p
      where p.installment_id=i.id and p.status='confirmado')
$$;
revoke all on function public.erp_completed_installments(uuid) from public;
grant execute on function public.erp_completed_installments(uuid) to authenticated;

create or replace function public.erp_guard_vehicle_tenant() returns trigger
language plpgsql security definer set search_path='' as $$
declare home uuid;
begin
 select account_id into home from public.erp_inventory where id=NEW.vehicle_id;
 if home is distinct from NEW.account_id then
  raise exception 'La unidad no pertenece a esta cuenta ERP';
 end if;
 return NEW;
end; $;
revoke all on function public.erp_guard_vehicle_tenant() from public;
create trigger erp_purchase_vehicle_tenant before insert or update of account_id,vehicle_id
on public.erp_vehicle_purchases for each row execute function public.erp_guard_vehicle_tenant();
create trigger erp_cost_vehicle_tenant before insert or update of account_id,vehicle_id
on public.erp_vehicle_costs for each row execute function public.erp_guard_vehicle_tenant();

create or replace function public.erp_guard_commission() returns trigger
language plpgsql security definer set search_path='' as $$
declare salesperson uuid;
begin
 select agent_id into salesperson from public.erp_sales where id=NEW.sale_id and account_id=NEW.account_id;
 if salesperson is null or salesperson<>NEW.agent_id then
  raise exception 'La comisión debe corresponder al asesor responsable de la operación';
 end if;
 if TG_OP='UPDATE' then
   if row(NEW.account_id,NEW.sale_id,NEW.agent_id,NEW.amount,NEW.concept,NEW.basis,NEW.rate_percent,NEW.base_amount)
       is distinct from row(OLD.account_id,OLD.sale_id,OLD.agent_id,OLD.amount,OLD.concept,OLD.basis,OLD.rate_percent,OLD.base_amount) then
     raise exception 'La comisión registrada es inmutable; generá un nuevo ajuste documentado';
   end if;
   if NEW.status is distinct from OLD.status then
     if not ((OLD.status='calculada' and NEW.status in('aprobada','anulada'))
       or (OLD.status='aprobada' and NEW.status in('pagada','anulada'))) then
       raise exception 'Transición de comisión no permitida';
     end if;
   end if;
   if NEW.status='pagada' and NEW.paid_at is null then
     raise exception 'Una comisión pagada requiere fecha de pago';
   end if;
 end if;
 return NEW;
end; $;
revoke all on function public.erp_guard_commission() from public;
create trigger erp_commission_guard before insert or update
on public.erp_commissions for each row execute function public.erp_guard_commission();

create or replace function public.erp_save_delivery(p_sale uuid,p_credit text,p_status text,
p_planned date,p_delivered date,p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; required_count integer; verified_count integer;
begin
 select account_id,operation_type,delivery_target_installment into s
 from public.erp_sales where id=p_sale for update;
 if not found or not public.erp_is_admin(s.account_id) then
  raise exception 'No tenés permiso de entregas';
 end if;
 if p_credit not in('pendiente','en_gestion','aprobado','rechazado')
 or p_status not in('pendiente','documentacion','credito','vehiculo','programada','entregada','cancelada') then
  raise exception 'Estado de entrega o crédito inválido';
 end if;
 if p_status='entregada' then
   if p_delivered is null then raise exception 'Registrá la fecha efectiva de entrega';end if;
   if s.operation_type='financiacion' then
     if p_credit<>'aprobado' then raise exception 'Crédito no aprobado';end if;
     if public.erp_completed_installments(p_sale)<s.delivery_target_installment then
      raise exception 'No se completaron las cuotas pactadas para gestión de entrega';
     end if;
   end if;
   select count(*) into required_count from public.erp_delivery_checklist c
    where c.sale_id=p_sale and c.item_key in('ficha','identidad','contrato','pagos','credito','vehiculo','acta')
      and (s.operation_type='financiacion' or c.item_key not in ('pagos','credito'));
   select count(*) into verified_count from public.erp_delivery_checklist c
    where c.sale_id=p_sale and c.completed=true and c.item_key in('ficha','identidad','contrato','pagos','credito','vehiculo','acta')
      and (s.operation_type='financiacion' or c.item_key not in('pagos','credito'));
   if required_count<>case when s.operation_type='financiacion' then 7 else 5 end
      or verified_count<>required_count then
     raise exception 'Checklist documental incompleto. Verificá antes de entregar';
   end if;
 end if;
 update public.erp_sales set credit_status=p_credit,
  stage=case when p_status='entregada' then 'entregado'
  when p_status in('documentacion','credito','vehiculo','programada') then 'entrega_en_gestion'
  else stage end,updated_at=now() where id=p_sale;
 insert into public.erp_deliveries(account_id,sale_id,status,planned_at,delivered_at,notes,updated_by,updated_at)
 values(s.account_id,p_sale,p_status,p_planned,p_delivered,left(p_notes,3000),(select auth.uid()),now())
 on conflict(sale_id) do update set
 status=excluded.status,planned_at=excluded.planned_at,delivered_at=excluded.delivered_at,
 notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end; $;
revoke all on function public.erp_save_delivery(uuid,text,text,date,date,text) from public;
grant execute on function public.erp_save_delivery(uuid,text,text,date,date,text) to authenticated;

create or replace function public.erp_sync_overdue_tasks(p_account uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare inserted_count integer;
begin
 if not public.erp_is_admin(p_account) then raise exception 'Sin acceso a cobranzas';end if;
 insert into public.erp_tasks(account_id,sale_id,installment_id,assigned_to,kind,title,details,due_at,auto_key)
 select i.account_id,i.sale_id,i.id,s.agent_id,'cobranza',
  'Contactar por cuota '||i.installment_number,
  'Vencimiento '||i.due_date::text||'. Verificar pagos antes de informar saldo.',
  (i.due_date::timestamp+interval '12 hours') at time zone 'America/Argentina/Buenos_Aires',
  'mora:'||i.id::text
 from public.erp_installments i join public.erp_sales s on s.id=i.sale_id
 where i.account_id=p_account and i.due_date < (now() at time zone 'America/Argentina/Buenos_Aires')::date
 and coalesce((select sum(p.amount) from public.erp_payments p
 where p.installment_id=i.id and p.status='confirmado'),0)<i.amount
 on conflict(account_id,auto_key) do nothing;
 get diagnostics inserted_count=row_count;
 update public.erp_tasks t set status='completada',completed_at=now()
 from public.erp_installments i
 where t.installment_id=i.id and t.account_id=p_account and t.auto_key like 'mora:%'
 and t.status in('pendiente','en_proceso')
 and coalesce((select sum(p.amount) from public.erp_payments p
   where p.installment_id=i.id and p.status='confirmado'),0)>=i.amount;
 return inserted_count;
end; $;
revoke all on function public.erp_sync_overdue_tasks(uuid) from public;
grant execute on function public.erp_sync_overdue_tasks(uuid) to authenticated;

create table public.erp_admin_documents(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 expense_id uuid references public.erp_expenses(id),
 kind text not null default 'gasto' check(kind in('gasto','factura_proveedor','banco','otro')),
 path text not null unique,
 file_name text not null,
 mime_type text not null check(mime_type in('application/pdf','image/jpeg','image/png','image/webp')),
 file_size bigint not null check(file_size between 1 and 10485760),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check(path like account_id::text||'/%')
);
create index erp_admin_documents_expense on public.erp_admin_documents(account_id,expense_id);
alter table public.erp_admin_documents enable row level security;
revoke all on public.erp_admin_documents from anon,authenticated;
grant select,insert on public.erp_admin_documents to authenticated;
create policy erp_admin_documents_read on public.erp_admin_documents
 for select to authenticated using(public.erp_is_admin(account_id));
create policy erp_admin_documents_insert on public.erp_admin_documents
 for insert to authenticated with check(public.erp_is_admin(account_id) and created_by=(select auth.uid())
 and (expense_id is null or exists(select 1 from public.erp_expenses e where e.id=expense_id and e.account_id=erp_admin_documents.account_id)));
create trigger erp_admin_documents_audit after insert or update or delete
on public.erp_admin_documents for each row execute function public.erp_log_changes();

create or replace function public.erp_admin_storage_path(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare account_part text;
begin
 account_part:=split_part(p_path,'/',1);
 if account_part !~ '^[0-9a-f-]{36}$' or length(split_part(p_path,'/',2))<2 then return false; end if;
 return public.erp_is_admin(account_part::uuid);
exception when invalid_text_representation then return false;
end; $;
revoke all on function public.erp_admin_storage_path(text) from public;
grant execute on function public.erp_admin_storage_path(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('erp-administracion','erp-administracion',false,10485760,
array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create policy erp_admin_storage_read on storage.objects
 for select to authenticated using(bucket_id='erp-administracion' and public.erp_admin_storage_path(name));
create policy erp_admin_storage_add on storage.objects
 for insert to authenticated with check(bucket_id='erp-administracion' and public.erp_admin_storage_path(name)
 and owner_id=(select auth.uid())::text);
