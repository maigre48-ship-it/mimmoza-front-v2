-- =============================================================================
-- PUB-AI-1 — Quota journalier de l'IA du Studio (Edge Function `studio-ai`)
-- =============================================================================
--
-- Pourquoi un quota EN PLUS des jetons
-- ------------------------------------
-- Les jetons bornent ce qu'un compte peut dépenser, pas ce que la plateforme
-- paie au fournisseur : les administrateurs sont exemptés de débit
-- (`estAdministrateur` dans _shared/billing/featureBilling.ts), et un compte
-- bien approvisionné — ou compromis — peut enchaîner les appels. Le quota est
-- un plafond en NOMBRE d'appels, indépendant du solde, qui vaut pour tout le
-- monde, administrateurs compris.
--
-- Deux plafonds, décidés ici et jamais par l'appelant :
--   · par utilisateur et par jour (défaut 5) ;
--   · global, tous utilisateurs confondus, par jour (défaut 20).
--
-- Le jour est celui de Paris. Une réservation n'est PAS rendue si le
-- fournisseur échoue ensuite : une tentative ratée compte, ce qui borne aussi
-- les rafales de relances.
--
-- Dépend de `est_appel_service_role()`
-- (20260908_facturation_serveur_fonctionnalites.sql).
-- Rejouable. Non appliquée à ce stade.
-- =============================================================================

-- ── Plafonds ────────────────────────────────────────────────────────────────
-- Ligne unique : relever un plafond est un UPDATE en service_role, sans
-- redéployer la fonction ni rejouer de migration.
create table if not exists public.studio_ai_quota_config (
  id             boolean primary key default true check (id),
  per_user_daily integer not null default 5  check (per_user_daily >= 0),
  global_daily   integer not null default 20 check (global_daily >= 0),
  updated_at     timestamptz not null default now()
);

insert into public.studio_ai_quota_config (id) values (true)
on conflict (id) do nothing;

-- ── Compteurs ───────────────────────────────────────────────────────────────
create table if not exists public.studio_ai_daily_usage (
  usage_date date        not null,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  action     text        not null check (action in ('plan', 'plan-image')),
  calls      integer     not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_date, user_id, action)
);

-- Tables privées : RLS activée SANS aucune policy, donc fermées à anon et
-- authenticated ; les privilèges de table leur sont retirés en second verrou.
-- Seul service_role (qui contourne la RLS) et la fonction ci-dessous y accèdent.
alter table public.studio_ai_quota_config enable row level security;
alter table public.studio_ai_daily_usage  enable row level security;

revoke all on table public.studio_ai_quota_config from public, anon, authenticated;
revoke all on table public.studio_ai_daily_usage  from public, anon, authenticated;

grant select, insert, update, delete on table public.studio_ai_quota_config to service_role;
grant select, insert, update, delete on table public.studio_ai_daily_usage  to service_role;

comment on table public.studio_ai_daily_usage is
  'Nombre d''appels à l''IA du Studio par jour (Paris), utilisateur et action. Privée : service_role uniquement.';
comment on table public.studio_ai_quota_config is
  'Plafonds journaliers de l''IA du Studio (ligne unique). Privée : service_role uniquement.';


-- ── Réservation atomique ────────────────────────────────────────────────────
-- Vérifie les deux plafonds et compte l'appel dans la MÊME transaction, sous un
-- verrou consultatif : sans lui, deux requêtes simultanées liraient le même
-- total et passeraient toutes les deux sous le plafond. Le verrou est global
-- (et non par utilisateur) parce que le plafond global doit être exact lui
-- aussi ; la section protégée ne fait que quelques lectures indexées.
--
-- Retourne toujours un objet :
--   { "allowed": true,  "user_count": n, "user_limit": m }
--   { "allowed": false, "reason": "USER_DAILY_LIMIT" | "GLOBAL_DAILY_LIMIT" }
-- Le total global n'est jamais renvoyé : il n'a pas à sortir de la base.
create or replace function public.studio_reserve_ai_usage(
  p_user_id uuid,
  p_action  text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_jour        date := (now() at time zone 'Europe/Paris')::date;
  v_user_limit  integer;
  v_global_limit integer;
  v_user_count  integer;
  v_global_count integer;
begin
  if not est_appel_service_role() then
    raise exception 'FORBIDDEN_CLIENT_CALL';
  end if;

  if p_user_id is null then
    raise exception 'MISSING_USER';
  end if;

  if p_action is null or p_action not in ('plan', 'plan-image') then
    raise exception 'INVALID_ACTION';
  end if;

  -- Tenu jusqu'à la fin de la transaction, donc relâché même en cas d'erreur.
  perform pg_advisory_xact_lock(hashtextextended('studio_ai_daily_usage', 0));

  select per_user_daily, global_daily
    into v_user_limit, v_global_limit
  from studio_ai_quota_config
  where id;

  -- Ligne de configuration absente : on retombe sur les défauts conservateurs,
  -- pas sur « illimité ».
  v_user_limit   := coalesce(v_user_limit, 5);
  v_global_limit := coalesce(v_global_limit, 20);

  select coalesce(sum(calls), 0),
         coalesce(sum(calls) filter (where user_id = p_user_id), 0)
    into v_global_count, v_user_count
  from studio_ai_daily_usage
  where usage_date = v_jour;

  if v_user_count >= v_user_limit then
    return jsonb_build_object('allowed', false, 'reason', 'USER_DAILY_LIMIT');
  end if;

  if v_global_count >= v_global_limit then
    return jsonb_build_object('allowed', false, 'reason', 'GLOBAL_DAILY_LIMIT');
  end if;

  insert into studio_ai_daily_usage (usage_date, user_id, action, calls)
  values (v_jour, p_user_id, p_action, 1)
  on conflict (usage_date, user_id, action)
  do update set calls = studio_ai_daily_usage.calls + 1, updated_at = now();

  -- Les compteurs ne servent que pour le jour courant : on ne garde pas un
  -- historique d'usage nominatif au-delà de 90 jours.
  delete from studio_ai_daily_usage where usage_date < v_jour - 90;

  return jsonb_build_object(
    'allowed', true,
    'user_count', v_user_count + 1,
    'user_limit', v_user_limit
  );
end;
$function$;

comment on function public.studio_reserve_ai_usage(uuid, text) is
  'Réserve un appel à l''IA du Studio sous plafond journalier par utilisateur et global. Atomique. Réservé aux Edge Functions (service_role).';

-- Révoquer à PUBLIC et non à anon/authenticated nommément : voir la note de
-- 20260908_facturation_serveur_fonctionnalites.sql. Les deux rôles sont cités
-- en plus, pour couvrir aussi d'éventuels grants nominatifs par défaut.
revoke execute on function public.studio_reserve_ai_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.studio_reserve_ai_usage(uuid, text) to service_role;
