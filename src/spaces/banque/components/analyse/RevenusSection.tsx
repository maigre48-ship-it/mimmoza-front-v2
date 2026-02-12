// ============================================================================
// RevenusSection.tsx — Revenus & charges de l'emprunteur
// Stocke dans dossier.analyse.revenus :
//   revenus.revenusMensuels   (€/mois) — revenus globaux de l'emprunteur
//   revenus.loyersMensuels    (€/mois) — loyers attendus (investissement locatif)
//   revenus.chargesExistantes (€/mois) — charges de dette existantes (hors ce prêt)
// ============================================================================

import { useCallback } from "react";

interface RevenusData {
  revenusMensuels?: number;
  loyersMensuels?: number;
  chargesExistantes?: number;
  [key: string]: unknown;
}

interface Props {
  value: RevenusData;
  onChange: (next: RevenusData) => void;
}

export default function RevenusSection({ value, onChange }: Props) {
  const patch = useCallback(
    (key: string, raw: string) => {
      const v = raw === "" ? undefined : Number(raw);
      onChange({ ...value, [key]: v });
    },
    [value, onChange]
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Revenus &amp; charges</h3>

      <div className="grid grid-cols-3 gap-4">
        {/* Revenus mensuels */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Revenus mensuels (€)
          </label>
          <input
            type="number"
            min={0}
            value={value.revenusMensuels ?? ""}
            onChange={(e) => patch("revenusMensuels", e.target.value)}
            placeholder="8 000"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Revenus nets de l'emprunteur — utilisé pour le DSTI
          </p>
        </div>

        {/* Loyers attendus */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Loyers mensuels attendus (€)
          </label>
          <input
            type="number"
            min={0}
            value={value.loyersMensuels ?? ""}
            onChange={(e) => patch("loyersMensuels", e.target.value)}
            placeholder="4 500"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Revenus locatifs projetés — utilisé pour le DSCR
          </p>
        </div>

        {/* Charges existantes */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Charges de dette existantes (€/mois)
          </label>
          <input
            type="number"
            min={0}
            value={value.chargesExistantes ?? ""}
            onChange={(e) => patch("chargesExistantes", e.target.value)}
            placeholder="1 200"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Crédits en cours (hors ce prêt) — utilisé pour le DSTI
          </p>
        </div>
      </div>
    </div>
  );
}