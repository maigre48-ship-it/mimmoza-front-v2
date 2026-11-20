// deno test --no-lock --no-check -A vis19-temoins-sql.test.ts
// VIS-19 (20/11/2026) — migration 20261120150000_studio_temoins.sql (NON appliquée) exécutée TELLE QUELLE dans PGlite :
//   · rejouable ; TRUNCATE / REFERENCES / TRIGGER retirés à authenticated et anon ;
//   · un témoin au plus large que le site accepte (90 000 octets de JSON compact) passe la contrainte
//     octet_length(temoin::text) < 131072 ; suppression de SA ligne seulement (politique delete).
//   · expression du filtre du parcours (content->0->>'text' ilike) sur un jsonb comme copilot_messages.content.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';
import { creerTemoin, octetsJson, TAILLE_MAX_TEMOIN_OCTETS } from '../../../../src/spaces/promoteur/shared/echangeStudio/pontParcoursStudio.ts';

const MIGRATION = new URL('../../../migrations/20261120150000_studio_temoins.sql', import.meta.url);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const AUTH = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
insert into auth.users values ('${U1}'), ('${U2}');
-- Privilèges par défaut à la Supabase : tout est donné à anon / authenticated sur les nouvelles tables.
alter default privileges in schema public grant all on tables to anon, authenticated;
`;

async function base(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH);
  const sql = await Deno.readTextFile(MIGRATION);
  await db.exec(sql);
  await db.exec(sql); // rejouable
  return db;
}

/** Témoin au plus près de la borne du site (champs au maximum, réglage qui garde le total ≤ 90 000 octets). */
function temoinMaximal() {
  const e = (n: number) => '€'.repeat(n);
  const corps = {
    personnalise: true,
    logement: { cle: e(300), buildingId: e(120), floorKey: e(120), wingId: e(120), logementId: e(120), lot: e(40), niveau: e(40), rangNiveau: 2, typologie: 'T3' as const, surfaceM2: 64 },
    style: e(40), gamme: e(40), cible: e(40), seed: 1, meubles: 18,
    finitions: Array.from({ length: 40 }, () => ({ fonction: e(60), sol: e(80), murs: e(80) })),
    modifications: { ajouts: 0, suppressions: 0, ajustements: 0, finitions: 0, planModifie: false },
  };
  // Réglage dense en séparateurs (jsonb::text ajoute une espace après chaque « : » et « , ») : le plus grand nombre de
  // clés qui garde le témoin ENTIER (réglage compris) sous la borne — recherche dichotomique.
  const reglageDe = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));
  let bas = 0, haut = 20_000;
  while (bas < haut) {
    const m = Math.ceil((bas + haut) / 2);
    if (creerTemoin({ ...corps, reglage: reglageDe(m) }).reglage !== undefined) bas = m; else haut = m - 1;
  }
  return { t: creerTemoin({ ...corps, reglage: reglageDe(bas) }) };
}

Deno.test('VIS19-SQL-1 : rejouable ; TRUNCATE / REFERENCES / TRIGGER retirés ; anon sans droit', async () => {
  const db = await base();
  const priv = async (role: string, p: string) => (await db.query<{ r: boolean }>(`select has_table_privilege('${role}', 'public.studio_temoins', '${p}') as r`)).rows[0].r;
  for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    na.equal(await priv('authenticated', p), false, `authenticated ${p}`);
    na.equal(await priv('anon', p), false, `anon ${p}`);
  }
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    na.equal(await priv('authenticated', p), true, `authenticated ${p}`);
    na.equal(await priv('anon', p), false, `anon ${p}`);
  }
  await db.close();
});

Deno.test('VIS19-SQL-2 : témoin maximal du site (≤ 90 000 octets compacts) accepté par octet_length(temoin::text) < 131072', async () => {
  const db = await base();
  const { t } = temoinMaximal();
  na.ok(t.reglage !== undefined);
  na.ok(octetsJson(t) <= TAILLE_MAX_TEMOIN_OCTETS);
  await db.exec(`set test.uid = '${U1}'`);
  await db.exec('set role authenticated');
  await db.query('insert into public.studio_temoins (conversation_id, projet_id, temoin, resume, empreinte) values ($1, $2, $3::jsonb, $4, $5)',
    ['c1', 'mzchat-c1', JSON.stringify(t), t.resume.slice(0, 300), t.empreinte]);
  const n = (await db.query<{ o: number }>(`select octet_length(temoin::text) as o from public.studio_temoins where conversation_id = 'c1'`)).rows[0].o;
  console.log(`témoin : ${octetsJson(t)} octets compacts → octet_length(temoin::text) = ${n}`);
  na.ok(n < 131072, `octet_length = ${n}`);
  na.ok(n > octetsJson(t), 'jsonb::text est plus long que le JSON compact (espaces)');
  await db.close();
});

Deno.test('VIS19-SQL-3 : suppression de SA ligne seulement (politique delete propriétaire)', async () => {
  const db = await base();
  const t = creerTemoin({
    personnalise: true, logement: { cle: 'k', buildingId: 'b', floorKey: 'f', wingId: 'w', logementId: null, lot: null, niveau: null, rangNiveau: null, typologie: null, surfaceM2: null },
    style: null, gamme: null, cible: null, seed: 1, meubles: null, finitions: [], modifications: { ajouts: 0, suppressions: 0, ajustements: 0, finitions: 0, planModifie: false },
  });
  await db.exec('set role authenticated');
  for (const u of [U1, U2]) {
    await db.exec(`set test.uid = '${u}'`);
    await db.query(`insert into public.studio_temoins (conversation_id, temoin, resume, empreinte) values ('c1', $1::jsonb, 'r', $2)`, [JSON.stringify(t), t.empreinte]);
  }
  await db.exec(`set test.uid = '${U1}'`);
  await db.exec(`delete from public.studio_temoins where conversation_id = 'c1'`);
  await db.exec('reset role');
  const restantes = (await db.query<{ user_id: string }>('select user_id from public.studio_temoins')).rows.map((r) => r.user_id);
  na.deepEqual(restantes, [U2]);
  await db.close();
});

Deno.test('VIS19-SQL-4 : filtre du parcours — content->0->>\'text\' ilike sur un contenu jsonb [{type, text}]', async () => {
  const db = new PGlite();
  await db.exec(`create table m (id int, content jsonb);
    insert into m values (1, '[{"type":"text","text":"bonjour"}]'), (2, '[{"type":"text","text":"ok\\n\\n\`\`\`mimmoza-parcours\\n{\\"apercu_valide\\":\\"x\\"}\\n\`\`\`"}]'),
      (3, '[{"type":"text","text":"\`\`\`mimmoza-brief\\n{}\\n\`\`\`"}]');`);
  const ids = async (motif: string) => (await db.query<{ id: number }>(`select id from m where content->0->>'text' ilike $1 order by id`, [motif])).rows.map((r) => r.id);
  na.deepEqual(await ids('%```mimmoza-parcours%'), [2]);
  na.deepEqual(await ids('%```mimmoza-brief%'), [3]);
  await db.close();
});
