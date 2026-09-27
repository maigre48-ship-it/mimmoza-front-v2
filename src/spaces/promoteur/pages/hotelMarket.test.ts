import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateHotelEconomics, parseHotelAnnual, parseHotelCapacity, parseHotelMonths, parseRegionalHotelDemand } from './hotelMarket.ts';
import { hotelTerritorialSignals } from './hotelTerritorialSignals.ts';

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

test('bilan annuel : lit les nuitées et la part de clientèle non résidente sans les confondre', () => {
  const rows = [
    { dimensions: { ACTIVITY: 'I551', FREQ: 'A', TOUR_MEASURE: 'NIGHT_SPENT', TOUR_RESID: '_T' }, attributes: { UNIT_MULT: '3' }, measures: { OBS_VALUE_NIVEAU: { value: 2790 } } },
    { dimensions: { ACTIVITY: 'I551', FREQ: 'A', TOUR_MEASURE: 'PT_NIGHTSPENT_NON_RESIDENT' }, attributes: { UNIT_MULT: '0' }, measures: { OBS_VALUE_NIVEAU: { value: 21.9 } } },
  ];
  assert.deepEqual(parseHotelAnnual(rows), { nights: 2790000, nonResidentSharePct: 21.9 });
});

test('ventilation régionale : ignore le sous-total classé et respecte géographie, année et unité', () => {
  const row = (ranking: string, value: number, geo = '2026-REG-75', unit = '3') => ({ dimensions: { ACTIVITY: 'I551', FREQ: 'A', TIME_PERIOD: '2025', TOUR_RESID: '_T', TOUR_MEASURE: 'NIGHT_SPENT', GEO: geo, UNIT_LOC_RANKING: ranking }, attributes: { UNIT_MULT: unit }, measures: { OBS_VALUE_NIVEAU: { value } } });
  const parsed = parseRegionalHotelDemand([row('_T', 100), row('C', 85), row('NC', 15), row('1T2', 20), row('3', 40), row('4T5', 25), row('_T', 999, 'REG-84')], '75', 2025, 'https://example.test');
  assert.equal(parsed?.totalNights, 100000);
  assert.deepEqual(parsed?.rankings.map((item) => item.nights), [15000, 20000, 40000, 25000]);
  assert.equal(parseRegionalHotelDemand([row('_T', 100, 'REG-75', '0')], '75', 2025, 'https://example.test'), null);
});

test('observatoires territoriaux : une donnée départementale ne fuit pas vers une autre région', () => {
  assert.equal(hotelTerritorialSignals('84', '69')[0].value, '28 %');
  assert.equal(hotelTerritorialSignals('75', '69').length, 0);
  assert.equal(hotelTerritorialSignals('53', '35')[0].perimeter, 'Bretagne');
});

test('Paris et la Côte d’Azur gardent leur périmètre et leur période propres', () => {
  const paris = hotelTerritorialSignals('11', '75', '75056');
  assert.equal(paris[1].value, '80,9 %');
  assert.equal(paris[1].period, 'juillet–août 2026');
  assert.equal(hotelTerritorialSignals('11', '92', '92012').length, 1);
  const nice = hotelTerritorialSignals('93', '06', '06088');
  assert.equal(nice[2].perimeter, 'Destination Alpes-Maritimes et Monaco');
  assert.equal(nice[3].period, 'juin–septembre 2025');
  assert.equal(nice[1].value, '157 €');
  assert.equal(hotelTerritorialSignals('93', '13', '13055').length, 2);
});

test('les signaux internationaux gardent leur dénominateur', () => {
  assert.match(hotelTerritorialSignals('44', '67')[0].implication, /nuitées étrangères/);
  assert.match(hotelTerritorialSignals('75', '64')[0].implication, /ne mesure pas l’occupation/);
  assert.equal(hotelTerritorialSignals('76', '31')[0].label, 'Nuitées d’affaires');
});

test('les dix régions ajoutées ont une source et respectent leur département', () => {
  const territories = [
    ['24', '37'], ['27', '21'], ['32', '59'], ['52', '44'], ['94', '2A'],
    ['01', '971'], ['02', '972'], ['03', '973'], ['04', '974'], ['06', '976'],
  ];
  for (const [region, department] of territories) {
    const signals = hotelTerritorialSignals(region, department);
    assert.ok(signals.length > 0, `Aucun signal pour ${region}`);
    assert.ok(signals.every((signal) => signal.year === 2025 && signal.sourceUrl.startsWith('https://www.insee.fr/')));
    assert.equal(hotelTerritorialSignals(region, '69').length, 0);
  }
  assert.equal(hotelTerritorialSignals('94', '2B').length, 2);
  assert.equal(hotelTerritorialSignals('04', '976').length, 0);
});

test('les séries ultramarines affichent clairement leur période et leur champ', () => {
  const guyane = hotelTerritorialSignals('03', '973');
  assert.equal(guyane[0].period, 'octobre–décembre 2025');
  assert.match(guyane[0].implication, /seul quatrième trimestre/);
  const reunion = hotelTerritorialSignals('04', '974');
  assert.match(reunion[0].label, /autres hébergements collectifs/);
  const mayotte = hotelTerritorialSignals('06', '976');
  assert.equal(mayotte[0].period, 'février–décembre 2025');
  assert.match(mayotte[1].implication, /Chido/);
});
