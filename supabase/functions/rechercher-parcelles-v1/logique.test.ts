// Tests sans réseau de rechercher-parcelles-v1 (fixtures synthétiques).
// Lancer : deno test --allow-read supabase/functions/rechercher-parcelles-v1/
import assert from 'node:assert/strict';
import {
  comparer, compacite, mesurer, normaliserParcelle, pointsZone, rechercherParcelles, REGLAGES, zoneCorrespond,
  type Deps,
} from './logique.ts';

const dossier = new URL('./fixtures/', import.meta.url);
const lire = (n: string) => JSON.parse(Deno.readTextFileSync(new URL(n, dossier)));
const FX = {
  etalab: lire('etalab_commune.json'),
  apicarto: lire('apicarto_cadastre.json'),
  gpu: lire('gpu_zone_urba.json'),
  bati: lire('bdtopo_batiment.json'),
  muni: lire('gpu_municipality_rnu.json'),
  geo: lire('geo_commune.json'),
  ambigu: lire('geo_recherche_ambigue.json'),
};

type Regle = (url: string) => unknown | Response | Error | undefined;

/** Faux fetch : la première règle qui renvoie quelque chose l'emporte. */
function fauxFetch(regles: Regle[], journal: string[] = []): typeof fetch {
  return (async (entree: string | URL | Request) => {
    const url = String(entree instanceof Request ? entree.url : entree);
    journal.push(url);
    for (const r of regles) {
      const v = r(url);
      if (v === undefined) continue;
      if (v instanceof Error) throw v;
      if (v instanceof Response) return v;
      return new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
const copie = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const http = (s: number) => new Response('x', { status: s });

const R = {
  geo: (u: string) => u.startsWith('https://geo.api.gouv.fr/communes/') ? FX.geo : undefined,
  etalab: (u: string) => u.includes('cadastre.data.gouv.fr') ? copie(FX.etalab) : undefined,
  gpu: (u: string) => u.includes('/api/gpu/zone-urba') ? copie(FX.gpu) : undefined,
  bati: (u: string) => u.includes('data.geopf.fr/wfs') ? copie(FX.bati) : undefined,
};
const deps = (regles: Regle[], journal?: string[]): Deps => ({ fetch: fauxFetch(regles, journal) });

Deno.test('géométrie : un carré de 40 m fait 1 600 m², compacité ≈ 0,785', () => {
  const p = normaliserParcelle(FX.etalab.features[0])!;
  const { aire } = mesurer(p.polys);
  assert.ok(Math.abs(aire - 1600) < 2, `aire ${aire}`);
  assert.ok(Math.abs(compacite(p.polys) - Math.PI / 4) < 0.005);
  assert.equal(p.idu, '99999000AB0001');
  assert.equal(p.surface_source, 'contenance_cadastrale');
});

Deno.test('normalisation API Carto : IDU, numéro paddé, nom de commune', () => {
  const p = normaliserParcelle(FX.apicarto.features[1])!;
  assert.equal(p.idu, '99999000AB0002');
  assert.equal(p.numero, '0002');
  assert.equal(p.commune, 'Commune-Test');
});

Deno.test('surface sans contenance : calculée et marquée comme telle', () => {
  const p = normaliserParcelle(FX.etalab.features[6])!;
  assert.equal(p.surface_source, 'calculee_geometrie');
  assert.ok(Math.abs(p.surface_m2 - 900) <= 2);
});

Deno.test('barème zonage et filtre de zones', () => {
  assert.equal(pointsZone('U', 'lu'), 40);
  assert.equal(pointsZone('AUc', 'lu'), 30);
  assert.equal(pointsZone('AUs', 'lu'), 10);
  assert.equal(pointsZone('N', 'lu'), 0);
  assert.equal(pointsZone(null, 'non_verifie'), 15);
  const ub = { type_zone: 'U', zonage_plu: 'UB', libelle_zone: null, document: null };
  const auc = { type_zone: 'AUc', zonage_plu: '1AUa', libelle_zone: null, document: null };
  assert.ok(zoneCorrespond(ub, ['U']));
  assert.ok(zoneCorrespond(ub, ['ub']));
  assert.ok(!zoneCorrespond(ub, ['UA']));
  assert.ok(zoneCorrespond(auc, ['AU']));
  assert.ok(zoneCorrespond(auc, ['1AU']));
  assert.ok(!zoneCorrespond(auc, ['U']));
});

Deno.test('tri total : score, puis surface, puis IDU', () => {
  const l = [
    { score_tri: 50, surface_m2: 100, idu: 'B' }, { score_tri: 50, surface_m2: 100, idu: 'A' },
    { score_tri: 50, surface_m2: 200, idu: 'C' }, { score_tri: 60, surface_m2: 10, idu: 'D' },
  ].sort(comparer);
  assert.deepEqual(l.map((x) => x.idu), ['D', 'C', 'A', 'B']);
});

Deno.test('cas nominal : commune, 800–3 000 m², zone U, sans bâti', async () => {
  const s = await rechercherParcelles(
    { code_insee: '99999', surface_min_m2: 800, surface_max_m2: 3000, zonages: ['U'], exclure_bati: true },
    deps([R.geo, R.etalab, R.gpu, R.bati]),
  );
  assert.equal(s.status, 'ok');
  // 0001 (1 600, carré) > 0007 (≈ 900, carré, surface calculée) > 0003 (1 000, bande étirée)
  // 0006 : bâtie → écartée ; 0004 : zone N ; 0005 : hors zone publiée ; 0002 : 400 m² trop petite.
  assert.deepEqual(s.items.map((i) => i.idu), ['99999000AB0001', '99999000AB0007', '99999000AB0003']);
  const p1 = s.items[0];
  assert.equal(p1.zonage_plu, 'UB');
  assert.equal(p1.type_zone, 'U');
  assert.equal(p1.libelle_zone, 'Zone urbaine mixte');
  assert.equal(p1.zonage_statut, 'lu');
  assert.equal(p1.commune, 'Commune-Test');
  assert.equal(p1.bati_detecte, false);           // la construction légère sur 0001 est ignorée
  assert.ok(p1.raisons.length >= 3);
  const st = s.stats as any;
  assert.equal(st.parcelles_lues, 7);
  assert.equal(st.apres_filtre_surface, 6);
  assert.equal(st.couverture_cadastre, 'complete');
  assert.equal(st.zonage.methode, 'rectangle');
  assert.equal(st.bati.exclues, 1);
  assert.equal(st.exclues_zonage_non_lu, 1);
  assert.ok(s.sources.some((x) => x.includes('BD TOPO')));
});

Deno.test('déterminisme : même résultat quel que soit l\'ordre des parcelles reçues', async () => {
  const a = await rechercherParcelles({ code_insee: '99999' }, deps([R.geo, R.etalab, R.gpu, R.bati]));
  const melange = copie(FX.etalab); melange.features.reverse();
  const b = await rechercherParcelles({ code_insee: '99999' },
    deps([R.geo, (u) => u.includes('cadastre.data.gouv.fr') ? melange : undefined, R.gpu, R.bati]));
  assert.deepEqual(a.items.map((i) => [i.idu, i.score_tri]), b.items.map((i) => [i.idu, i.score_tri]));
});

Deno.test('libellés GPU doublement encodés : réparés', async () => {
  const s = await rechercherParcelles({ code_insee: '99999', zonages: ['N'] }, deps([R.geo, R.etalab, R.gpu, R.bati]));
  assert.equal(s.items[0].idu, '99999000AB0004');
  assert.equal(s.items[0].libelle_zone, 'Zone naturelle protégée');
});

Deno.test('Etalab en panne → repli API Carto paginé', async () => {
  const journal: string[] = [];
  const s = await rechercherParcelles({ code_insee: '99999', surface_min_m2: 1000 }, deps([
    R.geo, (u) => u.includes('cadastre.data.gouv.fr') ? http(503) : undefined,
    (u) => u.includes('/api/cadastre/parcelle?code_insee=99999') ? (u.includes('_start=0') ? copie(FX.apicarto) : { type: 'FeatureCollection', features: [] }) : undefined,
    R.gpu, R.bati,
  ], journal));
  assert.equal(s.status, 'ok');
  assert.match(String((s.stats as any).source_cadastre), /API Carto/);
  assert.ok(journal.some((u) => u.includes('_limit=1000&_start=0')));
  assert.equal((s.stats as any).couverture_cadastre, 'complete');
});

Deno.test('GPU rectangle en échec → repli point par point', async () => {
  const s = await rechercherParcelles({ code_insee: '99999', surface_min_m2: 1500 }, deps([
    R.geo, R.etalab, R.bati,
    (u) => {
      if (!u.includes('/api/gpu/zone-urba')) return undefined;
      const g = JSON.parse(decodeURIComponent(u.split('geom=')[1]));
      if (g.type !== 'Point') return http(500);
      // renvoie la zone U pour tout point (suffisant pour vérifier le chemin)
      return { type: 'FeatureCollection', features: [copie(FX.gpu.features[0])] };
    },
  ]));
  const st = s.stats as any;
  assert.equal(st.zonage.methode, 'points');
  assert.ok(s.items.every((i) => i.zonage_statut === 'lu'));
  assert.ok(s.avertissements.some((a) => a.includes('Zonage')));
});

Deno.test('GPU injoignable : zonage null « non_verifie », jamais inventé ; avec filtre → no_data', async () => {
  const gpuKo = (u: string) => u.includes('/api/gpu/') ? http(502) : undefined;
  const s = await rechercherParcelles({ code_insee: '99999' }, deps([R.geo, R.etalab, gpuKo, R.bati]));
  assert.equal(s.status, 'ok');
  assert.ok(s.items.every((i) => i.zonage_plu === null && i.zonage_statut === 'non_verifie'));
  const f = await rechercherParcelles({ code_insee: '99999', zonages: ['U'] }, deps([R.geo, R.etalab, gpuKo, R.bati]));
  assert.equal(f.status, 'no_data');
  assert.equal(f.items.length, 0);
});

Deno.test('GPU sans zone sur le secteur + commune au RNU : averti', async () => {
  const s = await rechercherParcelles({ code_insee: '99999' }, deps([
    R.geo, R.etalab, R.bati,
    (u) => u.includes('/api/gpu/zone-urba') ? { type: 'FeatureCollection', features: [] } : undefined,
    (u) => u.includes('/api/gpu/municipality') ? FX.muni : undefined,
  ]));
  assert.ok(s.items.every((i) => i.zonage_statut === 'hors_zone_publiee' && i.zonage_plu === null));
  assert.equal((s.stats as any).zonage.commune_rnu, true);
  assert.ok(s.avertissements.some((a) => a.includes('RÈGLEMENT NATIONAL')));
});

Deno.test('BD TOPO injoignable + exclure_bati : filtre NON appliqué et dit', async () => {
  const s = await rechercherParcelles({ code_insee: '99999', exclure_bati: true }, deps([
    R.geo, R.etalab, R.gpu, (u) => u.includes('data.geopf.fr') ? new Error('connexion refusée') : undefined,
  ]));
  assert.ok(s.items.some((i) => i.idu === '99999000AB0006'));
  assert.ok(s.items.every((i) => i.bati_detecte === null));
  assert.ok(s.avertissements.some((a) => a.includes("N'A PAS été appliqué")));
  assert.equal((s.stats as any).bati.filtre_applique, false);
});

Deno.test('cadastre entièrement injoignable → status error, aucun item', async () => {
  const s = await rechercherParcelles({ code_insee: '99999' }, deps([R.geo, (u) => u.includes('cadastre') ? http(503) : undefined]));
  assert.equal(s.status, 'error');
  assert.equal(s.items.length, 0);
});

Deno.test('Paris 75056 → demande l\'arrondissement, aucun appel cadastre', async () => {
  const journal: string[] = [];
  const s = await rechercherParcelles({ code_insee: '75056' }, deps([], journal));
  assert.equal(s.status, 'error');
  assert.match(s.summary, /75101 à 75120/);
  assert.equal(journal.length, 0);
});

Deno.test('commune ambiguë → error avec la liste des communes possibles', async () => {
  const s = await rechercherParcelles({ commune: 'Saint-Test' }, deps([(u) => u.startsWith('https://geo.api.gouv.fr/communes?') ? FX.ambigu : undefined]));
  assert.equal(s.status, 'error');
  assert.equal((s.stats as any).communes_possibles.length, 2);
});

Deno.test('cercle : seules les parcelles dont le centroïde est dans le rayon', async () => {
  // centre sur la parcelle 0001 (30 m, 30 m), rayon 60 m → 0001 et 0002 (centre à 70 m, 20 m → 40 m)
  const kx = 111320 * Math.cos((48.8 * Math.PI) / 180), ky = 110574;
  const centre = [2.30 + 30 / kx, 48.80 + 30 / ky];
  const journal: string[] = [];
  const s = await rechercherParcelles({ centre, rayon_m: 60 }, deps([
    (u) => u.includes('/api/cadastre/parcelle?geom=') ? copie(FX.apicarto) : undefined, R.gpu, R.bati,
  ], journal));
  assert.deepEqual(s.items.map((i) => i.idu).sort(), ['99999000AB0001', '99999000AB0002']);
  assert.ok(journal[0].includes('geom='));
});

Deno.test('rectangle trop grand → refusé', async () => {
  const s = await rechercherParcelles({ bbox: [2.0, 48.0, 2.5, 48.5] }, deps([]));
  assert.equal(s.status, 'error');
  assert.match(s.summary, /trop grand/);
});

Deno.test('budget temps : pagination API Carto arrêtée, couverture partielle signalée', async () => {
  // Pages pleines à l'infini ; l'horloge avance de 2,5 s par requête.
  let t = 0;
  const pagePleine = (start: number) => ({
    type: 'FeatureCollection',
    features: Array.from({ length: REGLAGES.APICARTO_PAGE }, (_, k) => {
      const f = copie(FX.apicarto.features[0]);
      const n = String((start + k) % 10000).padStart(4, '0');
      f.properties.idu = `99999000${String.fromCharCode(65 + Math.floor((start + k) / 10000))}B${n}`;
      f.properties.numero = n;
      return f;
    }),
  });
  const fetchLent = fauxFetch([
    (u) => u.includes('cadastre.data.gouv.fr') ? http(500) : undefined,
    R.geo,
    (u) => {
      if (!u.includes('/api/cadastre/parcelle')) return undefined;
      const start = Number(new URL(u).searchParams.get('_start'));
      return pagePleine(start);
    },
    R.gpu, R.bati,
  ]);
  const d: Deps = { fetch: (async (...a: Parameters<typeof fetch>) => { t += 2500; return await fetchLent(...a); }) as typeof fetch, maintenant: () => t };
  const s = await rechercherParcelles({ code_insee: '99999', limite: 5 }, d);
  const st = s.stats as any;
  assert.equal(st.couverture_cadastre, 'partielle');
  assert.ok(st.parcelles_lues > 0 && st.parcelles_lues < REGLAGES.APICARTO_MAX_PAGES * REGLAGES.APICARTO_PAGE);
  assert.ok(s.avertissements.some((a) => a.includes('PARTIELLE')));
  assert.ok(s.items.length <= 5);
});
