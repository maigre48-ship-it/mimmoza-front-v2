import assert from 'node:assert/strict';
import test from 'node:test';
import { assessScenario, compareScenarios, emptyDecisionRecord, GATE_KEYS, type DecisionRecord } from './decisionDossier.ts';

function complete(cost: string, base: string, downside: string): DecisionRecord {
  const record = emptyDecisionRecord();
  record.target = 'Clientèle locale documentée'; record.programme = '30 chambres et services vérifiés';
  record.units = '30'; record.grossAreaM2 = '1800'; record.totalCost = cost;
  record.baseExitValue = base; record.downsideExitValue = downside;
  record.durationMonths = '24'; record.requiredAnnualReturnPct = '5';
  for (const key of GATE_KEYS) record.gates[key] = { verdict: 'favorable', source: `Rapport ${key} 2026`, date: '2026-09-01', finding: `Constat favorable pour ${key} sur le projet.` };
  return record;
}

test('aucune décision finale à partir des seuls scores ou données publiques', () => {
  const assessment = assessScenario(emptyDecisionRecord());
  assert.equal(assessment.status, 'a_documenter');
  assert.ok(assessment.missing.includes('Preuve demande'));
  assert.equal(compareScenarios([{ id: 'a', parcelId: '64065000AI0002', programme: 'Hôtel', record: complete('100', '150', '120') }]).status, 'a_documenter');
});

test('un avis foncier défavorable écarte le scénario, même si sa marge est élevée', () => {
  const hotel = complete('100', '200', '160');
  hotel.gates.foncier.verdict = 'defavorable';
  const housing = complete('100', '140', '125');
  const result = compareScenarios([
    { id: 'h', parcelId: '64065000AI0002', programme: 'Hôtel', record: hotel },
    { id: 'l', parcelId: '64065000AI0002', programme: 'Logements', record: housing },
  ]);
  assert.equal(result.winnerId, 'l');
  assert.equal(result.assessments.h.status, 'a_ecarter');
});

test('la meilleure rentabilité prudente qualifiée prime sur la marge centrale', () => {
  const a = complete('100', '180', '122');
  const b = complete('100', '150', '140');
  const result = compareScenarios([
    { id: 'a', parcelId: '64065000AI0002', programme: 'A', record: a },
    { id: 'b', parcelId: '64065000AI0002', programme: 'B', record: b },
  ]);
  assert.equal(result.status, 'priorite_conditionnelle');
  assert.equal(result.winnerId, 'b');
});

test('deux parcelles différentes et une pièce absente interdisent la comparaison', () => {
  const a = complete('100', '150', '130');
  const b = complete('100', '150', '130');
  assert.equal(compareScenarios([{ id: 'a', parcelId: 'A', programme: 'A', record: a }, { id: 'b', parcelId: 'B', programme: 'B', record: b }]).status, 'a_documenter');
  b.gates.demande.source = '';
  assert.equal(compareScenarios([{ id: 'a', parcelId: 'A', programme: 'A', record: a }, { id: 'b', parcelId: 'A', programme: 'B', record: b }]).status, 'a_documenter');
});

test('deux variantes identiques ne constituent pas une vraie comparaison de cible', () => {
  const a = complete('100', '150', '130');
  const result = compareScenarios([
    { id: 'a', parcelId: '64065000AI0002', programme: 'Hôtel', record: a },
    { id: 'b', parcelId: '64065000AI0002', programme: 'Hôtel', record: { ...a } },
  ]);
  assert.equal(result.status, 'a_documenter');
});
