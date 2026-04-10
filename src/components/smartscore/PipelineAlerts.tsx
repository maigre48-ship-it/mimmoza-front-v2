// ============================================================================
// PipelineAlerts.tsx
// Badge de notification + panneau d'alertes pour le Pipeline
// ============================================================================

import { useState, useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type AlertSeverity = "info" | "warning" | "critical";

type Alert = {
  id: string;
  deal_id: string;
  deal_label: string;
  category: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  previous_value: number | null;
  current_value: number | null;
  delta: number | null;
  delta_pct: number | null;
  pillar?: string;
  action_label?: string;
  action_route?: string;
  created_at: string;
  read_at?: string | null;
};

type BadgeProps = {
  alerts: Alert[];
  onClick: () => void;
};

type PanelProps = {
  alerts: Alert[];
  onClose: () => void;
  onMarkRead: (ids: string[]) => void;
  onDismiss: (id: string) => void;
  onAction?: (route: string) => void;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<AlertSeverity, { color: string; bg: string; icon: string; label: string }> = {
  critical: { color: "#dc2626", bg: "#fef2f2", icon: "🔴", label: "Critique" },
  warning:  { color: "#d97706", bg: "#fffbeb", icon: "🟠", label: "Attention" },
  info:     { color: "#0284c7", bg: "#f0f9ff", icon: "🔵", label: "Info" },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMin = Math.round((now - then) / 60000);
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `Il y a ${diffD}j`;
  return `Il y a ${Math.round(diffD / 7)} sem.`;
}

// ─── AlertBadge ─────────────────────────────────────────────────────────────

export function AlertBadge({ alerts, onClick }: BadgeProps) {
  const unread = alerts.filter((a) => !a.read_at);
  const critical = unread.filter((a) => a.severity === "critical").length;
  const warning = unread.filter((a) => a.severity === "warning").length;
  const total = unread.length;

  if (total === 0) return null;

  const mainColor = critical > 0 ? "#dc2626" : warning > 0 ? "#d97706" : "#0284c7";

  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 8,
        border: `1px solid ${mainColor}30`,
        background: `${mainColor}08`,
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      {/* Icône cloche */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke={mainColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: mainColor,
        }}
      >
        {total}
      </span>

      {/* Pulse pour critical */}
      {critical > 0 && (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#dc2626",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      )}
    </button>
  );
}

// ─── AlertPanel ─────────────────────────────────────────────────────────────

export function AlertPanel({ alerts, onClose, onMarkRead, onDismiss, onAction }: PanelProps) {
  const [filter, setFilter] = useState<"all" | AlertSeverity>("all");

  const filtered = useMemo(() => {
    const unread = alerts.filter((a) => !a.read_at);
    if (filter === "all") return unread;
    return unread.filter((a) => a.severity === filter);
  }, [alerts, filter]);

  const counts = useMemo(() => {
    const unread = alerts.filter((a) => !a.read_at);
    return {
      all: unread.length,
      critical: unread.filter((a) => a.severity === "critical").length,
      warning: unread.filter((a) => a.severity === "warning").length,
      info: unread.filter((a) => a.severity === "info").length,
    };
  }, [alerts]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 400,
        maxWidth: "100vw",
        height: "100vh",
        background: "#fff",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        animation: "slideInRight 0.2s ease",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#fafbfc",
          flexShrink: 0,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
            Alertes Pipeline
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {counts.all} non lue{counts.all > 1 ? "s" : ""}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {counts.all > 0 && (
            <button
              onClick={() => onMarkRead(filtered.map((a) => a.id))}
              style={{
                fontSize: 11,
                color: "#64748b",
                background: "none",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              Tout lire
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              background: "#fff",
              cursor: "pointer",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div
        style={{
          padding: "8px 20px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {(["all", "critical", "warning", "info"] as const).map((f) => {
          const count = counts[f];
          const active = filter === f;
          const cfg =
            f === "all"
              ? { color: "#475569", bg: "#f1f5f9" }
              : SEVERITY_CONFIG[f];

          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                padding: "3px 10px",
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
                background: active ? (f === "all" ? "#e2e8f0" : cfg.bg) : "transparent",
                color: active ? (f === "all" ? "#1e293b" : (cfg as any).color) : "#94a3b8",
              }}
            >
              {f === "all" ? "Toutes" : SEVERITY_CONFIG[f].label} ({count})
            </button>
          );
        })}
      </div>

      {/* Liste des alertes */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            Aucune alerte non lue
          </div>
        ) : (
          filtered.map((alert) => {
            const cfg = SEVERITY_CONFIG[alert.severity];

            return (
              <div
                key={alert.id}
                style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid #f8fafc",
                  borderLeft: `3px solid ${cfg.color}`,
                  background: cfg.bg + "80",
                  transition: "background 0.15s",
                }}
              >
                {/* Top line */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 3,
                      }}
                    >
                      <span style={{ fontSize: 12 }}>{cfg.icon}</span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1e293b",
                        }}
                      >
                        {alert.title}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        color: "#64748b",
                        lineHeight: 1.4,
                      }}
                    >
                      {alert.description}
                    </p>
                  </div>

                  {/* Dismiss */}
                  <button
                    onClick={() => onDismiss(alert.id)}
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 2,
                      flexShrink: 0,
                    }}
                    title="Masquer"
                  >
                    ✕
                  </button>
                </div>

                {/* Delta badge */}
                {alert.delta != null && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 6,
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      background: (alert.delta ?? 0) >= 0 ? "#dcfce7" : "#fee2e2",
                      color: (alert.delta ?? 0) >= 0 ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {(alert.delta ?? 0) > 0 ? "▲" : "▼"}{" "}
                    {alert.previous_value} → {alert.current_value}
                    {alert.delta_pct != null && (
                      <span style={{ fontWeight: 500 }}>
                        ({alert.delta_pct > 0 ? "+" : ""}
                        {alert.delta_pct}%)
                      </span>
                    )}
                  </div>
                )}

                {/* Footer */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 8,
                  }}
                >
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {alert.deal_label} · {timeAgo(alert.created_at)}
                  </span>

                  {alert.action_label && alert.action_route && (
                    <button
                      onClick={() => onAction?.(alert.action_route!)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#0ea5e9",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {alert.action_label} →
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Composant orchestrateur ────────────────────────────────────────────────

type PipelineAlertsProps = {
  alerts: Alert[];
  onMarkRead: (ids: string[]) => void;
  onDismiss: (id: string) => void;
  onNavigate?: (route: string) => void;
};

export default function PipelineAlerts({
  alerts,
  onMarkRead,
  onDismiss,
  onNavigate,
}: PipelineAlertsProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <AlertBadge alerts={alerts} onClick={() => setPanelOpen(true)} />

      {panelOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setPanelOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.2)",
              zIndex: 999,
            }}
          />
          <AlertPanel
            alerts={alerts}
            onClose={() => setPanelOpen(false)}
            onMarkRead={(ids) => {
              onMarkRead(ids);
            }}
            onDismiss={(id) => {
              onDismiss(id);
            }}
            onAction={(route) => {
              setPanelOpen(false);
              onNavigate?.(route);
            }}
          />
        </>
      )}
    </>
  );
}