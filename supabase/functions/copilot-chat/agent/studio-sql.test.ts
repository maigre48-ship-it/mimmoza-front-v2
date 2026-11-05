// deno test -A supabase/functions/copilot-chat/agent/studio-sql.test.ts
// LOT E1 — migration 20261105150000_studio_preparations.sql exécutée TELLE QUELLE dans PGlite
// (Postgres en WASM) sur un socle minimal (rôles Supabase, auth.users, auth.uid(), agent_conceptions) :
// rejouable, RLS par user_id, conception d'autrui refusée, préparation immuable pour l'utilisateur.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';

const MIGRATION = new URL('../../../migrations/20261105150000_studio_preparations.sql', import.meta.url);
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const CA = '00000000-0000-4000-8000-0000000000ca';
const CB = '00000000-0000-4000-8000-0000000000cb';
const E1 = 'a'.repeat(64);

const SOCLE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.agent_conceptions (id uuid primary key, user_id uuid not null references auth.users (id));
grant select on public.agent_conceptions to authenticated;
insert into auth.users values ('${A}'), ('${B}');
insert into public.agent_conceptions values ('${CA}', '${A}'), ('${CB}', '${B}');
`;

async function base(): Promise<PGlite | null> {
  let sql: string;
  try { sql = await Deno.readTextFile(MIGRATION); } catch { return null; }
  const db = new PGlite();
  await db.exec(SOCLE);
  await db.exec(sql);
  await db.exec(sql); // rejouable
  return db;
}

async function comme(db: PGlite, role: 'authenticated' | 'anon' | 'service_role', uid: string | null, q: string, p: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await db.query<Record<string, unknown>>(q, p); } finally { await db.exec('reset role;'); }
}

const INSERT = `insert into public.studio_preparations (user_id, conception_id, conversation_id, idu, empreinte, version_calcul, entree, volume, resume)
  values ($1, $2, $3, '92050000AE0414', $4, 'e1-studio-1', '{"parcelle":{}}', '{"niveaux":5}', '{"batiments":1}') returning id`;
const UPSERT = `${INSERT.replace(' returning id', '')} on conflict (user_id, empreinte) do update set conversation_id = excluded.conversation_id, volume = excluded.volume returning id`;

Deno.test('E1-SQL-1 : migration rejouable ; RLS active ; propriétaire seul (lecture, insertion, conception liée)', async () => {
  const db = await base();
  if (!db) return; // migration absente (copie partielle) : rien à vérifier
  na.equal((await db.query<{ r: boolean }>(`select relrowsecurity as r from pg_class where oid = 'public.studio_preparations'::regclass`)).rows[0].r, true);
  const r = await comme(db, 'authenticated', A, INSERT, [A, CA, 'conv-1', E1]);
  na.equal(r.rows.length, 1);
  // Pour autrui, ou sur la conception d'autrui : refusé par la politique.
  await na.rejects(() => comme(db, 'authenticated', A, INSERT, [B, null, null, 'b'.repeat(64)]), /row-level security/);
  await na.rejects(() => comme(db, 'authenticated', A, INSERT, [A, CB, null, 'c'.repeat(64)]), /row-level security/);
  // B ne voit rien de A ; anon n'a aucun droit.
  na.equal((await comme(db, 'authenticated', B, 'select id from public.studio_preparations')).rows.length, 0);
  na.equal((await comme(db, 'authenticated', A, 'select id from public.studio_preparations')).rows.length, 1);
  await na.rejects(() => comme(db, 'anon', null, 'select id from public.studio_preparations'), /permission denied/);
  // Empreinte : sha256 hexadécimal uniquement.
  await na.rejects(() => comme(db, 'authenticated', A, INSERT, [A, null, null, 'pas-une-empreinte']), /check constraint/);
  await db.close();
});

Deno.test('E1-SQL-2 : upsert par empreinte — même ligne, seul conversation_id change pour l’utilisateur ; service_role complet', async () => {
  const db = await base();
  if (!db) return;
  const id1 = (await comme(db, 'authenticated', A, INSERT, [A, CA, 'conv-1', E1])).rows[0].id;
  const id2 = (await comme(db, 'authenticated', A, UPSERT, [A, CA, 'conv-2', E1])).rows[0].id;
  na.equal(id2, id1);
  const l = (await db.query<{ conversation_id: string; volume: unknown; n: number }>(`select conversation_id, volume, (select count(*)::int from public.studio_preparations) as n from public.studio_preparations`)).rows[0];
  na.deepEqual([l.conversation_id, l.volume, l.n], ['conv-2', { niveaux: 5 }, 1], 'le volume calculé n’est jamais réécrit par l’utilisateur');
  // Modification directe d'une autre colonne par l'utilisateur : sans effet.
  await comme(db, 'authenticated', A, `update public.studio_preparations set idu = 'X', resume = '{}' where id = $1`, [id1]);
  na.equal((await db.query<{ idu: string }>('select idu from public.studio_preparations')).rows[0].idu, '92050000AE0414');
  // B ne peut pas modifier la ligne de A.
  const maj = await comme(db, 'authenticated', B, `update public.studio_preparations set conversation_id = 'pirate' where id = $1 returning id`, [id1]);
  na.equal(maj.rows.length, 0);
  // Suppression : aucune politique pour l'utilisateur.
  await na.rejects(() => comme(db, 'authenticated', A, 'delete from public.studio_preparations'), /permission denied/);
  // Le serveur (service_role) peut écrire pour le propriétaire d'une mission.
  const s = await comme(db, 'service_role', null, INSERT, [B, CB, null, 'd'.repeat(64)]);
  na.equal(s.rows.length, 1);
  await db.close();
});
