// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/quartier-vente.test.ts
// =============================================================================
// VIS-70 — outil `quartier_atouts` : atouts du quartier (lecture seule), carte du chat, lien vers la page Quartier.
// Données : BPE et gares RÉELLES (extraites de Supabase le 27/11/2026), OSM et SIRENE FACTICES (réseau refusé en test).
// =============================================================================
import * as na from 'node:assert/strict';
import {
  CONSIGNE_QUARTIER, demandeQuartier, depotQuartierSupabase, executerOutilQuartier, LIEUX_PAR_CATEGORIE_CHAT, OUTIL_QUARTIER_VENTE,
  OUTIL_QUARTIER_VENTE_DEF, type DepotQuartier,
} from './quartier-vente.ts';
import { lireCarteQuartier } from '../../../../src/lib/quartier/texteAtouts.ts';
import * as F from '../../../../src/lib/quartier/__fixtures__/quartierFixtures.ts';

const QUAND = new Date('2026-11-27T10:00:00Z');

function depotAscain(vu: { conv?: string; appels: string[] } = { appels: [] }, pannes: string[] = []): DepotQuartier {
  const ko = (s: string) => { vu.appels.push(s); if (pannes.includes(s)) throw new Error(`${s} en panne`); };
  return {
    async projetConversation(c) { vu.conv = c; return { ...F.ASCAIN }; },
    async bpe() { ko('bpe'); return F.BPE_ASCAIN; },
    async gares() { ko('gares'); return F.GARES_ASCAIN; },
    async gtfs() { ko('gtfs'); return []; },
    async osm() { ko('osm'); return F.OSM_ASCAIN_DEMO; },
    async sirene() { ko('sirene'); return F.SIRENE_ASCAIN_DEMO; },
  };
}

Deno.test('VIS-70 — définition : nom, modes, aucun paramètre requis', () => {
  na.equal(OUTIL_QUARTIER_VENTE_DEF.name, 'quartier_atouts');
  na.equal(OUTIL_QUARTIER_VENTE, 'quartier_atouts');
  na.deepEqual(OUTIL_QUARTIER_VENTE_DEF.available_in_modes, ['quick', 'advanced', 'report']);
  na.equal(OUTIL_QUARTIER_VENTE_DEF.input_schema.required, undefined);
  na.match(OUTIL_QUARTIER_VENTE_DEF.description, /Ouvrir la page Quartier/);
  na.match(CONSIGNE_QUARTIER, /JAMAIS de mémoire/);
});

Deno.test('VIS-70 — détection du sujet', () => {
  for (const t of ['Quels sont les atouts du quartier ?', 'Montre-moi le plan masse', 'Qu’y a-t-il autour du projet ?', 'Y a-t-il des écoles à proximité ?', 'transports proches ?'])
    na.ok(demandeQuartier(t), t);
  for (const t of ['Lance le film', 'Quel est le prix au m² ?', 'Dessine une maison'])
    na.ok(!demandeQuartier(t), t);
});

Deno.test('VIS-70 — Ascain : parcelle du projet, carte « quartier-vente », lien de page, 7 catégories', async () => {
  const vu = { appels: [] as string[], conv: undefined as string | undefined };
  const r = await executerOutilQuartier({}, { conversationId: 'conv-1', depot: depotAscain(vu), maintenant: QUAND });
  na.equal(r.status, 'ok');
  na.equal(vu.conv, 'conv-1');
  const d = r.data!;
  na.equal(d.carte, 'quartier-vente');
  na.equal(d.lien_page, '/mimmozia/quartier?conversation=conv-1');
  na.equal(d.debit_jetons, 0);
  const carte = lireCarteQuartier({ id: 'x', name: OUTIL_QUARTIER_VENTE, status: 'done', output: r });
  na.ok(carte);
  na.equal(carte!.atouts.categories.length, 7);
  na.ok(carte!.atouts.categories.every((c) => c.lieux.length <= LIEUX_PAR_CATEGORIE_CHAT));
  na.match(r.message!, /À 5 min à pied : /);
  na.match(r.message!, /Ouvrir la page Quartier/);
  na.equal(carte!.atouts.categories.find((c) => c.id === 'sante')!.plusProche!.nom, "Pharmacie d'Ascain");
});

Deno.test('VIS-70 — coordonnées explicites : la parcelle de la conversation n’est pas lue, le lien porte le point', async () => {
  const vu = { appels: [] as string[], conv: undefined as string | undefined };
  const r = await executerOutilQuartier({ lat: 43.348, lng: -1.621 }, { conversationId: 'c2', depot: depotAscain(vu), maintenant: QUAND });
  na.equal(vu.conv, undefined);
  na.equal(r.data!.lien_page, '/mimmozia/quartier?conversation=c2&lat=43.348000&lon=-1.621000');
});

Deno.test('VIS-70 — source en panne : catégorie « indisponible », jamais « aucun » ; tout en panne → erreur honnête', async () => {
  const r = await executerOutilQuartier({}, { conversationId: 'c', depot: depotAscain(undefined, ['osm']), maintenant: QUAND });
  const a = lireCarteQuartier({ id: 'x', name: OUTIL_QUARTIER_VENTE, output: r })!.atouts;
  na.equal(a.categories.find((c) => c.id === 'restaurants')!.etat, 'indisponible');
  na.match(r.message!, /indisponible/);
  const tout = await executerOutilQuartier({}, { conversationId: 'c', depot: depotAscain(undefined, ['bpe', 'gares', 'gtfs', 'osm', 'sirene']) });
  na.equal(tout.status, 'error');
  na.match(tout.message!, /ne conclus à aucune absence/);
});

Deno.test('VIS-70 — sans localisation : not_found, repli resoudrePoint (centre de commune) signalé', async () => {
  const vide: DepotQuartier = { ...depotAscain(), async projetConversation() { return null; } };
  const r = await executerOutilQuartier({}, { conversationId: null, depot: vide });
  na.equal(r.status, 'not_found');
  const r2 = await executerOutilQuartier({}, { depot: vide, resoudrePoint: async () => ({ lat: 43.3445, lon: -1.6206, precision: 'centre_commune' }), maintenant: QUAND });
  na.equal(r2.status, 'ok');
  const a = lireCarteQuartier({ id: 'x', name: OUTIL_QUARTIER_VENTE, output: r2 })!.atouts;
  na.ok(a.avertissements.some((x) => /centre de la commune/.test(x)));
});

Deno.test('VIS-70 — Lyon (gares réelles + OSM démo) : station de métro en tête des transports', async () => {
  const d: DepotQuartier = {
    async projetConversation() { return null; }, async bpe() { return F.BPE_LYON; }, async gares() { return F.GARES_LYON; },
    async gtfs() { return []; }, async osm() { return F.OSM_LYON_DEMO; },
  };
  const r = await executerOutilQuartier({ lat: F.LYON.lat, lng: F.LYON.lon }, { depot: d, maintenant: QUAND });
  const a = lireCarteQuartier({ id: 'x', name: OUTIL_QUARTIER_VENTE, output: r })!.atouts;
  na.equal(a.urbain, true);
  na.equal(a.categories[0]!.lieux[0]!.nom, 'Bellecour');
  na.ok(!a.sources.some((s) => s.source === 'sirene'));  // SIRENE non branché : non consulté, pas « en panne »
});

Deno.test('VIS-70 — dépôt Supabase : lecture seule, bornée, Overpass en POST, SIRENE via l’appel interne', async () => {
  const journal: string[] = [];
  const chaine = (table: string) => {
    const q: any = {
      select(c: string) { journal.push(`${table}.select(${c})`); return q; },
      eq(k: string, v: unknown) { journal.push(`${table}.eq(${k},${v})`); return q; },
      in(k: string, v: unknown[]) { journal.push(`${table}.in(${k},${v.join('|')})`); return q; },
      gte(k: string) { journal.push(`${table}.gte(${k})`); return q; }, lte(k: string) { journal.push(`${table}.lte(${k})`); return q; },
      order() { return q; }, limit(n: number) { journal.push(`${table}.limit(${n})`); return Promise.resolve({ data: [], error: null }); },
      insert() { throw new Error('écriture interdite'); }, update() { throw new Error('écriture interdite'); }, delete() { throw new Error('écriture interdite'); },
    };
    return q;
  };
  const admin = { from: chaine, rpc: (f: string) => { journal.push(`rpc:${f}`); return Promise.resolve({ data: [], error: null }); } };
  const appelsFetch: { url: string; method?: string; body?: string }[] = [];
  const faux = (async (url: string, init?: RequestInit) => { appelsFetch.push({ url, method: init?.method, body: String(init?.body) }); return new Response(JSON.stringify({ elements: [] }), { status: 200 }); }) as unknown as typeof fetch;
  const dep = depotQuartierSupabase(admin, { fetch: faux, sirene: async () => ({ status: 'ok', items: F.SIRENE_ASCAIN_DEMO }) });
  await dep.bpe(43.348, -1.621, 2000);
  await dep.gares(43.348, -1.621, 15000);
  await dep.gtfs(43.348, -1.621);
  await dep.osm(43.348, -1.621, 1500);
  await dep.projetConversation('c9');
  const s = await dep.sirene!(43.348, -1.621);
  na.ok(journal.includes('bpe_equipements.select(typequ,nomrs,latitude,longitude,libcom)'));
  na.ok(journal.includes('mobility_stops.in(mode,ter|tgv)'));
  na.ok(journal.includes('studio_preparations.eq(conversation_id,c9)'));
  na.ok(journal.includes('rpc:get_nearby_gtfs_stops'));
  na.equal(appelsFetch[0]!.method, 'POST');
  na.match(decodeURIComponent(appelsFetch[0]!.body!), /around:1500,43\.348000,-1\.621000/);
  na.equal(s.length, 2);
  const enPanne = depotQuartierSupabase(admin, { sirene: async () => ({ status: 'error' }) });
  await na.rejects(() => enPanne.sirene!(0, 0), /SIRENE indisponible/);
});
