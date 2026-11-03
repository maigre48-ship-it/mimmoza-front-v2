import assert from 'node:assert/strict';
import test from 'node:test';
import { adresseDepuisReponse, lienGeoportail, pointDansParcelle, terrainDepuisParcelle, urlAdresseInverse } from './confirmationRapide.ts';
import { parcelContains, type TerrainParcel } from './parcelFromGps.ts';

const carre: TerrainParcel = { type: 'Feature', properties: { idu: '92050000AN0412' },
  geometry: { type: 'Polygon', coordinates: [[[2.2, 48.89], [2.201, 48.89], [2.201, 48.891], [2.2, 48.891], [2.2, 48.89]]] } };
// Parcelle en L : la moyenne des sommets tombe hors de la parcelle.
const enL: TerrainParcel = { type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 1], [1, 1], [1, 10], [0, 10], [0, 0]]] } };

test('point dans une parcelle simple = son centre', () => {
  const p = pointDansParcelle(carre);
  assert.ok(Math.abs(p.lon - 2.2005) < 1e-9 && Math.abs(p.lat - 48.8905) < 1e-9);
});

test('parcelle en L : le point rendu est DANS la parcelle', () => {
  assert.ok(parcelContains(enL, pointDansParcelle(enL)));
});

test('adresse BAN : libellé lu, réponse vide -> null', () => {
  assert.equal(adresseDepuisReponse({ features: [{ properties: { label: '12 Rue X 92000 Nanterre' } }] }), '12 Rue X 92000 Nanterre');
  assert.equal(adresseDepuisReponse({ features: [] }), null);
  assert.equal(adresseDepuisReponse(null), null);
  assert.equal(adresseDepuisReponse({ features: [{ properties: { label: '  ' } }] }), null);
});

test('URL inverse et lien Géoportail contiennent le point', () => {
  assert.match(urlAdresseInverse({ lon: 2.2, lat: 48.89 }), /reverse\/\?lon=2\.2000000&lat=48\.8900000&limit=1$/);
  assert.match(lienGeoportail({ lon: 2.2, lat: 48.89 }), /c=2\.200000,48\.890000&z=19/);
});

test('terrain confirmé : IDU affiché imposé, point et adresse repris', () => {
  const t = terrainDepuisParcelle({ ...carre, properties: {} }, '92050000AN0412', { lon: 2.2, lat: 48.89 }, null);
  assert.equal(t.parcel.properties.idu, '92050000AN0412');
  assert.deepEqual(t.point, { lon: 2.2, lat: 48.89 });
  assert.equal(t.adresse, null);
});
