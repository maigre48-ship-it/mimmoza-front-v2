// =============================================================================
// Mimmoza — ExplanationPanel.tsx  (PHASE 4 + 5)
//
// Composant PRÉSENTATIONNEL, additif. Aucune logique métier ici : il consomme
// les ExplanationResult / MimmozaDecision produits par explainability.service.
// Style Tailwind neutre — à reskinner selon le gradient de l'espace courant.
// =============================================================================

import {
  selectNegative,
  selectPositive,
} from "../../services/explainability/explainability.service";
import type {
  ExplanationResult,
  MimmozaDecision,
} from "../../services/explainability/explainability.types";

interface ExplanationPanelProps {
  /** Explication du score opportunité (Phase 3) — bloc "POURQUOI CE SCORE ?". */
  opportunity: ExplanationResult;
  /** Explication de la valorisation (Phase 2) — bloc "FACTEURS DE VALORISATION". */
  valuation: ExplanationResult;
  /** Décision Mimmoza (Phase 5). */
  decision: MimmozaDecision;
  className?: string;
}

const DECISION_STYLE: Record<MimmozaDecision["verdict"], string> = {
  ACHAT_DECONSEILLE: "bg-red-50 text-red-800 border-red-200",
  NEGOCIATION_RECOMMANDEE: "bg-amber-50 text-amber-800 border-amber-200",
  PRIX_COHERENT: "bg-emerald-50 text-emerald-800 border-emerald-200",
  POTENTIEL_INVESTISSEUR_FAIBLE: "bg-slate-50 text-slate-700 border-slate-200",
  POTENTIEL_PROMOTEUR_LIMITE: "bg-slate-50 text-slate-700 border-slate-200",
};

function FactorList({
  title,
  factors,
  tone,
}: {
  title: string;
  factors: ReturnType<typeof selectPositive>;
  tone: "positive" | "negative";
}) {
  if (!factors.length) return null;
  const dot = tone === "positive" ? "bg-emerald-500" : "bg-red-500";
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <ul className="space-y-1.5">
        {factors.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-sm text-slate-700">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>
              {f.label}
              {f.description ? (
                <span className="text-slate-400"> — {f.description}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExplanationPanel({
  opportunity,
  valuation,
  decision,
  className = "",
}: ExplanationPanelProps) {
  const oppPos = selectPositive(opportunity);
  const oppNeg = selectNegative(opportunity);
  const valPos = selectPositive(valuation);
  const valNeg = selectNegative(valuation);

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 space-y-6 ${className}`}
    >
      {/* ---- POURQUOI CE SCORE ? (opportunité) ---- */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Pourquoi ce score ?
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <FactorList title="Facteurs positifs" factors={oppPos} tone="positive" />
          <FactorList title="Facteurs négatifs" factors={oppNeg} tone="negative" />
        </div>
      </div>

      <hr className="border-slate-100" />

      {/* ---- FACTEURS DE VALORISATION ---- */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Facteurs de valorisation
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <FactorList title="En faveur" factors={valPos} tone="positive" />
          <FactorList title="En défaveur" factors={valNeg} tone="negative" />
        </div>
      </div>

      {/* ---- DÉCISION MIMMOZA ---- */}
      <div
        className={`rounded-xl border px-4 py-3 ${DECISION_STYLE[decision.verdict]}`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Décision Mimmoza
        </p>
        <p className="mt-1 text-base font-semibold">{decision.message}</p>
        {decision.drivers.length > 0 ? (
          <p className="mt-1 text-sm opacity-80">
            Déterminé par : {decision.drivers.map((d) => d.label).join(" · ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default ExplanationPanel;