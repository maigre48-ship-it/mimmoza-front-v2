-- =====================================================================
-- SAUVEGARDE DE LA STRUCTURE DES VUES DU SCHEMA `public`
-- Projet Supabase : fwvrqngbafqdaekbdfnm
-- Capture effectuee depuis la PRODUCTION le 31/08/2026
-- =====================================================================
--
-- POURQUOI CE FICHIER ?
-- ---------------------
-- Aucune DDL des vues n'etait versionnee dans le depot : la definition
-- des 132 vues du schema `public` n'existait qu'en base de production.
-- Ce fichier constitue donc le point de reprise (baseline) de reference.
-- Il DOIT exister et etre commite AVANT toute suppression de table,
-- car supprimer une table detruit en cascade les vues qui en dependent
-- et, sans cette sauvegarde, leur definition serait perdue.
--
-- ORDRE DES INSTRUCTIONS
-- ----------------------
-- Les vues sont classees par nombre de dependances croissant (les vues
-- ne dependant d'aucune autre vue d'abord, puis celles qui en referencent
-- une, deux, etc.). Cet ordre reste APPROXIMATIF : il ne garantit pas un
-- tri topologique parfait.
-- => Si le rejeu echoue sur une vue qui en reference une autre pas encore
--    creee, il suffit de RELANCER LE FICHIER UNE SECONDE FOIS. Toutes les
--    instructions sont en CREATE OR REPLACE (ou CREATE ... IF NOT EXISTS
--    pour les vues materialisees), donc idempotentes : un second passage
--    resout les dependances restantes sans effet de bord.
--
-- PORTEE
-- ------
-- Ce fichier ne contient PAS les donnees : uniquement la STRUCTURE
-- (definition SQL) des vues. Aucun INSERT, aucun dump de lignes.
-- Il ne contient pas non plus les tables, index, politiques RLS,
-- fonctions ni triggers.
--
-- =====================================================================


-- admin_top_clients
CREATE OR REPLACE VIEW public.admin_top_clients AS
 SELECT bp.user_id,
    bp.email,
    bp.plan_code,
    COALESCE(inv.total_paid, 0::bigint) AS total_paid_cents,
        CASE
            WHEN bp.subscription_status = ANY (ARRAY['active'::text, 'trialing'::text]) THEN
            CASE bp.plan_code
                WHEN 'starter'::text THEN 4900
                WHEN 'pro'::text THEN 9900
                WHEN 'promoteur_starter'::text THEN 7900
                WHEN 'promoteur_pro'::text THEN 14900
                WHEN 'financeur_pro'::text THEN 19900
                ELSE 0
            END
            ELSE 0
        END AS mrr_cents
   FROM billing_profiles bp
     LEFT JOIN LATERAL ( SELECT sum(billing_invoices.total_cents) AS total_paid
           FROM billing_invoices
          WHERE billing_invoices.user_id = bp.user_id AND billing_invoices.status = 'succeeded'::text) inv ON true
  WHERE bp.is_admin = false
  ORDER BY (COALESCE(inv.total_paid, 0::bigint)) DESC;

-- admin_user_billing_summary
CREATE OR REPLACE VIEW public.admin_user_billing_summary AS
 SELECT bp.user_id,
    bp.email,
    bp.plan_code,
    bp.subscription_status,
    bp.subscription_current_period_end,
    bp.subscription_canceled_at,
    bp.token_balance,
    bp.is_admin,
    bp.created_at,
    COALESCE(tl_credit.total_credited, 0::bigint) AS tokens_total_purchased,
    COALESCE(tl_debit.total_debited, 0::bigint) AS tokens_total_consumed,
    COALESCE(inv.total_billed, 0::bigint) AS total_billed_cents,
    COALESCE(inv.total_paid, 0::bigint) AS total_paid_cents,
        CASE
            WHEN bp.subscription_status = ANY (ARRAY['active'::text, 'trialing'::text]) THEN COALESCE(pc.monthly_price_cents, 0)
            ELSE 0
        END AS mrr_cents
   FROM billing_profiles bp
     LEFT JOIN LATERAL ( SELECT sum(token_ledger.amount) AS total_credited
           FROM token_ledger
          WHERE token_ledger.user_id = bp.user_id AND token_ledger.direction = 'credit'::text) tl_credit ON true
     LEFT JOIN LATERAL ( SELECT sum(token_ledger.amount) AS total_debited
           FROM token_ledger
          WHERE token_ledger.user_id = bp.user_id AND token_ledger.direction = 'debit'::text) tl_debit ON true
     LEFT JOIN LATERAL ( SELECT sum(billing_invoices.total_cents) AS total_billed,
            sum(
                CASE
                    WHEN billing_invoices.status = 'succeeded'::text THEN billing_invoices.total_cents
                    ELSE 0
                END) AS total_paid
           FROM billing_invoices
          WHERE billing_invoices.user_id = bp.user_id) inv ON true
     LEFT JOIN LATERAL ( SELECT
                CASE bp.plan_code
                    WHEN 'starter'::text THEN 4900
                    WHEN 'pro'::text THEN 9900
                    WHEN 'promoteur_starter'::text THEN 7900
                    WHEN 'promoteur_pro'::text THEN 14900
                    WHEN 'financeur_pro'::text THEN 19900
                    ELSE 0
                END AS monthly_price_cents) pc ON true;

-- copilot_credits_balance
CREATE OR REPLACE VIEW public.copilot_credits_balance AS
 SELECT user_id,
    COALESCE(sum(amount), 0::bigint)::integer AS balance
   FROM copilot_credit_ledger
  GROUP BY user_id;

-- dvf_2025_s1_typed
CREATE OR REPLACE VIEW public.dvf_2025_s1_typed AS
 SELECT identifiant_document,
    reference_document,
        CASE
            WHEN date_mutation IS NULL OR btrim(date_mutation) = ''::text THEN NULL::date
            WHEN btrim(date_mutation) ~ '^\d{2}/\d{2}/\d{4}$'::text THEN to_date(btrim(date_mutation), 'DD/MM/YYYY'::text)
            WHEN btrim(date_mutation) ~ '^\d{4}-\d{2}-\d{2}$'::text THEN to_date(btrim(date_mutation), 'YYYY-MM-DD'::text)
            ELSE NULL::date
        END AS date_mutation,
    nature_mutation,
    replace(valeur_fonciere, ','::text, '.'::text)::numeric AS valeur_fonciere,
    code_departement,
    code_commune,
    commune,
    code_postal,
    type_local,
    NULLIF(replace(surface_reelle_bati, ','::text, '.'::text), ''::text)::numeric AS surface_reelle_bati,
    NULLIF(replace(surface_terrain, ','::text, '.'::text), ''::text)::numeric AS surface_terrain,
    NULLIF(nombre_pieces_principales, ''::text)::integer AS nombre_pieces_principales,
    nature_culture,
    nature_culture_speciale
   FROM dvf_2025_s1;

-- dvf_2025_s2_typed
CREATE OR REPLACE VIEW public.dvf_2025_s2_typed AS
 SELECT identifiant_document,
    reference_document,
        CASE
            WHEN date_mutation IS NULL OR btrim(date_mutation) = ''::text THEN NULL::date
            WHEN btrim(date_mutation) ~ '^\d{2}/\d{2}/\d{4}$'::text THEN to_date(btrim(date_mutation), 'DD/MM/YYYY'::text)
            WHEN btrim(date_mutation) ~ '^\d{4}-\d{2}-\d{2}$'::text THEN to_date(btrim(date_mutation), 'YYYY-MM-DD'::text)
            ELSE NULL::date
        END AS date_mutation,
    nature_mutation,
    replace(valeur_fonciere, ','::text, '.'::text)::numeric AS valeur_fonciere,
    code_departement,
    code_commune,
    commune,
    code_postal,
    type_local,
    NULLIF(replace(surface_reelle_bati, ','::text, '.'::text), ''::text)::numeric AS surface_reelle_bati,
    NULLIF(replace(surface_terrain, ','::text, '.'::text), ''::text)::numeric AS surface_terrain,
    NULLIF(nombre_pieces_principales, ''::text)::integer AS nombre_pieces_principales,
    nature_culture,
    nature_culture_speciale
   FROM dvf_2025_s2;

-- dvf_all
CREATE OR REPLACE VIEW public.dvf_all AS
 SELECT identifiant_document,
    reference_document,
    articles_cgi_1,
    articles_cgi_2,
    articles_cgi_3,
    articles_cgi_4,
    articles_cgi_5,
    no_disposition,
    date_mutation,
    nature_mutation,
    valeur_fonciere,
    no_voie,
    btq,
    type_voie,
    code_voie,
    voie,
    code_postal,
    commune,
    code_departement,
    code_commune,
    prefixe_section,
    section,
    no_plan,
    no_volume,
    lot1,
    surface_carrez_lot1,
    lot2,
    surface_carrez_lot2,
    lot3,
    surface_carrez_lot3,
    lot4,
    surface_carrez_lot4,
    lot5,
    surface_carrez_lot5,
    nombre_lots,
    code_type_local,
    type_local,
    identifiant_local,
    surface_reelle_bati,
    nombre_pieces_principales,
    nature_culture,
    nature_culture_speciale,
    surface_terrain
   FROM dvf_2025_s1;

-- dvf_mimmoza_24m_estimation
CREATE OR REPLACE VIEW public.dvf_mimmoza_24m_estimation AS
 SELECT id,
    identifiant_document,
    reference_document,
    date_mutation,
    nature_mutation,
    valeur_fonciere,
    code_departement,
    code_commune,
    commune,
    code_postal,
    commune_insee,
    type_local,
    surface_reelle_bati,
    surface_terrain,
    nombre_pieces_principales,
    nature_culture,
    nature_culture_speciale,
    prix_m2,
    source_period,
    source_file,
    imported_at
   FROM dvf_mimmoza_24m
  WHERE nature_mutation = 'Vente'::text AND (type_local = ANY (ARRAY['Maison'::text, 'Appartement'::text])) AND surface_reelle_bati IS NOT NULL AND surface_reelle_bati > 0::numeric AND valeur_fonciere IS NOT NULL AND valeur_fonciere > 0::numeric AND prix_m2 IS NOT NULL AND prix_m2 >= 300::numeric AND prix_m2 <= 30000::numeric;

-- geography_columns
-- ⚠️ VUE SYSTÈME POSTGIS — NEUTRALISÉE VOLONTAIREMENT
-- Cette vue appartient à l'extension PostGIS, pas à Mimmoza. La rejouer
-- écraserait la définition fournie par l'extension, et une version future de
-- PostGIS pourrait attendre une autre forme. Sa définition est conservée
-- ci-dessous à titre documentaire, en commentaire, pour que ce fichier reste
-- un instantané fidèle du schéma — mais elle ne s'exécute pas.
-- Pour la restaurer : réinstaller l'extension (CREATE EXTENSION postgis).
-- CREATE OR REPLACE VIEW public.geography_columns AS
--  SELECT current_database() AS f_table_catalog,
--     n.nspname AS f_table_schema,
--     c.relname AS f_table_name,
--     a.attname AS f_geography_column,
--     postgis_typmod_dims(a.atttypmod) AS coord_dimension,
--     postgis_typmod_srid(a.atttypmod) AS srid,
--     postgis_typmod_type(a.atttypmod) AS type
--    FROM pg_class c,
--     pg_attribute a,
--     pg_type t,
--     pg_namespace n
--   WHERE t.typname = 'geography'::name AND a.attisdropped = false AND a.atttypid = t.oid AND a.attrelid = c.oid AND c.relnamespace = n.oid AND (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND NOT pg_is_other_temp_schema(c.relnamespace) AND has_table_privilege(c.oid, 'SELECT'::text);

-- geometry_columns
-- ⚠️ VUE SYSTÈME POSTGIS — NEUTRALISÉE VOLONTAIREMENT
-- Cette vue appartient à l'extension PostGIS, pas à Mimmoza. La rejouer
-- écraserait la définition fournie par l'extension, et une version future de
-- PostGIS pourrait attendre une autre forme. Sa définition est conservée
-- ci-dessous à titre documentaire, en commentaire, pour que ce fichier reste
-- un instantané fidèle du schéma — mais elle ne s'exécute pas.
-- Pour la restaurer : réinstaller l'extension (CREATE EXTENSION postgis).
-- CREATE OR REPLACE VIEW public.geometry_columns AS
--  SELECT current_database()::character varying(256) AS f_table_catalog,
--     n.nspname AS f_table_schema,
--     c.relname AS f_table_name,
--     a.attname AS f_geometry_column,
--     COALESCE(postgis_typmod_dims(a.atttypmod), sn.ndims, 2) AS coord_dimension,
--     COALESCE(NULLIF(postgis_typmod_srid(a.atttypmod), 0), sr.srid, 0) AS srid,
--     replace(replace(COALESCE(NULLIF(upper(postgis_typmod_type(a.atttypmod)), 'GEOMETRY'::text), st.type, 'GEOMETRY'::text), 'ZM'::text, ''::text), 'Z'::text, ''::text)::character varying(30) AS type
--    FROM pg_class c
--      JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
--      JOIN pg_namespace n ON c.relnamespace = n.oid
--      JOIN pg_type t ON a.atttypid = t.oid
--      LEFT JOIN ( SELECT s.connamespace,
--             s.conrelid,
--             s.conkey,
--             replace(split_part(s.consrc, ''''::text, 2), ')'::text, ''::text) AS type
--            FROM ( SELECT pg_constraint.connamespace,
--                     pg_constraint.conrelid,
--                     pg_constraint.conkey,
--                     pg_get_constraintdef(pg_constraint.oid) AS consrc
--                    FROM pg_constraint) s
--           WHERE s.consrc ~~* '%geometrytype(% = %'::text) st ON st.connamespace = n.oid AND st.conrelid = c.oid AND (a.attnum = ANY (st.conkey))
--      LEFT JOIN ( SELECT s.connamespace,
--             s.conrelid,
--             s.conkey,
--             replace(split_part(s.consrc, ' = '::text, 2), ')'::text, ''::text)::integer AS ndims
--            FROM ( SELECT pg_constraint.connamespace,
--                     pg_constraint.conrelid,
--                     pg_constraint.conkey,
--                     pg_get_constraintdef(pg_constraint.oid) AS consrc
--                    FROM pg_constraint) s
--           WHERE s.consrc ~~* '%ndims(% = %'::text) sn ON sn.connamespace = n.oid AND sn.conrelid = c.oid AND (a.attnum = ANY (sn.conkey))
--      LEFT JOIN ( SELECT s.connamespace,
--             s.conrelid,
--             s.conkey,
--             replace(replace(split_part(s.consrc, ' = '::text, 2), ')'::text, ''::text), '('::text, ''::text)::integer AS srid
--            FROM ( SELECT pg_constraint.connamespace,
--                     pg_constraint.conrelid,
--                     pg_constraint.conkey,
--                     pg_get_constraintdef(pg_constraint.oid) AS consrc
--                    FROM pg_constraint) s
--           WHERE s.consrc ~~* '%srid(% = %'::text) sr ON sr.connamespace = n.oid AND sr.conrelid = c.oid AND (a.attnum = ANY (sr.conkey))
--   WHERE (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND NOT c.relname = 'raster_columns'::name AND t.typname = 'geometry'::name AND NOT pg_is_other_temp_schema(c.relnamespace) AND has_table_privilege(c.oid, 'SELECT'::text);

-- listings_opportunity_base
CREATE OR REPLACE VIEW public.listings_opportunity_base AS
 SELECT id,
    portal,
    listing_portal_id,
    url,
    city,
    zip_code,
    price,
    surface,
    COALESCE(price_m2, round(price / NULLIF(surface, 0::numeric), 0)) AS price_m2,
    first_seen_at,
    seen_at,
    canonical_key,
        CASE
            WHEN first_seen_at IS NULL THEN 0
            ELSE GREATEST(0::numeric, EXTRACT(day FROM now() - first_seen_at))::integer
        END AS days_on_market
   FROM portal_snapshots;

-- listings_with_price_m2
CREATE OR REPLACE VIEW public.listings_with_price_m2 AS
 SELECT id,
    portal,
    listing_portal_id,
    url,
    city,
    zip_code,
    price,
    surface,
    COALESCE(price_m2, round(price / NULLIF(surface, 0::numeric), 0)) AS computed_price_m2,
    first_seen_at,
    seen_at,
    canonical_key
   FROM portal_snapshots;

-- macro_rates_latest
CREATE OR REPLACE VIEW public.macro_rates_latest AS
 SELECT DISTINCT ON (series_key) series_key,
    rate_date,
    value_pct,
    source,
    as_of
   FROM macro_rates
  ORDER BY series_key, rate_date DESC;

-- market_cp_latest
CREATE OR REPLACE VIEW public.market_cp_latest AS
 SELECT m.month,
    m.code_postal,
    m.prix_m2_median_6m,
    m.volume_tx_6m,
    m.momentum_3m_pct,
    m.dispersion_iqr,
    m.data_quality,
    m.computed_at
   FROM market_cp_features_monthly m
     JOIN ( SELECT max(market_cp_features_monthly.month) AS month
           FROM market_cp_features_monthly
          WHERE (market_cp_features_monthly.data_quality ->> 'source'::text) = 'dvf_prix_m2'::text) last ON m.month = last.month
  WHERE (m.data_quality ->> 'source'::text) = 'dvf_prix_m2'::text;

-- market_listing_age
CREATE OR REPLACE VIEW public.market_listing_age AS
 SELECT canonical_key,
    zip_code,
    city,
    first_seen_at,
    last_seen_at,
    EXTRACT(epoch FROM last_seen_at - first_seen_at) / 86400.0 AS days_on_market
   FROM listings_canonical
  WHERE first_seen_at IS NOT NULL AND last_seen_at IS NOT NULL;

-- market_listing_duration
CREATE OR REPLACE VIEW public.market_listing_duration AS
 SELECT zip_code,
    city,
    avg(EXTRACT(epoch FROM last_seen_at - first_seen_at) / 86400.0) AS avg_days_on_market
   FROM listings_canonical
  WHERE first_seen_at IS NOT NULL AND last_seen_at IS NOT NULL
  GROUP BY zip_code, city;

-- market_multi_portal_rate
CREATE OR REPLACE VIEW public.market_multi_portal_rate AS
 SELECT zip_code,
    city,
    count(*) AS total_listings,
    sum(
        CASE
            WHEN portal_count > 1 THEN 1
            ELSE 0
        END) AS multi_portal,
    round(100.0 * sum(
        CASE
            WHEN portal_count > 1 THEN 1
            ELSE 0
        END)::numeric / NULLIF(count(*), 0)::numeric, 2) AS multi_portal_pct
   FROM listings_canonical
  GROUP BY zip_code, city;

-- market_new_listings_30d
CREATE OR REPLACE VIEW public.market_new_listings_30d AS
 SELECT zip_code,
    city,
    count(*) AS new_unique_listings
   FROM listings_canonical
  WHERE first_seen_at >= (now() - '30 days'::interval)
  GROUP BY zip_code, city;

-- market_new_listings_7d
CREATE OR REPLACE VIEW public.market_new_listings_7d AS
 SELECT zip_code,
    city,
    count(*) AS new_unique_listings
   FROM listings_canonical
  WHERE first_seen_at >= (now() - '7 days'::interval)
  GROUP BY zip_code, city;

-- market_price_change_counts
CREATE OR REPLACE VIEW public.market_price_change_counts AS
 WITH ordered AS (
         SELECT listing_price_history.canonical_key,
            listing_price_history.zip_code,
            listing_price_history.city,
            listing_price_history.observed_at,
            listing_price_history.price,
            lag(listing_price_history.price) OVER (PARTITION BY listing_price_history.canonical_key ORDER BY listing_price_history.observed_at) AS prev_price
           FROM listing_price_history
        )
 SELECT canonical_key,
    zip_code,
    city,
    count(*) FILTER (WHERE prev_price IS NOT NULL AND price <> prev_price) AS price_change_count,
    count(*) FILTER (WHERE prev_price IS NOT NULL AND price < prev_price) AS price_drop_count,
    count(*) FILTER (WHERE prev_price IS NOT NULL AND price > prev_price) AS price_raise_count
   FROM ordered
  GROUP BY canonical_key, zip_code, city;

-- market_price_drops_summary
CREATE OR REPLACE VIEW public.market_price_drops_summary AS
 WITH ordered AS (
         SELECT listing_price_history.canonical_key,
            listing_price_history.zip_code,
            listing_price_history.city,
            listing_price_history.observed_at,
            listing_price_history.price,
            lag(listing_price_history.price) OVER (PARTITION BY listing_price_history.canonical_key ORDER BY listing_price_history.observed_at) AS prev_price
           FROM listing_price_history
        ), drops AS (
         SELECT ordered.canonical_key,
            ordered.zip_code,
            ordered.city,
            ordered.observed_at,
            ordered.price,
            ordered.prev_price
           FROM ordered
          WHERE ordered.prev_price IS NOT NULL AND ordered.price < ordered.prev_price
        )
 SELECT zip_code,
    city,
    count(DISTINCT canonical_key) FILTER (WHERE observed_at >= (now() - '7 days'::interval)) AS price_drops_7d,
    count(DISTINCT canonical_key) FILTER (WHERE observed_at >= (now() - '30 days'::interval)) AS price_drops_30d
   FROM drops
  GROUP BY zip_code, city;

-- market_price_first
CREATE OR REPLACE VIEW public.market_price_first AS
 SELECT DISTINCT ON (canonical_key) canonical_key,
    zip_code,
    city,
    observed_at AS first_observed_at,
    price AS first_price
   FROM listing_price_history
  ORDER BY canonical_key, observed_at, created_at;

-- market_price_last
CREATE OR REPLACE VIEW public.market_price_last AS
 SELECT DISTINCT ON (canonical_key) canonical_key,
    zip_code,
    city,
    observed_at AS last_observed_at,
    price AS last_price,
    surface,
    price_m2
   FROM listing_price_history
  ORDER BY canonical_key, observed_at DESC, created_at DESC;

-- market_reference_local
CREATE OR REPLACE VIEW public.market_reference_local AS
 SELECT zip_code,
    city,
    avg(price_m2) AS market_avg_price_m2,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (price_m2::double precision)) AS market_median_price_m2,
    count(*) AS sample_size
   FROM listings_canonical
  WHERE price_m2 IS NOT NULL
  GROUP BY zip_code, city;

-- market_stock_trend
CREATE OR REPLACE VIEW public.market_stock_trend AS
 WITH base AS (
         SELECT h.id,
            h.snapshot_date,
            h.zip_code,
            h.city,
            h.unique_listings,
            h.new_7d,
            h.new_30d,
            h.multi_portal_pct,
            h.avg_price,
            h.avg_price_m2,
            h.avg_days_on_market,
            h.price_drops_7d,
            h.price_drops_30d,
            h.created_at,
            lag(h.unique_listings, 7) OVER (PARTITION BY h.zip_code, h.city ORDER BY h.snapshot_date) AS unique_listings_7d_ago,
            lag(h.unique_listings, 30) OVER (PARTITION BY h.zip_code, h.city ORDER BY h.snapshot_date) AS unique_listings_30d_ago
           FROM market_stock_history h
        )
 SELECT snapshot_date,
    zip_code,
    city,
    unique_listings,
    unique_listings_7d_ago,
    unique_listings_30d_ago,
    unique_listings - unique_listings_7d_ago AS stock_change_7d,
    unique_listings - unique_listings_30d_ago AS stock_change_30d,
        CASE
            WHEN unique_listings_7d_ago IS NOT NULL AND unique_listings_7d_ago > 0 THEN round((unique_listings - unique_listings_7d_ago)::numeric / unique_listings_7d_ago::numeric * 100.0, 2)
            ELSE NULL::numeric
        END AS stock_change_7d_pct,
        CASE
            WHEN unique_listings_30d_ago IS NOT NULL AND unique_listings_30d_ago > 0 THEN round((unique_listings - unique_listings_30d_ago)::numeric / unique_listings_30d_ago::numeric * 100.0, 2)
            ELSE NULL::numeric
        END AS stock_change_30d_pct
   FROM base;

-- market_unique_stock
CREATE OR REPLACE VIEW public.market_unique_stock AS
 SELECT zip_code,
    city,
    count(*) AS unique_listings,
    avg(price) AS avg_price,
    avg(price_m2) AS avg_price_m2,
    avg(surface) AS avg_surface,
    sum(
        CASE
            WHEN portal_count > 1 THEN 1
            ELSE 0
        END) AS multi_portal_listings
   FROM listings_canonical
  GROUP BY zip_code, city;

-- my_account_context
CREATE OR REPLACE VIEW public.my_account_context AS
 SELECT auth.uid() AS user_id,
    is_current_user_admin() AS is_admin;

-- plu_manual_rulesets_flat
CREATE OR REPLACE VIEW public.plu_manual_rulesets_flat AS
 SELECT id,
    commune_insee,
    commune_nom,
    zone_code,
    plu_version_label,
    ruleset -> 'implantation'::text AS implantation,
    ruleset -> 'reculs'::text AS reculs,
    ruleset -> 'hauteur'::text AS hauteur,
    ruleset -> 'emprise'::text AS emprise,
    ruleset -> 'stationnement'::text AS stationnement,
    ruleset AS ruleset_raw,
    created_at,
    updated_at
   FROM plu_manual_rulesets;

-- plu_rulesets_resolved
CREATE OR REPLACE VIEW public.plu_rulesets_resolved AS
 SELECT COALESCE(m.commune_insee, u.commune_insee) AS commune_insee,
    COALESCE(m.commune_nom, u.commune_nom) AS commune_nom,
    COALESCE(m.zone_code, u.zone_code) AS zone_code,
    u.zone_libelle,
    COALESCE(m.plu_version_label, u.plu_version_label) AS plu_version_label,
    COALESCE(m.plu_source_type, 'UNIVERSAL'::text) AS source_type,
    COALESCE(m.plu_source_url, NULL::text) AS source_url,
    COALESCE(m.plu_source_page_range, NULL::text) AS source_page_range,
    u.source_document AS universal_source_document,
    COALESCE(m.ruleset, u.ruleset) AS ruleset,
        CASE
            WHEN m.id IS NOT NULL THEN 'MANUAL'::text
            ELSE 'UNIVERSAL'::text
        END AS source
   FROM plu_rulesets_universal u
     LEFT JOIN plu_manual_rulesets m ON m.commune_insee = u.commune_insee AND m.zone_code = u.zone_code AND COALESCE(m.plu_version_label, 'DEFAULT'::text) = COALESCE(u.plu_version_label, 'DEFAULT'::text);

-- plu_zone_base_v1
CREATE OR REPLACE VIEW public.plu_zone_base_v1 AS
 WITH candidates AS (
         SELECT z.document_id,
            z.commune_insee,
            upper(TRIM(BOTH FROM z.zone_code)) AS zone_code_norm,
            TRIM(BOTH FROM z.zone_code) AS zone_code,
            z.zone_libelle,
            'NORMALIZED'::text AS origin,
            3 AS priority
           FROM plu_zone_rules_normalized z
          WHERE z.zone_code IS NOT NULL AND TRIM(BOTH FROM z.zone_code) <> ''::text
        UNION ALL
         SELECT a.document_id,
            a.commune_insee,
            upper(TRIM(BOTH FROM a.zone_code)) AS zone_code_norm,
            TRIM(BOTH FROM a.zone_code) AS zone_code,
            NULL::text AS zone_libelle,
            'AI'::text AS origin,
            2 AS priority
           FROM plu_rulesets_ai a
          WHERE a.zone_code IS NOT NULL AND TRIM(BOTH FROM a.zone_code) <> ''::text
        UNION ALL
         SELECT o.document_id,
            NULL::text AS commune_insee,
            upper(TRIM(BOTH FROM o.zone_code)) AS zone_code_norm,
            TRIM(BOTH FROM o.zone_code) AS zone_code,
            NULL::text AS zone_libelle,
            'USER'::text AS origin,
            1 AS priority
           FROM plu_user_overrides_v1 o
          WHERE o.zone_code IS NOT NULL AND TRIM(BOTH FROM o.zone_code) <> ''::text
        ), ranked AS (
         SELECT candidates.document_id,
            candidates.commune_insee,
            candidates.zone_code_norm,
            candidates.zone_code,
            candidates.zone_libelle,
            candidates.origin,
            candidates.priority,
            row_number() OVER (PARTITION BY candidates.document_id, candidates.zone_code_norm ORDER BY candidates.priority DESC) AS rn
           FROM candidates
        )
 SELECT document_id,
    commune_insee,
    zone_code_norm,
    zone_code,
    zone_libelle,
    origin
   FROM ranked
  WHERE rn = 1;

-- plu_zone_rules_resolved_reculs_v1
CREATE OR REPLACE VIEW public.plu_zone_rules_resolved_reculs_v1 AS
 WITH base AS (
         SELECT z.id AS zone_row_id,
            z.created_at,
            z.document_id,
            z.commune_insee,
            z.zone_code,
            z.zone_libelle,
            z.confidence_score,
            z.source AS base_source,
            z.rules AS base_rules
           FROM plu_zone_rules_normalized z
        ), ai AS (
         SELECT a_1.document_id,
            a_1.zone_code,
            a_1.confidence_score AS ai_confidence_score,
            a_1.updated_at AS ai_updated_at,
            a_1.raw_extract AS ai_raw
           FROM plu_rulesets_ai a_1
        ), u AS (
         SELECT o.document_id,
            upper(TRIM(BOTH FROM o.zone_code)) AS zone_code_norm,
            o.overrides AS user_overrides,
            o.updated_at AS user_updated_at
           FROM plu_user_overrides_v1 o
        )
 SELECT b.zone_row_id,
    b.created_at,
    b.document_id,
    b.commune_insee,
    b.zone_code,
    b.zone_libelle,
    b.confidence_score,
    b.base_source,
    a.ai_confidence_score,
    a.ai_updated_at,
    u.user_updated_at,
    COALESCE((u.user_overrides #>> '{reculs,voirie_min_m}'::text[])::numeric, parse_fr_number(a.ai_raw #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,voirie,value}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_voirie_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,min}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,value}'::text[])) AS recul_voirie_min_m,
    COALESCE((u.user_overrides #>> '{reculs,limites_separatives_min_m}'::text[])::numeric, parse_fr_number(a.ai_raw #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,limites_separatives,value}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_limite_separative_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_limites_separatives_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,limites_separatives,min}'::text[])) AS recul_limites_separatives_min_m,
    COALESCE((u.user_overrides #>> '{reculs,fond_parcelle_min_m}'::text[])::numeric, parse_fr_number(a.ai_raw #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,fond_parcelle,value}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,fond_parcelle,min}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_fond_parcelle_min_m}'::text[])) AS recul_fond_parcelle_min_m,
    COALESCE(NULLIF(u.user_overrides #>> '{reculs,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(a.ai_raw #>> '{implantation,implantation_en_limite,value}'::text[], ''::text)::boolean, NULLIF(a.ai_raw #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean, NULLIF(b.base_rules #>> '{implantation,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(b.base_rules #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean) AS implantation_en_limite_autorisee,
    COALESCE((u.user_overrides #>> '{reculs,voirie_min_m}'::text[])::numeric, parse_fr_number(a.ai_raw #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_voirie_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,min_m}'::text[])) IS NOT NULL AND COALESCE((u.user_overrides #>> '{reculs,limites_separatives_min_m}'::text[])::numeric, parse_fr_number(a.ai_raw #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_limites_separatives_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,limites_separatives,min_m}'::text[])) IS NOT NULL AND COALESCE((u.user_overrides #>> '{reculs,fond_parcelle_min_m}'::text[])::numeric, parse_fr_number(a.ai_raw #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_raw #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,fond_parcelle,min_m}'::text[])) IS NOT NULL AS reculs_complets_ok
   FROM base b
     LEFT JOIN ai a ON a.document_id = b.document_id AND upper(TRIM(BOTH FROM a.zone_code)) = upper(TRIM(BOTH FROM b.zone_code))
     LEFT JOIN u ON u.document_id = b.document_id AND u.zone_code_norm = upper(TRIM(BOTH FROM b.zone_code));

-- plu_zone_rules_resolved_reculs_v2
CREATE OR REPLACE VIEW public.plu_zone_rules_resolved_reculs_v2 AS
 WITH base AS (
         SELECT z.id AS zone_row_id,
            z.created_at,
            z.document_id,
            z.commune_insee,
            z.zone_code,
            z.zone_libelle,
            z.confidence_score AS base_confidence_score,
            z.source AS base_source,
            z.rules AS base_rules
           FROM plu_zone_rules_normalized z
        ), ai AS (
         SELECT a_1.document_id,
            upper(TRIM(BOTH FROM a_1.zone_code)) AS zone_code_norm,
            a_1.updated_at AS ai_updated_at,
            a_1.engine,
            a_1.model,
            a_1.prompt_version,
            a_1.completeness_ok AS ai_completeness_ok,
            a_1.missing AS ai_missing,
            a_1.confidence_score AS ai_confidence_score,
            a_1.error AS ai_error,
            a_1.ruleset AS ai_ruleset,
            a_1.raw_extract AS ai_raw_extract
           FROM plu_rulesets_ai a_1
        ), u AS (
         SELECT o.document_id,
            upper(TRIM(BOTH FROM o.zone_code)) AS zone_code_norm,
            o.updated_at AS user_updated_at,
            o.overrides AS user_overrides
           FROM plu_user_overrides_v1 o
        )
 SELECT b.zone_row_id,
    b.created_at,
    b.document_id,
    b.commune_insee,
    b.zone_code,
    b.zone_libelle,
    b.base_source,
    b.base_confidence_score,
    a.ai_updated_at,
    a.engine AS ai_engine,
    a.model AS ai_model,
    a.prompt_version AS ai_prompt_version,
    a.ai_completeness_ok,
    a.ai_missing,
    a.ai_confidence_score,
    a.ai_error,
    u.user_updated_at,
    COALESCE((u.user_overrides #>> '{reculs,voirie_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,voirie,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voirie_min_m}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_voirie_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,min}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,value}'::text[])) AS recul_voirie_min_m,
    COALESCE((u.user_overrides #>> '{reculs,limites_separatives_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,limites_separatives,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limite_separative_min_m}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limites_separatives_min_m}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_limite_separative_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_limites_separatives_min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,limites_separatives,min}'::text[])) AS recul_limites_separatives_min_m,
    COALESCE((u.user_overrides #>> '{reculs,fond_parcelle_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,fond_parcelle,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_fond_parcelle_min_m}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,fond_parcelle,min}'::text[]), parse_fr_number(b.base_rules #>> '{implantation,recul_fond_parcelle_min_m}'::text[])) AS recul_fond_parcelle_min_m,
    COALESCE(NULLIF(u.user_overrides #>> '{reculs,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(a.ai_ruleset #>> '{implantation,implantation_en_limite,value}'::text[], ''::text)::boolean, NULLIF(a.ai_ruleset #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean, NULLIF(a.ai_ruleset #>> '{implantation,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(a.ai_raw_extract #>> '{implantation,implantation_en_limite,value}'::text[], ''::text)::boolean, NULLIF(a.ai_raw_extract #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean, NULLIF(b.base_rules #>> '{implantation,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(b.base_rules #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean) AS implantation_en_limite_autorisee,
    COALESCE((u.user_overrides #>> '{reculs,voirie_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,voirie,min_m}'::text[])) IS NOT NULL AND COALESCE((u.user_overrides #>> '{reculs,limites_separatives_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,limites_separatives,min_m}'::text[])) IS NOT NULL AND COALESCE((u.user_overrides #>> '{reculs,fond_parcelle_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(b.base_rules #>> '{reculs,fond_parcelle,min_m}'::text[])) IS NOT NULL AS reculs_complets_ok
   FROM base b
     LEFT JOIN ai a ON a.document_id = b.document_id AND a.zone_code_norm = upper(TRIM(BOTH FROM b.zone_code))
     LEFT JOIN u ON u.document_id = b.document_id AND u.zone_code_norm = upper(TRIM(BOTH FROM b.zone_code));

-- smartscore_stats_by_dept
-- NOTE : vue MATERIALISEE. CREATE OR REPLACE n'existe pas pour les vues
-- materialisees en PostgreSQL : on utilise donc CREATE MATERIALIZED VIEW
-- IF NOT EXISTS. Pour en modifier la definition, il faut la DROPper
-- explicitement au prealable.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.smartscore_stats_by_dept AS
 SELECT project_nature,
    departement,
    zone_type,
    count(*) AS sample_size,
    round(avg(score_global)) AS avg_score,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (score_global::double precision)) AS median_score,
    percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (score_global::double precision)) AS q1_score,
    percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (score_global::double precision)) AS q3_score,
    min(score_global) AS min_score,
    max(score_global) AS max_score
   FROM smartscore_history
  WHERE computed_at >= (now() - '1 year'::interval)
  GROUP BY project_nature, departement, zone_type;

-- v_active_property_clusters
CREATE OR REPLACE VIEW public.v_active_property_clusters AS
 SELECT c.id,
    c.normalized_address,
    c.city,
    c.zip_code,
    c.insee_code,
    c.first_seen_at,
    c.last_seen_at,
    c.is_active,
    c.canonical_price,
    c.canonical_price_m2,
    c.canonical_surface_m2,
    count(l.id) AS active_listing_count
   FROM property_clusters c
     LEFT JOIN property_listings l ON l.property_cluster_id = c.id AND l.is_active = true
  WHERE c.is_active = true
  GROUP BY c.id, c.normalized_address, c.city, c.zip_code, c.insee_code, c.first_seen_at, c.last_seen_at, c.is_active, c.canonical_price, c.canonical_price_m2, c.canonical_surface_m2;

-- v_apporteur_deals_pool
CREATE OR REPLACE VIEW public.v_apporteur_deals_pool AS
 SELECT d.id,
    d.created_at,
    d.status,
    d.type_bien,
    d.surface_terrain_m2,
    d.prix_vendeur,
    d.reserve_par,
    d.reserve_jusqu_a,
    d.transmis_a,
    d.promoteur_study_id,
    cout_deblocage_deal(d.prix_vendeur) AS cout_deblocage,
    u.id IS NOT NULL AS est_debloque,
        CASE
            WHEN u.id IS NOT NULL THEN d.adresse
            ELSE NULL::text
        END AS adresse,
        CASE
            WHEN u.id IS NOT NULL THEN d.commune
            ELSE NULL::text
        END AS commune,
        CASE
            WHEN u.id IS NOT NULL THEN d.code_postal
            ELSE NULL::text
        END AS code_postal,
        CASE
            WHEN u.id IS NOT NULL THEN d.commentaire
            ELSE NULL::text
        END AS commentaire,
        CASE
            WHEN u.id IS NOT NULL THEN d.apporteur_name
            ELSE NULL::text
        END AS apporteur_name,
        CASE
            WHEN u.id IS NOT NULL THEN d.apporteur_email
            ELSE NULL::text
        END AS apporteur_email,
        CASE
            WHEN u.id IS NOT NULL THEN d.apporteur_phone
            ELSE NULL::text
        END AS apporteur_phone,
    "left"(d.code_postal, 2) AS departement,
    d.reserve_par IS NOT NULL AND d.reserve_jusqu_a > now() AND d.reserve_par <> auth.uid() AS reserve_par_autre
   FROM apporteur_deals d
     LEFT JOIN deal_unlocks u ON u.deal_id = d.id AND u.user_id = auth.uid() AND u.source = 'apporteur'::text
  WHERE d.user_id <> auth.uid() AND d.status <> 'refuse'::text AND (u.id IS NOT NULL OR d.transmis_a IS NULL AND d.reserve_par IS NULL OR d.transmis_a = auth.uid() OR d.reserve_par = auth.uid());

-- v_commune_population
CREATE OR REPLACE VIEW public.v_commune_population AS
 WITH base AS (
         SELECT TRIM(BOTH FROM insee_pop2_raw."CODGEO") AS commune_insee,
            NULLIF(TRIM(BOTH FROM insee_pop2_raw."NB"), ''::text)::numeric AS nb_num,
            insee_pop2_raw."SEXE" AS sexe,
            insee_pop2_raw."CATPR" AS catpr,
            TRIM(BOTH FROM insee_pop2_raw."AGEQ100") AS ageq100
           FROM insee_pop2_raw
          WHERE TRIM(BOTH FROM insee_pop2_raw."CODGEO") <> ''::text
        ), agg AS (
         SELECT base.commune_insee,
            max(
                CASE
                    WHEN base.sexe = 0 AND base.catpr = 0 AND (base.ageq100 = ANY (ARRAY['TOT'::text, 'TOTAL'::text, '0'::text, '00'::text, '000'::text])) THEN base.nb_num
                    ELSE NULL::numeric
                END) AS nb_total_row,
            sum(base.nb_num) AS nb_sum_all
           FROM base
          GROUP BY base.commune_insee
        )
 SELECT commune_insee,
    COALESCE(nb_total_row, nb_sum_all)::bigint AS population,
        CASE
            WHEN nb_total_row IS NOT NULL THEN 'total_row'::text
            ELSE 'sum_all'::text
        END AS method
   FROM agg;

-- v_insee_socioeco_communes_latest
CREATE OR REPLACE VIEW public.v_insee_socioeco_communes_latest AS
 SELECT DISTINCT ON (code_commune) code_commune,
    commune,
    annee,
    revenu_median_eur,
    taux_pauvrete_pct,
    source,
    updated_at
   FROM insee_socioeco_communes
  ORDER BY code_commune, annee DESC, updated_at DESC;

-- v_main_stations
CREATE OR REPLACE VIEW public.v_main_stations AS
 SELECT id,
    stop_name,
    stop_code,
    mode,
    lat,
    lon,
    has_tgv,
    has_ter,
    line_ids,
    city_name,
    dept_code,
    region_code,
    minutes_to_cbd
   FROM mobility_stops
  WHERE is_main_station = true
  ORDER BY stop_name;

-- v_market_active_listings
CREATE OR REPLACE VIEW public.v_market_active_listings AS
 SELECT id,
    external_id,
    external_source,
    source_portal,
    source_listing_id,
    source_url,
    title,
    price,
    price_per_m2,
    surface_m2,
    rooms,
    bedrooms,
    property_type,
    transaction_type,
    city,
    zip_code,
    insee_code,
    department_code,
    region_name,
    latitude,
    longitude,
    energy_label,
    ghg_label,
    coherent_price,
        CASE
            WHEN jsonb_typeof(pictures) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(market_source_listings.pictures) AS jsonb_array_elements_text)
            ELSE NULL::text[]
        END AS pictures,
    first_seen_at,
    last_seen_at,
    last_crawled_at
   FROM market_source_listings
  WHERE COALESCE(expired, false) = false;

-- v_market_dynamic_insights
CREATE OR REPLACE VIEW public.v_market_dynamic_insights AS
 SELECT commune_code,
    commune_nom,
    evolution_5ans,
    nb_transactions_12m,
        CASE
            WHEN evolution_5ans >= 25::numeric THEN 'forte progression'::text
            WHEN evolution_5ans >= 10::numeric THEN 'progression modérée'::text
            WHEN evolution_5ans >= '-5'::integer::numeric THEN 'stable'::text
            WHEN evolution_5ans < '-5'::integer::numeric THEN 'en baisse'::text
            ELSE 'données insuffisantes'::text
        END AS dynamique_prix,
        CASE
            WHEN evolution_5ans >= 25::numeric AND nb_transactions_12m >= 20 THEN 90
            WHEN evolution_5ans >= 10::numeric AND nb_transactions_12m >= 10 THEN 75
            WHEN evolution_5ans >= '-5'::integer::numeric THEN 55
            WHEN evolution_5ans < '-5'::integer::numeric THEN 30
            ELSE NULL::integer
        END AS score_progression
   FROM dvf_aggregates;

-- v_market_price_analysis
CREATE OR REPLACE VIEW public.v_market_price_analysis AS
 SELECT d.id,
    d.code_commune,
    d.commune,
    d.type_local,
    d.valeur_fonciere,
    d.surface_reelle_bati,
    d.prix_m2,
        CASE
            WHEN d.type_local ~~* '%appartement%'::text THEN a.prix_m2_median_appartement
            WHEN d.type_local ~~* '%maison%'::text THEN a.prix_m2_median_maison
            ELSE NULL::numeric
        END AS prix_m2_marche,
        CASE
            WHEN
            CASE
                WHEN d.type_local ~~* '%appartement%'::text THEN a.prix_m2_median_appartement
                WHEN d.type_local ~~* '%maison%'::text THEN a.prix_m2_median_maison
                ELSE NULL::numeric
            END IS NOT NULL THEN round((d.prix_m2 -
            CASE
                WHEN d.type_local ~~* '%appartement%'::text THEN a.prix_m2_median_appartement
                WHEN d.type_local ~~* '%maison%'::text THEN a.prix_m2_median_maison
                ELSE NULL::numeric
            END) /
            CASE
                WHEN d.type_local ~~* '%appartement%'::text THEN a.prix_m2_median_appartement
                WHEN d.type_local ~~* '%maison%'::text THEN a.prix_m2_median_maison
                ELSE NULL::numeric
            END * 100::numeric, 2)
            ELSE NULL::numeric
        END AS ecart_marche_pct
   FROM dvf_mimmoza_24m d
     LEFT JOIN dvf_aggregates a ON a.commune_code = d.code_commune;

-- v_market_price_reference_latest
CREATE OR REPLACE VIEW public.v_market_price_reference_latest AS
 SELECT DISTINCT ON (city, zip_code) city,
    zip_code,
    reference_date,
    median_price_m2,
    avg_price_m2,
    sample_size,
    source,
    confidence_score
   FROM market_price_reference r
  ORDER BY city, zip_code, reference_date DESC, created_at DESC;

-- v_parcelles_constructibilite
CREATE OR REPLACE VIEW public.v_parcelles_constructibilite AS
 WITH bati_par_parcelle AS (
         SELECT p.id AS parcelle_id,
            p.code_departement,
            p.code_commune,
            p.commune,
            p.section,
            p.numero,
            p.geom AS parcelle_geom,
            st_area(p.geom::geography) AS surface_parcelle_m2,
            sum(st_area(st_intersection(b.geom, p.geom)::geography)) AS surface_batie_calc_m2
           FROM cadastre_parcelles p
             LEFT JOIN cadastre_batiments b ON st_intersects(b.geom, p.geom)
          GROUP BY p.id, p.code_departement, p.code_commune, p.commune, p.section, p.numero, p.geom
        )
 SELECT parcelle_id,
    code_departement,
    code_commune,
    commune,
    section,
    numero,
    surface_parcelle_m2,
    LEAST(GREATEST(COALESCE(surface_batie_calc_m2, 0::double precision), 0::double precision), surface_parcelle_m2) AS surface_batie_m2,
    LEAST(1::double precision, GREATEST(
        CASE
            WHEN surface_parcelle_m2 > 0::double precision THEN round((COALESCE(surface_batie_calc_m2, 0::double precision) / surface_parcelle_m2)::numeric, 4)::double precision
            ELSE NULL::double precision
        END, 0::double precision)) AS taux_occupation_sol,
    GREATEST(round((surface_parcelle_m2 - LEAST(COALESCE(surface_batie_calc_m2, 0::double precision), surface_parcelle_m2))::numeric, 4)::double precision, 0::double precision) AS potentiel_residuel_m2
   FROM bati_par_parcelle;

-- v_property_cluster_match_candidates
CREATE OR REPLACE VIEW public.v_property_cluster_match_candidates AS
 SELECT id AS property_cluster_id,
    city,
    zip_code,
    normalized_address,
    canonical_surface_m2,
    canonical_price,
    rooms,
    bedrooms,
    property_type,
    is_active
   FROM property_clusters c
  WHERE is_active = true;

-- v_property_daily_score_movements
CREATE OR REPLACE VIEW public.v_property_daily_score_movements AS
 WITH ordered AS (
         SELECT s.property_cluster_id,
            s.observed_date,
            s.opportunity_score,
            s.opportunity_bucket,
            s.negotiation_leverage_score,
            s.negotiation_leverage_bucket,
            s.recommendation_confidence_score,
            s.recommendation_confidence_bucket,
            s.market_position_bucket,
            s.price_m2_gap_vs_market_pct,
            s.price_gap_vs_market_value,
            s.canonical_price,
            s.canonical_price_m2,
            s.price_drop_events,
            s.days_on_market,
            s.memo_decision_bucket,
            lag(s.opportunity_score) OVER (PARTITION BY s.property_cluster_id ORDER BY s.observed_date) AS prev_opportunity_score,
            lag(s.opportunity_bucket) OVER (PARTITION BY s.property_cluster_id ORDER BY s.observed_date) AS prev_opportunity_bucket,
            lag(s.recommendation_confidence_score) OVER (PARTITION BY s.property_cluster_id ORDER BY s.observed_date) AS prev_recommendation_confidence_score,
            lag(s.memo_decision_bucket) OVER (PARTITION BY s.property_cluster_id ORDER BY s.observed_date) AS prev_memo_decision_bucket,
            lag(s.canonical_price) OVER (PARTITION BY s.property_cluster_id ORDER BY s.observed_date) AS prev_canonical_price,
            lag(s.price_gap_vs_market_value) OVER (PARTITION BY s.property_cluster_id ORDER BY s.observed_date) AS prev_price_gap_vs_market_value
           FROM property_daily_scores s
        )
 SELECT o.property_cluster_id,
    o.observed_date,
    o.opportunity_score,
    o.opportunity_bucket,
    o.negotiation_leverage_score,
    o.negotiation_leverage_bucket,
    o.recommendation_confidence_score,
    o.recommendation_confidence_bucket,
    o.market_position_bucket,
    o.price_m2_gap_vs_market_pct,
    o.price_gap_vs_market_value,
    o.canonical_price,
    o.canonical_price_m2,
    o.price_drop_events,
    o.days_on_market,
    o.memo_decision_bucket,
    o.prev_opportunity_score,
    o.prev_opportunity_bucket,
    o.prev_recommendation_confidence_score,
    o.prev_memo_decision_bucket,
    o.prev_canonical_price,
    o.prev_price_gap_vs_market_value,
    c.city,
    c.zip_code,
    c.normalized_address,
    o.opportunity_score - o.prev_opportunity_score AS delta_opportunity_score,
    o.recommendation_confidence_score - o.prev_recommendation_confidence_score AS delta_confidence_score,
    o.canonical_price - o.prev_canonical_price AS delta_price,
    o.price_gap_vs_market_value - o.prev_price_gap_vs_market_value AS delta_market_gap_value
   FROM ordered o
     JOIN property_clusters c ON c.id = o.property_cluster_id;

-- v_property_price_movements
CREATE OR REPLACE VIEW public.v_property_price_movements AS
 WITH ordered AS (
         SELECT h.property_cluster_id,
            h.observed_date,
            h.price,
            h.price_m2,
            h.source_count,
            lag(h.price) OVER (PARTITION BY h.property_cluster_id ORDER BY h.observed_date) AS previous_price,
            lag(h.price_m2) OVER (PARTITION BY h.property_cluster_id ORDER BY h.observed_date) AS previous_price_m2,
            lag(h.observed_date) OVER (PARTITION BY h.property_cluster_id ORDER BY h.observed_date) AS previous_observed_date
           FROM property_price_history h
        )
 SELECT o.property_cluster_id,
    c.city,
    c.zip_code,
    c.normalized_address,
    o.previous_observed_date,
    o.observed_date,
    o.previous_price,
    o.price AS current_price,
    o.previous_price_m2,
    o.price_m2 AS current_price_m2,
    o.source_count,
    o.price - o.previous_price AS price_delta_value,
        CASE
            WHEN o.previous_price IS NULL OR o.previous_price = 0::numeric THEN NULL::numeric
            ELSE round((o.price - o.previous_price) / o.previous_price * 100::numeric, 2)
        END AS price_delta_pct,
        CASE
            WHEN o.previous_price IS NOT NULL AND o.price < o.previous_price THEN true
            ELSE false
        END AS is_price_drop
   FROM ordered o
     JOIN property_clusters c ON c.id = o.property_cluster_id;

-- v_property_price_trends
CREATE OR REPLACE VIEW public.v_property_price_trends AS
 WITH latest AS (
         SELECT DISTINCT ON (h.property_cluster_id) h.property_cluster_id,
            h.observed_date AS latest_observed_date,
            h.price AS latest_price,
            h.price_m2 AS latest_price_m2,
            h.created_at
           FROM property_price_history h
          ORDER BY h.property_cluster_id, h.observed_date DESC, h.created_at DESC
        ), d7 AS (
         SELECT DISTINCT ON (h.property_cluster_id) h.property_cluster_id,
            h.observed_date AS observed_date_7d,
            h.price AS price_7d,
            h.price_m2 AS price_m2_7d,
            h.created_at
           FROM property_price_history h
          WHERE h.observed_date <= (CURRENT_DATE - 7)
          ORDER BY h.property_cluster_id, h.observed_date DESC, h.created_at DESC
        ), d30 AS (
         SELECT DISTINCT ON (h.property_cluster_id) h.property_cluster_id,
            h.observed_date AS observed_date_30d,
            h.price AS price_30d,
            h.price_m2 AS price_m2_30d,
            h.created_at
           FROM property_price_history h
          WHERE h.observed_date <= (CURRENT_DATE - 30)
          ORDER BY h.property_cluster_id, h.observed_date DESC, h.created_at DESC
        )
 SELECT c.id AS property_cluster_id,
    c.normalized_address,
    c.city,
    c.zip_code,
    l.latest_observed_date,
    l.latest_price,
    l.latest_price_m2,
    d7.observed_date_7d,
    d7.price_7d,
    d7.price_m2_7d,
    d30.observed_date_30d,
    d30.price_30d,
    d30.price_m2_30d,
        CASE
            WHEN d7.price_7d IS NULL OR d7.price_7d = 0::numeric THEN NULL::numeric
            ELSE round((l.latest_price - d7.price_7d) / d7.price_7d * 100::numeric, 2)
        END AS price_change_pct_7d,
        CASE
            WHEN d30.price_30d IS NULL OR d30.price_30d = 0::numeric THEN NULL::numeric
            ELSE round((l.latest_price - d30.price_30d) / d30.price_30d * 100::numeric, 2)
        END AS price_change_pct_30d,
        CASE
            WHEN d7.price_7d IS NOT NULL AND l.latest_price < d7.price_7d THEN true
            WHEN d30.price_30d IS NOT NULL AND l.latest_price < d30.price_30d THEN true
            ELSE false
        END AS price_drop_detected
   FROM property_clusters c
     JOIN latest l ON l.property_cluster_id = c.id
     LEFT JOIN d7 ON d7.property_cluster_id = c.id
     LEFT JOIN d30 ON d30.property_cluster_id = c.id;

-- v_sourcing_items_summary
CREATE OR REPLACE VIEW public.v_sourcing_items_summary AS
 SELECT id,
    user_id,
    profile_target,
    status,
    code_postal,
    commune_insee,
    ((input_json -> 'input'::text) ->> 'price'::text)::numeric AS price,
    ((input_json -> 'input'::text) ->> 'surface'::text)::numeric AS surface,
    (input_json -> 'input'::text) ->> 'propertyType'::text AS property_type,
    (input_json -> 'location'::text) ->> 'rueProche'::text AS rue_proche,
    (input_json -> 'location'::text) ->> 'ville'::text AS ville,
    (score_json ->> 'globalScore'::text)::integer AS global_score,
    (score_json ->> 'globalConfidence'::text)::numeric AS global_confidence,
    score_json ->> 'globalRationale'::text AS global_rationale,
    (((score_json -> 'subScores'::text) -> 'value'::text) ->> 'value'::text)::integer AS value_score,
    (((score_json -> 'subScores'::text) -> 'location'::text) ->> 'value'::text)::integer AS location_score,
    (((score_json -> 'subScores'::text) -> 'liquidity'::text) ->> 'value'::text)::integer AS liquidity_score,
    (((score_json -> 'subScores'::text) -> 'worksRisk'::text) ->> 'value'::text)::integer AS works_risk_score,
    (geocode_json -> 'bestMatch'::text) ->> 'label'::text AS geocode_label,
    ((geocode_json -> 'bestMatch'::text) ->> 'confidence'::text)::numeric AS geocode_confidence,
    created_at,
    updated_at
   FROM sourcing_items si;

-- v_user_profile
CREATE OR REPLACE VIEW public.v_user_profile AS
 WITH ev AS (
         SELECT e.user_id,
            e.event_type,
            e.payload,
            e.occurred_at
           FROM user_events e
             LEFT JOIN user_ai_preferences p ON p.user_id = e.user_id
          WHERE COALESCE(p.learning_enabled, true)
        ), dim_counts AS (
         SELECT u.user_id,
            u.dim,
            u.val,
            count(*)::integer AS c
           FROM ( SELECT ev.user_id,
                    'city'::text AS dim,
                    NULLIF(TRIM(BOTH FROM ev.payload ->> 'city'::text), ''::text) AS val
                   FROM ev
                  WHERE ev.payload ? 'city'::text
                UNION ALL
                 SELECT ev.user_id,
                    'module'::text,
                    NULLIF(TRIM(BOTH FROM ev.payload ->> 'module'::text), ''::text) AS "nullif"
                   FROM ev
                  WHERE ev.payload ? 'module'::text
                UNION ALL
                 SELECT ev.user_id,
                    'property_type'::text,
                    NULLIF(TRIM(BOTH FROM ev.payload ->> 'property_type'::text), ''::text) AS "nullif"
                   FROM ev
                  WHERE ev.payload ? 'property_type'::text
                UNION ALL
                 SELECT ev.user_id,
                    'strategy'::text,
                    NULLIF(TRIM(BOTH FROM ev.payload ->> 'strategy'::text), ''::text) AS "nullif"
                   FROM ev
                  WHERE ev.payload ? 'strategy'::text
                UNION ALL
                 SELECT ev.user_id,
                    'department'::text,
                    NULLIF("left"(ev.payload ->> 'insee'::text, 2), ''::text) AS "nullif"
                   FROM ev
                  WHERE ev.payload ? 'insee'::text) u
          WHERE u.val IS NOT NULL
          GROUP BY u.user_id, u.dim, u.val
        ), dim_ranked AS (
         SELECT dim_counts.user_id,
            dim_counts.dim,
            dim_counts.val,
            dim_counts.c,
            row_number() OVER (PARTITION BY dim_counts.user_id, dim_counts.dim ORDER BY dim_counts.c DESC, dim_counts.val) AS rn
           FROM dim_counts
        ), dim_top AS (
         SELECT dim_ranked.user_id,
            dim_ranked.dim,
            jsonb_agg(jsonb_build_object('value', dim_ranked.val, 'count', dim_ranked.c) ORDER BY dim_ranked.c DESC) FILTER (WHERE dim_ranked.rn <= 5) AS top5
           FROM dim_ranked
          GROUP BY dim_ranked.user_id, dim_ranked.dim
        ), dims AS (
         SELECT dim_top.user_id,
            (array_agg(dim_top.top5) FILTER (WHERE dim_top.dim = 'city'::text))[1] AS favorite_cities,
            (array_agg(dim_top.top5) FILTER (WHERE dim_top.dim = 'module'::text))[1] AS favorite_modules,
            (array_agg(dim_top.top5) FILTER (WHERE dim_top.dim = 'property_type'::text))[1] AS favorite_property_types,
            (array_agg(dim_top.top5) FILTER (WHERE dim_top.dim = 'strategy'::text))[1] AS favorite_strategies,
            (array_agg(dim_top.top5) FILTER (WHERE dim_top.dim = 'department'::text))[1] AS favorite_departments
           FROM dim_top
          GROUP BY dim_top.user_id
        ), nums AS (
         SELECT ev.user_id,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (((ev.payload ->> 'budget'::text)::numeric)::double precision)) FILTER (WHERE (ev.payload ->> 'budget'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) AS budget_median,
            min((ev.payload ->> 'budget'::text)::numeric) FILTER (WHERE (ev.payload ->> 'budget'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) AS budget_min,
            max((ev.payload ->> 'budget'::text)::numeric) FILTER (WHERE (ev.payload ->> 'budget'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) AS budget_max,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (((ev.payload ->> 'surface'::text)::numeric)::double precision)) FILTER (WHERE (ev.payload ->> 'surface'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) AS surface_median,
            min((ev.payload ->> 'surface'::text)::numeric) FILTER (WHERE (ev.payload ->> 'surface'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) AS surface_min,
            max((ev.payload ->> 'surface'::text)::numeric) FILTER (WHERE (ev.payload ->> 'surface'::text) ~ '^[0-9]+(\.[0-9]+)?$'::text) AS surface_max
           FROM ev
          GROUP BY ev.user_id
        ), signals AS (
         SELECT ev.user_id,
            count(*) FILTER (WHERE (ev.payload ->> 'module'::text) = 'promoteur'::text OR ((ev.payload ->> 'strategy'::text) = ANY (ARRAY['promotion'::text, 'marchand'::text])) OR (ev.payload ->> 'property_type'::text) = 'terrain'::text) AS sig_promoteur,
            count(*) FILTER (WHERE ((ev.payload ->> 'strategy'::text) = ANY (ARRAY['rendement'::text, 'cashflow'::text, 'lmnp'::text, 'locatif'::text])) OR (ev.payload ->> 'module'::text) = 'investisseur'::text) AS sig_investisseur,
            count(*) FILTER (WHERE (ev.payload ->> 'module'::text) = 'particulier'::text OR (ev.payload ->> 'strategy'::text) = 'estimation'::text OR (ev.payload ->> 'property_type'::text) = 'maison'::text) AS sig_particulier
           FROM ev
          GROUP BY ev.user_id
        ), totals AS (
         SELECT ev.user_id,
            count(*)::integer AS event_count,
            min(ev.occurred_at) AS first_seen,
            max(ev.occurred_at) AS last_seen
           FROM ev
          GROUP BY ev.user_id
        )
 SELECT t.user_id,
    t.event_count,
    t.first_seen,
    t.last_seen,
    COALESCE(d.favorite_cities, '[]'::jsonb) AS favorite_cities,
    COALESCE(d.favorite_modules, '[]'::jsonb) AS favorite_modules,
    COALESCE(d.favorite_property_types, '[]'::jsonb) AS favorite_property_types,
    COALESCE(d.favorite_strategies, '[]'::jsonb) AS favorite_strategies,
    COALESCE(d.favorite_departments, '[]'::jsonb) AS favorite_departments,
    n.budget_median,
    n.budget_min,
    n.budget_max,
    n.surface_median,
    n.surface_min,
    n.surface_max,
    jsonb_build_object('promoteur', COALESCE(s.sig_promoteur, 0::bigint), 'investisseur', COALESCE(s.sig_investisseur, 0::bigint), 'particulier', COALESCE(s.sig_particulier, 0::bigint)) AS profile_signals,
        CASE
            WHEN t.event_count < 12 THEN NULL::text
            WHEN (COALESCE(s.sig_promoteur, 0::bigint) + COALESCE(s.sig_investisseur, 0::bigint) + COALESCE(s.sig_particulier, 0::bigint)) < 5 THEN NULL::text
            WHEN (GREATEST(COALESCE(s.sig_promoteur, 0::bigint), COALESCE(s.sig_investisseur, 0::bigint), COALESCE(s.sig_particulier, 0::bigint))::numeric / NULLIF(COALESCE(s.sig_promoteur, 0::bigint) + COALESCE(s.sig_investisseur, 0::bigint) + COALESCE(s.sig_particulier, 0::bigint), 0)::numeric) < 0.45 THEN NULL::text
            WHEN COALESCE(s.sig_promoteur, 0::bigint) >= COALESCE(s.sig_investisseur, 0::bigint) AND COALESCE(s.sig_promoteur, 0::bigint) >= COALESCE(s.sig_particulier, 0::bigint) THEN 'promoteur'::text
            WHEN COALESCE(s.sig_investisseur, 0::bigint) >= COALESCE(s.sig_particulier, 0::bigint) THEN 'investisseur'::text
            ELSE 'particulier'::text
        END AS derived_profile,
    round(GREATEST(COALESCE(s.sig_promoteur, 0::bigint), COALESCE(s.sig_investisseur, 0::bigint), COALESCE(s.sig_particulier, 0::bigint))::numeric / NULLIF(COALESCE(s.sig_promoteur, 0::bigint) + COALESCE(s.sig_investisseur, 0::bigint) + COALESCE(s.sig_particulier, 0::bigint), 0)::numeric, 2) AS derived_profile_confidence
   FROM totals t
     LEFT JOIN dims d ON d.user_id = t.user_id
     LEFT JOIN nums n ON n.user_id = t.user_id
     LEFT JOIN signals s ON s.user_id = t.user_id;

-- v_watchlist_notification_history
CREATE OR REPLACE VIEW public.v_watchlist_notification_history AS
 SELECT n.id,
    w.user_id,
    n.watchlist_id,
    w.name AS watchlist_name,
    n.property_cluster_id,
    c.city,
    c.zip_code,
    c.normalized_address,
    n.alert_type,
    n.observed_date,
    n.sent_at,
    n.delivery_channel
   FROM watchlist_alert_notifications n
     JOIN user_watchlists w ON w.id = n.watchlist_id
     JOIN property_clusters c ON c.id = n.property_cluster_id;

-- watchlist_opportunities_deduped
CREATE OR REPLACE VIEW public.watchlist_opportunities_deduped AS
 WITH base AS (
         SELECT portal_snapshots.id,
            portal_snapshots.portal,
            portal_snapshots.listing_portal_id,
            portal_snapshots.url,
            portal_snapshots.city,
            portal_snapshots.zip_code,
            portal_snapshots.price,
            portal_snapshots.surface,
            portal_snapshots.price_m2,
            portal_snapshots.canonical_key,
            portal_snapshots.first_seen_at,
            portal_snapshots.seen_at,
            GREATEST(0::numeric, EXTRACT(day FROM now() - COALESCE(portal_snapshots.first_seen_at, portal_snapshots.seen_at)))::integer AS days_on_market,
                CASE
                    WHEN portal_snapshots.zip_code = '92210'::text AND portal_snapshots.price_m2 <= 7200::numeric THEN 72
                    WHEN portal_snapshots.zip_code = '92210'::text AND portal_snapshots.price_m2 <= 7800::numeric THEN 64
                    WHEN portal_snapshots.zip_code = '92500'::text AND portal_snapshots.price_m2 <= 7300::numeric THEN 68
                    ELSE 48
                END AS opportunity_score,
                CASE
                    WHEN portal_snapshots.zip_code = '92210'::text AND portal_snapshots.price_m2 <= 7200::numeric THEN 'Sous le marché local'::text
                    WHEN portal_snapshots.zip_code = '92210'::text AND portal_snapshots.price_m2 <= 7800::numeric THEN 'Prix compétitif sur la zone'::text
                    WHEN portal_snapshots.zip_code = '92500'::text AND portal_snapshots.price_m2 <= 7300::numeric THEN 'Positionnement attractif'::text
                    ELSE 'Analyse standard'::text
                END AS opportunity_reason,
            concat(COALESCE(portal_snapshots.zip_code, 'na'::text), '_', round(COALESCE(portal_snapshots.surface, 0::numeric), 0)::text, '_', round(COALESCE(portal_snapshots.price, 0::numeric) / 1000.0 / 10.0) * 10::numeric) AS display_cluster_key
           FROM portal_snapshots
          WHERE portal_snapshots.price IS NOT NULL AND portal_snapshots.surface IS NOT NULL AND portal_snapshots.price_m2 IS NOT NULL
        ), ranked AS (
         SELECT base.id,
            base.portal,
            base.listing_portal_id,
            base.url,
            base.city,
            base.zip_code,
            base.price,
            base.surface,
            base.price_m2,
            base.canonical_key,
            base.first_seen_at,
            base.seen_at,
            base.days_on_market,
            base.opportunity_score,
            base.opportunity_reason,
            base.display_cluster_key,
            row_number() OVER (PARTITION BY base.display_cluster_key ORDER BY base.opportunity_score DESC, base.price, base.seen_at DESC NULLS LAST) AS rn,
            count(*) OVER (PARTITION BY base.display_cluster_key) AS duplicate_count
           FROM base
        )
 SELECT id,
    portal,
    listing_portal_id,
    url,
    city,
    zip_code,
    price,
    surface,
    price_m2,
    canonical_key,
    display_cluster_key,
    first_seen_at,
    seen_at,
    days_on_market,
    opportunity_score,
    opportunity_reason,
    duplicate_count
   FROM ranked
  WHERE rn = 1;

-- watchlist_opportunities_preview
CREATE OR REPLACE VIEW public.watchlist_opportunities_preview AS
 SELECT id,
    portal,
    listing_portal_id,
    url,
    city,
    zip_code,
    price,
    surface,
    price_m2,
    canonical_key,
    first_seen_at,
    seen_at,
    GREATEST(0::numeric, EXTRACT(day FROM now() - COALESCE(first_seen_at, seen_at)))::integer AS days_on_market,
        CASE
            WHEN zip_code = '92210'::text AND price_m2 <= 7200::numeric THEN 72
            WHEN zip_code = '92210'::text AND price_m2 <= 7800::numeric THEN 64
            WHEN zip_code = '92500'::text AND price_m2 <= 7300::numeric THEN 68
            ELSE 48
        END AS opportunity_score,
        CASE
            WHEN zip_code = '92210'::text AND price_m2 <= 7200::numeric THEN 'Sous le marché local'::text
            WHEN zip_code = '92210'::text AND price_m2 <= 7800::numeric THEN 'Prix compétitif sur la zone'::text
            WHEN zip_code = '92500'::text AND price_m2 <= 7300::numeric THEN 'Positionnement attractif'::text
            ELSE 'Analyse standard'::text
        END AS opportunity_reason
   FROM portal_snapshots
  WHERE price IS NOT NULL AND surface IS NOT NULL AND price_m2 IS NOT NULL;

-- cp_population
CREATE OR REPLACE VIEW public.cp_population AS
 SELECT m.cp,
    sum(v.population)::bigint AS population
   FROM commune_cp_map m
     JOIN v_commune_population v ON TRIM(BOTH FROM v.commune_insee) = TRIM(BOTH FROM m.depcom)
  GROUP BY m.cp;

-- dvf_marche_historique_cp_type
-- NOTE : vue MATERIALISEE. CREATE OR REPLACE n'existe pas pour les vues
-- materialisees en PostgreSQL : on utilise donc CREATE MATERIALIZED VIEW
-- IF NOT EXISTS. Pour en modifier la definition, il faut la DROPper
-- explicitement au prealable.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.dvf_marche_historique_cp_type AS
 WITH base AS (
         SELECT TRIM(BOTH FROM dvf_all.code_postal) AS code_postal,
            lower(dvf_all.type_local) AS type_bien,
            EXTRACT(year FROM to_date(dvf_all.date_mutation, 'DD/MM/YYYY'::text))::integer AS annee,
            replace(dvf_all.valeur_fonciere, ','::text, '.'::text)::numeric AS valeur_fonciere_num,
            NULLIF(replace(dvf_all.surface_reelle_bati, ','::text, '.'::text), ''::text)::numeric AS surface_reelle_bati_num
           FROM dvf_all
          WHERE dvf_all.code_postal IS NOT NULL AND dvf_all.type_local IS NOT NULL AND dvf_all.valeur_fonciere IS NOT NULL AND dvf_all.surface_reelle_bati IS NOT NULL AND dvf_all.surface_reelle_bati <> ''::text
        ), prix_calc AS (
         SELECT base.code_postal,
            base.type_bien,
            base.annee,
                CASE
                    WHEN base.surface_reelle_bati_num > 0::numeric THEN base.valeur_fonciere_num / base.surface_reelle_bati_num
                    ELSE NULL::numeric
                END AS prix_m2
           FROM base
          WHERE base.surface_reelle_bati_num > 0::numeric
        )
 SELECT code_postal,
    type_bien,
    annee,
    count(*)::integer AS nb_transactions,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (prix_m2::double precision))::numeric(12,2) AS prix_m2_median,
    avg(prix_m2)::numeric(12,2) AS prix_m2_moyen,
    min(prix_m2)::numeric(12,2) AS prix_m2_min,
    max(prix_m2)::numeric(12,2) AS prix_m2_max
   FROM prix_calc
  WHERE prix_m2 IS NOT NULL
  GROUP BY code_postal, type_bien, annee;

-- market_narrative_summary
CREATE OR REPLACE VIEW public.market_narrative_summary AS
 SELECT zip_code,
    city,
    concat('Le marché de ', city, ' compte actuellement ', unique_listings, ' biens uniques en vente.') AS stock_message,
    concat(new_7d, ' nouveaux biens uniques sont apparus sur les 7 derniers jours.') AS new_listings_message,
    concat(multi_portal_pct, '% des biens sont diffusés sur plusieurs portails.') AS multi_portal_message,
    concat('Le prix moyen observé est de ', round(avg_price_m2), ' €/m².') AS price_level_message,
    concat(price_drops_7d, ' biens uniques ont baissé leur prix sur les 7 derniers jours.') AS price_drop_message,
    concat('La durée moyenne de présence sur le marché est estimée à ', round(avg_days_on_market), ' jours.') AS market_duration_message
   FROM market_summary_v2 s;

-- market_opportunities_top
CREATE OR REPLACE VIEW public.market_opportunities_top AS
 SELECT canonical_key,
    zip_code,
    city,
    price,
    surface,
    price_m2,
    market_avg_price_m2,
    market_median_price_m2,
    sample_size,
    listing_count,
    portal_count,
    portals,
    portal_listing_ids,
    urls,
    first_seen_at,
    last_seen_at,
    dedupe_confidence,
    price_change_abs,
    price_change_pct,
    price_change_count,
    price_drop_count,
    days_on_market,
    discount_vs_market_pct,
    has_price_drop,
    is_multi_portal,
    is_long_market,
    is_below_market,
    opportunity_score,
    opportunity_bucket
   FROM market_opportunities_v1
  WHERE opportunity_score >= 40
  ORDER BY opportunity_score DESC, price;

-- market_opportunity_narrative
CREATE OR REPLACE VIEW public.market_opportunity_narrative AS
 SELECT canonical_key,
    zip_code,
    city,
    concat('Bien de ', surface, ' m² proposé à ', price, ' €. ') AS intro,
        CASE
            WHEN discount_vs_market_pct > 0::numeric THEN concat('Prix inférieur au marché local de ', round(discount_vs_market_pct, 1), ' %. ')
            ELSE 'Prix proche ou supérieur au marché local. '::text
        END AS price_position,
        CASE
            WHEN price_drop_count > 0 THEN concat('Le bien a déjà connu ', price_drop_count, ' baisse(s) de prix.')
            ELSE 'Aucune baisse de prix détectée.'::text
        END AS price_drop_info,
        CASE
            WHEN portal_count > 1 THEN concat('Diffusé sur ', portal_count, ' portails.')
            ELSE 'Diffusion sur un seul portail.'::text
        END AS diffusion_info,
    opportunity_score,
    opportunity_bucket
   FROM market_opportunities_v1;

-- market_price_drops
CREATE OR REPLACE VIEW public.market_price_drops AS
 SELECT canonical_key,
    zip_code,
    city,
    first_observed_at,
    first_price,
    last_observed_at,
    last_price,
    price_change_abs,
    price_change_pct
   FROM market_price_evolution
  WHERE last_price < first_price;

-- market_stock_narrative
CREATE OR REPLACE VIEW public.market_stock_narrative AS
 WITH latest AS (
         SELECT DISTINCT ON (market_stock_trend.zip_code, market_stock_trend.city) market_stock_trend.snapshot_date,
            market_stock_trend.zip_code,
            market_stock_trend.city,
            market_stock_trend.unique_listings,
            market_stock_trend.stock_change_7d,
            market_stock_trend.stock_change_30d,
            market_stock_trend.stock_change_7d_pct,
            market_stock_trend.stock_change_30d_pct
           FROM market_stock_trend
          ORDER BY market_stock_trend.zip_code, market_stock_trend.city, market_stock_trend.snapshot_date DESC
        )
 SELECT zip_code,
    city,
    concat('Le stock vendeur actuel est de ', unique_listings, ' biens uniques.') AS stock_level_message,
        CASE
            WHEN stock_change_7d IS NULL THEN 'Historique insuffisant pour mesurer l’évolution sur 7 jours.'::text
            WHEN stock_change_7d > 0 THEN concat('Le stock vendeur progresse de ', stock_change_7d, ' bien(s) sur 7 jours.')
            WHEN stock_change_7d < 0 THEN concat('Le stock vendeur recule de ', abs(stock_change_7d), ' bien(s) sur 7 jours.')
            ELSE 'Le stock vendeur est stable sur 7 jours.'::text
        END AS stock_change_7d_message,
        CASE
            WHEN stock_change_30d IS NULL THEN 'Historique insuffisant pour mesurer l’évolution sur 30 jours.'::text
            WHEN stock_change_30d > 0 THEN concat('Le stock vendeur progresse de ', stock_change_30d, ' bien(s) sur 30 jours.')
            WHEN stock_change_30d < 0 THEN concat('Le stock vendeur recule de ', abs(stock_change_30d), ' bien(s) sur 30 jours.')
            ELSE 'Le stock vendeur est stable sur 30 jours.'::text
        END AS stock_change_30d_message
   FROM latest;

-- market_tension_signal
CREATE OR REPLACE VIEW public.market_tension_signal AS
 WITH latest AS (
         SELECT DISTINCT ON (market_stock_trend.zip_code, market_stock_trend.city) market_stock_trend.snapshot_date,
            market_stock_trend.zip_code,
            market_stock_trend.city,
            market_stock_trend.unique_listings,
            market_stock_trend.stock_change_7d,
            market_stock_trend.stock_change_30d,
            market_stock_trend.stock_change_7d_pct,
            market_stock_trend.stock_change_30d_pct
           FROM market_stock_trend
          ORDER BY market_stock_trend.zip_code, market_stock_trend.city, market_stock_trend.snapshot_date DESC
        )
 SELECT snapshot_date,
    zip_code,
    city,
    unique_listings,
    stock_change_7d,
    stock_change_30d,
    stock_change_7d_pct,
    stock_change_30d_pct,
        CASE
            WHEN stock_change_30d_pct IS NULL THEN 'insuffisant'::text
            WHEN stock_change_30d_pct >= 10::numeric THEN 'detente_forte'::text
            WHEN stock_change_30d_pct >= 3::numeric THEN 'detente_moderee'::text
            WHEN stock_change_30d_pct <= '-10'::integer::numeric THEN 'tension_forte'::text
            WHEN stock_change_30d_pct <= '-3'::integer::numeric THEN 'tension_moderee'::text
            ELSE 'stable'::text
        END AS tension_signal,
        CASE
            WHEN stock_change_30d_pct IS NULL THEN 'Historique insuffisant pour qualifier la tension du marché.'::text
            WHEN stock_change_30d_pct >= 10::numeric THEN 'Le stock vendeur progresse nettement : marché plus favorable aux acheteurs.'::text
            WHEN stock_change_30d_pct >= 3::numeric THEN 'Le stock vendeur augmente légèrement : détente modérée du marché.'::text
            WHEN stock_change_30d_pct <= '-10'::integer::numeric THEN 'Le stock vendeur se contracte fortement : marché plus tendu pour les acheteurs.'::text
            WHEN stock_change_30d_pct <= '-3'::integer::numeric THEN 'Le stock vendeur recule légèrement : tension modérée du marché.'::text
            ELSE 'Le stock vendeur apparaît globalement stable.'::text
        END AS tension_message
   FROM latest;

-- plu_engine_densite_resolved_v1
CREATE OR REPLACE VIEW public.plu_engine_densite_resolved_v1 AS
 SELECT commune_insee,
    zone_code,
    plu_version_label,
    source,
        CASE
            WHEN (ruleset_canon #>> '{densite_v1,cos_existe}'::text[]) IS NULL THEN NULL::boolean
            ELSE (ruleset_canon #>> '{densite_v1,cos_existe}'::text[])::boolean
        END AS cos_existe,
    (ruleset_canon #>> '{densite_v1,cos_max}'::text[])::numeric AS cos_max,
    (ruleset_canon #>> '{densite_v1,sdp_max_ratio}'::text[])::numeric AS sdp_max_ratio,
    (ruleset_canon #>> '{densite_v1,sdp_max_m2}'::text[])::numeric AS sdp_max_m2,
    NULLIF(ruleset_canon #>> '{densite_v1,note}'::text[], ''::text) AS densite_note
   FROM plu_rulesets_resolved_canon_v4;

-- plu_engine_emprise_resolved_v1
CREATE OR REPLACE VIEW public.plu_engine_emprise_resolved_v1 AS
 SELECT commune_insee,
    zone_code,
    plu_version_label,
    source,
    (ruleset_canon #>> '{emprise,emprise_max_ratio}'::text[])::numeric AS emprise_max_ratio,
    (ruleset_canon #>> '{emprise_sol,emprise_sol_max}'::text[])::numeric AS emprise_sol_max
   FROM plu_rulesets_resolved_canon_v2;

-- plu_engine_hauteur_resolved_v1
CREATE OR REPLACE VIEW public.plu_engine_hauteur_resolved_v1 AS
 SELECT commune_insee,
    zone_code,
    plu_version_label,
    source,
    (ruleset_canon #>> '{hauteur,hauteur_max_m}'::text[])::numeric AS hauteur_max_m,
    (ruleset_canon #>> '{hauteur,hauteur_min_m}'::text[])::numeric AS hauteur_min_m,
    NULLIF(ruleset_canon #>> '{hauteur,mode_calcul}'::text[], ''::text) AS hauteur_mode_calcul,
    NULLIF(ruleset_canon #>> '{hauteur,commentaire}'::text[], ''::text) AS hauteur_commentaire
   FROM plu_rulesets_resolved_canon_v2;

-- plu_engine_reculs_resolved_v1
CREATE OR REPLACE VIEW public.plu_engine_reculs_resolved_v1 AS
 SELECT commune_insee,
    zone_code,
    plu_version_label,
    source,
    (ruleset_canon #>> '{reculs_v2,voirie,min_m}'::text[])::numeric AS voirie_min_m,
    (ruleset_canon #>> '{reculs_v2,fond_parcelle,min_m}'::text[])::numeric AS fond_min_m,
    (ruleset_canon #>> '{reculs_v2,limites_separatives,min_m}'::text[])::numeric AS lateral_min_m,
    NULLIF(ruleset_canon #>> '{reculs_v2,voirie,regle}'::text[], ''::text) AS voirie_regle,
    NULLIF(ruleset_canon #>> '{reculs_v2,fond_parcelle,regle}'::text[], ''::text) AS fond_regle,
    NULLIF(ruleset_canon #>> '{reculs_v2,limites_separatives,regle}'::text[], ''::text) AS lateral_regle,
        CASE
            WHEN (ruleset_canon #>> '{reculs_v2,implantation_en_limite,autorisee}'::text[]) IS NULL THEN NULL::boolean
            ELSE (ruleset_canon #>> '{reculs_v2,implantation_en_limite,autorisee}'::text[])::boolean
        END AS implantation_en_limite_autorisee
   FROM plu_rulesets_resolved_canon_v2;

-- plu_engine_stationnement_resolved_v1
CREATE OR REPLACE VIEW public.plu_engine_stationnement_resolved_v1 AS
 SELECT commune_insee,
    zone_code,
    plu_version_label,
    source,
    (ruleset_canon #>> '{stationnement_v1,places_par_logement}'::text[])::numeric AS places_par_logement,
    (ruleset_canon #>> '{stationnement_v1,places_par_100m2_sdp}'::text[])::numeric AS places_par_100m2_sdp,
    (ruleset_canon #>> '{stationnement_v1,places_min_total}'::text[])::numeric AS places_min_total,
    (ruleset_canon #>> '{stationnement_v1,visiteurs_par_logement}'::text[])::numeric AS visiteurs_par_logement,
    (ruleset_canon #>> '{stationnement_v1,velos_par_logement}'::text[])::numeric AS velos_par_logement,
    NULLIF(ruleset_canon #>> '{stationnement_v1,note}'::text[], ''::text) AS stationnement_note,
    NULLIF(ruleset_canon #>> '{stationnement,commentaire}'::text[], ''::text) AS stationnement_commentaire
   FROM plu_rulesets_resolved_canon_v3;

-- plu_front_zone_summary_v1
CREATE OR REPLACE VIEW public.plu_front_zone_summary_v1 AS
 SELECT commune_insee,
    commune_nom,
    zone_code,
    zone_libelle,
    plu_version_label,
    source,
    (ruleset_canon #>> '{reculs_v2,voirie,min_m}'::text[])::numeric AS recul_voirie_min_m,
    (ruleset_canon #>> '{reculs_v2,limites_separatives,min_m}'::text[])::numeric AS recul_limites_min_m,
    (ruleset_canon #>> '{reculs_v2,fond_parcelle,min_m}'::text[])::numeric AS recul_fond_min_m,
    (ruleset_canon #>> '{reculs_v2,voirie,min_m}'::text[])::numeric AS facade_avant_min_m,
    (ruleset_canon #>> '{reculs_v2,limites_separatives,min_m}'::text[])::numeric AS facades_laterales_min_m,
    (ruleset_canon #>> '{reculs_v2,fond_parcelle,min_m}'::text[])::numeric AS facade_fond_min_m,
        CASE
            WHEN (ruleset_canon #>> '{reculs_v2,implantation_en_limite,autorisee}'::text[]) IS NULL THEN NULL::boolean
            ELSE (ruleset_canon #>> '{reculs_v2,implantation_en_limite,autorisee}'::text[])::boolean
        END AS implantation_en_limite_autorisee,
    (ruleset_canon #>> '{hauteur,hauteur_max_m}'::text[])::numeric AS hauteur_max_m,
    (ruleset_canon #>> '{emprise,emprise_max_ratio}'::text[])::numeric AS ces_max_ratio,
    (ruleset_canon #>> '{stationnement_v1,places_par_logement}'::text[])::numeric AS stationnement_par_logement,
    (ruleset_canon #>> '{stationnement_v1,places_par_100m2_sdp}'::text[])::numeric AS stationnement_par_100m2,
    (ruleset_canon #>> '{stationnement_v1,visiteurs_par_logement}'::text[])::numeric AS stationnement_visiteurs_par_logement,
    (ruleset_canon #>> '{stationnement_v1,velos_par_logement}'::text[])::numeric AS velos_par_logement,
    NULLIF(ruleset_canon #>> '{stationnement_v1,note}'::text[], ''::text) AS stationnement_note,
    NULLIF(ruleset_canon #>> '{raw_rules_text}'::text[], ''::text) AS raw_rules_text
   FROM plu_rulesets_resolved_canon_v4;

-- plu_rulesets_final_for_engine
CREATE OR REPLACE VIEW public.plu_rulesets_final_for_engine AS
 SELECT commune_insee,
    commune_nom,
    zone_code,
    zone_libelle,
    plu_version_label,
    source,
    ruleset_canon
   FROM plu_rulesets_resolved_canon_v2;

-- plu_rulesets_resolved_canon_v1
CREATE OR REPLACE VIEW public.plu_rulesets_resolved_canon_v1 AS
 SELECT commune_insee,
    commune_nom,
    zone_code,
    zone_libelle,
    plu_version_label,
    source_type,
    universal_source_document,
    source,
    jsonb_build_object('zone_code', zone_code, 'zone_libelle', zone_libelle, 'plu_version_label', plu_version_label, 'hauteur', jsonb_build_object('hauteur_max_m', COALESCE(NULLIF(ruleset #>> '{hauteur,hauteur_max_m}'::text[], ''::text)::numeric, NULLIF(ruleset #>> '{hauteur,max_hauteur_m}'::text[], ''::text)::numeric, NULLIF(ruleset #>> '{hauteur,max_hauteur_m}'::text[], ''::text)::numeric), 'hauteur_min_m', COALESCE(NULLIF(ruleset #>> '{hauteur,hauteur_min_m}'::text[], ''::text)::numeric, NULLIF(ruleset #>> '{hauteur,min_hauteur_m}'::text[], ''::text)::numeric), 'mode_calcul', NULLIF(replace(COALESCE(ruleset #>> '{hauteur,mode_calcul}'::text[], ''::text), '�gout'::text, 'égout'::text), ''::text), 'commentaire', NULLIF(COALESCE(ruleset #>> '{hauteur,commentaire}'::text[], ''::text), ''::text)), 'emprise', jsonb_build_object('emprise_max_ratio', COALESCE(NULLIF(ruleset #>> '{emprise,emprise_max_ratio}'::text[], ''::text)::numeric, NULLIF(ruleset #>> '{emprise_sol,emprise_max_ratio}'::text[], ''::text)::numeric)), 'emprise_sol', jsonb_build_object('emprise_sol_max', COALESCE(NULLIF(ruleset #>> '{emprise_sol,emprise_sol_max}'::text[], ''::text)::numeric)), 'reculs_alignements', ruleset -> 'reculs_alignements'::text, 'reculs', COALESCE(ruleset -> 'reculs'::text, ruleset -> 'reculs_alignements'::text), 'stationnement', ruleset -> 'stationnement'::text, 'densite', ruleset -> 'densite'::text, 'autres_regles', ruleset -> 'autres_regles'::text, 'articles_source', ruleset -> 'articles_source'::text, 'raw_rules_text', ruleset -> 'raw_rules_text'::text) AS ruleset_canon
   FROM plu_rulesets_resolved r;

-- plu_rulesets_resolved_canon_v3
CREATE OR REPLACE VIEW public.plu_rulesets_resolved_canon_v3 AS
 SELECT commune_insee,
    commune_nom,
    zone_code,
    zone_libelle,
    plu_version_label,
    source_type,
    universal_source_document,
    source,
    jsonb_set(ruleset_canon, '{stationnement_v1}'::text[], COALESCE(ruleset_raw -> 'stationnement_v1'::text, ruleset_canon -> 'stationnement_v1'::text, jsonb_build_object('places_par_logement', NULL::unknown, 'places_par_100m2_sdp', NULL::unknown, 'places_min_total', NULL::unknown, 'visiteurs_par_logement', NULL::unknown, 'velos_par_logement', NULL::unknown, 'note', NULL::unknown, 'source_note', 'AUTO_CANON_V3')), true) AS ruleset_canon
   FROM plu_rulesets_resolved_canon_v2_raw r;

-- plu_rulesets_resolved_canon_v4
CREATE OR REPLACE VIEW public.plu_rulesets_resolved_canon_v4 AS
 SELECT commune_insee,
    commune_nom,
    zone_code,
    zone_libelle,
    plu_version_label,
    source_type,
    universal_source_document,
    source,
    jsonb_set(ruleset_canon, '{densite_v1}'::text[], COALESCE(ruleset_canon -> 'densite_v1'::text, ruleset_canon -> 'densite'::text, jsonb_build_object('cos_existe', NULL::unknown, 'cos_max', NULL::unknown, 'sdp_max_ratio', NULL::unknown, 'sdp_max_m2', NULL::unknown, 'note', NULL::unknown, 'source_note', 'AUTO_CANON_V4')), true) AS ruleset_canon
   FROM plu_rulesets_resolved_canon_v3 v3;

-- plu_rulesets_resolved_flat
CREATE OR REPLACE VIEW public.plu_rulesets_resolved_flat AS
 SELECT commune_insee,
    commune_nom,
    zone_code,
    zone_libelle,
    plu_version_label,
    source_type,
    source_url,
    source_page_range,
    universal_source_document,
    source,
    ruleset,
    ruleset -> 'implantation'::text AS implantation,
    ruleset -> 'reculs'::text AS reculs,
    ruleset -> 'hauteur'::text AS hauteur,
    ruleset -> 'emprise'::text AS emprise,
    ruleset -> 'stationnement'::text AS stationnement
   FROM plu_rulesets_resolved;

-- plu_zone_rules_diagnostic_v1
CREATE OR REPLACE VIEW public.plu_zone_rules_diagnostic_v1 AS
 SELECT document_id,
    commune_insee,
    zone_code,
    zone_libelle,
    reculs_complets_ok,
    ai_completeness_ok,
    ai_confidence_score,
    ai_missing,
    ai_error,
    user_updated_at,
    ai_updated_at
   FROM plu_zone_rules_resolved_reculs_v2;

-- plu_zone_rules_resolved_reculs_v3
CREATE OR REPLACE VIEW public.plu_zone_rules_resolved_reculs_v3 AS
 WITH basezones AS (
         SELECT b_1.document_id,
            COALESCE(( SELECT z.commune_insee
                   FROM plu_zone_rules_normalized z
                  WHERE z.document_id = b_1.document_id AND upper(TRIM(BOTH FROM z.zone_code)) = b_1.zone_code_norm
                 LIMIT 1), ( SELECT a_1.commune_insee
                   FROM plu_rulesets_ai a_1
                  WHERE a_1.document_id = b_1.document_id AND upper(TRIM(BOTH FROM a_1.zone_code)) = b_1.zone_code_norm
                 LIMIT 1), b_1.commune_insee) AS commune_insee,
            b_1.zone_code_norm,
            b_1.zone_code,
            COALESCE(( SELECT z.zone_libelle
                   FROM plu_zone_rules_normalized z
                  WHERE z.document_id = b_1.document_id AND upper(TRIM(BOTH FROM z.zone_code)) = b_1.zone_code_norm
                 LIMIT 1), NULL::text) AS zone_libelle
           FROM plu_zone_base_v1 b_1
        ), norm AS (
         SELECT z.document_id,
            upper(TRIM(BOTH FROM z.zone_code)) AS zone_code_norm,
            z.id AS zone_row_id,
            z.created_at,
            z.confidence_score AS base_confidence_score,
            z.source AS base_source,
            z.rules AS base_rules
           FROM plu_zone_rules_normalized z
        ), ai AS (
         SELECT a_1.document_id,
            upper(TRIM(BOTH FROM a_1.zone_code)) AS zone_code_norm,
            a_1.updated_at AS ai_updated_at,
            a_1.engine AS ai_engine,
            a_1.model AS ai_model,
            a_1.prompt_version AS ai_prompt_version,
            a_1.completeness_ok AS ai_completeness_ok,
            a_1.missing AS ai_missing,
            a_1.confidence_score AS ai_confidence_score,
            a_1.error AS ai_error,
            a_1.ruleset AS ai_ruleset,
            a_1.raw_extract AS ai_raw_extract
           FROM plu_rulesets_ai a_1
        ), u AS (
         SELECT o.document_id,
            upper(TRIM(BOTH FROM o.zone_code)) AS zone_code_norm,
            o.updated_at AS user_updated_at,
            o.overrides AS user_overrides
           FROM plu_user_overrides_v1 o
        )
 SELECT n.zone_row_id,
    n.created_at,
    b.document_id,
    b.commune_insee,
    b.zone_code,
    b.zone_libelle,
    n.base_source,
    n.base_confidence_score,
    a.ai_updated_at,
    a.ai_engine,
    a.ai_model,
    a.ai_prompt_version,
    a.ai_completeness_ok,
    a.ai_missing,
    a.ai_confidence_score,
    a.ai_error,
    u.user_updated_at,
    COALESCE((u.user_overrides #>> '{reculs,voirie_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voie_publique,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voie,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{implantation,recul_voie_publique,value}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{reculs,voirie,min_m}'::text[]), parse_fr_number(n.base_rules #>> '{implantation,recul_voirie_min_m}'::text[]), parse_fr_number(n.base_rules #>> '{reculs,voirie,min_m}'::text[])) AS recul_voirie_min_m,
    COALESCE((u.user_overrides #>> '{reculs,limites_separatives_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limite_separative,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{reculs,limites_separatives,min_m}'::text[]), parse_fr_number(n.base_rules #>> '{implantation,recul_limites_separatives_min_m}'::text[]), parse_fr_number(n.base_rules #>> '{implantation,recul_limite_separative_min_m}'::text[]), parse_fr_number(n.base_rules #>> '{reculs,limites_separatives,min_m}'::text[])) AS recul_limites_separatives_min_m,
    COALESCE((u.user_overrides #>> '{reculs,fond_parcelle_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(a.ai_raw_extract #>> '{reculs,fond_parcelle,min_m}'::text[]), parse_fr_number(n.base_rules #>> '{reculs,fond_parcelle,min_m}'::text[])) AS recul_fond_parcelle_min_m,
    COALESCE(NULLIF(u.user_overrides #>> '{reculs,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(a.ai_ruleset #>> '{implantation,implantation_en_limite,value}'::text[], ''::text)::boolean, NULLIF(a.ai_ruleset #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean, NULLIF(a.ai_ruleset #>> '{implantation,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(n.base_rules #>> '{implantation,implantation_en_limite_autorisee}'::text[], ''::text)::boolean, NULLIF(n.base_rules #>> '{reculs,implantation_en_limite,autorisee}'::text[], ''::text)::boolean) AS implantation_en_limite_autorisee,
    COALESCE((u.user_overrides #>> '{reculs,voirie_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voie_publique,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_voirie,value}'::text[]), parse_fr_number(n.base_rules #>> '{reculs,voirie,min_m}'::text[])) IS NOT NULL AND COALESCE((u.user_overrides #>> '{reculs,limites_separatives_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limites_separatives,value}'::text[]), parse_fr_number(a.ai_ruleset #>> '{implantation,recul_limite_separative,value}'::text[]), parse_fr_number(n.base_rules #>> '{reculs,limites_separatives,min_m}'::text[])) IS NOT NULL AND COALESCE((u.user_overrides #>> '{reculs,fond_parcelle_min_m}'::text[])::numeric, parse_fr_number(a.ai_ruleset #>> '{implantation,recul_fond_parcelle,value}'::text[]), parse_fr_number(n.base_rules #>> '{reculs,fond_parcelle,min_m}'::text[])) IS NOT NULL AS reculs_complets_ok
   FROM basezones b
     LEFT JOIN norm n ON n.document_id = b.document_id AND n.zone_code_norm = b.zone_code_norm
     LEFT JOIN ai a ON a.document_id = b.document_id AND a.zone_code_norm = b.zone_code_norm
     LEFT JOIN u ON u.document_id = b.document_id AND u.zone_code_norm = b.zone_code_norm;

-- plu_zone_rules_resolved_reculs_v4
CREATE OR REPLACE VIEW public.plu_zone_rules_resolved_reculs_v4 AS
 SELECT v3.zone_row_id,
    v3.created_at,
    v3.document_id,
    v3.commune_insee,
    v3.zone_code,
    v3.zone_libelle,
    v3.base_source,
    v3.base_confidence_score,
    v3.ai_updated_at,
    v3.ai_engine,
    v3.ai_model,
    v3.ai_prompt_version,
    v3.ai_completeness_ok,
    v3.ai_missing,
    v3.ai_confidence_score,
    v3.ai_error,
    v3.user_updated_at,
    v3.recul_voirie_min_m,
    v3.recul_limites_separatives_min_m,
    v3.recul_fond_parcelle_min_m,
    v3.implantation_en_limite_autorisee,
    v3.reculs_complets_ok,
    COALESCE(v3.recul_voirie_min_m, extract_first_number_near(a.raw_text, '(recul|retrait).{0,40}(voirie|alignement)'::text)) AS recul_voirie_min_m_v4,
    COALESCE(v3.recul_limites_separatives_min_m, extract_first_number_near(a.raw_text, '(recul|retrait).{0,40}(limites\\s+séparatives|limites\\s+separatives|limite\\s+séparative)'::text)) AS recul_limites_separatives_min_m_v4,
    COALESCE(v3.recul_fond_parcelle_min_m, extract_first_number_near(a.raw_text, '(recul|retrait).{0,40}(fond\\s+de\\s+parcelle|fond\\s+de\\s+parcelle|fond)'::text)) AS recul_fond_parcelle_min_m_v4
   FROM plu_zone_rules_resolved_reculs_v3 v3
     LEFT JOIN plu_rulesets_ai a ON a.document_id = v3.document_id AND upper(TRIM(BOTH FROM a.zone_code)) = upper(TRIM(BOTH FROM v3.zone_code));

-- v_market_insights
CREATE OR REPLACE VIEW public.v_market_insights AS
 SELECT id,
    code_commune,
    commune,
    type_local,
    valeur_fonciere,
    surface_reelle_bati,
    prix_m2,
    prix_m2_marche,
    ecart_marche_pct,
        CASE
            WHEN ecart_marche_pct <= '-15'::integer::numeric THEN 'fortement sous-coté'::text
            WHEN ecart_marche_pct <= '-7'::integer::numeric THEN 'sous-coté'::text
            WHEN ecart_marche_pct < 7::numeric THEN 'cohérent marché'::text
            WHEN ecart_marche_pct < 15::numeric THEN 'surcoté'::text
            ELSE 'fortement surcoté'::text
        END AS position_marche
   FROM v_market_price_analysis;

-- v_market_stock_live
CREATE OR REPLACE VIEW public.v_market_stock_live AS
 SELECT city,
    zip_code,
    count(*) AS active_unique_properties,
    avg(canonical_price) AS avg_price,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (canonical_price::double precision)) AS median_price,
    avg(canonical_price_m2) AS avg_price_m2,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (canonical_price_m2::double precision)) AS median_price_m2,
    avg(active_listing_count) AS avg_listing_duplicates_per_property
   FROM v_active_property_clusters
  GROUP BY city, zip_code;

-- v_market_zone_narratives
CREATE OR REPLACE VIEW public.v_market_zone_narratives AS
 SELECT city,
    zip_code,
    active_unique_properties,
    new_properties_last_7d,
    new_properties_last_30d,
    price_drops_detected,
    avg_price,
    median_price,
    avg_price_m2,
    median_price_m2,
    avg_listing_duplicates_per_property,
    avg_price_change_pct_30d,
    stock_change_pct_7d,
    stock_change_pct_30d,
        CASE
            WHEN new_properties_last_7d > 0 THEN ('+'::text || new_properties_last_7d::text) || ' nouveaux biens uniques estimés sur 7 jours.'::text
            ELSE 'Aucun nouveau bien unique détecté sur 7 jours.'::text
        END AS line_new_supply,
        CASE
            WHEN price_drops_detected > 0 THEN price_drops_detected::text || ' biens uniques ont baissé leur prix récemment.'::text
            ELSE 'Aucune baisse de prix unique détectée récemment.'::text
        END AS line_price_drops,
        CASE
            WHEN stock_change_pct_7d IS NULL THEN 'Historique insuffisant pour mesurer l évolution du stock vendeur sur 7 jours.'::text
            WHEN stock_change_pct_7d > 0::numeric THEN ('Le stock vendeur est en hausse de '::text || stock_change_pct_7d::text) || ' % sur 7 jours.'::text
            WHEN stock_change_pct_7d < 0::numeric THEN ('Le stock vendeur est en baisse de '::text || abs(stock_change_pct_7d)::text) || ' % sur 7 jours.'::text
            ELSE 'Le stock vendeur est stable sur 7 jours.'::text
        END AS line_stock,
        CASE
            WHEN avg_price_change_pct_30d IS NULL THEN 'Historique insuffisant pour mesurer la tendance de prix sur 30 jours.'::text
            WHEN avg_price_change_pct_30d > 0::numeric THEN ('Les prix observés progressent de '::text || avg_price_change_pct_30d::text) || ' % sur 30 jours.'::text
            WHEN avg_price_change_pct_30d < 0::numeric THEN ('Les prix observés reculent de '::text || abs(avg_price_change_pct_30d)::text) || ' % sur 30 jours.'::text
            ELSE 'Les prix observés sont globalement stables sur 30 jours.'::text
        END AS line_price_trend,
        CASE
            WHEN avg_listing_duplicates_per_property >= 2::numeric THEN 'La multidiffusion est élevée, ce qui suggère une forte présence des mêmes biens sur plusieurs portails.'::text
            WHEN avg_listing_duplicates_per_property >= 1.2 THEN 'La multidiffusion reste modérée entre les différentes sources.'::text
            ELSE 'La duplication entre sources reste faible à ce stade.'::text
        END AS line_duplication,
    ((
        CASE
            WHEN new_properties_last_7d > 0 THEN ('+'::text || new_properties_last_7d::text) || ' nouveaux biens uniques estimés sur 7 jours. '::text
            ELSE 'Aucun nouveau bien unique détecté sur 7 jours. '::text
        END ||
        CASE
            WHEN price_drops_detected > 0 THEN price_drops_detected::text || ' biens uniques ont baissé leur prix récemment. '::text
            ELSE 'Aucune baisse de prix unique détectée récemment. '::text
        END) ||
        CASE
            WHEN stock_change_pct_7d IS NULL THEN 'Historique encore trop court pour qualifier précisément l évolution du stock vendeur. '::text
            WHEN stock_change_pct_7d > 0::numeric THEN 'Le stock vendeur progresse sur 7 jours, ce qui traduit un marché un peu plus fourni. '::text
            WHEN stock_change_pct_7d < 0::numeric THEN 'Le stock vendeur se contracte sur 7 jours, ce qui peut signaler un marché plus tendu. '::text
            ELSE 'Le stock vendeur est stable sur 7 jours. '::text
        END) ||
        CASE
            WHEN avg_listing_duplicates_per_property >= 2::numeric THEN 'La forte multidiffusion invite à raisonner en biens uniques plutôt qu en volume brut d annonces.'::text
            WHEN avg_listing_duplicates_per_property >= 1.2 THEN 'Une partie du volume observé provient probablement de rediffusions multi-portails.'::text
            ELSE 'Le volume observé semble peu affecté par la rediffusion multi-portails.'::text
        END AS market_narrative
   FROM v_market_zone_summary_v2 s;

-- v_market_zone_pressure
CREATE OR REPLACE VIEW public.v_market_zone_pressure AS
 SELECT city,
    zip_code,
    count(*) AS active_unique_properties,
    avg(days_on_market)::numeric(10,2) AS avg_days_on_market,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (days_on_market::double precision)) AS median_days_on_market,
    count(*) FILTER (WHERE price_drop_events >= 1) AS properties_with_price_drop,
    count(*) FILTER (WHERE market_freshness_bucket = 'stale'::text) AS stale_properties,
    count(*) FILTER (WHERE market_freshness_bucket = 'recent'::text) AS recent_properties,
    avg(total_price_change_pct)::numeric(10,2) AS avg_total_price_change_pct
   FROM v_property_cluster_seller_trajectory s
  WHERE (EXISTS ( SELECT 1
           FROM property_clusters c
          WHERE c.id = s.property_cluster_id AND c.is_active = true))
  GROUP BY city, zip_code;

-- v_market_zone_summary
CREATE OR REPLACE VIEW public.v_market_zone_summary AS
 WITH latest_by_cluster AS (
         SELECT t.property_cluster_id,
            t.city,
            t.zip_code,
            t.latest_observed_date,
            t.latest_price,
            t.latest_price_m2,
            t.price_change_pct_7d,
            t.price_change_pct_30d,
            t.price_drop_detected
           FROM v_property_price_trends t
        ), current_snapshot AS (
         SELECT latest_by_cluster.city,
            latest_by_cluster.zip_code,
            count(*) AS active_unique_properties,
            avg(latest_by_cluster.latest_price) AS avg_price,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (latest_by_cluster.latest_price::double precision)) AS median_price,
            avg(latest_by_cluster.latest_price_m2) AS avg_price_m2,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (latest_by_cluster.latest_price_m2::double precision)) AS median_price_m2,
            count(*) FILTER (WHERE latest_by_cluster.price_drop_detected IS TRUE) AS price_drops_detected,
            avg(latest_by_cluster.price_change_pct_7d) AS avg_price_change_pct_7d,
            avg(latest_by_cluster.price_change_pct_30d) AS avg_price_change_pct_30d
           FROM latest_by_cluster
          GROUP BY latest_by_cluster.city, latest_by_cluster.zip_code
        ), stock_7d AS (
         SELECT c.city,
            c.zip_code,
            count(DISTINCT h.property_cluster_id) AS stock_7d
           FROM property_price_history h
             JOIN property_clusters c ON c.id = h.property_cluster_id
          WHERE h.observed_date <= (CURRENT_DATE - 7)
          GROUP BY c.city, c.zip_code
        ), stock_30d AS (
         SELECT c.city,
            c.zip_code,
            count(DISTINCT h.property_cluster_id) AS stock_30d
           FROM property_price_history h
             JOIN property_clusters c ON c.id = h.property_cluster_id
          WHERE h.observed_date <= (CURRENT_DATE - 30)
          GROUP BY c.city, c.zip_code
        ), new_last_7d AS (
         SELECT c.city,
            c.zip_code,
            count(*) AS new_properties_last_7d
           FROM property_clusters c
             JOIN ( SELECT property_price_history.property_cluster_id,
                    min(property_price_history.observed_date) AS first_seen_date
                   FROM property_price_history
                  GROUP BY property_price_history.property_cluster_id) f ON f.property_cluster_id = c.id
          WHERE f.first_seen_date >= (CURRENT_DATE - 7)
          GROUP BY c.city, c.zip_code
        ), new_last_30d AS (
         SELECT c.city,
            c.zip_code,
            count(*) AS new_properties_last_30d
           FROM property_clusters c
             JOIN ( SELECT property_price_history.property_cluster_id,
                    min(property_price_history.observed_date) AS first_seen_date
                   FROM property_price_history
                  GROUP BY property_price_history.property_cluster_id) f ON f.property_cluster_id = c.id
          WHERE f.first_seen_date >= (CURRENT_DATE - 30)
          GROUP BY c.city, c.zip_code
        )
 SELECT cs.city,
    cs.zip_code,
    cs.active_unique_properties,
    COALESCE(s7.stock_7d, 0::bigint) AS stock_7d,
    COALESCE(s30.stock_30d, 0::bigint) AS stock_30d,
    COALESCE(n7.new_properties_last_7d, 0::bigint) AS new_properties_last_7d,
    COALESCE(n30.new_properties_last_30d, 0::bigint) AS new_properties_last_30d,
    round(cs.avg_price, 0) AS avg_price,
    round(cs.median_price::numeric, 0) AS median_price,
    round(cs.avg_price_m2, 0) AS avg_price_m2,
    round(cs.median_price_m2::numeric, 0) AS median_price_m2,
    cs.price_drops_detected,
    round(cs.avg_price_change_pct_7d, 2) AS avg_price_change_pct_7d,
    round(cs.avg_price_change_pct_30d, 2) AS avg_price_change_pct_30d,
        CASE
            WHEN COALESCE(s7.stock_7d, 0::bigint) = 0 THEN NULL::numeric
            ELSE round((cs.active_unique_properties - s7.stock_7d)::numeric / s7.stock_7d::numeric * 100::numeric, 2)
        END AS stock_change_pct_7d,
        CASE
            WHEN COALESCE(s30.stock_30d, 0::bigint) = 0 THEN NULL::numeric
            ELSE round((cs.active_unique_properties - s30.stock_30d)::numeric / s30.stock_30d::numeric * 100::numeric, 2)
        END AS stock_change_pct_30d
   FROM current_snapshot cs
     LEFT JOIN stock_7d s7 ON s7.city = cs.city AND s7.zip_code = cs.zip_code
     LEFT JOIN stock_30d s30 ON s30.city = cs.city AND s30.zip_code = cs.zip_code
     LEFT JOIN new_last_7d n7 ON n7.city = cs.city AND n7.zip_code = cs.zip_code
     LEFT JOIN new_last_30d n30 ON n30.city = cs.city AND n30.zip_code = cs.zip_code;

-- v_property_alert_cards
CREATE OR REPLACE VIEW public.v_property_alert_cards AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    observed_date,
    alert_type,
    alert_label,
    alert_message,
    opportunity_score,
    opportunity_bucket,
    memo_decision_bucket,
    canonical_price,
    delta_price,
    delta_opportunity_score,
    delta_confidence_score
   FROM v_property_alert_events a
  WHERE alert_type IS NOT NULL;

-- v_property_alert_events
CREATE OR REPLACE VIEW public.v_property_alert_events AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    observed_date,
        CASE
            WHEN prev_opportunity_score IS NULL THEN 'new_property_tracked'::text
            WHEN prev_opportunity_bucket IS DISTINCT FROM opportunity_bucket AND (opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text])) THEN 'opportunity_upgraded'::text
            WHEN delta_price IS NOT NULL AND delta_price < 0::numeric THEN 'price_drop'::text
            WHEN delta_opportunity_score IS NOT NULL AND delta_opportunity_score >= 10 THEN 'score_jump'::text
            WHEN delta_confidence_score IS NOT NULL AND delta_confidence_score >= 10 THEN 'confidence_improved'::text
            WHEN delta_market_gap_value IS NOT NULL AND delta_market_gap_value < 0::numeric THEN 'market_gap_reduced'::text
            ELSE NULL::text
        END AS alert_type,
        CASE
            WHEN prev_opportunity_score IS NULL THEN 'Nouveau bien désormais suivi'::text
            WHEN prev_opportunity_bucket IS DISTINCT FROM opportunity_bucket AND (opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text])) THEN 'Le bien monte en intérêt'::text
            WHEN delta_price IS NOT NULL AND delta_price < 0::numeric THEN 'Baisse de prix détectée'::text
            WHEN delta_opportunity_score IS NOT NULL AND delta_opportunity_score >= 10 THEN 'Score d opportunité en hausse'::text
            WHEN delta_confidence_score IS NOT NULL AND delta_confidence_score >= 10 THEN 'Confiance de lecture en hausse'::text
            WHEN delta_market_gap_value IS NOT NULL AND delta_market_gap_value < 0::numeric THEN 'Surcote en réduction'::text
            ELSE NULL::text
        END AS alert_label,
        CASE
            WHEN prev_opportunity_score IS NULL THEN 'Ce bien entre dans le périmètre de suivi avec une première lecture analytique.'::text
            WHEN prev_opportunity_bucket IS DISTINCT FROM opportunity_bucket AND (opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text])) THEN 'Le bien gagne en attractivité relative et remonte dans le classement des opportunités.'::text
            WHEN delta_price IS NOT NULL AND delta_price < 0::numeric THEN 'Le prix affiché recule, ce qui peut améliorer la fenêtre de négociation.'::text
            WHEN delta_opportunity_score IS NOT NULL AND delta_opportunity_score >= 10 THEN 'Les signaux agrégés progressent nettement par rapport au précédent snapshot.'::text
            WHEN delta_confidence_score IS NOT NULL AND delta_confidence_score >= 10 THEN 'La recommandation devient plus robuste grâce à un historique ou une base de marché plus solide.'::text
            WHEN delta_market_gap_value IS NOT NULL AND delta_market_gap_value < 0::numeric THEN 'L écart au marché se réduit, ce qui améliore le positionnement relatif du bien.'::text
            ELSE NULL::text
        END AS alert_message,
    opportunity_score,
    opportunity_bucket,
    memo_decision_bucket,
    canonical_price,
    delta_price,
    delta_opportunity_score,
    delta_confidence_score
   FROM v_property_daily_score_movements m
  WHERE prev_opportunity_score IS NULL OR prev_opportunity_bucket IS DISTINCT FROM opportunity_bucket AND (opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text])) OR delta_price IS NOT NULL AND delta_price < 0::numeric OR delta_opportunity_score IS NOT NULL AND delta_opportunity_score >= 10 OR delta_confidence_score IS NOT NULL AND delta_confidence_score >= 10 OR delta_market_gap_value IS NOT NULL AND delta_market_gap_value < 0::numeric;

-- v_property_cluster_market_gap
CREATE OR REPLACE VIEW public.v_property_cluster_market_gap AS
 SELECT c.id AS property_cluster_id,
    c.city,
    c.zip_code,
    c.normalized_address,
    c.property_type,
    c.canonical_surface_m2,
    c.canonical_price,
    c.canonical_price_m2,
    r.reference_date AS market_reference_date,
    r.median_price_m2 AS market_median_price_m2,
    r.avg_price_m2 AS market_avg_price_m2,
    r.sample_size AS market_sample_size,
    r.source AS market_source,
    r.confidence_score AS market_confidence_score,
        CASE
            WHEN c.canonical_surface_m2 IS NOT NULL AND r.median_price_m2 IS NOT NULL THEN round(c.canonical_surface_m2 * r.median_price_m2, 0)
            ELSE NULL::numeric
        END AS estimated_market_price_from_median,
        CASE
            WHEN c.canonical_surface_m2 IS NOT NULL AND r.avg_price_m2 IS NOT NULL THEN round(c.canonical_surface_m2 * r.avg_price_m2, 0)
            ELSE NULL::numeric
        END AS estimated_market_price_from_avg,
        CASE
            WHEN c.canonical_price_m2 IS NULL OR r.median_price_m2 IS NULL OR r.median_price_m2 = 0::numeric THEN NULL::numeric
            ELSE round((c.canonical_price_m2 - r.median_price_m2) / r.median_price_m2 * 100::numeric, 2)
        END AS price_m2_gap_vs_market_pct,
        CASE
            WHEN c.canonical_price IS NULL OR c.canonical_surface_m2 IS NULL OR r.median_price_m2 IS NULL OR r.median_price_m2 = 0::numeric THEN NULL::numeric
            ELSE round(c.canonical_price - c.canonical_surface_m2 * r.median_price_m2, 0)
        END AS price_gap_vs_market_value,
        CASE
            WHEN c.canonical_price_m2 IS NULL OR r.median_price_m2 IS NULL THEN NULL::text
            WHEN c.canonical_price_m2 >= (r.median_price_m2 * 1.08) THEN 'over_market'::text
            WHEN c.canonical_price_m2 <= (r.median_price_m2 * 0.92) THEN 'under_market'::text
            ELSE 'in_market'::text
        END AS market_position_bucket
   FROM property_clusters c
     LEFT JOIN v_market_price_reference_latest r ON r.city = c.city AND r.zip_code = c.zip_code;

-- v_property_cluster_market_gap_signals
CREATE OR REPLACE VIEW public.v_property_cluster_market_gap_signals AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    canonical_price,
    canonical_price_m2,
    market_median_price_m2,
    market_avg_price_m2,
    estimated_market_price_from_median,
    price_m2_gap_vs_market_pct,
    price_gap_vs_market_value,
    market_position_bucket,
    market_confidence_score,
        CASE
            WHEN market_position_bucket = 'over_market'::text THEN 'Bien positionné au-dessus du marché'::text
            WHEN market_position_bucket = 'under_market'::text THEN 'Bien positionné sous le marché'::text
            WHEN market_position_bucket = 'in_market'::text THEN 'Bien globalement aligné avec le marché'::text
            ELSE 'Positionnement marché non disponible'::text
        END AS market_position_label,
        CASE
            WHEN price_m2_gap_vs_market_pct IS NULL THEN 'Écart au marché non disponible'::text
            WHEN price_m2_gap_vs_market_pct > 0::numeric THEN ('Prix affiché supérieur de '::text || price_m2_gap_vs_market_pct::text) || ' % au marché local estimé'::text
            WHEN price_m2_gap_vs_market_pct < 0::numeric THEN ('Prix affiché inférieur de '::text || abs(price_m2_gap_vs_market_pct)::text) || ' % au marché local estimé'::text
            ELSE 'Prix affiché aligné sur le marché local estimé'::text
        END AS market_gap_signal,
        CASE
            WHEN price_gap_vs_market_value IS NULL THEN 'Écart de valeur absolue non disponible'::text
            WHEN price_gap_vs_market_value > 0::numeric THEN ('Surcote estimée d environ '::text || price_gap_vs_market_value::text) || ' € vs référence locale'::text
            WHEN price_gap_vs_market_value < 0::numeric THEN ('Décote estimée d environ '::text || abs(price_gap_vs_market_value)::text) || ' € vs référence locale'::text
            ELSE 'Pas d écart significatif de valeur absolue estimé'::text
        END AS market_value_signal
   FROM v_property_cluster_market_gap g;

-- v_property_cluster_negotiation_signals
CREATE OR REPLACE VIEW public.v_property_cluster_negotiation_signals AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    canonical_price,
    canonical_price_m2,
    days_on_market,
    price_drop_events,
    total_price_change_value,
    total_price_change_pct,
    total_negotiation_band_value,
    total_negotiation_band_pct,
    avg_listing_duplicates_per_property,
    negotiation_leverage_score,
    negotiation_leverage_bucket,
        CASE
            WHEN negotiation_leverage_bucket = 'high'::text THEN 'Levier de négociation élevé'::text
            WHEN negotiation_leverage_bucket = 'medium'::text THEN 'Levier de négociation modéré'::text
            ELSE 'Levier de négociation limité'::text
        END AS leverage_label,
        CASE
            WHEN days_on_market IS NULL THEN 'Ancienneté de commercialisation non disponible'::text
            WHEN days_on_market <= 14 THEN 'Bien encore récent sur le marché'::text
            WHEN days_on_market <= 60 THEN 'Bien déjà installé sur le marché'::text
            ELSE 'Bien présent depuis longtemps sur le marché'::text
        END AS leverage_time_signal,
        CASE
            WHEN COALESCE(price_drop_events, 0::bigint) = 0 THEN 'Aucune baisse de prix observée'::text
            WHEN price_drop_events = 1 THEN 'Une baisse de prix déjà observée'::text
            ELSE price_drop_events::text || ' baisses de prix déjà observées'::text
        END AS leverage_drop_signal,
        CASE
            WHEN total_price_change_value IS NULL THEN 'Variation cumulée de prix non disponible'::text
            WHEN total_price_change_value < 0::numeric THEN ('Baisse cumulée de '::text || abs(total_price_change_value)::text) || ' € depuis le premier prix suivi'::text
            WHEN total_price_change_value > 0::numeric THEN ('Hausse cumulée de '::text || total_price_change_value::text) || ' € depuis le premier prix suivi'::text
            ELSE 'Prix inchangé depuis le premier relevé'::text
        END AS leverage_price_signal,
        CASE
            WHEN total_negotiation_band_value IS NULL THEN 'Amplitude de négociation non disponible'::text
            WHEN total_negotiation_band_value = 0::numeric THEN 'Aucune amplitude de négociation observée'::text
            ELSE ('Amplitude observée de '::text || total_negotiation_band_value::text) || ' €'::text
        END AS leverage_band_signal,
        CASE
            WHEN negotiation_leverage_bucket = 'high'::text THEN 'Plusieurs signaux suggèrent un vendeur potentiellement preneur d une offre argumentée, surtout si le dossier est simple et rapide.'::text
            WHEN negotiation_leverage_bucket = 'medium'::text THEN 'Le contexte laisse envisager une négociation possible, mais plutôt encadrée et à justifier par les comparables et le timing.'::text
            ELSE 'Les signaux disponibles ne suggèrent pas encore un fort levier de négociation ; une offre trop agressive serait probablement moins bien reçue.'::text
        END AS negotiation_summary
   FROM v_property_cluster_negotiation_leverage n;

-- v_property_cluster_offer_guidance
CREATE OR REPLACE VIEW public.v_property_cluster_offer_guidance AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    canonical_price,
    negotiation_leverage_score,
    negotiation_leverage_bucket,
        CASE
            WHEN negotiation_leverage_bucket = 'high'::text THEN round(canonical_price * 0.92, 0)
            WHEN negotiation_leverage_bucket = 'medium'::text THEN round(canonical_price * 0.95, 0)
            ELSE round(canonical_price * 0.98, 0)
        END AS anchor_offer_price,
        CASE
            WHEN negotiation_leverage_bucket = 'high'::text THEN round(canonical_price * 0.95, 0)
            WHEN negotiation_leverage_bucket = 'medium'::text THEN round(canonical_price * 0.97, 0)
            ELSE round(canonical_price * 0.99, 0)
        END AS realistic_offer_price,
        CASE
            WHEN negotiation_leverage_bucket = 'high'::text THEN 'Approche possible : offre initiale plus ambitieuse, puis remontée tactique si la concurrence se manifeste.'::text
            WHEN negotiation_leverage_bucket = 'medium'::text THEN 'Approche possible : offre légèrement sous le prix affiché, argumentée par les signaux de marché et la trajectoire du bien.'::text
            ELSE 'Approche possible : négociation prudente, avec faible décote initiale pour éviter de se disqualifier.'::text
        END AS offer_strategy_note
   FROM v_property_cluster_negotiation_leverage n;

-- v_property_cluster_recommendation_summary
CREATE OR REPLACE VIEW public.v_property_cluster_recommendation_summary AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    acquisition_signal_bucket,
    acquisition_summary,
    anchor_offer_price,
    realistic_offer_price,
    recommendation_confidence_score,
    recommendation_confidence_bucket,
        CASE
            WHEN recommendation_confidence_bucket = 'high'::text THEN 'Confiance élevée dans la recommandation'::text
            WHEN recommendation_confidence_bucket = 'medium'::text THEN 'Confiance intermédiaire dans la recommandation'::text
            ELSE 'Confiance limitée dans la recommandation'::text
        END AS confidence_label,
        CASE
            WHEN recommendation_confidence_bucket = 'high'::text THEN 'Le signal est bien étayé par la profondeur de marché et l historique du bien.'::text
            WHEN recommendation_confidence_bucket = 'medium'::text THEN 'Le signal est utile, mais doit encore être recoupé avec les comparables et la visite.'::text
            ELSE 'Le signal doit être interprété avec prudence faute de profondeur ou d historique suffisant.'::text
        END AS confidence_comment,
    ((((((((acquisition_summary || ' '::text) ||
        CASE
            WHEN recommendation_confidence_bucket = 'high'::text THEN 'Le niveau de confiance associé à cette lecture est élevé.'::text
            WHEN recommendation_confidence_bucket = 'medium'::text THEN 'Le niveau de confiance associé à cette lecture est intermédiaire.'::text
            ELSE 'Le niveau de confiance associé à cette lecture reste limité.'::text
        END) || ' '::text) || 'Point d entrée tactique estimé : '::text) || COALESCE(anchor_offer_price::text, 'ND'::text)) || ' €. '::text) || 'Offre réaliste estimée : '::text) || COALESCE(realistic_offer_price::text, 'ND'::text)) || ' €.'::text AS recommendation_narrative
   FROM v_property_cluster_recommendation_confidence c;

-- v_property_cluster_seller_trajectory
CREATE OR REPLACE VIEW public.v_property_cluster_seller_trajectory AS
 WITH first_snapshot AS (
         SELECT DISTINCT ON (h.property_cluster_id) h.property_cluster_id,
            h.observed_date AS first_observed_date,
            h.price AS first_observed_price,
            h.price_m2 AS first_observed_price_m2
           FROM property_price_history h
          ORDER BY h.property_cluster_id, h.observed_date, h.created_at
        ), latest_snapshot AS (
         SELECT DISTINCT ON (h.property_cluster_id) h.property_cluster_id,
            h.observed_date AS latest_observed_date,
            h.price AS latest_observed_price,
            h.price_m2 AS latest_observed_price_m2
           FROM property_price_history h
          ORDER BY h.property_cluster_id, h.observed_date DESC, h.created_at DESC
        ), agg_history AS (
         SELECT h.property_cluster_id,
            min(h.price) AS lowest_observed_price,
            max(h.price) AS highest_observed_price,
            min(h.price_m2) AS lowest_observed_price_m2,
            max(h.price_m2) AS highest_observed_price_m2,
            count(*) AS snapshot_days
           FROM property_price_history h
          GROUP BY h.property_cluster_id
        ), drops AS (
         SELECT m.property_cluster_id,
            min(m.observed_date) FILTER (WHERE m.is_price_drop = true) AS first_price_drop_date,
            max(m.observed_date) FILTER (WHERE m.is_price_drop = true) AS last_price_drop_date,
            count(*) FILTER (WHERE m.is_price_drop = true) AS price_drop_events
           FROM v_property_price_movements m
          GROUP BY m.property_cluster_id
        )
 SELECT c.id AS property_cluster_id,
    c.city,
    c.zip_code,
    c.normalized_address,
    c.property_type,
    c.rooms,
    c.bedrooms,
    c.canonical_surface_m2,
    c.canonical_price,
    c.canonical_price_m2,
    c.first_seen_at,
    c.last_seen_at,
    EXTRACT(day FROM now() - c.first_seen_at)::integer AS days_on_market,
    fs.first_observed_date,
    fs.first_observed_price,
    fs.first_observed_price_m2,
    ls.latest_observed_date,
    ls.latest_observed_price,
    ls.latest_observed_price_m2,
    ah.lowest_observed_price,
    ah.highest_observed_price,
    ah.lowest_observed_price_m2,
    ah.highest_observed_price_m2,
    ah.snapshot_days,
    d.first_price_drop_date,
    d.last_price_drop_date,
    COALESCE(d.price_drop_events, 0::bigint) AS price_drop_events,
    ls.latest_observed_price - fs.first_observed_price AS total_price_change_value,
        CASE
            WHEN fs.first_observed_price IS NULL OR fs.first_observed_price = 0::numeric THEN NULL::numeric
            ELSE round((ls.latest_observed_price - fs.first_observed_price) / fs.first_observed_price * 100::numeric, 2)
        END AS total_price_change_pct,
    ah.highest_observed_price - ah.lowest_observed_price AS total_negotiation_band_value,
        CASE
            WHEN ah.highest_observed_price IS NULL OR ah.highest_observed_price = 0::numeric THEN NULL::numeric
            ELSE round((ah.lowest_observed_price - ah.highest_observed_price) / ah.highest_observed_price * 100::numeric, 2)
        END AS total_negotiation_band_pct,
        CASE
            WHEN EXTRACT(day FROM now() - c.first_seen_at) <= 14::numeric THEN 'recent'::text
            WHEN EXTRACT(day FROM now() - c.first_seen_at) <= 60::numeric THEN 'installed'::text
            ELSE 'stale'::text
        END AS market_freshness_bucket,
        CASE
            WHEN COALESCE(d.price_drop_events, 0::bigint) = 0 THEN 'no_drop_observed'::text
            WHEN COALESCE(d.price_drop_events, 0::bigint) = 1 THEN 'single_drop'::text
            ELSE 'multiple_drops'::text
        END AS price_adjustment_pattern
   FROM property_clusters c
     LEFT JOIN first_snapshot fs ON fs.property_cluster_id = c.id
     LEFT JOIN latest_snapshot ls ON ls.property_cluster_id = c.id
     LEFT JOIN agg_history ah ON ah.property_cluster_id = c.id
     LEFT JOIN drops d ON d.property_cluster_id = c.id;

-- v_property_cluster_signals
CREATE OR REPLACE VIEW public.v_property_cluster_signals AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    rooms,
    bedrooms,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    days_on_market,
    first_observed_date,
    latest_observed_date,
    first_observed_price,
    latest_observed_price,
    lowest_observed_price,
    highest_observed_price,
    price_drop_events,
    total_price_change_value,
    total_price_change_pct,
    total_negotiation_band_value,
    total_negotiation_band_pct,
    market_freshness_bucket,
    price_adjustment_pattern,
        CASE
            WHEN days_on_market IS NULL THEN 'Ancienneté non disponible'::text
            WHEN days_on_market <= 14 THEN 'Bien récemment apparu sur le marché'::text
            WHEN days_on_market <= 60 THEN 'Bien installé sur le marché'::text
            ELSE 'Bien en ligne depuis longtemps'::text
        END AS signal_days_on_market,
        CASE
            WHEN price_drop_events = 0 THEN 'Aucune baisse de prix observée'::text
            WHEN price_drop_events = 1 THEN 'Une baisse de prix observée'::text
            ELSE price_drop_events::text || ' baisses de prix observées'::text
        END AS signal_price_drops,
        CASE
            WHEN total_price_change_value IS NULL THEN 'Variation de prix non disponible'::text
            WHEN total_price_change_value < 0::numeric THEN ('Prix actuel en baisse de '::text || abs(total_price_change_value)::text) || ' € vs premier prix observé'::text
            WHEN total_price_change_value > 0::numeric THEN ('Prix actuel en hausse de '::text || total_price_change_value::text) || ' € vs premier prix observé'::text
            ELSE 'Prix actuel identique au premier prix observé'::text
        END AS signal_total_price_change,
        CASE
            WHEN total_negotiation_band_value IS NULL THEN 'Amplitude de négociation non disponible'::text
            WHEN total_negotiation_band_value = 0::numeric THEN 'Aucune amplitude de négociation observée'::text
            ELSE ('Amplitude observée de '::text || total_negotiation_band_value::text) || ' € entre le plus haut et le plus bas'::text
        END AS signal_negotiation_band,
        CASE
            WHEN market_freshness_bucket = 'recent'::text AND price_drop_events = 0 THEN 'Annonce récente, sans signal de correction vendeur à ce stade.'::text
            WHEN market_freshness_bucket = 'recent'::text AND price_drop_events >= 1 THEN 'Annonce récente avec premiers ajustements vendeurs déjà visibles.'::text
            WHEN market_freshness_bucket = 'installed'::text AND price_drop_events = 0 THEN 'Bien installé sur le marché, encore sans correction de prix observée.'::text
            WHEN market_freshness_bucket = 'installed'::text AND price_drop_events >= 1 THEN 'Bien installé avec ajustements de prix, à surveiller pour le levier de négociation.'::text
            WHEN market_freshness_bucket = 'stale'::text AND price_drop_events = 0 THEN 'Bien ancien en ligne, sans baisse observée : position vendeur possiblement rigide.'::text
            WHEN market_freshness_bucket = 'stale'::text AND price_drop_events >= 1 THEN 'Bien ancien avec baisses successives : vendeur potentiellement plus ouvert à la négociation.'::text
            ELSE 'Signal vendeur en cours de constitution.'::text
        END AS seller_signal_summary
   FROM v_property_cluster_seller_trajectory t;

-- v_property_investment_memo_ui
CREATE OR REPLACE VIEW public.v_property_investment_memo_ui AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    rooms,
    bedrooms,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    market_position_label,
    market_gap_signal,
    market_value_signal,
    leverage_label,
    leverage_time_signal,
    leverage_drop_signal,
    leverage_price_signal,
    leverage_band_signal,
    anchor_offer_price,
    realistic_offer_price,
    offer_strategy_note,
    acquisition_signal_bucket,
    acquisition_summary,
    confidence_label,
    confidence_comment,
    zone_market_narrative,
    recommendation_narrative,
    memo_decision_bucket,
    memo_decision_comment
   FROM v_property_investment_memo;

-- v_property_opportunity_reasons
CREATE OR REPLACE VIEW public.v_property_opportunity_reasons AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
        CASE
            WHEN market_position_bucket = 'under_market'::text THEN true
            ELSE false
        END AS badge_under_market,
        CASE
            WHEN market_position_bucket = 'in_market'::text AND price_m2_gap_vs_market_pct IS NOT NULL AND price_m2_gap_vs_market_pct > 0::numeric THEN true
            ELSE false
        END AS badge_slight_over_market,
        CASE
            WHEN COALESCE(price_drop_events, 0::bigint) >= 1 THEN true
            ELSE false
        END AS badge_price_drop_detected,
        CASE
            WHEN negotiation_leverage_bucket = ANY (ARRAY['medium'::text, 'high'::text]) THEN true
            ELSE false
        END AS badge_negotiable,
        CASE
            WHEN recommendation_confidence_bucket = 'low'::text THEN true
            ELSE false
        END AS badge_low_confidence,
        CASE
            WHEN days_on_market >= 30 THEN true
            ELSE false
        END AS badge_longer_market_exposure,
        CASE
            WHEN opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text]) THEN true
            ELSE false
        END AS badge_high_interest,
        CASE
            WHEN opportunity_bucket = 'watchlist'::text THEN true
            ELSE false
        END AS badge_watchlist,
    array_remove(ARRAY[
        CASE
            WHEN market_position_bucket = 'under_market'::text THEN 'Sous le marché'::text
            ELSE NULL::text
        END,
        CASE
            WHEN market_position_bucket = 'in_market'::text AND price_m2_gap_vs_market_pct IS NOT NULL AND price_m2_gap_vs_market_pct > 0::numeric THEN 'Légère surcote'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(price_drop_events, 0::bigint) >= 1 THEN 'Baisse de prix détectée'::text
            ELSE NULL::text
        END,
        CASE
            WHEN negotiation_leverage_bucket = ANY (ARRAY['medium'::text, 'high'::text]) THEN 'Négociation possible'::text
            ELSE NULL::text
        END,
        CASE
            WHEN recommendation_confidence_bucket = 'low'::text THEN 'Confiance encore limitée'::text
            ELSE NULL::text
        END,
        CASE
            WHEN days_on_market >= 30 THEN 'Exposition marché plus longue'::text
            ELSE NULL::text
        END,
        CASE
            WHEN opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text]) THEN 'Opportunité à prioriser'::text
            ELSE NULL::text
        END,
        CASE
            WHEN opportunity_bucket = 'watchlist'::text THEN 'À surveiller'::text
            ELSE NULL::text
        END], NULL::text) AS opportunity_reason_tags
   FROM v_property_opportunity_score o;

-- v_quick_copilot_market_summary
CREATE OR REPLACE VIEW public.v_quick_copilot_market_summary AS
 SELECT commune_code,
    commune_nom,
    COALESCE(prix_m2_median_appartement, prix_m2_median_maison) AS prix_m2_reference,
    evolution_5ans,
    dynamique_prix,
    nb_transactions_12m,
    demande_estimee,
    potentiel_revente,
    attractivite_secteur,
    niveau_marche,
    niveau_dynamique,
    score_attractivite,
    score_demande,
    score_revente,
    score_progression
   FROM v_quick_investor_insights;

-- v_quick_investor_insights
CREATE OR REPLACE VIEW public.v_quick_investor_insights AS
 SELECT da.commune_code,
    da.commune_nom,
    da.prix_m2_median_appartement,
    da.prix_m2_median_maison,
    da.prix_m2_median_recent,
    da.prix_m2_median_ancien,
    da.evolution_5ans,
    da.nb_transactions_12m,
    da.surface_mediane,
    ms.score_attractivite,
    ms.score_demande,
    ms.score_revente,
    ms.niveau_marche,
    ms.niveau_dynamique,
    mdi.dynamique_prix,
    mdi.score_progression,
        CASE
            WHEN da.nb_transactions_12m >= 40 THEN 'forte'::text
            WHEN da.nb_transactions_12m >= 20 THEN 'correcte'::text
            WHEN da.nb_transactions_12m >= 10 THEN 'modérée'::text
            ELSE 'faible'::text
        END AS demande_estimee,
        CASE
            WHEN ms.score_revente >= 75::numeric THEN 'excellent'::text
            WHEN ms.score_revente >= 55::numeric THEN 'bon'::text
            WHEN ms.score_revente >= 35::numeric THEN 'moyen'::text
            ELSE 'faible'::text
        END AS potentiel_revente,
        CASE
            WHEN ms.score_attractivite >= 75::numeric THEN 'très attractif'::text
            WHEN ms.score_attractivite >= 55::numeric THEN 'attractif'::text
            WHEN ms.score_attractivite >= 35::numeric THEN 'moyen'::text
            ELSE 'peu attractif'::text
        END AS attractivite_secteur
   FROM dvf_aggregates da
     LEFT JOIN market_scores ms ON ms.commune_code = da.commune_code
     LEFT JOIN v_market_dynamic_insights mdi ON mdi.commune_code = da.commune_code;

-- v_quick_investor_listings_clean
CREATE OR REPLACE VIEW public.v_quick_investor_listings_clean AS
 WITH ranked AS (
         SELECT listings_with_price_m2.id,
            listings_with_price_m2.portal,
            listings_with_price_m2.listing_portal_id,
            listings_with_price_m2.url,
            listings_with_price_m2.city,
            listings_with_price_m2.zip_code,
            listings_with_price_m2.price,
            listings_with_price_m2.surface,
            listings_with_price_m2.computed_price_m2,
            listings_with_price_m2.first_seen_at,
            listings_with_price_m2.seen_at,
            listings_with_price_m2.canonical_key,
            row_number() OVER (PARTITION BY listings_with_price_m2.canonical_key ORDER BY listings_with_price_m2.seen_at DESC NULLS LAST, listings_with_price_m2.first_seen_at DESC NULLS LAST) AS rn
           FROM listings_with_price_m2
          WHERE listings_with_price_m2.computed_price_m2 IS NOT NULL AND listings_with_price_m2.price IS NOT NULL AND listings_with_price_m2.surface IS NOT NULL AND listings_with_price_m2.zip_code IS NOT NULL
        )
 SELECT id,
    portal,
    listing_portal_id,
    url,
    city,
    zip_code,
    price,
    surface,
    computed_price_m2,
    first_seen_at,
    seen_at,
    canonical_key,
    rn,
        CASE
            WHEN url ~~* '%location%'::text OR price < 10000::numeric OR computed_price_m2 < 100::numeric THEN 'location'::text
            WHEN url ~~* '%terrain%'::text OR surface >= 300::numeric OR computed_price_m2 < 300::numeric THEN 'terrain'::text
            ELSE 'vente'::text
        END AS listing_kind,
        CASE
            WHEN price >= 50000::numeric AND surface >= 15::numeric AND surface <= 250::numeric AND computed_price_m2 >= 800::numeric AND computed_price_m2 <= 25000::numeric AND url !~~* '%terrain%'::text THEN true
            ELSE false
        END AS is_residential_comparable
   FROM ranked
  WHERE rn = 1;

-- v_quick_investor_listings_insights
CREATE OR REPLACE VIEW public.v_quick_investor_listings_insights AS
 WITH clean AS (
         SELECT v_quick_investor_listings_clean.id,
            v_quick_investor_listings_clean.portal,
            v_quick_investor_listings_clean.listing_portal_id,
            v_quick_investor_listings_clean.url,
            v_quick_investor_listings_clean.city,
            v_quick_investor_listings_clean.zip_code,
            v_quick_investor_listings_clean.price,
            v_quick_investor_listings_clean.surface,
            v_quick_investor_listings_clean.computed_price_m2,
            v_quick_investor_listings_clean.first_seen_at,
            v_quick_investor_listings_clean.seen_at,
            v_quick_investor_listings_clean.canonical_key,
            v_quick_investor_listings_clean.rn,
            v_quick_investor_listings_clean.listing_kind,
            v_quick_investor_listings_clean.is_residential_comparable
           FROM v_quick_investor_listings_clean
          WHERE v_quick_investor_listings_clean.is_residential_comparable = true AND v_quick_investor_listings_clean.listing_kind = 'vente'::text
        ), market_by_city_zip AS (
         SELECT lower(TRIM(BOTH FROM COALESCE(clean.city, ''::text))) AS city_key,
            clean.zip_code,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (clean.computed_price_m2::double precision))::numeric AS median_price_m2,
            avg(clean.computed_price_m2) AS avg_price_m2,
            count(*)::integer AS listings_count
           FROM clean
          GROUP BY (lower(TRIM(BOTH FROM COALESCE(clean.city, ''::text)))), clean.zip_code
        )
 SELECT l.id,
    l.portal,
    l.listing_portal_id,
    l.url,
    l.city,
    l.zip_code,
    l.price,
    l.surface,
    l.computed_price_m2,
    l.listing_kind,
    l.is_residential_comparable,
    m.median_price_m2,
    m.avg_price_m2,
    m.listings_count,
    round((l.computed_price_m2 - m.median_price_m2) / NULLIF(m.median_price_m2, 0::numeric) * 100::numeric, 2) AS ecart_marche_pct,
        CASE
            WHEN m.listings_count < 5 THEN 'données insuffisantes'::text
            WHEN abs((l.computed_price_m2 - m.median_price_m2) / NULLIF(m.median_price_m2, 0::numeric)) > 0.45 THEN 'atypique à vérifier'::text
            WHEN l.computed_price_m2 <= (m.median_price_m2 * 0.85) THEN 'fortement décoté'::text
            WHEN l.computed_price_m2 <= (m.median_price_m2 * 0.93) THEN 'décoté'::text
            WHEN l.computed_price_m2 <= (m.median_price_m2 * 1.07) THEN 'cohérent marché'::text
            WHEN l.computed_price_m2 <= (m.median_price_m2 * 1.15) THEN 'surcoté'::text
            ELSE 'fortement surcoté'::text
        END AS position_marche,
        CASE
            WHEN m.listings_count >= 20 THEN 'forte'::text
            WHEN m.listings_count >= 10 THEN 'correcte'::text
            WHEN m.listings_count >= 5 THEN 'modérée'::text
            ELSE 'faible'::text
        END AS profondeur_marche,
        CASE
            WHEN m.listings_count >= 20 AND abs((l.computed_price_m2 - m.median_price_m2) / NULLIF(m.median_price_m2, 0::numeric)) <= 0.30 THEN 'élevée'::text
            WHEN m.listings_count >= 10 AND abs((l.computed_price_m2 - m.median_price_m2) / NULLIF(m.median_price_m2, 0::numeric)) <= 0.40 THEN 'moyenne'::text
            WHEN m.listings_count >= 5 THEN 'faible'::text
            ELSE 'très faible'::text
        END AS confidence_level
   FROM clean l
     LEFT JOIN market_by_city_zip m ON m.zip_code = l.zip_code AND m.city_key = lower(TRIM(BOTH FROM COALESCE(l.city, ''::text)));

-- v_quick_questions_mvp
CREATE OR REPLACE VIEW public.v_quick_questions_mvp AS
 SELECT id,
    portal,
    listing_portal_id,
    url,
    city,
    zip_code,
    price,
    surface,
    computed_price_m2,
    median_price_m2,
    listings_count,
    ecart_marche_pct,
    position_marche,
    profondeur_marche,
    confidence_level,
        CASE
            WHEN (position_marche = ANY (ARRAY['fortement décoté'::text, 'décoté'::text])) AND (confidence_level = ANY (ARRAY['élevée'::text, 'moyenne'::text])) THEN true
            ELSE false
        END AS is_discount_opportunity,
        CASE
            WHEN position_marche = 'cohérent marché'::text AND (confidence_level = ANY (ARRAY['élevée'::text, 'moyenne'::text])) THEN true
            ELSE false
        END AS is_market_coherent,
        CASE
            WHEN profondeur_marche = ANY (ARRAY['forte'::text, 'correcte'::text]) THEN true
            ELSE false
        END AS has_liquid_market,
        CASE
            WHEN confidence_level = 'élevée'::text AND (position_marche = ANY (ARRAY['fortement décoté'::text, 'décoté'::text])) AND profondeur_marche = 'forte'::text THEN 'opportunité forte'::text
            WHEN (confidence_level = ANY (ARRAY['élevée'::text, 'moyenne'::text])) AND (position_marche = ANY (ARRAY['fortement décoté'::text, 'décoté'::text])) THEN 'opportunité à étudier'::text
            WHEN (confidence_level = ANY (ARRAY['élevée'::text, 'moyenne'::text])) AND position_marche = 'cohérent marché'::text THEN 'prix cohérent'::text
            WHEN position_marche = ANY (ARRAY['surcoté'::text, 'fortement surcoté'::text]) THEN 'prix à négocier'::text
            WHEN position_marche = 'atypique à vérifier'::text THEN 'bien atypique'::text
            ELSE 'données insuffisantes'::text
        END AS quick_verdict,
    jsonb_build_object('prix_m2_bien', computed_price_m2, 'prix_m2_marche', median_price_m2, 'ecart_marche_pct', ecart_marche_pct, 'position_marche', position_marche, 'profondeur_marche', profondeur_marche, 'confiance', confidence_level, 'nb_annonces_comparables', listings_count) AS quick_payload
   FROM v_quick_investor_listings_insights;

-- v_user_watchlists_home_dashboard_json
CREATE OR REPLACE VIEW public.v_user_watchlists_home_dashboard_json AS
 SELECT user_id,
    jsonb_build_object('user_id', user_id, 'active_watchlists', active_watchlists, 'total_active_properties', total_active_properties, 'total_alerts_last_7d', total_alerts_last_7d, 'total_new_properties_last_7d', total_new_properties_last_7d, 'total_price_drops_last_7d', total_price_drops_last_7d, 'best_opportunity', jsonb_build_object('watchlist_id', best_watchlist_id, 'watchlist_name', best_watchlist_name, 'property_cluster_id', best_property_cluster_id, 'city', best_city, 'zip_code', best_zip_code, 'normalized_address', best_normalized_address, 'opportunity_score', best_opportunity_score, 'opportunity_bucket', best_opportunity_bucket), 'latest_alert', jsonb_build_object('watchlist_id', latest_alert_watchlist_id, 'watchlist_name', latest_alert_watchlist_name, 'property_cluster_id', latest_alert_property_cluster_id, 'city', latest_alert_city, 'zip_code', latest_alert_zip_code, 'normalized_address', latest_alert_normalized_address, 'observed_date', latest_alert_observed_date, 'alert_type', latest_alert_type, 'alert_label', latest_alert_label, 'alert_message', latest_alert_message), 'watchlists', watchlists_payload) AS dashboard_payload
   FROM v_user_watchlists_home_dashboard;

-- v_watchlist_alert_cards
CREATE OR REPLACE VIEW public.v_watchlist_alert_cards AS
 SELECT w.user_id,
    wm.watchlist_id,
    w.name AS watchlist_name,
    a.property_cluster_id,
    a.city,
    a.zip_code,
    a.normalized_address,
    a.observed_date,
    a.alert_type,
    a.alert_label,
    a.alert_message,
    a.opportunity_score,
    a.opportunity_bucket,
    a.memo_decision_bucket,
    a.canonical_price,
    a.delta_price,
    a.delta_opportunity_score,
    a.delta_confidence_score
   FROM v_property_alert_cards a
     JOIN user_watchlist_matches wm ON wm.property_cluster_id = a.property_cluster_id AND wm.is_active = true
     JOIN user_watchlists w ON w.id = wm.watchlist_id AND w.is_active = true;

-- v_watchlist_alerts_to_send
CREATE OR REPLACE VIEW public.v_watchlist_alerts_to_send AS
 SELECT user_id,
    watchlist_id,
    watchlist_name,
    property_cluster_id,
    city,
    zip_code,
    normalized_address,
    observed_date,
    alert_type,
    alert_label,
    alert_message,
    opportunity_score,
    opportunity_bucket,
    memo_decision_bucket,
    canonical_price,
    delta_price,
    delta_opportunity_score,
    delta_confidence_score
   FROM v_watchlist_alert_cards a
  WHERE NOT (EXISTS ( SELECT 1
           FROM watchlist_alert_notifications n
          WHERE n.watchlist_id = a.watchlist_id AND n.property_cluster_id = a.property_cluster_id AND n.alert_type = a.alert_type AND n.observed_date = a.observed_date));

-- v_watchlist_dashboard
CREATE OR REPLACE VIEW public.v_watchlist_dashboard AS
 SELECT watchlist_id,
    user_id,
    watchlist_name,
    city,
    zip_code,
    property_type,
    active_properties,
    alerts_last_7d,
    new_properties_last_7d,
    price_drops_last_7d,
    avg_opportunity_score,
    best_opportunity_score,
    interesting_or_better_count,
    watchlist_count
   FROM v_watchlist_summary s;

-- v_watchlist_digest_narrative
CREATE OR REPLACE VIEW public.v_watchlist_digest_narrative AS
 SELECT watchlist_id,
    user_id,
    watchlist_name,
    city,
    zip_code,
    property_type,
    active_properties,
    alerts_last_7d,
    new_properties_last_7d,
    price_drops_last_7d,
    upgraded_last_7d,
    score_jumps_last_7d,
    avg_opportunity_score,
    best_opportunity_score,
    ((((((((((((((('Watchlist "'::text || watchlist_name) || '" : '::text) || active_properties::text) || ' biens actifs suivis. '::text) || new_properties_last_7d::text) || ' nouveaux biens sur 7 jours. '::text) || price_drops_last_7d::text) || ' baisses de prix détectées. '::text) || alerts_last_7d::text) || ' alertes récentes au total. '::text) || 'Score d opportunité moyen : '::text) || avg_opportunity_score::text) || '. '::text) || 'Meilleur score actuel : '::text) || best_opportunity_score::text) || '.'::text AS digest_narrative
   FROM v_watchlist_digest_summary s;

-- v_watchlist_digest_recent5
CREATE OR REPLACE VIEW public.v_watchlist_digest_recent5 AS
 SELECT watchlist_id,
    user_id,
    watchlist_name,
    property_cluster_id,
    city,
    zip_code,
    normalized_address,
    observed_date,
    alert_type,
    alert_label,
    alert_message,
    rn
   FROM ( SELECT a.watchlist_id,
            a.user_id,
            a.watchlist_name,
            a.property_cluster_id,
            a.city,
            a.zip_code,
            a.normalized_address,
            a.observed_date,
            a.alert_type,
            a.alert_label,
            a.alert_message,
            row_number() OVER (PARTITION BY a.watchlist_id ORDER BY a.observed_date DESC, a.normalized_address) AS rn
           FROM v_watchlist_alert_cards a) x
  WHERE rn <= 5;

-- v_watchlist_digest_top3
CREATE OR REPLACE VIEW public.v_watchlist_digest_top3 AS
 SELECT watchlist_id,
    user_id,
    watchlist_name,
    watchlist_rank,
    property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    opportunity_score,
    opportunity_bucket,
    rn
   FROM ( SELECT t.watchlist_id,
            t.user_id,
            t.watchlist_name,
            t.watchlist_rank,
            t.property_cluster_id,
            t.city,
            t.zip_code,
            t.normalized_address,
            t.property_type,
            t.canonical_surface_m2,
            t.canonical_price,
            t.canonical_price_m2,
            t.opportunity_score,
            t.opportunity_bucket,
            row_number() OVER (PARTITION BY t.watchlist_id ORDER BY t.watchlist_rank) AS rn
           FROM v_watchlist_top_opportunities t) x
  WHERE rn <= 3;

-- v_watchlist_notification_payloads
CREATE OR REPLACE VIEW public.v_watchlist_notification_payloads AS
 SELECT user_id,
    watchlist_id,
    watchlist_name,
    property_cluster_id,
    city,
    zip_code,
    normalized_address,
    observed_date,
    alert_type,
    alert_label,
    alert_message,
    opportunity_score,
    opportunity_bucket,
    memo_decision_bucket,
    canonical_price,
    jsonb_build_object('user_id', user_id, 'watchlist_id', watchlist_id, 'watchlist_name', watchlist_name, 'property_cluster_id', property_cluster_id, 'city', city, 'zip_code', zip_code, 'address', normalized_address, 'observed_date', observed_date, 'alert_type', alert_type, 'alert_label', alert_label, 'alert_message', alert_message, 'opportunity_score', opportunity_score, 'opportunity_bucket', opportunity_bucket, 'memo_decision_bucket', memo_decision_bucket, 'canonical_price', canonical_price) AS payload_json
   FROM v_watchlist_alerts_to_send a;

-- v_watchlist_page_payload_json
CREATE OR REPLACE VIEW public.v_watchlist_page_payload_json AS
 SELECT watchlist_id,
    page_payload
   FROM v_watchlist_page_payload;

-- v_watchlist_recent_alerts
CREATE OR REPLACE VIEW public.v_watchlist_recent_alerts AS
 SELECT user_id,
    watchlist_id,
    watchlist_name,
    property_cluster_id,
    city,
    zip_code,
    normalized_address,
    observed_date,
    alert_type,
    alert_label,
    alert_message,
    opportunity_score,
    opportunity_bucket,
    memo_decision_bucket,
    canonical_price,
    delta_price,
    delta_opportunity_score,
    delta_confidence_score,
    row_number() OVER (PARTITION BY watchlist_id ORDER BY observed_date DESC, normalized_address) AS alert_rank
   FROM v_watchlist_alert_cards a;

-- v_watchlist_top_opportunities
CREATE OR REPLACE VIEW public.v_watchlist_top_opportunities AS
 SELECT watchlist_id,
    user_id,
    watchlist_name,
    property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    opportunity_score,
    opportunity_bucket,
    recommendation_confidence_score,
    recommendation_confidence_bucket,
    memo_decision_bucket,
    row_number() OVER (PARTITION BY watchlist_id ORDER BY opportunity_score DESC, recommendation_confidence_score DESC, canonical_price) AS watchlist_rank
   FROM v_user_watchlist_candidates c;

-- v_zone_opportunity_ranking
CREATE OR REPLACE VIEW public.v_zone_opportunity_ranking AS
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    market_position_bucket,
    price_m2_gap_vs_market_pct,
    price_gap_vs_market_value,
    negotiation_leverage_score,
    negotiation_leverage_bucket,
    recommendation_confidence_score,
    recommendation_confidence_bucket,
    price_drop_events,
    days_on_market,
    market_freshness_bucket,
    memo_decision_bucket,
    avg_listing_duplicates_per_property,
    opportunity_score,
    opportunity_bucket,
    row_number() OVER (PARTITION BY city, zip_code ORDER BY opportunity_score DESC, recommendation_confidence_score DESC, canonical_price) AS zone_rank
   FROM v_property_opportunity_score o;

-- veille_user_summary
CREATE OR REPLACE VIEW public.veille_user_summary AS
 SELECT user_id,
    active_watchlists,
    total_active_properties::integer AS total_active_properties,
    total_alerts_last_7d::integer AS total_alerts_last_7d,
    total_new_properties_last_7d::integer AS total_new_properties_last_7d,
    total_price_drops_last_7d::integer AS total_price_drops_last_7d,
    best_watchlist_id,
    best_watchlist_name,
    best_city,
    best_zip_code,
    best_normalized_address,
    best_opportunity_score,
    best_opportunity_bucket
   FROM v_user_watchlists_home_dashboard;

-- dvf
CREATE OR REPLACE VIEW public.dvf AS
 SELECT identifiant_document,
    reference_document,
    date_mutation,
    nature_mutation,
    valeur_fonciere,
    code_departement,
    code_commune,
    commune,
    code_postal,
    type_local,
    surface_reelle_bati,
    surface_terrain,
    nombre_pieces_principales,
    nature_culture,
    nature_culture_speciale,
        CASE
            WHEN surface_reelle_bati > 0::numeric AND valeur_fonciere > 0::numeric THEN round(valeur_fonciere / surface_reelle_bati)
            ELSE NULL::numeric
        END AS prix_m2
   FROM ( SELECT dvf_2025_s1_typed.identifiant_document,
            dvf_2025_s1_typed.reference_document,
            dvf_2025_s1_typed.date_mutation,
            dvf_2025_s1_typed.nature_mutation,
            dvf_2025_s1_typed.valeur_fonciere,
            dvf_2025_s1_typed.code_departement,
            dvf_2025_s1_typed.code_commune,
            dvf_2025_s1_typed.commune,
            dvf_2025_s1_typed.code_postal,
            dvf_2025_s1_typed.type_local,
            dvf_2025_s1_typed.surface_reelle_bati,
            dvf_2025_s1_typed.surface_terrain,
            dvf_2025_s1_typed.nombre_pieces_principales,
            dvf_2025_s1_typed.nature_culture,
            dvf_2025_s1_typed.nature_culture_speciale
           FROM dvf_2025_s1_typed
        UNION ALL
         SELECT dvf_2025_s2_typed.identifiant_document,
            dvf_2025_s2_typed.reference_document,
            dvf_2025_s2_typed.date_mutation,
            dvf_2025_s2_typed.nature_mutation,
            dvf_2025_s2_typed.valeur_fonciere,
            dvf_2025_s2_typed.code_departement,
            dvf_2025_s2_typed.code_commune,
            dvf_2025_s2_typed.commune,
            dvf_2025_s2_typed.code_postal,
            dvf_2025_s2_typed.type_local,
            dvf_2025_s2_typed.surface_reelle_bati,
            dvf_2025_s2_typed.surface_terrain,
            dvf_2025_s2_typed.nombre_pieces_principales,
            dvf_2025_s2_typed.nature_culture,
            dvf_2025_s2_typed.nature_culture_speciale
           FROM dvf_2025_s2_typed) u;

-- market_price_evolution
CREATE OR REPLACE VIEW public.market_price_evolution AS
 SELECT l.canonical_key,
    l.zip_code,
    l.city,
    f.first_observed_at,
    f.first_price,
    l.last_observed_at,
    l.last_price,
    l.surface,
    l.price_m2,
    l.last_price - f.first_price AS price_change_abs,
        CASE
            WHEN f.first_price > 0::numeric THEN round((l.last_price - f.first_price) / f.first_price * 100.0, 2)
            ELSE NULL::numeric
        END AS price_change_pct
   FROM market_price_last l
     JOIN market_price_first f ON l.canonical_key = f.canonical_key;

-- plu_engine_core_v2
CREATE OR REPLACE VIEW public.plu_engine_core_v2 AS
 SELECT c.commune_insee,
    c.zone_code,
    c.plu_version_label,
    c.source,
    c.voirie_min_m,
    c.fond_min_m,
    c.lateral_min_m,
    c.voirie_regle,
    c.fond_regle,
    c.lateral_regle,
    c.implantation_en_limite_autorisee,
    c.hauteur_max_m,
    c.hauteur_min_m,
    c.hauteur_mode_calcul,
    c.emprise_max_ratio,
    c.emprise_sol_max,
    s.places_par_logement,
    s.places_par_100m2_sdp,
    s.places_min_total,
    s.visiteurs_par_logement,
    s.velos_par_logement,
    s.stationnement_note,
    s.stationnement_commentaire
   FROM plu_engine_core_v1 c
     LEFT JOIN plu_engine_stationnement_resolved_v1 s USING (commune_insee, zone_code, plu_version_label, source);

-- plu_rulesets_resolved_canon_v2
CREATE OR REPLACE VIEW public.plu_rulesets_resolved_canon_v2 AS
 SELECT r.commune_insee,
    r.commune_nom,
    r.zone_code,
    r.zone_libelle,
    r.plu_version_label,
    r.source_type,
    r.universal_source_document,
    r.source,
    jsonb_set(c.ruleset_canon, '{reculs_v2}'::text[], COALESCE(r.ruleset -> 'reculs'::text, jsonb_build_object('voirie', jsonb_build_object('regle', NULL::unknown, 'min_m', NULL::unknown, 'note', NULL::unknown), 'fond_parcelle', jsonb_build_object('regle', NULL::unknown, 'min_m', NULL::unknown, 'note', NULL::unknown), 'limites_separatives', jsonb_build_object('regle', NULL::unknown, 'min_m', NULL::unknown, 'note', NULL::unknown), 'implantation_en_limite', jsonb_build_object('autorisee', NULL::unknown, 'note', NULL::unknown), 'facades', jsonb_build_object('voirie', jsonb_build_object('regle', NULL::unknown, 'min_m', NULL::unknown, 'note', NULL::unknown), 'fond', jsonb_build_object('regle', NULL::unknown, 'min_m', NULL::unknown, 'note', NULL::unknown), 'laterales', jsonb_build_object('regle', NULL::unknown, 'min_m', NULL::unknown, 'note', NULL::unknown)), 'source_note', 'AUTO_CANON_V2')), true) AS ruleset_canon
   FROM plu_rulesets_resolved r
     JOIN plu_rulesets_resolved_canon_v1 c ON c.commune_insee = r.commune_insee AND c.zone_code = r.zone_code AND c.plu_version_label = r.plu_version_label AND c.source = r.source;

-- plu_rulesets_resolved_canon_v2_raw
CREATE OR REPLACE VIEW public.plu_rulesets_resolved_canon_v2_raw AS
 SELECT res.commune_insee,
    res.commune_nom,
    res.zone_code,
    res.zone_libelle,
    res.plu_version_label,
    res.source_type,
    res.source_url,
    res.source_page_range,
    res.universal_source_document,
    res.source,
    res.ruleset AS ruleset_raw,
    v2.ruleset_canon
   FROM plu_rulesets_resolved res
     JOIN plu_rulesets_resolved_canon_v2 v2 ON v2.commune_insee = res.commune_insee AND v2.zone_code = res.zone_code AND v2.plu_version_label = res.plu_version_label AND v2.source = res.source;

-- v_market_zone_insights
CREATE OR REPLACE VIEW public.v_market_zone_insights AS
 WITH base AS (
         SELECT ms.city,
            ms.zip_code,
            ms.active_unique_properties,
            ms.avg_price,
            ms.median_price,
            ms.avg_price_m2,
            ms.median_price_m2,
            ms.avg_listing_duplicates_per_property,
            mzs.stock_7d,
            mzs.stock_30d,
            mzs.new_properties_last_7d,
            mzs.new_properties_last_30d,
            mzs.price_drops_detected,
            mzs.avg_price_change_pct_7d,
            mzs.avg_price_change_pct_30d,
            mzs.stock_change_pct_7d,
            mzs.stock_change_pct_30d
           FROM v_market_stock_live ms
             LEFT JOIN v_market_zone_summary mzs ON mzs.city = ms.city AND mzs.zip_code = ms.zip_code
        )
 SELECT city,
    zip_code,
    active_unique_properties,
    stock_7d,
    stock_30d,
    new_properties_last_7d,
    new_properties_last_30d,
    price_drops_detected,
    avg_price,
    median_price,
    avg_price_m2,
    median_price_m2,
    avg_listing_duplicates_per_property,
    avg_price_change_pct_7d,
    avg_price_change_pct_30d,
    stock_change_pct_7d,
    stock_change_pct_30d,
        CASE
            WHEN COALESCE(new_properties_last_7d, 0::bigint) > 0 THEN ('+'::text || new_properties_last_7d::text) || ' nouveaux biens uniques estimés sur 7 jours'::text
            ELSE 'Pas de nouveau bien unique détecté sur 7 jours'::text
        END AS insight_new_supply_7d,
        CASE
            WHEN COALESCE(price_drops_detected, 0::bigint) > 0 THEN price_drops_detected::text || ' biens uniques ont baissé leur prix'::text
            ELSE 'Aucune baisse de prix unique détectée'::text
        END AS insight_price_drops,
        CASE
            WHEN stock_change_pct_7d IS NULL THEN 'Historique insuffisant pour mesurer l évolution du stock vendeur sur 7 jours'::text
            WHEN stock_change_pct_7d > 0::numeric THEN ('Stock vendeur en hausse de '::text || stock_change_pct_7d::text) || ' % sur 7 jours'::text
            WHEN stock_change_pct_7d < 0::numeric THEN ('Stock vendeur en baisse de '::text || abs(stock_change_pct_7d)::text) || ' % sur 7 jours'::text
            ELSE 'Stock vendeur stable sur 7 jours'::text
        END AS insight_stock_7d,
        CASE
            WHEN avg_price_change_pct_30d IS NULL THEN 'Historique insuffisant pour mesurer la variation prix sur 30 jours'::text
            WHEN avg_price_change_pct_30d > 0::numeric THEN ('Prix en hausse de '::text || avg_price_change_pct_30d::text) || ' % sur 30 jours'::text
            WHEN avg_price_change_pct_30d < 0::numeric THEN ('Prix en baisse de '::text || abs(avg_price_change_pct_30d)::text) || ' % sur 30 jours'::text
            ELSE 'Prix globalement stables sur 30 jours'::text
        END AS insight_price_trend_30d,
        CASE
            WHEN avg_listing_duplicates_per_property IS NULL THEN 'Niveau de duplication non disponible'::text
            WHEN avg_listing_duplicates_per_property >= 2::numeric THEN 'Forte multidiffusion des biens sur plusieurs sources'::text
            WHEN avg_listing_duplicates_per_property >= 1.2 THEN 'Duplication modérée des biens entre portails'::text
            ELSE 'Faible duplication détectée entre portails'::text
        END AS insight_duplication,
        CASE
            WHEN COALESCE(new_properties_last_7d, 0::bigint) > 0 AND COALESCE(price_drops_detected, 0::bigint) > 0 AND stock_change_pct_7d > 0::numeric THEN 'Le marché semble un peu plus fourni, avec de nouvelles entrées et plusieurs ajustements de prix vendeurs.'::text
            WHEN COALESCE(price_drops_detected, 0::bigint) > 0 THEN 'Le marché montre des ajustements vendeurs, avec plusieurs corrections de prix sur les biens suivis.'::text
            WHEN COALESCE(new_properties_last_7d, 0::bigint) > 0 THEN 'Le marché se renouvelle avec de nouvelles entrées récentes, sans correction de prix marquée à ce stade.'::text
            ELSE 'Le marché observé reste encore peu profond ou insuffisamment historique pour dégager une tendance forte.'::text
        END AS insight_summary
   FROM base;

-- v_market_zone_narratives_v2
CREATE OR REPLACE VIEW public.v_market_zone_narratives_v2 AS
 SELECT n.city,
    n.zip_code,
    n.market_narrative,
    p.avg_days_on_market,
    p.median_days_on_market,
    p.properties_with_price_drop,
    p.stale_properties,
    p.recent_properties,
    p.avg_total_price_change_pct,
    (((n.market_narrative || ' '::text) ||
        CASE
            WHEN p.avg_days_on_market IS NULL THEN 'Le recul est encore insuffisant pour qualifier la durée moyenne de commercialisation.'::text
            WHEN p.avg_days_on_market <= 14::numeric THEN 'Les biens suivis sont globalement récents sur le marché.'::text
            WHEN p.avg_days_on_market <= 60::numeric THEN 'La durée de commercialisation reste intermédiaire sur les biens suivis.'::text
            ELSE 'La durée de commercialisation apparaît longue, ce qui peut signaler une pression vendeurs plus marquée.'::text
        END) || ' '::text) ||
        CASE
            WHEN p.properties_with_price_drop = 0 THEN 'Les ajustements vendeurs restent limités à ce stade.'::text
            WHEN p.properties_with_price_drop = 1 THEN 'Un bien suivi a déjà enclenché une baisse de prix.'::text
            ELSE p.properties_with_price_drop::text || ' biens suivis ont déjà enclenché une baisse de prix.'::text
        END AS market_narrative_enriched
   FROM v_market_zone_narratives n
     LEFT JOIN v_market_zone_pressure p ON p.city = n.city AND p.zip_code = n.zip_code;

-- v_property_cluster_negotiation_leverage
CREATE OR REPLACE VIEW public.v_property_cluster_negotiation_leverage AS
 WITH base AS (
         SELECT s.property_cluster_id,
            s.city,
            s.zip_code,
            s.normalized_address,
            s.property_type,
            s.rooms,
            s.bedrooms,
            s.canonical_surface_m2,
            s.canonical_price,
            s.canonical_price_m2,
            s.days_on_market,
            s.price_drop_events,
            s.total_price_change_value,
            s.total_price_change_pct,
            s.total_negotiation_band_value,
            s.total_negotiation_band_pct,
            s.market_freshness_bucket,
            z.avg_listing_duplicates_per_property,
            z.active_unique_properties,
            z.price_drops_detected,
            z.stock_change_pct_7d
           FROM v_property_cluster_seller_trajectory s
             LEFT JOIN v_market_zone_summary_v2 z ON z.city = s.city AND z.zip_code = s.zip_code
        )
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    rooms,
    bedrooms,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    days_on_market,
    price_drop_events,
    total_price_change_value,
    total_price_change_pct,
    total_negotiation_band_value,
    total_negotiation_band_pct,
    market_freshness_bucket,
    avg_listing_duplicates_per_property,
    active_unique_properties,
    price_drops_detected,
    stock_change_pct_7d,
        CASE
            WHEN days_on_market IS NULL THEN 0
            WHEN days_on_market <= 14 THEN 5
            WHEN days_on_market <= 30 THEN 12
            WHEN days_on_market <= 60 THEN 20
            ELSE 30
        END +
        CASE
            WHEN COALESCE(price_drop_events, 0::bigint) = 0 THEN 0
            WHEN price_drop_events = 1 THEN 18
            WHEN price_drop_events = 2 THEN 28
            ELSE 36
        END +
        CASE
            WHEN total_price_change_pct IS NULL THEN 0
            WHEN total_price_change_pct > '-1'::integer::numeric THEN 4
            WHEN total_price_change_pct > '-3'::integer::numeric THEN 10
            WHEN total_price_change_pct > '-5'::integer::numeric THEN 16
            ELSE 22
        END +
        CASE
            WHEN avg_listing_duplicates_per_property IS NULL THEN 0
            WHEN avg_listing_duplicates_per_property < 1.2 THEN 2
            WHEN avg_listing_duplicates_per_property < 2::numeric THEN 6
            WHEN avg_listing_duplicates_per_property < 3::numeric THEN 10
            ELSE 14
        END +
        CASE
            WHEN stock_change_pct_7d IS NULL THEN 0
            WHEN stock_change_pct_7d <= 0::numeric THEN 0
            WHEN stock_change_pct_7d <= 5::numeric THEN 4
            WHEN stock_change_pct_7d <= 15::numeric THEN 8
            ELSE 12
        END AS negotiation_leverage_score_raw,
    LEAST(100,
        CASE
            WHEN days_on_market IS NULL THEN 0
            WHEN days_on_market <= 14 THEN 5
            WHEN days_on_market <= 30 THEN 12
            WHEN days_on_market <= 60 THEN 20
            ELSE 30
        END +
        CASE
            WHEN COALESCE(price_drop_events, 0::bigint) = 0 THEN 0
            WHEN price_drop_events = 1 THEN 18
            WHEN price_drop_events = 2 THEN 28
            ELSE 36
        END +
        CASE
            WHEN total_price_change_pct IS NULL THEN 0
            WHEN total_price_change_pct > '-1'::integer::numeric THEN 4
            WHEN total_price_change_pct > '-3'::integer::numeric THEN 10
            WHEN total_price_change_pct > '-5'::integer::numeric THEN 16
            ELSE 22
        END +
        CASE
            WHEN avg_listing_duplicates_per_property IS NULL THEN 0
            WHEN avg_listing_duplicates_per_property < 1.2 THEN 2
            WHEN avg_listing_duplicates_per_property < 2::numeric THEN 6
            WHEN avg_listing_duplicates_per_property < 3::numeric THEN 10
            ELSE 14
        END +
        CASE
            WHEN stock_change_pct_7d IS NULL THEN 0
            WHEN stock_change_pct_7d <= 0::numeric THEN 0
            WHEN stock_change_pct_7d <= 5::numeric THEN 4
            WHEN stock_change_pct_7d <= 15::numeric THEN 8
            ELSE 12
        END) AS negotiation_leverage_score,
        CASE
            WHEN LEAST(100,
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market <= 14 THEN 5
                WHEN days_on_market <= 30 THEN 12
                WHEN days_on_market <= 60 THEN 20
                ELSE 30
            END +
            CASE
                WHEN COALESCE(price_drop_events, 0::bigint) = 0 THEN 0
                WHEN price_drop_events = 1 THEN 18
                WHEN price_drop_events = 2 THEN 28
                ELSE 36
            END +
            CASE
                WHEN total_price_change_pct IS NULL THEN 0
                WHEN total_price_change_pct > '-1'::integer::numeric THEN 4
                WHEN total_price_change_pct > '-3'::integer::numeric THEN 10
                WHEN total_price_change_pct > '-5'::integer::numeric THEN 16
                ELSE 22
            END +
            CASE
                WHEN avg_listing_duplicates_per_property IS NULL THEN 0
                WHEN avg_listing_duplicates_per_property < 1.2 THEN 2
                WHEN avg_listing_duplicates_per_property < 2::numeric THEN 6
                WHEN avg_listing_duplicates_per_property < 3::numeric THEN 10
                ELSE 14
            END +
            CASE
                WHEN stock_change_pct_7d IS NULL THEN 0
                WHEN stock_change_pct_7d <= 0::numeric THEN 0
                WHEN stock_change_pct_7d <= 5::numeric THEN 4
                WHEN stock_change_pct_7d <= 15::numeric THEN 8
                ELSE 12
            END) >= 70 THEN 'high'::text
            WHEN LEAST(100,
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market <= 14 THEN 5
                WHEN days_on_market <= 30 THEN 12
                WHEN days_on_market <= 60 THEN 20
                ELSE 30
            END +
            CASE
                WHEN COALESCE(price_drop_events, 0::bigint) = 0 THEN 0
                WHEN price_drop_events = 1 THEN 18
                WHEN price_drop_events = 2 THEN 28
                ELSE 36
            END +
            CASE
                WHEN total_price_change_pct IS NULL THEN 0
                WHEN total_price_change_pct > '-1'::integer::numeric THEN 4
                WHEN total_price_change_pct > '-3'::integer::numeric THEN 10
                WHEN total_price_change_pct > '-5'::integer::numeric THEN 16
                ELSE 22
            END +
            CASE
                WHEN avg_listing_duplicates_per_property IS NULL THEN 0
                WHEN avg_listing_duplicates_per_property < 1.2 THEN 2
                WHEN avg_listing_duplicates_per_property < 2::numeric THEN 6
                WHEN avg_listing_duplicates_per_property < 3::numeric THEN 10
                ELSE 14
            END +
            CASE
                WHEN stock_change_pct_7d IS NULL THEN 0
                WHEN stock_change_pct_7d <= 0::numeric THEN 0
                WHEN stock_change_pct_7d <= 5::numeric THEN 4
                WHEN stock_change_pct_7d <= 15::numeric THEN 8
                ELSE 12
            END) >= 40 THEN 'medium'::text
            ELSE 'low'::text
        END AS negotiation_leverage_bucket
   FROM base b;

-- v_property_daily_scores_source
CREATE OR REPLACE VIEW public.v_property_daily_scores_source AS
 SELECT m.property_cluster_id,
    CURRENT_DATE AS observed_date,
    o.opportunity_score,
    o.opportunity_bucket,
    m.negotiation_leverage_score,
    m.negotiation_leverage_bucket,
    m.recommendation_confidence_score,
    m.recommendation_confidence_bucket,
    m.market_position_bucket,
    m.price_m2_gap_vs_market_pct,
    m.price_gap_vs_market_value,
    m.canonical_price,
    m.canonical_price_m2,
    m.price_drop_events,
    m.days_on_market,
    m.memo_decision_bucket
   FROM v_property_investment_memo m
     LEFT JOIN v_property_opportunity_score o ON o.property_cluster_id = m.property_cluster_id
  WHERE m.is_active = true;

-- v_property_opportunity_score
CREATE OR REPLACE VIEW public.v_property_opportunity_score AS
 WITH base AS (
         SELECT m.property_cluster_id,
            m.city,
            m.zip_code,
            m.normalized_address,
            m.property_type,
            m.canonical_surface_m2,
            m.canonical_price,
            m.canonical_price_m2,
            m.market_position_bucket,
            m.price_m2_gap_vs_market_pct,
            m.price_gap_vs_market_value,
            m.negotiation_leverage_score,
            m.negotiation_leverage_bucket,
            m.recommendation_confidence_score,
            m.recommendation_confidence_bucket,
            m.price_drop_events,
            m.days_on_market,
            m.market_freshness_bucket,
            m.memo_decision_bucket,
            z.avg_listing_duplicates_per_property
           FROM v_property_investment_memo m
             LEFT JOIN v_market_zone_summary_v2 z ON z.city = m.city AND z.zip_code = m.zip_code
          WHERE m.is_active = true
        )
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    property_type,
    canonical_surface_m2,
    canonical_price,
    canonical_price_m2,
    market_position_bucket,
    price_m2_gap_vs_market_pct,
    price_gap_vs_market_value,
    negotiation_leverage_score,
    negotiation_leverage_bucket,
    recommendation_confidence_score,
    recommendation_confidence_bucket,
    price_drop_events,
    days_on_market,
    market_freshness_bucket,
    memo_decision_bucket,
    avg_listing_duplicates_per_property,
    LEAST(100, GREATEST(0,
        CASE
            WHEN market_position_bucket = 'under_market'::text THEN 35
            WHEN market_position_bucket = 'in_market'::text THEN 20
            WHEN market_position_bucket = 'over_market'::text THEN 5
            ELSE 10
        END +
        CASE
            WHEN negotiation_leverage_score IS NULL THEN 0
            WHEN negotiation_leverage_score >= 70 THEN 25
            WHEN negotiation_leverage_score >= 40 THEN 16
            WHEN negotiation_leverage_score >= 20 THEN 8
            ELSE 3
        END +
        CASE
            WHEN recommendation_confidence_score IS NULL THEN 0
            WHEN recommendation_confidence_score >= 75 THEN 20
            WHEN recommendation_confidence_score >= 50 THEN 12
            WHEN recommendation_confidence_score >= 30 THEN 6
            ELSE 2
        END +
        CASE
            WHEN COALESCE(price_drop_events, 0::bigint) >= 2 THEN 10
            WHEN COALESCE(price_drop_events, 0::bigint) = 1 THEN 6
            ELSE 0
        END +
        CASE
            WHEN days_on_market IS NULL THEN 0
            WHEN days_on_market >= 60 THEN 10
            WHEN days_on_market >= 30 THEN 7
            WHEN days_on_market >= 14 THEN 4
            ELSE 1
        END)) AS opportunity_score,
        CASE
            WHEN LEAST(100, GREATEST(0,
            CASE
                WHEN market_position_bucket = 'under_market'::text THEN 35
                WHEN market_position_bucket = 'in_market'::text THEN 20
                WHEN market_position_bucket = 'over_market'::text THEN 5
                ELSE 10
            END +
            CASE
                WHEN negotiation_leverage_score IS NULL THEN 0
                WHEN negotiation_leverage_score >= 70 THEN 25
                WHEN negotiation_leverage_score >= 40 THEN 16
                WHEN negotiation_leverage_score >= 20 THEN 8
                ELSE 3
            END +
            CASE
                WHEN recommendation_confidence_score IS NULL THEN 0
                WHEN recommendation_confidence_score >= 75 THEN 20
                WHEN recommendation_confidence_score >= 50 THEN 12
                WHEN recommendation_confidence_score >= 30 THEN 6
                ELSE 2
            END +
            CASE
                WHEN COALESCE(price_drop_events, 0::bigint) >= 2 THEN 10
                WHEN COALESCE(price_drop_events, 0::bigint) = 1 THEN 6
                ELSE 0
            END +
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market >= 60 THEN 10
                WHEN days_on_market >= 30 THEN 7
                WHEN days_on_market >= 14 THEN 4
                ELSE 1
            END)) >= 75 THEN 'top_opportunity'::text
            WHEN LEAST(100, GREATEST(0,
            CASE
                WHEN market_position_bucket = 'under_market'::text THEN 35
                WHEN market_position_bucket = 'in_market'::text THEN 20
                WHEN market_position_bucket = 'over_market'::text THEN 5
                ELSE 10
            END +
            CASE
                WHEN negotiation_leverage_score IS NULL THEN 0
                WHEN negotiation_leverage_score >= 70 THEN 25
                WHEN negotiation_leverage_score >= 40 THEN 16
                WHEN negotiation_leverage_score >= 20 THEN 8
                ELSE 3
            END +
            CASE
                WHEN recommendation_confidence_score IS NULL THEN 0
                WHEN recommendation_confidence_score >= 75 THEN 20
                WHEN recommendation_confidence_score >= 50 THEN 12
                WHEN recommendation_confidence_score >= 30 THEN 6
                ELSE 2
            END +
            CASE
                WHEN COALESCE(price_drop_events, 0::bigint) >= 2 THEN 10
                WHEN COALESCE(price_drop_events, 0::bigint) = 1 THEN 6
                ELSE 0
            END +
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market >= 60 THEN 10
                WHEN days_on_market >= 30 THEN 7
                WHEN days_on_market >= 14 THEN 4
                ELSE 1
            END)) >= 55 THEN 'interesting'::text
            WHEN LEAST(100, GREATEST(0,
            CASE
                WHEN market_position_bucket = 'under_market'::text THEN 35
                WHEN market_position_bucket = 'in_market'::text THEN 20
                WHEN market_position_bucket = 'over_market'::text THEN 5
                ELSE 10
            END +
            CASE
                WHEN negotiation_leverage_score IS NULL THEN 0
                WHEN negotiation_leverage_score >= 70 THEN 25
                WHEN negotiation_leverage_score >= 40 THEN 16
                WHEN negotiation_leverage_score >= 20 THEN 8
                ELSE 3
            END +
            CASE
                WHEN recommendation_confidence_score IS NULL THEN 0
                WHEN recommendation_confidence_score >= 75 THEN 20
                WHEN recommendation_confidence_score >= 50 THEN 12
                WHEN recommendation_confidence_score >= 30 THEN 6
                ELSE 2
            END +
            CASE
                WHEN COALESCE(price_drop_events, 0::bigint) >= 2 THEN 10
                WHEN COALESCE(price_drop_events, 0::bigint) = 1 THEN 6
                ELSE 0
            END +
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market >= 60 THEN 10
                WHEN days_on_market >= 30 THEN 7
                WHEN days_on_market >= 14 THEN 4
                ELSE 1
            END)) >= 35 THEN 'watchlist'::text
            ELSE 'low_priority'::text
        END AS opportunity_bucket
   FROM base b;

-- v_user_watchlist_candidates
CREATE OR REPLACE VIEW public.v_user_watchlist_candidates AS
 SELECT w.id AS watchlist_id,
    w.user_id,
    w.name AS watchlist_name,
    o.property_cluster_id,
    o.city,
    o.zip_code,
    o.normalized_address,
    o.property_type,
    o.canonical_surface_m2,
    o.canonical_price,
    o.canonical_price_m2,
    o.opportunity_score,
    o.opportunity_bucket,
    m.recommendation_confidence_score,
    m.recommendation_confidence_bucket,
    m.memo_decision_bucket
   FROM user_watchlists w
     JOIN v_property_opportunity_score o ON 1 = 1
     JOIN v_property_investment_memo m ON m.property_cluster_id = o.property_cluster_id
  WHERE w.is_active = true AND m.is_active = true AND (w.city IS NULL OR o.city = w.city) AND (w.zip_code IS NULL OR o.zip_code = w.zip_code) AND (w.property_type IS NULL OR o.property_type = w.property_type) AND (w.min_price IS NULL OR o.canonical_price >= w.min_price) AND (w.max_price IS NULL OR o.canonical_price <= w.max_price) AND (w.min_surface_m2 IS NULL OR o.canonical_surface_m2 >= w.min_surface_m2) AND (w.max_surface_m2 IS NULL OR o.canonical_surface_m2 <= w.max_surface_m2) AND (w.min_opportunity_score IS NULL OR o.opportunity_score >= w.min_opportunity_score) AND (w.min_confidence_score IS NULL OR m.recommendation_confidence_score >= w.min_confidence_score);

-- v_watchlist_digest_summary
CREATE OR REPLACE VIEW public.v_watchlist_digest_summary AS
 WITH recent_alerts AS (
         SELECT a.watchlist_id,
            count(*) AS alerts_last_7d,
            count(*) FILTER (WHERE a.alert_type = 'new_property_tracked'::text) AS new_properties_last_7d,
            count(*) FILTER (WHERE a.alert_type = 'price_drop'::text) AS price_drops_last_7d,
            count(*) FILTER (WHERE a.alert_type = 'opportunity_upgraded'::text) AS upgraded_last_7d,
            count(*) FILTER (WHERE a.alert_type = 'score_jump'::text) AS score_jumps_last_7d
           FROM v_watchlist_alert_cards a
          WHERE a.observed_date >= (CURRENT_DATE - 7)
          GROUP BY a.watchlist_id
        ), active_props AS (
         SELECT wm.watchlist_id,
            count(*) FILTER (WHERE wm.is_active = true) AS active_properties
           FROM user_watchlist_matches wm
          GROUP BY wm.watchlist_id
        ), best_scores AS (
         SELECT c.watchlist_id,
            round(avg(c.opportunity_score), 1) AS avg_opportunity_score,
            max(c.opportunity_score) AS best_opportunity_score
           FROM v_user_watchlist_candidates c
          GROUP BY c.watchlist_id
        )
 SELECT w.id AS watchlist_id,
    w.user_id,
    w.name AS watchlist_name,
    w.city,
    w.zip_code,
    w.property_type,
    COALESCE(ap.active_properties, 0::bigint) AS active_properties,
    COALESCE(ra.alerts_last_7d, 0::bigint) AS alerts_last_7d,
    COALESCE(ra.new_properties_last_7d, 0::bigint) AS new_properties_last_7d,
    COALESCE(ra.price_drops_last_7d, 0::bigint) AS price_drops_last_7d,
    COALESCE(ra.upgraded_last_7d, 0::bigint) AS upgraded_last_7d,
    COALESCE(ra.score_jumps_last_7d, 0::bigint) AS score_jumps_last_7d,
    COALESCE(bs.avg_opportunity_score, 0::numeric) AS avg_opportunity_score,
    COALESCE(bs.best_opportunity_score, 0) AS best_opportunity_score
   FROM user_watchlists w
     LEFT JOIN recent_alerts ra ON ra.watchlist_id = w.id
     LEFT JOIN active_props ap ON ap.watchlist_id = w.id
     LEFT JOIN best_scores bs ON bs.watchlist_id = w.id
  WHERE w.is_active = true;

-- v_watchlist_summary
CREATE OR REPLACE VIEW public.v_watchlist_summary AS
 WITH active_matches AS (
         SELECT wm.watchlist_id,
            count(*) FILTER (WHERE wm.is_active = true) AS active_properties
           FROM user_watchlist_matches wm
          GROUP BY wm.watchlist_id
        ), recent_alerts AS (
         SELECT a.watchlist_id,
            count(*) FILTER (WHERE a.observed_date >= (CURRENT_DATE - 7)) AS alerts_last_7d,
            count(*) FILTER (WHERE a.observed_date >= (CURRENT_DATE - 7) AND a.alert_type = 'new_property_tracked'::text) AS new_properties_last_7d,
            count(*) FILTER (WHERE a.observed_date >= (CURRENT_DATE - 7) AND a.alert_type = 'price_drop'::text) AS price_drops_last_7d
           FROM v_watchlist_alert_cards a
          GROUP BY a.watchlist_id
        ), opportunity_stats AS (
         SELECT c.watchlist_id,
            round(avg(c.opportunity_score), 1) AS avg_opportunity_score,
            max(c.opportunity_score) AS best_opportunity_score,
            count(*) FILTER (WHERE c.opportunity_bucket = ANY (ARRAY['interesting'::text, 'top_opportunity'::text])) AS interesting_or_better_count,
            count(*) FILTER (WHERE c.opportunity_bucket = 'watchlist'::text) AS watchlist_count
           FROM v_user_watchlist_candidates c
          GROUP BY c.watchlist_id
        )
 SELECT w.id AS watchlist_id,
    w.user_id,
    w.name AS watchlist_name,
    w.city,
    w.zip_code,
    w.property_type,
    w.min_price,
    w.max_price,
    w.min_surface_m2,
    w.max_surface_m2,
    w.min_opportunity_score,
    w.min_confidence_score,
    w.is_active,
    COALESCE(am.active_properties, 0::bigint) AS active_properties,
    COALESCE(ra.alerts_last_7d, 0::bigint) AS alerts_last_7d,
    COALESCE(ra.new_properties_last_7d, 0::bigint) AS new_properties_last_7d,
    COALESCE(ra.price_drops_last_7d, 0::bigint) AS price_drops_last_7d,
    COALESCE(os.avg_opportunity_score, 0::numeric) AS avg_opportunity_score,
    COALESCE(os.best_opportunity_score, 0) AS best_opportunity_score,
    COALESCE(os.interesting_or_better_count, 0::bigint) AS interesting_or_better_count,
    COALESCE(os.watchlist_count, 0::bigint) AS watchlist_count
   FROM user_watchlists w
     LEFT JOIN active_matches am ON am.watchlist_id = w.id
     LEFT JOIN recent_alerts ra ON ra.watchlist_id = w.id
     LEFT JOIN opportunity_stats os ON os.watchlist_id = w.id;

-- v_watchlist_top_opportunity_cards
CREATE OR REPLACE VIEW public.v_watchlist_top_opportunity_cards AS
 SELECT t.watchlist_id,
    t.user_id,
    t.watchlist_name,
    t.watchlist_rank,
    t.property_cluster_id,
    t.city,
    t.zip_code,
    t.normalized_address,
    t.property_type,
    t.canonical_surface_m2,
    t.canonical_price,
    t.canonical_price_m2,
    t.opportunity_score,
    t.opportunity_bucket,
    m.market_position_label,
    m.leverage_label,
    m.confidence_label,
    m.memo_decision_bucket,
    m.memo_decision_comment,
    m.anchor_offer_price,
    m.realistic_offer_price
   FROM v_watchlist_top_opportunities t
     JOIN v_property_investment_memo_ui m ON m.property_cluster_id = t.property_cluster_id;

-- v_zone_opportunity_cards
CREATE OR REPLACE VIEW public.v_zone_opportunity_cards AS
 SELECT r.property_cluster_id,
    r.city,
    r.zip_code,
    r.normalized_address,
    r.property_type,
    r.canonical_surface_m2,
    r.canonical_price,
    r.canonical_price_m2,
    r.opportunity_score,
    r.opportunity_bucket,
    r.zone_rank,
    m.market_position_label,
    m.leverage_label,
    m.confidence_label,
    m.acquisition_summary,
    m.memo_decision_bucket,
    m.memo_decision_comment,
    m.anchor_offer_price,
    m.realistic_offer_price
   FROM v_zone_opportunity_ranking r
     JOIN v_property_investment_memo_ui m ON m.property_cluster_id = r.property_cluster_id;

-- v_zone_opportunity_cards_v2
CREATE OR REPLACE VIEW public.v_zone_opportunity_cards_v2 AS
 SELECT c.property_cluster_id,
    c.city,
    c.zip_code,
    c.zone_rank,
    c.normalized_address,
    c.property_type,
    c.canonical_surface_m2,
    c.canonical_price,
    c.canonical_price_m2,
    c.opportunity_score,
    c.opportunity_bucket,
    c.memo_decision_bucket,
    c.anchor_offer_price,
    c.realistic_offer_price,
    c.market_position_label,
    c.leverage_label,
    c.confidence_label,
    c.acquisition_summary,
    c.memo_decision_comment,
    r.opportunity_reason_tags
   FROM v_zone_opportunity_cards c
     LEFT JOIN v_property_opportunity_reasons r ON r.property_cluster_id = c.property_cluster_id;

-- v_market_zone_summary_v2
CREATE OR REPLACE VIEW public.v_market_zone_summary_v2 AS
 WITH latest_stock AS (
         SELECT v_active_property_clusters.city,
            v_active_property_clusters.zip_code,
            count(*) AS active_unique_properties,
            avg(v_active_property_clusters.canonical_price) AS avg_price,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (v_active_property_clusters.canonical_price::double precision)) AS median_price,
            avg(v_active_property_clusters.canonical_price_m2) AS avg_price_m2,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (v_active_property_clusters.canonical_price_m2::double precision)) AS median_price_m2,
            avg(v_active_property_clusters.active_listing_count) AS avg_listing_duplicates_per_property
           FROM v_active_property_clusters
          GROUP BY v_active_property_clusters.city, v_active_property_clusters.zip_code
        ), new_last_7d AS (
         SELECT c.city,
            c.zip_code,
            count(*) AS new_properties_last_7d
           FROM property_clusters c
          WHERE c.first_seen_at >= (now() - '7 days'::interval) AND c.is_active = true
          GROUP BY c.city, c.zip_code
        ), new_last_30d AS (
         SELECT c.city,
            c.zip_code,
            count(*) AS new_properties_last_30d
           FROM property_clusters c
          WHERE c.first_seen_at >= (now() - '30 days'::interval) AND c.is_active = true
          GROUP BY c.city, c.zip_code
        ), recent_price_drops AS (
         SELECT m.city,
            m.zip_code,
            count(DISTINCT m.property_cluster_id) AS price_drops_detected_recent
           FROM v_property_price_movements m
          WHERE m.is_price_drop = true AND m.observed_date >= (CURRENT_DATE - 7)
          GROUP BY m.city, m.zip_code
        ), stock_7d AS (
         SELECT property_clusters.city,
            property_clusters.zip_code,
            count(*) AS stock_7d
           FROM property_clusters
          WHERE property_clusters.first_seen_at <= (now() - '7 days'::interval) AND property_clusters.is_active = true
          GROUP BY property_clusters.city, property_clusters.zip_code
        ), stock_30d AS (
         SELECT property_clusters.city,
            property_clusters.zip_code,
            count(*) AS stock_30d
           FROM property_clusters
          WHERE property_clusters.first_seen_at <= (now() - '30 days'::interval) AND property_clusters.is_active = true
          GROUP BY property_clusters.city, property_clusters.zip_code
        ), price_trend_30d AS (
         SELECT t.city,
            t.zip_code,
            avg(t.price_change_pct_30d) AS avg_price_change_pct_30d
           FROM v_property_price_trends t
          GROUP BY t.city, t.zip_code
        )
 SELECT ls.city,
    ls.zip_code,
    ls.active_unique_properties,
    COALESCE(s7.stock_7d, 0::bigint) AS stock_7d,
    COALESCE(s30.stock_30d, 0::bigint) AS stock_30d,
    COALESCE(n7.new_properties_last_7d, 0::bigint) AS new_properties_last_7d,
    COALESCE(n30.new_properties_last_30d, 0::bigint) AS new_properties_last_30d,
    COALESCE(rpd.price_drops_detected_recent, 0::bigint) AS price_drops_detected,
    round(ls.avg_price, 0) AS avg_price,
    round(ls.median_price::numeric, 0) AS median_price,
    round(ls.avg_price_m2, 0) AS avg_price_m2,
    round(ls.median_price_m2::numeric, 0) AS median_price_m2,
    round(ls.avg_listing_duplicates_per_property, 2) AS avg_listing_duplicates_per_property,
    round(pt30.avg_price_change_pct_30d, 2) AS avg_price_change_pct_30d,
        CASE
            WHEN COALESCE(s7.stock_7d, 0::bigint) = 0 THEN NULL::numeric
            ELSE round((ls.active_unique_properties - s7.stock_7d)::numeric / s7.stock_7d::numeric * 100::numeric, 2)
        END AS stock_change_pct_7d,
        CASE
            WHEN COALESCE(s30.stock_30d, 0::bigint) = 0 THEN NULL::numeric
            ELSE round((ls.active_unique_properties - s30.stock_30d)::numeric / s30.stock_30d::numeric * 100::numeric, 2)
        END AS stock_change_pct_30d
   FROM latest_stock ls
     LEFT JOIN stock_7d s7 ON s7.city = ls.city AND s7.zip_code = ls.zip_code
     LEFT JOIN stock_30d s30 ON s30.city = ls.city AND s30.zip_code = ls.zip_code
     LEFT JOIN new_last_7d n7 ON n7.city = ls.city AND n7.zip_code = ls.zip_code
     LEFT JOIN new_last_30d n30 ON n30.city = ls.city AND n30.zip_code = ls.zip_code
     LEFT JOIN recent_price_drops rpd ON rpd.city = ls.city AND rpd.zip_code = ls.zip_code
     LEFT JOIN price_trend_30d pt30 ON pt30.city = ls.city AND pt30.zip_code = ls.zip_code;

-- v_property_cluster_acquisition_signal
CREATE OR REPLACE VIEW public.v_property_cluster_acquisition_signal AS
 SELECT n.property_cluster_id,
    n.city,
    n.zip_code,
    n.normalized_address,
    n.canonical_price,
    n.negotiation_leverage_score,
    n.negotiation_leverage_bucket,
    n.leverage_label,
    g.market_position_bucket,
    g.market_position_label,
    g.price_m2_gap_vs_market_pct,
    g.price_gap_vs_market_value,
    g.market_confidence_score,
    o.anchor_offer_price,
    o.realistic_offer_price,
    o.offer_strategy_note,
        CASE
            WHEN g.market_position_bucket = 'over_market'::text AND (n.negotiation_leverage_bucket = ANY (ARRAY['medium'::text, 'high'::text])) THEN 'good_opportunity'::text
            WHEN g.market_position_bucket = 'in_market'::text AND n.negotiation_leverage_bucket = 'high'::text THEN 'good_opportunity'::text
            WHEN g.market_position_bucket = 'under_market'::text THEN 'strong_position'::text
            WHEN g.market_position_bucket = 'in_market'::text AND n.negotiation_leverage_bucket = 'medium'::text THEN 'balanced'::text
            ELSE 'cautious'::text
        END AS acquisition_signal_bucket,
        CASE
            WHEN g.market_position_bucket = 'over_market'::text AND (n.negotiation_leverage_bucket = ANY (ARRAY['medium'::text, 'high'::text])) THEN 'Bien au-dessus du marché, mais avec des signaux vendeurs exploitables : négociation à tenter avec discipline.'::text
            WHEN g.market_position_bucket = 'in_market'::text AND n.negotiation_leverage_bucket = 'high'::text THEN 'Bien globalement au marché, avec levier vendeur élevé : fenêtre intéressante pour une offre structurée.'::text
            WHEN g.market_position_bucket = 'under_market'::text THEN 'Bien déjà compétitif par rapport au marché local : attention à la vitesse d exécution si le dossier est sain.'::text
            WHEN g.market_position_bucket = 'in_market'::text AND n.negotiation_leverage_bucket = 'medium'::text THEN 'Bien plutôt cohérent avec le marché ; négociation possible, mais probablement modérée.'::text
            ELSE 'Contexte d acquisition à lire avec prudence : le couple prix/levier ne crée pas encore un avantage net.'::text
        END AS acquisition_summary
   FROM v_property_cluster_negotiation_signals n
     LEFT JOIN v_property_cluster_market_gap_signals g ON g.property_cluster_id = n.property_cluster_id
     LEFT JOIN v_property_cluster_offer_guidance o ON o.property_cluster_id = n.property_cluster_id;

-- v_user_watchlists_home_dashboard
CREATE OR REPLACE VIEW public.v_user_watchlists_home_dashboard AS
 WITH watchlists AS (
         SELECT v_watchlist_digest_summary.watchlist_id,
            v_watchlist_digest_summary.user_id,
            v_watchlist_digest_summary.watchlist_name,
            v_watchlist_digest_summary.city,
            v_watchlist_digest_summary.zip_code,
            v_watchlist_digest_summary.property_type,
            v_watchlist_digest_summary.active_properties,
            v_watchlist_digest_summary.alerts_last_7d,
            v_watchlist_digest_summary.new_properties_last_7d,
            v_watchlist_digest_summary.price_drops_last_7d,
            v_watchlist_digest_summary.upgraded_last_7d,
            v_watchlist_digest_summary.score_jumps_last_7d,
            v_watchlist_digest_summary.avg_opportunity_score,
            v_watchlist_digest_summary.best_opportunity_score
           FROM v_watchlist_digest_summary
        ), best_global_opportunity AS (
         SELECT DISTINCT ON (w_1.user_id) w_1.user_id,
            t.watchlist_id,
            t.watchlist_name,
            t.property_cluster_id,
            t.city,
            t.zip_code,
            t.normalized_address,
            t.opportunity_score,
            t.opportunity_bucket
           FROM v_watchlist_digest_top3 t
             JOIN user_watchlists w_1 ON w_1.id = t.watchlist_id
          ORDER BY w_1.user_id, t.opportunity_score DESC, t.watchlist_rank
        ), latest_alert AS (
         SELECT DISTINCT ON (a.user_id) a.user_id,
            a.watchlist_id,
            a.watchlist_name,
            a.property_cluster_id,
            a.city,
            a.zip_code,
            a.normalized_address,
            a.observed_date,
            a.alert_type,
            a.alert_label,
            a.alert_message
           FROM v_watchlist_alert_cards a
          ORDER BY a.user_id, a.observed_date DESC, a.normalized_address
        ), watchlists_json AS (
         SELECT w_1.user_id,
            jsonb_agg(jsonb_build_object('watchlist_id', w_1.watchlist_id, 'watchlist_name', w_1.watchlist_name, 'city', w_1.city, 'zip_code', w_1.zip_code, 'property_type', w_1.property_type, 'active_properties', w_1.active_properties, 'alerts_last_7d', w_1.alerts_last_7d, 'new_properties_last_7d', w_1.new_properties_last_7d, 'price_drops_last_7d', w_1.price_drops_last_7d, 'avg_opportunity_score', w_1.avg_opportunity_score, 'best_opportunity_score', w_1.best_opportunity_score) ORDER BY w_1.watchlist_name) AS watchlists_payload
           FROM watchlists w_1
          GROUP BY w_1.user_id
        )
 SELECT w.user_id,
    count(*) AS active_watchlists,
    COALESCE(sum(w.active_properties), 0::numeric) AS total_active_properties,
    COALESCE(sum(w.alerts_last_7d), 0::numeric) AS total_alerts_last_7d,
    COALESCE(sum(w.new_properties_last_7d), 0::numeric) AS total_new_properties_last_7d,
    COALESCE(sum(w.price_drops_last_7d), 0::numeric) AS total_price_drops_last_7d,
    b.watchlist_id AS best_watchlist_id,
    b.watchlist_name AS best_watchlist_name,
    b.property_cluster_id AS best_property_cluster_id,
    b.city AS best_city,
    b.zip_code AS best_zip_code,
    b.normalized_address AS best_normalized_address,
    b.opportunity_score AS best_opportunity_score,
    b.opportunity_bucket AS best_opportunity_bucket,
    l.watchlist_id AS latest_alert_watchlist_id,
    l.watchlist_name AS latest_alert_watchlist_name,
    l.property_cluster_id AS latest_alert_property_cluster_id,
    l.city AS latest_alert_city,
    l.zip_code AS latest_alert_zip_code,
    l.normalized_address AS latest_alert_normalized_address,
    l.observed_date AS latest_alert_observed_date,
    l.alert_type AS latest_alert_type,
    l.alert_label AS latest_alert_label,
    l.alert_message AS latest_alert_message,
    COALESCE(j.watchlists_payload, '[]'::jsonb) AS watchlists_payload
   FROM watchlists w
     LEFT JOIN best_global_opportunity b ON b.user_id = w.user_id
     LEFT JOIN latest_alert l ON l.user_id = w.user_id
     LEFT JOIN watchlists_json j ON j.user_id = w.user_id
  GROUP BY w.user_id, b.watchlist_id, b.watchlist_name, b.property_cluster_id, b.city, b.zip_code, b.normalized_address, b.opportunity_score, b.opportunity_bucket, l.watchlist_id, l.watchlist_name, l.property_cluster_id, l.city, l.zip_code, l.normalized_address, l.observed_date, l.alert_type, l.alert_label, l.alert_message, j.watchlists_payload;

-- market_opportunities_v1
CREATE OR REPLACE VIEW public.market_opportunities_v1 AS
 WITH base AS (
         SELECT lc.canonical_key,
            lc.zip_code,
            lc.city,
            lc.price,
            lc.surface,
            lc.price_m2,
            lc.listing_count,
            lc.portal_count,
            lc.portals,
            lc.portal_listing_ids,
            lc.urls,
            lc.first_seen_at,
            lc.last_seen_at,
            lc.dedupe_confidence,
            COALESCE(pe.price_change_abs, 0::numeric) AS price_change_abs,
            COALESCE(pe.price_change_pct, 0::numeric) AS price_change_pct,
            COALESCE(pcc.price_change_count, 0::bigint) AS price_change_count,
            COALESCE(pcc.price_drop_count, 0::bigint) AS price_drop_count,
            COALESCE(age.days_on_market, 0::numeric) AS days_on_market,
            ref.market_avg_price_m2,
            ref.market_median_price_m2,
            ref.sample_size
           FROM listings_canonical lc
             LEFT JOIN market_price_evolution pe ON lc.canonical_key = pe.canonical_key
             LEFT JOIN market_price_change_counts pcc ON lc.canonical_key = pcc.canonical_key
             LEFT JOIN market_listing_age age ON lc.canonical_key = age.canonical_key
             LEFT JOIN market_reference_local ref ON lc.zip_code = ref.zip_code AND lc.city = ref.city
        ), scored AS (
         SELECT base.canonical_key,
            base.zip_code,
            base.city,
            base.price,
            base.surface,
            base.price_m2,
            base.listing_count,
            base.portal_count,
            base.portals,
            base.portal_listing_ids,
            base.urls,
            base.first_seen_at,
            base.last_seen_at,
            base.dedupe_confidence,
            base.price_change_abs,
            base.price_change_pct,
            base.price_change_count,
            base.price_drop_count,
            base.days_on_market,
            base.market_avg_price_m2,
            base.market_median_price_m2,
            base.sample_size,
                CASE
                    WHEN base.market_avg_price_m2 > 0::numeric AND base.price_m2 IS NOT NULL THEN round((base.market_avg_price_m2 - base.price_m2) / base.market_avg_price_m2 * 100.0, 2)
                    ELSE NULL::numeric
                END AS discount_vs_market_pct,
                CASE
                    WHEN base.price_drop_count > 0 THEN 1
                    ELSE 0
                END AS has_price_drop,
                CASE
                    WHEN base.portal_count > 1 THEN 1
                    ELSE 0
                END AS is_multi_portal,
                CASE
                    WHEN base.days_on_market >= 30::numeric THEN 1
                    ELSE 0
                END AS is_long_market,
                CASE
                    WHEN base.market_avg_price_m2 > 0::numeric AND base.price_m2 IS NOT NULL AND base.price_m2 < base.market_avg_price_m2 THEN 1
                    ELSE 0
                END AS is_below_market
           FROM base
        )
 SELECT canonical_key,
    zip_code,
    city,
    price,
    surface,
    price_m2,
    market_avg_price_m2,
    market_median_price_m2,
    sample_size,
    listing_count,
    portal_count,
    portals,
    portal_listing_ids,
    urls,
    first_seen_at,
    last_seen_at,
    dedupe_confidence,
    price_change_abs,
    price_change_pct,
    price_change_count,
    price_drop_count,
    round(days_on_market, 1) AS days_on_market,
    discount_vs_market_pct,
    has_price_drop,
    is_multi_portal,
    is_long_market,
    is_below_market,
    LEAST(100,
        CASE
            WHEN discount_vs_market_pct IS NULL THEN 0
            WHEN discount_vs_market_pct >= 15::numeric THEN 35
            WHEN discount_vs_market_pct >= 10::numeric THEN 28
            WHEN discount_vs_market_pct >= 5::numeric THEN 18
            WHEN discount_vs_market_pct > 0::numeric THEN 10
            ELSE 0
        END +
        CASE
            WHEN price_drop_count >= 2 THEN 25
            WHEN price_drop_count = 1 THEN 15
            ELSE 0
        END +
        CASE
            WHEN days_on_market >= 90::numeric THEN 20
            WHEN days_on_market >= 60::numeric THEN 15
            WHEN days_on_market >= 30::numeric THEN 8
            ELSE 0
        END +
        CASE
            WHEN portal_count >= 3 THEN 12
            WHEN portal_count = 2 THEN 8
            ELSE 0
        END) AS opportunity_score,
        CASE
            WHEN LEAST(100,
            CASE
                WHEN discount_vs_market_pct IS NULL THEN 0
                WHEN discount_vs_market_pct >= 15::numeric THEN 35
                WHEN discount_vs_market_pct >= 10::numeric THEN 28
                WHEN discount_vs_market_pct >= 5::numeric THEN 18
                WHEN discount_vs_market_pct > 0::numeric THEN 10
                ELSE 0
            END +
            CASE
                WHEN price_drop_count >= 2 THEN 25
                WHEN price_drop_count = 1 THEN 15
                ELSE 0
            END +
            CASE
                WHEN days_on_market >= 90::numeric THEN 20
                WHEN days_on_market >= 60::numeric THEN 15
                WHEN days_on_market >= 30::numeric THEN 8
                ELSE 0
            END +
            CASE
                WHEN portal_count >= 3 THEN 12
                WHEN portal_count = 2 THEN 8
                ELSE 0
            END) >= 70 THEN 'forte'::text
            WHEN LEAST(100,
            CASE
                WHEN discount_vs_market_pct IS NULL THEN 0
                WHEN discount_vs_market_pct >= 15::numeric THEN 35
                WHEN discount_vs_market_pct >= 10::numeric THEN 28
                WHEN discount_vs_market_pct >= 5::numeric THEN 18
                WHEN discount_vs_market_pct > 0::numeric THEN 10
                ELSE 0
            END +
            CASE
                WHEN price_drop_count >= 2 THEN 25
                WHEN price_drop_count = 1 THEN 15
                ELSE 0
            END +
            CASE
                WHEN days_on_market >= 90::numeric THEN 20
                WHEN days_on_market >= 60::numeric THEN 15
                WHEN days_on_market >= 30::numeric THEN 8
                ELSE 0
            END +
            CASE
                WHEN portal_count >= 3 THEN 12
                WHEN portal_count = 2 THEN 8
                ELSE 0
            END) >= 40 THEN 'moyenne'::text
            ELSE 'faible'::text
        END AS opportunity_bucket
   FROM scored;

-- plu_engine_core_v1
CREATE OR REPLACE VIEW public.plu_engine_core_v1 AS
 SELECT r.commune_insee,
    r.zone_code,
    r.plu_version_label,
    r.source,
    rr.voirie_min_m,
    rr.fond_min_m,
    rr.lateral_min_m,
    rr.voirie_regle,
    rr.fond_regle,
    rr.lateral_regle,
    rr.implantation_en_limite_autorisee,
    h.hauteur_max_m,
    h.hauteur_min_m,
    h.hauteur_mode_calcul,
    e.emprise_max_ratio,
    e.emprise_sol_max
   FROM plu_rulesets_resolved_canon_v2 r
     LEFT JOIN plu_engine_reculs_resolved_v1 rr USING (commune_insee, zone_code, plu_version_label, source)
     LEFT JOIN plu_engine_hauteur_resolved_v1 h USING (commune_insee, zone_code, plu_version_label, source)
     LEFT JOIN plu_engine_emprise_resolved_v1 e USING (commune_insee, zone_code, plu_version_label, source);

-- v_property_cluster_recommendation_confidence
CREATE OR REPLACE VIEW public.v_property_cluster_recommendation_confidence AS
 WITH base AS (
         SELECT a.property_cluster_id,
            a.city,
            a.zip_code,
            a.normalized_address,
            a.acquisition_signal_bucket,
            a.acquisition_summary,
            a.anchor_offer_price,
            a.realistic_offer_price,
            t.snapshot_days,
            t.days_on_market,
            t.price_drop_events,
            g.market_reference_date,
            g.market_sample_size,
            g.market_confidence_score,
            g.market_source,
            g.price_m2_gap_vs_market_pct,
            z.avg_listing_duplicates_per_property
           FROM v_property_cluster_acquisition_signal a
             LEFT JOIN v_property_cluster_seller_trajectory t ON t.property_cluster_id = a.property_cluster_id
             LEFT JOIN v_property_cluster_market_gap g ON g.property_cluster_id = a.property_cluster_id
             LEFT JOIN v_market_zone_summary_v2 z ON z.city = a.city AND z.zip_code = a.zip_code
        )
 SELECT property_cluster_id,
    city,
    zip_code,
    normalized_address,
    acquisition_signal_bucket,
    acquisition_summary,
    anchor_offer_price,
    realistic_offer_price,
    snapshot_days,
    days_on_market,
    price_drop_events,
    market_reference_date,
    market_sample_size,
    market_confidence_score,
    market_source,
    price_m2_gap_vs_market_pct,
    avg_listing_duplicates_per_property,
        CASE
            WHEN market_confidence_score IS NULL THEN 0
            WHEN market_confidence_score >= 85 THEN 30
            WHEN market_confidence_score >= 70 THEN 24
            WHEN market_confidence_score >= 55 THEN 18
            ELSE 10
        END +
        CASE
            WHEN market_sample_size IS NULL THEN 0
            WHEN market_sample_size >= 100 THEN 20
            WHEN market_sample_size >= 50 THEN 16
            WHEN market_sample_size >= 20 THEN 10
            ELSE 4
        END +
        CASE
            WHEN snapshot_days IS NULL THEN 0
            WHEN snapshot_days >= 10 THEN 20
            WHEN snapshot_days >= 5 THEN 14
            WHEN snapshot_days >= 2 THEN 8
            ELSE 3
        END +
        CASE
            WHEN days_on_market IS NULL THEN 0
            WHEN days_on_market >= 30 THEN 12
            WHEN days_on_market >= 14 THEN 8
            WHEN days_on_market >= 7 THEN 5
            ELSE 2
        END +
        CASE
            WHEN avg_listing_duplicates_per_property IS NULL THEN 0
            WHEN avg_listing_duplicates_per_property <= 1.2 THEN 12
            WHEN avg_listing_duplicates_per_property <= 2::numeric THEN 8
            WHEN avg_listing_duplicates_per_property <= 3::numeric THEN 5
            ELSE 2
        END +
        CASE
            WHEN price_m2_gap_vs_market_pct IS NULL THEN 0
            WHEN abs(price_m2_gap_vs_market_pct) >= 10::numeric THEN 6
            WHEN abs(price_m2_gap_vs_market_pct) >= 5::numeric THEN 4
            ELSE 2
        END AS recommendation_confidence_score_raw,
    LEAST(100,
        CASE
            WHEN market_confidence_score IS NULL THEN 0
            WHEN market_confidence_score >= 85 THEN 30
            WHEN market_confidence_score >= 70 THEN 24
            WHEN market_confidence_score >= 55 THEN 18
            ELSE 10
        END +
        CASE
            WHEN market_sample_size IS NULL THEN 0
            WHEN market_sample_size >= 100 THEN 20
            WHEN market_sample_size >= 50 THEN 16
            WHEN market_sample_size >= 20 THEN 10
            ELSE 4
        END +
        CASE
            WHEN snapshot_days IS NULL THEN 0
            WHEN snapshot_days >= 10 THEN 20
            WHEN snapshot_days >= 5 THEN 14
            WHEN snapshot_days >= 2 THEN 8
            ELSE 3
        END +
        CASE
            WHEN days_on_market IS NULL THEN 0
            WHEN days_on_market >= 30 THEN 12
            WHEN days_on_market >= 14 THEN 8
            WHEN days_on_market >= 7 THEN 5
            ELSE 2
        END +
        CASE
            WHEN avg_listing_duplicates_per_property IS NULL THEN 0
            WHEN avg_listing_duplicates_per_property <= 1.2 THEN 12
            WHEN avg_listing_duplicates_per_property <= 2::numeric THEN 8
            WHEN avg_listing_duplicates_per_property <= 3::numeric THEN 5
            ELSE 2
        END +
        CASE
            WHEN price_m2_gap_vs_market_pct IS NULL THEN 0
            WHEN abs(price_m2_gap_vs_market_pct) >= 10::numeric THEN 6
            WHEN abs(price_m2_gap_vs_market_pct) >= 5::numeric THEN 4
            ELSE 2
        END) AS recommendation_confidence_score,
        CASE
            WHEN LEAST(100,
            CASE
                WHEN market_confidence_score IS NULL THEN 0
                WHEN market_confidence_score >= 85 THEN 30
                WHEN market_confidence_score >= 70 THEN 24
                WHEN market_confidence_score >= 55 THEN 18
                ELSE 10
            END +
            CASE
                WHEN market_sample_size IS NULL THEN 0
                WHEN market_sample_size >= 100 THEN 20
                WHEN market_sample_size >= 50 THEN 16
                WHEN market_sample_size >= 20 THEN 10
                ELSE 4
            END +
            CASE
                WHEN snapshot_days IS NULL THEN 0
                WHEN snapshot_days >= 10 THEN 20
                WHEN snapshot_days >= 5 THEN 14
                WHEN snapshot_days >= 2 THEN 8
                ELSE 3
            END +
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market >= 30 THEN 12
                WHEN days_on_market >= 14 THEN 8
                WHEN days_on_market >= 7 THEN 5
                ELSE 2
            END +
            CASE
                WHEN avg_listing_duplicates_per_property IS NULL THEN 0
                WHEN avg_listing_duplicates_per_property <= 1.2 THEN 12
                WHEN avg_listing_duplicates_per_property <= 2::numeric THEN 8
                WHEN avg_listing_duplicates_per_property <= 3::numeric THEN 5
                ELSE 2
            END +
            CASE
                WHEN price_m2_gap_vs_market_pct IS NULL THEN 0
                WHEN abs(price_m2_gap_vs_market_pct) >= 10::numeric THEN 6
                WHEN abs(price_m2_gap_vs_market_pct) >= 5::numeric THEN 4
                ELSE 2
            END) >= 75 THEN 'high'::text
            WHEN LEAST(100,
            CASE
                WHEN market_confidence_score IS NULL THEN 0
                WHEN market_confidence_score >= 85 THEN 30
                WHEN market_confidence_score >= 70 THEN 24
                WHEN market_confidence_score >= 55 THEN 18
                ELSE 10
            END +
            CASE
                WHEN market_sample_size IS NULL THEN 0
                WHEN market_sample_size >= 100 THEN 20
                WHEN market_sample_size >= 50 THEN 16
                WHEN market_sample_size >= 20 THEN 10
                ELSE 4
            END +
            CASE
                WHEN snapshot_days IS NULL THEN 0
                WHEN snapshot_days >= 10 THEN 20
                WHEN snapshot_days >= 5 THEN 14
                WHEN snapshot_days >= 2 THEN 8
                ELSE 3
            END +
            CASE
                WHEN days_on_market IS NULL THEN 0
                WHEN days_on_market >= 30 THEN 12
                WHEN days_on_market >= 14 THEN 8
                WHEN days_on_market >= 7 THEN 5
                ELSE 2
            END +
            CASE
                WHEN avg_listing_duplicates_per_property IS NULL THEN 0
                WHEN avg_listing_duplicates_per_property <= 1.2 THEN 12
                WHEN avg_listing_duplicates_per_property <= 2::numeric THEN 8
                WHEN avg_listing_duplicates_per_property <= 3::numeric THEN 5
                ELSE 2
            END +
            CASE
                WHEN price_m2_gap_vs_market_pct IS NULL THEN 0
                WHEN abs(price_m2_gap_vs_market_pct) >= 10::numeric THEN 6
                WHEN abs(price_m2_gap_vs_market_pct) >= 5::numeric THEN 4
                ELSE 2
            END) >= 50 THEN 'medium'::text
            ELSE 'low'::text
        END AS recommendation_confidence_bucket
   FROM base b;

-- v_watchlist_page_payload
CREATE OR REPLACE VIEW public.v_watchlist_page_payload AS
 SELECT s.watchlist_id,
    s.user_id,
    s.watchlist_name,
    s.city,
    s.zip_code,
    s.property_type,
    jsonb_build_object('watchlist_id', s.watchlist_id, 'user_id', s.user_id, 'watchlist_name', s.watchlist_name, 'city', s.city, 'zip_code', s.zip_code, 'property_type', s.property_type, 'active_properties', s.active_properties, 'alerts_last_7d', s.alerts_last_7d, 'new_properties_last_7d', s.new_properties_last_7d, 'price_drops_last_7d', s.price_drops_last_7d, 'upgraded_last_7d', s.upgraded_last_7d, 'score_jumps_last_7d', s.score_jumps_last_7d, 'avg_opportunity_score', s.avg_opportunity_score, 'best_opportunity_score', s.best_opportunity_score, 'digest_narrative', n.digest_narrative, 'top_opportunities', COALESCE(t.top_opportunities, '[]'::jsonb), 'recent_alerts', COALESCE(a.recent_alerts, '[]'::jsonb)) AS page_payload
   FROM v_watchlist_digest_summary s
     LEFT JOIN v_watchlist_digest_narrative n ON n.watchlist_id = s.watchlist_id
     LEFT JOIN ( SELECT x.watchlist_id,
            jsonb_agg(jsonb_build_object('watchlist_rank', x.watchlist_rank, 'property_cluster_id', x.property_cluster_id, 'city', x.city, 'zip_code', x.zip_code, 'normalized_address', x.normalized_address, 'property_type', x.property_type, 'canonical_surface_m2', x.canonical_surface_m2, 'canonical_price', x.canonical_price, 'canonical_price_m2', x.canonical_price_m2, 'opportunity_score', x.opportunity_score, 'opportunity_bucket', x.opportunity_bucket) ORDER BY x.watchlist_rank) AS top_opportunities
           FROM v_watchlist_digest_top3 x
          GROUP BY x.watchlist_id) t ON t.watchlist_id = s.watchlist_id
     LEFT JOIN ( SELECT y.watchlist_id,
            jsonb_agg(jsonb_build_object('property_cluster_id', y.property_cluster_id, 'city', y.city, 'zip_code', y.zip_code, 'normalized_address', y.normalized_address, 'observed_date', y.observed_date, 'alert_type', y.alert_type, 'alert_label', y.alert_label, 'alert_message', y.alert_message) ORDER BY y.observed_date DESC, y.normalized_address) AS recent_alerts
           FROM v_watchlist_digest_recent5 y
          GROUP BY y.watchlist_id) a ON a.watchlist_id = s.watchlist_id;

-- market_summary_v2
CREATE OR REPLACE VIEW public.market_summary_v2 AS
 SELECT s.zip_code,
    s.city,
    s.unique_listings,
    s.avg_price,
    s.avg_price_m2,
    s.avg_surface,
    COALESCE(n7.new_unique_listings, 0::bigint) AS new_7d,
    COALESCE(n30.new_unique_listings, 0::bigint) AS new_30d,
    COALESCE(m.multi_portal_pct, 0::numeric) AS multi_portal_pct,
    COALESCE(d.avg_days_on_market, 0::numeric) AS avg_days_on_market,
    COALESCE(p.price_drops_7d, 0::bigint) AS price_drops_7d,
    COALESCE(p.price_drops_30d, 0::bigint) AS price_drops_30d
   FROM market_unique_stock s
     LEFT JOIN market_new_listings_7d n7 ON s.zip_code = n7.zip_code AND s.city = n7.city
     LEFT JOIN market_new_listings_30d n30 ON s.zip_code = n30.zip_code AND s.city = n30.city
     LEFT JOIN market_multi_portal_rate m ON s.zip_code = m.zip_code AND s.city = m.city
     LEFT JOIN market_listing_duration d ON s.zip_code = d.zip_code AND s.city = d.city
     LEFT JOIN market_price_drops_summary p ON s.zip_code = p.zip_code AND s.city = p.city;

-- v_property_investment_memo
CREATE OR REPLACE VIEW public.v_property_investment_memo AS
 SELECT c.id AS property_cluster_id,
    c.city,
    c.zip_code,
    c.normalized_address,
    c.property_type,
    c.rooms,
    c.bedrooms,
    c.canonical_surface_m2,
    c.canonical_price,
    c.canonical_price_m2,
    c.first_seen_at,
    c.last_seen_at,
    c.is_active,
    st.days_on_market,
    st.first_observed_date,
    st.first_observed_price,
    st.latest_observed_date,
    st.latest_observed_price,
    st.lowest_observed_price,
    st.highest_observed_price,
    st.snapshot_days,
    st.price_drop_events,
    st.total_price_change_value,
    st.total_price_change_pct,
    st.total_negotiation_band_value,
    st.total_negotiation_band_pct,
    st.market_freshness_bucket,
    st.price_adjustment_pattern,
    mg.market_reference_date,
    mg.market_median_price_m2,
    mg.market_avg_price_m2,
    mg.market_sample_size,
    mg.market_source,
    mg.market_confidence_score,
    mg.estimated_market_price_from_median,
    mg.estimated_market_price_from_avg,
    mg.price_m2_gap_vs_market_pct,
    mg.price_gap_vs_market_value,
    mg.market_position_bucket,
    mgs.market_position_label,
    mgs.market_gap_signal,
    mgs.market_value_signal,
    nl.negotiation_leverage_score,
    nl.negotiation_leverage_bucket,
    ns.leverage_label,
    ns.leverage_time_signal,
    ns.leverage_drop_signal,
    ns.leverage_price_signal,
    ns.leverage_band_signal,
    ns.negotiation_summary,
    og.anchor_offer_price,
    og.realistic_offer_price,
    og.offer_strategy_note,
    acq.acquisition_signal_bucket,
    acq.acquisition_summary,
    rc.recommendation_confidence_score,
    rc.recommendation_confidence_bucket,
    rs.confidence_label,
    rs.confidence_comment,
    rs.recommendation_narrative,
    z.market_narrative_enriched AS zone_market_narrative,
        CASE
            WHEN acq.acquisition_signal_bucket = 'strong_position'::text AND (rc.recommendation_confidence_bucket = ANY (ARRAY['medium'::text, 'high'::text])) THEN 'GO_STRONG'::text
            WHEN (acq.acquisition_signal_bucket = ANY (ARRAY['good_opportunity'::text, 'balanced'::text])) AND rc.recommendation_confidence_bucket = 'high'::text THEN 'GO'::text
            WHEN (acq.acquisition_signal_bucket = ANY (ARRAY['good_opportunity'::text, 'balanced'::text])) AND rc.recommendation_confidence_bucket = 'medium'::text THEN 'GO_WITH_CAUTION'::text
            WHEN acq.acquisition_signal_bucket = 'balanced'::text AND rc.recommendation_confidence_bucket = 'low'::text THEN 'WATCH'::text
            ELSE 'CAUTIOUS'::text
        END AS memo_decision_bucket,
        CASE
            WHEN acq.acquisition_signal_bucket = 'strong_position'::text AND (rc.recommendation_confidence_bucket = ANY (ARRAY['medium'::text, 'high'::text])) THEN 'Position favorable : bien compétitif ou sous le marché, avec lecture suffisamment étayée pour envisager une offre active.'::text
            WHEN (acq.acquisition_signal_bucket = ANY (ARRAY['good_opportunity'::text, 'balanced'::text])) AND rc.recommendation_confidence_bucket = 'high'::text THEN 'Contexte globalement favorable, avec une recommandation suffisamment robuste pour soutenir une offre argumentée.'::text
            WHEN (acq.acquisition_signal_bucket = ANY (ARRAY['good_opportunity'::text, 'balanced'::text])) AND rc.recommendation_confidence_bucket = 'medium'::text THEN 'Contexte intéressant, mais encore à confirmer par les comparables fins, la visite et la qualité intrinsèque du bien.'::text
            WHEN acq.acquisition_signal_bucket = 'balanced'::text AND rc.recommendation_confidence_bucket = 'low'::text THEN 'Lecture utile mais encore préliminaire : le dossier mérite surtout une mise sous surveillance ou une approche prudente.'::text
            ELSE 'Le couple prix / levier / confiance ne crée pas encore un avantage suffisamment clair pour être offensif.'::text
        END AS memo_decision_comment
   FROM property_clusters c
     LEFT JOIN v_property_cluster_seller_trajectory st ON st.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_market_gap mg ON mg.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_market_gap_signals mgs ON mgs.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_negotiation_leverage nl ON nl.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_negotiation_signals ns ON ns.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_offer_guidance og ON og.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_acquisition_signal acq ON acq.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_recommendation_confidence rc ON rc.property_cluster_id = c.id
     LEFT JOIN v_property_cluster_recommendation_summary rs ON rs.property_cluster_id = c.id
     LEFT JOIN v_market_zone_narratives_v2 z ON z.city = c.city AND z.zip_code = c.zip_code;

-- FIN DE LA SAUVEGARDE DES VUES (132 vues)
