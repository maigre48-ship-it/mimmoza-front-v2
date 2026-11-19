// deno test --no-lock -A supabase/functions/copilot-chat/agent/vis14-brief.test.ts
// VIS-14 — copilot-chat : devis des précisions (B1), ambiance non forcée (I2), brief projet partiel (M1).
import * as na from 'node:assert/strict';
import { BRIEF_DEFAUT, resumeBriefProjetDevis, resumeOptions, reservesBrief, validerOptionsRendu } from './studio.ts';

const b = { ...BRIEF_DEFAUT, precisions: 'pas de brique, menuiseries noires', defauts: [] } as Parameters<typeof reservesBrief>[0];

Deno.test('VIS14-1 (B1) : précisions — interprétées seulement avec un brief projet ; sinon « non interprétées » (devis d’avant)', () => {
  const avec = reservesBrief(b, 'preparation', false, 0, true).join(' | ');
  na.match(avec, /interprétées par le Studio/);
  na.match(avec, /négation/);
  const sans = reservesBrief(b, 'preparation', false, 0, false).join(' | ');
  na.match(sans, /non interprétées/);
  na.doesNotMatch(sans, /interprétées par le Studio/);
});

Deno.test('VIS14-2 (I2) : ambiance image — absente non transmise, choisie gardée, nuit refusée ; résumé honnête', () => {
  na.deepEqual(validerOptionsRendu('image', { vues: ['face'] }), { ok: true, valeur: { vues: ['face'] } });
  na.deepEqual(validerOptionsRendu('image', { vues: ['face'], ambiance: 'fin_de_journee' }), { ok: true, valeur: { vues: ['face'], ambiance: 'fin_de_journee' } });
  na.equal(validerOptionsRendu('image', { ambiance: 'nuit' }).ok, false);
  na.match(resumeOptions('image', { vues: ['face'] }), /lumière du brief projet/);
  // Film et visite : inchangés (ambiance par défaut « jour »).
  na.equal((validerOptionsRendu('film', {}) as { valeur: { ambiance: string } }).valeur.ambiance, 'jour');
});

Deno.test('VIS14-3 (M1) : brief projet partiel (sans matériaux ni palette) — le résumé du devis ne tombe pas', () => {
  const r = resumeBriefProjetDevis({ brief: { gamme: 'premium' } } as never);
  na.match(r, /gamme premium/);
});

Deno.test('VIS14-4 (I1 a) : durée annoncée — vues décentrées et aérienne comptées (même table que le front)', async () => {
  const { dureeAnnoncee } = await import('./studio.ts');
  na.match(dureeAnnoncee('image', { vues: ['sejour'] }), /^environ 37 min à 1 h 17/);
  na.match(dureeAnnoncee('image', { vues: ['trois_quarts_gauche'] }), /^environ 37 min à 1 h 53/);
  na.match(dureeAnnoncee('image', { vues: ['aerienne'] }), /^environ 49 min à 2 h 35/);
});
