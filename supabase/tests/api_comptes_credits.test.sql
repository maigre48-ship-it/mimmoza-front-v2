-- =============================================================================
-- Tests : 20261022_api_comptes_credits.sql
-- =============================================================================
-- À exécuter sur une base LOCALE / branche (jamais en production) où la
-- migration est appliquée, en superutilisateur (postgres), avec l'extension
-- dblink disponible (test de concurrence à deux sessions) :
--   psql -v ON_ERROR_STOP=1 -d <base> -f supabase/tests/api_comptes_credits.test.sql
-- Chaque exécution crée ses propres utilisateurs (uuid aléatoires). Un échec
-- lève une exception « ECHEC … » ; la dernière ligne affiche TOUS LES TESTS OK.
-- =============================================================================
\set ON_ERROR_STOP 1
create extension if not exists dblink;

drop table if exists pg_temp.t_ids;
create temp table t_ids (nom text primary key, id uuid);
insert into t_ids values ('u1', gen_random_uuid()), ('u2', gen_random_uuid()),
                         ('u3', gen_random_uuid()), ('admin', gen_random_uuid());
insert into auth.users (id) select id from t_ids;
insert into public.admin_users (user_id, is_active) select id, true from t_ids where nom = 'admin';
grant select on t_ids to authenticated, service_role;

create or replace function pg_temp.id(p text) returns uuid language sql as $$ select id from t_ids where nom = p $$;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if c is distinct from true then raise exception 'ECHEC : %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
grant execute on function pg_temp.ok(boolean, text) to public;

-- Clés (insertion par le serveur) : le compte essai est créé automatiquement.
insert into public.api_keys (user_id, name, prefix, secret_hash, env)
select pg_temp.id('u1'), 'k1', 'mk_t1', 'h_' || gen_random_uuid(), 'live';

do $$
declare c record;
begin
  select * into c from public.api_comptes where user_id = pg_temp.id('u1');
  perform pg_temp.ok(c.plan = 'essai' and c.credits_mois = 500 and c.credits_utilises = 0
                     and c.essai_expire_le between now() + interval '29 days' and now() + interval '31 days',
                     'compte essai créé à la première clé (500 crédits, 30 jours)');
  perform pg_temp.ok((select requests_limit from public.api_keys where user_id = pg_temp.id('u1')) = 500,
                     'requests_limit de la clé = quota du compte (indicatif)');
end $$;

-- ── Réservation qui réussit ───────────────────────────────────────────────
do $$
declare k uuid; r jsonb;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u1');
  r := public.api_reserver_credits(k, '/v1/scoring/smart', 10);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'source_mois')::int = 10 and (r->>'source_recharge')::int = 0
                     and (r->>'restant')::int = 490 and (r->>'limite')::int = 500 and r->>'plan' = 'essai',
                     'réservation OK : ' || r::text);
  perform pg_temp.ok((select requests_count from public.api_keys where id = k) = 10
                     and (select last_used_at from public.api_keys where id = k) is not null,
                     'requests_count / last_used_at de la clé mis à jour');

  -- Remboursement exact
  perform public.api_rembourser_credits(k, 10, 0);
  perform pg_temp.ok((select credits_utilises from public.api_comptes where user_id = pg_temp.id('u1')) = 0
                     and (select requests_count from public.api_keys where id = k) = 0,
                     'remboursement exact');

  -- Solde insuffisant → credits_epuises, aucun débit partiel
  r := public.api_reserver_credits(k, '/v1/faisabilite', 495);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'restant')::int = 5, 'réservation de 495');
  r := public.api_reserver_credits(k, '/v1/faisabilite', 25);
  perform pg_temp.ok(not (r->>'ok')::boolean and r->>'raison' = 'credits_epuises' and (r->>'restant')::int = 5,
                     'solde insuffisant → credits_epuises : ' || r::text);
  perform pg_temp.ok((select credits_utilises from public.api_comptes where user_id = pg_temp.id('u1')) = 495,
                     'aucun débit partiel');

  -- Clé inconnue
  r := public.api_reserver_credits(gen_random_uuid(), '/v1/dpe', 1);
  perform pg_temp.ok(r->>'raison' = 'cle_invalide', 'clé inconnue → cle_invalide');
end $$;

-- ── Essai expiré ──────────────────────────────────────────────────────────
update public.api_comptes set essai_expire_le = now() - interval '1 second' where user_id = pg_temp.id('u1');
do $$
declare k uuid; r jsonb;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u1');
  r := public.api_reserver_credits(k, '/v1/dpe', 1);
  perform pg_temp.ok(not (r->>'ok')::boolean and r->>'raison' = 'essai_expire', 'essai expiré : ' || r::text);
end $$;

-- ── Admin : refus pour un non-admin, puis passage en starter + recharge ──
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('u1')::text, false);
do $$
begin
  perform public.admin_api_definir_formule(pg_temp.id('u1'), 'scale', 100000);
  raise exception 'ECHEC : un non-admin a pu changer sa formule';
exception when others then
  if sqlerrm like 'ECHEC%' then raise; end if;
  perform pg_temp.ok(sqlerrm like '%FORBIDDEN_ADMIN_ONLY%', 'non-admin → FORBIDDEN_ADMIN_ONLY');
end $$;
select set_config('request.jwt.claim.sub', pg_temp.id('admin')::text, false);
do $$
declare r jsonb;
begin
  r := public.admin_api_definir_formule(pg_temp.id('u1'), 'starter', 1000);
  perform pg_temp.ok(r->>'plan' = 'starter' and (r->>'credits_mois')::int = 10000 and (r->>'credits_utilises')::int = 0
                     and (r->>'credits_recharge')::int = 1000 and (r->>'rate_limit_min')::int = 60
                     and (r->>'max_cles')::int = 5 and r ? 'recharge_expire_le',
                     'admin : starter + recharge 1000 : ' || r::text);
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ── Ordre : crédits du mois puis recharge ─────────────────────────────────
update public.api_comptes set credits_utilises = 9995 where user_id = pg_temp.id('u1');
do $$
declare k uuid; r jsonb;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u1');
  r := public.api_reserver_credits(k, '/v1/estimation', 15);
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'source_mois')::int = 5 and (r->>'source_recharge')::int = 10
                     and (r->>'restant')::int = 990, 'ordre mois puis recharge : ' || r::text);
  perform public.api_rembourser_credits(k, (r->>'source_mois')::int, (r->>'source_recharge')::int);
  perform pg_temp.ok((select credits_utilises = 9995 and credits_recharge = 1000
                        from public.api_comptes where user_id = pg_temp.id('u1')),
                     'remboursement exact mois + recharge');
end $$;

-- ── Remise à zéro mensuelle (cron) et rattrapage paresseux ─────────────────
update public.api_comptes set periode_debut = (date_trunc('month', now()) - interval '1 month')::date
 where user_id = pg_temp.id('u1');
do $$
declare k uuid; r jsonb;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u1');
  r := public.api_reserver_credits(k, '/v1/dpe', 1);
  perform pg_temp.ok((r->>'source_mois')::int = 1 and (r->>'restant')::int = 10999,
                     'nouveau mois rattrapé sans cron : ' || r::text);
end $$;
update public.api_comptes set credits_utilises = 1234, recharge_expire_le = now() - interval '1 second'
 where user_id = pg_temp.id('u1');
do $$
begin
  perform public.api_keys_remise_a_zero_mensuelle();
  perform pg_temp.ok((select credits_utilises = 0 and credits_recharge = 0 and recharge_expire_le is null
                        from public.api_comptes where user_id = pg_temp.id('u1')),
                     'cron : crédits du mois remis à zéro, recharge échue expirée');
  perform pg_temp.ok((select requests_count from public.api_keys where user_id = pg_temp.id('u1')) = 0,
                     'cron : compteur par clé remis à zéro');
end $$;

-- ── Débit par minute dépassé ──────────────────────────────────────────────
update public.api_comptes set rate_limit_min = 3, debit_minute = null, debit_compte = 0 where user_id = pg_temp.id('u1');
do $$
declare k uuid; r jsonb; i int;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u1');
  for i in 1..3 loop
    r := public.api_reserver_credits(k, '/v1/dpe', 1);
    perform pg_temp.ok((r->>'ok')::boolean, 'appel ' || i || '/3 dans la minute');
  end loop;
  r := public.api_reserver_credits(k, '/v1/dpe', 1);
  perform pg_temp.ok(r->>'raison' = 'debit_depasse' and (r->>'reessayer_dans')::int between 1 and 60,
                     '4e appel → debit_depasse : ' || r::text);
end $$;
update public.api_comptes set rate_limit_min = 60 where user_id = pg_temp.id('u1');

-- ── Plafond de clés (essai : 2) ───────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('u2')::text, false);
insert into public.api_keys (user_id, name, prefix, secret_hash, env, requests_limit, plan)
values (pg_temp.id('u2'), 'a', 'mk_a', 'h_a' || gen_random_uuid(), 'live', 999999, 'enterprise'),
       (pg_temp.id('u2'), 'b', 'mk_b', 'h_b' || gen_random_uuid(), 'live', 999999, 'enterprise');
do $$
begin
  perform pg_temp.ok((select bool_and(plan = 'starter' and requests_limit = 500 and requests_count = 0)
                        from public.api_keys where user_id = pg_temp.id('u2')),
                     'insertion utilisateur : quota forcé (500), champs financiers ignorés');
  begin
    insert into public.api_keys (user_id, name, prefix, secret_hash, env)
    values (pg_temp.id('u2'), 'c', 'mk_c', 'h_c' || gen_random_uuid(), 'live');
    raise exception 'ECHEC : 3e clé acceptée en essai';
  exception when others then
    if sqlerrm like 'ECHEC%' then raise; end if;
    perform pg_temp.ok(sqlerrm like 'API_MAX_CLES_ATTEINT%', '3e clé refusée : ' || sqlerrm);
  end;
  -- Révoquer puis réactiver une clé : la réactivation est ignorée.
  update public.api_keys set revoked_at = now() where user_id = pg_temp.id('u2') and name = 'a';
  update public.api_keys set revoked_at = null  where user_id = pg_temp.id('u2') and name = 'a';
  perform pg_temp.ok((select revoked_at is not null from public.api_keys where user_id = pg_temp.id('u2') and name = 'a'),
                     'réactivation d''une clé révoquée impossible');
  insert into public.api_keys (user_id, name, prefix, secret_hash, env)
  values (pg_temp.id('u2'), 'c', 'mk_c', 'h_c' || gen_random_uuid(), 'live');
  perform pg_temp.ok(true, 'nouvelle clé acceptée après révocation');
end $$;

-- ── L'utilisateur ne peut rien modifier de financier ───────────────────────
do $$
declare n int; r jsonb;
begin
  begin
    update public.api_comptes set credits_mois = 999999, plan = 'scale' where user_id = pg_temp.id('u2');
    raise exception 'ECHEC : update du compte accepté';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'update de son compte refusé (permission)');
  end;
  begin
    insert into public.api_comptes (user_id, plan) values (pg_temp.id('u2'), 'scale');
    raise exception 'ECHEC : insert de compte accepté';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'insert de compte refusé');
  end;
  begin
    delete from public.api_comptes where user_id = pg_temp.id('u2');
    raise exception 'ECHEC : delete de compte accepté';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'delete de compte refusé');
  end;
  begin
    perform public.api_reserver_credits(gen_random_uuid(), 'x', 0);
    raise exception 'ECHEC : authenticated peut réserver';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'api_reserver_credits interdit à authenticated');
  end;
  begin
    perform public.api_rembourser_credits(gen_random_uuid(), 100, 100);
    raise exception 'ECHEC : authenticated peut se rembourser';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'api_rembourser_credits interdit à authenticated');
  end;
  update public.api_keys set requests_count = 0, requests_limit = 999999 where user_id = pg_temp.id('u2');
  perform pg_temp.ok((select bool_and(requests_limit = 500) from public.api_keys where user_id = pg_temp.id('u2')),
                     'requests_limit de ses clés non modifiable');
  select count(*) into n from public.api_comptes;
  perform pg_temp.ok(n = 1, 'RLS : ne voit que sa propre ligne de compte');
  r := public.api_mon_compte();
  perform pg_temp.ok(r->>'plan' = 'essai' and (r->>'cles_actives')::int = 2 and (r->>'max_cles')::int = 2
                     and (r->>'credits_mois')::int = 500 and r ? 'essai_expire_le' and r ? 'periode_debut',
                     'api_mon_compte : ' || r::text);
end $$;
select set_config('request.jwt.claim.sub', pg_temp.id('u3')::text, false);
do $$
begin
  perform pg_temp.ok(public.api_mon_compte() = '{"existe": false}'::jsonb, 'api_mon_compte sans compte → existe=false');
end $$;
reset role;
set role anon;
do $$
begin
  begin
    perform 1 from public.api_comptes;
    raise exception 'ECHEC : anon lit api_comptes';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'anon : aucune lecture des comptes');
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ── Concurrence : deux sessions ne dépassent jamais le solde ──────────────
-- Solde = 30 crédits. Session A réserve 20 et garde son verrou ; session B
-- demande 20 en même temps : elle attend, puis voit le solde réel (10) → refus.
update public.api_comptes set credits_utilises = 470, essai_expire_le = now() + interval '1 day',
                              debit_minute = null, debit_compte = 0
 where user_id = pg_temp.id('u2');
select dblink_connect('ca', 'dbname=' || current_database());
select dblink_connect('cb', 'dbname=' || current_database());
do $$
declare k uuid; ra jsonb; rb jsonb; occupe int;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u2') and revoked_at is null order by name limit 1;
  perform dblink_exec('ca', 'begin');
  select r into ra from dblink('ca', format('select public.api_reserver_credits(%L, %L, 20)', k, '/v1/faisabilite')) as t(r jsonb);
  perform dblink_send_query('cb', format('select public.api_reserver_credits(%L, %L, 20)', k, '/v1/faisabilite'));
  perform pg_sleep(0.5);
  occupe := dblink_is_busy('cb');
  perform pg_temp.ok(occupe = 1, 'session B bloquée par le verrou de A');
  perform dblink_exec('ca', 'commit');
  select r into rb from dblink_get_result('cb') as t(r jsonb);
  perform dblink_get_result('cb');  -- vide la file
  perform pg_temp.ok((ra->>'ok')::boolean and not (rb->>'ok')::boolean and rb->>'raison' = 'credits_epuises'
                     and (rb->>'restant')::int = 10,
                     'concurrence : A=' || ra::text || ' B=' || rb::text);
end $$;

-- Rafale : 2 sessions × 10 appels de 1 crédit sur un solde de 15 → 15 succès exactement.
update public.api_comptes set credits_utilises = 485, rate_limit_min = 1000, debit_minute = null, debit_compte = 0
 where user_id = pg_temp.id('u2');
do $$
declare k uuid; q text; na int; nb int; c record;
begin
  select id into k from public.api_keys where user_id = pg_temp.id('u2') and revoked_at is null order by name limit 1;
  q := format('select count(*) filter (where (public.api_reserver_credits(%L, %L, 1)->>''ok'')::boolean)::int from generate_series(1,10)', k, '/v1/dpe');
  perform dblink_send_query('ca', q);
  perform dblink_send_query('cb', q);
  select n into na from dblink_get_result('ca') as t(n int); perform dblink_get_result('ca');
  select n into nb from dblink_get_result('cb') as t(n int); perform dblink_get_result('cb');
  select * into c from public.api_comptes where user_id = pg_temp.id('u2');
  perform pg_temp.ok(na + nb = 15 and c.credits_utilises = 500,
                     format('rafale concurrente : %s + %s succès, utilisés = %s / 500', na, nb, c.credits_utilises));
end $$;
select dblink_disconnect('ca');
select dblink_disconnect('cb');

select 'TOUS LES TESTS OK' as resultat;
