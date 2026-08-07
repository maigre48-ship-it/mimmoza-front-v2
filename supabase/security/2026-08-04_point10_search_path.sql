-- ============================================================================
-- POINT 10 — figer `search_path` sur les fonctions SECURITY DEFINER.
-- Appliqué en production le 2026-08-04. Rejouable.
--
-- Résultat : 42 fonctions DEFINER au chemin modifiable → 3, toutes à PostGIS.
--
-- ── Pourquoi ────────────────────────────────────────────────────────────────
-- Une fonction DEFINER s'exécute avec les droits de son propriétaire (ici
-- `postgres`). Si son `search_path` reste modifiable, l'appelant peut créer un
-- objet homonyme dans un schéma qu'il contrôle et le faire résoudre en premier :
-- la fonction exécute alors du code choisi par l'appelant, avec les droits du
-- propriétaire. C'est la voie d'escalade classique.
--
-- ── Périmètre, et ce qui en est volontairement exclu ────────────────────────
-- Traitées : les 39 fonctions DEFINER de `public` n'appartenant à aucune
-- extension.
--
-- Écartées : les 3 `st_estimatedextent`, propriété de PostGIS. Une mise à jour
-- de l'extension les réécrirait, et le correctif serait perdu sans bruit.
--
-- Écartées aussi : les 856 fonctions SECURITY INVOKER au chemin modifiable
-- (dont 753 appartiennent à des extensions). Elles s'exécutent avec les droits
-- de l'appelant — il n'y a rien à escalader. L'advisor Supabase les signale
-- toutes indistinctement ; le risque, lui, n'est pas le même. Les compter avec
-- les autres donne un chiffre spectaculaire et une priorité fausse.
--
-- ── Chemin retenu ───────────────────────────────────────────────────────────
-- `public, extensions, pg_temp`.
--   · PostGIS, pg_trgm, unaccent, pg_net vivent dans `public`
--   · pgcrypto et uuid-ossp dans `extensions`
--   · `pg_temp` en dernier, jamais en premier : en tête, il rouvrirait
--     exactement la faille qu'on ferme.
-- ============================================================================

do $$
declare
  f record;
  n_ok int := 0;
begin
  for f in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and (p.proconfig is null or not exists (
            select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format(
      'alter function public.%I(%s) set search_path = public, extensions, pg_temp',
      f.proname, f.args);
    n_ok := n_ok + 1;
  end loop;

  raise notice 'search_path figé sur % fonctions DEFINER', n_ok;
end $$;


-- ============================================================================
-- ⚠️  CE QUE CE PASSAGE A MIS AU JOUR — À TRAITER, PLUS URGENT QUE LE POINT 10
--
-- En inventoriant les fonctions DEFINER, il est apparu qu'une douzaine d'entre
-- elles reçoivent `p_user_id` en paramètre, tournent avec les droits de
-- `postgres`, et ne vérifient jamais que l'appelant est bien cet utilisateur.
-- Elles sont exécutables par `anon` ET `authenticated`.
--
-- Figer le `search_path` ne change rien à ce problème : il ne s'agit pas d'une
-- escalade détournée, mais d'une autorisation absente.
--
-- Les deux plus graves touchent la facturation :
--
--   purchase_credit_pack(p_user_id, p_pack_id)
--     Crédite `credit_accounts` du nombre de crédits du pack et inscrit une
--     transaction. Aucune vérification de paiement, aucune d'identité. Avec la
--     seule clé anon du bundle, on se crédite autant qu'on veut.
--     N'est appelée nulle part dans le front.
--
--   apply_token_ledger_entry(p_user_id, p_direction, p_amount, …)
--     Même chose sur `billing_profiles.token_balance`. Le paramètre
--     `p_is_admin_action` n'est pas un contrôle : c'est une colonne du ledger.
--     Appelée par src/lib/billing/tokenLedger.ts.
--
-- Les autres donnent lecture ou écriture sur les données d'autrui :
--   get_unread_alerts, count_unread_alerts, mark_alerts_read, dismiss_alert,
--   get_user_weights, save_user_weights, save_smartscore_history,
--   increment_api_usage, banque_dossier_patch_v1 (surcharge à 4 arguments),
--   convert_quote_to_invoice, batch_update_sourcing_scores
--
-- La correction n'est pas uniforme :
--   · celles que le front n'appelle pas → révoquer anon et authenticated,
--     les laisser au service_role ;
--   · celles que le front appelle → dériver l'utilisateur de `auth.uid()` au
--     lieu de faire confiance au paramètre, et ne garder `p_user_id` que pour
--     un appel admin explicitement vérifié.
-- ============================================================================
