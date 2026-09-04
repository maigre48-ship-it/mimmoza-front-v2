export type EvidenceStatus = "available" | "unavailable" | "not_found" | "stale" | "estimated" | "error";
export type EvidenceScope = "address" | "parcel" | "building" | "commune" | "epci" | "department" | "region" | "national" | "custom";
export type EvidenceGeoPrecision = "exact" | "address" | "parcel" | "building" | "commune" | "epci" | "department" | "region" | "national" | "unknown";

export interface Evidence<T = unknown> {
  value: T;
  source_id: string;
  source_label: string;
  source_url?: string;
  source_date?: string;
  retrieved_at: string;
  scope: EvidenceScope;
  geo_precision: EvidenceGeoPrecision;
  confidence: number;
  status: EvidenceStatus;
  warning?: string;
}

export interface CreateEvidenceInput<T = unknown> {
  value: T;
  source_id: string;
  source_label: string;
  source_url?: string;
  source_date?: string | Date;
  retrieved_at?: string | Date;
  scope: EvidenceScope;
  geo_precision: EvidenceGeoPrecision;
  confidence: number;
  status?: EvidenceStatus;
  warning?: string;
}

export interface LegacyEvidenceInput<T = unknown> {
  value: T;
  sourceId: string;
  sourceLabel: string;
  sourceUrl?: string;
  sourceDate?: string | Date;
  retrievedAt?: string | Date;
  scope: EvidenceScope;
  geoPrecision: EvidenceGeoPrecision;
  confidence: number;
  status?: EvidenceStatus;
  warning?: string;
}

export interface EvidenceValidationResult { valid: boolean; errors: string[] }

const STATUSES = new Set<string>(["available", "unavailable", "not_found", "stale", "estimated", "error"]);
const SCOPES = new Set<string>(["address", "parcel", "building", "commune", "epci", "department", "region", "national", "custom"]);
const PRECISIONS = new Set<string>(["exact", "address", "parcel", "building", "commune", "epci", "department", "region", "national", "unknown"]);

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function optionalText(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function isoDate(value: string | Date, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid date`);
  return date.toISOString();
}

export function createEvidence<T>(input: CreateEvidenceInput<T>): Evidence<T> {
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new RangeError("confidence must be a finite number between 0 and 1");
  }
  const sourceUrl = optionalText(input.source_url);
  if (sourceUrl) {
    try { new URL(sourceUrl); } catch { throw new TypeError("source_url must be an absolute URL"); }
  }
  const evidence: Evidence<T> = {
    value: input.value,
    source_id: requiredText(input.source_id, "source_id"),
    source_label: requiredText(input.source_label, "source_label"),
    retrieved_at: isoDate(input.retrieved_at ?? new Date(), "retrieved_at"),
    scope: input.scope,
    geo_precision: input.geo_precision,
    confidence: input.confidence,
    status: input.status ?? "available",
  };
  if (sourceUrl) evidence.source_url = sourceUrl;
  if (input.source_date !== undefined) evidence.source_date = isoDate(input.source_date, "source_date");
  const warning = optionalText(input.warning);
  if (warning) evidence.warning = warning;
  const result = validateEvidence(evidence);
  if (!result.valid) throw new TypeError(result.errors.join("; "));
  return evidence;
}

export function fromLegacyEvidence<T>(input: LegacyEvidenceInput<T>): Evidence<T> {
  return createEvidence({
    value: input.value, source_id: input.sourceId, source_label: input.sourceLabel,
    source_url: input.sourceUrl, source_date: input.sourceDate, retrieved_at: input.retrievedAt,
    scope: input.scope, geo_precision: input.geoPrecision, confidence: input.confidence,
    status: input.status, warning: input.warning,
  });
}

export function validateEvidence(value: unknown): EvidenceValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["evidence must be an object"] };
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.source_id !== "string" || !candidate.source_id.trim()) errors.push("source_id must be a non-empty string");
  if (typeof candidate.source_label !== "string" || !candidate.source_label.trim()) errors.push("source_label must be a non-empty string");
  if (typeof candidate.retrieved_at !== "string" || Number.isNaN(Date.parse(candidate.retrieved_at))) errors.push("retrieved_at must be a valid date string");
  if (candidate.source_date !== undefined && (typeof candidate.source_date !== "string" || Number.isNaN(Date.parse(candidate.source_date)))) errors.push("source_date must be a valid date string");
  if (candidate.source_url !== undefined) {
    if (typeof candidate.source_url !== "string") errors.push("source_url must be a string");
    else { try { new URL(candidate.source_url); } catch { errors.push("source_url must be an absolute URL"); } }
  }
  if (typeof candidate.scope !== "string" || !SCOPES.has(candidate.scope)) errors.push("scope is not supported");
  if (typeof candidate.geo_precision !== "string" || !PRECISIONS.has(candidate.geo_precision)) errors.push("geo_precision is not supported");
  if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) errors.push("confidence must be a finite number between 0 and 1");
  if (typeof candidate.status !== "string" || !STATUSES.has(candidate.status)) errors.push("status is not supported");
  if (candidate.warning !== undefined && typeof candidate.warning !== "string") errors.push("warning must be a string");
  if (!("value" in candidate)) errors.push("value is required");
  return { valid: errors.length === 0, errors };
}

export function isEvidence<T = unknown>(value: unknown): value is Evidence<T> {
  return validateEvidence(value).valid;
}
