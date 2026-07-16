-- ============================================================================
-- 20260715_agent_commercial_07_commercial_knowledge_base.sql
-- Module « Agent commercial » — Phase 5A (base de connaissances)
-- Contexte fourni à l'IA pour rédiger les messages (présentation, offres, FAQ…).
-- À COLLER TEL QUEL dans le SQL Editor du dashboard Supabase.
-- ============================================================================

create table if not exists public.commercial_knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  section     text not null check (section in (
                'presentation', 'metiers_cibles', 'problemes', 'fonctionnalites',
                'benefices', 'limites', 'tarifs', 'faq', 'objections', 'liens', 'signature'
              )),
  title       text not null,
  content     text not null,
  status      text not null default 'brouillon'
                check (status in ('brouillon', 'valide', 'desactive')),
  position    integer not null default 0,
  metadata    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.commercial_knowledge_base is
  'Agent commercial — base de connaissances (contexte IA). Aucune donnée pré-remplie.';

create index if not exists idx_commercial_kb_section_status on public.commercial_knowledge_base (section, status);
create index if not exists idx_commercial_kb_status         on public.commercial_knowledge_base (status);

-- Maintien de updated_at via la fonction partagée public.set_updated_at().
create trigger trg_commercial_knowledge_base_updated_at
  before update on public.commercial_knowledge_base
  for each row execute function public.set_updated_at();

alter table public.commercial_knowledge_base enable row level security;

create policy "commercial_knowledge_base_admin_all" on public.commercial_knowledge_base
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ROLLBACK
-- drop policy if exists "commercial_knowledge_base_admin_all" on public.commercial_knowledge_base;
-- drop trigger if exists trg_commercial_knowledge_base_updated_at on public.commercial_knowledge_base;
-- drop table if exists public.commercial_knowledge_base;
