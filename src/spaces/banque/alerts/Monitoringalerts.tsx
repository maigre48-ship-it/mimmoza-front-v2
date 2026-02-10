/**
 * MonitoringAlerts.tsx
 *
 * Page / section complète Monitoring Banque — onglet Alertes.
 * Liste toutes les alertes avec filtres, acquittement, et recalcul.
 *
 * Usage dans Monitoring.tsx :
 *   import { MonitoringAlerts } from "../components/MonitoringAlerts";
 *   <MonitoringAlerts />
 */

import React, { useState, useMemo } from "react";
import { useBanqueAlerts } from "../shared/hooks/useBanqueAlerts";
import type { BanqueAlert, AlertSeverity } from "../shared/services/banqueAlerts";
import { getAvailableRuleKeys } from "../shared/services/banqueAlerts";

/* ─── Style config ──────────────────────────────────────── */

const severityConfig: Record<AlertSeverity, { bg: string; text: string; dot: string; border: string; label: string }> = {
  critical: { bg: "#fef2f2", text: "#991b1b", dot: "#dc2626", border: "#fecaca", label: "Critique" },
  high:     { bg: "#fff7ed", text: "#9a3412", dot: "#ea580c", border: "#fed7aa", label: "Élevée" },
  medium:   { bg: "#fffbeb", text: "#92400e", dot: "#d97706", border: "#fde68a", label: "Moyenne" },
  low:      { bg: "#f0fdf4", text: "#166534", dot: "#16a34a", border: "#bbf7d0", label: "Faible" },
  info:     { bg: "#eff6ff", text: "#1e40af", dot: "#3b82f6", border: "#bfdbfe", label: "Info" },
};

function SeverityBadge({ severity, large }: { severity: AlertSeverity; large?: boolean }) {
  const cfg = severityConfig[severity];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: large ? "3px 10px" : "2px 8px",
        borderRadius: 9999,
        fontSize: large ? 12 : 11,
        fontWeight: 600,
        backgroundColor: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* ─── Select component ──────────────────────────────────── */

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #e2e8f0",
          fontSize: 13,
          backgroundColor: "#fff",
          color: "#0f172a",
          minWidth: 140,
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────── */

export const MonitoringAlerts: React.FC = () => {
  const {
    snapshot,
    filteredAlerts,
    stats,
    filters,
    setFilters,
    recalculate,
    acknowledge,
    seedDemo,
    lastRun,
  } = useBanqueAlerts();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Build filter options dynamically
  const dossierOptions = useMemo(() => {
    const dossiers = Object.values(snapshot.dossiersById);
    return [
      { value: "all", label: "Tous les dossiers" },
      ...dossiers.map((d) => ({ value: d.id, label: `${d.id} — ${d.nom}` })),
    ];
  }, [snapshot]);

  const ruleOptions = useMemo(() => {
    const rules = getAvailableRuleKeys();
    return [
      { value: "all", label: "Toutes les règles" },
      ...rules.map((r) => ({ value: r.key, label: r.label })),
    ];
  }, []);

  const handleRecalculate = () => {
    setIsRecalculating(true);
    // setTimeout pour laisser le UI se mettre à jour (spinner)
    setTimeout(() => {
      recalculate();
      setIsRecalculating(false);
    }, 100);
  };

  const hasDossiers = Object.keys(snapshot.dossiersById).length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ─── Header ────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            🔔 Monitoring — Alertes
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            Moteur d'alertes déterministe — {stats.total} alerte(s) active(s)
            {lastRun && ` · Dernier calcul : ${formatDate(lastRun)}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!hasDossiers && (
            <button
              onClick={seedDemo}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                backgroundColor: "#f8fafc",
                fontSize: 13,
                cursor: "pointer",
                color: "#64748b",
                fontWeight: 600,
              }}
            >
              🧪 Charger données démo
            </button>
          )}
          <button
            onClick={handleRecalculate}
            disabled={isRecalculating}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "none",
              backgroundColor: isRecalculating ? "#94a3b8" : "#1e40af",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: isRecalculating ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isRecalculating ? "⏳ Calcul…" : "↻ Recalculer alertes"}
          </button>
        </div>
      </div>

      {/* ─── Stats cards ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {(
          [
            { key: "critical" as const, emoji: "🔴", label: "Critiques", count: stats.critical },
            { key: "high" as const, emoji: "🟠", label: "Élevées", count: stats.high },
            { key: "medium" as const, emoji: "🟡", label: "Moyennes", count: stats.medium },
            { key: "low" as const, emoji: "🟢", label: "Faibles", count: stats.low },
            { key: "info" as const, emoji: "🔵", label: "Info", count: stats.info },
          ] as const
        ).map(({ key, emoji, label, count }) => (
          <button
            key={key}
            onClick={() => setFilters({ severity: filters.severity === key ? "all" : key })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 16px",
              borderRadius: 10,
              border: `2px solid ${filters.severity === key ? severityConfig[key].dot : "#e2e8f0"}`,
              backgroundColor: filters.severity === key ? severityConfig[key].bg : "#fff",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <span style={{ fontSize: 20 }}>{emoji}</span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{count}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* ─── Filters bar ──────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 16,
          padding: "16px 20px",
          backgroundColor: "#f8fafc",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
        }}
      >
        <FilterSelect
          label="Dossier"
          value={filters.dossierId}
          options={dossierOptions}
          onChange={(v) => setFilters({ dossierId: v })}
        />
        <FilterSelect
          label="Règle"
          value={filters.ruleKey}
          options={ruleOptions}
          onChange={(v) => setFilters({ ruleKey: v })}
        />
        <FilterSelect
          label="Acquittement"
          value={filters.acknowledged}
          options={[
            { value: "all", label: "Toutes" },
            { value: "no", label: "Non acquittées" },
            { value: "yes", label: "Acquittées" },
          ]}
          onChange={(v) => setFilters({ acknowledged: v as "all" | "yes" | "no" })}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Recherche
          </label>
          <input
            type="text"
            placeholder="Filtrer par titre, message, dossier…"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              fontSize: 13,
              color: "#0f172a",
            }}
          />
        </div>
        <button
          onClick={() =>
            setFilters({
              severity: "all",
              dossierId: "all",
              ruleKey: "all",
              acknowledged: "all",
              search: "",
            })
          }
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
            backgroundColor: "#fff",
            fontSize: 12,
            cursor: "pointer",
            color: "#64748b",
          }}
        >
          ✕ Reset
        </button>
      </div>

      {/* ─── Alert table ──────────────────────────────── */}
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr 160px 130px 100px",
            gap: 8,
            padding: "10px 20px",
            backgroundColor: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          <div>Sévérité</div>
          <div>Alerte</div>
          <div>Dossier</div>
          <div>Date</div>
          <div>Actions</div>
        </div>

        {/* Rows */}
        {filteredAlerts.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            {stats.total === 0
              ? "Aucune alerte active."
              : "Aucune alerte ne correspond aux filtres."}
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <AlertTableRow
              key={alert.id}
              alert={alert}
              expanded={expandedId === alert.id}
              onToggle={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
              onAcknowledge={() => acknowledge(alert.dossierId, alert.id)}
            />
          ))
        )}

        {/* Footer */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid #f1f5f9",
            fontSize: 12,
            color: "#94a3b8",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>
            {filteredAlerts.length} alerte(s) affichée(s)
            {filteredAlerts.length !== stats.total && ` sur ${stats.total}`}
          </span>
          <span>
            Snapshot : v{snapshot.version} · MAJ {formatDate(snapshot.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
};

/* ─── AlertTableRow ─────────────────────────────────────── */

function AlertTableRow({
  alert,
  expanded,
  onToggle,
  onAcknowledge,
}: {
  alert: BanqueAlert;
  expanded: boolean;
  onToggle: () => void;
  onAcknowledge: () => void;
}) {
  const cfg = severityConfig[alert.severity];

  return (
    <div
      style={{
        borderBottom: "1px solid #f8fafc",
        backgroundColor: expanded ? "#fafbff" : "transparent",
      }}
    >
      {/* Main row */}
      <div
        onClick={onToggle}
        style={{
          display: "grid",
          gridTemplateColumns: "100px 1fr 160px 130px 100px",
          gap: 8,
          padding: "12px 20px",
          cursor: "pointer",
          alignItems: "center",
          opacity: alert.acknowledgedAt ? 0.65 : 1,
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = expanded ? "#fafbff" : "transparent")}
      >
        <div>
          <SeverityBadge severity={alert.severity} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: 6 }}>
            {alert.title}
            {alert.acknowledgedAt && (
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>✓ acquittée</span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#64748b",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {alert.message}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>
          {alert.dossierId}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          {formatDate(alert.updatedAt)}
        </div>
        <div>
          {!alert.acknowledgedAt && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge();
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${cfg.border}`,
                backgroundColor: cfg.bg,
                color: cfg.text,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Acquitter
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            padding: "0 20px 16px 120px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px 24px",
            fontSize: 12,
            color: "#475569",
          }}
        >
          <DetailRow label="ID alerte" value={alert.id} />
          <DetailRow label="Règle" value={alert.ruleKey} />
          <DetailRow label="Créée le" value={formatDate(alert.createdAt)} />
          <DetailRow label="Mise à jour" value={formatDate(alert.updatedAt)} />
          {alert.acknowledgedAt && (
            <DetailRow label="Acquittée le" value={formatDate(alert.acknowledgedAt)} />
          )}
          <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
            <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>Message complet</div>
            <div
              style={{
                padding: "10px 14px",
                backgroundColor: "#f8fafc",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {alert.message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ fontWeight: 600, color: "#94a3b8", minWidth: 100 }}>{label}</span>
      <span style={{ color: "#0f172a", fontFamily: "monospace", fontSize: 11 }}>{value}</span>
    </div>
  );
}

export default MonitoringAlerts;