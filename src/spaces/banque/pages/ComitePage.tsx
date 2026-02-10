// ============================================================================
// ComitePage.tsx — /banque/comite/:id
// Écran final: Rapport structuré + Décision
// C'est le SEUL écran où la décision est prise.
//
// Report = objet StructuredReport (JSON) persisté dans dossier.report.
// Badge "Généré" = vert uniquement si report.generatedAt + sections non vides.
// UI = cards/tables React riches (pas ASCII).
// ⚠️ Aucune barre workflow (BanqueLayout s'en charge).
// ============================================================================

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import {
  upsertDossier,
  patchCommittee,
  addEvent,
} from "../store/banqueSnapshot.store";
import {
  generateStructuredReport,
  type StructuredReport,
  type PillarResult,
  type Niveau,
  type Label,
} from "../utils/banqueCalcUtils";

// ── Types ──

type Decision = "en_attente" | "approuve" | "refuse" | "ajourne" | "conditionnel";

const DECISIONS: { value: Decision; label: string; color: string }[] = [
  { value: "en_attente",   label: "En attente",     color: "bg-slate-100 text-slate-600"  },
  { value: "approuve",     label: "Approuvé",       color: "bg-green-100 text-green-700"  },
  { value: "conditionnel", label: "Sous conditions", color: "bg-amber-100 text-amber-700"  },
  { value: "ajourne",      label: "Ajourné",         color: "bg-blue-100 text-blue-700"    },
  { value: "refuse",       label: "Refusé",          color: "bg-red-100 text-red-700"      },
];

const NIVEAU_COLORS: Record<Niveau, string> = {
  Faible: "bg-green-100 text-green-700",
  Modéré: "bg-amber-100 text-amber-700",
  Élevé: "bg-orange-100 text-orange-700",
  Critique: "bg-red-100 text-red-700",
};

const LABEL_COLORS: Record<Label, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700",
};

const PILLAR_BAR: Record<string, string> = {
  documentation: "bg-blue-500",
  garanties: "bg-indigo-500",
  emprunteur: "bg-violet-500",
  projet: "bg-cyan-500",
  financier: "bg-emerald-500",
};

const DOC_STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  attendu: { label: "Attendu", cls: "bg-gray-100 text-gray-700" },
  recu:    { label: "Reçu",    cls: "bg-blue-100 text-blue-700" },
  valide:  { label: "Validé",  cls: "bg-green-100 text-green-700" },
  refuse:  { label: "Refusé",  cls: "bg-red-100 text-red-700" },
};

function isReportValid(r: any): r is StructuredReport {
  return r && typeof r === "object" && !!r.generatedAt && !!r.meta;
}

// ═══════════════════════════════════════════════════════════════════

export default function ComitePage() {
  const { dossierId, dossier, snap, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();
  const committee = snap?.committee;

  // ── Report state ──
  const existing = dossier?.report;
  const [report, setReport] = useState<StructuredReport | null>(
    isReportValid(existing) ? existing : null,
  );
  const [generating, setGenerating] = useState(false);

  const hasRealReport = isReportValid(report);

  // ── Decision state ──
  const [decision, setDecision]       = useState<Decision>(committee?.decision ?? "en_attente");
  const [conditions, setConditions]   = useState(committee?.conditions ?? "");
  const [commentaire, setCommentaire] = useState(committee?.commentaire ?? "");
  const [saved, setSaved]             = useState(false);

  // Summary data
  const garanties  = dossier?.garanties;
  const documents  = dossier?.documents;
  const analysis   = dossier?.analysis;
  const smartScore = snap?.smartScore;

  // ── Generate report ──
  const handleGenerate = useCallback(() => {
    if (!dossierId || !dossier) return;
    setGenerating(true);
    setTimeout(() => {
      const r = generateStructuredReport(dossier, snap);
      setReport(r);
      upsertDossier({ id: dossierId, report: r } as any);
      patchCommittee(dossierId, { rapportGenere: true });
      addEvent({ type: "rapport_generated", dossierId,
        message: `Rapport comité généré — ${r.smartscore.score}/100 (${r.smartscore.grade})` });
      refresh();
      setGenerating(false);
    }, 500);
  }, [dossierId, dossier, snap, refresh]);

  // ── Save decision ──
  const handleSaveDecision = () => {
    if (!dossierId) return;
    patchCommittee(dossierId, {
      decision,
      conditions: conditions || undefined,
      commentaire: commentaire || undefined,
      rapportGenere: hasRealReport,
      decidedAt: decision !== "en_attente" ? new Date().toISOString() : undefined,
    });
    addEvent({ type: "committee_decision", dossierId,
      message: `Décision comité : ${DECISIONS.find((d) => d.value === decision)?.label ?? decision}` });
    refresh(); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  // ── Guard ──
  if (!dossierId) {
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900 mb-4">Comité Crédit</h1>
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-500 mb-4">Aucun dossier sélectionné.</p>
          <button onClick={() => navigate("/banque/dossiers")}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
            Voir le pipeline
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Comité Crédit</h1>
          <p className="text-sm text-slate-500 mt-0.5">{dossier?.nom || "Dossier"} — {dossierId}</p>
        </div>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Score</p>
          <p className="text-2xl font-bold text-slate-900">{analysis?.score ?? smartScore?.score ?? "—"}</p>
          {(analysis?.label || smartScore?.grade) && (
            <span className="text-xs font-semibold text-indigo-600">{analysis?.label ?? smartScore?.grade}</span>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Risque</p>
          <p className="text-lg font-bold text-slate-900 capitalize">{analysis?.niveau?.toLowerCase() ?? snap?.riskAnalysis?.globalLevel ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Garanties</p>
          <p className="text-lg font-bold text-slate-900">{garanties?.items?.length ?? 0} sûreté(s)</p>
          {garanties?.couvertureTotale != null && (
            <span className="text-xs text-slate-400">{(garanties.couvertureTotale / 1e6).toFixed(2)} M€</span>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Documents</p>
          <p className="text-lg font-bold text-slate-900">{documents?.completude != null ? `${documents.completude}%` : "—"}</p>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex items-center gap-2 mb-6">
        <button type="button" onClick={() => navigate(`/banque/dossier/${dossierId}`)}
          className="text-xs text-slate-500 hover:text-slate-700 underline">← Dossier</button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={() => navigate(`/banque/analyse/${dossierId}`)}
          className="text-xs text-slate-500 hover:text-slate-700 underline">← Analyse</button>
      </div>

      {/* ═══════════════════════════════════════
          RAPPORT COMITÉ — header + generate button
         ═══════════════════════════════════════ */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">Rapport Comité</h2>
          <div className="flex items-center gap-2">
            {hasRealReport ? (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-green-100 text-green-700">Généré</span>
            ) : committee?.rapportGenere ? (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-100 text-amber-700">Incomplet</span>
            ) : null}
            <button type="button" onClick={handleGenerate} disabled={generating}
              className={["px-4 py-2 rounded-lg text-sm font-medium transition-all",
                generating ? "bg-slate-300 text-slate-500 cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700",
              ].join(" ")}>
              {generating ? <span className="flex items-center gap-2"><Spinner />{hasRealReport ? "Régénération…" : "Génération…"}</span>
                : hasRealReport ? "Regénérer" : "Générer le rapport"}
            </button>
          </div>
        </div>

        {hasRealReport && (
          <p className="text-xs text-slate-400 mb-2">
            Généré le {new Date(report.generatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        {/* No report yet */}
        {!hasRealReport && !committee?.rapportGenere && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📋</div>
            <p className="text-sm text-slate-500">Générez le rapport pour le présenter au comité.</p>
          </div>
        )}
        {!hasRealReport && committee?.rapportGenere && (
          <div className="text-center py-6">
            <div className="text-3xl mb-2">⚠️</div>
            <p className="text-sm text-amber-700 font-medium mb-1">Rapport marqué mais contenu vide.</p>
            <p className="text-xs text-slate-500">Cliquez "Regénérer" ci-dessus.</p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════
          RAPPORT BODY (rich React rendering)
         ═══════════════════════════════════════ */}
      {hasRealReport && (
        <div className="space-y-5 mb-8">
          {/* ── Meta header ── */}
          <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Rapport de comité crédit</p>
                <p className="text-lg font-bold text-slate-900 mt-1">{report.meta.dossierLabel}</p>
                <p className="text-xs text-slate-500 mt-0.5">ID: {report.meta.dossierId} — Statut: {report.meta.statut}</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <span className={["inline-flex items-center justify-center w-10 h-10 rounded-xl text-lg font-extrabold",
                    LABEL_COLORS[report.risk.grade]].join(" ")}>{report.risk.grade}</span>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{report.risk.score}</p>
                    <p className="text-[10px] text-slate-400">/ 100</p>
                  </div>
                </div>
                <span className={["inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold",
                  NIVEAU_COLORS[report.risk.niveau]].join(" ")}>{report.risk.niveau}</span>
              </div>
            </div>
          </div>

          {/* ── Emprunteur ── */}
          <ReportCard title="Emprunteur" icon="👤">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">{report.emprunteur.identite}</p>
                <p className="text-xs text-slate-500 capitalize mt-0.5">
                  {report.emprunteur.type === "personne_physique" ? "Personne physique"
                    : report.emprunteur.type === "personne_morale" ? "Personne morale" : "Non renseigné"}
                </p>
              </div>
            </div>
            {Object.keys(report.emprunteur.details).length > 0 && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-3">
                {Object.entries(report.emprunteur.details).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-800 font-medium">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </ReportCard>

          {/* ── Projet ── */}
          <ReportCard title="Données du projet" icon="🏗️">
            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Montant" value={report.projet.montant ? `${(report.projet.montant / 1e6).toFixed(2)} M€` : "—"} />
              <InfoRow label="Durée" value={report.projet.duree ? `${report.projet.duree} mois` : "—"} />
              <InfoRow label="Type de prêt" value={report.projet.typePretLabel || "—"} />
              <InfoRow label="Adresse" value={report.projet.adresse || "—"} />
            </div>
            {report.projet.notes && (
              <p className="mt-3 text-xs text-slate-500 italic">Notes : {report.projet.notes}</p>
            )}
          </ReportCard>

          {/* ── Synthèse risque ── */}
          <ReportCard title="Synthèse de risque" icon="⚡">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Score</p>
                <p className="text-2xl font-bold text-slate-900">{report.risk.score}/100</p>
              </div>
              <div className="text-center rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Note</p>
                <span className={["inline-flex items-center justify-center w-8 h-8 rounded-lg text-lg font-extrabold mt-0.5",
                  LABEL_COLORS[report.risk.grade]].join(" ")}>{report.risk.grade}</span>
              </div>
              <div className="text-center rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Niveau</p>
                <span className={["inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold",
                  NIVEAU_COLORS[report.risk.niveau]].join(" ")}>{report.risk.niveau}</span>
              </div>
            </div>
            {report.risk.computedAt && (
              <p className="text-[10px] text-slate-400 mb-3">
                Calculé le {new Date(report.risk.computedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            {report.risk.alertes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-600">Alertes ({report.risk.alertes.length})</p>
                {report.risk.alertes.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            )}
          </ReportCard>

          {/* ── Garanties table ── */}
          <ReportCard title={`Garanties & Sûretés (${report.garanties.total})`} icon="🛡️">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center rounded-lg bg-slate-50 p-2.5">
                <p className="text-[10px] text-slate-500">Nombre</p>
                <p className="text-lg font-bold text-slate-900">{report.garanties.total}</p>
              </div>
              <div className="text-center rounded-lg bg-slate-50 p-2.5">
                <p className="text-[10px] text-slate-500">Couverture</p>
                <p className="text-lg font-bold text-slate-900">{(report.garanties.couverture / 1e6).toFixed(2)} M€</p>
              </div>
              <div className="text-center rounded-lg bg-slate-50 p-2.5">
                <p className="text-[10px] text-slate-500">Ratio gar./prêt</p>
                <p className={["text-lg font-bold",
                  report.garanties.ratio === null ? "text-slate-400"
                    : report.garanties.ratio >= 100 ? "text-green-700" : "text-amber-700",
                ].join(" ")}>
                  {report.garanties.ratio !== null ? `${report.garanties.ratio}%` : "—"}
                </p>
              </div>
            </div>
            {report.garanties.items.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-1.5 font-semibold text-slate-500">#</th>
                    <th className="text-left py-1.5 font-semibold text-slate-500">Type</th>
                    <th className="text-left py-1.5 font-semibold text-slate-500">Description</th>
                    <th className="text-right py-1.5 font-semibold text-slate-500">Valeur</th>
                    <th className="text-center py-1.5 font-semibold text-slate-500">Rang</th>
                  </tr>
                </thead>
                <tbody>
                  {report.garanties.items.map((g, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 text-slate-400">{i + 1}</td>
                      <td className="py-1.5 capitalize text-slate-700">{g.type}</td>
                      <td className="py-1.5 text-slate-700">{g.description}</td>
                      <td className="py-1.5 text-right font-medium text-slate-900">
                        {g.valeur ? `${(g.valeur / 1e6).toFixed(2)} M€` : "—"}
                      </td>
                      <td className="py-1.5 text-center text-slate-500">{g.rang ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {report.garanties.commentaire && (
              <p className="mt-2 text-xs text-slate-500 italic">Note : {report.garanties.commentaire}</p>
            )}
          </ReportCard>

          {/* ── Documents table ── */}
          <ReportCard title={`Documents (${report.documents.total})`} icon="📄">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>Complétude</span><span>{report.documents.completeness}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${report.documents.completeness}%` }} />
                </div>
              </div>
              <p className="text-lg font-bold text-slate-900 w-16 text-center">{report.documents.total}</p>
            </div>
            {report.documents.items.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-1.5 font-semibold text-slate-500">Nom</th>
                    <th className="text-left py-1.5 font-semibold text-slate-500">Type</th>
                    <th className="text-left py-1.5 font-semibold text-slate-500">Statut</th>
                    <th className="text-left py-1.5 font-semibold text-slate-500">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {report.documents.items.map((d, i) => {
                    const st = DOC_STATUS_DISPLAY[d.statut] ?? { label: d.statut, cls: "bg-gray-100 text-gray-700" };
                    return (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5 text-slate-700">{d.nom}</td>
                        <td className="py-1.5 text-slate-500">{d.type}</td>
                        <td className="py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="py-1.5 text-slate-400">{d.commentaire || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ReportCard>

          {/* ── SmartScore détaillé ── */}
          <ReportCard title="SmartScore — Détail par pilier" icon="🎯">
            <div className="flex items-center gap-4 mb-5">
              <div className="flex items-center gap-3">
                <span className={["inline-flex items-center justify-center w-14 h-14 rounded-2xl text-2xl font-extrabold",
                  LABEL_COLORS[report.smartscore.grade]].join(" ")}>{report.smartscore.grade}</span>
                <div>
                  <p className="text-3xl font-bold text-slate-900 leading-none">{report.smartscore.score}</p>
                  <p className="text-xs text-slate-400">/ 100</p>
                </div>
              </div>
              <div className="flex-1 ml-4">
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className={["h-full rounded-full transition-all duration-700",
                    report.smartscore.score >= 80 ? "bg-green-500" : report.smartscore.score >= 60 ? "bg-amber-500"
                      : report.smartscore.score >= 40 ? "bg-orange-500" : "bg-red-500",
                  ].join(" ")} style={{ width: `${report.smartscore.score}%` }} />
                </div>
              </div>
            </div>

            {/* Pillar bars */}
            <div className="space-y-3 mb-5">
              {report.smartscore.pillars.map((p) => (
                <PillarDetail key={p.key} pillar={p} />
              ))}
            </div>

            {/* Drivers */}
            {(report.smartscore.drivers.up.length > 0 || report.smartscore.drivers.down.length > 0) && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {report.smartscore.drivers.up.length > 0 && (
                  <div className="rounded-lg bg-green-50 border border-green-100 p-3">
                    <p className="text-[10px] font-semibold text-green-800 uppercase tracking-wide mb-1.5">Points forts</p>
                    {report.smartscore.drivers.up.map((d, i) => (
                      <p key={i} className="text-xs text-green-700 flex items-start gap-1.5 mb-0.5">
                        <span className="mt-0.5 w-1 h-1 rounded-full bg-green-500 flex-shrink-0" />{d}
                      </p>
                    ))}
                  </div>
                )}
                {report.smartscore.drivers.down.length > 0 && (
                  <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                    <p className="text-[10px] font-semibold text-red-800 uppercase tracking-wide mb-1.5">Points de vigilance</p>
                    {report.smartscore.drivers.down.map((d, i) => (
                      <p key={i} className="text-xs text-red-700 flex items-start gap-1.5 mb-0.5">
                        <span className="mt-0.5 w-1 h-1 rounded-full bg-red-500 flex-shrink-0" />{d}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recommendations */}
            {report.smartscore.recommendations.length > 0 && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
                <p className="text-[10px] font-semibold text-indigo-800 uppercase tracking-wide mb-2">Recommandations</p>
                <ol className="space-y-1">
                  {report.smartscore.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-indigo-700 flex items-start gap-2">
                      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-200 text-[9px] font-bold text-indigo-700 flex items-center justify-center">{i + 1}</span>
                      {r}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </ReportCard>

          {/* ── Footer ── */}
          <div className="text-center py-3">
            <p className="text-[10px] text-slate-400">
              Rapport généré automatiquement par Mimmoza — support d'aide à la décision.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════
          DÉCISION DU COMITÉ
         ═══════════════════════════════════════ */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Décision du comité</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {DECISIONS.map((d) => (
            <button key={d.value} type="button" onClick={() => setDecision(d.value)}
              className={["px-4 py-2 rounded-lg text-sm font-medium border transition-all",
                decision === d.value
                  ? `${d.color} border-current ring-2 ring-offset-1 ring-current/20`
                  : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700",
              ].join(" ")}>
              {d.label}
            </button>
          ))}
        </div>
        {(decision === "conditionnel" || decision === "ajourne") && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Conditions / Réserves</label>
            <textarea value={conditions} onChange={(e) => setConditions(e.target.value)}
              rows={3} placeholder="Précisez les conditions ou réserves…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
          </div>
        )}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Commentaire du comité</label>
          <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
            rows={3} placeholder="Observations, justification…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
        </div>
        <div className="flex justify-end">
          <button onClick={handleSaveDecision}
            className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
            Enregistrer la décision
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function ReportCard({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
        {icon && <span className="text-base">{icon}</span>}
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function PillarDetail({ pillar }: { pillar: PillarResult }) {
  const pct = Math.round((pillar.points / pillar.max) * 100);
  const bar = PILLAR_BAR[pillar.key] ?? "bg-slate-500";

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-semibold text-slate-700">{pillar.label}</span>
        <span className="text-slate-500">{pillar.points} / {pillar.max} pts</span>
      </div>
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
        <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {pillar.reasons.length > 0 && (
        <div className="space-y-0.5 mb-1">
          {pillar.reasons.map((r, i) => (
            <p key={i} className="text-[11px] text-slate-600">{r}</p>
          ))}
        </div>
      )}
      {pillar.actions.length > 0 && (
        <div className="space-y-0.5 mt-1 pt-1 border-t border-slate-200">
          {pillar.actions.map((a, i) => (
            <p key={i} className="text-[11px] text-indigo-600 flex items-start gap-1.5">
              <span className="mt-0.5">→</span>{a}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}