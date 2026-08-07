# Récap session du 6 août 2026 — chaîne d'étude, honnêteté des données

Point de reprise. Fait suite au récap du 5 août (chaîne d'étude promoteur).

---

## Le fil rouge

Le 5 août avait identifié un défaut : **une absence d'information transformée en
zéro, puis propagée comme un fait.** La session du 6 en a trouvé deux variantes,
et le même mécanisme à sept étages de plus.

1. **L'absence devenue zéro** — une API muette produit une note, généralement
   flatteuse. Corrigé dans `risk-study-v1`, `smartscore-enriched-v3` et les hooks
   d'analyse rapide.
2. **La valeur sans son périmètre** — un chiffre exact, mais rattaché au mauvais
   cadre. La médiane du département 64 présentée comme le marché d'Ascain ; un
   plafond de requête (`limit 500`) présenté comme un décompte ; un rayon de 5 km
   annoncé pour des données communales.
3. **Le nom lu à la place du contenu** — un pilier appelé « environnement » qui
   mesure des équipements, et que le Copilot a commenté comme un « cadre
   favorable ».

Une leçon transversale, qui s'est répétée trois fois : **construire un signal
d'honnêteté ne suffit pas, il faut le relayer.** `perimetre_label`,
`confidence`, `zone_profile`, `bpe_quality` existaient — personne ne les
transmettait au Copilot.

---

## Ce qui est fait

### risk-study-v1 — v1.0.3 → **v1.1.1**

- **v1.1.0 · « pas de donnée ⇒ pas de note ».** `aggregateRisk()` remplace quatre
  agrégations dupliquées et renvoie `null` quand aucun critère n'est mesuré, au
  lieu d'un `: 0` de risque qui valait **100/100 de sécurité**. Poids
  renormalisés sur les seules catégories mesurées. `scoreToLevel(null)` →
  `'inconnu'` et non plus `'nul'`.
- `fetchGaspar` : `coverage` déduit du **succès HTTP**, plus du nombre de
  résultats — « zéro arrêté CatNat » est une information, « API muette » n'en est
  pas une, et l'ancien test confondait les deux dans les deux sens.
- `fetchSeisme` / `fetchFeuxForet` : un département non résolu tombait sur
  `|| 1` (« Très faible ») avec `coverage: 'ok'` — deux critères comptés comme
  mesurés à la valeur la plus rassurante.
- `generateInsights` : retour anticipé si `scores.global === null`. En JS
  `null <= 40` est **vrai** : la fonction annonçait sinon « Niveau de risque
  global ÉLEVÉ (null/100) ».
- **v1.1.1 · le trou laissé par v1.1.0.** J'avais corrigé l'agrégation, pas ce
  que les sources déclarent. `fetchIcpe`, `fetchSis`, `fetchCavites`,
  `fetchMouvementsTerrain` renvoyaient toutes `risk_level: 'nul'` — « mesuré,
  aucun risque » — que l'API ait répondu zéro **ou** rien du tout. Comme
  `aggregateRisk` ne lit que `risk_level`, une source muette valait un critère
  mesuré à 100/100. Chaque fetch distingue désormais `indisponible` de `aucun`.
- Même correctif sur la branche **sans coordonnées** du handler : quatre couches
  bbox non interrogées se déclaraient `'nul'`.
- **Radon** : Géorisques renvoie `classe_potentiel` en **chaîne** (`"1"`). Les
  tests `classe === 1` étant stricts, le radon était silencieusement non mesuré
  et vidait toute la catégorie Pollution. Coercition `Number()`.
- Troncature de pagination signalée (`truncated`) : « 100 ICPE » était le plafond
  `page_size=100`, pas un décompte.

### market-study-investisseur-v1 — v1.3.8 → **v1.4.4**

- **v1.4.0 · le défaut le plus coûteux.** `fetchDvfFromSupabase(dept, _communeNom)`
  — le nom de commune préfixé d'un underscore, donc volontairement inutilisé. Les
  trois requêtes filtraient sur `.eq("code_departement", dept)` avec
  `.limit(500)`. La médiane **départementale** passait pour le marché local, et
  « 500 transactions » était le plafond de la requête, identique pour toutes les
  communes de France.
  Mesuré : Ascain affichait 4 184 €/m² — exactement la médiane des 500 dernières
  mutations du 64 — contre **5 801 €/m² sur 34 ventes** en réalité.
  Sous-évaluation de 28 %.
  ⚠️ `code_commune` est stocké **sans zéro de tête** (`'65'`, pas `'065'`).
- Seuils du pilier offre : `nb_transactions > 50` était vrai en permanence (500),
  le bonus de +15 acquis d'office et le malus jamais déclenché.
- `is_urban` branché sur `insee_grille_densite`. Overpass ne décide plus de
  l'urbanité, il compte les arrêts.
- **Le piège** : corriger `is_urban` seul aurait fait entrer le pilier transport
  avec un 0 — Ascain devenant urbaine alors qu'Overpass ne trouve aucun arrêt.
  On aurait troqué un faux « non applicable » contre un faux « 0/100 », **pire**,
  car le zéro entre dans la moyenne quand l'exclusion n'y entre pas. Le pilier
  n'est évalué que si une desserte est réellement mesurée.
- **v1.4.1** · `geocodeParcel` sur **Apicarto IGN** au lieu de geo.api
  (injoignable depuis Supabase). Parcelle testée en premier.
- **v1.4.2** · `bpe_quality` enrichi : périmètre communal explicite et
  avertissement sur les zéros. L'extrait BPE d'Ascain ne contient que 18 lignes
  et aucun code `D301` : « 0 pharmacie » est une lacune de source.
- **v1.4.3** · le pilier « environnement » vaut `bpe.score` + bonus
  d'équipement — il ne dit rien du cadre de vie. Et **asymétrie corrigée** : sur
  un extrait partiel, une catégorie absente ne pénalise jamais tandis qu'une
  présente accorde un bonus ; le score ne pouvait que monter là où la donnée est
  la moins fiable.
- **v1.4.4** · `meta.perimetres` — `radius_km` ne gouverne en réalité que la
  concurrence EHPAD. Pour un logement, il ne sert à rien, mais était exposé seul
  et lu comme le rayon de toute l'étude.

### smartscore-enriched-v3 — v4.4 → **v4.7**

- **v4.5 · deux valeurs fabriquées.** `computeGeorisquesScore` retournait
  `{ score: 70, risks_count: 0 }` en dur pour 40 % du pilier environnement.
  `fetchPermisProches` retournait `[]`, lu comme « aucun permis » → 70/100 et
  « Pas de concurrence identifiee ». Les deux à `null`.
- `computeEnvironmentScore` renvoie `null` sans composant mesuré — écarter le
  seul Géorisques aurait fait **monter** le pilier, qui retombait sur la seule
  estimation de bruit (85 en « rural »).
- `estimateNoiseScore` porte un drapeau `estimated` : ce score n'est jamais
  mesuré.
- `computeSmartScoreV4` renvoie `score: null` au lieu de 50 — un 50 pouvait
  signifier « moyen » **ou** « rien n'a répondu ». Garde-fou sur
  `Math.min(null, cap)` qui aurait été coercé en **0**.
- **v4.6 · `isRural`** valait `!isInGrandeAgglomeration(insee)` : la négation
  d'une liste blanche de 14 départements. Mesuré en base : **5 843 communes sur
  34 875 mal classées** (3 145 rurales à tort, 2 698 urbaines à tort).
  ⚠️ Ce prédicat faisait **deux métiers** : un libellé, et une politique de
  rayons (500 m urbain / 20 km rural). Corriger le libellé seul aurait fait
  passer Ascain de 20 km à 500 m et effacé ses services. Les rayons sont donc
  **gradués sur `niveau_7`**, les sept niveaux de la grille.
- **v4.7 · les deux stubs branchés** sur `risk-study-v1` et
  `promoteur-permis-construire`.
  ⚠️ Le contrat expose `nombreLogements` là où le calcul lit `nb_logements` :
  sans mappage, tous les permis auraient compté pour 0 logement.
  ⚠️ `FUNCTIONS_BASE_URL` en const de module lisait `supabaseUrl` dans sa zone
  morte temporelle → `ReferenceError` au chargement. Résolution paresseuse.

### copilot-chat

- **Conclusion obligatoire** en prose sur toute étude, en quatre temps, avec des
  règles de véracité qui priment sur la fluidité. C'est la partie à ne jamais
  couper.
- Relais des signaux d'honnêteté : `perimetres`, `perimetre_label`,
  `confidence`, `zone_profile`, `bpe_quality`, `lexique_scores`,
  `environnement_detail`.
- `toolEtudeMarche` **n'envoyait ni `parcel_id` ni `commune_insee`**, et le
  schéma de l'outil ne les déclarait même pas : le modèle ne pouvait pas les
  transmettre. D'où deux « Indisponible » puis un géocodage par nom de commune —
  analyse centrée sur le centre-bourg. Corrigé : 3 appels → **1**.
- Décomptes à 0 (SIS, cavités, mouvements, CatNat) publiés pour des sources
  muettes, dont le modèle concluait « aucun risque identifié ».

### etude-parcelle-v1

- « Aucun aléa majeur remonté par Géorisques » n'est plus produit sur une réponse
  entièrement muette.

### Front

- **`useCopilotContext`** : `CopilotChat` appelait `buildContext()` **dans son
  corps de rendu** pour lire un seul champ. À chaque paquet de tokens : deux
  parcours complets du `localStorage`, deux `JSON.parse`, douze `console.log`.
  D'où ~60 blocs par réponse. `vertical` est désormais mémorisé ; les traces
  passent en opt-in (`localStorage.mimmoza.copilot.debug = '1'`).
- **`useQuickAnalysisData` / `useValuationEngine`** lisaient
  `data?.risks ?? data?.georisques ?? data` — aucune de ces clés n'existe, les
  aléas sont sous `data.data.*`. Tous les drapeaux à `false`,
  `globalRiskLevel: "low"`, ce qui accordait **+8 au score d'opportunité** et
  **+5 à la confiance**. Une lecture qui échouait produisait un bonus de
  valorisation.
- `RisquesPage`, `BilanPromoteurPage`, `DealCenterPage`, `DataConfidenceTab`,
  `knowledgeGraph.providers` : nullabilité portée, `'tres_fort'` réintégré au
  graphe (le risque **maximal** en était absent).
- **`useComposerTools`** (nouveau) : pièces jointes et dictée extraites, et
  ajoutées au composeur de conversation où elles manquaient. `CopilotChat`
  ignorait le 2ᵉ argument de `sendMessage` : les fichiers joints auraient été
  perdus.
- **UX** : menu MimmozIA en thème sombre (variables `--mz-surface*`), orbe en
  variante image.
- `MarchePage` : deux erreurs de typage héritées du 5 août — `mobility_gtfs` non
  déclaré, et `s.v` nullable qui imprimait « null » en rouge dans le PDF.

**`npm run build` passe** (2 942 modules). Avertissements préexistants : chunk
principal à 6,3 Mo, imports dynamiques doublés en statique, `caniuse-lite`
à rafraîchir.

---

## Vérification sur Ascain — parcelle 64065000AI0002

| | Début de session | Fin de session |
|---|---|---|
| Prix médian | 4 184 €/m² *(département 64)* | **5 801 €/m²** *(commune)* |
| Transactions | « 500 » *(plafond de requête)* | **34** *(réelles)* |
| Zone | « non-urbaine » | **Ceintures urbaines** *(INSEE)* |
| Pharmacies | « 0 » | Non recensé dans l'extrait |
| Environnement | 80 *(bonus sur extrait partiel)* | **65** |
| Score marché | 61 | **57** |
| SmartScore | 68 *(dont 70 de concurrence inventée)* | **58** |
| Sécurité risques | 85/100 | **66/100 puis 68/100, 5 critères sur 9** |
| Appels à l'étude | 3, dont 2 échecs | **1** |

Les scores baissent partout : les valeurs hautes venaient de données absentes
comptées comme favorables.

---

## Ce qui reste ouvert

1. **`InvestisseurRisquesPanel`** — clone intégral de `RisquesPage` dont la
   nullabilité n'a jamais été portée. `getScoreColor(null)` y chute jusqu'au
   palier le plus **alarmant**, `width: "null%"`, « null » imprimé en 56 px dans
   le PDF, « Hors zone PPRI » sur donnée absente, et le `: 1` de persistance qui
   enregistre un aléa inconnu comme risque minimal. À **mutualiser**.
2. **Accessibilité à deux régimes** (décision D du 5 août, toujours non
   commencée). Le pilier transport reste écarté à Ascain alors que la commune est
   desservie par Txik Txak et à 5,9 km de la gare de Saint-Jean-de-Luz. Régime
   selon `niveau_7` : transports en commun pour 1-3, minutes de voiture pour 4-7.
   *Un promoteur à Ascain ne vend pas « à 300 m du tram », il vend « 20 minutes
   de Saint-Jean-de-Luz ».*
3. **Socle géographique francilien.** `cadastre_parcelles` ne couvre que 75, 77,
   78, 91-95 (3,7 M parcelles). `mobility_stops` : 53 967 arrêts « metro » qui
   sont des bus franciliens, aucun bus ni tram hors IdF. Hors Île-de-France, la
   chaîne dépend entièrement d'API externes.
4. **`MimmozIAPage`** garde sa copie en ligne de la logique pièces jointes /
   dictée : son `recording` alimente aussi l'état de l'orbe, migration à vérifier
   à l'écran.
5. **PNG de l'orbe** : le damier de transparence est **incrusté dans les pixels**
   (export à plat). À réexporter en PNG-24 avec canal alpha ; le masque
   circulaire posé en CSS n'est qu'un contournement.
6. **DPE de quartier et qualité de l'air** : toujours des stubs `null` dans
   smartscore.
7. **Barème BPE en valeur absolue** (palier haut à 30 équipements, sans
   population) — inchangé depuis le 5 août.
8. **FiLoSoFi** absent pour de nombreuses communes : le tableau socio-économique
   affiche des valeurs de repli départemental sans toujours le dire.

---

## Points de vigilance

- **Le source de `market-study-promoteur-v1` n'est toujours pas dans le dépôt.**
  Il n'existe qu'en production. Ne pas le confondre avec
  `market-study-investisseur-v1`, corrigé ici — ce sont deux moteurs distincts,
  et le premier a probablement les mêmes défauts.
- **Le shell Linux n'a pas répondu une seule fois** de la session. Aucun `tsc`
  intermédiaire : c'est le `npm run build` final qui a servi de contrôle.
- **Piège de déploiement récurrent** : un onglet VS Code ouvert avant les
  modifications recopie l'ancien contenu. Vérifier la ligne `VERSION` avant de
  valider.
- Chaque page redéclare ses propres interfaces locales : `tsc` passe même quand
  un contrat est violé. Les régressions de contrat ne seront pas signalées par la
  compilation.

### Marqueurs de version

| Fonction | Version | Marqueur |
|---|---|---|
| `risk-study-v1` | 1.1.1 | `classe_potentiel` en chaîne |
| `market-study-investisseur-v1` | 1.4.4 | `meta.perimetres` |
| `smartscore-enriched-v3` | v4.7 | `callEdgeFunction` |
| `copilot-chat` | — | `CONCLUSION OBLIGATOIRE` |
| `etude-parcelle-v1` | — | `Aucun critère de risque n'a pu être mesuré` |

---

## Décisions prises

- Le Copilot reste en **lecture seule** sur les études : un second chemin
  d'écriture recréerait la divergence écran/base corrigée sur `MarchePage`.
- Périmètre DVF : **commune, repli département déclaré** sous 10 ventes.
- Les rayons de recherche suivent la **grille INSEE à 7 niveaux**, pas un binaire.
- Un pilier non mesuré est **écarté avec son motif**, jamais noté 0 ni omis.
