-- =============================================================================
-- 22/10/2026 — Suivi des erreurs sans service externe (table client_errors)
-- =============================================================================
--
-- Pourquoi
-- --------
-- Aucune erreur du site n'était collectée : une exception en production n'était
-- vue que si un client prenait la peine d'écrire. Pas de compte Sentry possible
-- pour l'instant → on stocke dans Postgres, avec des garde-fous.
--
-- Contenu
-- -------
--   1. public.client_errors          — une ligne par erreur (dé-dupliquée) ;
--   2. public.report_client_error()  — SEULE voie d'écriture pour le navigateur
--                                      (anon + authenticated), bornée : tailles,
--                                      débit par utilisateur / IP hachée, débit
--                                      global, dé-duplication par empreinte ;
--   3. public.admin_client_errors_groupes() — lecture groupée pour la page
--                                      admin « Erreurs » (RLS : admins seuls) ;
--   4. public.purge_client_errors()  — rétention 90 jours (cron proposé en bas,
--                                      NON programmé par cette migration).
-- Les Edge Functions écrivent directement (service_role) avec source = 'edge'
-- (supabase/functions/_shared/copilot-stream/journal.ts).
--
-- Données personnelles
-- --------------------
--   · aucune adresse IP stockée : seulement un hachage SHA-256 salé, tronqué,
--     qui change chaque jour, et uniquement pour les visiteurs non connectés
--     (sert au plafond de débit) ;
--   · route sans query string ni ancre ; contexte réduit à des scalaires
--     courts, filtrés côté client (src/lib/monitoring/core.ts) ET plafonné ici ;
--   · aucun contenu de formulaire, aucun jeton, aucun texte de conversation.
--
-- Rejouable : create if not exists / create or replace / drop policy if exists.
-- Aucun drop de table, aucun « revoke all ».
-- =============================================================================

create table if not exists public.client_errors (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  occurrences   integer     not null default 1,
  source        text        not null,
  level         text        not null default 'error',
  user_id       uuid        null references auth.users(id) on delete set null,
  ip_hash       text        null,
  route         text        not null default '/',
  message       text        not null,
  stack         text        null,
  user_agent    text        null,
  release       text        null,
  context       jsonb       not null default '{}'::jsonb,
  fingerprint   text        not null,
  constraint client_errors_source_chk check (source in ('front', 'react', 'promesse', 'copilot', 'edge')),
  constraint client_errors_level_chk  check (level in ('error', 'warning')),
  constraint client_errors_occ_chk    check (occurrences >= 1),
  constraint client_errors_tailles_chk check (
    char_length(message) <= 1000
    and char_length(coalesce(stack, '')) <= 4000
    and char_length(route) <= 300
    and char_length(coalesce(user_agent, '')) <= 300
    and char_length(coalesce(release, '')) <= 64
    and char_length(fingerprint) <= 64
  )
);

comment on table public.client_errors is
  'Erreurs du site (navigateur) et des Edge Functions. Écriture : report_client_error() ou service_role. Lecture : admins. Rétention 90 j (purge_client_errors).';

create index if not exists client_errors_created_idx     on public.client_errors (created_at desc);
create index if not exists client_errors_fp_seen_idx     on public.client_errors (fingerprint, last_seen_at desc);
create index if not exists client_errors_user_seen_idx   on public.client_errors (user_id, last_seen_at desc) where user_id is not null;
create index if not exists client_errors_ip_seen_idx     on public.client_errors (ip_hash, last_seen_at desc) where ip_hash is not null;

alter table public.client_errors enable row level security;

-- Lecture : administrateurs actifs uniquement. Aucune politique d'écriture :
-- le navigateur passe par la RPC ci-dessous, les Edge Functions par service_role.
drop policy if exists client_errors_select_admin on public.client_errors;
create policy client_errors_select_admin on public.client_errors
  for select to authenticated
  using (public.is_current_user_admin());

grant select on public.client_errors to authenticated;


-- ── 2. Écriture bornée depuis le navigateur ─────────────────────────────────
create or replace function public.report_client_error(
  p_source      text,
  p_route       text,
  p_message     text,
  p_stack       text    default null,
  p_user_agent  text    default null,
  p_release     text    default null,
  p_context     jsonb   default '{}'::jsonb,
  p_fingerprint text    default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_ip       text;
  v_ip_hash  text;
  v_source   text := lower(coalesce(p_source, ''));
  v_route    text;
  v_message  text;
  v_fp       text;
  v_context  jsonb;
  v_recent   integer;
  v_id       uuid;
begin
  -- Sources admises depuis le navigateur ('edge' est réservé au service_role).
  if v_source not in ('front', 'react', 'promesse', 'copilot') then
    return;
  end if;
  v_message := left(coalesce(nullif(btrim(p_message), ''), 'Erreur sans message'), 1000);

  -- IP hachée (visiteurs non connectés uniquement), sel quotidien : sert au
  -- plafond de débit, ne permet pas de suivre quelqu'un d'un jour à l'autre.
  if v_uid is null then
    begin
      v_ip := btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
    exception when others then
      v_ip := '';
    end;
    if v_ip <> '' then
      v_ip_hash := left(encode(extensions.digest(v_ip || '|client_errors|' || current_date::text, 'sha256'), 'hex'), 32);
    end if;
  end if;

  -- Débit global : protège la base d'une avalanche (boucle d'erreurs sur tous
  -- les postes après un mauvais déploiement — les premières suffisent).
  select count(*) into v_recent
    from public.client_errors
   where last_seen_at > now() - interval '1 minute';
  if v_recent >= 600 then
    return;
  end if;

  -- Débit par émetteur : 30 écritures / minute (insertions + incréments).
  if v_uid is not null or v_ip_hash is not null then
    select count(*) into v_recent
      from public.client_errors
     where last_seen_at > now() - interval '1 minute'
       and ((v_uid is not null and user_id = v_uid)
         or (v_uid is null and ip_hash = v_ip_hash));
    if v_recent >= 30 then
      return;
    end if;
  end if;

  v_route := left(coalesce(nullif(split_part(split_part(coalesce(p_route, ''), '?', 1), '#', 1), ''), '/'), 300);
  v_fp := case
            when p_fingerprint ~ '^[0-9a-f]{8,64}$' then p_fingerprint
            else md5(v_source || '|' || v_message)
          end;
  v_context := case
                 when p_context is null or jsonb_typeof(p_context) <> 'object' then '{}'::jsonb
                 when pg_column_size(p_context) > 4000 then jsonb_build_object('tronque', true)
                 else p_context
               end;

  -- Dé-duplication : même empreinte, même émetteur, dans l'heure → compteur.
  select id into v_id
    from public.client_errors
   where fingerprint = v_fp
     and source = v_source
     and last_seen_at > now() - interval '1 hour'
     and ((v_uid is not null and user_id = v_uid)
       or (v_uid is null and user_id is null and ip_hash is not distinct from v_ip_hash))
   order by last_seen_at desc
   limit 1;

  if v_id is not null then
    update public.client_errors
       set occurrences = occurrences + 1,
           last_seen_at = now()
     where id = v_id;
    return;
  end if;

  insert into public.client_errors
    (source, level, user_id, ip_hash, route, message, stack, user_agent, release, context, fingerprint)
  values
    (v_source, 'error', v_uid, v_ip_hash, v_route, v_message,
     left(p_stack, 4000), left(p_user_agent, 300), left(p_release, 64), v_context, v_fp);
exception when others then
  -- Le suivi des erreurs ne doit jamais renvoyer d'erreur au navigateur.
  return;
end;
$$;

comment on function public.report_client_error(text, text, text, text, text, text, jsonb, text) is
  'Signalement d''une erreur navigateur (anon + authenticated). Borné : tailles, 30/min par émetteur, 600/min global, dé-duplication horaire par empreinte.';

grant execute on function public.report_client_error(text, text, text, text, text, text, jsonb, text) to anon, authenticated, service_role;


-- ── 3. Lecture groupée pour la page admin « Erreurs » ───────────────────────
-- SECURITY INVOKER : la RLS de client_errors s'applique (admins seuls). Un
-- non-admin reçoit simplement zéro ligne.
create or replace function public.admin_client_errors_groupes(
  p_jours  integer default 7,
  p_source text    default null
)
returns table (
  fingerprint        text,
  source             text,
  level              text,
  message            text,
  route              text,
  occurrences        bigint,
  utilisateurs       bigint,
  premiere           timestamptz,
  derniere           timestamptz,
  release            text,
  exemple_id         uuid,
  exemple_stack      text,
  exemple_context    jsonb,
  exemple_user_agent text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with fenetre as (
    select *
      from public.client_errors
     where last_seen_at > now() - make_interval(days => greatest(1, least(coalesce(p_jours, 7), 90)))
       and (p_source is null
         or (p_source = 'front' and source <> 'edge')
         or source = p_source)
  ),
  derniers as (
    select distinct on (fingerprint) fingerprint, id, stack, context, user_agent, release, route, message, source, level
      from fenetre
     order by fingerprint, last_seen_at desc
  )
  select f.fingerprint,
         d.source,
         d.level,
         d.message,
         d.route,
         sum(f.occurrences)::bigint                         as occurrences,
         count(distinct coalesce(f.user_id::text, f.ip_hash))::bigint as utilisateurs,
         min(f.created_at)                                  as premiere,
         max(f.last_seen_at)                                as derniere,
         d.release,
         d.id, d.stack, d.context, d.user_agent
    from fenetre f
    join derniers d using (fingerprint)
   group by f.fingerprint, d.source, d.level, d.message, d.route, d.release, d.id, d.stack, d.context, d.user_agent
   order by max(f.last_seen_at) desc
   limit 500;
$$;

grant execute on function public.admin_client_errors_groupes(integer, text) to authenticated, service_role;


-- ── 4. Rétention : 90 jours ─────────────────────────────────────────────────
create or replace function public.purge_client_errors(p_jours integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.client_errors
   where last_seen_at < now() - make_interval(days => greatest(7, coalesce(p_jours, 90)));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.purge_client_errors(integer) from public, anon, authenticated;
grant execute on function public.purge_client_errors(integer) to service_role;

-- Cron PROPOSÉ (non appliqué par cette migration) — chaque nuit à 03 h 17 UTC :
--   select cron.schedule('purge-client-errors', '17 3 * * *',
--                        $$select public.purge_client_errors(90)$$);

-- ── Ajout lors de l'application (22/10/2026) : défense en profondeur ─────────
-- La RLS bloque déjà toute écriture directe ; on retire aussi les droits hérités
-- des privilèges par défaut de Supabase.
revoke insert, update, delete on public.client_errors from anon, authenticated;
revoke select on public.client_errors from anon;
