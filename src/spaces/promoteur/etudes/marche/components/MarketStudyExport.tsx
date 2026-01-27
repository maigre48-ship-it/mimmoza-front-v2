// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyExport.tsx

import React, { useState } from "react";
import type { MarketStudyResponse } from "../types/marketStudy.types";
import {
  exportMarketStudyToJson,
  exportMarketStudyToCsv,
} from "../api/marketStudyApi";

interface MarketStudyExportProps {
  data: MarketStudyResponse | null;
  loading: boolean;
}

export const MarketStudyExport: React.FC<MarketStudyExportProps> = ({
  data,
  loading,
}) => {
  const [exporting, setExporting] = useState(false);

  const handleExportJson = async () => {
    if (!data) return;
    setExporting(true);
    try {
      exportMarketStudyToJson(data);
    } catch (err) {
      console.error("Export JSON error:", err);
      alert("Erreur lors de l'export JSON");
    }
    setExporting(false);
  };

  const handleExportCsv = async () => {
    if (!data) return;
    setExporting(true);
    try {
      exportMarketStudyToCsv(data);
    } catch (err) {
      console.error("Export CSV error:", err);
      alert("Erreur lors de l'export CSV");
    }
    setExporting(false);
  };

  const disabled = !data || loading || exporting;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        📥 Exporter l'étude
      </h2>

      <div className="flex flex-wrap gap-3">
        {/* Export JSON */}
        <button
          onClick={handleExportJson}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <LoadingSpinner />
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          )}
          Export JSON
        </button>

        {/* Export CSV */}
        <button
          onClick={handleExportCsv}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <LoadingSpinner />
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          )}
          Export CSV
        </button>
      </div>

      {data && (
        <p className="mt-3 text-xs text-gray-500">
          Fichier généré le{" "}
          {new Date(data.meta.generated_at).toLocaleString("fr-FR")}
          {data.location.commune_nom && ` pour ${data.location.commune_nom}`}
        </p>
      )}

      {!data && !loading && (
        <p className="mt-3 text-sm text-gray-500">
          Lancez une étude pour pouvoir l'exporter
        </p>
      )}
    </div>
  );
};

// Spinner de chargement
const LoadingSpinner: React.FC = () => (
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
);

export default MarketStudyExport;