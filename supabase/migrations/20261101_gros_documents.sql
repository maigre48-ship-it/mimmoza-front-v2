-- supabase/migrations/20261101_gros_documents.sql
-- =============================================================================
-- Gros documents dans MimmozIA (pièces jointes par stockage, lecture ciblée,
-- règlement PLU récupéré au Géoportail de l'urbanisme).
--
--   1. Bucket PRIVÉ copilot-pieces-jointes (50 Mo par fichier = maximum du plan Free
--      de Supabase Storage) + politiques :
--      chaque utilisateur lit / dépose / supprime dans SON dossier seulement.
--      Chemins : <uid>/<conversation_id | brouillon-<uuid>>/<AAAAMMJJ-HHMMSS>-<nom>
--                + <même chemin>.texte.json (texte extrait par le navigateur, PDF).
--   2. Table copilot_pieces_jointes : pièces RATTACHÉES à une conversation, pour
--      les re-transmettre au modèle aux tours suivants. Écriture : copilot-chat
--      (service_role). Lecture : propriétaire. Mise à jour : propriétaire (retrait).
--   3. Bucket PRIVÉ plu-reglements (règlements PDF téléchargés au GPU, cache).
--   4. Tables documents_pdf_cache / documents_pdf_pages : texte extrait page par
--      page (cache serveur, plu-reglement-v1). service_role uniquement.
--   5. Bucket agent-conception : le texte extrait du règlement déposé
--      (reglement-*.pdf.texte.json) est autorisé à côté du PDF.
--
-- Idempotent. Aucune suppression de données. À appliquer AVANT de déployer
-- copilot-chat et plu-reglement-v1.
-- =============================================================================


-- ── 1. Bucket copilot-pieces-jointes ────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('copilot-pieces-jointes', 'copilot-pieces-jointes', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'copilot_pj_lecture_proprietaire') then
    create policy copilot_pj_lecture_proprietaire on storage.objects
      for select to authenticated
      using (bucket_id = 'copilot-pieces-jointes'
             and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'copilot_pj_depot_proprietaire') then
    create policy copilot_pj_depot_proprietaire on storage.objects
      for insert to authenticated
      with check (bucket_id = 'copilot-pieces-jointes'
                  and array_length(storage.foldername(name), 1) = 2
                  and (storage.foldername(name))[1] = (select auth.uid())::text
                  -- 2e segment : brouillon (conversation pas encore créée) ou conversation DE l'utilisateur.
                  and ((storage.foldername(name))[2] ~ '^brouillon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       or exists (select 1 from public.copilot_conversations c
                                   where c.id::text = (storage.foldername(name))[2]
                                     and c.user_id = (select auth.uid())))
                  and storage.filename(name) ~ '^[0-9]{8}-[0-9]{6}-[a-z0-9._-]{1,120}(\.(png|jpe?g|gif|webp)|\.pdf(\.texte\.json)?)$'
                  and position('..' in name) = 0);
  end if;

  -- Pas d'UPDATE (un fichier ne se remplace pas) ; suppression par le propriétaire.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'copilot_pj_suppression_proprietaire') then
    create policy copilot_pj_suppression_proprietaire on storage.objects
      for delete to authenticated
      using (bucket_id = 'copilot-pieces-jointes'
             and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;


-- ── 2. Pièces jointes rattachées à une conversation ─────────────────────────
create table if not exists public.copilot_pieces_jointes (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  conversation_id         uuid not null references public.copilot_conversations (id) on delete cascade,
  bucket                  text not null default 'copilot-pieces-jointes'
                          check (bucket in ('copilot-pieces-jointes')),
  chemin                  text not null check (char_length(chemin) between 10 and 400),
  texte_chemin            text check (texte_chemin is null or texte_chemin = chemin || '.texte.json'),
  nom                     text not null check (char_length(nom) between 1 and 200),
  media_type              text not null
                          check (media_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  taille_octets           bigint not null check (taille_octets > 0 and taille_octets <= 52428800),
  nb_pages                integer check (nb_pages is null or nb_pages between 1 and 5000),
  statut                  text not null default 'active' check (statut in ('active', 'retiree')),
  -- Rang du message utilisateur (1 = premier) où la pièce a été jointe / relue.
  tour_ajout              integer not null default 0 check (tour_ajout >= 0),
  tour_derniere_lecture   integer not null default 0 check (tour_derniere_lecture >= 0),
  tokens_derniere_lecture integer check (tokens_derniere_lecture is null or tokens_derniere_lecture >= 0),
  -- { mode, pages, zone, description } de la dernière lecture.
  derniere_lecture        jsonb check (derniere_lecture is null
                                       or (jsonb_typeof(derniere_lecture) = 'object' and octet_length(derniere_lecture::text) < 16384)),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (conversation_id, chemin)
);

create index if not exists copilot_pieces_jointes_conversation_idx
  on public.copilot_pieces_jointes (conversation_id, statut);

alter table public.copilot_pieces_jointes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'copilot_pieces_jointes'
                    and policyname = 'copilot_pj_select_proprietaire') then
    create policy copilot_pj_select_proprietaire on public.copilot_pieces_jointes
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  -- Le propriétaire peut RETIRER une pièce de la conversation (statut 'retiree').
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'copilot_pieces_jointes'
                    and policyname = 'copilot_pj_update_proprietaire') then
    create policy copilot_pj_update_proprietaire on public.copilot_pieces_jointes
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;


-- ── 3. Bucket plu-reglements (cache des règlements GPU) ─────────────────────
-- Données publiques (Géoportail de l'urbanisme), mais bucket privé : seul
-- plu-reglement-v1 (service_role) y lit et écrit. 50 Mo par fichier (mémoire de l'isolate).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plu-reglements', 'plu-reglements', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ── 4. Texte extrait page par page (cache serveur) ──────────────────────────
create table if not exists public.documents_pdf_cache (
  id              uuid primary key default gen_random_uuid(),
  -- gpu:<id document GPU>:<fichier>  |  stockage:<bucket>/<chemin>:<taille>
  cle             text not null unique check (char_length(cle) between 5 and 600),
  source          text not null check (source in ('gpu', 'stockage')),
  bucket          text not null,
  chemin          text not null,
  taille_octets   bigint check (taille_octets is null or taille_octets > 0),
  nb_pages        integer check (nb_pages is null or nb_pages between 0 and 5000),
  pages_extraites integer not null default 0 check (pages_extraites >= 0),
  statut          text not null default 'a_extraire'
                  check (statut in ('a_extraire', 'en_cours', 'termine', 'echec')),
  -- GPU : document, idurba, du_type, territoire, date d'approbation, url source…
  meta            jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) < 32768),
  erreur          text check (erreur is null or char_length(erreur) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.documents_pdf_pages (
  cache_id uuid not null references public.documents_pdf_cache (id) on delete cascade,
  page     integer not null check (page >= 1),
  texte    text not null default '' check (char_length(texte) <= 60000),
  primary key (cache_id, page)
);

-- RLS active SANS politique : accessibles au seul service_role (Edge Functions).
alter table public.documents_pdf_cache enable row level security;
alter table public.documents_pdf_pages enable row level security;


-- ── 5. Bucket agent-conception : texte extrait du règlement ─────────────────
-- Mêmes politiques que 20261031_agent_conception.sql, avec en plus
-- reglement-*.pdf.texte.json (déposé par le navigateur à côté du PDF).
drop policy if exists agent_conception_depot_proprietaire on storage.objects;
create policy agent_conception_depot_proprietaire on storage.objects
  for insert to authenticated
  with check (bucket_id = 'agent-conception'
              and array_length(storage.foldername(name), 1) = 2
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and exists (select 1 from public.agent_conceptions c
                           where c.id::text = (storage.foldername(name))[2]
                             and c.user_id = (select auth.uid()))
              and (storage.filename(name) ~* '^(plan-[a-z0-9._-]{1,120}\.(pdf|png|jpe?g)|reglement-[a-z0-9._-]{1,120}\.pdf(\.texte\.json)?)$'
                   or storage.filename(name) ~ '^modele-v[1-9][0-9]{0,5}(-[a-f0-9]{8})?\.mstudio\.json$')
              and position('..' in name) = 0);

drop policy if exists agent_conception_remplacement_proprietaire on storage.objects;
create policy agent_conception_remplacement_proprietaire on storage.objects
  for update to authenticated
  using (bucket_id = 'agent-conception'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and storage.filename(name) !~* '^modele-v')
  with check (bucket_id = 'agent-conception'
              and array_length(storage.foldername(name), 1) = 2
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and exists (select 1 from public.agent_conceptions c
                           where c.id::text = (storage.foldername(name))[2]
                             and c.user_id = (select auth.uid()))
              and storage.filename(name) ~* '^(plan-[a-z0-9._-]{1,120}\.(pdf|png|jpe?g)|reglement-[a-z0-9._-]{1,120}\.pdf(\.texte\.json)?)$'
              and position('..' in name) = 0);
