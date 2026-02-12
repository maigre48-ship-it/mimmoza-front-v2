// ============================================================================
// BudgetSection.tsx — Projet & Budget unifié
// Fusionne les anciens blocs "Données du projet" + "Budget du projet"
// Props :
//   value / onChange          → dossier.analyse.budget (coûts, taux…)
//   project / onProjectChange → champs projet (nom, typePret, montant, durée, notes)
// ============================================================================

import { useCallback } from "react";

// ── Types ──

interface BudgetData {
  coutAcquisition?: number;
  coutTravaux?: number;
  frais?: number;
  apportPersonnel?: number;
  rateAnnualPct?: number;
  [key: string]: unknown;
}

export interface ProjectFields {
  nom: string;
  typePret: string;
  montantDemande: number | "";
  duree: number | "";
  notes: string;
}

interface Props {
  value: BudgetData;
  onChange: (next: BudgetData) => void;
  project?: ProjectFields;
  onProjectChange?: (next: ProjectFields) => void;
}

const PRET_TYPES = [
  { value: "promotion",       label: "Promotion immobilière" },
  { value: "logement",        label: "Logement" },
  { value: "marchand",        label: "Marchand de biens" },
  { value: "investissement",  label: "Investissement locatif" },
  { value: "rehabilitation",  label: "Réhabilitation" },
  { value: "autre",           label: "Autre" },
];

// ── Component ──

export default function BudgetSection({ value, onChange, project, onProjectChange }: Props) {
  const patchBudget = useCallback(
    (key: string, raw: string) => {
      const v = raw === "" ? undefined : Number(raw);
      onChange({ ...value, [key]: v });
    },
    [value, onChange]
  );

  const patchProject = useCallback(
    (key: keyof ProjectFields, v: unknown) => {
      if (!project || !onProjectChange) return;
      onProjectChange({ ...project, [key]: v });
    },
    [project, onProjectChange]
  );

  const total =
    (value.coutAcquisition ?? 0) +
    (value.coutTravaux ?? 0) +
    (value.frais ?? 0);

  return (
    <div className="space-y-5">
      {/* ════════════════════════════════════════════
          Bloc 1 : Données du projet
         ════════════════════════════════════════════ */}
      {project && onProjectChange && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Données du projet</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nom du projet</label>
              <input
                type="text"
                value={project.nom}
                onChange={(e) => patchProject("nom", e.target.value)}
                placeholder="Résidence Les Tilleuls"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type de prêt</label>
              <select
                value={project.typePret}
                onChange={(e) => patchProject("typePret", e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                {PRET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Montant demandé (€)</label>
              <input
                type="number"
                value={project.montantDemande === "" ? "" : String(project.montantDemande)}
                onChange={(e) => patchProject("montantDemande", e.target.value ? Number(e.target.value) : "")}
                placeholder="5 000 000"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Durée (mois)</label>
              <input
                type="number"
                value={project.duree === "" ? "" : String(project.duree)}
                onChange={(e) => patchProject("duree", e.target.value ? Number(e.target.value) : "")}
                placeholder="24"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea
              value={project.notes}
              onChange={(e) => patchProject("notes", e.target.value)}
              rows={3}
              placeholder="Contexte, historique, éléments clés…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          Bloc 2 : Budget du projet
         ════════════════════════════════════════════ */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Budget du projet</h3>
          {total > 0 && (
            <span className="text-xs font-medium text-slate-500">
              Coût total : {total.toLocaleString("fr-FR")} €
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <NumField
            label="Coût d'acquisition (€)"
            value={value.coutAcquisition}
            onChange={(v) => patchBudget("coutAcquisition", v)}
            placeholder="1 500 000"
          />
          <NumField
            label="Coût travaux (€)"
            value={value.coutTravaux}
            onChange={(v) => patchBudget("coutTravaux", v)}
            placeholder="500 000"
          />
          <NumField
            label="Frais annexes (€)"
            value={value.frais}
            onChange={(v) => patchBudget("frais", v)}
            placeholder="80 000"
          />
          <NumField
            label="Apport personnel (€)"
            value={value.apportPersonnel}
            onChange={(v) => patchBudget("apportPersonnel", v)}
            placeholder="300 000"
          />
        </div>

        {/* ── Taux annuel ── */}
        <div className="border-t border-slate-100 pt-4">
          <div className="max-w-xs">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Taux annuel (%)
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min={0}
                max={30}
                value={value.rateAnnualPct ?? ""}
                onChange={(e) => patchBudget("rateAnnualPct", e.target.value)}
                placeholder="3.50"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Utilisé pour le calcul de la mensualité et des ratios. Par défaut : 3,50 %
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Internal number field ──

function NumField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: number;
  onChange: (raw: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      />
    </div>
  );
}