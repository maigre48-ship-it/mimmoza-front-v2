// deno test --no-lock -A supabase/functions/copilot-chat/agent/vis18b-sql.test.ts
// VIS-18b (20/11/2026) — migration 20261120080000_studio_apercu_film_visite.sql exécutée TELLE QUELLE dans PGlite, après
// 20261114120000 (X3), 20261118180000 (VIS-04) et 20261119120000 (VIS-10) :
//   · rejouable ;
//   · élargissement STRICT : toutes les réponses de la définition VIS-10 sont inchangées hors clé `qualite` d'un film /
//     d'une visite ; branche image identique ;
//   · `qualite` film / visite : mêmes réponses que copilot-chat (validerOptionsRendu) et le site (validerOptions).
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';
import { validerOptionsRendu } from './studio.ts';
import { validerOptions } from '../../../../src/lib/studio/travauxLogique.ts';

const M = (n: string) => new URL(`../../../migrations/${n}`, import.meta.url);
const TEST_X3 = new URL('./extension-sql.test.ts', import.meta.url);

async function base(): Promise<PGlite | null> {
  let x3: string, vis04: string, vis10: string, vis18b: string, aux: string;
  try {
    x3 = await Deno.readTextFile(M('20261114120000_studio_image_existant.sql'));
    vis04 = await Deno.readTextFile(M('20261118180000_studio_image_vues_catalogue.sql'));
    vis10 = await Deno.readTextFile(M('20261119120000_studio_image_livraison.sql'));
    vis18b = await Deno.readTextFile(M('20261120080000_studio_apercu_film_visite.sql'));
    const m = /const AUXILIAIRES = String\.raw`([\s\S]*?)`;/.exec(await Deno.readTextFile(TEST_X3));
    if (!m) throw new Error('AUXILIAIRES introuvables');
    aux = m[1];
  } catch { return null; }
  const db = new PGlite();
  await db.exec(aux);
  await db.exec(x3);
  await db.exec(vis04);
  // Définition VIS-10 gardée sous un autre nom (témoin), puis la vraie suite VIS-10 → VIS-18b (deux fois : rejouable).
  await db.exec(vis10.replace(/public\._studio_job_options_valides\(/g, 'public._studio_job_options_valides_vis10('));
  await db.exec(vis10);
  await db.exec(vis18b);
  await db.exec(vis18b);
  return db;
}

const valide = async (db: PGlite, f: string, type: string, o: unknown): Promise<boolean | null> =>
  (await db.query<{ r: boolean | null }>(`select public.${f}($1, $2::jsonb) as r`, [type, o === null ? 'null' : JSON.stringify(o)])).rows[0].r;

const U1 = '11111111-1111-4111-8111-111111111111';
const PHOTO = { chemin: `${U1}/33333333-3333-4333-8333-333333333333.jpg`, octets: 5000, point_de_vue: { lon: 2.4, lat: 48.8, cap_deg: 90 } };
/** Sans `qualite` sur un film / une visite : réponse identique à VIS-10 (image : toujours identique). */
const INCHANGES: [string, unknown][] = [
  ['film', {}], ['film', { duree_s: 45 }], ['film', { duree_s: 30, ambiance: 'nuit', format: '9:16', interieurs: false, musique: false }], ['film', { musique: 'oui' }],
  ['film', { inconnue: 1 }], ['film', null], ['visite360', {}], ['visite360', { resolution: '8k' }], ['visite360', { resolution: '3k' }], ['visite360', { interieurs: 1 }],
  ['image', {}], ['image', null], ['inconnu', {}], ['image', { vues: ['face'], qualite: 'apercu' }], ['image', { qualite: 'finale' }], ['image', { qualite: 'x' }],
  ['image', { pack: 'pack_plaquette' }], ['image', { fond: 'photo_client', photo_client: PHOTO }], ['image', { vues: ['face'], livraison: { active: true } }],
  ['image', { existant: 'conserver' }], ['image', { vues: ['face', 'face'] }],
];
/** `qualite` sur un film / une visite : [type, options, attendu] — même réponse pour la base, copilot-chat et le site. */
const QUALITES: [string, Record<string, unknown>, boolean][] = [
  ['film', { qualite: 'apercu' }, true], ['film', { qualite: 'finale' }, true], ['film', { duree_s: 90, format: '9:16', qualite: 'apercu' }, true],
  ['film', { qualite: 'brouillon' }, false], ['film', { qualite: 'apercu', duree_s: 45 }, false],
  ['visite360', { qualite: 'apercu' }, true], ['visite360', { resolution: '8k', qualite: 'finale' }, true], ['visite360', { qualite: '3k' }, false],
  ['visite360', { qualite: 'apercu', resolution: '12k' }, false],
];

Deno.test('VIS18b-SQL-1 : migration rejouable ; réponses inchangées sans `qualite` (film / visite) et pour l’image', async () => {
  const db = await base();
  if (!db) return;
  for (const [t, o] of INCHANGES) {
    na.equal(await valide(db, '_studio_job_options_valides', t, o), await valide(db, '_studio_job_options_valides_vis10', t, o), `${t} ${JSON.stringify(o)}`);
  }
  await db.close();
});

Deno.test('VIS18b-SQL-2 : `qualite` film / visite — base, copilot-chat et site donnent la même réponse ; refusée avant VIS-18b', async () => {
  const db = await base();
  if (!db) return;
  for (const [t, o, attendu] of QUALITES) {
    na.equal(await valide(db, '_studio_job_options_valides', t, o), attendu, `base ${t} ${JSON.stringify(o)}`);
    na.equal(validerOptionsRendu(t, o).ok, attendu, `copilot-chat ${t} ${JSON.stringify(o)}`);
    na.equal(validerOptions(t as 'film' | 'visite360', o).ok, attendu, `site ${t} ${JSON.stringify(o)}`);
  }
  na.equal(await valide(db, '_studio_job_options_valides_vis10', 'film', { qualite: 'apercu' }), false); // témoin : avant la migration
  na.equal(await valide(db, '_studio_job_options_valides_vis10', 'visite360', { qualite: 'apercu' }), false);
  // `qualite: 1` (nombre JSON) : texte « 1 » hors liste → refusée.
  na.equal(await valide(db, '_studio_job_options_valides', 'visite360', { qualite: 1 }), false);
  await db.close();
});
