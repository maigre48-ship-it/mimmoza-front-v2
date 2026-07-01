// src/spaces/copilot/hooks/useCopilotContext.ts
// PATCH V1.2 : injection du predictive_snapshot dans buildContext (LOT 6)
// PATCH V1.3 : injection du valuation_engine dans buildContext (LOT 7)
// PATCH V1.5 : budget travaux lu DIRECTEMENT depuis localStorage (snapshots
//              marchand + investisseur) au lieu du store Copilot éphémère.
//              → le Copilot a toujours le budget, quelle que soit la page,
//                sans dépendre du montage du simulateur ni d'un alias d'import.
// =============================================================================

import { useCallback } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import type {
  MimmozaContext,
  ParcelContextRef,
  PluContextRef,
  PredictiveSnapshotContext,
  StudyContextRef,
  ValuationEngineContext,
  Vertical,
} from '../types/copilot.types';

// ⚠️ Ordre important : les préfixes les plus spécifiques d'abord.
const VERTICAL_BY_PREFIX: Array<[string, Vertical]> = [
  ['/promoteur',        'promoteur'],
  ['/investisseur',     'investisseur'],
  ['/marchand-de-bien', 'marchand'],
  ['/marchand',         'marchand'],
  ['/apporteur',        'apporteur'],
  ['/banque',           'investisseur'],
  ['/rehabilitation',   'promoteur'],
  ['/particulier',      'particulier'],
];

function inferVerticalFromRoute(route: string): Vertical | undefined {
  for (const [prefix, vertical] of VERTICAL_BY_PREFIX) {
    if (route.startsWith(prefix)) return vertical;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Budget travaux : lecture directe localStorage (zéro dépendance)    */
/* ------------------------------------------------------------------ */

// Trouve la clé localStorage qui se termine par un suffixe donné
// (les clés sont préfixées par "u:<userId>:" via userScopedStorage).
function findStorageKey(suffix: string): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.endsWith(suffix)) return k;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readJson(key: string | null): unknown {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function asPositiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/**
 * Lit le budget travaux (totalWithBuffer) directement depuis le localStorage.
 * Priorité : snapshot marchand (executionByDeal[activeDealId]) ;
 * fallback : snapshot investisseur (projects[activeProjectId]).
 * Lecture par clés → aucune dépendance d'import de module.
 */
function readTravauxBudgetFromStorage(): number | null {
  // 1) Snapshot marchand
  try {
    const ms = readJson(findStorageKey('mimmoza.marchand.snapshot.v1')) as
      | {
          activeDealId?: string | null;
          executionByDeal?: Record<
            string,
            { travaux?: { computed?: { totalWithBuffer?: number } } } | undefined
          >;
        }
      | null;

    const dealId = ms?.activeDealId ?? null;
    if (dealId && ms?.executionByDeal) {
      const v = ms.executionByDeal[dealId]?.travaux?.computed?.totalWithBuffer;
      const n = asPositiveInt(v);
      if (n !== null) return n;
    }
  } catch {
    /* ignore, on tente l'investisseur */
  }

  // 2) Snapshot investisseur (fallback)
  try {
    const snap = readJson(findStorageKey('mimmoza.investisseur.snapshot.v1')) as
      | {
          activeProjectId?: string | null;
          projects?: Record<
            string,
            { execution?: { travaux?: { computed?: { totalWithBuffer?: number } } } } | undefined
          >;
        }
      | null;

    const pid = snap?.activeProjectId ?? null;
    if (pid && snap?.projects) {
      const v = snap.projects[pid]?.execution?.travaux?.computed?.totalWithBuffer;
      const n = asPositiveInt(v);
      if (n !== null) return n;
    }
  } catch {
    /* ignore */
  }

  return null;
}

interface ContextOverrides {
  vertical?: Vertical;
  parcel?: ParcelContextRef;
  study?: StudyContextRef;
  plu?: PluContextRef;
  // V1.2 — override optionnel du snapshot prédictif
  predictive_snapshot?: PredictiveSnapshotContext | null;
  // V1.3 — override optionnel du résultat valuation engine
  valuation_engine?: ValuationEngineContext | null;
}

/**
 * Construit le MimmozaContext au moment de l'envoi :
 *  - route lue depuis window.location
 *  - verticale : override > hints app > déduite de la route > 'generique'
 *  - parcelle / étude / plu : override > hints app
 *  - predictive_snapshot : override > hints app (injecté par AnalysePredictivePanel)
 *  - valuation_engine    : override > hints app (injecté par AnalysePage)
 *  - budget travaux (V1.5) : lu en direct depuis localStorage et fusionné dans
 *    predictive_snapshot.travaux_budget (champ déjà sérialisé par copilot-chat).
 */
export function useCopilotContext() {
  const contextHints    = useCopilotStore((s) => s.contextHints);
  const setContextHints = useCopilotStore((s) => s.setContextHints);

  const buildContext = useCallback((overrides?: ContextOverrides): MimmozaContext => {
    const route = typeof window !== 'undefined' ? window.location.pathname : '/';
    const vertical =
      overrides?.vertical ??
      contextHints.vertical ??
      inferVerticalFromRoute(route) ??
      'generique';

    // ── Budget travaux : lecture directe localStorage (indépendant du montage) ─
    const renovationBudget = readTravauxBudgetFromStorage();

    // ── predictive_snapshot : override > hints stockés dans le store ───────────
    const basePredictive: PredictiveSnapshotContext | null =
      overrides?.predictive_snapshot !== undefined
        ? overrides.predictive_snapshot
        : contextHints.predictive_snapshot ?? null;

    // Fusion du budget travaux dans le snapshot prédictif (champ travaux_budget).
    let predictive_snapshot: PredictiveSnapshotContext | null = basePredictive;
    if (renovationBudget != null) {
      predictive_snapshot = {
        ...(basePredictive ?? {}),
        travaux_budget: renovationBudget,
      };
    }

    // ── DEBUG LOT 6/7 — à supprimer après validation ──────────────────────────
    if (import.meta.env.DEV) {
      console.log('[COPILOT DEBUG] buildContext appelé');
      console.log('[COPILOT DEBUG] contextHints.predictive_snapshot:', contextHints.predictive_snapshot);
      console.log('[COPILOT DEBUG] sources_count:', contextHints.predictive_snapshot?.sources_count);
      console.log('[COPILOT DEBUG] dvf:', contextHints.predictive_snapshot?.dvf);
      console.log('[COPILOT DEBUG] market_scores:', contextHints.predictive_snapshot?.market_scores);
      console.log('[COPILOT DEBUG] contextHints.valuation_engine:', contextHints.valuation_engine);
      console.log('[COPILOT DEBUG] valuation estimatedValue:', contextHints.valuation_engine?.estimatedValue);
      console.log('[COPILOT DEBUG] valuation confidenceScore:', contextHints.valuation_engine?.confidenceScore);
      console.log('[COPILOT DEBUG] travaux budget (localStorage):', renovationBudget);
      console.log('[COPILOT DEBUG] travaux_budget injecté:', predictive_snapshot?.travaux_budget);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const ctx: MimmozaContext = {
      vertical,
      route,
      parcel:   overrides?.parcel   ?? contextHints.parcel,
      study:    overrides?.study    ?? contextHints.study,
      plu:      overrides?.plu      ?? contextHints.plu,
      // V1.2 — snapshot prédictif (avec budget travaux fusionné en V1.5)
      predictive_snapshot,
      // V1.3 — valuation engine : override > hints stockés dans le store
      valuation_engine:
        overrides?.valuation_engine !== undefined
          ? overrides.valuation_engine
          : contextHints.valuation_engine ?? null,
    };

    if (import.meta.env.DEV) {
      console.log('[COPILOT DEBUG] ctx.predictive_snapshot présent:', !!ctx.predictive_snapshot);
      console.log('[COPILOT DEBUG] ctx.predictive_snapshot.travaux_budget:', ctx.predictive_snapshot?.travaux_budget);
      console.log('[COPILOT DEBUG] ctx.valuation_engine présent:', !!ctx.valuation_engine);
    }

    return ctx;
  }, [contextHints]);

  return { buildContext, contextHints, setContextHints };
}