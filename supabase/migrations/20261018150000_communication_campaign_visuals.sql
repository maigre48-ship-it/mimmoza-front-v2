alter table public.communication_campaigns
  add column if not exists visual_path text,
  add column if not exists visual_prompt text,
  add column if not exists visual_model text,
  add column if not exists visual_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('communication-campaigns', 'communication-campaigns', false, 10485760, array['image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists communication_campaigns_visual_admin_select on storage.objects;
create policy communication_campaigns_visual_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'communication-campaigns' and public.is_current_user_admin());
