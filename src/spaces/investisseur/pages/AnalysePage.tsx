/**
 * AnalysePage.tsx
 * ─────────────────────────────────────────────────────────────────────
 * v12.4 changelog:
 * - Suppression complète de toute référence wikimedia :
 *   deepFindWikimedia, wikimediaExtract, wikimediaFromExport,
 *   AiReportCache.wikimedia, contexte wikimedia dans PDF opts,
 *   section "Contexte du secteur" dans injectSyntheseExpress.
 * - pickObj / pickVal supprimés (plus utilisés).
 * - supabase import supprimé (export-report-v1 supprimé en v12.3).
 * - Code restant inchangé.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildSnapshotPdfBlob, exportSnapshotToPdf } from "../../marchand/services/exportPdf";
import { computeLoanCost } from "../../marchand/services/loanCost";
import type {
  ExecutionSaved,
  MarchandDeal,
  RentabiliteSaved,
  SortieSaved
} from "../../marchand/shared/marchandSnapshot.store";
import {
  ensureActiveDeal,
  MARCHAND_SNAPSHOT_EVENT,
  patchDueDiligenceForDeal,
  patchMarcheRisquesForDeal,
  readMarchandSnapshot,
} from "../../marchand/shared/marchandSnapshot.store";
import AnalysePredictivePanel from "../components/analyse/AnalysePredictivePanel";
import DueDiligencePanel, {
  createDefaultChecklist,
  createDefaultDocuments,
} from "../components/analyse/DueDiligencePanel";
import MarcheRisquesPanel from "../components/analyse/MarcheRisquesPanel";
import RentabilitePanel from "../components/analyse/RentabilitePanel";
import SyntheseIAPanel from "../components/analyse/SyntheseIAPanel";
import {
  fetchMarketStudyPromoteur,
  type MarketStudyResult,
} from "../services/marketStudyPromoteur.service";
import type { InvestisseurTravauxSnapshot } from "../shared/investisseurSnapshot.store";
import { getInvestisseurSnapshot } from "../shared/investisseurSnapshot.store";
import type {
  AnalyseState,
  AnalyseTab,
  DueDiligenceState,
  FiscalRegime,
  StrategyType,
} from "../types/strategy.types";

import coverImageUrl from "@/assets/image-investissement-immo.png";
import logoMimmozaUrl from "@/assets/logo-mimmoza-baseline.png";
import { loadImageDataUrl } from "@/spaces/shared/loadImageDataUrl";
import { deepMergeInvestorWithPromoteur } from "../services/promoteurMarketStudyBridge";
import { readPromoteurMarketSnapshot } from "../services/readPromoteurMarketSnapshot";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ─── Design tokens — Investisseur ────────────────────────────────────

const GRAD_INV   = "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
const ACCENT_INV = "#1a72c4";

// ─── Tab valides ──────────────────────────────────────────────────────

const VALID_ANALYSE_TABS = new Set<string>([
  "rentabilite",
  "due_diligence",
  "marche_risques",
  "analyse_predictive",
  "synthese_ia",
]);

function resolveAnalyseTab(raw: string | null): AnalyseTab {
  if (raw && VALID_ANALYSE_TABS.has(raw)) return raw as AnalyseTab;
  return "rentabilite";
}

// ─── Hook: deal actif Marchand ───────────────────────────────────────

function useActiveMarchandDeal() {
  const [deal, setDeal] = useState<MarchandDeal | null>(() => ensureActiveDeal());
  useEffect(() => {
    const handleSnapshotEvent = () => setDeal(ensureActiveDeal());
    const handleStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes("marchand_snapshot")) setDeal(ensureActiveDeal());
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

// ─── Hook: travaux depuis snapshot Investisseur ───────────────────────

function useInvestisseurTravaux(): InvestisseurTravauxSnapshot | null {
  const [travaux, setTravaux] = useState<InvestisseurTravauxSnapshot | null>(() => {
    const snap = getInvestisseurSnapshot();
    const pid = snap.activeProjectId;
    if (!pid) return null;
    return snap.projects[pid]?.execution?.travaux ?? null;
  });
  useEffect(() => {
    const refresh = () => {
      const snap = getInvestisseurSnapshot();
      const pid = snap.activeProjectId;
      if (!pid) { setTravaux(null); return; }
      setTravaux(snap.projects[pid]?.execution?.travaux ?? null);
    };
    const onStorage = (e: StorageEvent) => { if (e.key && e.key.includes("investisseur")) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("mimmoza:investisseur:snapshot", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mimmoza:investisseur:snapshot", refresh);
    };
  }, []);
  return travaux;
}

// ─── DealInputs ──────────────────────────────────────────────────────

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
    dpeNote: (deal as unknown as { dpeNote?: string; dpe?: string }).dpeNote
      ?? (deal as unknown as { dpe?: string }).dpe ?? "—",
    lat: (deal as unknown as { lat?: number; latitude?: number }).lat
      ?? (deal as unknown as { latitude?: number }).latitude ?? undefined,
    lng: (deal as unknown as { lng?: number; longitude?: number }).lng
      ?? (deal as unknown as { longitude?: number }).longitude ?? undefined,
  };
}

// ─── localStorage persistence ────────────────────────────────────────

const ANALYSE_STORAGE_PREFIX = "mimmoza_analyse_";

function loadAnalyseState(dealId: string): AnalyseState | null {
  try {
    const raw = userStorage.getItem(`${ANALYSE_STORAGE_PREFIX}${dealId}`);
    if (!raw) return null;
    return JSON.parse(raw) as AnalyseState;
  } catch { return null; }
}

function saveAnalyseState(dealId: string, state: AnalyseState): void {
  try {
    userStorage.setItem(`${ANALYSE_STORAGE_PREFIX}${dealId}`, JSON.stringify(state));
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

// ─── Object helpers ───────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── Safe number extraction ───────────────────────────────────────────

function safeNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstNum(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    const n = safeNum(c);
    if (n != null) return n;
  }
  return undefined;
}

// ─── Decision normalizer ──────────────────────────────────────────────

function normalizeDecisionFromReport(rawAnalysis: Record<string, unknown> | null): string {
  const conclusion = (rawAnalysis?.conclusion ?? null) as Record<string, unknown> | null;
  const decisionAdvised =
    (conclusion?.decisionAdvised as string | undefined) ??
    (conclusion?.decision as string | undefined) ??
    undefined;
  if (decisionAdvised && decisionAdvised.trim().length > 0 &&
      decisionAdvised.toUpperCase() !== "INCONNU" &&
      decisionAdvised.toUpperCase() !== "UNKNOWN" &&
      decisionAdvised.toUpperCase() !== "ND") {
    return decisionAdvised;
  }
  const verdict = (rawAnalysis?.verdict as string | undefined) ?? (conclusion?.verdict as string | undefined) ?? "";
  switch (verdict.toUpperCase()) {
    case "GO":                    return "ACHETER";
    case "GO_AVEC_RESERVES":
    case "GO_WITH_RESERVATIONS":  return "NEGOCIER";
    case "NO_GO":
    case "NOGO":                  return "PASSER";
    default:                      return decisionAdvised ?? verdict ?? "ND";
  }
}

// ─── Strategy / fiscal labels ─────────────────────────────────────────

function strategyLabel(s: StrategyType): string {
  switch (s) {
    case "revente":  return "Revente (achat-revente / marchand de biens)";
    case "location": return "Location (investissement locatif)";
    default:         return String(s);
  }
}

function fiscalRegimeLabel(r: FiscalRegime): string {
  switch (r) {
    case "lmnp_micro": return "LMNP Micro-BIC";
    case "lmnp_reel":  return "LMNP Réel";
    case "lmp":        return "LMP";
    case "sci_is":     return "SCI à l'IS";
    case "nu_micro":   return "Nu Micro-foncier";
    case "nu_reel":    return "Nu Réel";
    case "none":       return "Aucun (revente)";
    default:           return String(r);
  }
}

// ─── BPE utilities ────────────────────────────────────────────────────

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

function buildBpeMarkdownBlock(bpe: unknown): string | null {
  const b = bpe as Record<string, unknown> | null;
  const hasV2 = b?.score_v2 != null;
  const score = hasV2 ? b?.score_v2 : b?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const source = hasV2 ? (typeof b?.source_v2 === "string" ? b.source_v2 : "bpe-score-v2") : "legacy (fallback)";
  const level = getBpeLevel(score);
  const coveragePct = typeof b?.coverage_pct_v2 === "number" && Number.isFinite(b.coverage_pct_v2) ? `${Math.round(b.coverage_pct_v2)}%` : "ND";
  const maybeCoverageCats = b?.coverage_v2 != null ? ` (${String(b.coverage_v2)} catégories couvertes)` : "";
  const commerces = b?.commerces as { count?: unknown } | undefined;
  const sante     = b?.sante     as { count?: unknown } | undefined;
  return ["", "### Équipements & cadre de vie (BPE)", "",
    `BPE Score : **${Math.round(score)}/100** — **${level}** (source : ${source})`,
    `Couverture : **${coveragePct}**${maybeCoverageCats}`, "",
    `- **Impact liquidité** : ${getBpeLiquiditeImpact(score)}`, "",
    `- **Impact risque délai** : ${getBpeRisqueDelai(score)}`, "",
    `- **Drivers** : Écoles (${nd(b?.nb_ecoles)}) · Commerces (${nd(commerces?.count)}) · Santé (${nd(sante?.count)}) · Pharmacies (${nd(b?.nb_pharmacies)}) · Supermarchés (${nd(b?.nb_supermarches)})`,
    ""].join("\n");
}

function injectBpeIntoNarrative(narrative: string, bpe: unknown): string {
  const block = buildBpeMarkdownBlock(bpe);
  if (!block) return narrative;
  const anchorPattern = /^###\s+(?:Lecture\s+)?[Mm]arch[éeè][^\n]*/im;
  const anchorMatch   = anchorPattern.exec(narrative);
  if (anchorMatch) {
    const anchorEnd = anchorMatch.index + anchorMatch[0].length;
    const rest = narrative.slice(anchorEnd);
    const nextSectionMatch = /^###\s+/m.exec(rest);
    if (nextSectionMatch) {
      const insertPos = anchorEnd + nextSectionMatch.index;
      return narrative.slice(0, insertPos).trimEnd() + "\n\n" + block.trim() + "\n\n" + narrative.slice(insertPos);
    }
    return narrative.trimEnd() + "\n\n" + block.trim() + "\n";
  }
  return narrative.trimEnd() + "\n\n" + block.trim() + "\n";
}

// ─── Clean narrative markdown ─────────────────────────────────────────

function cleanNarrativeMarkdown(raw: string): string {
  let text = raw;
  const endMarkers = [/Conformit[ée]\s+seuils\s+Mimmoza/i, /D[ée]cision\s+finale/i, /^---\s*$/m];
  for (const marker of endMarkers) {
    const m = marker.exec(text);
    if (!m) continue;
    const fromMarker = text.slice(m.index);
    const jsonTailPattern = /\n\s*(?:,\s*"|"\w+":\s*[{\["0-9]|[{[])/m;
    const jsonTailMatch = jsonTailPattern.exec(fromMarker);
    if (jsonTailMatch) {
      const cutPos = m.index + jsonTailMatch.index;
      const candidate = text.slice(cutPos);
      if (!/^\s*\|/.test(candidate)) { text = text.slice(0, cutPos).trimEnd(); break; }
    }
  }
  const trailingJsonPattern = /\n\s*(?:,\s*"[^"]+"\s*:|[{\[])\s*[\s\S]{0,2000}$/;
  const trailingMatch = trailingJsonPattern.exec(text);
  if (trailingMatch) {
    const before = text.slice(0, trailingMatch.index);
    if (/^###\s+/m.test(before)) text = before.trimEnd();
  }
  text = text.replace(/\n{4,}/g, "\n\n\n");
  return text;
}

// ─── Prefetch Marché/Risques ──────────────────────────────────────────

async function prefetchMarcheRisquesIfNeeded(
  dealId: string,
  dealInputs: { address: string; zipCode: string; city: string; lat?: number; lng?: number }
): Promise<boolean> {
  const snap     = readMarchandSnapshot();
  const existing = snap.marcheRisquesByDeal[dealId] as Record<string, unknown> | undefined;
  const existingData = (existing?.data ?? undefined) as Record<string, unknown> | undefined;
  const hasDvf =
    (existingData?.core as { dvf?: unknown } | undefined)?.dvf != null ||
    (existingData as { dvf?: unknown } | undefined)?.dvf != null ||
    (existing?.core as { dvf?: unknown } | undefined)?.dvf != null;
  if (existing && hasDvf) { console.log("[AnalysePage] Marché/Risques déjà présent, skip prefetch."); return true; }
  console.log("[AnalysePage] Marché/Risques absent — lancement du prefetch…");
  try {
    const res = await fetchMarketStudyPromoteur({
      address: dealInputs.address, zipCode: dealInputs.zipCode, city: dealInputs.city,
      lat: dealInputs.lat, lng: dealInputs.lng, project_type: "logement", radius_km: 5, debug: false,
    });
    if (res.ok) {
      const data: MarketStudyResult = res.data;
      const s = data.scores;
      patchMarcheRisquesForDeal(dealId, {
        data, scoreGlobal: s?.global,
        breakdown: { demande: s?.demande, offre: s?.offre, accessibilite: s?.accessibilite, environnement: s?.environnement },
        updatedAt: new Date().toISOString(),
      });
      console.log("[AnalysePage] Prefetch Marché/Risques OK.");
      return true;
    } else { console.warn("[AnalysePage] Prefetch Marché/Risques échoué:", res.error); return false; }
  } catch (err) { console.warn("[AnalysePage] Prefetch Marché/Risques erreur:", err); return false; }
}

// ─── resolveMarketScoresForPdf ────────────────────────────────────────

function resolveMarketScoresForPdf(snap: ReturnType<typeof readMarchandSnapshot>, dealId: string): Record<string, number | undefined> {
  const mr = snap.marcheRisquesByDeal[dealId] as Record<string, unknown> | undefined;
  const mrData = (mr?.data ?? null) as Record<string, unknown> | null;
  const mrScores = (mrData?.scores ?? null) as Record<string, unknown> | null;
  const mrBreakdown = (mr?.breakdown ?? null) as Record<string, unknown> | null;
  return {
    smartScore: firstNum(mr?.scoreGlobal, mr?.score, (mrData as { smartScore?: unknown } | null)?.smartScore, (mrScores as { global?: unknown } | null)?.global),
    liquidityScore: firstNum((mrScores as { liquidite?: unknown } | null)?.liquidite, (mrScores as { liquidityScore?: unknown } | null)?.liquidityScore, (mrScores as { liquidity?: unknown } | null)?.liquidity, (mrBreakdown as { demande?: unknown } | null)?.demande),
    opportunityScore: firstNum((mrScores as { opportunity?: unknown } | null)?.opportunity, (mrScores as { opportunityScore?: unknown } | null)?.opportunityScore, (mrScores as { opportunite?: unknown } | null)?.opportunite, (mrBreakdown as { offre?: unknown } | null)?.offre),
    riskPressureScore: firstNum((mrScores as { pressionRisque?: unknown } | null)?.pressionRisque, (mrScores as { riskPressureScore?: unknown } | null)?.riskPressureScore, (mrScores as { riskPressure?: unknown } | null)?.riskPressure, (mrBreakdown as { environnement?: unknown } | null)?.environnement),
  };
}

// ─── buildCanonicalPayload ────────────────────────────────────────────

function buildCanonicalPayload(deal: DealInputs, activeDeal: MarchandDeal, canonicalDealId: string, strategyCtx?: { strategy: StrategyType; fiscalRegime: FiscalRegime }): Record<string, unknown> {
  const dealId = canonicalDealId;
  const snap = readMarchandSnapshot();
  const rentabilite = snap.rentabiliteByDeal[dealId] ?? null;
  const execution = snap.executionByDeal[dealId] ?? null;
  const sortie = snap.sortieByDeal[dealId] ?? null;
  const dueDiligence = snap.dueDiligenceByDeal[dealId] ?? null;
  const marcheRisques = snap.marcheRisquesByDeal[dealId] ?? null;
  const mr = marcheRisques as Record<string, unknown> | null;
  const mrData = (mr?.data ?? null) as Record<string, unknown> | null;
  const renta = rentabilite as Record<string, unknown> | null;
  const rentaInputs = (renta?.inputs ?? null) as Record<string, unknown> | null;
  const rentaComputed = (renta?.computed ?? (renta as { results?: unknown }).results ?? (renta as { output?: unknown }).output ?? null) as Record<string, unknown> | null;
  const execData = execution as ExecutionSaved | null;
  const sortieData = sortie as SortieSaved | null;
  const ad = activeDeal as unknown as Record<string, unknown> | null;

  const investisseurSnap = getInvestisseurSnapshot();
  const investisseurPid = investisseurSnap.activeProjectId;
  const investisseurTravauxComputed = investisseurPid ? investisseurSnap.projects[investisseurPid]?.execution?.travaux?.computed : undefined;

  const dvfCore = (mrData?.core as { dvf?: unknown } | undefined)?.dvf ?? (mrData as { dvf?: unknown } | undefined)?.dvf ?? (mr?.core as { dvf?: unknown } | undefined)?.dvf ?? (mr as { dvf?: unknown } | undefined)?.dvf ?? (mrData as { dvfData?: unknown } | undefined)?.dvfData ?? (mrData?.core as { dvfData?: unknown } | undefined)?.dvfData ?? null;
  let dvfPayload: Record<string, unknown> | undefined;
  if (dvfCore && typeof dvfCore === "object") {
    const d = dvfCore as Record<string, unknown>;
    const prixM2Median = firstNum(d.prix_m2_median, d.prixM2Median, d.medianPriceM2, d.median_price_m2);
    const nbTransactions = firstNum(d.nb_transactions, d.nbTransactions, d.count, d.total);
    const transactions = (d.transactions ?? d.items ?? d.list) as unknown;
    if (prixM2Median != null || nbTransactions != null) dvfPayload = { prix_m2_median: prixM2Median, nb_transactions: nbTransactions, ...(transactions ? { transactions } : {}) };
  }

  const prixAchat = deal.prixAchat ?? 0;
  const surfaceM2 = deal.surfaceM2 ?? 0;
  const prixM2 = surfaceM2 > 0 ? Math.round((prixAchat / surfaceM2) * 10) / 10 : null;
  const smartScore = firstNum(mr?.scoreGlobal, mr?.score, (mrData?.scores as { global?: unknown } | undefined)?.global, (mrData as { smartScore?: unknown } | null)?.smartScore, (mrData as { score?: unknown } | null)?.score, (mrData as { scoreGlobal?: unknown } | null)?.scoreGlobal, (ad as { smartScore?: unknown } | null)?.smartScore, (ad as { enriched?: { smartScore?: unknown } } | null)?.enriched?.smartScore, (ad as { enriched?: { score?: unknown } } | null)?.enriched?.score, (ad as { scores?: { smartScore?: unknown } } | null)?.scores?.smartScore, (ad as { scores?: { global?: unknown } } | null)?.scores?.global);
  const travauxEstimes = firstNum(investisseurTravauxComputed?.totalWithBuffer, investisseurTravauxComputed?.total, rentaInputs?.travauxUtilises, rentaInputs?.travauxEstimes, rentaInputs?.travaux, rentaInputs?.montantTravaux, rentaInputs?.coutTravaux, rentaComputed?.travauxEstimes, (ad as { travauxEstimes?: unknown } | null)?.travauxEstimes, (ad as { travaux?: unknown } | null)?.travaux, (ad as { enriched?: { travauxEstimes?: unknown } } | null)?.enriched?.travauxEstimes);
  const loyerEstime = firstNum(rentaInputs?.loyerEstime, rentaInputs?.loyerMensuel, rentaInputs?.loyer, rentaComputed?.loyerEstime, rentaComputed?.loyerMensuel, (ad as { loyerEstime?: unknown } | null)?.loyerEstime, (ad as { loyerMensuel?: unknown } | null)?.loyerMensuel, (ad as { enriched?: { loyerEstime?: unknown } } | null)?.enriched?.loyerEstime);
  const chargesEstimees = firstNum(rentaInputs?.chargesEstimees, rentaInputs?.charges, rentaInputs?.chargesMensuelles, rentaComputed?.chargesEstimees, (ad as { chargesEstimees?: unknown } | null)?.chargesEstimees, (ad as { charges?: unknown } | null)?.charges);
  const chargesUnit: string | undefined = (rentaInputs?.chargesUnit as string | undefined) ?? (rentaInputs?.chargesUnite as string | undefined) ?? ((ad as { chargesUnit?: unknown } | null)?.chargesUnit as string | undefined) ?? undefined;
  const apport = firstNum(rentaInputs?.apportPersonnel, rentaInputs?.apport, (ad as { apport?: unknown } | null)?.apport);
  const montantPret = firstNum(rentaInputs?.montantPret, rentaInputs?.montantPretEur, rentaInputs?.capitalEmprunte, rentaInputs?.loanAmount);
  const mensualite = firstNum(rentaComputed?.mensualite, (rentaComputed as { monthlyPayment?: unknown } | null)?.monthlyPayment);
  const margeBrute = firstNum(rentaComputed?.margeBrute, (rentaComputed as { grossMargin?: unknown } | null)?.grossMargin);
  const margeBrutePct = firstNum(rentaComputed?.margeBrutePct, (rentaComputed as { grossMarginPct?: unknown } | null)?.grossMarginPct);
  const capitalEngage: number | undefined = prixAchat > 0 ? prixAchat + (travauxEstimes ?? 0) : undefined;
  const rendementBrut = firstNum(rentaComputed?.rendementBrut, rentaComputed?.yieldBrut, renta?.rendementBrut);
  const rendementNet = firstNum(rentaComputed?.rendementNet, rentaComputed?.yieldNet, renta?.rendementNet);
  const cashflowMensuel = firstNum(rentaComputed?.cashflowMensuel, rentaComputed?.cashflow, renta?.cashflowMensuel);

  let worksMonths: number | undefined;
  if (execData?.phases && Array.isArray(execData.phases)) {
    const total = (execData.phases as unknown[]).reduce((sum: number, p: unknown) => { const pp = p as { durationMonths?: unknown; duration?: unknown; duree?: unknown } | null; return sum + (safeNum(pp?.durationMonths) ?? safeNum(pp?.duration) ?? safeNum(pp?.duree) ?? 0); }, 0);
    if (total > 0) worksMonths = total;
  }
  if (worksMonths == null) { const e = execData as unknown as { totalMonths?: unknown; dureeTotale?: unknown; dureeTravauxMois?: unknown } | null; worksMonths = firstNum(e?.totalMonths, e?.dureeTotale, e?.dureeTravauxMois); }

  const rentaDureeMois = safeNum(rentaInputs?.dureeMois);
  const rentaDureeAnnees = safeNum(rentaInputs?.dureeAnnees);
  const holdingFromRenta: number | undefined = rentaDureeMois != null ? rentaDureeMois : rentaDureeAnnees != null ? rentaDureeAnnees * 12 : undefined;

  let holdingFromSortie: number | undefined;
  if (sortieData?.scenarios && Array.isArray(sortieData.scenarios)) {
    const first = (sortieData.scenarios as unknown[]).find((s) => s != null) as { holdingMonths?: unknown; delaiMois?: unknown; dureeMois?: unknown; holding?: unknown } | undefined;
    if (first) holdingFromSortie = firstNum(first.holdingMonths, first.delaiMois, first.dureeMois, first.holding);
  }
  const holdingMonths = firstNum(holdingFromRenta, holdingFromSortie);

  let marketingMonths: number | undefined;
  if (sortieData?.scenarios && Array.isArray(sortieData.scenarios)) {
    const first = (sortieData.scenarios as unknown[]).find((s) => s != null) as { marketingMonths?: unknown; delaiCommercialisation?: unknown; commercialisationMois?: unknown } | undefined;
    if (first) marketingMonths = firstNum(first.marketingMonths, first.delaiCommercialisation, first.commercialisationMois);
  }
  const hasTimeline = worksMonths != null || holdingMonths != null || marketingMonths != null;

  const scoresBreakdown = (mr as { breakdown?: unknown } | null)?.breakdown ?? (mrData as { scores?: unknown } | null)?.scores ?? undefined;
  const bpeCore = (mrData?.core as { bpe?: unknown } | undefined)?.bpe ?? (mrData as { bpe?: unknown } | undefined)?.bpe ?? (mr?.core as { bpe?: unknown } | undefined)?.bpe ?? (mr as { bpe?: unknown } | undefined)?.bpe ?? null;
  const bpePayload = bpeCore && typeof bpeCore === "object" ? {
    score_v2: firstNum((bpeCore as { score_v2?: unknown }).score_v2), coverage_pct_v2: firstNum((bpeCore as { coverage_pct_v2?: unknown }).coverage_pct_v2),
    coverage_v2: (bpeCore as { coverage_v2?: unknown }).coverage_v2 ?? undefined, source_v2: (bpeCore as { source_v2?: unknown }).source_v2 ?? undefined,
    score: firstNum((bpeCore as { score?: unknown }).score), nb_ecoles: firstNum((bpeCore as { nb_ecoles?: unknown }).nb_ecoles),
    nb_pharmacies: firstNum((bpeCore as { nb_pharmacies?: unknown }).nb_pharmacies), nb_supermarches: firstNum((bpeCore as { nb_supermarches?: unknown }).nb_supermarches),
    commerces: (bpeCore as { commerces?: unknown }).commerces ?? undefined, sante: (bpeCore as { sante?: unknown }).sante ?? undefined,
  } : undefined;

  const chosenStrategy = strategyCtx?.strategy ?? "location";
  const chosenFiscal = strategyCtx?.fiscalRegime ?? "lmnp_reel";
  const horizonYears: number | null = holdingMonths != null ? Math.round((holdingMonths / 12) * 10) / 10 : rentaDureeAnnees != null ? rentaDureeAnnees : null;
  const resaleTarget: number | null = deal.prixReventeCible > 0 ? deal.prixReventeCible : null;

  const investmentStrategy: Record<string, unknown> = {
    strategy: chosenStrategy, strategyLabel: strategyLabel(chosenStrategy),
    fiscalRegime: chosenStrategy === "location" ? chosenFiscal : "none",
    fiscalRegimeLabel: chosenStrategy === "location" ? fiscalRegimeLabel(chosenFiscal) : fiscalRegimeLabel("none" as FiscalRegime),
    horizonYears, resaleTarget,
  };

  const adAny = activeDeal as unknown as Record<string, unknown>;
  const citySafe = (deal.city?.trim()) || (adAny?.city as string | undefined)?.trim() || (adAny?.ville as string | undefined)?.trim() || "";
  const zipSafe = (deal.zipCode?.trim()) || (adAny?.zipCode as string | undefined)?.trim() || (adAny?.cp as string | undefined)?.trim() || "";
  const addressSafe = (deal.address?.trim()) || (adAny?.address as string | undefined)?.trim() || (adAny?.adresse as string | undefined)?.trim() || "";

  const canonical: Record<string, unknown> = {
    prixAchat, surfaceM2, prixM2, prixRevente: deal.prixReventeCible || undefined,
    localisation: [addressSafe, zipSafe, citySafe].filter(Boolean).join(", "),
    city: citySafe, ville: citySafe, zipCode: zipSafe, cp: zipSafe, address: addressSafe, adresse: addressSafe,
    lat: deal.lat, lng: deal.lng, smartScore,
    ...(dvfPayload ? { dvf: dvfPayload } : {}), ...(scoresBreakdown ? { scoresMarche: scoresBreakdown } : {}), ...(bpePayload ? { bpe: bpePayload } : {}),
    investmentStrategy, travauxEstimes, loyerEstime, chargesEstimees, chargesUnit,
    travauxSimulation: investisseurTravauxComputed ? { total: investisseurTravauxComputed.total, totalWithBuffer: investisseurTravauxComputed.totalWithBuffer, bufferPct: investisseurTravauxComputed.bufferPct, costPerM2: investisseurTravauxComputed.costPerM2, complexityCoef: investisseurTravauxComputed.complexityCoef } : undefined,
    apport: apport ?? undefined, montantPret: montantPret ?? undefined, mensualite: mensualite ?? undefined,
    margeBrute: margeBrute ?? undefined, margeBrutePct: margeBrutePct ?? undefined, capitalEngage: capitalEngage ?? undefined,
    rendementBrut, rendementNet, cashflowMensuel,
    ...(hasTimeline ? { timeline: { ...(worksMonths != null ? { worksMonths } : {}), ...(holdingMonths != null ? { holdingMonths } : {}), ...(marketingMonths != null ? { marketingMonths } : {}) } } : {}),
    typeBien: (ad as { typeBien?: unknown } | null)?.typeBien ?? undefined, etatBien: (ad as { etatBien?: unknown } | null)?.etatBien ?? undefined,
  };

  return { ...canonical, rentabilite: rentabilite ?? undefined, execution: execution ?? undefined, sortie: sortie ?? undefined, dueDiligence: dueDiligence ?? undefined, marcheRisques: marcheRisques ?? undefined };
}// ─── Financement : injectSyntheseExpress (conservé pour PDF) ─────────

function syntheseVerdict(score: number | undefined): string {
  if (score == null) return "Données insuffisantes pour statuer.";
  if (score >= 75) return "Opération solide — go avec vigilance sur les points notés.";
  if (score >= 60) return "Opération acceptable — négociation et travaux à cadrer.";
  if (score >= 45) return "Opération risquée — due diligence approfondie requise.";
  return "Opération déconseillée en l'état — risques élevés.";
}

function fmtEur(v: number): string { return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " \u20ac"; }

const LOAN_COMPARISON_DURATIONS = [10, 15, 20] as const;

interface SyntheseExpressCtx {
  qualiteDossier?: number;
  rentabiliteScore?: number;
  strategy: StrategyType;
  loyerEstime?: number;
  montantPretEur?: number;
  tauxNominalAnnuelPct?: number;
  dureePretAnnees?: number;
  tauxAssuranceAnnuelPct?: number;
  upfrontFeesEur?: number;
}

function injectSyntheseExpress(narrative: string, ctx: SyntheseExpressCtx): string {
  const ND = "ND";
  const isRevente = ctx.strategy === "revente";
  const qualiteStr = ctx.qualiteDossier != null ? `${Math.round(ctx.qualiteDossier)}/100` : ND;
  const rentaStr = ctx.rentabiliteScore != null ? `${Math.round(ctx.rentabiliteScore)}/100` : ND;
  const verdictStr = syntheseVerdict(ctx.qualiteDossier);
  const prixMaxMatch = /prix\s+max(?:imum|imale?)?\s*(?:conseill[eé][e]?|recommand[eé][e]?)?\s*[:\-]?\s*([\d\s\u00a0]+)\s*[€e]/i.exec(narrative);
  const prixMaxStr = prixMaxMatch ? prixMaxMatch[1].replace(/[\s\u00a0]/g, "").replace(/^0+/, "").trim() + " \u20ac" : ND;
  const lines: string[] = [
    "### Synth\u00e8se Express", "",
    `**Qualit\u00e9 dossier\u00a0: ${qualiteStr}**`,
    `**Rentabilit\u00e9\u00a0: ${rentaStr}**`, "",
    `**Verdict\u00a0: ${verdictStr}**`,
    `**Prix max conseill\u00e9\u00a0: ${prixMaxStr}**`, "",
  ];
  if (!isRevente) {
    const loyerStr = ctx.loyerEstime != null ? `${fmtEur(Math.round(ctx.loyerEstime))}/mois` : ND;
    lines.push(`**Location \u2014 loyer optimal\u00a0: ${loyerStr}**`, "");
  }
  lines.push("### Financement \u2014 co\u00fbt r\u00e9el du cr\u00e9dit", "");
  if (isRevente) {
    lines.push("_Logique marchand de biens\u00a0: l\u2019horizon de d\u00e9tention vis\u00e9 est g\u00e9n\u00e9ralement court. Le co\u00fbt du financement devient particuli\u00e8rement sensible si la dur\u00e9e r\u00e9elle du portage s\u2019allonge \u2014 premier levier d\u2019optimisation \u00e0 monitorer._", "");
  }
  const hasLoanInputs = ctx.montantPretEur != null && ctx.tauxNominalAnnuelPct != null && ctx.dureePretAnnees != null;
  if (hasLoanInputs) {
    const principal = ctx.montantPretEur as number;
    const annualRate = ctx.tauxNominalAnnuelPct as number;
    const years = ctx.dureePretAnnees as number;
    const insurancePct = ctx.tauxAssuranceAnnuelPct;
    const upfront = ctx.upfrontFeesEur;
    const breakdown = computeLoanCost({ principal, annualRateNominalPct: annualRate, years, annualInsuranceRatePct: insurancePct, upfrontFeesEur: upfront });
    const durationLabel = isRevente
      ? `Dur\u00e9e propos\u00e9e\u00a0: **${years}\u00a0an${years > 1 ? "s" : ""}** _(portage court terme vis\u00e9 \u2014 ajuster selon d\u00e9lai r\u00e9el de sortie)_`
      : `Dur\u00e9e retenue\u00a0: **${years}\u00a0an${years > 1 ? "s" : ""}**`;
    lines.push(
      durationLabel,
      `- Montant emprunt\u00e9\u00a0: ${fmtEur(principal)}`,
      `- Mensualit\u00e9 (hors assurance)\u00a0: ${fmtEur(Math.round(breakdown.monthlyPaymentExclInsurance))}/mois`,
      `- Assurance\u00a0: ${breakdown.monthlyInsurance != null ? `${fmtEur(Math.round(breakdown.monthlyInsurance))}/mois` : ND}`,
      `- Int\u00e9r\u00eats totaux\u00a0: ${fmtEur(Math.round(breakdown.totalInterest))}`,
      `- Frais initiaux\u00a0: ${fmtEur(Math.round(breakdown.upfrontFees))}`,
      `- **Co\u00fbt total du cr\u00e9dit\u00a0: ${fmtEur(Math.round(breakdown.totalCostOfCredit))}**`,
      `- **Total rembours\u00e9\u00a0: ${fmtEur(Math.round(breakdown.totalRepaidAllIn))}**`,
    );
    breakdown.notes.forEach((note) => lines.push(`- _${note}_`));
    lines.push("", "**Comparatif dur\u00e9es \u2014 \u00e0 montant et taux constants**", "");
    for (const cy of LOAN_COMPARISON_DURATIONS) {
      const cb = computeLoanCost({ principal, annualRateNominalPct: annualRate, years: cy, annualInsuranceRatePct: insurancePct, upfrontFeesEur: upfront });
      const isSelected = cy === years; const marker = isSelected ? " \u2713" : "";
      lines.push(`- **${cy}\u00a0ans${marker}**\u00a0: mensualit\u00e9 ${fmtEur(Math.round(cb.monthlyPaymentExclInsurance))}/mois \u00b7 int\u00e9r\u00eats ${fmtEur(Math.round(cb.totalInterest))} \u00b7 co\u00fbt total cr\u00e9dit ${fmtEur(Math.round(cb.totalCostOfCredit))}`);
    }
    const isStandardDuration = (LOAN_COMPARISON_DURATIONS as readonly number[]).includes(years);
    if (!isStandardDuration) {
      lines.push(`- **${years}\u00a0an${years > 1 ? "s" : ""} \u2713 (retenu)**\u00a0: mensualit\u00e9 ${fmtEur(Math.round(breakdown.monthlyPaymentExclInsurance))}/mois \u00b7 int\u00e9r\u00eats ${fmtEur(Math.round(breakdown.totalInterest))} \u00b7 co\u00fbt total cr\u00e9dit ${fmtEur(Math.round(breakdown.totalCostOfCredit))}`);
    }
    if (isRevente) {
      lines.push("", "_\u00c0 dur\u00e9e de portage \u00e9gale, une dur\u00e9e de pr\u00eat plus courte r\u00e9duit sensiblement le co\u00fbt total du cr\u00e9dit mais alourdit la mensualit\u00e9. L\u2019arbitrage d\u00e9pend du d\u00e9lai r\u00e9el de sortie et de la marge de man\u0153uvre tr\u00e9sorerie sur la p\u00e9riode de portage._");
    }
  } else {
    lines.push(`- ${ND} \u2014 Donn\u00e9es manquantes\u00a0: montant pr\u00eat / taux / dur\u00e9e`);
  }
  lines.push("");
  return lines.join("\n") + "\n\n" + narrative;
}

// ─── SmartScores UI helpers ───────────────────────────────────────────

type ScoreLevel = "Fragile" | "Moyen" | "Solide" | "Excellent";
function clamp100(n: number): number { if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(100, n)); }
function toScore100(raw: number | undefined): number | undefined { if (raw == null || !Number.isFinite(raw)) return undefined; if (raw >= 0 && raw <= 1) return clamp100(Math.round(raw * 100)); return clamp100(Math.round(raw)); }
function scoreLevel(v: number): ScoreLevel { if (v >= 85) return "Excellent"; if (v >= 70) return "Solide"; if (v >= 50) return "Moyen"; return "Fragile"; }
function levelTone(level: ScoreLevel): { badge: string; dot: string; ring: string } {
  switch (level) {
    case "Excellent": return { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", ring: "ring-emerald-200" };
    case "Solide":    return { badge: "bg-sky-50 text-sky-700 ring-sky-200",             dot: "bg-sky-500",     ring: "ring-sky-200" };
    case "Moyen":     return { badge: "bg-amber-50 text-amber-700 ring-amber-200",       dot: "bg-amber-500",   ring: "ring-amber-200" };
    default:          return { badge: "bg-rose-50 text-rose-700 ring-rose-200",          dot: "bg-rose-500",    ring: "ring-rose-200" };
  }
}

function ScoreBadge({ value }: { value: number }) {
  const lvl = scoreLevel(value); const tone = levelTone(lvl);
  return (<span className={["inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", tone.badge, "print:bg-white print:text-gray-900 print:ring-gray-300"].join(" ")}><span className={["h-1.5 w-1.5 rounded-full", tone.dot, "print:bg-gray-900"].join(" ")} />{lvl}</span>);
}

function ConfidenceMeter({ value }: { value: number | undefined }) {
  const v = value ?? 0;
  const label = v >= 70 ? "Bonne" : v >= 50 ? "Moyenne" : "Faible";
  return (<div className="flex items-center gap-3"><div className="text-right"><div className="text-[11px] uppercase tracking-wide text-gray-500 print:text-gray-700">Confiance données</div><div className="flex items-baseline justify-end gap-2"><div className="text-sm font-semibold text-gray-900 print:text-black">{v}/100</div><span className="text-xs text-gray-500 print:text-gray-700">{label}</span></div></div><div className="w-28"><div className="h-1.5 rounded-full bg-gray-200 overflow-hidden print:bg-gray-200"><div className={["h-full rounded-full bg-gradient-to-r from-indigo-500/70 via-sky-500/70 to-emerald-500/70", "print:bg-gray-900"].join(" ")} style={{ width: `${clamp100(v)}%` }} aria-hidden="true" /></div><div className="mt-1 flex justify-end"><span className="text-[11px] text-gray-400 print:text-gray-600">{scoreLevel(v)}</span></div></div><span className="sr-only">{`Confiance données ${v} sur 100, ${scoreLevel(v)}`}</span></div>);
}

function ScoreCard(props: { label: string; value?: number; invert?: boolean; hint?: string; status?: "calculé" | "estimé"; weightLabel?: string; }) {
  const v = props.value ?? 0; const display = props.value != null ? clamp100(v) : 0; const fill = props.value == null ? 0 : props.invert ? clamp100(100 - display) : display; const lvl = scoreLevel(display); const status = props.status ?? "calculé";
  return (<div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 print:shadow-none print:border-gray-300"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><div className="text-[11px] uppercase tracking-wide text-gray-500 print:text-gray-700">{props.label}{props.weightLabel ? <span className="ml-2 text-[10px] font-semibold text-gray-400 print:text-gray-600">{props.weightLabel}</span> : null}</div></div><div className="mt-1 flex items-baseline gap-2"><div className="text-3xl leading-none font-semibold text-gray-900 print:text-black">{props.value != null ? display : "—"}</div><div className="text-sm text-gray-400 print:text-gray-600">/100</div></div></div>{props.value != null ? <ScoreBadge value={display} /> : null}</div><div className="mt-3"><div className="h-2 rounded-full bg-gray-200 overflow-hidden print:bg-gray-200"><div className={["h-full rounded-full bg-gradient-to-r from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60", "print:bg-gray-900"].join(" ")} style={{ width: `${fill}%` }} aria-hidden="true" /></div><div className="mt-2 flex items-center justify-between gap-3"><div className="text-xs text-gray-500 print:text-gray-700"><span className="capitalize">{status}</span>{props.hint ? <span className="ml-2 text-gray-400 print:text-gray-600">{props.hint}</span> : null}</div>{props.invert ? <div className="text-xs text-gray-400 print:text-gray-600">plus bas = mieux</div> : <div className="text-xs text-gray-400 print:text-gray-600">{lvl}</div>}</div></div></div>);
}

function InfoBlock() {
  return (<div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold text-gray-900 print:text-black">Comprendre les SmartScores</h3><p className="mt-1 text-sm text-gray-500 print:text-gray-700">Une lecture rapide (sur 100) pour décider : acheter, négocier, ou attendre.</p></div><div className="hidden sm:flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200 print:bg-white print:text-gray-700 print:ring-gray-300"><span className="h-1.5 w-1.5 rounded-full bg-gray-400 print:bg-gray-700" />Se lit comme une note</div></div><div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5"><div className="space-y-3"><div className="text-[11px] uppercase tracking-wide text-gray-500 print:text-gray-700">Définitions (1 phrase)</div><ul className="space-y-2 text-sm text-gray-700 print:text-gray-800"><li><span className="font-semibold text-gray-900 print:text-black">SmartScore</span> : note globale pondérée (sur 100) des sous-scores.</li><li><span className="font-semibold text-gray-900 print:text-black">Liquidité</span> : facilité de revente/location (activité DVF, dynamique).</li><li><span className="font-semibold text-gray-900 print:text-black">Opportunity</span> : potentiel d'upside (écart prix vs marché + marge).</li><li><span className="font-semibold text-gray-900 print:text-black">Pression Risque</span> : niveau de risque global (incertitudes, charges, vacance, stress).</li><li><span className="font-semibold text-gray-900 print:text-black">Rentabilité</span> : performance financière (TRI/VAN/cashflow/marge selon stratégie).</li><li><span className="font-semibold text-gray-900 print:text-black">Robustesse</span> : résistance aux scénarios dégradés (stress tests).</li></ul></div><div className="space-y-3"><div className="text-[11px] uppercase tracking-wide text-gray-500 print:text-gray-700">Comment interpréter</div><div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-4 print:bg-white print:ring-gray-300"><div className="grid grid-cols-3 gap-2 text-xs text-gray-700 print:text-gray-800"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-500 print:bg-gray-900" /><span className="font-semibold">&gt;70</span><span className="text-gray-500 print:text-gray-700">solide</span></div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500 print:bg-gray-900" /><span className="font-semibold">50–70</span><span className="text-gray-500 print:text-gray-700">moyen</span></div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-500 print:bg-gray-900" /><span className="font-semibold">&lt;50</span><span className="text-gray-500 print:text-gray-700">fragile</span></div></div><div className="mt-4"><div className="text-xs font-semibold text-gray-900 print:text-black">3 leviers concrets</div><ul className="mt-2 space-y-1.5 text-sm text-gray-700 print:text-gray-800 list-disc pl-5"><li>Négocier le prix (réduire la prime vs DVF)</li><li>Chiffrer les travaux (devis / simulation) pour lever l'incertitude</li><li>Sécuriser l'exploitation (charges réelles, loyers, vacance)</li></ul></div></div></div></div></div>);
}

function KillSwitchesBox({ items }: { items: readonly string[] }) {
  const has = items.length > 0;
  return (<div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold text-gray-900 print:text-black">KILL SWITCHES</h3><p className="mt-1 text-sm text-gray-500 print:text-gray-700">Conditions qui doivent déclencher un stop immédiat (ou une renégociation forte).</p></div><div className={["inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1", has ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200", "print:bg-white print:text-gray-900 print:ring-gray-300"].join(" ")}><span className={["h-1.5 w-1.5 rounded-full", has ? "bg-rose-500" : "bg-emerald-500", "print:bg-gray-900"].join(" ")} />{has ? "À vérifier" : "Rien à signaler"}</div></div><div className="mt-4">{has ? (<ul className="space-y-2">{items.map((t, idx) => (<li key={`${idx}-${t}`} className="flex items-start gap-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-3 py-2.5 print:bg-white print:ring-gray-300"><span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-700 ring-1 ring-rose-200 print:bg-white print:text-gray-900 print:ring-gray-300"><span className="text-xs font-bold">!</span></span><div className="text-sm text-gray-800 print:text-gray-900">{t}</div></li>))}</ul>) : (<div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm text-emerald-800 print:bg-white print:text-gray-900 print:ring-gray-300">Aucun kill switch détecté.</div>)}</div></div>);
}

function NoDealPlaceholder() {
  return (<div className="min-h-screen bg-gray-50/50 flex items-center justify-center"><div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 max-w-md text-center"><div className="text-5xl mb-4">📭</div><h2 className="text-lg font-semibold text-gray-900 mb-2">Aucun deal actif</h2><p className="text-sm text-gray-500 mb-6">Va dans le Pipeline et sélectionne un deal actif pour lancer l'analyse de rentabilité.</p><Link to="/marchand-de-bien" className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"><span>🔀</span> Aller au Pipeline</Link></div></div>);
}

// ─── PDF Preview state ────────────────────────────────────────────────

interface PdfPreviewState { url: string | null; loading: boolean; error: string | null; }
const PDF_PREVIEW_INITIAL: PdfPreviewState = { url: null, loading: false, error: null };

// ─── v12.4 : Synthèse déterministe locale ────────────────────────────

function fmtPct(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "ND";
  return `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} %`;
}
function fmtEurLocal(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "ND";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}
function scoreStr(v: number | undefined): string {
  return v != null && Number.isFinite(v) ? `${Math.round(v)}/100` : "ND";
}

function buildDeterministicSynthese(
  deal: DealInputs,
  canonicalDealId: string,
  strategy: StrategyType,
  fiscalRegime: FiscalRegime,
): string {
  const snap = readMarchandSnapshot();
  const rentaRaw = snap.rentabiliteByDeal[canonicalDealId] as Record<string, unknown> | undefined;
  const mrRaw = snap.marcheRisquesByDeal[canonicalDealId] as Record<string, unknown> | undefined;
  const ddRaw = snap.dueDiligenceByDeal[canonicalDealId] as Record<string, unknown> | undefined;

  const rentaInputs = (rentaRaw?.inputs ?? null) as Record<string, unknown> | null;
  const rentaComputed = (rentaRaw?.computed ?? null) as Record<string, unknown> | null;
  const mrData = (mrRaw?.data ?? null) as Record<string, unknown> | null;
  const mrScores = (mrData?.scores ?? mrRaw?.breakdown ?? null) as Record<string, unknown> | null;

  // ── Scores ──
  const smartScore = toScore100(firstNum(
    mrRaw?.scoreGlobal, mrRaw?.score,
    (mrScores as { global?: unknown } | null)?.global,
    (mrData as { smartScore?: unknown } | null)?.smartScore,
  ));
  const liquidite = toScore100(firstNum(
    (mrScores as { liquidite?: unknown } | null)?.liquidite,
    (mrScores as { demande?: unknown } | null)?.demande,
    (mrScores as { liquidity?: unknown } | null)?.liquidity,
  ));
  const opportunity = toScore100(firstNum(
    (mrScores as { opportunity?: unknown } | null)?.opportunity,
    (mrScores as { offre?: unknown } | null)?.offre,
    (mrScores as { opportunite?: unknown } | null)?.opportunite,
  ));
  const pressionRisque = toScore100(firstNum(
    (mrScores as { pressionRisque?: unknown } | null)?.pressionRisque,
    (mrScores as { environnement?: unknown } | null)?.environnement,
    (mrScores as { riskPressure?: unknown } | null)?.riskPressure,
  ));
  const rentabilite = toScore100(firstNum(
    (rentaComputed as { rentabilite?: unknown } | null)?.rentabilite,
    (rentaComputed as { profitability?: unknown } | null)?.profitability,
  ));
  const robustesse = toScore100(firstNum(
    (rentaComputed as { robustesse?: unknown } | null)?.robustesse,
    (rentaComputed as { robustness?: unknown } | null)?.robustness,
  ));
  const confidence = toScore100(firstNum(
    (mrData as { dataConfidence?: unknown } | null)?.dataConfidence,
    (mrRaw as { dataConfidence?: unknown } | undefined)?.dataConfidence,
  ));

  // ── Rentabilité ──
  const rendementBrut = firstNum((rentaComputed as { rendementBrut?: unknown } | null)?.rendementBrut, (rentaComputed as { yieldBrut?: unknown } | null)?.yieldBrut);
  const rendementNet = firstNum((rentaComputed as { rendementNet?: unknown } | null)?.rendementNet, (rentaComputed as { yieldNet?: unknown } | null)?.yieldNet);
  const cashflow = firstNum((rentaComputed as { cashflowMensuel?: unknown } | null)?.cashflowMensuel, (rentaComputed as { cashflow?: unknown } | null)?.cashflow);
  const margeBrute = firstNum((rentaComputed as { margeBrute?: unknown } | null)?.margeBrute, (rentaComputed as { grossMargin?: unknown } | null)?.grossMargin);
  const margeBrutePct = firstNum((rentaComputed as { margeBrutePct?: unknown } | null)?.margeBrutePct, (rentaComputed as { grossMarginPct?: unknown } | null)?.grossMarginPct);
  const mensualite = firstNum((rentaComputed as { mensualite?: unknown } | null)?.mensualite, (rentaComputed as { monthlyPayment?: unknown } | null)?.monthlyPayment);
  const travauxEstimes = firstNum(
    (rentaInputs as { travauxUtilises?: unknown } | null)?.travauxUtilises,
    (rentaInputs as { travauxEstimes?: unknown } | null)?.travauxEstimes,
    (rentaInputs as { travaux?: unknown } | null)?.travaux,
  );
  const capitalEngage = deal.prixAchat > 0 ? deal.prixAchat + (travauxEstimes ?? 0) : undefined;

  // ── DVF ──
  const dvfCore = (mrData?.core as { dvf?: unknown } | undefined)?.dvf ?? (mrData as { dvf?: unknown } | undefined)?.dvf ?? (mrRaw as { dvf?: unknown } | undefined)?.dvf ?? null;
  const dvf = dvfCore as Record<string, unknown> | null;
  const prixM2Median = dvf != null ? firstNum((dvf as { prix_m2_median?: unknown }).prix_m2_median, (dvf as { prixM2Median?: unknown }).prixM2Median) : undefined;
  const nbTransactions = dvf != null ? firstNum((dvf as { nb_transactions?: unknown }).nb_transactions, (dvf as { nbTransactions?: unknown }).nbTransactions) : undefined;

  // ── BPE ──
  const bpeCore = (mrData?.core as { bpe?: unknown } | undefined)?.bpe ?? (mrData as { bpe?: unknown } | undefined)?.bpe ?? (mrRaw as { bpe?: unknown } | undefined)?.bpe ?? null;
  const bpe = bpeCore as Record<string, unknown> | null;
  const bpeScore = bpe != null ? firstNum((bpe as { score_v2?: unknown }).score_v2, (bpe as { score?: unknown }).score) : undefined;

  // ── Travaux (investisseur snapshot) ──
  const investisseurSnap = getInvestisseurSnapshot();
  const investisseurPid = investisseurSnap.activeProjectId;
  const travauxComputed = investisseurPid ? investisseurSnap.projects[investisseurPid]?.execution?.travaux?.computed : undefined;

  // ── Due diligence ──
  const ddState = (ddRaw?.state ?? null) as Record<string, unknown> | null;
  const checklist = (ddState?.checklist ?? null) as unknown[] | null;
  const risquesNonFin = (ddState?.risquesNonFinanciers ?? null) as unknown[] | null;

  // ── Décision déterministe ──
  const hasEnoughData = smartScore != null || rentabilite != null;
  let decision = "DONNÉES INSUFFISANTES";
  if (hasEnoughData) {
    const ss = smartScore ?? 0;
    const rr = rentabilite ?? 0;
    const pr = pressionRisque ?? 100;
    if (ss >= 75 && rr >= 60 && pr <= 60) decision = "ACHETER";
    else if (ss >= 60 || rr >= 60) decision = "NEGOCIER";
    else decision = "PASSER";
  }

  // ── Lecture Mimmoza ──
  function lectureMimmoza(): string {
    if (!hasEnoughData) return "Données insuffisantes pour établir une lecture Mimmoza. Lancez une étude de marché depuis l'onglet Marché/Risques.";
    const ss = smartScore ?? 0;
    const pr = pressionRisque ?? 50;
    const liq = liquidite ?? 50;
    if (ss >= 75 && pr <= 40) return `SmartScore solide (${scoreStr(smartScore)}) avec une pression risque maîtrisée (${scoreStr(pressionRisque)}). Liquidité ${liq >= 65 ? "favorable" : "correcte"} — opération bien positionnée sur le marché local.`;
    if (ss >= 60) return `SmartScore correct (${scoreStr(smartScore)}) — des marges de négociation existent. Surveiller la pression risque (${scoreStr(pressionRisque)}) et la liquidité (${scoreStr(liquidite)}) avant engagement.`;
    return `SmartScore en dessous du seuil de confort Mimmoza (${scoreStr(smartScore)}). Risques structurels à qualifier impérativement avant toute décision.`;
  }

  // ── Points forts / vigilance ──
  const pointsForts: string[] = [];
  const vigilances: string[] = [];

  if (smartScore != null) { if (smartScore >= 70) pointsForts.push(`SmartScore élevé (${Math.round(smartScore)}/100) — position marché favorable.`); else if (smartScore < 50) vigilances.push(`SmartScore sous le seuil (${Math.round(smartScore)}/100) — attractivité marché limitée.`); }
  if (rentabilite != null) { if (rentabilite >= 70) pointsForts.push(`Score de rentabilité solide (${Math.round(rentabilite)}/100).`); else if (rentabilite < 50) vigilances.push(`Score de rentabilité insuffisant (${Math.round(rentabilite)}/100) — revoir le pricing ou les charges.`); }
  if (liquidite != null) { if (liquidite >= 70) pointsForts.push(`Bonne liquidité du marché (${Math.round(liquidite)}/100) — friction de sortie faible.`); else if (liquidite < 50) vigilances.push(`Liquidité faible (${Math.round(liquidite)}/100) — délai de commercialisation allongé à anticiper.`); }
  if (pressionRisque != null) { if (pressionRisque <= 40) pointsForts.push(`Pression risque contenue (${Math.round(pressionRisque)}/100).`); else if (pressionRisque > 65) vigilances.push(`Pression risque élevée (${Math.round(pressionRisque)}/100) — stress tests à réaliser.`); }
  if (margeBrute != null) { if (margeBrute > 0) pointsForts.push(`Marge brute positive (${fmtEurLocal(margeBrute)}).`); else vigilances.push(`Marge brute nulle ou négative (${fmtEurLocal(margeBrute)}) — l'opération ne dégage pas de valeur dans les hypothèses actuelles.`); }
  if (cashflow != null) { if (cashflow > 0) pointsForts.push(`Cashflow mensuel positif (${fmtEurLocal(cashflow)}/mois).`); else vigilances.push(`Cashflow mensuel négatif (${fmtEurLocal(cashflow)}/mois) — effort mensuel à financer.`); }
  if (!hasEnoughData) vigilances.push("Données marché absentes — lancez l'étude de marché pour obtenir les SmartScores.");

  // ── Checklist ──
  const checklistDone = checklist != null
    ? checklist.filter((c) => {
        const item = c as { checked?: boolean; done?: boolean; status?: string };
        return item.checked === true || item.done === true || item.status === "done" || item.status === "ok";
      }).length
    : null;
  const checklistTotal = checklist?.length ?? null;

  // ── Adresse / prix au m² ──
  const adresse = [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ") || "Non renseignée";
  const prixM2Deal = deal.surfaceM2 > 0 ? Math.round(deal.prixAchat / deal.surfaceM2) : null;

  // ── BUILD MARKDOWN ────────────────────────────────────────────────
  const L: string[] = [];

  L.push("# Synthèse Exécutive Mimmoza", "");
  L.push(`_Générée le ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} — synthèse déterministe Mimmoza_`, "");

  L.push("## Décision", "");
  L.push(`**${decision}**`, "");
  L.push(lectureMimmoza(), "");

  L.push("## Résumé du deal", "");
  L.push(`- **Adresse** : ${adresse}`);
  L.push(`- **Prix d'achat** : ${fmtEurLocal(deal.prixAchat)}`);
  L.push(`- **Surface** : ${deal.surfaceM2 > 0 ? deal.surfaceM2 + " m²" : "ND"}`);
  L.push(`- **Prix au m²** : ${prixM2Deal != null ? prixM2Deal.toLocaleString("fr-FR") + " €/m²" : "ND"}`);
  if (deal.prixReventeCible > 0) L.push(`- **Prix de revente cible** : ${fmtEurLocal(deal.prixReventeCible)}`);
  L.push(`- **Stratégie** : ${strategyLabel(strategy)}`);
  if (strategy === "location") L.push(`- **Régime fiscal** : ${fiscalRegimeLabel(fiscalRegime)}`);
  L.push(`- **DPE** : ${deal.dpeNote}`);
  L.push("");

  L.push("## SmartScores", "");
  L.push("| Score | Valeur | Niveau |");
  L.push("|-------|--------|--------|");
  const scoreRows: [string, number | undefined][] = [
    ["SmartScore (global)", smartScore],
    ["Liquidité", liquidite],
    ["Opportunity", opportunity],
    ["Pression Risque", pressionRisque],
    ["Rentabilité", rentabilite],
    ["Robustesse", robustesse],
    ["Confiance données", confidence],
  ];
  for (const [label, val] of scoreRows) {
    const v = val != null ? Math.round(val) : null;
    const lvl = v != null ? scoreLevel(v) : "ND";
    L.push(`| ${label} | ${v != null ? `${v}/100` : "ND"} | ${lvl} |`);
  }
  L.push("");

  L.push("## Rentabilité", "");
  L.push(`- **Rendement brut** : ${fmtPct(rendementBrut)}`);
  L.push(`- **Rendement net** : ${fmtPct(rendementNet)}`);
  L.push(`- **Cashflow mensuel** : ${cashflow != null ? fmtEurLocal(cashflow) + "/mois" : "ND"}`);
  L.push(`- **Marge brute** : ${fmtEurLocal(margeBrute)}`);
  L.push(`- **Marge brute %** : ${fmtPct(margeBrutePct)}`);
  L.push(`- **Mensualité crédit** : ${mensualite != null ? fmtEurLocal(mensualite) + "/mois" : "ND"}`);
  L.push(`- **Capital engagé** : ${fmtEurLocal(capitalEngage)}`);
  L.push("");

  L.push("## Marché / Risques", "");
  if (prixM2Median != null) L.push(`- **Prix m² médian DVF** : ${prixM2Median.toLocaleString("fr-FR")} €/m²`);
  if (nbTransactions != null) L.push(`- **Transactions DVF** : ${Math.round(nbTransactions)}`);
  if (smartScore != null) L.push(`- **Score marché global** : ${scoreStr(smartScore)}`);
  if (bpeScore != null) L.push(`- **BPE Score (équipements)** : ${Math.round(bpeScore)}/100 — ${getBpeLevel(bpeScore)}`);
  if (prixM2Median == null && nbTransactions == null && smartScore == null) L.push("_Données marché non chargées — lancez l'étude depuis l'onglet Marché/Risques._");
  L.push("");

  L.push("## Travaux", "");
  if (travauxComputed) {
    if (travauxComputed.total != null) L.push(`- **Budget travaux (brut)** : ${fmtEurLocal(travauxComputed.total)}`);
    if (travauxComputed.totalWithBuffer != null) L.push(`- **Total avec marge (${travauxComputed.bufferPct ?? "?"}%)** : ${fmtEurLocal(travauxComputed.totalWithBuffer)}`);
    if (travauxComputed.costPerM2 != null) L.push(`- **Coût au m²** : ${fmtEurLocal(travauxComputed.costPerM2)}/m²`);
  } else if (travauxEstimes != null) {
    L.push(`- **Travaux estimés** : ${fmtEurLocal(travauxEstimes)}`);
  } else {
    L.push("_Aucune simulation travaux renseignée._");
  }
  L.push("");

  L.push("## Due Diligence", "");
  if (checklistTotal != null && checklistTotal > 0) {
    L.push(`- **Checklist** : ${checklistDone ?? 0}/${checklistTotal} points validés`);
  } else {
    L.push("- Checklist non renseignée.");
  }
  if (risquesNonFin && risquesNonFin.length > 0) {
    L.push(`- **Risques non financiers** : ${risquesNonFin.length} identifié(s)`);
    risquesNonFin.slice(0, 5).forEach((r) => {
      const label = typeof r === "string" ? r : ((r as { label?: string }).label ?? (r as { description?: string }).description ?? JSON.stringify(r));
      L.push(`  - ${label}`);
    });
  }
  L.push("");

  L.push("## Points forts", "");
  if (pointsForts.length > 0) pointsForts.forEach((p) => L.push(`- ✅ ${p}`));
  else L.push("- Aucun point fort identifié sur la base des données disponibles.");
  L.push("");

  L.push("## Points de vigilance", "");
  if (vigilances.length > 0) vigilances.forEach((v) => L.push(`- ⚠️ ${v}`));
  else L.push("- Aucun point de vigilance majeur détecté.");
  L.push("");

  L.push("## Recommandation finale", "");
  switch (decision) {
    case "ACHETER":
      L.push(`Sur la base des données Mimmoza disponibles, l'opération présente un profil favorable. SmartScore (${scoreStr(smartScore)}), rentabilité (${scoreStr(rentabilite)}) et pression risque (${scoreStr(pressionRisque)}) sont cohérents avec un passage à l'acte. Vérifiez la due diligence juridique et technique avant signature.`);
      break;
    case "NEGOCIER":
      L.push("L'opération mérite d'être travaillée : certains indicateurs sont encourageants mais des marges de négociation existent. Ciblez en priorité le prix d'acquisition et le cadrage travaux. Relancez la synthèse après ajustement des hypothèses.");
      break;
    case "PASSER":
      L.push("Les indicateurs disponibles ne permettent pas de valider cette opération dans ses paramètres actuels. Risque trop élevé et/ou rentabilité insuffisante. Réévaluez le prix cible ou les conditions d'acquisition.");
      break;
    default:
      L.push("Données insuffisantes pour conclure. Complétez l'étude de marché et les paramètres de rentabilité pour obtenir une recommandation fiable.");
  }
  L.push("");
  L.push("---");
  L.push("_Synthèse Mimmoza — données issues du snapshot local._");

  return L.join("\n");
}// ─── Component ───────────────────────────────────────────────────────

export default function AnalysePage() {
  const activeDeal = useActiveMarchandDeal();
  const investisseurTravaux = useInvestisseurTravaux();
  const [searchParams] = useSearchParams();
  const activeTab: AnalyseTab = resolveAnalyseTab(searchParams.get("tab"));
  const [strategy, setStrategy] = useState<StrategyType>("revente");
  const [fiscalRegime, setFiscalRegime] = useState<FiscalRegime>("lmnp_reel");
  const [dueDiligence, setDueDiligence] = useState<DueDiligenceState>(createDefaultDueDiligence);
  const ddJustLoadedRef = useRef(false);
  const deal = useMemo<DealInputs | null>(() => (activeDeal ? mapMarchandDealToDealInputs(activeDeal) : null), [activeDeal]);
  const canonicalDealId = useMemo<string>(() => activeDeal?.id ?? deal?.dealId ?? "", [activeDeal?.id, deal?.dealId]);
  const travauxImpactWithBuffer: number = investisseurTravaux?.computed?.totalWithBuffer ?? 0;
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState>(PDF_PREVIEW_INITIAL);
  const pdfUrlRef = useRef<string | null>(null);
  const autoExportedRef = useRef(false);
  const [pdfLogo, setPdfLogo] = useState<{ dataUrl: string; aspect: number } | null>(null);
  const [pdfCoverImage, setPdfCoverImage] = useState<string | null>(null);

  // ─── snapshotTick ─────────────────────────────────────────────────
  const [snapshotTick, setSnapshotTick] = useState(0);
  useEffect(() => {
    const onSnap = () => setSnapshotTick((x) => x + 1);
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as EventListener);
    return () => window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as EventListener);
  }, []);

  useEffect(() => {
    let mounted = true;
    loadImageDataUrl(logoMimmozaUrl)
      .then((logo) => { if (mounted) setPdfLogo(logo); })
      .catch((err) => { console.warn("[PDF] impossible de charger le logo", err); });
    loadImageDataUrl(coverImageUrl)
      .then((cover) => { if (mounted) setPdfCoverImage(cover.dataUrl); })
      .catch((err) => { console.warn("[PDF] impossible de charger la cover", err); });
    return () => { mounted = false; };
  }, []);

  const revokePreviousPdfUrl = useCallback(() => {
    if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
  }, []);

  useEffect(() => () => { revokePreviousPdfUrl(); }, [canonicalDealId, revokePreviousPdfUrl]);

  useEffect(() => {
    if (pdfPreview.loading) { autoExportedRef.current = false; return; }
    if (pdfPreview.url && !autoExportedRef.current) {
      autoExportedRef.current = true;
      const anchor = document.createElement("a"); anchor.href = pdfPreview.url;
      const safeLabel = (deal?.label ?? "export").replace(/[^a-zA-Z0-9À-ÿ _-]/g, "").replace(/\s+/g, "_").slice(0, 80);
      anchor.download = `analyse-${safeLabel}.pdf`;
      document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
    }
  }, [pdfPreview.url, pdfPreview.loading, deal?.label]);

  // ─── Merged investor ← promoteur study ───────────────────────────
  const investorStudyData = useMemo(() => {
    if (!canonicalDealId) return null;
    const snap = readMarchandSnapshot();
    return (snap.marcheRisquesByDeal[canonicalDealId] ?? null) as Record<string, unknown> | null;
  }, [canonicalDealId, snapshotTick]);

  const promoteurMarketSnapshot = useMemo(() => {
    return readPromoteurMarketSnapshot(canonicalDealId);
  }, [canonicalDealId, snapshotTick]);

  const mergedInvestorStudy = useMemo(() => {
    const merged = deepMergeInvestorWithPromoteur(investorStudyData, promoteurMarketSnapshot);
    console.debug("[InvestisseurBridge] Fusion investisseur <- promoteur", {
      activeDealId: canonicalDealId, hasInvestorStudy: !!investorStudyData,
      hasPromoteurSnapshot: !!promoteurMarketSnapshot, mergedKeys: merged ? Object.keys(merged) : [],
    });
    return merged;
  }, [canonicalDealId, investorStudyData, promoteurMarketSnapshot]);

  // ─── PDF preview ──────────────────────────────────────────────────
  const generatePdfPreview = useCallback(async (markdown: string): Promise<void> => {
    setPdfPreview({ url: null, loading: true, error: null });
    try {
      const snapshot = readMarchandSnapshot();
      const now = new Date().toISOString();
      const marketScores = resolveMarketScoresForPdf(snapshot, canonicalDealId);
      const blob = await buildSnapshotPdfBlob(snapshot, {
        aiReport: {
          analysis: { narrativeMarkdown: markdown },
          computed: { scores: marketScores },
        },
        context: { generatedAt: now },
        space: "investisseur",
        logo: pdfLogo?.dataUrl,
        logoAspect: pdfLogo?.aspect,
        coverImage: pdfCoverImage ?? undefined,
      });
      revokePreviousPdfUrl();
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfPreview({ url, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de la génération du PDF";
      console.error("[AnalysePage] generatePdfPreview error:", err);
      setPdfPreview({ url: null, loading: false, error: message });
    }
  }, [canonicalDealId, revokePreviousPdfUrl, pdfLogo, pdfCoverImage]);

  const refreshPdfPreview = useCallback(async (markdown: string): Promise<void> => {
    await generatePdfPreview(markdown);
  }, [generatePdfPreview]);

  useEffect(() => {
    if (!canonicalDealId) return;
    ddJustLoadedRef.current = true;
    revokePreviousPdfUrl();
    setPdfPreview(PDF_PREVIEW_INITIAL);
    autoExportedRef.current = false;
    const saved = loadAnalyseState(canonicalDealId);
    if (saved) { setStrategy(saved.strategy); setFiscalRegime(saved.fiscalRegime); setDueDiligence(saved.dueDiligence); }
    else { setStrategy("revente"); setFiscalRegime("lmnp_reel"); setDueDiligence(createDefaultDueDiligence()); }
    requestAnimationFrame(() => { ddJustLoadedRef.current = false; });
  }, [canonicalDealId, revokePreviousPdfUrl]);

  useEffect(() => {
    if (!canonicalDealId) return;
    saveAnalyseState(canonicalDealId, { strategy, fiscalRegime, scenarios: [], dueDiligence });
    if (!ddJustLoadedRef.current) {
      patchDueDiligenceForDeal(canonicalDealId, { state: dueDiligence, updatedAt: new Date().toISOString() });
    }
  }, [strategy, fiscalRegime, dueDiligence, canonicalDealId]);

  const risquesExistants = useMemo(() => {
    if (!activeDeal) return [];
    const enriched = (activeDeal as unknown as { enriched?: { risques?: unknown } }).enriched;
    if (!enriched?.risques) return [];
    const r = enriched.risques as { items?: unknown; nbRisques?: unknown };
    const items: string[] = [];
    if (r.items && Array.isArray(r.items)) {
      (r.items as unknown[]).forEach((item) => {
        if (typeof item === "string") items.push(item);
        else if (typeof item === "object" && item != null && "label" in item) {
          const lbl = (item as { label?: unknown }).label;
          if (typeof lbl === "string" && lbl.trim()) items.push(lbl);
        }
      });
    }
    const nbRisk = safeNum(r.nbRisques);
    if (nbRisk != null && nbRisk > 0 && items.length === 0) items.push(`${nbRisk} risque(s) identifié(s) — détails à consulter sur Géorisques.`);
    return items;
  }, [activeDeal]);

  const handleDueDiligenceUpdate = useCallback((dd: DueDiligenceState) => setDueDiligence(dd), []);

  // ─── SmartScores UI ───────────────────────────────────────────────
  const smartScoresUi = useMemo(() => {
    const snap = readMarchandSnapshot();
    const renta = snap.rentabiliteByDeal[canonicalDealId] as RentabiliteSaved | undefined;
    const mr = mergedInvestorStudy as Record<string, unknown> | null;
    const rentaComputed = (renta?.computed ?? (renta as unknown as { results?: unknown })?.results ?? (renta as unknown as { output?: unknown })?.output ?? null) as Record<string, unknown> | null;
    const mrAny = mr as unknown as Record<string, unknown> | undefined;
    const mrData = (mrAny?.data ?? null) as Record<string, unknown> | null;
    const mrScores = (mrData?.scores ?? mrAny?.breakdown ?? mrAny?.scores ?? null) as Record<string, unknown> | null;

    const globalRaw = firstNum(mrAny?.scoreGlobal, mrAny?.score, (mrScores as { global?: unknown } | null)?.global, (mrData as { smartScore?: unknown } | null)?.smartScore, (mrData as { score?: unknown } | null)?.score, (mrData as { scoreGlobal?: unknown } | null)?.scoreGlobal, (activeDeal as unknown as { smartScore?: unknown } | null)?.smartScore, (activeDeal as unknown as { enriched?: { smartScore?: unknown } } | null)?.enriched?.smartScore, (activeDeal as unknown as { enriched?: { score?: unknown } } | null)?.enriched?.score, (activeDeal as unknown as { scores?: { smartScore?: unknown } } | null)?.scores?.smartScore, (activeDeal as unknown as { scores?: { global?: unknown } } | null)?.scores?.global);
    const liquiditeRaw = firstNum((mrScores as { liquidite?: unknown } | null)?.liquidite, (mrScores as { liquidity?: unknown } | null)?.liquidity, (mrScores as { liquidityScore?: unknown } | null)?.liquidityScore, (mrData as { liquidite?: unknown } | null)?.liquidite, (mrData as { liquidity?: unknown } | null)?.liquidity, (mrData as { liquidityScore?: unknown } | null)?.liquidityScore, (activeDeal as unknown as { enriched?: { liquidite?: unknown } } | null)?.enriched?.liquidite, (activeDeal as unknown as { enriched?: { liquidity?: unknown } } | null)?.enriched?.liquidity, (activeDeal as unknown as { enriched?: { liquidityScore?: unknown } } | null)?.enriched?.liquidityScore, (mrScores as { demande?: unknown } | null)?.demande);
    const opportunityRaw = firstNum((mrScores as { opportunity?: unknown } | null)?.opportunity, (mrScores as { opportunite?: unknown } | null)?.opportunite, (mrScores as { opportunityScore?: unknown } | null)?.opportunityScore, (mrData as { opportunity?: unknown } | null)?.opportunity, (mrData as { opportunite?: unknown } | null)?.opportunite, (mrData as { opportunityScore?: unknown } | null)?.opportunityScore, (activeDeal as unknown as { enriched?: { opportunity?: unknown } } | null)?.enriched?.opportunity, (activeDeal as unknown as { enriched?: { opportunite?: unknown } } | null)?.enriched?.opportunite, (activeDeal as unknown as { enriched?: { opportunityScore?: unknown } } | null)?.enriched?.opportunityScore, (mrScores as { offre?: unknown } | null)?.offre);
    const pressionRisqueRaw = firstNum((mrScores as { pressionRisque?: unknown } | null)?.pressionRisque, (mrScores as { riskPressure?: unknown } | null)?.riskPressure, (mrScores as { riskPressureScore?: unknown } | null)?.riskPressureScore, (mrData as { pressionRisque?: unknown } | null)?.pressionRisque, (mrData as { riskPressure?: unknown } | null)?.riskPressure, (mrData as { riskPressureScore?: unknown } | null)?.riskPressureScore, (activeDeal as unknown as { enriched?: { pressionRisque?: unknown } } | null)?.enriched?.pressionRisque, (activeDeal as unknown as { enriched?: { riskPressure?: unknown } } | null)?.enriched?.riskPressure, (activeDeal as unknown as { enriched?: { riskPressureScore?: unknown } } | null)?.enriched?.riskPressureScore, (mrScores as { environnement?: unknown } | null)?.environnement);
    const rentabiliteRaw = firstNum(rentaComputed?.rentabilite, (rentaComputed as { profitability?: unknown } | null)?.profitability);
    const robustesseRaw = firstNum(rentaComputed?.robustesse, (rentaComputed as { robustness?: unknown } | null)?.robustness);
    const confidenceRaw = firstNum((mrData as { dataConfidence?: unknown } | null)?.dataConfidence, (mrAny as { dataConfidence?: unknown } | undefined)?.dataConfidence, (mrData as { confidence?: unknown } | null)?.confidence, (mrAny as { confidence?: unknown } | undefined)?.confidence, (activeDeal as unknown as { enriched?: { dataConfidence?: unknown } } | null)?.enriched?.dataConfidence, (activeDeal as unknown as { enriched?: { confidence?: unknown } } | null)?.enriched?.confidence);
    const ks = ((rentaComputed?.killSwitches as unknown) ?? (rentaComputed as { kill_switches?: unknown } | null)?.kill_switches ?? (rentaComputed as { redFlags?: unknown } | null)?.redFlags) as unknown;
    const killSwitches: string[] = Array.isArray(ks) ? (ks as unknown[]).flatMap((x) => (typeof x === "string" ? [x] : [])) : [];
    const hasCanonicalMarket = globalRaw != null || liquiditeRaw != null || opportunityRaw != null || pressionRisqueRaw != null || confidenceRaw != null;
    const status: "calculé" | "estimé" = hasCanonicalMarket ? "calculé" : "estimé";
    return { global: toScore100(globalRaw), liquidite: toScore100(liquiditeRaw), opportunity: toScore100(opportunityRaw), pressionRisque: toScore100(pressionRisqueRaw), rentabilite: toScore100(rentabiliteRaw), robustesse: toScore100(robustesseRaw), confidence: toScore100(confidenceRaw), status, killSwitches };
  }, [canonicalDealId, activeDeal, mergedInvestorStudy, snapshotTick]);

  // ─── Export PDF depuis SyntheseIAPanel ────────────────────────────
  const handleExportPdfFromSynthese = useCallback((markdown: string) => {
    const snapshot = readMarchandSnapshot();
    const now = new Date().toISOString();
    const marketScores = resolveMarketScoresForPdf(snapshot, canonicalDealId);
    exportSnapshotToPdf(snapshot, {
      aiReport: {
        analysis: { narrativeMarkdown: markdown },
        computed: { scores: marketScores },
      },
      context: { generatedAt: now },
      space: "investisseur",
      logo: pdfLogo?.dataUrl,
      logoAspect: pdfLogo?.aspect,
      coverImage: pdfCoverImage ?? undefined,
    });
  }, [canonicalDealId, pdfLogo, pdfCoverImage]);

  const emitProgress = useCallback((pct: number, label: string) => {
    window.dispatchEvent(new CustomEvent("mimmoza:synthese:progress", { detail: { pct, label } }));
  }, []);

  // ─── v12.4 : Synthèse déterministe — aucun appel réseau ──────────
  const handleGenerateSyntheseIA = useCallback(async () => {
    if (!activeDeal || !deal) throw new Error("Aucun deal actif");

    emitProgress(5, "Initialisation…");
    emitProgress(20, "Lecture des données existantes…");

    emitProgress(55, "Construction de la synthèse exécutive…");
    const baseMarkdown = buildDeterministicSynthese(deal, canonicalDealId, strategy, fiscalRegime);

    emitProgress(80, "Mise en forme du rapport…");
    const payload = buildCanonicalPayload(deal, activeDeal, canonicalDealId, { strategy, fiscalRegime });
    const withBpe = injectBpeIntoNarrative(baseMarkdown, (payload as { bpe?: unknown }).bpe);
    const withStrategy = ensureStrategyInNarrative(withBpe, payload.investmentStrategy as Record<string, unknown>);
    const cleaned = cleanNarrativeMarkdown(withStrategy);

    emitProgress(100, "Synthèse prête !");
    return { markdown: cleaned, context: { wikimedia: null } };
  }, [activeDeal, deal, canonicalDealId, emitProgress, strategy, fiscalRegime]);

  if (!deal || !canonicalDealId) return <NoDealPlaceholder />;

  const tabTitles: Record<AnalyseTab, string> = {
    rentabilite:        "Rentabilité",
    due_diligence:      "Due Diligence",
    marche_risques:     "Étude de marché",
    analyse_predictive: "Analyse prédictive",
    synthese_ia:        "Synthèse IA",
  };

  const fmt = (v: number | undefined | null) => v != null && v > 0 ? v.toLocaleString("fr-FR") : "—";

  // ── JSX ──────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ margin: "0 auto", padding: "0" }}>
        <div style={{
  background: "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
  borderRadius: 32,
  padding: "40px 44px",
  marginBottom: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 24,
  boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
  position: "relative",
  overflow: "hidden",
}}>
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>Investisseur · Analyse</div>
            <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>{tabTitles[activeTab]}</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>{[deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ") || "Adresse non renseignée"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, background: "rgba(255,255,255,0.18)", borderRadius: 12, padding: "12px 18px", flexShrink: 0 }}>
            <span style={{ fontSize: 30, fontWeight: 600, color: "#fff" }}>{fmt(deal.prixAchat)} €</span>

            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>{fmt(deal.surfaceM2)} m² · DPE {deal.dpeNote}</span>
          </div>
        </div>
      </div>

      <div className="pb-6">
        {activeTab === "rentabilite" && (
          <RentabilitePanel deal={deal as any} dealId={canonicalDealId} strategy={strategy} fiscalRegime={fiscalRegime} onStrategyChange={setStrategy} onRegimeChange={setFiscalRegime} travauxFromSnapshot={travauxImpactWithBuffer > 0 ? travauxImpactWithBuffer : undefined} promoteurMarketData={mergedInvestorStudy} />
        )}
        {activeTab === "due_diligence" && (
          <DueDiligencePanel state={dueDiligence} onUpdate={handleDueDiligenceUpdate} risquesExistants={risquesExistants} />
        )}
        {activeTab === "marche_risques" && (
          <div className="space-y-5">
            <MarcheRisquesPanel dealId={canonicalDealId} dealInputs={{ address: deal.address, zipCode: deal.zipCode, city: deal.city, lat: deal.lat, lng: deal.lng }} promoteurMarketData={mergedInvestorStudy} />
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 print:shadow-none print:border-gray-300">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div><div className="flex items-center gap-2"><div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-500/15 via-sky-500/10 to-emerald-500/10 ring-1 ring-gray-200 flex items-center justify-center print:bg-white print:ring-gray-300"><span className="text-lg">✨</span></div><div><h2 className="text-lg font-semibold text-gray-900 print:text-black">SmartScores</h2><p className="text-sm text-gray-500 print:text-gray-700">Synthèse lisible sur 100 des facteurs clés (marché, risque, rentabilité, robustesse).</p></div></div></div>
                <div className="sm:pt-1"><ConfidenceMeter value={smartScoresUi.confidence} /></div>
              </div>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <ScoreCard label="SmartScore" value={smartScoresUi.global} status={smartScoresUi.status} />
                <ScoreCard label="Liquidité" value={smartScoresUi.liquidite} status={smartScoresUi.status} />
                <ScoreCard label="Opportunity" value={smartScoresUi.opportunity} status={smartScoresUi.status} />
                <ScoreCard label="Pression Risque" value={smartScoresUi.pressionRisque} invert={true} status={smartScoresUi.status} hint="plus bas = mieux" />
              </div>
              <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ScoreCard label="Rentabilité" value={smartScoresUi.rentabilite} status={smartScoresUi.status} />
                <ScoreCard label="Robustesse" value={smartScoresUi.robustesse} status={smartScoresUi.status} />
              </div>
              <div className="mt-5"><InfoBlock /></div>
              <div className="mt-5"><KillSwitchesBox items={smartScoresUi.killSwitches} /></div>
            </section>
          </div>
        )}
        {activeTab === "analyse_predictive" && (
          <AnalysePredictivePanel deal={deal} travauxEstime={travauxImpactWithBuffer > 0 ? travauxImpactWithBuffer : undefined} />
        )}
        {activeTab === "synthese_ia" && (
          <SyntheseIAPanel
              dealLabel={deal.label}
              isAvailable={true}
              onGenerate={handleGenerateSyntheseIA}
              onExportPdf={handleExportPdfFromSynthese}
              pdfUrl={pdfPreview.url}
              exportContext={{ wikimedia: null }}
            />
        )}
      </div>
    </div>
  );
}

// ─── ensureStrategyInNarrative ────────────────────────────────────────

function ensureStrategyInNarrative(narrative: string, investmentStrategy: Record<string, unknown> | undefined): string {
  if (!investmentStrategy) return narrative;
  const strat = investmentStrategy.strategyLabel as string | undefined;
  const fiscal = investmentStrategy.fiscalRegimeLabel as string | undefined;
  const horizon = investmentStrategy.horizonYears as number | null;
  const resale = investmentStrategy.resaleTarget as number | null;
  const isRevente = investmentStrategy.strategy === "revente";
  if (!strat) return narrative;
  const alreadyPresent = /strat[ée]gie\s+(choisie|d['']investissement|retenue)/i.test(narrative);
  if (alreadyPresent) return narrative;
  const lines: string[] = ["", "### Strat\u00e9gie d\u2019investissement", "", `**Strat\u00e9gie choisie\u00a0: ${strat}**`];
  if (isRevente) {
    lines.push("- _Logique marchand de biens\u00a0: horizon de d\u00e9tention vis\u00e9 court. La dur\u00e9e effective de portage d\u00e9termine directement le co\u00fbt financier et la fiscalit\u00e9 applicable \u2014 \u00e0 cadrer pr\u00e9cis\u00e9ment avec le conseil juridique et fiscal adapt\u00e9 \u00e0 la structure retenue._");
  } else {
    if (fiscal && investmentStrategy.fiscalRegime !== "none") lines.push(`- R\u00e9gime fiscal\u00a0: ${fiscal}`);
  }
  if (horizon != null) lines.push(isRevente ? `- Horizon cible\u00a0: **${horizon}\u00a0an${horizon > 1 ? "s" : ""}** _(portage court terme vis\u00e9)_` : `- Horizon\u00a0: ${horizon}\u00a0an${horizon > 1 ? "s" : ""}`);
  if (resale != null) lines.push(`- Revente cible\u00a0: ${resale.toLocaleString("fr-FR")}\u00a0\u20ac`);
  lines.push("");
  const block = lines.join("\n");
  const firstHeadingMatch = /^#{1,3}\s+.+$/m.exec(narrative);
  if (firstHeadingMatch) {
    const insertAfter = firstHeadingMatch.index + firstHeadingMatch[0].length;
    return narrative.slice(0, insertAfter) + "\n" + block + narrative.slice(insertAfter);
  }
  return block + "\n" + narrative;
}