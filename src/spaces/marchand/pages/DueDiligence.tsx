/**
 * DueDiligence.tsx
 *
 * Page Due Diligence de l'espace Marchand.
 * Affiche les items DD groupés par catégorie, avec boutons
 * « Auto-remplir Marché » et « Auto-remplir Risques ».
 *
 * Le dossierId DD === activeDealId du snapshot Marchand
 * (ex: "D-117") pour que le PDF récupère les bonnes données.
 */

import { useState, useEffect, useCallback } from "react";
import {
  readMarchandSnapshot,
  ensureActiveDeal,
  MARCHAND_SNAPSHOT_EVENT,
  type MarchandDeal,
} from "../shared/marchandSnapshot.store";
import {
  readItemsForDossier,
  upsertItemsForDossier,
  DD_EVENT,
  type DueDiligenceItem,
  type DDStatus,
  type DDCategory,
} from "../shared/dueDiligence.store";
import { enrichMarketToDueDiligence } from "../services/enrichMarketToDueDiligence.service";
import { enrichRisksToDueDiligence } from "../services/enrichRisksToDueDiligence.service";

// ─── Category config ────────────────────────────────────────────────

type CategoryMeta = { label: string; icon: string; order: number };

const CATEGORY_META: Record<DDCategory, CategoryMeta> = {
  marche: { label: "Marché", icon: "📊", order: 0 },
  risques_externes: { label: "Risques externes", icon: "⚠️", order: 1 },
  juridique: { label: "Juridique", icon: "⚖️", order: 2 },
  technique: { label: "Technique", icon: "🔧", order: 3 },
  urbanisme: { label: "Urbanisme", icon: "🏗️", order: 4 },
  financier: { label: "Financier", icon: "💰", order: 5 },
};

const STATUS_CONFIG: Record<DDStatus, { bg: string; border: string; text: string; dot: string; label: string }> = {
  OK: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", dot: "#22c55e", label: "OK" },
  WARNING: { bg: "#fefce8", border: "#fef08a", text: "#854d0e", dot: "#f59e0b", label: "Attention" },
  CRITICAL: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", dot: "#ef4444", label: "Critique" },
  MISSING: { bg: "#f8fafc", border: "#e2e8f0", text: "#64748b", dot: "#94a3b8", label: "Manquant" },
  PENDING: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", dot: "#3b82f6", label: "En cours" },
};

// ─── Component ──────────────────────────────────────────────────────

export default function MarchandDueDiligence() {
  // ── State ────────────────────────────────────────────────────────
  const [deal, setDeal] = useState<MarchandDeal | null>(null);
  const [items, setItems] = useState<DueDiligenceItem[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [loadingRisks, setLoadingRisks] = useState(false);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  // ── Sync with stores ─────────────────────────────────────────────

  const refresh = useCallback(() => {
    const d = ensureActiveDeal();
    setDeal(d);
    if (d) {
      setItems(readItemsForDossier(d.id));
    } else {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    refresh();

    const onSnapshot = () => refresh();
    const onDD = () => refresh();

    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onSnapshot);
    window.addEventListener(DD_EVENT, onDD);
    window.addEventListener("storage", onSnapshot);

    return () => {
      window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, onSnapshot);
      window.removeEventListener(DD_EVENT, onDD);
      window.removeEventListener("storage", onSnapshot);
    };
  }, [refresh]);

  // ── Handlers ─────────────────────────────────────────────────────

  const handleAutoMarket = async () => {
    setAlertMsg(null);
    setLoadingMarket(true);
    try {
      const res = await enrichMarketToDueDiligence();
      if (!res.ok) setAlertMsg(res.error ?? "Erreur inconnue (Marché).");
    } catch (e: unknown) {
      setAlertMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMarket(false);
      refresh();
    }
  };

  const handleAutoRisks = async () => {
    setAlertMsg(null);
    setLoadingRisks(true);
    try {
      const res = await enrichRisksToDueDiligence();
      if (!res.ok) setAlertMsg(res.error ?? "Erreur inconnue (Risques).");
    } catch (e: unknown) {
      setAlertMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRisks(false);
      refresh();
    }
  };

  // ── Derived ──────────────────────────────────────────────────────

  const grouped = items.reduce<Record<DDCategory, DueDiligenceItem[]>>(
    (acc, it) => {
      const cat = it.category as DDCategory;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(it);
      return acc;
    },
    {} as Record<DDCategory, DueDiligenceItem[]>
  );

  const sortedCategories = (Object.keys(grouped) as DDCategory[]).sort(
    (a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
  );

  const totalItems = items.length;
  const okCount = items.filter((i) => i.status === "OK").length;
  const warnCount = items.filter(
    (i) => i.status === "WARNING" || i.status === "CRITICAL"
  ).length;

  // ── Render ───────────────────────────────────────────────────────

  if (!deal) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Aucun deal actif
        </p>
        <p style={{ fontSize: 14 }}>
          Sélectionnez un deal dans le pipeline pour démarrer la Due Diligence.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#0f172a",
            margin: "0 0 4px",
          }}
        >
          Due Diligence
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
          {deal.title} — {deal.city ?? ""}
          {deal.zipCode ? ` (${deal.zipCode})` : ""}
          <span
            style={{
              marginLeft: 12,
              fontSize: 12,
              padding: "2px 8px",
              background: "#e0e7ff",
              borderRadius: 6,
              color: "#4338ca",
              fontWeight: 500,
            }}
          >
            {deal.id}
          </span>
        </p>
      </div>

      {/* ── KPI bar ────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <KpiChip label="Items" value={String(totalItems)} color="#3b82f6" />
        <KpiChip label="OK" value={String(okCount)} color="#22c55e" />
        <KpiChip label="Alertes" value={String(warnCount)} color="#f59e0b" />
        <KpiChip
          label="Complétude"
          value={
            totalItems > 0
              ? `${Math.round(
                  ((totalItems - items.filter((i) => i.status === "MISSING").length) /
                    totalItems) *
                    100
                )}%`
              : "—"
          }
          color="#8b5cf6"
        />
      </div>

      {/* ── Action buttons ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <ActionButton
          label="Auto-remplir Marché"
          icon="📊"
          loading={loadingMarket}
          onClick={handleAutoMarket}
          color="#3b82f6"
        />
        <ActionButton
          label="Auto-remplir Risques"
          icon="⚠️"
          loading={loadingRisks}
          onClick={handleAutoRisks}
          color="#f59e0b"
        />
      </div>

      {/* ── Error alert ────────────────────────────────────────── */}
      {alertMsg && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>❌</span>
          <div style={{ flex: 1 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#991b1b",
                fontWeight: 500,
              }}
            >
              Erreur
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#b91c1c" }}>
              {alertMsg}
            </p>
          </div>
          <button
            onClick={() => setAlertMsg(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              color: "#b91c1c",
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Items by category ──────────────────────────────────── */}
      {sortedCategories.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "#94a3b8",
            background: "#f8fafc",
            borderRadius: 12,
            border: "1px dashed #e2e8f0",
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
            Aucun item Due Diligence
          </p>
          <p style={{ fontSize: 14, margin: 0 }}>
            Utilisez les boutons ci-dessus pour auto-remplir Marché et Risques.
          </p>
        </div>
      )}

      {sortedCategories.map((cat) => {
        const meta = CATEGORY_META[cat] ?? {
          label: cat,
          icon: "📋",
          order: 99,
        };
        const catItems = grouped[cat];

        return (
          <div
            key={cat}
            style={{
              marginBottom: 20,
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
            }}
          >
            {/* Category header */}
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid #f1f5f9",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>{meta.icon}</span>
              <h2
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#0f172a",
                  margin: 0,
                  flex: 1,
                }}
              >
                {meta.label}
              </h2>
              <span
                style={{
                  fontSize: 12,
                  color: "#94a3b8",
                  fontWeight: 500,
                }}
              >
                {catItems.length} item{catItems.length > 1 ? "s" : ""}
              </span>
            </div>

            {/* Items */}
            {catItems.map((item) => {
              const sc = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.MISSING;
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "14px 20px",
                    borderBottom: "1px solid #f8fafc",
                    background: sc.bg,
                  }}
                >
                  {/* Status dot */}
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: sc.dot,
                      marginTop: 5,
                      flexShrink: 0,
                    }}
                  />

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#0f172a",
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "1px 8px",
                          borderRadius: 6,
                          background: sc.border,
                          color: sc.text,
                          fontWeight: 600,
                        }}
                      >
                        {sc.label}
                      </span>
                    </div>

                    {item.value && (
                      <p
                        style={{
                          margin: "0 0 2px",
                          fontSize: 13,
                          fontWeight: 600,
                          color: sc.text,
                        }}
                      >
                        {item.value}
                      </p>
                    )}

                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: "#64748b",
                        lineHeight: 1.45,
                      }}
                    >
                      {item.comment}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <span
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {item.updatedAt
                      ? new Date(item.updatedAt).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function KpiChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
        {label}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  loading,
  onClick,
  color,
}: {
  label: string;
  icon: string;
  loading: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        fontSize: 14,
        fontWeight: 600,
        color: "#fff",
        background: loading ? "#94a3b8" : color,
        border: "none",
        borderRadius: 10,
        cursor: loading ? "wait" : "pointer",
        opacity: loading ? 0.7 : 1,
        transition: "all 150ms",
      }}
    >
      {loading ? (
        <span
          style={{
            display: "inline-block",
            width: 16,
            height: 16,
            border: "2px solid rgba(255,255,255,0.3)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      ) : (
        <span>{icon}</span>
      )}
      {loading ? "Chargement…" : label}

      {/* Inline keyframes for spinner */}
      {loading && (
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      )}
    </button>
  );
}