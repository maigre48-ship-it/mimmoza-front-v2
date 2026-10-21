import assert from 'node:assert/strict';
import test from 'node:test';
import { footprintFits, parcelBoundaryDistanceMeters, parcelContains, parcelId, pickNearbyParcels, type TerrainParcel } from './parcelFromGps.ts';

const parcel = (id: string, lon: number): TerrainParcel => ({
  type: 'Feature', properties: { idu: id, section: 'AB', numero: id.slice(-2) },
  geometry: { type: 'Polygon', coordinates: [[
    [lon, 48], [lon + .001, 48], [lon + .001, 48.001], [lon, 48.001], [lon, 48],
  ]] },
});

test('the GPS parcel leads the cadastral candidates and keeps its full reference for Studio', () => {
  const target = parcel('75107000AB0012', 2);
  const neighbours = [parcel('75107000AB0013', 2.002), target];
  const result = pickNearbyParcels(neighbours, { lat: 48.0005, lon: 2.0005 });
  assert.equal(result[0], target);
  assert.equal(parcelId(result[0]), '75107000AB0012');
});

test('a point in a cadastral hole is not treated as belonging to the parcel', () => {
  const target = parcel('test', 2);
  target.geometry.coordinates.push([[2.0003, 48.0003], [2.0007, 48.0003], [2.0007, 48.0007],
    [2.0003, 48.0007], [2.0003, 48.0003]]);
  assert.equal(parcelContains(target, { lon: 2.0005, lat: 48.0005 }), false);
  assert.equal(parcelContains(target, { lon: 2.0001, lat: 48.0001 }), true);
});

test('GPS to nearest cadastral boundary is measured from line segments in metres', () => {
  const target = parcel('test', 2);
  const distance = parcelBoundaryDistanceMeters(target, { lon: 2.0005, lat: 48.0005 });
  assert.ok(distance > 35 && distance < 39);
  assert.equal(parcelBoundaryDistanceMeters(target, { lon: 2, lat: 48 }), 0);
});

test('the rotated footprint must fit inside the parcel including its holes', () => {
  const target = parcel('test', 2);
  const center = { lon: 2.0005, lat: 48.0005 };
  assert.equal(footprintFits(target, center, 30, 14, 35), true);
  assert.equal(footprintFits(target, { lon: 2.00005, lat: 48.0005 }, 30, 14, 0), false);
  target.geometry.coordinates.push([[2.00045, 48.00045], [2.00055, 48.00045], [2.00055, 48.00055],
    [2.00045, 48.00055], [2.00045, 48.00045]]);
  assert.equal(footprintFits(target, center, 30, 14, 0), false);
});
