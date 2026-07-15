-- ============================================================================
-- 20260715_agent_commercial_06_archived_at.sql
-- Module « Agent commercial » — Phase 3 (archivage doux)
-- Colonne archived_at sur commercial_prospects. « Supprimer » = archiver
-- (réversible). Les listes filtrent archived_at IS NULL par défaut.
-- À COLLER TEL QUEL dans le SQL Editor du dashboard Supabase.
-- ============================================================================

alter table public.commercial_prospects
  add column if not exists archived_at timestamptz;

comment on column public.commercial_prospects.archived_at is
  'Archivage doux : date d''archivage, NULL = actif. Aucune suppression physique.';

create index if not exists idx_commercial_prospects_archived_at
  on public.commercial_prospects (archived_at);

-- ROLLBACK
-- drop index if exists idx_commercial_prospects_archived_at;
-- alter table public.commercial_prospects drop column if exists archived_at;
