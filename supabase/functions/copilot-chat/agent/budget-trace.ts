// supabase/functions/copilot-chat/agent/budget-trace.ts
// =============================================================
// BUDGET D'APPELS IMBRIQUÉS PAR TRACE (limite plateforme Supabase)
//
// Supabase limite les appels d'une Edge Function vers une autre Edge Function
// du même projet : « Recursive/Nested Function Calling: 30 requests per trace,
// within a 60-second window » (docs/guides/functions/limits). Tous les appels
// émis pendant UNE requête entrante (et ceux qu'émettent, en cascade, les
// fonctions appelées) partagent ce budget. Au-delà, fetch() lève une
// RateLimitError « Rate limit exceeded for trace … Retry after N ms ».
//
// Incident du 02/11 : 4 get_etude_parcelle dans un même tour de chat =
// 4 × (1 appel etude-parcelle-v1 + 11 sources) = 48 appels > 30 → les sources
// des études 3 et 4 tombaient en « Rate limit exceeded for trace ».
//
// Ce module tient, PAR REQUÊTE ENTRANTE (AsyncLocalStorage), le compte des
// appels internes émis, et refuse proprement — avant de les émettre — ceux qui
// dépasseraient le budget : l'outil renvoie alors une erreur explicite (aucune
// donnée inventée) au lieu d'une étude amputée de ses sources.
// L'en-tête de trace est posé par la plateforme (le code n'en propage aucun) :
// on ne cherche PAS à le contourner, on reste dans le budget.
// =============================================================

import { AsyncLocalStorage } from 'node:async_hooks';

/** Limite documentée par Supabase (appels par trace et par fenêtre). */
export const LIMITE_APPELS_TRACE = 30;
export const FENETRE_TRACE_MS = 60_000;
/** Marge pour les appels imbriqués que copilot-chat ne voit pas (fonctions en cascade). */
export const MARGE_APPELS_TRACE = 2;
/** Attente maximale tolérée avant un appel (au-delà : refus immédiat et explicite). */
export const ATTENTE_MAX_CHAT_MS = 5_000;
export const ATTENTE_MAX_MISSION_MS = 15_000;

/**
 * Appels imbriqués émis par etude-parcelle-v1 pour UNE étude (tableau SOURCES :
 * loyers, zonage, taxes, assainissement, altimétrie, servitudes, solaire,
 * contexte, risques, dvf, bruit). À tenir aligné si une source est ajoutée.
 */
export const APPELS_IMBRIQUES_ETUDE_PARCELLE = 11;

export interface OptionsBudgetTrace {
  limite?: number;
  fenetreMs?: number;
  attenteMaxMs?: number;
  now?: () => number;
}

export class BudgetTrace {
  readonly limite: number;
  readonly fenetreMs: number;
  attenteMaxMs: number;
  private readonly now: () => number;
  /** Horodatage de chaque appel compté (un élément par appel). */
  private appels: number[] = [];
  /** Saturation signalée par la plateforme (Retry-After) : aucun appel avant. */
  private bloqueJusqua = 0;

  constructor(o: OptionsBudgetTrace = {}) {
    this.limite = o.limite ?? (LIMITE_APPELS_TRACE - MARGE_APPELS_TRACE);
    this.fenetreMs = o.fenetreMs ?? FENETRE_TRACE_MS;
    this.attenteMaxMs = o.attenteMaxMs ?? ATTENTE_MAX_CHAT_MS;
    this.now = o.now ?? Date.now;
  }

  private purger(t: number): void {
    const seuil = t - this.fenetreMs;
    while (this.appels.length && this.appels[0] <= seuil) this.appels.shift();
  }

  /** Appels comptés dans la fenêtre glissante courante. */
  enCours(): number {
    this.purger(this.now());
    return this.appels.length;
  }

  /**
   * Millisecondes à attendre avant de pouvoir émettre `cout` appels (0 =
   * immédiat ; Infinity = impossible, le coût dépasse la limite à lui seul).
   */
  attenteAvant(cout: number): number {
    const t = this.now();
    this.purger(t);
    if (cout > this.limite) return Number.POSITIVE_INFINITY;
    const blocage = Math.max(0, this.bloqueJusqua - t);
    const exces = this.appels.length + cout - this.limite;
    if (exces <= 0) return blocage;
    // Il faut que les `exces` plus anciens appels sortent de la fenêtre.
    const liberation = this.appels[exces - 1] + this.fenetreMs - t;
    return Math.max(blocage, liberation, 0);
  }

  /** Compte `cout` appels émis maintenant. */
  reserver(cout: number): void {
    const t = this.now();
    for (let i = 0; i < cout; i++) this.appels.push(t);
  }

  /** La plateforme a refusé un appel : plus rien avant `retryAfterMs`. */
  signalerSaturation(retryAfterMs: number): void {
    const ms = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : this.fenetreMs;
    this.bloqueJusqua = Math.max(this.bloqueJusqua, this.now() + ms);
  }
}

/** Erreur levée quand un appel interne ne tient pas dans le budget de la trace. */
export class ErreurBudgetTrace extends Error {
  constructor(readonly fonction: string, readonly attenteMs: number) {
    super(messageBudgetTrace(fonction, attenteMs));
    this.name = 'ErreurBudgetTrace';
  }
}

export function messageBudgetTrace(fonction: string, attenteMs: number): string {
  const s = Number.isFinite(attenteMs) ? `${Math.max(1, Math.ceil(attenteMs / 1000))} s` : 'la prochaine requête';
  return `${fonction} non appelée : limite Supabase des appels imbriqués atteinte ` +
    `(${LIMITE_APPELS_TRACE} appels par requête sur ${FENETRE_TRACE_MS / 1000} s). ` +
    `Aucune donnée n'a été obtenue pour cette source ; nouvelle tentative possible dans ${s}. ` +
    'Pour étudier plusieurs terrains, passer par une mission (proposer_mission).';
}

/**
 * Réserve `cout` appels, en attendant au plus `budget.attenteMaxMs`.
 * Lève ErreurBudgetTrace si l'attente nécessaire dépasse ce plafond.
 */
export async function acquerirBudget(
  budget: BudgetTrace, cout: number, fonction: string,
  dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  const attente = budget.attenteAvant(cout);
  if (attente > budget.attenteMaxMs) throw new ErreurBudgetTrace(fonction, attente);
  if (attente > 0) await dormir(attente);
  budget.reserver(cout);
}

/**
 * Reconnaît le refus « Rate limit exceeded for trace … » de la plateforme,
 * qu'il arrive en exception (RateLimitError, propriété retryAfterMs) ou en
 * texte de réponse. Renvoie le délai d'attente annoncé, ou null.
 */
export function lireRefusTrace(e: unknown): { retryAfterMs: number } | null {
  if (e == null) return null;
  const o = e as { name?: unknown; message?: unknown; retryAfterMs?: unknown };
  const texte = typeof e === 'string' ? e : String(o.message ?? '');
  const estRefus = o.name === 'RateLimitError' || /rate limit exceeded for trace/i.test(texte);
  if (!estRefus) return null;
  if (typeof o.retryAfterMs === 'number' && Number.isFinite(o.retryAfterMs)) return { retryAfterMs: o.retryAfterMs };
  const m = texte.match(/retry after\s+(\d+)\s*ms/i);
  return { retryAfterMs: m ? Number(m[1]) : FENETRE_TRACE_MS };
}

// ── Portée : un budget par requête entrante ─────────────────────────────────

const stockage = new AsyncLocalStorage<BudgetTrace>();

/** Exécute `fn` avec un budget neuf (une requête entrante = une trace). */
export function avecBudgetTrace<T>(fn: () => T, o: OptionsBudgetTrace = {}): T {
  return stockage.run(new BudgetTrace(o), fn);
}

/** Budget de la requête en cours (undefined hors requête : aucune garde). */
export function budgetTraceCourant(): BudgetTrace | undefined {
  return stockage.getStore();
}
