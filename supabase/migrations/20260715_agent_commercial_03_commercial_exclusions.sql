-- ============================================================================
-- 20260715_agent_commercial_03_commercial_exclusions.sql
-- Module « Agent commercial » — Phase 2 (socle données)
-- Liste d'exclusion (ne jamais prospecter) : par email, domaine ou SIREN.
-- Table append-only (pas de updated_at). À coller dans le SQL Editor Supabase.
-- ============================================================================

create table if not exists public.commercial_exclusions (
  id          uuid primary key default gen_random_uuid(),
  email       text,
  domain      text,
  siren       text,
  reason      text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  -- Au moins un critère d'exclusion doit être renseigné.
  constraint commercial_exclusions_at_least_one
    check (num_nonnulls(email, domain, siren) >= 1)
);

comment on table public.commercial_exclusions is 'Agent commercial — liste d''exclusion (email / domaine / SIREN).';

create index if not exists idx_commercial_exclusions_email_lower on public.commercial_exclusions (lower(email));
create index if not exists idx_commercial_exclusions_domain      on public.commercial_exclusions (lower(domain));
create index if not exists idx_commercial_exclusions_siren       on public.commercial_exclusions (siren);
create index if not exists idx_commercial_exclusions_created_at  on public.commercial_exclusions (created_at desc);

alter table public.commercial_exclusions enable row level security;

create policy "commercial_exclusions_admin_all" on public.commercial_exclusions
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ROLLBACK
-- drop policy if exists "commercial_exclusions_admin_all" on public.commercial_exclusions;
-- drop table if exists public.commercial_exclusions;
