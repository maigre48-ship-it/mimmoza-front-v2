// deno test --no-lock -A supabase/functions/patrimoine-merimee-v1/index.test.ts — LOT P11, sans réseau.
// Bout-en-bout du VRAI index.ts : Deno.serve intercepté, fetch simulé.
import assert from 'node:assert/strict';

type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  writable: true,
  value: (h: Handler) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} }; },
});

const vraiFetch = globalThis.fetch;
const appels: string[] = [];
let reponse: () => Response;
globalThis.fetch = ((input: string | URL | Request) => {
  appels.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  return Promise.resolve(reponse());
}) as typeof fetch;

await import('./index.ts');

async function appeler(corps: unknown) {
  const res = await handler!(new Request('http://local/patrimoine-merimee-v1', { method: 'POST', body: JSON.stringify(corps) }));
  return { http: res.status, corps: await res.json() };
}

Deno.test('P11-M8 : index.ts réel — HTML de la source → HTTP 200, status error, source indisponible (plus de crash JSON)', async () => {
  reponse = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const { http, corps } = await appeler({ lat: 43.49275, lon: -1.47616, radius_m: 500 });
  assert.equal(http, 200);
  assert.equal(corps.status, 'error');
  assert.equal(corps.erreur, 'source_indisponible');
  assert.ok(!String(corps.summary).includes('Unexpected token'));
  assert.ok(appels.at(-1)!.startsWith('https://tabular-api.data.gouv.fr/'), 'plus aucun appel à data.culture.gouv.fr');
});

Deno.test('P11-M9 : index.ts réel — réponse JSON, encodage réparé à la frontière', async () => {
  reponse = () => new Response(JSON.stringify({
    data: [{ Reference: 'PA00084340', Titre_editorial_de_la_notice: 'Ã‰glise (test encodage)', Typologie_de_la_protection: 'inscrit MH partiellement', coordonnees_au_format_WGS84: '43.4913114736406,-1.47691382050481' }],
    links: {}, meta: { page: 1, page_size: 50, total: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const { corps } = await appeler({ lat: 43.49275, lon: -1.47616 });
  assert.equal(corps.status, 'ok');
  assert.equal(corps.items[0].nom, 'Église (test encodage)');
  assert.equal(corps.stats.dans_perimetre_abf_500m, true);
  assert.equal(corps.stats.distance_plus_proche_m, 171);
});

Deno.test({ name: 'P11-M10 : nettoyage', fn: () => { globalThis.fetch = vraiFetch; } });
