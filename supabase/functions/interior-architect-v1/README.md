# interior-architect-v1 — Architecte d'intérieur (lots INT-10, INT-10b)

Edge Function Deno autonome : reçoit un plan de logement et un brief, renvoie 2 à 3 variantes d'aménagement
(mobilier, matériaux, luminaires ; aucune cloison déplacée), triées par verdict puis par score.

## Contrat

`POST` avec `Authorization: Bearer <JWT utilisateur>` ou, depuis copilot-chat, `Bearer <clé secrète>`.

```jsonc
{
  "plan": { /* PlanInput du moteur (moteur/types.ts) */ },   // OU
  "description": "T3 de 62 m²",                             // OU (refusé, voir plus bas)
  "roomPlan": { /* format interne du Studio */ },           // (refusé, voir plus bas)
  "brief": { "target": "famille", "occupants": { "adults": 2, "children": 1 }, "style": "contemporain",
             "gamme": "standard", "constraints": { "teletravail": false, "pmr": false } },
  "seed": 1,        // facultatif (graines seed, seed+1, seed+2)
  "variants": 3,    // facultatif, 2 ou 3
  "dossier_id": "…" // facultatif, renvoyé tel quel (persistance : lot ultérieur)
}
```

Réponse (HTTP 200 pour tout résultat métier) :

- `status: "ok"` : `variantes: [{ libelle, seed, verdict, score, layout, rapport, feuilleDeStyle, pointsEauSupposes, choixGaines, duree_ms }]`
  (`choixGaines`, ajouté par INT-10b : détail du choix de chaque gaine supposée, `ChoixGaine` du moteur 0.3.0),
  `resumeTexte`, `synthese` (verdict par pièce, points bloquants du logement, trois choix principaux justifiés, points d'eau
  supposés « à confirmer », manques, hypothèses, recommandations), `ecartees` (graines non retenues et pourquoi), `moteur` ;
- `status: "plan_requis"` : description seule ou aucune source de plan. Aucune variante, aucun plan inventé ; `compris`
  (typologie et surface lues dans la description) et `comment_obtenir_un_plan` ;
- `status: "plan_studio_non_converti"` : `roomPlan` reçu, non converti ici ;
- `status: "entree_invalide"` : `erreurs` (chemin + message), `questions` si le brief manque.

HTTP 401 (authentification), 405 (méthode), 413 (corps > 1 Mo), 400 (JSON illisible).

## Constat : comment un utilisateur du site fournit-il un plan aujourd'hui ? (06/11/2026)

Recherche faite dans `mimmoza-front-v2` (src/ et supabase/functions/) :

- **Aucun plan intérieur structuré n'existe côté site.** L'atelier 3D du chat (`src/spaces/copilot/studio3d/`,
  contrat `mimmoza-projet-v2`) et le plan 2D promoteur (`src/spaces/promoteur/plan2d/`) décrivent des parcelles, des
  volumes et des bâtiments (emprise, niveaux, balcons, loggias), jamais des pièces, des cloisons ni des portes ;
- l'espace Réhabilitation lit une IMAGE de plan avec `analyze-rehab-plan` (vision IA) : il en sort une lecture textuelle
  (noms de pièces, observations), sans géométrie exploitable par le moteur ;
- seul **MimmozIA Studio** produit un plan de pièces (`RoomPlan`, plan généré ou lu) et sait le convertir en `PlanInput`
  (adaptateur INT-09a, `src/core/interieurArchitecte/versPlanInput.ts` du Studio). Cette conversion n'est pas embarquée ici.

Cas implémentés : (a) `PlanInput` JSON → aménagement ; (b) description typologique → refus honnête qui explique comment
obtenir un plan (Studio) ; `roomPlan` → refus motivé.

## Garde-fous

- Validation zod stricte (`schemas.ts`) : clés inconnues refusées, bornes de taille, cohérence des identifiants ;
- calcul pur, sans réseau (`pipeline.ts`) ; budget de calcul par requête `INTERIOR_BUDGET_MS` (défaut 1500 ms depuis
  INT-10b, 1200 ms avant) : la première variante est toujours calculée, les suivantes seulement si elles tiennent ; une
  variante non calculée ou identique à une autre est listée dans `ecartees` ;
- points d'eau absents du plan : une gaine SUPPOSÉE par pièce humide, marquée `a_confirmer` ; position choisie par
  `amenager` du moteur 0.3.0 (voir « Gaine optimale et temps de calcul ») ;
- un verdict défavorable du moteur est transmis tel quel, jamais adouci.

## Tests

```
deno test --allow-read --allow-write tests/
```

- `tests/logique.test.ts` : validation, tri, score, résumé, lecture de la description ; gaine optimale (p10 dépouillé :
  0 bloquante ; désactivée : défavorable cité), réemploi des gaines de A, recherche coupée par le budget ;
- `tests/handler.test.ts` : requêtes simulées, authentification mockée, plans du banc p03-t3 et p10-t3-pmr de bout en
  bout (p10 dépouillé : sans violation bloquante depuis INT-10b, défavorable en INT-10), refus de la description seule ;
- `tests/copilot-resume.test.ts` : extrait la logique pure de l'outil `amenager_interieur` de `../copilot-chat/index.ts`
  (entre les marqueurs « >>> INT-10 logique pure » et « <<< INT-10 logique pure ») et la teste sur une vraie réponse
  (`--allow-write` : écriture du module extrait dans un fichier temporaire).

## Gaine optimale et temps de calcul (INT-10b)

Chaque variante (graines seed, seed+1, seed+2) est calculée par `amenager` du moteur. Pour les pièces humides sans
point d'eau (`pipeline.ts`, `calculerVariantes`) :

1. chaîne de base : variante A → `amenager(plan, { seed, maxCandidats: 1 })` (positions R3 d'origine) ; variantes
   suivantes → `amenager` sur le plan complété des gaines retenues pour A (mêmes gaines « à confirmer » partout) ;
2. recherche de la gaine optimale `amenager(plan, { seed, maxCandidats })` (défaut 10, secret facultatif
   `INTERIOR_MAX_CANDIDATS` ; 1 = jamais de recherche) SEULEMENT si la base garde un défaut qu'une gaine peut corriger
   (violation bloquante, ou équipement non placé dans une pièce à gaine supposée) et si
   `écoulé + 6 × coût de la base (+ une base de réserve pour B quand on calcule A) ≤ budget`. Retenue seulement si
   meilleure (bloquantes, puis non placés, puis score de tri).

Pourquoi pas une recherche systématique : mesurée dans le conteneur (Deno 2.9.6, 2 vCPU, une variante = un appel
`amenager`, plans du banc dépouillés de leurs points d'eau), une recherche à 10 candidats coûte 0,5 à 1,8 s POUR UNE
SEULE variante (p09 ≈ 1,84 s, p06 ≈ 1,74 s), soit 1,5 à 6,3 fois la chaîne de base (0,11 à 0,54 s) ; à 2 candidats
encore 0,4 à 1,4 s. Trois recherches ne tiennent pas dans les ~2 s de CPU d'une Edge Function, et deux variantes sous
1,5 s ne sont garanties qu'avec la stratégie ci-dessus. Sur le banc, la recherche ne change le résultat que pour p10
(PMR) : 2 violations bloquantes en R3 → 0.

Mesures `calculerVariantes` (budget par défaut 1500 ms, conteneur, ms ; deux passages, valeurs du second) :

| plan (sans points d'eau) | variantes | 2 premières | total | gaine optimale |
|---|---|---|---|---|
| p01-studio | 3 | 688 | 1013 | non (base sans défaut) |
| p02-t2 | 3 | 565 | 830 | non |
| p03-t3 | 3 | 565 | 1004 | non |
| p04-t4 | 3 | 938 | 1336 | non |
| p05-t5 | 3 | 878 | 1244 | non |
| p06-maison-t4 | 3 | 783 | 1149 | non |
| p07-maison-t5 | 2 (C hors budget) | 1123 | 1122 (arrondis par variante) | non |
| p08-t3-l | 3 | 272 | 405 | non |
| p09-t2-petit | 3 | 747 | 1156 | non |
| p10-t3-pmr | 3 | 1238 | 1334 | oui pour A (favorable, 0 bloquante) ; B et C gardent les gaines de A : 1 bloquante chacune |

Plans tels quels (avec leurs points d'eau) : 2 à 3 variantes, 2 premières ≤ 1082 ms, total ≤ 1385 ms. Plans générés
par MimmozIA Studio (fixtures du paquet) : T3 WC 0,90 m 3 variantes en 1338 ms (recherche faite pour A) ; T3 WC 0,66 m
et T5 14 × 9 m : recherche hors budget (base ≈ 0,25 et 0,5 s), verdict défavorable transmis tel quel.
Limites : temps mesurés dans le conteneur de travail, pas sur l'infrastructure Supabase (non mesurée) ; la décision
de lancer la recherche dépend du temps mesuré, donc de la machine.

## Moteur

Copie figée IDENTIQUE de `@mimmoza/interior-core` 0.3.0 (`src/**`) dans `moteur/` (voir `moteur/VERSION.md` :
empreintes sha256). Point d'entrée utilisé : `amenager` (`moteur/pipeline.ts`).
