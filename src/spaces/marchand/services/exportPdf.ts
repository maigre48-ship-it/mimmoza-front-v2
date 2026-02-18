// src/spaces/marchand/services/exportPdf.ts

import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportPdfOpts {
  aiReport?: {
    // ── New format (from export-report-v1) ──
    analysis?: {
      verdict?: string;
      confidence?: number; // 0..1
      executiveSummary?: string;
      strengths?: string[];
      vigilances?: string[];
      sensitivities?: string[];
      actionPlan?: string[];
      missingData?: string[];
    };
    // ── Legacy format ──
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
// Normalized AI data (used internally by buildAiSection)
// ---------------------------------------------------------------------------

interface NormalizedAi {
  verdict: string;
  confidencePct: string;
  executiveSummary: string;
  strengths: string[];
  vigilances: string[];
  sensitivities: string[];
  actionPlan: string[];
  missingData: string[];
  generatedAt: string;
  narrativeMarkdown: string;
}

function normalizeAiReport(ai: NonNullable<ExportPdfOpts["aiReport"]>): NormalizedAi | null {
  const a = ai.analysis;

  // Determine verdict
  const verdict = a?.verdict ?? ai.decision ?? "";

  // Confidence (0..1 → "72 %")
  const rawConf = a?.confidence ?? ai.confidence;
  const confidencePct =
    rawConf !== undefined && rawConf !== null
      ? Math.round(Number(rawConf) * 100) + " %"
      : "";

  const executiveSummary = a?.executiveSummary ?? ai.executiveSummary ?? "";
  const strengths = a?.strengths ?? ai.strengths ?? [];
  const vigilances = a?.vigilances ?? ai.redFlags ?? [];
  const sensitivities = a?.sensitivities ?? [];
  const actionPlan = a?.actionPlan ?? ai.actionPlan ?? [];
  const missingData = a?.missingData ?? [];
  const generatedAt = ai.generatedAt ?? "";
  const narrativeMarkdown = ai.narrativeMarkdown ?? ai.narrative ?? "";

  // If absolutely nothing exploitable, return null
  const hasContent =
    verdict ||
    executiveSummary ||
    strengths.length > 0 ||
    vigilances.length > 0 ||
    sensitivities.length > 0 ||
    actionPlan.length > 0 ||
    missingData.length > 0 ||
    narrativeMarkdown;

  if (!hasContent) return null;

  return {
    verdict,
    confidencePct,
    executiveSummary,
    strengths,
    vigilances,
    sensitivities,
    actionPlan,
    missingData,
    generatedAt,
    narrativeMarkdown,
  };
}

// ---------------------------------------------------------------------------
// Colors (RGB tuples)
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const C = {
  indigo: [99, 102, 241] as RGB,
  indigoLight: [238, 242, 255] as RGB,
  indigoDark: [67, 56, 202] as RGB,
  violet: [139, 92, 246] as RGB,
  slate900: [15, 23, 42] as RGB,
  slate700: [51, 65, 85] as RGB,
  slate500: [100, 116, 139] as RGB,
  slate400: [148, 163, 184] as RGB,
  slate200: [226, 232, 240] as RGB,
  slate100: [241, 245, 249] as RGB,
  slate50: [248, 250, 252] as RGB,
  white: [255, 255, 255] as RGB,
  green: [22, 163, 74] as RGB,
  greenBg: [240, 253, 244] as RGB,
  amber: [202, 138, 4] as RGB,
  amberBg: [254, 252, 232] as RGB,
  red: [220, 38, 38] as RGB,
  redBg: [254, 242, 242] as RGB,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decisionLabel(d?: string): string {
  switch (d) {
    case "GO": return "GO";
    case "GO_AVEC_RESERVES": return "GO avec reserves";
    case "NO_GO": return "NO GO";
    default: return d ?? "-";
  }
}

function decisionColors(d?: string): { text: RGB; bg: RGB } {
  if (!d) return { text: C.slate500, bg: C.slate50 };
  const s = String(d).toUpperCase();
  if (s === "GO") return { text: C.green, bg: C.greenBg };
  if (s === "GO_AVEC_RESERVES" || s === "GO AVEC RESERVES") return { text: C.amber, bg: C.amberBg };
  if (s === "NO_GO" || s === "NO GO" || s === "NOGO") return { text: C.red, bg: C.redBg };
  // Fallback heuristic
  if (/go/i.test(s) && /reserve/i.test(s)) return { text: C.amber, bg: C.amberBg };
  if (/no/i.test(s)) return { text: C.red, bg: C.redBg };
  if (/go/i.test(s)) return { text: C.green, bg: C.greenBg };
  return { text: C.slate500, bg: C.slate50 };
}

function statusColors(status?: string): { text: RGB; bg: RGB } {
  if (!status) return { text: C.slate500, bg: C.slate50 };
  const s = String(status).toLowerCase();
  if (/ok|valid|pass|conforme|vert|green/.test(s)) return { text: C.green, bg: C.greenBg };
  if (/warn|alerte|attention|orange|yellow/.test(s)) return { text: C.amber, bg: C.amberBg };
  if (/critical|critique|fail|ko|rouge|red/.test(s)) return { text: C.red, bg: C.redBg };
  return { text: C.slate500, bg: C.slate50 };
}

function fmtDate(): string {
  return new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtDateTime(): string {
  return new Date().toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtCurrency(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function isCurrencyField(label: string): boolean {
  return /prix|marge|travaux|frais|montant/i.test(label);
}

function truncate(text: string, maxLen = 2500): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "\n[...]";
}

// Page dimensions (mm, A4)
const PW = 210;
const PH = 297;
const M = { top: 20, right: 16, bottom: 22, left: 16 };
const CW = PW - M.left - M.right; // content width

// ---------------------------------------------------------------------------
// Header / Footer (all pages except page 1 = cover)
// ---------------------------------------------------------------------------

function addHeaderFooter(doc: jsPDF): void {
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    // Header
    doc.setDrawColor(...C.slate200);
    doc.setLineWidth(0.3);
    doc.line(M.left, 12, PW - M.right, 12);
    doc.setFontSize(7);
    doc.setTextColor(...C.slate400);
    doc.setFont("helvetica", "normal");
    doc.text("Mimmoza \u2014 Dossier Investisseur", M.left, 10);
    doc.text(fmtDateTime(), PW - M.right, 10, { align: "right" });
    // Footer
    doc.line(M.left, PH - 14, PW - M.right, PH - 14);
    doc.text(`Page ${i - 1} / ${total - 1}`, PW - M.right, PH - 10, { align: "right" });
    doc.text("Confidentiel", M.left, PH - 10);
  }
}

// ---------------------------------------------------------------------------
// Section title
// ---------------------------------------------------------------------------

function sectionTitle(doc: jsPDF, y: number, title: string): number {
  if (y > PH - 50) { doc.addPage(); y = M.top + 4; }
  y += 6;
  doc.setFillColor(...C.indigo);
  doc.rect(M.left, y, CW, 0.8, "F");
  y += 7;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.slate900);
  doc.text(title, M.left, y);
  y += 5;
  return y;
}

// ---------------------------------------------------------------------------
// Cover page  (NO GState, NO opacity — only solid primitives)
// ---------------------------------------------------------------------------

function buildCoverPage(doc: jsPDF, snapshot: MarchandSnapshotV1): void {
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const title = deal?.title ?? "Sans titre";
  const dealId = deal?.id ?? "-";
  const city = (deal as any)?.city ?? "";
  const status = deal?.status ?? "";

  // ── Left accent band (gradient via thin strips) ──
  const bandW = 16;
  const steps = 50;
  const stepH = PH / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const r = Math.round(99 + t * 40);   // 99 → 139
    const g = Math.round(102 - t * 10);  // 102 → 92
    const b = Math.round(241 + t * 5);   // 241 → 246
    doc.setFillColor(r, g, b);
    doc.rect(0, i * stepH, bandW, stepH + 0.5, "F");
  }

  // Light wash strip next to band (solid, very light)
  doc.setFillColor(243, 245, 252);
  doc.rect(bandW, 0, 10, PH, "F");

  // ── Decorative ring (top-right) — drawn as a thick circle stroke ──
  doc.setDrawColor(225, 230, 245);
  doc.setLineWidth(1.5);
  doc.circle(PW + 10, -15, 65, "S");

  // ── Decorative filled circle (bottom-right, very pale) ──
  doc.setFillColor(240, 242, 252);
  doc.circle(PW - 25, PH - 35, 40, "F");

  // ── Small diamond (solid, light indigo) ──
  doc.setFillColor(220, 222, 248);
  const dx = PW - 50, dy = 90, ds = 5;
  doc.triangle(dx, dy - ds, dx + ds, dy, dx, dy + ds, "F");
  doc.triangle(dx, dy - ds, dx - ds, dy, dx, dy + ds, "F");

  // ── Logo: solid square + text ──
  const lx = 34;
  const ly = 88;
  doc.setFillColor(...C.indigo);
  doc.roundedRect(lx, ly, 9, 9, 2, 2, "F");

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.indigo);
  doc.text("M I M M O Z A", lx + 14, ly + 6.5);

  // ── Title ──
  const ty = ly + 28;
  doc.setFontSize(32);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.slate900);
  doc.text("Dossier", lx, ty);
  doc.text("Investisseur", lx, ty + 13);

  // ── Subtitle (deal name) ──
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.slate700);
  doc.text("Operation : " + title, lx, ty + 26);

  // ── Divider (two-color bar) ──
  const divY = ty + 35;
  doc.setFillColor(...C.indigo);
  doc.rect(lx, divY, 18, 1, "F");
  doc.setFillColor(...C.violet);
  doc.rect(lx + 18, divY, 14, 1, "F");

  // ── Meta items ──
  const metaY = divY + 14;
  const metas: [string, string][] = [["REFERENCE", dealId]];
  if (city) metas.push(["VILLE", city]);
  if (status) metas.push(["STATUT", status]);
  metas.push(["DATE", fmtDate()]);

  let mx = lx;
  metas.forEach(([label, value], idx) => {
    // Label
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.slate400);
    doc.text(label, mx, metaY);
    // Value
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.slate900);
    doc.text(value, mx, metaY + 6);
    // Separator
    const tw = Math.max(doc.getTextWidth(value), doc.getTextWidth(label) * 1.6) + 8;
    mx += tw + 4;
    if (idx < metas.length - 1) {
      doc.setDrawColor(...C.slate200);
      doc.setLineWidth(0.3);
      doc.line(mx - 4, metaY - 3, mx - 4, metaY + 9);
      mx += 4;
    }
  });

  // ── Bottom bar ──
  doc.setFillColor(...C.slate50);
  doc.rect(0, PH - 16, PW, 16, "F");
  doc.setDrawColor(...C.slate200);
  doc.setLineWidth(0.3);
  doc.line(0, PH - 16, PW, PH - 16);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.slate400);
  doc.text("CONFIDENTIEL \u2014 Usage interne", lx, PH - 8);
  doc.text("mimmoza.fr", PW - M.right, PH - 8, { align: "right" });
}

// ---------------------------------------------------------------------------
// Deal section
// ---------------------------------------------------------------------------

function buildDealSection(doc: jsPDF, y: number, snapshot: MarchandSnapshotV1): number {
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  if (!deal) return y;

  y = sectionTitle(doc, y, "Deal actif");

  const fields: [string, unknown][] = [
    ["ID", deal.id],
    ["Titre", deal.title],
    ["Statut", deal.status],
    ["Ville", (deal as any).city],
    ["Code postal", (deal as any).codePostal ?? (deal as any).zipCode],
    ["Prix achat", (deal as any).prixAchat],
    ["Prix vente estime", (deal as any).prixVente ?? (deal as any).prixVenteEstime],
    ["Surface (m2)", (deal as any).surface],
    ["Type de bien", (deal as any).typeBien ?? (deal as any).propertyType],
    ["Travaux estimes", (deal as any).montantTravaux ?? (deal as any).travaux],
    ["Frais de notaire", (deal as any).fraisNotaire],
    ["Marge nette", (deal as any).margeNette],
    ["Rentabilite (%)", (deal as any).rentabilite],
    ["Notes", (deal as any).notes],
  ];

  const rows = fields
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([label, v]) => [label, isCurrencyField(label) ? fmtCurrency(v) : String(v)]);

  autoTable(doc, {
    startY: y,
    body: rows,
    theme: "plain",
    margin: { left: M.left, right: M.right },
    tableWidth: CW,
    columnStyles: {
      0: { cellWidth: 50, fontStyle: "bold", fillColor: C.slate50, textColor: C.slate700, fontSize: 8.5 },
      1: { textColor: C.slate900, fontSize: 9 },
    },
    styles: {
      cellPadding: { top: 3, bottom: 3, left: 5, right: 5 },
      lineColor: C.slate200,
      lineWidth: 0.2,
    },
  });

  return (doc as any).lastAutoTable.finalY + 4;
}

// ---------------------------------------------------------------------------
// Other deals
// ---------------------------------------------------------------------------

function buildAllDealsSection(doc: jsPDF, y: number, snapshot: MarchandSnapshotV1): number {
  if (!snapshot.deals || snapshot.deals.length <= 1) return y;
  const others = snapshot.deals.filter((d) => d.id !== snapshot.activeDealId);
  if (others.length === 0) return y;

  y = sectionTitle(doc, y, "Autres deals");

  autoTable(doc, {
    startY: y,
    head: [["ID", "Titre", "Statut", "Ville", "Prix achat"]],
    body: others.map((d) => [
      String(d.id ?? ""),
      String(d.title ?? ""),
      String(d.status ?? ""),
      String((d as any).city ?? ""),
      fmtCurrency((d as any).prixAchat),
    ]),
    theme: "grid",
    margin: { left: M.left, right: M.right },
    tableWidth: CW,
    headStyles: { fillColor: C.slate100, textColor: C.slate700, fontStyle: "bold", fontSize: 7.5 },
    bodyStyles: { fontSize: 8, textColor: C.slate900 },
    alternateRowStyles: { fillColor: C.slate50 },
    styles: { lineColor: C.slate200, lineWidth: 0.2, cellPadding: { top: 2.5, bottom: 2.5, left: 5, right: 5 } },
  });

  return (doc as any).lastAutoTable.finalY + 4;
}

// ---------------------------------------------------------------------------
// Due Diligence
// ---------------------------------------------------------------------------

function buildDueDiligenceSection(doc: jsPDF, y: number, dd?: { report: any; computed?: any }): number {
  if (!dd?.report) return y;

  doc.addPage();
  y = M.top + 4;
  y = sectionTitle(doc, y, "Due Diligence");

  const rpt = dd.report;
  const score = rpt.score ?? rpt.globalScore ?? dd.computed?.score;
  const completion = rpt.completion ?? rpt.completionRate;
  const criticalCount = rpt.criticalCount ?? rpt.critical;
  const warningCount = rpt.warningCount ?? rpt.warning;
  const categories: any[] = rpt.categories ?? rpt.items ?? rpt.sections ?? [];

  let totalItems = 0;
  categories.forEach((c: any) => { totalItems += (c.items?.length ?? 1); });

  // ── KPI cards ──
  const kpis: { label: string; value: string; color: RGB }[] = [];
  if (score !== undefined) {
    const n = Number(score);
    kpis.push({ label: "SCORE GLOBAL", value: String(score), color: n >= 70 ? C.green : n >= 40 ? C.amber : C.red });
  }
  if (completion !== undefined) kpis.push({ label: "COMPLETION", value: String(completion), color: C.slate900 });
  if (criticalCount !== undefined) kpis.push({ label: "CRITIQUES", value: String(criticalCount), color: C.red });
  if (warningCount !== undefined) kpis.push({ label: "ALERTES", value: String(warningCount), color: C.amber });
  if (totalItems > 0) kpis.push({ label: "ELEMENTS", value: String(totalItems), color: C.slate900 });

  if (kpis.length > 0) {
    const cw = Math.min((CW - (kpis.length - 1) * 4) / kpis.length, 42);
    let cx = M.left;
    kpis.forEach((k) => {
      doc.setDrawColor(...C.slate200);
      doc.setLineWidth(0.3);
      doc.setFillColor(...C.white);
      doc.roundedRect(cx, y, cw, 22, 2, 2, "FD");
      // Value
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...k.color);
      doc.text(k.value, cx + cw / 2, y + 10, { align: "center" });
      // Label
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.slate400);
      doc.text(k.label, cx + cw / 2, y + 17, { align: "center" });
      cx += cw + 4;
    });
    y += 28;
  }

  // ── Detail table ──
  if (categories.length > 0) {
    const body: any[][] = [];
    categories.forEach((cat: any) => {
      if (cat.items && Array.isArray(cat.items)) {
        body.push([{
          content: cat.name ?? cat.label ?? cat.category ?? "",
          colSpan: 3,
          styles: { fillColor: C.indigoLight, textColor: C.indigoDark, fontStyle: "bold" as const, fontSize: 8.5 },
        }]);
        cat.items.forEach((item: any) => {
          body.push([
            item.label ?? item.name ?? item.item ?? "",
            item.status ?? item.result ?? "-",
            item.comment ?? "",
          ]);
        });
      } else {
        body.push([
          cat.label ?? cat.name ?? cat.item ?? cat.category ?? "",
          cat.status ?? cat.result ?? "-",
          cat.comment ?? "",
        ]);
      }
    });

    autoTable(doc, {
      startY: y,
      head: [["Element", "Statut", "Commentaire"]],
      body,
      theme: "grid",
      margin: { left: M.left, right: M.right },
      tableWidth: CW,
      headStyles: { fillColor: C.slate100, textColor: C.slate700, fontStyle: "bold", fontSize: 7.5 },
      bodyStyles: { fontSize: 8, textColor: C.slate900, cellPadding: { top: 2.5, bottom: 2.5, left: 5, right: 5 } },
      columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 30, halign: "center" }, 2: {} },
      alternateRowStyles: { fillColor: C.slate50 },
      styles: { lineColor: C.slate200, lineWidth: 0.2 },
      didParseCell(data) {
        if (data.section === "body" && data.column.index === 1) {
          const sc = statusColors(String(data.cell.raw ?? ""));
          data.cell.styles.textColor = sc.text;
          data.cell.styles.fillColor = sc.bg;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 7.5;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  return y;
}

// ---------------------------------------------------------------------------
// AI Section (supports new analysis format + legacy)
// ---------------------------------------------------------------------------

function buildAiSection(doc: jsPDF, y: number, ai?: ExportPdfOpts["aiReport"]): number {
  if (!ai) return y;

  // Normalize from either format
  const data = normalizeAiReport(ai);
  if (!data) return y;

  doc.addPage();
  y = M.top + 4;
  y = sectionTitle(doc, y, "\u{1F9E0} Analyse IA (Investisseur)");

  // Timestamp
  if (data.generatedAt) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.slate400);
    doc.text("Genere le " + data.generatedAt, M.left, y);
    y += 6;
  }

  // ── Decision banner (Verdict + Confiance) ──
  if (data.verdict) {
    const dc = decisionColors(data.verdict);
    const bannerText = "Verdict : " + decisionLabel(data.verdict)
      + (data.confidencePct ? " \u2014 Confiance : " + data.confidencePct : "");

    doc.setFillColor(...dc.bg);
    doc.setDrawColor(...dc.text);
    doc.setLineWidth(0.4);
    doc.roundedRect(M.left, y, CW, 16, 2, 2, "FD");

    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dc.text);
    doc.text(bannerText, M.left + 8, y + 10);
    y += 22;
  }

  // ── Executive summary ──
  if (data.executiveSummary) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.slate900);
    doc.text("Resume executif", M.left, y);
    y += 5;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.slate700);
    const lines = doc.splitTextToSize(data.executiveSummary, CW - 4);
    doc.text(lines, M.left + 2, y);
    y += lines.length * 3.8 + 6;
  }

  // ── Helper: render a bullet list block ──
  function bulletBlock(
    title: string,
    items: string[],
    titleColor: RGB,
    bulletColor: RGB
  ): void {
    if (y > PH - 40) { doc.addPage(); y = M.top + 4; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...titleColor);
    doc.text(title, M.left, y);
    y += 5;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.slate700);
    items.forEach((item) => {
      if (y > PH - 20) { doc.addPage(); y = M.top + 4; }
      doc.setFillColor(...bulletColor);
      doc.circle(M.left + 3, y - 1, 0.8, "F");
      const lines = doc.splitTextToSize(item, CW - 12);
      doc.text(lines, M.left + 8, y);
      y += lines.length * 3.8 + 2;
    });
    y += 4;
  }

  // ── Numbered list block (for action plan) ──
  function numberedBlock(title: string, items: string[], titleColor: RGB, numColor: RGB): void {
    if (y > PH - 40) { doc.addPage(); y = M.top + 4; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...titleColor);
    doc.text(title, M.left, y);
    y += 5;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.slate700);
    items.forEach((action, i) => {
      if (y > PH - 20) { doc.addPage(); y = M.top + 4; }
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...numColor);
      doc.text((i + 1) + ".", M.left + 2, y);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...C.slate700);
      const lines = doc.splitTextToSize(action, CW - 12);
      doc.text(lines, M.left + 8, y);
      y += lines.length * 3.8 + 2;
    });
    y += 4;
  }

  // ── ✅ Points forts ──
  if (data.strengths.length > 0) {
    bulletBlock("\u2705 Points forts", data.strengths, C.green, C.green);
  }

  // ── ⚠️ Points de vigilance ──
  if (data.vigilances.length > 0) {
    bulletBlock("\u26A0\uFE0F Points de vigilance", data.vigilances, C.amber, C.amber);
  }

  // ── 📉 Sensibilites ──
  if (data.sensitivities.length > 0) {
    bulletBlock("\u{1F4C9} Sensibilites", data.sensitivities, C.red, C.red);
  }

  // ── 📌 Plan d'action ──
  if (data.actionPlan.length > 0) {
    numberedBlock("\u{1F4CC} Plan d'action", data.actionPlan, C.indigo, C.indigo);
  }

  // ── 🧩 Donnees manquantes ──
  if (data.missingData.length > 0) {
    bulletBlock("\u{1F9E9} Donnees manquantes", data.missingData, C.slate500, C.slate400);
  }

  // ── Details (narrative) — legacy only ──
  if (data.narrativeMarkdown) {
    if (y > PH - 50) { doc.addPage(); y = M.top + 4; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.slate900);
    doc.text("Details", M.left, y);
    y += 5;

    const txt = truncate(data.narrativeMarkdown).replace(/#{1,4}\s/g, "").replace(/\*\*/g, "");
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.slate500);
    const lines = doc.splitTextToSize(txt, CW - 14);
    const bh = Math.min(lines.length * 3.5 + 10, PH - y - 20);

    // Background
    doc.setFillColor(...C.slate50);
    doc.roundedRect(M.left, y - 2, CW, bh, 1.5, 1.5, "F");
    // Left accent
    doc.setFillColor(...C.indigo);
    doc.rect(M.left, y - 2, 1.2, bh, "F");

    doc.text(lines, M.left + 6, y + 4);
    y += bh + 4;
  }

  return y;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function exportSnapshotToPdf(
  snapshot: MarchandSnapshotV1,
  opts?: ExportPdfOpts
): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Page 1: Cover
  buildCoverPage(doc, snapshot);

  // Page 2+: Content
  doc.addPage();
  let y = M.top + 4;
  y = buildDealSection(doc, y, snapshot);
  y = buildAllDealsSection(doc, y, snapshot);
  y = buildDueDiligenceSection(doc, y, opts?.context?.dueDiligence);
  y = buildAiSection(doc, y, opts?.aiReport);

  // Headers & footers (skip cover)
  addHeaderFooter(doc);

  // Save
  const deal = snapshot.deals.find((d) => d.id === snapshot.activeDealId);
  const slug = (deal?.title ?? "export")
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40);
  doc.save("dossier-investisseur-" + slug + ".pdf");
}

// ---------------------------------------------------------------------------
// Legacy fallback (print dialog)
// ---------------------------------------------------------------------------

export function exportSnapshotToPdfPrint(
  snapshot: MarchandSnapshotV1,
  opts?: ExportPdfOpts
): void {
  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Dossier Investisseur</title>"
    + "<style>body{font-family:Arial,sans-serif;padding:32px;color:#1e293b}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:11px}th{background:#f8fafc;font-weight:600;width:180px}</style>"
    + "</head><body><h1>Dossier Investisseur</h1><p>Date : " + new Date().toLocaleDateString("fr-FR") + "</p></body></html>";
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}