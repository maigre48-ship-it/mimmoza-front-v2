// deno test -A supabase/functions/copilot-chat/agent/vis04-sql.test.ts
// VIS-04 (18/11/2026) — migration 20261118180000_studio_image_vues_catalogue.sql exécutée TELLE QUELLE dans PGlite :
//   · rejouable ;
//   · élargissement STRICT : tout ce que la définition précédente (20261114120000, X3) acceptait reste accepté, et
//     ce qu'elle refusait reste refusé SAUF vues du catalogue / crépuscule / pack (comparaison sur les cas du test X3
//     et des cas propres au lot) ;
//   · catalogue : 1 à 6 vues, identifiants de COORDINATION.md, pack « pack_plaquette » exclusif de `vues`.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';

const X3 = new URL('../../../migrations/20261114120000_studio_image_existant.sql', import.meta.url);
const VIS04 = new URL('../../../migrations/20261118180000_studio_image_vues_catalogue.sql', import.meta.url);
const TEST_X3 = new URL('./extension-sql.test.ts', import.meta.url);

/** Fonctions auxiliaires de production : reprises du test X3 (même source, aucune copie divergente). */
async function auxiliaires(): Promise<string> {
  const t = await Deno.readTextFile(TEST_X3);
  const m = /const AUXILIAIRES = String\.raw`([\s\S]*?)`;/.exec(t);
  if (!m) throw new Error('AUXILIAIRES introuvables dans extension-sql.test.ts');
  return m[1];
}

async function base(): Promise<PGlite | null> {
  let x3: string, vis04: string;
  try { x3 = await Deno.readTextFile(X3); vis04 = await Deno.readTextFile(VIS04); } catch { return null; }
  const db = new PGlite();
  await db.exec(await auxiliaires());
  // Définition précédente gardée sous un autre nom (témoin).
  await db.exec(x3.replace(/public\._studio_job_options_valides\(/g, 'public._studio_job_options_valides_x3('));
  await db.exec(vis04);
  await db.exec(vis04); // rejouable
  return db;
}

const valide = async (db: PGlite, f: string, type: string, o: unknown): Promise<boolean | null> =>
  (await db.query<{ r: boolean | null }>(`select public.${f}($1, $2::jsonb) as r`, [type, o === null ? 'null' : JSON.stringify(o)])).rows[0].r;

const U1 = '11111111-1111-4111-8111-111111111111';
const CALAGE = { version: 1, largeur_image: 4032, hauteur_image: 3024, valide_le: '2026-11-12T12:00:00Z', correspondances: [{ image: [1, 1], monde: [2.4, 48.8, 0] }, { image: [2, 2], monde: [2.4, 48.8, 0] }] };
const PHOTO = { chemin: `${U1}/33333333-3333-4333-8333-333333333333.jpg`, octets: 5000, point_de_vue: { lon: 2.4, lat: 48.8, cap_deg: 90 } };

/** Cas dont la réponse NE DOIT PAS changer (aucune vue ajoutée, ni crépuscule, ni pack). */
const INCHANGES: [string, unknown][] = [
  ['film', {}], ['film', { duree_s: 45 }], ['film', { vues: ['face'] }], ['film', { ambiance: 'crepuscule' }], ['visite360', { resolution: '8k' }],
  ['visite360', { pack: 'pack_plaquette' }], ['image', {}], ['image', { vues: ['face', 'trois_quarts_gauche'], ambiance: 'jour', qualite: 'apercu' }],
  ['image', { vues: ['face', 'face'] }], ['image', { vues: [] }], ['image', { vues: ['dessus'] }], ['image', { vues: 'face' }], ['image', { ambiance: 'nuit' }],
  ['image', { qualite: 'brouillon' }], ['image', { fond: 'photo_rue', photo_rue: { id: '44444444-4444-4444-8444-444444444444' } }],
  ['image', { fond: 'photo_client', photo_client: PHOTO }], ['image', { fond: 'photo_rue', calage_client: CALAGE }], ['image', { existant: 'conserver' }],
  ['image', { existant: 'partiel' }], ['image', { inconnue: 1 }], ['image', null], ['inconnu', {}],
];

Deno.test('VIS04-SQL-1 : migration rejouable ; réponses inchangées hors vues du catalogue, crépuscule et pack', async () => {
  const db = await base();
  if (!db) return;
  for (const [t, o] of INCHANGES) {
    na.equal(await valide(db, '_studio_job_options_valides', t, o), await valide(db, '_studio_job_options_valides_x3', t, o), `${t} ${JSON.stringify(o)}`);
  }
  await db.close();
});

Deno.test('VIS04-SQL-2 : vues du catalogue (1 à 6), crépuscule, pack plaquette ; refus hors catalogue, au-delà de 6, pack + vues', async () => {
  const db = await base();
  if (!db) return;
  const f = '_studio_job_options_valides';
  na.equal(await valide(db, f, 'image', { vues: ['trois_quarts_gauche', 'aerienne', 'coeur_ilot'] }), true);
  na.equal(await valide(db, '_studio_job_options_valides_x3', 'image', { vues: ['trois_quarts_gauche', 'aerienne', 'coeur_ilot'] }), false); // témoin : refusé avant
  na.equal(await valide(db, f, 'image', { vues: ['angle_rue', 'entree'], ambiance: 'crepuscule' }), true);
  na.equal(await valide(db, f, 'image', { vues: ['face', 'aerienne', 'entree', 'angle_rue', 'coeur_ilot', 'trois_quarts_gauche'] }), true);
  na.equal(await valide(db, f, 'image', { vues: ['face', 'aerienne', 'entree', 'angle_rue', 'coeur_ilot', 'trois_quarts_gauche', 'trois_quarts_droite'] }), false);
  na.equal(await valide(db, f, 'image', { vues: ['vue_mer'] }), false);
  na.equal(await valide(db, f, 'image', { pack: 'pack_plaquette' }), true);
  na.equal(await valide(db, f, 'image', { pack: 'pack_plaquette', vues: ['face'] }), false);
  na.equal(await valide(db, f, 'image', { pack: 'pack_autre' }), false);
  na.equal(await valide(db, f, 'image', { ambiance: 'nuit' }), false);
  await db.close();
});
