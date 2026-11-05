// deno test supabase/functions/copilot-chat/agent/moteur-q3.test.ts — lot Q3, fonctions pures du moteur (points 1, 3, 4).
import * as na from 'node:assert/strict';
import { etapesMetierDisponibles, phraseInterrogative, questionChoixReglement, raccourcirQuestion, signatureErreur, QUESTION_MAX_CARS } from './mission.ts';
import { calculerDevis, ETAPES_PAR_TYPE, ETAPES_TECHNIQUES_RESERVEES } from './devis.ts';

// Titres d'articles SYNTHÉTIQUES, sauf « UC 9 – Emprise au sol (p. 109) » (preuve du 05/11/2026).
const ARTICLES = [{ titre: 'Article UC 9 – Emprise au sol', page: 109 },
  ...Array.from({ length: 29 }, (_, i) => ({ titre: `ARTICLE UC ${i + 10} - Titre synthétique de test numéro ${i + 10}`, page: 110 + i }))];
const MESSAGE = 'Le chapitre de la zone UC (p. 100-140) est trop long pour être lu en une fois. ' +
  `Articles repérés : ${ARTICLES.map((a) => `${a.titre} (p. ${a.page})`).join(' ; ')}. Quels articles ou quelles pages lire ?`;

Deno.test('Q3-4 : question « quels articles lire ? » — question d’abord, une ligne par article, « … et N autres », ≤ 1 000', () => {
  na.ok(MESSAGE.length > 1000);
  // Avant le lot Q3 : texte(message, 1000) → la question finale disparaissait.
  na.ok(!`${MESSAGE.slice(0, 1000)}…`.includes('Quels articles'), 'constat reproduit');
  for (const r of [
    { statut: 'selection_trop_longue', zone_lue: 'UC', pages_chapitre: '100-140', articles: ARTICLES, message: MESSAGE },
    { statut: 'selection_trop_longue', zone_lue: 'UC', message: MESSAGE },          // liste relue dans le message
  ]) {
    const q = questionChoixReglement(r);
    na.ok(q.startsWith('Quels articles ou quelles pages du règlement lire ?\n'), q.slice(0, 80));
    na.ok(q.includes('\n- UC 9 – Emprise au sol (p. 109)\n'), q);
    na.ok(q.includes('\n- UC 10 – Titre synthétique de test numéro 10 (p. 110)'), 'format « - UC n – titre (p. N) »');
    na.match(q, /\n… et \d+ autres$/);
    na.ok(q.length <= QUESTION_MAX_CARS, String(q.length));
    na.ok(q.split('\n').filter((l) => l.startsWith('- ')).length <= 12);
  }
  // Autres statuts : la phrase interrogative reste visible.
  const choix = questionChoixReglement({ statut: 'choix_requis', message: `${'Pièce très longue ; '.repeat(80)}Laquelle lire ?` });
  na.ok(choix.startsWith('Laquelle lire ?') && choix.length <= QUESTION_MAX_CARS);
});

Deno.test('Q3-4 : toute question tronquée garde sa phrase interrogative (en tête)', () => {
  na.equal(raccourcirQuestion('Court ?'), 'Court ?');
  const longue = `${'Contexte détaillé (p. 12, art. UC 9). '.repeat(40)}Quelle toiture retenez-vous ?`;
  const q = raccourcirQuestion(longue, 500);
  na.ok(q.startsWith('Quelle toiture retenez-vous ?\n'), q.slice(0, 60));
  na.ok(q.length <= 500);
  na.equal(phraseInterrogative('Voir p. 12. Lire quoi ?'), 'Lire quoi ?');
  na.equal(phraseInterrogative('Aucune question.'), null);
  na.ok(raccourcirQuestion('x'.repeat(2000), 300).length <= 300, 'sans « ? » : bornée');
});

Deno.test('Q3-3 : budget d’étapes de la conception — 18, dont 4 garanties aux lectures (minimum, pas cloison) ; autres types inchangés', () => {
  na.equal(ETAPES_PAR_TYPE.conception, 18);
  na.equal(ETAPES_TECHNIQUES_RESERVEES.conception, 4);
  const d = calculerDevis({ type: 'conception', tier: 'sonnet', pireCasEtape: 10 });
  na.equal(d.jetons_max, 18 * 10, 'jetons_max = étapes × pire cas (réservé ; seul le consommé est facturé)');
  const m = (faites: number) => ({ type: 'conception' as const, etapes_faites: faites, etapes_max: 18 });
  // Lot Q3-quinquies : la réserve est un minimum garanti, pas une cloison — tant qu'elle n'est pas épuisée,
  // 1 étape reste gardée pour une lecture, plus l'étape du rapport (16 étapes de travail au plus sur 18).
  na.equal(etapesMetierDisponibles(m(12), { etapes_techniques: 0 }), true);
  na.equal(etapesMetierDisponibles(m(15), { etapes_techniques: 0 }), true);
  na.equal(etapesMetierDisponibles(m(16), { etapes_techniques: 0 }), false);
  na.equal(etapesMetierDisponibles(m(15), { etapes_techniques: 2 }), true);
  na.equal(etapesMetierDisponibles(m(16), { etapes_techniques: 2 }), false);
  // Les techniques au-delà de la réserve comptent ; plafond dur etapes_max − 1.
  na.equal(etapesMetierDisponibles(m(17), { etapes_techniques: 9 }), false);
  // Ancien plafond (12) : 12 étapes réelles consommées → la mission partait en rapport partiel.
  na.equal(etapesMetierDisponibles({ type: 'conception', etapes_faites: 11, etapes_max: 12 }, { etapes_techniques: 2 }), false);
  // Prospection : comportement historique (aucune réserve).
  na.equal(etapesMetierDisponibles({ type: 'prospection_fonciere', etapes_faites: 28, etapes_max: 30 }, { etapes_techniques: 5 }), true);
  na.equal(etapesMetierDisponibles({ type: 'prospection_fonciere', etapes_faites: 29, etapes_max: 30 }, { etapes_techniques: 5 }), false);
});

Deno.test('Q3-1 : signature d’erreur — « même erreur » malgré identifiants et nombres variables', () => {
  na.equal(signatureErreur('mise à jour agent_conceptions : violates check constraint "x" (row 12, id 0f9c9481-0000-4000-8000-000000000001)'),
    signatureErreur('mise à jour agent_conceptions : violates check constraint "x" (row 13, id 11111111-1111-4111-8111-111111111111)'));
  na.notEqual(signatureErreur('Anthropic 529'), signatureErreur('débit refusé : etat_trop_gros'));
});
