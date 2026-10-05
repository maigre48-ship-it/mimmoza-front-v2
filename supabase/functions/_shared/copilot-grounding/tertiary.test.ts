import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedMarketProgramme, tertiaryGroundingPolicy } from './tertiary.ts';
test('un programme non couvert ne peut pas devenir du logement', () => {
  for (const p of ['local_activite', 'locaux d’activité', 'entrepot', 'industrie', 'clinique', 'unknown']) assert.equal(supportedMarketProgramme(p), null);
  assert.equal(supportedMarketProgramme('bureaux'), 'bureaux');
  assert.equal(supportedMarketProgramme('commerces'), 'commerce');
  assert.equal(supportedMarketProgramme('hôtellerie'), 'hotel');
  assert.equal(supportedMarketProgramme(undefined), 'logement');
});
test('la politique interdit le classement tertiaire par proxies et exige les preuves locales', () => {
  const p = tertiaryGroundingPolicy();
  assert.match(p, /jamais un classement/); assert.match(p, /sans gagnant démontré/);
  assert.match(p, /loyers demandés ou signés/); assert.match(p, /adresse ou parcelle/);
});
