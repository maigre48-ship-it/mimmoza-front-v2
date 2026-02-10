// ============================================
// RisquesPage.tsx - VERSION 1.3.0
// ============================================
// Étude de risques pour une parcelle/adresse
// Sources: Géorisques API, données gouvernementales
// + 🆕 Banque scoring via banque-risques-v1
//   → Refactoré : utilise <BanqueRiskScoreCard />
// ============================================

import React, { useState, useCallback, useEffect, useRef, Component, ErrorInfo, ReactNode } from "react";
import { 
  Search, MapPin, Grid3X3, Loader2, X, 
  AlertTriangle, CheckCircle, Shield, ShieldAlert, ShieldOff, ShieldCheck,
  Activity, Download, FileText, ChevronDown, ChevronUp,
  Flame, Droplets, Mountain, Factory, Atom, AlertOctagon,
  Layers, CircleDot, Compass,
  Target, Info,
  Bug, Skull,
  Landmark, // 🆕 Banque scoring icon (kept for error display)
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

// Services partagés depuis le module marché
import { searchAddress } from "../marche/services/address.service";
import { searchParcel } from "../marche/services/parcel.service";

// Types partagés
import type {
  AddressSuggestion,
  ParcelInfo,
} from "../marche/types/market.types";

// ============================================
// IMPORT SNAPSHOT STORE
// ============================================
import { patchProjectInfo, patchModule } from "../../shared/promoteurSnapshot.store";

// ============================================
// 🆕 Banque scoring – composant réutilisable
// ============================================
import { BanqueRiskScoreCard } from "../../../../components/banque/BanqueRiskScoreCard";
import type { BankRiskScoring, BankRiskScoringGrade } from "../../../../components/banque/BanqueRiskScoreCard";

// ============================================
// DEBUG
// ============================================
const DEBUG_MODE = true;
const log = (prefix: string, message: string, data?: unknown) => {
  if (DEBUG_MODE) console.log(`${prefix} ${message}`, data ?? '');
};

// ============================================================================
// TYPES
// ============================================================================

type RiskLevel = 'tres_fort' | 'fort' | 'moyen' | 'faible' | 'nul' | 'inconnu';
type InsightType = 'critical' | 'warning' | 'positive' | 'info';

interface RiskScores {
  global: number;
  naturels: number;
  technologiques: number;
  pollution: number;
  geotechniques: number;
}

interface RiskItem {
  name: string;
  level: RiskLevel;
  detail: string;
}

interface RiskCategory {
  name: string;
  score: number;
  level: RiskLevel;
  risks: RiskItem[];
}

interface Insight {
  type: InsightType;
  category: string;
  message: string;
}

interface CatnatEvent {
  code_national_catnat: string;
  date_debut: string;
  date_fin: string;
  date_publication_jo: string;
  libelle_risque: string;
}

interface GasparData {
  catnat_count: number;
  catnat_events: CatnatEvent[];
  ppr_count: number;
  ppr_list: Array<{ code: string; libelle: string; etat: string }>;
  coverage: string;
}

interface RadonData {
  classe_potentiel: number | null;
  libelle: string;
  risk_level: RiskLevel;
  coverage: string;
}

interface Installation {
  nom: string;
  raison_sociale: string;
  adresse: string;
  commune: string;
  regime: string;
  seveso: string | null;
  distance_m: number | null;
  activite: string;
}

interface IcpeData {
  count: number;
  seveso_haut_count: number;
  seveso_bas_count: number;
  installations: Installation[];
  risk_level: RiskLevel;
  coverage: string;
}

interface SisData {
  count: number;
  sites: Array<{
    id: string;
    nom: string;
    adresse: string;
    commune: string;
    superficie_m2: number | null;
  }>;
  risk_level: RiskLevel;
  coverage: string;
}

interface CaviteData {
  count: number;
  cavites: Array<{
    id: string;
    type: string;
    nom: string;
    profondeur_m: number | null;
    distance_m: number | null;
  }>;
  risk_level: RiskLevel;
  coverage: string;
}

interface MvtData {
  count: number;
  mouvements: Array<{
    id: string;
    type: string;
    date: string;
    precision: string;
    distance_m: number | null;
  }>;
  risk_level: RiskLevel;
  coverage: string;
}

interface ArgilesData {
  niveau_alea: string | null;
  risk_level: RiskLevel;
  coverage: string;
}

interface InondationData {
  zone_inondable: boolean;
  type_zone: string | null;
  tri: string | null;
  ppri: boolean;
  risk_level: RiskLevel;
  coverage: string;
}

interface SeismeData {
  zone: number | null;
  libelle: string;
  risk_level: RiskLevel;
  coverage: string;
}

interface FeuxForetData {
  zone_risque: boolean;
  obligation_debroussaillement: boolean;
  risk_level: RiskLevel;
  coverage: string;
}

interface RiskStudyApiResponse {
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
    region: string;
    radius_km: number;
    generated_at: string;
  };
  scores: RiskScores;
  categories: RiskCategory[];
  data: {
    gaspar: GasparData;
    radon: RadonData;
    icpe: IcpeData;
    sis: SisData;
    cavites: CaviteData;
    mouvements_terrain: MvtData;
    argiles: ArgilesData;
    inondation: InondationData;
    seisme: SeismeData;
    feux_foret: FeuxForetData;
  };
  insights: Insight[];
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
// HELPERS
// ============================================

const formatNumber = (n: number | null | undefined, decimals = 0): string => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

const formatDistance = (m: number | null | undefined): string => {
  if (m == null) return "—";
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

const getRiskColor = (level: RiskLevel): string => {
  switch (level) {
    case 'tres_fort': return "#991b1b";
    case 'fort': return "#dc2626";
    case 'moyen': return "#f59e0b";
    case 'faible': return "#22c55e";
    case 'nul': return "#10b981";
    default: return "#94a3b8";
  }
};

const getRiskBg = (level: RiskLevel): string => {
  switch (level) {
    case 'tres_fort': return "#fef2f2";
    case 'fort': return "#fee2e2";
    case 'moyen': return "#fef3c7";
    case 'faible': return "#dcfce7";
    case 'nul': return "#ecfdf5";
    default: return "#f1f5f9";
  }
};

const getRiskLabel = (level: RiskLevel): string => {
  switch (level) {
    case 'tres_fort': return "Très fort";
    case 'fort': return "Fort";
    case 'moyen': return "Moyen";
    case 'faible': return "Faible";
    case 'nul': return "Nul";
    default: return "Inconnu";
  }
};

const getScoreColor = (score: number): string => {
  if (score >= 60) return "#dc2626";
  if (score >= 40) return "#f59e0b";
  if (score >= 20) return "#22c55e";
  return "#10b981";
};

const getVerdictConfig = (score: number) => {
  if (score >= 60) return { label: "RISQUE ÉLEVÉ", color: "#991b1b", bg: "#fee2e2", icon: ShieldOff };
  if (score >= 40) return { label: "VIGILANCE", color: "#d97706", bg: "#fef3c7", icon: ShieldAlert };
  if (score >= 20) return { label: "RISQUE FAIBLE", color: "#059669", bg: "#dcfce7", icon: Shield };
  return { label: "ZONE SÛRE", color: "#047857", bg: "#ecfdf5", icon: ShieldCheck };
};

// 🆕 Banque scoring – helpers pour PDF uniquement (grade → couleur)
const getBankGradeColor = (grade: BankRiskScoringGrade): string => {
  switch (grade) {
    case "A": return "#047857";
    case "B": return "#059669";
    case "C": return "#d97706";
    case "D": return "#dc2626";
    case "E": return "#991b1b";
  }
};

// ============================================
// STYLES
// ============================================

const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #fef2f2 0%, #fff7ed 50%, #fefce8 100%)",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  } as React.CSSProperties,
  
  header: {
    background: "linear-gradient(135deg, #7f1d1d 0%, #991b1b 50%, #b91c1c 100%)",
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
    border: "1px solid #fecaca",
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
  
  submitButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "14px 32px",
    background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "0 4px 12px rgba(220, 38, 38, 0.3)",
  } as React.CSSProperties,
};

// ============================================
// RISK GAUGE
// ============================================
const RiskGauge: React.FC<{ score: number; size?: number }> = ({ score, size = 160 }) => {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = getScoreColor(score);
  const verdict = getVerdictConfig(score);
  const VerdictIcon = verdict.icon;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#fee2e2" strokeWidth="12" />
          <circle
            cx={size/2} cy={size/2} r={radius}
            fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
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
          <span style={{ fontSize: size * 0.25, fontWeight: 800, color }}>{score}</span>
          <span style={{ fontSize: size * 0.08, color: "#94a3b8", fontWeight: 500 }}>/ 100</span>
        </div>
      </div>
      <div style={{
        ...styles.badge,
        background: verdict.bg,
        color: verdict.color,
        padding: "8px 16px",
        fontSize: "13px",
      }}>
        <VerdictIcon size={16} />
        {verdict.label}
      </div>
    </div>
  );
};

// ============================================
// CATEGORY SCORE BAR
// ============================================
const CategoryScoreBar: React.FC<{ 
  name: string; 
  score: number; 
  level: RiskLevel;
  icon: LucideIcon;
}> = ({ name, score, level, icon: Icon }) => {
  const color = getRiskColor(level);
  
  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon size={16} color={color} />
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>{name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ 
            fontSize: "11px", 
            padding: "2px 8px", 
            background: getRiskBg(level), 
            color: color,
            borderRadius: "4px",
            fontWeight: 600
          }}>
            {getRiskLabel(level)}
          </span>
          <span style={{ fontSize: "14px", fontWeight: 700, color }}>{score}</span>
        </div>
      </div>
      <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ 
          width: `${score}%`, 
          height: "100%", 
          background: color,
          borderRadius: "4px",
          transition: "width 0.8s ease-out"
        }} />
      </div>
    </div>
  );
};

// ============================================
// INSIGHT CARD
// ============================================
const InsightCard: React.FC<{ insight: Insight }> = ({ insight }) => {
  const configs: Record<InsightType, { bg: string; border: string; color: string; icon: LucideIcon }> = {
    critical: { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", icon: AlertOctagon },
    warning: { bg: "#fef3c7", border: "#fcd34d", color: "#92400e", icon: AlertTriangle },
    positive: { bg: "#ecfdf5", border: "#a7f3d0", color: "#065f46", icon: CheckCircle },
    info: { bg: "#f0f9ff", border: "#bae6fd", color: "#0369a1", icon: Info },
  };
  
  const config = configs[insight.type];
  const Icon = config.icon;
  
  return (
    <div style={{ 
      padding: "14px 16px", 
      background: config.bg, 
      border: `1px solid ${config.border}`, 
      borderRadius: "10px",
      marginBottom: "10px",
      display: "flex",
      alignItems: "flex-start",
      gap: "12px"
    }}>
      <Icon size={18} color={config.color} style={{ flexShrink: 0, marginTop: "2px" }} />
      <div style={{ flex: 1 }}>
        <span style={{ 
          fontSize: "10px", 
          fontWeight: 600, 
          color: config.color, 
          textTransform: "uppercase",
          opacity: 0.8
        }}>
          {insight.category}
        </span>
        <p style={{ fontSize: "13px", color: "#1e293b", margin: "4px 0 0 0", lineHeight: 1.5 }}>
          {insight.message}
        </p>
      </div>
    </div>
  );
};

// ============================================
// RISK DETAIL CARD
// ============================================
const RiskDetailCard: React.FC<{
  title: string;
  icon: LucideIcon;
  level: RiskLevel;
  children: ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon: Icon, level, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const color = getRiskColor(level);
  
  return (
    <div style={{ 
      ...styles.card, 
      borderLeft: `4px solid ${color}`,
      marginBottom: "16px"
    }}>
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          cursor: "pointer"
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "40px", height: "40px", borderRadius: "10px",
            background: getRiskBg(level),
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Icon size={20} color={color} />
          </div>
          <div>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1e293b", margin: 0 }}>{title}</h3>
            <span style={{ 
              fontSize: "12px", 
              color: color, 
              fontWeight: 600 
            }}>
              Risque {getRiskLabel(level).toLowerCase()}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{
            ...styles.badge,
            background: getRiskBg(level),
            color: color
          }}>
            {getRiskLabel(level)}
          </span>
          {isOpen ? <ChevronUp size={20} color="#64748b" /> : <ChevronDown size={20} color="#64748b" />}
        </div>
      </div>
      
      {isOpen && (
        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ============================================
// GASPAR / CATNAT CARD
// ============================================
const CatnatCard: React.FC<{ gaspar: GasparData }> = ({ gaspar }) => {
  const [showAll, setShowAll] = useState(false);
  
  if (gaspar.catnat_count === 0 && gaspar.ppr_count === 0) {
    return (
      <RiskDetailCard title="Catastrophes Naturelles (CATNAT)" icon={AlertTriangle} level="nul">
        <p style={{ color: "#64748b", fontSize: "14px" }}>
          Aucun arrêté de catastrophe naturelle recensé sur cette commune.
        </p>
      </RiskDetailCard>
    );
  }

  const level: RiskLevel = gaspar.catnat_count > 10 ? 'fort' : gaspar.catnat_count > 5 ? 'moyen' : 'faible';

  const eventsByType: Record<string, CatnatEvent[]> = {};
  gaspar.catnat_events.forEach(e => {
    const type = e.libelle_risque || "Autre";
    if (!eventsByType[type]) eventsByType[type] = [];
    eventsByType[type].push(e);
  });

  return (
    <RiskDetailCard title="Catastrophes Naturelles (CATNAT)" icon={AlertTriangle} level={level} defaultOpen>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ padding: "16px", background: "#fef2f2", borderRadius: "12px", textAlign: "center" }}>
          <AlertTriangle size={24} color="#dc2626" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "32px", fontWeight: 800, color: "#dc2626" }}>{gaspar.catnat_count}</div>
          <div style={{ fontSize: "12px", color: "#991b1b" }}>Arrêtés CATNAT</div>
        </div>
        <div style={{ padding: "16px", background: "#fef3c7", borderRadius: "12px", textAlign: "center" }}>
          <FileText size={24} color="#d97706" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "32px", fontWeight: 800, color: "#d97706" }}>{gaspar.ppr_count}</div>
          <div style={{ fontSize: "12px", color: "#92400e" }}>PPR applicables</div>
        </div>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
          Répartition par type de risque
        </h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {Object.entries(eventsByType).map(([type, events]) => (
            <span 
              key={type}
              style={{
                ...styles.badge,
                background: "#fee2e2",
                color: "#991b1b",
                padding: "6px 12px"
              }}
            >
              {type}: {events.length}
            </span>
          ))}
        </div>
      </div>

      {gaspar.catnat_events.length > 0 && (
        <div>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Derniers événements
          </h4>
          <div style={{ maxHeight: showAll ? "none" : "200px", overflow: "hidden" }}>
            {gaspar.catnat_events.slice(0, showAll ? undefined : 5).map((event, i) => (
              <div 
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "6px",
                  marginBottom: "4px"
                }}
              >
                <span style={{ fontSize: "13px", color: "#1e293b" }}>{event.libelle_risque}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  {event.date_debut || "—"}
                </span>
              </div>
            ))}
          </div>
          {gaspar.catnat_events.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              style={{
                width: "100%",
                padding: "10px",
                marginTop: "8px",
                background: "#f1f5f9",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "13px",
                color: "#475569"
              }}
            >
              {showAll ? "Voir moins" : `Voir les ${gaspar.catnat_events.length - 5} autres`}
            </button>
          )}
        </div>
      )}

      {gaspar.ppr_list.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Plans de Prévention des Risques
          </h4>
          {gaspar.ppr_list.map((ppr, i) => (
            <div 
              key={i}
              style={{
                padding: "12px",
                background: "#fef3c7",
                borderRadius: "8px",
                marginBottom: "8px",
                borderLeft: "4px solid #f59e0b"
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#92400e" }}>{ppr.libelle}</div>
              <div style={{ fontSize: "11px", color: "#b45309", marginTop: "4px" }}>
                État: {ppr.etat || "Inconnu"} • Code: {ppr.code}
              </div>
            </div>
          ))}
        </div>
      )}
    </RiskDetailCard>
  );
};

// ============================================
// ICPE / SEVESO CARD
// ============================================
const IcpeCard: React.FC<{ icpe: IcpeData }> = ({ icpe }) => {
  const [showAll, setShowAll] = useState(false);

  return (
    <RiskDetailCard 
      title="Installations Industrielles (ICPE/SEVESO)" 
      icon={Factory} 
      level={icpe.risk_level}
      defaultOpen={icpe.seveso_haut_count > 0 || icpe.seveso_bas_count > 0}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "16px", background: "#fef2f2", borderRadius: "12px", textAlign: "center" }}>
          <Skull size={20} color="#991b1b" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#991b1b" }}>{icpe.seveso_haut_count}</div>
          <div style={{ fontSize: "11px", color: "#991b1b" }}>SEVESO Seuil Haut</div>
        </div>
        <div style={{ padding: "16px", background: "#fef3c7", borderRadius: "12px", textAlign: "center" }}>
          <AlertTriangle size={20} color="#d97706" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#d97706" }}>{icpe.seveso_bas_count}</div>
          <div style={{ fontSize: "11px", color: "#92400e" }}>SEVESO Seuil Bas</div>
        </div>
        <div style={{ padding: "16px", background: "#f1f5f9", borderRadius: "12px", textAlign: "center" }}>
          <Factory size={20} color="#64748b" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#1e293b" }}>{icpe.count}</div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>ICPE total</div>
        </div>
      </div>

      {icpe.installations.length > 0 && (
        <div>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Installations à proximité
          </h4>
          <div style={{ maxHeight: showAll ? "400px" : "200px", overflowY: "auto" }}>
            {icpe.installations.slice(0, showAll ? undefined : 5).map((inst, i) => (
              <div 
                key={i}
                style={{
                  padding: "12px",
                  background: inst.seveso ? (inst.seveso.toLowerCase().includes('haut') ? "#fef2f2" : "#fef3c7") : "#f8fafc",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  borderLeft: `4px solid ${inst.seveso ? (inst.seveso.toLowerCase().includes('haut') ? "#dc2626" : "#f59e0b") : "#e2e8f0"}`
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{inst.nom}</div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{inst.activite}</div>
                    {inst.seveso && (
                      <span style={{
                        ...styles.badge,
                        background: inst.seveso.toLowerCase().includes('haut') ? "#fee2e2" : "#fef3c7",
                        color: inst.seveso.toLowerCase().includes('haut') ? "#991b1b" : "#92400e",
                        marginTop: "6px"
                      }}>
                        {inst.seveso}
                      </span>
                    )}
                  </div>
                  {inst.distance_m !== null && (
                    <span style={{ 
                      fontSize: "13px", 
                      fontWeight: 600, 
                      color: inst.distance_m < 1000 ? "#dc2626" : "#64748b"
                    }}>
                      {formatDistance(inst.distance_m)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {icpe.installations.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              style={{
                width: "100%",
                padding: "10px",
                marginTop: "8px",
                background: "#f1f5f9",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "13px",
                color: "#475569"
              }}
            >
              {showAll ? "Voir moins" : `Voir les ${icpe.installations.length - 5} autres`}
            </button>
          )}
        </div>
      )}
    </RiskDetailCard>
  );
};

// ============================================
// NATURAL RISKS SUMMARY CARD
// ============================================
const NaturalRisksCard: React.FC<{
  inondation: InondationData;
  seisme: SeismeData;
  feuxForet: FeuxForetData;
  argiles: ArgilesData;
}> = ({ inondation, seisme, feuxForet, argiles }) => {
  const risks = [
    { 
      name: "Inondation", 
      icon: Droplets, 
      level: inondation.risk_level,
      detail: inondation.ppri ? "PPRI actif" : "Hors zone PPRI"
    },
    { 
      name: "Séisme", 
      icon: Activity, 
      level: seisme.risk_level,
      detail: `Zone ${seisme.zone} - ${seisme.libelle}`
    },
    { 
      name: "Feux de forêt", 
      icon: Flame, 
      level: feuxForet.risk_level,
      detail: feuxForet.zone_risque ? "Zone exposée" : "Hors zone"
    },
    { 
      name: "Argiles (RGA)", 
      icon: Layers, 
      level: argiles.risk_level,
      detail: argiles.niveau_alea || "Non évalué"
    },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Mountain size={20} color="#f59e0b" />
        Risques Naturels
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {risks.map((risk, i) => {
          const Icon = risk.icon;
          const color = getRiskColor(risk.level);
          
          return (
            <div 
              key={i}
              style={{
                padding: "16px",
                background: getRiskBg(risk.level),
                borderRadius: "12px",
                borderLeft: `4px solid ${color}`
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <Icon size={18} color={color} />
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{risk.name}</span>
              </div>
              <div style={{ fontSize: "12px", color: color, fontWeight: 600, marginBottom: "4px" }}>
                {getRiskLabel(risk.level)}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>{risk.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// GEOTECHNICAL RISKS CARD
// ============================================
const GeotechCard: React.FC<{
  cavites: CaviteData;
  mvt: MvtData;
}> = ({ cavites, mvt }) => {
  const [showCavites, setShowCavites] = useState(false);
  const [showMvt, setShowMvt] = useState(false);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Layers size={20} color="#8b5cf6" />
        Risques Géotechniques
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ 
          padding: "16px", 
          background: getRiskBg(cavites.risk_level), 
          borderRadius: "12px",
          borderLeft: `4px solid ${getRiskColor(cavites.risk_level)}`
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <CircleDot size={18} color={getRiskColor(cavites.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Cavités souterraines</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(cavites.risk_level) }}>
            {cavites.count}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            {cavites.cavites[0]?.distance_m ? `La plus proche: ${formatDistance(cavites.cavites[0].distance_m)}` : "Dans le secteur"}
          </div>
        </div>
        
        <div style={{ 
          padding: "16px", 
          background: getRiskBg(mvt.risk_level), 
          borderRadius: "12px",
          borderLeft: `4px solid ${getRiskColor(mvt.risk_level)}`
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <Mountain size={18} color={getRiskColor(mvt.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Mouvements de terrain</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(mvt.risk_level) }}>
            {mvt.count}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>événements recensés</div>
        </div>
      </div>

      {cavites.count > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <button
            onClick={() => setShowCavites(!showCavites)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              cursor: "pointer"
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
              Détail des {cavites.count} cavités
            </span>
            {showCavites ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showCavites && (
            <div style={{ marginTop: "8px", maxHeight: "200px", overflowY: "auto" }}>
              {cavites.cavites.map((c, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "6px"
                }}>
                  <div>
                    <span style={{ fontSize: "13px", color: "#1e293b" }}>{c.type}</span>
                    {c.nom && <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>{c.nom}</span>}
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b" }}>
                    {formatDistance(c.distance_m)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mvt.count > 0 && (
        <div>
          <button
            onClick={() => setShowMvt(!showMvt)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              cursor: "pointer"
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
              Détail des {mvt.count} mouvements
            </span>
            {showMvt ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showMvt && (
            <div style={{ marginTop: "8px", maxHeight: "200px", overflowY: "auto" }}>
              {mvt.mouvements.map((m, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "6px"
                }}>
                  <div>
                    <span style={{ fontSize: "13px", color: "#1e293b" }}>{m.type}</span>
                    {m.date && <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>{m.date}</span>}
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b" }}>
                    {formatDistance(m.distance_m)}
                  </span>
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
// POLLUTION CARD
// ============================================
const PollutionCard: React.FC<{
  sis: SisData;
  radon: RadonData;
}> = ({ sis, radon }) => {
  const [showSites, setShowSites] = useState(false);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Bug size={20} color="#dc2626" />
        Pollution & Qualité des Sols
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ 
          padding: "16px", 
          background: getRiskBg(sis.risk_level), 
          borderRadius: "12px",
          borderLeft: `4px solid ${getRiskColor(sis.risk_level)}`
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <Skull size={18} color={getRiskColor(sis.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Sites pollués (SIS)</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(sis.risk_level) }}>
            {sis.count}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            Secteurs d'Information sur les Sols
          </div>
        </div>
        
        <div style={{ 
          padding: "16px", 
          background: getRiskBg(radon.risk_level), 
          borderRadius: "12px",
          borderLeft: `4px solid ${getRiskColor(radon.risk_level)}`
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <Atom size={18} color={getRiskColor(radon.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Radon</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(radon.risk_level) }}>
            {radon.classe_potentiel ?? "—"}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            Classe {radon.classe_potentiel} - {radon.libelle}
          </div>
        </div>
      </div>

      {sis.count > 0 && (
        <div>
          <button
            onClick={() => setShowSites(!showSites)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              cursor: "pointer"
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#991b1b" }}>
              ⚠️ {sis.count} site(s) pollué(s) identifié(s)
            </span>
            {showSites ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showSites && (
            <div style={{ marginTop: "8px" }}>
              {sis.sites.map((site, i) => (
                <div key={i} style={{
                  padding: "12px",
                  background: "#fef2f2",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  borderLeft: "4px solid #dc2626"
                }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#991b1b" }}>{site.nom}</div>
                  <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                    {site.adresse || site.commune}
                    {site.superficie_m2 && ` • ${formatNumber(site.superficie_m2)} m²`}
                  </div>
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
// RESULTS COMPONENT
// ============================================
const RiskStudyResults: React.FC<{
  data: RiskStudyApiResponse;
  bankScoring: BankRiskScoring | null;           // 🆕 Banque scoring
  isBankScoringLoading: boolean;                  // 🆕 Banque scoring
}> = ({ data, bankScoring, isBankScoringLoading }) => {
  const { meta, scores, categories, insights, data: riskData } = data;
  
  const criticalInsights = insights.filter(i => i.type === 'critical');
  const warningInsights = insights.filter(i => i.type === 'warning');
  const positiveInsights = insights.filter(i => i.type === 'positive');
  const infoInsights = insights.filter(i => i.type === 'info');

  // PDF Handler
  const handleGeneratePdf = useCallback(() => {
    const verdict = getVerdictConfig(scores.global);
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Veuillez autoriser les popups pour générer le PDF');
      return;
    }

    // 🆕 Banque scoring – section PDF conditionnelle
    const bankScoringPdfSection = bankScoring ? `
      <div class="section">
        <div class="section-title">🏦 Scoring Banque</div>
        <div class="grid-4">
          <div class="stat-box">
            <div class="stat-label">Score</div>
            <div class="stat-value" style="color: ${getBankGradeColor(bankScoring.grade)}">${bankScoring.score}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Grade</div>
            <div class="stat-value" style="color: ${getBankGradeColor(bankScoring.grade)}">${bankScoring.grade}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Niveau</div>
            <div class="stat-value" style="font-size: 16px">${bankScoring.level_label}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Confiance</div>
            <div class="stat-value">${Math.round(bankScoring.confidence * 100)}%</div>
          </div>
        </div>
        ${bankScoring.rationale.length > 0 ? `
          <div style="margin-top: 12px;">
            ${bankScoring.rationale.slice(0, 3).map(r => `<div class="insight insight-info">${r}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    ` : '';

    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Étude de Risques - ${meta.commune_nom}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
    .header { background: linear-gradient(135deg, #7f1d1d 0%, #dc2626 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .score-section { display: flex; align-items: center; gap: 30px; margin: 20px 0; }
    .score-circle { width: 100px; height: 100px; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center; flex-direction: column; }
    .score-value { font-size: 36px; font-weight: 800; color: ${getScoreColor(scores.global)}; }
    .verdict { display: inline-block; padding: 8px 16px; background: ${verdict.bg}; color: ${verdict.color}; border-radius: 8px; font-weight: 600; }
    .section { background: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 20px; page-break-inside: avoid; }
    .section-title { font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .stat-box { background: white; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 700; }
    .insight { padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
    .insight-critical { background: #fef2f2; border-left: 4px solid #dc2626; }
    .insight-warning { background: #fef3c7; border-left: 4px solid #f59e0b; }
    .insight-positive { background: #ecfdf5; border-left: 4px solid #10b981; }
    .insight-info { background: #f0f9ff; border-left: 4px solid #0ea5e9; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } .section { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛡️ Étude de Risques - ${meta.commune_nom}</h1>
    <p>${meta.region} • Département ${meta.departement} • Rayon ${meta.radius_km} km</p>
    <div class="score-section">
      <div class="score-circle">
        <div class="score-value">${scores.global}</div>
        <div style="font-size: 10px; color: #64748b">/100</div>
      </div>
      <div>
        <div class="verdict">${verdict.label}</div>
        <p style="margin-top: 8px; font-size: 13px;">Score de risque global</p>
      </div>
    </div>
  </div>

  ${bankScoringPdfSection}

  <div class="section">
    <div class="section-title">📊 Scores par catégorie</div>
    <div class="grid-4">
      ${categories.map(cat => `
        <div class="stat-box">
          <div class="stat-label">${cat.name}</div>
          <div class="stat-value" style="color: ${getRiskColor(cat.level)}">${cat.score}</div>
          <div style="font-size: 11px; color: ${getRiskColor(cat.level)}">${getRiskLabel(cat.level)}</div>
        </div>
      `).join('')}
    </div>
  </div>

  ${criticalInsights.length > 0 ? `
  <div class="section">
    <div class="section-title">🚨 Alertes Critiques</div>
    ${criticalInsights.map(i => `<div class="insight insight-critical">${i.message}</div>`).join('')}
  </div>
  ` : ''}

  ${warningInsights.length > 0 ? `
  <div class="section">
    <div class="section-title">⚠️ Points de Vigilance</div>
    ${warningInsights.map(i => `<div class="insight insight-warning">${i.message}</div>`).join('')}
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">📋 Données Détaillées</div>
    <div class="grid">
      <div class="stat-box"><div class="stat-label">Arrêtés CATNAT</div><div class="stat-value" style="color: #dc2626">${riskData.gaspar.catnat_count}</div></div>
      <div class="stat-box"><div class="stat-label">PPR applicables</div><div class="stat-value" style="color: #f59e0b">${riskData.gaspar.ppr_count}</div></div>
      <div class="stat-box"><div class="stat-label">Sites SEVESO</div><div class="stat-value" style="color: #991b1b">${riskData.icpe.seveso_haut_count + riskData.icpe.seveso_bas_count}</div></div>
      <div class="stat-box"><div class="stat-label">Sites pollués (SIS)</div><div class="stat-value" style="color: #dc2626">${riskData.sis.count}</div></div>
      <div class="stat-box"><div class="stat-label">Zone sismique</div><div class="stat-value" style="color: #8b5cf6">${riskData.seisme.zone}</div></div>
      <div class="stat-box"><div class="stat-label">Classe radon</div><div class="stat-value" style="color: #6366f1">${riskData.radon.classe_potentiel ?? '—'}</div></div>
    </div>
  </div>

  <div class="footer">
    <p>Rapport généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    <p>Mimmoza - Plateforme d'analyse immobilière intelligente • Sources: Géorisques, BRGM</p>
  </div>
</body>
</html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => { printWindow.print(); }, 250);
    };
  }, [meta, scores, categories, criticalInsights, warningInsights, riskData, bankScoring]);

  const categoryIcons: Record<string, LucideIcon> = {
    "Risques Naturels": Mountain,
    "Risques Technologiques": Factory,
    "Pollution": Bug,
    "Risques Géotechniques": Layers,
  };

  return (
    <ErrorBoundary componentName="RiskStudyResults">
      <div>
        {/* 🆕 Banque scoring – Composant réutilisable <BanqueRiskScoreCard /> */}
        {isBankScoringLoading && (
          <BanqueRiskScoreCard
            scoring={{ score: 0, grade: "C", level_label: "", confidence: 0, rationale: [], items: [] }}
            isLoading
          />
        )}
        {!isBankScoringLoading && bankScoring && (
          <BanqueRiskScoreCard scoring={bankScoring} />
        )}

        {/* Header avec score global */}
        <div style={{
          background: "linear-gradient(135deg, #7f1d1d 0%, #991b1b 50%, #b91c1c 100%)",
          borderRadius: "20px", padding: "32px", marginBottom: "24px", color: "white"
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "32px", alignItems: "center" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <RiskGauge score={scores.global} size={180} />
            </div>
            
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <ShieldAlert size={28} />
                <h2 style={{ fontSize: "26px", fontWeight: 700, margin: 0 }}>
                  {meta.commune_nom}
                  <span style={{ fontSize: "16px", fontWeight: 400, opacity: 0.7, marginLeft: "10px" }}>
                    ({meta.departement})
                  </span>
                </h2>
              </div>
              <p style={{ fontSize: "14px", opacity: 0.8, marginBottom: "20px" }}>
                {meta.region} • Rayon d'analyse: {meta.radius_km} km • API v{data.version}
              </p>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Arrêtés CATNAT</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>{riskData.gaspar.catnat_count}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Sites SEVESO</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>
                    {riskData.icpe.seveso_haut_count + riskData.icpe.seveso_bas_count}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>PPR actifs</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>{riskData.gaspar.ppr_count}</div>
                </div>
              </div>
            </div>
            
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px", opacity: 0.9 }}>
                Scores par catégorie
              </div>
              {categories.map((cat, i) => (
                <CategoryScoreBar 
                  key={i} 
                  name={cat.name} 
                  score={cat.score} 
                  level={cat.level}
                  icon={categoryIcons[cat.name] || Shield}
                />
              ))}
            </div>
          </div>
        </div>
        
        {/* Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {criticalInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #dc2626" }}>
              <div style={styles.cardTitle}>
                <AlertOctagon size={20} color="#dc2626" />
                Alertes Critiques ({criticalInsights.length})
              </div>
              {criticalInsights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
          
          {warningInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #f59e0b" }}>
              <div style={styles.cardTitle}>
                <AlertTriangle size={20} color="#f59e0b" />
                Points de Vigilance ({warningInsights.length})
              </div>
              {warningInsights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
          
          {positiveInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #10b981" }}>
              <div style={styles.cardTitle}>
                <CheckCircle size={20} color="#10b981" />
                Points Positifs ({positiveInsights.length})
              </div>
              {positiveInsights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
        </div>
        
        {/* Détails par catégorie */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <NaturalRisksCard 
            inondation={riskData.inondation}
            seisme={riskData.seisme}
            feuxForet={riskData.feux_foret}
            argiles={riskData.argiles}
          />
          <PollutionCard sis={riskData.sis} radon={riskData.radon} />
        </div>
        
        <div style={{ marginBottom: "24px" }}>
          <GeotechCard cavites={riskData.cavites} mvt={riskData.mouvements_terrain} />
        </div>
        
        <div style={{ marginBottom: "24px" }}>
          <CatnatCard gaspar={riskData.gaspar} />
        </div>
        
        <div style={{ marginBottom: "24px" }}>
          <IcpeCard icpe={riskData.icpe} />
        </div>
        
        {infoInsights.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "24px" }}>
            <div style={styles.cardTitle}>
              <Info size={20} color="#0ea5e9" />
              Informations complémentaires
            </div>
            {infoInsights.map((insight, i) => (
              <InsightCard key={i} insight={insight} />
            ))}
          </div>
        )}
        
        {data.debug?.timings && DEBUG_MODE && (
          <div style={{ ...styles.card, background: "#f8fafc", marginBottom: "24px" }}>
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
              padding: "14px 28px", background: "#7f1d1d", color: "white",
              border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer"
            }}
          >
            <FileText size={18} />
            Générer le rapport PDF
          </button>
          <button 
            onClick={() => {
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `etude-risques-${meta.commune_nom}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px", background: "#f1f5f9", color: "#475569",
              border: "1px solid #e2e8f0", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer"
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
// 🆕 Banque scoring – extract dossierId from URL
// ============================================
function extractDossierIdFromUrl(): string | null {
  try {
    const match = window.location.pathname.match(/\/banque\/risque\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ============================================
// MAIN COMPONENT
// ============================================
export function RisquesPage() {
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
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<RiskStudyApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 🆕 Banque scoring – state
  const [bankScoring, setBankScoring] = useState<BankRiskScoring | null>(null);
  const [isBankScoringLoading, setIsBankScoringLoading] = useState(false);
  const [bankScoringError, setBankScoringError] = useState<string | null>(null);

  const addressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parcelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Address search
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

  // Parcel search
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

  const handleSelectAddress = useCallback((suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setAddress(suggestion.label);
    setAddressSuggestions([]);
    setLatitude(suggestion.lat.toFixed(6));
    setLongitude(suggestion.lon.toFixed(6));
    if (suggestion.citycode) setCodeInsee(suggestion.citycode);
  }, []);

  // 🆕 Banque scoring – fetch function
  const fetchBankScoring = useCallback(async (params: {
    dossierId?: string | null;
    lat?: number;
    lon?: number;
    commune_insee?: string;
  }) => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      log('⚠️', 'Banque scoring skipped: missing Supabase config');
      return;
    }

    const payload: Record<string, unknown> = {};
    if (params.dossierId) {
      payload.dossierId = params.dossierId;
    } else {
      if (!Number.isNaN(params.lat) && !Number.isNaN(params.lon)) {
        payload.lat = params.lat;
        payload.lon = params.lon;
      }
      if (params.commune_insee) payload.commune_insee = params.commune_insee;
    }

    if (!payload.dossierId && !payload.lat && !payload.commune_insee) {
      log('⚠️', 'Banque scoring skipped: no identifier available');
      return;
    }

    setIsBankScoringLoading(true);
    setBankScoringError(null);
    setBankScoring(null);

    try {
      log('🏦', 'Calling banque-risques-v1', payload);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/banque-risques-v1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      log('🏦', 'banque-risques-v1 response', {
        ok: response.ok,
        score: result?.risks?.scoring?.score,
        grade: result?.risks?.scoring?.grade,
      });

      if (!response.ok) {
        throw new Error(result.error || `Erreur ${response.status}`);
      }

      const scoring = result?.risks?.scoring;
      if (scoring && typeof scoring.score === "number") {
        setBankScoring({
          score: scoring.score,
          grade: scoring.grade as BankRiskScoringGrade,
          level_label: scoring.level_label ?? "",
          confidence: scoring.confidence ?? 0,
          rationale: Array.isArray(scoring.rationale) ? scoring.rationale : [],
          items: Array.isArray(scoring.items) ? scoring.items : [],
        });
      } else {
        log('⚠️', 'banque-risques-v1: no scoring in response');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur scoring banque";
      log('❌', 'banque-risques-v1 error', msg);
      setBankScoringError(msg);
    } finally {
      setIsBankScoringLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const hasLocation = (latitude && longitude) || codeInsee || parcelInfo;
    if (!hasLocation) {
      setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE).");
      return;
    }

    log('🚀', 'Starting risk analysis', { latitude, longitude, codeInsee, radius });

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);
    // 🆕 Banque scoring – reset
    setBankScoring(null);
    setBankScoringError(null);

    const lat = latitude ? parseFloat(latitude) : NaN;
    const lon = longitude ? parseFloat(longitude) : NaN;

    try {
      const payload: Record<string, unknown> = {
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
      
      const apiResponse = await fetch(`${SUPABASE_URL}/functions/v1/risk-study-v1`, {
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

      setAnalysisResult(result as RiskStudyApiResponse);

      // 🆕 Banque scoring – fire in parallel (non-blocking)
      const dossierId = extractDossierIdFromUrl();
      fetchBankScoring({
        dossierId,
        lat: result?.meta?.lat ?? lat,
        lon: result?.meta?.lon ?? lon,
        commune_insee: result?.meta?.commune_insee ?? codeInsee,
      });

      // Save to snapshot
      try {
        patchProjectInfo({
          address: selectedAddress?.label || address || undefined,
          city: result?.meta?.commune_nom || undefined,
          lat: result?.meta?.lat,
          lon: result?.meta?.lon,
        });

        patchModule("risks", {
          ok: true,
          summary: `Score risque: ${result?.scores?.global}/100 - ${result?.meta?.commune_nom}`,
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
  }, [latitude, longitude, codeInsee, parcelInfo, radius, selectedAddress, address, fetchBankScoring]);

  return (
    <ErrorBoundary componentName="RisquesPage">
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <ShieldAlert size={28} />
            <h1 style={{ fontSize: "28px", fontWeight: 700, margin: 0 }}>Étude de Risques</h1>
            <span style={{
              padding: "4px 12px",
              background: "rgba(255,255,255,0.2)",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
            }}>
              Géorisques
            </span>
            <span style={{
              padding: "4px 10px",
              background: "#fef3c7",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#92400e",
            }}>
              v1.3.0
            </span>
          </div>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", maxWidth: "700px", margin: 0 }}>
            Analyse complète des risques naturels, technologiques, pollution et géotechniques.
            Sources: Géorisques, BRGM, GASPAR.
          </p>
        </div>

        {/* Main content */}
        <div style={styles.mainContent}>
          {/* Form */}
          <div style={styles.formSection}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px",
                background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <Target size={22} color="white" />
              </div>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Localisation à analyser
                </h2>
                <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                  Renseignez une adresse, parcelle cadastrale, coordonnées ou code INSEE
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
              {/* Adresse */}
              <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <MapPin size={14} color="#dc2626" />
                  Adresse
                  <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", background: "#fee2e2", color: "#991b1b", borderRadius: "4px", marginLeft: "8px" }}>
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
                    <Loader2 size={18} color="#dc2626" style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", animation: "spin 1s linear infinite" }} />
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
                          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#fef2f2"; }}
                          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                        >
                          <MapPin size={14} color="#dc2626" />
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
                  <Grid3X3 size={14} color="#dc2626" />
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

              {/* Rayon */}
              <div style={{ gridColumn: "span 3", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Compass size={14} color="#dc2626" />
                  Rayon d'analyse: <strong style={{ color: "#dc2626" }}>{radius} km</strong>
                </label>
                <input
                  type="range" min={1} max={20} step={1} value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "#dc2626" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
                  <span>1 km</span>
                  <span style={{ color: "#dc2626", fontWeight: 500 }}>Recommandé: 5 km</span>
                  <span>20 km</span>
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

            {/* 🆕 Banque scoring – error display */}
            {bankScoringError && (
              <div style={{ 
                padding: "14px 18px", background: "#fef3c7", border: "1px solid #fcd34d",
                borderRadius: "10px", marginTop: "12px", display: "flex", alignItems: "center", gap: "10px"
              }}>
                <Landmark size={18} color="#d97706" />
                <span style={{ fontSize: "14px", color: "#92400e" }}>
                  Scoring banque indisponible: {bankScoringError}
                </span>
              </div>
            )}

            {/* Submit */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: "28px" }}>
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                style={{
                  ...styles.submitButton,
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
                    <ShieldAlert size={20} />
                    Lancer l'analyse des risques
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Results */}
          <div ref={resultsRef}>
            {isLoading && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "80px 40px"
              }}>
                <Loader2 size={56} color="#dc2626" style={{ animation: "spin 1s linear infinite", marginBottom: "20px" }} />
                <h3 style={{ fontSize: "20px", color: "#1e293b", marginBottom: "8px" }}>Analyse en cours...</h3>
                <p style={{ fontSize: "14px", color: "#64748b" }}>
                  Interrogation de Géorisques, GASPAR, BRGM...
                </p>
              </div>
            )}

            {!isLoading && analysisResult && (
              <RiskStudyResults
                data={analysisResult}
                bankScoring={bankScoring}                   // 🆕 Banque scoring
                isBankScoringLoading={isBankScoringLoading} // 🆕 Banque scoring
              />
            )}

            {!isLoading && !analysisResult && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "80px 40px", textAlign: "center"
              }}>
                <div style={{
                  width: "80px", height: "80px", borderRadius: "50%",
                  background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "24px"
                }}>
                  <ShieldAlert size={36} color="#dc2626" />
                </div>
                <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                  Nouvelle étude de risques
                </h3>
                <p style={{ fontSize: "15px", color: "#64748b", maxWidth: "500px", lineHeight: 1.6 }}>
                  Entrez une adresse, un numéro de parcelle, des coordonnées GPS ou un code INSEE 
                  pour lancer une analyse complète des risques.
                </p>
                <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                  <span style={{ ...styles.badge, background: "#fee2e2", color: "#991b1b" }}>
                    🌊 Inondations
                  </span>
                  <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>
                    🏭 SEVESO/ICPE
                  </span>
                  <span style={{ ...styles.badge, background: "#f3e8ff", color: "#7c3aed" }}>
                    ⚛️ Radon
                  </span>
                  <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>
                    🔬 Pollution sols
                  </span>
                  <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>
                    📜 CATNAT
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
            border-color: #dc2626 !important;
            box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1) !important;
          }
          button:hover:not(:disabled) {
            transform: translateY(-1px);
          }
        `}</style>
      </div>
    </ErrorBoundary>
  );
}

export default RisquesPage;