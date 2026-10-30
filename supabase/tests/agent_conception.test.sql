-- =============================================================================
-- Tests de la migration 20261031_agent_conception.sql
-- =============================================================================
-- Tout se passe dans UNE transaction terminée par ROLLBACK : aucune trace.
-- Chaque vérification lève une exception si elle échoue (la transaction est
-- alors annulée et psql s'arrête).
--
-- Lancement local (PostgreSQL 16 vierge + bouchons) :
--   psql -v ON_ERROR_STOP=1 -f agent_autonome_stub_supabase.sql
--        -f agent_conception_stub_storage.sql
--        -f ../migrations/20261030_agent_autonome.sql
--        -f ../migrations/20261031_agent_conception.sql   (deux fois : rejouable)
--        -f agent_conception.test.sql
-- Sur une base Supabase où la migration est appliquée : uniquement ce fichier
-- (il crée deux utilisateurs de test dans auth.users, annulés par le ROLLBACK).
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.verifier(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;

-- Exécute p_sql et vérifie qu'il échoue avec l'état SQL attendu (ou n'importe lequel si null).
create or replace function pg_temp.doit_echouer(p_sql text, p_etat text, msg text) returns void language plpgsql as
$$ begin
  begin
    execute p_sql;
  exception when others then
    if p_etat is null or sqlstate = p_etat then
      raise notice 'ok : % (%: %)', msg, sqlstate, sqlerrm; return;
    end if;
    raise exception 'ÉCHEC : % — erreur inattendue % : %', msg, sqlstate, sqlerrm;
  end;
  raise exception 'ÉCHEC : % — aucune erreur levée', msg;
end $$;

-- ── Données de test (postgres) ──────────────────────────────────────────────
insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-00000000000c', 'conception-test-a@exemple.invalid'),
  ('dddddddd-0000-4000-8000-00000000000d', 'conception-test-b@exemple.invalid')
on conflict do nothing;

create temp table ids (nom text primary key, id uuid);
grant select, insert, update on ids to authenticated, service_role;

-- Règles valides : une confirmée (article), une estimée, une manquante.
create temp table regles (nom text primary key, r jsonb);
grant select on regles to authenticated, service_role;
insert into regles values ('ok', '[
  {"cle":"hauteur_max_m","valeur":12,"unite":"m","statut":"confirme","source":"reglement_pdf","article":"UB 10"},
  {"cle":"recul_limites_formule","valeur":"H/2 min 3 m","unite":"formule","statut":"estime","source":"moteur_plu"},
  {"cle":"mixite_sociale_pct","valeur":null,"unite":"%","statut":"manquant","source":"aucune source trouvée"}
]'::jsonb);

-- ── 1. agent_missions.type accepte 'conception' ─────────────────────────────
with m as (
  insert into public.agent_missions (user_id, type, objectif, devis)
  values ('cccccccc-0000-4000-8000-00000000000c', 'conception', 'Concevoir le projet', '{}'::jsonb)
  returning id)
insert into ids select 'mA_conc', id from m;
with m as (
  insert into public.agent_missions (user_id, type, objectif, devis)
  values ('cccccccc-0000-4000-8000-00000000000c', 'prospection_fonciere', 'Prospection', '{}'::jsonb)
  returning id)
insert into ids select 'mA_prosp', id from m;
with m as (
  insert into public.agent_missions (user_id, type, objectif, devis)
  values ('cccccccc-0000-4000-8000-00000000000c', 'conception', 'Concevoir bis', '{}'::jsonb)
  returning id)
insert into ids select 'mA_conc2', id from m;
with m as (
  insert into public.agent_missions (user_id, type, objectif, devis)
  values ('dddddddd-0000-4000-8000-00000000000d', 'conception', 'Concevoir B', '{}'::jsonb)
  returning id)
insert into ids select 'mB_conc', id from m;
select pg_temp.verifier((select count(*) = 3 from public.agent_missions m join ids on ids.id = m.id where m.type = 'conception'),
                        '1 : missions de type conception acceptées');
select pg_temp.doit_echouer($q$insert into public.agent_missions (user_id, type, objectif)
  values ('cccccccc-0000-4000-8000-00000000000c', 'inconnu', 'x')$q$, '23514', '1 : type inconnu refusé');

-- ── 2. Conceptions : écriture par le propriétaire ───────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-00000000000c', true);

with c as (
  insert into public.agent_conceptions (user_id, mission_id, mission_origine_id, idu, commune, regles_plu, programme, statut)
  values ('cccccccc-0000-4000-8000-00000000000c',
          (select id from ids where nom = 'mA_conc'), (select id from ids where nom = 'mA_prosp'),
          '75056000AB0012', 'Paris', (select r from regles where nom = 'ok'),
          '{"nb_logements":40,"typologies":{"T1":4,"T2":12,"T3":14,"T4":8,"T5":2}}'::jsonb, 'regles')
  returning id, version_courante, statut)
insert into ids select 'cA', id from c;
select pg_temp.verifier((select version_courante = 0 and statut = 'regles' from public.agent_conceptions
                          where id = (select id from ids where nom = 'cA')),
                        '2 : le propriétaire crée sa conception (version 0, statut regles)');

select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu)
  values ('dddddddd-0000-4000-8000-00000000000d', 'X')$q$, '42501', '2 : création pour un autre utilisateur refusée (RLS)');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, version_courante)
  values ('cccccccc-0000-4000-8000-00000000000c', 'X', 5)$q$, '42501', '2 : version_courante non inscriptible par l''utilisateur');
select pg_temp.doit_echouer(format($q$insert into public.agent_conceptions (user_id, idu, mission_id)
  values ('cccccccc-0000-4000-8000-00000000000c', 'X', %L)$q$, (select id from ids where nom = 'mB_conc')),
  '22023', '2 : mission d''un autre utilisateur refusée');
select pg_temp.doit_echouer(format($q$insert into public.agent_conceptions (user_id, idu, mission_id)
  values ('cccccccc-0000-4000-8000-00000000000c', 'X', %L)$q$, (select id from ids where nom = 'mA_prosp')),
  '22023', '2 : mission_id d''un autre type que conception refusée');
select pg_temp.doit_echouer(format($q$insert into public.agent_conceptions (user_id, idu, mission_origine_id)
  values ('cccccccc-0000-4000-8000-00000000000c', 'X', %L)$q$, (select id from ids where nom = 'mB_conc')),
  '22023', '2 : mission d''origine d''un autre utilisateur refusée');
select pg_temp.doit_echouer(format($q$insert into public.agent_conceptions (user_id, idu, mission_id)
  values ('cccccccc-0000-4000-8000-00000000000c', 'X', %L)$q$, (select id from ids where nom = 'mA_conc')),
  '23505', '2 : une seule conception par mission de conception');

-- ── 3. Règles PLU : jamais sans source, cohérence statut / valeur ───────────
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur_max_m","valeur":12,"unite":"m","statut":"estime"}]')$q$,
  '23514', '3 : règle sans source refusée');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur_max_m","valeur":12,"unite":"m","statut":"estime","source":"  "}]')$q$,
  '23514', '3 : source vide refusée');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur","valeur":12,"unite":"m","statut":"estime","source":"s"}]')$q$,
  '23514', '3 : clé de règle inconnue refusée');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur_max_m","valeur":12,"unite":"m","statut":"manquant","source":"s"}]')$q$,
  '23514', '3 : règle « manquant » avec une valeur refusée');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur_max_m","valeur":null,"unite":"m","statut":"confirme","source":"s"}]')$q$,
  '23514', '3 : règle « confirme » sans valeur refusée');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur_max_m","valeur":12,"statut":"estime","source":"s"}]')$q$,
  '23514', '3 : règle sans unité refusée');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '{"cle":"hauteur_max_m"}')$q$,
  '23514', '3 : regles_plu doit être une liste');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, regles_plu) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', '[{"cle":"hauteur_max_m","valeur":12,"unite":"m","statut":"estime","source":"s"},
                                                {"cle":"hauteur_max_m","valeur":15,"unite":"m","statut":"confirme","source":"u"}]')$q$,
  '23514', '3 : deux règles pour la même clé refusées');
select pg_temp.doit_echouer($q$insert into public.agent_conceptions (user_id, idu, plan_source) values
  ('cccccccc-0000-4000-8000-00000000000c', 'X', 'croquis')$q$, '23514', '3 : plan_source inconnu refusé');

-- ── 4. Modifications par le propriétaire ────────────────────────────────────
update public.agent_conceptions
   set statut = 'plan', plan_source = 'plan_fourni',
       plan_fichier = 'cccccccc-0000-4000-8000-00000000000c/' || id::text || '/plan-rdc.pdf',
       regles_plu = (select r from regles where nom = 'ok') || '[{"cle":"niveaux_max","valeur":4,"unite":"niveaux","statut":"confirme","source":"utilisateur"}]'::jsonb
 where id = (select id from ids where nom = 'cA');
select pg_temp.verifier((select statut = 'plan' and jsonb_array_length(regles_plu) = 4 and plan_source = 'plan_fourni'
                           from public.agent_conceptions where id = (select id from ids where nom = 'cA')),
                        '4 : le propriétaire modifie statut, plan et règles');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set plan_fichier = 'dddddddd-0000-4000-8000-00000000000d/%s/plan-x.pdf' where id = %L$q$,
  (select id from ids where nom = 'cA'), (select id from ids where nom = 'cA')), '23514', '4 : plan_fichier hors de <user_id>/<conception_id>/ refusé');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set plan_fichier = 'cccccccc-0000-4000-8000-00000000000c/%s/../x.pdf' where id = %L$q$,
  (select id from ids where nom = 'cA'), (select id from ids where nom = 'cA')), '23514', '4 : « .. » refusé dans plan_fichier');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set idu = 'AUTRE' where id = %L$q$, (select id from ids where nom = 'cA')),
  '42501', '4 : idu figé pour l''utilisateur');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set mission_id = null where id = %L$q$, (select id from ids where nom = 'cA')),
  '42501', '4 : mission_id figé pour l''utilisateur');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set mission_origine_id = null where id = %L$q$, (select id from ids where nom = 'cA')),
  '42501', '4 : mission_origine_id figé pour l''utilisateur');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set user_id = 'dddddddd-0000-4000-8000-00000000000d' where id = %L$q$, (select id from ids where nom = 'cA')),
  '42501', '4 : user_id figé pour l''utilisateur');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set version_courante = 9 where id = %L$q$, (select id from ids where nom = 'cA')),
  '42501', '4 : version_courante figée pour l''utilisateur');
select pg_temp.doit_echouer(format($q$delete from public.agent_conceptions where id = %L$q$, (select id from ids where nom = 'cA')),
  '42501', '4 : pas de suppression par l''utilisateur');
-- Archivage définitif côté utilisateur.
with c as (insert into public.agent_conceptions (user_id, idu) values ('cccccccc-0000-4000-8000-00000000000c', '75056000AB0099') returning id)
insert into ids select 'cA2', id from c;
update public.agent_conceptions set statut = 'archive' where id = (select id from ids where nom = 'cA2');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set statut = 'plan' where id = %L$q$, (select id from ids where nom = 'cA2')),
  '22023', '4 : l''utilisateur ne sort pas une conception de l''archive');
update public.agent_conceptions set commune = 'Paris 15e' where id = (select id from ids where nom = 'cA2');
select pg_temp.verifier((select statut = 'archive' and commune = 'Paris 15e' from public.agent_conceptions where id = (select id from ids where nom = 'cA2')),
                        '4 : conception archivée : reste archivée, autres champs modifiables');

-- ── 5. Versions par le propriétaire ─────────────────────────────────────────
insert into public.agent_conception_versions (conception_id, origine, resume, metriques, conformite, bilan, modele_ref)
values ((select id from ids where nom = 'cA'), 'generation', 'Première génération',
        '{"emprise_m2":420,"sdp_m2":1650,"shab_m2":1400,"nb_logements":22,"niveaux":4,"hauteur_m":12,"precision":"plan_fourni"}',
        '[{"cle":"hauteur_max_m","valeur_modele":12,"limite":12,"ok":true}]', '{"ca_ttc":7000000}',
        'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/modele-v1.mstudio.json');
select pg_temp.verifier((select n = 1 and user_id = 'cccccccc-0000-4000-8000-00000000000c' from public.agent_conception_versions
                          where conception_id = (select id from ids where nom = 'cA')),
                        '5 : première version numérotée 1 automatiquement');
select pg_temp.verifier((select version_courante = 1 and statut = 'modele' from public.agent_conceptions
                          where id = (select id from ids where nom = 'cA')),
                        '5 : la conception pointe sur la version 1 et passe en « modele »');

select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, n, origine, metriques)
  values (%L, 3, 'modification_clic', '{}')$q$, (select id from ids where nom = 'cA')), '23505', '5 : numéro non consécutif refusé');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, n, origine, metriques)
  values (%L, 1, 'modification_clic', '{}')$q$, (select id from ids where nom = 'cA')), '23505', '5 : numéro déjà pris refusé');
-- n fourni = suivant : accepté ; user_id fourni d'un autre est remplacé par le propriétaire.
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques, modele_ref)
  values (%L, 'generation', '{}', 'cccccccc-0000-4000-8000-00000000000c/%s/modele-v5-0a1b2c3d.mstudio.json')$q$,
  (select id from ids where nom = 'cA'), (select id from ids where nom = 'cA')), '23514', '5 : modele_ref d''un autre numéro que la version refusé');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques, modele_ref)
  values (%L, 'generation', '{}', 'cccccccc-0000-4000-8000-00000000000c/%s/modele-v2-0A1B2C3D.mstudio.json')$q$,
  (select id from ids where nom = 'cA'), (select id from ids where nom = 'cA')), '23514', '5 : suffixe en majuscules refusé dans modele_ref');
insert into public.agent_conception_versions (conception_id, n, user_id, origine, metriques, modele_ref)
values ((select id from ids where nom = 'cA'), 2, 'dddddddd-0000-4000-8000-00000000000d', 'modification_texte', '{"sdp_m2":1700}',
        'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/modele-v2-0a1b2c3d.mstudio.json');
select pg_temp.verifier((select user_id = 'cccccccc-0000-4000-8000-00000000000c' from public.agent_conception_versions
                          where conception_id = (select id from ids where nom = 'cA') and n = 2),
                        '5 : n fourni (suivant) accepté, user_id forcé au propriétaire');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques)
  values (%L, 'retouche', '{}')$q$, (select id from ids where nom = 'cA')), '23514', '5 : origine inconnue refusée');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques)
  values (%L, 'generation', null)$q$, (select id from ids where nom = 'cA')), '23502', '5 : métriques obligatoires');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques, modele_ref)
  values (%L, 'generation', '{}', 'autre/chemin/modele-v3.mstudio.json')$q$, (select id from ids where nom = 'cA')),
  '23514', '5 : modele_ref hors du dossier de la conception refusé');
select pg_temp.doit_echouer(format($q$update public.agent_conception_versions set resume = 'x' where conception_id = %L$q$,
  (select id from ids where nom = 'cA')), '42501', '5 : versions non modifiables par l''utilisateur');
select pg_temp.doit_echouer(format($q$delete from public.agent_conception_versions where conception_id = %L$q$,
  (select id from ids where nom = 'cA')), '42501', '5 : versions non supprimables par l''utilisateur');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques, cree_le)
  values (%L, 'generation', '{}', now() - interval '1 day')$q$, (select id from ids where nom = 'cA')),
  '42501', '5 : cree_le non inscriptible par l''utilisateur');

-- ── 6. Cloisonnement : B ne voit ni ne touche les données de A ──────────────
select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-00000000000d', true);
select pg_temp.verifier((select count(*) = 0 from public.agent_conceptions) and (select count(*) = 0 from public.agent_conception_versions),
                        '6 : B ne voit pas les conceptions ni les versions de A');
update public.agent_conceptions set statut = 'archive' where id = (select id from ids where nom = 'cA');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques)
  values (%L, 'generation', '{}')$q$, (select id from ids where nom = 'cA')), '42501', '6 : B ne peut pas ajouter de version à A');
reset role;
select pg_temp.verifier((select statut = 'modele' from public.agent_conceptions where id = (select id from ids where nom = 'cA')),
                        '6 : la mise à jour de B n''a rien changé chez A');

set local role anon;
select pg_temp.doit_echouer($q$select count(*) from public.agent_conceptions$q$, '42501', '6 : anon n''a aucun accès aux conceptions');
select pg_temp.doit_echouer($q$select count(*) from public.agent_conception_versions$q$, '42501', '6 : anon n''a aucun accès aux versions');
reset role;

-- ── 7. Serveur (service_role) ───────────────────────────────────────────────
set local role service_role;
insert into public.agent_conception_versions (conception_id, origine, metriques)
values ((select id from ids where nom = 'cA'), 'plan_relu', '{"sdp_m2":1720}');
select pg_temp.verifier((select version_courante = 3 from public.agent_conceptions where id = (select id from ids where nom = 'cA')),
                        '7 : le serveur ajoute la version 3, version_courante suit');
select pg_temp.doit_echouer(format($q$update public.agent_conception_versions set resume = 'x' where conception_id = %L$q$,
  (select id from ids where nom = 'cA')), '22023', '7 : même le serveur ne modifie pas une version');
update public.agent_conceptions set mission_id = (select id from ids where nom = 'mA_conc2'), idu = '75056000AB0013'
 where id = (select id from ids where nom = 'cA');
select pg_temp.verifier((select mission_id = (select id from ids where nom = 'mA_conc2') and idu = '75056000AB0013'
                           from public.agent_conceptions where id = (select id from ids where nom = 'cA')),
                        '7 : le serveur peut relier une autre mission de conception du même propriétaire');
select pg_temp.doit_echouer(format($q$update public.agent_conceptions set mission_id = %L where id = %L$q$,
  (select id from ids where nom = 'mB_conc'), (select id from ids where nom = 'cA')), '22023', '7 : même le serveur ne relie pas la mission d''un autre');
update public.agent_conceptions set statut = 'archive' where id = (select id from ids where nom = 'cA');
select pg_temp.doit_echouer(format($q$insert into public.agent_conception_versions (conception_id, origine, metriques)
  values (%L, 'generation', '{}')$q$, (select id from ids where nom = 'cA')), '22023', '7 : conception archivée : plus de nouvelle version');
update public.agent_conceptions set statut = 'pret' where id = (select id from ids where nom = 'cA');
select pg_temp.verifier((select statut = 'pret' from public.agent_conceptions where id = (select id from ids where nom = 'cA')),
                        '7 : le serveur peut sortir une conception de l''archive');
reset role;

-- ── 8. Bucket agent-conception ──────────────────────────────────────────────
select pg_temp.verifier((select not public and file_size_limit = 52428800 from storage.buckets where id = 'agent-conception'),
                        '8 : bucket agent-conception privé, 50 Mo');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-00000000000c', true);
insert into storage.objects (bucket_id, name) values
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/plan-rdc.pdf'),
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/reglement-plu-ub.pdf'),
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/modele-v1.mstudio.json'),
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/modele-v2-0a1b2c3d.mstudio.json');
select pg_temp.verifier((select count(*) = 4 from storage.objects where bucket_id = 'agent-conception'),
                        '8 : le propriétaire dépose plan, règlement et modèles (avec ou sans suffixe unique) et les relit');
select pg_temp.doit_echouer(format($q$insert into storage.objects (bucket_id, name) values ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/%s/modele-v3-0A1B2C3D.mstudio.json')$q$,
  (select id from ids where nom = 'cA')), '42501', '8 : suffixe de modèle en majuscules refusé');
select pg_temp.doit_echouer(format($q$insert into storage.objects (bucket_id, name) values ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/%s/modele-v3-xyz.mstudio.json')$q$,
  (select id from ids where nom = 'cA')), '42501', '8 : suffixe de modèle non hexadécimal refusé');
select pg_temp.doit_echouer(format($q$insert into storage.objects (bucket_id, name) values ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/%s/notes.txt')$q$,
  (select id from ids where nom = 'cA')), '42501', '8 : nom de fichier non prévu refusé');
select pg_temp.doit_echouer(format($q$insert into storage.objects (bucket_id, name) values ('agent-conception', 'dddddddd-0000-4000-8000-00000000000d/%s/plan-x.pdf')$q$,
  (select id from ids where nom = 'cA')), '42501', '8 : dépôt dans le dossier d''un autre refusé');
select pg_temp.doit_echouer($q$insert into storage.objects (bucket_id, name) values ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/00000000-0000-4000-8000-000000000000/plan-x.pdf')$q$,
  '42501', '8 : dépôt pour une conception inexistante refusé');
select pg_temp.doit_echouer($q$insert into storage.objects (bucket_id, name) values ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/plan-x.pdf')$q$,
  '42501', '8 : dépôt hors d''un dossier de conception refusé');
-- Remplacement (upsert) : permis pour un plan, refusé pour un modèle enregistré.
insert into storage.objects (bucket_id, name, metadata) values
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/' || (select id from ids where nom = 'cA')::text || '/plan-rdc.pdf', '{"v":2}')
on conflict (bucket_id, name) do update set metadata = excluded.metadata;
select pg_temp.verifier((select metadata->>'v' = '2' from storage.objects where name like '%/plan-rdc.pdf'),
                        '8 : le propriétaire remplace son plan (upsert)');
select pg_temp.doit_echouer(format($q$insert into storage.objects (bucket_id, name, metadata) values
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/%s/modele-v1.mstudio.json', '{"v":2}')
  on conflict (bucket_id, name) do update set metadata = excluded.metadata$q$, (select id from ids where nom = 'cA')),
  '42501', '8 : un modèle enregistré ne se remplace pas');
select pg_temp.doit_echouer(format($q$insert into storage.objects (bucket_id, name, metadata) values
  ('agent-conception', 'cccccccc-0000-4000-8000-00000000000c/%s/modele-v2-0a1b2c3d.mstudio.json', '{"v":2}')
  on conflict (bucket_id, name) do update set metadata = excluded.metadata$q$, (select id from ids where nom = 'cA')),
  '42501', '8 : un modèle à suffixe unique ne se remplace pas non plus');
delete from storage.objects where bucket_id = 'agent-conception';
select pg_temp.verifier((select count(*) = 4 from storage.objects where bucket_id = 'agent-conception'),
                        '8 : aucune suppression par l''utilisateur');
select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-00000000000d', true);
select pg_temp.verifier((select count(*) = 0 from storage.objects where bucket_id = 'agent-conception'),
                        '8 : B ne voit pas les fichiers de A');
reset role;
set local role service_role;
select pg_temp.verifier((select count(*) = 4 from storage.objects where bucket_id = 'agent-conception'),
                        '8 : le serveur voit tout');
reset role;

-- ── 9. Temps réel, cascades ─────────────────────────────────────────────────
select pg_temp.verifier((select count(*) = 2 from pg_publication_tables
                          where pubname = 'supabase_realtime' and schemaname = 'public'
                            and tablename in ('agent_conceptions', 'agent_conception_versions')),
                        '9 : les deux tables sont publiées en temps réel');
-- Suppression d'une mission : mission_id passe à null malgré le déclencheur.
delete from public.agent_missions where id = (select id from ids where nom = 'mA_conc2');
delete from public.agent_missions where id = (select id from ids where nom = 'mA_prosp');
select pg_temp.verifier((select mission_id is null and mission_origine_id is null from public.agent_conceptions
                          where id = (select id from ids where nom = 'cA')),
                        '9 : mission supprimée → liens remis à null');
delete from auth.users where id = 'cccccccc-0000-4000-8000-00000000000c';
select pg_temp.verifier((select count(*) = 0 from public.agent_conceptions where id = (select id from ids where nom = 'cA'))
                        and (select count(*) = 0 from public.agent_conception_versions where conception_id = (select id from ids where nom = 'cA')),
                        '9 : suppression du compte → conceptions et versions supprimées');

do $$ begin raise notice 'TOUS LES TESTS agent_conception SONT PASSÉS'; end $$;
rollback;
