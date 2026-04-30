import { supabase } from "../../../lib/supabase";
import type {
  PermisConstruireItem,
  PermisConstruireProjectType,
  PermisConstruireSearchParams,
  PermisConstruireSearchResponse,
  PermisConstruireStatut,
  PermisConstruireTypeAutorisation,
} from "../types/permisConstruire.types";
import { resolveCommuneToInsee } from "../utils/communeResolver";

/**
 * Service de recherche des permis de construire.
 * Source unique : Edge Function Supabase `promoteur-permis-construire`.
 *
 * Le filtre commune est résolu côté front en liste de codes INSEE via
 * geo.api.gouv.fr avant l'appel, de façon à éviter toute ambiguïté
 * INSEE/CP/nom côté backend.
 */

const FUNCTION_NAME = "promoteur-permis-construire";
const REMOTE_LIMIT = 100;

const VALID_TYPES: readonly PermisConstruireTypeAutorisation[] = [
  "PC",
  "PA",
  "PD",
  "DP",
];

// ═══════════════════════════════════════════════════════════════════════════
//  Mappers enum front ↔ back
// ═══════════════════════════════════════════════════════════════════════════

function mapTypologieFrontToBack(
  t: PermisConstruireProjectType | undefined,
): string {
  switch (t) {
    case "logement_individuel": return "individuel";
    case "logement_collectif": return "collectif";
    case "logement_mixte": return "mixte";
    case "activite": return "activite";
    case "tous":
    case undefined:
    default:
      return "all";
  }
}

function mapTypologieBackToFront(
  s: unknown,
): PermisConstruireProjectType | null {
  if (typeof s !== "string") return null;
  const v = s.trim().toLowerCase();
  switch (v) {
    case "individuel":
    case "logement_individuel":
      return "logement_individuel";
    case "collectif":
    case "logement_collectif":
      return "logement_collectif";
    case "mixte":
    case "logement_mixte":
      return "logement_mixte";
    case "activite":
      return "activite";
    case "all":
    case "tous":
      return "tous";
    case "logement":
      return null;
    default:
      return null;
  }
}

/**
 * Normalise le filtre type d'autorisation envoyé par le frontend.
 *
 * - undefined / array vide / aucun type valide → "all" (pas de filtre)
 * - les 4 types cochés                           → "all"
 * - sous-ensemble                                → array de codes valides
 *
 * Le backend accepte string | "all" | array : on envoie directement un
 * array (ou "all") pour éviter toute ambiguïté.
 */
function normalizeTypeAutorisationForBackend(
  raw: PermisConstruireSearchParams["typeAutorisation"],
): PermisConstruireTypeAutorisation[] | "all" {
  if (raw === undefined || raw === null) return "all";

  // Support d'une valeur unique (string) au cas où
  const arr: unknown[] = Array.isArray(raw) ? raw : [raw];

  const set = new Set<PermisConstruireTypeAutorisation>();
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const up = v.trim().toUpperCase();
    if (up === "ALL") return "all";
    if ((VALID_TYPES as readonly string[]).includes(up)) {
      set.add(up as PermisConstruireTypeAutorisation);
    }
  }

  if (set.size === 0) return "all";
  if (set.size === VALID_TYPES.length) return "all";
  return Array.from(set);
}

function mapTypeAutBackToFront(
  s: unknown,
): PermisConstruireTypeAutorisation | null {
  if (typeof s !== "string") return null;
  const v = s.trim().toUpperCase();
  if (v === "PC" || v === "PA" || v === "PD" || v === "DP") return v;
  return null;
}

function mapStatutBackToFront(s: unknown): PermisConstruireStatut | null {
  if (typeof s !== "string") return null;
  const raw = s.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (
    lower === "depose" ||
    lower === "en_instruction" ||
    lower === "accorde" ||
    lower === "refuse" ||
    lower === "retire" ||
    lower === "inconnu"
  ) {
    return lower as PermisConstruireStatut;
  }

  const norm = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (norm.includes("instruction")) return "en_instruction";
  if (norm.includes("accord")) return "accorde";
  if (norm.includes("refus")) return "refuse";
  if (norm.includes("retir") || norm.includes("annul")) return "retire";
  if (norm.includes("depose") || norm.includes("chantier") || norm.includes("termin")) {
    return "accorde";
  }
  return "inconnu";
}

// ═══════════════════════════════════════════════════════════════════════════
//  Utilitaires
// ═══════════════════════════════════════════════════════════════════════════

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function monthsFromCustomRange(
  start: string | undefined,
  end: string | undefined,
): number | null {
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const diffMs = e.getTime() - s.getTime();
  if (diffMs <= 0) return null;
  const months = Math.ceil(diffMs / (30 * 24 * 3600 * 1000));
  return Math.max(1, Math.min(120, months));
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

/**
 * Déballe le corps JSON d'une réponse d'Edge Function en erreur.
 * supabase.functions.invoke masque le body derrière un message générique ;
 * on va le chercher via error.context.response.
 */
async function extractEdgeErrorDetail(err: unknown): Promise<string | null> {
  try {
    const anyErr = err as { context?: { response?: Response } };
    const resp = anyErr?.context?.response;
    if (!resp || typeof resp.clone !== "function") return null;
    const cloned = resp.clone();
    const text = await cloned.text();
    if (!text) return null;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof json.message === "string") parts.push(json.message);
      if (typeof json.error === "string" && json.error !== json.message) {
        parts.push(json.error);
      }
      if (typeof json.details === "string") parts.push(json.details);
      if (parts.length > 0) return parts.join(" — ");
      return text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Appel Edge Function
// ═══════════════════════════════════════════════════════════════════════════

function buildRemoteRequestBody(
  params: PermisConstruireSearchParams,
  communePayload: string | null,
): Record<string, unknown> {
  const periodMonths = params.periodeStart
    ? monthsFromCustomRange(params.periodeStart, params.periodeEnd) ??
      params.periodeMois
    : params.periodeMois;

  // Correction du bug : on transmet la sélection utilisateur réelle au lieu
  // de hardcoder "PC". Le backend accepte un array ou "all".
  const typeAutorisation = normalizeTypeAutorisationForBackend(
    params.typeAutorisation,
  );

  return {
    latitude: params.latitude,
    longitude: params.longitude,
    radiusKm: params.rayonKm,
    periodMonths,
    typeAutorisation,
    typologie: mapTypologieFrontToBack(params.typologie),
    logementsMin: params.logementsMin ?? null,
    logementsMax: params.logementsMax ?? null,
    surfaceMin: params.surfaceMin ?? null,
    surfaceMax: params.surfaceMax ?? null,
    commune: communePayload,
    limit: REMOTE_LIMIT,
    offset: 0,
    sortBy: params.sortBy ?? "distance",
    sortOrder: params.sortOrder ?? "asc",
  };
}

function normalizeRemoteItem(
  rawInput: unknown,
  searchLat: number,
  searchLon: number,
): PermisConstruireItem {
  const raw = asRecord(rawInput) ?? {};

  const lat =
    typeof raw.latitude === "number" && Number.isFinite(raw.latitude)
      ? (raw.latitude as number)
      : null;
  const lon =
    typeof raw.longitude === "number" && Number.isFinite(raw.longitude)
      ? (raw.longitude as number)
      : null;

  let distanceKm: number | null = null;
  if (typeof raw.distanceKm === "number" && Number.isFinite(raw.distanceKm)) {
    distanceKm = raw.distanceKm as number;
  } else if (lat !== null && lon !== null) {
    distanceKm = haversineKm(searchLat, searchLon, lat, lon);
  }

  const idVal =
    typeof raw.id === "string" && raw.id.trim()
      ? (raw.id as string)
      : typeof raw.referenceDossier === "string" && raw.referenceDossier.trim()
      ? (raw.referenceDossier as string)
      : `permis-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id: idVal,
    distanceKm,
    commune: typeof raw.commune === "string" ? raw.commune : null,
    codePostal: typeof raw.codePostal === "string" ? raw.codePostal : null,
    dateDepot: typeof raw.dateDepot === "string" ? raw.dateDepot : null,
    typeAutorisation: mapTypeAutBackToFront(raw.typeAutorisation),
    natureProjet: typeof raw.natureProjet === "string" ? raw.natureProjet : null,
    typologie: mapTypologieBackToFront(raw.typologie),
    nombreLogements:
      typeof raw.nombreLogements === "number" &&
      Number.isFinite(raw.nombreLogements)
        ? (raw.nombreLogements as number)
        : null,
    surface:
      typeof raw.surface === "number" && Number.isFinite(raw.surface)
        ? (raw.surface as number)
        : null,
    statut: mapStatutBackToFront(raw.statut),
    adresse: typeof raw.adresse === "string" ? raw.adresse : null,
    referenceDossier:
      typeof raw.referenceDossier === "string" ? raw.referenceDossier : null,
    latitude: lat,
    longitude: lon,
    source:
      typeof raw.source === "string"
        ? raw.source
        : "promoteur-permis-construire",
    raw: asRecord(raw.raw),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  API publique
// ═══════════════════════════════════════════════════════════════════════════

export async function searchPermisConstruire(
  params: PermisConstruireSearchParams,
): Promise<PermisConstruireSearchResponse> {
  // ── Résolution commune (front) avant l'appel backend ──
  let communePayload: string | null = null;
  let communeResolutionNotice: string | null = null;

  if (params.commune && params.commune.trim()) {
    try {
      const resolution = await resolveCommuneToInsee(params.commune);
      if (resolution.inseeCodes.length > 0) {
        communePayload = resolution.inseeCodes.join(",");
        if (resolution.inseeCodes.length === 1) {
          communeResolutionNotice =
            `Filtre commune : ${resolution.label}.`;
        } else {
          communeResolutionNotice =
            `Filtre commune : ${resolution.label} → ${resolution.inseeCodes.length} codes INSEE recherchés.`;
        }
      } else {
        // Pas de résolution : on renvoie tel quel, le backend essaiera en texte
        communePayload = params.commune;
        communeResolutionNotice =
          `Filtre commune « ${params.commune} » non résolu en code INSEE. Recherche textuelle appliquée.`;
      }
    } catch (e) {
      // En cas d'échec réseau de geo.api.gouv.fr, on envoie la saisie brute
      communePayload = params.commune;
      communeResolutionNotice =
        `Résolution automatique indisponible, recherche brute sur « ${params.commune} ».`;
    }
  }

  const body = buildRemoteRequestBody(params, communePayload);

  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body,
  });

  if (error) {
    const detail = await extractEdgeErrorDetail(error);
    const base =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "Erreur lors de l'appel à l'Edge Function.";
    throw new Error(detail ? `${base} — ${detail}` : base);
  }

  const payload = asRecord(data);
  if (!payload) {
    throw new Error("Réponse invalide de l'Edge Function.");
  }

  if (typeof payload.error === "string") {
    const msg =
      typeof payload.message === "string"
        ? (payload.message as string)
        : (payload.error as string);
    const detail =
      typeof payload.details === "string"
        ? ` — ${payload.details as string}`
        : "";
    throw new Error(`${msg}${detail}`);
  }

  const rawItems = Array.isArray(payload.items)
    ? (payload.items as unknown[])
    : null;
  if (!rawItems) {
    throw new Error("Format de réponse invalide : champ 'items' manquant.");
  }

  const items = rawItems.map((r) =>
    normalizeRemoteItem(r, params.latitude, params.longitude),
  );

  const total =
    typeof payload.total === "number" && Number.isFinite(payload.total)
      ? (payload.total as number)
      : items.length;

  const notices: string[] = [];

  if (communeResolutionNotice) {
    notices.push(communeResolutionNotice);
  }

  if (params.periodeStart || params.periodeEnd) {
    notices.push(
      "Période personnalisée convertie en durée (mois) pour l'appel backend.",
    );
  }
  if (total >= REMOTE_LIMIT) {
    notices.push(
      `Résultats limités à ${REMOTE_LIMIT} éléments. Affinez les filtres pour réduire le périmètre.`,
    );
  }

  if (Array.isArray(payload.notices)) {
    for (const n of payload.notices) {
      if (typeof n === "string") notices.push(n);
    }
  }

  return {
    items,
    total,
    params,
    generatedAt: new Date().toISOString(),
    source: "promoteur-permis-construire",
    partial: total >= REMOTE_LIMIT,
    notices: notices.length > 0 ? notices : undefined,
  };
}

export const PERMIS_CONSTRUIRE_FUNCTION_NAME = FUNCTION_NAME;