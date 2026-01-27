// FILE: src/spaces/promoteur/etudes/marche/services/poiService.ts

import { Poi, PoiCategoryId, PoiSearchResult, PoiProjectConfig } from "../types";
import { POI_CATEGORIES } from "../config/poiCategories";

export interface PoiFetchParams {
  lat: number;
  lon: number;
  radiusKm: number;
  categories: PoiCategoryId[];
}

/**
 * Service de récupération des POIs
 * Utilise les providers BPE/OSM pour les données réelles
 */
export async function fetchPois(params: PoiFetchParams): Promise<PoiSearchResult[]> {
  const { lat, lon, radiusKm, categories } = params;
  const results: PoiSearchResult[] = [];

  // Pour chaque catégorie demandée
  for (const categoryId of categories) {
    const category = POI_CATEGORIES[categoryId];
    if (!category) continue;

    // TODO: Appeler le vrai provider (BPE ou OSM)
    // Pour l'instant, on retourne des données mockées
    const mockPois = generateMockPoisForCategory(categoryId, lat, lon, radiusKm);

    results.push({
      category: categoryId,
      count: mockPois.length,
      items: mockPois,
      nearest: mockPois.length > 0 ? mockPois[0] : undefined,
      radiusKm,
    });
  }

  return results;
}

/**
 * Génère des POIs mockés pour une catégorie
 */
function generateMockPoisForCategory(
  categoryId: PoiCategoryId,
  centerLat: number,
  centerLon: number,
  radiusKm: number
): Poi[] {
  const category = POI_CATEGORIES[categoryId];
  if (!category) return [];

  // Nombre aléatoire de POIs selon la catégorie
  const countMap: Partial<Record<PoiCategoryId, number>> = {
    pharmacy: 8,
    supermarket: 5,
    bank: 12,
    general_practitioner: 25,
    bus_stop: 15,
    hospital: 2,
    ehpad: 4,
    university: 2,
  };

  const count = countMap[categoryId] ?? Math.floor(Math.random() * 5) + 1;
  const pois: Poi[] = [];

  for (let i = 0; i < count; i++) {
    // Position aléatoire dans le rayon
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * radiusKm;
    const lat = centerLat + (distance / 111) * Math.cos(angle);
    const lon = centerLon + (distance / (111 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(angle);

    pois.push({
      id: `${categoryId}-${i}`,
      category: categoryId,
      name: `${category.label} ${i + 1}`,
      lat,
      lon,
      distance: Math.round(distance * 100) / 100,
      commune: "Commune",
    });
  }

  // Trier par distance
  return pois.sort((a, b) => a.distance - b.distance);
}

/**
 * Récupère les POIs pour un projet selon sa configuration
 */
export async function fetchPoisForProject(
  lat: number,
  lon: number,
  poiConfigs: PoiProjectConfig[]
): Promise<Map<PoiCategoryId, PoiSearchResult>> {
  const results = new Map<PoiCategoryId, PoiSearchResult>();

  // Grouper par rayon pour optimiser les appels
  const byRadius = new Map<number, PoiCategoryId[]>();
  for (const config of poiConfigs) {
    const existing = byRadius.get(config.maxRadius) || [];
    existing.push(config.category);
    byRadius.set(config.maxRadius, existing);
  }

  // Fetch par rayon
  for (const [radiusKm, categories] of byRadius) {
    const searchResults = await fetchPois({ lat, lon, radiusKm, categories });
    for (const result of searchResults) {
      results.set(result.category, result);
    }
  }

  return results;
}

/**
 * Calcule les statistiques POI pour l'affichage
 */
export function computePoiStats(
  poisByCategory: Map<PoiCategoryId, PoiSearchResult>,
  poiConfigs: PoiProjectConfig[]
): {
  critical: { total: number; satisfied: number; items: Array<{ category: PoiCategoryId; count: number; nearest?: number }> };
  important: { total: number; satisfied: number; items: Array<{ category: PoiCategoryId; count: number; nearest?: number }> };
  secondary: { total: number; satisfied: number; items: Array<{ category: PoiCategoryId; count: number; nearest?: number }> };
} {
  const stats = {
    critical: { total: 0, satisfied: 0, items: [] as Array<{ category: PoiCategoryId; count: number; nearest?: number }> },
    important: { total: 0, satisfied: 0, items: [] as Array<{ category: PoiCategoryId; count: number; nearest?: number }> },
    secondary: { total: 0, satisfied: 0, items: [] as Array<{ category: PoiCategoryId; count: number; nearest?: number }> },
  };

  for (const config of poiConfigs) {
    const result = poisByCategory.get(config.category);
    const count = result?.count ?? 0;
    const nearest = result?.nearest?.distance;
    const item = { category: config.category, count, nearest };

    switch (config.priority) {
      case "critical":
        stats.critical.total++;
        if (count > 0) stats.critical.satisfied++;
        stats.critical.items.push(item);
        break;
      case "important":
        stats.important.total++;
        if (count > 0) stats.important.satisfied++;
        stats.important.items.push(item);
        break;
      case "secondary":
        stats.secondary.total++;
        if (count > 0) stats.secondary.satisfied++;
        stats.secondary.items.push(item);
        break;
    }
  }

  return stats;
}