// Tests de la logique PURE (validation, tri, résumé, lecture de description).
// Lancer : deno test --allow-read tests/   (depuis supabase/functions/interior-architect-v1)
import assert from 'node:assert/strict';
import { validerBrief, validerPlan, RequeteSchema } from '../schemas.ts';
import { calculerVariantes, scoreDeTri, trierVariantes, signatureLayout } from '../pipeline.ts';
import { lireDescription, resumeTexte, texteRefusDescription, choixPrincipaux } from '../resume.ts';
import type { InteriorReport, LayoutPlan, PlanInput } from '../moteur/types.ts';

const fx = JSON.parse(await Deno.readTextFile(new URL('./fixtures/p03-t3.json', import.meta.url)));
const PLAN: PlanInput = fx.plan;
const BRIEF = fx.brief;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

Deno.test('validation : le plan du banc p03-t3 est accepté tel quel', () => {
  const r = validerPlan(clone(PLAN));
  assert.equal(r.ok, true);
});

Deno.test('validation : clé inconnue refusée (strict)', () => {
  const r = validerPlan({ ...clone(PLAN), inventé: true });
  assert.equal(r.ok, false);
});

Deno.test('validation : ouverture sur un mur inconnu refusée, chemin précis', () => {
  const p = clone(PLAN);
  p.openings[0]!.wallId = 'mur-fantome';
  const r = validerPlan(p);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.erreurs.some((e) => e.chemin === 'plan.openings.0.wallId' && e.message.includes('mur-fantome')));
});

Deno.test('validation : équipement dans une pièce inconnue, identifiants en double, coordonnée hors bornes', () => {
  const p = clone(PLAN);
  p.fixtures[0]!.roomId = 'nulle-part';
  p.rooms[1]!.id = p.rooms[0]!.id;
  p.walls[0]!.a = [1e6, 0];
  const r = validerPlan(p);
  assert.equal(r.ok, false);
  if (!r.ok) {
    const m = r.erreurs.map((e) => `${e.chemin} ${e.message}`).join('\n');
    assert.match(m, /nulle-part/);
    assert.match(m, /en double/);
    assert.match(m, /plan\.walls\.0\.a\.0/);
  }
});

Deno.test('validation brief : défauts (version, animaux, listes) et refus des valeurs hors énumération', () => {
  const ok = validerBrief({ target: 'couple', occupants: { adults: 2, children: 0 }, style: 'japandi', gamme: 'premium', constraints: { teletravail: true, pmr: false } });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.brief.version, 1);
    assert.equal(ok.brief.constraints.animaux, false);
    assert.deepEqual(ok.brief.imposed, []);
  }
  assert.equal(validerBrief({ ...BRIEF, style: 'baroque' }).ok, false);
  assert.equal(validerBrief({ ...BRIEF, occupants: { adults: 0, children: 1 } }).ok, false);
  assert.equal(validerBrief({ ...BRIEF, couleur: 'rose' }).ok, false);
});

Deno.test('requête : variants borné à 2..3, clé inconnue refusée', () => {
  assert.equal(RequeteSchema.safeParse({ plan: {}, variants: 4 }).success, false);
  assert.equal(RequeteSchema.safeParse({ plan: {}, variants: 1 }).success, false);
  assert.equal(RequeteSchema.safeParse({ plan: {}, variants: 2 }).success, true);
  assert.equal(RequeteSchema.safeParse({ plan: {}, autre: 1 }).success, false);
});

// ── Tri ──
const faux = (seed: number, verdict: 'favorable' | 'reserve' | 'defavorable', score: number, bloq = 0, nonPlaces = 0) => ({
  seed, verdict, score,
  rapport: { violations: Array.from({ length: bloq }, () => ({ severity: 'bloquante' })) } as unknown as InteriorReport,
  layout: { unplaced: Array.from({ length: nonPlaces }, () => ({})) } as unknown as LayoutPlan,
});

Deno.test('tri : verdict d\'abord, puis score décroissant, puis graine', () => {
  const t = trierVariantes([faux(1, 'reserve', 99), faux(2, 'favorable', 80), faux(3, 'defavorable', 100), faux(4, 'favorable', 90), faux(5, 'favorable', 90)]);
  assert.deepEqual(t.map((v) => v.seed), [4, 5, 2, 1, 3]);
});

Deno.test('tri : à verdict et score égaux, moins de bloquantes puis moins de non placés', () => {
  const t = trierVariantes([faux(1, 'defavorable', 50, 3), faux(2, 'defavorable', 50, 1, 4), faux(3, 'defavorable', 50, 1, 2)]);
  assert.deepEqual(t.map((v) => v.seed), [3, 2, 1]);
});

Deno.test('score de tri : moyenne des scores de famille, 100 sans pièce', () => {
  const r = { rooms: [{ scores: [{ score: 100 }, { score: 80 }] }, { scores: [{ score: 60 }] }] } as unknown as InteriorReport;
  assert.equal(scoreDeTri(r), 80);
  assert.equal(scoreDeTri({ rooms: [] } as unknown as InteriorReport), 100);
});

// ── Chaîne complète (pure) ──
Deno.test('variantes : 2 à 3 variantes triées, déterministes, plan d\'entrée non modifié', () => {
  const entree = clone(PLAN);
  const avant = JSON.stringify(entree);
  const a = calculerVariantes(entree, BRIEF, { seed: 1, nombre: 3, budgetMs: 60_000 });
  const b = calculerVariantes(clone(PLAN), BRIEF, { seed: 1, nombre: 3, budgetMs: 60_000 });
  assert.equal(JSON.stringify(entree), avant);
  assert.ok(a.variantes.length >= 1 && a.variantes.length + a.ecartees.length === 3);
  assert.deepEqual(a.variantes.map((v) => signatureLayout(v.layout)), b.variantes.map((v) => signatureLayout(v.layout)));
  assert.deepEqual(a.variantes.map((v) => v.seed), trierVariantes(a.variantes).map((v) => v.seed));
  assert.deepEqual(a.variantes.map((v) => v.libelle), ['Variante A', 'Variante B', 'Variante C'].slice(0, a.variantes.length));
});

Deno.test('variantes : budget dépassé → variantes suivantes écartées et SIGNALÉES', () => {
  let t = 0;
  const horloge = () => (t += 1000); // chaque lecture avance d'1 s
  const r = calculerVariantes(clone(PLAN), BRIEF, { seed: 1, nombre: 3, budgetMs: 1500, maintenant: horloge });
  assert.equal(r.variantes.length, 1);
  assert.equal(r.ecartees.length, 2);
  assert.ok(r.ecartees.every((e) => e.motif.includes('budget')));
});

Deno.test('points d\'eau : plan sans point d\'eau → gaines supposées « à confirmer » dans la réponse', () => {
  const p = clone(PLAN);
  p.fixtures = p.fixtures.filter((f) => !['gaine', 'arrivee_eau', 'evacuation'].includes(f.kind));
  const r = calculerVariantes(p, BRIEF, { seed: 1, nombre: 2, budgetMs: 60_000 });
  const v = r.variantes[0]!;
  assert.ok(v.pointsEauSupposes.length >= 2);
  assert.ok(v.pointsEauSupposes.every((x) => x.statut === 'a_confirmer' && x.raison.length > 0));
  assert.ok(v.rapport.assumptions.some((a) => a.includes('à confirmer')));
  const txt = resumeTexte(p, BRIEF, r);
  assert.match(txt, /Points d'eau supposés \(à confirmer\) :/);
});

Deno.test('résumé : réponse d\'abord, tirets, aucune suite de numéros en paragraphe', () => {
  const r = calculerVariantes(clone(PLAN), BRIEF, { seed: 1, nombre: 3, budgetMs: 60_000 });
  const txt = resumeTexte(PLAN, BRIEF, r);
  const lignes = txt.split('\n');
  assert.match(lignes[0]!, /^Variante A recommandée : verdict /);
  assert.ok(lignes.some((l) => l.startsWith('- ')));
  assert.ok(!/^\s*\d+[.)]\s/m.test(txt), 'pas de liste numérotée');
  assert.ok(lignes.every((l) => !/\b[1-9][.)]\s.*\b[2-9][.)]\s/.test(l)), 'pas de numéros enchaînés dans une ligne');
  assert.ok(!/\(\d\)/.test(txt), 'pas de (1) (2) (3)');
  assert.equal(choixPrincipaux(r.variantes[0]!).length, 3);
  assert.match(txt, /Aucune cloison n'est déplacée/);
});

Deno.test('description : typologie et surface comprises, refus sans plan inventé', () => {
  assert.deepEqual(lireDescription('Un T3 de 62 m² à Lyon'), { typologie: 'T3', surface_m2: 62 });
  assert.deepEqual(lireDescription('studio 18,5 m2'), { typologie: 'studio', surface_m2: 18.5 });
  assert.deepEqual(lireDescription('F4 lumineux'), { typologie: 'T4', surface_m2: null });
  assert.deepEqual(lireDescription('un appartement'), { typologie: null, surface_m2: null });
  const t = texteRefusDescription({ typologie: 'T3', surface_m2: 62 });
  assert.match(t, /^Je ne peux pas aménager ce logement sans son plan \(compris : T3, 62 m²\)\./);
  assert.match(t, /Studio/);
});

// ── INT-10b : gaine optimale (moteur 0.3.0, `amenager`) ──
const pmr = JSON.parse(await Deno.readTextFile(new URL('./fixtures/p10-t3-pmr.json', import.meta.url)));
const sansEau = (p: PlanInput): PlanInput => ({ ...clone(p), fixtures: p.fixtures.filter((f) => !['gaine', 'arrivee_eau', 'evacuation'].includes(f.kind)) });
const nbBloq = (r: InteriorReport) => r.violations.filter((v) => v.severity === 'bloquante').length;

Deno.test('gaine optimale : p10 PMR dépouillé → variante A sans violation bloquante (0.2.0 : défavorable), gaine déplacée « à confirmer »', () => {
  const r = calculerVariantes(sansEau(pmr.plan), pmr.brief, { seed: 1, nombre: 2, budgetMs: 60_000 });
  const a = r.variantes[0]!;
  assert.equal(nbBloq(a.rapport), 0);
  assert.notEqual(a.verdict, 'defavorable');
  assert.ok(a.choixGaines.some((c) => c.rangR3 > 0));
  assert.ok(a.pointsEauSupposes.every((p) => p.statut === 'a_confirmer'));
  assert.ok(r.hypothesesPointsEau.some((h) => h.includes('Position retenue par évaluation de l\'aménagement')));
  assert.match(resumeTexte(pmr.plan, pmr.brief, r), /^Variante A recommandée : verdict favorable/);
});

Deno.test('gaine optimale désactivée (maxCandidats 1 = comportement 0.2.0) : p10 dépouillé défavorable, bloquantes citées dans le résumé', () => {
  const p = sansEau(pmr.plan);
  const r = calculerVariantes(p, pmr.brief, { seed: 1, nombre: 2, budgetMs: 60_000, maxCandidats: 1 });
  assert.equal(r.variantes[0]!.verdict, 'defavorable');
  assert.ok(r.variantes.every((v) => v.choixGaines.every((c) => c.rangR3 === 0)));
  const txt = resumeTexte(p, pmr.brief, r);
  assert.match(txt, /verdict défavorable/);
  assert.match(txt, /\[[A-Z]{3}-\d+[a-z]?\]/);
});

Deno.test('gaines : la variante B reprend les gaines retenues pour A quand sa propre recherche ne tient pas dans le budget', () => {
  // Horloge : 10 ms par lecture, budget 100 ms. A : base 10 ms, recherche estimée 6 × 10 + 10 (réserve B) → lancée.
  // B : base 10 ms, recherche estimée 60 ms au-delà du budget → non lancée : B garde les gaines (optimisées) de A.
  let t = 0;
  const r = calculerVariantes(sansEau(pmr.plan), pmr.brief, { seed: 1, nombre: 2, budgetMs: 100, maintenant: () => (t += 10) });
  assert.equal(r.variantes.length, 2);
  const [a, b] = [...r.variantes].sort((x, y) => x.seed - y.seed);
  assert.ok(a!.choixGaines.some((c) => c.rangR3 > 0), 'recherche de A lancée');
  assert.deepEqual(b!.pointsEauSupposes.map((x) => [x.pieceId, x.position]), a!.pointsEauSupposes.map((x) => [x.pieceId, x.position]));
  assert.deepEqual(b!.choixGaines, a!.choixGaines);
  assert.ok(b!.rapport.assumptions.some((x) => x.includes('à confirmer')));
});

Deno.test('gaine optimale : recherche non lancée si elle ne tient pas dans le budget (variante B préservée)', () => {
  // Horloge : 100 ms par lecture. Base A = 100 ms → recherche estimée 6 × 100 + 100 (réserve B) : budget 700 dépassé → pas de recherche ;
  // la variante B tient (500 ms écoulées + 100 ms ≤ 700).
  let t = 0;
  const r = calculerVariantes(sansEau(pmr.plan), pmr.brief, { seed: 1, nombre: 2, budgetMs: 700, maintenant: () => (t += 100) });
  assert.equal(r.variantes.length, 2);
  assert.ok(r.variantes.every((v) => v.choixGaines.every((c) => c.rangR3 === 0)));
});
