// deno test supabase/functions/_shared/documents/gpuReglement.test.ts — parsing pur sur FIXTURES.
// Les fixtures (dossier fixtures/) sont FICTIVES (commune « TESTVILLE », INSEE 12345) : elles
// reproduisent la FORME documentée des réponses API Carto (module GPU) et API GPU
// (/api/document/<id>/details), les API n'étant pas joignables depuis l'environnement de test.
import * as na from 'node:assert/strict';
import {
  choisirDocumentPartition, choisirFichiersReglement, cheminCacheGpu, cleCacheGpu, cleCacheStockage, dateDepuisIdurba,
  dateGpu, libelleSource, lireDetailsDocument, lireDocumentsAuPoint, lireZonesAuPoint, urlApiCarto, urlDetailsDocument,
  urlDocumentsPartition,
} from './gpuReglement.ts';

const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const fixture = (nom: string) => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${nom}`, import.meta.url)));

Deno.test('URLs : point GeoJSON en lon/lat, id encodé', () => {
  assertEquals(urlApiCarto('zone-urba', -1.5, 43.48),
    'https://apicarto.ign.fr/api/gpu/zone-urba?geom=%7B%22type%22%3A%22Point%22%2C%22coordinates%22%3A%5B-1.5%2C43.48%5D%7D');
  assertEquals(urlDetailsDocument('abc/def'), 'https://www.geoportail-urbanisme.gouv.fr/api/document/abc%2Fdef/details');
  assertEquals(urlDocumentsPartition('DU_12345'), 'https://www.geoportail-urbanisme.gouv.fr/api/document?partition=DU_12345&status=document.production');
});

Deno.test('dates GPU', () => {
  assertEquals(dateGpu('20230615'), '2023-06-15');
  assertEquals(dateGpu('2023-07-03T10:12:45+02:00'), '2023-07-03');
  assertEquals(dateGpu('20231340'), null);
  assertEquals(dateGpu(''), null);
  assertEquals(dateDepuisIdurba('12345_PLU_20230615'), '2023-06-15');
  assertEquals(dateDepuisIdurba('200012345_PLUI_20190101_A'), '2019-01-01');
  assertEquals(dateDepuisIdurba(null), null);
});

Deno.test('couche document au point (API Carto)', () => {
  const docs = lireDocumentsAuPoint(fixture('apicarto-document.json'));
  assertEquals(docs, [{ id: '5f1c2a3b4d5e6f708192a3b4c5d6e7f8', partition: 'DU_12345', idurba: '12345_PLU_20230615', du_type: 'PLU', territoire: 'TESTVILLE' }]);
  const avecPsmv = lireDocumentsAuPoint({ features: [
    { properties: { id: 'plu000000001', du_type: 'PLU' } },
    { properties: { id: 'psmv00000001', du_type: 'PSMV' } },
    { properties: { id: '../../etc', du_type: 'PLU' } },
  ] });
  assertEquals(avecPsmv.map((d) => d.id), ['psmv00000001', 'plu000000001'], 'PSMV en premier, id douteux rejeté');
  assertEquals(lireDocumentsAuPoint({}), []);
});

Deno.test('zone au point (API Carto zone-urba)', () => {
  const [z] = lireZonesAuPoint(fixture('apicarto-zone-urba.json'));
  assertEquals(z.zone, 'UCa');
  assertEquals(z.type_zone, 'U');
  assertEquals(z.fichier, '12345_reglement_20230615.pdf');
  assertEquals(z.url_fichier, null, 'urlfic vide → null');
  assertEquals(z.date_approbation, '2023-06-15');
});

Deno.test('détails du document : pièces écrites PDF, formes tolérées', () => {
  const d = lireDetailsDocument(fixture('gpu-details.json'));
  assertEquals(d.id, '5f1c2a3b4d5e6f708192a3b4c5d6e7f8');
  assertEquals(d.protege, false);
  assertEquals(d.pieces.length, 5);
  assertEquals(d.date_mise_en_ligne, '2023-07-03');
  const tableau = lireDetailsDocument({ writingMaterials: [{ name: 'reglement.pdf', url: 'https://x.fr/reglement.pdf' }, { name: 'piege', url: 'http://x.fr/a.pdf' }, { title: 'zip', url: 'https://x.fr/a.zip' }] });
  assertEquals(tableau.pieces, [{ nom: 'reglement.pdf', url: 'https://x.fr/reglement.pdf' }], 'http refusé, non-PDF ignoré');
  const protege = lireDetailsDocument({ protected: true, writingMaterials: {} });
  assertEquals(protege.protege, true);
  assertEquals(protege.pieces, []);
});

Deno.test('choix du règlement : fichier de la zone, puis règlement écrit, jamais graphique/PADD/OAP', () => {
  const d = lireDetailsDocument(fixture('gpu-details.json'));
  const [z] = lireZonesAuPoint(fixture('apicarto-zone-urba.json'));
  const f = choisirFichiersReglement(d, z);
  assertEquals(f.map((x) => x.nom), ['12345_reglement_20230615.pdf']);
  assertEquals(f[0].raison, 'fichier désigné par la zone (nomfic)');

  const plui = lireDetailsDocument({ writingMaterials: {
    '4_1_reglement_dispositions_generales.pdf': 'https://g.fr/a/4_1_reglement_dispositions_generales.pdf',
    '4_2_reglement_zones_urbaines.pdf': 'https://g.fr/a/4_2_reglement_zones_urbaines.pdf',
    '4_3_reglement_zones_naturelles.pdf': 'https://g.fr/a/4_3_reglement_zones_naturelles.pdf',
    '4_4_reglement_graphique.pdf': 'https://g.fr/a/4_4_reglement_graphique.pdf',
    '3_oap.pdf': 'https://g.fr/a/3_oap.pdf',
  } });
  const fz = choisirFichiersReglement(plui, { ...z, fichier: null, zone: 'UB', type_zone: 'U' });
  assertEquals(fz.map((x) => x.nom), ['4_2_reglement_zones_urbaines.pdf', '4_3_reglement_zones_naturelles.pdf', '4_1_reglement_dispositions_generales.pdf']);
  assertEquals(choisirFichiersReglement({ ...plui, pieces: plui.pieces.filter((p) => /graphique|oap/.test(p.nom)) }, z), []);
});

Deno.test('document de la partition : le plus récent en production', () => {
  assertEquals(choisirDocumentPartition([
    { id: 'ancien000001', status: 'document.production', uploadDate: '2019-01-01' },
    { id: 'recent000001', status: 'document.production', uploadDate: '2023-07-03' },
    { id: 'apercu000001', status: 'document.preview', uploadDate: '2024-01-01' },
  ]), 'recent000001');
  assertEquals(choisirDocumentPartition([]), null);
  assertEquals(choisirDocumentPartition({ nimporte: 'quoi' }), null);
});

Deno.test('cache et source affichée', () => {
  assertEquals(cleCacheGpu('abc123', '12345 Règlement.PDF'), 'gpu:abc123:12345_r_glement.pdf');
  assertEquals(cheminCacheGpu('abc/123', '../x'), 'gpu/abc123/x.pdf');
  assertEquals(cleCacheStockage('agent-conception', 'u/c/reglement-1.pdf', 42), 'stockage:agent-conception/u/c/reglement-1.pdf:42');
  const s = libelleSource({ du_type: 'PLU', territoire: 'TESTVILLE', idurba: '12345_PLU_20230615', date_approbation: '2023-06-15', fichier: 'r.pdf' });
  assertEquals(s, 'PLU de TESTVILLE (12345_PLU_20230615, approuvé le 15/06/2023) — Géoportail de l\'urbanisme, fichier r.pdf');
  assert(libelleSource({ du_type: null, territoire: null, idurba: null, date_approbation: null, fichier: 'r.pdf' }).includes("date d'approbation non publiée"));
});

Deno.test('V1.8 — plusieurs pièces de règlement : on demande à l’utilisateur, sauf pièce unique ou désignée', async () => {
  const { decisionFichier } = await import('./gpuReglement.ts');
  const f = (nom: string, rang = 3) => ({ nom, url: `https://g.fr/${nom}`, raison: 'règlement écrit', rang });
  const plusieurs = [f('4_1_reglement_dispositions_generales.pdf', 4), f('4_2_reglement_zones_urbaines.pdf', 2), f('4_3_reglement_zones_naturelles.pdf', 3)];
  const d = decisionFichier(plusieurs, null);
  assertEquals(d.action, 'choisir');
  if (d.action === 'choisir') assertEquals(d.choix.map((c) => c.nom), plusieurs.map((x) => x.nom));
  const choisi = decisionFichier(plusieurs, '4_2_reglement_zones_urbaines');
  assertEquals(choisi.action === 'lire' ? choisi.fichier.nom : null, '4_2_reglement_zones_urbaines.pdf');
  assertEquals(decisionFichier(plusieurs, 'naturelles').action, 'lire', 'désignation partielle sans ambiguïté');
  assertEquals(decisionFichier(plusieurs, 'reglement').action, 'choisir', 'désignation ambiguë → on redemande');
  assertEquals(decisionFichier([f('unique.pdf')], null).action, 'lire');
  assertEquals(decisionFichier([], null).action, 'choisir');
});
