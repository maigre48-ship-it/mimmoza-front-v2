-- =============================================================================
-- Audit du 22/10/2026 — Durcissement des fonctions SECURITY DEFINER du schéma public
-- =============================================================================
--
-- Le problème
-- -----------
-- Les advisors Supabase (sécurité) signalaient :
--   · anon_security_definer_function_executable          : 60 fonctions
--   · authenticated_security_definer_function_executable : 74 fonctions
--   · function_search_path_mutable                      : 107 fonctions
-- Une fonction SECURITY DEFINER s'exécute avec les droits de son propriétaire
-- (postgres) et TRAVERSE la RLS. Exposée via /rest/v1/rpc/<nom>, elle n'est
-- protégée que par ce qu'elle vérifie elle-même. Relecture de chaque définition
-- en production (pg_get_functiondef) le 22/10/2026 — failles réelles :
--
--   CRITIQUE — appelables SANS CONNEXION (clé anon du bundle), aucune garde :
--     admin_users_list()          → e-mail, date d'inscription, organisations,
--                                   formules et solde de jetons de TOUS les comptes ;
--     admin_copilot_users()       → e-mail + solde + consommation copilote de tous ;
--     admin_subscriptions_list()  → toutes les organisations, formules, MRR estimé ;
--     admin_copilot_stats()       → agrégats d'usage copilote.
--   ÉLEVÉ — écritures sans garde (anon compris) :
--     convert_quote_to_invoice(uuid)          → émet une facture sur n'importe quel devis accepté ;
--     generate_invoice_number/quote_number()  → consomment la séquence : trous dans la
--                                               numérotation des factures (obligation légale de continuité) ;
--     banque_dossier_upsert_v1(...)           → ON CONFLICT DO UPDATE sans contrôle de
--                                               propriétaire : écrase le dossier d'un autre ;
--     banque_dossier_patch_v1(p_id, p_user_id, …) → p_user_id arbitraire ;
--     increment_api_usage(p_key_id, …, p_cost)    → gonfle le compteur de quota de
--                                                   n'importe quelle clé API ;
--     update_sourcing_item_score / batch_update_sourcing_scores /
--     reset_sourcing_item_for_rescoring / archive_old_sourcing_items
--                                             → modifient le sourcing de tous les utilisateurs ;
--     save_smartscore_history(…, p_user_id)   → empoisonne le benchmark SmartScore.
--   ÉLEVÉ — IDOR (p_user_id jamais comparé à auth.uid()) :
--     get_unread_alerts, count_unread_alerts, mark_alerts_read, dismiss_alert,
--     get_user_weights, save_user_weights.
--   MOYEN — lecture du sourcing de tous les comptes :
--     get_sourcing_items_pending_scoring, get_top_sourcing_items,
--     search_sourcing_items_by_location, get_sourcing_scoring_stats.
--   MOYEN — données DVF/PLU/INSEE lisibles sans connexion (licence DVF) :
--     get_dvf_comps_v1, get_dvf_estimate_v3, get_dvf_market_stats_commune, …
--     Aucune page publique ne les appelle : /analyse-rapide exige une session
--     AVANT tout appel DVF (QuickAnalysisPage.handleRun → aUneSession()).
--
-- Ce que fait cette migration (rejouable, sans perte de données, sans suppression)
-- ------------------------------------------------------------------------
--   0. Nouvelle garde interne _garde_utilisateur_courant(p_user_id).
--   1. (d) Ajout d'une garde dans 13 fonctions — corps de PRODUCTION repris à
--      l'identique, seule la ligne de garde est ajoutée (marquée « AJOUT 22/10/2026 »).
--   2. (b) 19 fonctions réservées au serveur : EXECUTE retiré à public, anon,
--      authenticated ; accordé à service_role.
--   3. (a) 40 fonctions : EXECUTE retiré à public et anon ; accordé
--      explicitement à authenticated et service_role.
--   4. (c) Fonctions laissées en l'état (liste commentée, aucune instruction).
--   5. search_path figé (public, extensions, pg_temp) sur les 107 fonctions
--      signalées, hors fonctions appartenant à une extension.
--   6. Vues matérialisées DVF/SmartScore : lecture retirée à authenticated.
--
-- Rappel : toute fonction reçoit à sa création un GRANT EXECUTE à PUBLIC dont
-- anon et authenticated héritent. Révoquer « anon » seul ne suffit pas : on
-- révoque PUBLIC puis on ré-accorde explicitement ce qui doit rester.
--
-- Les déclencheurs (handle_new_user_credits, org_autoset_owner,
-- promoteur_propagate_stale) continuent de fonctionner : PostgreSQL ne vérifie
-- le privilège EXECUTE d'une fonction trigger qu'au CREATE TRIGGER, jamais au
-- déclenchement. Les fonctions appelées DEPUIS une fonction SECURITY DEFINER
-- sont vérifiées avec les droits du propriétaire (postgres), pas de l'appelant.
-- =============================================================================


-- ── 0. Garde « même utilisateur » ───────────────────────────────────────────
-- Lève une exception si l'appelant n'est pas p_user_id (service_role exempté).
-- Appelée uniquement depuis des fonctions SECURITY DEFINER : fermée aux clients.
create or replace function public._garde_utilisateur_courant(p_user_id uuid)
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
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN_OTHER_USER';
  end if;
end;
$function$;


-- ── 1. (d) Gardes ajoutées — corps de production inchangés par ailleurs ─────

-- 1.1 admin_copilot_stats() — appelée par src/spaces/admin/services/adminCopilot.ts
create or replace function public.admin_copilot_stats()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  -- AJOUT 22/10/2026 : garde administrateur (aucune : exécutable par anon).
  PERFORM public._garde_admin_uniquement();

  RETURN json_build_object(
    'total_credits_available', COALESCE((SELECT SUM(balance) FROM copilot_credits_balance), 0),
    'credits_consumed_30d',    COALESCE((
      SELECT SUM(total_credits) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'active_users_7d',         COALESCE((
      SELECT COUNT(DISTINCT user_id) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    ), 0),
    'quick_calls_30d',         COALESCE((
      SELECT SUM(quick_calls) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'advanced_calls_30d',      COALESCE((
      SELECT SUM(advanced_calls) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'report_calls_30d',        COALESCE((
      SELECT SUM(report_calls) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'tokens_in_30d',           COALESCE((
      SELECT SUM(total_tokens_in) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0),
    'tokens_out_30d',          COALESCE((
      SELECT SUM(total_tokens_out) FROM copilot_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ), 0)
  );
END;
$function$;

-- 1.2 admin_copilot_users() — e-mails + soldes de tous les comptes.
create or replace function public.admin_copilot_users()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  result json;
BEGIN
  -- AJOUT 22/10/2026 : garde administrateur (aucune : exécutable par anon).
  PERFORM public._garde_admin_uniquement();

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      cb.user_id,
      au.email,
      cb.balance,
      COALESCE(u7.total_credits,   0) AS consumed_7d,
      COALESCE(u30.total_credits,  0) AS consumed_30d,
      COALESCE(u30.quick_calls,    0) AS quick_calls_30d,
      COALESCE(u30.advanced_calls, 0) AS advanced_calls_30d,
      conv.last_activity_at,
      COALESCE(conv.conversations_count, 0) AS conversations_count
    FROM copilot_credits_balance cb
    JOIN auth.users au ON au.id = cb.user_id
    LEFT JOIN LATERAL (
      SELECT SUM(total_credits) AS total_credits
      FROM copilot_usage_daily
      WHERE user_id = cb.user_id
        AND date >= CURRENT_DATE - INTERVAL '7 days'
    ) u7 ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(total_credits)  AS total_credits,
        SUM(quick_calls)    AS quick_calls,
        SUM(advanced_calls) AS advanced_calls
      FROM copilot_usage_daily
      WHERE user_id = cb.user_id
        AND date >= CURRENT_DATE - INTERVAL '30 days'
    ) u30 ON true
    LEFT JOIN LATERAL (
      SELECT
        MAX(updated_at) AS last_activity_at,
        COUNT(*)        AS conversations_count
      FROM copilot_conversations
      WHERE user_id = cb.user_id
    ) conv ON true
    ORDER BY cb.balance DESC
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$function$;

-- 1.3 admin_subscriptions_list() — src/spaces/admin/pages/Abonnements.tsx
-- Fonction SQL : la garde est une première instruction (même procédé que
-- l'enveloppe admin_adjust_copilot_credits en production).
create or replace function public.admin_subscriptions_list()
 returns table(organisation_id uuid, organisation_name text, slug text, plan_code text, members_count integer, created_at timestamp with time zone, estimated_mrr_ht numeric)
 language sql
 security definer
 set search_path to 'public'
as $function$
-- AJOUT 22/10/2026 : garde administrateur (aucune : exécutable par anon).
select public._garde_admin_uniquement();

select
  o.id as organisation_id,
  o.name as organisation_name,
  o.slug,
  o.plan_code,
  count(om.id)::integer as members_count,
  o.created_at,
  case
    when o.plan_code = 'starter' then 39.90
    when o.plan_code = 'pro' then 74.99
    when o.plan_code = 'promoteur-starter' then 149.00
    when o.plan_code = 'promoteur-pro' then 299.00
    when o.plan_code = 'promoteur-enterprise' then 799.00
    when o.plan_code = 'financeur-pro' then 299.00
    when o.plan_code = 'financeur-equipe' then 699.00
    when o.plan_code = 'financeur-enterprise' then 1499.00
    else 0
  end as estimated_mrr_ht
from public.organisations o
left join public.organisation_members om
  on om.organisation_id = o.id
group by
  o.id,
  o.name,
  o.slug,
  o.plan_code,
  o.created_at
order by o.created_at desc;
$function$;

-- 1.4 admin_users_list() — src/spaces/admin/pages/Utilisateurs.tsx,
--     src/features/admin/billing/components/ClientPicker.tsx
create or replace function public.admin_users_list()
 returns table(user_id uuid, email text, created_at timestamp with time zone, is_admin boolean, admin_is_active boolean, organisation_names text, organisation_slugs text, plan_codes text, member_roles text, current_credits integer)
 language sql
 security definer
 set search_path to 'public', 'auth'
as $function$
-- AJOUT 22/10/2026 : garde administrateur (aucune : la liste de TOUS les
-- comptes, e-mails compris, était lisible par anon).
select public._garde_admin_uniquement();

select
  u.id as user_id,
  u.email,
  u.created_at,

  (au.user_id is not null) as is_admin,
  coalesce(au.is_active, false) as admin_is_active,

  string_agg(distinct o.name, ' • ') as organisation_names,
  string_agg(distinct o.slug, ' • ') as organisation_slugs,
  string_agg(distinct o.plan_code, ' • ') as plan_codes,
  string_agg(distinct om.role, ' • ') as member_roles,

  coalesce(ca.current_credits,0) as current_credits

from auth.users u

left join public.admin_users au
  on au.user_id = u.id

left join public.organisation_members om
  on om.user_id = u.id

left join public.organisations o
  on o.id = om.organisation_id

left join public.credit_accounts ca
  on ca.user_id = u.id

group by
  u.id,
  u.email,
  u.created_at,
  au.user_id,
  au.is_active,
  ca.current_credits

order by u.created_at desc
$function$;

-- 1.5 generate_invoice_number() / generate_quote_number()
--     src/features/admin/billing/services/{invoices,quotes}.service.ts
create or replace function public.generate_invoice_number()
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  -- AJOUT 22/10/2026 : garde administrateur (anon consommait la séquence).
  perform public._garde_admin_uniquement();

  return 'FAC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
end;
$function$;

create or replace function public.generate_quote_number()
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  -- AJOUT 22/10/2026 : garde administrateur (anon consommait la séquence).
  perform public._garde_admin_uniquement();

  return 'DEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 4, '0');
end;
$function$;

-- 1.6 convert_quote_to_invoice(uuid) — src/features/admin/billing/services/quotes.service.ts
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_quote          public.quotes%rowtype;
  v_invoice_id     uuid;
  v_invoice_number text;
  v_due_date       date;
begin
  -- AJOUT 22/10/2026 : garde administrateur (anon pouvait facturer un devis).
  perform public._garde_admin_uniquement();

  -- Verrou exclusif sur la ligne devis (protection doublon)
  select * into v_quote
  from public.quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'Devis introuvable : %', p_quote_id;
  end if;

  -- Idempotence : déjà converti
  if v_quote.invoice_id is not null then
    return v_quote.invoice_id;
  end if;

  if v_quote.status <> 'accepted' then
    raise exception 'Le devis doit être en statut "accepted" pour être converti. Statut actuel : %', v_quote.status;
  end if;

  v_invoice_number := public.generate_invoice_number();
  v_due_date       := current_date + interval '30 days';

  insert into public.invoices (
    invoice_number,
    quote_id,
    organization_id,
    company_name,
    contact_name,
    contact_email,
    status,
    issue_date,
    due_date,
    amount_ht_cents,
    vat_rate_bps,
    vat_amount_cents,
    amount_ttc_cents,
    currency,
    notes
  ) values (
    v_invoice_number,
    v_quote.id,
    v_quote.organization_id,
    v_quote.company_name,
    v_quote.contact_name,
    v_quote.contact_email,
    'issued',
    current_date,
    v_due_date,
    v_quote.amount_ht_cents,
    v_quote.vat_rate_bps,
    v_quote.vat_amount_cents,
    v_quote.amount_ttc_cents,
    'eur',
    v_quote.notes
  )
  returning id into v_invoice_id;

  -- Copie des lignes devis → lignes facture
  insert into public.invoice_lines (
    invoice_id, label, description, quantity,
    unit_price_ht_cents, total_ht_cents, sort_order
  )
  select
    v_invoice_id, label, description, quantity,
    unit_price_ht_cents, total_ht_cents, sort_order
  from public.quote_lines
  where quote_id = p_quote_id;

  -- Mise à jour du devis
  update public.quotes
  set
    invoice_id              = v_invoice_id,
    converted_to_invoice_at = now(),
    status                  = 'converted_to_invoice'
  where id = p_quote_id;

  return v_invoice_id;
end;
$function$;

-- 1.7 Alertes pipeline — IDOR : p_user_id n'était jamais comparé à auth.uid().
--     Aucun appelant dans le dépôt à ce jour ; la garde rend l'API sûre si
--     l'interface s'en sert un jour.
create or replace function public.get_unread_alerts(p_user_id uuid, p_limit integer DEFAULT 50)
 returns table(id uuid, deal_id uuid, deal_label character varying, category character varying, severity character varying, title character varying, description text, previous_value numeric, current_value numeric, delta numeric, delta_pct numeric, pillar character varying, action_label character varying, action_route character varying, created_at timestamp with time zone)
 language sql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  -- AJOUT 22/10/2026 : l'appelant ne lit que ses propres alertes.
  SELECT public._garde_utilisateur_courant(p_user_id);

  SELECT
    a.id, a.deal_id, a.deal_label, a.category, a.severity,
    a.title, a.description,
    a.previous_value, a.current_value, a.delta, a.delta_pct,
    a.pillar, a.action_label, a.action_route, a.created_at
  FROM pipeline_alerts a
  WHERE a.user_id = p_user_id
    AND a.read_at IS NULL
    AND a.dismissed_at IS NULL
  ORDER BY
    CASE a.severity
      WHEN 'critical' THEN 1
      WHEN 'warning' THEN 2
      ELSE 3
    END,
    a.created_at DESC
  LIMIT p_limit;
$function$;

create or replace function public.count_unread_alerts(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
BEGIN
  -- AJOUT 22/10/2026 : l'appelant ne compte que ses propres alertes.
  PERFORM public._garde_utilisateur_courant(p_user_id);

  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'critical', COUNT(*) FILTER (WHERE severity = 'critical'),
      'warning', COUNT(*) FILTER (WHERE severity = 'warning'),
      'info', COUNT(*) FILTER (WHERE severity = 'info')
    )
    FROM pipeline_alerts
    WHERE user_id = p_user_id
      AND read_at IS NULL
      AND dismissed_at IS NULL
  );
END;
$function$;

create or replace function public.mark_alerts_read(p_user_id uuid, p_alert_ids uuid[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE
  v_count INTEGER;
BEGIN
  -- AJOUT 22/10/2026 : l'appelant ne modifie que ses propres alertes.
  PERFORM public._garde_utilisateur_courant(p_user_id);

  UPDATE pipeline_alerts
  SET read_at = NOW()
  WHERE id = ANY(p_alert_ids)
    AND user_id = p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

create or replace function public.dismiss_alert(p_user_id uuid, p_alert_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
BEGIN
  -- AJOUT 22/10/2026 : l'appelant ne masque que ses propres alertes.
  PERFORM public._garde_utilisateur_courant(p_user_id);

  UPDATE pipeline_alerts
  SET dismissed_at = NOW()
  WHERE id = p_alert_id
    AND user_id = p_user_id;

  RETURN FOUND;
END;
$function$;

-- 1.8 Pondérations SmartScore — IDOR en lecture et en écriture.
create or replace function public.get_user_weights(p_user_id uuid, p_space character varying, p_project_nature character varying DEFAULT 'logement'::character varying)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE
  v_result JSONB;
BEGIN
  -- AJOUT 22/10/2026 : l'appelant ne lit que ses propres pondérations.
  PERFORM public._garde_utilisateur_courant(p_user_id);

  SELECT weights INTO v_result
  FROM smartscore_user_weights
  WHERE user_id = p_user_id
    AND space = p_space
    AND project_nature = p_project_nature
    AND is_default = true
  LIMIT 1;

  IF v_result IS NULL THEN
    SELECT weights INTO v_result
    FROM smartscore_user_weights
    WHERE user_id = p_user_id
      AND space = p_space
      AND project_nature = p_project_nature
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  RETURN v_result;
END;
$function$;

create or replace function public.save_user_weights(p_user_id uuid, p_space character varying, p_project_nature character varying, p_label character varying, p_weights jsonb, p_is_default boolean DEFAULT false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE
  v_id UUID;
BEGIN
  -- AJOUT 22/10/2026 : l'appelant n'écrit que ses propres pondérations.
  PERFORM public._garde_utilisateur_courant(p_user_id);

  -- Si is_default, désactiver les autres
  IF p_is_default THEN
    UPDATE smartscore_user_weights
    SET is_default = false, updated_at = NOW()
    WHERE user_id = p_user_id
      AND space = p_space
      AND project_nature = p_project_nature
      AND is_default = true;
  END IF;

  INSERT INTO smartscore_user_weights (user_id, space, project_nature, label, weights, is_default)
  VALUES (p_user_id, p_space, p_project_nature, p_label, p_weights, p_is_default)
  ON CONFLICT (user_id, space, project_nature, label)
  DO UPDATE SET
    weights = EXCLUDED.weights,
    is_default = EXCLUDED.is_default,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;


-- ── 2. (b) Réservées au serveur : service_role uniquement ───────────────────
-- Gardes internes (appelées seulement depuis des fonctions SECURITY DEFINER),
-- fonctions trigger, fonctions de traitement appelées par les Edge Functions
-- avec la clé service_role, et fonctions sans aucun appelant client.
do $$
declare
  v_sig text;
  v_oid regprocedure;
begin
  foreach v_sig in array array[
    -- gardes internes
    'public._garde_admin_uniquement()',
    'public._garde_decrement_user_tokens(uuid, integer)',
    'public._garde_utilisateur_courant(uuid)',
    'public.est_appel_service_role()',
    -- fonctions trigger (l'appel RPC direct est inutile)
    'public.handle_new_user_credits()',
    'public.org_autoset_owner()',
    'public.promoteur_propagate_stale()',
    -- sourcing (écritures / lectures tous comptes, aucun appelant client)
    'public.archive_old_sourcing_items(integer)',
    'public.batch_update_sourcing_scores(jsonb)',
    'public.update_sourcing_item_score(uuid, jsonb)',
    'public.reset_sourcing_item_for_rescoring(uuid)',
    'public.get_sourcing_items_pending_scoring(integer, text)',
    'public.get_sourcing_scoring_stats(text, integer)',
    'public.get_top_sourcing_items(text, integer, numeric, integer)',
    'public.search_sourcing_items_by_location(text, text, text, text, integer, integer)',
    -- dossiers banque (banque-committee-report-v1 : client service_role)
    'public.banque_dossier_patch_v1(text, jsonb, jsonb, jsonb)',
    'public.banque_dossier_patch_v1(text, uuid, jsonb, jsonb, jsonb)',
    'public.banque_dossier_upsert_v1(text, text, text, text, text, text, text, double precision, double precision, text, jsonb, jsonb, jsonb)',
    -- historique SmartScore (p_user_id libre ; alimente le benchmark)
    'public.save_smartscore_history(character varying, character varying, double precision, double precision, character varying, character varying, smallint, jsonb, jsonb, smallint, smallint, numeric, integer, integer, uuid, uuid, uuid)',
    -- compteur d'usage API (api-gateway, _shared/apiKeyAuth : client service_role)
    'public.increment_api_usage(uuid, text, boolean, integer, integer)'
  ]
  loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise notice '(b) % : absente, rien à faire', v_sig;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', v_oid);
    execute format('grant execute on function %s to service_role', v_oid);
    raise notice '(b) service_role uniquement : %', v_oid;
  end loop;
end
$$;


-- ── 3. (a) Fermées à anon, ouvertes aux comptes connectés ───────────────────
do $$
declare
  v_sig text;
  v_oid regprocedure;
begin
  foreach v_sig in array array[
    -- administration (garde admin interne ; pages /admin)
    'public.admin_copilot_stats()',
    'public.admin_copilot_users()',
    'public.admin_subscriptions_list()',
    'public.admin_users_list()',
    'public.admin_dashboard_metrics()',
    'public.admin_dashboard_organisations()',
    'public.admin_dashboard_recent_analyses()',
    'public.admin_dashboard_users()',
    -- facturation (garde admin interne)
    'public.convert_quote_to_invoice(uuid)',
    'public.generate_invoice_number()',
    'public.generate_quote_number()',
    -- données personnelles (garde « même utilisateur » ou auth.uid())
    'public.count_unread_alerts(uuid)',
    'public.get_unread_alerts(uuid, integer)',
    'public.mark_alerts_read(uuid, uuid[])',
    'public.dismiss_alert(uuid, uuid)',
    'public.get_user_weights(uuid, character varying, character varying)',
    'public.save_user_weights(uuid, character varying, character varying, character varying, jsonb, boolean)',
    'public.copilot_get_balance()',
    'public.purge_my_ai_memory()',
    -- aides de politiques RLS (politiques TO authenticated uniquement)
    'public.is_org_admin(uuid)',
    'public.is_org_member(uuid)',
    'public.is_org_member(uuid, text[])',
    -- DVF : licence DGFiP, aucune page publique ne les appelle
    'public.get_dvf_comps_v1(text, integer, text, integer, text, integer)',
    'public.get_dvf_estimate_v3(text, numeric, integer, text, integer, text, integer)',
    'public.get_dvf_market_stats_commune(text, integer, text)',
    -- référentiels PLU / cadastre / INSEE / Sitadel / SmartScore
    'public.get_commune_centroid(text)',
    'public.get_loyer_estime(character varying, character varying, character varying)',
    'public.get_parcelle_by_id(text)',
    'public.get_plu_rules_for_geom_v1(text, json)',
    'public.get_plu_rules_for_geom_v1(text, jsonb)',
    'public.get_plu_rules_for_geom(text, jsonb)',   -- enveloppe INVOKER de la précédente
    'public.get_population_trend(character varying, integer)',
    'public.get_projections_omphale(character varying, character varying)',
    'public.get_reculs_for_parcel_geom_v1(text, jsonb)',
    'public.get_reculs_for_parcel_geom_v2(text, jsonb, integer)',
    'public.get_reculs_for_parcel_geom_v2(text, jsonb)',
    'public.get_sitadel_proches(double precision, double precision, character varying, integer, integer)',
    'public.get_smartscore_percentile(character varying, character varying, character varying, smallint, integer)',
    'public.plu_get_for_parcelle_any(text)',
    'public.plu_get_for_parcelle_manual(text)'
  ]
  loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise notice '(a) % : absente, rien à faire', v_sig;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', v_oid);
    execute format('grant execute on function %s to authenticated, service_role', v_oid);
    raise notice '(a) authenticated + service_role : %', v_oid;
  end loop;
end
$$;


-- ── 4. (c) Laissées en l'état (aucune instruction) ─────────────────────────
--   is_current_user_admin()        : aide RLS ; la politique de
--                                    sources_donnees_reference vise le rôle PUBLIC
--                                    (donc anon l'évalue) ; utilisée aussi par la
--                                    vue my_account_context, storage.objects et
--                                    ~35 politiques. Ne renvoie que « suis-je admin ».
--   admin_fraicheur_donnees(), admin_top_clients_list(int),
--   admin_adjust_copilot_credits(uuid,int,text) : déjà gardées, déjà fermées à anon.
--   apply_token_ledger_entry, spend_credits, unlock_project, debloquer_apporteur_deal,
--   consume_free_quick_analysis, debit_quick_analysis, refund_quick_analysis,
--   confirm_quick_analysis, save_copilot_studio3d_draft : gardées (auth.uid()),
--                                    déjà fermées à anon, appelées par le front connecté.
--   st_estimatedextent(...) ×3      : PostGIS (extension, propriétaire supabase_admin).


-- ── 5. search_path figé sur les fonctions signalées ─────────────────────────
-- « public » reste en tête (postgis, unaccent, pg_trgm, pg_net y sont installées),
-- puis « extensions » (pgcrypto, uuid-ossp), puis pg_temp en dernier.
-- C'est le chemin effectif actuel moins "$user" : aucun changement fonctionnel.
-- Fonctions appartenant à une extension exclues (aucune dans la liste).
do $$
declare
  v_sig text;
  v_oid regprocedure;
begin
  if to_regnamespace('extensions') is null then
    raise exception 'Schéma extensions absent : search_path non modifié';
  end if;

  foreach v_sig in array array[
    'public.admin_support_tickets_touch_updated_at()',
    'public.api_cache_get(text)',
    'public.api_cache_get(text, text)',
    'public.api_cache_put(text, text, jsonb, jsonb, integer, integer)',
    'public.api_cache_upsert(text, jsonb, integer)',
    'public.backfill_ruleset_sources_v1(text, jsonb)',
    'public.backfill_ruleset_sources_v2(text, jsonb)',
    'public.bpe_nearby_v1(double precision, double precision, integer, integer)',
    'public.cadastre_find_parcelle_by_point(double precision, double precision)',
    'public.cadastre_parcelles_bbox_v1(text, double precision, double precision, double precision, double precision, integer)',
    'public.cadastre_upsert_parcelle_from_etalab(text, text, text, text, text, numeric, jsonb)',
    'public.clean_expired_cache()',
    'public.communication_campaigns_touch_updated_at()',
    'public.compute_property_match_score(text, text, numeric, numeric, numeric, text, text, numeric, numeric, numeric)',
    'public.compute_reculs_envelope_from_facade_v1(jsonb, jsonb, double precision, double precision, double precision, double precision, double precision)',
    'public.compute_reculs_envelope_from_facade_v2(jsonb, jsonb, double precision, double precision, double precision, double precision, double precision)',
    'public.compute_smartscore_v1(double precision, double precision)',
    'public.compute_smartscore_v1_light(double precision, double precision)',
    'public.copilot_touch_conversation_on_message()',
    'public.copilot_touch_updated_at()',
    'public.cout_deblocage_deal(numeric)',
    'public.deal_est_reserve_par_autre(uuid, timestamp with time zone)',
    'public.dvf_market_kpis_commune_v1(text, integer, text, text)',
    'public.dvf_market_kpis_depcom_v1(text, text, integer, text, text)',
    'public.dvf_market_trend_commune_v1(text, integer, text, text)',
    'public.dvf_market_trend_depcom_v1(text, text, integer, text, text)',
    'public.enrich_ruleset_v1(text, text, jsonb)',
    'public.extract_first_number_near(text, text)',
    'public.filosofi_detect_format()',
    'public.filosofi_run_import()',
    'public.filosofi_upsert_long()',
    'public.filosofi_upsert_wide()',
    'public.find_best_property_cluster(text, text, numeric, numeric, numeric)',
    'public.get_bpe_cp_aggregates(text)',
    'public.get_bpe_essentiels_radius(double precision, double precision, double precision)',
    'public.get_bpe_proximite(double precision, double precision, integer, text[])',
    'public.get_dvf_comps_radius(double precision, double precision, integer, integer, text, integer)',
    'public.get_dvf_estimate_v1(text, numeric, integer, text, integer, text, integer)',
    'public.get_dvf_market_stats_radius(double precision, double precision, integer, integer, text)',
    'public.get_dvf_stats(text, text)',
    'public.get_dvf_stats_for_commune(text)',
    'public.get_dvf_stats_for_cp_type(text, text)',
    'public.get_ecoles_proximite(double precision, double precision, integer)',
    'public.get_fiche_sante_commune(text)',
    'public.get_insee_commune_stats(text, integer)',
    'public.get_marche_historique_for_cp_type(text, text)',
    'public.get_market_cp_latest(text)',
    'public.get_market_cp_latest_with_fallback(text)',
    'public.get_nearby_gtfs_stops(double precision, double precision, double precision, integer)',
    'public.get_parcelle_batiments(text)',
    'public.get_parcelle_centroid(text, text)',
    'public.get_parcelle_for_point(double precision, double precision, text)',
    'public.get_plu_engine_parcelle(geometry, text)',
    'public.get_plu_rules_for_geom(text, jsonb)',
    'public.get_plu_rules_for_parcelle(text)',
    'public.get_plu_rules_for_parcelle_v2(text)',
    'public.get_potential_constructibility(text)',
    'public.get_transport_score_aggregated(double precision, double precision)',
    'public.get_transport_score_aggregated_light(double precision, double precision)',
    'public.get_transport_stats(double precision, double precision, integer)',
    'public.handle_sourcing_items_updated_at()',
    'public.has_plu_zonage(text)',
    'public.insee_val(jsonb, text[])',
    'public.kg_set_updated_at()',
    'public.merge_meta_sources_v1(jsonb, jsonb)',
    'public.mobility_deduplicate_by_mode(double precision, double precision, double precision)',
    'public.mobility_nearby_stops(double precision, double precision, double precision, integer)',
    'public.mobility_zone_stats(double precision, double precision, double precision)',
    'public.normalize_ruleset_sources_v1(text, jsonb)',
    'public.normalize_text_simple(text)',
    'public.parse_date_flexible(text)',
    'public.parse_fr_number(text)',
    'public.plu_calc_emprise_max_m2(numeric, numeric)',
    'public.plu_calc_recul_effectif(text, numeric, numeric)',
    'public.plu_calc_sdp_max_m2(numeric, numeric, numeric, numeric)',
    'public.plu_calc_stationnement_requis(numeric, integer, numeric, numeric, numeric)',
    'public.plu_calc_stationnement_requis_v2(numeric, integer, numeric, numeric, numeric)',
    'public.plu_calc_stationnement_requis_v3(numeric, integer, numeric, numeric, numeric, numeric)',
    'public.plu_engine_core_calc_best_v1(text, text, text, integer, numeric, numeric)',
    'public.plu_engine_core_calc_best_v2(text, text, text, numeric, integer, numeric, numeric)',
    'public.plu_engine_core_calc_v1(text, text, text, integer, numeric, numeric)',
    'public.plu_engine_decision_v1(text, text, text, numeric, integer, numeric, numeric, integer)',
    'public.plu_engine_set_updated_at()',
    'public.plu_get_for_parcelle(text)',
    'public.plu_get_for_parcelle_any(text, text)',
    'public.plu_pick_core_rule_v1(text, text, text)',
    'public.portal_snapshots_fill_derived_fields()',
    'public.promoteur_chain_state(uuid)',
    'public.promoteur_touch_updated_at()',
    'public.promoteur_v1(jsonb)',
    'public.promoteur_v1(text, text, numeric, jsonb)',
    'public.refresh_bpe_cp_aggregates()',
    'public.refresh_bpe_depcom_aggregates()',
    'public.refresh_insee_logement_emploi()',
    'public.refresh_market_commune_features_monthly(date)',
    'public.refresh_market_cp_features_monthly(date)',
    'public.refresh_market_cp_features_monthly_fast(date)',
    'public.refresh_market_cp_features_monthly_one_cp(date, text)',
    'public.refresh_plu_zone_stats(text)',
    'public.safe_numeric(text)',
    'public.set_jsonb_if_missing(jsonb, text[], jsonb)',
    'public.set_updated_at()',
    'public.touch_apporteur_deals()',
    'public.transport_stats_strip_stops(jsonb)',
    'public.update_ehpad_tarifs_updated_at()',
    'public.upsert_insee_commune_stats(text, jsonb)',
    'public.upsert_property_listing_and_history(text, text, text, text, text, numeric, numeric, numeric, numeric, integer, text, text, text, numeric, numeric, date, text)'
  ]
  loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise notice 'search_path : % absente, rien à faire', v_sig;
      continue;
    end if;
    if exists (select 1 from pg_depend d
               where d.classid = 'pg_proc'::regclass and d.objid = v_oid and d.deptype = 'e') then
      raise notice 'search_path : % appartient à une extension, ignorée', v_oid;
      continue;
    end if;
    execute format('alter function %s set search_path = public, extensions, pg_temp', v_oid);
  end loop;
  raise notice 'search_path figé sur les fonctions signalées';
end
$$;


-- ── 6. Vues matérialisées exposées à l'API ──────────────────────────────────
-- dvf_marche_historique_cp_type (prix DVF agrégés) et smartscore_stats_by_dept :
-- anon n'y a déjà plus accès ; aucune lecture côté front. Elles ne sont lues que
-- par get_marche_historique_for_cp_type / smartscore-enriched-v4 (service_role).
do $$
declare
  v text;
begin
  foreach v in array array['dvf_marche_historique_cp_type', 'smartscore_stats_by_dept']
  loop
    if to_regclass('public.' || v) is null then
      raise notice 'vue matérialisée % absente, rien à faire', v;
      continue;
    end if;
    execute format('revoke select on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
    raise notice 'vue matérialisée % : lecture réservée à service_role', v;
  end loop;
end
$$;


-- Rechargement du cache de schéma PostgREST.
notify pgrst, 'reload schema';


-- =============================================================================
-- HORS MIGRATION (documenté, volontairement non traité ici)
-- =============================================================================
-- · security_definer_view (8 vues DVF/PLU) : laissées en definer, leurs tables
--   ont la RLS sans politique ; les passer en invoker les viderait.
-- · rls_disabled_in_public sur spatial_ref_sys : table de PostGIS, propriétaire
--   supabase_admin. postgres n'en est pas propriétaire (ALTER TABLE … ENABLE RLS
--   refusé) et n'a pas l'option de transmission sur ses droits (un REVOKE ne
--   retirerait rien). Contenu public (catalogue des projections), MAIS anon et
--   authenticated y ont INSERT/UPDATE/DELETE sans RLS (vérifié le 22/10/2026) :
--   un visiteur pourrait altérer ou supprimer une projection (2154, 4326…) et
--   casser ST_Transform (PLU, reculs). Correctif possible uniquement par
--   supabase_admin : ticket au support Supabase (révoquer insert/update/delete
--   à anon/authenticated sur public.spatial_ref_sys).
-- · extension_in_public (postgis, unaccent, pg_net, pg_trgm) : NE PAS déplacer
--   (types geometry et fonctions référencés sans schéma partout).
-- · auth_leaked_password_protection : à activer dans le tableau de bord
--   Authentication → Providers → Email → « Prevent use of leaked passwords ».


-- =============================================================================
-- VÉRIFICATION (à exécuter après application, dans l'éditeur SQL)
-- =============================================================================
-- 1) Plus aucune fonction SECURITY DEFINER exécutable par anon, hors aides
--    attendues (is_current_user_admin, st_estimatedextent) :
--
-- select p.oid::regprocedure as fonction,
--        has_function_privilege('anon',          p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('service_role',  p.oid, 'execute') as service_role,
--        p.proacl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prosecdef
--   and (has_function_privilege('anon', p.oid, 'execute')
--        or has_function_privilege('authenticated', p.oid, 'execute'))
-- order by 2 desc, 1;
--
-- 2) Plus aucune fonction non-extension à search_path mutable (attendu : 0) :
--
-- select count(*)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prokind in ('f', 'p')
--   and not exists (select 1 from pg_depend d
--                   where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
--   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
--
-- 3) Gardes (depuis le navigateur) :
--    · non connecté : await supabase.rpc('admin_users_list')           → 401/42501 permission denied
--    · connecté non admin : await supabase.rpc('admin_users_list')     → FORBIDDEN_ADMIN_ONLY
--    · connecté : await supabase.rpc('get_unread_alerts', { p_user_id: '<autre uuid>' })
--                                                                      → FORBIDDEN_OTHER_USER
--    · connecté : await supabase.rpc('get_dvf_comps_v1', {...})        → OK (analyse rapide)
-- =============================================================================
