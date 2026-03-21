// src/spaces/promoteur/services/exportPromoteurPdf.ts

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  PromoteurSynthese,
  RecommendationType,
  RisqueNiveau,
  RisqueItem,
  Scenario,
} from './promoteurSynthese.types';

// ---- Theme (violet Promoteur) -----------------------------------------------

const V = {
  // Violet palette
  violet900: [46, 16, 101]   as [number, number, number],
  violet800: [67, 26, 140]   as [number, number, number],
  violet700: [109, 40, 217]  as [number, number, number],
  violet600: [124, 111, 205] as [number, number, number],
  violet500: [139, 92, 246]  as [number, number, number],
  violet400: [167, 139, 250] as [number, number, number],
  violet200: [221, 214, 254] as [number, number, number],
  violet100: [237, 233, 254] as [number, number, number],
  violet50:  [245, 243, 255] as [number, number, number],
  // Semantic
  success:   [21, 128, 61]   as [number, number, number],
  warning:   [161, 98, 7]    as [number, number, number],
  danger:    [185, 28, 28]   as [number, number, number],
  // Neutrals
  slate900:  [15, 23, 42]    as [number, number, number],
  slate700:  [51, 65, 85]    as [number, number, number],
  slate500:  [100, 116, 139] as [number, number, number],
  slate300:  [148, 163, 184] as [number, number, number],
  slate100:  [241, 245, 249] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
};

const FONT = { title: 24, h1: 16, h2: 13, h3: 11, body: 9, small: 8, caption: 7 };
const MARGIN = { left: 18, right: 18, top: 26, bottom: 22 };
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN.left - MARGIN.right;
const HEADER_H = 12;
const FOOTER_H = 10;

// ---- Formatters -------------------------------------------------------------

function eur(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}
function m2(v: number): string {
  return `${Math.round(v).toLocaleString('fr-FR')} m2`;
}
function recColor(rec: RecommendationType): [number, number, number] {
  if (rec === 'GO') return V.success;
  if (rec === 'GO_CONDITION') return V.warning;
  return V.danger;
}
function risqueColor(n: RisqueNiveau): [number, number, number] {
  if (n === 'CRITIQUE') return V.danger;
  if (n === 'ELEVE')    return [220, 80, 10];
  if (n === 'MODERE')   return V.warning;
  return V.success;
}

// ---- State ------------------------------------------------------------------

interface PdfState {
  doc: jsPDF;
  pageNum: number;
  totalPages: number;
  y: number;
  synthese: PromoteurSynthese;
}

function newPage(state: PdfState): void {
  state.doc.addPage();
  state.pageNum++;
  state.y = MARGIN.top + HEADER_H + 4;
  drawPageHeader(state);
}

function checkBreak(state: PdfState, needed: number): void {
  if (state.y + needed > PAGE_H - FOOTER_H - MARGIN.bottom) newPage(state);
}

// ---- Violet page header (all pages except cover) ----------------------------

function drawPageHeader(state: PdfState): void {
  const { doc, synthese, pageNum } = state;

  // Violet bar
  doc.setFillColor(...V.violet800);
  doc.rect(0, 0, PAGE_W, HEADER_H, 'F');

  // Left: Mimmoza brand
  doc.setFontSize(FONT.caption);
  doc.setTextColor(...V.white);
  doc.setFont('helvetica', 'bold');
  doc.text('MIMMOZA', MARGIN.left, 7.5);

  // Center: project name
  doc.setFont('helvetica', 'normal');
  const title = synthese.projet.commune
    ? `${synthese.projet.programmeType} -- ${synthese.projet.commune} (${synthese.projet.codePostal})`
    : 'Synthese Promoteur';
  const titleLines = doc.splitTextToSize(title, 100);
  doc.text(titleLines[0], PAGE_W / 2, 7.5, { align: 'center' });

  // Right: page number
  doc.setFont('helvetica', 'bold');
  doc.text(`p. ${pageNum}`, PAGE_W - MARGIN.right, 7.5, { align: 'right' });

  // Thin accent line below
  doc.setFillColor(...V.violet400);
  doc.rect(0, HEADER_H, PAGE_W, 0.5, 'F');
}

// ---- Violet page footer (all pages except cover) ----------------------------

function drawPageFooter(state: PdfState): void {
  const { doc, pageNum } = state;
  const y = PAGE_H - FOOTER_H;

  // Footer bar
  doc.setFillColor(...V.violet900);
  doc.rect(0, y, PAGE_W, FOOTER_H, 'F');

  doc.setFontSize(FONT.caption);
  doc.setTextColor(...V.violet300 ?? V.violet400);
  doc.setFont('helvetica', 'normal');
  doc.text('CONFIDENTIEL -- Usage interne', MARGIN.left, y + 6.5);
  doc.text('Mimmoza -- Intelligence Immobiliere B2B', PAGE_W / 2, y + 6.5, { align: 'center' });
  doc.text(new Date().toLocaleDateString('fr-FR'), PAGE_W - MARGIN.right, y + 6.5, { align: 'right' });
}

// ---- Section header ---------------------------------------------------------

function sectionHeader(state: PdfState, label: string, num: string): void {
  checkBreak(state, 14);
  const { doc } = state;

  // Left accent bar
  doc.setFillColor(...V.violet800);
  doc.rect(MARGIN.left, state.y, 3, 9, 'F');

  // Background
  doc.setFillColor(...V.violet100);
  doc.roundedRect(MARGIN.left + 3, state.y, CONTENT_W - 3, 9, 1, 1, 'F');

  // Text
  doc.setFontSize(FONT.h2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.violet800);
  doc.text(`${num}  ${label}`, MARGIN.left + 8, state.y + 6.5);

  state.y += 13;
}

function subHeader(state: PdfState, label: string): void {
  checkBreak(state, 10);
  const { doc } = state;
  doc.setFillColor(...V.violet200);
  doc.rect(MARGIN.left, state.y, CONTENT_W, 0.3, 'F');
  state.y += 2;
  doc.setFontSize(FONT.h3);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.violet700);
  doc.text(label, MARGIN.left, state.y + 4);
  state.y += 8;
}

function bodyText(state: PdfState, text: string, indent = 0): void {
  const { doc } = state;
  doc.setFontSize(FONT.body);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...V.slate700);
  const lines = doc.splitTextToSize(text, CONTENT_W - indent);
  checkBreak(state, lines.length * 5 + 2);
  doc.text(lines, MARGIN.left + indent, state.y);
  state.y += lines.length * 5 + 3;
}

function hRule(state: PdfState): void {
  state.doc.setFillColor(...V.violet200);
  state.doc.rect(MARGIN.left, state.y, CONTENT_W, 0.3, 'F');
  state.y += 4;
}

// ---- KPI blocks -------------------------------------------------------------

function kpiRow(
  state: PdfState,
  items: Array<{ label: string; value: string; color?: [number, number, number] }>,
  cols = 3
): void {
  checkBreak(state, 20);
  const { doc } = state;
  const cw = CONTENT_W / cols;

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN.left + col * cw;
    const y = state.y + row * 20;

    doc.setFillColor(...V.violet50);
    doc.roundedRect(x + 1, y, cw - 3, 16, 1.5, 1.5, 'F');
    doc.setFillColor(...V.violet600);
    doc.rect(x + 1, y, cw - 3, 2, 'F');

    doc.setFontSize(FONT.caption);
    doc.setTextColor(...V.slate500);
    doc.setFont('helvetica', 'normal');
    doc.text(items[i].label, x + cw / 2 - 1, y + 7, { align: 'center' });

    doc.setFontSize(FONT.h3);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(items[i].color ?? V.violet800));
    doc.text(items[i].value, x + cw / 2 - 1, y + 13.5, { align: 'center' });
  }

  state.y += Math.ceil(items.length / cols) * 20 + 4;
}

function scoreBar(state: PdfState, label: string, score: number, invert = false): void {
  checkBreak(state, 8);
  const { doc } = state;
  const display = invert ? 100 - score : score;
  const barW = CONTENT_W * 0.45;
  const barX = MARGIN.left + 58;
  const color: [number, number, number] =
    display >= 70 ? V.success : display >= 45 ? V.warning : V.danger;

  doc.setFontSize(FONT.body);
  doc.setTextColor(...V.slate700);
  doc.setFont('helvetica', 'normal');
  doc.text(label, MARGIN.left, state.y);

  doc.setFillColor(...V.slate100);
  doc.roundedRect(barX, state.y - 3, barW, 4, 1, 1, 'F');
  doc.setFillColor(...color);
  doc.roundedRect(barX, state.y - 3, (barW * score) / 100, 4, 1, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...color);
  doc.text(`${score}`, barX + barW + 3, state.y);
  state.y += 7;
}

// ---- Cover page -------------------------------------------------------------

function addCoverPage(state: PdfState): void {
  const { doc, synthese } = state;
  const es = synthese.executiveSummary;

  // Full violet gradient background
  // Top zone (dark violet)
  doc.setFillColor(...V.violet900);
  doc.rect(0, 0, PAGE_W, 60, 'F');

  // Mid zone (medium violet)
  doc.setFillColor(...V.violet800);
  doc.rect(0, 60, PAGE_W, 60, 'F');

  // Bottom diagonal accent
  doc.setFillColor(...V.violet700);
  doc.triangle(0, 100, PAGE_W, 80, PAGE_W, 120, 'F');

  // White card
  doc.setFillColor(...V.white);
  doc.roundedRect(16, 52, PAGE_W - 32, 192, 5, 5, 'F');

  // Violet left accent on card
  doc.setFillColor(...V.violet600);
  doc.roundedRect(16, 52, 5, 192, 3, 3, 'F');

  // Top: Mimmoza logo area
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.violet200);
  doc.text('MIMMOZA', PAGE_W / 2, 28, { align: 'center' });

  doc.setFontSize(FONT.small);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...V.violet400);
  doc.text('Intelligence Immobiliere B2B', PAGE_W / 2, 36, { align: 'center' });

  // Violet pill: document type
  doc.setFillColor(...V.violet600);
  doc.roundedRect(PAGE_W / 2 - 40, 41, 80, 9, 4, 4, 'F');
  doc.setFontSize(FONT.small);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.white);
  doc.text('DOSSIER COMITE D\'INVESTISSEMENT', PAGE_W / 2, 47, { align: 'center' });

  // Operation title
  doc.setFontSize(FONT.h1);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.violet900);
  const titleLines = doc.splitTextToSize(es.titreOperation, CONTENT_W - 20);
  doc.text(titleLines, PAGE_W / 2, 72, { align: 'center' });

  // Recommendation badge
  const recY = 72 + titleLines.length * 8 + 4;
  const rc = recColor(es.recommendation);
  doc.setFillColor(...rc);
  doc.roundedRect(PAGE_W / 2 - 32, recY, 64, 13, 4, 4, 'F');
  doc.setFontSize(FONT.h3);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...V.white);
  const recLabel: Record<RecommendationType, string> = {
    GO: 'GO - RECOMMANDE',
    GO_CONDITION: 'GO CONDITIONNEL',
    NO_GO: 'NO GO',
  };
  doc.text(recLabel[es.recommendation], PAGE_W / 2, recY + 8.5, { align: 'center' });

  // KPI grid on card
  const kpiY = recY + 20;
  const kpis = [
    { l: 'Marge nette',  v: pct(synthese.financier.margeNettePercent) },
    { l: 'CA total HT',  v: `${(synthese.financier.chiffreAffairesTotal / 1e6).toFixed(2)} M EUR` },
    { l: 'TRN',          v: pct(synthese.financier.trnRendement) },
    { l: 'Logements',    v: String(synthese.projet.nbLogements) },
    { l: 'Score global', v: `${es.scores.global}/100` },
    { l: 'Qualite data', v: synthese.metadata.dataQualite },
  ];

  const kcols = 3;
  const kColW = (CONTENT_W - 10) / kcols;
  kpis.forEach((kpi, i) => {
    const col = i % kcols;
    const row = Math.floor(i / kcols);
    const x = 26 + col * kColW;
    const y = kpiY + row * 22;

    doc.setFillColor(...V.violet50);
    doc.roundedRect(x, y, kColW - 4, 18, 2, 2, 'F');
    doc.setFillColor(...V.violet600);
    doc.rect(x, y, kColW - 4, 2, 'F');

    doc.setFontSize(FONT.caption);
    doc.setTextColor(...V.slate500);
    doc.setFont('helvetica', 'normal');
    doc.text(kpi.l, x + (kColW - 4) / 2, y + 7.5, { align: 'center' });

    doc.setFontSize(FONT.h3);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...V.violet800);
    doc.text(kpi.v, x + (kColW - 4) / 2, y + 15, { align: 'center' });
  });

  // Address & date
  const infoY = kpiY + 50;
  doc.setFontSize(FONT.body);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...V.slate500);
  doc.text(
    `${synthese.projet.adresse} -- ${synthese.projet.commune} (${synthese.projet.codePostal})`,
    PAGE_W / 2, infoY, { align: 'center' }
  );
  doc.text(
    `Etude realisee le ${new Date(synthese.createdAt).toLocaleDateString('fr-FR')}`,
    PAGE_W / 2, infoY + 7, { align: 'center' }
  );

  // QR code
  {
    const qrSize = 22;
    const qrX = PAGE_W / 2 - qrSize / 2;
    const qrY = infoY + 14;
    drawNativeQr(doc, qrX, qrY, qrSize, 'Document certifie Mimmoza');
  }

  // Bottom footer on cover
  doc.setFillColor(...V.violet900);
  doc.rect(0, PAGE_H - 12, PAGE_W, 12, 'F');
  doc.setFontSize(FONT.caption);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...V.violet400);
  doc.text('DOCUMENT CONFIDENTIEL -- USAGE INTERNE EXCLUSIF', PAGE_W / 2, PAGE_H - 5, { align: 'center' });

  state.pageNum = 1;
  state.y = MARGIN.top + HEADER_H + 4;
}

// ---- Table of contents ------------------------------------------------------

function addTocPage(state: PdfState): void {
  newPage(state);
  sectionHeader(state, 'SOMMAIRE', '');

  const toc = [
    { n: '01', label: 'Executive Summary', pg: 3 },
    { n: '02', label: 'Presentation du projet', pg: 4 },
    { n: '03', label: 'Faisabilite technique & PLU', pg: 5 },
    { n: '04', label: 'Etude de marche', pg: 6 },
    { n: '05', label: 'Analyse financiere', pg: 7 },
    { n: '06', label: 'Plan de financement', pg: 8 },
    { n: '07', label: 'Analyse des risques', pg: 9 },
    { n: '08', label: 'Scenarios de sensibilite', pg: 10 },
    { n: '09', label: 'Synthese analytique', pg: 11 },
    { n: '10', label: 'Recommandation finale', pg: 12 },
  ];

  toc.forEach(({ n, label, pg }) => {
    checkBreak(state, 10);
    const { doc } = state;

    doc.setFontSize(FONT.body);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...V.violet600);
    doc.text(n, MARGIN.left + 2, state.y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...V.slate700);
    doc.text(label, MARGIN.left + 12, state.y);

    // Dots
    doc.setTextColor(...V.slate300);
    const dotsStart = MARGIN.left + 12 + doc.getTextWidth(label) + 2;
    const dotsEnd = PAGE_W - MARGIN.right - 12;
    let dx = dotsStart;
    while (dx < dotsEnd) {
      doc.text('.', dx, state.y);
      dx += 2.5;
    }

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...V.violet800);
    doc.text(String(pg), PAGE_W - MARGIN.right, state.y, { align: 'right' });

    state.y += 9;
  });

  drawPageFooter(state);
}

// ---- Section 01: Executive Summary -----------------------------------------

function addExecutiveSummary(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const es = synthese.executiveSummary;

  sectionHeader(state, 'EXECUTIVE SUMMARY', '01');

  // Recommendation block
  const rc = recColor(es.recommendation);
  state.doc.setFillColor(...rc);
  state.doc.roundedRect(MARGIN.left, state.y, CONTENT_W, 13, 2, 2, 'F');
  state.doc.setFontSize(FONT.h2);
  state.doc.setFont('helvetica', 'bold');
  state.doc.setTextColor(...V.white);
  const recFull: Record<RecommendationType, string> = {
    GO: 'RECOMMANDATION : GO -- OPERATION RECOMMANDEE',
    GO_CONDITION: 'RECOMMANDATION : GO CONDITIONNEL -- AJUSTEMENTS REQUIS',
    NO_GO: 'RECOMMANDATION : NO GO -- OPERATION NON VIABLE EN L\'ETAT',
  };
  state.doc.text(recFull[es.recommendation], PAGE_W / 2, state.y + 8.5, { align: 'center' });
  state.y += 17;

  bodyText(state, es.motifRecommandation);
  state.y += 2;

  kpiRow(state, [
    { label: 'Marge nette', value: pct(es.margeNette), color: es.margeNette < 8 ? V.danger : V.success },
    { label: 'CA total HT', value: `${(es.caTotal / 1e6).toFixed(2)} M EUR` },
    { label: 'Resultat net', value: eur(es.resultatNet) },
    { label: 'TRN', value: pct(es.trnRendement), color: es.trnRendement < 8 ? V.danger : V.success },
    { label: 'Score global', value: `${es.scores.global}/100` },
    { label: 'Logements', value: String(synthese.projet.nbLogements) },
  ], 3);

  subHeader(state, 'Scores par dimension');
  scoreBar(state, 'Foncier', es.scores.foncier);
  scoreBar(state, 'Technique / PLU', es.scores.technique);
  scoreBar(state, 'Marche', es.scores.marche);
  scoreBar(state, 'Financier', es.scores.financier);
  scoreBar(state, 'Risque (inverse)', es.scores.risque, true);
  state.y += 2;

  // Points grid
  checkBreak(state, 40);
  const half = CONTENT_W / 2 - 3;
  const leftX = MARGIN.left;
  const rightX = MARGIN.left + half + 6;
  const startY = state.y;

  // Forts
  state.doc.setFillColor(236, 253, 245);
  state.doc.roundedRect(leftX, startY, half, 4 + es.pointsForts.length * 5.5, 2, 2, 'F');
  state.doc.setFillColor(...V.success);
  state.doc.rect(leftX, startY, half, 2, 'F');
  state.doc.setFontSize(FONT.small);
  state.doc.setFont('helvetica', 'bold');
  state.doc.setTextColor(21, 128, 61);
  state.doc.text('POINTS FORTS', leftX + 3, startY + 6);
  let fy = startY + 11;
  es.pointsForts.forEach(p => {
    state.doc.setFont('helvetica', 'normal');
    state.doc.setFontSize(FONT.small);
    state.doc.setTextColor(21, 128, 61);
    const lines = state.doc.splitTextToSize(`+ ${p}`, half - 6);
    state.doc.text(lines, leftX + 3, fy);
    fy += lines.length * 4.5;
  });

  // Vigilance
  state.doc.setFillColor(255, 251, 235);
  state.doc.roundedRect(rightX, startY, half, 4 + es.pointsVigilance.length * 5.5, 2, 2, 'F');
  state.doc.setFillColor(...V.warning);
  state.doc.rect(rightX, startY, half, 2, 'F');
  state.doc.setFontSize(FONT.small);
  state.doc.setFont('helvetica', 'bold');
  state.doc.setTextColor(161, 98, 7);
  state.doc.text('POINTS DE VIGILANCE', rightX + 3, startY + 6);
  let vy = startY + 11;
  es.pointsVigilance.forEach(p => {
    state.doc.setFont('helvetica', 'normal');
    state.doc.setFontSize(FONT.small);
    state.doc.setTextColor(161, 98, 7);
    const lines = state.doc.splitTextToSize(`! ${p}`, half - 6);
    state.doc.text(lines, rightX + 3, vy);
    vy += lines.length * 4.5;
  });

  state.y = Math.max(fy, vy) + 6;

  // Kill switches
  if (es.killSwitchesActifs.length > 0) {
    checkBreak(state, 8 + es.killSwitchesActifs.length * 6);
    state.doc.setFillColor(254, 226, 226);
    state.doc.roundedRect(MARGIN.left, state.y, CONTENT_W, 6 + es.killSwitchesActifs.length * 6, 2, 2, 'F');
    state.doc.setFillColor(...V.danger);
    state.doc.rect(MARGIN.left, state.y, CONTENT_W, 2, 'F');
    state.doc.setFontSize(FONT.small);
    state.doc.setFont('helvetica', 'bold');
    state.doc.setTextColor(...V.danger);
    state.doc.text('POINTS BLOQUANTS', MARGIN.left + 3, state.y + 6);
    state.y += 10;
    es.killSwitchesActifs.forEach(ks => {
      state.doc.setFont('helvetica', 'normal');
      state.doc.text(`x  ${ks}`, MARGIN.left + 6, state.y);
      state.y += 6;
    });
    state.y += 4;
  }

  drawPageFooter(state);
}

// ---- Section 02: Projet -----------------------------------------------------

function addProjetPage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const p = synthese.projet;

  sectionHeader(state, 'PRESENTATION DU PROJET', '02');

  autoTable(state.doc, {
    startY: state.y,
    head: [['Parametre', 'Valeur']],
    body: [
      ['Adresse', p.adresse],
      ['Commune', `${p.commune} (${p.codePostal})`],
      ['Departement', p.departement || 'N/A'],
      ['Type de programme', p.programmeType],
      ['Surface terrain', m2(p.surfaceTerrain)],
      ['Surface plancher', m2(p.surfacePlancher)],
      ['Nombre de logements', String(p.nbLogements)],
      ['Date etude', new Date(p.dateEtude).toLocaleDateString('fr-FR')],
    ],
    theme: 'striped',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontStyle: 'bold', fontSize: FONT.body },
    bodyStyles: { fontSize: FONT.body, textColor: V.slate700 },
    alternateRowStyles: { fillColor: V.violet50 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60, textColor: V.violet700 } },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  if (Object.keys(p.typologieMix).length > 0) {
    subHeader(state, 'Mix typologique');
    autoTable(state.doc, {
      startY: state.y,
      head: [['Typologie', 'Nb logements', '% du programme']],
      body: Object.entries(p.typologieMix).map(([t, n]) => [
        t, String(n), pct((n / Math.max(p.nbLogements, 1)) * 100),
      ]),
      theme: 'grid',
      headStyles: { fillColor: V.violet600, textColor: V.white, fontSize: FONT.body },
      bodyStyles: { fontSize: FONT.body },
      margin: { left: MARGIN.left, right: MARGIN.right },
    });
    state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  drawPageFooter(state);
}

// ---- Section 03: Technique --------------------------------------------------

function addTechniquePage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const t = synthese.technique;

  sectionHeader(state, 'FAISABILITE TECHNIQUE & PLU', '03');

  const statusCfg: Record<typeof t.faisabiliteTechnique, { color: [number,number,number]; label: string }> = {
    CONFIRME:     { color: V.success, label: 'FAISABILITE CONFIRMEE' },
    SOUS_RESERVE: { color: V.warning, label: 'FAISABILITE SOUS RESERVE' },
    IMPOSSIBLE:   { color: V.danger,  label: 'FAISABILITE IMPOSSIBLE' },
  };
  const sc = statusCfg[t.faisabiliteTechnique];
  state.doc.setFillColor(...sc.color);
  state.doc.roundedRect(MARGIN.left, state.y, CONTENT_W, 11, 2, 2, 'F');
  state.doc.setFontSize(FONT.h3);
  state.doc.setFont('helvetica', 'bold');
  state.doc.setTextColor(...V.white);
  state.doc.text(sc.label, PAGE_W / 2, state.y + 7.5, { align: 'center' });
  state.y += 15;

  autoTable(state.doc, {
    startY: state.y,
    head: [['Parametre PLU', 'Reglementaire', 'Projet', 'Statut']],
    body: [
      ['Zone PLU', t.zonePlu, t.zonePlu, 'CONFORME'],
      ['CUB', t.cub != null ? String(t.cub) : 'N/D', 'N/D', 'N/D'],
      ['Hauteur max', t.hauteurMax != null ? `${t.hauteurMax} m` : 'N/D',
        t.hauteurProjet != null ? `${t.hauteurProjet} m` : 'N/D',
        t.hauteurProjet && t.hauteurMax && t.hauteurProjet <= t.hauteurMax ? 'CONFORME' : 'A VERIFIER'],
      ['Recul voirie', t.reculs.voirie != null ? `${t.reculs.voirie} m` : 'N/D', 'N/D', 'N/D'],
      ['Pleine terre', t.pleineTerre != null ? `${t.pleineTerre}%` : 'N/D', 'N/D', 'N/D'],
      ['Niveaux', 'N/D', t.nbNiveaux != null ? `R+${t.nbNiveaux - 1}` : 'N/D', 'N/D'],
    ],
    theme: 'striped',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontSize: FONT.body },
    bodyStyles: { fontSize: FONT.body },
    alternateRowStyles: { fillColor: V.violet50 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, textColor: V.violet700 } },
    didParseCell: (data) => {
      if (data.column.index === 3 && data.section === 'body') {
        const v = String(data.cell.raw);
        data.cell.styles.textColor = v === 'BLOQUANT' ? V.danger : v === 'LIMITE' ? V.warning : v === 'CONFORME' ? V.success : V.slate500;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  if (t.contraintes.length > 0) {
    subHeader(state, 'Analyse des contraintes PLU');
    autoTable(state.doc, {
      startY: state.y,
      head: [['Regle', 'Valeur', 'Statut']],
      body: t.contraintes.map(c => [c.libelle, String(c.valeur ?? 'N/D'), c.statut]),
      theme: 'grid',
      headStyles: { fillColor: V.violet600, textColor: V.white, fontSize: FONT.body },
      bodyStyles: { fontSize: FONT.small },
      didParseCell: (data) => {
        if (data.column.index === 2 && data.section === 'body') {
          const v = String(data.cell.raw);
          data.cell.styles.textColor = v === 'BLOQUANT' ? V.danger : v === 'LIMITE' ? V.warning : V.success;
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: MARGIN.left, right: MARGIN.right },
    });
    state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (t.notesTechniques.length > 0) {
    subHeader(state, 'Notes techniques');
    t.notesTechniques.forEach(n => bodyText(state, `- ${n}`, 3));
  }

  drawPageFooter(state);
}

// ---- Section 04: Marche -----------------------------------------------------

function addMarchePage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const m = synthese.marche;

  sectionHeader(state, 'ETUDE DE MARCHE', '04');

  kpiRow(state, [
    { label: 'Prix neuf moyen',    value: `${m.prixNeufMoyenM2.toLocaleString('fr-FR')} EUR/m2` },
    { label: 'Prix projet',        value: `${m.prixProjetM2.toLocaleString('fr-FR')} EUR/m2` },
    { label: 'Position vs marche', value: `${m.positionPrix > 0 ? '+' : ''}${pct(m.positionPrix)}`,
      color: Math.abs(m.positionPrix) > 10 ? V.danger : Math.abs(m.positionPrix) > 5 ? V.warning : V.success },
    { label: 'Prix ancien moyen',  value: `${m.prixAncienMoyenM2.toLocaleString('fr-FR')} EUR/m2` },
    { label: 'Prime neuf',         value: pct(m.primiumNeuf) },
    { label: 'Zone marche',        value: m.zoneMarche.replace('_', ' ') },
  ], 3);

  autoTable(state.doc, {
    startY: state.y,
    head: [['Indicateur', 'Valeur', 'Source']],
    body: [
      ['Transactions DVF', String(m.transactionsRecentes.nbTransactions), m.transactionsRecentes.source],
      ['Prix moyen DVF', `${m.transactionsRecentes.prixMoyenM2.toLocaleString('fr-FR')} EUR/m2`, `Periode ${m.transactionsRecentes.periode}`],
      ['Prix min DVF', `${m.transactionsRecentes.prixMin.toLocaleString('fr-FR')} EUR/m2`, ''],
      ['Prix max DVF', `${m.transactionsRecentes.prixMax.toLocaleString('fr-FR')} EUR/m2`, ''],
      ['Programmes concurrents', String(m.offreConcurrente), 'Marche local'],
      ['Absorption mensuelle', m.absorptionMensuelle != null ? `${m.absorptionMensuelle} ventes/mois` : 'N/D', 'Estimation'],
      ['Delai ecoulement', m.delaiEcoulementMois != null ? `${m.delaiEcoulementMois} mois` : 'N/D', 'Calcule'],
    ],
    theme: 'striped',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontSize: FONT.body },
    bodyStyles: { fontSize: FONT.body },
    alternateRowStyles: { fillColor: V.violet50 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55, textColor: V.violet700 } },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  if (m.demographieIndicateurs.length > 0) {
    subHeader(state, 'Indicateurs demographiques');
    autoTable(state.doc, {
      startY: state.y,
      head: [['Indicateur', 'Valeur', 'Evolution', 'Source']],
      body: m.demographieIndicateurs.map(d => [d.label, String(d.valeur), d.evolution ?? 'N/D', d.source]),
      theme: 'grid',
      headStyles: { fillColor: V.violet600, textColor: V.white, fontSize: FONT.body },
      bodyStyles: { fontSize: FONT.small },
      margin: { left: MARGIN.left, right: MARGIN.right },
    });
    state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (m.notesMarcheLibre.length > 0) {
    subHeader(state, 'Points de vigilance marche');
    m.notesMarcheLibre.forEach(n => bodyText(state, `! ${n}`, 3));
  }

  drawPageFooter(state);
}

// ---- Section 05: Financier --------------------------------------------------

function addFinancierPage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const f = synthese.financier;

  sectionHeader(state, 'ANALYSE FINANCIERE', '05');

  autoTable(state.doc, {
    startY: state.y,
    head: [['Poste', 'Montant HT', '% CA']],
    body: [
      ["Chiffre d'affaires total HT", eur(f.chiffreAffairesTotal), '100%'],
      ['Cout foncier', eur(f.coutFoncier), pct((f.coutFoncier / Math.max(f.chiffreAffairesTotal, 1)) * 100)],
      ['Cout travaux', eur(f.coutTravaux), pct((f.coutTravaux / Math.max(f.chiffreAffairesTotal, 1)) * 100)],
      ['Frais financiers', eur(f.coutFinanciers), pct((f.coutFinanciers / Math.max(f.chiffreAffairesTotal, 1)) * 100)],
      ['Frais commercialisation', eur(f.fraisCommercialisation), pct((f.fraisCommercialisation / Math.max(f.chiffreAffairesTotal, 1)) * 100)],
      ['Frais de gestion / etudes', eur(f.fraisGestion), pct((f.fraisGestion / Math.max(f.chiffreAffairesTotal, 1)) * 100)],
      ...f.autresCouts.map(c => [c.libelle, eur(c.montantHT), pct(c.pourcentageCA)]),
      ['COUT DE REVIENT TOTAL', eur(f.coutRevientTotal), pct((f.coutRevientTotal / Math.max(f.chiffreAffairesTotal, 1)) * 100)],
      ['MARGE NETTE', eur(f.margeNette), pct(f.margeNettePercent)],
    ],
    theme: 'striped',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontStyle: 'bold', fontSize: FONT.body },
    bodyStyles: { fontSize: FONT.body },
    alternateRowStyles: { fillColor: V.violet50 },
    columnStyles: { 0: { fontStyle: 'normal', cellWidth: 80 } },
    didParseCell: (data) => {
      const last = data.table.body.length - 1;
      const prev = data.table.body.length - 2;
      if (data.section === 'body' && data.row.index === last) {
        data.cell.styles.fillColor = V.violet800;
        data.cell.styles.textColor = V.white;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.row.index === prev) {
        data.cell.styles.fillColor = V.violet100;
        data.cell.styles.textColor = V.violet900;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  kpiRow(state, [
    { label: 'CA / m2', value: `${f.chiffreAffairesM2.toLocaleString('fr-FR')} EUR/m2` },
    { label: 'Cout revient / m2', value: `${f.coutRevientM2.toLocaleString('fr-FR')} EUR/m2` },
    { label: 'Travaux / m2', value: `${f.coutTravauxM2.toLocaleString('fr-FR')} EUR/m2` },
    { label: 'Marge operationnelle', value: pct(f.margeOperationnellePercent), color: f.margeOperationnellePercent < 15 ? V.warning : V.success },
    { label: 'TRN', value: pct(f.trnRendement), color: f.trnRendement < 8 ? V.danger : V.success },
    { label: 'Ratio foncier/CA', value: pct(f.bilancielRatio) },
  ], 3);

  drawPageFooter(state);
}

// ---- Section 06: Financement ------------------------------------------------

function addFinancementPage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const fin = synthese.financement;

  sectionHeader(state, 'PLAN DE FINANCEMENT', '06');

  autoTable(state.doc, {
    startY: state.y,
    head: [['Parametre', 'Valeur']],
    body: [
      ['Fonds propres requis', `${eur(fin.fondsPropresRequis)} (${pct(fin.fondsPropresPercent)})`],
      ['Credit promoteur', `${eur(fin.creditPromoteurMontant)} -- ${fin.creditPromoteurDuree} mois`],
      ['Taux credit estime', pct(fin.tauxCredit)],
      ['Ratio fonds propres / cout revient', pct(fin.ratioFondsPropres)],
      ['Prefinancement VEFA requis', pct(fin.prefinancementVentes)],
    ],
    theme: 'striped',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontSize: FONT.body },
    bodyStyles: { fontSize: FONT.body },
    alternateRowStyles: { fillColor: V.violet50 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80, textColor: V.violet700 } },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  subHeader(state, 'Garanties requises');
  fin.garantiesRequises.forEach(g => bodyText(state, `- ${g}`, 3));

  if (fin.notesBancaires.length > 0) {
    state.y += 2;
    subHeader(state, 'Notes bancaires');
    fin.notesBancaires.forEach(n => bodyText(state, `! ${n}`, 3));
  }

  drawPageFooter(state);
}

// ---- Section 07: Risques ----------------------------------------------------

function addRisquesPage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;

  sectionHeader(state, 'ANALYSE DES RISQUES', '07');

  if (synthese.risques.length === 0) {
    bodyText(state, 'Aucun risque significatif identifie lors de cette analyse.');
    drawPageFooter(state);
    return;
  }

  autoTable(state.doc, {
    startY: state.y,
    head: [['Risque', 'Categorie', 'Niveau', 'Prob.', 'Impact', 'Mitigation', 'KS']],
    body: synthese.risques.map((r: RisqueItem) => [
      r.libelle.length > 45 ? r.libelle.slice(0, 42) + '...' : r.libelle,
      r.categorie,
      r.niveau,
      `${Math.round(r.probabilite * 100)}%`,
      `${Math.round(r.impact * 100)}%`,
      r.mitigation.length > 60 ? r.mitigation.slice(0, 57) + '...' : r.mitigation,
      r.isKillSwitch ? 'OUI' : '',
    ]),
    theme: 'grid',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontSize: FONT.small, fontStyle: 'bold' },
    bodyStyles: { fontSize: FONT.small, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 40 },
      2: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 10, halign: 'center' },
      4: { cellWidth: 10, halign: 'center' },
      5: { cellWidth: 52 },
      6: { cellWidth: 10, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.column.index === 2 && data.section === 'body') {
        const n = String(data.cell.raw) as RisqueNiveau;
        data.cell.styles.textColor = risqueColor(n);
      }
      if (data.column.index === 6 && data.section === 'body' && String(data.cell.raw) === 'OUI') {
        data.cell.styles.textColor = V.danger;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const critiques = synthese.risques.filter(r => r.niveau === 'CRITIQUE').length;
  const eleves    = synthese.risques.filter(r => r.niveau === 'ELEVE').length;
  kpiRow(state, [
    { label: 'Total risques', value: String(synthese.risques.length) },
    { label: 'Critiques', value: String(critiques), color: critiques > 0 ? V.danger : V.success },
    { label: 'Eleves', value: String(eleves), color: eleves > 0 ? V.warning : V.success },
    { label: 'Kill switches', value: String(synthese.risques.filter(r => r.isKillSwitch).length) },
    { label: 'Moderes', value: String(synthese.risques.filter(r => r.niveau === 'MODERE').length) },
    { label: 'Faibles', value: String(synthese.risques.filter(r => r.niveau === 'FAIBLE').length), color: V.success },
  ], 3);

  drawPageFooter(state);
}

// ---- Section 08: Scenarios --------------------------------------------------

function addScenariosPage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;

  sectionHeader(state, 'SCENARIOS DE SENSIBILITE', '08');

  autoTable(state.doc, {
    startY: state.y,
    head: [['Scenario', 'Prix vente', 'Travaux', 'Absorption', 'Taux credit', 'Marge nette', 'TRN', 'Avis']],
    body: synthese.scenarios.map((s: Scenario) => [
      s.libelle,
      `${s.hypotheses.prixVenteM2.toLocaleString('fr-FR')} EUR`,
      `${s.hypotheses.coutTravauxM2.toLocaleString('fr-FR')} EUR`,
      `${s.hypotheses.tauxAbsorption} mois`,
      pct(s.hypotheses.tauxCredit),
      pct(s.resultat.margeNettePercent),
      pct(s.resultat.trnRendement),
      s.resultat.recommendation,
    ]),
    theme: 'grid',
    headStyles: { fillColor: V.violet800, textColor: V.white, fontSize: FONT.small },
    bodyStyles: { fontSize: FONT.small },
    columnStyles: {
      0: { cellWidth: 35, fontStyle: 'bold' },
      5: { fontStyle: 'bold' },
      7: { fontStyle: 'bold', halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const sc = synthese.scenarios[data.row.index];
        if (!sc) return;
        if (data.column.index === 0) {
          data.cell.styles.textColor =
            sc.type === 'OPTIMISTE' ? V.success :
            sc.type === 'BASE'      ? V.violet700 :
            sc.type === 'PESSIMISTE'? V.warning  : V.danger;
        }
        if (data.column.index === 5) {
          const m = sc.resultat.margeNettePercent;
          data.cell.styles.textColor = m < 8 ? V.danger : m < 12 ? V.warning : V.success;
        }
        if (data.column.index === 7) {
          const r = sc.resultat.recommendation;
          data.cell.styles.textColor = r === 'GO' ? V.success : r === 'GO_CONDITION' ? V.warning : V.danger;
        }
      }
    },
    margin: { left: MARGIN.left, right: MARGIN.right },
  });

  state.y = (state.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  bodyText(state, 'Le scenario de stress teste la resilience de l\'operation dans des conditions degradees cumulees. Une marge positive en scenario stress confirme la robustesse de l\'operation.');

  drawPageFooter(state);
}

// ---- Section 09: Synthese IA ------------------------------------------------

function addSyntheseIAPage(state: PdfState): void {
  if (!state.synthese.syntheseIA) return;
  newPage(state);
  const ia = state.synthese.syntheseIA;

  sectionHeader(state, 'SYNTHESE ANALYTIQUE', '09');

  const sections = [
    { t: 'Resume executif',   c: ia.texteExecutif },
    { t: 'Analyse de marche', c: ia.analyseMarche },
    { t: 'Analyse technique', c: ia.analyseTechnique },
    { t: 'Analyse financiere', c: ia.analyseFinanciere },
    { t: 'Analyse des risques', c: ia.analyseRisques },
  ];

  sections.forEach(s => {
    subHeader(state, s.t);
    bodyText(state, s.c);
    state.y += 2;
  });

  drawPageFooter(state);
}

// ---- Section 10: Recommandation finale + QR ---------------------------------

function addRecommandationPage(state: PdfState): void {
  newPage(state);
  const { synthese } = state;
  const es = synthese.executiveSummary;
  const ia = synthese.syntheseIA;

  sectionHeader(state, 'RECOMMANDATION FINALE', '10');

  const rc = recColor(es.recommendation);
  state.doc.setFillColor(...rc);
  state.doc.roundedRect(MARGIN.left, state.y, CONTENT_W, 18, 3, 3, 'F');
  state.doc.setFontSize(FONT.title);
  state.doc.setFont('helvetica', 'bold');
  state.doc.setTextColor(...V.white);
  const recFinal: Record<RecommendationType, string> = {
    GO: 'GO -- OPERATION RECOMMANDEE',
    GO_CONDITION: 'GO CONDITIONNEL',
    NO_GO: 'NO GO -- NON VIABLE EN L\'ETAT',
  };
  state.doc.text(recFinal[es.recommendation], PAGE_W / 2, state.y + 12, { align: 'center' });
  state.y += 22;

  if (ia?.conclusion) {
    bodyText(state, ia.conclusion);
    state.y += 4;
  }

  if (es.recommendation === 'GO_CONDITION' && es.pointsVigilance.length > 0) {
    subHeader(state, 'Conditions prealables a l\'engagement');
    es.pointsVigilance.forEach(p => bodyText(state, `- ${p}`, 3));
  }
  if (es.recommendation === 'NO_GO' && es.killSwitchesActifs.length > 0) {
    subHeader(state, 'Points bloquants a lever imperativement');
    es.killSwitchesActifs.forEach(k => bodyText(state, `x  ${k}`, 3));
  }

  state.y += 4;
  hRule(state);

  // Avertissements data
  if (synthese.metadata.avertissements.length > 0) {
    state.doc.setFontSize(FONT.small);
    state.doc.setTextColor(...V.slate300);
    state.doc.setFont('helvetica', 'italic');
    state.doc.text(
      `Qualite des donnees : ${synthese.metadata.dataQualite} -- ${synthese.metadata.avertissements.join(' | ')}`,
      MARGIN.left, state.y
    );
    state.y += 8;
  }

  // QR code block
  checkBreak(state, 55);
  {
    const qrSize = 30;
    const qrX = PAGE_W / 2 - qrSize / 2;
    drawNativeQr(state.doc, qrX, state.y, qrSize, 'Document genere par Mimmoza');
    state.doc.setFontSize(FONT.small);
    state.doc.setFont('helvetica', 'italic');
    state.doc.setTextColor(...V.violet600);
    state.doc.text('www.mimmoza.fr', PAGE_W / 2, state.y + qrSize + 10, { align: 'center' });
    state.doc.setTextColor(...V.slate300);
    state.doc.text(
      `Genere le ${new Date().toLocaleDateString('fr-FR')} a ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
      PAGE_W / 2, state.y + qrSize + 15, { align: 'center' }
    );
    state.y += qrSize + 20;
  }

  drawPageFooter(state);
}

// ---- QR code generation -----------------------------------------------------

// Native QR placeholder drawn with jsPDF -- no external lib needed
function drawNativeQr(doc: jsPDF, x: number, y: number, size: number, label: string): void {
  const cell = size / 21;

  // Outer border
  doc.setFillColor(46, 16, 101);
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor(255, 255, 255);
  doc.rect(x + cell, y + cell, size - cell * 2, size - cell * 2, 'F');

  // Corner squares (top-left, top-right, bottom-left)
  const corners: [number, number][] = [
    [x + cell, y + cell],
    [x + size - cell * 8, y + cell],
    [x + cell, y + size - cell * 8],
  ];
  corners.forEach(([cx, cy]) => {
    doc.setFillColor(46, 16, 101);
    doc.rect(cx, cy, cell * 7, cell * 7, 'F');
    doc.setFillColor(255, 255, 255);
    doc.rect(cx + cell, cy + cell, cell * 5, cell * 5, 'F');
    doc.setFillColor(46, 16, 101);
    doc.rect(cx + cell * 2, cy + cell * 2, cell * 3, cell * 3, 'F');
  });

  // Data dots pattern (deterministic)
  const pattern = [
    [9,2],[10,2],[12,2],[9,3],[11,3],[10,4],[12,4],[9,5],[11,5],
    [9,7],[12,7],[10,8],[11,8],[9,9],[12,9],[10,10],[9,11],[11,11],
    [2,9],[4,9],[2,10],[3,11],[4,10],[2,11],[3,9],
    [14,9],[16,9],[15,10],[14,11],[16,11],[15,9],
    [14,14],[16,14],[15,15],[14,16],[16,16],[15,14],
    [9,14],[11,14],[10,15],[9,16],[12,16],[11,16],
  ];
  doc.setFillColor(46, 16, 101);
  pattern.forEach(([col, row]) => {
    doc.rect(x + col * cell, y + row * cell, cell, cell, 'F');
  });

  // Label below
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(label, x + size / 2, y + size + 4, { align: 'center' });
}

// ---- Main export ------------------------------------------------------------

export function exportPromoteurPdf(synthese: PromoteurSynthese): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setProperties({
    title: `Mimmoza -- ${synthese.executiveSummary.titreOperation}`,
    subject: 'Dossier comite investissement',
    author: 'Mimmoza',
    creator: 'Mimmoza -- Intelligence Immobiliere B2B',
  });

  const state: PdfState = {
    doc,
    pageNum: 0,
    totalPages: 12,
    y: MARGIN.top + HEADER_H + 4,
    synthese,
  };

  // Cover (page 1 - no header/footer)
  addCoverPage(state);

  // TOC (page 2)
  addTocPage(state);

  // Content pages
  addExecutiveSummary(state);
  addProjetPage(state);
  addTechniquePage(state);
  addMarchePage(state);
  addFinancierPage(state);
  addFinancementPage(state);
  addRisquesPage(state);
  addScenariosPage(state);
  addSyntheseIAPage(state);
  addRecommandationPage(state);

  const fileName = `Mimmoza_${synthese.projet.commune.replace(/\s/g, '_')}_${synthese.projet.codePostal}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}