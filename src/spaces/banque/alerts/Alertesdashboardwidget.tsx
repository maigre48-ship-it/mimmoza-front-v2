/**
 * AlertesDashboardWidget.tsx
 *
 * Widget "Alertes récentes" pour le Dashboard Banque.
 * Affiche un résumé compact + les 5 dernières alertes.
 *
 * Usage dans Dashboard.tsx :
 *   import { AlertesDashboardWidget } from "../components/AlertesDashboardWidget";
 *   <AlertesDashboardWidget />
 */

import React, { useMemo } from "react";
import { useBanqueAlerts } from "../shared/hooks/useBanqueAlerts";
import type { BanqueAlert, AlertSeverity } from "../shared/services/banqueAlerts";

/* ─── Style helpers ─────────────────────────────────────── */

const severityConfig: Record<AlertSeverity, { bg: string; text: string; dot: string; label: string }> = {
  critical: { bg: "#fef2f2", text: "#991b1b", dot: "#dc2626", label: "Critique" },
  high:     { bg: "#fff7ed", text: "#9a3412", dot: "#ea580c", label: "Élevée" },
  medium:   { bg: "#fffbeb", text: "#92400e", dot: "#d97706", label: "Moyenne" },
  low:      { bg: "#f0fdf4", text: "#166534", dot: "#16a34a", label: "Faible" },
  info:     { bg: "#eff6ff", text: "#1e40af", dot: "#3b82f6", label: "Info" },
};

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const cfg = severityConfig[severity];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        backgroundColor: cfg.bg,
        color: cfg.text,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `il y a ${days}j`;
}

/* ─── Component ─────────────────────────────────────────── */

interface AlertesDashboardWidgetProps {
  maxItems?: number;
  onNavigateMonitoring?: () => void;
}

export const AlertesDashboardWidget: React.FC<AlertesDashboardWidgetProps> = ({
  maxItems = 5,
  onNavigateMonitoring,
}) => {
  const { alerts, stats, recalculate, seedDemo, snapshot } = useBanqueAlerts();

  const recentAlerts = useMemo(
    () =>
      [...alerts]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, maxItems),
    [alerts, maxItems]
  );

  const hasDossiers = Object.keys(snapshot.dossiersById).length > 0;

  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #f1f5f9",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔔</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
            Alertes récentes
          </span>
          {stats.unacknowledged > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: "50%",
                backgroundColor: "#dc2626",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {stats.unacknowledged}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!hasDossiers && (
            <button
              onClick={seedDemo}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #e2e8f0",
                backgroundColor: "#f8fafc",
                fontSize: 12,
                cursor: "pointer",
                color: "#64748b",
              }}
            >
              Charger démo
            </button>
          )}
          <button
            onClick={() => recalculate()}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              backgroundColor: "#f8fafc",
              fontSize: 12,
              cursor: "pointer",
              color: "#475569",
              fontWeight: 600,
            }}
          >
            ↻ Recalculer
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats.total > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "10px 20px",
            backgroundColor: "#f8fafc",
            borderBottom: "1px solid #f1f5f9",
            fontSize: 12,
            color: "#64748b",
          }}
        >
          {stats.critical > 0 && (
            <span>
              <span style={{ color: "#dc2626", fontWeight: 700 }}>{stats.critical}</span> critique(s)
            </span>
          )}
          {stats.high > 0 && (
            <span>
              <span style={{ color: "#ea580c", fontWeight: 700 }}>{stats.high}</span> élevée(s)
            </span>
          )}
          {stats.medium > 0 && (
            <span>
              <span style={{ color: "#d97706", fontWeight: 700 }}>{stats.medium}</span> moyenne(s)
            </span>
          )}
          <span style={{ marginLeft: "auto" }}>
            {stats.total} alerte(s) · {stats.unacknowledged} non acquittée(s)
          </span>
        </div>
      )}

      {/* Alert list */}
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {recentAlerts.length === 0 ? (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            {hasDossiers
              ? "✅ Aucune alerte active — tous les dossiers sont conformes."
              : "Aucun dossier. Cliquez « Charger démo » pour tester."}
          </div>
        ) : (
          recentAlerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))
        )}
      </div>

      {/* Footer */}
      {alerts.length > maxItems && onNavigateMonitoring && (
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid #f1f5f9",
            textAlign: "center",
          }}
        >
          <button
            onClick={onNavigateMonitoring}
            style={{
              background: "none",
              border: "none",
              color: "#3b82f6",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Voir toutes les alertes ({alerts.length}) →
          </button>
        </div>
      )}
    </div>
  );
};

/* ─── AlertRow ──────────────────────────────────────────── */

function AlertRow({ alert }: { alert: BanqueAlert }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 20px",
        borderBottom: "1px solid #f8fafc",
        opacity: alert.acknowledgedAt ? 0.6 : 1,
      }}
    >
      <div style={{ paddingTop: 2 }}>
        <SeverityBadge severity={alert.severity} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#0f172a",
            marginBottom: 2,
          }}
        >
          {alert.title}
          {alert.acknowledgedAt && (
            <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>✓ acquittée</span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#64748b",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {alert.message}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#94a3b8",
          whiteSpace: "nowrap",
          paddingTop: 2,
        }}
      >
        {timeAgo(alert.updatedAt)}
      </div>
    </div>
  );
}

export default AlertesDashboardWidget;