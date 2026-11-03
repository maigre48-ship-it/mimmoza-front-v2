// deno test copilot-chat/agent/budget-trace.test.ts
import * as na from 'node:assert/strict';
import {
  APPELS_IMBRIQUES_ETUDE_PARCELLE, BudgetTrace, ErreurBudgetTrace, LIMITE_APPELS_TRACE, MARGE_APPELS_TRACE,
  acquerirBudget, avecBudgetTrace, budgetTraceCourant, lireRefusTrace, messageBudgetTrace,
} from './budget-trace.ts';

const ETUDE = 1 + APPELS_IMBRIQUES_ETUDE_PARCELLE; // copilot-chat → etude-parcelle-v1 → 11 sources

function horloge(t0 = 1_000_000) {
  let t = t0;
  return { now: () => t, avancer: (ms: number) => { t += ms; } };
}

Deno.test('incident 02/11 : 2 études tiennent dans le budget, la 3e est refusée AVANT d\'être émise', async () => {
  const h = horloge();
  const b = new BudgetTrace({ now: h.now, attenteMaxMs: 5_000 });
  na.equal(b.limite, LIMITE_APPELS_TRACE - MARGE_APPELS_TRACE);
  await acquerirBudget(b, 1, 'besoin-logements-sociaux', async () => {});
  await acquerirBudget(b, ETUDE, 'etude-parcelle-v1', async () => {});
  h.avancer(20_000);
  await acquerirBudget(b, ETUDE, 'etude-parcelle-v1', async () => {});
  na.equal(b.enCours(), 25);
  h.avancer(20_000);
  await na.rejects(acquerirBudget(b, ETUDE, 'etude-parcelle-v1', async () => { throw new Error('ne doit pas dormir'); }),
    (e: unknown) => e instanceof ErreurBudgetTrace && /limite Supabase des appels imbriqués/.test((e as Error).message));
  na.equal(b.enCours(), 25, 'rien n\'est compté pour un appel refusé');
});

Deno.test('fenêtre glissante : après 60 s les appels anciens sont libérés', async () => {
  const h = horloge();
  const b = new BudgetTrace({ now: h.now });
  b.reserver(ETUDE); b.reserver(ETUDE);
  na.equal(b.attenteAvant(ETUDE), 60_000);
  h.avancer(60_001);
  na.equal(b.attenteAvant(ETUDE), 0);
  na.equal(b.enCours(), 0);
});

Deno.test('attente courte : on patiente puis on réserve', async () => {
  const h = horloge();
  const b = new BudgetTrace({ now: h.now, attenteMaxMs: 5_000 });
  b.reserver(20);
  h.avancer(57_000);
  b.reserver(5);
  // 25 + 12 - 28 = 9 appels doivent expirer : les 20 premiers sortent dans 3 s.
  let dormi = 0;
  await acquerirBudget(b, ETUDE, 'etude-parcelle-v1', async (ms) => { dormi = ms; h.avancer(ms); });
  na.equal(dormi, 3_000);
  na.equal(b.enCours(), 5 + ETUDE);
});

Deno.test('saturation signalée par la plateforme : plus aucun appel avant Retry-After', async () => {
  const h = horloge();
  const b = new BudgetTrace({ now: h.now, attenteMaxMs: 5_000 });
  b.signalerSaturation(45_075);
  na.equal(b.attenteAvant(1), 45_075);
  await na.rejects(acquerirBudget(b, 1, 'dvf-comparables-v1', async () => {}), ErreurBudgetTrace);
  h.avancer(45_075);
  await acquerirBudget(b, 1, 'dvf-comparables-v1', async () => {});
});

Deno.test('coût supérieur à la limite : impossible, message explicite', () => {
  const b = new BudgetTrace();
  na.equal(b.attenteAvant(1000), Number.POSITIVE_INFINITY);
  na.match(messageBudgetTrace('x', Number.POSITIVE_INFINITY), /prochaine requête/);
  na.match(messageBudgetTrace('etude-parcelle-v1', 41_200), /dans 42 s/);
});

Deno.test('lireRefusTrace : message réel de l\'incident, RateLimitError, autres erreurs', () => {
  na.deepEqual(lireRefusTrace(new Error('Rate limit exceeded for trace 01a19c4f2b. Retry after 45075ms')), { retryAfterMs: 45075 });
  const e = Object.assign(new Error('Rate limit exceeded for trace abc'), { name: 'RateLimitError', retryAfterMs: 1200 });
  na.deepEqual(lireRefusTrace(e), { retryAfterMs: 1200 });
  na.deepEqual(lireRefusTrace('HTTP 429 : Rate limit exceeded for trace x'), { retryAfterMs: 60_000 });
  na.equal(lireRefusTrace(new Error('timeout (25000ms)')), null);
  na.equal(lireRefusTrace(null), null);
});

Deno.test('portée : un budget distinct par requête, propagé à travers await et ReadableStream', async () => {
  na.equal(budgetTraceCourant(), undefined);
  const lire = () => new Promise<BudgetTrace | undefined>((r) => setTimeout(() => r(budgetTraceCourant()), 2));
  const [a, b] = await Promise.all([
    avecBudgetTrace(async () => { const x = budgetTraceCourant(); x!.reserver(3); return [x, await lire()]; }),
    avecBudgetTrace(async () => {
      const x = budgetTraceCourant();
      const s = new ReadableStream<BudgetTrace | undefined>({ async start(c) { c.enqueue(await lire()); c.close(); } });
      const lu = (await s.getReader().read()).value;
      return [x, lu];
    }),
  ]);
  na.ok(a[0] && a[0] === a[1]);
  na.ok(b[0] && b[0] === b[1]);
  na.notEqual(a[0], b[0]);
  na.equal(a[0]!.enCours(), 3);
  na.equal(b[0]!.enCours(), 0);
});
