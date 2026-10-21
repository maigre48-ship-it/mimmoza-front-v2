import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAccessRoute, snapAccessToBoundary } from './accessRoutes.ts';
import type { TerrainParcel } from './parcelFromGps.ts';
import type { TerrainStudio } from '../../promoteur/shared/ouvrirStudio3D.ts';

const parcel: TerrainParcel = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
  [2, 48], [2.001, 48], [2.001, 48.001], [2, 48.001], [2, 48],
]] } };
const terrain: TerrainStudio = { provider: 'test', renderBounds: [2, 48, 2.001, 48.001], parcelBounds: [2, 48, 2.001, 48.001],
  grid: { n: 2, z: [[100, 100], [102, 102]] }, altitudeMin: 100, altitudeMax: 102, penteMoyenne: null };

test('snaps a gate to the outer cadastral boundary and computes its grade to the building', () => {
  const gate = snapAccessToBoundary(parcel, { lon: 2.0005, lat: 48.0001 });
  assert.ok(Math.abs(gate.lat - 48) < 1e-9);
  const route = calculateAccessRoute(parcel, terrain, { lon: 2.0005, lat: 48.0005 }, 20, 10, 0, 0,
    { kind: 'pieton', ...gate });
  assert.ok(route.lengthM > 45 && route.lengthM < 65);
  assert.ok(route.slopePercent > 0);
  assert.equal(route.insideParcel, true);
  assert.equal(route.profile[0]?.pathM, route.gateElevationM);
});
