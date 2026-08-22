alter table public.copilot_messages
  add column if not exists context_snapshot jsonb null;

alter table public.copilot_messages
  drop constraint if exists copilot_messages_context_snapshot_shape_check;

alter table public.copilot_messages
  add constraint copilot_messages_context_snapshot_shape_check check (
    context_snapshot is null or (
      jsonb_typeof(context_snapshot) = 'object'
      and context_snapshot ?& array['schema_version', 'captured_at', 'context', 'context_hash']
      and context_snapshot->>'schema_version' = '1'
      and jsonb_typeof(context_snapshot->'context') = 'object'
      and (context_snapshot->>'captured_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      and (context_snapshot->>'context_hash') ~ '^[0-9a-f]{64}$'
      and octet_length(context_snapshot::text) <= 100000
    )
  );

create index if not exists copilot_messages_context_snapshot_gin_idx
  on public.copilot_messages using gin (context_snapshot jsonb_path_ops)
  where context_snapshot is not null;

comment on column public.copilot_messages.context_snapshot is
  'Contexte Copilot sanitise, versionne et signe par hash pour reproduire chaque message utilisateur.';
