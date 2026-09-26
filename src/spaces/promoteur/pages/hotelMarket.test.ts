import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateHotelEconomics, parseHotelCapacity, parseHotelMonths } from './hotelMarket.ts';

test('offre hôtelière : sépare établissements, chambres et classement', () => {
  const rows = [
    { dimensions: { ACTIVITY: 'I551', L_STAY: '_T', FREQ: 'A', UNIT_LOC_RANKING: '_T', TOUR_MEASURE: 'UNIT_LOC' }, measures: { OBS_VALUE_NIVEAU: { value: 6 } } },
    { dimensions: { ACTIVITY: 'I551', L_STAY: '_T', FREQ: 'A', UNIT_LOC_RANKING: '_T', TOUR_MEASURE: 'PLACE' }, measures: { OBS_VALUE_NIVEAU: { value: 116 } } },
    { dimensions: { ACTIVITY: 'I551', L_STAY: '_T', FREQ: 'A', UNIT_LOC_RANKING: '3', TOUR_MEASURE: 'UNIT_LOC' }, measures: { OBS_VALUE_NIVEAU: { value: 2 } } },
  ];
  const parsed = parseHotelCapacity(rows);
  assert.deepEqual(parsed[0], { ranking: '_T', hotels: 6, rooms: 116 });
  assert.deepEqual(parsed.find((row) => row.ranking === '3'), { ranking: '3', hotels: 2, rooms: null });
});

test('nuitées : applique le multiplicateur INSEE, sans inventer les mois absents', () => {
  const rows = [
    { dimensions: { ACTIVITY: 'I551', FREQ: 'M', TOUR_RESID: '_T', UNIT_LOC_RANKING: '_T', TIME_PERIOD: '2025-01', TOUR_MEASURE: 'NIGHT_SPENT' }, attributes: { UNIT_MULT: '3' }, measures: { OBS_VALUE_NIVEAU: { value: 117.78 } } },
    { dimensions: { ACTIVITY: 'I551', FREQ: 'M', TOUR_RESID: '_T', UNIT_LOC_RANKING: '_T', TIME_PERIOD: '2025-01', TOUR_MEASURE: 'PLACE_OCCUPANCY_RATE', UNIT_MEASURE: 'PT' }, measures: { OBS_VALUE_NIVEAU: { value: 41.4 } } },
  ];
  const parsed = parseHotelMonths(rows, 2025);
  assert.equal(parsed[0].nights, 117780);
  assert.equal(parsed[0].occupancyPct, 41.4);
  assert.equal(parsed[1].nights, null);
});

test('modèle hôtelier : impossible sans prix et coûts explicites', () => {
  assert.equal(calculateHotelEconomics({ rooms: '30', adr: '', occupancy: '65', variableCost: '40', fixedCosts: '400000', investment: '' }), null);
  const result = calculateHotelEconomics({ rooms: '30', adr: '150', occupancy: '60', variableCost: '40', fixedCosts: '400000', investment: '5000000' });
  assert.ok(result);
  assert.equal(result.revenue, 985500);
  assert.equal(result.operatingResult, 322700);
  assert.ok((result.breakEvenOccupancy ?? 0) > 33 && (result.breakEvenOccupancy ?? 0) < 34);
});
