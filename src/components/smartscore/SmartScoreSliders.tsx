// ============================================================================
// SmartScoreSliders.tsx
// Sliders de pondération par pilier — recalcul temps réel
// ============================================================================

import { useState, useCallback, useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Pillar = {
  key: string;
  label: string;
  icon: string;
  color: string;
  enabled: boolean;
};

type Props = {
  /** Scores par pilier (0-100), null = pas de données */
  pillarScores: Record<string, number | null>;
  /** Poids par défaut issus du preset (nature + espace) */
  defaultWeights: Record<string, number>;
  /** Poids custom utilisateur (null = pas de custom) */
  initialUserWeights?: Record<string, number> | null;
  /** Callback quand les poids changent */
  onWeightsChange?: (weights: Record<string, number>, newScore: number) => void;
  /** Callback pour sauvegarder le profil */
  onSave?: (weights: Record<string, number>, label: string) => void;
};

const PILLAR_META: Record<string, { label: string; icon: string; color: string }> = {
  transport:          { label: "Transports",        icon: "🚆", color: "#3b82f6" },
  commodites:         { label: "Commodités",        icon: "🛍️", color: "#8b5cf6" },
  ecoles:             { label: "Écoles",            icon: "🎓", color: "#f59e0b" },
  marche:             { label: "Marché",            icon: "📈", color: "#10b981" },
  sante:              { label: "Santé",             icon: "❤️", color: "#ef4444" },
  essential_services: { label: "Services",          icon: "📍", color: "#06b6d4" },
  environnement:      { label: "Environnement",     icon: "🌿", color: "#22c55e" },
  concurrence:        { label: "Concurrence",        icon: "🏗️", color: "#f97316" },
  demographie:        { label: "Démographie",        icon: "👥", color: "#a855f7" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeWeights(raw: Record<string, number>): Record<string, number> {
  const total = Object.values(raw).reduce((s, w) => s + w, 0);
  if (total === 0) return raw;
  const scale = 100 / total;
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    result[k] = Math.round(v * scale * 10) / 10;
  }
  return result;
}

function calculateScore(
  pillarScores: Record<string, number | null>,
  weights: Record<string, number>,
): number {
  let totalW = 0;
  let totalS = 0;
  for (const [pillar, weight] of Object.entries(weights)) {
    if (weight <= 0) continue;
    const score = pillarScores[pillar];
    if (score == null) continue;
    totalW += weight;
    totalS += score * weight;
  }
  return totalW > 0 ? Math.round(totalS / totalW) : 50;
}

// ─── Composant ──────────────────────────────────────────────────────────────

export default function SmartScoreSliders({
  pillarScores,
  defaultWeights,
  initialUserWeights,
  onWeightsChange,
  onSave,
}: Props) {
  const [weights, setWeights] = useState<Record<string, number>>(
    initialUserWeights ?? { ...defaultWeights }
  );
  const [profileLabel, setProfileLabel] = useState("Mon profil");
  const [showSave, setShowSave] = useState(false);

  const normalizedWeights = useMemo(() => normalizeWeights(weights), [weights]);
  const currentScore = useMemo(
    () => calculateScore(pillarScores, normalizedWeights),
    [pillarScores, normalizedWeights],
  );
  const defaultScore = useMemo(
    () => calculateScore(pillarScores, normalizeWeights(defaultWeights)),
    [pillarScores, defaultWeights],
  );

  const scoreDelta = currentScore - defaultScore;
  const isModified = Object.keys(weights).some(
    (k) => Math.abs((weights[k] ?? 0) - (defaultWeights[k] ?? 0)) > 0.5
  );

  const handleSliderChange = useCallback(
    (pillar: string, value: number) => {
      const next = { ...weights, [pillar]: value };
      setWeights(next);
      const normalized = normalizeWeights(next);
      const score = calculateScore(pillarScores, normalized);
      onWeightsChange?.(normalized, score);
    },
    [weights, pillarScores, onWeightsChange],
  );

  const handleReset = useCallback(() => {
    setWeights({ ...defaultWeights });
    const normalized = normalizeWeights(defaultWeights);
    const score = calculateScore(pillarScores, normalized);
    onWeightsChange?.(normalized, score);
  }, [defaultWeights, pillarScores, onWeightsChange]);

  // Piliers ordonnés par poids décroissant
  const orderedPillars = useMemo(() => {
    return Object.keys(weights)
      .filter((k) => PILLAR_META[k])
      .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  }, [weights]);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #e2e8f0",
        overflow: "hidden",
      }}
    >
      {/* Header avec score live */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#fafbfc",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: "#1e293b",
            }}
          >
            Pondération des critères
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            Ajustez les poids — le score se recalcule en temps réel
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Score live */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color:
                  currentScore >= 70
                    ? "#10b981"
                    : currentScore >= 50
                    ? "#f59e0b"
                    : "#ef4444",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {currentScore}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
              /100
              {scoreDelta !== 0 && (
                <span
                  style={{
                    marginLeft: 4,
                    color: scoreDelta > 0 ? "#10b981" : "#ef4444",
                    fontWeight: 600,
                  }}
                >
                  ({scoreDelta > 0 ? "+" : ""}
                  {scoreDelta})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div style={{ padding: "12px 20px 16px" }}>
        {orderedPillars.map((pillar) => {
          const meta = PILLAR_META[pillar];
          const weight = weights[pillar] ?? 0;
          const normalizedPct = normalizedWeights[pillar] ?? 0;
          const score = pillarScores[pillar];
          const hasData = score != null;

          return (
            <div
              key={pillar}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderBottom: "1px solid #f8fafc",
                opacity: hasData ? 1 : 0.5,
              }}
            >
              {/* Label */}
              <div
                style={{
                  width: 130,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#334155",
                    whiteSpace: "nowrap",
                  }}
                >
                  {meta.label}
                </span>
              </div>

              {/* Slider */}
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={weight}
                  onChange={(e) => handleSliderChange(pillar, Number(e.target.value))}
                  style={{
                    width: "100%",
                    height: 4,
                    appearance: "none",
                    background: `linear-gradient(to right, ${meta.color} ${weight * 2}%, #e2e8f0 ${weight * 2}%)`,
                    borderRadius: 2,
                    outline: "none",
                    cursor: "pointer",
                  }}
                />
              </div>

              {/* Poids normalisé */}
              <div
                style={{
                  width: 44,
                  textAlign: "right",
                  fontSize: 12,
                  fontWeight: 700,
                  color: meta.color,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {Math.round(normalizedPct)}%
              </div>

              {/* Score du pilier */}
              <div
                style={{
                  width: 36,
                  textAlign: "right",
                  fontSize: 11,
                  color: !hasData
                    ? "#cbd5e1"
                    : score >= 70
                    ? "#10b981"
                    : score >= 40
                    ? "#f59e0b"
                    : "#ef4444",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {hasData ? score : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div
        style={{
          padding: "12px 20px",
          borderTop: "1px solid #f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#fafbfc",
        }}
      >
        <button
          onClick={handleReset}
          disabled={!isModified}
          style={{
            fontSize: 12,
            color: isModified ? "#64748b" : "#cbd5e1",
            background: "none",
            border: "none",
            cursor: isModified ? "pointer" : "default",
            textDecoration: isModified ? "underline" : "none",
          }}
        >
          Réinitialiser
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {showSave && (
            <input
              type="text"
              value={profileLabel}
              onChange={(e) => setProfileLabel(e.target.value)}
              placeholder="Nom du profil"
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e2e8f0",
                width: 140,
                outline: "none",
              }}
            />
          )}
          <button
            onClick={() => {
              if (!showSave) {
                setShowSave(true);
              } else {
                onSave?.(normalizedWeights, profileLabel);
                setShowSave(false);
              }
            }}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              background: "#0ea5e9",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            {showSave ? "Confirmer" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}