-- Pagos distribuidos entre múltiples cuotas sin perder su referencia común
create table public.erp_payment_batches (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 sale_id uuid not null,
 total numeric(15,2) not null check(total>0),
 paid_at date not null,
 method text not null check(method in('transferencia','efectivo','tarjeta','deposito','otro')),
 reference text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(id,sale_id),
 foreign key(sale_id,account_id) references public.erp_sales(id,account_id)
);
alter table public.erp_payments add column batch_id uuid;
alter table public.erp_payments add constraint erp_payment_batch_sale_fk
 foreign key(batch_id,sale_id) references public.erp_payment_batches(id,sale_id);
alter table public.erp_documents add column batch_id uuid;
alter table public.erp_documents add constraint erp_document_batch_sale_fk
 foreign key(batch_id,sale_id) references public.erp_payment_batches(id,sale_id);
create index erp_payment_batches_sale on public.erp_payment_batches(account_id,sale_id,created_at desc);
create index erp_payments_batch on public.erp_payments(batch_id);
alter table public.erp_payment_batches enable row level security;
revoke all on public.erp_payment_batches from anon,authenticated;
grant select on public.erp_payment_batches to authenticated;
create policy erp_payment_batches_read on public.erp_payment_batches for select to authenticated
 using(public.erp_can_access_sale(sale_id));
create trigger erp_payment_batches_audit after insert or update or delete on public.erp_payment_batches
for each row execute function public.erp_log_changes();

create or replace function public.erp_record_multi_payment(
 p_account uuid,p_sale uuid,p_allocations jsonb,p_paid_at date,p_method text,p_reference text)
returns uuid language plpgsql security definer set search_path='' as $$
declare seller_id uuid; bucket uuid; line jsonb; quota uuid; value numeric(15,2);
        total numeric(15,2):=0; num_items integer; num_unique integer;
begin
 if not public.erp_can_access_sale(p_sale) then raise exception 'No autorizado para registrar pagos';end if;
 select agent_id into seller_id from public.erp_sales where id=p_sale and account_id=p_account;
 if not found then raise exception 'Operación incorrecta';end if;
 if jsonb_typeof(p_allocations)<>'array' or p_paid_at is null
    or p_method not in('transferencia','efectivo','tarjeta','deposito','otro') then
   raise exception 'Comprobante de pago inválido';
 end if;
 num_items:=jsonb_array_length(p_allocations);
 if num_items=0 or num_items>72 then raise exception 'Ingresá entre 1 y 72 cuotas';end if;
 select count(distinct entry->>'installment_id') into num_unique from jsonb_array_elements(p_allocations) entry;
 if num_items<>num_unique then raise exception 'No repitas la misma cuota';end if;
 for line in select value from jsonb_array_elements(p_allocations) as t(value) loop
   quota:=(line->>'installment_id')::uuid;
   value:=(line->>'amount')::numeric;
   if value is null or value<=0 or value>9999999999999 then raise exception 'Monto inválido';end if;
   if not exists(select 1 from public.erp_installments where id=quota and sale_id=p_sale and account_id=p_account)
   then raise exception 'Cuota ajena a la venta';end if;
   total:=total+value;
 end loop;
 insert into public.erp_payment_batches(account_id,sale_id,total,paid_at,method,reference,created_by)
 values(p_account,p_sale,total,p_paid_at,p_method,left(p_reference,200),(select auth.uid()))
 returning id into bucket;
 for line in select value from jsonb_array_elements(p_allocations) as t(value) loop
   insert into public.erp_payments(account_id,sale_id,installment_id,batch_id,amount,paid_at,method,reference,created_by,status)
   values(p_account,p_sale,(line->>'installment_id')::uuid,bucket,(line->>'amount')::numeric,
      p_paid_at,p_method,left(p_reference,200),(select auth.uid()),'pendiente');
 end loop;
 return bucket;
end; $$;
revoke all on function public.erp_record_multi_payment(uuid,uuid,jsonb,date,text,text) from public;
grant execute on function public.erp_record_multi_payment(uuid,uuid,jsonb,date,text,text) to authenticated;
