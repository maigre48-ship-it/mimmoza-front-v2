/**
 * sitadelPredictive.service.ts  — v1.6
 *
 * Cascade :
 *   1. Edge Function  sitadel-v1  (proxy Deno → tabular API, pas de CORS)
 *   2. Tabular API    direct browser (souvent 400, gardé pour debug)
 *   3. Supabase RPC   get_sitadel_commune
 *   4. Synthétique    depuis mrSpecific  ← fallback garanti
 */

import { supabase } from "../../../../lib/supabaseClient";

// ── Types ─────────────────────────────────────────────────────────────

export interface PredictiveSitadelResult {
  available: boolean;
  score?: number;
  permisCount?: number;
  logementsAutorises?: number;
  surfaceTotale?: number;
  detail?: string;
  source?: string;
}

export interface SitadelInput {
  city?:       string;
  zipCode?:    string;
  lat?:        number;
  lon?:        number;
  codeInsee?:  string;
  mrSpecific?: Record<string, unknown> | null;
}

// ── Constants ─────────────────────────────────────────────────────────

const GEO_API_BASE     = "https://geo.api.gouv.fr";
const TABULAR_API_BASE = "https://tabular-api.data.gouv.fr/api/resources";
const TABULAR_RESOURCE = "79c41b99-be89-485c-bf74-170c03111252";

const _cache = new Map<string, PredictiveSitadelResult>();

// ── Helpers ───────────────────────────────────────────────────────────

function safeN(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function calcSitadelScore(logements: number, surface: number, rayonKm = 10): number {
  const area = Math.PI * rayonKm * rayonKm;
  const raw  = (logements / area) * 2.2 + (surface / area) / 2500;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── Résolution INSEE ──────────────────────────────────────────────────

async function resolveCodeInsee(input: SitadelInput): Promise<string | null> {
  if (input.codeInsee && /^\d{5}$/.test(input.codeInsee)) return input.codeInsee;
  if (!input.zipCode) return null;
  try {
    const sp = new URLSearchParams({ fields: "code,nom", limit: "1" });
    sp.set("codePostal", input.zipCode);
    if (input.city) sp.set("nom", input.city);
    const resp = await fetch(`${GEO_API_BASE}/communes?${sp}`, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) && data.length > 0 ? String(data[0].code) : null;
  } catch { return null; }
}

// ── Résolution EPCI ───────────────────────────────────────────────────

async function resolveEpci(codeInsee: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `${GEO_API_BASE}/communes/${codeInsee}?fields=codeEpci,nom`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const epci = data?.codeEpci;
    if (typeof epci === "string" && epci.length > 0) {
      if (import.meta.env.DEV) {
        console.log(`[PREDICTIVE SITADEL] ${codeInsee} → EPCI ${epci} (${data.nom ?? ""})`);
      }
      return epci;
    }
    return null;
  } catch { return null; }
}

// ── Tentative 1 : Edge Function sitadel-v1 (source principale) ────────
// Proxy Deno côté serveur → pas de CORS, pas de 400

async function tryEdgeFunction(epciCode: string): Promise<PredictiveSitadelResult | null> {
  if (!supabase) return null;
  try {
    const minYear = new Date().getFullYear() - 3;
    const { data, error } = await supabase.functions.invoke("sitadel-v1", {
      body: { epciCode, minYear },
    });

    if (error || !data?.ok) {
      if (import.meta.env.DEV) {
        console.warn("[PREDICTIVE SITADEL] edge sitadel-v1 →", error?.message ?? data?.error);
      }
      return null;
    }

    const logements = safeN(data.logements);
    const surface   = safeN(data.surface);

    if (import.meta.env.DEV) {
      console.log("[PREDICTIVE SITADEL] edge sitadel-v1 ✓", { logements, surface, rows: data.rows });
    }

    if (logements === 0 && surface === 0) return null;

    const score = calcSitadelScore(logements, surface);
    return {
      available: true, score,
      logementsAutorises: logements, surfaceTotale: surface,
      detail: `${score}/100`,
      source: `sitadel-v1:EPCI:${epciCode}`,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[PREDICTIVE SITADEL] edge error", err);
    return null;
  }
}

// ── Tentative 2 : Tabular API directe (fallback — souvent 400 browser) ─

async function tryTabularDirect(epciCode: string): Promise<PredictiveSitadelResult | null> {
  const minYear = new Date().getFullYear() - 3;
  try {
    const url =
      `${TABULAR_API_BASE}/${TABULAR_RESOURCE}/data/` +
      `?EPCI__exact=${epciCode}&ANNEE__gte=${minYear}&page_size=200`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const rows: Record<string, unknown>[] = json.data ?? [];
    if (rows.length === 0) return null;
    let logements = 0;
    let surface   = 0;
    for (const row of rows) { logements += safeN(row.LOG_AUT); surface += safeN(row.SDP_AUT); }
    if (logements === 0 && surface === 0) return null;
    const score = calcSitadelScore(logements, surface);
    return { available: true, score, logementsAutorises: logements, surfaceTotale: surface, detail: `${score}/100`, source: `tabular:EPCI:${epciCode}` };
  } catch { return null; }
}

// ── Tentative 3 : Supabase RPC ────────────────────────────────────────

async function tryRpc(codeInsee: string): Promise<PredictiveSitadelResult | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("get_sitadel_commune", {
      p_code_commune: codeInsee, p_mois: 36,
    });
    if (error || !data) return null;
    const logements = safeN(data.logements_autorises ?? data.logements);
    const surface   = safeN(data.surface_totale ?? data.surface);
    if (logements > 0) {
      const score = calcSitadelScore(logements, surface);
      return { available: true, score, logementsAutorises: logements, surfaceTotale: surface, detail: `${score}/100`, source: "rpc" };
    }
    return null;
  } catch { return null; }
}

// ── Tentative 4 : Score synthétique (fallback garanti) ────────────────

function trySynthetic(mrSpecific: Record<string, unknown> | null | undefined): PredictiveSitadelResult | null {
  if (!isObj(mrSpecific)) return null;
  const indicateurs = isObj(mrSpecific.indicateurs_marche)
    ? (mrSpecific.indicateurs_marche as Record<string, string>) : null;
  const marche = isObj(mrSpecific.marche_immobilier)
    ? (mrSpecific.marche_immobilier as Record<string, number | null>) : null;
  if (!indicateurs && !marche) return null;

  let score = 25;
  if (indicateurs?.tension_locative === "forte")         score += 20;
  else if (indicateurs?.tension_locative === "faible")   score += 5;
  if (indicateurs?.attractivite_familiale === "forte")   score += 15;
  else if (indicateurs?.attractivite_familiale === "faible") score -= 5;

  const prixNeuf   = typeof marche?.prix_m2_neuf   === "number" ? marche.prix_m2_neuf   : 0;
  const prixAncien = typeof marche?.prix_m2_ancien === "number" ? marche.prix_m2_ancien : 0;
  if (prixNeuf > 0 && prixAncien > 0) {
    const ratio = prixNeuf / prixAncien;
    if      (ratio > 1.35) score += 18;
    else if (ratio > 1.20) score += 12;
    else if (ratio > 1.10) score += 6;
  }

  const final = Math.max(0, Math.min(100, score));
  if (import.meta.env.DEV) {
    console.log("[PREDICTIVE SITADEL] synthetic score →", final, { indicateurs, prixNeuf, prixAncien });
  }
  return { available: true, score: final, detail: `${final}/100`, source: "synthetic:mrSpecific" };
}

// ── Export principal ──────────────────────────────────────────────────

export async function getPredictiveSitadelScore(input: SitadelInput): Promise<PredictiveSitadelResult> {
  const codeInsee = await resolveCodeInsee(input);

  if (!codeInsee) {
    const synthetic = trySynthetic(input.mrSpecific);
    if (synthetic) return synthetic;
    return { available: false, detail: "Code INSEE non résolu" };
  }

  const cacheKey = `sitadel:${codeInsee}`;
  if (_cache.has(cacheKey)) {
    const cached = _cache.get(cacheKey)!;
    if (import.meta.env.DEV) console.log("[PREDICTIVE SITADEL] cache hit", cached);
    return cached;
  }

  if (import.meta.env.DEV) console.log(`[PREDICTIVE SITADEL] fetching insee=${codeInsee}…`);

  const epciCode = await resolveEpci(codeInsee);

  const result =
    (epciCode ? await tryEdgeFunction(epciCode)   : null) ??
    (epciCode ? await tryTabularDirect(epciCode)  : null) ??
    (await tryRpc(codeInsee))                             ??
    trySynthetic(input.mrSpecific)                        ??
    { available: false, detail: `Aucune donnée Sit@del pour ${codeInsee}` };

  console.log("[PREDICTIVE SITADEL] result", result);

  // Cache uniquement les résultats réels (pas synthetic, pour re-tenter si edge function arrive)
  if (result.available && result.source !== "synthetic:mrSpecific") {
    _cache.set(cacheKey, result);
  }

  return result;
}