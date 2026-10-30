// Tests de la garde « clé de service uniquement ».
import assert from 'node:assert/strict';
import { clesService, egalTempsConstant, estCleService } from './acces.ts';

const SECRET = 'sb_secret_AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SECRET2 = 'sb_secret_BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.legacy-service-role.signature';
const env = (vals: Record<string, string>) => (n: string) => vals[n];

Deno.test('égalité en temps constant', () => {
  assert.ok(egalTempsConstant('abc', 'abc'));
  assert.ok(!egalTempsConstant('abc', 'abd'));
  assert.ok(!egalTempsConstant('abc', 'abcd'));
});

Deno.test('clés secrètes présentes : la legacy est IGNORÉE', () => {
  const cles = clesService(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET, autre: SECRET2 }), SUPABASE_SERVICE_ROLE_KEY: LEGACY }));
  assert.deepEqual(cles, [SECRET, SECRET2]);
  assert.ok(estCleService(`Bearer ${SECRET}`, cles));
  assert.ok(estCleService(`bearer ${SECRET2}`, cles));
  assert.ok(!estCleService(`Bearer ${LEGACY}`, cles));
});

Deno.test('aucune clé secrète : repli sur la legacy', () => {
  const cles = clesService(env({ SUPABASE_SERVICE_ROLE_KEY: LEGACY }));
  assert.deepEqual(cles, [LEGACY]);
  assert.ok(estCleService(`Bearer ${LEGACY}`, cles));
});

Deno.test('refus : anon, JWT utilisateur, en-tête absent ou sans Bearer, aucune clé configurée', () => {
  const cles = clesService(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) }));
  assert.ok(!estCleService('Bearer sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx', cles));
  assert.ok(!estCleService('Bearer eyJ.utilisateur.jwt', cles));
  assert.ok(!estCleService(null, cles));
  assert.ok(!estCleService(SECRET, cles));
  assert.ok(!estCleService('Bearer ', cles));
  assert.ok(!estCleService(`Bearer ${SECRET}`, clesService(env({}))));
});

Deno.test('SUPABASE_SECRET_KEYS non JSON : pris tel quel', () => {
  assert.deepEqual(clesService(env({ SUPABASE_SECRET_KEYS: SECRET })), [SECRET]);
});
