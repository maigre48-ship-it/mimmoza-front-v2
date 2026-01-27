// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyCompsPanel.tsx

import React, { useState, useMemo } from "react";
import type { MarketStudyResponse, DvfTransaction } from "../types/marketStudy.types";
import { formatPrice, formatNumber, formatDistance } from "../hooks/useMarketStudy";

interface MarketStudyCompsPanelProps {
  data: MarketStudyResponse | null;
  loading: boolean;
}

export const MarketStudyCompsPanel: React.FC<MarketStudyCompsPanelProps> = ({
  data,
  loading,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "price" | "distance">("date");

  // Filtrer et trier les transactions
  const transactions = useMemo(() => {
    if (!data?.comps.items) return [];

    let items = [...data.comps.items];

    // Filtrer par type
    if (typeFilter) {
      items = items.filter((tx) => tx.type_local === typeFilter);
    }

    // Trier
    items.sort((a, b) => {
      switch (sortBy) {
        case "date":
          return (b.date_mutation || "").localeCompare(a.date_mutation || "");
        case "price":
          return (b.valeur_fonciere || 0) - (a.valeur_fonciere || 0);
        case "distance":
          return (a.distance_km || 999) - (b.distance_km || 999);
        default:
          return 0;
      }
    });

    return items;
  }, [data?.comps.items, typeFilter, sortBy]);

  // Types de biens uniques
  const typeOptions = useMemo(() => {
    if (!data?.comps.items) return [];
    const types = new Set(
      data.comps.items.map((tx) => tx.type_local).filter(Boolean)
    );
    return Array.from(types) as string[];
  }, [data?.comps.items]);

  // Statistiques
  const stats = useMemo(() => {
    if (!transactions.length)
      return { avgPrice: 0, avgPriceM2: 0, count: 0 };

    const withPrice = transactions.filter((tx) => tx.valeur_fonciere > 0);
    const withPriceM2 = transactions.filter(
      (tx) => tx.prix_m2 && tx.prix_m2 > 0
    );

    return {
      count: transactions.length,
      avgPrice:
        withPrice.length > 0
          ? withPrice.reduce((sum, tx) => sum + tx.valeur_fonciere, 0) /
            withPrice.length
          : 0,
      avgPriceM2:
        withPriceM2.length > 0
          ? withPriceM2.reduce((sum, tx) => sum + (tx.prix_m2 || 0), 0) /
            withPriceM2.length
          : 0,
    };
  }, [transactions]);

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
        Données DVF non disponibles
      </div>
    );
  }

  const { comps } = data;

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div
        className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <h2 className="text-lg font-semibold text-gray-900">
          🏠 Transactions immobilières (DVF)
          {comps.dvf_available ? (
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({comps.items.length} transactions)
            </span>
          ) : (
            <span className="ml-2 text-xs font-normal text-red-500 bg-red-50 px-2 py-0.5 rounded">
              Non disponible
            </span>
          )}
        </h2>
        <span className="text-gray-400">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="p-4">
          {!comps.dvf_available ? (
            <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
              <p className="mb-2">📊 Données DVF non disponibles pour cette zone</p>
              <p className="text-xs">
                Les transactions peuvent ne pas être couvertes ou la période est
                trop récente.
              </p>
            </div>
          ) : comps.items.length === 0 ? (
            <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
              Aucune transaction trouvée dans le rayon défini
            </div>
          ) : (
            <>
              {/* Statistiques */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-600">Transactions</div>
                  <div className="text-xl font-bold text-blue-900">
                    {stats.count}
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-600">Prix moyen</div>
                  <div className="text-lg font-bold text-green-900">
                    {formatPrice(stats.avgPrice)}
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-600">Prix/m² moyen</div>
                  <div className="text-lg font-bold text-purple-900">
                    {stats.avgPriceM2 > 0
                      ? `${formatNumber(Math.round(stats.avgPriceM2))} €/m²`
                      : "N/A"}
                  </div>
                </div>
              </div>

              {/* Filtres */}
              <div className="flex flex-wrap gap-2 mb-4">
                {/* Filtre type */}
                <select
                  value={typeFilter || ""}
                  onChange={(e) =>
                    setTypeFilter(e.target.value || null)
                  }
                  className="px-2 py-1 text-sm border border-gray-300 rounded-md"
                >
                  <option value="">Tous les types</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>

                {/* Tri */}
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as "date" | "price" | "distance")
                  }
                  className="px-2 py-1 text-sm border border-gray-300 rounded-md"
                >
                  <option value="date">Trier par date</option>
                  <option value="price">Trier par prix</option>
                  <option value="distance">Trier par distance</option>
                </select>
              </div>

              {/* Liste des transactions */}
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                          Type
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                          Prix
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                          Surface
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                          €/m²
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                          Dist.
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {transactions.slice(0, 20).map((tx) => (
                        <TransactionRow key={tx.id} tx={tx} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {transactions.length > 20 && (
                  <div className="px-3 py-2 bg-gray-50 text-center text-xs text-gray-500">
                    ... et {transactions.length - 20} autres transactions
                  </div>
                )}
              </div>

              {/* Source */}
              <div className="text-xs text-gray-500 mt-3">
                Source : DVF (Demandes de Valeurs Foncières) - data.gouv.fr
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Ligne de transaction
interface TransactionRowProps {
  tx: DvfTransaction;
}

const TransactionRow: React.FC<TransactionRowProps> = ({ tx }) => {
  const [showDetails, setShowDetails] = useState(false);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => setShowDetails(!showDetails)}
      >
        <td className="px-3 py-2 text-gray-600">
          {formatDate(tx.date_mutation)}
        </td>
        <td className="px-3 py-2 text-gray-900">
          {tx.type_local || "N/A"}
          {tx.nombre_pieces_principales && (
            <span className="text-gray-500 text-xs ml-1">
              ({tx.nombre_pieces_principales}p)
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-medium text-gray-900">
          {formatPrice(tx.valeur_fonciere)}
        </td>
        <td className="px-3 py-2 text-right text-gray-600">
          {tx.surface_reelle_bati
            ? `${formatNumber(tx.surface_reelle_bati)} m²`
            : "N/A"}
        </td>
        <td className="px-3 py-2 text-right text-gray-600">
          {tx.prix_m2 ? `${formatNumber(tx.prix_m2)} €` : "N/A"}
        </td>
        <td className="px-3 py-2 text-right text-gray-500 text-xs">
          {formatDistance(tx.distance_km)}
        </td>
      </tr>
      {showDetails && (
        <tr>
          <td colSpan={6} className="px-3 py-2 bg-gray-50">
            <div className="text-xs text-gray-600 space-y-1">
              {tx.adresse && (
                <div>
                  <span className="font-medium">Adresse:</span> {tx.adresse}
                  {tx.code_postal && `, ${tx.code_postal}`}
                  {tx.commune && ` ${tx.commune}`}
                </div>
              )}
              <div>
                <span className="font-medium">Nature:</span>{" "}
                {tx.nature_mutation || "N/A"}
              </div>
              {tx.surface_terrain && (
                <div>
                  <span className="font-medium">Terrain:</span>{" "}
                  {formatNumber(tx.surface_terrain)} m²
                </div>
              )}
              {tx.lat && tx.lon && (
                <div className="text-gray-400">
                  Coords: {tx.lat.toFixed(5)}, {tx.lon.toFixed(5)}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export default MarketStudyCompsPanel;