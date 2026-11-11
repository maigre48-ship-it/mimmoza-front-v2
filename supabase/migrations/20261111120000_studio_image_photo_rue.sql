-- =============================================================================
-- 11/11/2026 — File de travaux du Studio : image « dans sa rue » (LOT P2)
-- À RELIRE — NON APPLIQUÉE. Écrite par l'agent du lot P2 ; à appliquer par l'agent principal après relecture.
-- =============================================================================
-- Contrat : _mimmoza-agents/agents-1111/CONTRAT-PHOTO-RUE.md, §1 (options d'un travail `image`).
-- Constat (production, 11/11, lecture seule) : `_studio_job_options_valides` n'accepte pour `image` QUE
-- `vues`, `ambiance`, `qualite` ; l'option `fond` serait REFUSÉE à l'insertion (« Options du travail invalides »).
--
-- 1. `_studio_job_options_valides` : film et visite STRICTEMENT inchangés ; image : règles existantes
--    inchangées (vues 1 à 3 sans doublon, ambiance jour|fin_de_journee, qualite finale|apercu) ET nouvelles clés :
--      fond          : 'etude' (défaut) | 'photo_rue' | 'photo_client'
--      photo_rue     : { id: uuid } — seulement si fond = photo_rue (facultatif)
--      photo_client  : { chemin, octets, point_de_vue? } — obligatoire si et seulement si fond = photo_client ;
--                      chemin ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$', octets entier 1..20 971 520,
--                      point_de_vue { lon, lat, cap_deg? } (cap 0 ≤ x < 360)
--      calage_client : { version: 1, correspondances: 2 à 12 × { image: [x, y], monde: [lon, lat, z] },
--                        largeur_image, hauteur_image (entiers 1..20000), valide_le (horodatage ISO) } —
--                      seulement avec un fond photo ; points dans l'image, |z| ≤ 1000 m
--      aucune autre clé.
--    Deux fonctions d'aide (plpgsql, IMMUTABLE) font les contrôles de structure : en SQL pur, l'ordre
--    d'évaluation d'un AND n'est pas garanti et une conversion (::numeric) sur une valeur non numérique lèverait
--    une erreur au lieu de répondre « faux ».
-- 2. Contrainte `studio_jobs_photo_client_proprietaire` : le dossier de la photo du client est celui du
--    propriétaire du travail (`<user_id>/…`). La machine de rendu lit la photo avec la clé de service : sans cette
--    contrainte, un travail pourrait désigner la photo d'un autre compte. Aucune ligne existante n'a de
--    `photo_client` : la contrainte est validée sans rien modifier.
-- 3. Stockage : AUCUN changement. Le seau privé `studio-transfert` (20 Mo, jpeg/png/webp/pdf) et ses politiques
--    par propriétaire (`(storage.foldername(name))[1] = auth.uid()::text` en lecture, ajout, suppression) existent
--    déjà : 20261007_studio_transfert.sql (« déjà appliqué le 07/10/2026 »). Vérification en lecture seule en bas.
--
-- Facturation : aucune (aucun jeton débité pour un rendu aujourd'hui).
-- REJOUABLE ET SANS PERTE : create or replace, drop constraint if exists + add ; aucune ligne modifiée.
-- Testée sur PGlite (Postgres en WASM) par l'agent du lot P2 : appliquée deux fois après 20261026 et
-- 20261102120000, cas du contrat, mêmes réponses que le validateur du site (voir RESULTATS-TESTS.txt du lot).
-- APPLICATION : éditeur SQL de Supabase (coller le fichier entier, Run).
-- =============================================================================

begin;

-- ── Aide : photo du client ──────────────────────────────────────────────────
create or replace function public._studio_photo_client_valide(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_pdv jsonb;
  v_octets numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('chemin', 'octets', 'point_de_vue')) then return false; end if;
  if jsonb_typeof(p->'chemin') is distinct from 'string'
     or (p->>'chemin') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$' then return false; end if;
  if jsonb_typeof(p->'octets') is distinct from 'number' then return false; end if;
  v_octets := (p->>'octets')::numeric;
  if v_octets <> trunc(v_octets) or v_octets < 1 or v_octets > 20971520 then return false; end if;
  v_pdv := p->'point_de_vue';
  if v_pdv is not null then
    if jsonb_typeof(v_pdv) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_pdv) k where k not in ('lon', 'lat', 'cap_deg')) then return false; end if;
    if jsonb_typeof(v_pdv->'lon') is distinct from 'number' or jsonb_typeof(v_pdv->'lat') is distinct from 'number' then return false; end if;
    if abs((v_pdv->>'lon')::numeric) > 180 or abs((v_pdv->>'lat')::numeric) > 90 then return false; end if;
    if v_pdv->'cap_deg' is not null then
      if jsonb_typeof(v_pdv->'cap_deg') is distinct from 'number' then return false; end if;
      if (v_pdv->>'cap_deg')::numeric < 0 or (v_pdv->>'cap_deg')::numeric >= 360 then return false; end if;
    end if;
  end if;
  return true;
end;
$$;

-- ── Aide : calage validé par l'utilisateur dans l'atelier ───────────────────
create or replace function public._studio_calage_client_valide(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_l numeric;
  v_h numeric;
  v_c jsonb;
  v_i jsonb;
  v_m jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k
              where k not in ('version', 'correspondances', 'largeur_image', 'hauteur_image', 'valide_le')) then return false; end if;
  if jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version')::numeric <> 1 then return false; end if;
  if jsonb_typeof(p->'largeur_image') is distinct from 'number' or jsonb_typeof(p->'hauteur_image') is distinct from 'number' then return false; end if;
  v_l := (p->>'largeur_image')::numeric;
  v_h := (p->>'hauteur_image')::numeric;
  if v_l <> trunc(v_l) or v_h <> trunc(v_h) or v_l < 1 or v_h < 1 or v_l > 20000 or v_h > 20000 then return false; end if;
  if jsonb_typeof(p->'valide_le') is distinct from 'string' or length(p->>'valide_le') > 40
     or (p->>'valide_le') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' then return false; end if;
  if jsonb_typeof(p->'correspondances') is distinct from 'array'
     or jsonb_array_length(p->'correspondances') not between 2 and 12 then return false; end if;
  for v_c in select x from jsonb_array_elements(p->'correspondances') as x loop
    if jsonb_typeof(v_c) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_c) k where k not in ('image', 'monde')) then return false; end if;
    v_i := v_c->'image';
    v_m := v_c->'monde';
    if jsonb_typeof(v_i) is distinct from 'array' or jsonb_array_length(v_i) <> 2
       or jsonb_typeof(v_m) is distinct from 'array' or jsonb_array_length(v_m) <> 3 then return false; end if;
    if jsonb_typeof(v_i->0) is distinct from 'number' or jsonb_typeof(v_i->1) is distinct from 'number'
       or jsonb_typeof(v_m->0) is distinct from 'number' or jsonb_typeof(v_m->1) is distinct from 'number'
       or jsonb_typeof(v_m->2) is distinct from 'number' then return false; end if;
    if (v_i->>0)::numeric < 0 or (v_i->>1)::numeric < 0 or (v_i->>0)::numeric > v_l or (v_i->>1)::numeric > v_h then return false; end if;
    if abs((v_m->>0)::numeric) > 180 or abs((v_m->>1)::numeric) > 90 or abs((v_m->>2)::numeric) > 1000 then return false; end if;
  end loop;
  return true;
end;
$$;

-- ── 1. Options : film et visite inchangés, image complétée ──────────────────
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
          (select coalesce(bool_and(k in ('vues', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client')), true)
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
    else false
  end;
$$;

-- ── 2. La photo du client appartient au propriétaire du travail ─────────────
alter table public.studio_jobs drop constraint if exists studio_jobs_photo_client_proprietaire;
alter table public.studio_jobs
  add constraint studio_jobs_photo_client_proprietaire
  check (options->'photo_client'->>'chemin' is null
         or split_part(options->'photo_client'->>'chemin', '/', 1) = user_id::text);

commit;

-- =============================================================================
-- Vérifications après application (LECTURE SEULE) :
--   select public._studio_job_options_valides('image', '{"vues":["face"],"ambiance":"jour"}');                       -- true (inchangé)
--   select public._studio_job_options_valides('image', '{"qualite":"apercu"}');                                      -- true (inchangé)
--   select public._studio_job_options_valides('image', '{"ambiance":"nuit"}');                                       -- false (inchangé)
--   select public._studio_job_options_valides('image', '{"fond":"photo_rue"}');                                      -- true
--   select public._studio_job_options_valides('image', '{"fond":"photo_client"}');                                   -- false (photo obligatoire)
--   select public._studio_job_options_valides('image', '{"fond":"etude","photo_rue":{"id":"d36c2217-f0a8-4c56-88bb-5092cbe40b93"}}'); -- false
--   select public._studio_job_options_valides('image', '{"fond":"photo_client","photo_client":{"chemin":"11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg","octets":3456789}}'); -- true
--   select public._studio_job_options_valides('film', '{"fond":"photo_rue"}');                                       -- false (film inchangé)
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'studio_jobs_photo_client_proprietaire';
--   -- Seau et politiques de studio-transfert (attendu : 1 seau privé, 20971520 octets ; 3 politiques) :
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'studio-transfert';
--   select policyname, cmd, qual, with_check from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' and policyname like 'transfert_%';
--
-- RETOUR ARRIÈRE (à exécuter seulement si nécessaire ; aucun travail avec les nouvelles clés ne doit être en attente) :
--   begin;
--   alter table public.studio_jobs drop constraint if exists studio_jobs_photo_client_proprietaire;
--   -- puis rejouer la section « 2. Options » de 20261102120000_studio_jobs_image.sql (définition précédente,
--   -- image : clés vues|ambiance|qualite seulement), et enfin :
--   drop function if exists public._studio_photo_client_valide(jsonb);
--   drop function if exists public._studio_calage_client_valide(jsonb);
--   commit;
-- =============================================================================
