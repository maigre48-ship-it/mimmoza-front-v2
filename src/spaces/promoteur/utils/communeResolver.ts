// src/spaces/promoteur/utils/communeResolver.ts
//
// Résolution de communes via l'API gouvernementale geo.api.gouv.fr
// (Etalab, gratuite, sans clé).
//
// Expose :
//   - searchCommuneSuggestions(query) : autocomplete (nom / code INSEE / CP)
//   - getCommuneByInsee(insee)        : lookup direct par code INSEE
//   - getCommuneByLatLon(lat, lon)    : reverse-geocoding sur un point
//   - resolveCommuneToInsee(raw)      : saisie libre → liste d'INSEE (legacy)

export interface CommuneSuggestion {
  nom: string;
  code: string;                  // INSEE (5 chiffres)
  codeDepartement: string;
  codesPostaux: string[];
  population: number | null;
  centre: { lat: number; lon: number } | null;
}

const GEO_API = "https://geo.api.gouv.fr/communes";

const COMMON_FIELDS =
  "nom,code,codeDepartement,codesPostaux,population,centre";
const COMMON_QS = `fields=${COMMON_FIELDS}&format=json&geometry=centre`;

const suggestionCache = new Map<string, CommuneSuggestion[]>();
const inseeCache = new Map<string, CommuneSuggestion | null>();

interface GeoApiRaw {
  nom?: string;
  code?: string;
  codeDepartement?: string;
  codesPostaux?: string[];
  population?: number;
  centre?: { type?: string; coordinates?: [number, number] };
}

function parseGeoApi(obj: GeoApiRaw): CommuneSuggestion | null {
  if (!obj?.code || !obj?.nom) return null;
  const coords = obj.centre?.coordinates;
  const centre =
    Array.isArray(coords) && coords.length === 2 && typeof coords[0] === "number" && typeof coords[1] === "number"
      ? { lon: coords[0], lat: coords[1] }
      : null;
  return {
    nom: obj.nom,
    code: obj.code,
    codeDepartement: obj.codeDepartement ?? "",
    codesPostaux: Array.isArray(obj.codesPostaux) ? obj.codesPostaux : [],
    population: typeof obj.population === "number" ? obj.population : null,
    centre,
  };
}

async function fetchArray(url: string, signal?: AbortSignal): Promise<GeoApiRaw[]> {
  const resp = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`geo.api.gouv.fr ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  return Array.isArray(data) ? (data as GeoApiRaw[]) : [];
}

/**
 * Recherche type autocomplete.
 *   - 5 chiffres  : tente code INSEE direct puis code postal
 *   - sinon       : recherche par nom (top 10 par population)
 */
export async function searchCommuneSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<CommuneSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cacheKey = q.toLowerCase();
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;

  try {
    let results: CommuneSuggestion[] = [];

    if (/^\d{5}$/.test(q)) {
      // Code 5 chiffres : INSEE direct ?
      try {
        const raw = await fetchArray(
          `${GEO_API}?code=${encodeURIComponent(q)}&${COMMON_QS}`,
          signal,
        );
        results = raw.map(parseGeoApi).filter((x): x is CommuneSuggestion => x !== null);
      } catch {
        /* bascule sur CP */
      }

      // Fallback : code postal (peut retourner plusieurs communes)
      if (results.length === 0) {
        const raw = await fetchArray(
          `${GEO_API}?codePostal=${encodeURIComponent(q)}&${COMMON_QS}&limit=20`,
          signal,
        );
        results = raw.map(parseGeoApi).filter((x): x is CommuneSuggestion => x !== null);
      }
    } else {
      // Recherche par nom (trié par population pour remonter les grandes villes)
      const raw = await fetchArray(
        `${GEO_API}?nom=${encodeURIComponent(q)}&${COMMON_QS}&boost=population&limit=10`,
        signal,
      );
      results = raw.map(parseGeoApi).filter((x): x is CommuneSuggestion => x !== null);
    }

    suggestionCache.set(cacheKey, results);
    return results;
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      console.warn("[communeResolver] searchCommuneSuggestions failed:", e);
    }
    return [];
  }
}

export async function getCommuneByInsee(
  insee: string,
): Promise<CommuneSuggestion | null> {
  const code = insee.trim();
  if (!/^\d{5}$/.test(code)) return null;

  if (inseeCache.has(code)) {
    return inseeCache.get(code) ?? null;
  }

  try {
    const resp = await fetch(
      `${GEO_API}/${encodeURIComponent(code)}?${COMMON_QS}`,
      { headers: { Accept: "application/json" } },
    );
    if (!resp.ok) {
      inseeCache.set(code, null);
      return null;
    }
    const data = (await resp.json()) as GeoApiRaw;
    const parsed = parseGeoApi(data);
    inseeCache.set(code, parsed);
    return parsed;
  } catch {
    inseeCache.set(code, null);
    return null;
  }
}

/**
 * Reverse-geocoding : trouve la commune contenant le point (lat, lon).
 */
export async function getCommuneByLatLon(
  lat: number,
  lon: number,
): Promise<CommuneSuggestion | null> {
  try {
    const url = `${GEO_API}?lat=${lat}&lon=${lon}&${COMMON_QS}&limit=1`;
    const raw = await fetchArray(url);
    if (raw.length === 0) return null;
    return parseGeoApi(raw[0]);
  } catch (e) {
    console.warn("[communeResolver] getCommuneByLatLon failed:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy : saisie libre → liste de codes INSEE (utilisé par le service).
// ---------------------------------------------------------------------------

export interface CommuneResolution {
  inseeCodes: string[];
  label: string;
  kind: "insee" | "cp" | "name" | "empty";
}

const EMPTY_RES: CommuneResolution = { inseeCodes: [], label: "", kind: "empty" };

export async function resolveCommuneToInsee(
  rawInput: string | null | undefined,
): Promise<CommuneResolution> {
  const q = (rawInput ?? "").trim();
  if (!q) return EMPTY_RES;

  // Liste de codes INSEE déjà résolus (un seul ou séparés par virgules) ?
  if (/^\d{5}(,\d{5})*$/.test(q)) {
    const codes = q.split(",");
    return {
      inseeCodes: codes,
      label:
        codes.length === 1 ? `INSEE ${codes[0]}` : `${codes.length} communes INSEE`,
      kind: "insee",
    };
  }

  const suggestions = await searchCommuneSuggestions(q);
  if (suggestions.length === 0) {
    return {
      inseeCodes: [],
      label: `« ${q} » non reconnu`,
      kind: /^\d{5}$/.test(q) ? "cp" : "name",
    };
  }

  const codes = suggestions.map((s) => s.code);
  const primary = suggestions[0];
  const label =
    codes.length === 1
      ? `${primary.nom} (INSEE ${primary.code})`
      : `${primary.nom} + ${codes.length - 1} autre${codes.length > 2 ? "s" : ""}`;

  return {
    inseeCodes: codes,
    label,
    kind: /^\d{5}$/.test(q) ? "cp" : "name",
  };
}