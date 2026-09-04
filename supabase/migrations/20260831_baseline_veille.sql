-- =============================================================================
-- BASELINE — schéma des 16 tables du domaine VEILLE / OPPORTUNITÉS
-- Capturé depuis la production (projet fwvrqngbafqdaekbdfnm) le 31/08/2026.
-- =============================================================================
--
-- POURQUOI CE FICHIER EXISTE
-- --------------------------
-- Ces tables ont été créées directement en base (console Supabase / SQL ad hoc),
-- sans aucune DDL versionnée dans le dépôt. Conséquence : le code source ne
-- permettait ni de les reconstruire, ni même de connaître leurs contraintes,
-- index, triggers et politiques RLS. Toute suppression aurait été
-- irréversible depuis les sources, et toute recréation d'environnement
-- impossible.
--
-- Ce fichier corrige ce point AVANT tout nettoyage. Il est idempotent
-- (IF NOT EXISTS / DO $$ ... $$) et peut être rejoué sans dommage.
--
-- ⚠️ CE N'EST PAS UNE SAUVEGARDE DES DONNÉES — seulement de la STRUCTURE.
--    Pour les données, utiliser les sauvegardes automatiques Supabase.
--
-- ⚠️ COUVERTURE PARTIELLE. Ce fichier NE contient PAS les 49 vues du domaine
--    (v_watchlist_*, v_zone_*, veille_user_summary, market_opportunities_top…),
--    dont plusieurs sont lues par le front. Pour la base complète :
--        npx supabase db dump --schema public -f supabase/migrations/<date>_full_baseline.sql
--    À faire avant de supprimer quoi que ce soit.
--
-- DÉPENDANCES EXTERNES au périmètre de ce fichier — ces tables doivent
-- exister pour que les clés étrangères s'appliquent :
--    auth.users, public.listings, public.property_clusters
-- Et la fonction de trigger : public.set_updated_at()
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TYPES ÉNUMÉRÉS (requis par public.opportunities)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.comparable_scope AS ENUM
    ('radius_300', 'radius_500', 'radius_800', 'radius_1200', 'iris', 'quartier', 'commune');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.opportunity_status AS ENUM
    ('new', 'active', 'archived', 'dismissed', 'converted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Appels d'offres : la SEULE chaîne pleinement vivante du domaine.
--    Alimentée par le cron ao-watch-run-v1, lue par copilot-chat et
--    alertes-accueil-v1. Ne pas supprimer.
CREATE TABLE IF NOT EXISTS public.ao_watches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL,
  departements text[] DEFAULT '{}'::text[] NOT NULL,
  categories text[] DEFAULT ARRAY['foncier'::text, 'travaux'::text, 'moe'::text] NOT NULL,
  texte text,
  jours_min integer DEFAULT 0 NOT NULL,
  frequency text DEFAULT 'daily'::text NOT NULL,
  notify_inapp boolean DEFAULT true NOT NULL,
  notify_email boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  last_run_at timestamp with time zone,
  last_seen_ids text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ao_watch_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  watch_id uuid NOT NULL,
  user_id uuid NOT NULL,
  avis_id text NOT NULL,
  objet text,
  acheteur text,
  url text,
  departements text[] DEFAULT '{}'::text[] NOT NULL,
  zone_incertaine boolean DEFAULT false NOT NULL,
  date_limite timestamp with time zone,
  jours_restants integer,
  is_read boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── Zones de veille et watchlists : lues et écrites par copilot-chat.
--    watch_zones n'a AUCUN accès depuis le front (pilotage 100 % copilote).
CREATE TABLE IF NOT EXISTS public.watch_zones (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL,
  city text NOT NULL,
  postal_code text,
  insee_code text,
  district_label text,
  iris_code text,
  lat double precision,
  lng double precision,
  radius_m integer,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ⚠️ La colonne du nom est `name`, PAS `watchlist_name` : le front a longtemps
--    écrit `watchlist_name`, ce qui faisait échouer toute création côté front
--    (name est NOT NULL) alors que le copilote, lui, réussissait.
CREATE TABLE IF NOT EXISTS public.user_watchlists (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  city text,
  zip_code text,
  property_type text,
  min_price numeric(14,2),
  max_price numeric(14,2),
  min_surface_m2 numeric(10,2),
  max_surface_m2 numeric(10,2),
  min_opportunity_score integer,
  min_confidence_score integer,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ⚠️ Alimentée par un job HORS DÉPÔT (pg_cron / SQL en base) s'il existe.
--    Aucune écriture dans le code : ne pas conclure trop vite qu'elle est morte.
CREATE TABLE IF NOT EXISTS public.user_watchlist_matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  watchlist_id uuid NOT NULL,
  property_cluster_id uuid NOT NULL,
  first_matched_at timestamp with time zone DEFAULT now() NOT NULL,
  last_matched_at timestamp with time zone DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ⚠️ ORPHELINE côté code : 0 lecture, 0 écriture applicative.
CREATE TABLE IF NOT EXISTS public.watchlist_alert_notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  watchlist_id uuid NOT NULL,
  property_cluster_id uuid NOT NULL,
  alert_type text NOT NULL,
  observed_date date NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  delivery_channel text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── Chaîne opportunity_watch* : code vivant des deux côtés (front
--    opportunityWatch.service.ts + cron opportunity-watch-run), mais ZÉRO ligne
--    en base, tous comptes confondus. Fonctionnalité écrite et jamais utilisée.
CREATE TABLE IF NOT EXISTS public.opportunity_watches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL,
  city text,
  zip_code text,
  strategy text DEFAULT 'investisseur'::text NOT NULL,
  criteria jsonb DEFAULT '{}'::jsonb NOT NULL,
  min_score integer DEFAULT 65 NOT NULL,
  frequency text DEFAULT 'daily'::text NOT NULL,
  notify_inapp boolean DEFAULT true NOT NULL,
  notify_email boolean DEFAULT false NOT NULL,
  active boolean DEFAULT true NOT NULL,   -- ⚠️ `active`, PAS `is_active`
  last_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  max_listings integer DEFAULT 100 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.opportunity_watch_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  watch_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  listing_key text NOT NULL,
  url text,
  title text,
  price numeric,
  previous_price numeric,
  price_delta_pct numeric,
  score integer,
  payload jsonb,
  seen boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.opportunity_watch_listings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  watch_id uuid NOT NULL,
  listing_key text NOT NULL,
  url text,
  title text,
  last_price numeric,
  last_score integer,
  first_detected_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── market_opportunities : seule table du domaine avec une alimentation
--    vivante et des données (market-refresh-zone-v1 → market-opportunity-
--    refresh-v1). Lue par alertes-accueil-v1. Ne pas supprimer.
CREATE TABLE IF NOT EXISTS public.market_opportunities (
  canonical_key text NOT NULL,
  zone_key text NOT NULL,
  city text,
  zip_code text,
  price numeric,
  surface numeric,
  price_m2 numeric,
  portal_count integer,
  listing_count integer,
  first_seen_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  representative_url text,
  opportunity_score numeric,
  opportunity_bucket text,
  score_freshness numeric,
  score_price_position numeric,
  score_diffusion numeric,
  score_multi_portal numeric,
  score_zone_liquidity numeric,
  price_position_pct numeric,
  days_on_market numeric,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL
);

-- ⚠️ ORPHELINE côté code : seul accès = DELETE de purge RGPD.
CREATE TABLE IF NOT EXISTS public.market_watch_zones (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  zone_key text NOT NULL,
  city text,
  zip_code text,
  transaction_mode text DEFAULT 'sale'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  refresh_interval_minutes integer DEFAULT 180 NOT NULL,
  last_ingest_at timestamp with time zone,
  last_dedupe_at timestamp with time zone,
  last_metrics_at timestamp with time zone,
  last_score_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_error_at timestamp with time zone,
  last_error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ⚠️ ORPHELINE côté code : 0 lecture, 0 écriture, aucune référence applicative.
CREATE TABLE IF NOT EXISTS public.zone_alerts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  city text NOT NULL,
  postal_code text,
  iris_code text,
  alert_type text NOT NULL,
  alert_score numeric,
  message text,
  metrics jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- ⚠️ Aucun INSERT/UPDATE dans le dépôt. La seule lecture
--    (getUserOpportunities) est du code mort : VeilleOpportunities n'est
--    importé nulle part, et le bundle compilé ne contient pas la requête.
CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  listing_id uuid NOT NULL,
  status public.opportunity_status DEFAULT 'new'::public.opportunity_status NOT NULL,
  comparable_scope public.comparable_scope DEFAULT 'commune'::public.comparable_scope NOT NULL,
  dvf_sample_size integer DEFAULT 0 NOT NULL,
  dvf_price_m2_median numeric(12,2),
  dvf_price_m2_p25 numeric(12,2),
  dvf_price_m2_p75 numeric(12,2),
  discount_pct numeric(8,4),
  discount_score_raw numeric(8,2),
  discount_score_effective numeric(8,2),
  market_score numeric(8,2) DEFAULT 0 NOT NULL,
  liquidity_score numeric(8,2) DEFAULT 0 NOT NULL,
  renovation_score numeric(8,2) DEFAULT 0 NOT NULL,
  rarity_score numeric(8,2) DEFAULT 0 NOT NULL,
  confidence_score numeric(8,2) DEFAULT 0 NOT NULL,
  geo_reliability_score numeric(8,2) DEFAULT 0 NOT NULL,
  opportunity_score numeric(8,2) DEFAULT 0 NOT NULL,
  geo_confidence integer DEFAULT 20 NOT NULL,
  geo_weight numeric(5,2) DEFAULT 0.55 NOT NULL,
  scoring_version text DEFAULT 'opportunity-v1'::text NOT NULL,
  scoring_context jsonb DEFAULT '{}'::jsonb NOT NULL,
  signal_label text,
  confidence_label text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  source_id text,
  address text,
  property_type text,
  listing_created_at timestamp with time zone,
  first_seen_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  days_on_market integer,
  price_history jsonb,
  portal_count integer,
  relist_count integer,
  area_bucket text,
  market_price_m2 numeric,
  market_price_m2_low numeric,
  market_price_m2_high numeric,
  discount_score numeric,
  seller_pressure_score numeric,
  watchlist_fit_score numeric,
  momentum_score numeric,
  data_confidence_score numeric,
  opportunity_label text,
  reasons jsonb,
  risk_flags jsonb,
  decision_hint text,
  refreshed_at timestamp with time zone DEFAULT now(),
  user_id uuid,
  watchlist_id uuid,
  zip_code text,
  discount_vs_market_pct numeric,
  trigger_summary text,
  pillar_scores jsonb,
  title text,
  city text,
  price_eur numeric,
  surface_m2 numeric
);

-- ⚠️ ORPHELINE ABSOLUE : zéro occurrence de ce nom dans tout le dépôt.
CREATE TABLE IF NOT EXISTS public.opportunity_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  opportunity_id uuid NOT NULL,
  event_type text NOT NULL,
  event_label text,
  event_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ⚠️ ORPHELINE côté code : seul accès = DELETE de purge RGPD.
CREATE TABLE IF NOT EXISTS public.user_opportunity_views (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  is_seen boolean DEFAULT false NOT NULL,
  is_saved boolean DEFAULT false NOT NULL,
  is_dismissed boolean DEFAULT false NOT NULL,
  first_seen_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  saved_at timestamp with time zone,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ⚠️ ORPHELINE côté code : seul accès = DELETE de purge RGPD.
--    Intention documentée dans smartscore-enriched-v3/pipeline_alerts_v4.ts
--    (« si delta > seuil → crée une alerte »), JAMAIS implémentée : ce fichier
--    ne contient aucun accès base et n'est importé nulle part.
CREATE TABLE IF NOT EXISTS public.pipeline_alerts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  deal_id uuid NOT NULL,
  deal_label character varying(200),
  user_id uuid NOT NULL,
  category character varying(30) NOT NULL,
  severity character varying(10) NOT NULL,
  title character varying(200) NOT NULL,
  description text,
  previous_value numeric,
  current_value numeric,
  delta numeric,
  delta_pct numeric,
  pillar character varying(30),
  action_label character varying(100),
  action_route character varying(200),
  created_at timestamp with time zone DEFAULT now(),
  read_at timestamp with time zone,
  dismissed_at timestamp with time zone
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONTRAINTES
--
-- Enveloppées dans un bloc qui ignore les doublons : ALTER TABLE ... ADD
-- CONSTRAINT n'accepte pas IF NOT EXISTS, et ce fichier doit rester rejouable.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  ddl text;
BEGIN
  FOREACH ddl IN ARRAY ARRAY[
    'ALTER TABLE public.ao_watch_events ADD CONSTRAINT ao_watch_events_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.ao_watch_events ADD CONSTRAINT ao_watch_events_unique UNIQUE (watch_id, avis_id)',
    'ALTER TABLE public.ao_watch_events ADD CONSTRAINT ao_watch_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    'ALTER TABLE public.ao_watch_events ADD CONSTRAINT ao_watch_events_watch_id_fkey FOREIGN KEY (watch_id) REFERENCES public.ao_watches(id) ON DELETE CASCADE',
    'ALTER TABLE public.ao_watches ADD CONSTRAINT ao_watches_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.ao_watches ADD CONSTRAINT ao_watches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    'ALTER TABLE public.ao_watches ADD CONSTRAINT ao_watches_categories_check CHECK (((categories <@ ARRAY[''foncier''::text, ''travaux''::text, ''moe''::text]) AND (cardinality(categories) >= 1)))',
    'ALTER TABLE public.ao_watches ADD CONSTRAINT ao_watches_frequency_check CHECK ((frequency = ANY (ARRAY[''daily''::text, ''weekly''::text])))',
    'ALTER TABLE public.ao_watches ADD CONSTRAINT ao_watches_jours_min_check CHECK (((jours_min >= 0) AND (jours_min <= 365)))',
    -- Une veille doit porter au moins un département OU un texte : c''est ce qui
    -- empêche une veille vide, qui remonterait la France entière.
    'ALTER TABLE public.ao_watches ADD CONSTRAINT ao_watches_portee_check CHECK (((cardinality(departements) > 0) OR ((texte IS NOT NULL) AND (length(btrim(texte)) > 0))))',
    'ALTER TABLE public.market_opportunities ADD CONSTRAINT market_opportunities_pkey PRIMARY KEY (canonical_key)',
    'ALTER TABLE public.market_watch_zones ADD CONSTRAINT market_watch_zones_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.opportunities ADD CONSTRAINT uq_opportunities_listing_id UNIQUE (listing_id)',
    'ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE',
    'ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_geo_confidence_check CHECK (((geo_confidence >= 0) AND (geo_confidence <= 100)))',
    'ALTER TABLE public.opportunity_events ADD CONSTRAINT opportunity_events_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.opportunity_events ADD CONSTRAINT opportunity_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE',
    'ALTER TABLE public.opportunity_watch_events ADD CONSTRAINT opportunity_watch_events_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.opportunity_watch_events ADD CONSTRAINT opportunity_watch_events_watch_id_fkey FOREIGN KEY (watch_id) REFERENCES public.opportunity_watches(id) ON DELETE CASCADE',
    'ALTER TABLE public.opportunity_watch_events ADD CONSTRAINT opportunity_watch_events_event_type_check CHECK ((event_type = ANY (ARRAY[''new_listing''::text, ''price_drop''::text, ''strong_opportunity''::text])))',
    'ALTER TABLE public.opportunity_watch_listings ADD CONSTRAINT opportunity_watch_listings_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.opportunity_watch_listings ADD CONSTRAINT opportunity_watch_listings_watch_id_listing_key_key UNIQUE (watch_id, listing_key)',
    'ALTER TABLE public.opportunity_watch_listings ADD CONSTRAINT opportunity_watch_listings_watch_id_fkey FOREIGN KEY (watch_id) REFERENCES public.opportunity_watches(id) ON DELETE CASCADE',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_frequency_check CHECK ((frequency = ANY (ARRAY[''daily''::text, ''weekly''::text])))',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_max_listings_check CHECK (((max_listings >= 1) AND (max_listings <= 500)))',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_min_score_check CHECK (((min_score >= 0) AND (min_score <= 100)))',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_strategy_check CHECK ((strategy = ANY (ARRAY[''investisseur''::text, ''rehabilitateur''::text, ''promoteur''::text])))',
    'ALTER TABLE public.opportunity_watches ADD CONSTRAINT opportunity_watches_zone_chk CHECK (((zip_code IS NOT NULL) OR (city IS NOT NULL)))',
    'ALTER TABLE public.pipeline_alerts ADD CONSTRAINT pipeline_alerts_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.pipeline_alerts ADD CONSTRAINT pipeline_alerts_severity_check CHECK (((severity)::text = ANY ((ARRAY[''info''::character varying, ''warning''::character varying, ''critical''::character varying])::text[])))',
    'ALTER TABLE public.user_opportunity_views ADD CONSTRAINT user_opportunity_views_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.user_opportunity_views ADD CONSTRAINT uq_user_opportunity_views UNIQUE (user_id, opportunity_id)',
    'ALTER TABLE public.user_opportunity_views ADD CONSTRAINT user_opportunity_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    'ALTER TABLE public.user_opportunity_views ADD CONSTRAINT user_opportunity_views_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE',
    'ALTER TABLE public.user_watchlist_matches ADD CONSTRAINT user_watchlist_matches_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.user_watchlist_matches ADD CONSTRAINT uq_user_watchlist_match UNIQUE (watchlist_id, property_cluster_id)',
    'ALTER TABLE public.user_watchlist_matches ADD CONSTRAINT user_watchlist_matches_watchlist_id_fkey FOREIGN KEY (watchlist_id) REFERENCES public.user_watchlists(id) ON DELETE CASCADE',
    'ALTER TABLE public.user_watchlist_matches ADD CONSTRAINT user_watchlist_matches_property_cluster_id_fkey FOREIGN KEY (property_cluster_id) REFERENCES public.property_clusters(id) ON DELETE CASCADE',
    'ALTER TABLE public.user_watchlists ADD CONSTRAINT user_watchlists_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.watch_zones ADD CONSTRAINT watch_zones_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.watch_zones ADD CONSTRAINT watch_zones_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    'ALTER TABLE public.watchlist_alert_notifications ADD CONSTRAINT watchlist_alert_notifications_pkey PRIMARY KEY (id)',
    'ALTER TABLE public.watchlist_alert_notifications ADD CONSTRAINT uq_watchlist_alert_notification UNIQUE (watchlist_id, property_cluster_id, alert_type, observed_date)',
    'ALTER TABLE public.watchlist_alert_notifications ADD CONSTRAINT watchlist_alert_notifications_watchlist_id_fkey FOREIGN KEY (watchlist_id) REFERENCES public.user_watchlists(id) ON DELETE CASCADE',
    'ALTER TABLE public.watchlist_alert_notifications ADD CONSTRAINT watchlist_alert_notifications_property_cluster_id_fkey FOREIGN KEY (property_cluster_id) REFERENCES public.property_clusters(id) ON DELETE CASCADE',
    'ALTER TABLE public.zone_alerts ADD CONSTRAINT zone_alerts_pkey PRIMARY KEY (id)'
  ]
  LOOP
    BEGIN
      EXECUTE ddl;
    EXCEPTION
      WHEN duplicate_table THEN NULL;   -- contrainte déjà présente
      WHEN duplicate_object THEN NULL;
      WHEN invalid_table_definition THEN NULL;  -- clé primaire déjà définie
      WHEN undefined_table THEN
        RAISE NOTICE 'Table absente, contrainte ignorée : %', ddl;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. INDEX
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS ao_watch_events_user_non_lus_idx ON public.ao_watch_events USING btree (user_id, created_at DESC) WHERE (NOT is_read);
CREATE INDEX IF NOT EXISTS ao_watches_user_actif_idx ON public.ao_watches USING btree (user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_opportunities_comparable_scope ON public.opportunities USING btree (comparable_scope);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON public.opportunities USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_discount_pct ON public.opportunities USING btree (discount_pct DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON public.opportunities USING btree (opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON public.opportunities USING btree (status);
CREATE INDEX IF NOT EXISTS idx_opportunity_events_created_at ON public.opportunity_events USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_events_opportunity_id ON public.opportunity_events USING btree (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_owe_unseen ON public.opportunity_watch_events USING btree (user_id, seen) WHERE (seen = false);
CREATE INDEX IF NOT EXISTS idx_owe_user_recent ON public.opportunity_watch_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owe_watch ON public.opportunity_watch_events USING btree (watch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owl_watch ON public.opportunity_watch_listings USING btree (watch_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_watches_due ON public.opportunity_watches USING btree (active, last_run_at);
CREATE INDEX IF NOT EXISTS idx_opportunity_watches_user ON public.opportunity_watches USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_created ON public.pipeline_alerts USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_deal ON public.pipeline_alerts USING btree (deal_id);
CREATE INDEX IF NOT EXISTS idx_pa_severity ON public.pipeline_alerts USING btree (severity);
CREATE INDEX IF NOT EXISTS idx_pa_user ON public.pipeline_alerts USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_pa_user_unread ON public.pipeline_alerts USING btree (user_id) WHERE ((read_at IS NULL) AND (dismissed_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_user_opportunity_views_opportunity_id ON public.user_opportunity_views USING btree (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_user_opportunity_views_user_id ON public.user_opportunity_views USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_matches_active ON public.user_watchlist_matches USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_matches_property ON public.user_watchlist_matches USING btree (property_cluster_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_matches_watchlist ON public.user_watchlist_matches USING btree (watchlist_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_active ON public.user_watchlists USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_user ON public.user_watchlists USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_watch_zones_city ON public.watch_zones USING btree (city);
CREATE INDEX IF NOT EXISTS idx_watch_zones_iris_code ON public.watch_zones USING btree (iris_code);
CREATE INDEX IF NOT EXISTS idx_watch_zones_user_id ON public.watch_zones USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_alert_notifications_observed_date ON public.watchlist_alert_notifications USING btree (observed_date DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_alert_notifications_watchlist ON public.watchlist_alert_notifications USING btree (watchlist_id);
CREATE INDEX IF NOT EXISTS idx_zone_alerts_city ON public.zone_alerts USING btree (city);
CREATE INDEX IF NOT EXISTS idx_zone_alerts_created ON public.zone_alerts USING btree (created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SÉCURITÉ AU NIVEAU LIGNE (RLS)
--
-- ⚠️ Ces politiques sont la SEULE chose qui empêche un utilisateur de lire les
--    veilles d'un autre. Les edge functions qui interrogent ces tables doivent
--    passer par le client porteur du JWT de l'appelant : avec la clé
--    service_role, tout ce bloc est contourné.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ao_watches                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ao_watch_events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_zones                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_watchlists               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_watchlist_matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_alert_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_watches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_watch_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_watch_listings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_opportunities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_watch_zones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_alerts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_opportunity_views        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  ddl text;
BEGIN
  FOREACH ddl IN ARRAY ARRAY[
    -- Appels d'offres
    'CREATE POLICY ao_watches_select_own ON public.ao_watches FOR SELECT USING (auth.uid() = user_id)',
    'CREATE POLICY ao_watches_insert_own ON public.ao_watches FOR INSERT WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY ao_watches_update_own ON public.ao_watches FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY ao_watches_delete_own ON public.ao_watches FOR DELETE USING (auth.uid() = user_id)',
    'CREATE POLICY ao_watch_events_select_own ON public.ao_watch_events FOR SELECT USING (auth.uid() = user_id)',
    'CREATE POLICY ao_watch_events_update_own ON public.ao_watch_events FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    -- Zones de veille
    'CREATE POLICY watch_zones_select_own ON public.watch_zones FOR SELECT TO authenticated USING (auth.uid() = user_id)',
    'CREATE POLICY watch_zones_insert_own ON public.watch_zones FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY watch_zones_update_own ON public.watch_zones FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY watch_zones_delete_own ON public.watch_zones FOR DELETE TO authenticated USING (auth.uid() = user_id)',
    -- Watchlists
    'CREATE POLICY user_watchlists_owner_rw ON public.user_watchlists FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
    'CREATE POLICY user_watchlist_matches_owner_ro ON public.user_watchlist_matches FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_watchlists w WHERE w.id = user_watchlist_matches.watchlist_id AND w.user_id = auth.uid()))',
    'CREATE POLICY watchlist_alert_notifications_owner_ro ON public.watchlist_alert_notifications FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_watchlists w WHERE w.id = watchlist_alert_notifications.watchlist_id AND w.user_id = auth.uid()))',
    -- Veilles d'opportunités
    'CREATE POLICY owatches_select ON public.opportunity_watches FOR SELECT USING (auth.uid() = user_id)',
    'CREATE POLICY owatches_insert ON public.opportunity_watches FOR INSERT WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY owatches_update ON public.opportunity_watches FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY owatches_delete ON public.opportunity_watches FOR DELETE USING (auth.uid() = user_id)',
    'CREATE POLICY oevents_select ON public.opportunity_watch_events FOR SELECT USING (auth.uid() = user_id)',
    'CREATE POLICY oevents_update ON public.opportunity_watch_events FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    -- Référentiels non nominatifs : lecture ouverte aux comptes authentifiés
    'CREATE POLICY market_opportunities_read_auth ON public.market_opportunities FOR SELECT TO authenticated USING (true)',
    'CREATE POLICY zone_alerts_read_auth ON public.zone_alerts FOR SELECT TO authenticated USING (true)',
    -- Divers
    'CREATE POLICY market_watch_zones_own ON public.market_watch_zones FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY opportunities_own ON public.opportunities FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY opportunity_events_own ON public.opportunity_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_events.opportunity_id AND o.user_id = auth.uid()))',
    'CREATE POLICY pipeline_alerts_owner_rw ON public.pipeline_alerts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
    'CREATE POLICY user_opportunity_views_select_own ON public.user_opportunity_views FOR SELECT TO authenticated USING (auth.uid() = user_id)',
    'CREATE POLICY user_opportunity_views_insert_own ON public.user_opportunity_views FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
    'CREATE POLICY user_opportunity_views_update_own ON public.user_opportunity_views FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)'
  ]
  LOOP
    BEGIN
      EXECUTE ddl;
    EXCEPTION
      WHEN duplicate_object THEN NULL;  -- politique déjà en place
      WHEN undefined_table THEN
        RAISE NOTICE 'Table absente, politique ignorée : %', ddl;
    END;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DÉCLENCHEURS
--
-- Dépendent de public.set_updated_at(), définie ailleurs. Si elle manque, les
-- CREATE TRIGGER échouent : la restaurer d'abord.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    CREATE TRIGGER trg_opportunities_updated_at BEFORE UPDATE ON public.opportunities
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_function THEN
    RAISE NOTICE 'set_updated_at() absente : trigger opportunities ignoré';
  END;
  BEGIN
    CREATE TRIGGER trg_owatches_updated_at BEFORE UPDATE ON public.opportunity_watches
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_function THEN
    RAISE NOTICE 'set_updated_at() absente : trigger opportunity_watches ignoré';
  END;
  BEGIN
    CREATE TRIGGER trg_watch_zones_updated_at BEFORE UPDATE ON public.watch_zones
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_function THEN
    RAISE NOTICE 'set_updated_at() absente : trigger watch_zones ignoré';
  END;
END $$;

-- =============================================================================
-- FIN. Prochaine étape avant tout nettoyage : capturer les 49 vues via
--   npx supabase db dump --schema public -f supabase/migrations/<date>_full_baseline.sql
-- =============================================================================
