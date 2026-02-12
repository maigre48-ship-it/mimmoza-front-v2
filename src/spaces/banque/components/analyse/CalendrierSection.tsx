// ============================================================================
// CalendrierSection.tsx — Calendrier du projet
// Stocke dans dossier.analyse.calendrier :
//   calendrier.acquisitionDate  (ISO string)
//   calendrier.worksMonths      (number)
//   calendrier.startWorksDate   (ISO string, optionnel)
// ============================================================================

import { useCallback } from "react";

interface CalendrierData {
  acquisitionDate?: string;
  worksMonths?: number;
  startWorksDate?: string;
  // Legacy compat
  [key: string]: unknown;
}

interface Props {
  value: CalendrierData;
  onChange: (next: CalendrierData) => void;
}

export default function CalendrierSection({ value, onChange }: Props) {
  const patch = useCallback(
    (key: string, v: unknown) => {
      onChange({ ...value, [key]: v });
    },
    [value, onChange]
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Calendrier du projet</h3>

      <div className="grid grid-cols-3 gap-4">
        {/* Date d'acquisition */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Date prévue d'acquisition
          </label>
          <input
            type="date"
            value={value.acquisitionDate ?? ""}
            onChange={(e) => patch("acquisitionDate", e.target.value || undefined)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>

        {/* Date début travaux */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Date début travaux
          </label>
          <input
            type="date"
            value={value.startWorksDate ?? ""}
            onChange={(e) => patch("startWorksDate", e.target.value || undefined)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>

        {/* Durée travaux */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Durée travaux (mois)
          </label>
          <input
            type="number"
            min={0}
            max={120}
            value={value.worksMonths ?? ""}
            onChange={(e) =>
              patch("worksMonths", e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="12"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
      </div>

      {/* Résumé dynamique */}
      {value.acquisitionDate && value.worksMonths && (
        <p className="text-xs text-slate-500">
          Fin estimée des travaux :{" "}
          <span className="font-medium text-slate-700">
            {(() => {
              const start = new Date(value.startWorksDate || value.acquisitionDate);
              start.setMonth(start.getMonth() + (value.worksMonths ?? 0));
              return start.toLocaleDateString("fr-FR", {
                month: "long",
                year: "numeric",
              });
            })()}
          </span>
        </p>
      )}
    </div>
  );
}