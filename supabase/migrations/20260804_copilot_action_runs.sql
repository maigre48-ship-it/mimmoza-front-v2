-- ============================================================================
-- copilot_action_runs — trace de ce que le copilote a réellement FAIT.
-- Appliqué en production le 2026-08-04. Rejouable (idempotent).
--
-- Le problème : `copilot_tool_calls` enregistre la *proposition* du modèle —
-- « je suggère de créer une opération ». Il ne dit ni si l'utilisateur a
-- confirmé, ni si l'action a réussi. Tant que le chat se contentait de lire,
-- l'écart était cosmétique. Depuis qu'il pilote, il ne l'est plus : recharger
-- une conversation rouvrait chaque action en « proposée », et en mode autonome
-- la carte se relançait toute seule — opération recréée, étape relancée.
--
-- Sur la clé d'identité. La table a d'abord référencé `copilot_tool_calls.id` ;
-- inutilisable. L'Edge Function insère ces lignes en lot, sans `.select()`, et
-- n'émet jamais l'uuid généré dans le flux SSE ; le front ne connaît que l'id
-- Anthropic (`toolu_…`), stocké nulle part. Aucun des deux côtés ne pouvait
-- désigner la même ligne.
-- Ce que les deux connaissent : le `message_id`, et l'action elle-même — son
-- genre et ses paramètres, lus dans `tool_output` aussi bien en direct qu'au
-- rechargement. `md5(params::text)` est stable, jsonb normalisant l'ordre des
-- clés.
-- ============================================================================

create table if not exists public.copilot_action_runs (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.copilot_messages(id) on delete cascade,
  conversation_id uuid not null references public.copilot_conversations(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,

  action_kind     text not null check (action_kind in ('open_page', 'create_operation', 'run_step')),
  params          jsonb not null default '{}'::jsonb,

  -- `refused` est un résultat comme un autre : savoir que l'utilisateur a dit
  -- non est aussi utile que savoir qu'il a dit oui.
  outcome         text not null check (outcome in ('done', 'failed', 'refused')),
  -- Qui a décidé : l'utilisateur en confirmant, ou le mode autonome.
  decided_by      text not null default 'user' check (decided_by in ('user', 'auto')),

  message         text,
  study_id        uuid,
  navigated_to    text,

  created_at      timestamptz not null default now()
);

-- Une action donnée ne s'exécute qu'une fois par message. C'est cette
-- contrainte, et non la bonne volonté du front, qui rend le rejeu impossible :
-- recharger une conversation ne peut pas recréer une opération.
create unique index if not exists copilot_action_runs_identity_uniq
  on public.copilot_action_runs (message_id, action_kind, md5(params::text));

create index if not exists copilot_action_runs_conversation_idx
  on public.copilot_action_runs (conversation_id, created_at);

alter table public.copilot_action_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.copilot_action_runs'::regclass
      and polname = 'copilot_action_runs_owner_select'
  ) then
    create policy copilot_action_runs_owner_select
      on public.copilot_action_runs for select
      using (auth.uid() = user_id);
  end if;

  -- Le front insère avec la session de l'utilisateur, et seulement sur ses
  -- propres messages. Pas d'UPDATE ni de DELETE : une trace qu'on peut
  -- réécrire après coup ne vaut rien.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.copilot_action_runs'::regclass
      and polname = 'copilot_action_runs_owner_insert'
  ) then
    create policy copilot_action_runs_owner_insert
      on public.copilot_action_runs for insert
      with check (
        auth.uid() = user_id
        and exists (
          select 1 from public.copilot_messages m
          where m.id = message_id and m.user_id = auth.uid()
        )
      );
  end if;
end $$;

grant select, insert on public.copilot_action_runs to authenticated;
revoke all on public.copilot_action_runs from anon;

comment on table public.copilot_action_runs is
  'Trace des actions copilote réellement exécutées par le front. Complète copilot_tool_calls, qui n''enregistre que la proposition du modèle.';
