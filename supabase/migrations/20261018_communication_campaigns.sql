create table if not exists public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  brief text not null check (char_length(brief) between 1 and 6000),
  audience text not null check (audience in ('clients', 'prospects', 'tous')),
  channel text not null default 'email' check (channel = 'email'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  subject text not null default '',
  body text not null default '',
  internal_notes text not null default '',
  ai_model text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.communication_campaigns enable row level security;
grant select, insert, update on public.communication_campaigns to authenticated;

drop policy if exists communication_campaigns_admin_select on public.communication_campaigns;
drop policy if exists communication_campaigns_admin_insert on public.communication_campaigns;
drop policy if exists communication_campaigns_admin_update on public.communication_campaigns;

create policy communication_campaigns_admin_select on public.communication_campaigns
  for select to authenticated using (public.is_current_user_admin());
create policy communication_campaigns_admin_insert on public.communication_campaigns
  for insert to authenticated with check (public.is_current_user_admin());
create policy communication_campaigns_admin_update on public.communication_campaigns
  for update to authenticated using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

create index if not exists communication_campaigns_created_at_idx
  on public.communication_campaigns (created_at desc);

create or replace function public.communication_campaigns_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists communication_campaigns_updated_at on public.communication_campaigns;
create trigger communication_campaigns_updated_at
  before update on public.communication_campaigns
  for each row execute function public.communication_campaigns_touch_updated_at();
