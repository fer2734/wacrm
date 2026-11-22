
-- ERP Valle Automotores · esquema aislado, roles independientes del CRM
create table if not exists public.erp_memberships (
  account_id uuid not null references public.accounts(id),
  user_id uuid not null references auth.users(id),
  erp_role text not null check (erp_role in ('propietario','administracion','vendedor','consulta')),
  created_at timestamptz not null default now(),
  primary key(account_id,user_id)
);
insert into public.erp_memberships(account_id,user_id,erp_role)
select account_id,user_id, case account_role::text
  when 'owner' then 'propietario' when 'admin' then 'administracion'
  when 'agent' then 'vendedor' else 'consulta' end
from public.profiles where account_id is not null and user_id is not null
on conflict do nothing;

create or replace function public.erp_role(p_account uuid) returns text
language sql stable security definer set search_path = ''
as $$select m.erp_role from public.erp_memberships m
where m.account_id=p_account and m.user_id=(select auth.uid()) limit 1$$;
revoke all on function public.erp_role(uuid) from public;
grant execute on function public.erp_role(uuid) to authenticated;

create or replace function public.erp_is_admin(p_account uuid) returns boolean
language sql stable security definer set search_path = ''
as $$select coalesce(public.erp_role(p_account) in ('propietario','administracion'),false)$$;
revoke all on function public.erp_is_admin(uuid) from public;
grant execute on function public.erp_is_admin(uuid) to authenticated;

create table if not exists public.erp_customers (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 agent_id uuid not null references auth.users(id),
 crm_contact_id uuid null,
 full_name text not null check (length(trim(full_name)) between 2 and 180),
 document_number text,
 phone text not null,
 email text,
 address text,
 city text,
 province text default 'Río Negro',
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,account_id)
);
create index if not exists erp_customers_account_agent_idx on public.erp_customers(account_id,agent_id);

create table if not exists public.erp_sales (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 customer_id uuid not null,
 agent_id uuid not null references auth.users(id),
 crm_conversation_id uuid,
 whatsapp_chat_id text,
 vehicle_description text not null,
 vehicle_type text not null default 'auto' check(vehicle_type in('moto','auto','camioneta','otro')),
 operation_type text not null default 'financiacion' check(operation_type in('financiacion','directa')),
 price numeric(15,2) not null default 0 check(price>=0),
 initial_amount numeric(15,2) not null default 0 check(initial_amount>=0),
 admin_fee numeric(15,2) not null default 0 check(admin_fee>=0),
 installment_amount numeric(15,2) not null default 0 check(installment_amount>=0),
 installment_count integer not null default 0 check(installment_count between 0 and 72),
 first_due date,
 delivery_target_installment integer not null default 4 check(delivery_target_installment between 1 and 72),
 stage text not null default 'nuevo' check(stage in('nuevo','contactado','interesado','documentacion','pactado','activo','entrega_en_gestion','entregado','no_interesado','caido')),
 credit_status text not null default 'pendiente' check(credit_status in('pendiente','en_gestion','aprobado','rechazado')),
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,account_id),
 foreign key(customer_id,account_id) references public.erp_customers(id,account_id)
);
create index if not exists erp_sales_account_agent_idx on public.erp_sales(account_id,agent_id,created_at desc);
create index if not exists erp_sales_customer_idx on public.erp_sales(customer_id);

create or replace function public.erp_can_access_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
select exists (select 1 from public.erp_customers c where c.id=p_customer
  and (public.erp_is_admin(c.account_id)
    or (public.erp_role(c.account_id)='vendedor' and c.agent_id=(select auth.uid()))
    or (public.erp_role(c.account_id)='consulta' and false)))$$;
revoke all on function public.erp_can_access_customer(uuid) from public;
grant execute on function public.erp_can_access_customer(uuid) to authenticated;

create or replace function public.erp_can_access_sale(p_sale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
select exists (select 1 from public.erp_sales s where s.id=p_sale
  and (public.erp_is_admin(s.account_id)
    or (public.erp_role(s.account_id)='vendedor' and s.agent_id=(select auth.uid()))))$$;
revoke all on function public.erp_can_access_sale(uuid) from public;
grant execute on function public.erp_can_access_sale(uuid) to authenticated;

create table if not exists public.erp_installments (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 installment_number integer not null check(installment_number between 1 and 72),
 due_date date not null,
 amount numeric(15,2) not null check(amount>0),
 created_at timestamptz not null default now(),
 unique(sale_id,installment_number),
 unique(id,sale_id),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);
create index if not exists erp_installments_account_due_idx on public.erp_installments(account_id,due_date);

create table if not exists public.erp_payments (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 installment_id uuid not null,
 amount numeric(15,2) not null check(amount>0),
 paid_at date not null default current_date,
 method text not null default 'transferencia' check(method in('transferencia','efectivo','tarjeta','deposito','otro')),
 reference text,
 status text not null default 'pendiente' check(status in('pendiente','confirmado','rechazado','revertido')),
 created_by uuid not null references auth.users(id),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(id,sale_id),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id),
 foreign key(installment_id,sale_id) references public.erp_installments(id,sale_id)
);
create index if not exists erp_payments_sale_status_idx on public.erp_payments(sale_id,status);

create table if not exists public.erp_documents (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 payment_id uuid,
 kind text not null default 'comprobante' check(kind in('comprobante','ficha','contrato','dni','otro')),
 object_path text not null unique,
 file_name text not null,
 mime_type text not null,
 file_size bigint not null check(file_size between 1 and 10485760),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id),
 foreign key(payment_id,sale_id) references public.erp_payments(id,sale_id),
 check(object_path like account_id::text||'/'||sale_id::text||'/%')
);

create table if not exists public.erp_followups (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 outcome text not null default 'nota' check(outcome in('nota','contactado','sin_respuesta','interesado','documentacion','cobranza','otro')),
 notes text not null check(length(trim(notes)) between 1 and 2000),
 next_contact_at timestamptz,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);
create index if not exists erp_followups_next_idx on public.erp_followups(account_id,next_contact_at);

create table if not exists public.erp_inventory (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 brand text not null,
 model text not null,
 version text,
 vehicle_type text default 'auto' check(vehicle_type in('auto','camioneta','moto','otro')),
 model_year integer check(model_year between 1950 and 2100),
 plate text,
 color text,
 cost numeric(15,2) not null default 0 check(cost>=0),
 listed_price numeric(15,2) not null default 0 check(listed_price>=0),
 status text not null default 'disponible' check(status in('disponible','reservado','vendido','consignacion')),
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create table if not exists public.erp_expenses (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 category text not null default 'Otros',
 description text not null,
 amount numeric(15,2) not null check(amount>0),
 expense_date date not null default current_date,
 method text not null default 'transferencia',
 paid boolean not null default false,
 notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists erp_expenses_month_idx on public.erp_expenses(account_id,expense_date desc);

create table if not exists public.erp_deliveries (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null unique,
 status text not null default 'pendiente' check(status in('pendiente','documentacion','credito','vehiculo','programada','entregada','cancelada')),
 planned_at date,
 delivered_at date,
 notes text,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);

create table if not exists public.erp_audit_log (
 id bigserial primary key,
 account_id uuid not null,
 entity text not null,
 entity_id uuid not null,
 action text not null,
 actor_id uuid,
 old_data jsonb,
 new_data jsonb,
 created_at timestamptz not null default now()
);
create index if not exists erp_audit_account_idx on public.erp_audit_log(account_id,created_at desc);

create or replace function public.erp_log_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous jsonb; upcoming jsonb; row_id uuid; acc_id uuid;
begin
  if TG_OP='INSERT' then upcoming=to_jsonb(NEW); row_id=NEW.id; acc_id=NEW.account_id;
  elsif TG_OP='UPDATE' then previous=to_jsonb(OLD); upcoming=to_jsonb(NEW); row_id=NEW.id; acc_id=NEW.account_id;
  else previous=to_jsonb(OLD); row_id=OLD.id; acc_id=OLD.account_id; end if;
  insert into public.erp_audit_log(account_id,entity,entity_id,action,actor_id,old_data,new_data)
  values(acc_id,TG_TABLE_NAME,row_id,TG_OP,(select auth.uid()),previous,upcoming);
  return coalesce(NEW,OLD);
end $$;
revoke all on function public.erp_log_changes() from public;
do $$declare tab text; begin
  foreach tab in array array['erp_customers','erp_sales','erp_installments','erp_payments','erp_documents','erp_followups','erp_inventory','erp_expenses','erp_deliveries'] loop
    execute format('create trigger erp_audit_%I after insert or update or delete on public.%I for each row execute function public.erp_log_changes()', tab,tab);
  end loop;
end $$;

-- New sales and the installment schedule are created together, never half-saved.
create or replace function public.erp_create_sale(p_account uuid,p_customer uuid,p_values jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare myrole text; assigned uuid; sale uuid; n integer; charge numeric(15,2);
        firstdate date; i integer; vtype text; otype text; client_agent uuid;
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
 firstdate:=nullif(p_values->>'first_due','')::date;
 if n<0 or n>72 or (n>0 and (charge<=0 or firstdate is null)) or (n=0 and charge<>0) then raise exception 'Plan de cuotas inválido'; end if;
 if length(trim(coalesce(p_values->>'vehicle_description','')))<2 then raise exception 'Vehículo requerido'; end if;
 insert into public.erp_sales(account_id,customer_id,agent_id,vehicle_description,vehicle_type,operation_type,
 price,initial_amount,admin_fee,installment_amount,installment_count,first_due,delivery_target_installment,
 notes,created_by,crm_conversation_id,whatsapp_chat_id)
 values(p_account,p_customer,assigned,left(p_values->>'vehicle_description',200),vtype,otype,
 coalesce((p_values->>'price')::numeric,0),coalesce((p_values->>'initial_amount')::numeric,0),
 coalesce((p_values->>'admin_fee')::numeric,0),charge,n,firstdate,
 coalesce((p_values->>'delivery_target_installment')::integer,4),
 left(coalesce(p_values->>'notes',''),3000),(select auth.uid()),
 nullif(p_values->>'crm_conversation_id','')::uuid,nullif(p_values->>'whatsapp_chat_id',''))
 returning id into sale;
 if n>0 then
   for i in 1..n loop
     insert into public.erp_installments(account_id,sale_id,installment_number,due_date,amount)
     values(p_account,sale,i,(firstdate+(i-1)*interval '1 month')::date,charge);
   end loop;
 end if;
 return sale;
end $$;
revoke all on function public.erp_create_sale(uuid,uuid,jsonb) from public;
grant execute on function public.erp_create_sale(uuid,uuid,jsonb) to authenticated;

create or replace function public.erp_change_stage(p_sale uuid,p_stage text)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; role text;
begin
 select account_id,agent_id into s from public.erp_sales where id=p_sale;
 if not found then raise exception 'Operación inexistente'; end if;
 role:=public.erp_role(s.account_id);
 if not (role in ('propietario','administracion') or (role='vendedor' and s.agent_id=(select auth.uid()))) then raise exception 'No autorizado'; end if;
 if p_stage not in('nuevo','contactado','interesado','documentacion','pactado','activo','no_interesado','caido') then
   raise exception 'La etapa de entrega se gestiona desde administración';
 end if;
 update public.erp_sales set stage=p_stage,updated_at=now() where id=p_sale;
end $$;
revoke all on function public.erp_change_stage(uuid,text) from public;
grant execute on function public.erp_change_stage(uuid,text) to authenticated;

-- RLS: the ERP never inherits loose CRM policies. Account + assignment always checked.
do $$declare t text;begin
 foreach t in array array['erp_memberships','erp_customers','erp_sales','erp_installments','erp_payments','erp_documents','erp_followups','erp_inventory','erp_expenses','erp_deliveries','erp_audit_log'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from anon',t);
   execute format('grant select,insert,update on public.%I to authenticated',t);
 end loop;
end $$;
grant usage,select on sequence public.erp_audit_log_id_seq to authenticated;

create policy "erp_memberships_read" on public.erp_memberships for select to authenticated
 using(user_id=(select auth.uid()) or public.erp_is_admin(account_id));
create policy "erp_memberships_add_owner" on public.erp_memberships for insert to authenticated
 with check(public.erp_role(account_id)='propietario');
create policy "erp_memberships_update_owner" on public.erp_memberships for update to authenticated
 using(public.erp_role(account_id)='propietario')
 with check(public.erp_role(account_id)='propietario');

create policy "erp_customers_read" on public.erp_customers for select to authenticated
 using(public.erp_can_access_customer(id));
create policy "erp_customers_add" on public.erp_customers for insert to authenticated
 with check(created_by=(select auth.uid()) and (public.erp_is_admin(account_id)
   or (public.erp_role(account_id)='vendedor' and agent_id=(select auth.uid()))));
create policy "erp_customers_edit" on public.erp_customers for update to authenticated
 using(public.erp_can_access_customer(id))
 with check(public.erp_is_admin(account_id) or
 (public.erp_role(account_id)='vendedor' and agent_id=(select auth.uid())));

create policy "erp_sales_read" on public.erp_sales for select to authenticated
 using(public.erp_can_access_sale(id));
create policy "erp_sales_add" on public.erp_sales for insert to authenticated
 with check(created_by=(select auth.uid()) and public.erp_can_access_customer(customer_id)
 and (public.erp_is_admin(account_id) or
 (public.erp_role(account_id)='vendedor' and agent_id=(select auth.uid()))));
create policy "erp_sales_admin_update" on public.erp_sales for update to authenticated
 using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy "erp_installments_read" on public.erp_installments for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create policy "erp_installments_admin_add" on public.erp_installments for insert to authenticated
 with check(public.erp_is_admin(account_id));

create policy "erp_payments_read" on public.erp_payments for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create policy "erp_payments_pending_add" on public.erp_payments for insert to authenticated
 with check(status='pendiente' and created_by=(select auth.uid()) and public.erp_can_access_sale(sale_id));
create policy "erp_payments_admin_review" on public.erp_payments for update to authenticated
 using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy "erp_documents_read" on public.erp_documents for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create policy "erp_documents_add" on public.erp_documents for insert to authenticated
 with check(created_by=(select auth.uid()) and public.erp_can_access_sale(sale_id));

create policy "erp_followups_read" on public.erp_followups for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create policy "erp_followups_add" on public.erp_followups for insert to authenticated
 with check(created_by=(select auth.uid()) and public.erp_can_access_sale(sale_id));

create policy "erp_inventory_read" on public.erp_inventory for select to authenticated
 using(public.erp_role(account_id) in('propietario','administracion','vendedor'));
create policy "erp_inventory_add" on public.erp_inventory for insert to authenticated
 with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy "erp_inventory_edit" on public.erp_inventory for update to authenticated
 using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy "erp_expenses_admin_read" on public.erp_expenses for select to authenticated
 using(public.erp_is_admin(account_id));
create policy "erp_expenses_admin_add" on public.erp_expenses for insert to authenticated
 with check(public.erp_is_admin(account_id) and created_by=(select auth.uid()));
create policy "erp_expenses_admin_edit" on public.erp_expenses for update to authenticated
 using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy "erp_deliveries_read" on public.erp_deliveries for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create policy "erp_deliveries_admin_add" on public.erp_deliveries for insert to authenticated
 with check(public.erp_is_admin(account_id) and updated_by=(select auth.uid()));
create policy "erp_deliveries_admin_edit" on public.erp_deliveries for update to authenticated
 using(public.erp_is_admin(account_id)) with check(public.erp_is_admin(account_id));

create policy "erp_audit_admin_read" on public.erp_audit_log for select to authenticated
 using(public.erp_is_admin(account_id));

-- Only the sale's assigned agent (or ERP administration) can access its objects.
create or replace function public.erp_can_access_storage_path(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare a text; s text;
begin
 a:=split_part(p_path,'/',1); s:=split_part(p_path,'/',2);
 if a !~ '^[0-9a-f-]{36}$' or s !~ '^[0-9a-f-]{36}$' or length(split_part(p_path,'/',3))<2 then return false; end if;
 return exists(select 1 from public.erp_sales x where x.id=s::uuid and x.account_id=a::uuid and public.erp_can_access_sale(x.id));
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.erp_can_access_storage_path(text) from public;
grant execute on function public.erp_can_access_storage_path(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('erp-comprobantes','erp-comprobantes',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create policy "erp_private_files_read" on storage.objects for select to authenticated
 using(bucket_id='erp-comprobantes' and public.erp_can_access_storage_path(name));
create policy "erp_private_files_add" on storage.objects for insert to authenticated
 with check(bucket_id='erp-comprobantes' and public.erp_can_access_storage_path(name) and owner_id=(select auth.uid())::text);
