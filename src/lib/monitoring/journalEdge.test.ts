import test from 'node:test';
import assert from 'node:assert/strict';
import { journaliserEchecEdge, ligneEchecEdge } from '../../../supabase/functions/_shared/copilot-stream/journal.ts';

test('journal Edge : ligne bornée, source edge, aucune donnée saisie', () => {
  const l = ligneEchecEdge({
    fonction: 'copilot-chat', code: 'generation_interrompue', etape: 'generation',
    message: 'x'.repeat(2000), userId: 'u1', dureeMs: 1234.6,
    contexte: { mode: 'report', caracteres_diffuses: 4390, absent: undefined, long: 'y'.repeat(500) },
  });
  assert.equal(l.source, 'edge');
  assert.equal(l.level, 'error');
  assert.equal(l.route, '/functions/copilot-chat');
  assert.equal((l.message as string).length, 1000);
  const ctx = l.context as Record<string, unknown>;
  assert.equal(ctx.duree_ms, 1235);
  assert.equal(ctx.code, 'generation_interrompue');
  assert.ok(!('absent' in ctx));
  assert.equal((ctx.long as string).length, 200);
  assert.match(l.fingerprint as string, /^[0-9a-f]{8}$/);
});

test('journal Edge : ne lève jamais, même si la table manque', async () => {
  const client = { from: () => ({ insert: async () => ({ error: { message: 'relation "client_errors" does not exist' } }) }) };
  await journaliserEchecEdge(client, { fonction: 'f', code: 'c', etape: 'e', message: 'm' });
  const casse = { from: () => { throw new Error('boom'); } };
  await journaliserEchecEdge(casse as never, { fonction: 'f', code: 'c', etape: 'e', message: 'm' });
});
