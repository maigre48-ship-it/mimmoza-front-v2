// ============================================================================
// generateReportPdf.ts — Export PDF du rapport comité — v2 ARCS COVER
//
// Dépendances: jspdf, jspdf-autotable
//   npm install jspdf jspdf-autotable
//   npm install -D @types/jspdf
//
// Usage: generateReportPdf(report) → télécharge un .pdf
// ============================================================================

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  StructuredReport,
  PillarResult,
  Niveau,
  Label,
} from "./banqueCalcUtils";

// ── Color palette ──

const COLORS = {
  primary:    [30, 41, 59]    as const,
  secondary:  [100, 116, 139] as const,
  light:      [241, 245, 249] as const,
  white:      [255, 255, 255] as const,
  green:      [22, 163, 74]   as const,
  amber:      [217, 119, 6]   as const,
  orange:     [234, 88, 12]   as const,
  red:        [220, 38, 38]   as const,
  indigo:     [79, 70, 229]   as const,
  blue:       [59, 130, 246]  as const,
  violet:     [139, 92, 246]  as const,
  cyan:       [6, 182, 212]   as const,
  emerald:    [16, 185, 129]  as const,
};

// ── Financeur palette ──
const FIN = {
  gradStart: [38, 166, 154]  as const,  // #26a69a
  gradEnd:   [128, 203, 196] as const,  // #80cbc4
  accent:    [26, 122, 80]   as const,  // #1a7a50
  dark:      [10, 61, 40]    as const,  // #0a3d28
  light:     [192, 232, 212] as const,  // #c0e8d4
  pale:      [232, 251, 242] as const,  // #e8fbf2
};

const NIVEAU_COLOR: Record<Niveau, readonly [number, number, number]> = {
  Faible:   COLORS.green,
  Modéré:   COLORS.amber,
  Élevé:    COLORS.orange,
  Critique: COLORS.red,
};

const LABEL_COLOR: Record<Label, readonly [number, number, number]> = {
  A: COLORS.green,
  B: COLORS.emerald,
  C: COLORS.amber,
  D: COLORS.orange,
  E: COLORS.red,
};

const PILLAR_COLOR: Record<string, readonly [number, number, number]> = {
  documentation: [38, 166, 154]  as const,
  garanties:     [26, 122, 80]   as const,
  emprunteur:    [16, 185, 129]  as const,
  projet:        [20, 144, 100]  as const,
  financier:     [128, 203, 196] as const,
};

// ── Helpers ──

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function fmtMontant(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${(v / 1e6).toFixed(2)} M€`;
}

// ═══════════════════════════════════════════════════════════════════════
// ─── COVER — Arcs concentriques teal (Financeur / Banque) ──────────────
// ═══════════════════════════════════════════════════════════════════════
//
// Arcs concentriques depuis le coin supérieur gauche (légèrement hors page).
// Même esprit premium que les ribbons Promoteur / shards Investisseur,
// géométrie distincte : secteurs annulaires rayonnant depuis un coin.

// ─── Helper : bande d'arc torique ────────────────────────────────────────
function drawArcBand(
  doc: jsPDF,
  cx: number, cy: number,
  r1: number, r2: number,
  startDeg: number, endDeg: number,
  color: readonly [number, number, number],
  steps = 70,
): void {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const pts: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const a = toRad(startDeg + (endDeg - startDeg) * (i / steps));
    pts.push([cx + Math.cos(a) * r2, cy + Math.sin(a) * r2]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = toRad(startDeg + (endDeg - startDeg) * (i / steps));
    pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
  }

  doc.setFillColor(color[0], color[1], color[2]);
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.1);

  const [sx, sy] = pts[0];
  const segs: [number, number][] = pts
    .slice(1)
    .map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);

  doc.lines(segs, sx, sy, [1, 1], "FD", true);
}

// ─── Page de garde Financeur ──────────────────────────────────────────────
function addFinanceurCover(
  doc: jsPDF,
  report: StructuredReport,
  W: number,
  H: number,
  M: number,
): void {
  const CW = W - 2 * M;

  // Fond blanc
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, H, "F");

  // Arcs concentriques depuis coin haut-gauche hors page
  // Balayage 2°→88° : du bord supérieur vers le bord gauche
  const ARC_CX = -4;
  const ARC_CY = -4;
  const A1 = 2;
  const A2 = 88;

  const arcBands: Array<{
    r1: number; r2: number;
    col: readonly [number, number, number];
  }> = [
    { r1: 198, r2: 236, col: [224, 242, 241] as const }, // crystal #e0f2f1
    { r1: 162, r2: 198, col: [178, 223, 219] as const }, // ultra   #b2dfdb
    { r1: 128, r2: 162, col: FIN.gradEnd               }, // pale    #80cbc4
    { r1: 98,  r2: 128, col: [77, 182, 172]  as const  }, // light   #4db6ac
    { r1: 70,  r2: 98,  col: FIN.gradStart             }, // med     #26a69a
    { r1: 50,  r2: 70,  col: FIN.accent                }, // main    #1a7a50
    { r1: 34,  r2: 50,  col: FIN.dark                  }, // deep    #0a3d28
  ];

  for (const b of arcBands) {
    drawArcBand(doc, ARC_CX, ARC_CY, b.r1, b.r2, A1, A2, b.col, 70);
  }

  // Bande en-tête dégradée teal
  const HDR_H = 54;
  const GSTEPS = 70;
  for (let i = 0; i < GSTEPS; i++) {
    const t = i / (GSTEPS - 1);
    const r = Math.round(FIN.gradStart[0] + t * (FIN.gradEnd[0] - FIN.gradStart[0]));
    const g = Math.round(FIN.gradStart[1] + t * (FIN.gradEnd[1] - FIN.gradStart[1]));
    const b = Math.round(FIN.gradStart[2] + t * (FIN.gradEnd[2] - FIN.gradStart[2]));
    doc.setFillColor(r, g, b);
    doc.rect(i * (W / GSTEPS), 0, W / GSTEPS + 0.5, HDR_H, "F");
  }

  // Trait sombre sous l'en-tête
  doc.setFillColor(...FIN.dark);
  doc.rect(0, HDR_H, W, 1.5, "F");

  // Marque MIMMOZA
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("MIMMOZA", M, 20);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 235, 225);
  doc.text("Intelligence immobiliere B2B", M, 27.5);

  // Badge type document
  const docBadge = "RAPPORT COMITE CREDIT";
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  const dbW = doc.getTextWidth(docBadge) + 16;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(W - M - dbW, 13, dbW, 10, 5, 5, "F");
  doc.setTextColor(...FIN.dark);
  doc.text(docBadge, W - M - dbW / 2, 19.5, { align: "center" });

  // Date + référence
  const genDate = new Date(report.generatedAt).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 235, 225);
  doc.text(genDate, M, 37);
  doc.setFontSize(6.5);
  doc.setTextColor(170, 215, 205);
  doc.text(`Ref. ${report.meta.dossierId}  —  Statut : ${report.meta.statut}`, M, 44);
  doc.text(
    new Date(report.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    W - M, 44, { align: "right" },
  );

  // Titre du dossier
  const TITLE_Y = HDR_H + 14;
  const TITLE_H = 32;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...FIN.light);
  doc.setLineWidth(0.4);
  doc.roundedRect(M, TITLE_Y, CW, TITLE_H, 3, 3, "FD");
  doc.setFillColor(...FIN.gradStart);
  doc.roundedRect(M, TITLE_Y, 3.5, TITLE_H, 1.5, 1.5, "F");

  const titleLines = doc.splitTextToSize(report.meta.dossierLabel, CW - 18) as string[];
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...FIN.dark);
  doc.text(titleLines.slice(0, 2), M + 10, TITLE_Y + 11);

  if (report.projet.adresse) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.secondary);
    doc.text(report.projet.adresse, M + 10, TITLE_Y + TITLE_H - 5);
  }

  // Score + Note + Niveau — 3 cards
  const SCORE_Y = TITLE_Y + TITLE_H + 10;
  const COL3 = (CW - 8) / 3;

  // Card Score /100
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...FIN.light);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, SCORE_Y, COL3, 30, 3, 3, "FD");
  doc.setFillColor(...FIN.gradStart);
  doc.roundedRect(M, SCORE_Y, 3, 30, 1.5, 1.5, "F");

  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.secondary);
  doc.text("SCORE GLOBAL", M + 8, SCORE_Y + 7);

  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...FIN.dark);
  const scoreStr = String(report.risk.score);
  doc.text(scoreStr, M + 8, SCORE_Y + 22);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.secondary);
  doc.text("/100", M + 8 + doc.getTextWidth(scoreStr), SCORE_Y + 22);

  // Barre de score
  const BAR_X = M + 8;
  const BAR_W = COL3 - 16;
  const BAR_Y = SCORE_Y + 25;
  doc.setFillColor(...FIN.pale);
  doc.roundedRect(BAR_X, BAR_Y, BAR_W, 2.5, 1, 1, "F");
  const fillW = Math.max(2, (report.risk.score / 100) * BAR_W);
  doc.setFillColor(...FIN.gradStart);
  doc.roundedRect(BAR_X, BAR_Y, fillW, 2.5, 1, 1, "F");

  // Card Note (grade)
  const gradeColor = LABEL_COLOR[report.risk.grade];
  const gradeX = M + COL3 + 4;
  doc.setFillColor(gradeColor[0], gradeColor[1], gradeColor[2]);
  doc.roundedRect(gradeX, SCORE_Y, COL3, 30, 3, 3, "F");

  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("NOTE", gradeX + COL3 / 2, SCORE_Y + 7, { align: "center" });
  doc.setFontSize(26);
  doc.text(report.risk.grade, gradeX + COL3 / 2, SCORE_Y + 22, { align: "center" });

  // Card Niveau de risque
  const nivColor = NIVEAU_COLOR[report.risk.niveau];
  const nivX = M + (COL3 + 4) * 2;
  doc.setFillColor(nivColor[0], nivColor[1], nivColor[2]);
  doc.roundedRect(nivX, SCORE_Y, COL3, 30, 3, 3, "F");

  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("NIVEAU DE RISQUE", nivX + COL3 / 2, SCORE_Y + 7, { align: "center" });
  doc.setFontSize(12);
  doc.text(report.risk.niveau, nivX + COL3 / 2, SCORE_Y + 19, { align: "center" });
  const nIcon = report.risk.niveau === "Faible" ? "OK" : report.risk.niveau === "Critique" ? "!" : "~";
  doc.setFontSize(9);
  doc.text(nIcon, nivX + COL3 / 2, SCORE_Y + 27, { align: "center" });

  // Points forts / Points de vigilance
  const DRIVERS_Y = SCORE_Y + 40;
  const HALF_W = (CW - 5) / 2;
  const upItems   = (report.smartscore?.drivers?.up   ?? []).slice(0, 3);
  const downItems = (report.smartscore?.drivers?.down ?? []).slice(0, 3);
  const driverH   = Math.max(upItems.length, downItems.length) * 6 + 18;

  // Points forts
  doc.setFillColor(...FIN.pale);
  doc.setDrawColor(...FIN.gradStart);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, DRIVERS_Y, HALF_W, driverH, 3, 3, "FD");
  doc.setFillColor(...FIN.gradStart);
  doc.roundedRect(M, DRIVERS_Y, 3, driverH, 1.5, 1.5, "F");

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...FIN.dark);
  doc.text("POINTS FORTS", M + 8, DRIVERS_Y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.primary);
  upItems.forEach((pt, i) => {
    const ls = doc.splitTextToSize(`+ ${pt}`, HALF_W - 12) as string[];
    doc.text(ls[0] ?? "", M + 8, DRIVERS_Y + 15 + i * 6);
  });
  if (upItems.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.secondary);
    doc.text("Aucun point fort identifie", M + 8, DRIVERS_Y + 15);
  }

  // Points de vigilance
  const vigX = M + HALF_W + 5;
  doc.setFillColor(255, 248, 238);
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.3);
  doc.roundedRect(vigX, DRIVERS_Y, HALF_W, driverH, 3, 3, "FD");
  doc.setFillColor(217, 119, 6);
  doc.roundedRect(vigX, DRIVERS_Y, 3, driverH, 1.5, 1.5, "F");

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 60, 0);
  doc.text("POINTS DE VIGILANCE", vigX + 8, DRIVERS_Y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.primary);
  downItems.forEach((pt, i) => {
    const ls = doc.splitTextToSize(`! ${pt}`, HALF_W - 12) as string[];
    doc.text(ls[0] ?? "", vigX + 8, DRIVERS_Y + 15 + i * 6);
  });
  if (downItems.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.secondary);
    doc.text("Aucun point de vigilance", vigX + 8, DRIVERS_Y + 15);
  }

  // Alertes (3 max)
  const ALERTS_Y = DRIVERS_Y + driverH + 10;
  const topAlerts = report.risk.alertes.slice(0, 3);

  if (topAlerts.length > 0) {
    const alertH = topAlerts.length * 7 + 12;
    doc.setFillColor(254, 252, 232);
    doc.setDrawColor(217, 119, 6);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, ALERTS_Y, CW, alertH, 3, 3, "FD");

    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120, 60, 0);
    doc.text(`Alertes (${topAlerts.length})`, M + 6, ALERTS_Y + 7);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.primary);
    topAlerts.forEach((a, i) => {
      doc.setFillColor(217, 119, 6);
      doc.circle(M + 8, ALERTS_Y + 12.5 + i * 7, 0.9, "F");
      const ls = doc.splitTextToSize(a, CW - 18) as string[];
      doc.text(ls[0] ?? "", M + 12, ALERTS_Y + 13 + i * 7);
    });
  }

  // Infos montant / durée / type
  const INFO_Y = topAlerts.length > 0
    ? ALERTS_Y + topAlerts.length * 7 + 20
    : ALERTS_Y + 6;

  if (report.projet.montant) {
    const infoItems = [
      { l: "Montant",  v: fmtMontant(report.projet.montant) },
      { l: "Duree",    v: report.projet.duree ? `${report.projet.duree} mois` : "—" },
      { l: "Type",     v: report.projet.typePretLabel || "—" },
    ];
    const IW = (CW - 8) / 3;
    infoItems.forEach((item, i) => {
      const ix = M + i * (IW + 4);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...FIN.light);
      doc.setLineWidth(0.25);
      doc.roundedRect(ix, INFO_Y, IW, 16, 2, 2, "FD");
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COLORS.secondary);
      doc.text(item.l, ix + IW / 2, INFO_Y + 5, { align: "center" });
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...FIN.dark);
      doc.text(item.v, ix + IW / 2, INFO_Y + 12, { align: "center" });
    });
  }

  // Pied de page dégradé
  const FOOTER_Y = H - 8;
  for (let i = 0; i < GSTEPS; i++) {
    const t = i / (GSTEPS - 1);
    const r = Math.round(FIN.gradStart[0] + t * (FIN.gradEnd[0] - FIN.gradStart[0]));
    const g = Math.round(FIN.gradStart[1] + t * (FIN.gradEnd[1] - FIN.gradStart[1]));
    const b = Math.round(FIN.gradStart[2] + t * (FIN.gradEnd[2] - FIN.gradStart[2]));
    doc.setFillColor(r, g, b);
    doc.rect(i * (W / GSTEPS), FOOTER_Y, W / GSTEPS + 0.5, 8, "F");
  }
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(255, 255, 255);
  doc.text("Confidentiel — Usage interne exclusif", M, H - 2.5);
  doc.text("www.mimmoza.fr", W - M, H - 2.5, { align: "right" });
}

// ── Main export function ──

export function generateReportPdf(report: StructuredReport): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15;
  const CW = W - 2 * M;
  let y = M;

  // ── PAGE DE GARDE ──────────────────────────────────────────────────────
  addFinanceurCover(doc, report, W, H, M);
  doc.addPage();
  y = M;

  // ── Page footer ──
  function addFooter() {
    const pages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (i === 1) continue; // skip cover
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.secondary);
      doc.text(
        `Rapport Mimmoza — ${report.meta.dossierLabel} — Page ${i - 1}/${pages - 1}`,
        W / 2, H - 8, { align: "center" },
      );
    }
  }

  // ── Section title ──
  function sectionTitle(title: string) {
    checkSpace(14);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...FIN.dark);
    doc.text(title, M, y);
    y += 2;
    doc.setDrawColor(...FIN.gradStart);
    doc.setLineWidth(0.6);
    doc.line(M, y, M + CW, y);
    y += 6;
  }

  // ── Check remaining space ──
  function checkSpace(needed: number) {
    if (y + needed > H - 15) {
      doc.addPage();
      y = M;
    }
  }

  // ── Key-value row ──
  function kvRow(label: string, value: string, indent = 0) {
    checkSpace(6);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.secondary);
    doc.text(label, M + indent, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.primary);
    doc.text(value, M + 60 + indent, y);
    y += 5;
  }

  // ════════════════════════════════════════════════════════════════
  // HEADER (page de contenu)
  // ════════════════════════════════════════════════════════════════

  doc.setFillColor(...FIN.gradStart);
  doc.rect(0, 0, W, 42, "F");
  doc.setFillColor(...FIN.gradEnd);
  doc.rect(0, 36, W, 6, "F");

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.white);
  doc.text("RAPPORT DE COMITÉ CRÉDIT", M, 16);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${report.meta.dossierLabel}  —  ${report.meta.dossierId}`, M, 24);
  doc.setFontSize(8);
  doc.text(`Statut : ${report.meta.statut}  |  Généré le ${fmtDateTime(report.generatedAt)}`, M, 30);

  const gradeColor = LABEL_COLOR[report.risk.grade];
  doc.setFillColor(...gradeColor);
  doc.roundedRect(W - M - 30, 8, 28, 26, 4, 4, "F");
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.white);
  doc.text(String(report.risk.score), W - M - 16, 20, { align: "center" });
  doc.setFontSize(9);
  doc.text(`${report.risk.grade}  —  ${report.risk.niveau}`, W - M - 16, 28, { align: "center" });

  y = 50;

  // ════════════════════════════════════════════════════════════════
  // 1. EMPRUNTEUR
  // ════════════════════════════════════════════════════════════════

  sectionTitle("1. Emprunteur");

  const empTypeLabel = report.emprunteur.type === "personne_physique"
    ? "Personne physique"
    : report.emprunteur.type === "personne_morale"
      ? "Personne morale" : "Non renseigné";

  kvRow("Type", empTypeLabel);
  kvRow("Identité", report.emprunteur.identite);

  for (const [k, v] of Object.entries(report.emprunteur.details)) {
    kvRow(k, v);
  }
  y += 3;

  // ════════════════════════════════════════════════════════════════
  // 2. PROJET
  // ════════════════════════════════════════════════════════════════

  sectionTitle("2. Données du projet");

  kvRow("Montant", fmtMontant(report.projet.montant));
  kvRow("Durée", report.projet.duree ? `${report.projet.duree} mois` : "—");
  kvRow("Type de prêt", report.projet.typePretLabel || "—");
  kvRow("Adresse", report.projet.adresse || "—");
  if (report.projet.notes) {
    kvRow("Notes", report.projet.notes);
  }
  y += 3;

  // ════════════════════════════════════════════════════════════════
  // 3. SYNTHÈSE RISQUE
  // ════════════════════════════════════════════════════════════════

  sectionTitle("3. Synthèse de risque");

  checkSpace(20);
  const boxW = (CW - 8) / 3;
  const niveauColor = NIVEAU_COLOR[report.risk.niveau];

  // Score box
  doc.setFillColor(...FIN.light);
  doc.roundedRect(M, y, boxW, 16, 2, 2, "F");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.secondary);
  doc.text("Score", M + boxW / 2, y + 5, { align: "center" });
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...FIN.dark);
  doc.text(`${report.risk.score}/100`, M + boxW / 2, y + 13, { align: "center" });

  // Grade box
  const gradeX2 = M + boxW + 4;
  doc.setFillColor(...FIN.light);
  doc.roundedRect(gradeX2, y, boxW, 16, 2, 2, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.secondary);
  doc.text("Note", gradeX2 + boxW / 2, y + 5, { align: "center" });
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gradeColor);
  doc.text(report.risk.grade, gradeX2 + boxW / 2, y + 13, { align: "center" });

  // Niveau box
  const nivX2 = M + (boxW + 4) * 2;
  doc.setFillColor(...niveauColor);
  doc.roundedRect(nivX2, y, boxW, 16, 2, 2, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.white);
  doc.text("Niveau", nivX2 + boxW / 2, y + 5, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(report.risk.niveau, nivX2 + boxW / 2, y + 13, { align: "center" });

  y += 22;

  // Alertes
  if (report.risk.alertes.length > 0) {
    checkSpace(8 + report.risk.alertes.length * 5);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.primary);
    doc.text(`Alertes (${report.risk.alertes.length})`, M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.secondary);
    for (const a of report.risk.alertes) {
      checkSpace(5);
      doc.setFillColor(...COLORS.amber);
      doc.circle(M + 2, y - 1, 1, "F");
      doc.text(a, M + 6, y);
      y += 4.5;
    }
  }
  y += 3;

  // ════════════════════════════════════════════════════════════════
  // 4. GARANTIES
  // ════════════════════════════════════════════════════════════════

  sectionTitle("4. Garanties & Sûretés");

  checkSpace(12);
  kvRow("Nombre", String(report.garanties.total));
  kvRow("Couverture", fmtMontant(report.garanties.couverture));
  kvRow("Ratio gar./prêt", report.garanties.ratio !== null ? `${report.garanties.ratio}%` : "—");

  if (report.garanties.items.length > 0) {
    checkSpace(15);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["#", "Type", "Description", "Valeur", "Rang"]],
      body: report.garanties.items.map((g, i) => [
        String(i + 1),
        g.type.charAt(0).toUpperCase() + g.type.slice(1),
        g.description,
        g.valeur ? fmtMontant(g.valeur) : "—",
        g.rang ? String(g.rang) : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: {
        fillColor: FIN.gradStart as unknown as [number, number, number],
        textColor: COLORS.white as unknown as [number, number, number],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: FIN.pale as unknown as [number, number, number],
      },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        3: { halign: "right" },
        4: { cellWidth: 12, halign: "center" },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  if (report.garanties.commentaire) {
    checkSpace(8);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...COLORS.secondary);
    doc.text(`Note : ${report.garanties.commentaire}`, M, y);
    y += 5;
  }
  y += 3;

  // ════════════════════════════════════════════════════════════════
  // 5. DOCUMENTS
  // ════════════════════════════════════════════════════════════════

  sectionTitle("5. Documents");

  kvRow("Nombre", String(report.documents.total));
  kvRow("Complétude", `${report.documents.completeness}%`);

  checkSpace(8);
  const barY = y;
  doc.setFillColor(...FIN.light);
  doc.roundedRect(M + 60, barY - 3, CW - 60, 4, 1, 1, "F");
  const barFillW = ((CW - 60) * report.documents.completeness) / 100;
  if (barFillW > 0) {
    doc.setFillColor(...FIN.gradStart);
    doc.roundedRect(M + 60, barY - 3, barFillW, 4, 1, 1, "F");
  }
  y += 4;

  if (report.documents.items.length > 0) {
    checkSpace(15);
    const statusLabels: Record<string, string> = {
      attendu: "Attendu", recu: "Reçu", valide: "Validé", refuse: "Refusé",
    };
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["Nom", "Type", "Statut", "Note"]],
      body: report.documents.items.map((d) => [
        d.nom,
        d.type,
        statusLabels[d.statut] ?? d.statut,
        d.commentaire || "—",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: {
        fillColor: FIN.gradStart as unknown as [number, number, number],
        textColor: COLORS.white as unknown as [number, number, number],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: FIN.pale as unknown as [number, number, number],
      },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }
  y += 3;

  // ════════════════════════════════════════════════════════════════
  // 6. SMARTSCORE DÉTAILLÉ
  // ════════════════════════════════════════════════════════════════

  sectionTitle("6. SmartScore — Détail par pilier");

  checkSpace(14);
  doc.setFillColor(...FIN.light);
  doc.roundedRect(M, y, CW, 12, 2, 2, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...FIN.dark);
  doc.text(`Score global : ${report.smartscore.score}/100`, M + 4, y + 5);
  doc.setFontSize(12);
  doc.setTextColor(...LABEL_COLOR[report.smartscore.grade]);
  doc.text(report.smartscore.grade, W - M - 8, y + 6);

  const scoreBarY = y + 8;
  doc.setFillColor(...FIN.light);
  doc.roundedRect(M + 4, scoreBarY, CW - 24, 2.5, 1, 1, "F");
  const fillW2 = ((CW - 24) * report.smartscore.score) / 100;
  if (fillW2 > 0) {
    doc.setFillColor(...FIN.gradStart);
    doc.roundedRect(M + 4, scoreBarY, fillW2, 2.5, 1, 1, "F");
  }
  y += 18;

  for (const p of report.smartscore.pillars) {
    checkSpace(18);
    const pct = Math.round((p.points / p.max) * 100);
    const pColor = PILLAR_COLOR[p.key] ?? FIN.gradStart;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...FIN.dark);
    doc.text(p.label, M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.secondary);
    doc.text(`${p.points}/${p.max} pts`, W - M, y, { align: "right" });
    y += 3;

    doc.setFillColor(...FIN.light);
    doc.roundedRect(M, y, CW, 3, 1, 1, "F");
    const pFillW = (CW * pct) / 100;
    if (pFillW > 0) {
      doc.setFillColor(...pColor);
      doc.roundedRect(M, y, pFillW, 3, 1, 1, "F");
    }
    y += 5;

    if (p.reasons.length > 0) {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COLORS.secondary);
      for (const r of p.reasons) {
        checkSpace(4);
        doc.text(`  ${r}`, M, y);
        y += 3.5;
      }
    }

    if (p.actions.length > 0) {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...FIN.accent);
      for (const a of p.actions) {
        checkSpace(4);
        doc.text(`  → ${a}`, M, y);
        y += 3.5;
      }
    }
    y += 2;
  }

  if (report.smartscore.drivers.up.length > 0 || report.smartscore.drivers.down.length > 0) {
    checkSpace(12);
    y += 2;

    if (report.smartscore.drivers.up.length > 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...FIN.gradStart);
      doc.text("Points forts :", M, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      for (const d of report.smartscore.drivers.up) {
        checkSpace(4);
        doc.text(`  + ${d}`, M, y);
        y += 3.5;
      }
      y += 2;
    }

    if (report.smartscore.drivers.down.length > 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COLORS.red);
      doc.text("Points de vigilance :", M, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.red);
      for (const d of report.smartscore.drivers.down) {
        checkSpace(4);
        doc.text(`  - ${d}`, M, y);
        y += 3.5;
      }
      y += 2;
    }
  }

  if (report.smartscore.recommendations.length > 0) {
    checkSpace(12);
    y += 2;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...FIN.accent);
    doc.text("Recommandations", M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.primary);
    for (let i = 0; i < report.smartscore.recommendations.length; i++) {
      checkSpace(5);
      doc.text(`${i + 1}. ${report.smartscore.recommendations[i]}`, M + 2, y);
      y += 4.5;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════════════════════════

  addFooter();

  // ════════════════════════════════════════════════════════════════
  // SAVE
  // ════════════════════════════════════════════════════════════════

  const filename = `rapport-comite-${report.meta.dossierId}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}