// ============================================================================
// generateReportPdf.ts — Export PDF du rapport comité
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
  primary:    [30, 41, 59]   as const, // slate-800
  secondary:  [100, 116, 139] as const, // slate-500
  light:      [241, 245, 249] as const, // slate-100
  white:      [255, 255, 255] as const,
  green:      [22, 163, 74]  as const,
  amber:      [217, 119, 6]  as const,
  orange:     [234, 88, 12]  as const,
  red:        [220, 38, 38]  as const,
  indigo:     [79, 70, 229]  as const,
  blue:       [59, 130, 246] as const,
  violet:     [139, 92, 246] as const,
  cyan:       [6, 182, 212]  as const,
  emerald:    [16, 185, 129] as const,
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
  documentation: COLORS.blue,
  garanties:     COLORS.indigo,
  emprunteur:    COLORS.violet,
  projet:        COLORS.cyan,
  financier:     COLORS.emerald,
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

// ── Main export function ──

export function generateReportPdf(report: StructuredReport): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15; // margin
  const CW = W - 2 * M; // content width
  let y = M;

  // ── Page footer ──
  function addFooter() {
    const pages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.secondary);
      doc.text(
        `Rapport Mimmoza — ${report.meta.dossierLabel} — Page ${i}/${pages}`,
        W / 2, H - 8, { align: "center" },
      );
    }
  }

  // ── Section title ──
  function sectionTitle(title: string) {
    checkSpace(14);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.primary);
    doc.text(title, M, y);
    y += 2;
    doc.setDrawColor(...COLORS.indigo);
    doc.setLineWidth(0.6);
    doc.line(M, y, M + CW, y);
    y += 6;
  }

  // ── Check remaining space, add page if needed ──
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
  // HEADER
  // ════════════════════════════════════════════════════════════════

  // Background band
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, W, 42, "F");

  // Title
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.white);
  doc.text("RAPPORT DE COMITÉ CRÉDIT", M, 16);

  // Dossier info
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${report.meta.dossierLabel}  —  ${report.meta.dossierId}`, M, 24);
  doc.setFontSize(8);
  doc.text(`Statut : ${report.meta.statut}  |  Généré le ${fmtDateTime(report.generatedAt)}`, M, 30);

  // Score badge (right side)
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

  // KPI boxes
  checkSpace(20);
  const boxW = (CW - 8) / 3;
  const niveauColor = NIVEAU_COLOR[report.risk.niveau];

  // Score box
  doc.setFillColor(...COLORS.light);
  doc.roundedRect(M, y, boxW, 16, 2, 2, "F");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.secondary);
  doc.text("Score", M + boxW / 2, y + 5, { align: "center" });
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.primary);
  doc.text(`${report.risk.score}/100`, M + boxW / 2, y + 13, { align: "center" });

  // Grade box
  const gradeX = M + boxW + 4;
  doc.setFillColor(...COLORS.light);
  doc.roundedRect(gradeX, y, boxW, 16, 2, 2, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.secondary);
  doc.text("Note", gradeX + boxW / 2, y + 5, { align: "center" });
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gradeColor);
  doc.text(report.risk.grade, gradeX + boxW / 2, y + 13, { align: "center" });

  // Niveau box
  const nivX = M + (boxW + 4) * 2;
  doc.setFillColor(...niveauColor);
  doc.roundedRect(nivX, y, boxW, 16, 2, 2, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.white);
  doc.text("Niveau", nivX + boxW / 2, y + 5, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(report.risk.niveau, nivX + boxW / 2, y + 13, { align: "center" });

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

  // KPI row
  checkSpace(12);
  kvRow("Nombre", String(report.garanties.total));
  kvRow("Couverture", fmtMontant(report.garanties.couverture));
  kvRow("Ratio gar./prêt", report.garanties.ratio !== null ? `${report.garanties.ratio}%` : "—");

  // Table
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
        fillColor: COLORS.primary as unknown as [number, number, number],
        textColor: COLORS.white as unknown as [number, number, number],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: COLORS.light as unknown as [number, number, number],
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

  // Progress bar
  checkSpace(8);
  const barY = y;
  doc.setFillColor(...COLORS.light);
  doc.roundedRect(M + 60, barY - 3, CW - 60, 4, 1, 1, "F");
  const barFillW = ((CW - 60) * report.documents.completeness) / 100;
  if (barFillW > 0) {
    doc.setFillColor(...COLORS.green);
    doc.roundedRect(M + 60, barY - 3, barFillW, 4, 1, 1, "F");
  }
  y += 4;

  // Table
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
        fillColor: COLORS.primary as unknown as [number, number, number],
        textColor: COLORS.white as unknown as [number, number, number],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: COLORS.light as unknown as [number, number, number],
      },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }
  y += 3;

  // ════════════════════════════════════════════════════════════════
  // 6. SMARTSCORE DÉTAILLÉ
  // ════════════════════════════════════════════════════════════════

  sectionTitle("6. SmartScore — Détail par pilier");

  // Overall score
  checkSpace(14);
  doc.setFillColor(...COLORS.light);
  doc.roundedRect(M, y, CW, 12, 2, 2, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.primary);
  doc.text(`Score global : ${report.smartscore.score}/100`, M + 4, y + 5);
  doc.setFontSize(12);
  doc.setTextColor(...LABEL_COLOR[report.smartscore.grade]);
  doc.text(report.smartscore.grade, W - M - 8, y + 6);

  // Score bar
  const scoreBarY = y + 8;
  doc.setFillColor(220, 220, 220);
  doc.roundedRect(M + 4, scoreBarY, CW - 24, 2.5, 1, 1, "F");
  const fillW = ((CW - 24) * report.smartscore.score) / 100;
  const scoreColor = report.smartscore.score >= 80 ? COLORS.green
    : report.smartscore.score >= 60 ? COLORS.amber
      : report.smartscore.score >= 40 ? COLORS.orange : COLORS.red;
  if (fillW > 0) {
    doc.setFillColor(...scoreColor);
    doc.roundedRect(M + 4, scoreBarY, fillW, 2.5, 1, 1, "F");
  }
  y += 18;

  // Pillar bars
  for (const p of report.smartscore.pillars) {
    checkSpace(18);
    const pct = Math.round((p.points / p.max) * 100);
    const pColor = PILLAR_COLOR[p.key] ?? COLORS.secondary;

    // Label + score
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.primary);
    doc.text(p.label, M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.secondary);
    doc.text(`${p.points}/${p.max} pts`, W - M, y, { align: "right" });
    y += 3;

    // Bar
    doc.setFillColor(230, 230, 230);
    doc.roundedRect(M, y, CW, 3, 1, 1, "F");
    const pFillW = (CW * pct) / 100;
    if (pFillW > 0) {
      doc.setFillColor(...pColor);
      doc.roundedRect(M, y, pFillW, 3, 1, 1, "F");
    }
    y += 5;

    // Reasons (compact)
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

    // Actions
    if (p.actions.length > 0) {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COLORS.indigo);
      for (const a of p.actions) {
        checkSpace(4);
        doc.text(`  → ${a}`, M, y);
        y += 3.5;
      }
    }
    y += 2;
  }

  // Drivers
  if (report.smartscore.drivers.up.length > 0 || report.smartscore.drivers.down.length > 0) {
    checkSpace(12);
    y += 2;

    if (report.smartscore.drivers.up.length > 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COLORS.green);
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

  // Recommendations
  if (report.smartscore.recommendations.length > 0) {
    checkSpace(12);
    y += 2;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.indigo);
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
  // FOOTER (on all pages)
  // ════════════════════════════════════════════════════════════════

  addFooter();

  // ════════════════════════════════════════════════════════════════
  // SAVE
  // ════════════════════════════════════════════════════════════════

  const filename = `rapport-comite-${report.meta.dossierId}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}