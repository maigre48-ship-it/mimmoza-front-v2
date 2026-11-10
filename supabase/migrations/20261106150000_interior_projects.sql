-- =============================================================================
-- 06/11/2026 — LOT INT-10 « Architecte d'intérieur dans le chat » : persistance
-- =============================================================================
-- ⚠️ FICHIER PRÉPARÉ, NON APPLIQUÉ. À relire puis appliquer par Albé.
-- Prérequis : 20260926_copilot_parcel_dossiers.sql (table copilot_parcel_dossiers).
--
-- interior_projects : un plan + un brief soumis à l'architecte d'intérieur
-- (Edge Function interior-architect-v1). Rattachement facultatif au dossier
-- parcellaire du chat (copilot_parcel_dossiers) — c'est la seule table « dossier
-- du bien » trouvée dans les migrations ; le rattachement est mis à NULL si le
-- dossier est supprimé (le projet intérieur reste à son propriétaire).
--
-- interior_variants : les variantes calculées pour un projet (une par graine),
-- avec le verdict du moteur, le plan aménagé (layout), le rapport du critique
-- et la feuille de style. `chosen` marque la variante retenue (au plus une par
-- projet, index unique partiel).
--
-- Sécurité :
--   · RLS : chaque utilisateur ne voit et n'écrit que SES lignes
--     (user_id = auth.uid()) ; un dossier ou un projet référencé doit lui
--     appartenir (vérifié à l'insertion et à la mise à jour) ;
--   · anon : aucun droit ; authenticated : select, insert, update, delete ;
--     service_role : tout (copilot-chat).
--
-- Rien n'écrit encore dans ces tables : la sauvegarde depuis copilot-chat ou
-- le front est un lot ultérieur.
--
-- REJOUABLE : create … if not exists, politiques créées seulement si absentes.
-- Aucun DROP, aucun DELETE.
-- =============================================================================

create table if not exists public.interior_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dossier_id  uuid references public.copilot_parcel_dossiers (id) on delete set null,
  conversation_id text check (conversation_id is null or char_length(conversation_id) <= 200),
  label       text check (label is null or char_length(label) <= 200),
  -- PlanInput du moteur (@mimmoza/interior-core) tel que reçu par interior-architect-v1.
  plan        jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) < 1048576),
  -- InteriorBrief validé (cible, occupants, style, gamme, contraintes).
  brief       jsonb not null check (jsonb_typeof(brief) = 'object' and octet_length(brief::text) < 65536),
  version_moteur text not null default '0.2.0' check (char_length(version_moteur) between 1 and 40),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.interior_projects is
  'Projets d''aménagement intérieur (lot INT-10) : plan PlanInput + brief soumis à interior-architect-v1, rattachement facultatif au dossier parcellaire.';

create index if not exists interior_projects_user_created_idx on public.interior_projects (user_id, created_at desc);
create index if not exists interior_projects_dossier_idx on public.interior_projects (dossier_id) where dossier_id is not null;

create table if not exists public.interior_variants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.interior_projects (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seed        integer not null check (seed between 0 and 1000000),
  verdict     text not null check (verdict in ('favorable', 'reserve', 'defavorable')),
  score       numeric check (score is null or (score >= 0 and score <= 100)),
  layout      jsonb not null check (jsonb_typeof(layout) = 'object' and octet_length(layout::text) < 2097152),
  rapport     jsonb not null check (jsonb_typeof(rapport) = 'object' and octet_length(rapport::text) < 2097152),
  style       jsonb not null check (jsonb_typeof(style) = 'object' and octet_length(style::text) < 1048576),
  -- Points d'eau supposés (« à confirmer ») de la variante.
  points_eau_supposes jsonb not null default '[]'::jsonb check (jsonb_typeof(points_eau_supposes) = 'array'),
  chosen      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint interior_variants_project_seed_unique unique (project_id, seed)
);

comment on table public.interior_variants is
  'Variantes calculées par interior-architect-v1 pour un projet intérieur (une par graine) ; chosen = variante retenue (au plus une par projet).';

create index if not exists interior_variants_project_idx on public.interior_variants (project_id, verdict, score desc);
create index if not exists interior_variants_user_idx on public.interior_variants (user_id, created_at desc);
create unique index if not exists interior_variants_un_seul_choix_idx on public.interior_variants (project_id) where chosen;

alter table public.interior_projects enable row level security;
alter table public.interior_variants enable row level security;

-- ── updated_at serveur ──────────────────────────────────────────────────────
create or replace function public._interior_projects_maj()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.interior_projects'::regclass
                    and tgname = 'interior_projects_maj') then
    create trigger interior_projects_maj
      before insert or update on public.interior_projects
      for each row execute function public._interior_projects_maj();
  end if;
end $$;

-- ── Politiques RLS : lignes du propriétaire uniquement ──────────────────────
do $$
begin
  -- interior_projects
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_projects' and policyname = 'interior_projects_select_proprietaire') then
    create policy interior_projects_select_proprietaire on public.interior_projects
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_projects' and policyname = 'interior_projects_insert_proprietaire') then
    create policy interior_projects_insert_proprietaire on public.interior_projects
      for insert to authenticated
      with check (
        user_id = (select auth.uid())
        and (dossier_id is null or exists (
              select 1 from public.copilot_parcel_dossiers d
               where d.id = dossier_id and d.user_id = (select auth.uid())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_projects' and policyname = 'interior_projects_update_proprietaire') then
    create policy interior_projects_update_proprietaire on public.interior_projects
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (
        user_id = (select auth.uid())
        and (dossier_id is null or exists (
              select 1 from public.copilot_parcel_dossiers d
               where d.id = dossier_id and d.user_id = (select auth.uid())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_projects' and policyname = 'interior_projects_delete_proprietaire') then
    create policy interior_projects_delete_proprietaire on public.interior_projects
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;

  -- interior_variants
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_variants' and policyname = 'interior_variants_select_proprietaire') then
    create policy interior_variants_select_proprietaire on public.interior_variants
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_variants' and policyname = 'interior_variants_insert_proprietaire') then
    create policy interior_variants_insert_proprietaire on public.interior_variants
      for insert to authenticated
      with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.interior_projects p
                     where p.id = project_id and p.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_variants' and policyname = 'interior_variants_update_proprietaire') then
    create policy interior_variants_update_proprietaire on public.interior_variants
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.interior_projects p
                     where p.id = project_id and p.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'interior_variants' and policyname = 'interior_variants_delete_proprietaire') then
    create policy interior_variants_delete_proprietaire on public.interior_variants
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

revoke all on public.interior_projects from anon;
revoke all on public.interior_variants from anon;
grant select, insert, update, delete on public.interior_projects to authenticated;
grant select, insert, update, delete on public.interior_variants to authenticated;
grant all on public.interior_projects to service_role;
grant all on public.interior_variants to service_role;
revoke all on function public._interior_projects_maj() from public;

-- Vérification après application (lecture seule) :
--   select relname, relrowsecurity from pg_class where oid in ('public.interior_projects'::regclass, 'public.interior_variants'::regclass);  -- true, true
--   select tablename, policyname, cmd from pg_policies where tablename in ('interior_projects', 'interior_variants') order by 1, 2;
