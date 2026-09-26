import assert from 'node:assert/strict';
import test from 'node:test';
import { buildParcelStrategyPrompt, programmeBrief } from './parcelStrategy.ts';
import type { ParcelDossier } from './parcelDossier.ts';

const dossier = {
  address: '32 chemin de Behereko Errota, Ascain', zone: 'UC',
  prescriptions: ['Indice I de la zone inondable'], servitudes: [],
} as ParcelDossier;

test('stratégie : marché et cession fondés sur le périmètre choisi, sans constructibilité présumée', () => {
  const prompt = buildParcelStrategyPrompt(dossier, [
    { id: '64065000AI0001', areaM2: 66 },
    { id: '64065000AI0002', areaM2: 2283 },
  ], 'Logements');
  assert.ok(prompt);
  assert.match(prompt, /64065000AI0001, 64065000AI0002/);
  assert.match(prompt, /2349 m²/);
  assert.match(prompt, /get_etude_marche/);
  assert.match(prompt, /project_type=logement/);
  assert.match(prompt, /parcel_id=64065000AI0002/);
  assert.match(prompt, /PPRI/);
  assert.match(prompt, /profils d.exploitants et d.acquéreurs/);
  assert.match(prompt, /aucun acheteur réel ni contact ne doit être inventé/);
  assert.match(prompt, /ne prouve ni la propriété/);
});

test('stratégie indisponible sans parcelles choisies', () => {
  assert.equal(buildParcelStrategyPrompt(dossier, []), null);
});

test('un hôtel reçoit ses métriques propres et un score explicitement limité', () => {
  const brief = programmeBrief('Hôtel 4 étoiles');
  assert.equal(brief?.marketType, 'hotel');
  assert.match(brief?.criticalData ?? '', /ADR\/RevPAR/);
  const prompt = buildParcelStrategyPrompt(dossier, [{ id: '64065000AI0002', areaM2: 2283 }], 'Hôtel');
  assert.match(prompt ?? '', /project_type=hotel/);
  assert.match(prompt ?? '', /section_naf=I/);
  assert.match(prompt ?? '', /code_naf=55.10Z/);
  assert.match(prompt ?? '', /couleurs/);
});

test('clinique et programme libre ne reçoivent pas un faux score de logement', () => {
  for (const intent of ['Clinique', 'Centre de formation']) {
    const prompt = buildParcelStrategyPrompt(dossier, [{ id: '64065000AI0002', areaM2: 2283 }], intent);
    assert.match(prompt ?? '', /Aucun modèle de marché adapté/);
    assert.doesNotMatch(prompt ?? '', /project_type=logement/);
  }
  assert.equal(programmeBrief('Clinique')?.sectionNaf, 'Q');
  assert.match(buildParcelStrategyPrompt(dossier, [{ id: '64065000AI0002', areaM2: 2283 }], 'Clinique') ?? '', /code_naf=86.10Z/);
});

test('supermarché utilise seulement le contexte commerce, sans prétendre mesurer la chalandise', () => {
  const prompt = buildParcelStrategyPrompt(dossier, [{ id: '64065000AI0002', areaM2: 2283 }], 'Supermarché');
  assert.match(prompt ?? '', /project_type=commerce/);
  assert.match(prompt ?? '', /pas une étude de chalandise/);
  assert.match(prompt ?? '', /code_naf=47.11D/);
});

test('sans programme choisi, aucun modèle logement par défaut ne classe les usages', () => {
  const prompt = buildParcelStrategyPrompt(dossier, [{ id: '64065000AI0002', areaM2: 2283 }]);
  assert.match(prompt ?? '', /Aucun programme n’est encore choisi/);
  assert.doesNotMatch(prompt ?? '', /project_type=logement/);
});

test('une résidence senior autonome n’est pas classée en EHPAD', () => {
  assert.equal(programmeBrief('Résidence senior')?.marketType, null);
  assert.equal(programmeBrief('Résidence senior')?.operatorNaf, null);
});
