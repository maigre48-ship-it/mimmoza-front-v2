# Veille des dossiers parcellaires

La fonction accepte deux appels :

- `POST {"dossier_id":"UUID"}` avec le JWT de l'utilisateur : vérification immédiate de son propre dossier. L'accès au dossier est contrôlé par l'authentification et les règles RLS.
- `POST {"batch":true}` avec l'en-tête `x-dossier-cron-secret` : vérification des 100 dossiers actifs les plus anciens. Le secret est comparé à `DOSSIER_WATCH_CRON_SECRET` défini pour la fonction.

La fonction garde l'ancienne valeur d'une source indisponible et répond `partial`. Elle ne crée donc aucune fausse alerte lors d'une panne d'API. Les événements sont enregistrés dans `copilot_parcel_dossier_events`, consultables uniquement par le propriétaire.

## Mise en service

1. Appliquer `20260926_copilot_parcel_dossiers.sql`.
2. Déployer `parcel-dossier-watch-v1` et `alertes-accueil-v1`. La configuration de cette fonction désactive le contrôle JWT à la passerelle ; son code valide lui-même le JWT pour l'appel individuel et le secret pour le lot.
3. Définir un secret aléatoire long dans l'environnement de la fonction sous le nom `DOSSIER_WATCH_CRON_SECRET`.
4. Planifier un appel quotidien au lot depuis le planificateur du projet. Exemple avec `pg_cron`, `pg_net` et deux secrets Vault nommés `mimmoza_supabase_url` (URL du projet) et `mimmoza_dossier_watch_secret` (même valeur que ci-dessus) :

```sql
select cron.schedule(
  'mimmoza-parcel-dossier-daily',
  '15 5 * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mimmoza_supabase_url') || '/functions/v1/parcel-dossier-watch-v1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dossier-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mimmoza_dossier_watch_secret')
    ),
    body := '{"batch":true}'::jsonb
  )$$
);
```

Cette commande suppose que les extensions `pg_cron`, `pg_net` et Vault sont activées dans le projet Supabase. Pour plus de 100 dossiers actifs, rapprocher la fréquence ou paginer le traitement.
