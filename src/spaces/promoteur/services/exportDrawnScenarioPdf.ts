// src/spaces/promoteur/services/exportDrawnScenarioPdf.ts
//
// Export PDF du scénario dessiné (MasterScenario).
//
// Structure :
//   Page 1 — Identité + Statut + Métriques + Conformité
//   Page 2 — Économie + Narrative + Disclaimer
//
// Entrée  : MasterScenario  (source de vérité unique)
// Sortie  : téléchargement navigateur

import jsPDF from 'jspdf';
import type { MasterScenario, MasterConformityStatus } from '../plan2d/plan.master.types';

// ─── PALETTE ──────────────────────────────────────────────────────────

type RGB = [number, number, number];

const C = {
  primary:    [79, 70, 229]   as RGB,
  primaryDim: [224, 231, 255] as RGB,
  green:      [21, 128, 61]   as RGB,
  amber:      [180, 83, 9]    as RGB,
  red:        [185, 28, 28]   as RGB,
  teal:       [13, 148, 136]  as RGB,
  s900:       [15, 23, 42]    as RGB,
  s700:       [51, 65, 85]    as RGB,
  s600:       [71, 85, 105]   as RGB,
  s500:       [100, 116, 139] as RGB,
  s300:       [203, 213, 225] as RGB,
  s200:       [226, 232, 240] as RGB,
  s100:       [241, 245, 249] as RGB,
  s50:        [248, 250, 252] as RGB,
  white:      [255, 255, 255] as RGB,
} as const;

// ─── CONSTANTES DE PAGE ───────────────────────────────────────────────

const PW          = 210;
const PH          = 297; void PH;
const MX          = 16;
const MY          = 16;
const CW          = PW - MX * 2;   // 178 mm
const PAGE_BOTTOM = 277;           // bas utile (footer 20 mm)

// ─── ESPACEMENTS NOMMÉS ───────────────────────────────────────────────
// Toutes les valeurs d'espacement sont explicites et nommées
// pour faciliter le tuning sans chasse aux magic numbers.

const GAP = {
  afterBand:         5,   // après la bande colorée supérieure
  afterLogo:         3,   // après "MIMMOZA"
  afterTitle:        2,   // après le titre principal
  afterProjectName:  4,   // après le nom de projet
  afterRule:         5,   // après un filet horizontal
  afterSectionTitle: 4,   // après un titre de section
  betweenSections:   8,   // entre deux blocs majeurs
  afterCard:         6,   // après une carte de statut
  cellPadX:          4,   // padding horizontal dans les cellules
  cellPadY:          5,   // padding vertical dans les cellules
  listItem:          1,   // entre items de liste
  afterList:         4,   // après un bloc de liste
  safetyPad:         4,   // marge de sécurité avant tout bloc calculé
} as const;

// ─── COULEURS DE STATUT ───────────────────────────────────────────────

function statusColor(s: MasterConformityStatus): RGB {
  return s === 'CONFORME' ? C.green : s === 'LIMITE' ? C.amber : C.red;
}

function statusLabel(s: MasterConformityStatus): string {
  return s === 'CONFORME' ? 'Conforme' : s === 'LIMITE' ? 'Limite' : 'Bloquant';
}

function scoreColor(n: number): RGB {
  return n >= 75 ? C.green : n >= 50 ? C.amber : C.red;
}

// ─── FORMATTERS ───────────────────────────────────────────────────────

const fmtArea  = (m2: number)  => `${Math.round(m2).toLocaleString('fr-FR')} m²`;
const fmtPct   = (r: number)   => `${(r * 100).toFixed(1)} %`;
const fmtN     = (n: number)   => String(Math.round(n));
const fmtEur   = (n: number)   => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M€`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)} k€`;
  return `${Math.round(n)} €`;
};
const fmtDate  = () =>
  new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

function ellipsis(txt: string, max: number): string {
  if (!txt) return '—';
  return txt.length > max ? `${txt.slice(0, Math.max(0, max - 1)).trimEnd()}…` : txt;
}

// ─── CLASSE DOC ───────────────────────────────────────────────────────

class Doc {
  private readonly p: jsPDF;
  public y: number;

  constructor() {
    this.p = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
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
    this.p.setFont('helvetica', bold ? 'bold' : 'normal');
    this.p.setTextColor(...color);
  }

  lineHeight(size: number): number { return size * 0.38 + 1.2; }

  split(txt: string, maxW: number, opts: { size?: number; bold?: boolean } = {}): string[] {
    const { size = 8.5, bold = false } = opts;
    this.p.setFontSize(size);
    this.p.setFont('helvetica', bold ? 'bold' : 'normal');
    return this.p.splitTextToSize(txt || '—', maxW) as string[];
  }

  textHeight(
    txt: string,
    opts: { size?: number; maxW?: number; bold?: boolean } = {},
  ): number {
    const { size = 8.5, maxW = CW, bold = false } = opts;
    const lines = this.split(txt, maxW, { size, bold });
    return lines.length * this.lineHeight(size);
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
      this.p.rect(x, y, w, h, 'FD');
    } else {
      this.p.rect(x, y, w, h, 'F');
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
      this.p.roundedRect(x, y, w, h, r, r, 'FD');
    } else {
      this.p.roundedRect(x, y, w, h, r, r, 'F');
    }
  }

  /**
   * Texte à position absolue. Ne modifie pas this.y.
   * Retourne la hauteur rendue.
   */
  at(
    txt: string,
    x: number,
    y: number,
    opts: {
      size?: number; color?: RGB; bold?: boolean;
      align?: 'left' | 'center' | 'right'; maxW?: number;
    } = {},
  ): number {
    const { size = 8, color = C.s700, bold = false, align = 'left', maxW } = opts;
    this.setFont({ size, color, bold });
    const lines  = maxW ? (this.p.splitTextToSize(txt || '—', maxW) as string[]) : [txt || '—'];
    const lineH  = this.lineHeight(size);
    lines.forEach((line, idx) => {
      this.p.text(line, x, y + idx * lineH, { align });
    });
    return lines.length * lineH;
  }

  /** Texte qui avance this.y. */
  text(
    txt: string,
    opts: {
      x?: number; size?: number; color?: RGB; bold?: boolean;
      align?: 'left' | 'center' | 'right'; maxW?: number;
    } = {},
  ): void {
    const {
      x = MX, size = 8.5, color = C.s700, bold = false,
      align = 'left', maxW = CW,
    } = opts;
    this.setFont({ size, color, bold });
    const lines  = this.p.splitTextToSize(txt || '—', maxW) as string[];
    const lineH  = this.lineHeight(size);
    const xPos   = align === 'center' ? MX + CW / 2 : align === 'right' ? MX + CW : x;
    lines.forEach(line => {
      this.p.text(line, xPos, this.y, { align });
      this.y += lineH;
    });
  }

  save(filename: string): void { this.p.save(filename); }
}

// ─── SECTION A : EN-TÊTE ─────────────────────────────────────────────

function buildHeader(doc: Doc, projectTitle?: string): void {
  // Bande supérieure
  doc.fill(0, 0, PW, 4, C.primary);
  doc.y = 4 + GAP.afterBand;

  // Logo + date
  doc.text('MIMMOZA', { size: 8, color: C.primary, bold: true });
  doc.y -= doc.lineHeight(8);  // remonter pour aligner la date sur la même ligne
  doc.at(
    `Export : ${fmtDate()}`,
    MX + CW, doc.y,
    { size: 7.5, color: C.s500, align: 'right' },
  );
  doc.skip(doc.lineHeight(8) + GAP.afterLogo);

  // Titre principal
  doc.text("Analyse d'implantation", { size: 16, color: C.s900, bold: true });
  doc.skip(GAP.afterTitle);

  // Nom de projet
  if (projectTitle) {
    doc.text(projectTitle, { size: 10, color: C.s600 });
    doc.skip(1);
  }

  doc.skip(GAP.afterProjectName);
  doc.rule(C.primary, 0.4);
  doc.skip(GAP.afterRule);
}

// ─── SECTION B : CARTE DE STATUT ─────────────────────────────────────

function buildStatusCard(doc: Doc, s: MasterScenario): void {
  const accent    = statusColor(s.conformity.status);
  const innerW    = CW - 8;
  const topPad    = 5;
  const bottomPad = 5;

  const statusW  = 32;
  const scoreW   = 20;
  const summaryW = innerW - statusW - scoreW - 8;

  // Hauteur de la carte
  const summaryH = doc.textHeight(s.narrative.summary, { size: 8, maxW: summaryW });
  const cardH    = 2 + topPad + Math.max(14, summaryH) + bottomPad;

  doc.guard(cardH + GAP.safetyPad);

  const cardY = doc.y;
  // Bande accent + corps
  doc.fill(MX, cardY, CW, 2, accent);
  doc.roundedFill(MX, cardY + 2, CW, cardH - 2, C.s100, C.s300, 1.5);

  const innerY = cardY + 2 + topPad;

  // — Statut (badge coloré)
  const badgeH = 8;
  doc.roundedFill(MX + 4, innerY, statusW, badgeH, accent, undefined, 2);
  doc.at(
    statusLabel(s.conformity.status).toUpperCase(),
    MX + 4 + statusW / 2, innerY + 5.5,
    { size: 7, color: C.white, bold: true, align: 'center' },
  );

  // Score sous le badge
  const sc = s.scores.overall;
  doc.at(
    `Score ${sc}/100`,
    MX + 4 + statusW / 2, innerY + badgeH + 4.5,
    { size: 7.5, color: scoreColor(sc), bold: true, align: 'center', maxW: statusW },
  );

  // — Résumé
  doc.at(
    s.narrative.summary,
    MX + 4 + statusW + 6, innerY,
    { size: 8, color: C.s700, maxW: summaryW },
  );

  doc.y = cardY + cardH + GAP.afterCard;
}

// ─── SECTION C : GRILLE DE MÉTRIQUES ─────────────────────────────────

function buildMetricsGrid(doc: Doc, s: MasterScenario): void {
  const m = s.metrics;

  const parkingStr = s.program.nbLogements === undefined
    ? `${m.parkingProvided} (—)`
    : `${m.parkingProvided}/${m.parkingRequired}`;
  const parkingOk = s.program.nbLogements === undefined
    ? true
    : m.parkingProvided >= m.parkingRequired;

  const cells = [
    [
      { label: 'Surface parcelle', value: fmtArea(m.parcelAreaM2),           color: C.s900 },
      { label: 'Emprise bâtie',    value: fmtArea(m.buildingsFootprintM2),   color: C.s900 },
      {
        label: 'CES',
        value: fmtPct(m.coverageRatio),
        color: m.coverageRatio > 0.50 ? C.red : m.coverageRatio > 0.46 ? C.amber : C.s900,
      },
    ],
    [
      { label: 'Bâtiments',      value: fmtN(m.buildingCount),     color: C.s900 },
      {
        label: 'Parking',
        value: parkingStr,
        color: parkingOk ? C.s900 : C.red,
      },
      {
        label: 'Hauteur max',
        value: m.maxHeightM > 0 ? `${m.maxHeightM.toFixed(1)} m` : '—',
        color: m.maxHeightM > 15 ? C.red : C.s900,
      },
    ],
  ] as const;

  doc.guard(50);

  doc.text('Métriques', { size: 10, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle);

  const cellW = CW / 3;
  const cellH = 16;
  const rowGap = 2;

  cells.forEach((row, ri) => {
    const rowY = doc.y;
    row.forEach((cell, ci) => {
      const cx = MX + ci * cellW;
      doc.roundedFill(cx, rowY, cellW - 1, cellH, C.white, C.s200, 1.5);
      doc.at(cell.label.toUpperCase(), cx + GAP.cellPadX, rowY + GAP.cellPadY, {
        size: 6, color: C.s500, bold: true, maxW: cellW - GAP.cellPadX * 2,
      });
      doc.at(cell.value, cx + GAP.cellPadX, rowY + 11, {
        size: 9, color: cell.color, bold: true, maxW: cellW - GAP.cellPadX * 2,
      });
    });
    doc.y = rowY + cellH + rowGap;
  });

  doc.skip(GAP.betweenSections);
}

// ─── SECTION D : CONFORMITÉ ───────────────────────────────────────────

function buildConformity(doc: Doc, s: MasterScenario): void {
  const { conformity } = s;
  const accent         = statusColor(conformity.status);
  const innerW         = CW - 8;

  const msgBlocks = conformity.messages.map(m =>
    doc.textHeight(m, { size: 8, maxW: innerW }),
  );
  const totalMsgH = msgBlocks.reduce((a, h) => a + h + GAP.listItem, 0);
  const titleH    = doc.textHeight('Conformité PLU', { size: 10, bold: true });
  const boxH      = titleH + GAP.afterSectionTitle + totalMsgH + 6;

  doc.guard(boxH + GAP.safetyPad);

  doc.text('Conformité PLU', { size: 10, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle);

  const boxY = doc.y;
  doc.fill(MX, boxY, 3, boxH - 2, accent);
  doc.roundedFill(MX + 4, boxY, CW - 4, boxH - 2, C.s50, C.s200, 1.5);

  let iy = boxY + 3;
  conformity.messages.forEach(msg => {
    doc.at(msg, MX + 10, iy, { size: 8, color: C.s700, maxW: innerW });
    iy += doc.textHeight(msg, { size: 8, maxW: innerW }) + GAP.listItem;
  });

  doc.y = boxY + boxH + GAP.betweenSections;
}

// ─── SECTION E : ÉCONOMIE ─────────────────────────────────────────────

function buildEconomics(doc: Doc, s: MasterScenario): void {
  const e = s.economics;
  const a = s.economicAssumptions;

  const marginColor: RGB = e.grossMarginPct >= 0.18 ? C.green :
                           e.grossMarginPct >= 0.10 ? C.amber : C.red;

  const leftCells = [
    { label: 'SDP estimée',       value: fmtArea(e.sdpEstimatedM2) },
    { label: 'Surface vendable',  value: fmtArea(e.saleableAreaM2) },
    { label: 'Logements estimés', value: fmtN(e.estimatedLots) + ' log.' },
  ];
  const rightCells = [
    { label: 'Chiffre d\'affaires',  value: fmtEur(e.revenueEur),          color: C.s900 },
    { label: 'Coût construction',    value: fmtEur(e.constructionCostEur),  color: C.s700 },
    { label: 'Marge brute',          value: `${fmtEur(e.grossMarginEur)} · ${(e.grossMarginPct * 100).toFixed(1)} %`, color: marginColor },
  ] as const;

  const cellH  = 15;
  const colW   = CW / 2 - 2;
  const rowGap = 2;
  const totalH = leftCells.length * (cellH + rowGap) + 8;

  doc.guard(totalH + 20 + GAP.safetyPad);

  doc.text('Approche économique', { size: 10, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle - 1);

  // Hypothèses en note
  doc.text(
    `Hypothèses : ${a.salePricePerM2.toLocaleString('fr-FR')} €/m² commercialisé · ` +
    `${a.constructionCostPerM2.toLocaleString('fr-FR')} €/m² construction · ` +
    `${a.floorEfficiencyPct} % efficience · ` +
    `foncier ${fmtEur(a.landCostTotal)}`,
    { size: 6.5, color: C.s500, maxW: CW },
  );
  doc.skip(GAP.afterSectionTitle);

  leftCells.forEach((cell, i) => {
    const rowY = doc.y;

    // Colonne gauche
    doc.roundedFill(MX, rowY, colW, cellH, C.white, C.s200, 1.5);
    doc.at(cell.label.toUpperCase(), MX + GAP.cellPadX, rowY + GAP.cellPadY, {
      size: 6, color: C.s500, bold: true, maxW: colW - GAP.cellPadX * 2,
    });
    doc.at(cell.value, MX + GAP.cellPadX, rowY + 11, {
      size: 9, color: C.s900, bold: true, maxW: colW - GAP.cellPadX * 2,
    });

    // Colonne droite
    const rc  = rightCells[i];
    const rxo = MX + colW + 4;
    doc.roundedFill(rxo, rowY, colW, cellH, C.white, C.s200, 1.5);
    doc.at(rc.label.toUpperCase(), rxo + GAP.cellPadX, rowY + GAP.cellPadY, {
      size: 6, color: C.s500, bold: true, maxW: colW - GAP.cellPadX * 2,
    });
    doc.at(rc.value, rxo + GAP.cellPadX, rowY + 11, {
      size: 9, color: rc.color, bold: true, maxW: colW - GAP.cellPadX * 2,
    });

    doc.y = rowY + cellH + rowGap;
  });

  doc.skip(GAP.betweenSections);
}

// ─── SECTION F : NARRATIVE ────────────────────────────────────────────

function buildNarrative(doc: Doc, s: MasterScenario): void {
  const { narrative } = s;
  const innerW        = CW - 6;

  // Points favorables
  if (narrative.strengths.length > 0) {
    const blockH =
      doc.textHeight('Points favorables', { size: 9, bold: true }) +
      GAP.afterSectionTitle +
      narrative.strengths.reduce(
        (acc, pt) => acc + doc.textHeight(`✓  ${pt}`, { size: 8, maxW: innerW }) + GAP.listItem, 0,
      ) + GAP.afterList;

    doc.guard(blockH + GAP.safetyPad);

    doc.text('Points favorables', { size: 9, color: C.green, bold: true });
    doc.skip(GAP.afterSectionTitle);
    narrative.strengths.forEach(pt => {
      doc.text(`✓  ${pt}`, { size: 8, color: C.s700, x: MX + 3, maxW: innerW });
      doc.skip(GAP.listItem);
    });
    doc.skip(GAP.afterList);
  }

  // Points de vigilance
  if (narrative.vigilancePoints.length > 0) {
    const blockH =
      doc.textHeight('Points de vigilance', { size: 9, bold: true }) +
      GAP.afterSectionTitle +
      narrative.vigilancePoints.reduce(
        (acc, pt) => acc + doc.textHeight(`—  ${pt}`, { size: 8, maxW: innerW }) + GAP.listItem, 0,
      ) + GAP.afterList;

    doc.guard(blockH + GAP.safetyPad);

    doc.text('Points de vigilance', { size: 9, color: C.amber, bold: true });
    doc.skip(GAP.afterSectionTitle);
    narrative.vigilancePoints.forEach(pt => {
      doc.text(`—  ${pt}`, { size: 8, color: C.s700, x: MX + 3, maxW: innerW });
      doc.skip(GAP.listItem);
    });
    doc.skip(GAP.afterList);
  }

  // Prochaine étape
  if (narrative.nextAction) {
    const accent = statusColor(s.conformity.status);
    const nextH =
      GAP.safetyPad + 1 + GAP.safetyPad +
      doc.textHeight('Prochaine étape recommandée', { size: 8.5, bold: true }) + 1 +
      doc.textHeight(narrative.nextAction, { size: 8.5, bold: true, maxW: innerW }) + 6;

    doc.guard(nextH);
    doc.fill(MX, doc.y, CW, 1, accent);
    doc.y += 1 + GAP.safetyPad;

    doc.text('Prochaine étape recommandée', { size: 8.5, color: C.s500, bold: true });
    doc.skip(1);
    doc.text(narrative.nextAction, {
      size: 8.5, color: C.s900, bold: true, maxW: innerW, x: MX + 3,
    });
    doc.skip(6);
  }

  doc.rule();
  doc.skip(GAP.afterRule);
}

// ─── SECTION G : SCORES DÉTAILLÉS ────────────────────────────────────

function buildScores(doc: Doc, s: MasterScenario): void {
  const { scores } = s;
  const items = [
    { label: 'Réglementaire (40 %)', value: scores.regulatory,     color: scoreColor(scores.regulatory) },
    { label: 'Efficience foncière (35 %)', value: scores.landEfficiency, color: scoreColor(scores.landEfficiency) },
    { label: 'Simplicité (25 %)',    value: scores.simplicity,     color: scoreColor(scores.simplicity) },
    { label: 'Score global',         value: scores.overall,        color: scoreColor(scores.overall) },
  ] as const;

  const barTotalW = CW - 70;
  const rowH      = 7;
  const totalH    = items.length * (rowH + 2) + 14;

  doc.guard(totalH + GAP.safetyPad);

  doc.text('Scores', { size: 10, color: C.primary, bold: true });
  doc.skip(GAP.afterSectionTitle);

  items.forEach((item, i) => {
    const rowY   = doc.y;
    const isLast = i === items.length - 1;

    if (isLast) {
      doc.fill(MX, rowY - 1, CW, rowH + 3, C.s100);
    }

    // Label
    doc.at(item.label, MX + 2, rowY + 5, { size: 7.5, color: isLast ? C.s900 : C.s600, bold: isLast, maxW: 62 });

    // Barre
    const barX = MX + 66;
    const barH = 4;
    const barY = rowY + (rowH - barH) / 2 + 1;
    doc.fill(barX, barY, barTotalW, barH, C.s200);
    doc.fill(barX, barY, barTotalW * (item.value / 100), barH, item.color);

    // Valeur
    doc.at(`${item.value}`, MX + CW - 2, rowY + 5, {
      size: isLast ? 9 : 7.5, color: item.color, bold: true, align: 'right',
    });

    doc.y = rowY + rowH + 2;
  });

  doc.skip(GAP.betweenSections);
}

// ─── SECTION H : DISCLAIMER ───────────────────────────────────────────

function buildDisclaimer(doc: Doc): void {
  const title = 'Mentions importantes';
  const body  =
    "Ce document constitue une analyse de faisabilité préliminaire générée automatiquement par Mimmoza. " +
    "Il ne constitue pas un avis réglementaire, juridique ou financier et ne saurait engager la responsabilité d'aucune partie. " +
    "Les métriques sont calculées sur la base du plan masse dessiné et des paramètres PLU configurés. " +
    "Les conclusions présentées doivent être confirmées par une lecture détaillée du PLU applicable et l'avis de professionnels qualifiés.";

  const innerW = CW - 6;
  const titleH = doc.textHeight(title, { size: 7.5, bold: true, maxW: innerW });
  const bodyH  = doc.textHeight(body,  { size: 6.5, maxW: innerW });
  const boxH   = 3 + titleH + 2 + bodyH + 3;

  doc.guard(boxH + 2);
  doc.roundedFill(MX, doc.y, CW, boxH, C.s100, C.s300, 1.5);

  let iy = doc.y + 3;
  doc.at(title, MX + 3, iy, { size: 7.5, color: C.s500, bold: true, maxW: innerW });
  iy += titleH + 2;
  doc.at(body,  MX + 3, iy, { size: 6.5, color: C.s500, maxW: innerW });

  doc.y += boxH + 2;
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

export interface ExportDrawnScenarioPdfParams {
  scenario:      MasterScenario;
  projectTitle?: string;
}

/**
 * Génère et télécharge le PDF d'analyse du scénario dessiné.
 *
 * Structure :
 *   Page 1 — En-tête · Statut · Métriques · Conformité
 *   Page 2 — Économie · Scores · Narrative · Disclaimer
 *
 * Effet de bord pur : déclenche le téléchargement navigateur.
 */
export function exportDrawnScenarioPdf(params: ExportDrawnScenarioPdfParams): void {
  const { scenario, projectTitle } = params;

  if (scenario.metrics.buildingCount === 0) {
    console.warn('[Mimmoza] exportDrawnScenarioPdf : aucun bâtiment — export ignoré.');
    return;
  }

  const doc = new Doc();

  // ── Page 1 ──────────────────────────────────────────────────────────
  buildHeader(doc, projectTitle);
  buildStatusCard(doc, scenario);
  buildMetricsGrid(doc, scenario);
  buildConformity(doc, scenario);

  // ── Page 2 ──────────────────────────────────────────────────────────
  doc.addPage();
  buildEconomics(doc, scenario);
  buildScores(doc, scenario);
  buildNarrative(doc, scenario);
  buildDisclaimer(doc);

  // ── Filename ────────────────────────────────────────────────────────
  const safeTitle = projectTitle?.replace(/[^a-z0-9]/gi, '_').toLowerCase() ?? 'implantation';
  const date      = new Date().toISOString().slice(0, 10);
  doc.save(`mimmoza_${safeTitle}_${date}.pdf`);
}