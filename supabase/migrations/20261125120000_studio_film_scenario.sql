-- =============================================================================
-- VIS-46 (25/11/2026) — OPTION `scenario` (contrat « ScenarioFilm v1 ») pour le FILM.
--
-- NON APPLIQUÉE par l'agent : à faire valider et appliquer par Albé, APRÈS 20261120080000_studio_apercu_film_visite.sql.
-- Ordre conseillé : 1) cette migration ; 2) worker VIS-47 qui lit `options.scenario` ; 3) copilot-chat et front VIS-46.
-- Sans elle, tout fonctionne : copilot-chat contrôle d'abord (rpc `_studio_job_options_valides`) et, si `scenario` est
-- refusé, lance le film avec les options d'avant ET le dit (avertissement « Scénario NON transmis… »).
--
-- Constat (lu le 25/11/2026 sur le projet fwvrqngbafqdaekbdfnm, pg_get_functiondef) : la branche `film` n'admet que
-- duree_s, ambiance, format, interieurs, musique, qualite — toute autre clé est refusée.
-- Changement : définition EN SERVICE recopiée À L'IDENTIQUE ; branche `film` seulement :
--   + clé `scenario` admise ; absente = comme avant ; présente = public._studio_scenario_film_valide(scenario) vrai.
-- Contrôle STRUCTUREL du scénario (la validation complète, corrections comprises, reste dans scenarioFilm.ts des deux
-- côtés) : objet, v = 1, titre texte non vide ≤ 80, intention texte ≤ 600 (vide admise), format / ambiance / style / musique dans
-- leurs listes, voix_off null ou { texte ≤ 600 }, plans tableau de 3 à 12 objets (prompt texte non vide ≤ 280, sujet et
-- mouvement dans leurs listes, duree_s nombre de 2 à 15, texte_ecran ≤ 60, transition coupe | fondu), somme des plans
-- de 15 à 120 s, taille ≤ 32 Ko. Élargissement strict : tout ce qui était valide le reste ; seule nouveauté acceptée :
-- un `scenario` valide pour un film. Branches `visite360` et `image` inchangées (octet pour octet). Aucune ligne de
-- studio_jobs n'est modifiée ; create or replace uniquement (REJOUABLE).
-- =============================================================================

begin;

create or replace function public._studio_scenario_film_valide(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p) is distinct from 'object' then false
    when pg_column_size(p) > 32768 then false
    when (p->>'v') is distinct from '1' or jsonb_typeof(p->'v') is distinct from 'number' then false
    when jsonb_typeof(p->'titre') is distinct from 'string' or length(btrim(p->>'titre')) = 0 or length(p->>'titre') > 80 then false
    when jsonb_typeof(p->'intention') is distinct from 'string' or length(p->>'intention') > 600 then false
    when coalesce(p->>'format', '') not in ('16:9', '9:16', '1:1') then false
    when coalesce(p->>'ambiance', '') not in ('jour', 'fin_de_journee', 'nuit', 'couvert') then false
    when coalesce(p->>'style', '') not in ('cinematique', 'commercial', 'reseaux', 'documentaire') then false
    when jsonb_typeof(p->'musique') is distinct from 'object' or coalesce(p->'musique'->>'ambiance', '') not in ('douce', 'energique', 'elegante', 'aucune') then false
    when not (p->'voix_off' is null or jsonb_typeof(p->'voix_off') = 'null'
              or (jsonb_typeof(p->'voix_off') = 'object' and jsonb_typeof(p->'voix_off'->'texte') = 'string' and length(p->'voix_off'->>'texte') <= 600)) then false
    when jsonb_typeof(p->'plans') is distinct from 'array' then false
    when jsonb_array_length(p->'plans') not between 3 and 12 then false
    else (
      select bool_and(
               jsonb_typeof(pl) = 'object'
               and jsonb_typeof(pl->'prompt') = 'string' and length(btrim(pl->>'prompt')) > 0 and length(pl->>'prompt') <= 280
               and coalesce(pl->>'sujet', '') in ('exterieur_rue', 'facade', 'entree', 'jardin', 'terrasse', 'balcon', 'sejour', 'cuisine', 'chambre',
                                                   'salle_de_bain', 'vue_depuis_baie', 'quartier', 'aerien', 'detail_matiere')
               and coalesce(pl->>'mouvement', '') in ('fixe', 'travelling_avant', 'travelling_lateral', 'orbite', 'panoramique', 'drone_montee',
                                                       'drone_survol', 'grue', 'approche_porte')
               and (case when jsonb_typeof(pl->'duree_s') = 'number' then (pl->>'duree_s')::numeric between 2 and 15 else false end)
               and (pl->'texte_ecran' is null or (jsonb_typeof(pl->'texte_ecran') = 'string' and length(pl->>'texte_ecran') <= 60))
               and (pl->'transition' is null or coalesce(pl->>'transition', '') in ('coupe', 'fondu')))
             and sum(case when jsonb_typeof(pl->'duree_s') = 'number' then (pl->>'duree_s')::numeric else 0 end) between 15 and 120
        from jsonb_array_elements(p->'plans') as pl
    )
  end;
$$;

create or replace function public._studio_job_options_valides(p_type text, p_options jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_options) is distinct from 'object' then false
    when p_type = 'film' then
          (select coalesce(bool_and(k in ('duree_s', 'ambiance', 'format', 'interieurs', 'musique', 'qualite', 'scenario')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'duree_s', '60') in ('30', '60', '90')
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'nuit')
      and coalesce(p_options->>'format', '16:9') in ('16:9', '9:16')
      and coalesce(jsonb_typeof(p_options->'interieurs'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(p_options->'musique'), 'boolean') = 'boolean'
      and coalesce(p_options->>'qualite', 'finale') in ('finale', 'apercu')
      and (p_options->'scenario' is null or public._studio_scenario_film_valide(p_options->'scenario'))
    when p_type = 'visite360' then
          (select coalesce(bool_and(k in ('ambiance', 'interieurs', 'resolution', 'qualite')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'nuit')
      and coalesce(jsonb_typeof(p_options->'interieurs'), 'boolean') = 'boolean'
      and coalesce(p_options->>'resolution', '6k') in ('6k', '8k')
      and coalesce(p_options->>'qualite', 'finale') in ('finale', 'apercu')
    when p_type = 'image' then
          (select coalesce(bool_and(k in ('vues', 'pack', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client', 'masque_existant', 'existant', 'livraison')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'crepuscule')
      and coalesce(p_options->>'qualite', 'finale') in ('finale', 'apercu')
      and (
        p_options->'vues' is null
        or case when jsonb_typeof(p_options->'vues') is distinct from 'array' then false else (
          jsonb_array_length(p_options->'vues') between 1 and 6
          and (select bool_and(jsonb_typeof(v) = 'string'
                               and v #>> '{}' in ('trois_quarts_gauche', 'trois_quarts_droite', 'face', 'angle_rue', 'aerienne', 'entree', 'coeur_ilot',
                                                  'terrasse', 'balcon', 'jardin_prive', 'rooftop', 'sejour', 'chambre', 'vue_baie', 'hall'))
                 from jsonb_array_elements(p_options->'vues') as v)
          and (select count(distinct v #>> '{}') from jsonb_array_elements(p_options->'vues') as v)
              = jsonb_array_length(p_options->'vues')
        ) end
      )
      and (p_options->'fond' is null
           or (jsonb_typeof(p_options->'fond') = 'string' and p_options->>'fond' in ('etude', 'photo_rue', 'photo_client')))
      and (p_options->'photo_rue' is null
           or case when coalesce(p_options->>'fond', 'etude') <> 'photo_rue' or jsonb_typeof(p_options->'photo_rue') is distinct from 'object' then false
                   else (select coalesce(bool_and(k = 'id'), true) from jsonb_object_keys(p_options->'photo_rue') as k)
                        and jsonb_typeof(p_options->'photo_rue'->'id') = 'string'
                        and (p_options->'photo_rue'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' end)
      and case when coalesce(p_options->>'fond', 'etude') = 'photo_client'
               then p_options->'photo_client' is not null and public._studio_photo_client_valide(p_options->'photo_client')
               else p_options->'photo_client' is null end
      and (p_options->'calage_client' is null
           or (coalesce(p_options->>'fond', 'etude') in ('photo_rue', 'photo_client')
               and public._studio_calage_client_valide(p_options->'calage_client')))
      and (p_options->'masque_existant' is null
           or (p_options->'calage_client' is not null
               and public._studio_masque_existant_valide(p_options->'masque_existant')))
      and (p_options->'existant' is null
           or (jsonb_typeof(p_options->'existant') = 'string' and p_options->>'existant' in ('conserver', 'effacer')))
      and not (coalesce(p_options->>'existant', '') = 'conserver' and p_options->'masque_existant' is not null)
      and (p_options->'pack' is null
           or (jsonb_typeof(p_options->'pack') = 'string' and p_options->>'pack' = 'pack_plaquette' and p_options->'vues' is null))
      and (p_options->'livraison' is null or public._studio_livraison_valide(p_options->'livraison'))
    else false
  end;
$$;

commit;

-- Vérifications (après application) :
--   select public._studio_job_options_valides('film', '{}');                                                   -- true (inchangé)
--   select public._studio_job_options_valides('film', '{"duree_s":60,"qualite":"apercu"}');                    -- true (inchangé)
--   select public._studio_job_options_valides('film', '{"inconnue":1}');                                       -- false (inchangé)
--   select public._studio_job_options_valides('film', '{"duree_s":30,"scenario":{"v":1,"titre":"T","intention":"I","duree_s":15,
--     "format":"9:16","ambiance":"jour","style":"reseaux","musique":{"ambiance":"aucune"},"voix_off":null,"plans":[
--     {"id":"p1","prompt":"a","sujet":"facade","mouvement":"orbite","duree_s":5},
--     {"id":"p2","prompt":"b","sujet":"aerien","mouvement":"drone_montee","duree_s":5},
--     {"id":"p3","prompt":"c","sujet":"sejour","mouvement":"fixe","duree_s":5}]}}');                          -- true
--   même requête avec "plans" de 2 éléments, ou "sujet":"piscine", ou "duree_s":20 dans un plan                -- false
--   select public._studio_job_options_valides('visite360', '{"scenario":{}}');                                 -- false (inchangé)
