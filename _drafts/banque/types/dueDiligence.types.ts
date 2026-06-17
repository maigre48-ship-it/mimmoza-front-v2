// src/spaces/banque/types/dueDiligence.types.ts

/* ---------- Enums / Unions ---------- */

export type DueDiligenceStatus = "OK" | "WARNING" | "CRITICAL" | "MISSING" | "NA";

export type DueDiligenceCategoryKey =
  | "juridique"
  | "technique"
  | "marche"
  | "financier"
  | "externes";

/* ---------- Core types ---------- */

export interface DueDiligenceEvidence {
  id: string;
  type: string;
  title: string;
  url?: string;
  filePath?: string;
  addedAt: string;
}

export interface DueDiligenceItemScore {
  score?: number;
  penalty?: number;
  weight?: number;
}

export interface DueDiligenceItem {
  key: string;
  label: string;
  description?: string;
  status: DueDiligenceStatus;
  comment?: string;
  value?: unknown;
  tags?: string[];
  evidences?: DueDiligenceEvidence[];
  updatedAt: string;
  updatedBy?: string;
  score?: DueDiligenceItemScore;
  meta?: Record<string, unknown>;
}

export interface DueDiligenceCategory {
  key: DueDiligenceCategoryKey;
  label: string;
  description?: string;
  weight?: number;
  items: DueDiligenceItem[];
}

export interface DueDiligenceComputed {
  completedItems: number;
  totalItems: number;
  completionRate: number;
  score?: number;
  byStatus: Record<DueDiligenceStatus, number>;
  criticalCount: number;
  warningCount: number;
}

export interface DueDiligenceReport {
  version: "v1";
  dossierId: string;
  categories: DueDiligenceCategory[];
  overallComment?: string;
  createdAt: string;
  updatedAt: string;
  computed?: DueDiligenceComputed;
}

/* ---------- Factory ---------- */

function makeItem(key: string, label: string, nowIso: string, description?: string): DueDiligenceItem {
  return {
    key,
    label,
    description,
    status: "MISSING",
    evidences: [],
    updatedAt: nowIso,
  };
}

export function createDefaultDueDiligenceReport(params: {
  dossierId: string;
  nowIso?: string;
}): DueDiligenceReport {
  const now = params.nowIso ?? new Date().toISOString();

  const categories: DueDiligenceCategory[] = [
    {
      key: "juridique",
      label: "Juridique",
      description: "Vérifications juridiques du bien",
      weight: 0.2,
      items: [
        makeItem("titre_propriete", "Titre de propriété", now, "Vérification du titre de propriété et de la chaîne de titres"),
        makeItem("servitudes", "Servitudes", now, "Analyse des servitudes existantes"),
        makeItem("urbanisme_conformite", "Conformité urbanisme", now, "Vérification de la conformité aux règles d'urbanisme"),
        makeItem("copro_proces_verbaux", "PV d'assemblée générale copropriété", now, "Analyse des procès-verbaux d'AG de copropriété"),
        makeItem("litiges", "Litiges en cours", now, "Vérification de l'absence de litiges"),
      ],
    },
    {
      key: "technique",
      label: "Technique",
      description: "Diagnostics et état technique du bien",
      weight: 0.2,
      items: [
        makeItem("dpe", "DPE", now, "Diagnostic de performance énergétique"),
        makeItem("diagnostics", "Diagnostics obligatoires", now, "Ensemble des diagnostics réglementaires"),
        makeItem("etat_structurel", "État structurel", now, "Évaluation de l'état structurel du bâtiment"),
        makeItem("travaux_a_prevoir", "Travaux à prévoir", now, "Estimation des travaux nécessaires"),
      ],
    },
    {
      key: "marche",
      label: "Marché",
      description: "Analyse du marché immobilier local",
      weight: 0.2,
      items: [
        makeItem("tension_locative", "Tension locative", now, "Niveau de tension locative de la zone"),
        makeItem("vacance", "Taux de vacance", now, "Taux de vacance locative observé"),
        makeItem("dynamique_prix", "Dynamique des prix", now, "Évolution des prix du marché local"),
        makeItem("attractivite", "Attractivité", now, "Score d'attractivité de la zone"),
      ],
    },
    {
      key: "financier",
      label: "Financier",
      description: "Analyse financière et stress tests",
      weight: 0.2,
      items: [
        makeItem("loyers_realistes", "Loyers réalistes", now, "Vérification de la cohérence des loyers projetés"),
        makeItem("charges_sous_estimees", "Charges sous-estimées", now, "Vérification du niveau de charges"),
        makeItem("sensibilite_taux", "Sensibilité aux taux", now, "Analyse de la sensibilité aux variations de taux"),
        makeItem("stress_test", "Stress test", now, "Résultats du stress test financier"),
      ],
    },
    {
      key: "externes",
      label: "Risques externes",
      description: "Risques environnementaux et contextuels",
      weight: 0.2,
      items: [
        makeItem("inondation", "Risque inondation", now, "Exposition au risque d'inondation"),
        makeItem("seisme", "Risque sismique", now, "Exposition au risque sismique"),
        makeItem("nuisances", "Nuisances", now, "Nuisances sonores, olfactives ou visuelles"),
        makeItem("quartier", "Quartier", now, "Analyse du quartier et de son évolution"),
      ],
    },
  ];

  return {
    version: "v1",
    dossierId: params.dossierId,
    categories,
    createdAt: now,
    updatedAt: now,
  };
}