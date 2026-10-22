-- =============================================================================
-- 22/10/2026 — E-mails de cycle de vie : journal d'envois + préférences
-- =============================================================================
-- Utilisé par la fonction Edge `emails-cycle-vie` (clé de service).
-- REJOUABLE : aucun DROP, aucun REVOKE ALL ; les politiques ne sont créées que
-- si elles n'existent pas encore. NON APPLIQUÉE à la date du commit.
--
-- 1. public.email_envois       — un envoi = une ligne ; unicité (user_id, type, cle_periode, mode)
--                                garantit l'idempotence (bienvenue « unique », quota « 2026-10 », …).
-- 2. public.email_preferences  — désinscription par catégorie (conseils, alertes_usage).
--                                Les e-mails transactionnels (compte) ne se désactivent pas.
-- 3. Cron quotidien proposé (pg_cron + pg_net), EN COMMENTAIRE en bas de fichier.
-- =============================================================================

-- ── 1. Journal des envois ────────────────────────────────────────────────────
create table if not exists public.email_envois (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null check (type in (
                    'bienvenue', 'premiere_analyse', 'rappel_sans_analyse',
                    'quota_80', 'quota_100', 'solde_bas')),
  cle_periode     text not null,
  mode            text not null default 'production' check (mode in ('production', 'essai')),
  transactionnel  boolean not null default false,
  destinataire    text,
  statut          text not null default 'en_cours' check (statut in ('en_cours', 'envoye', 'echec')),
  tentatives      integer not null default 1 check (tentatives >= 1),
  fournisseur_id  text,
  erreur          text,
  envoye_le       timestamptz not null default now(),
  maj_le          timestamptz not null default now(),
  constraint email_envois_unicite unique (user_id, type, cle_periode, mode)
);

create index if not exists email_envois_user_date_idx on public.email_envois (user_id, envoye_le desc);

comment on table public.email_envois is
  'E-mails de cycle de vie envoyés (ou réservés) par la fonction emails-cycle-vie. '
  'Unicité (user_id, type, cle_periode, mode) = idempotence. Écriture : clé de service uniquement.';

alter table public.email_envois enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_envois'
                 and policyname = 'email_envois lecture des siens') then
    create policy "email_envois lecture des siens" on public.email_envois
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

revoke insert, update, delete on public.email_envois from anon, authenticated;
grant select on public.email_envois to authenticated;

-- ── 2. Préférences d'e-mails ─────────────────────────────────────────────────
create table if not exists public.email_preferences (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  conseils       boolean not null default true,
  alertes_usage  boolean not null default true,
  maj_le         timestamptz not null default now()
);

comment on table public.email_preferences is
  'Préférences d''e-mails non transactionnels (conseils, alertes d''usage). Absence de ligne = tout accepté. '
  'Désinscription par lien signé (emails-cycle-vie) ou par l''utilisateur lui-même (RLS).';

alter table public.email_preferences enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_preferences'
                 and policyname = 'email_preferences lecture des siennes') then
    create policy "email_preferences lecture des siennes" on public.email_preferences
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_preferences'
                 and policyname = 'email_preferences création des siennes') then
    create policy "email_preferences création des siennes" on public.email_preferences
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_preferences'
                 and policyname = 'email_preferences modification des siennes') then
    create policy "email_preferences modification des siennes" on public.email_preferences
      for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

revoke insert, update, delete on public.email_preferences from anon;
revoke delete on public.email_preferences from authenticated;
grant select, insert, update on public.email_preferences to authenticated;

-- ── 3. Cron quotidien PROPOSÉ (à exécuter à la main, une fois la fonction déployée) ──
-- Le secret partagé est rangé dans Vault (jamais en clair dans cron.job) :
--
--   select vault.create_secret('<même valeur que EMAILS_CRON_SECRET>', 'emails_cron_secret');
--
--   select cron.schedule(
--     'emails-cycle-vie-quotidien',
--     '7 8 * * *',            -- 08:07 UTC = 10:07 à Paris en été, 09:07 en hiver
--     $cron$
--     select net.http_post(
--       url     := 'https://fwvrqngbafqdaekbdfnm.supabase.co/functions/v1/emails-cycle-vie',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'emails_cron_secret')
--       ),
--       body    := '{}'::jsonb,
--       timeout_milliseconds := 120000
--     );
--     $cron$
--   );
--
-- Retirer le cron : select cron.unschedule('emails-cycle-vie-quotidien');
