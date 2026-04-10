// src/spaces/promoteur/services/exportScenarioComparisonPdf.ts
//
// Génère et télécharge le PDF de comparaison de scénarios d'implantation.
//
// Flux de données :
//   ImplantationScenarioFull[]  (entrée publique — type métier canonique)
//     → fullScenarioToPdf()     (adaptateur interne, jamais exporté)
//     → PdfScenarioModel[]      (modèle de rendu plat)
//     → sections A–E            (rendu jsPDF)
//
// Seuils CES identiques à plan.scenarios.types.ts — synchroniser si modifiés.

import jsPDF from "jspdf";
import type { ImplantationScenarioFull } from "../plan2d/scenarioGenerator.types";

// ─── PALETTE ──────────────────────────────────────────────────────────

type RGB = [number, number, number];

const C = {
  primary:    [79, 70, 229]   as RGB,
  primaryDim: [224, 231, 255] as RGB,
  green:      [21, 128, 61]   as RGB,
  amber:      [180, 83, 9]    as RGB,
  red:        [185, 28, 28]   as RGB,
  s900:       [15, 23, 42]    as RGB,
  s700:       [51, 65, 85]    as RGB,
  s600:       [71, 85, 105]   as RGB,
  s500:       [100, 116, 139] as RGB,
  s300:       [203, 213, 225] as RGB,
  s100:       [241, 245, 249] as RGB,
  white:      [255, 255, 255] as RGB,
} as const;

// ─── CONSTANTES DE PAGE ───────────────────────────────────────────────

const PW          = 210;
const PH          = 297; void PH;
const MX          = 16;
const MY          = 16;
const CW          = PW - MX * 2;   // 178 mm
const PAGE_BOTTOM = 277;

// ─── ESPACEMENTS ──────────────────────────────────────────────────────

const GAP = {
  afterSectionTitle:  3,
  betweenSections:   10,
  afterRule:          4,
  afterSubtitle:      2,
  listItem:         0.5,
  afterList:          3,
  safetyPad:          4,
} as const;

// ─── SEUILS CES (miroir de plan.scenarios.types.ts) ───────────────────

const PDF_CES_WARN  = 0.46;
const PDF_CES_BLOCK = 0.54;

// ─── MODÈLE INTERNE PDF ───────────────────────────────────────────────
// PdfScenarioModel est un modèle plat de rendu, interne à ce fichier.
// Il est construit exclusivement via fullScenarioToPdf() et n'est jamais
// exporté.

interface PdfScenarioMetrics {
  totalFootprintM2: number;
  coverageRatio:    number;
  buildingCount:    number;
  parkingRequired:  number;
  parkingProvided:  number;
  blockingCount:    number;
  limitedCount:     number;
}

type PdfGlobalStatus = "CONFORME" | "LIMITE" | "BLOQUANT";

interface PdfScenarioModel {
  id:              string;
  label:           string;
  globalStatus:    PdfGlobalStatus;
  recommended?:    boolean;
  metrics:         PdfScenarioMetrics;
  scoreOverall?:   number;
  scoreRank?:      number;
  recommendation:  string;
  summary:         string;
  strengths:       string[];
  vigilancePoints: string[];
  nextAction?:     string;
}

// ─── ADAPTATEUR ───────────────────────────────────────────────────────
// Logique de statut identique à deriveStatus() dans plan.scenarios.types.ts.

function deriveGlobalStatus(s: ImplantationScenarioFull): PdfGlobalStatus {
  const parkingMissing = s.nbLogements !== undefined && s.parkingProvided < s.parkingRequired;
  const cesExceeded    = s.cesPct > PDF_CES_BLOCK;
  if (!s.isConforme && (parkingMissing || cesExceeded)) return "BLOQUANT";
  if (!s.isConforme)                                     return "LIMITE";
  if (s.cesPct > PDF_CES_WARN)                           return "LIMITE";
  return "CONFORME";
}

function fullScenarioToPdf(s: ImplantationScenarioFull, rank: number): PdfScenarioModel {
  const globalStatus = deriveGlobalStatus(s);
  return {
    id:    s.id,
    label: s.title,
    globalStatus,
    metrics: {
      totalFootprintM2: s.empriseM2,
      coverageRatio:    s.cesPct,
      buildingCount:    s.buildingCount,
      parkingRequired:  s.parkingRequired,
      parkingProvided:  s.parkingProvided,
      blockingCount:    globalStatus === "BLOQUANT" ? 1 : 0,
      limitedCount:     globalStatus === "LIMITE"   ? 1 : 0,
    },
    scoreOverall:    s.scoreGlobal,
    scoreRank:       rank,
    recommendation:  s.description,
    summary:         s.description,
    strengths:       s.strengths,
    vigilancePoints: s.vigilance,
    nextAction:      s.notes[0] ?? undefined,
  };
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────

const fmtArea = (m2: number) => `${Math.round(m2).toLocaleString("fr-FR")} m²`;
const fmtPct  = (r: number)  => `${(r * 100).toFixed(1)} %`;
const fmtN    = (n: number)  => String(Math.round(n));

// required = 0 signifie programme non défini → on l'indique explicitement.
const fmtParking = (provided: number, required: number) =>
  required === 0 ? `${provided} (—)` : `${provided}/${required}`;

const fmtDate = () =>
  new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

function statusLabel(s: PdfGlobalStatus): string {
  return s === "CONFORME" ? "Conforme" : s === "LIMITE" ? "Limite" : "Bloquant";
}
function statusColor(s: PdfGlobalStatus): RGB {
  return s === "CONFORME" ? C.green : s === "LIMITE" ? C.amber : C.red;
}
function scoreColor(n: number): RGB {
  return n >= 75 ? C.green : n >= 50 ? C.amber : C.red;
}
function ellipsis(txt: string, max: number): string {
  if (!txt) return "—";
  return txt.length > max ? `${txt.slice(0, Math.max(0, max - 1)).trimEnd()}…` : txt;
}

// ─── CLASSE DOC ───────────────────────────────────────────────────────

class Doc {
  private readonly p: jsPDF;
  public y: number;

  constructor() {
    this.p = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    this.y = MY;
  }

  addPage(): void { this.p.addPage(); this.y = MY; }

  guard(needed: number): void {
    if (this.y + needed > PAGE_BOTTOM) this.addPage();
  }

  skip(mm: number): void { this.y += mm; }

  setFont(opts: { size?: number; color?: RGB; bold?: boolean } = {}): void {
    const { size = 8.5, color = C.s700, bold = false } = opts;
    this.p.setFontSize(size);
    this.p.setFont("helvetica", bold ? "bold" : "normal");
    this.p.setTextColor(...color);
  }

  lineHeight(size: number): number { return size * 0.38 + 1.2; }

  split(txt: string, maxW: number, opts: { size?: number; bold?: boolean } = {}): string[] {
    const { size = 8.5, bold = false } = opts;
    this.p.setFontSize(size);
    this.p.setFont("helvetica", bold ? "bold" : "normal");
    return this.p.splitTextToSize(txt || "—", maxW) as string[];
  }

  textHeight(
    txt: string,
    opts: { size?: number; maxW?: number; bold?: boolean; lineGap?: number } = {},
  ): number {
    const { size = 8.5, maxW = CW, bold = false, lineGap = 0 } = opts;
    const lines = this.split(txt, maxW, { size, bold });
    const lineH  = this.lineHeight(size);
    return lines.length * lineH + Math.max(0, lines.length - 1) * lineGap;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = C.s300, w = 0.25): void {
    this.p.setDrawColor(...color);
    this.p.setLineWidth(w);
    this.p.line(x1, y1, x2, y2);
  }

  rule(color: RGB = C.s300, w = 0.25): void {
    this.line(MX, this.y, MX + CW, this.y, color, w);
    this.y += 2;
  }

  fill(x: number, y: number, w: number, h: number, bg: RGB, stroke?: RGB): void {
    this.p.setFillColor(...bg);
    if (stroke) {
      this.p.setDrawColor(...stroke);
      this.p.setLineWidth(0.15);
      this.p.rect(x, y, w, h, "FD");
    } else {
      this.p.rect(x, y, w, h, "F");
    }
  }

  roundedFill(
    x: number, y: number, w: number, h: number,
    bg: RGB, stroke?: RGB, r = 2,
  ): void {
    this.p.setFillColor(...bg);
    if (stroke) {
      this.p.setDrawColor(...stroke);
      this.p.setLineWidth(0.15);
      this.p.roundedRect(x, y, w, h, r, r, "FD");
    } else {
      this.p.roundedRect(x, y, w, h, r, r, "F");
    }
  }

  at(
    txt: string,
    x: number,
    y: number,
    opts: {
      size?: number; color?: RGB; bold?: boolean;
      align?: "left" | "center" | "right"; maxW?: number; lineGap?: number;
    } = {},
  ): number {
    const { size = 8, color = C.s700, bold = false, align = "left", maxW, lineGap = 0 } = opts;
    this.setFont({ size, color, bold });
    const lines = maxW ? (this.p.splitTextToSize(txt || "—", maxW) as string[]) : [txt || "—"];
    const lineH  = this.lineHeight(size);
    lines.forEach((line, idx) => {
      this.p.text(line, x, y + idx * (lineH + lineGap), { align });
    });
    return lines.length * lineH + Math.max(0, lines.length - 1) * lineGap;
  }

  text(
    txt: string,
    opts: {
      x?: number; size?: number; color?: RGB; bold?: boolean;
      align?: "left" | "center" | "right"; maxW?: number; lineGap?: number;
    } = {},
  ): void {
    const {
      x = MX, size = 8.5, color = C.s700, bold = false,
      align = "left", maxW = CW, lineGap = 0,
    } = opts;
    this.setFont({ size, color, bold });
    const lines = this.p.splitTextToSize(txt || "—", maxW) as string[];
    const lineH  = this.lineHeight(size);
    const xPos   =
      align === "center" ? MX + CW / 2 :
      align === "right"  ? MX + CW     : x;
    lines.forEach((line, idx) => {
      this.p.text(line, xPos, this.y, { align });
      this.y += lineH;
      if (idx < lines.length - 1) this.y += lineGap;
    });
  }

  save(filename: string): void { this.p.save(filename); }
}

// ─── SECTION A : EN-TÊTE ─────────────────────────────────────────────

function buildHeader(doc: Doc, projectTitle?: string): void {
  doc.fill(0, 0, PW, 4, C.primary);
  doc.y = 9;

  doc.text("MIMMOZA", { size: 8, color: C.primary, bold: true });
  doc.skip(-1);
  doc.at(`Export : ${fmtDate()}`, MX + CW, doc.y, {
    size: 7.5, color: C.s500, align: "right",
  });

  doc.skip(3);
  doc.text("Comparatif des scénarios d'implantation", {
    size: 16, color: C.s900, bold: true,
  });
  doc.skip(1);

  if (projectTitle) {
    doc.text(projectTitle, { size: 10, color: C.s500 });
    doc.skip(1);
  }

  doc.skip(3);
  doc.rule(C.primary, 0.4);
  doc.skip(GAP.afterRule);
}

// ─── SECTION B : SYNTHÈSE ─────────────────────────────────────────────

function buildSynthesis(
  doc: Doc,
  scenarios: PdfScenarioModel[],
  activeId: string | null | undefined,
  recommendedId: string | null | undefined,
): void {
  doc.guard(52);

  const activeName  = scenarios.find((s) => s.id === activeId)?.label ?? "—";
  const recScenario = scenarios.find((s) => s.id === recommendedId || s.recommended);
  const recName     = recScenario?.label ?? "—";
  const bloquantN   = scenarios.filter((s) => s.globalStatus === "BLOQUANT").length;
  const conformeN   = scenarios.filter((s) => s.globalStatus === "CONFORME").length;

  doc.text("Synthèse comparative", { size: 11, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle - 1);

  const summary = bloquantN === 0
    ? `${scenarios.length} scénario${scenarios.length > 1 ? "s" : ""} analysé${scenarios.length > 1 ? "s" : ""} — ${conformeN} conforme${conformeN > 1 ? "s" : ""}, aucun point bloquant identifié.`
    : `${scenarios.length} scénario${scenarios.length > 1 ? "s" : ""} analysé${scenarios.length > 1 ? "s" : ""} — ${bloquantN} non-conforme${bloquantN > 1 ? "s" : ""} nécessitant révision.`;

  doc.text(summary, { size: 8.5, color: C.s700, maxW: CW });
  doc.skip(GAP.afterSectionTitle + 1);

  const stripH = 18;
  const cellW  = CW / 3;
  const stripY = doc.y;
  doc.guard(stripH + 6);

  [
    { label: "Scénarios",      value: fmtN(scenarios.length) },
    { label: "Scénario actif", value: activeName             },
    { label: "Recommandé",     value: recName                },
  ].forEach((cell, i) => {
    const cx = MX + i * cellW;
    doc.roundedFill(cx, stripY, cellW - 1, stripH, C.s100, C.s300, 1.8);
    doc.at(cell.label.toUpperCase(), cx + 3, stripY + 5, {
      size: 6.5, color: C.s500, bold: true, maxW: cellW - 6,
    });
    doc.at(ellipsis(cell.value, 26), cx + 3, stripY + 11.8, {
      size: 9, color: C.s900, bold: true, maxW: cellW - 6,
    });
  });

  doc.y = stripY + stripH + GAP.afterSectionTitle;
  doc.rule();
  doc.skip(GAP.afterRule);
}

// ─── SECTION C : TABLEAU COMPARATIF ──────────────────────────────────

function buildTable(
  doc: Doc,
  scenarios: PdfScenarioModel[],
  activeId: string | null | undefined,
): void {
  doc.guard(24 + scenarios.length * 15);

  doc.text("Tableau comparatif", { size: 11, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle);

  // Largeurs : somme = CW = 178 mm
  const cols = [
    { h: "Scénario",       w: 40  },
    { h: "Statut",         w: 18  },
    { h: "Score",          w: 13  },
    { h: "Emprise",        w: 22  },
    { h: "CES",            w: 13  },
    { h: "Bât.",           w: 11  },
    { h: "Parking",        w: 18  },
    { h: "Bloc.",          w: 11  },
    { h: "Recommandation", w: CW - 40 - 18 - 13 - 22 - 13 - 11 - 18 - 11 }, // 32
  ] as const;

  const headH = 8;
  const rowH  = 14;

  // En-tête
  doc.fill(MX, doc.y, CW, headH, C.s900);
  let cx = MX;
  cols.forEach((col) => {
    doc.at(col.h.toUpperCase(), cx + 2, doc.y + 5.4, {
      size: 6, color: C.white, bold: true, maxW: col.w - 4,
    });
    cx += col.w;
  });
  doc.y += headH;

  // Lignes
  scenarios.forEach((s, ri) => {
    doc.guard(rowH + 1);
    const isActive = s.id === activeId;
    const rowBg: RGB = isActive ? C.primaryDim : ri % 2 === 0 ? C.white : C.s100;
    doc.fill(MX, doc.y, CW, rowH, rowBg, C.s300);

    cx = MX;
    const textY = doc.y + 9;

    // Scénario
    const nameRaw = `${s.label}${isActive ? " ●" : ""}${s.recommended ? " ★" : ""}`;
    doc.at(ellipsis(nameRaw, 30), cx + 2, textY, {
      size: 7, color: C.s900, bold: isActive, maxW: cols[0].w - 4,
    });
    cx += cols[0].w;

    // Statut
    doc.at(statusLabel(s.globalStatus), cx + cols[1].w / 2, textY, {
      size: 6.5, color: statusColor(s.globalStatus), bold: true,
      align: "center", maxW: cols[1].w - 2,
    });
    cx += cols[1].w;

    // Score
    const score = s.scoreOverall;
    doc.at(score !== undefined ? fmtN(score) : "—", cx + cols[2].w / 2, textY, {
      size: 8, color: score !== undefined ? scoreColor(score) : C.s500,
      bold: true, align: "center",
    });
    cx += cols[2].w;

    // Emprise
    doc.at(fmtArea(s.metrics.totalFootprintM2), cx + cols[3].w - 2, textY, {
      size: 7, color: C.s700, align: "right", maxW: cols[3].w - 4,
    });
    cx += cols[3].w;

    // CES
    const cesColor: RGB =
      s.metrics.coverageRatio > PDF_CES_BLOCK ? C.red  :
      s.metrics.coverageRatio > PDF_CES_WARN  ? C.amber : C.s700;
    doc.at(fmtPct(s.metrics.coverageRatio), cx + cols[4].w - 2, textY, {
      size: 7, color: cesColor, bold: cesColor !== C.s700,
      align: "right", maxW: cols[4].w - 4,
    });
    cx += cols[4].w;

    // Bâtiments
    doc.at(fmtN(s.metrics.buildingCount), cx + cols[5].w / 2, textY, {
      size: 7, color: C.s700, align: "center",
    });
    cx += cols[5].w;

    // Parking — vert si ok, rouge si déficit (programme défini)
    // required = 0 → programme non défini → on affiche sans coloration d'alerte
    const parkingOk =
      s.metrics.parkingRequired === 0 ||
      s.metrics.parkingProvided >= s.metrics.parkingRequired;
    const parkingColor: RGB = parkingOk ? C.s700 : C.red;
    doc.at(
      fmtParking(s.metrics.parkingProvided, s.metrics.parkingRequired),
      cx + cols[6].w / 2, textY,
      { size: 6.5, color: parkingColor, bold: !parkingOk, align: "center" },
    );
    cx += cols[6].w;

    // Bloquant
    doc.at(fmtN(s.metrics.blockingCount), cx + cols[7].w / 2, textY, {
      size: 7,
      color: s.metrics.blockingCount > 0 ? C.red : C.s500,
      bold:  s.metrics.blockingCount > 0,
      align: "center",
    });
    cx += cols[7].w;

    // Recommandation
    doc.at(ellipsis(s.recommendation || "—", 55), cx + 2, textY, {
      size: 6.3, color: C.s600, maxW: cols[8].w - 4,
    });

    doc.y += rowH;
  });

  // Légende
  doc.skip(GAP.afterSubtitle);
  doc.text(
    "● Scénario actif   ★ Recommandé   " +
    "Parking : fourni / requis  (— = programme non défini)   " +
    "Score : réglementaire 40 % + foncier 35 % + simplicité 25 %",
    { size: 6.5, color: C.s500, maxW: CW },
  );

  // Séparateur explicite — empêche le chevauchement tableau / focus
  doc.skip(GAP.betweenSections);
}

// ─── SECTION D : FOCUS SCÉNARIO RECOMMANDÉ ───────────────────────────

function buildFocus(
  doc: Doc,
  scenarios: PdfScenarioModel[],
  recommendedId: string | null | undefined,
): void {
  const s = scenarios.find((sc) => sc.id === recommendedId || sc.recommended);
  if (!s) return;

  const accentC = statusColor(s.globalStatus);
  const innerW  = CW - 6;

  const topPad    = 4;
  const bottomPad = 4;

  const titleH   = doc.textHeight(s.label, { size: 12, maxW: innerW, bold: true });
  const metaLine = [
    statusLabel(s.globalStatus),
    s.scoreOverall !== undefined ? `Score : ${s.scoreOverall}/100` : null,
    s.scoreRank    !== undefined ? `Rang ${s.scoreRank}`           : null,
  ].filter(Boolean).join("   ·   ");
  const metaH    = doc.textHeight(metaLine, { size: 8, maxW: innerW, bold: true });
  const summaryH = s.summary ? doc.textHeight(s.summary, { size: 8, maxW: innerW }) : 0;

  const cardH =
    2 + topPad + titleH + 1 + metaH +
    (s.summary ? GAP.afterSubtitle + summaryH : 0) +
    bottomPad;

  doc.guard(cardH + GAP.safetyPad + 50);

  doc.text("Focus — Scénario recommandé", { size: 11, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle);

  const cardY = doc.y;
  doc.fill(MX, cardY, CW, 2, accentC);
  doc.roundedFill(MX, cardY + 2, CW, cardH - 2, C.s100, C.s300, 1.5);

  let innerY = cardY + 2 + topPad;
  doc.at(s.label, MX + 3, innerY, { size: 12, color: C.s900, bold: true, maxW: innerW });
  innerY += titleH + 1;
  doc.at(metaLine, MX + 3, innerY, { size: 8, color: accentC, bold: true, maxW: innerW });
  innerY += metaH;
  if (s.summary) {
    innerY += GAP.afterSubtitle;
    doc.at(s.summary, MX + 3, innerY, { size: 8, color: C.s700, maxW: innerW });
  }

  // Curseur avancé sous la carte + marge de sécurité
  doc.y = cardY + cardH + GAP.safetyPad;

  // Points favorables
  if (s.strengths.length > 0) {
    const blockH =
      doc.textHeight("Points favorables", { size: 8.5, maxW: innerW, bold: true }) +
      GAP.afterSubtitle +
      s.strengths.reduce(
        (acc, pt) => acc + doc.textHeight(`✓  ${pt}`, { size: 8, maxW: innerW }) + GAP.listItem,
        0,
      ) +
      GAP.afterList;

    doc.guard(blockH + GAP.safetyPad);
    doc.text("Points favorables", { size: 8.5, color: C.green, bold: true });
    doc.skip(GAP.afterSubtitle);
    s.strengths.forEach((pt) => {
      doc.text(`✓  ${pt}`, { size: 8, color: C.s700, x: MX + 3, maxW: innerW });
      doc.skip(GAP.listItem);
    });
    doc.skip(GAP.afterList);
  }

  // Points de vigilance
  if (s.vigilancePoints.length > 0) {
    const blockH =
      doc.textHeight("Points de vigilance", { size: 8.5, maxW: innerW, bold: true }) +
      GAP.afterSubtitle +
      s.vigilancePoints.reduce(
        (acc, pt) => acc + doc.textHeight(`—  ${pt}`, { size: 8, maxW: innerW }) + GAP.listItem,
        0,
      ) +
      GAP.afterList;

    doc.guard(blockH + GAP.safetyPad);
    doc.text("Points de vigilance", { size: 8.5, color: C.amber, bold: true });
    doc.skip(GAP.afterSubtitle);
    s.vigilancePoints.forEach((pt) => {
      doc.text(`—  ${pt}`, { size: 8, color: C.s700, x: MX + 3, maxW: innerW });
      doc.skip(GAP.listItem);
    });
    doc.skip(GAP.afterList);
  }

  // Prochaine étape
  if (s.nextAction) {
    const nextH =
      GAP.safetyPad +
      doc.textHeight("Prochaine étape recommandée", { size: 8.5, maxW: innerW, bold: true }) +
      1 +
      doc.textHeight(s.nextAction, { size: 8.5, maxW: innerW, bold: true }) +
      6;

    doc.guard(nextH);
    doc.fill(MX, doc.y, CW, 1, accentC);
    doc.y += 1 + GAP.safetyPad;
    doc.text("Prochaine étape recommandée", { size: 8.5, color: C.s500, bold: true });
    doc.skip(1);
    doc.text(s.nextAction, {
      size: 8.5, color: C.s900, bold: true, maxW: innerW, x: MX + 3,
    });
    doc.skip(6);
  }

  doc.rule();
  doc.skip(GAP.afterRule);
}

// ─── SECTION E : DISCLAIMER ───────────────────────────────────────────

function buildDisclaimer(doc: Doc): void {
  const title = "Mentions importantes";
  const body  =
    "Ce document constitue une analyse de faisabilité préliminaire générée automatiquement par Mimmoza. " +
    "Il ne constitue pas un avis réglementaire, juridique ou financier et ne saurait engager la responsabilité d'aucune partie. " +
    "Les conclusions présentées doivent être confirmées par une lecture détaillée du PLU applicable et l'avis de professionnels qualifiés.";

  const innerW = CW - 6;
  const titleH = doc.textHeight(title, { size: 7.5, maxW: innerW, bold: true });
  const bodyH  = doc.textHeight(body,  { size: 6.5, maxW: innerW });
  const boxH   = 3 + titleH + 1 + bodyH + 3;

  doc.guard(boxH + 2);
  doc.roundedFill(MX, doc.y, CW, boxH, C.s100, C.s300, 1.5);

  let innerY = doc.y + 3;
  doc.at(title, MX + 3, innerY, { size: 7.5, color: C.s500, bold: true, maxW: innerW });
  innerY += titleH + 1;
  doc.at(body,  MX + 3, innerY, { size: 6.5, color: C.s500, maxW: innerW });

  doc.y += boxH + 2;
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

export interface ExportScenarioComparisonPdfParams {
  projectTitle?:          string;
  activeScenarioId?:      string | null;
  recommendedScenarioId?: string | null;
  /**
   * Scénarios évalués produits par evaluateScenario().
   * Jamais mutés — une copie triée est créée en interne pour l'attribution des rangs.
   */
  scenarios: ImplantationScenarioFull[];
}

/**
 * Génère et télécharge le PDF de comparaison de scénarios.
 * Effet de bord pur : déclenche le téléchargement navigateur.
 */
export async function exportScenarioComparisonPdf(
  params: ExportScenarioComparisonPdfParams,
): Promise<void> {
  const { projectTitle, activeScenarioId, recommendedScenarioId, scenarios } = params;
  if (!scenarios.length) return;

  // Rang 1 = meilleur scoreGlobal
  const sorted  = [...scenarios].sort((a, b) => b.scoreGlobal - a.scoreGlobal);
  const rankMap = new Map<string, number>(sorted.map((s, i) => [s.id, i + 1]));

  const pdfScenarios: PdfScenarioModel[] = scenarios.map((s) =>
    fullScenarioToPdf(s, rankMap.get(s.id) ?? 1),
  );

  // Résolution du scénario recommandé :
  // 1. paramètre explicite → 2. flag recommended → 3. meilleur CONFORME → 4. meilleur global
  const resolvedRecId =
    recommendedScenarioId                                        ??
    pdfScenarios.find((s) => s.recommended)?.id                 ??
    pdfScenarios.find((s) => s.globalStatus === "CONFORME")?.id ??
    sorted[0]?.id                                               ??
    null;

  const doc = new Doc();
  buildHeader(doc, projectTitle);
  buildSynthesis(doc, pdfScenarios, activeScenarioId, resolvedRecId);
  buildTable(doc, pdfScenarios, activeScenarioId);
  buildFocus(doc, pdfScenarios, resolvedRecId);
  buildDisclaimer(doc);

  const safeTitle = projectTitle?.replace(/[^a-z0-9]/gi, "_").toLowerCase() ?? "comparatif";
  const date = new Date().toISOString().slice(0, 10);
  doc.save(`mimmoza_scenarios_${safeTitle}_${date}.pdf`);
}