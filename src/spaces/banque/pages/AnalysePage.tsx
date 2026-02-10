// ============================================================================
// AnalysePage.tsx — /banque/analyse/:id
// Analyse MVP via moteur partagé (banqueCalcUtils).
// Score = somme de 5 piliers (doc, garanties, emprunteur, projet, financier).
// Ratio garanties/prêt = source unique computeGarantieRatio.
// ⚠️ Aucune barre workflow (BanqueLayout s'en charge).
// ============================================================================

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import {
  upsertDossier,
  patchRiskAnalysis,
  addEvent,
} from "../store/banqueSnapshot.store";
import {
  computeFullAnalysis,
  type AnalysisResult,
  type Niveau,
  type Label,
  type PillarResult,
} from "../utils/banqueCalcUtils";

// ── Color maps ──

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

// ── Component ──

export default function AnalysePage() {
  const { dossierId, dossier, snap, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();

  const existingAnalysis: AnalysisResult | null = dossier?.analysis ?? null;
  const riskAnalysis = snap?.riskAnalysis;

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(existingAnalysis);
  const [loading, setLoading] = useState(false);
  const [commentaire, setCommentaire] = useState(riskAnalysis?.commentaire ?? "");
  const [saved, setSaved] = useState(false);

  const handleRunAnalysis = useCallback(() => {
    if (!dossierId || !dossier) return;
    setLoading(true);
    setTimeout(() => {
      const result = computeFullAnalysis(dossier);
      setAnalysis(result);
      upsertDossier({ id: dossierId, analysis: result } as any);
      const levelMap: Record<Niveau, string> = { Faible: "faible", Modéré: "modere", Élevé: "eleve", Critique: "critique" };
      patchRiskAnalysis(dossierId, { globalLevel: levelMap[result.niveau], commentaire: commentaire || undefined });
      addEvent({ type: "analysis_computed", dossierId,
        message: `Analyse — Score: ${result.score}/100 (${result.label}) — ${result.niveau} — ${result.alertes.length} alerte(s)` });
      refresh();
      setLoading(false);
    }, 600);
  }, [dossierId, dossier, commentaire, refresh]);

  const handleSaveComment = () => {
    if (!dossierId) return;
    patchRiskAnalysis(dossierId, {
      globalLevel: analysis
        ? { Faible: "faible", Modéré: "modere", Élevé: "eleve", Critique: "critique" }[analysis.niveau]
        : riskAnalysis?.globalLevel ?? "modere",
      commentaire: commentaire || undefined,
    });
    addEvent({ type: "risk_analysis_updated", dossierId, message: "Commentaire mis à jour" });
    refresh(); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  if (!dossierId) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900 mb-4">Analyse</h1>
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

  const ss = analysis?.smartscore;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Analyse de risque</h1>
          <p className="text-sm text-slate-500 mt-0.5">{dossier?.nom || "Dossier"} — {dossierId}</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}
          <button type="button" onClick={() => navigate(`/banque/comite/${dossierId}`)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-all">
            Passer au comité →
          </button>
        </div>
      </div>

      {/* Action bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Moteur d'analyse</h2>
            <p className="text-xs text-slate-500 mt-0.5">Scoring par 5 piliers — documentation, garanties, emprunteur, projet, profil financier.</p>
            {analysis?.calculatedAt && (
              <p className="text-xs text-slate-400 mt-1">
                Dernière analyse : {new Date(analysis.calculatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
          <button type="button" onClick={handleRunAnalysis} disabled={loading}
            className={["px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all",
              loading ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 shadow-sm"].join(" ")}>
            {loading ? <span className="flex items-center gap-2"><Spinner />Analyse…</span>
              : analysis ? "Actualiser l'analyse" : "Lancer l'analyse"}
          </button>
        </div>
      </div>

      {/* KPI row */}
      {analysis && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <KpiCard label="Score" value={String(analysis.score)} sub="/ 100" />
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-xs text-slate-500">Note</p>
            <span className={["inline-flex items-center justify-center w-12 h-12 rounded-xl text-2xl font-extrabold mt-1", LABEL_COLORS[analysis.label]].join(" ")}>
              {analysis.label}
            </span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-xs text-slate-500">Niveau</p>
            <span className={["inline-block mt-2 px-3 py-1 rounded-lg text-sm font-semibold", NIVEAU_COLORS[analysis.niveau]].join(" ")}>
              {analysis.niveau}
            </span>
          </div>
          <KpiCard label="Alertes" value={String(analysis.alertes.length)} />
        </div>
      )}

      {/* Pillar breakdown */}
      {ss && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Détail par pilier</h2>
          <div className="space-y-4">
            {ss.pillars.map((p) => <PillarRow key={p.key} pillar={p} />)}
          </div>
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-sm font-semibold text-slate-900 mb-1">
              <span>Score total</span><span>{ss.score} / 100</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div className={["h-full rounded-full transition-all duration-700",
                ss.score >= 80 ? "bg-green-500" : ss.score >= 60 ? "bg-amber-500" : ss.score >= 40 ? "bg-orange-500" : "bg-red-500",
              ].join(" ")} style={{ width: `${ss.score}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Drivers */}
      {ss && (ss.drivers.up.length > 0 || ss.drivers.down.length > 0) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {ss.drivers.up.length > 0 && (
            <div className="rounded-xl border border-green-200 bg-green-50/50 p-4">
              <h3 className="text-xs font-semibold text-green-800 uppercase tracking-wide mb-2">Points forts</h3>
              {ss.drivers.up.map((d, i) => (
                <p key={i} className="text-sm text-green-700 flex items-start gap-2 mb-1">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />{d}
                </p>
              ))}
            </div>
          )}
          {ss.drivers.down.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
              <h3 className="text-xs font-semibold text-red-800 uppercase tracking-wide mb-2">Points de vigilance</h3>
              {ss.drivers.down.map((d, i) => (
                <p key={i} className="text-sm text-red-700 flex items-start gap-2 mb-1">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />{d}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recommendations */}
      {ss && ss.recommendations.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 mb-6">
          <h3 className="text-sm font-bold text-indigo-900 mb-3">Recommandations prioritaires</h3>
          <ol className="space-y-1.5">
            {ss.recommendations.map((r, i) => (
              <li key={i} className="text-sm text-indigo-800 flex items-start gap-2">
                <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-indigo-200 text-[10px] font-bold text-indigo-700">{i + 1}</span>
                {r}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Alertes */}
      {analysis && analysis.alertes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Alertes ({analysis.alertes.length})</h2>
          <div className="space-y-2">
            {analysis.alertes.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
                <span className={["mt-0.5 w-2 h-2 rounded-full flex-shrink-0",
                  analysis.score >= 60 ? "bg-amber-500" : analysis.score >= 40 ? "bg-orange-500" : "bg-red-500"].join(" ")} />
                <p className="text-sm text-slate-700">{a}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!analysis && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center mb-6">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-slate-500 text-sm">Cliquez sur "Lancer l'analyse" pour calculer le score.</p>
        </div>
      )}

      {/* Commentaire */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Commentaire d'analyse</h2>
        <textarea value={commentaire} onChange={(e) => { setCommentaire(e.target.value); setSaved(false); }}
          rows={4} placeholder="Synthèse manuelle, points de vigilance…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
        <div className="flex justify-end mt-3">
          <button onClick={handleSaveComment}
            className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
            Enregistrer le commentaire
          </button>
        </div>
      </div>

      {/* Source data */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Données source</h2>
        <p className="text-xs text-slate-400 mb-4">Modifiez-les dans l'onglet Dossier.</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <DataRow label="Montant" value={dossier?.origination?.montantDemande ? `${(dossier.origination.montantDemande / 1e6).toFixed(2)} M€` : "—"} warn={!dossier?.origination?.montantDemande} />
          <DataRow label="Durée" value={dossier?.origination?.duree ? `${dossier.origination.duree} mois` : "—"} warn={!dossier?.origination?.duree} />
          <DataRow label="Type" value={dossier?.origination?.typePret || "—"} warn={!dossier?.origination?.typePret} />
          <DataRow label="Emprunteur" value={dossier?.emprunteur?.type === "personne_physique" ? `${dossier.emprunteur.prenom ?? ""} ${dossier.emprunteur.nom ?? ""}`.trim() || "Incomplet" : dossier?.emprunteur?.raisonSociale || "—"} warn={!dossier?.emprunteur?.type} />
          <DataRow label="Garanties" value={dossier?.garanties?.items?.length ? `${dossier.garanties.items.length} — ${((dossier.garanties.couvertureTotale ?? 0) / 1e6).toFixed(2)} M€` : "Aucune"} warn={!dossier?.garanties?.items?.length} />
          <DataRow label="Documents" value={dossier?.documents?.items?.length ? `${dossier.documents.items.length} — ${dossier.documents.completude ?? 0}%` : "Aucun"} warn={!dossier?.documents?.items?.length} />
        </div>
        <div className="mt-4">
          <button type="button" onClick={() => navigate(`/banque/dossier/${dossierId}`)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">← Modifier le dossier</button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function PillarRow({ pillar }: { pillar: PillarResult }) {
  const pct = Math.round((pillar.points / pillar.max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-medium text-slate-700">{pillar.label}</span>
        <span className="text-xs text-slate-500">{pillar.points} / {pillar.max}</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
        <div className={`h-full rounded-full transition-all duration-500 ${PILLAR_BAR[pillar.key] ?? "bg-slate-500"}`}
          style={{ width: `${pct}%` }} />
      </div>
      {pillar.reasons.length > 0 && (
        <div className="pl-1">{pillar.reasons.map((r, i) => <p key={i} className="text-[11px] text-slate-500">{r}</p>)}</div>
      )}
    </div>
  );
}

function DataRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className={["text-xs font-semibold", warn ? "text-amber-600" : "text-slate-900"].join(" ")}>{value}</span>
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