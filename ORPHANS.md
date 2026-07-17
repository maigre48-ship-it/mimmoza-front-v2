# Fichiers orphelins — espace Promoteur

> Établi le 2026-07-16, à la suite de la découverte que `pages/Foncier.tsx`
> (supprimé) n'était routé nulle part alors qu'un lot entier avait été appliqué
> dessus. **Aucune suppression n'a été faite ici** : ce document est une liste
> d'inventaire en attente d'un lot de nettoyage dédié.
>
> Méthode de détection : recherche d'import du chemin/nom de chaque fichier dans
> tout `src/` (hors le fichier lui-même). **Caveat** : un `import()` dynamique ou
> un chargement paresseux construit par chaîne échapperait à cette détection —
> refaire un `grep` ciblé juste avant toute suppression.

## Orphelins confirmés (0 import nulle part)

| Fichier | Pourquoi orphelin | Risque de suppression |
|---|---|---|
| `src/spaces/promoteur/pages/Marche.tsx` | La page routée `/promoteur/marche` est `etudes/marche/MarchePage.tsx` (fichier différent). | Faible (0 import). |
| `src/spaces/promoteur/pages/Risques.tsx` | La page routée `/promoteur/risques` est `etudes/risques/RisquesPage.tsx`. | Faible (0 import). |
| `src/spaces/promoteur/pages/PluFaisabilite.tsx` | Ancienne page de faisabilité PLU ; les routes `plu-faisabilite`/`faisabilite` redirigent vers `/promoteur/foncier` (`FoncierPluPage`). | Faible (0 import). |
| `src/spaces/promoteur/pages/PromoteurRenduTravauxPage.tsx` | Jamais routée, jamais importée. | Faible (0 import). |
| `src/spaces/promoteur/components/Plan2DEditorPage.tsx` | Jamais importée (l'éditeur 2D actif est `Implantation2DPage` + `plan2d/`). | Faible (0 import). |
| `src/spaces/promoteur/pages/syntheseComponents.tsx` | Jamais importée (la synthèse active est `Synthese.tsx` → `PromoteurSynthesePage.tsx`). | Faible (0 import) — vérifier qu'aucun composant nommé n'y est référencé avant suppression. |
| `src/spaces/promoteur/shared/components/ProjectSelector.tsx` | Jamais importée / jamais rendue (grep : uniquement auto-références ; pas de `React.lazy`/`import()` ; `FoncierPluPage` utilise son PROPRE `ProjectSelector` **local**, ligne 749). Contient un appel mort à `plu-from-parcelle-v2` (ligne 265). | Faible (0 import) — malgré le nom « composant partagé », il ne l'est pas. |

## Morts par transitivité (importés uniquement par un orphelin)

| Fichier | Pourquoi | Risque |
|---|---|---|
| `src/spaces/promoteur/components/PluUploaderPanel.tsx` | Importé **uniquement** par `pages/PluFaisabilite.tsx` (lui-même orphelin). `FoncierPluPage` utilise un `PluUploaderPanel` **local** (ligne 457) → le fichier `components/PluUploaderPanel.tsx` n'est jamais rendu. Contient un appel mort à `plu-from-parcelle-v2` (ligne 519). | Faible — à supprimer avec `PluFaisabilite.tsx`. |

## Morts « de fait » (référencés uniquement par du code déjà exclu du build)

| Fichier / dossier | Statut | Risque |
|---|---|---|
| `src/spaces/promoteur/pages/PromoteurHomePage.tsx` | Importé **seulement** par `src/app/_unused/router.tsx`, lui-même **exclu** du build (`tsconfig.app.json` → `exclude: ["src/app/_unused"]`). | Faible. Supprimer aussi la référence dans `_unused/router.tsx` (ou supprimer `_unused/` entier). |
| `src/spaces/promoteur/pages.bak-encoding/` (12 fichiers : Bilan, Dashboard, Exports, Foncier, Implantation2D, Marche, Massing3D, PluFaisabilite, PluFaisabilite.tsx.bak, PromoteurHomePage, Risques, Synthese) | Dossier de **backup** entièrement **exclu** du build (`tsconfig.app.json` → `exclude: ["src/spaces/promoteur/pages.bak-encoding"]`). | Nul (jamais compilé ni importé). Candidat à suppression en bloc. |

## Non-orphelins (vérifiés — NE PAS supprimer)

- `src/spaces/promoteur/pages/PromoteurSynthesePage.tsx` — composé par `bilan-promoteur/BilanPromoteurPage.tsx` **et** `pages/Synthese.tsx` (tous deux routés).
- `pages/Bilan.tsx` (routé `PromoteurBilan`), `pages/Synthese.tsx` (routé `PromoteurSynthese`), `pages/Exports.tsx` (routé `PromoteurExports`), etc. — tous montés par `App.tsx`.

## Recommandation
Traiter en **un lot dédié** : supprimer d'abord `pages.bak-encoding/` (risque nul),
puis les 6 orphelins confirmés (après un `grep` de contrôle), puis
`PromoteurHomePage.tsx` + sa référence dans `src/app/_unused/`. Lancer
`npx tsc --noEmit` après chaque étape.
