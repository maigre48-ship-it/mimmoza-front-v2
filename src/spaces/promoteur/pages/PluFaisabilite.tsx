import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../lib/supabaseClient";
import PluUploaderPanel from "../components/PluUploaderPanel";
import { patchPromoteurSnapshot, patchModule } from "../shared/promoteurSnapshot.store";

// ============================================
// Configuration
// ============================================

const LS_COMMUNE_INSEE = "mimmoza.plu.last_commune_insee";
const LS_SELECTED_PLU_DOCUMENT_ID = "mimmoza.plu.selected_document_id";
const LS_SELECTED_PLU_COMMUNE_INSEE = "mimmoza.plu.selected_commune_insee";
const LS_SELECTED_PLU_ZONE_CODE = "mimmoza.plu.selected_zone_code";
const LS_DETECTED_ZONE_CODE = "mimmoza.plu.detected_zone_code";
const LS_PLU_RESOLVED_RULESET_V1 = "mimmoza.plu.resolved_ruleset_v1";
const LS_PLU_AI_EXTRACT_RESULT = "mimmoza.plu.ai_extract_result";
const LS_PLU_USER_OVERRIDES_V1 = "mimmoza.plu.user_overrides_v1";
const LS_SESSION_PARCEL_ID = "mimmoza.session.parcel_id";
const LS_SESSION_COMMUNE_INSEE = "mimmoza.session.commune_insee";
const LS_SESSION_ADDRESS = "mimmoza.session.address";
const LS_SELECTED_PARCELS_V1 = "mimmoza.promoteur.selected_parcels_v1";

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
  commune_name?: string | null;
  plu_version_label: string | null;
  storage_path: string | null;
  created_at: string | null;
  zones_count: number;
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
  retrait_voirie_min_m?: number | string | null;
  retrait_limites_separatives_min_m?: number | string | null;
  retrait_fond_parcelle_min_m?: number | string | null;
  places_par_logement?: number | string | null;
  surface_par_place_m2?: number | string | null;
  places_par_100m2?: number | string | null;
  ruleset?: unknown;
};

type PluRulesListResponse = {
  success: boolean;
  count: number;
  zones?: PluRulesZoneRow[];
  error?: string;
  message?: string;
};

type SelectedParcelsHandoff = {
  parcel_ids?: string[];
  primary_parcel_id?: string | null;
  commune_insee?: string | null;
  address?: string | null;
  updated_at?: string;
};

type PluFrontZoneSummaryRow = {
  commune_insee: string;
  commune_nom: string;
  zone_code: string;
  zone_libelle: string | null;
  plu_version_label: string;
  source: string;
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
// AI Extraction Types
// ============================================

type AiExtractedValue = {
  value: number | null;
  unit?: string;
  source?: string;
  confidence?: number;
  rawText?: string;
};

type AiExtractedBooleanValue = {
  value: boolean | null;
  source?: string;
  confidence?: number;
  rawText?: string;
};

type AiHauteurData = {
  hauteur_max?: AiExtractedValue;
  hauteur_egout?: AiExtractedValue;
  hauteur_faitage?: AiExtractedValue;
  nombre_niveaux_max?: AiExtractedValue;
  max_m?: number | null;
};

type AiStationnementData = {
  places_par_logement?: AiExtractedValue;
  places_par_m2_commerce?: AiExtractedValue;
  places_velo?: AiExtractedValue;
  par_logement?: number | null;
  par_100m2?: number | null;
  note?: string | null;
};

type AiImplantationData = {
  recul_voirie?: AiExtractedValue;
  recul_limites_separatives?: AiExtractedValue;
  recul_fond_parcelle?: AiExtractedValue;
  implantation_en_limite?: AiExtractedBooleanValue;
};

type AiEmpriseData = {
  ces_max?: AiExtractedValue;
  cos_max?: AiExtractedValue;
};

type AiExtractResultData = {
  completeness_ok: boolean;
  missing: string[];
  confidence_score: number | null;
  error: string | null;
  source?: string | null;
  hauteur?: AiHauteurData;
  stationnement?: AiStationnementData;
  implantation?: AiImplantationData;
  emprise?: AiEmpriseData;
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
  // Champs enrichis propagés depuis PLURulesetV2
  _hauteur_faitage_m?: number | null;
  _hauteur_egout_note?: string | null;
  _hauteur_faitage_note?: string | null;
  _pleine_terre_ratio?: number | null;
  _pleine_terre_note?: string | null;
  _cos_max?: number | null;
  _cos_note?: string | null;
  _voirie_note?: string | null;
  _limites_note?: string | null;
  _fond_note?: string | null;
  _stat_note?: string | null;
  _ces_note?: string | null;
};

type AiExtractResponse = {
  success: boolean;
  data?: AiExtractResultData;
  error?: string;
  statusCode?: number;
  document_id?: string;
  zone_code?: string;
  ruleset_id?: string;
  completeness_ok?: boolean;
  missing?: string[];
  confidence_score?: number | null;
};

type PluParserZoneRuleset = {
  zone_code?: string;
  zone_libelle?: string;
  ruleset?: Record<string, unknown>;
};

type PluParserResponse = {
  success?: boolean;
  error?: string;
  zones_rulesets?: PluParserZoneRuleset[];
  document_id?: string;
  commune_insee?: string;
};

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

type UserOverrideEntry = {
  updated_at: string;
  overrides: UserOverrideValues;
};

type UserOverridesStorage = {
  [key: string]: UserOverrideEntry;
};

// ============================================
// Resolved Ruleset V1 Types — ÉTENDU
// ============================================

type ResolvedReculRule = {
  min_m: number | null;
  type: "FIXED" | "DERIVED" | "UNKNOWN";
  note?: string | null;
};

type ResolvedFacadeRule = {
  min_m: number | null;
  type: "FIXED" | "DERIVED" | "UNKNOWN";
  note?: string | null;
  derived?: boolean;
};

type ResolvedImplantationEnLimite = {
  autorisee: boolean | null;
  note?: string | null;
};

type CompletenessCheck = {
  ok: boolean;
  missing: string[];
};

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
  // NOUVEAU : hauteur séparée égout / faîtage
  hauteur: {
    max_m: number | null;           // égout / acrotère
    faitage_m: number | null;       // faîtage
    note?: string | null;           // note égout
    faitage_note?: string | null;   // note faîtage
  };
  // NOUVEAU : pleine terre
  pleine_terre: {
    ratio_min: number | null;
    note?: string | null;
  };
  // NOUVEAU : COS
  cos: {
    max: number | null;
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
  } catch { return fallback; }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

function safeJsonParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function isValidCodeInsee(v: string) {
  return /^\d{5}$/.test((v ?? "").trim());
}

function normalizeZoneCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  return normalized || null;
}

function zonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizeZoneCode(a);
  const normB = normalizeZoneCode(b);
  if (!normA || !normB) return false;
  return normA === normB;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const parsed = parseFloat(trimmed.replace(",", "."));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function pickFirstNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = toNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function safeBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function safeString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function getRulesetValue(ruleset: unknown, ...path: string[]): unknown {
  let current: unknown = ruleset;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractAiValue(obj: AiExtractedValue | undefined | null): number | null {
  if (!obj || typeof obj !== "object") return null;
  return toNumber(obj.value);
}

function extractAiBooleanValue(obj: AiExtractedBooleanValue | undefined | null): boolean | null {
  if (!obj || typeof obj !== "object") return null;
  return safeBoolean(obj.value);
}

function collectNotes(
  metaNotes: string[] | undefined,
  ruleset: unknown,
  rules?: PluRules
): string[] {
  const notesSet = new Set<string>();
  if (metaNotes && Array.isArray(metaNotes)) {
    for (const n of metaNotes) { if (typeof n === "string" && n.trim()) notesSet.add(n.trim()); }
  }
  const sources = [
    rules?.reculs?.voirie?.note,
    rules?.reculs?.limites_separatives?.note,
    rules?.reculs?.fond_parcelle?.note,
    getRulesetValue(ruleset, "reculs", "voirie", "note"),
    getRulesetValue(ruleset, "reculs", "limites_separatives", "note"),
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "note"),
  ];
  for (const s of sources) {
    if (typeof s === "string" && s.trim()) notesSet.add(s.trim());
  }
  return Array.from(notesSet);
}

function isZoneMeaningful(z: PluRulesZoneRow): boolean {
  const ruleset = z.ruleset;
  const reculs = z.rules.reculs;
  const impl = z.rules.implantation;
  const checks = [
    pickFirstNumber(z.retrait_voirie_min_m, impl?.recul_voirie_min_m, reculs?.voirie?.min_m, getRulesetValue(ruleset, "reculs", "voirie", "min_m")),
    pickFirstNumber(z.retrait_limites_separatives_min_m, impl?.recul_limite_separative_min_m, reculs?.limites_separatives?.min_m),
    pickFirstNumber(z.retrait_fond_parcelle_min_m, impl?.recul_fond_parcelle_min_m, reculs?.fond_parcelle?.min_m),
    pickFirstNumber(z.places_par_logement, z.rules?.stationnement?.places_par_logement),
    pickFirstNumber(z.places_par_100m2, z.rules?.stationnement?.places_par_100m2),
    toNumber(z.rules.hauteur?.hauteur_max_m),
    toNumber(z.rules.emprise?.ces_max_percent),
  ];
  return checks.some(v => v !== null);
}

function getZoneLibelle(z: PluRulesZoneRow): string {
  if (z.zone_libelle?.trim()) return z.zone_libelle.trim();
  if (z.rules.zone_libelle?.trim()) return z.rules.zone_libelle.trim();
  return "Non trouvé";
}

function syncSessionFromHandoff(): { parcelId: string | null; communeInsee: string | null; address: string | null } {
  const result = { parcelId: null as string | null, communeInsee: null as string | null, address: null as string | null };
  try {
    const handoffRaw = readLS(LS_SELECTED_PARCELS_V1, "");
    if (!handoffRaw) return result;
    const handoff = safeJsonParse<SelectedParcelsHandoff>(handoffRaw);
    if (!handoff) return result;
    let parcelId: string | null = null;
    if (typeof handoff.primary_parcel_id === "string" && handoff.primary_parcel_id.trim()) {
      parcelId = handoff.primary_parcel_id.trim();
    } else if (Array.isArray(handoff.parcel_ids) && handoff.parcel_ids.length > 0) {
      const first = handoff.parcel_ids[0];
      if (typeof first === "string" && first.trim()) parcelId = first.trim();
    }
    let communeInsee: string | null = null;
    if (typeof handoff.commune_insee === "string" && handoff.commune_insee.trim()) {
      communeInsee = handoff.commune_insee.trim();
    }
    let address: string | null = null;
    if (typeof handoff.address === "string" && handoff.address.trim()) {
      address = handoff.address.trim();
    }
    if (parcelId) { writeLS(LS_SESSION_PARCEL_ID, parcelId); result.parcelId = parcelId; }
    if (communeInsee) { writeLS(LS_SESSION_COMMUNE_INSEE, communeInsee); result.communeInsee = communeInsee; }
    if (address) { writeLS(LS_SESSION_ADDRESS, address); result.address = address; }
    return result;
  } catch { return result; }
}

function loadPersistedAiExtractResult(documentId: string | null, zoneCode: string | null): PersistedAiExtractResult | null {
  if (!documentId || !zoneCode) return null;
  try {
    const raw = readLS(LS_PLU_AI_EXTRACT_RESULT, "");
    if (!raw) return null;
    const persisted = safeJsonParse<PersistedAiExtractResult>(raw);
    if (!persisted) return null;
    if (persisted.document_id !== documentId || !zonesMatch(persisted.zone_code, zoneCode)) return null;
    return persisted;
  } catch { return null; }
}

function isResolvedRulesetMeaningful(r: ResolvedPluRulesetV1): boolean {
  return (
    r.reculs.voirie.min_m !== null ||
    r.reculs.limites_separatives.min_m !== null ||
    r.reculs.fond_parcelle.min_m !== null ||
    r.reculs.implantation_en_limite.autorisee !== null ||
    r.stationnement.par_logement !== null ||
    r.stationnement.par_100m2 !== null ||
    r.hauteur.max_m !== null ||
    r.ces.max_ratio !== null
  );
}

function getUserOverrideKey(documentId: string, zoneCode: string): string {
  return `${documentId}::${normalizeZoneCode(zoneCode) ?? zoneCode}`;
}

function loadUserOverrides(): UserOverridesStorage {
  try {
    const raw = readLS(LS_PLU_USER_OVERRIDES_V1, "");
    if (!raw) return {};
    return safeJsonParse<UserOverridesStorage>(raw) ?? {};
  } catch { return {}; }
}

function saveUserOverrides(overrides: UserOverridesStorage): void {
  writeLS(LS_PLU_USER_OVERRIDES_V1, JSON.stringify(overrides));
}

function getUserOverrideEntry(documentId: string | null, zoneCode: string | null): UserOverrideEntry | null {
  if (!documentId || !zoneCode) return null;
  const allOverrides = loadUserOverrides();
  const key = getUserOverrideKey(documentId, zoneCode);
  return allOverrides[key] ?? null;
}

function extractPdfUrlFromDocument(doc: PluDocument | null | undefined): string | null {
  if (!doc) return null;
  const candidates = [doc.source_pdf_url, doc.public_url, doc.signed_url, doc.pdf_url, doc.url];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

// ============================================
// convertParserRulesetToAiExtractResult — REÉCRIT
// Propage les champs note depuis PLURulesetV2
// ============================================

function convertParserRulesetToAiExtractResult(
  ruleset: Record<string, unknown>,
  zoneLibelle: string | null
): AiExtractResultData {
  // ---- Reculs depuis implantation (PLURulesetV2) ou reculs (ancien format) ----
  const voirieMinM = pickFirstNumber(
    getRulesetValue(ruleset, "implantation", "recul_min_rue_m"),
    getRulesetValue(ruleset, "reculs", "voirie", "min_m"),
    getRulesetValue(ruleset, "reculs", "voirie", "recul_min_m"),
  );
  const voirieNote = safeString(
    getRulesetValue(ruleset, "implantation", "recul_min_rue_note") ??
    getRulesetValue(ruleset, "reculs", "voirie", "note")
  );

  const limitesMinM = pickFirstNumber(
    getRulesetValue(ruleset, "implantation", "recul_min_limite_laterale_m"),
    getRulesetValue(ruleset, "reculs", "limites_separatives", "min_m"),
  );
  const limitesNote = safeString(
    getRulesetValue(ruleset, "implantation", "recul_min_limite_laterale_note") ??
    getRulesetValue(ruleset, "reculs", "limites_separatives", "note")
  );

  const fondMinM = pickFirstNumber(
    getRulesetValue(ruleset, "implantation", "recul_min_fond_parcelle_m"),
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "min_m"),
  );
  const fondNote = safeString(
    getRulesetValue(ruleset, "implantation", "recul_min_fond_parcelle_note") ??
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "note")
  );

  const implEnLimiteAutorisee = safeBoolean(
    getRulesetValue(ruleset, "reculs", "implantation_en_limite", "autorisee")
  );

  // ---- Hauteurs ----
  const hauteurEgout = pickFirstNumber(
    getRulesetValue(ruleset, "hauteurs", "h_max_egout_m"),
    getRulesetValue(ruleset, "hauteur", "max_m"),
    getRulesetValue(ruleset, "hauteur", "hauteur_max_m"),
  );
  const hauteurEgoutNote = safeString(
    getRulesetValue(ruleset, "hauteurs", "h_max_egout_note") ??
    getRulesetValue(ruleset, "hauteur", "note")
  );
  const hauteurFaitage = pickFirstNumber(
    getRulesetValue(ruleset, "hauteurs", "h_max_faitage_m"),
    getRulesetValue(ruleset, "hauteur", "faitage_m"),
  );
  const hauteurFaitageNote = safeString(
    getRulesetValue(ruleset, "hauteurs", "h_max_faitage_note")
  );

  // ---- Stationnement ----
  const statParLogement = pickFirstNumber(
    getRulesetValue(ruleset, "stationnement", "logement", "places_par_logement"),
    getRulesetValue(ruleset, "stationnement", "par_logement"),
    getRulesetValue(ruleset, "stationnement", "places_par_logement"),
  );
  const statNote = safeString(
    getRulesetValue(ruleset, "stationnement", "logement", "places_par_logement_note") ??
    getRulesetValue(ruleset, "stationnement", "commentaires") ??
    getRulesetValue(ruleset, "stationnement", "note")
  );

  // ---- CES (emprise au sol) ----
  const cesMaxRatio = pickFirstNumber(
    getRulesetValue(ruleset, "densite_emprise", "emprise_max_ratio"),
    getRulesetValue(ruleset, "emprise", "ces_max_ratio"),
    getRulesetValue(ruleset, "ces", "max_ratio"),
  );
  const cesNote = safeString(
    getRulesetValue(ruleset, "densite_emprise", "emprise_max_note") ??
    getRulesetValue(ruleset, "emprise", "note") ??
    getRulesetValue(ruleset, "ces", "note")
  );

  // ---- Pleine terre ----
  const pleineTerreRatio = pickFirstNumber(
    getRulesetValue(ruleset, "pleine_terre", "ratio_min"),
    getRulesetValue(ruleset, "reglesComplementaires", "espaceLibrePleineTerre"),
  );
  const pleineTerreNote = safeString(
    getRulesetValue(ruleset, "pleine_terre", "ratio_min_note") ??
    getRulesetValue(ruleset, "pleine_terre", "commentaire")
  );

  // ---- COS ----
  const cosMax = pickFirstNumber(
    getRulesetValue(ruleset, "densite_emprise", "cos_max"),
    getRulesetValue(ruleset, "cos", "max"),
  );
  const cosNote = safeString(
    getRulesetValue(ruleset, "densite_emprise", "cos_note") ??
    (() => {
      const cosExiste = getRulesetValue(ruleset, "densite_emprise", "cos_existe");
      return cosExiste === false ? "Sans objet" : null;
    })()
  );

  // ---- Notes générales ----
  const notesArray: string[] = [];
  const rawNotes = getRulesetValue(ruleset, "notes") ?? getRulesetValue(ruleset, "brut", "notes_generales");
  if (Array.isArray(rawNotes)) {
    for (const n of rawNotes) { if (typeof n === "string" && n.trim()) notesArray.push(n.trim()); }
  } else if (typeof rawNotes === "string" && rawNotes.trim()) {
    notesArray.push(rawNotes.trim());
  }

  // ---- Completeness ----
  const missing: string[] = [];
  if (voirieMinM === null) missing.push("reculs.voirie.min_m");
  if (limitesMinM === null) missing.push("reculs.limites_separatives.min_m");
  if (fondMinM === null) missing.push("reculs.fond_parcelle.min_m");
  if (implEnLimiteAutorisee === null) missing.push("implantation_en_limite (optionnel)");
  if (statParLogement === null) missing.push("stationnement (optionnel)");
  if (hauteurEgout === null) missing.push("hauteur.egout (optionnel)");
  if (cesMaxRatio === null) missing.push("ces.max_ratio (optionnel)");

  return {
    completeness_ok: voirieMinM !== null && limitesMinM !== null && fondMinM !== null,
    missing,
    confidence_score: toNumber(getRulesetValue(ruleset, "confidence_score")),
    error: null,
    source: "PLU_PARSER_LOCAL",
    zone_libelle: zoneLibelle,
    reculs: {
      voirie: { min_m: voirieMinM, note: voirieNote },
      limites_separatives: { min_m: limitesMinM, note: limitesNote },
      fond_parcelle: { min_m: fondMinM, note: fondNote },
      implantation_en_limite: { autorisee: implEnLimiteAutorisee, note: null },
    },
    hauteur: { max_m: hauteurEgout },
    stationnement: { par_logement: statParLogement, note: statNote },
    ces: { max_ratio: cesMaxRatio, note: cesNote },
    notes: notesArray,
    // Champs enrichis
    _hauteur_faitage_m: hauteurFaitage,
    _hauteur_egout_note: hauteurEgoutNote,
    _hauteur_faitage_note: hauteurFaitageNote,
    _pleine_terre_ratio: pleineTerreRatio,
    _pleine_terre_note: pleineTerreNote,
    _cos_max: cosMax,
    _cos_note: cosNote,
    _voirie_note: voirieNote,
    _limites_note: limitesNote,
    _fond_note: fondNote,
    _stat_note: statNote,
    _ces_note: cesNote,
  };
}

// ============================================
// Resolved Ruleset V1 Builder — ÉTENDU
// ============================================

function buildCompletenessCheck(
  voirieValue: number | null,
  limitesValue: number | null,
  fondParcelleValue: number | null,
  implantationEnLimiteAutorisee: boolean | null,
  stationnementParLogement: number | null,
  stationnementPar100m2: number | null,
  hauteurMaxM: number | null,
  cesMaxRatio: number | null,
): CompletenessCheck {
  const missingBlocking: string[] = [];
  const missingOptional: string[] = [];
  if (voirieValue === null) missingBlocking.push("reculs.voirie.min_m");
  if (limitesValue === null) missingBlocking.push("reculs.limites_separatives.min_m");
  if (fondParcelleValue === null) missingBlocking.push("reculs.fond_parcelle.min_m");
  if (implantationEnLimiteAutorisee === null) missingOptional.push("implantation_en_limite");
  if (stationnementParLogement === null && stationnementPar100m2 === null) missingOptional.push("stationnement");
  if (hauteurMaxM === null) missingOptional.push("hauteur.max_m");
  if (cesMaxRatio === null) missingOptional.push("ces.max_ratio");
  return {
    ok: missingBlocking.length === 0,
    missing: [...missingBlocking, ...missingOptional.map(x => `${x} (optionnel)`)],
  };
}

function resolvePluRulesetV1(z: PluRulesZoneRow): ResolvedPluRulesetV1 {
  const impl = z.rules.implantation;
  const fac = impl?.facades;
  const ruleset = z.ruleset;
  const reculs = z.rules.reculs;

  const voirieValue = pickFirstNumber(
    z.retrait_voirie_min_m, impl?.recul_voirie_min_m,
    reculs?.voirie?.min_m, getRulesetValue(ruleset, "reculs", "voirie", "min_m"),
    getRulesetValue(ruleset, "implantation", "recul_min_rue_m"),
  );
  const voirieNote = safeString(
    reculs?.voirie?.note ??
    getRulesetValue(ruleset, "reculs", "voirie", "note") ??
    getRulesetValue(ruleset, "implantation", "recul_min_rue_note")
  );

  const limitesValue = pickFirstNumber(
    z.retrait_limites_separatives_min_m, impl?.recul_limite_separative_min_m,
    reculs?.limites_separatives?.min_m,
    getRulesetValue(ruleset, "implantation", "recul_min_limite_laterale_m"),
  );
  const limitesNote = safeString(
    reculs?.limites_separatives?.note ??
    getRulesetValue(ruleset, "implantation", "recul_min_limite_laterale_note")
  );

  const fondParcelleValue = pickFirstNumber(
    z.retrait_fond_parcelle_min_m, impl?.recul_fond_parcelle_min_m,
    reculs?.fond_parcelle?.min_m,
    getRulesetValue(ruleset, "implantation", "recul_min_fond_parcelle_m"),
  );
  const fondParcelleNote = safeString(
    reculs?.fond_parcelle?.note ??
    getRulesetValue(ruleset, "implantation", "recul_min_fond_parcelle_note")
  );

  let implantationEnLimiteAutorisee: boolean | null = null;
  if (typeof impl?.implantation_en_limite_autorisee === "boolean") {
    implantationEnLimiteAutorisee = impl.implantation_en_limite_autorisee;
  } else {
    implantationEnLimiteAutorisee = safeBoolean(getRulesetValue(ruleset, "reculs", "implantation_en_limite", "autorisee"));
  }

  // Facades
  const extractFacadeFromRuleset = (key: string) => ({
    min_m: pickFirstNumber(
      getRulesetValue(ruleset, "rules", "implantation", "facades", key, "recul_min_m"),
      getRulesetValue(ruleset, "rules", "implantation", "facades", key, "min_m"),
      getRulesetValue(ruleset, "implantation", "facades", key, "recul_min_m"),
      getRulesetValue(ruleset, "implantation", "facades", key, "min_m"),
    ),
    note: safeString(
      getRulesetValue(ruleset, "rules", "implantation", "facades", key, "note") ??
      getRulesetValue(ruleset, "implantation", "facades", key, "note")
    ),
  });

  let facadeAvantMinM: number | null = null, facadeAvantDerived = false, facadeAvantNote: string | undefined;
  if (fac?.avant && (fac.avant.recul_min_m !== null || fac.avant.min_m !== null)) {
    facadeAvantMinM = fac.avant.recul_min_m ?? fac.avant.min_m ?? null;
    facadeAvantNote = safeString(fac.avant.note) ?? undefined;
  } else {
    const rf = extractFacadeFromRuleset("avant");
    if (rf.min_m !== null) { facadeAvantMinM = rf.min_m; facadeAvantNote = rf.note ?? undefined; }
    else if (voirieValue !== null) { facadeAvantMinM = voirieValue; facadeAvantDerived = true; facadeAvantNote = "Dérivé du recul voirie"; }
  }

  let facadeLateralesMinM: number | null = null, facadeLateralesDerived = false, facadeLateralesNote: string | undefined;
  if (fac?.laterales && (fac.laterales.recul_min_m !== null || fac.laterales.min_m !== null)) {
    facadeLateralesMinM = fac.laterales.recul_min_m ?? fac.laterales.min_m ?? null;
    facadeLateralesNote = safeString(fac.laterales.note) ?? undefined;
  } else {
    const rf = extractFacadeFromRuleset("laterales");
    if (rf.min_m !== null) { facadeLateralesMinM = rf.min_m; facadeLateralesNote = rf.note ?? undefined; }
    else if (limitesValue !== null) { facadeLateralesMinM = limitesValue; facadeLateralesDerived = true; facadeLateralesNote = "Dérivé du recul limites séparatives"; }
  }

  let facadeFondMinM: number | null = null, facadeFondDerived = false, facadeFondNote: string | undefined;
  if (fac?.fond && (fac.fond.recul_min_m !== null || fac.fond.min_m !== null)) {
    facadeFondMinM = fac.fond.recul_min_m ?? fac.fond.min_m ?? null;
    facadeFondNote = safeString(fac.fond.note) ?? undefined;
  } else {
    const rf = extractFacadeFromRuleset("fond");
    if (rf.min_m !== null) { facadeFondMinM = rf.min_m; facadeFondNote = rf.note ?? undefined; }
    else if (fondParcelleValue !== null) { facadeFondMinM = fondParcelleValue; facadeFondDerived = true; facadeFondNote = "Dérivé du recul fond de parcelle"; }
  }

  // CES
  const cesPercent = pickFirstNumber(
    z.rules.emprise?.ces_max_percent,
    getRulesetValue(ruleset, "emprise", "ces_max_percent"),
    getRulesetValue(ruleset, "densite_emprise", "emprise_max_ratio"),
  );
  let cesMaxRatio: number | null = null;
  let cesNote: string | undefined;
  if (cesPercent === null) { cesNote = "Non trouvé dans le ruleset"; }
  else if (cesPercent > 100) { cesNote = `Valeur suspecte (${cesPercent}%) ignorée`; }
  else if (cesPercent >= 1 && cesPercent <= 100) { cesMaxRatio = cesPercent / 100; }
  else if (cesPercent >= 0 && cesPercent < 1) { cesMaxRatio = cesPercent; }
  else { cesNote = `Valeur invalide (${cesPercent}) ignorée`; }

  // Hauteurs
  const hauteurMaxM = pickFirstNumber(
    z.rules.hauteur?.hauteur_max_m,
    getRulesetValue(ruleset, "hauteur", "max_m"),
    getRulesetValue(ruleset, "hauteurs", "h_max_egout_m"),
  );
  const hauteurFaitageM = pickFirstNumber(
    getRulesetValue(ruleset, "hauteurs", "h_max_faitage_m"),
    getRulesetValue(ruleset, "hauteur", "faitage_m"),
  );
  const hauteurEgoutNote = safeString(
    getRulesetValue(ruleset, "hauteurs", "h_max_egout_note") ??
    getRulesetValue(ruleset, "hauteur", "note")
  );
  const hauteurFaitageNote = safeString(getRulesetValue(ruleset, "hauteurs", "h_max_faitage_note"));

  // Pleine terre
  const pleineTerreRatio = pickFirstNumber(
    getRulesetValue(ruleset, "pleine_terre", "ratio_min"),
    getRulesetValue(ruleset, "reglesComplementaires", "espaceLibrePleineTerre"),
  );
  const pleineTerreNote = safeString(
    getRulesetValue(ruleset, "pleine_terre", "ratio_min_note") ??
    getRulesetValue(ruleset, "pleine_terre", "commentaire")
  );

  // COS
  const cosMax = pickFirstNumber(
    getRulesetValue(ruleset, "densite_emprise", "cos_max"),
    getRulesetValue(ruleset, "cos", "max"),
  );
  const cosNote = safeString(
    getRulesetValue(ruleset, "densite_emprise", "cos_note") ??
    (() => {
      const cosExiste = getRulesetValue(ruleset, "densite_emprise", "cos_existe");
      return cosExiste === false ? "Sans objet" : null;
    })()
  );

  // Stationnement
  const stationnementParLogement = pickFirstNumber(
    z.places_par_logement,
    z.rules?.stationnement?.places_par_logement,
    getRulesetValue(ruleset, "stationnement", "places_par_logement"),
    getRulesetValue(ruleset, "stationnement", "logement", "places_par_logement"),
  );
  const stationnementPar100m2 = pickFirstNumber(
    z.places_par_100m2,
    z.rules?.stationnement?.places_par_100m2,
  );
  const statNote = safeString(
    getRulesetValue(ruleset, "stationnement", "logement", "places_par_logement_note") ??
    getRulesetValue(ruleset, "stationnement", "commentaires")
  );

  const allNotes = collectNotes(z.rules.meta?.notes, ruleset, z.rules);

  return {
    version: "plu_ruleset_v1",
    document_id: z.document_id,
    commune_insee: z.commune_insee,
    zone_code: z.zone_code,
    zone_libelle: z.zone_libelle ?? z.rules.zone_libelle ?? null,
    confidence_score: z.confidence_score,
    source: z.source,
    reculs: {
      voirie: { min_m: voirieValue, type: voirieValue !== null ? "FIXED" : "UNKNOWN", note: voirieNote },
      limites_separatives: { min_m: limitesValue, type: limitesValue !== null ? "FIXED" : "UNKNOWN", note: limitesNote },
      fond_parcelle: { min_m: fondParcelleValue, type: fondParcelleValue !== null ? "FIXED" : "UNKNOWN", note: fondParcelleNote },
      implantation_en_limite: { autorisee: implantationEnLimiteAutorisee },
      facades: {
        avant: { min_m: facadeAvantMinM, type: facadeAvantMinM !== null ? (facadeAvantDerived ? "DERIVED" : "FIXED") : "UNKNOWN", note: facadeAvantNote, derived: facadeAvantDerived },
        laterales: { min_m: facadeLateralesMinM, type: facadeLateralesMinM !== null ? (facadeLateralesDerived ? "DERIVED" : "FIXED") : "UNKNOWN", note: facadeLateralesNote, derived: facadeLateralesDerived },
        fond: { min_m: facadeFondMinM, type: facadeFondMinM !== null ? (facadeFondDerived ? "DERIVED" : "FIXED") : "UNKNOWN", note: facadeFondNote, derived: facadeFondDerived },
      },
    },
    ces: { max_ratio: cesMaxRatio, note: cesNote },
    hauteur: {
      max_m: hauteurMaxM,
      faitage_m: hauteurFaitageM,
      note: hauteurEgoutNote,
      faitage_note: hauteurFaitageNote,
    },
    pleine_terre: { ratio_min: pleineTerreRatio, note: pleineTerreNote },
    cos: { max: cosMax, note: cosNote },
    stationnement: { par_logement: stationnementParLogement, par_100m2: stationnementPar100m2, note: statNote },
    notes: allNotes,
    completeness: buildCompletenessCheck(
      voirieValue, limitesValue, fondParcelleValue,
      implantationEnLimiteAutorisee,
      stationnementParLogement, stationnementPar100m2,
      hauteurMaxM, cesMaxRatio,
    ),
  };
}

function buildResolvedRulesetFromAi(
  aiData: AiExtractResultData,
  documentId: string,
  communeInsee: string,
  zoneCode: string
): ResolvedPluRulesetV1 {
  const voirieValue = pickFirstNumber(extractAiValue(aiData.implantation?.recul_voirie), aiData.reculs?.voirie?.min_m);
  const limitesValue = pickFirstNumber(extractAiValue(aiData.implantation?.recul_limites_separatives), aiData.reculs?.limites_separatives?.min_m);
  const fondParcelleValue = pickFirstNumber(extractAiValue(aiData.implantation?.recul_fond_parcelle), aiData.reculs?.fond_parcelle?.min_m);

  let implantationEnLimiteAutorisee: boolean | null = null;
  const newImpl = extractAiBooleanValue(aiData.implantation?.implantation_en_limite);
  if (newImpl !== null) { implantationEnLimiteAutorisee = newImpl; }
  else { implantationEnLimiteAutorisee = safeBoolean(aiData.reculs?.implantation_en_limite?.autorisee); }

  const aiFacades = aiData.reculs?.facades;
  const facadeAvantMinM = toNumber(aiFacades?.avant?.min_m);
  const facadeLateralesMinM = toNumber(aiFacades?.laterales?.min_m);
  const facadeFondMinM = toNumber(aiFacades?.fond?.min_m);

  const cesMaxRatio = pickFirstNumber(extractAiValue(aiData.emprise?.ces_max), aiData.ces?.max_ratio);
  const hauteurMaxM = pickFirstNumber(
    extractAiValue(aiData.hauteur?.hauteur_max),
    extractAiValue(aiData.hauteur?.hauteur_egout),
    aiData.hauteur?.max_m,
  );

  // Champs enrichis depuis PLURulesetV2
  const hauteurFaitageM = aiData._hauteur_faitage_m ?? pickFirstNumber(extractAiValue(aiData.hauteur?.hauteur_faitage));
  const hauteurEgoutNote = aiData._hauteur_egout_note ?? null;
  const hauteurFaitageNote = aiData._hauteur_faitage_note ?? null;
  const pleineTerreRatio = aiData._pleine_terre_ratio ?? null;
  const pleineTerreNote = aiData._pleine_terre_note ?? null;
  const cosMax = aiData._cos_max ?? null;
  const cosNote = aiData._cos_note ?? null;
  const cesNote = aiData._ces_note ?? safeString(aiData.ces?.note);
  const statNote = aiData._stat_note ?? safeString(aiData.stationnement?.note);

  const stationnementParLogement = pickFirstNumber(extractAiValue(aiData.stationnement?.places_par_logement), aiData.stationnement?.par_logement);
  const stationnementPar100m2 = pickFirstNumber(extractAiValue(aiData.stationnement?.places_par_m2_commerce), aiData.stationnement?.par_100m2);

  const allNotes = aiData.notes ?? [];

  return {
    version: "plu_ruleset_v1",
    document_id: documentId,
    commune_insee: communeInsee,
    zone_code: zoneCode,
    zone_libelle: aiData.zone_libelle ?? null,
    confidence_score: aiData.confidence_score,
    source: aiData.source ?? "AI_EXTRACTION",
    reculs: {
      voirie: { min_m: voirieValue, type: voirieValue !== null ? "FIXED" : "UNKNOWN", note: aiData._voirie_note ?? safeString(aiData.reculs?.voirie?.note) },
      limites_separatives: { min_m: limitesValue, type: limitesValue !== null ? "FIXED" : "UNKNOWN", note: aiData._limites_note ?? safeString(aiData.reculs?.limites_separatives?.note) },
      fond_parcelle: { min_m: fondParcelleValue, type: fondParcelleValue !== null ? "FIXED" : "UNKNOWN", note: aiData._fond_note ?? safeString(aiData.reculs?.fond_parcelle?.note) },
      implantation_en_limite: { autorisee: implantationEnLimiteAutorisee, note: safeString(aiData.reculs?.implantation_en_limite?.note) },
      facades: {
        avant: { min_m: facadeAvantMinM ?? voirieValue, type: facadeAvantMinM !== null ? "FIXED" : voirieValue !== null ? "DERIVED" : "UNKNOWN", note: safeString(aiFacades?.avant?.note) ?? (facadeAvantMinM === null && voirieValue !== null ? "Dérivé du recul voirie" : undefined), derived: facadeAvantMinM === null && voirieValue !== null },
        laterales: { min_m: facadeLateralesMinM ?? limitesValue, type: facadeLateralesMinM !== null ? "FIXED" : limitesValue !== null ? "DERIVED" : "UNKNOWN", note: safeString(aiFacades?.laterales?.note) ?? (facadeLateralesMinM === null && limitesValue !== null ? "Dérivé du recul limites séparatives" : undefined), derived: facadeLateralesMinM === null && limitesValue !== null },
        fond: { min_m: facadeFondMinM ?? fondParcelleValue, type: facadeFondMinM !== null ? "FIXED" : fondParcelleValue !== null ? "DERIVED" : "UNKNOWN", note: safeString(aiFacades?.fond?.note) ?? (facadeFondMinM === null && fondParcelleValue !== null ? "Dérivé du recul fond de parcelle" : undefined), derived: facadeFondMinM === null && fondParcelleValue !== null },
      },
    },
    ces: { max_ratio: cesMaxRatio, note: cesNote },
    hauteur: { max_m: hauteurMaxM, faitage_m: hauteurFaitageM, note: hauteurEgoutNote, faitage_note: hauteurFaitageNote },
    pleine_terre: { ratio_min: pleineTerreRatio, note: pleineTerreNote },
    cos: { max: cosMax, note: cosNote },
    stationnement: { par_logement: stationnementParLogement, par_100m2: stationnementPar100m2, note: statNote },
    notes: allNotes,
    completeness: buildCompletenessCheck(
      voirieValue, limitesValue, fondParcelleValue,
      implantationEnLimiteAutorisee,
      stationnementParLogement, stationnementPar100m2,
      hauteurMaxM, cesMaxRatio,
    ),
  };
}

function buildResolvedFromSqlSummary(s: PluFrontZoneSummaryRow, documentIdFallback: string | null): ResolvedPluRulesetV1 {
  const voirieValue = toNumber(s.recul_voirie_min_m);
  const limitesValue = toNumber(s.recul_limites_min_m);
  const fondParcelleValue = toNumber(s.recul_fond_min_m);
  const implantationEnLimiteAutorisee = s.implantation_en_limite_autorisee ?? null;
  const hauteurMaxM = toNumber(s.hauteur_max_m);
  const cesMaxRatio = toNumber(s.ces_max_ratio);
  const stationnementParLogement = toNumber(s.stationnement_par_logement);
  const stationnementPar100m2 = toNumber(s.stationnement_par_100m2);
  const notes: string[] = [];
  if (s.raw_rules_text?.trim()) notes.push(s.raw_rules_text.trim());

  return {
    version: "plu_ruleset_v1",
    document_id: documentIdFallback ?? "SQL_CANON",
    commune_insee: s.commune_insee,
    zone_code: s.zone_code,
    zone_libelle: s.zone_libelle,
    confidence_score: 1.0,
    source: `SQL_${s.source || "CANON"}`,
    reculs: {
      voirie: { min_m: voirieValue, type: voirieValue !== null ? "FIXED" : "UNKNOWN" },
      limites_separatives: { min_m: limitesValue, type: limitesValue !== null ? "FIXED" : "UNKNOWN" },
      fond_parcelle: { min_m: fondParcelleValue, type: fondParcelleValue !== null ? "FIXED" : "UNKNOWN" },
      implantation_en_limite: { autorisee: implantationEnLimiteAutorisee },
      facades: {
        avant: { min_m: voirieValue, type: voirieValue !== null ? "DERIVED" : "UNKNOWN", note: voirieValue !== null ? "Dérivé du recul voirie (SQL)" : undefined, derived: true },
        laterales: { min_m: limitesValue, type: limitesValue !== null ? "DERIVED" : "UNKNOWN", note: limitesValue !== null ? "Dérivé du recul limites séparatives (SQL)" : undefined, derived: true },
        fond: { min_m: fondParcelleValue, type: fondParcelleValue !== null ? "DERIVED" : "UNKNOWN", note: fondParcelleValue !== null ? "Dérivé du recul fond de parcelle (SQL)" : undefined, derived: true },
      },
    },
    ces: { max_ratio: cesMaxRatio, note: cesMaxRatio === null ? "Non trouvé dans la vue SQL" : undefined },
    hauteur: { max_m: hauteurMaxM, faitage_m: null, note: hauteurMaxM === null ? "Non trouvé dans la vue SQL" : undefined },
    pleine_terre: { ratio_min: null, note: "Non disponible dans la vue SQL" },
    cos: { max: null, note: "Non disponible dans la vue SQL" },
    stationnement: { par_logement: stationnementParLogement, par_100m2: stationnementPar100m2, note: s.stationnement_note ?? undefined },
    notes,
    completeness: buildCompletenessCheck(
      voirieValue, limitesValue, fondParcelleValue,
      implantationEnLimiteAutorisee,
      stationnementParLogement, stationnementPar100m2,
      hauteurMaxM, cesMaxRatio,
    ),
  };
}

function mergeRulesets(baseRuleset: ResolvedPluRulesetV1, aiRuleset: ResolvedPluRulesetV1): ResolvedPluRulesetV1 {
  const pick = (ai: number | null, base: number | null) => ai !== null ? ai : base;
  const pickBool = (ai: boolean | null, base: boolean | null) => ai !== null ? ai : base;
  const pickStr = (ai: string | null | undefined, base: string | null | undefined) => ai ?? base ?? undefined;

  const voirieMinM = pick(aiRuleset.reculs.voirie.min_m, baseRuleset.reculs.voirie.min_m);
  const limitesMinM = pick(aiRuleset.reculs.limites_separatives.min_m, baseRuleset.reculs.limites_separatives.min_m);
  const fondParcelleMinM = pick(aiRuleset.reculs.fond_parcelle.min_m, baseRuleset.reculs.fond_parcelle.min_m);
  const implantationEnLimite = pickBool(aiRuleset.reculs.implantation_en_limite.autorisee, baseRuleset.reculs.implantation_en_limite.autorisee);
  const facadeAvantMinM = pick(aiRuleset.reculs.facades.avant.min_m, baseRuleset.reculs.facades.avant.min_m);
  const facadeLateralesMinM = pick(aiRuleset.reculs.facades.laterales.min_m, baseRuleset.reculs.facades.laterales.min_m);
  const facadeFondMinM = pick(aiRuleset.reculs.facades.fond.min_m, baseRuleset.reculs.facades.fond.min_m);
  const cesMaxRatio = pick(aiRuleset.ces.max_ratio, baseRuleset.ces.max_ratio);
  const hauteurMaxM = pick(aiRuleset.hauteur.max_m, baseRuleset.hauteur.max_m);
  const hauteurFaitageM = pick(aiRuleset.hauteur.faitage_m, baseRuleset.hauteur.faitage_m);
  const pleineTerreRatio = pick(aiRuleset.pleine_terre.ratio_min, baseRuleset.pleine_terre.ratio_min);
  const cosMax = pick(aiRuleset.cos.max, baseRuleset.cos.max);
  const stationnementParLogement = pick(aiRuleset.stationnement.par_logement, baseRuleset.stationnement.par_logement);
  const stationnementPar100m2 = pick(aiRuleset.stationnement.par_100m2, baseRuleset.stationnement.par_100m2);

  const notesSet = new Set<string>();
  for (const n of baseRuleset.notes) notesSet.add(n);
  for (const n of aiRuleset.notes) notesSet.add(n);

  return {
    version: "plu_ruleset_v1",
    document_id: aiRuleset.document_id,
    commune_insee: aiRuleset.commune_insee,
    zone_code: aiRuleset.zone_code,
    zone_libelle: aiRuleset.zone_libelle ?? baseRuleset.zone_libelle,
    confidence_score: aiRuleset.confidence_score ?? baseRuleset.confidence_score,
    source: "AI_MERGED",
    reculs: {
      voirie: { min_m: voirieMinM, type: voirieMinM !== null ? "FIXED" : "UNKNOWN", note: pickStr(aiRuleset.reculs.voirie.note, baseRuleset.reculs.voirie.note) },
      limites_separatives: { min_m: limitesMinM, type: limitesMinM !== null ? "FIXED" : "UNKNOWN", note: pickStr(aiRuleset.reculs.limites_separatives.note, baseRuleset.reculs.limites_separatives.note) },
      fond_parcelle: { min_m: fondParcelleMinM, type: fondParcelleMinM !== null ? "FIXED" : "UNKNOWN", note: pickStr(aiRuleset.reculs.fond_parcelle.note, baseRuleset.reculs.fond_parcelle.note) },
      implantation_en_limite: { autorisee: implantationEnLimite, note: pickStr(aiRuleset.reculs.implantation_en_limite.note, baseRuleset.reculs.implantation_en_limite.note) },
      facades: {
        avant: { min_m: facadeAvantMinM, type: facadeAvantMinM !== null ? "FIXED" : "UNKNOWN", note: pickStr(aiRuleset.reculs.facades.avant.note, baseRuleset.reculs.facades.avant.note), derived: aiRuleset.reculs.facades.avant.derived },
        laterales: { min_m: facadeLateralesMinM, type: facadeLateralesMinM !== null ? "FIXED" : "UNKNOWN", note: pickStr(aiRuleset.reculs.facades.laterales.note, baseRuleset.reculs.facades.laterales.note), derived: aiRuleset.reculs.facades.laterales.derived },
        fond: { min_m: facadeFondMinM, type: facadeFondMinM !== null ? "FIXED" : "UNKNOWN", note: pickStr(aiRuleset.reculs.facades.fond.note, baseRuleset.reculs.facades.fond.note), derived: aiRuleset.reculs.facades.fond.derived },
      },
    },
    ces: { max_ratio: cesMaxRatio, note: pickStr(aiRuleset.ces.note, baseRuleset.ces.note) },
    hauteur: {
      max_m: hauteurMaxM,
      faitage_m: hauteurFaitageM,
      note: pickStr(aiRuleset.hauteur.note, baseRuleset.hauteur.note),
      faitage_note: pickStr(aiRuleset.hauteur.faitage_note, baseRuleset.hauteur.faitage_note),
    },
    pleine_terre: { ratio_min: pleineTerreRatio, note: pickStr(aiRuleset.pleine_terre.note, baseRuleset.pleine_terre.note) },
    cos: { max: cosMax, note: pickStr(aiRuleset.cos.note, baseRuleset.cos.note) },
    stationnement: { par_logement: stationnementParLogement, par_100m2: stationnementPar100m2, note: pickStr(aiRuleset.stationnement.note, baseRuleset.stationnement.note) },
    notes: Array.from(notesSet),
    completeness: buildCompletenessCheck(
      voirieMinM, limitesMinM, fondParcelleMinM,
      implantationEnLimite,
      stationnementParLogement, stationnementPar100m2,
      hauteurMaxM, cesMaxRatio,
    ),
  };
}

function applyUserOverrides(baseResolved: ResolvedPluRulesetV1, overrides: UserOverrideValues | null): ResolvedPluRulesetV1 {
  if (!overrides) return baseResolved;
  const result: ResolvedPluRulesetV1 = JSON.parse(JSON.stringify(baseResolved));

  if (overrides.reculs.voirie_min_m !== undefined) {
    const val = toNumber(overrides.reculs.voirie_min_m);
    if (val !== null) { result.reculs.voirie.min_m = val; result.reculs.voirie.type = "FIXED"; result.reculs.voirie.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.reculs.limites_separatives_min_m !== undefined) {
    const val = toNumber(overrides.reculs.limites_separatives_min_m);
    if (val !== null) { result.reculs.limites_separatives.min_m = val; result.reculs.limites_separatives.type = "FIXED"; result.reculs.limites_separatives.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.reculs.fond_parcelle_min_m !== undefined) {
    const val = toNumber(overrides.reculs.fond_parcelle_min_m);
    if (val !== null) { result.reculs.fond_parcelle.min_m = val; result.reculs.fond_parcelle.type = "FIXED"; result.reculs.fond_parcelle.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.reculs.implantation_en_limite_autorisee !== undefined) {
    const val = safeBoolean(overrides.reculs.implantation_en_limite_autorisee);
    if (val !== null) { result.reculs.implantation_en_limite.autorisee = val; result.reculs.implantation_en_limite.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.ces_max_ratio !== undefined) {
    const val = toNumber(overrides.ces_max_ratio);
    if (val !== null) { result.ces.max_ratio = val; result.ces.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.hauteur_max_m !== undefined) {
    const val = toNumber(overrides.hauteur_max_m);
    if (val !== null) { result.hauteur.max_m = val; result.hauteur.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.stationnement_par_logement !== undefined) {
    const val = toNumber(overrides.stationnement_par_logement);
    if (val !== null) { result.stationnement.par_logement = val; result.stationnement.note = "Corrigé par l'utilisateur"; }
  }
  if (overrides.stationnement_par_100m2 !== undefined) {
    const val = toNumber(overrides.stationnement_par_100m2);
    if (val !== null) { result.stationnement.par_100m2 = val; }
  }
  if (overrides.notes_append?.trim()) {
    const userNote = `[Note utilisateur] ${overrides.notes_append.trim()}`;
    if (!result.notes.includes(userNote)) result.notes.push(userNote);
  }
  result.source = result.source ? `${result.source}+USER` : "USER_OVERRIDDEN";
  result.completeness = buildCompletenessCheck(
    result.reculs.voirie.min_m,
    result.reculs.limites_separatives.min_m,
    result.reculs.fond_parcelle.min_m,
    result.reculs.implantation_en_limite.autorisee,
    result.stationnement.par_logement,
    result.stationnement.par_100m2,
    result.hauteur.max_m,
    result.ces.max_ratio,
  );
  return result;
}

// ============================================
// Composant RuleCard — NOUVEAU
// ============================================

type RuleCardDef = {
  label: string;
  value: string;
  note?: string | null;
  empty?: boolean;
};

function buildRuleCards(r: ResolvedPluRulesetV1): RuleCardDef[] {
  const fmt = (v: number | null, unit: string): { val: string; empty: boolean } =>
    v !== null ? { val: `${v} ${unit}`, empty: false } : { val: "—", empty: true };

  const fmtPct = (v: number | null): { val: string; empty: boolean } =>
    v !== null ? { val: `${Math.round(v * 100)} %`, empty: false } : { val: "—", empty: true };

  const egout = fmt(r.hauteur.max_m, "m");
  const faitage = fmt(r.hauteur.faitage_m, "m");
  const ces = fmtPct(r.ces.max_ratio);
  const voirie = fmt(r.reculs.voirie.min_m, "m");
  const limites = fmt(r.reculs.limites_separatives.min_m, "m");
  const stat = r.stationnement.par_logement !== null
    ? { val: `${r.stationnement.par_logement} pl/logt`, empty: false }
    : { val: "—", empty: true };
  const pt = fmtPct(r.pleine_terre.ratio_min);
  const cos = r.cos.max !== null
    ? { val: String(r.cos.max), empty: false }
    : { val: "—", empty: true };

  return [
    { label: "HAUTEUR MAX (ÉGOUT)", value: egout.val, empty: egout.empty, note: r.hauteur.note },
    { label: "HAUTEUR FAÎTAGE", value: faitage.val, empty: faitage.empty, note: r.hauteur.faitage_note },
    { label: "EMPRISE AU SOL (CES)", value: ces.val, empty: ces.empty, note: r.ces.note ?? (ces.empty ? "Pas de règle" : undefined) },
    { label: "RECUL VOIRIE", value: voirie.val, empty: voirie.empty, note: r.reculs.voirie.note },
    { label: "RECUL LIMITES", value: limites.val, empty: limites.empty, note: r.reculs.limites_separatives.note },
    { label: "STATIONNEMENT", value: stat.val, empty: stat.empty, note: r.stationnement.note },
    { label: "PLEINE TERRE MIN", value: pt.val, empty: pt.empty, note: r.pleine_terre.note },
    { label: "COS", value: cos.val, empty: cos.empty, note: r.cos.note ?? (cos.empty ? "Pas de COS" : undefined) },
  ];
}

function RuleCard({ card }: { card: RuleCardDef }) {
  return (
    <div className="rule-card">
      <div className="rule-card-label">{card.label}</div>
      <div className={`rule-card-value${card.empty ? " rule-card-value--empty" : ""}`}>
        {card.value}
      </div>
      {card.note && (
        <div className="rule-card-note">{card.note}</div>
      )}
    </div>
  );
}

// ============================================
// Page Component
// ============================================

export default function PluFaisabilite(): React.ReactElement {
  const navigate = useNavigate();

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [communeInsee, setCommuneInsee] = useState<string>(() => readLS(LS_COMMUNE_INSEE, ""));
  const [documents, setDocuments] = useState<PluDocument[]>([]);
  const [docsStatus, setDocsStatus] = useState<Status>("idle");
  const [docsError, setDocsError] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [rulesZones, setRulesZones] = useState<PluRulesZoneRow[]>([]);
  const [rulesStatus, setRulesStatus] = useState<Status>("idle");
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [sqlSummary, setSqlSummary] = useState<PluFrontZoneSummaryRow | null>(null);
  const [detectedZoneCode, setDetectedZoneCode] = useState<string | null>(() => normalizeZoneCode(readLS(LS_DETECTED_ZONE_CODE, "")));
  const [selectedZoneCode, setSelectedZoneCode] = useState<string | null>(() => {
    const stored = normalizeZoneCode(readLS(LS_SELECTED_PLU_ZONE_CODE, ""));
    if (stored) return stored;
    return normalizeZoneCode(readLS(LS_DETECTED_ZONE_CODE, ""));
  });
  const [detectStatus, setDetectStatus] = useState<Status>("idle");
  const [detectError, setDetectError] = useState<string | null>(null);
  const [aiExtractStatus, setAiExtractStatus] = useState<Status>("idle");
  const [aiExtractError, setAiExtractError] = useState<string | null>(null);
  const [aiExtractResult, setAiExtractResult] = useState<PersistedAiExtractResult | null>(() => {
    const storedDocId = readLS(LS_SELECTED_PLU_DOCUMENT_ID, "") || null;
    const storedZoneCode = normalizeZoneCode(readLS(LS_SELECTED_PLU_ZONE_CODE, ""));
    return loadPersistedAiExtractResult(storedDocId, storedZoneCode);
  });
  const [activeResolvedRuleset, setActiveResolvedRuleset] = useState<ResolvedPluRulesetV1 | null>(null);
  const [userOverridesVersion, setUserOverridesVersion] = useState(0);
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [editVoirie, setEditVoirie] = useState("");
  const [editLimites, setEditLimites] = useState("");
  const [editFond, setEditFond] = useState("");
  const [editImplantationEnLimite, setEditImplantationEnLimite] = useState("null");
  const [editHauteur, setEditHauteur] = useState("");
  const [editCes, setEditCes] = useState("");
  const [editStatLogement, setEditStatLogement] = useState("");
  const [editStat100m2, setEditStat100m2] = useState("");
  const [editUserNote, setEditUserNote] = useState("");
  const [sessionParcelId, setSessionParcelId] = useState<string | null>(() => {
    syncSessionFromHandoff();
    return readLS(LS_SESSION_PARCEL_ID, "") || null;
  });
  const [sessionCommuneInsee, setSessionCommuneInsee] = useState<string | null>(() => readLS(LS_SESSION_COMMUNE_INSEE, "") || null);

  const communeInseeRef = useRef(communeInsee);
  const autoDetectAttemptedRef = useRef(false);

  useEffect(() => { communeInseeRef.current = communeInsee; }, [communeInsee]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setAccessToken(session?.access_token ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setAccessToken(s?.access_token ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const buildAuthHeaders = useCallback((extra?: Record<string, string>): Record<string, string> => {
    const headers: Record<string, string> = { ...(extra || {}) };
    if (SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }, [accessToken]);

  const fetchSqlSummary = useCallback(async (effectiveInsee: string, zoneCode: string) => {
    if (!effectiveInsee || !zoneCode) { setSqlSummary(null); return; }
    try {
      const { data, error } = await supabase
        .from("plu_front_zone_summary_v1")
        .select("*")
        .eq("commune_insee", effectiveInsee)
        .eq("zone_code", normalizeZoneCode(zoneCode) ?? zoneCode)
        .order("plu_version_label", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) { setSqlSummary(null); return; }
      setSqlSummary(data ?? null);
    } catch { setSqlSummary(null); }
  }, []);

  useEffect(() => {
    const effectiveInsee = isValidCodeInsee(sessionCommuneInsee || "") ? sessionCommuneInsee! : isValidCodeInsee(communeInsee) ? communeInsee : null;
    if (!effectiveInsee || !selectedZoneCode) { setSqlSummary(null); return; }
    fetchSqlSummary(effectiveInsee, selectedZoneCode);
  }, [selectedZoneCode, communeInsee, sessionCommuneInsee, fetchSqlSummary]);

  const fetchDocuments = useCallback(async (insee: string) => {
    if (!isValidCodeInsee(insee)) { setDocuments([]); setDocsStatus("idle"); setDocsError(null); setSelectedDocumentId(null); setRulesZones([]); setRulesStatus("idle"); setRulesError(null); return; }
    if (!SUPABASE_ANON_KEY) { setDocsError("Configuration manquante : VITE_SUPABASE_ANON_KEY"); setDocsStatus("error"); return; }
    if (!accessToken) { setDocsStatus("idle"); setDocsError(null); return; }
    setDocsStatus("loading"); setDocsError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-documents-list-v1`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ commune_insee: insee }),
      });
      const txt = await res.text();
      const data = safeJsonParse<DocumentsResponse>(txt) ?? { success: false, error: "INVALID_JSON" };
      if (!res.ok || !data.success) throw new Error(data.error || data.message || `Erreur ${res.status}`);
      const docs = data.documents || [];
      setDocuments(docs);
      setDocsStatus("success");
      const hasSelected = selectedDocumentId && docs.some(d => d.id === selectedDocumentId);
      if (!hasSelected) setSelectedDocumentId(docs.length > 0 ? docs[0].id : null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors du chargement des documents.";
      setDocsStatus("error"); setDocsError(msg); setDocuments([]); setSelectedDocumentId(null); setRulesZones([]); setRulesStatus("idle"); setRulesError(null);
    }
  }, [accessToken, buildAuthHeaders, selectedDocumentId]);

  const fetchRulesForDocument = useCallback(async (docId: string) => {
    if (!docId) { setRulesZones([]); setRulesStatus("idle"); setRulesError(null); return; }
    if (!SUPABASE_ANON_KEY) { setRulesError("Configuration manquante : VITE_SUPABASE_ANON_KEY"); setRulesStatus("error"); return; }
    if (!accessToken) { setRulesStatus("idle"); setRulesError(null); return; }
    setRulesStatus("loading"); setRulesError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-rules-list-v1`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ document_id: docId, limit: 50 }),
      });
      const txt = await res.text();
      const data = safeJsonParse<PluRulesListResponse>(txt) ?? ({ success: false, count: 0 } as PluRulesListResponse);
      if (!res.ok || !data.success) throw new Error(data.error || data.message || `Erreur ${res.status}`);
      const zones = (data.zones ?? []).filter(z => z.document_id === docId);
      setRulesZones(zones);
      setRulesStatus("success");
      if (zones.length > 0) {
        const freshSelected = normalizeZoneCode(readLS(LS_SELECTED_PLU_ZONE_CODE, ""));
        const freshDetected = normalizeZoneCode(readLS(LS_DETECTED_ZONE_CODE, ""));
        const current = freshSelected || selectedZoneCode;
        const currentValid = current && zones.some(z => zonesMatch(z.zone_code, current));
        const detectedInZones = freshDetected && zones.some(z => zonesMatch(z.zone_code, freshDetected));
        if (!currentValid) {
          if (detectedInZones) {
            const m = zones.find(z => zonesMatch(z.zone_code, freshDetected));
            if (m) { setSelectedZoneCode(m.zone_code); writeLS(LS_SELECTED_PLU_ZONE_CODE, m.zone_code); }
          } else {
            const m = zones.find(isZoneMeaningful) ?? zones[0];
            setSelectedZoneCode(m.zone_code); writeLS(LS_SELECTED_PLU_ZONE_CODE, m.zone_code);
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors du chargement des règles.";
      setRulesStatus("error"); setRulesError(msg); setRulesZones([]);
    }
  }, [accessToken, buildAuthHeaders, selectedZoneCode, detectedZoneCode]);

  const handleDetectZonePlu = useCallback(async () => {
    const effectiveParcelId = readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId || "";
    const effectiveCommune = readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee || "";
    if (!effectiveParcelId) { setDetectError("Aucune parcelle sélectionnée. Veuillez d'abord sélectionner une parcelle dans Foncier."); setDetectStatus("error"); return; }
    if (!effectiveCommune) { setDetectError("Code INSEE de la commune manquant."); setDetectStatus("error"); return; }
    if (!accessToken) { setDetectError("Connexion requise."); setDetectStatus("error"); return; }
    setDetectStatus("loading"); setDetectError(null);
    const requestBody = { parcel_id: effectiveParcelId, commune_insee: effectiveCommune };
    try {
      let res = await fetch(`${SUPABASE_URL}/functions/v1/plu-from-parcelle-v2`, { method: "POST", headers: buildAuthHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(requestBody) });
      if (res.status === 404) res = await fetch(`${SUPABASE_URL}/functions/v1/plu-from-parcelle`, { method: "POST", headers: buildAuthHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(requestBody) });
      const txt = await res.text();
      const data = safeJsonParse<Record<string, unknown>>(txt);
      if (!res.ok) throw new Error((data?.error as string) || `Erreur ${res.status}`);
      let rawZoneCode: string | null = null;
      if (typeof data?.zone_code === "string" && data.zone_code.trim()) rawZoneCode = data.zone_code;
      else if (typeof (data?.plu as Record<string, unknown>)?.zone_code === "string") rawZoneCode = (data.plu as Record<string, unknown>).zone_code as string;
      else if (typeof data?.zone === "string") rawZoneCode = data.zone;
      const zoneCode = normalizeZoneCode(rawZoneCode);
      if (!zoneCode) throw new Error("Zone PLU non trouvée pour cette parcelle.");
      const matchingZone = rulesZones.find(z => zonesMatch(z.zone_code, zoneCode));
      const finalZoneCode = matchingZone?.zone_code ?? zoneCode;
      setDetectedZoneCode(finalZoneCode); setSelectedZoneCode(finalZoneCode);
      writeLS(LS_DETECTED_ZONE_CODE, finalZoneCode); writeLS(LS_SELECTED_PLU_ZONE_CODE, finalZoneCode);
      setDetectStatus("success"); setDetectError(null);
    } catch (e: unknown) {
      setDetectStatus("error"); setDetectError(e instanceof Error ? e.message : "Erreur lors de la détection.");
    }
  }, [accessToken, buildAuthHeaders, sessionParcelId, sessionCommuneInsee, rulesZones]);

  const handleAiExtractZone = useCallback(async () => {
    if (!selectedDocumentId) { setAiExtractError("Veuillez sélectionner un document PLU."); setAiExtractStatus("error"); return; }
    if (!selectedZoneCode) { setAiExtractError("Veuillez sélectionner ou détecter une zone PLU."); setAiExtractStatus("error"); return; }
    const selectedDoc = documents.find(d => d.id === selectedDocumentId);
    const effectiveCommuneInsee = communeInsee || sessionCommuneInsee || selectedDoc?.commune_insee;
    if (!effectiveCommuneInsee) { setAiExtractError("Code INSEE de la commune manquant."); setAiExtractStatus("error"); return; }
    const sourcePdfUrl = extractPdfUrlFromDocument(selectedDoc);
    if (!sourcePdfUrl) { setAiExtractError("URL PDF introuvable pour ce document."); setAiExtractStatus("error"); return; }
    setAiExtractStatus("loading"); setAiExtractError(null);
    const requestBody = { commune_insee: effectiveCommuneInsee, commune_nom: selectedDoc?.commune_nom ?? selectedDoc?.commune_name ?? null, source_pdf_url: sourcePdfUrl, target_zone_code: selectedZoneCode };
    try {
      const res = await fetch(AI_EXTRACT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "test" }, body: JSON.stringify(requestBody) });
      const txt = await res.text();
      const rawData = safeJsonParse<PluParserResponse>(txt);
      if (!res.ok) throw new Error(typeof rawData?.error === "string" ? rawData.error : `Erreur ${res.status}`);
      const zonesRulesets = rawData?.zones_rulesets;
      if (!zonesRulesets || !Array.isArray(zonesRulesets) || zonesRulesets.length === 0) throw new Error("Aucun ruleset trouvé dans la réponse du parser.");
      const matchingZone = zonesRulesets.find(z => zonesMatch(z.zone_code, selectedZoneCode));
      if (!matchingZone) {
        const available = zonesRulesets.map(z => z.zone_code).filter(Boolean).join(", ");
        throw new Error(`Zone ${selectedZoneCode} non trouvée. Zones disponibles : ${available || "(aucune)"}`);
      }
      const normalizedAiData = convertParserRulesetToAiExtractResult(matchingZone.ruleset ?? {}, matchingZone.zone_libelle ?? null);
      const persistedResult: PersistedAiExtractResult = { document_id: selectedDocumentId, zone_code: selectedZoneCode, commune_insee: effectiveCommuneInsee, extracted_at: new Date().toISOString(), data: normalizedAiData };
      writeLS(LS_PLU_AI_EXTRACT_RESULT, JSON.stringify(persistedResult));
      setAiExtractResult(persistedResult);
      const aiRuleset = buildResolvedRulesetFromAi(normalizedAiData, selectedDocumentId, effectiveCommuneInsee, selectedZoneCode);
      const baseZoneData = rulesZones.find(z => zonesMatch(z.zone_code, selectedZoneCode));
      let finalRuleset = baseZoneData ? mergeRulesets(resolvePluRulesetV1(baseZoneData), aiRuleset) : aiRuleset;
      const userOverrideEntry = getUserOverrideEntry(selectedDocumentId, selectedZoneCode);
      if (userOverrideEntry) finalRuleset = applyUserOverrides(finalRuleset, userOverrideEntry.overrides);
      setActiveResolvedRuleset(finalRuleset);
      writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(finalRuleset));
      if (selectedZoneCode) writeLS(LS_SELECTED_PLU_ZONE_CODE, selectedZoneCode);
      setAiExtractStatus("success"); setAiExtractError(null);
    } catch (e: unknown) {
      setAiExtractStatus("error"); setAiExtractError(e instanceof Error ? e.message : "Erreur lors de l'extraction.");
    }
  }, [selectedDocumentId, selectedZoneCode, documents, communeInsee, sessionCommuneInsee, rulesZones]);

  useEffect(() => {
    if (aiExtractResult) {
      if (aiExtractResult.document_id !== selectedDocumentId || !zonesMatch(aiExtractResult.zone_code, selectedZoneCode)) {
        setAiExtractResult(null); setActiveResolvedRuleset(null); setAiExtractStatus("idle"); setAiExtractError(null);
      }
    } else if (activeResolvedRuleset && !zonesMatch(activeResolvedRuleset.zone_code, selectedZoneCode)) {
      setActiveResolvedRuleset(null);
    }
  }, [selectedDocumentId, selectedZoneCode, aiExtractResult, activeResolvedRuleset]);

  useEffect(() => {
    const syncFromLS = () => {
      const handoffResult = syncSessionFromHandoff();
      const sessionInsee = readLS(LS_SESSION_COMMUNE_INSEE, "");
      const sessionParcel = readLS(LS_SESSION_PARCEL_ID, "");
      setSessionParcelId(sessionParcel || handoffResult.parcelId || null);
      setSessionCommuneInsee(sessionInsee || handoffResult.communeInsee || null);
      const storedDetected = normalizeZoneCode(readLS(LS_DETECTED_ZONE_CODE, ""));
      if (storedDetected && !zonesMatch(storedDetected, detectedZoneCode)) setDetectedZoneCode(storedDetected);
      const effectiveInsee = isValidCodeInsee(sessionInsee || "") ? sessionInsee : isValidCodeInsee(communeInseeRef.current) ? communeInseeRef.current : "";
      if (effectiveInsee && effectiveInsee !== communeInseeRef.current) { setCommuneInsee(effectiveInsee); writeLS(LS_COMMUNE_INSEE, effectiveInsee); }
    };
    const interval = window.setInterval(syncFromLS, 1500);
    const handleStorage = (e: StorageEvent) => {
      if ([LS_COMMUNE_INSEE, LS_SESSION_COMMUNE_INSEE, LS_SESSION_PARCEL_ID, LS_DETECTED_ZONE_CODE, LS_SELECTED_PARCELS_V1].includes(e.key ?? "")) syncFromLS();
    };
    window.addEventListener("storage", handleStorage);
    syncFromLS();
    return () => { window.clearInterval(interval); window.removeEventListener("storage", handleStorage); };
  }, [detectedZoneCode]);

  useEffect(() => {
    if (communeInsee && accessToken) fetchDocuments(communeInsee);
    else { setDocuments([]); setDocsStatus("idle"); setDocsError(null); setSelectedDocumentId(null); setRulesZones([]); setRulesStatus("idle"); setRulesError(null); }
  }, [communeInsee, accessToken, fetchDocuments]);

  useEffect(() => {
    if (!selectedDocumentId || !accessToken) { setRulesZones([]); setRulesStatus("idle"); setRulesError(null); return; }
    fetchRulesForDocument(selectedDocumentId);
  }, [selectedDocumentId, accessToken, fetchRulesForDocument]);

  useEffect(() => {
    if (autoDetectAttemptedRef.current) return;
    const freshParcelId = readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId;
    const freshCommuneInsee = readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee;
    if (accessToken && freshParcelId && freshCommuneInsee && detectStatus === "idle" && !detectedZoneCode && rulesStatus === "success" && selectedDocumentId && rulesZones.length > 0) {
      autoDetectAttemptedRef.current = true;
      const timer = setTimeout(() => handleDetectZonePlu(), 300);
      return () => clearTimeout(timer);
    }
  }, [accessToken, sessionParcelId, sessionCommuneInsee, detectStatus, detectedZoneCode, rulesStatus, selectedDocumentId, rulesZones.length, handleDetectZonePlu]);

  const selectedDoc = useMemo(() => selectedDocumentId ? documents.find(d => d.id === selectedDocumentId) ?? null : null, [documents, selectedDocumentId]);

  const baseResolvedRuleset = useMemo<ResolvedPluRulesetV1 | null>(() => {
    if (!selectedZoneCode || rulesZones.length === 0) return null;
    const z = rulesZones.find(z => zonesMatch(z.zone_code, selectedZoneCode));
    return z ? resolvePluRulesetV1(z) : null;
  }, [selectedZoneCode, rulesZones]);

  const aiResolvedRuleset = useMemo<ResolvedPluRulesetV1 | null>(() => {
    if (!aiExtractResult?.data || aiExtractResult.document_id !== selectedDocumentId || !zonesMatch(aiExtractResult.zone_code, selectedZoneCode)) return null;
    return buildResolvedRulesetFromAi(aiExtractResult.data, aiExtractResult.document_id, aiExtractResult.commune_insee, aiExtractResult.zone_code);
  }, [aiExtractResult, selectedDocumentId, selectedZoneCode]);

  const currentUserOverrides = useMemo<UserOverrideEntry | null>(() => {
    const _v = userOverridesVersion; void _v;
    return getUserOverrideEntry(selectedDocumentId, selectedZoneCode);
  }, [selectedDocumentId, selectedZoneCode, userOverridesVersion]);

  const resolvedRuleset = useMemo<ResolvedPluRulesetV1 | null>(() => {
    if (sqlSummary && zonesMatch(sqlSummary.zone_code, selectedZoneCode)) {
      const fromSql = buildResolvedFromSqlSummary(sqlSummary, selectedDocumentId);
      return currentUserOverrides ? applyUserOverrides(fromSql, currentUserOverrides.overrides) : fromSql;
    }
    let base: ResolvedPluRulesetV1 | null = null;
    if (activeResolvedRuleset && zonesMatch(activeResolvedRuleset.zone_code, selectedZoneCode)) base = activeResolvedRuleset;
    else if (aiResolvedRuleset && baseResolvedRuleset) base = mergeRulesets(baseResolvedRuleset, aiResolvedRuleset);
    else if (aiResolvedRuleset) base = aiResolvedRuleset;
    else if (baseResolvedRuleset) base = baseResolvedRuleset;
    if (!base) return null;
    return currentUserOverrides ? applyUserOverrides(base, currentUserOverrides.overrides) : base;
  }, [sqlSummary, selectedZoneCode, selectedDocumentId, activeResolvedRuleset, baseResolvedRuleset, aiResolvedRuleset, currentUserOverrides]);

  const persistPluToSnapshot = useCallback(() => {
    try {
      const effectiveParcelId = sessionParcelId || readLS(LS_SESSION_PARCEL_ID, "") || undefined;
      const effectiveCommuneInsee = sessionCommuneInsee || readLS(LS_SESSION_COMMUNE_INSEE, "") || undefined;
      const effectiveAddress = readLS(LS_SESSION_ADDRESS, "") || undefined;
      if (effectiveParcelId || effectiveCommuneInsee || effectiveAddress) {
        patchPromoteurSnapshot({ project: { parcelId: effectiveParcelId, commune_insee: effectiveCommuneInsee, address: effectiveAddress } });
      }
      if (resolvedRuleset) {
        const v = resolvedRuleset.reculs.voirie.min_m ?? "?";
        const l = resolvedRuleset.reculs.limites_separatives.min_m ?? "?";
        const f = resolvedRuleset.reculs.fond_parcelle.min_m ?? "?";
        patchModule("plu", {
          ok: resolvedRuleset.completeness?.ok === true,
          summary: `Zone ${resolvedRuleset.zone_code} · Reculs voirie ${v}m / limites ${l}m / fond ${f}m`,
          data: { document_id: selectedDocumentId, zone_code: resolvedRuleset.zone_code, zone_libelle: resolvedRuleset.zone_libelle, ruleset: resolvedRuleset, detectedZoneCode, selectedZoneCode, aiExtractResult, sqlSummary, currentUserOverrides, session: { parcel_id: effectiveParcelId || null, commune_insee: effectiveCommuneInsee || null, address: effectiveAddress || null } },
        });
      }
    } catch { /* non-bloquant */ }
  }, [resolvedRuleset, selectedDocumentId, selectedZoneCode, detectedZoneCode, sessionParcelId, sessionCommuneInsee, aiExtractResult, sqlSummary, currentUserOverrides]);

  useEffect(() => { persistPluToSnapshot(); }, [resolvedRuleset, selectedDocumentId, selectedZoneCode, detectedZoneCode, sessionParcelId, sessionCommuneInsee, aiExtractResult, sqlSummary, currentUserOverrides, persistPluToSnapshot]);

  useEffect(() => {
    if (editPanelOpen && resolvedRuleset) {
      setEditVoirie(resolvedRuleset.reculs.voirie.min_m !== null ? String(resolvedRuleset.reculs.voirie.min_m) : "");
      setEditLimites(resolvedRuleset.reculs.limites_separatives.min_m !== null ? String(resolvedRuleset.reculs.limites_separatives.min_m) : "");
      setEditFond(resolvedRuleset.reculs.fond_parcelle.min_m !== null ? String(resolvedRuleset.reculs.fond_parcelle.min_m) : "");
      setEditImplantationEnLimite(resolvedRuleset.reculs.implantation_en_limite.autorisee === null ? "null" : resolvedRuleset.reculs.implantation_en_limite.autorisee ? "true" : "false");
      setEditHauteur(resolvedRuleset.hauteur.max_m !== null ? String(resolvedRuleset.hauteur.max_m) : "");
      setEditCes(resolvedRuleset.ces.max_ratio !== null ? String(Math.round(resolvedRuleset.ces.max_ratio * 100)) : "");
      setEditStatLogement(resolvedRuleset.stationnement.par_logement !== null ? String(resolvedRuleset.stationnement.par_logement) : "");
      setEditStat100m2(resolvedRuleset.stationnement.par_100m2 !== null ? String(resolvedRuleset.stationnement.par_100m2) : "");
      const existingNote = resolvedRuleset.notes.find(n => n.startsWith("[Note utilisateur]"));
      setEditUserNote(existingNote ? existingNote.replace("[Note utilisateur] ", "") : "");
    }
  }, [editPanelOpen, resolvedRuleset]);

  const handleSaveOverrides = useCallback(() => {
    if (!selectedDocumentId || !selectedZoneCode) return;
    const overrides: UserOverrideValues = {
      reculs: {
        voirie_min_m: editVoirie.trim() ? toNumber(editVoirie) : undefined,
        limites_separatives_min_m: editLimites.trim() ? toNumber(editLimites) : undefined,
        fond_parcelle_min_m: editFond.trim() ? toNumber(editFond) : undefined,
        implantation_en_limite_autorisee: editImplantationEnLimite === "null" ? undefined : editImplantationEnLimite === "true" ? true : false,
      },
      ces_max_ratio: editCes.trim() ? (toNumber(editCes) ?? 0) / 100 : undefined,
      hauteur_max_m: editHauteur.trim() ? toNumber(editHauteur) : undefined,
      stationnement_par_logement: editStatLogement.trim() ? toNumber(editStatLogement) : undefined,
      stationnement_par_100m2: editStat100m2.trim() ? toNumber(editStat100m2) : undefined,
      notes_append: editUserNote.trim() || undefined,
    };
    // Clean undefined
    Object.keys(overrides.reculs).forEach(k => { if ((overrides.reculs as Record<string, unknown>)[k] === undefined) delete (overrides.reculs as Record<string, unknown>)[k]; });
    if (overrides.ces_max_ratio === undefined) delete overrides.ces_max_ratio;
    if (overrides.hauteur_max_m === undefined) delete overrides.hauteur_max_m;
    if (overrides.stationnement_par_logement === undefined) delete overrides.stationnement_par_logement;
    if (overrides.stationnement_par_100m2 === undefined) delete overrides.stationnement_par_100m2;
    if (overrides.notes_append === undefined) delete overrides.notes_append;
    const allOverrides = loadUserOverrides();
    allOverrides[getUserOverrideKey(selectedDocumentId, selectedZoneCode)] = { updated_at: new Date().toISOString(), overrides };
    saveUserOverrides(allOverrides);
    setUserOverridesVersion(v => v + 1);
    if (resolvedRuleset) {
      const updated = applyUserOverrides(resolvedRuleset, overrides);
      writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(updated));
      setActiveResolvedRuleset(updated);
    }
    setEditPanelOpen(false);
  }, [selectedDocumentId, selectedZoneCode, editVoirie, editLimites, editFond, editImplantationEnLimite, editHauteur, editCes, editStatLogement, editStat100m2, editUserNote, resolvedRuleset]);

  const handleResetOverrides = useCallback(() => {
    if (!selectedDocumentId || !selectedZoneCode) return;
    const allOverrides = loadUserOverrides();
    delete allOverrides[getUserOverrideKey(selectedDocumentId, selectedZoneCode)];
    saveUserOverrides(allOverrides);
    setUserOverridesVersion(v => v + 1);
    setActiveResolvedRuleset(null);
    setEditPanelOpen(false);
  }, [selectedDocumentId, selectedZoneCode]);

  const canLaunchImplantation2D = useMemo(() => Boolean(selectedDocumentId) && Boolean(communeInsee) && Boolean(selectedZoneCode) && rulesStatus === "success" && rulesZones.length > 0 && resolvedRuleset !== null, [selectedDocumentId, communeInsee, selectedZoneCode, rulesStatus, rulesZones.length, resolvedRuleset]);
  const canAiExtract = useMemo(() => {
    const doc = selectedDocumentId ? documents.find(d => d.id === selectedDocumentId) : null;
    return Boolean(selectedDocumentId) && Boolean(selectedZoneCode) && Boolean(communeInsee || sessionCommuneInsee || doc?.commune_insee) && extractPdfUrlFromDocument(doc) !== null;
  }, [selectedDocumentId, selectedZoneCode, documents, communeInsee, sessionCommuneInsee]);
  const canDetectZone = useMemo(() => Boolean(accessToken) && Boolean(readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId) && Boolean(readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee), [accessToken, sessionParcelId, sessionCommuneInsee]);

  const handleLaunchImplantation2D = useCallback(() => {
    if (!selectedDocumentId || !communeInsee || !selectedZoneCode || !resolvedRuleset) { window.alert("Données manquantes pour lancer l'Implantation 2D."); return; }
    const missingReculs: string[] = [];
    if (resolvedRuleset.reculs.voirie.min_m === null) missingReculs.push("voirie");
    if (resolvedRuleset.reculs.limites_separatives.min_m === null) missingReculs.push("limites séparatives");
    if (resolvedRuleset.reculs.fond_parcelle.min_m === null) missingReculs.push("fond de parcelle");
    if (missingReculs.length > 0) {
      const proceed = window.confirm(`⚠️ Reculs manquants : ${missingReculs.join(", ")}.\n\nVoulez-vous continuer ?`);
      if (!proceed) return;
    }
    writeLS(LS_SELECTED_PLU_DOCUMENT_ID, selectedDocumentId);
    writeLS(LS_SELECTED_PLU_COMMUNE_INSEE, communeInsee);
    writeLS(LS_SELECTED_PLU_ZONE_CODE, selectedZoneCode);
    writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(resolvedRuleset));
    persistPluToSnapshot();
    const freshParcelId = readLS(LS_SESSION_PARCEL_ID, "") || sessionParcelId || "";
    const freshCommuneInsee = readLS(LS_SESSION_COMMUNE_INSEE, "") || sessionCommuneInsee || "";
    const params = new URLSearchParams();
    if (freshParcelId) params.set("parcel_id", freshParcelId);
    if (freshCommuneInsee) params.set("commune_insee", freshCommuneInsee);
    navigate(`/promoteur/implantation-2d${params.toString() ? `?${params.toString()}` : ""}`, { state: { pluRuleset: resolvedRuleset } });
  }, [selectedDocumentId, communeInsee, selectedZoneCode, resolvedRuleset, sessionParcelId, sessionCommuneInsee, navigate, persistPluToSnapshot]);

  const meaningfulZonesCount = useMemo(() => rulesZones.filter(isZoneMeaningful).length, [rulesZones]);
  const detectedZoneExists = useMemo(() => detectedZoneCode ? rulesZones.some(z => zonesMatch(z.zone_code, detectedZoneCode)) : false, [detectedZoneCode, rulesZones]);

  return (
    <div className="plu-faisabilite-page">
      <style>{pageStyles}</style>

      <header className="page-header">
        <h1 className="page-title">PLU & Faisabilité</h1>
        <p className="page-description">Gérez vos documents PLU et analysez la faisabilité de vos projets immobiliers.</p>
        <div className="env-badge">
          <span className="env-pill">Supabase: {SUPABASE_URL.includes("127.0.0.1") ? "LOCAL" : "REMOTE"}</span>
          <span className="env-pill" style={{ marginLeft: 8 }}>Parser: {AI_EXTRACT_ENDPOINT.includes("localhost") ? "LOCAL" : "REMOTE"}</span>
        </div>
      </header>

      {!accessToken && (
        <section className="page-section">
          <div className="auth-required-card">
            <span className="auth-icon">🔒</span>
            <h3 className="auth-title">Connexion requise</h3>
            <p className="auth-text">Vous devez être connecté pour accéder aux analyses de faisabilité.</p>
            <button className="auth-login-btn" onClick={() => navigate("/login")}>Se connecter</button>
          </div>
        </section>
      )}

      <section className="page-section"><PluUploaderPanel /></section>

      <section className="page-section">
        <div className="placeholder-card">
          <div className="section-header">
            <h3 className="placeholder-title">📊 Analyses de faisabilité</h3>
            <div className="analysis-actions">
              <button className="secondary-btn" onClick={handleDetectZonePlu} disabled={!canDetectZone || detectStatus === "loading"}>
                {detectStatus === "loading" ? "Détection…" : "Détecter zone PLU"}
              </button>
              <button className="ai-extract-btn" onClick={handleAiExtractZone} disabled={!canAiExtract || aiExtractStatus === "loading"}>
                {aiExtractStatus === "loading" ? <><span className="ai-spinner">⏳</span> Extraction…</> : <><span className="ai-icon">🤖</span> Extraire règles IA</>}
              </button>
              <button className="primary-btn" onClick={handleLaunchImplantation2D} disabled={!canLaunchImplantation2D || !accessToken}>
                Lancer l'Implantation 2D
              </button>
            </div>
          </div>

          <p className="placeholder-text">Le document sélectionné sera utilisé dans l'Implantation 2D.{selectedDoc ? <> Document : <code>{selectedDoc.id}</code></> : null}</p>

          {(sessionParcelId || readLS(LS_SESSION_PARCEL_ID, "")) && (
            <div className="session-info">
              <span className="session-label">Parcelle active :</span>
              <code className="session-value">{sessionParcelId || readLS(LS_SESSION_PARCEL_ID, "")}</code>
              {(sessionCommuneInsee || readLS(LS_SESSION_COMMUNE_INSEE, "")) && (<><span className="session-separator">—</span><span className="session-label">Commune :</span><code className="session-value">{sessionCommuneInsee || readLS(LS_SESSION_COMMUNE_INSEE, "")}</code></>)}
            </div>
          )}

          {detectedZoneCode && (
            <div className="detected-zone-info">
              <span className="detected-badge">Zone détectée : {detectedZoneCode}</span>
              {!detectedZoneExists && rulesZones.length > 0 && <span className="detected-warning">⚠️ La zone {detectedZoneCode} n'est pas présente dans ce document.</span>}
            </div>
          )}

          {selectedDocumentId && selectedZoneCode && resolvedRuleset && (
            <div className="user-override-panel">
              <div className="user-override-warning">
                <span className="warning-icon">⚠️</span>
                <span className="warning-text">Les règles affichées proviennent d'une extraction automatisée. Vérifiez avec le document officiel.</span>
              </div>
              <button className="toggle-edit-btn" onClick={() => setEditPanelOpen(!editPanelOpen)}>
                {editPanelOpen ? "▲ Fermer le formulaire" : "✏️ Modifier / Compléter les règles"}
              </button>
              {currentUserOverrides && (
                <div className="user-override-indicator">
                  <span className="override-badge">✅ Corrections utilisateur appliquées</span>
                  <span className="override-time">Modifié le {new Date(currentUserOverrides.updated_at).toLocaleString("fr-FR")}</span>
                </div>
              )}
              {editPanelOpen && (
                <div className="edit-form">
                  <div className="edit-form-grid">
                    {[
                      { label: "Recul voirie (m)", val: editVoirie, set: setEditVoirie, ph: "ex: 3" },
                      { label: "Recul limites séparatives (m)", val: editLimites, set: setEditLimites, ph: "ex: 2" },
                      { label: "Recul fond de parcelle (m)", val: editFond, set: setEditFond, ph: "ex: 6" },
                      { label: "Hauteur max égout (m)", val: editHauteur, set: setEditHauteur, ph: "ex: 10" },
                      { label: "CES max (%)", val: editCes, set: setEditCes, ph: "ex: 40" },
                      { label: "Stationnement / logement", val: editStatLogement, set: setEditStatLogement, ph: "ex: 2" },
                      { label: "Stationnement / 100m²", val: editStat100m2, set: setEditStat100m2, ph: "ex: 2" },
                    ].map(({ label, val, set, ph }) => (
                      <div key={label} className="edit-form-field">
                        <label className="edit-label">{label}</label>
                        <input type="text" className="edit-input" value={val} onChange={e => set(e.target.value)} placeholder={ph} />
                      </div>
                    ))}
                    <div className="edit-form-field">
                      <label className="edit-label">Implantation en limite</label>
                      <select className="edit-select" value={editImplantationEnLimite} onChange={e => setEditImplantationEnLimite(e.target.value)}>
                        <option value="null">Non déterminable</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </select>
                    </div>
                  </div>
                  <div className="edit-form-field edit-form-field--full">
                    <label className="edit-label">Note utilisateur <span className="optional-tag">optionnel</span></label>
                    <textarea className="edit-textarea" value={editUserNote} onChange={e => setEditUserNote(e.target.value)} placeholder="Ajoutez une note personnelle..." rows={2} />
                  </div>
                  <div className="edit-form-actions">
                    <button className="save-btn" onClick={handleSaveOverrides}>💾 Enregistrer</button>
                    {currentUserOverrides && <button className="reset-btn" onClick={handleResetOverrides}>🗑️ Réinitialiser</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Extract result summary */}
          {(aiExtractResult || aiExtractStatus === "error") && (
            <div className={`ai-extract-result-card ${aiExtractResult?.data?.completeness_ok ? "ai-extract-result-card--complete" : "ai-extract-result-card--incomplete"}`}>
              <div className="ai-extract-result-header">
                <span className="ai-extract-result-icon">🤖</span>
                <span className="ai-extract-result-title">Règles IA (zone {aiExtractResult?.zone_code || selectedZoneCode})</span>
                {aiExtractResult && <span className="ai-extract-result-time">Extrait le {new Date(aiExtractResult.extracted_at).toLocaleString("fr-FR")}</span>}
              </div>
              {aiExtractStatus === "error" && aiExtractError && (
                <div className="ai-extract-error"><span className="ai-extract-error-icon">❌</span><span className="ai-extract-error-text">{aiExtractError}</span></div>
              )}
              {aiExtractResult?.data && (
                <div className="ai-extract-result-content">
                  <div className="ai-extract-result-row">
                    <span className="ai-extract-result-label">Complétude :</span>
                    <span className={`ai-extract-result-value ${aiExtractResult.data.completeness_ok && aiExtractResult.data.missing.length === 0 ? "ai-extract-value--ok" : "ai-extract-value--ko"}`}>
                      {aiExtractResult.data.completeness_ok && aiExtractResult.data.missing.length === 0 ? "✅ Complet" : `⚠️ ${aiExtractResult.data.missing.length} champ(s) manquant(s)`}
                    </span>
                  </div>
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
                    <li key={i} className={m.includes("(optionnel)") ? "non-blocking" : "blocking"}>
                      {m.replace(" (optionnel)", "")}
                      {m.includes("(optionnel)") && <span className="non-blocking-tag">optionnel</span>}
                    </li>
                  ))}
                </ul>
                <p className="completeness-hint">💡 Utilisez « Modifier / Compléter les règles » pour saisir les données manquantes.</p>
              </div>
            </div>
          )}

          {detectError && <p className="detect-error-text">{detectError}</p>}

          {/* Zone select toolbar */}
          {rulesStatus === "success" && rulesZones.length > 0 && (
            <div className="rules-toolbar">
              <span className="rules-count">{rulesZones.length} zone{rulesZones.length > 1 ? "s" : ""}{meaningfulZonesCount < rulesZones.length && <span className="rules-count-detail"> ({meaningfulZonesCount} avec règles)</span>}</span>
              <label className="rules-select-label">
                Zone :
                <select className="rules-select" value={selectedZoneCode ?? ""} onChange={e => {
                  const newZone = e.target.value || null;
                  setSelectedZoneCode(newZone);
                  if (newZone) writeLS(LS_SELECTED_PLU_ZONE_CODE, newZone);
                  setAiExtractResult(null); setActiveResolvedRuleset(null); setAiExtractStatus("idle"); setAiExtractError(null); setEditPanelOpen(false);
                }}>
                  {rulesZones.map(z => (
                    <option key={`${z.document_id}:${z.zone_code}`} value={z.zone_code}>
                      {z.zone_code}{getZoneLibelle(z) !== "Non trouvé" ? ` — ${getZoneLibelle(z)}` : ""}{zonesMatch(z.zone_code, detectedZoneCode) ? " ★" : ""}{!isZoneMeaningful(z) ? " (vide)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Zone cards */}
          {rulesStatus === "success" && rulesZones.length > 0 && (
            <div className="rules-zones">
              {rulesZones
                .filter(z => selectedZoneCode ? zonesMatch(z.zone_code, selectedZoneCode) : true)
                .map(z => {
                  const useResolved = resolvedRuleset && selectedZoneCode && zonesMatch(z.zone_code, selectedZoneCode) && zonesMatch(resolvedRuleset.zone_code, z.zone_code);
                  const isDetectedZone = zonesMatch(z.zone_code, detectedZoneCode);
                  const hasAiData = aiExtractResult && zonesMatch(aiExtractResult.zone_code, z.zone_code) && aiExtractResult.document_id === selectedDocumentId;
                  const hasUserOverrides = currentUserOverrides && zonesMatch(z.zone_code, selectedZoneCode);
                  const hasSqlData = sqlSummary && zonesMatch(sqlSummary.zone_code, z.zone_code);
                  const zoneLibelle = useResolved && resolvedRuleset?.zone_libelle ? resolvedRuleset.zone_libelle : getZoneLibelle(z);
                  const cards = useResolved && resolvedRuleset ? buildRuleCards(resolvedRuleset) : null;
                  const source = useResolved ? resolvedRuleset?.source : z.source;
                  const confidence = useResolved ? resolvedRuleset?.confidence_score : z.confidence_score;

                  return (
                    <div key={`${z.document_id}:${z.zone_code}`} className={[
                      "rule-zone-card",
                      isDetectedZone ? "rule-zone-card--detected" : "",
                      hasSqlData ? "rule-zone-card--sql" : hasAiData ? "rule-zone-card--ai" : "",
                      hasUserOverrides ? "rule-zone-card--user" : "",
                    ].filter(Boolean).join(" ")}>
                      <div className="rule-zone-header">
                        <div className="rule-zone-title">
                          <span className="zone-pill">{z.zone_code}</span>
                          <span className="zone-libelle">{zoneLibelle}</span>
                          {isDetectedZone && <span className="zone-detected-badge">★ Parcelle</span>}
                          {hasSqlData && <span className="zone-sql-badge">🗄️ SQL</span>}
                          {hasAiData && !hasSqlData && <span className="zone-ai-badge">🤖 IA</span>}
                          {hasUserOverrides && <span className="zone-user-badge">✏️ Corrigé</span>}
                        </div>
                        <div className="rule-zone-meta">
                          <span className="confidence-pill">Confiance : {confidence !== null && confidence !== undefined ? `${confidence}%` : "Non trouvé"}</span>
                          <span className="source-pill">{source || "?"}</span>
                        </div>
                      </div>

                      {/* NOUVELLE GRILLE DE CARTES */}
                      {cards ? (
                        <div className="rule-cards-grid">
                          {cards.map(card => <RuleCard key={card.label} card={card} />)}
                        </div>
                      ) : (
                        <div className="zone-empty-message">
                          Aucune règle extraite pour cette zone.
                          <span className="zone-empty-hint">💡 Utilisez « Extraire règles IA » ou « Modifier / Compléter ».</span>
                        </div>
                      )}

                      {/* Notes générales */}
                      {useResolved && resolvedRuleset && resolvedRuleset.notes.length > 0 && (
                        <div className="rule-notes">
                          <div className="rule-notes-title">Notes</div>
                          <ul className="rule-notes-list">
                            {resolvedRuleset.notes.slice(0, 10).map((n, i) => <li key={i}>{n}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* États vides / chargement */}
          {!accessToken && (
            <div className="placeholder-empty">
              <span className="placeholder-icon">🔒</span>
              <span>Connectez-vous pour accéder aux analyses.</span>
            </div>
          )}
          {accessToken && !communeInsee && (
            <div className="placeholder-empty">
              <span className="placeholder-icon">🔍</span>
              <span>Sélectionnez une commune, puis un document PLU.</span>
            </div>
          )}
          {accessToken && communeInsee && docsStatus === "loading" && (
            <div className="placeholder-empty"><span className="placeholder-icon">⏳</span><span>Chargement des documents…</span></div>
          )}
          {accessToken && communeInsee && docsStatus === "error" && (
            <><p className="error-text">{docsError}</p><div className="placeholder-empty"><span className="placeholder-icon">⚠️</span><span>Erreur lors du chargement des documents</span></div></>
          )}
          {accessToken && communeInsee && docsStatus === "success" && documents.length === 0 && (
            <div className="placeholder-empty"><span className="placeholder-icon">📂</span><span>Aucun document PLU pour cette commune.</span></div>
          )}
          {accessToken && communeInsee && docsStatus === "success" && documents.length > 0 && !selectedDocumentId && (
            <div className="placeholder-empty"><span className="placeholder-icon">📄</span><span>Sélectionnez un document PLU ci-dessus.</span></div>
          )}
          {accessToken && selectedDocumentId && rulesStatus === "loading" && (
            <div className="placeholder-empty"><span className="placeholder-icon">⏳</span><span>Chargement des règles…</span></div>
          )}
          {accessToken && selectedDocumentId && rulesStatus === "error" && (
            <><p className="error-text">{rulesError}</p><div className="placeholder-empty"><span className="placeholder-icon">⚠️</span><span>Erreur lors du chargement des règles</span></div></>
          )}
          {accessToken && selectedDocumentId && rulesStatus === "success" && rulesZones.length === 0 && (
            <div className="placeholder-empty"><span className="placeholder-icon">📄</span><span>Aucune règle normalisée pour ce document.</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

// ============================================
// Styles
// ============================================

const pageStyles = `
.plu-faisabilite-page { max-width: 1200px; margin: 0 auto; padding: 24px; }
.page-header { margin-bottom: 32px; }
.page-title { font-size: 1.75rem; font-weight: 700; color: var(--text-primary, #111827); margin: 0 0 8px 0; }
.page-description { font-size: 1rem; color: var(--text-secondary, #6b7280); margin: 0; }
.env-badge { margin-top: 12px; }
.env-pill { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px; background: var(--bg-muted, #f9fafb); border: 1px solid var(--border-color, #e5e7eb); color: var(--text-secondary, #6b7280); font-size: 0.75rem; }
.page-section { margin-bottom: 24px; }

.auth-required-card { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border: 1px solid #fbbf24; border-radius: 12px; padding: 32px 24px; text-align: center; }
.auth-icon { font-size: 3rem; display: block; margin-bottom: 16px; }
.auth-title { font-size: 1.25rem; font-weight: 600; color: #92400e; margin: 0 0 8px 0; }
.auth-text { font-size: 0.9375rem; color: #a16207; margin: 0 0 16px 0; }
.auth-login-btn { display: inline-block; padding: 10px 24px; font-size: 0.9375rem; font-weight: 600; color: #fff; background: #92400e; border: none; border-radius: 8px; cursor: pointer; }
.auth-login-btn:hover { background: #78350f; }

.placeholder-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 12px; flex-wrap: wrap; }
.primary-btn { border: 1px solid var(--border-color, #e5e7eb); background: var(--text-primary, #111827); color: #fff; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: .875rem; font-weight: 600; }
.primary-btn:disabled { opacity: .5; cursor: not-allowed; }
.secondary-btn { border: 1px solid var(--border-color, #e5e7eb); background: var(--card-bg, #fff); color: var(--text-primary, #111827); border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: .875rem; font-weight: 600; transition: background .15s; }
.secondary-btn:hover:not(:disabled) { background: var(--bg-muted, #f9fafb); }
.secondary-btn:disabled { opacity: .5; cursor: not-allowed; }
.ai-extract-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(139,92,246,.4); background: linear-gradient(135deg,rgba(139,92,246,.08),rgba(167,139,250,.12)); color: #7c3aed; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: .875rem; font-weight: 600; transition: background .15s,transform .1s; }
.ai-extract-btn:hover:not(:disabled) { background: linear-gradient(135deg,rgba(139,92,246,.15),rgba(167,139,250,.2)); transform: translateY(-1px); }
.ai-extract-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.ai-icon,.ai-spinner { font-size: 1rem; }
.analysis-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.placeholder-title { font-size: 1.125rem; font-weight: 600; color: var(--text-primary, #111827); margin: 0; }
.placeholder-text { font-size: .875rem; color: var(--text-secondary, #6b7280); margin: 0 0 16px 0; }
.placeholder-text code { font-family: monospace; font-size: .75rem; background: var(--code-bg, #f3f4f6); padding: 2px 6px; border-radius: 6px; }
.error-text { font-size: .875rem; color: #b91c1c; margin: 0 0 16px 0; }
.placeholder-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; background: var(--bg-muted, #f9fafb); border-radius: 8px; color: var(--text-muted, #9ca3af); font-size: .875rem; gap: 12px; margin-top: 16px; }
.placeholder-icon { font-size: 2.5rem; opacity: .5; }

.session-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; padding: 8px 12px; background: rgba(99,102,241,.08); border: 1px solid rgba(99,102,241,.2); border-radius: 8px; font-size: .8125rem; }
.session-label { color: var(--text-secondary, #6b7280); }
.session-value { font-family: monospace; font-size: .75rem; background: var(--code-bg, #f3f4f6); padding: 2px 6px; border-radius: 4px; }
.session-separator { color: var(--text-muted, #9ca3af); }

.detected-zone-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.detected-badge { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.3); color: #047857; font-size: .8125rem; font-weight: 600; }
.detected-warning { font-size: .75rem; color: #b45309; max-width: 400px; }

.detect-error-text { font-size: .875rem; color: #b91c1c; margin: 0 0 12px; padding: 8px 12px; background: rgba(185,28,28,.08); border: 1px solid rgba(185,28,28,.2); border-radius: 8px; }

.user-override-panel { margin: 16px 0; padding: 16px; background: rgba(59,130,246,.04); border: 1px solid rgba(59,130,246,.2); border-radius: 10px; }
.user-override-warning { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; padding: 10px 12px; background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.25); border-radius: 8px; }
.warning-icon { font-size: 1.125rem; flex-shrink: 0; }
.warning-text { font-size: .8125rem; color: #92400e; line-height: 1.5; }
.toggle-edit-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: .875rem; font-weight: 600; color: #1d4ed8; background: rgba(59,130,246,.1); border: 1px solid rgba(59,130,246,.3); border-radius: 8px; cursor: pointer; transition: background .15s; }
.toggle-edit-btn:hover { background: rgba(59,130,246,.15); }
.user-override-indicator { display: flex; align-items: center; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
.override-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.3); color: #047857; font-size: .75rem; font-weight: 600; }
.override-time { font-size: .75rem; color: var(--text-muted, #9ca3af); }
.edit-form { margin-top: 16px; padding: 16px; background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 10px; }
.edit-form-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
@media (min-width: 768px) { .edit-form-grid { grid-template-columns: repeat(4,1fr); } }
.edit-form-field { display: flex; flex-direction: column; gap: 4px; }
.edit-form-field--full { grid-column: 1 / -1; margin-top: 8px; }
.edit-label { font-size: .75rem; font-weight: 600; color: var(--text-secondary, #6b7280); }
.optional-tag { font-weight: 400; font-style: italic; color: var(--text-muted, #9ca3af); }
.edit-input,.edit-select { padding: 8px 10px; font-size: .875rem; border: 1px solid var(--border-color, #e5e7eb); border-radius: 6px; background: var(--card-bg, #fff); color: var(--text-primary, #111827); }
.edit-input:focus,.edit-select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,.15); }
.edit-textarea { padding: 8px 10px; font-size: .875rem; border: 1px solid var(--border-color, #e5e7eb); border-radius: 6px; background: var(--card-bg, #fff); color: var(--text-primary, #111827); resize: vertical; min-height: 60px; width: 100%; box-sizing: border-box; }
.edit-textarea:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,.15); }
.edit-form-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color, #e5e7eb); }
.save-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: .875rem; font-weight: 600; color: #fff; background: #10b981; border: none; border-radius: 8px; cursor: pointer; }
.save-btn:hover { background: #059669; }
.reset-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: .875rem; font-weight: 600; color: #b91c1c; background: rgba(185,28,28,.08); border: 1px solid rgba(185,28,28,.25); border-radius: 8px; cursor: pointer; }
.reset-btn:hover { background: rgba(185,28,28,.12); }

.ai-extract-result-card { margin-bottom: 12px; padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(139,92,246,.3); background: linear-gradient(135deg,rgba(139,92,246,.04),rgba(167,139,250,.08)); }
.ai-extract-result-card--complete { border-color: rgba(16,185,129,.4); background: linear-gradient(135deg,rgba(16,185,129,.04),rgba(52,211,153,.08)); }
.ai-extract-result-card--incomplete { border-color: rgba(245,158,11,.4); background: linear-gradient(135deg,rgba(245,158,11,.04),rgba(251,191,36,.08)); }
.ai-extract-result-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.ai-extract-result-icon { font-size: 1.25rem; }
.ai-extract-result-title { font-size: .9375rem; font-weight: 600; color: var(--text-primary, #111827); }
.ai-extract-result-time { font-size: .75rem; color: var(--text-muted, #9ca3af); margin-left: auto; }
.ai-extract-error { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; background: rgba(185,28,28,.08); border: 1px solid rgba(185,28,28,.2); border-radius: 8px; }
.ai-extract-error-icon { font-size: 1rem; flex-shrink: 0; }
.ai-extract-error-text { font-size: .8125rem; color: #b91c1c; }
.ai-extract-result-content { display: flex; flex-direction: column; gap: 8px; }
.ai-extract-result-row { display: flex; align-items: center; gap: 8px; }
.ai-extract-result-label { font-size: .8125rem; color: var(--text-secondary, #6b7280); min-width: 100px; }
.ai-extract-result-value { font-size: .8125rem; font-weight: 600; color: var(--text-primary, #111827); }
.ai-extract-value--ok { color: #047857; }
.ai-extract-value--ko { color: #b45309; }

.completeness-warning { display: flex; gap: 12px; margin-bottom: 12px; padding: 12px 16px; background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.3); border-radius: 8px; }
.completeness-icon { font-size: 1.25rem; flex-shrink: 0; }
.completeness-content { flex: 1; }
.completeness-content strong { display: block; font-size: .875rem; color: #92400e; margin-bottom: 8px; }
.completeness-list { margin: 0 0 8px; padding-left: 18px; font-size: .8125rem; color: #b45309; }
.completeness-list li.blocking { color: #b91c1c; font-weight: 600; }
.completeness-list li.non-blocking { color: #6b7280; font-style: italic; }
.completeness-hint { font-size: .8125rem; color: #92400e; margin: 8px 0 0; }
.non-blocking-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: .6875rem; background: rgba(107,114,128,.15); border-radius: 4px; font-style: normal; font-weight: 500; }

.rules-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0 12px; flex-wrap: wrap; }
.rules-count { font-size: .8125rem; color: var(--text-secondary, #6b7280); }
.rules-count-detail { color: var(--text-muted, #9ca3af); font-style: italic; }
.rules-select-label { display: inline-flex; align-items: center; gap: 8px; font-size: .8125rem; color: var(--text-secondary, #6b7280); }
.rules-select { border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 6px 10px; background: var(--card-bg, #fff); color: var(--text-primary, #111827); }
.rules-zones { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }

.rule-zone-card { border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; padding: 16px; background: var(--bg-muted, #f9fafb); }
.rule-zone-card--detected { border-color: rgba(16,185,129,.4); background: rgba(16,185,129,.04); }
.rule-zone-card--ai { border-color: rgba(139,92,246,.4); background: linear-gradient(135deg,rgba(139,92,246,.02),rgba(167,139,250,.04)); }
.rule-zone-card--sql { border-color: rgba(34,197,94,.5); background: linear-gradient(135deg,rgba(34,197,94,.04),rgba(74,222,128,.06)); }
.rule-zone-card--user { border-color: rgba(59,130,246,.4); background: linear-gradient(135deg,rgba(59,130,246,.02),rgba(96,165,250,.04)); }
.rule-zone-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.rule-zone-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.zone-pill { display: inline-flex; padding: 2px 10px; border-radius: 999px; background: rgba(99,102,241,.12); border: 1px solid rgba(99,102,241,.25); color: var(--text-primary, #111827); font-size: .75rem; font-weight: 700; }
.zone-libelle { font-size: .9375rem; font-weight: 600; color: var(--text-primary, #111827); }
.zone-detected-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: rgba(16,185,129,.15); border: 1px solid rgba(16,185,129,.3); color: #047857; font-size: .6875rem; font-weight: 600; text-transform: uppercase; }
.zone-ai-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: rgba(139,92,246,.15); border: 1px solid rgba(139,92,246,.3); color: #7c3aed; font-size: .6875rem; font-weight: 600; text-transform: uppercase; }
.zone-sql-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: rgba(34,197,94,.15); border: 1px solid rgba(34,197,94,.3); color: #16a34a; font-size: .6875rem; font-weight: 600; text-transform: uppercase; }
.zone-user-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: rgba(59,130,246,.15); border: 1px solid rgba(59,130,246,.3); color: #1d4ed8; font-size: .6875rem; font-weight: 600; text-transform: uppercase; }
.rule-zone-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.confidence-pill,.source-pill { display: inline-flex; padding: 2px 10px; border-radius: 999px; background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); color: var(--text-secondary, #6b7280); font-size: .75rem; }

/* NOUVELLE GRILLE DE CARTES AVEC NOTES */
.rule-cards-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
@media (min-width: 900px) { .rule-cards-grid { grid-template-columns: repeat(4,minmax(0,1fr)); } }

.rule-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
.rule-card-label { font-size: .6875rem; font-weight: 700; color: var(--text-muted, #9ca3af); letter-spacing: .03em; text-transform: uppercase; margin-bottom: 2px; }
.rule-card-value { font-size: 1.125rem; font-weight: 700; color: var(--text-primary, #111827); line-height: 1.2; }
.rule-card-value--empty { color: var(--text-muted, #9ca3af); font-weight: 400; font-size: .875rem; }
.rule-card-note { margin-top: 5px; font-size: .6875rem; color: var(--text-muted, #9ca3af); line-height: 1.45; font-style: italic; }

.zone-empty-message { background: rgba(245,158,11,.08); border: 1px dashed rgba(245,158,11,.3); border-radius: 8px; padding: 10px 14px; font-size: .8125rem; color: #92400e; font-style: italic; }
.zone-empty-hint { display: block; margin-top: 6px; font-style: normal; font-weight: 500; }

.rule-notes { margin-top: 12px; background: var(--card-bg, #fff); border: 1px dashed var(--border-color, #e5e7eb); border-radius: 10px; padding: 10px 12px; }
.rule-notes-title { font-size: .75rem; color: var(--text-muted, #9ca3af); margin-bottom: 8px; font-weight: 700; }
.rule-notes-list { margin: 0; padding-left: 18px; color: var(--text-secondary, #6b7280); font-size: .8125rem; }

@media (prefers-color-scheme: dark) {
  .plu-faisabilite-page { --card-bg: #1f2937; --border-color: #374151; --text-primary: #f9fafb; --text-secondary: #9ca3af; --text-muted: #6b7280; --bg-muted: #111827; --code-bg: #374151; }
  .primary-btn { background: #4f46e5; border-color: #4f46e5; }
  .secondary-btn { background: var(--bg-muted,#111827); color: #f9fafb; }
  .ai-extract-btn { background: linear-gradient(135deg,rgba(139,92,246,.2),rgba(167,139,250,.25)); border-color: rgba(139,92,246,.5); color: #a78bfa; }
  .zone-pill { color: #f9fafb; }
  .zone-detected-badge { background: rgba(16,185,129,.2); border-color: rgba(16,185,129,.4); color: #34d399; }
  .zone-ai-badge { background: rgba(139,92,246,.2); border-color: rgba(139,92,246,.4); color: #a78bfa; }
  .zone-sql-badge { background: rgba(34,197,94,.2); border-color: rgba(34,197,94,.4); color: #4ade80; }
  .zone-user-badge { background: rgba(59,130,246,.2); border-color: rgba(59,130,246,.4); color: #60a5fa; }
  .edit-input,.edit-select,.edit-textarea { background: var(--card-bg,#1f2937); border-color: var(--border-color,#374151); color: var(--text-primary,#f9fafb); }
  .save-btn { background: #059669; }
  .rule-zone-card--detected { border-color: rgba(16,185,129,.5); background: rgba(16,185,129,.08); }
  .rule-zone-card--ai { border-color: rgba(139,92,246,.5); background: linear-gradient(135deg,rgba(139,92,246,.08),rgba(167,139,250,.1)); }
  .rule-zone-card--sql { border-color: rgba(34,197,94,.6); background: linear-gradient(135deg,rgba(34,197,94,.08),rgba(74,222,128,.1)); }
  .rule-zone-card--user { border-color: rgba(59,130,246,.5); background: linear-gradient(135deg,rgba(59,130,246,.08),rgba(96,165,250,.1)); }
  .ai-extract-result-title { color: #f9fafb; }
  .ai-extract-result-value { color: #f9fafb; }
  .ai-extract-value--ok { color: #34d399; }
  .ai-extract-value--ko { color: #fbbf24; }
}
`;