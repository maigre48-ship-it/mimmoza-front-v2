// Tests sans réseau de l'outil chat `rechercher_parcelles`.
// Lancer : deno test --allow-read --allow-env supabase/functions/copilot-chat/agent/outil-rechercher-parcelles.test.ts
import assert from 'node:assert/strict';
import {
  construireCorps, executerRechercherParcelles, resumerRechercheParcelles, TOOL_RECHERCHER_PARCELLES,
} from './outil-rechercher-parcelles.ts';
import { rechercherParcelles } from '../../rechercher-parcelles-v1/logique.ts';

const fx = (n: string) => JSON.parse(Deno.readTextFileSync(new URL(`../../rechercher-parcelles-v1/fixtures/${n}`, import.meta.url)));

/** Réponse réelle de la logique, calculée sur les fixtures (pas de JSON écrit à la main). */
async function sortieFixture(entree: Record<string, unknown>) {
  const f = (async (u: string | URL | Request) => {
    const url = String(u);
    const corps = url.includes('geo.api.gouv.fr') ? fx('geo_commune.json')
      : url.includes('cadastre.data.gouv.fr') ? fx('etalab_commune.json')
      : url.includes('/api/gpu/zone-urba') ? fx('gpu_zone_urba.json')
      : url.includes('data.geopf.fr') ? fx('bdtopo_batiment.json') : null;
    return corps ? new Response(JSON.stringify(corps)) : new Response('', { status: 404 });
  }) as typeof fetch;
  return await rechercherParcelles(entree as any, { fetch: f });
}

Deno.test('définition : nom, routage « terrains », modes dont quick', () => {
  assert.equal(TOOL_RECHERCHER_PARCELLES.name, 'rechercher_parcelles');
  assert.ok(TOOL_RECHERCHER_PARCELLES.available_in_modes.includes('quick'));
  assert.match(TOOL_RECHERCHER_PARCELLES.description, /TROUVER DES TERRAINS/);
  assert.equal(TOOL_RECHERCHER_PARCELLES.input_schema.type, 'object');
});

Deno.test('corps : périmètre explicite prioritaire, filtres transmis', () => {
  const c = construireCorps({ code_insee: '99999', commune: 'X', surface_min_m2: '800', zonages: 'U, AU', exclure_bati: true, limite: 10 },
    { parcel: { commune: 'Autre' } })!;
  assert.deepEqual(c.corps, { code_insee: '99999', surface_min_m2: 800, limite: 10, zonages: ['U', 'AU'], exclure_bati: true });
  assert.equal(c.perimetre_deduit_du_contexte, false);
});

Deno.test('corps : repli sur la commune de la parcelle ouverte, sinon null', () => {
  const c = construireCorps({}, { parcel: { commune: 'Sceaux', code_postal: '92330', code_insee: '92071' } })!;
  assert.deepEqual(c.corps, { commune: 'Sceaux', cp: '92330' });
  assert.equal(c.perimetre_deduit_du_contexte, true);
  assert.equal(construireCorps({}, {}), null);
  assert.equal(construireCorps({ bbox: [1, 2, 3] }, null), null);
});

Deno.test('non branché : not_configured sans appel', async () => {
  let appels = 0;
  const r = await executerRechercherParcelles({ code_insee: '99999' }, null, async () => { appels++; return {}; }, null);
  assert.equal(r.status, 'not_configured');
  assert.equal(appels, 0);
});

Deno.test('périmètre absent : error sans appel', async () => {
  let appels = 0;
  const r = await executerRechercherParcelles({}, {}, async () => { appels++; return {}; }, 'rechercher-parcelles-v1');
  assert.equal(r.status, 'error');
  assert.equal(appels, 0);
});

Deno.test('appel nominal : slug et corps transmis, résumé compact', async () => {
  const sortie = await sortieFixture({ code_insee: '99999', surface_min_m2: 800, zonages: ['U'], exclure_bati: true });
  let vu: { fn: string; body: unknown } | null = null;
  const r = await executerRechercherParcelles(
    { code_insee: '99999', surface_min_m2: 800, zonages: ['U'], exclure_bati: true }, null,
    async (fn, body) => { vu = { fn, body }; return sortie; }, 'rechercher-parcelles-v1');
  assert.equal(vu!.fn, 'rechercher-parcelles-v1');
  assert.deepEqual(vu!.body, { code_insee: '99999', surface_min_m2: 800, zonages: ['U'], exclure_bati: true });
  assert.equal(r.status, 'ok');
  const d = r.data as any;
  assert.equal(d.parcelles[0].idu, '99999000AB0001');
  assert.equal(d.parcelles[0].zone, 'UB');
  assert.equal(d.parcelles[0].bati, false);
  assert.ok(d.parcelles.length <= 15);
  assert.ok(JSON.stringify(r).length < 8000, 'résumé compact');
  assert.ok(Array.isArray(d.sources) && d.sources.length >= 2);
});

Deno.test('résumé : no_data → not_found ; error → error ; illisible → error', async () => {
  const vide = await sortieFixture({ code_insee: '99999', surface_min_m2: 100000 });
  assert.equal(resumerRechercheParcelles(vide).status, 'not_found');
  assert.equal(resumerRechercheParcelles({ status: 'error', summary: 'x', stats: {}, items: [] }).status, 'error');
  assert.equal(resumerRechercheParcelles(null).status, 'error');
  assert.equal(resumerRechercheParcelles({ status: 'ok', items: [{ idu: 'A' }], stats: { couverture_cadastre: 'partielle' } }).status, 'partial');
});

Deno.test('exception de callInternalFunction → error explicite', async () => {
  const r = await executerRechercherParcelles({ code_insee: '99999' }, null,
    async () => { throw new Error('rechercher-parcelles-v1 → timeout (25000ms)'); }, 'rechercher-parcelles-v1');
  assert.equal(r.status, 'error');
  assert.match(r.message!, /timeout/);
});
