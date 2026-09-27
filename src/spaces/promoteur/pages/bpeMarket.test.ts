import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBpeCounts, type BpeObservation } from './bpeMarket.ts';

const row = (type: string, value: number, geo = '2026-COM-64065', year = '2025'): BpeObservation => ({
  dimensions: { GEO: geo, TIME_PERIOD: year, FACILITY_TYPE: type, BPE_MEASURE: 'FACILITIES', UNIT_MEASURE: 'NR' },
  attributes: { OBS_STATUS: 'A', UNIT_MULT: '0' }, measures: { OBS_VALUE_NIVEAU: { value } },
});

test('BPE 2025 : conserve seulement le bon type, territoire, millésime et unité', () => {
  const rows = [row('D401', 1), row('B105', 2), row('D101', 22, '2026-DEP-64'), row('D401', 99, '2026-COM-64122'), row('D401', 8, '2026-COM-64065', '2024'), row('A405', 5)];
  assert.deepEqual(parseBpeCounts(rows, 'COM', '64065'), { D401: 1, B105: 2 });
  assert.deepEqual(parseBpeCounts(rows, 'DEP', '64'), { D101: 22 });
});

test('une catégorie absente reste inconnue et les mesures non fiables sont écartées', () => {
  const bad = row('D401', 3);
  bad.attributes!.OBS_STATUS = 'U';
  assert.deepEqual(parseBpeCounts([bad, row('D101', 1.5)], 'COM', '64065'), {});
  assert.equal(parseBpeCounts([row('B105', 0)], 'COM', '64065').B105, 0);
});
