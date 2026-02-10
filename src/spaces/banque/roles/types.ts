// FILE: src/spaces/banque/types.ts

// ============================================================================
// TYPES BANQUE — Dossier, Documents, Garanties, Comité
// ============================================================================

export type ProjectType = "promotion" | "marchand" | "baseline";

export type DocumentStatus = "fourni" | "en_attente" | "non_applicable";

export interface DossierDocument {
  id: string;
  label: string;
  category: string;
  status: DocumentStatus;
  dateReception?: string;
  commentaire?: string;
}

export type GuaranteeType =
  | "hypotheque"
  | "caution_personnelle"
  | "nantissement"
  | "privilege_preteur"
  | "garantie_autonome"
  | "gage"
  | "delegation_assurance"
  | "autre";

export interface DossierGuarantee {
  id: string;
  type: GuaranteeType;
  label: string;
  montant: number;
  description?: string;
  rang?: number;
  dateConstitution?: string;
}

export type Verdict = "GO" | "GO_SOUS_CONDITIONS" | "NO_GO";
export type RiskLevel = "faible" | "moyen" | "eleve" | "inconnu";
export type ConditionSource = "auto" | "manual";

export interface Condition {
  id: string;
  text: string;
  source: ConditionSource;
  met: boolean;
}

export interface Decision {
  verdict: Verdict;
  motivation: string;
  confidence: number; // 0..1
  date: string;
}

export interface BanqueDossier {
  id: string;
  nom: string;
  projectType: ProjectType;
  montantDemande: number;
  valeurProjet: number;
  documents: DossierDocument[];
  guarantees: DossierGuarantee[];
  conditions: Condition[];
  decision: Decision | null;
  createdAt: string;
  updatedAt: string;
}

export interface BanqueSnapshot {
  version: string;
  updatedAt: string;
  dossiers: BanqueDossier[];
  activeDossierId: string | null;
}

// ── Completeness ────────────────────────────────────────────────────────────

export interface CompletenessResult {
  total: number;
  provided: number;
  missing: string[];
  percentage: number;
}

// ── Decision Draft ──────────────────────────────────────────────────────────

export interface DecisionDraft {
  verdict: Verdict;
  motivation: string;
  confidence: number;
  suggestedConditions: Condition[];
}// Banque types (roles)\nexport {}
