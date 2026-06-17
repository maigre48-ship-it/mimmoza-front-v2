// src/spaces/marchand/hooks/useMarchandDealCopilotSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Synchronise automatiquement le deal marchand actif dans le contexte Copilot.
//
// Usage : appeler ce hook dans le layout racine de l'espace marchand
// (ex : MarchandRoot.tsx ou MarchandLayout.tsx), en lui passant le pathname
// issu de useLocation().
//
//   const { pathname } = useLocation();
//   useMarchandDealCopilotSync(pathname);
//
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { setActiveCopilotContext } from '../../copilot/store/activeCopilotContext.store';
import {
  MARCHAND_SNAPSHOT_EVENT,
  readMarchandSnapshot,
  type ExecutionSaved,
  type MarchandDeal,
} from '../shared/marchandSnapshot.store';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseRoute(pathname: string): {
  space: string;
  mode: string | undefined;
  tab: string | undefined;
} {
  // /marchand-de-bien/execution/simulation → ['marchand-de-bien', 'execution', 'simulation']
  const parts = pathname.split('/').filter(Boolean);
  return {
    space: 'marchand',
    mode: parts[1] ?? undefined,  // 'acquisition' | 'execution' | 'analyse'
    tab:  parts[2] ?? undefined,  // 'pipeline' | 'simulation' | 'travaux' | 'rentabilite' ...
  };
}

function extractWorksBudget(exec: ExecutionSaved | undefined): number | undefined {
  if (!exec?.travaux?.computed) return undefined;
  const c = exec.travaux.computed as Record<string, unknown>;
  // Cherche totalTTC, total_ttc ou totalHT selon la version du type
  const v = c['totalTTC'] ?? c['total_ttc'] ?? c['totalHT'] ?? undefined;
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function buildDealRef(
  deal: MarchandDeal,
  exec: ExecutionSaved | undefined,
) {
  return {
    id:            deal.id,
    title:         deal.title,
    address:       deal.address,
    surface:       deal.surfaceM2    ?? null,
    purchasePrice: deal.prixAchat    ?? null,
    resalePrice:   deal.prixReventeCible ?? null,
    worksBudget:   extractWorksBudget(exec) ?? null,
    status:        deal.status,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useMarchandDealCopilotSync(pathname: string): void {
  // Évite les re-renders inutiles si pathname n'a pas changé
  const pathnameRef = useRef<string | null>(null);

  useEffect(() => {
    function sync() {
      const snap   = readMarchandSnapshot();
      const activeId = snap.activeDealId;
      const deal   = activeId ? snap.deals.find(d => d.id === activeId) ?? null : null;
      const exec   = deal ? snap.executionByDeal[deal.id] : undefined;
      const route  = parseRoute(pathname);

      // Construire le pageContext
      const pageContext = {
        pathname,
        space: route.space,
        mode:  route.mode,
        tab:   route.tab,
      };

      if (deal) {
        const dealRef = buildDealRef(deal, exec);

        setActiveCopilotContext({
          vertical:    'marchand',
          route:       pathname,
          // Champs listing utilisés par buildEnrichedContext existant
          city:        deal.city,
          zipCode:     deal.zipCode,
          price:       deal.prixAchat,
          surface:     deal.surfaceM2,
          // Champs travaux
          renovation_cost_total:  extractWorksBudget(exec),
          renovation_cost_per_m2: (
            extractWorksBudget(exec) != null && deal.surfaceM2
              ? extractWorksBudget(exec)! / deal.surfaceM2
              : undefined
          ),
          // Nouveaux champs V1.1
          activeDeal:  dealRef,
          pageContext,
        });
      } else {
        // Pas de deal actif : on met à jour uniquement la route et le vertical
        setActiveCopilotContext({
          vertical:    'marchand',
          route:       pathname,
          city:        undefined,
          zipCode:     undefined,
          price:       undefined,
          surface:     undefined,
          renovation_cost_total:  undefined,
          renovation_cost_per_m2: undefined,
          activeDeal:  undefined,
          pageContext,
        });
      }
    }

    // Sync immédiat si pathname a changé
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname;
      sync();
    }

    // Re-sync si le snapshot change (deal sélectionné, données modifiées)
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, sync);
    return () => window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, sync);
  }, [pathname]);
}