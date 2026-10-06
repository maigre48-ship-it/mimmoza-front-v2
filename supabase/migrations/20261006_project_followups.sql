begin;
create table if not exists public.project_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_key text not null check (length(project_key) between 1 and 160),
  title text not null check (length(title) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'version'='1' and octet_length(payload::text)<=60000),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(user_id,project_key)
);
alter table public.project_followups enable row level security;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='project_followups' and policyname='project_followups_owner') then
create policy project_followups_owner on public.project_followups for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
end if; end $$;
grant select,insert,update,delete on public.project_followups to authenticated;
create or replace function public.save_project_followup(p_project_key text,p_title text,p_payload jsonb,p_revision integer)
returns setof public.project_followups language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Session requise'; end if;
  if p_revision=0 then
    return query insert into public.project_followups(user_id,project_key,title,payload) values(auth.uid(),p_project_key,p_title,p_payload) on conflict(user_id,project_key) do nothing returning *;
  else
    return query update public.project_followups set title=p_title,payload=p_payload,revision=revision+1,updated_at=now() where user_id=auth.uid() and project_key=p_project_key and revision=p_revision returning *;
  end if;
  if not found then raise exception 'Le suivi a changé. Rechargez-le avant de sauvegarder.'; end if;
end $$;
revoke all on function public.save_project_followup(text,text,jsonb,integer) from public,anon;
grant execute on function public.save_project_followup(text,text,jsonb,integer) to authenticated;
commit;
