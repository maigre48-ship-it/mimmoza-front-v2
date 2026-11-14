// deno test --no-lock -A supabase/functions/servitudes-gpu-v1/index.test.ts — LOT P11, sans réseau.
// Bout-en-bout du VRAI index.ts : Deno.serve est intercepté, fetch est simulé (API Carto IGN).
// Propriétés reprises des réponses réelles (copilot_tool_calls, Ciboure 26/09/2026) : `categorie` absente.
import assert from 'node:assert/strict';

type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  writable: true,
  value: (h: Handler) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} }; },
});

const vraiFetch = globalThis.fetch;
let reponses: (url: string) => Response;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return Promise.resolve(reponses(url));
}) as typeof fetch;

await import('./index.ts');

const fc = (features: unknown[]) =>
  new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status: 200, headers: { 'content-type': 'application/json' } });
const PARCELLE = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-1.6633, 43.3880], [-1.6630, 43.3880], [-1.6630, 43.3882], [-1.6633, 43.3880]]] }, properties: {} };
const sup = (p: Record<string, unknown>) => ({ type: 'Feature', geometry: null, properties: p });

async function appeler(corps: unknown) {
  const res = await handler!(new Request('http://local/servitudes-gpu-v1', { method: 'POST', body: JSON.stringify(corps) }));
  return await res.json();
}

Deno.test('P11-S4 : index.ts réel — catégorie renseignée à la source (AC1, AC2, PM1), libellé et origine', async () => {
  reponses = (url) => {
    if (url.includes('/cadastre/parcelle')) return fc([PARCELLE]);
    if (url.includes('/gpu/assiette-sup-s')) {
      return fc([
        sup({ nomsuplitt: "Eglise de l'Assomption", idass: 'AC1-172014607-1907231266-1-2', idgen: 'AC1-172014607-1907231266-1', partition: '172014607_SUP_64_AC1', typeass: 'Périmètre des abords' }),
        sup({ nomsuplitt: 'Ensemble dit du Labourd', idass: 'AC2-130010457-251-1-1', idgen: 'AC2-130010457-251-1', partition: '130010457_SUP_R75_AC2', typeass: 'Enceinte du site' }),
        sup({ nomsuplitt: 'Plan_de_prevention_des_risques_naturels_previsibles_et_des_risques_miniers', idass: 'PM1-130011570-82-1-1', idgen: 'PM1-130011570-82-1', partition: '130011570_SUP_64_PM1', typeass: 'Enveloppe des zonages réglementaires' }),
        sup({ nomsuplitt: 'Servitude sans identifiant lisible', idass: 'X-1', idgen: null, partition: null }),
      ]);
    }
    return fc([]);
  };
  const r = await appeler({ lat: 43.3881, lon: -1.6631 });
  assert.equal(r.status, 'ok');
  const parNom = Object.fromEntries(r.items.map((i: any) => [i.nom, i]));
  assert.deepEqual(
    [parNom["Eglise de l'Assomption"].categorie, parNom["Eglise de l'Assomption"].categorie_label, parNom["Eglise de l'Assomption"].categorie_deduite_de],
    ['AC1', 'Monuments historiques (abords)', 'idgen'],
  );
  assert.equal(parNom['Ensemble dit du Labourd'].categorie, 'AC2');
  assert.equal(parNom['Plan_de_prevention_des_risques_naturels_previsibles_et_des_risques_miniers'].categorie, 'PM1');
  // Rien d'inventé quand rien n'est lisible.
  const inconnu = parNom['Servitude sans identifiant lisible'];
  assert.deepEqual([inconnu.categorie, inconnu.categorie_label, inconnu.categorie_deduite_de], [null, null, null]);
  // Champs historiques toujours présents (contrat inchangé pour le chat et X3b).
  for (const k of ['categorie', 'categorie_label', 'nom', 'type_assiette', 'idass', 'idgen', 'partition', 'date_maj']) assert.ok(k in inconnu, k);
  const labels = r.stats.categories.map((c: any) => c.label);
  assert.ok(labels.includes('Monuments historiques (abords)') && labels.includes('Sites classés ou inscrits'));
  assert.ok(labels.includes('Servitude sans identifiant lisible'), 'sans catégorie : le nom, pas un code nu');
  assert.ok(r.summary.includes('Monuments historiques (abords)'));
});

Deno.test('P11-S5 : index.ts réel — panne totale de l’API Carto toujours dite (non-régression)', async () => {
  reponses = (url) => (url.includes('/cadastre/') ? fc([]) : new Response('<!doctype html>', { status: 502, headers: { 'content-type': 'text/html' } }));
  const r = await appeler({ lat: 43.3881, lon: -1.6631 });
  assert.equal(r.status, 'error');
  assert.ok(r.summary.includes('ne signifie PAS'));
});

Deno.test({ name: 'P11-S6 : nettoyage', fn: () => { globalThis.fetch = vraiFetch; } });
