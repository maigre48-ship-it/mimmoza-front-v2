import assert from 'node:assert/strict';
import test from 'node:test';
import { buildParcelDossier } from './parcelDossier.ts';

const toolCalls = [
  { id: 'resolve', name: 'get_parcelle_depuis_adresse', status: 'success', output: { data: {
    adresse: { libelle: '32 chemin de Behereko Errota, Ascain', lat: 43.348434, lon: -1.621429 },
    parcelle: { idu: '64065000AI0001', contenance_m2: 66, code_insee: '64065' },
  } } },
  { id: 'study', name: 'get_etude_parcelle', status: 'success', output: { data: {
    parcelle: { idu: '64065000AI0001', code_insee: '64065', surface_m2: 66 },
    urbanisme_point: { couches: [
      { couche: 'zone-urba', statut: 'interrogee', elements: [{ libelle: 'UC' }] },
      { couche: 'prescription-surf', statut: 'interrogee', elements: [{ libelle: 'Indice I de la zone inondable' }] },
      { couche: 'assiette-sup-s', statut: 'interrogee', elements: [{ nom: 'PPRI Ascain' }] },
    ] },
    evidences: [
      { id: 'risque_ppr', label: 'PPR communal', value: 0, status: 'confirmed', scope: 'municipality', source: 'Géorisques' },
      { id: 'fiscalite_tfb', label: 'Taux TFB', value: 31.75, status: 'confirmed', scope: 'municipality', source: 'DGFiP', sourceDate: '2025' },
    ],
    avertissements: [], plan_action: [],
  } } },
];

test('dossier Ascain : point, preuves, conflit PPRI et périmètre explicite', () => {
  const dossier = buildParcelDossier(toolCalls, '2026-09-26T00:00:00Z');
  assert.ok(dossier);
  assert.equal(dossier.detectedParcel?.areaM2, 66);
  assert.equal(dossier.zone, 'UC');
  assert.deepEqual(dossier.servitudes, ['PPRI Ascain']);
  assert.equal(dossier.taxRate, 31.75);
  assert.ok(dossier.warnings.some((warning) => warning.includes('ne prouve pas le périmètre')));
  assert.ok(dossier.warnings.some((warning) => warning.includes('Sources à confronter')));
});

test('aucun dossier décisionnel sans preuves structurées', () => {
  assert.equal(buildParcelDossier([{ id: 'x', name: 'get_etude_parcelle', status: 'error', output: { data: { evidences: [] } } }], '2026-09-26'), null);
});
