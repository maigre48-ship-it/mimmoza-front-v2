-- ============================================================================
-- LOT 6 — le référentiel métier n'est plus lisible avec la seule clé publique.
-- Appliqué en production le 2026-08-04. Rejouable.
--
-- Suite de 2026-08-04_rls_remediation.sql, dont la section « HORS PÉRIMÈTRE »
-- décrivait ce lot sans le passer.
--
-- Résultat : 109 vues lisibles par `anon` → 5.
--
-- ── Ce qu'on a trouvé en route ──────────────────────────────────────────────
--
-- 6a. Une fuite oubliée par le lot précédent.
--     Sur les 15 vues `v_watchlist_*`, 14 sont passées en `security_invoker`.
--     `v_watchlist_page_payload_json` ne l'était pas — et elle seule restait
--     accordée à `anon`.
--     Le piège est subtil : elle enveloppe `v_watchlist_page_payload`, qui est
--     bien en invoker. Mais « invoker » désigne l'utilisateur du contexte
--     d'exécution courant. Appelée depuis une vue exécutée avec les droits de
--     son propriétaire, la vue invoker évalue le RLS *en tant que propriétaire*.
--     La protection posée hier était donc court-circuitée par un simple
--     emballage JSON.
--     Le payload contient `user_id`, le nom de la veille, la commune, les biens
--     suivis et les alertes récentes. De tous les utilisateurs.
--
-- 6b. Le reste du référentiel.
--     ~100 vues — DVF retraité, PLU normalisé, scoring `v_property_*`,
--     narratifs de marché — lisibles par quiconque récupère la clé anon dans le
--     bundle. Aucune donnée personnelle, mais c'est le fonds de commerce.
--
-- ── Comment le périmètre a été établi ───────────────────────────────────────
--
-- Le fichier précédent conditionnait ce lot à « vérifier qu'aucune page
-- publique ne s'en sert ». Vérification faite, avec une surprise : il n'y a
-- pratiquement pas de page privée. `PrivateRoute` ne couvre que /accueil,
-- /mimmozia et /dashboard, et se contente de lire un booléen dans
-- localStorage. Tout le reste — /promoteur/*, /particulier/*, /apporteur,
-- /veille/marche — s'ouvre sans session.
--
-- La conséquence est l'inverse de l'intuition : puisque le routeur ne protège
-- rien, les droits Postgres sont la seule frontière réelle. Ce lot n'est pas un
-- durcissement de confort.
--
-- Deux vues sont donc conservées à `anon` parce que des pages sans session les
-- interrogent réellement (grep exhaustif de `.from(` sur src/) :
--   · v_market_active_listings  — /veille/marche, /promoteur/veille
--   · v_apporteur_deals_pool    — /apporteur (déjà en security_invoker, et
--                                 l'adresse y est masquée tant que le deal
--                                 n'est pas débloqué)
--
-- Cinq autres vues ne sont citées que par du code dormant : marketVeille.service.ts
-- n'est importé par personne, PluFaisabilite.tsx n'est plus routée. Elles sont
-- révoquées. Si ce code est réveillé, ces pages devront exiger une session.
--   market_summary_v2, market_narrative_summary, market_tension_signal,
--   watchlist_opportunities_deduped, plu_front_zone_summary_v1
-- ============================================================================


-- ── 6a — la fuite ───────────────────────────────────────────────────────────
alter view public.v_watchlist_page_payload_json set (security_invoker = true);
revoke all   on public.v_watchlist_page_payload_json from anon;
grant  select on public.v_watchlist_page_payload_json to authenticated;


-- ── 6b — le référentiel ─────────────────────────────────────────────────────
-- Balayage plutôt qu'une liste en dur : une vue créée demain sans y penser
-- sera reprise au prochain passage.
do $$
declare
  v record;
  garder text[] := array[
    -- Vues système PostGIS : non sensibles, et l'ALTER échouerait.
    'geography_columns', 'geometry_columns',
    -- Alimentent des pages atteignables sans session.
    'v_market_active_listings', 'v_apporteur_deals_pool',
    -- Lue par get_dvf_estimate_v3 / get_dvf_comps_v1, toutes deux en SECURITY
    -- INVOKER et exécutables par anon, depuis /analyse-rapide et
    -- /particulier/estimation. Voir la note ci-dessous.
    'dvf_2025_s1_typed'
  ];
begin
  for v in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
      and has_table_privilege('anon', c.oid, 'SELECT')
      and not (c.relname = any (garder))
  loop
    execute format('revoke all on public.%I from anon', v.relname);
    execute format('grant select on public.%I to authenticated', v.relname);
  end loop;
end $$;


-- ============================================================================
-- 6c — dvf_2025_s1_typed
--
-- Les tables DVF de base (`dvf_clean`, `dvf_geo`, `dvf_mimmoza_24m`) ont reçu
-- le RLS hier, sans policy : `anon` n'en tire rien. Mais `dvf_2025_s1_typed`
-- est une vue en `security_invoker = false`, donc exécutée avec les droits du
-- propriétaire — elle traversait ce RLS. La clé publique permettait de
-- rapatrier tout le DVF retraité.
--
-- Révoquer sèchement était exclu : `get_dvf_estimate_v3` et `get_dvf_comps_v1`
-- la lisent en SECURITY INVOKER, et /analyse-rapide s'ouvre sans session.
--
-- Les deux fonctions passent donc en DEFINER. L'estimation publique demeure,
-- mais elle passe par une fonction paramétrée qui rend des agrégats — plus par
-- un SELECT libre sur le référentiel.
--
-- `search_path` est figé sur les deux : une fonction DEFINER dont le chemin est
-- modifiable peut être détournée vers des objets homonymes créés par
-- l'appelant. C'est aussi le premier caillou du point 10 (≈130 fonctions dans
-- ce cas).
-- ============================================================================

alter function public.get_dvf_estimate_v3(text, numeric, integer, text, integer, text, integer)
  security definer
  set search_path = public, pg_temp;

alter function public.get_dvf_comps_v1(text, integer, text, integer, text, integer)
  security definer
  set search_path = public, pg_temp;

-- EXECUTE reste ouvert à anon : c'est désormais la seule porte d'entrée.
grant execute on function public.get_dvf_estimate_v3(text, numeric, integer, text, integer, text, integer) to anon, authenticated;
grant execute on function public.get_dvf_comps_v1(text, integer, text, integer, text, integer) to anon, authenticated;

revoke all   on public.dvf_2025_s1_typed from anon;
grant  select on public.dvf_2025_s1_typed to authenticated;


-- ============================================================================
-- VÉRIFICATION — état constaté après application
--   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind in ('v','m')
--     and has_table_privilege('anon', c.oid, 'SELECT');
--   -- obtenu : geography_columns, geometry_columns,
--   --          v_apporteur_deals_pool, v_market_active_listings
--
-- À retester côté front, puisqu'aucun build n'a pu être lancé :
--   · /analyse-rapide et /particulier/estimation — l'estimation DVF passe
--     maintenant par les deux fonctions DEFINER.
--   · /veille/marche et /promoteur/veille — v_market_active_listings conservée.
--   · /apporteur — v_apporteur_deals_pool conservée.
--   · toute page de veille ou de watchlist ouverte SANS session : elle reviendra
--     vide, et c'est le comportement voulu.
-- ============================================================================
