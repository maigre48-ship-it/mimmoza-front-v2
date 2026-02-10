/**
 * BanqueDashboard.tsx (exemple d'intégration)
 * ────────────────────────────────────────────────────────────────────
 * Dashboard Banque — vue d'ensemble du dossier actif.
 *
 * Pattern : ZÉRO logique métier locale.
 * Tout est dérivé via useBanqueSnapshot() + selectors.
 * ────────────────────────────────────────────────────────────────────
 */

import {
  useBanqueSnapshot,
  acknowledgeAlert,
} from "../shared";

const HEALTH_COLORS = {
  green: "bg-green-100 text-green-800 border-green-300",
  yellow: "bg-yellow-100 text-yellow-800 border-yellow-300",
  orange: "bg-orange-100 text-orange-800 border-orange-300",
  red: "bg-red-100 text-red-800 border-red-300",
} as const;

const BanqueDashboard = () => {
  const {
    dossier,
    dossierId,
    completeness,
    riskSummary,
    marketSummary,
    guaranteesSummary,
    smartScoreComputed,
    health,
    oneLiner,
    activeAlerts,
  } = useBanqueSnapshot();

  if (!dossier) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Dashboard Banque</h1>
        <p className="text-gray-500">
          Aucun dossier actif. Commencez par créer un dossier dans l'onglet Origination.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{dossier.nom}</h1>
          <p className="text-gray-500">{oneLiner}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium border ${HEALTH_COLORS[health]}`}>
          {health === "green" ? "Sain" : health === "yellow" ? "Attention" : health === "orange" ? "Risqué" : "Critique"}
        </span>
      </div>

      {/* KPI Grid — tout vient des selectors */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Complétude" value={`${completeness.percent}%`} sub={`${completeness.filledCount}/${completeness.totalCount} modules`} />
        <KpiCard label="Smart Score" value={`${smartScoreComputed.score}/100`} sub={`${smartScoreComputed.penalties.length} pénalité(s)`} />
        <KpiCard label="Risques" value={riskSummary?.verdict ?? "—"} sub={riskSummary ? `${riskSummary.presentCount} présent(s)` : "Non analysé"} />
        <KpiCard label="Garanties" value={guaranteesSummary ? `${guaranteesSummary.obtainedCount}/${guaranteesSummary.requestedCount}` : "—"} sub={guaranteesSummary?.ltv ? `LTV ${guaranteesSummary.ltv}` : "Non renseigné"} />
      </div>

      {/* Marché */}
      {marketSummary && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm font-medium text-blue-800">Marché</p>
          <p className="text-sm text-blue-700">{marketSummary.text}</p>
        </div>
      )}

      {/* Checklist complétude */}
      {completeness.missingBuckets.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm font-medium text-amber-800 mb-2">
            Modules à compléter ({completeness.missingBuckets.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {completeness.missingBuckets.map((b) => (
              <span key={b} className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Alertes actives */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Alertes ({activeAlerts.length})</h2>
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-3 rounded-lg border flex items-center justify-between ${
                alert.severity === "critical"
                  ? "bg-red-50 border-red-200"
                  : alert.severity === "warning"
                    ? "bg-yellow-50 border-yellow-200"
                    : "bg-blue-50 border-blue-200"
              }`}
            >
              <div>
                <p className="font-medium text-sm">{alert.title}</p>
                <p className="text-xs text-gray-600">{alert.message}</p>
              </div>
              <button
                onClick={() => dossierId && acknowledgeAlert(dossierId, alert.id)}
                className="text-xs px-2 py-1 border rounded hover:bg-white"
              >
                Acquitter
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SmartScore explications */}
      {smartScoreComputed.explanations.length > 0 && (
        <div className="text-sm text-gray-500">
          <p className="font-medium text-gray-700 mb-1">Notes SmartScore :</p>
          {smartScoreComputed.explanations.map((ex, i) => (
            <p key={i}>• {ex}</p>
          ))}
        </div>
      )}
    </div>
  );
};

const KpiCard = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="p-4 bg-white border rounded-lg">
    <p className="text-xs text-gray-500 uppercase">{label}</p>
    <p className="text-xl font-bold text-gray-900">{value}</p>
    <p className="text-xs text-gray-500">{sub}</p>
  </div>
);

export default BanqueDashboard;