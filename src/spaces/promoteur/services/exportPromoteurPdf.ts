// src/spaces/promoteur/services/exportPromoteurPdf.ts
// Promoteur PDF Export — v3.1 Corporate / Consulting (McKinsey-BCG style)
//
// v3.1 — Null-safe rendering :
//   - addRisques : table simplifiée (Risque / Niveau / Mitigation) pour
//     s'aligner sur le type RisqueItem v4.0 minimaliste (plus de NaN% sur
//     probabilite/impact qui n'existent plus, plus de colonne Catégorie
//     vide, plus de KPI "Kill switches" toujours à 0).
//   - addTechnique / Contraintes PLU : lecture correcte des champs
//     valeurProjet et valeurPlu (le champ c.valeur n'existe pas sur
//     ContrainteTechnique), affichage du statut A_VERIFIER en "À VÉRIFIER",
//     couleurs de statut corrigées (BLOQUANT/À VÉRIFIER/CONFORME).
//
// v3 — Refactored: modular architecture, business validation, audit-driven rendering.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  PromoteurSynthese, RecommendationType, RisqueNiveau, RisqueItem, Scenario,
} from './promoteurSynthese.types';
import { C, LAYOUT, CW, F, type RGB } from './promoteurPdf.theme';
import {
  s, fmtNum, eur, eurM, pct, m2v, safePct, safeDiv,
  recColor, risqueColor, REC_LABELS, REC_LABELS_SHORT,
  DOC_STATUS_LABELS, DOC_STATUS_COLORS, DOC_USAGE_LABELS,
  fmtDate, fmtDateLong, fmtTime,
  type DocumentStatus,
} from './promoteurPdf.formatters';
import { auditSynthese, type DocumentAudit } from './promoteurPdf.audit';
import { drawQr, drawDocRef, getVerificationUrl } from './promoteurPdf.qr';
import {
  buildMetricContext, filterPointsForts, isMarginReliable, isTrnReliable,
  isFinancialExploitable, isMarketPositionReliable, areScenariosExploitable,
  generateExecMotif, generateFinancierConclusion, generateMarcheConclusion,
  generateTechniqueConclusion, getEffectiveFaisabilite, scenariosGate,
  filterSyntheseIA, shouldShowSyntheseIA,
  generateFinalRecommendationText, generateFinalIAConclusion,
  INCOMPLETE_NO_POINTS_FORTS, getCoverDocTypeLabel,
  getCoverStatusLabel, getCoverRecommendationLabel,
  type MetricContext,
} from './promoteurPdf.narrative';

const { ML, MR, MT, MB, PW, PH, HDR_H, FTR_H } = LAYOUT;

// ============================================================================
// SPACE PALETTE — Promoteur = Violet
// ============================================================================
const SP = {
  deep:    [72,  47,  135] as RGB,   // #482F87
  main:    [82,  71,  184] as RGB,   // #5247B8
  med:     [124, 111, 205] as RGB,   // #7C6FCD
  light:   [157, 141, 219] as RGB,   // #9D8DDB
  pale:    [195, 182, 235] as RGB,   // #C3B6EB
  ultra:   [225, 218, 245] as RGB,   // #E1DAF5
  crystal: [240, 236, 250] as RGB,   // #F0ECFA
  label:   'SYNTHÈSE PROMOTEUR',
} as const;

// ============================================================================
// STATE
// ============================================================================

interface St {
  doc: jsPDF;
  p: number;
  y: number;
  syn: PromoteurSynthese;
  audit: DocumentAudit;
  mc: MetricContext;
  tocEntries: TocEntry[];
  facadeRenderUrl:        string | null;
  carteScreenshot:        string | null;
  implantationScreenshot: string | null;
  massing3DScreenshot:    string | null;
  renduTravauxSynthese:   RenduTravauxSynthesePdf | null;
}

interface TocEntry {
  num: string;
  label: string;
  page: number;
}

interface RenduTravauxSynthesePdf {
  id: string;
  sourceImageId?: string;
  sourcePreview?: string;
  generatedImageUrl: string;
  prompt?: string;
  generatedAt?: string | Date;
  durationMs?: number;
  configSnapshot?: {
    gamme?: string;
    niveau?: string;
    styleDecoration?: string;
    mobilier?: string;
    solType?: string;
    solColor?: string;
    murColor?: string;
    lots?: string[];
  } | null;
}

function newPage(st: St): void {
  st.doc.addPage();
  st.p++;
  st.y = MT + HDR_H + 5;
  pageHeader(st);
}

function chk(st: St, n: number): void {
  if (st.y + n > PH - FTR_H - MB) newPage(st);
}

function tocRegister(st: St, num: string, label: string): void {
  st.tocEntries.push({ num, label, page: st.p });
}

// ============================================================================
// HEADER / FOOTER
// ============================================================================

function pageHeader(st: St): void {
  const { doc, syn, p, audit } = st;

  doc.setFillColor(...SP.deep);
  doc.rect(0, 0, PW, HDR_H, 'F');
  doc.setFillColor(...SP.main);
  doc.rect(0, HDR_H, PW, 0.4, 'F');

  doc.setFontSize(F.xs);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.white);
  doc.text('MIMMOZA', ML, 7.2);

  doc.setFont('helvetica', 'normal');
  const title = syn.projet.commune
    ? s(`${syn.projet.programmeType} — ${syn.projet.commune} (${syn.projet.codePostal})`)
    : s('Synthèse Promoteur');
  doc.text(doc.splitTextToSize(title, 100)[0], PW / 2, 7.2, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.text(`${p}`, PW - MR, 7.2, { align: 'right' });
}

function pageFooter(st: St): void {
  const { doc, audit } = st;
  const y = PH - FTR_H;
  doc.setDrawColor(...C.slate4);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);

  doc.setFontSize(F.xs);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate3);
  doc.text(s('CONFIDENTIEL — Usage interne exclusif'), ML, y + 5);
  drawDocRef(doc, PW / 2, y + 5, audit.documentId, 'center');
  doc.text(fmtDate(new Date()), PW - MR, y + 5, { align: 'right' });
}

// ============================================================================
// TYPOGRAPHY HELPERS
// ============================================================================

function secTitle(st: St, num: string, label: string): void {
  chk(st, 16);
  const { doc } = st;

  doc.setFillColor(...SP.main);
  doc.rect(ML, st.y, 3, 10, 'F');

  if (num) {
    doc.setFontSize(F.xs);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SP.main);
    doc.text(num, ML + 6, st.y + 4.5);
  }

  doc.setFontSize(F.h2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SP.deep);
  doc.text(s(label), ML + (num ? 16 : 6), st.y + 8);

  doc.setFillColor(...C.slate5);
  doc.rect(ML, st.y + 11, CW, 0.3, 'F');
  st.y += 16;
}

function subTitle(st: St, label: string): void {
  chk(st, 10);
  const { doc } = st;
  doc.setFontSize(F.h4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SP.deep);
  doc.text(s(label).toUpperCase(), ML, st.y);
  doc.setFillColor(...SP.main);
  doc.rect(ML, st.y + 2, 18, 0.5, 'F');
  st.y += 7;
}

function body(st: St, text: string, indent = 0): void {
  const { doc } = st;
  doc.setFontSize(F.body);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.black);
  const lines = doc.splitTextToSize(s(text), CW - indent);
  chk(st, lines.length * 5 + 2);
  doc.text(lines, ML + indent, st.y);
  st.y += lines.length * 5 + 3;
}

function rule(st: St): void {
  st.doc.setFillColor(...C.slate5);
  st.doc.rect(ML, st.y, CW, 0.3, 'F');
  st.y += 5;
}

function alertBanner(st: St, text: string, color: RGB, bgColor?: RGB): void {
  chk(st, 14);
  const { doc } = st;
  const bg = bgColor ?? [
    Math.min(255, color[0] + 100),
    Math.min(255, color[1] + 130),
    Math.min(255, color[2] + 130),
  ] as RGB;
  doc.setFillColor(...bg);
  doc.rect(ML, st.y, CW, 12, 'F');
  doc.setFillColor(...color);
  doc.rect(ML, st.y, 3, 12, 'F');
  doc.setFontSize(F.h4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...color);
  const lines = doc.splitTextToSize(s(text), CW - 12);
  doc.text(lines[0], ML + 7, st.y + 8);
  st.y += 15;
}

// ============================================================================
// KPI CARDS
// ============================================================================

function kpiGrid(
  st: St,
  items: Array<{ label: string; value: string; sub?: string; color?: RGB }>,
  cols = 3,
): void {
  const rows = Math.ceil(items.length / cols);
  chk(st, rows * 22 + 4);
  const { doc } = st;
  const cw = CW / cols;

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * cw;
    const y = st.y + row * 22;

    doc.setFillColor(...C.slate6);
    doc.rect(x + 1, y, cw - 3, 19, 'F');
    doc.setFillColor(...SP.deep);
    doc.rect(x + 1, y, cw - 3, 1.5, 'F');

    doc.setFontSize(F.xs);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.slate2);
    doc.text(s(items[i].label).toUpperCase(), x + cw / 2 - 1, y + 6, { align: 'center' });

    doc.setFontSize(F.h3);
    doc.setFont('helvetica', 'bold');
    const isNA = items[i].value === 'N/A';
    doc.setTextColor(...(isNA ? C.slate3 : (items[i].color ?? SP.deep)));
    doc.text(s(items[i].value), x + cw / 2 - 1, y + 14, { align: 'center' });

    if (items[i].sub) {
      doc.setFontSize(F.xs);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.slate3);
      doc.text(s(items[i].sub!), x + cw / 2 - 1, y + 18.5, { align: 'center' });
    }
  }
  st.y += rows * 22 + 4;
}

// ============================================================================
// SCORE BAR
// ============================================================================

function scoreLine(st: St, label: string, score: number, invert = false): void {
  chk(st, 8);
  const { doc } = st;
  const display = invert ? 100 - score : score;
  const barW = CW * 0.42;
  const barX = ML + 55;
  const barH = 4;
  const barY = st.y - 3.5;
  const filled = (barW * score) / 100;

  const endColor: RGB = display >= 70 ? SP.main : display >= 45 ? C.amber : C.red;
  const startColor: RGB = display >= 70
    ? SP.ultra
    : [Math.min(255, endColor[0] + 140), Math.min(255, endColor[1] + 130), Math.min(255, endColor[2] + 120)];

  doc.setFontSize(F.sm);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.black);
  doc.text(s(label), ML, st.y);

  doc.setFillColor(...C.slate5);
  doc.rect(barX, barY, barW, barH, 'F');

  if (filled > 0) {
    const N = 28;
    const sliceW = filled / N;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      doc.setFillColor(
        Math.round(startColor[0] + (endColor[0] - startColor[0]) * t),
        Math.round(startColor[1] + (endColor[1] - startColor[1]) * t),
        Math.round(startColor[2] + (endColor[2] - startColor[2]) * t),
      );
      doc.rect(barX + i * sliceW, barY, sliceW + 0.2, barH, 'F');
    }
  }

  doc.setFontSize(F.sm);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...endColor);
  doc.text(`${score}`, barX + barW + 3, st.y);
  st.y += 7;
}

// ============================================================================
// GRADIENT HELPERS
// ============================================================================

function drawGradientH(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  from: RGB, to: RGB, steps = 30,
): void {
  const sliceW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    );
    doc.rect(x + i * sliceW, y, sliceW + 0.2, h, 'F');
  }
}

function drawGradientV(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  from: RGB, to: RGB, steps = 40,
): void {
  const sliceH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    );
    doc.rect(x, y + i * sliceH, w, sliceH + 0.3, 'F');
  }
}

// ============================================================================
// COVER PAGE — Flowing ribbon design
// ============================================================================

function cbez(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function cbezD(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c);
}

interface RibbonDef {
  p0: [number, number]; p1: [number, number];
  p2: [number, number]; p3: [number, number];
  w0: number; w1: number;
  c0: RGB;    c1: RGB;
}

function drawRibbon(doc: jsPDF, r: RibbonDef, steps = 150): void {
  let prevL: [number, number] | null = null;
  let prevR: [number, number] | null = null;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    const cx = cbez(t, r.p0[0], r.p1[0], r.p2[0], r.p3[0]);
    const cy = cbez(t, r.p0[1], r.p1[1], r.p2[1], r.p3[1]);

    let tx = cbezD(t, r.p0[0], r.p1[0], r.p2[0], r.p3[0]);
    let ty = cbezD(t, r.p0[1], r.p1[1], r.p2[1], r.p3[1]);
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= len; ty /= len;

    const nx = -ty, ny = tx;
    const w = r.w0 + (r.w1 - r.w0) * t;

    const lx = cx + nx * w / 2;
    const ly = cy + ny * w / 2;
    const rx = cx - nx * w / 2;
    const ry = cy - ny * w / 2;

    if (prevL && prevR && i > 0) {
      const cr = Math.round(r.c0[0] + (r.c1[0] - r.c0[0]) * t);
      const cg = Math.round(r.c0[1] + (r.c1[1] - r.c0[1]) * t);
      const cb = Math.round(r.c0[2] + (r.c1[2] - r.c0[2]) * t);

      doc.setFillColor(cr, cg, cb);
      doc.setDrawColor(cr, cg, cb);
      doc.setLineWidth(0.1);

      doc.lines(
        [
          [lx - prevL[0], ly - prevL[1]],
          [rx - lx, ry - ly],
          [prevR[0] - rx, prevR[1] - ry],
        ],
        prevL[0], prevL[1], [1, 1], 'FD', true,
      );
    }

    prevL = [lx, ly];
    prevR = [rx, ry];
  }
}

// ── Cover page (async — premium cover corrected) ─────────────────────────────

async function addCover(st: St): Promise<void> {
  const { doc, syn, audit, mc } = st;
  const es = syn.executiveSummary;
  const status = audit.documentStatus;

  const V = {
    bgTop:        [6, 4, 40] as RGB,
    bgBottom:     [16, 9, 68] as RGB,

    panel:        [6, 5, 34] as RGB,
    panel2:       [24, 16, 74] as RGB,

    main:         [124, 84, 255] as RGB,
    soft:         [170, 136, 255] as RGB,
    white:        [255, 255, 255] as RGB,
    lightText:    [224, 218, 246] as RGB,
    muted:        [177, 168, 217] as RGB,
    faint:        [95, 84, 154] as RGB,

    cardFill:     [12, 9, 52] as RGB,
    cardStroke:   [104, 82, 188] as RGB,

    darkVeil:     [8, 5, 26] as RGB,
    amber:        [245, 189, 54] as RGB,
  };

  const pageW = PW;
  const pageH = PH;
  const left = 14;
  const right = pageW - 14;

  const panelW = 104;
  const heroX = 104;
  const heroY = 0;
  const heroW = pageW - heroX;
  const heroH = pageH;

  // ==========================================================================
  // BACKGROUND
  // ==========================================================================

  drawGradientV(doc, 0, 0, pageW, pageH, V.bgTop, V.bgBottom, 100);

  // ==========================================================================
  // RIGHT HERO IMAGE (cover mode, centered, no deformation)
  // ==========================================================================

  if (st.facadeRenderUrl) {
    try {
      const hero = await buildCoverImageForBox(st.facadeRenderUrl, heroW, heroH);
      doc.addImage(hero.dataUrl, hero.format, heroX, heroY, heroW, heroH);
    } catch (e) {
      console.warn('[exportPromoteurPdf] cover facade image failed:', e);
      drawGradientV(doc, heroX, heroY, heroW, heroH, [74, 64, 136], [24, 18, 56], 60);
      drawFallbackArchitecturalPattern(doc, heroX, heroY, heroW, heroH);
    }
  } else {
    drawGradientV(doc, heroX, heroY, heroW, heroH, [74, 64, 136], [24, 18, 56], 60);
    drawFallbackArchitecturalPattern(doc, heroX, heroY, heroW, heroH);
  }

  // voile premium léger sur l'image
  setOpacity(doc, 0.12);
  doc.setFillColor(...V.darkVeil);
  doc.rect(heroX, heroY, heroW, heroH, 'F');
  setOpacity(doc, 1);

  // ==========================================================================
  // LEFT MASTER PANEL — RECTANGULAIRE, SANS COUPE DIAGONALE
  // ==========================================================================

  doc.setFillColor(...V.panel2);
  doc.rect(0, 0, panelW, pageH, 'F');

  setOpacity(doc, 0.04);
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, panelW, pageH, 'F');
  setOpacity(doc, 1);

  // ==========================================================================
  // HEADER BRAND
  // ==========================================================================

  const logoX = left;
  const logoY = 15;

  drawMimmozaCube(doc, logoX, logoY, 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...V.white);
  doc.text('MIMMOZA', logoX + 16, logoY + 2.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...V.lightText);
  doc.text(s('Intelligence immobilière B2B'), logoX + 16, logoY + 8.5);

  // ==========================================================================
  // TITRES
  // ==========================================================================

  doc.setDrawColor(...V.soft);
  doc.setLineWidth(0.8);
  doc.line(left, 49, left + 16, 49);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...V.soft);
  doc.text(s('SYNTHÈSE PROMOTEUR'), left, 59);

  const opTitle = es.titreOperation || s(`${syn.projet.programmeType || 'Opération'}`);
  const titleLines = doc.splitTextToSize(s(opTitle).toUpperCase(), 74);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(...V.white);
  doc.text(titleLines, left, 78);

  const titleBottom = 78 + (titleLines.length - 1) * 10;

  const commune = syn.projet.commune || '';
  const cp = syn.projet.codePostal || '';
  const locLine = commune ? s(`${cp} ${commune}`) : s('LOCALISATION NON RENSEIGNÉE');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...V.main);
  doc.text(locLine, left, titleBottom + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.4);
  doc.setTextColor(...V.white);
  const subtitle = doc.splitTextToSize(
    s("Étude de marché, analyse économique et dossier comité d'investissement"),
    72,
  );
  doc.text(subtitle, left, titleBottom + 24);

  // ==========================================================================
  // STATUS / RECO / REF BLOCK
  // ==========================================================================

  const stCol: RGB =
    status === 'incomplete' ? C.red :
    status === 'provisional' ? C.amber :
    V.amber;

  const recLabel = getCoverRecommendationLabel(status, audit.effectiveRecommendation);
  const recCol: RGB =
    status === 'incomplete' ? C.red :
    status === 'provisional' ? V.amber :
    V.amber;

  const infoX = left;
  const infoY = 146;
  const infoW = 74;
  const rowH = 21.5;

  doc.setDrawColor(...V.main);
  doc.setLineWidth(0.7);
  doc.line(infoX, infoY - 3, infoX, infoY + rowH * 3 + 4);

  const infoRows = [
    {
      label: 'STATUT DU DOSSIER',
      value: s(getCoverStatusLabel(status)).toUpperCase(),
      color: stCol,
      icon: 'DOC',
    },
    {
      label: 'RECOMMANDATION',
      value: s(recLabel).toUpperCase(),
      color: recCol,
      icon: 'TARGET',
    },
    {
      label: 'RÉFÉRENCE DOSSIER',
      value: audit.documentId,
      color: V.white,
      icon: 'FOLDER',
    },
  ];

  infoRows.forEach((row, i) => {
    const y = infoY + i * rowH;
    const cx = infoX + 12;
    const cy = y + 6.8;

    doc.setDrawColor(...V.soft);
    doc.setLineWidth(0.35);
    doc.circle(cx, cy, 6.2);

    if (row.icon === 'DOC') {
      drawDocIcon(doc, cx, cy, V.white);
    } else if (row.icon === 'TARGET') {
      drawTargetIcon(doc, cx, cy, V.white);
    } else {
      drawFolderIcon(doc, cx, cy, V.white);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...V.muted);
    doc.text(row.label, infoX + 26, y + 4.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.8);
    doc.setTextColor(...row.color);
    doc.text(row.value, infoX + 26, y + 11.8);

    doc.setFillColor(...V.main);
    doc.circle(infoX + infoW + 6, y + 7, 1.15, 'F');

    if (i < infoRows.length - 1) {
      doc.setDrawColor(...V.faint);
      doc.setLineWidth(0.2);
      doc.line(infoX + 26, y + rowH - 2.8, infoX + infoW + 1, y + rowH - 2.8);
    }
  });

  // ==========================================================================
  // KPI STRIP
  // ==========================================================================

  const hasFin = mc.hasCA && mc.hasCDR;
  const kpiY = pageH - 64;
  const kpiX = 11;
  const kpiW = pageW - 22;
  const kpiH = 30;

  setOpacity(doc, 0.95);
  doc.setFillColor(...V.cardFill);
  doc.setDrawColor(...V.cardStroke);
  doc.setLineWidth(0.35);
  doc.roundedRect(kpiX, kpiY, kpiW, kpiH, 6, 6, 'FD');
  setOpacity(doc, 1);

  const kpis = [
    {
      label: 'MARGE NETTE',
      value: hasFin && isMarginReliable(mc) ? pct(syn.financier.margeNettePercent) : 'N/A',
    },
    {
      label: 'TRN',
      value: hasFin && isTrnReliable(mc) ? pct(syn.financier.trnRendement) : 'N/A',
    },
    {
      label: 'CA TOTAL HT',
      value: mc.hasCA ? eurM(syn.financier.chiffreAffairesTotal) : 'N/A',
    },
    {
      label: 'LOGEMENTS',
      value: mc.hasLots ? String(syn.projet.nbLogements) : 'N/A',
    },
    {
      label: 'SCORE GLOBAL',
      value: `${es.scores.global}/100`,
    },
  ];

  const colW = kpiW / kpis.length;
  kpis.forEach((k, i) => {
    const x = kpiX + i * colW;
    const cx = x + colW / 2;

    if (i > 0) {
      doc.setDrawColor(...V.cardStroke);
      doc.setLineWidth(0.2);
      doc.line(x, kpiY + 5.2, x, kpiY + kpiH - 5.2);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...V.lightText);
    doc.text(s(k.label), cx, kpiY + 11.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(...V.white);
    doc.text(s(k.value), cx, kpiY + 22.5, { align: 'center' });

    doc.setDrawColor(...V.main);
    doc.setLineWidth(0.55);
    doc.line(cx - 5, kpiY + 25.8, cx + 5, kpiY + 25.8);
  });

  // ==========================================================================
  // FOOTER
  // ==========================================================================

  const ftY = pageH - 15;

  doc.setDrawColor(...V.faint);
  doc.setLineWidth(0.25);
  doc.line(left - 2, ftY - 9, right, ftY - 9);

  drawCalendarIcon(doc, left + 6, ftY - 0.5, V.soft);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(...V.muted);
  doc.text(s('GÉNÉRÉ LE'), left + 16, ftY - 1.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  doc.setTextColor(...V.white);
  doc.text(`${fmtDate(new Date())} à ${fmtTime()}`, left + 16, ftY + 4.8);

  doc.setDrawColor(...V.main);
  doc.setLineWidth(0.35);
  doc.circle(pageW / 2 - 2, ftY + 0.5, 7.6);
  doc.circle(pageW / 2 - 2, ftY + 0.5, 5.9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...V.white);
  doc.text('M', pageW / 2 - 2, ftY + 2.6, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(...V.muted);
  doc.text(s('ACCÉDEZ AU DOSSIER COMPLET'), pageW / 2 + 28, ftY - 0.8, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.2);
  doc.setTextColor(...V.main);
  doc.text('www.mimmoza.fr', pageW / 2 + 28, ftY + 5.1, { align: 'center' });

  doc.setFillColor(133, 92, 255);
  doc.rect(0, pageH - 2.7, pageW, 2.7, 'F');

  st.p = 1;
  st.y = MT + HDR_H + 5;
}

async function buildCoverImageForBox(
  sourceDataUrl: string,
  boxW: number,
  boxH: number,
): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' | 'WEBP' }> {
  const img = await loadImageElement(sourceDataUrl);

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  if (!srcW || !srcH) {
    throw new Error('Invalid image dimensions for cover rendering');
  }

  const targetRatio = boxW / boxH;
  const srcRatio = srcW / srcH;

  let cropW = srcW;
  let cropH = srcH;
  let cropX = 0;
  let cropY = 0;

  if (srcRatio > targetRatio) {
    cropW = srcH * targetRatio;
    cropX = (srcW - cropW) / 2;
  } else if (srcRatio < targetRatio) {
    cropH = srcW / targetRatio;
    cropY = (srcH - cropH) / 2;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(boxW * 8));
  canvas.height = Math.max(1, Math.round(boxH * 8));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    cropX, cropY, cropW, cropH,
    0, 0, canvas.width, canvas.height,
  );

  const format = detectImageFormatFromDataUrl(sourceDataUrl);
  const mime =
    format === 'PNG' ? 'image/png' :
    format === 'WEBP' ? 'image/webp' :
    'image/jpeg';

  return {
    dataUrl: canvas.toDataURL(mime, 0.96),
    format,
  };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to load cover image'));
    img.src = src;
  });
}

function detectImageFormatFromDataUrl(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
  const raw = (m?.[1] || 'jpeg').toLowerCase();
  if (raw === 'png') return 'PNG';
  if (raw === 'webp') return 'WEBP';
  return 'JPEG';
}

function rgba(rgb: RGB, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function setOpacity(doc: any, opacity: number): void {
  doc.setGState?.(new doc.GState({ opacity }));
}

function drawFallbackArchitecturalPattern(
  doc: any,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.setDrawColor(224, 220, 245);
  doc.setLineWidth(0.3);

  const bx = x + w * 0.38;
  const by = y + 40;

  doc.rect(bx, by, 34, 120);
  doc.line(bx, by + 24, bx + 34, by + 24);
  doc.line(bx, by + 48, bx + 34, by + 48);
  doc.line(bx, by + 72, bx + 34, by + 72);
  doc.line(bx, by + 96, bx + 34, by + 96);
  doc.line(bx + 11, by, bx + 11, by + 120);
  doc.line(bx + 23, by, bx + 23, by + 120);

  doc.rect(bx + 22, by + 16, 40, 148);
  doc.line(bx + 22, by + 44, bx + 62, by + 44);
  doc.line(bx + 22, by + 72, bx + 62, by + 72);
  doc.line(bx + 22, by + 100, bx + 62, by + 100);
  doc.line(bx + 22, by + 128, bx + 62, by + 128);
  doc.line(bx + 35, by + 16, bx + 35, by + 164);
  doc.line(bx + 48, by + 16, bx + 48, by + 164);
}

function drawMimmozaCube(doc: any, x: number, y: number, size: number): void {
  const s = size;

  doc.setFillColor(122, 84, 255);
  doc.lines(
    [[s * 0.5, -s * 0.28], [s * 0.5, s * 0.28], [-s * 0.5, s * 0.28], [-s * 0.5, -s * 0.28]],
    x + s * 0.5, y, [1, 1], 'F', true,
  );

  doc.setFillColor(160, 124, 255);
  doc.lines(
    [[s * 0.5, s * 0.28], [0, s * 0.58], [-s * 0.5, -s * 0.28], [0, -s * 0.58]],
    x + s, y + s * 0.28, [1, 1], 'F', true,
  );

  doc.setFillColor(78, 52, 190);
  doc.lines(
    [[-s * 0.5, s * 0.28], [0, s * 0.58], [s * 0.5, -s * 0.28], [0, -s * 0.58]],
    x + s * 0.5, y + s * 0.28, [1, 1], 'F', true,
  );
}

function drawDocIcon(doc: any, cx: number, cy: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.25);
  doc.roundedRect(cx - 2.2, cy - 3.1, 4.4, 6.2, 0.5, 0.5, 'S');
  doc.line(cx - 1.2, cy - 1.2, cx + 1.2, cy - 1.2);
  doc.line(cx - 1.2, cy + 0.1, cx + 1.2, cy + 0.1);
  doc.line(cx - 1.2, cy + 1.4, cx + 1.2, cy + 1.4);
}

function drawTargetIcon(doc: any, cx: number, cy: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.25);
  doc.circle(cx, cy, 2.8);
  doc.circle(cx, cy, 1.6);
  doc.circle(cx, cy, 0.45, 'S');
}

function drawFolderIcon(doc: any, cx: number, cy: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.25);
  doc.line(cx - 3, cy - 1.5, cx - 0.6, cy - 1.5);
  doc.line(cx - 0.6, cy - 1.5, cx + 0.1, cy - 2.5);
  doc.line(cx + 0.1, cy - 2.5, cx + 3, cy - 2.5);
  doc.line(cx + 3, cy - 2.5, cx + 3, cy + 2.3);
  doc.line(cx + 3, cy + 2.3, cx - 3, cy + 2.3);
  doc.line(cx - 3, cy + 2.3, cx - 3, cy - 1.5);
}

function drawCalendarIcon(doc: any, cx: number, cy: number, color: RGB): void {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.3);
  doc.circle(cx, cy, 6.2);
  doc.roundedRect(cx - 2.4, cy - 1.8, 4.8, 4.2, 0.4, 0.4, 'S');
  doc.line(cx - 1.4, cy - 2.7, cx - 1.4, cy - 1.2);
  doc.line(cx + 1.4, cy - 2.7, cx + 1.4, cy - 1.2);
  doc.line(cx - 2.4, cy - 0.5, cx + 2.4, cy - 0.5);
}

// ============================================================================
// TABLE OF CONTENTS
// ============================================================================

function renderToc(st: St, tocPageNumber: number): void {
  const { doc, tocEntries, syn, audit } = st;
  doc.setPage(tocPageNumber);

  // 1. Background
  drawGradientV(doc, 0, 0, PW, PH, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.12);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 22, 32, 34, 'F');
  setOpacity(doc, 0.10);
  doc.setFillColor(...SP.crystal);
  doc.circle(20, PH - 28, 42, 'F');
  setOpacity(doc, 1);

  // 2. Header
  const topY = 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SP.deep);
  doc.text('MIMMOZA', ML, topY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text('|', ML + 25, topY);
  doc.text('Synthese Promoteur', ML + 32, topY);
  doc.text(fmtDate(new Date()), PW - MR, topY, { align: 'right' });

  // 3. Titre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(31);
  doc.setTextColor(...SP.deep);
  doc.text('Sommaire', ML, 43);

  // 4. Sous-titre
  const subtitle = syn.projet.commune
    ? s(`${syn.projet.programmeType || 'Projet'} - ${syn.projet.commune} (${syn.projet.codePostal || ''})`)
    : 'Navigation du dossier promoteur';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...C.slate2);
  doc.text(doc.splitTextToSize(subtitle, 125)[0], ML, 56);

  // 5. Badge statut
  const statusColor = DOC_STATUS_COLORS[audit.documentStatus];
  const pillW = 77;
  const pillH = 11;
  const pillX = PW - MR - pillW;
  const pillY = 46;

  doc.setFillColor(232, 247, 238);
  doc.roundedRect(pillX, pillY, pillW, pillH, 5.5, 5.5, 'F');
  doc.setFillColor(...statusColor);
  doc.circle(pillX + 6.5, pillY + 5.5, 1.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(...statusColor);
  doc.text('DOSSIER PRET COMITE', pillX + 12, pillY + 7.2);

  // 6. Card intro
  const introY = 75;
  const introH = 26;

  setOpacity(doc, 0.06);
  doc.setFillColor(40, 25, 80);
  doc.roundedRect(ML + 1.1, introY + 1.4, CW, introH, 5.5, 5.5, 'F');
  setOpacity(doc, 1);

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ML, introY, CW, introH, 5.5, 5.5, 'F');
  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.35);
  doc.roundedRect(ML, introY, CW, introH, 5.5, 5.5, 'S');

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, introY + 6.5, 13, 13, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...C.white);
  doc.text('M', ML + 13.5, introY + 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...SP.deep);
  doc.text("Dossier comite d'investissement", ML + 27, introY + 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  const introDesc =
    'Parcours de lecture structure : decision, donnees, projet, faisabilite, marche, finance et recommandation.';
  doc.text(doc.splitTextToSize(introDesc, CW - 36).slice(0, 2), ML + 27, introY + 19);

  // Mappings
  const shortTitles: Record<string, string> = {
    '01': 'Executive Summary',
    '02': 'Qualite donnees',
    '03': 'Projet',
    '04': 'Faisabilite PLU',
    '05': 'Marche',
    '06': 'Financier',
    '07': 'Financement',
    '08': 'Risques',
    '09': 'Sensibilite',
    '10': 'Hypotheses',
    '11': 'Synthese',
    '12': 'Sources',
    '13': 'Recommandation',
  };

  const shortDescs: Record<string, string> = {
    '01': 'Decision et KPI cles',
    '02': 'Fiabilite et alertes',
    '03': 'Adresse et surfaces',
    '04': 'Contraintes PLU',
    '05': 'DVF et prix',
    '06': 'Couts et marge',
    '07': 'Credit et VEFA',
    '08': 'Points critiques',
    '09': 'Scenarios',
    '10': 'Bases de calcul',
    '11': 'Analyse globale',
    '12': 'Origine donnees',
    '13': 'Decision finale',
  };

  // 7. Grille
  const gridY = 113;
  const cols = 3;
  const gapX = 5;
  const gapY = 5;
  const cardW = (CW - gapX * (cols - 1)) / cols;
  const cardH = 30;

  tocEntries.forEach(({ num, page }, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = ML + col * (cardW + gapX);
    const y = gridY + row * (cardH + gapY);

    // Shadow
    setOpacity(doc, 0.06);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, cardW, cardH, 5, 5, 'F');
    setOpacity(doc, 1);

    // Card bg + border
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, cardH, 5, 5, 'F');
    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 5, 5, 'S');

    // Numéro — carré lavande haut gauche
    doc.setFillColor(...SP.crystal);
    doc.roundedRect(x + 5, y + 5, 13, 13, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.4);
    doc.setTextColor(...SP.deep);
    doc.text(num, x + 11.5, y + 14, { align: 'center' });

    // Titre
    const titleX = x + 23;
    const titleW = cardW - 28;
    const titleY = y + 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);
    const titleLines = doc.splitTextToSize(shortTitles[num] ?? num, titleW);
    doc.text(titleLines.slice(0, 2), titleX, titleY);

    // Description
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.slate3);
    const descLines = doc.splitTextToSize(shortDescs[num] ?? '', cardW - 28);
    doc.text(descLines.slice(0, 2), titleX, y + 22);

    // Numéro de page — texte simple, bas droite
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...SP.main);
    doc.text(`p.${page}`, x + cardW - 6, y + cardH - 5, { align: 'right' });
  });

  // Footer
  const fy = PH - FTR_H;
  doc.setDrawColor(...SP.main);
  doc.setLineWidth(0.35);
  doc.line(ML, fy, PW - MR, fy);

  doc.setFontSize(F.xs);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate3);
  doc.text(s('CONFIDENTIEL - Usage interne exclusif'), ML, fy + 5);
  drawDocRef(doc, PW / 2, fy + 5, audit.documentId, 'center');
  doc.text(fmtDate(new Date()), PW - MR, fy + 5, { align: 'right' });
}

// ============================================================================
// 01 EXECUTIVE SUMMARY
// ============================================================================

function addExecSummary(st: St): void {
  newPage(st);
  tocRegister(st, '01', 'Executive Summary');
 
  const { doc, syn, audit } = st;
  const es = syn.executiveSummary;
 
  const hasFin =
    syn.financier.chiffreAffairesTotal > 0 &&
    syn.financier.coutRevientTotal > 0;
 
  const safePointsForts = filterPointsForts(es.pointsForts, audit.documentStatus, st.mc);
  const displayPF = safePointsForts.length > 0
    ? safePointsForts.slice(0, 4)
    : [INCOMPLETE_NO_POINTS_FORTS];
 
  const displayPV = es.pointsVigilance.slice(0, 2);
 
  // FIX: réduit de +12 à +4 pour remonter tout le contenu
  const pageTop = HDR_H + 12;
  const footerY = PH - FTR_H;
 
  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);
 
  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);
 
  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);
 
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');
 
    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };
 
  const metricCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    tag: string,
    label: string,
    value: string,
    sub?: string,
    color: RGB = SP.main,
  ): void => {
    shadowCard(x, y, w, h, 5);
 
    doc.setFillColor(...SP.crystal);
    doc.circle(x + 12, y + 13, 6, 'F');
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    doc.setTextColor(...SP.main);
    doc.text(tag, x + 12, y + 15, { align: 'center' });
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + 23, y + 9);
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(...color);
    doc.text(s(value), x + 23, y + 19);
 
    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...C.slate3);
      doc.text(s(sub), x + 23, y + 25);
    }
  };
 
  const scoreBar = (
    x: number,
    y: number,
    w: number,
    label: string,
    score: number,
    tag: string,
  ): void => {
    const barX = x + 23;
    const barY = y + 8.8;
    const barW = w - 43;
    const filled = Math.max(0, Math.min(100, score)) / 100 * barW;
 
    doc.setFillColor(...SP.crystal);
    doc.roundedRect(x, y + 1, 12, 12, 3, 3, 'F');
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.7);
    doc.setTextColor(...SP.main);
    doc.text(tag, x + 6, y + 8.7, { align: 'center' });
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    doc.setTextColor(...SP.deep);
    doc.text(s(label), barX, y + 5.4);
 
    doc.setFillColor(234, 232, 244);
    doc.roundedRect(barX, barY, barW, 3.2, 1.6, 1.6, 'F');
 
    if (filled > 0) {
      drawGradientH(doc, barX, barY, filled, 3.2, SP.light, SP.main, 24);
    }
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(...SP.main);
    doc.text(String(score), x + w - 7, y + 9.2, { align: 'right' });
 
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.slate3);
    doc.text('/100', x + w - 7, y + 14.2, { align: 'right' });
  };
 
  const insightCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    items: string[],
    color: RGB,
    bg: RGB,
    tag: string,
  ): void => {
    doc.setFillColor(...bg);
    doc.roundedRect(x, y, w, h, 5, 5, 'F');
 
    doc.setDrawColor(...color);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, w, h, 5, 5, 'S');
 
    doc.setFillColor(...color);
    doc.circle(x + 9, y + 9, 4.5, 'F');
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...C.white);
    doc.text(tag, x + 9, y + 11, { align: 'center' });
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(...color);
    doc.text(s(title).toUpperCase(), x + 17, y + 10.7);
 
    let ty = y + 20;
    items.forEach((it) => {
      if (ty > y + h - 6) return;
 
      doc.setFillColor(...color);
      doc.circle(x + 8, ty - 1.6, 1, 'F');
 
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.7);
      doc.setTextColor(...SP.deep);
 
      const lines = doc.splitTextToSize(s(it), w - 20).slice(0, 2);
      doc.text(lines, x + 13, ty);
      ty += lines.length * 4 + 1.6;
    });
  };
 
  // Header titre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('01', ML, pageTop + 5);
 
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(...SP.deep);
  doc.text('EXECUTIVE SUMMARY', ML + 13, pageTop + 8);
 
  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');
 
  // Bandeau recommandation — FIX: réduit de +25 à +18
  const recY = pageTop + 18;
  const recH = 27;
  const recColorMain = recColor(audit.effectiveRecommendation);
  const recBg: RGB =
    audit.effectiveRecommendation === 'NO_GO' ? [254, 242, 242] :
    audit.effectiveRecommendation === 'GO_CONDITION' ? [255, 247, 237] :
    [240, 253, 244];
 
  doc.setFillColor(...recBg);
  doc.roundedRect(ML, recY, CW, recH, 5, 5, 'F');
 
  doc.setDrawColor(...recColorMain);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, recY, CW, recH, 5, 5, 'S');
 
  doc.setFillColor(...recColorMain);
  doc.circle(ML + 13, recY + 13.5, 6, 'F');
 
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.white);
  doc.text('OK', ML + 13, recY + 16, { align: 'center' });
 
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...recColorMain);
  doc.text('RECOMMANDATION', ML + 27, recY + 10);
 
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SP.deep);
  doc.text(s(REC_LABELS[audit.effectiveRecommendation]).toUpperCase(), ML + 27, recY + 19);
 
  const motif = generateExecMotif(audit, syn, st.mc);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(...SP.deep);
  doc.text(doc.splitTextToSize(s(motif), 54).slice(0, 2), PW - MR - 58, recY + 12);
 
  // KPI grid — FIX: gap réduit de +8 à +5
  const kpiY = recY + recH + 5;
  const kpiGap = 6;
  const kpiW = (CW - kpiGap * 2) / 3;
  const kpiH = 27;
 
  const metrics = [
    {
      tag: 'MN',
      label: 'Marge nette',
      value: hasFin ? pct(es.margeNette) : 'N/A',
      sub: hasFin ? eur(es.resultatNet) : undefined,
      color: !hasFin ? C.slate3 : es.margeNette < 8 ? C.red : C.green,
    },
    {
      tag: 'CA',
      label: 'CA total HT',
      value: es.caTotal > 0 ? eurM(es.caTotal) : 'N/A',
      color: SP.main,
    },
    {
      tag: 'TRN',
      label: 'TRN',
      value: hasFin ? pct(es.trnRendement) : 'N/A',
      color: !hasFin ? C.slate3 : es.trnRendement < 8 ? C.red : C.green,
    },
    {
      tag: 'SG',
      label: 'Score global',
      value: `${es.scores.global}/100`,
      color: SP.main,
    },
    {
      tag: 'LG',
      label: 'Logements',
      value: syn.projet.nbLogements > 0 ? String(syn.projet.nbLogements) : 'N/A',
      color: SP.main,
    },
    {
      tag: 'CP',
      label: 'Completude',
      value: `${audit.completenessScore}%`,
      color: audit.completenessScore >= 75 ? C.green : audit.completenessScore >= 50 ? C.amber : C.red,
    },
  ];
 
  metrics.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = ML + col * (kpiW + kpiGap);
    // FIX: gap inter-rangée réduit de +5 à +3
    const y = kpiY + row * (kpiH + 3);
    metricCard(x, y, kpiW, kpiH, m.tag, m.label, m.value, m.sub, m.color);
  });
 
  // Scores + insights — FIX: gap réduit de +12 à +9
  const lowerY = kpiY + kpiH * 2 + 5;
  const leftW = CW * 0.57;
  const rightW = CW - leftW - 7;
  const scoresH = 116;
 
  shadowCard(ML, lowerY, leftW, scoresH, 5);
 
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('SCORES PAR DIMENSION', ML + 7, lowerY + 12);
 
  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');
 
  const scoreX = ML + 7;
  let scoreY = lowerY + 22;
 
  scoreBar(scoreX, scoreY, leftW - 14, 'Foncier', es.scores.foncier, 'FO');
  scoreY += 14.5;
  scoreBar(scoreX, scoreY, leftW - 14, 'Technique / PLU', es.scores.technique, 'PL');
  scoreY += 14.5;
  scoreBar(scoreX, scoreY, leftW - 14, 'Marche', es.scores.marche, 'MA');
  scoreY += 14.5;
  scoreBar(scoreX, scoreY, leftW - 14, 'Financier', es.scores.financier, 'FI');
  scoreY += 14.5;
  scoreBar(scoreX, scoreY, leftW - 14, 'Risque inverse', es.scores.risque, 'RI');
 
  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML + 7, lowerY + scoresH - 14, leftW - 14, 9, 3, 3, 'F');
 
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(
      'Scores calcules selon les donnees disponibles et le niveau de confiance associe.',
      leftW - 22,
    ),
    ML + 12,
    lowerY + scoresH - 8,
  );
 
  const rightX = ML + leftW + 7;
 
  insightCard(
    rightX,
    lowerY,
    rightW,
    68,
    'Points forts',
    displayPF.slice(0, 4),
    C.green,
    [242, 253, 247],
    'OK',
  );
 
  insightCard(
  rightX,
  lowerY + 70,
  rightW,
  38,
  'Points de vigilance',
  displayPV.length > 0 ? displayPV.slice(0, 1) : ['Aucun point majeur identifie'],
  C.orange ?? C.amber,
  [255, 247, 237],
  '!',
);
 
  if (es.killSwitchesActifs.length > 0) {
    const ksH = 24;
    const ksY = lowerY + 100;
 
    doc.setFillColor(...C.redBg);
    doc.roundedRect(ML, ksY, CW, ksH, 5, 5, 'F');
 
    doc.setDrawColor(...C.red);
    doc.setLineWidth(0.25);
    doc.roundedRect(ML, ksY, CW, ksH, 5, 5, 'S');
 
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.red);
    doc.text('POINTS BLOQUANTS', ML + 7, ksY + 7);
 
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...SP.deep);
    doc.text(
      doc.splitTextToSize(s(es.killSwitchesActifs.slice(0, 2).join(' - ')), CW - 14).slice(0, 2),
      ML + 7,
      ksY + 17,
    );
  }
 
  pageFooter(st);
}
 
// ============================================================================
// 02 DATA QUALITY & CONFIDENCE
// ============================================================================

function addDataQuality(st: St): void {
  newPage(st);
  tocRegister(st, '02', s('Qualité des données & niveau de confiance'));

  const { doc, syn, audit } = st;

  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const miniMetric = (
    x: number,
    y: number,
    w: number,
    h: number,
    tag: string,
    label: string,
    value: string,
    color: RGB,
  ): void => {
    shadowCard(x, y, w, h, 5);

    doc.setFillColor(...SP.crystal);
    doc.circle(x + 12, y + 13, 6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...SP.main);
    doc.text(tag, x + 12, y + 15, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + 23, y + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.2);
    doc.setTextColor(...color);
    doc.text(s(value), x + 23, y + 20);
  };

  const statusColor = DOC_STATUS_COLORS[audit.documentStatus];
  const qualityColor: RGB =
    syn.metadata.dataQualite === 'HAUTE' ? C.green :
    syn.metadata.dataQualite === 'MOYENNE' ? C.amber :
    C.red;

  const completenessColor: RGB =
    audit.completenessScore >= 75 ? C.green :
    audit.completenessScore >= 50 ? C.amber :
    C.red;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('02', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...SP.deep);
  doc.text('QUALITE DES DONNEES', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Status banner
  const bannerY = pageTop + 18;
  const bannerH = 26;

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...statusColor);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...statusColor);
  doc.circle(ML + 13, bannerY + 13, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('OK', ML + 13, bannerY + 15.2, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...statusColor);
  doc.text('STATUT DU DOSSIER', ML + 27, bannerY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.2);
  doc.setTextColor(...SP.deep);
  doc.text(s(DOC_STATUS_LABELS[audit.documentStatus]).toUpperCase(), ML + 27, bannerY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      'Cette page indique si les donnees disponibles sont suffisantes pour exploiter le dossier.',
      64,
    ),
    PW - MR - 68,
    bannerY + 11,
  );

  // KPI row
  const kpiY = bannerY + bannerH + 7;
  const gap = 6;
  const cardW = (CW - gap * 2) / 3;
  const cardH = 29;

  miniMetric(
    ML,
    kpiY,
    cardW,
    cardH,
    'CP',
    'Completude',
    `${audit.completenessScore}%`,
    completenessColor,
  );

  miniMetric(
    ML + cardW + gap,
    kpiY,
    cardW,
    cardH,
    'QL',
    'Qualite donnees',
    s(syn.metadata.dataQualite),
    qualityColor,
  );

  miniMetric(
    ML + (cardW + gap) * 2,
    kpiY,
    cardW,
    cardH,
    'US',
    'Usage',
    s(
      audit.documentStatus === 'committee_ready'
        ? 'Comite'
        : audit.documentStatus === 'provisional'
          ? 'Pre-etude'
          : 'Brouillon',
    ),
    statusColor,
  );

  // Coverage section
  const lowerY = kpiY + cardH + 12;
  const leftW = CW * 0.54;
  const rightW = CW - leftW - 7;

  shadowCard(ML, lowerY, leftW, 92, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('COUVERTURE PAR CATEGORIE', ML + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const cats = [
    { tag: 'PR', label: 'Donnees projet', ok: audit.flags.hasCriticalProjectData },
    { tag: 'FI', label: 'Donnees financieres', ok: audit.flags.hasCriticalFinancialData },
    { tag: 'MA', label: 'Donnees marche', ok: audit.flags.hasCriticalMarketData },
    { tag: 'TE', label: 'Donnees techniques', ok: audit.flags.hasCriticalTechnicalData },
  ];

  let cy = lowerY + 27;

  cats.forEach((cat) => {
    const c: RGB = cat.ok ? C.green : C.red;
    const bg: RGB = cat.ok ? [242, 253, 247] : [254, 242, 242];

    doc.setFillColor(...bg);
    doc.roundedRect(ML + 7, cy, leftW - 14, 13.5, 4, 4, 'F');

    doc.setFillColor(...c);
    doc.circle(ML + 15, cy + 6.7, 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.white);
    doc.text(cat.tag, ML + 15, cy + 8.6, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(...SP.deep);
    doc.text(s(cat.label), ML + 24, cy + 5.7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...c);
    doc.text(cat.ok ? 'Suffisante' : 'Insuffisante', ML + 24, cy + 10.5);

    cy += 15.5;
  });

  // Right card: missing / warnings
  const rightX = ML + leftW + 7;

  const missing = audit.criticalMissingFields.slice(0, 5);
  const warnings = audit.warnings.slice(0, 4);

  shadowCard(rightX, lowerY, rightW, 44, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.red);
  doc.text('CHAMPS MANQUANTS', rightX + 7, lowerY + 11);

  doc.setFillColor(...C.red);
  doc.roundedRect(rightX + 7, lowerY + 14, 14, 1, 0.5, 0.5, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.7);
  doc.setTextColor(...SP.deep);

  if (missing.length > 0) {
    doc.text(
      doc.splitTextToSize(missing.join(', '), rightW - 14).slice(0, 4),
      rightX + 7,
      lowerY + 23,
    );
  } else {
    doc.text('Aucun champ critique manquant.', rightX + 7, lowerY + 23);
  }

  const warnY = lowerY + 50;
  shadowCard(rightX, warnY, rightW, 42, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.amber);
  doc.text('AVERTISSEMENTS', rightX + 7, warnY + 11);

  doc.setFillColor(...C.amber);
  doc.roundedRect(rightX + 7, warnY + 14, 14, 1, 0.5, 0.5, 'F');

  let wy = warnY + 23;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.7);
  doc.setTextColor(...SP.deep);

  if (warnings.length > 0) {
    warnings.forEach((w) => {
      if (wy > warnY + 36) return;
      doc.setFillColor(...C.amber);
      doc.circle(rightX + 8.5, wy - 1.4, 1, 'F');
      const lines = doc.splitTextToSize(s(w), rightW - 17).slice(0, 2);
      doc.text(lines, rightX + 13, wy);
      wy += lines.length * 4 + 2;
    });
  } else {
    doc.text('Aucun avertissement majeur.', rightX + 7, wy);
  }

  // Bottom interpretation card
  const noteY = lowerY + 102;
  const noteH = 30;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE MIMMOZA', ML + 7, noteY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.deep);

  const interpretation =
    audit.documentStatus === 'committee_ready'
      ? 'Le dossier contient les donnees critiques necessaires pour une lecture comite. Les alertes restantes doivent etre considerees comme des points de vigilance.'
      : audit.documentStatus === 'provisional'
        ? 'Le dossier est exploitable en pre-etude, mais certaines donnees restent a confirmer avant presentation decisionnelle.'
        : 'Le dossier est incomplet. Les conclusions doivent etre considerees comme indicatives tant que les champs critiques ne sont pas renseignes.';

  doc.text(
    doc.splitTextToSize(interpretation, CW - 14),
    ML + 7,
    noteY + 18,
  );

  pageFooter(st);
}

// ============================================================================
// 03 PROJET
// ============================================================================

function addProjet(st: St): void {
  newPage(st);
  tocRegister(st, '03', s('Présentation du projet'));

  const { doc, syn } = st;
  const p = syn.projet;

  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const smallInfo = (
    x: number,
    y: number,
    w: number,
    h: number,
    tag: string,
    label: string,
    value: string,
    color: RGB = SP.main,
  ): void => {
    shadowCard(x, y, w, h, 5);

    doc.setFillColor(...SP.crystal);
    doc.circle(x + 11.5, y + 12.5, 5.8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...SP.main);
    doc.text(tag, x + 11.5, y + 14.6, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + 22.5, y + 8.7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.4);
    doc.setTextColor(...color);
    doc.text(s(value), x + 22.5, y + 19);
  };

  const detailCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    rows: Array<{ label: string; value: string }>,
    tag: string,
  ): void => {
    shadowCard(x, y, w, h, 5);

    doc.setFillColor(...SP.crystal);
    doc.roundedRect(x + 6, y + 7, 13, 13, 3, 3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...SP.main);
    doc.text(tag, x + 12.5, y + 15.4, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SP.deep);
    doc.text(s(title).toUpperCase(), x + 24, y + 12);

    doc.setFillColor(...SP.main);
    doc.roundedRect(x + 24, y + 15, 14, 1, 0.5, 0.5, 'F');

    let ry = y + 27;
    rows.forEach((row) => {
      if (ry > y + h - 7) return;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(...C.slate3);
      doc.text(s(row.label).toUpperCase(), x + 7, ry);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.3);
      doc.setTextColor(...SP.deep);
      const valueLines = doc.splitTextToSize(s(row.value), w - 56).slice(0, 2);
      doc.text(valueLines, x + 48, ry);

      ry += Math.max(9, valueLines.length * 4.4 + 4);
    });
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('03', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('PRESENTATION DU PROJET', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Hero identity card
  const heroY = pageTop + 20;
  const heroH = 43;

  shadowCard(ML, heroY, CW, heroH, 6);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 8, heroY + 9, 20, 20, 5, 5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...C.white);
  doc.text('PR', ML + 18, heroY + 22.2, { align: 'center' });

  const title = p.programmeType || 'Programme residentiel';
  const loc = p.commune
    ? `${p.commune}${p.codePostal ? ` (${p.codePostal})` : ''}`
    : 'Localisation non renseignee';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14.5);
  doc.setTextColor(...SP.deep);
  doc.text(doc.splitTextToSize(s(title), 108).slice(0, 2), ML + 36, heroY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.4);
  doc.setTextColor(...C.slate2);
  doc.text(s(loc), ML + 36, heroY + 27);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...C.slate3);
  const address = p.adresse || 'Adresse non renseignee';
  doc.text(doc.splitTextToSize(s(address), 105).slice(0, 2), ML + 36, heroY + 35);

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(PW - MR - 45, heroY + 10, 37, 21, 5, 5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(...SP.main);
  doc.text('DATE ETUDE', PW - MR - 26.5, heroY + 18, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...SP.deep);
  doc.text(fmtDate(p.dateEtude), PW - MR - 26.5, heroY + 26, { align: 'center' });

  // KPI cards
  const kpiY = heroY + heroH + 9;
  const gap = 6;
  const kpiW = (CW - gap * 2) / 3;
  const kpiH = 28;

  smallInfo(
    ML,
    kpiY,
    kpiW,
    kpiH,
    'ST',
    'Surface terrain',
    m2v(p.surfaceTerrain),
    SP.main,
  );

  smallInfo(
    ML + kpiW + gap,
    kpiY,
    kpiW,
    kpiH,
    'SDP',
    'Surface plancher',
    m2v(p.surfacePlancher),
    SP.main,
  );

  smallInfo(
    ML + (kpiW + gap) * 2,
    kpiY,
    kpiW,
    kpiH,
    'LG',
    'Logements',
    p.nbLogements > 0 ? String(p.nbLogements) : 'N/A',
    p.nbLogements > 0 ? C.green : C.amber,
  );

  // Main cards
  const sectionY = kpiY + kpiH + 12;
  const leftW = (CW - 7) / 2;
  const rightW = leftW;

  detailCard(
    ML,
    sectionY,
    leftW,
    76,
    'Localisation',
    [
      { label: 'Adresse', value: p.adresse || 'Non renseignee' },
      { label: 'Commune', value: p.commune ? `${p.commune}${p.codePostal ? ` (${p.codePostal})` : ''}` : 'Non renseignee' },
      { label: 'Departement', value: p.departement || 'N/A' },
    ],
    'LOC',
  );

  detailCard(
    ML + leftW + 7,
    sectionY,
    rightW,
    76,
    'Programme',
    [
      { label: 'Type', value: p.programmeType || 'Non renseigne' },
      { label: 'Logements', value: p.nbLogements > 0 ? `${p.nbLogements}` : 'N/A' },
      { label: 'Typologies', value: Object.keys(p.typologieMix ?? {}).length > 0 ? Object.entries(p.typologieMix).map(([t, n]) => `${t}: ${n}`).join(', ') : 'Non renseigne' },
    ],
    'PGM',
  );

  // Bottom card
  const bottomY = sectionY + 86;
  const bottomH = 52;

  shadowCard(ML, bottomY, CW, bottomH, 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('SYNTHESE PROJET', ML + 8, bottomY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 8, bottomY + 15, 15, 1, 0.5, 0.5, 'F');

  const summaryParts = [
    p.programmeType ? `Programme : ${p.programmeType}.` : 'Programme non renseigne.',
    p.commune ? `Localisation : ${p.commune}${p.codePostal ? ` (${p.codePostal})` : ''}.` : 'Localisation non renseignee.',
    p.surfaceTerrain ? `Terrain : ${m2v(p.surfaceTerrain)}.` : 'Surface terrain non renseignee.',
    p.surfacePlancher ? `Surface plancher : ${m2v(p.surfacePlancher)}.` : 'Surface plancher non renseignee.',
    p.nbLogements > 0 ? `Logements : ${p.nbLogements}.` : 'Nombre de logements non renseigne.',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(s(summaryParts.join(' ')), CW - 16),
    ML + 8,
    bottomY + 26,
  );

  // Data quality note
  const noteY = bottomY + bottomH + 9;
  const noteH = 24;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...SP.deep);
  doc.text('NOTE', ML + 7, noteY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(
      'Cette page reprend uniquement les informations disponibles dans le dossier projet. Les valeurs non renseignees restent affichees en N/A ou non renseigne.',
      CW - 22,
    ),
    ML + 7,
    noteY + 16,
  );

  pageFooter(st);
}
// ============================================================================
// 03b VISUELS DU PROJET — Carte + Implantation 2D + Massing 3D + Façade IA
// ============================================================================

function addVisuels(st: St): void {
  const images = [
    { url: st.carteScreenshot,        label: 'Carte cadastrale',        tag: 'MAP' },
    { url: st.implantationScreenshot, label: 'Implantation 2D',         tag: '2D' },
    { url: st.massing3DScreenshot,    label: 'Massing 3D - relief',     tag: '3D' },
    { url: st.facadeRenderUrl,        label: 'Perspective facade IA',   tag: 'IA' },
    { url: st.renduTravauxSynthese?.generatedImageUrl, label: 'Rendu travaux IA', tag: 'RT' },
  ].filter((img): img is { url: string; label: string; tag: string } => !!img.url);

  if (images.length === 0) return;

  newPage(st);

  const { doc } = st;
  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('03B', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('VISUELS DU PROJET', ML + 16, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Intro
  const introY = pageTop + 20;
  const introH = 24;

  shadowCard(ML, introY, CW, introH, 6);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, introY + 6, 13, 13, 3, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.white);
  doc.text('IMG', ML + 13.5, introY + 14.8, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...SP.deep);
  doc.text('Captures integrees au dossier', ML + 27, introY + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      'Ces visuels documentent la parcelle, l implantation, le volume 3D et la perspective facade generee par Mimmoza.',
      CW - 36,
    ),
    ML + 27,
    introY + 16,
  );

  // Image grid
  const gridY = introY + introH + 10;
  const cols = 2;
  const gap = 7;
  const cardW = (CW - gap) / cols;
  const cardH = 78;
  const labelH = 15;
  const imgPad = 4;
  const imgW = cardW - imgPad * 2;
  const imgH = cardH - labelH - imgPad * 2;

  images.forEach((img, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * (cardW + gap);
    const y = gridY + row * (cardH + gap);

    shadowCard(x, y, cardW, cardH, 6);

    // Label area
    doc.setFillColor(...SP.crystal);
    doc.roundedRect(x + imgPad, y + imgPad, cardW - imgPad * 2, labelH - 2, 4, 4, 'F');

    doc.setFillColor(...SP.main);
    doc.circle(x + 11, y + 10.3, 4.3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.white);
    doc.text(img.tag, x + 11, y + 12.3, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(...SP.deep);
    doc.text(s(img.label).toUpperCase(), x + 19, y + 11.6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.green);
    doc.text('Capture', x + cardW - 8, y + 11.6, { align: 'right' });

    // Image area
    const ix = x + imgPad;
    const iy = y + labelH + imgPad - 1;
    const iw = imgW;
    const ih = imgH;

    doc.setFillColor(248, 247, 252);
    doc.roundedRect(ix, iy, iw, ih, 4, 4, 'F');

    try {
      const formatMatch = img.url.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
      const detectedFormat = formatMatch
        ? (formatMatch[1].toUpperCase() === 'JPG' ? 'JPEG' : formatMatch[1].toUpperCase())
        : 'JPEG';

      doc.addImage(img.url, detectedFormat, ix, iy, iw, ih);
    } catch (e) {
      console.warn(`[exportPromoteurPdf] addImage echoue pour "${img.label}":`, e);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...C.slate3);
      doc.text('Image non disponible', ix + iw / 2, iy + ih / 2, { align: 'center' });
    }

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.25);
    doc.roundedRect(ix, iy, iw, ih, 4, 4, 'S');
  });

  // Footer note
  const noteY = gridY + Math.ceil(images.length / 2) * (cardH + gap) + 3;
  const noteH = 20;

  if (noteY + noteH < PH - FTR_H - 4) {
    doc.setFillColor(...SP.crystal);
    doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.3);
    doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...SP.deep);
    doc.text('NOTE', ML + 7, noteY + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...SP.deep);
    doc.text(
      doc.splitTextToSize(
        'Les captures sont integrees a titre documentaire. Les perspectives IA, dont facade et rendu travaux, sont des generations Mimmoza non contractuelles.',
        CW - 20,
      ),
      ML + 7,
      noteY + 15,
    );
  }

  pageFooter(st);
}

// ============================================================================
// 04 TECHNIQUE
// ============================================================================

function addTechnique(st: St): void {
  newPage(st);
  tocRegister(st, '04', s('Faisabilité technique & PLU'));

  const { doc, syn, audit } = st;
  const t = syn.technique;

  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const statusLabel = (v: string): string =>
    v === 'BLOQUANT' ? 'Bloquant' :
    v === 'A_VERIFIER' ? 'A verifier' :
    v === 'CONFORME' ? 'Conforme' :
    'N/D';

  const statusColor = (v: string): RGB =>
    v === 'BLOQUANT' ? C.red :
    v === 'A_VERIFIER' ? C.amber :
    v === 'CONFORME' ? C.green :
    C.slate3;

  const effectiveFais = getEffectiveFaisabilite(t.faisabiliteTechnique, audit.documentStatus, st.mc);
  const faisColor: RGB =
    effectiveFais === 'CONFIRME' ? C.green :
    effectiveFais === 'IMPOSSIBLE' ? C.red :
    C.amber;

  const faisText =
    effectiveFais === 'CONFIRME' ? 'FAISABILITE CONFIRMEE' :
    effectiveFais === 'IMPOSSIBLE' ? 'FAISABILITE IMPOSSIBLE' :
    'FAISABILITE SOUS RESERVE';

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('04', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...SP.deep);
  doc.text('FAISABILITE TECHNIQUE & PLU', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Faisability banner
  const bannerY = pageTop + 18;
  const bannerH = 27;

  doc.setFillColor(
    effectiveFais === 'CONFIRME' ? 242 : effectiveFais === 'IMPOSSIBLE' ? 254 : 255,
    effectiveFais === 'CONFIRME' ? 253 : effectiveFais === 'IMPOSSIBLE' ? 242 : 247,
    effectiveFais === 'CONFIRME' ? 247 : effectiveFais === 'IMPOSSIBLE' ? 242 : 237,
  );
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...faisColor);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...faisColor);
  doc.circle(ML + 13, bannerY + 13.5, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('PLU', ML + 13, bannerY + 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...faisColor);
  doc.text('STATUT TECHNIQUE', ML + 27, bannerY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SP.deep);
  doc.text(faisText, ML + 27, bannerY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      st.mc.hasZonePlu
        ? 'Lecture des contraintes reglementaires disponibles dans le dossier PLU.'
        : 'Zone PLU non renseignee : faisabilite non confirmable.',
      64,
    ),
    PW - MR - 68,
    bannerY + 11,
  );

  // KPI cards
  const kpiY = bannerY + bannerH + 8;
  const gap = 6;
  const cardW = (CW - gap * 2) / 3;
  const cardH = 29;

  const miniMetric = (
    x: number,
    y: number,
    tag: string,
    label: string,
    value: string,
    color: RGB = SP.main,
  ): void => {
    shadowCard(x, y, cardW, cardH, 5);

    doc.setFillColor(...SP.crystal);
    doc.circle(x + 12, y + 13, 6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...SP.main);
    doc.text(tag, x + 12, y + 15, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + 23, y + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(...color);
    doc.text(s(value), x + 23, y + 20);
  };

  miniMetric(
    ML,
    kpiY,
    'Z',
    'Zone PLU',
    t.zonePlu || 'N/A',
    t.zonePlu ? SP.main : C.amber,
  );

  miniMetric(
    ML + cardW + gap,
    kpiY,
    'H',
    'Hauteur',
    t.hauteurMax != null ? `${t.hauteurMax} m` : 'N/A',
    t.hauteurMax != null ? SP.main : C.amber,
  );

  miniMetric(
    ML + (cardW + gap) * 2,
    kpiY,
    'PT',
    'Pleine terre',
    t.pleineTerre != null ? `${t.pleineTerre}%` : 'N/A',
    t.pleineTerre != null ? SP.main : C.amber,
  );

  // PLU parameters card
  const lowerY = kpiY + cardH + 12;
  const leftW = CW * 0.48;
  const rightW = CW - leftW - 7;

  shadowCard(ML, lowerY, leftW, 116, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('PARAMETRES PLU', ML + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const rows = [
    { l: 'Zone PLU', r: t.zonePlu || 'N/A', p: t.zonePlu || 'N/A', st: t.zonePlu ? 'CONFORME' : 'N/D' },
    { l: 'CUB / CES', r: t.cub != null ? String(t.cub) : 'N/A', p: 'N/A', st: 'N/D' },
    {
      l: 'Hauteur max',
      r: t.hauteurMax != null ? `${t.hauteurMax} m` : 'N/A',
      p: t.hauteurProjet != null ? `${t.hauteurProjet} m` : 'N/A',
      st: t.hauteurProjet && t.hauteurMax && t.hauteurProjet <= t.hauteurMax ? 'CONFORME' : 'A_VERIFIER',
    },
    { l: 'Recul voirie', r: t.reculs.voirie != null ? `${t.reculs.voirie} m` : 'N/A', p: 'N/A', st: 'N/D' },
    { l: 'Niveaux', r: 'N/A', p: t.nbNiveaux != null ? `R+${t.nbNiveaux - 1}` : 'N/A', st: 'N/D' },
  ];

  let ry = lowerY + 27;
  rows.forEach((row) => {
    doc.setFillColor(248, 247, 252);
    doc.roundedRect(ML + 7, ry, leftW - 14, 14, 4, 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...SP.deep);
    doc.text(s(row.l), ML + 12, ry + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...C.slate3);
    doc.text(`Regle: ${s(row.r)}`, ML + 12, ry + 10.3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...statusColor(row.st));
    doc.text(statusLabel(row.st), ML + leftW - 12, ry + 8.5, { align: 'right' });

    ry += 16.5;
  });

  // Constraints card
  const rightX = ML + leftW + 7;
  shadowCard(rightX, lowerY, rightW, 116, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('CONTRAINTES PLU', rightX + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(rightX + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const contraintes = t.contraintes.slice(0, 4);

  let cy = lowerY + 28;

  if (contraintes.length > 0) {
    contraintes.forEach((c) => {
      if (cy > lowerY + 102) return;

      const col = statusColor(c.statut);
      const bg: RGB =
        c.statut === 'BLOQUANT' ? [254, 242, 242] :
        c.statut === 'A_VERIFIER' ? [255, 247, 237] :
        [242, 253, 247];

      doc.setFillColor(...bg);
      doc.roundedRect(rightX + 7, cy, rightW - 14, 19, 4, 4, 'F');

      doc.setFillColor(...col);
      doc.circle(rightX + 14, cy + 9.5, 3.8, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.2);
      doc.setTextColor(...C.white);
      doc.text(c.statut === 'A_VERIFIER' ? '?' : c.statut === 'BLOQUANT' ? '!' : 'OK', rightX + 14, cy + 11.2, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(...SP.deep);
      doc.text(doc.splitTextToSize(s(c.libelle), rightW - 38).slice(0, 1), rightX + 22, cy + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...C.slate3);
      doc.text(
        doc.splitTextToSize(
          `Projet: ${s(c.valeurProjet ?? 'N/A')} | PLU: ${s(c.valeurPlu ?? 'N/A')}`,
          rightW - 38,
        ).slice(0, 1),
        rightX + 22,
        cy + 13.5,
      );

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(...col);
      doc.text(statusLabel(c.statut), rightX + rightW - 9, cy + 17, { align: 'right' });

      cy += 22;
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.slate3);
    doc.text('Aucune contrainte PLU detaillee disponible.', rightX + 7, cy);
  }

    // Conclusion — remontee pour eviter chevauchement avec le footer
  const conclusion = generateTechniqueConclusion(audit.documentStatus, st.mc, syn);

  const noteY = lowerY + 119;
  const noteH = 26;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, noteY, CW, noteH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE TECHNIQUE', ML + 7, noteY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(
      conclusion || 'La faisabilite technique depend de la completude des regles PLU et des controles de conformite projet.',
      CW - 14,
    ).slice(0, 2),
    ML + 7,
    noteY + 17,
  );

  pageFooter(st);
}

// ============================================================================
// 05 MARCHE
// ============================================================================

function addMarche(st: St): void {
  newPage(st);
  tocRegister(st, '05', s('Étude de marché'));

  const { doc, syn } = st;
  const m = syn.marche;
  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const miniMetric = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    color: RGB = SP.main,
    sub?: string,
  ): void => {
    shadowCard(x, y, w, h, 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + w / 2, y + 11, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14.2);
    doc.setTextColor(...color);
    doc.text(s(value), x + w / 2, y + 23, { align: 'center' });

    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.4);
      doc.setTextColor(...C.slate3);
      doc.text(s(sub), x + w / 2, y + 30, { align: 'center' });
    }
  };

  const hasDvf = (m.transactionsRecentes.nbTransactions ?? 0) > 0;

  const posColor: RGB =
    Math.abs(m.positionPrix) > 10 ? C.red :
    Math.abs(m.positionPrix) > 5 ? C.orange ?? C.amber :
    C.green;

  const marketColor: RGB =
    st.audit.documentStatus === 'incomplete' && !st.mc.hasDVF && !st.mc.hasPrixNeuf ? C.red :
    !st.audit.flags.hasCriticalMarketData ? C.amber :
    C.green;

  const marketBg: RGB =
    marketColor === C.red ? [254, 242, 242] :
    marketColor === C.amber ? [255, 247, 237] :
    [242, 253, 247];

  const marketStatus =
    st.audit.documentStatus === 'incomplete' && !st.mc.hasDVF && !st.mc.hasPrixNeuf
      ? 'MARCHE NON EXPLOITABLE'
      : !st.audit.flags.hasCriticalMarketData
        ? 'DONNEES MARCHE PARTIELLES'
        : 'MARCHE EXPLOITABLE';

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('05', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('ETUDE DE MARCHE', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Status banner
  const bannerY = pageTop + 18;
  const bannerH = 27;

  doc.setFillColor(...marketBg);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...marketColor);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...marketColor);
  doc.circle(ML + 13, bannerY + 13.5, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('DVF', ML + 13, bannerY + 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...marketColor);
  doc.text('STATUT MARCHE', ML + 27, bannerY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SP.deep);
  doc.text(marketStatus, ML + 27, bannerY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      hasDvf
        ? `Transactions DVF disponibles sur la periode ${s(m.transactionsRecentes.periode || 'N/A')}.`
        : 'Aucune transaction DVF exploitable ou donnees de marche insuffisantes.',
      64,
    ),
    PW - MR - 68,
    bannerY + 11,
  );

  // KPI grid sans bulles
  const kpiY = bannerY + bannerH + 7;
  const gap = 6;
  const kpiW = (CW - gap * 2) / 3;
  const kpiH = 27;

  miniMetric(
    ML,
    kpiY,
    kpiW,
    kpiH,
    'Prix neuf moyen',
    m.prixNeufMoyenM2 > 0 ? `${fmtNum(m.prixNeufMoyenM2)} EUR/m2` : 'N/A',
    m.prixNeufMoyenM2 > 0 ? SP.main : C.amber,
  );

  miniMetric(
    ML + kpiW + gap,
    kpiY,
    kpiW,
    kpiH,
    'Prix projet',
    m.prixProjetM2 > 0 ? `${fmtNum(m.prixProjetM2)} EUR/m2` : 'N/A',
    m.prixProjetM2 > 0 ? SP.main : C.amber,
  );

  miniMetric(
    ML + (kpiW + gap) * 2,
    kpiY,
    kpiW,
    kpiH,
    'Position marche',
    m.prixProjetM2 > 0 && m.prixNeufMoyenM2 > 0
      ? `${m.positionPrix > 0 ? '+' : ''}${pct(m.positionPrix)}`
      : 'N/A',
    m.prixProjetM2 > 0 ? posColor : C.slate3,
    m.prixProjetM2 > 0 && m.prixNeufMoyenM2 > 0 ? 'vs prix neuf moyen' : undefined,
  );

  const kpiY2 = kpiY + kpiH + 6;

  miniMetric(
    ML,
    kpiY2,
    kpiW,
    kpiH,
    'Prix ancien moyen',
    m.prixAncienMoyenM2 > 0 ? `${fmtNum(m.prixAncienMoyenM2)} EUR/m2` : 'N/A',
    m.prixAncienMoyenM2 > 0 ? SP.main : C.amber,
  );

  miniMetric(
    ML + kpiW + gap,
    kpiY2,
    kpiW,
    kpiH,
    'Prime neuf',
    m.prixNeufMoyenM2 > 0 && m.prixAncienMoyenM2 > 0 ? pct(m.primiumNeuf) : 'N/A',
    m.prixNeufMoyenM2 > 0 && m.prixAncienMoyenM2 > 0 ? SP.main : C.slate3,
  );

  miniMetric(
    ML + (kpiW + gap) * 2,
    kpiY2,
    kpiW,
    kpiH,
    'Zone marche',
    s(m.zoneMarche.replace('_', ' ')).slice(0, 22),
    SP.main,
  );

  // Main sections
  const lowerY = kpiY2 + kpiH + 10;
  const leftW = CW * 0.52;
  const rightW = CW - leftW - 7;
  const leftX = ML;
  const rightX = ML + leftW + 7;
  const panelH = 86;

  shadowCard(leftX, lowerY, leftW, panelH, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('TRANSACTIONS DVF', leftX + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(leftX + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const dvfRows = [
    { l: 'Transactions', v: hasDvf ? String(m.transactionsRecentes.nbTransactions) : 'N/A', src: m.transactionsRecentes.source || 'DVF' },
    { l: 'Prix moyen', v: hasDvf ? `${fmtNum(m.transactionsRecentes.prixMoyenM2)} EUR/m2` : 'N/A', src: m.transactionsRecentes.periode || '' },
    { l: 'Prix min', v: hasDvf ? `${fmtNum(m.transactionsRecentes.prixMin)} EUR/m2` : 'N/A', src: '' },
    { l: 'Prix max', v: hasDvf ? `${fmtNum(m.transactionsRecentes.prixMax)} EUR/m2` : 'N/A', src: '' },
    { l: 'Absorption', v: m.absorptionMensuelle != null ? `${m.absorptionMensuelle} ventes/mois` : 'N/A', src: 'Estimation' },
  ];

  let dy = lowerY + 24;

  dvfRows.forEach((row) => {
    doc.setFillColor(248, 247, 252);
    doc.roundedRect(leftX + 7, dy, leftW - 14, 10.7, 3.5, 3.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    doc.setTextColor(...SP.deep);
    doc.text(s(row.l), leftX + 14, dy + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(...SP.main);
    doc.text(s(row.v), leftX + leftW - 49, dy + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.3);
    doc.setTextColor(...C.slate3);
    doc.text(s(row.src), leftX + leftW - 10, dy + 7, { align: 'right' });

    dy += 12.3;
  });

  shadowCard(rightX, lowerY, rightW, panelH, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('POSITIONNEMENT PRIX', rightX + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(rightX + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const gaugeY = lowerY + 34;
const gaugeX = rightX + 18;
const gaugeW = rightW - 36;
const gaugeH = 7;

// Fond arrondi clip (masque les tranches débordantes)
doc.setFillColor(234, 232, 244);
doc.roundedRect(gaugeX, gaugeY, gaugeW, gaugeH, 3.5, 3.5, 'F');

// Dégradé fluide en tranches — vert (#4ade80) → blanc → rouge (#f87171)
const steps = 80;
const sliceW = gaugeW / steps;
for (let i = 0; i < steps; i++) {
  const t = i / (steps - 1); // 0 = gauche (vert), 1 = droite (rouge)
  let r: number, g: number, b: number;
  if (t < 0.5) {
    // vert → blanc
    const tt = t / 0.5;
    r = Math.round(74  + (255 - 74)  * tt);
    g = Math.round(222 + (255 - 222) * tt);
    b = Math.round(128 + (255 - 128) * tt);
  } else {
    // blanc → rouge
    const tt = (t - 0.5) / 0.5;
    r = 255;
    g = Math.round(255 - (255 - 113) * tt);
    b = Math.round(255 - (255 - 113) * tt);
  }
  doc.setFillColor(r, g, b);
  doc.rect(gaugeX + i * sliceW, gaugeY, sliceW + 0.3, gaugeH, 'F');
}

// Masque arrondi blanc sur les bords pour simuler border-radius propre
doc.setFillColor(255, 255, 255);
doc.setDrawColor(255, 255, 255);
doc.setLineWidth(0);
// coins gauche
doc.rect(gaugeX - 1, gaugeY - 1, 4, gaugeH + 2, 'F');
doc.roundedRect(gaugeX, gaugeY, 4, gaugeH, 3.5, 3.5, 'F');
// coins droit
doc.rect(gaugeX + gaugeW - 3, gaugeY - 1, 4, gaugeH + 2, 'F');
doc.roundedRect(gaugeX + gaugeW - 4, gaugeY, 4, gaugeH, 3.5, 3.5, 'F');

// Ligne 0% fine et nette
const centerX = gaugeX + gaugeW / 2;
doc.setDrawColor(255, 255, 255);
doc.setLineWidth(0.8);
doc.line(centerX, gaugeY, centerX, gaugeY + gaugeH);

// Curseur rectangulaire pill
const posNorm = Math.max(-20, Math.min(20, m.positionPrix));
const markerX = centerX + (posNorm / 40) * gaugeW;
const mW = 10;
const mH = gaugeH + 4;

// Ombre curseur
setOpacity(doc, 0.18);
doc.setFillColor(40, 25, 80);
doc.roundedRect(markerX - mW / 2 + 0.8, gaugeY - 2 + 1.2, mW, mH, 2.5, 2.5, 'F');
setOpacity(doc, 1);

// Curseur pill blanc avec bordure violette
doc.setFillColor(255, 255, 255);
doc.roundedRect(markerX - mW / 2, gaugeY - 2, mW, mH, 2.5, 2.5, 'F');
doc.setDrawColor(...SP.main);
doc.setLineWidth(1.2);
doc.roundedRect(markerX - mW / 2, gaugeY - 2, mW, mH, 2.5, 2.5, 'S');

// Traits intérieurs du curseur (style "grip")
doc.setDrawColor(...SP.main);
doc.setLineWidth(0.5);
doc.line(markerX - 1.5, gaugeY + 1.2, markerX - 1.5, gaugeY + gaugeH - 1.2);
doc.line(markerX,       gaugeY + 1.2, markerX,       gaugeY + gaugeH - 1.2);
doc.line(markerX + 1.5, gaugeY + 1.2, markerX + 1.5, gaugeY + gaugeH - 1.2);

// Labels
doc.setFont('helvetica', 'normal');
doc.setFontSize(6);
doc.setTextColor(...C.slate3);
doc.text('-20%', gaugeX, gaugeY + gaugeH + 7);
doc.text('0%',   centerX, gaugeY + gaugeH + 7, { align: 'center' });
doc.text('+20%', gaugeX + gaugeW, gaugeY + gaugeH + 7, { align: 'right' });

  const posValue = m.prixProjetM2 > 0 && m.prixNeufMoyenM2 > 0
    ? `${m.positionPrix > 0 ? '+' : ''}${pct(m.positionPrix)}`
    : 'N/A';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...posColor);
  doc.text(posValue, rightX + rightW / 2, lowerY + 60, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...SP.deep);
  doc.text('vs prix neuf moyen', rightX + rightW / 2, lowerY + 68, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.7);
  doc.setTextColor(...SP.deep);

  const positionText =
    m.prixProjetM2 <= 0 || m.prixNeufMoyenM2 <= 0
      ? 'Positionnement non calculable : prix projet ou reference marche absent.'
      : Math.abs(m.positionPrix) > 10
        ? 'Ecart significatif : le prix doit etre revalide.'
        : Math.abs(m.positionPrix) > 5
          ? 'Ecart modere : positionnement a confirmer avec les comparables.'
          : 'Prix projet coherent avec la reference marche disponible.';

  doc.text(
    doc.splitTextToSize(positionText, rightW - 24).slice(0, 2),
    rightX + rightW / 2,
    lowerY + 77,
    { align: 'center' },
  );

  // Bottom note
  const bottomY = lowerY + panelH + 8;
  const bottomH = 24;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE MARCHE', ML + 7, bottomY + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...SP.deep);

  const marcheConclusion = generateMarcheConclusion(st.audit.documentStatus, st.mc);
  const notes = m.notesMarcheLibre.length > 0
    ? m.notesMarcheLibre.slice(0, 1).join(' ')
    : marcheConclusion || 'La lecture marche consolide les prix disponibles, le positionnement projet et les transactions DVF recentes.';

  doc.text(
    doc.splitTextToSize(s(notes), CW - 14).slice(0, 2),
    ML + 7,
    bottomY + 17,
  );

  pageFooter(st);
}

// ============================================================================
// 06 FINANCIER
// ============================================================================

function addFinancier(st: St): void {
  newPage(st);
  tocRegister(st, '06', s('Analyse financière'));

  const { doc, syn } = st;
  const f = syn.financier;

  const pageTop = MT + HDR_H + 4;
  const hasCA = f.chiffreAffairesTotal > 0;
  const hasCDR = f.coutRevientTotal > 0;
  const hasFin = hasCA && hasCDR;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  const shadowCard = (x: number, y: number, w: number, h: number): void => {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 5, 5, 'F');
    doc.setDrawColor(...SP.ultra);
    doc.roundedRect(x, y, w, h, 5, 5, 'S');
  };

  const ratioColor = (v: number): RGB =>
    v >= 15 ? C.green : v >= 8 ? C.amber : C.red;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('ANALYSE FINANCIERE', ML, pageTop + 8);

  // ===== KPI =====
  const kpiY = pageTop + 18;
  const gap = 6;
  const w = (CW - gap * 2) / 3;

  const kpi = (
    x: number,
    y: number,
    label: string,
    val: string,
    color: RGB,
  ) => {
    shadowCard(x, y, w, 24);

    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);
    doc.text(label.toUpperCase(), x + w / 2, y + 8, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(...color);
    doc.text(val, x + w / 2, y + 18, { align: 'center' });
  };

  kpi(ML, kpiY, 'CA total', hasCA ? eurM(f.chiffreAffairesTotal) : 'N/A', SP.main);
  kpi(ML + w + gap, kpiY, 'Coût total', hasCDR ? eurM(f.coutRevientTotal) : 'N/A', SP.main);
  kpi(
    ML + (w + gap) * 2,
    kpiY,
    'Marge nette',
    hasFin ? eurM(f.margeNette) : 'N/A',
    hasFin ? ratioColor(f.margeNettePercent) : C.slate3,
  );

  // ===== STRUCTURE =====
  const lowerY = kpiY + 32;
  const leftW = CW * 0.55;
  const rightW = CW - leftW - 7;

  const panelH = 84; // ↓ réduit

  shadowCard(ML, lowerY, leftW, panelH);

  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('STRUCTURE DU BILAN', ML + 7, lowerY + 10);

  const rows = [
    ['Chiffre d’affaires', eur(f.chiffreAffairesTotal), '100%'],
    ['Coût foncier', eur(f.coutFoncier), safePct(f.coutFoncier, f.chiffreAffairesTotal)],
    ['Coût travaux', eur(f.coutTravaux), safePct(f.coutTravaux, f.chiffreAffairesTotal)],
    ['Frais financiers', eur(f.coutFinanciers), safePct(f.coutFinanciers, f.chiffreAffairesTotal)],
    ['Frais commercialisation', eur(f.fraisCommercialisation), safePct(f.fraisCommercialisation, f.chiffreAffairesTotal)],
    ['Marge nette', eur(f.margeNette), pct(f.margeNettePercent)],
  ];

  let ry = lowerY + 18; // ↑ remonté

  rows.forEach((r, i) => {
    const isLast = i === rows.length - 1;

    doc.setFillColor(isLast ? 240 : 248, isLast ? 253 : 247, isLast ? 244 : 252);
    doc.roundedRect(ML + 7, ry, leftW - 14, 9.2, 3, 3, 'F'); // ↓ plus compact

    doc.setFontSize(6.2);
    doc.setTextColor(...SP.deep);
    doc.text(r[0], ML + 12, ry + 6);

    doc.setFontSize(6.2);
    doc.setTextColor(...SP.main);
    doc.text(r[1], ML + leftW - 48, ry + 6);

    doc.setFontSize(5.8);
    doc.setTextColor(...SP.deep);
    doc.text(r[2], ML + leftW - 10, ry + 6, { align: 'right' });

    ry += 10.3; // ↓ espacement réduit
  });

  // ===== RENTABILITÉ =====
  const rightX = ML + leftW + 7;

  shadowCard(rightX, lowerY, rightW, panelH);

  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('RENTABILITE', rightX + 7, lowerY + 10);

  const gaugeY = lowerY + 34;
  const gaugeX = rightX + 12;
  const gaugeW = rightW - 24;
  const gaugeH = 6;

  doc.setFillColor(234, 232, 244);
  doc.roundedRect(gaugeX, gaugeY, gaugeW, gaugeH, 3, 3, 'F');

  const filled = hasFin ? (Math.min(25, f.margeNettePercent) / 25) * gaugeW : 0;
  doc.setFillColor(...ratioColor(f.margeNettePercent));
  doc.roundedRect(gaugeX, gaugeY, filled, gaugeH, 3, 3, 'F');

  doc.setFontSize(16);
  doc.setTextColor(...ratioColor(f.margeNettePercent));
  doc.text(hasFin ? pct(f.margeNettePercent) : 'N/A', rightX + rightW / 2, lowerY + 64, { align: 'center' });

  // ===== NOTE =====
  const bottomY = lowerY + panelH + 5; // ↑ remonté

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, 22, 5, 5, 'F');

  doc.setFontSize(8);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE FINANCIERE', ML + 7, bottomY + 8);

  doc.setFontSize(6.5);
  doc.text(
    hasFin
      ? 'Analyse basee sur les donnees de cout et de prix de vente.'
      : 'Donnees insuffisantes pour une analyse fiable.',
    ML + 7,
    bottomY + 15,
  );

  pageFooter(st);
}

// ============================================================================
// 07 FINANCEMENT
// ============================================================================

function addFinancement(st: St): void {
  newPage(st);
  tocRegister(st, '07', 'Plan de financement');

  const { doc, syn } = st;
  const fin = syn.financement;

  const pageTop = MT + HDR_H + 4;
  const hasCA = st.mc.hasCA;
  const hasCredit = fin.creditPromoteurMontant > 0;
  const hasFP = fin.fondsPropresRequis > 0;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const miniMetric = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    color: RGB = SP.main,
    sub?: string,
  ): void => {
    shadowCard(x, y, w, h, 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + w / 2, y + 10.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.2);
    doc.setTextColor(...color);
    doc.text(s(value), x + w / 2, y + 22, { align: 'center' });

    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(...C.slate3);
      doc.text(s(sub), x + w / 2, y + 29, { align: 'center' });
    }
  };

  const statusColor: RGB = !hasCA ? C.red : hasCredit || hasFP ? C.green : C.amber;
  const statusBg: RGB =
    statusColor === C.red ? [254, 242, 242] :
    statusColor === C.amber ? [255, 247, 237] :
    [242, 253, 247];

  const statusLabel =
    !hasCA
      ? 'PLAN NON EXPLOITABLE'
      : hasCredit || hasFP
        ? 'PLAN DE FINANCEMENT STRUCTURE'
        : 'PLAN A COMPLETER';

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('07', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('PLAN DE FINANCEMENT', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Status banner
  const bannerY = pageTop + 18;
  const bannerH = 27;

  doc.setFillColor(...statusBg);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...statusColor);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...statusColor);
  doc.circle(ML + 13, bannerY + 13.5, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('€', ML + 13, bannerY + 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...statusColor);
  doc.text('STATUT FINANCEMENT', ML + 27, bannerY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SP.deep);
  doc.text(statusLabel, ML + 27, bannerY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      hasCA
        ? 'Lecture du besoin en fonds propres, du credit promoteur et du prefinancement requis.'
        : "Plan non exploitable : chiffre d'affaires absent.",
      64,
    ),
    PW - MR - 68,
    bannerY + 11,
  );

  // KPI
  const kpiY = bannerY + bannerH + 7;
  const gap = 6;
  const kpiW = (CW - gap * 2) / 3;
  const kpiH = 28;

  miniMetric(
    ML,
    kpiY,
    kpiW,
    kpiH,
    'Fonds propres',
    hasFP ? eurM(fin.fondsPropresRequis) : 'N/A',
    hasFP ? SP.main : C.amber,
    hasFP ? pct(fin.fondsPropresPercent) : undefined,
  );

  miniMetric(
    ML + kpiW + gap,
    kpiY,
    kpiW,
    kpiH,
    'Credit promoteur',
    hasCredit ? eurM(fin.creditPromoteurMontant) : 'N/A',
    hasCredit ? SP.main : C.amber,
    hasCredit ? `${fin.creditPromoteurDuree} mois` : undefined,
  );

  miniMetric(
    ML + (kpiW + gap) * 2,
    kpiY,
    kpiW,
    kpiH,
    'Taux credit',
    fin.tauxCredit > 0 ? pct(fin.tauxCredit) : 'N/A',
    fin.tauxCredit > 0 ? SP.main : C.slate3,
  );

  const kpiY2 = kpiY + kpiH + 7;

  miniMetric(
    ML,
    kpiY2,
    kpiW,
    kpiH,
    'Ratio FP / CDR',
    pct(fin.ratioFondsPropres),
    fin.ratioFondsPropres >= 20 ? C.green : fin.ratioFondsPropres >= 10 ? C.amber : C.red,
  );

  miniMetric(
    ML + kpiW + gap,
    kpiY2,
    kpiW,
    kpiH,
    'Prefinancement VEFA',
    pct(fin.prefinancementVentes),
    fin.prefinancementVentes >= 30 ? C.green : C.amber,
  );

  miniMetric(
    ML + (kpiW + gap) * 2,
    kpiY2,
    kpiW,
    kpiH,
    'Duree credit',
    fin.creditPromoteurDuree > 0 ? `${fin.creditPromoteurDuree} mois` : 'N/A',
    fin.creditPromoteurDuree > 0 ? SP.main : C.slate3,
  );

  // Main panels
  const lowerY = kpiY2 + kpiH + 10;
  const leftW = CW * 0.52;
  const rightW = CW - leftW - 7;
  const rightX = ML + leftW + 7;
  const panelH = 84;

  shadowCard(ML, lowerY, leftW, panelH, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('STRUCTURE FINANCEMENT', ML + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const rows = [
    { l: 'Fonds propres requis', v: hasFP ? eur(fin.fondsPropresRequis) : 'N/A', p: hasFP ? pct(fin.fondsPropresPercent) : 'N/A' },
    { l: 'Credit promoteur', v: hasCredit ? eur(fin.creditPromoteurMontant) : 'N/A', p: hasCredit ? `${fin.creditPromoteurDuree} mois` : 'N/A' },
    { l: 'Taux credit estime', v: fin.tauxCredit > 0 ? pct(fin.tauxCredit) : 'N/A', p: 'Indicatif' },
    { l: 'Ratio FP / CDR', v: pct(fin.ratioFondsPropres), p: 'Structure' },
    { l: 'Prefinancement VEFA', v: pct(fin.prefinancementVentes), p: 'Seuil requis' },
  ];

  let ry = lowerY + 22;

  rows.forEach((row) => {
    doc.setFillColor(248, 247, 252);
    doc.roundedRect(ML + 7, ry, leftW - 14, 10.5, 3.5, 3.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...SP.deep);
    doc.text(s(row.l), ML + 12, ry + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...SP.main);
    doc.text(s(row.v), ML + leftW - 52, ry + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...C.slate3);
    doc.text(s(row.p), ML + leftW - 10, ry + 7, { align: 'right' });

    ry += 11.2;
  });

  // Right: garanties / notes bancaires
  shadowCard(rightX, lowerY, rightW, panelH, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('GARANTIES & NOTES', rightX + 7, lowerY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(rightX + 7, lowerY + 15, 15, 1, 0.5, 0.5, 'F');

  const garanties = fin.garantiesRequises.length > 0
    ? fin.garantiesRequises.slice(0, 3)
    : ['Aucune garantie specifiee'];

  const notes = fin.notesBancaires.length > 0
    ? fin.notesBancaires.slice(0, 3)
    : ['Aucune note bancaire specifique'];

  let gy = lowerY + 27;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...SP.deep);
  doc.text('Garanties requises', rightX + 7, gy);

  gy += 7;

  garanties.forEach((g) => {
    doc.setFillColor(...SP.crystal);
    doc.roundedRect(rightX + 7, gy - 4, rightW - 14, 10, 3.5, 3.5, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.1);
    doc.setTextColor(...SP.deep);
    doc.text(doc.splitTextToSize(s(g), rightW - 18).slice(0, 1), rightX + 10, gy + 2);

    gy += 11.5;
  });

  gy += 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...SP.deep);
  doc.text('Notes bancaires', rightX + 7, gy);

  gy += 7;

  notes.forEach((n) => {
    if (gy > lowerY + panelH - 7) return;

    doc.setFillColor(255, 247, 237);
    doc.roundedRect(rightX + 7, gy - 4, rightW - 14, 10, 3.5, 3.5, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.1);
    doc.setTextColor(...SP.deep);
    doc.text(doc.splitTextToSize(s(n), rightW - 18).slice(0, 1), rightX + 10, gy + 2);

    gy += 11.5;
  });

  // Bottom note
  const bottomY = lowerY + panelH + 6;
  const bottomH = 24;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE FINANCEMENT', ML + 7, bottomY + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(
      hasCA
        ? 'Le plan de financement doit etre confirme par la banque selon le niveau de precommercialisation, les garanties exigees et la robustesse du bilan.'
        : 'Le plan de financement ne peut pas etre exploite tant que le chiffre d affaires et le cout de revient ne sont pas stabilises.',
      CW - 14,
    ).slice(0, 2),
    ML + 7,
    bottomY + 17,
  );

  pageFooter(st);
}

// ============================================================================
// 08 RISQUES
// ============================================================================

function addRisques(st: St): void {
  newPage(st);
  tocRegister(st, '08', 'Analyse des risques');

  const { doc, syn } = st;
  const risques = syn.risques ?? [];

  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const levelColor = (niveau: RisqueNiveau | string): RGB => {
    if (niveau === 'CRITIQUE') return C.red;
    if (niveau === 'ELEVE') return C.orange ?? C.amber;
    if (niveau === 'MODERE') return C.amber;
    return C.green;
  };

  const levelBg = (niveau: RisqueNiveau | string): RGB => {
    if (niveau === 'CRITIQUE') return [254, 242, 242];
    if (niveau === 'ELEVE') return [255, 247, 237];
    if (niveau === 'MODERE') return [255, 251, 235];
    return [242, 253, 247];
  };

  const critiques = risques.filter(r => r.niveau === 'CRITIQUE').length;
  const eleves = risques.filter(r => r.niveau === 'ELEVE').length;
  const moderes = risques.filter(r => r.niveau === 'MODERE').length;
  const faibles = risques.filter(r => r.niveau === 'FAIBLE').length;

  const riskStatusColor: RGB =
    critiques > 0 ? C.red :
    eleves > 0 ? C.orange ?? C.amber :
    moderes > 0 ? C.amber :
    risques.length > 0 ? C.green :
    C.amber;

  const riskStatusBg: RGB =
    riskStatusColor === C.red ? [254, 242, 242] :
    riskStatusColor === C.amber || riskStatusColor === (C.orange ?? C.amber) ? [255, 247, 237] :
    [242, 253, 247];

  const riskStatus =
    risques.length === 0
      ? 'RISQUES NON ANALYSES'
      : critiques > 0
        ? 'RISQUES CRITIQUES IDENTIFIES'
        : eleves > 0
          ? 'RISQUES ELEVES A TRAITER'
          : moderes > 0
            ? 'RISQUES MODERES'
            : 'RISQUE MAITRISE';

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('08', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('ANALYSE DES RISQUES', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Status banner
  const bannerY = pageTop + 18;
  const bannerH = 27;

  doc.setFillColor(...riskStatusBg);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...riskStatusColor);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...riskStatusColor);
  doc.circle(ML + 13, bannerY + 13.5, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('!', ML + 13, bannerY + 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...riskStatusColor);
  doc.text('STATUT RISQUES', ML + 27, bannerY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SP.deep);
  doc.text(riskStatus, ML + 27, bannerY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      risques.length > 0
        ? `${risques.length} risque(s) identifie(s), dont ${critiques} critique(s) et ${eleves} eleve(s).`
        : "Aucun risque detaille n'est disponible dans le dossier. L'analyse doit etre completee.",
      64,
    ),
    PW - MR - 68,
    bannerY + 11,
  );

  // KPI row
  const kpiY = bannerY + bannerH + 7;
  const gap = 5;
  const kpiW = (CW - gap * 4) / 5;
  const kpiH = 26;

  const miniMetric = (
    x: number,
    label: string,
    value: string,
    color: RGB,
  ): void => {
    shadowCard(x, kpiY, kpiW, kpiH, 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + kpiW / 2, kpiY + 9, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...color);
    doc.text(value, x + kpiW / 2, kpiY + 20, { align: 'center' });
  };

  miniMetric(ML, 'Total', String(risques.length), SP.main);
  miniMetric(ML + (kpiW + gap), 'Critiques', String(critiques), critiques > 0 ? C.red : C.green);
  miniMetric(ML + (kpiW + gap) * 2, 'Eleves', String(eleves), eleves > 0 ? C.orange ?? C.amber : C.green);
  miniMetric(ML + (kpiW + gap) * 3, 'Moderes', String(moderes), moderes > 0 ? C.amber : C.green);
  miniMetric(ML + (kpiW + gap) * 4, 'Faibles', String(faibles), C.green);

  // Main risk list
  const listY = kpiY + kpiH + 10;
  const listH = 118;

  shadowCard(ML, listY, CW, listH, 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('CARTOGRAPHIE DES RISQUES', ML + 7, listY + 12);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML + 7, listY + 15, 15, 1, 0.5, 0.5, 'F');

  if (risques.length === 0) {
    const msg =
      st.audit.documentStatus === 'incomplete'
        ? "L'absence de risques identifies sur un dossier incomplet ne signifie pas l'absence de risques. L'analyse des risques doit etre conduite apres completion des donnees projet, financieres et techniques."
        : "Aucun risque identifie. Une verification complementaire reste recommandee avant presentation en comite.";

    doc.setFillColor(255, 247, 237);
    doc.roundedRect(ML + 7, listY + 28, CW - 14, 28, 4, 4, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);
    doc.text(doc.splitTextToSize(s(msg), CW - 24).slice(0, 4), ML + 12, listY + 38);
  } else {
    const displayRisques = risques.slice(0, 5);
    let ry = listY + 27;

    displayRisques.forEach((r) => {
      const c = levelColor(r.niveau);
      const bg = levelBg(r.niveau);

      doc.setFillColor(...bg);
      doc.roundedRect(ML + 7, ry, CW - 14, 16.5, 4, 4, 'F');

      doc.setFillColor(...c);
      doc.circle(ML + 15, ry + 8.2, 4.1, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.2);
      doc.setTextColor(...C.white);
      doc.text(
        r.niveau === 'CRITIQUE' ? 'CR' :
        r.niveau === 'ELEVE' ? 'EL' :
        r.niveau === 'MODERE' ? 'MO' :
        'FA',
        ML + 15,
        ry + 10,
        { align: 'center' },
      );

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(...SP.deep);
      doc.text(doc.splitTextToSize(s(r.libelle), 72).slice(0, 1), ML + 24, ry + 6.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...C.slate3);
      doc.text(doc.splitTextToSize(s(r.mitigation), 82).slice(0, 1), ML + 24, ry + 12.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      doc.setTextColor(...c);
      doc.text(s(r.niveau), PW - MR - 7, ry + 9.5, { align: 'right' });

      ry += 18.8;
    });

    if (risques.length > displayRisques.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.2);
      doc.setTextColor(...C.slate3);
      doc.text(
        s(`+ ${risques.length - displayRisques.length} autre(s) risque(s) non affiche(s) sur cette page.`),
        ML + 7,
        listY + listH - 7,
      );
    }
  }

  // Bottom note
  const bottomY = listY + listH + 7;
  const bottomH = 24;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE RISQUES', ML + 7, bottomY + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(
      risques.length > 0
        ? 'La lecture des risques doit etre rapprochee des donnees PLU, marche et bilan financier avant toute decision engageante.'
        : "L'analyse des risques est incomplete : elle doit etre completee avant presentation decisionnelle.",
      CW - 14,
    ).slice(0, 2),
    ML + 7,
    bottomY + 17,
  );

  pageFooter(st);
}

// ============================================================================
// 09 SCENARIOS
// ============================================================================

function addScenarios(st: St): void {
  if ((st.syn.scenarios?.length ?? 0) === 0) return;

  const suppression = scenariosGate(st.audit.documentStatus, st.mc, st.syn.scenarios);

  newPage(st);
  tocRegister(st, '09', s('Scénarios de sensibilité'));

  const { doc, syn } = st;
  const scenarios = syn.scenarios ?? [];
  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const scenarioColor = (type: string): RGB => {
    if (type === 'OPTIMISTE') return C.green;
    if (type === 'BASE') return SP.main;
    if (type === 'PESSIMISTE') return C.amber;
    return C.red;
  };

  const scenarioBg = (type: string): RGB => {
    if (type === 'OPTIMISTE') return [242, 253, 247];
    if (type === 'BASE') return SP.crystal;
    if (type === 'PESSIMISTE') return [255, 247, 237];
    return [254, 242, 242];
  };

  const marginColor = (v: number): RGB =>
    v >= 15 ? C.green : v >= 8 ? C.amber : C.red;

  const bestScenario = scenarios.reduce<Scenario | null>((best, sc) => {
    if (!best) return sc;
    return sc.resultat.margeNettePercent > best.resultat.margeNettePercent ? sc : best;
  }, null);

  const worstScenario = scenarios.reduce<Scenario | null>((worst, sc) => {
    if (!worst) return sc;
    return sc.resultat.margeNettePercent < worst.resultat.margeNettePercent ? sc : worst;
  }, null);

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('09', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('SCENARIOS DE SENSIBILITE', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Suppression / non exploitable
  if (suppression) {
    const boxY = pageTop + 24;
    const boxH = 55;

    doc.setFillColor(254, 242, 242);
    doc.roundedRect(ML, boxY, CW, boxH, 6, 6, 'F');

    doc.setDrawColor(...C.red);
    doc.setLineWidth(0.3);
    doc.roundedRect(ML, boxY, CW, boxH, 6, 6, 'S');

    doc.setFillColor(...C.red);
    doc.circle(ML + 14, boxY + 18, 7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.white);
    doc.text('!', ML + 14, boxY + 21, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.red);
    doc.text('SCENARIOS NON EXPLOITABLES', ML + 28, boxY + 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...SP.deep);
    doc.text(doc.splitTextToSize(s(suppression), CW - 36).slice(0, 5), ML + 28, boxY + 27);

    pageFooter(st);
    return;
  }

  // Status banner
  const bannerY = pageTop + 18;
  const bannerH = 27;

  doc.setFillColor(242, 253, 247);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...C.green);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...C.green);
  doc.circle(ML + 13, bannerY + 13.5, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('S', ML + 13, bannerY + 16, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...C.green);
  doc.text('ANALYSE DE SENSIBILITE', ML + 27, bannerY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SP.deep);
  doc.text(`${scenarios.length} SCENARIO(S) TESTE(S)`, ML + 27, bannerY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate3);
  doc.text(
    doc.splitTextToSize(
      worstScenario
        ? `Scenario le plus degrade : ${s(worstScenario.libelle)} avec ${pct(worstScenario.resultat.margeNettePercent)} de marge.`
        : 'Scenarios disponibles selon les hypotheses du bilan.',
      64,
    ),
    PW - MR - 68,
    bannerY + 11,
  );

  // KPI row
  const kpiY = bannerY + bannerH + 7;
  const gap = 6;
  const kpiW = (CW - gap * 2) / 3;
  const kpiH = 28;

  const miniMetric = (
    x: number,
    label: string,
    value: string,
    color: RGB,
    sub?: string,
  ): void => {
    shadowCard(x, kpiY, kpiW, kpiH, 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);
    doc.text(s(label).toUpperCase(), x + kpiW / 2, kpiY + 10, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...color);
    doc.text(s(value), x + kpiW / 2, kpiY + 21, { align: 'center' });

    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.9);
      doc.setTextColor(...C.slate3);
      doc.text(s(sub), x + kpiW / 2, kpiY + 26, { align: 'center' });
    }
  };

  miniMetric(
    ML,
    'Meilleur cas',
    bestScenario ? pct(bestScenario.resultat.margeNettePercent) : 'N/A',
    bestScenario ? marginColor(bestScenario.resultat.margeNettePercent) : C.slate3,
    bestScenario ? bestScenario.libelle : undefined,
  );

  miniMetric(
    ML + kpiW + gap,
    'Scenario stress',
    scenarios.find(sc => sc.type === 'STRESS') ? pct(scenarios.find(sc => sc.type === 'STRESS')!.resultat.margeNettePercent) : 'N/A',
    scenarios.find(sc => sc.type === 'STRESS') ? marginColor(scenarios.find(sc => sc.type === 'STRESS')!.resultat.margeNettePercent) : C.slate3,
    'marge nette',
  );

  miniMetric(
    ML + (kpiW + gap) * 2,
    'Pire cas',
    worstScenario ? pct(worstScenario.resultat.margeNettePercent) : 'N/A',
    worstScenario ? marginColor(worstScenario.resultat.margeNettePercent) : C.slate3,
    worstScenario ? worstScenario.libelle : undefined,
  );

  // Scenario cards
  const cardsY = kpiY + kpiH + 10;
  const cardGap = 6;
  const cols = 2;
  const cardW = (CW - cardGap) / cols;
  const cardH = 58;

  scenarios.slice(0, 4).forEach((sc, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = ML + col * (cardW + cardGap);
    const y = cardsY + row * (cardH + cardGap);
    const c = scenarioColor(sc.type);
    const bg = scenarioBg(sc.type);

    shadowCard(x, y, cardW, cardH, 5);

    doc.setFillColor(...bg);
    doc.roundedRect(x + 4, y + 4, cardW - 8, 15, 4, 4, 'F');

    doc.setFillColor(...c);
    doc.circle(x + 12, y + 11.5, 4.3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.4);
    doc.setTextColor(...C.white);
    doc.text(
      sc.type === 'OPTIMISTE' ? 'OP' :
      sc.type === 'BASE' ? 'BA' :
      sc.type === 'PESSIMISTE' ? 'PE' :
      'ST',
      x + 12,
      y + 13.5,
      { align: 'center' },
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(...SP.deep);
    doc.text(doc.splitTextToSize(s(sc.libelle).toUpperCase(), cardW - 32).slice(0, 1), x + 20, y + 10.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...c);
    doc.text(s(REC_LABELS_SHORT[sc.resultat.recommendation]), x + cardW - 8, y + 14, { align: 'right' });

    const rowY = y + 28;
    const col1 = x + 8;
    const col2 = x + cardW / 2 + 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.slate3);
    doc.text('Prix vente', col1, rowY);
    doc.text('Travaux', col2, rowY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);
    doc.text(`${fmtNum(sc.hypotheses.prixVenteM2)} EUR/m2`, col1, rowY + 7);
    doc.text(`${fmtNum(sc.hypotheses.coutTravauxM2)} EUR/m2`, col2, rowY + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...C.slate3);
    doc.text('Marge nette', col1, rowY + 19);
    doc.text('TRN', col2, rowY + 19);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...marginColor(sc.resultat.margeNettePercent));
    doc.text(pct(sc.resultat.margeNettePercent), col1, rowY + 27);

    doc.setTextColor(...marginColor(sc.resultat.trnRendement));
    doc.text(pct(sc.resultat.trnRendement), col2, rowY + 27);
  });

  // Bottom note
  const bottomY = cardsY + cardH * 2 + cardGap + 8;
  const bottomH = 23;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE SCENARIOS', ML + 7, bottomY + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...SP.deep);

  doc.text(
    doc.splitTextToSize(
      st.audit.documentStatus === 'provisional'
        ? 'Les scenarios reposent sur des donnees partielles. Les resultats doivent etre revalides apres completion du dossier.'
        : "Le scenario de stress teste la resilience de l'operation dans des conditions degradees cumulees.",
      CW - 14,
    ).slice(0, 2),
    ML + 7,
    bottomY + 17,
  );

  pageFooter(st);
}

// ============================================================================
// 10 HYPOTHESES
// ============================================================================

function addHypotheses(st: St): void {
  newPage(st);
  tocRegister(st, '10', s('Hypothèses de calcul'));

  const { doc, syn } = st;
  const f = syn.financier;
  const m = syn.marche;
  const fin = syn.financement;

  const pageTop = MT + HDR_H + 4;
  const hasSDP = syn.projet.surfacePlancher > 0;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  const shadowCard = (x: number, y: number, w: number, h: number): void => {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 5, 5, 'F');
    doc.setDrawColor(...SP.ultra);
    doc.roundedRect(x, y, w, h, 5, 5, 'S');
  };

  // HEADER
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('HYPOTHESES DE CALCUL', ML, pageTop + 8);

  // ===== KPI =====
  const kpiY = pageTop + 18;
  const gap = 6;
  const w = (CW - gap * 2) / 3;

  const kpi = (x: number, y: number, label: string, val: string) => {
    shadowCard(x, y, w, 24);

    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);
    doc.text(label.toUpperCase(), x + w / 2, y + 8, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(...SP.main);
    doc.text(val, x + w / 2, y + 18, { align: 'center' });
  };

  kpi(ML, kpiY, 'Prix vente', m.prixProjetM2 ? `${fmtNum(m.prixProjetM2)} EUR/m2` : 'N/A');
  kpi(ML + w + gap, kpiY, 'Travaux', hasSDP ? `${fmtNum(f.coutTravauxM2)} EUR/m2` : 'N/A');
  kpi(ML + (w + gap) * 2, kpiY, 'Foncier', f.coutFoncier ? eurM(f.coutFoncier) : 'N/A');

  // ===== TABLE =====
  const tableY = kpiY + 30;
  const tableH = 125; // 🔥 FIX cadre plus grand

  shadowCard(ML, tableY, CW, tableH);

  doc.setFontSize(10);
  doc.setTextColor(...SP.deep);
  doc.text('HYPOTHESES STRUCTURANTES', ML + 7, tableY + 10);

  const rows = [
    ['Prix de vente moyen / m2', `${fmtNum(m.prixProjetM2)} EUR/m2`, 'Prix moyen pondere sortie'],
    ['Cout travaux / m2', `${fmtNum(f.coutTravauxM2)} EUR/m2`, 'Hors fondations speciales'],
    ['Cout foncier', eur(f.coutFoncier), 'Acquisition + frais notaire'],
    ['Duree operation estimee', `${fin.creditPromoteurDuree} mois`, 'Permis a livraison'],
    ['Taux credit promoteur', pct(fin.tauxCredit), 'Taux indicatif'],
    ['Absorption', `${m.absorptionMensuelle} ventes/mois`, 'Estimation locale'],
    ['Delai ecoulement', `${m.delaiEcoulementMois} mois`, 'Base absorption'],
    ['Prefinancement VEFA', pct(fin.prefinancementVentes), 'Seuil de deblocage credit'],
  ];

  let ry = tableY + 22;

  rows.forEach((r, i) => {
  doc.setFillColor(i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 247 : 255, i % 2 === 0 ? 252 : 255);
  doc.roundedRect(ML + 7, ry, CW - 14, 10.6, 3.5, 3.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.deep);
  doc.text(r[0], ML + 12, ry + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.3);
  doc.setTextColor(...SP.main);
  doc.text(r[1], ML + 84, ry + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...C.slate3);
  doc.text(r[2], PW - MR - 7, ry + 7, { align: 'right' });

  ry += 11.2;
});

  // ===== LECTURE =====
  const bottomY = tableY + tableH + 8; // 🔥 FIX remontée
  const bottomH = 21;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setFontSize(8.5);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE HYPOTHESES', ML + 7, bottomY + 8);

  doc.setFontSize(6.5);
  doc.text(
    'Les hypotheses doivent etre relues conjointement avec le bilan financier, le marche et les scenarios.',
    ML + 7,
    bottomY + 15,
  );

  pageFooter(st);
}

// ============================================================================
// 11 SYNTHESE IA
// ============================================================================

function addSyntheseIA(st: St): void {
  if (!shouldShowSyntheseIA(st.audit.documentStatus, st.syn)) return;

  const { doc } = st;
  const ia = st.syn.syntheseIA!;
  const status = st.audit.documentStatus;

  const sections = [
    { t: s('Résumé exécutif'),    c: filterSyntheseIA(ia.texteExecutif, 'executif', status, st.mc), tag: 'EX' },
    { t: s('Analyse de marché'),  c: filterSyntheseIA(ia.analyseMarche, 'marche', status, st.mc), tag: 'MA' },
    { t: 'Analyse technique',     c: filterSyntheseIA(ia.analyseTechnique, 'technique', status, st.mc), tag: 'TE' },
    { t: s('Analyse financière'), c: filterSyntheseIA(ia.analyseFinanciere, 'financiere', status, st.mc), tag: 'FI' },
    { t: 'Analyse des risques',   c: filterSyntheseIA(ia.analyseRisques, 'risques', status, st.mc), tag: 'RI' },
  ].filter(sec => sec.c != null);

  if (sections.length === 0) return;

  newPage(st);
  tocRegister(st, '11', s('Synthèse analytique'));

  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('11', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('SYNTHESE ANALYTIQUE', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Intro banner
  const bannerY = pageTop + 18;
  const bannerH = status === 'provisional' ? 27 : 23;

  doc.setFillColor(status === 'provisional' ? 255 : 242, status === 'provisional' ? 247 : 253, status === 'provisional' ? 237 : 247);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...(status === 'provisional' ? C.amber : C.green));
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...(status === 'provisional' ? C.amber : C.green));
  doc.circle(ML + 13, bannerY + bannerH / 2, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('IA', ML + 13, bannerY + bannerH / 2 + 2.5, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...(status === 'provisional' ? C.amber : C.green));
  doc.text('LECTURE ANALYTIQUE', ML + 27, bannerY + 9.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...SP.deep);
  doc.text(
    status === 'provisional'
      ? 'SYNTHESE GENEREE SUR DONNEES PARTIELLES'
      : 'SYNTHESE CONSOLIDEE DU DOSSIER',
    ML + 27,
    bannerY + 18,
  );

  // Cards
  const startY = bannerY + bannerH + 8;
  const gap = 5;
  const cardW = (CW - gap) / 2;
  const cardH = 43;

  sections.slice(0, 4).forEach((sec, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = ML + col * (cardW + gap);
    const y = startY + row * (cardH + gap);

    shadowCard(x, y, cardW, cardH, 5);

    doc.setFillColor(...SP.crystal);
    doc.circle(x + 11, y + 11, 5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...SP.main);
    doc.text(sec.tag, x + 11, y + 13, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(...SP.deep);
    doc.text(s(sec.t).toUpperCase(), x + 20, y + 10.5);

    doc.setFillColor(...SP.main);
    doc.roundedRect(x + 20, y + 13.5, 13, 0.8, 0.4, 0.4, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    doc.setTextColor(...SP.deep);

    const lines = doc.splitTextToSize(s(sec.c!), cardW - 18).slice(0, 5);
    doc.text(lines, x + 8, y + 23);
  });

  // Bloc risques / dernière section en pleine largeur si présente
  if (sections.length >= 5) {
    const sec = sections[4];
    const y = startY + cardH * 2 + gap * 2;

    shadowCard(ML, y, CW, 43, 5);

    doc.setFillColor(...SP.crystal);
    doc.circle(ML + 11, y + 11, 5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...SP.main);
    doc.text(sec.tag, ML + 11, y + 13, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(...SP.deep);
    doc.text(s(sec.t).toUpperCase(), ML + 20, y + 10.5);

    doc.setFillColor(...SP.main);
    doc.roundedRect(ML + 20, y + 13.5, 13, 0.8, 0.4, 0.4, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    doc.setTextColor(...SP.deep);

    const lines = doc.splitTextToSize(s(sec.c!), CW - 20).slice(0, 4);
    doc.text(lines, ML + 8, y + 23);
  }

  // Note finale
  const bottomY = PH - FTR_H - MB - 25;
  const bottomH = 21;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE SYNTHESE', ML + 7, bottomY + 8.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...SP.deep);
  doc.text(
    doc.splitTextToSize(
      status === 'provisional'
        ? 'Cette synthese doit etre confirmee apres completion des donnees manquantes.'
        : 'Cette synthese consolide les lectures marche, technique, financiere et risques du dossier.',
      CW - 14,
    ).slice(0, 2),
    ML + 7,
    bottomY + 15.5,
  );

  pageFooter(st);
}

// ============================================================================
// 12 SOURCES
// ============================================================================

function addSources(st: St): void {
  newPage(st);
  tocRegister(st, '12', s('Sources & fraîcheur des données'));

  const { doc, syn } = st;
  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number, r = 5): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, r, r, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, r, r, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, r, r, 'S');
  };

  const sourceRows = [
    {
      source: 'Foncier',
      detail: s(syn.metadata.sourceFoncier || 'N/A'),
      fresh: s("Selon date de l'etude"),
      tag: 'FO',
    },
    {
      source: 'PLU',
      detail: s(syn.metadata.sourcePlu || 'N/A'),
      fresh: 'Reglement en vigueur',
      tag: 'PL',
    },
    {
      source: 'Marche',
      detail: s(syn.metadata.sourceMarche || 'N/A'),
      fresh: s(syn.marche.transactionsRecentes.periode || 'N/A'),
      tag: 'MA',
    },
    {
      source: 'DVF',
      detail: 'data.gouv.fr - DVF+',
      fresh: s(syn.marche.transactionsRecentes.periode || 'N/A'),
      tag: 'DV',
    },
    {
      source: 'Demographie',
      detail: 'INSEE',
      fresh: 'Dernier recensement disponible',
      tag: 'IN',
    },
    {
      source: 'Generation',
      detail: `Mimmoza - ${fmtDate(new Date())}`,
      fresh: `${fmtDate(new Date())} a ${fmtTime()}`,
      tag: 'MI',
    },
  ];

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('12', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('SOURCES & FRAICHEUR DES DONNEES', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // Banner
  const bannerY = pageTop + 18;
  const bannerH = 22; // ✅ réduit de 25 → 22

  doc.setFillColor(242, 253, 247);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'F');

  doc.setDrawColor(...C.green);
  doc.setLineWidth(0.25);
  doc.roundedRect(ML, bannerY, CW, bannerH, 5, 5, 'S');

  doc.setFillColor(...C.green);
  doc.circle(ML + 13, bannerY + 11, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('SRC', ML + 13, bannerY + 13.5, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...C.green);
  doc.text('TRACABILITE DU DOSSIER', ML + 27, bannerY + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...SP.deep);
  doc.text('ORIGINE ET FRAICHEUR DES DONNEES', ML + 27, bannerY + 16);

  // Source cards — ✅ cardH réduit 40→36, gap réduit 6→5
  const startY = bannerY + bannerH + 7;
  const gap = 5;
  const cardW = (CW - gap) / 2;
  const cardH = 36;

  sourceRows.forEach((row, idx) => {
    const col = idx % 2;
    const line = Math.floor(idx / 2);
    const x = ML + col * (cardW + gap);
    const y = startY + line * (cardH + gap);

    shadowCard(x, y, cardW, cardH, 5);

    doc.setFillColor(...SP.crystal);
    doc.circle(x + 12, y + 11, 5.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...SP.main);
    doc.text(row.tag, x + 12, y + 13.2, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...SP.deep);
    doc.text(s(row.source).toUpperCase(), x + 23, y + 10.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(...SP.deep);
    doc.text(doc.splitTextToSize(s(row.detail), cardW - 31).slice(0, 2), x + 23, y + 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(...C.slate3);
    doc.text(doc.splitTextToSize(s(row.fresh), cardW - 31).slice(0, 1), x + 23, y + 30);
  });

  // Avertissements — ✅ gap avant réduit +10→+7
  const warnY = startY + 3 * (cardH + gap) + 7;
  const warnH = syn.metadata.avertissements.length > 0 ? 30 : 22;

  doc.setFillColor(
    syn.metadata.avertissements.length > 0 ? 255 : 242,
    syn.metadata.avertissements.length > 0 ? 247 : 253,
    syn.metadata.avertissements.length > 0 ? 237 : 247,
  );
  doc.roundedRect(ML, warnY, CW, warnH, 5, 5, 'F');

  doc.setDrawColor(...(syn.metadata.avertissements.length > 0 ? C.amber : C.green));
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, warnY, CW, warnH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  doc.setTextColor(...SP.deep);
  doc.text(
    syn.metadata.avertissements.length > 0 ? 'AVERTISSEMENTS' : 'AUCUN AVERTISSEMENT MAJEUR',
    ML + 7,
    warnY + 9,
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.deep);

  const warningText = syn.metadata.avertissements.length > 0
    ? syn.metadata.avertissements.slice(0, 2).map(a => `- ${s(a)}`).join(' ')
    : 'Les sources disponibles sont presentees avec leur niveau de fraicheur lorsque celui-ci est connu.';

  doc.text(
    doc.splitTextToSize(warningText, CW - 14).slice(0, 2),
    ML + 7,
    warnY + 17,
  );

  // Bottom note — ✅ toujours sous warn, gap réduit à 5
  const bottomH = 18;
  const bottomY = warnY + warnH + 5;

  doc.setFillColor(...SP.crystal);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'F');

  doc.setDrawColor(...SP.ultra);
  doc.setLineWidth(0.3);
  doc.roundedRect(ML, bottomY, CW, bottomH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE SOURCES', ML + 7, bottomY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.1);
  doc.setTextColor(...SP.deep);
  doc.text(
    'La qualite de la recommandation depend directement de la fraicheur et de la completude des sources mobilisees.',
    ML + 7,
    bottomY + 14,
  );

  pageFooter(st);
}

// ============================================================================
// 13 RECOMMANDATION FINALE
// ============================================================================

async function addRecommandation(st: St): Promise<void> {
  newPage(st);
  tocRegister(st, '13', 'Recommandation finale');

  const { doc, syn, audit } = st;
  const es = syn.executiveSummary;
  const pageTop = MT + HDR_H + 4;

  drawGradientV(doc, 0, HDR_H + 0.4, PW, PH - HDR_H, [248, 247, 252], [255, 255, 255], 70);

  setOpacity(doc, 0.11);
  doc.setFillColor(...SP.ultra);
  doc.circle(PW - 18, 38, 34, 'F');
  doc.setFillColor(...SP.crystal);
  doc.circle(18, PH - 36, 42, 'F');
  setOpacity(doc, 1);

  const shadowCard = (x: number, y: number, w: number, h: number): void => {
    setOpacity(doc, 0.07);
    doc.setFillColor(40, 25, 80);
    doc.roundedRect(x + 1.1, y + 1.4, w, h, 6, 6, 'F');
    setOpacity(doc, 1);

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 6, 6, 'F');

    doc.setDrawColor(...SP.ultra);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, 6, 6, 'S');
  };

  const recCol = recColor(audit.effectiveRecommendation);

  // HEADER
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...SP.main);
  doc.text('13', ML, pageTop + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SP.deep);
  doc.text('RECOMMANDATION FINALE', ML + 13, pageTop + 8);

  doc.setFillColor(...SP.main);
  doc.roundedRect(ML, pageTop + 12, 15, 1.2, 0.6, 0.6, 'F');

  // BLOC PRINCIPAL
  const recY = pageTop + 20;
  const recH = 32;

  doc.setFillColor(245, 247, 255);
  doc.roundedRect(ML, recY, CW, recH, 6, 6, 'F');

  doc.setDrawColor(...recCol);
  doc.setLineWidth(0.5);
  doc.roundedRect(ML, recY, CW, recH, 6, 6, 'S');

  doc.setFillColor(...recCol);
  doc.circle(ML + 16, recY + 16, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.white);
  doc.text('GO', ML + 16, recY + 20, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...recCol);
  doc.text('DECISION', ML + 30, recY + 11);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...SP.deep);
  doc.text(s(REC_LABELS[audit.effectiveRecommendation]), ML + 30, recY + 23);

  // TEXTE PRINCIPAL
  const textY = recY + recH + 8;

  shadowCard(ML, textY, CW, 42);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SP.deep);
  doc.text('LECTURE DE LA DECISION', ML + 7, textY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...SP.deep);

  const recText = generateFinalRecommendationText(audit, syn, st.mc);

  doc.text(
    doc.splitTextToSize(s(recText), CW - 14).slice(0, 5),
    ML + 7,
    textY + 20,
  );

  // CONCLUSION IA
  const iaConclusion = generateFinalIAConclusion(audit, syn);
  if (iaConclusion) {
    const iaY = textY + 48;

    shadowCard(ML, iaY, CW, 36);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SP.deep);
    doc.text('CONCLUSION ANALYTIQUE', ML + 7, iaY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(...SP.deep);

    doc.text(
      doc.splitTextToSize(s(iaConclusion), CW - 14).slice(0, 4),
      ML + 7,
      iaY + 20,
    );
  }

  // CONDITIONS
  if (audit.effectiveRecommendation === 'GO_CONDITION' && es.pointsVigilance.length > 0) {
    const condY = PH - FTR_H - MB - 60;

    doc.setFillColor(255, 247, 237);
    doc.roundedRect(ML, condY, CW, 32, 6, 6, 'F');

    doc.setDrawColor(...C.amber);
    doc.roundedRect(ML, condY, CW, 32, 6, 6, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.amber);
    doc.text('CONDITIONS A LEVER', ML + 7, condY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);

    es.pointsVigilance.slice(0, 3).forEach((p, i) => {
      doc.text(`- ${s(p)}`, ML + 7, condY + 18 + i * 6);
    });
  }

  // BLOQUANTS
  if (es.killSwitchesActifs.length > 0) {
    const ksY = PH - FTR_H - MB - 30;

    doc.setFillColor(254, 242, 242);
    doc.roundedRect(ML, ksY, CW, 26, 6, 6, 'F');

    doc.setDrawColor(...C.red);
    doc.roundedRect(ML, ksY, CW, 26, 6, 6, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.red);
    doc.text('POINTS BLOQUANTS', ML + 7, ksY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SP.deep);

    es.killSwitchesActifs.slice(0, 2).forEach((k, i) => {
      doc.text(`- ${s(k)}`, ML + 7, ksY + 18 + i * 6);
    });
  }

  // FOOTER INFO
  const footY = PH - FTR_H - MB - 8;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.slate3);

  doc.text(
    s(`Qualité données : ${syn.metadata.dataQualite} — Complétude : ${audit.completenessScore}%`),
    ML,
    footY,
  );

  doc.setTextColor(...SP.main);
  doc.text('www.mimmoza.fr', PW / 2, footY, { align: 'center' });

  doc.setTextColor(...C.slate3);
  doc.text(fmtDate(new Date()), PW - MR, footY, { align: 'right' });

  pageFooter(st);
}

function readRenduTravauxSyntheseFromStorage(): RenduTravauxSynthesePdf | null {
  try {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem('mimmoza.promoteur.renduTravaux.synthese.v1');
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RenduTravauxSynthesePdf>;

    if (!parsed.generatedImageUrl || typeof parsed.generatedImageUrl !== 'string') {
      return null;
    }

    return {
      id: parsed.id || `rendu-travaux-${Date.now()}`,
      sourceImageId: parsed.sourceImageId,
      sourcePreview: parsed.sourcePreview,
      generatedImageUrl: parsed.generatedImageUrl,
      prompt: parsed.prompt,
      generatedAt: parsed.generatedAt,
      durationMs: parsed.durationMs,
      configSnapshot: parsed.configSnapshot ?? null,
    };
  } catch (e) {
    console.warn('[exportPromoteurPdf] lecture rendu travaux synthese impossible:', e);
    return null;
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export interface ExportOptions {
  facadeRenderUrl?:        string;
  renduTravauxUrl?:        string;
  carteScreenshot?:        string;   // dataURL base64 PNG — carte cadastrale
  implantationScreenshot?: string;   // dataURL base64 PNG — implantation 2D
  massing3DScreenshot?:    string;   // dataURL base64 PNG — massing 3D relief
}

export interface ExportResult {
  success: boolean;
  audit: DocumentAudit;
  error?: string;
}

export async function exportPromoteurPdf(
  synthese: PromoteurSynthese,
  options?: ExportOptions,
): Promise<ExportResult> {
  const audit = auditSynthese(synthese);

  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setProperties({
      title:   s(`Mimmoza — ${synthese.executiveSummary.titreOperation}`),
      subject: s('Dossier comité d\'investissement'),
      author:  'Mimmoza',
      creator: s('Mimmoza — Intelligence Immobilière B2B'),
    });

    const st: St = {
      doc,
      p: 0,
      y: MT + HDR_H + 5,
      syn: synthese,
      audit,
      mc: buildMetricContext(synthese),
      tocEntries: [],
      facadeRenderUrl:        options?.facadeRenderUrl        ?? null,
      carteScreenshot:        options?.carteScreenshot        ?? null,
      implantationScreenshot: options?.implantationScreenshot ?? null,
      massing3DScreenshot:    options?.massing3DScreenshot    ?? null,
            renduTravauxSynthese:   options?.renduTravauxUrl
        ? {
            id: `rendu-travaux-${Date.now()}`,
            generatedImageUrl: options.renduTravauxUrl,
          }
        : readRenduTravauxSyntheseFromStorage(),
    };

    // ── Render pages ──────────────────────────────────────────────────────
    await addCover(st);

    newPage(st);
    const tocPageNumber = st.p;
    pageFooter(st);

    addExecSummary(st);
    addDataQuality(st);
    addProjet(st);
    addVisuels(st);       // ← Carte + Implantation 2D + Massing 3D + Façade IA
    addTechnique(st);
    addMarche(st);
    addFinancier(st);
    addFinancement(st);
    addRisques(st);
    addScenarios(st);
    addHypotheses(st);
    addSyntheseIA(st);
    addSources(st);
    await addRecommandation(st);

    // ── TOC ───────────────────────────────────────────────────────────────
    renderToc(st, tocPageNumber);

    // ── Save ──────────────────────────────────────────────────────────────
    const commune = s(synthese.projet.commune).replace(/\s/g, '_') || 'Projet';
    const cp      = synthese.projet.codePostal || '';
    doc.save(`Mimmoza_${commune}_${cp}_${new Date().toISOString().slice(0, 10)}.pdf`);

    return { success: true, audit };
  } catch (err) {
    console.error('[exportPromoteurPdf] Error:', err);
    return { success: false, audit, error: String(err) };
  }
}