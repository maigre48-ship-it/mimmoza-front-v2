-- Dossier parcellaire relié à une conversation. Les géométries restent dans les
-- sources cadastrales ; seules les références validées et les hypothèses sont sauvées.
create table if not exists public.copilot_parcel_dossiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.copilot_conversations(id) on delete cascade,
  source_message_id uuid not null references public.copilot_messages(id) on delete cascade,
  selected_parcels jsonb not null default '[]'::jsonb,
  built_surface_m2 numeric,
  cadastral_rent_per_m2 numeric,
  watch_enabled boolean not null default false,
  watch_snapshot jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, conversation_id, source_message_id),
  constraint dossier_parcels_array check (jsonb_typeof(selected_parcels) = 'array'),
  constraint dossier_surface_positive check (built_surface_m2 is null or built_surface_m2 > 0),
  constraint dossier_rent_positive check (cadastral_rent_per_m2 is null or cadastral_rent_per_m2 > 0)
);

create index if not exists copilot_parcel_dossiers_watch_idx
  on public.copilot_parcel_dossiers (checked_at) where watch_enabled = true;

alter table public.copilot_parcel_dossiers enable row level security;
create policy "dossier select owner" on public.copilot_parcel_dossiers for select
  using (auth.uid() = user_id);
create policy "dossier insert owner" on public.copilot_parcel_dossiers for insert
  with check (auth.uid() = user_id and exists (
    select 1 from public.copilot_conversations c where c.id = conversation_id and c.user_id = auth.uid()
  ));
create policy "dossier update owner" on public.copilot_parcel_dossiers for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "dossier delete owner" on public.copilot_parcel_dossiers for delete
  using (auth.uid() = user_id);

create table if not exists public.copilot_parcel_dossier_events (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.copilot_parcel_dossiers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_hash text not null,
  changes jsonb not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (dossier_id, event_hash)
);
create index if not exists copilot_parcel_dossier_events_recent_idx
  on public.copilot_parcel_dossier_events (dossier_id, created_at desc);
alter table public.copilot_parcel_dossier_events enable row level security;
create policy "dossier events select owner" on public.copilot_parcel_dossier_events for select
  using (auth.uid() = user_id);
-- Lecture seule pour les lignes d'événements : seul le marqueur de lecture
-- peut être modifié par l'utilisateur, via cette fonction bornée à son compte.
create or replace function public.mark_copilot_parcel_dossier_events_read(p_dossier_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.copilot_parcel_dossier_events
  set is_read = true
  where dossier_id = p_dossier_id and user_id = auth.uid() and is_read = false;
$$;
revoke all on function public.mark_copilot_parcel_dossier_events_read(uuid) from public;
grant execute on function public.mark_copilot_parcel_dossier_events_read(uuid) to authenticated;
