-- ============================================================================
-- 20260715_agent_commercial_02_commercial_pipeline_events.sql
-- Module « Agent commercial » — Phase 2 (socle données)
-- Historisation des transitions de statut d'un prospect dans le pipeline.
-- Table append-only (pas de updated_at). À coller dans le SQL Editor Supabase.
-- Dépend de : 20260715_agent_commercial_01_commercial_prospects.sql
-- ============================================================================

create table if not exists public.commercial_pipeline_events (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.commercial_prospects (id) on delete cascade,
  from_status  text check (from_status in (
                 'a_qualifier', 'a_contacter', 'message_a_valider', 'contacte',
                 'relance_prevue', 'a_repondu', 'interesse', 'demonstration',
                 'essai', 'negociation', 'client', 'non_interesse', 'exclu'
               )),
  to_status    text not null check (to_status in (
                 'a_qualifier', 'a_contacter', 'message_a_valider', 'contacte',
                 'relance_prevue', 'a_repondu', 'interesse', 'demonstration',
                 'essai', 'negociation', 'client', 'non_interesse', 'exclu'
               )),
  note         text,
  metadata     jsonb not null default '{}'::jsonb,
  moved_by     uuid references auth.users on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

comment on table public.commercial_pipeline_events is 'Agent commercial — journal des transitions de statut du pipeline.';

create index if not exists idx_commercial_pipeline_events_prospect_id on public.commercial_pipeline_events (prospect_id);
create index if not exists idx_commercial_pipeline_events_to_status   on public.commercial_pipeline_events (to_status);
create index if not exists idx_commercial_pipeline_events_created_at  on public.commercial_pipeline_events (created_at desc);

alter table public.commercial_pipeline_events enable row level security;

create policy "commercial_pipeline_events_admin_all" on public.commercial_pipeline_events
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ROLLBACK
-- drop policy if exists "commercial_pipeline_events_admin_all" on public.commercial_pipeline_events;
-- drop table if exists public.commercial_pipeline_events;
