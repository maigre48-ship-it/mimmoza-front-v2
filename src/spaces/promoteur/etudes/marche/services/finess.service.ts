/**
 * Service FINESS - Recherche d'établissements (EHPAD/EHPA & assimilés)
 * Sources : OSM Healthcare + FINESS officiel via OpenDataSoft
 *
 * NORMALISATION:
 * - fetchAllEHPAD retourne TOUJOURS un tableau d'objets normalisés
 * - Chaque item contient: name, address, beds_total, distance_km, finess, telephone, lat, lon
 * - Les champs legacy sont préservés pour rétrocompatibilité
 */

import type { FinessEtablissement, EHPADData, InseeData } from "../types/market.types";

const DEBUG = true;

const _once = new Set<string>();
function once(key: string, fn: () => void) {
  if (!DEBUG) return;
  if (_once.has(key)) return;
  _once.add(key);
  try { fn(); } catch (e) { console.warn("[FINESS DEBUG] failed:", e); }
}

/**
 * Interface NORMALISÉE pour le front-end
 * Garantit que chaque item a les champs attendus par extractEhpadItemsFromResponse
 */
export interface NormalizedEHPADItem {
  // === Champs NORMALISÉS (obligatoires pour le front) ===
  name: string;                    // Nom de l'établissement
  address: string;                 // Adresse complète "num voie, CP ville"
  beds_total: number | null;       // Nombre de lits (null si non disponible)
  distance_km: number | null;      // Distance en km (null si non calculable)
  finess: string | null;           // Numéro FINESS
  telephone: string | null;        // Téléphone
  lat: number | null;              // Latitude
  lon: number | null;              // Longitude
  
  // === Champs LEGACY (rétrocompatibilité) ===
  finessEj?: string;
  category?: string;
  categoryLabel?: string;
  postalCode?: string;
  commune?: string;
  departement?: string;
  capacity?: number;               // Alias de beds_total (legacy)
  distance?: number;               // Alias de distance_km (legacy)
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Conversion Lambert-93 (EPSG:2154) vers WGS84 (EPSG:4326)
 * Formule inverse de la projection conique conforme sécante
 * Paramètres officiels RGF93 / Lambert-93
 */
function lambert93ToWgs84(x: number, y: number): { lat: number; lon: number } | null {
  // Vérification des bornes approximatives Lambert-93 pour la France
  if (x < 100000 || x > 1300000 || y < 6000000 || y > 7200000) {
    return null;
  }

  // Paramètres Lambert-93 (EPSG:2154)
  const a = 6378137.0;           // Demi-grand axe (GRS80)
  const e = 0.0818191910428158;  // Première excentricité
  const n = 0.7256077650532670;  // Exposant de la projection
  const C = 11754255.426096;     // Constante de projection
  const Xs = 700000.0;           // Fausse abscisse (X0)
  const Ys = 12655612.049876;    // Fausse ordonnée (Y0)
  const lon0 = 3 * Math.PI / 180; // Méridien central (3° Est)

  try {
    // Calcul de R et gamma
    const dx = x - Xs;
    const dy = Ys - y;
    const R = Math.sqrt(dx * dx + dy * dy);
    const gamma = Math.atan2(dx, dy);

    // Longitude
    const lon = lon0 + gamma / n;

    // Latitude isométrique
    const latIso = -Math.log(R / C) / n;

    // Latitude (itération pour converger)
    let lat = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
    
    for (let i = 0; i < 10; i++) {
      const sinLat = Math.sin(lat);
      const eSinLat = e * sinLat;
      const latIsoCalc = Math.log(
        Math.tan(Math.PI / 4 + lat / 2) *
        Math.pow((1 - eSinLat) / (1 + eSinLat), e / 2)
      );
      const delta = latIso - latIsoCalc;
      lat += delta;
      if (Math.abs(delta) < 1e-12) break;
    }

    // Conversion en degrés
    const latDeg = lat * 180 / Math.PI;
    const lonDeg = lon * 180 / Math.PI;

    // Vérification des bornes WGS84 France métropolitaine
    if (latDeg < 41 || latDeg > 52 || lonDeg < -6 || lonDeg > 10) {
      return null;
    }

    return { lat: latDeg, lon: lonDeg };
  } catch {
    return null;
  }
}

export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    "500": "EHPAD",
    "501": "EHPA (crédits AM)",
    "502": "EHPA (sans crédits AM)",
    "202": "Résidence Autonomie",
    "207": "Accueil de Jour",
    "381": "Maison de retraite",
    "382": "Logement foyer",
    "354": "SSIAD",
    "620": "Pharmacie d'Officine",
  };
  return labels[category] || `Établissement (cat. ${category})`;
}

function normalizeLatLon(a: any, b: any, centerLat: number, centerLon: number): { lat: number; lon: number } | null {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isNaN(numA) || Number.isNaN(numB)) return null;

  const cand1 = { lat: numA, lon: numB };
  const cand2 = { lat: numB, lon: numA };

  const isValid = (p: { lat: number; lon: number }) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

  const v1 = isValid(cand1);
  const v2 = isValid(cand2);
  if (!v1 && !v2) return null;
  if (v1 && !v2) return cand1;
  if (!v1 && v2) return cand2;

  const d1 = haversineDistance(centerLat, centerLon, cand1.lat, cand1.lon);
  const d2 = haversineDistance(centerLat, centerLon, cand2.lat, cand2.lon);
  return d1 <= d2 ? cand1 : cand2;
}

function valueToString(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = valueToString(x);
      if (s) return s;
    }
    return "";
  }
  if (typeof v === "object") {
    const s = valueToString((v as any).value ?? (v as any).label ?? (v as any).name);
    if (s) return s;
    try {
      const j = JSON.stringify(v);
      return j && j !== "{}" ? j : "";
    } catch {
      return "";
    }
  }
  return "";
}

function pick(fields: any, keys: string[], fallback = ""): string {
  for (const k of keys) {
    const s = valueToString(fields?.[k]);
    if (s) return s;
  }
  return fallback;
}

function pickNumber(fields: any, keys: string[]): number | null {
  for (const k of keys) {
    const raw = fields?.[k];
    if (raw == null) continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// Clés possibles pour la capacité (lits/places)
const CAPACITY_KEYS = [
  "capacite",
  "capaciteautorisee",
  "capacite_autorisee",
  "capaciteinstallee",
  "capacite_installee",
  "nb_lits",
  "nblits",
  "lits",
  "nbplaces",
  "nb_places",
  "places",
  "capacity",
  "beds",
  "nbplacesautorisees",
  "nb_places_autorisees",
  "placesautorisees",
  "places_autorisees",
  "capacitetotale",
  "capacite_totale",
];

function pickCapacity(fields: any): number | null {
  const n = pickNumber(fields, CAPACITY_KEYS);
  return n != null && n > 0 ? Math.round(n) : null;
}

function pickCategory(fields: any): string {
  return pick(fields, ["categetab", "categorie", "cat", "categorie_etablissement", "categetab__raw"], "").trim();
}

function pickLabelBlob(fields: any): string {
  return pick(fields, ["libcategorie", "libcategetab", "lib_categetab", "libelle", "rs", "rslongue", "nom", "name"], "");
}

function looksLikeElderly(text: string): boolean {
  const t = (text || "").toLowerCase();
  return (
    t.includes("ehpad") ||
    t.includes("maison de retraite") ||
    t.includes("retraite") ||
    t.includes("résidence autonomie") ||
    t.includes("residence autonomie") ||
    t.includes("personnes âgées") ||
    t.includes("personnes agees") ||
    t.includes("hébergement personnes âgées") ||
    t.includes("hebergement personnes agees") ||
    t.includes("accueil de jour") ||
    t.includes("alzheimer")
  );
}

/**
 * Construit une adresse complète lisible à partir des composants
 * Format: "num voie, code postal ville"
 * Gère proprement les valeurs manquantes (pas de virgules doublées, pas d'espaces superflus)
 */
function buildFullAddress(address: string, postalCode: string, commune: string): string {
  const parts: string[] = [];
  
  // Partie voie (nettoyée)
  const cleanAddress = (address || "").trim();
  if (cleanAddress) {
    parts.push(cleanAddress);
  }
  
  // Partie code postal + ville (nettoyée)
  const cleanPostalCode = (postalCode || "").trim();
  const cleanCommune = (commune || "").trim();
  const cpCommune = [cleanPostalCode, cleanCommune].filter(Boolean).join(" ");
  if (cpCommune) {
    parts.push(cpCommune);
  }
  
  return parts.join(", ");
}

/**
 * Construit une adresse à partir des champs FINESS bruts
 * Gère les différentes variantes de nommage des champs
 */
function buildAddressFromFields(fields: any): string {
  // Essayer d'abord la construction structurée (num + type + voie)
  const numVoie = valueToString(fields?.numvoie || fields?.numero_voie || fields?.num_voie || "");
  const typeVoie = valueToString(fields?.typvoie || fields?.type_voie || fields?.typevoie || "");
  const libelleVoie = valueToString(fields?.voie || fields?.libelle_voie || fields?.libellevoie || fields?.libvoie || "");
  
  const streetParts = [numVoie, typeVoie, libelleVoie].filter(Boolean);
  let streetAddress = streetParts.join(" ").trim();
  
  // Si pas de rue structurée, essayer les champs alternatifs
  if (!streetAddress) {
    streetAddress = pick(fields, [
      "ligneacheminement",
      "adresse",
      "adr_num_voie",
      "adresse_complete",
      "address",
      "addr_street",
    ], "");
  }
  
  // Code postal
  const postalCode = pick(fields, [
    "codepostal",
    "code_postal",
    "cp",
    "postal_code",
    "postcode",
    "adr_cp",
  ], "");
  
  // Commune/Ville
  const commune = pick(fields, [
    "libcommune",
    "commune",
    "ville",
    "city",
    "nom_commune",
    "adr_ville",
    "libelle_commune",
  ], "");
  
  return buildFullAddress(streetAddress, postalCode, commune);
}

/**
 * Interface étendue pour les données EHPAD enrichies (interne)
 */
interface FinessEtablissementEnriched extends FinessEtablissement {
  address_full?: string;
  phone?: string;
}

/**
 * Convertit un FinessEtablissementEnriched en NormalizedEHPADItem
 * Garantit que tous les champs normalisés sont présents
 */
function toNormalizedItem(e: FinessEtablissementEnriched): NormalizedEHPADItem {
  // Construire l'adresse complète
  const fullAddress = e.address_full || buildFullAddress(e.address || "", e.postalCode || "", e.commune || "");
  
  // Capacité: null si non disponible (pas 0)
  const bedsTotal = (e.capacity && e.capacity > 0) ? e.capacity : null;
  
  // Distance: null si non calculable
  const distanceKm = (e.distance != null && Number.isFinite(e.distance)) ? e.distance : null;
  
  return {
    // === Champs NORMALISÉS ===
    name: e.name || "Établissement",
    address: fullAddress || "Adresse non renseignée",
    beds_total: bedsTotal,
    distance_km: distanceKm,
    finess: e.finess || null,
    telephone: e.phone || e.telephone || null,
    lat: Number.isFinite(e.lat) ? e.lat : null,
    lon: Number.isFinite(e.lon) ? e.lon : null,
    
    // === Champs LEGACY ===
    finessEj: e.finessEj,
    category: e.category,
    categoryLabel: e.categoryLabel,
    postalCode: e.postalCode,
    commune: e.commune,
    departement: e.departement,
    capacity: e.capacity || 0,      // Legacy: 0 si non dispo
    distance: e.distance || 0,      // Legacy: 0 si non dispo
  };
}

function dedupe(items: FinessEtablissementEnriched[]): FinessEtablissementEnriched[] {
  const m = new Map<string, FinessEtablissementEnriched>();
  for (const e of items) {
    const key =
      (e.finess && String(e.finess).trim()) ||
      `${(e.name || "").toLowerCase().slice(0, 24)}_${e.lat.toFixed(3)}_${e.lon.toFixed(3)}`;
    const prev = m.get(key);
    if (!prev || ((e.capacity || 0) > 0 && (prev.capacity || 0) === 0)) m.set(key, e);
  }
  return Array.from(m.values()).sort((a, b) => (a.distance || 0) - (b.distance || 0));
}

function autoDetectCategoryKey(records: any[]): string | null {
  const sample = records.slice(0, 60).map((r) => r?.fields || {});
  const keys = new Set<string>();
  for (const f of sample) for (const k of Object.keys(f)) keys.add(k);

  let bestKey: string | null = null;
  let bestScore = 0;

  for (const k of keys) {
    let ok = 0;
    let total = 0;
    for (const f of sample) {
      const s = valueToString(f?.[k]);
      if (!s) continue;
      total++;
      const n = Number(s);
      if (Number.isFinite(n) && n >= 100 && n <= 999) ok++;
    }
    if (total < 10) continue;
    const score = ok / total;
    if (score > bestScore) {
      bestScore = score;
      bestKey = k;
    }
  }
  return bestKey;
}

function computeTopValues(records: any[], key: string, limit = 25) {
  const counts = new Map<string, number>();
  for (const r of records.slice(0, 200)) {
    const f = r?.fields || {};
    const v = valueToString(f[key]) || "(none)";
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

let _finessCategoryKey: string | null = null;

// =========================
// PATCH: extraction coords robuste
// =========================
function extractCoordsFromFields(fields: any, centerLat: number, centerLon: number): { lat: number; lon: number } | null {
  // 1) Arrays candidates
  const arrCandidates = [
    fields?.coordonnees,
    fields?.geo_point_2d,
    fields?.geopoint,
    fields?.geoloc,
    fields?.location,
  ];

  for (const c of arrCandidates) {
    if (Array.isArray(c) && c.length >= 2) {
      const norm = normalizeLatLon(c[0], c[1], centerLat, centerLon);
      if (norm) return norm;
    }
  }

  // 2) lat/lon séparés (plusieurs variantes)
  const latRaw =
    fields?.latitude ?? fields?.lat ?? fields?.y ?? fields?.coord_lat ?? fields?.wgs84_lat ?? fields?.geo_lat;
  const lonRaw =
    fields?.longitude ?? fields?.lon ?? fields?.x ?? fields?.coord_lon ?? fields?.wgs84_lon ?? fields?.geo_lon;

  if (latRaw != null && lonRaw != null) {
    const norm = normalizeLatLon(latRaw, lonRaw, centerLat, centerLon);
    if (norm) return norm;
  }

  // 3) Strings "lat,lon" ou "lon,lat"
  const strCandidates = [
    fields?.coordonnees,
    fields?.coordinates,
    fields?.coords,
    fields?.geo,
    fields?.geolocalisation,
  ];

  for (const s of strCandidates) {
    if (typeof s === "string") {
      const parts = s.split(/[,\s;]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const norm = normalizeLatLon(parts[0], parts[1], centerLat, centerLon);
        if (norm) return norm;
      }
    }
  }

  // 4) ODS geo_shape / geojson-like
  const geoShape = fields?.geo_shape ?? fields?.geojson ?? fields?.geometry;
  const coords = geoShape?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const norm = normalizeLatLon(coords[0], coords[1], centerLat, centerLon);
    if (norm) return norm;
  }

  // 5) NOUVEAU: Coordonnées Lambert-93 (coordxet/coordyet ou coordx/coordy)
  const coordX = fields?.coordxet ?? fields?.coordx ?? fields?.x_lambert ?? fields?.x_l93;
  const coordY = fields?.coordyet ?? fields?.coordy ?? fields?.y_lambert ?? fields?.y_l93;
  
  if (coordX != null && coordY != null) {
    const numX = typeof coordX === "number" ? coordX : parseFloat(String(coordX));
    const numY = typeof coordY === "number" ? coordY : parseFloat(String(coordY));
    
    if (Number.isFinite(numX) && Number.isFinite(numY)) {
      const converted = lambert93ToWgs84(numX, numY);
      
      // Log debug une seule fois
      once("LAMBERT93_CONVERSION_SAMPLE", () => {
        console.log("[DEBUG FINESS] Lambert-93 conversion sample:", {
          input: { coordxet: numX, coordyet: numY },
          output: converted,
          etablissement: fields?.rs || fields?.nom || fields?.name || "N/A",
        });
      });
      
      if (converted) {
        return converted;
      }
    }
  }

  return null;
}

// =========================
// OSM (optional / keep)
// =========================
async function fetchOSMHealthcareByAmenity(lat: number, lon: number, radiusKm: number, amenity: string): Promise<FinessEtablissementEnriched[]> {
  const radiusMeters = Math.round(radiusKm * 1000);

  const baseUrl = "https://public.opendatasoft.com/api/records/1.0/search/";
  const params = new URLSearchParams({
    dataset: "osm-france-healthcare",
    rows: "100",
    "geofilter.distance": `${lat},${lon},${radiusMeters}`,
    "refine.amenity": amenity,
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[OSM Healthcare] Requête ${amenity}: ${url}`);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const data = await resp.json();
  const records: any[] = Array.isArray(data?.records) ? data.records : [];
  console.log(`[OSM Healthcare] ${amenity}: nhits=${Number(data?.nhits || 0)} records=${records.length}`);

  const out: FinessEtablissementEnriched[] = [];
  for (const r of records) {
    const fields = r?.fields || {};

    // social_facility is broad: keep only if looks elderly
    if (amenity === "social_facility") {
      const blob = `${pick(fields, ["name", "nom"], "")} ${pick(fields, ["social_facility", "social_facility:for", "social_facility_for"], "")}`;
      if (!looksLikeElderly(blob)) continue;
    }

    const norm = extractCoordsFromFields(fields, lat, lon);
    if (!norm) continue;

    const distance = haversineDistance(lat, lon, norm.lat, norm.lon);
    if (distance > radiusKm) continue;

    const address = pick(fields, ["addr:street", "adresse"], "");
    const postalCode = pick(fields, ["addr:postcode", "meta_code_postal"], "");
    const commune = pick(fields, ["addr:city", "meta_name_com"], "");
    const phone = pick(fields, ["phone", "telephone", "contact:phone"], "");

    out.push({
      finess: fields["ref:FR:FINESS"] || fields.finess || "",
      finessEj: "",
      name: pick(fields, ["name", "nom"], "Établissement"),
      category: "OSM",
      categoryLabel: amenity,
      address,
      postalCode,
      commune,
      departement: pick(fields, ["meta_code_dep", "departement"], ""),
      lat: norm.lat,
      lon: norm.lon,
      capacity: pickCapacity(fields) || 0,
      telephone: phone || fields.phone,
      distance,
      // Champs enrichis
      address_full: buildFullAddress(address, postalCode, commune),
      phone: phone || fields.phone || undefined,
    });
  }

  return out.sort((a, b) => (a.distance || 0) - (b.distance || 0));
}

export async function fetchOSMHealthcare(lat: number, lon: number, radiusKm: number): Promise<FinessEtablissementEnriched[]> {
  try {
    const [nursing, social] = await Promise.all([
      fetchOSMHealthcareByAmenity(lat, lon, radiusKm, "nursing_home"),
      fetchOSMHealthcareByAmenity(lat, lon, radiusKm, "social_facility"),
    ]);
    const merged = dedupe([...nursing, ...social]);
    console.log("[OSM Healthcare] results:", { nursing: nursing.length, social: social.length, total: merged.length });
    return merged;
  } catch (e) {
    console.warn("[OSM Healthcare] non-bloquant:", e);
    return [];
  }
}

// =========================
// FINESS Official
// =========================
export async function fetchFinessOfficial(lat: number, lon: number, radiusKm: number): Promise<FinessEtablissementEnriched[]> {
  const radiusMeters = Math.round(radiusKm * 1000);
  const baseUrl = "https://public.opendatasoft.com/api/records/1.0/search/";
  const params = new URLSearchParams({
    dataset: "healthref-france-finess",
    rows: "200",
    "geofilter.distance": `${lat},${lon},${radiusMeters}`,
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[FINESS Official] Requête: ${url}`);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const data = await resp.json();
  const nhits = Number(data?.nhits || 0);
  const records: any[] = Array.isArray(data?.records) ? data.records : [];
  console.log(`[FINESS Official] nhits=${nhits} records=${records.length}`);

  once("FINESS_DETECT_KEY", () => {
    _finessCategoryKey = autoDetectCategoryKey(records);
    console.log("[DEBUG FINESS] detected category key:", _finessCategoryKey);
    if (_finessCategoryKey) {
      console.log("[DEBUG FINESS] top category values (official):", JSON.stringify(computeTopValues(records, _finessCategoryKey, 25), null, 2));
    }
    const samples = records.slice(0, 25).map((r) => {
      const f = r?.fields || {};
      const cat = _finessCategoryKey ? valueToString(f[_finessCategoryKey]) : valueToString(f.categetab);
      return {
        cat,
        rs: valueToString(f.rs ?? f.rslongue ?? f.nom ?? f.name),
        lib: valueToString(f.libcategorie ?? f.libcategetab ?? f.lib_categetab),
      };
    });
    console.log("[DEBUG FINESS] label samples (official):", JSON.stringify(samples, null, 2));
  });

  const out: FinessEtablissementEnriched[] = [];
  for (const r of records) {
    const fields = r?.fields || {};

    const categorie = _finessCategoryKey ? valueToString(fields[_finessCategoryKey]) : pickCategory(fields);
    const blob = `${categorie} ${pickLabelBlob(fields)} ${valueToString(fields.rs ?? fields.rslongue ?? fields.nom ?? fields.name)}`;

    const byCategory =
      categorie.startsWith("5") ||
      categorie.startsWith("202") ||
      categorie.startsWith("207") ||
      categorie.startsWith("500") ||
      categorie.startsWith("501") ||
      categorie.startsWith("502") ||
      categorie.startsWith("381") ||
      categorie.startsWith("382");

    const byName = looksLikeElderly(blob);
    if (!byCategory && !byName) continue;

    // === PATCH: log ciblé sur EHPAD 500 pour inspecter champs geo
    once("FINESS_EHPAD_500_GEO_FIELDS", () => {
      if (categorie === "500") {
        const keys = Object.keys(fields || {});
        const interesting = keys.filter((k) => {
          const s = k.toLowerCase();
          return s.includes("coord") || s.includes("geo") || s.includes("lat") || s.includes("lon") || s.includes("shape") || s.includes("point");
        });
        console.log("[DEBUG EHPAD 500] keys=", keys);
        console.log("[DEBUG EHPAD 500] geo keys=", interesting);
        console.log("[DEBUG EHPAD 500] sample values=", {
          coordonnees: fields.coordonnees,
          geo_point_2d: fields.geo_point_2d,
          latitude: fields.latitude,
          longitude: fields.longitude,
          lat: fields.lat,
          lon: fields.lon,
          geo_shape: fields.geo_shape,
          geojson: fields.geojson,
          geometry: fields.geometry,
          coordxet: fields.coordxet,
          coordyet: fields.coordyet,
          coordx: fields.coordx,
          coordy: fields.coordy,
        });
      }
    });

    // === PATCH: extraction coords robuste + fallback
    const norm = extractCoordsFromFields(fields, lat, lon);
    const finalLat = norm?.lat ?? lat;
    const finalLon = norm?.lon ?? lon;

    // Distance calculée uniquement si on a des coordonnées valides
    const distance = norm ? haversineDistance(lat, lon, finalLat, finalLon) : 0;
    if (norm && distance > radiusKm) continue;

    // Construction de l'adresse avec la fonction améliorée
    const address_full = buildAddressFromFields(fields);
    
    // Fallback pour address (rue seule)
    const address =
      [fields.numvoie, fields.typvoie, fields.voie].filter(Boolean).join(" ").trim() ||
      pick(fields, ["ligneacheminement", "adresse"], "");

    const postalCode = pick(fields, ["codepostal", "cp"], "");
    const commune = pick(fields, ["libcommune", "commune"], "");
    const phone = pick(fields, ["telephone", "phone", "tel"], "");

    out.push({
      finess: fields.nofinesset || fields.finess || "",
      finessEj: fields.nofinessej || "",
      name: pick(fields, ["rs", "rslongue", "nom", "name"], "Établissement"),
      category: categorie,
      categoryLabel: pick(fields, ["libcategorie", "libcategetab", "lib_categetab"], getCategoryLabel(categorie)),
      address,
      postalCode,
      commune,
      departement: pick(fields, ["departement", "meta_code_dep"], ""),
      lat: finalLat,
      lon: finalLon,
      capacity: pickCapacity(fields) || 0,
      telephone: phone || fields.telephone,
      distance,
      // Champs enrichis
      address_full: address_full || buildFullAddress(address, postalCode, commune),
      phone: phone || fields.telephone || undefined,
    });
  }

  const res = dedupe(out);
  console.log(`[FINESS Official] elderly kept=${res.length}`);
  return res;
}

// =========================
// FINESS TextSearch (radius*2)
// =========================
export async function fetchFinessTextSearch(lat: number, lon: number, radiusKm: number, codePostal?: string): Promise<FinessEtablissementEnriched[]> {
  const radiusMeters = Math.round(radiusKm * 1000);
  const baseUrl = "https://public.opendatasoft.com/api/records/1.0/search/";
  const params = new URLSearchParams({
    dataset: "healthref-france-finess",
    rows: "200",
    "geofilter.distance": `${lat},${lon},${radiusMeters * 2}`,
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[FINESS TextSearch] Requête: ${url}`);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = await resp.json();
  const nhits = Number(data?.nhits || 0);
  const records: any[] = Array.isArray(data?.records) ? data.records : [];
  console.log(`[FINESS TextSearch] nhits=${nhits} records=${records.length}`);

  once("FINESS_TEXT_KEY", () => {
    const key = autoDetectCategoryKey(records);
    console.log("[DEBUG FINESS TEXT] detected category key:", key);
    if (key) {
      console.log("[DEBUG FINESS TEXT] top category values:", JSON.stringify(computeTopValues(records, key, 25), null, 2));
    }
  });

  const out: FinessEtablissementEnriched[] = [];
  for (const r of records) {
    const fields = r?.fields || {};

    const categorie = _finessCategoryKey ? valueToString(fields[_finessCategoryKey]) : pickCategory(fields);
    const blob = `${categorie} ${pickLabelBlob(fields)} ${valueToString(fields.rs ?? fields.rslongue ?? fields.nom ?? fields.name)}`;

    const byCategory =
      categorie.startsWith("5") ||
      categorie.startsWith("202") ||
      categorie.startsWith("207") ||
      categorie.startsWith("500") ||
      categorie.startsWith("501") ||
      categorie.startsWith("502") ||
      categorie.startsWith("381") ||
      categorie.startsWith("382");

    const byName = looksLikeElderly(blob);
    if (!byCategory && !byName) continue;

    // === PATCH: coords robust + fallback
    const norm = extractCoordsFromFields(fields, lat, lon);
    const finalLat = norm?.lat ?? lat;
    const finalLon = norm?.lon ?? lon;

    // Distance calculée uniquement si on a des coordonnées valides
    const distance = norm ? haversineDistance(lat, lon, finalLat, finalLon) : 0;
    if (norm && distance > radiusKm) continue;

    // Construction de l'adresse avec la fonction améliorée
    const address_full = buildAddressFromFields(fields);

    const address = pick(fields, ["voie", "adresse", "ligneacheminement"], "");
    const postalCode = pick(fields, ["codepostal", "cp"], "");
    const commune = pick(fields, ["libcommune", "commune"], "");
    const phone = pick(fields, ["telephone", "phone", "tel"], "");

    out.push({
      finess: fields.nofinesset || "",
      finessEj: fields.nofinessej || "",
      name: pick(fields, ["rs", "rslongue", "nom", "name"], "Établissement"),
      category: categorie,
      categoryLabel: pick(fields, ["libcategorie", "libcategetab", "lib_categetab"], getCategoryLabel(categorie)),
      address,
      postalCode,
      commune,
      departement: pick(fields, ["departement", "meta_code_dep"], ""),
      lat: finalLat,
      lon: finalLon,
      capacity: pickCapacity(fields) || 0,
      telephone: phone || fields.telephone,
      distance,
      // Champs enrichis
      address_full: address_full || buildFullAddress(address, postalCode, commune),
      phone: phone || fields.telephone || undefined,
    });
  }

  const res = dedupe(out);
  console.log(`[FINESS TextSearch] elderly kept=${res.length}`);
  return res;
}

// =========================
// ORCHESTRATION PRINCIPALE
// Retourne TOUJOURS un tableau normalisé (même vide)
// =========================
export async function fetchAllEHPAD(lat: number, lon: number, radiusKm: number): Promise<NormalizedEHPADItem[]> {
  console.log(`[EHPAD Search] Recherche combinée: lat=${lat}, lon=${lon}, rayon=${radiusKm}km`);

  const [osmResults, officialRes, textRes] = await Promise.all([
    fetchOSMHealthcare(lat, lon, radiusKm).catch((e) => {
      console.warn("[EHPAD Search] OSM failed (non-bloquant):", e);
      return [];
    }),
    fetchFinessOfficial(lat, lon, radiusKm).catch((e) => {
      console.warn("[EHPAD Search] FINESS Official failed (non-bloquant):", e);
      return [];
    }),
    fetchFinessTextSearch(lat, lon, radiusKm).catch((e) => {
      console.warn("[EHPAD Search] FINESS Text failed (non-bloquant):", e);
      return [];
    }),
  ]);

  // Dédupliquer les résultats bruts
  const deduped = dedupe([...osmResults, ...officialRes, ...textRes]);
  
  // Convertir en format normalisé
  const normalizedItems: NormalizedEHPADItem[] = deduped.map(toNormalizedItem);

  // === LOGS DEBUG (max 3) ===
  console.log("[fetchAllEHPAD] RESULT:", {
    type: Array.isArray(normalizedItems) ? "Array" : typeof normalizedItems,
    length: normalizedItems.length,
    sources: { osm: osmResults.length, official: officialRes.length, text: textRes.length },
  });
  
  if (normalizedItems.length > 0) {
    console.log("[fetchAllEHPAD] SAMPLE item[0]:", {
      name: normalizedItems[0].name,
      address: normalizedItems[0].address,
      beds_total: normalizedItems[0].beds_total,
      distance_km: normalizedItems[0].distance_km,
      keys: Object.keys(normalizedItems[0]),
    });
  }

  // TOUJOURS retourner un tableau (même vide)
  return normalizedItems;
}

// =========================
// CONVERSION → EHPADData (pour compatibilité avec l'ancien code)
// =========================
export function convertToEhpadData(etablissements: NormalizedEHPADItem[], insee?: InseeData): EHPADData {
  const totalCapacity = etablissements.reduce((sum, e) => sum + (e.beds_total || 0), 0);
  const nbWithCapacity = etablissements.filter((e) => (e.beds_total || 0) > 0).length;
  const capacityAvailable = totalCapacity > 0;

  let densiteLits1000Seniors: number | undefined;
  const pct75 = Number((insee as any)?.pct_plus_75);
  if (capacityAvailable && insee?.population && Number.isFinite(pct75)) {
    const pop75Plus = (insee.population * pct75) / 100;
    densiteLits1000Seniors = pop75Plus > 0 ? (totalCapacity / pop75Plus) * 1000 : undefined;
  }

  let verdict = "";
  if (etablissements.length === 0) {
    verdict = "Aucun EHPAD identifié dans la zone d'étude. Potentiel marché à explorer.";
  } else if (!capacityAvailable) {
    // A) Capacité non disponible
    if (etablissements.length <= 2) {
      verdict = `Faible concurrence avec seulement ${etablissements.length} établissement(s). Capacité (lits) non disponible via FINESS/OSM.`;
    } else if (etablissements.length <= 5) {
      verdict = `Marché modérément concurrentiel avec ${etablissements.length} établissements. Capacité (lits) non disponible via FINESS/OSM.`;
    } else {
      verdict = `Marché très concurrentiel avec ${etablissements.length} établissements. Capacité (lits) non disponible via FINESS/OSM.`;
    }
  } else {
    // Capacité disponible
    if (etablissements.length <= 2) {
      verdict = `Faible concurrence avec seulement ${etablissements.length} établissement(s) et ${totalCapacity} lits. Opportunité de marché potentielle.`;
    } else if (etablissements.length <= 5) {
      verdict = `Marché modérément concurrentiel avec ${etablissements.length} établissements et ${totalCapacity} lits.`;
    } else {
      verdict = `Marché très concurrentiel avec ${etablissements.length} établissements totalisant ${totalCapacity} lits. Vigilance requise sur le positionnement.`;
    }
  }

  return {
    count: etablissements.length,
    nearest: etablissements.length
      ? {
          nom: etablissements[0].name,
          commune: etablissements[0].commune || "",
          distance_km: etablissements[0].distance_km || 0,
          capacite: etablissements[0].beds_total || 0,
        }
      : undefined,
    liste: etablissements.map((e) => ({
      // === Champs existants (rétrocompatibilité) ===
      nom: e.name,
      commune: e.commune || "",
      distance_km: e.distance_km || 0,
      capacite: e.beds_total || 0,
      finess: e.finess || "",
      adresse: e.address,
      telephone: e.telephone || undefined,
      
      // === Champs normalisés pour le front ===
      name: e.name,
      address: e.address,
      beds_total: e.beds_total,
    })),
    analyse_concurrence: {
      capacite_totale: capacityAvailable ? totalCapacity : undefined,
      capacite_disponible: capacityAvailable,
      nb_avec_capacite: nbWithCapacity,
      densite_lits_1000_seniors: densiteLits1000Seniors,
      verdict,
    },
  };
}