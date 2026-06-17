export type SmartScoreBlockKey = "financier" | "risques" | "marche" | "sponsor";

export type SmartScoreDecision = "GO" | "GO_CONDITIONS" | "NO_GO";

export type SmartScoreResultV1 = {
  version: "smartscore.banque.v1";
  score: number; // 0..100
  decision: SmartScoreDecision;

  confidencePct: number; // 0..100
  completenessPct: number; // 0..100

  blocks: Array<{
    key: SmartScoreBlockKey;
    weight: number; // 0..1
    available: boolean;
    score: number | null; // 0..100
    reasons: string[];
    flags: string[];
  }>;

  globalFlags: string[];
  summary: string;
};
