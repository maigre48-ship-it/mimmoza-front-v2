import assert from 'node:assert/strict';
import test from 'node:test';
import { shortlistOperators, type OperatorCandidate } from './operatorShortlist.ts';

const candidate = (siren: string, communeInsee: string, epci: string, localActivite: string): OperatorCandidate => ({
  siren, nom: siren, activite: '55.10Z', commune: 'Test', communeInsee, epci, localActivite,
  adresse: null, url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
});

test('la présélection privilégie les preuves locales sans conclure à un intérêt', () => {
  const found = shortlistOperators([
    candidate('000000001', '64445', 'autre', '55.10Z'),
    candidate('000000002', '64065', '200067106', '55.10Z'),
    candidate('000000003', '64102', '200067106', '68.20B'),
  ], '64065', '200067106', '55.10Z');
  assert.deepEqual(found.map((row) => row.candidate.siren), ['000000002', '000000003', '000000001']);
  assert.match(found[1].reason, /activité de l’établissement local 68.20B/);
  assert.ok(found.every((row) => row.checks.some((check) => check.includes('intérêt'))));
});
