// FILE: src/spaces/promoteur/etudes/marche/services/marketStudyService.ts

import { MarketStudyResult, ProjectType, CompetitionData } from "../types";
import { fetchMockMarketStudy } from "./providers/mockProvider";
import { fetchInseeData } from "./providers/inseeProvider";
import { fetchFinessData, DEFAULT_EHPAD_CATEGORIES } from "./providers/finessProvider";
import { fetchDvfData } from "./providers/dvfProvider";
import { fetchBpeData } from "./providers/bpeProvider";
import { getProjectConfig, getPoiConfigsForProject } from "../config";
import { fetchPoisForProject, computePoiStats } from "./poiService";

export interface MarketStudyParams {
  projectType: ProjectType;
  lat: number;
  lon: number;
  communeInsee?: string;
  radiusKm?: number;
  useMock?: boolean;
}

/**
 * Service principal d'étude de marché
 * Orchestre les différents providers selon le type de projet
 */
export async function getMarketStudy(params: MarketStudyParams): Promise<MarketStudyResult> {
  const {
    projectType,
    lat,
    lon,
    communeInsee,
    radiusKm,
    useMock = false, // CHANGÉ: Par défaut on utilise les vraies données
  } = params;

  const config = getProjectConfig(projectType);
  const effectiveRadius = radiusKm ?? config.radius.analysis;

  // Mode mock : retourne directement les données simulées
  if (useMock) {
    console.log("[marketStudyService] Mode mock activé");
    return fetchMockMarketStudy({
      projectType,
      lat,
      lon,
      communeInsee,
      radiusKm: effectiveRadius,
    });
  }

  console.log(`[marketStudyService] Lancement étude de marché pour ${projectType}`);
  console.log(`[marketStudyService] Position: ${lat}, ${lon} - Rayon: ${effectiveRadius}km`);

  // Mode réel : agrège les différentes sources en parallèle
  const [inseeData, finessData, dvfData, bpeData] = await Promise.all([
    // Données INSEE (démographie)
    communeInsee 
      ? fetchInseeData({ codeInsee: communeInsee }).catch((err) => {
          console.warn("[marketStudyService] Erreur INSEE:", err);
          return null;
        })
      : null,

    // Données FINESS (concurrence EHPAD)
    config.requiredDataSources.includes("finess")
      ? fetchFinessData({ 
          lat, 
          lon, 
          radiusKm: effectiveRadius,
          categories: DEFAULT_EHPAD_CATEGORIES,
        }).catch((err) => {
          console.warn("[marketStudyService] Erreur FINESS:", err);
          return null;
        })
      : null,

    // Données DVF (prix immobilier)
    config.requiredDataSources.includes("dvf")
      ? fetchDvfData({ lat, lon, radiusKm: effectiveRadius }).catch((err) => {
          console.warn("[marketStudyService] Erreur DVF:", err);
          return null;
        })
      : null,

    // Données BPE (équipements)
    fetchBpeData({ lat, lon, radiusKm: effectiveRadius }).catch((err) => {
      console.warn("[marketStudyService] Erreur BPE:", err);
      return null;
    }),
  ]);

  // Log des résultats
  console.log("[marketStudyService] Résultats:");
  console.log("  - INSEE:", inseeData ? "OK" : "N/A");
  console.log("  - FINESS:", finessData ? `${finessData.count} établissements` : "N/A");
  console.log("  - DVF:", dvfData ? "OK" : "N/A");
  console.log("  - BPE:", bpeData ? "OK" : "N/A");

  // Récupération des POIs
  const poiConfigs = getPoiConfigsForProject(projectType);
  const poisByCategory = await fetchPoisForProject(lat, lon, poiConfigs);
  const poiStats = computePoiStats(poisByCategory, poiConfigs);

  // Assembler le résultat final
  const result = assembleMarketStudyResult({
    projectType,
    lat,
    lon,
    communeInsee,
    radiusKm: effectiveRadius,
    inseeData,
    finessData,
    dvfData,
    bpeData,
    poiStats,
  });

  return result;
}

/**
 * Assemble les données des différents providers en un résultat unifié
 */
interface AssembleParams {
  projectType: ProjectType;
  lat: number;
  lon: number;
  communeInsee?: string;
  radiusKm: number;
  inseeData: any;
  finessData: CompetitionData | null;
  dvfData: any;
  bpeData: any;
  poiStats: any;
}

function assembleMarketStudyResult(params: AssembleParams): MarketStudyResult {
  const {
    projectType,
    lat,
    lon,
    communeInsee,
    radiusKm,
    inseeData,
    finessData,
    dvfData,
    bpeData,
    poiStats,
  } = params;

  // Construire le résultat avec les données disponibles
  const result: MarketStudyResult = {
    // Métadonnées
    projectType,
    location: { lat, lon },
    communeInsee: communeInsee || null,
    radiusKm,
    generatedAt: new Date().toISOString(),

    // Sources de données avec leur statut
    dataSources: {
      insee: {
        status: inseeData ? "success" : "unavailable",
        data: inseeData,
      },
      finess: {
        status: finessData ? "success" : "unavailable",
        data: finessData,
      },
      dvf: {
        status: dvfData ? "success" : "unavailable",
        data: dvfData,
      },
      bpe: {
        status: bpeData ? "success" : "unavailable",
        data: bpeData,
      },
    },

    // Données de concurrence (FINESS)
    competition: finessData || {
      count: 0,
      totalCapacity: 0,
      avgCapacity: 0,
      nearestDistance: null,
      competitors: [],
    },

    // Données démographiques (INSEE)
    demographics: inseeData
      ? {
          population: inseeData.population,
          pop75Plus: inseeData.pop75Plus,
          popGrowth: inseeData.popGrowth,
          density: inseeData.density,
        }
      : null,

    // Données immobilières (DVF)
    realEstate: dvfData
      ? {
          medianPrice: dvfData.medianPrice,
          avgPrice: dvfData.avgPrice,
          transactionCount: dvfData.transactionCount,
        }
      : null,

    // POIs et équipements
    pois: poiStats,
  };

  return result;
}

/**
 * Calcule les KPIs à partir du résultat d'étude
 */
export function computeKpis(
  result: MarketStudyResult,
  projectType: ProjectType
): {
  primary: Array<{ id: string; label: string; value: string; status: string }>;
  secondary: Array<{ id: string; label: string; value: string; status: string }>;
} {
  const config = getProjectConfig(projectType);
  const kpis: {
    primary: Array<{ id: string; label: string; value: string; status: string }>;
    secondary: Array<{ id: string; label: string; value: string; status: string }>;
  } = {
    primary: [],
    secondary: [],
  };

  // KPIs liés à la concurrence FINESS
  if (result.competition) {
    kpis.primary.push({
      id: "competition_count",
      label: "EHPAD dans la zone",
      value: result.competition.count.toString(),
      status: result.competition.count > 5 ? "warning" : "good",
    });

    kpis.primary.push({
      id: "competition_capacity",
      label: "Capacité totale",
      value: `${result.competition.totalCapacity} lits`,
      status: "neutral",
    });

    if (result.competition.nearestDistance !== null) {
      kpis.secondary.push({
        id: "nearest_competitor",
        label: "EHPAD le plus proche",
        value: `${result.competition.nearestDistance.toFixed(1)} km`,
        status: result.competition.nearestDistance < 2 ? "warning" : "good",
      });
    }
  }

  // KPIs démographiques
  if (result.demographics) {
    if (result.demographics.pop75Plus) {
      kpis.primary.push({
        id: "pop_75_plus",
        label: "Population 75+",
        value: result.demographics.pop75Plus.toLocaleString("fr-FR"),
        status: "neutral",
      });
    }
  }

  // KPIs immobiliers
  if (result.realEstate?.medianPrice) {
    kpis.secondary.push({
      id: "median_price",
      label: "Prix médian",
      value: `${result.realEstate.medianPrice.toLocaleString("fr-FR")} €/m²`,
      status: "neutral",
    });
  }

  return kpis;
}