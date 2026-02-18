// src/spaces/marchand/questionnaire/QuestionnaireEngine.tsx

import React, { useMemo, useState } from "react";
import type { InvestisseurSnapshot } from "../store/investisseurSnapshot.store";
import {
  questionnaireSchema,
  STEP_LABELS,
  getNestedValue,
  setNestedValue,
  isQuestionVisible,
  filterByMode,
  countMissingForStep,
  validateSnapshot,
  type QuestionDef,
  type QuestionnaireMode,
  type ValidationWarning,
  type ValidationSeverity,
} from "./questionnaireSchema";

// ─── Props ───────────────────────────────────────────────────────────

interface QuestionnaireEngineProps {
  snapshot: InvestisseurSnapshot;
  currentStep: number;
  onChangeStep: (step: number) => void;
  onUpdateSnapshot: (updated: InvestisseurSnapshot) => void;
  /** Optional: controlled mode from parent. If not provided, internal state is used */
  mode?: QuestionnaireMode;
  onChangeMode?: (mode: QuestionnaireMode) => void;
}

// ─── Severity helpers ────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  ValidationSeverity,
  { icon: string; bg: string; border: string; text: string }
> = {
  blocking: {
    icon: "🚫",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
  },
  warning: {
    icon: "⚠️",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
  info: {
    icon: "ℹ️",
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-600",
  },
};

// ─── Component ───────────────────────────────────────────────────────

export default function QuestionnaireEngine({
  snapshot,
  currentStep,
  onChangeStep,
  onUpdateSnapshot,
  mode: controlledMode,
  onChangeMode,
}: QuestionnaireEngineProps) {
  const [internalMode, setInternalMode] = useState<QuestionnaireMode>("deep");
  const mode = controlledMode ?? internalMode;
  const setMode = onChangeMode ?? setInternalMode;

  // Validation warnings
  const validationWarnings = useMemo(
    () => validateSnapshot(snapshot),
    [snapshot]
  );

  // Warnings relevant to current step
  const currentStepWarnings = useMemo(() => {
    const currentStepPaths = new Set<string>();
    for (const section of questionnaireSchema) {
      if (section.stepIndex !== currentStep) continue;
      for (const q of section.questions) {
        currentStepPaths.add(q.path);
      }
    }
    return validationWarnings.filter((w) =>
      w.relatedFields.some((f) => currentStepPaths.has(f))
    );
  }, [validationWarnings, currentStep]);

  // Sections for current step: filtered by mode, sorted by weightImpact DESC
  const visibleSections = useMemo(() => {
    return questionnaireSchema
      .filter((s) => s.stepIndex === currentStep)
      .map((section) => ({
        ...section,
        questions: filterByMode(section.questions, mode)
          .filter((q) => isQuestionVisible(q, snapshot))
          .sort((a, b) => {
            // Required empty fields first, then by weightImpact DESC
            const aEmpty = isFieldEmpty(getNestedValue(snapshot, a.path));
            const bEmpty = isFieldEmpty(getNestedValue(snapshot, b.path));
            const aRequiredEmpty = a.required && aEmpty;
            const bRequiredEmpty = b.required && bEmpty;
            if (aRequiredEmpty && !bRequiredEmpty) return -1;
            if (bRequiredEmpty && !aRequiredEmpty) return 1;
            return b.weightImpact - a.weightImpact;
          }),
      }))
      .filter((s) => s.questions.length > 0);
  }, [currentStep, snapshot, mode]);

  const handleFieldChange = (q: QuestionDef, rawValue: string) => {
    let value: any = rawValue;
    if (q.type === "number") {
      value = rawValue === "" ? undefined : parseFloat(rawValue);
      if (typeof value === "number" && isNaN(value)) value = undefined;
    }
    if (q.type === "select" && rawValue === "") value = undefined;
    const updated = setNestedValue(
      snapshot,
      q.path,
      value
    ) as InvestisseurSnapshot;
    // Clear smartscore on any change
    updated.smartscore = undefined;
    onUpdateSnapshot(updated);
  };

  const blockingCount = validationWarnings.filter(
    (w) => w.severity === "blocking"
  ).length;
  const warningCount = validationWarnings.filter(
    (w) => w.severity === "warning"
  ).length;

  return (
    <div className="space-y-4">
      {/* ── Top bar: Mode toggle + global warning badge ── */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <ModeToggle mode={mode} onChange={setMode} />
        {(blockingCount > 0 || warningCount > 0) && (
          <div className="flex items-center gap-2 text-xs">
            {blockingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                🚫 {blockingCount} bloquant{blockingCount > 1 ? "s" : ""}
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                ⚠️ {warningCount} alerte{warningCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Stepper ── */}
      <div className="flex items-center gap-1 mb-6">
        {STEP_LABELS.map((label, idx) => {
          const isActive = idx === currentStep;
          const isCompleted = idx < currentStep;
          const missingCount =
            idx < 3 ? countMissingForStep(idx, snapshot, mode) : 0;

          return (
            <React.Fragment key={idx}>
              {idx > 0 && (
                <div
                  className={`flex-1 h-0.5 ${
                    isCompleted ? "bg-indigo-500" : "bg-gray-200"
                  }`}
                />
              )}
              <button
                onClick={() => idx < 3 && onChangeStep(idx)}
                disabled={idx === 3}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all
                  ${isActive ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" : ""}
                  ${isCompleted ? "text-indigo-600" : ""}
                  ${!isActive && !isCompleted ? "text-gray-400" : ""}
                  ${idx === 3 ? "cursor-default" : "cursor-pointer hover:bg-gray-50"}
                `}
              >
                <span
                  className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${isActive ? "bg-indigo-600 text-white" : ""}
                    ${isCompleted ? "bg-indigo-100 text-indigo-700" : ""}
                    ${!isActive && !isCompleted ? "bg-gray-100 text-gray-400" : ""}
                  `}
                >
                  {isCompleted ? "✓" : idx + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
                {missingCount > 0 && idx < 3 && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                    {missingCount}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Validation warnings for current step ── */}
      {currentStepWarnings.length > 0 && (
        <div className="space-y-2">
          {currentStepWarnings.map((w) => {
            const cfg = SEVERITY_CONFIG[w.severity];
            return (
              <div
                key={w.key}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${cfg.bg} ${cfg.border} ${cfg.text}`}
              >
                <span className="mt-0.5 shrink-0">{cfg.icon}</span>
                <div>
                  <span className="font-semibold">{w.label}</span>
                  <span className="mx-1">—</span>
                  <span>{w.message}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sections ── */}
      {visibleSections.map((section) => (
        <div
          key={section.id}
          className="bg-white border border-gray-100 rounded-xl p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span>{section.icon}</span>
            {section.title}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {section.questions.map((q) => {
              // Find any warnings related to this field
              const fieldWarnings = validationWarnings.filter((w) =>
                w.relatedFields.includes(q.path)
              );
              return (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={getNestedValue(snapshot, q.path)}
                  onChange={(val) => handleFieldChange(q, val)}
                  warnings={fieldWarnings}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Navigation ── */}
      <div className="flex justify-between pt-2">
        <button
          onClick={() => onChangeStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${
              currentStep === 0
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-600 hover:bg-gray-100"
            }
          `}
        >
          ← Précédent
        </button>
        {currentStep < 2 && (
          <button
            onClick={() => onChangeStep(currentStep + 1)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Suivant →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ModeToggle ──────────────────────────────────────────────────────

function ModeToggle({
  mode,
  onChange,
}: {
  mode: QuestionnaireMode;
  onChange: (m: QuestionnaireMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium">
      <button
        onClick={() => onChange("fast")}
        className={`
          px-3 py-1.5 rounded-md transition-all
          ${
            mode === "fast"
              ? "bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-200"
              : "text-gray-500 hover:text-gray-700"
          }
        `}
      >
        ⚡ Rapide
      </button>
      <button
        onClick={() => onChange("deep")}
        className={`
          px-3 py-1.5 rounded-md transition-all
          ${
            mode === "deep"
              ? "bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-200"
              : "text-gray-500 hover:text-gray-700"
          }
        `}
      >
        🔍 Complet
      </button>
    </div>
  );
}

// ─── QuestionField ───────────────────────────────────────────────────

function QuestionField({
  question: q,
  value,
  onChange,
  warnings,
}: {
  question: QuestionDef;
  value: any;
  onChange: (val: string) => void;
  warnings: ValidationWarning[];
}) {
  const isEmpty = isFieldEmpty(value);
  const displayValue =
    value === undefined || value === null ? "" : String(value);

  const hasBlockingWarning = warnings.some((w) => w.severity === "blocking");
  const hasWarning = warnings.some((w) => w.severity === "warning");

  const baseInputClass =
    "w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400";

  let borderClass = "border-gray-200 bg-white";
  if (hasBlockingWarning) {
    borderClass = "border-red-300 bg-red-50/30";
  } else if (hasWarning) {
    borderClass = "border-amber-300 bg-amber-50/30";
  } else if (q.required && isEmpty) {
    borderClass = "border-amber-300 bg-amber-50/30";
  }

  const isFullWidth = q.type === "textarea";

  // Priority badge color
  const priorityBadge =
    q.priority === "critical" ? (
      <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded ml-1.5 font-normal">
        clé
      </span>
    ) : null;

  return (
    <div className={isFullWidth ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {q.label}
        {q.required && <span className="text-red-400 ml-0.5">*</span>}
        {q.unit && (
          <span className="text-gray-400 font-normal ml-1">({q.unit})</span>
        )}
        {priorityBadge}
      </label>

      {q.type === "select" ? (
        <select
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          className={`${baseInputClass} ${borderClass}`}
        >
          <option value="">— Choisir —</option>
          {q.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : q.type === "textarea" ? (
        <textarea
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder}
          rows={4}
          className={`${baseInputClass} ${borderClass} resize-y`}
        />
      ) : (
        <input
          type={q.type === "number" ? "number" : "text"}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder}
          step={q.type === "number" ? "any" : undefined}
          className={`${baseInputClass} ${borderClass}`}
        />
      )}

      {/* Inline warning hint on the field */}
      {warnings.length > 0 && (
        <p
          className={`mt-1 text-[11px] ${
            hasBlockingWarning ? "text-red-600" : "text-amber-600"
          }`}
        >
          {warnings[0].message}
        </p>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isFieldEmpty(value: any): boolean {
  return value === undefined || value === null || value === "";
}