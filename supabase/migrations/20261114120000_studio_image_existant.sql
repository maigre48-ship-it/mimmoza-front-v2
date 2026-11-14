-- =============================================================================
-- 14/11/2026 — File de travaux du Studio : option d'image `existant` (projet d'EXTENSION, maison conservée) (LOT X3)
-- À RELIRE — NON APPLIQUÉE. Écrite par l'agent du lot X3 ; à appliquer après relecture, APRÈS le worker qui connaît
-- l'option (lot X2, worker/src/options.ts : « existant » conserver | effacer, refus avec masque_existant) et AVANT le
-- site qui l'envoie (copilot-chat, lot X3, quand le rendu d'extension sera ouvert).
-- =============================================================================
-- Constat (production fwvrqngbafqdaekbdfnm, 14/11/2026, LECTURE SEULE) : `public._studio_job_options_valides` refuse
-- toute clé d'image hors de : vues, ambiance, qualite, fond, photo_rue, photo_client, calage_client, masque_existant.
-- Contrat X0 (mimmozia-studio, src/core/extension/contrat.ts, `optionTravailExistant`) : option `existant`
--      « conserver » : le bâtiment existant de la photo est GARDÉ (aucun effacement) ;
--      « effacer »   : comportement des lots P4–P8 (valeur par défaut quand l'option est absente).
--      « partiel »   : RÉSERVÉ (démolition partielle, lot ultérieur) → refusé ici.
-- Cohérence : `masque_existant` (zone à effacer corrigée dans l'atelier, lot P5) n'a pas de sens si la maison est
-- conservée → la combinaison `existant = conserver` + `masque_existant` est REFUSÉE (même règle que le worker X2).
--
-- `_studio_job_options_valides` : définition de PRODUCTION lue le 14/11/2026 (pg_get_functiondef) recopiée À
-- L'IDENTIQUE, plus, dans la branche `image` seulement : la clé `existant` dans la liste blanche et deux conditions.
-- Film, visite 360° et toutes les autres règles d'image sont inchangés. Aucune ligne de studio_jobs n'est modifiée ;
-- aucune contrainte de table n'est ajoutée (le déclencheur `_studio_jobs_proteger` appelle déjà la fonction à l'insertion).
-- REJOUABLE ET SANS PERTE : create or replace uniquement.
-- Testée sur PGlite (Postgres en WASM) : supabase/functions/copilot-chat/agent/extension-sql.test.ts (équivalence avec
-- la définition de production sur toutes les options sans `existant`, puis les nouveaux cas).
-- APPLICATION : éditeur SQL de Supabase (coller le fichier entier, Run), ou « dis-moi applique la migration X3 ».
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
          (select coalesce(bool_and(k in ('vues', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client', 'masque_existant', 'existant')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee')
      and coalesce(p_options->>'qualite', 'finale') in ('finale', 'apercu')
      and (
        p_options->'vues' is null
        or case when jsonb_typeof(p_options->'vues') is distinct from 'array' then false else (
          jsonb_array_length(p_options->'vues') between 1 and 3
          and (select bool_and(jsonb_typeof(v) = 'string'
                               and v #>> '{}' in ('trois_quarts_gauche', 'trois_quarts_droite', 'face'))
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
    else false
  end;
$$;

commit;

-- =============================================================================
-- Vérifications après application (LECTURE SEULE) :
--   select public._studio_job_options_valides('image', '{"vues":["face"],"existant":"conserver"}');   -- true
--   select public._studio_job_options_valides('image', '{"existant":"effacer"}');                      -- true
--   select public._studio_job_options_valides('image', '{"existant":"partiel"}');                      -- false (réservé)
--   select public._studio_job_options_valides('image', '{"fond":"photo_rue","calage_client":{"version":1,"largeur_image":4032,"hauteur_image":3024,"valide_le":"2026-11-12T12:00:00Z","correspondances":[{"image":[1,1],"monde":[2.4,48.8,0]},{"image":[2,2],"monde":[2.4,48.8,0]}]},"masque_existant":{"chemin":"11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png","octets":12345},"existant":"conserver"}');  -- false (conserver + zone à effacer)
--   select public._studio_job_options_valides('film', '{"existant":"conserver"}');                     -- false (image seulement)
--   select public._studio_job_options_valides('image', '{"vues":["face"],"ambiance":"jour"}');          -- true (inchangé)
--
-- RETOUR ARRIÈRE (seulement si aucun travail avec `existant` n'est en attente) : rejouer la section « 2. Options » de
-- 20261112120000_studio_image_masque_existant.sql (définition précédente, identique à la production du 14/11/2026).
-- =============================================================================
