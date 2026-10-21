create table if not exists public.admin_support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_name text not null default '',
  requester_email text not null default '',
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 10000),
  category text not null default 'autre',
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'closed')),
  draft_subject text not null default '',
  draft_body text not null default '',
  internal_note text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_support_tickets enable row level security;
grant select, insert, update on public.admin_support_tickets to authenticated;

drop policy if exists admin_support_tickets_select on public.admin_support_tickets;
drop policy if exists admin_support_tickets_insert on public.admin_support_tickets;
drop policy if exists admin_support_tickets_update on public.admin_support_tickets;
create policy admin_support_tickets_select on public.admin_support_tickets
  for select to authenticated using (public.is_current_user_admin());
create policy admin_support_tickets_insert on public.admin_support_tickets
  for insert to authenticated with check (public.is_current_user_admin());
create policy admin_support_tickets_update on public.admin_support_tickets
  for update to authenticated using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

create index if not exists admin_support_tickets_status_created_idx
  on public.admin_support_tickets (status, created_at desc);

create or replace function public.admin_support_tickets_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists admin_support_tickets_updated_at on public.admin_support_tickets;
create trigger admin_support_tickets_updated_at
  before update on public.admin_support_tickets
  for each row execute function public.admin_support_tickets_touch_updated_at();
