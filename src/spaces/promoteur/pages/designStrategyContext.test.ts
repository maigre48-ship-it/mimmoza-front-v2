import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDecisionRecord } from './decisionDossier.ts';
import { buildDesignStrategyContext, strategyPrefill, type DesignStrategyScenario } from './designStrategyContext.ts';

const scenario: DesignStrategyScenario = { id: 's1', programme: 'Logements', address: 'Ascain', insee: '64065', pluZone: 'UA',
  pluEnvelope: { cesRatio: 0.35, heightM: 12, parkingPerHousing: 1, notes: [] },
  market: { meta: { commune_insee: '64065' }, specific: { demographie: { pct_logements_vacants_source: 'mesure', pct_logements_vacants: 8 } } } };

test('reprend cible et programme du dossier de décision avec les mesures locales sourcées', () => {
  const decision = { ...emptyDecisionRecord(), target: 'Ménages permanents', programme: 'Logements traversants T2 et T3', units: '18', grossAreaM2: '1500' };
  assert.deepEqual(strategyPrefill(scenario, decision), { programme: 'Logements', target: 'Ménages permanents', location: 'Ascain' });
  const result = buildDesignStrategyContext(scenario, decision);
  assert.equal(result.programmeDetail, 'Logements traversants T2 et T3');
  assert.equal(result.units, '18');
  assert.equal(result.pluZone, 'UA');
  assert.equal(result.envelope?.heightM, 12);
  assert.equal(result.facts[0]?.label, 'Logements vacants');
  assert.match(result.facts[0]?.url ?? '', /^https:\/\/www\.insee\.fr/);
  assert.match(result.facts[0]?.scope ?? '', /64065/);
});

test('écarte les mesures d’une autre commune et les sources non sécurisées', () => {
  const result = buildDesignStrategyContext({ ...scenario, market: { ...scenario.market, meta: { commune_insee: '64102' } }, pluSource: 'http://example.org/plu' });
  assert.equal(result.facts.length, 0);
  assert.equal(result.pluSource, null);
});
