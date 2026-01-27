// FILE: src/spaces/promoteur/etudes/marche/services/providers/mockProvider.ts

import {
  MarketStudyResult,
  ProjectType,
  DemographicsData,
  RealEstateMarketData,
  CompetitionData,
  ServicesData,
  HealthcareData,
  AccessibilityData,
  Insight,
  Scores,
  Kpi,
  Poi,
  DataSourceStatus,
} from "../../types";

interface MockProviderParams {
  projectType: ProjectType;
  lat: number;
  lon: number;
  communeInsee?: string;
  radiusKm: number;
}

// ============================================
// DONNÉES MOCK PAR TYPE DE PROJET
// ============================================

const MOCK_DEMOGRAPHICS_BASE: DemographicsData = {
  population: 52000,
  evolution5y: 2.3,
  density: 2150,
  ageStructure: {
    pct_0_14: 15.2,
    pct_15_29: 18.5,
    pct_30_44: 19.8,
    pct_45_59: 20.1,
    pct_60_74: 15.4,
    pct_75_84: 8.2,
    pct_85_plus: 2.8,
  },
  households: {
    total: 24500,
    avgSize: 2.1,
    pctSinglePerson: 38,
    pctSingleParent: 8.5,
  },
  economy: {
    medianIncome: 22400,
    povertyRate: 12.5,
    unemploymentRate: 8.2,
    pctHomeowners: 52,
    pctRenters: 48,
  },
  commune: "Bayonne",
  codeInsee: "64102",
  departement: "64 - Pyrénées-Atlantiques",
  region: "Nouvelle-Aquitaine",
};

const MOCK_REAL_ESTATE: RealEstateMarketData = {
  prices: {
    median: 3200,
    mean: 3450,
    q1: 2650,
    q3: 3850,
    min: 1800,
    max: 6200,
    evolution1y: 4.5,
    evolution3y: 12.0,
  },
  transactions: {
    count: 1250,
    totalVolume: 285000000,
    periodMonths: 24,
  },
  comparables: [
    {
      id: "1",
      address: "15 rue de la Citadelle",
      pricePerSqm: 3150,
      totalPrice: 252000,
      surface: 80,
      date: "2024-11-15",
      propertyType: "Appartement",
      distance: 450,
      commune: "Bayonne",
      rooms: 3,
    },
    {
      id: "2",
      address: "8 avenue du Maréchal Foch",
      pricePerSqm: 3400,
      totalPrice: 340000,
      surface: 100,
      date: "2024-10-22",
      propertyType: "Appartement",
      distance: 680,
      commune: "Bayonne",
      rooms: 4,
    },
    {
      id: "3",
      address: "22 rue d'Espagne",
      pricePerSqm: 2950,
      totalPrice: 177000,
      surface: 60,
      date: "2024-09-18",
      propertyType: "Appartement",
      distance: 920,
      commune: "Bayonne",
      rooms: 2,
    },
  ],
};

function getMockCompetitionForEhpad(): CompetitionData {
  return {
    totalCount: 8,
    totalCapacity: 620,
    avgOccupancyRate: 95.5,
    byOperatorType: {
      public: { count: 3, capacity: 280 },
      privateNonProfit: { count: 2, capacity: 140 },
      privateCommercial: { count: 3, capacity: 200 },
    },
    facilities: [
      {
        id: "1",
        name: "EHPAD Les Jardins d'Iroise",
        commune: "Bayonne",
        distance: 2.3,
        capacity: 82,
        occupancyRate: 97,
        dailyRate: 72,
        type: "Privé commercial",
        operator: "Korian",
      },
      {
        id: "2",
        name: "EHPAD Château de Breuilh",
        commune: "Anglet",
        distance: 4.1,
        capacity: 95,
        occupancyRate: 94,
        dailyRate: 68,
        type: "Privé non lucratif",
      },
      {
        id: "3",
        name: "EHPAD Municipal de Bayonne",
        commune: "Bayonne",
        distance: 1.8,
        capacity: 120,
        occupancyRate: 98,
        dailyRate: 58,
        type: "Public",
      },
      {
        id: "4",
        name: "Résidence du Parc",
        commune: "Biarritz",
        distance: 6.5,
        capacity: 78,
        occupancyRate: 92,
        dailyRate: 85,
        type: "Privé commercial",
        operator: "Orpea",
      },
    ],
    analysis: {
      densityPerTarget: 86.2,
      benchmark: 98.5,
      estimatedDeficit: 112,
      verdict:
        "Zone sous-équipée avec un déficit estimé de 112 places. Taux d'occupation élevé (95.5%) confirmant la tension du marché.",
    },
  };
}

function getMockCompetitionForRss(): CompetitionData {
  return {
    totalCount: 4,
    totalCapacity: 320,
    avgOccupancyRate: 88,
    facilities: [
      {
        id: "1",
        name: "Les Senioriales de Biarritz",
        commune: "Biarritz",
        distance: 5.2,
        capacity: 95,
        occupancyRate: 92,
        dailyRate: 1850,
        type: "Résidence services",
        operator: "Les Senioriales",
      },
      {
        id: "2",
        name: "Domitys L'Écrin de l'Adour",
        commune: "Bayonne",
        distance: 2.8,
        capacity: 120,
        occupancyRate: 85,
        dailyRate: 2200,
        type: "Résidence services",
        operator: "Domitys",
      },
    ],
    analysis: {
      densityPerTarget: 18.5,
      benchmark: 25,
      estimatedDeficit: 85,
      verdict:
        "Marché des RSS encore peu développé sur le territoire. Opportunité de positionnement.",
    },
  };
}

function getMockCompetitionForStudent(): CompetitionData {
  return {
    totalCount: 6,
    totalCapacity: 1200,
    avgOccupancyRate: 98,
    facilities: [
      {
        id: "1",
        name: "CROUS Bayonne",
        commune: "Bayonne",
        distance: 1.2,
        capacity: 350,
        occupancyRate: 100,
        type: "CROUS",
      },
      {
        id: "2",
        name: "Studéa Côte Basque",
        commune: "Bayonne",
        distance: 0.8,
        capacity: 180,
        occupancyRate: 97,
        dailyRate: 520,
        type: "Résidence privée",
        operator: "Studéa",
      },
    ],
    analysis: {
      densityPerTarget: 12,
      benchmark: 15,
      estimatedDeficit: 450,
      verdict:
        "Forte demande non satisfaite avec un déficit de 450 places. Marché très tendu.",
    },
  };
}

function getMockHealthcare(): HealthcareData {
  return {
    hospital: {
      name: "Centre Hospitalier de la Côte Basque",
      commune: "Bayonne",
      distance: 3.2,
      hasGeriatrics: true,
      hasEmergency: true,
      timeMinutes: 8,
    },
    practitioners: {
      generalPractitioners: { count: 42, per1000: 0.8 },
      specialists: {
        geriatre: { count: 3, nearestDistance: 4.5 },
        cardiologue: { count: 8, nearestDistance: 2.1 },
        ophtalmologue: { count: 5, nearestDistance: 3.8 },
        kinesitherapeute: { count: 15, nearestDistance: 0.6 },
      },
    },
    homeServices: {
      ssiadCount: 3,
      hadAvailable: true,
    },
    score: 78,
  };
}

function getMockServices(): ServicesData {
  return {
    bpeCounts: {
      total: 156,
      commerce: 45,
      health: 28,
      services: 32,
      education: 18,
      sportCulture: 33,
    },
    byCategory: {
      supermarket: {
        count: 8,
        nearest: { name: "Carrefour Market", distance: 0.8, commune: "Bayonne" },
      },
      pharmacy: {
        count: 12,
        nearest: { name: "Pharmacie du Centre", distance: 0.4, commune: "Bayonne" },
      },
      bank: {
        count: 15,
        nearest: { name: "Crédit Agricole", distance: 0.3, commune: "Bayonne" },
      },
      post_office: {
        count: 3,
        nearest: { name: "La Poste Bayonne Centre", distance: 0.6, commune: "Bayonne" },
      },
      general_practitioner: {
        count: 42,
        nearest: { name: "Dr Martin", distance: 0.5, commune: "Bayonne" },
      },
    },
  };
}

function getMockAccessibility(): AccessibilityData {
  return {
    score: 72,
    publicTransport: {
      nearestBusStop: 0.15,
      nearestTrainStation: 2.5,
      frequencyScore: 68,
    },
    road: {
      highwayAccess: 4.5,
      cityCenter: 1.2,
      airport: 8,
    },
    label: "Bonne desserte",
  };
}

function getMockPois(projectType: ProjectType): Poi[] {
  const basePois: Poi[] = [
    {
      id: "poi-1",
      category: "pharmacy",
      name: "Pharmacie du Centre",
      lat: 43.493,
      lon: -1.475,
      distance: 0.4,
      commune: "Bayonne",
    },
    {
      id: "poi-2",
      category: "supermarket",
      name: "Carrefour Market",
      lat: 43.495,
      lon: -1.478,
      distance: 0.8,
      commune: "Bayonne",
    },
    {
      id: "poi-3",
      category: "bus_stop",
      name: "Arrêt Mairie",
      lat: 43.4925,
      lon: -1.4745,
      distance: 0.15,
      commune: "Bayonne",
    },
    {
      id: "poi-4",
      category: "train_station",
      name: "Gare de Bayonne",
      lat: 43.489,
      lon: -1.468,
      distance: 2.5,
      commune: "Bayonne",
    },
    {
      id: "poi-5",
      category: "hospital",
      name: "CH Côte Basque",
      lat: 43.501,
      lon: -1.462,
      distance: 3.2,
      commune: "Bayonne",
    },
  ];

  if (projectType === "ehpad" || projectType === "residence_senior") {
    basePois.push(
      {
        id: "poi-ehpad-1",
        category: "ehpad",
        name: "EHPAD Les Jardins",
        lat: 43.498,
        lon: -1.471,
        distance: 2.3,
        commune: "Bayonne",
        metadata: { capacity: 82, occupancyRate: 97 },
      },
      {
        id: "poi-ehpad-2",
        category: "ehpad",
        name: "EHPAD Municipal",
        lat: 43.491,
        lon: -1.479,
        distance: 1.8,
        commune: "Bayonne",
        metadata: { capacity: 120, occupancyRate: 98 },
      }
    );
  }

  if (projectType === "residence_etudiante") {
    basePois.push(
      {
        id: "poi-univ-1",
        category: "university",
        name: "IUT de Bayonne",
        lat: 43.488,
        lon: -1.465,
        distance: 1.5,
        commune: "Bayonne",
        metadata: { capacity: 2500 },
      },
      {
        id: "poi-student-1",
        category: "student_residence",
        name: "CROUS Bayonne",
        lat: 43.487,
        lon: -1.467,
        distance: 1.2,
        commune: "Bayonne",
        metadata: { capacity: 350 },
      }
    );
  }

  return basePois;
}

function generateInsights(projectType: ProjectType, data: Partial<MarketStudyResult>): Insight[] {
  const insights: Insight[] = [];

  // Insights démographiques
  if (data.demographics?.evolution5y && data.demographics.evolution5y > 2) {
    insights.push({
      id: "demo-growth",
      type: "positive",
      category: "demographics",
      title: "Dynamisme démographique",
      description: `Population en croissance de ${data.demographics.evolution5y.toFixed(1)}% sur 5 ans`,
      value: `+${data.demographics.evolution5y.toFixed(1)}%`,
      source: "insee",
      priority: 1,
    });
  }

  // Insights marché
  if (data.realEstate?.prices?.evolution1y && data.realEstate.prices.evolution1y > 3) {
    insights.push({
      id: "price-growth",
      type: "positive",
      category: "market",
      title: "Marché immobilier dynamique",
      description: `Prix en hausse de ${data.realEstate.prices.evolution1y.toFixed(1)}% sur 1 an`,
      value: `+${data.realEstate.prices.evolution1y.toFixed(1)}%`,
      source: "dvf",
      priority: 2,
    });
  }

  // Insights spécifiques EHPAD
  if (projectType === "ehpad" && data.competition?.analysis) {
    if (data.competition.analysis.estimatedDeficit > 50) {
      insights.push({
        id: "ehpad-deficit",
        type: "opportunity",
        category: "competition",
        title: "Déficit de places significatif",
        description: `Environ ${data.competition.analysis.estimatedDeficit} places manquantes sur le territoire`,
        value: `${data.competition.analysis.estimatedDeficit} places`,
        source: "finess",
        priority: 1,
      });
    }

    if (data.competition.avgOccupancyRate && data.competition.avgOccupancyRate > 94) {
      insights.push({
        id: "ehpad-tension",
        type: "positive",
        category: "competition",
        title: "Marché très tendu",
        description: `Taux d'occupation moyen de ${data.competition.avgOccupancyRate}% confirmant une demande non satisfaite`,
        value: `${data.competition.avgOccupancyRate}%`,
        source: "finess",
        priority: 2,
      });
    }
  }

  // Insights accessibilité
  if (data.healthcare?.hospital && data.healthcare.hospital.distance < 5) {
    insights.push({
      id: "hospital-proximity",
      type: "positive",
      category: "healthcare",
      title: "Proximité hospitalière",
      description: `${data.healthcare.hospital.name} à ${data.healthcare.hospital.distance.toFixed(1)} km avec urgences et gériatrie`,
      value: `${data.healthcare.hospital.distance.toFixed(1)} km`,
      source: "finess",
      priority: 3,
    });
  }

  // Insights warning
  if (data.demographics?.economy?.povertyRate && data.demographics.economy.povertyRate > 15) {
    insights.push({
      id: "poverty-warning",
      type: "warning",
      category: "economics",
      title: "Taux de pauvreté élevé",
      description: `${data.demographics.economy.povertyRate.toFixed(1)}% de la population sous le seuil de pauvreté`,
      value: `${data.demographics.economy.povertyRate.toFixed(1)}%`,
      source: "insee",
      priority: 4,
    });
  }

  return insights.sort((a, b) => a.priority - b.priority);
}

function calculateScores(projectType: ProjectType, data: Partial<MarketStudyResult>): Scores {
  // Simulation simplifiée du calcul de scores
  const demographics = data.demographics?.evolution5y && data.demographics.evolution5y > 0 ? 75 : 55;
  const market = data.realEstate?.prices?.evolution1y && data.realEstate.prices.evolution1y > 2 ? 70 : 50;
  const competition = data.competition?.analysis?.estimatedDeficit && data.competition.analysis.estimatedDeficit > 50 ? 80 : 45;
  const services = data.services?.bpeCounts?.total && data.services.bpeCounts.total > 100 ? 72 : 55;
  const accessibility = data.accessibility?.score ?? 60;
  const healthcare = data.healthcare?.score ?? 65;

  const global = Math.round(
    demographics * 0.2 +
      market * 0.15 +
      competition * 0.25 +
      services * 0.15 +
      accessibility * 0.15 +
      healthcare * 0.1
  );

  let verdict: Scores["verdict"];
  if (global >= 70) verdict = "GO";
  else if (global >= 55) verdict = "GO_WITH_RESERVES";
  else if (global >= 40) verdict = "TO_DEEPEN";
  else verdict = "NO_GO";

  return {
    global,
    verdict,
    components: {
      demographics,
      market,
      competition,
      services,
      accessibility,
      healthcare,
    },
  };
}

function getDataSources(projectType: ProjectType): DataSourceStatus[] {
  const sources: DataSourceStatus[] = [
    { source: "insee", available: true, year: 2021, coverage: "complete" },
    { source: "bpe", available: true, year: 2023, coverage: "complete" },
  ];

  if (projectType === "ehpad" || projectType === "residence_senior") {
    sources.push({ source: "finess", available: true, lastUpdate: "2025-01-15", coverage: "complete" });
  }

  if (["logement", "commerce", "bureaux"].includes(projectType)) {
    sources.push({ source: "dvf", available: true, year: 2024, coverage: "complete" });
  }

  if (projectType === "residence_etudiante") {
    sources.push({ source: "mesr", available: true, year: 2024, coverage: "partial" });
  }

  if (projectType === "hotel") {
    sources.push({ source: "adt", available: false, coverage: "unavailable" });
  }

  return sources;
}

// ============================================
// FONCTION PRINCIPALE
// ============================================

export async function fetchMockMarketStudy(params: MockProviderParams): Promise<MarketStudyResult> {
  // Simulation d'un délai réseau
  await new Promise((resolve) => setTimeout(resolve, 800));

  const { projectType, lat, lon, communeInsee, radiusKm } = params;

  // Données de base
  const demographics: DemographicsData = {
    ...MOCK_DEMOGRAPHICS_BASE,
    codeInsee: communeInsee || "64102",
  };

  // Ajout de la population cible selon le projet
  if (projectType === "ehpad" || projectType === "residence_senior") {
    demographics.targetPopulation = {
      count: Math.round(demographics.population * 0.11), // ~11% de 75+
      percentage: 11,
      evolution5y: 8.5,
      label: "75+ ans",
    };
    demographics.economy.targetSegmentIncome = 1850;
  } else if (projectType === "residence_etudiante") {
    demographics.targetPopulation = {
      count: 4500,
      percentage: 8.7,
      evolution5y: 3.2,
      label: "Étudiants",
    };
  }

  // Concurrence selon le projet
  let competition: CompetitionData;
  switch (projectType) {
    case "ehpad":
      competition = getMockCompetitionForEhpad();
      break;
    case "residence_senior":
      competition = getMockCompetitionForRss();
      break;
    case "residence_etudiante":
      competition = getMockCompetitionForStudent();
      break;
    default:
      competition = {
        totalCount: 0,
        totalCapacity: 0,
        facilities: [],
      };
  }

  const services = getMockServices();
  const healthcare = getMockHealthcare();
  const accessibility = getMockAccessibility();
  const pois = getMockPois(projectType);

  // Construction du résultat partiel pour calculs
  const partialResult: Partial<MarketStudyResult> = {
    projectType,
    demographics,
    realEstate: ["logement", "commerce", "bureaux"].includes(projectType) ? MOCK_REAL_ESTATE : undefined,
    competition,
    services,
    healthcare: ["ehpad", "residence_senior"].includes(projectType) ? healthcare : undefined,
    accessibility,
  };

  const insights = generateInsights(projectType, partialResult);
  const scores = calculateScores(projectType, partialResult);

  // KPIs (simplifiés - sera calculé par le composant avec les définitions)
  const primaryKpis: Kpi[] = [];
  const secondaryKpis: Kpi[] = [];

  return {
    projectType,
    analysisDate: new Date().toISOString(),
    location: {
      lat,
      lon,
      communeInsee: communeInsee || "64102",
      communeName: "Bayonne",
      departement: "64 - Pyrénées-Atlantiques",
      region: "Nouvelle-Aquitaine",
      radiusKm,
      zoneType: demographics.density > 1000 ? "urban" : "rural",
    },
    demographics,
    realEstate: partialResult.realEstate,
    competition,
    services,
    healthcare: partialResult.healthcare,
    accessibility,
    pois,
    kpis: { primary: primaryKpis, secondary: secondaryKpis },
    insights,
    scores,
    dataSources: getDataSources(projectType),
    regulatory:
      projectType === "ehpad"
        ? {
            arsRegion: "Nouvelle-Aquitaine",
            departmentalScheme: {
              targetRate: 105,
              currentRate: 86.2,
              priorityZones: ["Bayonne", "Biarritz", "Anglet"],
            },
            activeCallsForProjects: [
              {
                id: "AAP-2025-064",
                title: "Création EHPAD 80 places secteur BAB",
                deadline: "2025-06-30",
                zone: "Agglomération Bayonne-Anglet-Biarritz",
              },
            ],
          }
        : undefined,
  };
}