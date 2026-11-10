// Tests de la partie copilot-chat du lot INT-10 (outil amenager_interieur) :
// la logique pure est EXTRAITE de ../copilot-chat/index.ts entre les marqueurs
// « >>> INT-10 logique pure » et « <<< INT-10 logique pure », puis exécutée sur
// une vraie réponse de interior-architect-v1 (handler, auth mockée).
// Lancer : deno test --allow-read --allow-write tests/
import assert from 'node:assert/strict';
import { creerHandler } from '../handler.ts';

const src = await Deno.readTextFile(new URL('../../copilot-chat/index.ts', import.meta.url));
const debut = src.indexOf('// >>> INT-10 logique pure');
const fin = src.indexOf('// <<< INT-10 logique pure');
assert.ok(debut > 0 && fin > debut, 'marqueurs INT-10 introuvables dans copilot-chat/index.ts');
const bloc = src.slice(debut, fin);
const module = `type ToolStatus = 'ok' | 'confirmation_requise' | 'not_configured' | 'not_found' | 'partial' | 'error';\n${bloc}\n` +
  'export { construireBriefInterieur, interieurPertinent, summarizeInteriorArchitect, QUESTIONS_BRIEF_INTERIEUR };\n';
const tmp = await Deno.makeTempFile({ suffix: '.ts' });
await Deno.writeTextFile(tmp, module);
const M = await import(`file://${tmp}`);

const fx = JSON.parse(await Deno.readTextFile(new URL('./fixtures/p03-t3.json', import.meta.url)));
const handler = creerHandler({ env: { get: (k: string) => ({ SUPABASE_SECRET_KEYS: '{"d":"k"}', SUPABASE_URL: 'x', INTERIOR_BUDGET_MS: '60000' } as Record<string, string>)[k] } });
const appeler = async (body: unknown) => (await handler(new Request('http://l', { method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify(body) }))).json();

const INPUT_COMPLET = { cible: 'famille', adultes: 2, enfants: 1, style: 'contemporain', gamme: 'standard', teletravail: false, pmr: false };

Deno.test('copilot : brief construit à partir des champs de l\'outil = brief du banc', () => {
  const { brief, manquants } = M.construireBriefInterieur(INPUT_COMPLET);
  assert.deepEqual(manquants, []);
  assert.deepEqual(brief, fx.brief);
});

Deno.test('copilot : brief incomplet → champs manquants listés, rien de supposé (enfants compris)', () => {
  const { brief, manquants } = M.construireBriefInterieur({ cible: 'couple', adultes: 2, style: 'japandi' });
  assert.equal(brief, null);
  assert.deepEqual(manquants, ['enfants', 'gamme', 'teletravail', 'pmr']);
  assert.ok(manquants.every((k: string) => typeof M.QUESTIONS_BRIEF_INTERIEUR[k] === 'string'));
  assert.ok(M.construireBriefInterieur({ ...INPUT_COMPLET, style: 'baroque' }).manquants.includes('style'));
});

Deno.test('copilot : détection du sujet « aménagement »', () => {
  assert.equal(M.interieurPertinent(['Peux-tu aménager mon T3 ?']), true);
  assert.equal(M.interieurPertinent(['', 'Quel style de mobilier préférez-vous ?']), true);
  assert.equal(M.interieurPertinent(['Quel est le prix au m² à Lyon ?']), false);
});

Deno.test('copilot : résumé compact d\'une vraie réponse (p03-t3) — verdict par pièce, 3 choix, manques, coût', async () => {
  const raw = await appeler({ plan: fx.plan, brief: fx.brief });
  const s = M.summarizeInteriorArchitect(raw);
  assert.equal(s.status, 'ok');
  const d = s.data;
  assert.equal(d.variante_recommandee, 'Variante A');
  assert.equal(d.verdicts_par_piece.length, fx.plan.rooms.length);
  assert.equal(d.choix_principaux.length, 3);
  assert.ok(d.choix_principaux.every((c: { justification: string }) => c.justification.length > 0));
  assert.ok(Array.isArray(d.manques) && d.manques.length <= 10);
  assert.match(d.cout, /jetons/);
  const taille = JSON.stringify(s).length;
  assert.ok(taille < 8000, `résumé trop long pour le LLM : ${taille} caractères`);
  console.log(`  résumé transmis au LLM : ${taille} caractères (réponse brute ${JSON.stringify(raw).length})`);
});

Deno.test('copilot : points d\'eau supposés → « à confirmer » dans le résumé', async () => {
  const plan = { ...fx.plan, fixtures: fx.plan.fixtures.filter((f: { kind: string }) => !['gaine', 'arrivee_eau', 'evacuation'].includes(f.kind)) };
  const s = M.summarizeInteriorArchitect(await appeler({ plan, brief: fx.brief, variants: 2 }));
  assert.ok(s.data.points_eau_supposes.length >= 2);
  assert.ok(s.data.points_eau_supposes.every((p: { statut: string }) => p.statut === 'à confirmer'));
});

Deno.test('copilot : description seule → not_found, message honnête, aucun aménagement', async () => {
  const s = M.summarizeInteriorArchitect(await appeler({ description: 'T3 de 62 m²' }));
  assert.equal(s.status, 'not_found');
  assert.match(s.message, /sans son plan/);
  assert.match(s.message, /N'invente ni plan ni aménagement/);
  assert.equal(s.data.verdicts_par_piece, undefined);
});

Deno.test('copilot : entrée invalide et réponse illisible → error', async () => {
  const s = M.summarizeInteriorArchitect(await appeler({ plan: { id: 'x' }, brief: fx.brief }));
  assert.equal(s.status, 'error');
  assert.ok(s.data.erreurs.length > 0);
  assert.equal(M.summarizeInteriorArchitect(null).status, 'error');
});
