// ============================================
// MarchePage.tsx - VERSION CORRIGÉE DÉFINITIVE
// ============================================
// CHANGELOG:
// - FIX #1: Icônes dynamiques sécurisées avec fallbacks
// - FIX #2: Error Boundary global ajouté
// - FIX #3: Guards explicites dans tous les composants
// - FIX #4: Accès aux données sécurisés avec optional chaining
// - FIX #5: Logs de debug structurés et durables
// - FIX #6: Validation du retour de getProjectConfig
// - FIX #7: Snapshot localStorage pour synchronisation Promoteur
// - FIX #8: Correction import chemin relatif + nom fonction patchProjectInfo
// ============================================

import React, { useState, useCallback, useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from "react";
import { 
  Search, MapPin, Grid3X3, Loader2, X, Building2, 
  Users, Euro, ShoppingCart, Stethoscope, GraduationCap, 
  TrendingUp, TrendingDown, Shield, Fuel, Mail, Banknote, CheckCircle,
  AlertTriangle, Home, Activity, Download,
  ChevronDown, ChevronUp, Heart, Pill,
  Target, Building, Hotel, Briefcase,
  Eye, Minus, MapPinned,
  Compass, FileText, Phone, Store
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

// ============================================
// IMPORTS MODULES EXTRAITS
// ============================================
import type {
  ProjectType,
  AddressSuggestion,
  ParcelInfo,
  InseeData as BaseInseeData,
  ServiceProche,
  MarketStudyResult,
  EHPADData,
  DataSourceType,
} from "./types/market.types";

import { PROJECT_CONFIGS, getProjectConfig } from "./config/project.config";
import { searchAddress } from "./services/address.service";
import { searchParcel } from "./services/parcel.service";
import { fetchAllEHPAD, convertToEhpadData } from "./services/finess.service";
import { normalizeInseeData } from "./services/insee.normalize";

// ============================================
// IMPORT SNAPSHOT STORE - Chemin relatif corrigé
// ============================================
import { patchProjectInfo, patchModule } from "../../shared/promoteurSnapshot.store";

// ============================================
// DEBUG FLAGS - Mettre à false en production
// ============================================
const DEBUG_SERVICES = true;
const DEBUG_INSEE = true;
const DEBUG_BPE = true;
const DEBUG_SHOPS = true;
const DEBUG_RENDER = true;

// ============================================
// LOG HELPERS - Logs structurés et durables
// ============================================
const LOG_PREFIX = {
  SUBMIT: '🚀 [SUBMIT]',
  API: '📡 [API]',
  RENDER: '🎨 [RENDER]',
  ERROR: '❌ [ERROR]',
  DATA: '📊 [DATA]',
  FINESS: '🏥 [FINESS]',
  SHOPS: '🛒 [SHOPS]',
  INSEE: '👥 [INSEE]',
};

const logSubmit = (message: string, data?: unknown) => {
  console.log(`${LOG_PREFIX.SUBMIT} ${message}`, data ?? '');
};

const logApi = (message: string, data?: unknown) => {
  console.log(`${LOG_PREFIX.API} ${message}`, data ?? '');
};

const logRender = (component: string, data?: unknown) => {
  if (DEBUG_RENDER) {
    console.log(`${LOG_PREFIX.RENDER} ${component}`, data ?? '');
  }
};

const logError = (message: string, error?: unknown) => {
  console.error(`${LOG_PREFIX.ERROR} ${message}`, error ?? '');
};

const logData = (source: string, data?: unknown) => {
  console.log(`${LOG_PREFIX.DATA} ${source}`, data ?? '');
};

// ============================================
// ERROR BOUNDARY - Capture les crashes React
// ============================================
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  componentName?: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(`ErrorBoundary caught error in ${this.props.componentName || 'unknown component'}`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{
          padding: "40px",
          textAlign: "center",
          background: "#fef2f2",
          borderRadius: "12px",
          border: "1px solid #fecaca",
          margin: "20px"
        }}>
          <AlertTriangle size={48} color="#dc2626" style={{ marginBottom: "16px" }} />
          <h3 style={{ color: "#991b1b", marginBottom: "8px" }}>
            Erreur de rendu dans {this.props.componentName || 'un composant'}
          </h3>
          <p style={{ color: "#b91c1c", fontSize: "14px", marginBottom: "16px" }}>
            {this.state.error?.message || 'Une erreur inattendue est survenue'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{
              padding: "10px 20px",
              background: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer"
            }}
          >
            Réessayer
          </button>
          {DEBUG_RENDER && this.state.error?.stack && (
            <pre style={{
              marginTop: "16px",
              padding: "12px",
              background: "#fee2e2",
              borderRadius: "8px",
              fontSize: "11px",
              textAlign: "left",
              overflow: "auto",
              maxHeight: "200px"
            }}>
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// SAFE ICON COMPONENT - Rendu sécurisé des icônes
// ============================================
interface SafeIconProps {
  icon?: LucideIcon | null;
  fallback?: LucideIcon;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

const SafeIcon: React.FC<SafeIconProps> = ({ 
  icon, 
  fallback = Building2, 
  size = 20, 
  color,
  style,
  className 
}) => {
  const IconComponent = icon && typeof icon === 'function' ? icon : fallback;
  
  try {
    return <IconComponent size={size} color={color} style={style} className={className} />;
  } catch (err) {
    logError('SafeIcon render failed, using fallback', err);
    const FallbackIcon = fallback;
    return <FallbackIcon size={size} color={color} style={style} className={className} />;
  }
};

// ============================================
// FIX: Extension de InseeData pour inclure surface_km2
// ============================================
interface InseeData extends BaseInseeData {
  surface_km2?: number;
}

// ============================================
// FIX: Interfaces pour les données
// ============================================
interface ShopItem {
  name: string;
  distance_m: number;
  lat?: number;
  lon?: number;
  address?: string;
}

interface ShopCategory {
  count: number;
  top: ShopItem[];
}

interface ShopsData {
  radius_m_used?: number;
  categories: Record<string, ShopCategory>;
}

interface MarketContextFallbackResult {
  insee: Record<string, unknown> | null;
  shops: ShopsData | null;
}

interface NormalizedBpeData {
  nb_commerces?: number;
  nb_sante?: number;
  nb_services?: number;
  nb_enseignement?: number;
  nb_sport_culture?: number;
  nb_total?: number;
  source?: string | { provider: string; note?: string };
}

interface FacilityEnriched {
  nom: string;
  commune: string;
  distance_km: number;
  capacite?: number;
  finess?: string;
  adresse?: string;
  telephone?: string;
  prix_journalier?: number;
  taux_occupation?: number;
}

interface KeySample {
  type: "null" | "undefined" | "object" | "array" | "string" | "number" | "boolean" | "other";
  length?: number;
  sampleKeys?: string[];
  sampleFirstKeys?: string[];
  valuePreview?: string;
}

interface ServicesShapeInspection {
  rawType: "null" | "undefined" | "array" | "object" | "other";
  topKeys: string[];
  flattenedTopKeys: string[];
  samples: Record<string, KeySample>;
  isEmpty: boolean;
}

// ============================================
// SAFE PROJECT CONFIG - Validation du config projet
// ============================================
const getSafeProjectConfig = (nature: ProjectType) => {
  try {
    const config = getProjectConfig(nature);
    if (!config) {
      logError('getProjectConfig returned null/undefined for', nature);
      return getDefaultProjectConfig();
    }
    if (!config.icon || typeof config.icon !== 'function') {
      logError('Invalid icon in project config, using fallback');
      return { ...config, icon: Building2 };
    }
    return config;
  } catch (err) {
    logError('getProjectConfig threw error', err);
    return getDefaultProjectConfig();
  }
};

const getDefaultProjectConfig = () => ({
  icon: Building2,
  label: 'Projet',
  color: '#6366f1',
  description: 'Étude de marché',
  radius: { analysis: 2 },
  requiredDataSources: ['insee'] as DataSourceType[],
  demographicSegments: [],
  competitionLabel: { singular: 'Établissement', plural: 'Établissements', unit: 'places' },
});

// ============================================
// DIAG: Inspection robuste de la structure services_ruraux
// ============================================
const inspectServicesShape = (raw: unknown): ServicesShapeInspection => {
  if (raw === null) {
    return { rawType: "null", topKeys: [], flattenedTopKeys: [], samples: {}, isEmpty: true };
  }
  if (raw === undefined) {
    return { rawType: "undefined", topKeys: [], flattenedTopKeys: [], samples: {}, isEmpty: true };
  }
  
  if (Array.isArray(raw)) {
    return { 
      rawType: "array", 
      topKeys: [], 
      flattenedTopKeys: [], 
      samples: { 
        _array: { 
          type: "array", 
          length: raw.length, 
          sampleFirstKeys: raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null 
            ? Object.keys(raw[0]).slice(0, 5) 
            : [] 
        } 
      }, 
      isEmpty: raw.length === 0 
    };
  }
  
  if (typeof raw !== 'object') {
    return { rawType: "other", topKeys: [], flattenedTopKeys: [], samples: {}, isEmpty: true };
  }
  
  const obj = raw as Record<string, unknown>;
  const topKeys = Object.keys(obj);
  
  const NESTED_KEYS = ['commerces', 'commerce', 'sante', 'health', 'securite', 'security', 'services', 'proximite', 'nearby'];
  const flattenedInput: Record<string, unknown> = { ...obj };
  
  for (const nestedKey of NESTED_KEYS) {
    const nestedValue = obj[nestedKey];
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      const nested = nestedValue as Record<string, unknown>;
      for (const [k, v] of Object.entries(nested)) {
        flattenedInput[`${nestedKey}.${k}`] = v;
        flattenedInput[k] = v;
      }
    }
  }
  
  const flattenedTopKeys = Object.keys(flattenedInput);
  const samples: Record<string, KeySample> = {};
  const keysToSample = flattenedTopKeys.slice(0, 25);
  
  for (const key of keysToSample) {
    const value = flattenedInput[key];
    
    if (value === null) {
      samples[key] = { type: "null" };
    } else if (value === undefined) {
      samples[key] = { type: "undefined" };
    } else if (Array.isArray(value)) {
      samples[key] = { 
        type: "array", 
        length: value.length,
        sampleFirstKeys: value.length > 0 && typeof value[0] === 'object' && value[0] !== null
          ? Object.keys(value[0]).slice(0, 5)
          : []
      };
    } else if (typeof value === 'object') {
      const objVal = value as Record<string, unknown>;
      samples[key] = { type: "object", sampleKeys: Object.keys(objVal).slice(0, 8) };
    } else if (typeof value === 'string') {
      samples[key] = { type: "string", valuePreview: value.slice(0, 30) };
    } else if (typeof value === 'number') {
      samples[key] = { type: "number", valuePreview: String(value) };
    } else if (typeof value === 'boolean') {
      samples[key] = { type: "boolean", valuePreview: String(value) };
    } else {
      samples[key] = { type: "other" };
    }
  }
  
  const isEmpty = topKeys.length === 0 || topKeys.every(k => obj[k] === null || obj[k] === undefined);
  
  return { rawType: "object", topKeys, flattenedTopKeys, samples, isEmpty };
};

const SERVICE_GUESS_PATTERNS: Record<string, string[]> = {
  supermarche: ['super', 'market', 'hyper', 'shop', 'aliment', 'grocery', 'epicerie'],
  station_service: ['fuel', 'station', 'essence', 'gas', 'petrol', 'carburant'],
  banque: ['bank', 'banque', 'atm', 'dab', 'credit', 'caisse'],
  poste: ['post', 'poste', 'mail', 'courrier'],
  medecin: ['doctor', 'medecin', 'generaliste', 'physician'],
  pharmacie: ['pharm', 'pharmacy', 'officine'],
  gendarmerie: ['gendar', 'police', 'commissariat', 'securite', 'security'],
};

const guessServiceKeys = (flattenedKeys: string[]): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  
  for (const [serviceType, patterns] of Object.entries(SERVICE_GUESS_PATTERNS)) {
    result[serviceType] = [];
    for (const key of flattenedKeys) {
      const keyLower = key.toLowerCase();
      for (const pattern of patterns) {
        if (keyLower.includes(pattern)) {
          result[serviceType].push(key);
          break;
        }
      }
    }
  }
  
  return result;
};

const SHOPS_CATEGORY_MAPPING: Record<string, { uiKey: string; label: string; icon: LucideIcon }> = {
  supermarket: { uiKey: 'supermarche', label: 'Supermarché', icon: ShoppingCart },
  fuel: { uiKey: 'station_service', label: 'Station service', icon: Fuel },
  bank_atm: { uiKey: 'banque', label: 'Banque / DAB', icon: Banknote },
  post: { uiKey: 'poste', label: 'Bureau de poste', icon: Mail },
  doctor: { uiKey: 'medecin', label: 'Médecin', icon: Stethoscope },
  pharmacy: { uiKey: 'pharmacie', label: 'Pharmacie', icon: Pill },
  gendarmerie: { uiKey: 'gendarmerie', label: 'Gendarmerie', icon: Shield },
  commissariat: { uiKey: 'commissariat', label: 'Commissariat', icon: Shield },
};

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

const getDistanceColor = (km: number | null | undefined): string => {
  if (km == null) return "#94a3b8";
  if (km <= 0.5) return "#10b981";
  if (km <= 1) return "#22c55e";
  if (km <= 2) return "#84cc16";
  if (km <= 5) return "#f59e0b";
  return "#64748b";
};// ============================================
// API HELPERS
// ============================================
async function fetchMarketContextFallback(params: {
  supabaseUrl: string;
  anonKey: string;
  zipCode?: string;
  city?: string;
  lat?: number;
  lon?: number;
}): Promise<MarketContextFallbackResult> {
  const { supabaseUrl, anonKey } = params;

  const body: Record<string, unknown> = {};
  if (params.zipCode && params.city) {
    body.zipCode = params.zipCode;
    body.city = params.city;
  } else if (typeof params.lat === "number" && typeof params.lon === "number" && !Number.isNaN(params.lat) && !Number.isNaN(params.lon)) {
    body.lat = params.lat;
    body.lon = params.lon;
    body.lng = params.lon;
  } else {
    if (DEBUG_INSEE) logData('MarketContext Fallback - No valid params', params);
    return { insee: null, shops: null };
  }

  logApi('Calling market-context-v1', body);

  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/market-context-v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });

    const json = await r.json().catch(() => null);
    if (!r.ok || !json?.success) {
      logError('market-context-v1 failed', json);
      return { insee: null, shops: null };
    }

    logApi('market-context-v1 success', { insee: !!json?.insee, shops: !!json?.shops });
    
    return {
      insee: json?.insee ?? null,
      shops: json?.shops ?? null,
    };
  } catch (err) {
    logError('market-context-v1 error', err);
    return { insee: null, shops: null };
  }
}

async function fetchOverpassShopCount(lat: number, lon: number, radiusMeters: number): Promise<number | null> {
  const query = `
[out:json][timeout:25];
(
  node(around:${radiusMeters},${lat},${lon})["shop"];
  way(around:${radiusMeters},${lat},${lon})["shop"];
  relation(around:${radiusMeters},${lat},${lon})["shop"];
);
out count;
`.trim();

  const url = "https://overpass-api.de/api/interpreter";

  if (DEBUG_BPE) logData('BPE Overpass query', { radius: radiusMeters });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(query)}`
    });

    const json = await res.json().catch(() => null);
    const total = json?.elements?.[0]?.tags?.total;
    const parsed = typeof total === "string" ? parseInt(total, 10) : null;
    
    if (DEBUG_BPE) logData('BPE Overpass result', { total, parsed });
    
    return Number.isFinite(parsed as number) ? (parsed as number) : null;
  } catch (err) {
    logError('BPE Overpass error', err);
    return null;
  }
}

// ============================================
// INSEE NORMALIZATION
// ============================================
const safeNormalizeInseeData = (rawInsee: unknown): InseeData | null => {
  if (!rawInsee || typeof rawInsee !== 'object') {
    if (DEBUG_INSEE) logData('safeNormalizeInseeData - raw is null/not object');
    return null;
  }

  const rawObj = rawInsee as Record<string, unknown>;
  
  if (DEBUG_INSEE) {
    logData('INSEE normalization start', {
      keys: Object.keys(rawObj).slice(0, 10),
      population: rawObj.population,
      surface_km2: rawObj.surface_km2,
    });
  }

  let extractedSurfaceKm2: number | undefined;
  if (typeof rawObj.surface_km2 === 'number' && rawObj.surface_km2 > 0) {
    extractedSurfaceKm2 = rawObj.surface_km2;
  } else if (typeof rawObj.superficie === 'number' && rawObj.superficie > 0) {
    extractedSurfaceKm2 = rawObj.superficie;
  } else if (typeof rawObj.area_km2 === 'number' && rawObj.area_km2 > 0) {
    extractedSurfaceKm2 = rawObj.area_km2;
  } else if (typeof rawObj.surface === 'number' && rawObj.surface > 0) {
    extractedSurfaceKm2 = rawObj.surface > 10000 ? rawObj.surface / 1000000 : rawObj.surface;
  }

  let normalized: InseeData | null = null;
  
  try {
    normalized = normalizeInseeData(rawInsee) as InseeData | null;
  } catch (err) {
    logError('normalizeInseeData threw error', err);
    normalized = null;
  }

  const hasValidNormalized = normalized && (
    normalized.population != null ||
    normalized.commune != null ||
    normalized.densite != null
  );

  if (!hasValidNormalized) {
    if (DEBUG_INSEE) logData('INSEE normalization fallback mode');
    
    const population = typeof rawObj.population === 'number' ? rawObj.population : 
                  typeof rawObj.pop === 'number' ? rawObj.pop :
                  typeof rawObj.population === 'string' ? parseInt(rawObj.population, 10) : undefined;
    
    let computedDensite: number | undefined;
    if (typeof rawObj.densite === 'number' && rawObj.densite > 0) {
      computedDensite = rawObj.densite;
    } else if (typeof rawObj.density === 'number' && rawObj.density > 0) {
      computedDensite = rawObj.density;
    } else if (population && extractedSurfaceKm2 && extractedSurfaceKm2 > 0) {
      computedDensite = population / extractedSurfaceKm2;
    }
    
    const fallback: InseeData = {
      code_commune: String(rawObj.code_commune || rawObj.code_insee || ''),
      commune: String(rawObj.commune || rawObj.nom_commune || rawObj.city || ''),
      departement: String(rawObj.departement || rawObj.dept || ''),
      population,
      densite: computedDensite,
      surface_km2: extractedSurfaceKm2,
      evolution_pop_5ans: typeof rawObj.evolution_pop_5ans === 'number' ? rawObj.evolution_pop_5ans : undefined,
      revenu_median: typeof rawObj.revenu_median === 'number' ? rawObj.revenu_median : undefined,
      taux_chomage: typeof rawObj.taux_chomage === 'number' ? rawObj.taux_chomage : undefined,
      pct_moins_15: typeof rawObj.pct_moins_15 === 'number' ? rawObj.pct_moins_15 : undefined,
      pct_15_29: typeof rawObj.pct_15_29 === 'number' ? rawObj.pct_15_29 : undefined,
      pct_plus_60: typeof rawObj.pct_plus_60 === 'number' ? rawObj.pct_plus_60 : undefined,
      pct_plus_65: typeof rawObj.pct_plus_65 === 'number' ? rawObj.pct_plus_65 : undefined,
      pct_plus_75: typeof rawObj.pct_plus_75 === 'number' ? rawObj.pct_plus_75 : undefined,
      pct_plus_85: typeof rawObj.pct_plus_85 === 'number' ? rawObj.pct_plus_85 : undefined,
    };

    if (DEBUG_INSEE) logData('INSEE fallback result', { population: fallback.population, commune: fallback.commune });
    return fallback;
  }

  const merged: InseeData = { ...normalized };
  if (!merged.surface_km2 && extractedSurfaceKm2) {
    merged.surface_km2 = extractedSurfaceKm2;
  }
  if (!merged.densite && merged.population && merged.surface_km2 && merged.surface_km2 > 0) {
    merged.densite = merged.population / merged.surface_km2;
  }

  if (DEBUG_INSEE) logData('INSEE merged result', { population: merged.population, commune: merged.commune });
  return merged;
};

// ============================================
// SERVICES NORMALIZATION
// ============================================
type ServicesRecord = Record<string, ServiceProche | null | undefined>;

const normalizeDistanceValue = (
  distanceKm: unknown,
  distanceM: unknown,
  distanceRaw: unknown
): number | undefined => {
  if (typeof distanceKm === 'number' && distanceKm >= 0) return distanceKm;
  if (typeof distanceM === 'number' && distanceM >= 0) return distanceM / 1000;
  if (typeof distanceRaw === 'number' && distanceRaw >= 0) {
    return distanceRaw > 100 ? distanceRaw / 1000 : distanceRaw;
  }
  return undefined;
};

const pickServiceObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return first as Record<string, unknown>;
    }
    return null;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
};

const convertToServiceProche = (svc: Record<string, unknown>): ServiceProche => {
  const distKm = normalizeDistanceValue(svc.distance_km, svc.distance_m, svc.distance);
  return {
    nom: String(svc.nom || svc.name || svc.label || ''),
    commune: String(svc.commune || svc.city || svc.ville || ''),
    distance_km: distKm,
    distance_m: typeof svc.distance_m === 'number' ? svc.distance_m : undefined,
  };
};

const normalizeServicesRuraux = (raw: unknown): ServicesRecord => {
  if (DEBUG_SERVICES) {
    const shape = inspectServicesShape(raw);
    logData('services inspection', {
      rawType: shape.rawType,
      isEmpty: shape.isEmpty,
      topKeysCount: shape.topKeys.length,
    });
  }
  
  if (Array.isArray(raw) || !raw || typeof raw !== 'object') {
    return {};
  }

  const input = raw as Record<string, unknown>;
  const result: ServicesRecord = {};

  const KEY_MAPPINGS: Record<string, string[]> = {
    supermarche_proche: ['supermarche_proche', 'supermarche', 'supermarket', 'grocery'],
    station_service_proche: ['station_service_proche', 'station_service', 'fuel', 'gas_station'],
    banque_proche: ['banque_proche', 'banque', 'bank', 'bank_atm', 'atm'],
    poste_proche: ['poste_proche', 'poste', 'post_office', 'post'],
    medecin_proche: ['medecin_proche', 'medecin', 'doctor', 'doctors'],
    pharmacie_proche: ['pharmacie_proche', 'pharmacie', 'pharmacy'],
    gendarmerie_proche: ['gendarmerie_proche', 'gendarmerie'],
    commissariat_proche: ['commissariat_proche', 'commissariat', 'police'],
  };

  const flattenedInput: Record<string, unknown> = { ...input };
  const NESTED_KEYS = ['commerces', 'commerce', 'sante', 'health', 'securite', 'security', 'services', 'proximite', 'nearby'];
  
  for (const nestedKey of NESTED_KEYS) {
    const nestedValue = input[nestedKey];
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      const nested = nestedValue as Record<string, unknown>;
      for (const [k, v] of Object.entries(nested)) {
        flattenedInput[k] = v;
      }
    }
  }

  for (const [normalizedKey, variants] of Object.entries(KEY_MAPPINGS)) {
    if (result[normalizedKey]?.distance_km !== undefined) continue;
    
    for (const variant of variants) {
      const rawValue = flattenedInput[variant] ?? flattenedInput[variant.toLowerCase()];
      const svc = pickServiceObject(rawValue);
      if (svc && (svc.distance_km !== undefined || svc.distance_m !== undefined || svc.distance !== undefined)) {
        result[normalizedKey] = convertToServiceProche(svc);
        break;
      }
    }
  }

  return result;
};

const getAllServicesFromMarket = (market: Record<string, unknown>): ServicesRecord => {
  if (!market || typeof market !== 'object') return {};

  const SERVICE_SOURCES = ['services_ruraux', 'services', 'amenities', 'services_proches', 'nearby', 'commerces', 'sante'];
  const mergedServices: ServicesRecord = {};

  for (const sourceKey of SERVICE_SOURCES) {
    const sourceData = market[sourceKey];
    if (sourceData && typeof sourceData === 'object') {
      const normalized = normalizeServicesRuraux(sourceData);
      for (const [key, value] of Object.entries(normalized)) {
        if (value && value.distance_km !== undefined && !mergedServices[key]?.distance_km) {
          mergedServices[key] = value;
        }
      }
    }
  }

  return mergedServices;
};

const convertShopsToServicesRecord = (shops: ShopsData | null | undefined): ServicesRecord => {
  if (!shops?.categories) return {};

  const result: ServicesRecord = {};
  const CATEGORY_TO_SERVICE: Record<string, string> = {
    supermarket: 'supermarche_proche',
    fuel: 'station_service_proche',
    bank_atm: 'banque_proche',
    post: 'poste_proche',
    doctor: 'medecin_proche',
    pharmacy: 'pharmacie_proche',
    gendarmerie: 'gendarmerie_proche',
    commissariat: 'commissariat_proche',
  };

  for (const [category, serviceKey] of Object.entries(CATEGORY_TO_SERVICE)) {
    const catData = shops.categories[category];
    if (catData?.top?.length > 0) {
      const firstItem = catData.top[0];
      if (!result[serviceKey]) {
        result[serviceKey] = {
          nom: firstItem.name || '',
          commune: '',
          distance_km: firstItem.distance_m / 1000,
          distance_m: firstItem.distance_m,
        };
      }
    }
  }

  return result;
};

// ============================================
// BPE EXTRACTION
// ============================================
const extractBpeData = (market: Record<string, unknown>): NormalizedBpeData | null => {
  if (!market || typeof market !== 'object') return null;

  const result: NormalizedBpeData = {};
  const bpe = market.bpe as Record<string, unknown> | undefined;
  
  if (bpe && typeof bpe === 'object') {
    if (typeof bpe.nb_commerces === 'number') result.nb_commerces = bpe.nb_commerces;
    if (typeof bpe.nb_sante === 'number') result.nb_sante = bpe.nb_sante;
    if (typeof bpe.nb_services === 'number') result.nb_services = bpe.nb_services;
    if (typeof bpe.nb_enseignement === 'number') result.nb_enseignement = bpe.nb_enseignement;
    if (typeof bpe.nb_sport_culture === 'number') result.nb_sport_culture = bpe.nb_sport_culture;
    if (bpe.source) result.source = bpe.source as string | { provider: string };
  }

  const hasData = Object.keys(result).filter(k => k !== 'source').some(k => result[k as keyof NormalizedBpeData] !== undefined);
  return hasData ? result : null;
};

// ============================================
// EHPAD HELPERS
// ============================================
interface RawEhpadItem {
  name?: string;
  nom?: string;
  address?: string;
  adresse?: string;
  commune?: string;
  city?: string;
  distance_km?: number;
  beds_total?: number;
  capacite?: number;
  finess?: string;
  telephone?: string;
  prix_journalier?: number;
  taux_occupation?: number;
}

const mapRawEhpadToEnriched = (rawItems: RawEhpadItem[]): FacilityEnriched[] => {
  return rawItems.map(item => ({
    nom: item.name || item.nom || "Établissement sans nom",
    commune: item.commune || item.city || "",
    distance_km: item.distance_km || 0,
    capacite: item.beds_total ?? item.capacite ?? undefined,
    finess: item.finess || undefined,
    adresse: item.address || item.adresse || undefined,
    telephone: item.telephone || undefined,
    prix_journalier: item.prix_journalier ?? undefined,
    taux_occupation: item.taux_occupation ?? undefined,
  }));
};

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry?: { type: string; coordinates?: number[] };
}

const mapGeoJsonFeaturesToRawItems = (features: GeoJsonFeature[]): RawEhpadItem[] => {
  return features.map((feature) => {
    const props = feature.properties || {};
    return {
      name: String(props.name || props.nom || props.rs || "Établissement"),
      address: String(props.address || props.adresse || ""),
      commune: String(props.commune || props.libcommune || ""),
      beds_total: typeof props.beds_total === 'number' ? props.beds_total : undefined,
      distance_km: typeof props.distance_km === 'number' ? props.distance_km : undefined,
      finess: String(props.finess || props.nofinesset || ""),
      telephone: String(props.telephone || ""),
    };
  });
};

const extractEhpadItemsFromResponse = (finessResult: unknown): RawEhpadItem[] => {
  if (!finessResult) return [];

  if (Array.isArray(finessResult)) {
    if (finessResult.length > 0 && finessResult[0]?.type === "Feature" && finessResult[0]?.properties) {
      return mapGeoJsonFeaturesToRawItems(finessResult);
    }
    return finessResult as RawEhpadItem[];
  }

  if (typeof finessResult === 'object') {
    const obj = finessResult as Record<string, unknown>;
    if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
      return mapGeoJsonFeaturesToRawItems(obj.features as GeoJsonFeature[]);
    }
    const possibleArrayProps = ['items', 'liste', 'facilities', 'etablissements', 'data', 'results'];
    for (const prop of possibleArrayProps) {
      if (Array.isArray(obj[prop])) {
        return obj[prop] as RawEhpadItem[];
      }
    }
  }

  return [];
};

const buildEhpadDataFromRaw = (rawItems: RawEhpadItem[], inseeData?: InseeData | null): EHPADData => {
  const mappedFacilities = mapRawEhpadToEnriched(rawItems);
  const totalCapacity = mappedFacilities.reduce((sum, f) => sum + (f.capacite || 0), 0);
  
  let densiteLits: number | undefined;
  if (inseeData?.population && inseeData?.pct_plus_75) {
    const pop75Plus = inseeData.population * (inseeData.pct_plus_75 / 100);
    if (pop75Plus > 0 && totalCapacity > 0) {
      densiteLits = (totalCapacity / pop75Plus) * 1000;
    }
  }

  let verdict: string | undefined;
  const count = mappedFacilities.length;
  if (count === 0) {
    verdict = "Aucun établissement concurrent identifié. Opportunité potentielle.";
  } else if (count <= 2) {
    verdict = `Faible concurrence avec ${count} établissement(s).`;
  } else if (count <= 5) {
    verdict = `Concurrence modérée avec ${count} établissements.`;
  } else {
    verdict = `Marché concurrentiel avec ${count} établissements.`;
  }

  return {
    count,
    liste: mappedFacilities,
    analyse_concurrence: {
      capacite_totale: totalCapacity > 0 ? totalCapacity : undefined,
      densite_lits_1000_seniors: densiteLits,
      verdict,
    },
  };
};// ============================================
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
};

// ============================================
// COMPOSANTS UI DE BASE
// ============================================

const ScoreGauge: React.FC<{ score: number | null | undefined; size?: number; showVerdict?: boolean }> = ({ 
  score, 
  size = 140,
  showVerdict = true 
}) => {
  logRender('ScoreGauge', { score, size });
  
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

const DataSourcesBadges: React.FC<{ sources: DataSourceType[]; available?: Record<string, boolean> }> = ({ 
  sources, 
  available = {} 
}) => {
  const SOURCE_LABELS: Record<DataSourceType, string> = {
    insee: "INSEE",
    finess: "FINESS",
    dvf: "DVF",
    bpe: "BPE",
    mesr: "MESR",
    adt: "ADT",
    sirene: "SIRENE",
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {sources.map((source) => {
        const isAvailable = available[source] !== false;
        return (
          <div
            key={source}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 10px",
              background: isAvailable ? "#dcfce7" : "#f1f5f9",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              color: isAvailable ? "#166534" : "#94a3b8",
            }}
          >
            {isAvailable ? <CheckCircle size={12} /> : <X size={12} />}
            {SOURCE_LABELS[source]}
          </div>
        );
      })}
    </div>
  );
};

const InsightCard: React.FC<{ 
  type: string; 
  title: string; 
  description: string;
  value?: string;
}> = ({ type, title, description, value }) => {
  const configs: Record<string, { bg: string; border: string; color: string; dot: string }> = {
    positive: { bg: "#ecfdf5", border: "#a7f3d0", color: "#065f46", dot: "#10b981" },
    warning: { bg: "#fef3c7", border: "#fcd34d", color: "#92400e", dot: "#f59e0b" },
    negative: { bg: "#fee2e2", border: "#fca5a5", color: "#991b1b", dot: "#ef4444" },
    opportunity: { bg: "#dbeafe", border: "#93c5fd", color: "#1e40af", dot: "#3b82f6" },
  };
  
  const config = configs[type] || configs.warning;
  
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b", margin: 0 }}>{title}</p>
            {value && (
              <span style={{ fontSize: "14px", fontWeight: 700, color: config.color }}>{value}</span>
            )}
          </div>
          <p style={{ fontSize: "13px", color: "#475569", margin: "4px 0 0 0" }}>{description}</p>
        </div>
      </div>
    </div>
  );
};

const ServiceRowWithDropdown: React.FC<{
  icon: LucideIcon;
  label: string;
  data?: ServiceProche | null;
  topItems?: ShopItem[];
  showIfNull?: boolean;
}> = ({ icon: Icon, label, data, topItems, showIfNull = true }) => {
  const [expanded, setExpanded] = useState(false);
  
  if (!data && !showIfNull) return null;
  
  const distance = data ? (data.distance_km ?? (data.distance_m ? data.distance_m / 1000 : null)) : null;
  const distanceColor = getDistanceColor(distance);
  const hasDropdown = topItems && topItems.length > 1;
  
  const IconComponent = Icon || Store;
  
  return (
    <div style={{ borderBottom: "1px solid #f1f5f9" }}>
      <div 
        style={{ 
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 0",
          cursor: hasDropdown ? "pointer" : "default",
        }}
        onClick={() => hasDropdown && setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "8px",
            background: data ? "#eef2ff" : "#f8fafc",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <IconComponent size={16} color={data ? "#6366f1" : "#cbd5e1"} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "14px", fontWeight: 500, color: "#334155" }}>{label}</span>
              {hasDropdown && (
                <>
                  <span style={{ 
                    fontSize: "10px", 
                    color: "#94a3b8",
                    background: "#f1f5f9",
                    padding: "2px 6px",
                    borderRadius: "4px"
                  }}>
                    {topItems.length}
                  </span>
                  {expanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                </>
              )}
            </div>
            {data?.nom ? (
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>{data.nom}</p>
            ) : !data ? (
              <p style={{ fontSize: "12px", color: "#cbd5e1", margin: 0, fontStyle: "italic" }}>Aucun trouvé</p>
            ) : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: distanceColor }}>
            {distance != null ? `${distance.toFixed(1)} km` : "—"}
          </span>
          {data?.commune && (
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>{data.commune}</p>
          )}
        </div>
      </div>
      
      {expanded && topItems && topItems.length > 1 && (
        <div style={{ 
          paddingLeft: "48px", 
          paddingBottom: "12px",
          background: "#f8fafc",
          borderRadius: "8px",
          marginBottom: "8px"
        }}>
          {topItems.slice(1, 5).map((item, idx) => (
            <div 
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: idx < Math.min(topItems.length - 2, 3) ? "1px solid #e2e8f0" : "none"
              }}
            >
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                {item.name || "Sans nom"}
              </span>
              <span style={{ 
                fontSize: "12px", 
                fontWeight: 600, 
                color: getDistanceColor(item.distance_m / 1000) 
              }}>
                {item.distance_m >= 1000 
                  ? `${(item.distance_m / 1000).toFixed(1)} km`
                  : `${Math.round(item.distance_m)} m`
                }
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MapWithMarkers: React.FC<{ 
  center?: { lat: number; lon: number }; 
  radius?: number;
  zoneName?: string;
}> = ({ center, radius = 500, zoneName }) => {
  if (!center) {
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

  const delta = radius / 50000;
  
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${center.lon - delta},${center.lat - delta},${center.lon + delta},${center.lat + delta}&layer=mapnik&marker=${center.lat},${center.lon}`;

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
          {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
        </div>
      </div>
      
      <div style={{
        position: "absolute", bottom: "12px", right: "12px",
        background: "rgba(255,255,255,0.95)", borderRadius: "6px",
        padding: "6px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "20px", height: "2px", background: "#1e293b", borderRadius: "1px" }} />
          <span style={{ fontSize: "11px", color: "#1e293b", fontWeight: 500 }}>
            {radius >= 1000 ? `${(radius/1000).toFixed(1)} km` : `${radius} m`}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================
// CARDS COMPOSANTS
// ============================================

const PrixImmobilierCard: React.FC<{ prices?: Record<string, unknown>; transactions?: Record<string, unknown> }> = ({ prices, transactions }) => {
  logRender('PrixImmobilierCard', { hasPrice: !!prices });
  
  const pricesTyped = prices as { median_eur_m2?: number; evolution_1an?: number; min_eur_m2?: number; q1_eur_m2?: number; q3_eur_m2?: number; max_eur_m2?: number } | undefined;
  const transactionsTyped = transactions as { count?: number } | undefined;

  if (!pricesTyped || pricesTyped.median_eur_m2 == null) {
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
          <p>Données de prix non disponibles pour cette zone</p>
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
          DVF
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
          {formatPrice(pricesTyped.median_eur_m2)}
        </div>
        {pricesTyped.evolution_1an != null && (
          <div style={{ 
            display: "inline-flex", alignItems: "center", gap: "6px",
            marginTop: "12px", padding: "6px 12px", borderRadius: "8px",
            background: pricesTyped.evolution_1an >= 0 ? "#d1fae5" : "#fee2e2",
            color: pricesTyped.evolution_1an >= 0 ? "#065f46" : "#991b1b",
            fontSize: "13px", fontWeight: 600
          }}>
            {pricesTyped.evolution_1an >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {formatPercent(pricesTyped.evolution_1an, true)} sur 1 an
          </div>
        )}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "20px" }}>
        {[
          { label: "Min", value: pricesTyped.min_eur_m2, color: "#3b82f6" },
          { label: "Q1 (25%)", value: pricesTyped.q1_eur_m2, color: "#8b5cf6" },
          { label: "Q3 (75%)", value: pricesTyped.q3_eur_m2, color: "#ec4899" },
          { label: "Max", value: pricesTyped.max_eur_m2, color: "#ef4444" },
        ].map((item, i) => (
          <div key={i} style={{ textAlign: "center", padding: "12px", background: "#f8fafc", borderRadius: "10px" }}>
            <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 500, marginBottom: "4px" }}>{item.label}</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: item.color }}>
              {item.value ? formatPrice(item.value) : "—"}
            </div>
          </div>
        ))}
      </div>
      
      <div style={{ 
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 18px", background: "#f0f9ff", borderRadius: "10px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <TrendingUp size={20} color="#0284c7" />
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#0c4a6e" }}>Transactions</div>
            <div style={{ fontSize: "12px", color: "#0369a1" }}>Sur 24 mois</div>
          </div>
        </div>
        <div style={{ fontSize: "28px", fontWeight: 800, color: "#0284c7" }}>
          {transactionsTyped?.count ?? "—"}
        </div>
      </div>
    </div>
  );
};

const DemographieCard: React.FC<{ insee?: InseeData | null; projectNature: ProjectType }> = ({ insee, projectNature }) => {
  logRender('DemographieCard', { hasInsee: !!insee, projectNature });
  
  const config = getSafeProjectConfig(projectNature);
  
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

  let displayDensite: number | null = null;
  if (insee.densite != null && insee.densite > 0) {
    displayDensite = insee.densite;
  } else if (insee.population != null && insee.surface_km2 != null && insee.surface_km2 > 0) {
    displayDensite = insee.population / insee.surface_km2;
  }

  const getAgeData = () => {
    return config.demographicSegments?.map(segment => {
      let value: number | null = null;
      
      if (segment.inseeField === "pct_0_14") value = insee.pct_moins_15 ?? null;
      else if (segment.inseeField === "pct_15_29") value = insee.pct_15_29 ?? null;
      else if (segment.inseeField === "pct_60_plus") value = insee.pct_plus_60 ?? null;
      else if (segment.inseeField === "pct_75_84") value = insee.pct_plus_75 ?? null;
      else if (segment.inseeField === "pct_85_plus") value = insee.pct_plus_85 ?? null;
      
      return { label: segment.label, value, color: segment.color, isPrimary: segment.isPrimary };
    }).filter(d => d.value != null) || [];
  };

  const ageData = getAgeData();

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Users size={20} color={config.color} />
        Données Démographiques
        <span style={{ 
          ...styles.badge, 
          background: `${config.color}20`, 
          color: config.color, 
          marginLeft: "auto" 
        }}>
          {insee.commune || insee.code_commune || "INSEE"}
        </span>
      </div>
      
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "24px"
      }}>
        <div style={{
          background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
          borderRadius: "14px", padding: "16px", textAlign: "center"
        }}>
          <div style={{ fontSize: "11px", color: "#6366f1", fontWeight: 600, marginBottom: "4px" }}>POPULATION</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#4338ca" }}>
            {formatNumber(insee.population)}
          </div>
          {insee.evolution_pop_5ans != null && (
            <div style={{ 
              display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              fontSize: "12px", marginTop: "6px",
              color: insee.evolution_pop_5ans >= 0 ? "#059669" : "#dc2626"
            }}>
              {insee.evolution_pop_5ans >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {formatPercent(insee.evolution_pop_5ans, true)} /5 ans
            </div>
          )}
        </div>
        
        <div style={{
          background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
          borderRadius: "14px", padding: "16px", textAlign: "center"
        }}>
          <div style={{ fontSize: "11px", color: "#16a34a", fontWeight: 600, marginBottom: "4px" }}>SURFACE</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#15803d" }}>
            {insee.surface_km2 != null ? formatNumber(insee.surface_km2, 1) : "—"}
          </div>
          <div style={{ fontSize: "12px", color: "#22c55e", marginTop: "6px" }}>km²</div>
        </div>
        
        <div style={{
          background: "linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)",
          borderRadius: "14px", padding: "16px", textAlign: "center"
        }}>
          <div style={{ fontSize: "11px", color: "#a21caf", fontWeight: 600, marginBottom: "4px" }}>DENSITÉ</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#86198f" }}>
            {displayDensite != null ? formatNumber(Math.round(displayDensite)) : "—"}
          </div>
          <div style={{ fontSize: "12px", color: "#a855f7", marginTop: "6px" }}>hab./km²</div>
        </div>
      </div>
      
      {ageData.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "12px" }}>
            Répartition par âge
          </div>
          {ageData.map((tranche, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
              <span style={{ 
                fontSize: "12px", 
                color: tranche.isPrimary ? tranche.color : "#64748b", 
                fontWeight: tranche.isPrimary ? 600 : 400,
                width: "80px" 
              }}>
                {tranche.label}
              </span>
              <div style={{ flex: 1, height: "20px", background: "#f1f5f9", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min((tranche.value || 0) * 2.5, 100)}%`,
                  height: "100%", 
                  background: tranche.color, 
                  borderRadius: "10px",
                  transition: "width 0.5s ease-out"
                }} />
              </div>
              <span style={{ 
                fontSize: "13px", 
                fontWeight: 700, 
                color: tranche.isPrimary ? tranche.color : "#1e293b", 
                width: "50px", 
                textAlign: "right" 
              }}>
                {formatPercent(tranche.value)}
              </span>
            </div>
          ))}
        </div>
      )}
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: "#f8fafc", borderRadius: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Euro size={16} color="#10b981" />
            <span style={{ fontSize: "13px", color: "#64748b" }}>Revenu médian</span>
          </div>
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#10b981" }}>
            {insee.revenu_median ? `${formatPrice(insee.revenu_median)}/an` : "—"}
          </span>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: "#f8fafc", borderRadius: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Activity size={16} color={insee.taux_chomage && insee.taux_chomage > 10 ? "#ef4444" : "#f59e0b"} />
            <span style={{ fontSize: "13px", color: "#64748b" }}>Taux chômage</span>
          </div>
          <span style={{ fontSize: "15px", fontWeight: 700, color: insee.taux_chomage && insee.taux_chomage > 10 ? "#ef4444" : "#f59e0b" }}>
            {formatPercent(insee.taux_chomage)}
          </span>
        </div>
        
        {(projectNature === "ehpad" || projectNature === "residence_senior") && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: `${config.color}10`, borderRadius: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Heart size={16} color={config.color} />
                <span style={{ fontSize: "13px", color: "#64748b" }}>75+ ans</span>
              </div>
              <span style={{ fontSize: "15px", fontWeight: 700, color: config.color }}>
                {formatPercent(insee.pct_plus_75)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: `${config.color}10`, borderRadius: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Heart size={16} color={config.color} />
                <span style={{ fontSize: "13px", color: "#64748b" }}>65+ ans</span>
              </div>
              <span style={{ fontSize: "15px", fontWeight: 700, color: config.color }}>
                {formatPercent(insee.pct_plus_65)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};// ============================================
// SERVICES CARD
// ============================================
const ServicesCard: React.FC<{ 
  services?: Record<string, ServiceProche>; 
  shops?: ShopsData | null;
  bpe?: NormalizedBpeData | null;
  projectNature: ProjectType;
  actualRadiusKm?: number;
}> = ({ services = {}, shops, bpe, projectNature, actualRadiusKm }) => {
  logRender('ServicesCard', { 
    servicesCount: Object.keys(services).length, 
    hasShops: !!shops, 
    hasBpe: !!bpe 
  });
  
  const config = getSafeProjectConfig(projectNature);
  
  const displayRadius = shops?.radius_m_used 
    ? shops.radius_m_used / 1000 
    : (actualRadiusKm ?? config.radius.analysis);
  
  const hasShops = shops && shops.categories && Object.keys(shops.categories).length > 0;
  const dataSource = hasShops ? "OSM/shops" : (bpe ? "BPE" : null);
  
  const getServiceDataFromShopsOrServices = (
    shopCategories: string[],
    serviceKey: string
  ): { data: ServiceProche | null; topItems: ShopItem[] } => {
    if (shops?.categories) {
      for (const cat of shopCategories) {
        const catData = shops.categories[cat];
        if (catData?.top?.length > 0) {
          const first = catData.top[0];
          return {
            data: {
              nom: first.name || '',
              commune: '',
              distance_km: first.distance_m / 1000,
              distance_m: first.distance_m,
            },
            topItems: catData.top,
          };
        }
      }
    }
    
    const svc = services[serviceKey];
    if (svc?.distance_km !== undefined) {
      return { data: svc, topItems: [] };
    }
    
    return { data: null, topItems: [] };
  };

  const supermarche = getServiceDataFromShopsOrServices(['supermarket'], 'supermarche_proche');
  const stationService = getServiceDataFromShopsOrServices(['fuel'], 'station_service_proche');
  const banque = getServiceDataFromShopsOrServices(['bank_atm'], 'banque_proche');
  const poste = getServiceDataFromShopsOrServices(['post'], 'poste_proche');
  const medecin = getServiceDataFromShopsOrServices(['doctor'], 'medecin_proche');
  const pharmacie = getServiceDataFromShopsOrServices(['pharmacy'], 'pharmacie_proche');
  const gendarmerie = getServiceDataFromShopsOrServices(['gendarmerie'], 'gendarmerie_proche');
  const commissariat = getServiceDataFromShopsOrServices(['commissariat'], 'commissariat_proche');

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <ShoppingCart size={20} color="#f59e0b" />
        Services & Équipements
        <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e", marginLeft: "auto" }}>
          Rayon {displayRadius.toFixed(1)} km
        </span>
        {dataSource && (
          <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>
            {dataSource}
          </span>
        )}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "8px", textTransform: "uppercase" }}>
            Commerces
          </div>
          <ServiceRowWithDropdown icon={ShoppingCart} label="Supermarché" data={supermarche.data} topItems={supermarche.topItems} showIfNull />
          <ServiceRowWithDropdown icon={Fuel} label="Station service" data={stationService.data} topItems={stationService.topItems} showIfNull />
          <ServiceRowWithDropdown icon={Banknote} label="Banque / DAB" data={banque.data} topItems={banque.topItems} showIfNull />
          <ServiceRowWithDropdown icon={Mail} label="Bureau de poste" data={poste.data} topItems={poste.topItems} showIfNull />
        </div>
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "8px", textTransform: "uppercase" }}>
            Santé & Sécurité
          </div>
          <ServiceRowWithDropdown icon={Stethoscope} label="Médecin" data={medecin.data} topItems={medecin.topItems} showIfNull />
          <ServiceRowWithDropdown icon={Pill} label="Pharmacie" data={pharmacie.data} topItems={pharmacie.topItems} showIfNull />
          <ServiceRowWithDropdown icon={Shield} label="Gendarmerie" data={gendarmerie.data} topItems={gendarmerie.topItems} showIfNull />
          <ServiceRowWithDropdown icon={Shield} label="Commissariat" data={commissariat.data} topItems={commissariat.topItems} showIfNull />
        </div>
      </div>
    </div>
  );
};

// ============================================
// COMPETITION CARD
// ============================================
const CompetitionCard: React.FC<{ 
  data?: EHPADData | null; 
  insee?: InseeData | null;
  projectNature: ProjectType;
  isLoadingFiness?: boolean;
}> = ({ data, insee, projectNature, isLoadingFiness = false }) => {
  logRender('CompetitionCard', { hasData: !!data, isLoadingFiness });
  
  const [expanded, setExpanded] = useState(true);
  const config = getSafeProjectConfig(projectNature);
  const labels = config.competitionLabel;

  if (isLoadingFiness) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <Building size={20} color={config.color} />
          Concurrence
          <span style={{ ...styles.badge, background: "#dbeafe", color: "#1e40af", marginLeft: "auto" }}>
            <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
            Chargement...
          </span>
        </div>
        <div style={{ padding: "40px", textAlign: "center" }}>
          <Loader2 size={40} color={config.color} style={{ animation: "spin 1s linear infinite", marginBottom: "16px" }} />
          <p style={{ color: "#64748b", fontSize: "14px" }}>
            Recherche d'établissements...
          </p>
        </div>
      </div>
    );
  }

  const facilities: FacilityEnriched[] = data?.liste || [];
  const totalCount = data?.count || 0;
  const totalCapacity = data?.analyse_concurrence?.capacite_totale || 0;
  const analysis = data?.analyse_concurrence;

  if (totalCount === 0 && !analysis) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <Building size={20} color={config.color} />
          Concurrence
          <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534", marginLeft: "auto" }}>
            OSM + FINESS
          </span>
        </div>
        <div style={{ padding: "32px", textAlign: "center", background: "#f0fdf4", borderRadius: "12px" }}>
          <CheckCircle size={40} color="#10b981" style={{ marginBottom: "12px" }} />
          <p style={{ color: "#065f46", fontSize: "15px", fontWeight: 600, margin: 0 }}>
            Aucun {labels.singular.toLowerCase()} identifié dans la zone
          </p>
          <p style={{ color: "#059669", fontSize: "13px", margin: "8px 0 0 0" }}>
            Opportunité de marché potentielle
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Building size={20} color={config.color} />
        Concurrence
        <span style={{ ...styles.badge, background: `${config.color}20`, color: config.color, marginLeft: "auto" }}>
          {totalCount} {labels.plural.toLowerCase()}
        </span>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "14px", background: `${config.color}10`, borderRadius: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: 800, color: config.color }}>
            {totalCount}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{labels.plural}</div>
        </div>
        
        <div style={{ padding: "14px", background: "#f8fafc", borderRadius: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#1e293b" }}>
            {totalCapacity > 0 ? formatNumber(totalCapacity) : "—"}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{labels.unit} totaux</div>
        </div>
      </div>
      
      {analysis?.verdict && (
        <div style={{
          padding: "14px 18px", background: "#f8fafc", borderRadius: "10px",
          marginBottom: "16px", borderLeft: `4px solid ${config.color}`
        }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>
            📊 Analyse du marché
          </div>
          <p style={{ fontSize: "13px", color: "#475569", margin: 0, lineHeight: 1.5 }}>{analysis.verdict}</p>
        </div>
      )}
      
      {facilities.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "12px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#64748b" }}>
              Voir les {facilities.length} établissements
            </span>
            {expanded ? <ChevronUp size={18} color="#64748b" /> : <ChevronDown size={18} color="#64748b" />}
          </button>

          {expanded && (
            <div style={{ maxHeight: "none", overflowY: "visible" }}>
              {facilities.map((facility, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  padding: "14px", background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "8px", marginBottom: "4px"
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>
                      {facility.nom}
                    </div>
                    
                    <div style={{ 
                      fontSize: "12px", 
                      color: facility.adresse ? "#64748b" : "#cbd5e1", 
                      marginTop: "4px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "4px"
                    }}>
                      <MapPin size={12} style={{ flexShrink: 0, marginTop: "2px" }} />
                      <span style={{ lineHeight: 1.4 }}>{facility.adresse || "Adresse non disponible"}</span>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px", flexWrap: "wrap" }}>
                      <span style={{ 
                        fontSize: "12px", 
                        color: getDistanceColor(facility.distance_km),
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <Compass size={12} />
                        {facility.distance_km.toFixed(1)} km
                      </span>
                      
                      <span style={{ 
                        fontSize: "12px", 
                        color: facility.telephone ? "#64748b" : "#cbd5e1",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <Phone size={12} />
                        {facility.telephone || "—"}
                      </span>
                      
                      {facility.finess && (
                        <span style={{ 
                          fontSize: "10px", 
                          color: "#94a3b8", 
                          fontFamily: "monospace",
                          background: "#f1f5f9",
                          padding: "2px 6px",
                          borderRadius: "4px"
                        }}>
                          FINESS: {facility.finess}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ 
                    display: "flex", 
                    gap: "12px", 
                    alignItems: "flex-start",
                    marginLeft: "16px",
                    flexShrink: 0
                  }}>
                    <div style={{ textAlign: "center", minWidth: "50px" }}>
                      <div style={{ 
                        fontSize: "16px", 
                        fontWeight: 700, 
                        color: facility.capacite && facility.capacite > 0 ? config.color : "#cbd5e1" 
                      }}>
                        {facility.capacite && facility.capacite > 0 ? facility.capacite : "—"}
                      </div>
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>{labels.unit}</div>
                    </div>
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
// MARKET STUDY RESULTS - COMPOSANT PRINCIPAL DES RÉSULTATS
// ============================================
const MarketStudyResults: React.FC<{ 
  data: MarketStudyResult; 
  projectNature: ProjectType;
  finessData?: EHPADData | null;
  isLoadingFiness?: boolean;
}> = ({ data, projectNature, finessData, isLoadingFiness = false }) => {
  logRender('MarketStudyResults START', {
    hasData: !!data,
    hasMarket: !!data?.market,
    projectNature,
    hasFinessData: !!finessData,
    isLoadingFiness,
  });

  const market = data?.market;
  const config = getSafeProjectConfig(projectNature);
  
  if (!market) {
    logError('MarketStudyResults - NO MARKET DATA', { data });
    return (
      <div style={{ padding: "60px", textAlign: "center" }}>
        <AlertTriangle size={56} color="#f59e0b" style={{ marginBottom: "20px" }} />
        <h3 style={{ fontSize: "18px", color: "#1e293b", marginBottom: "8px" }}>Données non disponibles</h3>
        <p style={{ color: "#64748b" }}>Aucune donnée de marché n'a pu être récupérée pour cette localisation.</p>
        {DEBUG_RENDER && (
          <pre style={{ marginTop: "16px", padding: "12px", background: "#f1f5f9", borderRadius: "8px", fontSize: "11px", textAlign: "left", overflow: "auto" }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  logRender('MarketStudyResults - market OK', {
    score: market.score,
    hasInsee: !!market.insee,
    hasPrices: !!market.prices,
    insightsCount: market.insights?.length || 0,
  });

  const ehpadData =
    finessData && Array.isArray(finessData.liste) && finessData.liste.length > 0
      ? finessData
      : market.ehpad;

  const insights = market.insights || [];
  const allInsights = [...insights];

  if (finessData && (projectNature === "ehpad" || projectNature === "residence_senior")) {
    if (finessData.count === 0) {
      allInsights.push({
        type: "opportunity",
        title: "Aucune concurrence directe",
        description: "Aucun EHPAD identifié dans le rayon d'analyse.",
      });
    } else if (finessData.count && finessData.count <= 3) {
      allInsights.push({
        type: "positive",
        title: "Concurrence limitée",
        description: `Seulement ${finessData.count} établissement(s) identifié(s).`,
      });
    }
  }

  const positiveInsights = allInsights.filter(i => i.type === "positive" || i.type === "opportunity");
  const warningInsights = allInsights.filter(i => i.type === "warning" || i.type === "negative");
  
  const isEHPAD = projectNature === "ehpad";
  const isRSS = projectNature === "residence_senior";
  const showCompetition = isEHPAD || isRSS;

  const normalizedServices = getAllServicesFromMarket(market as unknown as Record<string, unknown>);
  const normalizedBpe = extractBpeData(market as unknown as Record<string, unknown>);
  const shopsData = (market as unknown as Record<string, unknown>).shops as ShopsData | null | undefined;
  
  const actualRadiusKm = data.input?.radius_km;

  logRender('MarketStudyResults - extracted data', {
    servicesCount: Object.keys(normalizedServices).filter(k => normalizedServices[k]?.distance_km !== undefined).length,
    hasShops: !!shopsData?.categories,
    hasBpe: !!normalizedBpe,
    actualRadiusKm,
  });

  return (
    <ErrorBoundary componentName="MarketStudyResults">
      <div>
        {/* Header résultats avec score */}
        <div style={{
          background: `linear-gradient(135deg, #1e293b 0%, ${config.color}90 50%, #1e293b 100%)`,
          borderRadius: "20px", padding: "32px", marginBottom: "24px", color: "white"
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "32px", alignItems: "center" }}>
            {/* Score */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ScoreGauge score={market.score} size={160} />
            </div>
            
            {/* Verdict & KPIs */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <SafeIcon icon={config.icon} fallback={Building2} size={24} />
                <h2 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>
                  {market.insee?.commune || "Analyse de marché"}
                  {market.insee?.departement && (
                    <span style={{ fontSize: "16px", fontWeight: 400, opacity: 0.7, marginLeft: "8px" }}>
                      ({market.insee.departement})
                    </span>
                  )}
                </h2>
              </div>
              <p style={{ fontSize: "14px", opacity: 0.8, marginBottom: "16px", lineHeight: 1.6 }}>
                {market.verdict || `Étude complète du potentiel de la zone.`}
              </p>
              
              {/* Sources de données */}
              <div style={{ marginBottom: "16px" }}>
                <DataSourcesBadges 
                  sources={config.requiredDataSources} 
                  available={{ 
                    insee: !!market.insee, 
                    dvf: !!market.prices?.median_eur_m2,
                    bpe: !!normalizedBpe || !!shopsData,
                    finess: !!finessData || isLoadingFiness,
                  }}
                />
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Population</div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>{formatNumber(market.insee?.population)}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Prix médian</div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>
                    {market.prices?.median_eur_m2 ? `${formatNumber(market.prices.median_eur_m2)}€` : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>
                    {isEHPAD || isRSS ? "Pop. 75+ ans" : "Transactions"}
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>
                    {isEHPAD || isRSS
                      ? formatPercent(market.insee?.pct_plus_75) 
                      : (market.transactions?.count ?? "—")}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Sous-scores */}
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px", opacity: 0.9 }}>Sous-scores</div>
              {[
                { label: "Démographie", score: market.demographieScore },
                { label: "Services", score: market.commoditesScore },
                { label: "Transport", score: market.transport?.score },
                ...((isEHPAD || isRSS) ? [{ label: "Santé", score: market.healthScore }] : []),
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "12px", opacity: 0.8, width: "80px" }}>{item.label}</span>
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
        
        {/* Carte + Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {/* Carte */}
          <div style={{ ...styles.card, padding: 0, overflow: "hidden" }}>
            <div style={{ height: "380px" }}>
              <MapWithMarkers 
                center={data.input?.resolved_point}
                radius={data.input?.radius_km ? data.input.radius_km * 1000 : config.radius.analysis * 1000}
                zoneName={market.insee?.commune}
              />
            </div>
            <div style={{ padding: "16px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <MapPin size={16} color="#ef4444" />
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>
                  {market.insee?.commune || data.input?.commune_insee}
                </span>
              </div>
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                Rayon: {data.input?.radius_km ? data.input.radius_km : config.radius.analysis} km
              </span>
            </div>
          </div>
          
          {/* Insights */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <ErrorBoundary componentName="InsightsPositive">
              <div style={styles.card}>
                <div style={styles.cardTitle}>
                  <CheckCircle size={20} color="#10b981" />
                  Points forts ({positiveInsights.length})
                </div>
                {positiveInsights.length > 0 ? (
                  positiveInsights.slice(0, 5).map((insight, i) => (
                    <InsightCard 
                      key={i} 
                      type={insight.type} 
                      title={insight.title} 
                      description={insight.description}
                      value={insight.value}
                    />
                  ))
                ) : (
                  <p style={{ fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>Aucun point fort identifié</p>
                )}
              </div>
            </ErrorBoundary>
            
            <ErrorBoundary componentName="InsightsWarning">
              <div style={styles.card}>
                <div style={styles.cardTitle}>
                  <AlertTriangle size={20} color="#f59e0b" />
                  Points de vigilance ({warningInsights.length})
                </div>
                {warningInsights.length > 0 ? (
                  warningInsights.slice(0, 5).map((insight, i) => (
                    <InsightCard 
                      key={i} 
                      type={insight.type} 
                      title={insight.title} 
                      description={insight.description}
                      value={insight.value}
                    />
                  ))
                ) : (
                  <p style={{ fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>Aucune alerte</p>
                )}
              </div>
            </ErrorBoundary>
          </div>
        </div>
        
        {/* Section Concurrence */}
        {showCompetition && (
          <div style={{ marginBottom: "24px" }}>
            <ErrorBoundary componentName="CompetitionCard">
              <CompetitionCard 
                data={ehpadData}
                insee={market.insee as InseeData | null}
                projectNature={projectNature}
                isLoadingFiness={isLoadingFiness}
              />
            </ErrorBoundary>
          </div>
        )}
        
        {/* Grille principale */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <ErrorBoundary componentName="PrixImmobilierCard">
            <PrixImmobilierCard prices={market.prices} transactions={market.transactions} />
          </ErrorBoundary>
          <ErrorBoundary componentName="DemographieCard">
            <DemographieCard insee={market.insee as InseeData | null} projectNature={projectNature} />
          </ErrorBoundary>
        </div>
        
        {/* Services */}
        <ErrorBoundary componentName="ServicesCard">
          <ServicesCard 
            services={normalizedServices} 
            shops={shopsData}
            bpe={normalizedBpe} 
            projectNature={projectNature}
            actualRadiusKm={actualRadiusKm}  
          />
        </ErrorBoundary>
        
        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "32px" }}>
          <button style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "14px 28px", background: "#1e293b", color: "white",
            border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer"
          }}>
            <FileText size={18} />
            Générer le rapport PDF
          </button>
          <button style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "14px 28px", background: "#f1f5f9", color: "#475569",
            border: "1px solid #e2e8f0", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer"
          }}>
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
  // États formulaire
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
  const [radius, setRadius] = useState(500);
  const [projectNature, setProjectNature] = useState<ProjectType>("ehpad");

  // États analyse
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFiness, setIsLoadingFiness] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<MarketStudyResult | null>(null);
  const [finessData, setFinessData] = useState<EHPADData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const addressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parcelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Config du projet sélectionné avec fallback sécurisé
  const projectConfig = useMemo(() => getSafeProjectConfig(projectNature), [projectNature]);

  // LOG: Changement de projectNature
  useEffect(() => {
    logData('Project nature changed', { projectNature, configLabel: projectConfig.label });
  }, [projectNature, projectConfig]);

  // Recherche adresse
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

  // Recherche parcelle
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

  // Mise à jour du rayon quand on change de type de projet
  useEffect(() => {
    setRadius(projectConfig.radius.analysis * 1000);
  }, [projectConfig]);

  const handleSelectAddress = useCallback((suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setAddress(suggestion.label);
    setAddressSuggestions([]);
    setLatitude(suggestion.lat.toFixed(6));
    setLongitude(suggestion.lon.toFixed(6));
    if (suggestion.citycode) setCodeInsee(suggestion.citycode);
  }, []);

  // ============================================
  // SUBMIT HANDLER AVEC LOGS COMPLETS
  // ============================================
  const handleSubmit = useCallback(async () => {
    const hasLocation = (latitude && longitude) || codeInsee || parcelInfo;
    if (!hasLocation) {
      setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE).");
      return;
    }

    logSubmit('Starting analysis', {
      latitude,
      longitude,
      codeInsee,
      radius,
      projectNature,
      hasSelectedAddress: !!selectedAddress,
    });

    setIsLoading(true);
    setIsLoadingFiness(true);
    setError(null);
    setAnalysisResult(null);
    setFinessData(null);

    const lat = latitude ? parseFloat(latitude) : NaN;
    const lon = longitude ? parseFloat(longitude) : NaN;
    const radiusKm = radius / 1000;

    try {
      const payload: Record<string, unknown> = {
        mode: "market_study",
        radius_km: radiusKm,
        horizon_months: 24,
        project_nature: projectNature,
        debug: true,
      };

      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        payload.lat = lat;
        payload.lon = lon;
        payload.lng = lon;
      }
      if (codeInsee) payload.commune_insee = codeInsee;
      if (parcelId && parcelInfo) payload.parcel_id = parcelInfo.id;

      logSubmit('Payload prepared', payload);

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error("Configuration Supabase manquante");
      }
      
      // 1) Appel API principal
      logApi('Calling smartscore-enriched-v3...');
      const apiResponse = await fetch(`${SUPABASE_URL}/functions/v1/smartscore-enriched-v3`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await apiResponse.json();

      logApi('API Response received', {
        ok: apiResponse.ok,
        success: result?.success,
        hasMarket: !!result?.market,
        marketKeys: result?.market ? Object.keys(result.market) : [],
        score: result?.market?.score,
      });

      if (!apiResponse.ok || !result.success) {
        throw new Error(result.error || `Erreur ${apiResponse.status}`);
      }

      // Vérification INSEE + Shops
      const hasInsee =
        !!result?.market?.insee &&
        (result.market.insee.population != null ||
         result.market.insee.commune != null);

      const hasShops =
        !!result?.market?.shops &&
        !!result.market.shops.categories &&
        Object.keys(result.market.shops.categories).length > 0;

      logApi('Data check', { hasInsee, hasShops });

      // Fallback si nécessaire
      if (!hasInsee || !hasShops) {
        logApi('Fallback needed, calling market-context-v1...');
        
        const addressAny = selectedAddress as Record<string, unknown> | null;
        const zipGuess = addressAny?.postcode || addressAny?.zip || undefined;
        const cityGuess = addressAny?.city || addressAny?.name || undefined;
        const fallbackLat = !Number.isNaN(lat) ? lat : result?.input?.resolved_point?.lat;
        const fallbackLon = !Number.isNaN(lon) ? lon : result?.input?.resolved_point?.lon;

        const fallbackResult = await fetchMarketContextFallback({
          supabaseUrl: SUPABASE_URL,
          anonKey: SUPABASE_ANON_KEY,
          zipCode: zipGuess as string | undefined,
          city: cityGuess as string | undefined,
          lat: fallbackLat,
          lon: fallbackLon,
        });

        if (!hasInsee && fallbackResult.insee) {
          result.market = result.market || {};
          result.market.insee = safeNormalizeInseeData(fallbackResult.insee) ?? fallbackResult.insee;
          logApi('INSEE merged from fallback');
        }

        if (!hasShops && fallbackResult.shops) {
          result.market = result.market || {};
          result.market.shops = fallbackResult.shops;
          logApi('Shops merged from fallback');
        }
      }

      // Fallback BPE via Overpass
      const hasBpe = !!result?.market?.bpe && (
        (result.market.bpe.nb_commerces ?? 0) > 0 ||
        (result.market.bpe.nb_services ?? 0) > 0
      );
      
      const hasShopsAfterFallback = !!result?.market?.shops?.categories && 
        Object.keys(result.market.shops.categories).length > 0;

      if (!hasBpe && !hasShopsAfterFallback) {
        const overpassLat = !Number.isNaN(lat) ? lat : result?.input?.resolved_point?.lat;
        const overpassLon = !Number.isNaN(lon) ? lon : result?.input?.resolved_point?.lon;
        
        if (typeof overpassLat === 'number' && typeof overpassLon === 'number') {
          logApi('BPE fallback via Overpass...');
          const shopCount = await fetchOverpassShopCount(overpassLat, overpassLon, Math.min(radius, 3000));
          if (shopCount != null) {
            result.market = result.market || {};
            result.market.bpe = result.market.bpe || {};
            result.market.bpe.nb_commerces = shopCount;
            result.market.bpe.source = { provider: "overpass", note: "shop count fallback" };
            logApi('Overpass result', { shopCount });
          }
        }
      }

      // Normalisation INSEE finale
      if (result?.market?.insee) {
        const normalizedInsee = safeNormalizeInseeData(result.market.insee);
        if (normalizedInsee && Object.keys(normalizedInsee).length > 0) {
          result.market.insee = normalizedInsee;
        }
      }

      logApi('Final data ready', {
        hasMarket: !!result?.market,
        score: result?.market?.score,
        hasInsee: !!result?.market?.insee,
        inseeCommune: result?.market?.insee?.commune,
        inseePopulation: result?.market?.insee?.population,
        hasShops: !!result?.market?.shops?.categories,
        hasBpe: !!result?.market?.bpe,
        hasPrices: !!result?.market?.prices?.median_eur_m2,
      });

      setAnalysisResult(result);

      // ============================================
      // SNAPSHOT: Patch project + market
      // ============================================
      try {
        // 1) Patch project info - UTILISE patchProjectInfo (pas patchProject)
        const resolvedLat = !Number.isNaN(lat) ? lat : result?.input?.resolved_point?.lat;
        const resolvedLon = !Number.isNaN(lon) ? lon : result?.input?.resolved_point?.lon;

        patchProjectInfo({
          address: selectedAddress?.label || address || undefined,
          city: (selectedAddress as Record<string, unknown>)?.city as string || result?.market?.insee?.commune || undefined,
          zipCode: (selectedAddress as Record<string, unknown>)?.postcode as string || undefined,
          parcelId: parcelInfo?.id || parcelId || undefined,
          projectType: projectNature,
          lat: typeof resolvedLat === 'number' && !Number.isNaN(resolvedLat) ? resolvedLat : undefined,
          lon: typeof resolvedLon === 'number' && !Number.isNaN(resolvedLon) ? resolvedLon : undefined,
        });

        // 2) Patch market module
        patchModule("market", {
          ok: true,
          verdict: result?.market?.verdict || undefined,
          summary: result?.market?.verdict || `Étude de marché générée - Score: ${result?.market?.score ?? '—'}/100`,
          data: result,
        });

        logApi('Snapshot patched: project + market');
      } catch (snapshotErr) {
        logError('Snapshot patch failed (non-blocking)', snapshotErr);
      }

      // 2) FINESS/OSM
      let finessLat: number | null = null;
      let finessLon: number | null = null;

      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        finessLat = lat;
        finessLon = lon;
      } else if (result?.input?.resolved_point?.lat != null) {
        finessLat = Number(result.input.resolved_point.lat);
        finessLon = Number(result.input.resolved_point.lon ?? result.input.resolved_point.lng);
      }

      if ((projectNature === "ehpad" || projectNature === "residence_senior") && finessLat != null && finessLon != null) {
        try {
          logApi('Calling FINESS...', { finessLat, finessLon, radiusKm });
          const finessResult = await fetchAllEHPAD(finessLat, finessLon, radiusKm);
          const inseeData = result?.market?.insee as InseeData | undefined;
          
          const rawItems = extractEhpadItemsFromResponse(finessResult);
          logApi('FINESS result', { itemsCount: rawItems.length });
          
          let ehpadData: EHPADData;
          if (rawItems.length > 0) {
            ehpadData = buildEhpadDataFromRaw(rawItems, inseeData);
          } else {
            ehpadData = convertToEhpadData([], inseeData);
          }
          
          setFinessData(ehpadData);

          // ============================================
          // SNAPSHOT: Patch finess module (utilise "risques" car finess n'existe pas dans le type)
          // ============================================
          try {
            const finessSummary = 
              ehpadData?.analyse_concurrence?.verdict ||
              (ehpadData?.count === 0 
                ? "Aucun établissement concurrent identifié" 
                : `${ehpadData?.count || 0} établissement(s) concurrent(s) identifié(s)`);

            // Note: On utilise "risques" comme module de fallback car "finess" n'est pas dans ModuleName
            // Vous pouvez ajouter "finess" au type ModuleName dans le store si nécessaire
            patchModule("risques", {
              ok: true,
              summary: finessSummary,
              data: ehpadData,
            });

            logApi('Snapshot patched: risques (finess data)');
          } catch (snapshotErr) {
            logError('Snapshot finess patch failed (non-blocking)', snapshotErr);
          }
        } catch (err) {
          logError('FINESS error (non blocking)', err);
        }
      }

      setIsLoadingFiness(false);

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Une erreur est survenue";
      logError('Submit error', { message: errorMessage, error: err });
      setError(errorMessage);
      setIsLoadingFiness(false);
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, codeInsee, parcelInfo, parcelId, radius, projectNature, selectedAddress, address]);

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
            {(DEBUG_SERVICES || DEBUG_INSEE || DEBUG_BPE || DEBUG_SHOPS || DEBUG_RENDER) && (
              <span style={{
                padding: "4px 8px",
                background: "#fef3c7",
                borderRadius: "4px",
                fontSize: "10px",
                fontWeight: 600,
                color: "#92400e",
              }}>
                🔍 DEBUG
              </span>
            )}
          </div>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", maxWidth: "700px", margin: 0 }}>
            {projectConfig.description}. Analyse complète des données INSEE, prix DVF, services et concurrence.
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
                    placeholder="Ex: 12 rue de la République, Bayonne"
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
                  placeholder="Ex: 64065000AI0001"
                  value={parcelId}
                  onChange={(e) => setParcelId(e.target.value)}
                  style={styles.input}
                />
              </div>

              {/* Coordonnées */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Latitude</label>
                <input type="text" placeholder="48.8566" value={latitude} onChange={(e) => setLatitude(e.target.value)} style={styles.input} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Longitude</label>
                <input type="text" placeholder="2.3522" value={longitude} onChange={(e) => setLongitude(e.target.value)} style={styles.input} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Code INSEE</label>
                <input type="text" placeholder="75056" value={codeInsee} onChange={(e) => setCodeInsee(e.target.value)} style={styles.input} />
              </div>

              {/* Nature projet */}
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
                  <option value="residence_senior">👴 Résidence senior</option>
                  <option value="residence_etudiante">🎓 Résidence étudiante</option>
                  <option value="ehpad">❤️ EHPAD</option>
                  <option value="bureaux">💼 Bureaux</option>
                  <option value="commerce">🛒 Commerce</option>
                  <option value="hotel">🏨 Hôtel</option>
                </select>
              </div>

              {/* Rayon */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Compass size={14} color={projectConfig.color} />
                  Rayon: <strong style={{ color: projectConfig.color }}>{radius >= 1000 ? `${(radius/1000).toFixed(1)} km` : `${radius} m`}</strong>
                </label>
                <input
                  type="range" min={100} max={30000} step={100} value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  style={{ width: "100%", marginTop: "8px", accentColor: projectConfig.color }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
                  <span>100m</span>
                  <span style={{ color: projectConfig.color, fontWeight: 500 }}>
                    Recommandé: {projectConfig.radius.analysis} km
                  </span>
                  <span>30km</span>
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
                  Récupération des données {projectConfig.requiredDataSources.join(", ").toUpperCase()}
                </p>
              </div>
            )}

            {!isLoading && analysisResult && analysisResult.market && (
              <ErrorBoundary componentName="MarketStudyResults">
                <MarketStudyResults 
                  data={analysisResult} 
                  projectNature={projectNature}
                  finessData={finessData}
                  isLoadingFiness={isLoadingFiness}
                />
              </ErrorBoundary>
            )}

            {!isLoading && analysisResult && !analysisResult.market && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "60px 40px", textAlign: "center"
              }}>
                <AlertTriangle size={56} color="#f59e0b" style={{ marginBottom: "20px" }} />
                <h3 style={{ fontSize: "18px", color: "#1e293b", marginBottom: "8px" }}>Données incomplètes</h3>
                <p style={{ color: "#64748b" }}>L'API a répondu mais aucune donnée de marché n'est disponible.</p>
                {DEBUG_RENDER && (
                  <pre style={{ marginTop: "16px", padding: "12px", background: "#f1f5f9", borderRadius: "8px", fontSize: "11px", textAlign: "left", overflow: "auto", maxWidth: "100%" }}>
                    {JSON.stringify(analysisResult, null, 2).slice(0, 1000)}...
                  </pre>
                )}
              </div>
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
                  pour lancer une analyse complète du potentiel de votre zone.
                </p>
                <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                  <span style={{ ...styles.badge, background: "#f1f5f9", color: "#64748b" }}>
                    Rayon recommandé: {projectConfig.radius.analysis} km
                  </span>
                  {projectConfig.requiredDataSources.map(source => (
                    <span key={source} style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>
                      {source.toUpperCase()}
                    </span>
                  ))}
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