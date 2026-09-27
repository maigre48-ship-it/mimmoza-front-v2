import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceKm, selectBasinCommunes } from './hotelBasin.ts';

test('le bassin choisit les centres communaux proches et limite les appels', () => {
  const communes = [
    { code: '64065', nom: 'Ascain', centre: { coordinates: [-1.6283, 43.3383] } },
    { code: '64483', nom: 'Saint-Jean-de-Luz', centre: { coordinates: [-1.663, 43.388] } },
    { code: 'loin', nom: 'Commune éloignée', centre: { coordinates: [0, 45] } },
    { code: 'sans', nom: 'Sans centre' },
  ];
  const result = selectBasinCommunes(communes, '64065', 15, 2);
  assert.deepEqual(result.map((item) => item.code), ['64065', '64483']);
  assert.equal(result[0].distanceKm, 0);
  assert.ok(result[1].distanceKm > 5 && result[1].distanceKm < 8);
  assert.deepEqual(selectBasinCommunes(communes, 'inconnu'), []);
  assert.equal(distanceKm(-1.6283, 43.3383, -1.6283, 43.3383), 0);
});
