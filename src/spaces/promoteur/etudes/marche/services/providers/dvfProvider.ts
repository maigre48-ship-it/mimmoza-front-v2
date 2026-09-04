// FILE: src/spaces/promoteur/etudes/marche/services/providers/dvfProvider.ts

import type { RealEstateData } from "../../types/competition";
import { prixM2Plausible } from "@/lib/dvf/plausibility";

export interface DvfProviderParams {
  lat: number;
  lon: number;
  radiusKm: number;
  periodMonths?: number;
  propertyTypes?: string[];
}

/**
 * Stub pour l'API DVF (Demandes de Valeurs Foncières)
 * À implémenter avec les vrais endpoints
 */
export async function fetchDvfData(_params: DvfProviderParams): Promise<RealEstateData | null> {
  // TODO: Implémenter l'appel réel
  // Source: https://app.dvf.etalab.gouv.fr/
  // API: https://api.cquest.org/dvf
  
  console.warn("[dvfProvider] Stub - données non implémentées");
  return null;
}

/**
 * Récupère les transactions brutes dans un périmètre
 */
export async function fetchDvfTransactions(
  _lat: number,
  _lon: number,
  _radiusKm: number,
  _periodMonths: number = 24
): Promise<Array<{
  id: string;
  date: string;
  price: number;
  surface: number;
  pricePerSqm: number;
  propertyType: string;
  commune: string;
  lat: number;
  lon: number;
}>> {
  // TODO: Implémenter
  console.warn("[dvfProvider] fetchDvfTransactions - stub");
  return [];
}

/**
 * Calcule les statistiques de prix à partir des transactions
 */
export function calculatePriceStatistics(
  transactions: Array<{ pricePerSqm: number; date: string }>
): {
  median: number;
  mean: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
} | null {
  if (!transactions.length) return null;

  // Médiane et quartiles INTERPOLÉS, bornes de plausibilité appliquées.
  // `prices[Math.floor(n/2)]` retournait la valeur haute du couple central sur
  // un échantillon pair, et rien n'écartait les mutations aberrantes — mêmes
  // défauts que les fonctions serveur, corrigés de la même façon.
  // Voir lib/dvf/plausibility et supabase/functions/_shared/dvf/stats.ts.
  const prices = transactions
    .map((t) => t.pricePerSqm)
    .filter(prixM2Plausible)
    .sort((a, b) => a - b);
  const n = prices.length;
  if (n === 0) return null;

  const quantile = (p: number): number => {
    if (n === 1) return prices[0];
    const position = (n - 1) * p;
    const bas = Math.floor(position);
    const haut = Math.ceil(position);
    return bas === haut
      ? prices[bas]
      : prices[bas] + (prices[haut] - prices[bas]) * (position - bas);
  };

  return {
    median: quantile(0.5),
    mean: prices.reduce((a, b) => a + b, 0) / n,
    q1: quantile(0.25),
    q3: quantile(0.75),
    min: prices[0],
    max: prices[n - 1],
  };
}