import React, { useMemo, useState, useRef } from "react";
import { Plus, Trash2, Zap, Pencil, Download, Upload, Copy, Settings2 } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PhaseCategory = "etude" | "admin" | "financement" | "travaux" | "commercialisation" | "vente";

export type TimelinePhase = {
  id: string;
  name: string;
  category: PhaseCategory;
  startDay: number;
  durationDays: number;
  notes?: string;
};

export type TimelinePlannerProps = {
  title?: string;
  subtitle?: string;
  phases: TimelinePhase[];
  onChange: (next: TimelinePhase[]) => void;
  mode?: "auto" | "manuel";
  onModeChange?: (m: "auto" | "manuel") => void;
  autoPhases?: TimelinePhase[];
  totalDays?: number;
  startDate?: string;
  unit?: "day" | "week";
  allowImport?: boolean;
  allowExport?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Styles
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<PhaseCategory, { bg: string; border: string; color: string; label: string }> = {
  etude: { bg: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.35)", color: "#6d28d9", label: "Étude" },
  admin: { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.35)", color: "#1d4ed8", label: "Admin" },
  financement: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.35)", color: "#b45309", label: "Financement" },
  travaux: { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.35)", color: "#b91c1c", label: "Travaux" },
  commercialisation: { bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.35)", color: "#047857", label: "Commercialisation" },
  vente: { bg: "rgba(236, 72, 153, 0.12)", border: "rgba(236, 72, 153, 0.35)", color: "#be185d", label: "Vente" },
};

const CATEGORY_OPTIONS: { value: PhaseCategory; label: string }[] = [
  { value: "etude", label: "Étude" },
  { value: "admin", label: "Admin" },
  { value: "financement", label: "Financement" },
  { value: "travaux", label: "Travaux" },
  { value: "commercialisation", label: "Commercialisation" },
  { value: "vente", label: "Vente" },
];

const mkPhaseId = () => `P-${Math.random().toString(16).slice(2, 10)}`;

// ─────────────────────────────────────────────────────────────────────────────
// Internal Components
// ─────────────────────────────────────────────────────────────────────────────

function FieldCompact({
  label,
  value,
  onChange,
  suffix,
  min,
  step,
  width,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min ?? 0}
          step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: width ?? 70,
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid rgba(15, 23, 42, 0.10)",
            background: "rgba(255,255,255,0.95)",
            fontWeight: 700,
            fontSize: 12,
            color: "#0f172a",
            outline: "none",
          }}
        />
        {suffix && (
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}

function SelectCompact({
  label,
  value,
  onChange,
  options,
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: width ?? 120,
          padding: "6px 8px",
          borderRadius: 8,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.95)",
          fontWeight: 700,
          fontSize: 12,
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

function IconButton({
  onClick,
  title,
  icon,
  variant = "default",
  disabled,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  variant?: "default" | "danger" | "primary";
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      border: "1px solid rgba(15, 23, 42, 0.10)",
      background: "rgba(15, 23, 42, 0.03)",
      color: "#64748b",
    },
    danger: {
      border: "1px solid rgba(239, 68, 68, 0.20)",
      background: "rgba(239, 68, 68, 0.06)",
      color: "#b91c1c",
    },
    primary: {
      border: "1px solid rgba(59, 130, 246, 0.30)",
      background: "rgba(59, 130, 246, 0.08)",
      color: "#1d4ed8",
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...styles[variant],
      }}
    >
      {icon}
    </button>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  variant = "default",
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "primary" | "success";
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      border: "1px solid rgba(15, 23, 42, 0.10)",
      background: "rgba(15, 23, 42, 0.03)",
      color: "#64748b",
    },
    primary: {
      border: "1px solid rgba(59, 130, 246, 0.30)",
      background: "rgba(59, 130, 246, 0.08)",
      color: "#1d4ed8",
    },
    success: {
      border: "1px solid rgba(16, 185, 129, 0.30)",
      background: "rgba(16, 185, 129, 0.08)",
      color: "#047857",
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 10,
        fontWeight: 800,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...styles[variant],
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function TimelinePlanner({
  title = "Planning",
  subtitle,
  phases,
  onChange,
  mode = "manuel",
  onModeChange,
  autoPhases = [],
  totalDays: totalDaysProp,
  startDate,
  unit = "day",
  allowImport = true,
  allowExport = true,
}: TimelinePlannerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Determine which phases to display
  const displayPhases = mode === "auto" ? autoPhases : phases;

  // Calculate total days
  const totalDays = useMemo(() => {
    if (totalDaysProp) return totalDaysProp;
    const maxEnd = displayPhases.length
      ? Math.max(...displayPhases.map((p) => p.startDay + p.durationDays - 1))
      : 0;
    return Math.max(maxEnd + 20, 40);
  }, [totalDaysProp, displayPhases]);

  // Timeline dimensions
  const dayWidth = unit === "week" ? 16 : 24;
  const tickInterval = unit === "week" ? 7 : 5;
  const timelineWidth = totalDays * dayWidth;

  // Generate ticks
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let d = 0; d <= totalDays; d += tickInterval) {
      arr.push(d);
    }
    return arr;
  }, [totalDays, tickInterval]);

  // Sort phases by category then start
  const sortedPhases = useMemo(() => {
    const categoryOrder: PhaseCategory[] = ["etude", "admin", "financement", "travaux", "commercialisation", "vente"];
    return [...displayPhases].sort((a, b) => {
      const catA = categoryOrder.indexOf(a.category);
      const catB = categoryOrder.indexOf(b.category);
      if (catA !== catB) return catA - catB;
      return a.startDay - b.startDay;
    });
  }, [displayPhases]);

  // Format tick label
  const formatTick = (day: number): string => {
    if (startDate && unit === "day") {
      const d = new Date(startDate);
      d.setDate(d.getDate() + day - 1);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    }
    if (unit === "week") {
      return `S${Math.ceil(day / 7)}`;
    }
    return `J${day}`;
  };

  // Handlers
  const handleModeToggle = (m: "auto" | "manuel") => {
    onModeChange?.(m);
  };

  const handleCopyToManual = () => {
    const copied = autoPhases.map((p) => ({ ...p, id: mkPhaseId() }));
    onChange(copied);
    onModeChange?.("manuel");
  };

  const handleUpdatePhase = (id: string, patch: Partial<TimelinePhase>) => {
    onChange(phases.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handleRemovePhase = (id: string) => {
    onChange(phases.filter((p) => p.id !== id));
  };

  const handleAddPhase = () => {
    const newPhase: TimelinePhase = {
      id: mkPhaseId(),
      name: "Nouvelle phase",
      category: "admin",
      startDay: 1,
      durationDays: 5,
    };
    onChange([...phases, newPhase]);
  };

  // Excel export
  const handleExport = async () => {
    try {
      const { exportTimelineToXlsx } = await import("../utils/timelineExcel");
      exportTimelineToXlsx(displayPhases, { context: "planning" });
    } catch (err) {
      console.error("Export failed:", err);
      alert("Erreur lors de l'export. Vérifiez que xlsx est installé.");
    }
  };

  // Excel import
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const { importTimelineFromXlsx } = await import("../utils/timelineExcel");
      const imported = await importTimelineFromXlsx(file);
      if (imported.length > 0) {
        onChange(imported);
        onModeChange?.("manuel");
      } else {
        alert("Aucune phase valide trouvée dans le fichier.");
      }
    } catch (err) {
      console.error("Import failed:", err);
      alert("Erreur lors de l'import. Vérifiez le format du fichier.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.65)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(15, 23, 42, 0.08)",
        borderRadius: 20,
        padding: 20,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: "#0f172a" }}>{title}</h3>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>
              <Settings2 size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              {totalDays}j
            </div>
          </div>
          {subtitle && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{subtitle}</div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {/* Mode toggle */}
          {onModeChange && (
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                onClick={() => handleModeToggle("auto")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: mode === "auto" ? "1.5px solid rgba(59, 130, 246, 0.5)" : "1px solid rgba(15, 23, 42, 0.10)",
                  background: mode === "auto" ? "rgba(59, 130, 246, 0.08)" : "rgba(15, 23, 42, 0.02)",
                  color: mode === "auto" ? "#1d4ed8" : "#64748b",
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <Zap size={12} />
                Auto
              </button>
              <button
                type="button"
                onClick={() => handleModeToggle("manuel")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: mode === "manuel" ? "1.5px solid rgba(139, 92, 246, 0.5)" : "1px solid rgba(15, 23, 42, 0.10)",
                  background: mode === "manuel" ? "rgba(139, 92, 246, 0.08)" : "rgba(15, 23, 42, 0.02)",
                  color: mode === "manuel" ? "#6d28d9" : "#64748b",
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <Pencil size={12} />
                Manuel
              </button>
            </div>
          )}

          {/* Copy to manual (when auto) */}
          {mode === "auto" && autoPhases.length > 0 && (
            <ActionButton
              onClick={handleCopyToManual}
              icon={<Copy size={14} />}
              label="Copier vers manuel"
              variant="primary"
            />
          )}

          {/* Export */}
          {allowExport && (
            <ActionButton
              onClick={handleExport}
              icon={<Download size={14} />}
              label="Excel"
              variant="success"
            />
          )}

          {/* Import */}
          {allowImport && mode === "manuel" && (
            <>
              <ActionButton
                onClick={handleImportClick}
                icon={<Upload size={14} />}
                label={importing ? "..." : "Importer"}
                disabled={importing}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {CATEGORY_OPTIONS.map((cat) => {
          const style = CATEGORY_STYLES[cat.value];
          return (
            <div
              key={cat.value}
              style={{
                padding: "4px 9px",
                borderRadius: 7,
                background: style.bg,
                border: `1px solid ${style.border}`,
                color: style.color,
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {style.label}
            </div>
          );
        })}
      </div>

      {/* Timeline visualization */}
      <div
        style={{
          overflowX: "auto",
          border: "1px solid rgba(15, 23, 42, 0.06)",
          borderRadius: 12,
          background: "rgba(255, 255, 255, 0.5)",
        }}
      >
        <div style={{ minWidth: timelineWidth + 40, padding: "14px 18px" }}>
          {/* Day ruler */}
          <div style={{ position: "relative", height: 24, marginBottom: 6, borderBottom: "1px solid rgba(15, 23, 42, 0.05)" }}>
            {ticks.map((d) => (
              <div
                key={d}
                style={{
                  position: "absolute",
                  left: d * dayWidth,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8" }}>{formatTick(d)}</div>
                <div style={{ width: 1, height: 6, background: "rgba(15, 23, 42, 0.10)", marginTop: 2 }} />
              </div>
            ))}
          </div>

          {/* Phase bars */}
          <div style={{ position: "relative", minHeight: sortedPhases.length * 38 + 8 }}>
            {/* Grid lines */}
            {ticks.map((d) => (
              <div
                key={`grid-${d}`}
                style={{
                  position: "absolute",
                  left: d * dayWidth,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: d % (tickInterval * 2) === 0 ? "rgba(15, 23, 42, 0.06)" : "rgba(15, 23, 42, 0.03)",
                  pointerEvents: "none",
                }}
              />
            ))}

            {sortedPhases.map((phase, idx) => {
              const style = CATEGORY_STYLES[phase.category];
              const left = (phase.startDay - 1) * dayWidth;
              const width = Math.max(phase.durationDays * dayWidth - 3, 36);

              return (
                <div
                  key={phase.id}
                  style={{
                    position: "absolute",
                    top: idx * 38 + 3,
                    left,
                    width,
                    height: 32,
                    background: style.bg,
                    border: `1.5px solid ${style.border}`,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 9px",
                    overflow: "hidden",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: style.color,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {phase.name}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: style.color, opacity: 0.7, marginLeft: 5, whiteSpace: "nowrap" }}>
                    {phase.durationDays}j
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Manual editing section */}
      {mode === "manuel" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Éditer les phases</div>
            <ActionButton
              onClick={handleAddPhase}
              icon={<Plus size={14} />}
              label="Ajouter"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {phases.map((phase) => {
              const style = CATEGORY_STYLES[phase.category];
              return (
                <div
                  key={phase.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 11,
                    background: "rgba(255, 255, 255, 0.75)",
                    border: `1px solid ${style.border}`,
                    flexWrap: "wrap",
                  }}
                >
                  {/* Name */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", minWidth: 120 }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>Nom</div>
                    <input
                      type="text"
                      value={phase.name}
                      onChange={(e) => handleUpdatePhase(phase.id, { name: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "5px 7px",
                        borderRadius: 7,
                        border: "1px solid rgba(15, 23, 42, 0.10)",
                        background: "rgba(255,255,255,0.95)",
                        fontWeight: 700,
                        fontSize: 11,
                        color: "#0f172a",
                        outline: "none",
                      }}
                    />
                  </div>

                  {/* Category */}
                  <SelectCompact
                    label="Catégorie"
                    value={phase.category}
                    onChange={(v) => handleUpdatePhase(phase.id, { category: v as PhaseCategory })}
                    options={CATEGORY_OPTIONS}
                    width={115}
                  />

                  {/* Start */}
                  <FieldCompact
                    label="Début"
                    value={phase.startDay}
                    onChange={(v) => handleUpdatePhase(phase.id, { startDay: Math.max(1, v) })}
                    suffix="J"
                    min={1}
                    width={55}
                  />

                  {/* Duration */}
                  <FieldCompact
                    label="Durée"
                    value={phase.durationDays}
                    onChange={(v) => handleUpdatePhase(phase.id, { durationDays: Math.max(1, v) })}
                    suffix="j"
                    min={1}
                    width={55}
                  />

                  {/* Notes (optional small input) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 100px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>Notes</div>
                    <input
                      type="text"
                      value={phase.notes || ""}
                      onChange={(e) => handleUpdatePhase(phase.id, { notes: e.target.value })}
                      placeholder="..."
                      style={{
                        width: "100%",
                        padding: "5px 7px",
                        borderRadius: 7,
                        border: "1px solid rgba(15, 23, 42, 0.08)",
                        background: "rgba(255,255,255,0.9)",
                        fontWeight: 600,
                        fontSize: 10,
                        color: "#64748b",
                        outline: "none",
                      }}
                    />
                  </div>

                  {/* Delete */}
                  <div style={{ marginTop: 16 }}>
                    <IconButton
                      onClick={() => handleRemovePhase(phase.id)}
                      title="Supprimer"
                      icon={<Trash2 size={13} />}
                      variant="danger"
                    />
                  </div>
                </div>
              );
            })}

            {phases.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                Aucune phase. Cliquez sur "Ajouter" pour commencer.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}