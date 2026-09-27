import assert from 'node:assert/strict';
import test from 'node:test';
import { hotelBenchmarkForEpci } from './hotelBasqueBenchmark.ts';

test('les baromètres Pays basque ne sont pas attribués au Béarn ni annualisés', () => {
  assert.equal(hotelBenchmarkForEpci('200067106').find((row) => row.month === '2025-08')?.occupancyPct, 90);
  assert.deepEqual(hotelBenchmarkForEpci('200067106').filter((row) => row.month.startsWith('2025-')).length, 8);
  assert.deepEqual(hotelBenchmarkForEpci('200067106').filter((row) => row.month === '2025-06'), []);
  assert.deepEqual(hotelBenchmarkForEpci('200067XXX'), []);
});
