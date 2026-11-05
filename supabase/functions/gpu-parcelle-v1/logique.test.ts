// deno test supabase/functions/gpu-parcelle-v1/logique.test.ts — lot Q3 (point 10), sans réseau.
// Constat du 05/11/2026 (92050000AE0414) : get_prescriptions_urbanisme a renvoyé « Zone de
// stationnement n°1 » (lecture au POINT) alors que l'API Carto prescription-surf, interrogée avec la
// géométrie complète de la parcelle, ne renvoie que « Zone de stationnement n°3 ».
import assert from 'node:assert/strict';
import { alertesValeursMultiples, familleLibelle, geometrieDepuisIdu, geometrieValide, SOMMETS_MAX, urlCouche, urlsCadastre } from './logique.ts';

// Contour synthétique (pas la vraie parcelle : aucune géométrie inventée n'est présentée comme réelle).
const CONTOUR = { type: 'Polygon', coordinates: [[[2.2, 48.89], [2.2005, 48.89], [2.2005, 48.8905], [2.2, 48.89]]] };

Deno.test('Q3-10 : prescriptions lues avec la GÉOMÉTRIE de la parcelle ; zonage toujours au point', () => {
  const g = geometrieValide(CONTOUR)!;
  const u = decodeURIComponent(urlCouche('https://apicarto.ign.fr/api/gpu', 'prescription-surf', 2.2002, 48.8902, g));
  assert.ok(u.includes('"type":"Polygon"'), u);
  for (const c of ['prescription-lin', 'prescription-pct', 'info-surf']) assert.ok(decodeURIComponent(urlCouche('b', c, 2.2, 48.89, g)).includes('Polygon'));
  for (const c of ['zone-urba', 'municipality']) assert.ok(decodeURIComponent(urlCouche('b', c, 2.2, 48.89, g)).includes('"type":"Point"'));
  assert.ok(decodeURIComponent(urlCouche('b', 'prescription-surf', 2.2, 48.89, null)).includes('"type":"Point"'), 'sans contour : point (dit dans le résumé)');
  // Géométries refusées : forme invalide, trop de sommets (URL GET trop longue).
  assert.equal(geometrieValide({ type: 'Point', coordinates: [2.2, 48.89] }), null);
  assert.equal(geometrieValide({ type: 'Polygon', coordinates: [[[2.2, 48.89], [2.3, 48.9]]] }), null);
  const gros = Array.from({ length: SOMMETS_MAX + 2 }, (_, i) => [2.2 + i * 1e-6, 48.89 + (i % 2) * 1e-6]);
  assert.equal(geometrieValide({ type: 'Polygon', coordinates: [[...gros, gros[0]]] }), null);
});

Deno.test('Q3-10 : plusieurs valeurs d’une même famille → toutes remontées avec une alerte, aucune choisie', () => {
  assert.equal(familleLibelle('Zone de stationnement n°3'), 'zone de stationnement');
  assert.equal(familleLibelle('Espace boisé classé'), null);
  const a = alertesValeursMultiples([{ libelle: 'Zone de stationnement n°1' }, { libelle: 'Zone de stationnement n°3' }, { libelle: 'Espace boisé classé' }]);
  assert.equal(a.length, 1);
  assert.ok(a[0].includes('Zone de stationnement n°1') && a[0].includes('Zone de stationnement n°3') && a[0].includes('aucune n’est retenue'));
  assert.deepEqual(alertesValeursMultiples([{ libelle: 'Zone de stationnement n°3' }]), [], 'une seule valeur : pas d’alerte');
});

Deno.test('Q3-10 : contour récupéré au cadastre à partir de l’idu (API Carto, fetch simulé)', async () => {
  assert.deepEqual(urlsCadastre('92050000AE0414'), ['https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=92050&section=AE&numero=0414', 'https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=92050&section=AE&numero=414']);
  assert.deepEqual(urlsCadastre('pas un idu'), []);
  const vus: string[] = [];
  const f = (async (u: string) => { vus.push(String(u)); return new Response(JSON.stringify({ features: [{ geometry: CONTOUR }] })); }) as unknown as typeof fetch;
  const g = await geometrieDepuisIdu('92050000AE0414', f);
  assert.equal(g?.type, 'Polygon');
  assert.equal(vus.length, 1);
  const ko = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
  assert.equal(await geometrieDepuisIdu('92050000AE0414', ko), null);
});
