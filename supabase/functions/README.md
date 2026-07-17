# `supabase/functions/` — miroir de référence des Edge Functions

## ⚠️ Ces fichiers NE SONT PAS déployés par le build

Ce projet n'utilise **pas** la CLI Supabase. Le déploiement des Edge Functions
se fait **à la main**, par copier-coller dans le Dashboard Supabase
(Edge Functions → *Deploy*). Les fichiers de ce dossier sont donc une **copie de
référence** — leur seul rôle est de rendre le code serveur **relisible** (revue,
diff Git, historique). **Le Dashboard reste la source de vérité déployée.**

Ils ne sont ni compilés (`tsconfig` ne couvre que `src/`), ni exécutés, ni
poussés automatiquement. Un fichier de ce dossier peut donc, en théorie,
**mentir** sur ce qui tourne réellement — voir « Anti-dérive » plus bas.

## Format d'en-tête (obligatoire, en haut de chaque `index.ts`)

```ts
// supabase/functions/<nom>/index.ts
// DEPLOYED: 2026-07-16          <- date du dernier collage dans le Dashboard
// SHA256: <hex>                 <- empreinte du fichier SANS la ligne SHA256 (tripwire anti-dérive)
```

## Procédure de déploiement (repo-first, Windows / PowerShell)

1. **Éditer / relire** `supabase/functions/<nom>/index.ts` dans le repo
   (revue de code, diff Git, PR).
2. **Recalculer l'empreinte** (voir snippet ci-dessous) et mettre à jour la
   ligne `// SHA256:` du fichier.
3. **Mettre à jour** `// DEPLOYED:` avec la date du jour.
4. **Copier tout le fichier** et le coller dans le Dashboard →
   Edge Functions → `<nom>` → *Deploy*.
5. **Committer** le fichier mis à jour (SHA + date) dans le repo.

> Règle d'or : **jamais** de hotfix collé dans le Dashboard sans, dans la
> **même foulée**, mettre à jour + committer le fichier miroir (étapes 2–3–5).
> Un miroir qui ment est pire que pas de miroir.

## Anti-dérive — le tripwire `// SHA256:`

Le `// SHA256:` est une **empreinte détectable** : il permet de savoir si le
repo est en retard sur le Dashboard, sans avoir à comparer visuellement.

- Il couvre le contenu du fichier **privé de la ligne `// SHA256:` elle-même**
  (sinon l'empreinte se référencerait — impossible).
- **Auditer une dérive** (quand tu doutes que le repo reflète le Dashboard) :
  1. Copie le contenu **actuel** de la fonction depuis le Dashboard.
  2. Colle-le dans le fichier miroir (en gardant l'en-tête).
  3. Recalcule l'empreinte (snippet ci-dessous).
  4. Si elle **diffère** du `// SHA256:` enregistré → le repo était en retard
     (il vient d'être resynchronisé par le collage). Committe.

### Snippet PowerShell — calcul de l'empreinte

```powershell
$f = "supabase/functions/<nom>/index.ts"
# On hashe le fichier PRIVÉ de la ligne SHA256 (évite l'auto-référence).
$body = (Get-Content -Raw $f) -split "`n" | Where-Object { $_ -notmatch '^// SHA256:' } | Join-String -Separator "`n"
$sha  = [BitConverter]::ToString(
          [Security.Cryptography.SHA256]::Create().ComputeHash(
            [Text.Encoding]::UTF8.GetBytes($body))
        ).Replace('-','').ToLower()
$sha   # -> à recopier dans la ligne // SHA256:
```

> Caveat fins de ligne : l'empreinte dépend des retours chariot (LF vs CRLF).
> Garde les fichiers en **LF** (`.gitattributes` recommandé) pour que le hash
> soit stable entre ton édition, le repo et le collage. Le tripwire reste utile
> même imparfait : il attrape toute modification de contenu.

## Contenu actuel du dossier

| Dossier | Statut | Note |
|---|---|---|
| `cadastre-geojson-proxy/` | présent (déjà versionné) | proxy CORS cadastre |
| `cadastre-from-commune/` | présent (déjà versionné) | — |
| `agent-commercial-*/` | présents | module Agent commercial (déployés par copier-coller) |
| `plu-from-parcelle-v2/` | **à rapatrier** | 1ᵉʳ candidat du lot « contrôle serveur » |
| `plu-from-parcelle/`, `plu-from-address/`, `foncier-lookup-v1/` | **à rapatrier** si conservées | cf. lot contrôle serveur (Tier 1) |

On crée les dossiers **au fil des rapatriements**, pas de squelettes vides.
