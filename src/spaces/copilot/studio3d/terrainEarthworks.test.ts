import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateJarvisEarthworks } from './terrainEarthworks.ts';

const lon = 2.35, lat = 48.85;
const terrain = {
  provider: 'IGN_ALTI', renderBounds: [lon, lat, lon + .001, lat + .001] as [number, number, number, number],
  parcelBounds: [lon, lat, lon + .001, lat + .001] as [number, number, number, number],
  grid: { n: 3, z: [[0, 10, 20], [0, 10, 20], [0, 10, 20]] }, altitudeMin: 0, altitudeMax: 20, penteMoyenne: 0,
};

test('raising the entrance increases fill and reduces cut on a measured slope', () => {
  const center = { lon: lon + .0005, lat: lat + .0005, orientationDeg: 0 };
  const low = estimateJarvisEarthworks(terrain, { ...center, entryOffsetM: 0 }, 30, 14)!;
  const high = estimateJarvisEarthworks(terrain, { ...center, entryOffsetM: 2 }, 30, 14)!;
  assert.ok(low.cutM3 > 0 && low.fillM3 > 0);
  assert.ok(high.cutM3 < low.cutM3);
  assert.ok(high.fillM3 > low.fillM3);
  assert.equal(high.profile.length, 41);
});
