// deno test --no-lock --no-check -A supabase/functions/photo-rue-couverture/
// LOT P2 (11/11/2026) — fonction en lecture seule « photo-rue-couverture ». Réseau simulé avec la réponse RÉELLE de
// l'instance IGN de Panoramax autour de la parcelle 93048000AS0249 (Montreuil, relevée le 11/11/2026, lot P1).
import * as na from 'node:assert/strict';
import { CORPS_MAX, traiter } from './traitement.ts';
import { contourDepuisGeometrie, RAYON_COUVERTURE_M } from '../../../src/lib/studio/couverturePhotoRue.ts';

const CADASTRE = JSON.parse(await Deno.readTextFile(new URL('../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(await Deno.readTextFile(new URL('../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));
const CONTOUR = contourDepuisGeometrie(CADASTRE.parcelle.geometry)!;
const MAINTENANT = () => Date.parse('2026-11-11T12:00:00Z');
const post = (corps: unknown) => new Request('https://x.supabase.co/functions/v1/photo-rue-couverture', { method: 'POST', body: typeof corps === 'string' ? corps : JSON.stringify(corps) });

Deno.test('PRC-1 : couverture réelle de AS0249 — instance IGN, emprise de 60 m, Licence Ouverte seulement, plus proches d’abord', async () => {
  const urls: string[] = [];
  const f = (async (u: string | URL) => { urls.push(String(u)); return new Response(JSON.stringify(PANORAMAX)); }) as typeof fetch;
  const r = await traiter(post({ contour: CONTOUR }), f, MAINTENANT);
  na.equal(r.status, 200);
  const j = await r.json();
  na.equal(j.ok, true);
  na.equal(urls.length, 1);
  na.match(urls[0], /^https:\/\/panoramax\.ign\.fr\/api\/search\?bbox=2\.42\d+,48\.85\d+,2\.42\d+,48\.85\d+&limit=100$/);
  na.equal(j.couverture.couverte, true);
  na.equal(j.couverture.verifieLe, '2026-11-11T12:00:00.000Z');
  const p = j.couverture.photos as { id: string; date: string; distanceM: number }[];
  na.ok(p.length >= 1 && p.length <= 10);
  na.ok(p.every((x, i) => x.distanceM <= RAYON_COUVERTURE_M && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && (i === 0 || p[i - 1].distanceM <= x.distanceM)), JSON.stringify(p));
  console.log(`  couverture AS0249 : ${p.length} photo(s) ; la plus proche ${p[0].id} à ${p[0].distanceM} m (${p[0].date})`);
});

Deno.test('PRC-2 : une photo CC-BY-SA (ou sans licence) n’est jamais retenue', async () => {
  const autres = structuredClone(PANORAMAX);
  for (const x of autres.features) x.properties.license = 'CC-BY-SA-4.0';
  autres.features[0].properties.license = undefined;
  const j = await (await traiter(post({ contour: CONTOUR }), (async () => new Response(JSON.stringify(autres))) as typeof fetch, MAINTENANT)).json();
  na.deepEqual(j, { ok: true, couverture: { couverte: false, photos: [], verifieLe: '2026-11-11T12:00:00.000Z' } });
});

Deno.test('PRC-3 : échecs — couverture « non vérifiée » (jamais « absente ») ; requêtes refusées', async () => {
  const panne = (async () => { throw new Error('réseau'); }) as typeof fetch;
  const j1 = await (await traiter(post({ contour: CONTOUR }), panne, MAINTENANT)).json();
  na.equal(j1.ok, false);
  na.match(j1.raison, /n’a pas répondu : couverture non vérifiée/);
  const j2 = await (await traiter(post({ contour: CONTOUR }), (async () => new Response('x', { status: 503 })) as typeof fetch, MAINTENANT)).json();
  na.match(j2.raison, /réponse 503/);
  const j3 = await (await traiter(post({ contour: [[2.4, 48.8], [2.4, 48.8]] }), panne, MAINTENANT)).json();
  na.match(j3.raison, /Contour de la parcelle illisible/);
  const j4 = await (await traiter(post({ contour: [[2.0, 48.0], [2.1, 48.0], [2.1, 48.1]] }), panne, MAINTENANT)).json();
  na.match(j4.raison, /Emprise trop grande/);
  na.equal((await traiter(post('pas du json'), panne)).status, 400);
  na.equal((await traiter(post('x'.repeat(CORPS_MAX + 1)), panne)).status, 413);
  na.equal((await traiter(new Request('https://x/', { method: 'GET' }), panne)).status, 405);
  na.equal((await traiter(new Request('https://x/', { method: 'OPTIONS' }), panne)).status, 200);
});
