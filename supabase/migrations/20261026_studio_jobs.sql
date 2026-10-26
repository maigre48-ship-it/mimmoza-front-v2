-- =============================================================================
-- 26/10/2026 — File de travaux du Studio : « Film ou visite 360° en 3 clics »
-- =============================================================================
-- Contrat : docs/studio/CONTRAT_FILM_VISITE.md (fait foi).
--
-- 1. Table public.studio_jobs : un travail = un film ou une visite 360° demandé
--    depuis l'Espace 3D de MimmozIA. Le Studio (poste du fondateur, puis machine
--    distante) prend les travaux en attente, les calcule et dépose le résultat
--    dans le stockage.
-- 2. Sécurité (RLS + déclencheur) :
--    · l'utilisateur lit SES travaux, en crée pour lui-même et peut les annuler ;
--    · à la création, statut forcé « en_attente » et tous les champs de suivi
--      remis à zéro (progression, étape, résultat, erreur, worker, dates) ;
--    · à la modification, seul le passage à « annule » d'un travail actif lui
--      est permis ; tout le reste est réécrit avec l'ancienne valeur ;
--    · plafond : 2 travaux actifs (en attente ou en cours) par utilisateur ;
--    · pas de suppression (aucune politique DELETE).
-- 3. Fonctions du worker (service_role uniquement) : prendre, avancer,
--    terminer, échouer. Un travail annulé n'est jamais « ressuscité ».
-- 4. Stockage : bucket privé « studio-rendus » (lecture du propriétaire, par URL
--    signée) et bucket public « visites » (lecture par URL publique directe).
-- 5. Temps réel : la table est ajoutée à la publication supabase_realtime si
--    elle existe (le front sonde aussi toutes les 5 s, au cas où).
--
-- REJOUABLE : create … if not exists, create or replace, déclencheurs et
-- politiques créés seulement s'ils n'existent pas, buckets « on conflict do
-- nothing ». Aucun DROP, aucun DELETE, aucun REVOKE ALL.
-- =============================================================================

create table if not exists public.studio_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id text,
  type            text not null check (type in ('film', 'visite360')),
  statut          text not null default 'en_attente'
                  check (statut in ('en_attente', 'en_cours', 'termine', 'echec', 'annule')),
  progression     integer not null default 0 check (progression between 0 and 100),
  etape           text,
  fiche           jsonb not null check (jsonb_typeof(fiche) = 'object'),
  options         jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  resultat        jsonb,
  elements_omis   jsonb not null default '[]'::jsonb check (jsonb_typeof(elements_omis) = 'array'),
  erreur          text,
  worker_id       text,
  cree_le         timestamptz not null default now(),
  maj_le          timestamptz not null default now(),
  demarre_le      timestamptz,
  termine_le      timestamptz
);

comment on table public.studio_jobs is
  'File des films et visites 360° calculés par le Studio (contrat CONTRAT_FILM_VISITE.md).';

create index if not exists studio_jobs_user_cree_idx
  on public.studio_jobs (user_id, cree_le desc);
create index if not exists studio_jobs_conversation_idx
  on public.studio_jobs (user_id, conversation_id, cree_le desc);
create index if not exists studio_jobs_attente_idx
  on public.studio_jobs (cree_le) where statut = 'en_attente';

alter table public.studio_jobs enable row level security;

-- ── Options : seules les valeurs prévues au contrat sont acceptées ──────────
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
    else false
  end;
$$;

-- ── Déclencheur de protection des champs serveur (comme api_keys) ───────────
create or replace function public._studio_jobs_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.maj_le := now();
  end if;

  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public._studio_job_options_valides(new.type, new.options) then
      raise exception 'Options du travail invalides.' using errcode = '22023';
    end if;
    new.id          := gen_random_uuid();
    new.statut      := 'en_attente';
    new.progression := 0;
    new.etape       := null;
    new.resultat    := null;
    new.elements_omis := '[]'::jsonb;
    new.erreur      := null;
    new.worker_id   := null;
    new.cree_le     := now();
    new.maj_le      := now();
    new.demarre_le  := null;
    new.termine_le  := null;
    return new;
  end if;

  -- UPDATE par l'utilisateur : seule l'annulation d'un travail actif est permise.
  if new.statut = 'annule' and old.statut in ('en_attente', 'en_cours') then
    new.statut     := 'annule';
    new.termine_le := now();
    new.etape      := 'Annulé à votre demande';
  else
    new.statut     := old.statut;
    new.termine_le := old.termine_le;
    new.etape      := old.etape;
  end if;
  new.id              := old.id;
  new.user_id         := old.user_id;
  new.conversation_id := old.conversation_id;
  new.type            := old.type;
  new.progression     := old.progression;
  new.fiche           := old.fiche;
  new.options         := old.options;
  new.resultat        := old.resultat;
  new.elements_omis   := old.elements_omis;
  new.erreur          := old.erreur;
  new.worker_id       := old.worker_id;
  new.cree_le         := old.cree_le;
  new.demarre_le      := old.demarre_le;
  return new;
end;
$$;

comment on function public._studio_jobs_proteger() is
  'Empêche un utilisateur de modifier le suivi de ses travaux Studio (seul le worker le peut) ; seule l''annulation lui est permise.';

-- ── Plafond : 2 travaux actifs par utilisateur ──────────────────────────────
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
    raise exception 'Vous avez déjà 2 films ou visites en préparation. Attendez qu''un des deux se termine.'
      using errcode = 'P0001', hint = 'studio_jobs_plafond';
  end if;
  return new;
end;
$$;

revoke execute on function public._studio_jobs_plafond() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.studio_jobs'::regclass
                    and tgname = 'studio_jobs_a_proteger') then
    create trigger studio_jobs_a_proteger
      before insert or update on public.studio_jobs
      for each row execute function public._studio_jobs_proteger();
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.studio_jobs'::regclass
                    and tgname = 'studio_jobs_b_plafond') then
    create trigger studio_jobs_b_plafond
      before insert on public.studio_jobs
      for each row execute function public._studio_jobs_plafond();
  end if;
end $$;

-- ── Politiques RLS ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'studio_jobs' and policyname = 'studio_jobs_select_proprietaire') then
    create policy studio_jobs_select_proprietaire on public.studio_jobs
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'studio_jobs' and policyname = 'studio_jobs_insert_proprietaire') then
    create policy studio_jobs_insert_proprietaire on public.studio_jobs
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'studio_jobs' and policyname = 'studio_jobs_update_proprietaire') then
    create policy studio_jobs_update_proprietaire on public.studio_jobs
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;

grant select, insert, update on public.studio_jobs to authenticated;
grant all on public.studio_jobs to service_role;

-- ── Fonctions du worker (service_role) ──────────────────────────────────────
create or replace function public.studio_job_prendre(p_worker text, p_types text[])
returns public.studio_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.studio_jobs;
begin
  select * into v_job
    from public.studio_jobs
   where statut = 'en_attente'
     and type = any (coalesce(p_types, array['film', 'visite360']))
   order by cree_le
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;
  update public.studio_jobs
     set statut = 'en_cours', worker_id = p_worker, progression = 0,
         etape = 'Préparation de la scène', demarre_le = now()
   where id = v_job.id
   returning * into v_job;
  return v_job;
end;
$$;

-- Renvoie false si le travail n'est plus en cours (annulé par l'utilisateur) :
-- le worker doit alors s'arrêter.
create or replace function public.studio_job_avancer(p_id uuid, p_progression integer, p_etape text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.studio_jobs
     set progression = greatest(0, least(100, coalesce(p_progression, progression))),
         etape = coalesce(p_etape, etape)
   where id = p_id and statut = 'en_cours';
  return found;
end;
$$;

create or replace function public.studio_job_terminer(p_id uuid, p_resultat jsonb, p_elements_omis jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.studio_jobs
     set statut = 'termine', progression = 100, etape = 'Terminé',
         resultat = p_resultat,
         elements_omis = case when jsonb_typeof(p_elements_omis) = 'array' then p_elements_omis else '[]'::jsonb end,
         erreur = null, termine_le = now()
   where id = p_id and statut = 'en_cours';
  return found;
end;
$$;

create or replace function public.studio_job_echouer(p_id uuid, p_erreur text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.studio_jobs
     set statut = 'echec', erreur = left(coalesce(p_erreur, 'Erreur inconnue'), 2000),
         etape = 'Échec', termine_le = now()
   where id = p_id and statut in ('en_attente', 'en_cours');
  return found;
end;
$$;

revoke execute on function public.studio_job_prendre(text, text[]) from public, anon, authenticated;
revoke execute on function public.studio_job_avancer(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.studio_job_terminer(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.studio_job_echouer(uuid, text) from public, anon, authenticated;
grant execute on function public.studio_job_prendre(text, text[]) to service_role;
grant execute on function public.studio_job_avancer(uuid, integer, text) to service_role;
grant execute on function public.studio_job_terminer(uuid, jsonb, jsonb) to service_role;
grant execute on function public.studio_job_echouer(uuid, text) to service_role;

-- ── Temps réel (si la publication existe) ───────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'studio_jobs') then
    alter publication supabase_realtime add table public.studio_jobs;
  end if;
end $$;

-- ── Stockage ────────────────────────────────────────────────────────────────
-- studio-rendus : privé, <user_id>/<job_id>/film.mp4 et poster.jpg, écrits par
-- le worker (service_role), lus par le propriétaire via URL signée.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('studio-rendus', 'studio-rendus', false, array['video/mp4', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- visites : public, <visite_id>/manifest.json et pano-<n>.jpg (visite_id = UUID
-- aléatoire). Lecture par URL publique directe (bucket public). VOLONTAIREMENT
-- aucune politique SELECT sur storage.objects pour ce bucket : elle permettrait
-- de LISTER le bucket et donc de découvrir les identifiants des visites des
-- autres. Écriture réservée au worker (service_role).
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('visites', 'visites', true, array['application/json', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage'
                  and tablename = 'objects' and policyname = 'studio_rendus_select_proprietaire') then
    create policy studio_rendus_select_proprietaire on storage.objects
      for select to authenticated
      using (bucket_id = 'studio-rendus' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;
