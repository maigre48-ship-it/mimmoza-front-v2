-- =============================================================================
-- VIS-10 (19/11/2026) — OPTION `livraison` (livraison commerciale) pour l'image du projet.
--
-- NON APPLIQUÉE par l'agent : à appliquer par Albé APRÈS 20261118180000_studio_image_vues_catalogue.sql et AVANT
-- de redéployer copilot-chat / le front qui envoient `livraison`.
--
-- Constat : le worker (mimmozia-studio, VIS-INT-2 : worker/src/options.ts `lireOptionsLivraison`) accepte l'option
--   livraison : { active?: bool (défaut vrai), formats?: [id…] (au moins un, sans doublon, parmi original,
--                 web_bandeau, web_16_9, mobile_portrait, vignette, impression_a4), sans_mention?: bool,
--                 mention?: texte non vide ≤ 120 car., credit?: texte ≤ 60 car. | null,
--                 position?: 'bas_gauche' | 'bas_droite' }   (une valeur JSON null d'un CHAMP vaut « absente »)
-- VIS-14 (M2) : la clé `livraison` elle-même à null (`{"livraison": null}`) est REFUSÉE — ici (p_options->'livraison' vaut
--   alors le JSON null, pas un NULL SQL, et `_studio_livraison_valide` le refuse), comme par copilot-chat et le front
--   (`validerOptionLivraison`). Le worker, lui, l'ignore (null = absente) : il ne peut jamais la recevoir puisque la
--   base la refuse avant. Pour « pas de choix », OMETTRE la clé ; pour « pas de livraison », `{"active": false}`.
-- mais `_studio_job_options_valides` (20261118180000) refuse toute clé inconnue, donc `livraison`.
-- Changements :
--   · NOUVELLE fonction `_studio_livraison_valide(jsonb)` (mêmes règles que le worker) ;
--   · `_studio_job_options_valides` : définition de 20261118180000 recopiée À L'IDENTIQUE, branche `image` seulement :
--     + clé `livraison` admise, validée par `_studio_livraison_valide`.
-- Élargissement strict : tout ce qui était valide le reste, tout ce qui était refusé le reste sauf `livraison` valide.
-- Aucune ligne de studio_jobs n'est modifiée ; create or replace uniquement (REJOUABLE).
-- Écart connu : la longueur des textes est comptée en caractères (char_length) ici, en unités UTF-16 côté worker ;
-- différence possible seulement pour des caractères hors plan de base (emoji) — le worker refuse alors avec sa raison.
-- =============================================================================

begin;

create or replace function public._studio_livraison_valide(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p) is distinct from 'object' then false
    else
          (select coalesce(bool_and(k in ('active', 'formats', 'sans_mention', 'mention', 'credit', 'position')), true)
             from jsonb_object_keys(p) as k)
      and coalesce(jsonb_typeof(p->'active'), 'null') in ('boolean', 'null')
      and coalesce(jsonb_typeof(p->'sans_mention'), 'null') in ('boolean', 'null')
      and (coalesce(jsonb_typeof(p->'formats'), 'null') = 'null'
           or case when jsonb_typeof(p->'formats') is distinct from 'array' then false else (
             jsonb_array_length(p->'formats') between 1 and 6
             and (select bool_and(jsonb_typeof(f) = 'string'
                                  and f #>> '{}' in ('original', 'web_bandeau', 'web_16_9', 'mobile_portrait', 'vignette', 'impression_a4'))
                    from jsonb_array_elements(p->'formats') as f)
             and (select count(distinct f #>> '{}') from jsonb_array_elements(p->'formats') as f) = jsonb_array_length(p->'formats')
           ) end)
      -- Mention : jamais vide (une image commerciale sort toujours avec sa mention).
      and (coalesce(jsonb_typeof(p->'mention'), 'null') = 'null'
           or (jsonb_typeof(p->'mention') = 'string' and (p->>'mention') ~ '[^[:space:]]' and char_length(p->>'mention') <= 120))
      and (coalesce(jsonb_typeof(p->'credit'), 'null') = 'null'
           or (jsonb_typeof(p->'credit') = 'string' and char_length(p->>'credit') <= 60))
      and (coalesce(jsonb_typeof(p->'position'), 'null') = 'null'
           or (jsonb_typeof(p->'position') = 'string' and p->>'position' in ('bas_gauche', 'bas_droite')))
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
          (select coalesce(bool_and(k in ('vues', 'pack', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client', 'masque_existant', 'existant', 'livraison')), true)
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
      -- VIS-10 : livraison commerciale (worker VIS-07 / VIS-INT-2, `lireOptionsLivraison`).
      and (p_options->'livraison' is null or public._studio_livraison_valide(p_options->'livraison'))
    else false
  end;
$$;

commit;

-- =============================================================================
-- Vérifications après application (LECTURE SEULE) :
--   select public._studio_job_options_valides('image', '{"pack":"pack_plaquette"}');                                        -- true (inchangé)
--   select public._studio_job_options_valides('image', '{"vues":["face"],"livraison":{"active":true}}');                     -- true
--   select public._studio_job_options_valides('image', '{"vues":["face"],"livraison":{"formats":["web_16_9","impression_a4"],"credit":null}}'); -- true
--   select public._studio_job_options_valides('image', '{"vues":["face"],"livraison":{"formats":["poster"]}}');             -- false
--   select public._studio_job_options_valides('image', '{"vues":["face"],"livraison":{"mention":"  "}}');                   -- false
--   select public._studio_job_options_valides('image', '{"vues":["face"],"livraison":{"zip":true}}');                       -- false
--   select public._studio_job_options_valides('film', '{"livraison":{"active":true}}');                                       -- false (image seulement)
--
-- RETOUR ARRIÈRE : rejouer 20261118180000_studio_image_vues_catalogue.sql (définition précédente), seulement si aucun
-- travail en attente n'utilise `livraison` ; la fonction `_studio_livraison_valide` peut rester (inutilisée).
-- =============================================================================
