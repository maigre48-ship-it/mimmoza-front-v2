-- Bouchon minimal de Supabase pour tester la migration 20261030_agent_autonome.sql
-- sur un PostgreSQL local vierge : rôles, auth.uid(), privilèges par défaut de
-- Supabase, tables de facturation et fonctions copilot_* COPIÉES À L'IDENTIQUE de
-- la production (lues le 30/10/2026), projects, user_ai_preferences, cron/net/vault.
-- NE PAS appliquer en production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to postgres;

-- Comme Supabase : tout est accordé par défaut à anon/authenticated/service_role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists public.projects (id uuid primary key default gen_random_uuid(), name text);
create table if not exists public.credit_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique,
  current_credits integer not null default 0, next_reset_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.copilot_reservations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, amount integer not null,
  status text not null default 'reserved', reason text, conversation_id uuid, message_id uuid,
  created_at timestamptz default now(), settled_at timestamptz, refunded_at timestamptz);
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null,
  amount integer not null, feature_key text, description text, created_at timestamptz default now());
create table if not exists public.user_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  learning_enabled boolean not null default true, updated_at timestamptz not null default now());
alter table public.copilot_reservations enable row level security;
alter table public.user_ai_preferences enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='user_ai_preferences' and policyname='uap_select_own') then
    create policy uap_select_own on public.user_ai_preferences for select using (auth.uid() = user_id);
    create policy uap_insert_own on public.user_ai_preferences for insert with check (auth.uid() = user_id);
    create policy uap_update_own on public.user_ai_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy uap_delete_own on public.user_ai_preferences for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Copies exactes des fonctions de production.
CREATE OR REPLACE FUNCTION public.copilot_reserve_credits(p_user_id uuid, p_amount integer, p_reason text, p_conversation_id uuid)
 RETURNS TABLE(reservation_id uuid, remaining_balance integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_balance int;
  v_res uuid;
begin
  select current_credits into v_balance from credit_accounts where user_id = p_user_id for update;
  if v_balance is null or v_balance < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;
  update credit_accounts set current_credits = current_credits - p_amount where user_id = p_user_id;
  insert into copilot_reservations (user_id, amount, status, reason, conversation_id)
  values (p_user_id, p_amount, 'reserved', p_reason, p_conversation_id)
  returning id into v_res;
  insert into credit_transactions (user_id, type, amount, description)
  values (p_user_id, 'copilot', -p_amount, coalesce(p_reason, 'Copilot'));
  return query select v_res, (v_balance - p_amount);
end $function$;

CREATE OR REPLACE FUNCTION public.copilot_refund_credits(p_user_id uuid, p_reservation_id uuid, p_reason text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_amount int;
begin
  select amount into v_amount from copilot_reservations
  where id = p_reservation_id and user_id = p_user_id and status = 'reserved' for update;
  if v_amount is null then return 0; end if;
  update credit_accounts set current_credits = current_credits + v_amount where user_id = p_user_id;
  update copilot_reservations set status = 'refunded', refunded_at = now() where id = p_reservation_id;
  insert into credit_transactions (user_id, type, amount, description)
  values (p_user_id, 'copilot_refund', v_amount, coalesce(p_reason, 'Remboursement Copilot'));
  return v_amount;
end $function$;

CREATE OR REPLACE FUNCTION public.copilot_settle_credits(p_user_id uuid, p_reservation_id uuid, p_message_id uuid, p_metadata jsonb, p_final_amount integer DEFAULT NULL::integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_reserved int; v_final int; v_delta int;
begin
  select amount into v_reserved from copilot_reservations
  where id = p_reservation_id and user_id = p_user_id and status = 'reserved' for update;
  if v_reserved is null then return; end if;
  v_final := greatest(coalesce(p_final_amount, v_reserved), 1);
  v_delta := v_reserved - v_final;
  update copilot_reservations set status = 'settled', message_id = p_message_id, settled_at = now(), amount = v_final
  where id = p_reservation_id;
  if v_delta <> 0 then
    update credit_accounts set current_credits = current_credits + v_delta where user_id = p_user_id;
    insert into credit_transactions (user_id, type, amount, description)
    values (p_user_id, case when v_delta > 0 then 'copilot_settle_refund' else 'copilot_settle_complement' end, v_delta,
      case when v_delta > 0 then 'Ajustement débit variable Copilot (réservé - réel)'
           else 'Complément de débit Copilot (usage réel supérieur à la réservation)' end);
  end if;
end
$function$;
revoke execute on function public.copilot_reserve_credits(uuid, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.copilot_refund_credits(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.copilot_settle_credits(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;

-- pg_cron / pg_net / Vault (bouchons)
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid::bigint $$;
create schema if not exists net;
create table if not exists net.appels (id serial primary key, url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$ insert into net.appels (url, headers, body) values (url, headers, body) returning id::bigint $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);

do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
end $$;
