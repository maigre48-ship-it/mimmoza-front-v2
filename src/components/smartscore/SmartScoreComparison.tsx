// ============================================================================
// SmartScoreComparison.tsx
// Comparaison multi-sites : radar chart + tableau + ranking
// Utilise Recharts (disponible dans le stack Mimmoza)
// ============================================================================

import { useState, useMemo } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────────────

type SiteData = {
  id: string;
  label: string;
  score: number;
  pillarScores: Record<string, number | null>;
  metrics: {
    prix_median_m2: number | null;
    transactions: number | null;
    rendement_pct: number | null;
    liquidite: number | null;
    tendance_pct: number | null;
    pharmacie_km: number | null;
    commerce_km: number | null;
    medecin_km: number | null;
    hopital_km: number | null;
    population: number | null;
  };
};

type Props = {
  sites: SiteData[];
};

const SERIES_COLORS = ["#5247b8", "#06b6d4", "#f59e0b", "#ef4444", "#22c55e"];

const PILLAR_LABELS: Record<string, string> = {
  transport: "Transports",
  commodites: "Commodités",
  ecoles: "Écoles",
  marche: "Marché",
  sante: "Santé",
  essential_services: "Services",
  environnement: "Environnement",
  concurrence: "Concurrence",
  demographie: "Démographie",
};

type MetricDef = {
  key: string;
  label: string;
  unit: string;
  getter: (s: SiteData) => number | null;
  direction: "higher" | "lower" | "neutral";
  format?: (v: number) => string;
};

const METRIC_DEFS: MetricDef[] = [
  { key: "score", label: "Score global", unit: "/100", getter: (s) => s.score, direction: "higher" },
  { key: "prix", label: "Prix médian", unit: "€/m²", getter: (s) => s.metrics.prix_median_m2, direction: "neutral", format: (v) => v.toLocaleString("fr-FR") },
  { key: "tx", label: "Transactions", unit: "", getter: (s) => s.metrics.transactions, direction: "higher" },
  { key: "rend", label: "Rendement brut", unit: "%", getter: (s) => s.metrics.rendement_pct, direction: "higher" },
  { key: "liq", label: "Liquidité", unit: "/100", getter: (s) => s.metrics.liquidite, direction: "higher" },
  { key: "trend", label: "Tendance prix", unit: "%/an", getter: (s) => s.metrics.tendance_pct, direction: "higher", format: (v) => (v > 0 ? "+" : "") + v },
  { key: "pharm", label: "Pharmacie", unit: "km", getter: (s) => s.metrics.pharmacie_km, direction: "lower" },
  { key: "comm", label: "Commerce", unit: "km", getter: (s) => s.metrics.commerce_km, direction: "lower" },
  { key: "med", label: "Médecin", unit: "km", getter: (s) => s.metrics.medecin_km, direction: "lower" },
  { key: "hop", label: "Hôpital", unit: "km", getter: (s) => s.metrics.hopital_km, direction: "lower" },
  { key: "pop", label: "Population", unit: "hab.", getter: (s) => s.metrics.population, direction: "neutral", format: (v) => v.toLocaleString("fr-FR") },
];

// ─── Composant ──────────────────────────────────────────────────────────────

export default function SmartScoreComparison({ sites }: Props) {
  const [activeTab, setActiveTab] = useState<"radar" | "table">("radar");

  // Radar data
  const radarData = useMemo(() => {
    const pillars = Object.keys(PILLAR_LABELS).filter((p) =>
      sites.some((s) => s.pillarScores[p] != null),
    );

    return pillars.map((pillar) => {
      const point: Record<string, any> = { pillar: PILLAR_LABELS[pillar] };
      for (const site of sites) {
        point[site.id] = site.pillarScores[pillar] ?? 0;
      }
      return point;
    });
  }, [sites]);

  // Ranking
  const ranking = useMemo(
    () => [...sites].sort((a, b) => b.score - a.score),
    [sites],
  );

  if (sites.length < 2) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
        Sélectionnez au moins 2 sites pour comparer.
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #e2e8f0",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #f1f5f9",
          background: "#fafbfc",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
            Comparaison ({sites.length} sites)
          </h3>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "#e2e8f0",
              borderRadius: 8,
              padding: 2,
            }}
          >
            {(["radar", "table"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: activeTab === tab ? "#fff" : "transparent",
                  color: activeTab === tab ? "#1e293b" : "#64748b",
                  boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {tab === "radar" ? "Radar" : "Tableau"}
              </button>
            ))}
          </div>
        </div>

        {/* Ranking badges */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {ranking.map((site, idx) => (
            <div
              key={site.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 20,
                border: `2px solid ${SERIES_COLORS[sites.findIndex((s) => s.id === site.id)]}`,
                background: idx === 0 ? SERIES_COLORS[sites.findIndex((s) => s.id === site.id)] + "12" : "#fff",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: SERIES_COLORS[sites.findIndex((s) => s.id === site.id)],
                }}
              >
                #{idx + 1}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#334155",
                  maxWidth: 120,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {site.label}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color:
                    site.score >= 70
                      ? "#10b981"
                      : site.score >= 50
                      ? "#f59e0b"
                      : "#ef4444",
                }}
              >
                {site.score}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Contenu */}
      <div style={{ padding: 20 }}>
        {activeTab === "radar" ? (
          /* ── RADAR CHART ── */
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis
                  dataKey="pillar"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickCount={5}
                />
                {sites.map((site, idx) => (
                  <Radar
                    key={site.id}
                    name={site.label}
                    dataKey={site.id}
                    stroke={SERIES_COLORS[idx]}
                    fill={SERIES_COLORS[idx]}
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                ))}
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    fontSize: 12,
                    border: "1px solid #e2e8f0",
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* ── TABLEAU ── */
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12.5,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "2px solid #e2e8f0",
                      color: "#64748b",
                      fontWeight: 600,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Métrique
                  </th>
                  {sites.map((site, idx) => (
                    <th
                      key={site.id}
                      style={{
                        textAlign: "right",
                        padding: "8px 10px",
                        borderBottom: `2px solid ${SERIES_COLORS[idx]}`,
                        color: SERIES_COLORS[idx],
                        fontWeight: 700,
                        fontSize: 12,
                        maxWidth: 120,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {site.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_DEFS.map((metric) => {
                  // Trouver le meilleur
                  let bestId: string | null = null;
                  let bestVal: number | null = null;
                  for (const site of sites) {
                    const v = metric.getter(site);
                    if (v == null) continue;
                    if (
                      bestVal == null ||
                      (metric.direction === "higher" && v > bestVal) ||
                      (metric.direction === "lower" && v < bestVal)
                    ) {
                      bestVal = v;
                      bestId = site.id;
                    }
                  }

                  return (
                    <tr key={metric.key}>
                      <td
                        style={{
                          padding: "7px 10px",
                          borderBottom: "1px solid #f1f5f9",
                          color: "#475569",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {metric.label}
                        {metric.unit && (
                          <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>
                            {metric.unit}
                          </span>
                        )}
                      </td>
                      {sites.map((site) => {
                        const v = metric.getter(site);
                        const isBest =
                          metric.direction !== "neutral" && site.id === bestId;

                        return (
                          <td
                            key={site.id}
                            style={{
                              padding: "7px 10px",
                              borderBottom: "1px solid #f1f5f9",
                              textAlign: "right",
                              fontWeight: isBest ? 700 : 400,
                              color: v == null
                                ? "#cbd5e1"
                                : isBest
                                ? "#0ea5e9"
                                : "#334155",
                              fontVariantNumeric: "tabular-nums",
                              background: isBest ? "#f0f9ff" : "transparent",
                            }}
                          >
                            {v == null
                              ? "—"
                              : metric.format
                              ? metric.format(v)
                              : v}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}