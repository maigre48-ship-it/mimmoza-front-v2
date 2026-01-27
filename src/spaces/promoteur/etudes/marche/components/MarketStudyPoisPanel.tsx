// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyPoisPanel.tsx

import React, { useState } from "react";
import type { MarketStudyResponse, PoiCategory, Poi } from "../types/marketStudy.types";
import { POI_CATEGORY_LABELS, POI_CATEGORY_ICONS } from "../types/marketStudy.types";
import { formatDistance } from "../hooks/useMarketStudy";

interface MarketStudyPoisPanelProps {
  data: MarketStudyResponse | null;
  loading: boolean;
  onCategorySelect?: (categories: PoiCategory[]) => void;
}

export const MarketStudyPoisPanel: React.FC<MarketStudyPoisPanelProps> = ({
  data,
  loading,
  onCategorySelect,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-40 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-lg shadow p-4 text-center text-gray-500">
        Points d'intérêt non disponibles
      </div>
    );
  }

  const categories = Object.keys(data.pois.categories) as PoiCategory[];
  const poisToShow = selectedCategory
    ? data.pois.categories[selectedCategory]
    : data.pois.all;

  const handleCategoryClick = (cat: PoiCategory) => {
    const newSelection = selectedCategory === cat ? null : cat;
    setSelectedCategory(newSelection);
    onCategorySelect?.(newSelection ? [newSelection] : []);
  };

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div
        className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <h2 className="text-lg font-semibold text-gray-900">
          📍 Points d'intérêt
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({data.pois.all.length} trouvés)
          </span>
        </h2>
        <span className="text-gray-400">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="p-4">
          {/* Filtres par catégorie */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => {
                setSelectedCategory(null);
                onCategorySelect?.([]);
              }}
              className={`px-2 py-1 text-xs rounded-full ${
                !selectedCategory
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Tous ({data.pois.all.length})
            </button>
            {categories.map((cat) => {
              const count = data.kpis.counts[cat];
              if (count === 0) return null;

              return (
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${
                    selectedCategory === cat
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  <span>{POI_CATEGORY_ICONS[cat]}</span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Liste des POIs */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Nom
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Distance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {poisToShow.slice(0, 20).map((poi) => (
                  <PoiRow key={poi.id} poi={poi} />
                ))}
              </tbody>
            </table>
            {poisToShow.length > 20 && (
              <div className="px-3 py-2 bg-gray-50 text-center text-xs text-gray-500">
                ... et {poisToShow.length - 20} autres
              </div>
            )}
            {poisToShow.length === 0 && (
              <div className="px-3 py-4 text-center text-gray-500">
                Aucun point d'intérêt trouvé
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Ligne de POI
interface PoiRowProps {
  poi: Poi;
}

const PoiRow: React.FC<PoiRowProps> = ({ poi }) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => setShowDetails(!showDetails)}
      >
        <td className="px-3 py-2">
          <span className="flex items-center gap-1">
            <span>{POI_CATEGORY_ICONS[poi.category]}</span>
            <span className="text-gray-600 text-xs">
              {POI_CATEGORY_LABELS[poi.category]}
            </span>
          </span>
        </td>
        <td className="px-3 py-2 text-gray-900">
          {poi.name || <span className="text-gray-400 italic">Sans nom</span>}
        </td>
        <td className="px-3 py-2 text-right text-gray-600">
          {formatDistance(poi.distance_km)}
        </td>
      </tr>
      {showDetails && poi.tags && Object.keys(poi.tags).length > 0 && (
        <tr>
          <td colSpan={3} className="px-3 py-2 bg-gray-50">
            <div className="text-xs text-gray-500 space-y-1">
              {Object.entries(poi.tags)
                .filter(([k]) => !k.startsWith("addr:") && k !== "name")
                .slice(0, 5)
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="font-medium">{k}:</span> {v}
                  </div>
                ))}
              <div className="text-gray-400">
                Coords: {poi.lat.toFixed(5)}, {poi.lon.toFixed(5)}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default MarketStudyPoisPanel;