// R2 — composition multi-bâtiments générale (N bâtiments), intention « génère la 3D », parcelle retenue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarvisMassing, studioComposition, type JarvisDraft } from './jarvisDraft.ts';
import { demandePrevisualisation } from './intentionPrevisualisation.ts';
import { parcelleRetenue, retenirParcelle } from './parcelleConfirmee.ts';

const fiche = (objectif: string): JarvisDraft => ({ version: 1, objectif, localisation: 'Bayonne', programme: null, dimensions: null, style: null, contraintes: null, questions: [], pieces: [] });

test('R2 quatre bâtiments A à D : quatre commandes, centres rangés et séparés', () => {
  const f = fiche('Bâtiment A R+5 de 30 m sur 14 m, bâtiment B R+3 de 20 m sur 12 m, bâtiment C R+2 de 18 m sur 10 m et bâtiment D R+1 de 12 m sur 10 m, séparés de 10 m.');
  const c = studioComposition(f);
  assert.ok(c);
  assert.deepEqual(c!.map((b) => b.name), ['Bâtiment A', 'Bâtiment B', 'Bâtiment C', 'Bâtiment D']);
  assert.ok(c!.every((b) => /^Crée /.test(b.commande)));
  // Profondeurs 14, 12, 10, 10 + 3 × 10 m = 76 m, centrés sur 0.
  assert.deepEqual(c!.map((b) => b.centreZ), [-31, -8, 13, 33]);
  assert.equal(jarvisMassing(f)?.buildings?.length, 4);
});

test('R2 deux bâtiments : mêmes centres qu’avant la généralisation', () => {
  const c = studioComposition(fiche('Bâtiment A R+5 de 30 m sur 14 m et bâtiment B R+3 de 20 m sur 12 m, séparés de 12 m.'));
  // Ancien calcul : total = 14 + 12 + 12 = 38 ; A = -19 + 7 = -12 ; B = 19 - 6 = 13.
  assert.deepEqual(c!.map((b) => b.centreZ), [-12, 13]);
});

test('R2 lettres en double : pas de composition devinée', () => {
  assert.equal(studioComposition(fiche('Bâtiment A R+5 de 30 m sur 14 m et bâtiment A R+3 de 20 m sur 12 m.')), null);
});

test('R2 « génère la 3D » et ses variantes ouvrent Studio ; le reste part au modèle', () => {
  for (const t of ['Génère la 3D', 'génère la 3d stp', 'Je veux voir en 3D', 'passe en 3D', 'montre-moi la maquette 3D', 'Génère la prévisualisation', 'ouvre studio', 'ouvre Mimmoza Studio'])
    assert.equal(demandePrevisualisation(t), true, t);
  for (const t of ['Quel est le prix au m² à Bayonne ?', 'Qu’est-ce que la 3D ?', 'comment fonctionne Studio ?', 'studio à louer à Bayonne', 'Analyse cette parcelle'])
    assert.equal(demandePrevisualisation(t), false, t);
});

test('R2 parcelle confirmée retenue par conversation (sans la photo ni le relief)', () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  const parcel = { type: 'Feature' as const, properties: { idu: 'X1' }, geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  assert.equal(retenirParcelle('c1', { parcel, point: { lat: 1, lon: 2 }, adresse: '1 rue A', terrainData: undefined }, st), true);
  const r = parcelleRetenue('c1', st);
  assert.equal(r?.parcel.properties.idu, 'X1');
  assert.equal(r?.adresse, '1 rue A');
  assert.equal(parcelleRetenue('c2', st), null);
});
