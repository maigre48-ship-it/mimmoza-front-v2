-- =============================================================================
-- 12/11/2026 — File de travaux du Studio : zone du bâtiment existant à effacer, corrigée dans l'atelier (LOT P5-SITE)
-- À RELIRE — NON APPLIQUÉE. Écrite par l'agent du lot P5-SITE ; à appliquer après relecture, et APRÈS le worker
-- qui connaît l'option (sinon le worker refuse le travail : « option inconnue »), AVANT le site qui l'envoie.
-- =============================================================================
-- Constats (production fwvrqngbafqdaekbdfnm, 12/11/2026, lecture seule) :
--   - seau `studio-rendus` : privé ; l'utilisateur authentifié n'a QUE la lecture (politique
--     studio_rendus_select_proprietaire) : il ne peut pas y déposer le masque corrigé ;
--   - déclencheur `_studio_jobs_proteger` : à chaque insertion par un utilisateur, `new.id := gen_random_uuid()` :
--     l'identifiant du nouveau travail ne peut pas être fixé par le navigateur avant l'insertion ;
--   - seau `studio-transfert` : privé, 20 Mo, image/png admis, politiques par propriétaire (lecture, ajout,
--     suppression) : c'est déjà là que la photo du client est déposée.
-- Donc : le site dépose le PNG dans `studio-transfert/<auth.uid()>/<uuid>.png` AVANT l'insertion, et le travail le
-- désigne par une nouvelle option d'image :
--      masque_existant : { chemin, octets } — seulement avec `calage_client` ;
--                        chemin ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$', octets entier 1..8 388 608 (8 Mo) ;
--                        aucune autre clé.
-- 1. `_studio_masque_existant_valide` (plpgsql, IMMUTABLE : pas d'erreur de conversion, réponse « faux »).
-- 2. `_studio_job_options_valides` : définition de production du 11/11 (20261111120000) recopiée À L'IDENTIQUE,
--    plus la clé `masque_existant` (film, visite et toutes les autres règles d'image inchangés).
-- 3. Contrainte `studio_jobs_masque_existant_proprietaire` : le dossier du masque est celui du propriétaire du
--    travail (la machine de rendu le lit avec la clé de service). Aucune ligne existante n'a cette clé.
-- Stockage : AUCUN changement. Facturation : aucune (aucun jeton débité pour un rendu aujourd'hui).
-- REJOUABLE ET SANS PERTE : create or replace, drop constraint if exists + add ; aucune ligne modifiée.
-- Testée sur PGlite (Postgres en WASM) par l'agent du lot P5-SITE (banc-sql-p5.mjs, voir RESULTATS-TESTS.txt).
-- APPLICATION : éditeur SQL de Supabase (coller le fichier entier, Run).
-- =============================================================================

begin;

-- ── 1. Aide : zone à effacer corrigée ───────────────────────────────────────
create or replace function public._studio_masque_existant_valide(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare v_octets numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('chemin', 'octets')) then return false; end if;
  if jsonb_typeof(p->'chemin') is distinct from 'string'
     or (p->>'chemin') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$' then return false; end if;
  if jsonb_typeof(p->'octets') is distinct from 'number' then return false; end if;
  v_octets := (p->>'octets')::numeric;
  if v_octets <> trunc(v_octets) or v_octets < 1 or v_octets > 8388608 then return false; end if;
  return true;
end;
$$;

-- ── 2. Options : image complétée de `masque_existant` (le reste à l'identique) ─
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
          (select coalesce(bool_and(k in ('vues', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client', 'masque_existant')), true)
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
      -- LOT P2 : fond de l'image (contrat CONTRAT-PHOTO-RUE.md §1).
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
      -- LOT P5 : zone à effacer corrigée dans l'atelier — seulement avec un calage validé (relance depuis l'atelier).
      and (p_options->'masque_existant' is null
           or (p_options->'calage_client' is not null
               and public._studio_masque_existant_valide(p_options->'masque_existant')))
    else false
  end;
$$;

-- ── 3. Le masque appartient au propriétaire du travail ──────────────────────
alter table public.studio_jobs drop constraint if exists studio_jobs_masque_existant_proprietaire;
alter table public.studio_jobs
  add constraint studio_jobs_masque_existant_proprietaire
  check (options->'masque_existant'->>'chemin' is null
         or split_part(options->'masque_existant'->>'chemin', '/', 1) = user_id::text);

commit;

-- =============================================================================
-- Vérifications après application (LECTURE SEULE) :
--   select public._studio_job_options_valides('image', '{"fond":"photo_rue","calage_client":{"version":1,"largeur_image":4032,"hauteur_image":3024,"valide_le":"2026-11-12T12:00:00Z","correspondances":[{"image":[1,1],"monde":[2.4,48.8,0]},{"image":[2,2],"monde":[2.4,48.8,0]}]},"masque_existant":{"chemin":"11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png","octets":12345}}'); -- true
--   select public._studio_job_options_valides('image', '{"fond":"photo_rue","masque_existant":{"chemin":"11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png","octets":12345}}'); -- false (sans calage)
--   select public._studio_job_options_valides('image', '{"vues":["face"],"ambiance":"jour"}');  -- true (inchangé)
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'studio_jobs_masque_existant_proprietaire';
--
-- RETOUR ARRIÈRE (seulement si aucun travail avec `masque_existant` n'est en attente) :
--   begin;
--   alter table public.studio_jobs drop constraint if exists studio_jobs_masque_existant_proprietaire;
--   -- rejouer la section « 1. Options » de 20261111120000_studio_image_photo_rue.sql, puis :
--   drop function if exists public._studio_masque_existant_valide(jsonb);
--   commit;
-- =============================================================================
