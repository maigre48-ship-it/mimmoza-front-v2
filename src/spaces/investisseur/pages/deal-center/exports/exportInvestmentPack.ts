// src/spaces/investisseur/pages/deal-center/exports/exportInvestmentPack.ts
//
// Export PDF â€“ Investment Pack  v2.0
// Style premium identique Ã  exportDataConfidence
// Logique mÃ©tier : 100% inchangÃ©e

import { jsPDF } from "jspdf";
import {
  alertBox,
  BODY_START,
  C,
  CW,
  drawPageHeader, drawPremiumFooter,
  drawPremiumHeader,
  floatCard,
  fmt,
  fmtEur, fmtPct,
  hGrad,
  kpiCard,
  kvRow,
  ML,
  sectionHead,
  tableBlock
} from "./exportPremiumPdf.utils";

import {
  ensureActiveDeal,
  readMarchandSnapshot,
  type MarcheRisquesSaved,
  type RentabiliteSaved,
} from "../../../../marchand/shared/marchandSnapshot.store";
import type { RentabiliteSnapshot } from "../../../types/rentabilite.types";

function castRenta(saved: RentabiliteSaved | undefined): RentabiliteSnapshot | null {
  if (!saved?.computed) return null;
  return saved.computed as RentabiliteSnapshot;
}

// â”€â”€â”€ GÃ©nÃ©ration PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function exportInvestmentPackPdf(): Promise<void> {
  const snap   = readMarchandSnapshot();
  const deal   = ensureActiveDeal();
  const id     = deal?.id ?? null;
  const renta  = castRenta(id ? snap.rentabiliteByDeal[id] : undefined);
  const marche = (id ? snap.marcheRisquesByDeal[id] : undefined) as MarcheRisquesSaved | undefined;

  const dealName   = deal?.title ?? deal?.address ?? "Deal sans nom";
  const address    = deal?.address ?? "-";
  const base       = (renta as any)?.scenarios?.base;
  const pessimiste = (renta as any)?.scenarios?.pessimiste;
  const optimiste  = (renta as any)?.scenarios?.optimiste;
  const dvf        = (marche?.data as any)?.dvf;
  const risques    = (marche?.data as any)?.risques;

  const TITLE    = "Investment Pack";
  const SUBTITLE = "Fiche deal  \u2022  Rentabilite  \u2022  DVF  \u2022  Risques synthetiques";
  const PAGES    = 3;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PAGE 1 â€” Header + KPIs + Fiche deal
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const logoDataUrl = await drawPremiumHeader(doc, TITLE, SUBTITLE, dealName);
  let y = BODY_START;

  // â”€â”€ KPI row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const KPI_H = 28;
  const KPI_GAP = 3;
  const KPI_W = (CW - KPI_GAP * 3) / 4;

  const rendBrut = base?.rendementBrut ?? null;
  const cf       = base?.cashflowMensuel ?? null;
  const tri5     = base?.tri5ans ?? null;

  const rendCol  = rendBrut == null ? C.slate400 : rendBrut >= 5 ? C.green600 : rendBrut >= 3 ? C.amber600 : C.red600;
  const cfCol    = cf == null       ? C.slate400 : cf > 0 ? C.green600 : C.red600;
  const triCol   = tri5 == null     ? C.slate400 : tri5 >= 6 ? C.green600 : tri5 >= 3 ? C.amber600 : C.red600;

  kpiCard(doc, ML + 0 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Rendement brut", rendBrut != null ? `${rendBrut.toFixed(1)}%` : "-", "Objectif >= 5%",
    rendCol, rendBrut == null ? C.slate100 : rendBrut >= 5 ? C.green50 : C.amber50);

  kpiCard(doc, ML + 1 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Cashflow /mois", cf != null ? `${Math.round(cf)} EUR` : "-", "Objectif > 0 EUR",
    cfCol, cf == null ? C.slate100 : cf >= 0 ? C.green50 : C.red50);

  kpiCard(doc, ML + 2 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "TRI 5 ans", tri5 != null ? `${tri5.toFixed(1)}%` : "-", "Objectif >= 6%",
    triCol, tri5 == null ? C.slate100 : tri5 >= 6 ? C.green50 : C.amber50);

  // Carte violette prix m2 DVF
  const medM2 = dvf?.medianeM2 ?? null;
  const k4x = ML + 3 * (KPI_W + KPI_GAP);
  for (const s of [{ dy: 0.8, op: 0.12 }, { dy: 1.6, op: 0.07 }]) {
    doc.setGState(doc.GState({ opacity: s.op }));
    doc.setFillColor(...C.indigo900);
    doc.roundedRect(k4x, y + s.dy, KPI_W, KPI_H, 5, 5, "F");
  }
  doc.setGState(doc.GState({ opacity: 1 }));
  hGrad(doc, k4x, y, KPI_W, KPI_H, C.violet600, C.indigo600);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...C.white);
  doc.text("MEDIANE DVF", k4x + KPI_W / 2, y + 5, { align: "center" });
  doc.setFontSize(13);
  doc.text(medM2 != null ? fmt(medM2) : "-", k4x + KPI_W / 2, y + 17, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setGState(doc.GState({ opacity: 0.8 }));
  doc.text("EUR / m2", k4x + KPI_W / 2, y + KPI_H - 2.5, { align: "center" });
  doc.setGState(doc.GState({ opacity: 1 }));

  y += KPI_H + 7;

  // â”€â”€ Fiche deal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "FICHE DEAL", y);

  const FICHE_H = 58;
  floatCard(doc, ML, y, CW, FICHE_H, 5, C.white, C.slate200);
  let ky = y + 7;
  ky = kvRow(doc, "Nom / Reference",       dealName,                                        ky, { bold: true });
  ky = kvRow(doc, "Adresse",               address,                                          ky);
  ky = kvRow(doc, "Type de bien",          (deal as any)?.typeBien ?? "-",                   ky);
  ky = kvRow(doc, "Surface habitable",     deal?.surfaceM2 ? `${deal.surfaceM2} m2` : "-",   ky);
  ky = kvRow(doc, "Nb pieces",             (deal as any)?.nbPieces ? String((deal as any).nbPieces) : "-", ky);
  ky = kvRow(doc, "Annee construction",    (deal as any)?.anneeConstruction ? String((deal as any).anneeConstruction) : "-", ky);
  ky = kvRow(doc, "DPE",                   (deal as any)?.dpe ?? "-",                        ky);
  ky = kvRow(doc, "Prix d'acquisition",    fmtEur(deal?.prixAchat),                         ky, { bold: true });
  y += FICHE_H + 5;

  drawPremiumFooter(doc);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PAGE 2 â€” HypothÃ¨ses + ScÃ©narios
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  doc.addPage();
  drawPageHeader(doc, TITLE, 2, PAGES, dealName, logoDataUrl);
  y = BODY_START;

  // â”€â”€ HypothÃ¨ses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "HYPOTHESES FINANCIERES", y);

  const HYPO_H = 74;
  floatCard(doc, ML, y, CW, HYPO_H, 5, C.white, C.slate200);
  let hy = y + 7;
  hy = kvRow(doc, "Prix d'acquisition",  fmtEur(deal?.prixAchat),              hy, { bold: true });
  hy = kvRow(doc, "Frais de notaire",    fmtEur((deal as any)?.fraisNotaire),   hy);
  hy = kvRow(doc, "Travaux estimes",     fmtEur((deal as any)?.travaux),        hy);
  hy = kvRow(doc, "Cout total projet",   fmtEur(base?.coutTotalProjet),         hy, { bold: true });
  hy = kvRow(doc, "Loyer mensuel HC",    fmtEur(deal?.prixAchat ? null : null), hy);  // placeholder
  hy = kvRow(doc, "Charges mensuelles",  fmtEur((deal as any)?.chargesMensuelles), hy);
  hy = kvRow(doc, "Vacance locative",    fmtPct((deal as any)?.vacanceLocative), hy);
  hy = kvRow(doc, "Taux emprunt",        fmtPct((deal as any)?.tauxEmprunt),    hy);
  hy = kvRow(doc, "Duree emprunt",       (deal as any)?.dureeEmprunt ? `${(deal as any).dureeEmprunt} ans` : "-", hy);
  hy = kvRow(doc, "Apport personnel",    fmtEur((deal as any)?.apport),         hy);
  y += HYPO_H + 7;

  // â”€â”€ ScÃ©narios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "RESULTATS â€” 3 SCENARIOS", y);

  if (!base) {
    y = alertBox(doc, "Aucune donnee de rentabilite disponible. Completer l'onglet Financial Engine.", "warning", y);
  } else {
    y = tableBlock(doc, [
      { header: "Indicateur",        key: "label", w: 60 },
      { header: "Pessimiste",        key: "pess",  w: 40, align: "right" },
      { header: "Base",              key: "base",  w: 40, align: "right" },
      { header: "Optimiste",         key: "opti",  w: 46, align: "right" },
    ], [
      { label: "Rendement brut",    pess: fmtPct(pessimiste?.rendementBrut),    base: fmtPct(base?.rendementBrut),    opti: fmtPct(optimiste?.rendementBrut)    },
      { label: "Rendement net",     pess: fmtPct(pessimiste?.rendementNet),     base: fmtPct(base?.rendementNet),     opti: fmtPct(optimiste?.rendementNet)     },
      { label: "Cashflow mensuel",  pess: fmtEur(pessimiste?.cashflowMensuel),  base: fmtEur(base?.cashflowMensuel),  opti: fmtEur(optimiste?.cashflowMensuel)  },
      { label: "Cashflow annuel",   pess: fmtEur(pessimiste?.cashflowAnnuel),   base: fmtEur(base?.cashflowAnnuel),   opti: fmtEur(optimiste?.cashflowAnnuel)   },
      { label: "TRI 5 ans",         pess: fmtPct(pessimiste?.tri5ans),          base: fmtPct(base?.tri5ans),          opti: fmtPct(optimiste?.tri5ans)          },
      { label: "Effort epargne/mois",pess: fmtEur(pessimiste?.effortEpargne),   base: fmtEur(base?.effortEpargne),    opti: fmtEur(optimiste?.effortEpargne)    },
    ], y);
  }

  drawPremiumFooter(doc);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PAGE 3 â€” DVF + Risques
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  doc.addPage();
  drawPageHeader(doc, TITLE, 3, PAGES, dealName, logoDataUrl);
  y = BODY_START;

  // â”€â”€ Comparables DVF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "COMPARABLES DVF", y);

  const comps: Record<string, string>[] = Array.isArray(dvf?.comparables)
    ? dvf.comparables.slice(0, 6).map((c: any) => ({
        adresse: (c.adresse ?? c.rue ?? "-").slice(0, 30),
        surface: c.surface_reelle_bati ? `${fmt(c.surface_reelle_bati)} m2` : "-",
        date:    c.date_mutation?.slice(0, 7) ?? "-",
        prix:    fmtEur(c.valeur_fonciere),
        prixm2:  c.surface_reelle_bati && c.valeur_fonciere
                  ? fmtEur(Math.round(c.valeur_fonciere / c.surface_reelle_bati)) : "-",
      }))
    : [];

  if (comps.length > 0) {
    y = tableBlock(doc, [
      { header: "Adresse",   key: "adresse", w: 58 },
      { header: "Surface",   key: "surface", w: 22, align: "right" },
      { header: "Date",      key: "date",    w: 22, align: "right" },
      { header: "Prix",      key: "prix",    w: 36, align: "right" },
      { header: "Prix/m2",   key: "prixm2",  w: 48, align: "right" },
    ], comps, y);

    if (dvf?.medianeM2) {
      y += 2;
      floatCard(doc, ML, y, CW, 10, 3, C.violet50, C.violet400);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.violet600);
      doc.text(`Mediane DVF : ${fmtEur(dvf.medianeM2)} / m2`, ML + CW / 2, y + 6.5, { align: "center" });
      y += 14;
    }
  } else {
    y = alertBox(doc, "Aucun comparable DVF disponible sur ce secteur.", "info", y);
    y += 3;
  }

  // â”€â”€ Risques â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = sectionHead(doc, "RISQUES SYNTHETIQUES", y);

  const risqueItems: Record<string, string>[] = [];
  if (risques?.inondation) risqueItems.push({ type: "Inondation",     niveau: risques.inondation });
  if (risques?.seisme)     risqueItems.push({ type: "Seisme",         niveau: risques.seisme     });
  if (risques?.retrait)    risqueItems.push({ type: "Retrait argile", niveau: risques.retrait    });
  if (risques?.radon)      risqueItems.push({ type: "Radon",          niveau: risques.radon      });

  if (risqueItems.length > 0) {
    y = tableBlock(doc, [
      { header: "Type de risque", key: "type",   w: CW - 50 },
      { header: "Niveau",         key: "niveau", w: 50, align: "right",
        colorFn: (v) =>
          v.toLowerCase().includes("fort") || v.toLowerCase().includes("haut") ? C.red600 :
          v.toLowerCase().includes("moyen") ? C.amber600 : C.green600,
      },
    ], risqueItems, y);
  } else {
    y = alertBox(doc, "Donnees risques non disponibles â€” consulter l'onglet Data Confidence.", "info", y);
  }

  drawPremiumFooter(doc);

  const filename = `Mimmoza_InvestmentPack_${dealName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
