-- Tests de 20261101_agent_conception_etude.sql. Aucun effet conservé : ROLLBACK.
-- Nécessite un rôle administrateur pour les fixtures et SET ROLE.
-- Base locale vierge (PostgreSQL 16 ou PGlite), dans cet ordre :
--   agent_autonome_stub_supabase.sql, agent_conception_stub_storage.sql,
--   ../migrations/20261030_agent_autonome.sql, ../migrations/20261031_agent_conception.sql,
--   promoteur_studies_stub.sql,
--   ../migrations/20261101_agent_conception_etude.sql (deux fois : rejouable), ce fichier.
-- Jamais sur la base de production.
begin;
insert into auth.users(id) values ('a1111111-1111-4111-8111-111111111111'), ('b2222222-2222-4222-8222-222222222222');
insert into public.promoteur_studies(id,user_id,title,status) values
 ('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','Test liaison A','draft'),
 ('a4444444-4444-4444-8444-444444444444','a1111111-1111-4111-8111-111111111111','Test liaison A2','draft'),
 ('b3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','Test liaison B','draft'),
 ('a7777777-7777-4777-8777-777777777777','a1111111-1111-4111-8111-111111111111','Test liaison A archivée','archived');
insert into public.agent_conceptions(id,user_id,idu,statut) values
 ('a5555555-5555-4555-8555-555555555555','a1111111-1111-4111-8111-111111111111','test-a','modele'),
 ('a6666666-6666-4666-8666-666666666666','a1111111-1111-4111-8111-111111111111','test-archive','archive'),
 ('b5555555-5555-4555-8555-555555555555','b2222222-2222-4222-8222-222222222222','test-b','modele');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select public.lier_conception_etude('a5555555-5555-4555-8555-555555555555','a3333333-3333-4333-8333-333333333333');
select public.lier_conception_etude('a5555555-5555-4555-8555-555555555555','a4444444-4444-4444-8444-444444444444');
do $$ begin
 if (select count(*) from public.agent_conception_etude) <> 1 then raise exception 'Une seule liaison attendue'; end if;
 if not exists(select 1 from public.agent_conception_etude where etude_id='a4444444-4444-4444-8444-444444444444') then raise exception 'Changement A vers A2 non persisté'; end if;
 begin
  perform public.lier_conception_etude('a5555555-5555-4555-8555-555555555555','b3333333-3333-4333-8333-333333333333');
  raise exception 'ÉCHEC étude étrangère acceptée';
 exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
 begin
  perform public.lier_conception_etude('b5555555-5555-4555-8555-555555555555','a3333333-3333-4333-8333-333333333333');
  raise exception 'ÉCHEC conception étrangère acceptée';
 exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
 begin
  perform public.lier_conception_etude('a6666666-6666-4666-8666-666666666666','a3333333-3333-4333-8333-333333333333');
  raise exception 'ÉCHEC archive modifiée';
 exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
 begin
  perform public.lier_conception_etude('a5555555-5555-4555-8555-555555555555','a7777777-7777-4777-8777-777777777777');
  raise exception 'ÉCHEC étude archivée acceptée';
 exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
 if not exists(select 1 from public.agent_conception_etude where etude_id='a4444444-4444-4444-8444-444444444444') then raise exception 'Liaison modifiée par un refus'; end if;
 begin
  update public.agent_conception_etude set etude_id='a3333333-3333-4333-8333-333333333333';
  raise exception 'ÉCHEC écriture directe autorisée';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.agent_conception_etude) then raise exception 'Liaison A visible par B'; end if;
end $$;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select public.lier_conception_etude('a5555555-5555-4555-8555-555555555555',null);
do $$ begin
 if exists(select 1 from public.agent_conception_etude) then raise exception 'Suppression explicite non persistée'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.lier_conception_etude('a5555555-5555-4555-8555-555555555555','a3333333-3333-4333-8333-333333333333');
  raise exception 'ÉCHEC anonyme autorisé';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
