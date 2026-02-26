// src/spaces/marchand/services/enrichMarketToDueDiligence.service.ts
/**
 * enrichMarketToDueDiligence.service.ts
 *
 * Lit le snapshot Marchand (deal actif), appelle l'Edge Function
 * market-context-v1, puis écrit 4 items « Marché » dans le store DD.
 */

import { supabase } from "@/lib/supabaseClient";
import { ensureActiveDeal } from "../shared/marchandSnapshot.store";
import {
  upsertItemsForDossier,
  type DueDiligenceItem,
  type DDStatus,
} from "../shared/dueDiligence.store";

// ─── Helpers ────────────────────────────────────────────────────────

function scoreToStatus(score: number | null | undefined): DDStatus {
  if (score == null) return "MISSING";
  if (score >= 70) return "OK";
  if (score >= 40) return "WARNING";
  return "CRITICAL";
}

function vacancyToStatus(rate: number | null | undefined): DDStatus {
  if (rate == null) return "MISSING";
  if (rate <= 5) return "OK";
  if (rate <= 12) return "WARNING";
  return "CRITICAL";
}

function priceEvoToStatus(pct: number | null | undefined): DDStatus {
  if (pct == null) return "MISSING";
  if (pct >= 2) return "OK";
  if (pct >= -2) return "WARNING";
  return "CRITICAL";
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickFirstNumber(obj: any, paths: string[]): number | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = obj;
    let ok = true;
    for (const part of parts) {
      if (cur && typeof cur === "object" && part in cur) cur = cur[part];
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const n = toNumber(cur);
    if (n != null) return n;
  }
  return null;
}

// ─── Service principal ──────────────────────────────────────────────

export async function enrichMarketToDueDiligence(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    // 1) Deal actif
    const deal = ensureActiveDeal();
    if (!deal) {
      return { ok: false, error: "Aucun deal actif dans le snapshot Marchand." };
    }

    const { zipCode, city, address, surfaceM2, prixAchat } = deal;

    if (!zipCode || !city) {
      return { ok: false, error: "zipCode et city sont obligatoires sur le deal actif." };
    }

    // 2) Appel EF market-context-v1
    const { data, error } = await supabase.functions.invoke("market-context-v1", {
      body: {
        zipCode,
        city,
        ...(address ? { address } : {}),
        surfaceHabitable: surfaceM2 ?? undefined,
        priceAsked: prixAchat ?? undefined,
      },
    });

    if (error) {
      return { ok: false, error: `Edge Function error: ${error.message}` };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mc = data as Record<string, any> | null;
    if (!mc) {
      return { ok: false, error: "Réponse vide de market-context-v1." };
    }

    // 3) Normaliser les chemins (selon version EF)
    // market-context-v1 standard: { success, marketContext, insee }
    const marketContext = mc.marketContext ?? mc.market_context ?? mc.market ?? mc;
    const stats = marketContext?.stats ?? mc.stats ?? mc.marketStats ?? {};
    const scores = marketContext?.scores ?? mc.scores ?? {};
    const insee = mc.insee ?? marketContext?.insee ?? null;

    const tensionScore = pickFirstNumber(
      { scores, stats, insee, marketContext, mc },
      [
        "scores.demandDepthScore",
        "scores.demand_depth_score",
        "scores.tension_locative",
        "stats.tension_locative_score",
      ]
    );

    const vacanceRate = pickFirstNumber(
      { scores, stats, insee, marketContext, mc },
      ["stats.taux_vacance", "stats.vacancy_rate"]
    );

    const prixEvolution = pickFirstNumber(
      { scores, stats, insee, marketContext, mc },
      ["stats.priceTrend12m", "stats.price_trend_12m", "stats.evolution_prix_pct"]
    );

    const attractiviteScore = (() => {
      const avg =
        pickFirstNumber({ scores }, ["scores.global", "scores.attractivite"]) ??
        (() => {
          const d = toNumber(scores?.dynamismScore);
          const l = toNumber(scores?.liquidityScore);
          const dd = toNumber(scores?.demandDepthScore);
          const arr = [d, l, dd].filter((x): x is number => x != null);
          if (!arr.length) return null;
          return arr.reduce((a, b) => a + b, 0) / arr.length;
        })();
      return avg;
    })();

    // 4) Construire items DD « Marché »
    const now = new Date().toISOString();
    const dossierId = deal.id;

    const items: DueDiligenceItem[] = [
      {
        id: "tension_locative",
        category: "marche",
        label: "Tension locative",
        status: scoreToStatus(tensionScore),
        value: tensionScore != null ? `${Math.round(tensionScore)}/100` : null,
        comment:
          tensionScore != null
            ? tensionScore >= 70
              ? "Marché locatif tendu — bonne demande."
              : tensionScore >= 40
              ? "Tension locative modérée."
              : "Faible tension locative — risque de vacance."
            : "Information non fournie dans les données analysées.",
        updatedAt: now,
      },
      {
        id: "taux_de_vacance",
        category: "marche",
        label: "Taux de vacance",
        status: vacancyToStatus(vacanceRate),
        value: vacanceRate != null ? `${vacanceRate.toFixed(1)} %` : null,
        comment:
          vacanceRate != null
            ? vacanceRate <= 5
              ? "Vacance très faible — marché sain."
              : vacanceRate <= 12
              ? `Vacance modérée (${vacanceRate.toFixed(1)}%).`
              : `Vacance élevée (${vacanceRate.toFixed(1)}%) — vigilance.`
            : "Information non fournie dans les données analysées.",
        updatedAt: now,
      },
      {
        id: "dynamique_des_prix",
        category: "marche",
        label: "Dynamique des prix",
        status: priceEvoToStatus(prixEvolution),
        value:
          prixEvolution != null
            ? `${prixEvolution >= 0 ? "+" : ""}${prixEvolution.toFixed(1)} %`
            : null,
        comment:
          prixEvolution != null
            ? prixEvolution >= 2
              ? "Prix en hausse — marché dynamique."
              : prixEvolution >= -2
              ? "Prix stables."
              : "Prix en baisse — marché baissier."
            : "Information non fournie dans les données analysées.",
        updatedAt: now,
      },
      {
        id: "attractivite",
        category: "marche",
        label: "Attractivité",
        status: scoreToStatus(attractiviteScore),
        value:
          attractiviteScore != null
            ? `${Math.round(attractiviteScore)}/100`
            : null,
        comment:
          attractiviteScore != null
            ? attractiviteScore >= 70
              ? "Zone attractive — indicateurs favorables."
              : attractiviteScore >= 40
              ? "Attractivité moyenne."
              : "Zone peu attractive — approfondir l'analyse."
            : "Information non fournie dans les données analysées.",
        updatedAt: now,
      },
    ];

    // 5) Persister
    upsertItemsForDossier(dossierId, items);

    console.log("[enrichMarketToDueDiligence] ok", {
      dossierId,
      tensionScore,
      vacanceRate,
      prixEvolution,
      attractiviteScore,
    });

    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[enrichMarketToDueDiligence]", msg);
    return { ok: false, error: msg };
  }
}
