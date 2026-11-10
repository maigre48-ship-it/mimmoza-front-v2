// Tests du gestionnaire HTTP : requêtes simulées, authentification mockée
// (aucun réseau, aucun Supabase). Lancer : deno test --allow-read tests/
import assert from 'node:assert/strict';
import { creerHandler } from '../handler.ts';

const fx = JSON.parse(await Deno.readTextFile(new URL('./fixtures/p03-t3.json', import.meta.url)));
const pmr = JSON.parse(await Deno.readTextFile(new URL('./fixtures/p10-t3-pmr.json', import.meta.url)));

const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_TEST' }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_TEST' }),
  INTERIOR_BUDGET_MS: '60000', // tests : pas de coupure par le budget (voir logique.test.ts pour le budget)
};
const env = { get: (k: string) => ENV[k] };
const appelsAuth: string[] = [];
const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
  appelsAuth.push(String(url));
  const h = new Headers(init?.headers);
  if (h.get('authorization') === 'Bearer jwt-utilisateur-valide' && h.get('apikey') === 'sb_publishable_TEST') {
    return new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000001' }), { status: 200 });
  }
  return new Response('{"msg":"invalid JWT"}', { status: 401 });
}) as typeof fetch;

const handler = creerHandler({ env, fetchFn: fetchMock });
const post = (body: unknown, jeton: string | null = 'sb_secret_TEST') => handler(new Request('http://local/interior-architect-v1', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

Deno.test('CORS : OPTIONS → 204 avec en-têtes', async () => {
  const r = await handler(new Request('http://local/x', { method: 'OPTIONS' }));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-headers')!, /authorization/);
});

Deno.test('méthode : GET → 405', async () => {
  assert.equal((await handler(new Request('http://local/x'))).status, 405);
});

Deno.test('auth : sans jeton → 401 ; jeton invalide → 401 (GoTrue consulté)', async () => {
  assert.equal((await post({ description: 'T3' }, null)).status, 401);
  const n = appelsAuth.length;
  assert.equal((await post({ description: 'T3' }, 'jeton-bidon')).status, 401);
  assert.equal(appelsAuth.length, n + 1);
  assert.equal(appelsAuth.at(-1), 'https://exemple.supabase.co/auth/v1/user');
});

Deno.test('auth : clé secrète (appel interne copilot-chat) acceptée sans appel GoTrue ; JWT utilisateur valide accepté', async () => {
  const n = appelsAuth.length;
  assert.equal((await post({ description: 'T3' })).status, 200);
  assert.equal(appelsAuth.length, n);
  assert.equal((await post({ description: 'T3' }, 'jwt-utilisateur-valide')).status, 200);
});

Deno.test('BOUT EN BOUT : plan du banc p03-t3 + brief → variantes triées, résumé, synthèse', async () => {
  const r = await post({ plan: fx.plan, brief: fx.brief, seed: 1, variants: 3 });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'ok');
  assert.ok(j.variantes.length >= 2 && j.variantes.length <= 3, `variantes : ${j.variantes.length}`);
  for (const v of j.variantes) {
    assert.ok(v.layout.placements.length > 0);
    assert.ok(['favorable', 'reserve', 'defavorable'].includes(v.rapport.verdict));
    assert.equal(v.feuilleDeStyle.styleId, 'contemporain');
    assert.ok(Array.isArray(v.pointsEauSupposes));
  }
  const rang = { favorable: 0, reserve: 1, defavorable: 2 } as Record<string, number>;
  for (let i = 1; i < j.variantes.length; i++) {
    const a = j.variantes[i - 1], b = j.variantes[i];
    assert.ok(rang[a.verdict]! < rang[b.verdict]! || (rang[a.verdict] === rang[b.verdict] && a.score >= b.score));
  }
  assert.match(j.resumeTexte, /^Variante A recommandée/);
  assert.equal(j.synthese.choixPrincipaux.length, 3);
  assert.ok(j.synthese.verdictsParPiece.length === fx.plan.rooms.length);
  assert.equal(j.moteur.version, '0.3.0');
  for (const v of j.variantes) assert.ok(Array.isArray(v.choixGaines));
  console.log(`  p03-t3 : ${j.variantes.map((v: { libelle: string; seed: number; verdict: string; score: number; duree_ms: number }) => `${v.libelle}/graine ${v.seed} ${v.verdict} ${v.score} (${v.duree_ms} ms)`).join(' | ')} ; total ${j.duree_ms} ms ; écartées ${j.ecartees.length}`);
});

Deno.test('BOUT EN BOUT : plan sans points d\'eau → gaines supposées à confirmer', async () => {
  const plan = { ...fx.plan, fixtures: fx.plan.fixtures.filter((f: { kind: string }) => !['gaine', 'arrivee_eau', 'evacuation'].includes(f.kind)) };
  const j = await (await post({ plan, brief: fx.brief, variants: 2 })).json();
  assert.equal(j.status, 'ok');
  assert.ok(j.synthese.pointsEauSupposes.length >= 2);
  assert.ok(j.synthese.pointsEauSupposes.every((p: { statut: string }) => p.statut === 'a_confirmer'));
});

Deno.test('BOUT EN BOUT : plan PMR p10 (brief PMR) → verdict du moteur transmis tel quel ; si défavorable, bloquantes citées', async () => {
  const j = await (await post({ plan: pmr.plan, brief: pmr.brief, variants: 2 })).json();
  assert.equal(j.status, 'ok');
  // On ne maquille pas un défavorable : le verdict du moteur est transmis.
  assert.equal(j.synthese.verdict, j.variantes[0].rapport.verdict);
  if (j.synthese.verdict === 'defavorable') assert.ok(j.synthese.bloquantesLogement.length + j.synthese.verdictsParPiece.reduce((n: number, p: { bloquantes: string[] }) => n + p.bloquantes.length, 0) > 0);
  // Même plan dépouillé de ses points d'eau. Moteur 0.2.0 (INT-10) : verdict défavorable (CIR-06b, gaine R3 mal placée).
  // Moteur 0.3.0 (INT-10b) : la recherche de la gaine optimale (`amenager`) supprime les violations bloquantes ;
  // la gaine retenue n'est pas la position R3 d'origine et reste « à confirmer ».
  const sec = { ...pmr.plan, fixtures: pmr.plan.fixtures.filter((f: { kind: string }) => !['gaine', 'arrivee_eau', 'evacuation'].includes(f.kind)) };
  const k = await (await post({ plan: sec, brief: pmr.brief, variants: 2 })).json();
  assert.equal(k.status, 'ok');
  assert.equal(k.synthese.verdict, k.variantes[0].rapport.verdict);
  assert.notEqual(k.synthese.verdict, 'defavorable');
  assert.equal(k.variantes[0].rapport.violations.filter((v: { severity: string }) => v.severity === 'bloquante').length, 0);
  assert.deepEqual(k.synthese.bloquantesLogement, []);
  assert.ok(k.variantes[0].choixGaines.some((c: { rangR3: number }) => c.rangR3 > 0), 'au moins une gaine déplacée hors de la position R3');
  assert.ok(k.synthese.pointsEauSupposes.length >= 2 && k.synthese.pointsEauSupposes.every((p: { statut: string }) => p.statut === 'a_confirmer'));
  assert.ok(k.synthese.hypotheses.some((h: string) => h.includes('Position retenue par évaluation de l\'aménagement')));
  assert.doesNotMatch(k.resumeTexte, /verdict défavorable/);
});

Deno.test('DESCRIPTION SEULE : « T3 de 62 m² » → plan_requis, aucune variante, aucun plan inventé', async () => {
  const r = await post({ description: 'T3 de 62 m² à Lyon', brief: fx.brief });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'plan_requis');
  assert.deepEqual(j.variantes, []);
  assert.equal(j.plan, undefined);
  assert.deepEqual(j.compris, { typologie: 'T3', surface_m2: 62 });
  assert.match(j.resumeTexte, /^Je ne peux pas aménager ce logement sans son plan/);
  assert.ok(j.comment_obtenir_un_plan.some((s: string) => s.includes('Studio')));
});

Deno.test('roomPlan du Studio → refus motivé (conversion non embarquée)', async () => {
  const j = await (await post({ roomPlan: { rooms: [] }, brief: fx.brief })).json();
  assert.equal(j.status, 'plan_studio_non_converti');
  assert.deepEqual(j.variantes, []);
});

Deno.test('entrées invalides : rien, deux sources, plan incohérent, brief manquant, JSON illisible', async () => {
  assert.equal((await (await post({})).json()).status, 'plan_requis');
  assert.equal((await (await post({ plan: fx.plan, description: 'T3' })).json()).status, 'entree_invalide');
  const casse = { ...fx.plan, openings: [{ ...fx.plan.openings[0], wallId: 'inconnu' }] };
  const j1 = await (await post({ plan: casse, brief: fx.brief })).json();
  assert.equal(j1.status, 'entree_invalide');
  assert.ok(j1.erreurs.some((e: { chemin: string }) => e.chemin === 'plan.openings.0.wallId'));
  const j2 = await (await post({ plan: fx.plan })).json();
  assert.equal(j2.status, 'entree_invalide');
  assert.equal(j2.questions.length, 6);
  assert.equal((await post('{pas du json')).status, 400);
});
