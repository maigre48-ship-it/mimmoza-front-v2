// FILE: src/spaces/promoteur/etudes/marche/types/kpi.types.ts

/** Statut d'un KPI */
export type KpiStatus = "positive" | "warning" | "negative" | "neutral" | "opportunity";

/** KPI calculé */
export interface Kpi {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  benchmark?: number;
  status: KpiStatus;
  description?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: number;
  source?: string;
}

/** Définition d'un KPI (pour la configuration) */
export interface KpiDefinition {
  id: string;
  label: string;
  unit?: string;
  
  // Fonction de calcul (path vers la donnée ou fonction)
  calculate: (data: any) => number | string | null;
  
  // Fonction de benchmark
  getBenchmark?: (data: any) => number | null;
  
  // Seuils pour le statut
  thresholds?: {
    positive: number;
    warning: number;
    negative: number;
  };
  
  // Inversion (plus bas = mieux)
  invertStatus?: boolean;
  
  // Format d'affichage
  format?: "number" | "percent" | "currency" | "distance";
  decimals?: number;
  
  // Icône
  icon?: string;
  
  // Applicable à quels types de projets
  applicableTo?: string[];
}