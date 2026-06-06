// src/spaces/investisseur/pages/deal-center/exports/exportInvestisseurPdf.utils.ts
//
// Utilitaires PDF partagés - espace Investisseur / Marchand de bien
// Thème : amber  (#D97706 principal, #FEF3C7 fond clair, #92400E sombre)
// Pattern identique à exportPromoteurPdf.ts (violet → amber)

import type { jsPDF } from "jspdf";

// ─── Palette ──────────────────────────────────────────────────────────────────

export const AMBER = {
  primary:   [217, 119,   6] as [number, number, number], // #D97706
  light:     [254, 243, 199] as [number, number, number], // #FEF3C7
  dark:      [146,  64,  14] as [number, number, number], // #92400E
  mid:       [251, 191,  36] as [number, number, number], // #FBBF24
  text:      [ 41,  37,  36] as [number, number, number], // #292524
  muted:     [120, 113, 108] as [number, number, number], // #78716C
  border:    [214, 211, 209] as [number, number, number], // #D6D3D1
  bg:        [250, 250, 249] as [number, number, number], // #FAFAF9
  white:     [255, 255, 255] as [number, number, number],
  emerald:   [ 16, 185, 129] as [number, number, number], // #10B981
  red:       [239,  68,  68] as [number, number, number], // #EF4444
  blue:      [ 59, 130, 246] as [number, number, number], // #3B82F6
} as const;

// ─── Dimensions ───────────────────────────────────────────────────────────────

export const PAGE_W  = 210; // A4 mm
export const PAGE_H  = 297;
export const MARGIN  = 14;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const HEADER_H  = 18;
export const FOOTER_H  = 10;
export const BODY_TOP  = MARGIN + HEADER_H + 4;
export const BODY_BOT  = PAGE_H - MARGIN - FOOTER_H - 4;

// ─── Helpers couleur ──────────────────────────────────────────────────────────

export function rgb(doc: jsPDF, color: [number, number, number]) {
  doc.setTextColor(...color);
}

export function fillRect(
  doc:    jsPDF,
  x:      number,
  y:      number,
  w:      number,
  h:      number,
  color:  [number, number, number],
) {
  doc.setFillColor(...color);
  doc.rect(x, y, w, h, "F");
}

export function strokeRect(
  doc:    jsPDF,
  x:      number,
  y:      number,
  w:      number,
  h:      number,
  color:  [number, number, number],
  lw = 0.3,
) {
  doc.setDrawColor(...color);
  doc.setLineWidth(lw);
  doc.rect(x, y, w, h, "S");
}

// ─── Cover page ───────────────────────────────────────────────────────────────

export interface CoverOptions {
  title:     string;
  subtitle?: string;
  address?:  string;
  deal?:     string;
  date?:     string;
  badge?:    string; // ex: "Données partielles"
}

export function drawCover(doc: jsPDF, opts: CoverOptions) {
  // Ruban amber en haut
  fillRect(doc, 0, 0, PAGE_W, 52, AMBER.primary);

  // Logo / marque
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.light);
  doc.text("MIMMOZA", MARGIN, 14);

  // Badge espace
  if (opts.badge) {
    fillRect(doc, PAGE_W - MARGIN - 38, 8, 38, 7, AMBER.dark);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    rgb(doc, AMBER.light);
    doc.text(opts.badge.toUpperCase(), PAGE_W - MARGIN - 19, 12.8, { align: "center" });
  }

  // Titre principal
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.white);
  doc.text(opts.title, MARGIN, 36);

  // Sous-titre
  if (opts.subtitle) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    rgb(doc, AMBER.light);
    doc.text(opts.subtitle, MARGIN, 44);
  }

  // Bloc deal info
  const infoY = 62;
  fillRect(doc, MARGIN, infoY, CONTENT_W, 32, AMBER.light);
  strokeRect(doc, MARGIN, infoY, CONTENT_W, 32, AMBER.mid);

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.dark);
  doc.text("DEAL", MARGIN + 5, infoY + 7);
  doc.text("ADRESSE", MARGIN + 5, infoY + 16);
  doc.text("DATE", MARGIN + 5, infoY + 25);

  doc.setFont("helvetica", "normal");
  rgb(doc, AMBER.text);
  doc.text(opts.deal    ?? "-", MARGIN + 28, infoY + 7);
  doc.text(opts.address ?? "-", MARGIN + 28, infoY + 16);
  doc.text(opts.date    ?? new Date().toLocaleDateString("fr-FR"), MARGIN + 28, infoY + 25);

  // Disclaimer bas de couverture
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  rgb(doc, AMBER.muted);
  const disclaimer =
    "Document genere par Mimmoza a titre indicatif. Les donnees sont issues de sources publiques et " +
    "de calculs algorithmiques. Elles ne constituent pas un conseil en investissement.";
  const lines = doc.splitTextToSize(disclaimer, CONTENT_W);
  doc.text(lines, MARGIN, PAGE_H - 18);
}

// ─── Header / Footer ─────────────────────────────────────────────────────────

export function drawHeader(
  doc:      jsPDF,
  title:    string,
  pageNum:  number,
  total:    number,
  deal?:    string,
) {
  // Bande amber fine
  fillRect(doc, 0, 0, PAGE_W, HEADER_H, AMBER.primary);

  // Marque
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.light);
  doc.text("MIMMOZA", MARGIN, 11);

  // Titre section
  doc.setFont("helvetica", "normal");
  rgb(doc, AMBER.white);
  doc.text(title, PAGE_W / 2, 11, { align: "center" });

  // Deal + pagination
  rgb(doc, AMBER.light);
  doc.text(`${deal ?? ""}  -  p. ${pageNum} / ${total}`, PAGE_W - MARGIN, 11, { align: "right" });
}

export function drawFooter(doc: jsPDF, date?: string) {
  const y = PAGE_H - FOOTER_H;
  doc.setDrawColor(...AMBER.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  rgb(doc, AMBER.muted);
  doc.text(
    "Généré par Mimmoza - donnees a titre indicatif, non constitutives d'un conseil financier.",
    MARGIN,
    y + 4,
  );
  doc.text(
    date ?? new Date().toLocaleDateString("fr-FR"),
    PAGE_W - MARGIN,
    y + 4,
    { align: "right" },
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────

export function drawSectionTitle(doc: jsPDF, label: string, y: number): number {
  fillRect(doc, MARGIN, y, CONTENT_W, 8, AMBER.light);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.dark);
  doc.text(label.toUpperCase(), MARGIN + 3, y + 5.5);
  return y + 10; // retourne le y suivant
}

// ─── Ligne clé / valeur ───────────────────────────────────────────────────────

export function drawKV(
  doc:    jsPDF,
  label:  string,
  value:  string,
  y:      number,
  opts?: { bold?: boolean; color?: [number, number, number]; labelW?: number },
): number {
  const lw = opts?.labelW ?? 60;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.muted);
  doc.text(label, MARGIN, y);

  doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  rgb(doc, opts?.color ?? AMBER.text);
  doc.text(value, MARGIN + lw, y);
  return y + 5.5;
}

// ─── Tableau générique ────────────────────────────────────────────────────────

export interface TableColumn {
  header: string;
  key:    string;
  width:  number;
  align?: "left" | "right" | "center";
  color?: (val: string) => [number, number, number] | undefined;
}

export function drawTable(
  doc:     jsPDF,
  cols:    TableColumn[],
  rows:    Record<string, string>[],
  startY:  number,
  rowH  = 7,
): number {
  let y = startY;

  // Header
  fillRect(doc, MARGIN, y, CONTENT_W, rowH, AMBER.primary);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.white);

  let cx = MARGIN + 2;
  for (const col of cols) {
    doc.text(col.header, cx + (col.align === "right" ? col.width - 4 : 0), y + 5, {
      align: col.align === "right" ? "right" : "left",
      maxWidth: col.width - 3,
    });
    cx += col.width;
  }
  y += rowH;

  // Rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    fillRect(doc, MARGIN, y, CONTENT_W, rowH, i % 2 === 0 ? AMBER.white : AMBER.bg);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");

    cx = MARGIN + 2;
    for (const col of cols) {
      const val = row[col.key] ?? "-";
      const color = col.color?.(val) ?? AMBER.text;
      rgb(doc, color);
      doc.text(val, cx + (col.align === "right" ? col.width - 4 : 0), y + 5, {
        align: col.align === "right" ? "right" : "left",
        maxWidth: col.width - 3,
      });
      cx += col.width;
    }

    // Border bottom
    doc.setDrawColor(...AMBER.border);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
    y += rowH;
  }

  return y + 2;
}

// ─── Badge coloré ─────────────────────────────────────────────────────────────

export function drawBadge(
  doc:   jsPDF,
  label: string,
  x:     number,
  y:     number,
  color: [number, number, number],
  bg:    [number, number, number],
) {
  const w = doc.getTextWidth(label) + 6;
  fillRect(doc, x, y - 3.5, w, 5.5, bg);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  rgb(doc, color);
  doc.text(label, x + 3, y);
}

// ─── Gauge bar ────────────────────────────────────────────────────────────────

export function drawGauge(
  doc:    jsPDF,
  label:  string,
  value:  number, // 0-100
  y:      number,
  color?: [number, number, number],
): number {
  const barW = CONTENT_W - 55;
  const barH = 4;
  const barX = MARGIN + 50;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  rgb(doc, AMBER.muted);
  doc.text(label, MARGIN, y + 3.5);

  // Track
  fillRect(doc, barX, y, barW, barH, AMBER.border);
  // Fill
  fillRect(doc, barX, y, barW * (value / 100), barH, color ?? AMBER.primary);
  // Label
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  rgb(doc, AMBER.text);
  doc.text(`${Math.round(value)}%`, barX + barW + 3, y + 3.5);

  return y + 8;
}

// ─── Separateur ───────────────────────────────────────────────────────────────

export function drawSep(doc: jsPDF, y: number): number {
  doc.setDrawColor(...AMBER.border);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  return y + 4;
}

// ─── Alert box ────────────────────────────────────────────────────────────────

export type AlertLevel = "success" | "warning" | "danger" | "info";

export function drawAlert(
  doc:   jsPDF,
  text:  string,
  level: AlertLevel,
  y:     number,
): number {
  const colorMap: Record<AlertLevel, { bg: [number,number,number]; border: [number,number,number]; text: [number,number,number] }> = {
    success: { bg: [236,253,245], border: [16,185,129],  text: [6,95,70]    },
    warning: { bg: [255,251,235], border: [217,119,6],   text: [146,64,14]  },
    danger:  { bg: [254,242,242], border: [239,68,68],   text: [153,27,27]  },
    info:    { bg: [239,246,255], border: [59,130,246],  text: [30,64,175]  },
  };
  const c = colorMap[level];
  const lines = doc.splitTextToSize(text, CONTENT_W - 10);
  const h = lines.length * 5 + 6;

  fillRect(doc, MARGIN, y, CONTENT_W, h, c.bg as [number,number,number]);
  doc.setDrawColor(...(c.border as [number,number,number]));
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, MARGIN, y + h);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  rgb(doc, c.text as [number,number,number]);
  doc.text(lines, MARGIN + 4, y + 5);

  return y + h + 4;
}

// ─── Formatage ────────────────────────────────────────────────────────────────

export function fmtEur(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "-";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " EUR";
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return "-";
  return `${v.toFixed(decimals)} %`;
}

export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return "-";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: decimals }).format(v);
}

export function today(): string {
  return new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

// ─── newPage helper ───────────────────────────────────────────────────────────

/** Ajoute une page et redessine header/footer. Retourne le y de départ du contenu. */
export function addPage(
  doc:     jsPDF,
  title:   string,
  pageNum: number,
  total:   number,
  deal?:   string,
): number {
  doc.addPage();
  drawHeader(doc, title, pageNum, total, deal);
  drawFooter(doc);
  return BODY_TOP;
}

// ─── checkY - saut de page automatique ───────────────────────────────────────

export function checkY(
  doc:     jsPDF,
  y:       number,
  needed:  number,
  title:   string,
  counter: { page: number; total: number },
  deal?:   string,
): number {
  if (y + needed > BODY_BOT) {
    counter.page++;
    return addPage(doc, title, counter.page, counter.total, deal);
  }
  return y;
}