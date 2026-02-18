// src/spaces/banque/components/committee/CommitteeSectionMarket.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { CommitteeScoringSettings } from "./CommitteeSettingsModal";

const fmtNum = (v: number | undefined | null, suffix = "") =>
  v !== undefined && v !== null ? `${v.toLocaleString("fr-FR")}${suffix}` : "—";

const fmtPct = (v: number | undefined | null) => (v !== undefined && v !== null ? `${v}%` : "—");

function badgeClass(type: string) {
  if (type === "positive") return "bg-green-50 text-green-700 border border-green-200";
  if (type === "warning") return "bg-amber-50 text-amber-700 border border-amber-200";
  if (type === "negative") return "bg-red-50 text-red-700 border border-red-200";
  return "bg-gray-50 text-gray-600 border border-gray-200";
}

function isTransportDataInsufficient(t: any): boolean {
  if (!t || typeof t !== "object") return true;

  // If coverage is explicitly not ok -> insufficient
  const cov = (t.coverage ?? "").toString().toLowerCase();
  if (cov && cov !== "ok") return true;

  const stops = Array.isArray(t.stops) ? t.stops : [];
  const nearest = t.nearest_stop_m;
  const hasMetroTrain = !!t.has_metro_train;
  const hasTram = !!t.has_tram;

  // Typical "no GTFS data / no stops" case:
  const noStops = stops.length === 0;
  const noNearest = nearest === null || nearest === undefined;
  const noModes = !hasMetroTrain && !hasTram;

  // If everything is empty/false => not reliable
  if (noStops && noNearest && noModes) return true;

  return false;
}

function computeGlobalWithoutTransport(scores: any, scoringDetails: any): number | null {
  if (!scores || typeof scores !== "object") return null;

  const demande = typeof scores.demande === "number" ? scores.demande : null;
  const offre = typeof scores.offre === "number" ? scores.offre : null;
  const env = typeof scores.environnement === "number" ? scores.environnement : null;

  // weights (fallback to defaults you showed)
  const w = scoringDetails?.weights ?? {};
  const wd = typeof w.demande === "number" ? w.demande : 0.3;
  const wo = typeof w.offre === "number" ? w.offre : 0.25;
  const we = typeof w.environnement === "number" ? w.environnement : 0.2;

  // Only keep pillars we actually have numbers for
  const parts: { v: number; w: number }[] = [];
  if (demande != null) parts.push({ v: demande, w: wd });
  if (offre != null) parts.push({ v: offre, w: wo });
  if (env != null) parts.push({ v: env, w: we });

  const sumW = parts.reduce((s, p) => s + p.w, 0);
  if (parts.length === 0 || sumW <= 0) return null;

  const val = parts.reduce((s, p) => s + p.v * p.w, 0) / sumW;
  return Math.round(val);
}

export default function CommitteeSectionMarket({
  operation,
  settings,
}: {
  operation: any;
  settings?: CommitteeScoringSettings;
}) {
  const topN = settings?.topDetailsCount ?? 5;
  const showInsights = settings?.showInsights ?? true;

  // Legacy
  const dvfStats = operation?.dvf?.stats;
  const communeLegacy = operation?.market?.commune;
  const osmServicesLegacy = operation?.market?.osmServices;
  const finessLegacy = operation?.market?.finess;
  const evolutionPctLegacy = operation?.market?.evolutionPct;

  // Enriched market (robust)
  const market =
    (operation as any)?.market ??
    (operation as any)?.marketContext ??
    (operation as any)?.market_context ??
    (operation as any)?.marketStudy ??
    (operation as any)?.market_study ??
    null;

  const insee = market?.insee ?? market?.core?.insee ?? null;
  const bpe = market?.bpe ?? market?.core?.bpe ?? null;
  const transport = market?.transport ?? market?.core?.transport ?? null;
  const scores = market?.scores ?? null;
  const scoringDetails = market?.scoring_details ?? null;
  const insights: any[] = Array.isArray(market?.insights) ? market.insights : [];
  const dvf = market?.dvf ?? market?.core?.dvf ?? null;

  const commune =
    market?.commune ??
    (market?.core?.insee
      ? {
          nom: market.core.insee.commune_nom,
          population: market.core.insee.population,
          densiteHabKm2: market.core.insee.densite,
          departement: market.core.insee.departement,
          region: market.core.insee.region,
          codeCommune: market.core.insee.code_commune,
        }
      : null) ??
    communeLegacy ??
    null;

  const servicesFallback = osmServicesLegacy?.count1km ?? bpe?.total_equipements ?? null;
  const santeFallback = finessLegacy?.count ?? bpe?.sante?.count ?? null;

  const dvfTxCount =
    dvf?.nb_transactions ??
    dvf?.transactions_count ??
    dvf?.stats?.transactions_count ??
    dvfStats?.transactions_count ??
    null;

  const dvfMedian =
    dvf?.prix_m2_median ??
    dvf?.price_median_eur_m2 ??
    dvf?.stats?.price_median_eur_m2 ??
    dvfStats?.price_median_eur_m2 ??
    null;

  const dvfMean =
    dvf?.prix_m2_moyen ??
    dvf?.price_mean_eur_m2 ??
    dvf?.stats?.price_mean_eur_m2 ??
    dvfStats?.price_mean_eur_m2 ??
    null;

  const dvfEvolution =
    dvf?.evolution_prix_pct ?? dvf?.evolution_pct ?? dvf?.stats?.evolution_pct ?? evolutionPctLegacy ?? null;

  const transportInsufficient = isTransportDataInsufficient(transport);

  // UI-only adjustment: if transport insufficient, recompute global without accessibilite
  const globalWithoutTransport = transportInsufficient ? computeGlobalWithoutTransport(scores, scoringDetails) : null;
  const globalDisplay =
    globalWithoutTransport != null ? globalWithoutTransport : typeof scores?.global === "number" ? scores.global : null;

  const hasAnyData =
    dvfTxCount != null ||
    dvfMedian != null ||
    !!commune ||
    !!insee ||
    !!bpe ||
    !!scores ||
    (showInsights && insights.length > 0) ||
    (!transportInsufficient && !!transport);

  const topDetails = (arr: any[] | undefined, n = 5) => (Array.isArray(arr) ? arr.slice(0, n) : []);

  // ────────────────────────────────────────────────────────────────────────────
  // FILOSOFI (revenu médian + taux de pauvreté) — fetch minimal depuis Supabase
  // Ne touche pas au reste : si déjà présent dans insee => on n'écrase pas.
  // NOTE: nécessite la view "v_insee_socioeco_communes_latest" côté DB.
  // ────────────────────────────────────────────────────────────────────────────
  const codeCommune =
    commune?.codeCommune ??
    insee?.code_commune ??
    insee?.commune_insee ??
    insee?.codeCommune ??
    insee?.codgeo ??
    null;

  const [socioEco, setSocioEco] = useState<{
    annee: number | null;
    revenu_median_eur: number | null;
    taux_pauvrete_pct: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        if (!codeCommune) return;

        // Si déjà fourni par ton objet insee, on ne refetch pas.
        const hasRevenu = insee?.revenu_median !== undefined && insee?.revenu_median !== null;
        const hasPauvrete =
          (insee as any)?.taux_pauvrete_pct != null || (insee as any)?.taux_pauvrete != null || (insee as any)?.tp60 != null;

        if (hasRevenu && hasPauvrete) return;

        const { data, error } = await supabase
          .from("v_insee_socioeco_communes_latest")
          .select("annee, revenu_median_eur, taux_pauvrete_pct")
          .eq("code_commune", String(codeCommune))
          .maybeSingle();

        if (error) return;
        if (!cancelled) {
          setSocioEco({
            annee: data?.annee ?? null,
            revenu_median_eur: data?.revenu_median_eur ?? null,
            taux_pauvrete_pct: data?.taux_pauvrete_pct ?? null,
          });
        }
      } catch {
        // silence : on garde l'affichage existant
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [codeCommune, insee]);

  return (
    <details className="group">
      <summary className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-900">🏘️ Étude de marché</span>
        <span className="text-xs text-gray-400 group-open:rotate-90 transition-transform">▶</span>
      </summary>

      <div className="mt-2 space-y-3 pl-1">
        {!hasAnyData && <p className="text-sm text-gray-400 italic">Non disponible</p>}

        {(dvfTxCount != null || dvfMedian != null) && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">DVF — Transactions</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-gray-400">Transactions</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(dvfTxCount)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Prix médian</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(dvfMedian, " €/m²")}</p>
              </div>
              {dvfMean != null && (
                <div className="col-span-2">
                  <p className="text-[10px] text-gray-400">Prix moyen</p>
                  <p className="text-sm font-bold text-gray-700">{fmtNum(dvfMean, " €/m²")}</p>
                </div>
              )}
              {dvfEvolution !== undefined && dvfEvolution !== null && (
                <div className="col-span-2">
                  <p className="text-[10px] text-gray-400">Évolution prix</p>
                  <p className={`text-sm font-bold ${dvfEvolution >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {dvfEvolution > 0 ? "+" : ""}
                    {dvfEvolution}%
                  </p>
                </div>
              )}
            </div>
            {dvf?.coverage && <p className="text-[10px] text-gray-400">Couverture: {String(dvf.coverage)}</p>}
          </div>
        )}

        {commune && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Commune</p>
            <p className="text-base font-bold text-gray-800 mt-1">{commune.nom ?? "—"}</p>
            <p className="text-xs text-gray-600">
              {fmtNum(commune.population)} hab.
              {commune.densiteHabKm2 != null && ` — ${fmtNum(commune.densiteHabKm2)} hab/km²`}
            </p>
            {commune.departement && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                {commune.departement}
                {commune.region ? `, ${commune.region}` : ""}
                {commune.codeCommune ? ` — INSEE ${commune.codeCommune}` : ""}
              </p>
            )}
          </div>
        )}

        {insee && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">INSEE — Démographie & revenus</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-gray-400">Population</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(insee.population)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Densité</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(insee.densite, " hab/km²")}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Revenu médian</p>
                <p className="text-lg font-bold text-gray-800">
                  {fmtNum((insee.revenu_median ?? socioEco?.revenu_median_eur) as any, " €")}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Chômage</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(insee.taux_chomage, " %")}</p>
              </div>

              {/* Ajout minimal: taux de pauvreté (FILOSOFI) */}
              <div>
                <p className="text-[10px] text-gray-400">Taux de pauvreté</p>
                <p className="text-lg font-bold text-gray-800">
                  {fmtNum(
                    ((insee as any)?.taux_pauvrete_pct ??
                      (insee as any)?.taux_pauvrete ??
                      (insee as any)?.tp60 ??
                      socioEco?.taux_pauvrete_pct) as any,
                    " %"
                  )}
                </p>
              </div>

              <div>
                <p className="text-[10px] text-gray-400">% propriétaires</p>
                <p className="text-sm font-bold text-gray-700">{fmtPct(insee.pct_proprietaires)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">% locataires</p>
                <p className="text-sm font-bold text-gray-700">{fmtPct(insee.pct_locataires)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-gray-400">Vacance</p>
                <p className="text-sm font-bold text-gray-700">{fmtPct(insee.pct_logements_vacants)}</p>
              </div>

              {socioEco?.annee && (
                <p className="text-[10px] text-gray-400 col-span-2">Source: FILOSOFI ({socioEco.annee})</p>
              )}
            </div>
          </div>
        )}

        {bpe && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">BPE — Services & attractivité</p>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-gray-400">Équipements</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(bpe.total_equipements)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Score BPE</p>
                <p className="text-lg font-bold text-gray-800">{bpe.score != null ? `${bpe.score}/100` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Commerces</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(bpe.commerces?.count)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Santé</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(bpe.sante?.count)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Éducation</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(bpe.education?.count)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Services</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(bpe.services?.count)}</p>
              </div>
            </div>

            {topN > 0 && Array.isArray(bpe.education?.details) && bpe.education.details.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Top écoles</p>
                <div className="space-y-1 mt-1">
                  {topDetails(bpe.education.details, topN).map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-white/60 rounded px-2 py-1">
                      <span className="text-gray-700 truncate mr-2">{d.label ?? "—"}</span>
                      <span className="text-gray-500 shrink-0">{d.distance_m != null ? `${d.distance_m} m` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Transport — if insufficient data, do NOT show score/flags */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transport — Accessibilité</p>
          {transportInsufficient ? (
            <div className="flex items-start gap-2 text-xs text-gray-600">
              <span className="text-amber-600">⚠️</span>
              <div>
                <p className="font-semibold text-gray-700">Données transport insuffisantes</p>
                <p className="text-gray-600">
                  Les données GTFS/arrêts sont incomplètes sur cette zone. L’accessibilité n’est pas intégrée au score.
                </p>
                {transport?.coverage && <p className="text-[10px] text-gray-400 mt-1">Couverture: {String(transport.coverage)}</p>}
              </div>
            </div>
          ) : transport ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-gray-400">Score transport</p>
                <p
                  className={`text-lg font-bold ${
                    transport.score >= 70 ? "text-green-700" : transport.score >= 40 ? "text-amber-700" : "text-red-700"
                  }`}
                >
                  {transport.score != null ? `${transport.score}/100` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Arrêt le + proche</p>
                <p className="text-lg font-bold text-gray-800">
                  {transport.nearest_stop_m != null ? `${transport.nearest_stop_m} m` : "—"}
                </p>
              </div>
              <div className="col-span-2 flex flex-wrap gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs border ${
                    transport.has_metro_train ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"
                  }`}
                >
                  🚆 Metro/Train: {transport.has_metro_train ? "Oui" : "Non"}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs border ${
                    transport.has_tram ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"
                  }`}
                >
                  🚋 Tram: {transport.has_tram ? "Oui" : "Non"}
                </span>
              </div>
              {transport.coverage && <p className="text-[10px] text-gray-400 col-span-2">Couverture: {String(transport.coverage)}</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Non disponible</p>
          )}
        </div>

        {/* Score marché — use UI-only recomputed global if transport missing */}
        {scores && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Score marché</p>
              {transportInsufficient && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                  Transport exclu (données manquantes)
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-gray-400">Global</p>
                <p className="text-xl font-bold text-gray-800">{globalDisplay != null ? `${globalDisplay}/100` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Demande</p>
                <p className="text-lg font-bold text-gray-800">{scores.demande != null ? `${scores.demande}/100` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Offre</p>
                <p className="text-lg font-bold text-gray-800">{scores.offre != null ? `${scores.offre}/100` : "—"}</p>
              </div>

              {/* accessibilite shown only if transport is reliable */}
              <div>
                <p className="text-[10px] text-gray-400">Accessibilité</p>
                <p className="text-lg font-bold text-gray-800">
                  {transportInsufficient ? "—" : scores.accessibilite != null ? `${scores.accessibilite}/100` : "—"}
                </p>
              </div>

              <div className="col-span-2">
                <p className="text-[10px] text-gray-400">Environnement</p>
                <p className="text-lg font-bold text-gray-800">
                  {scores.environnement != null ? `${scores.environnement}/100` : "—"}
                </p>
              </div>
            </div>

            {scoringDetails?.explanation && <p className="text-xs text-gray-600">{String(scoringDetails.explanation)}</p>}
          </div>
        )}

        {showInsights && insights.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Insights</p>
            <div className="flex flex-col gap-1.5">
              {insights.slice(0, 8).map((it: any, i: number) => (
                <div key={i} className={`px-2.5 py-1.5 rounded-lg text-xs ${badgeClass(String(it.type ?? "neutral"))}`}>
                  <span className="font-semibold mr-1">{String(it.category ?? "info")}</span>
                  <span className="opacity-80">—</span> <span>{it.message ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(osmServicesLegacy || finessLegacy) && (
          <div className="grid grid-cols-2 gap-2">
            {osmServicesLegacy && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] text-gray-400">Services 1 km (OSM)</p>
                <p className="text-lg font-bold text-gray-800">{osmServicesLegacy.count1km ?? "—"}</p>
              </div>
            )}
            {finessLegacy && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] text-gray-400">Étab. santé (FINESS)</p>
                <p className="text-lg font-bold text-gray-800">{finessLegacy.count ?? "—"}</p>
              </div>
            )}
          </div>
        )}

        {((!osmServicesLegacy && servicesFallback != null) || (!finessLegacy && santeFallback != null)) && (
          <div className="grid grid-cols-2 gap-2">
            {!osmServicesLegacy && servicesFallback != null && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] text-gray-400">Équipements (BPE)</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(servicesFallback)}</p>
              </div>
            )}
            {!finessLegacy && santeFallback != null && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] text-gray-400">Santé (BPE)</p>
                <p className="text-lg font-bold text-gray-800">{fmtNum(santeFallback)}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
