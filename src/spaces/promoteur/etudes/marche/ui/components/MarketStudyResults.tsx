import { Building } from "lucide-react";
import React from "react";
import { getProjectConfig } from "../config/project.config";
import type { EHPADData, MarketStudyResult, ProjectType } from "../types/market.types";

interface Props {
  data: MarketStudyResult;
  projectNature: ProjectType;
  finessData?: EHPADData | null;
}

/**
 * MarketStudyResults
 * - Rendu minimal et robuste
 * - Utilise FINESS dès que disponible
 */
const MarketStudyResults: React.FC<Props> = ({
  data,
  projectNature,
  finessData,
}) => {
  const market = data.market;
  const config = getProjectConfig(projectNature);

  // 🔑 SOURCE DE VÉRITÉ CONCURRENCE
  const ehpadData =
    finessData && Array.isArray(finessData.liste) && finessData.liste.length > 0
      ? finessData
      : market?.ehpad;

  console.log("🧪 MARKETSTUDYRESULTS RENDER", {
    using: ehpadData === finessData ? "FINESS" : "SMARTSCORE",
    count: ehpadData?.count,
    listeLen: ehpadData?.liste?.length,
  });

  if (!market) {
    return (
      <div className="p-6 bg-white rounded-xl border">
        Aucune donnée marché.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* =========================
          HEADER
         ========================= */}
      <div className="p-6 rounded-2xl bg-slate-900 text-white">
        <h2 className="text-2xl font-semibold">
          Étude de marché — {market.insee?.commune}
        </h2>
        <p className="text-sm text-slate-300 mt-1">
          Projet : {config.label}
        </p>
      </div>

      {/* =========================
          CONCURRENCE
         ========================= */}
      {ehpadData && (
        <div className="bg-white rounded-2xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-semibold">
              <Building size={18} />
              Concurrence & offre existante
            </div>
            <span className="text-sm px-3 py-1 rounded-full bg-slate-100">
              {ehpadData.count} établissement(s)
            </span>
          </div>

          {/* Verdict */}
          {ehpadData.analyse_concurrence?.verdict && (
            <div className="mb-4 p-3 rounded-lg bg-slate-50 text-sm">
              {ehpadData.analyse_concurrence.verdict}
            </div>
          )}

          {/* Liste */}
          {Array.isArray(ehpadData.liste) && ehpadData.liste.length > 0 ? (
            <div className="divide-y">
              {ehpadData.liste.map((e, i) => (
                <div key={i} className="py-3 flex justify-between gap-4">
                  <div>
                    <div className="font-medium">{e.nom}</div>
                    <div className="text-xs text-slate-500">
                      {e.adresse || "Adresse non disponible"}
                    </div>
                    <div className="text-xs text-slate-400">
                      {e.commune} — {e.distance_km.toFixed(1)} km
                    </div>
                  </div>

                  <div className="text-right text-sm">
                    <div>
                      {e.capacite ? (
                        <strong>{e.capacite} lits</strong>
                      ) : (
                        <span className="italic text-slate-400">
                          Capacité non publiée
                        </span>
                      )}
                    </div>
                    {e.telephone && (
                      <div className="text-xs text-slate-500">
                        📞 {e.telephone}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm italic text-slate-400">
              Aucun établissement détaillé disponible.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketStudyResults;
