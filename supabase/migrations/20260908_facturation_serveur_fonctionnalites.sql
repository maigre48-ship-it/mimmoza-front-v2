-- =============================================================================
-- Facturation côté SERVEUR des fonctionnalités payantes
-- =============================================================================
--
-- Le problème
-- -----------
-- Le débit des jetons vivait à 100 % dans le navigateur. Aucune des Edge
-- Functions coûteuses ne consultait le solde : un grep de
-- `credit_accounts|spend_credits|current_credits` sur les 145 fonctions ne
-- renvoyait qu'une occurrence, dans la purge RGPD.
--
-- Conséquence : n'importe quel porteur d'un JWT valide pouvait appeler
-- directement `facade-ai-render`, `rendu-travaux-v1`, `analyze-rehab-plan`,
-- `transcribe-rehab-plan`, `export-report-v1` ou `stream-estate-ingest-v1` et
-- consommer sans limite, à zéro jeton. Le paywall n'était qu'un affichage.
--
-- Ce que cette migration apporte
-- ------------------------------
-- Deux fonctions de mouvement utilisables UNIQUEMENT par les Edge Functions,
-- c'est-à-dire en `service_role` :
--
--   · feature_spend_credits  — débite un utilisateur désigné ;
--   · feature_refund_credits — lui rend ses jetons si le travail a échoué.
--
-- Pourquoi de NOUVELLES fonctions plutôt que `spend_credits` :
-- `spend_credits` s'appuie sur `auth.uid()`, donc débite forcément l'appelant.
-- Une Edge Function agit pour le compte d'un utilisateur qu'elle a authentifié
-- elle-même : il lui faut passer l'identifiant explicitement.
--
-- Pourquoi le garde `service_role` est INDISPENSABLE sur le remboursement :
-- une fonction de crédit exposée à un utilisateur authentifié serait une
-- machine à fabriquer des jetons — il suffirait de l'appeler en boucle depuis
-- le navigateur. Le garde est donc vérifié AVANT toute écriture, et les deux
-- fonctions le portent (le débit par symétrie, pour qu'aucune ne devienne un
-- point d'entrée client par inadvertance).
-- =============================================================================

-- Vrai si l'appelant présente un JWT de service_role (Edge Function), faux pour
-- un utilisateur authentifié normal. Isolé dans une fonction pour que les deux
-- mouvements partagent exactement la même définition du privilège.
create or replace function public.est_appel_service_role()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Deux critères, et non un seul.
  --
  -- Ce projet est sur JWT Signing Keys : une clé secrète moderne (sb_secret_…)
  -- n'est PAS un JWT, PostgREST peut donc ne poser aucun `request.jwt.claims`.
  -- Ne tester que les claims aurait refusé les appels légitimes des Edge
  -- Functions — soit TOUS les débits serveur, en erreur 500.
  --
  -- Le second critère lit le rôle Postgres effectif, positionné par PostgREST
  -- via SET LOCAL ROLE. Ce GUC n'est pas affecté par SECURITY DEFINER (qui
  -- change current_user, pas le rôle demandé). Vérifié : false sous
  -- `authenticated`, true sous `service_role`.
  select
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or coalesce(current_setting('role', true), '') = 'service_role';
$function$;

comment on function public.est_appel_service_role() is
  'Vrai si l''appelant est une Edge Function (service_role). Sert de garde aux mouvements de jetons initiés par le serveur.';


-- ── Débit initié par le serveur ─────────────────────────────────────────────
create or replace function public.feature_spend_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_description text default null,
  p_type        text default 'feature'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
begin
  if not est_appel_service_role() then
    raise exception 'FORBIDDEN_CLIENT_CALL';
  end if;

  if p_user_id is null then
    raise exception 'MISSING_USER';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select current_credits into v_balance
  from credit_accounts
  where user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'NO_ACCOUNT';
  end if;

  if v_balance < p_amount then
    raise exception 'NO_TOKENS';
  end if;

  update credit_accounts
  set current_credits = current_credits - p_amount,
      updated_at      = now()
  where user_id = p_user_id;

  insert into credit_transactions (user_id, type, amount, description)
  values (p_user_id, p_type, -p_amount, p_description);

  return v_balance - p_amount;
end;
$function$;

comment on function public.feature_spend_credits(uuid, integer, text, text) is
  'Débite les jetons d''un utilisateur pour une fonctionnalité payante. Réservé aux Edge Functions (service_role) : le client ne peut pas l''appeler.';


-- ── Remboursement initié par le serveur ─────────────────────────────────────
-- Appelé quand le travail facturé a échoué APRÈS le débit. Sans lui, il ne
-- resterait que le choix entre facturer une erreur ou ne pas facturer du tout.
create or replace function public.feature_refund_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_description text default null,
  p_type        text default 'feature_refund'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
begin
  if not est_appel_service_role() then
    raise exception 'FORBIDDEN_CLIENT_CALL';
  end if;

  if p_user_id is null then
    raise exception 'MISSING_USER';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select current_credits into v_balance
  from credit_accounts
  where user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'NO_ACCOUNT';
  end if;

  update credit_accounts
  set current_credits = current_credits + p_amount,
      updated_at      = now()
  where user_id = p_user_id;

  insert into credit_transactions (user_id, type, amount, description)
  values (p_user_id, p_type, p_amount, p_description);

  return v_balance + p_amount;
end;
$function$;

comment on function public.feature_refund_credits(uuid, integer, text, text) is
  'Rend des jetons après l''échec d''une fonctionnalité déjà débitée. Réservé aux Edge Functions (service_role) : exposée au client, elle fabriquerait des jetons.';


-- Second verrou, en plus du garde interne.
--
-- ⚠️ Il faut révoquer à PUBLIC, pas à anon/authenticated nommément : toute
-- fonction reçoit à sa création un GRANT EXECUTE à PUBLIC, dont ces deux rôles
-- héritent. Un `revoke ... from anon, authenticated` ne retire que les grants
-- nominatifs et laisse donc l'accès ouvert — vérifié avec
-- has_function_privilege() : le premier essai n'avait rien fermé.
revoke execute on function public.feature_spend_credits(uuid, integer, text, text) from public;
revoke execute on function public.feature_refund_credits(uuid, integer, text, text) from public;

grant execute on function public.feature_spend_credits(uuid, integer, text, text) to service_role;
grant execute on function public.feature_refund_credits(uuid, integer, text, text) to service_role;
