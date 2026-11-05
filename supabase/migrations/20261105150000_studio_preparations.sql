-- =============================================================================
-- 05/11/2026 — LOT E1 « Mimmo pilote le Studio » : 3D préparées par Mimmo
-- =============================================================================
-- Prérequis : 20261031_agent_conception.sql (table agent_conceptions).
--
-- Une ligne = le volume d'étude que Mimmo a calculé pour une conception
-- (copilot-chat, outil studio_preparer_3d), avec le MÊME code que le Dossier 3D
-- du chat (volumeParcelle + implantationProgramme). Le front l'ouvre en un clic
-- dans le Studio (« Ouvrir la 3D préparée ») ; un rendu peut en partir
-- (studio_lancer_rendu → studio_jobs).
--
-- Calcul déterministe : (user_id, empreinte) est UNIQUE — mêmes entrées, même
-- ligne (upsert). Une préparation n'est jamais modifiée par l'utilisateur :
-- seul le serveur (copilot-chat, service_role ou JWT de l'utilisateur pour son
-- propre compte) l'insère ; aucune politique UPDATE ni DELETE pour les
-- utilisateurs (suppression en cascade avec le compte ou la conception).
--
-- Sécurité :
--   · RLS : lecture et insertion par le propriétaire (user_id = auth.uid()) ;
--     la conception liée doit lui appartenir ;
--   · droits par défaut retirés à anon ; authenticated : select, insert,
--     update (nécessaire à l'upsert, cantonné par le déclencheur : seuls
--     conversation_id et maj_le changent, et seulement sur SA ligne).
--
-- REJOUABLE : create … if not exists, create or replace, politiques et
-- déclencheurs créés seulement s'ils n'existent pas. Aucun DROP, aucun DELETE.
-- =============================================================================

create table if not exists public.studio_preparations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conception_id   uuid references public.agent_conceptions (id) on delete cascade,
  conversation_id text check (conversation_id is null or char_length(conversation_id) <= 200),
  origine         text not null default 'chat' check (origine in ('chat', 'mission')),
  idu             text not null check (char_length(idu) between 1 and 64),
  -- sha256 (hex) du JSON canonique { version du calcul, conception, entrées }.
  empreinte       text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  version_calcul  text not null check (char_length(version_calcul) between 1 and 80),
  -- Entrées figées : parcelle (contour WGS84), règles de conception, programme.
  entree          jsonb not null check (jsonb_typeof(entree) = 'object' and octet_length(entree::text) < 2097152),
  -- VolumePropose (src/spaces/copilot/studio3d/volumeParcelle.ts).
  volume          jsonb not null check (jsonb_typeof(volume) = 'object' and octet_length(volume::text) < 2097152),
  -- Résumé chiffré et contrôles (verdicts) tels qu'annoncés par Mimmo.
  resume          jsonb not null check (jsonb_typeof(resume) = 'object' and octet_length(resume::text) < 262144),
  cree_le         timestamptz not null default now(),
  maj_le          timestamptz not null default now(),
  constraint studio_preparations_empreinte_unique unique (user_id, empreinte)
);

comment on table public.studio_preparations is
  'Volumes d''étude 3D préparés par Mimmo (lot E1) à partir d''une conception ; ouverts en un clic dans le Studio, source possible d''un rendu studio_jobs.';

create index if not exists studio_preparations_user_cree_idx on public.studio_preparations (user_id, cree_le desc);
create index if not exists studio_preparations_conception_idx on public.studio_preparations (conception_id, cree_le desc) where conception_id is not null;
create index if not exists studio_preparations_conversation_idx on public.studio_preparations (user_id, conversation_id, cree_le desc) where conversation_id is not null;

alter table public.studio_preparations enable row level security;

-- ── Déclencheur : une préparation est immuable pour l'utilisateur ───────────
-- À l'insertion : dates serveur. À la mise à jour (upsert d'un calcul identique) :
-- seuls conversation_id et maj_le changent ; tout le reste garde l'ancienne valeur.
create or replace function public._studio_preparations_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.cree_le := now();
    new.maj_le := now();
    return new;
  end if;
  new.maj_le := now();
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  new.id             := old.id;
  new.user_id        := old.user_id;
  new.conception_id  := old.conception_id;
  new.origine        := old.origine;
  new.idu            := old.idu;
  new.empreinte      := old.empreinte;
  new.version_calcul := old.version_calcul;
  new.entree         := old.entree;
  new.volume         := old.volume;
  new.resume         := old.resume;
  new.cree_le        := old.cree_le;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.studio_preparations'::regclass
                    and tgname = 'studio_preparations_a_proteger') then
    create trigger studio_preparations_a_proteger
      before insert or update on public.studio_preparations
      for each row execute function public._studio_preparations_proteger();
  end if;
end $$;

-- ── Politiques RLS ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'studio_preparations' and policyname = 'studio_preparations_select_proprietaire') then
    create policy studio_preparations_select_proprietaire on public.studio_preparations
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'studio_preparations' and policyname = 'studio_preparations_insert_proprietaire') then
    create policy studio_preparations_insert_proprietaire on public.studio_preparations
      for insert to authenticated
      with check (
        user_id = (select auth.uid())
        and (conception_id is null or exists (
              select 1 from public.agent_conceptions c
               where c.id = conception_id and c.user_id = (select auth.uid())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'studio_preparations' and policyname = 'studio_preparations_update_proprietaire') then
    create policy studio_preparations_update_proprietaire on public.studio_preparations
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;

revoke all on public.studio_preparations from anon;
grant select, insert, update on public.studio_preparations to authenticated;
grant all on public.studio_preparations to service_role;

-- Vérification après application (lecture seule) :
--   select relrowsecurity from pg_class where oid = 'public.studio_preparations'::regclass;  -- true
--   select policyname, cmd from pg_policies where tablename = 'studio_preparations' order by 1;
