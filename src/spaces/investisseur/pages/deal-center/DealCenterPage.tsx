// src/spaces/investisseur/pages/deal-center/DealCenterPage.tsx
//
// Deal Center — Page principale — V4 — Géorisques auto depuis QualificationTab
// Style identique à AnalysePage.tsx.

import { useMemo, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import {
  TrendingUp,
  Gauge,
  MapPin,
  Building2,
  Ruler,
  Euro,
  Hammer,
  Sparkles,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldAlert,
  Loader2,
  RefreshCw,
} from "lucide-react";

import DataConfidenceTab  from "./tabs/DataConfidenceTab";
import InvestmentPackTab  from "./tabs/InvestmentPackTab";
import CommitteeReviewTab from "./tabs/CommitteeReviewTab";
import FinancialEngineTab from "./tabs/FinancialEngineTab";
import ExportsTab         from "./tabs/ExportsTab";

import useMarchandSnapshotTick from "../../../marchand/shared/hooks/useMarchandSnapshotTick";
import {
  readMarchandSnapshot,
  ensureActiveDeal,
  patchMarcheRisquesForDeal,
  type MarchandDeal,
  type MarcheRisquesSaved,
  type RentabiliteSaved,
} from "../../../marchand/shared/marchandSnapshot.store";

import type { RentabiliteSnapshot } from "../../../marchand/types/rentabilite.types";

// ─── Types ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "qualification",    label: "Qualification"    },
  { id: "data_confidence",  label: "Data Confidence"  },
  { id: "investment_pack",  label: "Investment Pack"  },
  { id: "committee_review", label: "Committee Review" },
  { id: "financial_engine", label: "Financial Engine" },
  { id: "exports",          label: "Exports"          },
] as const;

type TabId = typeof TABS[number]["id"];
type Decision = "GO" | "GO_AVEC_RESERVES" | "NO_GO" | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEUR(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function formatM2(n: number): string {
  return `${n.toLocaleString("fr-FR")} m²`;
}

function castComputed(saved: RentabiliteSaved | undefined): RentabiliteSnapshot | null {
  if (!saved?.computed) return null;
  return saved.computed as RentabiliteSnapshot;
}

function decisionBadge(decision: Decision) {
  if (decision === "GO")
    return { label: "Opportunité prioritaire", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" };
  if (decision === "GO_AVEC_RESERVES")
    return { label: "Poursuivre l'analyse", cls: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" };
  if (decision === "NO_GO")
    return { label: "Vigilance renforcée", cls: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" };
  return { label: "En attente", cls: "bg-gray-50 text-gray-600 ring-gray-200", dot: "bg-gray-400" };
}

// ─── Géorisques auto-trigger ──────────────────────────────────────────────────

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const BAN_API           = "https://api-adresse.data.gouv.fr";

async function geocodeAdresse(adresse: string): Promise<{ lat: number; lon: number; citycode?: string } | null> {
  try {
    const res = await fetch(`${BAN_API}/search/?q=${encodeURIComponent(adresse)}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.features?.length) return null;
    const f = data.features[0];
    const [lon, lat] = f.geometry.coordinates;
    return { lat, lon, citycode: f.properties?.citycode };
  } catch {
    return null;
  }
}

async function runRiskStudy(deal: MarchandDeal): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase non configuré");
  const adresseStr = [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ");
  if (!adresseStr) throw new Error("Adresse du deal non renseignée");
  const geo = await geocodeAdresse(adresseStr);
  if (!geo) throw new Error("Impossible de géocoder l'adresse");
  const payload: Record<string, unknown> = { lat: geo.lat, lon: geo.lon, radius_km: 5 };
  if (geo.citycode) payload.commune_insee = geo.citycode;
  if (deal.address) payload.address = adresseStr;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/risk-study-v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  if (!res.ok || !result.success) throw new Error(result.error ?? `Erreur ${res.status}`);
  patchMarcheRisquesForDeal(deal.id, {
    scoreGlobal: result.scores?.global ?? undefined,
    breakdown: {
      environnement: result.scores?.global        ?? undefined,
      demande:       result.scores?.naturels       ?? undefined,
      offre:         result.scores?.technologiques ?? undefined,
      accessibilite: result.scores?.geotechniques  ?? undefined,
    },
    data:      result,
    updatedAt: new Date().toISOString(),
  });
}

// ─── ScoreCard ────────────────────────────────────────────────────────────────

function ScoreCard({ label, hint, value, max = 100 }: {
  label: string; hint?: string; value?: number | null; max?: number;
}) {
  const hasValue = value != null && Number.isFinite(value);
  const pct = hasValue ? Math.min(100, Math.max(0, (value! / max) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 print:shadow-none print:border-gray-300">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className={["text-3xl leading-none font-semibold", hasValue ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
            {hasValue ? value!.toFixed(0) : "—"}
          </div>
          <div className="text-sm text-gray-400">/{max}</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60 transition-all duration-500 print:bg-gray-900" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-xs text-gray-400 print:text-gray-600">{hasValue ? hint : "Non disponible"}</div>
      </div>
    </div>
  );
}

// ─── SectionBox ───────────────────────────────────────────────────────────────

function SectionBox({ title, subtitle, badgeLabel, badgeVariant = "neutral", items, emptyMessage }: {
  title: string; subtitle: string; badgeLabel: string;
  badgeVariant?: "neutral" | "positive" | "warning" | "danger";
  items?: string[]; emptyMessage: string;
}) {
  const badgeCls   = { neutral: "bg-gray-50 text-gray-600 ring-gray-200", positive: "bg-emerald-50 text-emerald-700 ring-emerald-200", warning: "bg-amber-50 text-amber-700 ring-amber-200", danger: "bg-rose-50 text-rose-700 ring-rose-200" }[badgeVariant];
  const dotCls     = { neutral: "bg-gray-400", positive: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-rose-500" }[badgeVariant];
  const itemIconCls = { neutral: "text-gray-400", positive: "text-emerald-500", warning: "text-amber-500", danger: "text-rose-500" }[badgeVariant];
  const ItemIcon   = badgeVariant === "positive" ? CheckCircle2 : badgeVariant === "danger" ? XCircle : AlertCircle;
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
                <ItemIcon className={["h-4 w-4 mt-0.5 shrink-0", itemIconCls].join(" ")} />
                <span className="text-sm text-gray-700 print:text-gray-800">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-500 print:bg-white print:ring-gray-300">{emptyMessage}</div>
        )}
      </div>
    </div>
  );
}

// ─── Bloc 1 — Deal Scorecard ──────────────────────────────────────────────────

function DealScorecard({ smartScore, confidence, risque, potentiel }: {
  smartScore?: number | null; confidence?: number | null; risque?: number | null; potentiel?: number | null;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 print:shadow-none print:border-gray-300">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-500/15 via-sky-500/10 to-emerald-500/10 ring-1 ring-gray-200 flex items-center justify-center print:bg-white print:ring-gray-300">
          <Gauge className="h-4 w-4 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 print:text-black">Deal Scorecard</h2>
          <p className="text-sm text-gray-500 print:text-gray-700">Synthèse des scores clés — marché, risque, potentiel, confiance.</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ScoreCard label="SmartScore"  hint="Score global pondéré"    value={smartScore} />
        <ScoreCard label="Confiance"   hint="Fiabilité des données"   value={confidence} />
        <ScoreCard label="Risque"      hint="Pression risque globale" value={risque}     />
        <ScoreCard label="Potentiel"   hint="Création de valeur"      value={potentiel}  />
      </div>
    </section>
  );
}

// ─── Bloc 2 — Executive Summary ───────────────────────────────────────────────

function ExecutiveSummaryBlock({ deal, computed }: { deal: MarchandDeal | null; computed: RentabiliteSnapshot | null }) {
  const base    = computed?.scenarios?.base ?? null;
  const adresse = [deal?.address, deal?.zipCode, deal?.city].filter(Boolean).join(", ");
  const typeOp  = base?.input.strategy === "revente" ? "Marchand de bien / Revente"
    : base?.input.strategy === "location" ? "Investissement locatif" : null;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-6 py-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
            <Building2 className={["h-5 w-5", typeOp ? "text-indigo-500" : "text-gray-300"].join(" ")} />
          </div>
          <div>
            <div className={["text-sm font-semibold", typeOp ? "text-gray-900" : "text-gray-400 select-none"].join(" ")}>{typeOp ?? "— Type d'opération"}</div>
            <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
              <MapPin className="h-3 w-3" />
              <span className={adresse ? "" : "select-none"}>{adresse || "— Adresse non renseignée"}</span>
            </div>
          </div>
        </div>
        {deal?.surfaceM2 ? (
          <div className="flex items-center gap-1 text-xs text-gray-600"><Ruler className="h-3 w-3" /><span className="font-medium">{formatM2(deal.surfaceM2)}</span></div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-gray-400"><Ruler className="h-3 w-3" /><span className="select-none">— m²</span></div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-100">
        {[
          { label: "Acquisition",          icon: Euro,       value: deal?.prixAchat          ? formatEUR(deal.prixAchat)           : null },
          { label: "Travaux",              icon: Hammer,     value: base?.input.budgetTravaux ? formatEUR(base.input.budgetTravaux) : null },
          { label: "Valeur après travaux", icon: TrendingUp, value: deal?.prixReventeCible   ? formatEUR(deal.prixReventeCible)    : null },
          { label: "Marge estimée",        icon: Sparkles,   value: base?.margeBrute != null  ? formatEUR(base.margeBrute)          : null },
        ].map(({ label, icon: Icon, value }) => (
          <div key={label} className="px-5 py-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Icon className={["h-3.5 w-3.5", value ? "text-gray-500" : "text-gray-300"].join(" ")} />
              <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
            </div>
            <span className={["text-xl font-semibold", value ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>{value ?? "—"}</span>
          </div>
        ))}
      </div>
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center gap-2 print:bg-white">
        <ChevronRight className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-500">Stratégie :</span>
        <span className={["text-sm", base?.input.strategy ? "text-gray-700" : "text-gray-400 select-none"].join(" ")}>
          {base?.input.strategy === "revente" ? "Achat / Rénovation / Revente" : base?.input.strategy === "location" ? "Investissement locatif" : "Non renseignée"}
        </span>
      </div>
    </section>
  );
}

// ─── Bloc Géorisques ─────────────────────────────────────────────────────────

function GeorisquesBlock({ deal, marcheSaved, onAnalysed }: {
  deal: MarchandDeal | null; marcheSaved: MarcheRisquesSaved | undefined; onAnalysed: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const hasGeorisques = !!(marcheSaved?.data as Record<string, unknown>)?.scores;
  const score         = marcheSaved?.scoreGlobal ?? null;
  const updatedAt     = marcheSaved?.updatedAt
    ? new Date(marcheSaved.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const canAnalyse = !!(deal?.address || deal?.city);
  const handleAnalyse = useCallback(async () => {
    if (!deal || !canAnalyse) return;
    setIsLoading(true); setError(null);
    try { await runRiskStudy(deal); onAnalysed(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur inconnue"); }
    finally { setIsLoading(false); }
  }, [deal, canAnalyse, onAnalysed]);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={["flex h-10 w-10 items-center justify-center rounded-xl ring-1", hasGeorisques ? "bg-emerald-50 ring-emerald-200" : "bg-gray-100 ring-gray-200"].join(" ")}>
            <ShieldAlert className={["h-5 w-5", hasGeorisques ? "text-emerald-600" : "text-gray-400"].join(" ")} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 print:text-black">Analyse Géorisques</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {hasGeorisques ? `Score sécurité : ${score}/100 · Mis à jour ${updatedAt ?? "—"}` : "Risques naturels, technologiques, pollution et géotechniques."}
            </p>
          </div>
        </div>
        <button type="button" onClick={handleAnalyse} disabled={isLoading || !canAnalyse}
          className={["inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all print:hidden",
            hasGeorisques ? "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50" : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
            (isLoading || !canAnalyse) ? "opacity-60 cursor-not-allowed" : ""].join(" ")}>
          {isLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analyse en cours…</>
            : hasGeorisques ? <><RefreshCw className="h-3.5 w-3.5" />Relancer</>
            : <><ShieldAlert className="h-3.5 w-3.5" />Analyser les risques</>}
        </button>
      </div>
      {!canAnalyse && <p className="mt-3 text-xs text-amber-600 flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0" />Renseignez l'adresse du deal pour lancer l'analyse.</p>}
      {error && <p className="mt-3 text-xs text-rose-600 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 shrink-0" />{error}</p>}
      {hasGeorisques && score != null && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Global",        val: marcheSaved?.scoreGlobal              },
            { label: "Naturels",      val: marcheSaved?.breakdown?.demande       },
            { label: "Technologique", val: marcheSaved?.breakdown?.offre         },
            { label: "Géotechnique",  val: marcheSaved?.breakdown?.accessibilite },
          ].map(({ label, val }) => {
            const v = val ?? null;
            const color = v == null ? "text-gray-300" : v >= 70 ? "text-emerald-600" : v >= 50 ? "text-amber-600" : "text-rose-600";
            return (
              <div key={label} className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-3 py-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
                <div className={["text-xl font-bold", color].join(" ")}>{v != null ? v : "—"}</div>
                <div className="text-[10px] text-gray-400">/100</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Bloc Origines des données ────────────────────────────────────────────────

const DATA_SOURCES = [
  { name: "DVF",        origin: "data.gouv.fr"         },
  { name: "PLU",        origin: "Géoportail Urbanisme" },
  { name: "OAP",        origin: "Mairie"               },
  { name: "Sitadel",    origin: "MTES / SDES"          },
  { name: "INSEE",      origin: "insee.fr"             },
  { name: "Géorisques", origin: "georisques.gouv.fr"   },
] as const;

function OriginesDonnees({ hasMarche, hasGeorisques }: { hasMarche: boolean; hasGeorisques: boolean }) {
  const statuts: Record<string, "ok" | "waiting"> = {
    DVF: hasMarche ? "ok" : "waiting", PLU: "waiting", OAP: "waiting",
    Sitadel: hasMarche ? "ok" : "waiting", INSEE: hasMarche ? "ok" : "waiting",
    Géorisques: hasGeorisques ? "ok" : "waiting",
  };
  const badge = (s: "ok" | "waiting") =>
    s === "ok"
      ? { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: CheckCircle2, iconCls: "text-emerald-500", label: "Connecté" }
      : { cls: "bg-gray-100 text-gray-500 ring-gray-200",          icon: Clock,        iconCls: "text-gray-400",    label: "En attente" };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Origine des données</h3>
          <p className="mt-1 text-sm text-gray-500">Sources utilisées pour alimenter cette analyse.</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />{DATA_SOURCES.length} sources
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {DATA_SOURCES.map(({ name, origin }) => {
          const b = badge(statuts[name] ?? "waiting");
          const BIcon = b.icon;
          return (
            <li key={name} className="flex items-center gap-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-3 py-2.5">
              <span className={["inline-flex h-5 w-5 items-center justify-center rounded-full ring-1", b.cls].join(" ")}>
                <BIcon className={["h-3 w-3", b.iconCls].join(" ")} />
              </span>
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800">{name}</span>
                <span className="hidden sm:block text-[11px] text-gray-400 font-mono shrink-0">{origin}</span>
              </div>
              <span className={["inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 shrink-0", b.cls].join(" ")}>{b.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11px] text-gray-400">Le détail complet est disponible dans l'onglet <span className="font-medium text-gray-500">Data Confidence</span>.</p>
    </div>
  );
}

// ─── Recommandation ───────────────────────────────────────────────────────────

function RecommandationBlock({ decision }: { decision: Decision }) {
  const badge = decisionBadge(decision);
  const ALL = [
    { key: "GO",               label: "Opportunité prioritaire", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
    { key: "GO_AVEC_RESERVES", label: "Poursuivre l'analyse",    cls: "bg-sky-50 text-sky-700 ring-sky-200",             dot: "bg-sky-500"     },
    { key: "NO_GO",            label: "Vigilance renforcée",     cls: "bg-amber-50 text-amber-700 ring-amber-200",       dot: "bg-amber-500"   },
  ] as const;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Recommandation Mimmoza</h3>
          <p className="mt-1 text-sm text-gray-500">Verdict automatique basé sur le SmartScore, les risques et la rentabilité.</p>
        </div>
        <div className={["inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1", badge.cls].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full", badge.dot].join(" ")} />{badge.label}
        </div>
      </div>
      {!decision && (
        <div className="mt-4 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-500">
          La recommandation sera générée après l'exécution du SmartScore, de l'analyse des risques et de l'étude de marché.
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {ALL.map(({ key, label, cls, dot }) => (
          <div key={key} className={["flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-semibold ring-1 text-center transition-opacity", cls, decision === key ? "opacity-100" : "opacity-30"].join(" ")}>
            <span className={["h-1.5 w-1.5 rounded-full shrink-0", dot].join(" ")} />{label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Logique feux verts / vigilances ─────────────────────────────────────────

function buildFeuxVerts(reasons: string[], breakdown: MarcheRisquesSaved["breakdown"]): string[] {
  const items: string[] = [];
  for (const r of reasons) {
    if (r.includes("≥") || r.includes("positif") || r.includes("Rendement brut ≥")) items.push(r);
  }
  if (breakdown) {
    if ((breakdown.demande       ?? 0) >= 65) items.push(`Demande locative solide (${breakdown.demande}/100)`);
    if ((breakdown.accessibilite ?? 0) >= 65) items.push(`Bonne accessibilité du secteur (${breakdown.accessibilite}/100)`);
    if ((breakdown.offre         ?? 0) >= 65) items.push(`Offre maîtrisée sur la zone (${breakdown.offre}/100)`);
  }
  return items;
}

function buildVigilances(reasons: string[], breakdown: MarcheRisquesSaved["breakdown"]): string[] {
  const items: string[] = [];
  for (const r of reasons) {
    if (r.includes("<") || r.includes("négatif") || r.includes("entre")) items.push(r);
  }
  if (breakdown) {
    if ((breakdown.demande       ?? 100) < 50) items.push(`Demande faible sur la zone (${breakdown.demande}/100)`);
    if ((breakdown.environnement ?? 100) < 50) items.push(`Environnement dégradé (${breakdown.environnement}/100)`);
    if ((breakdown.offre         ?? 100) < 50) items.push(`Pression de l'offre élevée (${breakdown.offre}/100)`);
  }
  return items;
}

// ─── QualificationTab ─────────────────────────────────────────────────────────

function QualificationTab() {
  const tick = useMarchandSnapshotTick();

  const { deal, rentaSaved, marcheSaved } = useMemo(() => {
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

  const computed     = useMemo(() => castComputed(rentaSaved), [rentaSaved]);
  const base         = computed?.scenarios?.base ?? null;
  const decision     = (base?.decision ?? null) as Decision;
  const reasons      = base?.reasons ?? [];
  const breakdown    = marcheSaved?.breakdown;

  const smartScore   = marcheSaved?.scoreGlobal ?? null;
  const confidence   = breakdown ? Math.round(((breakdown.demande ?? 0) + (breakdown.offre ?? 0) + (breakdown.accessibilite ?? 0)) / 3) : null;
  const risque       = breakdown?.environnement ?? null;
  const potentiel    = base?.margePct != null ? Math.min(100, Math.round(base.margePct * 4)) : null;

  const feuxVerts    = useMemo(() => buildFeuxVerts(reasons, breakdown),  [reasons, breakdown]);
  const vigilances   = useMemo(() => buildVigilances(reasons, breakdown), [reasons, breakdown]);
  const killSwitches = useMemo(() => (decision === "NO_GO" && reasons.length > 0 ? reasons : []), [decision, reasons]);

  const hasGeorisques  = !!(marcheSaved?.data as Record<string, unknown>)?.scores;
  const handleAnalysed = useCallback(() => {}, []);

  return (
    <div className="space-y-5">
      <DealScorecard smartScore={smartScore} confidence={confidence} risque={risque} potentiel={potentiel} />
      <ExecutiveSummaryBlock deal={deal} computed={computed} />
      <GeorisquesBlock deal={deal} marcheSaved={marcheSaved} onAnalysed={handleAnalysed} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionBox
          title="Points favorables" subtitle="Éléments jouant en faveur de l'opération."
          badgeLabel={feuxVerts.length > 0 ? `${feuxVerts.length} point${feuxVerts.length > 1 ? "s" : ""}` : "En attente"}
          badgeVariant={feuxVerts.length > 0 ? "positive" : "neutral"} items={feuxVerts}
          emptyMessage="Les points favorables apparaîtront ici après l'exécution du SmartScore et de l'analyse des risques."
        />
        <SectionBox
          title="Points de vigilance" subtitle="Éléments requérant une attention particulière."
          badgeLabel={vigilances.length > 0 ? `${vigilances.length} point${vigilances.length > 1 ? "s" : ""}` : "En attente"}
          badgeVariant={vigilances.length > 0 ? "warning" : "neutral"} items={vigilances}
          emptyMessage="Les points de vigilance apparaîtront ici après l'analyse SmartScore, Géorisques et marché."
        />
      </div>
      <SectionBox
        title="Kill Switches" subtitle="Conditions déclenchant un stop immédiat ou une renégociation forte."
        badgeLabel={killSwitches.length > 0 ? `${killSwitches.length} signal${killSwitches.length > 1 ? "s" : ""}` : "Rien à signaler"}
        badgeVariant={killSwitches.length > 0 ? "danger" : "positive"} items={killSwitches}
        emptyMessage="Aucun kill switch détecté — l'analyse des risques n'a pas encore été lancée."
      />
      <OriginesDonnees hasMarche={!!marcheSaved?.data} hasGeorisques={hasGeorisques} />
      <RecommandationBlock decision={decision} />
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function DealCenterPage() {
  const location = useLocation();

  const activeTab: TabId = useMemo(() => {
    const sp  = new URLSearchParams(location.search);
    const tab = sp.get("tab") as TabId | null;
    if (tab && TABS.some((t) => t.id === tab)) return tab;
    return "qualification";
  }, [location.search]);

  const tabTitles: Record<TabId, string> = {
    qualification:    "Qualification",
    data_confidence:  "Confiance données",
    investment_pack:  "Pack investisseur",
    committee_review: "Revue comité",
    financial_engine: "Moteur financier",
    exports:          "Exports",
  };

  return (
    <div className="space-y-5">

      {/* ─── Bandeau bleu Investisseur ─────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
        borderRadius: 24,
        padding: "32px 36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        boxShadow: "0 8px 32px rgba(33,150,243,0.22)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
            Investisseur · Deal Center
          </div>
          <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>

            {tabTitles[activeTab]}
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Scoring, qualification, pack investisseur et revue comité.
          </div>
        </div>
      </div>

      {/* ─── Encart Deal Center vs SmartScore ──────────────────────────────── */}
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-sky-50/40 shadow-sm p-5 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
            <Gauge className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Deal Center — au-delà du SmartScore</h2>
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">
              Le <span className="font-semibold text-indigo-700">SmartScore</span> évalue la qualité intrinsèque d'un bien
              (marché, transport, services, environnement). Le <span className="font-semibold text-gray-900">Deal Center</span> va plus loin :
              il croise ces données avec <span className="font-medium">votre montage financier</span>, les <span className="font-medium">risques Géorisques</span> et
              le <span className="font-medium">contexte de l'opération</span> pour produire une décision d'investissement complète —
              scorecard, recommandation, pack investisseur et revue comité.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: "SmartScore",    desc: "Qualité du bien",            color: "bg-indigo-100 text-indigo-700"   },
                { label: "+ Rentabilité", desc: "TRI, marge, montage",        color: "bg-sky-100 text-sky-700"         },
                { label: "+ Géorisques",  desc: "Risques réglementaires",     color: "bg-emerald-100 text-emerald-700" },
                { label: "= Deal Score",  desc: "Décision d'investissement",  color: "bg-gray-900 text-white"          },
              ].map(({ label, desc, color }) => (
                <div key={label} className={["inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold", color].join(" ")}>
                  {label}<span className="opacity-60 font-normal">· {desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {activeTab === "qualification"    && <QualificationTab />}
      {activeTab === "data_confidence"  && <DataConfidenceTab />}
      {activeTab === "investment_pack"  && <InvestmentPackTab />}
      {activeTab === "committee_review" && <CommitteeReviewTab />}
      {activeTab === "financial_engine" && <FinancialEngineTab />}
      {activeTab === "exports"          && <ExportsTab />}
    </div>
  );
}