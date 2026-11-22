-- VALLE ERP II · módulos administrativos y seguimiento
-- No modifica mensajes, chats ni las tablas originales del CRM.
create table public.erp_tasks (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid, installment_id uuid,
 assigned_to uuid not null references auth.users(id),
 kind text not null check(kind in('seguimiento','cobranza','documentacion','entrega','administrativa')),
 title text not null check(length(trim(title)) between 3 and 240),
 details text,
 due_at timestamptz not null,
 status text not null default 'pendiente' check(status in('pendiente','en_proceso','completada','cancelada')),
 auto_key text,
 completed_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id),
 foreign key(installment_id,sale_id) references public.erp_installments(id,sale_id),
 unique(account_id,auto_key)
);
create index erp_tasks_assignee_due on public.erp_tasks(account_id,assigned_to,status,due_at);

create table public.erp_treasury_accounts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 name text not null check(length(trim(name))>1),
 kind text not null check(kind in('efectivo','banco','billetera')),
 bank_name text,
 reference text,
 opening_balance numeric(15,2) not null default 0,
 active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(id,account_id)
);
create index erp_treasury_accounts_account on public.erp_treasury_accounts(account_id);

create table public.erp_treasury_movements (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 treasury_account_id uuid not null,
 movement_date date not null default current_date,
 direction text not null check(direction in('ingreso','egreso')),
 amount numeric(15,2) not null check(amount>0),
 category text not null default 'general',
 description text not null check(length(trim(description)) between 2 and 500),
 source_type text not null default 'manual' check(source_type in('manual','pago','gasto','transferencia','reversion','comision')),
 source_id uuid,
 transfer_group uuid,
 reversal_of uuid unique references public.erp_treasury_movements(id),
 reconciled_at timestamptz,
 reconciled_by uuid references auth.users(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(treasury_account_id,account_id) references public.erp_treasury_accounts(id,account_id)
);
create unique index erp_treasury_posted_source on public.erp_treasury_movements(account_id,source_type,source_id,direction)
where source_id is not null and source_type in('pago','gasto','comision');
create index erp_treasury_movements_account_date on public.erp_treasury_movements(account_id,movement_date desc);

create table public.erp_suppliers (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 name text not null check(length(trim(name))>=2),
 tax_id text,
 phone text,
 email text,
 address text,
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(id,account_id)
);
create index erp_suppliers_account on public.erp_suppliers(account_id);

create table public.erp_vehicle_purchases (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 vehicle_id uuid not null references public.erp_inventory(id),
 supplier_id uuid,
 purchase_date date not null default current_date,
 price numeric(15,2) not null check(price>=0),
 status text not null default 'pendiente' check(status in('pendiente','confirmada','cancelada')),
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(supplier_id,account_id) references public.erp_suppliers(id,account_id)
);
create index erp_vehicle_purchases_account on public.erp_vehicle_purchases(account_id,vehicle_id);

create table public.erp_vehicle_costs (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 vehicle_id uuid not null references public.erp_inventory(id),
 category text not null check(length(trim(category))>1),
 description text not null,
 cost numeric(15,2) not null check(cost>0),
 incurred_on date not null default current_date,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index erp_vehicle_costs_vehicle on public.erp_vehicle_costs(account_id,vehicle_id);

create table public.erp_commissions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 agent_id uuid not null references auth.users(id),
 concept text not null,
 basis text not null default 'manual' check(basis in('manual','cuota','venta','gasto_carpeta')),
 rate_percent numeric(7,3) check(rate_percent between 0 and 100),
 base_amount numeric(15,2) check(base_amount>=0),
 amount numeric(15,2) not null check(amount>0),
 status text not null default 'calculada' check(status in('calculada','aprobada','pagada','anulada')),
 due_date date,
 paid_at date,
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);
create index erp_commissions_account_agent on public.erp_commissions(account_id,agent_id,status);

create table public.erp_delivery_checklist (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 item_key text not null,
 label text not null,
 completed boolean not null default false,
 completed_at timestamptz,
 completed_by uuid references auth.users(id),
 notes text,
 unique(sale_id,item_key),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);
create index erp_delivery_checklist_sale on public.erp_delivery_checklist(sale_id);

create table public.erp_credit_applications (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 financial_institution text not null,
 amount_requested numeric(15,2) not null check(amount_requested>=0),
 status text not null default 'pendiente' check(status in('pendiente','en_analisis','aprobada','rechazada','desistida')),
 application_date date not null default current_date,
 resolved_at date,
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);
create index erp_credit_applications_account on public.erp_credit_applications(account_id,sale_id);

create table public.erp_installment_revisions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 installment_id uuid not null references public.erp_installments(id),
 previous_due_date date not null,
 revised_due_date date not null,
 previous_amount numeric(15,2) not null,
 revised_amount numeric(15,2) not null,
 reason text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index erp_installment_revisions_installment on public.erp_installment_revisions(installment_id);

create table public.erp_contract_templates (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 name text not null,
 title text not null,
 body_text text not null,
 active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index erp_contract_templates_account on public.erp_contract_templates(account_id);

create table public.erp_fiscal_documents (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid,
 doc_kind text not null default 'factura',
 customer_name text not null,
 amount numeric(15,2) not null check(amount>=0),
 issue_date date not null default current_date,
 status text not null default 'borrador' check(status in('borrador','emitido_externamente','anulado')),
 external_reference text,
 cae text,
 authorized_at timestamptz,
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id),
 check(status<>'emitido_externamente' or (external_reference is not null and length(trim(external_reference))>0))
);
create index erp_fiscal_documents_account on public.erp_fiscal_documents(account_id,issue_date desc);

-- Revenue eligibility is explicitly separate from just having four instalments.
create or replace function public.erp_completed_installments(p_sale uuid)
returns integer language sql stable security definer set search_path=''
as $$
 select count(*)::integer
 from public.erp_installments i
 where i.sale_id=p_sale
   and i.amount <= (select coalesce(sum(p.amount),0) from public.erp_payments p
      where p.installment_id=i.id and p.status='confirmado')
$$;
revoke all on function public.erp_completed_installments(uuid) from public;
grant execute on function public.erp_completed_installments(uuid) to authenticated;

create or replace function public.erp_reschedule_installment(
 p_installment uuid,p_new_date date,p_new_amount numeric,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v record; already_paid numeric;
begin
 select i.*,s.account_id as s_account into v from public.erp_installments i
 join public.erp_sales s on s.id=i.sale_id where i.id=p_installment for update;
 if not found or not public.erp_is_admin(v.account_id) then raise exception 'Sin autorización para modificar cuotas'; end if;
 if p_new_date is null or p_new_amount<=0 or length(trim(p_reason))<8 then
   raise exception 'Ingresá vencimiento, importe y motivo de al menos 8 caracteres';
 end if;
 select coalesce(sum(amount),0) into already_paid from public.erp_payments
 where installment_id=p_installment and status='confirmado';
 if p_new_amount<already_paid then raise exception 'No podés reducir el importe por debajo de pagos confirmados';end if;
 insert into public.erp_installment_revisions(account_id,installment_id,previous_due_date,revised_due_date,
 previous_amount,revised_amount,reason,created_by)
 values(v.account_id,p_installment,v.due_date,p_new_date,v.amount,p_new_amount,left(p_reason,1500),(select auth.uid()));
 update public.erp_installments set due_date=p_new_date,amount=p_new_amount where id=p_installment;
end $$;
revoke all on function public.erp_reschedule_installment(uuid,date,numeric,text) from public;
grant execute on function public.erp_reschedule_installment(uuid,date,numeric,text) to authenticated;

create or replace function public.erp_post_treasury(
 p_account uuid,p_cash_account uuid,p_date date,p_direction text,p_amount numeric,
 p_category text,p_description text,p_source_type text default 'manual',p_source_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare entry uuid; source_amount numeric; source_status text; source_acc uuid;
begin
 if not public.erp_is_admin(p_account) then raise exception 'Solo administración puede registrar caja';end if;
 if p_amount<=0 or p_amount>9999999999999 or p_date is null or
    p_direction not in('ingreso','egreso') or length(trim(p_description))<2 then
   raise exception 'Movimiento de caja inválido';
 end if;
 if not exists(select 1 from public.erp_treasury_accounts a where a.id=p_cash_account
  and a.account_id=p_account and a.active) then raise exception 'Cuenta de caja inválida'; end if;
 if p_source_type='pago' then
   select amount,status,account_id into source_amount,source_status,source_acc from public.erp_payments where id=p_source_id;
   if source_acc is distinct from p_account or source_status<>'confirmado' or
      p_direction<>'ingreso' or p_amount<>source_amount then
      raise exception 'El cobro debe estar validado y coincidir con el pago';
   end if;
 elsif p_source_type='gasto' then
   select amount,case when paid then 'pagado' else 'pendiente' end,account_id into source_amount,source_status,source_acc
    from public.erp_expenses where id=p_source_id;
   if source_acc is distinct from p_account or source_status<>'pagado' or
      p_direction<>'egreso' or p_amount<>source_amount then
      raise exception 'El gasto debe figurar pagado y coincidir con el egreso';
   end if;
 elsif p_source_type<>'manual' or p_source_id is not null then raise exception 'Origen de movimiento inválido';
 end if;
 insert into public.erp_treasury_movements(account_id,treasury_account_id,movement_date,direction,amount,
 category,description,source_type,source_id,created_by)
 values(p_account,p_cash_account,p_date,p_direction,p_amount,left(p_category,100),
 left(p_description,500),p_source_type,p_source_id,(select auth.uid()))
 returning id into entry;
 return entry;
end $$;
revoke all on function public.erp_post_treasury(uuid,uuid,date,text,numeric,text,text,text,uuid) from public;
grant execute on function public.erp_post_treasury(uuid,uuid,date,text,numeric,text,text,text,uuid) to authenticated;

create or replace function public.erp_transfer_treasury(
 p_account uuid,p_from uuid,p_to uuid,p_date date,p_amount numeric,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare grp uuid:=gen_random_uuid();
begin
 if not public.erp_is_admin(p_account) then raise exception 'Sin permiso de caja';end if;
 if p_from=p_to or p_amount<=0 or p_date is null or length(trim(p_note))<2 then raise exception 'Transferencia inválida';end if;
 if (select count(*) from public.erp_treasury_accounts
     where id in(p_from,p_to) and account_id=p_account and active)=2 then
   insert into public.erp_treasury_movements(account_id,treasury_account_id,movement_date,direction,amount,
    description,source_type,transfer_group,created_by)
   values(p_account,p_from,p_date,'egreso',p_amount,left(p_note,500),'transferencia',grp,(select auth.uid())),
         (p_account,p_to,p_date,'ingreso',p_amount,left(p_note,500),'transferencia',grp,(select auth.uid()));
 else raise exception 'Las dos cuentas deben estar activas en la misma empresa';end if;
 return grp;
end $$;
revoke all on function public.erp_transfer_treasury(uuid,uuid,uuid,date,numeric,text) from public;
grant execute on function public.erp_transfer_treasury(uuid,uuid,uuid,date,numeric,text) to authenticated;

create or replace function public.erp_reconcile_treasury(p_movement uuid)
returns void language plpgsql security definer set search_path='' as $$
declare acc uuid;
begin
 select account_id into acc from public.erp_treasury_movements where id=p_movement;
 if not found or not public.erp_is_admin(acc) then raise exception 'Sin permiso de conciliación';end if;
 update public.erp_treasury_movements set reconciled_at=now(),reconciled_by=(select auth.uid())
 where id=p_movement and reconciled_at is null;
end $$;
revoke all on function public.erp_reconcile_treasury(uuid) from public;
grant execute on function public.erp_reconcile_treasury(uuid) to authenticated;

create or replace function public.erp_reverse_treasury(p_movement uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare original record; new_id uuid;
begin
 select * into original from public.erp_treasury_movements where id=p_movement for update;
 if not found or not public.erp_is_admin(original.account_id) then raise exception 'Sin permiso de caja';end if;
 if length(trim(p_reason))<8 then raise exception 'Explicá el motivo (8 caracteres mínimo)';end if;
 if original.reversal_of is not null or exists(select 1 from public.erp_treasury_movements where reversal_of=p_movement)
   then raise exception 'Movimiento revertido o ya es una reversión';end if;
 insert into public.erp_treasury_movements(account_id,treasury_account_id,movement_date,direction,amount,
 category,description,source_type,reversal_of,created_by)
 values(original.account_id,original.treasury_account_id,current_date,
  case when original.direction='ingreso' then 'egreso' else 'ingreso' end,
  original.amount,'reversión',left(p_reason,500),'reversion',p_movement,(select auth.uid()))
 returning id into new_id;
 return new_id;
end $$;
revoke all on function public.erp_reverse_treasury(uuid,text) from public;
grant execute on function public.erp_reverse_treasury(uuid,text) to authenticated;

-- Dunning tasks are internal alerts, not auto-messages to customers.
create or replace function public.erp_sync_overdue_tasks(p_account uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare inserted_count integer;
begin
 if not public.erp_is_admin(p_account) then raise exception 'Sin acceso a cobranzas';end if;
 insert into public.erp_tasks(account_id,sale_id,installment_id,assigned_to,kind,title,details,due_at,auto_key)
 select i.account_id,i.sale_id,i.id,s.agent_id,'cobranza',
  'Contactar por cuota '||i.installment_number,
  'Vencimiento '||i.due_date::text||'. Revisar pagos antes de comunicar deuda.',
  (i.due_date::timestamp + interval '12 hours') at time zone 'America/Argentina/Buenos_Aires',
  'mora:'||i.id::text
 from public.erp_installments i join public.erp_sales s on s.id=i.sale_id
 where i.account_id=p_account and i.due_date<current_date
 and coalesce((select sum(p.amount) from public.erp_payments p
 where p.installment_id=i.id and p.status='confirmado'),0)<i.amount
 on conflict(account_id,auto_key) do nothing;
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $$;
revoke all on function public.erp_sync_overdue_tasks(uuid) from public;
grant execute on function public.erp_sync_overdue_tasks(uuid) to authenticated;

-- Financial and contractual data must only be modified through auditable functions.
create or replace function public.erp_no_mutation() returns trigger
language plpgsql as $$
begin raise exception 'Registros financieros inmutables: use reversión o ajuste'; end $$;
revoke all on function public.erp_no_mutation() from public;
create trigger erp_cash_movement_immutable before update or delete
 on public.erp_treasury_movements for each row
 when (old.reconciled_at is not null)
 execute function public.erp_no_mutation();
-- No direct UPDATE or DELETE grants on ledger entries; reconcile uses definer.
-- New RLS policies: default deny until explicitly allowed.
do $$ declare t text; begin
 foreach t in array array['erp_tasks','erp_treasury_accounts','erp_treasury_movements',
 'erp_suppliers','erp_vehicle_purchases','erp_vehicle_costs','erp_commissions',
 'erp_delivery_checklist','erp_credit_applications','erp_installment_revisions',
 'erp_contract_templates','erp_fiscal_documents'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select,insert on public.%I to authenticated',t);
 execute format('create trigger erp_audit_%I after insert or update or delete on public.%I for each row execute function public.erp_log_changes()',t,t);
 end loop;
end $$;
grant update on public.erp_tasks,public.erp_treasury_accounts,public.erp_suppliers,
public.erp_vehicle_purchases,public.erp_commissions,public.erp_delivery_checklist,
public.erp_credit_applications,public.erp_contract_templates,public.erp_fiscal_documents to authenticated;
-- Reconcile is available only via controlled security-definer function.
create policy erp_tasks_read on public.erp_tasks for select to authenticated
using(public.erp_is_admin(account_id) or (assigned_to=(select auth.uid())
and public.erp_role(account_id)='vendedor' and (sale_id is null or public.erp_can_access_sale(sale_id))));
create policy erp_tasks_insert on public.erp_tasks for insert to authenticated
with check(created_by=(select auth.uid()) and
 (public.erp_is_admin(account_id) or (public.erp_role(account_id)='vendedor'
 and assigned_to=(select auth.uid()) and (sale_id is null or public.erp_can_access_sale(sale_id)))));
create policy erp_tasks_update on public.erp_tasks for update to authenticated
using(public.erp_is_admin(account_id) or (assigned_to=(select auth.uid()) and public.erp_role(account_id)='vendedor'))
with check(public.erp_is_admin(account_id) or (assigned_to=(select auth.uid()) and public.erp_role(account_id)='vendedor'));

create policy erp_treasury_accounts_read on public.erp_treasury_accounts for select to authenticated using(public.erp_is_admin(account_id));
create policy erp_treasury_accounts_add on public.erp_treasury_accounts for insert to authenticated with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_treasury_accounts_edit on public.erp_treasury_accounts for update to authenticated using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));
create policy erp_treasury_movements_read on public.erp_treasury_movements for select to authenticated using(public.erp_is_admin(account_id));
-- No INSERT policy on treasury movements: only verified RPCs can insert.

create policy erp_suppliers_read on public.erp_suppliers for select to authenticated using(public.erp_is_admin(account_id));
create policy erp_suppliers_add on public.erp_suppliers for insert to authenticated with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_suppliers_edit on public.erp_suppliers for update to authenticated using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));
create policy erp_purchases_read on public.erp_vehicle_purchases for select to authenticated using(public.erp_is_admin(account_id));
create policy erp_purchases_add on public.erp_vehicle_purchases for insert to authenticated with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_purchases_edit on public.erp_vehicle_purchases for update to authenticated using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));
create policy erp_vehicle_costs_read on public.erp_vehicle_costs for select to authenticated using(public.erp_is_admin(account_id));
create policy erp_vehicle_costs_add on public.erp_vehicle_costs for insert to authenticated with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));

create policy erp_commissions_read on public.erp_commissions for select to authenticated using(public.erp_is_admin(account_id));
create policy erp_commissions_add on public.erp_commissions for insert to authenticated with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_commissions_edit on public.erp_commissions for update to authenticated using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy erp_delivery_checklist_read on public.erp_delivery_checklist for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create policy erp_delivery_checklist_add on public.erp_delivery_checklist for insert to authenticated
 with check(public.erp_is_admin(account_id));
create policy erp_delivery_checklist_edit on public.erp_delivery_checklist for update to authenticated
 using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy erp_credit_applications_read on public.erp_credit_applications for select to authenticated
using(public.erp_can_access_sale(sale_id));
create policy erp_credit_applications_add on public.erp_credit_applications for insert to authenticated
with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_credit_applications_edit on public.erp_credit_applications for update to authenticated
using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy erp_installment_revisions_read on public.erp_installment_revisions for select to authenticated
using(exists(select 1 from public.erp_installments i
 where i.id=installment_id and public.erp_can_access_sale(i.sale_id)));
-- Only RPC inserts revisions.

create policy erp_contract_templates_read on public.erp_contract_templates for select to authenticated
using(public.erp_role(account_id) in('propietario','administracion','vendedor'));
create policy erp_contract_templates_add on public.erp_contract_templates for insert to authenticated
with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_contract_templates_edit on public.erp_contract_templates for update to authenticated
using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy erp_fiscal_documents_read on public.erp_fiscal_documents for select to authenticated
using(public.erp_is_admin(account_id));
create policy erp_fiscal_documents_add on public.erp_fiscal_documents for insert to authenticated
with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy erp_fiscal_documents_edit on public.erp_fiscal_documents for update to authenticated
using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));
