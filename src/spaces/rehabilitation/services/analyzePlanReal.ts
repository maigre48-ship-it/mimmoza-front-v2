// ─────────────────────────────────────────────────────────────────────────────
// analyzePlanReal.ts  v3
// Service front — Envoi du plan à la Supabase Edge Function Vision
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabaseClient";
import type {
  BuildingParams,
  PlanAnalysisResult,
  PlanUpload,
} from "../shared/planAnalysis.types";

// ─── Types internes ───────────────────────────────────────────────────────────

interface AnalyzePlanRealInput {
  plan: PlanUpload | null;
  building: BuildingParams;
}

interface AnalyzePlanRealError {
  code: string;
  message: string;
  status?: number;
  debug?: unknown;
}

type ApiErrorBody = {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
    debug?: unknown;
  };
  data?: unknown;
  debug?: unknown;
};

// ─── Constantes ──────────────────────────────────────────────────────────────

const FUNCTION_NAME = "analyze-rehab-plan";
const TIMEOUT_MS = 120_000;

const ACCEPTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
]);

// ─── Fonction principale ──────────────────────────────────────────────────────

export async function analyzePlanReal(
  input: AnalyzePlanRealInput
): Promise<PlanAnalysisResult> {
  const { plan, building } = input;

  if (!plan?.file) {
    throw makeError("NO_FILE", "Aucun plan fourni. Veuillez uploader un fichier PDF, PNG ou JPEG.");
  }

  const file = plan.file;

  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw makeError(
      "UNSUPPORTED_FORMAT",
      `Format non supporté : ${file.type || "inconnu"}. Utilisez un PNG, JPG ou PDF.`
    );
  }

  if (file.size <= 0) {
    throw makeError("EMPTY_FILE", "Le fichier est vide.");
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !supabaseKey) {
    throw makeError(
      "SUPABASE_ENV_MISSING",
      "Variables Supabase manquantes côté front : VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY."
    );
  }

  const functionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${FUNCTION_NAME}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token ?? supabaseKey;

  const formData = new FormData();
  formData.append("file", file, file.name || "plan");

  // On envoie "building" et "params" pour compatibilité avec les deux versions de la fonction
  const buildingJson = JSON.stringify(building);
  formData.append("building", buildingJson);
  formData.append("params", buildingJson);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  const startTs = Date.now();

  let response: Response;

  try {
    response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        // Pas de Content-Type : le browser gère lui-même le boundary multipart
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    window.clearTimeout(timeoutId);

    if (err instanceof Error && err.name === "AbortError") {
      throw makeError(
        "TIMEOUT",
        "L'analyse a dépassé le délai imparti. Le plan est peut-être trop lourd ou le service IA est momentanément lent."
      );
    }

    throw makeError(
      "NETWORK_ERROR",
      "Impossible de joindre le service d'analyse. Vérifiez la connexion ou l'état de la fonction Supabase.",
      undefined,
      err
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  const processingTimeMs = Date.now() - startTs;

  const body = await parseResponseBody(response);

  if (!response.ok) {
    const err = extractApiError(body, response.status);
    throw makeError(err.code, err.message, response.status, err.debug ?? body);
  }

  if (body && typeof body === "object" && "success" in body && body.success === false) {
    const err = extractApiError(body, response.status);
    throw makeError(err.code, err.message, response.status, err.debug ?? body);
  }

  const rawData =
    body && typeof body === "object" && "data" in body
      ? (body.data as unknown)
      : body;

  if (!rawData || typeof rawData !== "object") {
    throw makeError(
      "INVALID_RESPONSE",
      "La fonction a répondu, mais le format du résultat est invalide.",
      response.status,
      body
    );
  }

  return normalizeResult(rawData as Record<string, unknown>, processingTimeMs);
}

// ─── Parsing réponse ──────────────────────────────────────────────────────────

async function parseResponseBody(
  response: Response
): Promise<ApiErrorBody | Record<string, unknown> | null> {
  const text = await response.text();

  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as ApiErrorBody | Record<string, unknown>;
  } catch {
    throw makeError(
      "PARSE_ERROR",
      `La réponse du serveur n'est pas un JSON lisible. Statut HTTP : ${response.status}.`,
      response.status,
      text.slice(0, 1000)
    );
  }
}

function extractApiError(
  body: ApiErrorBody | Record<string, unknown> | null,
  status: number
): { code: string; message: string; debug?: unknown } {
  if (body && typeof body === "object") {
    const maybeError = (body as ApiErrorBody).error;

    if (maybeError && typeof maybeError === "object") {
      return {
        code: maybeError.code ?? `HTTP_${status}`,
        message: maybeError.message ?? `Erreur serveur (${status}).`,
        debug: maybeError.debug ?? (body as ApiErrorBody).debug,
      };
    }

    const code =
      typeof (body as Record<string, unknown>).code === "string"
        ? ((body as Record<string, unknown>).code as string)
        : `HTTP_${status}`;

    const message =
      typeof (body as Record<string, unknown>).message === "string"
        ? ((body as Record<string, unknown>).message as string)
        : `Erreur serveur (${status}).`;

    return { code, message, debug: body };
  }

  return { code: `HTTP_${status}`, message: `Erreur serveur (${status}).` };
}

// ─── Normalisation du résultat v3 ─────────────────────────────────────────────

function normalizeResult(
  raw: Record<string, unknown>,
  processingTimeMs: number
): PlanAnalysisResult {

  // ── Issues ────────────────────────────────────────────────────────────────
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];

  const issues = rawIssues
    .filter((iss): iss is Record<string, unknown> => Boolean(iss) && typeof iss === "object")
    .map((iss, idx) => ({
      id: String(iss.id ?? `ISS-${String(idx + 1).padStart(3, "0")}`),
      category: String(iss.category ?? "Général"),
      severity: normalizeSeverity(iss.severity),
      evidenceLevel: normalizeEvidenceLevel(iss.evidenceLevel),   // v2
      confidence: normalizeConfidence(iss.confidence),             // v2
      title: String(iss.title ?? "Point de contrôle"),
      description: String(iss.description ?? ""),
      planZone: iss.planZone ? String(iss.planZone) : undefined,
      regulatoryRef: iss.regulatoryRef ? String(iss.regulatoryRef) : undefined,
    }));

  // ── Recommandations ───────────────────────────────────────────────────────
  const rawRecs = Array.isArray(raw.recommendations) ? raw.recommendations : [];

  const recommendations = rawRecs
    .filter((rec): rec is Record<string, unknown> => Boolean(rec) && typeof rec === "object")
    .map((rec, idx) => {
      const costRaw =
        rec.estimatedCost && typeof rec.estimatedCost === "object"
          ? (rec.estimatedCost as Record<string, unknown>)
          : undefined;

      const min = costRaw ? Number(costRaw.min) || 0 : 0;
      const max = costRaw ? Number(costRaw.max) || 0 : 0;

      return {
        id: String(rec.id ?? `REC-${String(idx + 1).padStart(3, "0")}`),
        priority: normalizePriority(rec.priority),
        title: String(rec.title ?? "Recommandation"),
        description: String(rec.description ?? ""),
        estimatedCost: costRaw
          ? { min, max: Math.max(max, min), unit: "€" as const }
          : undefined,
      };
    });

  // ── architecturalReading (v2) ─────────────────────────────────────────────
  const arRaw =
    raw.architecturalReading && typeof raw.architecturalReading === "object"
      ? (raw.architecturalReading as Record<string, unknown>)
      : null;

  const architecturalReading = arRaw
    ? {
        geometry: normalizeReadingQuality(arRaw.geometry),
        functional: normalizeReadingQuality(arRaw.functional),
        regulatory: normalizeRegulatoryQuality(arRaw.regulatory),
        summary: String(arRaw.summary ?? ""),
      }
    : undefined;

  // ── detectedSpatialElements (v2) ──────────────────────────────────────────
  const dseRaw =
    raw.detectedSpatialElements && typeof raw.detectedSpatialElements === "object"
      ? (raw.detectedSpatialElements as Record<string, unknown>)
      : null;

  const detectedSpatialElements = dseRaw
    ? {
        halls:          normalizeStringArray(dseRaw.halls),
        corridors:      normalizeStringArray(dseRaw.corridors),
        rooms:          normalizeStringArray(dseRaw.rooms),
        sanitarySpaces: normalizeStringArray(dseRaw.sanitarySpaces),
        technicalRooms: normalizeStringArray(dseRaw.technicalRooms),
        stairs:         normalizeStringArray(dseRaw.stairs),
        exits:          normalizeStringArray(dseRaw.exits),
        receptionAreas: normalizeStringArray(dseRaw.receptionAreas),
        therapyAreas:   normalizeStringArray(dseRaw.therapyAreas),
        careRooms:      normalizeStringArray(dseRaw.careRooms),
      }
    : undefined;

  // ── functionalObservations (v2) ───────────────────────────────────────────
  const functionalObservations = normalizeStringArray(raw.functionalObservations);

  // ── spatialIntelligence (v3) ──────────────────────────────────────────────
  const siRaw =
    raw.spatialIntelligence && typeof raw.spatialIntelligence === "object"
      ? (raw.spatialIntelligence as Record<string, unknown>)
      : null;

  const spatialIntelligence = siRaw
    ? {
        flowQuality:   normalizeReadingQuality(siRaw.flowQuality),
        zoningQuality: normalizeReadingQuality(siRaw.zoningQuality),
        modularity:    normalizeReadingQuality(siRaw.modularity),
        constraints:   normalizeStringArray(siRaw.constraints),
        opportunities: normalizeStringArray(siRaw.opportunities),
        summary:       String(siRaw.summary ?? ""),
      }
    : undefined;

  // ── engineMeta ────────────────────────────────────────────────────────────
  const metaRaw =
    raw.engineMeta && typeof raw.engineMeta === "object"
      ? (raw.engineMeta as Record<string, unknown>)
      : {};

  const engineMeta = {
    version: String(metaRaw.version ?? "v3-spatial-intelligence"),
    mode: String(metaRaw.mode ?? "real"),
    model: String(metaRaw.model ?? "gpt-4o"),
    processingTimeMs,
  };

  return {
    summary: String(raw.summary ?? "Analyse incomplète."),
    reliability: normalizeReliability(raw.reliability),             // v2
    riskLevel: normalizeRiskLevel(raw.riskLevel),
    pmrLevel: normalizeComplianceLevel(raw.pmrLevel),
    fireSafetyLevel: normalizeComplianceLevel(raw.fireSafetyLevel),
    architecturalReading,                                           // v2
    detectedSpatialElements,                                        // v2
    functionalObservations,                                         // v2
    spatialIntelligence,                                            // v3
    issues,
    recommendations,
    analyzedAt: String(raw.analyzedAt ?? new Date().toISOString()),
    engineMeta,
  };
}

// ─── Normalizers enum ─────────────────────────────────────────────────────────

function normalizeSeverity(v: unknown): "non_conforme" | "a_verifier" | "conforme" {
  if (v === "non_conforme" || v === "a_verifier" || v === "conforme") return v;
  return "a_verifier";
}

function normalizeEvidenceLevel(
  v: unknown
): "detected" | "to_confirm" | "not_verifiable" | "regulatory_assumption" {
  if (
    v === "detected" ||
    v === "to_confirm" ||
    v === "not_verifiable" ||
    v === "regulatory_assumption"
  )
    return v;
  return "to_confirm";
}

function normalizeConfidence(v: unknown): "forte" | "moyenne" | "faible" {
  if (v === "forte" || v === "moyenne" || v === "faible") return v;
  return "moyenne";
}

function normalizePriority(v: unknown): "urgente" | "importante" | "recommandee" {
  if (v === "urgente" || v === "importante" || v === "recommandee") return v;
  return "recommandee";
}

function normalizeRiskLevel(v: unknown): "faible" | "modere" | "eleve" | "critique" {
  if (v === "faible" || v === "modere" || v === "eleve" || v === "critique") return v;
  return "modere";
}

function normalizeComplianceLevel(
  v: unknown
): "conforme" | "partiel" | "non_conforme" | "non_evalue" {
  if (v === "conforme" || v === "partiel" || v === "non_conforme" || v === "non_evalue") return v;
  return "non_evalue";
}

function normalizeReliability(v: unknown): "faible" | "moyenne" | "forte" {
  if (v === "faible" || v === "moyenne" || v === "forte") return v;
  return "moyenne";
}

function normalizeReadingQuality(v: unknown): "bonne" | "moyenne" | "faible" {
  if (v === "bonne" || v === "moyenne" || v === "faible") return v;
  return "moyenne";
}

function normalizeRegulatoryQuality(v: unknown): "bonne" | "partielle" | "faible" {
  if (v === "bonne" || v === "partielle" || v === "faible") return v;
  return "partielle";
}

function normalizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s) => s != null).map((s) => String(s));
}

// ─── Helper erreur ────────────────────────────────────────────────────────────

function makeError(
  code: string,
  message: string,
  status?: number,
  debug?: unknown
): AnalyzePlanRealError & Error {
  const err = new Error(message) as AnalyzePlanRealError & Error;
  err.code = code;
  err.message = message;
  err.status = status;
  err.debug = debug;

  if (import.meta.env.DEV && debug !== undefined) {
    console.warn("[analyzePlanReal]", code, message, debug);
  }

  return err;
}