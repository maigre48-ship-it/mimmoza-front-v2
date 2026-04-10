// ============================================================================
// SmartScoreGauge.tsx
// Jauge circulaire du score + breakdown par pilier
// ============================================================================

import { useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type PillarScore = {
  key: string;
  label: string;
  score: number | null;
  weight: number;         // Poids normalisé (%)
  color: string;
  icon: string;
};

type Props = {
  score: number;
  verdict: string;
  pillars: PillarScore[];
  benchmark?: {
    percentile: number;
    rank_label: string;
    sample_size: number;
    scope: string;
  } | null;
  size?: "sm" | "md" | "lg";
};

const PILLAR_META: Record<string, { icon: string; color: string }> = {
  transport:          { icon: "🚆", color: "#3b82f6" },
  commodites:         { icon: "🛍️", color: "#8b5cf6" },
  ecoles:             { icon: "🎓", color: "#f59e0b" },
  marche:             { icon: "📈", color: "#10b981" },
  sante:              { icon: "❤️", color: "#ef4444" },
  essential_services: { icon: "📍", color: "#06b6d4" },
  environnement:      { icon: "🌿", color: "#22c55e" },
  concurrence:        { icon: "🏗️", color: "#f97316" },
  demographie:        { icon: "👥", color: "#a855f7" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 75) return "#10b981";
  if (score >= 60) return "#22c55e";
  if (score >= 45) return "#f59e0b";
  if (score >= 30) return "#f97316";
  return "#ef4444";
}

function getScoreLabel(score: number): string {
  if (score >= 75) return "Excellent";
  if (score >= 60) return "Bon";
  if (score >= 45) return "Correct";
  if (score >= 30) return "Moyen";
  return "Faible";
}

// ─── Composant ──────────────────────────────────────────────────────────────

export default function SmartScoreGauge({
  score,
  verdict,
  pillars,
  benchmark,
  size = "md",
}: Props) {
  const gaugeSize = size === "sm" ? 100 : size === "lg" ? 180 : 140;
  const strokeWidth = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  const fontSize = size === "sm" ? 24 : size === "lg" ? 44 : 34;

  const color = getScoreColor(score);
  const label = getScoreLabel(score);

  // SVG arc
  const radius = (gaugeSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270° arc
  const offset = arcLength - (arcLength * score) / 100;

  // Piliers triés par poids
  const sortedPillars = useMemo(
    () => [...pillars].filter((p) => p.weight > 0).sort((a, b) => b.weight - a.weight),
    [pillars],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      {/* Jauge */}
      <div style={{ position: "relative", width: gaugeSize, height: gaugeSize }}>
        <svg
          width={gaugeSize}
          height={gaugeSize}
          viewBox={`0 0 ${gaugeSize} ${gaugeSize}`}
          style={{ transform: "rotate(135deg)" }}
        >
          {/* Fond */}
          <circle
            cx={gaugeSize / 2}
            cy={gaugeSize / 2}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Score */}
          <circle
            cx={gaugeSize / 2}
            cy={gaugeSize / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{
              transition: "stroke-dashoffset 0.8s ease, stroke 0.3s ease",
              filter: `drop-shadow(0 0 6px ${color}40)`,
            }}
          />
        </svg>

        {/* Nombre central */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: size === "sm" ? 0 : 8,
          }}
        >
          <span
            style={{
              fontSize,
              fontWeight: 800,
              color,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {score}
          </span>
          <span
            style={{
              fontSize: size === "sm" ? 9 : 11,
              fontWeight: 600,
              color: "#94a3b8",
              marginTop: 2,
            }}
          >
            {label}
          </span>
        </div>
      </div>

      {/* Benchmark */}
      {benchmark && benchmark.sample_size > 0 && (
        <div
          style={{
            padding: "4px 12px",
            borderRadius: 20,
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            fontSize: 11,
            fontWeight: 600,
            color: "#0369a1",
            textAlign: "center",
          }}
        >
          {benchmark.rank_label}
          <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 4 }}>
            ({benchmark.sample_size} analyses, {benchmark.scope})
          </span>
        </div>
      )}

      {/* Verdict */}
      {size !== "sm" && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "#475569",
            textAlign: "center",
            lineHeight: 1.5,
            maxWidth: 320,
          }}
        >
          {verdict}
        </p>
      )}

      {/* Breakdown piliers */}
      {size !== "sm" && sortedPillars.length > 0 && (
        <div style={{ width: "100%", maxWidth: 360 }}>
          {sortedPillars.map((p) => {
            const meta = PILLAR_META[p.key] || { icon: "•", color: "#94a3b8" };
            const hasScore = p.score != null;
            const pillarColor = hasScore ? meta.color : "#cbd5e1";

            return (
              <div
                key={p.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 0",
                  opacity: hasScore ? 1 : 0.5,
                }}
              >
                <span style={{ fontSize: 13, width: 20, textAlign: "center" }}>
                  {meta.icon}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#475569",
                  }}
                >
                  {p.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#94a3b8",
                    fontWeight: 600,
                    width: 32,
                    textAlign: "right",
                  }}
                >
                  {Math.round(p.weight)}%
                </span>

                {/* Mini barre */}
                <div
                  style={{
                    width: 60,
                    height: 4,
                    borderRadius: 2,
                    background: "#f1f5f9",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${hasScore ? p.score! : 0}%`,
                      background: pillarColor,
                      borderRadius: 2,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>

                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: !hasScore
                      ? "#cbd5e1"
                      : p.score! >= 70
                      ? "#10b981"
                      : p.score! >= 40
                      ? "#f59e0b"
                      : "#ef4444",
                    width: 28,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {hasScore ? p.score : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}