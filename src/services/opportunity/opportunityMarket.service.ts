// =============================================================
// Mimmoza · Opportunity Engine — Référence marché DVF (V1)
// Récupère la médiane DVF €/m² par (commune/CP + type de bien) via le helper
// existant `fetchBestDvfEstimate` (RPC get_dvf_comps_v1). Mise en cache.
//
// Sert au pilier "Décote marché" : on compare le prix/m² de chaque annonce
// à cette référence. Aucune valeur inventée : si DVF indisponible -> null.
// =============================================================

// ⚠️ CHEMINS À CONFIRMER.
import { fetchBestDvfEstimate } from '@/lib/dvfEstimateApi';
import { supabase } from '@/lib/supabase';

import type { OpportunityAssetType } from './opportunityEngine.types';

export interface MarketReference {
  /** Médiane DVF €/m² de la zone (commune ou CP), ou null si indisponible. */
  refPriceM2: number | null;
  /** Nombre de transactions DVF retenues (taille d'échantillon). */
  sampleSize: number;
}

const EMPTY: MarketReference = { refPriceM2: null, sampleSize: 0 };

const cache = new Map<string, MarketReference>();

/** Mappe le type de bien interne vers le `type_local` DVF. */
function toDvfTypeLocal(assetType: OpportunityAssetType): string | null {
  if (assetType === 'appartement') return 'Appartement';
  if (assetType === 'maison') return 'Maison';
  // terrain / immeuble / local / unknown : pas de type_local fiable -> tous types
  return null;
}

export interface ResolveMarketParams {
  codeInsee: string | null;
  zip?: string;
  assetType: OpportunityAssetType;
}

/**
 * Résout la référence prix/m² DVF pour une zone + type. Mise en cache.
 * Défensif : toute erreur -> refPriceM2 null (pilier "en attente").
 */
export async function resolveMarketReference(params: ResolveMarketParams): Promise<MarketReference> {
  const insee = params.codeInsee?.trim() || '';
  const zip = params.zip?.trim() || '';
  if (!insee && !zip) return EMPTY;

  const typeLocal = toDvfTypeLocal(params.assetType);
  const key = `${insee}|${zip}|${typeLocal ?? 'all'}`.toLowerCase();

  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const res = await fetchBestDvfEstimate(supabase, {
      commune_insee: insee || '00000',
      code_postal: zip || null,
      surface_m2: 70, // n'affecte pas la médiane €/m², seulement la fourchette
      pieces: null,
      months: 24,
      type_local: typeLocal,
    });

    const r = res?.best?.result;
    const refPriceM2 =
      r && r.success && typeof r.stats?.price_m2_median === 'number'
        ? r.stats.price_m2_median
        : null;
    const sampleSize =
      r && typeof r.stats?.transactions_count === 'number' ? r.stats.transactions_count : 0;

    const out: MarketReference = { refPriceM2, sampleSize };
    cache.set(key, out);
    return out;
  } catch {
    return EMPTY;
  }
}

/** Vide le cache (force un recalcul). */
export function clearMarketCache(): void {
  cache.clear();
}