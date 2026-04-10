// === exportPdf.ts — Investisseur — v2 SHARDS COVER ===
// Identique à la version précédente sauf buildCover() qui utilise
// des shards diagonaux sky-blue au lieu du dégradé plat.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";
import { buildSyntheseInstitutionnellePage } from "./exportPdf.investisseur";

export { autoTable };

// ─── Color Tokens ────────────────────────────────────────────────
export const C = {
  primary:    [2, 6, 23]      as const,
  accent:     [79, 70, 229]   as const,
  accentDark: [55, 48, 163]   as const,
  accentCyan: [6, 182, 212]   as const,
  success:    [16, 185, 129]  as const,
  warning:    [245, 158, 11]  as const,
  danger:     [100, 116, 139] as const,
  black:      [2, 6, 23]      as const,
  body:       [51, 65, 85]    as const,
  muted:      [100, 116, 139] as const,
  mutedDark:  [71, 85, 105]   as const,
  white:      [255, 255, 255] as const,
  bg:         [241, 245, 249] as const,
  bgAlt:      [226, 232, 240] as const,
  bgCard:     [255, 255, 255] as const,
  border:     [226, 232, 240] as const,
  borderDark: [203, 213, 225] as const,
  navy:       [2, 6, 23]      as const,
  navyMid:    [15, 23, 42]    as const,
  navyCard:   [15, 23, 42]    as const,
  accentSoft: [238, 242, 255] as const,
  accentSoft2:[240, 249, 255] as const,
  shadow:     [218, 224, 232] as const,
  killBg:     [241, 245, 249] as const,
  killBorder: [203, 213, 225] as const,
  confBg:     [248, 250, 252] as const,
  confBorder: [203, 213, 225] as const,
  confText:   [71, 85, 105]   as const,
  scoreGreen: [16, 185, 129]  as const,
  scoreAmber: [245, 158, 11]  as const,
  scoreRed:   [100, 116, 139] as const,
  chipBg:     [241, 245, 249] as const,
  chipText:   [71, 85, 105]   as const,
  coverBg:    [2, 6, 23]      as const,
  coverMid:   [15, 23, 42]    as const,
  gold:       [6, 182, 212]   as const,
  teal:       [45, 212, 191]  as const,
};

export const M  = { top: 20, left: 16, right: 16, bottom: 20 };
export const CW = 210 - M.left - M.right;
export const PW = 210;
export const PH = 297;

// ═══════════════════════════════════════════════════════════════════
// ─── TYPES ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export interface ExportPdfOpts {
  pdfMode?: "light" | "full";
  space?: "marchand" | "investisseur";
  aiReport?: AiReport;
  context?: Record<string, unknown>;
}

export interface AiReport {
  analysis?: {
    conclusion?: {
      decision?: string;
      confidence?: number | string;
      premiumVsDvfPct?: number;
      smartScore?: number;
      liquidityScore?: number;
      riskPressureScore?: number;
      opportunityScore?: number;
      maxEngagementPriceEur?: number;
      neverExceedPriceEur?: number;
    };
    finalSummary?: {
      whyBuy?: string[];
      whatToDo?: string[];
      top3ActionsNow?: string[];
      killSwitches?: string[];
      upside?: string[];
      downside?: string[];
      missingData?: string[];
      dataToGetBeforeSigning?: string[];
      conditionsToBuy?: string[];
      neverExceedPrice?: number;
      maxPrice?: number;
      maxEngagementPriceEur?: number;
      neverExceedPriceEur?: number;
      messageToAgent?: string;
      stressTest?: StressRow[];
      gainPotentiel?: number;
      pertePotentielle?: number;
      stressTestReadable?: string;
      checklist?: ChecklistItem[];
      resumeCourt?: string;
      decisionToday?: string;
      narrativeResume?: string;
      narrativeValeur?: string;
      narrativeLimites?: string;
      narrativeFinancier?: string;
      narrativeProfil?: string;
      narrativeConclusion?: string;
    };
    marketStatus?: { dvfSummary?: { premiumVsDvfPct?: number }; [k: string]: unknown };
    smartScore?: number;
    liquidite?: number;
    opportunity?: number;
    pressionRisque?: number;
    dueDiligence?: DueDiligenceRow[];
    ficheOperation?: Record<string, string | number | null>[];
    narrativeMarkdown?: string;
  };
  computed?: {
    smartScore?: number;
    scores?: {
      smartScore?: number;
      liquidityScore?: number;
      riskPressureScore?: number;
      opportunityScore?: number;
      premiumVsDvfPct?: number;
    };
  };
}

interface StressRow      { scenario: string; impact: string; marge: string; statut: string }
interface ChecklistItem  { phase: string; label: string; done?: boolean }
interface DueDiligenceRow { item: string; statut: string; detail?: string }

export interface NormalizedAi {
  verdict: string; confidence: string;
  smartScore: string; liquidityScore: string; riskPressureScore: string; opportunityScore: string;
  whyBuy: string[]; whatToDo: string[]; killSwitches: string[];
  upside: string[]; downside: string[];
  missingData: string[]; conditionsToBuy: string[];
  maxPrice: string; neverExceed: string;
  maxPriceSource: "ia" | "fallback" | "none";
  neverExceedSource: "ia" | "fallback" | "none";
  maxPriceWhy: string; neverExceedWhy: string;
  messageToAgent: string;
  stressTest: StressRow[];
  gainPotentiel: string; pertePotentielle: string; stressTestReadable: string;
  checklist: ChecklistItem[]; dueDiligence: DueDiligenceRow[];
  ficheOperation: Record<string, string | number | null>[];
  narrativeSummary: string; resumeCourt: string;
  nrResume: string; nrValeur: string; nrLimites: string;
  nrFinancier: string; nrProfil: string; nrConclusion: string;
}

// ═══════════════════════════════════════════════════════════════════
// ─── SANITIZE / FORMAT ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export function sanitizeForPdf(s: unknown): string {
  if (s == null) return "";
  const o = String(s)
    .replace(/[\u00A0\u202F\u2007\u2002-\u200A\u205F\u3000]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\u2060\u180E]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\uFF07]/g, "'")
    .replace(/[\u201C-\u201F\u00AB\u00BB\uFF02]/g, '"')
    .replace(/[\u2022\u2023\u2043\u2219\u25A0-\u25FF\u2B50]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2192\u279C\u27A4\u21D2]/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/[\u2713\u2714\u2705\u2611]/g, "[v]")
    .replace(/[\u2717\u2718\u274C\u2715\u2716\u2612]/g, "[x]")
    .replace(/\u26A0/g, "/!\\")
    .replace(/[\u2606\u2605]/g, "*")
    .replace(/\u0152/g, "OE").replace(/\u0153/g, "oe")
    .replace(/\t/g, "  ")
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "");
  return o.trim();
}

export function fmtCurrency(v: unknown): string {
  if (v == null || v === "") return "ND";
  const n = Number(v);
  if (isNaN(n) || n === 0) return "ND";
  const abs = Math.abs(Math.round(n));
  const parts: string[] = [];
  let rem = abs;
  while (rem >= 1000) { parts.unshift(String(rem % 1000).padStart(3, "0")); rem = Math.floor(rem / 1000); }
  parts.unshift(String(rem));
  return (n < 0 ? "-" : "") + parts.join(" ") + " EUR";
}

export function fmtPercent(v: unknown, d = 1): string {
  const n = Number(v);
  if (v == null || isNaN(n)) return "ND";
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)} %`;
}

export function fmtNumber(v: unknown, d = 0): string {
  const n = Number(v);
  if (v == null || isNaN(n)) return "ND";
  const abs = Math.abs(n);
  const rounded = d === 0 ? Math.round(abs) : parseFloat(abs.toFixed(d));
  const intPart = Math.floor(rounded);
  const decPart = d > 0 ? "," + abs.toFixed(d).split(".")[1] : "";
  const parts: string[] = [];
  let rem = intPart;
  if (rem === 0) { parts.push("0"); } else {
    while (rem >= 1000) { parts.unshift(String(rem % 1000).padStart(3, "0")); rem = Math.floor(rem / 1000); }
    parts.unshift(String(rem));
  }
  return (n < 0 ? "-" : "") + parts.join(" ") + decPart;
}

export function decisionLabel(d: string): string {
  const map: Record<string, string> = {
    buy: "ACHETER", hold: "ATTENDRE", pass: "PASSER",
    strong_buy: "ACHETER (FORT)", strong_pass: "NE PAS ACHETER",
    negocier: "A NEGOCIER", negotiate: "A NEGOCIER",
  };
  return map[d?.toLowerCase()] ?? (d ? d.toUpperCase() : "ND");
}

export function decisionColors(d: string): readonly [number, number, number] {
  const dl = d?.toLowerCase() ?? "";
  if (dl.includes("buy") || dl === "acheter" || dl === "strong_buy") return C.primary;
  if (dl === "hold" || dl === "attendre" || dl === "negocier" || dl === "negotiate") return C.accent;
  return C.muted;
}

// ─── Drawing primitives ──────────────────────────────────────────
function sc(doc: jsPDF, c: readonly [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]); }
function sf(doc: jsPDF, c: readonly [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]); }
function sd(doc: jsPDF, c: readonly [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]); }

export function roundedBox(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  o?: { fill?: readonly [number, number, number]; border?: readonly [number, number, number]; radius?: number; lw?: number; shadow?: boolean },
): void {
  const r = o?.radius ?? 2.5;
  if (o?.shadow) {
    sf(doc, C.shadow);
    doc.roundedRect(x + 0.7, y + 0.7, w, h, r, r, "F");
  }
  if (o?.fill) sf(doc, o.fill);
  if (o?.border) { sd(doc, o.border); doc.setLineWidth(o?.lw ?? 0.25); }
  doc.roundedRect(x, y, w, h, r, r, o?.fill && o?.border ? "FD" : o?.fill ? "F" : "S");
}

function ribbon(
  doc: jsPDF, y: number, h: number,
  from: readonly [number, number, number], to: readonly [number, number, number],
  n = 60, x0 = 0, w = PW,
): void {
  const stepW = w / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    doc.setFillColor(
      Math.round(from[0] + t * (to[0] - from[0])),
      Math.round(from[1] + t * (to[1] - from[1])),
      Math.round(from[2] + t * (to[2] - from[2])),
    );
    doc.rect(x0 + i * stepW, y, stepW + 0.5, h, "F");
  }
}

export function sectionTitle(
  doc: jsPDF, title: string, y: number,
  o?: { color?: readonly [number, number, number]; fontSize?: number },
): number {
  const color  = o?.color ?? C.primary;
  const fs     = o?.fontSize ?? 9;
  const barH   = fs * 0.55;
  y += 2;
  const barY   = y - barH + 0.5;
  sf(doc, color);
  doc.rect(M.left, barY, 2.5, barH, "F");
  sc(doc, color); doc.setFont("helvetica", "bold"); doc.setFontSize(fs);
  doc.text(sanitizeForPdf(title).toUpperCase(), M.left + 5, y);
  return y + 6.5;
}

export function ensureSpace(doc: jsPDF, needed: number): number {
  const cur = getY(doc);
  if (cur + needed > PH - M.bottom) { doc.addPage(); setY(doc, M.top + 8); return M.top + 8; }
  return cur;
}

function setY(doc: jsPDF, y: number) { (doc as jsPDF & { __cy: number }).__cy = y; }
function getY(doc: jsPDF): number    { return (doc as jsPDF & { __cy?: number }).__cy ?? M.top; }

function bulletPrefix(
  doc: jsPDF, x: number, y: number, text: string, pfx: string,
  o?: { pfxColor?: readonly [number, number, number]; textColor?: readonly [number, number, number]; mw?: number; fs?: number },
): number {
  const fs = o?.fs ?? 8.5; const mw = o?.mw ?? CW - 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs); sc(doc, o?.pfxColor ?? C.body);
  doc.text(pfx, x, y);
  const pw = doc.getTextWidth(pfx + " ");
  doc.setFont("helvetica", "normal"); sc(doc, o?.textColor ?? C.body);
  const ls: string[] = doc.splitTextToSize(sanitizeForPdf(text), mw - pw);
  doc.text(ls, x + pw, y);
  return ls.length * (fs * 0.46) + 1.5;
}

export function drawCheckbox(
  doc: jsPDF, x: number, y: number, label: string, checked: boolean, o?: { fs?: number },
): number {
  const fs = o?.fs ?? 8; const sz = 3;
  roundedBox(doc, x, y - sz + 0.3, sz, sz, { fill: checked ? C.success : C.white, border: checked ? C.success : C.borderDark, radius: 0.8, lw: 0.3 });
  if (checked) {
    sd(doc, C.white); doc.setLineWidth(0.5);
    doc.line(x + 0.5, y - 0.8, x + 1.3, y + 0.2); doc.line(x + 1.3, y + 0.2, x + sz - 0.2, y - sz + 1.1);
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs); sc(doc, C.body);
  const ls: string[] = doc.splitTextToSize(sanitizeForPdf(label), CW - 12);
  doc.text(ls, x + sz + 2.5, y);
  return ls.length * (fs * 0.46) + 2;
}

// ═══════════════════════════════════════════════════════════════════
// ─── SCORE CARD /100 — palette Mimmoza ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════

interface ScoreCardOpts { source?: string; inverted?: boolean; subtext?: string; }

export function scoreCard100(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  label: string, score: number | null, opts?: ScoreCardOpts,
): void {
  const lvl: "excellent" | "solide" | "moyen" | "fragile" =
    score == null       ? "fragile"
    : score >= 85       ? "excellent"
    : score >= 70       ? "solide"
    : score >= 50       ? "moyen"
                        : "fragile";

  const lvlColor: readonly [number, number, number] =
    lvl === "excellent" ? C.scoreGreen
    : lvl === "solide"  ? C.accent
    : lvl === "moyen"   ? C.scoreAmber
    : [185, 70, 70]     as const;

  const lvlLabel =
    lvl === "excellent" ? "Excellent"
    : lvl === "solide"  ? "Solide"
    : lvl === "moyen"   ? "Moyen"
                        : "Fragile";

  const lvlBg: readonly [number, number, number] =
    lvl === "excellent" ? [209, 250, 229] as const
    : lvl === "solide"  ? [238, 242, 255] as const
    : lvl === "moyen"   ? [254, 243, 199] as const
    : [254, 226, 226]   as const;

  sf(doc, [210, 218, 230] as const);
  doc.roundedRect(x + 0.6, y + 0.6, w, h, 3, 3, "F");
  roundedBox(doc, x, y, w, h, { fill: C.white, border: C.border, radius: 3, lw: 0.2 });

  sf(doc, lvlColor);
  doc.roundedRect(x, y, w, 2.5, 1.5, 1.5, "F");
  sf(doc, lvlColor);
  doc.rect(x, y + 1, w, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  sc(doc, C.mutedDark);
  doc.text(sanitizeForPdf(label).toUpperCase(), x + w / 2, y + 8, { align: "center" });

  if (score != null) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    sc(doc, lvlColor);
    const scoreStr = String(score);
    const scoreW   = doc.getTextWidth(scoreStr);
    const cx       = x + w / 2;
    doc.text(scoreStr, cx - 2, y + 17, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    sc(doc, C.muted);
    doc.text("/100", cx + scoreW / 2, y + 17, { align: "left" });

    const barX = x + 5; const barW = w - 10;
    const barY = y + 20.5; const barH = 2.5;
    roundedBox(doc, barX, barY, barW, barH, { fill: C.bgAlt, radius: 1.2 });
    const fillW = Math.max(2, (score / 100) * barW);
    const INDIGO: readonly [number, number, number] = [79, 70, 229];
    const CYAN:   readonly [number, number, number] = [6, 182, 212];
    const steps  = Math.max(4, Math.round(fillW * 2));
    ribbon(doc, barY, barH, INDIGO, CYAN, steps, barX, fillW);

  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    sc(doc, C.muted);
    doc.text("ND", x + w / 2, y + 17, { align: "center" });
    roundedBox(doc, x + 5, y + 20.5, w - 10, 2.5, { fill: C.bgAlt, radius: 1.2 });
  }

  if (score != null) {
    const badgeLabel = sanitizeForPdf(lvlLabel);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    const bW = doc.getTextWidth(badgeLabel) + 6;
    const bX = x + (w - bW) / 2;
    const bY = opts?.source ? y + h - 13.5 : y + h - 8;
    roundedBox(doc, bX, bY, bW, 4, { fill: lvlBg, border: lvlColor, radius: 2, lw: 0.25 });
    sc(doc, lvlColor);
    doc.text(badgeLabel, bX + bW / 2, bY + 2.8, { align: "center" });
  }

  if (opts?.source) {
    const chipLabel = sanitizeForPdf(opts.source);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    const chipW = doc.getTextWidth(chipLabel) + 5;
    const chipX = x + (w - chipW) / 2;
    const chipY = y + h - 7;
    roundedBox(doc, chipX, chipY, chipW, 4, { fill: C.bgAlt, radius: 2 });
    sc(doc, C.chipText);
    doc.text(chipLabel, chipX + chipW / 2, chipY + 2.8, { align: "center" });
  }

  if (opts?.subtext) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(5);
    sc(doc, C.muted);
    doc.text(sanitizeForPdf(opts.subtext), x + w / 2, y + h - 1.5, { align: "center" });
  }
}

// ─── Header / Footer ─────────────────────────────────────────────
function finalizeHF(doc: jsPDF, title?: string, skipCover = true): void {
  const tot  = doc.internal.getNumberOfPages();
  const dTot = skipCover ? tot - 1 : tot;
  for (let i = 1; i <= tot; i++) {
    doc.setPage(i);
    if (skipCover && i === 1) continue;
    const dn = skipCover ? i - 1 : i;
    ribbon(doc, 0, 9, [238, 242, 255] as const, [240, 249, 255] as const, 90, 0, PW);
    doc.setFontSize(6); doc.setFont("helvetica", "normal"); sc(doc, C.accent);
    const hText = sanitizeForPdf(title ? `MIMMOZA  |  ${title}` : "MIMMOZA  |  Dossier Investisseur");
    doc.text(hText, M.left, 6);
    doc.text(new Date().toLocaleDateString("fr-FR"), PW - M.right, 6, { align: "right" });
    sd(doc, [196, 221, 253] as const); doc.setLineWidth(0.3);
    doc.line(0, 9, PW, 9);
    ribbon(doc, PH - 8, 8, [224, 231, 255] as const, [240, 249, 255] as const, 60, 0, PW);
    sd(doc, C.border); doc.setLineWidth(0.2);
    doc.line(0, PH - 8, PW, PH - 8);
    doc.setFontSize(6); sc(doc, C.muted);
    doc.text(sanitizeForPdf(`Confidentiel  --  ${dn} / ${dTot}`), PW / 2, PH - 3, { align: "center" });
    doc.text("MIMMOZA Intelligence Immobiliere", M.left, PH - 3);
    doc.text(new Date().toLocaleDateString("fr-FR"), PW - M.right, PH - 3, { align: "right" });
  }
}

// ═══════════════════════════════════════════════════════════════════
// ─── DATA EXTRACTION ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export function resolveDeal(snap: MarchandSnapshotV1): Record<string, unknown> {
  const s   = snap as Record<string, unknown>;
  const aid = s.activeDealId as string | undefined;
  const raw = s.deals;
  let deal: Record<string, unknown> = {};
  if (Array.isArray(raw)) {
    if (aid) deal = (raw as Record<string, unknown>[]).find(d => d.id === aid || d.dealId === aid) ?? {};
    if (!Object.keys(deal).length && (raw as Record<string, unknown>[]).length > 0) deal = (raw as Record<string, unknown>[])[0];
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, Record<string, unknown>>;
    if (aid && obj[aid]) deal = obj[aid];
    else { const ks = Object.keys(obj); if (ks.length) deal = obj[ks[0]]; }
  }
  return { ...s, ...deal };
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) { const v = obj[k]; if (v !== undefined && v !== null && v !== "") return v; }
  return undefined;
}
function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  const v = pick(obj, ...keys); if (v === undefined) return undefined;
  const n = Number(v); return isNaN(n) || n === 0 ? undefined : n;
}
function pickStr(obj: Record<string, unknown>, ...keys: string[]): string {
  const v = pick(obj, ...keys); return v ? sanitizeForPdf(v) : "";
}

export interface CanonicalFinancials {
  dealId: string | undefined;
  prixAchat: number | undefined;
  travaux: number | undefined;
  travauxSource: "execution_buffer" | "execution_total" | "rentabilite_inputs" | "deal_direct" | "none";
  fraisNotaire: number | undefined;
  fraisNotaireIsFallback: boolean;
  capitalEngage: number | undefined;
  prixRevente: number | undefined;
  margeBrute: number | undefined;
  margeBrutePct: number | undefined;
  apport: number | undefined;
  montantPret: number | undefined;
  mensualite: number | undefined;
  loyerEstim: number | undefined;
  chargesMensuelles: number | undefined;
  loanRatePct: number | undefined;
  loanInsurancePct: number | undefined;
  loanFraisInitiaux: number | undefined;
  stressReventeMinus5: number | undefined;
  premiumVsDvfPct: number | undefined;
  cushion: number | undefined;
}

export function resolveCanonicalFinancials(
  snap: MarchandSnapshotV1,
  opts?: ExportPdfOpts,
): CanonicalFinancials {
  const s = snap as Record<string, unknown>;
  const d = resolveDeal(snap);

  const dealId: string | undefined =
    (s.activeDealId as string | undefined) ||
    pickStr(d, "id", "dealId", "reference") ||
    undefined;

  const prixAchat = pickNum(d, "prixAchat", "prix", "price", "purchasePrice");

  const execByDeal = s.executionByDeal as Record<string, unknown> | undefined;
  const rentByDeal = s.rentabiliteByDeal as Record<string, unknown> | undefined;

  type TravauxSource = CanonicalFinancials["travauxSource"];
  let travaux: number | undefined;
  let travauxSource: TravauxSource = "none";

  const getN = (obj: unknown, ...path: string[]): number | undefined => {
    let cur: unknown = obj;
    for (const k of path) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    if (cur == null) return undefined;
    const n = Number(cur);
    return isNaN(n) || n === 0 ? undefined : n;
  };

  if (dealId && execByDeal?.[dealId]) {
    const exec = execByDeal[dealId];
    const v1 = getN(exec, "travaux", "computed", "totalWithBuffer");
    if (v1 != null) { travaux = Math.round(v1); travauxSource = "execution_buffer"; }
    else {
      const v2 = getN(exec, "travaux", "computed", "total");
      if (v2 != null) { travaux = Math.round(v2); travauxSource = "execution_total"; }
    }
  }

  if (travaux == null && dealId && rentByDeal?.[dealId]) {
    const inputs = (rentByDeal[dealId] as Record<string, unknown>).inputs;
    for (const k of ["travauxEstimes", "travaux", "montantTravaux", "coutTravaux"]) {
      const v = getN(inputs, k);
      if (v != null) { travaux = Math.round(v); travauxSource = "rentabilite_inputs"; break; }
    }
  }

  if (travaux == null) {
    const v = pickNum(d, "travaux", "travauxEstimes", "montantTravaux", "worksBudget");
    if (v != null) { travaux = v; travauxSource = "deal_direct"; }
  }

  const fraisNotaireExplicit = pickNum(d, "fraisNotaire", "notaryFees");
  const fraisNotaire = fraisNotaireExplicit ?? (prixAchat ? Math.round(prixAchat * 0.075) : undefined);
  const fraisNotaireIsFallback = fraisNotaireExplicit == null;

  const capitalEngage =
    prixAchat != null && fraisNotaire != null
      ? prixAchat + (travaux ?? 0) + fraisNotaire
      : undefined;

  const prixRevente = pickNum(d,
    "prixRevente", "prixReventeCible", "prixVenteEstime",
    "prixVente", "resaleTarget", "salePriceTarget", "salePrice",
  );

  let margeBrute: number | undefined;
  let margeBrutePct: number | undefined;
  if (prixRevente != null && capitalEngage != null && capitalEngage > 0) {
    margeBrute    = prixRevente - capitalEngage;
    margeBrutePct = (margeBrute / capitalEngage) * 100;
  }

  const stressReventeMinus5 =
    prixRevente != null && capitalEngage != null
      ? Math.round(prixRevente * 0.95) - capitalEngage
      : undefined;

  let premiumVsDvfPct = pickNum(d, "premiumVsDvfPct");
  if (premiumVsDvfPct == null) {
    const v = opts?.aiReport?.analysis?.marketStatus?.dvfSummary?.premiumVsDvfPct;
    if (v != null) { const n = Number(v); if (!isNaN(n) && n !== 0) premiumVsDvfPct = n; }
  }
  if (premiumVsDvfPct == null) {
    const v = opts?.aiReport?.analysis?.conclusion?.premiumVsDvfPct;
    if (v != null) { const n = Number(v); if (!isNaN(n) && n !== 0) premiumVsDvfPct = n; }
  }
  if (premiumVsDvfPct == null) {
    const v = opts?.aiReport?.computed?.scores?.premiumVsDvfPct;
    if (v != null) { const n = Number(v); if (!isNaN(n) && n !== 0) premiumVsDvfPct = n; }
  }

  const rentRaw = dealId && rentByDeal?.[dealId]
    ? (rentByDeal[dealId] as Record<string, unknown>)
    : undefined;
  const rentInputs = (rentRaw?.inputs ?? null) as Record<string, unknown> | null;

  const apport =
    pickNum(d, "apport", "apportPersonnel", "downPayment") ??
    pickNum(rentInputs ?? {}, "apport", "apportPersonnel", "downPayment", "apportEur");

  const montantPret =
    pickNum(d, "montantPret", "loanAmount", "emprunt") ??
    pickNum(rentInputs ?? {}, "montantPretEur", "montantPret", "capitalEmprunte", "loanAmount", "emprunt") ??
    (capitalEngage && apport ? capitalEngage - apport : undefined);

  const mensualite =
    pickNum(d, "mensualite") ??
    pickNum(rentInputs ?? {}, "mensualite", "monthlyPayment");

  const loyerEstim =
    pickNum(d, "loyerEstim", "loyer", "loyerMensuel", "rentMonthly") ??
    pickNum(rentInputs ?? {}, "loyerEstime", "loyerMensuel", "loyer");

  const chargesMensuelles =
    pickNum(d, "chargesMensuelles", "chargesMonthly", "charges") ??
    pickNum(rentInputs ?? {}, "chargesMensuelles", "chargesEstimees", "charges");

  const loanRatePct =
    pickNum(rentInputs ?? {}, "tauxNominalAnnuelPct", "tauxAnnuel", "taux", "interestRatePct", "interestRate") ??
    pickNum(d, "tauxNominal", "loanRatePct", "ratePct", "tauxAnnuel", "loanRate", "taux");

  const loanInsurancePct =
    pickNum(rentInputs ?? {}, "tauxAssuranceAnnuelPct", "tauxAssurance", "assurancePct") ??
    pickNum(d, "tauxAssurance", "loanInsurancePct", "insurancePct", "assurancePct", "tauxAssuranceAnnuel");

  const fraisDossier  = pickNum(rentInputs ?? {}, "fraisDossierEur",  "fraisDossier")  ?? 0;
  const fraisGarantie = pickNum(rentInputs ?? {}, "fraisGarantieEur", "fraisGarantie") ?? 0;
  const fraisCourtier = pickNum(rentInputs ?? {}, "fraisCourtierEur", "fraisCourtier") ?? 0;
  const loanFraisInitiaux =
    fraisDossier + fraisGarantie + fraisCourtier > 0
      ? fraisDossier + fraisGarantie + fraisCourtier
      : pickNum(d, "fraisInitiaux", "fraisDossier", "fraisGarantie", "setupFees");

  return {
    dealId, prixAchat, travaux, travauxSource, fraisNotaire, fraisNotaireIsFallback,
    capitalEngage, prixRevente, margeBrute, margeBrutePct, apport, montantPret,
    mensualite, loyerEstim, chargesMensuelles, loanRatePct, loanInsurancePct,
    loanFraisInitiaux, stressReventeMinus5, premiumVsDvfPct,
    cushion: pickNum(d, "cushion"),
  };
}

export interface DealMetrics {
  titre: string; id: string; adresse: string; ville: string; cp: string; adresseComplete: string;
  prixAchat: number | undefined; surfaceM2: number | undefined; prixM2: number | undefined;
  prixRevente: number | undefined; travaux: number | undefined; fraisNotaire: number | undefined;
  capitalEngage: number | undefined; margeBrute: number | undefined; margeBrutePct: number | undefined;
  cushion: number | undefined; premiumVsDvfPct: number | undefined;
  stressReventeMinus5: number | undefined;
  apport: number | undefined; montantPret: number | undefined;
  mensualite: number | undefined; loyerEstim: number | undefined;
  chargesMensuelles: number | undefined; balcon: number | undefined;
  garage: boolean; ascenseur: boolean; cave: boolean;
  dpe: string; etage: string; vue: string; nbPieces: number | undefined;
  loanRatePct: number | undefined;
  loanInsurancePct: number | undefined;
  loanFraisInitiaux: number | undefined;
  _travauxSource: CanonicalFinancials["travauxSource"];
  _fraisNotaireIsFallback: boolean;
}

export function extractMetrics(snap: MarchandSnapshotV1, opts?: ExportPdfOpts): DealMetrics {
  const d  = resolveDeal(snap);
  const cf = resolveCanonicalFinancials(snap, opts);

  const titre = pickStr(d, "titre", "title", "nom", "name") || "Deal";
  const id    = pickStr(d, "id", "dealId", "reference");
  const adresse = pickStr(d, "adresse", "address");
  const ville   = pickStr(d, "ville", "city");
  const cp      = pickStr(d, "cp", "zipCode", "codePostal", "postalCode");

  let adresseComplete = adresse;
  if (!adresseComplete && (ville || cp))
    adresseComplete = [ville, cp].filter(Boolean).join(" ");

  const surfaceM2 = pickNum(d, "surfaceM2", "surface", "area");
  const prixM2    = cf.prixAchat && surfaceM2 ? Math.round(cf.prixAchat / surfaceM2) : undefined;

  const balcon    = pickNum(d, "balconyM2", "surfaceBalcon", "balconM2");
  const garage    = !!pick(d, "garage", "parking", "stationnement");
  const ascenseur = !!pick(d, "ascenseur", "elevator", "lift");
  const cave      = !!pick(d, "cave", "cellar");
  const dpe       = pickStr(d, "dpe", "classeDpe", "energyClass");
  const etage     = pickStr(d, "etage", "floor", "niveau");
  const vue       = pickStr(d, "vue", "view", "exposition");
  const nbPieces  = pickNum(d, "nbPieces", "rooms", "pieces", "nbRooms");

  return {
    titre, id, adresse, ville, cp,
    adresseComplete: adresseComplete || "",
    surfaceM2, prixM2, balcon, garage, ascenseur, cave, dpe, etage, vue, nbPieces,
    prixAchat:           cf.prixAchat,
    prixRevente:         cf.prixRevente,
    travaux:             cf.travaux,
    fraisNotaire:        cf.fraisNotaire,
    capitalEngage:       cf.capitalEngage,
    margeBrute:          cf.margeBrute,
    margeBrutePct:       cf.margeBrutePct,
    stressReventeMinus5: cf.stressReventeMinus5,
    premiumVsDvfPct:     cf.premiumVsDvfPct,
    cushion:             cf.cushion,
    apport:              cf.apport,
    montantPret:         cf.montantPret,
    mensualite:          cf.mensualite,
    loyerEstim:          cf.loyerEstim,
    chargesMensuelles:   cf.chargesMensuelles,
    loanRatePct:         cf.loanRatePct,
    loanInsurancePct:    cf.loanInsurancePct,
    loanFraisInitiaux:   cf.loanFraisInitiaux,
    _travauxSource:          cf.travauxSource,
    _fraisNotaireIsFallback: cf.fraisNotaireIsFallback,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ─── SMARTSCORE V2 ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

type PillarSource = "calc" | "server" | "narrative" | "estim" | "none";

export interface SmartScorePillar { value: number | null; source: PillarSource; }

export interface SmartScoreV2 {
  smartScore: number | null;
  pillars: {
    rentabilite: SmartScorePillar; robustesse: SmartScorePillar;
    liquidite: SmartScorePillar; opportunity: SmartScorePillar; pressionRisque: SmartScorePillar;
  };
  dataConfidence: number;
  dataConfidenceLabel: "Elevee" | "Moyenne" | "Faible";
  isEstimated: boolean;
}

function extractScoresFromNarrative(md: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!md) return out;
  const patterns: [string, string[]][] = [
    ["SmartScore",          ["SmartScore", "Smart Score", "smartscore"]],
    ["Probabilite revente", ["Probabilite revente", "Probabilite de revente", "Liquidite", "LiquidityScore", "Liquidite score"]],
    ["RiskPressureIndex",   ["RiskPressureIndex", "Risk Pressure", "Pression risque", "PressionRisque", "Pression de risque"]],
    ["OpportunityScore",    ["OpportunityScore", "Opportunity Score", "Opportunity", "Opportunite", "Score opportunite"]],
    ["Rentabilite",         ["Rentabilite", "RentabiliteScore", "Rendement"]],
    ["Robustesse",          ["Robustesse", "RobustesseScore", "Robustness"]],
  ];
  for (const [key, aliases] of patterns) {
    for (const alias of aliases) {
      const re = new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s:=]+([0-9]+)", "i");
      const match = md.match(re);
      if (match) { out[key] = parseInt(match[1], 10); break; }
    }
  }
  return out;
}

function resolveRawScore(
  opts: ExportPdfOpts | undefined, narrativeParsed: Record<string, number>,
  computedScoresKey?: string, computedTopKey?: string, conclusionKey?: string,
  analysisKey?: string, narrativeKey?: string,
): { value: number | null; source: PillarSource } {
  const cs      = opts?.aiReport?.computed?.scores;
  const compTop = opts?.aiReport?.computed as Record<string, unknown> | undefined;
  const a       = opts?.aiReport?.analysis;
  const cc      = a?.conclusion;
  if (computedScoresKey && cs) {
    const v = (cs as Record<string, unknown>)[computedScoresKey];
    if (v != null && !isNaN(Number(v))) return { value: Math.round(Number(v)), source: "server" };
  }
  if (computedTopKey && compTop) {
    const v = compTop[computedTopKey];
    if (v != null && !isNaN(Number(v))) return { value: Math.round(Number(v)), source: "server" };
  }
  if (conclusionKey && cc) {
    const v = (cc as Record<string, unknown>)[conclusionKey];
    if (v != null && !isNaN(Number(v))) return { value: Math.round(Number(v)), source: "server" };
  }
  if (analysisKey && a) {
    const v = (a as Record<string, unknown>)[analysisKey];
    if (v != null && !isNaN(Number(v))) return { value: Math.round(Number(v)), source: "server" };
  }
  if (narrativeKey && narrativeParsed[narrativeKey] != null)
    return { value: narrativeParsed[narrativeKey], source: "narrative" };
  return { value: null, source: "none" };
}

export function computeSmartScoreV2(metrics: DealMetrics | undefined, opts?: ExportPdfOpts, narrativeMd?: string): SmartScoreV2 {
  const effectiveNarrative = narrativeMd ?? opts?.aiReport?.analysis?.narrativeMarkdown;
  const narrativeParsed    = extractScoresFromNarrative(effectiveNarrative);

  let rentabilite: SmartScorePillar;
  if (metrics?.margeBrutePct != null && metrics?.cushion != null) {
    let score = 50;
    if (metrics.margeBrutePct >= 20) score += 25; else if (metrics.margeBrutePct >= 15) score += 18;
    else if (metrics.margeBrutePct >= 10) score += 10; else if (metrics.margeBrutePct >= 5) score += 3; else score -= 10;
    if (metrics.cushion >= 5) score += 12; else if (metrics.cushion >= 3) score += 7;
    else if (metrics.cushion >= 0) score += 2; else score -= 8;
    rentabilite = { value: clamp(score), source: "calc" };
  } else if (metrics?.margeBrutePct != null) {
    let score = 50;
    if (metrics.margeBrutePct >= 20) score += 22; else if (metrics.margeBrutePct >= 15) score += 15;
    else if (metrics.margeBrutePct >= 10) score += 8; else if (metrics.margeBrutePct >= 5) score += 2; else score -= 12;
    rentabilite = { value: clamp(score), source: "calc" };
  } else {
    const raw = resolveRawScore(opts, narrativeParsed, undefined, undefined, undefined, undefined, "Rentabilite");
    rentabilite = raw.value != null ? { value: raw.value, source: raw.source } : { value: null, source: "none" };
  }

  let robustesse: SmartScorePillar;
  const hasRobustnessInputs = metrics?.premiumVsDvfPct != null || metrics?.stressReventeMinus5 != null;
  if (hasRobustnessInputs) {
    let score = 55;
    if (metrics?.premiumVsDvfPct != null) {
      if (metrics.premiumVsDvfPct <= -10) score += 15; else if (metrics.premiumVsDvfPct <= -3) score += 8;
      else if (metrics.premiumVsDvfPct <= 3) score += 0; else score -= 10;
    }
    const missingCount = countMissing(metrics);
    if (missingCount >= 4) score -= 15; else if (missingCount >= 2) score -= 8;
    if (metrics?.stressReventeMinus5 != null) { if (metrics.stressReventeMinus5 > 0) score += 8; else score -= 10; }
    robustesse = { value: clamp(score), source: "calc" };
  } else {
    const raw = resolveRawScore(opts, narrativeParsed, undefined, undefined, undefined, undefined, "Robustesse");
    robustesse = raw.value != null ? { value: raw.value, source: raw.source } : { value: null, source: "none" };
  }

  const rawLiq  = resolveRawScore(opts, narrativeParsed, "liquidityScore", undefined, "liquidityScore", "liquidite", "Probabilite revente");
  const liquidite: SmartScorePillar = rawLiq.value != null ? { value: rawLiq.value, source: rawLiq.source } : { value: 50, source: "estim" };

  const rawOpp  = resolveRawScore(opts, narrativeParsed, "opportunityScore", undefined, "opportunityScore", "opportunity", "OpportunityScore");
  let opportunity: SmartScorePillar;
  if (rawOpp.value != null) { opportunity = { value: rawOpp.value, source: rawOpp.source }; }
  else {
    let est = 50;
    if (metrics?.premiumVsDvfPct != null && metrics.premiumVsDvfPct < 0) est += 8;
    if (metrics?.margeBrutePct   != null && metrics.margeBrutePct   > 20) est += 8;
    opportunity = { value: clamp(est), source: "estim" };
  }

  const rawRisk = resolveRawScore(opts, narrativeParsed, "riskPressureScore", undefined, "riskPressureScore", "pressionRisque", "RiskPressureIndex");
  let pressionRisque: SmartScorePillar;
  if (rawRisk.value != null) { pressionRisque = { value: rawRisk.value, source: rawRisk.source }; }
  else {
    let est = 55;
    if (metrics?.travaux == null) est += 8;
    if (metrics?.margeBrutePct != null && metrics.margeBrutePct < 10) est += 6;
    if (metrics?.prixRevente   == null) est += 5;
    pressionRisque = { value: clamp(est), source: "estim" };
  }

  const pillarWeights = [
    { pillar: rentabilite, weight: 30 }, { pillar: robustesse, weight: 25 },
    { pillar: liquidite,   weight: 20 }, { pillar: opportunity, weight: 25 },
  ];
  let totalWeight = 0; let weightedSum = 0; let hasEstim = false; let hasCalcOrServer = false;
  for (const pw of pillarWeights) {
    if (pw.pillar.value != null) {
      totalWeight  += pw.weight; weightedSum += pw.pillar.value * pw.weight;
      if (pw.pillar.source === "estim") hasEstim = true;
      if (pw.pillar.source === "calc" || pw.pillar.source === "server" || pw.pillar.source === "narrative") hasCalcOrServer = true;
    }
  }
  const smartScore  = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
  const isEstimated = hasEstim && !hasCalcOrServer;

  let dataConfidence = 0;
  const allPillars = [rentabilite, robustesse, liquidite, opportunity, pressionRisque];
  for (const p of allPillars) {
    if (p.source === "calc")           dataConfidence += 22;
    else if (p.source === "server")    dataConfidence += 20;
    else if (p.source === "narrative") dataConfidence += 16;
    else if (p.source === "estim")     dataConfidence += 6;
  }
  if (metrics?.travaux        != null) dataConfidence += 4;
  if (metrics?.prixRevente    != null) dataConfidence += 4;
  if (metrics?.premiumVsDvfPct != null) dataConfidence += 3;
  dataConfidence = Math.min(100, dataConfidence);

  let dataConfidenceLabel: SmartScoreV2["dataConfidenceLabel"];
  if (dataConfidence >= 70) dataConfidenceLabel = "Elevee";
  else if (dataConfidence >= 40) dataConfidenceLabel = "Moyenne";
  else dataConfidenceLabel = "Faible";

  return { smartScore, pillars: { rentabilite, robustesse, liquidite, opportunity, pressionRisque }, dataConfidence, dataConfidenceLabel, isEstimated };
}

function clamp(v: number, min = 10, max = 95): number { return Math.max(min, Math.min(max, v)); }

function countMissing(m: DealMetrics | undefined): number {
  if (!m) return 6;
  let c = 0;
  if (m.travaux  == null) c++; if (m.chargesMensuelles == null) c++; if (!m.dpe) c++;
  if (m.apport   == null) c++; if (m.prixRevente       == null) c++; if (!m.etage) c++;
  return c;
}

export interface ResolvedScores {
  smartScore: number | null; liquidite: number | null; pressionRisque: number | null;
  opportunity: number | null; confidence: number | null; usedFallback: boolean;
  source: "server" | "analysis" | "narrative" | "fallback" | "none";
}

export function resolveSmartScores(opts?: ExportPdfOpts, narrativeMd?: string, metrics?: DealMetrics): ResolvedScores {
  const v2      = computeSmartScoreV2(metrics, opts, narrativeMd);
  const sources = [v2.pillars.rentabilite.source, v2.pillars.robustesse.source, v2.pillars.liquidite.source, v2.pillars.opportunity.source];
  let source: ResolvedScores["source"] = "fallback";
  if (sources.includes("server"))         source = "server";
  else if (sources.includes("narrative")) source = "narrative";
  else if (sources.includes("calc"))      source = "analysis";
  else if (sources.every(s => s === "estim" || s === "none")) source = "fallback";
  let confidence: number | null = null;
  const cc = opts?.aiReport?.analysis?.conclusion;
  if (cc?.confidence != null) { const cv = Number(cc.confidence); if (!isNaN(cv)) confidence = Math.round(cv <= 1 ? cv * 100 : cv); }
  return {
    smartScore:     v2.smartScore,
    liquidite:      v2.pillars.liquidite.value,
    pressionRisque: v2.pillars.pressionRisque.value,
    opportunity:    v2.pillars.opportunity.value,
    confidence,
    usedFallback: v2.isEstimated || sources.some(s => s === "estim"),
    source,
  };
}

function fmtScore(v: number | null, fb = false): string { if (v == null) return "ND"; return fb ? `${v} (estim.)` : String(v); }
export function pillarSourceLabel(s: PillarSource): string {
  const map: Record<PillarSource, string> = { calc: "calcule", server: "IA", narrative: "narratif", estim: "estime", none: "" };
  return map[s] ?? "";
}

// ═══════════════════════════════════════════════════════════════════
// ─── NARRATIVE AUTO-GEN ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function nResume(m: DealMetrics, v: string, conf: string): string {
  const loc  = m.adresseComplete || m.ville || "localisation non precisee";
  const surf = m.surfaceM2 ? `${fmtNumber(m.surfaceM2)} m2` : "surface non communiquee";
  const px   = m.prixAchat ? fmtCurrency(m.prixAchat) : "prix non communique";
  const vFr  = v !== "ND" ? decisionLabel(v).toLowerCase() : "en attente d'analyse";
  const cBit = conf !== "ND" ? `, avec un indice de confiance de ${conf}` : "";
  return `Ce bien situe a ${loc}, d'une superficie de ${surf}, est propose a ${px}. L'analyse conduit au verdict : ${vFr}${cBit}.`;
}

function nValeur(ai: NormalizedAi, m: DealMetrics): string {
  const p: string[] = [];
  const items = ai.upside.length > 0 ? ai.upside : ai.whyBuy;
  if (items.length > 0) { p.push("Plusieurs facteurs contribuent a la creation de valeur sur cette operation."); for (const u of items) p.push(u + "."); }
  if (m.margeBrute != null && m.margeBrutePct != null)
    p.push(`La marge brute estimee est ${m.margeBrute >= 0 ? "positive" : "negative"}, a ${fmtCurrency(m.margeBrute)} soit ${m.margeBrutePct.toFixed(1)} % du capital engage.`);
  if (m.premiumVsDvfPct != null)
    p.push(`Le prix d'achat est ${m.premiumVsDvfPct <= 0 ? "inferieur" : "superieur"} de ${Math.abs(m.premiumVsDvfPct).toFixed(1)} % aux references DVF du secteur${m.premiumVsDvfPct <= 0 ? ", ce qui constitue un avantage" : ", appelant a la vigilance"}.`);
  if (m.surfaceM2 && m.prixM2)
    p.push(`A ${fmtCurrency(m.prixM2)} / m2 pour ${fmtNumber(m.surfaceM2)} m2, le positionnement prix est ${m.prixM2 < 4000 ? "competitif" : "intermediaire a eleve"} pour ce type de bien.`);
  if (p.length === 0) p.push("Les elements de creation de valeur n'ont pas pu etre determines. A valider : prix du marche, potentiel travaux, demande locative.");
  return p.join(" ");
}

function nLimites(ai: NormalizedAi): string {
  const p: string[] = [];
  if (ai.downside.length > 0) { p.push("Certains facteurs limitent le potentiel ou augmentent le risque."); for (const d of ai.downside) p.push(d + "."); }
  if (ai.killSwitches.length > 0) { p.push("Points potentiellement bloquants identifies :"); for (const k of ai.killSwitches) p.push("- " + k + "."); }
  if (ai.missingData.length > 0) p.push(`${ai.missingData.length} donnee(s) manquante(s) : ${ai.missingData.join(", ")}.`);
  if (p.length === 0) p.push("Aucun facteur limitant majeur identifie. A confirmer : charges copro, DPE, etat structurel, devis travaux.");
  return p.join(" ");
}

function nFinancier(m: DealMetrics, ai: NormalizedAi): string {
  const p: string[] = [];
  if (m.capitalEngage != null) {
    const det: string[] = [];
    if (m.prixAchat)    det.push(`acquisition ${fmtCurrency(m.prixAchat)}`);
    if (m.travaux)      det.push(`travaux ${fmtCurrency(m.travaux)}`);
    if (m.fraisNotaire) det.push(`frais notaire ${fmtCurrency(m.fraisNotaire)}`);
    p.push(`Capital total engage : ${fmtCurrency(m.capitalEngage)}` + (det.length ? ` (${det.join(", ")})` : "") + ".");
  }
  if (m.prixRevente) p.push(`Objectif de revente : ${fmtCurrency(m.prixRevente)}.`);
  if (ai.gainPotentiel    !== "ND" && !ai.gainPotentiel.startsWith("ND"))    p.push(`Gain potentiel : ${ai.gainPotentiel}.`);
  if (ai.pertePotentielle !== "ND" && !ai.pertePotentielle.startsWith("ND")) p.push(`Perte scenario defavorable : ${ai.pertePotentielle}.`);
  if (ai.stressTestReadable) p.push(ai.stressTestReadable);
  if (m.prixRevente && m.capitalEngage) p.push(`Seuil de rentabilite (capital + 5 % securite) : ${fmtCurrency(Math.round(m.capitalEngage * 1.05))}.`);
  if (p.length === 0) p.push("Donnees financieres insuffisantes. A obtenir : prix confirme, devis travaux, prix de revente cible.");
  return p.join(" ");
}

function nProfil(ai: NormalizedAi, m: DealMetrics): string {
  const v = ai.verdict.toLowerCase();
  if (v.includes("buy") || v === "acheter") {
    let s = "Profil : marchand de biens visant une plus-value a court terme (6-18 mois).";
    if (m.travaux) s += " L'operation implique des travaux ; experience en renovation ou MOE recommandee.";
    if (m.capitalEngage && m.capitalEngage > 500000) s += " Ticket significatif, financement bancaire solide requis.";
    return s;
  }
  if (v === "hold" || v === "attendre" || v === "negocier") return "Operation sous conditions. Convient a un investisseur patient, capable d'attendre la confirmation de certains elements avant de s'engager.";
  if (v.includes("pass")) return "Le profil risque/rendement ne justifie pas un engagement standard. Reserve aux investisseurs avec forte tolerance au risque et connaissance du marche local.";
  return "Profil a determiner apres completion des donnees.";
}

function nConclusion(ai: NormalizedAi, _m: DealMetrics): string {
  const p: string[] = [];
  if (ai.verdict    !== "ND") p.push(`Verdict : "${decisionLabel(ai.verdict)}".`);
  if (ai.maxPrice   !== "ND") p.push(`Prix max recommande : ${ai.maxPrice}.`);
  if (ai.neverExceed !== "ND") p.push(`Ne pas depasser : ${ai.neverExceed}.`);
  if (ai.whatToDo.length > 0) p.push("Actions : " + ai.whatToDo.join(" ; ") + ".");
  if (ai.conditionsToBuy.length > 0) p.push(`${ai.conditionsToBuy.length} condition(s) prealable(s) a reunir.`);
  if (p.length === 0) p.push("Conclusion impossible sans donnees suffisantes. Completer le dossier puis relancer l'analyse.");
  const v = ai.verdict.toLowerCase();
  if (v.includes("strong_buy")) p.push("Recommandation : GO, negocier rapidement.");
  else if (v.includes("buy") || v === "acheter") p.push("Recommandation : GO avec negotiation ferme sur le prix.");
  else if (v === "hold" || v === "negocier") p.push("Recommandation : attendre clarification des points identifies.");
  return p.join(" ");
}

function autoUpside(m: DealMetrics, scores: ResolvedScores): string[] {
  const up: string[] = [];
  if (m.margeBrutePct   != null && m.margeBrutePct   > 10) up.push(`Marge brute attractive (${m.margeBrutePct.toFixed(1)} %)`);
  if (m.premiumVsDvfPct != null && m.premiumVsDvfPct <= -3) up.push(`Prix inferieur aux references DVF (${Math.abs(m.premiumVsDvfPct).toFixed(1)} % sous le marche)`);
  if (m.cushion != null && m.cushion >= 3) up.push(`Buffer confortable vs seuil (cushion ${fmtNumber(m.cushion)})`);
  if (m.balcon)    up.push(`Balcon / terrasse (${fmtNumber(m.balcon)} m2) - valorisation a la revente`);
  if (m.garage)    up.push("Garage / parking inclus");
  if (m.ascenseur) up.push("Immeuble avec ascenseur");
  if (m.cave)      up.push("Cave - espace de stockage supplementaire");
  if (m.vue)       up.push(`Vue ${sanitizeForPdf(m.vue)}`);
  if (m.surfaceM2 && m.surfaceM2 > 60) up.push(`Surface confortable (${fmtNumber(m.surfaceM2)} m2)`);
  if (m.prixRevente) up.push("Objectif de revente identifie");
  if (scores.opportunity != null && scores.opportunity >= 60) up.push(`Score opportunite favorable (${scores.opportunity}/100)`);
  if (up.length === 0 && m.prixAchat) up.push("Bien identifie, analyse en cours");
  return up.slice(0, 4);
}

function autoDownside(m: DealMetrics, scores: ResolvedScores): string[] {
  const dn: string[] = [];
  if (m.travaux    == null) dn.push("Travaux non chiffres - risque budgetaire");
  if (m.prixRevente == null) dn.push("Revente cible absente - marge non calculable");
  if (m.margeBrutePct != null && m.margeBrutePct < 5)   dn.push(`Marge brute faible (${m.margeBrutePct.toFixed(1)} %) - peu de marge de manoeuvre`);
  if (m.premiumVsDvfPct != null && m.premiumVsDvfPct > 5) dn.push(`Prix superieur au marche DVF (+${m.premiumVsDvfPct.toFixed(1)} %)`);
  if (scores.pressionRisque != null && scores.pressionRisque >= 65) dn.push(`Pression risque elevee (${scores.pressionRisque}/100)`);
  if (scores.liquidite      != null && scores.liquidite < 40)       dn.push(`Liquidite faible (${scores.liquidite}/100) - revente potentiellement longue`);
  if (m.chargesMensuelles == null) dn.push("Charges mensuelles non renseignees");
  if (m.dpe && /[fgFG]/.test(m.dpe)) dn.push(`DPE defavorable (${m.dpe.toUpperCase()}) - travaux energetiques probables`);
  if (dn.length === 0) dn.push("Donnees insuffisantes - risques a confirmer apres due diligence");
  return dn.slice(0, 4);
}

function autoMissingData(m: DealMetrics): string[] {
  const md: string[] = [];
  if (m.travaux           == null) md.push("Devis travaux");
  if (m.chargesMensuelles == null) md.push("Charges mensuelles copro");
  if (!m.dpe)                      md.push("Diagnostic DPE");
  if (m.apport            == null) md.push("Plan de financement (apport/pret)");
  if (m.prixRevente       == null) md.push("Objectif de revente");
  if (!m.etage)                    md.push("Etage / exposition");
  return md.slice(0, 6);
}

function autoKillSwitches(m: DealMetrics): string[] {
  const ks: string[] = [];
  if (m.travaux == null) ks.push("Refus ou absence de devis travaux fiable");
  if (m.dpe && /[fgFG]/.test(m.dpe)) ks.push("DPE defavorable - travaux energetiques obligatoires a venir");
  if (m.chargesMensuelles == null) ks.push("Charges copro elevees ou non communiquees");
  if (m.margeBrutePct != null && m.margeBrutePct < 3) ks.push("Marge insuffisante pour absorber les aleas");
  if (ks.length === 0) {
    ks.push("Refus de devis travaux par plusieurs artisans");
    ks.push("DPE F/G non anticipe dans le budget");
    ks.push("Charges copro superieures a 300 EUR/mois");
  }
  return ks.slice(0, 3);
}

export function normalizeAiReport(opts?: ExportPdfOpts, metrics?: DealMetrics): NormalizedAi {
  const a = opts?.aiReport?.analysis;
  const f = a?.finalSummary;
  const c = a?.conclusion;
  const scores = resolveSmartScores(opts, a?.narrativeMarkdown, metrics);
  const fb     = scores.usedFallback;
  const conf   = scores.confidence != null ? `${scores.confidence}%` : "ND";
  const verdict = sanitizeForPdf(c?.decision ?? "ND");

  const rawMax: number | undefined =
    numOrUndef(c?.maxEngagementPriceEur)
    ?? numOrUndef((f as Record<string, unknown> | undefined)?.maxEngagementPriceEur)
    ?? numOrUndef(f?.maxPrice);
  const rawNever: number | undefined =
    numOrUndef(c?.neverExceedPriceEur)
    ?? numOrUndef((f as Record<string, unknown> | undefined)?.neverExceedPriceEur)
    ?? numOrUndef(f?.neverExceedPrice);

  let maxPriceStr    = rawMax   != null ? fmtCurrency(rawMax)   : "ND";
  let maxPriceSource: "ia" | "fallback" | "none" = rawMax   != null ? "ia" : "none";
  let neverExceedStr = rawNever != null ? fmtCurrency(rawNever) : "ND";
  let neverExceedSource: "ia" | "fallback" | "none" = rawNever != null ? "ia" : "none";
  const m0 = metrics;
  let maxPriceWhy = ""; let neverExceedWhy = "";

  if (maxPriceSource === "ia") maxPriceWhy = "Base sur l'analyse IA (comparables, marge cible, risques identifies)";
  if (maxPriceStr === "ND" && m0?.prixAchat) {
    const prudent = (m0.cushion != null && m0.cushion < 5) || m0.travaux == null;
    maxPriceStr   = fmtCurrency(Math.round(m0.prixAchat * (prudent ? 0.97 : 0.99)));
    maxPriceSource = "fallback";
    maxPriceWhy   = prudent ? "Decote appliquee (-3%) : cushion faible ou travaux non chiffres" : "Proche du prix affiche (-1%) : donnees partielles, negociation recommandee";
  }
  if (neverExceedSource === "ia") neverExceedWhy = "Seuil IA au-dela duquel la marge devient insuffisante";
  if (neverExceedStr === "ND" && m0?.prixAchat) {
    neverExceedStr = fmtCurrency(m0.prixAchat); neverExceedSource = "fallback";
    neverExceedWhy = "Egal au prix affiche : sans donnees suffisantes, ne pas surpayer";
  }

  let gainStr: string;
  if (f?.gainPotentiel != null && f.gainPotentiel !== 0)       gainStr = fmtCurrency(f.gainPotentiel);
  else if (m0?.margeBrute != null && m0.margeBrute !== 0)      gainStr = fmtCurrency(m0.margeBrute) + " (calcule)";
  else if (m0?.prixRevente   == null)                          gainStr = "ND (revente cible manquante)";
  else if (m0?.capitalEngage == null)                          gainStr = "ND (capital engage non calculable)";
  else                                                         gainStr = "ND";

  let perteStr: string;
  if (f?.pertePotentielle != null && f.pertePotentielle !== 0) perteStr = fmtCurrency(f.pertePotentielle);
  else if (m0?.stressReventeMinus5 != null) {
    const loss = m0.stressReventeMinus5 < 0 ? Math.abs(m0.stressReventeMinus5) : 0;
    perteStr = loss > 0 ? fmtCurrency(loss) + " (stress -5%)" : "0 EUR (marge OK meme a -5%)";
  } else if (m0?.prixRevente   == null) perteStr = "ND (revente cible manquante)";
  else if (m0?.capitalEngage   == null) perteStr = "ND (capital engage non calculable)";
  else                                  perteStr = "ND";

  const ai: NormalizedAi = {
    verdict, confidence: conf,
    smartScore:        fmtScore(scores.smartScore,     fb),
    liquidityScore:    fmtScore(scores.liquidite,      fb),
    riskPressureScore: fmtScore(scores.pressionRisque, fb),
    opportunityScore:  fmtScore(scores.opportunity,    fb),
    whyBuy:        (f?.whyBuy        ?? []).slice(0, 5).map(sanitizeForPdf),
    whatToDo:      (f?.whatToDo      ?? f?.top3ActionsNow ?? []).slice(0, 5).map(sanitizeForPdf),
    killSwitches:  (f?.killSwitches  ?? []).slice(0, 4).map(sanitizeForPdf),
    upside:        (f?.upside        ?? []).slice(0, 5).map(sanitizeForPdf),
    downside:      (f?.downside      ?? []).slice(0, 5).map(sanitizeForPdf),
    missingData:   (f?.missingData   ?? f?.dataToGetBeforeSigning ?? []).slice(0, 8).map(sanitizeForPdf),
    conditionsToBuy: (f?.conditionsToBuy ?? []).slice(0, 5).map(sanitizeForPdf),
    maxPrice: maxPriceStr, neverExceed: neverExceedStr,
    maxPriceSource, neverExceedSource,
    maxPriceWhy: sanitizeForPdf(maxPriceWhy), neverExceedWhy: sanitizeForPdf(neverExceedWhy),
    messageToAgent: sanitizeForPdf(f?.messageToAgent ?? ""),
    stressTest: (f?.stressTest ?? []).slice(0, 4),
    gainPotentiel: gainStr, pertePotentielle: perteStr,
    stressTestReadable: sanitizeForPdf(f?.stressTestReadable ?? ""),
    checklist: (f?.checklist ?? []).slice(0, 12),
    dueDiligence:   a?.dueDiligence   ?? [],
    ficheOperation: a?.ficheOperation ?? [],
    narrativeSummary: sanitizeForPdf(a?.narrativeMarkdown ?? "").slice(0, 2000),
    resumeCourt: sanitizeForPdf(f?.resumeCourt ?? f?.decisionToday ?? ""),
    nrResume:    sanitizeForPdf(f?.narrativeResume    ?? ""),
    nrValeur:    sanitizeForPdf(f?.narrativeValeur    ?? ""),
    nrLimites:   sanitizeForPdf(f?.narrativeLimites   ?? ""),
    nrFinancier: sanitizeForPdf(f?.narrativeFinancier ?? ""),
    nrProfil:    sanitizeForPdf(f?.narrativeProfil    ?? ""),
    nrConclusion: sanitizeForPdf(f?.narrativeConclusion ?? ""),
  };

  const m: DealMetrics = metrics ?? {
    titre: "", id: "", adresse: "", ville: "", cp: "", adresseComplete: "",
    prixAchat: undefined, surfaceM2: undefined, prixM2: undefined, prixRevente: undefined,
    travaux: undefined, fraisNotaire: undefined, capitalEngage: undefined,
    margeBrute: undefined, margeBrutePct: undefined, cushion: undefined, premiumVsDvfPct: undefined,
    stressReventeMinus5: undefined, apport: undefined, montantPret: undefined,
    mensualite: undefined, loyerEstim: undefined, chargesMensuelles: undefined, balcon: undefined,
    garage: false, ascenseur: false, cave: false, dpe: "", etage: "", vue: "", nbPieces: undefined,
    loanRatePct: undefined, loanInsurancePct: undefined, loanFraisInitiaux: undefined,
    _travauxSource: "none", _fraisNotaireIsFallback: false,
  };

  if (ai.upside.length      === 0) ai.upside      = autoUpside(m, scores).map(sanitizeForPdf);
  if (ai.downside.length    === 0) ai.downside    = autoDownside(m, scores).map(sanitizeForPdf);
  if (ai.missingData.length === 0) ai.missingData = autoMissingData(m).map(sanitizeForPdf);
  if (ai.killSwitches.length === 0) ai.killSwitches = autoKillSwitches(m).map(sanitizeForPdf);
  if (!ai.nrResume)    ai.nrResume    = sanitizeForPdf(nResume(m, ai.verdict, ai.confidence));
  if (!ai.nrValeur)    ai.nrValeur    = sanitizeForPdf(nValeur(ai, m));
  if (!ai.nrLimites)   ai.nrLimites   = sanitizeForPdf(nLimites(ai));
  if (!ai.nrFinancier) ai.nrFinancier = sanitizeForPdf(nFinancier(m, ai));
  if (!ai.nrProfil)    ai.nrProfil    = sanitizeForPdf(nProfil(ai, m));
  if (!ai.nrConclusion) ai.nrConclusion = sanitizeForPdf(nConclusion(ai, m));
  return ai;
}

function numOrUndef(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return isNaN(n) || n === 0 ? undefined : n;
}

function dCur(v: number | undefined): string  { return v != null ? fmtCurrency(v) : "ND"; }
function dSurf(v: number | undefined): string { return v != null ? `${fmtNumber(v)} m2` : "ND"; }

function para(doc: jsPDF, text: string, y: number, o?: { fs?: number; style?: string; color?: readonly [number, number, number]; lh?: number }): number {
  const fs = o?.fs ?? 9; const lh = o?.lh ?? 4.4;
  doc.setFont("helvetica", (o?.style ?? "normal") as Parameters<typeof doc.setFont>[1]);
  doc.setFontSize(fs); sc(doc, o?.color ?? C.body);
  const ls: string[] = doc.splitTextToSize(sanitizeForPdf(text), CW - 4);
  for (const l of ls) { if (y > PH - M.bottom - 4) { doc.addPage(); y = M.top + 12; } doc.text(l, M.left + 2, y); y += lh; }
  return y;
}

function subTitle(doc: jsPDF, title: string, y: number): number {
  if (y > PH - M.bottom - 14) { doc.addPage(); y = M.top + 12; }
  sf(doc, C.accent); doc.roundedRect(M.left, y - 2.5, 1.8, 6, 0.9, 0.9, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); sc(doc, C.primary);
  doc.text(sanitizeForPdf(title), M.left + 5, y + 1);
  return y + 8;
}

// ═══════════════════════════════════════════════════════════════════
// ─── COVER — Shards diagonaux sky-blue (Investisseur v2) ───────────
// ═══════════════════════════════════════════════════════════════════
//
// Remplacement de l'ancien fond dégradé plat par 7 shards angulaires
// (parallélogrammes rectilignes) glissant depuis la droite — même
// esprit consulting/premium que les ribbons Promoteur, géométrie
// différente : angulaire vs fluide.
//
// Tout le contenu textuel (titre, verdict, SmartScore, KPIs, résumé,
// sommaire) est strictement identique à l'original.

function buildCover(doc: jsPDF, m: DealMetrics, ai: NormalizedAi, opts?: ExportPdfOpts): void {

  // ── 1. Fond blanc ─────────────────────────────────────────────
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PW, PH, "F");

  // ── 2. Shards diagonaux — palette sky-blue / cyan ─────────────
  // Coins dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche.
  // Shards 1-5 touchent le bord droit (PW).
  // Shards 6-7 : lames accent flottantes.
  const INV = {
    crystal: [227, 245, 254] as const, // sky-50
    ultra:   [179, 229, 252] as const, // sky-100
    pale:    [129, 212, 250] as const, // sky-200
    light:   [79,  195, 247] as const, // sky-300
    med:     [41,  182, 246] as const, // sky-400
    main:    [33,  150, 243] as const, // sky-500 (#2196f3)
    deep:    [14,  91,  167] as const, // sky-800
  };

  type ShardDef = {
    p0: [number,number]; p1: [number,number];
    p2: [number,number]; p3: [number,number];
    col: readonly [number,number,number];
  };

  const shards: ShardDef[] = [
    { p0:[42, 0],  p1:[PW,0], p2:[PW,PH], p3:[80, PH],  col: INV.crystal },
    { p0:[76, 0],  p1:[PW,0], p2:[PW,PH], p3:[107,PH],  col: INV.ultra   },
    { p0:[103,0],  p1:[PW,0], p2:[PW,PH], p3:[129,PH],  col: INV.pale    },
    { p0:[124,0],  p1:[PW,0], p2:[PW,PH], p3:[147,PH],  col: INV.light   },
    { p0:[143,0],  p1:[PW,0], p2:[PW,PH], p3:[163,PH],  col: INV.med     },
    { p0:[158,0],  p1:[173,0], p2:[200,PH], p3:[185,PH], col: INV.main   },
    { p0:[166,0],  p1:[175,0], p2:[202,PH], p3:[193,PH], col: INV.deep   },
  ];

  for (const sh of shards) {
    doc.setFillColor(sh.col[0], sh.col[1], sh.col[2]);
    doc.setDrawColor(sh.col[0], sh.col[1], sh.col[2]);
    doc.setLineWidth(0.1);
    doc.lines(
      [
        [sh.p1[0] - sh.p0[0], sh.p1[1] - sh.p0[1]],
        [sh.p2[0] - sh.p1[0], sh.p2[1] - sh.p1[1]],
        [sh.p3[0] - sh.p2[0], sh.p3[1] - sh.p2[1]],
      ],
      sh.p0[0], sh.p0[1], [1, 1], "FD", true,
    );
  }

  // ── 3. Contenu textuel — identique à l'original ───────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(26); sc(doc, C.primary);
  doc.text("MIMMOZA", M.left, 26);
  sf(doc, C.accent); doc.rect(M.left, 29, 28, 0.7, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.muted);
  doc.text("Intelligence Immobiliere", M.left, 35.5);

  const badgeTxt = "DOSSIER INVESTISSEUR";
  const bW = doc.getTextWidth(badgeTxt) + 14;
  roundedBox(doc, PW - M.right - bW, 18, bW, 9, { fill: C.white as const, border: C.accent, radius: 4.5, lw: 0.4 });
  doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); sc(doc, C.accent);
  doc.text(badgeTxt, PW - M.right - bW / 2, 23.7, { align: "center" });

  const cx = M.left; const cy = 44; const cw = PW - M.left - M.right; const ch = 38;
  roundedBox(doc, cx, cy, cw, ch, { fill: C.white as const, border: [196, 221, 253] as const, radius: 3, lw: 0.4 });
  sf(doc, C.accent); doc.roundedRect(cx, cy, 3.5, ch, 1.5, 1.5, "F");

  let iy = cy + 11;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); sc(doc, C.primary);
  const tl = doc.splitTextToSize(sanitizeForPdf(m.titre), cw - 18);
  doc.text(tl, cx + 10, iy); iy += tl.length * 6;

  if (m.id) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, C.muted);
    doc.text(sanitizeForPdf(`Ref. : ${m.id}`), cx + 10, iy); iy += 5;
  }
  if (m.adresseComplete) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.mutedDark);
    const addrL = doc.splitTextToSize(sanitizeForPdf(m.adresseComplete), cw - 18) as string[];
    doc.text(addrL[0] ?? "", cx + 10, iy);
  }

  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, C.muted);
  doc.text(sanitizeForPdf(dateStr), M.left, 100);
  const confStr = "CONFIDENTIEL";
  const confW = doc.getTextWidth(confStr) + 10;
  roundedBox(doc, PW - M.right - confW, 94, confW, 8, { fill: C.white as const, border: C.borderDark, radius: 4 });
  doc.setFont("helvetica", "bold"); doc.setFontSize(6); sc(doc, C.muted);
  doc.text(confStr, PW - M.right - confW / 2, 99.2, { align: "center" });

  let vy = 117;

  if (ai.verdict !== "ND") {
    const bH = 20;
    roundedBox(doc, M.left, vy, CW, bH, { fill: C.accentSoft, border: C.accent, radius: 3, lw: 0.4 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); sc(doc, C.muted);
    doc.text("VERDICT STRATEGIQUE", M.left + CW / 2, vy + 6, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); sc(doc, C.accent);
    doc.text(sanitizeForPdf(decisionLabel(ai.verdict)), M.left + CW / 2, vy + 14, { align: "center" });
    if (ai.confidence !== "ND") {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, C.muted);
      doc.text(sanitizeForPdf(`Confiance : ${ai.confidence}`), M.left + CW - 4, vy + 17.5, { align: "right" });
    }
    vy += bH + 8;
  }

  const coverScores = resolveSmartScores(opts, opts?.aiReport?.analysis?.narrativeMarkdown, m);
  if (coverScores.smartScore != null) {
    roundedBox(doc, M.left, vy, CW, 13, { fill: C.white, border: C.border, radius: 3, lw: 0.2 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, C.muted);
    doc.text("SmartScore", M.left + 5, vy + 5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); sc(doc, C.accent);
    doc.text(String(coverScores.smartScore), M.left + 34, vy + 9.5, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, C.muted);
    doc.text("/100", M.left + 35, vy + 9.5);
    const bx = M.left + 54; const bw2 = CW - 59;
    roundedBox(doc, bx, vy + 5, bw2, 3, { fill: C.bgAlt, radius: 1.5 });
    const fw = Math.max(3, (coverScores.smartScore / 100) * bw2);
    const INDIGO: readonly [number,number,number] = [79, 70, 229];
    const CYAN:   readonly [number,number,number] = [6, 182, 212];
    ribbon(doc, vy + 5, 3, INDIGO, CYAN, Math.max(4, Math.round(fw * 2)), bx, fw);
    vy += 19;
  }

  const kpiData = [
    { label: "Prix d'achat", value: dCur(m.prixAchat) },
    { label: "Surface",      value: dSurf(m.surfaceM2) },
    { label: "Prix / m2",    value: dCur(m.prixM2) },
  ];
  const kw = CW / 3;
  kpiData.forEach((k, i) => {
    const kx = M.left + i * kw;
    roundedBox(doc, kx + 1, vy, kw - 2, 15, { fill: C.white, border: C.border, radius: 3, lw: 0.2, shadow: true });
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); sc(doc, k.value.startsWith("ND") ? C.muted : C.accent);
    doc.text(sanitizeForPdf(k.value), kx + kw / 2, vy + 7.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
    doc.text(k.label, kx + kw / 2, vy + 12, { align: "center" });
  });
  vy += 21;

  const FALLBACK_COVER = "Analyse automatisee basee sur les donnees DVF, les indicateurs de marche et les hypotheses financieres du projet.";
  const BAD_PHRASES    = ["information non fournie", "non fourni", "non disponible", "aucune information"];
  const rtRaw   = ai.resumeCourt || ai.nrResume || "";
  const rtIsBad = BAD_PHRASES.some(p => rtRaw.toLowerCase().includes(p));
  const rt = (!rtRaw || rtIsBad)
    ? (ai.whyBuy.length > 0 ? ai.whyBuy[0] : FALLBACK_COVER)
    : rtRaw;
  if (rt) {
    const rtTrunc = rt.length > 240 ? rt.slice(0, 237) + "..." : rt;
    const rtLines = doc.splitTextToSize(sanitizeForPdf(`"${rtTrunc}"`), CW - 12) as string[];
    const rtH     = rtLines.length * 4.2 + 10;
    if (vy + rtH < PH - 28) {
      roundedBox(doc, M.left, vy, CW, rtH, { fill: C.accentSoft, border: [196, 221, 253] as const, radius: 3 });
      sf(doc, C.accent); doc.roundedRect(M.left, vy, 3, rtH, 1.5, 1.5, "F");
      doc.setFont("helvetica", "italic"); doc.setFontSize(8); sc(doc, C.body);
      doc.text(rtLines, M.left + 8, vy + 6);
      vy += rtH + 6;
    }
  }

  const toc = [
    "1 — Commune & contexte local",
    "2 — Synthese strategique",
    "3 — Decision en 30 secondes",
    "4 — Risques & Conditions",
    "5 — Stress test & Capital",
    "6 — Plan d'action",
  ];
  if (vy + toc.length * 5 + 14 < PH - 14) {
    roundedBox(doc, M.left, vy, CW, toc.length * 5 + 12, { fill: C.white, border: C.border, radius: 3, lw: 0.2 });
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); sc(doc, C.muted);
    doc.text("SOMMAIRE", M.left + 4, vy + 5.5);
    toc.forEach((item, idx) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); sc(doc, C.mutedDark);
      doc.text(sanitizeForPdf(item), M.left + 4, vy + 10 + idx * 5);
    });
  }

  ribbon(doc, PH - 6, 6, [238, 242, 255] as const, [240, 249, 255] as const, 60, 0, PW);
  doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
  doc.text("Genere par MIMMOZA — Intelligence immobiliere", PW / 2, PH - 1.5, { align: "center" });
}

// ═══════════════════════════════════════════════════════════════════
// ─── WIKIMEDIA HELPERS — V2 ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepFindKey(
  root: unknown, key: string, maxDepth = 6,
  seen = new Set<Record<string, unknown>>(),
): Record<string, unknown> | null {
  if (!isPlainObject(root) || maxDepth < 0) return null;
  if (seen.has(root)) return null;
  seen.add(root);
  const direct = root[key];
  if (isPlainObject(direct)) return direct;
  for (const value of Object.values(root)) {
    if (isPlainObject(value)) {
      const found = deepFindKey(value, key, maxDepth - 1, seen);
      if (found) return found;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepFindKey(item, key, maxDepth - 1, seen);
        if (found) return found;
      }
    }
  }
  return null;
}

function getWikimediaBlock(opts?: ExportPdfOpts): Record<string, unknown> | null {
  if (!opts) return null;
  const WIKI_KEYS = new Set(["place", "wikipedia", "narrative", "wikidata", "facts", "extract"]);
  const looksLikeWikiBlock = (o: unknown): o is Record<string, unknown> => {
    if (!isPlainObject(o)) return false;
    return Object.keys(o).some(k => WIKI_KEYS.has(k));
  };
  const ar       = opts.aiReport as unknown as Record<string, unknown> | undefined;
  const computed = ar?.computed as Record<string, unknown> | undefined;
  const ctx      = opts.context as Record<string, unknown> | undefined;
  const analysis = ar?.analysis as Record<string, unknown> | undefined;
  if (isPlainObject(computed?.wikimedia)) return computed!.wikimedia as Record<string, unknown>;
  if (isPlainObject(ctx?.wikimedia)) return ctx!.wikimedia as Record<string, unknown>;
  if (isPlainObject(analysis?.wikimedia)) return analysis!.wikimedia as Record<string, unknown>;
  if (looksLikeWikiBlock(ctx)) return ctx;
  const deep1 = deepFindKey(opts.aiReport, "wikimedia", 7);
  if (deep1) return deep1;
  const deep2 = deepFindKey(opts.context, "wikimedia", 7);
  if (deep2) return deep2;
  if (isPlainObject(ctx)) {
    const hasWpExtract =
      isPlainObject((ctx as Record<string, unknown>).wikipedia) &&
      typeof ((ctx as Record<string, unknown>).wikipedia as Record<string, unknown>).extract === "string";
    const hasNarrative =
      typeof (ctx as Record<string, unknown>).narrative === "string" &&
      ((ctx as Record<string, unknown>).narrative as string).trim().length > 20;
    if (hasWpExtract || hasNarrative) return ctx;
  }
  return null;
}

function resolvePlaceBlock(wiki: Record<string, unknown> | null): Record<string, unknown> | null {
  if (wiki == null) return null;
  const place = wiki.place;
  return (isPlainObject(place) ? place : wiki) as Record<string, unknown>;
}

function extractNarrativeString(field: unknown): string {
  if (typeof field === "string") return field.trim();
  if (!isPlainObject(field)) return "";
  const obj = field as Record<string, unknown>;
  for (const k of ["text", "content", "full", "summary", "value", "description", "body", "extract"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 20) return v.trim();
  }
  for (const k of ["sentences", "paragraphs", "parts", "items", "lines"]) {
    const arr = obj[k];
    if (Array.isArray(arr) && arr.length > 0) {
      const joined = (arr as unknown[])
        .map(s => {
          if (typeof s === "string") return s;
          if (isPlainObject(s)) {
            for (const sk of ["text", "content", "value", "sentence"]) {
              if (typeof (s as Record<string, unknown>)[sk] === "string") return (s as Record<string, unknown>)[sk] as string;
            }
            return Object.values(s as Record<string, unknown>).filter(v => typeof v === "string").join(" ");
          }
          return "";
        })
        .filter(s => s.trim().length > 0)
        .join(" ")
        .trim();
      if (joined.length > 20) return joined;
    }
  }
  const candidateKeys = Object.keys(obj).filter(k => !["length", "quality", "sources", "qid", "source", "title"].includes(k));
  const longStrings = candidateKeys
    .map(k => obj[k])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 20);
  if (longStrings.length > 0) return longStrings.join(" ").trim();
  return Object.values(obj).filter((v): v is string => typeof v === "string" && Boolean(v.trim())).join(" ").trim();
}

function resolveWikimediaRichText(
  place: Record<string, unknown> | null,
  wiki: Record<string, unknown> | null,
): string {
  const placeContext =
    isPlainObject(place?.context) ? (place?.context as Record<string, unknown>) : null;
  const wikiContext =
    wiki && place !== wiki && isPlainObject(wiki?.context)
      ? (wiki?.context as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    placeContext?.long, placeContext?.short, place?.narrative,
    wikiContext?.long, wikiContext?.short, wiki?.narrative,
    isPlainObject(place?.wikipedia) ? (place?.wikipedia as Record<string, unknown>).extract : null,
    wiki && place !== wiki && isPlainObject(wiki?.wikipedia) ? (wiki?.wikipedia as Record<string, unknown>).extract : null,
    place?.extract, wiki?.extract,
  ];
  for (const candidate of candidates) {
    const text = extractNarrativeString(candidate);
    if (text && text.trim().length > 30) return text.trim();
  }
  return "";
}

function extractCommuneName(
  place: Record<string, unknown> | null,
  fallbackCity?: string, fallbackCp?: string,
  wiki?: Record<string, unknown> | null,
): string {
  const isValidName = (raw: unknown): raw is string => {
    if (typeof raw !== "string") return false;
    const clean = sanitizeForPdf(raw).trim();
    if (clean.length < 2) return false;
    if (/^Q\d+$/.test(clean)) return false;
    if (/^-+$/.test(clean)) return false;
    if (/^\d{3,5}$/.test(clean)) return false;
    if (/^[A-Z]{2,3}$/.test(clean)) return false;
    return true;
  };
  const queryData = place?.query as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    queryData?.city, queryData?.commune, queryData?.name, queryData?.label,
    place?.title, place?.label, place?.name,
    wiki?.title, wiki?.label, wiki?.name,
    fallbackCity,
  ];
  for (const raw of candidates) {
    if (isValidName(raw)) return sanitizeForPdf(raw as string).trim();
  }
  if (fallbackCp) return sanitizeForPdf(fallbackCp);
  return "";
}

function extractFactSentences(facts: unknown): string[] {
  if (Array.isArray(facts))
    return (facts as unknown[]).map(f => {
      if (typeof f === "string") return sanitizeForPdf(f);
      if (typeof f === "object" && f !== null)
        return Object.values(f as Record<string, unknown>).map(v => sanitizeForPdf(v)).filter(Boolean).join(" ");
      return "";
    }).filter(Boolean);
  if (typeof facts === "object" && facts !== null)
    return Object.values(facts as Record<string, unknown>).map(v => sanitizeForPdf(v)).filter(Boolean);
  if (typeof facts === "string") return [sanitizeForPdf(facts)];
  return [];
}

function buildFactItems(facts: unknown): string[] {
  if (facts == null) return [];
  let items: string[] = [];
  if (Array.isArray(facts)) {
    items = (facts as unknown[]).slice(0, 7).map(f => {
      if (typeof f === "string") return sanitizeForPdf(f);
      if (typeof f === "object" && f !== null) {
        const entries = Object.entries(f as Record<string, unknown>);
        if (entries.length > 0) return `${sanitizeForPdf(entries[0][0])} : ${sanitizeForPdf(entries[0][1])}`;
      }
      return "";
    });
  } else if (typeof facts === "object" && facts !== null) {
    items = Object.entries(facts as Record<string, unknown>).slice(0, 7)
      .map(([k, v]) => `${sanitizeForPdf(k)} : ${sanitizeForPdf(v)}`);
  } else if (typeof facts === "string") {
    items = [sanitizeForPdf(facts)];
  }
  return items.filter(s => s.length > 3).slice(0, 7);
}

// ═══════════════════════════════════════════════════════════════════
// ─── COMMUNE PAGE ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildCommunePage(doc: jsPDF, opts?: ExportPdfOpts, metrics?: DealMetrics): void {
  const wiki  = getWikimediaBlock(opts);
  const place    = resolvePlaceBlock(wiki);
  const placeAny = place as Record<string, unknown> | null;

  const communeName = extractCommuneName(placeAny, metrics?.ville, metrics?.cp, wiki);
  let narrative = resolveWikimediaRichText(placeAny, wiki);

  const wpPlace    = placeAny?.wikipedia as Record<string, unknown> | undefined;
  const wpWikiRoot = (wiki && placeAny !== wiki) ? wiki.wikipedia as Record<string, unknown> | undefined : undefined;
  const rawExtract =
    typeof wpPlace?.extract === "string"    ? wpPlace.extract.trim() :
    typeof wpWikiRoot?.extract === "string" ? wpWikiRoot.extract.trim() : "";

  const wdPlace    = placeAny?.wikidata as Record<string, unknown> | undefined;
  const wdWikiRoot = (wiki && placeAny !== wiki) ? wiki.wikidata as Record<string, unknown> | undefined : undefined;
  const rawFacts =
    wdPlace?.facts ?? placeAny?.facts ?? wdWikiRoot?.facts ?? wiki?.facts ?? null;

  let profileText = "";
  const profileSrc =
    (isPlainObject(placeAny?.profile) ? placeAny!.profile :
     (wiki && placeAny !== wiki && isPlainObject(wiki.profile) ? wiki.profile : null)) as Record<string, unknown> | null;
  if (profileSrc) {
    profileText = Object.values(profileSrc)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 10)
      .join(" ").trim();
  }

  const hasContent = wiki !== null || placeAny !== null;
  const hasText    = narrative.length > 30 || profileText.length > 30;

  doc.addPage();
  let y = M.top + 8;

  const pageTitle = communeName ? `Commune & contexte local — ${communeName}` : "Commune & contexte local";
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text(sanitizeForPdf(pageTitle), M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 9;

  if (!hasContent) {
    roundedBox(doc, M.left, y, CW, 28, { fill: C.bg, border: C.borderDark, radius: 3 });
    sf(doc, C.muted); doc.roundedRect(M.left, y, 3, 28, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); sc(doc, C.mutedDark);
    doc.text("Contexte local non disponible", M.left + CW / 2, y + 12, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.muted);
    doc.text("Le bloc Wikimedia n'a pas ete transmis dans les donnees.", M.left + CW / 2, y + 20, { align: "center" });
    setY(doc, y + 34);
    return;
  }

  if (!hasText && rawFacts == null && !profileText) {
    roundedBox(doc, M.left, y, CW, 28, { fill: C.bg, border: C.borderDark, radius: 3 });
    sf(doc, C.warning); doc.roundedRect(M.left, y, 3, 28, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); sc(doc, C.mutedDark);
    const msg = communeName ? `${communeName} — Contenu Wikimedia non recupere` : "Commune — Contenu Wikimedia non recupere";
    doc.text(sanitizeForPdf(msg), M.left + CW / 2, y + 11, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.muted);
    doc.text("Verifier la commune et le code postal renseignes dans le dossier.", M.left + CW / 2, y + 19, { align: "center" });
    setY(doc, y + 34);
    return;
  }

  y = sectionTitle(doc, "Commune & contexte local", y);

  const placeCtx = isPlainObject(placeAny?.context) ? (placeAny!.context as Record<string, unknown>) : null;
  const contextLong  = typeof placeCtx?.long  === "string" && placeCtx.long.trim().length  > 30 ? placeCtx.long.trim()  : "";
  const contextShort = typeof placeCtx?.short === "string" && placeCtx.short.trim().length > 30 ? placeCtx.short.trim() : "";
  const placeNarrative = typeof placeAny?.narrative === "string" && (placeAny.narrative as string).trim().length > 30
    ? (placeAny.narrative as string).trim() : "";

  let presentationRaw: string;
  if (contextLong)       presentationRaw = contextLong;
  else if (contextShort) presentationRaw = contextShort;
  else if (placeNarrative) presentationRaw = placeNarrative;
  else if (profileText)  presentationRaw = profileText;
  else                   presentationRaw = "";

  if (rawFacts != null) {
    const factsArr = extractFactSentences(rawFacts);
    const isShort  = presentationRaw.length < 200;
    const keep     = isShort
      ? factsArr.filter(Boolean)
      : factsArr.filter(s => /^(Commune|Departement|Region|Population|Superficie)\s*:/.test(s));
    const extra = keep.slice(0, isShort ? 8 : 4);
    if (extra.length > 0) {
      const suffix = extra.join(". ") + ".";
      presentationRaw = presentationRaw ? `${presentationRaw.replace(/\.*\s*$/, ".")} ${suffix}` : suffix;
    }
  }
  if (presentationRaw.length > 900) presentationRaw = presentationRaw.slice(0, 897) + "...";

  if (presentationRaw.trim()) {
    const paragraphs = presentationRaw
      .split(/\n{2,}|\n/)
      .map(p => sanitizeForPdf(p)).map(p => p.trim()).filter(p => p.length > 0);
    const lineH = 4.6;
    const renderedParagraphs = paragraphs.map((p) => doc.splitTextToSize(p, CW - 14) as string[]);
    const paraGap = 3.2;
    const blockH =
      renderedParagraphs.reduce((acc, lines) => acc + lines.length * lineH, 0) +
      Math.max(0, renderedParagraphs.length - 1) * paraGap + 12;
    if (y + blockH > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
    roundedBox(doc, M.left, y, CW, blockH, { fill: C.bg, border: C.border, radius: 3, lw: 0.2 });
    sf(doc, C.accent); doc.roundedRect(M.left, y, 3, blockH, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.8); sc(doc, C.body);
    let ty = y + 8;
    for (const lines of renderedParagraphs) { doc.text(lines, M.left + 8, ty); ty += lines.length * lineH + paraGap; }
    y += blockH + 8;
  }

  const factItems = buildFactItems(rawFacts);
  if (factItems.length > 0) {
    if (y + 20 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
    y = sectionTitle(doc, "Faits cles", y);
    const factLineH = 4.4;
    let factsBlockH = 10;
    const renderedFacts: { lines: string[]; h: number }[] = factItems.map(fact => {
      const ls = doc.splitTextToSize(sanitizeForPdf(fact), CW - 16) as string[];
      const h  = ls.length * factLineH + 2.5;
      factsBlockH += h;
      return { lines: ls, h };
    });
    factsBlockH += 4;
    if (y + factsBlockH > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
    roundedBox(doc, M.left, y, CW, factsBlockH, { fill: C.accentSoft, border: [196, 221, 253] as const, radius: 3, lw: 0.2 });
    let fy = y + 8;
    for (const { lines, h } of renderedFacts) {
      sf(doc, C.accent); doc.circle(M.left + 6, fy - 1.4, 0.8, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.body);
      doc.text(lines, M.left + 11, fy);
      fy += h;
    }
    y += factsBlockH + 8;
  }

  if (y + 20 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
  y = sectionTitle(doc, "Implications immobilieres", y, { color: C.accentDark });
  const implications = [
    "L'accessibilite aux transports, commerces et services publics peut soutenir l'attractivite locative et faciliter la revente.",
    "Le dynamisme economique et demographique local influence directement la demande de logements et le niveau des loyers.",
    "La presence d'ecoles, d'etablissements de sante et de commerces de proximite constitue un critere de valorisation durable.",
    "Les specificites urbaines et patrimoniales de la commune peuvent impacter les regles PLU applicables au bien.",
  ];
  const implLineH = 4.5;
  let implBlockH = 10;
  const renderedImpl: { lines: string[]; h: number }[] = implications.map(impl => {
    const ls = doc.splitTextToSize(sanitizeForPdf(impl), CW - 16) as string[];
    const h  = ls.length * implLineH + 3;
    implBlockH += h;
    return { lines: ls, h };
  });
  implBlockH += 4;
  if (y + implBlockH > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
  roundedBox(doc, M.left, y, CW, implBlockH, { fill: C.white, border: C.border, radius: 3, lw: 0.2, shadow: true });
  let iy2 = y + 8;
  for (const { lines, h } of renderedImpl) {
    sf(doc, C.accent); doc.circle(M.left + 6, iy2 - 1.4, 0.8, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.body);
    doc.text(lines, M.left + 11, iy2);
    iy2 += h;
  }
  y += implBlockH + 5;

  doc.setFont("helvetica", "italic"); doc.setFontSize(6); sc(doc, C.muted);
  doc.text("Source : Wikipedia / Wikidata via Wikimedia API. Contenu a titre indicatif uniquement.", M.left, y);
  setY(doc, y + 8);

  void rawExtract; void narrative;
}

// ═══════════════════════════════════════════════════════════════════
// ─── NEGOTIATION BLOCK ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildNegotiationBlock(doc: jsPDF, m: DealMetrics, ai: NormalizedAi, y: number): number {
  const isNegocier = ["negocier", "negotiate", "a negocier", "hold", "attendre"].some(
    v => ai.verdict.toLowerCase().includes(v),
  );
  if (!isNegocier) return y;
  if (y + 60 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
  y = sectionTitle(doc, "Arguments de negociation", y, { color: C.accent });

  const args: string[] = [];
  if (m.premiumVsDvfPct != null && m.premiumVsDvfPct > 0)
    args.push(`Prix superieur aux references DVF de +${m.premiumVsDvfPct.toFixed(1)} % — decote justifiee`);
  else if (m.premiumVsDvfPct != null && m.premiumVsDvfPct <= 0)
    args.push(`Prix dans la norme DVF (${m.premiumVsDvfPct.toFixed(1)} %) — marge de negociation limitee`);
  if (ai.missingData.length > 0)
    args.push(`Donnees manquantes a clarifier avant offre : ${ai.missingData.slice(0, 2).join(", ")}`);
  if (m.chargesMensuelles == null)
    args.push("Charges de copropriete non communiquees — risque de rendement");
  const ss = ai.smartScore !== "ND" ? parseInt(ai.smartScore, 10) : null;
  if (ss != null && ss < 60)
    args.push(`SmartScore intermediaire (${ss}/100) — potentiel de valorisation a confirmer`);
  if (args.length === 0) {
    args.push("Verifier les donnees manquantes avant de formaliser l'offre");
    args.push("Demander les diagnostics et les proces-verbaux d'AG");
  }

  const argBlockH = args.length * 7.5 + 24;
  roundedBox(doc, M.left, y, CW, argBlockH, { fill: C.bg, border: C.border, radius: 3, lw: 0.2, shadow: true });
  sf(doc, C.accent); doc.roundedRect(M.left, y, 3.5, argBlockH, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); sc(doc, C.muted);
  doc.text("VERDICT STRATEGIQUE", M.left + 8, y + 6);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); sc(doc, C.primary);
  doc.text(sanitizeForPdf(decisionLabel(ai.verdict)), M.left + 8, y + 12);

  let ay = y + 19;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); sc(doc, C.mutedDark);
  doc.text("Arguments principaux :", M.left + 8, ay); ay += 5;
  for (const arg of args) {
    sf(doc, C.accent); doc.rect(M.left + 8, ay - 1.5, 2, 0.7, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.body);
    const ls = doc.splitTextToSize(sanitizeForPdf(arg), CW - 22) as string[];
    doc.text(ls, M.left + 13, ay);
    ay += ls.length * 4.2 + 1.5;
  }
  y += argBlockH + 6;
  if (y + 18 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }

  let positionText: string;
  if (ai.maxPrice !== "ND") {
    positionText = `Formuler une offre autour de ${ai.maxPrice} afin de retablir un niveau de rentabilite coherent avec le marche.`;
  } else if (m.prixAchat != null) {
    const offerPrice = fmtCurrency(Math.round(m.prixAchat * 0.95));
    positionText = `Formuler une offre autour de ${offerPrice} (decote -5 %) afin de retablir un niveau de rentabilite coherent avec les references DVF.`;
  } else {
    positionText = "Formuler une offre en dessous du prix affiche apres verification des donnees manquantes et des references DVF du secteur.";
  }

  const posLines = doc.splitTextToSize(sanitizeForPdf(positionText), CW - 22) as string[];
  const posH = posLines.length * 4.4 + 16;
  roundedBox(doc, M.left, y, CW, posH, { fill: C.accentSoft, border: [196, 221, 253] as const, radius: 3, lw: 0.2 });
  sf(doc, C.accent); doc.roundedRect(M.left, y, 3.5, posH, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); sc(doc, C.mutedDark);
  doc.text("Position recommandee :", M.left + 8, y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.accent);
  doc.text(posLines, M.left + 8, y + 11);
  y += posH + 6;
  return y;
}

function buildNarrative(doc: jsPDF, m: DealMetrics, ai: NormalizedAi, opts?: ExportPdfOpts): void {
  doc.addPage(); let y = M.top + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text("Synthese strategique du bien", M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 8;

  roundedBox(doc, M.left, y, CW, 14, { fill: C.primary, radius: 3 });
  sf(doc, C.accent); doc.roundedRect(M.left, y, 3.5, 14, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); sc(doc, C.white);
  doc.text(sanitizeForPdf(m.id ? `${m.titre}  —  Ref: ${m.id}` : m.titre), M.left + 8, y + 5.5);
  if (m.adresseComplete) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, [148, 163, 184] as const);
    doc.text(sanitizeForPdf(m.adresseComplete), M.left + 8, y + 10.5);
  }
  y += 19;

  y = subTitle(doc, "Resume en une phrase", y);
  y = para(doc, ai.nrResume, y, { fs: 9.5, style: "italic", color: C.accent }); y += 4;
  y = subTitle(doc, "Ce qui cree de la valeur", y);
  y = para(doc, ai.nrValeur, y); y += 4;
  y = subTitle(doc, "Ce qui limite le potentiel", y);
  y = para(doc, ai.nrLimites, y); y += 4;
  y = subTitle(doc, "Lecture financiere synthetique", y);
  y = para(doc, ai.nrFinancier, y); y += 4;
  y = subTitle(doc, "Profil d'investisseur adapte", y);
  y = para(doc, ai.nrProfil, y); y += 4;

  y = subTitle(doc, "Conclusion", y);
  if (y + 22 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
  const cls = doc.splitTextToSize(sanitizeForPdf(ai.nrConclusion), CW - 16) as string[];
  const bH  = Math.max(18, cls.length * 4.4 + 12);
  roundedBox(doc, M.left, y, CW, bH, { fill: C.bg, border: C.border, radius: 3, lw: 0.2, shadow: true });
  sf(doc, C.accent); doc.roundedRect(M.left, y, 3.5, bH, 1.5, 1.5, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); sc(doc, C.body);
  doc.text(cls, M.left + 8, y + 7); y += bH + 8;

  y = buildNegotiationBlock(doc, m, ai, y);
  void opts;
  setY(doc, y);
}

// ═══════════════════════════════════════════════════════════════════
// ─── SMARTSCORE PEDAGOGY ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

interface SmartScoreDisplay {
  smartScore: number | null; liquidite: number | null; pressionRisque: number | null;
  dataConfidence: number; dataConfidenceLabel: "Elevee" | "Moyenne" | "Faible";
}

function buildSmartScorePedagogy(doc: jsPDF, y: number, display: SmartScoreDisplay): number {
  const innerW = CW - 10; const lineH = 4.3; const fs = 7.8; const fsBold = 7.8;

  const textA =
    "Le SmartScore est une synthese rapide de la solidite du dossier, sur 100 points. " +
    "Il ne remplace pas la due diligence ni une analyse experte, mais permet d'identifier " +
    "en un coup d'oeil si l'operation semble solide, intermediaire ou fragile.";

  const scaleLines: { label: string; desc: string; color: readonly [number, number, number] }[] = [
    { label: "70 - 100", desc: "dossier globalement solide",            color: C.success },
    { label: "50 - 69",  desc: "dossier intermediaire, a securiser",    color: C.warning },
    { label: "0 - 49",   desc: "dossier fragile, prudence requise",     color: C.danger  },
  ];

  const noteLines: { label: string; desc: string }[] = [
    { label: "Pression risque :",    desc: "plus le score est bas, plus le dossier est sain." },
    { label: "Confiance donnees :",  desc: "plus elle est elevee, plus les scores sont exploitables." },
  ];

  const ss  = display.smartScore;
  const liq = display.liquidite;
  const pr  = display.pressionRisque;
  const dc  = display.dataConfidence;
  const dcL = display.dataConfidenceLabel;

  let dossierQual: string;
  if (ss == null)    dossierQual = "ne peut pas etre evalue (donnees insuffisantes)";
  else if (ss >= 70) dossierQual = `parait globalement solide (${ss}/100)`;
  else if (ss >= 50) dossierQual = `ressort comme intermediaire (${ss}/100)`;
  else               dossierQual = `ressort comme fragile en l'etat (${ss}/100)`;

  let fiabiliteQual: string;
  if (dc >= 80)      fiabiliteQual = "la lecture est plutot fiable";
  else if (dc >= 60) fiabiliteQual = "la lecture est exploitable mais a confirmer";
  else               fiabiliteQual = "la lecture est indicative uniquement (donnees partielles)";

  let risqueQual: string;
  if (pr == null)    risqueQual = "la pression risque n'est pas calculable";
  else if (pr >= 65) risqueQual = `la pression risque est elevee (${pr}/100) — vigilance recommandee`;
  else if (pr >= 50) risqueQual = `la pression risque est moderee (${pr}/100)`;
  else               risqueQual = `la pression risque est contenue (${pr}/100)`;

  let liqQual: string;
  if (liq == null)    liqQual = "";
  else if (liq >= 65) liqQual = ` La liquidite est favorable (${liq}/100).`;
  else if (liq >= 45) liqQual = ` La liquidite est correcte (${liq}/100).`;
  else                liqQual = ` La liquidite est faible (${liq}/100), la revente pourrait prendre du temps.`;

  let conclusion: string;
  if (ss == null) {
    conclusion = "Completer le dossier (prix de revente, travaux, financement) pour obtenir une lecture fiable.";
  } else if (ss >= 70 && dc >= 60) {
    conclusion = "Le dossier semble globalement solide et les scores sont exploitables. Verifier les points de vigilance avant engagement.";
  } else if (ss >= 70 && dc < 60) {
    conclusion = "Le dossier parait solide mais les donnees sont partielles — la lecture reste indicative. Enrichir le dossier avant de conclure.";
  } else if (ss >= 50) {
    conclusion = "Le dossier parait intermediaire mais ameliorable. Identifier les leviers (negociation prix, securisation travaux) avant de s'engager.";
  } else {
    conclusion = "Le dossier ressort comme fragile en l'etat. Des points bloquants sont a lever avant toute offre serieuse.";
  }

  const textC =
    `Ce dossier ${dossierQual}. Avec une confiance donnees de ${dc}/100 (${dcL}), ${fiabiliteQual}. ` +
    `Par ailleurs, ${risqueQual}.${liqQual} ${conclusion}`;

  doc.setFont("helvetica", "normal"); doc.setFontSize(fs);
  const linesA   = doc.splitTextToSize(sanitizeForPdf(textA), innerW) as string[];
  const linesC   = doc.splitTextToSize(sanitizeForPdf(textC), innerW) as string[];

  const hdrH   = 6.5; const gapSec = 3;
  const heightA = linesA.length * lineH;
  const heightB = scaleLines.length * (lineH + 0.5) + noteLines.length * lineH + 2;
  const heightC = linesC.length * lineH;
  const totalInner = hdrH + heightA + gapSec + hdrH + heightB + gapSec + hdrH + heightC + 4;
  const blockH = totalInner + 10;

  if (y + blockH > PH - M.bottom) { doc.addPage(); y = M.top + 12; }

  roundedBox(doc, M.left, y, CW, blockH, { fill: C.bg, border: C.border, radius: 3, lw: 0.2 });
  sf(doc, C.accent); doc.roundedRect(M.left, y, 3, blockH, 1.5, 1.5, "F");

  let ty = y + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(fsBold); sc(doc, C.primary);
  doc.text("A quoi servent ces scores ?", M.left + 7, ty); ty += hdrH;
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs); sc(doc, C.body);
  doc.text(linesA, M.left + 7, ty); ty += heightA + gapSec;

  doc.setFont("helvetica", "bold"); doc.setFontSize(fsBold); sc(doc, C.primary);
  doc.text("Comment les lire ?", M.left + 7, ty); ty += hdrH;
  for (const row of scaleLines) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(fs); sc(doc, row.color);
    doc.text(sanitizeForPdf(row.label), M.left + 7, ty);
    const lw = doc.getTextWidth(row.label + "  ");
    doc.setFont("helvetica", "normal"); sc(doc, C.body);
    doc.text(sanitizeForPdf("— " + row.desc), M.left + 7 + lw, ty);
    ty += lineH + 0.5;
  }
  ty += 1;
  for (const row of noteLines) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(fs - 0.3); sc(doc, C.mutedDark);
    doc.text(sanitizeForPdf(row.label), M.left + 7, ty);
    const lw2 = doc.getTextWidth(row.label + " ");
    doc.setFont("helvetica", "italic"); sc(doc, C.muted);
    doc.text(sanitizeForPdf(row.desc), M.left + 7 + lw2, ty);
    ty += lineH;
  }
  ty += gapSec;

  doc.setFont("helvetica", "bold"); doc.setFontSize(fsBold); sc(doc, C.primary);
  doc.text("Lecture de ce dossier", M.left + 7, ty); ty += hdrH;
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs); sc(doc, C.body);
  doc.text(linesC, M.left + 7, ty);

  return y + blockH + 6;
}

// ═══════════════════════════════════════════════════════════════════
// ─── PAGE 1 — Decision en 30 secondes ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildPage1(doc: jsPDF, m: DealMetrics, ai: NormalizedAi, opts?: ExportPdfOpts): void {
  doc.addPage(); let y = M.top + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text("Decision en 30 secondes", M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 8;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.body);
  doc.text(sanitizeForPdf(m.id ? `${m.titre}  |  ${m.id}` : m.titre), M.left, y); y += 4.5;
  if (m.adresseComplete) { doc.setFontSize(7.5); sc(doc, C.muted); doc.text(sanitizeForPdf(m.adresseComplete), M.left, y); y += 5; }
  y += 2;

  if (ai.verdict !== "ND") {
    roundedBox(doc, M.left, y, CW, 20, { fill: C.primary, border: C.accent, radius: 3, lw: 0.4 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); sc(doc, [148, 163, 184] as const);
    doc.text("VERDICT STRATEGIQUE", PW / 2, y + 6.5, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.white);
    doc.text(sanitizeForPdf(decisionLabel(ai.verdict)), PW / 2, y + 14, { align: "center" });
    if (ai.confidence !== "ND") {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, [148, 163, 184] as const);
      doc.text(sanitizeForPdf(`Confiance : ${ai.confidence}`), M.left + CW - 3, y + 17.5, { align: "right" });
    }
    y += 26;
  } else {
    roundedBox(doc, M.left, y, CW, 14, { fill: C.bgAlt, border: C.border, radius: 3 });
    doc.setFont("helvetica", "italic"); doc.setFontSize(9); sc(doc, C.muted);
    doc.text("Verdict IA non disponible", PW / 2, y + 9, { align: "center" }); y += 18;
  }

  const narrativeMd = opts?.aiReport?.analysis?.narrativeMarkdown;
  const scores      = resolveSmartScores(opts, narrativeMd, m);
  const v2meta      = computeSmartScoreV2(m, opts, narrativeMd);

  const toPillarSource = (src: ResolvedScores["source"], fallback: boolean): PillarSource => {
    if (fallback) return "estim";
    if (src === "server")    return "server";
    if (src === "analysis")  return "calc";
    if (src === "narrative") return "narrative";
    return "estim";
  };
  const globalSrc = toPillarSource(scores.source, scores.usedFallback);

  y = sectionTitle(doc, "SmartScore", y);
  const cardW = (CW - 9) / 4; const cardH = 40;
  const cards = [
    { label: "SmartScore",      score: scores.smartScore,     source: globalSrc },
    { label: "Liquidite",       score: scores.liquidite,      source: globalSrc },
    { label: "Opportunity",     score: scores.opportunity,    source: globalSrc },
    { label: "Pression risque", score: scores.pressionRisque, source: globalSrc, inverted: true, subtext: "plus bas = mieux" },
  ] as const;
  cards.forEach((c, i) => {
    scoreCard100(doc, M.left + i * (cardW + 3), y, cardW, cardH, c.label, c.score, {
      source: pillarSourceLabel(c.source), inverted: "inverted" in c ? c.inverted : false,
      subtext: "subtext" in c ? c.subtext : undefined,
    });
  });
  y += cardH + 5;

  const confColor: readonly [number, number, number] =
    v2meta.dataConfidenceLabel === "Elevee" ? C.success
    : v2meta.dataConfidenceLabel === "Moyenne" ? C.warning
    : C.danger;
  roundedBox(doc, M.left, y, CW, 8, { fill: C.bgAlt, border: C.border, radius: 2, lw: 0.2 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); sc(doc, C.muted);
  const confTxt = `Confiance donnees : `;
  doc.text(confTxt, M.left + 3, y + 5.5);
  const cTxtW = doc.getTextWidth(confTxt);
  doc.setFont("helvetica", "bold"); sc(doc, confColor);
  doc.text(sanitizeForPdf(`${v2meta.dataConfidence}/100 (${v2meta.dataConfidenceLabel})`), M.left + 3 + cTxtW, y + 5.5);
  const rentStr = v2meta.pillars.rentabilite.value != null ? `Rentabilite ${v2meta.pillars.rentabilite.value}/100` : "";
  const robStr  = v2meta.pillars.robustesse.value  != null ? `Robustesse ${v2meta.pillars.robustesse.value}/100`  : "";
  if (rentStr || robStr) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); sc(doc, C.mutedDark);
    doc.text(sanitizeForPdf([rentStr, robStr].filter(Boolean).join("  |  ")), PW - M.right, y + 5.5, { align: "right" });
  }
  y += 13;

  y = buildSmartScorePedagogy(doc, y, {
    smartScore: scores.smartScore, liquidite: scores.liquidite,
    pressionRisque: scores.pressionRisque, dataConfidence: v2meta.dataConfidence,
    dataConfidenceLabel: v2meta.dataConfidenceLabel,
  });

  y = sectionTitle(doc, "Chiffres cles", y);
  const kpis = [
    { l: "Prix d'achat",   v: dCur(m.prixAchat) },
    { l: "Surface",        v: dSurf(m.surfaceM2) },
    { l: "Prix / m2",      v: dCur(m.prixM2) },
    { l: "Capital engage", v: m.capitalEngage != null ? dCur(m.capitalEngage) : "ND" },
  ];
  const kw = CW / 4;
  kpis.forEach((k, i) => {
    const kx = M.left + i * kw;
    const isNd = k.v.startsWith("ND");
    roundedBox(doc, kx + 1, y, kw - 2, 16, { fill: isNd ? C.bgAlt : C.bg, border: C.border, radius: 3, lw: 0.2, shadow: !isNd });
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); sc(doc, isNd ? C.muted : C.accent);
    doc.text(sanitizeForPdf(k.v), kx + kw / 2, y + 7.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
    doc.text(k.l, kx + kw / 2, y + 12.5, { align: "center" });
  });
  y += 20;

  for (const bs of [
    { t: "Pourquoi acheter",   its: ai.whyBuy,       c: C.success as const,   p: "+" },
    { t: "A faire maintenant", its: ai.whatToDo,     c: C.accent  as const,   p: "->" },
    { t: "Points de vigilance — Kill switches", its: ai.killSwitches, c: C.mutedDark as const, p: "-" },
  ]) {
    if (bs.its.length === 0) continue;
    y = sectionTitle(doc, bs.t, y, { color: bs.c, fontSize: 8.5 });
    for (const it of bs.its) {
      if (bs.t.includes("Kill")) {
        sf(doc, bs.c); doc.rect(M.left + 3, y - 1.8, 1.8, 1.8, "F");
      } else {
        sf(doc, bs.c); doc.circle(M.left + 3.5, y - 1, 0.9, "F");
      }
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.body);
      const ls = doc.splitTextToSize(sanitizeForPdf(it), CW - 10) as string[];
      doc.text(ls, M.left + 7, y);
      y += ls.length * 4.2 + 2;
    }
    y += 2;
  }

  void bulletPrefix;
  setY(doc, y);
}

// ═══════════════════════════════════════════════════════════════════
// ─── PAGE 2 — Risques & Conditions ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildPage2(doc: jsPDF, m: DealMetrics, ai: NormalizedAi): void {
  doc.addPage(); let y = M.top + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text("Risques & Conditions", M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 10;

  const cardGap = 3; const cardW = (CW - cardGap * 2) / 3;
  const upsideItems   = ai.upside.slice(0, 4);
  const downsideItems = ai.downside.slice(0, 4);
  const maxBullets    = Math.max(upsideItems.length, downsideItems.length, 2);
  const cardH         = Math.max(36, 16 + maxBullets * 7.5);

  const c1x = M.left;
  roundedBox(doc, c1x, y, cardW, cardH, { fill: C.white, border: C.border, radius: 3, lw: 0.3, shadow: true });
  sf(doc, C.accent); doc.roundedRect(c1x, y, cardW, 3, 1.5, 1.5, "F");
  sf(doc, C.accent); doc.rect(c1x, y + 1.5, cardW, 1.5, "F");
  let cy1 = y + 9;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); sc(doc, C.accent);
  doc.text("POINTS FAVORABLES", c1x + cardW / 2, cy1, { align: "center" }); cy1 += 5.5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); sc(doc, C.body);
  for (const it of upsideItems) {
    sf(doc, C.accent); doc.circle(c1x + 5, cy1 - 1, 0.7, "F");
    const ls = doc.splitTextToSize(sanitizeForPdf(it), cardW - 13) as string[];
    doc.text(ls, c1x + 8.5, cy1); cy1 += ls.length * 3.8 + 2;
  }

  const c2x = M.left + cardW + cardGap;
  roundedBox(doc, c2x, y, cardW, cardH, { fill: C.white, border: C.border, radius: 3, lw: 0.3, shadow: true });
  sf(doc, C.muted); doc.roundedRect(c2x, y, cardW, 3, 1.5, 1.5, "F");
  sf(doc, C.muted); doc.rect(c2x, y + 1.5, cardW, 1.5, "F");
  let cy2 = y + 9;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); sc(doc, C.mutedDark);
  doc.text("POINTS DE VIGILANCE", c2x + cardW / 2, cy2, { align: "center" }); cy2 += 5.5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); sc(doc, C.body);
  for (const it of downsideItems) {
    sf(doc, C.mutedDark); doc.circle(c2x + 5, cy2 - 1, 0.7, "F");
    const ls = doc.splitTextToSize(sanitizeForPdf(it), cardW - 13) as string[];
    doc.text(ls, c2x + 8.5, cy2); cy2 += ls.length * 3.8 + 2;
  }

  const c3x = M.left + (cardW + cardGap) * 2;
  roundedBox(doc, c3x, y, cardW, cardH, { fill: C.white, border: C.border, radius: 3, lw: 0.3, shadow: true });
  sf(doc, C.navyMid); doc.roundedRect(c3x, y, cardW, 3, 1.5, 1.5, "F");
  sf(doc, C.navyMid); doc.rect(c3x, y + 1.5, cardW, 1.5, "F");
  let cy3 = y + 9;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); sc(doc, C.primary);
  doc.text("LIMITES DE PRIX", c3x + cardW / 2, cy3, { align: "center" }); cy3 += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
  doc.text("PRIX MAX CONSEILLE", c3x + 4, cy3); cy3 += 3.5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); sc(doc, ai.maxPrice === "ND" ? C.muted : C.accent);
  doc.text(sanitizeForPdf(ai.maxPrice), c3x + 4, cy3); cy3 += 3;
  if (ai.maxPriceSource !== "none") {
    doc.setFont("helvetica", "italic"); doc.setFontSize(5); sc(doc, C.muted);
    doc.text(`source: ${ai.maxPriceSource}`, c3x + 4, cy3);
  }
  cy3 += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
  doc.text("NEVER EXCEED", c3x + 4, cy3); cy3 += 3.5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); sc(doc, ai.neverExceed === "ND" ? C.muted : C.mutedDark);
  doc.text(sanitizeForPdf(ai.neverExceed), c3x + 4, cy3);
  y += cardH + 10;

  if (ai.killSwitches.length > 0) {
    y = sectionTitle(doc, "Kill switches — points bloquants", y, { color: C.mutedDark });
    for (const it of ai.killSwitches.slice(0, 3)) {
      roundedBox(doc, M.left, y - 3, CW, 10, { fill: C.killBg, border: C.killBorder, radius: 2, lw: 0.2 });
      sf(doc, C.mutedDark); doc.rect(M.left + 4.5, y, 2.2, 0.7, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.body);
      const ls = doc.splitTextToSize(sanitizeForPdf(it), CW - 14) as string[];
      doc.text(ls, M.left + 10, y + 2);
      y += Math.max(10, ls.length * 4) + 2;
    }
    y += 3;
  }

  if (ai.missingData.length > 0) {
    y = sectionTitle(doc, "Donnees a obtenir", y, { color: C.warning });
    const mdBlockH = ai.missingData.length * 6 + 8;
    roundedBox(doc, M.left, y, CW, mdBlockH, { fill: C.confBg, border: C.confBorder, radius: 3, lw: 0.2 });
    let my = y + 6;
    for (const it of ai.missingData) {
      sf(doc, C.warning); doc.rect(M.left + 4, my - 2, 1.5, 1.5, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.body);
      doc.text(sanitizeForPdf(it), M.left + 9, my);
      my += 6;
    }
    y += mdBlockH + 6;
  }

  if (ai.conditionsToBuy.length > 0) {
    y = sectionTitle(doc, "Conditions pour acheter", y, { color: C.accent });
    ai.conditionsToBuy.forEach((it, i) => {
      const ls = doc.splitTextToSize(sanitizeForPdf(`${i + 1}. ${it}`), CW - 6) as string[];
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.body);
      doc.text(ls, M.left + 2, y); y += ls.length * 4.2 + 2;
    });
    y += 4;
  }

  if (y < PH - M.bottom - 44) {
    y = sectionTitle(doc, "Detail limites de prix", y, { color: C.primary });
    const pcw = (CW - 4) / 2;

    roundedBox(doc, M.left, y, pcw, 24, { fill: C.bg, border: C.border, radius: 3, lw: 0.2, shadow: true });
    sf(doc, C.accent); doc.roundedRect(M.left, y, 3.5, 24, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); sc(doc, C.accentDark);
    doc.text("PRIX MAX CONSEILLE", M.left + 7, y + 6);
    const lbl1 = ai.maxPriceSource === "ia" ? "(IA)" : ai.maxPriceSource === "fallback" ? "(fallback)" : "";
    doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
    doc.text(lbl1, M.left + pcw - 4, y + 6, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); sc(doc, ai.maxPrice === "ND" ? C.muted : C.accent);
    doc.text(sanitizeForPdf(ai.maxPrice), M.left + 7, y + 14);
    if (ai.maxPriceWhy) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(6); sc(doc, C.muted);
      const mxls = doc.splitTextToSize(sanitizeForPdf(ai.maxPriceWhy), pcw - 12) as string[];
      doc.text(mxls[0] ?? "", M.left + 7, y + 20);
    }

    const neX = M.left + pcw + 4;
    roundedBox(doc, neX, y, pcw, 24, { fill: C.bgAlt, border: C.borderDark, radius: 3, lw: 0.2, shadow: true });
    sf(doc, C.muted); doc.roundedRect(neX, y, 3.5, 24, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); sc(doc, C.mutedDark);
    doc.text("NEVER EXCEED", neX + 7, y + 6);
    const lbl2 = ai.neverExceedSource === "ia" ? "(IA)" : ai.neverExceedSource === "fallback" ? "(fallback)" : "";
    doc.setFont("helvetica", "normal"); doc.setFontSize(6); sc(doc, C.muted);
    doc.text(lbl2, neX + pcw - 4, y + 6, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); sc(doc, ai.neverExceed === "ND" ? C.muted : C.primary);
    doc.text(sanitizeForPdf(ai.neverExceed), neX + 7, y + 14);
    if (ai.neverExceedWhy) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(6); sc(doc, C.muted);
      const nels = doc.splitTextToSize(sanitizeForPdf(ai.neverExceedWhy), pcw - 12) as string[];
      doc.text(nels[0] ?? "", neX + 7, y + 20);
    }
    y += 30;
  }
  setY(doc, y);
}

// ═══════════════════════════════════════════════════════════════════
// ─── PAGE 3 — Stress test & Capital ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildPage3(doc: jsPDF, m: DealMetrics, ai: NormalizedAi): void {
  type DocWithTable = jsPDF & { lastAutoTable: { finalY: number } };
  doc.addPage(); let y = M.top + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text("Stress test & Capital", M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 10;

  const tableStyles = {
    styles: {
      font: "helvetica", fontSize: 8, cellPadding: 3,
      textColor: [C.body[0], C.body[1], C.body[2]] as [number,number,number],
      lineColor: [C.border[0], C.border[1], C.border[2]] as [number,number,number],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [C.primary[0], C.primary[1], C.primary[2]] as [number,number,number],
      textColor: [255, 255, 255] as [number,number,number],
      fontStyle: "bold" as const, fontSize: 8,
    },
    alternateRowStyles: { fillColor: [C.bg[0], C.bg[1], C.bg[2]] as [number,number,number] },
    margin: { left: M.left, right: M.right },
    tableLineColor: [C.border[0], C.border[1], C.border[2]] as [number,number,number],
    tableLineWidth: 0.15,
  };

  const buildAndRenderStressTable = (rows: string[][], ndNotes: string[]) => {
    if (rows.length > 0) {
      autoTable(doc, { startY: y, head: [["Scenario", "Impact", "Marge", "Statut"]], body: rows, ...tableStyles });
      y = (doc as DocWithTable).lastAutoTable.finalY + 12;
    }
    if (ndNotes.length > 0) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); sc(doc, C.warning);
      for (const note of ndNotes) { doc.text(sanitizeForPdf(note), M.left + 2, y, { maxWidth: CW - 4 }); y += 4.5; }
      y += 3;
    }
  };

  if (ai.stressTest.length > 0) {
    const validRows = ai.stressTest.filter(r => r.statut !== "ND" && r.marge !== "ND");
    const ndRows    = ai.stressTest.filter(r => r.statut === "ND" || r.marge === "ND");
    buildAndRenderStressTable(
      validRows.map(r => [sanitizeForPdf(r.scenario), sanitizeForPdf(r.impact), sanitizeForPdf(r.marge), sanitizeForPdf(r.statut)]),
      ndRows.map(r => `${r.scenario} : ND - donnee(s) manquante(s) pour ce scenario`),
    );
  } else if (m.prixAchat != null && m.prixRevente != null && m.capitalEngage != null) {
    const stressRows: string[][] = [];
    const ndNotes: string[] = [];
    if (m.travaux != null) {
      for (const pct of [10, 20, 30] as const) {
        const tUp = m.travaux * (1 + pct / 100);
        const ceUp = m.prixAchat! + tUp + (m.fraisNotaire ?? 0);
        const marg = m.prixRevente! - ceUp;
        stressRows.push([`Travaux +${pct}%`, fmtCurrency(tUp - m.travaux), fmtCurrency(marg), marg > 0 ? "OK" : "RISQUE"]);
      }
    } else { ndNotes.push("Travaux +10/20/30% : ND (travaux non chiffres)"); }
    const rDn5  = m.prixRevente! * 0.95; const rDn10 = m.prixRevente! * 0.90; const rDn15 = m.prixRevente! * 0.85;
    stressRows.push(["Revente -5%",  fmtCurrency(m.prixRevente!-rDn5),  fmtCurrency(rDn5 -m.capitalEngage!), (rDn5 -m.capitalEngage!)>0?"OK":"RISQUE"]);
    stressRows.push(["Revente -10%", fmtCurrency(m.prixRevente!-rDn10), fmtCurrency(rDn10-m.capitalEngage!), (rDn10-m.capitalEngage!)>0?"OK":"RISQUE"]);
    stressRows.push(["Revente -15%", fmtCurrency(m.prixRevente!-rDn15), fmtCurrency(rDn15-m.capitalEngage!), (rDn15-m.capitalEngage!)>0?"OK":"RISQUE"]);
    for (const fpct of [4, 6] as const) {
      const fraisVente = m.prixRevente! * (fpct / 100);
      const margeNet   = m.prixRevente! - fraisVente - m.capitalEngage!;
      stressRows.push([`Frais de vente ${fpct}%`, fmtCurrency(fraisVente), fmtCurrency(margeNet), margeNet > 0 ? "OK" : "RISQUE"]);
    }
    if (m.travaux != null) {
      const ce20 = m.prixAchat! + m.travaux * 1.2 + (m.fraisNotaire ?? 0);
      const ce30 = m.prixAchat! + m.travaux * 1.3 + (m.fraisNotaire ?? 0);
      const mc20 = rDn10 - ce20; const mc30 = rDn15 - ce30;
      stressRows.push(["Cumul (Trav+20% & Rev-10%)", "Combine", fmtCurrency(mc20), mc20 > 0 ? "OK" : "RISQUE"]);
      stressRows.push(["Cumul (Trav+30% & Rev-15%)", "Combine", fmtCurrency(mc30), mc30 > 0 ? "OK" : "RISQUE"]);
    } else { ndNotes.push("Cumuls : ND (travaux non chiffres)"); }
    buildAndRenderStressTable(stressRows, ndNotes);
  } else {
    const reasons: string[] = [];
    if (m.prixAchat    == null) reasons.push("prix d'achat");
    if (m.prixRevente  == null) reasons.push("revente cible");
    if (m.capitalEngage == null) reasons.push("capital engage");
    roundedBox(doc, M.left, y, CW, 16, { fill: C.bgAlt, border: C.border, radius: 3 });
    doc.setFont("helvetica", "italic"); doc.setFontSize(9); sc(doc, C.muted);
    doc.text(sanitizeForPdf(`Stress test impossible : donnee(s) manquante(s) — ${reasons.join(", ")}.`), M.left + 5, y + 9, { maxWidth: CW - 10 });
    y += 22;
  }

  y = sectionTitle(doc, "Resultat projete", y);
  roundedBox(doc, M.left, y, CW, 22, { fill: C.bg, border: C.border, radius: 3, lw: 0.2, shadow: true });
  const rows2 = [
    { l: "Gain potentiel",    v: ai.gainPotentiel,    c: C.success as const },
    { l: "Perte potentielle", v: ai.pertePotentielle, c: C.warning  as const },
  ];
  let ry = y + 6;
  for (const r of rows2) {
    const isNd = r.v === "ND" || r.v.startsWith("ND ");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.muted);
    doc.text(r.l, M.left + 6, ry);
    doc.setFont("helvetica", "bold"); sc(doc, isNd ? C.muted : r.c);
    doc.text(sanitizeForPdf(r.v), M.left + CW - 6, ry, { align: "right" });
    ry += 7;
  }
  y += 26;

  if (ai.stressTestReadable) {
    roundedBox(doc, M.left, y, CW, 14, { fill: C.accentSoft, border: [196, 221, 253] as const, radius: 2, lw: 0.2 });
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); sc(doc, C.accentDark);
    doc.text(doc.splitTextToSize(sanitizeForPdf(ai.stressTestReadable), CW - 12) as string[], M.left + 6, y + 5);
    y += 18;
  }

  if (m.margeBrute != null && m.margeBrutePct != null) {
    y = sectionTitle(doc, "Marge brute calculee", y, { fontSize: 8.5 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); sc(doc, C.body);
    doc.text(sanitizeForPdf(`Marge brute : ${dCur(m.margeBrute)} (${fmtPercent(m.margeBrutePct)})`), M.left + 2, y); y += 5.5;
    if (m.premiumVsDvfPct != null) {
      doc.text(sanitizeForPdf(`Premium vs DVF : ${fmtPercent(m.premiumVsDvfPct)}`), M.left + 2, y); y += 5.5;
    }
    if (m.travaux == null) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(7); sc(doc, C.warning);
      doc.text("Note : marge calculee sans travaux (non chiffres). Resultat reel potentiellement inferieur.", M.left + 2, y, { maxWidth: CW - 4 }); y += 5;
    }
  }
  setY(doc, y);
}

// ═══════════════════════════════════════════════════════════════════
// ─── PAGE 4 — Plan d'action ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildPage4(doc: jsPDF, _m: DealMetrics, ai: NormalizedAi): void {
  doc.addPage(); let y = M.top + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text("Plan d'action", M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 10;

  const phases: Record<string, ChecklistItem[]> = {};
  if (ai.checklist.length > 0) {
    for (const it of ai.checklist) { const ph = sanitizeForPdf(it.phase) || "Avant offre"; (phases[ph] ??= []).push(it); }
  } else {
    phases["Avant offre"] = [
      { phase: "", label: "Verifier le titre de propriete" }, { phase: "", label: "Confirmer la surface reelle" },
      { phase: "", label: "Estimer les travaux avec artisan" }, { phase: "", label: "Verifier le PLU / urbanisme" },
    ];
    phases["Avant compromis"] = [
      { phase: "", label: "Diagnostic complet (DPE, amiante, plomb...)" }, { phase: "", label: "Verifier les servitudes" },
      { phase: "", label: "Confirmer le financement" }, { phase: "", label: "Negocier les conditions suspensives" },
    ];
    phases["Conditions suspensives"] = [
      { phase: "", label: "Obtention du pret" }, { phase: "", label: "Permis si necessaire" },
      { phase: "", label: "Absence de preemption" }, { phase: "", label: "Conformite urbanistique" },
    ];
  }

  for (const ph of Object.keys(phases)) {
    if (y > PH - M.bottom - 30) { doc.addPage(); y = M.top + 12; }
    y = sectionTitle(doc, ph, y, { fontSize: 8.5, color: C.accentDark });
    const phItems = phases[ph];
    const blockH = phItems.length * 7 + 8;
    roundedBox(doc, M.left, y, CW, blockH, { fill: C.white, border: C.border, radius: 3, lw: 0.2, shadow: true });
    let biy = y + 6;
    for (const it of phItems) { biy += drawCheckbox(doc, M.left + 5, biy, it.label, !!it.done, { fs: 8.5 }); }
    y += blockH + 5;
  }
  setY(doc, y);
}

// ─── Annexes ──────────────────────────────────────────────────────

function annexeFiche(doc: jsPDF, ai: NormalizedAi): void {
  if (!ai.ficheOperation.length) return;
  doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(13); sc(doc, C.primary);
  doc.text("Annexe — Fiche operation", M.left, M.top);
  const body: string[][] = [];
  for (const r of ai.ficheOperation) for (const [k, v] of Object.entries(r)) body.push([sanitizeForPdf(k), sanitizeForPdf(v)]);
  autoTable(doc, {
    startY: M.top + 8, head: [["Element", "Valeur"]], body,
    margin: { left: M.left, right: M.right },
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2.5, textColor: [C.body[0], C.body[1], C.body[2]] },
    headStyles: { fillColor: [C.primary[0], C.primary[1], C.primary[2]], textColor: [255,255,255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [C.bg[0], C.bg[1], C.bg[2]] },
  });
}

function annexeDD(doc: jsPDF, ai: NormalizedAi): void {
  if (!ai.dueDiligence.length) return;
  doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(13); sc(doc, C.primary);
  doc.text("Annexe — Due Diligence", M.left, M.top);
  autoTable(doc, {
    startY: M.top + 8, head: [["Element", "Statut", "Detail"]],
    body: ai.dueDiligence.map(r => [sanitizeForPdf(r.item), sanitizeForPdf(r.statut), sanitizeForPdf(r.detail ?? "")]),
    margin: { left: M.left, right: M.right },
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2.5, textColor: [C.body[0], C.body[1], C.body[2]] },
    headStyles: { fillColor: [C.primary[0], C.primary[1], C.primary[2]], textColor: [255,255,255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [C.bg[0], C.bg[1], C.bg[2]] },
  });
}

// ═══════════════════════════════════════════════════════════════════
// ─── LOAN COST COMPUTATION ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export interface LoanScenario {
  durationYears: number;
  mensualiteHorsAssurance: number; assuranceMensuelle: number;
  mensualiteTotale: number; interetsTotaux: number;
  assuranceTotale: number; coutTotalCredit: number; totalRembourse: number;
}

export function computeLoanCost(
  principal: number, annualRatePct: number, durationYears: number,
  annualInsurancePct = 0, fraisInitiaux = 0,
): LoanScenario {
  const n = durationYears * 12;
  const r = annualRatePct / 100 / 12;
  let mensualiteHorsAssurance: number;
  if (r === 0) { mensualiteHorsAssurance = principal / n; }
  else {
    const factor = Math.pow(1 + r, n);
    mensualiteHorsAssurance = (principal * r * factor) / (factor - 1);
  }
  const interetsTotaux     = mensualiteHorsAssurance * n - principal;
  const assuranceMensuelle = (principal * annualInsurancePct / 100) / 12;
  const assuranceTotale    = assuranceMensuelle * n;
  const mensualiteTotale   = mensualiteHorsAssurance + assuranceMensuelle;
  const coutTotalCredit    = interetsTotaux + assuranceTotale + fraisInitiaux;
  const totalRembourse     = principal + coutTotalCredit;
  return {
    durationYears,
    mensualiteHorsAssurance: Math.round(mensualiteHorsAssurance),
    assuranceMensuelle:      Math.round(assuranceMensuelle),
    mensualiteTotale:        Math.round(mensualiteTotale),
    interetsTotaux:          Math.round(interetsTotaux),
    assuranceTotale:         Math.round(assuranceTotale),
    coutTotalCredit:         Math.round(coutTotalCredit),
    totalRembourse:          Math.round(totalRembourse),
  };
}

// ═══════════════════════════════════════════════════════════════════
// ─── PAGE COMPARATIF FINANCEMENT ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildLoanComparison(doc: jsPDF, m: DealMetrics): void {
  type DocWithTable = jsPDF & { lastAutoTable: { finalY: number } };
  const principal = m.montantPret;
  if (principal == null || principal <= 0) return;

  const ratePct       = m.loanRatePct       ?? 3.5;
  const insurancePct  = m.loanInsurancePct  ?? 0.25;
  const fraisInitiaux = m.loanFraisInitiaux ?? 0;
  const isDefaultRate      = m.loanRatePct      == null;
  const isDefaultInsurance = m.loanInsurancePct == null;

  const DURATIONS = [10, 15, 20] as const;
  const scenarios = DURATIONS.map(dur => computeLoanCost(principal, ratePct, dur, insurancePct, fraisInitiaux));

  doc.addPage(); let y = M.top + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); sc(doc, C.primary);
  doc.text("Comparatif financement", M.left, y); y += 3;
  sf(doc, C.accent); doc.rect(M.left, y, 48, 1.5, "F");
  y += 10;

  const isDefaultFrais = (m.loanFraisInitiaux ?? 0) === 0 && fraisInitiaux === 0;
  const paramLines: string[] = [[
    `Capital emprunte : ${fmtCurrency(principal)}`,
    `Taux nominal : ${ratePct.toFixed(2)} %${isDefaultRate ? " (hyp.)" : ""}`,
    `Assurance : ${insurancePct.toFixed(2)} % / an${isDefaultInsurance ? " (hyp.)" : ""}`,
  ].join("   |   ")];
  if (!isDefaultFrais && fraisInitiaux > 0)
    paramLines.push(`Frais initiaux (dossier + garantie + courtier) : ${fmtCurrency(fraisInitiaux)}`);
  const paramH = paramLines.length * 5.5 + 6;
  roundedBox(doc, M.left, y, CW, paramH, { fill: C.bg, border: C.border, radius: 3, lw: 0.2 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); sc(doc, C.body);
  paramLines.forEach((line, i) => { doc.text(sanitizeForPdf(line), M.left + 5, y + 5 + i * 5.5); });
  y += paramH + 8;

  const totalW = CW;
  const labelColW = Math.round(totalW * 0.44);
  const valColW   = Math.round((totalW - labelColW) / 3);

  interface RowSpec { label: string; key: keyof LoanScenario; bold?: boolean; highlight?: boolean; }
  const rowSpecs: RowSpec[] = [
    { label: "Mensualite hors assurance",  key: "mensualiteHorsAssurance" },
    { label: "Assurance mensuelle",        key: "assuranceMensuelle" },
    { label: "Mensualite totale",          key: "mensualiteTotale",   bold: true },
    { label: "Interets totaux",            key: "interetsTotaux" },
    { label: "Assurance totale",           key: "assuranceTotale" },
    { label: "Cout total du credit",       key: "coutTotalCredit",    bold: true },
    { label: "Total rembourse",            key: "totalRembourse",     bold: true, highlight: true },
  ];

  const tableBody = rowSpecs.map(r => {
    const isHighlight = !!r.highlight;
    const isBold      = !!r.bold;
    const labelCell = {
      content: sanitizeForPdf(r.label),
      styles: {
        fontStyle: isBold ? "bold" : "normal",
        textColor: isHighlight ? [C.accent[0], C.accent[1], C.accent[2]] : [C.body[0], C.body[1], C.body[2]],
        fillColor: isHighlight ? [C.accentSoft[0], C.accentSoft[1], C.accentSoft[2]] : undefined,
        cellPadding: { top: 3, bottom: 3, left: 4, right: 2 },
      },
    };
    const valCells = scenarios.map(sc2 => ({
      content: sanitizeForPdf(fmtCurrency(sc2[r.key] as number)),
      styles: {
        halign: "right" as const, fontStyle: isBold ? "bold" : "normal",
        fontSize: isHighlight ? 8.5 : 8,
        textColor: isHighlight ? [C.accent[0], C.accent[1], C.accent[2]] : [C.body[0], C.body[1], C.body[2]],
        fillColor: isHighlight ? [C.accentSoft[0], C.accentSoft[1], C.accentSoft[2]] : undefined,
        cellPadding: { top: 3, bottom: 3, left: 2, right: 4 },
      },
    }));
    return [labelCell, ...valCells];
  });

  autoTable(doc, {
    startY: y,
    head: [[
      { content: "Indicateur", styles: { halign: "left"  as const } },
      { content: "10 ans",     styles: { halign: "right" as const } },
      { content: "15 ans",     styles: { halign: "right" as const } },
      { content: "20 ans",     styles: { halign: "right" as const } },
    ]],
    body: tableBody,
    margin: { left: M.left, right: M.right },
    tableWidth: totalW,
    columnStyles: {
      0: { cellWidth: labelColW },
      1: { cellWidth: valColW, halign: "right" as const },
      2: { cellWidth: valColW, halign: "right" as const },
      3: { cellWidth: valColW, halign: "right" as const },
    },
    styles: {
      font: "helvetica", fontSize: 8, cellPadding: 3,
      lineColor: [C.border[0], C.border[1], C.border[2]] as [number,number,number],
      lineWidth: 0.15, textColor: [C.body[0], C.body[1], C.body[2]] as [number,number,number],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [C.primary[0], C.primary[1], C.primary[2]] as [number,number,number],
      textColor: [255, 255, 255] as [number,number,number],
      fontStyle: "bold", fontSize: 8.5, halign: "center",
    },
    alternateRowStyles: { fillColor: [C.bg[0], C.bg[1], C.bg[2]] as [number,number,number] },
  });

  y = (doc as DocWithTable).lastAutoTable.finalY + 10;

  const delta      = scenarios[0].mensualiteTotale - scenarios[2].mensualiteTotale;
  const surcoutTot = scenarios[2].coutTotalCredit  - scenarios[0].coutTotalCredit;
  if (delta > 0 && surcoutTot > 0) {
    if (y + 20 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
    const synthH = 20;
    roundedBox(doc, M.left, y, CW, synthH, { fill: C.bg, border: C.border, radius: 3, lw: 0.2, shadow: true });
    sf(doc, C.accent); doc.roundedRect(M.left, y, 3.5, synthH, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); sc(doc, C.body);
    doc.text(sanitizeForPdf(`Passer de 10 a 20 ans reduit la mensualite de ${fmtCurrency(delta)} / mois`), M.left + 8, y + 7);
    doc.text(sanitizeForPdf(`mais augmente le cout total du credit de ${fmtCurrency(surcoutTot)} sur la duree.`), M.left + 8, y + 13.5);
    y += synthH + 8;
  }

  if (y + 18 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
  const noteText  = "Pour un pret amortissable, les interets sont calcules au fil du temps sur le capital restant du. Une duree plus longue reduit la mensualite mais augmente le cout total du credit.";
  const noteLines = doc.splitTextToSize(sanitizeForPdf(noteText), CW - 14) as string[];
  const noteH     = noteLines.length * 4.2 + 10;
  roundedBox(doc, M.left, y, CW, noteH, { fill: C.white, border: C.border, radius: 3, lw: 0.2 });
  doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); sc(doc, C.muted);
  doc.text(noteLines, M.left + 6, y + 6);
  y += noteH + 6;

  if (isDefaultRate || isDefaultInsurance) {
    if (y + 10 > PH - M.bottom) { doc.addPage(); y = M.top + 12; }
    const hypParts: string[] = [];
    if (isDefaultRate)      hypParts.push(`taux nominal ${ratePct} % (hypothese)`);
    if (isDefaultInsurance) hypParts.push(`assurance ${insurancePct} % / an (hypothese)`);
    const hypTxt = `Valeurs supposees car absentes du dossier : ${hypParts.join(", ")}.`;
    const hypLines = doc.splitTextToSize(sanitizeForPdf(hypTxt), CW) as string[];
    doc.setFont("helvetica", "italic"); doc.setFontSize(6.5); sc(doc, C.warning);
    doc.text(hypLines, M.left, y);
    y += hypLines.length * 4 + 4;
  }
  setY(doc, y);
}

// ═══════════════════════════════════════════════════════════════════
// ─── ORCHESTRATEUR PRINCIPAL ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function buildPdf(snap: MarchandSnapshotV1, opts?: ExportPdfOpts): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFont("helvetica", "normal");

  const m    = extractMetrics(snap, opts);
  const ai   = normalizeAiReport(opts, m);
  const mode = opts?.pdfMode ?? "light";

  buildCover(doc, m, ai, opts);
  buildCommunePage(doc, opts, m);
  buildNarrative(doc, m, ai, opts);
  buildPage1(doc, m, ai, opts);
  buildPage2(doc, m, ai);
  buildPage3(doc, m, ai);
  buildLoanComparison(doc, m);
  buildPage4(doc, m, ai);

  if (mode === "full" || opts?.space === "investisseur") buildSyntheseInstitutionnellePage(doc, snap, opts);
  if (mode === "full") { annexeFiche(doc, ai); annexeDD(doc, ai); }

  finalizeHF(doc, m.titre, true);
  return doc;
}

// ─── Public API ──────────────────────────────────────────────────

export { buildPdf as buildSnapshotPdfDoc };

export function buildSnapshotPdfBlob(snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): Blob {
  return buildPdf(snapshot, opts).output("blob");
}

export function exportSnapshotToPdf(snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const doc = buildPdf(snapshot, opts);
  const d   = resolveDeal(snapshot);
  doc.save(`${sanitizeForPdf(String(d.titre ?? d.title ?? "dossier")).replace(/\s+/g, "_")}_dossier_investisseur.pdf`);
}

export function exportSnapshotToPdfPrint(snapshot: MarchandSnapshotV1, _opts?: ExportPdfOpts): void {
  const doc  = buildPdf(snapshot, _opts);
  const blob = doc.output("blob");
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url);
  if (w) { w.onload = () => { w.print(); URL.revokeObjectURL(url); }; }
}