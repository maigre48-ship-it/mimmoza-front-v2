// deno test --no-check -A supabase/functions/copilot-chat/agent/vis20-rester-dans-le-chat.test.ts
// VIS-20 (23/11/2026) — sur la page MimmozIA, aucune action de Mimmo ne fait quitter le chat.
import * as na from 'node:assert/strict';
const assert = (v: unknown) => na.ok(v);
const assertEquals = (a: unknown, b: unknown) => na.deepEqual(a, b);
const assertMatch = (s: string, r: RegExp) => na.match(s, r);
import { CONSIGNE_RESTER_DANS_LE_CHAT, estPageMimmozIA, outilHorsChat, refusRouteHorsChat } from './rester-dans-le-chat.ts';

Deno.test('page MimmozIA : /mimmozia et /accueil, rien d’autre', () => {
  assert(estPageMimmozIA('/mimmozia'));
  assert(estPageMimmozIA('/mimmozia/?conversation=x'));
  assert(estPageMimmozIA('/accueil'));
  assert(!estPageMimmozIA('/promoteur/foncier'));
  assert(!estPageMimmozIA(undefined));
});

Deno.test('outils retirés sur MimmozIA : création d’opération et lancement d’étape ; ailleurs inchangé', () => {
  assert(outilHorsChat('action_creer_operation', '/mimmozia'));
  assert(outilHorsChat('action_lancer_etape', '/mimmozia'));
  assert(!outilHorsChat('action_ouvrir_page', '/mimmozia'));
  assert(!outilHorsChat('rechercher_parcelles', '/mimmozia'));
  assert(!outilHorsChat('proposer_mission', '/mimmozia'));
  assert(!outilHorsChat('action_creer_operation', '/promoteur/foncier'));
});

Deno.test('action_ouvrir_page : Foncier / Programmation / Implantation refusées depuis MimmozIA, le reste permis', () => {
  assertMatch(refusRouteHorsChat('/promoteur/foncier?study=abc', '/mimmozia') ?? '', /dans le chat/);
  assert(refusRouteHorsChat('/promoteur/programmation', '/mimmozia'));
  assert(refusRouteHorsChat('/promoteur/implantation-2d', '/accueil'));
  assertEquals(refusRouteHorsChat('/veille/marche', '/mimmozia'), null);
  assertEquals(refusRouteHorsChat('/promoteur/foncier', '/promoteur/marche'), null);
});

Deno.test('consigne : terrain et conception dans le chat, enchaînement sur l’étape 2', () => {
  assertMatch(CONSIGNE_RESTER_DANS_LE_CHAT, /rechercher_parcelles/);
  assertMatch(CONSIGNE_RESTER_DANS_LE_CHAT, /proposer_mission/);
  assertMatch(CONSIGNE_RESTER_DANS_LE_CHAT, /étape 2/);
  assertMatch(CONSIGNE_RESTER_DANS_LE_CHAT, /assiette/);
});
