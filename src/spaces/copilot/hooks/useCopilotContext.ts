// src/spaces/copilot/hooks/useCopilotContext.ts
// PATCH V1.2 : injection du predictive_snapshot dans buildContext (LOT 6)
// PATCH V1.3 : injection du valuation_engine dans buildContext (LOT 7)
// =============================================================================

import { useCallback } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import type {
  MimmozaContext,
  Vertical,
  ParcelContextRef,
  StudyContextRef,
  PluContextRef,
  PredictiveSnapshotContext,
  ValuationEngineContext,
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
    }
    // ─────────────────────────────────────────────────────────────────────────

    const ctx: MimmozaContext = {
      vertical,
      route,
      parcel:   overrides?.parcel   ?? contextHints.parcel,
      study:    overrides?.study    ?? contextHints.study,
      plu:      overrides?.plu      ?? contextHints.plu,
      // V1.2 — snapshot prédictif : override > hints stockés dans le store
      predictive_snapshot:
        overrides?.predictive_snapshot !== undefined
          ? overrides.predictive_snapshot
          : contextHints.predictive_snapshot ?? null,
      // V1.3 — valuation engine : override > hints stockés dans le store
      valuation_engine:
        overrides?.valuation_engine !== undefined
          ? overrides.valuation_engine
          : contextHints.valuation_engine ?? null,
    };

    if (import.meta.env.DEV) {
      console.log('[COPILOT DEBUG] ctx.predictive_snapshot présent:', !!ctx.predictive_snapshot);
      console.log('[COPILOT DEBUG] ctx.valuation_engine présent:', !!ctx.valuation_engine);
    }

    return ctx;
  }, [contextHints]);

  return { buildContext, contextHints, setContextHints };
}