// ============================================================================
// scoreProfiles.ts
// src/spaces/banque/scoring/scoreProfiles.ts
//
// Pondérations par profil pour le SmartScore Banque Universel.
// Chaque profil a ses propres poids et exigences minimales.
// Total des poids = 100 points.
// ============================================================================

import type { OperationProfile, MissingSeverity } from "../types/operationSummary.types";

// ── Pillar definition ──

export type PillarKey =
  | "documents"
  | "garanties"
  | "budget"
  | "revenus"
  | "marche"
  | "risques"
  | "faisabilite"
  | "planning"
  | "ratios";

export interface PillarConfig {
  key: PillarKey;
  label: string;
  weight: number;           // points max pour ce pilier
  description: string;
  requiredFields: string[]; // champs OperationSummary nécessaires
  missingSeverity: MissingSeverity; // sévérité si pilier entièrement absent
}

export interface ScoreProfile {
  profile: OperationProfile;
  label: string;
  pillars: PillarConfig[];
  totalPoints: number;      // somme des weights (toujours 100)
  // Seuils de grade
  gradeThresholds: {
    A: number; // >= A
    B: number;
    C: number;
    D: number;
    // E = tout le reste
  };
  // Pénalité par donnée manquante bloquante
  blockerPenalty: number;
  // Pénalité par donnée manquante warning
  warnPenalty: number;
}

// ════════════════════════════════════════════════════════════════════
// PROFIL: PROMOTEUR
// Budget/revenus/marché/faisabilité plus lourds
// ════════════════════════════════════════════════════════════════════

const PROMOTEUR_PROFILE: ScoreProfile = {
  profile: "promoteur",
  label: "Promoteur immobilier",
  totalPoints: 100,
  gradeThresholds: { A: 85, B: 70, C: 55, D: 40 },
  blockerPenalty: 8,
  warnPenalty: 3,
  pillars: [
    {
      key: "documents",
      label: "Documentation",
      weight: 10,
      description: "Complétude et validité des documents du dossier",
      requiredFields: ["documents.completude"],
      missingSeverity: "warn",
    },
    {
      key: "garanties",
      label: "Garanties",
      weight: 10,
      description: "Couverture des garanties vs montant financé",
      requiredFields: ["garanties.couvertureTotale"],
      missingSeverity: "warn",
    },
    {
      key: "budget",
      label: "Budget & Coûts",
      weight: 18,
      description: "Budget détaillé: foncier, construction, soft costs, aléas",
      requiredFields: [
        "budget.purchasePrice",
        "budget.worksBudget",
        "budget.totalCost",
      ],
      missingSeverity: "blocker",
    },
    {
      key: "revenus",
      label: "Revenus & Scénarios",
      weight: 15,
      description: "CA prévisionnel, scénarios base/stress/upside",
      requiredFields: ["revenues.exitValue", "revenues.strategy"],
      missingSeverity: "blocker",
    },
    {
      key: "marche",
      label: "Marché",
      weight: 15,
      description: "Données marché: prix/m², tension, absorption",
      requiredFields: ["market.pricePerSqm"],
      missingSeverity: "warn",
    },
    {
      key: "risques",
      label: "Risques",
      weight: 10,
      description: "Risques géo, environnementaux, réglementaires",
      requiredFields: ["risks.geo"],
      missingSeverity: "warn",
    },
    {
      key: "faisabilite",
      label: "Faisabilité / Urbanisme",
      weight: 8,
      description: "Conformité PLU, autorisations",
      requiredFields: ["risks.urbanism"],
      missingSeverity: "info",
    },
    {
      key: "planning",
      label: "Planning & Exécution",
      weight: 4,
      description: "Délais, phasage, risques d'exécution",
      requiredFields: ["risks.execution"],
      missingSeverity: "info",
    },
    {
      key: "ratios",
      label: "Ratios financiers",
      weight: 10,
      description: "LTV, LTC, marge, TRI, DSCR",
      requiredFields: ["kpis.ltv", "kpis.margin"],
      missingSeverity: "warn",
    },
  ],
};

// ════════════════════════════════════════════════════════════════════
// PROFIL: MARCHAND DE BIENS
// ════════════════════════════════════════════════════════════════════

const MARCHAND_PROFILE: ScoreProfile = {
  profile: "marchand",
  label: "Marchand de biens",
  totalPoints: 100,
  gradeThresholds: { A: 85, B: 70, C: 55, D: 40 },
  blockerPenalty: 8,
  warnPenalty: 3,
  pillars: [
    {
      key: "documents",
      label: "Documentation",
      weight: 10,
      description: "Complétude dossier",
      requiredFields: ["documents.completude"],
      missingSeverity: "warn",
    },
    {
      key: "garanties",
      label: "Garanties",
      weight: 12,
      description: "Couverture garanties",
      requiredFields: ["garanties.couvertureTotale"],
      missingSeverity: "warn",
    },
    {
      key: "budget",
      label: "Budget & Travaux",
      weight: 20,
      description: "Achat + travaux + notaire + portage",
      requiredFields: [
        "budget.purchasePrice",
        "budget.worksBudget",
        "budget.totalCost",
      ],
      missingSeverity: "blocker",
    },
    {
      key: "revenus",
      label: "Revenus & Sortie",
      weight: 18,
      description: "Valeur de revente, marge prévisionnelle",
      requiredFields: ["revenues.exitValue", "revenues.strategy"],
      missingSeverity: "blocker",
    },
    {
      key: "marche",
      label: "Marché",
      weight: 15,
      description: "Prix marché, tension, absorption",
      requiredFields: ["market.pricePerSqm"],
      missingSeverity: "warn",
    },
    {
      key: "risques",
      label: "Risques",
      weight: 10,
      description: "Risques géo et environnementaux",
      requiredFields: ["risks.geo"],
      missingSeverity: "warn",
    },
    {
      key: "faisabilite",
      label: "Urbanisme",
      weight: 5,
      description: "Conformité PLU",
      requiredFields: ["risks.urbanism"],
      missingSeverity: "info",
    },
    {
      key: "planning",
      label: "Délais",
      weight: 3,
      description: "Délai de retournement",
      requiredFields: [],
      missingSeverity: "info",
    },
    {
      key: "ratios",
      label: "Ratios",
      weight: 7,
      description: "LTV, LTC, marge, ROI",
      requiredFields: ["kpis.ltv", "kpis.margin"],
      missingSeverity: "warn",
    },
  ],
};

// ════════════════════════════════════════════════════════════════════
// PROFIL: PARTICULIER
// Plus de poids sur garanties/ratios, moins sur marché/faisabilité
// ════════════════════════════════════════════════════════════════════

const PARTICULIER_PROFILE: ScoreProfile = {
  profile: "particulier",
  label: "Particulier",
  totalPoints: 100,
  gradeThresholds: { A: 80, B: 65, C: 50, D: 35 },
  blockerPenalty: 6,
  warnPenalty: 2,
  pillars: [
    {
      key: "documents",
      label: "Documentation",
      weight: 15,
      description: "Justificatifs d'identité, revenus, patrimoine",
      requiredFields: ["documents.completude"],
      missingSeverity: "warn",
    },
    {
      key: "garanties",
      label: "Garanties",
      weight: 18,
      description: "Hypothèque, caution, assurance emprunteur",
      requiredFields: ["garanties.couvertureTotale"],
      missingSeverity: "blocker",
    },
    {
      key: "budget",
      label: "Budget",
      weight: 15,
      description: "Prix d'achat + frais notaire + travaux éventuels",
      requiredFields: ["budget.purchasePrice"],
      missingSeverity: "blocker",
    },
    {
      key: "revenus",
      label: "Revenus / Capacité",
      weight: 12,
      description: "Revenus du ménage, charges, reste à vivre",
      requiredFields: ["revenues.rentAnnual"],
      missingSeverity: "warn",
    },
    {
      key: "marche",
      label: "Marché",
      weight: 10,
      description: "Cohérence prix/marché",
      requiredFields: ["market.pricePerSqm"],
      missingSeverity: "info",
    },
    {
      key: "risques",
      label: "Risques",
      weight: 8,
      description: "Risques naturels et technologiques",
      requiredFields: ["risks.geo"],
      missingSeverity: "info",
    },
    {
      key: "faisabilite",
      label: "Bien / État",
      weight: 5,
      description: "État du bien, DPE, travaux nécessaires",
      requiredFields: [],
      missingSeverity: "info",
    },
    {
      key: "planning",
      label: "Calendrier",
      weight: 2,
      description: "Délais acquisition",
      requiredFields: [],
      missingSeverity: "info",
    },
    {
      key: "ratios",
      label: "Ratios",
      weight: 15,
      description: "LTV, taux d'effort, DSCR",
      requiredFields: ["kpis.ltv"],
      missingSeverity: "warn",
    },
  ],
};

// ════════════════════════════════════════════════════════════════════
// PROFIL: ENTREPRISE
// ════════════════════════════════════════════════════════════════════

const ENTREPRISE_PROFILE: ScoreProfile = {
  profile: "entreprise",
  label: "Entreprise",
  totalPoints: 100,
  gradeThresholds: { A: 82, B: 68, C: 52, D: 38 },
  blockerPenalty: 7,
  warnPenalty: 3,
  pillars: [
    {
      key: "documents",
      label: "Documentation",
      weight: 12,
      description: "Bilans, Kbis, business plan",
      requiredFields: ["documents.completude"],
      missingSeverity: "warn",
    },
    {
      key: "garanties",
      label: "Garanties",
      weight: 15,
      description: "Hypothèques, nantissements, caution dirigeant",
      requiredFields: ["garanties.couvertureTotale"],
      missingSeverity: "warn",
    },
    {
      key: "budget",
      label: "Budget & Investissement",
      weight: 15,
      description: "CAPEX total: acquisition + travaux + aménagement",
      requiredFields: ["budget.purchasePrice", "budget.totalCost"],
      missingSeverity: "blocker",
    },
    {
      key: "revenus",
      label: "Exploitation / CA",
      weight: 15,
      description: "Chiffre d'affaires, exploitation, rentabilité",
      requiredFields: ["revenues.revenueTotal"],
      missingSeverity: "blocker",
    },
    {
      key: "marche",
      label: "Marché",
      weight: 12,
      description: "Environnement commercial, concurrence",
      requiredFields: ["market.pricePerSqm"],
      missingSeverity: "warn",
    },
    {
      key: "risques",
      label: "Risques",
      weight: 8,
      description: "Risques géo, environnementaux, sectoriels",
      requiredFields: ["risks.geo"],
      missingSeverity: "warn",
    },
    {
      key: "faisabilite",
      label: "Faisabilité",
      weight: 5,
      description: "Autorisations, conformité",
      requiredFields: ["risks.urbanism"],
      missingSeverity: "info",
    },
    {
      key: "planning",
      label: "Planning",
      weight: 3,
      description: "Délais projet",
      requiredFields: [],
      missingSeverity: "info",
    },
    {
      key: "ratios",
      label: "Ratios financiers",
      weight: 15,
      description: "LTV, DSCR, ICR, rendement",
      requiredFields: ["kpis.ltv", "kpis.dscr"],
      missingSeverity: "warn",
    },
  ],
};

// ════════════════════════════════════════════════════════════════════
// Registry
// ════════════════════════════════════════════════════════════════════

const PROFILES: Record<OperationProfile, ScoreProfile> = {
  promoteur: PROMOTEUR_PROFILE,
  marchand: MARCHAND_PROFILE,
  particulier: PARTICULIER_PROFILE,
  entreprise: ENTREPRISE_PROFILE,
};

export function getScoreProfile(profile: OperationProfile): ScoreProfile {
  return PROFILES[profile] ?? PARTICULIER_PROFILE;
}

export function getAllScoreProfiles(): ScoreProfile[] {
  return Object.values(PROFILES);
}