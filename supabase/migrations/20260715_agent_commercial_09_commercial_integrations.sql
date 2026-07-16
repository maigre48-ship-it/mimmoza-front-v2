-- ============================================================================
-- 20260715_agent_commercial_09_commercial_integrations.sql
-- Module « Agent commercial » — Phase 6A (connexion Google Workspace / OAuth)
-- Stockage SERVEUR des jetons OAuth. Ces jetons ne sont JAMAIS lus par le front :
-- seule une Edge Function (service-role) y accède ; le front passe par
-- agent-commercial-integration-status qui ne renvoie AUCUN jeton.
-- À COLLER TEL QUEL dans le SQL Editor du dashboard Supabase.
-- ============================================================================

create table if not exists public.commercial_integrations (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'google' check (provider in ('google')),
  account_email     text,
  send_as_email     text,
  refresh_token     text,
  access_token      text,
  token_expires_at  timestamptz,
  scopes            text[],
  status            text not null default 'disconnected'
                      check (status in ('connected', 'disconnected', 'error')),
  last_sync_at      timestamptz,
  last_error        text,
  metadata          jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Une seule intégration par provider (upsert on conflict provider).
  constraint commercial_integrations_provider_unique unique (provider)
);

comment on table public.commercial_integrations is
  'Agent commercial — jetons OAuth (Google). Jamais lus par le front (Edge Function service-role uniquement).';

-- Maintien de updated_at via la fonction partagée public.set_updated_at().
create trigger trg_commercial_integrations_updated_at
  before update on public.commercial_integrations
  for each row execute function public.set_updated_at();

alter table public.commercial_integrations enable row level security;

create policy "commercial_integrations_admin_all" on public.commercial_integrations
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ROLLBACK
-- drop policy if exists "commercial_integrations_admin_all" on public.commercial_integrations;
-- drop trigger if exists trg_commercial_integrations_updated_at on public.commercial_integrations;
-- drop table if exists public.commercial_integrations;
