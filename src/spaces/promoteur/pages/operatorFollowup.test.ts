import assert from 'node:assert/strict';
import test from 'node:test';
import { documentedInterest, summarizeOperatorFollowups } from './operatorFollowup.ts';

test('un intérêt exploitant compte seulement avec réponse datée et sourcée', () => {
  const date = new Date().toISOString().slice(0, 10);
  const partial = { status: 'interet_declare' as const, responseDate: date, source: '', note: 'Format de trente chambres à examiner.' };
  assert.equal(documentedInterest(partial), false);
  const full = { ...partial, source: 'Courriel du directeur commercial du 12/09' };
  assert.equal(documentedInterest(full), true);
  const summary = summarizeOperatorFollowups({ '123456789': full, '987654321': { status: 'refus' } }, ['123456789', '987654321']);
  assert.equal(summary.interests.length, 1);
  assert.equal(summary.refusals, 1);
  assert.equal(summary.answered, 2);
});
