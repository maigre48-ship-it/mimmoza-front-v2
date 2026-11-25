// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis45-studio-commandes.test.ts
// VIS-45 — le chat Mimmoza commande le Studio : outil `studio_commander` (validation, accord lu dans le message reçu),
// mémoire des comptes rendus du Studio, branchement dans index.ts.
import * as na from 'node:assert/strict';
const assert = (v: unknown, m?: string) => na.ok(v, m);
const assertEquals = (a: unknown, b: unknown) => na.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => na.match(s, re);
const assertStringIncludes = (s: string, x: string) => na.ok(s.includes(x), `« ${x} » absent`);
import {
  accordDansLeMessage, blocComptesRendusStudio, executerOutilStudioCommander, OUTIL_STUDIO_COMMANDER, OUTIL_STUDIO_COMMANDER_DEF, studioCommandePertinente,
} from './studio-commandes.ts';
import { CATALOGUE_COMMANDES_CHAT } from '../../../../src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts';

const env = (texteRecu: string) => ({ texteRecu, maintenant: () => 1_000 });

Deno.test('VIS-45 · meubler en scandinave : commande validée, carte pour le site, rien de « fait » annoncé', () => {
  const r = executerOutilStudioCommander({ commande: 'interieur-amenager', params: { style: 'scandinave', gamme: 'premium' } }, env('Meuble le T3 en scandinave, gamme premium'));
  assertEquals(r.status, 'ok');
  assertEquals(r.data?.carte, 'commande-studio');
  assertEquals(r.data?.commande, { id: 'interieur-amenager', params: { style: 'scandinave', gamme: 'premium' } });
  assertEquals(r.data?.emis_le, 1_000);
  assertStringIncludes(r.message ?? '', 'Ne dis pas qu');
});

Deno.test('VIS-45 · paramètres hors catalogue refusés ; commande inconnue refusée', () => {
  assertEquals(executerOutilStudioCommander({ commande: 'interieur-style', params: { style: 'baroque' } }, env('style baroque')).status, 'error');
  assertEquals(executerOutilStudioCommander({ commande: 'supprimer-batiment' }, env('supprime')).status, 'error');
  assertEquals(executerOutilStudioCommander({}, env('?')).status, 'error');
});

Deno.test('VIS-45 · phrase libre (façade) : rejouée par le Studio sans IA', () => {
  const r = executerOutilStudioCommander({ phrase: 'mets la façade en brique' }, env('Mets la façade en brique'));
  assertEquals(r.data?.carte, 'commande-studio');
  assertEquals(r.data?.phrase, 'mets la façade en brique');
  assertEquals(r.data?.commande, null);
});

Deno.test('VIS-45 · « génère les plans d’architecte » : demande explicite = accord (jamais deux fois la même question)', () => {
  const r = executerOutilStudioCommander({ commande: 'plans-architecte', params: { format: 'A3' }, confirme: true }, env('Génère les plans d’architecte de mon bâtiment'));
  assertEquals(r.data?.carte, 'commande-studio');
  assertEquals((r.data?.commande as { confirme?: boolean }).confirme, true);
});

Deno.test('VIS-45 · action longue sans accord dans le message reçu : question, rien envoyé (même si le modèle met confirme)', () => {
  const r = executerOutilStudioCommander({ commande: 'film', params: {}, confirme: true }, env('et pour la suite ?'));
  assertEquals(r.data?.carte, 'attente-accord');
  const ok = executerOutilStudioCommander({ commande: 'film', params: {}, confirme: true }, env('Oui, vas-y'));
  assertEquals(ok.data?.carte, 'commande-studio');
  assert(accordDansLeMessage('lancer-visite', 'lance la visite du logement'));
  assert(!accordDansLeMessage('film', 'combien de temps dure le film ?'));
});

Deno.test('VIS-45 · outil proposé quand le tour parle d’un geste du Studio ; catalogue dans la description', () => {
  assert(studioCommandePertinente(['décale le canapé de 50 cm vers la gauche']));
  assert(studioCommandePertinente(['fais-moi les plans']));
  assert(!studioCommandePertinente(['quel est le prix moyen à Bayonne ?']));
  assertEquals(OUTIL_STUDIO_COMMANDER_DEF.name, OUTIL_STUDIO_COMMANDER);
  for (const e of CATALOGUE_COMMANDES_CHAT) assertStringIncludes(OUTIL_STUDIO_COMMANDER_DEF.description, e.id);
});

Deno.test('VIS-45 · mémoire : derniers comptes rendus du Studio (origine studio seulement), du plus ancien au plus récent', () => {
  const bloc = blocComptesRendusStudio([
    { created_at: '2026-11-25T10:05:00Z', message: 'Plans d’architecte prêts : PDF, DXF.', outcome: 'done', params: { origine: 'studio', type: 'compte-rendu', libelle: 'Plans d’architecte', fichiers: [{ nom: 'plans-A3.pdf' }] } },
    { created_at: '2026-11-25T10:00:00Z', message: 'Bâtiment dessiné posé sur la parcelle.', outcome: 'done', params: { origine: 'studio', type: 'notification' } },
    { created_at: '2026-11-25T09:00:00Z', message: 'Autre trace', outcome: 'done', params: { origine: 'action' } },
  ]);
  assertMatch(bloc, /^STUDIO 3D — DERNIERS COMPTES RENDUS/);
  assert(bloc.indexOf('Bâtiment dessiné posé') < bloc.indexOf('Plans d’architecte → fait'));
  assertStringIncludes(bloc, 'plans-A3.pdf');
  assert(!bloc.includes('Autre trace'));
  assertEquals(blocComptesRendusStudio([]), '');
});

Deno.test('VIS-45 · index.ts : outil déclaré, exécuté, filtré au vertical promoteur, comptes rendus relus', async () => {
  const src = await Deno.readTextFile(new URL('../index.ts', import.meta.url));
  assertStringIncludes(src, 'OUTIL_STUDIO_COMMANDER_DEF,');
  assertStringIncludes(src, 'case OUTIL_STUDIO_COMMANDER:');
  assertStringIncludes(src, "|| tool.name === OUTIL_STUDIO_COMMANDER))");
  assertStringIncludes(src, "eq('params->>origine', 'studio')");
});
