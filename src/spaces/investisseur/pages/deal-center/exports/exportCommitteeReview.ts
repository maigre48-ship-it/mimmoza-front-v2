// src/spaces/investisseur/pages/deal-center/exports/exportCommitteeReview.ts
//
// Export PDF â€“ Rapport Comite d'Investissement  v2.0
// Style premium identique Ã  exportDataConfidence
// Logique mÃ©tier : 100% inchangÃ©e

import { jsPDF } from "jspdf";
import {
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
  sectionHead,
  tableBlock,
  today,
  verdictCard,
  verdictCol
} from "./exportPremiumPdf.utils";

import {
  ensureActiveDeal,
  readMarchandSnapshot,
} from "../../../../marchand/shared/marchandSnapshot.store";
import type { RentabiliteSnapshot } from "../../../types/rentabilite.types";

// â”€â”€â”€ Logique mÃ©tier (100% inchangÃ©e) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CritereComite {
  categorie: string;
  critere:   string;
  seuil:     string;
  valeur:    string;
  verdict:   "GO" | "NO GO" | "ATTENTION" | "N/A";
}

function buildGrilleDecision(deal: any, renta: any, marche: any): CritereComite[] {
  const base = renta?.scenarios?.base;
  const rendBrut  = base?.rendementBrut  ?? null;
  const rendNet   = base?.rendementNet   ?? null;
  const cashflow  = base?.cashflowMensuel ?? null;
  const tri5      = base?.tri5ans        ?? null;
  const medianeM2 = marche?.dvf?.medianeM2 ?? null;
  const prixM2    = deal?.prixAchat && deal?.surfaceM2 ? Math.round(deal.prixAchat / deal.surfaceM2) : null;

  const v = (val: string, verdict: CritereComite["verdict"]) => ({ valeur: val, verdict });

  return [
    {
      categorie: "Rentabilite",
      critere: "Rendement brut",
      seuil: ">=5 %",
      ...(rendBrut == null ? v("-", "N/A") :
          rendBrut >= 6 ? v(fmtPct(rendBrut), "GO") :
          rendBrut >= 5 ? v(fmtPct(rendBrut), "ATTENTION") :
          v(fmtPct(rendBrut), "NO GO")),
    },
    {
      categorie: "Rentabilite",
      critere: "Rendement net",
      seuil: ">=3 %",
      ...(rendNet == null ? v("-", "N/A") :
          rendNet >= 3.5 ? v(fmtPct(rendNet), "GO") :
          rendNet >= 3   ? v(fmtPct(rendNet), "ATTENTION") :
          v(fmtPct(rendNet), "NO GO")),
    },
    {
      categorie: "Cashflow",
      critere: "Cashflow mensuel",
      seuil: "> 0 EUR",
      ...(cashflow == null ? v("-", "N/A") :
          cashflow > 100 ? v(fmtEur(cashflow), "GO") :
          cashflow >= 0  ? v(fmtEur(cashflow), "ATTENTION") :
          v(fmtEur(cashflow), "NO GO")),
    },
    {
      categorie: "Cashflow",
      critere: "TRI 5 ans",
      seuil: ">=6 %",
      ...(tri5 == null ? v("-", "N/A") :
          tri5 >= 8 ? v(fmtPct(tri5), "GO") :
          tri5 >= 6 ? v(fmtPct(tri5), "ATTENTION") :
          v(fmtPct(tri5), "NO GO")),
    },
    {
      categorie: "Marche",
      critere: "Prix achat vs mediane DVF",
      seuil: "<= mediane",
      ...(prixM2 == null || medianeM2 == null ? v("-", "N/A") :
          prixM2 <= medianeM2 * 0.9 ? v(`${fmtEur(prixM2)}/m2`, "GO") :
          prixM2 <= medianeM2       ? v(`${fmtEur(prixM2)}/m2`, "ATTENTION") :
          v(`${fmtEur(prixM2)}/m2 > mediane`, "NO GO")),
    },
    {
      categorie: "Risques",
      critere: "Risque inondation",
      seuil: "< Fort",
      ...(!marche?.risques?.inondation ? v("-", "N/A") :
          marche.risques.inondation.toLowerCase().includes("fort") ? v(marche.risques.inondation, "NO GO") :
          marche.risques.inondation.toLowerCase().includes("moyen") ? v(marche.risques.inondation, "ATTENTION") :
          v(marche.risques.inondation, "GO")),
    },
    {
      categorie: "Qualite",
      critere: "DPE",
      seuil: ">=D",
      ...(!deal?.dpe ? v("-", "N/A") :
          ["A","B","C","D"].includes(deal.dpe) ? v(deal.dpe, "GO") :
          deal.dpe === "E" ? v(deal.dpe, "ATTENTION") :
          v(deal.dpe, "NO GO")),
    },
  ];
}

function calcVerdictGlobal(grille: CritereComite[]): "GO" | "NO GO" | "CONDITIONNEL" {
  const noGo = grille.filter((g) => g.verdict === "NO GO").length;
  const attn = grille.filter((g) => g.verdict === "ATTENTION").length;
  const critiques = grille.filter((g) => g.verdict === "NO GO" && ["Rentabilite","Cashflow"].includes(g.categorie));
  if (critiques.length >= 1 || noGo >= 3) return "NO GO";
  if (noGo === 0 && attn <= 1) return "GO";
  return "CONDITIONNEL";
}

// â”€â”€â”€ GÃ©nÃ©ration PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function exportCommitteeReviewPdf(): Promise<void> {
  const snap     = readMarchandSnapshot();
  const deal     = ensureActiveDeal();
  const id       = deal?.id ?? null;
  const renta    = (id ? snap.rentabiliteByDeal[id]?.computed : undefined) as RentabiliteSnapshot | undefined;
  const marche   = (id ? snap.marcheRisquesByDeal[id]?.data : undefined) as any;
  const dealName = deal?.nom ?? deal?.address ?? "Deal sans nom";

  const grille        = buildGrilleDecision(deal, renta, marche);
  const verdictGlobal = calcVerdictGlobal(grille);
  const goCount       = grille.filter((g) => g.verdict === "GO").length;
  const noGoCount     = grille.filter((g) => g.verdict === "NO GO").length;
  const attnCount     = grille.filter((g) => g.verdict === "ATTENTION").length;
  const naCount       = grille.filter((g) => g.verdict === "N/A").length;

  const TITLE    = "Rapport Comite d'Investissement";
  const SUBTITLE = "Grille de decision  \u2022  Verdict GO / NO GO  \u2022  Conditions suspensives";
  const PAGES    = 2;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PAGE 1 â€” Header + KPIs + Fiche deal
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const logoDataUrl = await drawPremiumHeader(doc, TITLE, SUBTITLE, dealName);
  let y = BODY_START;

  // â”€â”€ KPIs compteurs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const KPI_H = 26;
  const KPI_GAP = 3;
  const KPI_W = (CW - KPI_GAP * 3) / 4;

  kpiCard(doc, ML + 0 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Criteres GO", `${goCount}`, `Sur ${grille.length} criteres`, C.green600, C.green50);
  kpiCard(doc, ML + 1 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Attention", `${attnCount}`, "A surveiller", C.amber600, C.amber50);
  kpiCard(doc, ML + 2 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Criteres NO GO", `${noGoCount}`, "Bloquants", noGoCount > 0 ? C.red600 : C.green600, noGoCount > 0 ? C.red50 : C.green50);

  // Carte verdict violet
  const vk4x = ML + 3 * (KPI_W + KPI_GAP);
  const vGrad1 = verdictGlobal === "GO" ? C.green600 : verdictGlobal === "NO GO" ? C.red600 : C.amber600;
  const vGrad2 = verdictGlobal === "GO" ? C.green500 : verdictGlobal === "NO GO" ? C.red400 : C.amber400;
  for (const s of [{ dy: 0.8, op: 0.12 }, { dy: 1.6, op: 0.07 }]) {
    doc.setGState(doc.GState({ opacity: s.op }));
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(vk4x, y + s.dy, KPI_W, KPI_H, 5, 5, "F");
  }
  doc.setGState(doc.GState({ opacity: 1 }));
  hGrad(doc, vk4x, y, KPI_W, KPI_H, vGrad1, vGrad2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...C.white);
  doc.text("VERDICT GLOBAL", vk4x + KPI_W / 2, y + 5, { align: "center" });
  doc.setFontSize(14);
  doc.text(verdictGlobal, vk4x + KPI_W / 2, y + 17, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setGState(doc.GState({ opacity: 0.75 }));
  doc.text("Comite Mimmoza", vk4x + KPI_W / 2, y + KPI_H - 2.5, { align: "center" });
  doc.setGState(doc.GState({ opacity: 1 }));

  y += KPI_H + 7;

  // â”€â”€ Fiche deal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "FICHE DE PRESENTATION", y);

  const FICHE_H = 46;
  floatCard(doc, ML, y, CW, FICHE_H, 5, C.white, C.slate200);
  let ky = y + 7;
  ky = kvRow(doc, "Deal / Reference",    dealName,                    ky, { bold: true });
  ky = kvRow(doc, "Adresse",             deal?.address ?? "-",         ky);
  ky = kvRow(doc, "Prix d'acquisition",  fmtEur(deal?.prixAchat),     ky);
  ky = kvRow(doc, "Surface",             deal?.surfaceM2 ? `${deal.surfaceM2} m2` : "-", ky);
  ky = kvRow(doc, "Type de bien",        (deal as any)?.typeBien ?? "-", ky);
  ky = kvRow(doc, "Date du comite",      today(),                      ky);
  y += FICHE_H + 7;

  drawPremiumFooter(doc);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PAGE 2 â€” Grille + Verdict + Conditions
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  doc.addPage();
  drawPageHeader(doc, TITLE, 2, PAGES, dealName, logoDataUrl);
  y = BODY_START;

  // â”€â”€ Grille de decision â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "GRILLE DE DECISION", y);

  y = tableBlock(doc, [
    { header: "Categorie",  key: "categorie", w: 32 },
    { header: "Critere",    key: "critere",   w: 54 },
    { header: "Seuil",      key: "seuil",     w: 28 },
    { header: "Valeur",     key: "valeur",    w: 38, align: "right" },
    { header: "Verdict",    key: "verdict",   w: 34, align: "right",
      colorFn: (v) => verdictCol(v) },
  ], grille.map((g) => ({
    categorie: g.categorie,
    critere:   g.critere,
    seuil:     g.seuil,
    valeur:    g.valeur,
    verdict:   g.verdict,
  })), y);
  y += 5;

  // â”€â”€ Verdict global â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "VERDICT DU COMITE", y);

  const vText =
    verdictGlobal === "GO"
      ? "L'ensemble des criteres de rentabilite et de marche sont satisfaits. Le comite emet un avis favorable a l'investissement."
      : verdictGlobal === "NO GO"
      ? "Un ou plusieurs criteres bloquants sont identifies. Le comite emet un avis defavorable. Des renÃ©gociations sont necessaires avant toute decision."
      : "Certains criteres sont en zone d'attention. Le comite emet un avis conditionnel. Des verifications complementaires sont requises.";

  y = verdictCard(doc, verdictGlobal, vText, y);
  y += 5;

  // â”€â”€ Conditions suspensives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "CONDITIONS SUSPENSIVES RECOMMANDEES", y);

  const conditions: string[] = [];
  const noGoItems = grille.filter((g) => g.verdict === "NO GO");
  const attnItems = grille.filter((g) => g.verdict === "ATTENTION");

  if (noGoItems.some((g) => g.critere.includes("endement")))
    conditions.push("Renegociation du prix d'acquisition pour atteindre le seuil de rendement minimum.");
  if (noGoItems.some((g) => g.critere.includes("ashflow") || g.critere.includes("TRI")))
    conditions.push("Revision des charges previsionnelles ou du loyer cible.");
  if (noGoItems.some((g) => g.critere.includes("inondation")))
    conditions.push("Obtention d'un rapport ERNMT complet et verification de la couverture assurance.");
  if (attnItems.some((g) => g.critere.includes("DVF") || g.critere.includes("mediane")))
    conditions.push("Confirmation du prix de marche par expertise ou agent immobilier local.");
  if (noGoItems.some((g) => g.critere.includes("DPE")))
    conditions.push("Audit energetique et chiffrage des travaux de renovation thermique obligatoires.");
  if (conditions.length === 0)
    conditions.push("Aucune condition bloquante identifiee. Proceder aux due diligences juridiques standard.");

  const COND_H = 10;
  const COND_GAP = 2;
  conditions.forEach((cond) => {
    floatCard(doc, ML, y, CW, COND_H, 4, C.white, C.slate200);
    doc.setFillColor(...C.indigo600);
    doc.circle(ML + 6, y + COND_H / 2, 1.8, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...C.slate700);
    doc.text(cond, ML + 10, y + COND_H / 2 + 1.5, { maxWidth: CW - 14 });
    y += COND_H + COND_GAP;
  });

  drawPremiumFooter(doc);

  const filename = `Mimmoza_RapportComite_${dealName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
