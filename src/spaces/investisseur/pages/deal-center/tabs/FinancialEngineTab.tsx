// src/spaces/investisseur/pages/deal-center/tabs/FinancialEngineTab.tsx
//
// Financial Engine — V5 — TRI non calculable si fonds propres détruits
// Style identique à AnalysePage.tsx : tokens gray-*, ring-gray-200,
// bg-gray-50, border-gray-200, shadow-sm, print-safe.

import { useMemo } from "react";
import {
  Euro,
  Percent,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Calculator,
  Sparkles,
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import useMarchandSnapshotTick from "../../../../marchand/shared/hooks/useMarchandSnapshotTick";
import {
  readMarchandSnapshot,
  ensureActiveDeal,
  type RentabiliteSaved,
} from "../../../../marchand/shared/marchandSnapshot.store";
import type {
  RentabiliteInput,
  RentabiliteResult,
  RentabiliteSnapshot,
} from "../../../../marchand/types/rentabilite.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StrategyComputed {
  triEquity?: number;
  vanEquity?: number;
  cashFlowCumule?: number;
  multipleCapital?: number;
  mensualite?: number;
  verdict?: string;
  rendementBrutPct?: number;
  margeBrutePct?: number;
  coutProjet?: number;
  margeBrute?: number;
  rentabiliteLocalScore?: number;
}

interface StrategyInputs {
  prixAchat?: number;
  prixReventeCible?: number;
  prixReventeEstime?: number;
  strategy?: string;
  travauxUtilises?: number;
  travauxEstimes?: number;
  loyerMensuel?: number;
  chargesMensuelles?: number;
  dureeMois?: number;
  fraisNotairePct?: number;
  fraisDivers?: number;
  apportPersonnel?: number;
  tmiPct?: number;
  pfuPct?: number;
  fiscalMode?: string;
  montantPret?: number;
  loanDureeAnnees?: number;
  tauxNominalAnnuelPct?: number;
  [k: string]: unknown;
}

interface ScenarioFinancials {
  prixAchat: number;
  fraisNotaire: number;
  fraisDivers: number;
  travauxBase: number;
  fraisFinanciers: number;
  reventeBase: number;
  apport: number;
  dureeAnnees: number;
  cashflow: number;
}

function extractFromStore(saved: RentabiliteSaved | undefined): {
  inputs: StrategyInputs | null;
  computed: StrategyComputed | null;
} {
  if (!saved) return { inputs: null, computed: null };

  const inputs = (saved.inputs as StrategyInputs) ?? null;
  const computed = saved.computed ? (saved.computed as StrategyComputed) : null;

  const isStrategyFormat =
    computed != null &&
    (typeof (computed as Record<string, unknown>).triEquity === "number" ||
      typeof (computed as Record<string, unknown>).margeBrute === "number" ||
      typeof (computed as Record<string, unknown>).vanEquity === "number");

  const isSnapshotFormat =
    computed != null &&
    typeof (computed as Record<string, unknown>).scenarios === "object";

  if (isSnapshotFormat) {
    const snap = computed as Record<string, unknown>;
    const base = (snap.scenarios as Record<string, unknown>)?.base as
      | Record<string, unknown>
      | undefined;

    return {
      inputs,
      computed: base
        ? {
            triEquity:
              typeof base.triPct === "number" ? base.triPct : undefined,
            margeBrute:
              typeof base.margeBrute === "number"
                ? base.margeBrute
                : undefined,
            margeBrutePct:
              typeof base.margePct === "number" ? base.margePct : undefined,
            rendementBrutPct:
              typeof base.rendementBrutPct === "number"
                ? base.rendementBrutPct
                : undefined,
            verdict:
              typeof base.decision === "string" ? base.decision : undefined,
          }
        : null,
    };
  }

  return {
    inputs,
    computed: isStrategyFormat ? computed : null,
  };
}

function fmtEUR(n: number | undefined | null): string {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number | undefined | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)} %`;
}

function fmtMonths(n: number | undefined | null): string {
  if (n == null) return "—";
  return `${n} mois`;
}

function fmtCharge(n: number | undefined | null): string {
  return n == null ? "—" : fmtEUR(n);
}

// ─── Moteur financier local ──────────────────────────────────────────────────

function computeTriAnnualise(
  apport: number,
  margeBrute: number,
  dureeAnnees: number,
): number | null {
  if (apport <= 0 || dureeAnnees <= 0) return null;

  const fluxFinal = apport + margeBrute;

  if (fluxFinal <= 0) return null;

  const multiple = fluxFinal / apport;

  return (Math.pow(multiple, 1 / dureeAnnees) - 1) * 100;
}

function computeLocalScenario(
  f: ScenarioFinancials,
  reventeFactor: number,
  travauxFactor: number,
): RentabiliteResult {
  const travauxScenario = f.travauxBase * travauxFactor;
  const coutTotalScenario =
    f.prixAchat +
    f.fraisNotaire +
    f.fraisDivers +
    travauxScenario +
    f.fraisFinanciers;

  const prixReventeScenario = f.reventeBase * reventeFactor;
  const margeBrute = prixReventeScenario - coutTotalScenario;
  const margePct =
    coutTotalScenario > 0 ? (margeBrute / coutTotalScenario) * 100 : 0;
  const roiPct = f.apport > 0 ? (margeBrute / f.apport) * 100 : 0;
  const triPct = computeTriAnnualise(f.apport, margeBrute, f.dureeAnnees);

  return {
    fraisNotaire: f.fraisNotaire,
    coutTotal: coutTotalScenario,
    margeBrute,
    margePct,
    roiPct,
    triPct: triPct ?? undefined,
    cashflowMensuel: f.cashflow,
    rendementBrutPct: 0,
    decision:
      margePct >= 15 ? "GO" : margePct >= 8 ? "GO_AVEC_RESERVES" : "NO_GO",
    reasons: [],
  } as RentabiliteResult;
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function InputField({
  label,
  unit,
  hint,
  icon: Icon,
  value,
}: {
  label: string;
  unit: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  value?: string | null;
}) {
  const hasValue = !!value && value !== "—";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-gray-400 print:text-gray-500" />
        <label className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold print:text-gray-700">
          {label}
        </label>
      </div>

      <div className="flex">
        <div
          className={[
            "flex-1 rounded-l-xl border border-gray-200 px-4 py-2.5 text-sm font-medium",
            hasValue
              ? "bg-white text-gray-800"
              : "bg-gray-50 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {value ?? "—"}
        </div>
        <div className="rounded-r-xl border border-l-0 border-gray-200 bg-gray-100 px-3 py-2.5 text-xs font-semibold text-gray-500 print:bg-white print:border-gray-300">
          {unit}
        </div>
      </div>

      {hint && (
        <span className="text-[11px] text-gray-400 leading-tight print:text-gray-500">
          {hint}
        </span>
      )}
    </div>
  );
}

function ParametresEntree({ inputs }: { inputs: RentabiliteInput | null }) {
  const fields = [
    {
      label: "Prix d'acquisition",
      unit: "€",
      hint: "Prix net vendeur",
      icon: Euro,
      value: inputs ? fmtEUR(inputs.prixAchat) : null,
    },
    {
      label: "Frais de notaire",
      unit: "%",
      hint: "~7–8 % dans l'ancien",
      icon: Percent,
      value: inputs ? fmtPct(inputs.fraisNotairePct) : null,
    },
    {
      label: "Frais divers",
      unit: "€",
      hint: "Autres frais d'acquisition",
      icon: Euro,
      value: inputs ? fmtEUR(inputs.fraisDivers) : null,
    },
    {
      label: "Budget travaux",
      unit: "€",
      hint: "Estimation TCE",
      icon: Calculator,
      value: inputs ? fmtEUR(inputs.budgetTravaux) : null,
    },
    {
      label: "Prix de revente cible",
      unit: "€",
      hint: "Prix net vendeur visé",
      icon: TrendingUp,
      value: inputs ? fmtEUR(inputs.prixReventeCible) : null,
    },
    {
      label: "Durée de portage",
      unit: "mois",
      hint: "Acquisition → acte de vente",
      icon: Clock,
      value: inputs ? fmtMonths(inputs.dureeMois) : null,
    },
    {
      label: "TMI / Flat tax",
      unit: "%",
      hint: "Taux fiscal appliqué",
      icon: Percent,
      value: inputs
        ? fmtPct(inputs.useFlatTax ? inputs.taxFlatPct : inputs.tmiPct)
        : null,
    },
    {
      label: "Apport personnel",
      unit: "€",
      hint: "Fonds propres engagés",
      icon: Sparkles,
      value: inputs ? fmtEUR(inputs.apport) : null,
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-6 py-5 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">
          Paramètres d'entrée
        </h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Hypothèses du montage issues de l'onglet Analyse / Rentabilité.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 p-6">
        {fields.map(({ label, unit, hint, icon, value }) => (
          <InputField
            key={label}
            label={label}
            unit={unit}
            hint={hint}
            icon={icon}
            value={value}
          />
        ))}
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 print:bg-white">
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5 print:text-gray-600">
          <Info className="h-3 w-3 shrink-0" />
          Les paramètres sont synchronisés depuis l'onglet Analyse. Modifiez-les
          depuis la page Rentabilité.
        </p>
      </div>
    </div>
  );
}

function ResultatCard({
  label,
  sub,
  icon: Icon,
  value,
  pct,
}: {
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  pct: number;
}) {
  const hasValue = value !== "—";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 flex flex-col gap-1.5 print:shadow-none print:border-gray-300">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 leading-tight print:text-gray-700">
          {label}
        </span>
        <Icon
          className={[
            "h-3.5 w-3.5 shrink-0",
            hasValue ? "text-gray-500" : "text-gray-300",
          ].join(" ")}
        />
      </div>

      <div
        className={[
          "text-3xl leading-none font-semibold min-h-[36px]",
          hasValue ? "text-gray-800" : "text-gray-400",
        ].join(" ")}
      >
        {value}
      </div>

      <span className="text-[11px] text-gray-400 print:text-gray-500">
        {sub}
      </span>

      <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60 transition-all duration-500 print:bg-gray-900"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ResultatsTempsReel({ base }: { base: RentabiliteResult | null }) {
  const metrics = [
    {
      label: "Marge brute",
      sub: "Revente − Coût total",
      icon: TrendingUp,
      value: fmtEUR(base?.margeBrute),
      pct: base ? Math.min(100, Math.max(0, base.margePct * 4)) : 0,
    },
    {
      label: "Marge nette %",
      sub: "En % du coût total",
      icon: Sparkles,
      value: fmtPct(base?.margePct),
      pct: base ? Math.min(100, Math.max(0, base.margePct * 4)) : 0,
    },
    {
      label: "TRI annualisé",
      sub: "Taux de rendement interne",
      icon: Percent,
      value: fmtPct(base?.triPct),
      pct: base?.triPct != null
        ? Math.min(100, Math.max(0, base.triPct * 3))
        : 0,
    },
    {
      label: "Cash-flow",
      sub: "Mensuel net",
      icon: BarChart3,
      value: fmtEUR(base?.cashflowMensuel),
      pct: base?.cashflowMensuel ? 60 : 0,
    },
    {
      label: "Coût total",
      sub: "Acquisition + travaux + frais",
      icon: Calculator,
      value: fmtEUR(base?.coutTotal),
      pct: base ? 100 : 0,
    },
    {
      label: "ROI",
      sub: "Rendement fonds propres",
      icon: Euro,
      value: fmtPct(base?.roiPct),
      pct: base ? Math.min(100, Math.max(0, (base.roiPct ?? 0) * 2)) : 0,
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">
          Résultats
        </h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Indicateurs financiers calculés à partir des paramètres d'entrée.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {metrics.map((m) => (
          <ResultatCard key={m.label} {...m} />
        ))}
      </div>
    </div>
  );
}

const SCENARIO_CONFIG = [
  {
    id: "pessimiste",
    label: "Pessimiste",
    desc: "Revente −5 % / Travaux +10 %",
    card: "bg-rose-50 border-rose-200",
    badge: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
    sub: "text-rose-600",
    value: "text-rose-700",
    icon: TrendingDown,
    iconCls: "text-rose-500",
  },
  {
    id: "base",
    label: "Base",
    desc: "Hypothèses cibles",
    card: "bg-blue-50 border-blue-200",
    badge: "bg-blue-100 text-blue-800 ring-1 ring-blue-200",
    sub: "text-blue-600",
    value: "text-blue-700",
    icon: Minus,
    iconCls: "text-blue-500",
  },
  {
    id: "optimiste",
    label: "Optimiste",
    desc: "Revente +3 % / Travaux −5 %",
    card: "bg-emerald-50 border-emerald-200",
    badge: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    sub: "text-emerald-600",
    value: "text-emerald-700",
    icon: TrendingUp,
    iconCls: "text-emerald-500",
  },
] as const;

function Scenarios({
  scenarios,
}: {
  scenarios: RentabiliteSnapshot["scenarios"] | null;
}) {
  const data = {
    pessimiste: scenarios?.pessimiste ?? null,
    base: scenarios?.base ?? null,
    optimiste: scenarios?.optimiste ?? null,
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">
          Scénarios
        </h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Simulation sur trois hypothèses de prix de revente et de coût travaux.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SCENARIO_CONFIG.map(
          ({
            id,
            label,
            desc,
            card,
            badge,
            sub,
            value,
            icon: Icon,
            iconCls,
          }) => {
            const r = data[id as keyof typeof data];

            return (
              <div
                key={id}
                className={[
                  "rounded-2xl border p-5 flex flex-col gap-4 print:bg-white print:border-gray-300",
                  card,
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold print:bg-white print:text-gray-900 print:ring-gray-300",
                      badge,
                    ].join(" ")}
                  >
                    <Icon className={["h-3 w-3", iconCls].join(" ")} />
                    {label}
                  </span>
                  <span className={["text-[11px]", sub].join(" ")}>
                    {desc}
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {[
                    { lbl: "Coût total", val: fmtEUR(r?.coutTotal) },
                    { lbl: "Marge nette", val: fmtPct(r?.margePct) },
                    { lbl: "TRI", val: fmtPct(r?.triPct) },
                    {
                      lbl: "Cash-flow mens.",
                      val: fmtEUR(r?.cashflowMensuel),
                    },
                  ].map(({ lbl, val }) => (
                    <div
                      key={lbl}
                      className="flex items-center justify-between"
                    >
                      <span className={["text-xs", sub].join(" ")}>
                        {lbl}
                      </span>
                      <span
                        className={[
                          "text-sm font-bold print:text-gray-700",
                          r ? value : "text-gray-300 select-none",
                        ].join(" ")}
                      >
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

const SENSITIVITY_COLS = [
  "Marge brute",
  "Marge nette",
  "TRI",
  "Cash-flow",
] as const;

function AnalyseSensibilite({
  base,
  computeRevente,
}: {
  base: RentabiliteResult | null;
  computeRevente: ((reventeFactor: number) => RentabiliteResult) | null;
}) {
  const sensitivityRows = useMemo(() => {
    if (!computeRevente) return null;
    return {
      moins10: computeRevente(0.9),
      moins5: computeRevente(0.95),
      plus5: computeRevente(1.05),
      plus10: computeRevente(1.1),
    };
  }, [computeRevente]);

  const rows = [
    {
      label: "Revente −10 %",
      icon: ChevronDown,
      highlight: false,
      result: sensitivityRows?.moins10 ?? null,
    },
    {
      label: "Revente −5 %",
      icon: ChevronDown,
      highlight: false,
      result: sensitivityRows?.moins5 ?? null,
    },
    {
      label: "Scénario base",
      icon: Minus,
      highlight: true,
      result: base,
    },
    {
      label: "Revente +5 %",
      icon: ChevronUp,
      highlight: false,
      result: sensitivityRows?.plus5 ?? null,
    },
    {
      label: "Revente +10 %",
      icon: ChevronUp,
      highlight: false,
      result: sensitivityRows?.plus10 ?? null,
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">
          Analyse de sensibilité — Prix de revente
        </h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Impact d'une variation du prix de revente sur les principaux
          indicateurs.
        </p>
      </div>

      <div className="grid grid-cols-5 px-5 py-3 bg-gray-50 border-b border-gray-100 print:bg-white">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 print:text-gray-700">
          Scénario
        </span>
        {SENSITIVITY_COLS.map((col) => (
          <span
            key={col}
            className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-center print:text-gray-700"
          >
            {col}
          </span>
        ))}
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map(({ label, icon: Icon, highlight, result: r }) => {
          const vals = [
            fmtEUR(r?.margeBrute),
            fmtPct(r?.margePct),
            fmtPct(r?.triPct),
            fmtEUR(r?.cashflowMensuel),
          ];

          return (
            <div
              key={label}
              className={[
                "grid grid-cols-5 items-center px-5 py-3",
                highlight ? "bg-blue-50 print:bg-white" : "bg-white",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <Icon
                  className={[
                    "h-3.5 w-3.5 shrink-0",
                    highlight ? "text-blue-500" : "text-gray-400",
                  ].join(" ")}
                />
                <span
                  className={[
                    "text-sm font-medium",
                    highlight ? "text-blue-700" : "text-gray-600",
                  ].join(" ")}
                >
                  {label}
                </span>
                {highlight && (
                  <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200">
                    BASE
                  </span>
                )}
              </div>

              {vals.map((v, i) => (
                <div key={i} className="text-center">
                  <span
                    className={[
                      "text-sm font-semibold",
                      highlight
                        ? "text-blue-700"
                        : r
                          ? "text-gray-700"
                          : "text-gray-300 select-none",
                    ].join(" ")}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 print:bg-white">
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5 print:text-gray-600">
          <Info className="h-3 w-3 shrink-0" />
          La variation s'applique au prix de revente cible, à partir du coût
          total réel de base.
        </p>
      </div>
    </div>
  );
}

const CHARGE_ROWS = [
  { label: "Frais de notaire", cat: "Acquisition" },
  { label: "Frais divers", cat: "Acquisition" },
  { label: "Budget travaux", cat: "Acquisition" },
  { label: "Intérêts d'emprunt", cat: "Financement" },
  { label: "Assurance emprunteur", cat: "Financement" },
  { label: "Taxe foncière (portage)", cat: "Portage" },
  { label: "Charges de copropriété", cat: "Portage" },
  { label: "Impôt sur la plus-value", cat: "Fiscal" },
] as const;

const CAT_CLS: Record<string, string> = {
  Acquisition: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
  Financement: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
  Portage: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  Fiscal: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
};

function ChargesDetaillees({
  base,
  inputs,
  rawInputs,
}: {
  base: RentabiliteResult | null;
  inputs: RentabiliteInput | null;
  rawInputs?: StrategyInputs | null;
}) {
  const montantPret = (rawInputs?.montantPret as number) ?? 0;
  const tauxNominal = (rawInputs?.tauxNominalAnnuelPct as number) ?? 3.5;
  const dureeMoisPortage = inputs?.dureeMois ?? 24;
  const tauxAssurance = (rawInputs?.tauxAssuranceAnnuelPct as number) ?? 0.34;

  const interetsEstimes =
    montantPret > 0
      ? montantPret * (tauxNominal / 100) * (dureeMoisPortage / 12)
      : null;

  const assuranceEstimee =
    montantPret > 0
      ? montantPret * (tauxAssurance / 100) * (dureeMoisPortage / 12)
      : null;

  const valuesMap: Record<string, number | undefined> = {
    "Frais de notaire": base?.fraisNotaire ?? undefined,
    "Frais divers": inputs?.fraisDivers ?? undefined,
    "Budget travaux": inputs?.budgetTravaux ?? undefined,
    "Intérêts d'emprunt": interetsEstimes ?? undefined,
    "Assurance emprunteur": assuranceEstimee ?? undefined,
    "Taxe foncière (portage)": undefined,
    "Charges de copropriété": undefined,
    "Impôt sur la plus-value": undefined,
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">
          Charges détaillées
        </h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Décomposition poste par poste du coût total de l'opération.
        </p>
      </div>

      <div className="grid grid-cols-3 px-5 py-3 bg-gray-50 border-b border-gray-100 print:bg-white">
        <span className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 print:text-gray-700">
          Poste
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-right print:text-gray-700">
          Montant
        </span>
      </div>

      <div className="divide-y divide-gray-100">
        {CHARGE_ROWS.map(({ label, cat }) => {
          const raw = valuesMap[label];
          const val = fmtCharge(raw);
          const hasVal = val !== "—";

          return (
            <div
              key={label}
              className="grid grid-cols-3 items-center px-5 py-3"
            >
              <div className="col-span-2 flex items-center gap-3">
                <span
                  className={[
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 print:bg-white print:text-gray-700 print:ring-gray-300",
                    CAT_CLS[cat] ??
                      "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
                  ].join(" ")}
                >
                  {cat}
                </span>
                <span className="text-sm text-gray-700 print:text-gray-800">
                  {label}
                </span>
              </div>

              <div className="text-right">
                <span
                  className={[
                    "text-sm font-semibold",
                    hasVal ? "text-gray-800" : "text-gray-300 select-none",
                  ].join(" ")}
                >
                  {val}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 items-center px-5 py-4 bg-gray-50 border-t border-gray-200 print:bg-white print:border-gray-300">
        <div className="col-span-2 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-bold text-gray-700 print:text-gray-900">
            Total des charges
          </span>
        </div>
        <div className="text-right">
          <span
            className={[
              "text-xl font-bold",
              base?.coutTotal != null
                ? "text-gray-800"
                : "text-gray-300 select-none",
            ].join(" ")}
          >
            {fmtCharge(base?.coutTotal)}
          </span>
        </div>
      </div>

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 print:bg-white">
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5 print:text-gray-600">
          <Info className="h-3 w-3 shrink-0" />
          Certains postes (intérêts, fiscalité) dépendent du régime et du
          financement saisis.
        </p>
      </div>
    </div>
  );
}

function IndicateursFaisabilite({
  base,
  inputs,
}: {
  base: RentabiliteResult | null;
  inputs: RentabiliteInput | null;
}) {
  const checks = [
    {
      label: "Marge nette > 15 %",
      valeur: base ? fmtPct(base.margePct) : null,
      ok: base ? base.margePct >= 15 : null,
    },
    {
      label: "TRI > 15 %",
      valeur: base ? fmtPct(base.triPct) : null,
      ok: base ? base.triPct != null && base.triPct >= 15 : null,
    },
    {
      label: "Durée de portage ≤ 24 mois",
      valeur: inputs ? fmtMonths(inputs.dureeMois) : null,
      ok: inputs ? inputs.dureeMois <= 24 : null,
    },
    {
      label: "Marge brute > 30 000 €",
      valeur: base ? fmtEUR(base.margeBrute) : null,
      ok: base ? base.margeBrute >= 30000 : null,
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">
            Indicateurs de faisabilité
          </h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            Seuils de validation adaptés au profil de l'opération.
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          {checks.length} critères
        </div>
      </div>

      <ul className="space-y-2">
        {checks.map(({ label, valeur, ok }) => {
          const Icon =
            ok === null ? AlertTriangle : ok ? CheckCircle2 : XCircle;
          const iconCls =
            ok === null
              ? "text-gray-400"
              : ok
                ? "text-emerald-500"
                : "text-rose-500";
          const rowCls =
            ok === null
              ? "bg-gray-50 ring-gray-200"
              : ok
                ? "bg-emerald-50 ring-emerald-200"
                : "bg-rose-50 ring-rose-200";
          const badgeCls =
            ok === null
              ? "bg-gray-100 text-gray-500 ring-gray-200"
              : ok
                ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                : "bg-rose-100 text-rose-700 ring-rose-200";
          const badgeLabel =
            ok === null ? "En attente" : ok ? "Validé" : "Non validé";

          return (
            <li
              key={label}
              className={[
                "flex items-center gap-3 rounded-xl ring-1 px-4 py-3 print:bg-white print:ring-gray-300",
                rowCls,
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-6 w-6 items-center justify-center rounded-full bg-white ring-1 shrink-0",
                  ok === null
                    ? "ring-gray-200"
                    : ok
                      ? "ring-emerald-200"
                      : "ring-rose-200",
                ].join(" ")}
              >
                <Icon className={["h-3.5 w-3.5", iconCls].join(" ")} />
              </span>

              <span className="flex-1 text-sm text-gray-700 print:text-gray-800">
                {label}
              </span>

              <div className="flex items-center gap-2 shrink-0">
                {valeur && valeur !== "—" && (
                  <span className="text-sm font-semibold text-gray-700 print:text-gray-800">
                    {valeur}
                  </span>
                )}
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 print:bg-white print:ring-gray-300",
                    badgeCls,
                  ].join(" ")}
                >
                  {badgeLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-[11px] text-gray-400 flex items-center gap-1.5 print:text-gray-600">
        <Info className="h-3 w-3 shrink-0" />
        Les seuils s'adaptent au profil de l'opération (type, zone, stratégie).
      </p>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function FinancialEngineTab() {
  const tick = useMarchandSnapshotTick();
  const navigate = useNavigate();

  const { rentaSaved } = useMemo(() => {
    const snap = readMarchandSnapshot();
    const activeDeal = ensureActiveDeal();
    const id = activeDeal?.id ?? null;
    return { rentaSaved: id ? snap.rentabiliteByDeal[id] : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const { inputs: rawInputs, computed } = useMemo(
    () => extractFromStore(rentaSaved),
    [rentaSaved],
  );

  const hasData = !!(rawInputs || computed);

  const inputs = useMemo((): RentabiliteInput | null => {
    if (!rawInputs) return null;

    return {
      strategy: (rawInputs.strategy as "revente" | "location") ?? "revente",
      prixAchat: rawInputs.prixAchat ?? 0,
      fraisNotairePct: (rawInputs.fraisNotairePct as number) ?? 0,
      budgetTravaux: rawInputs.travauxUtilises ?? rawInputs.travauxEstimes ?? 0,
      fraisDivers: (rawInputs.fraisDivers as number) ?? 0,
      dureeMois: rawInputs.dureeMois ?? 24,
      surface: (rawInputs.surfaceM2 as number) ?? 0,
      prixReventeCible:
        rawInputs.prixReventeCible ?? rawInputs.prixReventeEstime ?? 0,
      loyerMensuel: rawInputs.loyerMensuel ?? 0,
      chargesMensuelles: rawInputs.chargesMensuelles ?? 0,
      taxeFoncieresAnnuelle: 0,
      tmiPct: rawInputs.tmiPct ?? 30,
      taxFlatPct: rawInputs.pfuPct ?? 30,
      useFlatTax: rawInputs.fiscalMode === "pfu",
      apport: rawInputs.apportPersonnel ?? 0,
    };
  }, [rawInputs]);

  const financials = useMemo((): ScenarioFinancials | null => {
    if (!rawInputs) return null;

    const prixAchat = rawInputs.prixAchat ?? 0;
    const fraisNotairePct = (rawInputs.fraisNotairePct as number) ?? 8;
    const fraisNotaire = prixAchat * (fraisNotairePct / 100);
    const fraisDivers = (rawInputs.fraisDivers as number) ?? 0;
    const travauxBase = rawInputs.travauxUtilises ?? rawInputs.travauxEstimes ?? 0;
    const dureeMois = (rawInputs.dureeMois as number) ?? 24;
    const dureeAnnees = Math.max(0.5, dureeMois / 12);
    const apport = rawInputs.apportPersonnel ?? 0;
    const reventeBase =
      rawInputs.prixReventeCible ?? rawInputs.prixReventeEstime ?? prixAchat;
    const strategy = (rawInputs.strategy as string) ?? "revente";

    const montantPret = (rawInputs.montantPret as number) ?? 0;
    const tauxNominal = (rawInputs.tauxNominalAnnuelPct as number) ?? 3.5;
    const tauxAssurance = (rawInputs.tauxAssuranceAnnuelPct as number) ?? 0.34;

    const interets =
      montantPret > 0
        ? montantPret * (tauxNominal / 100) * (dureeMois / 12)
        : 0;

    const assurance =
      montantPret > 0
        ? montantPret * (tauxAssurance / 100) * (dureeMois / 12)
        : 0;

    const fraisBancaires =
      ((rawInputs.fraisDossierEur as number) ?? 0) +
      ((rawInputs.fraisGarantieEur as number) ?? 0) +
      ((rawInputs.fraisCourtierEur as number) ?? 0);

    const fraisFinanciers = interets + assurance + fraisBancaires;

    const cashflow =
      strategy === "location"
        ? (rawInputs.loyerMensuel ?? 0) -
          (rawInputs.chargesMensuelles ?? 0)
        : 0;

    return {
      prixAchat,
      fraisNotaire,
      fraisDivers,
      travauxBase,
      fraisFinanciers,
      reventeBase,
      apport,
      dureeAnnees,
      cashflow,
    };
  }, [rawInputs]);

  const snapshotForComponents = useMemo((): RentabiliteSnapshot | null => {
    if (!inputs || !financials) return null;

    return {
      input: inputs,
      scenarios: {
        pessimiste: computeLocalScenario(financials, 0.95, 1.1),
        base: computeLocalScenario(financials, 1, 1),
        optimiste: computeLocalScenario(financials, 1.03, 0.95),
      },
      stressTests: {
        reventeMoins5: computeLocalScenario(financials, 0.95, 1),
        travauxPlus10: computeLocalScenario(financials, 1, 1.1),
      },
      updatedAt: new Date().toISOString(),
    } as RentabiliteSnapshot;
  }, [inputs, financials]);

  const computeRevente = useMemo(() => {
    if (!financials) return null;
    return (reventeFactor: number) =>
      computeLocalScenario(financials, reventeFactor, 1);
  }, [financials]);

  const base = snapshotForComponents?.scenarios?.base ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div
            className={[
              "flex h-9 w-9 items-center justify-center rounded-xl ring-1 shrink-0",
              hasData
                ? "bg-indigo-50 ring-indigo-200"
                : "bg-gray-100 ring-gray-200",
            ].join(" ")}
          >
            <Calculator
              className={[
                "h-4 w-4",
                hasData ? "text-indigo-600" : "text-gray-400",
              ].join(" ")}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-900">
              {hasData
                ? "Paramètres synchronisés depuis Analyse › Rentabilité"
                : "Moteur financier non configuré"}
            </div>
            <div className="text-xs text-gray-500">
              {hasData
                ? "Modifiez les hypothèses directement sur la page Rentabilité — les résultats ici se mettent à jour automatiquement."
                : "Renseignez vos paramètres (loyer, travaux, prix de revente) sur la page Rentabilité pour alimenter ce moteur."}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate("/marchand-de-bien/analyse?tab=rentabilite")}
          className={[
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all shrink-0",
            hasData
              ? "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
          ].join(" ")}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          {hasData ? "Modifier les paramètres" : "Configurer la rentabilité"}
        </button>
      </div>

      <ParametresEntree inputs={inputs} />
      <ResultatsTempsReel base={base} />
      <Scenarios scenarios={snapshotForComponents?.scenarios ?? null} />
      <AnalyseSensibilite base={base} computeRevente={computeRevente} />
      <ChargesDetaillees base={base} inputs={inputs} rawInputs={rawInputs} />
      <IndicateursFaisabilite base={base} inputs={inputs} />
    </div>
  );
}