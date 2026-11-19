// deno test --no-lock -A supabase/functions/copilot-chat/agent/vis10-sql.test.ts
// VIS-10 (19/11/2026) — migration 20261119120000_studio_image_livraison.sql exécutée TELLE QUELLE dans PGlite, après
// 20261114120000 (X3) et 20261118180000 (VIS-04) :
//   · rejouable ;
//   · élargissement STRICT : toutes les réponses de la définition VIS-04 sont inchangées hors clé `livraison` ;
//   · `livraison` : mêmes règles que le worker (worker/src/options.ts `lireOptionsLivraison`) et que le front
//     (src/lib/studio/livraisonCommerciale.ts `validerOptionLivraison`) — vérifié cas par cas.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';
import { validerOptionLivraison } from '../../../../src/lib/studio/livraisonCommerciale.ts';

const X3 = new URL('../../../migrations/20261114120000_studio_image_existant.sql', import.meta.url);
const VIS04 = new URL('../../../migrations/20261118180000_studio_image_vues_catalogue.sql', import.meta.url);
const VIS10 = new URL('../../../migrations/20261119120000_studio_image_livraison.sql', import.meta.url);
const TEST_X3 = new URL('./extension-sql.test.ts', import.meta.url);

async function auxiliaires(): Promise<string> {
  const t = await Deno.readTextFile(TEST_X3);
  const m = /const AUXILIAIRES = String\.raw`([\s\S]*?)`;/.exec(t);
  if (!m) throw new Error('AUXILIAIRES introuvables dans extension-sql.test.ts');
  return m[1];
}

async function base(): Promise<PGlite | null> {
  let x3: string, vis04: string, vis10: string;
  try { x3 = await Deno.readTextFile(X3); vis04 = await Deno.readTextFile(VIS04); vis10 = await Deno.readTextFile(VIS10); } catch { return null; }
  const db = new PGlite();
  await db.exec(await auxiliaires());
  await db.exec(x3);
  // Définition VIS-04 gardée sous un autre nom (témoin), puis la vraie suite X3 → VIS-04 → VIS-10.
  await db.exec(vis04.replace(/public\._studio_job_options_valides\(/g, 'public._studio_job_options_valides_vis04('));
  await db.exec(vis04);
  await db.exec(vis10);
  await db.exec(vis10); // rejouable
  return db;
}

const valide = async (db: PGlite, f: string, type: string, o: unknown): Promise<boolean | null> =>
  (await db.query<{ r: boolean | null }>(`select public.${f}($1, $2::jsonb) as r`, [type, o === null ? 'null' : JSON.stringify(o)])).rows[0].r;

const U1 = '11111111-1111-4111-8111-111111111111';
const CALAGE = { version: 1, largeur_image: 4032, hauteur_image: 3024, valide_le: '2026-11-12T12:00:00Z', correspondances: [{ image: [1, 1], monde: [2.4, 48.8, 0] }, { image: [2, 2], monde: [2.4, 48.8, 0] }] };
const PHOTO = { chemin: `${U1}/33333333-3333-4333-8333-333333333333.jpg`, octets: 5000, point_de_vue: { lon: 2.4, lat: 48.8, cap_deg: 90 } };

/** Cas sans `livraison` : réponse identique à VIS-04. */
const INCHANGES: [string, unknown][] = [
  ['film', {}], ['film', { duree_s: 45 }], ['visite360', { resolution: '8k' }], ['image', {}], ['image', null], ['inconnu', {}],
  ['image', { vues: ['face', 'trois_quarts_gauche'], ambiance: 'jour', qualite: 'apercu' }], ['image', { vues: ['terrasse', 'sejour', 'balcon'] }],
  ['image', { vues: ['face', 'face'] }], ['image', { vues: [] }], ['image', { vues: ['vue_mer'] }], ['image', { ambiance: 'nuit' }],
  ['image', { ambiance: 'crepuscule' }], ['image', { pack: 'pack_plaquette' }], ['image', { pack: 'pack_plaquette', vues: ['face'] }],
  ['image', { fond: 'photo_rue', photo_rue: { id: '44444444-4444-4444-8444-444444444444' } }], ['image', { fond: 'photo_client', photo_client: PHOTO }],
  ['image', { fond: 'photo_rue', calage_client: CALAGE }], ['image', { existant: 'conserver' }], ['image', { existant: 'partiel' }], ['image', { inconnue: 1 }],
];

/** Cas `livraison` : [option, attendu] — attendu identique pour la base et pour le front (et le worker). */
const LIVRAISONS: [unknown, boolean][] = [
  [{}, true], [{ active: true }, true], [{ active: false }, true], [{ active: null }, true], [{ active: 'oui' }, false],
  [{ formats: ['original', 'web_bandeau', 'web_16_9', 'mobile_portrait', 'vignette', 'impression_a4'] }, true],
  [{ formats: ['web_16_9'] }, true], [{ formats: null }, true], [{ formats: [] }, false], [{ formats: ['poster'] }, false],
  [{ formats: ['vignette', 'vignette'] }, false], [{ formats: 'vignette' }, false], [{ formats: [1] }, false],
  [{ sans_mention: true }, true], [{ sans_mention: 1 }, false],
  [{ mention: 'Illustration non contractuelle' }, true], [{ mention: '   ' }, false], [{ mention: '' }, false], [{ mention: 'x'.repeat(120) }, true],
  [{ mention: 'x'.repeat(121) }, false], [{ mention: null }, true], [{ mention: 3 }, false],
  [{ credit: null }, true], [{ credit: '' }, true], [{ credit: 'Perspective : Mimmoza' }, true], [{ credit: 'y'.repeat(61) }, false],
  [{ position: 'bas_gauche' }, true], [{ position: 'bas_droite' }, true], [{ position: 'haut' }, false],
  [{ zip: true }, false], ['oui', false], [[], false], [null, false],
];

Deno.test('VIS10-SQL-1 : migration rejouable ; réponses inchangées sans `livraison`', async () => {
  const db = await base();
  if (!db) return;
  for (const [t, o] of INCHANGES) {
    na.equal(await valide(db, '_studio_job_options_valides', t, o), await valide(db, '_studio_job_options_valides_vis04', t, o), `${t} ${JSON.stringify(o)}`);
  }
  await db.close();
});

Deno.test('VIS10-SQL-2 : `livraison` — base et front donnent la même réponse ; image seulement ; refusée avant VIS-10', async () => {
  const db = await base();
  if (!db) return;
  for (const [l, attendu] of LIVRAISONS) {
    // `livraison: null` (null JSON) : refusée par la base ET par le front/Edge (le worker l'ignorerait) — prudent et cohérent.
    const o = { vues: ['face'], livraison: l };
    na.equal(await valide(db, '_studio_job_options_valides', 'image', o), attendu, `base ${JSON.stringify(l)}`);
    na.equal(validerOptionLivraison(l).ok, attendu, `front ${JSON.stringify(l)}`);
  }
  na.equal(await valide(db, '_studio_job_options_valides_vis04', 'image', { vues: ['face'], livraison: { active: true } }), false); // témoin
  na.equal(await valide(db, '_studio_job_options_valides', 'image', { pack: 'pack_plaquette', livraison: { formats: ['web_16_9'] } }), true);
  na.equal(await valide(db, '_studio_job_options_valides', 'film', { livraison: { active: true } }), false);
  na.equal(await valide(db, '_studio_job_options_valides', 'visite360', { livraison: {} }), false);
  await db.close();
});
