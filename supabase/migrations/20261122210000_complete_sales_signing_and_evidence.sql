-- Ventas completas por solicitud y firma electrónica de un solo uso.
-- El contrato enviado se conserva como snapshot inmutable de la solicitud y las cláusulas.
begin;

create table if not exists public.erp_contract_settings (
 account_id uuid primary key references public.accounts(id) on delete cascade,
 company_name text not null default 'VALLE AUTOMOTORES S.A.S.',
 company_cuit text not null default '',
 company_address text not null default '',
 representative text not null default '',
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 constraint erp_contract_settings_company_valid check (length(company_name) between 3 and 150)
);
alter table public.erp_contract_settings enable row level security;
revoke all on public.erp_contract_settings from anon;
grant select,insert,update on public.erp_contract_settings to authenticated;
create policy erp_contract_settings_read on public.erp_contract_settings for select to authenticated
 using (public.erp_role(account_id) in ('propietario','administracion','vendedor'));
create policy erp_contract_settings_insert on public.erp_contract_settings for insert to authenticated
 with check (public.erp_is_admin(account_id) and updated_by=(select auth.uid()));
create policy erp_contract_settings_update on public.erp_contract_settings for update to authenticated
 using (public.erp_is_admin(account_id))
 with check (public.erp_is_admin(account_id) and updated_by=(select auth.uid()));

create table if not exists public.erp_signing_requests (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 sale_id uuid not null,
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pendiente' check (status in ('pendiente','firmado','revocado')),
 expires_at timestamptz not null,
 snapshot_text text not null check (length(snapshot_text)>500),
 snapshot_data jsonb not null,
 snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 issued_by uuid not null references auth.users(id),
 issued_at timestamptz not null default now(),
 signed_at timestamptz,
 signer_name text,
 signer_document text,
 signature_path text,
 selfie_path text,
 signature_sha256 text,
 selfie_sha256 text,
 evidence_sha256 text,
 signer_ip text,
 signer_user_agent text,
 consent_data boolean not null default false,
 consent_contract boolean not null default false,
 consent_marketing boolean not null default false,
 constraint erp_signing_requests_sale_account_fk foreign key(sale_id,account_id)
   references public.erp_sales(id,account_id) on delete cascade,
 constraint erp_signing_requests_signed_complete check (
  status <> 'firmado' or (signed_at is not null and signature_path is not null and
   selfie_path is not null and evidence_sha256 is not null and consent_data and consent_contract)
 )
);
create index if not exists erp_signing_requests_sale_idx on public.erp_signing_requests(sale_id,issued_at desc);
create unique index if not exists erp_signing_one_pending_sale on public.erp_signing_requests(sale_id)
 where status='pendiente';
alter table public.erp_signing_requests enable row level security;
revoke all on public.erp_signing_requests from public,anon,authenticated;
grant select on public.erp_signing_requests to authenticated;
create policy erp_signing_requests_read on public.erp_signing_requests for select to authenticated
 using (public.erp_can_access_sale(sale_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('erp-firmas','erp-firmas',false,8388608,array['image/png','image/jpeg','image/webp'])
 on conflict (id) do update set public=false,file_size_limit=8388608,
 allowed_mime_types=array['image/png','image/jpeg','image/webp'];
-- Sin políticas de SELECT/INSERT para anon o authenticated: solo servidor service_role.

-- Una sola transacción crea (si hace falta) cliente, venta, cuotas y solicitud.
create or replace function public.erp_create_complete_sale(
 p_account uuid,p_customer uuid,p_values jsonb,p_application jsonb
) returns uuid language plpgsql security definer set search_path to ''
as $function$
declare who uuid; myrole text; agent uuid; customer uuid; sale uuid;
        vname text; vphone text; vdni text;
begin
 who:=(select auth.uid());
 if who is null then raise exception 'Sesión requerida'; end if;
 myrole:=public.erp_role(p_account);
 if myrole not in ('propietario','administracion','vendedor') or myrole is null
 then raise exception 'Sin permisos de ventas'; end if;
 if jsonb_typeof(p_application)<>'object' then raise exception 'Solicitud inválida'; end if;
 vname:=trim(coalesce(p_application->>'full_name',''));
 vphone:=trim(coalesce(p_application->>'phone',''));
 vdni:=regexp_replace(coalesce(p_application->>'dni',''),'[^0-9]','','g');
 if length(vname)<3 or length(vphone)<6 or length(vdni)<7 or length(vdni)>11
 then raise exception 'Nombre, teléfono y DNI del cliente son obligatorios'; end if;
 agent:=coalesce(nullif(p_values->>'agent_id','')::uuid,who);
 if myrole='vendedor' and agent<>who then raise exception 'Solo podés asignar tus propias ventas'; end if;
 if myrole in ('propietario','administracion') and not exists(
   select 1 from public.erp_memberships where account_id=p_account and user_id=agent
     and erp_role in ('propietario','administracion','vendedor'))
 then raise exception 'Asesor no habilitado'; end if;
 if p_customer is null then
  insert into public.erp_customers(account_id,agent_id,full_name,phone,document_number,email,address,city,province,created_by)
  values(p_account,agent,vname,vphone,vdni,nullif(p_application->>'email',''),
  nullif(p_application->>'address',''),nullif(p_application->>'city',''),
  coalesce(nullif(p_application->>'province',''),'Río Negro'),who)
  returning id into customer;
 else
  select id into customer from public.erp_customers where id=p_customer and account_id=p_account
     and (public.erp_is_admin(p_account) or agent_id=who) for update;
  if not found then raise exception 'Cliente inaccesible'; end if;
  if myrole='vendedor' and not exists(select 1 from public.erp_customers where id=customer and agent_id=who)
  then raise exception 'Cliente de otro asesor'; end if;
  update public.erp_customers set full_name=vname,phone=vphone,document_number=vdni,
   email=nullif(p_application->>'email',''),address=nullif(p_application->>'address',''),
   city=nullif(p_application->>'city',''),province=coalesce(nullif(p_application->>'province',''),'Río Negro'),
   updated_at=now() where id=customer;
 end if;
 sale:=public.erp_create_sale(p_account,customer,p_values);
 insert into public.erp_sale_applications(sale_id,account_id,data,updated_by)
 values(sale,p_account,p_application,who);
 return sale;
end $function$;
revoke all on function public.erp_create_complete_sale(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.erp_create_complete_sale(uuid,uuid,jsonb,jsonb) to authenticated;

-- Edición de venta reservada a Administración. Un contrato firmado o cobros impiden
-- alterar retrospectivamente sus importes y vencimientos.
create or replace function public.erp_admin_update_complete_sale(
 p_sale uuid,p_values jsonb,p_application jsonb
) returns void language plpgsql security definer set search_path to ''
as $function$
declare s record; who uuid; i record; charge numeric; fee numeric; entree date; second date;
        vtype text; otype text; name text; phone text; dni text;
begin
 who:=(select auth.uid());
 select * into s from public.erp_sales where id=p_sale for update;
 if not found then raise exception 'Venta inexistente'; end if;
 if not public.erp_is_admin(s.account_id) then raise exception 'Solo Administración puede modificar ventas'; end if;
 if exists(select 1 from public.erp_signing_requests where sale_id=p_sale and status='firmado')
 then raise exception 'Contrato ya firmado: no se pueden alterar sus condiciones'; end if;
 if exists(select 1 from public.erp_payments where sale_id=p_sale)
 then raise exception 'La venta tiene pagos registrados: no se pueden alterar cuotas ni importes'; end if;
 update public.erp_signing_requests set status='revocado' where sale_id=p_sale and status='pendiente';
 if jsonb_typeof(p_application)<>'object' then raise exception 'Solicitud inválida'; end if;
 name:=trim(coalesce(p_application->>'full_name',''));
 phone:=trim(coalesce(p_application->>'phone',''));
 dni:=regexp_replace(coalesce(p_application->>'dni',''),'[^0-9]','','g');
 if length(name)<3 or length(phone)<6 or length(dni)<7
 then raise exception 'Completá nombre, teléfono y DNI'; end if;
 charge:=(p_values->>'installment_amount')::numeric;
 fee:=(p_values->>'admin_fee')::numeric;
 entree:=(p_values->>'entry_date')::date;
 second:=(p_values->>'second_due_date')::date;
 vtype:=coalesce(nullif(p_values->>'vehicle_type',''),s.vehicle_type);
 otype:=coalesce(nullif(p_values->>'operation_type',''),s.operation_type);
 if charge<=0 or fee<0 or entree is null or second is null or second<entree
 then raise exception 'Importes o fechas inválidos'; end if;
 if vtype not in ('auto','camioneta','moto','otro') or otype not in ('financiacion','directa')
 then raise exception 'Tipo o modalidad inválidos'; end if;
 update public.erp_customers set full_name=name,phone=phone,document_number=dni,
  email=nullif(p_application->>'email',''),address=nullif(p_application->>'address',''),
  city=nullif(p_application->>'city',''),province=nullif(p_application->>'province',''),
  updated_at=now() where id=s.customer_id;
 update public.erp_sales set
  vehicle_description=left(coalesce(nullif(trim(p_values->>'vehicle_description'),''),s.vehicle_description),200),
  vehicle_type=vtype,operation_type=otype,price=coalesce((p_values->>'price')::numeric,s.price),
  installment_amount=charge,admin_fee=fee,
  entry_date=entree,first_due=entree,second_due_date=second,
  notes=left(coalesce(p_values->>'notes',''),3000),updated_at=now()
 where id=p_sale;
 update public.erp_installments set amount=case when installment_number=1 then charge+fee else charge end,
  due_date=case when installment_number=1 then entree
   else (second+((installment_number-2) * interval '1 month'))::date end
 where sale_id=p_sale;
 insert into public.erp_sale_applications(account_id,sale_id,data,updated_by,updated_at)
 values(s.account_id,p_sale,p_application,who,now())
 on conflict (sale_id) do update set data=excluded.data,updated_by=excluded.updated_by,updated_at=now();
end $function$;
revoke all on function public.erp_admin_update_complete_sale(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.erp_admin_update_complete_sale(uuid,jsonb,jsonb) to authenticated;
commit;