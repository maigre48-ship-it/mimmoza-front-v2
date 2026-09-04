// src/spaces/promoteur/etudes/marche/types/smartscore.types.ts

import { CONDITIONS_SCORE, GO_SCORE } from "@/lib/scoring/decisionThresholds";

export type ProjectNature =
  | "logement"
  | "residence_etudiante"
  | "residence_senior"
  | "ehpad"
  | "bureaux"
  | "commerce"
  | "hotel";

export type Verdict =
  | "GO"
  | "GO_AVEC_RESERVES"
  | "A_APPROFONDIR"
  | "NO_GO";

export type ScoreComponentKey =
  | "demographie"
  | "marche"
  | "concurrence"
  | "accessibilite"
  | "services"
  | "sante"
  | "tourisme"
  | "emploi"
  | "solvabilite";

export interface ScoreComponent {
  key: ScoreComponentKey;
  label: string;
  weight: number; // 0..1
  score: number;  // 0..100
  details?: Record<string, any>;
}

export interface SmartScoreResult {
  project_nature: ProjectNature;
  score: number; // 0..100
  verdict: Verdict;
  components: ScoreComponent[];
  opportunities: string[];
  risks: string[];
  recommendations: string[];
  meta?: {
    version?: string;
    computed_at?: string;
  };
}

export interface VerdictThresholds {
  go: number;           // >= go
  go_with_reserves: number; // >= go_with_reserves
  deepen: number;       // >= deepen
  // otherwise NO_GO
}

// Seuils alignés sur le barème partagé (lib/scoring/decisionThresholds) :
// ce module exigeait 75 pour un GO là où le sourcing et les opportunités en
// demandaient 65 — un score de 68 était « GO » d'un côté et « avec réserves »
// de l'autre. Le niveau « deepen », propre à l'étude de marché promoteur, est
// conservé : il n'a pas d'équivalent ailleurs.
export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  go: GO_SCORE,
  go_with_reserves: CONDITIONS_SCORE + 10,
  deepen: CONDITIONS_SCORE,
};
