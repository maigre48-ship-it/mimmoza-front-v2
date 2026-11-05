-- =============================================================================
-- 02/11/2026 — File de travaux du Studio : 3e type « image » (image photoréaliste)
-- =============================================================================
-- Complète 20261026_studio_jobs.sql (inchangé). Le worker du PC de rendu prend
-- désormais aussi les travaux « image » (worker/src/image.ts du studio) :
-- caméra automatique depuis la rue, réglages de l'image vitrine, rendu path
-- tracer, livraison dans studio-rendus/<user_id>/<job_id>/image-<vue>.jpg|.png.
--
-- 1. Contrainte de type : 'film', 'visite360' et désormais 'image'.
-- 2. Options acceptées pour une image (mêmes règles que le front et le worker) :
--      vues     : tableau de 1 à 3 valeurs distinctes parmi
--                 'trois_quarts_gauche', 'trois_quarts_droite', 'face'
--                 (défaut : ['trois_quarts_gauche']) ;
--      ambiance : 'jour' (défaut) ou 'fin_de_journee' — pas de nuit (aucun
--                 réglage validé en image fixe) ;
--      qualite  : 'finale' (défaut : rendu 4K, image livrée 2880×1620) ou
--                 'apercu' (rendu 1600 px, image livrée 1200×676, ≈ 7 min
--                 par vue) — LOT E0 du 05/11/2026.
--    Film et visite : règles STRICTEMENT identiques à 20261026.
-- 3. Message du plafond (2 travaux actifs, règle inchangée) : il cite
--    désormais aussi l'image (« 2 rendus en préparation ») — la fonction est
--    recréée à l'identique sinon (même verrou, même compte, mêmes droits).
-- 4. Rien d'autre ne change : sécurité (RLS, déclencheur de protection,
--    politiques), fonctions du worker (studio_job_prendre reçoit la liste des
--    types du worker, qui contient 'image') et buckets (studio-rendus accepte
--    déjà image/jpeg et image/png) restent ceux de 20261026.
--
-- Facturation : aucune. Le film et la visite ne débitent aucun jeton ;
-- l'image non plus (aucun prix inventé).
--
-- REJOUABLE ET SANS PERTE : la contrainte de type est remplacée dans une seule
-- transaction (drop if exists + add) — aucune ligne n'est modifiée ni
-- supprimée, les lignes existantes ('film', 'visite360') la respectent ;
-- les fonctions sont recréées (create or replace : droits conservés, et le
-- revoke du plafond est rejoué). Testée sur PGlite : appliquée deux fois de
-- suite après 20261026, puis contrôles des types, options, transitions de
-- statut, plafond et droits (LOT E0, banc-sql.mjs).
--
-- APPLICATION : éditeur SQL de Supabase (coller le fichier entier, Run). Avec
-- la CLI, son horodatage est ANTÉRIEUR à 20261104120000 : `supabase db push`
-- exigerait --include-all. L'éditeur SQL est le chemin prévu.
-- =============================================================================

begin;

-- ── 1. Type de travail ──────────────────────────────────────────────────────
alter table public.studio_jobs drop constraint if exists studio_jobs_type_check;
alter table public.studio_jobs
  add constraint studio_jobs_type_check check (type in ('film', 'visite360', 'image'));

comment on table public.studio_jobs is
  'File des films, visites 360° et images photoréalistes calculés par le Studio (contrat CONTRAT_FILM_VISITE.md).';

-- ── 2. Options : film et visite inchangés, image ajoutée ────────────────────
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
          (select coalesce(bool_and(k in ('vues', 'ambiance', 'qualite')), true)
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
    else false
  end;
$$;

-- ── 3. Plafond : même règle (2 travaux actifs), message qui cite l'image ────
create or replace function public._studio_jobs_plafond()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actifs integer;
begin
  if new.statut not in ('en_attente', 'en_cours') then
    return new;
  end if;
  -- Verrou par utilisateur : deux créations simultanées ne passent pas le plafond.
  perform pg_advisory_xact_lock(hashtextextended('studio_jobs:' || new.user_id::text, 0));
  select count(*) into v_actifs
    from public.studio_jobs
   where user_id = new.user_id
     and statut in ('en_attente', 'en_cours')
     and id <> new.id;
  if v_actifs >= 2 then
    raise exception 'Vous avez déjà 2 rendus en préparation (film, visite ou image). Attendez qu''un des deux se termine.'
      using errcode = 'P0001', hint = 'studio_jobs_plafond';
  end if;
  return new;
end;
$$;

revoke execute on function public._studio_jobs_plafond() from public, anon, authenticated;

commit;

-- Vérification après application (lecture seule) :
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'studio_jobs_type_check';
--   select public._studio_job_options_valides('image', '{"vues":["face","trois_quarts_gauche"],"ambiance":"jour"}'); -- true
--   select public._studio_job_options_valides('image', '{"ambiance":"nuit"}');                                     -- false
--   select public._studio_job_options_valides('image', '{"vues":["face","face"]}');                                 -- false
--   select public._studio_job_options_valides('image', '{"qualite":"apercu"}');                                     -- true
--   select public._studio_job_options_valides('image', '{"qualite":"8k"}');                                         -- false
