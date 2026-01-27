// FILE: src/spaces/promoteur/etudes/marche/config/kpiDefinitions.ts

import { KpiDefinition } from "../types";

export const KPI_DEFINITIONS: Record<string, KpiDefinition> = {
  // ========== PRIX / MARCHÉ ==========
  prix_median_m2: {
    id: "prix_median_m2",
    label: "Prix médian/m²",
    unit: "€",
    calculate: (data) => data.realEstate?.prices?.median ?? null,
    format: "currency",
    decimals: 0,
    icon: "Euro",
    applicableTo: ["logement", "commerce", "bureaux"],
  },

  evolution_prix_1an: {
    id: "evolution_prix_1an",
    label: "Évolution prix 1 an",
    unit: "%",
    calculate: (data) => data.realEstate?.prices?.evolution1y ?? null,
    thresholds: { positive: 5, warning: 0, negative: -5 },
    format: "percent",
    decimals: 1,
    icon: "TrendingUp",
    applicableTo: ["logement", "commerce", "bureaux"],
  },

  taux_vacance: {
    id: "taux_vacance",
    label: "Taux de vacance",
    unit: "%",
    calculate: (data) => data.demographics?.economy?.vacancyRate ?? null,
    thresholds: { positive: 6, warning: 8, negative: 12 },
    invertStatus: true,
    format: "percent",
    decimals: 1,
    icon: "Home",
    applicableTo: ["logement"],
  },

  transactions_24m: {
    id: "transactions_24m",
    label: "Transactions 24 mois",
    calculate: (data) => data.realEstate?.transactions?.count ?? null,
    format: "number",
    icon: "TrendingUp",
    applicableTo: ["logement"],
  },

  // ========== DÉMOGRAPHIE ==========
  evolution_pop_5ans: {
    id: "evolution_pop_5ans",
    label: "Évolution pop. 5 ans",
    unit: "%",
    calculate: (data) => data.demographics?.evolution5y ?? null,
    thresholds: { positive: 2, warning: 0, negative: -2 },
    format: "percent",
    decimals: 1,
    icon: "Users",
  },

  revenu_median: {
    id: "revenu_median",
    label: "Revenu médian",
    unit: "€/an",
    calculate: (data) => data.demographics?.economy?.medianIncome ?? null,
    format: "currency",
    decimals: 0,
    icon: "Euro",
  },

  pct_proprietaires: {
    id: "pct_proprietaires",
    label: "Propriétaires",
    unit: "%",
    calculate: (data) => data.demographics?.economy?.pctHomeowners ?? null,
    format: "percent",
    decimals: 1,
    icon: "Home",
    applicableTo: ["logement"],
  },

  // ========== SENIORS (RSS / EHPAD) ==========
  ratio_rss_seniors: {
    id: "ratio_rss_seniors",
    label: "Logements RSS / 1000 seniors",
    calculate: (data) => {
      const competition = data.competition;
      const seniors = data.demographics?.targetPopulation?.count;
      if (!competition || !seniors) return null;
      return (competition.totalCapacity / seniors) * 1000;
    },
    thresholds: { positive: 20, warning: 10, negative: 5 },
    invertStatus: true,
    format: "number",
    decimals: 1,
    icon: "Users",
    applicableTo: ["residence_senior"],
  },

  pct_seniors_isoles: {
    id: "pct_seniors_isoles",
    label: "Seniors isolés (75+)",
    unit: "%",
    calculate: (data) => data.demographics?.targetPopulation?.isolatedPct ?? null,
    thresholds: { positive: 35, warning: 25, negative: 15 },
    format: "percent",
    decimals: 1,
    icon: "UserX",
    applicableTo: ["residence_senior", "ehpad"],
  },

  evolution_75_plus_5ans: {
    id: "evolution_75_plus_5ans",
    label: "Évolution 75+ 5 ans",
    unit: "%",
    calculate: (data) => data.demographics?.targetPopulation?.evolution5y ?? null,
    thresholds: { positive: 10, warning: 5, negative: 0 },
    format: "percent",
    decimals: 1,
    icon: "TrendingUp",
    applicableTo: ["residence_senior", "ehpad"],
  },

  revenu_median_seniors: {
    id: "revenu_median_seniors",
    label: "Revenu médian seniors",
    unit: "€/mois",
    calculate: (data) => data.demographics?.economy?.targetSegmentIncome ?? null,
    thresholds: { positive: 1800, warning: 1500, negative: 1200 },
    format: "currency",
    decimals: 0,
    icon: "Banknote",
    applicableTo: ["residence_senior", "ehpad"],
  },

  // ========== EHPAD SPÉCIFIQUE ==========
  lits_1000_seniors: {
    id: "lits_1000_seniors",
    label: "Lits / 1000 seniors 75+",
    calculate: (data) => data.competition?.analysis?.densityPerTarget ?? null,
    getBenchmark: () => 98.5, // Moyenne nationale
    thresholds: { positive: 98, warning: 80, negative: 60 },
    invertStatus: true,
    format: "number",
    decimals: 1,
    icon: "BedDouble",
    applicableTo: ["ehpad"],
  },

  taux_occupation_moyen: {
    id: "taux_occupation_moyen",
    label: "Taux occupation moyen",
    unit: "%",
    calculate: (data) => data.competition?.avgOccupancyRate ?? null,
    thresholds: { positive: 95, warning: 90, negative: 85 },
    format: "percent",
    decimals: 1,
    icon: "Percent",
    applicableTo: ["ehpad"],
  },

  deficit_places: {
    id: "deficit_places",
    label: "Déficit de places",
    calculate: (data) => data.competition?.analysis?.estimatedDeficit ?? null,
    thresholds: { positive: 50, warning: 20, negative: 0 },
    format: "number",
    decimals: 0,
    icon: "AlertTriangle",
    applicableTo: ["ehpad"],
  },

  tarif_journalier_moyen: {
    id: "tarif_journalier_moyen",
    label: "Tarif journalier moyen",
    unit: "€/jour",
    calculate: (data) => {
      const facilities = data.competition?.facilities;
      if (!facilities?.length) return null;
      const rates = facilities.map((f: any) => f.dailyRate).filter(Boolean);
      return rates.length ? rates.reduce((a: number, b: number) => a + b, 0) / rates.length : null;
    },
    format: "currency",
    decimals: 0,
    icon: "Euro",
    applicableTo: ["ehpad"],
  },

  // ========== ÉTUDIANTS ==========
  nb_etudiants: {
    id: "nb_etudiants",
    label: "Étudiants dans la zone",
    calculate: (data) => data.demographics?.targetPopulation?.count ?? null,
    format: "number",
    decimals: 0,
    icon: "GraduationCap",
    applicableTo: ["residence_etudiante"],
  },

  ratio_places_etudiants: {
    id: "ratio_places_etudiants",
    label: "Places / Étudiants",
    unit: "%",
    calculate: (data) => {
      const students = data.demographics?.targetPopulation?.count;
      const capacity = data.competition?.totalCapacity;
      if (!students || !capacity) return null;
      return (capacity / students) * 100;
    },
    thresholds: { positive: 15, warning: 10, negative: 5 },
    invertStatus: true,
    format: "percent",
    decimals: 1,
    icon: "Home",
    applicableTo: ["residence_etudiante"],
  },

  loyer_moyen_etudiant: {
    id: "loyer_moyen_etudiant",
    label: "Loyer moyen étudiant",
    unit: "€/mois",
    calculate: (data) => data.realEstate?.studentRent ?? null,
    format: "currency",
    decimals: 0,
    icon: "Euro",
    applicableTo: ["residence_etudiante"],
  },

  // ========== BUREAUX ==========
  taux_vacance_bureaux: {
    id: "taux_vacance_bureaux",
    label: "Taux vacance bureaux",
    unit: "%",
    calculate: (data) => data.competition?.avgOccupancyRate ? 100 - data.competition.avgOccupancyRate : null,
    thresholds: { positive: 5, warning: 8, negative: 12 },
    invertStatus: true,
    format: "percent",
    decimals: 1,
    icon: "Building",
    applicableTo: ["bureaux"],
  },

  loyer_prime: {
    id: "loyer_prime",
    label: "Loyer prime",
    unit: "€/m²/an",
    calculate: (data) => data.realEstate?.prices?.median ?? null,
    format: "currency",
    decimals: 0,
    icon: "Euro",
    applicableTo: ["bureaux"],
  },

  // ========== HÔTEL ==========
  taux_occupation_hotels: {
    id: "taux_occupation_hotels",
    label: "Taux occupation",
    unit: "%",
    calculate: (data) => data.competition?.avgOccupancyRate ?? null,
    thresholds: { positive: 65, warning: 55, negative: 45 },
    format: "percent",
    decimals: 1,
    icon: "Percent",
    applicableTo: ["hotel"],
  },

  revpar: {
    id: "revpar",
    label: "RevPAR",
    unit: "€",
    calculate: (data) => data.competition?.analysis?.revpar ?? null,
    format: "currency",
    decimals: 0,
    icon: "Euro",
    applicableTo: ["hotel"],
  },

  adr: {
    id: "adr",
    label: "ADR (prix moyen)",
    unit: "€",
    calculate: (data) => data.competition?.analysis?.adr ?? null,
    format: "currency",
    decimals: 0,
    icon: "Euro",
    applicableTo: ["hotel"],
  },

  // ========== SCORES TRANSVERSES ==========
  score_sante: {
    id: "score_sante",
    label: "Score santé",
    calculate: (data) => data.healthcare?.score ?? null,
    thresholds: { positive: 70, warning: 50, negative: 30 },
    format: "number",
    decimals: 0,
    icon: "Heart",
    applicableTo: ["residence_senior", "ehpad"],
  },

  score_transport: {
    id: "score_transport",
    label: "Score transport",
    calculate: (data) => data.accessibility?.score ?? null,
    thresholds: { positive: 70, warning: 50, negative: 30 },
    format: "number",
    decimals: 0,
    icon: "Train",
  },
};

export function getKpiDefinition(kpiId: string): KpiDefinition | undefined {
  return KPI_DEFINITIONS[kpiId];
}

export function getKpisForProject(projectType: string, isPrimary: boolean): KpiDefinition[] {
  return Object.values(KPI_DEFINITIONS).filter((kpi) => {
    if (kpi.applicableTo && !kpi.applicableTo.includes(projectType)) {
      return false;
    }
    return true;
  });
}