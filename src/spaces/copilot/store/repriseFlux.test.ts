import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARQUEUR_SUITE,
  choisirReponseServeur,
  deciderReprise,
  erreurNonReprenable,
  estDemandeDeSuite,
  fusionnerSuites,
  messageDeSuite,
  raccorderSuite,
  reponseComplete,
  retirerMarqueursInterruption,
  type FinDeFlux,
} from './repriseFlux.ts';

const fin = (p: Partial<FinDeFlux>): FinDeFlux => ({
  terminal: null, partielPersiste: false, erreur: null, annuleParUtilisateur: false,
  conversationId: 'conv-1', dejaRepris: false, ...p,
});

test('décision : fin normale → rien', () => {
  assert.equal(deciderReprise(fin({ terminal: 'done' })), 'rien');
});

test('décision : arrêt utilisateur → rien (géré par cancelStreaming)', () => {
  assert.equal(deciderReprise(fin({ annuleParUtilisateur: true })), 'rien');
});

test('décision : flux coupé sans done ni error → relecture en base (aucun nouvel appel modèle)', () => {
  assert.equal(deciderReprise(fin({ terminal: null })), 'relire_serveur');
});

test('décision : flux coupé avant même la conversation → échec explicite', () => {
  assert.equal(deciderReprise(fin({ terminal: null, conversationId: null })), 'echec');
});

test('décision : partiel persisté par le serveur → une seule demande de suite', () => {
  assert.equal(deciderReprise(fin({ terminal: 'error', partielPersiste: true, erreur: 'Timeout' })), 'demander_suite');
  assert.equal(deciderReprise(fin({ terminal: 'error', partielPersiste: true, dejaRepris: true })), 'rien');
});

test('décision : erreur sans partiel, ou erreur de jetons → pas de suite', () => {
  assert.equal(deciderReprise(fin({ terminal: 'error', partielPersiste: false })), 'rien');
  assert.equal(deciderReprise(fin({ terminal: 'error', partielPersiste: true, erreur: 'INSUFFICIENT_CREDITS' })), 'rien');
  assert.ok(erreurNonReprenable('JWT expired'));
  assert.ok(!erreurNonReprenable('Timeout Anthropic'));
});

test('marqueur de suite reconnu, consigne explicite', () => {
  assert.ok(estDemandeDeSuite(messageDeSuite()));
  assert.ok(messageDeSuite().startsWith(MARQUEUR_SUITE));
  assert.ok(!estDemandeDeSuite('Continue'));
  assert.ok(!estDemandeDeSuite(null));
});

test('les marqueurs d’interruption sont retirés', () => {
  assert.equal(retirerMarqueursInterruption('Texte\n\n_(interrompu)_'), 'Texte');
  assert.equal(
    retirerMarqueursInterruption('Analyse\n\n_[Réponse interrompue avant la fin — la suite n\'a pas pu être générée.]_'),
    'Analyse',
  );
  assert.equal(retirerMarqueursInterruption('[réponse interrompue]'), '');
  assert.equal(retirerMarqueursInterruption('Texte normal.'), 'Texte normal.');
});

test('raccord : chevauchement littéral retiré', () => {
  const partiel = '## La prochaine action\n\nDemandez le règlement du PLU de Saint-Cloud';
  const suite = 'le règlement du PLU de Saint-Cloud et la fiche de zonage.';
  assert.equal(raccorderSuite(partiel, suite), partiel + ' et la fiche de zonage.');
});

test('raccord : mot coupé réécrit en entier', () => {
  assert.equal(raccorderSuite('je vous calcule immédia', 'immédiatement le prix.'), 'je vous calcule immédiatement le prix.');
});

test('raccord : jointures simples', () => {
  assert.equal(raccorderSuite('Fin de phrase.', 'Nouvelle phrase.'), 'Fin de phrase. Nouvelle phrase.');
  assert.equal(raccorderSuite('Valeur estimée', ', hors frais.'), 'Valeur estimée, hors frais.');
  assert.equal(raccorderSuite('Paragraphe.', '## Titre'), 'Paragraphe.\n\n## Titre');
  assert.equal(raccorderSuite('Texte ', ' suite'), 'Texte suite');
  assert.equal(raccorderSuite('', '  début'), 'début');
  assert.equal(raccorderSuite('Base\n\n_(interrompu)_', ''), 'Base');
});

test('raccord : le marqueur du partiel ne reste jamais au milieu', () => {
  const r = raccorderSuite('Début\n\n_[Réponse interrompue avant la fin — x.]_', 'et la suite.');
  assert.ok(!r.includes('interrompue'));
  assert.equal(r, 'Début et la suite.');
});

test('historique : la demande de suite est masquée et la réponse recollée', () => {
  const msgs = [
    { id: 'u1', role: 'user' as const, text: 'Bonne affaire à Saint-Cloud ?' },
    { id: 'a1', role: 'assistant' as const, text: 'Analyse… La prochaine action : deman\n\n_[Réponse interrompue avant la fin — x.]_' },
    { id: 'u2', role: 'user' as const, text: messageDeSuite() },
    { id: 'a2', role: 'assistant' as const, text: 'demander le PLU.' },
    { id: 'u3', role: 'user' as const, text: 'Merci' },
  ];
  const out = fusionnerSuites(msgs);
  assert.deepEqual(out.map((m) => m.id), ['u1', 'a2', 'u3']);
  assert.equal(out[1].text, 'Analyse… La prochaine action : demander le PLU.');
});

test('historique : demande de suite orpheline masquée', () => {
  const out = fusionnerSuites([
    { id: 'a1', role: 'assistant' as const, text: 'x' },
    { id: 'u2', role: 'user' as const, text: messageDeSuite() },
  ]);
  assert.deepEqual(out.map((m) => m.id), ['a1']);
});

test('relecture : choisit la plus ancienne réponse inconnue postérieure au départ', () => {
  const depart = Date.parse('2026-10-22T08:51:52Z');
  const lignes = [
    { id: 'old', text: 'ancienne', finishReason: 'end_turn', createdAt: '2026-10-22T08:51:31Z' },
    { id: 'new', text: 'réponse', finishReason: 'end_turn', createdAt: '2026-10-22T08:52:23Z' },
  ];
  assert.equal(choisirReponseServeur(lignes, new Set(['old']), depart)?.id, 'new');
  assert.equal(choisirReponseServeur(lignes, new Set(['old', 'new']), depart), null);
  // L'ancienne, inconnue mais bien antérieure au départ (> tolérance), est écartée.
  assert.equal(choisirReponseServeur([lignes[0]], new Set(), depart + 10 * 60_000), null);
});

test('relecture : une réponse interrompue n’est jamais tenue pour complète', () => {
  assert.ok(reponseComplete({ finishReason: 'end_turn', text: 'ok' }));
  assert.ok(!reponseComplete({ finishReason: 'interrupted', text: 'ok' }));
  assert.ok(!reponseComplete({ finishReason: 'max_tokens', text: 'ok' }));
  assert.ok(!reponseComplete({ finishReason: null, text: 'x\n\n_[Réponse interrompue avant la fin — y.]_' }));
});
