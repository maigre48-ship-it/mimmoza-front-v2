// FILE: src/spaces/promoteur/etudes/marche/config/projectConfigs.ts

import {
  Home,
  Users,
  Heart,
  GraduationCap,
  Briefcase,
  ShoppingCart,
  Hotel,
} from "lucide-react";
import {
  ProjectType,
  ProjectTypeConfig,
  PoiProjectConfig,
  DemographicSegment,
} from "../types";

// ============================================
// SEGMENTS DÉMOGRAPHIQUES RÉUTILISABLES
// ============================================

const SEGMENTS_SENIORS: DemographicSegment[] = [
  {
    id: "60_74",
    label: "60-74 ans",
    ageRange: [60, 74],
    inseeField: "pct_60_74",
    color: "#f472b6",
    isPrimary: false,
  },
  {
    id: "75_84",
    label: "75-84 ans",
    ageRange: [75, 84],
    inseeField: "pct_75_84",
    color: "#ec4899",
    isPrimary: true,
  },
  {
    id: "85_plus",
    label: "85+ ans",
    ageRange: [85, 120],
    inseeField: "pct_85_plus",
    color: "#be185d",
    isPrimary: true,
  },
];

const SEGMENTS_ETUDIANTS: DemographicSegment[] = [
  {
    id: "15_19",
    label: "15-19 ans",
    ageRange: [15, 19],
    inseeField: "pct_15_19",
    color: "#a5b4fc",
    isPrimary: false,
  },
  {
    id: "20_24",
    label: "20-24 ans",
    ageRange: [20, 24],
    inseeField: "pct_20_24",
    color: "#818cf8",
    isPrimary: true,
  },
  {
    id: "25_29",
    label: "25-29 ans",
    ageRange: [25, 29],
    inseeField: "pct_25_29",
    color: "#6366f1",
    isPrimary: false,
  },
];

const SEGMENTS_ALL: DemographicSegment[] = [
  {
    id: "0_14",
    label: "0-14 ans",
    ageRange: [0, 14],
    inseeField: "pct_0_14",
    color: "#38bdf8",
    isPrimary: false,
  },
  {
    id: "15_29",
    label: "15-29 ans",
    ageRange: [15, 29],
    inseeField: "pct_15_29",
    color: "#818cf8",
    isPrimary: false,
  },
  {
    id: "30_44",
    label: "30-44 ans",
    ageRange: [30, 44],
    inseeField: "pct_30_44",
    color: "#a78bfa",
    isPrimary: true,
  },
  {
    id: "45_59",
    label: "45-59 ans",
    ageRange: [45, 59],
    inseeField: "pct_45_59",
    color: "#e879f9",
    isPrimary: false,
  },
  {
    id: "60_plus",
    label: "60+ ans",
    ageRange: [60, 120],
    inseeField: "pct_60_plus",
    color: "#fb7185",
    isPrimary: false,
  },
];

// ============================================
// CONFIGURATIONS PAR TYPE DE PROJET
// ============================================

export const PROJECT_CONFIGS: Record<ProjectType, ProjectTypeConfig> = {
  // ========== LOGEMENT ==========
  logement: {
    id: "logement",
    label: "Logement",
    icon: Home,
    color: "#3b82f6",
    description: "Projet immobilier résidentiel",

    demographicSegments: SEGMENTS_ALL,
    primaryDemographicField: "population",

    primaryKpis: [
      "prix_median_m2",
      "evolution_prix_1an",
      "taux_vacance",
      "transactions_24m",
    ],
    secondaryKpis: [
      "revenu_median",
      "ratio_accessibilite",
      "pct_proprietaires",
      "evolution_pop_5ans",
    ],

    criticalPoiCategories: ["bus_stop", "train_station", "school_primary", "supermarket", "pharmacy"],
    importantPoiCategories: ["school_secondary", "high_school", "daycare", "bank", "general_practitioner"],
    secondaryPoiCategories: ["hospital", "sports", "park", "cinema", "library"],

    radius: {
      critical: 1,
      important: 3,
      secondary: 10,
      analysis: 5,
    },

    scoreWeights: {
      demographics: 0.2,
      market: 0.35,
      competition: 0.1,
      services: 0.2,
      accessibility: 0.15,
    },

    requiredDataSources: ["insee", "dvf", "bpe"],
    insightsPriority: ["prix", "demographie", "transport", "services"],
    specificFields: ["prix_m2", "transactions", "menages"],
  },

  // ========== RÉSIDENCE SENIORS ==========
  residence_senior: {
    id: "residence_senior",
    label: "Résidence seniors",
    icon: Users,
    color: "#10b981",
    description: "Résidence services seniors (RSS)",

    demographicSegments: SEGMENTS_SENIORS,
    primaryDemographicField: "pct_75_plus",

    primaryKpis: [
      "ratio_rss_seniors",
      "pct_seniors_isoles",
      "evolution_75_plus_5ans",
      "revenu_median_seniors",
    ],
    secondaryKpis: [
      "densite_concurrence",
      "prix_moyen_rss",
      "taux_proprietaires_seniors",
      "score_sante",
    ],

    criticalPoiCategories: ["pharmacy", "general_practitioner", "supermarket", "bus_stop"],
    importantPoiCategories: ["hospital", "specialist", "bank", "post_office", "restaurant"],
    secondaryPoiCategories: ["rss", "ehpad", "park", "library", "cinema"],

    radius: {
      critical: 1,
      important: 5,
      secondary: 15,
      analysis: 10,
    },

    scoreWeights: {
      demographics: 0.3,
      market: 0.15,
      competition: 0.2,
      services: 0.15,
      accessibility: 0.1,
      healthcare: 0.1,
    },

    requiredDataSources: ["insee", "bpe", "finess"],
    insightsPriority: ["population_agee", "sante", "accessibilite", "concurrence"],
    specificFields: ["pct_75_plus", "seniors_isoles", "revenus_retraites"],
  },

  // ========== EHPAD ==========
  ehpad: {
    id: "ehpad",
    label: "EHPAD",
    icon: Heart,
    color: "#ec4899",
    description: "Établissement d'hébergement pour personnes âgées dépendantes",

    demographicSegments: SEGMENTS_SENIORS,
    primaryDemographicField: "pct_75_plus",

    primaryKpis: [
      "lits_1000_seniors",
      "taux_occupation_moyen",
      "deficit_places",
      "evolution_75_plus_5ans",
    ],
    secondaryKpis: [
      "pct_85_plus",
      "tarif_journalier_moyen",
      "pct_lits_habilites",
      "score_sante",
    ],

    criticalPoiCategories: ["hospital", "emergency", "pharmacy", "general_practitioner"],
    importantPoiCategories: ["specialist", "bus_stop", "supermarket"],
    secondaryPoiCategories: ["ehpad", "rss", "park", "library"],

    radius: {
      critical: 0.5,
      important: 10,
      secondary: 20,
      analysis: 20,
    },

    scoreWeights: {
      demographics: 0.25,
      market: 0.1,
      competition: 0.25,
      services: 0.1,
      accessibility: 0.1,
      healthcare: 0.2,
    },

    requiredDataSources: ["insee", "finess", "bpe"],
    insightsPriority: ["population_agee", "concurrence_ehpad", "sante", "reglementation"],
    specificFields: ["pct_75_plus", "pct_85_plus", "capacite_ehpad", "taux_occupation"],
  },

  // ========== RÉSIDENCE ÉTUDIANTE ==========
  residence_etudiante: {
    id: "residence_etudiante",
    label: "Résidence étudiante",
    icon: GraduationCap,
    color: "#8b5cf6",
    description: "Logement étudiant",

    demographicSegments: SEGMENTS_ETUDIANTS,
    primaryDemographicField: "pct_18_25",

    primaryKpis: [
      "nb_etudiants",
      "ratio_places_etudiants",
      "evolution_effectifs_5ans",
      "loyer_moyen_etudiant",
    ],
    secondaryKpis: [
      "distance_campus",
      "pct_boursiers",
      "densite_residences",
      "score_transport",
    ],

    criticalPoiCategories: ["university", "bus_stop", "train_station", "supermarket"],
    importantPoiCategories: ["library", "sports", "restaurant", "grocery"],
    secondaryPoiCategories: ["student_residence", "cinema", "park", "pharmacy"],

    radius: {
      critical: 1,
      important: 3,
      secondary: 10,
      analysis: 5,
    },

    scoreWeights: {
      demographics: 0.25,
      market: 0.2,
      competition: 0.2,
      services: 0.15,
      accessibility: 0.2,
    },

    requiredDataSources: ["insee", "mesr", "bpe", "dvf"],
    insightsPriority: ["etudiants", "universites", "transport", "concurrence"],
    specificFields: ["nb_etudiants", "capacite_crous", "universites_proches"],
  },

  // ========== BUREAUX ==========
  bureaux: {
    id: "bureaux",
    label: "Bureaux",
    icon: Briefcase,
    color: "#64748b",
    description: "Immobilier de bureaux",

    demographicSegments: [
      {
        id: "actifs",
        label: "Population active",
        inseeField: "pop_active",
        color: "#64748b",
        isPrimary: true,
      },
      {
        id: "cadres",
        label: "Cadres et prof. sup.",
        inseeField: "pct_cadres",
        color: "#475569",
        isPrimary: true,
      },
    ],
    primaryDemographicField: "pop_active",

    primaryKpis: [
      "taux_vacance_bureaux",
      "loyer_prime",
      "absorption_nette",
      "ratio_emploi_tertiaire",
    ],
    secondaryKpis: [
      "creations_entreprises",
      "score_transport",
      "nb_entreprises_zone",
      "evolution_emploi_5ans",
    ],

    criticalPoiCategories: ["train_station", "metro", "bus_stop", "parking", "restaurant"],
    importantPoiCategories: ["bank", "hotel", "coworking", "congress_center"],
    secondaryPoiCategories: ["sports", "pharmacy", "supermarket"],

    radius: {
      critical: 0.5,
      important: 2,
      secondary: 10,
      analysis: 5,
    },

    scoreWeights: {
      demographics: 0.15,
      market: 0.3,
      competition: 0.2,
      services: 0.15,
      accessibility: 0.2,
    },

    requiredDataSources: ["insee", "sirene", "bpe"],
    insightsPriority: ["economie", "transport", "services", "accessibilite"],
    specificFields: ["emploi_tertiaire", "entreprises", "transport"],
  },

  // ========== COMMERCE ==========
  commerce: {
    id: "commerce",
    label: "Commerce",
    icon: ShoppingCart,
    color: "#f59e0b",
    description: "Local commercial",

    demographicSegments: SEGMENTS_ALL,
    primaryDemographicField: "population",

    primaryKpis: [
      "taux_vacance_commerciale",
      "depense_commercialisable",
      "densite_commerciale",
      "revenu_median",
    ],
    secondaryKpis: [
      "flux_pietons",
      "evasion_commerciale",
      "pct_menages_motorises",
      "evolution_pop_5ans",
    ],

    criticalPoiCategories: ["bus_stop", "parking", "supermarket", "bank"],
    importantPoiCategories: ["train_station", "restaurant", "cinema"],
    secondaryPoiCategories: ["sports", "park", "hotel"],

    radius: {
      critical: 0.3,
      important: 1,
      secondary: 5,
      analysis: 3,
    },

    scoreWeights: {
      demographics: 0.25,
      market: 0.25,
      competition: 0.2,
      services: 0.15,
      accessibility: 0.15,
    },

    requiredDataSources: ["insee", "bpe", "dvf"],
    insightsPriority: ["population", "revenus", "flux", "concurrence"],
    specificFields: ["commerces_zone", "flux", "pouvoir_achat"],
  },

  // ========== HÔTEL ==========
  hotel: {
    id: "hotel",
    label: "Hôtel",
    icon: Hotel,
    color: "#6366f1",
    description: "Projet hôtelier",

    demographicSegments: [
      {
        id: "emploi_tertiaire",
        label: "Emploi tertiaire",
        inseeField: "emploi_tertiaire",
        color: "#6366f1",
        isPrimary: true,
      },
    ],
    primaryDemographicField: "nuitees_touristiques",

    primaryKpis: [
      "taux_occupation_hotels",
      "revpar",
      "adr",
      "chambres_1000_hab",
    ],
    secondaryKpis: [
      "part_affaires_loisirs",
      "indice_saisonnalite",
      "evolution_nuitees",
      "score_transport",
    ],

    criticalPoiCategories: ["train_station", "parking", "restaurant", "congress_center"],
    importantPoiCategories: ["metro", "bus_stop", "hotel", "sports"],
    secondaryPoiCategories: ["cinema", "park", "library", "supermarket"],

    radius: {
      critical: 0.5,
      important: 5,
      secondary: 20,
      analysis: 20,
    },

    scoreWeights: {
      demographics: 0.1,
      market: 0.3,
      competition: 0.25,
      services: 0.15,
      accessibility: 0.2,
    },

    requiredDataSources: ["insee", "adt", "bpe"],
    insightsPriority: ["tourisme", "accessibilite", "concurrence", "attractivite"],
    specificFields: ["nuitees", "hotels_concurrents", "evenements"],
  },
};

// ============================================
// HELPERS
// ============================================

export function getProjectConfig(projectType: ProjectType): ProjectTypeConfig {
  return PROJECT_CONFIGS[projectType];
}

export function getPoiConfigsForProject(projectType: ProjectType): PoiProjectConfig[] {
  const config = PROJECT_CONFIGS[projectType];
  const pois: PoiProjectConfig[] = [];

  config.criticalPoiCategories.forEach((cat) => {
    pois.push({
      category: cat as any,
      priority: "critical",
      maxRadius: config.radius.critical,
    });
  });

  config.importantPoiCategories.forEach((cat) => {
    pois.push({
      category: cat as any,
      priority: "important",
      maxRadius: config.radius.important,
    });
  });

  config.secondaryPoiCategories.forEach((cat) => {
    pois.push({
      category: cat as any,
      priority: "secondary",
      maxRadius: config.radius.secondary,
    });
  });

  return pois;
}