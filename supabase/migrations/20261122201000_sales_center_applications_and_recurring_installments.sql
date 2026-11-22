-- Unificar expediente comercial por venta. Mantener los pagos y documentos previos.
begin;

alter table public.erp_sales
  add column if not exists entry_date date,
  add column if not exists second_due_date date;

alter table public.erp_sales drop constraint if exists erp_sales_installment_count_check;
alter table public.erp_sales add constraint erp_sales_installment_count_check check (installment_count >= 0);
alter table public.erp_sales drop constraint if exists erp_sales_delivery_target_installment_check;
alter table public.erp_sales add constraint erp_sales_delivery_target_installment_check check (delivery_target_installment >= 1);
alter table public.erp_installments drop constraint if exists erp_installments_installment_number_check;
alter table public.erp_installments add constraint erp_installments_installment_number_check check (installment_number >= 1);

create table if not exists public.erp_sale_applications (
 sale_id uuid primary key,
 account_id uuid not null,
 data jsonb not null default '{}'::jsonb,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 constraint erp_sale_applications_sale_account_fk foreign key (sale_id,account_id)
   references public.erp_sales(id,account_id) on delete cascade,
 constraint erp_sale_applications_json_object check (jsonb_typeof(data)='object')
);
create index if not exists erp_sale_applications_account_idx on public.erp_sale_applications(account_id);
alter table public.erp_sale_applications enable row level security;
revoke all on public.erp_sale_applications from anon;
grant select,insert,update on public.erp_sale_applications to authenticated;

create policy erp_sale_applications_read on public.erp_sale_applications
 for select to authenticated using (public.erp_can_access_sale(sale_id));
create policy erp_sale_applications_add on public.erp_sale_applications
 for insert to authenticated with check (
  updated_by=(select auth.uid()) and public.erp_can_access_sale(sale_id)
 );
create policy erp_sale_applications_edit on public.erp_sale_applications
 for update to authenticated
 using (public.erp_can_access_sale(sale_id))
 with check (updated_by=(select auth.uid()) and public.erp_can_access_sale(sale_id));

-- Primera cuota: importe mensual + gastos administrativos por separado en el legajo.
-- Las siguientes cuotas usan el importe mensual pactado.
create or replace function public.erp_create_sale(p_account uuid, p_customer uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare myrole text; assigned uuid; sale uuid; n integer; charge numeric(15,2);
        fee numeric(15,2); firstdate date; second_date date; i integer;
        vtype text; otype text; client_agent uuid;
begin
 if (select auth.uid()) is null then raise exception 'Iniciá sesión'; end if;
 myrole:=public.erp_role(p_account);
 if myrole not in ('propietario','administracion','vendedor') or myrole is null then raise exception 'No autorizado'; end if;
 select agent_id into client_agent from public.erp_customers where id=p_customer and account_id=p_account;
 if not found then raise exception 'Cliente inexistente en esta cuenta'; end if;
 assigned:=coalesce(nullif(p_values->>'agent_id','')::uuid, (select auth.uid()));
 if myrole='vendedor' then
   if assigned<>(select auth.uid()) or client_agent<>assigned then raise exception 'Solo podés cargar operaciones de tus clientes'; end if;
 else
   if not exists(select 1 from public.erp_memberships where account_id=p_account and user_id=assigned and erp_role in('propietario','administracion','vendedor')) then
     raise exception 'Asesor no autorizado';
   end if;
 end if;
 vtype:=coalesce(nullif(p_values->>'vehicle_type',''),'auto');
 otype:=coalesce(nullif(p_values->>'operation_type',''),'financiacion');
 if vtype not in('auto','moto','camioneta','otro') or otype not in('financiacion','directa') then raise exception 'Tipo inválido'; end if;
 n:=coalesce((p_values->>'installment_count')::integer,0);
 charge:=coalesce((p_values->>'installment_amount')::numeric,0);
 fee:=coalesce((p_values->>'admin_fee')::numeric,0);
 firstdate:=coalesce(nullif(p_values->>'entry_date','')::date,nullif(p_values->>'first_due','')::date);
 second_date:=coalesce(nullif(p_values->>'second_due_date','')::date,(firstdate + interval '1 month')::date);
 if n<0 or n>240 or (n>0 and (charge<=0 or firstdate is null)) or (n=0 and charge<>0)
   or fee<0 or (n>1 and second_date<firstdate) then raise exception 'Plan de cuotas inválido'; end if;
 if length(trim(coalesce(p_values->>'vehicle_description','')))<2 then raise exception 'Vehículo requerido'; end if;
 insert into public.erp_sales(account_id,customer_id,agent_id,vehicle_description,vehicle_type,operation_type,
 price,initial_amount,admin_fee,installment_amount,installment_count,first_due,entry_date,second_due_date,
 delivery_target_installment,notes,created_by,crm_conversation_id,whatsapp_chat_id)
 values(p_account,p_customer,assigned,left(p_values->>'vehicle_description',200),vtype,otype,
 coalesce((p_values->>'price')::numeric,0),coalesce((p_values->>'initial_amount')::numeric,0),
 fee,charge,n,firstdate,firstdate,case when n>1 then second_date else null end,
 coalesce((p_values->>'delivery_target_installment')::integer,4),
 left(coalesce(p_values->>'notes',''),3000),(select auth.uid()),
 nullif(p_values->>'crm_conversation_id','')::uuid,nullif(p_values->>'whatsapp_chat_id',''))
 returning id into sale;
 if n>0 then
   for i in 1..n loop
     insert into public.erp_installments(account_id,sale_id,installment_number,due_date,amount)
     values(p_account,sale,i,case when i=1 then firstdate else (second_date+(i-2)*interval '1 month')::date end,
       case when i=1 then charge+fee else charge end);
   end loop;
 end if;
 return sale;
end $function$;

-- El vendedor puede continuar agregando cuotas a una venta propia;
-- el bloqueo de la operación impide duplicar números con solicitudes concurrentes.
create or replace function public.erp_append_installment(p_sale uuid,p_due_date date,p_amount numeric)
returns integer language plpgsql security definer set search_path to ''
as $function$
declare s record; i integer; last_due date;
begin
 if (select auth.uid()) is null then raise exception 'Iniciá sesión'; end if;
 if p_due_date is null or p_amount is null or p_amount<=0 then raise exception 'Fecha e importe válidos requeridos'; end if;
 select id,account_id,installment_count into s from public.erp_sales where id=p_sale for update;
 if not found then raise exception 'Operación inexistente'; end if;
 if not public.erp_can_access_sale(p_sale) then raise exception 'No autorizado'; end if;
 select coalesce(max(installment_number),0)+1,max(due_date) into i,last_due
 from public.erp_installments where sale_id=p_sale;
 if last_due is not null and p_due_date<last_due then raise exception 'El nuevo vencimiento no puede ser anterior al último'; end if;
 insert into public.erp_installments(account_id,sale_id,installment_number,due_date,amount)
 values(s.account_id,p_sale,i,p_due_date,p_amount);
 update public.erp_sales set installment_count=greatest(installment_count,i),updated_at=now() where id=p_sale;
 return i;
end $function$;
revoke all on function public.erp_append_installment(uuid,date,numeric) from public,anon;
grant execute on function public.erp_append_installment(uuid,date,numeric) to authenticated;
commit;
