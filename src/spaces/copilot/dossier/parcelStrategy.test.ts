import assert from 'node:assert/strict';
import test from 'node:test';
import { buildParcelStrategyPrompt } from './parcelStrategy.ts';
import type { ParcelDossier } from './parcelDossier.ts';

const dossier = {
  address: '32 chemin de Behereko Errota, Ascain', zone: 'UC',
  prescriptions: ['Indice I de la zone inondable'], servitudes: [],
} as ParcelDossier;

test('stratégie : marché et cession fondés sur le périmètre choisi, sans constructibilité présumée', () => {
  const prompt = buildParcelStrategyPrompt(dossier, [
    { id: '64065000AI0001', areaM2: 66 },
    { id: '64065000AI0002', areaM2: 2283 },
  ]);
  assert.ok(prompt);
  assert.match(prompt, /64065000AI0001, 64065000AI0002/);
  assert.match(prompt, /2349 m²/);
  assert.match(prompt, /get_etude_marche/);
  assert.match(prompt, /parcel_id égal à 64065000AI0002/);
  assert.match(prompt, /PPRI/);
  assert.match(prompt, /profils de contreparties/);
  assert.match(prompt, /aucun acheteur réel ni contact ne doit être inventé/);
  assert.match(prompt, /ne prouve ni la propriété/);
});

test('stratégie indisponible sans parcelles choisies', () => {
  assert.equal(buildParcelStrategyPrompt(dossier, []), null);
});
