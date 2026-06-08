import { useMemo, useState } from "react";
import { TrendingUp, Calculator, ChevronRight, Info, Euro, AlertTriangle } from "lucide-react";

type FormData = {
  prixAcquisition: string;
  coutTravaux: string;
  surfaceApres: string;
  prixSortieVouluM2: string;
  fraisAnnexes: string;
};

type Result = {
  fraisTotal: number;
  coutTotal: number;
  prixSortieMinimalM2: number;
  valeurSortieVoulu: number;
  margeBrute: number;
  tauxMarge: number;
  ecartPrixM2: number;
  badge: { label: string; color: string; bg: string; border: string };
};

const initial: FormData = {
  prixAcquisition: "",
  coutTravaux: "",
  surfaceApres: "",
  prixSortieVouluM2: "",
  fraisAnnexes: "8",
};

function toNumber(v: string): number {
  return parseFloat(v.replace(",", ".")) || 0;
}

function compute(form: FormData): Result {
  const acq = toNumber(form.prixAcquisition);
  const trav = toNumber(form.coutTravaux);
  const surf = toNumber(form.surfaceApres);
  const prixVouluM2 = toNumber(form.prixSortieVouluM2);
  const fraisPct = toNumber(form.fraisAnnexes) / 100;

  const fraisTotal = acq * fraisPct;
  const coutTotal = acq + trav + fraisTotal;
  const prixSortieMinimalM2 = surf > 0 ? coutTotal / surf : 0;

  const valeurSortieVoulu = surf * prixVouluM2;
  const margeBrute = valeurSortieVoulu - coutTotal;
  const tauxMarge = coutTotal > 0 ? (margeBrute / coutTotal) * 100 : 0;
  const ecartPrixM2 = prixVouluM2 - prixSortieMinimalM2;

  let badge = {
    label: "Risque élevé",
    color: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-300",
  };

  if (tauxMarge >= 15) {
    badge = {
      label: "Opportunité intéressante",
      color: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-300",
    };
  } else if (tauxMarge >= 8) {
    badge = {
      label: "À sécuriser",
      color: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-300",
    };
  }

  return {
    fraisTotal,
    coutTotal,
    prixSortieMinimalM2,
    valeurSortieVoulu,
    margeBrute,
    tauxMarge,
    ecartPrixM2,
    badge,
  };
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function fmtNumber(n: number) {
  return n.toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number) {
  return n.toFixed(1) + " %";
}

const inputClass =
  "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition placeholder:text-slate-400";

const readonlyClass =
  "w-full border border-orange-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-orange-800 bg-orange-50 cursor-not-allowed";

function Field({
  label,
  placeholder,
  value,
  onChange,
  suffix,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          min={0}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass + " pr-12"}
        />
        {suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ReadonlyField({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <input readOnly value={value} className={readonlyClass + " pr-12"} />
        {suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-orange-500 font-semibold">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export default function RehabilitationValorisationPage() {
  const [form, setForm] = useState<FormData>(initial);
  const [result, setResult] = useState<Result | null>(null);

  const prixSortieMinimalM2 = useMemo(() => {
    const acq = toNumber(form.prixAcquisition);
    const trav = toNumber(form.coutTravaux);
    const surf = toNumber(form.surfaceApres);
    const fraisPct = toNumber(form.fraisAnnexes) / 100;

    const coutTotal = acq + trav + acq * fraisPct;
    return surf > 0 ? coutTotal / surf : 0;
  }, [form.prixAcquisition, form.coutTravaux, form.surfaceApres, form.fraisAnnexes]);

  const isValid =
    form.prixAcquisition !== "" &&
    form.coutTravaux !== "" &&
    form.surfaceApres !== "" &&
    form.prixSortieVouluM2 !== "";

  function set(field: keyof FormData, val: string) {
    setForm((f) => ({ ...f, [field]: val }));
    setResult(null);
  }

  function handleSubmit() {
    if (!isValid) return;
    setResult(compute(form));
    setTimeout(() => {
      document.getElementById("result-val")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  return (
    <div className="w-full">
      <div
        className="w-full mb-6"
        style={{
          background: "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)",
          borderRadius: 24,
          padding: "32px 36px",
          boxShadow: "0 8px 32px rgba(234,88,12,0.22)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div style={{ position: "relative" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

            Réhabilitation · Valorisation
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>

            Valorisation après travaux
          </h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55, margin: 0 }}>
            Déterminez le prix de sortie minimal puis comparez-le au prix de sortie visé.
          </p>
        </div>
        {result && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: "8px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: result.tauxMarge >= 15 ? "#6ee7b7" : result.tauxMarge >= 8 ? "#fcd34d" : "#fca5a5" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>
              {fmtPct(result.tauxMarge)} marge
            </span>
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-0 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Prix d'acquisition"
              placeholder="Ex : 350000"
              value={form.prixAcquisition}
              onChange={(v) => set("prixAcquisition", v)}
              suffix="€"
            />

            <Field
              label="Coût travaux estimé"
              placeholder="Ex : 120000"
              value={form.coutTravaux}
              onChange={(v) => set("coutTravaux", v)}
              suffix="€"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Surface après travaux"
              placeholder="Ex : 150"
              value={form.surfaceApres}
              onChange={(v) => set("surfaceApres", v)}
              suffix="m²"
            />

            <Field
              label="Frais annexes"
              placeholder="8"
              value={form.fraisAnnexes}
              onChange={(v) => set("fraisAnnexes", v)}
              suffix="%"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ReadonlyField
              label="Prix de sortie minimal"
              value={prixSortieMinimalM2 > 0 ? fmtNumber(prixSortieMinimalM2) : "À calculer"}
              suffix="€/m²"
            />

            <Field
              label="Prix de sortie voulu"
              placeholder="Ex : 4500"
              value={form.prixSortieVouluM2}
              onChange={(v) => set("prixSortieVouluM2", v)}
              suffix="€/m²"
            />
          </div>

          <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <Info size={15} className="text-orange-600 mt-0.5 shrink-0" />
            <p className="text-xs text-orange-700 font-medium leading-relaxed">
              Le prix de sortie minimal correspond au coût total de revient divisé par la surface
              après travaux. Il ne génère aucune marge. Le prix de sortie voulu doit normalement
              être supérieur pour dégager une rentabilité.
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!isValid}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
            style={{ background: "linear-gradient(90deg, #f97316 0%, #ef4444 100%)" }}
          >
            <Calculator size={16} />
            Calculer la valorisation
            <ChevronRight size={16} />
          </button>
        </div>

        {result && (
          <div id="result-val" className="space-y-4">
            <div
              className={`flex items-center gap-3 px-5 py-4 rounded-2xl border-2 ${result.badge.bg} ${result.badge.border}`}
            >
              {result.margeBrute >= 0 ? (
                <TrendingUp size={20} className={result.badge.color} />
              ) : (
                <AlertTriangle size={20} className={result.badge.color} />
              )}

              <div>
                <div className={`text-base font-bold ${result.badge.color}`}>
                  {result.badge.label}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Taux de marge brute : {fmtPct(result.tauxMarge)}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-4">
              <Info size={15} className="text-orange-600 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-700 font-medium leading-relaxed">
                Calcul indicatif hors fiscalité, TVA, intérêts intercalaires, commercialisation,
                imprévus et éventuelles contraintes juridiques. À confirmer avec votre expert-comptable
                ou conseil fiscal.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-800">Détail financier</h2>
              </div>

              <div className="divide-y divide-slate-100">
                {[
                  {
                    label: "Prix d'acquisition",
                    val: fmt(toNumber(form.prixAcquisition)),
                    sub: "",
                  },
                  {
                    label: "Coût des travaux",
                    val: fmt(toNumber(form.coutTravaux)),
                    sub: "",
                  },
                  {
                    label: "Frais annexes",
                    val: fmt(result.fraisTotal),
                    sub: `${form.fraisAnnexes} % du prix d'acquisition`,
                  },
                  {
                    label: "Coût total de revient",
                    val: fmt(result.coutTotal),
                    sub: "Acquisition + travaux + frais annexes",
                    bold: true,
                  },
                  {
                    label: "Surface après travaux",
                    val: `${fmtNumber(toNumber(form.surfaceApres))} m²`,
                    sub: "",
                  },
                  {
                    label: "Prix de sortie minimal",
                    val: `${fmtNumber(result.prixSortieMinimalM2)} €/m²`,
                    sub: "Coût total de revient ÷ surface après travaux",
                    bold: true,
                    orange: true,
                  },
                  {
                    label: "Prix de sortie voulu",
                    val: `${fmtNumber(toNumber(form.prixSortieVouluM2))} €/m²`,
                    sub:
                      result.ecartPrixM2 >= 0
                        ? `Écart positif : +${fmtNumber(result.ecartPrixM2)} €/m²`
                        : `Écart négatif : ${fmtNumber(result.ecartPrixM2)} €/m²`,
                  },
                  {
                    label: "Valeur de sortie voulue",
                    val: fmt(result.valeurSortieVoulu),
                    sub: `${form.surfaceApres} m² × ${form.prixSortieVouluM2} €/m²`,
                  },
                ].map((row) => (
                  <div key={row.label} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div>
                      <span
                        className={`text-sm ${
                          row.bold ? "font-bold text-slate-900" : "text-slate-700"
                        }`}
                      >
                        {row.label}
                      </span>
                      {row.sub && <p className="text-xs text-slate-400 mt-0.5">{row.sub}</p>}
                    </div>
                    <span
                      className={`text-sm font-semibold text-right ${
                        row.orange ? "text-orange-700" : row.bold ? "text-slate-900" : "text-slate-800"
                      }`}
                    >
                      {row.val}
                    </span>
                  </div>
                ))}
              </div>

              <div
                className={`px-5 py-5 flex items-center justify-between border-t-2 ${
                  result.margeBrute >= 0
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <Euro size={14} />
                    Marge brute
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Taux de marge : {fmtPct(result.tauxMarge)}
                  </div>
                </div>

                <div
                  className={`text-xl font-bold ${
                    result.margeBrute >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {fmt(result.margeBrute)}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-800">Interprétation du taux de marge</h3>

              <div className="space-y-2">
                {[
                  {
                    range: "≥ 15 %",
                    label: "Opportunité intéressante",
                    color: "text-emerald-700 bg-emerald-50 border-emerald-200",
                  },
                  {
                    range: "8 – 15 %",
                    label: "À sécuriser",
                    color: "text-amber-700 bg-amber-50 border-amber-200",
                  },
                  {
                    range: "< 8 %",
                    label: "Risque élevé",
                    color: "text-red-700 bg-red-50 border-red-200",
                  },
                ].map((row) => (
                  <div key={row.range} className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${row.color}`}>
                      {row.range}
                    </span>
                    <span className="text-xs text-slate-600">{row.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}