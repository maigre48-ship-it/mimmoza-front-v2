// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyInseePanel.tsx

import React, { useState } from "react";
import { formatNumber } from "../utils/marketFormat";
import type { MarketStudyResponse } from "../types/marketStudy.types";

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

  // ─── Correctif B : mesure, estimation, ou rien ───────────────────────────
  // Un champ nu porte la mesure ou `null` ; l'estimation vit dans un champ
  // dédié. On la lit ici explicitement, ce qui rend impossible de l'afficher
  // sans la nommer. Quand ni l'une ni l'autre n'existe, la carte affiche
  // « N/A » en grisé — c'est déjà la convention de ce composant pour tous ses
  // autres champs absents (prop `unavailable`).
  const chomage = insee.taux_chomage != null
    ? { valeur: insee.taux_chomage, estimee: false }
    : insee.taux_chomage_estime != null
      ? { valeur: insee.taux_chomage_estime, estimee: true }
      : { valeur: null as number | null, estimee: false };

  const proprietaires = insee.pct_proprietaires != null
    ? { valeur: insee.pct_proprietaires, estimee: false }
    : insee.demographie_estimee?.pct_proprietaires != null
      ? { valeur: insee.demographie_estimee.pct_proprietaires, estimee: true }
      : { valeur: null as number | null, estimee: false };

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
                insee.population != null
                  ? formatNumber(insee.population)
                  : "N/A"
              }
              sublabel={
                insee.population_year
                  ? `Année ${insee.population_year}`
                  : undefined
              }
              icon="👤"
              unavailable={insee.population == null}
            />

            {/* Densité */}
            <DataCard
              label="Densité"
              value={
                insee.densite_hab_km2 != null
                  ? `${formatNumber(insee.densite_hab_km2)} hab/km²`
                  : "N/A"
              }
              icon="📊"
              unavailable={insee.densite_hab_km2 == null}
            />

            {/* Taux de chômage — correctif B.
                `taux_chomage` ne porte plus que la MESURE communale ; le repli
                départemental vit dans `taux_chomage_estime`. Le test de garde
                était `=== undefined`, jamais vrai tant que la valeur était
                fabriquée : le « N/A » était inatteignable. Il est ici `== null`,
                et l'estimation, si elle existe, est affichée nommée. */}
            {chomage.valeur != null ? (
              <DataCard
                label="Taux de chômage"
                value={`${chomage.valeur.toFixed(1)}%`}
                icon="📉"
                estimation={chomage.estimee}
                sublabel={chomage.estimee ? "Estimation départementale" : undefined}
              />
            ) : (
              <DataCard
                label="Taux de chômage"
                value="N/A"
                icon="📉"
                unavailable
                sublabel="Non mesuré sur cette commune"
              />
            )}

            {/* Taux de pauvreté */}
            <DataCard
              label="Taux de pauvreté"
              value={
                insee.taux_pauvrete != null
                  ? `${insee.taux_pauvrete.toFixed(1)}%`
                  : "N/A"
              }
              icon="💰"
              unavailable={insee.taux_pauvrete == null}
            />

            {/* % Propriétaires — aucune source communale : seule une estimation
                départementale existe (insee.demographie_estimee). */}
            {proprietaires.valeur != null ? (
              <DataCard
                label="Propriétaires"
                value={`${proprietaires.valeur.toFixed(1)}%`}
                icon="🏠"
                estimation={proprietaires.estimee}
                sublabel={proprietaires.estimee ? "Estimation départementale" : undefined}
              />
            ) : (
              <DataCard
                label="Propriétaires"
                value="N/A"
                icon="🏠"
                unavailable
                sublabel="Non mesuré sur cette commune"
              />
            )}

            {/* Revenu médian */}
            <DataCard
              label="Revenu médian"
              value={
                insee.revenu_median != null
                  ? `${formatNumber(insee.revenu_median)} €/an`
                  : "N/A"
              }
              icon="💶"
              unavailable={insee.revenu_median == null}
              estimation={insee.revenu_median != null && insee.revenu_median_source === "dept_fallback"}
              sublabel={
                insee.revenu_median != null && insee.revenu_median_source === "dept_fallback"
                  ? "Estimation départementale"
                  : undefined
              }
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
            {insee.demographie_estimee && (
              <span className="block mt-1 text-amber-700">
                Les cartes marquées « estimation » proviennent d'un modèle
                départemental et ne sont pas mesurées sur cette commune.
              </span>
            )}
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
  /** Correctif B — la valeur affichée est une ESTIMATION, pas un relevé.
   *  Fond ambre + pastille : même code visuel que la note « (estimation dépt.) »
   *  de la page Promoteur, pour qu'il n'y ait qu'un signal à apprendre. */
  estimation?: boolean;
}

const DataCard: React.FC<DataCardProps> = ({
  label,
  value,
  sublabel,
  icon,
  unavailable,
  estimation,
}) => (
  <div
    className={`p-3 rounded-lg ${
      unavailable ? "bg-gray-50 opacity-60"
        : estimation ? "bg-amber-50 border border-amber-200"
        : "bg-blue-50"
    }`}
  >
    <div className="flex items-center gap-2 mb-1">
      <span>{icon}</span>
      <span className="text-xs text-gray-600">{label}</span>
      {estimation && !unavailable && (
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium"
          title="Valeur estimée à partir d'un modèle départemental — non mesurée sur cette commune."
        >
          estimation
        </span>
      )}
    </div>
    <div
      className={`text-lg font-bold ${
        unavailable ? "text-gray-400" : estimation ? "text-amber-800" : "text-blue-900"
      }`}
    >
      {value}
    </div>
    {sublabel && (
      <div className={`text-xs ${estimation && !unavailable ? "text-amber-700 italic" : "text-gray-500"}`}>
        {sublabel}
      </div>
    )}
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