// src/lib/monitoring/index.ts
// =============================================================================
// Suivi des erreurs de Mimmoza — sans service externe.
//
// Les erreurs du navigateur (exceptions, promesses rejetées, erreurs React,
// échecs du flux de Mimmo) sont envoyées à la RPC `report_client_error`
// (migration 20261022_suivi_erreurs.sql), qui les borne, les dé-duplique et les
// range dans `public.client_errors`. Lecture : page admin « Erreurs ».
//
// Garanties :
//   · JAMAIS bloquant ni bruyant : toute défaillance du suivi est avalée ;
//   · inactif en développement, sauf VITE_MONITORING_DEV=1 ;
//   · dé-duplication + plafond côté navigateur, échantillonnage réglable
//     (VITE_MONITORING_SAMPLE, défaut 1) ;
//   · Sentry en option : chargé à la demande depuis son CDN UNIQUEMENT si
//     VITE_SENTRY_DSN est renseigné — aucune dépendance dans le bundle.
// =============================================================================

import { supabase } from '@/lib/supabase';
import {
  Limiteur,
  construireChargeUtile,
  decrireErreur,
  echantillonner,
  estBruit,
  versionDepuisScripts,
  type RapportErreur,
} from './core';

export type { RapportErreur, SourceErreur } from './core';

const env = import.meta.env as Record<string, string | boolean | undefined>;
const ACTIF = Boolean(env.PROD) || env.VITE_MONITORING_DEV === '1';
const TAUX = Number(env.VITE_MONITORING_SAMPLE ?? 1);
const DSN_SENTRY = typeof env.VITE_SENTRY_DSN === 'string' ? env.VITE_SENTRY_DSN.trim() : '';
/** Version figée du SDK chargé depuis le CDN Sentry (option désactivée par défaut). */
const VERSION_SENTRY = '8.55.0';

const limiteur = new Limiteur(10, 5 * 60_000);
let installe = false;
let release: string | null | undefined;
let sentry: { captureException: (e: unknown, ctx?: unknown) => void } | null = null;

function versionBuild(): string | null {
  if (release !== undefined) return release;
  try {
    const sources = Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src);
    release = versionDepuisScripts(sources, (env.VITE_RELEASE || env.VITE_VERCEL_GIT_COMMIT_SHA || null) as string | null);
  } catch {
    release = null;
  }
  return release;
}

/**
 * Signale une erreur. Ne lève jamais, ne bloque jamais ; renvoie une promesse
 * qu'on peut ignorer (`void signalerErreur(...)`).
 */
export async function signalerErreur(r: RapportErreur, original?: unknown): Promise<void> {
  try {
    if (!ACTIF || typeof window === 'undefined') return;
    if (estBruit(r.message, r.stack)) return;
    if (!echantillonner(TAUX, Math.random())) return;

    const charge = construireChargeUtile(r, {
      routeCourante: window.location?.pathname ?? '/',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      release: versionBuild(),
    });
    if (!limiteur.accepter(charge.p_fingerprint, Date.now())) return;

    if (sentry) {
      try { sentry.captureException(original ?? new Error(charge.p_message), { tags: { source: r.source } }); } catch { /* ignoré */ }
    }

    const { error } = await supabase.rpc('report_client_error', charge);
    if (error && env.DEV) console.debug('[monitoring] envoi refusé :', error.message);
  } catch {
    /* le suivi des erreurs ne doit jamais devenir une source d'erreurs */
  }
}

/** Erreur React : à brancher sur les options `onCaughtError` / `onUncaughtError` de createRoot. */
export function signalerErreurReact(erreur: unknown, composants?: string | null, attrapee = true): void {
  const { message, stack } = decrireErreur(erreur);
  void signalerErreur({
    source: 'react',
    message,
    stack: stack ?? composants ?? null,
    context: { attrapee, composant: (composants ?? '').trim().split('\n')[0]?.trim().slice(0, 120) ?? null },
  }, erreur);
}

async function chargerSentry(): Promise<void> {
  if (!DSN_SENTRY || sentry) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://browser.sentry-cdn.com/${VERSION_SENTRY}/bundle.min.js`;
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Sentry CDN indisponible'));
    document.head.appendChild(s);
  });
  const S = (window as unknown as { Sentry?: { init: (o: unknown) => void; captureException: (e: unknown, c?: unknown) => void } }).Sentry;
  if (!S) return;
  S.init({ dsn: DSN_SENTRY, release: versionBuild() ?? undefined, sendDefaultPii: false, defaultIntegrations: false, tracesSampleRate: 0 });
  sentry = S;
}

/** Installe les écouteurs globaux. Idempotent. */
export function installerSuiviErreurs(): void {
  if (installe || typeof window === 'undefined') return;
  installe = true;
  if (!ACTIF) return;

  window.addEventListener('error', (ev: ErrorEvent) => {
    // Échec de chargement d'une ressource (img, script) : pas d'ErrorEvent utile.
    if (!(ev instanceof ErrorEvent)) return;
    const { message, stack } = ev.error ? decrireErreur(ev.error) : { message: ev.message, stack: null };
    void signalerErreur({
      source: 'front',
      message: message || ev.message,
      stack: stack ?? (ev.filename ? `at ${ev.filename}:${ev.lineno}:${ev.colno}` : null),
    }, ev.error);
  });

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const { message, stack } = decrireErreur(ev.reason);
    void signalerErreur({ source: 'promesse', message, stack }, ev.reason);
  });

  if (DSN_SENTRY) {
    // Hors du chemin critique : après le chargement de la page.
    const lancer = () => { void chargerSentry().catch(() => { /* option facultative */ }); };
    if (document.readyState === 'complete') setTimeout(lancer, 0);
    else window.addEventListener('load', () => setTimeout(lancer, 0), { once: true });
  }
}
