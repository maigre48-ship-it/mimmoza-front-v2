-- =============================================================================
-- 20/11/2026 — VIS-18a « Studio relié au parcours » : LOGEMENT TÉMOIN PERSONNALISÉ
-- =============================================================================
-- NON APPLIQUÉE par l'agent : à appliquer par le fondateur (voir mimmozia-studio/docs/vis/VIS-18a-journal.md).
--
-- Une ligne = le logement témoin personnalisé dans le Studio (étape Aménagement → Intérieur : logement choisi,
-- style, gamme, meubles, sols, murs, plan modifié) pour UNE conversation d'un utilisateur. Le Studio l'envoie au site
-- (protocole mimmoza-parcours-studio v1, canal temoin.etat) ; le site l'écrit ici avec la session de l'utilisateur ;
--   · le parcours guidé le lit (étape « Intérieurs » : fait + résumé d'une ligne) ;
--   · le worker de rendu le lit (clé service_role) pour les vues intérieures (worker/src/interieursImage.ts).
-- Format du JSON : `mimmozia-temoin-personnalise` v1 (src/core/echange/pontParcoursStudio.ts, copie identique au site).
--
-- Sécurité : RLS par propriétaire (user_id = auth.uid()) pour select / insert / update / delete ; anon : aucun droit ;
-- pas de SECURITY DEFINER ; tailles bornées par contraintes.
-- REJOUABLE : create … if not exists ; politiques créées seulement si absentes. Aucun DROP, aucun DELETE.
-- =============================================================================

create table if not exists public.studio_temoins (
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id text not null check (char_length(conversation_id) between 1 and 200),
  -- Projet du site vu par le Studio (`mzchat-<conversation>`), pour contrôle.
  projet_id       text check (projet_id is null or char_length(projet_id) <= 120),
  temoin          jsonb not null check (
                    jsonb_typeof(temoin) = 'object'
                    and temoin->>'format' = 'mimmozia-temoin-personnalise'
                    and octet_length(temoin::text) < 131072
                  ),
  resume          text not null check (char_length(resume) between 1 and 300),
  empreinte       text not null check (empreinte ~ '^fnv1a32:[0-9a-f]{8}$'),
  cree_le         timestamptz not null default now(),
  maj_le          timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

comment on table public.studio_temoins is
  'VIS-18a — logement témoin personnalisé dans le Studio, par conversation ; lu par le parcours guidé et par le worker de rendu (vues intérieures).';

alter table public.studio_temoins enable row level security;

revoke all on public.studio_temoins from anon;
grant select, insert, update, delete on public.studio_temoins to authenticated;
-- VIS-19 : hygiène — les privilèges par défaut de Supabase donnent aussi TRUNCATE / REFERENCES / TRIGGER (TRUNCATE
-- contourne la RLS) : retirés explicitement.
revoke truncate, references, trigger on public.studio_temoins from authenticated, anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'studio_temoins' and policyname = 'studio_temoins_select_proprietaire') then
    create policy studio_temoins_select_proprietaire on public.studio_temoins
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'studio_temoins' and policyname = 'studio_temoins_insert_proprietaire') then
    create policy studio_temoins_insert_proprietaire on public.studio_temoins
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'studio_temoins' and policyname = 'studio_temoins_update_proprietaire') then
    create policy studio_temoins_update_proprietaire on public.studio_temoins
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'studio_temoins' and policyname = 'studio_temoins_delete_proprietaire') then
    create policy studio_temoins_delete_proprietaire on public.studio_temoins
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

-- maj_le serveur à chaque écriture (fonction ordinaire, SECURITY INVOKER).
create or replace function public.studio_temoins_maj_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  if tg_op = 'UPDATE' then new.cree_le := old.cree_le; end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'studio_temoins_maj_le' and tgrelid = 'public.studio_temoins'::regclass) then
    create trigger studio_temoins_maj_le before insert or update on public.studio_temoins
      for each row execute function public.studio_temoins_maj_le();
  end if;
end $$;
