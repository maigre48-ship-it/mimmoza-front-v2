// src/spaces/investisseur/pages/deal-center/exports/exportQualification.ts
//
// Export PDF – Synthèse Qualification  v2.0
// Style premium identique à exportDataConfidence
// Logique métier : 100% inchangée

import { jsPDF } from "jspdf";
import {
  alertBox,
  BODY_START,
  C,
  CW,
  drawPageHeader, drawPremiumFooter,
  drawPremiumHeader,
  floatCard,
  fmtEur, fmtPct,
  hGrad,
  kpiCard,
  kvRow,
  ML,
  pill,
  sectionHead,
  tableBlock, verdictCard
} from "./exportPremiumPdf.utils";

import {
  ensureActiveDeal,
  readMarchandSnapshot,
} from "../../../../marchand/shared/marchandSnapshot.store";

// ─── Types & logique métier (inchangés) ──────────────────────────────────────

interface QualifInput {
  dealName:    string;
  address:     string;
  smartScore:  number | null;
  rendement:   number | null;
  cashflow:    number | null;
  prixAchat:   number | null;
  surface:     number | null;
  killSwitches: { label: string; triggered: boolean }[];
  points:      { label: string; type: "positive" | "negative" | "neutral" }[];
  recommandation: "GO" | "NO GO" | "A ETUDIER" | null;
}

function extractQualifInput(): QualifInput {
  const snap  = readMarchandSnapshot();
  const deal  = ensureActiveDeal();
  const id    = deal?.id ?? null;
  const renta = id ? snap.rentabiliteByDeal[id]?.computed : undefined;
  const marche = id ? snap.marcheRisquesByDeal[id]?.data : undefined;

  const smartScore = (snap as any).smartScoreByDeal?.[id ?? ""]?.score ?? null;
  const scenarios  = (renta as any)?.scenarios;
  const base       = scenarios?.base;
  const rendement  = base?.rendementBrut ?? null;
  const cashflow   = base?.cashflowMensuel ?? null;

  const killSwitches: QualifInput["killSwitches"] = [
    { label: "Rendement brut < 4 %",    triggered: rendement != null && rendement < 4 },
    { label: "Cashflow mensuel negatif", triggered: cashflow != null && cashflow < 0 },
    { label: "Aucune donnee marche",     triggered: !marche },
    { label: "SmartScore < 30",          triggered: smartScore != null && smartScore < 30 },
  ];

  const points: QualifInput["points"] = [
    ...(rendement != null && rendement >= 6
      ? [{ label: `Rendement brut attractif (${fmtPct(rendement)})`, type: "positive" as const }] : []),
    ...(cashflow != null && cashflow > 0
      ? [{ label: `Cashflow positif (${fmtEur(cashflow)}/mois)`, type: "positive" as const }] : []),
    ...(marche
      ? [{ label: "Donnees marche disponibles", type: "positive" as const }]
      : [{ label: "Donnees marche manquantes",  type: "negative" as const }]),
    ...(smartScore != null && smartScore >= 60
      ? [{ label: `SmartScore eleve (${smartScore}/100)`, type: "positive" as const }] : []),
    ...(smartScore != null && smartScore < 40
      ? [{ label: `SmartScore faible (${smartScore}/100)`, type: "negative" as const }] : []),
  ];

  const triggered = killSwitches.filter((k) => k.triggered).length;
  let recommandation: QualifInput["recommandation"] = null;
  if (triggered === 0 && rendement != null && rendement >= 5) recommandation = "GO";
  else if (triggered >= 2) recommandation = "NO GO";
  else recommandation = "A ETUDIER";

  return {
    dealName:  deal?.nom ?? deal?.address ?? "Deal sans nom",
    address:   deal?.address ?? "-",
    smartScore,
    rendement,
    cashflow,
    prixAchat: deal?.prixAchat ?? null,
    surface:   deal?.surfaceM2 ?? null,
    killSwitches,
    points,
    recommandation,
  };
}

// ─── Génération PDF ───────────────────────────────────────────────────────────

export async function exportQualificationPdf(): Promise<void> {
  const data = extractQualifInput();
  const TITLE    = "Synthese Qualification";
  const SUBTITLE = "Scorecard  \u2022  Points cles  \u2022  Recommandation Mimmoza";
  const PAGES    = 2;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — Header + KPIs + SmartScore
  // ════════════════════════════════════════════════════════════════

  const logoDataUrl = await drawPremiumHeader(doc, TITLE, SUBTITLE, data.dealName);

  let y = BODY_START;

  // ── KPI row — 4 cartes ──────────────────────────────────────────
  const KPI_H = 28;
  const KPI_GAP = 3;
  const KPI_W = (CW - KPI_GAP * 3) / 4;

  const ssColor = data.smartScore == null ? C.slate400 :
    data.smartScore >= 70 ? C.green600 : data.smartScore >= 40 ? C.amber600 : C.red600;
  const ssColorBg = data.smartScore == null ? C.slate100 :
    data.smartScore >= 70 ? C.green50 : data.smartScore >= 40 ? C.amber50 : C.red50;
  const rendColor = data.rendement == null ? C.slate400 :
    data.rendement >= 5 ? C.green600 : data.rendement >= 3 ? C.amber600 : C.red600;
  const cfColor = data.cashflow == null ? C.slate400 :
    data.cashflow > 0 ? C.green600 : C.red600;

  kpiCard(doc, ML + 0 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "SmartScore", data.smartScore != null ? `${data.smartScore}` : "-", "Sur 100",
    ssColor, ssColorBg);

  kpiCard(doc, ML + 1 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Rendement brut", data.rendement != null ? `${data.rendement.toFixed(1)}%` : "-", "Objectif >= 5%",
    rendColor, data.rendement == null ? C.slate100 : data.rendement >= 5 ? C.green50 : C.amber50);

  kpiCard(doc, ML + 2 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Cashflow /mois", data.cashflow != null ? `${Math.round(data.cashflow)} EUR` : "-", "Objectif > 0",
    cfColor, data.cashflow == null ? C.slate100 : data.cashflow >= 0 ? C.green50 : C.red50);

  // Carte score violet dominante pour recommandation
  const k4x = ML + 3 * (KPI_W + KPI_GAP);
  const recColor =
    data.recommandation === "GO"    ? C.green600 :
    data.recommandation === "NO GO" ? C.red600   : C.amber600;
  const recGrad2 =
    data.recommandation === "GO"    ? C.green500 :
    data.recommandation === "NO GO" ? C.red400   : C.amber400;

  const cardShadows = [{ dy: 0.8, op: 0.12 }, { dy: 1.6, op: 0.07 }, { dy: 2.8, op: 0.04 }];
  for (const s of cardShadows) {
    doc.setGState(doc.GState({ opacity: s.op }));
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(k4x, y + s.dy, KPI_W, KPI_H, 5, 5, "F");
  }
  doc.setGState(doc.GState({ opacity: 1 }));
  hGrad(doc, k4x, y, KPI_W, KPI_H, recColor, recGrad2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...C.white);
  doc.text("RECOMMANDATION", k4x + KPI_W / 2, y + 5, { align: "center" });
  doc.setFontSize(16);
  doc.text(data.recommandation ?? "-", k4x + KPI_W / 2, y + 18, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setGState(doc.GState({ opacity: 0.75 }));
  doc.text("Mimmoza Copilot", k4x + KPI_W / 2, y + KPI_H - 2.5, { align: "center" });
  doc.setGState(doc.GState({ opacity: 1 }));

  y += KPI_H + 7;

  // ── Kill switches ───────────────────────────────────────────────
  y = sectionHead(doc, "KILL SWITCHES", y);

  const ksRows = data.killSwitches.map((k) => ({
    critere: k.label,
    statut:  k.triggered ? "DECLENCHE" : "OK",
  }));
  y = tableBlock(doc, [
    { header: "Critere",  key: "critere", w: CW - 38 },
    { header: "Statut",   key: "statut",  w: 38, align: "right",
      colorFn: (v) => v === "DECLENCHE" ? C.red600 : C.green600 },
  ], ksRows, y);
  y += 4;

  // ── Points clés ─────────────────────────────────────────────────
  y = sectionHead(doc, "POINTS CLES", y);

  const positifs = data.points.filter((p) => p.type === "positive");
  const negatifs = data.points.filter((p) => p.type !== "positive");

  const allPoints = [...positifs, ...negatifs];
  const ITEM_H = 9;
  const ITEM_GAP = 2;

  allPoints.forEach((pt) => {
    const isPos = pt.type === "positive";
    const col   = isPos ? C.green600 : C.red600;
    const colBg = isPos ? C.green50  : C.red50;
    const colBdr= isPos ? C.green500 : C.red400;

    floatCard(doc, ML, y, CW, ITEM_H, 4, C.white, C.slate200);
    // Dot
    doc.setFillColor(...col);
    doc.circle(ML + 7, y + ITEM_H / 2, 2.5, "F");
    // Texte
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.slate800);
    doc.text(pt.label, ML + 12, y + ITEM_H / 2 + 1.5);
    // Badge
    const bLabel = isPos ? "FAVORABLE" : "VIGILANCE";
    const bw = 26;
    pill(doc, ML + CW - bw - 2, y + ITEM_H / 2 - 2.5, bw, 5, bLabel, colBg, col, colBdr);

    y += ITEM_H + ITEM_GAP;
  });

  if (allPoints.length === 0) {
    y = alertBox(doc, "Aucun point cle identifie - completer les donnees financieres et marche.", "info", y);
  }

  drawPremiumFooter(doc);

  // ════════════════════════════════════════════════════════════════
  // PAGE 2 — Indicateurs + Recommandation détaillée
  // ════════════════════════════════════════════════════════════════

  doc.addPage();
  drawPageHeader(doc, TITLE, 2, PAGES, data.dealName, logoDataUrl);
  y = BODY_START;

  // ── Indicateurs financiers ──────────────────────────────────────
  y = sectionHead(doc, "INDICATEURS FINANCIERS", y);

  const kvCard_H = 52;
  floatCard(doc, ML, y, CW, kvCard_H, 5, C.white, C.slate200);
  let ky = y + 8;
  ky = kvRow(doc, "Prix d'acquisition",  fmtEur(data.prixAchat),  ky, { bold: true });
  ky = kvRow(doc, "Surface habitable",   data.surface ? `${data.surface} m2` : "-", ky);
  ky = kvRow(doc, "Rendement brut",      fmtPct(data.rendement),  ky, { bold: true, color: rendColor });
  ky = kvRow(doc, "Cashflow mensuel",    fmtEur(data.cashflow),   ky, { bold: true, color: cfColor });
  ky = kvRow(doc, "SmartScore",          data.smartScore != null ? `${data.smartScore} / 100` : "-", ky, { bold: true, color: ssColor });
  y += kvCard_H + 8;

  // ── Recommandation ──────────────────────────────────────────────
  y = sectionHead(doc, "RECOMMANDATION MIMMOZA", y);

  const recText =
    data.recommandation === "GO"
      ? "Ce deal presente des indicateurs favorables. Les criteres de qualification sont satisfaits. La position peut etre soumise a decision."
      : data.recommandation === "NO GO"
      ? "Plusieurs kill switches sont declenches. Ce deal ne satisfait pas les criteres minimaux d'investissement. Des ajustements sont necessaires."
      : "Des donnees complementaires sont necessaires pour statuer. Completer les informations financieres et de marche avant decision.";

  y = verdictCard(doc, data.recommandation ?? "A ETUDIER", recText, y);

  drawPremiumFooter(doc);

  const filename = `Mimmoza_Qualification_${data.dealName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}