// ============================================================================
// ComitePage.tsx — /banque/comite/:id
// src/spaces/banque/pages/ComitePage.tsx
//
// Banque Universelle: rapport comité basé sur OperationSummary enrichi.
// Sections: budget, marché, risques, scénarios, missing-data, SmartScore.
// Export PDF complet via jspdf + jspdf-autotable.
// ⚠️ Aucune barre de navigation workflow (BanqueLayout s'en charge).
// ============================================================================

import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import { buildOperationSummaryFromDossier } from "../adapters/manualOperationAdapter";
import {
  computeSmartScoreFromOperation,
  buildVerdictExplanation,
  type SmartScoreUniversalResult,
  type Grade,
} from "../scoring/banqueSmartScoreUniversal";
import type {
  OperationSummary,
  MissingDataItem,
} from "../types/operationSummary.types";

// ── Types ──

interface UniversalReport {
  generatedAt: string;
  profile: string;
  meta: {
    dossierRef: string;
    dossierLabel: string;
    profile: string;
    generatedAt: string;
  };
  emprunteur: {
    type: string;
    identite: string;
    details: Record<string, string>;
  };
  projet: Record<string, string>;
  budget: Record<string, string>;
  financement: Record<string, string>;
  revenus: Record<string, string>;
  marche: Record<string, string>;
  risques: {
    items: Array<{ label: string; level: string; status: string }>;
    score: string;
    globalLevel: string;
  };
  kpis: Record<string, string>;
  scenarios: Record<string, Record<string, string>>;
  missing: MissingDataItem[];
  smartscore: SmartScoreUniversalResult | null;
  verdictExplanation: string;
}

// ── Helpers ──

const fmt = (v: unknown, suffix = ""): string => {
  if (v === null || v === undefined || v === "") return "Non renseigné";
  const n = Number(v);
  if (!isNaN(n)) return `${n.toLocaleString("fr-FR")}${suffix}`;
  return String(v);
};

const fmtK = (v: unknown): string => {
  if (v === null || v === undefined) return "Non renseigné";
  const n = Number(v);
  return isNaN(n) ? String(v) : `${(n / 1000).toFixed(0)}k€`;
};

const GRADE_COLORS: Record<Grade, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700",
};

// ════════════════════════════════════════════════════════════════════
// REPORT GENERATOR
// ════════════════════════════════════════════════════════════════════

function generateUniversalReport(
  dossier: any,
  operation: OperationSummary,
  scoreResult: SmartScoreUniversalResult | null
): UniversalReport {
  const emp = dossier?.emprunteur;
  const now = new Date().toISOString();

  // Emprunteur
  let emprunteur;
  if (!emp?.type) {
    emprunteur = { type: "inconnu", identite: dossier?.sponsor || "Non renseigné", details: {} };
  } else if (emp.type === "personne_physique") {
    emprunteur = {
      type: "personne_physique",
      identite: `${emp.prenom ?? ""} ${emp.nom ?? ""}`.trim() || "Non renseigné",
      details: {
        ...(emp.dateNaissance ? { "Date de naissance": emp.dateNaissance } : {}),
        ...(emp.telephone ? { Téléphone: emp.telephone } : {}),
        ...(emp.email ? { Email: emp.email } : {}),
        ...(emp.adresse ? { Adresse: emp.adresse } : {}),
      },
    };
  } else {
    emprunteur = {
      type: "personne_morale",
      identite: emp.raisonSociale || emp.nom || "Non renseigné",
      details: {
        ...(emp.siren ? { SIREN: emp.siren } : {}),
        ...(emp.formeJuridique ? { Forme: emp.formeJuridique } : {}),
        ...(emp.dirigeant ? { Dirigeant: emp.dirigeant } : {}),
        ...(emp.telephone ? { Téléphone: emp.telephone } : {}),
      },
    };
  }

  // Projet
  const p = operation.project ?? {};
  const projet: Record<string, string> = {};
  if (p.label) projet["Nom"] = p.label;
  if (p.operationType) projet["Type d'opération"] = p.operationType;
  if (p.assetType) projet["Type d'actif"] = p.assetType;
  if (p.address) projet["Adresse"] = p.address;
  if (p.communeInsee) projet["Code INSEE"] = p.communeInsee;
  if (p.surfaceM2) projet["Surface"] = `${p.surfaceM2} m²`;
  if (p.lots) projet["Lots"] = String(p.lots);
  if (p.dpe) projet["DPE"] = p.dpe;

  // Budget
  const b = operation.budget ?? {};
  const budget: Record<string, string> = {};
  if (b.purchasePrice) budget["Prix d'achat"] = fmtK(b.purchasePrice);
  if (b.notaryFees) budget["Frais de notaire"] = fmtK(b.notaryFees);
  if (b.worksBudget) budget["Budget travaux"] = fmtK(b.worksBudget);
  if (b.softCosts) budget["Soft costs"] = fmtK(b.softCosts);
  if (b.holdingCosts) budget["Frais de portage"] = fmtK(b.holdingCosts);
  if (b.contingency) budget["Aléas"] = fmtK(b.contingency);
  if (b.landCost) budget["Coût foncier"] = fmtK(b.landCost);
  if (b.constructionCost) budget["Construction"] = fmtK(b.constructionCost);
  if (b.totalCost) budget["TOTAL"] = fmtK(b.totalCost);
  if (b.costPerSqm) budget["Coût/m²"] = `${b.costPerSqm}€`;

  // Financement
  const f = operation.financing ?? {};
  const financement: Record<string, string> = {};
  if (f.loanAmount) financement["Montant prêt"] = fmtK(f.loanAmount);
  if (f.loanDurationMonths) financement["Durée"] = `${f.loanDurationMonths} mois`;
  if (f.loanType) financement["Type"] = f.loanType;
  if (f.interestRate) financement["Taux"] = `${f.interestRate}%`;
  if (f.equity) financement["Apport personnel"] = fmtK(f.equity);

  // Revenus
  const r = operation.revenues ?? {};
  const revenus: Record<string, string> = {};
  if (r.strategy) revenus["Stratégie"] = r.strategy;
  if (r.exitValue) revenus["Valeur de sortie"] = fmtK(r.exitValue);
  if (r.rentAnnual) revenus["Loyer annuel"] = fmtK(r.rentAnnual);
  if (r.occupancyRate) revenus["Taux d'occupation"] = `${r.occupancyRate}%`;
  if (r.revenueTotal) revenus["CA total"] = fmtK(r.revenueTotal);

  // Marché
  const m = operation.market ?? {};
  const marche: Record<string, string> = {};
  if (m.pricePerSqm) marche["Prix médian /m²"] = `${m.pricePerSqm}€`;
  if (m.compsCount) marche["Transactions DVF"] = String(m.compsCount);
  if (m.evolutionPct != null) marche["Évolution prix"] = `${m.evolutionPct}%`;
  if (m.demandIndex != null) marche["Indice demande"] = `${m.demandIndex}/100`;
  if (m.absorptionMonths) marche["Absorption"] = `${m.absorptionMonths} mois`;
  if (m.populationCommune) marche["Population"] = String(m.populationCommune);
  if (m.revenueMedian) marche["Revenu médian"] = fmtK(m.revenueMedian);

  // Risques
  const rk = operation.risks ?? {};
  const risques = {
    items: (rk.geo ?? []).map((ri) => ({
      label: ri.label,
      level: ri.level,
      status: ri.status,
    })),
    score: rk.score != null ? `${rk.score}/100` : "N/A",
    globalLevel: rk.globalLevel ?? "inconnu",
  };

  // KPIs
  const k = operation.kpis ?? {};
  const kpis: Record<string, string> = {};
  if (k.ltv != null) kpis["LTV"] = `${k.ltv}%`;
  if (k.ltc != null) kpis["LTC"] = `${k.ltc}%`;
  if (k.margin != null) kpis["Marge brute"] = `${k.margin}%`;
  if (k.roi != null) kpis["ROI"] = `${k.roi}%`;
  if (k.irr != null) kpis["TRI"] = `${k.irr}%`;
  if (k.dscr != null) kpis["DSCR"] = String(k.dscr);
  if (k.yieldGross != null) kpis["Rendement brut"] = `${k.yieldGross}%`;
  if (k.cashOnCash != null) kpis["Cash-on-cash"] = `${k.cashOnCash}%`;

  // Scénarios
  const scenarios: Record<string, Record<string, string>> = {};
  if (r.scenarios) {
    for (const [key, sc] of Object.entries(r.scenarios)) {
      if (sc) {
        const s: Record<string, string> = {};
        if (sc.exitValue) s["Sortie"] = fmtK(sc.exitValue);
        if (sc.margin != null) s["Marge"] = `${sc.margin}%`;
        if (sc.roi != null) s["ROI"] = `${sc.roi}%`;
        if (sc.notes) s["Notes"] = sc.notes;
        scenarios[key] = s;
      }
    }
  }

  return {
    generatedAt: now,
    profile: operation.meta.profile,
    meta: {
      dossierRef: dossier?.reference ?? "—",
      dossierLabel: dossier?.label ?? "—",
      profile: operation.meta.profile,
      generatedAt: now,
    },
    emprunteur,
    projet,
    budget,
    financement,
    revenus,
    marche,
    risques,
    kpis,
    scenarios,
    missing: operation.missing ?? [],
    smartscore: scoreResult,
    verdictExplanation: scoreResult
      ? buildVerdictExplanation(scoreResult)
      : "Aucune évaluation disponible",
  };
}

function isReportValid(report: UniversalReport | null): boolean {
  return !!report && !!report.generatedAt && !!report.meta;
}

// ════════════════════════════════════════════════════════════════════
// PDF EXPORT
// ════════════════════════════════════════════════════════════════════

async function exportReportPdf(
  report: UniversalReport,
  dossier: any
): Promise<void> {
  // Dynamic import to avoid bundle bloat
  const { default: jsPDF } = await import("jspdf");
  await import("jspdf-autotable");

  const doc = new jsPDF("p", "mm", "a4") as any;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const addPage = () => {
    doc.addPage();
    y = 20;
  };

  const checkPage = (need: number) => {
    if (y + need > 270) addPage();
  };

  // ── Header ──
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("RAPPORT COMITÉ DE CRÉDIT", margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Dossier: ${report.meta.dossierRef} — ${report.meta.dossierLabel}`, margin, y);
  y += 5;
  doc.text(`Profil: ${report.profile}`, margin, y);
  y += 5;
  doc.text(`Généré le: ${new Date(report.generatedAt).toLocaleString("fr-FR")}`, margin, y);
  y += 10;

  // ── SmartScore ──
  if (report.smartscore) {
    const ss = report.smartscore;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("SMARTSCORE", margin, y);
    y += 7;
    doc.setFontSize(11);
    doc.text(`Score: ${ss.score}/100 (${ss.grade}) — Verdict: ${ss.verdict}`, margin, y);
    y += 6;

    // Pillar table
    const pillarRows = ss.pillars.map((p) => [
      p.label,
      `${p.points}/${p.maxPoints}`,
      p.hasData ? `${p.rawScore}/100` : "N/A",
      p.reasons.slice(0, 2).join("; "),
    ]);

    doc.autoTable({
      startY: y,
      head: [["Pilier", "Points", "Score brut", "Détail"]],
      body: pillarRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Emprunteur ──
  checkPage(25);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("EMPRUNTEUR", margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${report.emprunteur.identite} (${report.emprunteur.type})`, margin, y);
  y += 5;
  for (const [k, v] of Object.entries(report.emprunteur.details)) {
    doc.text(`${k}: ${v}`, margin + 5, y);
    y += 4;
  }
  y += 5;

  // ── Helper for key-value sections ──
  const addSection = (title: string, data: Record<string, string>) => {
    const entries = Object.entries(data).filter(([_, v]) => v);
    if (entries.length === 0) return;
    checkPage(15 + entries.length * 5);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin, y);
    y += 7;
    doc.autoTable({
      startY: y,
      body: entries,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 50 },
        1: { cellWidth: contentWidth - 50 },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  addSection("PROJET", report.projet);
  addSection("BUDGET", report.budget);
  addSection("FINANCEMENT", report.financement);
  addSection("REVENUS", report.revenus);
  addSection("MARCHÉ", report.marche);
  addSection("RATIOS FINANCIERS", report.kpis);

  // ── Risques ──
  if (report.risques.items.length > 0) {
    checkPage(20);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("RISQUES", margin, y);
    y += 7;

    const riskRows = report.risques.items.map((r) => [
      r.status === "present" ? "⚠" : r.status === "absent" ? "✓" : "?",
      r.label,
      r.level,
    ]);

    doc.autoTable({
      startY: y,
      head: [["", "Risque", "Niveau"]],
      body: riskRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [234, 88, 12] },
    });
    y = doc.lastAutoTable.finalY + 5;
    doc.setFontSize(9);
    doc.text(`Score risques: ${report.risques.score} — Niveau: ${report.risques.globalLevel}`, margin, y);
    y += 8;
  }

  // ── Scénarios ──
  if (Object.keys(report.scenarios).length > 0) {
    checkPage(25);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("SCÉNARIOS", margin, y);
    y += 7;

    for (const [name, sc] of Object.entries(report.scenarios)) {
      const entries = Object.entries(sc);
      if (entries.length === 0) continue;
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(name.toUpperCase(), margin + 5, y);
      y += 5;
      for (const [k, v] of entries) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`${k}: ${v}`, margin + 10, y);
        y += 4;
      }
      y += 3;
    }
    y += 5;
  }

  // ── Missing data ──
  if (report.missing.length > 0) {
    checkPage(15 + report.missing.length * 5);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("DONNÉES MANQUANTES", margin, y);
    y += 7;

    const missingRows = report.missing.map((m) => [
      m.severity === "blocker" ? "BLOQUANT" : m.severity === "warn" ? "ATTENTION" : "INFO",
      m.label,
      m.key,
    ]);

    doc.autoTable({
      startY: y,
      head: [["Sévérité", "Donnée", "Clé"]],
      body: missingRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [180, 83, 9] },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Recommendations ──
  if (report.smartscore && report.smartscore.recommendations.length > 0) {
    checkPage(20);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("RECOMMANDATIONS", margin, y);
    y += 7;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    report.smartscore.recommendations.forEach((r, i) => {
      checkPage(6);
      doc.text(`${i + 1}. ${r}`, margin + 5, y);
      y += 5;
    });
    y += 5;
  }

  // ── Verdict ──
  checkPage(20);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CONCLUSION", margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const verdictLines = doc.splitTextToSize(report.verdictExplanation, contentWidth);
  doc.text(verdictLines, margin, y);

  // Save
  const filename = `rapport-comite-${dossier?.reference ?? "dossier"}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

// ════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function ComitePage() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();

  const [report, setReport] = useState<UniversalReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ── Build operation ──
  const operation = useMemo<OperationSummary | null>(() => {
    if (!dossier) return null;
    return (dossier as any).operation ?? buildOperationSummaryFromDossier(dossier);
  }, [dossier]);

  // ── Restore persisted report ──
  const persistedReport = useMemo(() => {
    const r = (dossier as any)?.comite?.report;
    return r && isReportValid(r) ? (r as UniversalReport) : null;
  }, [dossier]);

  const activeReport = report ?? persistedReport;

  // ── Generate report ──
  const handleGenerate = useCallback(() => {
    if (!dossier || !operation || !dossierId) return;
    setIsGenerating(true);

    try {
      const sr = computeSmartScoreFromOperation(operation, dossier);
      const rpt = generateUniversalReport(dossier, operation, sr);
      setReport(rpt);

      // Persist
      upsertDossier({
        id: dossierId,
        comite: {
          ...(dossier as any)?.comite,
          report: rpt,
        },
      } as any);
      addEvent({
        type: "rapport_generated",
        dossierId,
        message: `Rapport comité généré — Score: ${sr.score}/100 (${sr.grade})`,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [dossier, operation, dossierId]);

  // ── Export PDF ──
  const handleExportPdf = useCallback(async () => {
    if (!activeReport) return;
    setIsExporting(true);
    try {
      await exportReportPdf(activeReport, dossier);
    } catch (err) {
      console.error("[ComitePage] PDF export failed:", err);
      alert("Erreur lors de l'export PDF");
    } finally {
      setIsExporting(false);
    }
  }, [activeReport, dossier]);

  // ── Guards ──
  if (!dossierId || !dossier) {
    return (
      <div className="p-6 text-center text-gray-500">
        Aucun dossier sélectionné.{" "}
        <button className="text-blue-600 underline" onClick={() => navigate("/banque/dossiers")}>
          Retour aux dossiers
        </button>
      </div>
    );
  }

  const hasReport = isReportValid(activeReport);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comité de crédit</h1>
          <p className="text-sm text-gray-500 mt-1">
            {dossier.label ?? dossier.reference}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
          >
            {isGenerating ? (
              <><span className="animate-spin">⟳</span> Génération…</>
            ) : hasReport ? (
              <>🔄 Regénérer le rapport</>
            ) : (
              <>📄 Générer le rapport</>
            )}
          </button>
          {hasReport && (
            <button
              onClick={handleExportPdf}
              disabled={isExporting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
            >
              {isExporting ? (
                <><span className="animate-spin">⟳</span> Export…</>
              ) : (
                <>📥 Exporter PDF</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Report badge ── */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-600">Rapport Comité</span>
        {hasReport ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
            ✅ Généré le {new Date(activeReport!.generatedAt).toLocaleDateString("fr-FR")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-sm">
            ⏳ Non généré
          </span>
        )}
      </div>

      {/* ── Report content ── */}
      {hasReport && activeReport && (
        <div className="space-y-6">
          {/* SmartScore summary */}
          {activeReport.smartscore && (
            <ReportCard title="📊 SmartScore" icon="score">
              <div className="flex items-center gap-6 mb-4">
                <div
                  className={`text-3xl font-bold px-4 py-2 rounded-lg ${
                    GRADE_COLORS[activeReport.smartscore.grade]
                  }`}
                >
                  {activeReport.smartscore.score}/100
                </div>
                <div>
                  <div className="text-lg font-semibold">
                    Grade {activeReport.smartscore.grade} — {activeReport.smartscore.verdict}
                  </div>
                  <div className="text-sm text-gray-500 capitalize">
                    Profil: {activeReport.profile}
                  </div>
                </div>
              </div>
              {/* Pillar bars */}
              <div className="space-y-2">
                {activeReport.smartscore.pillars.map((p) => {
                  const pct = p.maxPoints > 0 ? Math.round((p.points / p.maxPoints) * 100) : 0;
                  return (
                    <div key={p.key} className="flex items-center gap-3">
                      <span className="w-28 text-xs font-medium text-gray-600 text-right">
                        {p.label}
                      </span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-16 text-xs text-gray-500 text-right">
                        {p.points}/{p.maxPoints}
                      </span>
                      {!p.hasData && (
                        <span className="text-xs bg-gray-200 text-gray-400 px-1 rounded">N/A</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </ReportCard>
          )}

          {/* Emprunteur */}
          <ReportCard title="👤 Emprunteur">
            <p className="font-medium">{activeReport.emprunteur.identite}</p>
            <p className="text-sm text-gray-500 capitalize">{activeReport.emprunteur.type}</p>
            {Object.entries(activeReport.emprunteur.details).map(([k, v]) => (
              <div key={k} className="text-sm mt-1">
                <span className="text-gray-500">{k}:</span> {v}
              </div>
            ))}
          </ReportCard>

          {/* Key-value sections */}
          <KvSection title="🏗️ Projet" data={activeReport.projet} />
          <KvSection title="💰 Budget" data={activeReport.budget} />
          <KvSection title="🏦 Financement" data={activeReport.financement} />
          <KvSection title="💵 Revenus" data={activeReport.revenus} />
          <KvSection title="📈 Marché" data={activeReport.marche} />
          <KvSection title="📐 Ratios" data={activeReport.kpis} />

          {/* Risques */}
          {activeReport.risques.items.length > 0 && (
            <ReportCard title="⚡ Risques">
              <div className="space-y-1">
                {activeReport.risques.items.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-2 rounded text-sm ${
                      r.status === "present" && (r.level === "élevé" || r.level === "très élevé")
                        ? "bg-red-50"
                        : r.status === "present"
                        ? "bg-amber-50"
                        : "bg-gray-50"
                    }`}
                  >
                    <span>
                      {r.status === "absent" ? "✅" : r.status === "unknown" ? "❓" : "⚠️"}{" "}
                      {r.label}
                    </span>
                    <span className="text-xs font-medium capitalize">{r.level}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-sm text-gray-600">
                Score: {activeReport.risques.score} — Niveau: {activeReport.risques.globalLevel}
              </div>
            </ReportCard>
          )}

          {/* Scénarios */}
          {Object.keys(activeReport.scenarios).length > 0 && (
            <ReportCard title="🎯 Scénarios">
              <div className="grid grid-cols-3 gap-4">
                {Object.entries(activeReport.scenarios).map(([name, data]) => (
                  <div
                    key={name}
                    className={`p-3 rounded-lg border ${
                      name === "stress"
                        ? "border-red-200 bg-red-50"
                        : name === "upside"
                        ? "border-green-200 bg-green-50"
                        : "border-gray-200 bg-gray-50"
                    }`}
                  >
                    <div className="font-medium capitalize mb-1">{name}</div>
                    {Object.entries(data).map(([k, v]) => (
                      <div key={k} className="text-sm">
                        <span className="text-gray-500">{k}:</span> {v}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ReportCard>
          )}

          {/* Missing data */}
          {activeReport.missing.length > 0 && (
            <ReportCard title="📋 Données manquantes">
              <div className="space-y-1">
                {activeReport.missing.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        m.severity === "blocker"
                          ? "bg-red-500"
                          : m.severity === "warn"
                          ? "bg-amber-500"
                          : "bg-blue-400"
                      }`}
                    />
                    <span>{m.label}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        m.severity === "blocker"
                          ? "bg-red-100 text-red-600"
                          : m.severity === "warn"
                          ? "bg-amber-100 text-amber-600"
                          : "bg-blue-50 text-blue-600"
                      }`}
                    >
                      {m.severity === "blocker" ? "Bloquant" : m.severity === "warn" ? "Attention" : "Info"}
                    </span>
                  </div>
                ))}
              </div>
              {activeReport.smartscore && activeReport.smartscore.totalMissingPenalty > 0 && (
                <div className="mt-2 text-sm text-red-600 font-medium">
                  Impact score: -{activeReport.smartscore.totalMissingPenalty} pts
                </div>
              )}
            </ReportCard>
          )}

          {/* Recommendations */}
          {activeReport.smartscore && activeReport.smartscore.recommendations.length > 0 && (
            <ReportCard title="💡 Recommandations">
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                {activeReport.smartscore.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </ReportCard>
          )}

          {/* Verdict */}
          <ReportCard title="📝 Conclusion">
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
              {activeReport.verdictExplanation}
            </pre>
          </ReportCard>

          {/* Decision section */}
          <DecisionSection dossierId={dossierId!} dossier={dossier} />
        </div>
      )}

      {/* ── No report placeholder ── */}
      {!hasReport && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-600 mb-4">
            Le rapport comité n'a pas encore été généré.
          </p>
          <button
            onClick={handleGenerate}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Générer le rapport
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════

function ReportCard({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function KvSection({ title, data }: { title: string; data: Record<string, string> }) {
  const entries = Object.entries(data).filter(([_, v]) => v && v !== "Non renseigné");
  if (entries.length === 0) return null;

  return (
    <ReportCard title={title}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="text-xs text-gray-500">{k}</div>
            <div className={`font-medium ${k === "TOTAL" ? "text-indigo-700 text-lg" : "text-gray-800"}`}>
              {v}
            </div>
          </div>
        ))}
      </div>
    </ReportCard>
  );
}

function DecisionSection({
  dossierId,
  dossier,
}: {
  dossierId: string;
  dossier: any;
}) {
  const [verdict, setVerdict] = useState<string>(
    dossier?.decision?.verdict ?? dossier?.comite?.verdict ?? ""
  );
  const [motivation, setMotivation] = useState<string>(
    dossier?.decision?.motivation ?? dossier?.comite?.motivation ?? ""
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    upsertDossier({
      id: dossierId,
      decision: {
        ...(dossier?.decision ?? {}),
        verdict,
        motivation,
        decidedAt: new Date().toISOString(),
      },
    } as any);
    addEvent({
      type: "decision_updated",
      dossierId,
      message: `Décision comité: ${verdict}`,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="bg-white rounded-lg border-2 border-indigo-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">⚖️ Décision du comité</h3>
      <div className="space-y-4">
        <div className="flex gap-3">
          {["GO", "GO sous conditions", "NO GO"].map((v) => (
            <button
              key={v}
              onClick={() => setVerdict(v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                verdict === v
                  ? v === "GO"
                    ? "bg-green-600 text-white border-green-600"
                    : v === "GO sous conditions"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-red-600 text-white border-red-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Motivation / Conditions..."
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          rows={4}
          className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!verdict}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
          >
            Enregistrer la décision
          </button>
          {saved && (
            <span className="text-green-600 text-sm">✅ Décision enregistrée</span>
          )}
        </div>
      </div>
    </div>
  );
}