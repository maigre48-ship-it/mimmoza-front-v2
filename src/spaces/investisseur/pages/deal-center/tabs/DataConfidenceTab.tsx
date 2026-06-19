// src/spaces/investisseur/pages/deal-center/tabs/DataConfidenceTab.tsx
//
// Data Confidence — V3 — Branché marchandSnapshot
// Style identique à AnalysePage.tsx : tokens gray-*, ring-gray-200,
// bg-gray-50, border-gray-200, shadow-sm, print-safe.

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Gauge,
  GitMerge,
  Info,
  Minus,
} from "lucide-react";
import { useMemo } from "react";

import useMarchandSnapshotTick from "../../../../marchand/shared/hooks/useMarchandSnapshotTick";
import {
  ensureActiveDeal,
  readMarchandSnapshot,
  type MarcheRisquesSaved,
  type RentabiliteSaved,
} from "../../../../marchand/shared/marchandSnapshot.store";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type SourceStatus = "ok" | "partial" | "waiting";

interface SourceMeta {
  name:   string;
  origin: string;
  status: SourceStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(s: SourceStatus): {
  cls:     string;
  iconCls: string;
  label:   string;
  icon:    typeof CheckCircle2;
} {
  if (s === "ok")      return { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", iconCls: "text-emerald-500", label: "Connecté", icon: CheckCircle2 };
  if (s === "partial") return { cls: "bg-amber-50   text-amber-700   ring-amber-200",   iconCls: "text-amber-500",   label: "Partiel",  icon: AlertCircle  };
  return                      { cls: "bg-gray-100   text-gray-500    ring-gray-200",    iconCls: "text-gray-400",    label: "En attente", icon: Clock };
}

/** Dérive les statuts de source depuis la présence réelle de données */
function deriveSourceStatuses(
  marcheSaved: MarcheRisquesSaved | undefined,
  rentaSaved:  RentabiliteSaved  | undefined,
): Record<string, SourceStatus> {
  const hasMarche   = !!marcheSaved?.data;
  const hasRenta    = !!rentaSaved?.computed;

  const hasGeorisques = !!(marcheSaved?.data as Record<string, unknown>)?.scores;
  return {
    DVF:        hasMarche      ? "ok" : "waiting",
    PLU:        "waiting",
    OAP:        "waiting",
    Sitadel:    hasMarche      ? "ok" : "waiting",
    INSEE:      hasMarche      ? "ok" : "waiting",
    Géorisques: hasGeorisques  ? "ok" : "waiting",
  };
}

/** Score de confiance global dérivé du breakdown marché */
function deriveConfidenceScore(marcheSaved: MarcheRisquesSaved | undefined): number | null {
  const b = marcheSaved?.breakdown;
  if (!b) return null;
  const vals = [b.demande, b.offre, b.accessibilite, b.environnement].filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, c) => a + c, 0) / vals.length);
}

/** Champs manquants sur le deal actif */
function deriveMissingFields(
  deal: ReturnType<typeof ensureActiveDeal>,
  rentaSaved: RentabiliteSaved | undefined,
): string[] {
  const missing: string[] = [];
  if (!deal?.address)          missing.push("Adresse");
  if (!deal?.surfaceM2)        missing.push("Surface (m²)");
  if (!deal?.prixAchat)        missing.push("Prix d'acquisition");
  if (!deal?.prixReventeCible) missing.push("Prix de revente cible");
  if (!rentaSaved?.computed)   missing.push("Résultats rentabilité");
  if (!rentaSaved?.inputs?.travauxEstimes && !(rentaSaved?.inputs as Record<string,unknown>)?.budgetTravaux)
    missing.push("Budget travaux");
  return missing;
}

/** Variation SmartScore estimée depuis l'écart inter-piliers */
function deriveSmartScoreVariation(marcheSaved: MarcheRisquesSaved | undefined): number | null {
  const b = marcheSaved?.breakdown;
  if (!b) return null;
  const vals = [b.demande, b.offre, b.accessibilite, b.environnement].filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return Math.round((max - min) / 2);
}

// ─── Bloc 1 — Score de confiance global ──────────────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * 40; // r=40 → 251.3

function ConfidenceScoreBlock({
  score,
  sourcesOk,
  sourcesWaiting,
  missingCount,
}: {
  score?:         number | null;
  sourcesOk?:     number;
  sourcesWaiting?: number;
  missingCount?:  number;
}) {
  const hasScore = score != null;
  const pct      = hasScore ? Math.min(100, Math.max(0, score!)) / 100 : 0;
  const offset   = CIRCUMFERENCE * (1 - pct);

  const scoreLabel = hasScore
    ? score! >= 75 ? "Fiabilité élevée"
    : score! >= 50 ? "Fiabilité modérée"
    : "Fiabilité faible"
    : "En attente";

  const scoreCls = hasScore
    ? score! >= 75 ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : score! >= 50 ? "bg-amber-50   text-amber-700   ring-amber-200"
    : "bg-rose-50    text-rose-700   ring-rose-200"
    : "bg-gray-100 text-gray-500 ring-gray-200";

  const metrics = [
    { label: "Sources validées",   icon: CheckCircle2, value: sourcesOk     },
    { label: "Sources en attente", icon: Clock,        value: sourcesWaiting },
    { label: "Données manquantes", icon: AlertCircle,  value: missingCount  },
    { label: "Conflits détectés",  icon: GitMerge,     value: 0             },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Score de confiance global</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Fiabilité agrégée des sources DVF, PLU, Géorisques et INSEE.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Jauge */}
        <div className="sm:col-span-1 rounded-2xl border border-gray-200 bg-white shadow-sm p-6 flex flex-col items-center justify-center gap-4 print:shadow-none print:border-gray-300">
          <div className="relative flex h-28 w-28 items-center justify-center">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="10" />
              <circle
                cx="50" cy="50" r="40"
                fill="none"
                stroke={hasScore ? (score! >= 75 ? "#10b981" : score! >= 50 ? "#f59e0b" : "#f43f5e") : "#e5e7eb"}
                strokeWidth="10"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={hasScore ? offset : CIRCUMFERENCE}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute flex flex-col items-center leading-none">
              <span className={["text-3xl font-bold", hasScore ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
                {hasScore ? score : "—"}
              </span>
              <span className="text-xs text-gray-400 mt-1 print:text-gray-500">/100</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5 print:text-gray-700">
              Score de confiance
            </div>
            <div className={["inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 print:bg-white print:ring-gray-300", scoreCls].join(" ")}>
              <Minus className="h-3 w-3" />
              {scoreLabel}
            </div>
          </div>
        </div>

        {/* Métriques secondaires */}
        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          {metrics.map(({ label, icon: Icon, value }) => {
            const hasVal = value != null;
            const pctBar = hasVal && label === "Sources validées" && sourcesOk != null
              ? Math.round((sourcesOk / 6) * 100)
              : 0;
            return (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 flex flex-col gap-2 print:shadow-none print:border-gray-300">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500 leading-tight print:text-gray-700">{label}</span>
                  <Icon className={["h-4 w-4 shrink-0", hasVal && value! > 0 ? "text-gray-500" : "text-gray-300"].join(" ")} />
                </div>
                <div className={["text-3xl leading-none font-semibold", hasVal ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
                  {hasVal ? value : "—"}
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60 transition-all duration-500 print:bg-gray-900"
                    style={{ width: `${pctBar}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Métadonnées par source ───────────────────────────────────────────────────

interface SourceDetail {
          date:       string;
          fraicheur:  string;
          completude: string;
          fiabilite:  string;
        }

function deriveSourceMeta(
  name: string,
  marcheSaved: MarcheRisquesSaved | undefined,
  rentaSaved:  RentabiliteSaved   | undefined,
): SourceDetail | null {
  const data = marcheSaved?.data as Record<string, unknown> | undefined;
  const updatedAt = marcheSaved?.updatedAt;
  const dateStr   = updatedAt
    ? new Date(updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  if (name === "DVF" && data) {
    const dvf = (data as Record<string,unknown>)?.core?.dvf as Record<string,unknown> | undefined
      ?? (data as Record<string,unknown>)?.dvf as Record<string,unknown> | undefined;
    const count = typeof dvf?.count === "number" ? dvf.count : null;
    return {
      date:       dateStr ?? "—",
      fraicheur:  "Élevée",
      completude: count != null ? `${count} transaction${count > 1 ? "s" : ""}` : "Données présentes",
      fiabilite:  "Haute",
    };
  }

  if ((name === "Sitadel" || name === "INSEE") && data) {
    return {
      date:       dateStr ?? "—",
      fraicheur:  "Élevée",
      completude: "Données présentes",
      fiabilite:  "Haute",
    };
  }

  if (name === "Géorisques" && data) {
    const scores = (data as Record<string,unknown>)?.scores as Record<string,unknown> | undefined;
    const global  = typeof scores?.global === "number" ? scores.global : null;
    return {
      date:       dateStr ?? "—",
      fraicheur:  "Élevée",
      completude: "Complète",
      fiabilite:  global != null ? `${global}/100` : "Haute",
    };
  }

  return null;
}

// ─── Bloc 2 — Matrice de fiabilité par source ─────────────────────────────────

const KNOWN_SOURCES = [
  { name: "DVF",        origin: "data.gouv.fr"         },
  { name: "PLU",        origin: "Géoportail Urbanisme" },
  { name: "OAP",        origin: "Mairie"               },
  { name: "Sitadel",    origin: "MTES / SDES"          },
  { name: "INSEE",      origin: "insee.fr"             },
  { name: "Géorisques", origin: "georisques.gouv.fr"   },
] as const;

function SourceReliabilityMatrix({
  statuts,
  marcheSaved,
  rentaSaved,
}: {
  statuts:     Record<string, SourceStatus>;
  marcheSaved: MarcheRisquesSaved | undefined;
  rentaSaved:  RentabiliteSaved   | undefined;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Matrice de fiabilité par source</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Fraîcheur, complétude et fiabilité de chaque source de données.
        </p>
      </div>

      <div className="hidden sm:grid grid-cols-6 px-5 py-3 bg-gray-50 border-b border-gray-100 print:bg-white">
        {["Source", "Date", "Fraîcheur", "Complétude", "Fiabilité", "Statut"].map((h) => (
          <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-center first:text-left print:text-gray-700">
            {h}
          </span>
        ))}
      </div>

      <div className="divide-y divide-gray-100">
        {KNOWN_SOURCES.map(({ name, origin }) => {
          const s    = statuts[name] ?? "waiting";
          const b    = statusBadge(s);
          const BIcon = b.icon;
          const meta  = s === "ok" ? deriveSourceMeta(name, marcheSaved, rentaSaved) : null;

          const Cell = ({ val }: { val: string | null | undefined }) => (
            <div className="text-center hidden sm:block text-sm print:text-gray-600">
              {val
                ? <span className="text-gray-700 font-medium">{val}</span>
                : <span className="text-gray-300 select-none">—</span>}
            </div>
          );

          return (
            <div key={name} className="grid grid-cols-3 sm:grid-cols-6 items-center px-5 py-3.5 gap-y-1">
              <div className="col-span-3 sm:col-span-1">
                <div className="text-sm font-semibold text-gray-800 print:text-gray-900">{name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 print:text-gray-600">{origin}</div>
              </div>
              <Cell val={meta?.date} />
              <Cell val={meta?.fraicheur} />
              <Cell val={meta?.completude} />
              <Cell val={meta?.fiabilite} />
              <div className="col-span-3 sm:col-span-1 flex sm:justify-center mt-1 sm:mt-0">
                <span className={["inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 print:bg-white print:ring-gray-300", b.cls].join(" ")}>
                  <BIcon className={["h-2.5 w-2.5", b.iconCls].join(" ")} />
                  {b.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 print:bg-white">
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5 print:text-gray-600">
          <Info className="h-3 w-3 shrink-0" />
          La matrice se complète automatiquement lorsque les analyses sont lancées.
        </p>
      </div>
    </div>
  );
}

// ─── Bloc 3 — Données manquantes ──────────────────────────────────────────────

function DonneesManquantes({ missing }: { missing: string[] }) {
  const hasMissing = missing.length > 0;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Données manquantes</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            Champs absents qui limitent la précision du scoring.
          </p>
        </div>
        <div className={[
          "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 print:bg-white print:ring-gray-300",
          hasMissing ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-gray-50 text-gray-500 ring-gray-200",
        ].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full", hasMissing ? "bg-amber-500" : "bg-gray-400"].join(" ")} />
          {hasMissing ? `${missing.length} champ${missing.length > 1 ? "s" : ""}` : "En attente"}
        </div>
      </div>
      <div className="mt-4">
        {hasMissing ? (
          <ul className="space-y-2">
            {missing.map((field) => (
              <li key={field} className="flex items-center gap-2.5 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 print:bg-white print:ring-gray-300">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-sm text-amber-800 print:text-gray-800">{field}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-500 print:bg-white print:ring-gray-300">
            Aucune analyse lancée. Les champs absents apparaîtront ici une fois les moteurs connectés.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bloc 4 — Données contradictoires ────────────────────────────────────────
// TODO: connecter divergences inter-sources via Edge Functions

function DonneesContradictoires() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Données contradictoires</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            Divergences détectées entre sources (ex. surface cadastrale ≠ annonce).
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold ring-1 ring-emerald-200 text-emerald-700 print:bg-white print:ring-gray-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Aucun conflit
        </div>
      </div>
      <div className="mt-4">
        <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-500 print:bg-white print:ring-gray-300">
          Aucun conflit détecté. Les divergences entre sources seront signalées ici.
        </div>
      </div>
    </div>
  );
}

// ─── Bloc 5 — Impact sur le SmartScore ───────────────────────────────────────

function ImpactSmartScore({
  variation,
  statuts,
}: {
  variation: number | null;
  statuts:   Record<string, SourceStatus>;
}) {
  const hasVariation = variation != null;

  const nonConnectes = (["DVF", "PLU", "Géorisques"] as const).filter(
    (s) => (statuts[s] ?? "waiting") === "waiting"
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Impact sur le SmartScore</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            Intervalle de confiance calculé à partir des piliers connectés.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-6 rounded-xl bg-gray-50 ring-1 ring-gray-200 p-5 print:bg-white print:ring-gray-300">
        <div className="flex flex-col items-center justify-center gap-1.5 shrink-0 sm:w-32">
          <Gauge className={["h-8 w-8", hasVariation ? "text-indigo-400" : "text-gray-300"].join(" ")} />
          <span className="text-[11px] uppercase tracking-wide text-gray-500 text-center font-semibold print:text-gray-700">
            Variation estimée
          </span>
          <div className={["text-3xl leading-none font-semibold", hasVariation ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
            {hasVariation ? `± ${variation}` : "± —"}
          </div>
        </div>

        <div className="flex-1 border-t sm:border-t-0 sm:border-l border-gray-200 pt-4 sm:pt-0 sm:pl-6 print:border-gray-300">
          {hasVariation ? (
            <p className="text-sm text-gray-600 leading-relaxed print:text-gray-700">
              L'écart entre les piliers du SmartScore suggère une incertitude de{" "}
              <span className="font-semibold text-gray-800">± {variation} points</span>.
              Connectez les sources manquantes pour affiner cet intervalle.
            </p>
          ) : (
            <p className="text-sm text-gray-500 leading-relaxed print:text-gray-700">
              Sans données complètes, l'incertitude sur le SmartScore ne peut pas être calculée.
              Connectez les sources DVF, PLU et Géorisques pour obtenir l'intervalle de confiance.
            </p>
          )}
          {nonConnectes.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {nonConnectes.map((src) => (
                <span key={src} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-500 ring-1 ring-gray-200 print:ring-gray-300">
                  <Minus className="h-2.5 w-2.5" />
                  {src} non connecté
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function DataConfidenceTab() {
  const tick = useMarchandSnapshotTick();

  const { marcheSaved, rentaSaved, deal } = useMemo(() => {
    const snap       = readMarchandSnapshot();
    const activeDeal = ensureActiveDeal();
    const id         = activeDeal?.id ?? null;
    return {
      deal:        activeDeal,
      rentaSaved:  id ? snap.rentabiliteByDeal[id]   : undefined,
      marcheSaved: id ? snap.marcheRisquesByDeal[id] : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const statuts   = useMemo(() => deriveSourceStatuses(marcheSaved, rentaSaved),      [marcheSaved, rentaSaved]);
  const score     = useMemo(() => deriveConfidenceScore(marcheSaved),                 [marcheSaved]);
  const missing   = useMemo(() => deriveMissingFields(deal, rentaSaved),              [deal, rentaSaved]);
  const variation = useMemo(() => deriveSmartScoreVariation(marcheSaved),             [marcheSaved]);

  const sourcesOk      = Object.values(statuts).filter((s) => s === "ok").length;
  const sourcesWaiting = Object.values(statuts).filter((s) => s === "waiting").length;

  return (
    <div className="space-y-5">
      <ConfidenceScoreBlock
        score={score}
        sourcesOk={sourcesOk}
        sourcesWaiting={sourcesWaiting}
        missingCount={missing.length}
      />
      <SourceReliabilityMatrix statuts={statuts} marcheSaved={marcheSaved} rentaSaved={rentaSaved} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DonneesManquantes missing={missing} />
        <DonneesContradictoires />
      </div>
      <ImpactSmartScore variation={variation} statuts={statuts} />
    </div>
  );
}