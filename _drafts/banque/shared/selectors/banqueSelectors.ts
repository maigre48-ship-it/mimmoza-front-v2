/**
 * src/spaces/banque/selectors/banqueSelectors.ts
 * ────────────────────────────────────────────────────────────────────
 * Fonctions pures (selectors) qui dérivent des données utiles depuis
 * le BanqueSnapshot. Aucun side-effect, aucun appel localStorage.
 *
 * Utilisées par useBanqueSnapshot() et directement dans les pages.
 * ────────────────────────────────────────────────────────────────────
 */

import type { BanqueSnapshot } from "../shared/types/banque.types";

// ═══════════════════════════════════════════════════════════════════
// Types exports
// ═══════════════════════════════════════════════════════════════════

export interface CompletenessResult {
  percent: number; // 0-100
  total: number;
  filled: number;
  missingBuckets: string[];
}

export interface RiskSummary {
  available: boolean;
  globalLevel: string;
  globalScore: number;
  label: string; // phrase courte
  highRisks: number;
  mediumRisks: number;
  lowRisks: number;
  totalRisks: number;
}

export interface MarketSummary {
  available: boolean;
  label: string;
  prixM2Median: number | null;
  tensionMarche: string | null;
  verdict: string | null;
}

export interface GuaranteesSummary {
  available: boolean;
  label: string;
  totalRequested: number;
  totalObtained: number;
  gaps: number;
  ltvPct: number | null;
}

export interface CommitteePayload {
  dossierId: string | null;
  dossierName: string;
  sponsor: string;
  montant: number;
  statut: string;
  riskSummary: RiskSummary;
  marketSummary: MarketSummary;
  guaranteesSummary: GuaranteesSummary;
  smartScore: { global: number; subscores: unknown[] } | null;
  completeness: CompletenessResult;
  documents: { total: number; required: number; missing: number };
}

export interface DossierHealth {
  level: "good" | "warning" | "critical" | "unknown";
  label: string;
  reasons: string[];
}

// ═══════════════════════════════════════════════════════════════════
// BUCKETS pour la complétude
// ═══════════════════════════════════════════════════════════════════

const COMPLETENESS_BUCKETS: { key: string; label: string; check: (s: BanqueSnapshot) => boolean }[] = [
  {
    key: "dossier",
    label: "Informations dossier",
    check: (s) => !!(s.dossier?.id && s.dossier?.nom),
  },
  {
    key: "riskAnalysis",
    label: "Analyse des risques",
    check: (s) => !!(s.riskAnalysis?.globalLevel),
  },
  {
    key: "guarantees",
    label: "Garanties",
    check: (s) => !!(s.guarantees?.requested && s.guarantees.requested.length > 0),
  },
  {
    key: "documents",
    label: "Documents",
    check: (s) => !!(s.documents?.list && s.documents.list.length > 0),
  },
  {
    key: "committee",
    label: "Note de comité",
    check: (s) => !!(s.committee?.noteJson || s.committee?.decision),
  },
  {
    key: "smartScore",
    label: "SmartScore",
    check: (s) => !!(s.smartScore?.global != null && s.smartScore.global > 0),
  },
  {
    key: "market",
    label: "Données marché",
    check: (s) => !!(s.market?.ok),
  },
];

// ═══════════════════════════════════════════════════════════════════
// 1. computeCompleteness
// ═══════════════════════════════════════════════════════════════════

export function computeCompleteness(snap: BanqueSnapshot): CompletenessResult {
  const total = COMPLETENESS_BUCKETS.length;
  const missingBuckets: string[] = [];
  let filled = 0;

  for (const bucket of COMPLETENESS_BUCKETS) {
    try {
      if (bucket.check(snap)) {
        filled++;
      } else {
        missingBuckets.push(bucket.label);
      }
    } catch {
      missingBuckets.push(bucket.label);
    }
  }

  return {
    percent: total > 0 ? Math.round((filled / total) * 100) : 0,
    total,
    filled,
    missingBuckets,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. buildRiskSummary
// ═══════════════════════════════════════════════════════════════════

export function buildRiskSummary(snap: BanqueSnapshot): RiskSummary {
  const risk = snap.riskAnalysis;
  if (!risk?.globalLevel) {
    return {
      available: false,
      globalLevel: "unknown",
      globalScore: 0,
      label: "Analyse des risques non réalisée",
      highRisks: 0,
      mediumRisks: 0,
      lowRisks: 0,
      totalRisks: 0,
    };
  }

  const items = risk.items ?? [];
  const highRisks = items.filter((i) => i.level === "high" || i.level === "very_high").length;
  const mediumRisks = items.filter((i) => i.level === "medium").length;
  const lowRisks = items.filter((i) => i.level === "low").length;
  const totalRisks = items.length;

  // Build label
  const levelLabels: Record<string, string> = {
    low: "Faible",
    medium: "Modéré",
    high: "Élevé",
    very_high: "Très élevé",
  };
  const levelLabel = levelLabels[risk.globalLevel] ?? risk.globalLevel;

  let label = `Risque global : ${levelLabel}`;
  if (totalRisks > 0) {
    label += ` — ${totalRisks} risque(s) identifié(s)`;
    if (highRisks > 0) label += `, ${highRisks} élevé(s)`;
  }

  return {
    available: true,
    globalLevel: risk.globalLevel,
    globalScore: risk.subscores
      ? risk.subscores.reduce((acc, s) => acc + (s.value ?? 0), 0) / Math.max(risk.subscores.length, 1)
      : 0,
    label,
    highRisks,
    mediumRisks,
    lowRisks,
    totalRisks,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. buildMarketSummary
// ═══════════════════════════════════════════════════════════════════

export function buildMarketSummary(snap: BanqueSnapshot): MarketSummary {
  const market = snap.market;
  if (!market?.ok) {
    return {
      available: false,
      label: "Données marché non disponibles",
      prixM2Median: null,
      tensionMarche: null,
      verdict: null,
    };
  }

  const prix = (market as Record<string, unknown>).prixM2Median as number | undefined;
  const tension = (market as Record<string, unknown>).tensionMarche as string | undefined;
  const verdict = (market as Record<string, unknown>).verdict as string | undefined;

  const parts: string[] = [];
  if (verdict) parts.push(verdict);
  if (prix) parts.push(`${Math.round(prix).toLocaleString("fr-FR")} €/m²`);
  if (tension) parts.push(`Tension : ${tension}`);

  return {
    available: true,
    label: parts.length > 0 ? parts.join(" · ") : "Données marché disponibles",
    prixM2Median: prix ?? null,
    tensionMarche: tension ?? null,
    verdict: verdict ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. buildGuaranteesSummary
// ═══════════════════════════════════════════════════════════════════

export function buildGuaranteesSummary(snap: BanqueSnapshot): GuaranteesSummary {
  const g = snap.guarantees;
  if (!g?.requested || g.requested.length === 0) {
    return {
      available: false,
      label: "Garanties non renseignées",
      totalRequested: 0,
      totalObtained: 0,
      gaps: 0,
      ltvPct: null,
    };
  }

  const totalRequested = g.requested.length;
  const totalObtained = g.obtained?.length ?? 0;
  const gaps = g.gaps?.length ?? 0;
  const ltvPct = (g as Record<string, unknown>).LTV as number | undefined ?? null;

  const parts: string[] = [`${totalObtained}/${totalRequested} obtenue(s)`];
  if (gaps > 0) parts.push(`${gaps} gap(s)`);
  if (ltvPct != null) parts.push(`LTV ${ltvPct.toFixed(1)}%`);

  return {
    available: true,
    label: parts.join(" · "),
    totalRequested,
    totalObtained,
    gaps,
    ltvPct,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. computeSmartScore
// ═══════════════════════════════════════════════════════════════════

export function computeSmartScore(snap: BanqueSnapshot): {
  available: boolean;
  global: number;
  subscores: Array<{ key: string; label: string; value: number; weight: number }>;
  computedAt: string | null;
} {
  const ss = snap.smartScore;
  if (!ss || ss.global == null) {
    return {
      available: false,
      global: 0,
      subscores: [],
      computedAt: null,
    };
  }

  return {
    available: true,
    global: ss.global,
    subscores: (ss.subscores ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      value: s.value,
      weight: s.weight,
    })),
    computedAt: ss.computedAt ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. getDossierHealth
// ═══════════════════════════════════════════════════════════════════

export function getDossierHealth(snap: BanqueSnapshot): DossierHealth {
  const reasons: string[] = [];

  // Pas de dossier
  if (!snap.dossier?.id) {
    return { level: "unknown", label: "Aucun dossier sélectionné", reasons: ["Aucun dossier actif"] };
  }

  const { percent, missingBuckets } = computeCompleteness(snap);
  const risk = buildRiskSummary(snap);
  const ss = snap.smartScore;

  // Critical conditions
  if (percent < 30) reasons.push(`Complétude très faible (${percent}%)`);
  if (risk.available && risk.highRisks >= 3) reasons.push(`${risk.highRisks} risques élevés`);
  if (ss && ss.global < 30) reasons.push(`SmartScore critique (${ss.global}/100)`);

  // Warning conditions
  const warnings: string[] = [];
  if (percent < 60) warnings.push(`Complétude insuffisante (${percent}%)`);
  if (risk.available && risk.highRisks > 0 && risk.highRisks < 3) warnings.push(`${risk.highRisks} risque(s) élevé(s)`);
  if (ss && ss.global >= 30 && ss.global < 50) warnings.push(`SmartScore faible (${ss.global}/100)`);
  if (missingBuckets.length > 3) warnings.push(`${missingBuckets.length} modules manquants`);

  // Active alerts
  const activeAlerts = snap.monitoring?.alerts?.filter((a) => !a.acknowledgedAt) ?? [];
  if (activeAlerts.length > 0) warnings.push(`${activeAlerts.length} alerte(s) active(s)`);

  if (reasons.length > 0) {
    return { level: "critical", label: "Dossier critique", reasons };
  }
  if (warnings.length > 0) {
    return { level: "warning", label: "Attention requise", reasons: warnings };
  }

  return { level: "good", label: "Dossier en bonne santé", reasons: ["Tous les indicateurs sont satisfaisants"] };
}

// ═══════════════════════════════════════════════════════════════════
// 7. buildDashboardOneLiner
// ═══════════════════════════════════════════════════════════════════

export function buildDashboardOneLiner(snap: BanqueSnapshot): string {
  if (!snap.dossier?.id) return "Aucun dossier sélectionné";

  const parts: string[] = [];

  // Dossier name
  const name = snap.dossier.nom ?? snap.dossier.id;
  parts.push(name);

  // SmartScore
  if (snap.smartScore?.global != null) {
    parts.push(`Score ${snap.smartScore.global}/100`);
  }

  // Completeness
  const { percent } = computeCompleteness(snap);
  parts.push(`${percent}% complet`);

  // Statut
  if (snap.dossier.statut) {
    parts.push(snap.dossier.statut);
  }

  // Active alerts count
  const activeAlerts = snap.monitoring?.alerts?.filter((a) => !a.acknowledgedAt)?.length ?? 0;
  if (activeAlerts > 0) {
    parts.push(`${activeAlerts} alerte(s)`);
  }

  return parts.join(" · ");
}

// ═══════════════════════════════════════════════════════════════════
// BONUS: buildCommitteePayload (exporté dans le barrel index.ts)
// ═══════════════════════════════════════════════════════════════════

export function buildCommitteePayload(
  snap: BanqueSnapshot,
  _tone?: string
): CommitteePayload {
  const dossier = snap.dossier;

  return {
    dossierId: dossier?.id ?? null,
    dossierName: dossier?.nom ?? "Sans nom",
    sponsor: (dossier as Record<string, unknown>)?.sponsor as string ?? "",
    montant: (dossier as Record<string, unknown>)?.montant as number ?? 0,
    statut: dossier?.statut ?? "unknown",
    riskSummary: buildRiskSummary(snap),
    marketSummary: buildMarketSummary(snap),
    guaranteesSummary: buildGuaranteesSummary(snap),
    smartScore: snap.smartScore
      ? { global: snap.smartScore.global, subscores: snap.smartScore.subscores ?? [] }
      : null,
    completeness: computeCompleteness(snap),
    documents: {
      total: snap.documents?.list?.length ?? 0,
      required: snap.documents?.required?.length ?? 0,
      missing: snap.documents?.missing?.length ?? 0,
    },
  };
}