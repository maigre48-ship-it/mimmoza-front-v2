// ============================================================================
// ComitePage.tsx — /banque/comite/:id
// src/spaces/banque/pages/ComitePage.tsx
// ✅ v4: Cover page — cibles monochromes teal profond
// ============================================================================

import { useState, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import { buildOperationSummaryFromDossier } from "../adapters/manualOperationAdapter";
import {
  computeSmartScoreFromOperation,
  buildVerdictExplanation,
  type SmartScoreUniversalResult,
} from "../scoring/banqueSmartScoreUniversal";
import { normalizeSmartScoreUniversal } from "../scoring/normalizeSmartScoreUniversal";
// ❌ IA désactivée — import supprimé
// import { generateCommitteeNarrative } from "../services/banqueCommitteeNarrative.service";
import {
  buildCommitteePresentation as buildEnginePresentation,
  buildDecisionScenarios as buildEngineScenarios,
  buildAcceptanceProbability,
  buildRiskReturnMatrix,
  buildStressTests,
} from "../committee/committeeEngine";
import type { ReportInput as EngineReportInput } from "../committee/committeeEngine";
import type {
  OperationSummary,
  MissingDataItem,
} from "../types/operationSummary.types";

// ── Design tokens Financeur ──
const GRAD_FIN = "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
const ACCENT_FIN = "#1a7a50";

// ── Types ──

interface CommitteeNarrative {
  text: string;
  structured?: any;
  sourcesUsed: string[];
  warnings?: string[];
  model: string;
  promptVersion: string;
  sourceHash: string;
  generatedAt: string;
}

interface UniversalReport {
  generatedAt: string;
  profile: string;
  meta: {
    dossierRef: string;
    dossierLabel: string;
    profile: string;
    generatedAt: string;
  };
  emprunteur: {
    type: string;
    identite: string;
    details: Record<string, string>;
  };
  projet: Record<string, string>;
  budget: Record<string, string>;
  financement: Record<string, string>;
  revenus: Record<string, string>;
  marche: Record<string, string>;
  risques: {
    items: Array<{ label: string; level: string; status: string }>;
    score: string;
    globalLevel: string;
  };
  kpis: Record<string, string>;
  scenarios: Record<string, Record<string, string>>;
  missing: MissingDataItem[];
  smartscore: SmartScoreUniversalResult | null;
  verdictExplanation: string;
  marketStudy: MarketStudyData | null;
}

interface MarketStudyData {
  scoreGlobal: number | null;
  scoreLabel: string;
  dvf: {
    medianPriceM2: number | null;
    avgPriceM2: number | null;
    transactionCount: number | null;
    evolutionPct: number | null;
    topTransactions: Array<{
      date: string;
      typeLocal: string;
      surface: string;
      valeur: string;
      prixM2: string;
    }>;
  };
  insee: {
    population: string;
    densite: string;
    revenuMedian: string;
    tauxChomage: string;
    partProprietaires: string;
    partLocataires: string;
    tauxVacance: string;
    tauxPauvrete: string;
    commune: string;
    codeInsee: string;
  };
  bpe: {
    totalEquipements: string;
    score: string;
    commerce: string;
    sante: string;
    education: string;
    services: string;
    topProches: Array<{ nom: string; type: string; distance: string }>;
  };
  transport: {
    hasData: boolean;
    summary: string;
    items: Array<{ label: string; distance: string }>;
  };
  insights: Array<{ type: "positive" | "warning" | "neutral"; message: string }>;
}

// ── SAFE CAST Helpers ──

const pdfFixSpaces = (s: string): string =>
  s.replace(/\u202f/g, " ").replace(/\u00a0/g, " ");

function safeString(v: unknown, fallback = "-"): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed || trimmed === "[object Object]" || trimmed === "NaN") return fallback;
    return trimmed;
  }
  if (typeof v === "number") return isNaN(v) ? fallback : String(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const s = v.map((x) => safeString(x, "")).filter(Boolean).join(", ");
    return s.trim() ? s : fallback;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const candidate =
      o.nom ?? o.name ?? o.label ?? o.value ?? o.title ?? o.code ?? o.id ?? null;
    if (typeof candidate === "string" && candidate.trim() && candidate !== "[object Object]")
      return candidate;
    if (typeof candidate === "number" && !isNaN(candidate))
      return String(candidate);
    for (const val of Object.values(o)) {
      if (typeof val === "string" && val.trim() && val !== "[object Object]") return val;
    }
    for (const val of Object.values(o)) {
      if (typeof val === "number" && !isNaN(val)) return String(val);
    }
    return fallback;
  }
  return fallback;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    if (!v.trim() || v === "[object Object]" || v === "NaN") return null;
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const key of ["count", "total", "value", "n", "score", "nombre"]) {
      if (typeof o[key] === "number" && !isNaN(o[key] as number)) return o[key] as number;
    }
    for (const val of Object.values(o)) {
      if (typeof val === "number" && !isNaN(val)) return val;
    }
  }
  return null;
}

// ── Formatting Helpers (PDF-safe) ──

const fmt = (v: unknown, suffix = ""): string => {
  if (v === null || v === undefined || v === "") return "Non renseigne";
  const n = safeNumber(v);
  if (n !== null) return `${pdfFixSpaces(n.toLocaleString("fr-FR"))}${suffix}`;
  return safeString(v, "Non renseigne");
};

const fmtK = (v: unknown): string => {
  if (v === null || v === undefined) return "Non renseigne";
  const n = safeNumber(v);
  if (n !== null) return `${pdfFixSpaces((n / 1000).toFixed(0))}k\u20AC`;
  return safeString(v, "Non renseigne");
};

const fmtNum = (v: unknown, decimals = 0, suffix = ""): string => {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = safeNumber(v);
  if (n === null) return safeString(v, "N/A");
  const s = n.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${pdfFixSpaces(s)}${suffix}`;
};

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-green-200 text-green-900",
  A: "bg-green-100 text-green-800",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-amber-100 text-amber-700",
  "D+": "bg-orange-100 text-orange-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700",
  F: "bg-red-200 text-red-800",
};

function getGradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? "bg-gray-100 text-gray-700";
}

function kpiNum(v: string | undefined | null): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9.,\-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseMoneyK(v: string | undefined | null): number | null {
  if (!v) return null;
  const s = v.replace(/\u202f/g, " ").replace(/\u00a0/g, " ").replace(/\s/g, "");
  if (/k[€\u20AC]$/i.test(s)) {
    const n = parseFloat(s.replace(/k[€\u20AC]$/i, "").replace(",", "."));
    return isNaN(n) ? null : n * 1000;
  }
  return kpiNum(v);
}

// ════════════════════════════════════════════════════════════════════
// ROBUST MARKET DATA GETTERS
// ════════════════════════════════════════════════════════════════════

function dig(obj: any, ...keys: string[]): any {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

function extractMarketStudy(operation: OperationSummary): MarketStudyData | null {
  const m: any = operation.market;
  if (!m) return null;
  const ctx: any = m.marketContext ?? m.context ?? m.study ?? m.marketStudy ?? m;
  const inseeRaw: any = dig(ctx, "insee") ?? dig(m, "insee") ?? {};
  const bpeRaw: any = dig(ctx, "bpe") ?? dig(m, "bpe") ?? {};
  const transportRaw: any = dig(ctx, "transport") ?? dig(m, "transport") ?? {};
  const dvfRaw: any = dig(ctx, "dvf") ?? dig(m, "dvf") ?? {};
  const insightsRaw: any = dig(ctx, "insights") ?? dig(m, "insights") ?? [];
  const scoresRaw: any = dig(ctx, "scores") ?? dig(m, "scores") ?? {};
  const scoreGlobal =
    typeof scoresRaw.global === "number" ? scoresRaw.global
      : typeof m.marketScore === "number" ? m.marketScore : null;
  const scoreLabel =
    scoreGlobal != null
      ? scoreGlobal >= 75 ? "Excellent" : scoreGlobal >= 50 ? "Bon" : scoreGlobal >= 25 ? "Moyen" : "Faible"
      : "N/A";
  const dvfStats: any = dvfRaw.stats ?? dvfRaw;
  const rawTransactions: any[] = Array.isArray(dvfRaw.transactions) ? dvfRaw.transactions : Array.isArray(dvfRaw.items) ? dvfRaw.items : [];
  const topTransactions = rawTransactions.slice(0, 10).map((t: any) => ({
    date: safeString(t.date_mutation ?? t.date ?? t.dateMutation, "-"),
    typeLocal: safeString(t.type_local ?? t.typeLocal ?? t.type, "-"),
    surface: fmtNum(safeNumber(t.surface_reelle_bati ?? t.surface ?? t.surfaceM2), 0, " m2"),
    valeur: fmtNum(safeNumber(t.valeur_fonciere ?? t.valeur ?? t.price), 0, " EUR"),
    prixM2: fmtNum(safeNumber(t.prix_m2 ?? t.prixM2 ?? t.pricePerSqm), 0, " EUR/m2"),
  }));
  const popRaw = inseeRaw.population ?? inseeRaw.pop ?? m.populationCommune;
  const densite = inseeRaw.densite ?? inseeRaw.densitePopulation ?? inseeRaw.density;
  const revMedian = inseeRaw.revenuMedian ?? inseeRaw.revenu_median ?? inseeRaw.medianIncome ?? m.revenueMedian;
  const chomage = inseeRaw.tauxChomage ?? inseeRaw.taux_chomage ?? inseeRaw.unemploymentRate;
  const proprios = inseeRaw.partProprietaires ?? inseeRaw.proprietaires ?? inseeRaw.ownerRate;
  const locataires = inseeRaw.partLocataires ?? inseeRaw.locataires ?? inseeRaw.renterRate;
  const vacance = inseeRaw.tauxVacance ?? inseeRaw.taux_vacance ?? inseeRaw.vacancyRate;
  const pauvrete = inseeRaw.tauxPauvrete ?? inseeRaw.taux_pauvrete ?? inseeRaw.povertyRate;
  const bpeCounts: any = bpeRaw.counts ?? bpeRaw;
  const bpeTop: any[] = Array.isArray(bpeRaw.topProches ?? bpeRaw.nearest ?? bpeRaw.proximite)
    ? (bpeRaw.topProches ?? bpeRaw.nearest ?? bpeRaw.proximite) : [];
  const transportItems: any[] = Array.isArray(transportRaw.items ?? transportRaw.stops ?? transportRaw.stations)
    ? (transportRaw.items ?? transportRaw.stops ?? transportRaw.stations) : [];
  const transportHasData = transportItems.length > 0 || !!(transportRaw.summary ?? transportRaw.label ?? transportRaw.score);
  const insights: MarketStudyData["insights"] = (Array.isArray(insightsRaw) ? insightsRaw : [])
    .filter((i: any) => i && (i.message || i.text || i.label))
    .map((i: any) => ({
      type: i.type === "positive" || i.type === "warning" || i.type === "neutral" ? i.type
        : i.severity === "positive" || i.sentiment === "positive" ? ("positive" as const)
          : i.severity === "warning" || i.sentiment === "warning" ? ("warning" as const) : ("neutral" as const),
      message: safeString(i.message ?? i.text ?? i.label),
    }));
  return {
    scoreGlobal, scoreLabel,
    dvf: {
      medianPriceM2: safeNumber(dvfStats.medianPriceM2 ?? dvfStats.median_price_m2 ?? m.pricePerSqm),
      avgPriceM2: safeNumber(dvfStats.avgPriceM2 ?? dvfStats.avg_price_m2),
      transactionCount: safeNumber(dvfStats.count ?? dvfStats.transactionCount ?? m.compsCount),
      evolutionPct: safeNumber(dvfStats.evolutionPct ?? m.evolutionPct),
      topTransactions,
    },
    insee: {
      population: fmtNum(safeNumber(popRaw)),
      densite: safeNumber(densite) != null ? fmtNum(safeNumber(densite), 0, " hab/km2") : "N/A",
      revenuMedian: safeNumber(revMedian) != null ? fmtNum(safeNumber(revMedian), 0, " EUR") : "N/A",
      tauxChomage: safeNumber(chomage) != null ? fmtNum(safeNumber(chomage), 1, "%") : "N/A",
      partProprietaires: safeNumber(proprios) != null ? fmtNum(safeNumber(proprios), 1, "%") : "N/A",
      tauxPauvrete: safeNumber(pauvrete) != null ? fmtNum(safeNumber(pauvrete), 1, " %") : "N/A",
      partLocataires: safeNumber(locataires) != null ? fmtNum(safeNumber(locataires), 1, "%") : "N/A",
      tauxVacance: safeNumber(vacance) != null ? fmtNum(safeNumber(vacance), 1, "%") : "N/A",
      commune: safeString(inseeRaw.commune ?? inseeRaw.nomCommune ?? m.commune, "-"),
      codeInsee: safeString(inseeRaw.codeInsee ?? inseeRaw.code_insee ?? m.communeInsee ?? (operation.project as any)?.communeInsee, "-"),
    },
    bpe: {
      totalEquipements: fmtNum(safeNumber(bpeCounts.total ?? bpeRaw.totalEquipements ?? bpeRaw.total)),
      score: safeNumber(bpeRaw.score) != null ? fmtNum(safeNumber(bpeRaw.score), 0, "/100") : "N/A",
      commerce: fmtNum(safeNumber(bpeCounts.commerce ?? bpeCounts.commerces)),
      sante: fmtNum(safeNumber(bpeCounts.sante ?? bpeCounts.health)),
      education: fmtNum(safeNumber(bpeCounts.education ?? bpeCounts.enseignement)),
      services: fmtNum(safeNumber(bpeCounts.services ?? bpeCounts.service)),
      topProches: bpeTop.slice(0, 5).map((p: any) => ({
        nom: safeString(p.nom ?? p.name ?? p.label, "-"),
        type: safeString(p.type ?? p.category ?? p.categorie, "-"),
        distance: safeNumber(p.distance) != null
          ? `${Number(p.distance) < 10 ? Number(p.distance).toFixed(1) : Math.round(Number(p.distance))} m` : "-",
      })),
    },
    transport: {
      hasData: transportHasData,
      summary: safeString(transportRaw.summary ?? transportRaw.label, transportHasData ? "" : "Donnees insuffisantes (non note)"),
      items: transportItems.slice(0, 5).map((t: any) => ({
        label: safeString(t.label ?? t.name ?? t.line, "-"),
        distance: safeNumber(t.distance) != null ? `${Math.round(Number(t.distance))} m` : "-",
      })),
    },
    insights,
  };
}

function mergeMarketStudyIntoOperation(operation: OperationSummary, dossier: any): OperationSummary {
  if (!dossier) return operation;
  const candidates: any[] = [
    dig(dossier, "analyse", "marketStudy"), dig(dossier, "analyse", "market"),
    dig(dossier, "analyse", "etude"), dig(dossier, "analyse", "etudeMarche"),
    dig(dossier, "marketStudy"), dig(dossier, "market"), dig(dossier, "etudeMarche"),
    dig(dossier, "operation", "marketContext"), dig(dossier, "operation", "market", "marketContext"),
    dig(dossier, "operation", "market", "study"), dig(dossier, "operation", "market", "marketStudy"),
    dig(dossier, "comite", "marketStudy"), dig(dossier, "snapshot", "marketStudy"),
    dig(dossier, "snapshot", "market"), dig(dossier, "snapshots", "analyse", "marketStudy"),
    dig(dossier, "snapshots", "analyse", "market"),
  ];
  const STUDY_KEYS = ["dvf", "insee", "bpe", "scores", "insights", "transport", "marketScore", "global"];
  const enriched = candidates.find((c) => c && typeof c === "object" && STUDY_KEYS.some((k) => k in c));
  if (!enriched) return operation;
  const existingMarket: any = operation.market ?? {};
  const merged: any = { ...existingMarket };
  const mergeSubKey = (key: string) => {
    const src = enriched[key];
    if (!src || typeof src !== "object") return;
    if (!merged[key] || typeof merged[key] !== "object") merged[key] = src;
    else merged[key] = { ...src, ...merged[key] };
  };
  mergeSubKey("dvf"); mergeSubKey("insee"); mergeSubKey("bpe");
  mergeSubKey("transport"); mergeSubKey("scores"); mergeSubKey("insights");
  if (!merged.marketContext && !merged.marketStudy && !merged.study) merged.marketContext = enriched;
  if (enriched.marketScore != null && merged.marketScore == null) merged.marketScore = enriched.marketScore;
  if (enriched.global != null && !merged.scores?.global) merged.scores = { ...merged.scores, global: enriched.global };
  for (const fk of ["pricePerSqm", "compsCount", "evolutionPct", "demandIndex", "absorptionMonths", "populationCommune", "revenueMedian", "commune", "communeInsee"]) {
    if (merged[fk] == null && enriched[fk] != null) merged[fk] = enriched[fk];
  }
  return { ...operation, market: merged } as OperationSummary;
}

function buildRisquesFromOperation(rk: Record<string, any>): {
  items: Array<{ label: string; level: string; status: string }>;
  score: string; globalLevel: string;
} {
  const geo: unknown = rk.geo;
  let geoItems: Array<Record<string, any>>;
  if (Array.isArray(geo)) geoItems = geo;
  else if (geo && typeof geo === "object") {
    const geoObj = geo as Record<string, any>;
    geoItems = Array.isArray(geoObj.items) ? geoObj.items : [geoObj];
  } else geoItems = [];
  const isSynthese = geoItems.length === 1 && geoItems[0] &&
    ("nbRisques" in geoItems[0] || "hasInondation" in geoItems[0] || "hasSismique" in geoItems[0]);
  let items: Array<{ label: string; level: string; status: string }>;
  if (isSynthese) {
    const s = geoItems[0]; items = [];
    if ("hasInondation" in s) items.push({ label: "Inondation", level: s.hasInondation ? "eleve" : "faible", status: s.hasInondation === true ? "present" : s.hasInondation === false ? "absent" : "unknown" });
    if ("hasSismique" in s) items.push({ label: "Sismique", level: s.hasSismique ? "eleve" : "faible", status: s.hasSismique === true ? "present" : s.hasSismique === false ? "absent" : "unknown" });
    if ("hasArgile" in s) items.push({ label: "Retrait-gonflement argiles", level: s.hasArgile ? "moyen" : "faible", status: s.hasArgile === true ? "present" : s.hasArgile === false ? "absent" : "unknown" });
    if ("nbRisques" in s && typeof s.nbRisques === "number") items.push({ label: "Nombre total de risques identifies", level: String(s.nbRisques), status: "unknown" });
    if (items.length === 0 && s.label) items.push({ label: String(s.label), level: s.level ?? s.niveau ?? "inconnu", status: s.status ?? "unknown" });
  } else {
    items = geoItems.map((ri) => ({
      label: safeString(ri.label ?? ri.name ?? ri.type, "Risque"),
      level: safeString(ri.level ?? ri.niveau, "inconnu"),
      status: ri.status ?? (ri.present === true ? "present" : ri.present === false ? "absent" : "unknown"),
    }));
  }
  const geoObj = geo && typeof geo === "object" ? (geo as Record<string, any>) : null;
  const scoreNum = typeof rk.score === "number" ? rk.score : typeof geoObj?.score === "number" ? geoObj.score : null;
  return { items, score: scoreNum != null ? `${scoreNum}/100` : "N/A", globalLevel: safeString(rk.globalLevel ?? geoObj?.label, "inconnu") };
}

function generateUniversalReport(dossier: any, operation: OperationSummary, scoreResult: SmartScoreUniversalResult | null): UniversalReport {
  const emp = dossier?.emprunteur;
  const now = new Date().toISOString();
  let emprunteur;
  if (!emp?.type) emprunteur = { type: "inconnu", identite: dossier?.sponsor || "Non renseigne", details: {} };
  else if (emp.type === "personne_physique") emprunteur = {
    type: "personne_physique",
    identite: `${emp.prenom ?? ""} ${emp.nom ?? ""}`.trim() || "Non renseigne",
    details: { ...(emp.dateNaissance ? { "Date de naissance": emp.dateNaissance } : {}), ...(emp.telephone ? { Telephone: emp.telephone } : {}), ...(emp.email ? { Email: emp.email } : {}), ...(emp.adresse ? { Adresse: emp.adresse } : {}) },
  };
  else emprunteur = {
    type: "personne_morale",
    identite: emp.raisonSociale || emp.nom || "Non renseigne",
    details: { ...(emp.siren ? { SIREN: emp.siren } : {}), ...(emp.formeJuridique ? { Forme: emp.formeJuridique } : {}), ...(emp.dirigeant ? { Dirigeant: emp.dirigeant } : {}), ...(emp.telephone ? { Telephone: emp.telephone } : {}) },
  };
  const p = operation.project ?? {};
  const projet: Record<string, string> = {};
  if (p.label) projet["Nom"] = p.label; if (p.operationType) projet["Type d'operation"] = p.operationType;
  if (p.assetType) projet["Type d'actif"] = p.assetType; if (p.address) projet["Adresse"] = p.address;
  if (p.communeInsee) projet["Code INSEE"] = p.communeInsee; if (p.surfaceM2) projet["Surface"] = `${p.surfaceM2} m2`;
  if (p.lots) projet["Lots"] = String(p.lots); if (p.dpe) projet["DPE"] = p.dpe;
  const b = operation.budget ?? {};
  const budget: Record<string, string> = {};
  if (b.purchasePrice) budget["Prix d'achat"] = fmtK(b.purchasePrice);
  if (b.notaryFees) budget["Frais de notaire"] = fmtK(b.notaryFees);
  if (b.worksBudget) budget["Budget travaux"] = fmtK(b.worksBudget);
  if (b.softCosts) budget["Soft costs"] = fmtK(b.softCosts);
  if (b.holdingCosts) budget["Frais de portage"] = fmtK(b.holdingCosts);
  if (b.contingency) budget["Aleas"] = fmtK(b.contingency);
  if (b.landCost) budget["Cout foncier"] = fmtK(b.landCost);
  if (b.constructionCost) budget["Construction"] = fmtK(b.constructionCost);
  if (b.totalCost) budget["TOTAL"] = fmtK(b.totalCost);
  if (b.costPerSqm) budget["Cout/m2"] = `${b.costPerSqm} EUR`;
  const f = operation.financing ?? {};
  const financement: Record<string, string> = {};
  if (f.loanAmount) financement["Montant pret"] = fmtK(f.loanAmount);
  if (f.loanDurationMonths) financement["Duree"] = `${f.loanDurationMonths} mois`;
  if (f.loanType) financement["Type"] = f.loanType;
  if (f.interestRate) financement["Taux"] = `${f.interestRate}%`;
  if (f.equity) financement["Apport personnel"] = fmtK(f.equity);
  const r = operation.revenues ?? {};
  const revenus: Record<string, string> = {};
  if (r.strategy) revenus["Strategie"] = r.strategy;
  if (r.exitValue) revenus["Valeur de sortie"] = fmtK(r.exitValue);
  if (r.rentAnnual) revenus["Loyer annuel"] = fmtK(r.rentAnnual);
  if (r.occupancyRate) revenus["Taux d'occupation"] = `${r.occupancyRate}%`;
  if (r.revenueTotal) revenus["CA total"] = fmtK(r.revenueTotal);
  const mk = operation.market ?? {};
  const marche: Record<string, string> = {};
  if (mk.pricePerSqm) marche["Prix median /m2"] = `${mk.pricePerSqm} EUR`;
  if (mk.compsCount) marche["Transactions DVF"] = String(mk.compsCount);
  if (mk.evolutionPct != null) marche["Evolution prix"] = `${mk.evolutionPct}%`;
  if (mk.demandIndex != null) marche["Indice demande"] = `${mk.demandIndex}/100`;
  if (mk.absorptionMonths) marche["Absorption"] = `${mk.absorptionMonths} mois`;
  if (mk.populationCommune) marche["Population"] = String(mk.populationCommune);
  if (mk.revenueMedian) marche["Revenu median"] = fmtK(mk.revenueMedian);
  const msForMarche = extractMarketStudy(operation);
  if (msForMarche?.insee?.tauxPauvrete && msForMarche.insee.tauxPauvrete !== "N/A") marche["Taux de pauvrete"] = msForMarche.insee.tauxPauvrete;
  const rk = operation.risks ?? {};
  const risques = buildRisquesFromOperation(rk as Record<string, any>);
  const k = operation.kpis ?? {};
  const kpis: Record<string, string> = {};
  if (k.ltv != null) kpis["LTV"] = `${k.ltv}%`; if (k.ltc != null) kpis["LTC"] = `${k.ltc}%`;
  if (k.margin != null) kpis["Marge brute"] = `${k.margin}%`; if (k.roi != null) kpis["ROI"] = `${k.roi}%`;
  if (k.irr != null) kpis["TRI"] = `${k.irr}%`; if (k.dscr != null) kpis["DSCR"] = String(k.dscr);
  if (k.yieldGross != null) kpis["Rendement brut"] = `${k.yieldGross}%`;
  if (k.cashOnCash != null) kpis["Cash-on-cash"] = `${k.cashOnCash}%`;
  const scenarios: Record<string, Record<string, string>> = {};
  if (r.scenarios) {
    for (const [key, sc] of Object.entries(r.scenarios)) {
      if (sc) {
        const s: Record<string, string> = {};
        if (sc.exitValue) s["Sortie"] = fmtK(sc.exitValue); if (sc.margin != null) s["Marge"] = `${sc.margin}%`;
        if (sc.roi != null) s["ROI"] = `${sc.roi}%`; if (sc.notes) s["Notes"] = sc.notes;
        scenarios[key] = s;
      }
    }
  }
  const marketStudy = extractMarketStudy(operation);
  const dossierRef = dossier?.reference ?? dossier?.id ?? dossier?.dossierId ?? (dossier && typeof dossier === "object" ? (dossier as any).ref : null) ?? "-";
  return {
    generatedAt: now, profile: operation.meta.profile,
    meta: { dossierRef, dossierLabel: dossier?.label ?? "-", profile: operation.meta.profile, generatedAt: now },
    emprunteur, projet, budget, financement, revenus, marche, risques, kpis, scenarios,
    missing: operation.missing ?? [],
    smartscore: scoreResult,
    verdictExplanation: scoreResult ? buildVerdictExplanation(scoreResult) : "Aucune evaluation disponible",
    marketStudy,
  };
}

function isReportValid(report: UniversalReport | null): boolean {
  return !!report && !!report.generatedAt && !!report.meta;
}
function isNarrativeValid(n: any): n is CommitteeNarrative {
  return !!n && typeof n === "object" && typeof n.text === "string" && n.text.trim().length > 0 && typeof n.generatedAt === "string";
}

function canonicalizeForHash(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalizeForHash(value[k]);
    return out;
  }
  return value;
}
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function computeReportSourceHash(report: any): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalizeForHash(report)));
}

function sanitize(input: unknown): string {
  if (input === null || input === undefined) return "";
  const text = String(input);
  if (!text) return "";
  return text
    .replace(/\u202f/g, " ").replace(/\u00a0/g, " ")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "").replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "").replace(/[\u{200D}]/gu, "")
    .replace(/[\u{20E3}]/gu, "").replace(/[\u{E0020}-\u{E007F}]/gu, "")
    .replace(/[\u{D800}-\u{DFFF}]/gu, "").replace(/[\u{2300}-\u{23FF}]/gu, "")
    .replace(/[\u{2B50}]/gu, "").replace(/[\u{1F100}-\u{1F1FF}]/gu, "")
    .replace(/[\u{1FA00}-\u{1FAFF}]/gu, "").trim();
}
function cleanReason(reason: string, maxLen = 60): string {
  let s = sanitize(reason);
  s = s.replace(/^[-\u2022\u2023\u25E6\u00B7]\s*/, "");
  if (s.length > maxLen) s = s.substring(0, maxLen - 3) + "...";
  return s;
}

// ════════════════════════════════════════════════════════════════════
// PDF THEME CONSTANTS
// ════════════════════════════════════════════════════════════════════

const PDF_COLORS = {
  primary:      [38, 166, 154]  as [number, number, number],
  primaryLight: [128, 203, 196] as [number, number, number],
  accent:       [26, 122, 80]   as [number, number, number],
  dark:         [10, 61, 40]    as [number, number, number],
  medium:       [107, 114, 128] as [number, number, number],
  light:        [232, 251, 242] as [number, number, number],
  white:        [255, 255, 255] as [number, number, number],
  green:        [22, 163, 74]   as [number, number, number],
  amber:        [217, 119, 6]   as [number, number, number],
  red:          [220, 38, 38]   as [number, number, number],
};

// ════════════════════════════════════════════════════════════════════
// STRUCTURED NARRATIVE — UI RENDER HELPERS
// ════════════════════════════════════════════════════════════════════

function sn(v: any, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v.trim() || fallback;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x: any) => sn(x)).filter(Boolean).join(", ");
  return fallback;
}

function StructuredBullets({ items, color = "gray" }: { items: any; color?: string }) {
  if (!items) return null;
  const list: string[] = Array.isArray(items) ? items.map((x: any) => sn(x)).filter(Boolean)
    : typeof items === "string" && items.trim() ? [items.trim()] : [];
  if (list.length === 0) return null;
  const dotColor = color === "green" ? "bg-green-400" : color === "amber" ? "bg-amber-400" : color === "red" ? "bg-red-400" : "bg-gray-400";
  return (
    <ul className="space-y-1 mt-1">
      {list.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StructuredNarrativeView({ data }: { data: any }) {
  if (!data || typeof data !== "object") return null;
  const fiche = data.ficheDossier;
  const analyse = data.analyseCredit;
  const conformite = data.conformitePolitiqueBanque;
  const conditions = data.conditions;
  const decision = data.decision;
  const dq = data.dataQuality;
  return (
    <div className="space-y-5">
      {fiche && (
        <section>
          <h4 className="text-sm font-bold uppercase tracking-wide mb-2" style={{ color: ACCENT_FIN }}>Fiche Dossier</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
            {Object.entries(fiche).map(([k, v]) => {
              const val = sn(v); if (!val) return null;
              return (<div key={k}><span className="text-gray-500 text-xs">{k.replace(/([A-Z])/g, " $1").trim()}</span><div className="font-medium text-gray-800">{val}</div></div>);
            })}
          </div>
        </section>
      )}
      {analyse && typeof analyse === "object" && (
        <section>
          <h4 className="text-sm font-bold uppercase tracking-wide mb-2" style={{ color: ACCENT_FIN }}>Analyse Crédit</h4>
          <div className="space-y-3">
            {Object.entries(analyse).map(([key, val]: [string, any]) => {
              if (!val) return null;
              const title = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
              if (typeof val === "string" && val.trim()) return (<div key={key}><h5 className="text-xs font-semibold text-gray-600 uppercase">{title}</h5><p className="text-sm text-gray-700 mt-0.5">{val}</p></div>);
              if (typeof val === "object" && !Array.isArray(val)) {
                const synthese = sn(val.synthese ?? val.resume ?? val.summary);
                const points: string[] = (val.points ?? val.items ?? val.risques ?? val.forces ?? []).map((x: any) => sn(x)).filter(Boolean);
                if (!synthese && points.length === 0) return null;
                return (<div key={key}><h5 className="text-xs font-semibold text-gray-600 uppercase">{title}</h5>{synthese && <p className="text-sm text-gray-700 mt-0.5">{synthese}</p>}{points.length > 0 && <StructuredBullets items={points} />}</div>);
              }
              if (Array.isArray(val)) { const items = val.map((x: any) => sn(x)).filter(Boolean); if (items.length === 0) return null; return (<div key={key}><h5 className="text-xs font-semibold text-gray-600 uppercase">{title}</h5><StructuredBullets items={items} /></div>); }
              return null;
            })}
          </div>
        </section>
      )}
      {conformite && (
        <section>
          <h4 className="text-sm font-bold uppercase tracking-wide mb-2" style={{ color: ACCENT_FIN }}>Conformité Politique Banque</h4>
          {typeof conformite === "string" ? <p className="text-sm text-gray-700">{conformite}</p>
            : typeof conformite === "object" && !Array.isArray(conformite) ? (
              <div className="space-y-1">{Object.entries(conformite).map(([k, v]) => { const val = sn(v); if (!val) return null; return (<div key={k} className="text-sm"><span className="text-gray-500 font-medium">{k.replace(/([A-Z])/g, " $1").trim()} :</span>{" "}<span className="text-gray-700">{val}</span></div>); })}</div>
            ) : <StructuredBullets items={conformite} />}
        </section>
      )}
      {conditions && typeof conditions === "object" && (
        <section>
          <h4 className="text-sm font-bold uppercase tracking-wide mb-2" style={{ color: ACCENT_FIN }}>Conditions</h4>
          {(conditions.precedentes || conditions.prealables || conditions.avant) && (
            <div className="mb-2"><h5 className="text-xs font-semibold text-gray-600">Conditions précédentes / préalables</h5><StructuredBullets items={conditions.precedentes ?? conditions.prealables ?? conditions.avant} color="amber" /></div>
          )}
          {(conditions.suivi || conditions.reporting || conditions.apres) && (
            <div><h5 className="text-xs font-semibold text-gray-600">Suivi / Reporting</h5><StructuredBullets items={conditions.suivi ?? conditions.reporting ?? conditions.apres} /></div>
          )}
          {Object.entries(conditions).filter(([k]) => !["precedentes", "prealables", "avant", "suivi", "reporting", "apres"].includes(k)).map(([k, v]) => {
            const items = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
            if (items.length === 0) return null;
            return (<div key={k} className="mt-2"><h5 className="text-xs font-semibold text-gray-600">{k.replace(/([A-Z])/g, " $1").trim()}</h5><StructuredBullets items={items} /></div>);
          })}
        </section>
      )}
      {decision && typeof decision === "object" && (
        <section>
          <h4 className="text-sm font-bold uppercase tracking-wide mb-2" style={{ color: ACCENT_FIN }}>Décision / Recommandation IA</h4>
          <div className="rounded-lg p-3 space-y-1" style={{ background: "rgba(38,166,154,0.07)", border: "1px solid #c0e8d4" }}>
            {sn(decision.recommandation ?? decision.recommendation) && <div className="text-sm"><span className="font-semibold" style={{ color: "#0a3d28" }}>Recommandation :</span>{" "}<span style={{ color: ACCENT_FIN }}>{sn(decision.recommandation ?? decision.recommendation)}</span></div>}
            {sn(decision.motivation) && <div className="text-sm"><span className="font-semibold text-gray-700">Motivation :</span>{" "}<span className="text-gray-600">{sn(decision.motivation)}</span></div>}
            {sn(decision.niveauConfiance ?? decision.confidence) && <div className="text-sm"><span className="font-semibold text-gray-700">Niveau de confiance :</span>{" "}<span className="text-gray-600">{sn(decision.niveauConfiance ?? decision.confidence)}</span></div>}
          </div>
        </section>
      )}
      {dq && (
        <section>
          <h4 className="text-sm font-bold text-amber-700 uppercase tracking-wide mb-2">Qualité des données</h4>
          {typeof dq === "string" ? <p className="text-sm text-gray-600 italic">{dq}</p>
            : Array.isArray(dq) ? <StructuredBullets items={dq} color="amber" />
              : typeof dq === "object" ? (
                <div className="space-y-1">{Object.entries(dq).map(([k, v]) => { const val = sn(v); if (!val) return null; return (<div key={k} className="text-sm"><span className="text-amber-700 font-medium">{k.replace(/([A-Z])/g, " $1").trim()} :</span>{" "}<span className="text-gray-600">{val}</span></div>); })}</div>
              ) : null}
        </section>
      )}
    </div>
  );
}

function renderStructuredNarrativePdf(
  doc: any, structured: any, startY: number, margin: number, contentWidth: number,
  contentBottom: number, newContentPage: () => void, checkPageFn: (need: number) => number,
): number {
  let y = startY;
  const LINE_H = 4;
  const cp = (need: number) => { y = checkPageFn(need); return y; };
  const pdfSubTitle = (title: string) => {
    cp(10); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.primary);
    doc.text(sanitize(title), margin + 2, y); y += 5; doc.setTextColor(...PDF_COLORS.dark);
  };
  const pdfBullets = (items: any[]) => {
    for (const item of items.map((x: any) => sn(x)).filter(Boolean)) {
      cp(6);
      const lines: string[] = doc.splitTextToSize(`- ${sanitize(item)}`, contentWidth - 8);
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark);
      for (const line of lines) { cp(5); doc.text(line, margin + 4, y); y += LINE_H; }
    }
    y += 2;
  };
  const pdfParagraph = (text: string) => {
    if (!text.trim()) return;
    const lines: string[] = doc.splitTextToSize(sanitize(text), contentWidth - 4);
    doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark);
    for (const line of lines) { cp(5); doc.text(line, margin + 2, y); y += LINE_H; }
    y += 2;
  };
  const pdfKv = (label: string, value: string) => {
    if (!value.trim()) return;
    cp(6); doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark);
    doc.text(sanitize(label) + " : ", margin + 4, y);
    const labelW = doc.getTextWidth(sanitize(label) + " : ");
    doc.setFont("helvetica", "normal"); doc.text(sanitize(value), margin + 4 + labelW, y);
    y += LINE_H + 1;
  };
  if (structured.ficheDossier && typeof structured.ficheDossier === "object") {
    pdfSubTitle("FICHE DOSSIER");
    for (const [k, v] of Object.entries(structured.ficheDossier)) { const val = sn(v); if (val) pdfKv(k.replace(/([A-Z])/g, " $1").trim(), val); }
    y += 3;
  }
  if (structured.analyseCredit && typeof structured.analyseCredit === "object") {
    pdfSubTitle("ANALYSE CREDIT");
    for (const [key, val] of Object.entries(structured.analyseCredit) as [string, any][]) {
      if (!val) continue;
      const title = key.replace(/([A-Z])/g, " $1").replace(/^./, (c: string) => c.toUpperCase()).trim();
      cp(8); doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark);
      doc.text(sanitize(title), margin + 3, y); y += 4; doc.setFont("helvetica", "normal");
      if (typeof val === "string") pdfParagraph(val);
      else if (typeof val === "object" && !Array.isArray(val)) {
        const synthese = sn(val.synthese ?? val.resume ?? val.summary);
        if (synthese) pdfParagraph(synthese);
        const points: any[] = val.points ?? val.items ?? val.risques ?? val.forces ?? [];
        if (Array.isArray(points) && points.length > 0) pdfBullets(points);
      } else if (Array.isArray(val)) pdfBullets(val);
    }
    y += 2;
  }
  if (structured.conformitePolitiqueBanque) {
    pdfSubTitle("CONFORMITE POLITIQUE BANQUE");
    const c = structured.conformitePolitiqueBanque;
    if (typeof c === "string") pdfParagraph(c);
    else if (Array.isArray(c)) pdfBullets(c);
    else if (typeof c === "object") { for (const [k, v] of Object.entries(c)) pdfKv(k.replace(/([A-Z])/g, " $1").trim(), sn(v)); }
    y += 2;
  }
  if (structured.conditions && typeof structured.conditions === "object") {
    pdfSubTitle("CONDITIONS");
    const cond = structured.conditions;
    const prealables = cond.precedentes ?? cond.prealables ?? cond.avant;
    const suivi = cond.suivi ?? cond.reporting ?? cond.apres;
    if (prealables) {
      cp(6); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text("Conditions prealables :", margin + 3, y); y += 4; doc.setFont("helvetica", "normal");
      pdfBullets(Array.isArray(prealables) ? prealables : [prealables]);
    }
    if (suivi) {
      cp(6); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text("Suivi / Reporting :", margin + 3, y); y += 4; doc.setFont("helvetica", "normal");
      pdfBullets(Array.isArray(suivi) ? suivi : [suivi]);
    }
    const knownKeys = ["precedentes", "prealables", "avant", "suivi", "reporting", "apres"];
    for (const [k, v] of Object.entries(cond)) {
      if (knownKeys.includes(k)) continue;
      const items = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
      if (items.length === 0) continue;
      cp(6); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text(sanitize(k.replace(/([A-Z])/g, " $1").trim()) + " :", margin + 3, y); y += 4;
      doc.setFont("helvetica", "normal"); pdfBullets(items);
    }
    y += 2;
  }
  if (structured.decision && typeof structured.decision === "object") {
    pdfSubTitle("DECISION / RECOMMANDATION IA");
    const d = structured.decision;
    if (sn(d.recommandation ?? d.recommendation)) pdfKv("Recommandation", sn(d.recommandation ?? d.recommendation));
    if (sn(d.motivation)) pdfKv("Motivation", sn(d.motivation));
    if (sn(d.niveauConfiance ?? d.confidence)) pdfKv("Niveau de confiance", sn(d.niveauConfiance ?? d.confidence));
    y += 3;
  }
  if (structured.dataQuality) {
    pdfSubTitle("QUALITE DES DONNEES");
    const dq = structured.dataQuality;
    if (typeof dq === "string") pdfParagraph(dq);
    else if (Array.isArray(dq)) pdfBullets(dq);
    else if (typeof dq === "object") { for (const [k, v] of Object.entries(dq)) pdfKv(k.replace(/([A-Z])/g, " $1").trim(), sn(v)); }
    y += 2;
  }
  return y;
}

// ════════════════════════════════════════════════════════════════════
// PDF-ONLY: LOCAL FALLBACKS
// ════════════════════════════════════════════════════════════════════

interface CommitteePresentationBullets { label: string; items: string[]; }
interface CommitteePresentation { title: string; paragraphs: string[]; bullets?: CommitteePresentationBullets[]; }

function buildCommitteePresentation(report: UniversalReport): CommitteePresentation {
  const ss = report.smartscore;
  const ms = report.marketStudy;
  const allMissing = report.missing ?? [];
  const blockers = allMissing.filter(m => m.severity === "blocker");
  const warns = allMissing.filter(m => m.severity === "warn");
  const pillars = ss?.pillars ?? [];
  const evaluated = pillars.filter(p => p.hasData);
  const naPillars = pillars.filter(p => !p.hasData);
  const strengths = [...evaluated].sort((a, b) => b.rawScore - a.rawScore).slice(0, 3);
  const weaknesses = [...evaluated].sort((a, b) => a.rawScore - b.rawScore).slice(0, 3);
  const recommendations = ss?.recommendations ?? [];
  const risques = report.risques;
  const paragraphs: string[] = [];
  const bullets: CommitteePresentationBullets[] = [];
  const dscrVal = kpiNum(report.kpis["DSCR"]);
  const ltvVal = kpiNum(report.kpis["LTV"]);
  const marketScore = ms?.scoreGlobal;
  {
    const emprunteur = report.emprunteur;
    const adresse = report.projet["Adresse"] ?? "";
    const opType = report.projet["Type d'operation"] ?? "";
    const assetType = report.projet["Type d'actif"] ?? "";
    const strategy = report.revenus["Strategie"] ?? "";
    const surface = report.projet["Surface"] ?? "";
    let intro = `Le present dossier concerne une operation de type ${opType || "immobilier"} portee par ${emprunteur.identite} (${emprunteur.type === "personne_morale" ? "personne morale" : emprunteur.type === "personne_physique" ? "personne physique" : "porteur de projet"}).`;
    if (adresse) intro += ` Le bien est situe ${adresse}`;
    if (surface) intro += `, pour une surface de ${surface}`;
    intro += ".";
    if (assetType) intro += ` L'actif vise est de type ${assetType}.`;
    if (strategy) intro += ` La strategie retenue est : ${strategy.toLowerCase()}.`;
    paragraphs.push(intro);
  }
  {
    const parts: string[] = [];
    if (marketScore !== null) {
      if (marketScore >= 75) parts.push(`Le marche local presente un profil tres favorable (score ${marketScore}/100).`);
      else if (marketScore >= 60) parts.push(`Le marche local est favorable (score ${marketScore}/100).`);
      else if (marketScore >= 40) parts.push(`Le marche local est dans une situation intermediaire (score ${marketScore}/100).`);
      else parts.push(`Le marche local presente un profil tendu ou defavorable (score ${marketScore}/100).`);
    }
    if (ms?.dvf) {
      const median = ms.dvf.medianPriceM2; const txCount = ms.dvf.transactionCount;
      if (median !== null && txCount !== null) {
        const liquidity = txCount >= 50 ? "un marche liquide" : txCount >= 20 ? "un volume de transactions correct" : "un volume de transactions limite";
        parts.push(`L'analyse DVF fait ressortir un prix median de ${Math.round(median)} EUR/m2 sur ${liquidity} (${txCount} transactions).`);
      }
    }
    if (parts.length > 0) paragraphs.push(parts.join(" "));
    else paragraphs.push("Les donnees de marche disponibles sont insuffisantes pour etablir une analyse approfondie.");
  }
  {
    const parts: string[] = [];
    const total = report.budget["TOTAL"]; const pret = report.financement["Montant pret"]; const apport = report.financement["Apport personnel"];
    if (total && pret) parts.push(`L'operation represente un cout total de ${total}, pour un financement demande de ${pret}${apport ? `, soit un apport de ${apport}` : ""}.`);
    if (ltvVal !== null) {
      if (ltvVal <= 40) parts.push(`Le ratio LTV de ${ltvVal}% traduit une structure prudente.`);
      else if (ltvVal <= 60) parts.push(`Le ratio LTV s'etablit a ${ltvVal}%, dans les standards bancaires habituels.`);
      else if (ltvVal <= 80) parts.push(`Le LTV de ${ltvVal}% se situe dans la fourchette haute.`);
      else parts.push(`Le LTV de ${ltvVal}% excede les seuils de confort habituels.`);
    }
    if (dscrVal !== null) {
      if (dscrVal >= 1.5) parts.push(`Le DSCR de ${dscrVal.toFixed(2)} est confortable.`);
      else if (dscrVal >= 1.2) parts.push(`Le DSCR de ${dscrVal.toFixed(2)} est satisfaisant.`);
      else if (dscrVal >= 1.0) parts.push(`Le DSCR de ${dscrVal.toFixed(2)} est juste suffisant.`);
      else parts.push(`Le DSCR de ${dscrVal.toFixed(2)} est insuffisant — les revenus ne couvrent pas le service de la dette.`);
    }
    if (parts.length > 0) paragraphs.push(parts.join(" "));
    else paragraphs.push("Les donnees financieres disponibles sont insuffisantes pour mener une analyse approfondie.");
  }
  {
    const parts: string[] = [];
    const presentRisks = risques.items.filter(r => r.status === "present");
    const highRisks = presentRisks.filter(r => r.level === "eleve" || r.level === "élevé");
    if (presentRisks.length === 0) parts.push("L'analyse georisques ne fait apparaitre aucun risque identifie.");
    else if (highRisks.length > 0) parts.push(`L'analyse georisques identifie ${highRisks.length} risque(s) de niveau eleve.`);
    else parts.push(`L'analyse georisques fait ressortir ${presentRisks.length} risque(s) de niveau modere.`);
    paragraphs.push(parts.join(" "));
  }
  if (strengths.length > 0) bullets.push({ label: "Forces du dossier", items: strengths.map(p => { const reason = p.reasons.length > 0 ? p.reasons[0] : ""; return `${p.label} (${p.rawScore}/100)${reason ? ` : ${reason}` : ""}`; }) });
  if (weaknesses.length > 0 || naPillars.length > 0) {
    const weakItems: string[] = weaknesses.map(p => `${p.label} (${p.rawScore}/100)`);
    if (naPillars.length > 0) weakItems.push(`Piliers non documentes : ${naPillars.map(p => p.label).join(", ")}`);
    bullets.push({ label: "Faiblesses et points d'attention", items: weakItems });
  }
  {
    const dscrLow = dscrVal !== null && dscrVal < 1; const ltvHigh = ltvVal !== null && ltvVal > 80;
    let decision: string; let motivation: string;
    if (dscrLow) { decision = "NO GO en l'etat"; motivation = "Les revenus previsionnels ne couvrent pas le service de la dette."; }
    else if (blockers.length > 0 && ltvHigh) { decision = "Reserve"; motivation = "Combinaison de donnees manquantes bloquantes et de levier eleve."; }
    else if (blockers.length > 0) { decision = "GO sous conditions"; motivation = `${blockers.length} element(s) bloquant(s) a lever avant engagement.`; }
    else if (ss && ss.score >= 65) { decision = "GO"; motivation = `SmartScore de ${ss.score}/100 (${ss.grade}) — conditions standard.`; }
    else if (ss && ss.score >= 40) { decision = "GO sous conditions"; motivation = `SmartScore intermediaire de ${ss.score}/100 (${ss.grade}).`; }
    else { decision = "Reserve"; motivation = "Le dossier necessite des complements significatifs."; }
    paragraphs.push(`DECISION : ${decision}`);
    paragraphs.push(`Motivation : ${motivation}`);
  }
  {
    const conditions: string[] = [];
    for (const b of blockers) conditions.push(`[Prealable] ${b.label}`);
    for (const w of warns) conditions.push(`[A fournir] ${w.label}`);
    for (const r of recommendations) conditions.push(r);
    if (naPillars.length > 0) conditions.push(`Documenter : ${naPillars.map(p => p.label).join(", ")}`);
    if (conditions.length > 0) bullets.push({ label: "Conditions prealables et de suivi", items: conditions });
  }
  return { title: `Note de synthese - Dossier ${report.meta.dossierRef}`, paragraphs, bullets: bullets.length > 0 ? bullets : undefined };
}

interface DecisionScenario {
  label: string; tag: string; riskReading: string;
  favorable: string[]; unfavorable: string[];
  decision: string; motivation: string; conditions: string[];
}
interface DecisionScenarios {
  conservative: DecisionScenario; balanced: DecisionScenario; opportunistic: DecisionScenario;
}

function buildDecisionScenarios(report: UniversalReport): DecisionScenarios {
  const ss = report.smartscore;
  const ms = report.marketStudy;
  const allMissing = report.missing ?? [];
  const blockers = allMissing.filter(m => m.severity === "blocker");
  const warns = allMissing.filter(m => m.severity === "warn");
  const pillars = ss?.pillars ?? [];
  const naPillars = pillars.filter(p => !p.hasData);
  const evaluated = pillars.filter(p => p.hasData);
  const strengths = [...evaluated].sort((a, b) => b.rawScore - a.rawScore).slice(0, 3);
  const weaknesses = [...evaluated].sort((a, b) => a.rawScore - b.rawScore).slice(0, 3);
  const risques = report.risques;
  const presentRisks = risques.items.filter(r => r.status === "present");
  const highRisks = presentRisks.filter(r => r.level === "eleve" || r.level === "élevé");
  const dscrVal = kpiNum(report.kpis["DSCR"]);
  const ltvVal = kpiNum(report.kpis["LTV"]);
  const marketScore = ms?.scoreGlobal ?? null;
  const score = ss?.score ?? 0;
  const grade = ss?.grade ?? "-";
  const hasGarantiesNA = naPillars.some(p => p.label.toLowerCase().includes("garantie") || p.label.toLowerCase().includes("surete"));
  const hasAnyNA = naPillars.length > 0;
  const geoRiskLow = highRisks.length === 0;
  const commonFavorable: string[] = [];
  const commonUnfavorable: string[] = [];
  if (dscrVal !== null && dscrVal >= 1.2) commonFavorable.push(`DSCR satisfaisant (${dscrVal.toFixed(2)})`);
  if (ltvVal !== null && ltvVal <= 50) commonFavorable.push(`LTV contenu (${ltvVal}%)`);
  if (marketScore !== null && marketScore >= 60) commonFavorable.push(`Marche porteur (${marketScore}/100)`);
  if (geoRiskLow && presentRisks.length <= 2) commonFavorable.push("Exposition georisques faible");
  for (const p of strengths) { if (p.rawScore >= 70) commonFavorable.push(`${p.label} : ${p.rawScore}/100`); }
  if (dscrVal !== null && dscrVal < 1) commonUnfavorable.push(`DSCR insuffisant (${dscrVal.toFixed(2)})`);
  if (ltvVal !== null && ltvVal > 70) commonUnfavorable.push(`LTV eleve (${ltvVal}%)`);
  if (marketScore !== null && marketScore < 40) commonUnfavorable.push(`Marche defavorable (${marketScore}/100)`);
  if (!geoRiskLow) commonUnfavorable.push(`${highRisks.length} risque(s) georisques eleve(s)`);
  if (hasGarantiesNA) commonUnfavorable.push("Garanties non documentees");
  if (blockers.length > 0) commonUnfavorable.push(`${blockers.length} donnee(s) bloquante(s)`);
  for (const p of weaknesses) { if (p.rawScore < 40) commonUnfavorable.push(`${p.label} : ${p.rawScore}/100`); }
  const conservative: DecisionScenario = (() => {
    const isNoGo = (dscrVal !== null && dscrVal < 1) || hasGarantiesNA || blockers.length >= 2;
    const isGoCondStrict = !isNoGo && (blockers.length > 0 || hasAnyNA || (ltvVal !== null && ltvVal > 60));
    let decision: string; let motivation: string; const conditions: string[] = [];
    if (isNoGo) { decision = "NO GO"; const reasons: string[] = []; if (dscrVal !== null && dscrVal < 1) reasons.push("DSCR < 1"); if (hasGarantiesNA) reasons.push("garanties non documentees"); if (blockers.length >= 2) reasons.push(`${blockers.length} donnees bloquantes`); motivation = `En lecture conservatrice, le dossier est refuse. Motifs : ${reasons.join(", ")}.`; }
    else if (isGoCondStrict) { decision = "GO sous conditions strictes"; motivation = "Zones d'ombre significatives."; for (const b of blockers) conditions.push(`[Prealable] ${b.label}`); if (hasAnyNA) conditions.push(`Documenter : ${naPillars.map(p => p.label).join(", ")}`); if (ltvVal !== null && ltvVal > 60) conditions.push("Reduire LTV sous 60%"); for (const w of warns) conditions.push(w.label); }
    else { decision = "GO"; motivation = `Dossier solide en lecture conservatrice. SmartScore ${score}/100 (${grade}).`; }
    return { label: "Conservateur", tag: "conservative", riskReading: "Lecture prudente, protection maximale de la banque.", favorable: commonFavorable.length > 0 ? commonFavorable : ["Aucun point favorable majeur"], unfavorable: commonUnfavorable.length > 0 ? commonUnfavorable : ["Aucun point defavorable majeur"], decision, motivation, conditions };
  })();
  const balanced: DecisionScenario = (() => {
    const goFull = ltvVal !== null && ltvVal < 40 && marketScore !== null && marketScore > 60 && blockers.length === 0 && (dscrVal === null || dscrVal >= 1.2);
    const isNoGo = dscrVal !== null && dscrVal < 1 && blockers.length >= 2;
    let decision: string; let motivation: string; const conditions: string[] = [];
    if (goFull) { decision = "GO"; motivation = `Dossier reunissant les conditions d'engagement. SmartScore ${score}/100 (${grade}).`; }
    else if (isNoGo) { decision = "NO GO"; motivation = `Cumul DSCR insuffisant et donnees bloquantes.`; }
    else { decision = "GO sous conditions"; motivation = `Dossier recevable en lecture equilibree. SmartScore ${score}/100 (${grade}).`; for (const b of blockers) conditions.push(`[Prealable] ${b.label}`); for (const w of warns) conditions.push(w.label); if (hasAnyNA) conditions.push(`Documenter : ${naPillars.map(p => p.label).join(", ")}`); }
    return { label: "Equilibre", tag: "balanced", riskReading: "Lecture ponderee, approche standard d'un comite credit.", favorable: commonFavorable.length > 0 ? commonFavorable : ["Aucun point favorable majeur"], unfavorable: commonUnfavorable.length > 0 ? commonUnfavorable : ["Aucun point defavorable majeur"], decision, motivation, conditions };
  })();
  const opportunistic: DecisionScenario = (() => {
    const goPatri = ltvVal !== null && ltvVal < 50 && geoRiskLow;
    let decision: string; let motivation: string; const conditions: string[] = [];
    if (goPatri) { decision = "GO patrimonial"; motivation = `Profil patrimonial interessant : LTV ${ltvVal}%, georisques faibles.`; for (const w of warns) conditions.push(w.label); }
    else { decision = "GO sous conditions"; motivation = "Dossier engageable sans profil patrimonial optimal."; for (const b of blockers) conditions.push(`[Prealable] ${b.label}`); for (const w of warns) conditions.push(w.label); }
    return { label: "Opportuniste", tag: "opportunistic", riskReading: "Lecture orientee creation de valeur long terme.", favorable: commonFavorable.length > 0 ? commonFavorable : ["Aucun point favorable majeur"], unfavorable: commonUnfavorable.length > 0 ? commonUnfavorable : ["Aucun point defavorable majeur"], decision, motivation, conditions };
  })();
  return { conservative, balanced, opportunistic };
}

// ════════════════════════════════════════════════════════════════════
// ─── COVER — Cibles monochromes teal profond ────────────────────────
// ════════════════════════════════════════════════════════════════════

async function addComiteCover(
  doc: any,
  report: UniversalReport,
  _dossier: any,
  pageWidth: number,
  pageHeight: number,
  margin: number,
): Promise<void> {
  // ── Palette ───────────────────────────────────────────────────────
  const BG:         [number, number, number] = [0,   86,  94 ]; // #00565e fond principal
  const CYAN:       [number, number, number] = [0,  229, 255 ]; // #00e5ff accent cyan vif
  const C1:         [number, number, number] = [0,   77,  90 ]; // #004d5a cercle ext.
  const C2:         [number, number, number] = [0,   96, 100 ]; // #006064
  const C3:         [number, number, number] = [0,  131, 143 ]; // #00838f
  const C4:         [number, number, number] = [0,  172, 193 ]; // #00acc1 cercle int.
  const WHITE:      [number, number, number] = [255, 255, 255];
  const PALE:       [number, number, number] = [224, 247, 250]; // #e0f7fa badge bg
  const GRAY:       [number, number, number] = [96,  120, 128]; // texte gris
  const MUTED_W:    [number, number, number] = [180, 210, 216]; // blanc atténué
  const VERY_MUTED: [number, number, number] = [155, 180, 188]; // très atténué

  const ss    = report.smartscore;
  const score = ss?.score ?? null;
  const grade = ss?.grade ?? null;

  const scoreColor: [number, number, number] =
    score === null ? GRAY
    : score >= 65  ? [22, 163, 74]
    : score >= 40  ? [230, 126, 34]
                   : [220, 38,  38];

  const gradeColor: [number, number, number] =
    grade === null                                       ? GRAY
    : (grade === "A" || grade === "A+" || grade === "B") ? [22, 163, 74]
    : grade === "C"                                      ? [16, 185, 129]
    : (grade === "D" || grade === "D+")                  ? [230, 126, 34]
                                                         : [220, 38,  38];

  // ── Fond principal ────────────────────────────────────────────────
  doc.setFillColor(...BG);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // ── Cercles concentriques — cibles haut-droite ────────────────────
  const cx = pageWidth  * 0.914; // ≈ 192mm
  const cy = pageHeight * 0.242; // ≈ 72mm
  doc.setFillColor(...C1); doc.circle(cx, cy, 88, "F");
  doc.setFillColor(...C2); doc.circle(cx, cy, 62, "F");
  doc.setFillColor(...C3); doc.circle(cx, cy, 38, "F");
  doc.setFillColor(...C4); doc.circle(cx, cy, 18, "F");

  // ── Barre verticale gauche ────────────────────────────────────────
  doc.setFillColor(...CYAN);
  doc.rect(0, 0, 6, pageHeight, "F");

  // ── Marque MIMMOZA (discret, haut) ───────────────────────────────
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(80, 140, 150);
  doc.text("MIMMOZA", margin, 13);

  // ── Badge type document ──────────────────────────────────────────
  doc.setFillColor(...C1);
  doc.roundedRect(margin, 19, 66, 9, 2, 2, "F");
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...CYAN);
  doc.text("COMITE DE CREDIT", margin + 3, 25.5);

  // ── Grand titre RAPPORT — une seule ligne (64pt) ──────────────────
  doc.setFontSize(64);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text("RAPPORT", margin, 126);

  // ── Sous-titre COMITÉ lettres espacées ───────────────────────────
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...CYAN);
  doc.text("C  O  M  I  T  E", margin, 140);

  // ── Séparateur ───────────────────────────────────────────────────
  doc.setFillColor(...C4);
  doc.rect(margin, 146, 80, 0.7, "F");

  // ── Infos dossier ─────────────────────────────────────────────────
  const dossierLabel = sanitize(report.meta.dossierLabel || "Dossier");
  const adresse      = sanitize(report.projet["Adresse"] || "");
  const dossierRef   = sanitize(report.meta.dossierRef || "-");
  const genDate      = new Date(report.generatedAt).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });

  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_W);
  doc.text("Dossier", margin, 157);

  const labelLines = doc.splitTextToSize(dossierLabel, pageWidth * 0.56) as string[];
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text(labelLines.slice(0, 2), margin, 166);

  if (adresse) {
    const addrY = 166 + labelLines.slice(0, 2).length * 7;
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED_W);
    doc.text(sanitize(adresse), margin, addrY);
  }

  // ── Emprunteur ───────────────────────────────────────────────────
  const empIdentite = sanitize(report.emprunteur?.identite || "");
  if (empIdentite && empIdentite !== "Non renseigne") {
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...VERY_MUTED);
    doc.text("Emprunteur", margin, 200);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(210, 232, 236);
    doc.text(empIdentite, margin, 209);
  }

  // ── Bloc blanc bas ────────────────────────────────────────────────
  const WY = 240;
  doc.setFillColor(...WHITE);
  doc.rect(0, WY, pageWidth, pageHeight - WY, "F");
  doc.setFillColor(...CYAN);
  doc.rect(0, WY, 6, pageHeight - WY, "F");

  // Ref + date
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text("Ref. " + dossierRef, margin, 253);
  doc.text(genDate, margin, 262);

  // ── Badge SmartScore ──────────────────────────────────────────────
  // Nombre (13pt) + /100 (6.5pt) bien séparés, sans chevauchement
  doc.setFillColor(...PALE);
  doc.roundedRect(118, 245, 38, 24, 3, 3, "F");
  doc.setFontSize(5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text("SMARTSCORE", 137, 252, { align: "center" });
  if (score !== null) {
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...scoreColor);
    doc.text(String(score), 127, 263);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text("/100", 136, 263);
  } else {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text("N/A", 137, 263, { align: "center" });
  }

  // ── Badge Grade — même taille (13pt) que le score ─────────────────
  doc.setFillColor(...PALE);
  doc.roundedRect(162, 245, 30, 24, 3, 3, "F");
  doc.setFontSize(5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text("GRADE", 177, 252, { align: "center" });
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gradeColor);
  doc.text(grade ?? "-", 177, 263, { align: "center" });

  // ── Pied MIMMOZA + confidentiel ───────────────────────────────────
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BG);
  doc.text("MIMMOZA", margin, 278);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...VERY_MUTED);
  doc.text("Intelligence immobiliere B2B", margin, 285);
  doc.text("Confidentiel — Usage interne exclusif", pageWidth - margin, 285, { align: "right" });
}

// ════════════════════════════════════════════════════════════════════
// PDF EXPORT
// ════════════════════════════════════════════════════════════════════

async function exportReportPdf(report: UniversalReport, dossier: any, narrative?: CommitteeNarrative | null): Promise<void> {
  const jspdfMod = await import("jspdf");
  const jsPDF = (jspdfMod as any).jsPDF ?? (jspdfMod as any).default;
  if (!jsPDF) throw new Error("jsPDF import failed");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = (autoTableMod as any).default ?? (autoTableMod as any);
  if (typeof autoTable !== "function") throw new Error("autoTable import failed");

  const doc = new jsPDF("p", "mm", "a4") as any;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  const dossierRef = sanitize(report.meta.dossierRef);
  const dossierLabel = sanitize(report.meta.dossierLabel);
  const generatedDate = new Date(report.generatedAt).toLocaleDateString("fr-FR");
  const headerY = 12; const footerY = pageHeight - 8;
  const contentTop = 22; const contentBottom = pageHeight - 15;

  function drawHeaderFooter(pageNum: number) {
    doc.setDrawColor(...PDF_COLORS.primaryLight); doc.setLineWidth(0.5);
    doc.line(margin, headerY + 3, pageWidth - margin, headerY + 3);
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium);
    doc.text(`Rapport Comite  |  ${dossierRef} - ${dossierLabel}`, margin, headerY);
    doc.text(generatedDate, pageWidth - margin, headerY, { align: "right" });
    doc.setDrawColor(...PDF_COLORS.light); doc.setLineWidth(0.3);
    doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3);
    doc.setFontSize(7); doc.setTextColor(...PDF_COLORS.medium);
    doc.text("MIMMOZA  -  Document confidentiel", margin, footerY);
    doc.text(`Page ${pageNum}`, pageWidth - margin, footerY, { align: "right" });
  }

  let currentPage = 0;
  function newContentPage(skipHeaderFooter = false) {
    if (currentPage > 0) doc.addPage();
    currentPage++;
    y = skipHeaderFooter ? 0 : contentTop;
    if (!skipHeaderFooter) drawHeaderFooter(currentPage);
  }
  function checkPage(need: number): number { if (y + need > contentBottom) newContentPage(); return y; }
  function sectionTitle(title: string) {
    checkPage(14); doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.primary);
    doc.text(sanitize(title), margin, y); y += 2;
    doc.setDrawColor(...PDF_COLORS.primaryLight); doc.setLineWidth(0.4);
    doc.line(margin, y, margin + contentWidth * 0.4, y); y += 5; doc.setTextColor(...PDF_COLORS.dark);
  }
  function subTitle(title: string) {
    checkPage(10); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark);
    doc.text(sanitize(title), margin + 2, y); y += 5;
  }
  const tableDefaults = {
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2, textColor: PDF_COLORS.dark, lineColor: [235, 235, 240] as [number,number,number], lineWidth: 0.15 },
    headStyles: { fillColor: PDF_COLORS.primaryLight, textColor: PDF_COLORS.white, fontStyle: "bold" as const, fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 248, 252] as [number,number,number] },
    theme: "striped" as const,
  };

  // ── COVER PAGE ────────────────────────────────────────────────────
  newContentPage(true);
  await addComiteCover(doc, report, dossier, pageWidth, pageHeight, margin);

  // ── BUILD ENGINE INPUT ────────────────────────────────────────────
  const msC = report.marketStudy;
  const ssC = report.smartscore;
  const pdfEngineInput: EngineReportInput = {
    programmeNom: report.meta.dossierLabel, adresse: report.projet["Adresse"],
    marketStudy: msC ? {
      commune: msC.insee.commune !== "-" ? msC.insee.commune : undefined,
      departement: undefined,
      dvf: { prixM2Median: msC.dvf.medianPriceM2 ?? undefined, nbTransactions: msC.dvf.transactionCount ?? undefined, evolution: msC.dvf.evolutionPct ?? undefined },
      insee: { population: safeNumber(msC.insee.population) ?? undefined, revenuMedian: safeNumber(msC.insee.revenuMedian) ?? undefined, tauxChomage: safeNumber(msC.insee.tauxChomage) ?? undefined, densitePopulation: safeNumber(msC.insee.densite) ?? undefined },
      bpe: { nbEquipements: safeNumber(msC.bpe.totalEquipements) ?? undefined },
      transport: { nbStations: msC.transport.items.length > 0 ? msC.transport.items.length : undefined, distanceCentre: undefined },
      insights: msC.insights.map((i) => ({ label: i.message, value: "" as string | number, sentiment: (i.type === "positive" ? "positive" : i.type === "warning" ? "negative" : "neutral") as "positive" | "negative" | "neutral" })),
    } : undefined,
    smartscore: ssC ? { score: ssC.score, verdict: ssC.verdict, pillars: ssC.pillars.map((p) => ({ id: p.key, label: p.label, score: p.rawScore })) } : undefined,
    kpis: { ltv: kpiNum(report.kpis["LTV"]) ?? undefined, dscr: kpiNum(report.kpis["DSCR"]) ?? undefined, loyerAnnuel: parseMoneyK(report.revenus["Loyer annuel"]) ?? undefined, coutTotal: parseMoneyK(report.budget["TOTAL"]) ?? undefined, margeBrute: kpiNum(report.kpis["Marge brute"]) ?? undefined, tauxEndettement: undefined },
    missing: (report.missing ?? []).map((m) => m.label),
  };

  // ── TABLEAU DE BORD COMITE ────────────────────────────────────────
  {
    const dbAcceptance = buildAcceptanceProbability(pdfEngineInput);
    const dbMatrix = buildRiskReturnMatrix(pdfEngineInput);
    const dbStress = buildStressTests(pdfEngineInput);
    const dbSs = report.smartscore;

    newContentPage();
    sectionTitle("TABLEAU DE BORD COMITE");

    const colGap = 5;
    const cardW = (contentWidth - colGap) / 2;
    const cardR = 2.5;
    const cardPad = 4;

    function drawCard(cx: number, cy: number, w: number, h: number, title: string, accent: [number,number,number] = PDF_COLORS.primaryLight): number {
      doc.setFillColor(248, 248, 252); doc.setDrawColor(230, 230, 235); doc.setLineWidth(0.25);
      doc.roundedRect(cx, cy, w, h, cardR, cardR, "FD");
      doc.setFillColor(...accent); doc.rect(cx, cy + cardR, 1.8, h - cardR * 2, "F");
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(...accent);
      doc.text(title.toUpperCase(), cx + cardPad + 1, cy + 5.5);
      return cy + 10;
    }
    function drawPill(px: number, py: number, label: string, color: [number,number,number]) {
      // ⚠️ setFontSize AVANT getTextWidth pour mesurer à la bonne taille
      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      const pillW = doc.getTextWidth(label) + 6; const pillH = 5.5;
      doc.setFillColor(...color); doc.roundedRect(px, py - 4, pillW, pillH, 2.5, 2.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(label, px + 3, py - 0.5); return pillW;
    }
    function naText(cx: number, iy: number) {
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium);
      doc.text("Non disponible", cx + cardPad + 1, iy + 6);
    }

    const r1H = 40; const r1Y = y;
    {
      const cx = margin; const iy = drawCard(cx, r1Y, cardW, r1H, "SmartScore");
      if (dbSs) {
        const sc: [number,number,number] = dbSs.score >= 65 ? PDF_COLORS.green : dbSs.score >= 40 ? PDF_COLORS.amber : PDF_COLORS.red;
        doc.setFontSize(24); doc.setFont("helvetica", "bold"); doc.setTextColor(...sc);
        doc.text(`${dbSs.score}`, cx + cardPad + 1, iy + 7);
        const nw = doc.getTextWidth(`${dbSs.score}`);
        doc.setFontSize(9); doc.setTextColor(...PDF_COLORS.medium); doc.text("/100", cx + cardPad + 1 + nw + 1, iy + 7);
        doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.primary);
        doc.text(`Grade ${dbSs.grade}`, cx + cardPad + 40, iy + 3);
        doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark);
        const vLines: string[] = doc.splitTextToSize(sanitize(dbSs.verdict), cardW - 48);
        let vy = iy + 8; for (const vl of vLines.slice(0, 2)) { doc.text(vl, cx + cardPad + 40, vy); vy += 3.5; }
        doc.setFontSize(6.5); doc.setTextColor(...PDF_COLORS.medium);
        doc.text(`${dbSs.pillars.filter((p: any) => p.hasData).length}/${dbSs.pillars.length} piliers`, cx + cardPad + 1, iy + 15);
      } else { naText(cx, iy); }
    }
    {
      const cx = margin + cardW + colGap; const iy = drawCard(cx, r1Y, cardW, r1H, "Probabilite d'acceptation");
      if (dbAcceptance) {
        const ac: [number,number,number] = dbAcceptance.score >= 70 ? PDF_COLORS.green : dbAcceptance.score >= 40 ? PDF_COLORS.amber : PDF_COLORS.red;
        doc.setFontSize(24); doc.setFont("helvetica", "bold"); doc.setTextColor(...ac);
        doc.text(`${dbAcceptance.score}%`, cx + cardPad + 1, iy + 7);
        const decLabel = dbAcceptance.score >= 70 ? "GO" : dbAcceptance.score >= 40 ? "GO SOUS CONDITIONS" : "NO GO";
        drawPill(cx + cardPad + 40, iy + 5, decLabel, ac);
        const top3 = [...dbAcceptance.drivers].sort((a: any, b: any) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
        let dy = iy + 13; doc.setFontSize(6.5);
        for (const d of top3) {
          const dc: [number,number,number] = d.impact > 0 ? PDF_COLORS.green : d.impact < 0 ? PDF_COLORS.red : PDF_COLORS.medium;
          const sign = d.impact > 0 ? "+" : "";
          doc.setFont("helvetica", "bold"); doc.setTextColor(...dc); doc.text(`${sign}${d.impact}`, cx + cardPad + 1, dy);
          doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); doc.text(sanitize(d.label), cx + cardPad + 13, dy); dy += 3.5;
        }
      } else { naText(cx, iy); }
    }
    y = r1Y + r1H + 4;

    const r2H = 34; const r2Y = y;
    {
      const cx = margin; const iy = drawCard(cx, r2Y, cardW, r2H, "Matrice Risque / Rendement");
      if (dbMatrix) {
        const qLow = dbMatrix.quadrant.toLowerCase();
        const qc: [number,number,number] = qLow.includes("optimal") || qLow.includes("favorable") ? PDF_COLORS.green : qLow.includes("vigilance") || qLow.includes("attention") ? PDF_COLORS.amber : qLow.includes("defavorable") || qLow.includes("critique") ? PDF_COLORS.red : PDF_COLORS.primary;
        drawPill(cx + cardPad + 1, iy + 3, sanitize(dbMatrix.quadrant), qc);
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark);
        doc.text(`Risque ${dbMatrix.riskScore}/100`, cx + cardPad + 1, iy + 10);
        doc.text(`Rendement ${dbMatrix.returnScore}/100`, cx + cardPad + 45, iy + 10);
        if (dbMatrix.commentary) { doc.setFontSize(6.5); doc.setTextColor(...PDF_COLORS.medium); const cl: string[] = doc.splitTextToSize(sanitize(dbMatrix.commentary), cardW - cardPad * 2 - 2); let cly = iy + 15; for (const c of cl.slice(0, 2)) { doc.text(c, cx + cardPad + 1, cly); cly += 3; } }
      } else { naText(cx, iy); }
    }
    {
      const cx = margin + cardW + colGap; const iy = drawCard(cx, r2Y, cardW, r2H, "Risques Cles", PDF_COLORS.red);
      if (dbAcceptance) {
        const risks = [...dbAcceptance.drivers].filter((d: any) => d.impact < 0).sort((a: any, b: any) => a.impact - b.impact).slice(0, 3);
        doc.setFontSize(7); let ry = iy + 2;
        for (const r of risks) {
          doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.red);
          const bLines: string[] = doc.splitTextToSize(`- ${sanitize(r.label)}`, cardW - cardPad * 2 - 2);
          for (const bl of bLines.slice(0, 1)) { doc.text(bl, cx + cardPad + 1, ry); ry += 3.5; }
        }
        if (risks.length === 0) { doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text("Aucun risque majeur identifie", cx + cardPad + 1, iy + 4); }
      } else { naText(cx, iy); }
    }
    y = r2Y + r2H + 4;

    const r3H = 34; const r3Y = y;
    {
      const cx = margin; const iy = drawCard(cx, r3Y, cardW, r3H, "Forces Cles", PDF_COLORS.green);
      if (dbAcceptance) {
        const strengths2 = [...dbAcceptance.drivers].filter((d: any) => d.impact > 0).sort((a: any, b: any) => b.impact - a.impact).slice(0, 3);
        doc.setFontSize(7); let sy = iy + 2;
        for (const s of strengths2) {
          doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.green);
          const bLines: string[] = doc.splitTextToSize(`+ ${sanitize(s.label)}`, cardW - cardPad * 2 - 2);
          for (const bl of bLines.slice(0, 1)) { doc.text(bl, cx + cardPad + 1, sy); sy += 3.5; }
        }
        if (strengths2.length === 0) { doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text("Aucun atout majeur identifie", cx + cardPad + 1, iy + 4); }
      } else { naText(cx, iy); }
    }
    {
      const cx = margin + cardW + colGap; const iy = drawCard(cx, r3Y, cardW, r3H, "Stress Worst-Case", PDF_COLORS.accent);
      if (dbStress) {
        const worstCase = (dbStress.cases ?? []).sort((a: any, b: any) => (a.acceptanceScore ?? 100) - (b.acceptanceScore ?? 100))[0];
        if (worstCase) {
          doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark);
          doc.text(sanitize(worstCase.label ?? "Stress"), cx + cardPad + 1, iy + 3);
          const mkY = iy + 6; const mkW = (cardW - cardPad * 2 - 6) / 3; const mkH = 13;
          const mkLabels = ["DSCR", "Rendement", "Acceptation"];
          const mkValues = [worstCase.dscr != null ? String(worstCase.dscr) : "N/A", worstCase.yieldPct != null ? `${worstCase.yieldPct.toFixed(1)}%` : "N/A", worstCase.acceptanceScore != null ? `${worstCase.acceptanceScore}%` : "N/A"];
          const mkColors: [number,number,number][] = [worstCase.dscr != null ? (worstCase.dscr < 1 ? PDF_COLORS.red : PDF_COLORS.green) : PDF_COLORS.medium, worstCase.yieldPct != null ? (worstCase.yieldPct >= 7 ? PDF_COLORS.green : worstCase.yieldPct >= 4 ? PDF_COLORS.amber : PDF_COLORS.red) : PDF_COLORS.medium, worstCase.acceptanceScore != null ? (worstCase.acceptanceScore < 40 ? PDF_COLORS.red : worstCase.acceptanceScore < 70 ? PDF_COLORS.amber : PDF_COLORS.green) : PDF_COLORS.medium];
          for (let mi = 0; mi < 3; mi++) {
            const mx = cx + cardPad + 1 + mi * (mkW + 3);
            doc.setFillColor(255, 255, 255); doc.setDrawColor(235, 235, 240); doc.setLineWidth(0.2); doc.roundedRect(mx, mkY, mkW, mkH, 1.5, 1.5, "FD");
            doc.setFontSize(6); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(mkLabels[mi], mx + mkW / 2, mkY + 4, { align: "center" });
            doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...mkColors[mi]); doc.text(mkValues[mi], mx + mkW / 2, mkY + 10.5, { align: "center" });
          }
        } else { doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text("Aucun scenario de stress", cx + cardPad + 1, iy + 6); }
      } else { naText(cx, iy); }
    }
    y = r3Y + r3H + 4;
    doc.setTextColor(...PDF_COLORS.dark);
  }

  // ── NOTE DE SYNTHESE COMITE ───────────────────────────────────────
  const pdfNarrative = narrative ?? (dossier as any)?.comite?.narrative;
  const pdfNarrativeText = typeof pdfNarrative?.text === "string" ? pdfNarrative.text.trim() : "";
  const pdfStructured = pdfNarrative?.structured;
  const hasStructured = pdfStructured && typeof pdfStructured === "object" && Object.keys(pdfStructured).length > 0;

  if (pdfNarrativeText.length > 0 || hasStructured) {
    newContentPage(); sectionTitle("NOTE DE SYNTHESE COMITE");
    const badgeH = 18; checkPage(badgeH + 4);
    doc.setFillColor(248, 248, 252); doc.setDrawColor(...PDF_COLORS.primaryLight); doc.setLineWidth(0.5);
    doc.roundedRect(margin, y, contentWidth, badgeH, 2, 2, "FD");
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark);
    doc.text(sanitize("NOTE IA — Aide a la decision"), margin + 4, y + 6);
    const badgeParts: string[] = [];
    if (typeof pdfNarrative.model === "string" && pdfNarrative.model) badgeParts.push(`Modele: ${sanitize(pdfNarrative.model)}`);
    if (typeof pdfNarrative.promptVersion === "string") badgeParts.push(`Prompt: v${sanitize(pdfNarrative.promptVersion)}`);
    if (pdfNarrative.generatedAt) { try { badgeParts.push(`Genere: ${new Date(pdfNarrative.generatedAt).toLocaleString("fr-FR")}`); } catch (_) {} }
    if (badgeParts.length > 0) { doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(badgeParts.join("  |  "), margin + 4, y + 13); }
    y += badgeH + 6;
    if (hasStructured) { y = renderStructuredNarrativePdf(doc, pdfStructured, y, margin, contentWidth, contentBottom, () => { newContentPage(); }, (need: number) => { y = checkPage(need); return y; }); }
    else { doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); const narrativeLines: string[] = doc.splitTextToSize(sanitize(pdfNarrativeText), contentWidth - 4); for (const line of narrativeLines) { checkPage(5); doc.text(line, margin + 2, y); y += 4; } }
    y += 4; checkPage(10); doc.setDrawColor(...PDF_COLORS.light); doc.setLineWidth(0.3); doc.line(margin, y, margin + contentWidth * 0.35, y); y += 4;
    doc.setFontSize(7); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium);
    doc.text(sanitize("Note generee automatiquement. Ne se substitue pas a l'analyse finale du comite."), margin + 2, y); y += 6; doc.setTextColor(...PDF_COLORS.dark);
  } else {
    const pres = buildCommitteePresentation(report);
    const noteAcceptance = buildAcceptanceProbability(pdfEngineInput);
    const noteLoyerAnnuel = pdfEngineInput.kpis.loyerAnnuel;
    const noteCoutTotal = pdfEngineInput.kpis.coutTotal;
    const noteYield = (noteLoyerAnnuel && noteCoutTotal && noteCoutTotal > 0) ? (noteLoyerAnnuel / noteCoutTotal) * 100 : null;

    newContentPage(); sectionTitle("NOTE DE SYNTHESE COMITE");
    { const badgeH = 14; checkPage(badgeH + 4); doc.setFillColor(248, 248, 252); doc.setDrawColor(...PDF_COLORS.primaryLight); doc.setLineWidth(0.3); doc.roundedRect(margin, y, contentWidth, badgeH, 2, 2, "FD"); doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark); doc.text(sanitize("NOTE AUTO — note IA non disponible"), margin + 4, y + 6); doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(sanitize(`Generee le ${new Date().toLocaleString("fr-FR")}`), margin + 4, y + 11); y += badgeH + 6; }
    { const tileGap = 4; const tileW = (contentWidth - tileGap * 3) / 4; const tileH = 20; checkPage(tileH + 4);
      const tiles: { label: string; value: string; color: [number,number,number] }[] = [
        { label: "DSCR", value: pdfEngineInput.kpis.dscr != null ? pdfEngineInput.kpis.dscr.toFixed(2) : "N/A", color: pdfEngineInput.kpis.dscr != null ? (pdfEngineInput.kpis.dscr >= 1.2 ? PDF_COLORS.green : pdfEngineInput.kpis.dscr >= 1.0 ? PDF_COLORS.amber : PDF_COLORS.red) : PDF_COLORS.medium },
        { label: "LTV", value: pdfEngineInput.kpis.ltv != null ? `${pdfEngineInput.kpis.ltv}%` : "N/A", color: pdfEngineInput.kpis.ltv != null ? (pdfEngineInput.kpis.ltv <= 60 ? PDF_COLORS.green : pdfEngineInput.kpis.ltv <= 80 ? PDF_COLORS.amber : PDF_COLORS.red) : PDF_COLORS.medium },
        { label: "Rendement brut", value: noteYield != null ? `${noteYield.toFixed(1)}%` : "N/A", color: noteYield != null ? (noteYield >= 7 ? PDF_COLORS.green : noteYield >= 4 ? PDF_COLORS.amber : PDF_COLORS.red) : PDF_COLORS.medium },
        { label: "Acceptation", value: noteAcceptance ? `${noteAcceptance.score}%` : "N/A", color: noteAcceptance ? (noteAcceptance.score >= 70 ? PDF_COLORS.green : noteAcceptance.score >= 40 ? PDF_COLORS.amber : PDF_COLORS.red) : PDF_COLORS.medium },
      ];
      for (let ti = 0; ti < tiles.length; ti++) { const tx = margin + ti * (tileW + tileGap); doc.setFillColor(248, 248, 252); doc.setDrawColor(230, 230, 235); doc.setLineWidth(0.3); doc.roundedRect(tx, y, tileW, tileH, 2, 2, "FD"); doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(tiles[ti].label, tx + tileW / 2, y + 7, { align: "center" }); doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(...tiles[ti].color); doc.text(tiles[ti].value, tx + tileW / 2, y + 15, { align: "center" }); }
      y += tileH + 6; }
    if (pres.paragraphs.length > 0) { doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); const introLines: string[] = doc.splitTextToSize(sanitize(pres.paragraphs[0]), contentWidth - 4); for (const line of introLines) { checkPage(5); doc.text(line, margin + 2, y); y += 4; } y += 4; }
    { const colGap = 6; const colW = (contentWidth - colGap) / 2; const colLeftX = margin; const colRightX = margin + colW + colGap; const colStartY = y; let yL = colStartY; let yR = colStartY;
      const leftParas: string[] = []; const rightParas: { text: string; isDecision: boolean; isMotivation: boolean }[] = [];
      for (let pi = 1; pi < pres.paragraphs.length; pi++) { const para = pres.paragraphs[pi]; const isDecision = para.startsWith("DECISION :"); const isMotivation = para.startsWith("Motivation :"); if (isDecision || isMotivation) rightParas.push({ text: para, isDecision, isMotivation }); else leftParas.push(para); }
      const leftBullets: CommitteePresentationBullets[] = []; const rightBullets: CommitteePresentationBullets[] = [];
      if (pres.bullets) { for (const section of pres.bullets) { const lbl = section.label.toLowerCase(); if (lbl.includes("condition") || lbl.includes("decision")) rightBullets.push(section); else leftBullets.push(section); } }
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark);
      for (const para of leftParas) { const lines: string[] = doc.splitTextToSize(sanitize(para), colW - 4); for (const line of lines) { if (yL > contentBottom - 5) { newContentPage(); yL = y; yR = y; } doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); doc.text(line, colLeftX + 2, yL); yL += 4; } yL += 3; }
      for (const section of leftBullets) { if (yL > contentBottom - 10) { newContentPage(); yL = y; yR = y; } yL += 2; doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.primary); doc.text(sanitize(section.label), colLeftX + 2, yL); yL += 5; const isVigilance = section.label.toLowerCase().includes("vigilance"); doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); for (const item of section.items) { if (yL > contentBottom - 5) { newContentPage(); yL = y; yR = y; } const isPrelable = item.startsWith("[Prealable]"); const bulletLines: string[] = doc.splitTextToSize(sanitize(`- ${item}`), colW - 10); if (isVigilance || isPrelable) { doc.setTextColor(...(isPrelable ? PDF_COLORS.red : PDF_COLORS.amber)); doc.setFont("helvetica", "bold"); } for (const bLine of bulletLines) { doc.text(bLine, colLeftX + 5, yL); yL += 4; } doc.setTextColor(...PDF_COLORS.dark); doc.setFont("helvetica", "normal"); } yL += 3; }
      for (const rp of rightParas) { if (yR > contentBottom - 16) { newContentPage(); yL = y; yR = y; } const borderCol: [number,number,number] = rp.isDecision ? PDF_COLORS.primary : PDF_COLORS.primaryLight; const recoLines: string[] = doc.splitTextToSize(sanitize(rp.text), colW - 12); const blockH = Math.max(12, recoLines.length * 4 + 6); doc.setFillColor(248, 248, 252); doc.setDrawColor(...borderCol); doc.setLineWidth(rp.isDecision ? 0.5 : 0.3); doc.roundedRect(colRightX, yR, colW, blockH, 2, 2, "FD"); doc.setFontSize(rp.isDecision ? 10 : 9); doc.setFont("helvetica", rp.isDecision ? "bold" : "normal"); doc.setTextColor(...(rp.isDecision ? PDF_COLORS.primary : PDF_COLORS.dark)); let ry = yR + 5; for (const line of recoLines) { doc.text(line, colRightX + 4, ry); ry += 4; } yR += blockH + 4; doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); }
      for (const section of rightBullets) { if (yR > contentBottom - 10) { newContentPage(); yL = y; yR = y; } yR += 2; doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.primary); doc.text(sanitize(section.label), colRightX + 2, yR); yR += 5; const isCondition = section.label.toLowerCase().includes("condition"); doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); for (const item of section.items) { if (yR > contentBottom - 5) { newContentPage(); yL = y; yR = y; } const isPrelable = item.startsWith("[Prealable]"); const bulletLines: string[] = doc.splitTextToSize(sanitize(`- ${item}`), colW - 10); if (isPrelable) { doc.setTextColor(...PDF_COLORS.red); doc.setFont("helvetica", "bold"); } else if (isCondition) { doc.setTextColor(...PDF_COLORS.dark); doc.setFont("helvetica", "normal"); } for (const bLine of bulletLines) { doc.text(bLine, colRightX + 5, yR); yR += 4; } doc.setTextColor(...PDF_COLORS.dark); doc.setFont("helvetica", "normal"); } yR += 3; }
      y = Math.max(yL, yR) + 2; }
    checkPage(10); doc.setDrawColor(...PDF_COLORS.light); doc.setLineWidth(0.3); doc.line(margin, y, margin + contentWidth * 0.35, y); y += 4;
    doc.setFontSize(7); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium);
    doc.text(sanitize("Note auto generee. Ne se substitue pas a l'analyse finale du comite."), margin + 2, y); y += 6; doc.setTextColor(...PDF_COLORS.dark);
  }

  // ── SMARTSCORE DETAIL ─────────────────────────────────────────────
  if (report.smartscore) {
    newContentPage(); const ss = report.smartscore; sectionTitle("SMARTSCORE - DETAIL DES PILIERS");
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark);
    doc.text(`Score global : ${ss.score}/100  (${ss.grade})  -  Verdict : ${sanitize(ss.verdict)}`, margin, y); y += 7;
    autoTable(doc, { ...tableDefaults, startY: y, head: [["Pilier", "Points", "Score brut", "Detail"]], body: ss.pillars.map((p: any) => [sanitize(p.label), `${p.points}/${p.maxPoints}`, p.hasData ? `${p.rawScore}/100` : "N/A", p.reasons.slice(0, 2).map((r: string) => cleanReason(r, 55)).join(" ; ") || "-"]), columnStyles: { 0: { cellWidth: 35, fontStyle: "bold" as const }, 1: { cellWidth: 22, halign: "right" as const }, 2: { cellWidth: 22, halign: "right" as const }, 3: { cellWidth: contentWidth - 79 } } });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── EMPRUNTEUR ────────────────────────────────────────────────────
  checkPage(30); sectionTitle("EMPRUNTEUR");
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(sanitize(report.emprunteur.identite), margin, y); y += 5;
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(`Type : ${sanitize(report.emprunteur.type)}`, margin, y); doc.setTextColor(...PDF_COLORS.dark); y += 5;
  const empEntries = Object.entries(report.emprunteur.details);
  if (empEntries.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, body: empEntries.map(([k, v]) => [sanitize(k), sanitize(v)]), showHead: false, columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 45 }, 1: { cellWidth: contentWidth - 45 } } }); y = doc.lastAutoTable.finalY + 6; }

  // ── KV SECTIONS ───────────────────────────────────────────────────
  const addKvSection = (title: string, data: Record<string, string>) => {
    const entries = Object.entries(data).filter(([_, v]) => v && v !== "Non renseigne");
    if (entries.length === 0) return;
    checkPage(15 + entries.length * 5); sectionTitle(title);
    autoTable(doc, { ...tableDefaults, startY: y, body: entries.map(([k, v]) => [sanitize(k), sanitize(v)]), showHead: false, columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 50 }, 1: { cellWidth: contentWidth - 50 } } });
    y = doc.lastAutoTable.finalY + 6;
  };
  addKvSection("PROJET", report.projet); addKvSection("BUDGET", report.budget);
  addKvSection("FINANCEMENT", report.financement); addKvSection("REVENUS", report.revenus);
  addKvSection("RATIOS FINANCIERS", report.kpis);

  // ── ETUDE DE MARCHE ───────────────────────────────────────────────
  newContentPage(); sectionTitle("ETUDE DE MARCHE");
  const ms = report.marketStudy;
  if (!ms) { doc.setFontSize(9); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium); doc.text("Aucune donnee d'etude de marche disponible.", margin, y); y += 8; }
  else {
    if (ms.scoreGlobal != null) { const sc = ms.scoreGlobal; const col = sc >= 65 ? PDF_COLORS.green : sc >= 40 ? PDF_COLORS.amber : PDF_COLORS.red; doc.setFillColor(248, 248, 252); doc.setDrawColor(...col); doc.setLineWidth(0.5); doc.roundedRect(margin, y, contentWidth, 14, 2, 2, "FD"); doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...col); doc.text(`Score marche global : ${sc}/100`, margin + 5, y + 6); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); doc.text(`Evaluation : ${ms.scoreLabel}`, margin + 5, y + 11); y += 18; }
    subTitle("Donnees DVF");
    const dvfKv: [string, string][] = [];
    if (ms.dvf.medianPriceM2 != null) dvfKv.push(["Prix median /m2", fmtNum(ms.dvf.medianPriceM2, 0, " EUR")]);
    if (ms.dvf.avgPriceM2 != null) dvfKv.push(["Prix moyen /m2", fmtNum(ms.dvf.avgPriceM2, 0, " EUR")]);
    if (ms.dvf.transactionCount != null) dvfKv.push(["Transactions", fmtNum(ms.dvf.transactionCount)]);
    if (ms.dvf.evolutionPct != null) dvfKv.push(["Evolution", `${ms.dvf.evolutionPct > 0 ? "+" : ""}${ms.dvf.evolutionPct}%`]);
    if (dvfKv.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, body: dvfKv, showHead: false, columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 50 }, 1: { cellWidth: contentWidth - 50 } } }); y = doc.lastAutoTable.finalY + 4; }
    if (ms.dvf.topTransactions.length > 0) { checkPage(15 + ms.dvf.topTransactions.length * 5); doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium); doc.text(`Top ${ms.dvf.topTransactions.length} transactions`, margin + 2, y); y += 4; autoTable(doc, { ...tableDefaults, startY: y, head: [["Date", "Type", "Surface", "Valeur", "Prix/m2"]], body: ms.dvf.topTransactions.map((t) => [sanitize(t.date), sanitize(t.typeLocal), sanitize(t.surface), sanitize(t.valeur), sanitize(t.prixM2)]), styles: { ...tableDefaults.styles, fontSize: 7 }, columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 30 }, 2: { cellWidth: 28, halign: "right" as const }, 3: { cellWidth: 35, halign: "right" as const }, 4: { cellWidth: contentWidth - 118, halign: "right" as const } } }); y = doc.lastAutoTable.finalY + 6; }
    checkPage(45); subTitle("Donnees INSEE");
    const inseeKv: [string, string][] = [["Commune", sanitize(ms.insee.commune)], ["Population", sanitize(ms.insee.population)], ["Densite", sanitize(ms.insee.densite)], ["Revenu median", sanitize(ms.insee.revenuMedian)], ["Taux de chomage", sanitize(ms.insee.tauxChomage)], ["Part proprietaires", sanitize(ms.insee.partProprietaires)], ["Part locataires", sanitize(ms.insee.partLocataires)], ["Taux de vacance", sanitize(ms.insee.tauxVacance)]].filter(([_, v]) => v && v !== "N/A" && v !== "-");
    if (inseeKv.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, body: inseeKv, showHead: false, columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 50 }, 1: { cellWidth: contentWidth - 50 } } }); y = doc.lastAutoTable.finalY + 6; } else { doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium); doc.text("Donnees INSEE non disponibles.", margin + 2, y); y += 6; }
    checkPage(45); subTitle("BPE - Equipements");
    const bpeKv: [string, string][] = [["Total", sanitize(ms.bpe.totalEquipements)], ["Score BPE", sanitize(ms.bpe.score)], ["Commerces", sanitize(ms.bpe.commerce)], ["Sante", sanitize(ms.bpe.sante)], ["Education", sanitize(ms.bpe.education)], ["Services", sanitize(ms.bpe.services)]].filter(([_, v]) => v && v !== "N/A");
    if (bpeKv.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, body: bpeKv, showHead: false, columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 50 }, 1: { cellWidth: contentWidth - 50 } } }); y = doc.lastAutoTable.finalY + 4; }
    if (ms.bpe.topProches.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, head: [["Nom", "Type", "Distance"]], body: ms.bpe.topProches.map((p) => [sanitize(p.nom), sanitize(p.type), sanitize(p.distance)]), styles: { ...tableDefaults.styles, fontSize: 7.5 } }); y = doc.lastAutoTable.finalY + 6; }
    checkPage(25); subTitle("Transports");
    if (!ms.transport.hasData) { doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text("Donnees insuffisantes", margin + 2, y); y += 8; }
    else { if (ms.transport.summary) { doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text(sanitize(ms.transport.summary), margin + 2, y); y += 5; } if (ms.transport.items.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, head: [["Arret / Station", "Distance"]], body: ms.transport.items.map((t) => [sanitize(t.label), sanitize(t.distance)]) }); y = doc.lastAutoTable.finalY + 6; } }
    if (ms.insights.length > 0) { subTitle("Points cles du marche"); autoTable(doc, { ...tableDefaults, startY: y, body: ms.insights.map((ins) => [ins.type === "positive" ? "[+]" : ins.type === "warning" ? "[!]" : "[ ]", sanitize(ins.message)]), showHead: false, columnStyles: { 0: { cellWidth: 10, halign: "center" as const, fontStyle: "bold" as const }, 1: { cellWidth: contentWidth - 10 } }, didParseCell(data: any) { if (data.column.index === 0 && data.section === "body") { const val = data.cell.raw; if (val === "[+]") data.cell.styles.textColor = PDF_COLORS.green; else if (val === "[!]") data.cell.styles.textColor = PDF_COLORS.amber; else data.cell.styles.textColor = PDF_COLORS.medium; } } }); y = doc.lastAutoTable.finalY + 6; }
  }

  // ── RISQUES ───────────────────────────────────────────────────────
  if (report.risques.items.length > 0) { checkPage(20 + report.risques.items.length * 5); sectionTitle("RISQUES GEORISQUES"); autoTable(doc, { ...tableDefaults, startY: y, head: [["Statut", "Risque", "Niveau"]], body: report.risques.items.map((r) => [r.status === "present" ? "WARN" : r.status === "absent" ? "OK" : "?", sanitize(r.label), sanitize(r.level)]), headStyles: { ...tableDefaults.headStyles, fillColor: PDF_COLORS.accent }, columnStyles: { 0: { cellWidth: 16, halign: "center" as const, fontStyle: "bold" as const }, 1: { cellWidth: contentWidth - 46 }, 2: { cellWidth: 30 } }, didParseCell(data: any) { if (data.column.index === 0 && data.section === "body") { const val = data.cell.raw; if (val === "WARN") data.cell.styles.textColor = PDF_COLORS.red; else if (val === "OK") data.cell.styles.textColor = PDF_COLORS.green; else data.cell.styles.textColor = PDF_COLORS.medium; } } }); y = doc.lastAutoTable.finalY + 4; doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(`Score : ${sanitize(report.risques.score)}  -  Niveau : ${sanitize(report.risques.globalLevel)}`, margin, y); y += 8; }

  // ── SCENARIOS ─────────────────────────────────────────────────────
  const scenarioKeys = Object.keys(report.scenarios);
  if (scenarioKeys.length > 0) { checkPage(25); sectionTitle("SCENARIOS"); for (const name of scenarioKeys) { const sc = report.scenarios[name]; const entries = Object.entries(sc); if (entries.length === 0) continue; checkPage(10 + entries.length * 5); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark); doc.text(name === "stress" ? "Scenario STRESS" : name === "upside" ? "Scenario OPTIMISTE" : name === "base" ? "Scenario BASE" : sanitize(name.toUpperCase()), margin + 2, y); y += 5; autoTable(doc, { ...tableDefaults, startY: y, body: entries.map(([k, v]) => [sanitize(k), sanitize(v)]), showHead: false, columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 40 }, 1: { cellWidth: contentWidth - 40 } } }); y = doc.lastAutoTable.finalY + 5; } y += 3; }

  // ── DONNEES MANQUANTES ────────────────────────────────────────────
  if (report.missing.length > 0) { checkPage(15 + report.missing.length * 5); sectionTitle("DONNEES MANQUANTES"); autoTable(doc, { ...tableDefaults, startY: y, head: [["Severite", "Donnee", "Cle"]], body: report.missing.map((m) => [m.severity === "blocker" ? "BLOQUANT" : m.severity === "warn" ? "ATTENTION" : "INFO", sanitize(m.label), sanitize(m.key)]), headStyles: { ...tableDefaults.headStyles, fillColor: PDF_COLORS.amber }, columnStyles: { 0: { cellWidth: 25, fontStyle: "bold" as const }, 1: { cellWidth: contentWidth - 65 }, 2: { cellWidth: 40, fontSize: 7 } }, didParseCell(data: any) { if (data.column.index === 0 && data.section === "body") { const val = data.cell.raw; if (val === "BLOQUANT") data.cell.styles.textColor = PDF_COLORS.red; else if (val === "ATTENTION") data.cell.styles.textColor = PDF_COLORS.amber; else data.cell.styles.textColor = PDF_COLORS.medium; } } }); y = doc.lastAutoTable.finalY + 4; if (report.smartscore && report.smartscore.totalMissingPenalty > 0) { doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.red); doc.text(`Impact sur le score : -${report.smartscore.totalMissingPenalty} pts`, margin, y); y += 8; } }

  // ── RECOMMANDATIONS ───────────────────────────────────────────────
  if (report.smartscore && report.smartscore.recommendations.length > 0) { checkPage(15 + report.smartscore.recommendations.length * 6); sectionTitle("RECOMMANDATIONS"); doc.setFontSize(9); doc.setFont("helvetica", "normal"); report.smartscore.recommendations.forEach((r: string, i: number) => { checkPage(7); const lines = doc.splitTextToSize(`${i + 1}. ${sanitize(r)}`, contentWidth - 5); doc.text(lines, margin + 3, y); y += lines.length * 4 + 2; }); y += 4; }

  // ── SCENARIOS DECISIONNELS ────────────────────────────────────────
  { const scenarios = buildDecisionScenarios(report); const scenarioList: DecisionScenario[] = [scenarios.conservative, scenarios.balanced, scenarios.opportunistic]; newContentPage(); sectionTitle("SCENARIOS DECISIONNELS"); doc.setFontSize(9); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium); const introLines: string[] = doc.splitTextToSize(sanitize("Trois lectures du dossier pour eclairer la decision du comite."), contentWidth - 4); for (const line of introLines) { checkPage(5); doc.text(line, margin + 2, y); y += 4; } y += 4; const scenarioColors: [number,number,number][] = [PDF_COLORS.amber, PDF_COLORS.primary, PDF_COLORS.green]; for (let si = 0; si < scenarioList.length; si++) { const sc = scenarioList[si]; const scColor = scenarioColors[si]; checkPage(22); doc.setFillColor(248, 248, 252); doc.setDrawColor(...scColor); doc.setLineWidth(0.6); doc.roundedRect(margin, y, contentWidth, 10, 2, 2, "FD"); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...scColor); doc.text(sanitize(`${sc.label} — ${sc.decision}`), margin + 4, y + 7); y += 14; doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium); const rrLines: string[] = doc.splitTextToSize(sanitize(sc.riskReading), contentWidth - 8); for (const line of rrLines) { checkPage(4); doc.text(line, margin + 3, y); y += 3.5; } y += 3; for (const item of sc.favorable) { const fLines: string[] = doc.splitTextToSize(sanitize(`+ ${item}`), contentWidth - 12); for (const fl of fLines) { checkPage(4); doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.green); doc.text(fl, margin + 6, y); y += 3.5; } } y += 2; for (const item of sc.unfavorable) { const uLines: string[] = doc.splitTextToSize(sanitize(`- ${item}`), contentWidth - 12); for (const ul of uLines) { checkPage(4); doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.red); doc.text(ul, margin + 6, y); y += 3.5; } } y += 2; doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark); doc.text("Motivation", margin + 3, y); y += 4; const motLines: string[] = doc.splitTextToSize(sanitize(sc.motivation), contentWidth - 8); for (const ml of motLines) { checkPage(4); doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.text(ml, margin + 4, y); y += 3.5; } y += 2; if (sc.conditions.length > 0) { doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.primary); doc.text("Conditions", margin + 3, y); y += 4; for (const c of sc.conditions) { const cLines: string[] = doc.splitTextToSize(sanitize(`> ${c}`), contentWidth - 12); for (const cl of cLines) { checkPage(4); doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); doc.text(cl, margin + 6, y); y += 3.5; } } } if (si < scenarioList.length - 1) { y += 4; checkPage(6); doc.setDrawColor(...PDF_COLORS.light); doc.setLineWidth(0.2); doc.line(margin + 10, y, margin + contentWidth - 10, y); y += 6; } } y += 4; }

  // ── STRESS TESTS ──────────────────────────────────────────────────
  { const pack = buildStressTests(pdfEngineInput); if (pack) { newContentPage(); sectionTitle("STRESS TESTS"); const rows = [pack.base, ...(pack.cases ?? [])].filter(Boolean).slice(0, 5); const stressBody: string[][] = rows.map((row: any, idx: number) => [sanitize(row.label ?? (idx === 0 ? "Base" : "Scenario")), row.dscr != null ? String(row.dscr) : "N/A", row.ltv != null ? `${row.ltv}%` : "N/A", row.yieldPct != null ? `${row.yieldPct.toFixed(1)}%` : "N/A", row.acceptanceScore != null ? `${row.acceptanceScore}%` : "N/A", Array.isArray(row.notes) ? row.notes.slice(0, 2).map((n: string) => sanitize(n)).join(" ; ") : sanitize(row.notes ?? "-")]); if (stressBody.length > 0) { autoTable(doc, { ...tableDefaults, startY: y, head: [["Scenario", "DSCR", "LTV", "Rendement", "Acceptation", "Notes"]], body: stressBody, headStyles: { ...tableDefaults.headStyles, fillColor: PDF_COLORS.accent }, columnStyles: { 0: { cellWidth: 35, fontStyle: "bold" as const }, 1: { cellWidth: 18, halign: "right" as const }, 2: { cellWidth: 18, halign: "right" as const }, 3: { cellWidth: 22, halign: "right" as const }, 4: { cellWidth: 24, halign: "right" as const }, 5: { cellWidth: contentWidth - 117, fontSize: 7, cellPadding: 1.5 } }, didParseCell(data: any) { if (data.row.index === 0 && data.section === "body") { data.cell.styles.fillColor = [248, 248, 252]; data.cell.styles.fontStyle = "bold"; } if (data.column.index === 1 && data.section === "body") { const numVal = parseFloat(String(data.cell.raw)); if (!isNaN(numVal)) { if (numVal < 1) data.cell.styles.textColor = PDF_COLORS.red; else data.cell.styles.textColor = PDF_COLORS.green; } } if (data.column.index === 4 && data.section === "body") { const numVal = parseFloat(String(data.cell.raw)); if (!isNaN(numVal)) { if (numVal < 40) data.cell.styles.textColor = PDF_COLORS.red; else if (numVal < 70) data.cell.styles.textColor = PDF_COLORS.amber; else data.cell.styles.textColor = PDF_COLORS.green; } } } }); y = doc.lastAutoTable.finalY + 6; } } }

  // ── CONCLUSION ────────────────────────────────────────────────────
  { const pdfScenarios = buildEngineScenarios(pdfEngineInput); const pdfAcceptance = buildAcceptanceProbability(pdfEngineInput); const pdfMatrix = buildRiskReturnMatrix(pdfEngineInput); newContentPage(); sectionTitle("CONCLUSION"); const conservativeScenario = pdfScenarios[0]; if (conservativeScenario) { const decBoxH = 16; checkPage(decBoxH + 6); const decColor = conservativeScenario.decision.toUpperCase().includes("NO GO") ? PDF_COLORS.red : conservativeScenario.decision.toUpperCase().includes("GO SOUS") ? PDF_COLORS.amber : PDF_COLORS.green; doc.setFillColor(248, 248, 252); doc.setDrawColor(...decColor); doc.setLineWidth(0.7); doc.roundedRect(margin, y, contentWidth, decBoxH, 2, 2, "FD"); doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...decColor); doc.text(sanitize(`Decision : ${conservativeScenario.decision}`), margin + 4, y + 7); doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium); doc.text(sanitize(`Confiance : ${conservativeScenario.confidence}%`), margin + 4, y + 13); y += decBoxH + 6; } if (pdfAcceptance) { checkPage(28); const accLabel = pdfAcceptance.score >= 70 ? "Acceptation probable" : pdfAcceptance.score >= 40 ? "Acceptation incertaine" : "Acceptation peu probable"; const accColor = pdfAcceptance.score >= 70 ? PDF_COLORS.green : pdfAcceptance.score >= 40 ? PDF_COLORS.amber : PDF_COLORS.red; doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark); doc.text("Probabilite d'acceptation", margin, y); y += 5; doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...accColor); doc.text(`${pdfAcceptance.score}%`, margin + 2, y); const scoreW = doc.getTextWidth(`${pdfAcceptance.score}%`); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); doc.text(sanitize(` — ${accLabel}`), margin + 2 + scoreW + 2, y); y += 6; } if (pdfMatrix) { checkPage(22); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...PDF_COLORS.dark); doc.text("Matrice Risque / Rendement", margin, y); y += 5; const qColor = pdfMatrix.quadrant.toLowerCase().includes("optimal") || pdfMatrix.quadrant.toLowerCase().includes("favorable") ? PDF_COLORS.green : pdfMatrix.quadrant.toLowerCase().includes("vigilance") ? PDF_COLORS.amber : pdfMatrix.quadrant.toLowerCase().includes("defavorable") ? PDF_COLORS.red : PDF_COLORS.primary; doc.setFillColor(248, 248, 252); doc.setDrawColor(...qColor); doc.setLineWidth(0.5); doc.roundedRect(margin, y, contentWidth, 12, 2, 2, "FD"); doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...qColor); doc.text(sanitize(`Quadrant : ${pdfMatrix.quadrant}`), margin + 4, y + 5); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.dark); doc.text(sanitize(`Risque : ${pdfMatrix.riskScore}/100   |   Rendement : ${pdfMatrix.returnScore}/100`), margin + 4, y + 10); y += 16; } checkPage(10); doc.setDrawColor(...PDF_COLORS.light); doc.setLineWidth(0.3); doc.line(margin, y, margin + contentWidth * 0.35, y); y += 4; doc.setFontSize(7); doc.setFont("helvetica", "italic"); doc.setTextColor(...PDF_COLORS.medium); doc.text(sanitize("Conclusion generee par committeeEngine. Ne se substitue pas a l'analyse finale."), margin + 2, y); y += 6; }

  // ── FINALIZE ──────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(255, 255, 255); doc.rect(pageWidth - margin - 30, footerY - 4, 30, 6, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_COLORS.medium);
    doc.text(`Page ${i} / ${totalPages}`, pageWidth - margin, i === 1 ? pageHeight - 8 : footerY, { align: "right" });
  }
  const filename = `rapport-comite-${dossier?.reference ?? "dossier"}-${new Date().toISOString().slice(0, 10)}.pdf`;
  try { doc.save(filename); } catch (saveErr) { throw new Error(`PDF save failed: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`); }
}

// ════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function ComitePage() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();
  const [report, setReport] = useState<UniversalReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  const operation = useMemo<OperationSummary | null>(() => {
    if (!dossier) return null;
    const baseOp: OperationSummary = (dossier as any).operation ?? buildOperationSummaryFromDossier(dossier);
    return mergeMarketStudyIntoOperation(baseOp, dossier);
  }, [dossier]);
  const persistedReport = useMemo(() => { const r = (dossier as any)?.comite?.report; return r && isReportValid(r) ? (r as UniversalReport) : null; }, [dossier]);
  const persistedNarrative = useMemo<CommitteeNarrative | null>(() => { const n = (dossier as any)?.comite?.narrative; return isNarrativeValid(n) ? n : null; }, [dossier]);
  const activeReport = report ?? persistedReport;
  const [localNarrative, setLocalNarrative] = useState<CommitteeNarrative | null>(null);
  const activeNarrative = localNarrative ?? persistedNarrative;

  const engineInput = useMemo<EngineReportInput | null>(() => {
    if (!activeReport) return null;
    try {
      const ms = activeReport.marketStudy;
      const ss = activeReport.smartscore;
      return {
        programmeNom: activeReport.meta.dossierLabel, adresse: activeReport.projet["Adresse"],
        marketStudy: ms ? { commune: ms.insee.commune !== "-" ? ms.insee.commune : undefined, departement: undefined, dvf: { prixM2Median: ms.dvf.medianPriceM2 ?? undefined, nbTransactions: ms.dvf.transactionCount ?? undefined, evolution: ms.dvf.evolutionPct ?? undefined }, insee: { population: safeNumber(ms.insee.population) ?? undefined, revenuMedian: safeNumber(ms.insee.revenuMedian) ?? undefined, tauxChomage: safeNumber(ms.insee.tauxChomage) ?? undefined, densitePopulation: safeNumber(ms.insee.densite) ?? undefined }, bpe: { nbEquipements: safeNumber(ms.bpe.totalEquipements) ?? undefined }, transport: { nbStations: ms.transport.items.length > 0 ? ms.transport.items.length : undefined, distanceCentre: undefined }, insights: ms.insights.map((i) => ({ label: i.message, value: "" as string | number, sentiment: (i.type === "positive" ? "positive" : i.type === "warning" ? "negative" : "neutral") as "positive" | "negative" | "neutral" })) } : undefined,
        smartscore: ss ? { score: ss.score, verdict: ss.verdict, pillars: ss.pillars.map((p) => ({ id: p.key, label: p.label, score: p.rawScore })) } : undefined,
        kpis: { ltv: kpiNum(activeReport.kpis["LTV"]) ?? undefined, dscr: kpiNum(activeReport.kpis["DSCR"]) ?? undefined, loyerAnnuel: parseMoneyK(activeReport.revenus["Loyer annuel"]) ?? undefined, coutTotal: parseMoneyK(activeReport.budget["TOTAL"]) ?? undefined, margeBrute: kpiNum(activeReport.kpis["Marge brute"]) ?? undefined, tauxEndettement: undefined },
        missing: (activeReport.missing ?? []).map((m) => m.label),
      };
    } catch (err) { console.warn("[ComitePage] engineInput build failed:", err); return null; }
  }, [activeReport]);

  const localPresentation = useMemo(() => { if (!engineInput || activeNarrative) return null; try { return buildEnginePresentation(engineInput); } catch (err) { return null; } }, [engineInput, activeNarrative]);
  const decisionScenarios = useMemo(() => { if (!engineInput) return null; try { return buildEngineScenarios(engineInput); } catch (err) { return null; } }, [engineInput]);
  const acceptance = useMemo(() => { if (!engineInput) return null; try { return buildAcceptanceProbability(engineInput); } catch (err) { return null; } }, [engineInput]);
  const matrix = useMemo(() => { if (!engineInput) return null; try { return buildRiskReturnMatrix(engineInput); } catch (err) { return null; } }, [engineInput]);

  const handleGenerate = useCallback(async (forceNarrative = false) => {
    if (!dossier || !operation || !dossierId) return;
    setIsGenerating(true); setGenError(null); setNarrativeError(null);
    try {
      const sr = normalizeSmartScoreUniversal(computeSmartScoreFromOperation(operation, dossier));
      const rpt = generateUniversalReport(dossier, operation, sr);
      setReport(rpt);
      upsertDossier({ id: dossierId, comite: { ...((dossier as any)?.comite ?? {}), report: rpt } } as any);
      addEvent({ type: "rapport_generated", dossierId, message: `Rapport comite genere - Score: ${sr.score}/100 (${sr.grade})` });
      // ❌ IA désactivée — plus d'appel à generateCommitteeNarrative
      setNarrativeLoading(false);
      setLocalNarrative(null);
    } catch (err) { setGenError(err instanceof Error ? err.message : "Erreur inconnue"); }
    finally { setIsGenerating(false); }
  }, [dossier, operation, dossierId]);

  const handleExportPdf = useCallback(async () => {
    if (!activeReport) return;
    setIsExporting(true); setNarrativeError(null);
    try {
      const freshMarketStudy = operation ? extractMarketStudy(operation) : activeReport.marketStudy;
      const safeReportForPdf: UniversalReport = { ...activeReport, marketStudy: freshMarketStudy };
      // ❌ IA désactivée — pas d'appel à generateCommitteeNarrative
      const bestNarrative: CommitteeNarrative | null = null;
      await exportReportPdf(safeReportForPdf, { ...(dossier as any), comite: { ...((dossier as any)?.comite ?? {}), narrative: bestNarrative } }, bestNarrative);
    } catch (err) { alert(`Erreur export PDF: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setIsExporting(false); }
  }, [activeReport, localNarrative, persistedNarrative, dossier, operation, dossierId]);

  if (!dossierId || !dossier) return (
    <div className="p-6">
      <div style={{ background: GRAD_FIN, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Financeur › Comité</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: "white" }}>Comité de crédit</div>
      </div>
      <p className="text-center text-gray-500">Aucun dossier sélectionné.{" "}<button className="underline" style={{ color: ACCENT_FIN }} onClick={() => navigate("/banque/dossiers")}>Retour aux dossiers</button></p>
    </div>
  );

  const hasReport = isReportValid(activeReport);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div style={{ background: GRAD_FIN, borderRadius: 14, padding: "20px 24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Financeur › Comité</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>Comité de crédit</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", display: "flex", alignItems: "center", gap: 10 }}>
            <span>{dossier.label ?? dossier.reference}</span>
            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.15)", color: "white", fontWeight: 600 }}>v5-engine</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 4 }}>
          <button onClick={() => handleGenerate(hasReport)} disabled={isGenerating} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "white", color: ACCENT_FIN, fontWeight: 600, fontSize: 13, cursor: isGenerating ? "not-allowed" : "pointer", opacity: isGenerating ? 0.6 : 1 }}>
            {isGenerating ? "⟳ Génération…" : hasReport ? "🔄 Regénérer" : "📄 Générer le rapport"}
          </button>
          {hasReport && (
            <button onClick={handleExportPdf} disabled={isExporting} style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", color: "white", fontWeight: 600, fontSize: 13, cursor: isExporting ? "not-allowed" : "pointer", opacity: isExporting ? 0.6 : 1 }}>
              {isExporting ? "⟳ Export…" : "📥 Exporter PDF"}
            </button>
          )}
        </div>
      </div>

      {genError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-500 mt-0.5">⚠️</span>
          <div className="flex-1"><p className="text-sm font-medium text-red-800">Erreur</p><p className="text-sm text-red-600 mt-0.5">{genError}</p></div>
          <button onClick={() => setGenError(null)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-600">Rapport Comité</span>
        {hasReport ? (
          <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: "rgba(38,166,154,0.10)", color: ACCENT_FIN, fontWeight: 600 }}>
            ✅ Généré le {new Date(activeReport!.generatedAt).toLocaleDateString("fr-FR")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-sm">⏳ Non généré</span>
        )}
      </div>

      {hasReport && activeReport && (
        <div className="space-y-6">
          {activeReport.smartscore && (
            <ReportCard title="📊 SmartScore">
              <div className="flex items-center gap-6 mb-4">
                <div className={`text-3xl font-bold px-4 py-2 rounded-lg ${getGradeColor(activeReport.smartscore.grade)}`}>{activeReport.smartscore.score}/100</div>
                <div><div className="text-lg font-semibold">Grade {activeReport.smartscore.grade} — {activeReport.smartscore.verdict}</div><div className="text-sm text-gray-500 capitalize">Profil: {activeReport.profile}</div></div>
              </div>
              <div className="space-y-2">
                {activeReport.smartscore.pillars.map((p) => {
                  const pct = p.maxPoints > 0 ? Math.round((p.points / p.maxPoints) * 100) : 0;
                  return (
                    <div key={p.key} className="flex items-center gap-3">
                      <span className="w-28 text-xs font-medium text-gray-600 text-right">{p.label}</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden"><div className={`h-full rounded-full ${pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} /></div>
                      <span className="w-16 text-xs text-gray-500 text-right">{p.points}/{p.maxPoints}</span>
                      {!p.hasData && <span className="text-xs bg-gray-200 text-gray-400 px-1 rounded">N/A</span>}
                    </div>
                  );
                })}
              </div>
            </ReportCard>
          )}

          <ReportCard title="📝 Note de synthèse comité">
            {narrativeLoading ? (
              <div className="flex items-center gap-2 text-gray-500 py-4"><span className="animate-spin text-lg">⟳</span><span className="text-sm">Génération en cours…</span></div>
            ) : activeNarrative ? (
              <div>
                {activeNarrative.structured && typeof activeNarrative.structured === "object" && Object.keys(activeNarrative.structured).length > 0
                  ? <StructuredNarrativeView data={activeNarrative.structured} />
                  : <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">{activeNarrative.text}</pre>}
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                  <span>Modèle : {activeNarrative.model}</span>
                  <span>Prompt : v{activeNarrative.promptVersion}</span>
                  <span>Généré le {new Date(activeNarrative.generatedAt).toLocaleString("fr-FR")}</span>
                </div>
              </div>
            ) : localPresentation ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg"><span className="text-amber-500 text-sm">⚙️</span><span className="text-xs text-amber-700 font-medium">Note locale (committeeEngine)</span></div>
                <p className="text-sm text-gray-700 leading-relaxed">{localPresentation.executiveSummary}</p>
                {localPresentation.sections.map((section: any, i: number) => (
                  <div key={i}><h4 className="text-sm font-bold uppercase tracking-wide mb-2" style={{ color: ACCENT_FIN }}>{section.title}</h4>{section.paragraphs.map((para: string, j: number) => (<p key={j} className="text-sm text-gray-700 leading-relaxed mb-2">{para}</p>))}</div>
                ))}
                <div className="rounded-lg p-3" style={{ background: "rgba(38,166,154,0.07)", border: "1px solid #c0e8d4" }}><p className="text-sm font-semibold" style={{ color: "#0a3d28" }}>{localPresentation.decisionLine}</p></div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic py-2">La note sera générée automatiquement avec le rapport.</p>
            )}
            {narrativeError && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <span className="text-red-500 mt-0.5 flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-red-800">Erreur narrative</p><p className="text-xs text-red-600 mt-1">{narrativeError}</p></div>
                <button onClick={() => setNarrativeError(null)} className="text-red-400 hover:text-red-600 text-sm flex-shrink-0">✕</button>
              </div>
            )}
          </ReportCard>

          <ReportCard title="👤 Emprunteur">
            <p className="font-medium">{activeReport.emprunteur.identite}</p>
            <p className="text-sm text-gray-500 capitalize">{activeReport.emprunteur.type}</p>
            {Object.entries(activeReport.emprunteur.details).map(([k, v]) => (<div key={k} className="text-sm mt-1"><span className="text-gray-500">{k}:</span> {v}</div>))}
          </ReportCard>

          <KvSection title="🏗️ Projet" data={activeReport.projet} />
          <KvSection title="💰 Budget" data={activeReport.budget} />
          <KvSection title="🏦 Financement" data={activeReport.financement} />
          <KvSection title="💵 Revenus" data={activeReport.revenus} />
          <KvSection title="📈 Marché" data={activeReport.marche} />
          <KvSection title="📐 Ratios" data={activeReport.kpis} />

          {activeReport.risques.items.length > 0 && (
            <ReportCard title="⚡ Risques">
              <div className="space-y-1">
                {activeReport.risques.items.map((r, i) => (
                  <div key={i} className={`flex items-center justify-between p-2 rounded text-sm ${r.status === "present" && (r.level === "élevé" || r.level === "eleve") ? "bg-red-50" : r.status === "present" ? "bg-amber-50" : "bg-gray-50"}`}>
                    <span>{r.status === "absent" ? "✅" : r.status === "unknown" ? "❓" : "⚠️"} {r.label}</span>
                    <span className="text-xs font-medium capitalize">{r.level}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-sm text-gray-600">Score: {activeReport.risques.score} — Niveau: {activeReport.risques.globalLevel}</div>
            </ReportCard>
          )}

          {acceptance && (
            <ReportCard title="✅ Probabilité d'acceptation">
              <div className="flex items-center gap-6 mb-4">
                <div className={`text-3xl font-bold px-4 py-2 rounded-lg ${acceptance.score >= 70 ? "bg-green-100 text-green-800" : acceptance.score >= 40 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{acceptance.score}%</div>
                <div><div className="text-lg font-semibold text-gray-800">{acceptance.score >= 70 ? "Acceptation probable" : acceptance.score >= 40 ? "Acceptation incertaine" : "Peu probable"}</div></div>
              </div>
            </ReportCard>
          )}

          {matrix && (
            <ReportCard title="📌 Matrice Risque / Rendement">
              <span className={`inline-block text-sm font-bold px-3 py-1 rounded-full ${matrix.quadrant.toLowerCase().includes("optimal") || matrix.quadrant.toLowerCase().includes("favorable") ? "bg-green-100 text-green-800" : matrix.quadrant.toLowerCase().includes("vigilance") ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{matrix.quadrant}</span>
              <div className="mt-2 text-sm text-gray-600">Risque : {matrix.riskScore}/100  |  Rendement : {matrix.returnScore}/100</div>
              {matrix.commentary && <p className="text-sm text-gray-700 mt-2 leading-relaxed">{matrix.commentary}</p>}
            </ReportCard>
          )}

          {decisionScenarios && decisionScenarios.length > 0 && (
            <ReportCard title="🎲 Scénarios décisionnels">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {decisionScenarios.map((sc: any) => {
                  const borderColor = sc.key === "conservative" ? "border-amber-300" : sc.key === "opportunistic" ? "border-green-300" : "border-indigo-300";
                  const bgColor = sc.key === "conservative" ? "bg-amber-50" : sc.key === "opportunistic" ? "bg-green-50" : "bg-indigo-50";
                  const badgeColor = sc.key === "conservative" ? "bg-amber-100 text-amber-800" : sc.key === "opportunistic" ? "bg-green-100 text-green-800" : "bg-indigo-100 text-indigo-800";
                  return (
                    <div key={sc.key} className={`border ${borderColor} rounded-lg overflow-hidden`}>
                      <div className={`${bgColor} px-4 py-2 flex items-center justify-between`}>
                        <span className="font-semibold text-sm text-gray-800">{sc.label}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${badgeColor}`}>{sc.decision}</span>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <div className="text-xs text-gray-500">Confiance : <span className="font-semibold">{sc.confidence}%</span></div>
                        {sc.pros && sc.pros.length > 0 && (<div><p className="text-xs font-semibold text-green-700 mb-1">Pour</p>{sc.pros.slice(0, 4).map((p: string, i: number) => <p key={i} className="text-xs text-gray-600">+ {p}</p>)}</div>)}
                        {sc.cons && sc.cons.length > 0 && (<div><p className="text-xs font-semibold text-red-700 mb-1">Contre</p>{sc.cons.slice(0, 4).map((c: string, i: number) => <p key={i} className="text-xs text-gray-600">- {c}</p>)}</div>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ReportCard>
          )}

          <ReportCard title="📝 Conclusion">
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{activeReport.verdictExplanation}</pre>
          </ReportCard>

          <DecisionSection dossierId={dossierId!} dossier={dossier} />
        </div>
      )}

      {!hasReport && (
        <div className="rounded-lg p-8 text-center" style={{ background: "rgba(38,166,154,0.04)", border: "2px dashed #c0e8d4" }}>
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-600 mb-4">Le rapport comité n'a pas encore été généré.</p>
          {genError && <p className="text-sm text-red-600 mb-4">{genError}</p>}
          <button onClick={() => handleGenerate(false)} style={{ padding: "9px 24px", borderRadius: 10, border: "none", background: GRAD_FIN, color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Générer le rapport</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════

function ReportCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white p-4" style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}>
      <h3 className="text-lg font-semibold mb-3" style={{ color: "#0a3d28" }}>{title}</h3>
      {children}
    </div>
  );
}

function KvSection({ title, data }: { title: string; data: Record<string, string> }) {
  const entries = Object.entries(data).filter(([_, v]) => v && v !== "Non renseigné" && v !== "Non renseigne");
  if (entries.length === 0) return null;
  return (
    <ReportCard title={title}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        {entries.map(([k, v]) => (
          <div key={k}><div className="text-xs text-gray-500">{k}</div><div className={`font-medium ${k === "TOTAL" ? "text-lg" : "text-gray-800"}`} style={k === "TOTAL" ? { color: ACCENT_FIN } : {}}>{v}</div></div>
        ))}
      </div>
    </ReportCard>
  );
}

function DecisionSection({ dossierId, dossier }: { dossierId: string; dossier: any }) {
  const [verdict, setVerdict] = useState<string>(dossier?.decision?.verdict ?? dossier?.comite?.verdict ?? "");
  const [motivation, setMotivation] = useState<string>(dossier?.decision?.motivation ?? dossier?.comite?.motivation ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    upsertDossier({ id: dossierId, decision: { ...(dossier?.decision ?? {}), verdict, motivation, decidedAt: new Date().toISOString() } } as any);
    addEvent({ type: "decision_updated", dossierId, message: `Decision comite: ${verdict}` });
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="bg-white p-4" style={{ borderRadius: 14, border: "2px solid #c0e8d4" }}>
      <h3 className="text-lg font-semibold mb-3" style={{ color: "#0a3d28" }}>⚖️ Décision du comité</h3>
      <div className="space-y-4">
        <div className="flex gap-3">
          {["GO", "GO sous conditions", "NO GO"].map((v) => (
            <button key={v} onClick={() => setVerdict(v)} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${verdict === v ? v === "GO" ? "bg-green-600 text-white border-green-600" : v === "GO sous conditions" ? "bg-amber-500 text-white border-amber-500" : "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>{v}</button>
          ))}
        </div>
        <textarea placeholder="Motivation / Conditions..." value={motivation} onChange={(e) => setMotivation(e.target.value)} rows={4} className="w-full border border-slate-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/30" />
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={!verdict} style={{ padding: "9px 20px", borderRadius: 9, border: "none", background: verdict ? GRAD_FIN : "#e2e8f0", color: verdict ? "white" : "#94a3b8", fontWeight: 600, fontSize: 14, cursor: verdict ? "pointer" : "not-allowed" }}>Enregistrer la décision</button>
          {saved && <span style={{ fontSize: 14, color: "#16a34a", fontWeight: 500 }}>✅ Décision enregistrée</span>}
        </div>
      </div>
    </div>
  );
}