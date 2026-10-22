// src/lib/monitoring/core.ts
// =============================================================================
// Suivi des erreurs — logique PURE (sans DOM ni Supabase), testée par node --test.
//
// Règles de confidentialité appliquées ICI, avant tout envoi :
//   · route = chemin seul (ni query string ni ancre), identifiants remplacés ;
//   · contexte filtré : aucune clé qui ressemble à un secret ou à une donnée
//     personnelle, aucune valeur longue (contenu de formulaire, texte libre) ;
//   · message et pile tronqués.
// =============================================================================

import { empreinteErreur } from '../../../supabase/functions/_shared/copilot-stream/reprise.ts';

export type SourceErreur = 'front' | 'react' | 'promesse' | 'copilot' | 'edge';

export interface RapportErreur {
  source: SourceErreur;
  message: string;
  stack?: string | null;
  /** Chemin ou URL ; nettoyé avant envoi. Défaut : la page courante. */
  route?: string | null;
  context?: Record<string, unknown>;
}

export interface ChargeUtile {
  p_source: SourceErreur;
  p_route: string;
  p_message: string;
  p_stack: string | null;
  p_user_agent: string | null;
  p_release: string | null;
  p_context: Record<string, unknown>;
  p_fingerprint: string;
}

export const LIMITES = {
  message: 1000,
  stack: 4000,
  route: 300,
  userAgent: 300,
  valeurContexte: 200,
  clesContexte: 25,
} as const;

export function tronquer(texte: string | null | undefined, max: number): string {
  const t = (texte ?? '').toString();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const SEGMENT_IDENTIFIANT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i;

/** Chemin seul, sans query ni ancre, identifiants remplacés par « :id ». */
export function nettoyerRoute(entree: string | null | undefined): string {
  let chemin = (entree ?? '').toString().trim();
  if (!chemin) return '/';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(chemin)) chemin = new URL(chemin).pathname;
  } catch { /* chemin brut */ }
  chemin = chemin.split('#')[0].split('?')[0] || '/';
  const propre = chemin
    .split('/')
    .map((seg) => (SEGMENT_IDENTIFIANT.test(seg) ? ':id' : seg))
    .join('/');
  return tronquer(propre, LIMITES.route);
}

const CLE_SENSIBLE =
  /(token|jwt|password|passe|secret|authorization|cookie|apikey|api_key|cle|email|mail|phone|telephone|iban|adresse|address|content|texte|message_utilisateur|prompt|body|payload)/i;

/** Contexte « sûr » : scalaires courts, clés non sensibles, profondeur 1. */
export function nettoyerContexte(ctx: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!ctx || typeof ctx !== 'object') return out;
  let n = 0;
  for (const [cle, valeur] of Object.entries(ctx)) {
    if (n >= LIMITES.clesContexte) break;
    if (CLE_SENSIBLE.test(cle)) continue;
    if (valeur == null || typeof valeur === 'boolean' || typeof valeur === 'number') {
      out[cle] = valeur ?? null;
    } else if (typeof valeur === 'string') {
      out[cle] = tronquer(valeur, LIMITES.valeurContexte);
    } else {
      continue; // objets et tableaux écartés : trop de risque d'embarquer une donnée saisie
    }
    n++;
  }
  return out;
}

/** Bruit connu, sans valeur de diagnostic. */
export function estBruit(message: string, stack?: string | null): boolean {
  const m = message || '';
  return /ResizeObserver loop/i.test(m)
    || /^Script error\.?$/i.test(m.trim())
    || /AbortError|The user aborted a request|signal is aborted/i.test(m)
    || /(chrome|moz|safari)-extension:\/\//i.test(`${m}\n${stack ?? ''}`);
}

/**
 * Limiteur côté navigateur : au plus `maxParMinute` envois, et une même
 * empreinte au plus une fois par `fenetreDedupMs`. Le serveur applique ses
 * propres plafonds ; celui-ci évite simplement de l'appeler pour rien.
 */
export class Limiteur {
  private envois: number[] = [];
  private vues = new Map<string, number>();
  private readonly maxParMinute: number;
  private readonly fenetreDedupMs: number;

  constructor(maxParMinute = 10, fenetreDedupMs = 5 * 60_000) {
    this.maxParMinute = maxParMinute;
    this.fenetreDedupMs = fenetreDedupMs;
  }

  accepter(empreinte: string, maintenant: number): boolean {
    const derniere = this.vues.get(empreinte);
    if (derniere != null && maintenant - derniere < this.fenetreDedupMs) return false;
    this.envois = this.envois.filter((t) => maintenant - t < 60_000);
    if (this.envois.length >= this.maxParMinute) return false;
    this.envois.push(maintenant);
    this.vues.set(empreinte, maintenant);
    if (this.vues.size > 500) {
      for (const [k, t] of this.vues) if (maintenant - t >= this.fenetreDedupMs) this.vues.delete(k);
    }
    return true;
  }
}

/** Échantillonnage : `taux` ∈ [0, 1]. */
export function echantillonner(taux: number, aleatoire: number): boolean {
  if (!Number.isFinite(taux) || taux >= 1) return true;
  if (taux <= 0) return false;
  return aleatoire < taux;
}

/**
 * Version du build : variable d'environnement si fournie, sinon le hash du
 * bundle principal (`/assets/index-XXXX.js`), qui change à chaque déploiement.
 */
export function versionDepuisScripts(sources: string[], envRelease?: string | null): string | null {
  if (envRelease && envRelease.trim()) return envRelease.trim().slice(0, 40);
  for (const src of sources) {
    const m = /\/assets\/index-([A-Za-z0-9_-]{6,})\.js/.exec(src);
    if (m) return m[1];
  }
  return null;
}

export function construireChargeUtile(
  r: RapportErreur,
  env: { routeCourante: string; userAgent: string | null; release: string | null },
): ChargeUtile {
  const message = tronquer(r.message || 'Erreur sans message', LIMITES.message);
  const stack = r.stack ? tronquer(r.stack, LIMITES.stack) : null;
  return {
    p_source: r.source,
    p_route: nettoyerRoute(r.route ?? env.routeCourante),
    p_message: message,
    p_stack: stack,
    p_user_agent: env.userAgent ? tronquer(env.userAgent, LIMITES.userAgent) : null,
    p_release: env.release,
    p_context: nettoyerContexte(r.context),
    p_fingerprint: empreinteErreur(r.source, message, stack),
  };
}

/** Transforme n'importe quelle valeur levée en { message, stack }. */
export function decrireErreur(valeur: unknown): { message: string; stack: string | null } {
  if (valeur instanceof Error) return { message: `${valeur.name}: ${valeur.message}`, stack: valeur.stack ?? null };
  if (typeof valeur === 'string') return { message: valeur, stack: null };
  try {
    return { message: tronquer(JSON.stringify(valeur), LIMITES.message), stack: null };
  } catch {
    return { message: String(valeur), stack: null };
  }
}
