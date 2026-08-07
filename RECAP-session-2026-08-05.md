# Récap session du 5 août 2026 — chaîne d'étude promoteur

Point de reprise pour la session suivante.

---

## Le fil rouge

Un même défaut est revenu à quatre étages : **une absence d'information transformée en zéro, puis propagée comme un fait.**

- Overpass indisponible → « zone non-urbaine »
- GTFS manquant → « mal desservi » (0/100)
- BPE absente → « peu équipée » (30/100 par défaut)
- Score périmé en base → note fausse depuis mars

C'est ce mécanisme qui a été cassé, pas seulement ses symptômes.

---

## Ce qui est fait

### 1. Score marché incohérent entre l'écran et la base — CORRIGÉ

`MarchePage.tsx` : l'enrichissement GTFS était détaché (`.then()`), le score
persisté était calculé avant son retour. La base disait 51, l'écran 43.

Correctif : `enrichWithMobilityGtfs()` est désormais `await`, un seul objet
`enriched` alimente l'affichage, la persistance et le snapshot copilote.
Un troisième chemin divergeait aussi (`patchModule("market")` envoyait le score
brut backend) — corrigé.

### 2. `is_urban` non déterministe — CORRIGÉ (edge function v1.3.24)

`market-study-promoteur-v1` décidait de l'exclusion du pilier transport selon
le succès ou l'échec d'un appel Overpass. Mêmes entrées → 43 ou 56 selon la
santé d'un serveur tiers.

Remplacé par la grille de densité INSEE (voir ci-dessous).

⚠️ **Le source de cette edge function n'est pas dans le dépôt.** Il n'existe
qu'en production. Note de patch conservée dans
`supabase/functions/market-study-promoteur-v1/PATCH-is_urban-v1.3.24.md`.

### 3. Grille de densité INSEE — IMPORTÉE

Table `insee_grille_densite` créée, 34 875 communes, millésime 1er janvier 2026.
Script : `supabase/scripts/import_grille_densite.ts` (mode `--inspect` disponible).

Répartition : 4 279 communes urbaines (niveaux 1-2), 30 596 rurales (niveau 3).

**Découverte importante** : Ascain est classée `niveau_3 = 2`, `niveau_7 = 4`
(« Ceintures urbaines ») — elle n'est **pas rurale** au sens INSEE. Le seuil
heuristique densité ≥ 400 hab./km² que j'avais posé était faux.

### 4. Libellé de pondération mensonger — CORRIGÉ

L'écran annonçait « accessibilite: 25% » alors que le pilier était exclu.
`effectiveWeights` alimente maintenant le calcul *et* le libellé.

### 5. Règle « pas de donnée ⇒ pas de pilier » — POSÉE ET ÉTENDUE

Généralisée dans `calculateDifferentiatedScores` :

```ts
const piliersRetenus = ['demande', 'offre',
  ...(transportExclu ? [] : ['accessibilite']),
  ...(environnementMesure ? ['environnement'] : [])];
const sommePoids = piliersRetenus.reduce((s, p) => s + config.weights[p], 0);
```

Les poids se renormalisent sur ce qui reste, quel que soit le nombre de piliers
écartés. Sous-scores à `null` (jamais 0), messages distincts selon le motif
(« non applicable » vs « non mesuré »).

Libellé « 56 000 arrêts · base nationale » (faux) remplacé par
« Sources ouvertes · couverture partielle ».

### 6. Disclaimer de portée — AJOUTÉ

Sous le score global : la note décrit un **contexte de marché**, pas la qualité
propre d'un bien. Formulé pour que la limite se lise comme une garantie de
méthode.

### 7. Scores BPE périmés — CORRIGÉ

`bpe_depcom_aggregates` servait des scores figés au 19/03/2026, calculés avec
une formule abandonnée. **70 % des 23 520 lignes étaient incohérentes** avec le
barème du code.

`select public.refresh_bpe_depcom_aggregates();` exécuté → 23 520/23 520
conformes. Ascain : score BPE 31 → 65, `nb_ecoles` 0 → 3 (débloque le bonus
+10), environnement 35 → 78, score global 56 → **68**.

### 8. Ménage base — 666 Mo libérés

8 076 Mo → 7 410 Mo. Supprimés : `dvf_2025_s1_typed_mat`, `gtfs_trips`,
`ecoles_fr_raw`, `dvf_addresses_2025_s1`, `ircom_communes_raw_2023`,
`gtfs_stops_raw`. `insee_pop2_raw` conservée (vue `v_commune_population`).

Reste possible : `vacuum full cadastre_parcelles` (verrou exclusif, hors heures).

---

## Ce qui reste ouvert

### A. Trou de couverture GTFS — le plus gros

`mobility_stops` (56 740 arrêts) ne contient que trois modes :

| mode | nombre | emprise |
|---|---:|---|
| `metro` | 53 967 | Île-de-France uniquement — ce sont en réalité des **arrêts de bus** mal étiquetés |
| `ter` | 2 628 | France entière |
| `tgv` | 145 | France entière |

**Aucun arrêt de bus ni de tram hors Île-de-France.** Autour d'Ascain : 0 arrêt
dans un rayon de 5 km, alors que la commune est desservie par Txik Txak et que
la gare TER de Saint-Jean-de-Luz est à 5,9 km.

À faire : réimporter depuis le Point d'Accès National avec le bon mapping
`route_type`, et distinguer en base « pas de donnée » de « pas de desserte ».

### B. 11 434 communes sans ligne BPE

La table couvre 23 520 des 34 875 communes. Les autres sortent désormais du
calcul (règle appliquée) au lieu d'être notées 30/100 — mais la lacune de
source reste entière.

### C. Barème BPE en valeur absolue

Palier haut à 30 équipements, plafond réel 95/100, aucune prise en compte de la
population. Un village de 800 habitants correctement équipé plafonne à 50.
Correctif envisagé : ratio par habitant.

### D. Métrique d'accessibilité à deux régimes — décidé, non commencé

Le pilier ne serait jamais exclu, mais l'instrument changerait selon `niveau_7` :

- niveaux 1-3 (centres, petites villes) → desserte transports en commun
- niveaux 4-7 (ceintures urbaines, rural) → accès voiture : minutes jusqu'à la
  gare, au pôle d'emploi, à l'échangeur

Sources repérées : `mobility_stops` (local, déterministe), INSEE Metric/OSRM
(temps voiture), Navitia (ferroviaire, palier gratuit), transport.data.gouv.fr
(arrêts consolidés, non dédoublonnés).

Un promoteur à Ascain ne vend pas « à 300 m du tram », il vend « 20 minutes de
Saint-Jean-de-Luz ».

### E. Indicateur de confiance

À force de retirer les piliers non mesurés, certaines communes seront notées sur
deux critères sur quatre. Rien n'indique à l'écran qu'un tel score est plus
fragile. Afficher le nombre de critères retenus comblerait ce dernier angle mort.

### F. Étape `risques` — prochain chantier

`RisquesPage.tsx` écrit déjà l'étape `risques` et appelle `patchModule("risks")`.
Reste à vérifier ce qui parvient réellement au copilote : l'objectif est que le
chat puisse répondre sur les risques (inondation, retrait-gonflement, sismicité,
score sécurité) au même niveau que sur le marché.

Question non tranchée : le copilote doit-il seulement **lire** l'étude, ou aussi
la **déclencher** depuis le chat ?

---

## Points de vigilance

- **Le source de `market-study-promoteur-v1` n'existe qu'en production.** À
  rapatrier dans le dépôt dès que le shell fonctionne.
- Le shell Linux était bloqué toute la session — d'où les patchs livrés en note
  plutôt qu'appliqués et déployés directement.
- Étude de référence : Ascain, INSEE 64065, uuid `bc69a73c-2…`, hash d'entrées
  `1310506876`.
