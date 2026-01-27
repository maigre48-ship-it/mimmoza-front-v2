// FILE: src/spaces/promoteur/etudes/marche/services/providers/dvfProvider.ts

import { RealEstateMarketData } from "../../types";

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
export async function fetchDvfData(params: DvfProviderParams): Promise<RealEstateMarketData | null> {
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
  lat: number,
  lon: number,
  radiusKm: number,
  periodMonths: number = 24
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

  const prices = transactions.map((t) => t.pricePerSqm).sort((a, b) => a - b);
  const n = prices.length;

  return {
    median: prices[Math.floor(n / 2)],
    mean: prices.reduce((a, b) => a + b, 0) / n,
    q1: prices[Math.floor(n * 0.25)],
    q3: prices[Math.floor(n * 0.75)],
    min: prices[0],
    max: prices[n - 1],
  };
}