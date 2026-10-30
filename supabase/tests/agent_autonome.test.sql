-- =============================================================================
-- Tests de la migration 20261030_agent_autonome.sql
-- =============================================================================
-- Tout se passe dans UNE transaction terminée par ROLLBACK : aucune trace.
-- Chaque vérification lève une exception si elle échoue (la transaction est
-- alors annulée et psql s'arrête).
--
-- Lancement local (PostgreSQL vierge + bouchon) :
--   psql -v ON_ERROR_STOP=1 -f agent_autonome_stub_supabase.sql
--        -f ../migrations/20261030_agent_autonome.sql   (deux fois : rejouable)
--        -f agent_autonome.test.sql
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
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'agent-test-a@exemple.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'agent-test-b@exemple.invalid')
on conflict do nothing;
insert into public.credit_accounts (user_id, current_credits) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 10000),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 100)
on conflict (user_id) do update set current_credits = excluded.current_credits;

create temp table ids (nom text primary key, id uuid);
grant select, insert, update on ids to authenticated, service_role;

-- ── 0. B1 : l'utilisateur garde ses écritures existantes (session neuve) ────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
-- Même requête que setLearningEnabled (src/lib/mimmozia/track.ts) : upsert.
insert into public.user_ai_preferences (user_id, learning_enabled, updated_at)
values ('aaaaaaaa-0000-4000-8000-00000000000a', false, now())
on conflict (user_id) do update set learning_enabled = excluded.learning_enabled, updated_at = excluded.updated_at;
insert into public.user_ai_preferences (user_id, learning_enabled, updated_at)
values ('aaaaaaaa-0000-4000-8000-00000000000a', true, now())
on conflict (user_id) do update set learning_enabled = excluded.learning_enabled, updated_at = excluded.updated_at;
select pg_temp.verifier((select learning_enabled from public.user_ai_preferences where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                        'B1 : l''utilisateur modifie learning_enabled (upsert)');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select public.agent_memoire_ecrire('aaaaaaaa-0000-4000-8000-00000000000a', null, null, 'fait', 'b1-test', 'contenu initial', 'get_test', 'estime', false);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
update public.agent_memoire_projet set contenu = 'contenu corrigé', epingle = true where cle = 'b1-test';
select pg_temp.verifier((select contenu = 'contenu corrigé' and epingle and source = 'utilisateur'
                           from public.agent_memoire_projet where cle = 'b1-test'),
                        'B1 : l''utilisateur édite sa mémoire');
delete from public.agent_memoire_projet where cle = 'b1-test';
select pg_temp.verifier(not exists (select 1 from public.agent_memoire_projet where cle = 'b1-test'),
                        'l''utilisateur supprime un élément de sa mémoire');
reset role;

-- ── 1. Le moteur (service_role) crée des missions ───────────────────────────
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
with ins as (
  insert into public.agent_missions (user_id, origine, type, objectif, devis, etapes_max, jetons_consommes, statut)
  select 'aaaaaaaa-0000-4000-8000-00000000000a', 'chat', 'prospection_fonciere', 'Mission test ' || g,
         jsonb_build_object('jetons_min', 400, 'jetons_max', 1000, 'etapes_max', 40, 'tier', 'pro'),
         case when g = 5 then 2 else 40 end, 999, 'devis'
    from generate_series(1, 6) g
  returning id, objectif)
insert into ids select 'm' || split_part(objectif, ' ', 3), id from ins;

select pg_temp.verifier((select bool_and(statut = 'devis' and jetons_consommes = 0 and reservation_id is null)
                           from public.agent_missions where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                        'création moteur : compteurs serveur remis à zéro');
select pg_temp.doit_echouer($q$insert into public.agent_missions (user_id, type, objectif, statut)
                              values ('aaaaaaaa-0000-4000-8000-00000000000a', 'libre', 'x', 'en_cours')$q$,
                            '22023', 'création directement en_cours refusée');
reset role;

-- ── 2. Lancement par l'utilisateur, réservation par le moteur ───────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select public.agent_mission_valider_devis((select id from ids where nom = 'm1'));
select pg_temp.verifier((select statut = 'en_attente' from public.agent_missions where id = (select id from ids where nom = 'm1')),
                        'valider_devis : devis → en_attente');
select pg_temp.doit_echouer(format('select public.agent_mission_reserver(%L)', (select id from ids where nom = 'm1')),
                            '42501', 'l''utilisateur ne peut pas appeler une RPC du moteur');
select pg_temp.doit_echouer(format('update public.agent_missions set jetons_reserves = 999999 where id = %L', (select id from ids where nom = 'm1')),
                            '42501', 'l''utilisateur ne peut pas modifier une mission directement');
reset role;

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
select pg_temp.verifier((public.agent_mission_reserver((select id from ids where nom = 'm1'))->>'ok')::boolean,
                        'reserver : réservation posée');
select pg_temp.verifier((select statut = 'en_cours' and jetons_reserves = 1000 and reservation_id is not null
                           from public.agent_missions where id = (select id from ids where nom = 'm1')),
                        'reserver : en_attente → en_cours avec 1000 jetons réservés');
select pg_temp.verifier((select current_credits = 9000 from public.credit_accounts where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                        'reserver : solde 10000 → 9000');
select pg_temp.verifier((select reason = 'mission:' || (select id from ids where nom = 'm1')::text
                           from public.copilot_reservations r join public.agent_missions m on m.reservation_id = r.id
                          where m.id = (select id from ids where nom = 'm1')),
                        'reserver : raison « mission:<id> » sur la réservation');
select pg_temp.verifier(((select count(*) from public.agent_mission_prendre('test', 120)) >= 1),
                        'prendre : la mission en cours est prise');
select pg_temp.verifier(((select count(*) from public.agent_mission_prendre('test-2', 120)
                          where id = (select id from ids where nom = 'm1')) = 0),
                        'prendre : bail posé, un second worker ne la reprend pas');

-- ── 3. Débit plafonné et peut_continuer ─────────────────────────────────────
do $$
declare r jsonb; v_id uuid := (select id from ids where nom = 'm1');
begin
  r := public.agent_mission_debiter(v_id, 1, 300, 500, '{"plan":["cadrer"]}');
  perform pg_temp.verifier((r->>'reste')::int = 700 and (r->>'peut_continuer')::boolean, 'debiter 300 : reste 700, peut continuer (pire cas 500)');
  perform pg_temp.verifier((select etat->'plan'->>0 = 'cadrer' from public.agent_missions where id = v_id),
                           'debiter : état sauvé dans la même transaction');
  r := public.agent_mission_debiter(v_id, 1, 300, 500, '{"plan":["autre"]}');
  perform pg_temp.verifier((r->>'deja_debite')::boolean and (r->>'reste')::int = 700 and (r->>'etapes_faites')::int = 1
                           and (select etat->'plan'->>0 = 'cadrer' from public.agent_missions where id = v_id),
                           'debiter : étape 1 rejouée → ni redébitée ni état réécrit (idempotent)');
  r := public.agent_mission_debiter(v_id, 2, 300, 0, jsonb_build_object('gros', repeat('x', 600000)));
  perform pg_temp.verifier(not (r->>'ok')::boolean and r->>'raison' = 'etat_trop_gros'
                           and (select jetons_consommes = 300 and etapes_faites = 1 from public.agent_missions where id = v_id)
                           and not exists (select 1 from public.agent_mission_debits where mission_id = v_id and n = 2),
                           'debiter : état > 512 Ko refusé proprement, rien débité');
  r := public.agent_mission_debiter(v_id, 2, 300, 500);
  perform pg_temp.verifier((r->>'reste')::int = 400 and not (r->>'peut_continuer')::boolean, 'debiter 300 : reste 400 < pire cas 500 → arrêt');
  r := public.agent_mission_debiter(v_id, 3, 600, 0);
  perform pg_temp.verifier((r->>'reste')::int = 0 and (r->>'jetons_consommes')::int = 1000 and (r->>'perte_absorbee')::int = 200,
                           'debiter 600 : plafonné à la réserve (1000), 200 jetons absorbés');
  perform pg_temp.verifier((select jetons_perte_absorbee = 200 and etapes_faites = 3 from public.agent_missions where id = v_id),
                           'perte absorbée enregistrée, 3 étapes comptées');
  perform pg_temp.verifier(exists (select 1 from public.agent_mission_journal where mission_id = v_id and genre = 'erreur' and outil = 'facturation'),
                           'perte absorbée journalisée');
  perform pg_temp.doit_echouer(format('select public.agent_mission_debiter(%L, 4, -5, 0)', v_id), '22023', 'débit négatif refusé');

  -- Clôture + règlement : 1000 facturés, rien remboursé, solde inchangé (9000).
  perform public.agent_mission_cloturer(v_id, 'budget_atteint', '{"titre":"partiel"}', null);
  r := public.agent_mission_regler(v_id);
  perform pg_temp.verifier((r->>'jetons_factures')::int = 1000 and (r->>'jetons_rembourses')::int = 0, 'regler : 1000 facturés, 0 remboursé');
  perform pg_temp.verifier((select current_credits = 9000 from public.credit_accounts where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                           'regler : jamais facturé au-delà de la réserve (solde 9000)');
  r := public.agent_mission_regler(v_id);
  perform pg_temp.verifier((r->>'deja_regle')::boolean, 'regler : idempotent');
  perform pg_temp.verifier(((public.agent_mission_debiter(v_id, 5, 10, 0))->>'ok')::boolean is false, 'debiter après règlement : refusé');
  perform pg_temp.doit_echouer(format('update public.agent_missions set statut = ''en_cours'' where id = %L', v_id),
                               '22023', 'mission close : jamais ressuscitée');
end $$;

-- etapes_max : mission m5 (etapes_max = 2)
update public.agent_missions set statut = 'en_attente' where id = (select id from ids where nom = 'm5');
select public.agent_mission_reserver((select id from ids where nom = 'm5'));
do $$
declare r jsonb; v_id uuid := (select id from ids where nom = 'm5');
begin
  r := public.agent_mission_debiter(v_id, 1, 10, 10);
  perform pg_temp.verifier((r->>'peut_continuer')::boolean, 'etapes 1/2 : peut continuer');
  r := public.agent_mission_debiter(v_id, 2, 10, 10);
  perform pg_temp.verifier(not (r->>'peut_continuer')::boolean, 'etapes 2/2 : etapes_max atteint → arrêt');
end $$;
reset role;

-- ── 4. Plafond de 3 missions actives ────────────────────────────────────────
-- Actives à ce stade : m5 (en_cours). On valide m2 et m3 → 3 actives ; m4 refusée.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select public.agent_mission_valider_devis((select id from ids where nom = 'm2'));
select public.agent_mission_valider_devis((select id from ids where nom = 'm3'));
select pg_temp.doit_echouer(format('select public.agent_mission_valider_devis(%L)', (select id from ids where nom = 'm4')),
                            'P0001', 'plafond : 4e mission active refusée');
-- Annuler une mission libère une place.
select public.agent_mission_annuler((select id from ids where nom = 'm3'));
select public.agent_mission_valider_devis((select id from ids where nom = 'm4'));
select pg_temp.verifier((select statut = 'en_attente' from public.agent_missions where id = (select id from ids where nom = 'm4')),
                        'plafond : place libérée après annulation');
reset role;

-- ── 5. Annulation et remboursement du non-consommé ─────────────────────────
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
do $$
declare r jsonb; v_id uuid := (select id from ids where nom = 'm2'); v_avant int;
begin
  perform public.agent_mission_reserver(v_id);
  select current_credits into v_avant from public.credit_accounts where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
  perform public.agent_mission_debiter(v_id, 1, 250, 100);
  -- l'utilisateur annule pendant la mission
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
  perform public.agent_mission_annuler(v_id);
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.verifier(not ((public.agent_mission_debiter(v_id, 1, 0, 0))->>'peut_continuer')::boolean,
                           'annulation : peut_continuer devient faux');
  perform pg_temp.verifier(exists (select 1 from public.agent_mission_prendre('test-3', 120) where id = v_id) or
                           exists (select 1 from public.agent_missions where id = v_id and bail_jusqu_a is not null),
                           'prendre : une mission annulée non réglée est à reprendre');
  perform public.agent_mission_cloturer(v_id, 'annulee', '{"titre":"annulée"}', null);
  perform pg_temp.verifier((select statut = 'annulee' from public.agent_missions where id = v_id), 'cloturer : statut annulée conservé');
  r := public.agent_mission_regler(v_id);
  perform pg_temp.verifier((r->>'jetons_factures')::int = 250 and (r->>'jetons_rembourses')::int = 750, 'annulation : 250 facturés, 750 remboursés');
  perform pg_temp.verifier((select current_credits = v_avant + 750 from public.credit_accounts where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                           'annulation : solde recrédité de 750');
end $$;

-- Mission sans aucune consommation : remboursement intégral (pas de plancher à 1 jeton).
do $$
declare r jsonb; v_id uuid := (select id from ids where nom = 'm4'); v_avant int;
begin
  select current_credits into v_avant from public.credit_accounts where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
  perform public.agent_mission_reserver(v_id);
  perform public.agent_mission_cloturer(v_id, 'echec', null, 'test');
  r := public.agent_mission_regler(v_id);
  perform pg_temp.verifier((r->>'jetons_factures')::int = 0, 'aucune consommation : 0 jeton facturé');
  perform pg_temp.verifier((select current_credits = v_avant from public.credit_accounts where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                           'aucune consommation : solde intact');
end $$;

-- Solde insuffisant (B a 100 jetons, devis à 1000)
with x as (
  insert into public.agent_missions (user_id, type, objectif, devis, statut)
  values ('bbbbbbbb-0000-4000-8000-00000000000b', 'faisabilite', 'Mission de B',
          '{"jetons_min":400,"jetons_max":1000}', 'devis') returning id)
insert into ids select 'mb', id from x;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', true);
select pg_temp.doit_echouer(format('select public.agent_mission_valider_devis(%L)', (select id from ids where nom = 'mb')),
                            'P0001', 'valider_devis : solde insuffisant refusé tout de suite');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
update public.agent_missions set statut = 'en_attente' where id = (select id from ids where nom = 'mb');
select pg_temp.verifier(((public.agent_mission_reserver((select id from ids where nom = 'mb')))->>'raison') = 'solde_insuffisant',
                        'reserver : solde insuffisant détecté');
select pg_temp.verifier((select statut = 'echec' and erreur = 'solde insuffisant' from public.agent_missions where id = (select id from ids where nom = 'mb'))
                        and (select current_credits = 100 from public.credit_accounts where user_id = 'bbbbbbbb-0000-4000-8000-00000000000b'),
                        'solde insuffisant : mission en échec, rien débité');

-- ── 6. Question / réponse ───────────────────────────────────────────────────
update public.agent_missions set statut = 'attente_utilisateur', question_en_attente = 'Quel budget de charge foncière ?'
 where id = (select id from ids where nom = 'm5');
select pg_temp.verifier(not exists (select 1 from public.agent_mission_prendre('test-4', 120) where id = (select id from ids where nom = 'm5')),
                        'prendre : une mission en attente de réponse dort');
select pg_temp.verifier((select attente_depuis is not null from public.agent_missions where id = (select id from ids where nom = 'm5')),
                        'attente_depuis posé à l''entrée en attente');
-- Bail rendu et attente vieillie de 73 h → la mission est renvoyée pour clôture.
update public.agent_missions set attente_depuis = now() - interval '73 hours', bail_jusqu_a = null
 where id = (select id from ids where nom = 'm5');
select pg_temp.verifier(exists (select 1 from public.agent_mission_prendre('test-5', 120) where id = (select id from ids where nom = 'm5')),
                        'prendre : attente sans réponse depuis > 72 h → renvoyée pour clôture');
update public.agent_missions set attente_depuis = now(), bail_jusqu_a = null where id = (select id from ids where nom = 'm5');
select pg_temp.verifier((select count(*) <= 5 from public.agent_mission_prendre('test-6', 120)), 'prendre : 5 missions au plus');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select public.agent_mission_repondre((select id from ids where nom = 'm5'), '1,2 M€ maximum');
select pg_temp.verifier((select statut = 'en_cours' and question_en_attente is null and etat->'derniere_reponse'->>'reponse' = '1,2 M€ maximum'
                           from public.agent_missions where id = (select id from ids where nom = 'm5')),
                        'repondre : attente_utilisateur → en_cours, réponse dans etat');
select pg_temp.verifier(exists (select 1 from public.agent_mission_journal where mission_id = (select id from ids where nom = 'm5') and genre = 'reponse'),
                        'repondre : réponse journalisée');
reset role;

-- ── 7. Actions externes ─────────────────────────────────────────────────────
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
with x as (
  insert into public.agent_actions_externes (user_id, mission_id, canal, destinataire, objet, corps, statut, valide_le, envoye_le)
  values ('aaaaaaaa-0000-4000-8000-00000000000a', (select id from ids where nom = 'm5'), 'courrier',
          '{"nom":"M. Propriétaire","qualite":"proprietaire","adresse":"1 rue Test"}',
          'Votre parcelle AB 12', 'Madame, Monsieur, …', 'envoye', now(), now())
  returning id)
insert into ids select 'a1', id from x;
select pg_temp.verifier((select statut = 'brouillon' and valide_le is null and envoye_le is null
                           from public.agent_actions_externes where id = (select id from ids where nom = 'a1')),
                        'moteur : une action se crée TOUJOURS en brouillon (envoye demandé → brouillon)');
select pg_temp.doit_echouer(format('update public.agent_actions_externes set statut = ''valide'' where id = %L', (select id from ids where nom = 'a1')),
                            '42501', 'moteur : ne peut pas valider à la place de l''utilisateur');
select pg_temp.doit_echouer(format('update public.agent_actions_externes set statut = ''envoye'' where id = %L', (select id from ids where nom = 'a1')),
                            '42501', 'moteur : ne peut pas envoyer un brouillon');
select pg_temp.doit_echouer($q$insert into public.agent_actions_externes (user_id, mission_id, canal, destinataire, objet, corps)
                              values ('bbbbbbbb-0000-4000-8000-00000000000b', (select id from ids where nom = 'm5'), 'email', '{"qualite":"mairie"}', 'x', 'y')$q$,
                            '22023', 'moteur : action rattachée à la mission d''un autre utilisateur refusée');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', true);
select pg_temp.doit_echouer(format('select public.agent_action_valider(%L, null, null)', (select id from ids where nom = 'a1')),
                            'P0002', 'B ne peut pas valider l''action de A');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select pg_temp.doit_echouer(format('update public.agent_actions_externes set statut = ''envoye'' where id = %L', (select id from ids where nom = 'a1')),
                            '42501', 'utilisateur : ne peut pas passer une action à envoye (écriture directe)');
select public.agent_action_valider((select id from ids where nom = 'a1'), 'Votre parcelle AB 12 — proposition', null);
select pg_temp.verifier((select statut = 'valide' and valide_le is not null and objet = 'Votre parcelle AB 12 — proposition'
                           from public.agent_actions_externes where id = (select id from ids where nom = 'a1')),
                        'utilisateur : valide son action en corrigeant l''objet');
select pg_temp.doit_echouer(format('update public.agent_actions_externes set statut = ''envoye'' where id = %L', (select id from ids where nom = 'a1')),
                            '42501', 'utilisateur : ne peut toujours pas passer à envoye une action validée');
reset role;

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
select pg_temp.doit_echouer(format('update public.agent_actions_externes set corps = ''texte changé'' where id = %L', (select id from ids where nom = 'a1')),
                            '22023', 'action validée : texte figé');
update public.agent_actions_externes set statut = 'envoye' where id = (select id from ids where nom = 'a1');
select pg_temp.verifier((select statut = 'envoye' and envoye_le is not null from public.agent_actions_externes where id = (select id from ids where nom = 'a1')),
                        'serveur : valide → envoye');
select pg_temp.doit_echouer(format('update public.agent_actions_externes set statut = ''valide'' where id = %L', (select id from ids where nom = 'a1')),
                            '42501', 'envoye est définitif');
reset role;

-- ── 8. Mémoire, briefings, préférences ──────────────────────────────────────
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);   -- le moteur n'a pas d'utilisateur
select public.agent_memoire_ecrire('aaaaaaaa-0000-4000-8000-00000000000a', null, null, 'hypothese', 'prix-sortie', '5 200 €/m² (estimé)', 'get_dvf', 'estime', false);
select public.agent_memoire_ecrire('aaaaaaaa-0000-4000-8000-00000000000a', null, null, 'hypothese', 'prix-sortie', '5 400 €/m² (DVF 2025)', 'get_dvf', 'confirme', true);
select pg_temp.verifier((select count(*) = 1 and min(contenu) = '5 400 €/m² (DVF 2025)' and bool_and(epingle)
                           from public.agent_memoire_projet where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and cle = 'prix-sortie'),
                        'memoire_ecrire : mise à jour sur la même clé (pas de doublon)');
insert into public.agent_briefings (user_id, titre, elements) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'Pendant votre absence', '[]');
insert into public.user_ai_preferences (user_id, proactif_actif, budget_proactif_mensuel, proactif_consomme_mois, proactif_mois)
values ('aaaaaaaa-0000-4000-8000-00000000000a', true, 5000, 1234, date_trunc('month', now())::date)
on conflict (user_id) do update set proactif_actif = true, budget_proactif_mensuel = 5000,
                                    proactif_consomme_mois = 1234, proactif_mois = date_trunc('month', now())::date;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
update public.agent_memoire_projet set contenu = '5 300 €/m² (corrigé)'
 where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and cle = 'prix-sortie';
select pg_temp.doit_echouer($q$update public.agent_memoire_projet set cle = 'piratage' where cle = 'prix-sortie'$q$,
                            '42501', 'mémoire : la clé n''est pas modifiable par l''utilisateur');
select pg_temp.verifier((select source = 'utilisateur' and cle = 'prix-sortie' and contenu = '5 300 €/m² (corrigé)'
                           from public.agent_memoire_projet where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and cle = 'prix-sortie'),
                        'mémoire : l''utilisateur corrige le contenu (source = utilisateur, clé figée)');
update public.user_ai_preferences set proactif_consomme_mois = 0 where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
select pg_temp.verifier((select proactif_consomme_mois = 1234 from public.user_ai_preferences where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                        'préférences : l''utilisateur ne peut pas remettre son compteur à zéro');
select pg_temp.doit_echouer('select public.agent_preferences_proactif(true, 30000)', '22023', 'préférences : budget > 20 000 refusé');
select pg_temp.verifier(((public.agent_preferences_proactif(true, 8000))->>'restant')::int = 8000 - 1234,
                        'préférences : budget enregistré, restant = budget − consommé');
select pg_temp.verifier(public.agent_briefing_marquer_lu((select id from public.agent_briefings where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a' limit 1)),
                        'briefing : marqué lu par son propriétaire');

reset role;

-- ── 8b. Veille proactive : réservation revérifiée, désactivation = annulation
-- État : veille active, budget 8000, consommé 1234 → restant 6766.
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
with x as (
  insert into public.agent_missions (user_id, origine, type, objectif, devis, statut)
  values ('aaaaaaaa-0000-4000-8000-00000000000a', 'proactif', 'veille', 'Veille p1', '{"jetons_max":1000}', 'en_attente'),
         ('aaaaaaaa-0000-4000-8000-00000000000a', 'proactif', 'veille', 'Veille p2', '{"jetons_max":6000}', 'en_attente')
  returning id, objectif)
insert into ids select 'p' || right(objectif, 1), id from x;
select pg_temp.verifier(((public.agent_mission_reserver((select id from ids where nom = 'p1')))->>'ok')::boolean,
                        'proactif : réservation dans le budget du mois');
select pg_temp.verifier(((public.agent_mission_reserver((select id from ids where nom = 'p2')))->>'raison') = 'budget_proactif_epuise',
                        'proactif : budget restant (réserves en cours déduites) insuffisant → refus');
select pg_temp.verifier((select statut = 'annulee' and reservation_id is null from public.agent_missions where id = (select id from ids where nom = 'p2')),
                        'proactif : mission annulée, rien réservé');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select public.agent_preferences_proactif(false, 8000);
select pg_temp.verifier((select statut = 'annulee' from public.agent_missions where id = (select id from ids where nom = 'p1')),
                        'proactif : désactiver la veille annule les missions proactives actives');
select pg_temp.verifier((select statut = 'en_cours' from public.agent_missions where id = (select id from ids where nom = 'm5')),
                        'proactif : les missions du chat ne sont pas touchées');
select public.agent_preferences_proactif(true, 8000);
reset role;

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.verifier(((public.agent_mission_regler((select id from ids where nom = 'p1')))->>'jetons_rembourses')::int = 1000,
                        'proactif annulée : réserve intégralement remboursée');
with x as (
  insert into public.agent_missions (user_id, origine, type, objectif, devis, statut)
  values ('aaaaaaaa-0000-4000-8000-00000000000a', 'proactif', 'veille', 'Veille p3', '{"jetons_max":1000}', 'en_attente')
  returning id)
insert into ids select 'p3', id from x;
select public.agent_mission_reserver((select id from ids where nom = 'p3'));
select public.agent_mission_debiter((select id from ids where nom = 'p3'), 1, 100, 100);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
insert into public.user_ai_preferences (user_id, learning_enabled, updated_at)
values ('aaaaaaaa-0000-4000-8000-00000000000a', false, now())
on conflict (user_id) do update set learning_enabled = excluded.learning_enabled, updated_at = excluded.updated_at;
select pg_temp.verifier((select statut = 'annulee' from public.agent_missions where id = (select id from ids where nom = 'p3')),
                        'proactif : couper l''apprentissage annule les missions proactives actives');
reset role;

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select public.agent_mission_cloturer((select id from ids where nom = 'p3'), 'annulee', null, null);
select pg_temp.verifier(((public.agent_mission_regler((select id from ids where nom = 'p3')))->>'jetons_factures')::int = 100,
                        'proactif : 100 jetons facturés');
select pg_temp.verifier((select proactif_consomme_mois = 1334 from public.user_ai_preferences where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
                        'proactif : jetons facturés ajoutés au compteur du mois (1234 + 100)');
with x as (
  insert into public.agent_missions (user_id, origine, type, objectif, devis, statut)
  values ('aaaaaaaa-0000-4000-8000-00000000000a', 'proactif', 'veille', 'Veille p4', '{"jetons_max":500}', 'en_attente')
  returning id)
insert into ids select 'p4', id from x;
select pg_temp.verifier(((public.agent_mission_reserver((select id from ids where nom = 'p4')))->>'raison') = 'proactif_desactive',
                        'proactif : apprentissage coupé → réservation refusée, mission annulée');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select pg_temp.doit_echouer($q$delete from public.user_ai_preferences where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$q$,
                            '42501', 'M1 : DELETE des réglages refusé quand la veille a consommé ce mois-ci');
reset role;

-- ── 9. RLS : lecture croisée interdite ──────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', true);
select pg_temp.verifier((select count(*) = 0 from public.agent_missions where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'), 'RLS : B ne voit pas les missions de A');
select pg_temp.verifier((select count(*) = 0 from public.agent_mission_journal where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'), 'RLS : B ne voit pas le journal de A');
select pg_temp.verifier((select count(*) = 0 from public.agent_memoire_projet where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'), 'RLS : B ne voit pas la mémoire de A');
select pg_temp.verifier((select count(*) = 0 from public.agent_actions_externes where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'), 'RLS : B ne voit pas les actions de A');
select pg_temp.verifier((select count(*) = 0 from public.agent_briefings where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'), 'RLS : B ne voit pas les briefings de A');
select pg_temp.verifier((select count(*) = 1 from public.agent_missions where user_id = 'bbbbbbbb-0000-4000-8000-00000000000b'), 'RLS : B voit sa propre mission');
delete from public.agent_memoire_projet where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
select pg_temp.doit_echouer(format('select public.agent_mission_annuler(%L)', (select id from ids where nom = 'm5')),
                            'P0002', 'B ne peut pas annuler la mission de A');
select pg_temp.verifier(not public.agent_briefing_marquer_lu((select id from ids where nom = 'm5')), 'B ne marque rien comme lu chez A');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', true);
select pg_temp.verifier((select count(*) = 1 from public.agent_memoire_projet), 'RLS : la suppression par B n''a rien effacé chez A');
select pg_temp.verifier((select count(*) >= 6 from public.agent_missions), 'RLS : A voit ses missions');
reset role;

set local role anon;
select pg_temp.doit_echouer('select count(*) from public.agent_missions', '42501', 'anon : aucun accès aux missions');
select pg_temp.doit_echouer('select public.agent_mission_annuler(gen_random_uuid())', '42501', 'anon : aucune RPC utilisateur');
reset role;

do $$ begin raise notice 'TOUS LES TESTS agent_autonome SONT PASSÉS'; end $$;
rollback;
