import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAnchors, noiseProperties, searchPolygon, validGeometry } from './thematicMapModel';
import type { ActiveToolCall } from '../types/copilot.types';
const call = (data: unknown, status = 'success', input?: unknown): ActiveToolCall => ({ id:'x', name:'get_etude_parcelle', status, output:{ status:'ok', data }, input });
test('les coordonnées proposées par IA et les erreurs ne centrent pas la carte', () => {
  assert.deepEqual(mapAnchors([call({}, 'success', {lat:43, lng:-1})]), []);
  assert.deepEqual(mapAnchors([call({adresse:{lat:43,lon:-1}}, 'error')]), []);
  assert.deepEqual(mapAnchors([call({adresse:{lat:999,lon:-1}})]), []);
});
test('le centre communal est distinct et les points sont dédoublonnés', () => {
  const a = mapAnchors([call({parcelle:{lat:43,lon:-1}, precision:'centre_commune'}), call({adresse:{lat:43,lon:-1}})]);
  assert.equal(a.length,1); assert.match(a[0].precision,/Centre de commune/);
});
test('les secteurs sonores sont filtrés sans assimiler toutes les prescriptions à du bruit', () => {
  assert.equal(noiseProperties({libelle:'secteur affecté par le bruit'}), true);
  assert.equal(noiseProperties({libelle:'espace boisé classé'}), false);
});
test('le périmètre IGN est un polygone fermé en longitude latitude', () => {
  const ring = searchPolygon({lat:43,lon:-1,label:'x',precision:'point'},1000).coordinates[0];
  assert.deepEqual(ring[0], ring[4]); assert.ok(ring[0][0] < -1); assert.ok(ring[0][1] < 43); assert.ok(ring[2][0] > -1); assert.ok(ring[2][1] > 43);
});
test('un géocodage limité à la commune ou à la voie ne devient pas une adresse précise', () => {
  assert.match(mapAnchors([call({adresse:{lat:43,lon:-1,precision:'municipality'}})])[0].precision,/Centre de commune/);
  assert.match(mapAnchors([call({adresse:{lat:43,lon:-1,precision:'street'}})])[0].precision,/numéro non confirmé/);
});
test('géométries non localisées ou dans une autre projection rejetées', () => {
  assert.equal(validGeometry({type:'Point',coordinates:[-1,43]}),true);
  assert.equal(validGeometry({type:'Point',coordinates:[650000,6200000]}),false);
  assert.equal(validGeometry({type:'Polygon',coordinates:[]}),false);
  assert.equal(validGeometry({type:'Point',coordinates:[NaN,43]}),false);
});
