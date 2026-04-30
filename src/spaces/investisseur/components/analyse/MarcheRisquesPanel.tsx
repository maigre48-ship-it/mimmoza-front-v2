/**
 * MarcheRisquesPanel.tsx
 * ─────────────────────────────────────────────────────────────────────
 * v3.8:
 *  • Transport card enrichie : arrêt nommé, nb arrêts 10min à pied, badges modes
 *
 * v3.7:
 *  • NOUVEAU: BpeServicesWidget — grille visuelle Services & Équipements
 *    style Promoteur (cartes bordure colorée, top items, expand/collapse)
 *    Inséré dans ResultsView après la grille des 4 cards DVF/INSEE/Transport/BPE
 *    Source: core.bpe déjà hydraté par displayResult/supplementCoreFromPromoteur
 *
 * v3.6:
 *  • FIX CRITIQUE: MenagesImposesStat — ajout `part_menages_imposes`
 *    (nom exact du champ retourné par l'edge function market-study-promoteur-v1)
 *    comme PREMIER fallback. Les 6 fallbacks précédents ne matchaient pas.
 *  • FIX: mergeSubObject inseeNumFields — ajout `part_menages_imposes`
 *
 * v3.5: BPE/Transport merge champ par champ via mergeSubObject
 * v3.4: displayResult, supplementCoreFromPromoteur, MenagesImposesStat 6 fallbacks
 * v3.3: promoteurMarketData, tryExtractMarketStudy, hydratation fallback
 * v3.2: StrictMode fix, resultRef, abort detection
 * v3.1: LoadingBanner
 * v3:   Hydrate from snapshot, dealId persist, DetailsBlock
 * ─────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  fetchMarketStudyPromoteur,
  type MarketStudyInput,
  type MarketStudyResult,
  type Insight,
} from "../../services/marketStudyPromoteur.service";
import {
  readMarchandSnapshot,
  patchMarcheRisquesForDeal,
} from "../../../marchand/shared/marchandSnapshot.store";

// ─── Props ───────────────────────────────────────────────────────────

interface DealInputs {
  address?: string;
  zipCode?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

interface MarcheRisquesPanelProps {
  dealId: string;
  dealInputs: DealInputs;
  promoteurMarketData?: Record<string, unknown> | null;
}

type Status = "idle" | "loading" | "success" | "error";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("fr-FR") + suffix;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";
}
function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return d; }
}

/** Retourne true si le nom d'arrêt est un placeholder du fallback statique. */
function isEstimationStop(name: string | null | undefined): boolean {
  if (!name) return true;
  return name.includes("(estimation)") || name.includes("estimation");
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-sm font-semibold text-gray-700 w-10 text-right">{value}</span>
    </div>
  );
}

const INS_STYLE: Record<string, string> = { positive: "bg-emerald-50 text-emerald-700 border-emerald-200", warning: "bg-amber-50 text-amber-700 border-amber-200", negative: "bg-red-50 text-red-700 border-red-200", neutral: "bg-gray-50 text-gray-600 border-gray-200" };
const INS_ICON: Record<string, string> = { positive: "✅", warning: "⚠️", negative: "❌", neutral: "ℹ️" };
function InsightBadge({ insight }: { insight: Insight }) {
  return (<div className={`text-xs px-3 py-1.5 rounded-md border ${INS_STYLE[insight.type] ?? INS_STYLE.neutral}`}><span className="mr-1">{INS_ICON[insight.type] ?? "ℹ️"}</span>{insight.message}</div>);
}

function Card({ title, icon, children, coverage }: { title: string; icon: string; children: React.ReactNode; coverage?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2"><span>{icon}</span>{title}</h3>
        {coverage && (<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${coverage === "ok" ? "bg-emerald-50 text-emerald-600" : coverage === "partial" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}`}>{coverage === "ok" ? "✓ OK" : coverage === "partial" ? "Partiel" : "Pas de données"}</span>)}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (<div className="flex items-center justify-between py-1"><span className="text-xs text-gray-500">{label}</span><span className="text-sm font-medium text-gray-800">{value}</span></div>);
}

// ─── v3.6 FIX: ajout `part_menages_imposes` (nom exact edge function) ──

function MenagesImposesStat({ insee }: { insee: any }) {
  const v =
    insee?.part_menages_imposes ??           // ← v3.6: nom exact retourné par l'edge function
    insee?.part_menages_imposes_pct ??
    insee?.partMenagesImposes ??
    insee?.pctMenagesImposes ??
    insee?.menages_imposes_pct ??
    insee?.pct_menages_imposes ??
    insee?.part_imp;
  const isNd = v == null || !Number.isFinite(v);
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-500 inline-flex items-center gap-1">
        % ménages imposés
        {isNd && (<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" title="Donnée FiLoSoFi non disponible (non importée)">ⓘ</span>)}
      </span>
      <span className="text-sm font-medium text-gray-800" title={isNd ? "Donnée FiLoSoFi non disponible (non importée)" : undefined}>
        {isNd ? "ND" : fmtPct(v)}
      </span>
    </div>
  );
}

function Accordion({ title, icon, badge, defaultOpen = false, children }: { title: string; icon: string; badge?: string | number; defaultOpen?: boolean; children: React.ReactNode; }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        <span className="text-sm font-semibold text-gray-800 flex items-center gap-2"><span>{icon}</span>{title}{badge != null && (<span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">{badge}</span>)}</span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function NoData({ text = "Aucun détail disponible" }: { text?: string }) { return <p className="text-xs text-gray-400 italic py-3 text-center">{text}</p>; }

function DvfTransactionsDetail({ transactions }: { transactions: any[] | undefined }) {
  if (!transactions || transactions.length === 0) return <NoData text="Aucune transaction DVF disponible" />;
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs">
        <thead><tr className="text-left border-b border-gray-200 text-gray-500"><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium text-right">Surface</th><th className="py-2 pr-3 font-medium text-right">Valeur</th><th className="py-2 font-medium text-right">€/m²</th></tr></thead>
        <tbody>{transactions.map((tx, i) => (<tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50"><td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{fmtDate(tx.date_mutation)}</td><td className="py-1.5 pr-3 text-gray-700"><span className="inline-flex items-center gap-1">{tx.type_local === "Appartement" ? "🏢" : tx.type_local === "Maison" ? "🏠" : "🏗️"}<span className="truncate max-w-[120px]">{tx.type_local || "—"}</span></span></td><td className="py-1.5 pr-3 text-right text-gray-600">{tx.surface_reelle_bati ? `${fmtNum(tx.surface_reelle_bati)} m²` : "—"}</td><td className="py-1.5 pr-3 text-right text-gray-700 font-medium">{fmtEur(tx.valeur_fonciere)}</td><td className="py-1.5 text-right font-semibold text-gray-800">{fmtEur(tx.prix_m2)}</td></tr>))}</tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-2 text-right">{transactions.length} transaction{transactions.length > 1 ? "s" : ""}</p>
    </div>
  );
}

const BPE_CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "commerces", label: "Commerces", icon: "🛒" }, { key: "sante", label: "Santé", icon: "🏥" },
  { key: "services", label: "Services", icon: "🏛️" }, { key: "education", label: "Éducation", icon: "🎓" },
  { key: "loisirs", label: "Loisirs", icon: "🎭" },
];

function BpeEquipementsDetail({ bpe }: { bpe: any }) {
  const [activeTab, setActiveTab] = useState("commerces");
  if (!bpe || bpe.total_equipements === 0) return <NoData text="Aucun équipement BPE disponible" />;
  const activeCat = bpe[activeTab] as { count: number; details: { label: string; distance_m: number }[] } | undefined;
  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap gap-1.5">{BPE_CATEGORIES.map((cat) => { const count = (bpe[cat.key] as { count: number } | undefined)?.count ?? 0; const isActive = activeTab === cat.key; return (<button key={cat.key} type="button" onClick={() => setActiveTab(cat.key)} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${isActive ? "bg-indigo-50 text-indigo-700 border border-indigo-200" : "bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100"}`}><span>{cat.icon}</span>{cat.label}<span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"}`}>{count}</span></button>); })}</div>
      {activeCat && activeCat.details && activeCat.details.length > 0 ? (<div className="space-y-0.5">{activeCat.details.map((item, i) => (<div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50/80"><span className="text-xs text-gray-700 truncate max-w-[70%]">{item.label}</span><span className="text-xs text-gray-400 font-mono shrink-0">{item.distance_m != null ? `${fmtNum(item.distance_m)} m` : "—"}</span></div>))}</div>) : (<NoData text={`Aucun équipement dans "${BPE_CATEGORIES.find((c) => c.key === activeTab)?.label}"`} />)}
    </div>
  );
}

// ─── v3.7: BpeServicesWidget — grille visuelle style Promoteur ────────

const BPE_CATEGORY_CONFIG: {
  key: string;
  label: string;
  icon: string;
  color: string;
  textColor: string;
}[] = [
  { key: "commerces", label: "Commerces", icon: "🛒", color: "border-amber-400",  textColor: "text-amber-500"  },
  { key: "sante",     label: "Santé",     icon: "🏥", color: "border-red-400",    textColor: "text-red-500"    },
  { key: "services",  label: "Services",  icon: "🏛️", color: "border-blue-400",   textColor: "text-blue-500"   },
  { key: "education", label: "Éducation", icon: "🎓", color: "border-violet-400", textColor: "text-violet-500" },
  { key: "loisirs",   label: "Loisirs",   icon: "🎭", color: "border-pink-400",   textColor: "text-pink-500"   },
];

const BPE_PREVIEW_COUNT = 2;

function BpeServiceCard({
  cfg,
  data,
}: {
  cfg: (typeof BPE_CATEGORY_CONFIG)[number];
  data: { count: number; details: { label: string; distance_m: number }[] } | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = data?.count ?? 0;
  const details = data?.details ?? [];
  const visible = expanded ? details : details.slice(0, BPE_PREVIEW_COUNT);
  const remaining = details.length - BPE_PREVIEW_COUNT;

  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm border-l-4 ${cfg.color} overflow-hidden`}>
      <button
        type="button"
        onClick={() => count > 0 && setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <span>{cfg.icon}</span>
          {cfg.label}
        </span>
        <span className="flex items-center gap-2">
          <span className={`text-lg font-black ${cfg.textColor}`}>{count}</span>
          {count > 0 && (
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </span>
      </button>

      {count > 0 && (
        <div className="px-4 pb-3">
          {visible.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-t border-gray-50">
              <span className="text-xs text-gray-700 uppercase tracking-wide truncate max-w-[72%]">
                {item.label}
              </span>
              <span className="text-xs text-gray-400 font-mono shrink-0">
                {item.distance_m != null
                  ? item.distance_m >= 1000
                    ? `${(item.distance_m / 1000).toFixed(1)}km`
                    : `${fmtNum(item.distance_m)}m`
                  : "—"}
              </span>
            </div>
          ))}
          {!expanded && remaining > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className={`mt-1.5 text-xs font-medium ${cfg.textColor} hover:underline`}
            >
              + {remaining} autres...
            </button>
          )}
          {expanded && details.length > BPE_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-1.5 text-xs font-medium text-gray-400 hover:underline"
            >
              Réduire
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BpeServicesWidget({ bpe }: { bpe: any }) {
  if (!bpe || (bpe.total_equipements === 0 && !bpe.commerces)) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        🏪 Services &amp; Équipements
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
          BPE · {bpe.total_equipements ?? 0} total
        </span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {BPE_CATEGORY_CONFIG.map((cfg) => (
          <BpeServiceCard key={cfg.key} cfg={cfg} data={bpe[cfg.key]} />
        ))}
      </div>
    </div>
  );
}

// ─── Transport detail ─────────────────────────────────────────────────

const TRANSPORT_ICONS: Record<string, string> = { metro: "🚇", train: "🚆", tram: "🚊", bus: "🚌" };
const TRANSPORT_BADGE_STYLE: Record<string, string> = { metro: "bg-purple-50 text-purple-700", train: "bg-blue-50 text-blue-700", tram: "bg-teal-50 text-teal-700", bus: "bg-orange-50 text-orange-700" };

function TransportDetail({ transport }: { transport: any }) {
  const realStops = (transport?.stops ?? []).filter((s: any) => !isEstimationStop(s.name));
  if (!transport || realStops.length === 0) return <NoData text="Aucun arrêt de transport disponible" />;
  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap gap-2">
        {transport.nearest_stop_m != null && (<span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">📍 Plus proche : {fmtNum(transport.nearest_stop_m)} m</span>)}
        {transport.has_metro_train && (<span className="text-[10px] px-2 py-1 rounded-full bg-purple-50 text-purple-600 font-medium">🚇 Métro / Train</span>)}
        {transport.has_tram && (<span className="text-[10px] px-2 py-1 rounded-full bg-teal-50 text-teal-600 font-medium">🚊 Tramway</span>)}
      </div>
      <div className="space-y-0.5">
        {realStops.map((stop: { name: string; type: string; distance_m: number }, i: number) => (
          <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50/80">
            <span className="text-sm shrink-0">{TRANSPORT_ICONS[stop.type] ?? "🚏"}</span>
            <span className="text-xs text-gray-700 truncate flex-1">{stop.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${TRANSPORT_BADGE_STYLE[stop.type] ?? "bg-gray-100 text-gray-500"}`}>{stop.type}</span>
            <span className="text-xs text-gray-400 font-mono shrink-0 w-16 text-right">{fmtNum(stop.distance_m)} m</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 text-right">{realStops.length} arrêt{realStops.length > 1 ? "s" : ""}</p>
    </div>
  );
}

function DetailsBlock({ data }: { data: MarketStudyResult }) {
  const core = data.core ?? ({} as Record<string, any>);
  const dvf = core.dvf ?? null; const bpe = core.bpe ?? null; const transport = core.transport ?? null;
  const realStopsCount = (transport?.stops ?? []).filter((s: any) => !isEstimationStop(s.name)).length;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">📋 Détails</h3>
      <Accordion title="Transactions DVF (30 dernières)" icon="🏠" badge={(dvf?.transactions?.length ?? 0) > 0 ? dvf.transactions.length : undefined}><DvfTransactionsDetail transactions={dvf?.transactions} /></Accordion>
      <Accordion title="Équipements / Commerces (BPE)" icon="🏪" badge={(bpe?.total_equipements ?? 0) > 0 ? bpe.total_equipements : undefined}><BpeEquipementsDetail bpe={bpe} /></Accordion>
      <Accordion title="Transport (OSM)" icon="🚇" badge={realStopsCount > 0 ? realStopsCount : undefined}><TransportDetail transport={transport} /></Accordion>
    </div>
  );
}

function LoadingBanner() {
  return (<div className="flex justify-center py-8"><div className="inline-flex items-center gap-4 rounded-2xl border border-sky-200 bg-sky-50/80 px-6 py-4 shadow-sm"><div className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-sky-200 border-t-sky-600" /><div><div className="text-sm font-semibold text-sky-900">Analyse de marché en cours…</div><div className="text-xs text-sky-600 mt-0.5">Veuillez patienter.</div></div></div></div>);
}

function ErrorState({ error, details, onRetry }: { error: string; details?: unknown; onRetry: () => void }) {
  return (<div className="bg-white rounded-xl border border-red-200 shadow-sm p-6 text-center"><div className="text-4xl mb-3">⚠️</div><h3 className="text-base font-semibold text-gray-900 mb-1">Données indisponibles</h3><p className="text-sm text-red-600 mb-4">{error}</p>{details && (<details className="text-left text-xs text-gray-400 mb-4 max-w-lg mx-auto"><summary className="cursor-pointer hover:text-gray-600">Détails techniques</summary><pre className="mt-2 p-2 bg-gray-50 rounded overflow-auto max-h-40">{typeof details === "string" ? details : JSON.stringify(details, null, 2)}</pre></details>)}<button onClick={onRetry} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">🔄 Réessayer</button></div>);
}

// ─── Results ─────────────────────────────────────────────────────────

function ResultsView({ data, showDetails }: { data: MarketStudyResult; showDetails: boolean }) {
  const scores = data.scores ?? ({} as Record<string, any>);
  const scoring_details = data.scoring_details ?? ({} as Record<string, any>);
  const core = data.core ?? ({} as Record<string, any>);
  const insights = data.insights ?? ([] as Insight[]);
  const warnings = data.warnings ?? ([] as string[]);
  const meta = data.meta ?? ({} as Record<string, any>);
  const dvf = core.dvf ?? null; const insee = core.insee ?? null;
  const transport = core.transport ?? null; const bpe = core.bpe ?? null;
  const globalScore = typeof scores.global === "number" && Number.isFinite(scores.global) ? scores.global : 0;
  const bpeCoverage: string | undefined = bpe?.coverage ?? (bpe && (bpe.total_equipements > 0 || bpe.score > 0 || bpe.score_v2 > 0) ? "ok" : undefined);

  // v3.8: stops réels (hors placeholder estimation)
  const realStops = (transport?.stops ?? []).filter((s: any) => !isEstimationStop(s.name));
  const firstRealStop = realStops[0] ?? null;
  const realStopsCount = realStops.length;
  const realModes = Array.from(new Set(realStops.map((s: any) => (s.mode ?? s.type) as string).filter(Boolean))) as string[];

  return (
    <div className="space-y-5">
      {/* Score global */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">🎯 Score global</h2><p className="text-xs text-gray-400 mt-0.5">{meta.commune_nom ?? "—"} · {meta.project_type_label ?? "—"} · rayon {meta.radius_km ?? "?"} km</p></div>
          <div className="text-right"><div className={`text-4xl font-black ${globalScore >= 70 ? "text-emerald-600" : globalScore >= 50 ? "text-amber-500" : "text-red-500"}`}>{globalScore}<span className="text-lg font-normal text-gray-400">/100</span></div></div>
        </div>
        <div className="space-y-2"><ScoreBar label="Demande" value={scores.demande ?? 0} /><ScoreBar label="Offre" value={scores.offre ?? 0} /><ScoreBar label="Accessibilité" value={scores.accessibilite ?? 0} /><ScoreBar label="Environnement" value={scores.environnement ?? 0} /></div>
        {scoring_details?.adjustments?.length > 0 && (<div className="mt-3 flex flex-wrap gap-1.5">{scoring_details.adjustments.map((adj: any, i: number) => (<span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${adj.type === "bonus" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>{adj.type === "bonus" ? "+" : ""}{adj.value} {adj.label}</span>))}</div>)}
      </div>

      {/* Grille 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="DVF — Transactions" icon="🏠" coverage={dvf?.coverage}>
          {dvf && dvf.nb_transactions > 0 ? (<><Stat label="Transactions" value={fmtNum(dvf.nb_transactions)} /><Stat label="Prix médian /m²" value={fmtNum(dvf.prix_m2_median, " €")} /><Stat label="Prix moyen /m²" value={fmtNum(dvf.prix_m2_moyen, " €")} /><Stat label="Min /m²" value={fmtNum(dvf.prix_m2_min, " €")} /><Stat label="Max /m²" value={fmtNum(dvf.prix_m2_max, " €")} /><Stat label="Évolution" value={fmtPct(dvf.evolution_prix_pct)} /></>) : <p className="text-xs text-gray-400 italic">Aucune transaction</p>}
        </Card>
        <Card title="INSEE — Socio-démographie" icon="👥" coverage={insee?.coverage}>
          {insee ? (<><Stat label="Population" value={fmtNum(insee.population)} /><Stat label="Densité" value={fmtNum(insee.densite, " hab/km²")} /><Stat label={`Revenu médian${insee.incomeMedianUcYear ? ` (${insee.incomeMedianUcYear})` : ""}`} value={fmtNum(insee.revenu_median, " €/UC/an")} /><Stat label="Taux pauvreté" value={fmtPct(insee.taux_pauvrete)} /><Stat label="Taux chômage" value={fmtPct(insee.taux_chomage)} /><MenagesImposesStat insee={insee} />{insee.revenu_source && (<p className="text-[10px] text-gray-400 mt-1">Source: {insee.revenu_source}</p>)}</>) : <p className="text-xs text-gray-400 italic">Données INSEE indisponibles</p>}
        </Card>
        <Card title="Transport" icon="🚇" coverage={transport?.coverage}>
          {transport ? (
            <>
              <Stat label="Score transport" value={`${transport.score ?? 0}/100`} />
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">Arrêt le plus proche</span>
                <span className="text-sm font-medium text-gray-800 text-right max-w-[55%] truncate">
                  {transport.nearest_stop_m != null
                    ? firstRealStop
                      ? `${firstRealStop.name} — ${fmtNum(transport.nearest_stop_m)} m`
                      : fmtNum(transport.nearest_stop_m, " m")
                    : "—"}
                </span>
              </div>
              <Stat label="Métro / Train" value={transport.has_metro_train ? "✅ Oui" : "❌ Non"} />
              <Stat label="Tramway" value={transport.has_tram ? "✅ Oui" : "❌ Non"} />
              <Stat label="Arrêts (10min à pied)" value={realStopsCount > 0 ? fmtNum(realStopsCount) : fmtNum(transport.stops?.length ?? 0)} />
              {realModes.length > 1 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {realModes.slice(0, 4).map((m, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{m}</span>
                  ))}
                </div>
              )}
            </>
          ) : <p className="text-xs text-gray-400 italic">Données transport indisponibles</p>}
        </Card>
        <Card title="BPE — Équipements" icon="🏪" coverage={bpeCoverage}>
          {bpe && (bpe.total_equipements > 0 || bpe.score > 0 || bpe.score_v2 > 0) ? (<><Stat label="Total équipements" value={fmtNum(bpe.total_equipements)} /><Stat label="Score BPE" value={`${bpe.score_v2 ?? bpe.score ?? 0}/100`} /><div className="border-t border-gray-100 mt-2 pt-2"><Stat label="Écoles" value={fmtNum(bpe.nb_ecoles)} /><Stat label="Pharmacies" value={fmtNum(bpe.nb_pharmacies)} /><Stat label="Supermarchés" value={fmtNum(bpe.nb_supermarches)} /><Stat label="Universités / Sup." value={fmtNum(bpe.nb_universites)} /></div><div className="border-t border-gray-100 mt-2 pt-2"><Stat label="Commerces" value={fmtNum(bpe.commerces?.count)} /><Stat label="Santé" value={fmtNum(bpe.sante?.count)} /><Stat label="Éducation" value={fmtNum(bpe.education?.count)} /><Stat label="Loisirs" value={fmtNum(bpe.loisirs?.count)} /></div></>) : <p className="text-xs text-gray-400 italic">Aucun équipement</p>}
        </Card>
      </div>

      {/* ─── v3.7: Grille Services & Équipements BPE ─── */}
      <BpeServicesWidget bpe={bpe} />

      {insights && insights.length > 0 && (<div className="space-y-2"><h3 className="text-sm font-semibold text-gray-700">💡 Insights</h3><div className="flex flex-wrap gap-2">{insights.map((ins, i) => <InsightBadge key={i} insight={ins} />)}</div></div>)}
      {warnings && warnings.length > 0 && (<div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1"><h3 className="text-sm font-semibold text-amber-700">⚠️ Avertissements</h3>{warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}</div>)}
      {showDetails && <DetailsBlock data={data} />}
      <p className="text-[10px] text-gray-400 text-right">v{data.version ?? "?"} · {meta.generated_at ? new Date(meta.generated_at).toLocaleString("fr-FR") : ""} · source: {meta.location_source ?? "—"}</p>
    </div>
  );
}

// ─── Debug panel ─────────────────────────────────────────────────────

function DebugPanel({ debug }: { debug: Record<string, unknown> }) {
  const filosofi = debug.filosofi as Record<string, unknown> | null;
  const bpeTop = debug.bpeTopTypequ as Array<{ type: string; label: string; count: number }> | null;
  const bpeSample = debug.bpeSample as Array<Record<string, unknown>> | null;
  return (
    <div className="space-y-3 text-xs text-gray-500">
      <details><summary className="cursor-pointer font-semibold hover:text-gray-700">🗄️ FiLoSoFi debug</summary>{filosofi ? (<div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1"><p><strong>row_found:</strong> {String(filosofi.row_found)}</p><p><strong>used_code:</strong> {String(filosofi.used_code)}</p><p><strong>table_queried:</strong> {String(filosofi.table_queried)}</p><p><strong>query_keys_tried:</strong> {JSON.stringify(filosofi.query_keys_tried)}</p><p><strong>all_keys_count:</strong> {String(filosofi.all_keys_count)}</p><p><strong>med_col:</strong> {JSON.stringify(filosofi.med_col)}</p><p><strong>med_raw:</strong> {JSON.stringify(filosofi.med_raw)}</p><p><strong>txpau_col:</strong> {JSON.stringify(filosofi.txpau_col)}</p><p><strong>txpau_raw:</strong> {JSON.stringify(filosofi.txpau_raw)}</p><p><strong>partimp_col:</strong> {JSON.stringify(filosofi.partimp_col)}</p><p><strong>partimp_raw:</strong> {JSON.stringify(filosofi.partimp_raw)}</p>{filosofi.sample_keys && (<details className="mt-1"><summary className="cursor-pointer">sample_keys ({(filosofi.sample_keys as string[]).length})</summary><pre className="mt-1 p-2 bg-white rounded overflow-auto max-h-32 text-[10px]">{JSON.stringify(filosofi.sample_keys, null, 2)}</pre></details>)}</div>) : (<p className="mt-1 text-gray-400 italic">Pas de debug filosofi. Source: {String(debug.insee_revenu_source ?? "?")}</p>)}</details>
      <details><summary className="cursor-pointer font-semibold hover:text-gray-700">🏪 BPE typequ debug</summary><div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200"><p><strong>Total rows fetched:</strong> {String(debug.bpeTotalRowsFetched ?? "?")}</p>{bpeTop && bpeTop.length > 0 ? (<table className="mt-2 w-full text-[10px]"><thead><tr className="text-left border-b border-gray-200"><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Label</th><th className="py-1 text-right">Count</th></tr></thead><tbody>{bpeTop.map((row, i) => (<tr key={i} className={`border-b border-gray-100 ${row.type === "D301" || row.type === "B101" || row.type === "B102" ? "bg-yellow-50 font-semibold" : ""}`}><td className="py-0.5 pr-2 font-mono">{row.type}</td><td className="py-0.5 pr-2">{row.label}</td><td className="py-0.5 text-right">{row.count}</td></tr>))}</tbody></table>) : <p className="text-gray-400 italic mt-1">Aucune donnée typequ</p>}</div></details>
      {bpeSample && bpeSample.length > 0 && (<details><summary className="cursor-pointer font-semibold hover:text-gray-700">📋 BPE sample rows ({bpeSample.length})</summary><pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-auto max-h-48 text-[10px]">{JSON.stringify(bpeSample, null, 2)}</pre></details>)}
      {debug.insee_warnings && (debug.insee_warnings as string[]).length > 0 && (<details><summary className="cursor-pointer font-semibold hover:text-gray-700">⚠️ INSEE warnings</summary><ul className="mt-2 space-y-1 list-disc list-inside">{(debug.insee_warnings as string[]).map((w, i) => <li key={i}>{w}</li>)}</ul></details>)}
      {debug.timings && (<details><summary className="cursor-pointer font-semibold hover:text-gray-700">⏱️ Timings</summary><pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-auto text-[10px]">{JSON.stringify(debug.timings, null, 2)}</pre></details>)}
      <details><summary className="cursor-pointer font-semibold hover:text-gray-700">📦 Raw debug JSON</summary><pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-auto max-h-96 text-[10px]">{JSON.stringify(debug, null, 2)}</pre></details>
    </div>
  );
}

// ─── Snapshot / abort helpers ────────────────────────────────────────

function readSavedMarcheRisques(dealId: string): { data: MarketStudyResult; updatedAt: string } | null {
  try { const snap = readMarchandSnapshot(); const saved = snap.marcheRisquesByDeal[dealId] as Record<string, any> | undefined; if (!saved) return null; const data = saved.data as MarketStudyResult | undefined; if (!data || typeof data !== "object") return null; if (!data.scores && !data.core) return null; return { data, updatedAt: saved.updatedAt ?? "" }; }
  catch (e) { console.warn("[MarcheRisques] Failed to read snapshot:", e); return null; }
}
function isSavedDataStale(updatedAt: string): boolean { if (!updatedAt) return true; try { const t = new Date(updatedAt).getTime(); if (!Number.isFinite(t)) return true; return Date.now() - t > STALE_THRESHOLD_MS; } catch { return true; } }
function isAbortedResponse(res: { ok: boolean; error?: string; details?: unknown }): boolean { if (res.ok) return false; if (res.details && typeof res.details === "object" && (res.details as Record<string, unknown>).reason === "aborted_by_caller") return true; if (typeof res.error === "string" && res.error.toLowerCase().includes("annulée")) return true; return false; }
function isAbortError(err: unknown): boolean { if (err instanceof DOMException && err.name === "AbortError") return true; if (err instanceof Error && err.message?.toLowerCase().includes("abort")) return true; return false; }

function tryExtractMarketStudy(obj: Record<string, unknown> | null | undefined): MarketStudyResult | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.scores || obj.core) return obj as unknown as MarketStudyResult;
  const inner = obj.data; if (inner && typeof inner === "object") { const d = inner as Record<string, unknown>; if (d.scores || d.core) return d as unknown as MarketStudyResult; }
  const market = (obj.market ?? {}) as Record<string, unknown>; const housing = (obj.housing ?? {}) as Record<string, unknown>; const comparables = (obj.comparables ?? []) as unknown[]; const risks = (obj.risks ?? {}) as Record<string, unknown>; const sources = (obj.sources ?? []) as unknown[];
  if (Object.keys(market).length === 0 && Object.keys(housing).length === 0 && comparables.length === 0 && Object.keys(risks).length === 0 && sources.length === 0) return null;
  return { scores: (obj.scores ?? market.scores ?? { global: 0, demande: 0, offre: 0, accessibilite: 0, environnement: 0 }) as MarketStudyResult["scores"], scoring_details: (obj.scoring_details ?? {}) as MarketStudyResult["scoring_details"], core: (obj.core ?? { dvf: market.dvf ?? housing.dvf ?? null, insee: market.insee ?? housing.insee ?? null, transport: market.transport ?? housing.transport ?? null, bpe: market.bpe ?? housing.bpe ?? null }) as MarketStudyResult["core"], insights: (obj.insights ?? market.insights ?? []) as MarketStudyResult["insights"], warnings: (obj.warnings ?? market.warnings ?? []) as MarketStudyResult["warnings"], meta: (obj.meta ?? market.meta ?? { commune_insee: "", commune_nom: "", project_type_label: "", radius_km: 5, location_source: "promoteur-bridge" }) as MarketStudyResult["meta"], version: (obj.version ?? market.version ?? "bridge") as string, debug: (obj.debug ?? market.debug ?? undefined) as MarketStudyResult["debug"] } as MarketStudyResult;
}

// ─── v3.5 + v3.6: supplementCoreFromPromoteur ────────────────────────

function isNonEmpty(v: unknown): boolean { if (v == null) return false; if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) return false; return true; }
function hasPositive(v: unknown): boolean { return typeof v === "number" && Number.isFinite(v) && v > 0; }

function mergeSubObject(investor: Record<string, unknown> | null | undefined, promoteur: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!isNonEmpty(promoteur)) return (investor as Record<string, unknown>) ?? null;
  if (!isNonEmpty(investor)) return (promoteur as Record<string, unknown>) ?? null;
  const inv = investor as Record<string, unknown>; const pro = promoteur as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...pro, ...inv };
  const allKeys = new Set([...Object.keys(inv), ...Object.keys(pro)]);
  for (const key of allKeys) {
    const invVal = inv[key]; const proVal = pro[key];
    if (typeof proVal === "number" && hasPositive(proVal) && !hasPositive(invVal)) { merged[key] = proVal; continue; }
    if (typeof proVal === "object" && proVal !== null && !Array.isArray(proVal)) { if (!isNonEmpty(invVal) && isNonEmpty(proVal)) { merged[key] = proVal; continue; } }
    if (Array.isArray(proVal) && proVal.length > 0) { if (!Array.isArray(invVal) || invVal.length === 0) { merged[key] = proVal; continue; } }
  }
  return merged;
}

function supplementCoreFromPromoteur(result: MarketStudyResult, promoteurMarketData: Record<string, unknown> | null | undefined): MarketStudyResult {
  if (!promoteurMarketData) return result;
  const promoteurStudy = tryExtractMarketStudy(promoteurMarketData);
  if (!promoteurStudy?.core) return result;
  const pCore = promoteurStudy.core as Record<string, any>;
  const rCore = (result.core ?? {}) as Record<string, any>;
  const mergedBpe = mergeSubObject(rCore.bpe, pCore.bpe);
  const mergedInsee = mergeSubObject(rCore.insee, pCore.insee);
  const mergedTransport = mergeSubObject(rCore.transport, pCore.transport);
  const mergedDvf = mergeSubObject(rCore.dvf, pCore.dvf);
  if (mergedBpe === rCore.bpe && mergedInsee === rCore.insee && mergedTransport === rCore.transport && mergedDvf === rCore.dvf) return result;
  if (mergedBpe !== rCore.bpe) console.debug("[InvestisseurBridge] BPE enrichi depuis promoteur");
  if (mergedInsee !== rCore.insee) console.debug("[InvestisseurBridge] INSEE enrichi depuis promoteur");
  if (mergedTransport !== rCore.transport) console.debug("[InvestisseurBridge] Transport enrichi depuis promoteur");
  if (mergedDvf !== rCore.dvf) console.debug("[InvestisseurBridge] DVF enrichi depuis promoteur");
  return { ...result, core: { ...rCore, bpe: mergedBpe, insee: mergedInsee, transport: mergedTransport, dvf: mergedDvf } as MarketStudyResult["core"] };
}

// ─── Main component ──────────────────────────────────────────────────

export default function MarcheRisquesPanel({ dealId, dealInputs, promoteurMarketData }: MarcheRisquesPanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<MarketStudyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const hydratedFromSnapshotRef = useRef(false);
  const resultRef = useRef<MarketStudyResult | null>(null); resultRef.current = result;
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const persistSuccess = useCallback((data: MarketStudyResult) => {
    if (!dealId) return;
    try { const s = data.scores; patchMarcheRisquesForDeal(dealId, { data, scoreGlobal: s?.global, breakdown: { demande: s?.demande, offre: s?.offre, accessibilite: s?.accessibilite, environnement: s?.environnement }, updatedAt: new Date().toISOString() }); }
    catch (e) { console.warn("[MarcheRisques] snapshot persist failed:", e); }
  }, [dealId]);

  const doFetch = useCallback(async () => {
    abortRef.current?.abort(); const ac = new AbortController(); abortRef.current = ac; const thisRequestId = ++requestIdRef.current;
    setStatus("loading"); setErrorMsg(null); setErrorDetails(null);
    const hasCoords = dealInputs.lat != null && dealInputs.lng != null && Number.isFinite(dealInputs.lat) && Number.isFinite(dealInputs.lng);
    const hasAddress = Boolean(dealInputs.address && dealInputs.address.trim().length > 3);
    const hasCityZip = Boolean(dealInputs.zipCode && dealInputs.city);
    if (!hasCoords && !hasAddress && !hasCityZip) { if (resultRef.current) setStatus("success"); else { setStatus("error"); setErrorMsg("Pas assez d'information de localisation."); } return; }
    const input: MarketStudyInput = { address: dealInputs.address, zipCode: dealInputs.zipCode, city: dealInputs.city, lat: dealInputs.lat, lng: dealInputs.lng, project_type: "logement", radius_km: 5, debug: debugMode };
    try {
      const res = await fetchMarketStudyPromoteur(input, ac.signal);
      if (thisRequestId !== requestIdRef.current || !mountedRef.current || ac.signal.aborted) return;
      if (isAbortedResponse(res)) { if (!resultRef.current) setStatus("idle"); else setStatus("success"); return; }
      if (res.ok) { setResult(res.data); setStatus("success"); hydratedFromSnapshotRef.current = false; persistSuccess(res.data); }
      else { if (resultRef.current) setStatus("success"); else { setErrorMsg(res.error); setErrorDetails(res.details); setStatus("error"); } }
    } catch (err: unknown) {
      if (isAbortError(err) || thisRequestId !== requestIdRef.current || !mountedRef.current) return;
      if (resultRef.current) setStatus("success"); else { setErrorMsg("Erreur inattendue"); setErrorDetails(String(err)); setStatus("error"); }
    }
  }, [dealInputs.address, dealInputs.zipCode, dealInputs.city, dealInputs.lat, dealInputs.lng, debugMode, persistSuccess]);

  useEffect(() => { if (!dealId) return; const saved = readSavedMarcheRisques(dealId); if (saved) { setResult(saved.data); setStatus("success"); hydratedFromSnapshotRef.current = true; if (isSavedDataStale(saved.updatedAt)) setShouldBackgroundFetch(true); } else { const fromPromoteur = tryExtractMarketStudy(promoteurMarketData); if (fromPromoteur) { setResult(fromPromoteur); setStatus("success"); hydratedFromSnapshotRef.current = true; setShouldBackgroundFetch(true); } else { setResult(null); setStatus("idle"); hydratedFromSnapshotRef.current = false; setShouldBackgroundFetch(true); } } }, [dealId]); // eslint-disable-line
  useEffect(() => { if (result || !promoteurMarketData || status === "loading") return; const fromPromoteur = tryExtractMarketStudy(promoteurMarketData); if (fromPromoteur) { setResult(fromPromoteur); setStatus("success"); hydratedFromSnapshotRef.current = true; } }, [promoteurMarketData]); // eslint-disable-line

  const [shouldBackgroundFetch, setShouldBackgroundFetch] = useState(false);
  useEffect(() => { if (!shouldBackgroundFetch) return; setShouldBackgroundFetch(false); doFetch(); }, [shouldBackgroundFetch]); // eslint-disable-line
  useEffect(() => { return () => { abortRef.current?.abort(); }; }, []);
  const handleRetry = useCallback(() => doFetch(), [doFetch]);

  const displayResult = useMemo<MarketStudyResult | null>(() => { if (!result) return null; return supplementCoreFromPromoteur(result, promoteurMarketData); }, [result, promoteurMarketData]);
  const showResult = displayResult != null;

  return (
    <div className="space-y-4">
      {status === "loading" && !result && <LoadingBanner />}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">📊 Marché / Risques</h2>
        <div className="flex items-center gap-3">
          {status === "loading" && result && (<span className="inline-flex items-center gap-2 text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 font-medium animate-pulse"><span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-200 border-t-blue-600" />Actualisation…</span>)}
          {hydratedFromSnapshotRef.current && status === "success" && (<span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Données en cache</span>)}
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500"><input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} className="rounded text-indigo-600 h-3.5 w-3.5" />Détails</label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500"><input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} className="rounded text-indigo-600 h-3.5 w-3.5" />Debug</label>
          {(status === "success" || result) && (<button onClick={handleRetry} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">🔄 Rafraîchir</button>)}
        </div>
      </div>
      {status === "error" && !result && (<ErrorState error={errorMsg ?? "Erreur inconnue"} details={errorDetails} onRetry={handleRetry} />)}
      {showResult && <ResultsView data={displayResult} showDetails={showDetails} />}
      {status === "idle" && !result && (<p className="text-sm text-gray-400 text-center py-10">Initialisation…</p>)}
      {debugMode && displayResult && displayResult.debug && (<div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50"><h3 className="text-sm font-semibold text-gray-700 mb-3">🐛 Debug (edge function)</h3><DebugPanel debug={displayResult.debug} /></div>)}
    </div>
  );
}