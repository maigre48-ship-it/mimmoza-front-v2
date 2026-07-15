-- ============================================================================
-- 20260715_agent_commercial_04_commercial_activity_log.sql
-- Module « Agent commercial » — Phase 2 (socle données)
-- Journal d'activité append-only du module (gabarit calqué sur access_audit_log).
-- À coller dans le SQL Editor Supabase.
-- ============================================================================

create table if not exists public.commercial_activity_log (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,                                 -- ex : prospect_created, status_changed, email_sent
  entity      text,                                          -- ex : prospect, email, exclusion
  entity_id   uuid,                                          -- id de l'entité concernée (pas de FK : journal générique)
  actor_id    uuid references auth.users on delete set null default auth.uid(),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.commercial_activity_log is 'Agent commercial — journal d''activité append-only.';

create index if not exists idx_commercial_activity_log_entity     on public.commercial_activity_log (entity, entity_id);
create index if not exists idx_commercial_activity_log_event_type on public.commercial_activity_log (event_type);
create index if not exists idx_commercial_activity_log_created_at on public.commercial_activity_log (created_at desc);

alter table public.commercial_activity_log enable row level security;

create policy "commercial_activity_log_admin_all" on public.commercial_activity_log
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ROLLBACK
-- drop policy if exists "commercial_activity_log_admin_all" on public.commercial_activity_log;
-- drop table if exists public.commercial_activity_log;
