
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../lib/supabaseClient";
import PluUploaderPanel from "../components/PluUploaderPanel";
import { patchPromoteurSnapshot, patchModule } from "../shared/promoteurSnapshot.store";


// ============================================
// Configuration
// ============================================

const LS_COMMUNE_INSEE = "mimmoza.plu.last_commune_insee";

// For Implantation 2D handoff
const LS_SELECTED_PLU_DOCUMENT_ID = "mimmoza.plu.selected_document_id";
const LS_SELECTED_PLU_COMMUNE_INSEE = "mimmoza.plu.selected_commune_insee";
const LS_SELECTED_PLU_ZONE_CODE = "mimmoza.plu.selected_zone_code";

// Zone détectée depuis parcelle (persistée pour survivre à F5)
const LS_DETECTED_ZONE_CODE = "mimmoza.plu.detected_zone_code";

// Resolved ruleset (source de vérité pour Implantation 2D)
const LS_PLU_RESOLVED_RULESET_V1 = "mimmoza.plu.resolved_ruleset_v1";

// AI extraction result (persisté pour survivre à F5)
const LS_PLU_AI_EXTRACT_RESULT = "mimmoza.plu.ai_extract_result";

// User overrides (corrections manuelles)
const LS_PLU_USER_OVERRIDES_V1 = "mimmoza.plu.user_overrides_v1";

// Session parcelle partagée (source de vérité cross-pages)
const LS_SESSION_PARCEL_ID = "mimmoza.session.parcel_id";
const LS_SESSION_COMMUNE_INSEE = "mimmoza.session.commune_insee";
const LS_SESSION_ADDRESS = "mimmoza.session.address";

// Handoff depuis Foncier (nouvelle clé potentiellement écrite par Foncier)
const LS_SELECTED_PARCELS_V1 = "mimmoza.promoteur.selected_parcels_v1";

// AI Extraction endpoint - configurable via env variable
const AI_EXTRACT_ENDPOINT =
  ((import.meta as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_PLU_AI_EXTRACT_ENDPOINT?.trim() ||
  "http://localhost:3000/api/plu-parse";

// ============================================
// Types
// ============================================

type PluDocument = {
  id: string;
  commune_insee: string;
  commune_nom: string | null;
  commune_name?: string | null; // Alternative field name
  plu_version_label: string | null;
  storage_path: string | null;
  created_at: string | null;
  zones_count: number;
  // Additional URL fields that might be present from the API
  source_pdf_url?: string | null;
  public_url?: string | null;
  signed_url?: string | null;
  pdf_url?: string | null;
  url?: string | null;
};

type DocumentsResponse = {
  success: boolean;
  documents?: PluDocument[];
  error?: string;
  message?: string;
};

type Status = "idle" | "loading" | "success" | "error";

type RegleType = "FIXED" | "H_OVER_2" | "H_OVER_2_MIN" | null;

type FacadeRule = {
  regle: RegleType;
  recul_min_m: number | null;
  min_m?: number | null;
  note?: string | null;
};

type ReculRule = {
  min_m?: number | null;
  note?: string | null;
};

type PluRules = {
  implantation?: {
    recul_voirie_min_m?: number | null;
    recul_limite_separative_min_m?: number | null;
    recul_fond_parcelle_min_m?: number | null;
    implantation_en_limite_autorisee?: boolean | null;
    facades?: {
      avant?: FacadeRule;
      laterales?: FacadeRule;
      fond?: FacadeRule;
    };
  };
  reculs?: {
    voirie?: ReculRule;
    limites_separatives?: ReculRule;
    fond_parcelle?: ReculRule;
  };
  emprise?: { ces_max_percent?: number | null };
  hauteur?: { hauteur_max_m?: number | null; hauteur_max_niveaux?: number | null };
  stationnement?: { places_par_logement?: number | null; places_par_100m2?: number | null };
  meta?: { notes?: string[]; engine_version?: string };
  // Fallback for zone_libelle from API response
  zone_libelle?: string | null;
};

type PluRulesZoneRow = {
  document_id: string;
  commune_insee: string;
  zone_code: string;
  zone_libelle: string | null;
  confidence_score: number | null;
  source: string | null;
  rules: PluRules;
  created_at: string;
  // DB columns (may come as number or string from API)
  retrait_voirie_min_m?: number | string | null;
  retrait_limites_separatives_min_m?: number | string | null;
  retrait_fond_parcelle_min_m?: number | string | null;
  places_par_logement?: number | string | null;
  surface_par_place_m2?: number | string | null;
  places_par_100m2?: number | string | null;
  // Potential raw ruleset object (untyped)
  ruleset?: unknown;
};

type PluRulesListResponse = {
  success: boolean;
  count: number;
  zones?: PluRulesZoneRow[];
  error?: string;
  message?: string;
};

// Type pour le payload handoff depuis Foncier
type SelectedParcelsHandoff = {
  parcel_ids?: string[];
  primary_parcel_id?: string | null;
  commune_insee?: string | null;
  address?: string | null;
  updated_at?: string;
};

// ============================================
// SQL View Type (plu_front_zone_summary_v1)
// ============================================

type PluFrontZoneSummaryRow = {
  commune_insee: string;
  commune_nom: string;
  zone_code: string;
  zone_libelle: string | null;
  plu_version_label: string;
  source: string; // "MANUAL" | "UNIVERSAL" (ou autre)
  recul_voirie_min_m: number | string | null;
  recul_limites_min_m: number | string | null;
  recul_fond_min_m: number | string | null;
  implantation_en_limite_autorisee: boolean | null;
  hauteur_max_m: number | string | null;
  ces_max_ratio: number | string | null;
  stationnement_par_logement: number | string | null;
  stationnement_par_100m2: number | string | null;
  stationnement_visiteurs_par_logement: number | string | null;
  velos_par_logement: number | string | null;
  stationnement_note: string | null;
  raw_rules_text: string | null;
};

// ============================================
// AI Extraction Types (NEW FORMAT)
// ============================================

/** Type for a single extracted value from the AI API (new format) */
type AiExtractedValue = {
  value: number | null;
  unit?: string;
  source?: string;
  confidence?: number;
  rawText?: string;
};

/** Type for a boolean extracted value from the AI API */
type AiExtractedBooleanValue = {
  value: boolean | null;
  source?: string;
  confidence?: number;
  rawText?: string;
};

/** Type for hauteur data from AI API (new format) */
type AiHauteurData = {
  hauteur_max?: AiExtractedValue;
  hauteur_egout?: AiExtractedValue;
  hauteur_faitage?: AiExtractedValue;
  nombre_niveaux_max?: AiExtractedValue;
  // Legacy format fallback
  max_m?: number | null;
};

/** Type for stationnement data from AI API (new format) */
type AiStationnementData = {
  places_par_logement?: AiExtractedValue;
  places_par_m2_commerce?: AiExtractedValue;
  places_velo?: AiExtractedValue;
  // Legacy format fallback
  par_logement?: number | null;
  par_100m2?: number | null;
  note?: string | null;
};

/** Type for implantation/reculs data from AI API (new format) */
type AiImplantationData = {
  recul_voirie?: AiExtractedValue;
  recul_limites_separatives?: AiExtractedValue;
  recul_fond_parcelle?: AiExtractedValue;
  implantation_en_limite?: AiExtractedBooleanValue;
};

/** Type for emprise data from AI API (new format) */
type AiEmpriseData = {
  ces_max?: AiExtractedValue;
  cos_max?: AiExtractedValue;
};

/** Type for the AI extraction response data */
type AiExtractResultData = {
  completeness_ok: boolean;
  missing: string[];
  confidence_score: number | null;
  error: string | null;
  source?: string | null;
  // NEW FORMAT: nested objects with value/unit/source/confidence/rawText
  hauteur?: AiHauteurData;
  stationnement?: AiStationnementData;
  implantation?: AiImplantationData;
  emprise?: AiEmpriseData;
  // LEGACY FORMAT: direct values (for backwards compatibility)
  reculs?: {
    voirie?: { min_m: number | null; note?: string | null };
    limites_separatives?: { min_m: number | null; note?: string | null };
    fond_parcelle?: { min_m: number | null; note?: string | null };
    implantation_en_limite?: { autorisee: boolean | null; note?: string | null };
    facades?: {
      avant?: { min_m: number | null; note?: string | null };
      laterales?: { min_m: number | null; note?: string | null };
      fond?: { min_m: number | null; note?: string | null };
    };
  };
  ces?: { max_ratio: number | null; note?: string | null };
  notes?: string[];
  zone_libelle?: string | null;
};

/** Type for the full AI extraction response (supports both old and new format) */
type AiExtractResponse = {
  success: boolean;
  data?: AiExtractResultData;
  error?: string;
  statusCode?: number;
  // New format fields (flat, without data wrapper)
  document_id?: string;
  zone_code?: string;
  ruleset_id?: string;
  completeness_ok?: boolean;
  missing?: string[];
  confidence_score?: number | null;
};

/** Type for the PLU parser response */
type PluParserZoneRuleset = {
  zone_code?: string;
  zone_libelle?: string;
  ruleset?: Record<string, unknown>;
};

type PluParserResponse = {
  success?: boolean;
  error?: string;
  zones_rulesets?: PluParserZoneRuleset[];
  // Additional fields that might be present
  document_id?: string;
  commune_insee?: string;
};

/** Persisted AI extraction result with metadata */
type PersistedAiExtractResult = {
  document_id: string;
  zone_code: string;
  commune_insee: string;
  extracted_at: string;
  data: AiExtractResultData;
};

// ============================================
// User Overrides Types
// ============================================

/** User override values for a specific document/zone */
type UserOverrideValues = {
  reculs: {
    voirie_min_m?: number | null;
    limites_separatives_min_m?: number | null;
    fond_parcelle_min_m?: number | null;
    implantation_en_limite_autorisee?: boolean | null;
  };
  ces_max_ratio?: number | null;
  hauteur_max_m?: number | null;
  stationnement_par_logement?: number | null;
  stationnement_par_100m2?: number | null;
  notes_append?: string | null;
};

/** User override entry with metadata */
type UserOverrideEntry = {
  updated_at: string;
  overrides: UserOverrideValues;
};

/** Full user overrides storage structure indexed by "document_id::ZONE_CODE" */
type UserOverridesStorage = {
  [key: string]: UserOverrideEntry;
};

// ============================================
// Resolved Ruleset V1 Types
// ============================================

/** Type for a single recul rule in the resolved ruleset */
type ResolvedReculRule = {
  min_m: number | null;
  type: "FIXED" | "DERIVED" | "UNKNOWN";
  note?: string | null;
};

/** Type for facade rules in the resolved ruleset */
type ResolvedFacadeRule = {
  min_m: number | null;
  type: "FIXED" | "DERIVED" | "UNKNOWN";
  note?: string | null;
  derived?: boolean;
};

/** Type for implantation en limite */
type ResolvedImplantationEnLimite = {
  autorisee: boolean | null;
  note?: string | null;
};

/** Completeness check result */
type CompletenessCheck = {
  ok: boolean;
  missing: string[];
};

/** Full resolved ruleset v1 structure */
export type ResolvedPluRulesetV1 = {
  version: "plu_ruleset_v1";
  document_id: string;
  commune_insee: string;
  zone_code: string;
  zone_libelle: string | null;
  confidence_score: number | null;
  source: string | null;
  reculs: {
    voirie: ResolvedReculRule;
    limites_separatives: ResolvedReculRule;
    fond_parcelle: ResolvedReculRule;
    implantation_en_limite: ResolvedImplantationEnLimite;
    facades: {
      avant: ResolvedFacadeRule;
      laterales: ResolvedFacadeRule;
      fond: ResolvedFacadeRule;
    };
  };
  ces: {
    max_ratio: number | null;
    note?: string | null;
  };
  hauteur: {
    max_m: number | null;
    note?: string | null;
  };
  stationnement: {
    par_logement: number | null;
    par_100m2: number | null;
    note?: string | null;
  };
  notes: string[];
  completeness: CompletenessCheck;
};

// ============================================
// Helpers
// ============================================

function readLS(key: string, fallback = ""): string {
  try {
    if (typeof window === "undefined") return fallback;
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isValidCodeInsee(v: string) {
  return /^\d{5}$/.test((v ?? "").trim());
}

/**
 * Normalise un code de zone PLU: trim + uppercase.
 */
function normalizeZoneCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  return normalized || null;
}

/**
 * Compare two zone codes in a case-insensitive manner.
 */
function zonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizeZoneCode(a);
  const normB = normalizeZoneCode(b);
  if (!normA || !normB) return false;
  return normA === normB;
}

/**
 * Robustly converts an unknown value to a number.
 * Handles: number, string "5", string "5,5" (French decimal), string "5.5"
 * Returns null if conversion fails or value is null/undefined/NaN.
 */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number") {
    return Number.isNaN(v) ? null : v;
  }

  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    // Replace French decimal comma with dot
    const normalized = trimmed.replace(",", ".");
    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Returns the first value that can be converted to a valid number.
 * Useful for fallback chains: DB column -> old model -> new model -> raw ruleset.
 */
function pickFirstNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = toNumber(c);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Safely extracts a boolean from an unknown value.
 * Returns null if the value is not strictly a boolean.
 */
function safeBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

/**
 * Safely extracts a string from an unknown value.
 * Returns null if the value is not strictly a string or is empty.
 */
function safeString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/**
 * Format a number for display, with explicit "Non trouvé" instead of "—"
 */
function formatMaybeNumber(v: number | null | undefined, unit?: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "Non trouvé";
  if (unit) return `${v} ${unit}`;
  return String(v);
}

/**
 * Format a boolean for display, with explicit "Non déterminable" instead of "—"
 */
function formatBool(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return "Non déterminable";
  return v ? "Oui" : "Non";
}

/**
 * Format a facade rule for display, with explicit text for missing values
 */
function formatFacade(f?: FacadeRule): string {
  if (!f) return "Non trouvé (façade non extraite)";
  const val = f.recul_min_m !== null && f.recul_min_m !== undefined ? `${f.recul_min_m} m` : "Non trouvé";
  const regle = f.regle ?? "Non déterminable";
  return `${regle}${f.regle === "FIXED" ? ` ${val}` : f.regle ? ` (min: ${f.min_m ?? "Non trouvé"} m)` : ""}`.trim();
}

/**
 * Format a resolved facade rule for display (from resolvedRuleset)
 */
function formatResolvedFacade(f?: ResolvedFacadeRule): string {
  if (!f) return "Non trouvé (façade non extraite)";
  if (f.min_m === null) return "Non trouvé";
  const derivedSuffix = f.derived ? " (dérivé)" : "";
  return `${f.min_m} m${derivedSuffix}`;
}

/**
 * Safely access nested properties from an untyped ruleset object.
 */
function getRulesetValue(ruleset: unknown, ...path: string[]): unknown {
  let current: unknown = ruleset;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Extracts numeric value from new AI API format { value, unit, source, confidence, rawText }
 */
function extractAiValue(obj: AiExtractedValue | undefined | null): number | null {
  if (!obj || typeof obj !== "object") return null;
  return toNumber(obj.value);
}

/**
 * Extracts boolean value from new AI API format { value, source, confidence }
 */
function extractAiBooleanValue(obj: AiExtractedBooleanValue | undefined | null): boolean | null {
  if (!obj || typeof obj !== "object") return null;
  return safeBoolean(obj.value);
}

/**
 * Collects notes from multiple sources, avoiding duplicates.
 * Sources checked in order:
 * 1. meta.notes array
 * 2. rules.reculs.*.note (new model from API)
 * 3. ruleset.reculs.*.note (raw ruleset fallback)
 */
function collectNotes(
  metaNotes: string[] | undefined,
  ruleset: unknown,
  rules?: PluRules
): string[] {
  const notesSet = new Set<string>();

  // Add meta notes
  if (metaNotes && Array.isArray(metaNotes)) {
    for (const n of metaNotes) {
      if (typeof n === "string" && n.trim()) {
        notesSet.add(n.trim());
      }
    }
  }

  // Add notes from rules.reculs (new model from API)
  const voirieNoteFromRules = rules?.reculs?.voirie?.note;
  if (typeof voirieNoteFromRules === "string" && voirieNoteFromRules.trim()) {
    notesSet.add(voirieNoteFromRules.trim());
  }

  const limitesNoteFromRules = rules?.reculs?.limites_separatives?.note;
  if (typeof limitesNoteFromRules === "string" && limitesNoteFromRules.trim()) {
    notesSet.add(limitesNoteFromRules.trim());
  }

  const fondNoteFromRules = rules?.reculs?.fond_parcelle?.note;
  if (typeof fondNoteFromRules === "string" && fondNoteFromRules.trim()) {
    notesSet.add(fondNoteFromRules.trim());
  }

  // Add ruleset notes if they exist (raw ruleset fallback)
  const voirieNote = getRulesetValue(ruleset, "reculs", "voirie", "note");
  if (typeof voirieNote === "string" && voirieNote.trim()) {
    notesSet.add(voirieNote.trim());
  }

  const limitesNote = getRulesetValue(ruleset, "reculs", "limites_separatives", "note");
  if (typeof limitesNote === "string" && limitesNote.trim()) {
    notesSet.add(limitesNote.trim());
  }

  const fondNote = getRulesetValue(ruleset, "reculs", "fond_parcelle", "note");
  if (typeof fondNote === "string" && fondNote.trim()) {
    notesSet.add(fondNote.trim());
  }

  return Array.from(notesSet);
}

/**
 * Determines if a zone has at least one meaningful/exploitable rule value.
 * A zone is "meaningful" if at least one of the key rule fields has a valid numeric value.
 */
function isZoneMeaningful(z: PluRulesZoneRow): boolean {
  const ruleset = z.ruleset;
  const reculs = z.rules.reculs;
  const impl = z.rules.implantation;

  // Check voirie (all fallback sources)
  const voirieValue = pickFirstNumber(
    z.retrait_voirie_min_m,
    impl?.recul_voirie_min_m,
    reculs?.voirie?.min_m,
    getRulesetValue(ruleset, "reculs", "voirie", "min_m")
  );
  if (voirieValue !== null) return true;

  // Check limites séparatives (all fallback sources)
  const limitesValue = pickFirstNumber(
    z.retrait_limites_separatives_min_m,
    impl?.recul_limite_separative_min_m,
    reculs?.limites_separatives?.min_m,
    getRulesetValue(ruleset, "reculs", "limites_separatives", "min_m")
  );
  if (limitesValue !== null) return true;

  // Check fond de parcelle (all fallback sources)
  const fondParcelleValue = pickFirstNumber(
    z.retrait_fond_parcelle_min_m,
    impl?.recul_fond_parcelle_min_m,
    reculs?.fond_parcelle?.min_m,
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "min_m")
  );
  if (fondParcelleValue !== null) return true;

  // Check stationnement / logement
  const stationnementLogementValue = pickFirstNumber(
    z.places_par_logement,
    z.rules?.stationnement?.places_par_logement
  );
  if (stationnementLogementValue !== null) return true;

  // Check stationnement / 100m²
  const stationnement100m2Value = pickFirstNumber(
    z.places_par_100m2,
    z.rules?.stationnement?.places_par_100m2
  );
  if (stationnement100m2Value !== null) return true;

  // Check hauteur max
  const hauteurValue = toNumber(z.rules.hauteur?.hauteur_max_m);
  if (hauteurValue !== null) return true;

  // Check CES max
  const cesValue = toNumber(z.rules.emprise?.ces_max_percent);
  if (cesValue !== null) return true;

  return false;
}

/**
 * Gets the zone libellé with fallback to rules.zone_libelle if main field is null.
 */
function getZoneLibelle(z: PluRulesZoneRow): string {
  if (z.zone_libelle && z.zone_libelle.trim()) {
    return z.zone_libelle.trim();
  }
  // Fallback to rules.zone_libelle if present (from API response)
  if (z.rules.zone_libelle && z.rules.zone_libelle.trim()) {
    return z.rules.zone_libelle.trim();
  }
  return "Non trouvé";
}

/**
 * Syncs session data from the handoff key (LS_SELECTED_PARCELS_V1) written by Foncier.
 * Reads the handoff payload and updates LS_SESSION_PARCEL_ID and LS_SESSION_COMMUNE_INSEE
 * if valid data is found. Never overwrites with empty values.
 * Returns { parcelId, communeInsee, address } if found, or nulls otherwise.
 */
function syncSessionFromHandoff(): { parcelId: string | null; communeInsee: string | null; address: string | null } {
  const result = { parcelId: null as string | null, communeInsee: null as string | null, address: null as string | null };
  
  try {
    const handoffRaw = readLS(LS_SELECTED_PARCELS_V1, "");
    if (!handoffRaw) return result;
    
    const handoff = safeJsonParse<SelectedParcelsHandoff>(handoffRaw);
    if (!handoff) return result;
    
    // Extract parcel ID: primary_parcel_id > parcel_ids[0]
    let parcelId: string | null = null;
    if (typeof handoff.primary_parcel_id === "string" && handoff.primary_parcel_id.trim()) {
      parcelId = handoff.primary_parcel_id.trim();
    } else if (Array.isArray(handoff.parcel_ids) && handoff.parcel_ids.length > 0) {
      const first = handoff.parcel_ids[0];
      if (typeof first === "string" && first.trim()) {
        parcelId = first.trim();
      }
    }
    
    // Extract commune_insee
    let communeInsee: string | null = null;
    if (typeof handoff.commune_insee === "string" && handoff.commune_insee.trim()) {
      communeInsee = handoff.commune_insee.trim();
    }
    
    // Extract address
    let address: string | null = null;
    if (typeof handoff.address === "string" && handoff.address.trim()) {
      address = handoff.address.trim();
    }
    
    // Write to session keys ONLY if we have non-empty values
    if (parcelId) {
      writeLS(LS_SESSION_PARCEL_ID, parcelId);
      result.parcelId = parcelId;
    }
    
    if (communeInsee) {
      writeLS(LS_SESSION_COMMUNE_INSEE, communeInsee);
      result.communeInsee = communeInsee;
    }
    
    if (address) {
      writeLS(LS_SESSION_ADDRESS, address);
      result.address = address;
    }
    
    return result;
  } catch {
    return result;
  }
}

/**
 * Loads persisted AI extraction result from localStorage.
 * Returns null if not found or if document_id/zone_code don't match current selection.
 */
function loadPersistedAiExtractResult(
  documentId: string | null,
  zoneCode: string | null
): PersistedAiExtractResult | null {
  if (!documentId || !zoneCode) return null;
  
  try {
    const raw = readLS(LS_PLU_AI_EXTRACT_RESULT, "");
    if (!raw) return null;
    
    const persisted = safeJsonParse<PersistedAiExtractResult>(raw);
    if (!persisted) return null;
    
    // Validate that it matches current selection (case-insensitive for zone)
    if (persisted.document_id !== documentId || !zonesMatch(persisted.zone_code, zoneCode)) {
      return null;
    }
    
    return persisted;
  } catch {
    return null;
  }
}

/**
 * Checks if a resolved ruleset has at least one meaningful value.
 */
function isResolvedRulesetMeaningful(r: ResolvedPluRulesetV1): boolean {
  if (r.reculs.voirie.min_m !== null) return true;
  if (r.reculs.limites_separatives.min_m !== null) return true;
  if (r.reculs.fond_parcelle.min_m !== null) return true;
  if (r.reculs.implantation_en_limite.autorisee !== null) return true;
  if (r.reculs.facades.avant.min_m !== null) return true;
  if (r.reculs.facades.laterales.min_m !== null) return true;
  if (r.reculs.facades.fond.min_m !== null) return true;
  if (r.stationnement.par_logement !== null) return true;
  if (r.stationnement.par_100m2 !== null) return true;
  if (r.hauteur.max_m !== null) return true;
  if (r.ces.max_ratio !== null) return true;
  return false;
}

/**
 * Generates the storage key for user overrides based on document_id and zone_code.
 */
function getUserOverrideKey(documentId: string, zoneCode: string): string {
  return `${documentId}::${normalizeZoneCode(zoneCode) ?? zoneCode}`;
}

/**
 * Loads user overrides from localStorage.
 */
function loadUserOverrides(): UserOverridesStorage {
  try {
    const raw = readLS(LS_PLU_USER_OVERRIDES_V1, "");
    if (!raw) return {};
    const parsed = safeJsonParse<UserOverridesStorage>(raw);
    return parsed ?? {};
  } catch {
    return {};
  }
}

/**
 * Saves user overrides to localStorage.
 */
function saveUserOverrides(overrides: UserOverridesStorage): void {
  writeLS(LS_PLU_USER_OVERRIDES_V1, JSON.stringify(overrides));
}

/**
 * Gets user override entry for a specific document/zone.
 */
function getUserOverrideEntry(
  documentId: string | null,
  zoneCode: string | null
): UserOverrideEntry | null {
  if (!documentId || !zoneCode) return null;
  const allOverrides = loadUserOverrides();
  const key = getUserOverrideKey(documentId, zoneCode);
  return allOverrides[key] ?? null;
}

/**
 * Applies user overrides to a resolved ruleset.
 * User values take priority over existing values.
 * Returns a new ruleset with source updated to indicate user override.
 */
function applyUserOverrides(
  baseResolved: ResolvedPluRulesetV1,
  overrides: UserOverrideValues | null
): ResolvedPluRulesetV1 {
  if (!overrides) return baseResolved;

  // Deep clone the base resolved ruleset
  const result: ResolvedPluRulesetV1 = JSON.parse(JSON.stringify(baseResolved));

  // Apply recul overrides
  if (overrides.reculs.voirie_min_m !== undefined) {
    const val = toNumber(overrides.reculs.voirie_min_m);
    if (val !== null) {
      result.reculs.voirie.min_m = val;
      result.reculs.voirie.type = "FIXED";
      result.reculs.voirie.note = "Corrigé par l'utilisateur";
      // Also update facade avant if derived
      if (result.reculs.facades.avant.derived || result.reculs.facades.avant.min_m === null) {
        result.reculs.facades.avant.min_m = val;
        result.reculs.facades.avant.type = "DERIVED";
        result.reculs.facades.avant.note = "Dérivé du recul voirie (utilisateur)";
        result.reculs.facades.avant.derived = true;
      }
    }
  }

  if (overrides.reculs.limites_separatives_min_m !== undefined) {
    const val = toNumber(overrides.reculs.limites_separatives_min_m);
    if (val !== null) {
      result.reculs.limites_separatives.min_m = val;
      result.reculs.limites_separatives.type = "FIXED";
      result.reculs.limites_separatives.note = "Corrigé par l'utilisateur";
      // Also update facade laterales if derived
      if (result.reculs.facades.laterales.derived || result.reculs.facades.laterales.min_m === null) {
        result.reculs.facades.laterales.min_m = val;
        result.reculs.facades.laterales.type = "DERIVED";
        result.reculs.facades.laterales.note = "Dérivé du recul limites séparatives (utilisateur)";
        result.reculs.facades.laterales.derived = true;
      }
    }
  }

  if (overrides.reculs.fond_parcelle_min_m !== undefined) {
    const val = toNumber(overrides.reculs.fond_parcelle_min_m);
    if (val !== null) {
      result.reculs.fond_parcelle.min_m = val;
      result.reculs.fond_parcelle.type = "FIXED";
      result.reculs.fond_parcelle.note = "Corrigé par l'utilisateur";
      // Also update facade fond if derived
      if (result.reculs.facades.fond.derived || result.reculs.facades.fond.min_m === null) {
        result.reculs.facades.fond.min_m = val;
        result.reculs.facades.fond.type = "DERIVED";
        result.reculs.facades.fond.note = "Dérivé du recul fond de parcelle (utilisateur)";
        result.reculs.facades.fond.derived = true;
      }
    }
  }

  if (overrides.reculs.implantation_en_limite_autorisee !== undefined) {
    const val = safeBoolean(overrides.reculs.implantation_en_limite_autorisee);
    if (val !== null) {
      result.reculs.implantation_en_limite.autorisee = val;
      result.reculs.implantation_en_limite.note = "Corrigé par l'utilisateur";
    }
  }

  // Apply CES override (stored as ratio 0-1)
  if (overrides.ces_max_ratio !== undefined) {
    const val = toNumber(overrides.ces_max_ratio);
    if (val !== null) {
      result.ces.max_ratio = val;
      result.ces.note = "Corrigé par l'utilisateur";
    }
  }

  // Apply hauteur override
  if (overrides.hauteur_max_m !== undefined) {
    const val = toNumber(overrides.hauteur_max_m);
    if (val !== null) {
      result.hauteur.max_m = val;
      result.hauteur.note = "Corrigé par l'utilisateur";
    }
  }

  // Apply stationnement overrides
  if (overrides.stationnement_par_logement !== undefined) {
    const val = toNumber(overrides.stationnement_par_logement);
    if (val !== null) {
      result.stationnement.par_logement = val;
      result.stationnement.note = "Corrigé par l'utilisateur";
    }
  }

  if (overrides.stationnement_par_100m2 !== undefined) {
    const val = toNumber(overrides.stationnement_par_100m2);
    if (val !== null) {
      result.stationnement.par_100m2 = val;
      if (!result.stationnement.note) {
        result.stationnement.note = "Corrigé par l'utilisateur";
      }
    }
  }

  // Append user note (avoiding duplicates)
  if (overrides.notes_append && typeof overrides.notes_append === "string" && overrides.notes_append.trim()) {
    const userNote = `[Note utilisateur] ${overrides.notes_append.trim()}`;
    if (!result.notes.includes(userNote)) {
      result.notes.push(userNote);
    }
  }

  // Update source to indicate user override
  if (result.source) {
    result.source = `${result.source}+USER`;
  } else {
    result.source = "USER_OVERRIDDEN";
  }

  // Recompute completeness based on new values (only 3 main reculs are blocking)
  const missingBlocking: string[] = [];
  const missingOptional: string[] = [];

  if (result.reculs.voirie.min_m === null) missingBlocking.push("reculs.voirie.min_m");
  if (result.reculs.limites_separatives.min_m === null) missingBlocking.push("reculs.limites_separatives.min_m");
  if (result.reculs.fond_parcelle.min_m === null) missingBlocking.push("reculs.fond_parcelle.min_m");

  // Optional fields (non-blocking)
  if (result.reculs.implantation_en_limite.autorisee === null) missingOptional.push("implantation_en_limite");
  if (result.stationnement.par_logement === null && result.stationnement.par_100m2 === null) {
    missingOptional.push("stationnement");
  }
  if (result.hauteur.max_m === null) missingOptional.push("hauteur.max_m");
  if (result.ces.max_ratio === null) missingOptional.push("ces.max_ratio");

  result.completeness = {
    ok: missingBlocking.length === 0,
    missing: [
      ...missingBlocking,
      ...missingOptional.map(x => `${x} (optionnel)`)
    ],
  };

  return result;
}

/**
 * Extracts the PDF URL from a PluDocument, checking various possible field names.
 * Returns null if no URL is found.
 */
function extractPdfUrlFromDocument(doc: PluDocument | null | undefined): string | null {
  if (!doc) return null;

  // Check various possible URL field names in order of priority
  const candidates = [
    doc.source_pdf_url,
    doc.public_url,
    doc.signed_url,
    doc.pdf_url,
    doc.url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

/**
 * Converts a parser ruleset to AiExtractResultData format.
 * Maps fields defensively - null if not present.
 */
function convertParserRulesetToAiExtractResult(
  ruleset: Record<string, unknown>,
  zoneLibelle: string | null
): AiExtractResultData {
  // Extract reculs
  const voirieMinM = pickFirstNumber(
    getRulesetValue(ruleset, "reculs", "voirie", "min_m"),
    getRulesetValue(ruleset, "reculs", "voirie", "recul_min_m")
  );
  const limitesMinM = pickFirstNumber(
    getRulesetValue(ruleset, "reculs", "limites_separatives", "min_m"),
    getRulesetValue(ruleset, "reculs", "limites_separatives", "recul_min_m")
  );
  const fondMinM = pickFirstNumber(
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "min_m"),
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "recul_min_m")
  );
  const implEnLimiteAutorisee = safeBoolean(
    getRulesetValue(ruleset, "reculs", "implantation_en_limite", "autorisee")
  );

  // Extract hauteur
  const hauteurMaxM = pickFirstNumber(
    getRulesetValue(ruleset, "hauteur", "max_m"),
    getRulesetValue(ruleset, "hauteur", "hauteur_max_m"),
    getRulesetValue(ruleset, "hauteur", "hauteur_max")
  );

  // Extract stationnement
  const statParLogement = pickFirstNumber(
    getRulesetValue(ruleset, "stationnement", "par_logement"),
    getRulesetValue(ruleset, "stationnement", "places_par_logement")
  );
  const statPar100m2 = pickFirstNumber(
    getRulesetValue(ruleset, "stationnement", "par_100m2"),
    getRulesetValue(ruleset, "stationnement", "places_par_100m2")
  );

  // Extract CES
  const cesMaxRatio = pickFirstNumber(
    getRulesetValue(ruleset, "emprise", "ces_max_ratio"),
    getRulesetValue(ruleset, "emprise", "ces_max_percent"),
    getRulesetValue(ruleset, "ces", "max_ratio")
  );

  // Compute missing fields
  const missing: string[] = [];
  if (voirieMinM === null) missing.push("reculs.voirie.min_m");
  if (limitesMinM === null) missing.push("reculs.limites_separatives.min_m");
  if (fondMinM === null) missing.push("reculs.fond_parcelle.min_m");
  
  // Optional fields
  if (implEnLimiteAutorisee === null) missing.push("implantation_en_limite (optionnel)");
  if (statParLogement === null && statPar100m2 === null) missing.push("stationnement (optionnel)");
  if (hauteurMaxM === null) missing.push("hauteur.max_m (optionnel)");
  if (cesMaxRatio === null) missing.push("ces.max_ratio (optionnel)");

  const completenessOk = voirieMinM !== null && limitesMinM !== null && fondMinM !== null;

  // Collect notes from ruleset
  const notesArray: string[] = [];
  const rawNotes = getRulesetValue(ruleset, "notes");
  if (Array.isArray(rawNotes)) {
    for (const n of rawNotes) {
      if (typeof n === "string" && n.trim()) {
        notesArray.push(n.trim());
      }
    }
  }

  return {
    completeness_ok: completenessOk,
    missing,
    confidence_score: toNumber(getRulesetValue(ruleset, "confidence_score")),
    error: null,
    source: "PLU_PARSER_LOCAL",
    zone_libelle: zoneLibelle,
    // Legacy format for backwards compatibility
    reculs: {
      voirie: { 
        min_m: voirieMinM, 
        note: safeString(getRulesetValue(ruleset, "reculs", "voirie", "note")) 
      },
      limites_separatives: { 
        min_m: limitesMinM, 
        note: safeString(getRulesetValue(ruleset, "reculs", "limites_separatives", "note")) 
      },
      fond_parcelle: { 
        min_m: fondMinM, 
        note: safeString(getRulesetValue(ruleset, "reculs", "fond_parcelle", "note")) 
      },
      implantation_en_limite: { 
        autorisee: implEnLimiteAutorisee, 
        note: safeString(getRulesetValue(ruleset, "reculs", "implantation_en_limite", "note")) 
      },
    },
    hauteur: {
      max_m: hauteurMaxM,
    },
    stationnement: {
      par_logement: statParLogement,
      par_100m2: statPar100m2,
      note: safeString(getRulesetValue(ruleset, "stationnement", "note")),
    },
    ces: {
      max_ratio: cesMaxRatio,
      note: safeString(getRulesetValue(ruleset, "emprise", "note") ?? getRulesetValue(ruleset, "ces", "note")),
    },
    notes: notesArray,
  };
}

// ============================================
// Resolved Ruleset V1 Builder
// ============================================

/**
 * Builds a fully resolved ruleset v1 from a PluRulesZoneRow.
 * Aggregates values from multiple fallback sources and checks completeness.
 * NEW: Completeness only requires the 3 main reculs (voirie, limites, fond).
 */
function resolvePluRulesetV1(z: PluRulesZoneRow): ResolvedPluRulesetV1 {
  const impl = z.rules.implantation;
  const fac = impl?.facades;
  const ruleset = z.ruleset;
  const reculs = z.rules.reculs;

  // ---- Compute core recul values with full fallback chain ----

  // Voirie: DB -> implantation -> rules.reculs -> ruleset.reculs
  const voirieValue = pickFirstNumber(
    z.retrait_voirie_min_m,
    impl?.recul_voirie_min_m,
    reculs?.voirie?.min_m,
    getRulesetValue(ruleset, "reculs", "voirie", "min_m")
  );
  const voirieNote = 
    safeString(reculs?.voirie?.note) ?? 
    safeString(getRulesetValue(ruleset, "reculs", "voirie", "note")) ?? 
    undefined;

  // Limites séparatives: DB -> implantation -> rules.reculs -> ruleset.reculs
  const limitesValue = pickFirstNumber(
    z.retrait_limites_separatives_min_m,
    impl?.recul_limite_separative_min_m,
    reculs?.limites_separatives?.min_m,
    getRulesetValue(ruleset, "reculs", "limites_separatives", "min_m")
  );
  const limitesNote = 
    safeString(reculs?.limites_separatives?.note) ?? 
    safeString(getRulesetValue(ruleset, "reculs", "limites_separatives", "note")) ?? 
    undefined;

  // Fond de parcelle: DB -> rules.reculs -> ruleset.reculs
  const fondParcelleValue = pickFirstNumber(
    z.retrait_fond_parcelle_min_m,
    impl?.recul_fond_parcelle_min_m,
    reculs?.fond_parcelle?.min_m,
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "min_m")
  );
  const fondParcelleNote = 
    safeString(reculs?.fond_parcelle?.note) ?? 
    safeString(getRulesetValue(ruleset, "reculs", "fond_parcelle", "note")) ?? 
    undefined;

  // Implantation en limite: extraction SAFE sans cast dangereux
  let implantationEnLimiteAutorisee: boolean | null = null;
  if (typeof impl?.implantation_en_limite_autorisee === "boolean") {
    implantationEnLimiteAutorisee = impl.implantation_en_limite_autorisee;
  } else {
    // Fallback sur ruleset brut avec validation stricte du type
    const rawValue = getRulesetValue(ruleset, "reculs", "implantation_en_limite", "autorisee");
    implantationEnLimiteAutorisee = safeBoolean(rawValue);
  }
  
  const implantationEnLimiteNote = 
    safeString(getRulesetValue(ruleset, "reculs", "implantation_en_limite", "note")) ?? 
    undefined;

  // ---- Facades: fallback ruleset brut AVANT dérivation ----
  // Ordre de priorité: impl.facades -> ruleset.rules.implantation.facades -> ruleset.implantation.facades -> dérivation

  // Helper pour extraire une façade depuis le ruleset brut
  const extractFacadeFromRuleset = (facadeKey: string): { min_m: number | null; note: string | null } => {
    // Chemin 1: ruleset.rules.implantation.facades.<key>
    const path1MinM = pickFirstNumber(
      getRulesetValue(ruleset, "rules", "implantation", "facades", facadeKey, "recul_min_m"),
      getRulesetValue(ruleset, "rules", "implantation", "facades", facadeKey, "min_m")
    );
    const path1Note = safeString(getRulesetValue(ruleset, "rules", "implantation", "facades", facadeKey, "note"));
    
    if (path1MinM !== null) {
      return { min_m: path1MinM, note: path1Note };
    }
    
    // Chemin 2: ruleset.implantation.facades.<key>
    const path2MinM = pickFirstNumber(
      getRulesetValue(ruleset, "implantation", "facades", facadeKey, "recul_min_m"),
      getRulesetValue(ruleset, "implantation", "facades", facadeKey, "min_m")
    );
    const path2Note = safeString(getRulesetValue(ruleset, "implantation", "facades", facadeKey, "note"));
    
    return { min_m: path2MinM, note: path2Note };
  };

  // Facade avant
  let facadeAvantMinM: number | null = null;
  let facadeAvantDerived = false;
  let facadeAvantNote: string | undefined = undefined;
  
  // 1. Essayer impl.facades.avant
  if (fac?.avant && (fac.avant.recul_min_m !== null || fac.avant.min_m !== null)) {
    facadeAvantMinM = fac.avant.recul_min_m ?? fac.avant.min_m ?? null;
    facadeAvantNote = safeString(fac.avant.note) ?? undefined;
  } else {
    // 2. Essayer ruleset brut
    const rulesetFacade = extractFacadeFromRuleset("avant");
    if (rulesetFacade.min_m !== null) {
      facadeAvantMinM = rulesetFacade.min_m;
      facadeAvantNote = rulesetFacade.note ?? undefined;
    } else if (voirieValue !== null) {
      // 3. Dériver du recul voirie
      facadeAvantMinM = voirieValue;
      facadeAvantDerived = true;
      facadeAvantNote = "Dérivé du recul voirie";
    }
  }

  // Facade laterales
  let facadeLateralesMinM: number | null = null;
  let facadeLateralesDerived = false;
  let facadeLateralesNote: string | undefined = undefined;
  
  if (fac?.laterales && (fac.laterales.recul_min_m !== null || fac.laterales.min_m !== null)) {
    facadeLateralesMinM = fac.laterales.recul_min_m ?? fac.laterales.min_m ?? null;
    facadeLateralesNote = safeString(fac.laterales.note) ?? undefined;
  } else {
    const rulesetFacade = extractFacadeFromRuleset("laterales");
    if (rulesetFacade.min_m !== null) {
      facadeLateralesMinM = rulesetFacade.min_m;
      facadeLateralesNote = rulesetFacade.note ?? undefined;
    } else if (limitesValue !== null) {
      facadeLateralesMinM = limitesValue;
      facadeLateralesDerived = true;
      facadeLateralesNote = "Dérivé du recul limites séparatives";
    }
  }

  // Facade fond
  let facadeFondMinM: number | null = null;
  let facadeFondDerived = false;
  let facadeFondNote: string | undefined = undefined;
  
  if (fac?.fond && (fac.fond.recul_min_m !== null || fac.fond.min_m !== null)) {
    facadeFondMinM = fac.fond.recul_min_m ?? fac.fond.min_m ?? null;
    facadeFondNote = safeString(fac.fond.note) ?? undefined;
  } else {
    const rulesetFacade = extractFacadeFromRuleset("fond");
    if (rulesetFacade.min_m !== null) {
      facadeFondMinM = rulesetFacade.min_m;
      facadeFondNote = rulesetFacade.note ?? undefined;
    } else if (fondParcelleValue !== null) {
      facadeFondMinM = fondParcelleValue;
      facadeFondDerived = true;
      facadeFondNote = "Dérivé du recul fond de parcelle";
    }
  }

  // ---- CES: conversion robuste en ratio avec validation ----
  const cesPercent = pickFirstNumber(
    z.rules.emprise?.ces_max_percent,
    getRulesetValue(ruleset, "emprise", "ces_max_percent")
  );
  
  let cesMaxRatio: number | null = null;
  let cesNote: string | undefined = undefined;
  
  if (cesPercent === null) {
    cesNote = "Non trouvé dans le ruleset";
  } else if (cesPercent > 100) {
    // Valeur aberrante > 100% : on considère suspect et on garde null
    cesMaxRatio = null;
    cesNote = `Valeur suspecte (${cesPercent}%) ignorée`;
  } else if (cesPercent >= 1 && cesPercent <= 100) {
    // Valeur en pourcentage (1-100) : convertir en ratio
    cesMaxRatio = cesPercent / 100;
  } else if (cesPercent >= 0 && cesPercent < 1) {
    // Déjà un ratio (0-1) : garder tel quel
    cesMaxRatio = cesPercent;
  } else {
    // Valeur négative ou autre cas invalide
    cesMaxRatio = null;
    cesNote = `Valeur invalide (${cesPercent}) ignorée`;
  }

  // ---- Hauteur: rules.hauteur -> ruleset.hauteur ----
  const hauteurMaxM = pickFirstNumber(
    z.rules.hauteur?.hauteur_max_m,
    getRulesetValue(ruleset, "hauteur", "max_m"),
    getRulesetValue(ruleset, "hauteur", "hauteur_max_m")
  );
  const hauteurNote = hauteurMaxM === null ? "Non trouvé dans le ruleset" : undefined;

  // ---- Stationnement ----
  const stationnementParLogement = pickFirstNumber(
    z.places_par_logement,
    z.rules?.stationnement?.places_par_logement,
    getRulesetValue(ruleset, "stationnement", "places_par_logement"),
    getRulesetValue(ruleset, "stationnement", "par_logement")
  );
  const stationnementPar100m2 = pickFirstNumber(
    z.places_par_100m2,
    z.rules?.stationnement?.places_par_100m2,
    getRulesetValue(ruleset, "stationnement", "places_par_100m2"),
    getRulesetValue(ruleset, "stationnement", "par_100m2")
  );
  const stationnementNote = 
    (stationnementParLogement === null && stationnementPar100m2 === null) 
      ? "Non trouvé dans le ruleset" 
      : undefined;

  // ---- Collect all notes ----
  const allNotes = collectNotes(z.rules.meta?.notes, ruleset, z.rules);

  // ---- NEW COMPLETENESS: only 3 main reculs are blocking ----
  const missingBlocking: string[] = [];
  const missingOptional: string[] = [];
  
  // Champs bloquants (les 3 reculs principaux UNIQUEMENT)
  if (voirieValue === null) missingBlocking.push("reculs.voirie.min_m");
  if (limitesValue === null) missingBlocking.push("reculs.limites_separatives.min_m");
  if (fondParcelleValue === null) missingBlocking.push("reculs.fond_parcelle.min_m");

  // Champs optionnels (non-bloquants)
  if (implantationEnLimiteAutorisee === null) missingOptional.push("implantation_en_limite");
  if (stationnementParLogement === null && stationnementPar100m2 === null) {
    missingOptional.push("stationnement");
  }
  if (hauteurMaxM === null) missingOptional.push("hauteur.max_m");
  if (cesMaxRatio === null) missingOptional.push("ces.max_ratio");

  // completeness.ok = true seulement si les 3 reculs principaux sont présents
  const completenessOk = missingBlocking.length === 0;
  
  // Fusion des missing avec marqueur "(optionnel)" pour les non-bloquants
  const allMissing = [
    ...missingBlocking,
    ...missingOptional.map(x => `${x} (optionnel)`)
  ];

  // ---- Build resolved ruleset ----
  const resolved: ResolvedPluRulesetV1 = {
    version: "plu_ruleset_v1",
    document_id: z.document_id,
    commune_insee: z.commune_insee,
    zone_code: z.zone_code,
    zone_libelle: z.zone_libelle ?? z.rules.zone_libelle ?? null,
    confidence_score: z.confidence_score,
    source: z.source,
    reculs: {
      voirie: {
        min_m: voirieValue,
        type: voirieValue !== null ? "FIXED" : "UNKNOWN",
        note: voirieNote,
      },
      limites_separatives: {
        min_m: limitesValue,
        type: limitesValue !== null ? "FIXED" : "UNKNOWN",
        note: limitesNote,
      },
      fond_parcelle: {
        min_m: fondParcelleValue,
        type: fondParcelleValue !== null ? "FIXED" : "UNKNOWN",
        note: fondParcelleNote,
      },
      implantation_en_limite: {
        autorisee: implantationEnLimiteAutorisee,
        note: implantationEnLimiteNote,
      },
      facades: {
        avant: {
          min_m: facadeAvantMinM,
          type: facadeAvantMinM !== null ? (facadeAvantDerived ? "DERIVED" : "FIXED") : "UNKNOWN",
          note: facadeAvantNote,
          derived: facadeAvantDerived,
        },
        laterales: {
          min_m: facadeLateralesMinM,
          type: facadeLateralesMinM !== null ? (facadeLateralesDerived ? "DERIVED" : "FIXED") : "UNKNOWN",
          note: facadeLateralesNote,
          derived: facadeLateralesDerived,
        },
        fond: {
          min_m: facadeFondMinM,
          type: facadeFondMinM !== null ? (facadeFondDerived ? "DERIVED" : "FIXED") : "UNKNOWN",
          note: facadeFondNote,
          derived: facadeFondDerived,
        },
      },
    },
    ces: {
      max_ratio: cesMaxRatio,
      note: cesNote,
    },
    hauteur: {
      max_m: hauteurMaxM,
      note: hauteurNote,
    },
    stationnement: {
      par_logement: stationnementParLogement,
      par_100m2: stationnementPar100m2,
      note: stationnementNote,
    },
    notes: allNotes,
    completeness: {
      ok: completenessOk,
      missing: allMissing,
    },
  };

  return resolved;
}

/**
 * Builds a resolved ruleset from AI extraction result data.
 * Supports both NEW format (nested { value, unit } objects) and LEGACY format (direct values).
 * Returns a ResolvedPluRulesetV1 with AI-provided values.
 */
function buildResolvedRulesetFromAi(
  aiData: AiExtractResultData,
  documentId: string,
  communeInsee: string,
  zoneCode: string
): ResolvedPluRulesetV1 {
  // ---- Extract values from NEW FORMAT (nested objects) with LEGACY fallback ----
  
  // Reculs/Implantation: NEW FORMAT (implantation.*) -> LEGACY (reculs.*)
  const voirieValue = pickFirstNumber(
    extractAiValue(aiData.implantation?.recul_voirie),
    aiData.reculs?.voirie?.min_m
  );
  const limitesValue = pickFirstNumber(
    extractAiValue(aiData.implantation?.recul_limites_separatives),
    aiData.reculs?.limites_separatives?.min_m
  );
  const fondParcelleValue = pickFirstNumber(
    extractAiValue(aiData.implantation?.recul_fond_parcelle),
    aiData.reculs?.fond_parcelle?.min_m
  );
  
  // Implantation en limite: NEW FORMAT -> LEGACY
  let implantationEnLimiteAutorisee: boolean | null = null;
  const newFormatImplEnLimite = extractAiBooleanValue(aiData.implantation?.implantation_en_limite);
  if (newFormatImplEnLimite !== null) {
    implantationEnLimiteAutorisee = newFormatImplEnLimite;
  } else {
    implantationEnLimiteAutorisee = safeBoolean(aiData.reculs?.implantation_en_limite?.autorisee);
  }

  // Facades from LEGACY format only (not in new format)
  const aiFacades = aiData.reculs?.facades;
  const facadeAvantMinM = toNumber(aiFacades?.avant?.min_m);
  const facadeLateralesMinM = toNumber(aiFacades?.laterales?.min_m);
  const facadeFondMinM = toNumber(aiFacades?.fond?.min_m);

  // CES: NEW FORMAT (emprise.ces_max) -> LEGACY (ces.max_ratio)
  const cesMaxRatio = pickFirstNumber(
    extractAiValue(aiData.emprise?.ces_max),
    aiData.ces?.max_ratio
  );

  // Hauteur: NEW FORMAT (hauteur.hauteur_max.value) -> LEGACY (hauteur.max_m)
  const hauteurMaxM = pickFirstNumber(
    extractAiValue(aiData.hauteur?.hauteur_max),
    aiData.hauteur?.max_m
  );

  // Stationnement: NEW FORMAT -> LEGACY
  const stationnementParLogement = pickFirstNumber(
    extractAiValue(aiData.stationnement?.places_par_logement),
    aiData.stationnement?.par_logement
  );
  const stationnementPar100m2 = pickFirstNumber(
    extractAiValue(aiData.stationnement?.places_par_m2_commerce),
    aiData.stationnement?.par_100m2
  );

  // Notes from AI
  const allNotes = aiData.notes ?? [];

  // ---- NEW COMPLETENESS: only 3 main reculs matter ----
  const missingBlocking: string[] = [];
  const missingOptional: string[] = [];

  if (voirieValue === null) missingBlocking.push("reculs.voirie.min_m");
  if (limitesValue === null) missingBlocking.push("reculs.limites_separatives.min_m");
  if (fondParcelleValue === null) missingBlocking.push("reculs.fond_parcelle.min_m");

  if (implantationEnLimiteAutorisee === null) missingOptional.push("implantation_en_limite");
  if (stationnementParLogement === null && stationnementPar100m2 === null) missingOptional.push("stationnement");
  if (hauteurMaxM === null) missingOptional.push("hauteur.max_m");
  if (cesMaxRatio === null) missingOptional.push("ces.max_ratio");

  const isActuallyComplete = missingBlocking.length === 0;

  // Build resolved ruleset
  const resolved: ResolvedPluRulesetV1 = {
    version: "plu_ruleset_v1",
    document_id: documentId,
    commune_insee: communeInsee,
    zone_code: zoneCode,
    zone_libelle: aiData.zone_libelle ?? null,
    confidence_score: aiData.confidence_score,
    source: aiData.source ?? "AI_EXTRACTION",
    reculs: {
      voirie: {
        min_m: voirieValue,
        type: voirieValue !== null ? "FIXED" : "UNKNOWN",
        note: safeString(aiData.reculs?.voirie?.note) ?? undefined,
      },
      limites_separatives: {
        min_m: limitesValue,
        type: limitesValue !== null ? "FIXED" : "UNKNOWN",
        note: safeString(aiData.reculs?.limites_separatives?.note) ?? undefined,
      },
      fond_parcelle: {
        min_m: fondParcelleValue,
        type: fondParcelleValue !== null ? "FIXED" : "UNKNOWN",
        note: safeString(aiData.reculs?.fond_parcelle?.note) ?? undefined,
      },
      implantation_en_limite: {
        autorisee: implantationEnLimiteAutorisee,
        note: safeString(aiData.reculs?.implantation_en_limite?.note) ?? undefined,
      },
      facades: {
        avant: {
          min_m: facadeAvantMinM ?? voirieValue,
          type: facadeAvantMinM !== null ? "FIXED" : voirieValue !== null ? "DERIVED" : "UNKNOWN",
          note: safeString(aiFacades?.avant?.note) ?? (facadeAvantMinM === null && voirieValue !== null ? "Dérivé du recul voirie" : undefined),
          derived: facadeAvantMinM === null && voirieValue !== null,
        },
        laterales: {
          min_m: facadeLateralesMinM ?? limitesValue,
          type: facadeLateralesMinM !== null ? "FIXED" : limitesValue !== null ? "DERIVED" : "UNKNOWN",
          note: safeString(aiFacades?.laterales?.note) ?? (facadeLateralesMinM === null && limitesValue !== null ? "Dérivé du recul limites séparatives" : undefined),
          derived: facadeLateralesMinM === null && limitesValue !== null,
        },
        fond: {
          min_m: facadeFondMinM ?? fondParcelleValue,
          type: facadeFondMinM !== null ? "FIXED" : fondParcelleValue !== null ? "DERIVED" : "UNKNOWN",
          note: safeString(aiFacades?.fond?.note) ?? (facadeFondMinM === null && fondParcelleValue !== null ? "Dérivé du recul fond de parcelle" : undefined),
          derived: facadeFondMinM === null && fondParcelleValue !== null,
        },
      },
    },
    ces: {
      max_ratio: cesMaxRatio,
      note: safeString(aiData.ces?.note) ?? (cesMaxRatio === null ? "Non trouvé par l'IA" : undefined),
    },
    hauteur: {
      max_m: hauteurMaxM,
      note: (hauteurMaxM === null ? "Non trouvé par l'IA" : undefined),
    },
    stationnement: {
      par_logement: stationnementParLogement,
      par_100m2: stationnementPar100m2,
      note: safeString(aiData.stationnement?.note) ?? ((stationnementParLogement === null && stationnementPar100m2 === null) ? "Non trouvé par l'IA" : undefined),
    },
    notes: allNotes,
    completeness: {
      ok: isActuallyComplete,
      missing: [
        ...missingBlocking,
        ...missingOptional.map(x => `${x} (optionnel)`)
      ],
    },
  };

  return resolved;
}

/**
 * Builds a resolved ruleset from SQL view plu_front_zone_summary_v1.
 * This is the CANONICAL source for PLU rules (MANUAL/UNIVERSAL).
 */
function buildResolvedFromSqlSummary(
  s: PluFrontZoneSummaryRow,
  documentIdFallback: string | null
): ResolvedPluRulesetV1 {
  const voirieValue = toNumber(s.recul_voirie_min_m);
  const limitesValue = toNumber(s.recul_limites_min_m);
  const fondParcelleValue = toNumber(s.recul_fond_min_m);
  const implantationEnLimiteAutorisee = s.implantation_en_limite_autorisee ?? null;
  const hauteurMaxM = toNumber(s.hauteur_max_m);
  const cesMaxRatio = toNumber(s.ces_max_ratio); // Already a ratio 0–1 from SQL
  const stationnementParLogement = toNumber(s.stationnement_par_logement);
  const stationnementPar100m2 = toNumber(s.stationnement_par_100m2);

  // Build notes array
  const notes: string[] = [];
  if (s.raw_rules_text && s.raw_rules_text.trim()) {
    notes.push(s.raw_rules_text.trim());
  }

  // Completeness check: only 3 main reculs are blocking
  const missingBlocking: string[] = [];
  const missingOptional: string[] = [];

  if (voirieValue === null) missingBlocking.push("reculs.voirie.min_m");
  if (limitesValue === null) missingBlocking.push("reculs.limites_separatives.min_m");
  if (fondParcelleValue === null) missingBlocking.push("reculs.fond_parcelle.min_m");

  if (implantationEnLimiteAutorisee === null) missingOptional.push("implantation_en_limite");
  if (stationnementParLogement === null && stationnementPar100m2 === null) {
    missingOptional.push("stationnement");
  }
  if (hauteurMaxM === null) missingOptional.push("hauteur.max_m");
  if (cesMaxRatio === null) missingOptional.push("ces.max_ratio");

  const completenessOk = missingBlocking.length === 0;

  const resolved: ResolvedPluRulesetV1 = {
    version: "plu_ruleset_v1",
    document_id: documentIdFallback ?? "SQL_CANON",
    commune_insee: s.commune_insee,
    zone_code: s.zone_code,
    zone_libelle: s.zone_libelle,
    confidence_score: 1.0, // SQL canonical data is high confidence
    source: `SQL_${s.source || "CANON"}`,
    reculs: {
      voirie: {
        min_m: voirieValue,
        type: voirieValue !== null ? "FIXED" : "UNKNOWN",
        note: undefined,
      },
      limites_separatives: {
        min_m: limitesValue,
        type: limitesValue !== null ? "FIXED" : "UNKNOWN",
        note: undefined,
      },
      fond_parcelle: {
        min_m: fondParcelleValue,
        type: fondParcelleValue !== null ? "FIXED" : "UNKNOWN",
        note: undefined,
      },
      implantation_en_limite: {
        autorisee: implantationEnLimiteAutorisee,
        note: undefined,
      },
      facades: {
        avant: {
          min_m: voirieValue,
          type: voirieValue !== null ? "DERIVED" : "UNKNOWN",
          note: voirieValue !== null ? "Dérivé du recul voirie (SQL)" : undefined,
          derived: true,
        },
        laterales: {
          min_m: limitesValue,
          type: limitesValue !== null ? "DERIVED" : "UNKNOWN",
          note: limitesValue !== null ? "Dérivé du recul limites séparatives (SQL)" : undefined,
          derived: true,
        },
        fond: {
          min_m: fondParcelleValue,
          type: fondParcelleValue !== null ? "DERIVED" : "UNKNOWN",
          note: fondParcelleValue !== null ? "Dérivé du recul fond de parcelle (SQL)" : undefined,
          derived: true,
        },
      },
    },
    ces: {
      max_ratio: cesMaxRatio,
      note: cesMaxRatio === null ? "Non trouvé dans la vue SQL" : undefined,
    },
    hauteur: {
      max_m: hauteurMaxM,
      note: hauteurMaxM === null ? "Non trouvé dans la vue SQL" : undefined,
    },
    stationnement: {
      par_logement: stationnementParLogement,
      par_100m2: stationnementPar100m2,
      note: s.stationnement_note ?? ((stationnementParLogement === null && stationnementPar100m2 === null) ? "Non trouvé dans la vue SQL" : undefined),
    },
    notes,
    completeness: {
      ok: completenessOk,
      missing: [
        ...missingBlocking,
        ...missingOptional.map(x => `${x} (optionnel)`)
      ],
    },
  };

  return resolved;
}

/**
 * Merges AI-extracted ruleset with base ruleset from plu-rules-list-v1.
 * AI values take priority; falls back to base values when AI returns null.
 */
function mergeRulesets(
  baseRuleset: ResolvedPluRulesetV1,
  aiRuleset: ResolvedPluRulesetV1
): ResolvedPluRulesetV1 {
  // Helper to pick first non-null number
  const pickNumber = (ai: number | null, base: number | null): number | null => {
    return ai !== null ? ai : base;
  };

  // Helper to pick first non-null boolean
  const pickBoolean = (ai: boolean | null, base: boolean | null): boolean | null => {
    return ai !== null ? ai : base;
  };

  // Merge recul values
  const voirieMinM = pickNumber(aiRuleset.reculs.voirie.min_m, baseRuleset.reculs.voirie.min_m);
  const limitesMinM = pickNumber(aiRuleset.reculs.limites_separatives.min_m, baseRuleset.reculs.limites_separatives.min_m);
  const fondParcelleMinM = pickNumber(aiRuleset.reculs.fond_parcelle.min_m, baseRuleset.reculs.fond_parcelle.min_m);
  const implantationEnLimite = pickBoolean(aiRuleset.reculs.implantation_en_limite.autorisee, baseRuleset.reculs.implantation_en_limite.autorisee);

  // Merge facade values
  const facadeAvantMinM = pickNumber(aiRuleset.reculs.facades.avant.min_m, baseRuleset.reculs.facades.avant.min_m);
  const facadeLateralesMinM = pickNumber(aiRuleset.reculs.facades.laterales.min_m, baseRuleset.reculs.facades.laterales.min_m);
  const facadeFondMinM = pickNumber(aiRuleset.reculs.facades.fond.min_m, baseRuleset.reculs.facades.fond.min_m);

  // Merge other values
  const cesMaxRatio = pickNumber(aiRuleset.ces.max_ratio, baseRuleset.ces.max_ratio);
  const hauteurMaxM = pickNumber(aiRuleset.hauteur.max_m, baseRuleset.hauteur.max_m);
  const stationnementParLogement = pickNumber(aiRuleset.stationnement.par_logement, baseRuleset.stationnement.par_logement);
  const stationnementPar100m2 = pickNumber(aiRuleset.stationnement.par_100m2, baseRuleset.stationnement.par_100m2);

  // Recompute completeness based on merged values (only 3 main reculs are blocking)
  const missingBlocking: string[] = [];
  const missingOptional: string[] = [];

  if (voirieMinM === null) missingBlocking.push("reculs.voirie.min_m");
  if (limitesMinM === null) missingBlocking.push("reculs.limites_separatives.min_m");
  if (fondParcelleMinM === null) missingBlocking.push("reculs.fond_parcelle.min_m");

  if (implantationEnLimite === null) missingOptional.push("implantation_en_limite");
  if (stationnementParLogement === null && stationnementPar100m2 === null) {
    missingOptional.push("stationnement");
  }
  if (hauteurMaxM === null) missingOptional.push("hauteur.max_m");
  if (cesMaxRatio === null) missingOptional.push("ces.max_ratio");

  const completenessOk = missingBlocking.length === 0;
  const allMissing = [
    ...missingBlocking,
    ...missingOptional.map(x => `${x} (optionnel)`)
  ];

  // Merge notes (deduplicated)
  const notesSet = new Set<string>();
  for (const n of baseRuleset.notes) notesSet.add(n);
  for (const n of aiRuleset.notes) notesSet.add(n);

  // Build merged ruleset
  const merged: ResolvedPluRulesetV1 = {
    version: "plu_ruleset_v1",
    document_id: aiRuleset.document_id,
    commune_insee: aiRuleset.commune_insee,
    zone_code: aiRuleset.zone_code,
    zone_libelle: aiRuleset.zone_libelle ?? baseRuleset.zone_libelle,
    confidence_score: aiRuleset.confidence_score ?? baseRuleset.confidence_score,
    source: "AI_MERGED",
    reculs: {
      voirie: {
        min_m: voirieMinM,
        type: voirieMinM !== null ? (aiRuleset.reculs.voirie.min_m !== null ? "FIXED" : baseRuleset.reculs.voirie.type) : "UNKNOWN",
        note: aiRuleset.reculs.voirie.note ?? baseRuleset.reculs.voirie.note,
      },
      limites_separatives: {
        min_m: limitesMinM,
        type: limitesMinM !== null ? (aiRuleset.reculs.limites_separatives.min_m !== null ? "FIXED" : baseRuleset.reculs.limites_separatives.type) : "UNKNOWN",
        note: aiRuleset.reculs.limites_separatives.note ?? baseRuleset.reculs.limites_separatives.note,
      },
      fond_parcelle: {
        min_m: fondParcelleMinM,
        type: fondParcelleMinM !== null ? (aiRuleset.reculs.fond_parcelle.min_m !== null ? "FIXED" : baseRuleset.reculs.fond_parcelle.type) : "UNKNOWN",
        note: aiRuleset.reculs.fond_parcelle.note ?? baseRuleset.reculs.fond_parcelle.note,
      },
      implantation_en_limite: {
        autorisee: implantationEnLimite,
        note: aiRuleset.reculs.implantation_en_limite.note ?? baseRuleset.reculs.implantation_en_limite.note,
      },
      facades: {
        avant: {
          min_m: facadeAvantMinM,
          type: facadeAvantMinM !== null ? (aiRuleset.reculs.facades.avant.min_m !== null ? "FIXED" : baseRuleset.reculs.facades.avant.type) : "UNKNOWN",
          note: aiRuleset.reculs.facades.avant.note ?? baseRuleset.reculs.facades.avant.note,
          derived: aiRuleset.reculs.facades.avant.derived ?? baseRuleset.reculs.facades.avant.derived,
        },
        laterales: {
          min_m: facadeLateralesMinM,
          type: facadeLateralesMinM !== null ? (aiRuleset.reculs.facades.laterales.min_m !== null ? "FIXED" : baseRuleset.reculs.facades.laterales.type) : "UNKNOWN",
          note: aiRuleset.reculs.facades.laterales.note ?? baseRuleset.reculs.facades.laterales.note,
          derived: aiRuleset.reculs.facades.laterales.derived ?? baseRuleset.reculs.facades.laterales.derived,
        },
        fond: {
          min_m: facadeFondMinM,
          type: facadeFondMinM !== null ? (aiRuleset.reculs.facades.fond.min_m !== null ? "FIXED" : baseRuleset.reculs.facades.fond.type) : "UNKNOWN",
          note: aiRuleset.reculs.facades.fond.note ?? baseRuleset.reculs.facades.fond.note,
          derived: aiRuleset.reculs.facades.fond.derived ?? baseRuleset.reculs.facades.fond.derived,
        },
      },
    },
    ces: {
      max_ratio: cesMaxRatio,
      note: aiRuleset.ces.note ?? baseRuleset.ces.note,
    },
    hauteur: {
      max_m: hauteurMaxM,
      note: aiRuleset.hauteur.note ?? baseRuleset.hauteur.note,
    },
    stationnement: {
      par_logement: stationnementParLogement,
      par_100m2: stationnementPar100m2,
      note: aiRuleset.stationnement.note ?? baseRuleset.stationnement.note,
    },
    notes: Array.from(notesSet),
    completeness: {
      ok: completenessOk,
      missing: allMissing,
    },
  };

  return merged;
}

/**
 * Page PLU & Faisabilité - Espace Promoteur
 *
 * Cette page permet aux promoteurs de :
 * - Uploader des documents PLU (PDF)
 * - Lancer l'ingestion des PLU uploadés
 * - Consulter les analyses de faisabilité
 * - Détecter la zone PLU correspondant à une parcelle
 * - Extraire les règles PLU via IA pour une zone spécifique
 * - Corriger/compléter manuellement les règles extraites
 */
export default function PluFaisabilite(): React.ReactElement {
  const navigate = useNavigate();

  // Auth state - utilisation du client Supabase
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Documents state
  const [communeInsee, setCommuneInsee] = useState<string>(() => readLS(LS_COMMUNE_INSEE, ""));
  const [documents, setDocuments] = useState<PluDocument[]>([]);
  const [docsStatus, setDocsStatus] = useState<Status>("idle");
  const [docsError, setDocsError] = useState<string | null>(null);

  // Selected document
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  // Rules state
  const [rulesZones, setRulesZones] = useState<PluRulesZoneRow[]>([]);
  const [rulesStatus, setRulesStatus] = useState<Status>("idle");
  const [rulesError, setRulesError] = useState<string | null>(null);

  // SQL Summary state (from plu_front_zone_summary_v1 view)
  const [sqlSummary, setSqlSummary] = useState<PluFrontZoneSummaryRow | null>(null);

  // Zone détectée depuis la parcelle - initialisée depuis LS pour survivre à F5
  const [detectedZoneCode, setDetectedZoneCode] = useState<string | null>(() => {
    const stored = readLS(LS_DETECTED_ZONE_CODE, "");
    return normalizeZoneCode(stored);
  });

  // Zone sélectionnée - initialisée depuis LS avec fallback sur detectedZoneCode
  const [selectedZoneCode, setSelectedZoneCode] = useState<string | null>(() => {
    const stored = readLS(LS_SELECTED_PLU_ZONE_CODE, "");
    const normalized = normalizeZoneCode(stored);
    if (normalized) return normalized;
    const detectedStored = readLS(LS_DETECTED_ZONE_CODE, "");
    return normalizeZoneCode(detectedStored);
  });

  const [detectStatus, setDetectStatus] = useState<Status>("idle");
  const [detectError, setDetectError] = useState<string | null>(null);

  // AI Extraction state
  const [aiExtractStatus, setAiExtractStatus] = useState<Status>("idle");
  const [aiExtractError, setAiExtractError] = useState<string | null>(null);
  const [aiExtractResult, setAiExtractResult] = useState<PersistedAiExtractResult | null>(() => {
    const storedDocId = readLS(LS_SELECTED_PLU_DOCUMENT_ID, "") || null;
    const storedZoneCode = normalizeZoneCode(readLS(LS_SELECTED_PLU_ZONE_CODE, ""));
    return loadPersistedAiExtractResult(storedDocId, storedZoneCode);
  });

  // Active resolved ruleset (explicitly set after AI extraction for immediate update)
  const [activeResolvedRuleset, setActiveResolvedRuleset] = useState<ResolvedPluRulesetV1 | null>(null);

  // User overrides state
  const [userOverridesVersion, setUserOverridesVersion] = useState(0);
  const [editPanelOpen, setEditPanelOpen] = useState(false);

  // Edit form state
  const [editVoirie, setEditVoirie] = useState<string>("");
  const [editLimites, setEditLimites] = useState<string>("");
  const [editFond, setEditFond] = useState<string>("");
  const [editImplantationEnLimite, setEditImplantationEnLimite] = useState<string>("null");
  const [editHauteur, setEditHauteur] = useState<string>("");
  const [editCes, setEditCes] = useState<string>("");
  const [editStatLogement, setEditStatLogement] = useState<string>("");
  const [editStat100m2, setEditStat100m2] = useState<string>("");
  const [editUserNote, setEditUserNote] = useState<string>("");

  // Session parcelle (lue depuis LS) - avec synchro handoff initiale
  const [sessionParcelId, setSessionParcelId] = useState<string | null>(() => {
    syncSessionFromHandoff();
    return readLS(LS_SESSION_PARCEL_ID, "") || null;
  });
  const [sessionCommuneInsee, setSessionCommuneInsee] = useState<string | null>(() => {
    return readLS(LS_SESSION_COMMUNE_INSEE, "") || null;
  });

  // Ref pour suivre la commune courante (évite les problèmes de closure)
  const communeInseeRef = useRef(communeInsee);

  // Ref pour éviter de déclencher auto-detect plusieurs fois
  const autoDetectAttemptedRef = useRef(false);

  useEffect(() => {
    communeInseeRef.current = communeInsee;
  }, [communeInsee]);

  // Auth: récupérer la session et écouter les changements
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Helper pour construire les headers avec le token
  const buildAuthHeaders = useCallback(
    (extra?: Record<string, string>): Record<string, string> => {
      const headers: Record<string, string> = { ...(extra || {}) };

      if (SUPABASE_ANON_KEY) {
        headers.apikey = SUPABASE_ANON_KEY;
      }

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      return headers;
    },
    [accessToken]
  );

  // Fetch SQL Summary from plu_front_zone_summary_v1 view
  const fetchSqlSummary = useCallback(
    async (effectiveInsee: string, zoneCode: string) => {
      if (!effectiveInsee || !zoneCode) {
        setSqlSummary(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("plu_front_zone_summary_v1")
          .select("*")
          .eq("commune_insee", effectiveInsee)
          .eq("zone_code", normalizeZoneCode(zoneCode) ?? zoneCode)
          .order("plu_version_label", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.warn("[PluFaisabilite] SQL Summary fetch error:", error.message);
          setSqlSummary(null);
          return;
        }

        setSqlSummary(data ?? null);

        if (import.meta.env.DEV && data) {
          console.log("[PluFaisabilite] SQL Summary loaded:", {
            commune_insee: data.commune_insee,
            zone_code: data.zone_code,
            source: data.source,
            recul_voirie_min_m: data.recul_voirie_min_m,
            recul_limites_min_m: data.recul_limites_min_m,
            recul_fond_min_m: data.recul_fond_min_m,
          });
        }
      } catch (e) {
        console.warn("[PluFaisabilite] SQL Summary fetch exception:", e);
        setSqlSummary(null);
      }
    },
    []
  );

  // Effect to fetch SQL Summary when zone or commune changes
  useEffect(() => {
    // Determine effective commune INSEE
    const effectiveInsee = isValidCodeInsee(sessionCommuneInsee || "")
      ? sessionCommuneInsee!
      : isValidCodeInsee(communeInsee)
        ? communeInsee
        : null;

    if (!effectiveInsee || !selectedZoneCode) {
      setSqlSummary(null);
      return;
    }

    fetchSqlSummary(effectiveInsee, selectedZoneCode);
  }, [selectedZoneCode, communeInsee, sessionCommuneInsee, fetchSqlSummary]);

  // Fetch documents for commune
  const fetchDocuments = useCallback(
    async (insee: string) => {
      if (!isValidCodeInsee(insee)) {
        setDocuments([]);
        setDocsStatus("idle");
        setDocsError(null);
        setSelectedDocumentId(null);
        setRulesZones([]);
        setRulesStatus("idle");
        setRulesError(null);
        return;
      }

      if (!SUPABASE_ANON_KEY) {
        setDocsError("Configuration manquante : VITE_SUPABASE_ANON_KEY");
        setDocsStatus("error");
        return;
      }

      if (!accessToken) {
        setDocsStatus("idle");
        setDocsError(null);
        return;
      }

      setDocsStatus("loading");
      setDocsError(null);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-documents-list-v1`, {
          method: "POST",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ commune_insee: insee }),
        });

        const txt = await res.text();
        const data = safeJsonParse<DocumentsResponse>(txt) ?? {
          success: false,
          error: "INVALID_JSON",
          message: txt,
        };

        if (!res.ok || !data.success) {
          throw new Error(data.error || data.message || `Erreur ${res.status}`);
        }

        const docs = data.documents || [];
        setDocuments(docs);
        setDocsStatus("success");

        const hasSelected = selectedDocumentId && docs.some((d) => d.id === selectedDocumentId);
        if (!hasSelected) {
          setSelectedDocumentId(docs.length > 0 ? docs[0].id : null);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur lors du chargement des documents.";
        setDocsStatus("error");
        setDocsError(msg);
        setDocuments([]);
        setSelectedDocumentId(null);
        setRulesZones([]);
        setRulesStatus("idle");
        setRulesError(null);
      }
    },
    [accessToken, buildAuthHeaders, selectedDocumentId]
  );

  // Fetch rules for selected document
  const fetchRulesForDocument = useCallback(
    async (docId: string) => {
      if (!docId) {
        setRulesZones([]);
        setRulesStatus("idle");
        setRulesError(null);
        return;
      }

      if (!SUPABASE_ANON_KEY) {
        setRulesError("Configuration manquante : VITE_SUPABASE_ANON_KEY");
        setRulesStatus("error");
        return;
      }

      if (!accessToken) {
        setRulesStatus("idle");
        setRulesError(null);
        return;
      }

      setRulesStatus("loading");
      setRulesError(null);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-rules-list-v1`, {
          method: "POST",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ document_id: docId, limit: 50 }),
        });

        const txt = await res.text();
        const data =
          safeJsonParse<PluRulesListResponse>(txt) ??
          ({
            success: false,
            count: 0,
            error: "INVALID_JSON",
            message: txt,
          } as PluRulesListResponse);

        if (!res.ok || !data.success) {
          throw new Error(data.error || data.message || `Erreur ${res.status}`);
        }

        const zones = data.zones ?? [];
        const filtered = zones.filter((z) => z.document_id === docId);

        setRulesZones(filtered);
        setRulesStatus("success");

        if (filtered.length > 0) {
          const freshSelectedZone = normalizeZoneCode(readLS(LS_SELECTED_PLU_ZONE_CODE, ""));
          const freshDetectedZone = normalizeZoneCode(readLS(LS_DETECTED_ZONE_CODE, ""));

          const currentSelected = freshSelectedZone || selectedZoneCode;
          const currentDetected = freshDetectedZone || detectedZoneCode;

          const currentSelectedValid =
            currentSelected && filtered.some((z) => zonesMatch(z.zone_code, currentSelected));

          const detectedZoneInFiltered =
            currentDetected && filtered.some((z) => zonesMatch(z.zone_code, currentDetected));

          if (currentSelectedValid) {
            if (detectedZoneInFiltered && !zonesMatch(currentSelected, currentDetected)) {
              const matchingZone = filtered.find((z) => zonesMatch(z.zone_code, currentDetected));
              if (matchingZone) {
                setSelectedZoneCode(matchingZone.zone_code);
                writeLS(LS_SELECTED_PLU_ZONE_CODE, matchingZone.zone_code);
              }
            } else if (!zonesMatch(currentSelected, selectedZoneCode)) {
              const matchingZone = filtered.find((z) => zonesMatch(z.zone_code, currentSelected));
              if (matchingZone) {
                setSelectedZoneCode(matchingZone.zone_code);
              }
            }
          } else {
            if (detectedZoneInFiltered) {
              const matchingZone = filtered.find((z) => zonesMatch(z.zone_code, currentDetected));
              if (matchingZone) {
                setSelectedZoneCode(matchingZone.zone_code);
                writeLS(LS_SELECTED_PLU_ZONE_CODE, matchingZone.zone_code);
              }
            } else {
              const meaningfulZone = filtered.find(isZoneMeaningful);
              if (meaningfulZone) {
                setSelectedZoneCode(meaningfulZone.zone_code);
                writeLS(LS_SELECTED_PLU_ZONE_CODE, meaningfulZone.zone_code);
              } else {
                setSelectedZoneCode(filtered[0].zone_code);
                writeLS(LS_SELECTED_PLU_ZONE_CODE, filtered[0].zone_code);
              }
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur lors du chargement des règles.";
        setRulesStatus("error");
        setRulesError(msg);
        setRulesZones([]);
      }
    },
    [accessToken, buildAuthHeaders, selectedZoneCode, detectedZoneCode]
  );

  // Handler pour détecter la zone PLU depuis la parcelle
  const handleDetectZonePlu = useCallback(async () => {
    const parcelId = readLS(LS_SESSION_PARCEL_ID, "");
    const parcelCommune = readLS(LS_SESSION_COMMUNE_INSEE, "");

    const effectiveParcelId = parcelId || sessionParcelId || "";
    const effectiveCommune = parcelCommune || sessionCommuneInsee || "";

    if (!effectiveParcelId) {
      setDetectError(
        "Aucune parcelle sélectionnée. Veuillez d'abord sélectionner une parcelle dans Foncier."
      );
      setDetectStatus("error");
      return;
    }

    if (!effectiveCommune) {
      setDetectError("Code INSEE de la commune manquant dans la session.");
      setDetectStatus("error");
      return;
    }

    if (!accessToken) {
      setDetectError("Connexion requise.");
      setDetectStatus("error");
      return;
    }

    setDetectStatus("loading");
    setDetectError(null);

    const requestBody = { parcel_id: effectiveParcelId, commune_insee: effectiveCommune };

    try {
      let res = await fetch(`${SUPABASE_URL}/functions/v1/plu-from-parcelle-v2`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(requestBody),
      });

      if (res.status === 404) {
        res = await fetch(`${SUPABASE_URL}/functions/v1/plu-from-parcelle`, {
          method: "POST",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(requestBody),
        });
      }

      const txt = await res.text();
      const data = safeJsonParse<Record<string, unknown>>(txt);

      if (!res.ok) {
        throw new Error(
          (data?.error as string) || (data?.message as string) || `Erreur ${res.status}`
        );
      }

      let rawZoneCode: string | null = null;

      if (typeof data?.zone_code === "string" && data.zone_code.trim()) {
        rawZoneCode = data.zone_code;
      } else if (
        typeof data?.plu === "object" &&
        data.plu !== null &&
        typeof (data.plu as Record<string, unknown>).zone_code === "string"
      ) {
        rawZoneCode = (data.plu as Record<string, unknown>).zone_code as string;
      } else if (typeof data?.zone === "string" && data.zone.trim()) {
        rawZoneCode = data.zone;
      } else if (
        typeof data?.plu === "object" &&
        data.plu !== null &&
        typeof (data.plu as Record<string, unknown>).zone === "string"
      ) {
        rawZoneCode = (data.plu as Record<string, unknown>).zone as string;
      } else if (typeof data?.data === "object" && data.data !== null) {
        const innerData = data.data as Record<string, unknown>;
        if (typeof innerData.zone_code === "string" && innerData.zone_code.trim()) {
          rawZoneCode = innerData.zone_code;
        } else if (
          typeof innerData.plu === "object" &&
          innerData.plu !== null &&
          typeof (innerData.plu as Record<string, unknown>).zone_code === "string"
        ) {
          rawZoneCode = (innerData.plu as Record<string, unknown>).zone_code as string;
        } else if (typeof innerData.zone === "string" && innerData.zone.trim()) {
          rawZoneCode = innerData.zone;
        }
      } else if (typeof data?.result === "object" && data.result !== null) {
        const resultData = data.result as Record<string, unknown>;
        if (typeof resultData.zone_code === "string" && resultData.zone_code.trim()) {
          rawZoneCode = resultData.zone_code;
        } else if (typeof resultData.zone === "string" && resultData.zone.trim()) {
          rawZoneCode = resultData.zone;
        }
      }

      const zoneCode = normalizeZoneCode(rawZoneCode);

      if (!zoneCode) {
        throw new Error(
          "Zone PLU non trouvée pour cette parcelle. La réponse de l'API ne contient pas de zone_code valide."
        );
      }

      const matchingZone = rulesZones.find((z) => zonesMatch(z.zone_code, zoneCode));
      const finalZoneCode = matchingZone?.zone_code ?? zoneCode;

      setDetectedZoneCode(finalZoneCode);
      setSelectedZoneCode(finalZoneCode);

      writeLS(LS_DETECTED_ZONE_CODE, finalZoneCode);
      writeLS(LS_SELECTED_PLU_ZONE_CODE, finalZoneCode);

      setDetectStatus("success");
      setDetectError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors de la détection de la zone PLU.";
      setDetectStatus("error");
      setDetectError(msg);
    }
  }, [accessToken, buildAuthHeaders, sessionParcelId, sessionCommuneInsee, rulesZones]);

  // Handler pour extraire les règles PLU via le parser local
  const handleAiExtractZone = useCallback(async () => {
    if (!selectedDocumentId) {
      setAiExtractError("Veuillez d'abord sélectionner un document PLU.");
      setAiExtractStatus("error");
      return;
    }

    if (!selectedZoneCode) {
      setAiExtractError("Veuillez d'abord sélectionner ou détecter une zone PLU.");
      setAiExtractStatus("error");
      return;
    }

    const selectedDoc = documents.find((d) => d.id === selectedDocumentId);
    const effectiveCommuneInsee = communeInsee || sessionCommuneInsee || selectedDoc?.commune_insee;
    if (!effectiveCommuneInsee) {
      setAiExtractError("Code INSEE de la commune manquant.");
      setAiExtractStatus("error");
      return;
    }

    // Get PDF URL from document
    const sourcePdfUrl = extractPdfUrlFromDocument(selectedDoc);
    if (!sourcePdfUrl) {
      setAiExtractError(
        "URL PDF du PLU introuvable — impossible d'appeler le parser local. " +
        "Vérifiez que le document possède une URL source valide (source_pdf_url, public_url, signed_url, pdf_url)."
      );
      setAiExtractStatus("error");
      return;
    }

    setAiExtractStatus("loading");
    setAiExtractError(null);

    // Build request body for the parser
    const requestBody = {
      commune_insee: effectiveCommuneInsee,
      commune_nom: selectedDoc?.commune_nom ?? selectedDoc?.commune_name ?? null,
      source_pdf_url: sourcePdfUrl,
      target_zone_code: selectedZoneCode,
    };

    try {
      if (import.meta.env.DEV) {
        console.log("[PLU][AI_EXTRACT] Calling parser with:", {
          endpoint: AI_EXTRACT_ENDPOINT,
          body: requestBody,
        });
      }

      const res = await fetch(AI_EXTRACT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test", // API key optional in dev
        },
        body: JSON.stringify(requestBody),
      });

      const txt = await res.text();
      const rawData = safeJsonParse<PluParserResponse>(txt);

      if (import.meta.env.DEV) {
        console.log("[PLU][AI_EXTRACT] Parser response:", rawData);
      }

      if (!res.ok) {
        const errorMsg = typeof rawData?.error === "string" 
          ? rawData.error 
          : `Erreur ${res.status}: ${txt.substring(0, 200)}`;
        throw new Error(errorMsg);
      }

      // Parse zones_rulesets from parser response
      const zonesRulesets = rawData?.zones_rulesets;

      if (!zonesRulesets || !Array.isArray(zonesRulesets) || zonesRulesets.length === 0) {
        throw new Error("Réponse du parser invalide : aucun ruleset de zone trouvé dans zones_rulesets.");
      }

      // Find matching zone (case-insensitive)
      const matchingZone = zonesRulesets.find((z) => 
        zonesMatch(z.zone_code, selectedZoneCode)
      );

      if (!matchingZone) {
        const availableZones = zonesRulesets
          .map(z => z.zone_code)
          .filter(Boolean)
          .join(", ");
        throw new Error(
          `Zone ${selectedZoneCode} non trouvée dans la réponse du parser. ` +
          `Zones disponibles : ${availableZones || "(aucune)"}`
        );
      }

      const ruleset = matchingZone.ruleset ?? {};

      // Convert parser ruleset to AiExtractResultData
      const normalizedAiData = convertParserRulesetToAiExtractResult(
        ruleset,
        matchingZone.zone_libelle ?? null
      );

      if (import.meta.env.DEV) {
        console.log("[PLU][AI_EXTRACT] Converted to AiExtractResultData:", normalizedAiData);
      }

      const persistedResult: PersistedAiExtractResult = {
        document_id: selectedDocumentId,
        zone_code: selectedZoneCode,
        commune_insee: effectiveCommuneInsee,
        extracted_at: new Date().toISOString(),
        data: normalizedAiData,
      };

      writeLS(LS_PLU_AI_EXTRACT_RESULT, JSON.stringify(persistedResult));
      setAiExtractResult(persistedResult);

      const aiRuleset = buildResolvedRulesetFromAi(
        normalizedAiData,
        selectedDocumentId,
        effectiveCommuneInsee,
        selectedZoneCode
      );

      const baseZoneData = rulesZones.find((z) => zonesMatch(z.zone_code, selectedZoneCode));

      let finalRuleset: ResolvedPluRulesetV1;
      if (baseZoneData) {
        const baseRuleset = resolvePluRulesetV1(baseZoneData);
        finalRuleset = mergeRulesets(baseRuleset, aiRuleset);
      } else {
        finalRuleset = aiRuleset;
      }

      // Apply user overrides if they exist
      const userOverrideEntry = getUserOverrideEntry(selectedDocumentId, selectedZoneCode);
      if (userOverrideEntry) {
        finalRuleset = applyUserOverrides(finalRuleset, userOverrideEntry.overrides);
      }

      setActiveResolvedRuleset(finalRuleset);
      writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(finalRuleset));

      setAiExtractStatus("success");
      setAiExtractError(null);

      if (selectedZoneCode) {
        writeLS(LS_SELECTED_PLU_ZONE_CODE, selectedZoneCode);
      }

      if (import.meta.env.DEV) {
        console.log("[PluFaisabilite] Parser extraction success:", {
          endpoint: AI_EXTRACT_ENDPOINT,
          document_id: selectedDocumentId,
          zone_code: selectedZoneCode,
          completeness_ok: normalizedAiData.completeness_ok,
          missing_count: normalizedAiData.missing.length,
          finalRuleset,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors de l'extraction via le parser.";
      setAiExtractStatus("error");
      setAiExtractError(msg);
    }
  }, [
    selectedDocumentId,
    selectedZoneCode,
    documents,
    communeInsee,
    sessionCommuneInsee,
    rulesZones,
  ]);

  // Clear AI extract result and active ruleset when zone or document changes
  useEffect(() => {
    if (aiExtractResult) {
      if (
        aiExtractResult.document_id !== selectedDocumentId ||
        !zonesMatch(aiExtractResult.zone_code, selectedZoneCode)
      ) {
        setAiExtractResult(null);
        setActiveResolvedRuleset(null);
        setAiExtractStatus("idle");
        setAiExtractError(null);
      }
    } else {
      if (activeResolvedRuleset && !zonesMatch(activeResolvedRuleset.zone_code, selectedZoneCode)) {
        setActiveResolvedRuleset(null);
      }
    }
  }, [selectedDocumentId, selectedZoneCode, aiExtractResult, activeResolvedRuleset]);

  // Synchronisation localStorage (même onglet + multi-onglets)
  useEffect(() => {
    const syncFromLS = () => {
      const handoffResult = syncSessionFromHandoff();

      const currentInsee = readLS(LS_COMMUNE_INSEE, "");
      const sessionInsee = readLS(LS_SESSION_COMMUNE_INSEE, "");
      const sessionParcel = readLS(LS_SESSION_PARCEL_ID, "");

      const effectiveParcelId = sessionParcel || handoffResult.parcelId || null;
      const effectiveCommuneInsee = sessionInsee || handoffResult.communeInsee || null;

      setSessionParcelId(effectiveParcelId);
      setSessionCommuneInsee(effectiveCommuneInsee);

      const storedDetectedZone = normalizeZoneCode(readLS(LS_DETECTED_ZONE_CODE, ""));
      if (storedDetectedZone && !zonesMatch(storedDetectedZone, detectedZoneCode)) {
        setDetectedZoneCode(storedDetectedZone);
      }

      const effectiveInsee = isValidCodeInsee(effectiveCommuneInsee || "")
        ? effectiveCommuneInsee!
        : isValidCodeInsee(currentInsee)
          ? currentInsee
          : "";

      if (effectiveInsee && effectiveInsee !== communeInseeRef.current) {
        setCommuneInsee(effectiveInsee);
        writeLS(LS_COMMUNE_INSEE, effectiveInsee);
      }
    };

    const interval = window.setInterval(syncFromLS, 1500);

    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === LS_COMMUNE_INSEE ||
        e.key === LS_SESSION_COMMUNE_INSEE ||
        e.key === LS_SESSION_PARCEL_ID ||
        e.key === LS_DETECTED_ZONE_CODE ||
        e.key === LS_SELECTED_PARCELS_V1
      ) {
        syncFromLS();
      }
    };

    window.addEventListener("storage", handleStorage);
    syncFromLS();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
    };
  }, [detectedZoneCode]);

  // Chargement des documents quand communeInsee change ET utilisateur authentifié
  useEffect(() => {
    if (communeInsee && accessToken) {
      fetchDocuments(communeInsee);
    } else {
      setDocuments([]);
      setDocsStatus("idle");
      setDocsError(null);
      setSelectedDocumentId(null);
      setRulesZones([]);
      setRulesStatus("idle");
      setRulesError(null);
    }
  }, [communeInsee, accessToken, fetchDocuments]);

  // Load rules when selectedDocumentId changes ET utilisateur authentifié
  useEffect(() => {
    if (!selectedDocumentId || !accessToken) {
      setRulesZones([]);
      setRulesStatus("idle");
      setRulesError(null);
      return;
    }
    fetchRulesForDocument(selectedDocumentId);
  }, [selectedDocumentId, accessToken, fetchRulesForDocument]);

  // Auto-detect zone PLU une seule fois si conditions réunies
  useEffect(() => {
    if (autoDetectAttemptedRef.current) return;

    const freshParcelId = readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId;
    const freshCommuneInsee = readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee;

    const shouldAutoDetect =
      accessToken &&
      freshParcelId &&
      freshCommuneInsee &&
      detectStatus === "idle" &&
      !detectedZoneCode &&
      rulesStatus === "success" &&
      selectedDocumentId &&
      rulesZones.length > 0;

    if (shouldAutoDetect) {
      autoDetectAttemptedRef.current = true;
      const timer = setTimeout(() => {
        handleDetectZonePlu();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [
    accessToken,
    sessionParcelId,
    sessionCommuneInsee,
    detectStatus,
    detectedZoneCode,
    rulesStatus,
    selectedDocumentId,
    rulesZones.length,
    handleDetectZonePlu,
  ]);

  const selectedDoc = useMemo(
    () => (selectedDocumentId ? documents.find((d) => d.id === selectedDocumentId) ?? null : null),
    [documents, selectedDocumentId]
  );

  // Compute base resolved ruleset from plu-rules-list-v1 for the selected zone
  const baseResolvedRuleset = useMemo<ResolvedPluRulesetV1 | null>(() => {
    if (!selectedZoneCode || rulesZones.length === 0) return null;
    const selectedZoneData = rulesZones.find((z) => zonesMatch(z.zone_code, selectedZoneCode));
    if (!selectedZoneData) return null;
    return resolvePluRulesetV1(selectedZoneData);
  }, [selectedZoneCode, rulesZones]);

  // Compute AI-based resolved ruleset if AI extraction result is available
  const aiResolvedRuleset = useMemo<ResolvedPluRulesetV1 | null>(() => {
    if (!aiExtractResult || !aiExtractResult.data) return null;
    if (aiExtractResult.document_id !== selectedDocumentId) return null;
    if (!zonesMatch(aiExtractResult.zone_code, selectedZoneCode)) return null;

    return buildResolvedRulesetFromAi(
      aiExtractResult.data,
      aiExtractResult.document_id,
      aiExtractResult.commune_insee,
      aiExtractResult.zone_code
    );
  }, [aiExtractResult, selectedDocumentId, selectedZoneCode]);

  // Get current user overrides for the selected document/zone
  const currentUserOverrides = useMemo<UserOverrideEntry | null>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _version = userOverridesVersion; // Force re-computation when overrides change
    return getUserOverrideEntry(selectedDocumentId, selectedZoneCode);
  }, [selectedDocumentId, selectedZoneCode, userOverridesVersion]);

  // Final resolved ruleset with user overrides applied
  // PRIORITY: SQL_CANON > activeResolvedRuleset > merge(base, ai) > ai > base
  const resolvedRuleset = useMemo<ResolvedPluRulesetV1 | null>(() => {
    // HIGHEST PRIORITY: SQL canonical data from plu_front_zone_summary_v1
    if (sqlSummary && zonesMatch(sqlSummary.zone_code, selectedZoneCode)) {
      const fromSql = buildResolvedFromSqlSummary(sqlSummary, selectedDocumentId);
      
      if (import.meta.env.DEV) {
        console.log("[PluFaisabilite] Using SQL_CANON source:", {
          zone_code: sqlSummary.zone_code,
          source: fromSql.source,
          voirie: fromSql.reculs.voirie.min_m,
          limites: fromSql.reculs.limites_separatives.min_m,
          fond: fromSql.reculs.fond_parcelle.min_m,
        });
      }

      // Apply user overrides if they exist
      if (currentUserOverrides) {
        return applyUserOverrides(fromSql, currentUserOverrides.overrides);
      }
      return fromSql;
    }

    // Fallback: existing logic (activeResolvedRuleset > merge(base, ai) > ai > base)
    let baseResolved: ResolvedPluRulesetV1 | null = null;

    if (activeResolvedRuleset && zonesMatch(activeResolvedRuleset.zone_code, selectedZoneCode)) {
      baseResolved = activeResolvedRuleset;
    } else if (aiResolvedRuleset && baseResolvedRuleset) {
      baseResolved = mergeRulesets(baseResolvedRuleset, aiResolvedRuleset);
    } else if (aiResolvedRuleset) {
      baseResolved = aiResolvedRuleset;
    } else if (baseResolvedRuleset) {
      baseResolved = baseResolvedRuleset;
    }

    if (!baseResolved) return null;

    // Apply user overrides (highest priority)
    if (currentUserOverrides) {
      return applyUserOverrides(baseResolved, currentUserOverrides.overrides);
    }

    return baseResolved;
  }, [
    sqlSummary,
    selectedZoneCode,
    selectedDocumentId,
    activeResolvedRuleset,
    baseResolvedRuleset,
    aiResolvedRuleset,
    currentUserOverrides,
  ]);

  // ============================================
  // SNAPSHOT PERSISTENCE HELPER
  // ============================================
  
  /**
   * Persiste l'état PLU dans le snapshot global mimmoza.promoteur.snapshot.v1
   * Non bloquant - échoue silencieusement en cas d'erreur
   */
  const persistPluToSnapshot = useCallback(() => {
    try {
      // --- A) Persist project info (best effort) ---
      const effectiveParcelId = sessionParcelId || readLS(LS_SESSION_PARCEL_ID, "") || undefined;
      const effectiveCommuneInsee = sessionCommuneInsee || readLS(LS_SESSION_COMMUNE_INSEE, "") || undefined;
      const effectiveAddress = readLS(LS_SESSION_ADDRESS, "") || undefined;

      if (effectiveParcelId || effectiveCommuneInsee || effectiveAddress) {
        patchPromoteurSnapshot({
          project: {
            parcelId: effectiveParcelId,
            commune_insee: effectiveCommuneInsee,
            address: effectiveAddress,
          },
        });
      }

      // --- B) Persist module plu ---
      if (resolvedRuleset) {
        const voirieStr = resolvedRuleset.reculs.voirie.min_m !== null 
          ? `${resolvedRuleset.reculs.voirie.min_m}` 
          : "?";
        const limitesStr = resolvedRuleset.reculs.limites_separatives.min_m !== null 
          ? `${resolvedRuleset.reculs.limites_separatives.min_m}` 
          : "?";
        const fondStr = resolvedRuleset.reculs.fond_parcelle.min_m !== null 
          ? `${resolvedRuleset.reculs.fond_parcelle.min_m}` 
          : "?";
        
        const summary = `Zone ${resolvedRuleset.zone_code} · Reculs voirie ${voirieStr}m / limites ${limitesStr}m / fond ${fondStr}m · Source ${resolvedRuleset.source ?? "?"}`;

        patchModule("plu", {
          ok: resolvedRuleset.completeness?.ok === true,
          summary,
          data: {
            document_id: selectedDocumentId,
            commune_insee: resolvedRuleset.commune_insee,
            zone_code: resolvedRuleset.zone_code,
            zone_libelle: resolvedRuleset.zone_libelle,
            confidence_score: resolvedRuleset.confidence_score,
            source: resolvedRuleset.source,
            ruleset: resolvedRuleset, // IMPORTANT: stocker le ruleset complet
            detectedZoneCode,
            selectedZoneCode,
            aiExtractResult,
            sqlSummary,
            currentUserOverrides,
            session: {
              parcel_id: effectiveParcelId || null,
              commune_insee: effectiveCommuneInsee || null,
              address: effectiveAddress || null,
            },
          },
        });

        if (import.meta.env.DEV) {
          console.log("[PluFaisabilite] Snapshot persisted:", {
            ok: resolvedRuleset.completeness?.ok,
            zone_code: resolvedRuleset.zone_code,
            source: resolvedRuleset.source,
          });
        }
      }
    } catch (e) {
      // Non bloquant - log uniquement en dev
      if (import.meta.env.DEV) {
        console.warn("[PluFaisabilite] Snapshot persistence error:", e);
      }
    }
  }, [
    resolvedRuleset,
    selectedDocumentId,
    selectedZoneCode,
    detectedZoneCode,
    sessionParcelId,
    sessionCommuneInsee,
    aiExtractResult,
    sqlSummary,
    currentUserOverrides,
  ]);

  // ============================================
  // SNAPSHOT PERSISTENCE EFFECT
  // ============================================
  
  useEffect(() => {
    persistPluToSnapshot();
  }, [
    resolvedRuleset,
    selectedDocumentId,
    selectedZoneCode,
    detectedZoneCode,
    sessionParcelId,
    sessionCommuneInsee,
    aiExtractResult,
    sqlSummary,
    currentUserOverrides,
    persistPluToSnapshot,
  ]);

  // Initialize edit form with current values when panel opens or resolved ruleset changes
  useEffect(() => {
    if (editPanelOpen && resolvedRuleset) {
      setEditVoirie(
        resolvedRuleset.reculs.voirie.min_m !== null
          ? String(resolvedRuleset.reculs.voirie.min_m)
          : ""
      );
      setEditLimites(
        resolvedRuleset.reculs.limites_separatives.min_m !== null
          ? String(resolvedRuleset.reculs.limites_separatives.min_m)
          : ""
      );
      setEditFond(
        resolvedRuleset.reculs.fond_parcelle.min_m !== null
          ? String(resolvedRuleset.reculs.fond_parcelle.min_m)
          : ""
      );
      setEditImplantationEnLimite(
        resolvedRuleset.reculs.implantation_en_limite.autorisee === null
          ? "null"
          : resolvedRuleset.reculs.implantation_en_limite.autorisee
            ? "true"
            : "false"
      );
      setEditHauteur(
        resolvedRuleset.hauteur.max_m !== null ? String(resolvedRuleset.hauteur.max_m) : ""
      );
      setEditCes(
        resolvedRuleset.ces.max_ratio !== null
          ? String(Math.round(resolvedRuleset.ces.max_ratio * 100))
          : ""
      );
      setEditStatLogement(
        resolvedRuleset.stationnement.par_logement !== null
          ? String(resolvedRuleset.stationnement.par_logement)
          : ""
      );
      setEditStat100m2(
        resolvedRuleset.stationnement.par_100m2 !== null
          ? String(resolvedRuleset.stationnement.par_100m2)
          : ""
      );

      // Load existing user note if present
      const existingUserNote = resolvedRuleset.notes.find((n) =>
        n.startsWith("[Note utilisateur]")
      );
      if (existingUserNote) {
        setEditUserNote(existingUserNote.replace("[Note utilisateur] ", ""));
      } else {
        setEditUserNote("");
      }
    }
  }, [editPanelOpen, resolvedRuleset]);

  // Handler to save user overrides
  const handleSaveOverrides = useCallback(() => {
    if (!selectedDocumentId || !selectedZoneCode) return;

    const overrides: UserOverrideValues = {
      reculs: {
        voirie_min_m: editVoirie.trim() ? toNumber(editVoirie) : undefined,
        limites_separatives_min_m: editLimites.trim() ? toNumber(editLimites) : undefined,
        fond_parcelle_min_m: editFond.trim() ? toNumber(editFond) : undefined,
        implantation_en_limite_autorisee:
          editImplantationEnLimite === "null"
            ? undefined
            : editImplantationEnLimite === "true"
              ? true
              : false,
      },
      ces_max_ratio: editCes.trim() ? (toNumber(editCes) ?? 0) / 100 : undefined,
      hauteur_max_m: editHauteur.trim() ? toNumber(editHauteur) : undefined,
      stationnement_par_logement: editStatLogement.trim() ? toNumber(editStatLogement) : undefined,
      stationnement_par_100m2: editStat100m2.trim() ? toNumber(editStat100m2) : undefined,
      notes_append: editUserNote.trim() || undefined,
    };

    // Clean undefined values from reculs
    if (overrides.reculs.voirie_min_m === undefined) delete overrides.reculs.voirie_min_m;
    if (overrides.reculs.limites_separatives_min_m === undefined)
      delete overrides.reculs.limites_separatives_min_m;
    if (overrides.reculs.fond_parcelle_min_m === undefined)
      delete overrides.reculs.fond_parcelle_min_m;
    if (overrides.reculs.implantation_en_limite_autorisee === undefined)
      delete overrides.reculs.implantation_en_limite_autorisee;
    if (overrides.ces_max_ratio === undefined) delete overrides.ces_max_ratio;
    if (overrides.hauteur_max_m === undefined) delete overrides.hauteur_max_m;
    if (overrides.stationnement_par_logement === undefined)
      delete overrides.stationnement_par_logement;
    if (overrides.stationnement_par_100m2 === undefined) delete overrides.stationnement_par_100m2;
    if (overrides.notes_append === undefined) delete overrides.notes_append;

    const entry: UserOverrideEntry = {
      updated_at: new Date().toISOString(),
      overrides,
    };

    const allOverrides = loadUserOverrides();
    const key = getUserOverrideKey(selectedDocumentId, selectedZoneCode);
    allOverrides[key] = entry;
    saveUserOverrides(allOverrides);

    // Force re-computation
    setUserOverridesVersion((v) => v + 1);

    // Update localStorage for handoff
    if (resolvedRuleset) {
      const updatedRuleset = applyUserOverrides(resolvedRuleset, overrides);
      writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(updatedRuleset));
      setActiveResolvedRuleset(updatedRuleset);
    }

    setEditPanelOpen(false);
  }, [
    selectedDocumentId,
    selectedZoneCode,
    editVoirie,
    editLimites,
    editFond,
    editImplantationEnLimite,
    editHauteur,
    editCes,
    editStatLogement,
    editStat100m2,
    editUserNote,
    resolvedRuleset,
  ]);

  // Handler to reset user overrides
  const handleResetOverrides = useCallback(() => {
    if (!selectedDocumentId || !selectedZoneCode) return;

    const allOverrides = loadUserOverrides();
    const key = getUserOverrideKey(selectedDocumentId, selectedZoneCode);
    delete allOverrides[key];
    saveUserOverrides(allOverrides);

    setUserOverridesVersion((v) => v + 1);
    setActiveResolvedRuleset(null);
    setEditPanelOpen(false);
  }, [selectedDocumentId, selectedZoneCode]);

  // Check if we can launch Implantation 2D (now less strict - just needs a ruleset)
  const canLaunchImplantation2D = useMemo(() => {
    return (
      Boolean(selectedDocumentId) &&
      Boolean(communeInsee) &&
      Boolean(selectedZoneCode) &&
      rulesStatus === "success" &&
      rulesZones.length > 0 &&
      resolvedRuleset !== null
    );
  }, [
    selectedDocumentId,
    communeInsee,
    selectedZoneCode,
    rulesStatus,
    rulesZones.length,
    resolvedRuleset,
  ]);

  const canAiExtract = useMemo(() => {
    const doc = selectedDocumentId ? documents.find((d) => d.id === selectedDocumentId) : null;
    const resolvedCommuneInsee = communeInsee || sessionCommuneInsee || doc?.commune_insee;
    const hasPdfUrl = extractPdfUrlFromDocument(doc) !== null;

    return (
      Boolean(selectedDocumentId) && 
      Boolean(selectedZoneCode) && 
      Boolean(resolvedCommuneInsee) &&
      hasPdfUrl
    );
  }, [selectedDocumentId, selectedZoneCode, documents, communeInsee, sessionCommuneInsee]);

  const handleLaunchImplantation2D = useCallback(() => {
    if (!selectedDocumentId) {
      window.alert("Veuillez sélectionner un document PLU avant de lancer l'Implantation 2D.");
      return;
    }

    if (!communeInsee) {
      window.alert("Code INSEE de la commune manquant. Veuillez sélectionner une commune.");
      return;
    }

    if (!selectedZoneCode) {
      window.alert(
        "Aucune zone PLU sélectionnée. Veuillez détecter ou sélectionner une zone avant de continuer."
      );
      return;
    }

    if (!resolvedRuleset) {
      window.alert("Impossible de résoudre le ruleset pour la zone sélectionnée.");
      return;
    }

    // Non-blocking warning if reculs are missing
    const missingReculs: string[] = [];
    if (resolvedRuleset.reculs.voirie.min_m === null) missingReculs.push("voirie");
    if (resolvedRuleset.reculs.limites_separatives.min_m === null)
      missingReculs.push("limites séparatives");
    if (resolvedRuleset.reculs.fond_parcelle.min_m === null) missingReculs.push("fond de parcelle");

    if (missingReculs.length > 0) {
      const proceed = window.confirm(
        `⚠️ Certains reculs sont manquants : ${missingReculs.join(", ")}.\n\n` +
          `Vous pouvez les compléter dans le panneau "Modifier / Compléter les règles" avant de continuer.\n\n` +
          `Voulez-vous continuer quand même ?`
      );
      if (!proceed) return;
    }

    writeLS(LS_SELECTED_PLU_DOCUMENT_ID, selectedDocumentId);
    writeLS(LS_SELECTED_PLU_COMMUNE_INSEE, communeInsee);
    writeLS(LS_SELECTED_PLU_ZONE_CODE, selectedZoneCode);
    writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(resolvedRuleset));

    const freshParcelId = readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId || "";
    const freshCommuneInsee = readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee || "";

    if (freshParcelId) {
      writeLS(LS_SESSION_PARCEL_ID, freshParcelId);
    }
    if (freshCommuneInsee) {
      writeLS(LS_SESSION_COMMUNE_INSEE, freshCommuneInsee);
    }

    // Persist snapshot before navigation
    persistPluToSnapshot();

    const queryParams = new URLSearchParams();
    if (freshParcelId) {
      queryParams.set("parcel_id", freshParcelId);
    }
    if (freshCommuneInsee) {
      queryParams.set("commune_insee", freshCommuneInsee);
    }
    const queryString = queryParams.toString();

    navigate(`/promoteur/implantation-2d${queryString ? `?${queryString}` : ""}`, {
      state: { pluRuleset: resolvedRuleset },
    });
  }, [
    selectedDocumentId,
    communeInsee,
    selectedZoneCode,
    resolvedRuleset,
    sessionParcelId,
    sessionCommuneInsee,
    navigate,
    persistPluToSnapshot,
  ]);

  const handleGoToLogin = useCallback(() => {
    navigate("/login");
  }, [navigate]);

  const meaningfulZonesCount = useMemo(() => {
    return rulesZones.filter(isZoneMeaningful).length;
  }, [rulesZones]);

  const detectedZoneExists = useMemo(() => {
    if (!detectedZoneCode) return false;
    return rulesZones.some((z) => zonesMatch(z.zone_code, detectedZoneCode));
  }, [detectedZoneCode, rulesZones]);

  const canDetectZone = useMemo(() => {
    const freshParcelId = readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId;
    const freshCommuneInsee = readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee;
    return Boolean(accessToken) && Boolean(freshParcelId) && Boolean(freshCommuneInsee);
  }, [accessToken, sessionParcelId, sessionCommuneInsee]);

  const isZoneMeaningfulWithResolved = useCallback(
    (z: PluRulesZoneRow): boolean => {
      if (
        aiExtractResult &&
        zonesMatch(aiExtractResult.zone_code, z.zone_code) &&
        aiExtractResult.document_id === selectedDocumentId
      ) {
        return true;
      }

      if (
        resolvedRuleset &&
        selectedZoneCode &&
        zonesMatch(z.zone_code, selectedZoneCode) &&
        zonesMatch(resolvedRuleset.zone_code, z.zone_code)
      ) {
        if (resolvedRuleset.completeness.ok) {
          return true;
        }
        if (isResolvedRulesetMeaningful(resolvedRuleset)) {
          return true;
        }
      }
      return isZoneMeaningful(z);
    },
    [resolvedRuleset, selectedZoneCode, aiExtractResult, selectedDocumentId]
  );

  return (
    <div className="plu-faisabilite-page">
      <style>{pageStyles}</style>

      <header className="page-header">
        <h1 className="page-title">PLU & Faisabilité</h1>
        <p className="page-description">
          Gérez vos documents PLU et analysez la faisabilité de vos projets immobiliers.
        </p>
        <div className="env-badge">
          <span className="env-pill">
            Supabase: {SUPABASE_URL.includes("127.0.0.1") ? "LOCAL" : "REMOTE"}
          </span>
          <span className="env-pill" style={{ marginLeft: 8 }}>
            Parser: {AI_EXTRACT_ENDPOINT.includes("localhost") ? "LOCAL" : "REMOTE"}
          </span>
        </div>
      </header>

      {!accessToken && (
        <section className="page-section">
          <div className="auth-required-card">
            <span className="auth-icon">🔒</span>
            <h3 className="auth-title">Connexion requise</h3>
            <p className="auth-text">
              Vous devez être connecté pour accéder aux analyses de faisabilité.
            </p>
            <button className="auth-login-btn" onClick={handleGoToLogin}>
              Se connecter
            </button>
          </div>
        </section>
      )}

      <section className="page-section">
        <PluUploaderPanel />
      </section>

      <section className="page-section">
        <div className="placeholder-card">
          <div className="section-header">
            <h3 className="placeholder-title">📊 Analyses de faisabilité</h3>

            <div className="analysis-actions">
              <button
                className="secondary-btn"
                onClick={handleDetectZonePlu}
                disabled={!canDetectZone || detectStatus === "loading"}
                title={
                  !accessToken
                    ? "Connexion requise"
                    : !sessionParcelId && !readLS(LS_SESSION_PARCEL_ID, "")
                      ? "Sélectionnez une parcelle dans Foncier"
                      : "Détecter la zone PLU de la parcelle"
                }
              >
                {detectStatus === "loading" ? "Détection…" : "Détecter zone PLU"}
              </button>

              <button
                className="ai-extract-btn"
                onClick={handleAiExtractZone}
                disabled={!canAiExtract || aiExtractStatus === "loading"}
                title={
                  !selectedDocumentId
                    ? "Sélectionnez un document PLU"
                    : !selectedZoneCode
                      ? "Sélectionnez ou détectez une zone PLU"
                      : !extractPdfUrlFromDocument(selectedDoc)
                        ? "Document sans URL PDF source"
                        : "Extraire les règles PLU via le parser local"
                }
              >
                {aiExtractStatus === "loading" ? (
                  <>
                    <span className="ai-spinner">⏳</span> Extraction…
                  </>
                ) : (
                  <>
                    <span className="ai-icon">🤖</span> Extraire règles IA
                  </>
                )}
              </button>

              <button
                className="primary-btn"
                onClick={handleLaunchImplantation2D}
                disabled={!canLaunchImplantation2D || !accessToken}
                title={
                  !accessToken
                    ? "Connexion requise"
                    : !selectedDocumentId
                      ? "Sélectionnez un document PLU"
                      : !selectedZoneCode
                        ? "Sélectionnez ou détectez une zone PLU"
                        : !canLaunchImplantation2D
                          ? "Chargez les règles du document"
                          : "Lancer l'Implantation 2D"
                }
              >
                Lancer l'Implantation 2D
              </button>
            </div>
          </div>

          <p className="placeholder-text">
            Le document sélectionné sera utilisé dans l'Implantation 2D.
            {selectedDoc ? (
              <>
                {" "}
                Document : <code>{selectedDoc.id}</code>
              </>
            ) : null}
          </p>

          {(sessionParcelId || readLS(LS_SESSION_PARCEL_ID, "")) && (
            <div className="session-info">
              <span className="session-label">Parcelle active :</span>
              <code className="session-value">
                {sessionParcelId || readLS(LS_SESSION_PARCEL_ID, "")}
              </code>
              {(sessionCommuneInsee || readLS(LS_SESSION_COMMUNE_INSEE, "")) && (
                <>
                  <span className="session-separator">—</span>
                  <span className="session-label">Commune :</span>
                  <code className="session-value">
                    {sessionCommuneInsee || readLS(LS_SESSION_COMMUNE_INSEE, "")}
                  </code>
                </>
              )}
            </div>
          )}

          {detectedZoneCode && (
            <div className="detected-zone-info">
              <span className="detected-badge">Zone détectée : {detectedZoneCode}</span>
              {!detectedZoneExists && rulesZones.length > 0 && (
                <span className="detected-warning">
                  ⚠️ La zone détectée ({detectedZoneCode}) n'est pas présente dans les règles de ce
                  document. Vérifiez le document PLU sélectionné.
                </span>
              )}
            </div>
          )}

          {/* User Override Edit Panel */}
          {selectedDocumentId && selectedZoneCode && resolvedRuleset && (
            <div className="user-override-panel">
              <div className="user-override-warning">
                <span className="warning-icon">⚠️</span>
                <span className="warning-text">
                  Les règles affichées proviennent d'une extraction automatisée et peuvent comporter
                  des erreurs ou des omissions. Nous vous invitons à relire attentivement le PLU.
                </span>
              </div>

              <button className="toggle-edit-btn" onClick={() => setEditPanelOpen(!editPanelOpen)}>
                {editPanelOpen ? "▲ Fermer le formulaire" : "✏️ Modifier / Compléter les règles"}
              </button>

              {currentUserOverrides && (
                <div className="user-override-indicator">
                  <span className="override-badge">✅ Corrections utilisateur appliquées</span>
                  <span className="override-time">
                    Modifié le {new Date(currentUserOverrides.updated_at).toLocaleString("fr-FR")}
                  </span>
                </div>
              )}

              {editPanelOpen && (
                <div className="edit-form">
                  <div className="edit-form-grid">
                    <div className="edit-form-field">
                      <label className="edit-label">Recul voirie (m)</label>
                      <input
                        type="text"
                        className="edit-input"
                        value={editVoirie}
                        onChange={(e) => setEditVoirie(e.target.value)}
                        placeholder="ex: 5"
                      />
                    </div>

                    <div className="edit-form-field">
                      <label className="edit-label">Recul limites séparatives (m)</label>
                      <input
                        type="text"
                        className="edit-input"
                        value={editLimites}
                        onChange={(e) => setEditLimites(e.target.value)}
                        placeholder="ex: 3"
                      />
                    </div>

                    <div className="edit-form-field">
                      <label className="edit-label">Recul fond de parcelle (m)</label>
                      <input
                        type="text"
                        className="edit-input"
                        value={editFond}
                        onChange={(e) => setEditFond(e.target.value)}
                        placeholder="ex: 6"
                      />
                    </div>

                    <div className="edit-form-field">
                      <label className="edit-label">Implantation en limite</label>
                      <select
                        className="edit-select"
                        value={editImplantationEnLimite}
                        onChange={(e) => setEditImplantationEnLimite(e.target.value)}
                      >
                        <option value="null">Non déterminable</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </select>
                    </div>

                    <div className="edit-form-field">
                      <label className="edit-label">
                        Hauteur max (m) <span className="optional-tag">optionnel</span>
                      </label>
                      <input
                        type="text"
                        className="edit-input"
                        value={editHauteur}
                        onChange={(e) => setEditHauteur(e.target.value)}
                        placeholder="ex: 12"
                      />
                    </div>

                    <div className="edit-form-field">
                      <label className="edit-label">
                        CES max (%) <span className="optional-tag">optionnel</span>
                      </label>
                      <input
                        type="text"
                        className="edit-input"
                        value={editCes}
                        onChange={(e) => setEditCes(e.target.value)}
                        placeholder="ex: 40"
                      />
                    </div>

                    <div className="edit-form-field">
                      <label className="edit-label">
                        Stationnement / logement <span className="optional-tag">optionnel</span>
                      </label>
                      <input
                        type="text"
                        className="edit-input"
                        value={editStatLogement}
                        onChange={(e) => setEditStatLogement(e.target.value)}
                        placeholder="ex: 1.5"
                      />
                    </div>

                    <div className="edit-form-field">                  <label className="edit-label">
                    Stationnement / 100m² <span className="optional-tag">optionnel</span>
                  </label>
                  <input
                    type="text"
                    className="edit-input"
                    value={editStat100m2}
                    onChange={(e) => setEditStat100m2(e.target.value)}
                    placeholder="ex: 2"
                  />
                </div>
              </div>

              <div className="edit-form-field edit-form-field--full">
                <label className="edit-label">
                  Note utilisateur <span className="optional-tag">optionnel</span>
                </label>
                <textarea
                  className="edit-textarea"
                  value={editUserNote}
                  onChange={(e) => setEditUserNote(e.target.value)}
                  placeholder="Ajoutez une note personnelle..."
                  rows={2}
                />
              </div>

              <div className="edit-form-actions">
                <button className="save-btn" onClick={handleSaveOverrides}>
                  💾 Enregistrer
                </button>
                {currentUserOverrides && (
                  <button className="reset-btn" onClick={handleResetOverrides}>
                    🗑️ Réinitialiser mes corrections
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {(aiExtractResult || aiExtractStatus === "error") && (
        <div
          className={`ai-extract-result-card ${aiExtractResult?.data?.completeness_ok ? "ai-extract-result-card--complete" : "ai-extract-result-card--incomplete"}`}
        >
          <div className="ai-extract-result-header">
            <span className="ai-extract-result-icon">🤖</span>
            <span className="ai-extract-result-title">
              Règles IA (zone {aiExtractResult?.zone_code || selectedZoneCode})
            </span>
            {aiExtractResult && (
              <span className="ai-extract-result-time">
                Extrait le {new Date(aiExtractResult.extracted_at).toLocaleString("fr-FR")}
              </span>
            )}
          </div>

          {aiExtractStatus === "error" && aiExtractError && (
            <div className="ai-extract-error">
              <span className="ai-extract-error-icon">❌</span>
              <span className="ai-extract-error-text">{aiExtractError}</span>
            </div>
          )}

          {aiExtractResult?.data && (
            <div className="ai-extract-result-content">
              <div className="ai-extract-result-row">
                <span className="ai-extract-result-label">Complétude :</span>
                <span
                  className={`ai-extract-result-value ${aiExtractResult.data.completeness_ok && aiExtractResult.data.missing.length === 0 ? "ai-extract-value--ok" : "ai-extract-value--ko"}`}
                >
                  {aiExtractResult.data.completeness_ok &&
                  aiExtractResult.data.missing.length === 0
                    ? "✅ Complet"
                    : `⚠️ Incomplet (${aiExtractResult.data.missing.length} champ${aiExtractResult.data.missing.length > 1 ? "s" : ""} manquant${aiExtractResult.data.missing.length > 1 ? "s" : ""})`}
                </span>
              </div>

              {aiExtractResult.data.confidence_score !== null && (
                <div className="ai-extract-result-row">
                  <span className="ai-extract-result-label">Confiance IA :</span>
                  <span className="ai-extract-result-value">
                    {Math.round(aiExtractResult.data.confidence_score * 100)}%
                  </span>
                </div>
              )}

              {aiExtractResult.data.error && (
                <div className="ai-extract-result-row">
                  <span className="ai-extract-result-label">Erreur IA :</span>
                  <span className="ai-extract-result-value ai-extract-value--error">
                    {aiExtractResult.data.error}
                  </span>
                </div>
              )}

              {aiExtractResult.data.missing && aiExtractResult.data.missing.length > 0 && (
                <div className="ai-extract-missing">
                  <span className="ai-extract-missing-title">Champs manquants :</span>
                  <ul className="ai-extract-missing-list">
                    {aiExtractResult.data.missing.map((m, i) => {
                      const isNonBlocking = m.includes("(optionnel)");
                      return (
                        <li
                          key={i}
                          className={
                            isNonBlocking ? "ai-missing-non-blocking" : "ai-missing-blocking"
                          }
                        >
                          {m.replace(" (optionnel)", "")}
                          {isNonBlocking && (
                            <span className="ai-missing-tag">optionnel</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {resolvedRuleset && !resolvedRuleset.completeness.ok && !aiExtractResult && (
        <div className="completeness-warning">
          <span className="completeness-icon">⚠️</span>
          <div className="completeness-content">
            <strong>Règles incomplètes pour la zone {selectedZoneCode}</strong>
            <ul className="completeness-list">
              {resolvedRuleset.completeness.missing.map((m, i) => (
                <li
                  key={i}
                  className={m.includes("(optionnel)") ? "non-blocking" : "blocking"}
                >
                  {m.replace(" (optionnel)", "")}
                  {m.includes("(optionnel)") && (
                    <span className="non-blocking-tag">optionnel</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="completeness-hint">
              💡 Utilisez le bouton « Modifier / Compléter les règles » pour saisir les données
              manquantes.
            </p>
          </div>
        </div>
      )}

      {detectError && <p className="detect-error-text">{detectError}</p>}

      {!accessToken ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">🔒</span>
          <span>Connectez-vous pour accéder aux analyses de faisabilité.</span>
          <button className="auth-login-btn-small" onClick={handleGoToLogin}>
            Se connecter
          </button>
        </div>
      ) : !communeInsee ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">🔍</span>
          <span>Sélectionnez une commune, puis un document PLU.</span>
        </div>
      ) : docsStatus === "loading" ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">⏳</span>
          <span>Chargement des documents…</span>
        </div>
      ) : docsError ? (
        <>
          <p className="error-text">{docsError}</p>
          <div className="placeholder-empty">
            <span className="placeholder-icon">⚠️</span>
            <span>Erreur lors du chargement des documents</span>
          </div>
        </>
      ) : documents.length === 0 ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">📂</span>
          <span>Aucun document PLU disponible pour cette commune.</span>
        </div>
      ) : !selectedDocumentId ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">📄</span>
          <span>Sélectionnez un document PLU ci-dessus.</span>
        </div>
      ) : rulesStatus === "loading" ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">⏳</span>
          <span>Chargement des règles…</span>
        </div>
      ) : rulesError ? (
        <>
          <p className="error-text">{rulesError}</p>
          <div className="placeholder-empty">
            <span className="placeholder-icon">⚠️</span>
            <span>Erreur lors du chargement des règles</span>
          </div>
        </>
      ) : rulesZones.length === 0 ? (
        <div className="placeholder-empty">
          <span className="placeholder-icon">📄</span>
          <span>Aucune règle normalisée trouvée pour ce document.</span>
        </div>
      ) : (
        <>
          <div className="rules-toolbar">
            <div className="rules-toolbar-left">
              <span className="rules-count">
                {rulesZones.length} zone{rulesZones.length > 1 ? "s" : ""} normalisée
                {rulesZones.length > 1 ? "s" : ""}
                {meaningfulZonesCount < rulesZones.length && (
                  <span className="rules-count-detail">
                    {" "}
                    ({meaningfulZonesCount} avec règles exploitables)
                  </span>
                )}
              </span>
            </div>

            <div className="rules-toolbar-right">
              <label className="rules-select-label">
                Zone :
                <select
                  className="rules-select"
                  value={selectedZoneCode ?? ""}
                  onChange={(e) => {
                    const newZone = e.target.value || null;
                    setSelectedZoneCode(newZone);
                    if (newZone) {
                      writeLS(LS_SELECTED_PLU_ZONE_CODE, newZone);
                    }
                    setAiExtractResult(null);
                    setActiveResolvedRuleset(null);
                    setAiExtractStatus("idle");
                    setAiExtractError(null);
                    setEditPanelOpen(false);
                  }}
                >
                  {rulesZones.map((z) => {
                    const isMeaningful = isZoneMeaningfulWithResolved(z);
                    const libelle = getZoneLibelle(z);
                    const isDetected = zonesMatch(z.zone_code, detectedZoneCode);
                    return (
                      <option key={`${z.document_id}:${z.zone_code}`} value={z.zone_code}>
                        {z.zone_code} {libelle !== "Non trouvé" ? `— ${libelle}` : ""}
                        {isDetected ? " ★" : ""}
                        {!isMeaningful ? " (vide)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
          </div>

          <div className="rules-zones">
            {rulesZones
              .filter((z) =>
                selectedZoneCode ? zonesMatch(z.zone_code, selectedZoneCode) : true
              )
              .map((z) => {
                const useResolved =
                  resolvedRuleset &&
                  selectedZoneCode &&
                  zonesMatch(z.zone_code, selectedZoneCode) &&
                  zonesMatch(resolvedRuleset.zone_code, z.zone_code);

                let voirieValue: number | null;
                let limitesValue: number | null;
                let fondParcelleValue: number | null;
                let implantationEnLimiteAutorisee: boolean | null;
                let facadeAvantDisplay: string;
                let facadeLateralesDisplay: string;
                let facadeFondDisplay: string;
                let stationnementLogementValue: number | null;
                let stationnement100m2Value: number | null;
                let hauteurMaxValue: number | null;
                let cesDisplay: string;
                let notes: string[];
                let confidenceScore: number | null;
                let source: string | null;

                if (useResolved) {
                  voirieValue = resolvedRuleset.reculs.voirie.min_m;
                  limitesValue = resolvedRuleset.reculs.limites_separatives.min_m;
                  fondParcelleValue = resolvedRuleset.reculs.fond_parcelle.min_m;
                  implantationEnLimiteAutorisee =
                    resolvedRuleset.reculs.implantation_en_limite.autorisee;
                  facadeAvantDisplay = formatResolvedFacade(
                    resolvedRuleset.reculs.facades.avant
                  );
                  facadeLateralesDisplay = formatResolvedFacade(
                    resolvedRuleset.reculs.facades.laterales
                  );
                  facadeFondDisplay = formatResolvedFacade(resolvedRuleset.reculs.facades.fond);
                  stationnementLogementValue = resolvedRuleset.stationnement.par_logement;
                  stationnement100m2Value = resolvedRuleset.stationnement.par_100m2;
                  hauteurMaxValue = resolvedRuleset.hauteur.max_m;
                  if (resolvedRuleset.ces.max_ratio !== null) {
                    cesDisplay = `${Math.round(resolvedRuleset.ces.max_ratio * 100)} %`;
                  } else {
                    cesDisplay = "Non trouvé";
                  }
                  notes = resolvedRuleset.notes;
                  confidenceScore = resolvedRuleset.confidence_score;
                  source = resolvedRuleset.source;
                } else {
                  const impl = z.rules.implantation;
                  const fac = impl?.facades;
                  const ruleset = z.ruleset;
                  const reculs = z.rules.reculs;

                  voirieValue = pickFirstNumber(
                    z.retrait_voirie_min_m,
                    impl?.recul_voirie_min_m,
                    reculs?.voirie?.min_m,
                    getRulesetValue(ruleset, "reculs", "voirie", "min_m")
                  );

                  limitesValue = pickFirstNumber(
                    z.retrait_limites_separatives_min_m,
                    impl?.recul_limite_separative_min_m,
                    reculs?.limites_separatives?.min_m,
                    getRulesetValue(ruleset, "reculs", "limites_separatives", "min_m")
                  );

                  fondParcelleValue = pickFirstNumber(
                    z.retrait_fond_parcelle_min_m,
                    impl?.recul_fond_parcelle_min_m,
                    reculs?.fond_parcelle?.min_m,
                    getRulesetValue(ruleset, "reculs", "fond_parcelle", "min_m")
                  );

                  implantationEnLimiteAutorisee = impl?.implantation_en_limite_autorisee ?? null;

                  facadeAvantDisplay = formatFacade(fac?.avant);
                  facadeLateralesDisplay = formatFacade(fac?.laterales);
                  facadeFondDisplay = formatFacade(fac?.fond);

                  stationnementLogementValue = pickFirstNumber(
                    z.places_par_logement,
                    z.rules?.stationnement?.places_par_logement
                  );

                  stationnement100m2Value = pickFirstNumber(
                    z.places_par_100m2,
                    z.rules?.stationnement?.places_par_100m2
                  );

                  hauteurMaxValue = toNumber(z.rules.hauteur?.hauteur_max_m);

                  const cesPercent = toNumber(z.rules.emprise?.ces_max_percent);
                  cesDisplay = cesPercent !== null ? `${cesPercent} %` : "Non trouvé";

                  notes = collectNotes(z.rules.meta?.notes, ruleset, z.rules);
                  confidenceScore = z.confidence_score;
                  source = z.source;
                }

                const isEmptyZone = !isZoneMeaningfulWithResolved(z);
                const zoneLibelle =
                  useResolved && resolvedRuleset.zone_libelle
                    ? resolvedRuleset.zone_libelle
                    : getZoneLibelle(z);
                const isDetectedZone = zonesMatch(z.zone_code, detectedZoneCode);
                const hasAiData =
                  aiExtractResult &&
                  zonesMatch(aiExtractResult.zone_code, z.zone_code) &&
                  aiExtractResult?.data;
                const hasUserOverrides =
                  currentUserOverrides && zonesMatch(z.zone_code, selectedZoneCode);
                const hasSqlData =
                  sqlSummary && zonesMatch(sqlSummary.zone_code, z.zone_code);

                return (
                  <div
                    key={`${z.document_id}:${z.zone_code}:${z.created_at}`}
                    className={`rule-zone-card ${isDetectedZone ? "rule-zone-card--detected" : ""} ${hasAiData ? "rule-zone-card--ai" : ""} ${hasUserOverrides ? "rule-zone-card--user" : ""} ${hasSqlData ? "rule-zone-card--sql" : ""}`}
                  >
                    <div className="rule-zone-header">
                      <div className="rule-zone-title">
                        <span className="zone-pill">{z.zone_code}</span>
                        <span className="zone-libelle">{zoneLibelle}</span>
                        {isDetectedZone && (
                          <span className="zone-detected-badge" title="Zone de la parcelle">
                            ★ Parcelle
                          </span>
                        )}
                        {hasSqlData && (
                          <span className="zone-sql-badge" title="Source SQL canonique">
                            🗄️ SQL
                          </span>
                        )}
                        {hasAiData && !hasSqlData && (
                          <span className="zone-ai-badge" title="Enrichi par IA">
                            🤖 IA
                          </span>
                        )}
                        {hasUserOverrides && (
                          <span className="zone-user-badge" title="Corrigé par l'utilisateur">
                            ✏️ Corrigé
                          </span>
                        )}
                        {isEmptyZone && !hasAiData && !hasUserOverrides && !hasSqlData && (
                          <span
                            className="zone-empty-badge"
                            title="Aucune règle exploitable"
                          >
                            Zone vide
                          </span>
                        )}
                      </div>

                      <div className="rule-zone-meta">
                        <span
                          className="confidence-pill"
                          title="Score de confiance heuristique"
                        >
                          Confiance : {formatMaybeNumber(confidenceScore, "%")}
                        </span>
                        <span className="source-pill" title="Source de normalisation">
                          {source || "Non trouvé"}
                        </span>
                      </div>
                    </div>

                    {isEmptyZone && !hasAiData && !hasUserOverrides && !hasSqlData && (
                      <div className="zone-empty-message">
                        Aucune règle exploitable extraite pour cette zone dans ce document.
                        <br />
                        <span className="zone-empty-hint">
                          💡 Utilisez « Modifier / Compléter les règles » pour saisir les
                          données manuellement.
                        </span>
                      </div>
                    )}

                    <div className="rule-grid">
                      <div className="rule-cell">
                        <div className="rule-label">Voirie</div>
                        <div className="rule-value">
                          {formatMaybeNumber(voirieValue, "m")}
                        </div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Limites séparatives</div>
                        <div className="rule-value">
                          {formatMaybeNumber(limitesValue, "m")}
                        </div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Implantation en limite</div>
                        <div className="rule-value">
                          {formatBool(implantationEnLimiteAutorisee)}
                        </div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Façade avant</div>
                        <div className="rule-value">{facadeAvantDisplay}</div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Façades latérales</div>
                        <div className="rule-value">{facadeLateralesDisplay}</div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Façade fond</div>
                        <div className="rule-value">{facadeFondDisplay}</div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Fond de parcelle</div>
                        <div className="rule-value">
                          {formatMaybeNumber(fondParcelleValue, "m")}
                        </div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">CES</div>
                        <div className="rule-value">{cesDisplay}</div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Hauteur max</div>
                        <div className="rule-value">
                          {formatMaybeNumber(hauteurMaxValue, "m")}
                        </div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Stationnement / logement</div>
                        <div className="rule-value">
                          {formatMaybeNumber(stationnementLogementValue, "")}
                        </div>
                      </div>

                      <div className="rule-cell">
                        <div className="rule-label">Stationnement / 100m²</div>
                        <div className="rule-value">
                          {formatMaybeNumber(stationnement100m2Value, "")}
                        </div>
                      </div>
                    </div>

                    {notes.length > 0 ? (
                      <div className="rule-notes">
                        <div className="rule-notes-title">Notes</div>
                        <ul className="rule-notes-list">
                          {notes.slice(0, 10).map((n, idx) => (
                            <li key={`${z.zone_code}:${idx}`}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  </section>
</div>
);
}


// ============================================
// Styles de la page
// ============================================
const pageStyles = `
.plu-faisabilite-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  margin-bottom: 32px;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary, #111827);
  margin: 0 0 8px 0;
}

.page-description {
  font-size: 1rem;
  color: var(--text-secondary, #6b7280);
  margin: 0;
}

.env-badge {
  margin-top: 12px;
}

.env-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--bg-muted, #f9fafb);
  border: 1px solid var(--border-color, #e5e7eb);
  color: var(--text-secondary, #6b7280);
  font-size: 0.75rem;
}

.page-section {
  margin-bottom: 24px;
}

.auth-required-card {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fbbf24;
  border-radius: 12px;
  padding: 32px 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.auth-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 16px;
}

.auth-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #92400e;
  margin: 0 0 8px 0;
}

.auth-text {
  font-size: 0.9375rem;
  color: #a16207;
  margin: 0 0 16px 0;
}

.auth-login-btn {
  display: inline-block;
  padding: 10px 24px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #ffffff;
  background: #92400e;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.auth-login-btn:hover {
  background: #78350f;
}

.auth-login-btn-small {
  display: inline-block;
  margin-top: 12px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  background: #111827;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.auth-login-btn-small:hover {
  opacity: 0.9;
}

.placeholder-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
  flex-wrap: wrap;
}

.primary-btn {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--text-primary, #111827);
  color: white;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  border: 1px solid var(--border-color, #e5e7eb);
  background: var(--card-bg, #ffffff);
  color: var(--text-primary, #111827);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  transition: background 0.15s, border-color 0.15s;
}

.secondary-btn:hover:not(:disabled) {
  background: var(--bg-muted, #f9fafb);
  border-color: var(--text-secondary, #6b7280);
}

.secondary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-extract-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(139, 92, 246, 0.4);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(167, 139, 250, 0.12) 100%);
  color: #7c3aed;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}

.ai-extract-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(167, 139, 250, 0.2) 100%);
  border-color: rgba(139, 92, 246, 0.6);
  transform: translateY(-1px);
}

.ai-extract-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.ai-icon {
  font-size: 1rem;
}

.ai-spinner {
  font-size: 1rem;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.analysis-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.placeholder-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary, #111827);
  margin: 0;
}

.placeholder-text {
  font-size: 0.875rem;
  color: var(--text-secondary, #6b7280);
  margin: 0 0 16px 0;
}

.placeholder-text code {
  font-family: monospace;
  font-size: 0.75rem;
  background: var(--code-bg, #f3f4f6);
  padding: 2px 6px;
  border-radius: 6px;
}

.error-text {
  font-size: 0.875rem;
  color: #b91c1c;
  margin: 0 0 16px 0;
}

.placeholder-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  background: var(--bg-muted, #f9fafb);
  border-radius: 8px;
  color: var(--text-muted, #9ca3af);
  font-size: 0.875rem;
  gap: 12px;
}

.placeholder-icon {
  font-size: 2.5rem;
  opacity: 0.5;
}

.session-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  font-size: 0.8125rem;
}

.session-label {
  color: var(--text-secondary, #6b7280);
}

.session-value {
  font-family: monospace;
  font-size: 0.75rem;
  background: var(--code-bg, #f3f4f6);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-primary, #111827);
}

.session-separator {
  color: var(--text-muted, #9ca3af);
}

.detected-zone-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.detected-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #047857;
  font-size: 0.8125rem;
  font-weight: 600;
}

.detected-warning {
  font-size: 0.75rem;
  color: #b45309;
  max-width: 400px;
  line-height: 1.4;
}

.detect-error-text {
  font-size: 0.875rem;
  color: #b91c1c;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: rgba(185, 28, 28, 0.08);
  border: 1px solid rgba(185, 28, 28, 0.2);
  border-radius: 8px;
}

.user-override-panel {
  margin: 16px 0;
  padding: 16px;
  background: rgba(59, 130, 246, 0.04);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 10px;
}

.user-override-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 8px;
}

.warning-icon {
  font-size: 1.125rem;
  flex-shrink: 0;
}

.warning-text {
  font-size: 0.8125rem;
  color: #92400e;
  line-height: 1.5;
}

.toggle-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.toggle-edit-btn:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.5);
}

.user-override-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.override-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #047857;
  font-size: 0.75rem;
  font-weight: 600;
}

.override-time {
  font-size: 0.75rem;
  color: var(--text-muted, #9ca3af);
}

.edit-form {
  margin-top: 16px;
  padding: 16px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
}

.edit-form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 768px) {
  .edit-form-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.edit-form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.edit-form-field--full {
  grid-column: 1 / -1;
  margin-top: 8px;
}

.edit-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary, #6b7280);
}

.optional-tag {
  font-weight: 400;
  font-style: italic;
  color: var(--text-muted, #9ca3af);
}

.edit-input,
.edit-select {
  padding: 8px 10px;
  font-size: 0.875rem;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  background: var(--card-bg, #ffffff);
  color: var(--text-primary, #111827);
}

.edit-input:focus,
.edit-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.edit-textarea {
  padding: 8px 10px;
  font-size: 0.875rem;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  background: var(--card-bg, #ffffff);
  color: var(--text-primary, #111827);
  resize: vertical;
  min-height: 60px;
}

.edit-textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.edit-form-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  background: #10b981;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.save-btn:hover {
  background: #059669;
}

.reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #b91c1c;
  background: rgba(185, 28, 28, 0.08);
  border: 1px solid rgba(185, 28, 28, 0.25);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.reset-btn:hover {
  background: rgba(185, 28, 28, 0.12);
  border-color: rgba(185, 28, 28, 0.4);
}

.ai-extract-result-card {
  margin-bottom: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(139, 92, 246, 0.3);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.04) 0%, rgba(167, 139, 250, 0.08) 100%);
}

.ai-extract-result-card--complete {
  border-color: rgba(16, 185, 129, 0.4);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(52, 211, 153, 0.08) 100%);
}

.ai-extract-result-card--incomplete {
  border-color: rgba(245, 158, 11, 0.4);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, rgba(251, 191, 36, 0.08) 100%);
}

.ai-extract-result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.ai-extract-result-icon {
  font-size: 1.25rem;
}

.ai-extract-result-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary, #111827);
}

.ai-extract-result-time {
  font-size: 0.75rem;
  color: var(--text-muted, #9ca3af);
  margin-left: auto;
}

.ai-extract-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(185, 28, 28, 0.08);
  border: 1px solid rgba(185, 28, 28, 0.2);
  border-radius: 8px;
  margin-bottom: 10px;
}

.ai-extract-error-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.ai-extract-error-text {
  font-size: 0.8125rem;
  color: #b91c1c;
  line-height: 1.4;
}

.ai-extract-result-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-extract-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-extract-result-label {
  font-size: 0.8125rem;
  color: var(--text-secondary, #6b7280);
  min-width: 100px;
}

.ai-extract-result-value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #111827);
}

.ai-extract-value--ok {
  color: #047857;
}

.ai-extract-value--ko {
  color: #b45309;
}

.ai-extract-value--error {
  color: #b91c1c;
  font-weight: 400;
}

.ai-extract-missing {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color, #e5e7eb);
}

.ai-extract-missing-title {
  font-size: 0.75rem;
  color: var(--text-secondary, #6b7280);
  font-weight: 600;
  margin-bottom: 6px;
}

.ai-extract-missing-list {
  margin: 0;
  padding-left: 18px;
  font-size: 0.8125rem;
}

.ai-extract-missing-list li {
  margin-bottom: 3px;
}

.ai-missing-blocking {
  color: #b91c1c;
  font-weight: 500;
}

.ai-missing-non-blocking {
  color: #6b7280;
  font-style: italic;
}

.ai-missing-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 0.625rem;
  background: rgba(107, 114, 128, 0.15);
  border-radius: 4px;
  font-style: normal;
  font-weight: 500;
}

.completeness-warning {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 16px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
}

.completeness-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.completeness-content {
  flex: 1;
}

.completeness-content strong {
  display: block;
  font-size: 0.875rem;
  color: #92400e;
  margin-bottom: 8px;
}

.completeness-list {
  margin: 0 0 8px 0;
  padding-left: 18px;
  font-size: 0.8125rem;
  color: #b45309;
}

.completeness-list li {
  margin-bottom: 4px;
}

.completeness-list li.blocking {
  color: #b91c1c;
  font-weight: 600;
}

.completeness-list li.non-blocking {
  color: #6b7280;
  font-style: italic;
}

.completeness-hint {
  font-size: 0.8125rem;
  color: #92400e;
  margin: 8px 0 0 0;
  padding-top: 8px;
  border-top: 1px dashed rgba(245, 158, 11, 0.3);
}

.non-blocking-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 0.6875rem;
  background: rgba(107, 114, 128, 0.15);
  border-radius: 4px;
  font-style: normal;
  font-weight: 500;
}

.rules-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.rules-count {
  font-size: 0.8125rem;
  color: var(--text-secondary, #6b7280);
}

.rules-count-detail {
  color: var(--text-muted, #9ca3af);
  font-style: italic;
}

.rules-select-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary, #6b7280);
}

.rules-select {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 6px 10px;
  background: var(--card-bg, #ffffff);
  color: var(--text-primary, #111827);
}

.rules-zones {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rule-zone-card {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 16px;
  background: var(--bg-muted, #f9fafb);
}

.rule-zone-card--detected {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.04);
}

.rule-zone-card--ai {
  border-color: rgba(139, 92, 246, 0.4);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.02) 0%, rgba(167, 139, 250, 0.04) 100%);
}

.rule-zone-card--sql {
  border-color: rgba(34, 197, 94, 0.5);
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.04) 0%, rgba(74, 222, 128, 0.06) 100%);
}

.rule-zone-card--user {
  border-color: rgba(59, 130, 246, 0.4);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.02) 0%, rgba(96, 165, 250, 0.04) 100%);
}

.rule-zone-card--detected.rule-zone-card--ai {
  border-color: rgba(16, 185, 129, 0.4);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(139, 92, 246, 0.04) 100%);
}

.rule-zone-card--detected.rule-zone-card--sql {
  border-color: rgba(16, 185, 129, 0.4);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(34, 197, 94, 0.04) 100%);
}

.rule-zone-card--detected.rule-zone-card--user {
  border-color: rgba(16, 185, 129, 0.4);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(59, 130, 246, 0.04) 100%);
}

.rule-zone-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.rule-zone-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.zone-pill {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.25);
  color: var(--text-primary, #111827);
  font-size: 0.75rem;
  font-weight: 700;
}

.zone-libelle {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary, #111827);
}

.zone-detected-badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #047857;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.zone-ai-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  color: #7c3aed;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.zone-sql-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #16a34a;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.zone-user-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #1d4ed8;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.zone-empty-badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #b45309;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.zone-empty-message {
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 0.8125rem;
  color: #92400e;
  font-style: italic;
}

.zone-empty-hint {
  display: block;
  margin-top: 6px;
  font-style: normal;
  font-weight: 500;
}

.rule-zone-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.confidence-pill,
.source-pill {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e5e7eb);
  color: var(--text-secondary, #6b7280);
  font-size: 0.75rem;
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (min-width: 900px) {
  .rule-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.rule-cell {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
}

.rule-label {
  font-size: 0.75rem;
  color: var(--text-muted, #9ca3af);
  margin-bottom: 6px;
}

.rule-value {
  font-size: 0.875rem;
  color: var(--text-primary, #111827);
  font-weight: 600;
}

.rule-notes {
  margin-top: 12px;
  background: var(--card-bg, #ffffff);
  border: 1px dashed var(--border-color, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
}

.rule-notes-title {
  font-size: 0.75rem;
  color: var(--text-muted, #9ca3af);
  margin-bottom: 8px;
  font-weight: 700;
}

.rule-notes-list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary, #6b7280);
  font-size: 0.8125rem;
}

@media (prefers-color-scheme: dark) {
  .plu-faisabilite-page {
    --card-bg: #1f2937;
    --border-color: #374151;
    --text-primary: #f9fafb;
    --text-secondary: #9ca3af;
    --text-muted: #6b7280;
    --bg-muted: #111827;
    --code-bg: #374151;
  }
  .primary-btn {
    background: #4f46e5;
    border-color: #4f46e5;
  }
  .secondary-btn {
    background: var(--bg-muted, #111827);
    color: #f9fafb;
  }
  .secondary-btn:hover:not(:disabled) {
    background: #1f2937;
  }
  .ai-extract-btn {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(167, 139, 250, 0.25) 100%);
    border-color: rgba(139, 92, 246, 0.5);
    color: #a78bfa;
  }
  .ai-extract-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(167, 139, 250, 0.35) 100%);
    border-color: rgba(139, 92, 246, 0.7);
  }
  .zone-pill {
    color: #f9fafb;
  }
  .zone-detected-badge {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }
  .zone-ai-badge {
    background: rgba(139, 92, 246, 0.2);
    border-color: rgba(139, 92, 246, 0.4);
    color: #a78bfa;
  }
  .zone-sql-badge {
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.4);
    color: #4ade80;
  }
  .zone-user-badge {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 0.4);
    color: #60a5fa;
  }
  .zone-empty-badge {
    background: rgba(245, 158, 11, 0.2);
    border-color: rgba(245, 158, 11, 0.4);
    color: #fbbf24;
  }
  .zone-empty-message {
    background: rgba(245, 158, 11, 0.1);
    border-color: rgba(245, 158, 11, 0.4);
    color: #fcd34d;
  }
  .session-info {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.3);
  }
  .session-value {
    color: #f9fafb;
  }
  .detected-badge {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }
  .detected-warning {
    color: #fbbf24;
  }
  .detect-error-text {
    background: rgba(185, 28, 28, 0.15);
    border-color: rgba(185, 28, 28, 0.3);
    color: #fca5a5;
  }
  .rule-zone-card--detected {
    border-color: rgba(16, 185, 129, 0.5);
    background: rgba(16, 185, 129, 0.08);
  }
  .rule-zone-card--ai {
    border-color: rgba(139, 92, 246, 0.5);
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(167, 139, 250, 0.1) 100%);
  }
  .rule-zone-card--sql {
    border-color: rgba(34, 197, 94, 0.6);
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(74, 222, 128, 0.1) 100%);
  }
  .rule-zone-card--user {
    border-color: rgba(59, 130, 246, 0.5);
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(96, 165, 250, 0.1) 100%);
  }
  .auth-required-card {
    background: linear-gradient(135deg, #422006 0%, #78350f 100%);
    border-color: #f59e0b;
  }
  .auth-title {
    color: #fbbf24;
  }
  .auth-text {
    color: #fcd34d;
  }
  .auth-login-btn {
    background: #f59e0b;
    color: #111827;
  }
  .auth-login-btn:hover {
    background: #fbbf24;
  }
  .auth-login-btn-small {
    background: #4f46e5;
  }
  .completeness-warning {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
  }
  .completeness-content strong {
    color: #fbbf24;
  }
  .completeness-list {
    color: #fcd34d;
  }
  .completeness-list li.blocking {
    color: #fca5a5;
  }
  .completeness-list li.non-blocking {
    color: #9ca3af;
  }
  .completeness-hint {
    color: #fcd34d;
    border-top-color: rgba(245, 158, 11, 0.4);
  }
  .non-blocking-tag {
    background: rgba(156, 163, 175, 0.2);
  }
  .ai-extract-result-card {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(167, 139, 250, 0.15) 100%);
    border-color: rgba(139, 92, 246, 0.4);
  }
  .ai-extract-result-card--complete {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(52, 211, 153, 0.15) 100%);
    border-color: rgba(16, 185, 129, 0.5);
  }
  .ai-extract-result-card--incomplete {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(251, 191, 36, 0.15) 100%);
    border-color: rgba(245, 158, 11, 0.5);
  }
  .ai-extract-result-title {
    color: #f9fafb;
  }
  .ai-extract-result-value {
    color: #f9fafb;
  }
  .ai-extract-value--ok {
    color: #34d399;
  }
  .ai-extract-value--ko {
    color: #fbbf24;
  }
  .ai-extract-value--error {
    color: #fca5a5;
  }
  .ai-extract-error {
    background: rgba(185, 28, 28, 0.15);
    border-color: rgba(185, 28, 28, 0.3);
  }
  .ai-extract-error-text {
    color: #fca5a5;
  }
  .ai-missing-blocking {
    color: #fca5a5;
  }
  .ai-missing-non-blocking {
    color: #9ca3af;
  }
  .ai-missing-tag {
    background: rgba(156, 163, 175, 0.2);
  }
  .user-override-panel {
    background: rgba(59, 130, 246, 0.08);
    border-color: rgba(59, 130, 246, 0.3);
  }
  .user-override-warning {
    background: rgba(245, 158, 11, 0.12);
    border-color: rgba(245, 158, 11, 0.35);
  }
  .warning-text {
    color: #fcd34d;
  }
  .toggle-edit-btn {
    color: #60a5fa;
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.4);
  }
  .toggle-edit-btn:hover {
    background: rgba(59, 130, 246, 0.25);
    border-color: rgba(59, 130, 246, 0.6);
  }
  .override-badge {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }
  .edit-form {
    background: var(--bg-muted, #111827);
    border-color: var(--border-color, #374151);
  }
  .edit-input,
  .edit-select,
  .edit-textarea {
    background: var(--card-bg, #1f2937);
    border-color: var(--border-color, #374151);
    color: var(--text-primary, #f9fafb);
  }
  .save-btn {
    background: #059669;
  }
  .save-btn:hover {
    background: #047857;
  }
  .reset-btn {
    color: #fca5a5;
    background: rgba(185, 28, 28, 0.12);
    border-color: rgba(185, 28, 28, 0.35);
  }
  .reset-btn:hover {
    background: rgba(185, 28, 28, 0.2);
    border-color: rgba(185, 28, 28, 0.5);
  }
}
`;