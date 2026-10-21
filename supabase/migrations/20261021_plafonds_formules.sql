-- =============================================================================
-- 21/10/2026 — Plafonds des formules APPLIQUÉS PAR LE SERVEUR
-- =============================================================================
-- À appliquer APRÈS 20261021_analyse_rapide_gratuite.sql.
--
-- 1. Analyses rapides incluses chaque mois, selon la formule active lue dans
--    billing_profiles (plan_code + subscription_status) :
--       Découverte (basique, free, sans abonnement actif) : 3
--       Indépendant (avance)                              : 100
--       Pro (pro)                                         : 300
--       Équipe (proplus)                                  : 1 000
--    Au-delà : debit_quick_analysis (10 jetons, inchangé).
--    = ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE (src/lib/billing/grille.ts).
--
-- 2. Mimmo en Découverte : 10 messages offerts par mois
--    (consume_copilot_free_message, appelée par copilot-chat avec la clé de
--    service). Au-delà : réservation de jetons classique.
--    = MESSAGES_MIMMO_DECOUVERTE_MOIS (grille.ts).
--
-- Rejouable.
-- =============================================================================

-- ── Formule active d'un compte, normalisée ──────────────────────────────────
create or replace function public.formule_active(p_user uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
           when bp.subscription_status in ('active', 'trialing')
                and lower(coalesce(bp.plan_code, '')) in ('avance', 'advanced', 'starter') then 'avance'
           when bp.subscription_status in ('active', 'trialing')
                and lower(coalesce(bp.plan_code, '')) = 'pro' then 'pro'
           when bp.subscription_status in ('active', 'trialing')
                and lower(coalesce(bp.plan_code, '')) = 'proplus' then 'proplus'
           else 'basique'
         end
  from (select 1) x
  left join billing_profiles bp on bp.user_id = p_user;
$function$;

revoke execute on function public.formule_active(uuid) from public, anon, authenticated;
grant  execute on function public.formule_active(uuid) to service_role;


-- ── 1. Analyses rapides incluses selon la formule ───────────────────────────
-- Retour : {"accorde": bool, "restantes": int, "quota": int, "formule": text, "ticket": uuid|null}
create or replace function public.consume_free_quick_analysis()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user    uuid := auth.uid();
  v_formule text;
  v_quota   integer;
  v_mois    date := date_trunc('month', now() at time zone 'utc')::date;
  v_nb      integer;
  v_ticket  uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_formule := public.formule_active(v_user);
  v_quota := case v_formule
               when 'avance'  then 100
               when 'pro'     then 300
               when 'proplus' then 1000
               else 3
             end;

  insert into free_quick_analysis_usage (user_id, mois, nb)
  values (v_user, v_mois, 0)
  on conflict (user_id, mois) do nothing;

  select nb into v_nb
  from free_quick_analysis_usage
  where user_id = v_user and mois = v_mois
  for update;

  if v_nb >= v_quota then
    return jsonb_build_object('accorde', false, 'restantes', 0, 'quota', v_quota,
                              'formule', v_formule, 'ticket', null);
  end if;

  update free_quick_analysis_usage
  set nb = nb + 1, updated_at = now()
  where user_id = v_user and mois = v_mois;

  insert into quick_analysis_tickets (user_id, source, montant, libelle)
  values (v_user, 'gratuit', 0, 'Analyse rapide incluse (' || v_formule || ')')
  returning id into v_ticket;

  return jsonb_build_object(
    'accorde', true,
    'restantes', v_quota - (v_nb + 1),
    'quota', v_quota,
    'formule', v_formule,
    'ticket', v_ticket
  );
end;
$function$;

revoke execute on function public.consume_free_quick_analysis() from public, anon;
grant  execute on function public.consume_free_quick_analysis() to authenticated, service_role;

comment on table public.free_quick_analysis_usage is
  'Analyses rapides incluses consommées par compte et par mois (quota selon la formule : 3 / 100 / 300 / 1000). Écrite uniquement par les RPC security definer.';


-- ── 2. Messages Mimmo offerts en Découverte ─────────────────────────────────
create table if not exists public.copilot_free_message_usage (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mois       date not null,
  nb         integer not null default 0 check (nb >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, mois)
);

comment on table public.copilot_free_message_usage is
  'Messages Mimmo offerts consommés par mois (formule Découverte : 10). Écrite uniquement par consume_copilot_free_message (clé de service).';

alter table public.copilot_free_message_usage enable row level security;

drop policy if exists "lecture de son quota de messages Mimmo" on public.copilot_free_message_usage;
create policy "lecture de son quota de messages Mimmo"
  on public.copilot_free_message_usage for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.copilot_free_message_usage from anon;
revoke insert, update, delete on public.copilot_free_message_usage from authenticated;
grant select on public.copilot_free_message_usage to authenticated;

-- Retour : {"accorde": bool, "restants": int, "quota": int}
create or replace function public.consume_copilot_free_message(p_user_id uuid, p_quota integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mois  date := date_trunc('month', now() at time zone 'utc')::date;
  v_quota integer := least(greatest(coalesce(p_quota, 10), 0), 10);  -- jamais plus de 10
  v_nb    integer;
begin
  if p_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into copilot_free_message_usage (user_id, mois, nb)
  values (p_user_id, v_mois, 0)
  on conflict (user_id, mois) do nothing;

  select nb into v_nb
  from copilot_free_message_usage
  where user_id = p_user_id and mois = v_mois
  for update;

  if v_nb >= v_quota then
    return jsonb_build_object('accorde', false, 'restants', 0, 'quota', v_quota);
  end if;

  update copilot_free_message_usage
  set nb = nb + 1, updated_at = now()
  where user_id = p_user_id and mois = v_mois;

  return jsonb_build_object('accorde', true, 'restants', v_quota - (v_nb + 1), 'quota', v_quota);
end;
$function$;

-- Appelée seulement par copilot-chat (clé de service) : un client ne peut pas
-- s'attribuer de messages.
revoke execute on function public.consume_copilot_free_message(uuid, integer) from public, anon, authenticated;
grant  execute on function public.consume_copilot_free_message(uuid, integer) to service_role;

-- =============================================================================
-- VÉRIFICATION
-- select public.formule_active(user_id), count(*) from billing_profiles group by 1;
-- select * from public.copilot_free_message_usage order by updated_at desc limit 20;
-- =============================================================================
