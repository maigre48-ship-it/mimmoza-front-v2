// src/spaces/rehabilitation/components/RehabLotsTracker.tsx
// Suivi des lots (Réhabilitation) — thème orange, store de tâches en mémoire
// de session (singleton module). Pas de dépendance au marchand.
//
// - Barre de RÉPARTITION du budget par lot (pas d'axe temporel).
// - Suivi payé / solde restant vs BUDGET TRAVAUX INITIAL (avec buffer),
//   passé en prop `budgetReference` depuis la page (= snap.totalWithBuffer).
// - Dépassement (Σ budgets lots > budget initial) → barre à 100 % + badge rouge.

import React, { useState, useSyncExternalStore } from "react";
import { CheckCircle2, Plus, Trash2, AlertTriangle } from "lucide-react";

/* ── Thème ───────────────────────────────────────────────────────── */
const ACCENT      = "#f97316";
const ACCENT_DARK = "#c2410c";

/* ── Types ───────────────────────────────────────────────────────── */
type TaskStatus = "todo" | "doing" | "done";
export interface RehabLot {
  id: string;
  lot: string;
  title: string;
  status: TaskStatus;
  budget: number;
  paid: number;
  riskLevel: 1 | 2 | 3;
  notes?: string;
}

const LOTS = ["Prépa", "Démolition", "Plomberie", "Électricité", "Sols", "Peinture", "Cuisine", "SDB", "Menuiseries", "Divers"];
const STATUS_LABEL: Record<TaskStatus, string> = { todo: "À faire", doing: "En cours", done: "Terminé" };

/* Palette stable par lot (pour la barre de répartition) */
const LOT_PALETTE: Record<string, string> = {
  "Prépa": "#8b5cf6", "Démolition": "#3b82f6", "Plomberie": "#06b6d4", "Électricité": "#f59e0b",
  "Sols": "#10b981", "Peinture": "#ec4899", "Cuisine": "#f97316", "SDB": "#14b8a6",
  "Menuiseries": "#6366f1", "Divers": "#94a3b8",
};
const lotColor = (lot: string, i: number) => LOT_PALETTE[lot] ?? ["#f97316", "#3b82f6", "#10b981", "#ec4899", "#8b5cf6", "#f59e0b"][i % 6];

/* ── Store singleton (survit à la navigation entre onglets réhab) ──── */
let _tasks: RehabLot[] = [];
const _listeners = new Set<() => void>();
function emit() { _listeners.forEach((l) => l()); }
function subscribe(cb: () => void) { _listeners.add(cb); return () => { _listeners.delete(cb); }; }
function getTasks() { return _tasks; }
function setTasks(next: RehabLot[]) { _tasks = next; emit(); }
export function useRehabLots(): RehabLot[] {
  return useSyncExternalStore(subscribe, getTasks, getTasks);
}

const mkId = () => `L-${Math.random().toString(16).slice(2, 10)}`;

/* ── Helpers ─────────────────────────────────────────────────────── */
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const statusPill = (s: TaskStatus): React.CSSProperties => {
  if (s === "done")  return { background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.28)", color: "#065f46" };
  if (s === "doing") return { background: "rgba(249,115,22,0.12)", borderColor: "rgba(249,115,22,0.28)", color: ACCENT_DARK };
  return { background: "rgba(15,23,42,0.05)", borderColor: "rgba(15,23,42,0.10)", color: "#334155" };
};
const riskColors = (r: 1 | 2 | 3) =>
  r === 1 ? { c: "#065f46", bg: "rgba(16,185,129,0.10)" }
  : r === 2 ? { c: "#92400e", bg: "rgba(245,158,11,0.10)" }
  : { c: "#991b1b", bg: "rgba(239,68,68,0.10)" };

/* ── Atomes de formulaire ────────────────────────────────────────── */
const inputCls: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.10)", background: "#fff",
  fontWeight: 600, color: "#0f172a", outline: "none",
};
const Field: React.FC<{ label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number; error?: boolean; errorMsg?: string }> =
  ({ label, value, onChange, suffix, step, error, errorMsg }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="number" value={Number.isFinite(value) ? value : 0} min={0} step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...inputCls, border: error ? "1px solid #dc2626" : inputCls.border }} />
        {suffix && <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{suffix}</span>}
      </div>
      {error && errorMsg && <div style={{ fontSize: 12, color: "#dc2626" }}>{errorMsg}</div>}
    </div>
  );
const Select: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }> =
  ({ label, value, onChange, options }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

/* ── Carte récap ─────────────────────────────────────────────────── */
const RecapCard: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 12, padding: "12px 14px" }}>
    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: color ?? "#0f172a", marginTop: 4 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
  </div>
);

/* ================================================================== */
/*  Composant                                                        */
/* ================================================================== */

const DEFAULT_NEW: Partial<RehabLot> = { lot: "Divers", title: "", status: "todo", budget: 1000, paid: 0, riskLevel: 1 };

interface Props {
  /** Budget travaux initial de référence (coût total AVEC buffer de la simulation). */
  budgetReference: number;
}

const RehabLotsTracker: React.FC<Props> = ({ budgetReference }) => {
  const tasks = useRehabLots();
  const [draft, setDraft] = useState<Partial<RehabLot>>({ ...DEFAULT_NEW });
  const [errors, setErrors] = useState<{ title?: boolean; budget?: boolean }>({});

  const budgetLots = tasks.reduce((s, t) => s + (t.budget || 0), 0);
  const totalPaid  = tasks.reduce((s, t) => s + (t.paid || 0), 0);
  const budgetRef  = Math.max(0, budgetReference);
  const soldeVsRef = budgetRef - totalPaid;                 // solde vs budget initial
  const depassement = Math.max(0, budgetLots - budgetRef);  // Σ lots au-delà du budget initial
  const paidPct    = budgetRef > 0 ? Math.min(100, Math.round((totalPaid / budgetRef) * 100)) : 0;

  const done  = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const todo  = tasks.filter((t) => t.status === "todo").length;

  // Segments de la barre de répartition (bornés à 100 % du budget de référence).
  const allocBase = Math.max(budgetRef, budgetLots, 1);
  const segments = tasks
    .filter((t) => (t.budget || 0) > 0)
    .map((t, i) => ({ id: t.id, lot: t.lot, title: t.title, budget: t.budget, color: lotColor(t.lot, i) }));

  const addTask = () => {
    const title = (draft.title || "").trim();
    const budgetOk = Number(draft.budget) > 0;
    const nextErrors = { title: !title, budget: !budgetOk };
    if (nextErrors.title || nextErrors.budget) { setErrors(nextErrors); return; }
    setErrors({});
    const t: RehabLot = {
      id: mkId(),
      lot: (draft.lot as string) || "Divers",
      title,
      status: (draft.status as TaskStatus) || "todo",
      budget: Math.max(0, Number(draft.budget ?? 0)),
      paid: Math.max(0, Number(draft.paid ?? 0)),
      riskLevel: (draft.riskLevel as 1 | 2 | 3) || 1,
    };
    setTasks([...tasks, t]);
    setDraft((s) => ({ ...s, title: "" }));
  };
  const updateTask = (id: string, patch: Partial<RehabLot>) =>
    setTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTask = (id: string) => setTasks(tasks.filter((t) => t.id !== id));

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0", padding: 24 }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>Suivi des lots</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Répartition du budget, paiements et solde par lot</div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#64748b", fontWeight: 600, fontSize: 12 }}>
          <CheckCircle2 size={16} /> {done} terminé · {doing} en cours · {todo} à faire
        </div>
      </div>

      {/* Récap montants (vs budget initial AVEC buffer) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, margin: "16px 0" }}>
        <RecapCard label="Budget travaux initial" value={eur(budgetRef)} sub="Coût total · buffer inclus" />
        <RecapCard label="Budget alloué aux lots"  value={eur(budgetLots)} sub={`${budgetRef > 0 ? Math.round((budgetLots / budgetRef) * 100) : 0} % du budget initial`} />
        <RecapCard label="Payé (HT)"               value={eur(totalPaid)} sub={`${paidPct} % du budget initial`} />
        <RecapCard label="Solde restant"           value={eur(soldeVsRef)} sub="Budget initial − payé" color={soldeVsRef < 0 ? "#dc2626" : ACCENT_DARK} />
      </div>

      {/* Barre de progression paiement */}
      <div style={{ margin: "4px 0 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 6 }}>
          <span style={{ fontWeight: 600 }}>Avancement des paiements</span>
          <span style={{ fontWeight: 700, color: ACCENT_DARK }}>{paidPct} %</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${paidPct}%`, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DARK})`, borderRadius: 999, transition: "width .2s" }} />
        </div>
      </div>

      {/* Barre de RÉPARTITION du budget par lot */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>
            Répartition du budget par lot
          </span>
          {depassement > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#991b1b", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.28)", borderRadius: 999, padding: "3px 10px" }}>
              <AlertTriangle size={13} /> Dépassement : +{eur(depassement)}
            </span>
          )}
        </div>

        {segments.length === 0 ? (
          <div style={{ height: 22, borderRadius: 8, background: "#f1f5f9", border: "1px dashed #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#94a3b8" }}>
            Ajoute des lots pour visualiser la répartition
          </div>
        ) : (
          <>
            <div style={{ display: "flex", width: "100%", height: 22, borderRadius: 8, overflow: "hidden", background: "#f1f5f9" }}>
              {segments.map((s) => (
                <div key={s.id} title={`${s.lot} — ${s.title} · ${eur(s.budget)}`}
                  style={{ width: `${(s.budget / allocBase) * 100}%`, background: s.color, minWidth: 2 }} />
              ))}
              {/* Reste disponible sous le budget initial */}
              {budgetLots < budgetRef && (
                <div title={`Non alloué · ${eur(budgetRef - budgetLots)}`} style={{ flex: 1, background: "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 6px, #eef2f7 6px, #eef2f7 12px)" }} />
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
              {segments.map((s) => (
                <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
                  <strong>{s.lot}</strong> · {eur(s.budget)} · {budgetRef > 0 ? Math.round((s.budget / budgetRef) * 100) : 0} %
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Tableau */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 10px" }}>
          <thead>
            <tr>
              {["Statut", "Lot / Tâche", "Budget (HT)", "Payé (HT)", "Risque", ""].map((h, i) => (
                <th key={i} style={{ textAlign: i === 2 || i === 3 ? "right" : i === 4 ? "center" : "left", fontSize: 12, color: "#64748b", padding: "0 10px", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "20px 10px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                  Aucun lot pour l'instant. Ajoute ta première tâche ci-dessous.
                </td>
              </tr>
            ) : (
              tasks.map((t) => {
                const pill = statusPill(t.status);
                const rc = riskColors(t.riskLevel);
                return (
                  <tr key={t.id}>
                    <td style={{ padding: "0 10px" }}>
                      <select value={t.status} onChange={(e) => updateTask(t.id, { status: e.target.value as TaskStatus })}
                        style={{ padding: "8px 10px", borderRadius: 12, border: `1px solid ${pill.borderColor}`, background: pill.background, color: pill.color as string, fontWeight: 600, outline: "none" }}>
                        <option value="todo">À faire</option>
                        <option value="doing">En cours</option>
                        <option value="done">Terminé</option>
                      </select>
                    </td>
                    <td style={{ padding: "0 10px" }}>
                      <input type="text" value={t.title} onChange={(e) => updateTask(t.id, { title: e.target.value })} style={{ ...inputCls, width: 220 }} />
                      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{t.lot} · {t.id}</div>
                    </td>
                    <td style={{ padding: "0 10px", textAlign: "right" }}>
                      <input type="number" value={t.budget} onChange={(e) => updateTask(t.id, { budget: Math.max(0, Number(e.target.value)) })} style={{ ...inputCls, width: 130, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "0 10px", textAlign: "right" }}>
                      <input type="number" value={t.paid} onChange={(e) => updateTask(t.id, { paid: Math.max(0, Number(e.target.value)) })} style={{ ...inputCls, width: 130, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "0 10px", textAlign: "center" }}>
                      <select value={t.riskLevel} onChange={(e) => updateTask(t.id, { riskLevel: Number(e.target.value) as 1 | 2 | 3 })}
                        style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)", background: rc.bg, color: rc.c, fontWeight: 600, outline: "none" }}>
                        <option value={1}>Faible</option>
                        <option value={2}>Moyen</option>
                        <option value={3}>Élevé</option>
                      </select>
                    </td>
                    <td style={{ padding: "0 10px", textAlign: "right" }}>
                      <button type="button" onClick={() => removeTask(t.id)} title="Supprimer"
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)", background: "rgba(15,23,42,0.03)", cursor: "pointer" }}>
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

      {/* Ajout */}
      <div style={{ marginTop: 10, paddingTop: 14, borderTop: "1px solid rgba(15,23,42,0.06)" }}>
        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13, marginBottom: 12 }}>Ajouter un lot</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Select label="Lot" value={(draft.lot as string) || "Divers"} onChange={(v) => setDraft((s) => ({ ...s, lot: v }))} options={LOTS.map((l) => ({ value: l, label: l }))} />
          <Select label="Statut" value={(draft.status as string) || "todo"} onChange={(v) => setDraft((s) => ({ ...s, status: v as TaskStatus }))} options={(["todo", "doing", "done"] as TaskStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>Titre</div>
            <input type="text" value={(draft.title as string) || ""} placeholder="Ex : Pose cuisine + raccordements"
              onChange={(e) => { setDraft((s) => ({ ...s, title: e.target.value })); if (errors.title) setErrors((x) => ({ ...x, title: false })); }}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
              style={{ ...inputCls, border: errors.title ? "1px solid #dc2626" : inputCls.border }} />
            {errors.title && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>Donne un titre au lot.</div>}
          </div>
          <Field label="Budget" value={Number(draft.budget ?? 0)}
            onChange={(v) => { setDraft((s) => ({ ...s, budget: v })); if (errors.budget) setErrors((x) => ({ ...x, budget: false })); }}
            suffix="€" step={100} error={errors.budget} errorMsg="Budget requis (> 0)." />
          <Field label="Payé"   value={Number(draft.paid ?? 0)}   onChange={(v) => setDraft((s) => ({ ...s, paid: v }))}   suffix="€" step={100} />
          <Select label="Risque" value={String(draft.riskLevel ?? 1)} onChange={(v) => setDraft((s) => ({ ...s, riskLevel: Number(v) as 1 | 2 | 3 }))} options={[{ value: "1", label: "Faible" }, { value: "2", label: "Moyen" }, { value: "3", label: "Élevé" }]} />
          <div style={{ display: "flex", alignItems: "end", justifyContent: "flex-end" }}>
            <button type="button" onClick={addTask}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 16px", borderRadius: 12, border: "none", background: ACCENT, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              <Plus size={18} /> Ajouter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RehabLotsTracker;