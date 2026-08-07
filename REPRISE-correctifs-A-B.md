# Note de reprise — correctifs A et B

**Date :** 7 août 2026
**Dépôt :** `mimmoza-front-v2`
**Base :** Supabase « Backend Mimmoza » (`fwvrqngbafqdaekbdfnm`)

Cette note permet de reprendre le travail sans rien re-découvrir. Les marqueurs
`Correctif A` et `Correctif B` sont présents en commentaire dans le code : un
`grep` dessus donne l'inventaire exact des endroits touchés.

> ✅ **Dette de vérification — SOLDÉE le 7/08 au soir.** Le sandbox Linux étant
> resté hors service toute la journée, la vérification a été faite **en local par
> l'utilisateur**. Résultat :
>
> - `npx tsc -b` — **passe** (après correction, voir §10.g)
> - `npm run build` — **passe**, 2 946 modules, aucune erreur
> - `deno check` sur les 5 edge functions modifiées — **passe** (5/5)
>
> Les trois points de risque identifiés le matin étaient bien **des faux
> positifs** : champs `number | null` de `MarchePage.tsx`, sites
> `avecAjustement`, spread de `decorEstimation`. **La seule vraie erreur était
> ailleurs, et aucune des six relectures humaines ne l'avait vue** — voir §10.g.
> C'est l'enseignement de la journée, plus que les correctifs eux-mêmes.
>
> ⚠️ `deno check` affiche `Failed reading tsconfig.app.json` : bénin. Deno tente
> de lire le tsconfig du front (du JSONC, avec commentaires), échoue, et retombe
> sur ses propres options — comportement correct, les edge functions ne font pas
> partie du projet Vite. Un `supabase/functions/deno.json` ferait taire l'avis.

---

## 1. Où en est la liste des chantiers

| | Chantier | État au 7/08 |
|---|---|---|
| A | copilot-chat inventait des codes INSEE | **Fait** (voir §2) — *régression PLM corrigée depuis, §10* |
| B | Replis `??` du pilier demande | **Fait**, back + front (voir §3) — *étendu à l'espace investisseur, §10* |
| C | `market-study-promoteur-v1` jamais audité, absent du dépôt | **Bloquant** — voir §6, aggravé par §10.c |
| D | Mutualisation risques (types + 9 cartes de `RisquesPage`) | Non commencé |
| E | Charger les 34 875 centroïdes communaux | Non commencé |
| F | Socle géographique : `gtfs_stops` limité à l'IdF | Non commencé |
| G | DPE quartier, qualité de l'air : stubs `null` dans smartscore | Non commencé |
| H | Barème BPE en valeur absolue, FiLoSoFi en repli départemental | Partiellement traité par B |
| I | `MimmozIAPage`, PNG de l'orbe | Cosmétique |

---

## 2. Correctif A — codes INSEE inventés

### Le défaut

Les schémas d'outils déclaraient le code INSEE **« prioritaire »** sur le nom de
commune. Le modèle en fabriquait un de mémoire, `str()` acceptait n'importe
quelle chaîne, et — point central — la seule résolution autoritaire était gardée
par `if (!codeInsee && ...)`. **Fournir un code était donc exactement ce qui
désactivait sa vérification.** Le code partait ensuite en entrée de confiance
vers loyers, zonage ABC, taxes, PPR, SRU, market-study, qui rejouaient le même
défaut. Le prompt système interdisait déjà la traduction code → nom en admettant
que le modèle se trompe ; le sens nom → code, seul à atteindre la base, était
resté ouvert.

### Ce qui a été fait

**`supabase/functions/copilot-chat/index.ts`**

- `resoudreInseeFiable(input, ctx, ref)` : point de passage unique. Confronte
  tout code au référentiel `geo.api.gouv.fr`, **toujours**. Ordre : code proposé
  (vérifié) → nom de commune → code postal.
- Distinction stricte **`introuvable`** (le référentiel a répondu) vs
  **`indisponible`** (il n'a pas répondu). Les confondre était ce qui laissait
  passer les codes faux. Plus aucun `catch {}` muet.
- En cas de désaccord code / nom, **le nom l'emporte** : c'est le code que le
  modèle fabrique, pas le nom que l'utilisateur vient d'écrire.
- Cache mémoire des réponses **définitives** (y compris `introuvable`), jamais
  des indisponibilités. Coupe-circuit de 15 s : sans lui, un tour appelant vingt
  outils cumulait vingt timeouts de 5 s.
- Arrondissements municipaux : `geo.api.gouv.fr/communes` **ne les contient
  pas** (`?code=75104` → `[]`, `?codePostal=75004` → `75056`). Ils sont validés
  via leur commune globale, code d'arrondissement conservé, et la conversion
  CP → arrondissement est arithmétique. **Ne pas « simplifier » en interrogeant
  l'API avec le code d'arrondissement : elle répondra `[]`.**
- `avecAjustement()` / `avecInseeAval()` : tout écart remonte dans
  `data._ajustement` et en tête de message, y compris sur les `catch` et les
  `not_found` (33 sites), et y compris pour les outils où l'INSEE est facultatif.
- Garde Sitadel : la condition portait sur `!str(input.code_insee)`, donc un code
  du modèle suffisait à désactiver le refus. Elle porte désormais sur une commune
  **ancrée** (utilisateur ou contexte applicatif).
- `get_dpe_ademe` : le canal n'était pas le code INSEE mais le **code postal**,
  transmis brut. Il est maintenant vérifié au référentiel.
- `resoudreCommune` (utilisée par `toolCreerWatchlist`) délègue à
  `chercherCommune` : elle avait son propre client HTTP, sans cache ni
  coupe-circuit — quinze communes × 5 s de timeout pendant une panne.
- Schémas d'outils : mention « prioritaire » retirée, `pattern`
  `^(?:\d{5}|2[AB]\d{3})$` ajouté, constantes `DESC_CODE_INSEE` / `DESC_COMMUNE`.
- Prompt système : règles **4quaterdecies-bis** (symétrique, sens nom → code) et
  **4quaterdecies-ter** (relayer tout `_ajustement` avant les chiffres).

**Défense en profondeur** — même bloc, rigoureusement identique, dans
`ppr-detail-v1`, `taxes-locales-v1`, `zonage-abc-v1`, `loyers-reference-v1` :
`FORME_INSEE`, `interrogeGeo`, `verifieInseeAuReferentiel`, `_cacheInsee`,
coupe-circuit, `cleCommune`, `sansSuffixeArrondissement`, `memeCommune`,
`PLM_ARRONDISSEMENT_RE`, `inseeArrondissementDepuisCp`, `affinePlm`,
`repliNomPuisCp`, `resoudreInsee`, plus un champ de traçabilité `_insee`.

`ppr-detail-v1` est le **fichier de référence** : en cas de divergence entre les
quatre, c'est lui qui fait foi.

---

## 3. Correctif B — replis du pilier demande

### Le défaut, plus large que le soupçon initial

Les `?? 7.5`, `?? 8`, `?? 10` repérés dans `computeDifferentiatedScores` étaient
**du code mort** : les champs n'étaient jamais nuls. La substitution avait lieu
une couche plus tôt, dans `fetchInseeData`, sans `??` visible. Douze champs
n'étaient issus **d'aucune requête** — ils sortaient de `DEMOGRAPHICS_DEPT`
(13 départements + un `default`) et de formules de densité, puis étaient scorés
par des seuils, affichés sans réserve, exportés en PDF client et relayés en prose
au copilote.

`taux_chomage = 7,5 %` était la valeur servie à **34 928 communes sur 34 930**.

### Ce qui a été fait — `market-study-investisseur-v1/index.ts`

- Les onze `pct_*` valent `null` tant qu'aucune source ne les fournit.
  L'estimation vit dans **`demographie_estimee`**, jamais dans le champ nu :
  un consommateur qui veut l'afficher doit aller la chercher, donc la nommer.
- `taux_chomage` ne porte que la mesure ; `taux_chomage_estime` et
  `taux_chomage_source` à côté.
- **`insee_data_quality`** : provenance champ par champ
  (`mesure` / `estimation_dept` / `heuristique_densite` / `absente`), exposée
  **hors mode debug** — `economic_data_quality` ne couvrait que 6 indicateurs et
  n'était visible qu'avec `debug: true`, donc jamais là où quelqu'un décide.
- Pilier demande : **un seuil ne s'applique qu'à une mesure.** Une donnée absente
  ne déclenche ni bonus ni malus, elle est comptée comme non mesurée.
  `demande_confiance` (`forte` / `moyenne` / `faible` / `sans_objet`),
  `demande_champs_mesures`, `demande_champs_attendus`,
  `demande_champs_manquants` sont exposés **à côté du score**, pas en debug.
- Convention des blocs `specific` : champ nu = mesure ou `null`, estimation dans
  un champ suffixé `_estime`, accompagné d'un `_source`. Helper `champDemo()`.
- `pct_logements_vacants` valait `?? 8` au scoring et `?? 5` à l'affichage : le
  chiffre affiché et le chiffre noté n'étaient pas le même nombre. Résolu.
- `fetchSocioEcoExtended` : `.limit(1).maybeSingle()` **sans `ORDER BY`** sur une
  table à doublons. Trié par millésime décroissant, sources de test exclues.
- `pct_proprietaires` : la colonne **existe** en base mais n'était pas déclarée
  dans `SOCIOECO_FIELD_CANDIDATES`, donc jamais lue — le code écrivait `58` en
  dur. Branchée.

### Front

- `MarchePage.tsx` : helpers `lireChampDemo` / `lireTauxChomage` /
  `decorEstimation`, pastille ambre reprise **à l'identique** du motif préexistant
  du revenu médian. Pyramide des âges rebranchée sur `demographie_estimee` avec
  badge « Estimation ». Export PDF : `kpiBoxEstime` (cadre ambre + provenance sous
  le chiffre) et pavé « Provenance des données ». Confiance du pilier demande
  affichée à l'écran et dans le PDF.
- `PROJECT_SCORING_CONFIG` : **33 règles** réécrites. Les `?? 0` devant un seuil
  `>` et `?? 100` devant un seuil `<` **neutralisaient** la règle — absence de
  donnée = absence de malus, biais haussier structurel. Nouveau type
  `EvaluationRegle = boolean | null`, comparateurs absence-safe, et un tableau
  `reglesNonEvaluables` remonté à l'affichage.
- `getBuyerTargetProfile` : sans données, la vacance valait 0 → « vacance faible »
  → « Marché investisseur », **confiance forte**. La conclusion la plus flatteuse
  possible tirée du néant. Corrigé, avec une sortie « Non déterminable ».
- Corrigés au passage : un taux de pauvreté non mesuré s'affichait **en vert** ;
  `pct_locataires ?? (100 - (pct_proprietaires ?? 0))` donnait 100 % de
  locataires sur données vides ; `MarketStudyKpis.tsx` faisait un `.toFixed(1)`
  sur une valeur devenue `null` — **plantage à l'exécution**.
- `MarketStudyInseePanel.tsx` : la prop `unavailable` testait `=== undefined`,
  inatteignable par construction. Passée en `== null`.
- Types mis à jour : `marketStudy.types.ts`, `marketStudyPromoteur.service.ts`.

---

## 4. Base de données — trois trouvailles

### a. Une ligne de test en production, sur Ascain

`insee_socioeco_communes` contient pour `64065` **deux** lignes :
`FILOSOFI 2021` (revenu 31 160 €, chômage `null`) et **`TEST_ONLY 2022`**
(revenu 25 000 €, chômage 6,50 %, propriétaires 62,10 %). C'est la seule ligne
`TEST_ONLY` de toute la table. Combinée au `.limit(1)` sans tri, deux appels
identiques pouvaient répondre deux chiffres différents.

**Le code l'écarte désormais, mais la ligne est toujours en base — à supprimer.**

### b. Couverture réelle de `insee_socioeco_communes`

34 930 lignes, et :

| colonne | renseignée |
|---|---|
| `revenu_median_eur` | 5 347 (15 %) |
| `taux_chomage_pct` | **2** (dont 1 fixture) |
| `pct_proprietaires` | **2** |
| `part_actifs_occupes_pct` | **0** |

### c. Un import INSEE avorté

`insee_commune_stats` (colonnes parfaites : `age_0_14` … `age_75_plus`,
`unemployment_rate_pct`, `owners_pct`, `renters_pct`) contient **une seule
ligne**, un `bdm_error` sur Paris : tentative via l'API BDM de l'INSEE, échouée
sur un paramètre invalide — `lastObservations` au lieu de `lastNObservations`.
Rien dans le dépôt ne porte ce code : la tentative venait d'ailleurs.

---

## 5. Migrations appliquées

### `create_insee_demographie_communes`

**La source existait déjà.** `insee_pop2_raw` contenait le fichier INSEE RP
« POP2 » complet — 2,1 M de lignes, 34 903 communes — pendant que le code
fabriquait la structure d'âge depuis une table de 13 départements.

Table `insee_demographie_communes` : 34 848 communes + **45 arrondissements
municipaux** (avec leur propre code INSEE — utile pour le correctif A),
**67 760 577 habitants**, les six parts sommant à 100,00 en moyenne.

Deux pièges traités : 457 056 clés en double dans le brut (vérifié : **aucune
valeur divergente**, un `DISTINCT` suffit — c'est ce qui faisait passer le total
national de 87,9 M à 67,8 M), et toutes les catégories `CATPR` sommées pour
rester cohérent avec la population légale.

Sur Ascain : **12,6 % de 75 ans et plus mesurés** contre 10 modélisés, et
14,6 % de moins de 15 ans contre 18. Au seuil `> 11`, ça déclenche le bonus
« Pop. 75+ correcte » qui ne se déclenchait pas.

⚠️ `millesime` est `NULL` : `insee_pop2_raw` ne porte pas l'année de son import.
À renseigner au prochain chargement.

### `staging_et_derivation_rp_logement_emploi`

- `insee_rp_staging (codgeo, theme, millesime, source, data jsonb)` — dépôt brut,
  **générique par jsonb** parce que les fichiers « base-cc » préfixent leurs
  colonnes par le millésime (`P21_LOGVAC`, `P22_LOGVAC`…) : une table figée
  serait à refaire à chaque campagne.
- `insee_val(jsonb, text[])` — retrouve une valeur par motif de clé.
- `insee_logement_emploi_communes` — cible.
- `refresh_insee_logement_emploi()` — dérivation idempotente.

**Vérifiée à blanc** sur une commune fictive : 90 vacants / 1 000 logements →
9,00 % ; 280 locataires / 800 résidences principales → 35,00 % ; 54 chômeurs /
450 actifs → 12,00 %. Les dénominateurs sont ceux du recensement : la vacance se
rapporte au **total des logements**, le statut d'occupation aux **résidences
principales seules**, le chômage aux **actifs 15-64** et non à la population.
Ligne de contrôle supprimée, les deux tables sont vides.

`fetchInseeData` lit déjà la table ; le RP prime sur `insee_socioeco_communes`.
Tant que le staging est vide, tout rend `null` — rien ne change avant chargement.

---

## 6. `market-study-promoteur-v1` — ⚠️ CE PARAGRAPHE ÉTAIT FAUX, corrigé le 7/08 au soir

> **Rectification.** La version initiale de cette note affirmait que
> `market-study-promoteur-v1` « n'apparaît pas dans les edge functions
> déployées ». **C'est faux.** L'inventaire réel du projet
> `fwvrqngbafqdaekbdfnm` la donne **ACTIVE, version 117**, redéployée le
> ~5 août 2026. `market-study-v1` est également **ACTIVE, version 107**.
> L'erreur venait d'un inventaire incomplet, pas de la prod.

Le problème réel n'est donc **pas** une fonction manquante, mais une **source non
versionnée** : ces deux fonctions tournent en production et leur code n'est
**pas** dans le dépôt. Personne ne peut les relire, les auditer, ni savoir si le
correctif B y a été appliqué. C'est plus grave que ce qui était décrit, et de
nature différente.

Conséquences à réévaluer :

- `MarchePage.tsx` appelle une fonction **vivante**. L'écran promoteur n'est pas
  mort ; ce qu'il affiche dépend d'un code que le dépôt ignore.
- On ne sait pas si `market-study-promoteur-v1` v117 émet `insee_data_quality`,
  `demographie_estimee`, `demande_confiance` — donc on ne sait pas si le
  correctif B côté `MarchePage` est nourri ou reste lettre morte.
- L'ancienne « décision prise » (rebrancher le front sur
  `market-study-investisseur-v1`) **n'a plus de fondement évident** : elle
  reposait sur l'idée que la fonction promoteur n'existait pas.

`marketStudy.types.ts` décrit un **troisième** contrat (`version:
"market-study-v1"`, `data.insee` au premier niveau, `insee_partial`,
`pyramide_ages`). Ses sept composants ne sont montés nulle part (§10.c).

**À faire, dans cet ordre :** (1) récupérer le code déployé des deux fonctions et
le **verser au dépôt** ; (2) seulement ensuite décider du rebranchement, en
comparant des contrats qu'on peut enfin lire.

### État de déploiement des fonctions modifiées (relevé du 7/08 au soir)

**Aucun des deux correctifs n'est en production sur les quatre fonctions aval.**
Le code déployé est antérieur : il contient encore la garde négative
`if (!codeInsee && (commune || zipCode)) … resolveInseeFromGeo(…)`, c'est-à-dire
le défaut d'origine du correctif A.

| Fonction | Version prod | Correctif A déployé ? |
|---|---|---|
| `ppr-detail-v1` | 33 | Non — aucun traitement PLM du tout |
| `taxes-locales-v1` | 34 | Non — `PLM_FALLBACK` sens direct seulement |
| `zonage-abc-v1` | 33 | Non — jamais redéployée depuis sa création |
| `loyers-reference-v1` | 35 | Non — `PLM_ARRONDISSEMENTS` sens direct seulement |
| `copilot-chat` | 193 | à vérifier |
| `market-study-investisseur-v1` | 116 | à vérifier (correctif B) |

Deux lectures de ce tableau, et il faut tenir les deux :

- **Rassurant** : la régression PLM écrite aujourd'hui n'a jamais atteint la
  production. Le risque est resté confiné au dépôt.
- **Inquiétant** : le bug d'origine — un code INSEE inventé traverse sans aucun
  contrôle et ressort avec une source officielle attachée — **est toujours actif
  en production**, sur les quatre fonctions.

⚠️ Ne pas se tromper sur ce qu'est le repli PLM inverse écrit aujourd'hui : ce
n'est **pas** un défaut qu'il faudrait retirer avant de déployer, c'est la
**correction** de la régression que le correctif A introduisait seul. L'état
local est cohérent : correctif A **plus** son repli. C'est cet ensemble qui doit
partir, ou rien.

---

## 7. À faire, dans l'ordre

1. ~~**`deno check`** + **build du front**~~ — **FAIT le 7/08 au soir**, tout passe.
   Voir l'encadré en tête de note et §10.g.
2. **`git diff`** d'ensemble, pour une relecture d'un bloc. *(Le code compile,
   mais il n'a jamais été relu d'une traite ni exécuté.)*
3. **Supprimer la ligne `TEST_ONLY`** d'Ascain dans `insee_socioeco_communes`.
4. **Trancher `market-study-promoteur-v1`** (§6) — sans ça, la moitié du
   correctif B ne sert à rien. §10.c montre que le périmètre mort est plus large
   que prévu : sept composants et un `.jsx` legacy de 2 043 lignes.
5. **Charger les deux fichiers RP** dans `insee_rp_staging` :
   - *logement* : `CODGEO`, `P##_LOG`, `P##_RP`, `P##_LOGVAC`, `P##_RP_PROP`,
     `P##_RP_LOC`
   - *emploi* : `CODGEO`, `P##_POP1564`, `P##_ACT1564`, `P##_CHOM1564`

   puis `select refresh_insee_logement_emploi();`
   Referme le chômage et la vacance sur les ~34 900 communes.
6. Renseigner le `millesime` de `insee_demographie_communes`.
7. Reprendre les chantiers D à I.

---

## 8. Décisions déjà arbitrées — ne pas relitiger

- **Correctif A, forme :** point de passage unique, pas de retrait du champ
  `code_insee` des schémas, pas de simple rétroportage.
- **Correctif A, code non résolu :** repli sur le nom de commune, écart signalé
  (et non erreur bloquante).
- **Correctif A, portée :** copilot-chat **et** les quatre fonctions aval.
- **Correctif B, approche :** tarir la source d'abord, puis propager.
- **Correctif B, pilier demande :** score conservé **plus** indice de confiance
  (et non suppression du pilier).
- **Correctif B, front :** les replis inverses de `MarchePage.tsx` traités dans
  le même chantier.
- **On ne score jamais sur `demographie_estimee`** : une estimation
  départementale donnerait le même bonus à toutes les communes du département,
  soit exactement la fabrication qu'on vient de supprimer. L'affichage a le droit
  de la montrer — en la nommant. Le scoring, non.

---

## 9. Le fil rouge, si une seule chose devait être retenue

Les deux défauts sont le même : **une valeur absente prend l'apparence d'une
valeur mesurée, et plus rien en aval ne peut faire la différence.** Un code INSEE
inventé ressort avec une source officielle attachée ; une moyenne départementale
ressort dans un PDF client comme un relevé communal.

La discipline existait déjà dans le dépôt — `revenu_median_source`, `bpe_quality`,
le régime d'accessibilité, `AnalysePredictivePanel` qui refuse de scorer sans
données. Elle n'avait simplement pas été étendue. En cas de doute sur un nouveau
correctif : **regarder comment le fichier traite déjà BPE ou le transport, et
faire pareil.**

---

## 10. Seconde session du 7/08 — ce que la relecture ciblée a trouvé

Le sandbox étant toujours mort, la session a consisté en une relecture ciblée sur
les trois points de risque nommés en tête de note. **Les trois sont levés.** Ce
qui a été trouvé était ailleurs, et le plus grave était neuf.

### a. Régression PLM introduite par le correctif A — corrigée

Le correctif A ressort désormais le code d'**arrondissement** (75104) là où
l'ancienne résolution rendait la commune **globale** (75056). C'est voulu, c'est
plus précis — mais les quatre fonctions aval indexent leurs données sur la
commune globale, et leurs replis PLM existants ne fonctionnaient que dans le sens
*global → arrondissement* (`PLM_FALLBACK` n'a pour clés que `75056/69123/13055`).
Résultat : `PLM_FALLBACK['75104']` valant `undefined`, **tout Paris / Lyon /
Marseille localisé par code postal ressortait `no_data`** sur PPR, taxes et
zonage. Une absence fabriquée par le correctif censé supprimer les fabrications.

Le repli **inverse** a été ajouté aux quatre fichiers, chacun selon sa mécanique :

- `ppr-detail-v1` : n'avait **aucun** repli PLM. Boucle `codesAInterroger ×
  PPR_ENDPOINTS`, avec un drapeau `auMoinsUneReponse` qui distingue « aucun
  endpoint n'a répondu » (panne → `error`) de « un endpoint a répondu une liste
  vide » (→ `no_data`) — les confondre était le défaut d'origine du correctif A,
  en plus petit.
- `taxes-locales-v1` : helper `codesPlmAEssayer()`, qui couvre **les deux sens**.
- `zonage-abc-v1` : repli inverse **chaîné** sur le repli direct. Attention, le
  premier jet ne chaînait pas : partant de 75104 on tentait 75104 puis 75056, et
  la liste des 20 arrondissements n'était jamais essayée — or c'est exactement le
  cas où la table ne contient pas la commune globale. Corrigé via `codeGlobalPlm`.
- `loyers-reference-v1` : le bloc d'éclatement PLM a été **extrait** en fonction
  locale `reponsePlm(codeGlobal, repli)` pour servir deux entrées. La table est
  censée contenir les arrondissements, mais ce n'était qu'un pari du commentaire
  d'en-tête ; si le pari est faux, on replie au lieu d'affirmer « commune non
  couverte ».

Dans les quatre, le repli est **tracé et nommé** : `_insee.interroge`,
`_insee.repli_plm`, `stats.code_insee_interroge`, et une mention explicite dans le
résumé. On ne substitue jamais le périmètre d'une commune globale à celui d'un
arrondissement sans le dire.

⚠️ **Budget réseau à surveiller.** `taxes-locales-v1` peut désormais tenter
2 codes × 7 champs × 8 s. La boucle sort au premier succès, mais le pire cas a
doublé.

### b. `MarcheRisquesPanel.tsx` n'avait jamais reçu le correctif B — fait

C'est le panneau de l'espace **investisseur**, et c'est le seul chemin de bout en
bout qui fonctionne réellement aujourd'hui (§6) — donc le seul que l'utilisateur
voit. Il reproduisait à l'identique les biais que `MarchePage` venait de
supprimer, en pire, parce que `core` y est typé `any` et qu'aucun garde-fou de
typage ne s'appliquait :

- `scores.accessibilite ?? 0` → un pilier non mesuré s'affichait **« 0/100 », barre
  rouge**. La conclusion la plus défavorable possible tirée du néant, symétrique
  exact du biais haussier corrigé côté promoteur. `ScoreBar` accepte maintenant
  `number | null` et rend une barre vide + « — ».
- `has_metro_train ? "✅ Oui" : "❌ Non"` → une absence de mesure rendue comme une
  négation constatée. Helper `ouiNonNonMesure()` à trois états.
- Branche `is_urban === false` : « ❌ Non », « ❌ Non », « 0 » écrits **en dur**.
  « Zone non-urbaine » veut dire « transport exclu du scoring », pas « aucun
  transport » : trois faits inventés. Supprimés.
- `bpe.total_equipements > 0` sur un champ absent → `undefined > 0` → `false` →
  « Aucun équipement », alors que c'est le relevé entier qui manque.
- Le décompte d'arrêts retombait sur `transport.stops.length`, qui inclut les
  placeholders « (estimation) » que tout le reste du fichier filtre.

Et surtout : **`Scores` mentait.** Les cinq piliers étaient typés `number` non
nullable dans `marketStudyPromoteur.service.ts` alors que le back renvoie `null`.
Tant que ce type mentait, la branche « non mesuré » était du code mort *pour le
typechecker* — elle marchait à l'exécution, mais rien n'empêchait un futur
`scores.demande + 10` de compiler. Passés en `number | null`. Les autres
consommateurs (`AnalysePage`) lisent via des casts `unknown` + `firstNum` : pas
d'impact.

### c. Le périmètre mort de §6 est plus large que décrit

Les sept composants servis par `marketStudy.types.ts` (`MarketStudyKpis`,
`MarketStudyInseePanel`, `MarketStudyMap`, `MarketStudyPoisPanel`,
`MarketStudyCompsPanel`, `MarketStudyHeader`, `MarketStudyExport`) ne sont
**montés nulle part** — seulement ré-exportés par `marche/index.ts`. Le correctif
B leur a été appliqué pour rien. S'y ajoute un `MarketStudyPage.jsx` legacy de
**2 043 lignes**, non importé, qui lit `pct_plus_75` / `pct_proprietaires` /
`taux_chomage` sans typage et échappe entièrement aux deux correctifs.

Par ailleurs `InseeData` est **redéfini à l'identique dans trois fichiers**
(`MarchePage.tsx`, `marketStudy.types.ts`, le service) et a **déjà dérivé** :
`pct_proprietaires` requis ici et optionnel là, `taux_chomage_estime` l'inverse.
Rien ne garantit qu'un prochain correctif touche les trois.

### d. Deux pièges désamorcés par avance

- **`MarchePage.tsx`, `PillarRow`.** Sa prop `score` était typée `number`, mais
  reçoit `pillars.rail` etc., typés `number | null`. Le `.filter(p => p.score !=
  null)` **n'est pas un prédicat de type** et ne rétrécit rien : seul le
  `(transport as any)` du calcul de `gtfs` — cast devenu inutile depuis que
  `mobility_gtfs` est déclaré sur `TransportData` — masquait l'erreur. Le jour où
  quelqu'un « nettoie » ce cast, geste parfaitement anodin, le build tombait.
  `PillarRow` accepte maintenant `number | null`.
- **`MarchePage.tsx`, gardes en truthy.** `if (insee.pct_retraites)` fait
  disparaître la ligne quand la valeur **mesurée** vaut 0. C'est le symétrique du
  défaut principal : au lieu d'inventer une valeur, on efface une mesure. Dans les
  deux cas le lecteur ne peut plus distinguer « zéro » de « on ne sait pas ».
  Huit gardes passées en `!= null`.

### e. Ce qui a été vérifié et est correct

- Les 68 sites `avecAjustement` / `avecInseeAval` : arité, ordre et types corrects,
  y compris les compositions imbriquées et les 55 `catch (e: unknown)` qui font
  tous leur narrowing.
- Le spread de `decorEstimation` dans `StatItem` : les 3 propriétés produites
  existent en optionnel, les 4 requises sont fournies avant le spread sur les
  5 points d'appel. `kpiBoxEstime` ne fait aucun spread.
- Le bloc INSEE dupliqué est **rigoureusement identique** dans les 4 fonctions
  (315 lignes), aux préfixes de log près. L'interdiction d'interroger
  `geo.api.gouv.fr` avec un code d'arrondissement est respectée partout.
- `EvaluationRegle` : les trois états sont correctement gérés, avec comparaison
  stricte à `null` **avant** le test de vérité.

### f. Restes connus, non traités

- `repliNomPuisCp` ne revérifie pas le nom renvoyé par `?nom=…&limit=1`, qui est
  une recherche **floue triée par score** : une commune mal orthographiée renvoie
  un premier résultat plausible mais faux, et le message d'ajustement affirme
  alors « résolu depuis le nom de commune ». Un `memeCommune()` sur le résultat
  fermerait la brèche.
- `_cacheInsee` est sans borne ni TTL, et mémorise les `inexistant` jusqu'au
  recyclage de l'isolate.
- Le coupe-circuit n'est jamais réarmé au succès : un pic 500 fige les 15 s.
- `buildEconomicNarrativeV2` ne produit plus **aucune** phrase spécifique pour
  `logement` / `residence_etudiante` / `ehpad` : ses branches dépendent de
  `pct_proprietaires`, `pct_logements_vacants`, `pct_etudiants`, tous devenus
  `null`. Ce n'est pas un bug, c'est la conséquence assumée du correctif — mais
  c'est une régression fonctionnelle visible, à signaler au produit.
- `EhpadCompetitionCard` déstructure `concurrence` et `indicateurs_marche` sans
  garde, sur un `specific` qui n'est qu'un cast non vérifié : un bloc partiel du
  back plante le rendu.

### g. Ce que le compilateur a trouvé — et que six relectures avaient manqué

`npx tsc -b` a sorti **10 erreurs**, toutes de la même cause, sur deux sites :
`MarcheRisquesPanel.tsx:684` et `AnalysePage.tsx:375-376`. L'élargissement de
`Scores` en `number | null` (§10.b) se propageait jusqu'au store des snapshots
marchand, dont `MarcheRisquesSaved` déclare `scoreGlobal?: number`.

**C'est exactement ce à quoi servait l'élargissement.** Ces deux sites écrivaient
déjà un score non mesuré dans le store ; le type non nullable le masquait
simplement. Aucune des six relectures humaines de la journée — dont trois
ciblées et une relecture indépendante des diffs — n'avait vu ce chemin de
propagation. Le compilateur l'a sorti en trois secondes.

**Correction retenue : `?? undefined` aux deux sites**, sans toucher à
`MarcheRisquesSaved`. Justification — dans le vocabulaire de ce store l'absence
s'exprime par `undefined` (tous ses champs sont optionnels), et traduire `null`
en `undefined` est fidèle : les deux disent « pas de valeur ». Un `?? 0` aurait
réintroduit le défaut qu'on venait de supprimer. Et surtout, **le dépôt avait
déjà tranché ce cas** : `RisquesPage.tsx:2190` écrit
`scoreGlobal: result.scores?.global ?? undefined` sur ce même champ du même
store. Application directe de la règle de §9 : regarder ce que le dépôt fait
déjà, et faire pareil.

Les deux lecteurs en aval (`AnalysePage:436` et `:1081`) passent par
`firstNum(...)`, qui ignore les non-nombres — la traduction ne dégrade rien.

**Enseignement, à ne pas perdre :** les trois points désignés comme « les plus à
risque » le matin étaient tous corrects. La seule vraie erreur était dans un
fichier que personne n'avait listé comme touché. Un typage honnête ne sert pas
qu'à documenter — il fait tomber des chemins qu'aucune relecture ne remonte,
mais **seulement si quelqu'un compile.**
