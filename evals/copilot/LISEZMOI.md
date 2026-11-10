# Banc d'évaluation de Mimmo (lot 1.A)

Ce banc mesure si les réponses de Mimmo (Edge Function `copilot-chat`) respectent les règles du produit : aucune donnée inventée, aucun qualificatif non fondé, une portée et une source par donnée, aucun calcul fait par le modèle, une conclusion, un devis avant toute mission, rien d'« envoyé » sans validation.

Il complète le banc de routage déjà présent dans ce dossier (`README.md`, `golden-cases.json`, `thresholds.json`, lancé par `scripts/copilot-eval.mjs`), qui mesure le choix des outils sans appeler le modèle. Les deux sont indépendants.

## Contenu

| Fichier | Rôle |
|---|---|
| `questions.json` | 89 questions d'utilisateurs, avec leurs attendus et leurs interdits |
| `criteres.ts` | Fonctions pures et déterministes qui notent une réponse enregistrée |
| `criteres.test.ts` | Tests des critères et du lanceur (`node --test`) |
| `lancer.mjs` | Lanceur : mode à blanc (aucun réseau) ou passage réel (consomme des jetons) |
| `index.js` | Point d'entrée de `node --test evals/copilot/` |
| `exemples/` | Réponses réelles du 10/11/2026, reprises de `RESULTATS.md`, pour le mode à blanc |
| `resultats/` | Passages réels, un fichier par passage (non versionnés) |

## Lancer

Node.js 22.18 ou plus récent (exécution directe des fichiers `.ts`). Depuis la racine du dépôt, dans PowerShell :

```powershell
# 1. Les tests du banc (aucun réseau)
node --test evals/copilot/

# 2. Le mode à blanc : note les réponses enregistrées de evals/copilot/exemples/ (aucun réseau, aucun jeton)
node evals/copilot/lancer.mjs --a-blanc

# 3. Noter un passage déjà enregistré
node evals/copilot/lancer.mjs --a-blanc --reponses evals/copilot/resultats/2026-11-12T09-30-00.json
```

### Passage réel

**Chaque question est un vrai message envoyé à Mimmo et consomme des jetons** sur le compte dont le jeton est fourni. Lors des essais du 10/11, un message a coûté de 9 à 56 jetons. N'utilisez jamais un compte personnel : certaines réponses écrivent en mémoire de projet ou proposent des missions.

```powershell
# Sans --confirmer : affiche le nombre de questions et le rappel de coût, n'envoie rien.
node evals/copilot/lancer.mjs https://<projet>.supabase.co/functions/v1/copilot-chat

# Passage réel sur trois questions, arrêt à 100 jetons débités.
$env:MIMMOZA_JETON = "<jeton de session du compte de test>"
$env:MIMMOZA_CLE_PUBLIQUE = "<clé publique du projet (anon)>"   # facultatif : le site l'envoie dans l'en-tête apikey
node evals/copilot/lancer.mjs https://<projet>.supabase.co/functions/v1/copilot-chat --confirmer --plafond-jetons 100 --seulement PAR-01,PIE-02,PIE-04
Remove-Item Env:MIMMOZA_JETON
```

Le lanceur refuse de partir sans `--confirmer`, sans `--plafond-jetons <N>`, sans la variable `MIMMOZA_JETON`, ou si l'URL ne se termine pas par `copilot-chat`. Il s'arrête de lui-même quand le plafond est atteint, sur un jeton refusé (401) ou sur un solde insuffisant (402).

| Option | Effet |
|---|---|
| `--seulement PAR-01,PIE-02` | ne lancer que ces questions |
| `--categorie pieges` | ne lancer qu'une catégorie |
| `--max 10` | au plus N questions |
| `--plafond-jetons 300` | arrêt dès que le total débité atteint N (obligatoire) |
| `--mode quick` ou `advanced` | mode demandé ; le serveur le redéfinit selon le plan |
| `--tier haiku`, `sonnet` ou `opus` | niveau de modèle demandé ; le serveur le revalide |
| `--pause-ms 2000` | pause entre deux questions |
| `--delai-s 300` | délai maximal d'une réponse |
| `--avec-prerequis` | inclure les questions à prérequis (`PIE-13` : compte à solde insuffisant) |
| `--sans-sorties` | ne pas enregistrer les résultats d'outils |
| `--dossier-resultats <dossier>` | dossier d'écriture |

Le fichier `resultats/<date>.json` contient les réponses (texte, outils et leurs résultats, jetons, durée), les notes et la synthèse. Il peut contenir des données personnelles (propriétaires, adresses) : ne le publiez pas. Le jeton n'y est jamais écrit.

## Ce qui est envoyé au serveur

Forme relevée dans `src/spaces/copilot/lib/copilotClient.ts`, `src/spaces/copilot/types/copilot.types.ts` et `validateRequest` (`supabase/functions/copilot-chat/index.ts`) :

```json
{ "message": "…", "mode": "quick", "tier": "sonnet",
  "context": { "vertical": "promoteur", "route": "/promoteur", "pageContext": { "pathname": "/promoteur", "space": "promoteur" },
               "parcel": { "id": "…", "commune": "…" }, "activeDeal": { "id": "…" },
               "predictive_snapshot": null, "valuation_engine": null, "project_followup": null } }
```

En-têtes : `Authorization: Bearer <jeton>`, `Content-Type: application/json`, et `apikey` si fournie. La réponse est un flux d'événements (`token`, `tool_use_start`, `tool_use_end`, `mission_devis`, `done`, `error`).

Supposé, faute d'avoir pu le confirmer sans appeler la production :

- `project_followup: null` : le site y met le résultat de `followupContext`, non reproduit ;
- pas de `conversation_id` : chaque question ouvre une conversation neuve (le site fait de même pour un premier message) ;
- pas de `promoteur_chain`, pas de `pageSnapshot`, pas de `risk_study` : le banc n'a pas d'étude ouverte ;
- les profils « banque » et « assurance » partent avec `vertical: "generique"` (le type `Vertical` ne les connaît pas) et la route de leur espace ;
- la raison d'arrêt du modèle (`end_turn`, `tool_use`) n'est pas diffusée par le flux : le banc reconnaît une réponse sans conclusion à son texte et à l'avis du serveur.

## Les questions

Chaque question porte : `id`, `profil`, `categorie`, `question`, `contexte` (page, parcelle ou deal actif), `attendus`, `interdits`, `source_du_cas`.

- Un **attendu** est un constat qui doit être présent ; un **interdit** est un constat qui doit être absent. Les deux s'écrivent `{ "critere": "<nom>", … }`.
- `source_du_cas.type` vaut `essai_reel` (essais du 10/11, avec renvoi à `RESULTATS.md`), `regle_produit` ou `construit`.
- Aucune réponse chiffrée n'est inventée. Toute valeur chiffrée d'un attendu ou d'un interdit porte un `renvoi` à `RESULTATS.md` ; `validerQuestions` le vérifie et les tests échouent sinon.
- `prerequis` : la question n'est lancée qu'avec `--avec-prerequis`.
- Les contextes sont ceux d'un utilisateur réel : la parcelle 93048000AS0249 (804 m², Montreuil) vient de l'essai 2. Le deal « deal-banc-01 » est fictif : ses montants sont des saisies d'utilisateur, pas des données attendues.

### Les critères

| Critère | Ce qu'il constate |
|---|---|
| `outil_appele`, `aucun_outil`, `nb_outils_max` | les outils appelés pendant la réponse |
| `texte_contient` | des motifs dans le texte (sans accents ni majuscules ; `brut: true` pour le texte exact) |
| `source_citee`, `portee_citee` | au moins une source, au moins une portée dans la réponse |
| `source_par_donnee`, `portee_par_donnee` | la part des blocs chiffrés qui portent une source, une portée (seuil 90 %) |
| `qualificatif_infonde` | étalons et superlatifs (« tension extrême », « premium », « moyenne nationale ») ; comparatifs sans chiffre dans la phrase |
| `calcul_hors_moteur` | opération posée par le modèle sans outil de calcul (réutilise `agent/garde-calcul.ts`, plus les divisions et les ratios) |
| `chiffre_non_rattache` | chiffre du texte absent des résultats d'outils, de la question et du contexte |
| `conclusion_presente` | la réponse ne s'arrête ni sur une action annoncée, ni sur l'avis d'interruption du serveur |
| `consigne_interne_visible` | consigne adressée au modèle, note du serveur, numéro de règle interne dans le texte |
| `annonce_envoi`, `mission_annoncee_demarree` | un envoi ou un démarrage de mission affirmé |
| `devis_propose`, `devis_avant_etudes` | carte de devis reçue ; aucun outil d'étude avant `proposer_mission` |
| `question_de_precision`, `donnee_dite_indisponible`, `marche_a_suivre`, `refus_explicite` | la réponse demande une précision, dit qu'une donnée manque, dit comment l'obtenir, refuse |
| `erreur_serveur`, `jetons_max`, `duree_max_s` | erreur attendue, plafonds de coût et de durée |
| `francais_accentue` | texte accentué, sans mot courant privé de son accent |
| `un_de`, `tous` | composites |

Huit critères **communs** s'appliquent à toute réponse qui n'est pas une erreur du serveur : `conclusion_presente` et `francais_accentue` (attendus) ; `consigne_interne_visible`, `calcul_hors_moteur`, `qualificatif_infonde`, `chiffre_non_rattache`, `annonce_envoi`, `mission_annoncee_demarree` (interdits).

## Lire les notes

```
Question Catégorie           Note  OK  KO  NV  Jetons  Durée  Échecs
PLU-07   plu_faisabilite     55 %   6   5   1     51  161 s  attendu:devis_propose, interdit:calcul_hors_moteur, …
          · calcul_hors_moteur : garde-calcul : « 563 × 5 × 0,85 = 2 390 »
          ! signalement — consigne_dans_sortie_outil : …
```

- **OK / KO** : critères réussis et en échec. **Note** = OK / (OK + KO).
- **NV** (non vérifiable) : l'enregistrement ne permet pas de trancher. Exemple : `chiffre_non_rattache` sans les résultats d'outils. Un NV ne compte ni pour ni contre.
- Les lignes `·` donnent la preuve de chaque échec ; les lignes `!` sont des **signalements** hors note (consigne interne dans un résultat d'outil, nom d'outil visible, outil à effet réel appelé).
- La synthèse donne la note globale, le nombre de questions sans aucun échec, le total de jetons, la durée médiane, puis le détail par catégorie et par critère.

La mesure qui compte est le nombre de **questions sans aucun échec** et la liste des critères en échec, pas la note globale : une réponse peut réussir douze critères et inventer un chiffre.

## Limites

- Les critères sont des heuristiques lexicales. Ils repèrent un écart, ils ne prouvent pas qu'une réponse est juste. Une lecture humaine reste nécessaire pour toute conclusion d'urbanisme, de droit ou de finance.
- **La justesse d'une règle de PLU n'est pas vérifiée**, sauf pour les valeurs recoupées à la main le 10/11 à Montreuil (emprise, hauteur, stationnement, retrait). Ailleurs, le banc vérifie le comportement, pas la valeur.
- `chiffre_non_rattache` compare des nombres, pas leur sens : un chiffre présent dans un résultat d'outil mais attribué à la mauvaise grandeur passe ; une conversion d'unité légitime (m² en hectares) est relevée à tort.
- `source_par_donnee` et `portee_par_donnee` raisonnent par bloc de texte : une source en fin de réponse ne couvre pas les blocs précédents ; « parcelle » ou « commune » dans le bloc suffit à valider la portée, même mal attribuée.
- `qualificatif_infonde` ne relève pas les libellés de risque (« aléa faible », « sismicité modérée »), qui sont des classes officielles, et ignore une phrase qui refuse de qualifier.
- Les cartes affichées à l'écran ne sont pas vues par le banc : seuls le texte et les résultats d'outils le sont.
- Les exemples de `exemples/` sont des fragments cités dans `RESULTATS.md`, pas les réponses entières, qui n'ont pas été conservées.
- Le modèle n'est pas déterministe : une question réussie une fois peut échouer la suivante. Un passage est une mesure, pas une preuve ; la stabilité demande plusieurs passages.
- Un passage réel écrit dans le compte de test (conversations, mémoire de projet). Aucune question ne demande de créer une veille, de lancer un rendu ou d'envoyer un courrier, mais le modèle peut appeler ces outils : c'est alors signalé.
