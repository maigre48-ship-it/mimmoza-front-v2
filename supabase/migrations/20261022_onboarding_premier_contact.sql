-- =============================================================================
-- 22/10/2026 — Premier contact guidé (page /mimmozia)
-- =============================================================================
-- Une ligne par compte, écrite par le compte lui-même (RLS « chacun la sienne ») :
--   profil              profil déclaré dans l'encart d'accueil (facultatif)
--   encart_ferme_le     l'encart « Bien démarrer » a été fermé
--   checklist_fermee_le la checklist a été fermée (ou terminée)
--   termine_le          onboarding terminé (encart fermé ET checklist finie/fermée)
--   etapes              étapes constatées par l'interface, ex. {"export_pdf": "2026-10-22T…"}
-- Rien de sensible : aucune donnée de facturation, aucun droit d'accès.
-- REJOUABLE : aucun DROP, aucun REVOKE ALL. NON APPLIQUÉE à la date du commit.
-- Tant qu'elle n'est pas appliquée, l'interface se replie sur le stockage local.
-- =============================================================================

create table if not exists public.user_onboarding (
  user_id              uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  profil               text check (profil is null or profil in ('promoteur', 'marchand', 'particulier', 'autre')),
  encart_ferme_le      timestamptz,
  checklist_fermee_le  timestamptz,
  termine_le           timestamptz,
  etapes               jsonb not null default '{}'::jsonb,
  cree_le              timestamptz not null default now(),
  maj_le               timestamptz not null default now()
);

comment on table public.user_onboarding is
  'Premier contact guidé de /mimmozia : profil déclaré, encart et checklist fermés, étapes constatées. Une ligne par compte.';

alter table public.user_onboarding enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_onboarding'
                 and policyname = 'user_onboarding lecture de la sienne') then
    create policy "user_onboarding lecture de la sienne" on public.user_onboarding
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_onboarding'
                 and policyname = 'user_onboarding création de la sienne') then
    create policy "user_onboarding création de la sienne" on public.user_onboarding
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_onboarding'
                 and policyname = 'user_onboarding modification de la sienne') then
    create policy "user_onboarding modification de la sienne" on public.user_onboarding
      for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

revoke insert, update, delete on public.user_onboarding from anon;
revoke delete on public.user_onboarding from authenticated;
grant select, insert, update on public.user_onboarding to authenticated;
