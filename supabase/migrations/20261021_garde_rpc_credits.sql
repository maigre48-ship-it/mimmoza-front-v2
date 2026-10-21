-- =============================================================================
-- Audit du 21/10/2026 — P0 n°1 : gardes sur les RPC de débit/crédit de jetons
-- =============================================================================
--
-- Le problème
-- -----------
-- `spend_credits(p_amount)` est appelée depuis le navigateur
-- (src/lib/billing/projectUnlock.ts, src/spaces/marchand/services/dealUnlock.ts).
-- Elle ne contrôlait pas le signe du montant : avec p_amount = -1000, la ligne
--     update credit_accounts set current_credits = current_credits - p_amount
-- CRÉDITAIT 1 000 jetons au compte. Une simple requête depuis la console du
-- navigateur suffisait.
--
-- `unlock_project(p_validity_days)` laissait le client choisir la fenêtre de
-- validité : p_validity_days = 100000 rendait un déverrouillage éternel pour
-- 1 jeton.
--
-- Ce que fait cette migration (rejouable, sans perte de données)
-- --------------------------------------------------------------
--   1. spend_credits     : même corps qu'en 20260908_versionnage_rpc_credits_existantes,
--                          + refus de p_amount null ou <= 0 (INVALID_AMOUNT).
--   2. unlock_project    : même corps, fenêtre de validité FIXÉE côté serveur
--                          à 30 jours (le paramètre client est conservé dans la
--                          signature pour ne rien casser, mais plafonné à 30).
--   3. decrement_user_tokens et admin_adjust_copilot_credits : définitions
--      absentes du dépôt (créées à la main en production). On ne peut pas les
--      réécrire sans les connaître : on les ENVELOPPE. La fonction d'origine est
--      renommée en <nom>__origine (accès retiré à tous sauf service_role) et une
--      enveloppe de même nom et même signature vérifie les gardes avant de
--      l'appeler. Si la fonction n'existe pas, rien n'est fait.
--   4. Fonctions réservées au serveur (copilot_reserve_credits,
--      copilot_refund_credits, copilot_settle_credits, purchase_credit_pack,
--      feature_spend_credits, feature_refund_credits) : EXECUTE retiré à
--      public/anon/authenticated, accordé à service_role. Toutes leurs
--      surcharges sont traitées.
--   5. Fonctions de débit appelées par le client (spend_credits,
--      unlock_project, decrement_user_tokens, apply_token_ledger_entry,
--      debloquer_apporteur_deal) : EXECUTE retiré à PUBLIC et à anon,
--      accordé à authenticated et service_role.
--
-- Rappel : toute fonction reçoit à sa création un GRANT EXECUTE à PUBLIC dont
-- anon hérite. Il faut donc révoquer à PUBLIC, pas seulement à anon.
-- =============================================================================


-- ── 1. spend_credits : refus des montants nuls ou négatifs ──────────────────
create or replace function public.spend_credits(
  p_amount      integer,
  p_description text default null,
  p_type        text default 'analysis'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_balance int;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- AJOUT 21/10/2026 : un montant négatif créditait le compte.
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select current_credits into v_balance
  from credit_accounts
  where user_id = v_user
  for update;

  if v_balance is null then
    raise exception 'NO_ACCOUNT';
  end if;

  -- Administrateur actif : rien n'est prélevé, le solde est renvoyé tel quel.
  if exists (
    select 1 from admin_users
    where user_id = v_user and is_active = true
  ) then
    return v_balance;
  end if;

  if v_balance < p_amount then
    raise exception 'NO_TOKENS';
  end if;

  update credit_accounts
  set current_credits = current_credits - p_amount
  where user_id = v_user;

  insert into credit_transactions (user_id, type, amount, description)
  values (v_user, p_type, -p_amount, p_description);

  return v_balance - p_amount;
end;
$function$;


-- ── 2. unlock_project : fenêtre de validité fixée par le serveur ────────────
create or replace function public.unlock_project(
  p_space          text,
  p_project_id     text,
  p_label          text default null,
  p_validity_days  integer default 30
)
returns table(already_unlocked boolean, new_balance integer, ledger_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_account_id uuid;
  v_ledger text;
  v_recent_unlock timestamptz;
  -- AJOUT 21/10/2026 : le client ne choisit plus la durée. Valeur plafonnée
  -- à 30 jours (et au moins 1) quoi qu'il envoie.
  v_validity_days integer := least(greatest(coalesce(p_validity_days, 30), 1), 30);
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_space is null or p_project_id is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Deja deverrouille ET encore valide (dans la fenetre de validite) ?
  select unlocked_at into v_recent_unlock
  from public.project_unlocks
  where user_id = v_user_id and space = p_space and project_id = p_project_id
    and unlocked_at > now() - make_interval(days => v_validity_days)
  order by unlocked_at desc
  limit 1;

  if v_recent_unlock is not null then
    select current_credits into v_credits
    from public.credit_accounts where user_id = v_user_id;
    return query select true, coalesce(v_credits, 0), null::text;
    return;
  end if;

  -- Verrouille la ligne du compte (anti race condition)
  select id, current_credits into v_account_id, v_credits
  from public.credit_accounts
  where user_id = v_user_id
  for update;

  if v_account_id is null or coalesce(v_credits, 0) < 1 then
    raise exception 'NO_TOKENS';
  end if;

  update public.credit_accounts
  set current_credits = current_credits - 1, updated_at = now()
  where id = v_account_id;

  v_ledger := 'tok_unlock_' || extract(epoch from now())::bigint;

  insert into public.credit_transactions (user_id, amount, type, description, created_at)
  values (v_user_id, -1, 'project_unlock',
          'Deverrouillage ' || p_space || ' : ' || coalesce(p_label, p_project_id), now());

  insert into public.project_unlocks (user_id, space, project_id, ledger_id, unlocked_at)
  values (v_user_id, p_space, p_project_id, v_ledger, now());

  return query select false, (v_credits - 1), v_ledger;
end;
$function$;


-- ── 3. Enveloppes de garde pour les fonctions non versionnées ───────────────
-- Fonctions de garde (lèvent une exception si l'appel est refusé).

-- decrement_user_tokens(p_user_id, p_amount) : appelée par le navigateur
-- (src/lib/access/consumption.ts). Garde : montant > 0 ET, hors service_role,
-- l'utilisateur ne peut débiter que lui-même.
create or replace function public._garde_decrement_user_tokens(p_user_id uuid, p_amount integer)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if public.est_appel_service_role() then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN_OTHER_USER';
  end if;
end;
$function$;

-- admin_adjust_copilot_credits(p_user_id, p_delta, p_reason) : appelée par la
-- page d'administration. Sa version documentée (adminCopilot.ts) ne vérifie
-- AUCUN rôle : tout utilisateur connecté pouvait se créditer. Garde : admin
-- actif (admin_users) ou service_role.
create or replace function public._garde_admin_uniquement()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if public.est_appel_service_role() then
    return;
  end if;
  if auth.uid() is null or not exists (
    select 1 from admin_users where user_id = auth.uid() and is_active = true
  ) then
    raise exception 'FORBIDDEN_ADMIN_ONLY';
  end if;
end;
$function$;

revoke execute on function public._garde_decrement_user_tokens(uuid, integer) from public, anon;
grant  execute on function public._garde_decrement_user_tokens(uuid, integer) to authenticated, service_role;
revoke execute on function public._garde_admin_uniquement() from public, anon;
grant  execute on function public._garde_admin_uniquement() to authenticated, service_role;

-- Enveloppement générique : renomme <nom>(args) en <nom>__origine et recrée
-- <nom> avec la même signature (valeurs par défaut comprises) et le même type
-- de retour, en SQL : appel de la garde puis délégation à l'origine.
-- Idempotent : si <nom>__origine existe déjà, l'enveloppe est déjà en place.
do $$
declare
  r record;
  v_oid oid;
  v_args text;      -- arguments avec valeurs par défaut (pour CREATE)
  v_ident text;     -- types seuls (pour REVOKE/GRANT)
  v_result text;
  v_call text;
  v_garde text;
begin
  for r in
    select * from (values
      ('decrement_user_tokens',        'select public._garde_decrement_user_tokens($1::uuid, $2::integer);'),
      ('admin_adjust_copilot_credits', 'select public._garde_admin_uniquement();')
    ) as t(nom, garde)
  loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = r.nom || '__origine') then
      raise notice '% : enveloppe déjà en place, rien à faire', r.nom;
      continue;
    end if;

    select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.nom
    limit 1;

    if v_oid is null then
      raise notice '% : fonction absente, rien à faire', r.nom;
      continue;
    end if;

    v_args   := pg_get_function_arguments(v_oid);
    v_ident  := pg_get_function_identity_arguments(v_oid);
    v_result := pg_get_function_result(v_oid);

    -- Liste $1, $2, … pour la délégation.
    select string_agg('$' || i, ', ' order by i) into v_call
    from generate_series(1, (select pronargs from pg_proc where oid = v_oid)) as i;

    execute format('alter function public.%I(%s) rename to %I', r.nom, v_ident, r.nom || '__origine');
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated',
                   r.nom || '__origine', v_ident);
    execute format('grant execute on function public.%I(%s) to service_role',
                   r.nom || '__origine', v_ident);

    -- L'enveloppe est SECURITY DEFINER pour pouvoir appeler __origine
    -- (désormais fermée aux clients) ; auth.uid() reste celui de l'appelant.
    v_garde := r.garde;
    execute format($f$
      create function public.%I(%s)
      returns %s
      language sql
      security definer
      set search_path to 'public'
      as $body$
        %s
        select * from public.%I(%s);
      $body$
    $f$, r.nom, v_args, v_result, v_garde, r.nom || '__origine', coalesce(v_call, ''));

    execute format('revoke execute on function public.%I(%s) from public, anon', r.nom, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.nom, v_ident);
    raise notice '% : enveloppe de garde installée', r.nom;
  end loop;
end
$$;


-- ── 4. Fonctions réservées au serveur : fermées aux clients ─────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'copilot_reserve_credits', 'copilot_refund_credits', 'copilot_settle_credits',
        'purchase_credit_pack', 'feature_spend_credits', 'feature_refund_credits'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    raise notice 'serveur uniquement : %', r.sig;
  end loop;
end
$$;


-- ── 5. Fonctions de débit côté client : jamais pour anon ────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'spend_credits', 'unlock_project', 'decrement_user_tokens',
        'apply_token_ledger_entry', 'debloquer_apporteur_deal',
        'admin_adjust_copilot_credits'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    raise notice 'authenticated uniquement : %', r.sig;
  end loop;
end
$$;


-- =============================================================================
-- VÉRIFICATION (à exécuter après application, dans l'éditeur SQL)
-- =============================================================================
-- 1) Droits effectifs : anon doit être à false partout ; authenticated à false
--    pour les fonctions serveur (reserve/refund/settle/purchase/feature_*).
--
-- select p.oid::regprocedure as fonction,
--        has_function_privilege('anon',          p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('service_role',  p.oid, 'execute') as service_role
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname ~ '(credit|token|unlock|spend|refund|settle|reserve|debloquer|purchase)'
-- order by 1;
--
-- 2) Le montant négatif est refusé (doit lever INVALID_AMOUNT), en tant
--    qu'utilisateur connecté depuis le navigateur :
--    await supabase.rpc('spend_credits', { p_amount: -10 })
--
-- 3) Relire le corps des fonctions non versionnées, pour les verser au dépôt :
-- select pg_get_functiondef('public.debloquer_apporteur_deal'::regproc);
-- select pg_get_functiondef('public.decrement_user_tokens__origine'::regproc);
-- select pg_get_functiondef('public.admin_adjust_copilot_credits__origine'::regproc);
-- =============================================================================
