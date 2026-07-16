-- ============================================================================
-- 20260715_agent_commercial_08_commercial_emails.sql
-- Module « Agent commercial » — Phase 5A (table des emails)
-- Emails générés par l'IA (phase 5B) puis validés (humain) avant envoi (phase 6).
-- Le statut sépare génération et envoi : draft → pending_review → approved → sent.
-- À COLLER TEL QUEL dans le SQL Editor du dashboard Supabase.
-- Dépend de : 20260715_agent_commercial_01_commercial_prospects.sql
-- ============================================================================

create table if not exists public.commercial_emails (
  id                      uuid primary key default gen_random_uuid(),
  prospect_id             uuid not null references public.commercial_prospects (id) on delete cascade,
  kind                    text not null check (kind in (
                            'premier_contact', 'relance_1', 'relance_2', 'reponse_question',
                            'proposition_demo', 'proposition_essai', 'suivi_demo'
                          )),
  subject                 text,
  body                    text,
  internal_rationale      text,
  recommended_status      text,
  recommended_next_action text,
  status                  text not null default 'draft'
                            check (status in (
                              'draft', 'pending_review', 'approved', 'sent',
                              'failed', 'rejected', 'cancelled'
                            )),
  ai_model                text,
  tokens_in               integer,
  tokens_out              integer,
  generated_by            uuid references auth.users on delete set null default auth.uid(),
  reviewed_by             uuid references auth.users on delete set null,
  sent_at                 timestamptz,
  error                   text,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.commercial_emails is
  'Agent commercial — emails IA (draft → pending_review → approved → sent). Validation humaine obligatoire avant envoi.';

create index if not exists idx_commercial_emails_status      on public.commercial_emails (status);
create index if not exists idx_commercial_emails_prospect_id on public.commercial_emails (prospect_id);
create index if not exists idx_commercial_emails_created_at  on public.commercial_emails (created_at desc);

-- Maintien de updated_at via la fonction partagée public.set_updated_at().
create trigger trg_commercial_emails_updated_at
  before update on public.commercial_emails
  for each row execute function public.set_updated_at();

alter table public.commercial_emails enable row level security;

create policy "commercial_emails_admin_all" on public.commercial_emails
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ROLLBACK
-- drop policy if exists "commercial_emails_admin_all" on public.commercial_emails;
-- drop trigger if exists trg_commercial_emails_updated_at on public.commercial_emails;
-- drop table if exists public.commercial_emails;
