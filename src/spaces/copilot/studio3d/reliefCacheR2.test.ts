// R2 — relief : cache par parcelle, délai maximal, dédoublonnage, préchargement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleRelief, memoriserRelief, prechargerRelief, reliefAvecDelai, reliefEnCache, stockageMemoire, DUREE_VIE_RELIEF_MS } from './reliefCache.ts';

const terrain = { provider: 'ign-alti', renderBounds: [0, 0, 1, 1] as [number, number, number, number], parcelBounds: [0, 0, 1, 1] as [number, number, number, number],
  grid: { n: 2, z: [[1, 2], [3, 4]] }, altitudeMin: 1, altitudeMax: 4, penteMoyenne: null };
const p1 = [{ id: 'B', feature: {} }, { id: 'A', feature: {} }];
const p2 = [{ id: 'A', feature: {} }, { id: 'B', feature: {} }];
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('R2 clé de cache : la sélection compte, pas l’ordre des clics', () => {
  assert.equal(cleRelief(p1), cleRelief(p2));
  assert.notEqual(cleRelief(p1), cleRelief([{ id: 'A', feature: {} }]));
});

test('R2 cache : une parcelle déjà mesurée ne repart pas au réseau', async () => {
  const stockage = stockageMemoire();
  let appels = 0;
  const charger = async () => { appels += 1; return terrain; };
  const a = await reliefAvecDelai(p1, null, { stockage, charger });
  const b = await reliefAvecDelai(p2, null, { stockage, charger });
  assert.deepEqual([a.ok && a.source, b.ok && b.source, appels], ['mesure', 'cache', 1]);
});

test('R2 délai maximal : issue « délai » avec un message clair, la mesure continue et remplit le cache', async () => {
  const stockage = stockageMemoire();
  const charger = async () => { await attendre(60); return terrain; };
  const r = await reliefAvecDelai(p1, null, { stockage, charger, delaiMs: 10 });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.raison, 'delai'); assert.match(r.message, /n'a pas répondu/); }
  await attendre(80);
  assert.deepEqual(await reliefEnCache(p1, { stockage }), terrain);
  const relance = await reliefAvecDelai(p1, null, { stockage, charger, delaiMs: 10 });
  assert.equal(relance.ok && relance.source, 'cache');
});

test('R2 dédoublonnage : deux ouvertures simultanées, une seule mesure', async () => {
  const stockage = stockageMemoire();
  let appels = 0;
  const charger = async () => { appels += 1; await attendre(20); return terrain; };
  const [a, b] = await Promise.all([reliefAvecDelai(p1, null, { stockage, charger }), reliefAvecDelai(p2, null, { stockage, charger })]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(appels, 1);
});

test('R2 erreur du service : issue « erreur », jamais d’exception', async () => {
  const r = await reliefAvecDelai(p1, null, { stockage: stockageMemoire(), charger: async () => { throw new Error('Relief indisponible : quota IGN.'); } });
  assert.deepEqual(r, { ok: false, raison: 'erreur', message: 'quota IGN' });
});

test('R2 péremption et préchargement', async () => {
  const stockage = stockageMemoire();
  await memoriserRelief(p1, terrain, { stockage, maintenant: () => 0 });
  assert.equal(await reliefEnCache(p1, { stockage, maintenant: () => DUREE_VIE_RELIEF_MS + 1 }), null);
  const s2 = stockageMemoire();
  prechargerRelief(p1, null, { stockage: s2, charger: async () => terrain });
  await attendre(20);
  assert.equal(s2.taille(), 1);
});
