// src/spaces/copilot/hooks/useCopilotContext.ts
import { useCallback } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import type {
  MimmozaContext, Vertical, ParcelContextRef, StudyContextRef, PluContextRef,
} from '../types/copilot.types';

// ⚠️ Ordre important : les préfixes les plus spécifiques d'abord.
// '/marchand-de-bien' doit être testé AVANT '/marchand'.
const VERTICAL_BY_PREFIX: Array<[string, Vertical]> = [
  ['/promoteur', 'promoteur'],
  ['/investisseur', 'investisseur'],
  ['/marchand-de-bien', 'marchand'],   // route réelle de App.tsx
  ['/marchand', 'marchand'],
  ['/apporteur', 'apporteur'],
  ['/banque', 'investisseur'],         // la banque consomme du scoring investisseur
  ['/rehabilitation', 'promoteur'],    // réhabilitation rattachée au profil promoteur
  ['/particulier', 'particulier'],
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
}

/**
 * Construit le MimmozaContext au moment de l'envoi :
 *  - route lue depuis window.location (pas de dépendance routeur)
 *  - verticale : override > hints app > déduite de la route > 'generique'
 *  - parcelle / étude / plu : override > hints app
 */
export function useCopilotContext() {
  const contextHints = useCopilotStore((s) => s.contextHints);
  const setContextHints = useCopilotStore((s) => s.setContextHints);

  const buildContext = useCallback((overrides?: ContextOverrides): MimmozaContext => {
    const route = typeof window !== 'undefined' ? window.location.pathname : '/';
    const vertical =
      overrides?.vertical ??
      contextHints.vertical ??
      inferVerticalFromRoute(route) ??
      'generique';

    return {
      vertical,
      route,
      parcel: overrides?.parcel ?? contextHints.parcel,
      study: overrides?.study ?? contextHints.study,
      plu: overrides?.plu ?? contextHints.plu,
    };
  }, [contextHints]);

  return { buildContext, contextHints, setContextHints };
}