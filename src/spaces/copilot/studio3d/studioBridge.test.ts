import assert from 'node:assert/strict';
import test from 'node:test';
import { readStudioVolumeMessage } from './studioBridge.ts';

const valid = { type: 'mzia-studio-volume-v1', bridgeSessionId: crypto.randomUUID(),
  conversationId: crypto.randomUUID(), updatedAt: new Date().toISOString(), segments: [
    { name: 'Base', largeurM: 30, profondeurM: 14, niveaux: 3, fromLevelIndex: 0, retraitM: 0, x: 0, z: 0 },
    { name: 'Retrait', largeurM: 8, profondeurM: 12, niveaux: 6, fromLevelIndex: 3, retraitM: 2, x: 0, z: 1 },
  ] };

test('lit les portions renvoyées par Studio avec leurs plages de niveaux', () => {
  assert.equal(readStudioVolumeMessage(valid)?.segments[1]?.fromLevelIndex, 3);
  assert.equal(readStudioVolumeMessage({ ...valid, segments: [{ ...valid.segments[0], niveaux: 1, fromLevelIndex: 3 }, valid.segments[1]] }), null);
  assert.equal(readStudioVolumeMessage({ ...valid, segments: [...valid.segments, { ...valid.segments[1], x: Infinity }] }), null);
});

test('lit plusieurs bâtiments et rejette un volume malformé', () => {
  const first = { name: 'A', largeurM: 30, profondeurM: 14, niveaux: 6, segments: valid.segments };
  const second = { name: 'B', largeurM: 18, profondeurM: 12, niveaux: 4, segments: [valid.segments[0]] };
  assert.equal(readStudioVolumeMessage({ ...valid, buildings: [first, second] })?.buildings?.[1]?.name, 'B');
  assert.equal(readStudioVolumeMessage({ ...valid, buildings: [first, { ...second, niveaux: 0 }] }), null);
});
