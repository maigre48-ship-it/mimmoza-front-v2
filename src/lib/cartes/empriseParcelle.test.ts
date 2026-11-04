import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleSelection, doitRecadrer, empriseFeatures, empriseGeometrie, featuresASurligner, unionEmprises, versBoundsLeaflet,
} from './empriseParcelle.ts';

const carre = (lon: number, lat: number, d = 0.001) => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});
const proche = (a: Record<string, number> | null, b: Record<string, number>) => {
  assert.ok(a, 'emprise attendue');
  for (const k of Object.keys(b)) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k} : ${a[k]} ≠ ${b[k]}`);
};
const parcelle = (id: string, lon: number, lat: number) => ({ type: 'Feature', properties: { id }, geometry: carre(lon, lat) });

describe('empriseParcelle — emprise', () => {
  it('Polygon', () => {
    proche(empriseGeometrie(carre(4.8, 45.7)), { sud: 45.7, ouest: 4.8, nord: 45.701, est: 4.801 });
  });

  it('MultiPolygon et GeometryCollection', () => {
    const multi = { type: 'MultiPolygon', coordinates: [carre(2, 48).coordinates, carre(2.01, 48.02).coordinates] };
    proche(empriseGeometrie(multi), { sud: 48, ouest: 2, nord: 48.021, est: 2.011 });
    const gc = { type: 'GeometryCollection', geometries: [carre(1, 47), { type: 'Point', coordinates: [1.5, 47.5] }] };
    assert.deepEqual(empriseGeometrie(gc), { sud: 47, ouest: 1, nord: 47.5, est: 1.5 });
  });

  it('géométrie Lambert 93 (mètres), vide ou absente : null', () => {
    assert.equal(empriseGeometrie({ type: 'Polygon', coordinates: [[[842000, 6519000], [842100, 6519000], [842000, 6519100]]] }), null);
    assert.equal(empriseGeometrie({ type: 'Polygon', coordinates: [] }), null);
    assert.equal(empriseGeometrie(null), null);
    assert.equal(empriseGeometrie({ type: 'Polygon', coordinates: [[[Number.NaN, 45]]] }), null);
  });

  it('union de plusieurs parcelles (sélection multiple), invalides ignorées', () => {
    const e = empriseFeatures([parcelle('A', 4.8, 45.7), null, { geometry: null }, parcelle('B', 4.81, 45.69)]);
    proche(e, { sud: 45.69, ouest: 4.8, nord: 45.701, est: 4.811 });
    assert.equal(empriseFeatures([]), null);
    assert.equal(unionEmprises([null, null]), null);
  });

  it('format Leaflet [[sud, ouest], [nord, est]]', () => {
    assert.deepEqual(versBoundsLeaflet({ sud: 1, ouest: 2, nord: 3, est: 4 }), [[1, 2], [3, 4]]);
  });
});

describe('empriseParcelle — recadrage', () => {
  it('recadre seulement quand la parcelle cible change', () => {
    assert.equal(doitRecadrer('69123000AB0012', null), true);
    assert.equal(doitRecadrer('69123000AB0012', '69123000AB0012'), false);
    assert.equal(doitRecadrer('69123000AB0013', '69123000AB0012'), true);
    assert.equal(doitRecadrer(null, '69123000AB0012'), false);
    assert.equal(doitRecadrer('', null), false);
  });

  it('clé de sélection stable (ordre, doublons et vides indifférents)', () => {
    assert.equal(cleSelection(['B', 'A', 'B', null, '', undefined]), 'A,B');
    assert.equal(cleSelection([]), '');
  });
});

describe('empriseParcelle — features à surligner', () => {
  const idDe = (f: { properties?: unknown }) => (f.properties as { id?: string } | undefined)?.id ?? null;

  it('sélection + extras hors zone chargée, dédoublonnés', () => {
    const chargees = [parcelle('A', 4.8, 45.7), parcelle('B', 4.81, 45.7), parcelle('C', 4.82, 45.7)];
    const extra = parcelle('Z', 5, 45);
    const r = featuresASurligner(chargees, ['C', 'A', 'Z'], [extra, parcelle('A', 4.8, 45.7)], idDe);
    assert.deepEqual(r.map(idDe), ['A', 'C', 'Z']);
  });

  it('aucun identifiant : rien ; géométrie non WGS84 écartée', () => {
    assert.deepEqual(featuresASurligner([parcelle('A', 4.8, 45.7)], [null, ''], [], idDe), []);
    const lambert = { type: 'Feature', properties: { id: 'L' }, geometry: { type: 'Polygon', coordinates: [[[842000, 6519000], [842100, 6519100]]] } };
    assert.deepEqual(featuresASurligner([lambert], ['L'], [], idDe), []);
  });
});
