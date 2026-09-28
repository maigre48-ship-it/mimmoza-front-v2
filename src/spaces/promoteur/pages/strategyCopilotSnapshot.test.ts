import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyCopilotSnapshot } from './strategyCopilotSnapshot.ts';
import { emptyDecisionRecord } from './decisionDossier.ts';

test('une exploration périmée ne devient pas une recommandation dans le chat', () => {
  const snapshot = buildStrategyCopilotSnapshot({ parcelId: '64065000AI0002', address: 'Ascain', insee: '64065', surfaceM2: '800',
    screeningIsCurrent: false, screening: { date: '2026-09-27', snapshots: [], recommendation: { status: 'piste_prioritaire', projectKey: 'hotel',
      target: 'touristes', programme: 'hôtel', rationale: 'ancien terrain', evidenceIds: [], alternatives: [], conditions: [], generatedAt: '2026-09-27', model: 'IA' } },
    scenarios: [], decisions: {} });
  assert.match(String(snapshot.exploration), /Aucune exploration à jour/);
  assert.equal(snapshot.piste_a_instruire, undefined);
  assert.equal(snapshot.surface_terrain_m2, 800);
});

test('une piste et un scénario incomplet sont transmis comme hypothèse et décision suspendue', () => {
  const record = { ...emptyDecisionRecord(), target: 'séjours de loisirs', units: '20' };
  const snapshot = buildStrategyCopilotSnapshot({ parcelId: '64065000AI0002', address: 'Ascain', insee: '64065', surfaceM2: '800',
    screeningIsCurrent: true, screening: { date: '2026-09-27', snapshots: [{ key: 'hotel', market: null, error: 'occupation inconnue' }],
      recommendation: { status: 'piste_prioritaire', projectKey: 'hotel', target: 'séjours de loisirs', programme: 'hôtel à tester',
        rationale: 'nuitées départementales', evidenceIds: [], alternatives: [{ key: 'logement', reason: 'à comparer' }],
        conditions: ['mesurer occupation'], generatedAt: '2026-09-27', model: 'IA' } },
    scenarios: [{ id: 'one', parcelId: '64065000AI0002', programme: 'Hôtel' }], decisions: { one: record } });
  assert.equal(snapshot.piste_a_instruire, 'Hôtel');
  assert.match(String(snapshot.usage_hotel), /aucune mesure exploitable/);
  assert.match(String(snapshot.scenario_1), /a_documenter/);
  assert.match(String(snapshot.conclusion_comparative), /au moins deux programmes/i);
});
