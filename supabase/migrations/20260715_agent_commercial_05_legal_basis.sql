-- ============================================================================
-- 20260715_agent_commercial_05_legal_basis.sql
-- Module « Agent commercial » — Phase 3 (préalable)
-- Base légale de prospection (RGPD) sur commercial_prospects.
-- Complète opt_out (phase 2) : « consentement » OU « intérêt légitime ».
-- À COLLER TEL QUEL dans le SQL Editor du dashboard Supabase.
-- ============================================================================

alter table public.commercial_prospects
  add column if not exists legal_basis text not null default 'interet_legitime'
    check (legal_basis in ('interet_legitime', 'consentement'));

comment on column public.commercial_prospects.legal_basis is
  'Base légale de la prospection (RGPD) : interet_legitime | consentement.';

-- ROLLBACK
-- alter table public.commercial_prospects drop column if exists legal_basis;
