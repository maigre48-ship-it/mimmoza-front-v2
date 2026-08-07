-- ============================================================================
-- Mimmoza — remédiation RLS / exposition anon        (audit du 2026-08-04)
-- Projet : Backend Mimmoza (fwvrqngbafqdaekbdfnm)
--
-- ⚠️  NE PAS EXÉCUTER EN BLOC SANS RELECTURE.
--     Les lots sont indépendants et ordonnés du plus urgent au moins urgent.
--     Chaque lot est idempotent et rejouable.
--
-- Rappel : les Edge Functions utilisant la clé service_role contournent RLS —
-- elles ne sont pas impactées. Ce qui casse potentiellement, c'est un accès
-- front (clé anon/authenticated) à une table qui n'a plus de policy SELECT.
-- ============================================================================


-- ============================================================================
-- LOT 1 — DONNÉES UTILISATEUR EXPOSÉES  (critique)
-- Tables portant un user_id, actuellement lisibles ET modifiables par
-- quiconque possède la clé anon publique.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'pipeline_alerts',
    'plu_user_overrides_v1',
    'smartscore_history',
    'smartscore_user_weights',
    'user_watchlists',
    'user_zone_notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_rw', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid())
    $p$, t || '_owner_rw', t);
  end loop;
end $$;


-- ============================================================================
-- LOT 2 — TABLES DÉRIVÉES D'UNE WATCHLIST  (critique)
-- Pas de user_id direct : la propriété passe par watchlist_id.
-- ============================================================================

alter table public.user_watchlist_matches        enable row level security;
alter table public.watchlist_alert_notifications enable row level security;

drop policy if exists user_watchlist_matches_owner_ro on public.user_watchlist_matches;
create policy user_watchlist_matches_owner_ro
  on public.user_watchlist_matches
  for select to authenticated
  using (exists (
    select 1 from public.user_watchlists w
    where w.id = user_watchlist_matches.watchlist_id
      and w.user_id = auth.uid()
  ));

drop policy if exists watchlist_alert_notifications_owner_ro on public.watchlist_alert_notifications;
create policy watchlist_alert_notifications_owner_ro
  on public.watchlist_alert_notifications
  for select to authenticated
  using (exists (
    select 1 from public.user_watchlists w
    where w.id = watchlist_alert_notifications.watchlist_id
      and w.user_id = auth.uid()
  ));


-- ============================================================================
-- LOT 3 — VUES QUI CONTOURNENT RLS  (critique, souvent le vrai trou)
--
-- Une vue Postgres s'exécute par défaut avec les droits de SON PROPRIÉTAIRE
-- (security_invoker = false). Résultat : mettre RLS sur les tables de base ne
-- protège PAS ces vues, et le rôle anon a le SELECT dessus.
-- `veille_user_summary`, `my_account_context`, `admin_user_billing_summary`,
-- `copilot_credits_balance` et toute la famille `v_watchlist_*` exposent donc
-- aujourd'hui les données de TOUS les utilisateurs à la clé anon.
--
-- Correctif : security_invoker = true (la vue est évaluée avec les droits de
-- l'appelant, donc RLS s'applique) + retrait du SELECT au rôle anon.
--
-- ⚠️  À tester : le front lit `veille_user_summary`, `macro_rates_latest`,
--     `v_market_active_listings`, `market_summary_v2`, `market_tension_signal`,
--     `watchlist_opportunities_deduped`, `plu_front_zone_summary_v1`.
--     Ces vues doivent rester lisibles par `authenticated`.
-- ============================================================================

do $$
declare v text;
begin
  foreach v in array array[
    'admin_top_clients',
    'admin_user_billing_summary',
    'copilot_credits_balance',
    'my_account_context',
    'v_sourcing_items_summary',
    'v_user_watchlist_candidates',
    'v_user_watchlists_home_dashboard',
    'v_user_watchlists_home_dashboard_json',
    'v_watchlist_alert_cards',
    'v_watchlist_alerts_to_send',
    'v_watchlist_dashboard',
    'v_watchlist_digest_narrative',
    'v_watchlist_digest_recent5',
    'v_watchlist_digest_summary',
    'v_watchlist_digest_top3',
    'v_watchlist_notification_history',
    'v_watchlist_notification_payloads',
    'v_watchlist_page_payload',
    'v_watchlist_recent_alerts',
    'v_watchlist_summary',
    'v_watchlist_top_opportunities',
    'v_watchlist_top_opportunity_cards',
    'veille_user_summary'
  ] loop
    execute format('alter view public.%I set (security_invoker = true)', v);
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- v_user_profile est déjà en security_invoker = true : on ne retire que anon.
revoke all on public.v_user_profile from anon;
grant  select on public.v_user_profile to authenticated;


-- ============================================================================
-- LOT 4 — RÉFÉRENTIELS ET DONNÉES MARCHÉ LUS PAR LE FRONT
-- Contenu non personnel (open data, agrégats marché). On ferme l'écriture
-- (aucune policy INSERT/UPDATE/DELETE) et on garde la lecture authentifiée.
-- Le front lit explicitement : portal_snapshots, market_opportunities,
-- market_zone_metrics.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    -- lus par le front
    'portal_snapshots', 'market_opportunities', 'market_zone_metrics',
    -- référentiels open data / calculs, potentiellement lus via vues
    'bpe_cp_aggregates', 'bpe_depcom_aggregates', 'bpe_equipements',
    'bpe_typequ_mapping', 'cadastre_batiments', 'cadastre_parcelles',
    'cadastre_sections', 'commune_cp_map', 'dvf_2025_s1',
    'dvf_addresses_2025_s1', 'dvf_addresses_geocoded', 'dvf_cp_list',
    'dvf_prix_m2', 'ecoles_fr', 'filosofi_2021_pauvrete', 'filosofi_2021_revenu',
    'insee_communes_stats', 'insee_socioeco_communes', 'gtfs_routes',
    'gtfs_stops', 'gtfs_trips', 'loyer_reference', 'market_cp_features_monthly',
    'market_listings', 'market_price_reference', 'market_source_listings',
    'plu_documents', 'plu_emprises', 'plu_hauteurs', 'plu_manual_rulesets',
    'plu_rulesets_universal', 'plu_text_chunks', 'plu_zonage', 'plu_zonages',
    'plu_zone_defaults', 'plu_zone_stats', 'plu_zones_rulesets',
    'property_clusters', 'property_daily_scores', 'property_listings',
    'property_price_history', 'sante_communes', 'sitadel_permis',
    'smartscore_reports_v4', 'smartscore_results', 'smartscore_terrain_results',
    'zone_alerts', 'zone_market_metrics'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read_auth', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read_auth', t);
  end loop;
end $$;


-- ============================================================================
-- LOT 5 — TABLES INTERNES / STAGING / CACHE
-- Jamais lues par le front. RLS activé SANS policy ⇒ accessibles uniquement
-- au service_role (Edge Functions, jobs). Verrouillage le plus simple.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'bpe_import_temp', 'bpe_typequ_raw',
    'cadastre_batiments_cache', 'cadastre_parcelles_cache', 'cadastre_sections_cache',
    'dvf_clean', 'dvf_geo', 'dvf_import_geo', 'dvf_mimmoza_24m',
    'dvf_mimmoza_24m_staging', 'features_catalog',
    'filosofi_2021_pauvrete_raw', 'filosofi_2021_revenu_raw',
    'filosofi_2021_revenus_raw', 'filosofi_staging', 'finess_etablissements',
    'geocode_cp_queue', 'geocode_targets', 'gtfs_stop_times', 'gtfs_stops_raw',
    'health_commune_stats', 'insee_pop_historique', 'insee_projections_omphale',
    'market_commune_features_monthly', 'market_commune_segmentation_monthly',
    'market_cp_features_monthly_fix_stage', 'market_ingest_state',
    'market_segment_cluster_map', 'market_segment_override',
    'market_segmentation_snapshot_monthly', 'market_stock_history',
    'market_zone_daily', 'plu_communes_mode', 'plu_paris_emprises_raw',
    'plu_paris_hauteurs_raw', 'plu_paris_zonage_raw', 'plu_regles_synthese',
    'plu_rules_raw', 'plu_ruleset_normalized', 'plu_sources',
    'plu_zonage_staging', 'raw_listings', 'staging_zonage_ascain',
    'terrain_grid_cache'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;


-- ============================================================================
-- HORS PÉRIMÈTRE
--
-- • public.spatial_ref_sys : table système PostGIS. L'ALTER échouera
--   (propriétaire = extension) et ce n'est pas une donnée sensible. Ignorer.
--
-- • Les ~100 vues restantes (market_*, plu_*, v_property_*, dvf_*) sont en
--   security_invoker = false avec SELECT accordé à anon. Elles n'exposent pas
--   de données personnelles, mais elles exposent tout le référentiel métier
--   (DVF retraité, PLU normalisé, scoring) à quiconque a la clé anon.
--   Si c'est votre valeur ajoutée, prévoir un lot 6 :
--       revoke all on public.<vue> from anon;
--       grant  select on public.<vue> to authenticated;
--   à passer vue par vue après avoir vérifié qu'aucune page publique ne s'en
--   sert (landing, pages légales, démo non connectée).
-- ============================================================================


-- ============================================================================
-- VÉRIFICATION APRÈS APPLICATION
-- ============================================================================
-- Tables encore sans RLS :
--   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
--
-- Vues encore lisibles par anon :
--   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind in ('v','m')
--     and has_table_privilege('anon', c.oid, 'SELECT');
--
-- Tables RLS activé mais sans aucune policy (⇒ service_role uniquement) :
--   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
--     and not exists (select 1 from pg_policy p where p.polrelid=c.oid);
