-- Tests de la migration 20261026_studio_jobs.sql (PostgreSQL local + bouchon).
-- Lancement : psql -v ON_ERROR_STOP=1 -f studio_jobs_stub_supabase.sql
--             -f ../migrations/20261026_studio_jobs.sql (deux fois : rejouable)
--             -f studio_jobs.test.sql
-- Chaque vérification lève une exception si elle échoue.
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222') on conflict do nothing;

create or replace function pg_temp.verifier(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;

-- Utilisateur A connecté
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- 1. Création : champs serveur forcés
insert into public.studio_jobs (user_id, conversation_id, type, statut, progression, etape, fiche, options, resultat, erreur, worker_id, termine_le)
values ('11111111-1111-1111-1111-111111111111', 'conv-1', 'film', 'termine', 100, 'triche', '{"version":1}', '{"duree_s":60,"ambiance":"jour","format":"16:9","interieurs":true,"musique":true}',
        '{"video_path":"x"}', 'x', 'w', now());
select pg_temp.verifier((select statut = 'en_attente' and progression = 0 and etape is null and resultat is null and erreur is null and worker_id is null and termine_le is null
                           from public.studio_jobs where conversation_id = 'conv-1'), 'création : statut et suivi forcés');

-- 2. Options invalides refusées
do $$ begin
  begin
    insert into public.studio_jobs (user_id, type, fiche, options) values ('11111111-1111-1111-1111-111111111111', 'film', '{}', '{"duree_s":45}');
    raise exception 'ÉCHEC : durée 45 s acceptée';
  exception when sqlstate '22023' then raise notice 'ok : options invalides refusées';
  end;
  begin
    insert into public.studio_jobs (user_id, type, fiche, options) values ('11111111-1111-1111-1111-111111111111', 'visite360', '{}', '{"resolution":"12k"}');
    raise exception 'ÉCHEC : résolution 12k acceptée';
  exception when sqlstate '22023' then raise notice 'ok : résolution invalide refusée';
  end;
  begin
    insert into public.studio_jobs (user_id, type, fiche, options) values ('11111111-1111-1111-1111-111111111111', 'film', '{}', '{"pirate":1}');
    raise exception 'ÉCHEC : clé inconnue acceptée';
  exception when sqlstate '22023' then raise notice 'ok : clé inconnue refusée';
  end;
end $$;

-- 3. Création pour un autre utilisateur refusée (RLS)
do $$ begin
  begin
    insert into public.studio_jobs (user_id, type, fiche) values ('22222222-2222-2222-2222-222222222222', 'film', '{}');
    raise exception 'ÉCHEC : création pour autrui acceptée';
  exception when insufficient_privilege then raise notice 'ok : création pour autrui refusée';
  end;
end $$;

-- 4. Plafond : 2 actifs
insert into public.studio_jobs (user_id, conversation_id, type, fiche, options) values ('11111111-1111-1111-1111-111111111111', 'conv-2', 'visite360', '{}', '{"ambiance":"nuit","interieurs":false,"resolution":"8k"}');
do $$ begin
  begin
    insert into public.studio_jobs (user_id, type, fiche) values ('11111111-1111-1111-1111-111111111111', 'film', '{}');
    raise exception 'ÉCHEC : troisième travail actif accepté';
  exception when raise_exception then
    if sqlerrm like 'Vous avez déjà 2%' then raise notice 'ok : plafond de 2 travaux actifs'; else raise; end if;
  end;
end $$;

-- 5. Modification des champs serveur ignorée, annulation permise
update public.studio_jobs set progression = 99, statut = 'termine', resultat = '{"a":1}', options = '{}' where conversation_id = 'conv-1';
select pg_temp.verifier((select statut = 'en_attente' and progression = 0 and resultat is null and options ? 'duree_s' from public.studio_jobs where conversation_id = 'conv-1'),
                        'modification des champs serveur ignorée');
update public.studio_jobs set statut = 'annule' where conversation_id = 'conv-1';
select pg_temp.verifier((select statut = 'annule' and termine_le is not null from public.studio_jobs where conversation_id = 'conv-1'), 'annulation par l''utilisateur');
update public.studio_jobs set statut = 'en_attente' where conversation_id = 'conv-1';
select pg_temp.verifier((select statut = 'annule' from public.studio_jobs where conversation_id = 'conv-1'), 'un travail annulé ne se relance pas');

-- 6. Après annulation, une nouvelle place est libre
insert into public.studio_jobs (user_id, conversation_id, type, fiche) values ('11111111-1111-1111-1111-111111111111', 'conv-3', 'film', '{}');
select pg_temp.verifier(true, 'place libérée après annulation');

-- 7. Pas de suppression (comme en production : droit DELETE accordé à
--    « authenticated » par défaut, mais aucune politique ne l'autorise)
reset role;
grant delete on public.studio_jobs to authenticated;
set role authenticated;
delete from public.studio_jobs;
select pg_temp.verifier((select count(*) = 3 from public.studio_jobs), 'aucune suppression possible');

-- 8. Fonctions worker interdites à l'utilisateur
do $$ begin
  begin
    perform public.studio_job_prendre('pirate', array['film']);
    raise exception 'ÉCHEC : studio_job_prendre accessible';
  exception when insufficient_privilege then raise notice 'ok : fonctions worker interdites à l''utilisateur';
  end;
end $$;

-- 9. Isolation : B ne voit rien
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select pg_temp.verifier((select count(*) = 0 from public.studio_jobs), 'un autre utilisateur ne voit pas ces travaux');
update public.studio_jobs set statut = 'annule';
reset role;
select pg_temp.verifier((select count(*) = 1 from public.studio_jobs where statut = 'annule'), 'un autre utilisateur ne peut pas annuler');

-- 10. Worker
set role service_role;
select pg_temp.verifier((select (public.studio_job_prendre('omen', array['visite360'])).conversation_id = 'conv-2'), 'prendre : filtre par type et ordre d''arrivée');
select pg_temp.verifier((select statut = 'en_cours' and worker_id = 'omen' and demarre_le is not null from public.studio_jobs where conversation_id = 'conv-2'), 'prendre : passe en cours');
select pg_temp.verifier(public.studio_job_avancer((select id from public.studio_jobs where conversation_id = 'conv-2'), 150, 'Rendu 3/6'), 'avancer');
select pg_temp.verifier((select progression = 100 and etape = 'Rendu 3/6' from public.studio_jobs where conversation_id = 'conv-2'), 'avancer : progression bornée à 100');
select pg_temp.verifier(public.studio_job_terminer((select id from public.studio_jobs where conversation_id = 'conv-2'),
         '{"visite_id":"abc","manifest_path":"abc/manifest.json","panoramas":6,"avertissements":[]}', '[{"categorie":"voitures","raison":"aucun asset photoréaliste installé"}]'), 'terminer');
select pg_temp.verifier((select statut = 'termine' and jsonb_array_length(elements_omis) = 1 from public.studio_jobs where conversation_id = 'conv-2'), 'terminer : résultat et éléments omis');
select pg_temp.verifier(not public.studio_job_avancer((select id from public.studio_jobs where conversation_id = 'conv-2'), 10, 'x'), 'avancer un travail terminé : refusé');
select pg_temp.verifier((public.studio_job_prendre('omen', array['visite360'])).id is null, 'prendre : rien en attente');
-- annulé pendant le calcul : le worker le voit et ne peut pas le terminer
select public.studio_job_prendre('omen', array['film']);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.studio_jobs set statut = 'annule' where conversation_id = 'conv-3';
reset role;
set role service_role;
select pg_temp.verifier(not public.studio_job_avancer((select id from public.studio_jobs where conversation_id = 'conv-3'), 50, 'x'), 'avancer après annulation : false (le worker s''arrête)');
select pg_temp.verifier(not public.studio_job_terminer((select id from public.studio_jobs where conversation_id = 'conv-3'), '{}', '[]'), 'terminer après annulation : refusé');
select pg_temp.verifier((select statut = 'annule' from public.studio_jobs where conversation_id = 'conv-3'), 'un travail annulé reste annulé');
reset role;

-- 11. Stockage et temps réel
select pg_temp.verifier((select public = false from storage.buckets where id = 'studio-rendus'), 'bucket studio-rendus privé');
select pg_temp.verifier((select public = true from storage.buckets where id = 'visites'), 'bucket visites public');
select pg_temp.verifier(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'studio_jobs'), 'table dans la publication temps réel');
insert into storage.objects (bucket_id, name) values ('studio-rendus', '11111111-1111-1111-1111-111111111111/j/film.mp4'), ('studio-rendus', '22222222-2222-2222-2222-222222222222/j/film.mp4');
set role authenticated;
select pg_temp.verifier((select count(*) = 1 from storage.objects where bucket_id = 'studio-rendus'), 'studio-rendus : le propriétaire ne voit que ses fichiers');
reset role;
\echo TOUS LES TESTS SQL STUDIO_JOBS SONT PASSÉS
