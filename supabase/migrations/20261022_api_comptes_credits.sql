-- =============================================================================
-- 22/10/2026 — API Mimmoza : comptes et crédits (contrat docs/api/CONTRAT_API.md)
-- =============================================================================
-- Principe : le quota est porté par le COMPTE (utilisateur), plus par la clé.
-- Débit atomique AVANT l'appel (verrou de ligne), remboursement exact si échec.
-- Aucun crédit « à crédit » : solde insuffisant = refus (credits_epuises).
--
-- Contenu :
--  1. table public.api_comptes (un compte par utilisateur) + RLS lecture seule ;
--  2. grille des formules (fonction _api_formule) ;
--  3. création automatique du compte « essai » + plafond de clés actives
--     (déclencheur api_keys_zz_compte_et_plafond, BEFORE INSERT, après
--     api_keys_proteger_quotas dans l'ordre alphabétique) ;
--  4. _api_keys_proteger_quotas adapté : une clé révoquée ne peut plus être
--     réactivée par l'utilisateur (sinon contournement du plafond) ;
--     requests_limit devient INDICATIF = quota mensuel du compte ;
--     api_keys.plan est un champ HÉRITÉ (contrainte starter|pro|enterprise
--     conservée, non utilisé) : la vérité est api_comptes.plan ;
--  5. api_reserver_credits / api_rembourser_credits (service_role),
--     api_mon_compte (authenticated), admin_api_definir_formule (admin) ;
--  6. limitation par minute : fenêtre fixe d'une minute stockée SUR la ligne
--     du compte (debit_minute, debit_compte) déjà verrouillée par la
--     réservation → aucune table de compteurs, rien à purger ;
--  7. remise à zéro mensuelle évoluée (comptes payants, recharges échues,
--     compteurs par clé = statistique mensuelle) ;
--  8. reprise : chaque propriétaire de clé existante reçoit un compte « essai ».
--
-- REJOUABLE : create … if not exists, create or replace, créations
-- conditionnelles dans des blocs DO. Aucun DROP, aucun REVOKE ALL, aucune
-- suppression de données.
-- =============================================================================

-- ── 1. Table des comptes ────────────────────────────────────────────────────
create table if not exists public.api_comptes (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text        not null default 'essai',
  credits_mois       integer     not null default 500,
  credits_utilises   integer     not null default 0,
  credits_recharge   integer     not null default 0,
  recharge_expire_le timestamptz,
  essai_expire_le    timestamptz,
  periode_debut      date        not null default (date_trunc('month', now()))::date,
  rate_limit_min     integer     not null default 10,
  max_cles           integer     not null default 2,
  debit_minute       timestamptz,
  debit_compte       integer     not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.api_comptes is
  'Compte API par utilisateur : formule et soldes de crédits. Écriture réservée au serveur (fonctions security definer).';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.api_comptes'::regclass and conname = 'api_comptes_plan_check') then
    alter table public.api_comptes add constraint api_comptes_plan_check
      check (plan in ('essai', 'starter', 'growth', 'scale'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.api_comptes'::regclass and conname = 'api_comptes_soldes_check') then
    alter table public.api_comptes add constraint api_comptes_soldes_check
      check (credits_mois >= 0
         and credits_utilises >= 0
         and credits_utilises <= credits_mois
         and credits_recharge >= 0
         and debit_compte >= 0
         and rate_limit_min > 0
         and max_cles > 0);
  end if;
end $$;

alter table public.api_comptes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_comptes' and policyname = 'api_comptes_select_own') then
    create policy api_comptes_select_own on public.api_comptes
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- Défense en profondeur : aucune écriture côté client, même si une politique
-- était ajoutée par erreur plus tard.
revoke insert, update, delete, truncate on public.api_comptes from anon, authenticated;
revoke select on public.api_comptes from anon;
grant select on public.api_comptes to authenticated;
grant select, insert, update on public.api_comptes to service_role;

-- ── 2. Grille des formules ──────────────────────────────────────────────────
create or replace function public._api_formule(p_plan text)
returns table (credits_mois integer, rate_limit_min integer, max_cles integer)
language sql
immutable
set search_path = public, pg_temp
as $$
  select v.credits_mois, v.rate_limit_min, v.max_cles
    from (values
      ('essai',      500,   10,   2),
      ('starter',  10000,   60,   5),
      ('growth',   50000,  200,  20),
      ('scale',   250000, 1000, 100)
    ) as v(plan, credits_mois, rate_limit_min, max_cles)
   where v.plan = p_plan;
$$;

revoke execute on function public._api_formule(text) from public, anon, authenticated;

-- Crée le compte « essai » s'il n'existe pas (500 crédits, 30 jours).
create or replace function public._api_compte_assurer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.api_comptes (user_id, plan, credits_mois, credits_utilises,
                                  essai_expire_le, rate_limit_min, max_cles)
  values (p_user_id, 'essai', 500, 0, now() + interval '30 days', 10, 2)
  on conflict (user_id) do nothing;
end;
$$;

revoke execute on function public._api_compte_assurer(uuid) from public, anon, authenticated;

-- ── 3. Déclencheur : compte automatique + plafond de clés actives ──────────
create or replace function public._api_keys_compte_et_plafond()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_compte public.api_comptes%rowtype;
  v_actives integer;
begin
  perform public._api_compte_assurer(new.user_id);

  -- Verrou du compte : sérialise les créations concurrentes de clés.
  select * into v_compte from public.api_comptes where user_id = new.user_id for update;

  if new.revoked_at is null then
    select count(*) into v_actives
      from public.api_keys
     where user_id = new.user_id and revoked_at is null;
    if v_actives >= v_compte.max_cles then
      raise exception 'API_MAX_CLES_ATTEINT: % clé(s) active(s) au maximum pour la formule %',
        v_compte.max_cles, v_compte.plan
        using errcode = 'P0001', hint = 'Révoquez une clé ou changez de formule.';
    end if;
  end if;

  -- requests_limit : purement indicatif, égal au quota mensuel du compte.
  new.requests_limit := v_compte.credits_mois;
  return new;
end;
$$;

revoke execute on function public._api_keys_compte_et_plafond() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.api_keys'::regclass
                    and tgname = 'api_keys_zz_compte_et_plafond') then
    create trigger api_keys_zz_compte_et_plafond
      before insert on public.api_keys
      for each row execute function public._api_keys_compte_et_plafond();
  end if;
end $$;

-- ── 4. Protection des clés (adaptation du déclencheur existant) ────────────
create or replace function public._api_keys_proteger_quotas()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan           := 'starter';   -- champ hérité (contrainte starter|pro|enterprise)
    new.requests_limit := 0;           -- recalculé par api_keys_zz_compte_et_plafond
    new.requests_count := 0;
    new.last_used_at   := null;
    return new;
  end if;

  new.user_id        := old.user_id;
  new.secret_hash    := old.secret_hash;
  new.prefix         := old.prefix;
  new.env            := old.env;
  new.plan           := old.plan;
  new.requests_limit := old.requests_limit;
  new.requests_count := old.requests_count;
  new.last_used_at   := old.last_used_at;
  new.created_at     := old.created_at;
  -- Une clé révoquée le reste (sinon contournement du plafond max_cles).
  if old.revoked_at is not null then
    new.revoked_at := old.revoked_at;
  end if;
  return new;
end;
$$;

comment on function public._api_keys_proteger_quotas() is
  'Empêche un utilisateur de modifier plan, quota, compteur de ses clés API ou de réactiver une clé révoquée (seul le serveur le peut).';

-- ── 5a. Réservation de crédits (service_role) ──────────────────────────────
create or replace function public.api_reserver_credits(p_key_id uuid, p_endpoint text, p_cout integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id    uuid;
  v_c          public.api_comptes%rowtype;
  v_minute     timestamptz := date_trunc('minute', now());
  v_mois_dispo integer;
  v_restant    integer;
  v_src_mois   integer;
  v_src_rech   integer;
begin
  if p_cout is null or p_cout < 0 then
    raise exception 'API_COUT_INVALIDE' using errcode = '22023';
  end if;

  select k.user_id into v_user_id
    from public.api_keys k
   where k.id = p_key_id and k.revoked_at is null;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'raison', 'cle_invalide', 'restant', 0, 'limite', 0);
  end if;

  perform public._api_compte_assurer(v_user_id);
  select * into v_c from public.api_comptes where user_id = v_user_id for update;

  -- Rattrapages paresseux (robustes même si la tâche cron n'a pas tourné).
  if v_c.plan <> 'essai' and v_c.periode_debut < (date_trunc('month', now()))::date then
    v_c.credits_utilises := 0;
    v_c.periode_debut    := (date_trunc('month', now()))::date;
  end if;
  if v_c.credits_recharge > 0 and (v_c.recharge_expire_le is null or v_c.recharge_expire_le <= now()) then
    v_c.credits_recharge   := 0;
    v_c.recharge_expire_le := null;
  end if;

  v_mois_dispo := v_c.credits_mois - v_c.credits_utilises;
  v_restant    := v_mois_dispo + v_c.credits_recharge;

  if v_c.plan = 'essai' and (v_c.essai_expire_le is null or v_c.essai_expire_le <= now()) then
    update public.api_comptes
       set credits_utilises = v_c.credits_utilises, periode_debut = v_c.periode_debut,
           credits_recharge = v_c.credits_recharge, recharge_expire_le = v_c.recharge_expire_le,
           updated_at = now()
     where user_id = v_user_id;
    return jsonb_build_object('ok', false, 'raison', 'essai_expire',
                              'restant', v_restant, 'limite', v_c.credits_mois, 'plan', v_c.plan);
  end if;

  -- Débit par minute (fenêtre fixe, compteur sur la ligne verrouillée).
  if v_c.debit_minute is distinct from v_minute then
    v_c.debit_minute := v_minute;
    v_c.debit_compte := 0;
  end if;
  if v_c.debit_compte >= v_c.rate_limit_min then
    update public.api_comptes
       set credits_utilises = v_c.credits_utilises, periode_debut = v_c.periode_debut,
           credits_recharge = v_c.credits_recharge, recharge_expire_le = v_c.recharge_expire_le,
           updated_at = now()
     where user_id = v_user_id;
    return jsonb_build_object('ok', false, 'raison', 'debit_depasse',
                              'restant', v_restant, 'limite', v_c.credits_mois, 'plan', v_c.plan,
                              'reessayer_dans',
                              greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - clock_timestamp()))))::integer);
  end if;
  v_c.debit_compte := v_c.debit_compte + 1;

  -- Solde : crédits du mois puis crédits de recharge. Jamais de débit partiel.
  if v_restant < p_cout then
    update public.api_comptes
       set credits_utilises = v_c.credits_utilises, periode_debut = v_c.periode_debut,
           credits_recharge = v_c.credits_recharge, recharge_expire_le = v_c.recharge_expire_le,
           debit_minute = v_c.debit_minute, debit_compte = v_c.debit_compte,
           updated_at = now()
     where user_id = v_user_id;
    return jsonb_build_object('ok', false, 'raison', 'credits_epuises',
                              'restant', v_restant, 'limite', v_c.credits_mois, 'plan', v_c.plan);
  end if;

  v_src_mois := least(p_cout, v_mois_dispo);
  v_src_rech := p_cout - v_src_mois;

  update public.api_comptes
     set credits_utilises   = v_c.credits_utilises + v_src_mois,
         credits_recharge   = v_c.credits_recharge - v_src_rech,
         recharge_expire_le = v_c.recharge_expire_le,
         periode_debut      = v_c.periode_debut,
         debit_minute       = v_c.debit_minute,
         debit_compte       = v_c.debit_compte,
         updated_at         = now()
   where user_id = v_user_id;

  -- Statistique par clé (crédits consommés ce mois par la clé).
  update public.api_keys
     set requests_count = requests_count + p_cout,
         last_used_at   = now()
   where id = p_key_id;

  return jsonb_build_object('ok', true,
                            'source_mois', v_src_mois,
                            'source_recharge', v_src_rech,
                            'restant', v_restant - p_cout,
                            'limite', v_c.credits_mois,
                            'plan', v_c.plan);
end;
$$;

revoke execute on function public.api_reserver_credits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.api_reserver_credits(uuid, text, integer) to service_role;

-- ── 5b. Remboursement (service_role) ───────────────────────────────────────
create or replace function public.api_rembourser_credits(p_key_id uuid, p_source_mois integer, p_source_recharge integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_c       public.api_comptes%rowtype;
  v_mois    integer := greatest(coalesce(p_source_mois, 0), 0);
  v_rech    integer := greatest(coalesce(p_source_recharge, 0), 0);
begin
  if v_mois = 0 and v_rech = 0 then
    return;
  end if;

  -- La clé a pu être révoquée entre-temps : on rembourse quand même.
  select k.user_id into v_user_id from public.api_keys k where k.id = p_key_id;
  if v_user_id is null then
    return;
  end if;

  select * into v_c from public.api_comptes where user_id = v_user_id for update;
  if not found then
    return;
  end if;

  update public.api_comptes
     set credits_utilises = greatest(credits_utilises - v_mois, 0),
         -- Recharge échue entre-temps : rien à rendre (elle a expiré).
         credits_recharge = credits_recharge
                            + case when recharge_expire_le is not null and recharge_expire_le > now()
                                   then v_rech else 0 end,
         updated_at       = now()
   where user_id = v_user_id;

  update public.api_keys
     set requests_count = greatest(requests_count - (v_mois + v_rech), 0)
   where id = p_key_id;
end;
$$;

revoke execute on function public.api_rembourser_credits(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.api_rembourser_credits(uuid, integer, integer) to service_role;

-- ── 5c. Mon compte (authenticated) ─────────────────────────────────────────
create or replace function public._api_compte_json(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c         public.api_comptes%rowtype;
  v_utilises  integer;
  v_recharge  integer;
  v_rech_exp  timestamptz;
  v_periode   date;
  v_actives   integer;
begin
  select * into v_c from public.api_comptes where user_id = p_user_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  -- Valeurs effectives (mêmes rattrapages que la réservation, sans écrire).
  v_utilises := v_c.credits_utilises;
  v_periode  := v_c.periode_debut;
  if v_c.plan <> 'essai' and v_c.periode_debut < (date_trunc('month', now()))::date then
    v_utilises := 0;
    v_periode  := (date_trunc('month', now()))::date;
  end if;
  v_recharge := v_c.credits_recharge;
  v_rech_exp := v_c.recharge_expire_le;
  if v_recharge > 0 and (v_rech_exp is null or v_rech_exp <= now()) then
    v_recharge := 0;
    v_rech_exp := null;
  end if;

  select count(*) into v_actives
    from public.api_keys where user_id = p_user_id and revoked_at is null;

  return jsonb_build_object(
    'existe',             true,
    'plan',               v_c.plan,
    'credits_mois',       v_c.credits_mois,
    'credits_utilises',   v_utilises,
    'credits_restants_mois', v_c.credits_mois - v_utilises,
    'credits_recharge',   v_recharge,
    'recharge_expire_le', v_rech_exp,
    'essai_expire_le',    v_c.essai_expire_le,
    'essai_expire',       (v_c.plan = 'essai' and (v_c.essai_expire_le is null or v_c.essai_expire_le <= now())),
    'periode_debut',      v_periode,
    'rate_limit_min',     v_c.rate_limit_min,
    'max_cles',           v_c.max_cles,
    'cles_actives',       v_actives
  );
end;
$$;

revoke execute on function public._api_compte_json(uuid) from public, anon, authenticated;

create or replace function public.api_mon_compte()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NON_AUTHENTIFIE' using errcode = '42501';
  end if;
  return public._api_compte_json(auth.uid());
end;
$$;

revoke execute on function public.api_mon_compte() from public, anon, authenticated;
grant execute on function public.api_mon_compte() to authenticated, service_role;

-- ── 5d. Définir la formule / ajouter une recharge (admin) ──────────────────
create or replace function public.admin_api_definir_formule(p_user_id uuid, p_plan text, p_ajout_recharge integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c     public.api_comptes%rowtype;
  v_plan  text;
  v_f     record;
  v_util  integer;
  v_ajout integer := coalesce(p_ajout_recharge, 0);
begin
  perform public._garde_admin_uniquement();

  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'API_UTILISATEUR_INCONNU' using errcode = '22023';
  end if;
  if v_ajout < 0 then
    raise exception 'API_RECHARGE_NEGATIVE' using errcode = '22023';
  end if;

  perform public._api_compte_assurer(p_user_id);
  select * into v_c from public.api_comptes where user_id = p_user_id for update;

  v_plan := coalesce(p_plan, v_c.plan);
  select * into v_f from public._api_formule(v_plan);
  if not found then
    raise exception 'API_FORMULE_INCONNUE: %', v_plan using errcode = '22023';
  end if;
  if v_plan = 'essai' and v_ajout > 0 then
    raise exception 'API_RECHARGE_RESERVEE_AUX_ABONNES' using errcode = '22023';
  end if;

  -- Normalise la période en cours avant tout calcul.
  v_util := v_c.credits_utilises;
  if v_c.plan <> 'essai' and v_c.periode_debut < (date_trunc('month', now()))::date then
    v_util := 0;
  end if;

  if v_plan = v_c.plan then
    v_util := least(v_util, v_f.credits_mois);
  elsif v_c.plan = 'essai' then
    v_util := 0;                                -- passage essai → payant : mois plein
  elsif v_plan = 'essai' then
    v_util := v_f.credits_mois;                 -- retour en essai : pas de nouvel essai gratuit
  else
    v_util := least(v_util, v_f.credits_mois);  -- payant → payant : on garde la consommation
  end if;

  update public.api_comptes
     set plan               = v_plan,
         credits_mois       = v_f.credits_mois,
         credits_utilises   = v_util,
         rate_limit_min     = v_f.rate_limit_min,
         max_cles           = v_f.max_cles,
         periode_debut      = case when v_plan <> 'essai' and (v_c.plan = 'essai' or v_c.periode_debut < (date_trunc('month', now()))::date)
                                   then (date_trunc('month', now()))::date else periode_debut end,
         essai_expire_le    = case when v_plan = 'essai' then coalesce(essai_expire_le, now()) else essai_expire_le end,
         -- Recharge : valable 12 mois à compter du dernier achat (un seul horizon par compte).
         credits_recharge   = case when recharge_expire_le is null or recharge_expire_le <= now()
                                   then 0 else credits_recharge end + v_ajout,
         recharge_expire_le = case when v_ajout > 0 then now() + interval '12 months'
                                   when recharge_expire_le is not null and recharge_expire_le <= now() then null
                                   else recharge_expire_le end,
         updated_at         = now()
   where user_id = p_user_id;

  -- requests_limit des clés : indicatif = quota mensuel du compte.
  update public.api_keys
     set requests_limit = v_f.credits_mois
   where user_id = p_user_id and requests_limit is distinct from v_f.credits_mois;

  return public._api_compte_json(p_user_id) || jsonb_build_object('user_id', p_user_id);
end;
$$;

revoke execute on function public.admin_api_definir_formule(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.admin_api_definir_formule(uuid, text, integer) to authenticated, service_role;

-- ── 7. Remise à zéro mensuelle (cron existant api-keys-remise-a-zero-mensuelle)
create or replace function public.api_keys_remise_a_zero_mensuelle()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  -- Comptes payants : nouveau mois, crédits du mois non reportés.
  update public.api_comptes
     set credits_utilises = 0,
         periode_debut    = (date_trunc('month', now()))::date,
         updated_at       = now()
   where plan <> 'essai'
     and (credits_utilises <> 0 or periode_debut < (date_trunc('month', now()))::date);
  get diagnostics v_n = row_count;

  -- Recharges échues (12 mois).
  update public.api_comptes
     set credits_recharge   = 0,
         recharge_expire_le = null,
         updated_at         = now()
   where recharge_expire_le is not null
     and recharge_expire_le <= now();

  -- Compteurs par clé : statistique mensuelle (crédits consommés par la clé).
  update public.api_keys
     set requests_count = 0
   where requests_count <> 0;

  return v_n;
end;
$$;

revoke execute on function public.api_keys_remise_a_zero_mensuelle() from public, anon, authenticated;
grant execute on function public.api_keys_remise_a_zero_mensuelle() to service_role;

-- Tâche cron : déjà programmée par 20261022_api_keys_quotas_proteges.sql ;
-- on la (re)programme seulement si elle est absente.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'api-keys-remise-a-zero-mensuelle') then
    perform cron.schedule('api-keys-remise-a-zero-mensuelle', '5 0 1 * *',
                          'select public.api_keys_remise_a_zero_mensuelle()');
  end if;
end $$;

-- ── 8. Reprise de l'existant ───────────────────────────────────────────────
insert into public.api_comptes (user_id, plan, credits_mois, credits_utilises,
                                essai_expire_le, rate_limit_min, max_cles)
select distinct k.user_id, 'essai', 500, 0, now() + interval '30 days', 10, 2
  from public.api_keys k
 where exists (select 1 from auth.users u where u.id = k.user_id)
on conflict (user_id) do nothing;

update public.api_keys k
   set requests_limit = c.credits_mois
  from public.api_comptes c
 where c.user_id = k.user_id
   and k.requests_limit is distinct from c.credits_mois;

-- ── Cache des sources : réservé au serveur ──────────────────────────────────
-- api_cache_get / api_cache_put étaient exécutables par anon et authenticated.
-- Seules les Edge Functions (clé de service) s'en servent.
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('api_cache_get', 'api_cache_put')
  loop
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
  end loop;
end $$;
