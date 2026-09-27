import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOperatingModel, emptyOperatingInputs } from './operatingModel.ts';

test('calcule recettes, charges et seuil de remplissage sans inventer de données', () => {
  const result = calculateOperatingModel('10', {
    ...emptyOperatingInputs(), period: 'mois', unitRevenue: '1000', occupancyPct: '80',
    prudentOccupancyPct: '60', prudentPriceCutPct: '10', ancillaryRevenueYear: '0',
    variableCostPerUnit: '100', fixedCostsYear: '30000', maintenanceYear: '6000',
  });
  assert.equal(result?.central.revenue, 96000);
  assert.equal(result?.central.operatingSurplus, 50400);
  assert.equal(result?.prudent.revenue, 64800);
  assert.equal(result?.prudent.operatingSurplus, 21600);
  assert.equal(result?.breakEvenOccupancyPct, 37.5);
});

test('rejette les taux incohérents et les champs manquants', () => {
  assert.equal(calculateOperatingModel('10', emptyOperatingInputs()), null);
  const valid = { ...emptyOperatingInputs(), unitRevenue: '100', occupancyPct: '50', prudentOccupancyPct: '60', prudentPriceCutPct: '0', ancillaryRevenueYear: '0', variableCostPerUnit: '0', fixedCostsYear: '0', maintenanceYear: '0' };
  assert.equal(calculateOperatingModel('10', valid), null);
});
