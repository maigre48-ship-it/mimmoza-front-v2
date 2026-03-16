import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useUserOpportunities } from "../../hooks/useUserOpportunities";

function formatPrice(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("fr-FR")} €`;
}

function formatSurface(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("fr-FR")} m²`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toLocaleString("fr-FR")} %`;
}

function getLabelStyles(label?: string | null) {
  switch (label) {
    case "PRIORITAIRE":
      return {
        badge:
          "border border-rose-200 bg-rose-50 text-rose-700",
        score:
          "text-rose-700",
        ring:
          "hover:border-rose-300",
        icon: Sparkles,
      };

    case "FORTE":
      return {
        badge:
          "border border-emerald-200 bg-emerald-50 text-emerald-700",
        score:
          "text-emerald-700",
        ring:
          "hover:border-emerald-300",
        icon: Target,
      };

    case "INTERESSANTE":
      return {
        badge:
          "border border-amber-200 bg-amber-50 text-amber-700",
        score:
          "text-amber-700",
        ring:
          "hover:border-amber-300",
        icon: Radar,
      };

    default:
      return {
        badge:
          "border border-slate-200 bg-slate-100 text-slate-700",
        score:
          "text-slate-700",
        ring:
          "hover:border-slate-300",
        icon: ShieldCheck,
      };
  }
}

export function VeilleOpportunities() {
  const { opportunities, loading } = useUserOpportunities();

  if (loading) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Chargement des opportunités détectées…</span>
        </div>
      </div>
    );
  }

  if (!opportunities.length) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
            <Radar className="h-5 w-5" />
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Aucune opportunité détectée pour le moment
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Mimmoza n’a pas encore identifié de bien suffisamment attractif
              dans vos zones surveillées. Continuez la veille : les nouvelles
              annonces, baisses de prix et signaux de pression vendeur
              alimenteront automatiquement cette page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {opportunities.map((o) => {
          const styles = getLabelStyles(o.opportunity_label);
          const Icon = styles.icon;

          const topReasons = Array.isArray(o.reasons) ? o.reasons.slice(0, 3) : [];
          const topRiskFlags = Array.isArray(o.risk_flags)
            ? o.risk_flags.slice(0, 2)
            : [];

          return (
            <div
              key={o.id}
              className={[
                "rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition",
                styles.ring,
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                      styles.badge,
                    ].join(" ")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {o.opportunity_label || "À qualifier"}
                  </span>

                  {o.trigger_summary ? (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {o.trigger_summary}
                    </span>
                  ) : null}
                </div>

                <div className="text-right">
                  <div className={["text-sm font-semibold", styles.score].join(" ")}>
                    Score {o.opportunity_score ?? "—"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Confiance {o.confidence_score ?? "—"}/100
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-1">
                <h3 className="text-base font-semibold text-slate-950">
                  {o.title || "Bien sans titre"}
                </h3>

                <div className="text-sm text-slate-500">
                  {o.city || "Ville non renseignée"}
                  {o.zip_code ? ` (${o.zip_code})` : ""}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-slate-500">Prix</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {formatPrice(o.price_eur)}
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500">Surface</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {formatSurface(o.surface_m2)}
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500">Décote estimée</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {formatPercent(o.discount_vs_market_pct) ?? "—"}
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500">Action</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {o.decision_hint || "Surveiller"}
                    </div>
                  </div>
                </div>
              </div>

              {topReasons.length > 0 ? (
                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Pourquoi cette opportunité
                  </div>

                  <div className="mt-3 space-y-2">
                    {topReasons.map((reason, index) => (
                      <div
                        key={`${o.id}-reason-${index}`}
                        className="flex items-start gap-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                      >
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {topRiskFlags.length > 0 ? (
                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Points de vigilance
                  </div>

                  <div className="mt-3 space-y-2">
                    {topRiskFlags.map((flag, index) => (
                      <div
                        key={`${o.id}-flag-${index}`}
                        className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{flag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 border-t border-slate-200 pt-5">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Décote
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {o.pillar_scores?.discount ?? "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Pression
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {o.pillar_scores?.seller_pressure ?? "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Fit
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {o.pillar_scores?.watchlist_fit ?? "—"}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Analyser le bien
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}