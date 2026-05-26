// src/spaces/admin/pages/Tarifs.tsx
// ─── Gestion des tarifs Mimmoza ───────────────────────────────────────────────
// • Tableau éditable par espace / offre
// • Stockage dans localStorage["mimmoza.pricing"]
// • Tarifs par défaut si clé absente
// • AbonnementPage lit cette clé pour afficher les prix
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import {
  BadgeEuro,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  RotateCcw,
  Save,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PricingEntry = {
  planKey: string;
  space: "investisseur" | "promoteur" | "rehabilitation" | "apporteur";
  title: string;
  badge: string;
  price: string;
  unit: string;
  quota: number;
  active: boolean;
};

// ── Tarifs par défaut (miroir exact de AbonnementPage) ────────────────────────

export const DEFAULT_PRICING: PricingEntry[] = [
  // ── Investisseur ────────────────────────────────────────────────────────
  {
    planKey: "tokens-10", space: "investisseur",
    badge: "Jetons", title: "10 analyses",
    price: "9,90€ HT", unit: "", quota: 10, active: true,
  },
  {
    planKey: "tokens-20", space: "investisseur",
    badge: "Jetons", title: "20 analyses",
    price: "16,90€ HT", unit: "", quota: 20, active: true,
  },
  {
    planKey: "starter", space: "investisseur",
    badge: "Abonnement", title: "Starter",
    price: "39,90€ HT", unit: "/mois", quota: 50, active: true,
  },
  {
    planKey: "pro", space: "investisseur",
    badge: "Abonnement", title: "Pro",
    price: "74,99€ HT", unit: "/mois", quota: 200, active: true,
  },
  {
    planKey: "recharge-25", space: "investisseur",
    badge: "Recharge", title: "Recharge 25 analyses",
    price: "19,90€ HT", unit: "", quota: 25, active: true,
  },
  {
    planKey: "recharge-50", space: "investisseur",
    badge: "Recharge", title: "Recharge 50 analyses",
    price: "34,90€ HT", unit: "", quota: 50, active: true,
  },
  // ── Promoteur ───────────────────────────────────────────────────────────
  {
    planKey: "promoteur-starter", space: "promoteur",
    badge: "Promoteur", title: "Starter",
    price: "dès 149€", unit: "/mois", quota: 0, active: true,
  },
  {
    planKey: "promoteur-pro", space: "promoteur",
    badge: "Promoteur", title: "Pro",
    price: "dès 299€", unit: "/mois", quota: 0, active: true,
  },
  {
    planKey: "promoteur-enterprise", space: "promoteur",
    badge: "Entreprise", title: "Sur devis",
    price: "Personnalisé", unit: "", quota: 0, active: true,
  },
  // ── Réhabilitation ──────────────────────────────────────────────────────
  {
    planKey: "rehabilitation-starter", space: "rehabilitation",
    badge: "Réhabilitation", title: "Starter",
    price: "dès 149€", unit: "/mois", quota: 0, active: true,
  },
  {
    planKey: "rehabilitation-pro", space: "rehabilitation",
    badge: "Réhabilitation", title: "Pro",
    price: "dès 299€", unit: "/mois", quota: 0, active: true,
  },
  {
    planKey: "rehabilitation-enterprise", space: "rehabilitation",
    badge: "Entreprise", title: "Sur devis",
    price: "Personnalisé", unit: "", quota: 0, active: true,
  },
  // ── Apporteur ───────────────────────────────────────────────────────────
  {
    planKey: "apporteur-free", space: "apporteur",
    badge: "Apporteur", title: "Accès gratuit",
    price: "0€", unit: "", quota: 0, active: true,
  },
  {
    planKey: "apporteur-commission", space: "apporteur",
    badge: "Commission", title: "Rémunération",
    price: "À la commission", unit: "", quota: 0, active: true,
  },
  {
    planKey: "apporteur-partenariat", space: "apporteur",
    badge: "Réseau", title: "Partenariat",
    price: "Sur devis", unit: "", quota: 0, active: true,
  },
];

const STORAGE_KEY = "mimmoza.pricing";

const SPACE_LABELS: Record<PricingEntry["space"], string> = {
  investisseur:   "Investisseur",
  promoteur:      "Promoteur",
  rehabilitation: "Réhabilitation",
  apporteur:      "Apporteur",
};

const SPACE_ORDER: PricingEntry["space"][] = [
  "investisseur", "promoteur", "rehabilitation", "apporteur",
];

const SPACE_COLORS: Record<PricingEntry["space"], string> = {
  investisseur:   "bg-sky-100 text-sky-700 border-sky-200",
  promoteur:      "bg-indigo-100 text-indigo-700 border-indigo-200",
  rehabilitation: "bg-teal-100 text-teal-700 border-teal-200",
  apporteur:      "bg-orange-100 text-orange-700 border-orange-200",
};

// ── Helpers localStorage ──────────────────────────────────────────────────────

export function loadPricing(): PricingEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRICING;
    const parsed = JSON.parse(raw) as PricingEntry[];
    // Merge : on garde les entrées par défaut non présentes dans le storage
    const keys = new Set(parsed.map((e) => e.planKey));
    const missing = DEFAULT_PRICING.filter((e) => !keys.has(e.planKey));
    return [...parsed, ...missing];
  } catch {
    return DEFAULT_PRICING;
  }
}

function savePricingToStorage(entries: PricingEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ── Composants ────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 shadow-lg">
      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      <span className="text-sm font-medium text-emerald-800">{message}</span>
    </div>
  );
}

type EditableField = "title" | "badge" | "price" | "unit" | "quota";

function EditableCell({
  value,
  type = "text",
  onChange,
  className = "",
}: {
  value: string | number;
  type?: "text" | "number";
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={[
        "w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-slate-900 outline-none",
        "transition hover:border-slate-200 hover:bg-slate-50 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100",
        className,
      ].join(" ")}
    />
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminTarifsPage() {
  const [entries, setEntries]         = useState<PricingEntry[]>(() => loadPricing());
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set());
  const [toast, setToast]             = useState<string | null>(null);
  const [dirty, setDirty]             = useState(false);

  function update(planKey: string, field: EditableField | "active", value: string | number | boolean) {
    setEntries((prev) =>
      prev.map((e) => (e.planKey === planKey ? { ...e, [field]: value } : e))
    );
    setDirty(true);
  }

  function handleSave() {
    savePricingToStorage(entries);
    setDirty(false);
    setToast("Tarifs enregistrés — /abonnement est mis à jour.");
  }

  function handleReset() {
    if (!confirm("Remettre tous les tarifs par défaut ?")) return;
    setEntries(DEFAULT_PRICING);
    savePricingToStorage(DEFAULT_PRICING);
    setToast("Tarifs réinitialisés.");
    setDirty(false);
  }

  function toggleCollapse(space: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(space) ? next.delete(space) : next.add(space);
      return next;
    });
  }

  const bySpace = SPACE_ORDER.map((space) => ({
    space,
    items: entries.filter((e) => e.space === space),
  }));

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
              <BadgeEuro className="h-3.5 w-3.5 text-indigo-500" />
              Espace administrateur
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              Gestion des tarifs
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Modifiez les tarifs affichés sur{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
                /abonnement
              </code>
              . Les modifications sont enregistrées dans{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
                localStorage
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Défauts
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={[
                "inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-medium text-white shadow-sm transition",
                dirty
                  ? "bg-indigo-600 hover:bg-indigo-500"
                  : "bg-slate-300 cursor-default",
              ].join(" ")}
              disabled={!dirty}
            >
              <Save className="h-4 w-4" />
              Enregistrer
            </button>
          </div>
        </div>

        {dirty && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            Modifications non enregistrées — cliquez sur "Enregistrer" pour les appliquer.
          </div>
        )}
      </div>

      {/* ── Tableaux par espace ─────────────────────────────────────────────── */}
      {bySpace.map(({ space, items }) => {
        const isOpen = !collapsed.has(space);
        const colorCls = SPACE_COLORS[space];

        return (
          <div
            key={space}
            className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm"
          >
            {/* Section header */}
            <button
              type="button"
              onClick={() => toggleCollapse(space)}
              className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-slate-50/60 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-xl border px-3 py-1 text-xs font-semibold ${colorCls}`}
                >
                  {SPACE_LABELS[space]}
                </span>
                <span className="text-sm text-slate-400">{items.length} offre(s)</span>
              </div>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
            </button>

            {isOpen && (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-slate-400">
                    <tr>
                      <th className="px-4 py-3 w-28">Plan Key</th>
                      <th className="px-4 py-3 w-28">Badge</th>
                      <th className="px-4 py-3">Titre</th>
                      <th className="px-4 py-3 w-36">Prix HT</th>
                      <th className="px-4 py-3 w-28">Unité</th>
                      <th className="px-4 py-3 w-24">Quota</th>
                      <th className="px-4 py-3 w-24 text-center">Actif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry, idx) => (
                      <tr
                        key={entry.planKey}
                        className={[
                          "border-t border-slate-100 align-middle transition-colors",
                          !entry.active ? "opacity-40" : "hover:bg-slate-50/40",
                          idx % 2 === 0 ? "" : "bg-slate-50/30",
                        ].join(" ")}
                      >
                        {/* planKey — non éditable, identifiant */}
                        <td className="px-4 py-2.5">
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                            {entry.planKey}
                          </code>
                        </td>

                        {/* badge */}
                        <td className="px-4 py-2.5">
                          <EditableCell
                            value={entry.badge}
                            onChange={(v) => update(entry.planKey, "badge", v)}
                          />
                        </td>

                        {/* title */}
                        <td className="px-4 py-2.5">
                          <EditableCell
                            value={entry.title}
                            onChange={(v) => update(entry.planKey, "title", v)}
                            className="font-medium"
                          />
                        </td>

                        {/* price */}
                        <td className="px-4 py-2.5">
                          <EditableCell
                            value={entry.price}
                            onChange={(v) => update(entry.planKey, "price", v)}
                          />
                        </td>

                        {/* unit */}
                        <td className="px-4 py-2.5">
                          <select
                            value={entry.unit}
                            onChange={(e) => update(entry.planKey, "unit", e.target.value)}
                            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-slate-700 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus:border-slate-300 focus:bg-white"
                          >
                            <option value="">—</option>
                            <option value="/mois">/mois</option>
                            <option value="/an">/an</option>
                            <option value="/analyse">/analyse</option>
                            <option value="sur devis">sur devis</option>
                          </select>
                        </td>

                        {/* quota */}
                        <td className="px-4 py-2.5">
                          <EditableCell
                            type="number"
                            value={entry.quota}
                            onChange={(v) => update(entry.planKey, "quota", parseInt(v, 10) || 0)}
                          />
                        </td>

                        {/* active toggle */}
                        <td className="px-4 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => update(entry.planKey, "active", !entry.active)}
                            className="inline-flex items-center justify-center rounded-lg p-1 transition hover:bg-slate-100"
                            title={entry.active ? "Désactiver" : "Activer"}
                          >
                            {entry.active ? (
                              <ToggleRight className="h-6 w-6 text-emerald-500" />
                            ) : (
                              <ToggleLeft className="h-6 w-6 text-slate-300" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Aide ───────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="text-xs leading-5 text-slate-500">
            <strong className="font-semibold text-slate-700">Comment ça marche</strong>{" "}
            — cliquez dans une cellule pour éditer. Le bouton{" "}
            <strong>Enregistrer</strong> écrit dans{" "}
            <code className="rounded bg-slate-200 px-1">localStorage["mimmoza.pricing"]</code>.
            La page <code className="rounded bg-slate-200 px-1">/abonnement</code> relit cette clé à chaque affichage.
            Le champ <strong>Quota</strong> est informatif (0 = illimité ou non applicable).
            Désactiver une offre la masque sur la page abonnement.
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}