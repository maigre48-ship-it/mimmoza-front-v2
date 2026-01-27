// FILE: src/spaces/promoteur/etudes/marche/services/providers/bpeProvider.ts

import { ServicesData, Poi, PoiCategoryId } from "../../types";

export interface BpeProviderParams {
  lat: number;
  lon: number;
  radiusKm: number;
  categories?: string[]; // Codes BPE
}

/**
 * Stub pour l'API BPE (Base Permanente des Équipements)
 * À implémenter avec les vrais endpoints
 */
export async function fetchBpeData(params: BpeProviderParams): Promise<ServicesData | null> {
  // TODO: Implémenter l'appel réel
  // Source: https://www.data.gouv.fr/fr/datasets/base-permanente-des-equipements/
  // API possible via geo.api.gouv.fr ou données locales
  
  console.warn("[bpeProvider] Stub - données non implémentées");
  return null;
}

/**
 * Récupère les équipements BPE dans un rayon
 */
export async function fetchBpeEquipments(
  lat: number,
  lon: number,
  radiusKm: number,
  bpeCodes?: string[]
): Promise<Poi[]> {
  // TODO: Implémenter
  console.warn("[bpeProvider] fetchBpeEquipments - stub");
  return [];
}

/**
 * Mapping codes BPE vers catégories POI
 */
export const BPE_TO_POI_CATEGORY: Record<string, PoiCategoryId> = {
  A104: "gendarmerie",
  A105: "police",
  A106: "fire_station",
  A203: "post_office",
  A206: "bank",
  A207: "atm",
  B101: "supermarket",
  B102: "grocery",
  B103: "bakery",
  B201: "gas_station",
  B203: "restaurant",
  C101: "school_primary",
  C201: "school_secondary",
  C301: "high_school",
  C501: "university",
  D101: "hospital",
  D102: "emergency",
  D201: "general_practitioner",
  D301: "pharmacy",
  D502: "daycare",
  D503: "ehpad",
  E102: "train_station",
  F303: "cinema",
  F305: "library",
  F310: "hotel",
};