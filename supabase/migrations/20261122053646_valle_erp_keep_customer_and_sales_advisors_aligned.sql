
create or replace function public.erp_validate_customer_advisor() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.erp_memberships m
   where m.account_id=NEW.account_id and m.user_id=NEW.agent_id
     and m.erp_role in('propietario','administracion','vendedor')) then
   raise exception 'El asesor no pertenece al ERP de esta cuenta';
 end if;
 return NEW;
end $$;
revoke all on function public.erp_validate_customer_advisor() from public;
create trigger erp_customer_valid_advisor
before insert or update of agent_id,account_id on public.erp_customers
for each row execute function public.erp_validate_customer_advisor();

create or replace function public.erp_validate_sale_advisor() returns trigger
language plpgsql security definer set search_path='' as $$
declare customer_agent uuid;
begin
 select c.agent_id into customer_agent from public.erp_customers c
 where c.id=NEW.customer_id and c.account_id=NEW.account_id;
 if customer_agent is null or customer_agent<>NEW.agent_id then
   raise exception 'La operación debe estar asignada al asesor responsable del cliente';
 end if;
 return NEW;
end $$;
revoke all on function public.erp_validate_sale_advisor() from public;
create trigger erp_sale_matching_advisor
before insert or update of agent_id,customer_id,account_id on public.erp_sales
for each row execute function public.erp_validate_sale_advisor();

create or replace function public.erp_transfer_customer_sales() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if NEW.agent_id is distinct from OLD.agent_id then
  update public.erp_sales set agent_id=NEW.agent_id,updated_at=now()
  where customer_id=NEW.id and account_id=NEW.account_id;
 end if;
 return NEW;
end $$;
revoke all on function public.erp_transfer_customer_sales() from public;
create trigger erp_customer_advisor_transfer
after update of agent_id on public.erp_customers
for each row execute function public.erp_transfer_customer_sales();
