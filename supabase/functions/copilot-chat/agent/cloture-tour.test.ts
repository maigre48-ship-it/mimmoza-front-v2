// deno test supabase/functions/copilot-chat/agent/cloture-tour.test.ts
import * as na from 'node:assert/strict';
import { AVIS_SANS_CONCLUSION, avecConsigneCloture, clotureSansConclusion, CONSIGNE_CLOTURE_TOUR } from './cloture-tour.ts';

Deno.test('résultats d’outils en dernier : la consigne est ajoutée APRÈS les blocs, sans muter l’entrée', () => {
  const resultats = [{ type: 'tool_result', tool_use_id: 'a', content: 'zone UC' }, { type: 'tool_result', tool_use_id: 'b', content: '…' }];
  const messages = [
    { role: 'user', content: 'Étudie la faisabilité…' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'get_zonage_plu', input: {} }] },
    { role: 'user', content: resultats },
  ];
  const copie = JSON.parse(JSON.stringify(messages));
  const sortie = avecConsigneCloture(messages);
  na.deepEqual(messages, copie);                       // entrée intacte
  na.deepEqual(sortie.length, 3);
  const blocs = sortie[2].content as Array<Record<string, unknown>>;
  na.deepEqual(blocs.length, 3);
  na.deepEqual(blocs[0], resultats[0]);                // les tool_result restent en tête, dans l'ordre
  na.deepEqual(blocs[1], resultats[1]);
  na.deepEqual(blocs[2], { type: 'text', text: CONSIGNE_CLOTURE_TOUR });
  na.equal(sortie[0], messages[0]);          // les autres messages ne sont pas recopiés
});

Deno.test('dernier message utilisateur en texte : la consigne suit le texte', () => {
  const sortie = avecConsigneCloture([{ role: 'user', content: 'bonjour' }]);
  na.deepEqual(sortie[0].content, `bonjour\n\n${CONSIGNE_CLOTURE_TOUR}`);
});

Deno.test('dernier message assistant (reprise pause_turn) ou liste vide : rien n’est ajouté', () => {
  const messages = [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'text', text: '…' }] }];
  na.equal(avecConsigneCloture(messages), messages);
  const vide: Array<{ role: string; content: unknown }> = [];
  na.equal(avecConsigneCloture(vide), vide);
});

Deno.test('la consigne interdit les outils, les annonces et l’invention, et impose « Ce qui manque »', () => {
  na.ok(CONSIGNE_CLOTURE_TOUR.startsWith('[NOTE DU SERVEUR'));
  for (const mot of ['AUCUN outil', '## Ce qui manque', "N'annonce aucune action", "N'invente aucune donnée"]) {
    na.ok(CONSIGNE_CLOTURE_TOUR.includes(mot), mot);
  }
});

Deno.test('clotureSansConclusion : outil réclamé ou texte vide = pas de conclusion ; pause_turn traité ailleurs', () => {
  na.ok(clotureSansConclusion('Je les lis en parallèle.', 'tool_use'));   // cas réel du 10/11
  na.ok(clotureSansConclusion('   ', 'end_turn'));
  na.ok(!clotureSansConclusion('Zone UC. ## Ce qui manque …', 'end_turn'));
  na.ok(!clotureSansConclusion('Zone UC…', 'max_tokens'));
  na.ok(!clotureSansConclusion('', 'pause_turn'));
  na.ok(AVIS_SANS_CONCLUSION.includes('interrompue avant sa conclusion'));
});
