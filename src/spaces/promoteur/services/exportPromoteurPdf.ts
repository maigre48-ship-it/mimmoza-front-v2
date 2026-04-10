// src/spaces/promoteur/services/exportPromoteurPdf.ts
// Promoteur PDF Export — v3 Corporate / Consulting (McKinsey-BCG style)
// Refactored: modular architecture, business validation, audit-driven rendering.

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
  facadeRenderUrl: string | null;
}

interface TocEntry {
  num: string;
  label: string;
  page: number;
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

// ── Cover page (async — awaits QR generation) ────────────────────────────────

async function addCover(st: St): Promise<void> {
  const { doc, syn, audit, mc } = st;
  const es = syn.executiveSummary;
  const status = audit.documentStatus;

  const V = {
    deep:    [72,  47,  135] as RGB,
    main:    [82,  71,  184] as RGB,
    med:     [124, 111, 205] as RGB,
    light:   [157, 141, 219] as RGB,
    pale:    [195, 182, 235] as RGB,
    ultra:   [225, 218, 245] as RGB,
    crystal: [240, 236, 250] as RGB,
  };

  doc.setFillColor(...C.white);
  doc.rect(0, 0, PW, PH, 'F');

  // ── Ribbons ───────────────────────────────────────────────────────────────

  drawRibbon(doc, {
    p0: [245, -10], p1: [210, 80],  p2: [130, 200],  p3: [45, 340],
    w0: 85, w1: 75, c0: V.crystal, c1: V.ultra,
  }, 140);

  drawRibbon(doc, {
    p0: [242, 10],  p1: [205, 105], p2: [140, 220],  p3: [60, 345],
    w0: 58, w1: 48, c0: V.ultra, c1: V.pale,
  }, 140);

  drawRibbon(doc, {
    p0: [258, 30],  p1: [218, 130], p2: [150, 240],  p3: [70, 350],
    w0: 44, w1: 32, c0: V.light, c1: V.med,
  }, 150);

  drawRibbon(doc, {
    p0: [232, -15], p1: [222, 95],  p2: [120, 195],  p3: [35, 330],
    w0: 38, w1: 28, c0: V.pale, c1: V.light,
  }, 140);

  drawRibbon(doc, {
    p0: [255, 45],  p1: [222, 145], p2: [160, 248],  p3: [80, 355],
    w0: 15, w1: 10, c0: V.main, c1: V.deep,
  }, 130);

  drawRibbon(doc, {
    p0: [252, 25],  p1: [215, 118], p2: [145, 228],  p3: [65, 342],
    w0: 5, w1: 3, c0: [240, 238, 252] as RGB, c1: V.crystal,
  }, 110);

  drawRibbon(doc, {
    p0: [242, -5],  p1: [220, 90],  p2: [125, 190],  p3: [40, 325],
    w0: 8, w1: 5, c0: V.med, c1: V.main,
  }, 110);

  // ── Text content ──────────────────────────────────────────────────────────

  const hx = 18;
  const hxR = PW - 18;

  // Header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.deep);
  doc.text('MIMMOZA', hx, 24);

  doc.setFontSize(F.sm);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate2);
  doc.text(s('Intelligence immobilière B2B'), hx, 31);

  doc.setFontSize(F.sm);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate2);
  doc.text(fmtDate(new Date()), hxR, 24, { align: 'right' });
  doc.setFontSize(F.xs);
  doc.setTextColor(...C.slate3);
  doc.text(s(`Réf. ${audit.documentId}`), hxR, 30, { align: 'right' });

  doc.setDrawColor(...V.pale);
  doc.setLineWidth(0.4);
  doc.line(hx, 36, hxR, 36);

  // Document type + title
  doc.setFontSize(F.body);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.main);
  doc.text(s(SP.label), hx, 50);

  doc.setFillColor(...V.main);
  doc.rect(hx, 52, 36, 0.6, 'F');

  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SP.deep);
  const opTitle = es.titreOperation || s(`${syn.projet.programmeType || 'Opération'}`);
  const titleLines = doc.splitTextToSize(s(opTitle), 120);
  doc.text(titleLines, hx, 68);
  const titleBottom = 68 + (titleLines.length - 1) * 10;

  const commune = syn.projet.commune || '';
  const cp = syn.projet.codePostal || '';
  const locLine = commune ? s(`${commune} (${cp})`) : s('Localisation non renseignée');
  doc.setFontSize(F.h3);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate);
  doc.text(locLine, hx, titleBottom + 10);

  // Decision block
  const decY = 205;
  const decW = 100;
  const decH = 46;

  doc.setFillColor(...C.white);
  doc.rect(hx - 2, decY - 3, decW + 6, decH + 6, 'F');

  const stCol: RGB = status === 'incomplete' ? C.red
    : status === 'provisional' ? C.amber
    : V.main;

  doc.setDrawColor(...C.slate4);
  doc.setLineWidth(0.3);
  doc.rect(hx, decY, decW, decH);
  doc.setFillColor(...stCol);
  doc.rect(hx, decY, 3, decH, 'F');

  doc.setFontSize(F.xs);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.slate2);
  doc.text('STATUT', hx + 8, decY + 8);

  doc.setFontSize(F.h3);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...stCol);
  doc.text(s(getCoverStatusLabel(status)), hx + 8, decY + 16);

  doc.setDrawColor(...C.slate5);
  doc.setLineWidth(0.15);
  doc.line(hx + 8, decY + 20, hx + decW - 8, decY + 20);

  doc.setFontSize(F.xs);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.slate2);
  doc.text('RECOMMANDATION', hx + 8, decY + 27);

  const recLabel = getCoverRecommendationLabel(status, audit.effectiveRecommendation);
  const recCol: RGB = status === 'incomplete' ? C.red : recColor(audit.effectiveRecommendation);
  doc.setFontSize(F.h4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...recCol);
  doc.text(s(recLabel), hx + 8, decY + 35);

  if (audit.recommendationOverridden) {
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...C.slate3);
    doc.text(
      s(`(initiale : ${REC_LABELS_SHORT[es.recommendation]})`),
      hx + 8, decY + 41,
    );
  }

  // KPIs
  const kpiX = hx;
  const kpiY = decY + decH + 10;
  const hasFin = mc.hasCA && mc.hasCDR;

  const kpis = [
    { l: 'MARGE',     v: hasFin && isMarginReliable(mc) ? pct(syn.financier.margeNettePercent) : 'N/A' },
    { l: 'TRN',       v: hasFin && isTrnReliable(mc) ? pct(syn.financier.trnRendement) : 'N/A' },
    { l: 'CA HT',     v: mc.hasCA ? eurM(syn.financier.chiffreAffairesTotal) : 'N/A' },
    { l: 'LOGEMENTS', v: mc.hasLots ? String(syn.projet.nbLogements) : 'N/A' },
  ];

  doc.setFillColor(...C.white);
  doc.rect(kpiX - 2, kpiY - 6, decW + 6, 20, 'F');

  const kpiColW = decW / kpis.length;
  kpis.forEach((kpi, i) => {
    const x = kpiX + i * kpiColW;
    const cx = x + kpiColW / 2;
    const isNA = kpi.v === 'N/A';

    doc.setFontSize(F.xs);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.slate3);
    doc.text(s(kpi.l), cx, kpiY, { align: 'center' });

    doc.setFontSize(F.h3);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(isNA ? C.slate3 : V.deep));
    doc.text(s(kpi.v), cx, kpiY + 8, { align: 'center' });
  });

  // Footer
  const ftY = PH - 30;

  doc.setFillColor(...C.white);
  doc.rect(hx - 4, ftY - 2, 140, 20, 'F');

  doc.setDrawColor(...C.slate4);
  doc.setLineWidth(0.2);
  doc.line(hx, ftY, hx + 115, ftY);

  doc.setFontSize(F.sm);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate2);
  const addr = s(syn.projet.adresse || 'Adresse non renseignée');
  doc.text(addr, hx, ftY + 6);
  if (commune) {
    doc.text(s(`${commune} (${cp})`), hx, ftY + 11);
  }

  doc.setFontSize(F.xs);
  doc.setTextColor(...C.slate3);
  doc.text(s('Document confidentiel — Usage interne'), PW / 2, ftY + 6, { align: 'center' });
  doc.text('www.mimmoza.fr', PW / 2, ftY + 11, { align: 'center' });

  // ── Vrai QR code scannable ────────────────────────────────────────────────
  const qrSize = 14;
  await drawQr(doc, hxR - qrSize, ftY + 2, qrSize, audit.documentId);

  // Bottom accent bar
  doc.setFillColor(...V.deep);
  doc.rect(0, PH - 2.5, PW, 2.5, 'F');

  st.p = 1;
  st.y = MT + HDR_H + 5;
}

// ============================================================================
// TABLE OF CONTENTS
// ============================================================================

function renderToc(st: St, tocPageNumber: number): void {
  const { doc, tocEntries } = st;
  doc.setPage(tocPageNumber);

  let y = MT + HDR_H + 20;

  doc.setFillColor(...SP.main);
  doc.rect(ML, y - 5, 3, 10, 'F');
  doc.setFontSize(F.h2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SP.deep);
  doc.text('SOMMAIRE', ML + 6, y + 3);
  doc.setFillColor(...C.slate5);
  doc.rect(ML, y + 6, CW, 0.3, 'F');
  y += 14;

  tocEntries.forEach(({ num, label, page }, idx) => {
    const bg = idx % 2 === 0 ? C.slate6 : C.white;
    doc.setFillColor(...bg);
    doc.rect(ML, y - 4, CW, 8, 'F');

    doc.setFontSize(F.body);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SP.main);
    doc.text(num, ML + 2, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.black);
    doc.text(s(label), ML + 14, y);

    doc.setTextColor(...C.slate4);
    let dx = ML + 14 + doc.getTextWidth(s(label)) + 3;
    const de = PW - MR - 14;
    while (dx < de) { doc.text('.', dx, y); dx += 2.5; }

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SP.deep);
    doc.text(String(page), PW - MR, y, { align: 'right' });
    y += 9;
  });

  const fy = PH - FTR_H;
  doc.setDrawColor(...C.slate4);
  doc.setLineWidth(0.3);
  doc.line(ML, fy, PW - MR, fy);
  doc.setFontSize(F.xs);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.slate3);
  doc.text(s('CONFIDENTIEL — Usage interne exclusif'), ML, fy + 5);
  doc.text(fmtDate(new Date()), PW - MR, fy + 5, { align: 'right' });
}

// ============================================================================
// 01 EXECUTIVE SUMMARY
// ============================================================================

function addExecSummary(st: St): void {
  newPage(st);
  tocRegister(st, '01', 'Executive Summary');
  const { syn, audit } = st;
  const es = syn.executiveSummary;

  secTitle(st, '01', 'EXECUTIVE SUMMARY');

  if (audit.documentStatus !== 'committee_ready') {
    alertBanner(st,
      DOC_STATUS_LABELS[audit.documentStatus],
      DOC_STATUS_COLORS[audit.documentStatus],
    );
  }

  const rc = recColor(audit.effectiveRecommendation);
  st.doc.setFillColor(...rc);
  st.doc.rect(ML, st.y, CW, 12, 'F');
  st.doc.setFillColor(...SP.main);
  st.doc.rect(ML, st.y, 3, 12, 'F');
  st.doc.setFontSize(F.h3);
  st.doc.setFont('helvetica', 'bold');
  st.doc.setTextColor(...C.white);
  st.doc.text(s(`RECOMMANDATION : ${REC_LABELS[audit.effectiveRecommendation]}`), PW / 2, st.y + 8, { align: 'center' });
  st.y += 16;

  if (audit.recommendationOverridden) {
    st.doc.setFontSize(F.sm);
    st.doc.setFont('helvetica', 'italic');
    st.doc.setTextColor(...C.amber);
    st.doc.text(
      s(`Note : recommandation ajustée de ${REC_LABELS_SHORT[es.recommendation]} en raison de données insuffisantes.`),
      ML, st.y,
    );
    st.y += 6;
  }

  body(st, generateExecMotif(audit, syn, st.mc));
  st.y += 3;

  const hasFin = syn.financier.chiffreAffairesTotal > 0 && syn.financier.coutRevientTotal > 0;
  kpiGrid(st, [
    { label: 'Marge nette',  value: hasFin ? pct(es.margeNette) : 'N/A',
      color: !hasFin ? C.slate3 : es.margeNette < 8 ? C.red : C.green,
      sub: hasFin ? eur(es.resultatNet) : undefined },
    { label: 'CA total HT',  value: es.caTotal > 0 ? eurM(es.caTotal) : 'N/A' },
    { label: 'TRN',          value: hasFin ? pct(es.trnRendement) : 'N/A',
      color: !hasFin ? C.slate3 : es.trnRendement < 8 ? C.red : C.green },
    { label: 'Score global', value: `${es.scores.global}/100` },
    { label: 'Logements',    value: syn.projet.nbLogements > 0 ? String(syn.projet.nbLogements) : 'N/A' },
    { label: s('Complétude'), value: `${audit.completenessScore}%`,
      color: audit.completenessScore >= 75 ? C.green : audit.completenessScore >= 50 ? C.amber : C.red },
  ], 3);

  subTitle(st, 'Scores par dimension');
  scoreLine(st, 'Foncier',          es.scores.foncier);
  scoreLine(st, 'Technique / PLU',  es.scores.technique);
  scoreLine(st, s('Marché'),        es.scores.marche);
  scoreLine(st, 'Financier',        es.scores.financier);
  scoreLine(st, s('Risque (inversé)'), es.scores.risque, true);
  st.y += 4;

  chk(st, 44);
  const half = CW / 2 - 4;
  const lx = ML, rx = ML + half + 8, sy = st.y;

  const safePointsForts = filterPointsForts(es.pointsForts, audit.documentStatus, st.mc);
  const displayPF = safePointsForts.length > 0 ? safePointsForts : [INCOMPLETE_NO_POINTS_FORTS];
  const pfIsEmpty = safePointsForts.length === 0;

  const pfH = 4 + displayPF.length * 5.5;
  st.doc.setFillColor(...C.slate6);
  st.doc.rect(lx, sy, half, pfH, 'F');
  st.doc.setFillColor(...(pfIsEmpty ? C.slate3 : C.green));
  st.doc.rect(lx, sy, 3, pfH, 'F');
  st.doc.setFontSize(F.sm);
  st.doc.setFont('helvetica', 'bold');
  st.doc.setTextColor(...(pfIsEmpty ? C.slate3 : C.green));
  st.doc.text('POINTS FORTS', lx + 7, sy + 6);
  let fy = sy + 12;
  displayPF.forEach(p => {
    st.doc.setFont('helvetica', pfIsEmpty ? 'italic' : 'normal');
    st.doc.setFontSize(F.sm);
    st.doc.setTextColor(...(pfIsEmpty ? C.slate2 : C.black));
    const prefix = pfIsEmpty ? '' : '+ ';
    const lines = st.doc.splitTextToSize(s(`${prefix}${p}`), half - 10);
    st.doc.text(lines, lx + 7, fy);
    fy += lines.length * 4.5;
  });

  const pvH = 4 + es.pointsVigilance.length * 5.5;
  st.doc.setFillColor(...C.slate6);
  st.doc.rect(rx, sy, half, pvH, 'F');
  st.doc.setFillColor(...C.amber);
  st.doc.rect(rx, sy, 3, pvH, 'F');
  st.doc.setFontSize(F.sm);
  st.doc.setFont('helvetica', 'bold');
  st.doc.setTextColor(...C.amber);
  st.doc.text('POINTS DE VIGILANCE', rx + 7, sy + 6);
  let vy = sy + 12;
  es.pointsVigilance.forEach(p => {
    st.doc.setFont('helvetica', 'normal');
    st.doc.setFontSize(F.sm);
    st.doc.setTextColor(...C.black);
    const lines = st.doc.splitTextToSize(s(`! ${p}`), half - 10);
    st.doc.text(lines, rx + 7, vy);
    vy += lines.length * 4.5;
  });
  st.y = Math.max(fy, vy) + 6;

  if (es.killSwitchesActifs.length > 0) {
    const ksH = 6 + es.killSwitchesActifs.length * 6;
    chk(st, 8 + ksH);
    st.doc.setFillColor(...C.redBg);
    st.doc.rect(ML, st.y, CW, ksH, 'F');
    st.doc.setFillColor(...C.red);
    st.doc.rect(ML, st.y, 3, ksH, 'F');
    st.doc.setFontSize(F.sm);
    st.doc.setFont('helvetica', 'bold');
    st.doc.setTextColor(...C.red);
    st.doc.text('POINTS BLOQUANTS', ML + 7, st.y + 6);
    st.y += 10;
    es.killSwitchesActifs.forEach(k => {
      st.doc.setFont('helvetica', 'normal');
      st.doc.text(s(`x  ${k}`), ML + 7, st.y);
      st.y += 6;
    });
    st.y += 4;
  }

  pageFooter(st);
}

// ============================================================================
// 02 DATA QUALITY & CONFIDENCE
// ============================================================================

function addDataQuality(st: St): void {
  newPage(st);
  tocRegister(st, '02', s('Qualité des données & niveau de confiance'));
  const { syn, audit } = st;

  secTitle(st, '02', s('QUALITÉ DES DONNÉES & NIVEAU DE CONFIANCE'));

  alertBanner(st,
    s(`Statut : ${DOC_STATUS_LABELS[audit.documentStatus]}`),
    DOC_STATUS_COLORS[audit.documentStatus],
  );

  kpiGrid(st, [
    { label: s('Complétude'), value: `${audit.completenessScore}%`,
      color: audit.completenessScore >= 75 ? C.green : audit.completenessScore >= 50 ? C.amber : C.red },
    { label: s('Qualité données'), value: s(syn.metadata.dataQualite),
      color: syn.metadata.dataQualite === 'HAUTE' ? C.green : syn.metadata.dataQualite === 'MOYENNE' ? C.amber : C.red },
    { label: 'Usage', value: s(audit.documentStatus === 'committee_ready' ? 'Comité' :
      audit.documentStatus === 'provisional' ? 'Pré-étude' : 'Brouillon'),
      color: DOC_STATUS_COLORS[audit.documentStatus] },
  ], 3);

  subTitle(st, s('Couverture par catégorie'));
  const cats = [
    { label: s('Données projet'),    ok: audit.flags.hasCriticalProjectData },
    { label: s('Données financières'), ok: audit.flags.hasCriticalFinancialData },
    { label: s('Données marché'),    ok: audit.flags.hasCriticalMarketData },
    { label: s('Données techniques'), ok: audit.flags.hasCriticalTechnicalData },
  ];

  cats.forEach(({ label, ok }) => {
    chk(st, 7);
    const { doc } = st;
    doc.setFillColor(...(ok ? C.green : C.red));
    doc.rect(ML, st.y - 2.5, 3, 3, 'F');
    doc.setTextColor(...C.black);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(F.body);
    doc.text(`${label} — ${ok ? 'Suffisante' : 'Insuffisante'}`, ML + 6, st.y);
    st.y += 6;
  });
  st.y += 4;

  if (audit.criticalMissingFields.length > 0) {
    subTitle(st, 'Champs manquants');
    body(st, audit.criticalMissingFields.join(', '), 2);
  }

  if (audit.blockingIssues.length > 0) {
    subTitle(st, s('Problèmes bloquants'));
    audit.blockingIssues.forEach(issue => body(st, s(`• ${issue}`), 4));
  }

  if (audit.warnings.length > 0) {
    subTitle(st, 'Avertissements');
    audit.warnings.forEach(w => body(st, s(`! ${w}`), 4));
  }

  pageFooter(st);
}

// ============================================================================
// 03 PROJET
// ============================================================================

function addProjet(st: St): void {
  newPage(st);
  tocRegister(st, '03', s('Présentation du projet'));
  const { syn } = st;
  const p = syn.projet;

  secTitle(st, '03', s('PRÉSENTATION DU PROJET'));

  autoTable(st.doc, {
    startY: st.y,
    head: [[s('Paramètre'), 'Valeur']],
    body: [
      ['Adresse',             s(p.adresse || 'Non renseignée')],
      ['Commune',             s(p.commune ? `${p.commune} (${p.codePostal})` : 'Non renseignée')],
      [s('Département'),      s(p.departement || 'N/A')],
      ['Type de programme',   s(p.programmeType || 'N/A')],
      ['Surface terrain',     m2v(p.surfaceTerrain)],
      ['Surface plancher',    m2v(p.surfacePlancher)],
      ['Nombre de logements', p.nbLogements > 0 ? String(p.nbLogements) : 'N/A'],
      [s('Date étude'),       fmtDate(p.dateEtude)],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontStyle: 'bold', fontSize: F.body },
    bodyStyles:         { fontSize: F.body, textColor: C.black },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'bold', cellWidth: 60, textColor: SP.deep } },
    margin:             { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 8;

  if (Object.keys(p.typologieMix).length > 0 && p.nbLogements > 0) {
    subTitle(st, 'Mix typologique');
    autoTable(st.doc, {
      startY: st.y,
      head: [['Typologie', 'Nb logements', '% du programme']],
      body: Object.entries(p.typologieMix).map(([t, n]) =>
        [s(t), String(n), pct((n / Math.max(p.nbLogements, 1)) * 100)]),
      theme: 'grid',
      headStyles: { fillColor: SP.main, textColor: C.white, fontSize: F.body },
      bodyStyles:  { fontSize: F.body },
      margin:      { left: ML, right: MR },
    });
    st.y = (st.doc as any).lastAutoTable.finalY + 8;
  }
  pageFooter(st);
}

// ============================================================================
// 03b FACADE RENDER (inserted after Projet when available)
// ============================================================================

function addFacadeRender(st: St): void {
  if (!st.facadeRenderUrl) return;

  try {
    newPage(st);

    secTitle(st, '', s('PERSPECTIVE FAÇADE'));

    const { doc } = st;
    const imgW = CW;
    const imgH = CW * 0.56;
    chk(st, imgH + 14);

    doc.addImage(st.facadeRenderUrl, 'PNG', ML, st.y, imgW, imgH);
    st.y += imgH + 5;

    doc.setFontSize(F.xs);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...C.slate3);
    doc.text(s('Image générée par Mimmoza — Générateur de façades'), PW / 2, st.y, { align: 'center' });
    st.y += 8;

    pageFooter(st);
  } catch (err) {
    console.warn('[exportPromoteurPdf] Facade image insertion failed:', err);
  }
}

// ============================================================================
// 04 TECHNIQUE
// ============================================================================

function addTechnique(st: St): void {
  newPage(st);
  tocRegister(st, '04', s('Faisabilité technique & PLU'));
  const { syn, audit } = st;
  const t = syn.technique;

  secTitle(st, '04', s('FAISABILITÉ TECHNIQUE & PLU'));

  const effectiveFais = getEffectiveFaisabilite(t.faisabiliteTechnique, audit.documentStatus, st.mc);

  const faisLabels: Record<string, { color: RGB; label: string }> = {
    CONFIRME:     { color: C.green, label: s('FAISABILITÉ CONFIRMÉE')     },
    SOUS_RESERVE: { color: C.amber, label: s('FAISABILITÉ SOUS RÉSERVE') },
    IMPOSSIBLE:   { color: C.red,   label: s('FAISABILITÉ IMPOSSIBLE')    },
  };
  const fc = faisLabels[effectiveFais] ?? faisLabels.SOUS_RESERVE;
  st.doc.setFillColor(...fc.color);
  st.doc.rect(ML, st.y, CW, 10, 'F');
  st.doc.setFillColor(...C.white);
  st.doc.rect(ML, st.y, 3, 10, 'F');
  st.doc.setFontSize(F.h4);
  st.doc.setFont('helvetica', 'bold');
  st.doc.setTextColor(...C.white);
  st.doc.text(fc.label, PW / 2, st.y + 7, { align: 'center' });
  st.y += 14;

  if (!st.mc.hasZonePlu) {
    alertBanner(st,
      s('Zone PLU non renseignée — faisabilité technique non confirmable'),
      C.red,
    );
  } else if (t.faisabiliteTechnique === 'CONFIRME' && effectiveFais !== 'CONFIRME') {
    alertBanner(st,
      s('Faisabilité rétrogradée : données techniques insuffisantes'),
      C.amber,
    );
  }

  autoTable(st.doc, {
    startY: st.y,
    head: [[s('Paramètre PLU'), s('Réglementaire'), 'Projet', 'Statut']],
    body: [
      ['Zone PLU',      s(t.zonePlu || 'N/A'), s(t.zonePlu || 'N/A'), t.zonePlu ? 'CONFORME' : 'N/D'],
      ['CUB',           t.cub != null ? String(t.cub) : 'N/D', 'N/D', 'N/D'],
      ['Hauteur max',   t.hauteurMax    != null ? `${t.hauteurMax} m`    : 'N/D',
                        t.hauteurProjet != null ? `${t.hauteurProjet} m` : 'N/D',
                        t.hauteurProjet && t.hauteurMax && t.hauteurProjet <= t.hauteurMax ? 'CONFORME' : s('À VÉRIFIER')],
      ['Recul voirie',  t.reculs.voirie != null ? `${t.reculs.voirie} m` : 'N/D', 'N/D', 'N/D'],
      ['Pleine terre',  t.pleineTerre   != null ? `${t.pleineTerre}%`    : 'N/D', 'N/D', 'N/D'],
      ['Niveaux',       'N/D', t.nbNiveaux != null ? `R+${t.nbNiveaux - 1}` : 'N/D', 'N/D'],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontSize: F.body },
    bodyStyles:         { fontSize: F.body },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'bold', cellWidth: 45, textColor: SP.deep } },
    didParseCell: (data) => {
      if (data.column.index === 3 && data.section === 'body') {
        const v = String(data.cell.raw);
        data.cell.styles.textColor = v === 'BLOQUANT' ? C.red : v === 'LIMITE' ? C.amber : v === 'CONFORME' ? C.green : C.slate2;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 6;

  if (t.contraintes.length > 0) {
    subTitle(st, 'Contraintes PLU');
    autoTable(st.doc, {
      startY: st.y,
      head: [[s('Règle'), 'Valeur', 'Statut']],
      body: t.contraintes.map(c => [s(c.libelle), String(c.valeur ?? 'N/D'), c.statut]),
      theme: 'grid',
      headStyles: { fillColor: SP.main, textColor: C.white, fontSize: F.body },
      bodyStyles:  { fontSize: F.sm },
      didParseCell: (data) => {
        if (data.column.index === 2 && data.section === 'body') {
          const v = String(data.cell.raw);
          data.cell.styles.textColor = v === 'BLOQUANT' ? C.red : v === 'LIMITE' ? C.amber : C.green;
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: ML, right: MR },
    });
    st.y = (st.doc as any).lastAutoTable.finalY + 6;
  }

  if (t.notesTechniques.length > 0) {
    subTitle(st, 'Notes techniques');
    t.notesTechniques.forEach(n => body(st, `- ${n}`, 4));
  }

  const techConclusion = generateTechniqueConclusion(audit.documentStatus, st.mc, syn);
  if (techConclusion) {
    st.y += 2;
    alertBanner(st, techConclusion, DOC_STATUS_COLORS[audit.documentStatus]);
  }

  pageFooter(st);
}

// ============================================================================
// 05 MARCHE
// ============================================================================

function addMarche(st: St): void {
  newPage(st);
  tocRegister(st, '05', s('Étude de marché'));
  const { syn } = st;
  const m = syn.marche;

  secTitle(st, '05', s('ÉTUDE DE MARCHÉ'));

  if (st.audit.documentStatus === 'incomplete' && !st.mc.hasDVF && !st.mc.hasPrixNeuf) {
    alertBanner(st, s('Analyse de marché non exploitable — données DVF et prix neuf absentes'), C.red);
  } else if (!st.audit.flags.hasCriticalMarketData) {
    alertBanner(st, s('Données marché partielles — conclusions non confirmées'), C.amber);
  }

  const posColor = Math.abs(m.positionPrix) > 10 ? C.red : Math.abs(m.positionPrix) > 5 ? C.amber : C.green;
  kpiGrid(st, [
    { label: 'Prix neuf moyen',    value: m.prixNeufMoyenM2 > 0 ? `${fmtNum(m.prixNeufMoyenM2)} EUR/m²` : 'N/A' },
    { label: 'Prix projet',        value: m.prixProjetM2 > 0 ? `${fmtNum(m.prixProjetM2)} EUR/m²` : 'N/A' },
    { label: s('Position vs marché'),
      value: m.prixProjetM2 > 0 && m.prixNeufMoyenM2 > 0 ? `${m.positionPrix > 0 ? '+' : ''}${pct(m.positionPrix)}` : 'N/A',
      color: m.prixProjetM2 > 0 ? posColor : C.slate3 },
    { label: 'Prix ancien moyen',  value: m.prixAncienMoyenM2 > 0 ? `${fmtNum(m.prixAncienMoyenM2)} EUR/m²` : 'N/A' },
    { label: 'Prime neuf',         value: m.prixNeufMoyenM2 > 0 && m.prixAncienMoyenM2 > 0 ? pct(m.primiumNeuf) : 'N/A' },
    { label: s('Zone marché'),     value: s(m.zoneMarche.replace('_', ' ')) },
  ], 3);

  const hasDvf = (m.transactionsRecentes.nbTransactions ?? 0) > 0;
  autoTable(st.doc, {
    startY: st.y,
    head: [['Indicateur', 'Valeur', 'Source']],
    body: [
      ['Transactions DVF',       hasDvf ? String(m.transactionsRecentes.nbTransactions) : 'N/A', s(m.transactionsRecentes.source || 'DVF')],
      ['Prix moyen DVF',         hasDvf ? `${fmtNum(m.transactionsRecentes.prixMoyenM2)} EUR/m²` : 'N/A', hasDvf ? s(`Période ${m.transactionsRecentes.periode}`) : ''],
      ['Prix min DVF',           hasDvf ? `${fmtNum(m.transactionsRecentes.prixMin)} EUR/m²` : 'N/A', ''],
      ['Prix max DVF',           hasDvf ? `${fmtNum(m.transactionsRecentes.prixMax)} EUR/m²` : 'N/A', ''],
      ['Programmes concurrents', m.offreConcurrente > 0 ? String(m.offreConcurrente) : 'N/A', s('Marché local')],
      ['Absorption mensuelle',   m.absorptionMensuelle != null ? `${m.absorptionMensuelle} ventes/mois` : 'N/A', 'Estimation'],
      [s('Délai écoulement'),    m.delaiEcoulementMois != null ? `${m.delaiEcoulementMois} mois` : 'N/A', s('Calculé')],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontSize: F.body },
    bodyStyles:         { fontSize: F.body },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'bold', cellWidth: 55, textColor: SP.deep } },
    margin:             { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 6;

  if (m.demographieIndicateurs.length > 0) {
    subTitle(st, s('Indicateurs démographiques'));
    autoTable(st.doc, {
      startY: st.y,
      head: [['Indicateur', 'Valeur', s('Évolution'), 'Source']],
      body: m.demographieIndicateurs.map(d => [s(d.label), String(d.valeur), s(d.evolution ?? 'N/A'), s(d.source)]),
      theme: 'grid',
      headStyles: { fillColor: SP.main, textColor: C.white, fontSize: F.body },
      bodyStyles:  { fontSize: F.sm },
      margin:      { left: ML, right: MR },
    });
    st.y = (st.doc as any).lastAutoTable.finalY + 6;
  }

  if (m.notesMarcheLibre.length > 0) {
    subTitle(st, s('Points de vigilance marché'));
    m.notesMarcheLibre.forEach(n => body(st, `! ${n}`, 4));
  }

  const marcheConclusion = generateMarcheConclusion(st.audit.documentStatus, st.mc);
  if (marcheConclusion) {
    st.y += 2;
    alertBanner(st, marcheConclusion, DOC_STATUS_COLORS[st.audit.documentStatus]);
  }

  pageFooter(st);
}

// ============================================================================
// 06 FINANCIER
// ============================================================================

function addFinancier(st: St): void {
  newPage(st);
  tocRegister(st, '06', s('Analyse financière'));
  const { syn } = st;
  const f = syn.financier;

  secTitle(st, '06', s('ANALYSE FINANCIÈRE'));

  const hasCA  = f.chiffreAffairesTotal > 0;
  const hasCDR = f.coutRevientTotal > 0;

  if (!hasCA || !hasCDR) {
    alertBanner(st,
      st.audit.documentStatus === 'incomplete'
        ? s('Analyse financière non exploitable — données critiques absentes')
        : s('Données financières insuffisantes — ratios non calculables'),
      C.red,
    );
  }

  autoTable(st.doc, {
    startY: st.y,
    head: [['Poste', 'Montant HT', '% CA']],
    body: [
      [s("Chiffre d'affaires total HT"), hasCA ? eur(f.chiffreAffairesTotal) : 'N/A', '100%'],
      [s('Coût foncier'),                eur(f.coutFoncier),            hasCA ? safePct(f.coutFoncier, f.chiffreAffairesTotal) : 'N/A'],
      [s('Coût travaux'),                eur(f.coutTravaux),            hasCA ? safePct(f.coutTravaux, f.chiffreAffairesTotal) : 'N/A'],
      ['Frais financiers',               eur(f.coutFinanciers),         hasCA ? safePct(f.coutFinanciers, f.chiffreAffairesTotal) : 'N/A'],
      ['Frais commercialisation',        eur(f.fraisCommercialisation), hasCA ? safePct(f.fraisCommercialisation, f.chiffreAffairesTotal) : 'N/A'],
      [s('Frais de gestion / études'),   eur(f.fraisGestion),           hasCA ? safePct(f.fraisGestion, f.chiffreAffairesTotal) : 'N/A'],
      ...f.autresCouts.map(c => [s(c.libelle), eur(c.montantHT), pct(c.pourcentageCA)]),
      [s('COÛT DE REVIENT TOTAL'),       hasCDR ? eur(f.coutRevientTotal) : 'N/A', hasCA ? safePct(f.coutRevientTotal, f.chiffreAffairesTotal) : 'N/A'],
      ['MARGE NETTE',                    hasCA && hasCDR ? eur(f.margeNette) : 'N/A', hasCA && hasCDR ? pct(f.margeNettePercent) : 'N/A'],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontStyle: 'bold', fontSize: F.body },
    bodyStyles:         { fontSize: F.body },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'normal', cellWidth: 80 } },
    didParseCell: (data) => {
      const last = data.table.body.length - 1;
      const prev = data.table.body.length - 2;
      if (data.section === 'body' && data.row.index === last) {
        data.cell.styles.fillColor = SP.deep;
        data.cell.styles.textColor = C.white;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.row.index === prev) {
        data.cell.styles.fillColor = C.slate5;
        data.cell.styles.textColor = SP.deep;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 6;

  const hasSDP = syn.projet.surfacePlancher > 0;
  kpiGrid(st, [
    { label: s('CA / m²'),              value: hasSDP && hasCA ? `${fmtNum(f.chiffreAffairesM2)} EUR/m²` : 'N/A' },
    { label: s('Coût revient / m²'),    value: hasSDP && hasCDR ? `${fmtNum(f.coutRevientM2)} EUR/m²` : 'N/A' },
    { label: s('Travaux / m²'),         value: hasSDP && f.coutTravaux > 0 ? `${fmtNum(f.coutTravauxM2)} EUR/m²` : 'N/A' },
    { label: s('Marge opérationnelle'), value: hasCA && hasCDR ? pct(f.margeOperationnellePercent) : 'N/A',
      color: hasCA && hasCDR ? (f.margeOperationnellePercent < 15 ? C.amber : C.green) : C.slate3 },
    { label: 'TRN',                     value: hasCA && hasCDR ? pct(f.trnRendement) : 'N/A',
      color: hasCA && hasCDR ? (f.trnRendement < 8 ? C.red : C.green) : C.slate3 },
    { label: 'Ratio foncier/CA',        value: hasCA ? pct(f.bilancielRatio) : 'N/A' },
  ], 3);

  const finConclusion = generateFinancierConclusion(st.audit.documentStatus, st.mc, syn);
  if (finConclusion) {
    st.y += 2;
    alertBanner(st, finConclusion, DOC_STATUS_COLORS[st.audit.documentStatus]);
  }

  pageFooter(st);
}

// ============================================================================
// 07 FINANCEMENT
// ============================================================================

function addFinancement(st: St): void {
  newPage(st);
  tocRegister(st, '07', 'Plan de financement');
  const { syn } = st;
  const fin = syn.financement;

  secTitle(st, '07', 'PLAN DE FINANCEMENT');

  if (st.audit.documentStatus === 'incomplete' && !st.mc.hasCA) {
    alertBanner(st, s('Plan de financement non exploitable — chiffre d\'affaires absent'), C.red);
  }

  autoTable(st.doc, {
    startY: st.y,
    head: [[s('Paramètre'), 'Valeur']],
    body: [
      ['Fonds propres requis',               fin.fondsPropresRequis > 0 ? `${eur(fin.fondsPropresRequis)} (${pct(fin.fondsPropresPercent)})` : 'N/A'],
      [s('Crédit promoteur'),                fin.creditPromoteurMontant > 0 ? `${eur(fin.creditPromoteurMontant)} — ${fin.creditPromoteurDuree} mois` : 'N/A'],
      [s('Taux crédit estimé'),              fin.tauxCredit > 0 ? pct(fin.tauxCredit) : 'N/A'],
      [s('Ratio fonds propres / coût revient'), pct(fin.ratioFondsPropres)],
      [s('Préfinancement VEFA requis'),      pct(fin.prefinancementVentes)],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontSize: F.body },
    bodyStyles:         { fontSize: F.body },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'bold', cellWidth: 80, textColor: SP.deep } },
    margin:             { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 8;

  subTitle(st, 'Garanties requises');
  if (fin.garantiesRequises.length > 0) {
    fin.garantiesRequises.forEach(g => body(st, `- ${g}`, 4));
  } else {
    body(st, s('Aucune garantie spécifiée.'), 4);
  }

  if (fin.notesBancaires.length > 0) {
    st.y += 2;
    subTitle(st, 'Notes bancaires');
    fin.notesBancaires.forEach(n => body(st, `! ${n}`, 4));
  }
  pageFooter(st);
}

// ============================================================================
// 08 RISQUES
// ============================================================================

function addRisques(st: St): void {
  newPage(st);
  tocRegister(st, '08', 'Analyse des risques');
  const { syn } = st;

  secTitle(st, '08', 'ANALYSE DES RISQUES');

  if (syn.risques.length === 0) {
    if (st.audit.documentStatus === 'incomplete') {
      alertBanner(st, s('Analyse des risques non réalisée — données insuffisantes'), C.red);
      body(st, s('L\'absence de risques identifiés sur un dossier incomplet ne signifie pas l\'absence de risques. L\'analyse des risques doit être conduite après complétion des données projet, financières et techniques.'));
    } else {
      alertBanner(st, s('Aucun risque identifié — analyse potentiellement incomplète'), C.amber);
      body(st, s('L\'absence de risques identifiés peut indiquer une analyse incomplète. Il est recommandé de compléter l\'étude avant présentation en comité.'));
    }
    pageFooter(st);
    return;
  }

  autoTable(st.doc, {
    startY: st.y,
    head: [['Risque', s('Catégorie'), 'Niveau', 'Prob.', 'Impact', 'Mitigation', 'KS']],
    body: syn.risques.map((r: RisqueItem) => [
      s(r.libelle.length > 45 ? r.libelle.slice(0, 42) + '...' : r.libelle),
      s(r.categorie), r.niveau,
      `${Math.round(r.probabilite * 100)}%`,
      `${Math.round(r.impact * 100)}%`,
      s(r.mitigation.length > 60 ? r.mitigation.slice(0, 57) + '...' : r.mitigation),
      r.isKillSwitch ? 'OUI' : '',
    ]),
    theme: 'grid',
    headStyles: { fillColor: SP.deep, textColor: C.white, fontSize: F.sm, fontStyle: 'bold' },
    bodyStyles:  { fontSize: F.sm, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 40 }, 2: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 10, halign: 'center' }, 4: { cellWidth: 10, halign: 'center' },
      5: { cellWidth: 52 }, 6: { cellWidth: 10, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.column.index === 2 && data.section === 'body')
        data.cell.styles.textColor = risqueColor(String(data.cell.raw) as RisqueNiveau);
      if (data.column.index === 6 && data.section === 'body' && String(data.cell.raw) === 'OUI') {
        data.cell.styles.textColor = C.red;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 6;

  const critiques = syn.risques.filter(r => r.niveau === 'CRITIQUE').length;
  const eleves    = syn.risques.filter(r => r.niveau === 'ELEVE').length;
  kpiGrid(st, [
    { label: 'Total',         value: String(syn.risques.length) },
    { label: 'Critiques',     value: String(critiques), color: critiques > 0 ? C.red : C.green },
    { label: s('Élevés'),     value: String(eleves),    color: eleves > 0 ? C.amber : C.green },
    { label: 'Kill switches', value: String(syn.risques.filter(r => r.isKillSwitch).length) },
    { label: s('Modérés'),    value: String(syn.risques.filter(r => r.niveau === 'MODERE').length) },
    { label: 'Faibles',       value: String(syn.risques.filter(r => r.niveau === 'FAIBLE').length), color: C.green },
  ], 3);

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
  const { syn } = st;

  secTitle(st, '09', s('SCÉNARIOS DE SENSIBILITÉ'));

  if (suppression) {
    alertBanner(st, s('Scénarios non exploitables — hypothèses insuffisantes'), C.red);
    body(st, suppression);
    pageFooter(st);
    return;
  }

  autoTable(st.doc, {
    startY: st.y,
    head: [[s('Scénario'), 'Prix vente', 'Travaux', 'Absorption', s('Taux crédit'), 'Marge nette', 'TRN', 'Avis']],
    body: syn.scenarios.map((sc: Scenario) => [
      s(sc.libelle),
      `${fmtNum(sc.hypotheses.prixVenteM2)} EUR`,
      `${fmtNum(sc.hypotheses.coutTravauxM2)} EUR`,
      `${sc.hypotheses.tauxAbsorption} mois`,
      pct(sc.hypotheses.tauxCredit),
      pct(sc.resultat.margeNettePercent),
      pct(sc.resultat.trnRendement),
      REC_LABELS_SHORT[sc.resultat.recommendation],
    ]),
    theme: 'grid',
    headStyles: { fillColor: SP.deep, textColor: C.white, fontSize: F.sm },
    bodyStyles:  { fontSize: F.sm },
    columnStyles: { 0: { cellWidth: 35, fontStyle: 'bold' }, 5: { fontStyle: 'bold' }, 7: { fontStyle: 'bold', halign: 'center' } },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const sc = syn.scenarios[data.row.index];
        if (!sc) return;
        if (data.column.index === 0) {
          data.cell.styles.textColor = sc.type === 'OPTIMISTE' ? C.green : sc.type === 'BASE' ? SP.deep : sc.type === 'PESSIMISTE' ? C.amber : C.red;
        }
        if (data.column.index === 5) {
          const m = sc.resultat.margeNettePercent;
          data.cell.styles.textColor = m < 8 ? C.red : m < 12 ? C.amber : C.green;
        }
        if (data.column.index === 7) {
          data.cell.styles.textColor = recColor(sc.resultat.recommendation);
        }
      }
    },
    margin: { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 8;

  if (st.audit.documentStatus === 'provisional') {
    body(st, s("Les scénarios ci-dessus reposent sur des données partielles. Leurs résultats sont à interpréter avec prudence et à revalider après complétion du dossier."));
  } else {
    body(st, s("Le scénario de stress teste la résilience de l'opération dans des conditions dégradées cumulées. Une marge positive en scénario stress confirme la robustesse de l'opération."));
  }
  pageFooter(st);
}

// ============================================================================
// 10 HYPOTHESES
// ============================================================================

function addHypotheses(st: St): void {
  newPage(st);
  tocRegister(st, '10', s('Hypothèses de calcul'));
  const { syn } = st;
  const f = syn.financier;
  const m = syn.marche;
  const fin = syn.financement;

  secTitle(st, '10', s('HYPOTHÈSES DE CALCUL'));

  if (st.audit.documentStatus === 'incomplete') {
    alertBanner(st, s('Hypothèses incomplètes — de nombreux paramètres ne sont pas renseignés'), C.red);
    body(st, s('Les hypothèses ci-dessous sont présentées en l\'état. Les valeurs manquantes doivent être complétées avant toute exploitation du bilan.'));
  } else if (st.audit.documentStatus === 'provisional') {
    body(st, s('Ce tableau récapitule les hypothèses structurantes retenues pour le bilan promoteur. Certaines valeurs restent à confirmer.'));
  } else {
    body(st, s('Ce tableau récapitule les hypothèses structurantes retenues pour le bilan promoteur et l\'analyse de sensibilité.'));
  }
  st.y += 2;

  const hasSDP = syn.projet.surfacePlancher > 0;
  const hasCA  = f.chiffreAffairesTotal > 0;

  autoTable(st.doc, {
    startY: st.y,
    head: [[s('Hypothèse'), 'Valeur retenue', 'Commentaire']],
    body: [
      [s('Prix de vente moyen /m²'),   m.prixProjetM2 > 0 ? `${fmtNum(m.prixProjetM2)} EUR/m²` : 'N/A',        s('Prix moyen pondéré sortie')],
      [s('Coût travaux /m²'),          hasSDP && f.coutTravaux > 0 ? `${fmtNum(f.coutTravauxM2)} EUR/m²` : 'N/A', s('Hors fondations spéciales')],
      [s('Coût foncier'),              f.coutFoncier > 0 ? eur(f.coutFoncier) : 'N/A',                              s('Acquisition + frais notaire')],
      [s('Durée opération estimée'),   fin.creditPromoteurDuree > 0 ? `${fin.creditPromoteurDuree} mois` : 'N/A',  s('Permis à livraison')],
      [s('Taux crédit promoteur'),     fin.tauxCredit > 0 ? pct(fin.tauxCredit) : 'N/A',                            s('Taux indicatif')],
      ['Absorption',                   m.absorptionMensuelle != null ? `${m.absorptionMensuelle} ventes/mois` : 'N/A', 'Estimation locale'],
      [s('Délai écoulement'),          m.delaiEcoulementMois != null ? `${m.delaiEcoulementMois} mois` : 'N/A',    s('Basé sur absorption')],
      ['Frais commercialisation',      hasCA ? safePct(f.fraisCommercialisation, f.chiffreAffairesTotal) : 'N/A',    '% du CA HT'],
      ['Frais de gestion',             hasCA ? safePct(f.fraisGestion, f.chiffreAffairesTotal) : 'N/A',              '% du CA HT'],
      [s('Préfinancement VEFA'),       pct(fin.prefinancementVentes),                                                s('Seuil de déblocage crédit')],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontSize: F.body },
    bodyStyles:         { fontSize: F.body },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'bold', cellWidth: 55, textColor: SP.deep }, 2: { textColor: C.slate2, fontStyle: 'italic' } },
    margin:             { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 6;

  pageFooter(st);
}

// ============================================================================
// 11 SYNTHESE IA
// ============================================================================

function addSyntheseIA(st: St): void {
  if (!shouldShowSyntheseIA(st.audit.documentStatus, st.syn)) return;

  const ia = st.syn.syntheseIA!;
  const status = st.audit.documentStatus;

  const sections = [
    { t: s('Résumé exécutif'),     c: filterSyntheseIA(ia.texteExecutif, 'executif', status, st.mc) },
    { t: s('Analyse de marché'),   c: filterSyntheseIA(ia.analyseMarche, 'marche', status, st.mc) },
    { t: 'Analyse technique',      c: filterSyntheseIA(ia.analyseTechnique, 'technique', status, st.mc) },
    { t: s('Analyse financière'),  c: filterSyntheseIA(ia.analyseFinanciere, 'financiere', status, st.mc) },
    { t: 'Analyse des risques',    c: filterSyntheseIA(ia.analyseRisques, 'risques', status, st.mc) },
  ].filter(sec => sec.c != null);

  if (sections.length === 0) return;

  newPage(st);
  tocRegister(st, '11', s('Synthèse analytique'));

  secTitle(st, '11', s('SYNTHÈSE ANALYTIQUE'));

  if (status === 'provisional') {
    alertBanner(st,
      s('Synthèse générée sur données partielles — conclusions à confirmer'),
      C.amber,
    );
  }

  sections.forEach(sec => {
    subTitle(st, sec.t);
    body(st, sec.c!);
    st.y += 3;
  });

  pageFooter(st);
}

// ============================================================================
// 12 SOURCES
// ============================================================================

function addSources(st: St): void {
  newPage(st);
  tocRegister(st, '12', s('Sources & fraîcheur des données'));
  const { syn } = st;

  secTitle(st, '12', s('SOURCES & FRAÎCHEUR DES DONNÉES'));

  autoTable(st.doc, {
    startY: st.y,
    head: [['Source', s('Détail'), s('Fraîcheur')]],
    body: [
      ['Foncier',     s(syn.metadata.sourceFoncier || 'N/A'),  s('Selon date de l\'étude')],
      ['PLU',         s(syn.metadata.sourcePlu || 'N/A'),      s('Règlement en vigueur')],
      [s('Marché'),   s(syn.metadata.sourceMarche || 'N/A'),   s(syn.marche.transactionsRecentes.periode || 'N/A')],
      ['DVF',         s('data.gouv.fr — DVF+'),                s(syn.marche.transactionsRecentes.periode || 'N/A')],
      [s('Démographie'), 'INSEE',                              s('Dernier recensement disponible')],
      [s('Génération'), s(`Mimmoza — ${fmtDate(new Date())}`), s(`${fmtDate(new Date())} à ${fmtTime()}`)],
    ],
    theme: 'striped',
    headStyles:         { fillColor: SP.deep, textColor: C.white, fontSize: F.body },
    bodyStyles:         { fontSize: F.body },
    alternateRowStyles: { fillColor: C.slate6 },
    columnStyles:       { 0: { fontStyle: 'bold', cellWidth: 40, textColor: SP.deep } },
    margin:             { left: ML, right: MR },
  });
  st.y = (st.doc as any).lastAutoTable.finalY + 8;

  if (syn.metadata.avertissements.length > 0) {
    subTitle(st, 'Avertissements');
    syn.metadata.avertissements.forEach(a => body(st, s(`! ${a}`), 4));
  }

  pageFooter(st);
}

// ============================================================================
// 13 RECOMMANDATION FINALE
// ============================================================================

async function addRecommandation(st: St): Promise<void> {
  newPage(st);
  tocRegister(st, '13', 'Recommandation finale');
  const { syn, audit } = st;
  const es = syn.executiveSummary;

  secTitle(st, '13', 'RECOMMANDATION FINALE');

  if (audit.documentStatus !== 'committee_ready') {
    alertBanner(st,
      DOC_STATUS_LABELS[audit.documentStatus],
      DOC_STATUS_COLORS[audit.documentStatus],
    );
  }

  const rc = recColor(audit.effectiveRecommendation);
  st.doc.setFillColor(...rc);
  st.doc.rect(ML, st.y, CW, 16, 'F');
  st.doc.setFillColor(...SP.main);
  st.doc.rect(ML, st.y, 4, 16, 'F');
  st.doc.setFontSize(F.h1);
  st.doc.setFont('helvetica', 'bold');
  st.doc.setTextColor(...C.white);
  st.doc.text(s(REC_LABELS[audit.effectiveRecommendation]), PW / 2, st.y + 11, { align: 'center' });
  st.y += 20;

  if (audit.recommendationOverridden) {
    st.doc.setFontSize(F.sm);
    st.doc.setFont('helvetica', 'italic');
    st.doc.setTextColor(...C.amber);
    st.doc.text(
      s(`Recommandation initiale : ${REC_LABELS_SHORT[es.recommendation]} — ajustée pour insuffisance de données.`),
      ML, st.y,
    );
    st.y += 8;
  }

  body(st, generateFinalRecommendationText(audit, syn, st.mc));
  st.y += 2;

  const iaConclusion = generateFinalIAConclusion(audit, syn);
  if (iaConclusion) {
    subTitle(st, 'Conclusion analytique');
    body(st, iaConclusion);
    st.y += 4;
  }

  if (audit.effectiveRecommendation === 'GO_CONDITION' && es.pointsVigilance.length > 0) {
    subTitle(st, s("Conditions préalables à l'engagement"));
    es.pointsVigilance.forEach(p => body(st, `- ${p}`, 4));
  }

  if ((audit.effectiveRecommendation === 'NO_GO' || audit.effectiveRecommendation === 'GO_CONDITION') && es.killSwitchesActifs.length > 0) {
    subTitle(st, s('Points bloquants à lever impérativement'));
    es.killSwitchesActifs.forEach(k => body(st, s(`x  ${k}`), 4));
  }

  if (audit.documentStatus === 'incomplete') {
    st.y += 4;
    chk(st, 20);
    st.doc.setFillColor(...C.redBg);
    st.doc.rect(ML, st.y, CW, 16, 'F');
    st.doc.setFillColor(...C.red);
    st.doc.rect(ML, st.y, 4, 16, 'F');
    st.doc.setFontSize(F.h4);
    st.doc.setFont('helvetica', 'bold');
    st.doc.setTextColor(...C.red);
    st.doc.text(
      s('Ce dossier ne peut pas être présenté en comité en l\'état.'),
      ML + 8, st.y + 7,
    );
    st.doc.setFontSize(F.sm);
    st.doc.setFont('helvetica', 'normal');
    st.doc.text(
      s('Compléter les données manquantes avant toute présentation.'),
      ML + 8, st.y + 13,
    );
    st.y += 20;
  }

  st.y += 4;
  rule(st);

  st.doc.setFontSize(F.xs);
  st.doc.setTextColor(...C.slate3);
  st.doc.setFont('helvetica', 'italic');
  st.doc.text(
    s(`Qualité données : ${syn.metadata.dataQualite} — Complétude : ${audit.completenessScore}% — Statut : ${DOC_STATUS_LABELS[audit.documentStatus]}`),
    ML, st.y,
  );
  st.y += 8;

  // ── Vrai QR code scannable (grand, centré) ────────────────────────────────
  chk(st, 50);
  const qrSize = 28;
  await drawQr(st.doc, PW / 2 - qrSize / 2, st.y, qrSize, audit.documentId);
  st.doc.setFontSize(F.sm);
  st.doc.setFont('helvetica', 'italic');
  st.doc.setTextColor(...SP.main);
  st.doc.text('www.mimmoza.fr', PW / 2, st.y + qrSize + 12, { align: 'center' });
  st.doc.setTextColor(...C.slate3);
  st.doc.text(
    s(`Généré le ${fmtDate(new Date())} à ${fmtTime()}`),
    PW / 2, st.y + qrSize + 17, { align: 'center' },
  );
  st.y += qrSize + 22;

  pageFooter(st);
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export interface ExportOptions {
  facadeRenderUrl?: string;
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
      facadeRenderUrl: options?.facadeRenderUrl ?? null,
    };

    // ── Render pages ──────────────────────────────────────────────────────
    await addCover(st);

    newPage(st);
    const tocPageNumber = st.p;
    pageFooter(st);

    addExecSummary(st);
    addDataQuality(st);
    addProjet(st);
    addFacadeRender(st);
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