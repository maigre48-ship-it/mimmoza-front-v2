-- ============================================================================
-- 20260715_agent_commercial_01_commercial_prospects.sql
-- Module « Agent commercial » — Phase 2 (socle données)
-- Table des prospects (marchands de biens). Sources : saisie manuelle + import CSV.
-- À COLLER TEL QUEL dans le SQL Editor du dashboard Supabase (aucun CLI requis).
-- ============================================================================

create table if not exists public.commercial_prospects (
  id                  uuid primary key default gen_random_uuid(),
  company_name        text not null,                         -- raison sociale
  first_name          text,                                  -- prénom
  last_name           text,                                  -- nom
  job_title           text,                                  -- fonction
  email               text,
  phone               text,                                  -- téléphone
  website             text,                                  -- site
  city                text,                                  -- ville
  department          text,                                  -- département
  zone                text,                                  -- zone géographique
  company_type        text,                                  -- type d'entreprise
  company_size        text,                                  -- taille
  source              text not null default 'manual'
                        check (source in ('manual', 'import')),
  notes               text,
  status              text not null default 'a_qualifier'
                        check (status in (
                          'a_qualifier', 'a_contacter', 'message_a_valider', 'contacte',
                          'relance_prevue', 'a_repondu', 'interesse', 'demonstration',
                          'essai', 'negociation', 'client', 'non_interesse', 'exclu'
                        )),
  score               smallint check (score between 0 and 100),
  last_interaction_at timestamptz,                            -- dernière interaction
  next_action         text,                                  -- prochaine action (libellé)
  next_action_at      timestamptz,                           -- échéance de la prochaine action
  opt_out             boolean not null default false,        -- opposition prospection (RGPD)
  metadata            jsonb not null default '{}'::jsonb,
  created_by          uuid references auth.users on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table  public.commercial_prospects            is 'Agent commercial — prospects (saisie manuelle / import CSV).';
comment on column public.commercial_prospects.opt_out    is 'Opposition à la prospection (RGPD).';
comment on column public.commercial_prospects.next_action is 'Libellé de la prochaine action à mener.';

-- Index sur les colonnes filtrées et la FK propriétaire.
-- NB : index NON unique sur lower(email) — la déduplication « douce » est gérée
-- côté service en phase 3, pas par une contrainte bloquante ici.
create index if not exists idx_commercial_prospects_status         on public.commercial_prospects (status);
create index if not exists idx_commercial_prospects_source         on public.commercial_prospects (source);
create index if not exists idx_commercial_prospects_department     on public.commercial_prospects (department);
create index if not exists idx_commercial_prospects_zone           on public.commercial_prospects (zone);
create index if not exists idx_commercial_prospects_email_lower    on public.commercial_prospects (lower(email));
create index if not exists idx_commercial_prospects_created_by     on public.commercial_prospects (created_by);
create index if not exists idx_commercial_prospects_next_action_at on public.commercial_prospects (next_action_at);
create index if not exists idx_commercial_prospects_created_at     on public.commercial_prospects (created_at desc);

-- RLS : une seule policy admin, calquée sur api_cache_admin_all / listing_duplicates_admin_only.
alter table public.commercial_prospects enable row level security;

create policy "commercial_prospects_admin_all" on public.commercial_prospects
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- Maintien automatique de updated_at : réutilise la fonction partagée
-- public.set_updated_at() (déjà présente en base, utilisée par 18 tables du
-- projet, ex. trg_admin_users_updated_at). Ne PAS créer de fonction dédiée.
create trigger trg_commercial_prospects_updated_at
  before update on public.commercial_prospects
  for each row execute function public.set_updated_at();

-- ROLLBACK
-- drop trigger if exists trg_commercial_prospects_updated_at on public.commercial_prospects;
-- drop policy if exists "commercial_prospects_admin_all" on public.commercial_prospects;
-- drop table if exists public.commercial_prospects;
