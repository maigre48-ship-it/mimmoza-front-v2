/**
 * MarcheRisquesPanel.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Onglet "Marché / Risques" de la page Analyse.
 *
 * v3:
 *  • HYDRATE au mount depuis snapshot Marchand (localStorage)
 *  • Fetch seulement si données absentes ou > 24h ou clic "Rafraîchir"
 *  • Erreur fetch ne remplace pas les données persistées valides
 *  • dealId prop pour persister résultats dans snapshot Marchand
 *  • Après fetch réussi → patchMarcheRisquesForDeal(dealId, ...)
 *  • Ajout bloc "Détails" avec toggle et 3 accordions
 *  • AbortError ne déclenche plus l'état error
 *  • requestIdRef empêche les stale responses
 * ─────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
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
}

type Status = "idle" | "loading" | "success" | "error";

// ─── Constants ───────────────────────────────────────────────────────

/** Max age before auto-refetch (24 hours in ms) */
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
  try {
    return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return d;
  }
}

// ─── ScoreBar ────────────────────────────────────────────────────────

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

// ─── InsightBadge ────────────────────────────────────────────────────

const INS_STYLE: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  negative: "bg-red-50 text-red-700 border-red-200",
  neutral: "bg-gray-50 text-gray-600 border-gray-200",
};
const INS_ICON: Record<string, string> = { positive: "✅", warning: "⚠️", negative: "❌", neutral: "ℹ️" };

function InsightBadge({ insight }: { insight: Insight }) {
  return (
    <div className={`text-xs px-3 py-1.5 rounded-md border ${INS_STYLE[insight.type] ?? INS_STYLE.neutral}`}>
      <span className="mr-1">{INS_ICON[insight.type] ?? "ℹ️"}</span>
      {insight.message}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────

function Card({ title, icon, children, coverage }: { title: string; icon: string; children: React.ReactNode; coverage?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <span>{icon}</span>{title}
        </h3>
        {coverage && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${coverage === "ok" ? "bg-emerald-50 text-emerald-600" : coverage === "partial" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-400"}`}>
            {coverage === "ok" ? "✓ OK" : coverage === "partial" ? "Partiel" : "Pas de données"}
          </span>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function MenagesImposesStat({ insee }: { insee: any }) {
  const v =
    insee?.part_menages_imposes_pct ??
    insee?.menages_imposes_pct ??
    insee?.pct_menages_imposes;

  const isNd = v == null || !Number.isFinite(v);

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-500 inline-flex items-center gap-1">
        % ménages imposés
        {isNd && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500"
            title="Donnée FiLoSoFi non disponible (non importée)"
          >
            ⓘ
          </span>
        )}
      </span>
      <span
        className="text-sm font-medium text-gray-800"
        title={isNd ? "Donnée FiLoSoFi non disponible (non importée)" : undefined}
      >
        {isNd ? "ND" : fmtPct(v)}
      </span>
    </div>
  );
}

// ─── Accordion ───────────────────────────────────────────────────────

function Accordion({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <span>{icon}</span>
          {title}
          {badge != null && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
              {badge}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── NoData placeholder ──────────────────────────────────────────────

function NoData({ text = "Aucun détail disponible" }: { text?: string }) {
  return <p className="text-xs text-gray-400 italic py-3 text-center">{text}</p>;
}

// ─── Detail: DVF Transactions ────────────────────────────────────────

function DvfTransactionsDetail({ transactions }: { transactions: any[] | undefined }) {
  if (!transactions || transactions.length === 0) return <NoData text="Aucune transaction DVF disponible" />;

  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-gray-200 text-gray-500">
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium text-right">Surface</th>
            <th className="py-2 pr-3 font-medium text-right">Valeur</th>
            <th className="py-2 font-medium text-right">€/m²</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{fmtDate(tx.date_mutation)}</td>
              <td className="py-1.5 pr-3 text-gray-700">
                <span className="inline-flex items-center gap-1">
                  {tx.type_local === "Appartement" ? "🏢" : tx.type_local === "Maison" ? "🏠" : "🏗️"}
                  <span className="truncate max-w-[120px]">{tx.type_local || "—"}</span>
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right text-gray-600">
                {tx.surface_reelle_bati ? `${fmtNum(tx.surface_reelle_bati)} m²` : "—"}
              </td>
              <td className="py-1.5 pr-3 text-right text-gray-700 font-medium">{fmtEur(tx.valeur_fonciere)}</td>
              <td className="py-1.5 text-right font-semibold text-gray-800">{fmtEur(tx.prix_m2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-2 text-right">{transactions.length} transaction{transactions.length > 1 ? "s" : ""} affichée{transactions.length > 1 ? "s" : ""}</p>
    </div>
  );
}

// ─── Detail: BPE Équipements ─────────────────────────────────────────

const BPE_CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "commerces", label: "Commerces", icon: "🛒" },
  { key: "sante", label: "Santé", icon: "🏥" },
  { key: "services", label: "Services", icon: "🏛️" },
  { key: "education", label: "Éducation", icon: "🎓" },
  { key: "loisirs", label: "Loisirs", icon: "🎭" },
];

function BpeEquipementsDetail({ bpe }: { bpe: any }) {
  const [activeTab, setActiveTab] = useState("commerces");

  if (!bpe || bpe.total_equipements === 0) return <NoData text="Aucun équipement BPE disponible" />;

  const activeCat = bpe[activeTab] as { count: number; details: { label: string; distance_m: number }[] } | undefined;

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {BPE_CATEGORIES.map((cat) => {
          const catData = bpe[cat.key] as { count: number } | undefined;
          const count = catData?.count ?? 0;
          const isActive = activeTab === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveTab(cat.key)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100"
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
              <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {activeCat && activeCat.details && activeCat.details.length > 0 ? (
        <div className="space-y-0.5">
          {activeCat.details.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50/80">
              <span className="text-xs text-gray-700 truncate max-w-[70%]">{item.label}</span>
              <span className="text-xs text-gray-400 font-mono shrink-0">
                {item.distance_m != null ? `${fmtNum(item.distance_m)} m` : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <NoData text={`Aucun équipement dans la catégorie "${BPE_CATEGORIES.find((c) => c.key === activeTab)?.label}"`} />
      )}
    </div>
  );
}

// ─── Detail: Transport ───────────────────────────────────────────────

const TRANSPORT_ICONS: Record<string, string> = {
  metro: "🚇",
  train: "🚆",
  tram: "🚊",
  bus: "🚌",
};

const TRANSPORT_BADGE_STYLE: Record<string, string> = {
  metro: "bg-purple-50 text-purple-700",
  train: "bg-blue-50 text-blue-700",
  tram: "bg-teal-50 text-teal-700",
  bus: "bg-orange-50 text-orange-700",
};

function TransportDetail({ transport }: { transport: any }) {
  if (!transport || !transport.stops || transport.stops.length === 0) {
    return <NoData text="Aucun arrêt de transport disponible" />;
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap gap-2">
        {transport.nearest_stop_m != null && (
          <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            📍 Plus proche : {fmtNum(transport.nearest_stop_m)} m
          </span>
        )}
        {transport.has_metro_train && (
          <span className="text-[10px] px-2 py-1 rounded-full bg-purple-50 text-purple-600 font-medium">
            🚇 Métro / Train
          </span>
        )}
        {transport.has_tram && (
          <span className="text-[10px] px-2 py-1 rounded-full bg-teal-50 text-teal-600 font-medium">
            🚊 Tramway
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        {transport.stops.map((stop: { name: string; type: string; distance_m: number }, i: number) => (
          <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50/80">
            <span className="text-sm shrink-0">{TRANSPORT_ICONS[stop.type] ?? "🚏"}</span>
            <span className="text-xs text-gray-700 truncate flex-1">{stop.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${TRANSPORT_BADGE_STYLE[stop.type] ?? "bg-gray-100 text-gray-500"}`}>
              {stop.type}
            </span>
            <span className="text-xs text-gray-400 font-mono shrink-0 w-16 text-right">
              {fmtNum(stop.distance_m)} m
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 text-right">{transport.stops.length} arrêt{transport.stops.length > 1 ? "s" : ""}</p>
    </div>
  );
}

// ─── Details Block ───────────────────────────────────────────────────

function DetailsBlock({ data }: { data: MarketStudyResult }) {
  const { dvf, bpe, transport } = data.core;
  const txCount = dvf?.transactions?.length ?? 0;
  const bpeCount = bpe?.total_equipements ?? 0;
  const stopsCount = transport?.stops?.length ?? 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">📋 Détails</h3>

      <Accordion title="Transactions DVF (30 dernières)" icon="🏠" badge={txCount > 0 ? txCount : undefined}>
        <DvfTransactionsDetail transactions={dvf?.transactions} />
      </Accordion>

      <Accordion title="Équipements / Commerces (BPE)" icon="🏪" badge={bpeCount > 0 ? bpeCount : undefined}>
        <BpeEquipementsDetail bpe={bpe} />
      </Accordion>

      <Accordion title="Transport (OSM)" icon="🚇" badge={stopsCount > 0 ? stopsCount : undefined}>
        <TransportDetail transport={transport} />
      </Accordion>
    </div>
  );
}

// ─── Loading ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-gray-100 rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-48 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
      <p className="text-center text-sm text-gray-400 pt-2">Analyse en cours… 10 à 20 secondes.</p>
    </div>
  );
}

// ─── Error ───────────────────────────────────────────────────────────

function ErrorState({ error, details, onRetry }: { error: string; details?: unknown; onRetry: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-red-200 shadow-sm p-6 text-center">
      <div className="text-4xl mb-3">⚠️</div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">Données indisponibles</h3>
      <p className="text-sm text-red-600 mb-4">{error}</p>
      {details && (
        <details className="text-left text-xs text-gray-400 mb-4 max-w-lg mx-auto">
          <summary className="cursor-pointer hover:text-gray-600">Détails techniques</summary>
          <pre className="mt-2 p-2 bg-gray-50 rounded overflow-auto max-h-40">
            {typeof details === "string" ? details : JSON.stringify(details, null, 2)}
          </pre>
        </details>
      )}
      <button onClick={onRetry} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
        🔄 Réessayer
      </button>
    </div>
  );
}

// ─── Results ─────────────────────────────────────────────────────────

function ResultsView({ data, showDetails }: { data: MarketStudyResult; showDetails: boolean }) {
  const { scores, scoring_details, core, insights, warnings, meta } = data;
  const { dvf, insee, transport, bpe } = core;

  return (
    <div className="space-y-5">
      {/* Score global */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">🎯 Score global</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {meta.commune_nom ?? meta.commune_insee} · {meta.project_type_label} · rayon {meta.radius_km} km
            </p>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-black ${scores.global >= 70 ? "text-emerald-600" : scores.global >= 50 ? "text-amber-500" : "text-red-500"}`}>
              {scores.global}<span className="text-lg font-normal text-gray-400">/100</span>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <ScoreBar label="Demande" value={scores.demande} />
          <ScoreBar label="Offre" value={scores.offre} />
          <ScoreBar label="Accessibilité" value={scores.accessibilite} />
          <ScoreBar label="Environnement" value={scores.environnement} />
        </div>
        {scoring_details?.adjustments?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {scoring_details.adjustments.map((adj, i) => (
              <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${adj.type === "bonus" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                {adj.type === "bonus" ? "+" : ""}{adj.value} {adj.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="DVF — Transactions" icon="🏠" coverage={dvf?.coverage}>
          {dvf && dvf.nb_transactions > 0 ? (<>
            <Stat label="Transactions" value={fmtNum(dvf.nb_transactions)} />
            <Stat label="Prix médian /m²" value={fmtNum(dvf.prix_m2_median, " €")} />
            <Stat label="Prix moyen /m²" value={fmtNum(dvf.prix_m2_moyen, " €")} />
            <Stat label="Min /m²" value={fmtNum(dvf.prix_m2_min, " €")} />
            <Stat label="Max /m²" value={fmtNum(dvf.prix_m2_max, " €")} />
            <Stat label="Évolution" value={fmtPct(dvf.evolution_prix_pct)} />
          </>) : <p className="text-xs text-gray-400 italic">Aucune transaction</p>}
        </Card>

        <Card title="INSEE — Socio-démographie" icon="👥" coverage={insee?.coverage}>
          {insee ? (<>
            <Stat label="Population" value={fmtNum(insee.population)} />
            <Stat label="Densité" value={fmtNum(insee.densite, " hab/km²")} />
            <Stat label={`Revenu médian${insee.incomeMedianUcYear ? ` (${insee.incomeMedianUcYear})` : ""}`} value={fmtNum(insee.revenu_median, " €/UC/an")} />
            <Stat label="Taux pauvreté" value={fmtPct(insee.taux_pauvrete)} />
            <Stat label="Taux chômage" value={fmtPct(insee.taux_chomage)} />
            <MenagesImposesStat insee={insee} />
            {insee.revenu_source && (
              <p className="text-[10px] text-gray-400 mt-1">Source: {insee.revenu_source}</p>
            )}
          </>) : <p className="text-xs text-gray-400 italic">Données INSEE indisponibles</p>}
        </Card>

        <Card title="Transport" icon="🚇" coverage={transport?.coverage}>
          {transport ? (<>
            <Stat label="Score transport" value={`${transport.score}/100`} />
            <Stat label="Arrêt le plus proche" value={transport.nearest_stop_m != null ? fmtNum(transport.nearest_stop_m, " m") : "—"} />
            <Stat label="Métro / Train" value={transport.has_metro_train ? "✅ Oui" : "❌ Non"} />
            <Stat label="Tramway" value={transport.has_tram ? "✅ Oui" : "❌ Non"} />
            <Stat label="Arrêts trouvés" value={fmtNum(transport.stops?.length ?? 0)} />
          </>) : <p className="text-xs text-gray-400 italic">Données transport indisponibles</p>}
        </Card>

        <Card title="BPE — Équipements" icon="🏪" coverage={bpe?.coverage}>
          {bpe && bpe.total_equipements > 0 ? (<>
            <Stat label="Total équipements" value={fmtNum(bpe.total_equipements)} />
            <Stat label="Score BPE" value={`${bpe.score}/100`} />
            <div className="border-t border-gray-100 mt-2 pt-2">
              <Stat label="Écoles" value={fmtNum(bpe.nb_ecoles)} />
              <Stat label="Pharmacies" value={fmtNum(bpe.nb_pharmacies)} />
              <Stat label="Supermarchés" value={fmtNum(bpe.nb_supermarches)} />
              <Stat label="Universités / Sup." value={fmtNum(bpe.nb_universites)} />
            </div>
            <div className="border-t border-gray-100 mt-2 pt-2">
              <Stat label="Commerces" value={fmtNum(bpe.commerces?.count)} />
              <Stat label="Santé" value={fmtNum(bpe.sante?.count)} />
              <Stat label="Éducation" value={fmtNum(bpe.education?.count)} />
              <Stat label="Loisirs" value={fmtNum(bpe.loisirs?.count)} />
            </div>
          </>) : <p className="text-xs text-gray-400 italic">Aucun équipement</p>}
        </Card>
      </div>

      {/* Insights */}
      {insights && insights.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">💡 Insights</h3>
          <div className="flex flex-wrap gap-2">
            {insights.map((ins, i) => <InsightBadge key={i} insight={ins} />)}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1">
          <h3 className="text-sm font-semibold text-amber-700">⚠️ Avertissements</h3>
          {warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}
        </div>
      )}

      {showDetails && <DetailsBlock data={data} />}

      <p className="text-[10px] text-gray-400 text-right">
        v{data.version} · {meta.generated_at ? new Date(meta.generated_at).toLocaleString("fr-FR") : ""} · source: {meta.location_source}
      </p>
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
      <details>
        <summary className="cursor-pointer font-semibold hover:text-gray-700">🗄️ FiLoSoFi debug</summary>
        {filosofi ? (
          <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1">
            <p><strong>row_found:</strong> {String(filosofi.row_found)}</p>
            <p><strong>used_code:</strong> {String(filosofi.used_code)}</p>
            <p><strong>table_queried:</strong> {String(filosofi.table_queried)}</p>
            <p><strong>query_keys_tried:</strong> {JSON.stringify(filosofi.query_keys_tried)}</p>
            <p><strong>all_keys_count:</strong> {String(filosofi.all_keys_count)}</p>
            <p><strong>med_col:</strong> {JSON.stringify(filosofi.med_col)}</p>
            <p><strong>med_raw:</strong> {JSON.stringify(filosofi.med_raw)}</p>
            <p><strong>txpau_col:</strong> {JSON.stringify(filosofi.txpau_col)}</p>
            <p><strong>txpau_raw:</strong> {JSON.stringify(filosofi.txpau_raw)}</p>
            <p><strong>partimp_col:</strong> {JSON.stringify(filosofi.partimp_col)}</p>
            <p><strong>partimp_raw:</strong> {JSON.stringify(filosofi.partimp_raw)}</p>
            {filosofi.sample_keys && (
              <details className="mt-1">
                <summary className="cursor-pointer">sample_keys ({(filosofi.sample_keys as string[]).length})</summary>
                <pre className="mt-1 p-2 bg-white rounded overflow-auto max-h-32 text-[10px]">
                  {JSON.stringify(filosofi.sample_keys, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ) : (
          <p className="mt-1 text-gray-400 italic">
            Pas de debug filosofi (socioeco_communes a peut-être répondu directement).
            Source: {String(debug.insee_revenu_source ?? "?")}
          </p>
        )}
      </details>

      <details>
        <summary className="cursor-pointer font-semibold hover:text-gray-700">🏪 BPE typequ debug</summary>
        <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p><strong>Total rows fetched:</strong> {String(debug.bpeTotalRowsFetched ?? "?")}</p>
          {bpeTop && bpeTop.length > 0 ? (
            <table className="mt-2 w-full text-[10px]">
              <thead>
                <tr className="text-left border-b border-gray-200">
                  <th className="py-1 pr-2">Code</th>
                  <th className="py-1 pr-2">Label</th>
                  <th className="py-1 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {bpeTop.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${row.type === "D301" || row.type === "B101" || row.type === "B102" ? "bg-yellow-50 font-semibold" : ""}`}>
                    <td className="py-0.5 pr-2 font-mono">{row.type}</td>
                    <td className="py-0.5 pr-2">{row.label}</td>
                    <td className="py-0.5 text-right">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-gray-400 italic mt-1">Aucune donnée typequ</p>}
        </div>
      </details>

      {bpeSample && bpeSample.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold hover:text-gray-700">📋 BPE sample rows ({bpeSample.length})</summary>
          <pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-auto max-h-48 text-[10px]">
            {JSON.stringify(bpeSample, null, 2)}
          </pre>
        </details>
      )}

      {debug.insee_warnings && (debug.insee_warnings as string[]).length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold hover:text-gray-700">⚠️ INSEE warnings</summary>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            {(debug.insee_warnings as string[]).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}

      {debug.timings && (
        <details>
          <summary className="cursor-pointer font-semibold hover:text-gray-700">⏱️ Timings</summary>
          <pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-auto text-[10px]">
            {JSON.stringify(debug.timings, null, 2)}
          </pre>
        </details>
      )}

      <details>
        <summary className="cursor-pointer font-semibold hover:text-gray-700">📦 Raw debug JSON</summary>
        <pre className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 overflow-auto max-h-96 text-[10px]">
          {JSON.stringify(debug, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─── Snapshot hydration helper ───────────────────────────────────────

/**
 * Reads saved Marché/Risques data from the Marchand snapshot for a given dealId.
 * Returns { data, updatedAt } if valid data exists, or null.
 */
function readSavedMarcheRisques(
  dealId: string
): { data: MarketStudyResult; updatedAt: string } | null {
  try {
    const snap = readMarchandSnapshot();
    const saved = snap.marcheRisquesByDeal[dealId] as Record<string, any> | undefined;
    if (!saved) return null;

    const data = saved.data as MarketStudyResult | undefined;
    if (!data || typeof data !== "object") return null;

    // Minimal structural check: must have scores + core
    if (!data.scores || !data.core) return null;

    const updatedAt: string = saved.updatedAt ?? "";
    return { data, updatedAt };
  } catch (e) {
    console.warn("[MarcheRisques] Failed to read snapshot:", e);
    return null;
  }
}

/**
 * Returns true if the saved data is stale (> STALE_THRESHOLD_MS old).
 */
function isSavedDataStale(updatedAt: string): boolean {
  if (!updatedAt) return true;
  try {
    const savedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(savedTime)) return true;
    return Date.now() - savedTime > STALE_THRESHOLD_MS;
  } catch {
    return true;
  }
}

// ─── Main component ──────────────────────────────────────────────────

export default function MarcheRisquesPanel({ dealId, dealInputs }: MarcheRisquesPanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<MarketStudyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  /** true when we have a result that came from the snapshot (not a fresh fetch) */
  const hydratedFromSnapshotRef = useRef(false);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // v3: persist successful results into snapshot (no overwrite on error)
  const persistSuccess = useCallback(
    (data: MarketStudyResult) => {
      if (!dealId) return;
      try {
        const s = data.scores;
        patchMarcheRisquesForDeal(dealId, {
          data,
          scoreGlobal: s?.global,
          breakdown: {
            demande: s?.demande,
            offre: s?.offre,
            accessibilite: s?.accessibilite,
            environnement: s?.environnement,
          },
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn("[MarcheRisques] snapshot persist failed:", e);
      }
    },
    [dealId]
  );

  // ── Fetch (network call) ─────────────────────────────────────────
  const doFetch = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const thisRequestId = ++requestIdRef.current;

    setStatus("loading");
    setErrorMsg(null);
    setErrorDetails(null);

    const hasCoords = dealInputs.lat != null && dealInputs.lng != null && Number.isFinite(dealInputs.lat) && Number.isFinite(dealInputs.lng);
    const hasAddress = Boolean(dealInputs.address && dealInputs.address.trim().length > 3);
    const hasCityZip = Boolean(dealInputs.zipCode && dealInputs.city);

    if (!hasCoords && !hasAddress && !hasCityZip) {
      // If we had hydrated data, keep showing it instead of error
      if (result) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg("Pas assez d'information de localisation. Renseignez au moins une adresse, un code postal + ville, ou des coordonnées GPS.");
      }
      return;
    }

    const input: MarketStudyInput = {
      address: dealInputs.address,
      zipCode: dealInputs.zipCode,
      city: dealInputs.city,
      lat: dealInputs.lat,
      lng: dealInputs.lng,
      project_type: "logement",
      radius_km: 5,
      debug: debugMode,
    };

    try {
      const res = await fetchMarketStudyPromoteur(input, ac.signal);

      if (thisRequestId !== requestIdRef.current) return;
      if (ac.signal.aborted) return;

      if (res.ok) {
        setResult(res.data);
        setStatus("success");
        hydratedFromSnapshotRef.current = false;
        persistSuccess(res.data);
      } else {
        // v3: If we already have a valid result (hydrated or previous fetch),
        // keep showing it — just set a non-blocking warning
        if (result) {
          setStatus("success");
          console.warn("[MarcheRisques] Fetch failed, keeping cached result:", res.error);
        } else {
          setErrorMsg(res.error);
          setErrorDetails(res.details);
          setStatus("error");
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (thisRequestId !== requestIdRef.current) return;

      // v3: keep cached result on unexpected errors too
      if (result) {
        setStatus("success");
        console.warn("[MarcheRisques] Fetch error, keeping cached result:", err);
      } else {
        setErrorMsg("Erreur inattendue");
        setErrorDetails(String(err));
        setStatus("error");
      }
    }
  }, [dealInputs.address, dealInputs.zipCode, dealInputs.city, dealInputs.lat, dealInputs.lng, debugMode, persistSuccess, result]);

  // ── v3: Hydrate from snapshot on mount / dealId change ───────────
  useEffect(() => {
    if (!dealId) return;

    const saved = readSavedMarcheRisques(dealId);

    if (saved) {
      // Hydrate immediately — show cached data
      setResult(saved.data);
      setStatus("success");
      hydratedFromSnapshotRef.current = true;
      console.log("[MarcheRisques] Hydrated from snapshot", { dealId, updatedAt: saved.updatedAt });

      // If data is stale, trigger a background refetch
      if (isSavedDataStale(saved.updatedAt)) {
        console.log("[MarcheRisques] Cached data is stale, triggering background refetch…");
        // We don't call doFetch() directly here because of the dependency cycle;
        // instead we set a flag and let the next effect handle it.
        setShouldBackgroundFetch(true);
      }
    } else {
      // No cached data → fetch immediately
      setResult(null);
      setStatus("idle");
      hydratedFromSnapshotRef.current = false;
      setShouldBackgroundFetch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  // ── Background fetch flag ────────────────────────────────────────
  const [shouldBackgroundFetch, setShouldBackgroundFetch] = useState(false);

  useEffect(() => {
    if (!shouldBackgroundFetch) return;
    setShouldBackgroundFetch(false);
    doFetch();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldBackgroundFetch]);

  // ── Cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleRetry = useCallback(() => doFetch(), [doFetch]);

  // ── Determine what to render ─────────────────────────────────────
  // If we have a result (cached or fresh), always show it.
  // Only show loading skeleton if no result is available yet.
  const showLoading = status === "loading" && !result;
  const showError = status === "error" && !result;
  const showResult = result != null;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">📊 Marché / Risques</h2>
        <div className="flex items-center gap-3">
          {/* Stale / refreshing indicator */}
          {status === "loading" && result && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium animate-pulse">
              Actualisation…
            </span>
          )}
          {hydratedFromSnapshotRef.current && status === "success" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
              Données en cache
            </span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500">
            <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} className="rounded text-indigo-600 h-3.5 w-3.5" />
            Détails
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500">
            <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} className="rounded text-indigo-600 h-3.5 w-3.5" />
            Debug
          </label>
          {(status === "success" || result) && (
            <button onClick={handleRetry} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">🔄 Rafraîchir</button>
          )}
        </div>
      </div>

      {showLoading && <LoadingSkeleton />}
      {showError && <ErrorState error={errorMsg ?? "Erreur inconnue"} details={errorDetails} onRetry={handleRetry} />}
      {showResult && <ResultsView data={result} showDetails={showDetails} />}
      {status === "idle" && !result && <p className="text-sm text-gray-400 text-center py-10">Initialisation…</p>}

      {debugMode && result && result.debug && (
        <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">🐛 Debug (edge function)</h3>
          <DebugPanel debug={result.debug} />
        </div>
      )}
    </div>
  );
}