/**
 * SourcingHomePage
 * ── Redesign v6 : SmartScore-first layout ──
 * ── v6.2 : critères qualité enrichis (transport détaillé, extérieurs, confort, box) ──
 * ── v6.3 : correctif DVF robuste (geocodeAddressViaBan multi-stratégie, extractDvfFromResponse profond) ──
 * ── v6.5 : commune_insee normalisé en code arrondissement DVF direct (75116 vs 75056) + radius 3km ──
 *
 * Layout :
 *   ┌─────────────────────────────────────────────┐
 *   │  Bannière "Scoring"                         │
 *   ├─────────────────────────────────────────────┤
 *   │  SmartScore Hero (ring + axes + verdict)   │
 *   ├──────────────┬──────────────────────────────┤
 *   │  Deal list   │  SourcingForm + Résumé      │
 *   │  (color-     │  (tous les champs :         │
 *   │   coded)     │   localisation, caract.,    │
 *   │              │   quartier, options)        │
 *   └──────────────┴──────────────────────────────┘
 *
 * Toute la logique moteur (DVF, SmartScore v2/v3, persistence LS scoppée)
 * est conservée à l'identique.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { SourcingForm } from "../forms/SourcingForm";
import SmartScorePanel from "../../../components/sourcing/SmartScorePanel";

import { useSmartScore } from "../shared/hooks/useSmartScore";

import type {
  SourcingItemDraft,
  ProfileTarget,
  PropertyType,
} from "../types/sourcing.types";

import {
  formatFloor,
  formatPrice,
  formatSurface,
  calculatePricePerSqm,
  parseFloor,
} from "../utils/validators";

import { getPropertyTypeLabel } from "../selectors/propertySelectors";

import {
  getActiveDealId,
  getDealContextSnapshot,
  getDealContextMeta,
  subscribe as subscribeDealContext,
  type DealContextMeta,
} from "../../marchand/shared/marchandDealContext.store";

// ── DVF via Edge Function smartscore-enriched-v3 (v6.5) ──
import { supabase } from "../../../lib/supabaseClient";

// ============================================
// UTILITAIRE PRIVÉ 1 — Géocodage BAN multi-stratégie
// ============================================
// Stratégies tentées dans l'ordre :
//   1. rue + postcode= séparé (plus fiable que tout concaténé)
//   2. rue + CP dans q= (sans ville qui peut perturber BAN)
//   3. CP seul (centroïde commune, dernier recours)

interface BanGeoResult {
  lat: number;
  lon: number;
  label: string;
  score: number;
}

async function geocodeAddressViaBan(params: {
  rue?: string;
  codePostal?: string;
  ville?: string;
}): Promise<BanGeoResult | null> {
  const rue = (params.rue || "").trim();
  const cp  = (params.codePostal || "").trim();

  const strategies: { q: string; postcode?: string }[] = [];
  if (rue && cp) strategies.push({ q: rue, postcode: cp });
  if (rue && cp) strategies.push({ q: `${rue} ${cp}` });
  if (cp)        strategies.push({ q: cp });

  for (const strat of strategies) {
    try {
      const qs = new URLSearchParams({ q: strat.q, limit: "1" });
      if (strat.postcode) qs.set("postcode", strat.postcode);

      const url = `https://api-adresse.data.gouv.fr/search/?${qs.toString()}`;
      console.log("[BAN] Tentative géocodage →", url);

      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        console.warn("[BAN] HTTP", resp.status, "pour stratégie:", strat);
        continue;
      }

      const data = await resp.json();
      const feature = data?.features?.[0];
      const coords  = feature?.geometry?.coordinates;

      if (
        Array.isArray(coords) &&
        coords.length >= 2 &&
        Number.isFinite(Number(coords[0])) &&
        Number.isFinite(Number(coords[1]))
      ) {
        const result: BanGeoResult = {
          lat:   Number(coords[1]),
          lon:   Number(coords[0]),
          label: feature?.properties?.label ?? strat.q,
          score: feature?.properties?.score ?? 0,
        };
        console.log("[BAN] ✅ Géocodage réussi (stratégie:", strat.q, "):", result);
        return result;
      }

      console.warn("[BAN] Aucune coordonnée utilisable pour stratégie:", strat, "→ réponse:", data);
    } catch (err) {
      console.warn("[BAN] Erreur réseau pour stratégie:", strat, "→", err);
    }
  }

  console.error("[BAN] ❌ Toutes les stratégies ont échoué pour:", params);
  return null;
}

// ============================================
// UTILITAIRE PRIVÉ 2 — Extraction DVF robuste
// ============================================
// Parcourt les chemins connus, puis fait une recherche en profondeur (2 niveaux)
// pour survivre aux évolutions de structure de l'Edge Function.

function extractDvfFromResponse(
  data: any,
): { price_m2_median: number; comparables_count: number } | null {
  if (!data || typeof data !== "object") return null;

  const knownPaths: any[] = [
    data?.market_like?.dvf,
    data?.marketLike?.dvf,
    data?.dvf,
    data?.data?.market_like?.dvf,
    data?.data?.marketLike?.dvf,
    data?.data?.dvf,
    data?.result?.dvf,
    data?.result?.market_like?.dvf,
    data?.scoring?.dvf,
  ];

  const tryExtract = (
    candidate: any,
  ): { price_m2_median: number; comparables_count: number } | null => {
    if (!candidate || typeof candidate !== "object") return null;
    const kpis = candidate?.kpis ?? candidate?.metrics ?? candidate;
    const median =
      kpis?.price_median_eur_m2 ??
      kpis?.price_m2_median ??
      kpis?.median_price_m2 ??
      kpis?.prixM2Median ??
      null;
    const count =
      kpis?.transactions_count ??
      kpis?.comparables_count ??
      kpis?.count ??
      0;
    if (median != null && Number.isFinite(Number(median)) && Number(median) > 0) {
      return { price_m2_median: Number(median), comparables_count: Number(count) || 0 };
    }
    return null;
  };

  for (const candidate of knownPaths) {
    const result = tryExtract(candidate);
    if (result) return result;
  }

  // Recherche en profondeur — filet de sécurité sur 2 niveaux
  for (const key of Object.keys(data)) {
    const val = data[key];
    const r1 = tryExtract(val);
    if (r1) {
      console.log("[DVF] Trouvé via recherche profondeur 1, clé:", key);
      return r1;
    }
    if (val && typeof val === "object") {
      for (const subKey of Object.keys(val)) {
        const r2 = tryExtract(val[subKey]);
        if (r2) {
          console.log("[DVF] Trouvé via recherche profondeur 2, chemin:", `${key}.${subKey}`);
          return r2;
        }
      }
    }
  }

  return null;
}

// ============================================
// DVF VIA EDGE FUNCTION — v6.5 corrigé
// ============================================

async function fetchDvfViaEdgeFunction(params: {
  codePostal: string;
  rueProche?: string;
  ville?: string;
  propertyType?: string;
  surface?: number;
  lat?: number;
  lng?: number;
}): Promise<{ price_m2_median: number | null; comparables_count: number }> {
  const FALLBACK = { price_m2_median: null, comparables_count: 0 };

  try {
    const cp    = (params.codePostal || "").trim();
    const rue   = (params.rueProche  || "").trim();
    const ville = (params.ville      || "").trim();

    console.log("[DVF] ══ fetchDvfViaEdgeFunction ══");
    console.log("[DVF] Params entrants:", {
      cp, rue, ville,
      propertyType: params.propertyType,
      surface: params.surface,
      lat: params.lat,
      lng: params.lng,
    });

    // ── Étape 1 : commune_insee ──
    let communeInsee: string | null = null;

    if (/^750\d{2}$/.test(cp)) communeInsee = "75056";
    else if (/^6900[1-9]$/.test(cp)) communeInsee = "69123";
    else if (/^130(0[1-9]|1[0-6])$/.test(cp)) communeInsee = "13055";

    if (!communeInsee && cp.length === 5) {
      try {
        const geoResp = await fetch(
          `https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=code,nom&limit=5`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (geoResp.ok) {
          const communes = await geoResp.json();
          if (Array.isArray(communes) && communes.length > 0) {
            communeInsee = communes[0]?.code ?? null;
          }
        }
      } catch (geoErr) {
        console.warn("[DVF] geo.api.gouv.fr KO:", geoErr);
      }
    }

    console.log("[DVF] commune_insee résolu:", communeInsee);
    if (!communeInsee) {
      console.error("[DVF] ❌ commune_insee introuvable pour CP:", cp, "→ FALLBACK");
      return FALLBACK;
    }

    // ── Étape 2 : lat / lon — param direct prioritaire, sinon BAN ──
    let lat: number | null =
      typeof params.lat === "number" && Number.isFinite(params.lat) ? params.lat : null;
    let lon: number | null =
      typeof params.lng === "number" && Number.isFinite(params.lng) ? params.lng : null;

    console.log("[DVF] lat/lon reçus en param:", { lat, lon });

    if (lat == null || lon == null) {
      console.log("[DVF] Géocodage BAN interne nécessaire...");
      const geo = await geocodeAddressViaBan({ rue, codePostal: cp, ville });
      if (geo) {
        lat = geo.lat;
        lon = geo.lon;
      } else {
        console.error("[DVF] ❌ BAN a échoué sur toutes les stratégies → FALLBACK");
        return FALLBACK;
      }
    }

    // Garde-fou final avant envoi
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.error("[DVF] ❌ lat/lon non finis après géocodage:", { lat, lon }, "→ FALLBACK");
      return FALLBACK;
    }

    // ── Étape 3 : normalisation commune_insee pour Paris / Lyon / Marseille ──
    // On envoie directement le code arrondissement DVF (ex: 75116 pour Paris 16e)
    // pour éviter que l'Edge Function rate la résolution BAN reverse interne.
    // Si on envoie "75116", COMMUNES_A_ARRONDISSEMENTS["75116"] est undefined →
    // Edge Function retourne dvfCode: "75116" directement, sans passer par BAN.
    let communeInseeForPayload = communeInsee;

    if (cp) {
      // Paris : 75016 → 75116 | 75116 → 75116 (déjà code DVF)
      if (/^750(\d{2})$/.test(cp)) {
        communeInseeForPayload = "751" + cp.slice(3);
        console.log("[DVF] CP Paris (750XX) normalisé →", communeInseeForPayload);
      } else if (/^751(\d{2})$/.test(cp)) {
        communeInseeForPayload = cp; // déjà le code arrondissement DVF
        console.log("[DVF] CP Paris (751XX) déjà code DVF →", communeInseeForPayload);
      }
      // Lyon : 69001–69009 → 69381–69389
      else if (/^6900([1-9])$/.test(cp)) {
        communeInseeForPayload = "6938" + cp.slice(4);
        console.log("[DVF] CP Lyon normalisé →", communeInseeForPayload);
      }
      // Marseille : 13001–13016 → 13201–13216
      else if (/^130(\d{2})$/.test(cp)) {
        const arr = parseInt(cp.slice(3), 10);
        if (arr >= 1 && arr <= 16) {
          communeInseeForPayload = "132" + String(arr).padStart(2, "0");
          console.log("[DVF] CP Marseille normalisé →", communeInseeForPayload);
        }
      }
    }

    // ── Étape 4 : construction payload ──
    const normalizedType =
      params.propertyType === "house" || params.propertyType === "maison"
        ? "Maison"
        : "Appartement";

    const payload = {
      mode:           "standard",
      commune_insee:  communeInseeForPayload,   // ← code arrondissement DVF direct
      lat,
      lon,
      // cp / ville / address : filtre DVF côté Edge Function
      cp:      cp    || null,
      ville:   ville || null,
      address: rue   || null,
      type_local:     normalizedType,
      surface:
        typeof params.surface === "number" &&
        Number.isFinite(params.surface) &&
        params.surface > 0
          ? params.surface
          : null,
      radius_km:      3,   // élargi à 3 km pour maximiser les comparables DVF
      horizon_months: 24,
      debug:          true,
    };

    console.log("[DVF] ✅ Payload confirmé (lat/lon réels, commune_insee:", communeInseeForPayload, "):", payload);

    // ── Étape 5 : appel Edge Function ──
    const accessToken =
      (await supabase.auth.getSession()).data.session?.access_token ?? null;

    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smartscore-enriched-v3`;
    console.log("[DVF] Appel Edge Function →", fnUrl);

    const resp = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey:          import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization:   accessToken
          ? `Bearer ${accessToken}`
          : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await resp.text();
    console.log("[DVF] HTTP status:", resp.status);
    console.log("[DVF] Réponse brute (800 chars):", rawText.slice(0, 800));

    if (!resp.ok) {
      console.error("[DVF] ❌ HTTP error:", resp.status, rawText);
      return FALLBACK;
    }

    // ── Étape 6 : parse JSON ──
    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (parseErr) {
      console.error("[DVF] ❌ JSON.parse échoué:", parseErr);
      return FALLBACK;
    }

    console.log("[DVF] Clés top-level réponse:", data ? Object.keys(data) : "null");

    // ── Étape 7 : extraction DVF robuste ──
    const extracted = extractDvfFromResponse(data);
    if (extracted) {
      console.log("[DVF] ✅ DVF extrait:", extracted);
      return extracted;
    }

    console.error("[DVF] ❌ Aucun bloc DVF exploitable trouvé. Réponse complète:", data);
    return FALLBACK;

  } catch (err) {
    console.error("[DVF] ❌ Exception non catchée:", err);
    return FALLBACK;
  }
}

// Alias conservé pour compatibilité
const fetchDvfEstimate = fetchDvfViaEdgeFunction;

// ============================================
// DESIGN TOKENS
// ============================================

const ACCENT = "#0ea5e9";
const ACCENT_DARK = "#0284c7";
const GRAD_BANNER = "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)";

function gradeColor(grade: string): string {
  return ({ A: "#22c55e", B: "#3b82f6", C: "#f59e0b", D: "#ef4444", E: "#991b1b" } as any)[grade] ?? "#94a3b8";
}

function verdictLabel(v: string): string {
  return ({ GO: "GO", GO_AVEC_RESERVES: "GO avec réserves", NO_GO: "NO GO" } as any)[v] ?? v;
}

function verdictColor(v: string): string {
  return ({ GO: "#22c55e", GO_AVEC_RESERVES: "#f59e0b", NO_GO: "#ef4444" } as any)[v] ?? "#94a3b8";
}

// ============================================
// FORM STATE
// ============================================

interface FormState {
  codePostal: string;
  rueProche: string;
  ville: string;
  arrondissement: string;
  quartier: string;
  propertyType: string;
  price: string;
  surface: string;
  floor: string;
  [key: string]: string;
}

const EMPTY_FORM: FormState = {
  codePostal: "",
  rueProche: "",
  ville: "",
  arrondissement: "",
  quartier: "",
  propertyType: "",
  price: "",
  surface: "",
  floor: "",
};

// ============================================
// DEAL-SCOPED PERSISTENCE KEYS
// ============================================

const SMARTSCORE_LS_PREFIX = "mimmoza.sourcing.smartscore.v1";
const SOURCING_KEY = "mimmoza.sourcing.smartscore.v1";

function smartscoreKey(dealId: string): string {
  return `${SMARTSCORE_LS_PREFIX}.${dealId}`;
}

const LEGACY_LS_KEYS = [
  "mimmoza.sourcing.smartscore.v1",
  "mimmoza.sourcing.formState",
  "mimmoza.sourcing.snapshot.v1",
] as const;

// ============================================
// PARSER FR
// ============================================

function parseNumberFR(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v)
    .trim()
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseFloorNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return -1;
  const s = String(v).trim().toLowerCase();
  if (s === "rdc" || s === "0") return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

function parseBoolField(v: unknown): boolean | null {
  if (v === true || v === "oui" || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "non" || v === "false" || v === 0 || v === "0") return false;
  return null;
}

function safeParse(raw: string | null): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ============================================
// MINIMUM VIABLE
// ============================================

const MINIMUM_VIABLE_MSG = "Renseigner le prix et la surface pour calculer le SmartScore.";

// ============================================
// DVF TYPES
// ============================================

interface DvfResult {
  price_m2_median: number | null;
  comparables_count: number;
}

const DVF_FALLBACK: DvfResult = { price_m2_median: null, comparables_count: 0 };

// ============================================
// PRIX/M² SCORE (v2)
// ============================================

interface PrixM2ScoreResult {
  rawScore: number;
  prixM2Bien: number;
  dvfMedian: number | null;
  nbComparables: number;
  deltaPct: number | null;
  dvfAvailable: boolean;
  explanation: string;
}

function lerpAnchors(anchors: [number, number][], x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  if (x >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

const PRIX_M2_ANCHORS: [number, number][] = [
  [-40, 100], [-30, 95], [-20, 88], [-10, 75], [-5, 63],
  [0, 50], [5, 35], [10, 18], [15, 8], [20, 3], [25, 0],
];

function computePrixM2Score(price: number, surface: number, dvf: DvfResult | null | undefined): PrixM2ScoreResult {
  const prixM2Bien = surface > 0 ? price / surface : 0;
  const dvfMedian = dvf?.price_m2_median ?? null;
  const nbComparables = dvf?.comparables_count ?? 0;

  if (dvfMedian == null || dvfMedian <= 0) {
    return {
      rawScore: 50,
      prixM2Bien,
      dvfMedian: null,
      nbComparables: 0,
      deltaPct: null,
      dvfAvailable: false,
      explanation: `Prix/m² bien : ${Math.round(prixM2Bien).toLocaleString("fr-FR")} €/m² · DVF indisponible → score Prix/m² neutre (50/100)`,
    };
  }

  const ratio = prixM2Bien / dvfMedian;
  const deltaPct = (ratio - 1) * 100;
  let score = Math.round(lerpAnchors(PRIX_M2_ANCHORS, deltaPct));
  if (nbComparables < 5) score = Math.round(50 + (score - 50) * 0.5);
  score = clamp(score, 0, 100);

  const sign = deltaPct >= 0 ? "+" : "";
  const decoteSurcote = deltaPct < -2 ? "Décote" : deltaPct > 2 ? "Surcote" : "Aligné marché";
  const comparablesNote = nbComparables < 5 ? ` (⚠ ${nbComparables} comparables, score atténué)` : "";
  const explanation =
    `Prix/m² bien : ${Math.round(prixM2Bien).toLocaleString("fr-FR")} €/m² · ` +
    `Médiane DVF : ${Math.round(dvfMedian).toLocaleString("fr-FR")} €/m² (${nbComparables} comp.) · ` +
    `${decoteSurcote} : ${sign}${deltaPct.toFixed(1)}%${comparablesNote}`;

  return { rawScore: score, prixM2Bien, dvfMedian, nbComparables, deltaPct, dvfAvailable: true, explanation };
}

// ============================================
// QUALITÉ SCORE (v3)
// ============================================

interface QualiteScoreResult {
  rawScore: number;
  bonusMalus: { label: string; value: number }[];
  explanation: string;
}

function readField(draft: any, key: string): unknown {
  return draft?.input?.[key] ?? draft?.[key];
}

function readBool(draft: any, key: string): boolean | null {
  return parseBoolField(readField(draft, key));
}

function pushBonus(
  items: { label: string; value: number }[],
  label: string,
  value: number,
): number {
  if (!value) return 0;
  items.push({ label, value });
  return value;
}

function computeTransportScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const metro    = readBool(draft, "metro");
  const rerTrain = readBool(draft, "rerTrain");
  const tram     = readBool(draft, "tram");
  const bus      = readBool(draft, "bus");

  if (metro    === true) total += pushBonus(items, "Métro proche", 6);
  if (rerTrain === true) total += pushBonus(items, "RER / train proche", 5);
  if (tram     === true) total += pushBonus(items, "Tram proche", 4);
  if (bus      === true) total += pushBonus(items, "Bus proche", 2);

  const legacyTransport = readBool(draft, "transport");
  if (
    metro    !== true &&
    rerTrain !== true &&
    tram     !== true &&
    bus      !== true &&
    legacyTransport === true
  ) {
    total += pushBonus(items, "Transport proche", 3);
  }

  if (total > 10) {
    const overflow = total - 10;
    total -= overflow;
    items.push({ label: "Plafond desserte", value: -overflow });
  }

  return { total, items };
}

function computeExteriorScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const balcon   = readBool(draft, "balcon");
  const loggia   = readBool(draft, "loggia");
  const terrasse = readBool(draft, "terrasse");
  const jardin   = readBool(draft, "jardin");

  if (balcon   === true) total += pushBonus(items, "Balcon",   3);
  if (loggia   === true) total += pushBonus(items, "Loggia",   2);
  if (terrasse === true) total += pushBonus(items, "Terrasse", 6);
  if (jardin   === true) total += pushBonus(items, "Jardin",   7);

  if (total > 10) {
    const overflow = total - 10;
    total -= overflow;
    items.push({ label: "Plafond extérieurs", value: -overflow });
  }

  return { total, items };
}

function computeComfortScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const calme        = readBool(draft, "calme");
  const lumineux     = readBool(draft, "lumineux");
  const traversant   = readBool(draft, "traversant");
  const visAVisFaible = readBool(draft, "visAVisFaible");
  const vueDegagee   = readBool(draft, "vueDegagee");

  if (calme === true)        total += pushBonus(items, "Bien calme",        4);
  else if (calme === false)  total += pushBonus(items, "Bien bruyant",     -4);

  if (lumineux === true)       total += pushBonus(items, "Bien lumineux",          3);
  else if (lumineux === false) total += pushBonus(items, "Manque de luminosité",  -3);

  if (traversant === true) total += pushBonus(items, "Traversant", 3);

  if (visAVisFaible === true)        total += pushBonus(items, "Faible vis-à-vis", 2);
  else if (visAVisFaible === false)  total += pushBonus(items, "Vis-à-vis marqué", -3);

  if (vueDegagee === true) total += pushBonus(items, "Vue dégagée", 2);

  return { total, items };
}

function computeEquipmentScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const cave      = readBool(draft, "cave");
  const parking   = readBool(draft, "parking");
  const box       = readBool(draft, "box");
  const garage    = readBool(draft, "garage");
  const commerces = readBool(draft, "commerces");

  if (cave    === true) total += pushBonus(items, "Cave",    1);
  if (parking === true) total += pushBonus(items, "Parking", 3);
  if (box     === true) total += pushBonus(items, "Box",     4);
  if (garage  === true) total += pushBonus(items, "Garage",  4);

  if (commerces === true)        total += pushBonus(items, "Commerces proches",  3);
  else if (commerces === false)  total += pushBonus(items, "Commerces éloignés", -2);

  if (total > 8) {
    const overflow = total - 8;
    total -= overflow;
    items.push({ label: "Plafond équipements", value: -overflow });
  }

  return { total, items };
}

function computeEtageAscenseurScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const floorNum    = parseFloorNumber(readField(draft, "floor"));
  const hasAscenseur = readBool(draft, "ascenseur");
  const rdcSurRue   = readBool(draft, "rdcSurRue");

  if (floorNum >= 0) {
    if (floorNum === 0) {
      total += pushBonus(items, "RDC", -4);
      if (rdcSurRue === true) total += pushBonus(items, "RDC sur rue", -3);
    } else if (hasAscenseur === true) {
      if (floorNum <= 2)       total += pushBonus(items, `Étage ${floorNum} avec ascenseur`,           2);
      else if (floorNum <= 5)  total += pushBonus(items, `Étage ${floorNum} avec ascenseur`,           1);
      else if (floorNum >= 10) total += pushBonus(items, `Étage ${floorNum} avec ascenseur (élevé)`,  -2);
    } else if (hasAscenseur === false) {
      if (floorNum === 1)      total += pushBonus(items, "1er sans ascenseur",   0);
      else if (floorNum === 2) total += pushBonus(items, "2e sans ascenseur",   -2);
      else if (floorNum === 3) total += pushBonus(items, "3e sans ascenseur",   -6);
      else if (floorNum === 4) total += pushBonus(items, "4e sans ascenseur",  -12);
      else if (floorNum >= 5)  total += pushBonus(items, `Étage ${floorNum} sans ascenseur`, -20);
    } else {
      if (floorNum >= 4) total += pushBonus(items, `Étage ${floorNum} (ascenseur inconnu)`, -4);
    }
  }

  return { total, items };
}

function computeEtatEnergieScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const etat = String(readField(draft, "etatGeneral") || "").trim();
  const dpe  = String(readField(draft, "dpe") || "").trim().toUpperCase();

  if (etat) {
    const etatMap: Record<string, number> = {
      neuf:               10,
      bon:                 5,
      moyen:               0,
      a_renover:          -8,
      travaux_importants: -15,
    };
    const v = etatMap[etat] ?? 0;
    if (v !== 0) total += pushBonus(items, `État: ${etat}`, v);
  }

  if (dpe) {
    const dpeMap: Record<string, number> = {
      A:  8, B:  5, C:  3, D:  0, E: -3, F: -7, G: -12,
    };
    const v = dpeMap[dpe] ?? 0;
    if (v !== 0) total += pushBonus(items, `DPE ${dpe}`, v);
  }

  return { total, items };
}

function computeUsageScore(draft: any): { total: number; items: { label: string; value: number }[] } {
  const items: { label: string; value: number }[] = [];
  let total = 0;

  const nbPieces     = Number(readField(draft, "nbPieces")) || 0;
  const propertyType = String(readField(draft, "propertyType") || "").trim();

  if (nbPieces >= 4) total += pushBonus(items, `${nbPieces} pièces`, Math.min((nbPieces - 3) * 2, 6));
  if (propertyType === "maison") total += pushBonus(items, "Maison", 2);

  return { total, items };
}

function computeQualiteScore(draft: any): QualiteScoreResult {
  const base = 50;

  const transport  = computeTransportScore(draft);
  const exterior   = computeExteriorScore(draft);
  const comfort    = computeComfortScore(draft);
  const equipment  = computeEquipmentScore(draft);
  const etage      = computeEtageAscenseurScore(draft);
  const etatEnergie = computeEtatEnergieScore(draft);
  const usage      = computeUsageScore(draft);

  const bonusMalus = [
    ...transport.items,
    ...exterior.items,
    ...comfort.items,
    ...equipment.items,
    ...etage.items,
    ...etatEnergie.items,
    ...usage.items,
  ];

  const totalBonus =
    transport.total +
    exterior.total +
    comfort.total +
    equipment.total +
    etage.total +
    etatEnergie.total +
    usage.total;

  const rawScore = clamp(Math.round(base + totalBonus), 0, 100);

  const explanation =
    bonusMalus.length > 0
      ? `Qualité : ${bonusMalus
          .map((b) => `${b.label} (${b.value > 0 ? "+" : ""}${b.value})`)
          .join(", ")}`
      : "Qualité : aucun ajustement";

  return { rawScore, bonusMalus, explanation };
}

// ============================================
// LOCAL SMARTSCORE COMPUTATION (v2)
// ============================================

interface LocalSmartScoreResult {
  globalScore: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  verdict: "GO" | "GO_AVEC_RESERVES" | "NO_GO";
  globalRationale: string;
  rationale: string;
  details: {
    prixM2: number | null;
    bonusMalus: { label: string; value: number }[];
    dvf?: DvfResult | null;
    prixM2Score?: PrixM2ScoreResult;
    qualiteScore?: QualiteScoreResult;
  };
  minimumMet: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function gradeFromScore(s: number): "A" | "B" | "C" | "D" | "E" {
  if (s >= 80) return "A";
  if (s >= 65) return "B";
  if (s >= 50) return "C";
  if (s >= 35) return "D";
  return "E";
}

function verdictFromScore(s: number): "GO" | "GO_AVEC_RESERVES" | "NO_GO" {
  if (s >= 65) return "GO";
  if (s >= 40) return "GO_AVEC_RESERVES";
  return "NO_GO";
}

function computeSmartScoreFromDraft(draft: any): LocalSmartScoreResult {
  const price   = Number(draft.input?.price   || draft.price)   || 0;
  const surface = Number(draft.input?.surface || draft.surface) || 0;

  if (price <= 0 || surface <= 0) {
    return {
      globalScore: 0,
      score: 0,
      grade: "E",
      verdict: "NO_GO",
      globalRationale: MINIMUM_VIABLE_MSG,
      rationale: MINIMUM_VIABLE_MSG,
      details: { prixM2: null, bonusMalus: [] },
      minimumMet: false,
    };
  }

  const prixM2      = price / surface;
  const dvf: DvfResult | null = draft.dvf ?? null;
  const prixM2Score  = computePrixM2Score(price, surface, dvf);
  const qualiteScore = computeQualiteScore(draft);

  const propertyType = draft.input?.propertyType || draft.propertyType || "";
  const completudeFields = [
    price > 0,
    surface > 0,
    !!propertyType,
    !!(draft.input?.etatGeneral  || draft.etatGeneral),
    !!(draft.input?.dpe          || draft.dpe),
    !!(draft.input?.nbPieces     || draft.nbPieces),
    !!(draft.location?.codePostal),
    !!(draft.location?.rueProche),
  ];
  const completudeRaw = Math.round(
    (completudeFields.filter(Boolean).length / completudeFields.length) * 100,
  );

  const globalScore = clamp(
    Math.round(prixM2Score.rawScore * 0.4 + qualiteScore.rawScore * 0.35 + completudeRaw * 0.25),
    0,
    100,
  );
  const grade   = gradeFromScore(globalScore);
  const verdict = verdictFromScore(globalScore);

  const rationaleLines: string[] = [
    prixM2Score.explanation,
    qualiteScore.explanation,
    `Complétude : ${completudeRaw}%`,
    `Verdict : ${verdict.replace(/_/g, " ")}`,
  ];
  const rationale = rationaleLines.join(" · ");

  return {
    globalScore,
    score: globalScore,
    grade,
    verdict,
    globalRationale: rationale,
    rationale,
    details: { prixM2, bonusMalus: qualiteScore.bonusMalus, dvf, prixM2Score, qualiteScore },
    minimumMet: true,
  };
}

// ============================================
// ENRICHISSEMENT (v2)
// ============================================

function buildEnrichedScore(computed: LocalSmartScoreResult, draft: any, hookScore: any, history: number[]) {
  const price        = Number(draft?.input?.price   || draft?.price)   || 0;
  const surface      = Number(draft?.input?.surface || draft?.surface) || 0;
  const propertyType = draft?.input?.propertyType   || draft?.propertyType || "";

  if (!computed.minimumMet) {
    return {
      globalScore: 0,
      score: 0,
      grade: "E" as const,
      verdict: "NO_GO",
      globalRationale: MINIMUM_VIABLE_MSG,
      rationale: MINIMUM_VIABLE_MSG,
      explanations: [MINIMUM_VIABLE_MSG],
      missingData: [...(price <= 0 ? ["price"] : []), ...(surface <= 0 ? ["surface"] : [])],
      subscores: [
        { name: "prix",       label: "Prix/m²",    rawScore: 0, weight: 0.4,  hasData: false },
        { name: "qualite",    label: "Qualité",     rawScore: 0, weight: 0.35, hasData: false },
        { name: "completude", label: "Complétude",  rawScore: 0, weight: 0.25, hasData: false },
      ],
      penalties: [],
      blockers: [],
      engineVersion: "sourcing-local-v2",
      computedAt: new Date().toISOString(),
      inputHash: "local",
      scoreHistory: history.length > 0 ? history : [0],
      details: computed.details,
      minimumMet: false,
    };
  }

  const explanations: string[]  = [];
  const prixM2Score  = computed.details.prixM2Score;
  const qualiteScore = computed.details.qualiteScore;

  if (prixM2Score)
    explanations.push(prixM2Score.explanation);
  else if (computed.details.prixM2 != null)
    explanations.push(`Prix/m² estimé : ${Math.round(computed.details.prixM2).toLocaleString("fr-FR")} €/m²`);

  if (qualiteScore)
    explanations.push(qualiteScore.explanation);
  else if (computed.details.bonusMalus.length > 0)
    explanations.push(
      `Ajustements : ${computed.details.bonusMalus.map((b) => `${b.label} (${b.value > 0 ? "+" : ""}${b.value})`).join(", ")}`,
    );

  explanations.push(`Verdict : ${computed.verdict.replace(/_/g, " ")}`);

  const missingData: string[] = [];
  if (!propertyType) missingData.push("propertyType");
  if (!prixM2Score?.dvfAvailable) missingData.push("dvf");

  const hasPriceData    = price > 0 && surface > 0;
  const prixRawScore    = prixM2Score?.rawScore   ?? (hasPriceData ? 50 : 0);
  const qualiteRawScore = qualiteScore?.rawScore  ?? 50;

  const completudeFields = [
    price > 0,
    surface > 0,
    !!propertyType,
    !!(draft?.input?.etatGeneral || draft?.etatGeneral),
    !!(draft?.input?.dpe         || draft?.dpe),
    !!(draft?.input?.nbPieces    || draft?.nbPieces),
    !!(draft?.location?.codePostal),
    !!(draft?.location?.rueProche),
  ];
  const completudeRawScore = Math.round(
    (completudeFields.filter(Boolean).length / completudeFields.length) * 100,
  );

  return {
    ...((hookScore && typeof hookScore === "object") ? hookScore : {}),
    globalScore:     computed.globalScore,
    score:           computed.globalScore,
    grade:           computed.grade,
    verdict:         computed.verdict,
    globalRationale: computed.globalRationale,
    rationale:       computed.rationale,
    explanations,
    missingData,
    subscores: [
      { name: "prix",       label: "Prix/m²",    rawScore: prixRawScore,       weight: 0.4,  hasData: hasPriceData },
      { name: "qualite",    label: "Qualité",     rawScore: qualiteRawScore,    weight: 0.35, hasData: true },
      { name: "completude", label: "Complétude",  rawScore: completudeRawScore, weight: 0.25, hasData: true },
    ],
    penalties:     [],
    blockers:      [],
    engineVersion: "sourcing-local-v2",
    computedAt:    new Date().toISOString(),
    inputHash:     "local",
    scoreHistory:  history.length > 0 ? history : [computed.globalScore],
    details:       computed.details,
    minimumMet:    true,
  };
}

// ============================================
// RESOLVER
// ============================================

function resolveSmartScore(obj: any): { resolved: any | null; resolvedScore: number | null } {
  if (obj == null) return { resolved: null, resolvedScore: null };
  const ss = obj.smartScore ?? obj.smartscore ?? obj.smartScoreResult ?? null;
  if (ss == null) {
    const directScore = obj.globalScore ?? obj.score ?? null;
    if (typeof directScore === "number") return { resolved: obj, resolvedScore: directScore };
    return { resolved: null, resolvedScore: null };
  }
  if (typeof ss === "number") return { resolved: { score: ss, globalScore: ss }, resolvedScore: ss };
  if (typeof ss === "object") {
    const n = ss.globalScore ?? ss.score ?? null;
    return { resolved: ss, resolvedScore: typeof n === "number" ? n : null };
  }
  return { resolved: null, resolvedScore: null };
}

// ============================================
// META → FORM STATE SEED
// ============================================

function buildSeedFromMeta(meta: DealContextMeta | undefined): FormState | null {
  if (!meta) return null;
  const hasAnyData = meta.zipCode || meta.city || meta.address || meta.purchasePrice || meta.surface;
  if (!hasAnyData) return null;
  return {
    codePostal:    meta.zipCode ?? "",
    rueProche:     meta.address ?? "",
    ville:         meta.city ?? "",
    arrondissement: "",
    quartier:      "",
    propertyType:  "",
    price:         meta.purchasePrice != null && meta.purchasePrice > 0 ? String(meta.purchasePrice) : "",
    surface:       meta.surface != null && meta.surface > 0 ? String(meta.surface) : "",
    floor:         "",
  };
}

// ============================================
// SCOPED LS HYDRATION
// ============================================

interface HydrationBag {
  formState:    FormState | null;
  localScore:   LocalSmartScoreResult | null;
  lastDraft:    any;
  scoreHistory: number[];
}

const EMPTY_BAG: HydrationBag = { formState: null, localScore: null, lastDraft: null, scoreHistory: [] };

function hydrateFromScopedLS(dealId: string): HydrationBag {
  const key = smartscoreKey(dealId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_BAG;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return EMPTY_BAG;
    const bag: HydrationBag = { ...EMPTY_BAG };
    const c = saved.computed;
    if (c && typeof c === "object" && typeof c.globalScore === "number" && c.minimumMet === true)
      bag.localScore = c as LocalSmartScoreResult;
    const fs = saved.formState;
    if (fs && typeof fs === "object" && typeof fs.price === "string")
      bag.formState = fs as FormState;
    if (saved.lastDraft && typeof saved.lastDraft === "object")
      bag.lastDraft = saved.lastDraft;
    if (Array.isArray(saved.scoreHistory))
      bag.scoreHistory = saved.scoreHistory;
    return bag;
  } catch {
    return EMPTY_BAG;
  }
}

function writeSeedToAllLSKeys(dealId: string, formState: FormState): void {
  const payload = JSON.stringify({
    formState,
    savedAt: new Date().toISOString(),
    source: { type: "investisseur.activeDeal", dealId },
  });
  try {
    const scopedKey = smartscoreKey(dealId);
    if (!localStorage.getItem(scopedKey)) localStorage.setItem(scopedKey, payload);
    for (const legacyKey of LEGACY_LS_KEYS) {
      try { localStorage.setItem(legacyKey, payload); } catch { /* quota */ }
    }
  } catch { /* quota */ }
}

function resolveForDeal(dealId: string): { formState: FormState | null; bag: HydrationBag } {
  const bag = hydrateFromScopedLS(dealId);
  if (bag.formState) {
    writeSeedToAllLSKeys(dealId, bag.formState);
    return { formState: bag.formState, bag };
  }
  const meta = getDealContextMeta();
  const seed = buildSeedFromMeta(meta);
  if (seed) {
    writeSeedToAllLSKeys(dealId, seed);
    return { formState: seed, bag };
  }
  for (const legacyKey of LEGACY_LS_KEYS) {
    try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
  }
  return { formState: null, bag };
}

function hydrateCommonFieldsFromDeal(
  deal: DealContextMeta | undefined | null,
  activeDealId: string | null,
): FormState | null {
  if (!deal || !activeDealId) return null;
  const cur     = safeParse(localStorage.getItem(SOURCING_KEY));
  const form: Record<string, string> = cur.formState || {};
  const srcDealId = cur?.source?.dealId || null;
  const hasUserEdits =
    !!form.codePostal || !!form.ville || !!form.rueProche || !!form.price || !!form.surface;
  const shouldHydrate =
    !hasUserEdits || (activeDealId && srcDealId && activeDealId !== srcDealId);
  if (!shouldHydrate) return null;

  const nextForm: FormState = {
    ...EMPTY_FORM,
    ...(form as any),
    codePostal: String(deal.zipCode  ?? ""),
    rueProche:  String(deal.address  ?? ""),
    ville:      String(deal.city     ?? ""),
    price:      deal.purchasePrice != null ? String(deal.purchasePrice) : "",
    surface:    deal.surface != null ? String(deal.surface) : "",
  };

  const next = {
    ...cur,
    formState: nextForm,
    savedAt: new Date().toISOString(),
    source: { type: "investisseur.activeDeal", dealId: activeDealId },
  };
  try {
    localStorage.setItem(SOURCING_KEY, JSON.stringify(next));
    writeSeedToAllLSKeys(activeDealId, nextForm);
  } catch { /* quota */ }
  return nextForm;
}

// ============================================
// INLINE CSS INJECTOR
// ============================================

const injectStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById("scoring-home-styles")) return;
  const style = document.createElement("style");
  style.id = "scoring-home-styles";
  style.textContent = `
    @keyframes slideIn  { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0);    opacity: 1; } }
    @keyframes spin     { to   { transform: rotate(360deg); } }
    @keyframes fadeIn   { from { opacity: 0; transform: translateY(8px); }  to { opacity: 1; transform: translateY(0); } }
    @keyframes ringDraw { from { stroke-dashoffset: var(--ring-circ); } }
    @keyframes submitPulse {
      0%   { box-shadow: 0 0 0 0 rgba(14,165,233,0.5); transform: scale(1); }
      40%  { box-shadow: 0 0 0 12px rgba(14,165,233,0); transform: scale(1.01); }
      100% { box-shadow: 0 0 0 0  rgba(14,165,233,0);  transform: scale(1); }
    }
    @keyframes flashOverlay {
      0%   { opacity: 0; }
      20%  { opacity: 1; }
      80%  { opacity: 1; }
      100% { opacity: 0; }
    }
    .scoring-deal-row { transition: all 0.15s ease; }
    .scoring-deal-row:hover { background: rgba(14,165,233,0.06) !important; }
    .submit-flash-overlay {
      animation: flashOverlay 0.9s ease forwards;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
};

// ============================================
// SUB-COMPONENTS
// ============================================

const ScoreRing: React.FC<{ score: number; grade: string; size?: number }> = ({
  score,
  grade,
  size = 130,
}) => {
  const r      = (size - 14) / 2;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color  = gradeColor(grade);
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fill="#1e293b" fontSize={size * 0.28} fontWeight="800">
        {score}
      </text>
      <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fill="#94a3b8" fontSize={size * 0.11}>
        /100
      </text>
    </svg>
  );
};

const AxisBar: React.FC<{ label: string; value: number; weight: number }> = ({
  label,
  value,
  weight,
}) => {
  const barColor = value >= 65 ? "#22c55e" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ width: 80, color: "#64748b", flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: "#f1f5f9", overflow: "hidden" }}>
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            borderRadius: 4,
            background: barColor,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <span style={{ color: "#94a3b8", fontSize: 11, width: 70, textAlign: "right" }}>
        {value}/100 · ×{weight}%
      </span>
    </div>
  );
};

const SmartScoreHero: React.FC<{
  score: LocalSmartScoreResult;
  formState: FormState;
  enriched: any;
}> = ({ score, formState, enriched }) => {
  const gc         = gradeColor(score.grade);
  const vc         = verdictColor(score.verdict);
  const prixM2Score  = score.details.prixM2Score;
  const qualiteScore = score.details.qualiteScore;
  const subscores  = enriched?.subscores  ?? [];
  const missingData = enriched?.missingData ?? [];

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        padding: "28px 32px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)",
        border: "1px solid #e2e8f0",
        marginBottom: 24,
        display: "flex",
        gap: 32,
        alignItems: "flex-start",
        flexWrap: "wrap",
        animation: "fadeIn 0.4s ease",
      }}
    >
      <div style={{ flexShrink: 0, textAlign: "center", position: "relative" }}>
        <ScoreRing score={score.globalScore} grade={score.grade} size={140} />
        <div
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 14px",
            borderRadius: 20,
            background: gc + "18",
            border: `1px solid ${gc}33`,
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 13, color: gc }}>Grade {score.grade}</span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 260 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 2,
            color: "#94a3b8",
            marginBottom: 4,
          }}
        >
          SmartScore Mimmoza
        </div>
        <h2 style={{ margin: "0 0 2px", fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
          {formState.rueProche || "Bien à analyser"}
        </h2>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
          {[formState.ville, formState.codePostal].filter(Boolean).join(" · ")}
          {formState.price   ? ` · ${formatPrice(parseNumberFR(formState.price))}`     : ""}
          {formState.surface ? ` · ${formatSurface(parseNumberFR(formState.surface))}` : ""}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 14px",
            borderRadius: 10,
            background: vc + "14",
            border: `1px solid ${vc}30`,
            marginBottom: 18,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: vc }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: vc }}>{verdictLabel(score.verdict)}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subscores.length > 0 ? (
            subscores.map((s: any) => (
              <AxisBar key={s.name} label={s.label} value={s.rawScore} weight={Math.round(s.weight * 100)} />
            ))
          ) : (
            <>
              <AxisBar label="Prix/m²"   value={prixM2Score?.rawScore  ?? 50} weight={40} />
              <AxisBar label="Qualité"   value={qualiteScore?.rawScore ?? 50} weight={30} />
              <AxisBar label="Complétude" value={50}                          weight={30} />
            </>
          )}
        </div>
      </div>

      <div
        style={{
          width: 220,
          flexShrink: 0,
          background: "#f8fafc",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #e2e8f0",
        }}
      >
        {missingData.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1.5,
                color: "#94a3b8",
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              Données manquantes
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
              {missingData.map((d: string) => (
                <span
                  key={d}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: "#fef3c7",
                    color: "#d97706",
                    fontWeight: 500,
                  }}
                >
                  {d}
                </span>
              ))}
            </div>
          </>
        )}
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: "#94a3b8",
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Explication
        </div>
        <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
          {[prixM2Score?.explanation, qualiteScore?.explanation].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
};

const DealRow: React.FC<{
  dealId: string;
  formState: FormState;
  score: LocalSmartScoreResult | null;
  isActive: boolean;
  onClick: () => void;
}> = ({ dealId, formState, score, isActive, onClick }) => {
  const gc           = score?.minimumMet ? gradeColor(score.grade) : "#cbd5e1";
  const displayScore = score?.minimumMet ? score.globalScore : "—";
  const vc           = score?.minimumMet ? verdictColor(score.verdict) : "#cbd5e1";

  return (
    <button
      className="scoring-deal-row"
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        width: "100%",
        boxSizing: "border-box",
        padding: "12px 14px",
        background: isActive ? "rgba(14,165,233,0.06)" : "transparent",
        borderLeft: isActive ? `3px solid ${ACCENT}` : "3px solid transparent",
        borderBottom: "1px solid #f1f5f9",
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          flexShrink: 0,
          border: `3px solid ${gc}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 12,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 800, color: gc }}>{displayScore}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: "#1e293b",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formState.rueProche || `Deal ${dealId.slice(0, 6)}…`}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
          {[formState.ville, formState.codePostal].filter(Boolean).join(" · ") || "Non renseigné"}
        </div>
      </div>

      {score?.minimumMet && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 6,
            background: vc + "18",
            color: vc,
            marginLeft: 8,
            flexShrink: 0,
          }}
        >
          {verdictLabel(score.verdict)}
        </span>
      )}
    </button>
  );
};

const SummaryPanel: React.FC<{ form: FormState }> = ({ form }) => {
  const price       = parseNumberFR(form.price);
  const surface     = parseNumberFR(form.surface);
  const pricePerSqm = calculatePricePerSqm(price, surface);
  const hasLocation  = !!(form.codePostal && form.rueProche);
  const hasBasicInfo = !!(form.propertyType && form.price && form.surface);
  const isValid      = hasLocation && hasBasicInfo;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 18,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        border: "1px solid #e2e8f0",
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#1e293b",
          margin: "0 0 14px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        📋 Résumé
      </h3>

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 6,
          }}
        >
          LOCALISATION
        </div>
        {[
          ["Code postal", form.codePostal],
          ["Rue proche",  form.rueProche],
          ...(form.ville ? [["Ville", form.ville]] : []),
        ].map(([label, val]) => (
          <div
            key={label as string}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 13,
              borderBottom: "1px solid #f8fafc",
            }}
          >
            <span style={{ color: "#64748b" }}>{label}</span>
            <span style={{ color: val ? "#1e293b" : "#cbd5e1", fontWeight: val ? 500 : 400 }}>
              {(val as string) || "—"}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 6,
          }}
        >
          BIEN
        </div>
        {[
          ["Type",   form.propertyType ? getPropertyTypeLabel(form.propertyType as PropertyType) : ""],
          ["Prix",   price   > 0 ? formatPrice(price)     : ""],
          ["Surface", surface > 0 ? formatSurface(surface) : ""],
          ["Étage",  form.floor ? formatFloor(parseFloor(form.floor)) : ""],
        ].map(([label, val]) => (
          <div
            key={label as string}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 13,
              borderBottom: "1px solid #f8fafc",
            }}
          >
            <span style={{ color: "#64748b" }}>{label}</span>
            <span style={{ color: val ? "#1e293b" : "#cbd5e1", fontWeight: val ? 500 : 400 }}>
              {(val as string) || "—"}
            </span>
          </div>
        ))}
      </div>

      {pricePerSqm ? (
        <div
          style={{
            background: "#f0f9ff",
            padding: 10,
            borderRadius: 8,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: ACCENT_DARK }}>{formatPrice(pricePerSqm)}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>prix au m²</div>
        </div>
      ) : null}

      <div
        style={{
          padding: 10,
          borderRadius: 8,
          background: isValid ? "#ecfdf5" : "#fffbeb",
          border: isValid ? "1px solid #a7f3d0" : "1px solid #fde68a",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            color: isValid ? "#065f46" : "#92400e",
            marginBottom: 2,
          }}
        >
          VALIDATION
        </div>
        <p style={{ fontSize: 13, color: isValid ? "#047857" : "#b45309", margin: 0 }}>
          {isValid ? "✓ Prêt à analyser" : "Remplir les champs obligatoires"}
        </p>
      </div>
    </div>
  );
};

interface ToastProps {
  type: "success" | "error";
  title: string;
  message?: string;
  onClose: () => void;
}
const Toast: React.FC<ToastProps> = ({ type, title, message, onClose }) => (
  <div
    style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 1000,
      background: type === "success" ? "#10b981" : "#ef4444",
      color: "#fff",
      padding: "14px 20px",
      borderRadius: 12,
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      display: "flex",
      alignItems: "center",
      gap: 10,
      maxWidth: 400,
      animation: "slideIn 0.3s ease-out",
    }}
  >
    <span style={{ fontSize: 18, flexShrink: 0 }}>{type === "success" ? "✓" : "✕"}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      {message && (
        <div
          style={{
            fontSize: 12,
            opacity: 0.9,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {message}
        </div>
      )}
    </div>
    <button onClick={onClose} style={{ all: "unset", cursor: "pointer", opacity: 0.8, fontSize: 16 }}>
      ×
    </button>
  </div>
);

const SmartScorePlaceholder: React.FC = () => (
  <div
    style={{
      background: "#fff",
      borderRadius: 16,
      padding: "40px 28px",
      textAlign: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      border: "1px solid #e2e8f0",
      marginBottom: 24,
    }}
  >
    <div
      style={{
        width: 72,
        height: 72,
        margin: "0 auto 16px",
        borderRadius: "50%",
        background: "linear-gradient(135deg, #e0f2fe 0%, #fef3c7 50%, #ecfdf5 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
        <rect x="6"  y="14" width="6" height="12" rx="1" fill="#22c55e" />
        <rect x="13" y="8"  width="6" height="18" rx="1" fill="#f59e0b" />
        <rect x="20" y="4"  width="6" height="22" rx="1" fill={ACCENT}  />
      </svg>
    </div>
    <div style={{ fontSize: 18, fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>SmartScore</div>
    <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
      Remplissez le formulaire et cliquez sur « Enregistrer » pour calculer le score.
    </p>
  </div>
);

const NoDealPlaceholder: React.FC = () => (
  <div
    style={{
      background: "#fffbeb",
      border: "1px solid #fde68a",
      borderRadius: 16,
      padding: "48px 24px",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: 20, fontWeight: 600, color: "#92400e", marginBottom: 8 }}>Aucun deal actif</div>
    <p style={{ fontSize: 14, color: "#b45309", lineHeight: 1.6 }}>
      Sélectionnez un deal dans le Pipeline pour commencer le scoring.
    </p>
  </div>
);

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

interface SourcingHomePageProps {
  profileTarget?: ProfileTarget;
}

export const SourcingHomePage: React.FC<SourcingHomePageProps> = ({
  profileTarget = "mdb",
}) => {
  const [dealId, setDealId] = useState<string | null>(() => getActiveDealId());
  const [dealMeta, setDealMeta] = useState<DealContextMeta | undefined>(() => {
    const snap = getDealContextSnapshot();
    return snap.meta;
  });

  useEffect(() => {
    const unsub = subscribeDealContext((ctx) => {
      setDealId(ctx.activeDealId);
      setDealMeta(ctx.meta);
    });
    return unsub;
  }, []);

  const resolved = useMemo(() => {
    if (!dealId) return { formState: null as FormState | null, bag: EMPTY_BAG };
    return resolveForDeal(dealId);
  }, [dealId]);

  const [toast, setToast] = useState<{
    show: boolean;
    type: "success" | "error";
    title: string;
    message?: string;
  } | null>(null);
  const [formState,    setFormState]    = useState<FormState>(resolved.formState ?? EMPTY_FORM);
  const [localScore,   setLocalScore]   = useState<LocalSmartScoreResult | null>(resolved.bag.localScore);
  const [isComputing,  setIsComputing]  = useState(false);
  const [submitFlash,  setSubmitFlash]  = useState(false);
  const [lastDraft,    setLastDraft]    = useState<any>(resolved.bag.lastDraft);
  const [scoreHistory, setScoreHistory] = useState<number[]>(resolved.bag.scoreHistory);

  const mountGuardRef = useRef(!!resolved.formState);

  const { isLoading, score, hints, errors, analyzeAndComputeScore } = useSmartScore();

  const prevDealIdRef = useRef<string | null>(dealId);
  useEffect(() => {
    if (dealId === prevDealIdRef.current) return;
    prevDealIdRef.current = dealId;
    setFormState(resolved.formState ?? EMPTY_FORM);
    setLocalScore(resolved.bag.localScore);
    setLastDraft(resolved.bag.lastDraft);
    setScoreHistory(resolved.bag.scoreHistory);
    mountGuardRef.current = !!resolved.formState;
  }, [dealId, resolved]);

  useEffect(() => {
    if (!dealId) return;
    const meta     = dealMeta ?? getDealContextMeta();
    const hydrated = hydrateCommonFieldsFromDeal(meta, dealId);
    if (hydrated) {
      setFormState(hydrated);
      mountGuardRef.current = true;
    }
  }, [dealId, dealMeta]);

  useEffect(() => { injectStyles(); }, []);

  useEffect(() => {
    if (toast?.show) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if ((errors?.length || 0) > 0) {
      setToast({ show: true, type: "error", title: "Erreur de scoring", message: errors[0] });
    }
  }, [errors]);

  const handleFormChange = useCallback((form: FormState) => {
    if (mountGuardRef.current) {
      const isEmptyForm = !form.price && !form.surface && !form.codePostal;
      if (isEmptyForm) return;
      mountGuardRef.current = false;
    }
    setFormState(form);
  }, []);

  const handleSubmit = useCallback(
    async (draft: SourcingItemDraft) => {
      const currentDealId = getActiveDealId();
      if (!currentDealId) {
        setToast({
          show: true,
          type: "error",
          title: "Aucun deal actif",
          message: "Sélectionnez un deal dans le Pipeline avant d'enregistrer.",
        });
        return;
      }

      setIsComputing(true);
      setSubmitFlash(true);
      setTimeout(() => setSubmitFlash(false), 900);

      // ── Pré-géocodage au niveau handleSubmit ──
      // On géocode ici pour avoir lat/lng dispo dans les logs de submit
      // ET pour les passer directement à fetchDvfEstimate (évite un double appel BAN).
      let submitLat: number | undefined;
      let submitLng: number | undefined;
      try {
        const preGeo = await geocodeAddressViaBan({
          rue:        draft.location?.rueProche  || "",
          codePostal: draft.location?.codePostal || "",
          ville:      draft.location?.ville      || "",
        });
        if (preGeo) {
          submitLat = preGeo.lat;
          submitLng = preGeo.lon;
          console.log("[handleSubmit] ✅ Géocodage pré-DVF réussi:", preGeo);
        } else {
          console.warn("[handleSubmit] ⚠ Géocodage pré-DVF échoué — fetchDvfEstimate tentera en interne");
        }
      } catch (preGeoErr) {
        console.warn("[handleSubmit] Exception géocodage pré-DVF:", preGeoErr);
      }

      let dvfResult: DvfResult = DVF_FALLBACK;
      try {
        const dvfParams = {
          codePostal:   draft.location?.codePostal || "",
          rueProche:    draft.location?.rueProche  || "",
          ville:        draft.location?.ville      || "",
          propertyType: draft.propertyType || "appartement",
          surface:      parseNumberFR(draft.surface),
          lat:          submitLat,
          lng:          submitLng,
        };
        console.log("[handleSubmit] dvfParams envoyés à fetchDvfEstimate:", dvfParams);
        const res = await fetchDvfEstimate(dvfParams);
        if (res && typeof res === "object") {
          dvfResult = {
            price_m2_median:   res.price_m2_median ?? null,
            comparables_count: typeof res.comparables_count === "number" ? res.comparables_count : 0,
          };
        }
        console.log("[handleSubmit] DVF result final:", dvfResult);
      } catch (err) {
        console.warn("[handleSubmit] DVF erreur (fallback neutre):", err);
      }

      const apiDraft: any = {
        profileTarget: draft.profileTarget,
        location: {
          codePostal: draft.location?.codePostal || "",
          rueProche:  draft.location?.rueProche  || "",
          ville:      draft.location?.ville      || "",
        },
        input: {
          price:        parseNumberFR(draft.price),
          surface:      parseNumberFR(draft.surface),
          propertyType: draft.propertyType || "appartement",
          floor:        draft.floor || "1",

          nbPieces:    draft.nbPieces,
          etatGeneral: draft.etatGeneral,
          dpe:         draft.dpe,

          ascenseur: draft.ascenseur,
          balcon:    draft.balcon,
          terrasse:  draft.terrasse,
          cave:      draft.cave,
          parking:   draft.parking,
          jardin:    draft.jardin,
          garage:    draft.garage,
          commerces: (draft as any).commerces,
          transport: (draft as any).transport,

          bus:      (draft as any).bus,
          tram:     (draft as any).tram,
          metro:    (draft as any).metro,
          rerTrain: (draft as any).rerTrain,

          loggia:        (draft as any).loggia,
          calme:         (draft as any).calme,
          lumineux:      (draft as any).lumineux,
          traversant:    (draft as any).traversant,
          visAVisFaible: (draft as any).visAVisFaible,
          vueDegagee:    (draft as any).vueDegagee,
          rdcSurRue:     (draft as any).rdcSurRue,

          box: (draft as any).box,
        },
        quartier: draft.quartier || {},
        dvf:      dvfResult,
      };

      const computed = computeSmartScoreFromDraft(apiDraft);

      console.log("[SMARTSCORE][QUALITE_V3]", {
        apiDraft,
        qualiteScore: computed.details.qualiteScore,
        bonusMalus:   computed.details.bonusMalus,
        globalScore:  computed.globalScore,
      });

      const smartScoreObj = {
        score:           computed.globalScore,
        globalScore:     computed.globalScore,
        grade:           computed.grade,
        verdict:         computed.verdict,
        globalRationale: computed.globalRationale,
        rationale:       computed.rationale,
      };
      (draft as any).smartScore       = smartScoreObj;
      (draft as any).smartscore       = smartScoreObj;
      (draft as any).smartScoreResult = smartScoreObj;

      const newHistory = [...scoreHistory, computed.globalScore];
      setLocalScore(computed);
      setLastDraft(apiDraft);
      setScoreHistory(newHistory);
      setIsComputing(false);

      const savedFormState: FormState = {
        codePostal:    draft.location?.codePostal    || "",
        rueProche:     draft.location?.rueProche     || "",
        ville:         draft.location?.ville         || "",
        arrondissement: draft.location?.arrondissement || "",
        quartier:      typeof draft.quartier === "string" ? draft.quartier : draft.quartier?.nom || "",
        propertyType:  draft.propertyType || "",
        price:         String(draft.price   || ""),
        surface:       String(draft.surface || ""),
        floor:         String(draft.floor   || ""),
      };
      setFormState(savedFormState);

      const key     = smartscoreKey(currentDealId);
      const payload = {
        computed,
        formState:    savedFormState,
        lastDraft:    apiDraft,
        scoreHistory: newHistory,
        savedAt:      new Date().toISOString(),
        source: { type: "investisseur.activeDeal", dealId: currentDealId },
      };
      if (computed.minimumMet) {
        try {
          const json = JSON.stringify(payload);
          localStorage.setItem(key, json);
          for (const lk of LEGACY_LS_KEYS) {
            try { localStorage.setItem(lk, json); } catch { /* quota */ }
          }
        } catch { /* quota */ }
      } else {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      }

      if (computed.minimumMet) {
        try { await analyzeAndComputeScore(apiDraft, false); } catch { /* silent */ }
      }

      if (computed.minimumMet) {
        setToast({
          show: true,
          type: "success",
          title:   `SmartScore: ${computed.globalScore}/100 (${computed.grade})`,
          message: computed.globalRationale,
        });
      } else {
        setToast({
          show: true,
          type: "error",
          title:   "Données insuffisantes",
          message: MINIMUM_VIABLE_MSG,
        });
      }
    },
    [analyzeAndComputeScore, scoreHistory],
  );

  const Banner = (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "20px 24px 0" }}>

      {/* ── Bannière titre ── */}
      <div
        style={{
          background: GRAD_BANNER,
          borderRadius: 14,
          padding: "22px 28px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 4, letterSpacing: 1 }}>
            Investisseur › Acquisition
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "white", marginBottom: 2 }}>
            🎯 SmartScore
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            Qualifiez et scorez vos opportunités immobilières en quelques secondes
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {[
            { icon: "📊", label: "Prix/m²", sub: "vs marché DVF" },
            { icon: "✨", label: "Qualité",  sub: "30+ critères" },
            { icon: "📋", label: "Complétude", sub: "dossier complet" },
          ].map((pill) => (
            <div
              key={pill.label}
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "8px 16px",
                textAlign: "center",
                minWidth: 90,
              }}
            >
              <div style={{ fontSize: 18 }}>{pill.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginTop: 2 }}>{pill.label}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)" }}>{pill.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bloc d'explication SmartScore ── */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          padding: "20px 28px",
          marginBottom: 20,
          display: "flex",
          gap: 32,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* Intro */}
        <div style={{ flex: 2, minWidth: 260 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: 1.5,
              marginBottom: 8,
            }}
          >
            Qu'est-ce que le SmartScore ?
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.7 }}>
            Le <strong>SmartScore Mimmoza</strong> est une note sur 100 qui évalue instantanément
            la qualité d'une opportunité immobilière. Il combine le{" "}
            <strong>positionnement prix</strong> par rapport au marché local (données DVF),
            la <strong>qualité intrinsèque du bien</strong> (étage, extérieurs, luminosité, transports…)
            et la <strong>complétude du dossier</strong>. Plus le score est élevé, meilleure est l'opportunité.
          </p>
        </div>

        {/* Séparateur vertical */}
        <div style={{ width: 1, background: "#e2e8f0", alignSelf: "stretch", flexShrink: 0 }} />

        {/* Les 3 axes */}
        <div style={{ flex: 3, minWidth: 320 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: 1.5,
              marginBottom: 10,
            }}
          >
            Les 3 axes de notation
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              {
                pct: "40%",
                color: ACCENT,
                label: "Prix / m²",
                desc: "Comparaison du prix demandé avec la médiane des transactions DVF dans un rayon de 3 km. Une décote de 20 % rapporte un score de 88/100.",
              },
              {
                pct: "35%",
                color: "#8b5cf6",
                label: "Qualité du bien",
                desc: "Évaluation de 30+ critères : étage, ascenseur, extérieurs (balcon, terrasse, jardin), luminosité, transports (métro, RER…), DPE, état général, équipements (parking, box…).",
              },
              {
                pct: "25%",
                color: "#10b981",
                label: "Complétude du dossier",
                desc: "Mesure la richesse des informations saisies. Plus vous renseignez de champs, plus le score est précis et fiable.",
              },
            ].map((ax) => (
              <div key={ax.label} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div
                  style={{
                    flexShrink: 0,
                    marginTop: 2,
                    background: ax.color + "18",
                    border: `1px solid ${ax.color}33`,
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 800,
                    color: ax.color,
                    whiteSpace: "nowrap",
                  }}
                >
                  ×{ax.pct}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 2 }}>
                    {ax.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{ax.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Séparateur vertical */}
        <div style={{ width: 1, background: "#e2e8f0", alignSelf: "stretch", flexShrink: 0 }} />

        {/* Grille grades */}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: 1.5,
              marginBottom: 10,
            }}
          >
            Grille de lecture
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { grade: "A", range: "80–100", verdict: "GO",              vc: "#22c55e" },
              { grade: "B", range: "65–79",  verdict: "GO",              vc: "#3b82f6" },
              { grade: "C", range: "50–64",  verdict: "GO avec réserves", vc: "#f59e0b" },
              { grade: "D", range: "35–49",  verdict: "NO GO",           vc: "#ef4444" },
              { grade: "E", range: "0–34",   verdict: "NO GO",           vc: "#991b1b" },
            ].map((g) => (
              <div
                key={g.grade}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: 8,
                  background: g.vc + "0d",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: g.vc,
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {g.grade}
                </span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>{g.range} pts</div>
                  <div style={{ fontSize: 10, color: g.vc, fontWeight: 700 }}>{g.verdict}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );

  if (!dealId) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
        {Banner}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px" }}>
          <NoDealPlaceholder />
        </div>
      </div>
    );
  }

  const priceNum   = parseNumberFR(formState.price);
  const surfaceNum = parseNumberFR(formState.surface);
  const hasMinimum = priceNum > 0 && surfaceNum > 0;

  const localResolved =
    localScore != null && localScore.minimumMet
      ? { resolved: localScore, resolvedScore: localScore.globalScore }
      : { resolved: null as any, resolvedScore: null as number | null };

  const hookResolved =
    hasMinimum && score != null
      ? resolveSmartScore(score)
      : { resolved: null, resolvedScore: null };

  const resolvedSS    = localResolved.resolved   ?? hookResolved.resolved   ?? null;
  const resolvedScore = localResolved.resolvedScore ?? hookResolved.resolvedScore ?? null;

  const effectiveScore =
    localScore != null && localScore.minimumMet
      ? buildEnrichedScore(localScore, lastDraft, score, scoreHistory)
      : hasMinimum && resolvedScore != null
        ? {
            ...((score && typeof score === "object") ? score : {}),
            globalScore:     resolvedScore,
            score:           resolvedScore,
            grade:           resolvedSS?.grade   ?? gradeFromScore(resolvedScore),
            verdict:         resolvedSS?.verdict ?? verdictFromScore(resolvedScore),
            globalRationale: resolvedSS?.globalRationale ?? resolvedSS?.rationale ?? "",
            rationale:       resolvedSS?.rationale ?? resolvedSS?.globalRationale ?? "",
            explanations:    [],
            missingData:     [],
            subscores:       [],
            penalties:       [],
            blockers:        [],
            engineVersion:   "sourcing-local-v2",
            computedAt:      new Date().toISOString(),
            inputHash:       "hook",
            scoreHistory:    [resolvedScore],
          }
        : null;

  const effectiveLoading       = isComputing || isLoading;
  const sourcingInitialFormValues = resolved.formState ?? undefined;
  const hasScore               = resolvedScore != null && localScore != null && localScore.minimumMet;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {Banner}

      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "0 24px 40px" }}>
        {effectiveLoading ? (
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "48px 24px",
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid #e2e8f0",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                border: "4px solid #e2e8f0",
                borderTopColor: ACCENT,
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1e293b", marginBottom: 4 }}>
              Analyse en cours...
            </div>
            <div style={{ fontSize: 14, color: "#64748b" }}>
              Géocodage, DVF et calcul du SmartScore
            </div>
          </div>
        ) : hasScore && effectiveScore ? (
          <SmartScoreHero score={localScore!} formState={formState} enriched={effectiveScore} />
        ) : (
          <SmartScorePlaceholder />
        )}

        <div style={{ display: "flex", gap: 24 }}>
          {/* ── Colonne gauche : liste deals ── */}
          <div
            style={{
              width: 300,
              flexShrink: 0,
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid #e2e8f0",
              alignSelf: "flex-start",
              position: "sticky",
              top: 24,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>Mes opportunités</span>
            </div>

            <DealRow
              dealId={dealId}
              formState={formState}
              score={localScore}
              isActive={true}
              onClick={() => {}}
            />

            <div style={{ padding: "16px", textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
                Sélectionnez un deal dans le Pipeline pour l'afficher ici.
              </p>
            </div>
          </div>

          {/* ── Colonne centrale : formulaire ── */}
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>

            {/* Flash visuel immédiat au clic sur Analyser */}
            {submitFlash && (
              <div
                className="submit-flash-overlay"
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  borderRadius: 14,
                  background: "linear-gradient(135deg, rgba(14,165,233,0.08) 0%, rgba(99,102,241,0.08) 100%)",
                  border: "2px solid rgba(14,165,233,0.4)",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: 24,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: ACCENT,
                    color: "#fff",
                    borderRadius: 30,
                    padding: "8px 20px",
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow: "0 4px 20px rgba(14,165,233,0.35)",
                    animation: "submitPulse 0.9s ease",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 4.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Analyse en cours…
                </div>
              </div>
            )}

            <SourcingForm
              key={dealId}
              profileTarget={profileTarget}
              onSubmit={handleSubmit}
              onFormChange={handleFormChange}
              initialFormValues={sourcingInitialFormValues}
            />
          </div>

          {/* ── Colonne droite : SmartScorePanel + résumé ── */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              position: "sticky",
              top: 24,
              alignSelf: "flex-start",
            }}
          >
            {resolvedScore != null && effectiveScore != null ? (
              <SmartScorePanel score={effectiveScore} hints={hints} compact />
            ) : null}
            <div style={{ marginTop: effectiveScore ? 16 : 0 }}>
              <SummaryPanel form={formState} />
            </div>
          </div>
        </div>
      </div>

      {toast?.show && (
        <Toast
          type={toast.type}
          title={toast.title}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default SourcingHomePage;