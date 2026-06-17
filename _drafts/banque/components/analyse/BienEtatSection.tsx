// ============================================================================
// BienEtatSection.tsx — Typologie du bien, état général & valeur estimée
// Stocke dans dossier.analyse.bien :
//   bien.ageCategory   = "neuf" | "recent" | "ancien"
//   bien.condition      = "bon" | "moyen" | "mauvais"
//   bien.valeurEstimee  = number (€) — utilisé pour le calcul du LTV
// ============================================================================

import { useCallback } from "react";

type AgeCategory = "neuf" | "recent" | "ancien";
type Condition = "bon" | "moyen" | "mauvais";

interface BienData {
  ageCategory?: AgeCategory;
  condition?: Condition;
  valeurEstimee?: number;
  [key: string]: unknown;
}

interface Props {
  value: BienData;
  onChange: (next: BienData) => void;
}

const AGE_OPTIONS: { value: AgeCategory; label: string; desc: string }[] = [
  { value: "neuf",    label: "Neuf",              desc: "VEFA ou livré < 2 ans" },
  { value: "recent",  label: "Récent (< 10 ans)", desc: "Construction de moins de 10 ans" },
  { value: "ancien",  label: "Ancien (> 10 ans)", desc: "Construction de plus de 10 ans" },
];

const CONDITION_OPTIONS: { value: Condition; label: string; color: string }[] = [
  { value: "bon",     label: "Bon",     color: "border-green-500 bg-green-50 text-green-800" },
  { value: "moyen",   label: "Moyen",   color: "border-amber-500 bg-amber-50 text-amber-800" },
  { value: "mauvais", label: "Mauvais", color: "border-red-500 bg-red-50 text-red-800" },
];

export default function BienEtatSection({ value, onChange }: Props) {
  const patch = useCallback(
    (key: string, v: unknown) => {
      onChange({ ...value, [key]: v });
    },
    [value, onChange]
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
      <h3 className="text-sm font-semibold text-slate-700">Bien &amp; État</h3>

      {/* ── Typologie / Ancienneté ── */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">
          Typologie du bien
        </label>
        <div className="flex gap-2">
          {AGE_OPTIONS.map((opt) => {
            const active = value.ageCategory === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => patch("ageCategory", opt.value)}
                title={opt.desc}
                className={[
                  "flex-1 rounded-lg border-2 px-3 py-2.5 text-sm font-medium text-center transition-all duration-150",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:border-slate-400",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── État général ── */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">
          État général du bien
        </label>
        <div className="flex gap-2">
          {CONDITION_OPTIONS.map((opt) => {
            const active = value.condition === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => patch("condition", opt.value)}
                className={[
                  "flex-1 rounded-lg border-2 px-3 py-2.5 text-sm font-medium text-center transition-all duration-150",
                  active
                    ? `${opt.color} border-current`
                    : "border-slate-200 text-slate-600 hover:border-slate-400",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Valeur estimée du bien ── */}
      <div className="border-t border-slate-100 pt-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Valeur estimée du bien (€)
        </label>
        <input
          type="number"
          min={0}
          value={value.valeurEstimee ?? ""}
          onChange={(e) =>
            patch("valeurEstimee", e.target.value ? Number(e.target.value) : undefined)
          }
          placeholder="1 200 000"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          Valeur de marché ou valeur d'expertise — utilisée pour le calcul du LTV.
        </p>
      </div>
    </div>
  );
}