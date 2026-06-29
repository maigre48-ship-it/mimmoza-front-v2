// src/spaces/admin/pages/Tarifs.tsx
// ─── Gestion des tarifs Mimmoza ───────────────────────────────────────────────
// MODELE 2 : jetons (consommation IA) + abonnements d'acces (Promoteur/Rehab).
// • Espace unique "jetons" : packs achetables, unite unique partout.
// • Abonnements d'acces : forfait mensuel + quota de jetons inclus (expire 30j).
// • priceHT numerique → calcul automatique du €/jeton et de la marge.
// • Stockage dans localStorage["mimmoza.pricing"].
// ──────────────────────────────────────────────────────────────────────────────

import {
  BadgeEuro,
  Coins,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  RotateCcw,
  Save,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanKind = "token_pack" | "access_plan" | "custom";

export type PricingEntry = {
  planKey: string;
  space: "jetons" | "promoteur" | "rehabilitation" | "apporteur";
  kind: PlanKind;
  title: string;
  badge: string;
  priceHT: number;          // 0 = gratuit/sur devis ; sinon prix HT en euros
  unit: "" | "/mois";
  tokens: number;           // jetons inclus (pack ou abo) ; 0 si non applicable
  active: boolean;
};

// Cout reel mesure cote Anthropic (texte), en euros, pour le calcul de marge.
const COST_PER_TOKEN_EUR = 0.00358 * 0.92; // ≈ 0,0033 €

// ── Tarifs par defaut ─────────────────────────────────────────────────────────

export const DEFAULT_PRICING: PricingEntry[] = [
  // ── Jetons (grille unique de packs) ───────────────────────────────────────
  {
    planKey: "jetons-100", space: "jetons", kind: "token_pack",
    badge: "Jetons", title: "Pack 100 jetons",
    priceHT: 4, unit: "", tokens: 100, active: true,
  },
  {
    planKey: "jetons-500", space: "jetons", kind: "token_pack",
    badge: "Jetons", title: "Pack 500 jetons",
    priceHT: 18, unit: "", tokens: 500, active: true,
  },
  {
    planKey: "jetons-1000", space: "jetons", kind: "token_pack",
    badge: "Jetons", title: "Pack 1 000 jetons",
    priceHT: 34, unit: "", tokens: 1000, active: true,
  },
  {
    planKey: "jetons-5000", space: "jetons", kind: "token_pack",
    badge: "Jetons", title: "Pack 5 000 jetons",
    priceHT: 160, unit: "", tokens: 5000, active: true,
  },
  {
    planKey: "jetons-10000", space: "jetons", kind: "token_pack",
    badge: "Jetons", title: "Pack 10 000 jetons",
    priceHT: 300, unit: "", tokens: 10000, active: true,
  },

  // ── Promoteur (abonnements d'acces + jetons inclus) ───────────────────────
  {
    planKey: "promoteur-starter", space: "promoteur", kind: "access_plan",
    badge: "Promoteur", title: "Starter",
    priceHT: 149, unit: "/mois", tokens: 1500, active: true,
  },
  {
    planKey: "promoteur-pro", space: "promoteur", kind: "access_plan",
    badge: "Promoteur", title: "Pro",
    priceHT: 299, unit: "/mois", tokens: 4000, active: true,
  },
  {
    planKey: "promoteur-enterprise", space: "promoteur", kind: "custom",
    badge: "Entreprise", title: "Sur devis",
    priceHT: 0, unit: "", tokens: 0, active: true,
  },

  // ── Rehabilitation (abonnements d'acces + jetons inclus) ──────────────────
  {
    planKey: "rehabilitation-starter", space: "rehabilitation", kind: "access_plan",
    badge: "Rehabilitation", title: "Starter",
    priceHT: 149, unit: "/mois", tokens: 1500, active: true,
  },
  {
    planKey: "rehabilitation-pro", space: "rehabilitation", kind: "access_plan",
    badge: "Rehabilitation", title: "Pro",
    priceHT: 299, unit: "/mois", tokens: 4000, active: true,
  },
  {
    planKey: "rehabilitation-enterprise", space: "rehabilitation", kind: "custom",
    badge: "Entreprise", title: "Sur devis",
    priceHT: 0, unit: "", tokens: 0, active: true,
  },

  // ── Apporteur (sans jetons) ───────────────────────────────────────────────
  {
    planKey: "apporteur-free", space: "apporteur", kind: "custom",
    badge: "Apporteur", title: "Acces gratuit",
    priceHT: 0, unit: "", tokens: 0, active: true,
  },
  {
    planKey: "apporteur-commission", space: "apporteur", kind: "custom",
    badge: "Commission", title: "Remuneration",
    priceHT: 0, unit: "", tokens: 0, active: true,
  },
  {
    planKey: "apporteur-partenariat", space: "apporteur", kind: "custom",
    badge: "Reseau", title: "Partenariat",
    priceHT: 0, unit: "", tokens: 0, active: true,
  },
];

const STORAGE_KEY = "mimmoza.pricing";

const SPACE_LABELS: Record<PricingEntry["space"], string> = {
  jetons:         "Jetons",
  promoteur:      "Promoteur",
  rehabilitation: "Rehabilitation",
  apporteur:      "Apporteur",
};

const SPACE_ORDER: PricingEntry["space"][] = [
  "jetons", "promoteur", "rehabilitation", "apporteur",
];

const SPACE_COLORS: Record<PricingEntry["space"], string> = {
  jetons:         "bg-violet-100 text-violet-700 border-violet-200",
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

// ── Helpers calcul ────────────────────────────────────────────────────────────

function eurPerToken(e: PricingEntry): number | null {
  if (e.tokens <= 0 || e.priceHT <= 0) return null;
  return e.priceHT / e.tokens;
}

function marginPct(e: PricingEntry): number | null {
  const perToken = eurPerToken(e);
  if (perToken === null) return null;
  return ((perToken - COST_PER_TOKEN_EUR) / perToken) * 100;
}

function fmtEur(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
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

type EditableField = "title" | "badge" | "priceHT" | "unit" | "tokens";

function EditableCell({
  value, type = "text", onChange, className = "",
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

function JetonsPricingInfo() {
  return (
    <div className="mx-6 mb-4 mt-2 rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4">
      <div className="flex items-start gap-3">
        <Coins className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
        <div className="text-xs leading-5 text-violet-700">
          <strong className="font-semibold text-violet-900">Unite unique : le jeton.</strong>{" "}
          Cout reel Anthropic : <strong>0,00358 $ / jeton</strong> (texte, mesure 30j).
          Le €/jeton et la marge sont calcules automatiquement par ligne.
          <span className="ml-2 text-violet-500">
            Copilot quick = 3 jetons · Analyse rapide = 3 · Copilot avance = 15 · Facade = 10/20/40.
          </span>
          <div className="mt-1 text-violet-500">
            Jetons d'abonnement : inclus chaque mois, <strong>expiration a 30 jours</strong>. Packs rachetables en plus.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminTarifsPage() {
  const [entries, setEntries] = useState<PricingEntry[]>(() => loadPricing());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function update(planKey: string, field: EditableField | "active", value: string | number | boolean) {
    setEntries((prev) =>
      prev.map((e) => (e.planKey === planKey ? { ...e, [field]: value } : e))
    );
    setDirty(true);
  }

  function handleSave() {
    savePricingToStorage(entries);
    setDirty(false);
    setToast("Tarifs enregistres — /abonnement est mis a jour.");
  }

  function handleReset() {
    if (!confirm("Remettre tous les tarifs par defaut ?")) return;
    setEntries(DEFAULT_PRICING);
    savePricingToStorage(DEFAULT_PRICING);
    setToast("Tarifs reinitialises.");
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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
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
              Modifiez les tarifs affiches sur{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">/abonnement</code>.
              Les modifications sont enregistrees dans{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">localStorage</code>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Defauts
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              className={[
                "inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-medium text-white shadow-sm transition",
                dirty ? "bg-indigo-600 hover:bg-indigo-500" : "bg-slate-300 cursor-default",
              ].join(" ")}
            >
              <Save className="h-4 w-4" />
              Enregistrer
            </button>
          </div>
        </div>

        {dirty && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            Modifications non enregistrees — cliquez sur "Enregistrer" pour les appliquer.
          </div>
        )}
      </div>

      {/* ── Tableaux par espace ─────────────────────────────────────────────── */}
      {bySpace.map(({ space, items }) => {
        const isOpen   = !collapsed.has(space);
        const colorCls = SPACE_COLORS[space];
        const isJetons = space === "jetons";

        return (
          <div
            key={space}
            className={[
              "overflow-hidden rounded-[28px] border bg-white shadow-sm",
              isJetons ? "border-violet-200" : "border-slate-200",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => toggleCollapse(space)}
              className={[
                "flex w-full items-center justify-between px-6 py-4 text-left transition-colors",
                isJetons ? "hover:bg-violet-50/40" : "hover:bg-slate-50/60",
              ].join(" ")}
            >
              <div className="flex items-center gap-3">
                {isJetons && <Coins className="h-4 w-4 text-violet-500" />}
                <span className={`inline-flex items-center rounded-xl border px-3 py-1 text-xs font-semibold ${colorCls}`}>
                  {SPACE_LABELS[space]}
                </span>
                <span className="text-sm text-slate-400">{items.length} offre(s)</span>
              </div>
              {isOpen
                ? <ChevronDown className="h-4 w-4 text-slate-400" />
                : <ChevronRight className="h-4 w-4 text-slate-400" />
              }
            </button>

            {isOpen && (
              <>
                {isJetons && <JetonsPricingInfo />}
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-medium text-slate-400">
                      <tr>
                        <th className="px-4 py-3 w-40">Plan Key</th>
                        <th className="px-4 py-3 w-28">Badge</th>
                        <th className="px-4 py-3">Titre</th>
                        <th className="px-4 py-3 w-28">Prix HT €</th>
                        <th className="px-4 py-3 w-24">Unite</th>
                        <th className="px-4 py-3 w-36">Jetons</th>
                        <th className="px-4 py-3 w-32">€/jeton · marge</th>
                        <th className="px-4 py-3 w-24 text-center">Actif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((entry, idx) => {
                        const perToken = eurPerToken(entry);
                        const margin = marginPct(entry);
                        return (
                          <tr
                            key={entry.planKey}
                            className={[
                              "border-t border-slate-100 align-middle transition-colors",
                              !entry.active ? "opacity-40" : isJetons ? "hover:bg-violet-50/30" : "hover:bg-slate-50/40",
                              idx % 2 === 0 ? "" : "bg-slate-50/30",
                            ].join(" ")}
                          >
                            <td className="px-4 py-2.5">
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                                {entry.planKey}
                              </code>
                            </td>

                            <td className="px-4 py-2.5">
                              <EditableCell
                                value={entry.badge}
                                onChange={(v) => update(entry.planKey, "badge", v)}
                              />
                            </td>

                            <td className="px-4 py-2.5">
                              <EditableCell
                                value={entry.title}
                                onChange={(v) => update(entry.planKey, "title", v)}
                                className="font-medium"
                              />
                            </td>

                            <td className="px-4 py-2.5">
                              <EditableCell
                                type="number"
                                value={entry.priceHT}
                                onChange={(v) => update(entry.planKey, "priceHT", parseFloat(v) || 0)}
                              />
                            </td>

                            <td className="px-4 py-2.5">
                              <select
                                value={entry.unit}
                                onChange={(e) => update(entry.planKey, "unit", e.target.value)}
                                className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-slate-700 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus:border-slate-300 focus:bg-white"
                              >
                                <option value="">—</option>
                                <option value="/mois">/mois</option>
                              </select>
                            </td>

                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  value={entry.tokens}
                                  onChange={(e) => update(entry.planKey, "tokens", parseInt(e.target.value, 10) || 0)}
                                  className="min-w-[72px] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-slate-900 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
                                />
                                <span className="shrink-0 text-xs text-slate-400">jet.</span>
                              </div>
                            </td>

                            <td className="px-4 py-2.5">
                              {perToken !== null ? (
                                <div className="flex flex-col">
                                  <span className="text-xs font-medium text-slate-700">
                                    {perToken.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €
                                  </span>
                                  {margin !== null && (
                                    <span className={`text-[10px] font-semibold ${margin >= 80 ? "text-emerald-600" : margin >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                      marge {margin.toFixed(0)} %
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </td>

                            <td className="px-4 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => update(entry.planKey, "active", !entry.active)}
                                className="inline-flex items-center justify-center rounded-lg p-1 transition hover:bg-slate-100"
                                title={entry.active ? "Desactiver" : "Activer"}
                              >
                                {entry.active
                                  ? <ToggleRight className="h-6 w-6 text-emerald-500" />
                                  : <ToggleLeft  className="h-6 w-6 text-slate-300" />
                                }
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* ── Aide ────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="text-xs leading-5 text-slate-500">
            <strong className="font-semibold text-slate-700">Comment ca marche</strong>
            {" "}— cliquez dans une cellule pour editer. Le bouton{" "}
            <strong>Enregistrer</strong> ecrit dans{" "}
            <code className="rounded bg-slate-200 px-1">localStorage["mimmoza.pricing"]</code>.
            La page <code className="rounded bg-slate-200 px-1">/abonnement</code> relit cette cle a chaque affichage.
            Le champ <strong>Jetons</strong> = jetons inclus (pack ou abonnement). Le <strong>€/jeton</strong> et la marge se calculent seuls.
            Desactiver une offre la masque sur la page abonnement.
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}