// deno test --no-lock -A supabase/functions/copilot-chat/agent/vis14-sql.test.ts
// VIS-14 (B2, 19/11/2026) — migration 20261117170000_studio_rendus_plans.sql exécutée TELLE QUELLE dans PGlite, sur le
// seau `studio-rendus` tel que CONSTATÉ EN PRODUCTION le 19/11 (video/mp4, image/jpeg, image/png, image/webp,
// application/json) : elle ajoute application/zip ET application/pdf (livraison commerciale : ZIP + plan de vente PDF ;
// plans d'extension), sans rien retirer ; rejouable ; un seau sans liste (null = tout accepté) n'est pas restreint.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';

const MIG = new URL('../../../migrations/20261117170000_studio_rendus_plans.sql', import.meta.url);
const PROD = ['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'application/json'];

Deno.test('VIS14-SQL-1 : stockage — zip ET pdf ajoutés au seau studio-rendus, rien retiré, rejouable, seau sans liste intact', async () => {
  const sql = await Deno.readTextFile(MIG);
  const db = new PGlite();
  await db.exec(`create schema storage; create table storage.buckets (id text primary key, allowed_mime_types text[]);`);
  await db.query(`insert into storage.buckets values ('studio-rendus', $1), ('autre', null)`, [PROD]);
  await db.exec(sql);
  await db.exec(sql); // rejouable
  const r = (await db.query<{ id: string; t: string[] | null }>(`select id, allowed_mime_types as t from storage.buckets order by id`)).rows;
  const rendus = r.find((x) => x.id === 'studio-rendus')!.t!;
  for (const t of [...PROD, 'application/zip', 'application/pdf']) na.ok(rendus.includes(t), t);
  na.equal(rendus.length, PROD.length + 2, 'aucun doublon');
  na.equal(r.find((x) => x.id === 'autre')!.t, null);
});
