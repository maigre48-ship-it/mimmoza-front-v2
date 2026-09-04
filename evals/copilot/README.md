# Banc d’évaluation du Copilot

Ce banc mesure localement le routage métier et, facultativement, des réponses déjà enregistrées. Il n’appelle aucun modèle, aucune API et ne consomme aucun crédit.

## Utilisation

Node.js 24 est requis afin d’importer directement le sélecteur TypeScript du produit.

```powershell
node scripts/copilot-eval.mjs
node scripts/copilot-eval.mjs --json
node scripts/copilot-eval.mjs --results C:\temp\copilot-results.jsonl
```

Le processus renvoie un code non nul lorsqu’un seuil de `thresholds.json` échoue. `--thresholds <fichier>` permet d’utiliser un autre profil, notamment en CI.

## Jeu golden

`golden-cases.json` contient plus de 40 demandes françaises couvrant les onze intentions du routeur, les accents, les formulations ambiguës et les demandes multi-intentions.

Chaque cas contient :

- `id`, identifiant stable et non sensible ;
- `question`, demande représentative ;
- `expected_intent` ;
- `required_tools` et, facultativement, `forbidden_tools` ;
- `tags` ;
- `response_requirements` avec `requires_sources`, `requires_limits` et éventuellement `required_phrases`.

## Résultats enregistrés

L’option `--results` accepte un tableau JSON, un objet `{ "results": [...] }` ou un fichier JSONL. Chaque ligne peut contenir :

```json
{"case_id":"plu-01","response":"Selon le PLU… sous réserve de vérification.","tool_calls":["get_parcel_plu"],"latency_ms":820,"input_tokens":1200,"output_tokens":260,"cost_usd":0.004}
```

Pour capturer ces résultats, enregistrer après consentement uniquement l’identifiant du cas, le texte final, les noms d’outils et les métriques techniques. Retirer adresses, noms, identifiants de parcelles, documents, paramètres d’outils et toute donnée utilisateur. Ne jamais placer de clé API dans ces fichiers.

## Métriques et limites

Le mode par défaut mesure la précision de l’intention, le rappel des outils requis, les violations d’outils interdits et le taux de fallback. Avec des résultats enregistrés, il ajoute la présence de citations, l’expression des limites, les phrases requises, les chiffres sans citation, les suraffirmations géographiques, les latences p50/p95, les tokens et le coût lorsqu’ils sont fournis.

La métrique `geographic_overclaim_count` détecte notamment les glissements CATNAT commune → parcelle inondable, altitude → preuve d’inondation, proximité SEVESO/ICPE → PPRT, SISPEA commune → raccordement à l’adresse, aléa feu → OLD, pente → absence de terrassement, et SIS proche → parcelle en SIS. Son seuil est zéro avec `--results`. Le détecteur est un filet de régression heuristique et ne bloque pas la réponse en production.

La métrique `unsupported_inference_count` détecte les calculs financiers spontanés dans un rapport parcellaire, les verdicts de terrassement fondés sur la pente seule, les obligations G1/G2 généralisées, la confusion THRS/logements vacants, les proximités « immédiates » sans distance, les caractéristiques déduites du nom d’une voie, les qualificatifs décisionnels non sourcés et les certitudes SPR/ABF sans intersection. Son seuil est zéro avec `--results`.

Les citations, limites et chiffres non cités sont détectés par heuristiques lexicales explicites dans le runner. Elles servent de signal de régression, pas de preuve absolue de justesse. Une revue humaine reste nécessaire pour les conclusions à enjeu juridique, financier ou urbanistique.

Seuils CI recommandés : précision d’intention ≥ 95 %, rappel des outils ≥ 98 %, aucune violation d’outil interdit, fallback ≤ 15 %, citations ≥ 90 %, limites ≥ 85 %, chiffres non cités ≤ 10 %, aucune suraffirmation géographique. Faire évoluer les seuils seulement après examen des cas qui échouent.
