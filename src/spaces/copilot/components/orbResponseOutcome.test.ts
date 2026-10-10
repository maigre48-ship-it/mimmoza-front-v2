import assert from 'node:assert/strict';
import test from 'node:test';
import { phaseReponseEnFlux, reponseClairementNegative } from './orbResponseOutcome.ts';

test('bleu avant le premier texte assistant, vert dès les premiers mots', () => {
  assert.equal(phaseReponseEnFlux([{ role: 'user', text: 'Question' }, { role: 'assistant', text: '' }]), 'thinking');
  assert.equal(phaseReponseEnFlux([{ role: 'user', text: 'Question' }, { role: 'assistant', text: 'Voici' }]), 'responding');
});

test('rouge pour une conclusion explicitement défavorable', () => {
  for (const text of [
    'Non, cette parcelle n’est pas constructible.',
    '**Conclusion :** Cette parcelle n’est pas constructible.',
    'Non constructible au regard du PLU.',
    'Impossible de réaliser ce projet en l’état.',
    'Le projet n’est pas éligible.',
  ]) assert.equal(reponseClairementNegative(text), true, text);
});

test('pas de rouge pour absence de risque, nuance ou simple négation', () => {
  for (const text of [
    'Aucun risque majeur n’a été identifié.',
    'Pas de problème pour ce projet.',
    'Oui, mais le dossier n’est pas complet.',
    'Non seulement le terrain est constructible, mais il bénéficie d’un accès.',
    'Le terrain est constructible. Il n’est pas concerné par ce risque.',
    '',
  ]) assert.equal(reponseClairementNegative(text), false, text);
});