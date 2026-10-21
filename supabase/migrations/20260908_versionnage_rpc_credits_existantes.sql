-- =============================================================================
-- Versionnage des RPC de crédits déjà en production
-- =============================================================================
--
-- Ces deux fonctions existent en base depuis longtemps mais n'étaient dans
-- AUCUNE migration : le dépôt ne permettait pas de reconstruire la base, et
-- personne ne pouvait relire leur logique de facturation sans se connecter à
-- Postgres. Ce fichier n'introduit aucun changement de comportement — il fige
-- l'état constaté le 2026-09-08, à l'identique.
--
-- Elles sont conservées telles quelles : `spend_credits` et `unlock_project`
-- s'appuient sur `auth.uid()` et sont donc appelées PAR LE CLIENT, pour des
-- débits que le client est légitime à déclencher pour lui-même. Les
-- fonctionnalités serveur, elles, passent par `feature_spend_credits`
-- (migration 20260908_facturation_serveur_fonctionnalites).
-- =============================================================================

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

  select current_credits into v_balance
  from credit_accounts
  where user_id = v_user
  for update;

  if v_balance is null then
    raise exception 'NO_ACCOUNT';
  end if;

  -- Administrateur actif : rien n'est prélevé, le solde est renvoyé tel quel.
  --
  -- Portée ici plutôt que dans chaque écran : le débit serveur
  -- (feature_spend_credits) exempte déjà les administrateurs, alors que les
  -- chemins front — scan d'opportunités, analyse rapide, déverrouillage de deal
  -- — les facturaient. Répéter le test dans les composants aurait garanti d'en
  -- oublier un.
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
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Deja deverrouille ET encore valide (dans la fenetre de validite) ?
  select unlocked_at into v_recent_unlock
  from public.project_unlocks
  where user_id = v_user_id and space = p_space and project_id = p_project_id
    and unlocked_at > now() - make_interval(days => p_validity_days)
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

  -- Nouvelle ligne d'unlock (on ne reutilise pas l'ancienne expiree -> historique propre)
  insert into public.project_unlocks (user_id, space, project_id, ledger_id, unlocked_at)
  values (v_user_id, p_space, p_project_id, v_ledger, now());

  return query select false, (v_credits - 1), v_ledger;
end;
$function$;
