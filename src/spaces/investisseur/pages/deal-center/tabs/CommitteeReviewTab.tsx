// src/spaces/investisseur/pages/deal-center/tabs/CommitteeReviewTab.tsx
//
// Committee Review — V4 — Branché marchandSnapshot
// Style identique à AnalysePage.tsx.

import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Gauge,
  Hammer,
  ShieldAlert,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import useMarchandSnapshotTick from "../../../../marchand/shared/hooks/useMarchandSnapshotTick";
import {
  ensureActiveDeal,
  readMarchandSnapshot,
  type ExecutionSaved,
  type MarcheRisquesSaved,
  type RentabiliteSaved,
} from "../../../../marchand/shared/marchandSnapshot.store";

import type { RentabiliteSnapshot } from "../../../../marchand/types/rentabilite.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function castComputed(saved: RentabiliteSaved | undefined): RentabiliteSnapshot | null {
  if (!saved?.computed) return null;
  return saved.computed as RentabiliteSnapshot;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(0)} %`;
}

/** Score qualité dossier — basé sur complétude du deal actif */
function deriveQualiteDossier(
  deal: ReturnType<typeof ensureActiveDeal>,
  rentaSaved: RentabiliteSaved | undefined,
): number | null {
  if (!deal) return null;
  let score = 0;
  if (deal.address)          score += 20;
  if (deal.surfaceM2)        score += 15;
  if (deal.prixAchat)        score += 20;
  if (deal.prixReventeCible) score += 15;
  if (rentaSaved?.computed)  score += 20;
  if (rentaSaved?.inputs?.travauxEstimes || (rentaSaved?.inputs as Record<string,unknown>)?.budgetTravaux) score += 10;
  return score;
}

/** Score analyse financière depuis rentabilité */
function deriveScoreFinancier(snapshot: RentabiliteSnapshot | null): number | null {
  const base = snapshot?.scenarios?.base;
  if (!base) return null;
  let score = 0;
  if (base.margePct >= 15) score += 40;
  else if (base.margePct >= 10) score += 20;
  if (base.triPct >= 20) score += 30;
  else if (base.triPct >= 15) score += 15;
  if (base.margeBrute >= 30000) score += 20;
  else if (base.margeBrute >= 15000) score += 10;
  if (base.decision === "GO") score += 10;
  else if (base.decision === "GO_AVEC_RESERVES") score += 5;
  return Math.min(100, score);
}

/** Score analyse marché depuis breakdown */
function deriveScoreMarche(marcheSaved: MarcheRisquesSaved | undefined): number | null {
  const b = marcheSaved?.breakdown;
  if (!b) return null;
  const vals = [b.demande, b.offre, b.accessibilite].filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, c) => a + c, 0) / vals.length);
}

/** Score analyse risques depuis environnement + présence data */
function deriveScoreRisques(marcheSaved: MarcheRisquesSaved | undefined): number | null {
  const b = marcheSaved?.breakdown;
  if (!b) return null;
  return b.environnement ?? null;
}

/** Score global comité — moyenne pondérée des 4 axes */
function deriveScoreComite(
  qualite: number | null,
  marche: number | null,
  risques: number | null,
  financier: number | null,
): number | null {
  const entries = [
    { v: qualite,   w: 0.30 },
    { v: marche,    w: 0.25 },
    { v: risques,   w: 0.25 },
    { v: financier, w: 0.20 },
  ].filter((e): e is { v: number; w: number } => e.v != null);
  if (entries.length === 0) return null;
  const totalW = entries.reduce((a, e) => a + e.w, 0);
  return Math.round(entries.reduce((a, e) => a + e.v * e.w, 0) / totalW);
}

type Decision = "GO" | "GO_SOUS_CONDITIONS" | "NO_GO" | null;

function deriveDecision(score: number | null, base: ReturnType<typeof castComputed>): Decision {
  if (score == null) return null;
  const rentaDecision = base?.scenarios?.base?.decision;
  if (rentaDecision === "NO_GO" || score < 40) return "NO_GO";
  if (score >= 70 && rentaDecision === "GO")  return "GO";
  return "GO_SOUS_CONDITIONS";
}

// ─── ScoreCard ────────────────────────────────────────────────────────────────

function ScoreCard({
  label, hint, weightLabel, value,
}: {
  label: string; hint?: string; weightLabel?: string; value?: number | null;
}) {
  const hasValue = value != null;
  const pct      = hasValue ? Math.min(100, Math.max(0, value!)) : 0;
  const color    = hasValue
    ? value! >= 70 ? "from-emerald-500/80 via-emerald-400/70 to-teal-400/60"
    : value! >= 50 ? "from-amber-500/80  via-amber-400/70  to-yellow-400/60"
    : "from-rose-500/80  via-rose-400/70  to-pink-400/60"
    : "from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 print:shadow-none print:border-gray-300">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">
          {label}
          {weightLabel && <span className="ml-2 text-[10px] font-semibold text-gray-400">{weightLabel}</span>}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className={["text-3xl leading-none font-semibold", hasValue ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
            {hasValue ? value!.toFixed(0) : "—"}
          </div>
          <div className="text-sm text-gray-400">/100</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
          <div
            className={["h-full rounded-full bg-gradient-to-r transition-all duration-500 print:bg-gray-900", color].join(" ")}
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="mt-2 text-xs text-gray-400 print:text-gray-600">
          {hasValue
            ? value! >= 70 ? "Solide" : value! >= 50 ? "Moyen" : "Fragile"
            : "Non disponible"}
          {hint && <span className="ml-2 text-gray-400">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── InfoBlock ────────────────────────────────────────────────────────────────

function InfoBlock() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Comprendre la grille comité</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Quatre axes évalués pour statuer sur la qualité du dossier présenté en comité.</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          Note sur 100
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Définitions</div>
          <ul className="space-y-2 text-sm text-gray-700 print:text-gray-800">
            {[
              { t: "Qualité dossier",    d: "complétude et cohérence des données renseignées." },
              { t: "Analyse marché",     d: "dynamique locale (DVF, liquidité, offre/demande)." },
              { t: "Analyse risques",    d: "risques naturels, PLU, urbanisme, Géorisques." },
              { t: "Analyse financière", d: "rentabilité, TRI, marge, robustesse du montage." },
            ].map(({ t, d }) => (
              <li key={t}><span className="font-semibold text-gray-900 print:text-black">{t}</span> : {d}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Comment interpréter</div>
          <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-4 print:bg-white print:ring-gray-300">
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-700">
              {[
                { color: "bg-emerald-500", range: ">70",   label: "solide"  },
                { color: "bg-amber-500",   range: "50–70", label: "moyen"   },
                { color: "bg-rose-500",    range: "<50",   label: "fragile" },
              ].map(({ color, range, label }) => (
                <div key={range} className="flex items-center gap-2">
                  <span className={["h-2 w-2 rounded-full print:bg-gray-900", color].join(" ")} />
                  <span className="font-semibold">{range}</span>
                  <span className="text-gray-500">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Éléments disponibles ─────────────────────────────────────────────────────

const ELEMENTS_CONFIG = [
  { label: "SmartScore",      source: "smartscore-enriched-v3",       icon: Gauge,       key: "smartscore"   },
  { label: "Marché",          source: "market-study-investisseur-v1",  icon: BarChart3,   key: "marche"       },
  { label: "Risques",         source: "risk-study-v1",                 icon: ShieldAlert, key: "risques"      },
  { label: "Travaux",         source: "simulation-travaux",            icon: Hammer,      key: "travaux"      },
  { label: "Rentabilité",     source: "InvestisseurAnalysePage",       icon: TrendingUp,  key: "rentabilite"  },
  { label: "Investment Pack", source: "Deal Center — Investment Pack", icon: FileText,    key: "invpack"      },
] as const;

function ElementsDisponibles({
  hasMarche,
  hasRenta,
  hasTravaux,
  hasRisques,
}: {
  hasMarche:  boolean;
  hasRenta:   boolean;
  hasTravaux: boolean;
  hasRisques: boolean;
}) {
  const statuts: Record<string, "ok" | "waiting"> = {
    smartscore:  hasMarche  ? "ok" : "waiting",
    marche:      hasMarche  ? "ok" : "waiting",
    risques:     hasRisques ? "ok" : "waiting",
    travaux:     hasTravaux ? "ok" : "waiting",
    rentabilite: hasRenta   ? "ok" : "waiting",
    invpack:     "waiting",
  };

  const okCount = Object.values(statuts).filter((s) => s === "ok").length;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Éléments disponibles pour le comité</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Sources connectées qui alimenteront la décision du comité.</p>
        </div>
        <div className={[
          "hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 print:bg-white print:ring-gray-300",
          okCount > 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-gray-50 text-gray-600 ring-gray-200",
        ].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full", okCount > 0 ? "bg-emerald-500" : "bg-gray-400"].join(" ")} />
          {okCount} / {ELEMENTS_CONFIG.length} connectés
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {ELEMENTS_CONFIG.map(({ label, source, icon: Icon, key }) => {
          const s = statuts[key];
          const StatusIcon = s === "ok" ? CheckCircle2 : Clock;
          const statusCls  = s === "ok"
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-gray-100   text-gray-500    ring-gray-200";
          const iconWrapCls = s === "ok"
            ? "bg-emerald-50 ring-emerald-200 text-emerald-600"
            : "bg-gray-100   ring-gray-200    text-gray-400";
          return (
            <li key={label} className="flex items-center gap-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-3 py-2.5 print:bg-white print:ring-gray-300">
              <span className={["inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 print:bg-white print:ring-gray-300", iconWrapCls].join(" ")}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                <span className="text-sm text-gray-800 print:text-gray-900 font-medium">{label}</span>
                <span className="hidden sm:block text-[11px] text-gray-400 font-mono shrink-0">{source}</span>
              </div>
              <span className={["inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 shrink-0 print:bg-white print:ring-gray-300", statusCls].join(" ")}>
                <StatusIcon className="h-2.5 w-2.5" />
                {s === "ok" ? "Connecté" : "En attente"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Questions / Réserves ─────────────────────────────────────────────────────

function buildQuestions(
  qualite: number | null,
  marche:  number | null,
  risques: number | null,
  financier: number | null,
): string[] {
  const q: string[] = [];
  if (qualite   != null && qualite   < 60) q.push("Dossier incomplet — compléter adresse, surface et prix avant présentation.");
  if (marche    != null && marche    < 50) q.push("Marché en tension — justifier la demande et la liquidité du secteur.");
  if (risques   != null && risques   < 50) q.push("Risques environnementaux identifiés — détailler les mesures de mitigation.");
  if (financier != null && financier < 50) q.push("Rentabilité insuffisante — retravailler le prix d'acquisition ou le budget travaux.");
  return q;
}

function buildReserves(
  snapshot: RentabiliteSnapshot | null,
  marche:   number | null,
): string[] {
  const r: string[] = [];
  const base = snapshot?.scenarios?.base;
  if (base?.decision === "NO_GO")           r.push("Rentabilité NO GO — opération non viable selon les paramètres actuels.");
  if (base?.margePct != null && base.margePct < 10) r.push(`Marge nette trop faible (${base.margePct.toFixed(1)} %) — seuil minimum 10 %.`);
  if (marche != null && marche < 40)        r.push("Score marché très faible — risque de liquidité élevé à la revente.");
  return r;
}

function ComiteBox({
  title, subtitle, badgeLabel, badgeVariant = "neutral", items, emptyMessage,
}: {
  title: string; subtitle: string; badgeLabel: string;
  badgeVariant?: "neutral" | "go" | "watch" | "nogo";
  items?: string[]; emptyMessage: string;
}) {
  const badgeCls = {
    neutral: "bg-gray-50  text-gray-600  ring-gray-200",
    go:      "bg-emerald-50 text-emerald-700 ring-emerald-200",
    watch:   "bg-amber-50 text-amber-700 ring-amber-200",
    nogo:    "bg-rose-50  text-rose-700  ring-rose-200",
  }[badgeVariant];
  const dotCls = {
    neutral: "bg-gray-400", go: "bg-emerald-500", watch: "bg-amber-500", nogo: "bg-rose-500",
  }[badgeVariant];
  const ItemIcon = badgeVariant === "nogo" ? XCircle : badgeVariant === "watch" ? ClipboardList : ClipboardList;
  const itemCls  = badgeVariant === "nogo" ? "text-rose-500" : "text-amber-500";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">{title}</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">{subtitle}</p>
        </div>
        <div className={["inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 print:bg-white print:text-gray-900 print:ring-gray-300", badgeCls].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full print:bg-gray-900", dotCls].join(" ")} />
          {badgeLabel}
        </div>
      </div>
      <div className="mt-4">
        {items && items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item} className="flex items-start gap-2.5 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-3 py-2.5 print:bg-white print:ring-gray-300">
                <ItemIcon className={["h-4 w-4 mt-0.5 shrink-0", itemCls].join(" ")} />
                <span className="text-sm text-gray-700 print:text-gray-800">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-500 print:bg-white print:ring-gray-300">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Décision comité ──────────────────────────────────────────────────────────

function DecisionComite({ decision }: { decision: Decision }) {
  const ALL = [
    { key: "GO",                 label: "GO",               cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
    { key: "GO_SOUS_CONDITIONS", label: "GO SOUS CONDITIONS", cls: "bg-amber-50  text-amber-700  ring-amber-200",   dot: "bg-amber-500"   },
    { key: "NO_GO",              label: "NO GO",             cls: "bg-rose-50   text-rose-700   ring-rose-200",    dot: "bg-rose-500"    },
  ] as const;

  const active = ALL.find((v) => v.key === decision);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Décision comité</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Verdict final basé sur l'ensemble des analyses.</p>
        </div>
        <div className={[
          "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 print:bg-white print:text-gray-900 print:ring-gray-300",
          active ? active.cls : "bg-gray-50 text-gray-600 ring-gray-200",
        ].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full print:bg-gray-900", active ? active.dot : "bg-gray-400"].join(" ")} />
          {active ? active.label : "En attente"}
        </div>
      </div>
      {!decision && (
        <div className="mt-4 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-500 print:bg-white print:ring-gray-300">
          La décision du comité sera préparée automatiquement à partir du SmartScore, des risques, de la rentabilité et de l'Investment Pack.
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {ALL.map(({ key, label, cls, dot }) => (
          <div
            key={key}
            className={[
              "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ring-1 transition-opacity",
              cls,
              decision === key ? "opacity-100" : "opacity-30",
              "print:bg-white print:text-gray-900 print:ring-gray-300",
            ].join(" ")}
          >
            <span className={["h-1.5 w-1.5 rounded-full print:bg-gray-900", dot].join(" ")} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function CommitteeReviewTab() {
  const tick = useMarchandSnapshotTick();

  const { deal, rentaSaved, marcheSaved, executionSaved } = useMemo(() => {
    const snap       = readMarchandSnapshot();
    const activeDeal = ensureActiveDeal();
    const id         = activeDeal?.id ?? null;
    return {
      deal:          activeDeal,
      rentaSaved:    id ? snap.rentabiliteByDeal[id]   : undefined,
      marcheSaved:   id ? snap.marcheRisquesByDeal[id] : undefined,
      executionSaved: id ? snap.executionByDeal[id]    : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const snapshot  = useMemo(() => castComputed(rentaSaved), [rentaSaved]);
  const base      = snapshot?.scenarios?.base ?? null;

  const qualite   = useMemo(() => deriveQualiteDossier(deal, rentaSaved),  [deal, rentaSaved]);
  const marche    = useMemo(() => deriveScoreMarche(marcheSaved),           [marcheSaved]);
  const risques   = useMemo(() => deriveScoreRisques(marcheSaved),          [marcheSaved]);
  const financier = useMemo(() => deriveScoreFinancier(snapshot),           [snapshot]);
  const score     = useMemo(() => deriveScoreComite(qualite, marche, risques, financier), [qualite, marche, risques, financier]);
  const decision  = useMemo(() => deriveDecision(score, snapshot),          [score, snapshot]);

  const questions = useMemo(() => buildQuestions(qualite, marche, risques, financier), [qualite, marche, risques, financier]);
  const reserves  = useMemo(() => buildReserves(snapshot, marche),          [snapshot, marche]);

  const hasTravaux = !!(executionSaved as ExecutionSaved | undefined)?.travaux;
  const hasRisques = !!(marcheSaved?.data as Record<string, unknown>)?.scores;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 print:shadow-none print:border-gray-300">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-500/15 via-sky-500/10 to-emerald-500/10 ring-1 ring-gray-200 flex items-center justify-center print:bg-white print:ring-gray-300">
            <Users className="h-4 w-4 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 print:text-black">Préparation du comité</h2>
            <p className="text-sm text-gray-500 print:text-gray-700">Qualité des dossiers soumis à la revue d'investissement.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ScoreCard label="Qualité dossier"    hint="complétude deal"        weightLabel="30 %" value={qualite}   />
          <ScoreCard label="Analyse marché"     hint="DVF + liquidité"        weightLabel="25 %" value={marche}    />
          <ScoreCard label="Analyse risques"    hint="PLU + Géorisques"       weightLabel="25 %" value={risques}   />
          <ScoreCard label="Analyse financière" hint="TRI + marge + montage"  weightLabel="20 %" value={financier} />
        </div>
        <div className="mt-5">
          <InfoBlock />
        </div>
      </section>

      <ElementsDisponibles
        hasMarche={!!marcheSaved?.data}
        hasRenta={!!snapshot}
        hasTravaux={hasTravaux}
        hasRisques={hasRisques}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ComiteBox
          title="Questions du comité"
          subtitle="Points à clarifier avant la décision finale."
          badgeLabel={questions.length > 0 ? `${questions.length} point${questions.length > 1 ? "s" : ""}` : "En attente"}
          badgeVariant={questions.length > 0 ? "watch" : "neutral"}
          items={questions}
          emptyMessage="Les questions du comité seront générées automatiquement après connexion des moteurs d'analyse."
        />
        <ComiteBox
          title="Réserves identifiées"
          subtitle="Points bloquants ou conditions suspensives."
          badgeLabel={reserves.length > 0 ? `${reserves.length} réserve${reserves.length > 1 ? "s" : ""}` : "Rien à signaler"}
          badgeVariant={reserves.length > 0 ? "nogo" : "go"}
          items={reserves}
          emptyMessage="Les réserves du comité apparaîtront ici après l'analyse complète du dossier."
        />
      </div>

      <DecisionComite decision={decision} />
    </div>
  );
}