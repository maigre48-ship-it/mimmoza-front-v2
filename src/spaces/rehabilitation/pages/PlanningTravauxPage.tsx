// src/spaces/rehabilitation/pages/PlanningTravauxPage.tsx
// Planning travaux (Réhabilitation) — frise chronologique calée sur le
// Planning Investisseur, alimentée par le snapshot de la Simulation travaux
// et ordonnancée par le moteur déterministe planningEngine.computePlanning().
//
// Budget / buffer / coût total / €/m² : VRAIS (snapshot de simulation).
// Durée + phases + dates : calculées par le moteur (aucune donnée inventée).

import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRehabTravauxSnapshot } from "../shared/rehabTravauxSnapshot.store";
import {
  computePlanning,
  operationTypeFromRenovLevel,
  complexityFromSlider,
  type PhaseId,
  type PhaseResult,
} from "../../marchand/engine/planningEngine";
import type { RenovationLevel } from "../../investisseur/shared/travauxSimulation.types";
import RehabLotsTracker from "../components/RehabLotsTracker";

/* ── Thème Réhabilitation ────────────────────────────────────────── */
const ACCENT_DARK = "#c2410c";
const GRAD        = "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)";

/* ── Formatting ──────────────────────────────────────────────────── */
const fmt      = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const fmtEuro  = (n: number) => `${fmt(n)} €`;
const fmtDay   = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "numeric" });
const fmtLong  = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const LEVEL_LABEL: Record<RenovationLevel, string> = {
  refresh:  "Rafraîchissement",
  standard: "Standard",
  heavy:    "Lourde",
  full:     "Complète",
};

/* ── Couleurs par phase (proches de l'écran Investisseur) ────────── */
const PHASE_COLORS: Record<PhaseId, { bg: string; fg: string; bd: string }> = {
  etudes:            { bg: "#ede9fe", fg: "#6d28d9", bd: "#ddd6fe" },
  administratif:     { bg: "#dbeafe", fg: "#1d4ed8", bd: "#bfdbfe" },
  consultation:      { bg: "#fef3c7", fg: "#b45309", bd: "#fde68a" },
  travaux:           { bg: "#fee2e2", fg: "#dc2626", bd: "#fecaca" },
  reception:         { bg: "#ffe4e6", fg: "#e11d48", bd: "#fecdd3" },
  commercialisation: { bg: "#dcfce7", fg: "#16a34a", bd: "#bbf7d0" },
  vente:             { bg: "#fce7f3", fg: "#db2777", bd: "#fbcfe8" },
};

/* ── Échelle de la frise ─────────────────────────────────────────── */
const PX_PER_DAY = 24;
const ROW_H      = 46;
const TICK_EVERY = 5; // jours

/* ── Carte stat ──────────────────────────────────────────────────── */
const StatCard: React.FC<{
  icon: React.ReactNode; label: string; value: string; sub?: string; strong?: boolean;
}> = ({ icon, label, value, sub, strong }) => (
  <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", color: ACCENT_DARK, flexShrink: 0 }}>
        {icon}
      </div>
      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{label}</span>
    </div>
    <div style={{ fontSize: 26, fontWeight: 800, color: strong ? ACCENT_DARK : "#0f172a", lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
  </div>
);

/* ================================================================== */
/*  Page                                                              */
/* ================================================================== */

const PlanningTravauxPage: React.FC = () => {
  const snap = useRehabTravauxSnapshot();

  const planning = useMemo(() => {
    if (!snap || snap.budgetHT <= 0) return null;
    return computePlanning({
      surface:       snap.surfaceM2,
      operationType: operationTypeFromRenovLevel(snap.renovationLevel),
      complexity:    complexityFromSlider(snap.complexity),
      startDate:     new Date(),
    });
  }, [snap]);

  /* ── Aucun résultat de simulation ── */
  if (!snap || snap.budgetHT <= 0 || !planning) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "48px 40px", background: "#fff", borderRadius: 18, border: "1px dashed #e2e8f0", maxWidth: 460 }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>📅</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Aucune simulation à planifier</div>
          <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, marginBottom: 20 }}>
            Le planning est construit à partir de votre <strong>Simulation travaux</strong>.
            Renseignez d'abord un budget dans l'onglet précédent.
          </div>
          <Link to="/rehabilitation/travaux" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, background: GRAD, color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
            → Aller à la Simulation travaux
          </Link>
        </div>
      </div>
    );
  }

  const { phases, totalDays, criticalPath, estimatedDeliveryDate } = planning;
  const criticalSet = new Set<PhaseId>(criticalPath);

  const chartWidth = Math.max(totalDays * PX_PER_DAY, 640);
  const ticks: number[] = [];
  for (let d = 0; d <= totalDays; d += TICK_EVERY) ticks.push(d);
  const startDate = phases[0]?.startDate ?? new Date();

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>

      {/* ── Bannière ── */}
      <div style={{ background: GRAD, borderRadius: 24, padding: "32px 36px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20, boxShadow: "0 8px 32px rgba(234,88,12,0.22)" }}>
        <div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
            Réhabilitation · Planning travaux
          </div>
          <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>
            Planning travaux
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 480, lineHeight: 1.55 }}>
            Budget, phases et échéancier · rénovation {LEVEL_LABEL[snap.renovationLevel].toLowerCase()}
          </div>
        </div>
        {estimatedDeliveryDate && (
          <div style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: "12px 18px", color: "#fff" }}>
            <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Livraison estimée</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{fmtLong(estimatedDeliveryDate)}</div>
          </div>
        )}
      </div>

      {/* ── Cartes stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        <StatCard
          icon={<IconHammer />}
          label="Budget travaux (HT)"
          value={fmtEuro(snap.budgetHT)}
          sub={`Buffer : ${fmtEuro(snap.bufferAmount)} · ${(snap.bufferPct * 100).toFixed(0)} %`}
        />
        <StatCard
          icon={<IconEuro />}
          label="Coût total estimé (HT)"
          value={fmtEuro(snap.totalWithBuffer)}
          sub="Budget + buffer"
          strong
        />
        <StatCard
          icon={<IconCalendar />}
          label="Durée planifiée"
          value={`${totalDays} j`}
          sub={`${phases.length} phases`}
        />
        <StatCard
          icon={<IconRuler />}
          label="€/m²"
          value={snap.costPerM2 !== null ? fmtEuro(snap.costPerM2) : "—"}
          sub={`${fmt(snap.surfaceM2)} m² · gamme ${snap.range}`}
        />
      </div>

      {/* ── Frise chronologique ── */}
      <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>Planning projet</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT_DARK, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 999, padding: "2px 10px" }}>
              {totalDays} j
            </span>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 12px" }}>
            <IconBolt /> Auto · synchronisé avec la simulation
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          Frise chronologique des phases · le chemin critique est surligné
        </div>

        {/* Légende chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {phases.map((p) => {
            const c = PHASE_COLORS[p.id];
            return (
              <span key={p.id} style={{ fontSize: 12, fontWeight: 700, color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 8, padding: "4px 10px" }}>
                {p.label}
              </span>
            );
          })}
        </div>

        {/* Zone scrollable */}
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ width: chartWidth, minWidth: "100%", position: "relative" }}>

            {/* Règle de dates */}
            <div style={{ position: "relative", height: 24, borderBottom: "1px solid #e2e8f0", marginBottom: 8 }}>
              {ticks.map((day) => {
                const date = new Date(startDate);
                date.setDate(date.getDate() + day);
                return (
                  <div key={day} style={{ position: "absolute", left: day * PX_PER_DAY, top: 0, transform: "translateX(-50%)", fontSize: 11, color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {fmtDay(date)}
                  </div>
                );
              })}
            </div>

            {/* Grille + barres */}
            <div style={{
              position: "relative",
              backgroundImage: `repeating-linear-gradient(to right, #f1f5f9 0, #f1f5f9 1px, transparent 1px, transparent ${TICK_EVERY * PX_PER_DAY}px)`,
            }}>
              {phases.map((p: PhaseResult) => {
                const c        = PHASE_COLORS[p.id];
                const left     = p.startDay * PX_PER_DAY;
                const width    = Math.max(p.duration * PX_PER_DAY, 44);
                const critical = criticalSet.has(p.id);
                return (
                  <div key={p.id} style={{ position: "relative", height: ROW_H }}>
                    <div
                      title={`${p.label} · ${p.duration} j${p.parallel ? " · en parallèle" : ""}${critical ? " · chemin critique" : ""}`}
                      style={{
                        position: "absolute", left, width, top: 7, height: ROW_H - 14,
                        background: c.bg, border: `1.5px solid ${critical ? c.fg : c.bd}`,
                        borderRadius: 8, display: "flex", alignItems: "center",
                        justifyContent: "space-between", padding: "0 10px", overflow: "hidden",
                        boxShadow: critical ? `0 2px 8px ${c.bd}` : "none",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: c.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.label}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: c.fg, opacity: 0.75, flexShrink: 0, marginLeft: 8 }}>
                        {p.duration}j
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
          Planning ordonnancé à partir de la surface ({fmt(snap.surfaceM2)} m²), du type d'opération
          (rénovation {LEVEL_LABEL[snap.renovationLevel].toLowerCase()}) et de la complexité chantier
          ({snap.complexity}/4). La commercialisation démarre en parallèle des travaux.
        </div>
      </div>

      <div style={{ height: 20 }} />
      <RehabLotsTracker budgetReference={snap.totalWithBuffer} />
    </div>
  );
};

export default PlanningTravauxPage;

/* ================================================================== */
/*  Icônes inline (pas de dépendance)                                 */
/* ================================================================== */

const IconHammer = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h.86c.85 0 1.65.34 2.25.93l1.25 1.25" />
  </svg>
);
const IconEuro = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12a7.9 7.9 0 0 0 7.8 8 7.7 7.7 0 0 0 5.2-2" />
  </svg>
);
const IconCalendar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const IconRuler = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z" /><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2" />
  </svg>
);
const IconBolt = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);