/**
 * BanqueMonitoring.tsx (exemple d'intégration)
 * ────────────────────────────────────────────────────────────────────
 * Page Monitoring — alertes + règles de surveillance.
 *
 * Pattern :
 *   ✅ useBanqueSnapshot()   → lecture réactive des alertes
 *   ✅ upsertAlert()         → ajout d'alerte
 *   ✅ acknowledgeAlert()    → acquittement
 *   ✅ patchMonitoringConfig()→ mise à jour des règles
 * ────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback } from "react";
import {
  useBanqueSnapshot,
  upsertAlert,
  acknowledgeAlert,
  removeAlert,
  patchMonitoringConfig,
  type MonitoringAlert,
  type MonitoringRule,
  type AlertSeverity,
} from "../shared";

const BanqueMonitoring = () => {
  const { dossier, dossierId, monitoring, activeAlerts } = useBanqueSnapshot();

  const [newRuleLabel, setNewRuleLabel] = useState("");

  const handleAcknowledge = useCallback(
    (alertId: string) => {
      if (!dossierId) return;
      acknowledgeAlert(dossierId, alertId);
    },
    [dossierId]
  );

  const handleRemove = useCallback(
    (alertId: string) => {
      if (!dossierId) return;
      removeAlert(dossierId, alertId);
    },
    [dossierId]
  );

  const handleToggleRule = useCallback(
    (ruleId: string) => {
      if (!dossierId || !monitoring) return;
      const updated = monitoring.rulesConfig.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r
      );
      patchMonitoringConfig(dossierId, updated);
    },
    [dossierId, monitoring]
  );

  const handleAddRule = useCallback(() => {
    if (!dossierId || !newRuleLabel.trim()) return;
    const newRule: MonitoringRule = {
      id: `rule_${Date.now()}`,
      label: newRuleLabel.trim(),
      enabled: true,
      condition: "manual",
      severity: "warning",
    };
    const current = monitoring?.rulesConfig ?? [];
    patchMonitoringConfig(dossierId, [...current, newRule]);
    setNewRuleLabel("");
  }, [dossierId, monitoring, newRuleLabel]);

  // Toutes les alertes (y compris acquittées)
  const allAlerts = monitoring?.alerts ?? [];
  const acknowledgedAlerts = allAlerts.filter((a) => a.acknowledgedAt);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Monitoring</h1>

      {/* Alertes actives */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Alertes actives ({activeAlerts.length})
        </h2>
        {activeAlerts.length === 0 ? (
          <p className="text-gray-400 text-sm">Aucune alerte active.</p>
        ) : (
          <div className="space-y-2">
            {activeAlerts.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                onAcknowledge={() => handleAcknowledge(a.id)}
                onRemove={() => handleRemove(a.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Alertes acquittées */}
      {acknowledgedAlerts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-gray-500">
            Historique ({acknowledgedAlerts.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {acknowledgedAlerts.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                onRemove={() => handleRemove(a.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Règles de surveillance */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Règles de surveillance</h2>
        <div className="space-y-2 mb-4">
          {(monitoring?.rulesConfig ?? []).map((rule) => (
            <div key={rule.id} className="flex items-center justify-between p-3 bg-white border rounded-lg">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggleRule(rule.id)}
                  className={`w-10 h-6 rounded-full transition-colors ${
                    rule.enabled ? "bg-green-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 bg-white rounded-full transform transition-transform ${
                      rule.enabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="text-sm">{rule.label}</span>
              </div>
              <span className="text-xs text-gray-400">{rule.severity}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newRuleLabel}
            onChange={(e) => setNewRuleLabel(e.target.value)}
            placeholder="Nouvelle règle…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleAddRule()}
          />
          <button
            onClick={handleAddRule}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm"
          >
            Ajouter
          </button>
        </div>
      </section>
    </div>
  );
};

const AlertCard = ({
  alert,
  onAcknowledge,
  onRemove,
}: {
  alert: MonitoringAlert;
  onAcknowledge?: () => void;
  onRemove?: () => void;
}) => {
  const colors = {
    critical: "bg-red-50 border-red-200",
    warning: "bg-yellow-50 border-yellow-200",
    info: "bg-blue-50 border-blue-200",
  };

  return (
    <div className={`p-3 rounded-lg border ${colors[alert.severity]} flex items-start justify-between`}>
      <div>
        <p className="font-medium text-sm">{alert.title}</p>
        <p className="text-xs text-gray-600">{alert.message}</p>
        <p className="text-xs text-gray-400 mt-1">
          {new Date(alert.createdAt).toLocaleString("fr-FR")} · {alert.source}
        </p>
      </div>
      <div className="flex gap-2">
        {onAcknowledge && !alert.acknowledgedAt && (
          <button onClick={onAcknowledge} className="text-xs px-2 py-1 border rounded hover:bg-white">
            Acquitter
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50">
            ×
          </button>
        )}
      </div>
    </div>
  );
};

export default BanqueMonitoring;