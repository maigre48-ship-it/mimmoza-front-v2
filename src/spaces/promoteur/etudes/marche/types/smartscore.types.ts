// src/spaces/promoteur/etudes/marche/types/smartscore.types.ts

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

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  go: 75,
  go_with_reserves: 60,
  deepen: 45,
};
