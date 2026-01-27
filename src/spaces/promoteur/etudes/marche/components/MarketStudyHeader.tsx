// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyHeader.tsx

import React from "react";
import type { MarketStudyResponse, MarketStudyParams } from "../types/marketStudy.types";

interface MarketStudyHeaderProps {
  data: MarketStudyResponse | null;
  loading: boolean;
  lastParams: MarketStudyParams | null;
  onContextChange: (context: "urban" | "rural") => void;
  onRadiusChange: (radius: number) => void;
  onRefresh: () => void;
}

export const MarketStudyHeader: React.FC<MarketStudyHeaderProps> = ({
  data,
  loading,
  lastParams,
  onContextChange,
  onRadiusChange,
  onRefresh,
}) => {
  const currentContext = data?.context.context || lastParams?.context || "urban";
  const currentRadius = data?.context.radius_km || lastParams?.radius_km || 5;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Titre et localisation */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Étude de Marché
          </h1>
          {data && (
            <p className="text-sm text-gray-600 mt-1">
              📍 {data.location.commune_nom || "Position"}{" "}
              <span className="text-gray-400">
                ({data.location.lat.toFixed(4)}, {data.location.lon.toFixed(4)})
              </span>
            </p>
          )}
        </div>

        {/* Contrôles */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Toggle Urban/Rural */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Contexte:</span>
            <div className="inline-flex rounded-md shadow-sm">
              <button
                type="button"
                onClick={() => onContextChange("urban")}
                disabled={loading}
                className={`px-3 py-1.5 text-sm font-medium rounded-l-md border ${
                  currentContext === "urban"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                } disabled:opacity-50`}
              >
                🏙️ Urbain
              </button>
              <button
                type="button"
                onClick={() => onContextChange("rural")}
                disabled={loading}
                className={`px-3 py-1.5 text-sm font-medium rounded-r-md border-t border-r border-b ${
                  currentContext === "rural"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                } disabled:opacity-50`}
              >
                🌳 Rural
              </button>
            </div>
          </div>

          {/* Slider Rayon */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Rayon:</span>
            <input
              type="range"
              min="1"
              max="30"
              step="1"
              value={currentRadius}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              disabled={loading}
              className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
            <span className="text-sm font-medium text-gray-900 w-12">
              {currentRadius} km
            </span>
          </div>

          {/* Bouton Refresh */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || !lastParams}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Chargement...
              </>
            ) : (
              <>🔄 Relancer</>
            )}
          </button>
        </div>
      </div>

      {/* Bandeau d'info */}
      {data && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-4 text-sm text-gray-500">
          <span>
            🕐 Généré le{" "}
            {new Date(data.meta.generated_at).toLocaleString("fr-FR")}
          </span>
          <span>
            📊 Sources:{" "}
            {data.meta.sources.overpass && "POI ✓"}{" "}
            {data.meta.sources.insee && "INSEE ✓"}{" "}
            {data.meta.sources.dvf && "DVF ✓"}
          </span>
        </div>
      )}
    </div>
  );
};

export default MarketStudyHeader;