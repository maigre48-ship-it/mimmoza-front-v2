// LOT F5 — les deux fonctions de transcription de plans retirées répondent 410, sans appel au modèle ni débit.
import * as na from 'node:assert/strict';
const assertEquals = (a: unknown, b: unknown, m?: string) => na.deepEqual(a, b, m);
const assertMatch = (s: string, r: RegExp) => na.match(s, r);
import { CODE_RETRAIT, reponseRetrait } from './retraitLecturePlan.ts';

Deno.test('F5-S1 POST → 410 avec un message clair, aucun jeton', async () => {
  const r = reponseRetrait(new Request('https://x/functions/v1/analyze-rehab-plan', { method: 'POST', body: '{}' }));
  assertEquals(r.status, 410);
  const j = await r.json();
  assertEquals(j.success, false);
  assertEquals(j.error.code, CODE_RETRAIT);
  assertMatch(j.error.message, /lecture de plan du Studio/);
  assertMatch(j.error.message, /Aucun jeton/);
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('F5-S2 OPTIONS → préliminaire CORS 200', () => {
  assertEquals(reponseRetrait(new Request('https://x', { method: 'OPTIONS' })).status, 200);
});

Deno.test('F5-S3 les deux fonctions n’appellent plus aucun modèle ni la facturation', async () => {
  for (const f of ['analyze-rehab-plan', 'transcribe-rehab-plan']) {
    const src = (await Deno.readTextFile(new URL(`../${f}/index.ts`, import.meta.url))).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assertEquals(/openai|gpt-4o|OPENAI_API_KEY|featureBilling|debiter/i.test(src), false, f);
    assertMatch(src, /reponseRetrait/);
  }
});
