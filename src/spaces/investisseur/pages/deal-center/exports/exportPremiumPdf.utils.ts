// src/spaces/investisseur/pages/deal-center/exports/exportPremiumPdf.utils.ts
//
// Primitives graphiques partagées — même charte visuelle que exportDataConfidence
// Stripe · Linear · Pitchbook · Palantir
// Aucune logique métier — uniquement rendu PDF

import logoMimmozaUrl from "@/assets/logo-mimmoza-baseline.png";
import { loadImageDataUrl } from "@/spaces/shared/loadImageDataUrl";
import type { jsPDF } from "jspdf";

// ─── Palette ──────────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

export const C: Record<string, RGB> = {
  indigo900:   [49,  46, 129],
  indigo700:   [67,  56, 202],
  indigo600:   [79,  70, 229],
  violet600:   [124,  58, 237],
  violet400:   [167, 139, 250],
  violet100:   [237, 233, 254],
  violet50:    [245, 243, 255],
  blue600:     [37,   99, 235],
  blue50:      [239, 246, 255],
  white:       [255, 255, 255],
  slate50:     [248, 250, 252],
  slate100:    [241, 245, 249],
  slate200:    [226, 232, 240],
  slate300:    [203, 213, 225],
  slate400:    [148, 163, 184],
  slate500:    [100, 116, 139],
  slate600:    [71,   85, 105],
  slate700:    [51,   65,  85],
  slate900:    [15,   23,  42],
  green600:    [22,  163,  74],
  green500:    [34,  197,  94],
  green100:    [220, 252, 231],
  green50:     [240, 253, 244],
  amber600:    [217, 119,   6],
  amber400:    [251, 191,  36],
  amber100:    [254, 243, 199],
  amber50:     [255, 251, 235],
  red600:      [220,  38,  38],
  red400:      [248, 113, 113],
  red100:      [254, 226, 226],
  red50:       [255, 241, 242],
};

// ─── Layout ───────────────────────────────────────────────────────────────────

export const PW = 210;
export const PH = 297;
export const ML = 12;
export const MR = 12;
export const CW = PW - ML - MR;  // 186 mm
export const HDR_H = 30;         // hauteur header
export const BODY_START = HDR_H + 7;
export const FOOTER_Y = PH - 6;

export function today(): string {
  return new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/** Formate un nombre en séparant les milliers par un espace ASCII simple */
function fmtNum(n: number): string {
  // On évite toLocaleString("fr-FR") qui produit \u202F (espace fine insécable)
  // incompatible avec Helvetica dans jsPDF.
  const parts = Math.round(n).toString().split("");
  const out: string[] = [];
  parts.reverse().forEach((ch, i) => {
    if (i > 0 && i % 3 === 0) out.push(" ");
    out.push(ch);
  });
  return out.reverse().join("");
}

export function fmt(n: number | null | undefined, suffix = ""): string {
  if (n == null) return "-";
  return fmtNum(n) + (suffix ? " " + suffix : "");
}
export function fmtEur(n: number | null | undefined): string {
  if (n == null) return "-";
  // Valeurs avec décimales (cashflow peut être fractionnaire)
  const rounded = Math.round(n);
  return fmtNum(rounded) + " EUR";
}
export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toFixed(2) + " %";
}

// ─── Primitives graphiques ────────────────────────────────────────────────────

/** Dégradé horizontal simulé par bandes */
export function hGrad(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  cL: RGB, cR: RGB, steps = 50,
) {
  const sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(
      Math.round(cL[0] + (cR[0] - cL[0]) * t),
      Math.round(cL[1] + (cR[1] - cL[1]) * t),
      Math.round(cL[2] + (cR[2] - cL[2]) * t),
    );
    doc.rect(x + i * sw, y, sw + 0.5, h, "F");
  }
}

/** Carte flottante avec ombre douce */
export function floatCard(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  r = 5, fill: RGB = C.white, borderColor?: RGB,
) {
  const shadows = [
    { dy: 0.6, op: 0.055, inflate: 0.3 },
    { dy: 1.2, op: 0.04,  inflate: 0.6 },
    { dy: 2.0, op: 0.025, inflate: 0.9 },
  ];
  for (const s of shadows) {
    doc.setGState(doc.GState({ opacity: s.op }));
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(x - s.inflate, y + s.dy, w + s.inflate * 2, h, r, r, "F");
  }
  doc.setGState(doc.GState({ opacity: 1 }));
  doc.setFillColor(...fill);
  if (borderColor) {
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.22);
    doc.roundedRect(x, y, w, h, r, r, "FD");
  } else {
    doc.roundedRect(x, y, w, h, r, r, "F");
  }
}

/** Titre de section — lignes de chaque côté */
export function sectionHead(doc: jsPDF, text: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate600);
  const tw = doc.getTextWidth(text);
  const cx = PW / 2;
  const ty = y + 5;
  const lineY = ty - 2;
  const GAP = 5;
  doc.setDrawColor(...C.slate200);
  doc.setLineWidth(0.3);
  doc.line(ML, lineY, cx - tw / 2 - GAP, lineY);
  doc.text(text, cx, ty, { align: "center" });
  doc.line(cx + tw / 2 + GAP, lineY, ML + CW, lineY);
  return y + 12;
}

/** Pill badge */
export function pill(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  text: string, bg: RGB, fg: RGB, border: RGB,
) {
  doc.setFillColor(...bg);
  doc.setDrawColor(...border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...fg);
  doc.text(text, x + w / 2, y + h - 1.0, { align: "center" });
}

/** Ligne KV (clé / valeur) */
export function kvRow(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  opts?: { bold?: boolean; color?: RGB },
): number {
  const ROW_H = 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate500);
  doc.text(label, ML + 2, y);
  doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  doc.setTextColor(...(opts?.color ?? C.slate900));
  doc.text(value, ML + CW - 2, y, { align: "right" });
  doc.setDrawColor(...C.slate100);
  doc.setLineWidth(0.2);
  doc.line(ML, y + 2, ML + CW, y + 2);
  return y + ROW_H;
}

/** Tableau avec header + lignes alternées */
export function tableBlock(
  doc: jsPDF,
  cols: Array<{ header: string; key: string; w: number; align?: "left" | "right"; colorFn?: (v: string) => RGB }>,
  rows: Record<string, string>[],
  y: number,
): number {
  const ROW_H = 6.5;
  const totalW = cols.reduce((s, c) => s + c.w, 0);

  // Header
  hGrad(doc, ML, y, totalW, ROW_H, C.indigo600, C.violet600);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.white);
  let cx = ML + 2;
  for (const col of cols) {
    if (col.align === "right") {
      doc.text(col.header, cx + col.w - 3, y + 4.5, { align: "right" });
    } else {
      doc.text(col.header, cx, y + 4.5);
    }
    cx += col.w;
  }
  y += ROW_H;

  // Lignes
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    doc.setFillColor(...(ri % 2 === 0 ? C.white : C.slate50));
    doc.rect(ML, y, totalW, ROW_H, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    let rx = ML + 2;
    for (const col of cols) {
      const val = row[col.key] ?? "-";
      const color = col.colorFn ? col.colorFn(val) : C.slate700;
      doc.setTextColor(...color);
      if (col.align === "right") {
        doc.text(val, rx + col.w - 3, y + 4.5, { align: "right" });
      } else {
        doc.text(val, rx, y + 4.5, { maxWidth: col.w - 4 });
      }
      rx += col.w;
    }

    doc.setDrawColor(...C.slate100);
    doc.setLineWidth(0.15);
    doc.line(ML, y + ROW_H, ML + totalW, y + ROW_H);
    y += ROW_H;
  }
  return y + 2;
}

/** Verdict card (GO / NO GO / CONDITIONNEL) */
export function verdictCard(
  doc: jsPDF,
  verdict: string,
  text: string,
  y: number,
): number {
  const isGo   = verdict === "GO";
  const isNoGo = verdict === "NO GO";
  const col:   RGB = isGo ? C.green600 : isNoGo ? C.red600 : C.amber600;
  const colBg: RGB = isGo ? C.green50  : isNoGo ? C.red50  : C.amber50;
  const colBdr:RGB = isGo ? C.green500 : isNoGo ? C.red400 : C.amber400;
  const colG2: RGB = isGo ? C.green500 : isNoGo ? C.red400 : C.amber400;

  // Largeur badge fixe à droite
  const BADGE_W = 40;
  const TEXT_W  = CW - BADGE_W - 16;  // largeur texte avec marges

  // Calcul hauteur carte en fonction du texte
  doc.setFontSize(7);
  const lines   = doc.splitTextToSize(text, TEXT_W);
  const textH   = lines.length * 5;
  const CARD_H  = Math.max(20, textH + 10);

  // Fond carte
  floatCard(doc, ML, y, CW, CARD_H, 5, colBg, colBdr);

  // Texte à gauche — centré verticalement
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate700);
  const textY = y + (CARD_H - textH) / 2 + 4;
  doc.text(lines, ML + 5, textY);

  // Badge à droite — centré verticalement, contenu dans la carte
  const BADGE_H = 12;
  const badgeX  = ML + CW - BADGE_W - 3;
  const badgeY  = y + (CARD_H - BADGE_H) / 2;
  hGrad(doc, badgeX, badgeY, BADGE_W, BADGE_H, col, colG2, 30);
  // Coins arrondis visuels (surimpression fond coloré aux angles)
  doc.setFillColor(...col);
  doc.roundedRect(badgeX, badgeY, BADGE_W, BADGE_H, 3, 3, "F");
  // Re-appliquer gradient par-dessus
  hGrad(doc, badgeX + 3, badgeY, BADGE_W - 6, BADGE_H, col, colG2, 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...C.white);
  doc.text(verdict, badgeX + BADGE_W / 2, badgeY + BADGE_H / 2 + 2, { align: "center" });

  return y + CARD_H + 4;
}

/** Alerte (info / warning / danger / success) */
export function alertBox(
  doc: jsPDF,
  text: string,
  level: "info" | "warning" | "danger" | "success",
  y: number,
): number {
  const cfgs = {
    info:    { bg: C.blue50,    border: C.blue600,  text: C.indigo700 },
    warning: { bg: C.amber50,   border: C.amber400,  text: C.amber600 },
    danger:  { bg: C.red50,     border: C.red400,    text: C.red600   },
    success: { bg: C.green50,   border: C.green500,  text: C.green600 },
  };
  const cfg = cfgs[level];
  const lines = doc.splitTextToSize(text, CW - 8);
  const h = Math.max(10, lines.length * 5 + 6);

  doc.setFillColor(...cfg.bg);
  doc.setDrawColor(...cfg.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, y, CW, h, 3, 3, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...cfg.text);
  doc.text(lines, ML + 4, y + 5);
  return y + h + 3;
}

/** Header page premium (fond blanc, logo, titre centré, date capsule) */
export async function drawPremiumHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  dealName: string,
): Promise<string | null> {
  // Fond blanc
  doc.setFillColor(...C.white);
  doc.rect(0, 0, PW, PH, "F");

  // Logo
  let logoDataUrl: string | null = null;
  try {
    const logo = await loadImageDataUrl(logoMimmozaUrl);
    logoDataUrl = logo.dataUrl;
  } catch { /* fallback texte */ }

  const LOGO_Y = 6;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", ML, LOGO_Y, 32, 11);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C.indigo700);
    doc.text("MIMMOZA", ML, LOGO_Y + 8);
  }

  // Titre centré
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...C.slate900);
  doc.text(title.toUpperCase(), PW / 2, LOGO_Y + 8, { align: "center" });

  // Sous-titre
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate500);
  doc.text(subtitle, PW / 2, LOGO_Y + 13.5, { align: "center" });

  // Deal name droite
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate400);
  doc.text(dealName, PW - MR, LOGO_Y + 6, { align: "right" });

  // Date capsule
  const dateStr = today();
  doc.setFontSize(6.5);
  const dw = doc.getTextWidth(dateStr) + 7;
  const dh = 6;
  const dx = PW - MR - dw;
  const dy = LOGO_Y + 9;
  doc.setFillColor(...C.violet50);
  doc.setDrawColor(...C.violet400);
  doc.setLineWidth(0.3);
  doc.roundedRect(dx, dy, dw, dh, dh / 2, dh / 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.violet600);
  doc.text(dateStr, dx + dw / 2, dy + dh - 1.5, { align: "center" });

  // Séparateur bas header
  doc.setGState(doc.GState({ opacity: 0.18 }));
  doc.setFillColor(...C.slate900);
  doc.rect(ML, HDR_H, CW, 0.25, "F");
  doc.setGState(doc.GState({ opacity: 1 }));

  return logoDataUrl;
}

/** Header de page secondaire (sans async, logo optionnel) */
export function drawPageHeader(
  doc: jsPDF,
  title: string,
  pageNum: number,
  pageTotal: number,
  dealName: string,
  logoDataUrl: string | null,
) {
  // Fond blanc
  doc.setFillColor(...C.white);
  doc.rect(0, 0, PW, PH, "F");

  // Bande fine gradient en top
  hGrad(doc, 0, 0, PW, 1.5, C.indigo600, C.violet600);

  // Logo petit
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", ML, 4, 22, 8);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...C.indigo700);
    doc.text("MIMMOZA", ML, 9);
  }

  // Titre centré
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.slate900);
  doc.text(title.toUpperCase(), PW / 2, 9, { align: "center" });

  // Deal name droite
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate400);
  doc.text(dealName, PW - MR, 7, { align: "right" });

  // Page n/total
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate300);
  doc.text(`${pageNum} / ${pageTotal}`, PW - MR, 11, { align: "right" });

  // Séparateur
  doc.setGState(doc.GState({ opacity: 0.15 }));
  doc.setFillColor(...C.slate900);
  doc.rect(ML, 14, CW, 0.2, "F");
  doc.setGState(doc.GState({ opacity: 1 }));
}

/** Footer discret */
export function drawPremiumFooter(doc: jsPDF) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate500);
  doc.text(
    "Document genere par Mimmoza a titre indicatif. Donnees issues de sources publiques et de calculs algorithmiques. Ne constitue pas un conseil financier.",
    PW / 2, FOOTER_Y,
    { align: "center", maxWidth: 165 },
  );
}

/** KPI card (1 valeur + label + sous-label) */
export function kpiCard(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string,
  col: RGB, colBg: RGB,
) {
  floatCard(doc, x, y, w, h, 5, C.white, C.slate200);

  // Fond teinté haut
  doc.setFillColor(...colBg);
  doc.roundedRect(x, y, w, h * 0.42, 5, 5, "F");
  doc.setFillColor(...C.white);
  doc.rect(x, y + h * 0.32, w, h * 0.12, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...col);
  doc.text(label.toUpperCase(), x + w / 2, y + 5, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.slate900);
  doc.text(value, x + w / 2, y + 18, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(...C.slate400);
  doc.text(sub, x + w / 2, y + h - 2.5, { align: "center" });
}

/** Couleur selon seuil verdict */
export function verdictCol(v: string): RGB {
  if (v === "GO")        return C.green600;
  if (v === "NO GO")     return C.red600;
  if (v === "ATTENTION") return C.amber600;
  return C.slate400;
}