-- Fiche 3D relue et validée par l'utilisateur, indépendante des propositions IA.
create table if not exists public.copilot_studio3d_drafts (
  conversation_id uuid primary key references public.copilot_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'validated')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio3d_payload_valid check (
    jsonb_typeof(payload) = 'object'
    and payload->>'version' = '1'
    and coalesce(jsonb_typeof(payload->'questions'), '') = 'array'
    and coalesce(jsonb_typeof(payload->'pieces'), '') = 'array'
    and (status <> 'validated' or length(trim(coalesce(payload->>'objectif', ''))) > 0)
    and octet_length(payload::text) <= 16000
  )
);

alter table public.copilot_studio3d_drafts enable row level security;
create policy studio3d_draft_read_owner on public.copilot_studio3d_drafts
  for select to authenticated using (user_id = auth.uid());
grant select on public.copilot_studio3d_drafts to authenticated;

create or replace function public.save_copilot_studio3d_draft(
  p_conversation_id uuid,
  p_payload jsonb,
  p_status text,
  p_revision integer
)
returns setof public.copilot_studio3d_drafts
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Session requise'; end if;
  if p_status not in ('draft', 'validated') then raise exception 'Statut invalide'; end if;
  if not exists (
    select 1 from public.copilot_conversations
    where id = p_conversation_id and user_id = v_user_id
  ) then raise exception 'Conversation introuvable'; end if;

  if p_revision = 0 then
    return query insert into public.copilot_studio3d_drafts
      (conversation_id, user_id, payload, status)
    values (p_conversation_id, v_user_id, p_payload, p_status)
    on conflict (conversation_id) do nothing returning *;
  else
    return query update public.copilot_studio3d_drafts
    set payload = p_payload, status = p_status, revision = revision + 1, updated_at = now()
    where conversation_id = p_conversation_id and user_id = v_user_id
      and revision = p_revision
    returning *;
  end if;
  if not found then raise exception 'Le dossier a changé. Rechargez-le avant de sauvegarder.'; end if;
end $$;

revoke all on function public.save_copilot_studio3d_draft(uuid,jsonb,text,integer) from public, anon;
grant execute on function public.save_copilot_studio3d_draft(uuid,jsonb,text,integer) to authenticated;
