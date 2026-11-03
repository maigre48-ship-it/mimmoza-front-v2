-- =============================================================================
-- Liaison explicite conception (agent_conceptions) ↔ étude promoteur (promoteur_studies).
-- Rejouable. À exécuter dans le SQL Editor Supabase (jamais « db push »), AVANT le déploiement du front.
--
-- Prérequis (vérifiés ci-dessous, la migration s'arrête sinon) :
--   * public.agent_conceptions (migration 20261031_agent_conception.sql) ;
--   * public.promoteur_studies(id uuid, user_id uuid, status text 'draft'|'active'|'archived').
--     Cette table n'est créée par AUCUNE migration du dépôt (créée hors dépôt, en production) :
--     son schéma minimal est documenté par supabase/tests/promoteur_studies_stub.sql.
-- =============================================================================
begin;

do $$
begin
  if to_regclass('public.agent_conceptions') is null then
    raise exception 'Prérequis manquant : public.agent_conceptions (appliquer 20261031_agent_conception.sql).';
  end if;
  if to_regclass('public.promoteur_studies') is null then
    raise exception 'Prérequis manquant : public.promoteur_studies.';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'promoteur_studies'
        and column_name in ('id', 'user_id', 'status')) <> 3 then
    raise exception 'Prérequis manquant : colonnes id, user_id, status de public.promoteur_studies.';
  end if;
end $$;

create table if not exists public.agent_conception_etude (
  conception_id uuid primary key references public.agent_conceptions(id) on delete cascade,
  etude_id uuid not null references public.promoteur_studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  maj_le timestamptz not null default now()
);
-- Suppressions en cascade depuis promoteur_studies : évite un parcours complet de la table.
create index if not exists agent_conception_etude_etude_idx on public.agent_conception_etude (etude_id);

alter table public.agent_conception_etude enable row level security;
revoke all on public.agent_conception_etude from public, anon, authenticated;
grant select on public.agent_conception_etude to authenticated;

drop policy if exists lecture_liaison_proprietaire on public.agent_conception_etude;
create policy lecture_liaison_proprietaire on public.agent_conception_etude for select to authenticated
using (user_id = (select auth.uid())
  and exists (select 1 from public.agent_conceptions c where c.id = conception_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.promoteur_studies e where e.id = etude_id and e.user_id = (select auth.uid())));

-- Seule cette fonction écrit : les deux propriétaires sont revérifiés en base,
-- conception archivée et étude archivée refusées ; p_etude_id null = suppression explicite.
create or replace function public.lier_conception_etude(p_conception_id uuid, p_etude_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_statut text; v_etude_statut text;
begin
  if v_user is null then raise exception 'Authentification requise'; end if;
  select c.user_id, c.statut into v_owner, v_statut from public.agent_conceptions c where c.id = p_conception_id for update;
  if v_owner is distinct from v_user or v_statut = 'archive' then raise exception 'Conception inaccessible ou archivée'; end if;
  if p_etude_id is null then
    delete from public.agent_conception_etude where conception_id = p_conception_id and user_id = v_user;
    return;
  end if;
  select e.status into v_etude_statut from public.promoteur_studies e where e.id = p_etude_id and e.user_id = v_user for share;
  if not found then raise exception 'Étude inaccessible'; end if;
  if v_etude_statut = 'archived' then raise exception 'Étude archivée'; end if;
  insert into public.agent_conception_etude(conception_id, etude_id, user_id)
    values (p_conception_id, p_etude_id, v_user)
  on conflict (conception_id) do update set etude_id = excluded.etude_id, user_id = excluded.user_id, maj_le = now();
end;
$$;
revoke all on function public.lier_conception_etude(uuid, uuid) from public, anon;
grant execute on function public.lier_conception_etude(uuid, uuid) to authenticated;
commit;
