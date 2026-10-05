import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuEvidenceSummary, GPU_EVIDENCE_WARNING } from './urbanism.ts';
test('une consultation de prescriptions ne fabrique pas une absence de zonage', () => {
  const text = gpuEvidenceSummary({nb_prescriptions:0, nb_informations:4}, 'prescriptions');
  assert.match(text,/0 prescription\(s\) et 4 information/);
  assert.doesNotMatch(text,/Aucun zonage|constructible sous|commune LITTORALE/);
});
test('un secteur SPR/SS ne produit ni constructibilité ni régime juridique automatique', () => {
  const text = gpuEvidenceSummary({nb_zones:2, zone_principale:'SPR'},'zonage');
  assert.match(text,/2 zone/); assert.match(text,/restent à vérifier/);
  assert.match(GPU_EVIDENCE_WARNING,/règlement écrit n’a pas été lu/);
});
