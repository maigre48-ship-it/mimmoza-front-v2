// ===== PART 1/6 =====
// FILE: src/spaces/promoteur/etudes/marche/MarchePage.tsx
// CHANGES: Imports + DEBUG flags + Interfaces KeySample/ServicesShapeInspection (inchangés)

// Page Étude de marché - VERSION REFACTORISÉE AVEC MODULES EXTRAITS
// Configuration dynamique par type de projet + Composants enrichis + Données FINESS via API

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { 
  Search, MapPin, Grid3X3, Loader2, X, Building2, 
  Users, Euro, ShoppingCart, Stethoscope, GraduationCap, 
  TrendingUp, TrendingDown, Shield, Fuel, Mail, Banknote, CheckCircle,
  AlertTriangle, Home, Activity, Download,
  ChevronDown, ChevronUp, Heart, Pill,
  Target, Building, Hotel, Briefcase,
  Eye, Minus, MapPinned,
  Compass, FileText, Phone
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

// ============================================
// IMPORTS MODULES EXTRAITS
// ============================================
import type {
  ProjectType,
  AddressSuggestion,
  ParcelInfo,
  InseeData,
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
// DIAG: Flag de debug - mettre à false en prod
// ============================================
const DEBUG_SERVICES = true;
const DEBUG_INSEE = true; // FIX: Ajout flag debug INSEE

// ============================================
// DIAG: Inspection robuste de la structure services_ruraux
// ============================================

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

// DIAG: Inspecte la structure de services_ruraux pour diagnostic
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
  
  // DIAG: Flatten nested keys
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
  
  // DIAG: Sample chaque clé (max 25)
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

// DIAG: Patterns de recherche "best effort" pour détecter les services
const SERVICE_GUESS_PATTERNS: Record<string, string[]> = {
  supermarche: ['super', 'market', 'hyper', 'shop', 'aliment', 'grocery', 'epicerie', 'carrefour', 'leclerc', 'lidl', 'aldi', 'intermarche'],
  station_service: ['fuel', 'station', 'essence', 'gas', 'petrol', 'carburant', 'total', 'shell', 'bp'],
  banque: ['bank', 'banque', 'atm', 'dab', 'credit', 'caisse', 'bnp', 'societe_generale', 'lcl'],
  poste: ['post', 'poste', 'mail', 'courrier', 'la_poste', 'bureau_poste'],
  medecin: ['doctor', 'medecin', 'generaliste', 'physician', 'cabinet_medical', 'docteur'],
  pharmacie: ['pharm', 'pharmacy', 'officine', 'apotheke'],
  gendarmerie: ['gendar', 'police', 'commissariat', 'securite', 'security'],
};

// DIAG: Cherche des clés matchant les patterns de service
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
};// ===== PART 2/6 =====
// FILE: src/spaces/promoteur/etudes/marche/MarchePage.tsx
// CHANGES: Helpers formatNumber/formatPrice/formatPercent + getScoreColor/getVerdictConfig/getDistanceColor (inchangés)
// + FIX: Nouvelle fonction safeNormalizeInseeData avec fallback

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
};

// ============================================
// FIX: Safe INSEE normalization wrapper
// Préserve les données brutes si la normalisation échoue ou retourne un objet vide
// ============================================
const safeNormalizeInseeData = (rawInsee: unknown): InseeData | null => {
  if (!rawInsee || typeof rawInsee !== 'object') {
    if (DEBUG_INSEE) console.log('[INSEE] safeNormalizeInseeData: rawInsee is null/undefined or not object');
    return null;
  }

  const rawObj = rawInsee as Record<string, unknown>;
  
  if (DEBUG_INSEE) {
    console.log('[INSEE] ========== NORMALIZATION START ==========');
    console.log('[INSEE] Raw INSEE keys:', Object.keys(rawObj));
    console.log('[INSEE] Raw INSEE sample:', {
      population: rawObj.population,
      commune: rawObj.commune || rawObj.nom_commune || rawObj.libelle_commune,
      densite: rawObj.densite || rawObj.density,
      pct_plus_75: rawObj.pct_plus_75 || rawObj.pct_75_plus || rawObj.pop_75_plus_pct,
    });
  }

  // ASSUMPTION: normalizeInseeData peut retourner null ou un objet avec des champs manquants
  let normalized: InseeData | null = null;
  
  try {
    normalized = normalizeInseeData(rawInsee);
  } catch (err) {
    console.error('[INSEE] normalizeInseeData threw error:', err);
    normalized = null;
  }

  // FIX: Vérifier que la normalisation n'a pas perdu de données critiques
  const hasValidNormalized = normalized && (
    normalized.population != null ||
    normalized.commune != null ||
    normalized.densite != null
  );

  if (DEBUG_INSEE) {
    console.log('[INSEE] Normalized result:', normalized);
    console.log('[INSEE] hasValidNormalized:', hasValidNormalized);
  }

  if (!hasValidNormalized) {
    // FIX: Fallback - construire manuellement depuis les données brutes
    if (DEBUG_INSEE) console.log('[INSEE] Normalization failed or empty, using raw fallback');
    
    const fallback: InseeData = {
      code_commune: String(rawObj.code_commune || rawObj.code_insee || rawObj.insee_code || ''),
      commune: String(rawObj.commune || rawObj.nom_commune || rawObj.libelle_commune || rawObj.city || rawObj.name || ''),
      departement: String(rawObj.departement || rawObj.dept || rawObj.department || ''),
      population: typeof rawObj.population === 'number' ? rawObj.population : 
                  typeof rawObj.pop === 'number' ? rawObj.pop :
                  typeof rawObj.population === 'string' ? parseInt(rawObj.population, 10) : undefined,
      densite: typeof rawObj.densite === 'number' ? rawObj.densite :
               typeof rawObj.density === 'number' ? rawObj.density :
               typeof rawObj.densite_pop === 'number' ? rawObj.densite_pop : undefined,
      evolution_pop_5ans: typeof rawObj.evolution_pop_5ans === 'number' ? rawObj.evolution_pop_5ans :
                          typeof rawObj.evol_pop_5ans === 'number' ? rawObj.evol_pop_5ans : undefined,
      revenu_median: typeof rawObj.revenu_median === 'number' ? rawObj.revenu_median :
                     typeof rawObj.median_income === 'number' ? rawObj.median_income :
                     typeof rawObj.revenu_med === 'number' ? rawObj.revenu_med : undefined,
      taux_chomage: typeof rawObj.taux_chomage === 'number' ? rawObj.taux_chomage :
                    typeof rawObj.unemployment_rate === 'number' ? rawObj.unemployment_rate : undefined,
      pct_moins_15: typeof rawObj.pct_moins_15 === 'number' ? rawObj.pct_moins_15 :
                    typeof rawObj.pct_0_14 === 'number' ? rawObj.pct_0_14 : undefined,
      pct_moins_25: typeof rawObj.pct_moins_25 === 'number' ? rawObj.pct_moins_25 : undefined,
      pct_15_29: typeof rawObj.pct_15_29 === 'number' ? rawObj.pct_15_29 : undefined,
      pct_25_39: typeof rawObj.pct_25_39 === 'number' ? rawObj.pct_25_39 : undefined,
      pct_30_44: typeof rawObj.pct_30_44 === 'number' ? rawObj.pct_30_44 : undefined,
      pct_45_59: typeof rawObj.pct_45_59 === 'number' ? rawObj.pct_45_59 : undefined,
      pct_plus_60: typeof rawObj.pct_plus_60 === 'number' ? rawObj.pct_plus_60 :
                   typeof rawObj.pct_60_plus === 'number' ? rawObj.pct_60_plus : undefined,
      pct_plus_65: typeof rawObj.pct_plus_65 === 'number' ? rawObj.pct_plus_65 :
                   typeof rawObj.pct_65_plus === 'number' ? rawObj.pct_65_plus : undefined,
      pct_plus_75: typeof rawObj.pct_plus_75 === 'number' ? rawObj.pct_plus_75 :
                   typeof rawObj.pct_75_plus === 'number' ? rawObj.pct_75_plus :
                   typeof rawObj.pop_75_plus_pct === 'number' ? rawObj.pop_75_plus_pct : undefined,
      pct_plus_85: typeof rawObj.pct_plus_85 === 'number' ? rawObj.pct_plus_85 :
                   typeof rawObj.pct_85_plus === 'number' ? rawObj.pct_85_plus : undefined,
      evolution_75_plus_5ans: typeof rawObj.evolution_75_plus_5ans === 'number' ? rawObj.evolution_75_plus_5ans : undefined,
    };

    // FIX: Copier aussi surface_km2 si présent (pour calcul densité fallback)
    if (typeof rawObj.surface_km2 === 'number') {
      (fallback as any).surface_km2 = rawObj.surface_km2;
    } else if (typeof rawObj.superficie === 'number') {
      (fallback as any).surface_km2 = rawObj.superficie;
    } else if (typeof rawObj.area_km2 === 'number') {
      (fallback as any).surface_km2 = rawObj.area_km2;
    }

    if (DEBUG_INSEE) {
      console.log('[INSEE] Fallback result:', fallback);
      console.log('[INSEE] ========== NORMALIZATION END ==========');
    }

    return fallback;
  }

  // FIX: Fusionner normalized avec les champs bruts manquants
  const merged: InseeData = { ...normalized };
  
  // Copier surface_km2 si présent dans raw mais pas dans normalized
  if (!(merged as any).surface_km2) {
    if (typeof rawObj.surface_km2 === 'number') {
      (merged as any).surface_km2 = rawObj.surface_km2;
    } else if (typeof rawObj.superficie === 'number') {
      (merged as any).surface_km2 = rawObj.superficie;
    } else if (typeof rawObj.area_km2 === 'number') {
      (merged as any).surface_km2 = rawObj.area_km2;
    }
  }

  if (DEBUG_INSEE) {
    console.log('[INSEE] Merged result:', merged);
    console.log('[INSEE] ========== NORMALIZATION END ==========');
  }

  return merged;
};// ===== PART 3/6 =====
// FILE: src/spaces/promoteur/etudes/marche/MarchePage.tsx
// CHANGES: normalizeServicesRuraux + FIX: Nouvelle fonction getAllServicesFromMarket qui cherche dans toutes les sources possibles

// ============================================
// FIX: Helper de normalisation des services
// Gère les variations de nommage API (avec/sans _proche, fr/en, structures imbriquées)
// ============================================

type ServicesRecord = Record<string, ServiceProche | null | undefined>;

/**
 * FIX: Normalise la distance en km
 */
const normalizeDistanceValue = (
  distanceKm: unknown,
  distanceM: unknown,
  distanceRaw: unknown
): number | undefined => {
  // Priorité 1: distance_km déjà en km
  if (typeof distanceKm === 'number' && distanceKm >= 0) {
    return distanceKm;
  }
  // Priorité 2: distance_m à convertir
  if (typeof distanceM === 'number' && distanceM >= 0) {
    return distanceM / 1000;
  }
  // Priorité 3: distance brute (on assume que c'est en mètres si > 100)
  if (typeof distanceRaw === 'number' && distanceRaw >= 0) {
    return distanceRaw > 100 ? distanceRaw / 1000 : distanceRaw;
  }
  return undefined;
};

/**
 * FIX: Helper pour extraire un objet service depuis une valeur qui peut être:
 * - un objet direct { nom, distance_km, ... }
 * - un tableau [{ nom, distance_km, ... }, ...] (prend le premier)
 * - null/undefined/autre (retourne null)
 */
const pickServiceObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  
  // FIX: Si c'est un tableau non vide, prendre le premier élément
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return first as Record<string, unknown>;
    }
    return null;
  }
  
  // FIX: Si c'est un objet direct
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  
  return null;
};

/**
 * FIX: Convertit un objet service brut en ServiceProche normalisé
 */
const convertToServiceProche = (svc: Record<string, unknown>): ServiceProche => {
  const distKm = normalizeDistanceValue(svc.distance_km, svc.distance_m, svc.distance);
  
  return {
    nom: String(svc.nom || svc.name || svc.label || ''),
    commune: String(svc.commune || svc.city || svc.ville || ''),
    distance_km: distKm,
    distance_m: typeof svc.distance_m === 'number' ? svc.distance_m : undefined,
  };
};

/**
 * FIX: Normalise les clés des services renvoyées par l'API
 * Gère les variations de nommage (avec/sans _proche, fr/en, structures imbriquées)
 * et les valeurs qui peuvent être des objets OU des tableaux
 */
const normalizeServicesRuraux = (raw: unknown): ServicesRecord => {
  // DIAG: Inspection complète si debug activé
  if (DEBUG_SERVICES) {
    const shape = inspectServicesShape(raw);
    console.log('[DIAG] services source inspection:', {
      rawType: shape.rawType,
      isEmpty: shape.isEmpty,
      topKeys: shape.topKeys,
      flattenedTopKeys: shape.flattenedTopKeys.slice(0, 20),
      samplesCount: Object.keys(shape.samples).length,
    });
    
    // DIAG: Afficher les samples non-null
    const nonNullSamples = Object.entries(shape.samples)
      .filter(([_, v]) => v.type !== 'null' && v.type !== 'undefined')
      .slice(0, 15);
    if (nonNullSamples.length > 0) {
      console.log('[DIAG] services non-null samples:', Object.fromEntries(nonNullSamples));
    }
  }
  
  // FIX: Si raw est directement un array, on ne peut pas le normaliser
  if (Array.isArray(raw)) {
    if (DEBUG_SERVICES) console.warn('[DIAG] services source is an array (unexpected), returning empty');
    return {};
  }
  
  if (!raw || typeof raw !== 'object') {
    if (DEBUG_SERVICES) console.warn('[DIAG] services source is null/undefined or not an object');
    return {};
  }

  const input = raw as Record<string, unknown>;
  const result: ServicesRecord = {};

  // FIX: Mapping étendu des clés possibles -> clé normalisée attendue par le front
  // DIAG: Inclut maintenant des patterns observés dans différentes APIs
  const KEY_MAPPINGS: Record<string, string[]> = {
    // Commerces - patterns étendus
    supermarche_proche: [
      'supermarche_proche', 'supermarche', 'supermarket', 'supermarket_proche',
      'super_marche', 'supermarché', 'supermarche_nearest', 'nearest_supermarket',
      'shop_supermarket', 'amenity_supermarket', 'commerce_supermarche',
      'grocery', 'grocery_store', 'epicerie', 'alimentaire',
      // FIX: Ajout patterns supplémentaires observés
      'grande_surface', 'magasin_alimentation', 'commerce_alimentaire',
    ],
    superette_proche: [
      'superette_proche', 'superette', 'convenience', 'convenience_proche',
      'convenience_store', 'amenity_convenience', 'shop_convenience',
      'supérette', 'mini_market', 'petit_commerce',
      // FIX: Ajout patterns supplémentaires
      'proximite', 'alimentation_generale',
    ],
    hypermarche_proche: [
      'hypermarche_proche', 'hypermarche', 'hypermarket', 'hypermarché',
      'grande_surface', 'grand_magasin',
    ],
    station_service_proche: [
      'station_service_proche', 'station_service', 'gas_station', 'fuel', 'fuel_proche',
      'station_essence', 'essence', 'amenity_fuel', 'petrol_station',
      'carburant', 'station_carburant', 'fuel_station', 'gas',
      // FIX: Ajout patterns supplémentaires
      'station', 'pompe_essence', 'distributeur_carburant',
    ],
    banque_proche: [
      'banque_proche', 'banque', 'bank', 'bank_proche', 'dab', 'atm',
      'amenity_bank', 'amenity_atm', 'distributeur', 'dab_proche',
      'atm_proche', 'guichet', 'agence_bancaire',
      // FIX: Ajout patterns supplémentaires
      'distributeur_billets', 'guichet_automatique', 'agence_banque',
    ],
    poste_proche: [
      'poste_proche', 'poste', 'post_office', 'bureau_poste', 'la_poste',
      'amenity_post_office', 'bureau_de_poste', 'office_poste',
      'post', 'courrier', 'relais_poste',
      // FIX: Ajout patterns supplémentaires
      'agence_postale', 'point_poste', 'relais_colis',
    ],
    
    // Santé - patterns étendus
    medecin_proche: [
      'medecin_proche', 'medecin', 'doctor', 'doctors', 'medecin_generaliste',
      'generaliste', 'cabinet_medical', 'docteur', 'physician',
      'amenity_doctors', 'healthcare_doctor', 'medecin_nearest',
      // FIX: Ajout patterns supplémentaires
      'cabinet_medecin', 'maison_sante', 'centre_medical',
    ],
    pharmacie_proche: [
      'pharmacie_proche', 'pharmacie', 'pharmacy', 'amenity_pharmacy',
      'officine', 'healthcare_pharmacy', 'pharmacie_nearest',
      // FIX: Ajout patterns supplémentaires
      'officine_pharmacie', 'parapharmacie',
    ],
    
    // Sécurité - patterns étendus
    gendarmerie_proche: [
      'gendarmerie_proche', 'gendarmerie', 'police_gendarmerie',
      'brigade_gendarmerie', 'caserne_gendarmerie',
      // FIX: Ajout patterns supplémentaires
      'brigade', 'caserne',
    ],
    commissariat_proche: [
      'commissariat_proche', 'commissariat', 'police', 'police_proche',
      'amenity_police', 'poste_police', 'police_station',
      // FIX: Ajout patterns supplémentaires
      'poste_de_police', 'hotel_police',
    ],
  };

  // FIX: Cherche dans les sous-objets potentiels (commerces, sante, securite, etc.)
  const flattenedInput: Record<string, unknown> = { ...input };
  
  // FIX: Liste étendue des clés imbriquées possibles
  const NESTED_KEYS = [
    'commerces', 'commerce', 'sante', 'health', 'securite', 'security', 
    'services', 'proximite', 'nearby', 'amenities', 'equipements',
    'services_proximite', 'services_proches', 'poi', 'pois'
  ];
  
  for (const nestedKey of NESTED_KEYS) {
    const nestedValue = input[nestedKey];
    // FIX: Si c'est un objet (pas un array), on fusionne ses clés
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      const nested = nestedValue as Record<string, unknown>;
      for (const [k, v] of Object.entries(nested)) {
        // FIX: Ajouter avec plusieurs variantes de clé
        flattenedInput[k] = v;
        flattenedInput[`${nestedKey}_${k}`] = v;
        flattenedInput[`${nestedKey}.${k}`] = v;
      }
    }
  }

  // FIX: Pour chaque clé attendue par le front, cherche la valeur dans les variantes
  for (const [normalizedKey, variants] of Object.entries(KEY_MAPPINGS)) {
    // FIX: Skip si déjà trouvé
    if (result[normalizedKey] && result[normalizedKey]!.distance_km !== undefined) {
      continue;
    }
    
    for (const variant of variants) {
      // Chercher exact match
      let rawValue = flattenedInput[variant];
      
      // FIX: Chercher aussi en lowercase
      if (!rawValue) {
        const variantLower = variant.toLowerCase();
        for (const [k, v] of Object.entries(flattenedInput)) {
          if (k.toLowerCase() === variantLower) {
            rawValue = v;
            break;
          }
        }
      }
      
      // FIX: Chercher aussi avec underscores remplacés par tirets et vice versa
      if (!rawValue) {
        const variantAlt = variant.replace(/_/g, '-');
        rawValue = flattenedInput[variantAlt];
      }
      if (!rawValue) {
        const variantAlt = variant.replace(/-/g, '_');
        rawValue = flattenedInput[variantAlt];
      }
      
      // FIX: Utiliser pickServiceObject pour gérer objet ou array
      const svc = pickServiceObject(rawValue);
      if (svc) {
        // FIX: Vérifier que l'objet a des champs pertinents
        const hasRelevantFields = svc.distance_km !== undefined || 
                                   svc.distance_m !== undefined || 
                                   svc.distance !== undefined ||
                                   svc.nom || svc.name || svc.label;
        if (hasRelevantFields) {
          result[normalizedKey] = convertToServiceProche(svc);
          if (DEBUG_SERVICES) {
            console.log(`[DIAG] Mapped "${variant}" -> "${normalizedKey}"`, result[normalizedKey]);
          }
          break;
        }
      }
    }
  }

  // FIX: Copie aussi les clés déjà bien nommées qui n'ont pas été mappées
  for (const [key, rawValue] of Object.entries(flattenedInput)) {
    if (!result[key]) {
      const svc = pickServiceObject(rawValue);
      if (svc) {
        const hasRelevantFields = svc.distance_km !== undefined || 
                                   svc.distance_m !== undefined || 
                                   svc.distance !== undefined ||
                                   svc.nom || svc.name || svc.label;
        if (hasRelevantFields) {
          result[key] = convertToServiceProche(svc);
        }
      }
    }
  }

  // DIAG: Résumé des clés trouvées
  const foundKeys = Object.keys(result).filter(k => result[k] && result[k]!.distance_km !== undefined);
  
  if (DEBUG_SERVICES) {
    console.log('[DIAG] services normalized result:', {
      totalFound: foundKeys.length,
      foundKeys,
      details: foundKeys.reduce((acc, k) => {
        acc[k] = { nom: result[k]?.nom, distance_km: result[k]?.distance_km };
        return acc;
      }, {} as Record<string, any>),
    });
  }

  // DIAG: Si aucune clé trouvée, tenter la détection "best effort"
  if (foundKeys.length === 0 && DEBUG_SERVICES) {
    const flatKeys = Object.keys(flattenedInput);
    const guessed = guessServiceKeys(flatKeys);
    
    // Filtrer pour n'afficher que les guesses non vides
    const nonEmptyGuesses = Object.entries(guessed).filter(([_, v]) => v.length > 0);
    
    if (nonEmptyGuesses.length > 0) {
      console.log('[DIAG] services GUESS (clés potentielles détectées):', Object.fromEntries(nonEmptyGuesses));
      
      // DIAG: Essayer de mapper automatiquement les clés devinées
      for (const [serviceType, matchedKeys] of nonEmptyGuesses) {
        for (const matchedKey of matchedKeys) {
          const rawValue = flattenedInput[matchedKey];
          const svc = pickServiceObject(rawValue);
          if (svc) {
            const normalizedKey = `${serviceType}_proche`;
            if (!result[normalizedKey]) {
              result[normalizedKey] = convertToServiceProche(svc);
              console.log(`[DIAG] Auto-mapped "${matchedKey}" -> "${normalizedKey}"`, result[normalizedKey]);
            }
          }
        }
      }
    } else {
      console.log('[DIAG] services: No matching keys found even with guessing. Available keys:', flatKeys.slice(0, 20));
    }
  }

  return result;
};

// ============================================
// FIX: Nouvelle fonction pour récupérer les services depuis TOUTES les sources possibles du market
// Centralise le fallback dans un seul point
// ============================================
const getAllServicesFromMarket = (market: Record<string, unknown>): ServicesRecord => {
  if (!market || typeof market !== 'object') {
    if (DEBUG_SERVICES) console.log('[SERVICES] getAllServicesFromMarket: market is null/undefined');
    return {};
  }

  if (DEBUG_SERVICES) {
    console.log('[SERVICES] ========== SERVICES EXTRACTION START ==========');
    console.log('[SERVICES] Market keys:', Object.keys(market));
  }

  // FIX: Liste de toutes les sources possibles où l'API peut renvoyer les services
  const SERVICE_SOURCES = [
    'services_ruraux',
    'services',
    'amenities',
    'services_proches',
    'services_proximite',
    'nearby',
    'proximite',
    'poi',
    'pois',
    'equipements',
    'commerces',
    'sante',
    'securite',
  ];

  // FIX: Collecter les services depuis toutes les sources
  let mergedServices: ServicesRecord = {};
  let sourcesUsed: string[] = [];

  for (const sourceKey of SERVICE_SOURCES) {
    const sourceData = market[sourceKey];
    if (sourceData && typeof sourceData === 'object') {
      if (DEBUG_SERVICES) {
        console.log(`[SERVICES] Found source "${sourceKey}", type:`, Array.isArray(sourceData) ? 'array' : 'object');
      }
      
      const normalized = normalizeServicesRuraux(sourceData);
      const foundInSource = Object.keys(normalized).filter(k => normalized[k]?.distance_km !== undefined);
      
      if (foundInSource.length > 0) {
        sourcesUsed.push(sourceKey);
        // FIX: Fusionner sans écraser les valeurs existantes
        for (const [key, value] of Object.entries(normalized)) {
          if (value && value.distance_km !== undefined) {
            if (!mergedServices[key] || mergedServices[key]!.distance_km === undefined) {
              mergedServices[key] = value;
            }
          }
        }
      }
    }
  }

  if (DEBUG_SERVICES) {
    const finalKeys = Object.keys(mergedServices).filter(k => mergedServices[k]?.distance_km !== undefined);
    console.log('[SERVICES] Sources used:', sourcesUsed);
    console.log('[SERVICES] Final merged keys:', finalKeys);
    console.log('[SERVICES] ========== SERVICES EXTRACTION END ==========');
  }

  return mergedServices;
};// ===== PART 4/6 =====
// FILE: src/spaces/promoteur/etudes/marche/MarchePage.tsx
// CHANGES: EHPAD helpers (mapRawEhpadToEnriched, extractEhpadItemsFromResponse, mapGeoJsonFeaturesToRawItems, buildEhpadDataFromRaw) - INCHANGÉS

// ============================================
// HELPER: Mapping données FINESS brutes vers format UI
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
  finess_number?: string;
  telephone?: string;
  phone?: string;
  prix_journalier?: number;
  taux_occupation?: number;
}

const mapRawEhpadToEnriched = (rawItems: RawEhpadItem[]): FacilityEnriched[] => {
  return rawItems.map(item => ({
    nom: item.name || item.nom || "Établissement sans nom",
    commune: item.commune || item.city || "",
    distance_km: item.distance_km || 0,
    capacite: item.beds_total ?? item.capacite ?? undefined,
    finess: item.finess || item.finess_number || undefined,
    adresse: item.address || item.adresse || undefined,
    telephone: item.telephone || item.phone || undefined,
    prix_journalier: item.prix_journalier ?? undefined,
    taux_occupation: item.taux_occupation ?? undefined,
  }));
};

// ============================================
// HELPER: Extraire le tableau d'établissements depuis la réponse FINESS
// Gère différents formats possibles:
// - Tableau direct
// - Objet avec items/liste/facilities/data/results
// - Objets imbriqués: data.items, data.results, results.items
// - GeoJSON FeatureCollection: { type: "FeatureCollection", features: [...] }
// ============================================
const extractEhpadItemsFromResponse = (finessResult: unknown): RawEhpadItem[] => {
  if (!finessResult) {
    console.log("[MarchePage] extractEhpadItems: finessResult is null/undefined");
    return [];
  }

  // Cas 1: finessResult est directement un tableau
  if (Array.isArray(finessResult)) {
    console.log("[MarchePage] extractEhpadItems: finessResult is array, length=", finessResult.length);
    
    // Vérifier si c'est un tableau de GeoJSON features
    if (finessResult.length > 0 && finessResult[0]?.type === "Feature" && finessResult[0]?.properties) {
      console.log("[MarchePage] extractEhpadItems: array contains GeoJSON features, mapping...");
      return mapGeoJsonFeaturesToRawItems(finessResult);
    }
    
    return finessResult as RawEhpadItem[];
  }

  // Cas 2: finessResult est un objet
  if (typeof finessResult === 'object') {
    const obj = finessResult as Record<string, unknown>;
    console.log("[MarchePage] extractEhpadItems: finessResult is object, keys=", Object.keys(obj));

    // Cas 2a: GeoJSON FeatureCollection { type: "FeatureCollection", features: [...] }
    if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
      console.log("[MarchePage] extractEhpadItems: GeoJSON FeatureCollection detected, features=", (obj.features as unknown[]).length);
      return mapGeoJsonFeaturesToRawItems(obj.features as GeoJsonFeature[]);
    }

    // Cas 2b: Propriétés de premier niveau
    const possibleArrayProps = ['items', 'liste', 'facilities', 'etablissements', 'data', 'results', 'ehpads', 'records'];
    
    for (const prop of possibleArrayProps) {
      const value = obj[prop];
      
      // Si c'est directement un tableau
      if (Array.isArray(value)) {
        console.log(`[MarchePage] extractEhpadItems: found array in '${prop}', length=`, value.length);
        
        // Vérifier si c'est un tableau de GeoJSON features
        if (value.length > 0 && value[0]?.type === "Feature" && value[0]?.properties) {
          return mapGeoJsonFeaturesToRawItems(value);
        }
        
        return value as RawEhpadItem[];
      }
      
      // Cas 2c: Objet imbriqué (data.items, data.results, results.items, etc.)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nestedObj = value as Record<string, unknown>;
        const nestedArrayProps = ['items', 'liste', 'facilities', 'etablissements', 'results', 'ehpads', 'records', 'features'];
        
        for (const nestedProp of nestedArrayProps) {
          if (Array.isArray(nestedObj[nestedProp])) {
            console.log(`[MarchePage] extractEhpadItems: found array in '${prop}.${nestedProp}', length=`, (nestedObj[nestedProp] as unknown[]).length);
            
            const nestedArray = nestedObj[nestedProp] as unknown[];
            
            // Vérifier si c'est un tableau de GeoJSON features
            if (nestedArray.length > 0 && (nestedArray[0] as any)?.type === "Feature" && (nestedArray[0] as any)?.properties) {
              return mapGeoJsonFeaturesToRawItems(nestedArray as GeoJsonFeature[]);
            }
            
            return nestedArray as RawEhpadItem[];
          }
        }
        
        // Cas 2d: GeoJSON FeatureCollection imbriqué
        if (nestedObj.type === "FeatureCollection" && Array.isArray(nestedObj.features)) {
          console.log(`[MarchePage] extractEhpadItems: found GeoJSON FeatureCollection in '${prop}', features=`, (nestedObj.features as unknown[]).length);
          return mapGeoJsonFeaturesToRawItems(nestedObj.features as GeoJsonFeature[]);
        }
      }
    }

    // Si l'objet a un count mais pas de tableau trouvé, log pour debug
    if ('count' in obj && typeof obj.count === 'number') {
      console.warn("[MarchePage] extractEhpadItems: object has count=", obj.count, "but no items array found!");
    }
  }

  console.log("[MarchePage] extractEhpadItems: could not extract items, returning empty array");
  return [];
};

// ============================================
// HELPER: Interface et mapper pour GeoJSON Features
// ============================================
interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates?: number[];
  };
}

const mapGeoJsonFeaturesToRawItems = (features: GeoJsonFeature[]): RawEhpadItem[] => {
  return features.map((feature) => {
    const props = feature.properties || {};
    
    // Extraction du nom
    const name = String(
      props.name || 
      props.nom || 
      props.rs || 
      props.rslongue || 
      props.libelle || 
      props.label || 
      "Établissement"
    );
    
    // Extraction de l'adresse complète
    // Essayer d'abord l'adresse complète, puis construire à partir des composants
    let address = String(
      props.address || 
      props.adresse || 
      props.address_full || 
      props["addr:full"] || 
      props["addr:street"] ||
      props.ligneacheminement ||
      ""
    );
    
    // Si pas d'adresse complète, essayer de construire depuis les composants
    if (!address) {
      const numVoie = props.numvoie || props.numero_voie || "";
      const typeVoie = props.typvoie || props.type_voie || "";
      const voie = props.voie || props.libelle_voie || "";
      const cp = props.codepostal || props.code_postal || props.cp || props["addr:postcode"] || "";
      const commune = props.libcommune || props.commune || props.city || props["addr:city"] || "";
      
      const streetParts = [numVoie, typeVoie, voie].filter(Boolean).join(" ").trim();
      const cpCommune = [cp, commune].filter(Boolean).join(" ").trim();
      address = [streetParts, cpCommune].filter(Boolean).join(", ");
    }
    
    // Extraction de la capacité (lits)
    const beds_total = extractNumericValue(
      props.beds_total ?? 
      props.capacity ?? 
      props.capacite ?? 
      props.capaciteautorisee ??
      props.capacite_autorisee ??
      props.nb_lits ??
      props.lits
    );
    
    // Extraction de la distance
    const distance_km = extractNumericValue(
      props.distance_km ?? 
      props.distance ?? 
      props.dist
    );
    
    // Extraction commune/city
    const commune = String(
      props.commune || 
      props.libcommune || 
      props.city || 
      props["addr:city"] || 
      ""
    );
    
    // Extraction FINESS
    const finess = String(
      props.finess || 
      props.nofinesset || 
      props.finess_number || 
      props["ref:FR:FINESS"] || 
      ""
    );
    
    // Extraction téléphone
    const telephone = String(
      props.telephone || 
      props.phone || 
      props.tel || 
      props["contact:phone"] || 
      ""
    );
    
    // Extraction prix journalier
    const prix_journalier = extractNumericValue(
      props.prix_journalier ?? 
      props.tarif ?? 
      props.prix ?? 
      props.tarif_hebergement
    );
    
    // Extraction taux d'occupation
    const taux_occupation = extractNumericValue(
      props.taux_occupation ?? 
      props.occupation ?? 
      props.tauxoccupation
    );

    return {
      name,
      address: address || undefined,
      commune,
      beds_total: beds_total ?? undefined,
      distance_km: distance_km ?? undefined,
      finess: finess || undefined,
      telephone: telephone || undefined,
      prix_journalier: prix_journalier ?? undefined,
      taux_occupation: taux_occupation ?? undefined,
    };
  });
};

// Helper pour extraire une valeur numérique
const extractNumericValue = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const buildEhpadDataFromRaw = (
  rawItems: RawEhpadItem[],
  inseeData?: InseeData | null
): EHPADData => {
  const mappedFacilities = mapRawEhpadToEnriched(rawItems);
  const totalCapacity = mappedFacilities.reduce((sum, f) => sum + (f.capacite || 0), 0);
  
  // Calcul densité lits / 1000 seniors (75+)
  let densiteLits: number | undefined;
  if (inseeData?.population && inseeData?.pct_plus_75) {
    const pop75Plus = inseeData.population * (inseeData.pct_plus_75 / 100);
    if (pop75Plus > 0 && totalCapacity > 0) {
      densiteLits = (totalCapacity / pop75Plus) * 1000;
    }
  }

  // Génération du verdict
  let verdict: string | undefined;
  const count = mappedFacilities.length;
  if (count === 0) {
    verdict = "Aucun établissement concurrent identifié dans la zone. Opportunité potentielle de marché.";
  } else if (count <= 2) {
    verdict = `Faible concurrence avec ${count} établissement(s). Zone potentiellement sous-équipée.`;
  } else if (count <= 5) {
    verdict = `Concurrence modérée avec ${count} établissements. Analyse approfondie recommandée.`;
  } else {
    verdict = `Marché concurrentiel avec ${count} établissements. Positionnement différenciant nécessaire.`;
  }

  if (densiteLits != null) {
    if (densiteLits < 80) {
      verdict += ` Densité de ${densiteLits.toFixed(0)} lits/1000 seniors, inférieure à la moyenne nationale (~100).`;
    } else if (densiteLits > 120) {
      verdict += ` Densité élevée de ${densiteLits.toFixed(0)} lits/1000 seniors.`;
    }
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
};// ===== PART 5/6 =====
// FILE: src/spaces/promoteur/etudes/marche/MarchePage.tsx
// CHANGES: Styles + Tous les composants UI (ScoreGauge, DataSourcesBadges, InsightCard, ServiceRow, MapWithMarkers, 
// PrixImmobilierCard, DemographieCard, ServicesCard, CompetitionCard, MarketStudyResults) - INCHANGÉS sauf notes FIX

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
};

// ============================================
// COMPOSANTS UI
// ============================================

// Score Gauge
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
          <verdict.icon size={14} />
          {verdict.label}
        </div>
      )}
    </div>
  );
};

// Data Sources Badges
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

// Insight Card
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

// Service Row
const ServiceRow: React.FC<{
  icon: LucideIcon;
  label: string;
  data?: ServiceProche | null;
  showIfNull?: boolean;
}> = ({ icon: Icon, label, data, showIfNull = true }) => {
  if (!data && !showIfNull) return null;
  
  const distance = data ? (data.distance_km ?? (data.distance_m ? data.distance_m / 1000 : null)) : null;
  const distanceColor = getDistanceColor(distance);
  
  return (
    <div style={{ 
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 0", borderBottom: "1px solid #f1f5f9"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{
          width: "36px", height: "36px", borderRadius: "8px",
          background: data ? "#eef2ff" : "#f8fafc",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={16} color={data ? "#6366f1" : "#cbd5e1"} />
        </div>
        <div>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "#334155" }}>{label}</span>
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
  );
};

// Carte avec iframe OpenStreetMap
const MapWithMarkers: React.FC<{ 
  center?: { lat: number; lon: number }; 
  radius?: number;
  zoneName?: string;
  zoneType?: string;
  services?: Record<string, ServiceProche>;
}> = ({ center, radius = 500, zoneName, zoneType, services = {} }) => {
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

  const zoom = radius <= 300 ? 17 : radius <= 500 ? 16 : radius <= 1000 ? 15 : radius <= 2000 ? 14 : 13;
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

// Prix Immobilier Card
const PrixImmobilierCard: React.FC<{ prices?: any; transactions?: any; comps?: any[] }> = ({ prices, transactions, comps = [] }) => {
  if (!prices || prices.median_eur_m2 == null) {
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
          {formatPrice(prices.median_eur_m2)}
        </div>
        {prices.evolution_1an != null && (
          <div style={{ 
            display: "inline-flex", alignItems: "center", gap: "6px",
            marginTop: "12px", padding: "6px 12px", borderRadius: "8px",
            background: prices.evolution_1an >= 0 ? "#d1fae5" : "#fee2e2",
            color: prices.evolution_1an >= 0 ? "#065f46" : "#991b1b",
            fontSize: "13px", fontWeight: 600
          }}>
            {prices.evolution_1an >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {formatPercent(prices.evolution_1an, true)} sur 1 an
          </div>
        )}
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "20px" }}>
        {[
          { label: "Min", value: prices.min_eur_m2, color: "#3b82f6" },
          { label: "Q1 (25%)", value: prices.q1_eur_m2, color: "#8b5cf6" },
          { label: "Q3 (75%)", value: prices.q3_eur_m2, color: "#ec4899" },
          { label: "Max", value: prices.max_eur_m2, color: "#ef4444" },
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
          {transactions?.count ?? "—"}
        </div>
      </div>
    </div>
  );
};

// Démographie Card
// FIX: Ajout du calcul de densité fallback si densite est null mais population et surface_km2 existent
const DemographieCard: React.FC<{ insee?: InseeData; projectNature: ProjectType }> = ({ insee, projectNature }) => {
  const config = getProjectConfig(projectNature);
  
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

  // FIX: Calcul de la densité - utiliser densite si dispo, sinon calculer depuis population/surface_km2
  let displayDensite: number | null = null;
  if (insee.densite != null && insee.densite > 0) {
    displayDensite = insee.densite;
  } else if (insee.population != null && (insee as any).surface_km2 != null && (insee as any).surface_km2 > 0) {
    // FIX: Fallback - calculer densité depuis population / surface
    displayDensite = insee.population / (insee as any).surface_km2;
    if (DEBUG_INSEE) console.log('[FIX] Densité calculée depuis population/surface_km2:', displayDensite);
  } else if (insee.population != null && !((insee as any).surface_km2)) {
    // FIX: Debug si surface_km2 manquante
    if (DEBUG_INSEE) console.log('[FIX] surface_km2 missing, cannot compute density');
  }

  const getAgeData = () => {
    return config.demographicSegments.map(segment => {
      let value: number | null = null;
      
      if (segment.inseeField === "pct_0_14") value = insee.pct_moins_15 ?? null;
      else if (segment.inseeField === "pct_15_29") value = insee.pct_15_29 ?? null;
      else if (segment.inseeField === "pct_30_44") value = insee.pct_30_44 ?? null;
      else if (segment.inseeField === "pct_45_59") value = insee.pct_45_59 ?? null;
      else if (segment.inseeField === "pct_60_74" || segment.inseeField === "pct_60_plus") {
        value = insee.pct_plus_60 && insee.pct_plus_75 ? insee.pct_plus_60 - insee.pct_plus_75 : insee.pct_plus_60 ?? null;
      }
      else if (segment.inseeField === "pct_75_84") {
        value = insee.pct_plus_75 && insee.pct_plus_85 ? insee.pct_plus_75 - insee.pct_plus_85 : insee.pct_plus_75 ?? null;
      }
      else if (segment.inseeField === "pct_85_plus") value = insee.pct_plus_85 ?? null;
      else if (segment.inseeField === "pct_15_19") value = insee.pct_15_29 ? insee.pct_15_29 * 0.4 : null;
      else if (segment.inseeField === "pct_20_24") {
        value = insee.pct_moins_25 ? insee.pct_moins_25 - (insee.pct_moins_15 || 0) : null;
      }
      else if (segment.inseeField === "pct_25_29") value = insee.pct_25_39 ? insee.pct_25_39 * 0.5 : null;
      
      return { label: segment.label, value, color: segment.color, isPrimary: segment.isPrimary };
    }).filter(d => d.value != null);
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
          {insee.commune || insee.code_commune}
        </span>
      </div>
      
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px"
      }}>
        <div style={{
          background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
          borderRadius: "14px", padding: "20px"
        }}>
          <div style={{ fontSize: "12px", color: "#6366f1", fontWeight: 600, marginBottom: "6px" }}>POPULATION</div>
          <div style={{ fontSize: "36px", fontWeight: 800, color: "#4338ca" }}>
            {formatNumber(insee.population)}
          </div>
          {insee.evolution_pop_5ans != null && (
            <div style={{ 
              display: "flex", alignItems: "center", gap: "4px",
              fontSize: "13px", marginTop: "8px",
              color: insee.evolution_pop_5ans >= 0 ? "#059669" : "#dc2626"
            }}>
              {insee.evolution_pop_5ans >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {formatPercent(insee.evolution_pop_5ans, true)} sur 5 ans
            </div>
          )}
        </div>
        <div style={{
          background: "linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)",
          borderRadius: "14px", padding: "20px"
        }}>
          <div style={{ fontSize: "12px", color: "#a21caf", fontWeight: 600, marginBottom: "6px" }}>DENSITÉ</div>
          {/* FIX: Utiliser displayDensite calculé au lieu de insee.densite directement */}
          <div style={{ fontSize: "36px", fontWeight: 800, color: "#86198f" }}>
            {displayDensite != null ? formatNumber(Math.round(displayDensite)) : "—"}
          </div>
          <div style={{ fontSize: "13px", color: "#a855f7", marginTop: "8px" }}>hab./km²</div>
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
};

// Services Card
// FIX: Ajout de la prop actualRadiusKm pour afficher le rayon réel utilisé
// DIAG: Interface pour les stats de debug des services
interface ServicesDebugStats {
  supermarche: number;
  station: number;
  banque: number;
  poste: number;
  medecin: number;
  pharmacie: number;
  securite: number;
}

// DIAG: Calcule les stats de debug pour ServicesCard
const computeServicesDebugStats = (services: Record<string, ServiceProche | null | undefined>): ServicesDebugStats => {
  const hasValue = (key: string) => services[key] && services[key]!.distance_km !== undefined ? 1 : 0;
  return {
    supermarche: hasValue('supermarche_proche') + hasValue('superette_proche') + hasValue('hypermarche_proche'),
    station: hasValue('station_service_proche'),
    banque: hasValue('banque_proche'),
    poste: hasValue('poste_proche'),
    medecin: hasValue('medecin_proche'),
    pharmacie: hasValue('pharmacie_proche'),
    securite: hasValue('gendarmerie_proche') + hasValue('commissariat_proche'),
  };
};

const ServicesCard: React.FC<{ 
  services?: Record<string, ServiceProche>; 
  bpe?: any;
  projectNature: ProjectType;
  actualRadiusKm?: number; // FIX: Prop pour le rayon réel utilisé
}> = ({ services = {}, bpe, projectNature, actualRadiusKm }) => {
  const config = getProjectConfig(projectNature);
  
  // FIX: Utiliser le rayon réel si fourni, sinon fallback sur config
  const displayRadius = actualRadiusKm ?? config.radius.analysis;
  
  // DIAG: Calcul des stats de debug
  const debugStats = DEBUG_SERVICES ? computeServicesDebugStats(services) : null;
  
  const bpeItems = bpe ? [
    { label: "Commerces", value: bpe.nb_commerces, color: "#10b981" },
    { label: "Santé", value: bpe.nb_sante, color: "#ec4899" },
    { label: "Services", value: bpe.nb_services, color: "#3b82f6" },
    { label: "Éducation", value: bpe.nb_enseignement, color: "#f59e0b" },
    { label: "Sport/Culture", value: bpe.nb_sport_culture, color: "#8b5cf6" },
  ].filter(item => item.value != null && item.value > 0) : [];

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <ShoppingCart size={20} color="#f59e0b" />
        Services & Équipements
        {/* FIX: Afficher le rayon réel utilisé */}
        <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e", marginLeft: "auto" }}>
          Rayon {displayRadius} km
        </span>
      </div>
      
      {/* DIAG: Badge de debug temporaire */}
      {DEBUG_SERVICES && debugStats && (
        <div style={{
          padding: "8px 12px",
          background: "#fef3c7",
          borderRadius: "8px",
          marginBottom: "16px",
          fontSize: "11px",
          fontFamily: "monospace",
          color: "#92400e",
        }}>
          🔍 DEBUG: super={debugStats.supermarche} fuel={debugStats.station} bank={debugStats.banque} post={debugStats.poste} med={debugStats.medecin} pharm={debugStats.pharmacie} secu={debugStats.securite}
        </div>
      )}
      
      {bpeItems.length > 0 && (
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: `repeat(${Math.min(bpeItems.length, 5)}, 1fr)`, 
          gap: "8px", 
          marginBottom: "20px" 
        }}>
          {bpeItems.map((item, i) => (
            <div key={i} style={{ textAlign: "center", padding: "12px 8px", background: "#f8fafc", borderRadius: "10px" }}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: item.color }}>{item.value}</div>
              <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 500 }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "8px", textTransform: "uppercase" }}>
            Commerces
          </div>
          <ServiceRow icon={ShoppingCart} label="Supermarché" data={services.supermarche_proche || services.superette_proche} showIfNull />
          <ServiceRow icon={Fuel} label="Station service" data={services.station_service_proche} showIfNull />
          <ServiceRow icon={Banknote} label="Banque / DAB" data={services.banque_proche} showIfNull />
          <ServiceRow icon={Mail} label="Bureau de poste" data={services.poste_proche} showIfNull />
        </div>
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "8px", textTransform: "uppercase" }}>
            Santé & Sécurité
          </div>
          <ServiceRow icon={Stethoscope} label="Médecin" data={services.medecin_proche as ServiceProche | undefined} showIfNull />
          <ServiceRow icon={Pill} label="Pharmacie" data={services.pharmacie_proche} showIfNull />
          <ServiceRow icon={Shield} label="Gendarmerie" data={services.gendarmerie_proche} showIfNull />
          <ServiceRow icon={Shield} label="Commissariat" data={services.commissariat_proche} showIfNull />
        </div>
      </div>
    </div>
  );
};

// Interface étendue pour les établissements avec champs enrichis
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

// Concurrence Card
const CompetitionCard: React.FC<{ 
  data?: EHPADData | null; 
  insee?: InseeData;
  projectNature: ProjectType;
  isLoadingFiness?: boolean;
}> = ({ data, insee, projectNature, isLoadingFiness = false }) => {
  const [expanded, setExpanded] = useState(true);
  const config = getProjectConfig(projectNature);
  const labels = config.competitionLabel;

  // Si en cours de chargement FINESS
  if (isLoadingFiness) {
    return (
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          <Building size={20} color={config.color} />
          Concurrence
          <span style={{ ...styles.badge, background: "#dbeafe", color: "#1e40af", marginLeft: "auto" }}>
            <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
            Chargement FINESS...
          </span>
        </div>
        <div style={{ padding: "40px", textAlign: "center" }}>
          <Loader2 size={40} color={config.color} style={{ animation: "spin 1s linear infinite", marginBottom: "16px" }} />
          <p style={{ color: "#64748b", fontSize: "14px" }}>
            Recherche d'établissements via OSM + FINESS...
          </p>
        </div>
      </div>
    );
  }

  const facilities: FacilityEnriched[] = data?.liste || [];
  const totalCount = data?.count || 0;
  const totalCapacity = data?.analyse_concurrence?.capacite_totale || 0;
  const analysis = data?.analyse_concurrence;

  // Déterminer si la capacité est disponible
  const capacityAvailable = totalCapacity > 0;

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
      
      {/* Métriques clés */}
      <div style={{ display: "grid", gridTemplateColumns: capacityAvailable ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "14px", background: `${config.color}10`, borderRadius: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: 800, color: config.color }}>
            {totalCount}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{labels.plural}</div>
        </div>
        
        {capacityAvailable && (
          <div style={{ padding: "14px", background: "#f8fafc", borderRadius: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "#1e293b" }}>
              {formatNumber(totalCapacity)}
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{labels.unit} totaux</div>
          </div>
        )}
        
        {!capacityAvailable && totalCount > 0 && (
          <div style={{ padding: "14px", background: "#f1f5f9", borderRadius: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#94a3b8" }}>
              —
            </div>
            <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 500 }}>Capacité non publiée</div>
          </div>
        )}
        
        {capacityAvailable && analysis?.densite_lits_1000_seniors != null && (
          <div style={{ padding: "14px", background: "#fff7ed", borderRadius: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "#ea580c" }}>
              {formatNumber(analysis.densite_lits_1000_seniors, 1)}
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{labels.unit}/1000 seniors</div>
          </div>
        )}
      </div>
      
      {/* Verdict */}
      {analysis?.verdict && (
        <div style={{
          padding: "14px 18px", background: "#f8fafc", borderRadius: "10px",
          marginBottom: "16px", borderLeft: `4px solid ${config.color}`
        }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>
            📊 Analyse du marché
          </div>
          <p style={{ fontSize: "13px", color: "#475569", margin: 0, lineHeight: 1.5 }}>{analysis.verdict}</p>
          {!capacityAvailable && totalCount > 0 && (
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: "8px 0 0 0", fontStyle: "italic" }}>
              Capacité non publiée.
            </p>
          )}
        </div>
      )}
      
      {/* Liste établissements */}
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
                  {/* Colonne gauche: Nom, Adresse, Distance, Téléphone, FINESS */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>
                      {facility.nom}
                    </div>
                    
                    {/* Adresse complète */}
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
                    
                    {/* Ligne infos: Distance + Téléphone */}
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
                      
                      {/* Téléphone */}
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
                      
                      {/* FINESS */}
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
                  
                  {/* Colonne droite: Métriques (Capacité, Prix, Occupation) */}
                  <div style={{ 
                    display: "flex", 
                    gap: "12px", 
                    alignItems: "flex-start",
                    marginLeft: "16px",
                    flexShrink: 0
                  }}>
                    {/* Capacité */}
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
                    
                    {/* Prix journalier */}
                    <div style={{ textAlign: "center", minWidth: "55px" }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: facility.prix_journalier ? "#10b981" : "#cbd5e1" }}>
                        {facility.prix_journalier ? `${formatNumber(facility.prix_journalier)}€` : "—"}
                      </div>
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>€/jour</div>
                    </div>
                    
                    {/* Taux d'occupation */}
                    <div style={{ textAlign: "center", minWidth: "50px" }}>
                      <div style={{ 
                        fontSize: "14px", 
                        fontWeight: 600, 
                        color: facility.taux_occupation 
                          ? (facility.taux_occupation >= 95 ? "#ef4444" : facility.taux_occupation >= 85 ? "#f59e0b" : "#10b981")
                          : "#cbd5e1"
                      }}>
                        {facility.taux_occupation ? `${formatNumber(facility.taux_occupation, 0)}%` : "—"}
                      </div>
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>Occup.</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Population cible pour seniors */}
      {(projectNature === "ehpad" || projectNature === "residence_senior") && insee && (
        <div style={{ marginTop: "20px", padding: "16px", background: `${config.color}10`, borderRadius: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: config.color, marginBottom: "12px" }}>
            👴 Population cible
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: config.color }}>
                {formatPercent(insee.pct_plus_65)}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>65+ ans</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: config.color }}>
                {formatPercent(insee.pct_plus_75)}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>75+ ans</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: config.color }}>
                {insee.evolution_75_plus_5ans != null ? formatPercent(insee.evolution_75_plus_5ans, true) : "—"}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Évol. 75+ /5ans</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};// ===== PART 6/6 =====
// FILE: src/spaces/promoteur/etudes/marche/MarchePage.tsx
// CHANGES: MarketStudyResults + MarchePage (composant principal)
// FIX: Utilisation de getAllServicesFromMarket + safeNormalizeInseeData
// FIX: Payload géographique avec lat/lon/lng

// ============================================
// COMPOSANT RÉSULTATS
// ============================================
const MarketStudyResults: React.FC<{ 
  data: MarketStudyResult; 
  projectNature: ProjectType;
  finessData?: EHPADData | null;
  isLoadingFiness?: boolean;
}> = ({ data, projectNature, finessData, isLoadingFiness = false }) => {
  const market = data.market;
  const config = getProjectConfig(projectNature);
  
  if (!market) {
    return (
      <div style={{ padding: "60px", textAlign: "center" }}>
        <AlertTriangle size={56} color="#f59e0b" style={{ marginBottom: "20px" }} />
        <h3 style={{ fontSize: "18px", color: "#1e293b", marginBottom: "8px" }}>Données non disponibles</h3>
        <p style={{ color: "#64748b" }}>Aucune donnée de marché n'a pu être récupérée pour cette localisation.</p>
      </div>
    );
  }

  // Utiliser les données FINESS si disponibles, sinon fallback sur market.ehpad
  const ehpadData =
  finessData && Array.isArray(finessData.liste) && finessData.liste.length > 0
    ? finessData
    : market.ehpad;

  const insights = market.insights || [];
  
  // Générer des insights supplémentaires basés sur les données FINESS
  const allInsights = [...insights];
  if (finessData && (projectNature === "ehpad" || projectNature === "residence_senior")) {
    if (finessData.count === 0) {
      allInsights.push({
        type: "opportunity",
        title: "Aucune concurrence directe",
        description: "Aucun EHPAD/EHPA identifié dans le rayon d'analyse. Zone potentiellement sous-équipée.",
      });
    } else if (finessData.count && finessData.count <= 3) {
      allInsights.push({
        type: "positive",
        title: "Concurrence limitée",
        description: `Seulement ${finessData.count} établissement(s) identifié(s) dans la zone.`,
      });
    } else if (finessData.count && finessData.count > 5) {
      allInsights.push({
        type: "warning",
        title: "Marché concurrentiel",
        description: `${finessData.count} établissements identifiés. Positionnement différenciant recommandé.`,
      });
    }

    if (finessData.analyse_concurrence?.densite_lits_1000_seniors != null) {
      const densite = finessData.analyse_concurrence.densite_lits_1000_seniors;
      if (densite < 80) {
        allInsights.push({
          type: "opportunity",
          title: "Zone sous-équipée",
          description: `${densite.toFixed(0)} lits pour 1000 seniors (moyenne nationale ~100). Besoin potentiel.`,
        });
      }
    }
  }

  const positiveInsights = allInsights.filter(i => i.type === "positive" || i.type === "opportunity");
  const warningInsights = allInsights.filter(i => i.type === "warning" || i.type === "negative");
  
  const isEHPAD = projectNature === "ehpad";
  const isRSS = projectNature === "residence_senior";
  const showCompetition = isEHPAD || isRSS;

  const hasFinessData = !!finessData || !!market.ehpad;

  // FIX: Utiliser getAllServicesFromMarket pour récupérer les services depuis toutes les sources possibles
  const normalizedServices = getAllServicesFromMarket(market as unknown as Record<string, unknown>);
  
  // FIX: Extraire le rayon réel utilisé depuis input si disponible
  const actualRadiusKm = data.input?.radius_km;

  return (
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
              <config.icon size={24} />
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
              {market.verdict || `Étude complète du potentiel de la zone pour votre projet ${config.label.toLowerCase()}.`}
            </p>
            
            {/* Sources de données */}
            <div style={{ marginBottom: "16px" }}>
              <DataSourcesBadges 
                sources={config.requiredDataSources} 
                available={{ 
                  insee: !!market.insee, 
                  dvf: !!market.prices?.median_eur_m2,
                  bpe: !!market.bpe,
                  finess: hasFinessData || isLoadingFiness,
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
              zoneType={data.zone_type}
              services={normalizedServices}
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
        </div>
      </div>
      
      {/* Section Concurrence */}
      {showCompetition && (
        <div style={{ marginBottom: "24px" }}>
          <CompetitionCard 
            data={ehpadData}
            insee={market.insee}
            projectNature={projectNature}
            isLoadingFiness={isLoadingFiness}
          />
        </div>
      )}
      
      {/* Grille principale */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
        <PrixImmobilierCard prices={market.prices} transactions={market.transactions} comps={market.comps} />
        <DemographieCard insee={market.insee} projectNature={projectNature} />
      </div>
      
      {/* FIX: Services avec normalisation des clés API + rayon réel */}
      <ServicesCard 
        services={normalizedServices} 
        bpe={market.bpe} 
        projectNature={projectNature}
        actualRadiusKm={actualRadiusKm}  
      />
      
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
  );
};

// ============================================
// COMPOSANT PRINCIPAL
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

  // Config du projet sélectionné
  const projectConfig = useMemo(() => getProjectConfig(projectNature), [projectNature]);

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

  // Soumission
  const handleSubmit = useCallback(async () => {
    const hasLocation = (latitude && longitude) || codeInsee || parcelInfo;
    if (!hasLocation) {
      setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE).");
      return;
    }

    setIsLoading(true);
    setIsLoadingFiness(true);
    console.log("[DEBUG] FINESS coords input lat/lon=", latitude, longitude);
    setError(null);
    setAnalysisResult(null);
    setFinessData(null);

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const radiusKm = radius / 1000;

    try {
      const payload: Record<string, any> = {
        mode: "market_study",
        radius_km: radiusKm,
        horizon_months: 24,
        project_nature: projectNature,
        debug: true,
      };

      // FIX: Envoyer lat, lon ET lng pour compatibilité avec différentes APIs
      if (latitude && longitude) {
        payload.lat = lat;
        payload.lon = lon;
        payload.lng = lon; // FIX: Certaines APIs attendent lng au lieu de lon
      }
      if (codeInsee) payload.commune_insee = codeInsee;
      if (parcelId && parcelInfo) payload.parcel_id = parcelInfo.id;

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error("Configuration Supabase manquante");
      }
      // 1) Appel API principal (smartscore)
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

      if (!apiResponse.ok || !result.success) {
        throw new Error(result.error || `Erreur ${apiResponse.status}`);
      }

      // FIX: Normalisation INSEE avec fallback sécurisé
      if (result?.market?.insee) {
        const rawInsee = result.market.insee;
        const normalizedInsee = safeNormalizeInseeData(rawInsee);
        
        // FIX: Ne jamais écraser par null/undefined - garder les données brutes si normalisation échoue
        if (normalizedInsee && Object.keys(normalizedInsee).length > 0) {
          result.market.insee = normalizedInsee;
        } else {
          if (DEBUG_INSEE) console.warn('[INSEE] Keeping raw insee data (normalization returned empty)');
          // Garder rawInsee tel quel
        }
      }

      // DIAG: Inspection complète de services_ruraux juste après réception
      if (DEBUG_SERVICES) {
        console.log("[DIAG] ========== MARKET RESPONSE INSPECTION ==========");
        console.log("[DIAG] market keys:", Object.keys(result?.market || {}));
        
        // FIX: Chercher les services dans toutes les sources possibles
        const serviceSources = ['services_ruraux', 'services', 'amenities', 'services_proches', 'nearby', 'proximite'];
        for (const src of serviceSources) {
          const srcData = result?.market?.[src];
          if (srcData) {
            console.log(`[DIAG] Found "${src}":`, {
              type: Array.isArray(srcData) ? 'array' : typeof srcData,
              keys: typeof srcData === 'object' && !Array.isArray(srcData) ? Object.keys(srcData) : undefined,
            });
          }
        }
        
        const sr = result?.market?.services_ruraux;
        console.log("[DIAG] services_ruraux shape:", inspectServicesShape(sr));
        console.log("[DIAG] ================================================");
      }

      setAnalysisResult(result);

      // 2) FINESS/OSM: utiliser lat/lon saisis si dispo, sinon resolved_point renvoyé par l'API
      let finessLat: number | null = null;
      let finessLon: number | null = null;

      if (latitude && longitude) {
        const pLat = parseFloat(latitude);
        const pLon = parseFloat(longitude);
        if (!Number.isNaN(pLat) && !Number.isNaN(pLon)) {
          finessLat = pLat;
          finessLon = pLon;
        }
      }

      if ((finessLat == null || finessLon == null) && result?.input?.resolved_point?.lat != null && result?.input?.resolved_point?.lon != null) {
        finessLat = Number(result.input.resolved_point.lat);
        finessLon = Number(result.input.resolved_point.lon);
      }
      
      // FIX: Aussi chercher lng si lon n'est pas disponible
      if ((finessLat == null || finessLon == null) && result?.input?.resolved_point?.lat != null && result?.input?.resolved_point?.lng != null) {
        finessLat = Number(result.input.resolved_point.lat);
        finessLon = Number(result.input.resolved_point.lng);
      }

      if ((projectNature === "ehpad" || projectNature === "residence_senior") && finessLat != null && finessLon != null) {
        try {
          if (DEBUG_SERVICES) console.log("[MarchePage] FINESS/OSM lookup coords:", finessLat, finessLon, "radiusKm=", radiusKm);
          const finessResult = await fetchAllEHPAD(finessLat, finessLon, radiusKm);
          if (DEBUG_SERVICES) {
            console.log("🧪 DEBUG FINESS RAW RESULT", {
              isArray: Array.isArray(finessResult),
              length: Array.isArray(finessResult) ? finessResult.length : null,
              sample: Array.isArray(finessResult) ? finessResult.slice(0, 3) : finessResult,
            });
          }
          const inseeData = result?.market?.insee;
          
          // ============================================
          // WIRING: Extraction et mapping des données EHPAD
          // Utilise extractEhpadItemsFromResponse pour gérer différents formats de réponse
          // (tableau direct, objet avec items/liste/facilities/data, GeoJSON FeatureCollection, objets imbriqués)
          // Puis buildEhpadDataFromRaw pour mapper name->nom, address->adresse, beds_total->capacite
          // ============================================
          
          // Extraire le tableau d'établissements depuis la réponse (gère différents formats)
          const rawItems = extractEhpadItemsFromResponse(finessResult);
          if (DEBUG_SERVICES) {
            console.log("🧪 DEBUG RAW ITEMS", {
              length: rawItems.length,
              sample: rawItems.slice(0, 3),
            });
            console.log("[MarchePage] Extracted raw EHPAD items:", rawItems.length, rawItems.slice(0, 2));
          }
          
          let ehpadData: EHPADData;
          
          if (rawItems.length > 0) {
            // Utiliser notre fonction de mapping locale qui gère les champs name->nom, address->adresse, beds_total->capacite
            ehpadData = buildEhpadDataFromRaw(rawItems, inseeData);
            if (DEBUG_SERVICES) console.log("[MarchePage] FINESS Data (mapped):", ehpadData);
          } else {
            // Fallback: essayer convertToEhpadData du service (pour compatibilité)
            // Passer un tableau vide si pas d'items
            ehpadData = convertToEhpadData([], inseeData);
            
            // Si finessResult est un objet avec un count mais pas d'items, utiliser ce count
            if (finessResult && typeof finessResult === 'object' && !Array.isArray(finessResult)) {
              const obj = finessResult as Record<string, unknown>;
              if (typeof obj.count === 'number' && obj.count > 0) {
                console.warn("[MarchePage] FINESS returned count=", obj.count, "but no items array found. Data may be incomplete.");
                ehpadData.count = obj.count;
                // Générer un verdict approprié
                ehpadData.analyse_concurrence = {
                  ...ehpadData.analyse_concurrence,
                  verdict: `${obj.count} établissement(s) identifié(s) dans la zone, mais les détails ne sont pas disponibles.`,
                };
              }
            }
            
            console.log("[MarchePage] FINESS Data (fallback):", ehpadData);
          }
          
          setFinessData(ehpadData);
        } catch (err) {
          console.warn("[MarchePage] Erreur FINESS/OSM (non bloquante):", err);
        }
      } else {
        console.warn("[MarchePage] FINESS/OSM non appelé: coordonnées indisponibles");
      }

      setIsLoadingFiness(false);

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Une erreur est survenue";
      console.error("[MarchePage] Erreur:", err);
      setError(errorMessage);
      setIsLoadingFiness(false);
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, codeInsee, parcelInfo, parcelId, radius, projectNature]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={{
        ...styles.header,
        background: `linear-gradient(135deg, #1e293b 0%, ${projectConfig.color}80 50%, #1e293b 100%)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <projectConfig.icon size={28} />
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
          {/* DIAG: Badge debug mode */}
          {(DEBUG_SERVICES || DEBUG_INSEE) && (
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
          {projectConfig.description}. Analyse complète : données INSEE, prix immobiliers DVF, services de proximité, 
          concurrence via OSM + FINESS et potentiel de votre zone.
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

          {!isLoading && analysisResult && (
            <MarketStudyResults 
              data={analysisResult} 
              projectNature={projectNature}
              finessData={finessData}
              isLoadingFiness={isLoadingFiness}
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
                background: `linear-gradient(135deg, ${projectConfig.color}20 0%, ${projectConfig.color}40 100%)`,
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "24px"
              }}>
                <projectConfig.icon size={36} color={projectConfig.color} />
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
  );
}

export default MarchePage;

// ============================================
// CHANGELOG
// ============================================
// UI: liste concurrence enrichie (adresse/tel/prix/occupation)
// Copy: "0 lits" remplacé par message neutre si capacité absente
// WIRING: Ajout de mapRawEhpadToEnriched et buildEhpadDataFromRaw pour mapper name->nom, address->adresse, beds_total->capacite
// FIX: Ajout de extractEhpadItemsFromResponse pour extraire le tableau d'établissements depuis différents formats de réponse API
// FIX: extractEhpadItemsFromResponse gère maintenant GeoJSON FeatureCollection et objets imbriqués (data.items, results.items, etc.)
// FIX: Ajout de normalizeServicesRuraux pour gérer les variantes de nommage API (avec/sans _proche, fr/en, structures imbriquées)
// FIX: Ajout de pickServiceObject pour gérer les cas où l'API renvoie des arrays au lieu d'objets pour les services
// FIX: Ajout du calcul de densité fallback dans DemographieCard si densite est null mais population et surface_km2 existent
// FIX: Ajout de actualRadiusKm prop dans ServicesCard pour afficher le rayon réel utilisé
// DIAG: Ajout de DEBUG_SERVICES flag pour activer/désactiver les logs de debug
// DIAG: Ajout de DEBUG_INSEE flag pour activer/désactiver les logs INSEE
// DIAG: Ajout de inspectServicesShape() pour analyser la structure complète de services_ruraux
// DIAG: Ajout de guessServiceKeys() pour détection "best effort" des clés de services via patterns
// DIAG: Ajout de SERVICE_GUESS_PATTERNS pour patterns de recherche automatique (super, fuel, bank, post, etc.)
// DIAG: KEY_MAPPINGS étendu avec plus de variantes (amenity_*, shop_*, healthcare_*, etc.)
// DIAG: Recherche case-insensitive dans normalizeServicesRuraux
// DIAG: Vérification que l'objet service a des champs pertinents avant mapping
// DIAG: Badge DEBUG dans le header quand DEBUG_SERVICES ou DEBUG_INSEE est activé
// DIAG: Badge debug dans ServicesCard montrant le compte par catégorie (super, fuel, bank, etc.)
// DIAG: computeServicesDebugStats() pour calculer les stats de debug
// DIAG: Inspection complète de services_ruraux dans handleSubmit après réception API
// FIX: Ajout de safeNormalizeInseeData() avec fallback robuste - ne perd jamais les données brutes
// FIX: Ajout de getAllServicesFromMarket() qui cherche dans TOUTES les sources possibles (services_ruraux, services, amenities, etc.)
// FIX: Payload géographique envoie maintenant lat + lon + lng pour compatibilité
// FIX: Recherche de resolved_point.lng en plus de resolved_point.lon
// FIX: KEY_MAPPINGS avec patterns supplémentaires (magasin_alimentation, distributeur_billets, cabinet_medecin, etc.)
// FIX: NESTED_KEYS étendu avec poi, pois, equipements
// FIX: Recherche avec underscores/tirets interchangeables