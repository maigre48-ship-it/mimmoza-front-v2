// ============================================================================
// Knowledge Graph — adaptateur Mimmoza (câblé sur les Edge Functions réelles)
//
// Localisation parcelle-précise (ÉTAPE 2) :
//   - INSEE = 5 premiers caractères de la réf cadastrale.
//   - coords via `resolveParcelCoordinates` -> Edge Function `cadastre-parcelle-by-id`
//     (source="parcel", confidence="high") ; fallback centroïde commune (low).
// PLU (ÉTAPE 3) : `resolveParcelPluContext` -> `plu-from-parcelle-v2`
//     body { commune_insee, parcel_id } (le 400 venait de l'ancien body { parcelle }).
//
// ✅ Câblés : cadastre-parcelle-by-id, plu-from-parcelle-v2,
//             risk-study-v1, transport-score-gtfs-v1, dvf-comparables-v1.
// ⚠️  À brancher : OAP, opportunity, valuation.
// ============================================================================

import { supabase } from "@/lib/supabaseClient";
import { resolveParcelCoordinates } from "./resolvers/parcelResolver";
import { resolveParcelPluContext } from "./resolvers/pluResolver";
import {
  createKnowledgeGraph,
  type CommuneData,
  type DvfClusterData,
  type KnowledgeGraph,
  type KnowledgeGraphProviders,
  type MarketAreaData,
  type MobilityData,
  type OapData,
  type OpportunityData,
  type OpportunityResolution,
  type ParcelData,
  type PluZoneData,
  type RiskData,
  type TransactionData,
  type ValuationResolution,
} from "@/services/knowledgeGraph";

// --- Helpers -----------------------------------------------------------------
type Json = Record<string, unknown>;

async function invoke(name: string, body: Json): Promise<unknown> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asRecord(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}
function str(rec: Json, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" ? v : undefined;
}
function num(rec: Json, key: string): number | undefined {
  const v = rec[key];
  return typeof v === "number" ? v : undefined;
}

// INSEE = préfixe de la réf cadastrale (ex. "64065000AI0001" -> "64065").
function inseeFromParcel(parcelKey: string): string | null {
  const m = parcelKey.match(/^(\d{5})/);
  return m ? m[1] : null;
}

// Constructibilité par préfixe de zone PLU (convention FR), repli quand `ces` absent.
//   U*  (UA, UB, UC, UH, UY...) -> urbaine        -> constructible
//   AU* (1AU, 2AU, AUa...)      -> à urbaniser     -> constructible (sous conditions)
//   A*  (A, Ap...)              -> agricole        -> non constructible
//   N*  (N, Nh...)              -> naturelle       -> non constructible
function buildableFromZoneCode(code: string | undefined): boolean | undefined {
  if (!code) return undefined;
  const c = code.trim().toUpperCase();
  if (/^\d*AU/.test(c)) return true;
  if (/^U/.test(c)) return true;
  if (/^A/.test(c)) return false;
  if (/^N/.test(c)) return false;
  return undefined;
}

type GeoSource = "parcel" | "commune_centroid";
type GeoConfidence = "high" | "medium" | "low";
type Loc = {
  lat: number;
  lon: number;
  insee: string;
  name: string;
  source: GeoSource;
  confidence: GeoConfidence;
};

// --- Providers ---------------------------------------------------------------
export function createMimmozaProviders(): KnowledgeGraphProviders {
  const locCache = new Map<string, Loc | null>();
  const nameCache = new Map<string, string | null>();
  const callCache = new Map<string, unknown>();

  async function invokeOnce(name: string, parcelKey: string, body: Json): Promise<Json> {
    const k = name + ":" + parcelKey;
    if (!callCache.has(k)) callCache.set(k, await invoke(name, body));
    return asRecord(callCache.get(k));
  }

  // Nom de commune (cosmétique) — geo.api.gouv.fr, public, sans auth.
  async function communeName(insee: string): Promise<string | null> {
    if (nameCache.has(insee)) return nameCache.get(insee) ?? null;
    let name: string | null = null;
    try {
      const res = await fetch("https://geo.api.gouv.fr/communes/" + insee + "?fields=nom");
      if (res.ok) name = str(asRecord(await res.json()), "nom") ?? null;
    } catch {
      /* ignore */
    }
    nameCache.set(insee, name);
    return name;
  }

  // Localisation parcelle-précise + provenance (source/confidence).
  async function locate(parcelKey: string): Promise<Loc | null> {
    if (locCache.has(parcelKey)) return locCache.get(parcelKey) ?? null;
    const insee = inseeFromParcel(parcelKey);
    let loc: Loc | null = null;

    if (insee) {
      const coords = await resolveParcelCoordinates(parcelKey);
      if (coords) {
        const name = (await communeName(insee)) ?? insee;
        loc = {
          lat: coords.latitude,
          lon: coords.longitude,
          insee,
          name,
          source: coords.source,
          confidence: coords.confidence,
        };
      }
    }

    locCache.set(parcelKey, loc);
    return loc;
  }

  return {
    // -- Parcelle (porte la provenance géo dans metadata -> remonte au nœud racine) --
    async getParcel(parcelKey: string): Promise<ParcelData> {
      const loc = await locate(parcelKey);
      return {
        key: parcelKey,
        displayName: parcelKey,
        metadata: loc
          ? { geo_source: loc.source, geo_confidence: loc.confidence, lat: loc.lat, lon: loc.lon }
          : {},
      };
    },

    // -- Commune (INSEE + nom) ----------------------------------------------
    async getCommune(parcelKey: string): Promise<CommuneData | null> {
      const loc = await locate(parcelKey);
      if (!loc) return null;
      return { inseeCode: loc.insee, name: loc.name, metadata: {} };
    },

    // -- Zones PLU : plu-from-parcelle-v2 via resolveParcelPluContext --------
    async getPluZones(parcelKey: string): Promise<PluZoneData[]> {
      const plu = await resolveParcelPluContext(parcelKey);
      if (plu.status !== "PLU_READY" || !plu.zone) return [];
      const rec = asRecord(plu.constraints);
      const ruleset = asRecord(rec.ruleset);
      const ces =
        num(ruleset, "ces_max") ??
        num(ruleset, "emprise_sol") ??
        num(rec, "ces_max") ??
        num(rec, "emprise_sol");
      const buildable = ces !== undefined ? ces > 0 : buildableFromZoneCode(plu.zone);
      return [
        {
          zoneKey: parcelKey + ":" + plu.zone,
          label: str(rec, "zone_libelle") ?? plu.zone,
          buildable,
          metadata: { zone_code: plu.zone, source: plu.source, confidence: plu.confidence },
        },
      ];
    },

    // -- OAP : ⚠️ oap-parser (à brancher) -----------------------------------
    async getOaps(_parcelKey: string): Promise<OapData[]> {
      return [];
    },

    // -- Risques : risk-study-v1 (categories[].risks[]) ---------------------
    async getRisks(parcelKey: string): Promise<RiskData[]> {
      const loc = await locate(parcelKey);
      if (!loc) return [];
      const data = await invokeOnce("risk-study-v1", parcelKey, {
        commune_insee: loc.insee,
        lat: loc.lat,
        lon: loc.lon,
      });
      const out: RiskData[] = [];
      for (const cat of asArray(data.categories)) {
        const c = asRecord(cat);
        for (const raw of asArray(c.risks)) {
          const rk = asRecord(raw);
          const name = str(rk, "name");
          const level = str(rk, "level");
          if (!name) continue;
          if (level === "fort" || level === "moyen" || level === "faible") {
            out.push({
              riskKey: parcelKey + ":" + name,
              riskType: name,
              severity: level,
              metadata: { detail: str(rk, "detail") ?? null },
            });
          }
        }
      }
      return out;
    },

    // -- Mobilité : transport-score-gtfs-v1 (data.score.top_stops) ----------
    async getMobility(parcelKey: string): Promise<MobilityData[]> {
      const loc = await locate(parcelKey);
      if (!loc) return [];
      const data = await invokeOnce("transport-score-gtfs-v1", parcelKey, {
        lat: loc.lat,
        lon: loc.lon,
        radius_m: 2000,
      });
      const score = asRecord(data.score);
      return asArray(score.top_stops).map((raw, i) => {
        const s = asRecord(raw);
        return {
          mobilityKey: parcelKey + ":stop:" + i,
          label: str(s, "name") ?? "Arrêt " + i,
          mode: str(s, "mode"),
          distanceM: num(s, "distance_m"),
          metadata: {},
        };
      });
    },

    // -- Cluster DVF : dvf-comparables-v1 (stats) ---------------------------
    async getDvfCluster(parcelKey: string): Promise<DvfClusterData | null> {
      const loc = await locate(parcelKey);
      if (!loc) return null;
      const data = await invokeOnce("dvf-comparables-v1", parcelKey, {
        lat: loc.lat,
        lon: loc.lon,
        commune_insee: loc.insee,
        radius_km: 2,
        horizon_months: 24,
      });
      const stats = asRecord(data.stats);
      const median =
        num(stats, "price_median_eur_m2") ??
        num(stats, "price_m2_median") ??
        num(stats, "median_eur_m2");
      if (median === undefined) return null;
      const evo =
        num(stats, "evolution_pct") ??
        num(stats, "evolution") ??
        num(stats, "trend_pct") ??
        num(stats, "yoy_pct") ??
        num(stats, "variation_pct");
      const trend: "up" | "down" | "stable" | undefined =
        evo === undefined ? undefined : evo > 0.5 ? "up" : evo < -0.5 ? "down" : "stable";
      return {
        clusterKey: loc.insee + ":dvf",
        label: "Marché DVF local",
        medianPricePerM2: median,
        trend,
        sampleSize: num(stats, "transactions_count") ?? num(stats, "count"),
        metadata: {},
      };
    },

    // -- Transactions DVF : dvf-comparables-v1 (comps) ----------------------
    async getDvfTransactions(parcelKey: string): Promise<TransactionData[]> {
      const loc = await locate(parcelKey);
      if (!loc) return [];
      const data = await invokeOnce("dvf-comparables-v1", parcelKey, {
        lat: loc.lat,
        lon: loc.lon,
        commune_insee: loc.insee,
        radius_km: 2,
        horizon_months: 24,
      });
      return asArray(data.comps).map((raw, i) => {
        const c = asRecord(raw);
        return {
          transactionKey: str(c, "id") ?? loc.insee + ":tx:" + i,
          label: str(c, "adresse") ?? str(c, "address"),
          pricePerM2: num(c, "price_m2") ?? num(c, "prix_m2") ?? num(c, "pricePerM2"),
          date: str(c, "date_mutation") ?? str(c, "date"),
          metadata: {},
        };
      });
    },

    // -- Comparables (valorisation) : même source DVF -----------------------
    async getComparables(parcelKey: string): Promise<TransactionData[]> {
      return this.getDvfTransactions(parcelKey);
    },

    // -- Opportunity : ⚠️ opportunity-engine-v1 (à brancher) ----------------
    async getOpportunity(_parcelKey: string): Promise<OpportunityData | null> {
      return null;
    },

    // -- Quartier / marché : ⚠️ à brancher ----------------------------------
    async getMarketArea(_parcelKey: string): Promise<MarketAreaData | null> {
      return null;
    },

    // -- Résolveurs racine : ⚠️ à brancher ----------------------------------
    async resolveOpportunity(_opportunityKey: string): Promise<OpportunityResolution | null> {
      return null;
    },
    async resolveValuation(_valuationKey: string): Promise<ValuationResolution | null> {
      return null;
    },
  };
}

// Instance prête à l'emploi pour le front.
export function createMimmozaKnowledgeGraph(): KnowledgeGraph {
  return createKnowledgeGraph({ client: supabase, providers: createMimmozaProviders() });
}