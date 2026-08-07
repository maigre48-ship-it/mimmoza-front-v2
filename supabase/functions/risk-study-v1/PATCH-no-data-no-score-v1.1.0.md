# risk-study v1.1.0 → v1.1.1 — « pas de donnée ⇒ pas de note »

> ## ⚠️ v1.1.1 — le trou laissé par v1.1.0
>
> v1.1.0 déployée (version 68 → suivante), testée sur la parcelle
> **64065000AI0002** (Ascain) via le copilote. L'indicateur de confiance
> fonctionne — « Score calculé sur 7 critères sur 9 » est bien remonté. Mais la
> même sortie affichait **technologiques 100/100, pollution 100/100 et
> géotechniques 100/100**, cette dernière alors que l'aléa argiles était
> explicitement `inconnu`.
>
> **Cause : j'avais corrigé l'agrégation, pas ce que les sources déclarent.**
> `fetchIcpe`, `fetchSis`, `fetchCavites` et `fetchMouvementsTerrain`
> retournaient un `empty` unique portant `risk_level: 'nul'` — « mesuré, aucun
> risque » — que l'API ait répondu zéro OU qu'elle n'ait pas répondu.
> `aggregateRisk` ne lit que `risk_level`, jamais `coverage` : une source muette
> valait donc un critère mesuré à 100/100 de sécurité. Le défaut que je
> prétendais avoir tué avait simplement reculé d'un cran.
>
> Corrigé en v1.1.1 :
> - Chaque fetch distingue `indisponible` (`'inconnu'` / `coverage: 'error'`)
>   de `aucun` (`'nul'` / `coverage: 'ok'`).
> - Branche **sans coordonnées** du handler : les quatre couches bbox, non
>   interrogées, se déclaraient `'nul'`. Trois critères sur neuf étaient offerts
>   au score sans qu'aucune requête ne parte. C'est le scénario le plus fréquent
>   (geo.api injoignable depuis Supabase) — et l'étude de marché de cette même
>   parcelle avait justement commencé par échouer faute de coordonnées.
> - **Troncature de pagination** : « 100 installations ICPE » était le plafond
>   `page_size=100` présenté comme un décompte. Drapeaux `truncated` sur ICPE,
>   SIS, cavités, MVT et GASPAR ; libellés « 100+ » ; consigne explicite au
>   copilote de dire « au moins N ».
> - Libellés « 0 cavités » / « 0 événements recensés » remplacés par « Non
>   mesuré (source indisponible) » quand la source est muette.
>
> Leçon : corriger un agrégateur ne suffit pas si ses entrées mentent. Il faut
> remonter jusqu'à l'endroit où l'absence est **fabriquée**.
>
> ### Second test sur la même parcelle — deux anomalies de plus
>
> v1.1.1 déployée. Score global **85 → 66**, naturels **56 → 42**, et Pollution
> / Géotechniques affichent enfin « Non mesuré ». Mais la sortie contenait :
>
> **1. Radon silencieusement non mesuré — bug de typage.** Géorisques renvoie
> `classe_potentiel` en **chaîne** (`"1"`). Les tests `classe === 1` sont
> stricts, donc toujours faux : `libelle` restait « Inconnu » et `risk_level`
> `'inconnu'`, tandis que `classe_potentiel` était exposé à 1. Symptôme exact
> dans le chat : « Classe : 1 (libellé non précisé par la source) », et toute la
> catégorie Pollution vide alors que la donnée existait.
> → Coercition `Number()`, plus un `console.warn` sur classe hors 1-3 et
> `coverage: 'partial'` quand la classe est illisible.
>
> **2. Décomptes à 0 publiés pour des sources muettes (copilot-chat).** Dans
> `buildRiskStudyBlock`, les faits SIS / cavités / mouvements de terrain / ICPE
> / CatNat étaient publiés dès que `count != null` — or un décompte vaut **0**
> même quand rien n'a répondu. Le modèle recevait donc « Sites pollués : 0 ·
> Cavités : 0 · Mouvements : 0 » et en concluait « ✅ Aucun risque technologique
> identifié », immédiatement au-dessus d'un tableau annonçant ces mêmes
> catégories non mesurées.
> → Helper `compte()` qui écrit « NON MESURÉ » au lieu d'un zéro, et propage le
> drapeau de troncature.
>
> **3. Contradiction de libellés sismiques.** « Zone 4 (Moyen) » puis « niveau de
> risque : fort ». Les deux sont exacts — « moyenne » est le libellé du zonage
> réglementaire, « fort » l'échelle interne Mimmoza — mais rien ne le disait.
> Le bloc copilote nomme désormais explicitement les deux échelles.
>
> Variante notable du fil rouge : ici l'absence n'était pas due à une API muette
> mais à une **comparaison de type** qui jetait une donnée présente. Même effet
> final — un critère écarté sans que personne ne le sache.



Session du 5 août 2026. Quatrième étage du même défaut : **une absence
d'information transformée en zéro, puis propagée comme un fait.** Ici le zéro
était un *zéro de risque*, donc une **fausse assurance de sécurité**.

## Le défaut

`computeRiskScores` agrégeait chaque catégorie par
`scores.length > 0 ? moyenne : 0`. Un niveau `'inconnu'` (source Géorisques
muette, timeout, 404) donnait `-1`, filtré. Si **tous** les critères d'une
catégorie étaient inconnus, le risque valait `0`, donc la sécurité `100`.
Les quatre poids (0,35 / 0,25 / 0,20 / 0,20) s'appliquaient ensuite toujours,
sans renormalisation : une catégorie absente entrait dans le calcul comme
« sans risque » et remontait le score global.

Autrement dit : **plus les sources se taisaient, plus le terrain paraissait
sûr.** Sur l'étude de marché ce mécanisme produisait une note basse ; ici il
produisait une certification de sécurité.

Le champ `coverage` — calculé consciencieusement par chaque `fetch*` — n'était
lu par personne.

## Ce qui est corrigé

### `supabase/functions/risk-study-v1/index.ts` (v1.0.3 → v1.1.0)

- `aggregateRisk()` remplace les quatre agrégations dupliquées. Renvoie
  `score: null` quand aucun critère n'est mesuré, plus `mesures`, `total`,
  `coverage`.
- Poids **renormalisés** sur les seules catégories mesurées (`sommePoids`),
  même règle que `calculateDifferentiatedScores` côté marché. `poids_effectifs`
  est exposé pour que l'écran n'annonce jamais une pondération non appliquée.
- `scores` gagne `criteres_mesures`, `criteres_total`, `categories_mesurees`,
  `categories_non_mesurees`, `poids_effectifs`, `coverage`.
- `categories[]` gagne `coverage`, `criteres_mesures`, `criteres_total`.
- `scoreToLevel(null)` → `'inconnu'` (et non plus `'nul'`).
- `fetchGaspar` : `coverage` déduit du **succès HTTP**, plus du nombre de
  résultats. « Zéro arrêté CatNat » est une information ; « API muette » n'en
  est pas une. L'ancien test confondait les deux dans les deux sens.
- `fetchInondations` : garde-fou en tête de fonction. Cette sous-analyse est
  entièrement dérivée de GASPAR ; si GASPAR est muet elle ne peut rien
  conclure. Avant, elle renvoyait `risk_level: 'nul'` + `coverage: 'ok'`.
- `fetchSeisme` / `fetchFeuxForet` : un **département non résolu** tombait sur
  `|| 1` (« Très faible ») et `zone_risque: false`, avec `coverage: 'ok'` —
  deux critères comptés comme mesurés à la valeur la plus rassurante. Ils
  renvoient désormais `'inconnu'` / `no_data`.
- `zone_inondable`, `ppri`, `zone_risque`, `obligation_debroussaillement` :
  `boolean` → `boolean | null`.
- `generateInsights` : retour anticipé si `scores.global === null` — en JS
  `null <= 40` est **vrai**, la fonction annonçait sinon « Niveau de risque
  global ÉLEVÉ (null/100) ». Ajout d'un constat de confiance quand la
  couverture est partielle. « Aucun risque majeur identifié » n'est plus émis
  que si `coverage === 'ok'`.

### `supabase/functions/copilot-chat/index.ts`

- `summarizeRisks` : transmet le bloc `confiance` et le `coverage` par catégorie.
- `buildRiskStudyBlock` : règle absolue ajoutée au system prompt — absence de
  donnée ≠ absence de risque, interdiction d'écrire « hors zone », « aucun
  risque », « pas de PPRI » sur un critère non mesuré. Les scores null se
  rendent « non mesuré ». La ligne inondation testait `!= null`, ce qui laissait
  passer `false` et affirmait « hors zone » ; elle distingue maintenant les trois
  états. Le nombre de critères retenus et les catégories exclues sont annoncés.

### `supabase/functions/etude-parcelle-v1/index.ts`

- `adaptRisques` : « Aucun aléa majeur remonté par Géorisques » n'est plus
  produit sur une réponse muette — cette phrase partait au LLM.

### Front

- `RisquesPage.tsx` : `RiskScores` / `RiskCategory` / `InondationData`
  nullables ; `getScoreColor(null)` → gris neutre (ni vert ni rouge) ;
  `getVerdictConfig(null)` → « NON MESURÉ » ; `RiskGauge` et
  `CategoryScoreBar` rendent « non mesuré » et une barre vide ; `bar()` du PDF
  idem ; « PPRI non vérifié » à la place de « Hors zone PPRI » (écran + PDF).
- **Indicateur de confiance** sous le score global : nombre de critères
  retenus, catégories exclues, et rappel de portée (contexte communal, pas
  diagnostic de parcelle). C'était le dernier angle mort listé en fin de
  session précédente.
- `score_inondation` / `score_retrait_argile` persistés : un aléa `'inconnu'`
  tombait dans le `: 1` terminal, soit la **meilleure** valeur de l'échelle.
  → `null`. Idem `pollution_sols` quand SIS n'a pas répondu.
- `patchModule("risks")` : libellé « Score risque » → « Score sécurité » sur
  les **trois** chemins (deux dans `RisquesPage`, un dans
  `InvestisseurRisquesPanel`). L'ancien libellé inversait le sens pour le
  copilote qui relit ce snapshot.
- `BilanPromoteurPage.tsx` : quatre catégories `'inconnu'` donnaient
  `flagged.length === 0` donc **`scoreRisque = 100`**, propagé au score de
  faisabilité (·0,2) sans lever `riskInsufficient`. Exige désormais au moins
  une catégorie mesurée ; signale une note partielle.
- `DealCenterPage.tsx` : `!!data.scores` était toujours vrai (l'objet existe
  même tout à null) → pastille verte « analysé » et « Score sécurité :
  null/100 ». Message explicite « aucun critère mesuré, à relancer ».
- `DataConfidenceTab.tsx` : affichait complétude « Complète » et fiabilité
  « **Haute** » précisément quand rien n'avait été mesuré.
- `knowledgeGraph.providers.ts` : `'tres_fort'` était absent du filtre — le
  risque **maximal** disparaissait du graphe alors que `'fort'` y entrait.
  Mappé sur `'fort'`, niveau d'origine conservé en métadonnée.

## À déployer

Trois fonctions edge modifiées, non déployées :
`risk-study-v1`, `copilot-chat`, `etude-parcelle-v1`.

Le shell Linux est resté indisponible toute la session (timeouts en cascade),
donc **`tsc` n'a pas été exécuté**. Revue statique faite à la place. Bonne
nouvelle de contrat, mauvaise nouvelle de sécurité : chaque page redéclare ses
propres interfaces locales, donc `tsc` passe même là où le contrat est violé —
les régressions restantes ne seront pas signalées par la compilation.

## Ce qui reste ouvert

1. **`InvestisseurRisquesPanel.tsx` est un clone intégral de `RisquesPage`**
   (types, jauges, PDF, barres). Seul le libellé `patchModule` y a été corrigé.
   Reste : `getScoreColor(null)` y chute jusqu'au palier le plus **alarmant**,
   `width: "null%"`, « null » imprimé en 56 px dans le PDF, « Hors zone PPRI »
   sur donnée absente, et le `: 1` de persistance non corrigé (l. ~1270-1274).
   À **mutualiser** plutôt qu'à recopier une troisième fois.
2. **`useQuickAnalysisData.ts` / `useValuationEngine.ts`** lisent
   `data.risks ?? data.georisques ?? data` alors que les aléas sont sous
   `data.data.*`. Tous les drapeaux sont donc `false` et
   `globalRiskLevel = "low"` : une absence de donnée devient « risque faible »
   dans le moteur de valorisation. Forme de lecture erronée, préexistante.
3. `RisquesPage` écrit les scores de risque dans
   `breakdown.{environnement, demande, offre, accessibilite}` de
   `marcheRisquesByDeal`, relu comme des **scores de marché** par
   `AnalysePredictivePanel`. Confusion de sémantique préexistante.
4. Barème BPE en valeur absolue, trou de couverture GTFS, métrique
   d'accessibilité à deux régimes : inchangés (cf. récap du 5 août).
5. Le source de `market-study-promoteur-v1` n'est **toujours** pas dans le
   dépôt — il n'existe qu'en production.

## Vérification sur l'étude de référence

Ascain, INSEE 64065, étude `bc69a73c-2b6c-409d-a894-3d69919f45a6` :
`marche` = **68** (le refresh BPE a bien pris), étape `risques` **jamais
exécutée**, colonne `promoteur_studies.risques` à `null`. Le copilote n'a donc
encore rien à lire sur les risques — à relancer après déploiement pour valider
la chaîne de bout en bout.

## Décision de session

Le copilote reste en **lecture seule** sur l'étude de risques. Il commente ce
que la page a calculé ; `COPILOT_FN_RISKS` demeure un repli. Motif : un second
chemin d'écriture vers `promoteur_studies` recréerait exactement la divergence
écran/base corrigée sur `MarchePage`.
