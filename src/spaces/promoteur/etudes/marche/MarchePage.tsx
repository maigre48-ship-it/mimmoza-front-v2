// ============================================
// MarchePage.tsx - VERSION 2.4
// ============================================
// AMÉLIORATIONS v2.4:
// - Carte correctement centrée sur la parcelle
// - Labels BPE complets (plus de troncature)
// - Fusion EHPAD + Résidence senior
// - Scoring différencié par type de projet
// - PDF fonctionnel
// ============================================

import React, { useState, useCallback, useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from "react";
import { 
  Search, MapPin, Grid3X3, Loader2, X, Building2, 
  Users, Euro, ShoppingCart, Stethoscope, GraduationCap, 
  TrendingUp, TrendingDown, Banknote, CheckCircle,
  AlertTriangle, Home, Activity, Download,
  ChevronDown, ChevronUp, Heart,
  Target, Building,
  Eye, Minus, MapPinned,
  Compass, FileText, Train, Bus,
  Bed, BadgeEuro, Baby, UserCheck, Briefcase,
  PiggyBank, School,
  Theater, Dumbbell
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

// ============================================
// IMPORTS MODULES EXTRAITS
// ============================================
import type {
  ProjectType,
  AddressSuggestion,
  ParcelInfo,
  DataSourceType,
} from "./types/market.types";

import { PROJECT_CONFIGS, getProjectConfig } from "./config/project.config";
import { searchAddress } from "./services/address.service";
import { searchParcel } from "./services/parcel.service";

// ============================================
// IMPORT SNAPSHOT STORE
// ============================================
import { patchProjectInfo, patchModule } from "../../shared/promoteurSnapshot.store";

// ============================================
// DEBUG FLAGS
// ============================================
const DEBUG_MODE = true;

const log = (prefix: string, message: string, data?: unknown) => {
  if (DEBUG_MODE) console.log(`${prefix} ${message}`, data ?? '');
};

// ============================================
// TYPES pour market-study-promoteur-v1.0.8
// ============================================
interface DvfTransaction {
  date_mutation: string;
  valeur_fonciere: number;
  surface_reelle_bati: number;
  type_local: string;
  commune: string;
  prix_m2: number;
}

interface DvfData {
  nb_transactions: number;
  prix_m2_median: number;
  prix_m2_moyen: number;
  prix_m2_min: number;
  prix_m2_max: number;
  evolution_prix_pct: number | null;
  transactions: DvfTransaction[];
  coverage: string;
}

interface InseeData {
  code_commune: string;
  commune_nom: string;
  departement: string;
  region: string;
  population: number;
  densite: number;
  revenu_median: number;
  taux_chomage: number;
  pct_proprietaires: number;
  pct_moins_15?: number;
  pct_15_29?: number;
  pct_30_44?: number;
  pct_45_59?: number;
  pct_60_74?: number;
  pct_plus_60?: number;
  pct_plus_65?: number;
  pct_plus_75?: number;
  menages_total?: number;
  taille_moyenne_menage?: number;
  pct_familles_monoparentales?: number;
  pct_personnes_seules?: number;
  pct_retraites?: number;
  pct_etudiants?: number;
  pct_actifs?: number;
  pct_logements_vacants?: number;
  pct_locataires?: number;
  coverage: string;
}

interface TransportStop {
  name: string;
  type: string;
  distance_m: number;
}

interface TransportData {
  score: number;
  stops: TransportStop[];
  nearest_stop_m: number;
  has_metro_train: boolean;
  has_tram: boolean;
  coverage: string;
}

interface BpeDetail {
  label: string;
  distance_m: number;
}

interface BpeCategory {
  count: number;
  details: BpeDetail[];
}

interface BpeData {
  total_equipements: number;
  score: number;
  commerces: BpeCategory;
  sante: BpeCategory;
  services: BpeCategory;
  education: BpeCategory;
  loisirs?: BpeCategory;
  sport?: BpeCategory;
  coverage: string;
}

// ============================================
// TYPES EHPAD v1.0.8
// ============================================
interface EhpadEtablissement {
  nom: string;
  distance_m: number;
  capacite: number;
  capacite_estimee?: boolean;
  finess?: string;
  commune?: string;
  tarifs?: {
    hebergement_jour: number | null;
    dependance_gir_1_2: number | null;
    dependance_gir_3_4: number | null;
    dependance_gir_5_6: number | null;
    cout_mensuel_gir_1_2: number | null;
  };
  statut_juridique?: string;
  habilite_aide_sociale?: boolean;
}

interface PrixStats {
  prix_hebergement_min: number;
  prix_hebergement_max: number;
  prix_hebergement_median: number | null;
  prix_hebergement_moyen: number;
  nb_etablissements_avec_prix: number;
}

interface TarifsGir {
  tarif_gir_1_2_moyen: number | null;
  tarif_gir_3_4_moyen: number | null;
  tarif_gir_5_6_moyen: number | null;
}

interface EhpadConcurrence {
  etablissements: EhpadEtablissement[];
  count: number;
  total_lits: number;
  prix_stats: PrixStats | null;
  tarifs_gir: TarifsGir | null;
  nb_ehpad_departement: number;
  sources: {
    cnsa_tarifs: number;
    overpass: number;
  };
  coverage: string;
}

interface AnalysePrix extends PrixStats, TarifsGir {
  cout_mensuel_moyen_gir_1_2: number | null;
  interpretation: string | null;
}

interface EhpadSpecific {
  concurrence: EhpadConcurrence;
  demographie_senior: {
    population_75_plus: number;
    pct_75_plus: number;
  };
  offre_sante: {
    pharmacies: number;
  };
  indicateurs_marche: {
    densite_lits_1000_seniors: number | null;
    taux_equipement_zone: "sous_equipe" | "equilibre" | "sur_equipe";
    potentiel_marche: "fort" | "moyen" | "faible";
  };
  analyse_prix: AnalysePrix | null;
}

interface MarketStudyApiResponse {
  success: boolean;
  version: string;
  meta: {
    lat: number;
    lon: number;
    location_source?: string;
    location_label?: string;
    commune_insee: string;
    commune_nom: string;
    departement: string;
    project_type: string;
    project_type_label: string;
    radius_km: number;
    generated_at: string;
  };
  core: {
    dvf: DvfData;
    insee: InseeData;
    transport: TransportData;
    bpe: BpeData;
  };
  specific: EhpadSpecific | Record<string, unknown>;
  scores: {
    demande: number;
    offre: number;
    accessibilite: number;
    environnement: number;
    global: number;
  };
  insights: Array<{
    type: string;
    category: string;
    message: string;
  }>;
  debug?: {
    timings: Record<string, number>;
  };
}

// ============================================
// ERROR BOUNDARY
// ============================================
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  componentName?: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught error in ${this.props.componentName}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "40px", textAlign: "center", background: "#fef2f2",
          borderRadius: "12px", border: "1px solid #fecaca", margin: "20px"
        }}>
          <AlertTriangle size={48} color="#dc2626" style={{ marginBottom: "16px" }} />
          <h3 style={{ color: "#991b1b", marginBottom: "8px" }}>
            Erreur dans {this.props.componentName || 'un composant'}
          </h3>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "10px 20px", background: "#dc2626", color: "white",
              border: "none", borderRadius: "8px", cursor: "pointer"
            }}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// SAFE ICON COMPONENT
// ============================================
const SafeIcon: React.FC<{
  icon?: LucideIcon | null;
  fallback?: LucideIcon;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ icon, fallback = Building2, size = 20, color, style }) => {
  const IconComponent = icon && typeof icon === 'function' ? icon : fallback;
  try {
    return <IconComponent size={size} color={color} style={style} />;
  } catch {
    const FallbackIcon = fallback;
    return <FallbackIcon size={size} color={color} style={style} />;
  }
};

// ============================================
// SAFE PROJECT CONFIG
// ============================================
const getSafeProjectConfig = (nature: ProjectType) => {
  try {
    const config = getProjectConfig(nature);
    if (!config || !config.icon) {
      return getDefaultProjectConfig();
    }
    return config;
  } catch {
    return getDefaultProjectConfig();
  }
};

const getDefaultProjectConfig = () => ({
  icon: Building2,
  label: 'Projet',
  color: '#6366f1',
  description: 'Étude de marché',
  radius: { analysis: 2 },
  requiredDataSources: ['insee', 'dvf'] as DataSourceType[],
  demographicSegments: [],
  competitionLabel: { singular: 'Établissement', plural: 'Établissements', unit: 'places' },
});

// ============================================
// HELPERS
// ============================================
const formatNumber = (n: number | null | undefined, decimals = 0): string => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

const formatPrice = (n: number | null | undefined): string => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

const formatPercent = (n: number | null | undefined, showSign = false): string => {
  if (n == null || isNaN(n)) return "—";
  const sign = showSign && n > 0 ? "+" : "";
  return `${sign}${formatNumber(n, 1)}%`;
};

const getScoreColor = (score: number | null | undefined): string => {
  if (score == null) return "#94a3b8";
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#f59e0b";
  if (score >= 35) return "#f97316";
  return "#ef4444";
};

const getVerdictConfig = (score: number | null | undefined) => {
  if (score == null) return { label: "—", color: "#64748b", bg: "#f1f5f9", icon: Minus };
  if (score >= 70) return { label: "GO", color: "#059669", bg: "#dcfce7", icon: CheckCircle };
  if (score >= 50) return { label: "GO avec réserves", color: "#d97706", bg: "#fef3c7", icon: AlertTriangle };
  if (score >= 35) return { label: "À approfondir", color: "#ea580c", bg: "#ffedd5", icon: Eye };
  return { label: "NO GO", color: "#dc2626", bg: "#fee2e2", icon: X };
};

// ============================================
// SCORING DIFFÉRENCIÉ PAR TYPE DE PROJET - v2.4
// ============================================
interface ProjectScoreWeights {
  demande: number;
  offre: number;
  accessibilite: number;
  environnement: number;
}

interface ProjectScoringConfig {
  weights: ProjectScoreWeights;
  bonusFactors: {
    condition: (data: MarketStudyApiResponse) => boolean;
    bonus: number;
    label: string;
  }[];
  penaltyFactors: {
    condition: (data: MarketStudyApiResponse) => boolean;
    penalty: number;
    label: string;
  }[];
}

const PROJECT_SCORING_CONFIG: Record<string, ProjectScoringConfig> = {
  logement: {
    weights: { demande: 0.30, offre: 0.25, accessibilite: 0.25, environnement: 0.20 },
    bonusFactors: [
      { condition: (d) => (d.core.insee?.pct_moins_15 ?? 0) > 20, bonus: 8, label: "Zone familiale" },
      { condition: (d) => (d.core.dvf?.evolution_prix_pct ?? 0) > 5, bonus: 5, label: "Marché dynamique" },
      { condition: (d) => (d.core.bpe?.education?.count ?? 0) >= 3, bonus: 5, label: "Écoles à proximité" },
      { condition: (d) => d.core.transport?.has_metro_train === true, bonus: 7, label: "Transport lourd" },
      { condition: (d) => (d.core.insee?.pct_logements_vacants ?? 100) < 8, bonus: 5, label: "Tension locative" },
    ],
    penaltyFactors: [
      { condition: (d) => (d.core.insee?.taux_chomage ?? 0) > 12, penalty: 8, label: "Chômage élevé" },
      { condition: (d) => (d.core.dvf?.nb_transactions ?? 0) < 10, penalty: 5, label: "Marché peu liquide" },
      { condition: (d) => (d.core.insee?.pct_logements_vacants ?? 0) > 15, penalty: 10, label: "Vacance élevée" },
    ],
  },
  ehpad: {
    weights: { demande: 0.40, offre: 0.30, accessibilite: 0.15, environnement: 0.15 },
    bonusFactors: [
      { condition: (d) => ((d.specific as EhpadSpecific)?.demographie_senior?.pct_75_plus ?? 0) > 12, bonus: 12, label: "Pop. senior élevée" },
      { condition: (d) => ((d.specific as EhpadSpecific)?.indicateurs_marche?.taux_equipement_zone === "sous_equipe"), bonus: 15, label: "Zone sous-équipée" },
      { condition: (d) => (d.core.bpe?.sante?.count ?? 0) >= 3, bonus: 8, label: "Services santé" },
      { condition: (d) => ((d.specific as EhpadSpecific)?.indicateurs_marche?.potentiel_marche === "fort"), bonus: 10, label: "Fort potentiel" },
      { condition: (d) => ((d.specific as EhpadSpecific)?.offre_sante?.pharmacies ?? 0) >= 2, bonus: 5, label: "Pharmacies proches" },
    ],
    penaltyFactors: [
      { condition: (d) => ((d.specific as EhpadSpecific)?.indicateurs_marche?.taux_equipement_zone === "sur_equipe"), penalty: 15, label: "Zone sur-équipée" },
      { condition: (d) => ((d.specific as EhpadSpecific)?.concurrence?.count ?? 0) > 10, penalty: 10, label: "Forte concurrence" },
      { condition: (d) => ((d.specific as EhpadSpecific)?.demographie_senior?.pct_75_plus ?? 100) < 8, penalty: 8, label: "Pop. senior faible" },
    ],
  },
  residence_etudiante: {
    weights: { demande: 0.35, offre: 0.20, accessibilite: 0.30, environnement: 0.15 },
    bonusFactors: [
      { condition: (d) => (d.core.insee?.pct_15_29 ?? 0) > 20, bonus: 12, label: "Pop. jeune élevée" },
      { condition: (d) => (d.core.insee?.pct_etudiants ?? 0) > 10, bonus: 15, label: "Zone étudiante" },
      { condition: (d) => d.core.transport?.has_metro_train === true, bonus: 10, label: "Transport lourd" },
      { condition: (d) => (d.core.bpe?.education?.count ?? 0) >= 2, bonus: 8, label: "Établissements scolaires" },
      { condition: (d) => (d.core.insee?.pct_locataires ?? 0) > 50, bonus: 5, label: "Marché locatif actif" },
    ],
    penaltyFactors: [
      { condition: (d) => d.core.transport?.score < 40, penalty: 12, label: "Accessibilité faible" },
      { condition: (d) => (d.core.insee?.pct_15_29 ?? 0) < 12, penalty: 10, label: "Pop. jeune faible" },
    ],
  },
  bureaux: {
    weights: { demande: 0.25, offre: 0.20, accessibilite: 0.40, environnement: 0.15 },
    bonusFactors: [
      { condition: (d) => d.core.transport?.has_metro_train === true, bonus: 15, label: "Transport lourd" },
      { condition: (d) => d.core.transport?.score >= 70, bonus: 10, label: "Excellente desserte" },
      { condition: (d) => (d.core.insee?.pct_actifs ?? 0) > 45, bonus: 8, label: "Bassin d'actifs" },
      { condition: (d) => (d.core.bpe?.services?.count ?? 0) >= 5, bonus: 5, label: "Services aux entreprises" },
      { condition: (d) => (d.core.insee?.revenu_median ?? 0) > 28000, bonus: 7, label: "Zone CSP+" },
    ],
    penaltyFactors: [
      { condition: (d) => d.core.transport?.score < 50, penalty: 15, label: "Accessibilité insuffisante" },
      { condition: (d) => (d.core.insee?.taux_chomage ?? 0) > 10, penalty: 5, label: "Bassin économique fragile" },
      { condition: (d) => !d.core.transport?.has_metro_train && !d.core.transport?.has_tram, penalty: 8, label: "Pas de transport lourd" },
    ],
  },
  commerce: {
    weights: { demande: 0.35, offre: 0.15, accessibilite: 0.25, environnement: 0.25 },
    bonusFactors: [
      { condition: (d) => (d.core.insee?.revenu_median ?? 0) > 25000, bonus: 10, label: "Pouvoir d'achat élevé" },
      { condition: (d) => (d.core.insee?.densite ?? 0) > 1000, bonus: 8, label: "Zone dense" },
      { condition: (d) => d.core.transport?.score >= 60, bonus: 7, label: "Bonne accessibilité" },
      { condition: (d) => (d.core.bpe?.commerces?.count ?? 0) > 5 && (d.core.bpe?.commerces?.count ?? 0) < 20, bonus: 8, label: "Zone commerciale équilibrée" },
      { condition: (d) => (d.core.insee?.pct_30_44 ?? 0) > 20, bonus: 5, label: "Pop. active consommatrice" },
    ],
    penaltyFactors: [
      { condition: (d) => (d.core.bpe?.commerces?.count ?? 0) > 30, penalty: 10, label: "Forte concurrence commerciale" },
      { condition: (d) => (d.core.insee?.revenu_median ?? 100000) < 18000, penalty: 12, label: "Pouvoir d'achat faible" },
      { condition: (d) => (d.core.insee?.densite ?? 0) < 200, penalty: 8, label: "Zone peu dense" },
    ],
  },
  hotel: {
    weights: { demande: 0.30, offre: 0.25, accessibilite: 0.30, environnement: 0.15 },
    bonusFactors: [
      { condition: (d) => d.core.transport?.has_metro_train === true, bonus: 12, label: "Accès transport" },
      { condition: (d) => (d.core.bpe?.loisirs?.count ?? 0) >= 3, bonus: 8, label: "Zone touristique" },
      { condition: (d) => (d.core.insee?.densite ?? 0) > 500, bonus: 5, label: "Zone urbaine" },
      { condition: (d) => (d.core.bpe?.services?.count ?? 0) >= 5, bonus: 5, label: "Services disponibles" },
    ],
    penaltyFactors: [
      { condition: (d) => d.core.transport?.score < 40, penalty: 15, label: "Accessibilité insuffisante" },
      { condition: (d) => (d.core.insee?.densite ?? 0) < 100, penalty: 10, label: "Zone isolée" },
    ],
  },
};

/**
 * Calcule les scores différenciés selon le type de projet
 */
const calculateDifferentiatedScores = (
  data: MarketStudyApiResponse,
  projectType: string
): { 
  scores: typeof data.scores; 
  adjustments: { label: string; value: number }[];
  explanation: string;
} => {
  const config = PROJECT_SCORING_CONFIG[projectType] || PROJECT_SCORING_CONFIG.logement;
  const baseScores = data.scores;
  
  // Calculer le score pondéré de base
  let weightedBase = 
    baseScores.demande * config.weights.demande +
    baseScores.offre * config.weights.offre +
    baseScores.accessibilite * config.weights.accessibilite +
    baseScores.environnement * config.weights.environnement;
  
  const adjustments: { label: string; value: number }[] = [];
  
  // Appliquer les bonus
  for (const bonus of config.bonusFactors) {
    try {
      if (bonus.condition(data)) {
        weightedBase += bonus.bonus;
        adjustments.push({ label: `✅ ${bonus.label}`, value: bonus.bonus });
      }
    } catch {
      // Condition non évaluable, ignorer
    }
  }
  
  // Appliquer les pénalités
  for (const penalty of config.penaltyFactors) {
    try {
      if (penalty.condition(data)) {
        weightedBase -= penalty.penalty;
        adjustments.push({ label: `⚠️ ${penalty.label}`, value: -penalty.penalty });
      }
    } catch {
      // Condition non évaluable, ignorer
    }
  }
  
  // Clamp entre 0 et 100
  const finalScore = Math.max(0, Math.min(100, Math.round(weightedBase)));
  
  // Recalculer les sous-scores avec les pondérations
  const adjustedScores = {
    demande: Math.round(baseScores.demande * (1 + (config.weights.demande - 0.25) * 0.5)),
    offre: Math.round(baseScores.offre * (1 + (config.weights.offre - 0.25) * 0.5)),
    accessibilite: Math.round(baseScores.accessibilite * (1 + (config.weights.accessibilite - 0.25) * 0.5)),
    environnement: Math.round(baseScores.environnement * (1 + (config.weights.environnement - 0.25) * 0.5)),
    global: finalScore,
  };
  
  // Clamp tous les scores
  Object.keys(adjustedScores).forEach(key => {
    const k = key as keyof typeof adjustedScores;
    adjustedScores[k] = Math.max(0, Math.min(100, adjustedScores[k]));
  });
  
  // Générer l'explication
  const weightsExplanation = Object.entries(config.weights)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${Math.round(v * 100)}%`)
    .join(', ');
  
  return {
    scores: adjustedScores,
    adjustments,
    explanation: `Pondération ${projectType}: ${weightsExplanation}`,
  };
};

// ============================================
// STYLES
// ============================================
const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f0fdf4 100%)",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  } as React.CSSProperties,
  
  header: {
    background: "linear-gradient(135deg, #1e293b 0%, #312e81 50%, #1e293b 100%)",
    padding: "32px 40px",
    color: "white",
  } as React.CSSProperties,
  
  mainContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "32px 40px",
  } as React.CSSProperties,
  
  formSection: {
    background: "white",
    borderRadius: "16px",
    padding: "28px",
    marginBottom: "24px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
  } as React.CSSProperties,
  
  card: {
    background: "white",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
  } as React.CSSProperties,
  
  cardTitle: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#1e293b",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,
  
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 600,
  } as React.CSSProperties,
  
  input: {
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    fontSize: "14px",
    transition: "all 0.2s",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  
  select: {
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    fontSize: "14px",
    background: "white",
    cursor: "pointer",
    width: "100%",
  } as React.CSSProperties,
  
  submitButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "14px 32px",
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "0 4px 12px rgba(79, 70, 229, 0.3)",
  } as React.CSSProperties,
  
  statBox: {
    padding: "12px",
    background: "#f8fafc",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as React.CSSProperties,
};

// ============================================
// SCORE GAUGE
// ============================================
const ScoreGauge: React.FC<{ score: number | null | undefined; size?: number; showVerdict?: boolean }> = ({ 
  score, 
  size = 140,
  showVerdict = true 
}) => {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score != null ? (score / 100) * circumference : 0;
  const color = getScoreColor(score);
  const verdict = getVerdictConfig(score);
  const VerdictIcon = verdict.icon || Minus;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
          <circle
            cx={size/2} cy={size/2} r={radius}
            fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: size * 0.3, fontWeight: 800, color }}>{score ?? "—"}</span>
          <span style={{ fontSize: size * 0.1, color: "#94a3b8", fontWeight: 500 }}>/100</span>
        </div>
      </div>
      {showVerdict && (
        <div style={{
          ...styles.badge,
          background: verdict.bg,
          color: verdict.color,
          padding: "6px 14px",
          fontSize: "13px",
        }}>
          <VerdictIcon size={14} />
          {verdict.label}
        </div>
      )}
    </div>
  );
};

// ============================================
// DATA SOURCES BADGES
// ============================================
const DataSourcesBadges: React.FC<{ 
  dvf: boolean; 
  insee: boolean; 
  transport: boolean; 
  bpe: boolean;
  cnsa?: number;
}> = ({ dvf, insee, transport, bpe, cnsa }) => {
  const sources = [
    { key: 'dvf', label: 'DVF', available: dvf },
    { key: 'insee', label: 'INSEE', available: insee },
    { key: 'transport', label: 'Transport', available: transport },
    { key: 'bpe', label: 'BPE', available: bpe },
    ...(cnsa !== undefined ? [{ key: 'cnsa', label: `CNSA (${cnsa})`, available: cnsa > 0 }] : []),
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {sources.map((source) => (
        <div
          key={source.key}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px 10px",
            background: source.available ? "#dcfce7" : "#f1f5f9",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 600,
            color: source.available ? "#166534" : "#94a3b8",
          }}
        >
          {source.available ? <CheckCircle size={12} /> : <X size={12} />}
          {source.label}
        </div>
      ))}
    </div>
  );
};

// ============================================
// INSIGHT CARD
// ============================================
const InsightCard: React.FC<{ 
  type: string; 
  category: string;
  message: string;
}> = ({ type, category, message }) => {
  const configs: Record<string, { bg: string; border: string; color: string; dot: string }> = {
    positive: { bg: "#ecfdf5", border: "#a7f3d0", color: "#065f46", dot: "#10b981" },
    warning: { bg: "#fef3c7", border: "#fcd34d", color: "#92400e", dot: "#f59e0b" },
    negative: { bg: "#fee2e2", border: "#fca5a5", color: "#991b1b", dot: "#ef4444" },
    neutral: { bg: "#f1f5f9", border: "#cbd5e1", color: "#475569", dot: "#64748b" },
  };
  
  const config = configs[type] || configs.neutral;
  
  return (
    <div style={{ 
      padding: "14px 16px", 
      background: config.bg, 
      border: `1px solid ${config.border}`, 
      borderRadius: "10px",
      marginBottom: "10px"
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <span style={{ 
          width: "8px", height: "8px", borderRadius: "50%", 
          background: config.dot, marginTop: "6px", flexShrink: 0 
        }} />
        <div style={{ flex: 1 }}>
          <span style={{ 
            fontSize: "10px", 
            fontWeight: 600, 
            color: config.color, 
            textTransform: "uppercase",
            opacity: 0.7
          }}>
            {category}
          </span>
          <p style={{ fontSize: "13px", color: "#1e293b", margin: "4px 0 0 0", lineHeight: 1.5 }}>
            {message}
          </p>
        </div>
      </div>
    </div>
  );
};

// ============================================
// MAP COMPONENT - v2.4 CENTRAGE CORRIGÉ
// ============================================
const MapWithMarkers: React.FC<{ 
  lat?: number; 
  lon?: number; 
  radius?: number;
  commune?: string;
}> = ({ lat, lon, radius = 2000, commune }) => {
  if (!lat || !lon) {
    return (
      <div style={{
        height: "100%", width: "100%",
        background: "linear-gradient(135deg, #f1f5f9 0%, #e0e7ff 100%)",
        borderRadius: "12px",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: "12px"
      }}>
        <MapPinned size={48} color="#94a3b8" />
        <p style={{ color: "#64748b", fontSize: "14px" }}>Carte non disponible</p>
      </div>
    );
  }

  // v2.4: Calcul du delta amélioré pour un meilleur centrage
  // 1 degré ≈ 111km, donc pour un rayon de 2km, delta ≈ 0.018
  const deltaLat = (radius / 111000) * 1.5; // Ajout de marge 50%
  const deltaLon = (radius / (111000 * Math.cos(lat * Math.PI / 180))) * 1.5;
  
  // Zoom level basé sur le rayon
  const zoom = radius <= 1000 ? 16 : radius <= 3000 ? 15 : radius <= 5000 ? 14 : radius <= 10000 ? 13 : 12;

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - deltaLon},${lat - deltaLat},${lon + deltaLon},${lat + deltaLat}&layer=mapnik&marker=${lat},${lon}`;

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", borderRadius: "12px", overflow: "hidden" }}>
      <iframe
        src={mapUrl}
        style={{ border: "none", width: "100%", height: "100%" }}
        title="Carte du projet"
      />
      <div style={{
        position: "absolute", top: "12px", right: "12px",
        background: "rgba(255,255,255,0.95)", borderRadius: "8px",
        padding: "10px 14px", boxShadow: "0 2px 12px rgba(0,0,0,0.1)"
      }}>
        <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>Centre</div>
        <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#1e293b" }}>
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </div>
      </div>
      <div style={{
        position: "absolute", bottom: "12px", left: "12px",
        background: "rgba(255,255,255,0.95)", borderRadius: "8px",
        padding: "8px 14px", boxShadow: "0 2px 12px rgba(0,0,0,0.1)"
      }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
          {commune || "Zone d'analyse"}
        </span>
      </div>
    </div>
  );
};

// ============================================
// DVF CARD
// ============================================
const DvfCard: React.FC<{ dvf: DvfData | null }> = ({ dvf }) => {
  const [showTransactions, setShowTransactions] = useState(false);
  
  if (!dvf || dvf.nb_transactions === 0) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <Euro size={20} color="#10b981" />
          Marché Immobilier & Prix
          <span style={{ ...styles.badge, background: "#f1f5f9", color: "#64748b", marginLeft: "auto" }}>
            DVF non disponible
          </span>
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
          <Euro size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p>Aucune transaction DVF dans cette zone</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Euro size={20} color="#10b981" />
        Marché Immobilier & Prix
        <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534", marginLeft: "auto" }}>
          {dvf.nb_transactions} transactions DVF
        </span>
      </div>
      
      <div style={{
        background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
        borderRadius: "14px", padding: "24px", textAlign: "center", marginBottom: "20px"
      }}>
        <div style={{ fontSize: "13px", color: "#059669", fontWeight: 600, marginBottom: "8px" }}>
          PRIX MÉDIAN AU M²
        </div>
        <div style={{ fontSize: "42px", fontWeight: 800, color: "#047857" }}>
          {formatPrice(dvf.prix_m2_median)}
        </div>
        {dvf.evolution_prix_pct != null && (
          <div style={{ 
            display: "inline-flex", alignItems: "center", gap: "6px",
            marginTop: "12px", padding: "6px 12px", borderRadius: "8px",
            background: dvf.evolution_prix_pct >= 0 ? "#d1fae5" : "#fee2e2",
            color: dvf.evolution_prix_pct >= 0 ? "#065f46" : "#991b1b",
            fontSize: "13px", fontWeight: 600
          }}>
            {dvf.evolution_prix_pct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {formatPercent(dvf.evolution_prix_pct, true)} sur 1 an
          </div>
        )}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "20px" }}>
        {[
          { label: "Min", value: dvf.prix_m2_min, color: "#3b82f6" },
          { label: "Médian", value: dvf.prix_m2_median, color: "#10b981" },
          { label: "Moyen", value: dvf.prix_m2_moyen, color: "#8b5cf6" },
          { label: "Max", value: dvf.prix_m2_max, color: "#ef4444" },
        ].map((item, i) => (
          <div key={i} style={{ textAlign: "center", padding: "12px", background: "#f8fafc", borderRadius: "10px" }}>
            <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 500, marginBottom: "4px" }}>{item.label}</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: item.color }}>
              {formatPrice(item.value)}
            </div>
          </div>
        ))}
      </div>
      
      {dvf.transactions && dvf.transactions.length > 0 && (
        <div>
          <button
            onClick={() => setShowTransactions(!showTransactions)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", padding: "12px 16px", background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer"
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
              Voir les {Math.min(dvf.transactions.length, 30)} dernières transactions
            </span>
            {showTransactions ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          
          {showTransactions && (
            <div style={{ marginTop: "12px", maxHeight: "300px", overflowY: "auto" }}>
              {dvf.transactions.slice(0, 30).map((tx, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "100px 1fr 100px 80px",
                  gap: "12px", padding: "10px 12px", alignItems: "center",
                  background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "6px", fontSize: "12px"
                }}>
                  <span style={{ color: "#64748b" }}>{tx.date_mutation}</span>
                  <span style={{ color: "#1e293b", fontWeight: 500 }}>{tx.type_local} - {tx.commune}</span>
                  <span style={{ color: "#10b981", fontWeight: 600 }}>{formatPrice(tx.valeur_fonciere)}</span>
                  <span style={{ color: "#6366f1", fontWeight: 700 }}>{formatNumber(tx.prix_m2)} €/m²</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================
// DEMOGRAPHIE CARD - ADAPTATIF PAR TYPE DE PROJET
// ============================================
const DemographieCard: React.FC<{ 
  insee: InseeData | null; 
  projectType: string;
  ehpadSpecific?: EhpadSpecific | null;
}> = ({ insee, projectType, ehpadSpecific }) => {
  if (!insee) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <Users size={20} color="#6366f1" />
          Données Démographiques
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
          <Users size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p>Données INSEE non disponibles</p>
        </div>
      </div>
    );
  }

  const isEhpadOrSenior = projectType === "ehpad";
  const isEtudiant = projectType === "residence_etudiante";
  const isLogement = projectType === "logement";
  const isCommerce = projectType === "commerce";
  const isBureaux = projectType === "bureaux";

  const mainStats = [
    { label: "POPULATION", value: formatNumber(insee.population), color: "#4338ca", bg: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)" },
    { label: "DENSITÉ", value: formatNumber(insee.densite), unit: "hab./km²", color: "#15803d", bg: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)" },
    { label: "RÉGION", value: insee.region, color: "#86198f", bg: "linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)", isText: true },
  ];

  type StatItem = {
    icon: LucideIcon;
    label: string;
    value: string;
    color: string;
    highlight?: boolean;
    bgColor?: string;
  };

  const getSecondaryStats = (): StatItem[] => {
    const stats: StatItem[] = [];
    
    stats.push({ icon: Euro, label: "Revenu médian", value: `${formatPrice(insee.revenu_median)}/an`, color: "#10b981" });
    stats.push({ icon: Activity, label: "Taux chômage", value: formatPercent(insee.taux_chomage), color: insee.taux_chomage > 10 ? "#ef4444" : "#f59e0b" });
    
    if (isEhpadOrSenior) {
      const pop75 = ehpadSpecific?.demographie_senior?.population_75_plus || Math.round(insee.population * 0.1);
      const pct75 = ehpadSpecific?.demographie_senior?.pct_75_plus || 10;
      stats.unshift({ icon: Heart, label: "Population 75+ ans", value: formatNumber(pop75), color: "#ec4899", highlight: true, bgColor: "#fdf2f8" });
      stats.push({ icon: UserCheck, label: "% 75+ ans", value: formatPercent(pct75), color: "#ec4899", highlight: true, bgColor: "#fdf2f8" });
      if (insee.pct_plus_60) stats.push({ icon: Users, label: "% 60+ ans", value: formatPercent(insee.pct_plus_60), color: "#8b5cf6" });
      if (insee.pct_retraites) stats.push({ icon: Home, label: "% Retraités", value: formatPercent(insee.pct_retraites), color: "#6366f1" });
      if (insee.pct_personnes_seules) stats.push({ icon: UserCheck, label: "% Personnes seules", value: formatPercent(insee.pct_personnes_seules), color: "#f59e0b" });
    } else if (isEtudiant) {
      if (insee.pct_15_29) stats.unshift({ icon: GraduationCap, label: "% 15-29 ans", value: formatPercent(insee.pct_15_29), color: "#8b5cf6", highlight: true, bgColor: "#f5f3ff" });
      if (insee.pct_etudiants) stats.push({ icon: School, label: "% Étudiants", value: formatPercent(insee.pct_etudiants), color: "#6366f1", highlight: true, bgColor: "#eef2ff" });
      stats.push({ icon: Home, label: "% Locataires", value: formatPercent(insee.pct_locataires || (100 - (insee.pct_proprietaires || 58))), color: "#3b82f6", highlight: true });
      if (insee.pct_personnes_seules) stats.push({ icon: UserCheck, label: "% Personnes seules", value: formatPercent(insee.pct_personnes_seules), color: "#f59e0b" });
    } else if (isLogement) {
      stats.push({ icon: Home, label: "% Propriétaires", value: formatPercent(insee.pct_proprietaires), color: "#3b82f6" });
      if (insee.menages_total) stats.push({ icon: Users, label: "Ménages", value: formatNumber(insee.menages_total), color: "#6366f1" });
      if (insee.taille_moyenne_menage) stats.push({ icon: Baby, label: "Taille moyenne ménage", value: formatNumber(insee.taille_moyenne_menage, 1), color: "#8b5cf6" });
      if (insee.pct_moins_15) stats.push({ icon: Baby, label: "% Moins de 15 ans", value: formatPercent(insee.pct_moins_15), color: "#ec4899" });
      if (insee.pct_familles_monoparentales) stats.push({ icon: Users, label: "% Familles mono.", value: formatPercent(insee.pct_familles_monoparentales), color: "#f59e0b" });
      if (insee.pct_logements_vacants) stats.push({ icon: Building2, label: "% Logements vacants", value: formatPercent(insee.pct_logements_vacants), color: "#64748b" });
    } else if (isCommerce) {
      stats.push({ icon: PiggyBank, label: "Pouvoir d'achat", value: insee.revenu_median > 25000 ? "Élevé" : insee.revenu_median > 20000 ? "Moyen" : "Faible", color: insee.revenu_median > 25000 ? "#10b981" : "#f59e0b" });
      if (insee.pct_actifs) stats.push({ icon: Briefcase, label: "% Actifs", value: formatPercent(insee.pct_actifs), color: "#3b82f6" });
      if (insee.pct_30_44) stats.push({ icon: Users, label: "% 30-44 ans", value: formatPercent(insee.pct_30_44), color: "#6366f1" });
    } else if (isBureaux) {
      if (insee.pct_actifs) stats.unshift({ icon: Briefcase, label: "% Actifs", value: formatPercent(insee.pct_actifs), color: "#3b82f6", highlight: true, bgColor: "#dbeafe" });
      stats.push({ icon: Activity, label: "Bassin d'emploi", value: formatNumber(Math.round(insee.population * 0.45)), color: "#6366f1" });
      if (insee.pct_30_44) stats.push({ icon: Users, label: "% 30-44 ans", value: formatPercent(insee.pct_30_44), color: "#8b5cf6" });
    } else {
      stats.push({ icon: Home, label: "% Propriétaires", value: formatPercent(insee.pct_proprietaires), color: "#3b82f6" });
    }
    
    return stats;
  };

  const secondaryStats = getSecondaryStats();

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Users size={20} color="#6366f1" />
        Données Démographiques
        <span style={{ ...styles.badge, background: "#eef2ff", color: "#4f46e5", marginLeft: "auto" }}>
          {insee.commune_nom}
        </span>
        {isEhpadOrSenior && (
          <span style={{ ...styles.badge, background: "#fdf2f8", color: "#be185d" }}>
            Focus Seniors
          </span>
        )}
        {isEtudiant && (
          <span style={{ ...styles.badge, background: "#f5f3ff", color: "#7c3aed" }}>
            Focus Étudiants
          </span>
        )}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        {mainStats.map((stat, i) => (
          <div key={i} style={{
            background: stat.bg,
            borderRadius: "14px", padding: "16px", textAlign: "center"
          }}>
            <div style={{ fontSize: "11px", color: stat.color, fontWeight: 600, marginBottom: "4px" }}>{stat.label}</div>
            <div style={{ fontSize: stat.isText ? "16px" : "28px", fontWeight: stat.isText ? 700 : 800, color: stat.color }}>
              {stat.value}
            </div>
            {stat.unit && <div style={{ fontSize: "11px", color: stat.color }}>{stat.unit}</div>}
          </div>
        ))}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
        {secondaryStats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} style={{ 
              ...styles.statBox,
              background: stat.bgColor || "#f8fafc",
              border: stat.highlight ? `2px solid ${stat.color}30` : "none"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Icon size={16} color={stat.color} />
                <span style={{ fontSize: "13px", color: "#64748b" }}>{stat.label}</span>
              </div>
              <span style={{ fontSize: "15px", fontWeight: 700, color: stat.color }}>
                {stat.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// TRANSPORT CARD
// ============================================
const TransportCard: React.FC<{ transport: TransportData | null }> = ({ transport }) => {
  if (!transport) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <Train size={20} color="#8b5cf6" />
          Accessibilité Transport
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
          <Train size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p>Données transport non disponibles</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Train size={20} color="#8b5cf6" />
        Accessibilité Transport
        <span style={{ 
          ...styles.badge, 
          background: transport.score >= 70 ? "#dcfce7" : transport.score >= 50 ? "#fef3c7" : "#fee2e2",
          color: transport.score >= 70 ? "#166534" : transport.score >= 50 ? "#92400e" : "#991b1b",
          marginLeft: "auto" 
        }}>
          Score: {transport.score}/100
        </span>
      </div>
      
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
        {transport.has_metro_train && (
          <div style={{ 
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", background: "#eef2ff", borderRadius: "8px"
          }}>
            <Train size={16} color="#6366f1" />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#4338ca" }}>Métro / Train</span>
          </div>
        )}
        {transport.has_tram && (
          <div style={{ 
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", background: "#f0fdf4", borderRadius: "8px"
          }}>
            <Bus size={16} color="#16a34a" />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#15803d" }}>Tramway</span>
          </div>
        )}
        {!transport.has_metro_train && !transport.has_tram && (
          <div style={{ 
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", background: "#f1f5f9", borderRadius: "8px"
          }}>
            <Bus size={16} color="#64748b" />
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#64748b" }}>Bus uniquement</span>
          </div>
        )}
      </div>
      
      {transport.stops && transport.stops.length > 0 && (
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Arrêts les plus proches
          </div>
          {transport.stops.slice(0, 5).map((stop, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 0", borderBottom: i < transport.stops.length - 1 ? "1px solid #f1f5f9" : "none"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "32px", height: "32px", borderRadius: "8px",
                  background: stop.type === "metro" || stop.type === "train" ? "#eef2ff" : "#f0fdf4",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                  {stop.type === "metro" || stop.type === "train" ? <Train size={14} color="#6366f1" /> : <Bus size={14} color="#16a34a" />}
                </div>
                <span style={{ fontSize: "13px", color: "#1e293b" }}>{stop.name}</span>
              </div>
              <span style={{ 
                fontSize: "13px", fontWeight: 600,
                color: stop.distance_m < 500 ? "#10b981" : stop.distance_m < 1000 ? "#f59e0b" : "#64748b"
              }}>
                {stop.distance_m < 1000 ? `${stop.distance_m} m` : `${(stop.distance_m / 1000).toFixed(1)} km`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================
// BPE CARD - v2.4 LABELS COMPLETS
// ============================================
const BpeCard: React.FC<{ bpe: BpeData | null; projectType: string }> = ({ bpe, projectType }) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  if (!bpe) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <ShoppingCart size={20} color="#f59e0b" />
          Services & Équipements
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
          <ShoppingCart size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p>Données équipements non disponibles</p>
        </div>
      </div>
    );
  }

  const allCategories = [
    { key: "commerces", label: "Commerces", icon: ShoppingCart, color: "#f59e0b", data: bpe.commerces },
    { key: "sante", label: "Santé", icon: Stethoscope, color: "#ef4444", data: bpe.sante },
    { key: "services", label: "Services", icon: Banknote, color: "#3b82f6", data: bpe.services },
    { key: "education", label: "Éducation", icon: GraduationCap, color: "#8b5cf6", data: bpe.education },
    ...(bpe.loisirs ? [{ key: "loisirs", label: "Loisirs", icon: Theater, color: "#ec4899", data: bpe.loisirs }] : []),
    ...(bpe.sport ? [{ key: "sport", label: "Sport", icon: Dumbbell, color: "#10b981", data: bpe.sport }] : []),
  ];

  const isEhpadOrSenior = projectType === "ehpad";
  const isEtudiant = projectType === "residence_etudiante";
  const isCommerce = projectType === "commerce";

  let priorityCategories = [...allCategories];
  if (isEhpadOrSenior) {
    priorityCategories.sort((a, b) => {
      if (a.key === "sante") return -1;
      if (b.key === "sante") return 1;
      if (a.key === "commerces") return -1;
      if (b.key === "commerces") return 1;
      return 0;
    });
  } else if (isEtudiant) {
    priorityCategories.sort((a, b) => {
      if (a.key === "education") return -1;
      if (b.key === "education") return 1;
      if (a.key === "loisirs") return -1;
      if (b.key === "loisirs") return 1;
      return 0;
    });
  } else if (isCommerce) {
    priorityCategories.sort((a, b) => {
      if (a.key === "commerces") return -1;
      if (b.key === "commerces") return 1;
      return 0;
    });
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <ShoppingCart size={20} color="#f59e0b" />
        Services & Équipements
        <span style={{ 
          ...styles.badge, 
          background: bpe.score >= 70 ? "#dcfce7" : bpe.score >= 50 ? "#fef3c7" : "#fee2e2",
          color: bpe.score >= 70 ? "#166534" : bpe.score >= 50 ? "#92400e" : "#991b1b",
          marginLeft: "auto" 
        }}>
          Score: {bpe.score}/100
        </span>
        <span style={{ ...styles.badge, background: "#f1f5f9", color: "#64748b" }}>
          {bpe.total_equipements} équipements
        </span>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {priorityCategories.map((cat) => {
          const Icon = cat.icon;
          const isExpanded = expandedCategory === cat.key;
          const hasDetails = cat.data.details && cat.data.details.length > 0;
          
          return (
            <div key={cat.key} style={{ 
              padding: "16px", 
              background: "#f8fafc", 
              borderRadius: "12px",
              borderLeft: `4px solid ${cat.color}`,
              cursor: hasDetails ? "pointer" : "default"
            }}
            onClick={() => hasDetails && setExpandedCategory(isExpanded ? null : cat.key)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <Icon size={18} color={cat.color} />
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{cat.label}</span>
                <span style={{ 
                  marginLeft: "auto",
                  fontSize: "20px", fontWeight: 700, color: cat.color 
                }}>
                  {cat.data.count}
                </span>
                {hasDetails && (
                  isExpanded ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />
                )}
              </div>
              
              {/* v2.4: Labels complets sans troncature */}
              {cat.data.details && cat.data.details.length > 0 && (
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  {cat.data.details.slice(0, isExpanded ? 10 : 2).map((d, i) => (
                    <div key={i} style={{ 
                      display: "flex", 
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "6px", 
                      padding: "4px 0",
                      gap: "8px"
                    }}>
                      <span style={{ 
                        flex: 1,
                        wordBreak: "break-word",
                        lineHeight: 1.3
                      }}>
                        {d.label}
                      </span>
                      <span style={{ 
                        fontWeight: 600, 
                        color: d.distance_m < 500 ? "#10b981" : "#64748b",
                        whiteSpace: "nowrap",
                        flexShrink: 0
                      }}>
                        {d.distance_m < 1000 ? `${d.distance_m}m` : `${(d.distance_m / 1000).toFixed(1)}km`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Bouton voir plus si > 2 */}
              {hasDetails && cat.data.details.length > 2 && !isExpanded && (
                <div style={{ 
                  fontSize: "11px", 
                  color: cat.color, 
                  marginTop: "8px",
                  fontWeight: 500
                }}>
                  + {cat.data.details.length - 2} autres...
                </div>
              )}
              
              {(!cat.data.details || cat.data.details.length === 0) && cat.data.count === 0 && (
                <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>
                  Aucun équipement trouvé
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// EHPAD PRICING CARD
// ============================================
const EhpadPricingCard: React.FC<{ 
  analysePrix: AnalysePrix | null;
  concurrence: EhpadConcurrence;
}> = ({ analysePrix, concurrence }) => {
  if (!analysePrix || !analysePrix.nb_etablissements_avec_prix) {
    return null;
  }

  const getInterpretationColor = (interpretation: string | null) => {
    if (!interpretation) return { bg: "#f1f5f9", color: "#64748b" };
    if (interpretation.includes("compétitif") || interpretation.includes("bas")) {
      return { bg: "#dcfce7", color: "#166534" };
    }
    if (interpretation.includes("élevé")) {
      return { bg: "#fee2e2", color: "#991b1b" };
    }
    return { bg: "#fef3c7", color: "#92400e" };
  };

  const interpColor = getInterpretationColor(analysePrix.interpretation);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <BadgeEuro size={20} color="#10b981" />
        Tarifs EHPAD - Département
        <span style={{ 
          ...styles.badge, 
          background: "#dcfce7", 
          color: "#166534", 
          marginLeft: "auto" 
        }}>
          {analysePrix.nb_etablissements_avec_prix} EHPAD avec tarifs
        </span>
        <span style={{ 
          ...styles.badge, 
          background: interpColor.bg, 
          color: interpColor.color 
        }}>
          {analysePrix.interpretation || "—"}
        </span>
      </div>

      <div style={{
        background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
        borderRadius: "14px", padding: "24px", textAlign: "center", marginBottom: "20px"
      }}>
        <div style={{ fontSize: "13px", color: "#059669", fontWeight: 600, marginBottom: "8px" }}>
          PRIX HÉBERGEMENT MÉDIAN
        </div>
        <div style={{ fontSize: "48px", fontWeight: 800, color: "#047857" }}>
          {analysePrix.prix_hebergement_median?.toFixed(0) ?? "—"} €
        </div>
        <div style={{ fontSize: "14px", color: "#059669" }}>par jour</div>
        
        {analysePrix.cout_mensuel_moyen_gir_1_2 && (
          <div style={{ 
            marginTop: "16px", padding: "12px 20px",
            background: "rgba(255,255,255,0.7)", borderRadius: "10px",
            display: "inline-block"
          }}>
            <div style={{ fontSize: "11px", color: "#065f46", marginBottom: "4px" }}>
              Coût mensuel moyen (GIR 1-2)
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#047857" }}>
              {formatNumber(analysePrix.cout_mensuel_moyen_gir_1_2)} €/mois
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "24px" }}>
        {[
          { label: "Min", value: analysePrix.prix_hebergement_min, color: "#3b82f6" },
          { label: "Médian", value: analysePrix.prix_hebergement_median, color: "#10b981" },
          { label: "Moyen", value: analysePrix.prix_hebergement_moyen, color: "#8b5cf6" },
          { label: "Max", value: analysePrix.prix_hebergement_max, color: "#ef4444" },
        ].map((item, i) => (
          <div key={i} style={{ textAlign: "center", padding: "14px", background: "#f8fafc", borderRadius: "10px" }}>
            <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 500, marginBottom: "4px" }}>{item.label}</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: item.color }}>
              {item.value?.toFixed(2) ?? "—"} €
            </div>
            <div style={{ fontSize: "10px", color: "#94a3b8" }}>par jour</div>
          </div>
        ))}
      </div>

      <div style={{ 
        background: "#fdf2f8", 
        borderRadius: "12px", 
        padding: "20px",
        borderLeft: "4px solid #ec4899"
      }}>
        <div style={{ 
          display: "flex", alignItems: "center", gap: "8px", 
          marginBottom: "16px" 
        }}>
          <Heart size={18} color="#ec4899" />
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#9d174d" }}>
            Tarifs dépendance moyens (GIR)
          </span>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {[
            { label: "GIR 1-2", desc: "Dépendance forte", value: analysePrix.tarif_gir_1_2_moyen },
            { label: "GIR 3-4", desc: "Dépendance modérée", value: analysePrix.tarif_gir_3_4_moyen },
            { label: "GIR 5-6", desc: "Autonomie relative", value: analysePrix.tarif_gir_5_6_moyen },
          ].map((gir, i) => (
            <div key={i} style={{ 
              background: "white", borderRadius: "10px", padding: "14px", textAlign: "center",
              border: "1px solid #fbcfe8"
            }}>
              <div style={{ fontSize: "11px", color: "#be185d", fontWeight: 600, marginBottom: "4px" }}>
                {gir.label}
              </div>
              <div style={{ fontSize: "10px", color: "#9d174d", marginBottom: "8px" }}>
                {gir.desc}
              </div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#be185d" }}>
                {gir.value?.toFixed(2) ?? "—"} €
              </div>
              <div style={{ fontSize: "10px", color: "#9d174d" }}>par jour</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ 
        marginTop: "16px", padding: "10px 14px", 
        background: "#f8fafc", borderRadius: "8px",
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <span style={{ fontSize: "11px", color: "#64748b" }}>
          Source: CNSA / data.gouv.fr
        </span>
        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
          Tarifs 2025
        </span>
      </div>
    </div>
  );
};

// ============================================
// EHPAD COMPETITION CARD - AVEC LISTE DÉTAILLÉE
// ============================================
const EhpadCompetitionCard: React.FC<{ specific: EhpadSpecific }> = ({ specific }) => {
  const [showList, setShowList] = useState(true);
  
  const { concurrence, demographie_senior, indicateurs_marche } = specific;
  const { etablissements, count, total_lits, sources } = concurrence;

  const getPotentielColor = (potentiel: string) => {
    switch (potentiel) {
      case "fort": return { bg: "#dcfce7", color: "#166534" };
      case "faible": return { bg: "#fee2e2", color: "#991b1b" };
      default: return { bg: "#fef3c7", color: "#92400e" };
    }
  };

  const getEquipementLabel = (taux: string) => {
    switch (taux) {
      case "sous_equipe": return "Zone sous-équipée";
      case "sur_equipe": return "Zone sur-équipée";
      default: return "Zone équilibrée";
    }
  };

  const potentielColor = getPotentielColor(indicateurs_marche.potentiel_marche);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Building size={20} color="#ec4899" />
        Concurrence EHPAD - Zone d'analyse
        <span style={{ ...styles.badge, background: "#fdf2f8", color: "#be185d", marginLeft: "auto" }}>
          {count} établissement{count > 1 ? 's' : ''}
        </span>
        <span style={{ ...styles.badge, background: potentielColor.bg, color: potentielColor.color }}>
          Potentiel {indicateurs_marche.potentiel_marche}
        </span>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "16px", background: "#fdf2f8", borderRadius: "12px", textAlign: "center" }}>
          <Building size={20} color="#be185d" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#be185d" }}>{count}</div>
          <div style={{ fontSize: "11px", color: "#9d174d" }}>EHPAD zone</div>
        </div>
        
        <div style={{ padding: "16px", background: "#f8fafc", borderRadius: "12px", textAlign: "center" }}>
          <Bed size={20} color="#1e293b" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#1e293b" }}>
            {formatNumber(total_lits)}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>Lits totaux</div>
        </div>
        
        <div style={{ padding: "16px", background: "#eef2ff", borderRadius: "12px", textAlign: "center" }}>
          <Users size={20} color="#4338ca" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#4338ca" }}>
            {formatNumber(demographie_senior.population_75_plus)}
          </div>
          <div style={{ fontSize: "11px", color: "#6366f1" }}>Pop. 75+ ans</div>
        </div>
        
        <div style={{ padding: "16px", background: "#f0fdf4", borderRadius: "12px", textAlign: "center" }}>
          <Activity size={20} color="#15803d" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#15803d" }}>
            {indicateurs_marche.densite_lits_1000_seniors ?? "—"}
          </div>
          <div style={{ fontSize: "11px", color: "#16a34a" }}>Lits/1000 seniors</div>
        </div>
      </div>
      
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: "12px", marginBottom: "20px"
      }}>
        <div style={{
          padding: "14px 18px", background: "#f8fafc", borderRadius: "10px",
          borderLeft: `4px solid ${indicateurs_marche.taux_equipement_zone === "sous_equipe" ? "#10b981" : indicateurs_marche.taux_equipement_zone === "sur_equipe" ? "#ef4444" : "#f59e0b"}`
        }}>
          <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>Taux d'équipement</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b" }}>
            {getEquipementLabel(indicateurs_marche.taux_equipement_zone)}
          </div>
        </div>
        
        <div style={{
          padding: "14px 18px", background: potentielColor.bg, borderRadius: "10px",
          borderLeft: `4px solid ${potentielColor.color}`
        }}>
          <div style={{ fontSize: "11px", color: potentielColor.color, marginBottom: "4px" }}>Potentiel marché</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: potentielColor.color, textTransform: "capitalize" }}>
            {indicateurs_marche.potentiel_marche}
          </div>
        </div>
      </div>

      {etablissements && etablissements.length > 0 && (
        <div>
          <button
            onClick={() => setShowList(!showList)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", padding: "14px 16px", background: "#fdf2f8",
              border: "1px solid #fbcfe8", borderRadius: "10px", cursor: "pointer",
              marginBottom: showList ? "12px" : "0"
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#be185d" }}>
              📋 Liste des {etablissements.length} établissements FINESS
            </span>
            {showList ? <ChevronUp size={18} color="#be185d" /> : <ChevronDown size={18} color="#be185d" />}
          </button>

          {showList && (
            <div style={{ 
              maxHeight: "500px", overflowY: "auto",
              border: "1px solid #e2e8f0", borderRadius: "10px"
            }}>
              <div style={{
                display: "grid", 
                gridTemplateColumns: "2fr 80px 80px 100px",
                gap: "12px", padding: "12px 16px",
                background: "#f8fafc", borderBottom: "2px solid #e2e8f0",
                position: "sticky", top: 0,
                fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase"
              }}>
                <span>Établissement</span>
                <span style={{ textAlign: "center" }}>Distance</span>
                <span style={{ textAlign: "center" }}>Capacité</span>
                <span style={{ textAlign: "center" }}>Prix/jour</span>
              </div>
              
              {etablissements.map((etab, i) => (
                <div key={i} style={{
                  display: "grid", 
                  gridTemplateColumns: "2fr 80px 80px 100px",
                  gap: "12px", padding: "14px 16px",
                  alignItems: "center",
                  background: i % 2 === 0 ? "white" : "#f8fafc",
                  borderBottom: "1px solid #f1f5f9"
                }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>
                      {etab.nom}
                    </div>
                    {etab.finess && (
                      <span style={{ 
                        fontSize: "10px", color: "#94a3b8", fontFamily: "monospace",
                        background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px"
                      }}>
                        FINESS: {etab.finess}
                      </span>
                    )}
                  </div>
                  
                  <div style={{ textAlign: "center" }}>
                    <span style={{ 
                      fontSize: "14px", fontWeight: 600,
                      color: etab.distance_m < 5000 ? "#10b981" : etab.distance_m < 10000 ? "#f59e0b" : "#64748b"
                    }}>
                      {(etab.distance_m / 1000).toFixed(1)} km
                    </span>
                  </div>
                  
                  <div style={{ textAlign: "center" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "#ec4899" }}>
                      {etab.capacite}
                    </span>
                    <span style={{ fontSize: "10px", color: "#9d174d", display: "block" }}>
                      {etab.capacite_estimee ? "lits (est.)" : "lits"}
                    </span>
                  </div>
                  
                  <div style={{ textAlign: "center" }}>
                    {etab.tarifs?.hebergement_jour ? (
                      <>
                        <span style={{ fontSize: "16px", fontWeight: 700, color: "#10b981" }}>
                          {etab.tarifs.hebergement_jour.toFixed(0)} €
                        </span>
                        <span style={{ fontSize: "10px", color: "#059669", display: "block" }}>
                          par jour
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: "12px", color: "#94a3b8" }}>—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ 
        display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap"
      }}>
        <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>
          <CheckCircle size={12} /> CNSA: {sources.cnsa_tarifs} EHPAD
        </span>
        <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>
          <MapPin size={12} /> OSM: {sources.overpass} établissements
        </span>
      </div>
    </div>
  );
};

// ============================================
// SCORE ADJUSTMENTS CARD - v2.4
// ============================================
const ScoreAdjustmentsCard: React.FC<{
  adjustments: { label: string; value: number }[];
  explanation: string;
  projectType: string;
}> = ({ adjustments, explanation, projectType }) => {
  if (adjustments.length === 0) return null;

  return (
    <div style={{ ...styles.card, background: "#f8fafc", marginBottom: "24px" }}>
      <div style={styles.cardTitle}>
        <Activity size={20} color="#6366f1" />
        Analyse spécifique - {projectType}
        <span style={{ ...styles.badge, background: "#eef2ff", color: "#4f46e5", marginLeft: "auto" }}>
          Scoring différencié
        </span>
      </div>
      
      <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "16px" }}>
        {explanation}
      </p>
      
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {adjustments.map((adj, i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              background: adj.value > 0 ? "#dcfce7" : "#fee2e2",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 500,
              color: adj.value > 0 ? "#166534" : "#991b1b",
            }}
          >
            {adj.label} ({adj.value > 0 ? "+" : ""}{adj.value})
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// MARKET STUDY RESULTS - v2.4
// ============================================
const MarketStudyResults: React.FC<{ data: MarketStudyApiResponse }> = ({ data }) => {
  const { meta, core, insights, specific } = data;
  const projectConfig = getSafeProjectConfig(meta.project_type as ProjectType);
  
  const isEhpad = meta.project_type === "ehpad";
  const ehpadSpecific = isEhpad ? (specific as EhpadSpecific) : null;
  
  // v2.4: Calculer les scores différenciés
  const { scores, adjustments, explanation } = useMemo(
    () => calculateDifferentiatedScores(data, meta.project_type),
    [data, meta.project_type]
  );
  
  const positiveInsights = insights.filter(i => i.type === "positive");
  const warningInsights = insights.filter(i => i.type === "warning" || i.type === "negative");
  const neutralInsights = insights.filter(i => i.type === "neutral");

  // PDF Handler
  const handleGeneratePdf = useCallback(() => {
    const verdict = getVerdictConfig(scores.global);
    const scoreColor = getScoreColor(scores.global);
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Veuillez autoriser les popups pour générer le PDF');
      return;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Étude de Marché - ${meta.commune_nom}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
    .header { background: linear-gradient(135deg, #1e293b 0%, #4f46e5 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.8; font-size: 14px; }
    .score-section { display: flex; align-items: center; gap: 30px; margin: 20px 0; }
    .score-circle { width: 100px; height: 100px; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center; flex-direction: column; }
    .score-value { font-size: 36px; font-weight: 800; color: ${scoreColor}; }
    .score-label { font-size: 10px; color: #64748b; }
    .verdict { display: inline-block; padding: 8px 16px; background: ${verdict.bg}; color: ${verdict.color}; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .section { background: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 20px; page-break-inside: avoid; }
    .section-title { font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .stat-box { background: white; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 700; }
    .insight { padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
    .insight-positive { background: #ecfdf5; border-left: 4px solid #10b981; }
    .insight-warning { background: #fef3c7; border-left: 4px solid #f59e0b; }
    .insight-negative { background: #fee2e2; border-left: 4px solid #ef4444; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } .section { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 Étude de Marché - ${meta.commune_nom}</h1>
    <p>${meta.project_type_label} • ${meta.departement} • Rayon ${meta.radius_km} km • v${data.version}</p>
    <div class="score-section">
      <div class="score-circle">
        <div class="score-value">${scores.global}</div>
        <div class="score-label">/100</div>
      </div>
      <div>
        <div class="verdict">${verdict.label}</div>
        <p style="margin-top: 8px; font-size: 13px;">Score global d'opportunité (scoring ${meta.project_type})</p>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">📈 Sous-scores (pondérés ${meta.project_type})</div>
    <div class="grid-4">
      <div class="stat-box">
        <div class="stat-label">Demande</div>
        <div class="stat-value" style="color: ${getScoreColor(scores.demande)}">${scores.demande}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Offre</div>
        <div class="stat-value" style="color: ${getScoreColor(scores.offre)}">${scores.offre}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Accessibilité</div>
        <div class="stat-value" style="color: ${getScoreColor(scores.accessibilite)}">${scores.accessibilite}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Environnement</div>
        <div class="stat-value" style="color: ${getScoreColor(scores.environnement)}">${scores.environnement}</div>
      </div>
    </div>
  </div>

  ${adjustments.length > 0 ? `
  <div class="section">
    <div class="section-title">🎯 Facteurs d'ajustement</div>
    <p style="font-size: 12px; color: #64748b; margin-bottom: 12px;">${explanation}</p>
    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
      ${adjustments.map(adj => `
        <span style="padding: 6px 12px; background: ${adj.value > 0 ? '#dcfce7' : '#fee2e2'}; border-radius: 6px; font-size: 12px; color: ${adj.value > 0 ? '#166534' : '#991b1b'};">
          ${adj.label} (${adj.value > 0 ? '+' : ''}${adj.value})
        </span>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">💰 Marché Immobilier (DVF)</div>
    <div class="grid-4">
      <div class="stat-box"><div class="stat-label">Transactions</div><div class="stat-value" style="color: #6366f1">${core.dvf?.nb_transactions ?? '—'}</div></div>
      <div class="stat-box"><div class="stat-label">Prix médian</div><div class="stat-value" style="color: #10b981">${core.dvf?.prix_m2_median ? formatNumber(core.dvf.prix_m2_median) + ' €' : '—'}</div></div>
      <div class="stat-box"><div class="stat-label">Prix min</div><div class="stat-value" style="color: #3b82f6">${core.dvf?.prix_m2_min ? formatNumber(core.dvf.prix_m2_min) + ' €' : '—'}</div></div>
      <div class="stat-box"><div class="stat-label">Prix max</div><div class="stat-value" style="color: #ef4444">${core.dvf?.prix_m2_max ? formatNumber(core.dvf.prix_m2_max) + ' €' : '—'}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">👥 Démographie (INSEE)</div>
    <div class="grid">
      <div class="stat-box"><div class="stat-label">Population</div><div class="stat-value" style="color: #4338ca">${formatNumber(core.insee?.population)}</div></div>
      <div class="stat-box"><div class="stat-label">Densité</div><div class="stat-value" style="color: #15803d">${formatNumber(core.insee?.densite)} hab/km²</div></div>
      <div class="stat-box"><div class="stat-label">Revenu médian</div><div class="stat-value" style="color: #10b981">${formatPrice(core.insee?.revenu_median)}</div></div>
      <div class="stat-box"><div class="stat-label">Taux chômage</div><div class="stat-value" style="color: #f59e0b">${formatPercent(core.insee?.taux_chomage)}</div></div>
    </div>
  </div>

  ${positiveInsights.length > 0 ? `
  <div class="section">
    <div class="section-title">✅ Points forts</div>
    ${positiveInsights.map(i => `<div class="insight insight-positive">${i.message}</div>`).join('')}
  </div>
  ` : ''}

  ${warningInsights.length > 0 ? `
  <div class="section">
    <div class="section-title">⚠️ Points de vigilance</div>
    ${warningInsights.map(i => `<div class="insight ${i.type === 'negative' ? 'insight-negative' : 'insight-warning'}">${i.message}</div>`).join('')}
  </div>
  ` : ''}

  <div class="footer">
    <p>Rapport généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    <p>Mimmoza - Plateforme d'analyse immobilière intelligente</p>
  </div>
</body>
</html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => { printWindow.print(); }, 250);
    };
  }, [data, meta, scores, adjustments, explanation, core, positiveInsights, warningInsights]);

  return (
    <ErrorBoundary componentName="MarketStudyResults">
      <div>
        {/* Header avec score */}
        <div style={{
          background: `linear-gradient(135deg, #1e293b 0%, ${projectConfig.color}90 50%, #1e293b 100%)`,
          borderRadius: "20px", padding: "32px", marginBottom: "24px", color: "white"
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "32px", alignItems: "center" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ScoreGauge score={scores.global} size={160} />
            </div>
            
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <SafeIcon icon={projectConfig.icon} fallback={Building2} size={24} />
                <h2 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>
                  {meta.commune_nom}
                  <span style={{ fontSize: "16px", fontWeight: 400, opacity: 0.7, marginLeft: "8px" }}>
                    ({meta.departement})
                  </span>
                </h2>
              </div>
              <p style={{ fontSize: "14px", opacity: 0.8, marginBottom: "16px" }}>
                {meta.project_type_label} • Rayon {meta.radius_km} km • v{data.version}
              </p>
              
              <div style={{ marginBottom: "16px" }}>
                <DataSourcesBadges 
                  dvf={core.dvf?.coverage === "ok"} 
                  insee={core.insee?.coverage === "ok"}
                  transport={core.transport?.coverage === "ok"}
                  bpe={core.bpe?.coverage === "ok"}
                  cnsa={isEhpad ? ehpadSpecific?.concurrence?.sources?.cnsa_tarifs : undefined}
                />
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Population</div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>{formatNumber(core.insee?.population)}</div>
                </div>
                {isEhpad && ehpadSpecific?.analyse_prix?.prix_hebergement_median ? (
                  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Prix médian/jour</div>
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>
                      {ehpadSpecific.analyse_prix.prix_hebergement_median.toFixed(0)}€
                    </div>
                  </div>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Prix m² médian</div>
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>
                      {core.dvf?.prix_m2_median ? `${formatNumber(core.dvf.prix_m2_median)}€` : "—"}
                    </div>
                  </div>
                )}
                {isEhpad ? (
                  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>EHPAD département</div>
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>
                      {ehpadSpecific?.concurrence?.nb_ehpad_departement ?? "—"}
                    </div>
                  </div>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Transactions DVF</div>
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>{core.dvf?.nb_transactions ?? "—"}</div>
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px", opacity: 0.9 }}>
                Sous-scores ({meta.project_type})
              </div>
              {[
                { label: "Demande", score: scores.demande },
                { label: "Offre", score: scores.offre },
                { label: "Accessibilité", score: scores.accessibilite },
                { label: "Environnement", score: scores.environnement },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "12px", opacity: 0.8, width: "90px" }}>{item.label}</span>
                  <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.2)", borderRadius: "3px" }}>
                    <div style={{
                      width: `${item.score ?? 0}%`, height: "100%",
                      background: getScoreColor(item.score), borderRadius: "3px"
                    }} />
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, width: "28px" }}>{item.score ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Score Adjustments Card */}
        <ScoreAdjustmentsCard 
          adjustments={adjustments} 
          explanation={explanation}
          projectType={meta.project_type_label}
        />
        
        {/* Carte + Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div style={{ ...styles.card, padding: 0, overflow: "hidden" }}>
            <div style={{ height: "380px" }}>
              <MapWithMarkers 
                lat={meta.lat} 
                lon={meta.lon} 
                radius={meta.radius_km * 1000}
                commune={meta.commune_nom}
              />
            </div>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>
                <CheckCircle size={20} color="#10b981" />
                Points forts ({positiveInsights.length})
              </div>
              {positiveInsights.length > 0 ? (
                positiveInsights.map((insight, i) => (
                  <InsightCard key={i} type={insight.type} category={insight.category} message={insight.message} />
                ))
              ) : (
                <p style={{ fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>Aucun point fort identifié</p>
              )}
            </div>
            
            <div style={styles.card}>
              <div style={styles.cardTitle}>
                <AlertTriangle size={20} color="#f59e0b" />
                Points de vigilance ({warningInsights.length})
              </div>
              {warningInsights.length > 0 ? (
                warningInsights.map((insight, i) => (
                  <InsightCard key={i} type={insight.type} category={insight.category} message={insight.message} />
                ))
              ) : (
                <p style={{ fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>Aucune alerte</p>
              )}
            </div>
          </div>
        </div>
        
        {/* EHPAD Pricing */}
        {isEhpad && ehpadSpecific?.analyse_prix && (
          <div style={{ marginBottom: "24px" }}>
            <EhpadPricingCard 
              analysePrix={ehpadSpecific.analyse_prix} 
              concurrence={ehpadSpecific.concurrence}
            />
          </div>
        )}
        
        {/* EHPAD Competition */}
        {isEhpad && ehpadSpecific && (
          <div style={{ marginBottom: "24px" }}>
            <EhpadCompetitionCard specific={ehpadSpecific} />
          </div>
        )}
        
        {/* Grille principale */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <DvfCard dvf={core.dvf} />
          <DemographieCard 
            insee={core.insee} 
            projectType={meta.project_type} 
            ehpadSpecific={ehpadSpecific}
          />
        </div>
        
        {/* Transport + BPE */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "minmax(280px, 1fr) minmax(400px, 2fr)", 
          gap: "24px", 
          marginBottom: "24px" 
        }}>
          <TransportCard transport={core.transport} />
          <BpeCard bpe={core.bpe} projectType={meta.project_type} />
        </div>
        
        {/* Infos neutres */}
        {neutralInsights.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "24px" }}>
            <div style={styles.cardTitle}>
              <FileText size={20} color="#64748b" />
              Informations complémentaires
            </div>
            {neutralInsights.map((insight, i) => (
              <InsightCard key={i} type={insight.type} category={insight.category} message={insight.message} />
            ))}
          </div>
        )}
        
        {/* Debug timing */}
        {data.debug?.timings && DEBUG_MODE && (
          <div style={{ ...styles.card, background: "#f8fafc" }}>
            <div style={styles.cardTitle}>
              <Activity size={20} color="#64748b" />
              Debug - Timings (ms)
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {Object.entries(data.debug.timings).map(([key, value]) => (
                <div key={key} style={{ 
                  padding: "8px 14px", background: "white", borderRadius: "8px",
                  border: "1px solid #e2e8f0"
                }}>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{key}: </span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: value > 1000 ? "#ef4444" : "#10b981" }}>
                    {value}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "32px" }}>
          <button 
            onClick={handleGeneratePdf}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px", background: "#1e293b", color: "white",
              border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            <FileText size={18} />
            Générer le rapport PDF
          </button>
          <button 
            onClick={() => {
              const exportData = { ...data, scores };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `etude-marche-${meta.commune_nom}-${meta.project_type}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px", background: "#f1f5f9", color: "#475569",
              border: "1px solid #e2e8f0", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            <Download size={18} />
            Exporter JSON
          </button>
        </div>
      </div>
    </ErrorBoundary>
  );
};

// ============================================
// COMPOSANT PRINCIPAL - MarchePage
// ============================================
export function MarchePage() {
  const [address, setAddress] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [parcelId, setParcelId] = useState("");
  const [parcelInfo, setParcelInfo] = useState<ParcelInfo | null>(null);
  const [isSearchingParcel, setIsSearchingParcel] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [codeInsee, setCodeInsee] = useState("");
  const [radius, setRadius] = useState(5);
  const [projectNature, setProjectNature] = useState<ProjectType>("logement");
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<MarketStudyApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parcelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const projectConfig = useMemo(() => getSafeProjectConfig(projectNature), [projectNature]);

  useEffect(() => {
    if (addressTimeoutRef.current) clearTimeout(addressTimeoutRef.current);
    if (address.length >= 3 && !selectedAddress) {
      setIsSearchingAddress(true);
      addressTimeoutRef.current = setTimeout(async () => {
        const suggestions = await searchAddress(address);
        setAddressSuggestions(suggestions);
        setIsSearchingAddress(false);
      }, 300);
    } else {
      setAddressSuggestions([]);
      setIsSearchingAddress(false);
    }
    return () => { if (addressTimeoutRef.current) clearTimeout(addressTimeoutRef.current); };
  }, [address, selectedAddress]);

  useEffect(() => {
    if (parcelTimeoutRef.current) clearTimeout(parcelTimeoutRef.current);
    if (parcelId.length >= 10) {
      setIsSearchingParcel(true);
      parcelTimeoutRef.current = setTimeout(async () => {
        const info = await searchParcel(parcelId);
        setParcelInfo(info);
        setIsSearchingParcel(false);
        if (info?.lat && info?.lon) {
          setLatitude(info.lat.toFixed(6));
          setLongitude(info.lon.toFixed(6));
        }
        if (info?.commune_insee) setCodeInsee(info.commune_insee);
      }, 500);
    } else {
      setParcelInfo(null);
      setIsSearchingParcel(false);
    }
    return () => { if (parcelTimeoutRef.current) clearTimeout(parcelTimeoutRef.current); };
  }, [parcelId]);

  useEffect(() => {
    setRadius(projectConfig.radius.analysis);
  }, [projectConfig]);

  const handleSelectAddress = useCallback((suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setAddress(suggestion.label);
    setAddressSuggestions([]);
    setLatitude(suggestion.lat.toFixed(6));
    setLongitude(suggestion.lon.toFixed(6));
    if (suggestion.citycode) setCodeInsee(suggestion.citycode);
  }, []);

  const handleSubmit = useCallback(async () => {
    const hasLocation = (latitude && longitude) || codeInsee || parcelInfo;
    if (!hasLocation) {
      setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE).");
      return;
    }

    log('🚀', 'Starting analysis', { latitude, longitude, codeInsee, radius, projectNature });

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);

    const lat = latitude ? parseFloat(latitude) : NaN;
    const lon = longitude ? parseFloat(longitude) : NaN;

    try {
      const payload: Record<string, unknown> = {
        project_type: projectNature,
        radius_km: radius,
        debug: true,
      };

      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        payload.lat = lat;
        payload.lon = lon;
      }
      if (codeInsee) payload.commune_insee = codeInsee;

      log('📡', 'Payload', payload);

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error("Configuration Supabase manquante");
      }
      
      const apiResponse = await fetch(`${SUPABASE_URL}/functions/v1/market-study-promoteur-v1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await apiResponse.json();

      log('📡', 'API Response', {
        ok: apiResponse.ok,
        success: result?.success,
        version: result?.version,
        score: result?.scores?.global,
      });

      if (!apiResponse.ok || !result.success) {
        throw new Error(result.error || `Erreur ${apiResponse.status}`);
      }

      setAnalysisResult(result as MarketStudyApiResponse);

      try {
        patchProjectInfo({
          address: selectedAddress?.label || address || undefined,
          city: result?.meta?.commune_nom || undefined,
          projectType: projectNature,
          lat: result?.meta?.lat,
          lon: result?.meta?.lon,
        });

        patchModule("market", {
          ok: true,
          summary: `Score: ${result?.scores?.global}/100 - ${result?.meta?.commune_nom}`,
          data: result,
        });

        log('💾', 'Snapshot saved');
      } catch (snapshotErr) {
        log('❌', 'Snapshot error', snapshotErr);
      }

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Une erreur est survenue";
      log('❌', 'Submit error', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, codeInsee, parcelInfo, radius, projectNature, selectedAddress, address]);

  return (
    <ErrorBoundary componentName="MarchePage">
      <div style={styles.container}>
        {/* Header */}
        <div style={{
          ...styles.header,
          background: `linear-gradient(135deg, #1e293b 0%, ${projectConfig.color}80 50%, #1e293b 100%)`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <SafeIcon icon={projectConfig.icon} fallback={Building2} size={28} />
            <h1 style={{ fontSize: "28px", fontWeight: 700, margin: 0 }}>Étude de Marché</h1>
            <span style={{
              padding: "4px 12px",
              background: "rgba(255,255,255,0.2)",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
            }}>
              {projectConfig.label}
            </span>
            <span style={{
              padding: "4px 10px",
              background: "#dcfce7",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#166534",
            }}>
              v2.4 • Scoring différencié
            </span>
          </div>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", maxWidth: "700px", margin: 0 }}>
            {projectConfig.description}. Scoring adapté au type de projet avec bonus/pénalités contextuels.
          </p>
        </div>

        {/* Contenu principal */}
        <div style={styles.mainContent}>
          {/* Formulaire */}
          <div style={styles.formSection}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px",
                background: `linear-gradient(135deg, ${projectConfig.color} 0%, ${projectConfig.color}cc 100%)`,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <Target size={22} color="white" />
              </div>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Paramètres de l'analyse
                </h2>
                <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                  Renseignez la localisation et les caractéristiques de votre projet
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
              {/* Adresse */}
              <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <MapPin size={14} color={projectConfig.color} />
                  Adresse
                  <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", background: "#dbeafe", color: "#1d4ed8", borderRadius: "4px", marginLeft: "8px" }}>
                    RECOMMANDÉ
                  </span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Ex: 12 rue de la République, Lyon"
                    value={address}
                    onChange={(e) => { setAddress(e.target.value); if (selectedAddress) setSelectedAddress(null); }}
                    style={{ ...styles.input, paddingRight: "40px" }}
                  />
                  {isSearchingAddress && (
                    <Loader2 size={18} color={projectConfig.color} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", animation: "spin 1s linear infinite" }} />
                  )}
                  {address && !isSearchingAddress && (
                    <button onClick={() => { setAddress(""); setSelectedAddress(null); }} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                      <X size={16} color="#94a3b8" />
                    </button>
                  )}
                  {addressSuggestions.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100,
                      maxHeight: "220px", overflowY: "auto", marginTop: "4px"
                    }}>
                      {addressSuggestions.map((s, i) => (
                        <div 
                          key={i} 
                          onClick={() => handleSelectAddress(s)} 
                          style={{
                            padding: "12px 14px", cursor: "pointer", fontSize: "13px", color: "#1e293b",
                            display: "flex", alignItems: "center", gap: "10px",
                            borderBottom: "1px solid #f1f5f9", transition: "background 0.15s"
                          }}
                          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#f8fafc"; }}
                          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                        >
                          <MapPin size={14} color="#64748b" />
                          {s.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedAddress && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#ecfdf5", borderRadius: "8px" }}>
                    <CheckCircle size={16} color="#10b981" />
                    <span style={{ fontSize: "13px", color: "#065f46" }}>
                      {selectedAddress.lat.toFixed(5)}, {selectedAddress.lon.toFixed(5)}
                      {selectedAddress.citycode && ` • INSEE: ${selectedAddress.citycode}`}
                    </span>
                  </div>
                )}
              </div>

              {/* Parcelle */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Grid3X3 size={14} color={projectConfig.color} />
                  N° Parcelle cadastrale
                </label>
                <input
                  type="text"
                  placeholder="Ex: 69123000AI0001"
                  value={parcelId}
                  onChange={(e) => setParcelId(e.target.value)}
                  style={styles.input}
                />
              </div>

              {/* Coordonnées */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Latitude</label>
                <input type="text" placeholder="45.764" value={latitude} onChange={(e) => setLatitude(e.target.value)} style={styles.input} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Longitude</label>
                <input type="text" placeholder="4.8357" value={longitude} onChange={(e) => setLongitude(e.target.value)} style={styles.input} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Code INSEE</label>
                <input type="text" placeholder="69123" value={codeInsee} onChange={(e) => setCodeInsee(e.target.value)} style={styles.input} />
              </div>

              {/* Nature projet - v2.4: Fusion EHPAD/Résidence senior */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Building2 size={14} color={projectConfig.color} />
                  Nature du projet
                </label>
                <select 
                  value={projectNature} 
                  onChange={(e) => setProjectNature(e.target.value as ProjectType)} 
                  style={styles.select}
                >
                  <option value="logement">🏠 Logement</option>
                  <option value="ehpad">❤️ EHPAD / Résidence senior</option>
                  <option value="residence_etudiante">🎓 Résidence étudiante</option>
                  <option value="bureaux">💼 Bureaux</option>
                  <option value="commerce">🛒 Commerce</option>
                  <option value="hotel">🏨 Hôtel</option>
                </select>
              </div>

              {/* Rayon */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Compass size={14} color={projectConfig.color} />
                  Rayon: <strong style={{ color: projectConfig.color }}>{radius} km</strong>
                </label>
                <input
                  type="range" min={1} max={30} step={1} value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  style={{ width: "100%", marginTop: "8px", accentColor: projectConfig.color }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
                  <span>1 km</span>
                  <span style={{ color: projectConfig.color, fontWeight: 500 }}>
                    Recommandé: {projectConfig.radius.analysis} km
                  </span>
                  <span>30 km</span>
                </div>
              </div>
            </div>

            {/* Erreur */}
            {error && (
              <div style={{ 
                padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: "10px", marginTop: "20px", display: "flex", alignItems: "center", gap: "10px"
              }}>
                <AlertTriangle size={18} color="#dc2626" />
                <span style={{ fontSize: "14px", color: "#991b1b" }}>{error}</span>
              </div>
            )}

            {/* Bouton submit */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: "28px" }}>
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                style={{
                  ...styles.submitButton,
                  background: `linear-gradient(135deg, ${projectConfig.color} 0%, ${projectConfig.color}cc 100%)`,
                  opacity: isLoading ? 0.7 : 1,
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                    Analyse en cours...
                  </>
                ) : (
                  <>
                    <Search size={20} />
                    Lancer l'analyse de marché
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Résultats */}
          <div ref={resultsRef}>
            {isLoading && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "80px 40px"
              }}>
                <Loader2 size={56} color={projectConfig.color} style={{ animation: "spin 1s linear infinite", marginBottom: "20px" }} />
                <h3 style={{ fontSize: "20px", color: "#1e293b", marginBottom: "8px" }}>Analyse en cours...</h3>
                <p style={{ fontSize: "14px", color: "#64748b" }}>
                  Récupération des données DVF, INSEE, transport, équipements et tarifs CNSA
                </p>
              </div>
            )}

            {!isLoading && analysisResult && (
              <MarketStudyResults data={analysisResult} />
            )}

            {!isLoading && !analysisResult && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "80px 40px", textAlign: "center"
              }}>
                <div style={{
                  width: "80px", height: "80px", borderRadius: "50%",
                  background: `linear-gradient(135deg, ${projectConfig.color}20 0%, ${projectConfig.color}40 100%)`,
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "24px"
                }}>
                  <SafeIcon icon={projectConfig.icon} fallback={Building2} size={36} color={projectConfig.color} />
                </div>
                <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                  Nouvelle étude de marché - {projectConfig.label}
                </h3>
                <p style={{ fontSize: "15px", color: "#64748b", maxWidth: "500px", lineHeight: 1.6 }}>
                  Entrez une adresse, un numéro de parcelle, des coordonnées GPS ou un code INSEE 
                  pour lancer une analyse complète avec scoring adapté à votre type de projet.
                </p>
                <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                  <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>
                    ✅ Scoring différencié v1.1.0
                  </span>
                  <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>
                    DVF + INSEE
                  </span>
                  <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>
                    Transport + BPE
                  </span>
                  <span style={{ ...styles.badge, background: "#fdf2f8", color: "#be185d" }}>
                    EHPAD FINESS
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CSS animations */}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          input:focus, select:focus {
            border-color: ${projectConfig.color} !important;
            box-shadow: 0 0 0 3px ${projectConfig.color}20 !important;
          }
          button:hover:not(:disabled) {
            transform: translateY(-1px);
          }
        `}</style>
      </div>
    </ErrorBoundary>
  );
}


export default MarchePage;