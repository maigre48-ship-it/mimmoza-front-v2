import React, { useEffect, useMemo, useRef, useState } from "react";
import { Hammer, CalendarDays, AlertTriangle, Plus, CheckCircle2, Clock, Euro, Trash2 } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import KpiCard from "../shared/ui/KpiCard";
import TimelinePlanner, { type TimelinePhase } from "../shared/ui/TimelinePlanner";

import {
  readMarchandSnapshot,
  patchExecutionForDeal,
} from "../shared/marchandSnapshot.store";
import useMarchandSnapshotTick from "../shared/hooks/useMarchandSnapshotTick";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TaskStatus = "todo" | "doing" | "done";

type WorkTask = {
  id: string;
  lot: string;
  title: string;
  status: TaskStatus;
  budget: number;
  paid: number;
  startDay: number;
  durationDays: number;
  riskLevel: 1 | 2 | 3;
  notes?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const eur = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const LOTS = ["Prépa", "Démolition", "Plomberie", "Électricité", "Sols", "Peinture", "Cuisine", "SDB", "Menuiseries", "Divers"];

const statusLabel: Record<TaskStatus, string> = {
  todo: "À faire",
  doing: "En cours",
  done: "Terminé",
};

const statusPillStyle = (s: TaskStatus): React.CSSProperties => {
  if (s === "done") return { background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.28)", color: "#065f46" };
  if (s === "doing") return { background: "rgba(59,130,246,0.10)", borderColor: "rgba(59,130,246,0.22)", color: "#1d4ed8" };
  return { background: "rgba(15,23,42,0.05)", borderColor: "rgba(15,23,42,0.10)", color: "#334155" };
};

const mkId = () => `T-${Math.random().toString(16).slice(2, 10)}`;

/** Normalize task values to ensure valid ranges */
const normalizeTaskValues = (patch: Partial<WorkTask>): Partial<WorkTask> => {
  const normalized: Partial<WorkTask> = { ...patch };
  
  if (typeof normalized.startDay === "number") {
    normalized.startDay = Math.max(1, Math.round(normalized.startDay));
  }
  if (typeof normalized.durationDays === "number") {
    normalized.durationDays = Math.max(1, Math.round(normalized.durationDays));
  }
  if (typeof normalized.budget === "number") {
    normalized.budget = Math.max(0, normalized.budget);
  }
  if (typeof normalized.paid === "number") {
    normalized.paid = Math.max(0, normalized.paid);
  }
  
  return normalized;
};

// ─────────────────────────────────────────────────────────────────────────────
// Default values (for hydration reset - NEW DEAL = empty/neutral state)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GLOBAL = {
  startDate: "2026-02-03",
  bufferPct: 10,
  dailyHoldingCost: 35,
};

// IMPORTANT: vide pour nouveau deal (pas de mock T-001..T-004)
const DEFAULT_TASKS: WorkTask[] = [];

const DEFAULT_NEW_TASK: Partial<WorkTask> = {
  lot: "Divers",
  title: "",
  status: "todo",
  budget: 1000,
  paid: 0,
  startDay: 1,
  durationDays: 2,
  riskLevel: 1,
};

const DEFAULT_PLANNING_MODE: "auto" | "manuel" = "auto";

const DEFAULT_MANUAL_PHASES: TimelinePhase[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Internal UI Components
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  suffix,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min ?? 0}
          step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(15, 23, 42, 0.10)",
            background: "rgba(255,255,255,0.95)",
            fontWeight: 800,
            color: "#0f172a",
            outline: "none",
          }}
        />
        {suffix && (
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, whiteSpace: "nowrap" }}>
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.95)",
          fontWeight: 800,
          color: "#0f172a",
          outline: "none",
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function MarchandExecution() {
  // ─── Snapshot live tick ───────────────────────────────────────────────────
  const snapTick = useMarchandSnapshotTick();
  const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);

  // ─── Active deal from snapshot ────────────────────────────────────────────
  const activeDealId = snapshot.activeDealId ?? null;
  console.log("[EXEC] activeDealId", activeDealId, "saved?", !!(activeDealId && snapshot.executionByDeal?.[activeDealId]));
  const activeDeal = useMemo(
    () => snapshot.deals.find((d) => d.id === activeDealId) ?? null,
    [snapshot.deals, activeDealId]
  );

  // ─── Global settings ──────────────────────────────────────────────────────
  const [global, setGlobal] = useState({ ...DEFAULT_GLOBAL });

  // ─── Tasks state ──────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<WorkTask[]>([...DEFAULT_TASKS]);

  const [newTask, setNewTask] = useState<Partial<WorkTask>>({ ...DEFAULT_NEW_TASK });

  // ─── Planning state ───────────────────────────────────────────────────────
  const [planningMode, setPlanningMode] = useState<"auto" | "manuel">(DEFAULT_PLANNING_MODE);
  const [manualPhases, setManualPhases] = useState<TimelinePhase[]>([...DEFAULT_MANUAL_PHASES]);

  // ─── Hydration guard (tracks last hydrated deal) ──────────────────────────
  const lastHydratedDealIdRef = useRef<string | null>(null);

  // ─── Hydrate from snapshot ────────────────────────────────────────────────
  useEffect(() => {
    if (!activeDealId) return;

    // Already hydrated for this deal? Skip.
    if (lastHydratedDealIdRef.current === activeDealId) return;

    const saved = snapshot.executionByDeal[activeDealId];

    if (saved) {
      // Hydrate from saved data
      setGlobal(saved.global ?? { ...DEFAULT_GLOBAL });
      setTasks(Array.isArray(saved.tasks) ? saved.tasks : [...DEFAULT_TASKS]);
      setManualPhases(saved.phases ?? [...DEFAULT_MANUAL_PHASES]);
      setPlanningMode(saved.planningMode ?? DEFAULT_PLANNING_MODE);
    } else {
      // No saved data for this deal => reset to defaults (empty/neutral state)
      setGlobal({ ...DEFAULT_GLOBAL });
      setTasks([...DEFAULT_TASKS]);
      setManualPhases([...DEFAULT_MANUAL_PHASES]);
      setPlanningMode(DEFAULT_PLANNING_MODE);
    }

    // Reset newTask form as well
    setNewTask({ ...DEFAULT_NEW_TASK });

    // Mark this deal as hydrated
    lastHydratedDealIdRef.current = activeDealId;
  }, [activeDealId, snapshot.executionByDeal]);

  // ─── Persist (only after hydration) ───────────────────────────────────────
  useEffect(() => {
    if (!activeDealId) return;

    // Guard: don't persist until hydration is complete for this deal
    if (lastHydratedDealIdRef.current !== activeDealId) return;

    patchExecutionForDeal(activeDealId, {
      global,
      tasks,
      phases: manualPhases,
      planningMode,
    });
  }, [activeDealId, global, tasks, manualPhases, planningMode]);

  // ─── Stats calculation ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalBudget = tasks.reduce((s, t) => s + (t.budget || 0), 0);
    const buffer = totalBudget * (clamp(global.bufferPct, 0, 100) / 100);
    const totalBudgetWithBuffer = totalBudget + buffer;

    const totalPaid = tasks.reduce((s, t) => s + (t.paid || 0), 0);
    const remaining = Math.max(0, totalBudgetWithBuffer - totalPaid);

    const doneCount = tasks.filter((t) => t.status === "done").length;
    const doingCount = tasks.filter((t) => t.status === "doing").length;
    const todoCount = tasks.filter((t) => t.status === "todo").length;

    const endDay = tasks.length
      ? Math.max(...tasks.map((t) => (t.startDay || 1) + (t.durationDays || 0) - 1))
      : 0;

    const riskScore =
      tasks.length === 0
        ? 0
        : Math.round(
            (tasks.reduce((s, t) => s + (t.riskLevel || 1), 0) / tasks.length) * 10
          ) / 10;

    const holdingCost = endDay * Math.max(0, global.dailyHoldingCost);

    return {
      totalBudget,
      buffer,
      totalBudgetWithBuffer,
      totalPaid,
      remaining,
      doneCount,
      doingCount,
      todoCount,
      endDay,
      riskScore,
      holdingCost,
      cashNeededTotal: remaining + holdingCost,
    };
  }, [tasks, global.bufferPct, global.dailyHoldingCost]);

  // ─── Auto-generated phases from tasks ─────────────────────────────────────
  const autoPhases = useMemo((): TimelinePhase[] => {
    const workEndDay = stats.endDay || 14;

    // Étude: J1-3 (pre-work)
    const etudeDuration = 3;

    // Admin: J1-5 (overlaps with study)
    const adminDuration = 5;

    // Travaux: covers all work
    const travauxStart = 1;
    const travauxDuration = workEndDay;

    // Commercialisation: last third of work + buffer
    const commercialisationStart = Math.max(1, Math.round(workEndDay * 0.6));
    const commercialisationDuration = workEndDay - commercialisationStart + 10;

    // Vente: starts after work ends
    const venteStart = workEndDay + 1;
    const venteDuration = 7;

    return [
      {
        id: "auto-etude",
        name: "Étude & chiffrage",
        category: "etude",
        startDay: 1,
        durationDays: etudeDuration,
      },
      {
        id: "auto-admin",
        name: "Admin & planification",
        category: "admin",
        startDay: 1,
        durationDays: adminDuration,
      },
      {
        id: "auto-travaux",
        name: "Travaux",
        category: "travaux",
        startDay: travauxStart,
        durationDays: travauxDuration,
      },
      {
        id: "auto-commercialisation",
        name: "Commercialisation",
        category: "commercialisation",
        startDay: commercialisationStart,
        durationDays: commercialisationDuration,
      },
      {
        id: "auto-vente",
        name: "Vente / signature",
        category: "vente",
        startDay: venteStart,
        durationDays: venteDuration,
      },
    ];
  }, [stats.endDay]);

  // ─── Total days for timeline ──────────────────────────────────────────────
  const totalDays = useMemo(() => {
    const activePhases = planningMode === "auto" ? autoPhases : manualPhases;
    const maxPhaseEnd = activePhases.length
      ? Math.max(...activePhases.map((p) => p.startDay + p.durationDays - 1))
      : 0;
    return Math.max(maxPhaseEnd + 10, stats.endDay + 20, 40);
  }, [planningMode, autoPhases, manualPhases, stats.endDay]);

  // ─── Task handlers ────────────────────────────────────────────────────────
  const addTask = () => {
    const title = (newTask.title || "").trim();
    if (!title) return;

    const t: WorkTask = {
      id: mkId(),
      lot: (newTask.lot as string) || "Divers",
      title,
      status: (newTask.status as TaskStatus) || "todo",
      budget: Math.max(0, Number(newTask.budget ?? 0)),
      paid: Math.max(0, Number(newTask.paid ?? 0)),
      startDay: Math.max(1, Math.round(Number(newTask.startDay ?? 1))),
      durationDays: Math.max(1, Math.round(Number(newTask.durationDays ?? 1))),
      riskLevel: (newTask.riskLevel as 1 | 2 | 3) || 1,
      notes: (newTask.notes as string) || "",
    };

    setTasks((prev) => [...prev, t]);
    setNewTask((s) => ({ ...s, title: "" }));
  };

  const updateTask = (id: string, patch: Partial<WorkTask>) => {
    const normalizedPatch = normalizeTaskValues(patch);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...normalizedPatch } : t)));
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  // ─── Risk badge ───────────────────────────────────────────────────────────
  const riskBadge = () => {
    if (stats.riskScore <= 1.4) return { text: "Risque faible", bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.28)", c: "#065f46" };
    if (stats.riskScore <= 2.1) return { text: "Risque moyen", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.28)", c: "#92400e" };
    return { text: "Risque élevé", bg: "rgba(239,68,68,0.12)", bd: "rgba(239,68,68,0.28)", c: "#991b1b" };
  };

  const rb = riskBadge();

  // ─── Guard: no active deal ────────────────────────────────────────────────
  if (!activeDealId || !activeDeal) {
    return (
      <PageShell
        title="Exécution"
        subtitle="Sélectionne un deal dans Pipeline pour synchroniser toutes les pages."
      >
        <SectionCard title="Aucun deal actif" subtitle="Va dans Pipeline et sélectionne un deal.">
          <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
            Aucun deal n'est sélectionné. Une fois un deal actif, cette page se pré-remplira automatiquement.
          </div>
        </SectionCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Exécution"
      subtitle={`Travaux, planning, suivi paiements · ${activeDeal.label || activeDeal.id}`}
      right={
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 999,
            border: `1px solid ${rb.bd}`,
            background: rb.bg,
            color: rb.c,
            fontWeight: 900,
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={16} />
          {rb.text}
        </div>
      }
    >
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Budget travaux" value={eur(stats.totalBudgetWithBuffer)} hint={`Buffer: ${eur(stats.buffer)}`} icon={<Hammer size={18} />} />
        <KpiCard label="Payé" value={eur(stats.totalPaid)} hint={`Restant: ${eur(stats.remaining)}`} icon={<Euro size={18} />} />
        <KpiCard label="Durée planifiée" value={`${stats.endDay} j`} hint={`Holding: ${eur(stats.holdingCost)}`} icon={<CalendarDays size={18} />} />
        <KpiCard label="Cash total estimé" value={eur(stats.cashNeededTotal)} hint="Restant + holding" icon={<Clock size={18} />} />
      </div>

      <div style={{ height: 12 }} />

      {/* Timeline Planner (réutilisable) */}
      <TimelinePlanner
        title="Planning projet"
        subtitle="Frise chronologique des phases (Auto synchronisé avec les tâches, ou Manuel avec export Excel)"
        phases={manualPhases}
        onChange={setManualPhases}
        mode={planningMode}
        onModeChange={setPlanningMode}
        autoPhases={autoPhases}
        totalDays={totalDays}
        startDate={global.startDate}
        allowExport={true}
        allowImport={true}
      />

      <div style={{ height: 12 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12 }}>
        {/* Tableau tâches */}
        <SectionCard
          title="Suivi des lots"
          subtitle="Tâches, budget, paiements, planning"
          right={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#64748b", fontWeight: 900, fontSize: 12 }}>
              <CheckCircle2 size={16} />
              {stats.doneCount} terminé · {stats.doingCount} en cours · {stats.todoCount} à faire
            </div>
          }
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 10px" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 12, color: "#64748b", padding: "0 10px" }}>Statut</th>
                  <th style={{ textAlign: "left", fontSize: 12, color: "#64748b", padding: "0 10px" }}>Lot / Tâche</th>
                  <th style={{ textAlign: "right", fontSize: 12, color: "#64748b", padding: "0 10px" }}>Budget</th>
                  <th style={{ textAlign: "right", fontSize: 12, color: "#64748b", padding: "0 10px" }}>Payé</th>
                  <th style={{ textAlign: "center", fontSize: 12, color: "#64748b", padding: "0 10px" }}>Jours</th>
                  <th style={{ textAlign: "center", fontSize: 12, color: "#64748b", padding: "0 10px" }}>Risque</th>
                  <th style={{ textAlign: "right", fontSize: 12, color: "#64748b", padding: "0 10px" }} />
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "20px 10px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                      Aucune tâche pour ce deal. Ajoute ta première tâche ci-dessous.
                    </td>
                  </tr>
                ) : (
                  tasks.map((t) => {
                    const pill = statusPillStyle(t.status);
                    const daysLabel = `J${t.startDay} → J${t.startDay + t.durationDays - 1}`;
                    const riskColor = t.riskLevel === 1 ? "#065f46" : t.riskLevel === 2 ? "#92400e" : "#991b1b";
                    const riskBg = t.riskLevel === 1 ? "rgba(16,185,129,0.10)" : t.riskLevel === 2 ? "rgba(245,158,11,0.10)" : "rgba(239,68,68,0.10)";

                    return (
                      <tr key={t.id}>
                        <td style={{ padding: "0 10px" }}>
                          <select
                            value={t.status}
                            onChange={(e) => updateTask(t.id, { status: e.target.value as TaskStatus })}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: `1px solid ${pill.borderColor}`,
                              background: pill.background,
                              color: pill.color,
                              fontWeight: 900,
                              outline: "none",
                            }}
                          >
                            <option value="todo">À faire</option>
                            <option value="doing">En cours</option>
                            <option value="done">Terminé</option>
                          </select>
                        </td>

                        <td style={{ padding: "0 10px" }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{t.title}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{t.lot} · {t.id}</div>
                        </td>

                        <td style={{ padding: "0 10px", textAlign: "right" }}>
                          <input
                            type="number"
                            value={t.budget}
                            onChange={(e) => updateTask(t.id, { budget: Number(e.target.value) })}
                            style={{
                              width: 130,
                              textAlign: "right",
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.10)",
                              background: "rgba(255,255,255,0.95)",
                              fontWeight: 900,
                              color: "#0f172a",
                              outline: "none",
                            }}
                          />
                        </td>

                        <td style={{ padding: "0 10px", textAlign: "right" }}>
                          <input
                            type="number"
                            value={t.paid}
                            onChange={(e) => updateTask(t.id, { paid: Number(e.target.value) })}
                            style={{
                              width: 130,
                              textAlign: "right",
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.10)",
                              background: "rgba(255,255,255,0.95)",
                              fontWeight: 900,
                              color: "#0f172a",
                              outline: "none",
                            }}
                          />
                        </td>

                        <td style={{ padding: "0 10px", textAlign: "center" }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{daysLabel}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{t.durationDays} j</div>
                        </td>

                        <td style={{ padding: "0 10px", textAlign: "center" }}>
                          <select
                            value={t.riskLevel}
                            onChange={(e) => updateTask(t.id, { riskLevel: Number(e.target.value) as 1 | 2 | 3 })}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: `1px solid rgba(15,23,42,0.10)`,
                              background: riskBg,
                              color: riskColor,
                              fontWeight: 900,
                              outline: "none",
                            }}
                          >
                            <option value={1}>Faible</option>
                            <option value={2}>Moyen</option>
                            <option value={3}>Élevé</option>
                          </select>
                        </td>

                        <td style={{ padding: "0 10px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => removeTask(t.id)}
                            title="Supprimer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 38,
                              height: 38,
                              borderRadius: 12,
                              border: "1px solid rgba(15, 23, 42, 0.10)",
                              background: "rgba(15, 23, 42, 0.03)",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Ajout rapide */}
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid rgba(15, 23, 42, 0.06)",
            }}
          >
            <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 13, marginBottom: 10 }}>
              Ajouter une tâche
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Select
                label="Lot"
                value={(newTask.lot as string) || "Divers"}
                onChange={(v) => setNewTask((s) => ({ ...s, lot: v }))}
                options={LOTS.map((l) => ({ value: l, label: l }))}
              />

              <Select
                label="Statut"
                value={(newTask.status as string) || "todo"}
                onChange={(v) => setNewTask((s) => ({ ...s, status: v as TaskStatus }))}
                options={[
                  { value: "todo", label: statusLabel.todo },
                  { value: "doing", label: statusLabel.doing },
                  { value: "done", label: statusLabel.done },
                ]}
              />

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800, marginBottom: 6 }}>Titre</div>
                <input
                  type="text"
                  value={(newTask.title as string) || ""}
                  onChange={(e) => setNewTask((s) => ({ ...s, title: e.target.value }))}
                  placeholder="Ex: Pose cuisine + raccordements"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(15, 23, 42, 0.10)",
                    background: "rgba(255,255,255,0.95)",
                    fontWeight: 800,
                    color: "#0f172a",
                    outline: "none",
                  }}
                />
              </div>

              <Field label="Budget" value={Number(newTask.budget ?? 0)} onChange={(v) => setNewTask((s) => ({ ...s, budget: v }))} suffix="€" step={100} />
              <Field label="Payé" value={Number(newTask.paid ?? 0)} onChange={(v) => setNewTask((s) => ({ ...s, paid: v }))} suffix="€" step={100} />

              <Field label="Début (jour)" value={Number(newTask.startDay ?? 1)} onChange={(v) => setNewTask((s) => ({ ...s, startDay: v }))} suffix="J" step={1} min={1} />
              <Field label="Durée" value={Number(newTask.durationDays ?? 1)} onChange={(v) => setNewTask((s) => ({ ...s, durationDays: v }))} suffix="jours" step={1} min={1} />

              <Select
                label="Risque"
                value={String(newTask.riskLevel ?? 1)}
                onChange={(v) => setNewTask((s) => ({ ...s, riskLevel: Number(v) as 1 | 2 | 3 }))}
                options={[
                  { value: "1", label: "Faible" },
                  { value: "2", label: "Moyen" },
                  { value: "3", label: "Élevé" },
                ]}
              />

              <div style={{ display: "flex", alignItems: "end", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={addTask}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(15, 23, 42, 0.10)",
                    background: "rgba(15, 23, 42, 0.04)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={18} />
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Paramètres + checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionCard title="Paramètres chantier" subtitle="Impact planning & trésorerie">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Date de début</div>
                <input
                  type="date"
                  value={global.startDate}
                  onChange={(e) => setGlobal((s) => ({ ...s, startDate: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(15, 23, 42, 0.10)",
                    background: "rgba(255,255,255,0.95)",
                    fontWeight: 800,
                    color: "#0f172a",
                    outline: "none",
                  }}
                />
              </div>

              <Field
                label="Buffer travaux"
                value={global.bufferPct}
                onChange={(v) => setGlobal((s) => ({ ...s, bufferPct: v }))}
                suffix="%"
                step={1}
                min={0}
              />

              <Field
                label="Holding (€/jour)"
                value={global.dailyHoldingCost}
                onChange={(v) => setGlobal((s) => ({ ...s, dailyHoldingCost: v }))}
                suffix="€"
                step={5}
                min={0}
              />
              <div />
            </div>

            <div style={{ marginTop: 10, color: "#64748b", fontSize: 12, lineHeight: 1.6 }}>
              Holding = charges fixes pendant le chantier (assurance, charges copro, intérêts non modélisés ici…).  
              Cash total estimé = restant travaux (incl. buffer) + holding sur la durée planifiée.
            </div>
          </SectionCard>

          <SectionCard title="Checklist" subtitle="Ce qui sécurise le chantier">
            <ul style={{ margin: 0, paddingLeft: 18, color: "#334155", lineHeight: 1.85, fontSize: 13 }}>
              <li>Devis signés + dates d'intervention confirmées</li>
              <li>Photos avant / pendant / après (preuves + dossier)</li>
              <li>Contrôle qualité par lot (plomberie/élec)</li>
              <li>Réserves + levée des réserves avant paiement final</li>
              <li>Buffer (10–15%) validé selon état du bien</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}