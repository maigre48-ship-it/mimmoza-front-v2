-- =============================================================================
-- 31/10/2026 — MimmozIA « de la prospection à la conception 3D » : base de données
-- =============================================================================
-- Contrat : CONTRAT_CONCEPTION.md, section 1 (fait foi). NON appliquée.
-- Prérequis : 20261030_agent_autonome.sql (appliquée en prod le 30/10/2026).
--
-- Contenu
--   1. agent_missions.type : ajout de 'conception' (contrainte réelle en prod :
--      agent_missions_type_check, lue le 30/10/2026).
--   2. Tables agent_conceptions (dossier de conception d'un terrain) et
--      agent_conception_versions (versions enregistrées du modèle, jamais
--      modifiées) + fonction de validation des règles PLU (RegleConception).
--   3. Déclencheurs : champs sensibles figés (user_id, mission_id,
--      mission_origine_id, idu, version_courante) pour l'utilisateur ; missions
--      liées du même propriétaire ; numérotation n des versions sans trou ni
--      doublon ; versions immuables ; version_courante tenue par le serveur.
--   4. RLS et droits : droits par défaut de Supabase retirés, puis le strict
--      nécessaire (lecture / écriture par le propriétaire, colonnes listées).
--   5. Bucket privé agent-conception + politiques storage.objects.
--   6. Temps réel sur les deux tables.
--
-- « L'appel vient-il du serveur ? » : test écrit EN LIGNE dans chaque
--   déclencheur, comme dans 20261030 :
--     current_user in ('service_role', 'postgres', 'supabase_admin')
--
-- REJOUABLE : create … if not exists, create or replace, déclencheurs,
-- politiques créés seulement s'ils n'existent pas, contrainte de type
-- remplacée seulement si 'conception' n'y figure pas encore. Aucun DELETE.
-- Un seul DROP : « drop constraint » de agent_missions_type_check, recréée
-- DANS LA MÊME instruction ALTER TABLE avec la liste élargie (aucune fenêtre
-- sans contrainte ; les lignes existantes la respectent déjà).
-- =============================================================================


-- ── 1. agent_missions.type : + 'conception' ─────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agent_missions'::regclass
                    and conname = 'agent_missions_type_check'
                    and pg_get_constraintdef(oid) like '%''conception''%') then
    alter table public.agent_missions
      drop constraint if exists agent_missions_type_check,
      add constraint agent_missions_type_check
        check (type in ('prospection_fonciere', 'faisabilite', 'etude_marche', 'veille', 'libre', 'conception'));
  end if;
end $$;


-- ── 2. Tables ───────────────────────────────────────────────────────────────
-- Validation d'une liste de RegleConception (types communs, contrat §3) :
--   { cle: RegleCle, valeur: number|string|null, unite: string,
--     statut: 'confirme'|'estime'|'manquant', source: string non vide,
--     article?: string, texte?: string }
-- Une seule règle par clé (cle unique dans la liste).
-- « Jamais de règle inventée » : source obligatoire ; une règle « manquant »
-- n'a pas de valeur, une règle « confirme » ou « estime » en a une.
create or replace function public.agent_conception_regles_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p is null or jsonb_typeof(p) <> 'array' then false else (
     -- une seule règle par clé
     (select count(*) = count(distinct e->>'cle') from jsonb_array_elements(p) e)
     and not exists (
       select 1
         from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e->>'cle', '') not in ('hauteur_max_m', 'niveaux_max', 'emprise_sol_max_pct',
                                              'recul_voie_m', 'recul_limites_m', 'recul_limites_formule',
                                              'pleine_terre_min_pct', 'stationnement_par_logement',
                                              'mixite_sociale_pct')
           or coalesce(e->>'statut', '') not in ('confirme', 'estime', 'manquant')
           or coalesce(jsonb_typeof(e->'source'), '') <> 'string'
           or btrim(e->>'source') = ''
           or coalesce(jsonb_typeof(e->'unite'), '') <> 'string'
           or not (e ? 'valeur')
           or jsonb_typeof(e->'valeur') not in ('number', 'string', 'null')
           or (e->>'statut' = 'manquant' and jsonb_typeof(e->'valeur') <> 'null')
           or (e->>'statut' <> 'manquant' and jsonb_typeof(e->'valeur') = 'null')
           or (e ? 'article' and jsonb_typeof(e->'article') <> 'string')
           or (e ? 'texte' and jsonb_typeof(e->'texte') <> 'string')
     )) end
$$;
revoke execute on function public.agent_conception_regles_valides(jsonb) from public, anon;
-- Appelée par une contrainte check : l'utilisateur qui écrit doit pouvoir l'exécuter.
grant execute on function public.agent_conception_regles_valides(jsonb) to authenticated, service_role;

create table if not exists public.agent_conceptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  -- Mission de conception (type 'conception', même propriétaire).
  mission_id         uuid references public.agent_missions (id) on delete set null,
  -- Mission de prospection d'où vient le terrain (même propriétaire).
  mission_origine_id uuid references public.agent_missions (id) on delete set null,
  idu                text not null check (char_length(idu) between 1 and 64),
  commune            text check (commune is null or char_length(commune) <= 200),
  -- GeoJSON du contour + surface + source.
  parcelle           jsonb check (parcelle is null
                                  or (jsonb_typeof(parcelle) = 'object' and octet_length(parcelle::text) < 2097152)),
  -- Liste de RegleConception (contrat §3).
  regles_plu         jsonb not null default '[]'::jsonb
                     constraint agent_conceptions_regles_plu_check
                     check (octet_length(regles_plu::text) < 262144
                            and public.agent_conception_regles_valides(regles_plu)),
  -- { nb_logements, typologies:{T1..T5}, shab_cible_m2, sdp_cible_m2, gabarit, stationnement }
  programme          jsonb check (programme is null
                                  or (jsonb_typeof(programme) = 'object' and octet_length(programme::text) < 65536)),
  plan_source        text check (plan_source is null or plan_source in ('plan_fourni', 'dessin', 'auto')),
  -- Chemin dans le bucket agent-conception : <user_id>/<id>/…
  plan_fichier       text,
  statut             text not null default 'regles'
                     check (statut in ('regles', 'plan', 'modele', 'pret', 'archive')),
  version_courante   integer not null default 0 check (version_courante >= 0),
  cree_le            timestamptz not null default now(),
  maj_le             timestamptz not null default now(),
  constraint agent_conceptions_plan_fichier_check
    check (plan_fichier is null
           or (char_length(plan_fichier) <= 500
               and starts_with(plan_fichier, user_id::text || '/' || id::text || '/')
               and position('..' in plan_fichier) = 0))
);

comment on table public.agent_conceptions is
  'Dossiers de conception 3D d''un terrain (contrat CONTRAT_CONCEPTION.md §1). Lecture / écriture par le propriétaire (user_id, mission_id, mission_origine_id, idu, version_courante figés pour lui).';

create index if not exists agent_conceptions_user_maj_idx on public.agent_conceptions (user_id, maj_le desc);
create unique index if not exists agent_conceptions_mission_unique on public.agent_conceptions (mission_id)
  where mission_id is not null;
create index if not exists agent_conceptions_mission_origine_idx on public.agent_conceptions (mission_origine_id)
  where mission_origine_id is not null;

create table if not exists public.agent_conception_versions (
  id            uuid primary key default gen_random_uuid(),
  conception_id uuid not null references public.agent_conceptions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  n             integer not null check (n >= 1),
  origine       text not null check (origine in ('generation', 'modification_clic', 'modification_texte', 'plan_relu')),
  resume        text check (resume is null or char_length(resume) <= 2000),
  -- MetriquesModele (contrat §3).
  metriques     jsonb not null check (jsonb_typeof(metriques) = 'object' and octet_length(metriques::text) < 65536),
  -- Liste de ControleRegle.
  conformite    jsonb not null default '[]'::jsonb
                check (jsonb_typeof(conformite) = 'array' and octet_length(conformite::text) < 65536),
  -- Même schéma que terrains[i].bilan du rapport v2.
  bilan         jsonb check (bilan is null or (jsonb_typeof(bilan) = 'object' and octet_length(bilan::text) < 262144)),
  -- Chemin du projet studio sérialisé :
  --   <user_id>/<conception_id>/modele-v<n>[-<8 hex>].mstudio.json  (n = numéro de CETTE version)
  modele_ref    text,
  cree_le       timestamptz not null default now(),
  constraint agent_conception_versions_n_unique unique (conception_id, n),
  constraint agent_conception_versions_modele_ref_check
    check (modele_ref is null
           or (char_length(modele_ref) <= 500
               and starts_with(modele_ref, user_id::text || '/' || conception_id::text || '/')
               and position('..' in modele_ref) = 0
               and modele_ref ~ ('^[^/]+/[^/]+/modele-v' || n::text || '(-[a-f0-9]{8})?\.mstudio\.json$')))
);

comment on table public.agent_conception_versions is
  'Versions enregistrées du modèle d''une conception (métriques, conformité PLU, bilan). Insérées par le propriétaire ou le serveur, jamais modifiées.';

create index if not exists agent_conception_versions_user_idx on public.agent_conception_versions (user_id, cree_le desc);

alter table public.agent_conceptions         enable row level security;
alter table public.agent_conception_versions enable row level security;


-- ── 3. Déclencheurs ─────────────────────────────────────────────────────────
-- 3a. Conceptions : dates, champs figés pour l'utilisateur, missions liées du
--     même propriétaire (et de type 'conception' pour mission_id).
create or replace function public._agent_conceptions_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.version_courante := 0;          -- aucune version tant qu'aucune n'est enregistrée
    new.cree_le          := now();
    new.maj_le           := now();
  else
    new.maj_le  := now();
    new.id      := old.id;
    new.user_id := old.user_id;
    new.cree_le := old.cree_le;
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      new.mission_id         := old.mission_id;
      new.mission_origine_id := old.mission_origine_id;
      new.idu                := old.idu;
      new.version_courante   := old.version_courante;
      -- L'archivage est définitif pour l'utilisateur (le serveur peut désarchiver).
      if old.statut = 'archive' and new.statut <> 'archive' then
        raise exception 'Cette conception est archivée : elle ne peut pas être réactivée.'
          using errcode = '22023', hint = 'agent_conception_archivee';
      end if;
    end if;
  end if;

  if new.mission_id is not null
     and (tg_op = 'INSERT' or new.mission_id is distinct from old.mission_id) then
    if not exists (select 1 from public.agent_missions m
                    where m.id = new.mission_id and m.user_id = new.user_id and m.type = 'conception') then
      raise exception 'La mission de conception liée est introuvable (ou n''est pas une mission de conception).'
        using errcode = '22023', hint = 'agent_conception_mission';
    end if;
  end if;
  if new.mission_origine_id is not null
     and (tg_op = 'INSERT' or new.mission_origine_id is distinct from old.mission_origine_id) then
    if not exists (select 1 from public.agent_missions m
                    where m.id = new.mission_origine_id and m.user_id = new.user_id) then
      raise exception 'La mission d''origine liée est introuvable.'
        using errcode = '22023', hint = 'agent_conception_mission';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_conceptions_proteger() from public, anon, authenticated;

-- 3b. Versions : jamais modifiées ; à l'insertion, propriétaire = celui de la
--     conception, numéro n = dernier + 1 (fourni : doit valoir dernier + 1,
--     pour que le front connaisse le nom du fichier modele-v<n> avant l'envoi),
--     conception archivée = plus de version.
create or replace function public._agent_conception_versions_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_proprietaire uuid;
  v_statut       text;
  v_n            integer;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une version enregistrée ne se modifie pas.'
      using errcode = '22023', hint = 'agent_conception_version_figee';
  end if;

  -- Deux enregistrements simultanés ne prennent pas le même numéro.
  perform pg_advisory_xact_lock(hashtextextended('agent_conception:' || new.conception_id::text, 0));

  select c.user_id, c.statut into v_proprietaire, v_statut
    from public.agent_conceptions c where c.id = new.conception_id;
  if v_proprietaire is null
     or (current_user not in ('service_role', 'postgres', 'supabase_admin')
         and v_proprietaire is distinct from auth.uid()) then
    raise exception 'Conception introuvable.' using errcode = '42501';
  end if;
  if v_statut = 'archive' then
    raise exception 'Cette conception est archivée : aucune nouvelle version.'
      using errcode = '22023', hint = 'agent_conception_archivee';
  end if;

  new.user_id := v_proprietaire;
  new.cree_le := now();
  select coalesce(max(v.n), 0) + 1 into v_n
    from public.agent_conception_versions v where v.conception_id = new.conception_id;
  if new.n is null then
    new.n := v_n;
  elsif new.n <> v_n then
    raise exception 'Numéro de version attendu : % (reçu : %).', v_n, new.n
      using errcode = '23505', hint = 'agent_conception_version_numero';
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_conception_versions_proteger() from public, anon, authenticated;

-- 3c. Après une version : la conception pointe sur elle et passe en « modele »
--     si elle était encore en « regles » / « plan ». security definer : la mise
--     à jour passe pour le serveur (version_courante est figée pour l'utilisateur).
create or replace function public._agent_conception_versions_apres()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.agent_conceptions
     set version_courante = greatest(version_courante, new.n),
         statut = case when statut in ('regles', 'plan') then 'modele' else statut end
   where id = new.conception_id;
  return null;
end;
$$;
revoke execute on function public._agent_conception_versions_apres() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_conceptions'::regclass
                    and tgname = 'agent_conceptions_a_proteger') then
    create trigger agent_conceptions_a_proteger
      before insert or update on public.agent_conceptions
      for each row execute function public._agent_conceptions_proteger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_conception_versions'::regclass
                    and tgname = 'agent_conception_versions_a_proteger') then
    create trigger agent_conception_versions_a_proteger
      before insert or update on public.agent_conception_versions
      for each row execute function public._agent_conception_versions_proteger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_conception_versions'::regclass
                    and tgname = 'agent_conception_versions_b_apres') then
    create trigger agent_conception_versions_b_apres
      after insert on public.agent_conception_versions
      for each row execute function public._agent_conception_versions_apres();
  end if;
end $$;


-- ── 4. Politiques RLS et droits ─────────────────────────────────────────────
-- Les privilèges par défaut de Supabase donnent TOUT à anon et authenticated
-- sur les nouvelles tables : on les retire, puis on accorde le strict nécessaire.
-- Aucune suppression par l'utilisateur (archivage = statut 'archive') ; la
-- suppression du compte passe par la cascade depuis auth.users.
revoke all on table public.agent_conceptions, public.agent_conception_versions
  from public, anon, authenticated;

grant select on public.agent_conceptions, public.agent_conception_versions to authenticated;
grant insert (id, user_id, mission_id, mission_origine_id, idu, commune, parcelle, regles_plu,
              programme, plan_source, plan_fichier, statut)
  on public.agent_conceptions to authenticated;
grant update (commune, parcelle, regles_plu, programme, plan_source, plan_fichier, statut)
  on public.agent_conceptions to authenticated;
grant insert (id, conception_id, user_id, n, origine, resume, metriques, conformite, bilan, modele_ref)
  on public.agent_conception_versions to authenticated;

grant all on public.agent_conceptions, public.agent_conception_versions to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_conceptions'
                    and policyname = 'agent_conceptions_select_proprietaire') then
    create policy agent_conceptions_select_proprietaire on public.agent_conceptions
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_conceptions'
                    and policyname = 'agent_conceptions_insert_proprietaire') then
    create policy agent_conceptions_insert_proprietaire on public.agent_conceptions
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_conceptions'
                    and policyname = 'agent_conceptions_update_proprietaire') then
    create policy agent_conceptions_update_proprietaire on public.agent_conceptions
      for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_conception_versions'
                    and policyname = 'agent_conception_versions_select_proprietaire') then
    create policy agent_conception_versions_select_proprietaire on public.agent_conception_versions
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_conception_versions'
                    and policyname = 'agent_conception_versions_insert_proprietaire') then
    create policy agent_conception_versions_insert_proprietaire on public.agent_conception_versions
      for insert to authenticated
      with check (user_id = (select auth.uid())
                  and exists (select 1 from public.agent_conceptions c
                               where c.id = conception_id and c.user_id = (select auth.uid())));
  end if;
end $$;


-- ── 5. Bucket privé agent-conception ────────────────────────────────────────
-- Chemins : <user_id>/<conception_id>/plan-*.pdf|png|jpg|jpeg, reglement-*.pdf,
-- modele-v<n>[-<8 hex>].mstudio.json (suffixe unique facultatif, en minuscules). Propriétaire : lecture, dépôt, remplacement (sauf
-- les modèles modele-v<n>, figés comme les versions). Aucune suppression.
-- service_role contourne la RLS (partout). 50 Mo par fichier (règlements PLU).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-conception', 'agent-conception', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg', 'application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'agent_conception_lecture_proprietaire') then
    create policy agent_conception_lecture_proprietaire on storage.objects
      for select to authenticated
      using (bucket_id = 'agent-conception'
             and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'agent_conception_depot_proprietaire') then
    create policy agent_conception_depot_proprietaire on storage.objects
      for insert to authenticated
      with check (bucket_id = 'agent-conception'
                  and array_length(storage.foldername(name), 1) = 2
                  and (storage.foldername(name))[1] = (select auth.uid())::text
                  and exists (select 1 from public.agent_conceptions c
                               where c.id::text = (storage.foldername(name))[2]
                                 and c.user_id = (select auth.uid()))
                  and (storage.filename(name) ~* '^(plan-[a-z0-9._-]{1,120}\.(pdf|png|jpe?g)|reglement-[a-z0-9._-]{1,120}\.pdf)$'
                       or storage.filename(name) ~ '^modele-v[1-9][0-9]{0,5}(-[a-f0-9]{8})?\.mstudio\.json$')
                  and position('..' in name) = 0);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'agent_conception_remplacement_proprietaire') then
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
                  and storage.filename(name) ~* '^(plan-[a-z0-9._-]{1,120}\.(pdf|png|jpe?g)|reglement-[a-z0-9._-]{1,120}\.pdf)$'
                  and position('..' in name) = 0);
  end if;
end $$;


-- ── 6. Temps réel (si la publication existe) ────────────────────────────────
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agent_conceptions', 'agent_conception_versions'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
