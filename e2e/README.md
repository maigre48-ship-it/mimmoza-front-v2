# Tests de bout en bout (Playwright)

Scénarios :

| Fichier | Ce qui est vérifié | Compte requis |
|---|---|---|
| `visiteur.spec.ts` | `/` (formulaire d'analyse express, connexion Pro), analyse express → inscription, lien « Découvrir Mimmoza », liens légaux, `/tarifs` (4 formules + Studio 3D), `/decouvrir`, chargement à la demande des pages publiques, 404, garde de connexion, aucune bibliothèque lourde téléchargée sur `/` | non |
| `connecte.spec.ts` | connexion, page MimmozIA, analyse rapide sur une adresse fixe, résultat, export PDF (fenêtre d'impression interceptée), menu des formules | **oui** (`E2E_EMAIL`, `E2E_PASSWORD`) |
| `mobile.spec.ts` | 390 px de large : aucun défilement horizontal sur `/`, `/tarifs`, `/decouvrir` | non |

Sans `E2E_EMAIL` / `E2E_PASSWORD`, `connecte.spec.ts` est **ignoré** (affiché « skipped »).
N'utilisez qu'un compte de test **existant** : ces scénarios ne créent jamais de compte.
L'analyse rapide consomme une analyse du quota mensuel de ce compte.

## Première installation (une fois)

```powershell
cd C:\Users\maigr\Dev\mimmoza-front-v2
npm install
npx playwright install chromium
```

## Lancer contre le serveur de développement (http://localhost:5173)

Dans un premier terminal :

```powershell
npm run dev
```

Dans un second terminal :

```powershell
npm run test:e2e
```

## Lancer contre le build de production local (recommandé avant un push)

```powershell
npx vite build --outDir node_modules\.build-e2e
npx vite preview --outDir node_modules\.build-e2e   # http://localhost:4173, laisser ouvert
```

Puis, dans un second terminal :

```powershell
$env:E2E_BASE_URL = "http://localhost:4173"
npm run test:e2e
Remove-Item Env:E2E_BASE_URL
```

## Lancer contre un aperçu Vercel (protégé par l'authentification Basic de `middleware.ts`)

```powershell
$env:E2E_BASE_URL       = "https://mimmoza-git-correctifs-audit-20261021-xxx.vercel.app"
$env:E2E_BASIC_USER     = "mimmoza"
$env:E2E_BASIC_PASSWORD = "<mot de passe de l'aperçu>"
npm run test:e2e
```

## Parcours connecté

```powershell
$env:E2E_EMAIL    = "compte-de-test@exemple.fr"
$env:E2E_PASSWORD = "<mot de passe du compte de test>"
npm run test:e2e -- e2e/connecte.spec.ts
Remove-Item Env:E2E_EMAIL, Env:E2E_PASSWORD
```

## Utile

```powershell
npm run test:e2e -- --project=mobile          # seulement les tests mobiles
npm run test:e2e -- --headed                  # voir le navigateur
npx playwright show-report node_modules\.e2e-rapport   # rapport HTML du dernier passage
```

- `E2E_CHROMIUM_PATH` : chemin d'un Chrome déjà installé, si `npx playwright install` est impossible
  (ex. `$env:E2E_CHROMIUM_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"`).
- Captures d'écran et traces des échecs : `node_modules\.e2e-resultats\`.
- En local, `/api` n'est pas testé : `vite preview` le relaie vers le runner du Studio.

## Poids du code (analyse des morceaux)

```powershell
npm run analyse:bundle
start node_modules\.analyse-bundle\stats.html
```
