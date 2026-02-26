/**
 * macroRates.service.ts
 * ─────────────────────────────────────────────────────────────────────
 * Service pour récupérer les taux sans risque depuis Supabase.
 *
 * Points clés:
 * - View: public.macro_rates_latest (series_key, rate_date, value_pct, source, as_of)
 * - RLS: lecture authenticated only
 * - pickRiskFreeSeriesKey: ESTR pour <5 ans, YC_10Y_AAA_EA pour >=5 ans
 * - Cache mémoire de 5 min pour éviter les requêtes multiples
 * ─────────────────────────────────────────────────────────────────────
 */

import { supabase } from "@/lib/supabaseClient";
import type { MacroRate } from "../types/strategy.types";

// ─── Cache mémoire (5 min) ──────────────────────────────────────────

interface CacheEntry {
  data: MacroRate;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): MacroRate | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: MacroRate): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

// ─── Series key selector ────────────────────────────────────────────

export function pickRiskFreeSeriesKey(durationYears: number): string {
  return durationYears < 5 ? "ESTR" : "YC_10Y_AAA_EA";
}

// ─── Fetch from Supabase ────────────────────────────────────────────

export async function fetchLatestMacroRate(
  seriesKey: string
): Promise<MacroRate> {
  // Check cache first
  const cached = getCached(seriesKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("macro_rates_latest")
    .select("series_key, rate_date, value_pct, source")
    .eq("series_key", seriesKey)
    .single();

  if (error || !data) {
    console.warn(
      `[macroRates] Impossible de récupérer le taux ${seriesKey}:`,
      error?.message
    );
    // Fallback: taux par défaut raisonnables
    return getFallbackRate(seriesKey);
  }

  const rate: MacroRate = {
    seriesKey: data.series_key,
    valuePct: data.value_pct,
    rateDate: data.rate_date,
    source: data.source,
  };

  setCache(seriesKey, rate);
  return rate;
}

// ─── Convenience: fetch risk-free rate for a given duration ─────────

export async function fetchRiskFreeRate(
  durationYears: number
): Promise<MacroRate> {
  const key = pickRiskFreeSeriesKey(durationYears);
  return fetchLatestMacroRate(key);
}

// ─── Fallback rates (si Supabase indisponible) ──────────────────────

function getFallbackRate(seriesKey: string): MacroRate {
  const fallbacks: Record<string, number> = {
    ESTR: 3.15,
    YC_10Y_AAA_EA: 2.85,
  };

  return {
    seriesKey,
    valuePct: fallbacks[seriesKey] ?? 3.0,
    rateDate: new Date().toISOString().slice(0, 10),
    source: "fallback",
  };
}
