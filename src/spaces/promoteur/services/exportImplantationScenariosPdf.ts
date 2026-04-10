// src/spaces/promoteur/services/exportImplantationScenariosPdf.ts
// Export PDF comparatif des 3 scénarios d'implantation.
//
// Structure :
//   Page 1 — Couverture + recommandation
//   Page 2 — Tableau comparatif
//   Pages 3-5 — Un scénario par page avec plan dessiné
//   Page 6 — Conclusion

import jsPDF from 'jspdf';
import type { ImplantationScenarioFull } from '../plan2d/scenarioGenerator.types';
import type { Point2D } from '../plan2d/editor2d.types';
import { rectCorners } from '../plan2d/editor2d.geometry';

// ─── PALETTE ──────────────────────────────────────────────────────────

const SP = {
  violet:   [79, 70, 229] as [number, number, number],
  violetL:  [237, 233, 254] as [number, number, number],
  teal:     [13, 148, 136] as [number, number, number],
  tealL:    [204, 251, 241] as [number, number, number],
  orange:   [245, 158, 11] as [number, number, number],
  orangeL:  [255, 251, 235] as [number, number, number],
  slate900: [15, 23, 42] as [number, number, number],
  slate700: [51, 65, 85] as [number, number, number],
  slate600: [71, 85, 105] as [number, number, number],
  slate500: [100, 116, 139] as [number, number, number],
  slate200: [226, 232, 240] as [number, number, number],
  slate100: [241, 245, 249] as [number, number, number],
  green:    [22, 163, 74] as [number, number, number],
  red:      [220, 38, 38] as [number, number, number],
  white:    [255, 255, 255] as [number, number, number],
};

const KEY_COLORS: Record<string, [number, number, number]> = {
  balanced:     SP.violet,
  max_potential: SP.orange,
  secured:      SP.teal,
};

const KEY_COLORS_L: Record<string, [number, number, number]> = {
  balanced:     SP.violetL,
  max_potential: SP.orangeL,
  secured:      SP.tealL,
};

// ─── HELPERS PDF ──────────────────────────────────────────────────────

function rgb(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(...c);
}
function fillRgb(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(...c);
}
function strokeRgb(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(...c);
}

function label(
  doc: jsPDF,
  txt: string,
  x: number,
  y: number,
  size: number,
  color: [number, number, number],
  bold = false,
  align: 'left' | 'center' | 'right' = 'left',
) {
  doc.setFontSize(size);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  rgb(doc, color);
  doc.text(txt, x, y, { align });
}

function hline(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  color = SP.slate200,
  lw = 0.3,
) {
  strokeRgb(doc, color);
  doc.setLineWidth(lw);
  doc.line(x, y, x + w, y);
}

function scoreBar(
  doc: jsPDF,
  score: number,
  x: number,
  y: number,
  w: number,
  color: [number, number, number],
) {
  const h = 4;
  fillRgb(doc, SP.slate200);
  doc.roundedRect(x, y, w, h, 1, 1, 'F');
  fillRgb(doc, color);
  doc.roundedRect(x, y, Math.max(0, Math.min(w, (w * score) / 100)), h, 1, 1, 'F');
}

function textLines(
  doc: jsPDF,
  txt: string,
  width: number,
  size: number,
  bold = false,
): string[] {
  doc.setFontSize(size);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  return doc.splitTextToSize(txt || '', width) as string[];
}

function lineHeight(size: number): number {
  return Math.max(3.6, size * 0.48);
}

function textBlockHeight(
  doc: jsPDF,
  txt: string,
  width: number,
  size: number,
  bold = false,
): number {
  const lines = textLines(doc, txt, width, size, bold);
  return lines.length * lineHeight(size);
}

function drawWrappedText(
  doc: jsPDF,
  txt: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: [number, number, number],
  bold = false,
): number {
  const lines = textLines(doc, txt, width, size, bold);
  doc.setFontSize(size);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  rgb(doc, color);
  doc.text(lines, x, y);
  return lines.length * lineHeight(size);
}

function drawBulletList(
  doc: jsPDF,
  items: string[],
  x: number,
  y: number,
  width: number,
  size: number,
  color: [number, number, number],
): number {
  let cy = y;
  const bulletGap = 3.5;
  const textWidth = Math.max(10, width - bulletGap);
  for (const item of items) {
    const lines = textLines(doc, item, textWidth, size, false);
    doc.setFontSize(size);
    doc.setFont('helvetica', 'normal');
    rgb(doc, color);
    doc.text('–', x, cy);
    doc.text(lines, x + bulletGap, cy);
    cy += lines.length * lineHeight(size) + 1.2;
  }
  return cy - y;
}

function getScenarioCardHeight(doc: jsPDF, sc: ImplantationScenarioFull, cardW: number): number {
  const pad = 4;
  const contentW = cardW - pad * 2;
  const descH = textBlockHeight(doc, sc.description, contentW, 6.5);
  return (
    18 + // bandeau
    8 +  // score
    7 +  // conforme
    7 +  // emprise
    7 +  // CES
    7 +  // bat/parking
    3 +  // gap
    descH +
    pad * 2
  );
}

// ─── DESSIN DU PLAN ───────────────────────────────────────────────────

interface DrawPlanParams {
  doc: jsPDF;
  scenario: ImplantationScenarioFull;
  parcel: Point2D[];
  envelope?: Point2D[] | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

function pdfPolygon(doc: jsPDF, pts: [number, number][], style: string) {
  if (pts.length < 3) return;
  const lines: number[][] = [];
  for (let i = 1; i < pts.length; i++) {
    lines.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  }
  doc.lines(lines, pts[0][0], pts[0][1], [1, 1], style, true);
}

function drawPlan({ doc, scenario, parcel, envelope, x, y, w, h }: DrawPlanParams) {
  if (!parcel.length) return;

  const allPts = [
    ...parcel,
    ...scenario.buildings.flatMap((b) => rectCorners(b.rect)),
    ...scenario.parkings.flatMap((p) => rectCorners(p.rect)),
  ];

  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const wW = maxX - minX || 1;
  const hW = maxY - minY || 1;
  const margin = 4;
  const scale = Math.min((w - margin * 2) / wW, (h - margin * 2) / hW);
  const ox = x + margin + ((w - margin * 2) - wW * scale) / 2;
  const oy = y + margin + ((h - margin * 2) - hW * scale) / 2;

  const tp = (p: Point2D): [number, number] => [
    ox + (p.x - minX) * scale,
    oy + (p.y - minY) * scale,
  ];

  doc.setFillColor(248, 250, 252);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h);

  if (envelope && envelope.length >= 3) {
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.4);
    try { doc.setLineDashPattern([2, 1.5], 0); } catch { /* ignore */ }
    pdfPolygon(doc, envelope.map(tp), 'S');
    try { doc.setLineDashPattern([], 0); } catch { /* ignore */ }
  }

  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(74, 124, 89);
  doc.setLineWidth(0.7);
  pdfPolygon(doc, parcel.map(tp), 'FD');

  doc.setFillColor(219, 234, 254);
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.4);
  for (const pk of scenario.parkings) {
    pdfPolygon(doc, rectCorners(pk.rect).map(tp), 'FD');
  }

  const [r, g, b] = KEY_COLORS[scenario.key];
  const [rl, gl, bl] = KEY_COLORS_L[scenario.key];
  doc.setFillColor(rl, gl, bl);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.6);
  for (const bldg of scenario.buildings) {
    pdfPolygon(doc, rectCorners(bldg.rect).map(tp), 'FD');
  }

  const legendY = y + h - 6;
  const legendItems: [string, number[]][] = [
    ['Parcelle',   [74, 124, 89]],
    ['Bâtiments',  [r, g, b]],
    ['Parking',    [59, 130, 246]],
  ];
  let lx = x + 3;
  for (const [lbl, c] of legendItems) {
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(lx, legendY, 3, 2.5, 'F');
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(lbl, lx + 4, legendY + 2);
    lx += 24;
  }
}

// ─── PAGE 1 : COUVERTURE ──────────────────────────────────────────────

function page1Cover(doc: jsPDF, scenarios: ImplantationScenarioFull[], commune?: string) {
  const W = 210;

  fillRgb(doc, SP.violet);
  doc.rect(0, 0, W, 60, 'F');

  label(doc, 'MIMMOZA', 20, 18, 9, SP.white, true);
  label(doc, 'Analyse d\'implantation', 20, 24, 9, SP.white);
  label(doc, 'Comparatif des scénarios d\'implantation', 20, 34, 16, SP.white, true);
  if (commune) label(doc, commune, 20, 45, 11, [196, 181, 253]);
  label(
    doc,
    new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
    20, 53, 8, [196, 181, 253],
  );

  const conformes = scenarios.filter((s) => s.isConforme);
  const best = conformes.length
    ? [...conformes].sort((a, b) => b.scoreGlobal - a.scoreGlobal)[0]
    : [...scenarios].sort((a, b) => b.scoreGlobal - a.scoreGlobal)[0];
  const hasConformeSc = conformes.length > 0;

  fillRgb(doc, [240, 253, 250]);
  strokeRgb(doc, SP.teal);
  doc.setLineWidth(0.5);
  doc.roundedRect(20, 75, 170, 38, 3, 3, 'FD');
  label(
    doc,
    hasConformeSc ? 'Scenario recommande' : 'Scenario le plus robuste (non conforme a ce stade)',
    28, 86, 8, SP.teal, true,
  );
  label(doc, best.title,    28,  96, 14, SP.slate900, true);
  label(doc, best.subtitle, 28, 104,  9, SP.slate600);
  label(doc, `Score global : ${best.scoreGlobal}/100`, 182, 100, 9, SP.teal, true, 'right');

  const cols   = [20, 80, 140];
  const sy     = 125;
  const cardW  = 58;
  const cardH  = Math.max(...scenarios.map((sc) => getScenarioCardHeight(doc, sc, cardW)), 94);

  for (let i = 0; i < 3; i++) {
    const sc = scenarios[i];
    const c  = KEY_COLORS[sc.key];
    const cl = KEY_COLORS_L[sc.key];
    const x  = cols[i];

    fillRgb(doc, cl);
    strokeRgb(doc, c);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, sy, cardW, cardH, 3, 3, 'FD');

    fillRgb(doc, c);
    doc.roundedRect(x, sy, cardW, 18, 3, 3, 'F');
    doc.rect(x, sy + 12, cardW, 6, 'F');
    label(doc, sc.title, x + 4, sy + 10, 8, SP.white, true);

    let cy = sy + 23;
    label(doc, `Score : ${sc.scoreGlobal}/100`, x + 4, cy, 8, SP.slate900, true); cy += 8;
    label(doc, sc.isConforme ? 'CONFORME' : 'NON CONF.', x + 4, cy, 7, sc.isConforme ? SP.green : SP.red, true); cy += 8;
    label(doc, `Emprise : ${sc.empriseM2.toFixed(0)} m²`, x + 4, cy, 7, SP.slate600); cy += 8;
    label(doc, `CES : ${(sc.cesPct * 100).toFixed(0)}%`, x + 4, cy, 7, SP.slate600); cy += 8;
    label(doc, `${sc.buildingCount} bât. · ${sc.parkingProvided} places`, x + 4, cy, 7, SP.slate600); cy += 8;

    drawWrappedText(doc, sc.description, x + 4, cy, cardW - 8, 6.5, SP.slate600);
  }

  hline(doc, 20, 272, 170);
  label(doc, 'Document généré par Mimmoza — Intelligence immobilière', 20, 279, 7, SP.slate600);
  label(doc, 'Page 1', 185, 279, 7, SP.slate600);
}

// ─── PAGE 2 : TABLEAU COMPARATIF ─────────────────────────────────────

function page2Comparatif(doc: jsPDF, scenarios: ImplantationScenarioFull[]) {
  doc.addPage();
  const W = 210;

  fillRgb(doc, SP.violet);
  doc.rect(0, 0, W, 20, 'F');
  label(doc, 'Tableau comparatif', 20, 13, 13, SP.white, true);

  // ── Hypothèses programme ─────────────────────────────────────────
  // Affichées en tête pour que le lecteur comprenne la base du calcul.
  const refSc    = scenarios[0];
  const nbLog    = refSc.nbLogements;
  const surfMoy  = refSc.surfaceMoyLogementM2;
  const hypoLine = nbLog !== undefined
    ? `Hypothèses programme : ${nbLog} logements · surf. moy. ${surfMoy ?? 65} m² · 1 place/logement`
    : 'Hypothèses parking : nombre de logements non défini — conformité stationnement non évaluée';
  const hypoColor: [number, number, number] = nbLog !== undefined ? SP.slate600 : SP.orange;

  label(doc, hypoLine, 20, 27, 7, hypoColor);

  const rows: [string, (sc: ImplantationScenarioFull) => string, (sc: ImplantationScenarioFull) => boolean][] = [
    ['Score global',      (sc) => `${sc.scoreGlobal}/100`,                              () => false],
    ['Conformite PLU',    (sc) => (sc.isConforme ? 'CONFORME' : 'NON CONF.'),           () => false],
    ['Emprise bâtiments', (sc) => `${sc.empriseM2.toFixed(0)} m²`,                     () => false],
    ['CES utilisé',       (sc) => `${(sc.cesPct * 100).toFixed(1)}%`,                  () => false],
    ['SHON estimée',      (sc) => `${sc.totalFloorsAreaM2.toFixed(0)} m²`,             () => false],
    ['Nb bâtiments',      (sc) => `${sc.buildingCount}`,                               () => false],
    ['Logements (prog.)', (sc) => sc.nbLogements !== undefined ? `${sc.nbLogements}` : 'non défini', () => false],
    ['Places requises',   (sc) => sc.nbLogements !== undefined ? `${sc.parkingRequired}` : '—',       () => false],
    ['Places fournies',   (sc) => `${sc.parkingProvided}`,                             () => false],
    ['Score régl.',       (sc) => `${sc.scoreReglementaire}/100`,                      () => false],
    ['Score foncier',     (sc) => `${sc.scoreFoncier}/100`,                            () => false],
    ['Score simplicité',  (sc) => `${sc.scoreSimplicite}/100`,                         () => false],
  ];

  const labelX = 20;
  const colW   = 39;
  const colXs  = [72, 114, 156];

  // ── Cartes de version ────────────────────────────────────────────
  let ry = 34;

  for (let i = 0; i < 3; i++) {
    const c  = KEY_COLORS[scenarios[i].key];
    const cl = KEY_COLORS_L[scenarios[i].key];
    fillRgb(doc, cl);
    strokeRgb(doc, c);
    doc.setLineWidth(0.4);
    doc.roundedRect(colXs[i], ry, colW, 12, 2, 2, 'FD');
    label(doc, scenarios[i].title, colXs[i] + colW / 2, ry + 7.5, 7.2, c, true, 'center');
  }

  ry += 24; // gap entre cartes et tableau

  // ── Lignes de données ────────────────────────────────────────────
  for (let ri = 0; ri < rows.length; ri++) {
    const [rowLabel, fn] = rows[ri];

    if (ri % 2 === 0) {
      fillRgb(doc, [248, 250, 252]);
      doc.rect(20, ry - 4, 170, 9, 'F');
    }

    label(doc, rowLabel, labelX + 2, ry + 1, 8, SP.slate600);

    for (let i = 0; i < 3; i++) {
      const val             = fn(scenarios[i]);
      const isConformityRow = rowLabel === 'Conformite PLU';
      const isParkingRow    = rowLabel === 'Places requises' || rowLabel === 'Places fournies';
      const isUndefined     = val === '—' || val === 'non défini';

      const color: [number, number, number] = isConformityRow
        ? (scenarios[i].isConforme ? SP.green : SP.red)
        : isUndefined
          ? SP.orange
          : SP.slate900;

      label(doc, val, colXs[i] + colW / 2, ry + 1, 8, color,
        rowLabel === 'Score global', 'center');
    }

    hline(doc, 20, ry + 5, 170, SP.slate200, 0.2);
    ry += 10;
  }

  // ── Barres de score ───────────────────────────────────────────────
  ry += 10;
  label(doc, 'Scores visuels', 20, ry, 10, SP.slate900, true);
  ry += 8;

  const scoreKeys: [string, keyof ImplantationScenarioFull][] = [
    ['Global',        'scoreGlobal'],
    ['Réglementaire', 'scoreReglementaire'],
    ['Foncier',       'scoreFoncier'],
    ['Simplicité',    'scoreSimplicite'],
  ];

  const barW = 26;
  for (const [sLabel, key] of scoreKeys) {
    label(doc, sLabel, 22, ry + 4, 7.5, SP.slate600);
    for (let i = 0; i < 3; i++) {
      const cellX = colXs[i];
      scoreBar(doc, scenarios[i][key] as number, cellX, ry, barW, KEY_COLORS[scenarios[i].key]);
      label(doc, `${scenarios[i][key]}`, cellX + barW + 6, ry + 4, 7, SP.slate600, false, 'center');
    }
    ry += 12;
  }

  hline(doc, 20, 272, 170);
  label(doc, 'Mimmoza — Analyse d\'implantation', 20, 279, 7, SP.slate600);
  label(doc, 'Page 2', 185, 279, 7, SP.slate600);
}

// ─── PAGES 3-5 : SCÉNARIOS ───────────────────────────────────────────

function pageScenario(
  doc: jsPDF,
  scenario: ImplantationScenarioFull,
  pageNum: number,
  parcel: Point2D[],
  envelope?: Point2D[] | null,
) {
  doc.addPage();
  const W = 210;
  const c  = KEY_COLORS[scenario.key];
  const cl = KEY_COLORS_L[scenario.key];

  // ── Bandeau titre ─────────────────────────────────────────────────
  fillRgb(doc, c);
  doc.rect(0, 0, W, 22, 'F');
  label(doc, scenario.title,    20,  12, 14, SP.white, true);
  label(doc, scenario.subtitle, 20,  19,  9, [220, 220, 255]);
  label(doc, scenario.isConforme ? 'CONFORME PLU' : 'NON CONFORME', 190, 14, 9, SP.white, true, 'right');

  // ── Plan (colonne gauche) — x:20, y:28, 100×100 mm ───────────────
  const PLAN_BOTTOM = 28 + 100; // = 128

  drawPlan({ doc, scenario, parcel, envelope, x: 20, y: 28, w: 100, h: 100 });

  // ── Métriques (colonne droite) ────────────────────────────────────
  const mx = 128;
  let my   = 32;

  const metrics: [string, string][] = [
    ['Emprise',         `${scenario.empriseM2.toFixed(0)} m²`],
    ['CES',             `${(scenario.cesPct * 100).toFixed(1)}%`],
    ['SHON estimée',    `${scenario.totalFloorsAreaM2.toFixed(0)} m²`],
    ['Bâtiments',       `${scenario.buildingCount}`],
    ['Logements (prog.)', scenario.nbLogements !== undefined ? `${scenario.nbLogements}` : 'non défini'],
    ['Places requises', scenario.nbLogements !== undefined ? `${scenario.parkingRequired}` : '—'],
    ['Places fournies', `${scenario.parkingProvided}`],
    ['Score global',    `${scenario.scoreGlobal}/100`],
  ];

  for (const [ml, mv] of metrics) {
    fillRgb(doc, cl);
    doc.roundedRect(mx, my, 62, 10, 2, 2, 'F');
    label(doc, ml, mx + 3,  my + 6.5, 7.2, c);
    label(doc, mv, mx + 59, my + 6.5, 8, SP.slate900, true, 'right');
    my += 12;
  }

  my += 4; // 7 × 12 + 4 = 88 → my ≈ 32 + 88 = 120

  for (const [sl, key] of [
    ['Régl.',   'scoreReglementaire'],
    ['Foncier', 'scoreFoncier'],
    ['Simpl.',  'scoreSimplicite'],
  ] as [string, keyof ImplantationScenarioFull][]) {
    label(doc, sl, mx, my + 4, 7, SP.slate600);
    scoreBar(doc, scenario[key] as number, mx + 18, my, 34, c);
    label(doc, `${scenario[key]}`, mx + 60, my + 4, 7, SP.slate600, false, 'right');
    my += 9;
  }
  // 3 × 9 = 27 → my ≈ 120 + 27 = 147

  // ── "Lecture métier" — démarre après le bas des deux colonnes ─────
  // On prend le max du bas du plan (128) et du bas des métriques (my),
  // puis on ajoute un gap de sécurité de 8 mm.
  const SECTION_GAP = 8;
  let dy = Math.max(PLAN_BOTTOM, my) + SECTION_GAP;

  label(doc, 'Lecture métier', 20, dy, 9, SP.slate900, true);
  hline(doc, 20, dy + 2, 170, c, 0.6);
  dy += 9;

  dy += drawWrappedText(doc, scenario.description, 20, dy, 170, 8.5, SP.slate600) + 4;

  label(doc, 'Points forts', 20, dy, 9, SP.green, true);
  dy += 6;
  dy += drawBulletList(doc, scenario.strengths, 22, dy, 166, 7.5, SP.slate900);
  dy += 2;

  label(doc, 'Points de vigilance', 20, dy, 9, SP.orange, true);
  dy += 6;
  dy += drawBulletList(
    doc,
    scenario.vigilance.length
      ? scenario.vigilance
      : ['Aucun point de vigilance majeur identifié à ce stade.'],
    22, dy, 166, 7.5, SP.slate900,
  );

  hline(doc, 20, 272, 170);
  label(doc, `Mimmoza — ${scenario.title}`, 20, 279, 7, SP.slate600);
  label(doc, `Page ${pageNum}`, 185, 279, 7, SP.slate600);
}

// ─── PAGE 6 : CONCLUSION ──────────────────────────────────────────────

function page6Conclusion(doc: jsPDF, scenarios: ImplantationScenarioFull[]) {
  doc.addPage();
  const W = 210;

  fillRgb(doc, SP.slate900);
  doc.rect(0, 0, W, 22, 'F');
  label(doc, 'Conclusion & recommandation', 20, 13, 13, SP.white, true);

  const conformes = scenarios.filter((s) => s.isConforme);
  const best      = conformes.length
    ? [...conformes].sort((a, b) => b.scoreGlobal - a.scoreGlobal)[0]
    : [...scenarios].sort((a, b) => b.scoreGlobal - a.scoreGlobal)[0];
  const hasConformeSc = conformes.length > 0;
  const c = KEY_COLORS[best.key];

  fillRgb(doc, KEY_COLORS_L[best.key]);
  strokeRgb(doc, c);
  doc.setLineWidth(0.6);
  doc.roundedRect(20, 32, 170, 30, 3, 3, 'FD');
  label(
    doc,
    hasConformeSc
      ? `Scenario recommande : ${best.title}`
      : `Scenario le plus robuste : ${best.title} (non conforme a ce stade)`,
    28, 43, 12, c, true,
  );
  label(
    doc,
    hasConformeSc ? best.subtitle : 'Aucun scenario pleinement conforme - programme a ajuster',
    28, 52, 9, SP.slate600,
  );

  let dy = 75;
  label(doc, 'Pourquoi ce scénario ?', 20, dy, 10, SP.slate900, true);
  hline(doc, 20, dy + 2, 170, c, 0.5);
  dy += 10;
  dy += drawBulletList(doc, best.strengths, 22, dy, 166, 8.5, SP.slate900);
  dy += 5;

  label(doc, 'Comparaison synthétique', 20, dy, 10, SP.slate900, true);
  hline(doc, 20, dy + 2, 170, SP.slate200, 0.3);
  dy += 10;

  for (const sc of scenarios) {
    const col = KEY_COLORS[sc.key];
    fillRgb(doc, KEY_COLORS_L[sc.key]);
    strokeRgb(doc, col);
    doc.setLineWidth(0.4);
    doc.roundedRect(20, dy, 170, 16, 2, 2, 'FD');
    label(doc, sc.title, 26, dy + 7, 9, col, true);
    label(doc, `Score : ${sc.scoreGlobal}/100`, 112, dy + 7, 9, SP.slate900, true, 'center');
    label(doc, sc.isConforme ? 'OK' : 'NO', 142, dy + 7, 10, sc.isConforme ? SP.green : SP.red, true, 'center');
    label(doc, `${sc.empriseM2.toFixed(0)} m² · ${sc.parkingProvided} pl.`, 184, dy + 7, 8, SP.slate600, false, 'right');
    dy += 19;
  }

  dy += 8;
  const concl = [
    'Cette analyse a été produite automatiquement par Mimmoza à titre de première évaluation de faisabilité.',
    'Elle ne remplace pas une étude de maîtrise d\'œuvre ni une consultation du service instructeur PLU.',
    'Les métriques sont calculées sur la base du plan masse dessiné et des paramètres PLU configurés.',
  ];
  for (const line of concl) {
    const wrapped = textLines(doc, line, 170, 8, false);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    rgb(doc, SP.slate600);
    doc.text(wrapped, 20, dy);
    dy += wrapped.length * lineHeight(8) + 2;
  }

  hline(doc, 20, 272, 170);
  label(doc, 'Mimmoza — Intelligence immobilière', 20, 279, 7, SP.slate600);
  label(doc, 'Page 6', 185, 279, 7, SP.slate600);
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

export interface ExportImplantationPdfParams {
  scenarios: ImplantationScenarioFull[];
  parcel:    Point2D[];
  envelope?: Point2D[] | null;
  commune?:  string;
  filename?: string;
}

export function exportImplantationScenariosPdf({
  scenarios,
  parcel,
  envelope,
  commune,
  filename = 'implantation-scenarios.pdf',
}: ExportImplantationPdfParams): void {
  if (!scenarios.length) return;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'normal');

  page1Cover(doc, scenarios, commune);
  page2Comparatif(doc, scenarios);
  for (let i = 0; i < scenarios.length; i++) {
    pageScenario(doc, scenarios[i], i + 3, parcel, envelope);
  }
  page6Conclusion(doc, scenarios);

  doc.save(filename);
}