/**
 * Sourcing Module - Frontend Types
 */

export type ProfileTarget = 'mdb' | 'promoteur' | 'particulier';
export type PropertyType = 'appartement' | 'maison' | 'terrain' | 'immeuble' | 'local_commercial' | 'bureau';
export type FloorType = 'rdc' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10+' | 'dernier' | 'n/a';
export type ProximityTransport = 'metro' | 'rer' | 'tramway' | 'bus' | 'gare' | 'aucun' | 'unknown';
export type NuisanceLevel = 'aucune' | 'faible' | 'moyenne' | 'forte' | 'unknown';
export type StandingLevel = 'basique' | 'standard' | 'premium' | 'luxe' | 'unknown';

export interface ScoreComponent {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  inputUsed: string;
  rationale?: string;
}

export interface ScoreBlocker {
  key: string;
  label: string;
  severity: 'warning' | 'critical';
  message: string;
}

export interface SubScore {
  value: number;
  weight: number;
  rationale: string;
  components: ScoreComponent[];
  blockers: ScoreBlocker[];
  confidence: number;
}

export type SubScoreKey = 'location' | 'liquidity' | 'value' | 'worksRisk' | 'legalUrbanism' | 'risk' | 'dealStructure';

export interface SmartScoreResult {
  globalScore: number;
  globalConfidence: number;
  globalRationale: string;
  subScores: Record<SubScoreKey, SubScore>;
  profileTarget: ProfileTarget;
  weightsUsed: Record<string, number>;
  penaltiesApplied: Array<{ reason: string; points: number }>;
  warnings: string[];
  version: string;
  computedAt: string;
  inputHash: string;
}

export const PROFILE_LABELS: Record<ProfileTarget, string> = {
  mdb: 'Marchand de Biens',
  promoteur: 'Promoteur',
  particulier: 'Particulier',
};

export const SUB_SCORE_LABELS: Record<SubScoreKey, { label: string; icon: string; description: string }> = {
  location: { label: 'Localisation', icon: '📍', description: "Qualité de l'emplacement" },
  liquidity: { label: 'Liquidité', icon: '💧', description: 'Facilité de revente' },
  value: { label: 'Valeur', icon: '💰', description: 'Rapport prix/marché' },
  worksRisk: { label: 'Risque Travaux', icon: '🔧', description: 'Complexité travaux' },
  legalUrbanism: { label: 'Urbanisme', icon: '📋', description: 'Situation juridique' },
  risk: { label: 'Risques', icon: '⚠️', description: 'Risques environnementaux' },
  dealStructure: { label: 'Structure', icon: '🏠', description: 'Cohérence du bien' },
};

export const SCORE_THRESHOLDS = { excellent: 80, good: 65, average: 50, poor: 35 };

export function getScoreLevel(score: number): 'excellent' | 'good' | 'average' | 'poor' | 'bad' {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 50) return 'average';
  if (score >= 35) return 'poor';
  return 'bad';
}

export function getScoreColor(score: number): string {
  const colors = { excellent: '#10b981', good: '#22c55e', average: '#f59e0b', poor: '#f97316', bad: '#ef4444' };
  return colors[getScoreLevel(score)];
}
