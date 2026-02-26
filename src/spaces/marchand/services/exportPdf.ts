// src/spaces/marchand/services/exportPdf.ts

import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportPdfOpts {
  space?: "marchand" | "investisseur";
  aiReport?: {
    analysis?: {
      verdict?: string;
      confidence?: number;

      // Legacy
      executiveSummary?: string;
      strengths?: string[];
      vigilances?: string[];
      sensitivities?: string[];
      actionPlan?: string[];
      missingData?: string[];

      // v2.1 director — nouveaux champs (Edge Function)
      marketStatus?: {
        label?: string;
        plainFrench?: string;
        dvfSummary?: {
          nbTransactions?: number | null;
          medianPriceM2?: number | null;
          acquisitionPriceM2?: number | null;
          premiumVsDvfPct?: number | null;
        };
      };

      conclusion?: {
        decisionToday?: string;
        decisionAdvised?: "ACHETER" | "NÉGOCIER" | "ATTENDRE" | "RENOCER" | "INCONNU";
        whyInPlainFrench?: string[];
        whatToDoNow?: string[];
        conditionsToBuy?: string[];
        maxEngagementPriceEur?: number | null;
        neverExceedPriceEur?: number | null;
        afterVerificationDecision?: string;
      };

      finalSummary?: {
        decisionToday?: string;
        decisionAfterDueDiligence?: string;
        maxEngagementPriceEur?: number | null;
        neverExceedPriceEur?: number | null;
        top3ActionsNow?: string[];
        dataToGetBeforeSigning?: string[];
        killSwitches?: string[];
        plan60Days?: {
          week1?: string[];
          weeks2to4?: string[];
          month2?: string[];
        };
        investorChecklist?: string[];
        messageToAgent?: string;
      };

      scenarios?: any[];
    };
    executiveSummary?: string;
    decision?: "GO" | "GO_AVEC_RESERVES" | "NO_GO";
    confidence?: number;
    strengths?: string[];
    redFlags?: string[];
    actionPlan?: string[];
    narrativeMarkdown?: string;
    narrative?: string;
    generatedAt?: string;
  };
  context?: {
    dueDiligence?: {
      report: any;
      computed?: any;
    };
    generatedAt?: string;
    [key: string]: any;
  };
}

// ---------------------------------------------------------------------------
// Normalized AI data
// ---------------------------------------------------------------------------

interface NormalizedAi {
  verdict: string;
  confidencePct: string;
  confidenceRaw: number | null;
  executiveSummary: string;
  strengths: string[];
  vigilances: string[];
  sensitivities: string[];
  actionPlan: string[];
  missingData: string[];
  generatedAt: string;
  narrativeMarkdown: string;

  // Director blocks (v2.1)
  marketPlain: string;
  decisionToday: string;
  decisionAfter: string;
  decisionAdvised: string;
  why: string[];
  whatToDo: string[];
  conditionsToBuy: string[];
  maxEngagementPriceEur: number | null;
  neverExceedPriceEur: number | null;
}

function normalizeAiReport(ai: NonNullable<ExportPdfOpts["aiReport"]>): NormalizedAi | null {
  const a = ai.analysis;

  const marketPlain = sanitizeForPdf(a?.marketStatus?.plainFrench ?? "");
  const c = a?.conclusion;

  const decisionToday = sanitizeForPdf(c?.decisionToday ?? "");
  const decisionAfter = sanitizeForPdf(c?.afterVerificationDecision ?? "");
  const decisionAdvised = sanitizeForPdf(String(c?.decisionAdvised ?? ""));

  const why = [...(c?.whyInPlainFrench ?? [])].map(sanitizeForPdf);
  const whatToDo = [...(c?.whatToDoNow ?? [])].map(sanitizeForPdf);
  const conditionsToBuy = [...(c?.conditionsToBuy ?? [])].map(sanitizeForPdf);

  const maxEngagementPriceEur =
    c?.maxEngagementPriceEur !== undefined && c?.maxEngagementPriceEur !== null && Number.isFinite(Number(c.maxEngagementPriceEur))
      ? Number(c.maxEngagementPriceEur)
      : null;

  const neverExceedPriceEur =
    c?.neverExceedPriceEur !== undefined && c?.neverExceedPriceEur !== null && Number.isFinite(Number(c.neverExceedPriceEur))
      ? Number(c.neverExceedPriceEur)
      : null;

  const rawConf = a?.confidence ?? ai.confidence;
  const confidenceRaw =
    rawConf !== undefined && rawConf !== null && Number.isFinite(Number(rawConf))
      ? Number(rawConf) : null;
  const confidencePct = confidenceRaw !== null ? Math.round(confidenceRaw * 100) + " %" : "";

  const narrativeMarkdown = sanitizeForPdf(ai.narrativeMarkdown ?? ai.narrative ?? "");

  // Extract verdict — try structured first, then parse from narrative
  let verdict = a?.verdict ?? ai.decision ?? "";
  if (!verdict && narrativeMarkdown) {
    const vm = narrativeMarkdown.match(/Verdict\s*:\s*(\S+)/i);
    if (vm) verdict = vm[1].replace(/[.,;:!]$/, "");
  }

  let executiveSummary = a?.executiveSummary ?? ai.executiveSummary ?? "";
  if (!executiveSummary && narrativeMarkdown) {
    const lines = narrativeMarkdown.split("\n").filter(l => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("|"));
    if (lines.length > 0) {
      const firstBlock: string[] = [];
      for (const line of lines) {
        if (firstBlock.length > 0 && line.trim() === "") break;
        firstBlock.push(line.trim());
        if (firstBlock.join(" ").length > 350) break;
      }
      let raw = firstBlock.join(" ");
      if (raw.length > 600) raw = raw.slice(0, 600);
      const lastDot = raw.lastIndexOf(". ");
      if (lastDot > 100) raw = raw.slice(0, lastDot + 1);
      executiveSummary = raw;
    }
  }

  const strengths = [...(a?.strengths ?? ai.strengths ?? [])].map(sanitizeForPdf);
  const vigilances = [...(a?.vigilances ?? ai.redFlags ?? [])].map(sanitizeForPdf);
  const sensitivities = [...(a?.sensitivities ?? [])].map(sanitizeForPdf);
  const actionPlan = [...(a?.actionPlan ?? ai.actionPlan ?? [])].map(sanitizeForPdf);
  let missingData = [...(a?.missingData ?? [])].map(sanitizeForPdf);
  if (narrativeMarkdown && (strengths.length === 0 || vigilances.length === 0)) {
    const extracted = extractFromNarrative(narrativeMarkdown);
    if (strengths.length === 0) strengths.push(...extracted.strengths);
    if (vigilances.length === 0) vigilances.push(...extracted.vigilances);
    if (sensitivities.length === 0) sensitivities.push(...extracted.sensitivities);
    if (actionPlan.length === 0) actionPlan.push(...extracted.actionPlan);
    if (missingData.length === 0) missingData.push(...extracted.missingData);
  }
  // A3: deduplicate case-insensitive + trim
  missingData = deduplicateCaseInsensitive(missingData);

  const generatedAt = ai.generatedAt ?? "";
  const hasContent =
    verdict ||
    executiveSummary ||
    marketPlain ||
    decisionToday ||
    strengths.length > 0 ||
    vigilances.length > 0 ||
    sensitivities.length > 0 ||
    actionPlan.length > 0 ||
    missingData.length > 0 ||
    narrativeMarkdown;
  if (!hasContent) return null;

  return {
    verdict: sanitizeForPdf(verdict),
    confidencePct,
    confidenceRaw,
    executiveSummary: sanitizeForPdf(executiveSummary),
    strengths, vigilances, sensitivities, actionPlan, missingData,
    generatedAt,
    narrativeMarkdown,
    marketPlain,
    decisionToday,
    decisionAfter,
    decisionAdvised,
    why,
    whatToDo,
    conditionsToBuy,
    maxEngagementPriceEur,
    neverExceedPriceEur,
  };
}

// ---------------------------------------------------------------------------
// Smart extraction from narrative markdown
// ---------------------------------------------------------------------------

function extractFromNarrative(md: string): {
  strengths: string[]; vigilances: string[]; sensitivities: string[];
  actionPlan: string[]; missingData: string[]; scores: Record<string, string>;
} {
  const result = { strengths: [] as string[], vigilances: [] as string[], sensitivities: [] as string[], actionPlan: [] as string[], missingData: [] as string[], scores: {} as Record<string, string> };

  const scorePatterns = [
    { key: "SmartScore", re: /SmartScore\s+(\d{1,3})\b/i },
    { key: "OpportunityScore", re: /OpportunityScore[^(\n]{0,30}\((\d{1,3})\b/i },
    { key: "BPE Score", re: /BPE\s+Score[:\s]+(\d{1,3})\b/i },
    { key: "RiskPressureIndex", re: /RiskPressureIndex[^(\n]{0,30}\((\d{1,3})\b/i },
    { key: "RiskPressureIndex", re: /[Pp]ression\s+risque[^.\n]{0,40}?(\d{1,3})\s*(?:\/\s*100|%)/i },
    { key: "Probabilité revente", re: /[Pp]robabilit\u00e9 de revente[^.\n]{0,60}?(\d{1,3})\s*%/i },
    { key: "Complétude", re: /(\d{1,3})\s*%\s*(?:de\s+)?compl\u00e9tude/i },
  ];
  for (const { key, re } of scorePatterns) {
    if (result.scores[key]) continue; // A2: keep first match, don't overwrite
    const m = md.match(re);
    if (m) result.scores[key] = m[1];
  }

  const lines = md.split("\n");
  let currentSection = "";

  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, "").trim();
    if (!line) continue;

    const heading = line.replace(/^#{1,4}\s*/, "").trim().toLowerCase();
    if (/positionnement prix|structure de marge|lecture.*march|dvf/i.test(heading)) currentSection = "market";
    else if (/asym\u00e9trie|capital at risk|capital.*risk/i.test(heading)) currentSection = "risk";
    else if (/risques? majeurs|angles? morts/i.test(heading)) currentSection = "risks";
    else if (/liquidit\u00e9|sortie/i.test(heading)) currentSection = "exit";
    else if (/strat\u00e9gie op\u00e9rationnelle|recommand/i.test(heading)) { currentSection = "action"; continue; }
    else if (/plan b/i.test(heading)) currentSection = "planb";
    else if (/donn\u00e9es.*manquantes|important.*manquant/i.test(heading)) currentSection = "missing";

    const bullet = line.replace(/^[\u2022\-]\s*/, "").trim();
    const isBullet = /^[\u2022\-]\s/.test(line);

    if (isBullet && /CONFORME|solide|correct|r\u00e9silient|liquidit\u00e9 correcte|DVF solide|filet de s\u00e9curit\u00e9/i.test(bullet)) {
      result.strengths.push(bullet);
    }
    if (isBullet && /fragile|insuffisant|critique|quasi-absent|\u00e9rod|d\u00e9favorable|tendu|faible|limite/i.test(bullet)) {
      result.vigilances.push(bullet);
    }
    if (currentSection === "risks" && isBullet) result.sensitivities.push(bullet);
    if (currentSection === "action" && line.length > 10 && !/^#{1,4}\s/.test(line)) {
      result.actionPlan.push(isBullet ? bullet : line);
    }
    if (/manquantes?.*:/i.test(line) || currentSection === "missing") {
      const items = line.match(/(?:Type de bien|\u00c9tat du bien|Dur\u00e9e travaux|Dur\u00e9e d\u00e9tention|D\u00e9lai commercialisation|Prix.*m\u00e9dian)/gi);
      if (items) result.missingData.push(...items);
    }
  }

  result.strengths = [...new Set(result.strengths)].slice(0, 5).map(sanitizeForPdf);
  result.vigilances = [...new Set(result.vigilances)].slice(0, 5).map(sanitizeForPdf);
  result.sensitivities = [...new Set(result.sensitivities)].slice(0, 5).map(sanitizeForPdf);
  result.actionPlan = [...new Set(result.actionPlan)].slice(0, 6).map(sanitizeForPdf);
  result.missingData = deduplicateCaseInsensitive(result.missingData).slice(0, 6).map(sanitizeForPdf);
  return result;
}

// ---------------------------------------------------------------------------
// Narrative parser
// ---------------------------------------------------------------------------

interface NarrativeSection {
  title: string;
  bullets: string[];
  paragraphs: string[];
  table?: { headers: string[]; rows: string[][] };
}

function parseNarrativeSections(md: string): NarrativeSection[] {
  if (!md) return [];
  const lines = md.replace(/\r/g, "").split("\n");
  const sections: NarrativeSection[] = [];
  let current: NarrativeSection | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, "").trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { title: headingMatch[1].trim(), bullets: [], paragraphs: [] };
      continue;
    }
    if (/^[A-Z\u00c0-\u00da\u00c9]/.test(line) && line.length > 3 && line.length < 80 &&
        !/^[\u2022\-|]/.test(line) && !/^Prix|^Marge|^DVF|^\d|HYPOTH\u00c8SE/.test(line)) {
      if (current && (current.bullets.length > 0 || current.paragraphs.length > 0)) sections.push(current);
      current = { title: line, bullets: [], paragraphs: [] };
      continue;
    }
    if (!current) current = { title: "", bullets: [], paragraphs: [] };
    if (line.startsWith("|") && line.endsWith("|")) {
      if (line.includes("---")) continue;
      const cells = line.split("|").filter(c => c.trim()).map(c => c.trim());
      if (!current.table) current.table = { headers: cells, rows: [] };
      else current.table.rows.push(cells);
      continue;
    }
    if (/^[\u2022\-]\s/.test(line)) { current.bullets.push(line.replace(/^[\u2022\-]\s*/, "").trim()); continue; }
    current.paragraphs.push(line);
  }
  if (current) sections.push(current);
  return sections.map(s => ({
    title: sanitizeForPdf(s.title),
    bullets: s.bullets.map(sanitizeForPdf),
    paragraphs: s.paragraphs.map(sanitizeForPdf),
    table: s.table ? {
      headers: s.table.headers.map(sanitizeForPdf),
      rows: s.table.rows.map(r => r.map(sanitizeForPdf)),
    } : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Design Tokens — Modern vivid dashboard
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const C = {
  navy: [15, 23, 42] as RGB, navyMid: [30, 41, 59] as RGB, navyLight: [51, 65, 85] as RGB,
  accent: [99, 102, 241] as RGB, accentLight: [165, 180, 252] as RGB, accentBg: [238, 242, 255] as RGB, accentDark: [67, 56, 202] as RGB,
  slate900: [15, 23, 42] as RGB, slate800: [30, 41, 59] as RGB, slate700: [51, 65, 85] as RGB, slate600: [71, 85, 105] as RGB,
  slate500: [100, 116, 139] as RGB, slate400: [148, 163, 184] as RGB, slate300: [203, 213, 225] as RGB, slate200: [226, 232, 240] as RGB,
  slate100: [241, 245, 249] as RGB, slate50: [248, 250, 252] as RGB, white: [255, 255, 255] as RGB,
  emerald: [16, 185, 129] as RGB, emeraldDark: [6, 95, 70] as RGB, emeraldBg: [236, 253, 245] as RGB, emeraldLight: [167, 243, 208] as RGB,
  amber: [245, 158, 11] as RGB, amberDark: [180, 83, 9] as RGB, amberBg: [255, 251, 235] as RGB, amberLight: [253, 230, 138] as RGB,
  rose: [244, 63, 94] as RGB, roseDark: [159, 18, 57] as RGB, roseBg: [255, 241, 242] as RGB, roseLight: [253, 164, 175] as RGB,
  sky: [14, 165, 233] as RGB, skyDark: [3, 105, 161] as RGB, skyBg: [240, 249, 255] as RGB,
  violet: [139, 92, 246] as RGB, violetBg: [245, 243, 255] as RGB,
  cyan: [6, 182, 212] as RGB, cyanBg: [236, 254, 255] as RGB,
};

const PW = 210; const PH = 297;
const M = { top: 22, right: 18, bottom: 24, left: 18 };
const CW = PW - M.left - M.right;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decisionLabel(d?: string): string {
  const s = (d ?? "").toUpperCase().trim();
  if (s === "GO") return "GO";
  if (/GO_AVEC_RESERVES|GO AVEC RESERVES/.test(s)) return "GO AVEC R\u00c9SERVES";
  if (/GO_AVEC_SECURITE|GO AVEC SECURITE/.test(s)) return "GO SOUS CONDITIONS";
  if (/NO_GO|NO GO|NOGO/.test(s)) return "NO GO";
  if (/securite|reserve/i.test(s)) return "GO SOUS CONDITIONS";
  return d ?? "NON D\u00c9TERMIN\u00c9";
}

function decisionColors(d?: string): { text: RGB; bg: RGB; border: RGB; glow: RGB } {
  if (!d) return { text: C.slate500, bg: C.slate50, border: C.slate300, glow: C.slate200 };
  const s = String(d).toUpperCase();
  if (s === "GO") return { text: C.emeraldDark, bg: C.emeraldBg, border: C.emeraldLight, glow: C.emerald };
  if (/RESERVE|SECURITE/i.test(s)) return { text: C.amberDark, bg: C.amberBg, border: C.amberLight, glow: C.amber };
  if (/NO/i.test(s)) return { text: C.roseDark, bg: C.roseBg, border: C.roseLight, glow: C.rose };
  if (/GO/i.test(s)) return { text: C.emeraldDark, bg: C.emeraldBg, border: C.emeraldLight, glow: C.emerald };
  return { text: C.slate500, bg: C.slate50, border: C.slate300, glow: C.slate200 };
}

function statusColors(status?: string): { text: RGB; bg: RGB } {
  if (!status) return { text: C.slate500, bg: C.slate50 };
  const s = String(status).toLowerCase();
  if (/ok|valid|pass|conforme|vert|green/.test(s)) return { text: C.emeraldDark, bg: C.emeraldBg };
  if (/warn|alerte|attention|orange|yellow/.test(s)) return { text: C.amberDark, bg: C.amberBg };
  if (/critical|critique|fail|ko|rouge|red/.test(s)) return { text: C.roseDark, bg: C.roseBg };
  return { text: C.slate500, bg: C.slate50 };
}

function fmtDate(d = new Date()): string { return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }); }
function fmtDateTime(d = new Date()): string { return d.toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function parseIsoOrNow(iso?: string): Date { if (!iso) return new Date(); const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t) : new Date(); }
function fmtCurrency(val: unknown): string {
  if (val === null || val === undefined || val === "") return "ND";
  const num = Number(val);
  if (!Number.isFinite(num)) return sanitizeForPdf(String(val));
  return sanitizeForPdf(num.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));
}
function fmtNumber(val: unknown): string {
  if (val === null || val === undefined || val === "") return "ND";
  const num = Number(val);
  if (!Number.isFinite(num)) return sanitizeForPdf(String(val));
  return sanitizeForPdf(num.toLocaleString("fr-FR"));
}
function fmtPercent(val: unknown, decimals = 1): string {
  if (val === null || val === undefined || val === "") return "ND";
  const num = Number(val);
  if (!Number.isFinite(num)) return sanitizeForPdf(String(val));
  return sanitizeForPdf(num.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + " %");
}
function ndIfZero(v: unknown, treatZeroAsMissing = false): string { if (v === null || v === undefined || v === "") return "ND"; const n = Number(v); if (!Number.isFinite(n)) return String(v); if (treatZeroAsMissing && n === 0) return "ND"; return String(v); }

/** Shorthand: sanitize any string before passing to doc.text() */
function S(text: string): string { return sanitizeForPdf(text); }

/**
 * Sanitize text for jsPDF Helvetica (WinAnsiEncoding / Windows-1252).
 */
function sanitizeForPdf(text: string): string {
  return text
    .replace(/[\u202f\u00a0\u2007\u2009\u200a\u2006]/g, " ")
    .replace(/[\u2000-\u2005\u2008\u200b\u2060\ufeff]/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[\u2192\u2794\u279c\u27a1\u21d2]/g, ">")
    .replace(/\u2190/g, "<")
    .replace(/\u2194/g, "<>")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u2260/g, "!=")
    .replace(/\u2248/g, "~")
    .replace(/\u221e/g, "inf.")
    .replace(/[\u2500-\u257f]/g, "-")
    .replace(/[\u2580-\u259f]/g, "")
    .replace(/[\u25a0-\u25ff]/g, "*")
    .replace(/[\u2600-\u26ff]/g, "")
    .replace(/[\u2700-\u27bf]/g, "")
    .replace(/[\u{1f000}-\u{1ffff}]/gu, "")
    .replace(/[\u{fe00}-\u{fe0f}]/gu, "")
    .replace(/[\u0300-\u036f]/g, "");
}

// ---------------------------------------------------------------------------
// Deduplication & verdict helpers
// ---------------------------------------------------------------------------

/** Deduplicate strings case-insensitive, preserving first occurrence */
function deduplicateCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}

/**
 * A1: Sanitize verdict-like tokens in free-text prose.
 * Replaces raw verdict codes with human-readable equivalents
 * so text never displays "NO_GO/SÉCURITÉ" when verdict is "GO SOUS CONDITIONS".
 */
function sanitizeVerdictInProse(text: string): string {
  return text
    .replace(/\bNO_GO\b/g, "NO GO")
    .replace(/\bGO_AVEC_RESERVES\b/gi, "GO avec r\u00e9serves")
    .replace(/\bGO_AVEC_SECURITE\b/gi, "GO sous conditions")
    .replace(/\bNO.?GO\s*[/\u2014]\s*S[EÉ]CURIT[EÉ]\b/gi, "zone de prudence renforc\u00e9e")
    .replace(/\bNO.?GO\s*[/\u2014]\s*R[EÉ]SERVES?\b/gi, "GO avec s\u00e9curisation obligatoire");
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function roundedBox(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fill?: RGB, stroke?: RGB, lineW = 0.3): void {
  if (fill) doc.setFillColor(...fill);
  if (stroke) { doc.setDrawColor(...stroke); doc.setLineWidth(lineW); }
  doc.roundedRect(x, y, w, h, r, r, fill && stroke ? "FD" : fill ? "F" : "S");
}
function ensureSpace(doc: jsPDF, y: number, needed: number): number { if (y + needed > PH - M.bottom) { doc.addPage(); return M.top + 4; } return y; }

function progressBar(doc: jsPDF, x: number, y: number, w: number, h: number, pct: number, color: RGB, bgColor: RGB = C.slate200): void {
  doc.setFillColor(...bgColor); doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");
  const fw = Math.max(h, Math.min(w, w * pct));
  doc.setFillColor(...color); doc.roundedRect(x, y, fw, h, h / 2, h / 2, "F");
}

function arcScore(doc: jsPDF, cx: number, cy: number, radius: number, score: number, maxScore: number, color: RGB, label: string): void {
  const pct = Math.min(score / maxScore, 1);
  const totalSteps = 40;
  const startAngle = Math.PI * 0.75; const endAngle = Math.PI * 2.25; const arcLen = endAngle - startAngle;
  doc.setDrawColor(...C.slate200); doc.setLineWidth(2);
  for (let i = 0; i < totalSteps; i++) {
    const a1 = startAngle + (i / totalSteps) * arcLen; const a2 = startAngle + ((i + 1) / totalSteps) * arcLen;
    doc.line(cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), cx + radius * Math.cos(a2), cy + radius * Math.sin(a2));
  }
  const filledSteps = Math.round(pct * totalSteps);
  doc.setDrawColor(...color); doc.setLineWidth(2.8);
  for (let i = 0; i < filledSteps; i++) {
    const a1 = startAngle + (i / totalSteps) * arcLen; const a2 = startAngle + ((i + 1) / totalSteps) * arcLen;
    doc.line(cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), cx + radius * Math.cos(a2), cy + radius * Math.sin(a2));
  }
  doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.setTextColor(...color);
  doc.text(String(score), cx, cy + 1, { align: "center" });
  doc.setFontSize(4.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate500);
  doc.text(S(label.toUpperCase()), cx, cy + 5.5, { align: "center" });
}

function scoreColor(score: number, max = 100): RGB {
  const pct = score / max;
  if (pct >= 0.7) return C.emerald; if (pct >= 0.4) return C.amber; return C.rose;
}

// ---------------------------------------------------------------------------
// KPI Card with gauge
// ---------------------------------------------------------------------------

function kpiCard(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string,
  opts?: { color?: RGB; gauge?: number; gaugeMax?: number; subtext?: string; highlight?: boolean }): void {
  const color = opts?.color ?? C.accent;
  roundedBox(doc, x, y, w, h, 2.5, opts?.highlight ? C.accentBg : C.white, C.slate200, 0.2);
  doc.setFillColor(...color); doc.rect(x + 4, y, w - 8, 1, "F");
  doc.setFontSize(5.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate400);
  doc.text(S(label.toUpperCase()), x + w / 2, y + 7, { align: "center" });
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate900);
  doc.text(S(value), x + w / 2, y + 14.5, { align: "center" });
  if (opts?.gauge !== undefined && opts?.gaugeMax) {
    progressBar(doc, x + 6, y + h - 5, w - 12, 2, Math.min(opts.gauge / opts.gaugeMax, 1), color);
  }
  if (opts?.subtext) { doc.setFontSize(4.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate500); doc.text(S(opts.subtext), x + w / 2, y + h - 1.5, { align: "center" }); }
}

// ---------------------------------------------------------------------------
// Section titles
// ---------------------------------------------------------------------------

function sectionTitle(doc: jsPDF, y: number, title: string, subtitle?: string): number {
  y = ensureSpace(doc, y, 18); y += 3;
  doc.setFillColor(...C.accent); doc.roundedRect(M.left, y, 4, 1.2, 0.6, 0.6, "F");
  y += 7;
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate900);
  doc.text(title, M.left, y);
  if (subtitle) { doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate400); doc.text(subtitle, PW - M.right, y, { align: "right" }); }
  y += 3; doc.setDrawColor(...C.slate200); doc.setLineWidth(0.2); doc.line(M.left, y, PW - M.right, y);
  return y + 5;
}

// ---------------------------------------------------------------------------
// Header / Footer
// ---------------------------------------------------------------------------

function addHeaderFooter(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const total = doc.getNumberOfPages();
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const dealId = deal?.id ?? "\u2014"; const title = (deal?.title ?? "").trim();
  const subtitle = title ? `${dealId} \u2014 ${title}` : dealId;
  const generatedAt = opts?.aiReport?.generatedAt ?? opts?.context?.generatedAt ?? new Date().toISOString();
  const ts = fmtDateTime(parseIsoOrNow(generatedAt));
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    doc.setFillColor(...C.accent); doc.rect(M.left, 11.5, CW, 0.4, "F");
    doc.setFontSize(6); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.accent); doc.text("MIMMOZA", M.left, 9.5);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate400);
    doc.text("Dossier Investisseur  |  " + subtitle, M.left + 18, 9.5);
    doc.text(ts, PW - M.right, 9.5, { align: "right" });
    doc.setFillColor(...C.slate50); doc.rect(0, PH - 12, PW, 12, "F");
    doc.setDrawColor(...C.slate200); doc.setLineWidth(0.2); doc.line(M.left, PH - 12, PW - M.right, PH - 12);
    doc.setFontSize(5.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate400);
    doc.text("CONFIDENTIEL \u2014 Document d'aide \u00e0 la d\u00e9cision \u2014 Usage investisseur / banque", M.left, PH - 6);
    doc.text(`${i - 1} / ${total - 1}`, PW - M.right, PH - 6, { align: "right" });
  }
}

// ---------------------------------------------------------------------------
// COVER
// ---------------------------------------------------------------------------

function buildCoverPage(doc: jsPDF, snapshot: MarchandSnapshotV1): void {
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const title = deal?.title ?? "Sans titre"; const dealId = deal?.id ?? "-";
  const city = (deal as any)?.city ?? ""; const zip = (deal as any)?.zipCode ?? (deal as any)?.codePostal ?? "";
  const status = deal?.status ?? ""; const address = (deal as any)?.address ?? "";

  doc.setFillColor(...C.navy); doc.rect(0, 0, PW, PH, "F");

  doc.setDrawColor(35, 48, 75); doc.setLineWidth(0.6);
  doc.circle(PW + 10, -15, 65, "S"); doc.circle(PW + 10, -15, 50, "S");
  doc.circle(-25, PH + 5, 45, "S"); doc.circle(PW - 35, PH - 50, 35, "S");
  doc.setDrawColor(40, 55, 85); doc.setLineWidth(0.3);
  doc.line(PW - 80, 0, PW, 80); doc.line(PW - 60, 0, PW, 60);

  const steps = 80; const stepH = PH / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    doc.setFillColor(Math.round(99 - t * 50), Math.round(102 - t * 30), Math.round(241 - t * 20));
    doc.rect(0, i * stepH, 4, stepH + 0.5, "F");
  }

  const lx = 28; const ly = 48;
  doc.setFillColor(...C.accent); doc.roundedRect(lx, ly, 7, 7, 1.5, 1.5, "F");
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.accentLight); doc.text("M I M M O Z A", lx + 12, ly + 5);

  doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.accent); doc.text("RAPPORT CONFIDENTIEL", lx, ly + 18);
  doc.setFillColor(...C.accent); doc.rect(lx, ly + 22, 30, 0.4, "F");

  const ty = ly + 38;
  doc.setFontSize(38); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.white);
  doc.text("Dossier", lx, ty); doc.text("Investisseur", lx, ty + 16);

  const divY = ty + 26;
  doc.setFillColor(...C.accent); doc.rect(lx, divY, 28, 1.5, "F");
  doc.setFillColor(...C.accentLight); doc.rect(lx + 28, divY, 18, 1.5, "F");
  doc.setFillColor(80, 85, 200); doc.rect(lx + 46, divY, 10, 1.5, "F");

  doc.setFontSize(15); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.white); doc.text(S(title), lx, divY + 14);
  let nextY = divY + 22;
  if (address && address !== title) { doc.setFontSize(10); doc.setTextColor(...C.slate400); doc.text(S(address), lx, nextY); nextY += 7; }
  const locLine = [zip, city].filter(Boolean).join(" ");
  if (locLine) { doc.setFontSize(10); doc.setTextColor(...C.slate400); doc.text(S(locLine), lx, nextY); }

  const metaY = PH - 85;
  const metas: { label: string; value: string; color: RGB }[] = [
    { label: "R\u00c9F\u00c9RENCE", value: dealId, color: C.accent },
    { label: "STATUT", value: status || "\u2014", color: C.sky },
    { label: "DATE", value: fmtDate(), color: C.violet },
  ];
  const cardW = (CW - (metas.length - 1) * 5) / metas.length;
  metas.forEach((meta, idx) => {
    const cx = lx + idx * (cardW + 5);
    doc.setFillColor(22, 30, 50); doc.roundedRect(cx, metaY, cardW, 28, 2.5, 2.5, "F");
    doc.setFillColor(...meta.color); doc.rect(cx + 6, metaY, cardW - 12, 1, "F");
    doc.setFontSize(5.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate400); doc.text(S(meta.label), cx + 8, metaY + 11);
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.white); doc.text(S(meta.value), cx + 8, metaY + 20);
  });

  doc.setFillColor(8, 14, 28); doc.rect(0, PH - 16, PW, 16, "F");
  doc.setDrawColor(35, 48, 70); doc.setLineWidth(0.3); doc.line(0, PH - 16, PW, PH - 16);
  doc.setFontSize(6); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate500);
  doc.text("CONFIDENTIEL \u2014 Document r\u00e9serv\u00e9 aux investisseurs et organismes financiers", lx, PH - 8);
  doc.text("mimmoza.fr", PW - M.right, PH - 8, { align: "right" });
}

// ---------------------------------------------------------------------------
// Helper: extract deal metrics used across multiple pages
// ---------------------------------------------------------------------------

interface DealMetrics {
  prixAchat: number;
  surfaceM2: number;
  prixRevente: number;
  travaux: number;
  margeNette: number;
  rentabilite: number;
  prixM2: number | null;
  margeBrute: number | null;
  fraisNotaire: number;
  cushion: number | null;
  premiumVsDvfPct: number | null;
  capitalEngage: number | null;
}

function extractDealMetrics(snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): DealMetrics {
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const d: any = deal ?? {};

  const prixAchat = Number(d.prixAchat ?? d.price ?? 0);
  const surfaceM2 = Number(d.surfaceM2 ?? d.surface ?? 0);
  const prixRevente = Number(d.prixReventeCible ?? d.prixVenteEstime ?? d.prixVente ?? 0);
  const travaux = Number(d.travauxEstimes ?? d.montantTravaux ?? d.travaux ?? 0);
  const margeNette = Number(d.margeNette ?? 0);
  const rentabilite = Number(d.rentabilite ?? d.rendementBrut ?? d.rendement ?? 0);
  const fraisNotaire = Number(d.fraisNotaire ?? 0);

  const prixM2 = surfaceM2 > 0 && prixAchat > 0 ? Math.round((prixAchat / surfaceM2) * 10) / 10 : null;
  const margeBrute = prixRevente > 0 && prixAchat > 0 ? ((prixRevente - prixAchat) / prixAchat * 100) : null;

  // Cushion : marge brute AU-DESSUS du seuil Mimmoza (12%)
  // Ex: marge brute 12,9% → cushion = 0,9 pts
  const SEUIL_MIMMOZA = 12;
  const capitalEngage = prixAchat > 0 ? prixAchat + fraisNotaire + travaux : null;
  const cushion = margeBrute != null ? margeBrute - SEUIL_MIMMOZA : null;

  // Premium vs DVF
  const premiumVsDvfPct = opts?.aiReport?.analysis?.marketStatus?.dvfSummary?.premiumVsDvfPct ?? null;

  return { prixAchat, surfaceM2, prixRevente, travaux, margeNette, rentabilite, prixM2, margeBrute, fraisNotaire, cushion, premiumVsDvfPct, capitalEngage };
}

// ---------------------------------------------------------------------------
// Investisseur scores: Rentabilité & Robustesse
// ---------------------------------------------------------------------------

interface InvestisseurScores {
  rentabilite: number | null;   // 0–100 or null (ND)
  robustesse: number | null;    // 0–100 or null (ND)
}

/**
 * Score Rentabilité (0–100)
 * Piliers : marge brute (50%), cushion vs seuil 12% (25%), résistance stress revente -5% (25%).
 * ND si < 2 piliers calculables.
 */
function computeScoreRentabilite(metrics: DealMetrics): number | null {
  let signals = 0;
  let totalWeight = 0;
  let weightedSum = 0;

  // Pilier 1 : Marge brute → 50%
  if (metrics.margeBrute != null) {
    signals++;
    const w = 50;
    // 0% → 0, 6% → 25, 12% → 50, 20% → 80, >=25% → 100
    const val = Math.min(Math.max(metrics.margeBrute / 25 * 100, 0), 100);
    totalWeight += w;
    weightedSum += val * w;
  }

  // Pilier 2 : Cushion vs seuil 12% → 25%
  if (metrics.cushion != null) {
    signals++;
    const w = 25;
    // cushion < -5 → 0, 0 → 40, 3 → 65, 8 → 100
    const val = Math.min(Math.max((metrics.cushion + 5) / 13 * 100, 0), 100);
    totalWeight += w;
    weightedSum += val * w;
  }

  // Pilier 3 : Résistance stress revente -5% → 25%
  if (metrics.prixRevente > 0 && metrics.prixAchat > 0) {
    signals++;
    const w = 25;
    const newRevente = metrics.prixRevente * 0.95;
    const totalCost = metrics.prixAchat + metrics.fraisNotaire + metrics.travaux;
    const stressMarge = totalCost > 0 ? ((newRevente - totalCost) / totalCost) * 100 : 0;
    // stressMarge < 0 → 0, 5% → 40, 12% → 80, >=18% → 100
    const val = Math.min(Math.max(stressMarge / 18 * 100, 0), 100);
    totalWeight += w;
    weightedSum += val * w;
  }

  if (signals < 2) return null;
  return Math.round(weightedSum / totalWeight);
}

/**
 * Score Robustesse (0–100)
 * Piliers : surcote vs DVF (30%), données manquantes critiques (25%),
 * durée détention vs cible 18 mois (15%), cushion (30%).
 * Pénalisation prudente si donnée absente.
 * ND si < 2 piliers avec données réelles.
 */
function computeScoreRobustesse(metrics: DealMetrics, ai: NormalizedAi | null, snapshot: MarchandSnapshotV1): number | null {
  let signals = 0;
  let totalWeight = 0;
  let weightedSum = 0;

  // Pilier 1 : Surcote vs DVF → 30%
  if (metrics.premiumVsDvfPct != null) {
    signals++;
    const w = 30;
    // -10% (discount) → 100, 0% → 75, 10% → 40, 20% → 10, >=30% → 0
    const val = Math.min(Math.max(100 - (metrics.premiumVsDvfPct + 10) * (100 / 40), 0), 100);
    totalWeight += w;
    weightedSum += val * w;
  } else {
    // Pénalisation prudente : 35/100
    totalWeight += 30;
    weightedSum += 35 * 30;
  }

  // Pilier 2 : Données manquantes critiques → 25%
  {
    const w = 25;
    const missingCount = ai?.missingData?.length ?? 0;
    if (ai) {
      signals++;
      // 0 manquantes → 100, 1 → 80, 2 → 55, 3 → 35, 4 → 20, >=5 → 5
      const val = Math.min(Math.max(100 - missingCount * 20, 5), 100);
      totalWeight += w;
      weightedSum += val * w;
    } else {
      // Pas d'IA → pénalisation prudente 30/100
      totalWeight += w;
      weightedSum += 30 * w;
    }
  }

  // Pilier 3 : Durée détention vs cible 18 mois → 15%
  {
    const deal: any = snapshot.deals.find((d) => d.id === snapshot.activeDealId) ?? {};
    const dureeDetention = Number(deal.dureeDetention ?? deal.holdingPeriodMonths ?? 0);
    const w = 15;
    if (dureeDetention > 0) {
      signals++;
      // <= 12 mois → 100, 18 mois → 70, 24 mois → 45, 36 mois → 15, >=48 → 0
      const val = Math.min(Math.max(100 - (dureeDetention - 12) * (100 / 36), 0), 100);
      totalWeight += w;
      weightedSum += val * w;
    } else {
      // Pénalisation prudente : on suppose 24 mois → 45
      totalWeight += w;
      weightedSum += 45 * w;
    }
  }

  // Pilier 4 : Cushion → 30%
  if (metrics.cushion != null) {
    signals++;
    const w = 30;
    // cushion < -5 → 0, 0 → 40, 3 → 65, 8 → 100
    const val = Math.min(Math.max((metrics.cushion + 5) / 13 * 100, 0), 100);
    totalWeight += w;
    weightedSum += val * w;
  } else {
    // Pénalisation prudente : 25/100
    totalWeight += 30;
    weightedSum += 25 * 30;
  }

  if (signals < 2) return null;
  return Math.round(weightedSum / totalWeight);
}

// ---------------------------------------------------------------------------
// B3: Data Confidence (0–100)
// ---------------------------------------------------------------------------

function computeDataConfidence(
  metrics: DealMetrics,
  ai: NormalizedAi | null,
  scores: Record<string, string>,
  snapshot: MarchandSnapshotV1,
): number {
  // base = complétude% if available, else 60
  let base = scores["Compl\u00e9tude"] ? Number(scores["Compl\u00e9tude"]) : 60;

  // -10 per critical missing data (cap -30)
  const criticalMissing = ai?.missingData?.length ?? 0;
  base -= Math.min(criticalMissing * 10, 30);

  // -10 if travaux ND
  if (metrics.travaux === 0) base -= 10;

  // -10 if durées ND
  const deal: any = snapshot.deals.find((d) => d.id === snapshot.activeDealId) ?? {};
  const duree = Number(deal.dureeDetention ?? deal.holdingPeriodMonths ?? 0);
  if (duree === 0) base -= 10;

  return Math.max(0, Math.min(100, Math.round(base)));
}

function dataConfidenceLabel(dc: number): string {
  if (dc >= 75) return "\u00c9lev\u00e9e";
  if (dc >= 50) return "Moyenne";
  return "Faible";
}

// ---------------------------------------------------------------------------
// B1: Risk Class A / B / C / D
// ---------------------------------------------------------------------------

interface RiskClassResult { cls: string; label: string; subtext: string; color: RGB; bg: RGB }

function computeRiskClass(
  smartScore: number | null,
  robustesse: number | null,
  rentabilite: number | null,
  dataConfidence: number | null,
): RiskClassResult {
  const ss = smartScore ?? 0;
  const rob = robustesse ?? 0;
  const rent = rentabilite ?? 0;
  const dc = dataConfidence;

  const hasMinData = smartScore != null || robustesse != null;
  if (!hasMinData) return { cls: "ND", label: "ND", subtext: "Donn\u00e9es insuffisantes", color: C.slate500, bg: C.slate50 };

  if (ss >= 70 && rob >= 65 && rent >= 60 && (dc == null || dc >= 75)) {
    return { cls: "A", label: "A \u2014 Robuste", subtext: "Robuste", color: C.emeraldDark, bg: C.emeraldBg };
  }
  if (ss >= 60 && rob >= 55) {
    return { cls: "B", label: "B \u2014 Viable", subtext: "Viable", color: C.skyDark, bg: C.skyBg };
  }
  if (ss >= 45 && rob >= 40) {
    return { cls: "C", label: "C \u2014 Fragile", subtext: "Fragile (s\u00e9curisation obligatoire)", color: C.amberDark, bg: C.amberBg };
  }
  return { cls: "D", label: "D \u2014 Risque \u00e9lev\u00e9", subtext: "Risque \u00e9lev\u00e9 (NO GO probable)", color: C.roseDark, bg: C.roseBg };
}

// ---------------------------------------------------------------------------
// B2: Profil investisseur cible
// ---------------------------------------------------------------------------

interface InvestorProfileResult { profil: string; horizon: string; tolerance: string; strategie: string }

function computeInvestorProfile(
  robustesse: number | null,
  liquidite: number | null,
  duree: number,
  cushion: number | null,
): InvestorProfileResult {
  const rob = robustesse ?? 50;
  const liq = liquidite ?? 50;

  let profil = "Marchand exp\u00e9riment\u00e9";
  let tolerance = "Moyenne";
  if (rob >= 65 && (cushion ?? 0) >= 3) {
    profil = "Patrimonial prudent";
    tolerance = "Faible";
  } else if (rob < 40) {
    profil = "Investisseur opportuniste";
    tolerance = "\u00c9lev\u00e9e";
  }

  let horizon = "Court (<18 mois)";
  if (duree > 24) horizon = "Long";
  else if (duree > 18) horizon = "Moyen";

  let strategie = "Revente";
  if (liq < 40) strategie = "Location (plan B)";
  else if (liq < 60 && rob < 55) strategie = "Mix";

  return { profil, horizon, tolerance, strategie };
}

// ---------------------------------------------------------------------------
// PAGE 1: DÉCISION & SYNTHÈSE
// ---------------------------------------------------------------------------

function buildDecisionSynthesePage(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const space = opts?.space ?? "marchand";
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const ai = opts?.aiReport ? normalizeAiReport(opts.aiReport) : null;
  const narrative = sanitizeForPdf(opts?.aiReport?.narrativeMarkdown ?? opts?.aiReport?.narrative ?? "");
  const scores = narrative ? extractFromNarrative(narrative).scores : {};
  const metrics = extractDealMetrics(snapshot, opts);

  const dealId = deal?.id ?? "\u2014"; const title = deal?.title ?? "Sans titre";
  const city = (deal as any)?.city ?? "\u2014"; const zip = (deal as any)?.zipCode ?? (deal as any)?.codePostal ?? "\u2014";
  const address = (deal as any)?.address ?? "\u2014";

  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, "D\u00e9cision & Synth\u00e8se", "D\u00e9cision en 30 secondes");

  // ── Identity row ─────────────────────────────────────────────────────────
  const identH = 18;
  roundedBox(doc, M.left, y, CW, identH, 3, C.white, C.slate200, 0.2);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C.slate900);
  doc.text(S(`${dealId}  \u2014  ${title}`), M.left + 5, y + 7);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate500);
  doc.text(S([address, zip, city].filter(Boolean).join(", ")), M.left + 5, y + 13);

  // ── Verdict badge (right-aligned) ────────────────────────────────────────
  const verdict = ai?.verdict ?? "";
  const dc = decisionColors(verdict);
  const badgeW = 58; const bx = PW - M.right - badgeW - 3; const by = y + 1;
  roundedBox(doc, bx, by, badgeW, 16, 3, dc.bg, dc.border, 0.6);
  doc.setFillColor(...dc.glow); doc.rect(bx, by + 2, 2, 12, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...dc.text);
  doc.text(decisionLabel(verdict || undefined), bx + badgeW / 2 + 1, by + 8, { align: "center" });
  if (ai?.confidencePct) { doc.setFontSize(6); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate500); doc.text(`Confiance ${ai.confidencePct}`, bx + badgeW / 2 + 1, by + 13, { align: "center" }); }

  y += identH + 4;

  // ── Score gauges ─────────────────────────────────────────────────────────
  // Investisseur mode: 6 gauges (4 core + Rentabilité + Robustesse)
  // Marchand mode: 4 gauges (unchanged)
  const coreGauges: { key: string; label: string; max: number; invertColor?: boolean }[] = [
    { key: "SmartScore", label: "SMARTSCORE", max: 100 },
    { key: "Probabilit\u00e9 revente", label: "LIQUIDIT\u00c9", max: 100 },
    { key: "RiskPressureIndex", label: "PRESSION RISQUE", max: 100, invertColor: true },
    { key: "OpportunityScore", label: "OPPORTUNITY", max: 100 },
  ];

  let invScores: InvestisseurScores | null = null;
  if (space === "investisseur") {
    invScores = {
      rentabilite: computeScoreRentabilite(metrics),
      robustesse: computeScoreRobustesse(metrics, ai, snapshot),
    };
    coreGauges.push(
      { key: "__ScoreRentabilite", label: "RENTABILIT\u00c9", max: 100 },
      { key: "__ScoreRobustesse", label: "ROBUSTESSE", max: 100 },
    );
  }

  const gc = coreGauges.length;
  const gh = 30;
  const gw = (CW - (gc - 1) * 3) / gc;
  roundedBox(doc, M.left, y, CW, gh, 3, C.slate50, C.slate200, 0.2);
  coreGauges.forEach((g, i) => {
    const gx = M.left + i * (gw + 3);

    // Resolve value: special keys for investisseur scores, else from narrative
    let val = 0;
    let hasVal = false;
    if (g.key === "__ScoreRentabilite" && invScores) {
      hasVal = invScores.rentabilite != null;
      val = invScores.rentabilite ?? 0;
    } else if (g.key === "__ScoreRobustesse" && invScores) {
      hasVal = invScores.robustesse != null;
      val = invScores.robustesse ?? 0;
    } else {
      hasVal = !!scores[g.key];
      val = scores[g.key] ? Number(scores[g.key]) : 0;
    }

    if (hasVal) {
      const color = g.invertColor ? scoreColor(100 - val) : scoreColor(val);
      arcScore(doc, gx + gw / 2, y + 16, 8, val, g.max, color, g.label);
    } else {
      // Show ND gauge
      doc.setDrawColor(...C.slate200); doc.setLineWidth(2);
      const cx = gx + gw / 2; const cy = y + 16; const radius = 8;
      const startAngle = Math.PI * 0.75; const endAngle = Math.PI * 2.25; const arcLen = endAngle - startAngle;
      for (let j = 0; j < 40; j++) {
        const a1 = startAngle + (j / 40) * arcLen; const a2 = startAngle + ((j + 1) / 40) * arcLen;
        doc.line(cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), cx + radius * Math.cos(a2), cy + radius * Math.sin(a2));
      }
      doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate400);
      doc.text("ND", cx, cy + 1, { align: "center" });
      doc.setFontSize(4.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate500);
      doc.text(S(g.label), cx, cy + 5.5, { align: "center" });
    }
  });
  y += gh + 4;

  // ── Bloc pédagogique : Comment lire ces scores ? ─────────────────────────
  const scoreExplanations: [string, string][] = [
    ["SmartScore", "Note globale du deal (0\u2013100). > 65 = solide, 40\u201365 = \u00e0 surveiller, < 40 = risqu\u00e9."],
    ["Liquidit\u00e9", "Probabilit\u00e9 de revendre dans un d\u00e9lai raisonnable. > 60 = march\u00e9 fluide, < 40 = revente difficile."],
    ["Pression risque", "Cumul des facteurs d\u00e9favorables (0\u2013100). > 60 = danger, < 35 = risque ma\u00eetris\u00e9. Plus c'est bas, mieux c'est."],
    ["Opportunity", "Potentiel de surperformance du deal. > 65 = belle opportunit\u00e9, < 40 = peu d'upside."],
  ];
  if (space === "investisseur") {
    scoreExplanations.push(
      ["Rentabilit\u00e9", "Capacit\u00e9 du deal \u00e0 g\u00e9n\u00e9rer du profit (0\u2013100). > 65 = rentable, 40\u201365 = fragile, < 40 = non viable."],
      ["Robustesse", "R\u00e9sistance du deal aux al\u00e9as (0\u2013100). > 65 = solide, 40\u201365 = vuln\u00e9rable, < 40 = fragile."],
    );
  }

  // Dynamically compute pedagH based on number of explanations
  const pedagRows = Math.ceil(scoreExplanations.length / 2);
  const pedagH = 10 + pedagRows * 8;
  y = ensureSpace(doc, y, pedagH + 4);
  roundedBox(doc, M.left, y, CW, pedagH, 2.5, C.slate50, C.slate200, 0.15);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 1, 2, pedagH - 2, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
  doc.text("Comment lire ces scores ?", M.left + 6, y + 5);

  let py = y + 9;
  const colW = (CW - 14) / 2;
  scoreExplanations.forEach(([ name, desc ], idx) => {
    const col = idx % 2;
    const px = M.left + 6 + col * (colW + 4);
    if (idx > 0 && idx % 2 === 0) py += 8; // new row
    doc.setFont("helvetica", "bold"); doc.setFontSize(6); doc.setTextColor(...C.slate800);
    doc.text(S(name), px, py);
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.5); doc.setTextColor(...C.slate600);
    const dl = doc.splitTextToSize(S(desc), colW - 2);
    doc.text(dl, px, py + 3);
  });
  y += pedagH + 4;

  // ── KPI cards — Row 1: Prix achat, Surface, Prix/m², Revente cible ──────
  const kpiW = (CW - 9) / 4; const kpiH = 24;
  kpiCard(doc, M.left, y, kpiW, kpiH, "Prix d'acquisition", fmtCurrency(metrics.prixAchat || null), { color: C.accent });
  kpiCard(doc, M.left + kpiW + 3, y, kpiW, kpiH, "Surface", metrics.surfaceM2 > 0 ? `${fmtNumber(metrics.surfaceM2)} m\u00b2` : "ND", { color: C.sky });
  kpiCard(doc, M.left + (kpiW + 3) * 2, y, kpiW, kpiH, "Prix / m\u00b2", metrics.prixM2 != null ? `${fmtNumber(metrics.prixM2)} \u20ac/m\u00b2` : "ND", { color: C.violet });
  kpiCard(doc, M.left + (kpiW + 3) * 3, y, kpiW, kpiH, "Revente cible", fmtCurrency(metrics.prixRevente || null), { color: C.emerald });
  y += kpiH + 3;

  // ── KPI cards — Row 2: Marge brute, Cushion, Surcote DVF, Travaux ───────
  const mb = metrics.margeBrute;
  kpiCard(doc, M.left, y, kpiW, kpiH, "Marge brute", mb != null ? fmtPercent(mb) : "ND",
    { color: mb != null && mb >= 12 ? C.emerald : C.amber, highlight: mb != null && mb >= 12, gauge: mb ?? undefined, gaugeMax: 30, subtext: mb != null ? (mb >= 12 ? "Seuil 12% : OK" : "Sous seuil 12%") : undefined });
  kpiCard(doc, M.left + kpiW + 3, y, kpiW, kpiH, "Cushion vs seuil", metrics.cushion != null ? fmtPercent(metrics.cushion, 1) + " pts" : "ND",
    { color: metrics.cushion != null ? (metrics.cushion >= 3 ? C.emerald : metrics.cushion >= 0 ? C.amber : C.rose) : C.slate500,
      subtext: metrics.cushion != null ? (metrics.cushion >= 3 ? "Buffer confortable" : metrics.cushion >= 0 ? "Buffer juste" : "Sous seuil 12%") : "Marge brute manquante" });
  kpiCard(doc, M.left + (kpiW + 3) * 2, y, kpiW, kpiH, "Surcote vs DVF", metrics.premiumVsDvfPct != null ? fmtPercent(metrics.premiumVsDvfPct) : "ND",
    { color: metrics.premiumVsDvfPct != null ? (metrics.premiumVsDvfPct <= 0 ? C.emerald : metrics.premiumVsDvfPct <= 10 ? C.amber : C.rose) : C.slate500,
      subtext: metrics.premiumVsDvfPct != null ? (metrics.premiumVsDvfPct <= 0 ? "Discount" : metrics.premiumVsDvfPct <= 10 ? "L\u00e9g\u00e8re surcote" : "Surcote \u00e9lev\u00e9e") : undefined });
  kpiCard(doc, M.left + (kpiW + 3) * 3, y, kpiW, kpiH, "Travaux estim\u00e9s", metrics.travaux > 0 ? fmtCurrency(metrics.travaux) : "ND", { color: C.slate600 });
  y += kpiH + 5;

  // ── Résumé exécutif (UNIQUE — pas de doublon dans le PDF) ────────────────
  // A1: sanitize raw verdict codes in AI-generated prose
  const directorLine = ai?.decisionToday?.trim() ? `D\u00e9cision conseill\u00e9e : ${sanitizeVerdictInProse(ai.decisionToday.trim())}` : "";
  const marketLine = ai?.marketPlain?.trim() ? `March\u00e9 : ${sanitizeVerdictInProse(ai.marketPlain.trim())}` : "";
  const priceLine = ai && (ai.maxEngagementPriceEur != null || ai.neverExceedPriceEur != null)
    ? `Prix max : ${ai.maxEngagementPriceEur != null ? fmtCurrency(ai.maxEngagementPriceEur) : "ND"} \u2022 \u00c0 ne jamais d\u00e9passer : ${ai.neverExceedPriceEur != null ? fmtCurrency(ai.neverExceedPriceEur) : "ND"}`
    : "";
  const simple = [directorLine, marketLine, priceLine].filter(Boolean).join("\n");
  const summary = ai?.executiveSummary?.trim() ? sanitizeVerdictInProse(ai.executiveSummary.trim()) : "";
  const fallback = verdict
    ? `D\u00e9cision IA : ${decisionLabel(verdict)}. G\u00e9n\u00e9rer la Synth\u00e8se IA pour obtenir une conclusion et un plan d'action.`
    : "Synth\u00e8se indisponible : g\u00e9n\u00e9rer la Synth\u00e8se IA pour enrichir le dossier.";
  const text = simple || summary || fallback;

  roundedBox(doc, M.left, y, CW, 5, 1.5, C.slate50, C.slate200, 0.2);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 4, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...C.slate900);
  doc.text("R\u00e9sum\u00e9 ex\u00e9cutif", M.left + 6, y + 3.5);
  y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.slate700);
  const sLines = doc.splitTextToSize(S(text), CW - 8);
  doc.text(sLines, M.left + 4, y);
  y += sLines.length * 3.5 + 5;

  // ── Lecture simple (bloc obligatoire, vulgarisé) ─────────────────────────
  y = ensureSpace(doc, y, 40);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.accentBg, C.accentLight, 0.3);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 5, "F");
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.accentDark);
  doc.text("Lecture simple", M.left + 6, y + 4);
  y += 9;

  // Build plain-language reading from available data
  const lectureLines: string[] = [];
  {
    // Nature du deal
    const typeBien = (deal as any)?.typeBien ?? (deal as any)?.propertyType ?? "";
    const dealNature = typeBien
      ? `Op\u00e9ration d'achat-revente sur un bien de type "${typeBien}" \u00e0 ${city !== "\u2014" ? city : "localisation non pr\u00e9cis\u00e9e"}.`
      : `Op\u00e9ration d'investissement immobilier \u00e0 ${city !== "\u2014" ? city : "localisation non pr\u00e9cis\u00e9e"}.`;
    lectureLines.push(dealNature);

    // Prix
    if (metrics.prixAchat > 0) {
      lectureLines.push(`Prix d'acquisition : ${fmtCurrency(metrics.prixAchat)}${metrics.prixM2 ? ` (${fmtNumber(metrics.prixM2)} \u20ac/m\u00b2)` : ""}.`);
    }

    // Marge
    if (mb != null) {
      lectureLines.push(`La marge brute est de ${fmtPercent(mb)}${mb >= 12 ? ", au-dessus du seuil Mimmoza de 12%." : ", en dessous du seuil de s\u00e9curit\u00e9 de 12% — prudence."}`);
    } else {
      lectureLines.push("La marge brute n'est pas calculable (revente cible manquante).");
    }

    // Principal risque
    const rpi = scores["RiskPressureIndex"] ? Number(scores["RiskPressureIndex"]) : null;
    if (rpi != null) {
      lectureLines.push(`Pression risque : ${rpi}/100 — ${rpi >= 60 ? "le risque est \u00e9lev\u00e9, plusieurs facteurs d\u00e9favorables." : rpi >= 35 ? "risque mod\u00e9r\u00e9, vigilance n\u00e9cessaire." : "risque ma\u00eetris\u00e9 \u00e0 ce stade."}`);
    } else if (ai?.vigilances && ai.vigilances.length > 0) {
      lectureLines.push(`Principal risque identifi\u00e9 : ${ai.vigilances[0]}.`);
    }

    // Condition GO
    if (ai?.conditionsToBuy && ai.conditionsToBuy.length > 0) {
      lectureLines.push(`Condition principale pour dire GO : ${ai.conditionsToBuy[0]}.`);
    } else if (mb != null && mb < 12) {
      lectureLines.push("Condition principale pour dire GO : n\u00e9gocier un prix qui ram\u00e8ne la marge brute au-dessus de 12%.");
    }

    // Quand dire NON
    if (metrics.premiumVsDvfPct != null && metrics.premiumVsDvfPct > 15) {
      lectureLines.push("Dire NON si le vendeur refuse toute n\u00e9gociation : la surcote vs DVF est trop \u00e9lev\u00e9e sans buffer de s\u00e9curit\u00e9.");
    } else if (mb != null && mb < 5) {
      lectureLines.push("Dire NON si la marge brute ne peut pas atteindre au moins 8% apr\u00e8s n\u00e9gociation.");
    } else {
      lectureLines.push("Dire NON si les donn\u00e9es manquantes (travaux, charges, diagnostics) r\u00e9v\u00e8lent des co\u00fbts cach\u00e9s significatifs.");
    }
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  const lectureText = lectureLines.join(" ");
  const ll = doc.splitTextToSize(S(lectureText), CW - 10);
  doc.text(ll, M.left + 5, y);
  y += ll.length * 3.3 + 5;

  // ── B1/B2/B3: Investisseur-only institutional blocks ─────────────────────
  if (space === "investisseur") {
    // Resolve shared data for B1/B2/B3
    const smartScoreVal = scores["SmartScore"] ? Number(scores["SmartScore"]) : null;
    const robustesseVal = invScores?.robustesse ?? null;
    const rentabiliteVal = invScores?.rentabilite ?? null;
    const liquiditeVal = scores["Probabilit\u00e9 revente"] ? Number(scores["Probabilit\u00e9 revente"]) : null;
    const dealAny: any = deal ?? {};
    const dureeDetention = Number(dealAny.dureeDetention ?? dealAny.holdingPeriodMonths ?? 0);
    const dataConf = computeDataConfidence(metrics, ai, scores, snapshot);
    const riskClass = computeRiskClass(smartScoreVal, robustesseVal, rentabiliteVal, dataConf);
    const investorProfile = computeInvestorProfile(robustesseVal, liquiditeVal, dureeDetention, metrics.cushion);
    const completudePct = scores["Compl\u00e9tude"] ? scores["Compl\u00e9tude"] + "%" : "ND";
    const criticalMissingCount = ai?.missingData?.length ?? 0;

    // ── Row: Risk Class + Data Confidence ──────────────────────────────────
    y = ensureSpace(doc, y, 30);
    const halfW = (CW - 4) / 2;

    // B1: Risk Class badge
    roundedBox(doc, M.left, y, halfW, 22, 2.5, riskClass.bg, C.slate200, 0.2);
    doc.setFillColor(...riskClass.color); doc.rect(M.left + 4, y, halfW - 8, 1, "F");
    doc.setFontSize(5.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate400);
    doc.text("CLASSE DE RISQUE", M.left + halfW / 2, y + 6, { align: "center" });
    doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...riskClass.color);
    doc.text(S(riskClass.cls), M.left + halfW / 2, y + 13.5, { align: "center" });
    doc.setFontSize(5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate500);
    doc.text(S(riskClass.subtext), M.left + halfW / 2, y + 18, { align: "center" });

    // B3: Data Confidence
    const dcColor = dataConf >= 75 ? C.emerald : dataConf >= 50 ? C.amber : C.rose;
    const dcX = M.left + halfW + 4;
    roundedBox(doc, dcX, y, halfW, 22, 2.5, C.white, C.slate200, 0.2);
    doc.setFillColor(...dcColor); doc.rect(dcX + 4, y, halfW - 8, 1, "F");
    doc.setFontSize(5.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate400);
    doc.text("CONFIANCE DONN\u00c9ES", dcX + halfW / 2, y + 6, { align: "center" });
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate900);
    doc.text(S(`${dataConf}/100`), dcX + halfW / 2, y + 12.5, { align: "center" });
    doc.setFontSize(5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate500);
    doc.text(S(`${dataConfidenceLabel(dataConf)} | Compl\u00e9tude ${completudePct} | Critiques manquantes : ${criticalMissingCount}`), dcX + halfW / 2, y + 17.5, { align: "center" });
    progressBar(doc, dcX + 6, y + 19.5, halfW - 12, 1.5, dataConf / 100, dcColor);
    y += 26;

    // B2: Profil investisseur cible
    y = ensureSpace(doc, y, 22);
    roundedBox(doc, M.left, y, CW, 20, 2.5, C.slate50, C.slate200, 0.15);
    doc.setFillColor(...C.accent); doc.rect(M.left, y + 1, 2, 18, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...C.accentDark);
    doc.text("Profil cible", M.left + 6, y + 5);

    const profFields: [string, string][] = [
      ["Profil", investorProfile.profil],
      ["Horizon", investorProfile.horizon],
      ["Tol\u00e9rance risque", investorProfile.tolerance],
      ["Strat\u00e9gie", investorProfile.strategie],
    ];
    const profColW = (CW - 14) / 4;
    profFields.forEach(([label, val], idx) => {
      const px = M.left + 6 + idx * (profColW + 2);
      doc.setFont("helvetica", "bold"); doc.setFontSize(5.5); doc.setTextColor(...C.slate400);
      doc.text(S(label.toUpperCase()), px, y + 10);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate800);
      doc.text(S(val), px, y + 15);
    });
    y += 24;
  }

  // ── Quick strengths / vigilances columns ─────────────────────────────────
  if (ai && (ai.strengths.length > 0 || ai.vigilances.length > 0)) {
    y = ensureSpace(doc, y, 28);
    doc.setDrawColor(...C.slate200); doc.setLineWidth(0.2); doc.line(M.left, y, PW - M.right, y);
    y += 4;
    const colW2 = (CW - 6) / 2;
    if (ai.strengths.length > 0) {
      roundedBox(doc, M.left, y - 2, colW2, 5, 1, C.emeraldBg);
      doc.setFillColor(...C.emerald); doc.rect(M.left, y - 2, 1.5, 5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...C.emeraldDark); doc.text("POINTS FORTS", M.left + 5, y + 1);
      let sy = y + 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate700);
      ai.strengths.slice(0, 4).forEach((s) => {
        doc.setFillColor(...C.emerald); doc.circle(M.left + 3, sy - 0.8, 0.5, "F");
        const sl = doc.splitTextToSize(s, colW2 - 10); doc.text(sl, M.left + 7, sy); sy += sl.length * 3 + 1.5;
      });
    }
    if (ai.vigilances.length > 0) {
      const rx = M.left + colW2 + 6;
      roundedBox(doc, rx, y - 2, colW2, 5, 1, C.amberBg);
      doc.setFillColor(...C.amber); doc.rect(rx, y - 2, 1.5, 5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...C.amberDark); doc.text("POINTS DE VIGILANCE", rx + 5, y + 1);
      let vy = y + 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate700);
      ai.vigilances.slice(0, 4).forEach((v) => {
        doc.setFillColor(...C.amber); doc.circle(rx + 3, vy - 0.8, 0.5, "F");
        const vl = doc.splitTextToSize(v, colW2 - 10); doc.text(vl, rx + 7, vy); vy += vl.length * 3 + 1.5;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// RADAR Risk vs Upside
// ---------------------------------------------------------------------------

function drawRadarChart(
  doc: jsPDF,
  cx: number, cy: number, radius: number,
  axes: { label: string; value: number; max: number }[],
  color: RGB, fillColor: RGB, fillOpacity: number,
): void {
  const n = axes.length;
  if (n < 3) return;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2; // top

  // Draw concentric rings (25%, 50%, 75%, 100%)
  [0.25, 0.5, 0.75, 1.0].forEach((ring) => {
    doc.setDrawColor(...C.slate200); doc.setLineWidth(0.15);
    const r = radius * ring;
    for (let i = 0; i < n; i++) {
      const a1 = startAngle + i * angleStep;
      const a2 = startAngle + ((i + 1) % n) * angleStep;
      doc.line(cx + r * Math.cos(a1), cy + r * Math.sin(a1), cx + r * Math.cos(a2), cy + r * Math.sin(a2));
    }
  });

  // Draw axis lines
  doc.setDrawColor(...C.slate300); doc.setLineWidth(0.2);
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * angleStep;
    doc.line(cx, cy, cx + radius * Math.cos(a), cy + radius * Math.sin(a));
  }

  // Draw axis labels
  doc.setFontSize(4.8); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate600);
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * angleStep;
    const lx = cx + (radius + 8) * Math.cos(a);
    const ly = cy + (radius + 8) * Math.sin(a);
    const align = Math.abs(Math.cos(a)) < 0.1 ? "center" as const : Math.cos(a) > 0 ? "left" as const : "right" as const;
    doc.text(S(axes[i].label), lx, ly + 1.5, { align });
  }

  // Draw data polygon (filled)
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * angleStep;
    const pct = Math.min(axes[i].value / axes[i].max, 1);
    const r = radius * Math.max(pct, 0.05);
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }

  // Fill polygon
  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.setDrawColor(...color); doc.setLineWidth(0.6);
  // We draw the filled polygon as a series of triangles from center
  // jsPDF doesn't have native polygon fill, so we use triangles
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    doc.triangle(cx, cy, p1[0], p1[1], p2[0], p2[1], "F");
  }
  // Draw outline
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    doc.line(p1[0], p1[1], p2[0], p2[1]);
  }

  // Draw data points
  doc.setFillColor(...color);
  for (const p of points) {
    doc.circle(p[0], p[1], 1, "F");
  }
}

function buildRadarPage(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const narrative = sanitizeForPdf(opts?.aiReport?.narrativeMarkdown ?? opts?.aiReport?.narrative ?? "");
  const scores = narrative ? extractFromNarrative(narrative).scores : {};
  const metrics = extractDealMetrics(snapshot, opts);
  const ai = opts?.aiReport ? normalizeAiReport(opts.aiReport) : null;

  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, "Radar Risk vs Upside", "Vue d'\u00e9quilibre investisseur");

  // ── UPSIDE Radar ─────────────────────────────────────────────────────────
  const radarRadius = 24; // 85% of 28 — more room for labels
  const radarCxLeft = M.left + 46;
  const radarCyLeft = y + radarRadius + 12;

  // Calculate upside values
  const margeBruteVal = metrics.margeBrute != null ? Math.min(metrics.margeBrute / 30 * 100, 100) : 0;
  const discountVal = metrics.premiumVsDvfPct != null
    ? Math.min(Math.max(50 - metrics.premiumVsDvfPct * 2.5, 0), 100)
    : 50;
  const liquiditeVal = scores["Probabilit\u00e9 revente"] ? Number(scores["Probabilit\u00e9 revente"]) : 50;
  const opportunityVal = scores["OpportunityScore"] ? Number(scores["OpportunityScore"]) : 50;
  const creationValeur = metrics.travaux > 0 && metrics.prixRevente > 0
    ? Math.min(((metrics.prixRevente - metrics.prixAchat - metrics.travaux) / Math.max(metrics.travaux, 1)) * 25, 100)
    : 50;

  // Title
  roundedBox(doc, M.left, y - 2, CW / 2 - 2, 6, 1.5, C.emeraldBg, C.emeraldLight, 0.2);
  doc.setFillColor(...C.emerald); doc.rect(M.left, y - 2, 1.5, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.emeraldDark);
  doc.text("UPSIDE", M.left + 5, y + 2);

  drawRadarChart(doc, radarCxLeft, radarCyLeft, radarRadius, [
    { label: "Marge", value: margeBruteVal, max: 100 },
    { label: "Prix vs DVF", value: discountVal, max: 100 },
    { label: "Liquidit\u00e9", value: liquiditeVal, max: 100 },
    { label: "Momentum", value: opportunityVal, max: 100 },
    { label: "Cr\u00e9ation", value: creationValeur, max: 100 },
  ], C.emerald, C.emeraldBg, 0.3);

  // ── RISK Radar ───────────────────────────────────────────────────────────
  const radarCxRight = M.left + CW / 2 + 46;

  roundedBox(doc, M.left + CW / 2 + 2, y - 2, CW / 2 - 2, 6, 1.5, C.roseBg, C.roseLight, 0.2);
  doc.setFillColor(...C.rose); doc.rect(M.left + CW / 2 + 2, y - 2, 1.5, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.roseDark);
  doc.text("RISK", M.left + CW / 2 + 7, y + 2);

  const riskPressureVal = scores["RiskPressureIndex"] ? Number(scores["RiskPressureIndex"]) : 50;
  // Cushion risk: cushion < 0 → full risk; cushion 0 → 60; cushion >= 5 → low risk
  const cushionRisk = metrics.cushion != null ? Math.min(Math.max(60 - metrics.cushion * 12, 0), 100) : 75;
  const sensibiliteTravaux = metrics.travaux > 0 ? Math.min(metrics.travaux / metrics.prixAchat * 200, 100) : 80; // ND > p\u00e9naliser
  const sensibiliteDelais = 65; // Prudence par d\u00e9faut (pas de donn\u00e9e dur\u00e9e d\u00e9tention)
  const completude = scores["Compl\u00e9tude"] ? 100 - Number(scores["Compl\u00e9tude"]) : 60;

  drawRadarChart(doc, radarCxRight, radarCyLeft, radarRadius, [
    { label: "Pression", value: riskPressureVal, max: 100 },
    { label: "Buffer", value: cushionRisk, max: 100 },
    { label: "Travaux", value: sensibiliteTravaux, max: 100 },
    { label: "D\u00e9lais", value: sensibiliteDelais, max: 100 },
    { label: "Donn\u00e9es", value: completude, max: 100 },
  ], C.rose, C.roseBg, 0.3);

  y = radarCyLeft + radarRadius + 12;

  // ── Interprétation (4–6 bullets) ─────────────────────────────────────────
  y = ensureSpace(doc, y, 50);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.slate50, C.slate200, 0.2);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
  doc.text("Ce que \u00e7a veut dire pour l'investisseur", M.left + 6, y + 4);
  y += 9;

  const interpretations: string[] = [];

  // Marge brute
  if (metrics.margeBrute != null) {
    interpretations.push(metrics.margeBrute >= 12
      ? `La marge brute (${fmtPercent(metrics.margeBrute)}) offre un buffer de s\u00e9curit\u00e9 correct. L'op\u00e9ration r\u00e9siste \u00e0 des al\u00e9as mod\u00e9r\u00e9s.`
      : `La marge brute (${fmtPercent(metrics.margeBrute)}) est sous le seuil de 12%. Un seul al\u00e9a (travaux, d\u00e9lai, n\u00e9go revente) peut effacer la rentabilit\u00e9.`);
  }
  // Surcote
  if (metrics.premiumVsDvfPct != null) {
    interpretations.push(metrics.premiumVsDvfPct <= 0
      ? `Vous achetez en dessous du march\u00e9 DVF (${fmtPercent(metrics.premiumVsDvfPct)} de d\u00e9cote). C'est un signal positif.`
      : `Vous payez ${fmtPercent(metrics.premiumVsDvfPct)} au-dessus du march\u00e9 DVF. ${metrics.premiumVsDvfPct > 10 ? "Cette surcote est risqu\u00e9e sans justification forte." : "Acceptable si le bien a des atouts sp\u00e9cifiques."}`);
  }
  // Risk pressure
  if (scores["RiskPressureIndex"]) {
    const rpi = Number(scores["RiskPressureIndex"]);
    interpretations.push(rpi >= 60
      ? `L'indice de pression risque (${rpi}/100) est \u00e9lev\u00e9 : plusieurs facteurs cumulatifs augmentent le risque de perte.`
      : `L'indice de pression risque (${rpi}/100) est ${rpi >= 35 ? "mod\u00e9r\u00e9" : "faible"} : le profil de risque est ${rpi >= 35 ? "acceptable avec vigilance" : "bien ma\u00eetris\u00e9"}.`);
  }
  // Travaux
  if (metrics.travaux > 0) {
    const travauxPct = (metrics.travaux / metrics.prixAchat) * 100;
    interpretations.push(`Les travaux repr\u00e9sentent ${fmtPercent(travauxPct)} du prix d'achat. ${travauxPct > 20 ? "C'est significatif : un d\u00e9rapage de 15% change le verdict." : "Proportion raisonnable, mais \u00e0 valider par devis."}`);
  } else {
    interpretations.push("Aucun montant travaux renseign\u00e9 : Mimmoza p\u00e9nalise par prudence. Obtenir des devis avant toute offre.");
  }
  // Complétude
  if (scores["Compl\u00e9tude"]) {
    const comp = Number(scores["Compl\u00e9tude"]);
    interpretations.push(comp >= 70
      ? `Le dossier est compl\u00e9t\u00e9 \u00e0 ${comp}%. La d\u00e9cision est relativement fiable.`
      : `Le dossier n'est compl\u00e9t\u00e9 qu'\u00e0 ${comp}%. La d\u00e9cision pourrait changer avec les donn\u00e9es manquantes.`);
  }
  // Liquidité
  if (scores["Probabilit\u00e9 revente"]) {
    const liq = Number(scores["Probabilit\u00e9 revente"]);
    interpretations.push(liq >= 60
      ? `Liquidit\u00e9 correcte (${liq}%) : revente possible dans des d\u00e9lais raisonnables.`
      : `Liquidit\u00e9 limit\u00e9e (${liq}%) : la revente peut prendre du temps, pr\u00e9voir un plan B (location).`);
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  interpretations.slice(0, 6).forEach((interp) => {
    y = ensureSpace(doc, y, 10);
    doc.setFillColor(...C.accent); doc.circle(M.left + 4, y - 0.5, 0.6, "F");
    const il = doc.splitTextToSize(S(interp), CW - 14);
    doc.text(il, M.left + 8, y);
    y += il.length * 3.3 + 2.5;
  });
}

// ---------------------------------------------------------------------------
// CAPITAL AT RISK
// ---------------------------------------------------------------------------

function buildCapitalAtRiskPage(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const metrics = extractDealMetrics(snapshot, opts);
  const ai = opts?.aiReport ? normalizeAiReport(opts.aiReport) : null;

  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, "Capital at Risk", "Qu'est-ce que vous risquez concr\u00e8tement ?");

  // ── Capital engagé ───────────────────────────────────────────────────────
  const kpiW = (CW - 9) / 4; const kpiH = 28;

  const capitalDisplay = metrics.capitalEngage != null && metrics.capitalEngage > 0 ? fmtCurrency(metrics.capitalEngage) : "ND";
  const capitalSub: string[] = [];
  if (metrics.prixAchat > 0) capitalSub.push(`Achat: ${fmtCurrency(metrics.prixAchat)}`);
  if (metrics.fraisNotaire > 0) capitalSub.push(`Notaire: ${fmtCurrency(metrics.fraisNotaire)}`);
  if (metrics.travaux > 0) capitalSub.push(`Travaux: ${fmtCurrency(metrics.travaux)}`);

  kpiCard(doc, M.left, y, kpiW, kpiH, "Capital engag\u00e9", capitalDisplay,
    { color: C.accent, subtext: metrics.capitalEngage == null ? "Donn\u00e9es insuffisantes" : undefined });
  kpiCard(doc, M.left + kpiW + 3, y, kpiW, kpiH, "Cushion vs seuil", metrics.cushion != null ? fmtPercent(metrics.cushion, 1) + " pts" : "ND",
    { color: metrics.cushion != null ? (metrics.cushion >= 3 ? C.emerald : metrics.cushion >= 0 ? C.amber : C.rose) : C.slate500,
      gauge: metrics.cushion != null ? Math.max(metrics.cushion + 12, 0) : undefined, gaugeMax: 30,
      subtext: metrics.cushion != null ? (metrics.cushion >= 3 ? "Buffer confortable" : metrics.cushion >= 0 ? "Buffer juste" : "Sous seuil 12%") : "Marge brute manquante" });
  kpiCard(doc, M.left + (kpiW + 3) * 2, y, kpiW, kpiH, "Marge brute", metrics.margeBrute != null ? fmtPercent(metrics.margeBrute) : "ND",
    { color: metrics.margeBrute != null && metrics.margeBrute >= 12 ? C.emerald : C.amber,
      gauge: metrics.margeBrute != null ? Math.max(metrics.margeBrute, 0) : undefined, gaugeMax: 30 });
  kpiCard(doc, M.left + (kpiW + 3) * 3, y, kpiW, kpiH, "Marge nette", metrics.margeNette > 0 ? fmtCurrency(metrics.margeNette) : "ND",
    { color: metrics.margeNette > 0 ? C.emerald : C.slate500 });
  y += kpiH + 3;

  // Détail capital engagé
  if (capitalSub.length > 0) {
    doc.setFontSize(6.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate500);
    doc.text(S("D\u00e9composition : " + capitalSub.join(" + ")), M.left + 4, y);
    y += 5;
  }
  if (metrics.capitalEngage == null || metrics.capitalEngage === 0) {
    roundedBox(doc, M.left, y, CW, 8, 2, C.amberBg, C.amberLight, 0.2);
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.amberDark);
    doc.text(S("Capital engag\u00e9 non calculable (donn\u00e9es manquantes). Cela augmente le risque : impossible d'\u00e9valuer l'exposition r\u00e9elle."), M.left + 5, y + 5);
    y += 12;
  }

  y += 4;

  // ── Stress Test ──────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 80);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.roseBg, C.roseLight, 0.2);
  doc.setFillColor(...C.rose); doc.rect(M.left, y + 0.5, 2, 5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C.roseDark);
  doc.text("Stress test : et si \u00e7a tourne mal ?", M.left + 6, y + 4);
  y += 10;

  interface StressScenario { label: string; newMarge: number | null; description: string; canCalc: boolean }
  const scenarios: StressScenario[] = [];

  // Scenario 1: +10% travaux
  if (metrics.travaux > 0 && metrics.prixRevente > 0 && metrics.prixAchat > 0) {
    const newTravaux = metrics.travaux * 1.10;
    const totalCost = metrics.prixAchat + metrics.fraisNotaire + newTravaux;
    const newMarge = ((metrics.prixRevente - totalCost) / totalCost) * 100;
    scenarios.push({ label: "+10% travaux", newMarge, description: `Si les travaux d\u00e9rapent de 10% (${fmtCurrency(newTravaux)} au lieu de ${fmtCurrency(metrics.travaux)})`, canCalc: true });
  } else {
    scenarios.push({ label: "+10% travaux", newMarge: null, description: "Montant travaux manquant : impossible de simuler.", canCalc: false });
  }

  // Scenario 2: -5% sur revente cible
  if (metrics.prixRevente > 0 && metrics.prixAchat > 0) {
    const newRevente = metrics.prixRevente * 0.95;
    const totalCost = metrics.prixAchat + metrics.fraisNotaire + metrics.travaux;
    const newMarge = ((newRevente - totalCost) / totalCost) * 100;
    scenarios.push({ label: "-5% sur revente", newMarge, description: `Si le prix de revente baisse de 5% (${fmtCurrency(newRevente)} au lieu de ${fmtCurrency(metrics.prixRevente)})`, canCalc: true });
  } else {
    scenarios.push({ label: "-5% sur revente", newMarge: null, description: "Prix de revente manquant : impossible de simuler.", canCalc: false });
  }

  // Scenario 3: Cumul -5% revente + 10% travaux
  if (metrics.prixRevente > 0 && metrics.prixAchat > 0 && metrics.travaux > 0) {
    const newRevente = metrics.prixRevente * 0.95;
    const newTravaux = metrics.travaux * 1.10;
    const totalCost = metrics.prixAchat + metrics.fraisNotaire + newTravaux;
    const newMarge = ((newRevente - totalCost) / totalCost) * 100;
    scenarios.push({ label: "Cumul\u00e9 d\u00e9favorable", newMarge, description: "Travaux +10% ET revente -5% cumul\u00e9s", canCalc: true });
  }

  // Stress test table
  const stressHead = [["Sc\u00e9nario", "Description", "Marge apr\u00e8s stress", "Seuil 12%"]];
  const stressBody = scenarios.map((s) => {
    const margeStr = s.canCalc && s.newMarge != null ? fmtPercent(s.newMarge) : "ND";
    const seuil = s.canCalc && s.newMarge != null
      ? (s.newMarge >= 12 ? "OK" : s.newMarge >= 0 ? "SOUS-SEUIL" : "PERTE")
      : "ND";
    return [S(s.label), S(s.description), S(margeStr), S(seuil)];
  });

  autoTable(doc, {
    startY: y, head: stressHead, body: stressBody, theme: "grid",
    margin: { left: M.left, right: M.right }, tableWidth: CW,
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 7 },
    bodyStyles: { fontSize: 7.5, textColor: C.slate900, cellPadding: { top: 3, bottom: 3, left: 5, right: 5 } },
    columnStyles: { 0: { cellWidth: 32, fontStyle: "bold" }, 1: {}, 2: { cellWidth: 28, halign: "center" }, 3: { cellWidth: 22, halign: "center" } },
    alternateRowStyles: { fillColor: C.slate50 }, styles: { lineColor: C.slate200, lineWidth: 0.15 },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 3) {
        const raw = String(data.cell.raw ?? "");
        if (raw === "OK") { data.cell.styles.textColor = C.emeraldDark; data.cell.styles.fillColor = C.emeraldBg; data.cell.styles.fontStyle = "bold"; }
        else if (raw === "SOUS-SEUIL") { data.cell.styles.textColor = C.amberDark; data.cell.styles.fillColor = C.amberBg; data.cell.styles.fontStyle = "bold"; }
        else if (raw === "PERTE") { data.cell.styles.textColor = C.roseDark; data.cell.styles.fillColor = C.roseBg; data.cell.styles.fontStyle = "bold"; }
        else { data.cell.styles.textColor = C.slate400; data.cell.styles.fontStyle = "italic"; }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Lecture asymétrie ────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 30);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.accentBg, C.accentLight, 0.2);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
  doc.text("Lecture asym\u00e9trie risque / gain", M.left + 6, y + 4);
  y += 10;

  // Build asymmetry text
  const asymLines: string[] = [];
  if (metrics.margeBrute != null && metrics.capitalEngage != null && metrics.capitalEngage > 0) {
    const gainAbsolu = metrics.prixRevente - metrics.capitalEngage;
    asymLines.push(`Gain potentiel : ${fmtCurrency(gainAbsolu)} (marge brute ${fmtPercent(metrics.margeBrute)}).`);

    // Worst stress test loss
    const worstScenario = scenarios.filter(s => s.canCalc && s.newMarge != null).sort((a, b) => (a.newMarge ?? 0) - (b.newMarge ?? 0));
    if (worstScenario.length > 0 && worstScenario[0].newMarge != null) {
      const worst = worstScenario[0];
      if (worst.newMarge < 0) {
        asymLines.push(`Dans le sc\u00e9nario d\u00e9favorable "${worst.label}", vous perdez de l'argent (marge ${fmtPercent(worst.newMarge)}).`);
        asymLines.push("L'asym\u00e9trie est d\u00e9favorable : le downside est rapide tandis que le gain est incertain.");
      } else {
        asymLines.push(`M\u00eame dans le sc\u00e9nario d\u00e9favorable "${worst.label}", la marge reste \u00e0 ${fmtPercent(worst.newMarge)}.`);
        asymLines.push(worst.newMarge >= 12
          ? "L'asym\u00e9trie est favorable : le deal r\u00e9siste au stress."
          : "L'asym\u00e9trie est neutre : le deal tient mais sans marge de confort.");
      }
    }
  } else {
    asymLines.push("Donn\u00e9es insuffisantes pour \u00e9valuer l'asym\u00e9trie risque/gain compl\u00e8te.");
    asymLines.push("Upside limit\u00e9 vs downside rapide est le sch\u00e9ma le plus fr\u00e9quent quand les donn\u00e9es manquent. Chaque inconnue (travaux, d\u00e9lai, charges) joue contre l'investisseur.");
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  asymLines.forEach((line) => {
    y = ensureSpace(doc, y, 9);
    const ll2 = doc.splitTextToSize(S(line), CW - 10);
    doc.text(ll2, M.left + 5, y);
    y += ll2.length * 3.4 + 2;
  });
}

// ---------------------------------------------------------------------------
// Deal section
// ---------------------------------------------------------------------------

function buildDealSection(doc: jsPDF, y: number, snapshot: MarchandSnapshotV1): number {
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  if (!deal) return y;
  y = sectionTitle(doc, y, "Fiche Op\u00e9ration", "Donn\u00e9es du deal actif");
  const d: any = deal;
  const pick = (...cands: any[]) => { for (const c of cands) { if (c === null || c === undefined) continue; if (typeof c === "string" && c.trim() === "") continue; return c; } return undefined; };

  const fields: [string, unknown, { treatZeroAsMissing?: boolean; kind?: "currency" | "percent" }?][] = [
    ["R\u00e9f\u00e9rence", pick(d.id)], ["Titre de l'op\u00e9ration", pick(d.title)], ["Statut", pick(d.status)],
    ["Adresse", pick(d.address)], ["Ville", pick(d.city)], ["Code postal", pick(d.zipCode, d.codePostal)],
    ["Prix d'acquisition", pick(d.prixAchat), { treatZeroAsMissing: true, kind: "currency" }],
    ["Prix de revente cible", pick(d.prixReventeCible, d.prixVenteEstime, d.prixVente), { treatZeroAsMissing: true, kind: "currency" }],
    ["Surface (m\u00b2)", pick(d.surfaceM2, d.surface), { treatZeroAsMissing: true }],
    ["Type de bien", pick(d.typeBien, d.propertyType)], ["\u00c9tat du bien", pick(d.etatBien, d.condition)],
    ["Travaux estim\u00e9s", pick(d.travauxEstimes, d.montantTravaux, d.travaux), { treatZeroAsMissing: true, kind: "currency" }],
    ["Frais de notaire", pick(d.fraisNotaire), { treatZeroAsMissing: true, kind: "currency" }],
    ["Marge nette", pick(d.margeNette), { treatZeroAsMissing: true, kind: "currency" }],
    ["Rentabilit\u00e9 (%)", pick(d.rentabilite, d.rendementBrut, d.rendement), { kind: "percent" }],
    ["Notes", pick(d.notes)],
  ];

  const rows = fields.map(([label, v, meta]) => {
    const treatZero = !!meta?.treatZeroAsMissing; const kind = meta?.kind;
    let out = "ND";
    if (kind === "currency") out = v == null ? "ND" : fmtCurrency(treatZero && Number(v) === 0 ? null : v);
    else if (kind === "percent") out = v == null ? "ND" : fmtPercent(treatZero && Number(v) === 0 ? null : v, 1);
    else { const base = ndIfZero(v, treatZero); out = base === "undefined" ? "ND" : base; }
    return [S(label as string), S(out)];
  });

  autoTable(doc, {
    startY: y, body: rows, theme: "plain", margin: { left: M.left, right: M.right }, tableWidth: CW,
    columnStyles: { 0: { cellWidth: 52, fontStyle: "bold", fillColor: C.slate50, textColor: C.slate600, fontSize: 7.5 }, 1: { textColor: C.slate900, fontSize: 8.5 } },
    styles: { cellPadding: { top: 2.5, bottom: 2.5, left: 6, right: 6 }, lineColor: C.slate200, lineWidth: 0.15 },
    didParseCell(data) { if (data.section === "body" && data.column.index === 1 && String(data.cell.raw) === "ND") { data.cell.styles.textColor = C.slate400; data.cell.styles.fontStyle = "italic"; } },
  });
  return (doc as any).lastAutoTable.finalY + 6;
}

// ---------------------------------------------------------------------------
// Other deals
// ---------------------------------------------------------------------------

function buildAllDealsSection(doc: jsPDF, y: number, snapshot: MarchandSnapshotV1): number {
  if (!snapshot.deals || snapshot.deals.length <= 1) return y;
  const others = snapshot.deals.filter((d) => d.id !== snapshot.activeDealId);
  if (others.length === 0) return y;
  y = sectionTitle(doc, y, "Portefeuille \u2014 Autres op\u00e9rations");
  autoTable(doc, {
    startY: y, head: [["R\u00e9f.", "Op\u00e9ration", "Statut", "Ville", "Prix d'achat"]],
    body: others.map((d: any) => [S(String(d.id ?? "")), S(String(d.title ?? "")), S(String(d.status ?? "")), S(String(d.city ?? "")), fmtCurrency(d.prixAchat ?? null)]),
    theme: "grid", margin: { left: M.left, right: M.right }, tableWidth: CW,
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 7 },
    bodyStyles: { fontSize: 7.5, textColor: C.slate900 }, alternateRowStyles: { fillColor: C.slate50 },
    styles: { lineColor: C.slate200, lineWidth: 0.15, cellPadding: { top: 2.5, bottom: 2.5, left: 5, right: 5 } },
  });
  return (doc as any).lastAutoTable.finalY + 6;
}

// ---------------------------------------------------------------------------
// Due Diligence
// ---------------------------------------------------------------------------

function buildDueDiligenceSection(doc: jsPDF, y: number, dd?: { report: any; computed?: any }): number {
  if (!dd?.report) return y;
  doc.addPage(); y = M.top + 4;
  y = sectionTitle(doc, y, "Due Diligence", "Audit de conformit\u00e9");
  const rpt = dd.report;
  const score = rpt.score ?? rpt.globalScore ?? dd.computed?.score;
  const completion = rpt.completion ?? rpt.completionRate;
  const criticalCount = rpt.criticalCount ?? rpt.critical;
  const warningCount = rpt.warningCount ?? rpt.warning;
  const categories: any[] = rpt.categories ?? rpt.items ?? rpt.sections ?? [];
  let totalItems = 0; categories.forEach((c: any) => { totalItems += (c.items?.length ?? 1); });

  const kpis: { label: string; value: string; color: RGB }[] = [];
  if (score !== undefined) { const n = Number(score); kpis.push({ label: "SCORE", value: String(score), color: n >= 70 ? C.emerald : n >= 40 ? C.amber : C.rose }); }
  if (completion !== undefined) kpis.push({ label: "COMPL\u00c9TION", value: String(completion), color: C.accent });
  if (criticalCount !== undefined) kpis.push({ label: "CRITIQUES", value: String(criticalCount), color: C.rose });
  if (warningCount !== undefined) kpis.push({ label: "ALERTES", value: String(warningCount), color: C.amber });
  if (totalItems > 0) kpis.push({ label: "\u00c9L\u00c9MENTS", value: String(totalItems), color: C.slate700 });

  if (kpis.length > 0) {
    const cw = Math.min((CW - (kpis.length - 1) * 3) / kpis.length, 40); let cx = M.left;
    kpis.forEach((k) => {
      roundedBox(doc, cx, y, cw, 22, 2.5, C.white, C.slate200, 0.2);
      doc.setFillColor(...k.color); doc.rect(cx + 4, y, cw - 8, 0.8, "F");
      doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.setTextColor(...k.color); doc.text(S(k.value), cx + cw / 2, y + 11, { align: "center" });
      doc.setFontSize(5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate400); doc.text(S(k.label), cx + cw / 2, y + 17, { align: "center" });
      cx += cw + 3;
    }); y += 28;
  }

  if (categories.length > 0) {
    const body: any[][] = [];
    categories.forEach((cat: any) => {
      if (cat.items && Array.isArray(cat.items)) {
        body.push([{ content: (cat.name ?? cat.label ?? cat.category ?? "").toUpperCase(), colSpan: 3, styles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold" as const, fontSize: 7 } }]);
        cat.items.forEach((item: any) => { body.push([item.label ?? item.name ?? item.item ?? "", item.status ?? item.result ?? "-", item.comment ?? ""]); });
      } else { body.push([cat.label ?? cat.name ?? cat.item ?? cat.category ?? "", cat.status ?? cat.result ?? "-", cat.comment ?? ""]); }
    });
    autoTable(doc, {
      startY: y, head: [["\u00c9l\u00e9ment", "Statut", "Commentaire"]], body, theme: "grid",
      margin: { left: M.left, right: M.right }, tableWidth: CW,
      headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 7 },
      bodyStyles: { fontSize: 7.5, textColor: C.slate900, cellPadding: { top: 2.5, bottom: 2.5, left: 5, right: 5 } },
      columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 28, halign: "center" }, 2: {} },
      alternateRowStyles: { fillColor: C.slate50 }, styles: { lineColor: C.slate200, lineWidth: 0.15 },
      didParseCell(data) { if (data.section === "body" && data.column.index === 1) { const sc = statusColors(String(data.cell.raw ?? "")); data.cell.styles.textColor = sc.text; data.cell.styles.fillColor = sc.bg; data.cell.styles.fontStyle = "bold"; data.cell.styles.fontSize = 6.5; } },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }
  return y;
}

// ---------------------------------------------------------------------------
// AI SECTION — cleaned: no duplicate résumé/verdict
// ---------------------------------------------------------------------------

function buildAiSection(doc: jsPDF, y: number, ai?: ExportPdfOpts["aiReport"]): number {
  if (!ai) return y;
  const data = normalizeAiReport(ai);
  if (!data) return y;

  doc.addPage(); y = M.top + 4;
  y = sectionTitle(doc, y, "Analyse IA \u2014 D\u00e9tail", "Moteur d'analyse Mimmoza");

  if (data.generatedAt) { doc.setFontSize(6); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate400); doc.text("Analyse g\u00e9n\u00e9r\u00e9e le " + fmtDateTime(parseIsoOrNow(data.generatedAt)), M.left, y); y += 5; }

  // ── NO duplicate verdict banner — already on page 1 ──
  // ── NO duplicate résumé exécutif — already on page 1 ──

  function renderBlock(title: string, items: string[], titleColor: RGB, bulletColor: RGB, bgColor: RGB, borderColor: RGB): void {
    if (items.length === 0) return;
    y = ensureSpace(doc, y, 18);
    roundedBox(doc, M.left, y, CW, 6, 1.5, bgColor, borderColor, 0.2);
    doc.setFillColor(...bulletColor); doc.rect(M.left, y + 0.5, 2, 5, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...titleColor);
    doc.text(title, M.left + 6, y + 4);
    y += 9;
    const LINE_H = 3.5; const ITEM_GAP = 2.2;
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
    items.forEach((item) => {
      y = ensureSpace(doc, y, 9);
      doc.setFillColor(...bulletColor); doc.circle(M.left + 4.2, y - 0.5, 0.7, "F");
      const lines = doc.splitTextToSize(S(item), CW - 15);
      doc.text(lines, M.left + 9, y);
      y += lines.length * LINE_H + ITEM_GAP;
    });
    y += 2;
  }

  function renderNumberedBlock(title: string, items: string[], titleColor: RGB, numColor: RGB): void {
    if (items.length === 0) return;
    y = ensureSpace(doc, y, 20);
    roundedBox(doc, M.left, y, CW, 6, 1.5, C.accentBg, C.accentLight, 0.2);
    doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 5, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...titleColor);
    doc.text(title, M.left + 6, y + 4);
    y += 10;
    const LINE_H = 3.7; const ITEM_GAP = 3.0; const TEXT_X = M.left + 12; const TEXT_W = CW - (TEXT_X - M.left) - 4;
    items.forEach((action, i) => {
      y = ensureSpace(doc, y, 14);
      const circleY = y + 0.5;
      doc.setFillColor(...numColor); doc.circle(M.left + 4.2, circleY, 2.8, "F");
      doc.setFontSize(6); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.white);
      doc.text(String(i + 1), M.left + 4.2, circleY + 1, { align: "center" });
      const colonIdx = action.indexOf(" : ");
      if (colonIdx > 0 && colonIdx < 50) {
        const heading = action.slice(0, colonIdx);
        const detail = action.slice(colonIdx + 3);
        doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate800);
        doc.text(S(heading), TEXT_X, y + 1); y += 4.5;
        if (detail.trim()) {
          doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate600);
          const detailLines = doc.splitTextToSize(S(detail), TEXT_W - 2);
          doc.text(detailLines, TEXT_X + 2, y); y += detailLines.length * LINE_H;
        }
      } else {
        doc.setFontSize(7.8); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
        const lines = doc.splitTextToSize(S(action), TEXT_W);
        doc.text(lines, TEXT_X, y + 0.8); y += lines.length * LINE_H;
      }
      y += ITEM_GAP;
    });
    y += 2;
  }

  // ── Conclusion vulgarisée (Director) — keep but no re-repeat of verdict/résumé ──
  const hasDirector = !!data.marketPlain || !!data.decisionToday || data.whatToDo.length > 0 || data.why.length > 0;
  if (hasDirector) {
    y = ensureSpace(doc, y, 36);
    roundedBox(doc, M.left, y, CW, 6, 1.5, C.accentBg, C.accentLight, 0.2);
    doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 5, "F");
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.accentDark);
    doc.text("Conclusion \u2014 quoi faire maintenant", M.left + 6, y + 4);
    y += 10;

    if (data.decisionToday) {
      roundedBox(doc, M.left, y, CW, 8, 2, C.white, C.slate200, 0.2);
      doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate900);
      doc.text(S(sanitizeVerdictInProse(data.decisionToday)), M.left + 5, y + 5.5);
      y += 12;
    }
    if (data.marketPlain) {
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
      const ml = doc.splitTextToSize(S("March\u00e9 : " + sanitizeVerdictInProse(data.marketPlain)), CW - 6);
      doc.text(ml, M.left + 3, y); y += ml.length * 3.4 + 3;
    }
    if (data.why.length > 0) {
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate800);
      doc.text("Pourquoi :", M.left + 3, y); y += 4.5;
      doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
      data.why.slice(0, 3).forEach((w) => {
        y = ensureSpace(doc, y, 7);
        doc.setFillColor(...C.slate600); doc.circle(M.left + 5, y - 0.6, 0.5, "F");
        const wl = doc.splitTextToSize(S(w), CW - 14);
        doc.text(wl, M.left + 9, y); y += wl.length * 3.2 + 1.5;
      }); y += 2;
    }
    if (data.whatToDo.length > 0) {
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate800);
      doc.text("\u00c0 faire maintenant :", M.left + 3, y); y += 4.5;
      doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
      data.whatToDo.slice(0, 5).forEach((a, idx) => {
        y = ensureSpace(doc, y, 7);
        doc.setFillColor(...C.accent); doc.circle(M.left + 5, y - 0.3, 2.2, "F");
        doc.setFontSize(5.8); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.white);
        doc.text(String(idx + 1), M.left + 5, y + 0.9, { align: "center" });
        doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
        const al = doc.splitTextToSize(S(a), CW - 16);
        doc.text(al, M.left + 10, y); y += al.length * 3.2 + 2;
      }); y += 2;
    }
    if (data.maxEngagementPriceEur != null || data.neverExceedPriceEur != null) {
      y = ensureSpace(doc, y, 10);
      roundedBox(doc, M.left, y, CW, 10, 2, C.slate50, C.slate200, 0.2);
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.slate800);
      const line = `Prix max : ${data.maxEngagementPriceEur != null ? fmtCurrency(data.maxEngagementPriceEur) : "ND"}  \u2022  \u00c0 ne jamais d\u00e9passer : ${data.neverExceedPriceEur != null ? fmtCurrency(data.neverExceedPriceEur) : "ND"}`;
      doc.text(S(line), M.left + 5, y + 6.5); y += 14;
    }
    if (data.conditionsToBuy.length > 0) {
      renderBlock("Conditions pour acheter", data.conditionsToBuy.slice(0, 5), C.slate700, C.slate600, C.slate50, C.slate200);
    }
  }

  renderBlock("Points forts", data.strengths, C.emeraldDark, C.emerald, C.emeraldBg, C.emeraldLight);
  renderBlock("Points de vigilance", data.vigilances, C.amberDark, C.amber, C.amberBg, C.amberLight);
  renderBlock("Sensibilit\u00e9s \u2014 Risques identifi\u00e9s", data.sensitivities, C.roseDark, C.rose, C.roseBg, C.roseLight);
  renderNumberedBlock("Plan d'action recommand\u00e9", data.actionPlan, C.accentDark, C.accent);
  renderBlock("Donn\u00e9es manquantes", data.missingData, C.slate600, C.slate400, C.slate50, C.slate200);

  // Detailed narrative — skip sections that duplicate the synthesis
  if (data.narrativeMarkdown) {
    doc.addPage(); y = M.top + 4;
    y = sectionTitle(doc, y, "Analyse d\u00e9taill\u00e9e", "Rapport narratif IA");
    const sections = parseNarrativeSections(data.narrativeMarkdown);

    // Filter out redundant verdict/résumé sections
    const skipPatterns = /^(verdict|r\u00e9sum\u00e9 ex\u00e9cutif|executive summary|synth\u00e8se|conclusion g\u00e9n\u00e9rale)$/i;

    for (const section of sections) {
      if (skipPatterns.test(section.title.trim())) continue;

      y = ensureSpace(doc, y, 16);
      if (section.title) {
        const isRisk = /risque|angle|capital.*risk/i.test(section.title);
        const isStrategy = /strat\u00e9gie|plan b|recommand/i.test(section.title);
        const isMarket = /march\u00e9|liquidit\u00e9|sortie|cycle|bpe/i.test(section.title);
        const isFinancial = /financ|marge|prix|valeur|asym\u00e9trie/i.test(section.title);
        const isDecision = /d\u00e9cision|conformit\u00e9/i.test(section.title);
        const sColor = isRisk ? C.rose : isDecision ? C.accent : isStrategy ? C.emerald : isMarket ? C.sky : isFinancial ? C.violet : C.slate600;
        const sBg = isRisk ? C.roseBg : isDecision ? C.accentBg : isStrategy ? C.emeraldBg : isMarket ? C.skyBg : isFinancial ? C.violetBg : C.slate50;
        roundedBox(doc, M.left, y - 1, CW, 5.5, 1, sBg);
        doc.setFillColor(...sColor); doc.rect(M.left, y - 1, 1.5, 5.5, "F");
        doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...sColor); doc.text(section.title, M.left + 5, y + 2.5);
        y += 7;
      }
      if (section.paragraphs.length > 0) {
        doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
        for (const para of section.paragraphs) {
          y = ensureSpace(doc, y, 9);
          const lines = doc.splitTextToSize(para, CW - 6);
          doc.text(lines, M.left + 3, y); y += lines.length * 3.4 + 2.5;
        }
      }
      if (section.bullets.length > 0) {
        doc.setFontSize(7.2); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
        for (const bullet of section.bullets) {
          y = ensureSpace(doc, y, 8);
          doc.setFillColor(...C.accent); doc.circle(M.left + 5, y - 0.4, 0.5, "F");
          const lines = doc.splitTextToSize(bullet, CW - 15);
          doc.text(lines, M.left + 9, y); y += lines.length * 3.2 + 2;
        }
        y += 2;
      }
      if (section.table && section.table.rows.length > 0) {
        y = ensureSpace(doc, y, 20);
        autoTable(doc, {
          startY: y, head: [section.table.headers], body: section.table.rows, theme: "grid",
          margin: { left: M.left + 2, right: M.right + 2 }, tableWidth: CW - 4,
          headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 6.5 },
          bodyStyles: { fontSize: 7, textColor: C.slate900 }, alternateRowStyles: { fillColor: C.slate50 },
          styles: { lineColor: C.slate200, lineWidth: 0.15, cellPadding: { top: 2, bottom: 2, left: 4, right: 4 } },
          didParseCell(tableData) { const raw = String(tableData.cell.raw ?? "").toUpperCase(); if (raw === "CONFORME") { tableData.cell.styles.textColor = C.emeraldDark; tableData.cell.styles.fontStyle = "bold"; } else if (/NON CALCULABLE/.test(raw)) { tableData.cell.styles.textColor = C.slate400; tableData.cell.styles.fontStyle = "italic"; } else if (/NON CONFORME|ALERTE/.test(raw)) { tableData.cell.styles.textColor = C.roseDark; tableData.cell.styles.fontStyle = "bold"; } },
        });
        y = (doc as any).lastAutoTable.finalY + 4;
      }
      y += 1;
    }
  }
  return y;
}

// ---------------------------------------------------------------------------
// PLAN D'ACTION — Dernière page obligatoire
// ---------------------------------------------------------------------------

function buildActionPlanPage(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const metrics = extractDealMetrics(snapshot, opts);
  const ai = opts?.aiReport ? normalizeAiReport(opts.aiReport) : null;

  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, "Plan d'action", "Exactement quoi faire, dans quel ordre");

  // ── Helper: draw checkbox ────────────────────────────────────────────────
  function checkbox(cx: number, cy: number): void {
    doc.setDrawColor(...C.slate400); doc.setLineWidth(0.3);
    doc.roundedRect(cx, cy - 2.5, 3.5, 3.5, 0.5, 0.5, "S");
  }

  function checklistBlock(title: string, items: string[], titleColor: RGB, bgColor: RGB, borderColor: RGB): void {
    y = ensureSpace(doc, y, 14 + items.length * 7);
    roundedBox(doc, M.left, y, CW, 6, 1.5, bgColor, borderColor, 0.2);
    doc.setFillColor(...titleColor); doc.rect(M.left, y + 0.5, 2, 5, "F");
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...titleColor);
    doc.text(S(title), M.left + 6, y + 4);
    y += 10;

    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...C.slate700);
    items.forEach((item) => {
      y = ensureSpace(doc, y, 8);
      checkbox(M.left + 3, y);
      const lines = doc.splitTextToSize(S(item), CW - 16);
      doc.text(lines, M.left + 10, y);
      y += lines.length * 3.5 + 2.5;
    });
    y += 3;
  }

  // ── 1. Avant de faire une offre (48–72h) ────────────────────────────────
  checklistBlock("Avant de faire une offre (48\u201372h)", [
    "V\u00e9rifier DVF par typologie (type de bien, \u00e9tat, surface similaire) sur la commune et les communes voisines",
    "Obtenir 2\u20133 devis travaux chiffr\u00e9s par des artisans (pas d'estimation au doigt mouill\u00e9)",
    "Estimer la dur\u00e9e r\u00e9aliste des travaux + dur\u00e9e de d\u00e9tention compl\u00e8te (achat > revente effective)",
    "V\u00e9rifier les charges de copropri\u00e9t\u00e9 (PV d'AG des 3 derni\u00e8res ann\u00e9es, budget pr\u00e9visionnel, impay\u00e9s)",
    "Confirmer la strat\u00e9gie de sortie : revente, location, division, ou mix",
  ], C.accent, C.accentBg, C.accentLight);

  // ── 2. Avant compromis ───────────────────────────────────────────────────
  const negoTarget = metrics.prixAchat > 0
    ? `N\u00e9gociation : objectif ${fmtCurrency(metrics.prixAchat * 0.92)} \u00e0 ${fmtCurrency(metrics.prixAchat * 0.95)} (-5 \u00e0 -8% du prix affich\u00e9)`
    : "N\u00e9gociation : viser une r\u00e9duction de 5\u20138% minimum du prix affich\u00e9";

  checklistBlock("Avant compromis", [
    negoTarget,
    "Diagnostics complets re\u00e7us et analys\u00e9s (DPE, amiante, plomb, termites, \u00e9lectricit\u00e9, assainissement)",
    "Audit copropri\u00e9t\u00e9 : \u00e9tat du syndic, proc\u00e9dures en cours, gros travaux vot\u00e9s",
    "Validation financement (accord de principe bancaire, capacit\u00e9 d'emprunt confirm\u00e9e)",
    "V\u00e9rifier urbanisme : PLU, zone de pr\u00e9emption, servitudes",
  ], C.sky, C.skyBg, [186, 230, 253] as RGB);

  // ── 3. Conditions suspensives recommandées ───────────────────────────────
  checklistBlock("Conditions suspensives recommand\u00e9es", [
    "Devis travaux valid\u00e9s et coh\u00e9rents avec le budget pr\u00e9vu (marge de 15% incluse)",
    "Absence de risque copropri\u00e9t\u00e9 majeur (proc\u00e9dure judiciaire, gros travaux non budg\u00e9t\u00e9s > 10k\u20ac)",
    "Obtention du financement aux conditions pr\u00e9vues",
    "R\u00e9sultats diagnostics conformes (pas de surco\u00fbt amiante, plomb, assainissement)",
    "Absence de vice cach\u00e9 constat\u00e9 lors de la visite technique",
  ], C.violet, C.violetBg, [196, 181, 253] as RGB);

  // ── 4. Seuils de décision Mimmoza (GO / NO GO) ──────────────────────────
  y = ensureSpace(doc, y, 50);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.emeraldBg, C.emeraldLight, 0.2);
  doc.setFillColor(...C.emerald); doc.rect(M.left, y + 0.5, 2, 5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C.emeraldDark);
  doc.text("Seuils de d\u00e9cision Mimmoza", M.left + 6, y + 4);
  y += 10;

  // GO conditions
  const goConditions = [
    "Marge brute >= 12% apr\u00e8s int\u00e9gration de TOUS les co\u00fbts (notaire, travaux, portage)",
  ];
  if (metrics.cushion != null) {
    goConditions.push(`Cushion >= 3 pts au-dessus du seuil 12% (actuellement ${fmtPercent(metrics.cushion, 1)} pts)`);
  }
  goConditions.push(
    "Stress test (travaux +10% OU revente -5%) ne fait pas passer la marge sous 5%",
    "Donn\u00e9es critiques obtenues : devis travaux, diagnostics, \u00e9tat copro",
  );
  if (ai?.conditionsToBuy && ai.conditionsToBuy.length > 0) {
    goConditions.push(...ai.conditionsToBuy.slice(0, 2));
  }

  roundedBox(doc, M.left + 2, y, CW / 2 - 4, 5, 1.5, C.emeraldBg);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C.emeraldDark);
  doc.text("GO", M.left + 6, y + 3.5);
  y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate700);
  goConditions.forEach((cond) => {
    y = ensureSpace(doc, y, 8);
    doc.setFillColor(...C.emerald); doc.circle(M.left + 5, y - 0.5, 0.6, "F");
    const cl = doc.splitTextToSize(S(cond), CW - 14);
    doc.text(cl, M.left + 9, y);
    y += cl.length * 3.2 + 2;
  });
  y += 3;

  // NO GO conditions
  const noGoConditions = [
    "Surcote DVF > 15% sans justification (localisation exceptionnelle, raret\u00e9 du bien)",
    "Marge brute < 5% m\u00eame apr\u00e8s n\u00e9gociation",
    "Donn\u00e9es critiques refus\u00e9es ou introuvables (pas de devis, pas de PV AG, diagnostics manquants)",
    "Copropri\u00e9t\u00e9 en difficult\u00e9 (proc\u00e9dure, impay\u00e9s > 20%, gros travaux non provisionn\u00e9s)",
    "Stress test cumul\u00e9 (travaux +10% ET revente -5%) am\u00e8ne la marge sous 0%",
  ];

  y = ensureSpace(doc, y, 30);
  roundedBox(doc, M.left + 2, y, CW / 2 - 4, 5, 1.5, C.roseBg);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C.roseDark);
  doc.text("NO GO", M.left + 6, y + 3.5);
  y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate700);
  noGoConditions.forEach((cond) => {
    y = ensureSpace(doc, y, 8);
    doc.setFillColor(...C.rose); doc.circle(M.left + 5, y - 0.5, 0.6, "F");
    const cl = doc.splitTextToSize(S(cond), CW - 14);
    doc.text(cl, M.left + 9, y);
    y += cl.length * 3.2 + 2;
  });
  y += 5;

  // ── 5. Plan B ────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 30);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.amberBg, C.amberLight, 0.2);
  doc.setFillColor(...C.amber); doc.rect(M.left, y + 0.5, 2, 5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C.amberDark);
  doc.text("Plan B \u2014 Si l'op\u00e9ration ne se passe pas comme pr\u00e9vu", M.left + 6, y + 4);
  y += 10;

  const planBItems = [
    "Location temporaire si revente retard\u00e9e : calculer le loyer minimum pour couvrir les mensualit\u00e9s + charges",
    "Revente en l'\u00e9tat (sans travaux) si les devis d\u00e9rapent au-del\u00e0 du budget : estimer la perte maximale accept\u00e9e",
    "Location meubl\u00e9e courte dur\u00e9e (si r\u00e8glementation locale le permet) pour maximiser les revenus en attente de revente",
    "N\u00e9gociation avec cr\u00e9ancier en cas de difficult\u00e9 de portage : anticiper les conditions de sortie anticip\u00e9e du cr\u00e9dit",
  ];

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  planBItems.forEach((item) => {
    y = ensureSpace(doc, y, 9);
    doc.setFillColor(...C.amber); doc.circle(M.left + 4, y - 0.5, 0.6, "F");
    const il = doc.splitTextToSize(S(item), CW - 14);
    doc.text(il, M.left + 8, y);
    y += il.length * 3.3 + 2.5;
  });
}

// ===========================================================================
// INVESTISSEUR-ONLY PAGES
// ===========================================================================

// ---------------------------------------------------------------------------
// Helper for investisseur appendix pages: consistent layout
// ---------------------------------------------------------------------------

function investisseurPageTitle(doc: jsPDF, title: string, subtitle?: string): number {
  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, title, subtitle);
  return y;
}

function writeParagraph(doc: jsPDF, y: number, text: string, fontSize = 7.5): number {
  y = ensureSpace(doc, y, 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize); doc.setTextColor(...C.slate700);
  const lines = doc.splitTextToSize(S(text), CW - 6);
  doc.text(lines, M.left + 3, y);
  return y + lines.length * 3.4 + 3;
}

function writeSubheading(doc: jsPDF, y: number, text: string, color: RGB = C.accentDark): number {
  y = ensureSpace(doc, y, 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...color);
  doc.text(S(text), M.left + 3, y);
  return y + 5;
}

function writeBullets(doc: jsPDF, y: number, items: string[], bulletColor: RGB = C.accent): number {
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  for (const item of items) {
    y = ensureSpace(doc, y, 8);
    doc.setFillColor(...bulletColor); doc.circle(M.left + 5, y - 0.5, 0.6, "F");
    const lines = doc.splitTextToSize(S(item), CW - 14);
    doc.text(lines, M.left + 9, y);
    y += lines.length * 3.3 + 2;
  }
  return y + 2;
}

// ---------------------------------------------------------------------------
// Page: Méthodologie Mimmoza
// ---------------------------------------------------------------------------

function buildMethodologiePage(doc: jsPDF): void {
  let y = investisseurPageTitle(doc, "M\u00e9thodologie Mimmoza", "Comment les scores sont calcul\u00e9s");

  y = writeParagraph(doc, y,
    "Le moteur d'analyse Mimmoza repose sur une approche multi-piliers qui croise des donn\u00e9es publiques (DVF, INSEE, BPE, cadastre) "
    + "avec les param\u00e8tres sp\u00e9cifiques du deal saisi par l'investisseur. Chaque score est calcul\u00e9 de mani\u00e8re ind\u00e9pendante, "
    + "puis agr\u00e9g\u00e9 dans le SmartScore selon une pond\u00e9ration configurable par profil."
  );

  y = writeSubheading(doc, y, "Principes fondamentaux");
  y = writeBullets(doc, y, [
    "Prudence par d\u00e9faut : toute donn\u00e9e manquante est p\u00e9nalis\u00e9e, jamais ignor\u00e9e. L'absence d'information joue contre le deal.",
    "Seuil de s\u00e9curit\u00e9 \u00e0 12% de marge brute : en dessous, l'op\u00e9ration est consid\u00e9r\u00e9e fragile face aux al\u00e9as courants.",
    "Stress testing syst\u00e9matique : chaque deal est soumis \u00e0 des sc\u00e9narios d\u00e9favorables (+10% travaux, -5% revente).",
    "Transparence : tous les calculs sont reproductibles \u00e0 partir des donn\u00e9es saisies. Aucune bo\u00eete noire.",
    "Score 0\u2013100 : chaque pilier produit un score normalis\u00e9. \"ND\" est affich\u00e9 si les donn\u00e9es sont insuffisantes.",
  ]);

  y = writeSubheading(doc, y, "Sources de donn\u00e9es");
  y = writeBullets(doc, y, [
    "DVF (Demandes de Valeurs Fonci\u00e8res) : transactions immobili\u00e8res r\u00e9elles, publi\u00e9es par la DGFiP. Utilis\u00e9 pour le benchmark prix/m\u00b2.",
    "INSEE : donn\u00e9es socio-d\u00e9mographiques communales (population, revenus, emploi).",
    "BPE (Base Permanente des \u00c9quipements) : commerces, services, transports \u00e0 proximit\u00e9.",
    "Cadastre / MAJIC : parcelles, surfaces, zones urbanistiques.",
    "Donn\u00e9es saisies par l'investisseur : prix d'achat, travaux, revente cible, frais de notaire.",
  ]);

  y = writeSubheading(doc, y, "Calcul du SmartScore");
  y = writeParagraph(doc, y,
    "Le SmartScore est une moyenne pond\u00e9r\u00e9e de plusieurs sous-scores (march\u00e9, risque, opportunit\u00e9, liquidit\u00e9). "
    + "Les poids d\u00e9pendent du profil investisseur (particulier, marchand de biens, promoteur, entreprise). "
    + "Un SmartScore >= 65 indique un deal solide, 40\u201365 un deal \u00e0 surveiller, < 40 un deal risqu\u00e9."
  );

  y = writeSubheading(doc, y, "Score Rentabilit\u00e9 (Investisseur)");
  y = writeParagraph(doc, y,
    "Mesure la capacit\u00e9 du deal \u00e0 g\u00e9n\u00e9rer du profit. Trois piliers : marge brute (50%), cushion vs seuil 12% (25%), "
    + "r\u00e9sistance au stress test revente -5% (25%). ND si moins de 2 piliers calculables."
  );

  y = writeSubheading(doc, y, "Score Robustesse (Investisseur)");
  y = writeParagraph(doc, y,
    "Mesure la r\u00e9sistance du deal aux al\u00e9as. Quatre piliers : surcote vs DVF (30%), donn\u00e9es manquantes critiques (25%), "
    + "dur\u00e9e de d\u00e9tention vs cible 18 mois (15%), cushion (30%). P\u00e9nalisation prudente si donn\u00e9e absente. ND si moins de 2 piliers avec donn\u00e9es r\u00e9elles."
  );
}

// ---------------------------------------------------------------------------
// Page: Pourquoi Mimmoza est plus prudent que le marché
// ---------------------------------------------------------------------------

function buildPrudencePage(doc: jsPDF): void {
  let y = investisseurPageTitle(doc, "Pourquoi Mimmoza est plus prudent que le march\u00e9", "Philosophie de protection investisseur");

  // Encadré principal
  const encadreH = 28;
  y = ensureSpace(doc, y, encadreH + 4);
  roundedBox(doc, M.left, y, CW, encadreH, 3, C.accentBg, C.accent, 0.4);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 2, 3, encadreH - 4, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C.accentDark);
  doc.text("L'objectif de Mimmoza n'est pas de valider des deals, mais de prot\u00e9ger l'investisseur.", M.left + 8, y + 7);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  const encLines = doc.splitTextToSize(S(
    "La plupart des outils du march\u00e9 surestiment les marges et sous-estiment les risques. "
    + "Mimmoza fait l'inverse : chaque inconnue est p\u00e9nalis\u00e9e, chaque hypoth\u00e8se est stress-test\u00e9e. "
    + "Un deal qui passe le filtre Mimmoza a une probabilit\u00e9 significativement plus \u00e9lev\u00e9e de se r\u00e9aliser dans les conditions pr\u00e9vues."
  ), CW - 16);
  doc.text(encLines, M.left + 8, y + 12);
  y += encadreH + 6;

  y = writeSubheading(doc, y, "Diff\u00e9rences cl\u00e9s avec les pratiques courantes");

  // Table comparison
  const compHead = [["Pratique march\u00e9", "Approche Mimmoza"]];
  const compBody = [
    ["Marge brute calcul\u00e9e sans frais de notaire", "Marge brute int\u00e9grant TOUS les co\u00fbts (notaire, travaux, portage)"],
    ["Travaux estim\u00e9s \"au doigt mouill\u00e9\"", "Exigence de devis chiffr\u00e9s + marge de s\u00e9curit\u00e9 15%"],
    ["Prix de revente bas\u00e9 sur l'optimisme", "Prix de revente benchmark\u00e9 vs DVF r\u00e9el"],
    ["Pas de stress test", "Stress test syst\u00e9matique (+10% travaux, -5% revente)"],
    ["Donn\u00e9es manquantes = ignor\u00e9es", "Donn\u00e9es manquantes = p\u00e9nalit\u00e9 sur le score"],
    ["Seuil de marge variable ou absent", "Seuil fixe \u00e0 12% de marge brute minimum"],
  ].map(r => r.map(S));

  autoTable(doc, {
    startY: y, head: compHead, body: compBody, theme: "grid",
    margin: { left: M.left, right: M.right }, tableWidth: CW,
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold", fontSize: 7 },
    bodyStyles: { fontSize: 7, textColor: C.slate900, cellPadding: { top: 3, bottom: 3, left: 5, right: 5 } },
    columnStyles: { 0: { cellWidth: CW / 2, fillColor: C.roseBg }, 1: { cellWidth: CW / 2, fillColor: C.emeraldBg } },
    styles: { lineColor: C.slate200, lineWidth: 0.15 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = writeSubheading(doc, y, "Cons\u00e9quence pour l'investisseur");
  y = writeParagraph(doc, y,
    "Un deal not\u00e9 GO par Mimmoza signifie que l'op\u00e9ration r\u00e9siste \u00e0 des al\u00e9as raisonnables et que les donn\u00e9es "
    + "disponibles sont suffisantes pour prendre une d\u00e9cision \u00e9clair\u00e9e. Un deal not\u00e9 GO AVEC R\u00c9SERVES ou NO GO "
    + "n'est pas forc\u00e9ment mauvais, mais n\u00e9cessite des v\u00e9rifications suppl\u00e9mentaires avant engagement."
  );
}

// ---------------------------------------------------------------------------
// Page: Charte d'Investissement Mimmoza
// ---------------------------------------------------------------------------

function buildChartePage(doc: jsPDF): void {
  let y = investisseurPageTitle(doc, "Charte d'Investissement Mimmoza", "Engagements et principes directeurs");

  const charteItems: { title: string; desc: string }[] = [
    {
      title: "1. Transparence totale",
      desc: "Tous les scores, calculs et hypoth\u00e8ses sont explicites et reproductibles. L'investisseur a acc\u00e8s \u00e0 chaque composante du score.",
    },
    {
      title: "2. Prudence syst\u00e9matique",
      desc: "Toute donn\u00e9e manquante p\u00e9nalise le score. Aucune hypoth\u00e8se optimiste n'est faite par d\u00e9faut. Le seuil de marge brute est fix\u00e9 \u00e0 12%.",
    },
    {
      title: "3. Ind\u00e9pendance de l'analyse",
      desc: "Mimmoza n'a aucun int\u00e9r\u00eat dans la transaction. L'analyse est objective et bas\u00e9e uniquement sur les donn\u00e9es fournies et les r\u00e9f\u00e9rences publiques.",
    },
    {
      title: "4. Stress testing obligatoire",
      desc: "Chaque deal est soumis \u00e0 au moins 3 sc\u00e9narios de stress avant d\u00e9cision. Le deal doit r\u00e9sister au sc\u00e9nario d\u00e9favorable pour obtenir un GO.",
    },
    {
      title: "5. Protection du capital",
      desc: "La priorit\u00e9 absolue est la pr\u00e9servation du capital investi. Le gain est secondaire par rapport \u00e0 la s\u00e9curit\u00e9 de l'investissement.",
    },
    {
      title: "6. Aide \u00e0 la d\u00e9cision, pas d\u00e9cision",
      desc: "Mimmoza fournit une analyse pour \u00e9clairer la d\u00e9cision de l'investisseur. La d\u00e9cision finale appartient toujours \u00e0 l'investisseur.",
    },
    {
      title: "7. Am\u00e9lioration continue",
      desc: "Les algorithmes sont r\u00e9guli\u00e8rement mis \u00e0 jour en fonction des retours terrain et de l'\u00e9volution des donn\u00e9es publiques disponibles.",
    },
  ];

  charteItems.forEach((item) => {
    y = ensureSpace(doc, y, 18);
    roundedBox(doc, M.left, y, CW, 5, 1.5, C.accentBg, C.accentLight, 0.15);
    doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 4, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
    doc.text(S(item.title), M.left + 6, y + 3.5);
    y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
    const dl = doc.splitTextToSize(S(item.desc), CW - 8);
    doc.text(dl, M.left + 4, y);
    y += dl.length * 3.4 + 4;
  });
}

// ---------------------------------------------------------------------------
// Page: Synthèse institutionnelle (banque / financement)
// ---------------------------------------------------------------------------

function buildSyntheseInstitutionnellePage(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const metrics = extractDealMetrics(snapshot, opts);
  const ai = opts?.aiReport ? normalizeAiReport(opts.aiReport) : null;
  const narrative = sanitizeForPdf(opts?.aiReport?.narrativeMarkdown ?? opts?.aiReport?.narrative ?? "");
  const creditScores = narrative ? extractFromNarrative(narrative).scores : {};
  const invScores: InvestisseurScores = {
    rentabilite: computeScoreRentabilite(metrics),
    robustesse: computeScoreRobustesse(metrics, ai, snapshot),
  };
  const dataConf = computeDataConfidence(metrics, ai, creditScores, snapshot);
  const smartScoreVal = creditScores["SmartScore"] ? Number(creditScores["SmartScore"]) : null;
  const riskClass = computeRiskClass(smartScoreVal, invScores.robustesse, invScores.rentabilite, dataConf);
  const deal: any = snapshot.deals.find((d) => d.id === snapshot.activeDealId) ?? {};

  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, "Synth\u00e8se institutionnelle (banque / financement)", "Lecture comit\u00e9 cr\u00e9dit");

  // ── Avertissement ────────────────────────────────────────────────────────
  roundedBox(doc, M.left, y, CW, 8, 2, C.amberBg, C.amberLight, 0.3);
  doc.setFillColor(...C.amber); doc.rect(M.left, y + 1, 2, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...C.amberDark);
  doc.text(S("Ce document est un outil d'aide \u00e0 la d\u00e9cision. Il ne constitue ni un conseil financier, ni une garantie de r\u00e9sultat."), M.left + 6, y + 5);
  y += 12;

  // ── Lecture en 20 secondes ───────────────────────────────────────────────
  y = ensureSpace(doc, y, 36);
  roundedBox(doc, M.left, y, CW, 6, 1.5, C.navy, undefined, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C.white);
  doc.text("Lecture en 20 secondes", M.left + 5, y + 4);
  y += 10;

  const verdictLabel = ai?.verdict ? decisionLabel(ai.verdict) : "ND";
  const classeLabel = riskClass.cls !== "ND" ? riskClass.label : "ND";
  const confLabel = `${dataConfidenceLabel(dataConf)} (${dataConf}/100)`;

  // Build short confidence reason
  const confReasons: string[] = [];
  if (metrics.travaux === 0) confReasons.push("travaux non chiffr\u00e9s");
  if (ai?.missingData && ai.missingData.length > 0) confReasons.push(`${ai.missingData.length} donn\u00e9e(s) critique(s) manquante(s)`);
  const confReasonStr = confReasons.length > 0 ? ` \u2014 ${confReasons.join(", ")}` : "";

  const lecture20Lines: [string, string, RGB][] = [
    ["Verdict", verdictLabel, ai?.verdict ? decisionColors(ai.verdict).text : C.slate500],
    ["Classe de risque", classeLabel, riskClass.color],
    ["Confiance donn\u00e9es", `${confLabel}${confReasonStr}`, dataConf >= 75 ? C.emeraldDark : dataConf >= 50 ? C.amberDark : C.roseDark],
  ];

  lecture20Lines.forEach(([label, value, color]) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C.slate600);
    doc.text(S(label + " :"), M.left + 4, y);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...color);
    doc.text(S(value), M.left + 42, y);
    y += 5;
  });
  y += 3;

  // ── Risque principal (1 phrase) ──────────────────────────────────────────
  y = ensureSpace(doc, y, 18);
  roundedBox(doc, M.left, y, CW, 5.5, 1.5, C.roseBg, C.roseLight, 0.2);
  doc.setFillColor(...C.rose); doc.rect(M.left, y + 0.5, 2, 4.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.roseDark);
  doc.text("Risque principal", M.left + 6, y + 3.8);
  y += 8;

  const riskFactors: string[] = [];
  if (metrics.cushion != null && metrics.cushion < 0) riskFactors.push("cushion n\u00e9gatif");
  else if (metrics.cushion != null && metrics.cushion < 3) riskFactors.push("cushion minimal");
  if (metrics.travaux === 0) riskFactors.push("travaux non chiffr\u00e9s");
  if (ai?.missingData && ai.missingData.length >= 2) riskFactors.push("donn\u00e9es critiques manquantes");
  if (metrics.premiumVsDvfPct != null && metrics.premiumVsDvfPct > 10) riskFactors.push("surcote DVF");

  const riskSentence = riskFactors.length > 0
    ? `${riskFactors.join(" + ")} > la marge peut passer sous le seuil au moindre al\u00e9a (travaux / d\u00e9lais / prix de sortie).`
    : "Aucun facteur de risque critique identifi\u00e9 sur la base des donn\u00e9es disponibles.";
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  const rl = doc.splitTextToSize(S(riskSentence), CW - 8);
  doc.text(rl, M.left + 4, y);
  y += rl.length * 3.4 + 5;

  // ── Conditions recommandées avant engagement ─────────────────────────────
  y = ensureSpace(doc, y, 30);
  roundedBox(doc, M.left, y, CW, 5.5, 1.5, C.accentBg, C.accentLight, 0.2);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 0.5, 2, 4.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
  doc.text("Conditions recommand\u00e9es avant engagement", M.left + 6, y + 3.8);
  y += 8;

  const conditions: string[] = [
    "Devis travaux chiffr\u00e9s (2\u20133 devis) + marge de s\u00e9curit\u00e9 15%",
    "Diagnostics complets fournis et analys\u00e9s (DPE, amiante, plomb, \u00e9lectricit\u00e9...)",
    "Validation donn\u00e9es critiques : type de bien, \u00e9tat, d\u00e9lais de commercialisation / d\u00e9tention",
  ];
  if (ai?.conditionsToBuy && ai.conditionsToBuy.length > 0) {
    const aiCond = sanitizeVerdictInProse(ai.conditionsToBuy[0]);
    // avoid duplicate if AI condition overlaps with the static ones
    if (!/devis|diagnostic/i.test(aiCond)) conditions.push(aiCond);
  }
  if (metrics.premiumVsDvfPct != null && metrics.premiumVsDvfPct > 15) {
    conditions.push("Clause ren\u00e9gociation si surcote DVF confirm\u00e9e > 15%");
  }
  // Plan B — optional
  const liq = creditScores["Probabilit\u00e9 revente"] ? Number(creditScores["Probabilit\u00e9 revente"]) : null;
  if (liq != null && liq < 50) {
    conditions.push("Plan B valid\u00e9 : location temporaire si revente retard\u00e9e");
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  conditions.slice(0, 5).forEach((cond) => {
    y = ensureSpace(doc, y, 8);
    doc.setFillColor(...C.accent); doc.circle(M.left + 5, y - 0.5, 0.6, "F");
    const cl = doc.splitTextToSize(S(cond), CW - 14);
    doc.text(cl, M.left + 9, y);
    y += cl.length * 3.3 + 2;
  });
  y += 3;

  // ── Déclencheurs NO GO ───────────────────────────────────────────────────
  y = ensureSpace(doc, y, 24);
  roundedBox(doc, M.left, y, CW, 5.5, 1.5, C.roseBg, C.roseLight, 0.2);
  doc.setFillColor(...C.rose); doc.rect(M.left, y + 0.5, 2, 4.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.roseDark);
  doc.text("D\u00e9clencheurs NO GO", M.left + 6, y + 3.8);
  y += 8;

  const noGo: string[] = [
    "Cushion < 0 (marge brute < 12%)",
    "Stress test -5% revente > marge < 5%",
    "Refus de fournir devis / diagnostics / donn\u00e9es critiques",
  ];

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  noGo.forEach((trigger) => {
    y = ensureSpace(doc, y, 8);
    doc.setFillColor(...C.rose); doc.circle(M.left + 5, y - 0.5, 0.6, "F");
    const tl = doc.splitTextToSize(S(trigger), CW - 14);
    doc.text(tl, M.left + 9, y);
    y += tl.length * 3.3 + 2;
  });
  y += 3;

  // ── Checklist comité ─────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 28);
  roundedBox(doc, M.left, y, CW, 5.5, 1.5, C.slate50, C.slate200, 0.2);
  doc.setFillColor(...C.navy); doc.rect(M.left, y + 0.5, 2, 4.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.navy);
  doc.text("Checklist comit\u00e9", M.left + 6, y + 3.8);
  y += 9;

  const isCopro = /copro|syndic|lot/i.test(
    String(deal.typeBien ?? deal.propertyType ?? deal.notes ?? ""),
  );

  const checklist: string[] = [
    "Devis + planning travaux valid\u00e9s",
    isCopro
      ? "PV AG des 3 derni\u00e8res ann\u00e9es + budget pr\u00e9visionnel charges + \u00e9tat impay\u00e9s"
      : "Charges et \u00e9tat du bien document\u00e9s (diagnostics, conformit\u00e9 urbanisme)",
    "Benchmark DVF par typologie (type de bien, surface, \u00e9tat) \u2014 pas seulement la m\u00e9diane commune",
  ];

  checklist.forEach((item, idx) => {
    y = ensureSpace(doc, y, 9);
    // numbered circle
    doc.setFillColor(...C.navy); doc.circle(M.left + 5, y, 2.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(6); doc.setTextColor(...C.white);
    doc.text(String(idx + 1), M.left + 5, y + 1, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
    const il = doc.splitTextToSize(S(item), CW - 16);
    doc.text(il, M.left + 10, y);
    y += il.length * 3.3 + 3;
  });
}

// ---------------------------------------------------------------------------
// Page: Appendice – Formules SmartScore
// ---------------------------------------------------------------------------

function buildFormulasPage(doc: jsPDF): void {
  let y = investisseurPageTitle(doc, "Appendice \u2014 Formules SmartScore", "D\u00e9tail des calculs et pond\u00e9rations");

  y = writeParagraph(doc, y,
    "Cette section d\u00e9taille les formules utilis\u00e9es pour calculer les scores Mimmoza. "
    + "Tous les scores sont normalis\u00e9s sur une \u00e9chelle de 0 \u00e0 100. \"ND\" est affich\u00e9 lorsque les donn\u00e9es sont insuffisantes."
  );

  // SmartScore
  y = writeSubheading(doc, y, "SmartScore (0\u2013100)");
  y = writeParagraph(doc, y, "SmartScore = w1 x ScoreMarche + w2 x ScoreRisque + w3 x ScoreOpportunite + w4 x ScoreLiquidite");
  y = writeParagraph(doc, y,
    "Les poids (w1..w4) d\u00e9pendent du profil : Marchand (march\u00e9 30%, risque 30%, opportunit\u00e9 20%, liquidit\u00e9 20%), "
    + "Particulier (march\u00e9 25%, risque 35%, opportunit\u00e9 15%, liquidit\u00e9 25%)."
  );

  // Marge brute
  y = writeSubheading(doc, y, "Marge brute");
  y = writeParagraph(doc, y,
    "Marge brute (%) = (Prix revente - Prix achat) / Prix achat x 100. "
    + "Seuil Mimmoza : 12%. Cushion = Marge brute - 12."
  );

  // RiskPressureIndex
  y = writeSubheading(doc, y, "RiskPressureIndex (0\u2013100)");
  y = writeParagraph(doc, y,
    "Indice cumulatif de facteurs d\u00e9favorables. Chaque facteur (surcote, donn\u00e9es manquantes, charges \u00e9lev\u00e9es, "
    + "copropri\u00e9t\u00e9 fragile, march\u00e9 tendu) ajoute des points de pression. Plus le score est \u00e9lev\u00e9, plus le risque cumul\u00e9 est important."
  );

  // Score Rentabilité
  y = writeSubheading(doc, y, "Score Rentabilit\u00e9 (0\u2013100) \u2014 Mode Investisseur");
  y = writeBullets(doc, y, [
    "Pilier 1 (50%) : Marge brute. 0% > 0, 12% > 48, 25% > 100.",
    "Pilier 2 (25%) : Cushion vs seuil 12%. Cushion -5 > 0, 0 > 40, 8 > 100.",
    "Pilier 3 (25%) : Stress revente -5%. Marge post-stress 0% > 0, 12% > 67, 18% > 100.",
    "ND si moins de 2 piliers calculables.",
  ]);

  // Score Robustesse
  y = writeSubheading(doc, y, "Score Robustesse (0\u2013100) \u2014 Mode Investisseur");
  y = writeBullets(doc, y, [
    "Pilier 1 (30%) : Surcote vs DVF. D\u00e9cote -10% > 100, 0% > 75, +20% > 10. P\u00e9nalisation \u00e0 35 si ND.",
    "Pilier 2 (25%) : Donn\u00e9es manquantes. 0 manquantes > 100, 5+ > 5. P\u00e9nalisation \u00e0 30 si pas d'IA.",
    "Pilier 3 (15%) : Dur\u00e9e d\u00e9tention vs 18 mois. 12 mois > 100, 48 mois > 0. P\u00e9nalisation \u00e0 45 si ND.",
    "Pilier 4 (30%) : Cushion. Cushion -5 > 0, 0 > 40, 8 > 100. P\u00e9nalisation \u00e0 25 si ND.",
    "ND si moins de 2 piliers avec donn\u00e9es r\u00e9elles (hors p\u00e9nalisations).",
  ]);

  // Probabilité revente
  y = writeSubheading(doc, y, "Probabilit\u00e9 de revente / Liquidit\u00e9 (0\u2013100)");
  y = writeParagraph(doc, y,
    "Estim\u00e9e \u00e0 partir du volume de transactions DVF sur la commune, du d\u00e9lai moyen de commercialisation "
    + "observ\u00e9, et de la tension du march\u00e9 local. > 60 = march\u00e9 fluide, < 40 = revente potentiellement longue."
  );

  // OpportunityScore
  y = writeSubheading(doc, y, "OpportunityScore (0\u2013100)");
  y = writeParagraph(doc, y,
    "Potentiel de surperformance bas\u00e9 sur la d\u00e9cote par rapport au march\u00e9, la dynamique de prix locale, "
    + "la qualit\u00e9 de l'emplacement (proximit\u00e9 transports, commerces, \u00e9coles), et le potentiel de valorisation par travaux."
  );

  // Data Confidence
  y = writeSubheading(doc, y, "Confiance Donn\u00e9es (0\u2013100) \u2014 Mode Investisseur");
  y = writeBullets(doc, y, [
    "Base = Compl\u00e9tude (%) si disponible, sinon 60.",
    "-10 par donn\u00e9e critique manquante (cap \u00e0 -30).",
    "-10 si aucun montant travaux renseign\u00e9.",
    "-10 si aucune dur\u00e9e de d\u00e9tention renseign\u00e9e.",
    "Clamp\u00e9 entre 0 et 100. Label : >= 75 \u00c9lev\u00e9e, 50\u201374 Moyenne, < 50 Faible.",
  ]);

  // Risk Class
  y = writeSubheading(doc, y, "Classe de Risque (A/B/C/D) \u2014 Mode Investisseur");
  y = writeBullets(doc, y, [
    "A (Robuste) : SmartScore >= 70, Robustesse >= 65, Rentabilit\u00e9 >= 60, Confiance >= 75 (si dispo).",
    "B (Viable) : SmartScore >= 60, Robustesse >= 55.",
    "C (Fragile) : SmartScore >= 45, Robustesse >= 40.",
    "D (Risque \u00e9lev\u00e9) : SmartScore < 45 OU Robustesse < 40.",
    "ND si SmartScore et Robustesse tous deux indisponibles.",
  ]);
}

// ---------------------------------------------------------------------------
// Page: Glossaire
// ---------------------------------------------------------------------------

function buildGlossairePage(doc: jsPDF): void {
  let y = investisseurPageTitle(doc, "Glossaire", "D\u00e9finitions des termes utilis\u00e9s dans ce rapport");

  const glossary: [string, string][] = [
    ["Classe de risque", "Classification A/B/C/D du deal. A = robuste, B = viable, C = fragile (s\u00e9curisation obligatoire), D = risque \u00e9lev\u00e9 (NO GO probable). Bas\u00e9e sur SmartScore, Robustesse, Rentabilit\u00e9 et Confiance donn\u00e9es."],
    ["Confiance donn\u00e9es", "Score 0\u2013100 mesurant la fiabilit\u00e9 de l'analyse. Bas\u00e9 sur la compl\u00e9tude du dossier, le nombre de donn\u00e9es critiques manquantes, et la pr\u00e9sence de devis/dur\u00e9es. >= 75 \u00c9lev\u00e9e, 50\u201374 Moyenne, < 50 Faible."],
    ["Cushion", "Diff\u00e9rence en points de pourcentage entre la marge brute du deal et le seuil de s\u00e9curit\u00e9 Mimmoza de 12%. Un cushion de 3 pts signifie une marge brute de 15%."],
    ["DVF", "Demandes de Valeurs Fonci\u00e8res. Base de donn\u00e9es publique des transactions immobili\u00e8res r\u00e9alis\u00e9es en France, publi\u00e9e par la DGFiP."],
    ["GO / NO GO", "Verdicts Mimmoza. GO = le deal passe les seuils de s\u00e9curit\u00e9. GO AVEC R\u00c9SERVES = le deal n\u00e9cessite des v\u00e9rifications. NO GO = le deal ne passe pas les seuils."],
    ["Marge brute", "Pourcentage de gain brut calcul\u00e9 comme (Prix revente - Prix achat) / Prix achat x 100. Ne prend pas en compte les frais de portage."],
    ["ND", "Non Disponible. Affich\u00e9 lorsqu'une donn\u00e9e n\u00e9cessaire au calcul est manquante, nulle, ou non calculable."],
    ["OpportunityScore", "Score mesurant le potentiel de surperformance d'un deal par rapport au march\u00e9 local (0\u2013100)."],
    ["PLU", "Plan Local d'Urbanisme. Document r\u00e9glementaire d\u00e9finissant les r\u00e8gles de construction et d'am\u00e9nagement \u00e0 l'\u00e9chelle communale."],
    ["Premium vs DVF", "Surcote ou d\u00e9cote du prix d'acquisition par rapport au prix m\u00e9dian DVF du march\u00e9 local. Positif = surcote, n\u00e9gatif = d\u00e9cote."],
    ["Profil cible", "Profil d'investisseur recommand\u00e9 pour le deal : Patrimonial prudent (risque faible), Marchand exp\u00e9riment\u00e9 (risque mod\u00e9r\u00e9), ou Investisseur opportuniste (risque \u00e9lev\u00e9). D\u00e9termin\u00e9 par la robustesse, la liquidit\u00e9 et le cushion."],
    ["RiskPressureIndex", "Indice cumulatif de pression risque (0\u2013100). Chaque facteur d\u00e9favorable ajoute des points. Plus c'est bas, mieux c'est."],
    ["Score Rentabilit\u00e9", "Score sp\u00e9cifique au mode Investisseur (0\u2013100) mesurant la capacit\u00e9 du deal \u00e0 g\u00e9n\u00e9rer du profit apr\u00e8s int\u00e9gration des risques."],
    ["Score Robustesse", "Score sp\u00e9cifique au mode Investisseur (0\u2013100) mesurant la r\u00e9sistance du deal face aux al\u00e9as (travaux, march\u00e9, d\u00e9lais)."],
    ["SmartScore", "Score global Mimmoza (0\u2013100), moyenne pond\u00e9r\u00e9e de sous-scores adapt\u00e9e au profil investisseur."],
    ["Stress test", "Simulation de sc\u00e9narios d\u00e9favorables appliqu\u00e9s au deal (ex: travaux +10%, revente -5%) pour tester sa r\u00e9silience."],
    ["Surcote", "Diff\u00e9rence positive entre le prix d'acquisition et la r\u00e9f\u00e9rence march\u00e9 DVF. Une surcote \u00e9lev\u00e9e (>10\u201315%) est un signal de risque."],
  ];

  glossary.forEach(([term, definition]) => {
    y = ensureSpace(doc, y, 14);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
    doc.text(S(term), M.left + 3, y);
    y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C.slate700);
    const dl = doc.splitTextToSize(S(definition), CW - 8);
    doc.text(dl, M.left + 3, y);
    y += dl.length * 3.2 + 3;
    // Separator
    doc.setDrawColor(...C.slate200); doc.setLineWidth(0.1);
    doc.line(M.left + 3, y - 1, PW - M.right - 3, y - 1);
  });
}

// ---------------------------------------------------------------------------
// PAGE: Comprendre le deal simplement (Investisseur only, après Synthèse)
// ---------------------------------------------------------------------------

function buildComprendreDealPage(doc: jsPDF, snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const metrics = extractDealMetrics(snapshot, opts);
  const ai = opts?.aiReport ? normalizeAiReport(opts.aiReport) : null;
  const narrative = sanitizeForPdf(opts?.aiReport?.narrativeMarkdown ?? opts?.aiReport?.narrative ?? "");
  const scores = narrative ? extractFromNarrative(narrative).scores : {};
  const deal: any = snapshot.deals.find((d) => d.id === snapshot.activeDealId) ?? {};

  doc.addPage();
  let y = M.top + 4;
  y = sectionTitle(doc, y, "Comprendre le deal simplement", "Lecture p\u00e9dagogique pour investisseurs");

  // Intro
  roundedBox(doc, M.left, y, CW, 10, 2.5, C.accentBg, C.accentLight, 0.2);
  doc.setFillColor(...C.accent); doc.rect(M.left, y + 1, 2, 8, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  const introLines = doc.splitTextToSize(
    S("Cette page traduit les donn\u00e9es du dossier en langage clair. Elle ne remplace pas l'analyse d\u00e9taill\u00e9e, "
    + "mais vous permet de comprendre en 2 minutes l'essentiel de ce deal : o\u00f9 est le gain, o\u00f9 est le risque, "
    + "ce qui manque, et comment un investisseur chevronn\u00e9 aborderait cette op\u00e9ration."),
    CW - 12,
  );
  doc.text(introLines, M.left + 6, y + 4);
  y += 14;

  // ────────────────────────────────────────────────────────────────────────
  // 1. Ce qui peut vous faire gagner de l'argent
  // ────────────────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 30);
  y = _comprendreSubheading(doc, y, "1", "Ce qui peut vous faire gagner de l'argent", C.emerald, C.emeraldBg);

  const gains: string[] = [];

  if (metrics.margeBrute != null && metrics.margeBrute > 0) {
    const reventeLabel = metrics.prixRevente > 0 ? ` (revente cible ${fmtCurrency(metrics.prixRevente)})` : "";
    gains.push(
      metrics.margeBrute >= 12
        ? `La marge brute est de ${fmtPercent(metrics.margeBrute)}${reventeLabel}. C'est au-dessus du seuil de s\u00e9curit\u00e9 de 12% : l'op\u00e9ration d\u00e9gage un b\u00e9n\u00e9fice m\u00eame apr\u00e8s impr\u00e9vus mod\u00e9r\u00e9s.`
        : `La marge brute est de ${fmtPercent(metrics.margeBrute)}${reventeLabel}. C'est en dessous de 12%, ce qui laisse peu de place aux al\u00e9as \u2014 mais reste un gain si tout se passe comme pr\u00e9vu.`,
    );
  }
  if (metrics.premiumVsDvfPct != null && metrics.premiumVsDvfPct < 0) {
    gains.push(`Vous achetez ${fmtPercent(Math.abs(metrics.premiumVsDvfPct))} en dessous du prix m\u00e9dian du march\u00e9 (DVF). C'est une d\u00e9cote : vous payez moins que ce que les autres ont pay\u00e9 r\u00e9cemment pour des biens similaires.`);
  }
  if (metrics.travaux > 0 && metrics.prixRevente > 0) {
    const plusValue = metrics.prixRevente - metrics.prixAchat - metrics.travaux;
    if (plusValue > 0) {
      gains.push(`Apr\u00e8s travaux (${fmtCurrency(metrics.travaux)}), la plus-value estim\u00e9e est de ${fmtCurrency(plusValue)}. Les travaux cr\u00e9ent de la valeur si les devis sont respect\u00e9s.`);
    }
  }
  const liq = scores["Probabilit\u00e9 revente"] ? Number(scores["Probabilit\u00e9 revente"]) : null;
  if (liq != null && liq >= 60) {
    gains.push("Le march\u00e9 local est assez fluide : des biens comparables se vendent dans des d\u00e9lais raisonnables. C'est un atout pour la revente.");
  }
  if (ai?.strengths && ai.strengths.length > 0) {
    gains.push(ai.strengths[0]);
  }
  if (gains.length === 0) {
    gains.push("Les donn\u00e9es disponibles ne permettent pas d'identifier clairement les leviers de gain. Compl\u00e9tez le dossier (prix de revente, devis travaux) pour y voir plus clair.");
  }

  y = _comprendreBullets(doc, y, gains, C.emerald);

  // ────────────────────────────────────────────────────────────────────────
  // 2. Ce qui peut vous faire perdre de l'argent
  // ────────────────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 30);
  y = _comprendreSubheading(doc, y, "2", "Ce qui peut vous faire perdre de l'argent", C.rose, C.roseBg);

  const risks: string[] = [];

  if (metrics.margeBrute != null && metrics.margeBrute < 12) {
    risks.push(`Avec une marge brute de ${fmtPercent(metrics.margeBrute)}, un seul al\u00e9a (travaux plus chers, revente plus basse, d\u00e9lai plus long) peut transformer le gain en perte.`);
  }
  if (metrics.premiumVsDvfPct != null && metrics.premiumVsDvfPct > 10) {
    risks.push(`Vous payez ${fmtPercent(metrics.premiumVsDvfPct)} au-dessus du prix du march\u00e9 DVF. Si le march\u00e9 ne monte pas, vous revendrez en dessous de votre prix d'achat.`);
  }
  if (metrics.travaux === 0) {
    risks.push("Aucun budget travaux n'est chiffr\u00e9. Dans la r\u00e9alit\u00e9, m\u00eame un bien \"en bon \u00e9tat\" r\u00e9serve des surprises. Sans devis, le risque r\u00e9el est inconnu.");
  } else if (metrics.travaux > 0 && metrics.prixAchat > 0) {
    const travauxPct = (metrics.travaux / metrics.prixAchat) * 100;
    if (travauxPct > 20) {
      risks.push(`Les travaux repr\u00e9sentent ${fmtPercent(travauxPct)} du prix d'achat. Un d\u00e9rapage de 15\u201320% (fr\u00e9quent en r\u00e9novation) changerait le verdict.`);
    }
  }
  const rpi = scores["RiskPressureIndex"] ? Number(scores["RiskPressureIndex"]) : null;
  if (rpi != null && rpi >= 50) {
    risks.push(`L'indice de pression risque est \u00e9lev\u00e9 (${rpi}/100). Plusieurs facteurs d\u00e9favorables se cumulent, ce qui augmente la probabilit\u00e9 d'un sc\u00e9nario n\u00e9gatif.`);
  }
  if (liq != null && liq < 40) {
    risks.push("La liquidit\u00e9 du march\u00e9 local est faible : si vous devez revendre vite, il sera difficile de trouver un acheteur au prix souhait\u00e9.");
  }
  if (ai?.vigilances && ai.vigilances.length > 0 && risks.length < 4) {
    risks.push(ai.vigilances[0]);
  }
  if (risks.length === 0) {
    risks.push("Aucun facteur de perte critique identifi\u00e9 avec les donn\u00e9es disponibles. Mais attention : l'absence d'alerte peut venir d'un manque de donn\u00e9es, pas d'un risque nul.");
  }

  y = _comprendreBullets(doc, y, risks, C.rose);

  // ────────────────────────────────────────────────────────────────────────
  // 3. Ce qui manque pour décider sereinement
  // ────────────────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 30);
  y = _comprendreSubheading(doc, y, "3", "Ce qui manque pour d\u00e9cider sereinement", C.amber, C.amberBg);

  const missing: string[] = [];

  if (metrics.travaux === 0) {
    missing.push("Devis travaux : sans chiffrage pr\u00e9cis, impossible de savoir si la marge est r\u00e9elle. Obtenez 2\u20133 devis avant toute offre.");
  }
  if (metrics.prixRevente === 0) {
    missing.push("Prix de revente cible : sans objectif de revente, aucun calcul de marge n'est possible. Estimez un prix r\u00e9aliste en vous basant sur les ventes DVF r\u00e9centes.");
  }
  const duree = Number(deal.dureeDetention ?? deal.holdingPeriodMonths ?? 0);
  if (duree === 0) {
    missing.push("Dur\u00e9e de d\u00e9tention : combien de temps allez-vous porter le bien ? 12 mois et 36 mois ne donnent pas le m\u00eame co\u00fbt de portage ni le m\u00eame risque.");
  }
  if (ai?.missingData && ai.missingData.length > 0) {
    const displayedAlready = new Set(["devis travaux", "prix de revente", "dur\u00e9e"]);
    for (const md of ai.missingData) {
      const lower = md.toLowerCase();
      const isDuplicate = [...displayedAlready].some((k) => lower.includes(k));
      if (!isDuplicate && missing.length < 5) {
        missing.push(`${md} : donn\u00e9e manquante identifi\u00e9e par l'analyse IA. \u00c0 obtenir avant engagement.`);
      }
    }
  }
  const completude = scores["Compl\u00e9tude"] ? Number(scores["Compl\u00e9tude"]) : null;
  if (completude != null && completude < 60) {
    missing.push(`Le dossier n'est compl\u00e9t\u00e9 qu'\u00e0 ${completude}%. Plus de la moiti\u00e9 des informations n\u00e9cessaires sont absentes : la d\u00e9cision est fragile.`);
  }
  if (missing.length === 0) {
    missing.push("Les donn\u00e9es principales semblent pr\u00e9sentes. V\u00e9rifiez quand m\u00eame les diagnostics, l'\u00e9tat de la copropri\u00e9t\u00e9 et les conditions de financement.");
  }

  y = _comprendreBullets(doc, y, missing, C.amber);

  // ────────────────────────────────────────────────────────────────────────
  // 4. Ce que ferait un investisseur expérimenté
  // ────────────────────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 30);
  y = _comprendreSubheading(doc, y, "4", "Ce que ferait un investisseur exp\u00e9riment\u00e9", C.accent, C.accentBg);

  const actions: string[] = [];

  // Négociation
  if (metrics.prixAchat > 0) {
    const negoPct = metrics.premiumVsDvfPct != null && metrics.premiumVsDvfPct > 5 ? "8\u201312" : "5\u20138";
    actions.push(`N\u00e9gocier le prix d'achat de ${negoPct}% minimum. Chaque euro \u00e9conomis\u00e9 \u00e0 l'achat am\u00e9liore directement la marge.`);
  }

  // Devis
  actions.push("Obtenir au moins 2 devis travaux d\u00e9taill\u00e9s avant de signer quoi que ce soit, et pr\u00e9voir une marge de 15% pour impr\u00e9vus.");

  // Conditions suspensives
  actions.push("Ins\u00e9rer des conditions suspensives solides dans le compromis : financement, diagnostics conformes, absence de vice cach\u00e9, devis valid\u00e9s.");

  // Plan B
  if (liq != null && liq < 50) {
    actions.push("Pr\u00e9parer un plan B (location meubl\u00e9e ou longue dur\u00e9e) au cas o\u00f9 la revente prend plus de temps que pr\u00e9vu. Calculer le loyer minimum pour couvrir les mensualit\u00e9s.");
  } else {
    actions.push("Avoir un plan B en t\u00eate : si la revente tarde, pouvez-vous louer le bien pour couvrir le co\u00fbt de portage ?");
  }

  // Seuil
  if (metrics.margeBrute != null && metrics.margeBrute < 12) {
    const targetPrice = metrics.prixRevente > 0 ? Math.round(metrics.prixRevente / 1.12) : null;
    const targetLine = targetPrice != null ? ` (soit un prix d'achat maximum de ~${fmtCurrency(targetPrice)})` : "";
    actions.push(`Ne pas acheter tant que la marge brute n'atteint pas 12%${targetLine}. En dessous, le risque n'est pas r\u00e9mun\u00e9r\u00e9.`);
  }

  // Walk away
  actions.push("Savoir dire non : un bon investisseur rate volontairement 9 deals sur 10. Le deal d'apr\u00e8s sera meilleur.");

  y = _comprendreBullets(doc, y, actions.slice(0, 6), C.accent);

  // ── Pied de page pédagogique ─────────────────────────────────────────────
  y = ensureSpace(doc, y, 12);
  doc.setDrawColor(...C.slate200); doc.setLineWidth(0.2); doc.line(M.left, y, PW - M.right, y);
  y += 4;
  doc.setFont("helvetica", "italic"); doc.setFontSize(6.5); doc.setTextColor(...C.slate400);
  const footLines = doc.splitTextToSize(
    S("Cette lecture simplifi\u00e9e est g\u00e9n\u00e9r\u00e9e \u00e0 partir des donn\u00e9es du dossier. Elle ne constitue pas un conseil en investissement. "
    + "Les sections suivantes du rapport fournissent l'analyse d\u00e9taill\u00e9e, les stress tests et le plan d'action complet."),
    CW - 4,
  );
  doc.text(footLines, M.left + 2, y);
}

// ── Comprendre: sub-heading with numbered circle ───────────────────────────

function _comprendreSubheading(doc: jsPDF, y: number, num: string, title: string, color: RGB, bg: RGB): number {
  roundedBox(doc, M.left, y, CW, 7, 1.5, bg, undefined, 0);
  doc.setFillColor(...color); doc.rect(M.left, y + 0.5, 2, 6, "F");

  // Number circle
  doc.setFillColor(...color); doc.circle(M.left + 7, y + 3.5, 3, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...C.white);
  doc.text(num, M.left + 7, y + 4.5, { align: "center" });

  // Title
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...color);
  doc.text(S(title), M.left + 13, y + 4.5);
  return y + 10;
}

// ── Comprendre: bullet list ────────────────────────────────────────────────

function _comprendreBullets(doc: jsPDF, y: number, items: string[], color: RGB): number {
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...C.slate700);
  for (const item of items) {
    y = ensureSpace(doc, y, 10);
    doc.setFillColor(...color); doc.circle(M.left + 5, y - 0.5, 0.7, "F");
    const lines = doc.splitTextToSize(S(item), CW - 15);
    doc.text(lines, M.left + 9, y);
    y += lines.length * 3.4 + 2.5;
  }
  return y + 3;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

export function exportSnapshotToPdf(snapshot: MarchandSnapshotV1, opts?: ExportPdfOpts): void {
  const space = opts?.space ?? "marchand";
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // 1. Cover
  buildCoverPage(doc, snapshot);

  // 2. Décision & Synthèse (page 1 utile)
  buildDecisionSynthesePage(doc, snapshot, opts);

  // 2b. Comprendre le deal simplement (investisseur uniquement)
  if (space === "investisseur") {
    buildComprendreDealPage(doc, snapshot, opts);
  }

  // 2c. Synthèse institutionnelle (investisseur uniquement — banque / financement)
  if (space === "investisseur") {
    buildSyntheseInstitutionnellePage(doc, snapshot, opts);
  }

  // 3. Radar Risk vs Upside
  buildRadarPage(doc, snapshot, opts);

  // 4. Capital at Risk
  buildCapitalAtRiskPage(doc, snapshot, opts);

  // 5. Fiche Opération + Portefeuille
  doc.addPage();
  let y = M.top + 4;
  y = buildDealSection(doc, y, snapshot);
  y = buildAllDealsSection(doc, y, snapshot);

  // 6. Due Diligence
  y = buildDueDiligenceSection(doc, y, opts?.context?.dueDiligence);

  // 7. Analyse IA (nettoyée — pas de doublon verdict/résumé)
  y = buildAiSection(doc, y, opts?.aiReport);

  // 8. Plan d'action (dernière page obligatoire)
  buildActionPlanPage(doc, snapshot, opts);

  // 9. Investisseur-only appendix pages
  if (space === "investisseur") {
    buildMethodologiePage(doc);
    buildPrudencePage(doc);
    buildChartePage(doc);
    buildFormulasPage(doc);
    buildGlossairePage(doc);
  }

  // Header / Footer
  addHeaderFooter(doc, snapshot, opts);

  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const slug = (deal?.title ?? "export").replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, "").replace(/\s+/g, "-").toLowerCase().slice(0, 40);
  doc.save("dossier-investisseur-" + slug + ".pdf");
}

export function exportSnapshotToPdfPrint(snapshot: MarchandSnapshotV1, _opts?: ExportPdfOpts): void {
  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Dossier Investisseur</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#1e293b}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:11px}th{background:#f8fafc;font-weight:600;width:180px}</style></head><body><h1>Dossier Investisseur</h1><p>Date : " + new Date().toLocaleDateString("fr-FR") + "</p></body></html>";
  const win = window.open("", "_blank"); if (!win) return;
  win.document.write(html); win.document.close(); win.focus(); win.print();
}