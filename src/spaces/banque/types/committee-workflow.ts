// FILE: src/spaces/banque/types/committee-workflow.ts

// ─── Document Types ──────────────────────────

export type DocStatus = "missing" | "received" | "rejected";

export interface RequiredDoc {
  id: string;
  label: string;
  category: string;
}

export interface DocumentMetadata {
  docId: string;
  status: DocStatus;
  receivedAt: string | null;
  note: string;
}

// ─── Guarantee Types ─────────────────────────

export interface Guarantee {
  id: string;
  type: GuaranteeType;
  valeur: number;
  rang: GuaranteeRank;
  commentaire: string;
}

export type GuaranteeType =
  | "Hypothèque"
  | "Caution bancaire"
  | "Nantissement"
  | "Privilège de prêteur de deniers"
  | "Gage"
  | "Autre";

export type GuaranteeRank = "1er rang" | "2ème rang" | "3ème rang";

// ─── Committee Types ─────────────────────────

export type ConditionSeverity = "bloquant" | "suspensif";
export type ConditionType = "document" | "guarantee" | "risk" | "manual";
export type ConditionSource = "auto" | "manual";

export interface CommitteeCondition {
  id: string;
  type: ConditionType;
  severity: ConditionSeverity;
  text: string;
  source: ConditionSource;
}

export type CommitteeDecision = "approuvé" | "ajourné" | "refusé" | null;

export interface CommitteeData {
  status: "en_instruction" | "en_comite" | "decide";
  conditions: CommitteeCondition[];
  decision: CommitteeDecision;
  dateComite: string | null;
}

// ─── Risk Types ──────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

// ─── Dossier (partial, only committee-relevant fields) ─

/**
 * ⚠️ Compat: certains écrans utilisent "default".
 * On ajoute aussi "baseline" pour harmoniser avec le reste.
 */
export type ProjectType = "promotion" | "marchand" | "baseline" | "default";

export interface DossierCommitteeSlice {
  id: string;
  montantPret: number;
  projectType: ProjectType;
  documents: DocumentMetadata[];
  guarantees: Guarantee[];
  committee: CommitteeData;
}

// ─── Patch Payloads ──────────────────────────

export interface PatchDocumentPayload {
  docId: string;
  action: "receive" | "remove" | "reject";
  note?: string;
}

export interface PatchGuaranteePayload {
  action: "add" | "update" | "remove";
  guarantee: Partial<Guarantee> & { id?: string };
}

// ─────────────────────────────────────────────────────────
// ✅ AJOUT: Snapshot + Dossier "Banque" (source de vérité)
// Pour éviter l’écran blanc : exports attendus par les services.
// ─────────────────────────────────────────────────────────

export interface DossierEvent {
  id: string;
  timestamp: string; // ISO
  action: string;
  detail?: string;
}

/**
 * Dossier Banque "complet" minimal :
 * on inclut tes champs comité + quelques champs UI (nom/sponsor/montant/updatedAt).
 */
export interface BankDossier {
  id: string;
  nom: string;
  sponsor: string;
  montant: number; // montant demandé / encours
  projectType: ProjectType;

  // Données comité (réutilisation directe de tes types)
  documents: DocumentMetadata[];
  guarantees: Guarantee[];
  committee: CommitteeData;

  // Historique léger
  events: DossierEvent[];

  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface BankSnapshot {
  dossiers: Record<string, BankDossier>;
  updatedAt: string; // ISO
}

/** Normalise "default" vers "baseline" pour cohérence globale */
export function normalizeProjectType(t: ProjectType | null | undefined): ProjectType {
  if (!t) return "baseline";
  return t === "default" ? "baseline" : t;
}

/** Factory: snapshot vide */
export function createEmptySnapshot(): BankSnapshot {
  return {
    dossiers: {},
    updatedAt: new Date().toISOString(),
  };
}

/** Factory: dossier vide */
export function createEmptyDossier(
  id: string,
  nom: string,
  projectType: ProjectType = "baseline"
): BankDossier {
  const now = new Date().toISOString();
  const pt = normalizeProjectType(projectType);

  return {
    id,
    nom,
    sponsor: "",
    montant: 0,
    projectType: pt,

    documents: [],
    guarantees: [],
    committee: {
      status: "en_instruction",
      conditions: [],
      decision: null,
      dateComite: null,
    },

    events: [],
    createdAt: now,
    updatedAt: now,
  };
}
