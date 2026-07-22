// ============================================================================
// RISK STUDY V1 - VERSION 1.0.3
// ============================================================================
// CHANGEMENTS v1.0.3 :
// - FIX CRITIQUE réseau : geo.api.gouv.fr est devenu injoignable/throttlé depuis
//   l'infra Supabase (les 3 branches de resolveCommune échouaient en cascade,
//   cf. logs "[Commune] ... non trouvé, fallback reverse geocoding").
//   → resolveCommune ne DÉPEND PLUS de geo.api : si un INSEE est fourni dans le
//     payload, on construit une commune minimale (code_insee brut + département
//     = 2 premiers chiffres) SANS appel réseau. geo.api n'est plus qu'un
//     enrichissement cosmétique (nom de commune), non bloquant.
//   → Géorisques (CATNAT, radon, SIS, ICPE, cavités, MVT, argiles) s'interroge
//     avec le code INSEE / lat-lon bruts : aucun n'a besoin de geo.api.
//   → Séisme et feux de forêt ne dépendent que du département (2 premiers
//     chiffres de l'INSEE), donc fonctionnent sans geo.api.
// - Timeouts geo.api réduits à 3500ms (échec plus rapide → fallback immédiat).
//
// CHANGEMENTS v1.0.2 :
// - INSEE du payload utilisé en PRIORITÉ avant le reverse geocoding.
// - Scores inversés : 100 = zone sûre, 0 = risque maximal.
//
// CHANGEMENTS v1.0.1 :
// - Fallback commune via INSEE si reverse geocoding échoue.
//
// CHANGEMENTS v1.0.0 :
// - Analyse des risques pour une parcelle/adresse/commune
// - Sources: Géorisques API (BRGM), IGN, data.gouv.fr
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

const VERSION = "1.0.3";
const GEORISQUES_API = "https://www.georisques.gouv.fr/api/v1";
const GEO_API_BASE = "https://geo.api.gouv.fr";
const BAN_API_URL = "https://api-adresse.data.gouv.fr";

// Timeout court pour geo.api : s'il est injoignable depuis Supabase, on échoue
// vite pour basculer sur le fallback INSEE plutôt que de bloquer 5s par appel.
const GEO_API_TIMEOUT_MS = 3500;

type RiskLevel = 'tres_fort' | 'fort' | 'moyen' | 'faible' | 'nul' | 'inconnu';
type Coverage = 'ok' | 'partial' | 'no_data' | 'error';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================================
// RISK LEVEL HELPERS
// ============================================================================

function getRiskScore(level: RiskLevel): number {
  switch (level) {
    case 'tres_fort': return 100;
    case 'fort': return 75;
    case 'moyen': return 50;
    case 'faible': return 25;
    case 'nul': return 0;
    default: return -1;
  }
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 80) return 'tres_fort';
  if (score >= 60) return 'fort';
  if (score >= 40) return 'moyen';
  if (score >= 20) return 'faible';
  if (score >= 0) return 'nul';
  return 'inconnu';
}

function maxRiskLevel(levels: RiskLevel[]): RiskLevel {
  const validLevels = levels.filter(l => l !== 'inconnu');
  if (validLevels.length === 0) return 'inconnu';
  const scores = validLevels.map(getRiskScore);
  return scoreToLevel(Math.max(...scores));
}

// ============================================================================
// GEOCODING
// ============================================================================

interface GeocodedLocation {
  lat: number;
  lon: number;
  source: 'address' | 'insee' | 'parcel' | 'coordinates';
  label?: string;
}

async function geocodeAddress(address: string): Promise<GeocodedLocation | null> {
  try {
    const url = `${BAN_API_URL}/search/?q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.features?.length) return null;
    const feature = data.features[0];
    const [lon, lat] = feature.geometry.coordinates;
    return { lat, lon, source: 'address', label: feature.properties?.label || address };
  } catch { return null; }
}

async function geocodeInseeCode(codeInsee: string): Promise<GeocodedLocation | null> {
  try {
    const url = `${GEO_API_BASE}/communes/${codeInsee}?fields=centre,nom&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(GEO_API_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.centre?.coordinates) return null;
    const [lon, lat] = data.centre.coordinates;
    return { lat, lon, source: 'insee', label: data.nom || codeInsee };
  } catch { return null; }
}

async function resolveCoordinates(payload: {
  lat?: number; lon?: number; address?: string;
  commune_insee?: string; code_insee?: string;
  parcel_id?: string;
}): Promise<GeocodedLocation | null> {
  if (typeof payload.lat === 'number' && typeof payload.lon === 'number' && !isNaN(payload.lat) && !isNaN(payload.lon)) {
    return { lat: payload.lat, lon: payload.lon, source: 'coordinates' };
  }
  if (payload.address && payload.address.trim().length > 3) {
    const result = await geocodeAddress(payload.address);
    if (result) return result;
  }
  if (payload.parcel_id && payload.parcel_id.length >= 10) {
    const codeInsee = payload.parcel_id.substring(0, 5);
    const result = await geocodeInseeCode(codeInsee);
    if (result) return { ...result, source: 'parcel', label: `Parcelle ${payload.parcel_id}` };
  }
  const inseeCode = payload.commune_insee || payload.code_insee;
  if (inseeCode && inseeCode.length === 5) {
    return await geocodeInseeCode(inseeCode);
  }
  return null;
}

// ============================================================================
// COMMUNE RESOLUTION
// ============================================================================

interface CommuneInfo {
  code_insee: string;
  nom: string;
  departement: string;
  region: string;
  population: number | null;
}

async function resolveCommuneByInsee(codeInsee: string): Promise<CommuneInfo | null> {
  try {
    const url = `${GEO_API_BASE}/communes/${codeInsee}?fields=code,nom,departement,region,population`;
    const res = await fetch(url, { signal: AbortSignal.timeout(GEO_API_TIMEOUT_MS) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.code) return null;
    return {
      code_insee: d.code,
      nom: d.nom,
      departement: d.departement?.code || codeInsee.substring(0, 2),
      region: d.region?.nom || "",
      population: d.population || null,
    };
  } catch { return null; }
}

async function resolveCommuneByLatLon(lat: number, lon: number): Promise<CommuneInfo | null> {
  try {
    const url = `${GEO_API_BASE}/communes?lat=${lat}&lon=${lon}&fields=code,nom,departement,region,population&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(GEO_API_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    const c = data[0];
    return {
      code_insee: c.code,
      nom: c.nom,
      departement: c.departement?.code || c.code?.substring(0, 2),
      region: c.region?.nom || "",
      population: c.population || null,
    };
  } catch { return null; }
}

// Construit une commune minimale SANS aucun appel réseau, à partir du seul
// code INSEE. Suffisant pour l'analyse de risques : Géorisques s'interroge avec
// le code INSEE brut, et séisme/feux de forêt ne dépendent que du département.
// Le nom reste le code INSEE (cosmétique) faute de mieux — on n'invente jamais
// de nom de commune (un code INSEE n'est pas un nom de ville).
function buildMinimalCommuneFromInsee(codeInsee: string): CommuneInfo {
  return {
    code_insee: codeInsee,
    nom: codeInsee,                       // cosmétique ; enrichi seulement si geo.api répond
    departement: codeInsee.substring(0, 2),
    region: "",
    population: null,
  };
}

// v1.0.3 : geo.api.gouv.fr est devenu injoignable depuis l'infra Supabase.
// resolveCommune NE DÉPEND PLUS de geo.api : si un INSEE valide est fourni,
// on garantit toujours un résultat (fallback hors-ligne). geo.api n'est qu'un
// enrichissement opportuniste du nom de commune.
async function resolveCommune(
  lat: number,
  lon: number,
  inseeFromPayload?: string,
): Promise<CommuneInfo | null> {
  const inseeValide = !!(inseeFromPayload && inseeFromPayload.length === 5);

  // 1. INSEE fourni → tentative geo.api (pour récupérer le nom propre)
  if (inseeValide) {
    const commune = await resolveCommuneByInsee(inseeFromPayload!);
    if (commune) return commune;
    console.warn(`[Commune] geo.api INSEE ${inseeFromPayload} injoignable, tentative reverse`);
  }

  // 2. Reverse geocoding depuis les coordonnées (peut aussi échouer si geo.api down)
  const communeByLatLon = await resolveCommuneByLatLon(lat, lon);
  if (communeByLatLon) return communeByLatLon;

  // 3. FALLBACK HORS-LIGNE : si on a un INSEE valide, on construit la commune
  //    directement, sans réseau. C'est ce qui débloque les analyses quand
  //    geo.api refuse l'IP Supabase. Le dept (séisme/feux) et le code INSEE
  //    (Géorisques) suffisent ; seul le nom reste cosmétique.
  if (inseeValide) {
    console.warn(`[Commune] geo.api totalement injoignable, fallback hors-ligne INSEE ${inseeFromPayload}`);
    return buildMinimalCommuneFromInsee(inseeFromPayload!);
  }

  // 4. Aucun INSEE fourni et geo.api KO → on ne peut vraiment rien faire.
  return null;
}

// ============================================================================
// GEORISQUES API CALLS
// ============================================================================

// --- GASPAR: Catastrophes naturelles ---
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
  coverage: Coverage;
}

async function fetchGaspar(codeInsee: string): Promise<GasparData> {
  const empty: GasparData = { catnat_count: 0, catnat_events: [], ppr_count: 0, ppr_list: [], coverage: 'no_data' };

  try {
    const catnatUrl = `${GEORISQUES_API}/gaspar/catnat?code_insee=${codeInsee}&page=1&page_size=100`;
    const catnatRes = await fetch(catnatUrl, { signal: AbortSignal.timeout(10000) });

    let catnatEvents: CatnatEvent[] = [];
    if (catnatRes.ok) {
      const catnatData = await catnatRes.json();
      if (catnatData?.data) {
        catnatEvents = catnatData.data.map((e: Record<string, unknown>) => ({
          code_national_catnat: e.code_national_catnat || "",
          date_debut: e.date_debut_evt || "",
          date_fin: e.date_fin_evt || "",
          date_publication_jo: e.date_publication_jo || "",
          libelle_risque: e.libelle_risque_jo || e.lib_risque_jo || "",
        }));
      }
    }

    const pprUrl = `${GEORISQUES_API}/gaspar/ppr?code_insee=${codeInsee}&page=1&page_size=50`;
    const pprRes = await fetch(pprUrl, { signal: AbortSignal.timeout(10000) });

    let pprList: Array<{ code: string; libelle: string; etat: string }> = [];
    if (pprRes.ok) {
      const pprData = await pprRes.json();
      if (pprData?.data) {
        pprList = pprData.data.map((p: Record<string, unknown>) => ({
          code: p.id_gaspar || "",
          libelle: p.libelle || "",
          etat: p.etat || "",
        }));
      }
    }

    return {
      catnat_count: catnatEvents.length,
      catnat_events: catnatEvents.slice(0, 20),
      ppr_count: pprList.length,
      ppr_list: pprList,
      coverage: catnatEvents.length > 0 || pprList.length > 0 ? 'ok' : 'no_data',
    };
  } catch (e) {
    console.error("[GASPAR] Error:", e);
    return empty;
  }
}

// --- RADON ---
interface RadonData {
  classe_potentiel: number | null;
  libelle: string;
  risk_level: RiskLevel;
  coverage: Coverage;
}

async function fetchRadon(codeInsee: string): Promise<RadonData> {
  const empty: RadonData = { classe_potentiel: null, libelle: "Inconnu", risk_level: 'inconnu', coverage: 'no_data' };

  try {
    const url = `${GEORISQUES_API}/radon?code_insee=${codeInsee}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data?.data?.length) return empty;

    const radon = data.data[0];
    const classe = radon.classe_potentiel;

    let libelle = "Inconnu";
    let riskLevel: RiskLevel = 'inconnu';

    if (classe === 1) { libelle = "Faible"; riskLevel = 'faible'; }
    else if (classe === 2) { libelle = "Moyen"; riskLevel = 'moyen'; }
    else if (classe === 3) { libelle = "Élevé"; riskLevel = 'fort'; }

    return { classe_potentiel: classe, libelle, risk_level: riskLevel, coverage: 'ok' };
  } catch (e) {
    console.error("[RADON] Error:", e);
    return empty;
  }
}

// --- INSTALLATIONS CLASSÉES (ICPE / SEVESO) ---
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
  coverage: Coverage;
}

async function fetchIcpe(lat: number, lon: number, radiusKm: number = 5): Promise<IcpeData> {
  const empty: IcpeData = {
    count: 0, seveso_haut_count: 0, seveso_bas_count: 0,
    installations: [], risk_level: 'nul', coverage: 'no_data'
  };

  try {
    const delta = radiusKm / 111;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    const url = `${GEORISQUES_API}/installations_classees?bbox=${bbox}&page=1&page_size=100`;

    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data?.data?.length) return empty;

    const installations: Installation[] = data.data.map((i: Record<string, unknown>) => {
      let distance_m: number | null = null;
      if (i.longitude && i.latitude) {
        const iLat = Number(i.latitude);
        const iLon = Number(i.longitude);
        const R = 6371000;
        const dLat = (iLat - lat) * Math.PI / 180;
        const dLon = (iLon - lon) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180) * Math.cos(iLat*Math.PI/180) * Math.sin(dLon/2)**2;
        distance_m = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      }
      return {
        nom: i.nom_ets || i.raison_sociale || "Installation",
        raison_sociale: i.raison_sociale || "",
        adresse: i.adresse || "",
        commune: i.commune || "",
        regime: i.regime || "",
        seveso: i.seveso || null,
        distance_m,
        activite: i.lib_activite || i.activite || "",
      };
    });

    installations.sort((a, b) => (a.distance_m ?? 99999) - (b.distance_m ?? 99999));

    const sevesoHaut = installations.filter(i => i.seveso?.toLowerCase().includes('haut')).length;
    const sevesoBas = installations.filter(i => i.seveso?.toLowerCase().includes('bas')).length;

    let riskLevel: RiskLevel = 'nul';
    const nearestSeveso = installations.find(i => i.seveso);
    if (nearestSeveso?.distance_m !== null && nearestSeveso?.distance_m !== undefined) {
      if (nearestSeveso.seveso?.toLowerCase().includes('haut')) {
        if (nearestSeveso.distance_m < 500) riskLevel = 'tres_fort';
        else if (nearestSeveso.distance_m < 1000) riskLevel = 'fort';
        else if (nearestSeveso.distance_m < 2000) riskLevel = 'moyen';
        else riskLevel = 'faible';
      } else if (nearestSeveso.seveso?.toLowerCase().includes('bas')) {
        if (nearestSeveso.distance_m < 300) riskLevel = 'fort';
        else if (nearestSeveso.distance_m < 800) riskLevel = 'moyen';
        else riskLevel = 'faible';
      }
    } else if (sevesoHaut > 0 || sevesoBas > 0) {
      riskLevel = 'moyen';
    }

    return {
      count: installations.length,
      seveso_haut_count: sevesoHaut,
      seveso_bas_count: sevesoBas,
      installations: installations.slice(0, 20),
      risk_level: riskLevel,
      coverage: 'ok',
    };
  } catch (e) {
    console.error("[ICPE] Error:", e);
    return empty;
  }
}

// --- SIS (Secteurs d'Information sur les Sols) ---
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
  coverage: Coverage;
}

async function fetchSis(lat: number, lon: number, codeInsee: string): Promise<SisData> {
  const empty: SisData = { count: 0, sites: [], risk_level: 'nul', coverage: 'no_data' };

  try {
    const url = `${GEORISQUES_API}/sis?code_insee=${codeInsee}&page=1&page_size=50`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data?.data?.length) return empty;

    const sites = data.data.map((s: Record<string, unknown>) => ({
      id: s.id_sis || s.numero || "",
      nom: s.nom || s.libelle || "Site pollué",
      adresse: s.adresse || "",
      commune: s.commune || "",
      superficie_m2: s.superficie ? Number(s.superficie) : null,
    }));

    return {
      count: sites.length,
      sites: sites.slice(0, 15),
      risk_level: sites.length > 3 ? 'fort' : sites.length > 0 ? 'moyen' : 'nul',
      coverage: 'ok',
    };
  } catch (e) {
    console.error("[SIS] Error:", e);
    return empty;
  }
}

// --- CAVITÉS SOUTERRAINES ---
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
  coverage: Coverage;
}

async function fetchCavites(lat: number, lon: number, radiusKm: number = 3): Promise<CaviteData> {
  const empty: CaviteData = { count: 0, cavites: [], risk_level: 'nul', coverage: 'no_data' };

  try {
    const delta = radiusKm / 111;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    const url = `${GEORISQUES_API}/cavites?bbox=${bbox}&page=1&page_size=100`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data?.data?.length) return empty;

    const cavites = data.data.map((c: Record<string, unknown>) => {
      let distance_m: number | null = null;
      if (c.longitude && c.latitude) {
        const cLat = Number(c.latitude);
        const cLon = Number(c.longitude);
        const R = 6371000;
        const dLat = (cLat - lat) * Math.PI / 180;
        const dLon = (cLon - lon) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180) * Math.cos(cLat*Math.PI/180) * Math.sin(dLon/2)**2;
        distance_m = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      }
      return {
        id: c.id_cavite || c.identifiant || "",
        type: c.type_cavite || c.origine || "Inconnue",
        nom: c.nom || "",
        profondeur_m: c.profondeur ? Number(c.profondeur) : null,
        distance_m,
      };
    });

    cavites.sort((a: { distance_m: number | null }, b: { distance_m: number | null }) =>
      (a.distance_m ?? 99999) - (b.distance_m ?? 99999)
    );

    let riskLevel: RiskLevel = 'nul';
    const nearest = cavites[0]?.distance_m;
    if (nearest !== null && nearest !== undefined) {
      if (nearest < 100) riskLevel = 'tres_fort';
      else if (nearest < 300) riskLevel = 'fort';
      else if (nearest < 500) riskLevel = 'moyen';
      else if (nearest < 1000) riskLevel = 'faible';
    } else if (cavites.length > 0) {
      riskLevel = 'moyen';
    }

    return {
      count: cavites.length,
      cavites: cavites.slice(0, 15),
      risk_level: riskLevel,
      coverage: 'ok',
    };
  } catch (e) {
    console.error("[CAVITES] Error:", e);
    return empty;
  }
}

// --- MOUVEMENTS DE TERRAIN ---
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
  coverage: Coverage;
}

async function fetchMouvementsTerrain(lat: number, lon: number, radiusKm: number = 3): Promise<MvtData> {
  const empty: MvtData = { count: 0, mouvements: [], risk_level: 'nul', coverage: 'no_data' };

  try {
    const delta = radiusKm / 111;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    const url = `${GEORISQUES_API}/mvt?bbox=${bbox}&page=1&page_size=100`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data?.data?.length) return empty;

    const mouvements = data.data.map((m: Record<string, unknown>) => {
      let distance_m: number | null = null;
      if (m.longitude && m.latitude) {
        const mLat = Number(m.latitude);
        const mLon = Number(m.longitude);
        const R = 6371000;
        const dLat = (mLat - lat) * Math.PI / 180;
        const dLon = (mLon - lon) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180) * Math.cos(mLat*Math.PI/180) * Math.sin(dLon/2)**2;
        distance_m = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      }
      return {
        id: m.identifiant || "",
        type: m.type_mvt || m.type || "Mouvement de terrain",
        date: m.date_debut || m.date || "",
        precision: m.precision_date || "",
        distance_m,
      };
    });

    mouvements.sort((a: { distance_m: number | null }, b: { distance_m: number | null }) =>
      (a.distance_m ?? 99999) - (b.distance_m ?? 99999)
    );

    let riskLevel: RiskLevel = 'nul';
    if (mouvements.length > 10) riskLevel = 'fort';
    else if (mouvements.length > 5) riskLevel = 'moyen';
    else if (mouvements.length > 0) riskLevel = 'faible';

    const nearest = mouvements[0]?.distance_m;
    if (nearest !== null && nearest !== undefined && nearest < 200) {
      riskLevel = maxRiskLevel([riskLevel, 'fort']);
    }

    return {
      count: mouvements.length,
      mouvements: mouvements.slice(0, 15),
      risk_level: riskLevel,
      coverage: 'ok',
    };
  } catch (e) {
    console.error("[MVT] Error:", e);
    return empty;
  }
}

// --- ARGILES (Retrait-Gonflement) ---
interface ArgilesData {
  niveau_alea: string | null;
  risk_level: RiskLevel;
  coverage: Coverage;
}

async function fetchArgiles(lat: number, lon: number): Promise<ArgilesData> {
  const empty: ArgilesData = { niveau_alea: null, risk_level: 'inconnu', coverage: 'no_data' };

  try {
    const url = `${GEORISQUES_API}/argiles?latlon=${lon},${lat}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data?.data?.length) return empty;

    const argile = data.data[0];
    const niveau = argile.niveau_alea || argile.exposition;

    let riskLevel: RiskLevel = 'inconnu';
    if (niveau?.toLowerCase().includes('fort')) riskLevel = 'fort';
    else if (niveau?.toLowerCase().includes('moyen')) riskLevel = 'moyen';
    else if (niveau?.toLowerCase().includes('faible')) riskLevel = 'faible';
    else if (niveau?.toLowerCase().includes('nul') || niveau?.toLowerCase().includes('a priori')) riskLevel = 'nul';

    return { niveau_alea: niveau || null, risk_level: riskLevel, coverage: 'ok' };
  } catch (e) {
    console.error("[ARGILES] Error:", e);
    return empty;
  }
}

// --- INONDATIONS ---
interface InondationData {
  zone_inondable: boolean;
  type_zone: string | null;
  tri: string | null;
  ppri: boolean;
  risk_level: RiskLevel;
  coverage: Coverage;
}

async function fetchInondations(codeInsee: string, gasparData: GasparData): Promise<InondationData> {
  const empty: InondationData = {
    zone_inondable: false, type_zone: null, tri: null,
    ppri: false, risk_level: 'inconnu', coverage: 'no_data'
  };

  try {
    const ppri = gasparData.ppr_list.some(p =>
      p.libelle?.toLowerCase().includes('inondation') ||
      p.code?.toLowerCase().includes('ppri')
    );

    const inondationEvents = gasparData.catnat_events.filter(e =>
      e.libelle_risque?.toLowerCase().includes('inondation')
    );

    let riskLevel: RiskLevel = 'inconnu';
    if (ppri && inondationEvents.length > 5) riskLevel = 'fort';
    else if (ppri || inondationEvents.length > 3) riskLevel = 'moyen';
    else if (inondationEvents.length > 0) riskLevel = 'faible';
    else riskLevel = 'nul';

    return {
      zone_inondable: ppri || inondationEvents.length > 0,
      type_zone: inondationEvents.length > 0 ? "Zone historiquement inondée" : null,
      tri: null,
      ppri,
      risk_level: riskLevel,
      coverage: 'ok',
    };
  } catch (e) {
    console.error("[INONDATION] Error:", e);
    return empty;
  }
}

// --- SEISME ---
interface SeismeData {
  zone: number | null;
  libelle: string;
  risk_level: RiskLevel;
  coverage: Coverage;
}

const SEISME_ZONES: Record<string, number> = {
  "04": 4, "05": 4, "06": 4, "38": 4, "73": 4, "74": 4,
  "64": 4, "65": 4, "66": 4, "09": 4,
  "01": 3, "07": 3, "26": 3, "42": 3, "43": 3, "63": 3, "69": 3,
  "11": 3, "30": 3, "34": 3, "48": 3, "81": 3, "82": 3,
  "31": 3, "32": 3, "40": 3, "47": 3,
  "67": 3, "68": 3, "90": 3, "25": 3, "39": 3, "70": 3, "71": 3,
  "2A": 3, "2B": 3,
  "02": 2, "08": 2, "10": 2, "21": 2, "51": 2, "52": 2, "54": 2, "55": 2, "57": 2, "88": 2,
  "03": 2, "15": 2, "18": 2, "19": 2, "23": 2, "24": 2, "33": 2, "46": 2, "87": 2,
  "12": 2, "13": 2, "83": 2, "84": 2,
};

function fetchSeisme(dept: string): SeismeData {
  const zone = SEISME_ZONES[dept] || 1;
  const libelles: Record<number, string> = { 1: "Très faible", 2: "Faible", 3: "Modéré", 4: "Moyen", 5: "Fort" };
  const riskLevels: Record<number, RiskLevel> = { 1: 'nul', 2: 'faible', 3: 'moyen', 4: 'fort', 5: 'tres_fort' };
  return {
    zone,
    libelle: libelles[zone] || "Inconnu",
    risk_level: riskLevels[zone] || 'inconnu',
    coverage: 'ok',
  };
}

// --- FEUX DE FORÊT ---
interface FeuxForetData {
  zone_risque: boolean;
  obligation_debroussaillement: boolean;
  risk_level: RiskLevel;
  coverage: Coverage;
}

const FEUX_FORET_DEPTS = new Set([
  "04", "05", "06", "13", "83", "84",
  "2A", "2B",
  "11", "30", "34", "66",
  "07", "26",
  "33", "40", "47", "64",
  "09", "31", "32", "65", "81", "82",
]);

function fetchFeuxForet(dept: string): FeuxForetData {
  const isRiskZone = FEUX_FORET_DEPTS.has(dept);
  return {
    zone_risque: isRiskZone,
    obligation_debroussaillement: isRiskZone,
    risk_level: isRiskZone ? 'moyen' : 'nul',
    coverage: 'ok',
  };
}

// ============================================================================
// SCORING GLOBAL
// v1.0.2 : scores de sécurité — 100 = zone sûre, 0 = risque maximal
// ============================================================================

interface RiskScores {
  global: number;
  naturels: number;
  technologiques: number;
  pollution: number;
  geotechniques: number;
}

interface RiskCategory {
  name: string;
  score: number;
  level: RiskLevel;
  risks: Array<{ name: string; level: RiskLevel; detail: string }>;
}

function computeRiskScores(
  gaspar: GasparData,
  radon: RadonData,
  icpe: IcpeData,
  sis: SisData,
  cavites: CaviteData,
  mvt: MvtData,
  argiles: ArgilesData,
  inondation: InondationData,
  seisme: SeismeData,
  feuxForet: FeuxForetData
): { scores: RiskScores; categories: RiskCategory[] } {

  // --- Risques Naturels ---
  const naturelRisks = [
    { name: "Inondation", level: inondation.risk_level, detail: inondation.ppri ? "PPRI actif" : `${gaspar.catnat_events.filter(e => e.libelle_risque?.toLowerCase().includes('inondation')).length} événements` },
    { name: "Séisme", level: seisme.risk_level, detail: `Zone ${seisme.zone} - ${seisme.libelle}` },
    { name: "Feux de forêt", level: feuxForet.risk_level, detail: feuxForet.zone_risque ? "Zone à risque" : "Hors zone" },
    { name: "Mouvements de terrain", level: mvt.risk_level, detail: `${mvt.count} événements recensés` },
  ];
  const naturelScores = naturelRisks.map(r => getRiskScore(r.level)).filter(s => s >= 0);
  const naturelRiskScore = naturelScores.length > 0 ? Math.round(naturelScores.reduce((a, b) => a + b, 0) / naturelScores.length) : 0;

  // --- Risques Technologiques ---
  const technoRisks = [
    { name: "SEVESO / ICPE", level: icpe.risk_level, detail: `${icpe.seveso_haut_count} seuil haut, ${icpe.seveso_bas_count} seuil bas` },
  ];
  const technoScores = technoRisks.map(r => getRiskScore(r.level)).filter(s => s >= 0);
  const technoRiskScore = technoScores.length > 0 ? Math.round(technoScores.reduce((a, b) => a + b, 0) / technoScores.length) : 0;

  // --- Pollution ---
  const pollutionRisks = [
    { name: "Sites pollués (SIS)", level: sis.risk_level, detail: `${sis.count} sites identifiés` },
    { name: "Radon", level: radon.risk_level, detail: `Classe ${radon.classe_potentiel} - ${radon.libelle}` },
  ];
  const pollutionScores = pollutionRisks.map(r => getRiskScore(r.level)).filter(s => s >= 0);
  const pollutionRiskScore = pollutionScores.length > 0 ? Math.round(pollutionScores.reduce((a, b) => a + b, 0) / pollutionScores.length) : 0;

  // --- Risques Géotechniques ---
  const geoRisks = [
    { name: "Argiles (RGA)", level: argiles.risk_level, detail: argiles.niveau_alea || "Non évalué" },
    { name: "Cavités souterraines", level: cavites.risk_level, detail: `${cavites.count} cavités` },
  ];
  const geoScores = geoRisks.map(r => getRiskScore(r.level)).filter(s => s >= 0);
  const geoRiskScore = geoScores.length > 0 ? Math.round(geoScores.reduce((a, b) => a + b, 0) / geoScores.length) : 0;

  // --- Score Global de risque brut (pondéré) ---
  const weights = { naturels: 0.35, technologiques: 0.25, pollution: 0.20, geotechniques: 0.20 };
  const globalRiskScore = Math.round(
    naturelRiskScore * weights.naturels +
    technoRiskScore * weights.technologiques +
    pollutionRiskScore * weights.pollution +
    geoRiskScore * weights.geotechniques
  );

  // Catégories avec scores de SÉCURITÉ (inversés)
  const categories: RiskCategory[] = [
    { name: "Risques Naturels", score: 100 - naturelRiskScore, level: scoreToLevel(naturelRiskScore), risks: naturelRisks },
    { name: "Risques Technologiques", score: 100 - technoRiskScore, level: scoreToLevel(technoRiskScore), risks: technoRisks },
    { name: "Pollution", score: 100 - pollutionRiskScore, level: scoreToLevel(pollutionRiskScore), risks: pollutionRisks },
    { name: "Risques Géotechniques", score: 100 - geoRiskScore, level: scoreToLevel(geoRiskScore), risks: geoRisks },
  ];

  // Scores de SÉCURITÉ exposés au frontend : 100 = zone sûre, 0 = risque maximal
  return {
    scores: {
      global:         100 - globalRiskScore,
      naturels:       100 - naturelRiskScore,
      technologiques: 100 - technoRiskScore,
      pollution:      100 - pollutionRiskScore,
      geotechniques:  100 - geoRiskScore,
    },
    categories,
  };
}

// ============================================================================
// GENERATE INSIGHTS
// ============================================================================

interface Insight {
  type: 'critical' | 'warning' | 'positive' | 'info';
  category: string;
  message: string;
}

function generateInsights(
  gaspar: GasparData,
  radon: RadonData,
  icpe: IcpeData,
  sis: SisData,
  cavites: CaviteData,
  mvt: MvtData,
  argiles: ArgilesData,
  inondation: InondationData,
  seisme: SeismeData,
  feuxForet: FeuxForetData,
  scores: RiskScores
): Insight[] {
  const insights: Insight[] = [];

  // Global assessment — scores.global est maintenant un score de SÉCURITÉ
  // (100 = très sûr → positif, bas = risqué → critique)
  if (scores.global <= 40) {
    insights.push({ type: 'critical', category: 'global', message: `Niveau de risque global ÉLEVÉ (score sécurité: ${scores.global}/100) - Études approfondies requises` });
  } else if (scores.global <= 60) {
    insights.push({ type: 'warning', category: 'global', message: `Niveau de risque global MODÉRÉ (score sécurité: ${scores.global}/100) - Vigilance recommandée` });
  } else if (scores.global <= 80) {
    insights.push({ type: 'info', category: 'global', message: `Niveau de risque global FAIBLE (score sécurité: ${scores.global}/100)` });
  } else {
    insights.push({ type: 'positive', category: 'global', message: `Niveau de risque global TRÈS FAIBLE (score sécurité: ${scores.global}/100)` });
  }

  if (inondation.ppri) {
    insights.push({ type: 'warning', category: 'inondation', message: "Zone couverte par un PPRI (Plan de Prévention du Risque Inondation)" });
  }

  const inondationEvents = gaspar.catnat_events.filter(e => e.libelle_risque?.toLowerCase().includes('inondation'));
  if (inondationEvents.length > 5) {
    insights.push({ type: 'warning', category: 'inondation', message: `${inondationEvents.length} arrêtés CATNAT inondation sur cette commune` });
  }

  if (icpe.seveso_haut_count > 0) {
    const nearest = icpe.installations.find(i => i.seveso?.toLowerCase().includes('haut'));
    insights.push({
      type: 'critical',
      category: 'technologique',
      message: `${icpe.seveso_haut_count} site(s) SEVESO seuil haut à proximité${nearest?.distance_m ? ` (le plus proche: ${(nearest.distance_m/1000).toFixed(1)} km)` : ''}`
    });
  }
  if (icpe.seveso_bas_count > 0) {
    insights.push({ type: 'warning', category: 'technologique', message: `${icpe.seveso_bas_count} site(s) SEVESO seuil bas à proximité` });
  }

  if (sis.count > 0) {
    insights.push({ type: 'warning', category: 'pollution', message: `${sis.count} Secteur(s) d'Information sur les Sols (pollution) identifié(s)` });
  }

  if (radon.classe_potentiel === 3) {
    insights.push({ type: 'warning', category: 'pollution', message: "Zone à potentiel radon élevé (classe 3) - Mesures recommandées" });
  }

  if (argiles.risk_level === 'fort') {
    insights.push({ type: 'warning', category: 'geotechnique', message: "Aléa retrait-gonflement des argiles FORT - Étude de sol obligatoire" });
  } else if (argiles.risk_level === 'moyen') {
    insights.push({ type: 'info', category: 'geotechnique', message: "Aléa retrait-gonflement des argiles moyen - Étude de sol recommandée" });
  }

  if (cavites.count > 0) {
    const nearest = cavites.cavites[0];
    insights.push({
      type: cavites.risk_level === 'fort' || cavites.risk_level === 'tres_fort' ? 'warning' : 'info',
      category: 'geotechnique',
      message: `${cavites.count} cavité(s) souterraine(s) recensée(s)${nearest?.distance_m ? ` (la plus proche: ${nearest.distance_m} m)` : ''}`
    });
  }

  if (mvt.count > 5) {
    insights.push({ type: 'warning', category: 'geotechnique', message: `${mvt.count} mouvements de terrain historiques dans le secteur` });
  }

  if (seisme.zone && seisme.zone >= 4) {
    insights.push({ type: 'warning', category: 'naturel', message: `Zone sismique ${seisme.zone} (${seisme.libelle}) - Règles parasismiques applicables` });
  }

  if (feuxForet.zone_risque) {
    insights.push({ type: 'info', category: 'naturel', message: "Zone exposée au risque feux de forêt - Obligation de débroussaillement" });
  }

  if (gaspar.ppr_count > 0) {
    insights.push({ type: 'info', category: 'reglementation', message: `${gaspar.ppr_count} Plan(s) de Prévention des Risques applicable(s)` });
  }

  if (scores.global >= 80 && icpe.seveso_haut_count === 0 && sis.count === 0) {
    insights.push({ type: 'positive', category: 'global', message: "Aucun risque majeur identifié sur cette zone" });
  }

  return insights;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ success: false, version: VERSION, error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json();
    const timings: Record<string, number> = {};

    // ── Géocodage ────────────────────────────────────────────────────────────
    const t0 = Date.now();
    let location = await resolveCoordinates(payload);
    timings.geocoding = Date.now() - t0;

    // v1.0.3 : si geo.api est injoignable, resolveCoordinates peut renvoyer null
    // alors qu'on a un INSEE valide. On ne bloque que si on n'a VRAIMENT aucune
    // localisation exploitable (ni lat/lon, ni INSEE).
    const inseeFromPayload = (payload.commune_insee || payload.code_insee) as string | undefined;
    if (!location && inseeFromPayload && inseeFromPayload.length === 5) {
      // On n'a pas de coordonnées mais on a un INSEE : Géorisques commune (CATNAT,
      // radon, SIS) fonctionnera ; les couches bbox (ICPE/cavités/MVT/argiles)
      // seront vides faute de lat/lon, mais l'analyse n'échoue pas.
      console.warn(`[Location] Pas de coordonnées (geo.api KO ?), poursuite avec INSEE ${inseeFromPayload}`);
      location = { lat: NaN, lon: NaN, source: 'insee', label: inseeFromPayload };
    }

    if (!location) {
      return new Response(JSON.stringify({
        success: false,
        version: VERSION,
        error: "Impossible de géolocaliser. Fournir: address, commune_insee, parcel_id, ou lat/lon.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { lat, lon } = location;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

    // ── Résolution commune ────────────────────────────────────────────────────
    // v1.0.3 : ne dépend plus de geo.api. Fallback hors-ligne via INSEE si besoin.
    const t1 = Date.now();
    const commune = await resolveCommune(lat, lon, inseeFromPayload);
    timings.commune = Date.now() - t1;

    if (!commune) {
      return new Response(JSON.stringify({
        success: false,
        version: VERSION,
        error: "Impossible de déterminer la commune. Fournir un commune_insee à 5 chiffres.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const codeInsee = commune.code_insee;
    const dept = commune.departement;
    const radiusKm = payload.radius_km ?? 5;

    // ── Appels APIs risques en parallèle ─────────────────────────────────────
    // Les couches bbox (ICPE/cavités/MVT/argiles) ont besoin de lat/lon. Si on
    // n'en a pas (geo.api KO + pas de coords payload), elles renvoient vide
    // proprement sans planter — on les saute pour éviter des bbox NaN.
    const t2 = Date.now();
    const [gaspar, radon, sis] = await Promise.all([
      fetchGaspar(codeInsee),
      fetchRadon(codeInsee),
      fetchSis(NaN, NaN, codeInsee),
    ]);

    const [icpe, cavites, mvt, argiles] = hasCoords
      ? await Promise.all([
          fetchIcpe(lat, lon, radiusKm),
          fetchCavites(lat, lon, radiusKm),
          fetchMouvementsTerrain(lat, lon, radiusKm),
          fetchArgiles(lat, lon),
        ])
      : [
          { count: 0, seveso_haut_count: 0, seveso_bas_count: 0, installations: [], risk_level: 'nul' as RiskLevel, coverage: 'no_data' as Coverage },
          { count: 0, cavites: [], risk_level: 'nul' as RiskLevel, coverage: 'no_data' as Coverage },
          { count: 0, mouvements: [], risk_level: 'nul' as RiskLevel, coverage: 'no_data' as Coverage },
          { niveau_alea: null, risk_level: 'inconnu' as RiskLevel, coverage: 'no_data' as Coverage },
        ];
    timings.api_calls = Date.now() - t2;

    // ── Données dérivées (synchrones) ─────────────────────────────────────────
    const inondation = await fetchInondations(codeInsee, gaspar);
    const seisme = fetchSeisme(dept);
    const feuxForet = fetchFeuxForet(dept);

    // ── Scoring & insights ────────────────────────────────────────────────────
    const { scores, categories } = computeRiskScores(
      gaspar, radon, icpe, sis, cavites, mvt, argiles, inondation, seisme, feuxForet
    );

    const insights = generateInsights(
      gaspar, radon, icpe, sis, cavites, mvt, argiles, inondation, seisme, feuxForet, scores
    );

    timings.total = Date.now() - startTime;

    const response = {
      success: true,
      version: VERSION,
      meta: {
        lat: hasCoords ? lat : null,
        lon: hasCoords ? lon : null,
        location_source: location.source,
        location_label: location.label,
        commune_insee: codeInsee,
        commune_nom: commune.nom,
        departement: dept,
        region: commune.region,
        radius_km: radiusKm,
        bbox_layers_evaluated: hasCoords,   // false = ICPE/cavités/MVT/argiles non évalués (pas de coords)
        generated_at: new Date().toISOString(),
      },
      scores,
      categories,
      data: {
        gaspar,
        radon,
        icpe,
        sis,
        cavites,
        mouvements_terrain: mvt,
        argiles,
        inondation,
        seisme,
        feux_foret: feuxForet,
      },
      insights,
      debug: payload.debug ? { timings, has_coords: hasCoords } : undefined,
    };

    return new Response(JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[risk-study] Error:", err);
    return new Response(JSON.stringify({ success: false, version: VERSION, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});