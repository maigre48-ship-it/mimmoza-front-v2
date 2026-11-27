-- =============================================================
-- VIS-67 (27/11/2026) — GRILLE DE VENTE : statuts, prix et lots commerciaux d'un projet (bureau de vente).
-- À VALIDER PAR ALBÉ AVANT APPLICATION (non appliquée par l'agent VIS-67).
--
-- Projet = conversation Mimmoza (`mzchat-<copilot_conversations.id>`). RLS STRICTE : seul le PROPRIÉTAIRE de la
-- conversation (copilot_conversations.user_id = auth.uid()) lit et écrit ; aucune lecture anonyme ; le rôle service
-- (Edge copilot-chat) lit pour la carte de synthèse du chat.
--
--   vente_grilles : une ligne par (conversation, empreinte du modèle) : grille de prix (jsonb, `GrillePrix` du Studio).
--   vente_lots    : une ligne par lot : instantané du lot commercial (calculé par le Studio, src/core/vente) + saisies
--                   (statut, prix décidé, parkings, annexes, acquéreur, note). Le Studio écrit, le chat relit.
-- =============================================================

create table if not exists public.vente_grilles (
  conversation_id uuid not null references public.copilot_conversations(id) on delete cascade,
  empreinte_modele text not null check (empreinte_modele ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  grille jsonb not null default '{}'::jsonb check (jsonb_typeof(grille) = 'object' and pg_column_size(grille) < 16384),
  nom_projet text check (char_length(nom_projet) <= 200),
  maj_le timestamptz not null default now(),
  primary key (conversation_id, empreinte_modele)
);

create table if not exists public.vente_lots (
  conversation_id uuid not null references public.copilot_conversations(id) on delete cascade,
  empreinte_modele text not null check (empreinte_modele ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  lot_id text not null check (lot_id ~ '^[A-Za-z0-9_.:-]{1,60}$'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nature text not null default 'logement' check (nature in ('logement', 'commerce')),
  niveau smallint not null check (niveau between -5 and 80),
  typologie text not null check (typologie in ('T1', 'T2', 'T3', 'T4', 'T5', 'commerce')),
  shab_m2 numeric(8, 2) not null check (shab_m2 >= 0),
  exterieur_m2 numeric(8, 2) not null default 0 check (exterieur_m2 >= 0),
  annexes jsonb not null default '{}'::jsonb check (jsonb_typeof(annexes) = 'object'),
  orientation text check (orientation in ('nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest')),
  azimuts_deg numeric(5, 1)[] not null default '{}',
  parkings smallint not null default 0 check (parkings between 0 and 20),
  prix_grille_eur numeric(12, 0) check (prix_grille_eur >= 0),
  prix_force_eur numeric(12, 0) check (prix_force_eur >= 0),
  statut text not null default 'libre' check (statut in ('libre', 'optionne', 'reserve', 'vendu')),
  acquereur text check (char_length(acquereur) <= 120),
  note text check (char_length(note) <= 500),
  signature text check (char_length(signature) <= 40),
  maj_le timestamptz not null default now(),
  primary key (conversation_id, empreinte_modele, lot_id)
);

create index if not exists vente_lots_statut_idx on public.vente_lots (conversation_id, empreinte_modele, statut);

alter table public.vente_grilles enable row level security;
alter table public.vente_lots enable row level security;
alter table public.vente_grilles force row level security;
alter table public.vente_lots force row level security;

revoke all on public.vente_grilles from anon;
revoke all on public.vente_lots from anon;
grant select, insert, update, delete on public.vente_grilles to authenticated;
grant select, insert, update, delete on public.vente_lots to authenticated;

-- Propriétaire de la conversation (et la ligne porte son identifiant : pas d'écriture pour le compte d'un autre).
create policy vente_grilles_proprietaire on public.vente_grilles
  for all to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.copilot_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.copilot_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));

create policy vente_lots_proprietaire on public.vente_lots
  for all to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.copilot_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.copilot_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));

-- Horodatage de mise à jour.
create or replace function public.vente_touche_maj() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

drop trigger if exists vente_grilles_maj on public.vente_grilles;
create trigger vente_grilles_maj before update on public.vente_grilles for each row execute function public.vente_touche_maj();
drop trigger if exists vente_lots_maj on public.vente_lots;
create trigger vente_lots_maj before update on public.vente_lots for each row execute function public.vente_touche_maj();

comment on table public.vente_lots is 'VIS-67 — lots commerciaux (instantané du Studio) et statuts de vente ; RLS : propriétaire de la conversation.';
comment on table public.vente_grilles is 'VIS-67 — grille de prix de la grille de vente (prix au m², coefficients) ; RLS : propriétaire de la conversation.';
