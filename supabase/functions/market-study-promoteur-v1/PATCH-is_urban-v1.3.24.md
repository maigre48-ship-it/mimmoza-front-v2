# Patch v1.3.24 — rendre `is_urban` déterministe

**Fonction :** `market-study-promoteur-v1` (déployée en v115, source absente du dépôt)
**À appliquer :** éditeur de fonctions Supabase (Dashboard → Edge Functions → market-study-promoteur-v1)

---

## Problème

Pour des entrées strictement identiques (Ascain, INSEE 64065, rayon 5 km, logement),
la fonction renvoyait tantôt `transport_exclu: false` (score global 43), tantôt
`transport_exclu: true` (score global 56).

Cause : `transport_exclu` dérive uniquement de `transport.is_urban`, lui-même décidé
par le succès ou l'échec d'un appel **Overpass** (OpenStreetMap) — rayon 1 000 m,
`AbortSignal.timeout(12000)`, trois miroirs en cascade, `catch` silencieux.

- Overpass répond ≥ 1 élément → `is_urban: true` **sans regarder la population**
- Overpass tombe (429 / timeout / 0 élément) → repli sur `population >= 50 000` → `false`

Un pilier de score entier (accessibilité, 25 % du poids) était donc inclus ou exclu
selon la santé d'un serveur tiers.

---

## Correctif

Une seule ligne à remplacer, dans `computeDifferentiatedScores`.
`insee` est déjà un paramètre de cette fonction et expose `densite` et `population`.

### Avant

```ts
  const isUrban = transport?.is_urban === true;
```

### Après

```ts
  // v1.3.24 — is_urban déterministe.
  // Ne dépend plus de la disponibilité d'Overpass : la décision d'inclure ou
  // d'exclure le pilier accessibilité se prend sur les données INSEE, déjà
  // chargées et stables. Overpass n'alimente plus que le *score* transport,
  // jamais la structure de la pondération.
  // Réf. : Ascain (241 hab./km², 4 658 hab.) oscillait entre 43 et 56.
  const densiteCommune = insee?.densite ?? 0;
  const popCommune = insee?.population ?? 0;
  const isUrban = densiteCommune >= 400 || popCommune >= 10_000;
```

### Bump de version

```ts
const VERSION = "1.3.23";   // →   const VERSION = "1.3.24";
```

---

## Seuils — à arbitrer

`densite >= 400 || population >= 10 000` est un proxy de la grille de densité INSEE
(communes densément / intermédiairement peuplées). À ajuster si le comportement
attendu diffère :

| Commune       | Densité | Population | `is_urban` |
|---------------|--------:|-----------:|------------|
| Ascain (64)   |     241 |      4 658 | `false`    |
| Seuil retenu  |     400 |     10 000 | —          |

L'ancien seuil `URBAN_POP_THRESHOLD = 50_000` devient inutilisé sur ce chemin ;
il reste référencé dans les branches de repli de `fetchTransport` (voir ci-dessous).

---

## Deux défauts connexes, non corrigés ici

À traiter séparément, ils n'affectent pas le non-déterminisme :

1. **`out tags 50;`** dans la requête Overpass n'émet pas `lat`/`lon`. Le parsing
   fait ensuite `if (!el.lat || !el.lon) continue;` — donc `stops` est **toujours**
   vide et le score transport vaut 30 en dur dès qu'Overpass répond. Correctif :
   `out body 50;` ou `out center 50;`.

2. **Front** (`MarchePage.tsx`, `calculateDifferentiatedScores`) : `mobility_gtfs.total`
   écrase l'accessibilité backend même quand il vaut 0 faute de couverture GTFS.
   N'appliquer le total GTFS que si la couverture est réellement `ok`.

3. **Changelog** : le commentaire v1.3.19 décrit un ET (« population < 50 000 *et*
   aucun arrêt Overpass trouvé ») que le code n'a jamais implémenté. `VERSION` était
   par ailleurs à 1.3.23 sans entrées de changelog 1.3.22/1.3.23.

---

## Vérification après déploiement

Relancer l'analyse Ascain deux fois de suite, puis :

```sql
-- étude de référence Ascain (préfixe d'uuid : bc69a73c-2…)
select step, status, updated_at, summary, inputs_hash
from promoteur_study_steps
where study_id::text like 'bc69a73c-2%' and step = 'marche';
```

Pour une autre étude, remplacer le préfixe — ou utiliser l'uuid complet avec
`where study_id = '…'` (l'égalité exige un uuid valide, pas un motif).

Attendu : `score_marche` identique aux deux exécutions, et `transport_exclu: true`
de façon stable pour Ascain.
