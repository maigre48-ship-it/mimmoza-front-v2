// src/spaces/banque/components/committee/CommitteeSectionRisks.tsx
import React from "react";
import type { CommitteeScoringSettings } from "./CommitteeSettingsModal";

interface CommitteeData {
  decision: "GO" | "GO_AVEC_RESERVES" | "NO_GO" | null;
  confidence: number | null;
  totalScore: number | null;
  riskScore: number | null;
  riskDetails: { label: string; impact: number; detail?: string }[];
  markdown?: string | null;
}

const fmtNum = (v: number | undefined | null, suffix = "") =>
  v !== undefined && v !== null ? `${v.toLocaleString("fr-FR")}${suffix}` : "—";

function riskBand(score: number | null | undefined, goT: number, resT: number) {
  if (score == null) return { label: "Non disponible", cls: "bg-gray-50 text-gray-600 border-gray-200" };
  if (score >= goT) return { label: "Faible", cls: "bg-green-50 text-green-700 border-green-200" };
  if (score >= resT) return { label: "Modéré", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Élevé", cls: "bg-red-50 text-red-700 border-red-200" };
}

export default function CommitteeSectionRisks({
  operation,
  committee,
  settings,
}: {
  operation: any;
  committee: CommitteeData;
  settings?: CommitteeScoringSettings;
}) {
  const geo = operation?.risks?.geo;

  const goT = settings?.goThreshold ?? 70;
  const resT = settings?.reserveThreshold ?? 40;

  // Gather warnings
  const warnings: string[] = [];
  const rawWarnings =
    (operation as any)?.risksWarnings ??
    (operation as any)?.committee?.smartscore?.warnings ??
    (operation as any)?.committee?.warnings ??
    [];
  if (Array.isArray(rawWarnings)) {
    for (const w of rawWarnings) {
      if (typeof w === "string") warnings.push(w);
      else if (w?.message) warnings.push(w.message);
      else if (w?.label) warnings.push(w.label);
    }
  }

  const hasAnyData = geo || committee.riskDetails.length > 0 || warnings.length > 0 || committee.riskScore != null;

  const band = riskBand(committee.riskScore ?? geo?.score ?? null, goT, resT);

  const committeeSource =
    (operation as any)?.committee?.source ??
    (operation as any)?.committee?.smartscore?.source ??
    null;

  const scoringNote = `Lecture bancaire (pré-filtre): ≥${goT} = risque faible (GO possible), ${resT}–${goT - 1} = risque modéré (GO avec réserves), <${resT} = risque élevé (NO GO).`;

  return (
    <details className="group" open>
      <summary className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-900">🌍 Risques</span>
        <span className="text-xs text-gray-400 group-open:rotate-90 transition-transform">▶</span>
      </summary>

      <div className="mt-2 space-y-3 pl-1">
        {!hasAnyData && <p className="text-sm text-gray-400 italic">Non disponible</p>}

        {(committee.riskScore != null || geo?.score != null) && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Interprétation du score risque</p>
                <p className="text-xs text-gray-600 mt-1">{scoringNote}</p>
                {committeeSource && <p className="text-[10px] text-gray-400 mt-1">Source: {String(committeeSource)}</p>}
              </div>
              <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold border ${band.cls}`}>
                {band.label}
              </span>
            </div>
          </div>
        )}

        {geo && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Géorisques</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center">
                <p className="text-xs text-gray-500">Score</p>
                <p className={`text-xl font-bold ${geo.score >= goT ? "text-green-600" : geo.score >= resT ? "text-amber-600" : "text-red-600"}`}>
                  {geo.score}/100
                </p>
                {geo.label && <p className="text-[10px] text-gray-400">{geo.label}</p>}
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Nb risques</p>
                <p className="text-xl font-bold text-gray-800">{fmtNum(geo.nbRisques)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Inondation</p>
                <p className="text-sm font-bold">
                  {geo.hasInondation ? <span className="text-red-600">Oui</span> : <span className="text-green-600">Non</span>}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Sismique</p>
                <p className="text-sm font-bold">
                  {geo.hasSismique ? <span className="text-amber-600">Oui</span> : <span className="text-green-600">Non</span>}
                </p>
              </div>
            </div>
          </div>
        )}

        {committee.riskDetails.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Détails risques comité</p>
            {committee.riskDetails.map((r, i) => (
              <div
                key={i}
                className={`flex items-start justify-between gap-2 px-3 py-2 rounded-lg text-sm ${
                  Math.abs(r.impact) >= 20 ? "bg-red-50 text-red-700" : Math.abs(r.impact) >= 10 ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-600"
                }`}
              >
                <div className="min-w-0">
                  <span className="font-medium">{r.label}</span>
                  {r.detail && <p className="text-xs opacity-70 mt-0.5">{r.detail}</p>}
                </div>
                <span className="text-xs font-bold shrink-0">
                  {r.impact > 0 ? "+" : ""}
                  {r.impact}
                </span>
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Alertes / Blocants</p>
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs">
                <span>⚠️</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
