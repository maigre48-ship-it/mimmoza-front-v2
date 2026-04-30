// ============================================
// MarchePage.tsx - VERSION 2.8.1
// ============================================
// AMÉLIORATIONS v2.8.1 (patch chirurgical sur v2.8) :
// - FIX NaN score : transport_exclu géré dans calculateDifferentiatedScores
//   → si backend renvoie transport_exclu=true, on redistribue les poids
//     sans accessibilite au lieu de multiplier undefined * 0.25 → NaN
// - scores.accessibilite optionnel dans l'interface (absent si transport_exclu)
// - scores.transport_exclu exposé dans l'interface et propagé dans adjustedScores
// - Sous-scores UI : ligne "Accessibilité" masquée si transport_exclu
//
// AMÉLIORATIONS v2.8 (patch chirurgical sur v2.7) :
// - Système DataQuality (reel / estime / fallback / indisponible)
// - Helpers réécrits : getAffordabilityScore, getEconomicStrengthScore,
//   getPricingRiskScore, getBuyerTargetProfile, getEconomicMomentumV2
// - EconomicDecisionCard : tuile "Risque pricing" remplace "Rendement brut",
//   KPI 3 colonnes, badges qualité, momentum compact, narratif banquable
// ============================================

import React, { useState, useCallback, useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
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
// IMPORT STUDY HOOK + TYPES — v2.5
// ============================================
import { usePromoteurStudy } from "../../shared/usePromoteurStudy";
import type { PromoteurMarcheData } from "../../shared/promoteurStudy.types";
import ScoreTooltip, { SCORE_TOOLTIPS } from "../../../../components/ui/ScoreTooltip";

// ─── Design tokens ───────────────────────────────────────────────────────────
const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

// ============================================
// DEBUG FLAGS
// ============================================
const DEBUG_MODE = true;

const log = (prefix: string, message: string, data?: unknown) => {
  if (DEBUG_MODE) console.log(`${prefix} ${message}`, data ?? '');
};

// ============================================
// TYPES pour market-study-promoteur / investisseur
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
  revenu_median: number | null;
  revenu_median_source?: "filosofi" | "socioeco" | "dept_fallback" | "none";
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
  taux_pauvrete?: number | null;
  part_menages_imposes?: number | null;
  pension_retraite_moyenne?: number | null;
  revenu_median_uc?: number | null;
  revenu_moyen?: number | null;
  niveau_vie_median?: number | null;
  part_cadres?: number | null;
  part_professions_intermediaires?: number | null;
  part_employes?: number | null;
  part_ouvriers?: number | null;
  part_actifs_occupes?: number | null;
  evolution_population_5y?: number | null;
  evolution_revenu_5y?: number | null;
  evolution_chomage_5y?: number | null;
  taxe_fonciere_moyenne?: number | null;
  taxe_fonciere_evolution_3y?: number | null;
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
  is_urban?: boolean;
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
// TYPES EHPAD
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

// ============================================
// v2.8.1 : scores.accessibilite optionnel + transport_exclu
// ============================================
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
    /** Absent (undefined) quand transport_exclu === true */
    accessibilite?: number;
    environnement: number;
    global: number;
    /** v1.3.19/1.3.7 : true si commune non-urbaine, transport ignoré */
    transport_exclu?: boolean;
  };
  scoring_details?: {
    transport_exclu?: boolean;
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
// SCORING DIFFÉRENCIÉ PAR TYPE DE PROJET
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
      { condition: (d) => (d.core.transport?.score ?? 50) < 40, penalty: 12, label: "Accessibilité faible" },
      { condition: (d) => (d.core.insee?.pct_15_29 ?? 0) < 12, penalty: 10, label: "Pop. jeune faible" },
    ],
  },
  bureaux: {
    weights: { demande: 0.25, offre: 0.20, accessibilite: 0.40, environnement: 0.15 },
    bonusFactors: [
      { condition: (d) => d.core.transport?.has_metro_train === true, bonus: 15, label: "Transport lourd" },
      { condition: (d) => (d.core.transport?.score ?? 0) >= 70, bonus: 10, label: "Excellente desserte" },
      { condition: (d) => (d.core.insee?.pct_actifs ?? 0) > 45, bonus: 8, label: "Bassin d'actifs" },
      { condition: (d) => (d.core.bpe?.services?.count ?? 0) >= 5, bonus: 5, label: "Services aux entreprises" },
      { condition: (d) => (d.core.insee?.revenu_median ?? 0) > 28000, bonus: 7, label: "Zone CSP+" },
    ],
    penaltyFactors: [
      { condition: (d) => (d.core.transport?.score ?? 50) < 50, penalty: 15, label: "Accessibilité insuffisante" },
      { condition: (d) => (d.core.insee?.taux_chomage ?? 0) > 10, penalty: 5, label: "Bassin économique fragile" },
      { condition: (d) => !d.core.transport?.has_metro_train && !d.core.transport?.has_tram, penalty: 8, label: "Pas de transport lourd" },
    ],
  },
  commerce: {
    weights: { demande: 0.35, offre: 0.15, accessibilite: 0.25, environnement: 0.25 },
    bonusFactors: [
      { condition: (d) => (d.core.insee?.revenu_median ?? 0) > 25000, bonus: 10, label: "Pouvoir d'achat élevé" },
      { condition: (d) => (d.core.insee?.densite ?? 0) > 1000, bonus: 8, label: "Zone dense" },
      { condition: (d) => (d.core.transport?.score ?? 0) >= 60, bonus: 7, label: "Bonne accessibilité" },
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
      { condition: (d) => (d.core.transport?.score ?? 50) < 40, penalty: 15, label: "Accessibilité insuffisante" },
      { condition: (d) => (d.core.insee?.densite ?? 0) < 100, penalty: 10, label: "Zone isolée" },
    ],
  },
};

// ============================================
// v2.8.1 — calculateDifferentiatedScores
// FIX : transport_exclu → redistribution poids sans accessibilite
// ============================================
const calculateDifferentiatedScores = (
  data: MarketStudyApiResponse,
  projectType: string
): {
  scores: {
    demande: number;
    offre: number;
    accessibilite: number;
    environnement: number;
    global: number;
    transport_exclu: boolean;
  };
  adjustments: { label: string; value: number }[];
  explanation: string;
} => {
  const config = PROJECT_SCORING_CONFIG[projectType] || PROJECT_SCORING_CONFIG.logement;
  const baseScores = data.scores;

  // v2.8.1 : détecter si le backend a exclu le transport (zone non-urbaine)
  const transportExclu = !!(baseScores.transport_exclu ?? data.scoring_details?.transport_exclu);

  let weightedBase: number;

  if (transportExclu) {
    // Redistribuer les poids sans accessibilite — même logique que le backend v1.3.19/1.3.7
    const totalOther = config.weights.demande + config.weights.offre + config.weights.environnement;
    weightedBase =
      baseScores.demande       * (config.weights.demande       / totalOther) +
      baseScores.offre         * (config.weights.offre         / totalOther) +
      baseScores.environnement * (config.weights.environnement / totalOther);
  } else {
    // Calcul normal — accessibilite présent et valide
    const accessibilite = baseScores.accessibilite ?? 50;
    weightedBase =
      baseScores.demande       * config.weights.demande +
      baseScores.offre         * config.weights.offre +
      accessibilite            * config.weights.accessibilite +
      baseScores.environnement * config.weights.environnement;
  }

  const adjustments: { label: string; value: number }[] = [];

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

  const finalScore = Math.max(0, Math.min(100, Math.round(weightedBase)));

  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

  const adjustedScores = {
    demande:      clamp(baseScores.demande      * (1 + (config.weights.demande      - 0.25) * 0.5)),
    offre:        clamp(baseScores.offre        * (1 + (config.weights.offre        - 0.25) * 0.5)),
    // accessibilite : 0 (sentinelle masquée dans l'UI) si transport exclu, sinon calcul normal
    accessibilite: transportExclu
      ? 0
      : clamp((baseScores.accessibilite ?? 50) * (1 + (config.weights.accessibilite - 0.25) * 0.5)),
    environnement: clamp(baseScores.environnement * (1 + (config.weights.environnement - 0.25) * 0.5)),
    global:        finalScore,
    transport_exclu: transportExclu,
  };

  const weightsStr = Object.entries(config.weights)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${Math.round(v * 100)}%`)
    .join(', ');

  return {
    scores: adjustedScores,
    adjustments,
    explanation: transportExclu
      ? `Pondération ${projectType} (transport non applicable) : ${weightsStr}`
      : `Pondération ${projectType}: ${weightsStr}`,
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
    background: `linear-gradient(135deg, ${ACCENT_PRO} 0%, #7c6fcd 100%)`,
    color: "white",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: `0 4px 12px ${ACCENT_PRO}40`,
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
// MAP COMPONENT
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

  const deltaLat = (radius / 111000) * 1.5;
  const deltaLon = (radius / (111000 * Math.cos(lat * Math.PI / 180))) * 1.5;
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
// DEMOGRAPHIE CARD - v2.6
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
          Données Démographiques & Économiques
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
  const isDeptFallback = insee.revenu_median_source === "dept_fallback";

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
    note?: string;
    noteColor?: string;
  };

  const getSecondaryStats = (): StatItem[] => {
    const stats: StatItem[] = [];

    const revenuValue = insee.revenu_median != null
      ? `${formatPrice(insee.revenu_median)}/an`
      : "—";

    stats.push({
      icon: Euro,
      label: "Revenu médian",
      value: revenuValue,
      color: isDeptFallback ? "#d97706" : "#10b981",
      ...(isDeptFallback && {
        note: "(estimation dépt.)",
        noteColor: "#d97706",
        bgColor: "#fffbeb",
      }),
    });

    stats.push({
      icon: Activity,
      label: "Taux chômage",
      value: formatPercent(insee.taux_chomage),
      color: insee.taux_chomage > 10 ? "#ef4444" : "#f59e0b",
    });

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
      stats.push({ icon: PiggyBank, label: "Pouvoir d'achat", value: (insee.revenu_median ?? 0) > 25000 ? "Élevé" : (insee.revenu_median ?? 0) > 20000 ? "Moyen" : "Faible", color: (insee.revenu_median ?? 0) > 25000 ? "#10b981" : "#f59e0b" });
      if (insee.pct_actifs) stats.push({ icon: Briefcase, label: "% Actifs", value: formatPercent(insee.pct_actifs), color: "#3b82f6" });
      if (insee.pct_30_44) stats.push({ icon: Users, label: "% 30-44 ans", value: formatPercent(insee.pct_30_44), color: "#6366f1" });
    } else if (isBureaux) {
      if (insee.pct_actifs) stats.unshift({ icon: Briefcase, label: "% Actifs", value: formatPercent(insee.pct_actifs), color: "#3b82f6", highlight: true, bgColor: "#dbeafe" });
      stats.push({ icon: Activity, label: "Bassin d'emploi", value: formatNumber(Math.round(insee.population * 0.45)), color: "#6366f1" });
      if (insee.pct_30_44) stats.push({ icon: Users, label: "% 30-44 ans", value: formatPercent(insee.pct_30_44), color: "#8b5cf6" });
    } else {
      stats.push({ icon: Home, label: "% Propriétaires", value: formatPercent(insee.pct_proprietaires), color: "#3b82f6" });
    }

    stats.push({
      icon: AlertTriangle,
      label: "Taux de pauvreté",
      value: formatPercent(insee.taux_pauvrete),
      color: (insee.taux_pauvrete ?? 0) > 20 ? "#ef4444" : (insee.taux_pauvrete ?? 0) > 14 ? "#f59e0b" : "#10b981",
    });
    stats.push({
      icon: Banknote,
      label: "Ménages imposés",
      value: formatPercent(insee.part_menages_imposes),
      color: "#6366f1",
    });
    stats.push({
      icon: PiggyBank,
      label: "Pension retraite moy.",
      value: insee.pension_retraite_moyenne != null ? `${formatPrice(insee.pension_retraite_moyenne)}/an` : "—",
      color: "#8b5cf6",
    });

    return stats;
  };

  const secondaryStats = getSecondaryStats();

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Users size={20} color="#6366f1" />
        Données Démographiques & Économiques
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
          <div key={i} style={{ background: stat.bg, borderRadius: "14px", padding: "16px", textAlign: "center" }}>
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
              border: stat.highlight ? `2px solid ${stat.color}30` : "none",
              flexDirection: "column",
              alignItems: "stretch",
              gap: "0",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Icon size={16} color={stat.color} />
                  <span style={{ fontSize: "13px", color: "#64748b" }}>{stat.label}</span>
                </div>
                <span style={{ fontSize: "15px", fontWeight: 700, color: stat.color }}>
                  {stat.value}
                </span>
              </div>
              {stat.note && (
                <div style={{
                  fontSize: "10px",
                  color: stat.noteColor || "#94a3b8",
                  fontStyle: "italic",
                  textAlign: "right",
                  marginTop: "3px",
                }}>
                  {stat.note}
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
// v2.8 — HELPERS ÉCONOMIQUES PURS
// ============================================

type DataQuality = "reel" | "estime" | "fallback" | "indisponible";

interface QualifiedValue {
  value: string;
  quality: DataQuality;
}

function qv(
  raw: number | null | undefined,
  fmt: (n: number) => string,
  quality: DataQuality = "reel"
): QualifiedValue {
  if (raw == null) return { value: "—", quality: "indisponible" };
  return { value: fmt(raw), quality };
}

const QUALITY_LABELS: Record<DataQuality, { label: string; color: string }> = {
  reel:         { label: "réel",              color: "#10b981" },
  estime:       { label: "estimé",            color: "#f59e0b" },
  fallback:     { label: "estimation dépt.",  color: "#d97706" },
  indisponible: { label: "—",                 color: "#cbd5e1" },
};

interface AffordabilityScore {
  score: number | null;
  label: "accessible" | "tendu" | "très tendu" | "luxe / patrimonial" | "non calculable";
  color: string;
  explanation: string;
  ratio: number | null;
  quality: DataQuality;
}

interface EconomicStrengthScore {
  score: number | null;
  label: "fragile" | "intermédiaire" | "solide" | "premium" | "non calculable";
  color: string;
  explanation: string;
}

interface PricingRiskScore {
  score: number | null;
  label: "faible" | "modéré" | "élevé" | "critique" | "non calculable";
  color: string;
  explanation: string;
}

interface BuyerTargetProfile {
  target: string;
  confidence: "faible" | "moyenne" | "forte";
  explanation: string;
}

interface EconomicMomentumV2 {
  label: "positif" | "stable" | "fragile" | "non calculable";
  color: string;
  explanation: string;
  quality: DataQuality;
}

function getAffordabilityScore(insee: InseeData | null, dvf: DvfData | null): AffordabilityScore {
  const revenu = insee?.niveau_vie_median ?? insee?.revenu_median;
  const prix   = dvf?.prix_m2_median;
  const source = insee?.revenu_median_source;
  const quality: DataQuality = source === "dept_fallback" ? "fallback"
    : source === "none" ? "indisponible"
    : revenu != null ? "reel"
    : "indisponible";

  if (revenu == null || prix == null || revenu <= 0 || prix <= 0) {
    return { score: null, label: "non calculable", color: "#94a3b8", explanation: "Revenu médian ou prix m² médian non disponible.", ratio: null, quality };
  }

  const ratio = (prix * 60) / revenu;
  const score = Math.max(0, Math.min(100, Math.round(100 - (ratio / 12) * 100)));

  if (ratio < 3) return { score, label: "accessible", color: "#10b981", ratio, quality, explanation: `~${ratio.toFixed(1)} ans de revenus pour 60 m² — marché abordable, bonne solvabilité locale.` };
  if (ratio < 5) return { score, label: "tendu", color: "#f59e0b", ratio, quality, explanation: `~${ratio.toFixed(1)} ans de revenus pour 60 m² — marché sous tension, primo-accédants fragilisés.` };
  if (ratio < 9) return { score, label: "très tendu", color: "#ef4444", ratio, quality, explanation: `~${ratio.toFixed(1)} ans de revenus pour 60 m² — marché fortement contraint, pricing exigeant.` };
  return { score, label: "luxe / patrimonial", color: "#7c3aed", ratio, quality, explanation: `~${ratio.toFixed(1)} ans de revenus pour 60 m² — marché patrimonial, hors portée du marché local standard.` };
}

function getEconomicStrengthScore(insee: InseeData | null): EconomicStrengthScore {
  if (!insee) return { score: null, label: "non calculable", color: "#94a3b8", explanation: "Données INSEE non disponibles." };

  type Signal = { value: number; weight: number };
  const signals: Signal[] = [];
  const notes: string[] = [];

  if (insee.revenu_median != null) {
    const rev = Math.min(100, Math.max(0, ((insee.revenu_median - 14000) / (60000 - 14000)) * 100));
    signals.push({ value: rev, weight: 3 });
    if (insee.revenu_median > 35000) notes.push("revenus très élevés");
    else if (insee.revenu_median > 24000) notes.push("revenus supérieurs à la médiane");
    else if (insee.revenu_median < 18000) notes.push("revenus faibles");
  }
  if (insee.taux_pauvrete != null) {
    const pauv = Math.min(100, Math.max(0, 100 - (insee.taux_pauvrete / 30) * 100));
    signals.push({ value: pauv, weight: 2 });
    if (insee.taux_pauvrete > 20) notes.push(`pauvreté élevée (${formatPercent(insee.taux_pauvrete)})`);
  }
  if (insee.part_menages_imposes != null) {
    const imp = Math.min(100, Math.max(0, (insee.part_menages_imposes / 80) * 100));
    signals.push({ value: imp, weight: 2 });
  }
  if (insee.part_cadres != null) {
    const cad = Math.min(100, Math.max(0, (insee.part_cadres / 40) * 100));
    signals.push({ value: cad, weight: 1.5 });
    if (insee.part_cadres > 25) notes.push(`forte proportion de cadres (${formatPercent(insee.part_cadres)})`);
  }
  if (insee.part_actifs_occupes != null || insee.pct_actifs != null) {
    const actifs = insee.part_actifs_occupes ?? insee.pct_actifs ?? 0;
    const act = Math.min(100, Math.max(0, (actifs / 60) * 100));
    signals.push({ value: act, weight: 1 });
  }
  if (insee.taux_chomage != null) {
    const chom = Math.min(100, Math.max(0, 100 - (insee.taux_chomage / 20) * 100));
    signals.push({ value: chom, weight: 2 });
    if (insee.taux_chomage > 12) notes.push(`chômage élevé (${formatPercent(insee.taux_chomage)})`);
  }

  if (signals.length < 2) return { score: null, label: "non calculable", color: "#94a3b8", explanation: "Données insuffisantes (< 2 signaux disponibles)." };

  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0);
  const score = Math.round(signals.reduce((acc, s) => acc + s.value * s.weight, 0) / totalWeight);
  const explanation = notes.length > 0 ? notes.join(", ") + "." : "Profil économique équilibré.";

  if (score >= 75) return { score, label: "premium",       color: "#7c3aed", explanation };
  if (score >= 58) return { score, label: "solide",        color: "#10b981", explanation };
  if (score >= 40) return { score, label: "intermédiaire", color: "#f59e0b", explanation };
  return               { score, label: "fragile",       color: "#ef4444", explanation };
}

function getPricingRiskScore(insee: InseeData | null, dvf: DvfData | null, projectType: string): PricingRiskScore {
  const affordability = getAffordabilityScore(insee, dvf);
  const strength      = getEconomicStrengthScore(insee);

  if (affordability.score == null && strength.score == null) {
    return { score: null, label: "non calculable", color: "#94a3b8", explanation: "Données insuffisantes pour évaluer le risque pricing." };
  }

  let riskScore = 0;

  if (affordability.ratio != null) {
    if      (affordability.ratio > 9) riskScore += 40;
    else if (affordability.ratio > 6) riskScore += 25;
    else if (affordability.ratio > 4) riskScore += 15;
    else                              riskScore += 5;
  }

  if (strength.score != null) {
    if      (strength.score < 40) riskScore += 25;
    else if (strength.score < 58) riskScore += 10;
    else if (strength.score > 75) riskScore -= 10;
  }

  const modifiers: Record<string, number> = {
    logement: 0, residence_etudiante: -5, ehpad: 5,
    bureaux: -5, commerce: 10, hotel: -10,
  };
  riskScore += modifiers[projectType] ?? 0;
  riskScore = Math.max(0, Math.min(100, riskScore));

  const notes: string[] = [];
  if (affordability.ratio != null) notes.push(`effort d'achat ~${affordability.ratio.toFixed(1)} ans`);
  if (strength.label !== "non calculable") notes.push(`zone ${strength.label}`);
  const explanation = notes.join(", ") + ".";

  if (riskScore < 20) return { score: riskScore, label: "faible",   color: "#10b981", explanation };
  if (riskScore < 40) return { score: riskScore, label: "modéré",   color: "#f59e0b", explanation };
  if (riskScore < 65) return { score: riskScore, label: "élevé",    color: "#f97316", explanation };
  return                    { score: riskScore, label: "critique", color: "#ef4444", explanation };
}

function getBuyerTargetProfile(insee: InseeData | null, dvf: DvfData | null, projectType: string): BuyerTargetProfile {
  if (!insee) return { target: "Non déterminable", confidence: "faible", explanation: "Données INSEE manquantes." };

  const revenu    = insee.revenu_median ?? 0;
  const pctJeunes = insee.pct_15_29 ?? 0;
  const pctEtu    = insee.pct_etudiants ?? 0;
  const pctSenior = insee.pct_plus_75 ?? (insee.pct_plus_60 != null && insee.pct_60_74 != null ? Math.max(0, insee.pct_plus_60 - insee.pct_60_74) : 0);
  const pctProp   = insee.pct_proprietaires ?? 0;
  const pctLoc    = insee.pct_locataires ?? Math.max(0, 100 - pctProp);
  const chomage   = insee.taux_chomage ?? 0;
  const vacance   = insee.pct_logements_vacants ?? 0;
  const densite   = insee.densite ?? 0;
  const cadres    = insee.part_cadres ?? 0;
  const prixM2    = dvf?.prix_m2_median ?? 0;
  const ratio     = revenu > 0 && prixM2 > 0 ? (prixM2 * 60) / revenu : null;

  if (projectType === "ehpad") {
    return { target: "Marché senior", confidence: pctSenior > 12 ? "forte" : "moyenne", explanation: `Part 75+ (${pctSenior > 0 ? pctSenior.toFixed(1) + "%" : "n/d"}), pension moy. ${insee.pension_retraite_moyenne != null ? formatPrice(insee.pension_retraite_moyenne) + "/an" : "n/d"}.` };
  }
  if (projectType === "residence_etudiante") {
    return { target: "Marché étudiant / locatif jeune", confidence: (pctJeunes > 20 && pctEtu > 8) ? "forte" : "moyenne", explanation: `${pctJeunes.toFixed(0)}% de 15-29 ans, ${pctEtu.toFixed(1)}% d'étudiants, ${pctLoc.toFixed(0)}% de locataires.` };
  }
  if (projectType === "bureaux") {
    return { target: "Marché tertiaire / entreprises", confidence: cadres > 20 ? "forte" : "moyenne", explanation: `${cadres > 0 ? cadres.toFixed(0) + "% de cadres, " : ""}bassin d'actifs ${densite > 1000 ? "dense" : "intermédiaire"}.` };
  }

  if (cadres > 25 || revenu > 38000 || (ratio != null && ratio > 9)) {
    return { target: "Marché patrimonial / CSP+", confidence: cadres > 25 ? "forte" : "moyenne", explanation: `Revenu ${formatPrice(revenu)}/an${cadres > 0 ? `, ${cadres.toFixed(0)}% cadres` : ""}, profil aisé.` };
  }
  if (pctLoc > 55 && vacance < 7) {
    return { target: "Marché investisseur", confidence: "forte", explanation: `${pctLoc.toFixed(0)}% de locataires, vacance faible (${vacance.toFixed(1)}%) — rendement locatif défendable.` };
  }
  if (chomage > 11 || (ratio != null && ratio > 7)) {
    return { target: "Marché sous contrainte de solvabilité", confidence: "moyenne", explanation: `Chômage ${chomage.toFixed(1)}%${ratio != null ? `, effort d'achat ~${ratio.toFixed(1)} ans` : ""} — solvabilité à sécuriser.` };
  }
  if (pctProp > 60 && vacance < 10) {
    const mixte = pctLoc > 35;
    return { target: mixte ? "Marché mixte occupants / investisseurs" : "Marché familial d'occupation", confidence: "moyenne", explanation: `${pctProp.toFixed(0)}% propriétaires, zone résidentielle ${mixte ? "mixte" : "stable"}.` };
  }
  return { target: "Marché mixte", confidence: "faible", explanation: "Profil composite — positionner selon le produit et la gamme de prix." };
}

function getEconomicMomentumV2(insee: InseeData | null): EconomicMomentumV2 {
  if (!insee) return { label: "non calculable", color: "#94a3b8", explanation: "Données manquantes.", quality: "indisponible" };

  const evoPop  = insee.evolution_population_5y;
  const evoRev  = insee.evolution_revenu_5y;
  const evoChom = insee.evolution_chomage_5y;
  const hasData = evoPop != null || evoRev != null || evoChom != null;

  if (!hasData) {
    return { label: "non calculable", color: "#94a3b8", explanation: "Évolutions temporelles non disponibles.", quality: "indisponible" };
  }

  let score = 0;
  const notes: string[] = [];

  if (evoPop != null) {
    if (evoPop > 1)      { score += 2; notes.push(`pop. +${evoPop.toFixed(1)}%/an`); }
    else if (evoPop > 0)  { score += 1; }
    else if (evoPop < -0.5) { score -= 2; notes.push(`pop. ${evoPop.toFixed(1)}%/an`); }
  }
  if (evoRev != null) {
    if (evoRev > 2)      { score += 2; notes.push(`revenus +${evoRev.toFixed(1)}%/an`); }
    else if (evoRev > 0)  { score += 1; }
    else if (evoRev < 0)  { score -= 1; notes.push(`revenus en baisse`); }
  }
  if (evoChom != null) {
    if (evoChom < -1)    { score += 2; notes.push(`chômage en forte baisse`); }
    else if (evoChom < 0) { score += 1; }
    else if (evoChom > 1) { score -= 2; notes.push(`chômage en hausse`); }
  }

  const explanation = notes.length > 0 ? notes.join(", ") + "." : "Évolutions modérées.";

  if (score >= 3)  return { label: "positif", color: "#10b981", explanation: `Zone en croissance — ${explanation}`, quality: "reel" };
  if (score <= -2) return { label: "fragile", color: "#ef4444", explanation: `Signaux de fragilité — ${explanation}`, quality: "reel" };
  return               { label: "stable",  color: "#f59e0b", explanation: `Dynamiques modérées — ${explanation}`, quality: "reel" };
}

interface NarrativeParamsV2 {
  affordability: AffordabilityScore;
  strength:      EconomicStrengthScore;
  pricingRisk:   PricingRiskScore;
  buyerTarget:   BuyerTargetProfile;
  momentum:      EconomicMomentumV2;
  insee:         InseeData | null;
  dvf:           DvfData | null;
  projectType:   string;
}

function buildEconomicNarrativeV2(p: NarrativeParamsV2): string[] {
  const { affordability, strength, pricingRisk, buyerTarget, momentum, insee, dvf, projectType } = p;
  const phrases: string[] = [];

  if (affordability.label !== "non calculable") {
    if (affordability.label === "luxe / patrimonial") {
      phrases.push(`Le niveau de prix est hors de portée du marché local standard (~${affordability.ratio?.toFixed(1)} ans de revenus pour 60 m²) : ce projet cible structurellement une clientèle patrimoniale, CSP+ ou investisseur.`);
    } else if (affordability.label === "très tendu") {
      phrases.push(`Le marché est fortement sous tension prix/revenus (~${affordability.ratio?.toFixed(1)} ans), ce qui fragilise la solvabilité des acquéreurs locaux et impose une vigilance forte sur le pricing de sortie.`);
    } else if (affordability.label === "tendu") {
      phrases.push(`Le rapport prix/revenus est sous tension (~${affordability.ratio?.toFixed(1)} ans pour 60 m²) — les primo-accédants sont fragilisés et le couple prix / financement devra être soigneusement calibré.`);
    } else {
      phrases.push(`Le marché présente un bon niveau d'accessibilité financière (~${affordability.ratio?.toFixed(1)} ans de revenus pour 60 m²), ce qui soutient la solvabilité locale et limite le risque commercial.`);
    }
  }

  if (strength.label !== "non calculable") {
    if (strength.label === "fragile") {
      phrases.push(`Le profil socio-économique de la zone est fragile (${strength.explanation}) — le niveau de solvabilité ne sécurise pas, à lui seul, un positionnement ambitieux.`);
    } else if (strength.label === "premium") {
      phrases.push(`La zone affiche un profil socio-économique premium (${strength.explanation}), ce qui favorise un produit haut de gamme et une clientèle exigeante.`);
    } else if (strength.label === "solide") {
      phrases.push(`La structure économique de la zone est solide (${strength.explanation}), offrant une bonne profondeur de marché.`);
    }
  }

  if (buyerTarget.confidence !== "faible") {
    phrases.push(`Le profil de zone oriente vers un positionnement "${buyerTarget.target}" — ${buyerTarget.explanation}`);
  }

  if (projectType === "logement") {
    const vacance = insee?.pct_logements_vacants;
    const prop    = insee?.pct_proprietaires;
    if (vacance != null && vacance > 12) {
      phrases.push(`La vacance élevée (${vacance.toFixed(1)}%) est un signal d'alerte sur la capacité d'absorption : adapter le rythme de commercialisation en conséquence.`);
    } else if (vacance != null && vacance < 6) {
      phrases.push(`La vacance très faible (${vacance.toFixed(1)}%) témoigne d'une tension locative réelle — atout majeur pour la commercialisation.`);
    }
    if (prop != null && prop < 45) {
      phrases.push(`La dominance locative (${(100 - prop).toFixed(0)}% de locataires) oriente davantage vers un produit investisseur ou locatif social.`);
    }
  } else if (projectType === "residence_etudiante") {
    const pctEtu = insee?.pct_etudiants;
    const pctLoc = insee?.pct_locataires ?? (100 - (insee?.pct_proprietaires ?? 0));
    if (pctEtu != null) {
      phrases.push(`La part étudiante (${pctEtu.toFixed(1)}%) ${pctEtu > 10 ? "est un signal fort" : "reste modérée"} : la profondeur locative jeune${pctLoc > 55 ? " et le profil très locatif de la zone" : ""} soutiennent la logique de résidence étudiante.`);
    }
  } else if (projectType === "ehpad") {
    const pension = insee?.pension_retraite_moyenne;
    const pctSr   = insee?.pct_plus_75;
    if (pension != null) {
      phrases.push(`La pension retraite moyenne (${formatPrice(pension)}/an) est un paramètre central pour évaluer la solvabilité des résidents et calibrer le tarif hébergement.`);
    }
    if (pctSr != null && pctSr < 8) {
      phrases.push(`La part des 75+ ans reste faible (${pctSr.toFixed(1)}%) — la zone de chalandise devra être élargie pour atteindre les objectifs de taux d'occupation.`);
    }
  } else if (projectType === "bureaux") {
    const cadres = insee?.part_cadres;
    if (cadres != null) {
      phrases.push(`La part de cadres (${cadres.toFixed(0)}%) ${cadres > 20 ? "soutient l'attractivité tertiaire" : "est encore insuffisante pour du premium"} — le produit devra s'adapter au bassin d'emploi local.`);
    }
  } else if (projectType === "commerce") {
    const revenu  = insee?.revenu_median;
    const densite = insee?.densite;
    if (revenu != null && densite != null) {
      phrases.push(`Le couple revenu médian (${formatPrice(revenu)}/an) / densité (${formatNumber(densite)} hab/km²) calibre directement le profil clientèle et le positionnement tarifaire du commerce.`);
    }
  } else if (projectType === "hotel") {
    const densite = insee?.densite;
    if (densite != null) {
      phrases.push(`La densité de zone (${formatNumber(densite)} hab/km²) et le niveau de vie local conditionnent la fréquentation et le pricing hôtelier : ${densite > 2000 ? "zone très urbaine, profil affaires / loisirs" : "zone intermédiaire, mix clientèle à définir"}.`);
    }
  }

  if (momentum.label === "positif") {
    phrases.push(`Le territoire est en croissance (${momentum.explanation}), ce qui renforce la pertinence du projet à moyen terme.`);
  } else if (momentum.label === "fragile") {
    phrases.push(`Des dynamiques de fragilité territoriale sont détectées (${momentum.explanation}) — anticiper l'évolution de la demande dans le plan de commercialisation.`);
  }

  if (pricingRisk.label === "élevé" || pricingRisk.label === "critique") {
    phrases.push(`Le risque pricing est ${pricingRisk.label} (${pricingRisk.explanation}) — la politique tarifaire de sortie devra rester prudente pour ne pas contraindre la commercialisation.`);
  }

  return phrases.slice(0, 5);
}

// ============================================
// v2.8 — EconomicDecisionCard
// ============================================
interface EconomicDecisionCardProps {
  insee:       InseeData | null;
  dvf:         DvfData | null;
  projectType: string;
}

const EconomicDecisionCard: React.FC<EconomicDecisionCardProps> = ({ insee, dvf, projectType }) => {
  const affordability = useMemo(() => getAffordabilityScore(insee, dvf),             [insee, dvf]);
  const strength      = useMemo(() => getEconomicStrengthScore(insee),               [insee]);
  const pricingRisk   = useMemo(() => getPricingRiskScore(insee, dvf, projectType), [insee, dvf, projectType]);
  const buyerTarget   = useMemo(() => getBuyerTargetProfile(insee, dvf, projectType),[insee, dvf, projectType]);
  const momentum      = useMemo(() => getEconomicMomentumV2(insee),                 [insee]);
  const narrative     = useMemo(() => buildEconomicNarrativeV2({
    affordability, strength, pricingRisk, buyerTarget, momentum, insee, dvf, projectType,
  }), [affordability, strength, pricingRisk, buyerTarget, momentum, insee, dvf, projectType]);

  const QualityBadge: React.FC<{ quality: DataQuality }> = ({ quality }) => {
    if (quality === "indisponible" || quality === "reel") return null;
    const cfg = QUALITY_LABELS[quality];
    return (
      <span style={{
        fontSize: 9, fontWeight: 600, color: cfg.color,
        padding: "1px 5px", borderRadius: 4,
        background: quality === "fallback" ? "#fef3c7" : "#fef9c3",
        border: `1px solid ${cfg.color}40`,
        marginLeft: 4, verticalAlign: "middle",
      }}>
        {cfg.label}
      </span>
    );
  };

  const tiles = [
    { label: "Pouvoir d'achat immo", value: affordability.ratio != null ? `${affordability.ratio.toFixed(1)} ans` : "—", sub: affordability.label, color: affordability.color, quality: affordability.quality },
    { label: "Positionnement", value: buyerTarget.target, sub: `Confiance ${buyerTarget.confidence}`, color: buyerTarget.confidence === "forte" ? "#4f46e5" : buyerTarget.confidence === "moyenne" ? "#0891b2" : "#94a3b8", quality: "reel" as DataQuality },
    { label: "Force éco. zone", value: strength.label === "non calculable" ? "—" : strength.label, sub: strength.score != null ? `Score ${strength.score}/100` : "Non calculable", color: strength.color, quality: "reel" as DataQuality },
    { label: "Risque pricing", value: pricingRisk.label, sub: pricingRisk.score != null ? `Score ${pricingRisk.score}/100` : "Non calculable", color: pricingRisk.color, quality: "reel" as DataQuality },
  ];

  type KpiRow = { label: string; qv: QualifiedValue; note?: string };
  const kpiRows: KpiRow[] = [
    { label: "Revenu médian",       qv: qv(insee?.revenu_median, (n) => `${formatPrice(n)}/an`, insee?.revenu_median_source === "dept_fallback" ? "fallback" : "reel") },
    { label: "Revenu moyen",        qv: qv(insee?.revenu_moyen, (n) => `${formatPrice(n)}/an`, "estime") },
    { label: "Niveau de vie médian", qv: qv(insee?.niveau_vie_median, (n) => `${formatPrice(n)}/an`) },
    { label: "Taux de pauvreté",    qv: qv(insee?.taux_pauvrete, (n) => formatPercent(n)) },
    { label: "Ménages imposés",     qv: qv(insee?.part_menages_imposes, (n) => formatPercent(n)) },
    { label: "Pension retraite moy.", qv: qv(insee?.pension_retraite_moyenne, (n) => `${formatPrice(n)}/an`) },
    { label: "Part cadres",         qv: qv(insee?.part_cadres, (n) => formatPercent(n)) },
    { label: "Actifs occupés",      qv: qv(insee?.part_actifs_occupes ?? insee?.pct_actifs, (n) => formatPercent(n)) },
    { label: "Taxe foncière moy.",  qv: qv(insee?.taxe_fonciere_moyenne, (n) => `${formatNumber(n)} €/an`, "estime") },
    { label: "Évo. TF 3 ans",       qv: qv(insee?.taxe_fonciere_evolution_3y, (n) => formatPercent(n, true), "estime") },
    { label: "Évo. pop. 5 ans",     qv: qv(insee?.evolution_population_5y, (n) => formatPercent(n, true)) },
  ];

  const getKpiValueColor = (row: KpiRow): string => {
    if (row.qv.quality === "indisponible") return "#cbd5e1";
    if (row.label === "Taux de pauvreté") {
      const v = insee?.taux_pauvrete;
      return v != null ? (v > 20 ? "#ef4444" : v > 14 ? "#f59e0b" : "#10b981") : "#cbd5e1";
    }
    if (row.label === "Évo. TF 3 ans") {
      const v = insee?.taxe_fonciere_evolution_3y;
      return v != null ? (v > 5 ? "#ef4444" : "#64748b") : "#cbd5e1";
    }
    return "#1e293b";
  };

  return (
    <div style={{ ...styles.card, marginBottom: "24px", border: "1px solid #e0e7ff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5 0%, #7c6fcd 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>Lecture économique décisionnelle</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Analyse Mimmoza — aide à la décision promoteur · investisseur · CGP</div>
          </div>
        </div>
        <span style={{ ...styles.badge, background: "#ede9fe", color: ACCENT_PRO }}>v2.8</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {tiles.map((tile, i) => (
          <div key={i} style={{ padding: "16px 14px", background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)", borderRadius: 12, borderTop: `3px solid ${tile.color}` }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              {tile.label}
              <QualityBadge quality={tile.quality} />
            </div>
            <div style={{ fontSize: tile.value.length > 14 ? 13 : 17, fontWeight: 700, color: tile.color, lineHeight: 1.2, marginBottom: 4 }}>
              {tile.value}
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: "#f1f5f9", marginBottom: "20px" }} />

      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
          Indicateurs économiques
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {kpiRows.map((row, i) => (
            <div key={i} style={{
              padding: "10px 12px",
              background: row.qv.quality === "fallback" ? "#fffbeb" : "#f8fafc",
              borderRadius: 8, display: "flex", flexDirection: "column", gap: "3px",
              border: row.qv.quality === "fallback" ? "1px solid #fde68a" : "none",
            }}>
              <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", gap: 2 }}>
                {row.label}
                {(row.qv.quality === "fallback" || row.qv.quality === "estime") && (
                  <QualityBadge quality={row.qv.quality} />
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: getKpiValueColor(row) }}>
                {row.qv.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: "#f1f5f9", marginBottom: "20px" }} />

      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", background: "#f8fafc", borderRadius: 10, marginBottom: "20px" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: momentum.color, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: momentum.color, marginRight: 8 }}>Momentum {momentum.label}</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>{momentum.explanation}</span>
        </div>
        {momentum.quality === "indisponible" && (
          <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Évolutions non dispo.</span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
          Synthèse Mimmoza
        </div>
        {narrative.length === 0 ? (
          <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Données insuffisantes pour générer une synthèse décisionnelle.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {narrative.map((phrase, i) => (
              <div key={i} style={{
                display: "flex", gap: "10px", alignItems: "flex-start",
                padding: "11px 14px",
                background: i === 0 ? "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)" : "#f8fafc",
                borderRadius: 10,
                borderLeft: `3px solid ${i === 0 ? ACCENT_PRO : "#e2e8f0"}`,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: i === 0 ? ACCENT_PRO : "#94a3b8", minWidth: 18, paddingTop: 2 }}>{i + 1}.</span>
                <p style={{ fontSize: 13, color: "#334155", margin: 0, lineHeight: 1.65 }}>{phrase}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "12px" }}>
          {(["reel", "estime", "fallback"] as DataQuality[]).map((quality) => {
            const cfg = QUALITY_LABELS[quality];
            return (
              <div key={quality} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color, display: "inline-block" }} />
                <span style={{ fontSize: 9, color: "#94a3b8" }}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 9, color: "#cbd5e1" }}>Sources : INSEE Filosofi · DVF · Mimmoza calculs internes</span>
      </div>
    </div>
  );
};

// ============================================
// AGE PYRAMID CHART
// ============================================
const AgePyramidChart: React.FC<{ insee: InseeData | null }> = ({ insee }) => {
  if (!insee) return null;

  const slices = [
    { label: "< 15 ans",  pct: insee.pct_moins_15, color: "#3b82f6" },
    { label: "15-29 ans", pct: insee.pct_15_29,    color: "#06b6d4" },
    { label: "30-44 ans", pct: insee.pct_30_44,    color: "#10b981" },
    { label: "45-59 ans", pct: insee.pct_45_59,    color: "#f59e0b" },
    { label: "60-74 ans", pct: insee.pct_60_74,    color: "#f97316" },
    { label: "75+ ans",   pct: insee.pct_plus_75 ?? ((insee.pct_plus_60 != null && insee.pct_60_74 != null) ? Math.max(0, insee.pct_plus_60 - insee.pct_60_74) : undefined), color: "#ef4444" },
  ].filter((s): s is { label: string; pct: number; color: string } => s.pct != null && !isNaN(s.pct));

  if (slices.length === 0) return null;

  const maxPct = Math.max(...slices.map(s => s.pct));
  const scale  = Math.max(maxPct, 25);

  const BAR_H = 18, GAP = 7, LABEL_W = 68, PCT_W = 44, BAR_AREA = 340;
  const TOTAL_H = slices.length * (BAR_H + GAP) + 6;
  const TOTAL_W = LABEL_W + BAR_AREA + PCT_W + 12;

  return (
    <div style={{ ...styles.card, marginBottom: "24px", maxWidth: "680px" }}>
      <div style={styles.cardTitle}>
        <Users size={16} color="#6366f1" />
        Pyramide des âges
        <span style={{ ...styles.badge, background: "#eef2ff", color: "#4f46e5", marginLeft: "auto" }}>
          {slices.length} tranches
        </span>
      </div>

      <svg viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`} style={{ width: "100%", height: "auto", display: "block" }} aria-label="Pyramide des âges">
        {slices.map((s, i) => {
          const y    = i * (BAR_H + GAP) + 4;
          const barW = Math.max(4, (s.pct / scale) * BAR_AREA);
          return (
            <g key={s.label}>
              <text x={LABEL_W - 8} y={y + BAR_H / 2 + 5} textAnchor="end" fontSize={11} fill="#475569" fontFamily="'Inter', sans-serif">{s.label}</text>
              <rect x={LABEL_W} y={y} width={BAR_AREA} height={BAR_H} rx={6} fill="#f1f5f9" />
              <rect x={LABEL_W} y={y} width={barW} height={BAR_H} rx={6} fill={s.color} opacity={0.88} />
              <text x={LABEL_W + barW + 8} y={y + BAR_H / 2 + 5} textAnchor="start" fontSize={12} fontWeight="700" fill={s.color} fontFamily="'Inter', sans-serif">{formatPercent(s.pct)}</text>
            </g>
          );
        })}
      </svg>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "16px", padding: "12px 14px", background: "#f8fafc", borderRadius: "10px" }}>
        {slices.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: s.color }} />
            <span style={{ fontSize: "11px", color: "#475569" }}>{s.label}</span>
          </div>
        ))}
        <span style={{ marginLeft: "auto", fontSize: "10px", color: "#94a3b8", fontStyle: "italic" }}>Source INSEE</span>
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
          {transport.is_urban === false ? "Zone non-urbaine" : `Score: ${transport.score}/100`}
        </span>
      </div>

      {transport.is_urban === false ? (
        <div style={{ padding: "24px", textAlign: "center", background: "#f8fafc", borderRadius: "12px", color: "#64748b" }}>
          <Bus size={36} style={{ opacity: 0.4, marginBottom: "12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 500 }}>Zone non-urbaine</p>
          <p style={{ fontSize: "13px", marginTop: "8px" }}>
            Le critère transport n'est pas évalué pour cette commune — il n'a pas été pris en compte dans le score global.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
            {transport.has_metro_train && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "#eef2ff", borderRadius: "8px" }}>
                <Train size={16} color="#6366f1" />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#4338ca" }}>Métro / Train</span>
              </div>
            )}
            {transport.has_tram && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "#f0fdf4", borderRadius: "8px" }}>
                <Bus size={16} color="#16a34a" />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#15803d" }}>Tramway</span>
              </div>
            )}
            {!transport.has_metro_train && !transport.has_tram && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "#f1f5f9", borderRadius: "8px" }}>
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
        </>
      )}
    </div>
  );
};

// ============================================
// BPE CARD
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
      if (a.key === "sante") return -1; if (b.key === "sante") return 1;
      if (a.key === "commerces") return -1; if (b.key === "commerces") return 1;
      return 0;
    });
  } else if (isEtudiant) {
    priorityCategories.sort((a, b) => {
      if (a.key === "education") return -1; if (b.key === "education") return 1;
      if (a.key === "loisirs") return -1; if (b.key === "loisirs") return 1;
      return 0;
    });
  } else if (isCommerce) {
    priorityCategories.sort((a, b) => {
      if (a.key === "commerces") return -1; if (b.key === "commerces") return 1;
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
            <div
              key={cat.key}
              style={{ padding: "16px", background: "#f8fafc", borderRadius: "12px", borderLeft: `4px solid ${cat.color}`, cursor: hasDetails ? "pointer" : "default" }}
              onClick={() => hasDetails && setExpandedCategory(isExpanded ? null : cat.key)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <Icon size={18} color={cat.color} />
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{cat.label}</span>
                <span style={{ marginLeft: "auto", fontSize: "20px", fontWeight: 700, color: cat.color }}>{cat.data.count}</span>
                {hasDetails && (isExpanded ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />)}
              </div>

              {cat.data.details && cat.data.details.length > 0 && (
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  {cat.data.details.slice(0, isExpanded ? 10 : 2).map((d, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px", padding: "4px 0", gap: "8px" }}>
                      <span style={{ flex: 1, wordBreak: "break-word", lineHeight: 1.3 }}>{d.label}</span>
                      <span style={{ fontWeight: 600, color: d.distance_m < 500 ? "#10b981" : "#64748b", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {d.distance_m < 1000 ? `${d.distance_m}m` : `${(d.distance_m / 1000).toFixed(1)}km`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {hasDetails && cat.data.details.length > 2 && !isExpanded && (
                <div style={{ fontSize: "11px", color: cat.color, marginTop: "8px", fontWeight: 500 }}>
                  + {cat.data.details.length - 2} autres...
                </div>
              )}

              {(!cat.data.details || cat.data.details.length === 0) && cat.data.count === 0 && (
                <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>Aucun équipement trouvé</div>
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
  if (!analysePrix || !analysePrix.nb_etablissements_avec_prix) return null;

  const getInterpretationColor = (interpretation: string | null) => {
    if (!interpretation) return { bg: "#f1f5f9", color: "#64748b" };
    if (interpretation.includes("compétitif") || interpretation.includes("bas")) return { bg: "#dcfce7", color: "#166534" };
    if (interpretation.includes("élevé")) return { bg: "#fee2e2", color: "#991b1b" };
    return { bg: "#fef3c7", color: "#92400e" };
  };

  const interpColor = getInterpretationColor(analysePrix.interpretation);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <BadgeEuro size={20} color="#10b981" />
        Tarifs EHPAD - Département
        <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534", marginLeft: "auto" }}>
          {analysePrix.nb_etablissements_avec_prix} EHPAD avec tarifs
        </span>
        <span style={{ ...styles.badge, background: interpColor.bg, color: interpColor.color }}>
          {analysePrix.interpretation || "—"}
        </span>
      </div>

      <div style={{ background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", borderRadius: "14px", padding: "24px", textAlign: "center", marginBottom: "20px" }}>
        <div style={{ fontSize: "13px", color: "#059669", fontWeight: 600, marginBottom: "8px" }}>PRIX HÉBERGEMENT MÉDIAN</div>
        <div style={{ fontSize: "48px", fontWeight: 800, color: "#047857" }}>{analysePrix.prix_hebergement_median?.toFixed(0) ?? "—"} €</div>
        <div style={{ fontSize: "14px", color: "#059669" }}>par jour</div>
        {analysePrix.cout_mensuel_moyen_gir_1_2 && (
          <div style={{ marginTop: "16px", padding: "12px 20px", background: "rgba(255,255,255,0.7)", borderRadius: "10px", display: "inline-block" }}>
            <div style={{ fontSize: "11px", color: "#065f46", marginBottom: "4px" }}>Coût mensuel moyen (GIR 1-2)</div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#047857" }}>{formatNumber(analysePrix.cout_mensuel_moyen_gir_1_2)} €/mois</div>
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
            <div style={{ fontSize: "18px", fontWeight: 700, color: item.color }}>{item.value?.toFixed(2) ?? "—"} €</div>
            <div style={{ fontSize: "10px", color: "#94a3b8" }}>par jour</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fdf2f8", borderRadius: "12px", padding: "20px", borderLeft: "4px solid #ec4899" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Heart size={18} color="#ec4899" />
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#9d174d" }}>Tarifs dépendance moyens (GIR)</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {[
            { label: "GIR 1-2", desc: "Dépendance forte", value: analysePrix.tarif_gir_1_2_moyen },
            { label: "GIR 3-4", desc: "Dépendance modérée", value: analysePrix.tarif_gir_3_4_moyen },
            { label: "GIR 5-6", desc: "Autonomie relative", value: analysePrix.tarif_gir_5_6_moyen },
          ].map((gir, i) => (
            <div key={i} style={{ background: "white", borderRadius: "10px", padding: "14px", textAlign: "center", border: "1px solid #fbcfe8" }}>
              <div style={{ fontSize: "11px", color: "#be185d", fontWeight: 600, marginBottom: "4px" }}>{gir.label}</div>
              <div style={{ fontSize: "10px", color: "#9d174d", marginBottom: "8px" }}>{gir.desc}</div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#be185d" }}>{gir.value?.toFixed(2) ?? "—"} €</div>
              <div style={{ fontSize: "10px", color: "#9d174d" }}>par jour</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================
// EHPAD COMPETITION CARD
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
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#1e293b" }}>{formatNumber(total_lits)}</div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>Lits totaux</div>
        </div>
        <div style={{ padding: "16px", background: "#eef2ff", borderRadius: "12px", textAlign: "center" }}>
          <Users size={20} color="#4338ca" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#4338ca" }}>{formatNumber(demographie_senior.population_75_plus)}</div>
          <div style={{ fontSize: "11px", color: "#6366f1" }}>Pop. 75+ ans</div>
        </div>
        <div style={{ padding: "16px", background: "#f0fdf4", borderRadius: "12px", textAlign: "center" }}>
          <Activity size={20} color="#15803d" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#15803d" }}>{indicateurs_marche.densite_lits_1000_seniors ?? "—"}</div>
          <div style={{ fontSize: "11px", color: "#16a34a" }}>Lits/1000 seniors</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "14px 18px", background: "#f8fafc", borderRadius: "10px", borderLeft: `4px solid ${indicateurs_marche.taux_equipement_zone === "sous_equipe" ? "#10b981" : indicateurs_marche.taux_equipement_zone === "sur_equipe" ? "#ef4444" : "#f59e0b"}` }}>
          <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>Taux d'équipement</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b" }}>{getEquipementLabel(indicateurs_marche.taux_equipement_zone)}</div>
        </div>
        <div style={{ padding: "14px 18px", background: potentielColor.bg, borderRadius: "10px", borderLeft: `4px solid ${potentielColor.color}` }}>
          <div style={{ fontSize: "11px", color: potentielColor.color, marginBottom: "4px" }}>Potentiel marché</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: potentielColor.color, textTransform: "capitalize" }}>{indicateurs_marche.potentiel_marche}</div>
        </div>
      </div>

      {etablissements && etablissements.length > 0 && (
        <div>
          <button
            onClick={() => setShowList(!showList)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "14px 16px", background: "#fdf2f8", border: "1px solid #fbcfe8", borderRadius: "10px", cursor: "pointer", marginBottom: showList ? "12px" : "0" }}
          >
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#be185d" }}>
              📋 Liste des {etablissements.length} établissements FINESS
            </span>
            {showList ? <ChevronUp size={18} color="#be185d" /> : <ChevronDown size={18} color="#be185d" />}
          </button>

          {showList && (
            <div style={{ maxHeight: "500px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 80px 80px 100px", gap: "12px", padding: "12px 16px", background: "#f8fafc", borderBottom: "2px solid #e2e8f0", position: "sticky", top: 0, fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                <span>Établissement</span>
                <span style={{ textAlign: "center" }}>Distance</span>
                <span style={{ textAlign: "center" }}>Capacité</span>
                <span style={{ textAlign: "center" }}>Prix/jour</span>
              </div>
              {etablissements.map((etab, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 80px 80px 100px", gap: "12px", padding: "14px 16px", alignItems: "center", background: i % 2 === 0 ? "white" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>{etab.nom}</div>
                    {etab.finess && <span style={{ fontSize: "10px", color: "#94a3b8", fontFamily: "monospace", background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>FINESS: {etab.finess}</span>}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: etab.distance_m < 5000 ? "#10b981" : etab.distance_m < 10000 ? "#f59e0b" : "#64748b" }}>
                      {(etab.distance_m / 1000).toFixed(1)} km
                    </span>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "#ec4899" }}>{etab.capacite}</span>
                    <span style={{ fontSize: "10px", color: "#9d174d", display: "block" }}>{etab.capacite_estimee ? "lits (est.)" : "lits"}</span>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    {etab.tarifs?.hebergement_jour ? (
                      <>
                        <span style={{ fontSize: "16px", fontWeight: 700, color: "#10b981" }}>{etab.tarifs.hebergement_jour.toFixed(0)} €</span>
                        <span style={{ fontSize: "10px", color: "#059669", display: "block" }}>par jour</span>
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

      <div style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
        <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}><CheckCircle size={12} /> CNSA: {sources.cnsa_tarifs} EHPAD</span>
        <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}><MapPin size={12} /> OSM: {sources.overpass} établissements</span>
      </div>
    </div>
  );
};

// ============================================
// SCORE ADJUSTMENTS CARD
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
        <Activity size={20} color={ACCENT_PRO} />
        Analyse spécifique - {projectType}
        <span style={{ ...styles.badge, background: "#ede9fe", color: ACCENT_PRO, marginLeft: "auto" }}>
          Scoring différencié
        </span>
      </div>
      <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "16px" }}>{explanation}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {adjustments.map((adj, i) => (
          <div key={i} style={{
            padding: "8px 12px",
            background: adj.value > 0 ? "#dcfce7" : "#fee2e2",
            borderRadius: "8px", fontSize: "12px", fontWeight: 500,
            color: adj.value > 0 ? "#166534" : "#991b1b",
          }}>
            {adj.label} ({adj.value > 0 ? "+" : ""}{adj.value})
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// MARKET STUDY RESULTS - v2.8.1
// ============================================
const MarketStudyResults: React.FC<{ data: MarketStudyApiResponse }> = ({ data }) => {
  const { meta, core, insights, specific } = data;
  const projectConfig = getSafeProjectConfig(meta.project_type as ProjectType);

  const isEhpad = meta.project_type === "ehpad";
  const ehpadSpecific = isEhpad ? (specific as EhpadSpecific) : null;

  const { scores, adjustments, explanation } = useMemo(
    () => calculateDifferentiatedScores(data, meta.project_type),
    [data, meta.project_type]
  );

  const [synthesisSaved, setSynthesisSaved] = useState(false);

  const positiveInsights = insights.filter(i => i.type === "positive");
  const warningInsights = insights.filter(i => i.type === "warning" || i.type === "negative");
  const neutralInsights = insights.filter(i => i.type === "neutral");

  const handleGeneratePdf = useCallback(() => {
    const verdict = getVerdictConfig(scores.global);
    const scoreColor = getScoreColor(scores.global);
    const isEhpadLocal = meta.project_type === "ehpad";
    const ehpadS = isEhpadLocal ? (specific as EhpadSpecific) : null;

    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Autorisez les popups pour générer le PDF'); return; }

    const fmtN = (n: number | null | undefined, d = 0) =>
      n == null || isNaN(n) ? '—' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    const fmtP = (n: number | null | undefined) =>
      n == null || isNaN(n) ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
    const fmtPct = (n: number | null | undefined, sign = false) =>
      n == null || isNaN(n) ? '—' : `${sign && n > 0 ? '+' : ''}${fmtN(n, 1)}%`;
    const bar = (score: number | null | undefined) => {
      const v = score ?? 0;
      const c = v >= 70 ? '#10b981' : v >= 50 ? '#f59e0b' : v >= 35 ? '#f97316' : '#ef4444';
      return `<div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;">
          <div style="width:${v}%;height:100%;background:${c};border-radius:4px;"></div>
        </div>
        <span style="font-size:14px;font-weight:700;color:${c};min-width:28px;">${v}</span>
      </div>`;
    };
    const kpiBox = (label: string, value: string, color = '#1e293b') =>
      `<div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center;border:1px solid #e2e8f0;">
        <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:6px;">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color};">${value}</div>
      </div>`;
    const sectionTitle = (icon: string, title: string) =>
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid #e2e8f0;">
        <span style="font-size:18px;">${icon}</span>
        <span style="font-size:17px;font-weight:700;color:#1e293b;">${title}</span>
      </div>`;
    const section = (content: string) =>
      `<div style="background:white;border-radius:14px;padding:24px;margin-bottom:20px;border:1px solid #e2e8f0;page-break-inside:avoid;">${content}</div>`;
    const insightRow = (type: string, cat: string, msg: string) => {
      const cfg: Record<string, { bg: string; border: string; dot: string }> = {
        positive: { bg: '#ecfdf5', border: '#a7f3d0', dot: '#10b981' },
        warning:  { bg: '#fef3c7', border: '#fcd34d', dot: '#f59e0b' },
        negative: { bg: '#fee2e2', border: '#fca5a5', dot: '#ef4444' },
        neutral:  { bg: '#f1f5f9', border: '#cbd5e1', dot: '#64748b' },
      };
      const c = cfg[type] || cfg.neutral;
      return `<div style="padding:12px 14px;background:${c.bg};border:1px solid ${c.border};border-radius:8px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start;">
        <span style="width:8px;height:8px;border-radius:50%;background:${c.dot};margin-top:5px;flex-shrink:0;display:inline-block;"></span>
        <div><span style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;">${cat}</span><p style="font-size:13px;color:#1e293b;margin:3px 0 0 0;line-height:1.5;">${msg}</p></div>
      </div>`;
    };

    const insee = core.insee;
    const dvf = core.dvf;
    const revenu = insee?.revenu_median;
    const prixM2 = dvf?.prix_m2_median;
    const ratio = revenu && prixM2 && revenu > 0 ? ((prixM2 * 60) / revenu).toFixed(1) : null;

    const txRows = (dvf?.transactions || []).slice(0, 15).map((tx) =>
      `<tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px 10px;font-size:12px;color:#64748b;">${tx.date_mutation || '—'}</td>
        <td style="padding:8px 10px;font-size:12px;color:#1e293b;">${tx.type_local || '—'}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:600;color:#10b981;">${fmtP(tx.valeur_fonciere)}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#6366f1;">${fmtN(tx.prix_m2)} €/m²</td>
      </tr>`
    ).join('');

    const bpe = core.bpe;
    const bpeRows = bpe ? [
      { label: '🛒 Commerces', count: bpe.commerces?.count ?? 0, color: '#f59e0b' },
      { label: '🏥 Santé', count: bpe.sante?.count ?? 0, color: '#ef4444' },
      { label: '🏛 Services', count: bpe.services?.count ?? 0, color: '#3b82f6' },
      { label: '🎓 Éducation', count: bpe.education?.count ?? 0, color: '#8b5cf6' },
      { label: '🎭 Loisirs', count: bpe.loisirs?.count ?? 0, color: '#ec4899' },
      { label: '⚽ Sport', count: bpe.sport?.count ?? 0, color: '#10b981' },
    ].map(r =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:13px;color:#475569;">${r.label}</span>
        <span style="font-size:16px;font-weight:700;color:${r.color};">${r.count}</span>
      </div>`
    ).join('') : '<p style="color:#94a3b8;font-size:13px;">Non disponible</p>';

    const transport = core.transport;
    const stopRows = (transport?.stops || []).slice(0, 5).map(s =>
      `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:13px;color:#1e293b;">${s.name}</span>
        <span style="font-size:13px;font-weight:600;color:${s.distance_m < 500 ? '#10b981' : '#64748b'};">
          ${s.distance_m < 1000 ? s.distance_m + ' m' : (s.distance_m / 1000).toFixed(1) + ' km'}
        </span>
      </div>`
    ).join('');

    const ehpadSection = isEhpadLocal && ehpadS ? `
    ${section(`
      ${sectionTitle('🏥', 'EHPAD — Concurrence & Démographie senior')}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
        ${kpiBox('EHPAD zone', String(ehpadS.concurrence?.count ?? '—'), '#be185d')}
        ${kpiBox('Lits totaux', fmtN(ehpadS.concurrence?.total_lits), '#1e293b')}
        ${kpiBox('Pop. 75+ ans', fmtN(ehpadS.demographie_senior?.population_75_plus), '#4338ca')}
        ${kpiBox('Lits/1000 seniors', String(ehpadS.indicateurs_marche?.densite_lits_1000_seniors ?? '—'), '#15803d')}
      </div>
      ${ehpadS.analyse_prix ? `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
        ${kpiBox('Prix min/jour', fmtN(ehpadS.analyse_prix.prix_hebergement_min, 0) + ' €', '#3b82f6')}
        ${kpiBox('Prix médian/jour', fmtN(ehpadS.analyse_prix.prix_hebergement_median, 0) + ' €', '#10b981')}
        ${kpiBox('Prix moyen/jour', fmtN(ehpadS.analyse_prix.prix_hebergement_moyen, 0) + ' €', '#8b5cf6')}
        ${kpiBox('Prix max/jour', fmtN(ehpadS.analyse_prix.prix_hebergement_max, 0) + ' €', '#ef4444')}
      </div>
      ${ehpadS.analyse_prix.cout_mensuel_moyen_gir_1_2 ? `<p style="margin-top:14px;font-size:13px;color:#64748b;">Coût mensuel moyen GIR 1-2 : <strong style="color:#047857;">${fmtN(ehpadS.analyse_prix.cout_mensuel_moyen_gir_1_2)} €/mois</strong></p>` : ''}
      ` : ''}
    `)}` : '';

    // v2.8.1 : sous-scores PDF — masquer accessibilité si transport exclu
    const sousScoresPdf = [
      { label: 'Demande',       v: scores.demande },
      { label: 'Offre',         v: scores.offre },
      ...(!scores.transport_exclu ? [{ label: 'Accessibilité', v: scores.accessibilite }] : []),
      { label: 'Environnement', v: scores.environnement },
    ];

    const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Étude de Marché — ${meta.commune_nom}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Arial,sans-serif; background:#f8fafc; padding:40px; color:#1e293b; line-height:1.6; }
    @media print { body { padding:20px; background:white; } @page { margin:15mm; } }
    table { width:100%; border-collapse:collapse; }
    th { background:#f1f5f9; padding:10px 12px; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; text-align:left; }
  </style>
</head>
<body>
  <div style="background:linear-gradient(135deg,#1e293b 0%,#312e81 60%,#1e293b 100%);border-radius:16px;padding:36px 40px;margin-bottom:28px;color:white;">
    <div style="font-size:12px;opacity:0.6;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Mimmoza · Étude de Marché</div>
    <h1 style="font-size:32px;font-weight:800;margin-bottom:6px;">${meta.commune_nom}</h1>
    <p style="font-size:14px;opacity:0.75;margin-bottom:28px;">${meta.project_type_label} · Département ${meta.departement} · Rayon ${meta.radius_km} km · v${data.version}</p>
    <div style="display:grid;grid-template-columns:160px 1fr auto;gap:32px;align-items:center;">
      <div style="text-align:center;background:rgba(255,255,255,0.1);border-radius:14px;padding:20px;">
        <div style="font-size:56px;font-weight:800;color:${scoreColor};line-height:1;">${scores.global}</div>
        <div style="font-size:12px;opacity:0.6;margin-bottom:8px;">/100</div>
        <div style="padding:6px 14px;background:${verdict.bg};color:${verdict.color};border-radius:8px;font-weight:700;font-size:13px;display:inline-block;">${verdict.label}</div>
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:14px;padding:20px;">
        <div style="font-size:11px;opacity:0.65;font-weight:600;text-transform:uppercase;margin-bottom:14px;">Sous-scores (${meta.project_type}${scores.transport_exclu ? ' — transport non applicable' : ''})</div>
        ${sousScoresPdf.map(s => {
          const c = s.v >= 70 ? '#10b981' : s.v >= 50 ? '#f59e0b' : s.v >= 35 ? '#f97316' : '#ef4444';
          return `<div style="margin-bottom:10px;display:flex;align-items:center;gap:12px;">
            <span style="font-size:12px;opacity:0.8;min-width:90px;">${s.label}</span>
            <div style="flex:1;height:7px;background:rgba(255,255,255,0.2);border-radius:4px;">
              <div style="width:${s.v}%;height:100%;background:${c};border-radius:4px;"></div>
            </div>
            <span style="font-size:13px;font-weight:700;color:${c};min-width:24px;">${s.v}</span>
          </div>`;
        }).join('')}
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:14px;padding:20px;min-width:180px;">
        <div style="font-size:11px;opacity:0.65;font-weight:600;text-transform:uppercase;margin-bottom:14px;">Données clés</div>
        ${[
          { label: 'Population', value: fmtN(insee?.population) },
          { label: 'Prix médian m²', value: prixM2 ? fmtN(prixM2) + ' €' : '—' },
          { label: 'Transactions DVF', value: fmtN(dvf?.nb_transactions) },
          { label: 'Transport', value: transport?.is_urban === false ? 'Non-urbain' : transport?.score != null ? transport.score + '/100' : '—' },
        ].map(k => `<div style="margin-bottom:8px;"><div style="font-size:10px;opacity:0.6;">${k.label}</div><div style="font-size:15px;font-weight:700;">${k.value}</div></div>`).join('')}
      </div>
    </div>
  </div>

  ${adjustments.length > 0 ? section(`
    ${sectionTitle('🎯', 'Facteurs d\'ajustement — Scoring ' + meta.project_type)}
    <p style="font-size:12px;color:#64748b;margin-bottom:14px;">${explanation}</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${adjustments.map(a => `<span style="padding:6px 12px;background:${a.value > 0 ? '#dcfce7' : '#fee2e2'};border-radius:8px;font-size:12px;font-weight:600;color:${a.value > 0 ? '#166534' : '#991b1b'};">${a.label} (${a.value > 0 ? '+' : ''}${a.value})</span>`).join('')}
    </div>
  `) : ''}

  ${(positiveInsights.length > 0 || warningInsights.length > 0) ? section(`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      ${positiveInsights.length > 0 ? `<div>${sectionTitle('✅', 'Points forts (' + positiveInsights.length + ')')}${positiveInsights.map(i => insightRow(i.type, i.category, i.message)).join('')}</div>` : ''}
      ${warningInsights.length > 0 ? `<div>${sectionTitle('⚠️', 'Vigilance (' + warningInsights.length + ')')}${warningInsights.map(i => insightRow(i.type, i.category, i.message)).join('')}</div>` : ''}
    </div>
  `) : ''}

  ${section(`
    ${sectionTitle('💰', 'Marché Immobilier — DVF')}
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:${dvf?.transactions?.length ? '24px' : '0'};">
      ${kpiBox('Transactions', fmtN(dvf?.nb_transactions), '#6366f1')}
      ${kpiBox('Prix min', fmtN(dvf?.prix_m2_min) + ' €', '#3b82f6')}
      ${kpiBox('Prix médian', fmtN(dvf?.prix_m2_median) + ' €', '#10b981')}
      ${kpiBox('Prix moyen', fmtN(dvf?.prix_m2_moyen) + ' €', '#8b5cf6')}
      ${kpiBox('Prix max', fmtN(dvf?.prix_m2_max) + ' €', '#ef4444')}
    </div>
    ${txRows ? `<table><thead><tr><th>Date</th><th>Type</th><th>Prix total</th><th>Prix/m²</th></tr></thead><tbody>${txRows}</tbody></table>` : ''}
  `)}

  ${section(`
    ${sectionTitle('👥', 'Démographie & Économie — INSEE · ' + (insee?.commune_nom || meta.commune_nom))}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
      ${kpiBox('Population', fmtN(insee?.population), '#4338ca')}
      ${kpiBox('Densité', fmtN(insee?.densite) + ' hab/km²', '#15803d')}
      ${kpiBox('Revenu médian', revenu != null ? fmtP(revenu) + '/an' : '—', '#10b981')}
      ${kpiBox('Taux chômage', fmtPct(insee?.taux_chomage), (insee?.taux_chomage ?? 0) > 10 ? '#ef4444' : '#f59e0b')}
    </div>
    ${ratio ? `<p style="font-size:13px;color:#64748b;">Ratio prix/revenu : <strong style="color:#5247b8;">~${ratio} ans de revenus pour 60 m²</strong></p>` : ''}
  `)}

  ${section(`
    ${sectionTitle('🚇', 'Accessibilité Transport')}
    ${transport?.is_urban === false
      ? `<p style="font-size:13px;color:#64748b;font-style:italic;">Zone non-urbaine — critère transport non pris en compte dans le score global.</p>`
      : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
          <div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
              ${kpiBox('Score transport', transport?.score != null ? transport.score + '/100' : '—', getScoreColor(transport?.score))}
              ${kpiBox('Arrêt le plus proche', transport?.nearest_stop_m != null ? (transport.nearest_stop_m < 1000 ? transport.nearest_stop_m + ' m' : (transport.nearest_stop_m / 1000).toFixed(1) + ' km') : '—', '#6366f1')}
            </div>
          </div>
          <div>${stopRows || '<p style="font-size:13px;color:#94a3b8;font-style:italic;">Non disponible</p>'}</div>
        </div>
        ${bar(transport?.score)}`
    }
  `)}

  ${section(`
    ${sectionTitle('🏪', 'Services & Équipements — BPE')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <div style="margin-bottom:14px;">${kpiBox('Score BPE', bpe?.score != null ? bpe.score + '/100' : '—', getScoreColor(bpe?.score))}</div>
        ${kpiBox('Total équipements', fmtN(bpe?.total_equipements), '#1e293b')}
      </div>
      <div>${bpeRows}</div>
    </div>
  `)}

  ${ehpadSection}

  <div style="text-align:center;padding-top:24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;">
    <p>Rapport généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    <p style="margin-top:4px;">Mimmoza · Plateforme d'analyse immobilière intelligente · Sources : DVF data.gouv.fr, INSEE, GTFS, BPE${isEhpadLocal ? ', CNSA/FINESS' : ''}</p>
  </div>
</body>
</html>`;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => { setTimeout(() => { printWindow.print(); }, 300); };
  }, [data, meta, core, specific, scores, adjustments, explanation, positiveInsights, warningInsights, neutralInsights]);

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
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>{ehpadSpecific.analyse_prix.prix_hebergement_median.toFixed(0)}€</div>
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
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>{ehpadSpecific?.concurrence?.nb_ehpad_departement ?? "—"}</div>
                  </div>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Transactions DVF</div>
                    <div style={{ fontSize: "24px", fontWeight: 700 }}>{core.dvf?.nb_transactions ?? "—"}</div>
                  </div>
                )}
              </div>
            </div>

            {/* v2.8.1 : sous-scores — masquer Accessibilité si transport_exclu */}
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px", opacity: 0.9 }}>
                Sous-scores ({meta.project_type})
                {scores.transport_exclu && (
                  <div style={{ fontSize: "10px", opacity: 0.65, fontWeight: 400, marginTop: "3px" }}>
                    Transport non applicable (zone non-urbaine)
                  </div>
                )}
              </div>
              {(
                [
                  { label: "Demande",       score: scores.demande,       key: "demande"       },
                  { label: "Offre",         score: scores.offre,         key: "offre"         },
                  // v2.8.1 : masquer Accessibilité si transport exclu
                  ...(!scores.transport_exclu
                    ? [{ label: "Accessibilité", score: scores.accessibilite, key: "accessibilite" as const }]
                    : []
                  ),
                  { label: "Environnement", score: scores.environnement, key: "environnement" },
                ] as const
              ).map((item, i) => (
                <div key={i} style={{ marginBottom: "10px" }}>
                  <ScoreTooltip content={SCORE_TOOLTIPS[item.key]} position="left">
                    <span style={{ fontSize: "12px", opacity: 0.8, width: "90px", flexShrink: 0 }}>
                      {item.label}
                    </span>
                    <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.2)", borderRadius: "3px" }}>
                      <div style={{
                        width: `${item.score ?? 0}%`, height: "100%",
                        background: getScoreColor(item.score), borderRadius: "3px"
                      }} />
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 600, width: "28px", textAlign: "right", flexShrink: 0 }}>
                      {item.score ?? "—"}
                    </span>
                  </ScoreTooltip>
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
            <EhpadPricingCard analysePrix={ehpadSpecific.analyse_prix} concurrence={ehpadSpecific.concurrence} />
          </div>
        )}

        {/* EHPAD Competition */}
        {isEhpad && ehpadSpecific && (
          <div style={{ marginBottom: "24px" }}>
            <EhpadCompetitionCard specific={ehpadSpecific} />
          </div>
        )}

        {/* DVF + Démographie */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <DvfCard dvf={core.dvf} />
          <DemographieCard insee={core.insee} projectType={meta.project_type} ehpadSpecific={ehpadSpecific} />
        </div>

        {/* Lecture économique décisionnelle */}
        <EconomicDecisionCard insee={core.insee} dvf={core.dvf} projectType={meta.project_type} />

        {/* Pyramide des âges */}
        <AgePyramidChart insee={core.insee} />

        {/* Transport + BPE */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(400px, 2fr)", gap: "24px", marginBottom: "24px" }}>
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
                <div key={key} style={{ padding: "8px 14px", background: "white", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{key}: </span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: value > 1000 ? "#ef4444" : "#10b981" }}>{value}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "32px" }}>
          <button
            onClick={() => {
              const { scores: s } = calculateDifferentiatedScores(data, meta.project_type);
              patchModule("market", { ok: true, validated: true, summary: `Score: ${s.global}/100 - ${meta.commune_nom}`, data });
              setSynthesisSaved(true);
              setTimeout(() => setSynthesisSaved(false), 3000);
            }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px",
              background: synthesisSaved
                ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                : `linear-gradient(135deg, ${ACCENT_PRO} 0%, #7c6fcd 100%)`,
              color: "white", border: "none", borderRadius: "12px",
              fontSize: "14px", fontWeight: 600, cursor: "pointer",
            }}
          >
            <Target size={18} />
            {synthesisSaved ? "✓ Enregistré dans la synthèse" : "Utiliser pour la synthèse"}
          </button>
          <button
            onClick={handleGeneratePdf}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 28px", background: "#1e293b", color: "white", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
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
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 28px", background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
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
// COMPOSANT PRINCIPAL - MarchePage v2.8.1
// ============================================
export function MarchePage() {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  const { study, loadState, patchMarche } = usePromoteurStudy(studyId);

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
  const [synthesisSaved, setSynthesisSaved] = useState(false);

  const addressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parcelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const projectConfig = useMemo(() => getSafeProjectConfig(projectNature), [projectNature]);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;
    if (study.foncier?.commune_insee && !codeInsee) setCodeInsee(study.foncier.commune_insee);
    if (study.foncier?.focus_id && !parcelId) setParcelId(study.foncier.focus_id);
    if (study.marche?.raw_data && !analysisResult) setAnalysisResult(study.marche.raw_data as MarketStudyApiResponse);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, study]);

  useEffect(() => {
    if (addressTimeoutRef.current) clearTimeout(addressTimeoutRef.current);
    if (address.length >= 3 && !selectedAddress) {
      setIsSearchingAddress(true);
      addressTimeoutRef.current = setTimeout(async () => {
        const suggestions = await searchAddress(address);
        if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        setParcelInfo(info);
        setIsSearchingParcel(false);
        if (info?.lat && info?.lon) { setLatitude(info.lat.toFixed(6)); setLongitude(info.lon.toFixed(6)); }
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
    if (!hasLocation) { setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE)."); return; }

    log('🚀', 'Starting analysis', { latitude, longitude, codeInsee, radius, projectNature });

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);

    const lat = latitude ? parseFloat(latitude) : NaN;
    const lon = longitude ? parseFloat(longitude) : NaN;

    try {
      const payload: Record<string, unknown> = { project_type: projectNature, radius_km: radius, debug: true };
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) { payload.lat = lat; payload.lon = lon; }
      if (codeInsee) payload.commune_insee = codeInsee;
      if (parcelId && parcelId.trim().length >= 10) payload.parcel_id = parcelId.trim();

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Configuration Supabase manquante");

      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 55000);

      let apiResponse: Response;
      try {
        apiResponse = await fetch(`${SUPABASE_URL}/functions/v1/market-study-promoteur-v1`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimeout);
      }

      const result = await apiResponse.json();

      if (!apiResponse.ok || !result.success) throw new Error(result.error || `Erreur ${apiResponse.status}`);

      const typedResult = result as MarketStudyApiResponse;
      if (!mountedRef.current) return;
      setAnalysisResult(typedResult);

      const { scores } = calculateDifferentiatedScores(typedResult, projectNature);

      const marchePayload: PromoteurMarcheData = {
        prix_m2_median:   typedResult.core.dvf?.prix_m2_median ?? null,
        prix_m2_neuf:     null,
        prix_m2_ancien:   typedResult.core.dvf?.prix_m2_median ?? null,
        tension_marche:   scores.global >= 70 ? "forte" : scores.global >= 50 ? "moyenne" : "faible",
        taux_vacance_pct: typedResult.core.insee?.pct_logements_vacants ?? null,
        zone_pinel:       null,
        score_marche:     scores.global,
        smart_scores:     { demande: scores.demande, offre: scores.offre, accessibilite: scores.accessibilite, environnement: scores.environnement },
        raw_data: typedResult as unknown as Record<string, unknown>,
        done: true,
      };

      if (studyId) patchMarche(marchePayload).catch(e => console.error("[MarchePage] patchMarche failed:", e));

      try {
        patchProjectInfo({ address: selectedAddress?.label || address || undefined, city: typedResult?.meta?.commune_nom || undefined, projectType: projectNature, lat: typedResult?.meta?.lat, lon: typedResult?.meta?.lon });
        patchModule("market", { ok: true, summary: `Score: ${typedResult?.scores?.global}/100 - ${typedResult?.meta?.commune_nom}`, data: typedResult });
      } catch (snapshotErr) { log('❌', 'Snapshot error', snapshotErr); }

      setTimeout(() => { if (mountedRef.current) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        const msg = "L'analyse a dépassé 55s. Réessayez — les données sont généralement disponibles au 2e essai.";
        if (mountedRef.current) setError(msg);
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Une erreur est survenue";
      if (mountedRef.current) setError(errorMessage);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [latitude, longitude, codeInsee, parcelInfo, radius, projectNature, selectedAddress, address, studyId, patchMarche]);

  const studyInsee = study?.foncier?.commune_insee ?? null;

  return (
    <ErrorBoundary componentName="MarchePage">
      <div style={styles.container}>

        {/* Bannière */}
        <div style={{
          background: GRAD_PRO, borderRadius: 14, padding: "20px 24px",
          margin: "16px 40px 0 40px",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Études</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4, display: "flex", alignItems: "center", gap: 10 }}>
              <SafeIcon icon={projectConfig.icon} fallback={Building2} size={22} color="white" />
              Étude de Marché
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
              {projectConfig.description}. Scoring adapté au type de projet avec bonus/pénalités contextuels.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 4 }}>
            {studyInsee && (
              <span style={{ padding: "6px 12px", background: "rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "white", border: "1px solid rgba(255,255,255,0.25)" }}>
                INSEE {studyInsee}
              </span>
            )}
            <span style={{ padding: "6px 12px", background: "rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "white", border: "1px solid rgba(255,255,255,0.25)" }}>
              {projectConfig.label}
            </span>
            {analysisResult && (
              <button
                onClick={() => {
                  const { scores } = calculateDifferentiatedScores(analysisResult, projectNature);
                  patchModule("market", { ok: true, validated: true, summary: `Score: ${scores.global}/100 - ${analysisResult.meta.commune_nom}`, data: analysisResult });
                  setSynthesisSaved(true);
                  setTimeout(() => setSynthesisSaved(false), 3000);
                }}
                style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.4)", background: synthesisSaved ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.15)", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                {synthesisSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 13, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}
            >
              {isLoading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={14} />}
              {isLoading ? "Analyse…" : "Lancer l'analyse"}
            </button>
          </div>
        </div>

        {/* Contenu principal */}
        <div style={styles.mainContent}>
          {/* Formulaire */}
          <div style={styles.formSection}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: `linear-gradient(135deg, ${ACCENT_PRO} 0%, #7c6fcd 100%)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Target size={22} color="white" />
              </div>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: 0 }}>Paramètres de l'analyse</h2>
                <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Renseignez la localisation et les caractéristiques de votre projet</p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
              {/* Adresse */}
              {(() => {
                const hasAddress = address.length > 0 || selectedAddress != null;
                const hasParcel  = parcelId.length > 0;
                const bothFilled = hasAddress && hasParcel;
                const addressDisabled = (hasParcel || codeInsee.length > 0) && !hasAddress;

                return (
                  <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                      <MapPin size={14} color={ACCENT_PRO} />
                      Adresse
                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", background: "#ede9fe", color: ACCENT_PRO, borderRadius: "4px", marginLeft: "8px" }}>RECOMMANDÉ</span>
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        placeholder="Ex: 12 rue de la République, Lyon"
                        value={address}
                        disabled={addressDisabled}
                        onChange={(e) => { setAddress(e.target.value); if (selectedAddress) setSelectedAddress(null); }}
                        style={{ ...styles.input, paddingRight: "40px", opacity: addressDisabled ? 0.45 : 1, cursor: addressDisabled ? "not-allowed" : undefined, background: addressDisabled ? "#f1f5f9" : undefined }}
                      />
                      {isSearchingAddress && <Loader2 size={18} color={ACCENT_PRO} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", animation: "spin 1s linear infinite" }} />}
                      {address && !isSearchingAddress && !addressDisabled && (
                        <button onClick={() => { setAddress(""); setSelectedAddress(null); }} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                          <X size={16} color="#94a3b8" />
                        </button>
                      )}
                      {addressSuggestions.length > 0 && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100, maxHeight: "220px", overflowY: "auto", marginTop: "4px" }}>
                          {addressSuggestions.map((s, i) => (
                            <div key={i} onClick={() => handleSelectAddress(s)}
                              style={{ padding: "12px 14px", cursor: "pointer", fontSize: "13px", color: "#1e293b", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid #f1f5f9" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            >
                              <MapPin size={14} color="#64748b" />
                              {s.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {addressDisabled && (
                      <div style={{ fontSize: "12px", color: "#d97706", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertTriangle size={13} color="#d97706" />
                        Videz la parcelle{codeInsee.length > 0 && parcelId.length > 0 ? " et le code INSEE" : codeInsee.length > 0 ? " le code INSEE" : ""} pour saisir une adresse
                      </div>
                    )}
                    {selectedAddress && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#ecfdf5", borderRadius: "8px" }}>
                        <CheckCircle size={16} color="#10b981" />
                        <span style={{ fontSize: "13px", color: "#065f46" }}>
                          {selectedAddress.lat.toFixed(5)}, {selectedAddress.lon.toFixed(5)}
                          {selectedAddress.citycode && ` • INSEE: ${selectedAddress.citycode}`}
                        </span>
                      </div>
                    )}
                    {bothFilled && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "8px", fontSize: "12px", color: "#92400e" }}>
                        <AlertTriangle size={14} color="#d97706" />
                        Vérifiez que l'adresse correspond au numéro de parcelle cadastrale
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Parcelle */}
              {(() => {
                const hasAddress = address.length > 0 || selectedAddress != null;
                const hasParcel  = parcelId.length > 0;
                const parcelDisabled = hasAddress && !hasParcel;

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Grid3X3 size={14} color={ACCENT_PRO} />
                      N° Parcelle cadastrale
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 69123000AI0001"
                      value={parcelId}
                      disabled={parcelDisabled}
                      onChange={(e) => setParcelId(e.target.value)}
                      style={{ ...styles.input, opacity: parcelDisabled ? 0.45 : 1, cursor: parcelDisabled ? "not-allowed" : undefined, background: parcelDisabled ? "#f1f5f9" : undefined }}
                    />
                    {parcelDisabled && (
                      <div style={{ fontSize: "12px", color: "#d97706", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertTriangle size={13} color="#d97706" />
                        Videz l'adresse pour saisir une parcelle
                      </div>
                    )}
                  </div>
                );
              })()}

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

              {/* Nature projet */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Building2 size={14} color={ACCENT_PRO} />
                  Nature du projet
                </label>
                <select value={projectNature} onChange={(e) => setProjectNature(e.target.value as ProjectType)} style={styles.select}>
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
                  <Compass size={14} color={ACCENT_PRO} />
                  Rayon: <strong style={{ color: ACCENT_PRO }}>{radius} km</strong>
                </label>
                <input type="range" min={1} max={30} step={1} value={radius} onChange={(e) => setRadius(parseInt(e.target.value))} style={{ width: "100%", marginTop: "8px", accentColor: ACCENT_PRO }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
                  <span>1 km</span>
                  <span style={{ color: ACCENT_PRO, fontWeight: 500 }}>Recommandé: {projectConfig.radius.analysis} km</span>
                  <span>30 km</span>
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginTop: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
                <AlertTriangle size={18} color="#dc2626" />
                <span style={{ fontSize: "14px", color: "#991b1b" }}>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: "28px" }}>
              <button onClick={handleSubmit} disabled={isLoading} style={{ ...styles.submitButton, opacity: isLoading ? 0.7 : 1, cursor: isLoading ? "not-allowed" : "pointer" }}>
                {isLoading ? (
                  <><Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />Analyse en cours...</>
                ) : (
                  <><Search size={20} />Lancer l'analyse de marché</>
                )}
              </button>
            </div>
          </div>

          {/* Résultats */}
          <div ref={resultsRef}>
            {isLoading && (
              <div style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px" }}>
                <Loader2 size={56} color={ACCENT_PRO} style={{ animation: "spin 1s linear infinite", marginBottom: "20px" }} />
                <h3 style={{ fontSize: "20px", color: "#1e293b", marginBottom: "8px" }}>Analyse en cours...</h3>
                <p style={{ fontSize: "14px", color: "#64748b" }}>Récupération des données DVF, INSEE, transport, équipements et tarifs CNSA</p>
              </div>
            )}

            {!isLoading && analysisResult && (
              <MarketStudyResults data={analysisResult} />
            )}

            {!isLoading && !analysisResult && (
              <div style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px", textAlign: "center" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "24px" }}>
                  <SafeIcon icon={projectConfig.icon} fallback={Building2} size={36} color={ACCENT_PRO} />
                </div>
                <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                  Nouvelle étude de marché - {projectConfig.label}
                </h3>
                <p style={{ fontSize: "15px", color: "#64748b", maxWidth: "500px", lineHeight: 1.6 }}>
                  Entrez une adresse, un numéro de parcelle, des coordonnées GPS ou un code INSEE
                  pour lancer une analyse complète avec scoring adapté à votre type de projet.
                </p>
                <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                  <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>✅ Scoring différencié v2.8.1</span>
                  <span style={{ ...styles.badge, background: "#ede9fe", color: ACCENT_PRO }}>DVF + INSEE</span>
                  <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>Transport + BPE</span>
                  <span style={{ ...styles.badge, background: "#fdf2f8", color: "#be185d" }}>EHPAD FINESS</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          input:focus, select:focus { border-color: ${ACCENT_PRO} !important; box-shadow: 0 0 0 3px ${ACCENT_PRO}20 !important; }
          button:hover:not(:disabled) { transform: translateY(-1px); }
        `}</style>
      </div>
    </ErrorBoundary>
  );
}

export default MarchePage;