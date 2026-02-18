export type QualificationDecision = "GO" | "GO_AVEC_RESERVES" | "NO_GO";

export interface QualificationInput {
  prixAchat: number;
  fraisNotairePct: number;
  budgetTravaux: number;
  fraisDivers: number;
  prixReventeEstime: number;
  dureeMois: number;
  apport: number;
}

export interface QualificationResult {
  coutTotalOperation: number;
  fraisNotaire: number;
  margeBrute: number;
  margePct: number;
  roi: number;
  tri: number;
  decision: QualificationDecision;
  raisons: string[];
  computedAt: string;
}

export type SourcingSmartScore = {
  score: number;
  grade?: string;
  verdict?: "GO" | "GO_AVEC_RESERVES" | "NO_GO";
  rationale?: string;
  computedAt?: string;
  engineVersion?: string;
};