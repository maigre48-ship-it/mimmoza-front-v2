// === exportPdf.investisseur.ts ===
//
// RÈGLE ABSOLUE : tous les chiffres financiers (travaux, capitalEngage,
// margeBrute, margeBrutePct, prixAchat, prixRevente, apport, montantPret)
// proviennent EXCLUSIVEMENT de extractMetrics(snap, opts) → resolveCanonicalFinancials().
// Aucun recalcul, aucune re-lecture de rentabiliteByDeal, aucun fallback local.
//
import type jsPDF from "jspdf";
import type { MarchandSnapshotV1, RentabiliteInputs } from "../shared/marchandSnapshot.store";
import {
  autoTable,
  C, M, CW, PH,
  roundedBox,
  sectionTitle,
  fmtCurrency,
  fmtPercent,
  fmtNumber,
  sanitizeForPdf,
  decisionLabel,
  extractMetrics,
  normalizeAiReport,
  resolveSmartScores,
  computeSmartScoreV2,
  buildSnapshotPdfBlob,
  type ExportPdfOpts,
} from "./exportPdf";

// ─── Helpers de rendu ──────────────────────────────────────────────
function sc(doc: jsPDF, c: readonly [number, number, number]): void {
  doc.setTextColor(c[0], c[1], c[2]);
}

function accentBar(doc: jsPDF, x: number, y: number, w = 20, h = 1): void {
  const n = 20;
  const stepW = w / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    doc.setFillColor(
      Math.round(C.accent[0]    + t * (C.accentCyan[0] - C.accent[0])),
      Math.round(C.accent[1]    + t * (C.accentCyan[1] - C.accent[1])),
      Math.round(C.accent[2]    + t * (C.accentCyan[2] - C.accent[2])),
    );
    doc.rect(x + i * stepW, y, stepW + 0.5, h, "F");
  }
}

function cur(v: number | undefined, ndMsg = "ND"): string {
  return v != null ? fmtCurrency(v) : ndMsg;
}

// ─── Résolution du deal actif ──────────────────────────────────────
function resolveActiveDealId(snap: MarchandSnapshotV1): string | null {
  if (snap.activeDealId) return snap.activeDealId;
  if (snap.deals.length > 0) return snap.deals[0].id;
  return null;
}

/**
 * Lit les inputs rentabilité UNIQUEMENT pour ltvPct — seul champ
 * absent de DealMetrics. Ne PAS utiliser pour travaux / capitalEngage
 * / marge : ces valeurs viennent de extractMetrics() et sont identiques
 * sur toutes les pages du PDF.
 */
function getLtvFromRentabiliteInputs(
  snap: MarchandSnapshotV1,
  dealId: string | null,
): number | undefined {
  if (!dealId) return undefined;
  const renta = snap.rentabiliteByDeal[dealId];
  if (!renta?.inputs || typeof renta.inputs !== "object" || Array.isArray(renta.inputs)) {
    return undefined;
  }
  const inputs = renta.inputs as RentabiliteInputs;
  if (inputs.ltvPct == null) return undefined;
  const n = Number(inputs.ltvPct);
  return !isNaN(n) && n > 0 ? n : undefined;
}

// ═══════════════════════════════════════════════════════════════════
// ─── Synthese Institutionnelle — Banque / Financement ───────────────
// ═══════════════════════════════════════════════════════════════════
export function buildSyntheseInstitutionnellePage(
  doc: jsPDF,
  snap: MarchandSnapshotV1,
  opts?: ExportPdfOpts,
): void {
  doc.addPage();
  let y = M.top + 6;

  // ═══════════════════════════════════════════════════════════════
  // SOURCE CANONIQUE UNIQUE — identique à buildCover / buildPage1…3
  //
  // extractMetrics() → resolveCanonicalFinancials() applique la
  // chaîne de priorité suivante pour travaux :
  //   1. executionByDeal[id].travaux.computed.totalWithBuffer
  //   2. executionByDeal[id].travaux.computed.total
  //   3. rentabiliteByDeal[id].inputs.travauxEstimes / travaux / ...
  //   4. deal direct
  //
  // capitalEngage  = prixAchat + (travaux ?? 0) + fraisNotaire
  // margeBrute     = prixRevente - capitalEngage
  // margeBrutePct  = margeBrute / capitalEngage * 100
  //
  // Ces trois valeurs sont calculées UNE SEULE FOIS dans
  // resolveCanonicalFinancials() et propagées telles quelles.
  // ═══════════════════════════════════════════════════════════════
  const m      = extractMetrics(snap, opts);
  const ai     = normalizeAiReport(opts, m);
  const scores = resolveSmartScores(opts, opts?.aiReport?.analysis?.narrativeMarkdown, m);
  const v2     = computeSmartScoreV2(m, opts, opts?.aiReport?.analysis?.narrativeMarkdown);

  // ── LTV : seul champ absent de DealMetrics ─────────────────────
  // Priorité :
  //   1. ltvPct explicite dans rentabiliteByDeal[id].inputs
  //   2. m.montantPret / (m.prixAchat + m.travaux) — valeurs canoniques
  const activeDealId   = resolveActiveDealId(snap);
  const ltvFromInputs  = getLtvFromRentabiliteInputs(snap, activeDealId);

  const ltvResolved: number | undefined =
    ltvFromInputs ??
    (m.montantPret != null && m.prixAchat != null && m.prixAchat + (m.travaux ?? 0) > 0
      ? (m.montantPret / (m.prixAchat + (m.travaux ?? 0))) * 100
      : undefined);

  // ── DSCR ───────────────────────────────────────────────────────
  const dscr =
    m.mensualite != null && m.loyerEstim != null && m.mensualite > 0
      ? m.loyerEstim / m.mensualite
      : undefined;

  // ─── Header ────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  sc(doc, C.primary);
  doc.text("Synthese Institutionnelle - Banque / Financement", M.left, y);
  y += 3;
  accentBar(doc, M.left, y, 50, 1);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  sc(doc, C.body);
  doc.text(sanitizeForPdf(`Operation : ${m.titre}`), M.left, y);
  y += 4;
  if (m.adresseComplete) {
    doc.text(sanitizeForPdf(`Adresse : ${m.adresseComplete}`), M.left, y);
    y += 4;
  }
  y += 3;

  // ─── Tableau montage financier ─────────────────────────────────
  // Chaque cellule lit m.* directement — aucun recalcul.
  // Les valeurs sont strictement identiques à buildPage1/2/3.
  y = sectionTitle(doc, "Montage financier", y);

  const finRows: string[][] = [
    ["Prix d'acquisition",
      cur(m.prixAchat)],

    ["Surface",
      m.surfaceM2 != null
        ? sanitizeForPdf(`${fmtNumber(m.surfaceM2)} m2`)
        : "ND"],

    ["Prix / m2",
      m.prixM2 != null
        ? sanitizeForPdf(`${fmtCurrency(m.prixM2)} / m2`)
        : "ND (prix ou surface manquant)"],

    // m.travaux = resolveCanonicalFinancials().travaux (priorité executionByDeal)
    ["Travaux estimes",
      cur(m.travaux, "ND (devis requis)")],

    ["Frais de notaire",
      cur(m.fraisNotaire)],

    // m.capitalEngage = prixAchat + (travaux ?? 0) + fraisNotaire (unique calcul)
    ["Capital total engage",
      m.capitalEngage != null
        ? fmtCurrency(m.capitalEngage)
        : "ND (prix d'achat manquant)"],

    ["Prix de revente estime",
      cur(m.prixRevente, "ND (objectif non renseigne)")],

    // m.margeBrute / m.margeBrutePct calculés dans resolveCanonicalFinancials()
    ["Marge brute",
      m.margeBrute != null
        ? sanitizeForPdf(
            `${fmtCurrency(m.margeBrute)}${
              m.margeBrutePct != null ? ` (${fmtPercent(m.margeBrutePct)})` : ""
            }`,
          )
        : m.prixRevente == null
          ? "ND (revente cible manquante)"
          : "ND (capital engage non calculable)"],

    // m.apport / m.montantPret : resolveCanonicalFinancials priorité rentabiliteByDeal.inputs
    ["Apport personnel",
      m.apport != null ? fmtCurrency(m.apport) : "ND (non renseigne)"],

    ["Montant du pret",
      m.montantPret != null
        ? fmtCurrency(m.montantPret)
        : "ND (financement non renseigne)"],

    ["LTV (Loan-to-Value)",
      ltvResolved != null
        ? sanitizeForPdf(`${fmtNumber(ltvResolved, 1)} %`)
        : "ND (pret ou prix manquant)"],
  ];

  if (m.mensualite        != null) finRows.push(["Mensualite estimee",     fmtCurrency(m.mensualite)]);
  if (m.loyerEstim        != null) finRows.push(["Loyer estime (mensuel)", fmtCurrency(m.loyerEstim)]);
  if (dscr                != null) finRows.push(["DSCR",                   fmtNumber(dscr, 2)]);
  if (m.chargesMensuelles != null) finRows.push(["Charges mensuelles",     fmtCurrency(m.chargesMensuelles)]);

  autoTable(doc, {
    startY: y,
    body: finRows,
    margin: { left: M.left, right: M.right },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [C.body[0], C.body[1], C.body[2]],
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 65 },
      1: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [C.bg[0], C.bg[1], C.bg[2]] },
    theme: "plain",
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ─── Évaluation du risque ───────────────────────────────────────
  y = sectionTitle(doc, "Evaluation du risque", y);

  const ssStr =
    scores.smartScore != null
      ? scores.usedFallback
        ? `${scores.smartScore} (estim.)`
        : String(scores.smartScore)
      : "ND";

  const rpStr =
    v2.pillars.pressionRisque.value != null
      ? v2.pillars.pressionRisque.source === "estim"
        ? `${v2.pillars.pressionRisque.value} (estim.)`
        : String(v2.pillars.pressionRisque.value)
      : "ND";

  const sourceLabel: string =
    scores.source === "server"    ? "IA (serveur)"       :
    scores.source === "analysis"  ? "Calcul (donnees)"   :
    scores.source === "narrative" ? "IA (narratif)"      :
    scores.source === "fallback"  ? "Estimation locale"  :
                                    "Non disponible";

  const riskRows: string[][] = [
    ["Verdict IA",        sanitizeForPdf(decisionLabel(ai.verdict))],
    ["Confiance",         ai.confidence],
    ["SmartScore",        sanitizeForPdf(`${ssStr} / 100`)],
    ["Score de risque",   sanitizeForPdf(`${rpStr} / 100`)],
    ["Confiance donnees", sanitizeForPdf(`${v2.dataConfidence}/100 (${v2.dataConfidenceLabel})`)],
    ["Source scores",     sanitizeForPdf(sourceLabel)],
  ];

  if (ltvResolved != null) {
    riskRows.push([
      "LTV assessment",
      ltvResolved > 90  ? "Eleve - apport insuffisant" :
      ltvResolved > 80  ? "Standard"                   :
      ltvResolved <= 60 ? "Tres securise"              :
                          "Acceptable",
    ]);
  }

  if (dscr != null) {
    riskRows.push([
      "DSCR assessment",
      dscr >= 1.5 ? "Excellent"                      :
      dscr >= 1.2 ? "Bon"                            :
      dscr <  1.0 ? "Insuffisant - risque de defaut" :
                    "Correct",
    ]);
  }

  autoTable(doc, {
    startY: y,
    body: riskRows,
    margin: { left: M.left, right: M.right },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [C.body[0], C.body[1], C.body[2]],
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 65 },
      1: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [C.bgAlt[0], C.bgAlt[1], C.bgAlt[2]] },
    theme: "plain",
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ─── Comprendre les SmartScores ────────────────────────────────
  y = sectionTitle(doc, "Comprendre les SmartScores", y, { fontSize: 9 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  sc(doc, C.body);

  for (const line of [
    "SmartScore: note globale sur 100 combinant rendement, risque et liquidite.",
    "Liquidite: capacite a revendre rapidement au prix de marche.",
    "Opportunity: potentiel de creation de valeur vs prix d'achat.",
    "Pression Risque: niveau de fragilite globale du projet.",
    "Rentabilite: performance financiere brute et nette.",
    "Robustesse: resistance aux imprevus (travaux, delais, charges).",
    "Interpretation: >70 solide, 50-70 moyen, <50 fragile.",
    "Leviers: negocier le prix, fiabiliser les travaux, securiser loyers/charges.",
  ]) {
    doc.text(sanitizeForPdf(line), M.left, y, { maxWidth: CW });
    y += 3.5;
  }
  y += 4;

  // ─── Disclaimer ────────────────────────────────────────────────
  if (y < PH - M.bottom - 15) {
    roundedBox(doc, M.left, y, CW, 12, { fill: C.bg, border: C.border, radius: 2 });
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    sc(doc, C.muted);
    doc.text(
      sanitizeForPdf(
        "Ce document est genere automatiquement par Mimmoza. " +
        "Les donnees financieres sont indicatives et ne constituent pas un conseil en investissement.",
      ),
      M.left + 4,
      y + 4,
      { maxWidth: CW - 8 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// ─── Preview PDF (blob URL pour iframe) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export function exportSnapshotToPdfBlobUrl(
  snapshot: MarchandSnapshotV1,
  opts?: ExportPdfOpts,
): string {
  const blob = buildSnapshotPdfBlob(snapshot, opts);
  return URL.createObjectURL(blob);
}