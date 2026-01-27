// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyKpis.tsx

import React from "react";
import type { MarketStudyResponse, PoiCategory } from "../types/marketStudy.types";
import { POI_CATEGORY_LABELS, POI_CATEGORY_ICONS } from "../types/marketStudy.types";
import { formatNumber, formatDistance } from "../hooks/useMarketStudy";

interface MarketStudyKpisProps {
  data: MarketStudyResponse | null;
  loading: boolean;
}

export const MarketStudyKpis: React.FC<MarketStudyKpisProps> = ({
  data,
  loading,
}) => {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-lg shadow p-4 text-center text-gray-500">
        Lancez une étude pour voir les indicateurs
      </div>
    );
  }

  const categories = Object.keys(data.kpis.counts) as PoiCategory[];

  // Calcul du total
  const totalPois = Object.values(data.kpis.counts).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        📊 Équipements & Services
        <span className="ml-2 text-sm font-normal text-gray-500">
          ({totalPois} dans un rayon de {data.context.radius_km} km)
        </span>
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {categories.map((cat) => {
          const count = data.kpis.counts[cat];
          const nearest = data.kpis.nearest[cat];

          return (
            <div
              key={cat}
              className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{POI_CATEGORY_ICONS[cat]}</span>
                <span className="text-sm font-medium text-gray-700 truncate">
                  {POI_CATEGORY_LABELS[cat]}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-gray-900">
                  {formatNumber(count)}
                </span>
                {nearest !== null && (
                  <span className="text-xs text-gray-500">
                    min: {formatDistance(nearest)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Indicateurs INSEE */}
      {data.insee && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            👥 Données démographiques
            {data.insee.insee_partial && (
              <span className="ml-2 text-xs font-normal text-orange-500">
                (données partielles)
              </span>
            )}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Population"
              value={formatNumber(data.insee.population)}
              sublabel={data.insee.population_year?.toString()}
            />
            <KpiCard
              label="Densité"
              value={
                data.insee.densite_hab_km2
                  ? `${formatNumber(data.insee.densite_hab_km2)} hab/km²`
                  : "N/A"
              }
            />
            {data.insee.taux_chomage !== undefined && (
              <KpiCard
                label="Chômage"
                value={`${data.insee.taux_chomage.toFixed(1)}%`}
              />
            )}
            {data.insee.revenu_median !== undefined && (
              <KpiCard
                label="Revenu médian"
                value={`${formatNumber(data.insee.revenu_median)} €`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Sous-composant carte KPI
interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, sublabel }) => (
  <div className="bg-blue-50 rounded-lg p-3">
    <div className="text-xs text-gray-600 mb-1">{label}</div>
    <div className="text-lg font-bold text-blue-900">{value}</div>
    {sublabel && <div className="text-xs text-gray-500">{sublabel}</div>}
  </div>
);

export default MarketStudyKpis;