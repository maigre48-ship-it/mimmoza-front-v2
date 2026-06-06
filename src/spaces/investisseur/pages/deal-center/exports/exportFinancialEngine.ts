// src/spaces/investisseur/pages/deal-center/exports/exportFinancialEngine.ts
//
// Export PDF + Excel – Modele Financier  v2.0
// Style premium identique à exportDataConfidence (PDF)
// Excel : logique inchangée
// Logique métier : 100% inchangée

import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

import {
  C, PW, PH, ML, MR, CW, HDR_H, BODY_START,
  today, fmtEur, fmtPct,
  hGrad, floatCard, sectionHead, kvRow, tableBlock, alertBox,
  drawPremiumHeader, drawPageHeader, drawPremiumFooter, kpiCard,
} from "./exportPremiumPdf.utils";

import {
  readMarchandSnapshot,
  ensureActiveDeal,
} from "../../../../marchand/shared/marchandSnapshot.store";
import type { RentabiliteSnapshot } from "../../../../marchand/types/rentabilite.types";

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function exportFinancialEnginePdf(): Promise<void> {
  const snap     = readMarchandSnapshot();
  const deal     = ensureActiveDeal();
  const id       = deal?.id ?? null;
  const renta    = (id ? snap.rentabiliteByDeal[id]?.computed : undefined) as RentabiliteSnapshot | undefined;
  const dealName = deal?.nom ?? deal?.address ?? "Deal sans nom";
  const base     = (renta as any)?.scenarios?.base;
  const pess     = (renta as any)?.scenarios?.pessimiste;
  const opti     = (renta as any)?.scenarios?.optimiste;
  const sensi    = (renta as any)?.sensibilite;

  const TITLE    = "Modele Financier";
  const SUBTITLE = "Parametres  \u2022  Scenarios  \u2022  Sensibilite  \u2022  Charges";
  const PAGES    = 3;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — Header + KPIs + Paramètres
  // ════════════════════════════════════════════════════════════════

  const logoDataUrl = await drawPremiumHeader(doc, TITLE, SUBTITLE, dealName);
  let y = BODY_START;

  // ── KPI row ─────────────────────────────────────────────────────
  const KPI_H = 28;
  const KPI_GAP = 3;
  const KPI_W = (CW - KPI_GAP * 3) / 4;

  const rendBrut = base?.rendementBrut ?? null;
  const rendNet  = base?.rendementNet  ?? null;
  const cf       = base?.cashflowMensuel ?? null;

  const rendCol = rendBrut == null ? C.slate400 : rendBrut >= 5 ? C.green600 : rendBrut >= 3 ? C.amber600 : C.red600;
  const netCol  = rendNet  == null ? C.slate400 : rendNet >= 3  ? C.green600 : rendNet >= 2  ? C.amber600 : C.red600;
  const cfCol   = cf       == null ? C.slate400 : cf > 0 ? C.green600 : C.red600;

  kpiCard(doc, ML + 0 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Rendement brut", rendBrut != null ? `${rendBrut.toFixed(1)}%` : "-", "Annualise",
    rendCol, rendBrut == null ? C.slate100 : rendBrut >= 5 ? C.green50 : C.amber50);

  kpiCard(doc, ML + 1 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Rendement net", rendNet != null ? `${rendNet.toFixed(1)}%` : "-", "Apres charges",
    netCol, rendNet == null ? C.slate100 : rendNet >= 3 ? C.green50 : C.amber50);

  kpiCard(doc, ML + 2 * (KPI_W + KPI_GAP), y, KPI_W, KPI_H,
    "Cashflow /mois", cf != null ? `${Math.round(cf)} EUR` : "-", "Net mensuel",
    cfCol, cf == null ? C.slate100 : cf >= 0 ? C.green50 : C.red50);

  // Carte violette TRI
  const tri5 = base?.tri5ans ?? null;
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
  doc.text("TRI 5 ANS", k4x + KPI_W / 2, y + 5, { align: "center" });
  doc.setFontSize(17);
  doc.text(tri5 != null ? `${tri5.toFixed(1)}%` : "-", k4x + KPI_W / 2, y + 18, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setGState(doc.GState({ opacity: 0.75 }));
  doc.text("Objectif >= 6%", k4x + KPI_W / 2, y + KPI_H - 2.5, { align: "center" });
  doc.setGState(doc.GState({ opacity: 1 }));

  y += KPI_H + 7;

  // ── Paramètres ──────────────────────────────────────────────────
  y = sectionHead(doc, "PARAMETRES DU MODELE", y);

  const PARAMS_H = 104;
  floatCard(doc, ML, y, CW, PARAMS_H, 5, C.white, C.slate200);
  let py = y + 7;
  py = kvRow(doc, "Prix d'acquisition",     fmtEur(deal?.prixAchat),                               py, { bold: true });
  py = kvRow(doc, "Frais de notaire",       fmtEur((deal as any)?.fraisNotaire),                    py);
  py = kvRow(doc, "Travaux",                fmtEur((deal as any)?.travaux),                         py);
  py = kvRow(doc, "Mobilier / decoration",  fmtEur((deal as any)?.mobilier),                        py);
  py = kvRow(doc, "Surface",                deal?.surfaceM2 ? `${deal.surfaceM2} m2` : "-",          py);
  py = kvRow(doc, "Loyer mensuel HC",       fmtEur((deal as any)?.loyerMensuel),                    py);
  py = kvRow(doc, "Charges copropriete",    fmtEur((deal as any)?.charges),                         py);
  py = kvRow(doc, "Taxe fonciere / an",     fmtEur((deal as any)?.taxeFonciere),                    py);
  py = kvRow(doc, "Assurance PNO / an",     fmtEur((deal as any)?.assurancePno),                    py);
  py = kvRow(doc, "Gestion locative",       fmtPct((deal as any)?.tauxGestion),                     py);
  py = kvRow(doc, "Vacance locative",       fmtPct((deal as any)?.vacanceLocative),                  py);
  py = kvRow(doc, "Taux emprunt",           fmtPct((deal as any)?.tauxEmprunt),                     py);
  py = kvRow(doc, "Duree emprunt",          (deal as any)?.dureeEmprunt ? `${(deal as any).dureeEmprunt} ans` : "-", py);
  py = kvRow(doc, "Apport personnel",       fmtEur((deal as any)?.apport),                         py, { bold: true });
  py = kvRow(doc, "Regime fiscal",          (deal as any)?.regimeFiscal ?? "-",                     py);
  y += PARAMS_H + 5;

  drawPremiumFooter(doc);

  // ════════════════════════════════════════════════════════════════
  // PAGE 2 — Scénarios complets
  // ════════════════════════════════════════════════════════════════

  doc.addPage();
  drawPageHeader(doc, TITLE, 2, PAGES, dealName, logoDataUrl);
  y = BODY_START;

  y = sectionHead(doc, "RESULTATS — 3 SCENARIOS", y);

  if (!base) {
    y = alertBox(doc, "Aucun calcul de rentabilite disponible. Renseigner les parametres dans l'onglet Financial Engine.", "warning", y);
  } else {
    y = tableBlock(doc, [
      { header: "Indicateur",          key: "label", w: 60 },
      { header: "Pessimiste (-15%)",   key: "pess",  w: 40, align: "right" },
      { header: "Base",                key: "base",  w: 40, align: "right" },
      { header: "Optimiste (+15%)",    key: "opti",  w: 46, align: "right" },
    ], [
      { label: "Cout total projet",     pess: fmtEur(pess?.coutTotalProjet),    base: fmtEur(base?.coutTotalProjet),    opti: fmtEur(opti?.coutTotalProjet)    },
      { label: "Loyer annuel brut",     pess: fmtEur(pess?.loyerAnnuel),        base: fmtEur(base?.loyerAnnuel),        opti: fmtEur(opti?.loyerAnnuel)        },
      { label: "Charges annuelles",     pess: fmtEur(pess?.chargesAnnuelles),   base: fmtEur(base?.chargesAnnuelles),   opti: fmtEur(opti?.chargesAnnuelles)   },
      { label: "Mensualite emprunt",    pess: fmtEur(pess?.mensualiteEmprunt),  base: fmtEur(base?.mensualiteEmprunt),  opti: fmtEur(opti?.mensualiteEmprunt)  },
      { label: "Rendement brut",        pess: fmtPct(pess?.rendementBrut),      base: fmtPct(base?.rendementBrut),      opti: fmtPct(opti?.rendementBrut)      },
      { label: "Rendement net",         pess: fmtPct(pess?.rendementNet),       base: fmtPct(base?.rendementNet),       opti: fmtPct(opti?.rendementNet)       },
      { label: "Rendement net-net",     pess: fmtPct(pess?.rendementNetNet),    base: fmtPct(base?.rendementNetNet),    opti: fmtPct(opti?.rendementNetNet)    },
      { label: "Cashflow mensuel",      pess: fmtEur(pess?.cashflowMensuel),    base: fmtEur(base?.cashflowMensuel),    opti: fmtEur(opti?.cashflowMensuel)    },
      { label: "Cashflow annuel",       pess: fmtEur(pess?.cashflowAnnuel),     base: fmtEur(base?.cashflowAnnuel),     opti: fmtEur(opti?.cashflowAnnuel)     },
      { label: "Effort epargne/mois",   pess: fmtEur(pess?.effortEpargne),      base: fmtEur(base?.effortEpargne),      opti: fmtEur(opti?.effortEpargne)      },
      { label: "TRI 5 ans",             pess: fmtPct(pess?.tri5ans),            base: fmtPct(base?.tri5ans),            opti: fmtPct(opti?.tri5ans)            },
      { label: "TRI 10 ans",            pess: fmtPct(pess?.tri10ans),           base: fmtPct(base?.tri10ans),           opti: fmtPct(opti?.tri10ans)           },
      { label: "VAN (10 ans, 5%)",      pess: fmtEur(pess?.van10ans),           base: fmtEur(base?.van10ans),           opti: fmtEur(opti?.van10ans)           },
    ], y);
  }

  drawPremiumFooter(doc);

  // ════════════════════════════════════════════════════════════════
  // PAGE 3 — Sensibilité + Charges
  // ════════════════════════════════════════════════════════════════

  doc.addPage();
  drawPageHeader(doc, TITLE, 3, PAGES, dealName, logoDataUrl);
  y = BODY_START;

  // ── Sensibilité ─────────────────────────────────────────────────
  y = sectionHead(doc, "ANALYSE DE SENSIBILITE — Rendement net selon taux x loyer", y);

  if (sensi && Array.isArray(sensi)) {
    const rows = sensi.slice(0, 8).map((row: any) => ({
      taux:  fmtPct(row.taux),
      l_85:  fmtPct(row.loyer_85),
      l_100: fmtPct(row.loyer_100),
      l_115: fmtPct(row.loyer_115),
    }));
    y = tableBlock(doc, [
      { header: "Taux emprunt", key: "taux",  w: 36 },
      { header: "Loyer -15%",   key: "l_85",  w: 50, align: "right" },
      { header: "Loyer base",   key: "l_100", w: 50, align: "right" },
      { header: "Loyer +15%",   key: "l_115", w: 50, align: "right" },
    ], rows, y);
  } else {
    y = alertBox(doc, "Matrice de sensibilite non disponible — recalculer depuis l'onglet Financial Engine.", "info", y);
  }
  y += 5;

  // ── Charges ─────────────────────────────────────────────────────
  y = sectionHead(doc, "DECOMPOSITION DES CHARGES ANNUELLES", y);

  const chargesItems: Record<string, string>[] = [];
  const addCharge = (label: string, val: number | null | undefined) => {
    if (val != null && val > 0) chargesItems.push({ poste: label, montant: fmtEur(val) });
  };
  addCharge("Charges de copropriete",    ((deal as any)?.charges ?? 0) * 12);
  addCharge("Taxe fonciere",             (deal as any)?.taxeFonciere);
  addCharge("Assurance PNO",             (deal as any)?.assurancePno);
  addCharge("Gestion locative",
    (deal as any)?.loyerMensuel && (deal as any)?.tauxGestion
      ? Math.round((deal as any).loyerMensuel * 12 * ((deal as any).tauxGestion / 100)) : null);
  addCharge("Vacance locative estimee",
    (deal as any)?.loyerMensuel && (deal as any)?.vacanceLocative
      ? Math.round((deal as any).loyerMensuel * 12 * ((deal as any).vacanceLocative / 100)) : null);
  addCharge("Provision travaux",         (deal as any)?.provisionTravaux);

  if (chargesItems.length > 0) {
    y = tableBlock(doc, [
      { header: "Poste de charge", key: "poste",   w: CW - 50 },
      { header: "Montant annuel",  key: "montant", w: 50, align: "right" },
    ], chargesItems, y);

    if (base?.chargesAnnuelles) {
      y += 2;
      floatCard(doc, ML, y, CW, 10, 3, C.violet50, C.violet400);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.violet600);
      doc.text(`Total charges annuelles : ${fmtEur(base.chargesAnnuelles)}`, ML + CW / 2, y + 6.5, { align: "center" });
      y += 14;
    }
  } else {
    y = alertBox(doc, "Detail des charges non renseigne.", "info", y);
  }

  drawPremiumFooter(doc);

  const filename = `Mimmoza_ModeleFinancier_${dealName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

// ─── Excel (logique 100% inchangée) ──────────────────────────────────────────

export async function exportFinancialEngineExcel(): Promise<void> {
  const snap     = readMarchandSnapshot();
  const deal     = ensureActiveDeal();
  const id       = deal?.id ?? null;
  const renta    = (id ? snap.rentabiliteByDeal[id]?.computed : undefined) as RentabiliteSnapshot | undefined;
  const dealName = deal?.nom ?? deal?.address ?? "Deal sans nom";
  const base     = (renta as any)?.scenarios?.base;
  const pess     = (renta as any)?.scenarios?.pessimiste;
  const opti     = (renta as any)?.scenarios?.optimiste;

  const wb = XLSX.utils.book_new();

  const paramsData = [
    ["MIMMOZA - Modele Financier", "", ""],
    ["Deal", dealName, ""],
    ["Adresse", deal?.address ?? "", ""],
    ["Date", new Date().toLocaleDateString("fr-FR"), ""],
    ["", "", ""],
    ["PARAMETRES D'ENTREE", "", ""],
    ["Prix d'acquisition (EUR)",         deal?.prixAchat ?? "", ""],
    ["Frais de notaire (EUR)",            (deal as any)?.fraisNotaire ?? "", ""],
    ["Travaux (EUR)",                     (deal as any)?.travaux ?? "", ""],
    ["Mobilier (EUR)",                    (deal as any)?.mobilier ?? "", ""],
    ["Surface (m2)",                      deal?.surfaceM2 ?? "", ""],
    ["Loyer mensuel HC (EUR)",            (deal as any)?.loyerMensuel ?? "", ""],
    ["Charges copropriete / mois (EUR)",  (deal as any)?.charges ?? "", ""],
    ["Taxe fonciere / an (EUR)",          (deal as any)?.taxeFonciere ?? "", ""],
    ["Assurance PNO / an (EUR)",          (deal as any)?.assurancePno ?? "", ""],
    ["Taux gestion locative (%)",         (deal as any)?.tauxGestion ?? "", ""],
    ["Vacance locative (%)",              (deal as any)?.vacanceLocative ?? "", ""],
    ["Taux emprunt (%)",                  (deal as any)?.tauxEmprunt ?? "", ""],
    ["Duree emprunt (ans)",               (deal as any)?.dureeEmprunt ?? "", ""],
    ["Apport personnel (EUR)",            (deal as any)?.apport ?? "", ""],
    ["Regime fiscal",                     (deal as any)?.regimeFiscal ?? "", ""],
  ];
  const wsParams = XLSX.utils.aoa_to_sheet(paramsData);
  wsParams["!cols"] = [{ wch: 35 }, { wch: 20 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsParams, "Parametres");

  const scenData = [
    ["Indicateur", "Pessimiste (-15%)", "Base", "Optimiste (+15%)"],
    ["Cout total projet (EUR)",      pess?.coutTotalProjet ?? "",   base?.coutTotalProjet ?? "",   opti?.coutTotalProjet ?? ""   ],
    ["Loyer annuel brut (EUR)",      pess?.loyerAnnuel ?? "",        base?.loyerAnnuel ?? "",        opti?.loyerAnnuel ?? ""       ],
    ["Charges annuelles (EUR)",      pess?.chargesAnnuelles ?? "",   base?.chargesAnnuelles ?? "",   opti?.chargesAnnuelles ?? ""  ],
    ["Mensualite emprunt (EUR)",     pess?.mensualiteEmprunt ?? "",  base?.mensualiteEmprunt ?? "",  opti?.mensualiteEmprunt ?? "" ],
    ["Rendement brut (%)",           pess?.rendementBrut ?? "",      base?.rendementBrut ?? "",      opti?.rendementBrut ?? ""     ],
    ["Rendement net (%)",            pess?.rendementNet ?? "",       base?.rendementNet ?? "",       opti?.rendementNet ?? ""      ],
    ["Rendement net-net (%)",        pess?.rendementNetNet ?? "",    base?.rendementNetNet ?? "",    opti?.rendementNetNet ?? ""   ],
    ["Cashflow mensuel (EUR)",       pess?.cashflowMensuel ?? "",    base?.cashflowMensuel ?? "",    opti?.cashflowMensuel ?? ""   ],
    ["Cashflow annuel (EUR)",        pess?.cashflowAnnuel ?? "",     base?.cashflowAnnuel ?? "",     opti?.cashflowAnnuel ?? ""    ],
    ["Effort epargne / mois (EUR)",  pess?.effortEpargne ?? "",      base?.effortEpargne ?? "",      opti?.effortEpargne ?? ""     ],
    ["TRI 5 ans (%)",                pess?.tri5ans ?? "",            base?.tri5ans ?? "",            opti?.tri5ans ?? ""           ],
    ["TRI 10 ans (%)",               pess?.tri10ans ?? "",           base?.tri10ans ?? "",           opti?.tri10ans ?? ""          ],
    ["VAN 10 ans a 5% (EUR)",        pess?.van10ans ?? "",           base?.van10ans ?? "",           opti?.van10ans ?? ""          ],
  ];
  const wsScen = XLSX.utils.aoa_to_sheet(scenData);
  wsScen["!cols"] = [{ wch: 32 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsScen, "Scenarios");

  const cashflowRows: (string | number)[][] = [
    ["Annee", "Loyer brut (EUR)", "Charges (EUR)", "Mensualite (EUR)", "Cashflow net (EUR)", "Capital rembourse (EUR)"],
  ];
  if (base) {
    const loyerAnnuel = base.loyerAnnuel ?? 0;
    const chargesAnn  = base.chargesAnnuelles ?? 0;
    const mensualite  = base.mensualiteEmprunt ?? 0;
    for (let an = 1; an <= 10; an++) {
      const loyer   = Math.round(loyerAnnuel * Math.pow(1.01, an - 1));
      const charges = Math.round(chargesAnn  * Math.pow(1.02, an - 1));
      const mensAnn = mensualite * 12;
      cashflowRows.push([`Annee ${an}`, loyer, charges, Math.round(mensAnn), Math.round(loyer - charges - mensAnn), "-"]);
    }
  }
  const wsCf = XLSX.utils.aoa_to_sheet(cashflowRows);
  wsCf["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsCf, "Cashflow 10 ans");

  XLSX.writeFile(wb, `Mimmoza_ModeleFinancier_${dealName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}