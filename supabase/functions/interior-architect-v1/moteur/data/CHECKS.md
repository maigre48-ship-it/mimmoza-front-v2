# Contrat des contrôles (`Rule.check`) — v1

Ce document est le contrat que le critique (`src/critic/checks.ts`) implémente. Chaque `check.kind`
appartient à l'ensemble fermé `CHECK_KINDS` (`src/data/schemas.ts`). Les params sont validés par
`CHECK_PARAM_SCHEMAS[kind]` (zod, strict : un param inconnu est refusé). Unités : mètres, m², degrés.

## 0. Définitions communes (valables pour tous les kinds)

### 0.1 Contexte d'évaluation
Le critique reçoit `ctx = { input: PlanInput, analysis: PlanAnalysis, layout: LayoutPlan, brief: InteriorBrief, spec(id) → FurnitureSpec }`.
- `N` (occupants) = `brief.occupants.adults + brief.occupants.children`.
- `P(room)` = placements de `layout.placements` dont `roomId === room.id`. `S(p)` = `spec(p.specId)`.
- `cat(p)` = `S(p).category`. Un param `categories` contenant `'*'` désigne toutes les catégories.
- `ignoreCategories` : les placements de ces catégories sont **retirés des obstacles** (jamais des cibles).

### 0.2 Applicabilité (avant tout calcul)
Une règle est évaluée si : `input.construction ∈ applicability.construction` ET `input.kind ∈ applicability.kind`
ET (`applicability.pmr === 'toujours'` OU `brief.constraints.pmr === true`).
Sinon → `rulesSkipped` (raison : « non applicable »).
`applicability.roles` (si présent) restreint les **pièces évaluées** (`analysis.rooms` dont `role` ∈ roles).
Pour un contrôle de portée « logement », il restreint les pièces dont les placements sont **comptés**.
Si aucune pièce ne correspond → `rulesSkipped` (raison : « aucune pièce concernée »), sauf mention contraire.

### 0.3 Unité de vie (`uniteDeVie: true`)
Seules les pièces dont `input.rooms[i].level` est égal au niveau minimal du logement sont évaluées
(niveau d'accès). Interprétation Mimmoza de l'art. 13 de l'arrêté du 24 décembre 2015.

### 0.4 Géométrie
- Emprise : `footprint(p, S(p))` (src/geometry). Rotation limitée à 0/90/180/270 → rectangles alignés.
- Côtés locaux → monde : devant = `frontDir(rot)` ; derrière = −devant ; droite = devant tourné de −90° ;
  gauche = devant tourné de +90°. (Rot 0 : devant +y, droite +x, gauche −x, derrière −y.)
- **Obstacles d'une pièce** `O(room, p, ignore)` = arêtes du polygone de la pièce
  + emprises des autres placements de la pièce (sauf `ignore`)
  + équipements fixes `room.fixtures` ayant `size` (rectangle centré sur `position`, aligné sur les axes).
  Les fixtures sans `size` ne sont pas des obstacles géométriques.
- **Profondeur libre d'un côté** `free(p, côté)` : on échantillonne le bord de l'emprise de ce côté tous les
  0,05 m (de 0,05 m après une extrémité à 0,05 m avant l'autre ; au moins 1 point, le milieu). De chaque
  point on lance un rayon perpendiculaire vers l'extérieur ; sa longueur est la distance au premier obstacle
  (plafonnée à 5 m). `free` = **minimum** des longueurs. Si `swingCounts`, les polygones `room.swingZones` sont
  des obstacles, mais un rayon peut pénétrer une swingZone sur `swingTolerance` (défaut 0) avant d'être arrêté.
- **Grille** : pas fixe 0,05 m, centres des cellules dans `room.polygon` (pointInPolygon).
- Une **violation** porte `roomId`, `placementIds` concernés, `measured` (valeur mesurée) et `expected`
  (seuil), `message` en français. Une règle passe si elle ne produit aucune violation.

---

## 1. `emprise_valide`
| param | type | unité | rôle |
|---|---|---|---|
| overlapAllowedCategories | string[] (catégories) | — | catégories pouvant être chevauchées (ex. tapis) |
| overlapTolerance | number | m | tolérance de chevauchement (largeur de l'intersection) |
| checkFixtures | boolean | — | contrôler le chevauchement avec les fixtures ayant `size` |
| checkAllowedRoles | boolean | — | contrôler `room.role ∈ S(p).allowedRoles` |

Pour chaque placement `p` : violation si (a) `rectInPolygon(footprint, room.polygon, overlapTolerance)` est faux ;
(b) il existe `q ≠ p` de la même pièce, aucun des deux n'étant d'une catégorie autorisée, avec
`rectsOverlap(fp(p), fp(q), overlapTolerance)` ; (c) `checkFixtures` et chevauchement avec une fixture dimensionnée ;
(d) `checkAllowedRoles` et rôle non autorisé ; (e) `layout.placements` référence une spec inconnue.
`measured` = aire d'intersection (a: aire hors pièce).

## 2. `passage_min`
| param | type | unité | rôle |
|---|---|---|---|
| minWidth | number | m | largeur libre minimale du passage |
| targets | `'portes'` \| `'portes_et_usages'` | — | points à relier |
| ignoreCategories | string[] | — | catégories non-obstacles |
| satelliteCategories | string[]? | — | catégories obstacles mais jamais cibles d'usage (satellites atteints depuis leur meuble parent, D18) |
| uniteDeVie | boolean? | — | voir 0.3 |

Mesure par pièce évaluée. Cellule **passable** : son centre `c` vérifie que le disque de rayon `minWidth/2`
centré en `c` est entièrement dans le polygone (distance de `c` à toute arête ≥ `minWidth/2`) et ne coupe
aucun obstacle (distance de `c` à chaque emprise obstacle ≥ `minWidth/2`). Connexité 4-voisins.
**Cibles** : pour chaque porte/ouverture de `room.doors`, le point situé au milieu de `[a,b]` décalé vers
l'intérieur de `minWidth/2` ; avec `'portes_et_usages'`, en plus, pour chaque placement non ignoré dont
`clearances.front > 0`, le milieu du bord extérieur de `frontClearanceRect`. Une cible est atteinte si une
cellule passable est à ≤ 0,10 m d'elle. Violation si les cibles atteintes ne sont pas toutes dans une même
composante connexe (ou si une cible n'est atteinte par aucune cellule). Une pièce avec moins de 2 cibles passe.
`measured` = plus grande largeur `w` (pas 0,05 m, `w ≤ minWidth`) pour laquelle toutes les cibles sont connectées.

## 3. `cercle_manoeuvre`
| param | type | unité | rôle |
|---|---|---|---|
| diameter | number | m | diamètre du cercle libre |
| scope | `'chaque_piece'` \| `'au_moins_une_piece'` | — | quantification sur les pièces évaluées |
| ignoreCategories | string[] | — | catégories non-obstacles |
| swingAllowed | boolean | — | le cercle peut-il recouvrir un débattement de porte |
| includeSejourIfNoChambre | boolean? | — | si aucune pièce du rôle (studio), évaluer sejour/sejour_cuisine |
| uniteDeVie | boolean? | — | voir 0.3 |

Une pièce **satisfait** s'il existe un centre de grille `c` tel que le disque (rayon `diameter/2`) est dans le
polygone, ne coupe aucune emprise obstacle, aucune fixture dimensionnée, et (si `!swingAllowed`) ne coupe aucune
`swingZone` de la pièce. `chaque_piece` : violation par pièce non satisfaisante. `au_moins_une_piece` : une seule
violation (roomId null) si aucune pièce ne satisfait. `measured` = plus grand diamètre libre trouvé (pas 0,05 m).

## 4. `degagement_categorie`
| param | type | unité | rôle |
|---|---|---|---|
| categories | string[] (`'*'` admis) | — | placements cibles |
| requireProvides | fonction? | — | ne garder que les cibles dont la spec fournit cette fonction |
| minFront / minBack / minLeft / minRight | number? | m | profondeur libre exigée par côté (absent = non contrôlé) |
| altMinFront / altMinLeft / altMinRight | number? | m | jeu alternatif (« ou l'inverse ») |
| lateralMode | `'tous'` \| `'au_moins_un'` \| `'tous_si_double'` | — | quantification gauche/droite (défaut `'tous'`) |
| sideZoneLength | number? | m | longueur de la zone latérale mesurée depuis le bord arrière (défaut : longueur du côté) |
| useSpecClearances | boolean? | — | les seuils sont `S(p).clearances` (côtés à 0 non contrôlés) ; les min* sont ignorés |
| ignoreCategories | string[] | — | catégories non-obstacles |
| swingCounts | boolean | — | les débattements de porte sont des obstacles |
| swingTolerance | number? | m | pénétration admise dans un débattement (défaut 0) |
| scope | `'chaque_placement'` \| `'au_moins_un_logement'` | — | quantification |
| relaxOneSideIfSinglePiece | boolean? | — | si `input.typology ∈ {studio, T1}`, un seul côté latéral suffit |
| uniteDeVie | boolean? | — | voir 0.3 |

Pour chaque cible `p` on calcule `free(p, côté)` (0.4). Si `sideZoneLength` est donné, les rayons latéraux ne
partent que des points du côté situés à moins de `sideZoneLength` du bord arrière (−y local) ; si le côté est
plus court, la zone est prolongée par un rayon fictif depuis le prolongement du côté vers +y local, jusqu'à
`sideZoneLength`. Le jeu **principal** est satisfait si : `free(front) ≥ minFront` (si défini), `free(back) ≥ minBack`
(si défini), et côté latéral selon `lateralMode` : `'tous'` → gauche ≥ minLeft ET droite ≥ minRight ;
`'au_moins_un'` → gauche ≥ minLeft OU droite ≥ minRight ; `'tous_si_double'` → comme `'tous'` si la spec fournit
`dormir_double`, sinon comme `'au_moins_un'`. `relaxOneSideIfSinglePiece` transforme `'tous'` en `'au_moins_un'`.
Le jeu **alternatif** (si au moins un `alt*` est défini) remplace min* par alt* pour les côtés définis. La cible
est satisfaite si le jeu principal OU l'alternatif l'est. `chaque_placement` : une violation par cible non
satisfaite (`measured` = plus petite profondeur en défaut, `expected` = seuil associé). `au_moins_un_logement` :
une violation (roomId null) si aucune cible de toutes les pièces évaluées n'est satisfaite ; aucune cible → skipped.

## 5. `debattement_libre`
| param | type | unité | rôle |
|---|---|---|---|
| ignoreCategories | string[] | — | catégories autorisées dans le débattement |
| toleranceArea | number | m² | aire d'intersection tolérée |

Pour chaque `swingZone` de chaque pièce et chaque placement non ignoré de cette pièce : violation si
l'aire d'intersection (polygone de débattement ∩ emprise, calcul par découpage de polygone) > `toleranceArea`.
`measured` = aire. Pièce sans swingZone : passe.

## 6. `ouverture_non_obstruee`
| param | type | unité | rôle |
|---|---|---|---|
| depth | number | m | profondeur de la bande contrôlée devant une fenêtre |
| heightTolerance | number | m | marge admise au-dessus de l'allège |
| frenchWindowDepth | number | m | profondeur à garder entièrement libre devant une porte-fenêtre |
| ignoreCategories | string[] | — | catégories ignorées |

Pour chaque entrée de `room.windows` : nature = `input.openings[id].kind`. Bande = rectangle s'appuyant sur
`[a,b]`, côté intérieur, de profondeur `depth` (ou `frenchWindowDepth` si `french_window`). Un placement non
ignoré dont l'emprise coupe la bande (aire > 0,001 m²) : pour une porte-fenêtre → violation ; pour une fenêtre →
violation si `!S(p).allowedUnderWindow`, ou si `sillHeight` connu et `S(p).size.h > sillHeight + heightTolerance`.
`sillHeight` null : seul `allowedUnderWindow` est contrôlé et l'hypothèse est ajoutée aux `assumptions`.

## 7. `distance_fixture`
| param | type | unité | rôle |
|---|---|---|---|
| mode | `'min'` \| `'max'` \| `'piece_humide'` \| `'zone_avant'` | — | sens du contrôle |
| fixtureKinds | FixtureKind[] | — | équipements fixes de référence |
| distance | number? | m | seuil (obligatoire pour min/max) ; profondeur de la zone pour `zone_avant` |
| zoneWidth | number? | m | `zone_avant` : largeur de la zone si l'équipement n'a pas de `size` (défaut 0,60) |
| categories | string[] (`'*'` admis) | — | placements contrôlés |
| minHeight | number? | m | ne contrôler que les specs de hauteur ≥ minHeight |
| requireNeedsWater | boolean? | — | ne contrôler que les specs `needsWater` |

Distance = distance minimale entre l'emprise du placement et la fixture (rectangle si `size`, sinon point),
fixtures de la **même pièce**. `min` : violation si une fixture de `fixtureKinds` est à < `distance`.
`max` : violation si la fixture la plus proche est à > `distance` ; si la pièce n'a aucune fixture de ces
types → rulesSkipped (« équipement d'eau non renseigné »). `piece_humide` : violation si `room.hasWater === false`
pour un placement contrôlé (fixtureKinds ignoré). `zone_avant` (D20) : pour chaque fixture, zone rectangulaire
adossée à l'arête axiale de la pièce la plus proche, de profondeur `distance` vers l'intérieur, centrée sur la
fixture, de largeur = emprise de la fixture le long de l'arête (ou `zoneWidth`) ; violation si l'emprise d'un
placement contrôlé la recoupe (aire > 0,001 m², `measured` = aire). `measured` = distance (min/max).

## 8. `fonctions_requises`
| param | type | unité | rôle |
|---|---|---|---|
| functions | UsageFunction[] | — | toutes requises |
| anyOf | UsageFunction[]? | — | au moins une requise |
| scope | `'chaque_piece'` \| `'logement'` | — | ensemble sur lequel on agrège les `provides` |
| acceptAdjacentRoles | RoomRole[]? | — | les placements des pièces adjacentes (analysis.adjacency) de ces rôles comptent |
| fallbackToEntranceRoom | boolean? | — | si aucune pièce du rôle : évaluer la pièce dont une porte a `to === null` |
| whenBrief | `'toujours'` \| `'teletravail'` \| `'pmr'` \| `'animaux'` | — | condition du brief |

Si `whenBrief ≠ 'toujours'` et `brief.constraints[whenBrief] !== true` → rulesSkipped. F = union des `provides`
des placements de l'ensemble (pièce, + pièces adjacentes admises ; ou logement filtré par roles).
Violation si une fonction de `functions` ∉ F, ou si `anyOf` est défini et qu'aucune n'est dans F. Message :
liste des fonctions manquantes ; `measured`/`expected` non renseignés.

## 9. `capacite_occupants`
| param | type | unité | rôle |
|---|---|---|---|
| measure | `'sleeps'` \| `'seats'` | — | champ lu sur la spec (absent = 0) |
| providing | UsageFunction | — | ne compter que les specs fournissant cette fonction |
| aggregate | `'somme'` \| `'max'` | — | agrégation sur les placements comptés |
| bound | `'min'` \| `'max'` | — | V ≥ N + margin, ou V ≤ N + margin |
| margin | integer | places | décalage |
| ignoreCategories | string[] | — | catégories non comptées |
| ignoreOnlyIfRoles | RoomRole[]? | — | `ignoreCategories` ne s'applique que si le plan compte une pièce de l'un de ces rôles (D21) |

Portée logement : placements des pièces filtrées par `applicability.roles` (toutes sinon). V = agrégat (0 si aucun).
`bound 'min'` : violation si V < N + margin ; `bound 'max'` : violation si V > N + margin (V = 0 → passe).
`measured` = V, `expected` = N + margin.

## 10. `triangle_cuisine`
| param | type | unité | rôle |
|---|---|---|---|
| minLeg | number | m | côté minimal |
| maxLeg | number | m | côté maximal |
| maxPerimeter | number | m | périmètre maximal |

Par pièce : pôles `evier`, `cuisson`, `froid`. Pour chaque pôle, le placement fournisseur (premier dans l'ordre de
`layout.placements`). Position d'un pôle : point du bord avant de l'emprise ; si un placement fournit k pôles, ils
sont répartis dans l'ordre [froid, evier, cuisson] (filtré) aux abscisses locales `−w/2 + w·(i+0.5)/k`, convertis
en monde. Pôle manquant → rulesSkipped (le manque est déjà signalé par USA-08). Violation si un côté < minLeg ou
> maxLeg, ou si périmètre > maxPerimeter. `measured` = valeur en défaut.

## 11. `ratio_dimension`
| param | type | unité | rôle |
|---|---|---|---|
| numerator | `'largeur'` \| `'surface'` | — | largeur = `S(p).size.w` ; surface = somme des aires d'emprise |
| categories | string[] (`'*'` admis) | — | placements mesurés |
| reference | `'mur'` \| `'categorie'` \| `'piece'` | — | dénominateur |
| referenceCategories | string[]? | — | pour `'categorie'` |
| min / max | number? | ratio | bornes |
| ignoreCategories | string[] | — | exclus du numérateur |
| wallTolerance | number? | m | pour `'mur'` (défaut 0,30) |

`mur` : par placement, l'arête du polygone de la pièce parallèle au bord arrière (−y local) et à ≤ wallTolerance de
celui-ci, la plus proche ; dénominateur = longueur de cette arête (arête entière, ouvertures comprises) ; aucune →
placement non contrôlé. `categorie` : par placement, dénominateur = `size.w` du placement de referenceCategories le
plus proche (centres) dans la pièce ; aucun → non contrôlé. `piece` : un ratio par pièce = somme des surfaces des
placements retenus / `room.area`. Violation si ratio < min ou > max. `measured` = ratio.

## 12. `distance_entre_categories`
| param | type | unité | rôle |
|---|---|---|---|
| from / to | string[] | — | catégories source / cible |
| measure | `'bord_a_bord'` \| `'faces_avant'` \| `'centres'` | — | métrique |
| min / max | number? | m | bornes |
| sameRoomOnly | boolean | — | cibles limitées à la pièce de la source |

Pour chaque placement source, cible = placement `to` le plus proche selon la métrique. `bord_a_bord` = distance
entre rectangles d'emprise (0 si contact) ; `faces_avant` = distance entre les milieux des bords avant ;
`centres` = distance entre centres. Pas de cible → non contrôlé. Violation si d < min ou d > max.

## 13. `zonage_jour_nuit`
| param | type | unité | rôle |
|---|---|---|---|
| maxJourCrossings | integer | pièces | nombre maximal de pièces « jour » traversées |

Graphe non orienté : pièces = nœuds, `analysis.adjacency` (b ≠ null) = arêtes. Pièce d'entrée = pièce ayant une
adjacence avec `b === null` via une porte (`input.openings[viaOpening].kind === 'door'`) ; à défaut → rulesSkipped.
Pour chaque pièce de zone `'nuit'` : plus court chemin (BFS, ordre des ids pour départager) depuis l'entrée ; on
compte les pièces intermédiaires (hors extrémités, l'entrée exclue) de zone `'jour'`. Violation si > maxJourCrossings.
`measured` = nombre compté. Ne tient pas compte du mobilier (défaut du plan, signalé).

## 14. `recommandation_prises`
| param | type | unité | rôle |
|---|---|---|---|
| minCount | integer? | prises | nombre recommandé |
| smallAreaThreshold / smallAreaCount | number? / integer? | m² / prises | si `room.area ≤ seuil`, recommander smallAreaCount |
| m2PerSocket / maxRequired | number? / integer? | m² / prises | variante « 1 prise par tranche » (max(minCount, ceil(area/m2PerSocket)) plafonné) |
| minAboveWorktop | integer? | prises | dont au-dessus du plan de travail |
| nearSwitch | boolean? | — | prise près de l'interrupteur d'entrée de pièce |
| dedicatedFor | UsageFunction[]? | — | alimentation dédiée par placement fournissant ces fonctions |
| nearFunctions | UsageFunction[]? | — | prises à prévoir près des placements fournissant ces fonctions |

**Ne produit jamais de Violation.** Ajoute à `InteriorReport.recommendations` une phrase par pièce évaluée
(ou par placement pour dedicatedFor/nearFunctions), préfixée de l'id de règle, ex.
« [TEC-09] Chambre 2 : prévoir au moins 3 prises, dont près du chevet (placement p12). ». Poids 0 : n'affecte
aucun score. La règle figure dans `rulesChecked`.

## 15. `style_coherence`
| param | type | unité | rôle |
|---|---|---|---|
| aspect | `'palette_60_30_10'` \| `'essences_bois_max'` \| `'materiaux_max'` \| `'materiau_commun'` | — | contrôle |
| scope | `'piece'` \| `'logement'` | — | agrégation |
| max | integer? | — | pour essences/materiaux |
| dominantMin/Max, secondaryMin/Max, accentMax | number? | ratio | pour la palette |
| colorTolerance | number? | distance RVB (0–442) | regroupement des couleurs proches |
| excludeCategories | FurnitureCategory[]? | — | (INT-07, D24) catégories ignorées par le contrôle |
| minPlacements | integer? | — | (INT-07, D24, palette) nombre minimal de placements colorés pour évaluer une pièce |

Données : `Placement.finish` (facultatif, ajouté à types.ts en INT-01). Si aucun placement de la portée n'a de
`finish` → rulesSkipped (« finitions non renseignées »). Surface apparente d'un placement
`A(p) = max(w·h, w·d)` de la spec. `palette_60_30_10` : couleurs `finish.color` regroupées (glouton, ordre
décroissant de A, distance euclidienne RVB ≤ colorTolerance) ; parts = A cumulée du groupe / A totale des placements
colorés ; violation si part 1 ∉ [dominantMin, dominantMax], part 2 ∉ [secondaryMin, secondaryMax], ou une part
au-delà de la 2e > accentMax. `essences_bois_max` : nombre de `woodSpecies` distinctes (material === 'bois') > max.
`materiaux_max` : nombre de `material` distincts > max. `materiau_commun` : matériau dominant (A cumulée maximale)
de chaque pièce évaluée ; violation si au moins deux pièces ont des matériaux dominants différents.

## 16. `vis_a_vis`
| param | type | unité | rôle |
|---|---|---|---|
| from / to | string[] | — | catégories source / cible (ex. canapé / meuble TV) |
| maxLateralOffset | number | m | décalage latéral maximal entre les milieux des faces avant |
| sameRoomOnly | boolean | — | cibles limitées à la pièce de la source |

Pour chaque placement source ayant au moins une cible : parmi les cibles dont le devant est **opposé** à celui de
la source et dont le milieu de face avant est **devant** la source, celle de plus petit décalage latéral (écart des
milieux des faces avant, perpendiculairement au devant de la source). Violation si aucune cible n'est en face ou si
ce décalage > `maxLateralOffset` (`measured` = décalage). Aucune paire dans les pièces évaluées → rulesSkipped.
La distance de vision est contrôlée à part (`distance_entre_categories`, ECH-07).

## 17. `adossement`
| param | type | unité | rôle |
|---|---|---|---|
| categories | string[] | — | placements contrôlés (ex. lit) |
| maxGap | number | m | écart maximal entre le bord arrière et le mur |
| side | `'back'` | — | côté adossé (seul le dos est défini en v1) |

Le bord arrière (−y local) d'un placement est **adossé** si des arêtes axiales du polygone, parallèles à ce bord,
situées derrière lui à une distance ∈ [0, `maxGap`], couvrent toute sa largeur (fenêtres comprises : l'arête est
celle du polygone, D23). Violation sinon (`measured` = plus petit écart trouvé). Aucune cible → rulesSkipped.

---

## Décisions d'implémentation (INT-06, critique `src/critic/`)

Points où le contrat ci-dessus était muet, ambigu ou incohérent ; l'implémentation suit ces décisions (renvois `D<n>` dans le code).

- **D1 — Non-applicabilité.** Une règle dont `construction`, `kind` ou `pmr` ne correspond pas, ou dont `roles` ne désigne
  aucune pièce du plan, n'apparaît **ni** dans `rulesChecked` **ni** dans `rulesSkipped` (consigne INT-06, qui remplace la
  phrase « Sinon → rulesSkipped (raison : non applicable) » du §0.2). Exceptions prévues par le contrat :
  `includeSejourIfNoChambre` (D7) et `fallbackToEntranceRoom` (D11). `rulesSkipped` est réservé aux règles applicables
  mais impossibles à évaluer faute de donnée (finitions, équipements d'eau, pôles de cuisine, cible absente, condition
  du brief, unité de vie vide, params invalides).
- **D2 — Grille.** Points `bbox.min + k·0,05` (k ≥ 0) situés dans le polygone (`pointInPolygon`, bord inclus) ; les
  comparaisons de seuils se font à 1e-6 près. Ancrer la grille sur `bbox.min` garantit qu'un couloir de 0,90 m a un point
  sur son axe (sinon `passage_min` 0,90 m échouerait sur un couloir exactement conforme).
- **D3 — `passage_min`, cibles d'usage (incohérence tranchée).** Le contrat place la cible au milieu du bord extérieur
  de `frontClearanceRect`. Ce point est souvent **sur un mur ou contre un autre meuble** dans une implantation que le
  catalogue juge correcte (lit dont le dégagement de pied de 0,60 m va jusqu'au mur ; table basse posée au bord du
  dégagement du canapé) : il serait alors inatteignable pour toute largeur > 0,20 m, et CIR-02 (bloquante) échouerait
  presque partout. De plus les dégagements du catalogue (0,60 m) sont plus étroits que le passage exigé (0,70 m).
  Décision : la cible d'usage est le **rectangle** `frontClearanceRect` ; elle est atteinte si une cellule passable est
  à ≤ `w/2 + 0,05` m de ce rectangle (le disque libre du passage touche la zone d'usage, à un pas de grille près).
  Les cibles « porte » restent celles du contrat (point décalé de `w/2`, atteinte à ≤ 0,10 m). Une porte non située en
  bord de pièce n'est pas une cible (hypothèse consignée). Les débattements ne sont pas des obstacles de passage.
  `measured` : plus grande largeur `minWidth − k·0,05` (k ≥ 1) qui connecte toutes les cibles, 0 sinon.
- **D4 — Rayons.** Un rayon parallèle à une arête (rasant) ou tangent au bord d'une emprise n'est pas arrêté ; une origine
  strictement intérieure à une emprise donne 0. Débattement (convexe) : si la traversée du secteur est ≤ `swingTolerance`,
  le rayon continue ; sinon il est arrêté à `entrée + swingTolerance`. Points de prolongement (`sideZoneLength`) situés
  hors de la pièce : profondeur 0.
- **D5 — `degagement_categorie`.** Jeu alternatif : les côtés sans `alt*` gardent leur `min*` (`minBack` toujours
  conservé). `useSpecClearances` : mode `'tous'`, `lateralMode` et `alt*` ignorés. `relaxOneSideIfSinglePiece` s'applique
  après résolution de `'tous_si_double'`. `'au_moins_un'` sans aucun seuil latéral défini : côté latéral non contrôlé.
  `measured` = plus petite profondeur en défaut du jeu **principal** (plafonnée à 5 m). `au_moins_un_logement` : `measured`
  issu de la cible dont la profondeur en défaut est la plus grande (la plus proche de passer), `placementIds` = toutes les cibles.
- **D6 — `emprise_valide`.** Un placement à spec inconnue produit une violation (roomId de la pièce si elle existe) et est
  exclu de tous les autres contrôles (consigné dans `missing`) ; un placement dans une pièce inconnue produit une
  violation de portée logement. Le chevauchement (b) est signalé une fois par paire ; le contrôle (c) s'applique à toutes
  les catégories (tapis compris). `measured` = aire d'intersection (ou aire hors pièce pour (a)), `expected` = 0.
- **D7 — `cercle_manoeuvre`.** `includeSejourIfNoChambre` s'applique aussi lorsqu'aucune chambre n'est au niveau d'accès
  (`uniteDeVie`), conformément à l'art. 13 (unité de vie : chambre ou partie du séjour aménageable). Les débattements sont
  traités comme des polygones pleins. `au_moins_une_piece` : portée logement pour les scores.
- **D8 — Unité de vie vide.** Si `uniteDeVie` retire toutes les pièces concernées → `rulesSkipped` (« aucune pièce
  concernée au niveau d'accès (unité de vie) »).
- **D9 — `distance_fixture`.** Une violation au plus par placement contrôlé (fixture la plus proche). `max` : une pièce
  sans fixture des types demandés est consignée dans `missing` ; la règle n'est `rulesSkipped` que si aucun placement
  n'a pu être contrôlé. Aucun placement contrôlé → règle vérifiée, conforme. `piece_humide` : pas de `measured`.
  `distance` absente en `min`/`max` : 0.
- **D10 — `ratio_dimension`, référence `mur`.** Arête du polygone parallèle au bord arrière, à une distance signée dans
  [−wallTolerance, +wallTolerance] **derrière** ce bord, et dont l'étendue recouvre celle du bord arrière ; la plus proche.
  Numérateur `surface` en mode `mur`/`categorie` : aire d'emprise du placement. Mode `piece` : ratio calculé pour toute
  pièce évaluée (0 si vide).
- **D11 — `fonctions_requises`.** `whenBrief` non rempli → `rulesSkipped` (comme écrit au §8). Repli entrée : première pièce
  (ordre de l'analyse) ayant une porte de nature `door` vers `null`. Portée `logement` : `roles` restreint les pièces
  comptées. Les éléments de `layout.unplaced` dont la spec fournit une fonction manquante sont cités dans le message et
  l'action (la priorité « obligatoire » n'étant pas dans l'entrée du critique, tout élément non placé pertinent est cité).
- **D12 — `zonage_jour_nuit`.** Plusieurs pièces d'entrée possibles : la pièce de rôle `entree` d'abord, puis la plus petite
  id. Une pièce de nuit non reliée à l'entrée est consignée dans `missing` (pas de violation). Pièces évaluées = pièces de nuit.
- **D13 — `style_coherence`.** `max` absent : non borné. Pièce sans finition : non évaluée ; `rulesSkipped` seulement si
  aucun placement de la portée n'a de finition. Palette : couleurs non hexadécimales ignorées ; le représentant d'un
  groupe est sa première couleur (plus grande A) ; part secondaire = 0 si une seule couleur ; une violation par portée,
  `measured` = premier défaut (dominante, secondaire, accents). `materiau_commun` compare toujours les pièces évaluées
  (portée logement) ; égalité d'aire départagée par ordre alphabétique du matériau.
- **D14 — `recommandation_prises`.** Priorité du compte : `smallAreaThreshold`/`smallAreaCount` si la surface est sous le
  seuil, sinon `m2PerSocket` (avec `minCount` et `maxRequired`), sinon `minCount`. Aucune phrase pour une pièce si le compte
  est 0 et qu'il n'y a rien d'autre à dire. `dedicatedFor` : une phrase par placement concerné.
- **D15 — `triangle_cuisine`.** Une violation par pièce (`measured` = premier défaut : côtés froid–évier, évier–cuisson,
  cuisson–froid, puis périmètre). Une pièce incomplète est ignorée si une autre pièce évaluée est complète ;
  `rulesSkipped` si aucune ne l'est.
- **D16 — Ids et ordre.** `Violation.id` = `<ruleId>:<roomId | logement>:<nn>` (compteur par règle et par pièce, dans
  l'ordre de production) ; règles dans l'ordre de la base, pièces dans l'ordre de l'analyse, placements dans l'ordre du layout.
- **D17 — Scores et verdict.** Score d'une famille dans une pièce = 100 × (1 − Σ poids des règles en défaut dans la pièce
  / Σ poids des règles de la famille évaluées dans la pièce), 100 si aucune. Les violations de portée logement
  (`roomId` null) n'entrent pas dans les scores de pièce mais une violation bloquante de portée logement rend le
  **global** défavorable. `reserve` : score dégradant (échelle + organisation + style, même formule) < **75** —
  hypothèse Mimmoza (barème 2026) — pour une pièce, ou pour le logement (règle en défaut si elle a au moins une violation).
- **D18 — Satellites et passages (INT-05b).** Chevets et chaises (de repas, de bureau) s'utilisent depuis leur meuble
  parent (lit, table, bureau) : ils restent des **obstacles** mais ne sont plus des **cibles** d'usage de
  `passage_min` (param `satelliteCategories` de CIR-02 et ORG-08). Avant, la cible d'un chevet accolé (bord de son
  dégagement avant de 0,40 m, à 0,225 m du lit) était inatteignable par un passage de 0,70 m : le solveur décalait
  artificiellement les chevets de 0,095 m. Ce décalage est supprimé : le chevet est accolé à la tête de lit.
- **D19 — `Placement.mirrored` (INT-05b).** Champ facultatif ajouté à `types.ts` : il permute les dégagements gauche
  et droite de la spec (`effectiveClearances`, src/geometry). Pris en compte par `clearanceRect`, par
  `degagement_categorie` en mode `useSpecClearances` (USA-02) et par le solveur. Choix retenu plutôt que des
  dégagements symétriques : un lit 1 place se pose couramment en angle, un grand côté contre le mur, l'autre
  dégagé ; des dégagements symétriques (0,60 m des deux côtés) interdiraient cette implantation professionnelle,
  alors que USA-03 n'exige qu'un grand côté pour un lit simple.
- **D20 — `distance_fixture`, mode `zone_avant` (INT-05b).** Zone libre devant l'équipement (voir §7). Utilisé par
  TEC-02 (tableau électrique, hypothèse Mimmoza recalibrée : l'accès se juge devant la face du tableau ; l'ancien
  rayon de 0,70 m tout autour interdisait tout rangement dans les entrées étroites du banc).
- **D21 — `capacite_occupants`, `ignoreOnlyIfRoles` (INT-05b).** USA-12 n'exclut le canapé convertible que si le
  logement compte une chambre : dans un studio, le convertible EST le couchage programmé. Une hypothèse est consignée
  quand l'exclusion est levée.
- **D22 — `vis_a_vis`.** Voir §16 ; cible retenue = plus petit décalage parmi les cibles en face.
- **D23 — `adossement`.** Voir §17 ; l'arête du polygone suffit (une fenêtre au-dessus d'une tête de lit n'empêche
  pas l'adossement, le solveur la pénalise seulement dans son scoring).
- **D24 — `style_coherence`, `excludeCategories` et `minPlacements` (INT-07).** Les placements des catégories
  `excludeCategories` sont ignorés par le contrôle, y compris pour décider `rulesSkipped` (« finitions non renseignées »
  si aucun placement NON exclu de la portée n'a de finition). Palette : une pièce dont le nombre de placements colorés
  (hors exclus) est < `minPlacements` n'est pas évaluée (absente des scores de la pièce). Recalibrages associés
  (hypothèse Mimmoza 2026, justifiés dans `interpretation`) : **STY-01 v2** exclut sanitaires et électroménager
  (blanc / inox de la notice descriptive), `minPlacements` 3, `secondaryMax` 0,40 → 0,50 (borne impliquée par
  `dominantMin` 0,50 : sur le mobilier seul, lit et armoire de tailles voisines imposent ~55/45) ; **STY-04 v2** ignore
  tapis et électroménager (un tapis de 3,7 m² rendait le « tissu » dominant dans tout séjour meublé). Aucune règle
  `norme` n'est touchée. Les mêmes mesures sont partagées avec src/style (src/critic/style-mesures.ts).
