-- =============================================================================
-- VIS-04 (18/11/2026) — CATALOGUE COMMUN DES VUES ET CRÉPUSCULE pour l'image du projet.
--
-- NON APPLIQUÉE par l'agent : à appliquer par Albé AVANT de redéployer copilot-chat et le front.
--
-- Constat : `_studio_job_options_valides` (définition de 20261114120000_studio_image_existant.sql, recopiée À
-- L'IDENTIQUE ci-dessous) n'accepte en image que 1 à 3 vues parmi trois_quarts_gauche / trois_quarts_droite / face
-- et les ambiances jour / fin_de_journee. Le worker (mimmozia-studio, lot VIS-03 : worker/src/options.ts,
-- worker/src/catalogueVues.ts) accepte désormais 1 à 6 vues du catalogue commun, le pack « pack_plaquette » et
-- l'ambiance « crepuscule ».
-- Changements, dans la branche `image` SEULEMENT :
--   · vues : 1 à 6 identifiants du catalogue (COORDINATION.md) au lieu de 1 à 3 parmi 3 ;
--   · ambiance : + « crepuscule » (la nuit reste refusée) ;
--   · clé `pack` admise (valeur « pack_plaquette » seulement, jamais avec `vues`).
-- Tout ce qui était valide le reste (élargissement strict) ; film et visite 360° inchangés. Aucune ligne de
-- studio_jobs n'est modifiée ; create or replace uniquement (REJOUABLE).
-- Les vues privatives et intérieures sont ADMISES par la base (le worker les refuse avec leur raison tant qu'elles
-- ne sont pas livrées) ; le front et copilot-chat ne proposent que les vues livrées (src/lib/studio/catalogueVues.ts).
-- =============================================================================

begin;

create or replace function public._studio_job_options_valides(p_type text, p_options jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_options) is distinct from 'object' then false
    when p_type = 'film' then
          (select coalesce(bool_and(k in ('duree_s', 'ambiance', 'format', 'interieurs', 'musique')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'duree_s', '60') in ('30', '60', '90')
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'nuit')
      and coalesce(p_options->>'format', '16:9') in ('16:9', '9:16')
      and coalesce(jsonb_typeof(p_options->'interieurs'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(p_options->'musique'), 'boolean') = 'boolean'
    when p_type = 'visite360' then
          (select coalesce(bool_and(k in ('ambiance', 'interieurs', 'resolution')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'nuit')
      and coalesce(jsonb_typeof(p_options->'interieurs'), 'boolean') = 'boolean'
      and coalesce(p_options->>'resolution', '6k') in ('6k', '8k')
    when p_type = 'image' then
          (select coalesce(bool_and(k in ('vues', 'pack', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client', 'masque_existant', 'existant')), true)
             from jsonb_object_keys(p_options) as k)
      -- VIS-04 : + crépuscule (preset crepuscule-bleu du worker, lot VIS-03) ; la nuit reste refusée.
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'crepuscule')
      and coalesce(p_options->>'qualite', 'finale') in ('finale', 'apercu')
      and (
        p_options->'vues' is null
        or case when jsonb_typeof(p_options->'vues') is distinct from 'array' then false else (
          -- VIS-04 : 1 à 6 vues du CATALOGUE COMMUN (mimmozia-studio docs/vis/COORDINATION.md ; worker MAX_VUES_PAR_IMAGE).
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
      -- LOT X3 : bâtiment existant conservé (extension) ou effacé ; « partiel » réservé.
      and (p_options->'existant' is null
           or (jsonb_typeof(p_options->'existant') = 'string' and p_options->>'existant' in ('conserver', 'effacer')))
      -- LOT X3 : une zone à effacer n'a pas de sens si la maison est conservée.
      and not (coalesce(p_options->>'existant', '') = 'conserver' and p_options->'masque_existant' is not null)
      -- VIS-04 : pack de vues (worker VIS-03 : `pack: "pack_plaquette"`), exclusif de `vues`.
      and (p_options->'pack' is null
           or (jsonb_typeof(p_options->'pack') = 'string' and p_options->>'pack' = 'pack_plaquette' and p_options->'vues' is null))
    else false
  end;
$$;

commit;

-- =============================================================================
-- Vérifications après application (LECTURE SEULE) :
--   select public._studio_job_options_valides('image', '{"vues":["face"],"ambiance":"jour"}');                         -- true (inchangé)
--   select public._studio_job_options_valides('image', '{"vues":["trois_quarts_gauche","aerienne","coeur_ilot"]}');      -- true
--   select public._studio_job_options_valides('image', '{"vues":["aerienne"],"ambiance":"crepuscule"}');                  -- true
--   select public._studio_job_options_valides('image', '{"pack":"pack_plaquette"}');                                     -- true
--   select public._studio_job_options_valides('image', '{"pack":"pack_plaquette","vues":["face"]}');                     -- false
--   select public._studio_job_options_valides('image', '{"vues":["vue_mer"]}');                                          -- false
--   select public._studio_job_options_valides('image', '{"vues":["face","aerienne","entree","angle_rue","coeur_ilot","trois_quarts_gauche","trois_quarts_droite"]}'); -- false (7 vues)
--   select public._studio_job_options_valides('image', '{"ambiance":"nuit"}');                                           -- false (inchangé)
--
-- RETOUR ARRIÈRE : rejouer 20261114120000_studio_image_existant.sql (définition précédente), seulement si aucun travail
-- en attente n'utilise une vue ajoutée, le pack ou le crépuscule.
-- =============================================================================
