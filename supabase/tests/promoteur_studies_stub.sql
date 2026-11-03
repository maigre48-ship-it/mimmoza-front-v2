-- =============================================================================
-- Bouchon de public.promoteur_studies pour tester 20261101_agent_conception_etude.sql
-- sur un PostgreSQL local vierge. NE PAS appliquer en production.
--
-- Aucune migration du dépôt ne crée cette table (créée hors dépôt). Schéma déduit de
-- src/spaces/promoteur/shared/promoteurStudy.types.ts (PromoteurStudy) et de
-- promoteurStudyService.ts (colonne implantation2d ajoutée à la main) ; NON relu en
-- production. La migration n'utilise que id, user_id et status.
-- Prérequis : agent_autonome_stub_supabase.sql (rôles, auth.users, auth.uid()).
-- =============================================================================
create table if not exists public.promoteur_studies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null default '',
  status         text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  foncier        jsonb, plu jsonb, conception jsonb, marche jsonb, risques jsonb, evaluation jsonb, bilan jsonb,
  implantation2d jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.promoteur_studies enable row level security;
drop policy if exists etudes_proprietaire on public.promoteur_studies;
create policy etudes_proprietaire on public.promoteur_studies for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
