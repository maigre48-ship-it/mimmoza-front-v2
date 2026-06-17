// src/spaces/copilot/hooks/useCopilotPageSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hook générique : met à jour le vertical + pageContext dans activeCopilotContext
// à chaque changement de route. Efface les champs listing/deal stale si le
// vertical change (évite que les outils investisseur soient appelés sur rehab).
//
// Usage dans n'importe quel layout :
//
//   const { pathname } = useLocation();
//   useCopilotPageSync(pathname, 'promoteur');
//
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import type { ActiveCopilotSnapshot } from '../store/activeCopilotContext.store';
import {
  getActiveCopilotContext,
  setActiveCopilotContext,
} from '../store/activeCopilotContext.store';

type CopilotVertical = NonNullable<ActiveCopilotSnapshot['vertical']>;

function parseRoute(pathname: string, space: string) {
  const parts = pathname.split('/').filter(Boolean);
  return {
    space,
    mode: parts[1] ?? undefined,
    tab:  parts[2] ?? undefined,
  };
}

// Champs listing/deal à effacer lors d'un changement de vertical
// pour éviter que les outils investisseur soient déclenchés sur d'autres espaces
const LISTING_FIELDS_TO_CLEAR: Partial<ActiveCopilotSnapshot> = {
  activeListingId:        undefined,
  listingUrl:             undefined,
  city:                   undefined,
  zipCode:                undefined,
  price:                  undefined,
  surface:                undefined,
  propertyType:           undefined,
  renovation_cost_total:  undefined,
  renovation_cost_per_m2: undefined,
  renovation_level:       undefined,
  renovation_gamme:       undefined,
  activeDeal:             undefined,
};

export function useCopilotPageSync(
  pathname: string,
  vertical: CopilotVertical,
): void {
  const prevPathname = useRef<string | null>(null);
  const prevVertical = useRef<CopilotVertical | null>(null);

  useEffect(() => {
    if (prevPathname.current === pathname && prevVertical.current === vertical) return;

    const verticalChanged = prevVertical.current !== null && prevVertical.current !== vertical;
    prevPathname.current = pathname;
    prevVertical.current = vertical;

    const route = parseRoute(pathname, vertical);

    // Si le vertical change, effacer les données contextuelles de l'espace précédent
    // pour éviter les appels d'outils hors-contexte (ex: SmartScore sur rehab)
    if (verticalChanged) {
      const current = getActiveCopilotContext();
      const hasStaleListingData =
        current.activeListingId || current.price || current.city || current.activeDeal;

      if (hasStaleListingData) {
        console.log(`[CopilotPageSync] Vertical changed ${prevVertical.current}→${vertical}, clearing stale listing context`);
        setActiveCopilotContext({
          ...LISTING_FIELDS_TO_CLEAR,
          vertical,
          route: pathname,
          pageContext: {
            pathname,
            space: route.space,
            mode:  route.mode,
            tab:   route.tab,
          },
        });
        return;
      }
    }

    setActiveCopilotContext({
      vertical,
      route: pathname,
      pageContext: {
        pathname,
        space: route.space,
        mode:  route.mode,
        tab:   route.tab,
      },
    });
  }, [pathname, vertical]);
}