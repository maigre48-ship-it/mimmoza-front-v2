-- ============================================================================
-- Facturation — deux fonctions SECURITY DEFINER créditaient n'importe qui.
-- Appliqué en production le 2026-08-04.
--
-- Trouvé en inventoriant les fonctions du point 10, pas en le cherchant.
--
-- Une douzaine de fonctions DEFINER de ce schéma reçoivent `p_user_id` en
-- paramètre, tournent avec les droits de `postgres`, et ne vérifient jamais que
-- l'appelant est bien cet utilisateur. Toutes sont exécutables par `anon` et
-- `authenticated`, donc atteignables avec la clé publique du bundle.
--
-- Figer le `search_path` ne change rien à cela : il ne s'agit pas d'une
-- escalade détournée, mais d'une autorisation absente.
--
-- Ce fichier ne traite que les deux qui touchent à l'argent. Les autres sont
-- listées en fin de fichier.
-- ============================================================================


-- ── 1. purchase_credit_pack(p_user_id, p_pack_id) ───────────────────────────
--
-- Créditait `credit_accounts` du contenu du pack et inscrivait une transaction.
-- Aucune vérification de paiement, aucune d'identité : un appel = des crédits,
-- autant de fois qu'on veut, pour qui on veut.
--
-- Le front ne l'appelle nulle part (grep de `.rpc(` sur src/). Un achat de pack
-- doit de toute façon partir d'un webhook Stripe, jamais du navigateur.
-- Fermée au seul service_role.

revoke execute on function public.purchase_credit_pack(uuid, uuid) from anon, authenticated, public;
grant  execute on function public.purchase_credit_pack(uuid, uuid) to service_role;

comment on function public.purchase_credit_pack(uuid, uuid) is
  'service_role uniquement — crédite sans vérifier le paiement. Ne jamais rouvrir à anon/authenticated.';


-- ── 2. apply_token_ledger_entry(p_user_id, p_direction, p_amount, …) ────────
--
-- Même trou sur `billing_profiles.token_balance`. Le paramètre
-- `p_is_admin_action` n'était pas un contrôle : c'est une colonne du ledger,
-- que l'appelant remplissait lui-même.
--
-- Celle-ci, le front l'appelle (src/lib/billing/tokenLedger.ts). On ne pouvait
-- pas la fermer : `debitTokensForFeature` doit rester utilisable depuis le
-- navigateur. Mais les trois chemins de *crédit* du même module — achat de
-- pack, octroi d'abonnement, ajustement admin — sont des opérations de webhook
-- ou d'administration qui n'ont rien à faire côté client. Aucun des trois n'est
-- d'ailleurs appelé aujourd'hui : ils sont exportés, pas branchés.
--
-- Règle retenue : depuis une session utilisateur, on ne peut que se débiter
-- soi-même. Créditer, ou toucher au compte d'un tiers, exige le service_role.
--
-- `p_user_id` reste dans la signature pour ne pas casser les appels existants,
-- mais il est ignoré pour un appelant non privilégié : l'utilisateur est dérivé
-- de `auth.uid()`. Une fonction qui accepte poliment un paramètre qu'elle
-- n'utilise plus vaut mieux qu'une signature cassée en production.
--
-- Le DROP est imposé par Postgres : CREATE OR REPLACE refuse de retirer les
-- valeurs par défaut d'une fonction existante. Elles sont reconduites à
-- l'identique.

drop function if exists public.apply_token_ledger_entry(uuid, text, integer, text, text, text, jsonb, boolean);

create function public.apply_token_ledger_entry(
  p_user_id         uuid,
  p_direction       text,
  p_amount          integer,
  p_reason          text,
  p_feature_code    text    default null,
  p_source_ref      text    default null,
  p_metadata        jsonb   default '{}'::jsonb,
  p_is_admin_action boolean default false
)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_current_balance integer;
  v_new_balance     integer;
  v_entry_id        uuid;
  v_caller          uuid    := auth.uid();
  v_privilegie      boolean := coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''
    ) = 'service_role';
  v_cible           uuid;
  v_admin           boolean;
begin
  -- ── Autorisation ──────────────────────────────────────────────────────────
  if v_privilegie then
    v_cible := p_user_id;
    v_admin := coalesce(p_is_admin_action, false);
  else
    if v_caller is null then
      raise exception 'NON_AUTHENTIFIE';
    end if;
    if p_user_id is not null and p_user_id <> v_caller then
      raise exception 'INTERDIT: mouvement sur le compte d''un tiers';
    end if;
    if p_direction <> 'debit' then
      raise exception 'INTERDIT: un credit ne part pas du client';
    end if;
    v_cible := v_caller;
    -- Un appelant non privilégié ne se déclare pas admin.
    v_admin := false;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'montant invalide: %', p_amount;
  end if;

  -- ── Mouvement (inchangé) ──────────────────────────────────────────────────
  select token_balance into v_current_balance
  from billing_profiles
  where user_id = v_cible
  for update;

  if not found then
    raise exception 'billing_profile introuvable pour user_id=%', v_cible;
  end if;

  if p_direction = 'credit' then
    v_new_balance := v_current_balance + p_amount;
  elsif p_direction = 'debit' then
    if v_current_balance < p_amount then
      raise exception 'solde insuffisant: % < %', v_current_balance, p_amount;
    end if;
    v_new_balance := v_current_balance - p_amount;
  else
    raise exception 'direction invalide: %', p_direction;
  end if;

  update billing_profiles
  set token_balance = v_new_balance,
      updated_at    = now()
  where user_id = v_cible;

  insert into token_ledger (
    user_id, direction, amount, balance_after,
    reason, feature_code, source_ref, metadata, is_admin_action
  ) values (
    v_cible, p_direction, p_amount, v_new_balance,
    p_reason, p_feature_code, p_source_ref, p_metadata, v_admin
  )
  returning id into v_entry_id;

  return json_build_object(
    'id',            v_entry_id,
    'user_id',       v_cible,
    'direction',     p_direction,
    'amount',        p_amount,
    'balance_after', v_new_balance,
    'reason',        p_reason
  );
end;
$fn$;

revoke execute on function public.apply_token_ledger_entry(uuid, text, integer, text, text, text, jsonb, boolean) from anon, public;
grant  execute on function public.apply_token_ledger_entry(uuid, text, integer, text, text, text, jsonb, boolean) to authenticated, service_role;

comment on function public.apply_token_ledger_entry(uuid, text, integer, text, text, text, jsonb, boolean) is
  'Depuis une session utilisateur : debit de soi-meme uniquement, p_user_id ignore au profit de auth.uid(). Credit et action sur un tiers reserves au service_role.';


-- ============================================================================
-- RESTE À TRAITER — même défaut, pas d'argent en jeu
--
-- Ces fonctions sont SECURITY DEFINER, exécutables par anon et authenticated,
-- et font confiance à un `p_user_id` fourni par l'appelant. Elles donnent
-- lecture ou écriture sur les données d'autrui.
--
--   Appelées par le front (src/hooks/useSmartScoreHooks.ts) — à réécrire sur
--   auth.uid(), pas à révoquer :
--     get_unread_alerts(p_user_id, p_limit)
--     count_unread_alerts(p_user_id)
--     mark_alerts_read(p_user_id, p_alert_ids)
--     dismiss_alert(p_user_id, p_alert_id)
--     get_user_weights(p_user_id, p_space, p_project_nature)
--     save_user_weights(p_user_id, p_space, …)
--
--   Non appelées par le front — à fermer au service_role après vérification
--   des Edge Functions :
--     save_smartscore_history(…, p_user_id)
--     increment_api_usage(p_key_id, …)
--     banque_dossier_patch_v1(p_id, p_market_data, …)   ← la surcharge à 4
--       arguments ne vérifie rien ; celle à 5 lit bien auth.uid()
--     convert_quote_to_invoice(p_quote_id)
--     batch_update_sourcing_scores(p_updates)
--     archive_old_sourcing_items(p_days_old)
--     reset_sourcing_item_for_rescoring(p_item_id)
--     update_sourcing_item_score(p_item_id, p_score_json)
-- ============================================================================


-- ============================================================================
-- VÉRIFICATION
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('purchase_credit_pack', 'apply_token_ledger_entry');
--   -- attendu : purchase_credit_pack      anon=f auth=f
--   --           apply_token_ledger_entry  anon=f auth=t
--
-- À retester côté front : toute page qui débite des jetons (consommation d'une
-- feature) doit continuer de fonctionner à l'identique pour un utilisateur
-- connecté.
-- ============================================================================
