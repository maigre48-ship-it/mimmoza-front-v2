/**
 * BanqueAnalyse.tsx (exemple d'intégration)
 * ────────────────────────────────────────────────────────────────────
 * Page "Analyse des risques" de l'espace Banque.
 *
 * AVANT : state local perdu à la navigation.
 * APRÈS : lecture via useBanqueSnapshot + écriture via patchRiskAnalysis.
 *
 * Pattern appliqué :
 *   ✅ useBanqueSnapshot()     → lecture réactive
 *   ✅ patchRiskAnalysis()     → persistance snapshot
 *   ✅ buildRiskSummary()      → résumé dérivé (pas recalculé localement)
 *   ❌ useState pour le risque → uniquement UI transient (loading, modal open)
 * ────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback } from "react";
import {
  useBanqueSnapshot,
  patchRiskAnalysis,
  patchSmartScore,
  buildRiskSummary,
  computeSmartScore,
  type BanqueRiskAnalysis,
  type RiskItem,
} from "../shared";

// Supposons que tu as un service existant pour appeler l'Edge Function
// import { callRiskAnalysis } from "../../../services/risk.service";

const BanqueAnalyse = () => {
  // ─── Lecture réactive depuis le snapshot ───
  const { snap, dossier, dossierId, riskAnalysis, riskSummary, completeness } =
    useBanqueSnapshot();

  // ─── State UI only (transient, pas persisté) ───
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Handler : lancer l'analyse ───
  const handleAnalyze = useCallback(async () => {
    if (!dossierId || !dossier) {
      setError("Aucun dossier actif. Créez un dossier dans l'Origination.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // ══════════════════════════════════════════════════════════════
      // ICI : ton appel Edge Function existant.
      // Remplace le mock par ton vrai service.
      // ══════════════════════════════════════════════════════════════
      const apiResponse = await mockRiskApiCall(dossier.adresse, dossier.lat, dossier.lon);

      // ─── Persistance dans le snapshot (non-bloquant) ───
      try {
        patchRiskAnalysis(dossierId, {
          globalLevel: apiResponse.globalLevel,
          subscores: apiResponse.subscores,
          items: apiResponse.items,
          missingData: apiResponse.missingData,
          lastComputedAt: new Date().toISOString(),
          rawApiResponse: apiResponse.raw,
        });

        // Recalcul du SmartScore après mise à jour risques
        const updatedSnap = { ...snap, riskAnalysis: apiResponse as BanqueRiskAnalysis };
        const newScore = computeSmartScore(updatedSnap);
        patchSmartScore(dossierId, {
          score0_100: newScore.score,
          subscores: newScore.subscores.map((s) => ({
            ...s,
            label: s.category,
          })),
          explanations: newScore.explanations,
          penalties: newScore.penalties.map((p) => ({ ...p, source: "rule_engine" })),
        });
      } catch (e) {
        console.warn("[BanqueAnalyse] snapshot patch failed (non-blocking)", e);
      }
    } catch (e: any) {
      setError(e.message || "Erreur lors de l'analyse");
    } finally {
      setIsLoading(false);
    }
  }, [dossierId, dossier, snap]);

  // ─── Rendu ───
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          Analyse des risques
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Complétude : {completeness.percent}%
          </span>
          <button
            onClick={handleAnalyze}
            disabled={isLoading || !dossierId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? "Analyse en cours…" : "Lancer l'analyse"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Résumé dérivé du selector — toujours à jour, même après navigation */}
      {riskSummary && (
        <div className="p-4 bg-gray-50 border rounded-lg">
          <p className="font-medium">{riskSummary.text}</p>
          <p className="text-sm text-gray-500 mt-1">
            Dernière analyse : {riskAnalysis?.lastComputedAt
              ? new Date(riskAnalysis.lastComputedAt).toLocaleString("fr-FR")
              : "—"}
          </p>
        </div>
      )}

      {/* Liste des risques depuis le snapshot */}
      {riskAnalysis?.items?.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {riskAnalysis.items.map((item: RiskItem) => (
            <div
              key={item.id}
              className={`p-4 border rounded-lg ${
                item.status === "present"
                  ? "border-red-200 bg-red-50"
                  : item.status === "unknown"
                    ? "border-yellow-200 bg-yellow-50"
                    : "border-green-200 bg-green-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span>
                  {item.status === "present" ? "❗" : item.status === "unknown" ? "⚠️" : "✅"}
                </span>
                <span className="font-medium">{item.label}</span>
              </div>
              {item.detail && (
                <p className="text-sm text-gray-600 mt-1">{item.detail}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        !isLoading && (
          <div className="text-center py-12 text-gray-400">
            Lancez une analyse pour afficher les résultats.
          </div>
        )
      )}
    </div>
  );
};

export default BanqueAnalyse;

// ============================================================================
// Mock — à remplacer par ton vrai service
// ============================================================================
async function mockRiskApiCall(_address?: string, _lat?: number, _lon?: number) {
  await new Promise((r) => setTimeout(r, 1200));
  return {
    globalLevel: "modéré" as const,
    subscores: [
      { category: "naturel", level: "faible" as const, weight: 0.4, label: "Risques naturels" },
      { category: "technologique", level: "modéré" as const, weight: 0.3, label: "Risques technologiques" },
      { category: "réglementaire", level: "faible" as const, weight: 0.3, label: "Risques réglementaires" },
    ],
    items: [
      { id: "flood", label: "Inondation", status: "absent" as const, level: "faible" as const },
      { id: "clay_shrink_swell", label: "Retrait-gonflement argiles", status: "present" as const, level: "modéré" as const, detail: "Aléa moyen" },
      { id: "seismic", label: "Sismicité", status: "absent" as const, level: "faible" as const },
      { id: "radon", label: "Radon", status: "unknown" as const, level: "inconnu" as const },
    ],
    missingData: ["radon"],
    raw: { mock: true },
  };
}