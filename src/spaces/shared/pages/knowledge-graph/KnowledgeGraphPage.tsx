// src/spaces/shared/pages/knowledge-graph/KnowledgeGraphPage.tsx

import type { Explanation, ExplanationReason } from "@/services/knowledgeGraph";
import { createMimmozaKnowledgeGraph } from "@/services/knowledgeGraph/knowledgeGraph.providers";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MapPin,
  MinusCircle,
  Network,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

type Subject = "parcel" | "opportunity" | "valuation";

const SUBJECTS: Array<{ id: Subject; label: string; placeholder: string }> = [
  { id: "parcel", label: "Parcelle", placeholder: "Réf. cadastrale (ex. 64065000AI0001)" },
  { id: "opportunity", label: "Opportunité", placeholder: "Identifiant opportunité" },
  { id: "valuation", label: "Valorisation", placeholder: "Identifiant valorisation" },
];

const GEO_SOURCE_LABEL: Record<string, string> = {
  parcel: "Parcelle",
  commune_centroid: "Centroïde commune",
};

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: "Élevée", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  medium: { label: "Moyenne", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  low: { label: "Faible", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

function ReasonRow(props: { reason: ExplanationReason }) {
  const { reason } = props;
  const tone =
    reason.type === "positive"
      ? { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800", Icon: CheckCircle2, icon: "text-emerald-500" }
      : reason.type === "negative"
        ? { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", Icon: XCircle, icon: "text-red-500" }
        : { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700", Icon: MinusCircle, icon: "text-slate-400" };
  const Icon = tone.Icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border ${tone.border} ${tone.bg} px-4 py-3`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} />
      <div className="min-w-0">
        <div className={`text-sm font-medium ${tone.text}`}>{reason.label}</div>
        {reason.detail && <div className="mt-0.5 text-xs text-slate-500">{reason.detail}</div>}
      </div>
    </div>
  );
}

function formatScore(subject: Subject, score: number | null): string | null {
  if (score === null) return null;
  if (subject === "valuation") return `${Math.round(score).toLocaleString("fr-FR")} €`;
  return `${Math.round(score)}/100`;
}

function formatImpact(impact: number): string {
  return `${impact > 0 ? "+" : impact < 0 ? "−" : ""}${Math.abs(impact)}`;
}

export default function KnowledgeGraphPage() {
  const kg = useMemo(() => createMimmozaKnowledgeGraph(), []);
  const [subject, setSubject] = useState<Subject>("parcel");
  const [nodeKey, setNodeKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Explanation | null>(null);

  const placeholder = SUBJECTS.find((s) => s.id === subject)?.placeholder ?? "";

  async function run() {
    const trimmed = nodeKey.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const explanation =
        subject === "opportunity"
          ? await kg.explainOpportunity(trimmed)
          : subject === "valuation"
            ? await kg.explainValuation(trimmed)
            : await kg.explainParcel(trimmed);
      setResult(explanation);
    } catch {
      setError("Analyse impossible. Vérifie la référence et les sources connectées.");
    } finally {
      setLoading(false);
    }
  }

  const scoreLabel = result ? formatScore(subject, result.score) : null;
  const geo = result?.geo;
  const conf = geo ? CONFIDENCE[geo.confidence] ?? CONFIDENCE.low : null;
  const positiveSignals = result?.positiveSignals ?? [];
  const breakdown = result?.scoreBreakdown ?? [];

  return (
    <>
      {/* Hero */}
      <div className="overflow-hidden rounded-[32px] bg-gradient-to-br from-teal-600 via-teal-500 to-cyan-400 px-6 py-8 text-white shadow-lg sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">Knowledge Graph</h1>
            <p className="mt-0.5 text-sm text-white/80">
              Moteur de connaissances — explication déterministe d'une parcelle, d'une opportunité ou d'une valorisation.
            </p>
          </div>
        </div>
      </div>

      {/* Formulaire */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {SUBJECTS.map((s) => {
            const active = s.id === subject;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSubject(s.id); setResult(null); setError(null); }}
                className={
                  "rounded-xl px-4 py-2 text-sm font-medium transition-all " +
                  (active
                    ? "bg-teal-600 text-white shadow-sm"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100")
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={nodeKey}
            onChange={(e) => setNodeKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
            placeholder={placeholder}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || !nodeKey.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>Analyser</span>
          </button>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="text-sm text-amber-800">{error}</div>
        </div>
      )}

      {/* Résultat */}
      {result && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Explication
            </h2>
            {scoreLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                {scoreLabel}
              </span>
            )}
          </div>

          {/* ÉTAPE 6.1 + 6.2 — Source géographique & niveau de confiance */}
          {geo && conf && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                Source : {GEO_SOURCE_LABEL[geo.source] ?? geo.source}
              </span>
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${conf.cls}`}>
                Confiance : {conf.label}
              </span>
            </div>
          )}

          {/* ÉTAPE 6.3 — Signaux positifs */}
          {positiveSignals.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Signaux positifs
              </div>
              <div className="flex flex-wrap gap-2">
                {positiveSignals.map((sig, i) => (
                  <span
                    key={`sig-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
                  >
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                    {sig.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ÉTAPE 6.5 — Décomposition du score (traçable) */}
          {breakdown.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Décomposition du score
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-xs text-slate-500">
                  <span>Base</span>
                  <span className="font-mono font-medium text-slate-600">
                    {result.scoreBaseline ?? 50}
                  </span>
                </div>
                {breakdown.map((c, i) => {
                  const positive = c.impact > 0;
                  return (
                    <div
                      key={`bd-${i}`}
                      className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm"
                    >
                      <span className="flex items-center gap-2 text-slate-700">
                        {positive ? (
                          <TrendingUp className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        )}
                        <span>
                          {c.label}
                          {c.detail && <span className="ml-1 text-xs text-slate-400">({c.detail})</span>}
                        </span>
                      </span>
                      <span
                        className={`font-mono font-semibold ${positive ? "text-emerald-600" : "text-red-600"}`}
                      >
                        {formatImpact(c.impact)}
                      </span>
                    </div>
                  );
                })}
                {scoreLabel && (
                  <div className="flex items-center justify-between border-t border-slate-200 bg-teal-50/60 px-4 py-2.5 text-sm font-semibold text-teal-800">
                    <span>Score</span>
                    <span className="font-mono">{scoreLabel}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ÉTAPE 6.4 — Signaux détaillés (positifs / négatifs / neutres) */}
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Signaux détaillés
            </div>
            {result.reasons.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Aucune raison déterminée. Vérifie que les moteurs (PLU, DVF, risques, mobilité) répondent pour cette parcelle.
              </div>
            ) : (
              <div className="space-y-2">
                {result.reasons.map((reason, i) => (
                  <ReasonRow key={`${reason.type}-${i}`} reason={reason} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}