import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedArea, taxScenarios, decisionStatus } from './dossierCalculations.ts';
import type { ParcelDossier } from './parcelDossier.ts';

const dossier: ParcelDossier = {
  address: '32 chemin de Behereko Errota, Ascain', point: { lat: 43.348434, lon: -1.621429 },
  insee: '64065', detectedParcel: { id: '64065000AI0001', areaM2: 66 },
  zone: 'UC', prescriptions: ['Indice I de la zone inondable'], servitudes: ['PPRI Ascain'],
  taxRate: 31.75, taxYear: '2025', evidences: [], warnings: [], action: null,
  sourceDate: '2026-09-26T00:00:00Z',
};

test('la superficie retenue n’inclut que les parcelles confirmées', () => {
  assert.equal(selectedArea([]), null);
  assert.equal(selectedArea([{ id: 'A', areaM2: 66 }, { id: 'B', areaM2: 800 }]), 866);
  assert.equal(selectedArea([{ id: 'A', areaM2: null }]), null);
});

test('la simulation fiscale expose ses hypothèses et suit la surface saisie', () => {
  assert.deepEqual(taxScenarios(null, 100, 31.75).map((s) => Math.round(s.builtTax)), [1270, 1905, 2540]);
  assert.deepEqual(taxScenarios(100, 100, 31.75).map((s) => s.surfaceM2), [80, 100, 120]);
  assert.equal(taxScenarios(100, 100, null).length, 0);
});

test('une parcelle détectée seule ne déclenche pas de verdict de faisabilité', () => {
  assert.equal(decisionStatus(dossier, []).label, 'Périmètre à confirmer');
  assert.equal(decisionStatus(dossier, [{ id: '64065000AI0001', areaM2: 66 }]).label, 'Contrainte d’inondation à instruire');
});
