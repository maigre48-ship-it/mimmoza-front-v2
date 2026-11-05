// deno test supabase/functions/copilot-chat/agent/file-appels.test.ts — lot Q3 (point 11), sans réseau.
// Limite Supabase : 30 appels imbriqués par requête sur 60 s (8 échecs get_etude_parcelle en prospection,
// 05/11/2026). Le moteur étale ses appels (file à fenêtre glissante) et ATTEND / REPREND plutôt qu'échouer.
import * as na from 'node:assert/strict';
import type { ResultatOutil } from './types.ts';
import { appelAvecFile, APPELS_IMBRIQUES_MAX, FileAppels, POIDS_APPEL, RE_LIMITE_APPELS } from './mission.ts';

Deno.test('Q3-11 : file à fenêtre glissante — attend une place (horloge simulée), jamais plus de N unités par 60 s', async () => {
  const h = { t: 0 };
  const attentes: number[] = [];
  const f = new FileAppels(() => h.t, async (ms) => { attentes.push(ms); h.t += ms; });
  for (let i = 0; i < APPELS_IMBRIQUES_MAX; i++) na.ok(await f.acquerir(Number.POSITIVE_INFINITY));
  na.equal(f.charge(), APPELS_IMBRIQUES_MAX);
  na.equal(attentes.length, 0);
  na.ok(await f.acquerir(Number.POSITIVE_INFINITY), 'la 21e attend la libération de la fenêtre');
  na.ok((attentes.length as number) === 1 && h.t >= 60_000, `attente ${attentes} → t=${h.t}`);
  // Attente au-delà de la limite (fin de tick) : refus, pas d'appel.
  const g = new FileAppels(() => h.t, async (ms) => { h.t += ms; });
  na.ok(await g.acquerir(Number.POSITIVE_INFINITY, 20));
  na.equal(await g.acquerir(h.t + 1000, 5), false);
  // Horloge figée (attente interrompue) : jamais de boucle infinie.
  const figee = new FileAppels(() => 0, async () => {});
  na.ok(await figee.acquerir(Number.POSITIVE_INFINITY, 20));
  na.equal(await figee.acquerir(Number.POSITIVE_INFINITY, 1), false);
});

Deno.test('Q3-11 : appel refusé par la limite Supabase → attente puis REPRISE (pas d’échec) ; sinon « reporté »', async () => {
  const h = { t: 0 };
  const deps = { now: () => h.t, dormir: async (ms: number) => { h.t += ms; } } as never;
  const file = new FileAppels(() => h.t, async (ms) => { h.t += ms; });
  let n = 0;
  const r = await appelAvecFile({ deps, file, finA: 1e9 }, 'get_etude_parcelle', async () => {
    n++;
    return (n === 1
      ? { status: 'error', source: 'x', message: 'Edge Function: Too many nested function calls (508 Loop Detected)' }
      : { status: 'ok', source: 'x', data: { ok: true } }) as ResultatOutil;
  });
  na.equal(r.status, 'ok');
  na.equal(n, 2, 'repris une fois');
  na.ok(h.t >= 10_000, 'après une attente');
  // Toujours refusé : « reporté » (message clair), jamais une erreur sur le terrain.
  const r2 = await appelAvecFile({ deps, file, finA: 1e9 }, 'get_etude_parcelle', async () =>
    ({ status: 'error', source: 'x', message: 'HTTP 429 Too Many Requests' }) as ResultatOutil);
  na.equal(r2.status, 'error');
  na.ok(String(r2.message).startsWith('Appel reporté') && (r2.data as { reporte?: boolean }).reporte === true);
  // Une erreur ordinaire n'est jamais rejouée.
  let k = 0;
  const r3 = await appelAvecFile({ deps, file, finA: 1e9 }, 'get_zonage_plu', async () => { k++; return { status: 'error', source: 'x', message: 'GPU injoignable' } as ResultatOutil; });
  na.equal(k, 1); na.equal(r3.message, 'GPU injoignable');
  na.ok(RE_LIMITE_APPELS.test('appels imbriqués') && !RE_LIMITE_APPELS.test('parcelle introuvable'));
  na.ok(POIDS_APPEL.get_etude_parcelle > 1);
});
