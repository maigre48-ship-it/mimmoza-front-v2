// evals/copilot/index.js
// Point d'entrée de `node --test evals/copilot/` : depuis Node 22, un DOSSIER passé à `node --test` est exécuté
// comme un module (et non parcouru). Ce fichier charge donc les tests du banc. Écrit pour être valide que le
// paquet soit en CommonJS ou en modules ES. Équivalent direct : `node --test evals/copilot/criteres.test.ts`.
import('./criteres.test.ts');
