// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyInseePanel.tsx

import React, { useState } from "react";
import type { MarketStudyResponse } from "../types/marketStudy.types";
import { formatNumber } from "../hooks/useMarketStudy";

interface MarketStudyInseePanelProps {
  data: MarketStudyResponse | null;
  loading: boolean;
}

export const MarketStudyInseePanel: React.FC<MarketStudyInseePanelProps> = ({
  data,
  loading,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-lg shadow p-4 text-center text-gray-500">
        Données INSEE non disponibles
      </div>
    );
  }

  const insee = data.insee;

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div
        className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <h2 className="text-lg font-semibold text-gray-900">
          👥 Données INSEE
          {insee.insee_partial && (
            <span className="ml-2 text-xs font-normal text-orange-500 bg-orange-50 px-2 py-0.5 rounded">
              Partielles
            </span>
          )}
        </h2>
        <span className="text-gray-400">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Avertissement données partielles */}
          {insee.insee_partial && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              <strong>⚠️ Données partielles :</strong> L'API INSEE complète
              nécessite une authentification. Seules les données de base
              (population, densité via geo.api.gouv.fr) sont disponibles.
            </div>
          )}

          {/* Grille de données */}
          <div className="grid grid-cols-2 gap-4">
            {/* Population */}
            <DataCard
              label="Population"
              value={
                insee.population !== undefined
                  ? formatNumber(insee.population)
                  : "N/A"
              }
              sublabel={
                insee.population_year
                  ? `Année ${insee.population_year}`
                  : undefined
              }
              icon="👤"
            />

            {/* Densité */}
            <DataCard
              label="Densité"
              value={
                insee.densite_hab_km2 !== undefined
                  ? `${formatNumber(insee.densite_hab_km2)} hab/km²`
                  : "N/A"
              }
              icon="📊"
            />

            {/* Taux de chômage */}
            <DataCard
              label="Taux de chômage"
              value={
                insee.taux_chomage !== undefined
                  ? `${insee.taux_chomage.toFixed(1)}%`
                  : "N/A"
              }
              icon="📉"
              unavailable={insee.taux_chomage === undefined}
            />

            {/* Taux de pauvreté */}
            <DataCard
              label="Taux de pauvreté"
              value={
                insee.taux_pauvrete !== undefined
                  ? `${insee.taux_pauvrete.toFixed(1)}%`
                  : "N/A"
              }
              icon="💰"
              unavailable={insee.taux_pauvrete === undefined}
            />

            {/* % Propriétaires */}
            <DataCard
              label="Propriétaires"
              value={
                insee.pct_proprietaires !== undefined
                  ? `${insee.pct_proprietaires.toFixed(1)}%`
                  : "N/A"
              }
              icon="🏠"
              unavailable={insee.pct_proprietaires === undefined}
            />

            {/* Revenu médian */}
            <DataCard
              label="Revenu médian"
              value={
                insee.revenu_median !== undefined
                  ? `${formatNumber(insee.revenu_median)} €/an`
                  : "N/A"
              }
              icon="💶"
              unavailable={insee.revenu_median === undefined}
            />
          </div>

          {/* Pyramide des âges */}
          {insee.pyramide_ages && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                📊 Pyramide des âges
              </h3>
              <PyramideAges data={insee.pyramide_ages} />
            </div>
          )}

          {/* Lien vers les sources */}
          <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
            Sources : geo.api.gouv.fr
            {!insee.insee_partial && ", api.insee.fr"}
          </div>
        </div>
      )}
    </div>
  );
};

// Carte de donnée
interface DataCardProps {
  label: string;
  value: string;
  sublabel?: string;
  icon: string;
  unavailable?: boolean;
}

const DataCard: React.FC<DataCardProps> = ({
  label,
  value,
  sublabel,
  icon,
  unavailable,
}) => (
  <div
    className={`p-3 rounded-lg ${
      unavailable ? "bg-gray-50 opacity-60" : "bg-blue-50"
    }`}
  >
    <div className="flex items-center gap-2 mb-1">
      <span>{icon}</span>
      <span className="text-xs text-gray-600">{label}</span>
    </div>
    <div
      className={`text-lg font-bold ${
        unavailable ? "text-gray-400" : "text-blue-900"
      }`}
    >
      {value}
    </div>
    {sublabel && <div className="text-xs text-gray-500">{sublabel}</div>}
  </div>
);

// Composant pyramide des âges
interface PyramideAgesProps {
  data: Record<string, number | undefined>;
}

const PyramideAges: React.FC<PyramideAgesProps> = ({ data }) => {
  const tranches = ["0-14", "15-29", "30-44", "45-59", "60-74", "75+"];
  const maxValue = Math.max(
    ...tranches.map((t) => data[t] || 0).filter((v) => v > 0)
  );

  return (
    <div className="space-y-2">
      {tranches.map((tranche) => {
        const value = data[tranche];
        const percent = value !== undefined ? value : 0;
        const barWidth = maxValue > 0 ? (percent / maxValue) * 100 : 0;

        return (
          <div key={tranche} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-12 text-right">
              {tranche}
            </span>
            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 w-12">
              {value !== undefined ? `${value.toFixed(1)}%` : "N/A"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default MarketStudyInseePanel;