# Edge Functions Supabase — dépôt de référence

Depuis le **21/10/2026**, `mimmoza-front-v2/supabase/functions` est la **seule source** des
Edge Functions du projet Supabase `fwvrqngbafqdaekbdfnm` (Backend Mimmoza).

Le dépôt `Mimmoza_backend` ne déploie plus rien : son déploiement automatique (GitHub
Actions, à chaque push sur `main`) a été désactivé, car il republiait **toutes** ses
fonctions — dont des versions plus anciennes que la production (ex. `copilot-chat`).

## État au 21/10/2026

- 142 fonctions en production, toutes présentes ici (115 déjà dans ce dépôt + 27 reprises
  de `Mimmoza_backend`, qui n'existaient que là-bas).
- `stripe-create-checkout` et `stripe-webhook` sont ici mais **pas** en production
  (Stripe pas encore branché).
- `config.toml` reprend le `verify_jwt` **réel** de chaque fonction en production.
  Ne pas retirer une entrée : sans elle, la CLI redéploie avec `verify_jwt = true`.

## Déployer une fonction (PowerShell, depuis la racine du dépôt)

```powershell
npx supabase functions deploy <nom-de-la-fonction> --project-ref fwvrqngbafqdaekbdfnm
```

- Toujours déployer **fonction par fonction**, jamais `supabase functions deploy` sans nom.
- `verify_jwt` est lu dans `supabase/config.toml` : pas besoin de `--no-verify-jwt`.
- Une modification de `_shared/` concerne toutes les fonctions qui l'importent : redéployer
  celles qui sont concernées par le changement (`grep -rl "_shared/<fichier>" supabase/functions`).

## Points d'attention

- `cadastre-geojson-proxy` : l'ancien `config.toml` de ce dépôt indiquait `verify_jwt = false`
  alors que la production est en `true`. La valeur de production a été conservée ; à
  trancher si le proxy doit être appelable sans connexion.
- `_shared/providers/types.ts` a été recréé (type `Coverage`) : il manquait dans les deux
  dépôts et bloquait le redéploiement de `smartscore-enriched-v3`.
