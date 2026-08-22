import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { CONTEXT_SNAPSHOT_LIMITS, createContextSnapshot, mergeContexts, sanitizeContext } from './snapshot.ts';

Deno.test('hash stable independent de l ordre des cles et de captured_at', async () => {
  const a = await createContextSnapshot({ route: '/a', parcel: { id: '1', surface: 20 } }, '2026-01-01T00:00:00Z');
  const b = await createContextSnapshot({ parcel: { surface: 20, id: '1' }, route: '/a' }, '2026-02-01T00:00:00Z');
  assertEquals(a.context_hash, b.context_hash);
  assertNotEquals(a.captured_at, b.captured_at);
});

Deno.test('merge profond conservateur avec priorite au contexte courant', () => {
  assertEquals(mergeContexts(
    { route: '/ancien', parcel: { id: '1', commune: 'Lyon' }, price: 100 },
    { route: '/nouveau', parcel: { commune: 'Paris' } },
  ), { parcel: { commune: 'Paris', id: '1' }, price: 100, route: '/nouveau' });
});

Deno.test('une route explicite ne conserve pas un pageContext obsolete', () => {
  assertEquals(mergeContexts(
    { route: '/ancien', pageContext: { pathname: '/ancien', tab: 'risques' } },
    { route: '/nouveau' },
  ), { route: '/nouveau' });
});

Deno.test('sanitization retire secrets pieces jointes base64 et valeurs invalides', () => {
  assertEquals(sanitizeContext({ apiKey: 'secret', attachments: [{ data: 'abc' }], token: 'conserve', image: 'A'.repeat(1024), ok: 42, nan: Number.NaN, missing: undefined }), { ok: 42, token: 'conserve' });
});

Deno.test('sanitization borne profondeur tableaux chaines et taille totale', () => {
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 20; i += 1) deep = { child: deep };
  const result = sanitizeContext({ deep, list: Array.from({ length: 400 }, (_, i) => i), text: 'x'.repeat(CONTEXT_SNAPSHOT_LIMITS.maxStringLength + 100), huge: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 'y'.repeat(1000)])) });
  assertEquals((result.list as unknown[]).length, CONTEXT_SNAPSHOT_LIMITS.maxArrayItems);
  assertEquals((result.text as string).length, CONTEXT_SNAPSHOT_LIMITS.maxStringLength);
  assertEquals(new TextEncoder().encode(JSON.stringify(result)).length <= CONTEXT_SNAPSHOT_LIMITS.maxSerializedBytes, true);
});
