/**
 * AnalysePage.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Page principale Investisseur > Analyse.
 *
 * v8.1 changelog:
 * - Export PDF depuis Synthèse IA : handleExportPdfFromSynthese +
 *   prop onExportPdf passée à SyntheseIAPanel
 *
 * v8 changelog:
 * - Ancre injection BPE robuste : matche "### Lecture marché",
 *   "### Lecture marché (DVF …)", "### Marché", "### Marché / …"
 *   → insère toujours avant le prochain ###
 * - cleanNarrativeMarkdown() : supprime la "queue JSON" parasite
 *   parfois renvoyée par l'IA après "Conformité seuils Mimmoza"
 *   ou "Décision finale"
 * - buildBpeMarkdownBlock() : blank lines entre chaque bullet pour
 *   un rendu markdown propre (pas de lignes "collées")
 *
 * v7:
 * - BPE payload extraction dans buildCanonicalPayload (core.bpe)
 * - Injection BPE markdown block dans la synthèse IA (post-processing front)
 *
 * v6:
 * - Canonical dealId: activeDeal.id ?? deal.dealId (consistent key
 *   across MarcheRisquesPanel and buildCanonicalPayload)
 * - PREFETCH Marché/Risques avant Synthèse IA si absent du snapshot
 * - buildCanonicalPayload: lit DVF depuis marcheRisques.data.core.dvf
 *   et loyer/charges/travaux depuis rentabilite.inputs (nouveau bloc)
 * - Pas de "NON CALCULABLE" injustifié dans la synthèse
 * ─────────────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  readMarchandSnapshot,
  ensureActiveDeal,
  patchDueDiligenceForDeal,
  patchMarcheRisquesForDeal,
  MARCHAND_SNAPSHOT_EVENT,
} from "../../marchand/shared/marchandSnapshot.store";
import type {
  MarchandDeal,
  MarcheRisquesSaved,
  RentabiliteSaved,
  ExecutionSaved,
  SortieSaved,
} from "../../marchand/shared/marchandSnapshot.store";
import RentabilitePanel from "../components/analyse/RentabilitePanel";
import DueDiligencePanel, {
  createDefaultChecklist,
  createDefaultDocuments,
} from "../components/analyse/DueDiligencePanel";
import MarcheRisquesPanel from "../components/analyse/MarcheRisquesPanel";
import SyntheseIAPanel from "../components/analyse/SyntheseIAPanel";
import { supabase } from "../../../lib/supabaseClient";
import { exportSnapshotToPdf } from "../../marchand/services/exportPdf";
import {
  fetchMarketStudyPromoteur,
  type MarketStudyResult,
} from "../services/marketStudyPromoteur.service";
import type {
  StrategyType,
  FiscalRegime,
  DueDiligenceState,
  AnalyseState,
  AnalyseTab,
} from "../types/strategy.types";

// ─── Tab config ──────────────────────────────────────────────────────

const ANALYSE_TABS: { key: AnalyseTab; label: string }[] = [
  { key: "rentabilite", label: "💰 Rentabilité" },
  { key: "due_diligence", label: "📋 Due Diligence" },
  { key: "marche_risques", label: "📊 Marché / Risques" },
  { key: "synthese_ia", label: "🤖 Synthèse IA" },
];

const VALID_TABS = new Set<string>(ANALYSE_TABS.map((t) => t.key));

function isValidTab(v: string | null): v is AnalyseTab {
  return v != null && VALID_TABS.has(v);
}

// ─── Hook: deal actif Marchand ───────────────────────────────────────

function useActiveMarchandDeal() {
  const [deal, setDeal] = useState<MarchandDeal | null>(() => ensureActiveDeal());

  useEffect(() => {
    const handleSnapshotEvent = () => setDeal(ensureActiveDeal());
    const handleStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes("marchand_snapshot")) {
        setDeal(ensureActiveDeal());
      }
    };

    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, handleSnapshotEvent);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, handleSnapshotEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return deal;
}

// ─── Mapping MarchandDeal → DealInputs ───────────────────────────────

interface DealInputs {
  dealId: string;
  label: string;
  address: string;
  zipCode: string;
  city: string;
  prixAchat: number;
  surfaceM2: number;
  prixReventeCible: number;
  dpeNote: string;
  lat?: number;
  lng?: number;
}

function mapMarchandDealToDealInputs(deal: MarchandDeal): DealInputs {
  return {
    dealId: deal.id ?? "",
    label: deal.title ?? "Sans titre",
    address: deal.address ?? "",
    zipCode: deal.zipCode ?? "",
    city: deal.city ?? "",
    prixAchat: deal.prixAchat ?? 0,
    surfaceM2: deal.surfaceM2 ?? 0,
    prixReventeCible: deal.prixReventeCible ?? 0,
    dpeNote: (deal as any).dpeNote ?? (deal as any).dpe ?? "—",
    lat: (deal as any).lat ?? (deal as any).latitude ?? undefined,
    lng: (deal as any).lng ?? (deal as any).longitude ?? undefined,
  };
}

// ─── localStorage persistence (analyse state) ───────────────────────

const ANALYSE_STORAGE_PREFIX = "mimmoza_analyse_";

function loadAnalyseState(dealId: string): AnalyseState | null {
  try {
    const raw = localStorage.getItem(`${ANALYSE_STORAGE_PREFIX}${dealId}`);
    if (!raw) return null;
    return JSON.parse(raw) as AnalyseState;
  } catch {
    return null;
  }
}

function saveAnalyseState(dealId: string, state: AnalyseState): void {
  try {
    localStorage.setItem(`${ANALYSE_STORAGE_PREFIX}${dealId}`, JSON.stringify(state));
  } catch (e) {
    console.warn("[AnalysePage] Failed to save analyse state:", e);
  }
}

function createDefaultDueDiligence(): DueDiligenceState {
  return {
    checklist: createDefaultChecklist(),
    documents: createDefaultDocuments(),
    risquesNonFinanciers: [],
  };
}

// ─── Safe number extraction ──────────────────────────────────────────

/** Return v if it's a finite number, else undefined */
function safeNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** First defined finite number from a list of candidates */
function firstNum(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    const n = safeNum(c);
    if (n != null) return n;
  }
  return undefined;
}

// ─── BPE utilities (post-processing front pour Synthèse IA) ─────────

function getBpeLevel(score: number): string {
  if (score >= 80) return "TRÈS FORT";
  if (score >= 65) return "FORT";
  if (score >= 50) return "MOYEN";
  if (score >= 35) return "FAIBLE";
  return "TRÈS FAIBLE";
}

function getBpeLiquiditeImpact(score: number): string {
  if (score >= 65) return "Liquidité soutenue — friction de sortie faible.";
  if (score >= 50) return "Impact neutre — dépend du pricing et de la qualité intrinsèque du bien.";
  return "Friction de sortie probable — prime à la décote à anticiper.";
}

function getBpeRisqueDelai(score: number): string {
  if (score >= 65) return "Risque délai modéré — forte demande liée au cadre de vie.";
  if (score >= 50) return "Risque délai moyen — attractivité correcte mais non différenciante.";
  return "Risque délai élevé — faible attractivité, délai de commercialisation allongé.";
}

function nd(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "ND";
}

/**
 * v8: blank line between each bullet for clean markdown rendering.
 * Fallback score_v2 → score legacy ; ND si coverage absent.
 */
function buildBpeMarkdownBlock(bpe: any): string | null {
  const hasV2 = bpe?.score_v2 != null;
  const score = hasV2 ? bpe.score_v2 : bpe?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;

  const source = hasV2 ? (bpe?.source_v2 ?? "bpe-score-v2") : "legacy (fallback)";
  const level = getBpeLevel(score);

  const coveragePct =
    bpe?.coverage_pct_v2 != null && Number.isFinite(bpe.coverage_pct_v2)
      ? `${Math.round(bpe.coverage_pct_v2)}%`
      : "ND";

  const maybeCoverageCats =
    bpe?.coverage_v2 != null ? ` (${bpe.coverage_v2} catégories couvertes)` : "";

  // v8: each bullet separated by a blank line → no "collage" in renderers
  return [
    "",
    "### Équipements & cadre de vie (BPE)",
    "",
    `BPE Score : **${Math.round(score)}/100** — **${level}** (source : ${source})`,
    `Couverture : **${coveragePct}**${maybeCoverageCats}`,
    "",
    `- **Impact liquidité** : ${getBpeLiquiditeImpact(score)}`,
    "",
    `- **Impact risque délai** : ${getBpeRisqueDelai(score)}`,
    "",
    `- **Drivers** : Écoles (${nd(bpe?.nb_ecoles)}) · Commerces (${nd(bpe?.commerces?.count)}) · Santé (${nd(bpe?.sante?.count)}) · Pharmacies (${nd(bpe?.nb_pharmacies)}) · Supermarchés (${nd(bpe?.nb_supermarches)})`,
    "",
  ].join("\n");
}

/**
 * v8: Robust anchor — matches all common IA heading variants:
 *   "### Lecture marché"
 *   "### Lecture marché (DVF …)"
 *   "### Marché"
 *   "### Marché / Risques"
 *   "### Marché et …"
 * Inserts BPE block before the NEXT ### after the matched anchor.
 */
function injectBpeIntoNarrative(narrative: string, bpe: any): string {
  const block = buildBpeMarkdownBlock(bpe);
  if (!block) return narrative;

  // v8: robust anchor
  // Matches "### Lecture marché …" OR "### Marché …" (with any suffix on same line)
  // [Mm]arch[éeè] handles accent variants the IA may produce
  const anchorPattern = /^###\s+(?:Lecture\s+)?[Mm]arch[éeè][^\n]*/im;
  const anchorMatch = anchorPattern.exec(narrative);

  if (anchorMatch) {
    const anchorEnd = anchorMatch.index + anchorMatch[0].length;
    const rest = narrative.slice(anchorEnd);
    // Find the next ### section heading after the anchor
    const nextSectionMatch = /^###\s+/m.exec(rest);
    if (nextSectionMatch) {
      const insertPos = anchorEnd + nextSectionMatch.index;
      return (
        narrative.slice(0, insertPos).trimEnd() +
        "\n\n" +
        block.trim() +
        "\n\n" +
        narrative.slice(insertPos)
      );
    }
    // No next section found — append at end
    return narrative.trimEnd() + "\n\n" + block.trim() + "\n";
  }

  // No anchor found at all — append at end
  return narrative.trimEnd() + "\n\n" + block.trim() + "\n";
}

// ─── Clean narrative markdown (v8) ───────────────────────────────────

/**
 * Supprime la "queue JSON" parasite que l'IA renvoie parfois à la fin
 * de la narrative (ex: `,"marketingMonths": {...}` ou `\n{...}`).
 *
 * Stratégie sûre :
 * 1) Cherche un marqueur de fin légitime :
 *    - "Conformité seuils Mimmoza" (table de fin)
 *    - "Décision finale"
 *    - "---" (séparateur horizontal en fin de doc)
 * 2) Après ce marqueur + le contenu markdown restant de sa section,
 *    si on détecte un début de JSON parasite on tronque.
 * 3) Fallback global : si le texte se termine par du JSON on le retire.
 * 4) Collapse excessive blank lines (4+ → 2).
 *
 * Ne touche jamais au contenu markdown légitime.
 */
function cleanNarrativeMarkdown(raw: string): string {
  let text = raw;

  // ── Pattern: JSON tail after a known end-marker ────────────────
  const endMarkers = [
    /Conformit[ée]\s+seuils\s+Mimmoza/i,
    /D[ée]cision\s+finale/i,
    /^---\s*$/m,
  ];

  for (const marker of endMarkers) {
    const m = marker.exec(text);
    if (!m) continue;

    const fromMarker = text.slice(m.index);

    // Look for a JSON-like tail: line starting with ," or { or "key":
    // but NOT inside a markdown table row (starts with |)
    const jsonTailPattern = /\n\s*(?:,\s*"|"\w+":\s*[{\["0-9]|[{[])/m;
    const jsonTailMatch = jsonTailPattern.exec(fromMarker);
    if (jsonTailMatch) {
      const cutPos = m.index + jsonTailMatch.index;
      const candidate = text.slice(cutPos);
      // Safety: don't cut inside a markdown table row
      if (!/^\s*\|/.test(candidate)) {
        text = text.slice(0, cutPos).trimEnd();
        break;
      }
    }
  }

  // ── Fallback: global trailing JSON cleanup ─────────────────────
  // If the text ends with a JSON fragment (after real markdown), strip it.
  const trailingJsonPattern = /\n\s*(?:,\s*"[^"]+"\s*:|[{\[])\s*[\s\S]{0,2000}$/;
  const trailingMatch = trailingJsonPattern.exec(text);
  if (trailingMatch) {
    const before = text.slice(0, trailingMatch.index);
    // Only strip if the preceding content has markdown headings
    if (/^###\s+/m.test(before)) {
      text = before.trimEnd();
    }
  }

  // ── Collapse excessive blank lines (4+ → 2 blank lines) ───────
  text = text.replace(/\n{4,}/g, "\n\n\n");

  return text;
}

// ─── Prefetch Marché/Risques helper ──────────────────────────────────

/**
 * Vérifie si le snapshot contient déjà des données Marché/Risques pour
 * ce deal (avec DVF). Si non, appelle l'edge function et persiste.
 * Ne throw jamais — retourne un booléen de succès.
 */
async function prefetchMarcheRisquesIfNeeded(
  dealId: string,
  dealInputs: { address: string; zipCode: string; city: string; lat?: number; lng?: number }
): Promise<boolean> {
  const snap = readMarchandSnapshot();
  const existing = snap.marcheRisquesByDeal[dealId] as Record<string, any> | undefined;

  // Check if we already have DVF data
  const existingData = existing?.data as Record<string, any> | undefined;
  const hasDvf =
    existingData?.core?.dvf != null ||
    existingData?.dvf != null ||
    existing?.core?.dvf != null;

  if (existing && hasDvf) {
    console.log("[AnalysePage] Marché/Risques déjà présent dans le snapshot, skip prefetch.");
    return true;
  }

  console.log("[AnalysePage] Marché/Risques absent — lancement du prefetch…");

  try {
    const res = await fetchMarketStudyPromoteur({
      address: dealInputs.address,
      zipCode: dealInputs.zipCode,
      city: dealInputs.city,
      lat: dealInputs.lat,
      lng: dealInputs.lng,
      project_type: "logement",
      radius_km: 5,
      debug: false,
    });

    if (res.ok) {
      const data: MarketStudyResult = res.data;
      const s = data.scores;
      patchMarcheRisquesForDeal(dealId, {
        data,
        scoreGlobal: s?.global,
        breakdown: {
          demande: s?.demande,
          offre: s?.offre,
          accessibilite: s?.accessibilite,
          environnement: s?.environnement,
        },
        updatedAt: new Date().toISOString(),
      });
      console.log("[AnalysePage] Prefetch Marché/Risques OK — snapshot mis à jour.");
      return true;
    } else {
      console.warn("[AnalysePage] Prefetch Marché/Risques échoué:", res.error);
      return false;
    }
  } catch (err) {
    console.warn("[AnalysePage] Prefetch Marché/Risques erreur inattendue:", err);
    return false;
  }
}

// ─── Canonical payload builder (snapshot → synthese-ia-v1) ──────────

function buildCanonicalPayload(
  deal: DealInputs,
  activeDeal: MarchandDeal,
  canonicalDealId: string
): Record<string, unknown> {
  // v6: use the canonical dealId (not deal.dealId which may differ)
  const dealId = canonicalDealId;
  const snap = readMarchandSnapshot();

  // Module data from snapshot
  const rentabilite = snap.rentabiliteByDeal[dealId] ?? null;
  const execution = snap.executionByDeal[dealId] ?? null;
  const sortie = snap.sortieByDeal[dealId] ?? null;
  const dueDiligence = snap.dueDiligenceByDeal[dealId] ?? null;
  const marcheRisques = snap.marcheRisquesByDeal[dealId] ?? null;

  // Typed aliases for safe access
  const mr = marcheRisques as Record<string, any> | null;
  const mrData = (mr?.data ?? null) as Record<string, any> | null;
  const renta = rentabilite as Record<string, any> | null;
  const rentaInputs = (renta?.inputs ?? null) as Record<string, any> | null;
  const rentaComputed = (renta?.computed ?? renta?.results ?? renta?.output ?? null) as Record<string, any> | null;
  const execData = execution as ExecutionSaved | null;
  const sortieData = sortie as SortieSaved | null;
  const ad = activeDeal as any;

  // ══════════════════════════════════════════════════════════════════
  // 1) DVF: exhaustive fallback chain (v5)
  // ══════════════════════════════════════════════════════════════════
  const dvfCore =
    mrData?.core?.dvf ??        // data.core.dvf  (standard nested — prefetch stores here)
    mrData?.dvf ??              // data.dvf        (flat in data)
    mr?.core?.dvf ??            // core.dvf        (no data wrapper)
    mr?.dvf ??                  // dvf             (flat on module root)
    mrData?.dvfData ??          // data.dvfData    (alternative key)
    mrData?.core?.dvfData ??    // data.core.dvfData
    null;

  // Normalise DVF fields: support both snake_case and camelCase
  let dvfPayload: Record<string, unknown> | undefined;
  if (dvfCore && typeof dvfCore === "object") {
    const prixM2Median = firstNum(
      dvfCore.prix_m2_median,
      dvfCore.prixM2Median,
      dvfCore.medianPriceM2,
      dvfCore.median_price_m2,
    );
    const nbTransactions = firstNum(
      dvfCore.nb_transactions,
      dvfCore.nbTransactions,
      dvfCore.count,
      dvfCore.total,
    );
    const transactions = dvfCore.transactions ?? dvfCore.items ?? dvfCore.list ?? undefined;

    // Only emit dvf if we have at least one meaningful value
    if (prixM2Median != null || nbTransactions != null) {
      dvfPayload = {
        prix_m2_median: prixM2Median,
        nb_transactions: nbTransactions,
        ...(transactions ? { transactions } : {}),
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 2) Prix
  // ══════════════════════════════════════════════════════════════════
  const prixAchat = deal.prixAchat ?? 0;
  const surfaceM2 = deal.surfaceM2 ?? 0;
  const prixM2 = surfaceM2 > 0 ? Math.round((prixAchat / surfaceM2) * 10) / 10 : null;

  // ══════════════════════════════════════════════════════════════════
  // 3) SmartScore: priorité rentabilite.computed puis marcheRisques.scoreGlobal
  // ══════════════════════════════════════════════════════════════════
  const smartScore = firstNum(
    // a) Computed by RentabilitePanel
    rentaComputed?.smartScore,
    rentaComputed?.score,
    renta?.smartScore,
    // b) MarcheRisquesPanel scoreGlobal (top-level on module)
    mr?.scoreGlobal,
    mr?.score,
    // c) MarcheRisquesPanel data.scores.global (from prefetch)
    mrData?.scores?.global,
    // d) MarcheRisquesPanel data.smartScore / data.score
    mrData?.smartScore,
    mrData?.score,
    mrData?.scoreGlobal,
    // e) ActiveDeal enriched/scores
    ad?.smartScore,
    ad?.enriched?.smartScore,
    ad?.enriched?.score,
    ad?.scores?.smartScore,
    ad?.scores?.global,
  );

  // ══════════════════════════════════════════════════════════════════
  // 4) Travaux / Loyer / Charges: from rentabilite.inputs (new bloc)
  // ══════════════════════════════════════════════════════════════════
  const travauxEstimes = firstNum(
    rentaInputs?.travauxEstimes,
    rentaInputs?.travaux,
    rentaInputs?.montantTravaux,
    rentaInputs?.coutTravaux,
    rentaComputed?.travauxEstimes,
    ad?.travauxEstimes,
    ad?.travaux,
    ad?.enriched?.travauxEstimes,
  );

  const loyerEstime = firstNum(
    rentaInputs?.loyerEstime,
    rentaInputs?.loyerMensuel,
    rentaInputs?.loyer,
    rentaComputed?.loyerEstime,
    rentaComputed?.loyerMensuel,
    ad?.loyerEstime,
    ad?.loyerMensuel,
    ad?.enriched?.loyerEstime,
  );

  const chargesEstimees = firstNum(
    rentaInputs?.chargesEstimees,
    rentaInputs?.charges,
    rentaInputs?.chargesMensuelles,
    rentaComputed?.chargesEstimees,
    ad?.chargesEstimees,
    ad?.charges,
  );

  const chargesUnit: string | undefined =
    rentaInputs?.chargesUnit ??
    rentaInputs?.chargesUnite ??
    ad?.chargesUnit ??
    undefined;

  // ══════════════════════════════════════════════════════════════════
  // 5) Rendement brut / net
  // ══════════════════════════════════════════════════════════════════
  const rendementBrut = firstNum(
    rentaComputed?.rendementBrut,
    rentaComputed?.yieldBrut,
    renta?.rendementBrut,
  );
  const rendementNet = firstNum(
    rentaComputed?.rendementNet,
    rentaComputed?.yieldNet,
    renta?.rendementNet,
  );
  const cashflowMensuel = firstNum(
    rentaComputed?.cashflowMensuel,
    rentaComputed?.cashflow,
    renta?.cashflowMensuel,
  );

  // ══════════════════════════════════════════════════════════════════
  // 6) Timeline
  // ══════════════════════════════════════════════════════════════════

  // worksMonths from execution phases
  let worksMonths: number | undefined;
  if (execData?.phases && Array.isArray(execData.phases)) {
    const total = (execData.phases as any[]).reduce(
      (sum: number, p: any) =>
        sum + (safeNum(p?.durationMonths) ?? safeNum(p?.duration) ?? safeNum(p?.duree) ?? 0),
      0
    );
    if (total > 0) worksMonths = total;
  }
  if (worksMonths == null) {
    worksMonths = firstNum(
      (execData as any)?.totalMonths,
      (execData as any)?.dureeTotale,
      (execData as any)?.dureeTravauxMois,
    );
  }

  // holdingMonths: priority rentabilite.inputs.dureeMois > sortie.scenarios[0].delaiMois
  const rentaDureeMois = safeNum(rentaInputs?.dureeMois);
  const rentaDureeAnnees = safeNum(rentaInputs?.dureeAnnees);
  const holdingFromRenta: number | undefined =
    rentaDureeMois != null
      ? rentaDureeMois
      : rentaDureeAnnees != null
      ? rentaDureeAnnees * 12
      : undefined;

  let holdingFromSortie: number | undefined;
  if (sortieData?.scenarios && Array.isArray(sortieData.scenarios)) {
    const firstScenario = (sortieData.scenarios as any[]).find((s: any) => s != null);
    if (firstScenario) {
      holdingFromSortie = firstNum(
        firstScenario.holdingMonths,
        firstScenario.delaiMois,
        firstScenario.dureeMois,
        firstScenario.holding,
      );
    }
  }

  const holdingMonths = firstNum(holdingFromRenta, holdingFromSortie);

  // marketingMonths
  let marketingMonths: number | undefined;
  if (sortieData?.scenarios && Array.isArray(sortieData.scenarios)) {
    const firstScenario = (sortieData.scenarios as any[]).find((s: any) => s != null);
    if (firstScenario) {
      marketingMonths = firstNum(
        firstScenario.marketingMonths,
        firstScenario.delaiCommercialisation,
        firstScenario.commercialisationMois,
      );
    }
  }

  const hasTimeline =
    worksMonths != null || holdingMonths != null || marketingMonths != null;

  // ══════════════════════════════════════════════════════════════════
  // 7) Scores breakdown from Marché/Risques (v5: include for IA context)
  // ══════════════════════════════════════════════════════════════════
  const scoresBreakdown = mr?.breakdown ?? mrData?.scores ?? undefined;

  // ══════════════════════════════════════════════════════════════════
  // 7bis) BPE (pour injection Synthèse IA) — depuis Marché/Risques
  // ══════════════════════════════════════════════════════════════════
  const bpeCore =
    mrData?.core?.bpe ??  // market-study core.bpe (v1.4.5 expose score_v2 ici)
    mrData?.bpe ??        // fallback si structure différente
    mr?.core?.bpe ??
    mr?.bpe ??
    null;

  const bpePayload =
    bpeCore && typeof bpeCore === "object"
      ? {
          // v2
          score_v2: firstNum(bpeCore.score_v2),
          coverage_pct_v2: firstNum(bpeCore.coverage_pct_v2),
          coverage_v2: bpeCore.coverage_v2 ?? undefined,
          source_v2: bpeCore.source_v2 ?? undefined,

          // legacy + drivers utiles
          score: firstNum(bpeCore.score),
          nb_ecoles: firstNum(bpeCore.nb_ecoles),
          nb_pharmacies: firstNum(bpeCore.nb_pharmacies),
          nb_supermarches: firstNum(bpeCore.nb_supermarches),
          commerces: bpeCore.commerces ?? undefined,
          sante: bpeCore.sante ?? undefined,
        }
      : undefined;

  // ══════════════════════════════════════════════════════════════════
  // 8) Assemble canonical payload
  // ══════════════════════════════════════════════════════════════════
  const canonical: Record<string, unknown> = {
    // Identité bien
    prixAchat,
    surfaceM2,
    prixM2,
    prixRevente: deal.prixReventeCible || undefined,
    localisation: [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", "),
    lat: deal.lat,
    lng: deal.lng,

    // SmartScore
    smartScore,

    // DVF (omitted if empty)
    ...(dvfPayload ? { dvf: dvfPayload } : {}),

    // Scores breakdown from Marché/Risques
    ...(scoresBreakdown ? { scoresMarche: scoresBreakdown } : {}),

    // BPE (omitted if empty)
    ...(bpePayload ? { bpe: bpePayload } : {}),

    // Rentabilité inputs
    travauxEstimes,
    loyerEstime,
    chargesEstimees,
    chargesUnit,

    // Rendement computed
    rendementBrut,
    rendementNet,
    cashflowMensuel,

    // Timeline (omitted if empty)
    ...(hasTimeline
      ? {
          timeline: {
            ...(worksMonths != null ? { worksMonths } : {}),
            ...(holdingMonths != null ? { holdingMonths } : {}),
            ...(marketingMonths != null ? { marketingMonths } : {}),
          },
        }
      : {}),

    // Bien
    typeBien: ad?.typeBien ?? undefined,
    etatBien: ad?.etatBien ?? undefined,
  };

  // Full module blobs for deep analysis
  const payload: Record<string, unknown> = {
    ...canonical,
    rentabilite: rentabilite ?? undefined,
    execution: execution ?? undefined,
    sortie: sortie ?? undefined,
    dueDiligence: dueDiligence ?? undefined,
    marcheRisques: marcheRisques ?? undefined,
  };

  return payload;
}

// ─── Empty state component ───────────────────────────────────────────

function NoDealPlaceholder() {
  return (
    <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
        <div className="text-5xl mb-4">📭</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Aucun deal actif
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          Va dans le Pipeline et sélectionne un deal actif pour lancer
          l'analyse de rentabilité.
        </p>
        <Link
          to="/marchand-de-bien"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <span>🔀</span>
          Aller au Pipeline
        </Link>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────

export default function AnalysePage() {
  const activeDeal = useActiveMarchandDeal();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab from query param
  const tabParam = searchParams.get("tab");
  const initialTab: AnalyseTab = isValidTab(tabParam) ? tabParam : "rentabilite";
  const [activeTab, setActiveTab] = useState<AnalyseTab>(initialTab);

  useEffect(() => {
    const qTab = searchParams.get("tab");
    if (isValidTab(qTab) && qTab !== activeTab) {
      setActiveTab(qTab);
    }
  }, [searchParams, activeTab]);

  const handleTabChange = useCallback(
    (tab: AnalyseTab) => {
      setActiveTab(tab);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === "rentabilite") {
            next.delete("tab");
          } else {
            next.set("tab", tab);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [strategy, setStrategy] = useState<StrategyType>("location");
  const [fiscalRegime, setFiscalRegime] = useState<FiscalRegime>("lmnp_reel");
  const [dueDiligence, setDueDiligence] = useState<DueDiligenceState>(
    createDefaultDueDiligence
  );

  // Guard: avoid patching snapshot when DD was just loaded (prevents infinite loop)
  const ddJustLoadedRef = useRef(false);

  // Map deal actif → DealInputs
  const deal = useMemo<DealInputs | null>(
    () => (activeDeal ? mapMarchandDealToDealInputs(activeDeal) : null),
    [activeDeal]
  );

  // v6: Canonical dealId — single source of truth for snapshot keys
  const canonicalDealId = useMemo<string>(
    () => activeDeal?.id ?? deal?.dealId ?? "",
    [activeDeal?.id, deal?.dealId]
  );

  // Load persisted analyse state when deal changes
  useEffect(() => {
    if (!canonicalDealId) return;
    ddJustLoadedRef.current = true;

    const saved = loadAnalyseState(canonicalDealId);
    if (saved) {
      setStrategy(saved.strategy);
      setFiscalRegime(saved.fiscalRegime);
      setDueDiligence(saved.dueDiligence);
    } else {
      setStrategy("location");
      setFiscalRegime("lmnp_reel");
      setDueDiligence(createDefaultDueDiligence());
    }

    // Release guard after a tick
    requestAnimationFrame(() => {
      ddJustLoadedRef.current = false;
    });
  }, [canonicalDealId]);

  // Auto-save: localStorage + snapshot Marchand (DD)
  useEffect(() => {
    if (!canonicalDealId) return;

    const state: AnalyseState = {
      strategy,
      fiscalRegime,
      scenarios: [],
      dueDiligence,
    };
    saveAnalyseState(canonicalDealId, state);

    // Persist DD into Marchand snapshot (skip on initial load to avoid loop)
    if (!ddJustLoadedRef.current) {
      patchDueDiligenceForDeal(canonicalDealId, {
        state: dueDiligence,
        updatedAt: new Date().toISOString(),
      });
    }
  }, [strategy, fiscalRegime, dueDiligence, canonicalDealId]);

  // Extract existing risks from enriched data
  const risquesExistants = useMemo(() => {
    if (!activeDeal) return [];
    const enriched = (activeDeal as any)?.enriched;
    if (!enriched?.risques) return [];
    const r = enriched.risques;
    const items: string[] = [];
    if (r.items && Array.isArray(r.items)) {
      r.items.forEach((item: any) => {
        if (typeof item === "string") items.push(item);
        else if (item?.label) items.push(item.label);
      });
    }
    if (r.nbRisques && r.nbRisques > 0 && items.length === 0) {
      items.push(
        `${r.nbRisques} risque(s) identifié(s) — détails à consulter sur Géorisques.`
      );
    }
    return items;
  }, [activeDeal]);

  const handleDueDiligenceUpdate = useCallback(
    (dd: DueDiligenceState) => setDueDiligence(dd),
    []
  );

  // No active deal → placeholder
  if (!deal || !canonicalDealId) return <NoDealPlaceholder />;

  const fmt = (v: number | undefined | null) =>
    v != null && v > 0 ? v.toLocaleString("fr-FR") : "—";

  // ── Export PDF depuis Synthèse IA (v8.1) ─────────────────────────────
  const handleExportPdfFromSynthese = useCallback(
    (markdown: string) => {
      const snapshot = readMarchandSnapshot();
      const now = new Date().toISOString();
      exportSnapshotToPdf(snapshot, {
        aiReport: {
          narrativeMarkdown: markdown,
          generatedAt: now,
        },
        context: {
          generatedAt: now,
        },
        space: "investisseur",
      });
    },
    []
  );

  // ── Synthèse IA: prefetch Marché/Risques + canonical payload ────────

  /** Emit progress event consumed by SyntheseIAPanel's progress bar */
  const emitProgress = useCallback((pct: number, label: string) => {
    window.dispatchEvent(
      new CustomEvent("mimmoza:synthese:progress", { detail: { pct, label } })
    );
  }, []);

  const handleGenerateSyntheseIA = useCallback(async () => {
    if (!activeDeal || !deal) throw new Error("Aucun deal actif");

    emitProgress(5, "Initialisation…");

    // ── Step 1: Prefetch Marché/Risques if not already in snapshot ──
    emitProgress(10, "Chargement données marché…");
    const prefetchOk = await prefetchMarcheRisquesIfNeeded(canonicalDealId, {
      address: deal.address,
      zipCode: deal.zipCode,
      city: deal.city,
      lat: deal.lat,
      lng: deal.lng,
    });

    if (!prefetchOk) {
      console.warn("[AnalysePage] Synthèse IA: Marché/Risques non disponible — synthèse partielle possible.");
    }

    // ── Step 2: Build canonical payload from snapshot (re-read after prefetch) ──
    emitProgress(30, "Construction du dossier d'analyse…");
    const payload = buildCanonicalPayload(deal, activeDeal, canonicalDealId);

    // 🔎 TEMP DEBUG — vérifier le payload dans la console
    console.log("=== CANONICAL PAYLOAD (v8) ===");
    console.log(JSON.stringify(payload, null, 2));

    // ── Step 3: Call Edge Function ──
    emitProgress(40, "Analyse IA en cours…");
    const { data, error } = await supabase.functions.invoke("synthese-ia-v1", {
      body: payload,
    });

    if (error) throw new Error(error.message || "Erreur Edge Function");
    if (!data?.ok) throw new Error(data?.error || "Réponse invalide (ok=false)");
    if (typeof data?.narrative !== "string" || !data.narrative.trim()) {
      throw new Error("Réponse invalide: narrative manquante");
    }

    // ── Step 4: Inject BPE block into narrative (front post-processing) ──
    emitProgress(80, "Enrichissement BPE…");
    const withBpe = injectBpeIntoNarrative(data.narrative, (payload as any).bpe);

    // ── Step 5: Clean trailing JSON artefacts + normalize whitespace (v8) ──
    emitProgress(90, "Nettoyage et mise en forme…");
    const cleaned = cleanNarrativeMarkdown(withBpe);

    emitProgress(100, "Synthèse prête !");
    return { markdown: cleaned };
  }, [activeDeal, deal, canonicalDealId, emitProgress]);

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span className="text-2xl">📈</span>
                Analyse de rentabilité
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-sm text-gray-500">
                  {[deal.address, deal.zipCode, deal.city]
                    .filter(Boolean)
                    .join(", ") || "Adresse non renseignée"}
                  {" — "}
                  {deal.label}
                </p>
                <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded">
                  {deal.label}
                </span>
                <span className="text-xs text-gray-400">{canonicalDealId}</span>
              </div>
            </div>
            <div className="text-right text-xs text-gray-400">
              <p>
                Prix:{" "}
                <strong className="text-gray-600">{fmt(deal.prixAchat)} €</strong>
              </p>
              <p>
                {fmt(deal.surfaceM2)} m² · DPE {deal.dpeNote}
              </p>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 mt-4 bg-gray-100 p-1 rounded-lg w-fit">
            {ANALYSE_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`px-5 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === key
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {activeTab === "rentabilite" && (
          <RentabilitePanel
            deal={deal}
            strategy={strategy}
            fiscalRegime={fiscalRegime}
            onStrategyChange={setStrategy}
            onRegimeChange={setFiscalRegime}
          />
        )}

        {activeTab === "due_diligence" && (
          <DueDiligencePanel
            state={dueDiligence}
            onUpdate={handleDueDiligenceUpdate}
            risquesExistants={risquesExistants}
          />
        )}

        {activeTab === "marche_risques" && (
          <MarcheRisquesPanel
            dealId={canonicalDealId}
            dealInputs={{
              address: deal.address,
              zipCode: deal.zipCode,
              city: deal.city,
              lat: deal.lat,
              lng: deal.lng,
            }}
          />
        )}

        {activeTab === "synthese_ia" && (
          <SyntheseIAPanel
            dealLabel={deal.label}
            isAvailable={true}
            onGenerate={handleGenerateSyntheseIA}
            onExportPdf={handleExportPdfFromSynthese}
          />
        )}
      </div>
    </div>
  );
}