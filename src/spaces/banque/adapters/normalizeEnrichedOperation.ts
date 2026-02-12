// ============================================================================
// normalizeEnrichedOperation.ts
// src/spaces/banque/adapters/normalizeEnrichedOperation.ts
//
// Normalise la réponse brute du backend (banque-operation-enrich-v1)
// vers le format OperationSummary attendu par :
//   - computeSmartScoreFromOperation()
//   - AnalysePage.tsx (template JSX)
//   - SmartScorePanel (via pillars/subscores)
//
// Le backend renvoie les réponses brutes des sous-fonctions (risks-refresh-v1,
// market-study-promoteur-v1, etc.) sans les normaliser. Ce module comble le gap.
//
// ⚠️  Ce fichier est ADDITIF — il ne modifie pas les types existants.
//
// ✅ FIX v1: normalizeMarket extrait maintenant les champs plats (pricePerSqm,
//    demandIndex, compsCount, evolutionPct) depuis le blob market-study.
// ✅ FIX v2: normalizeDvf Shape A re-normalise les noms de champs FR→EN.
// ✅ FIX v3: normalizeMarket préserve toutes les données hydratées.
// ✅ FIX v4: DVF merger — quand base.dvf est incomplet (pas de prix),
//    on enrichit depuis market.dvf qui contient les données complètes.
// ✅ FIX v5: Préserve explicitement revenues et financing dans le merge
//    pour que applyCreditInputsToOperation puisse les enrichir ensuite.
// ============================================================================

import type { OperationSummary } from "../types/operationSummary.types";

// ── Internal helpers ──────────────────────────────────────────────

/** Safe number extraction */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Deep-get with dot path: get(obj, "a.b.c") */
function get(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
}

// ── Risks normalizer ─────────────────────────────────────────────

function normalizeRisks(raw: unknown): OperationSummary["risks"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;

  // Shape A: already has geo sub-object
  if (r.geo && typeof r.geo === "object" && typeof r.geo.score === "number") {
    return { geo: r.geo };
  }

  // Unwrap if nested under data
  const data = r.data ?? r;

  const score = num(data.score ?? data.score_global ?? data.riskScore) ?? 50;
  const risks: any[] = data.risks ?? data.risques_naturels ?? [];
  const technoRisks: any[] = data.risques_techno ?? [];
  const allRisks = [...risks, ...technoRisks];

  const hasInondation = allRisks.some(
    (r: any) =>
      typeof r === "string"
        ? r.toLowerCase().includes("inondation")
        : (r.label ?? r.libelle ?? r.type ?? "").toLowerCase().includes("inondation")
  );

  const hasSismique = allRisks.some(
    (r: any) =>
      typeof r === "string"
        ? r.toLowerCase().includes("sism")
        : (r.label ?? r.libelle ?? r.type ?? "").toLowerCase().includes("sism")
  );

  const nbRisques = num(data.nbRisques ?? data.nb_risques) ?? allRisks.length;
  const label = score >= 70 ? "Faible" : score >= 40 ? "Modéré" : "Élevé";

  return {
    geo: {
      score,
      nbRisques,
      hasInondation,
      hasSismique,
      label,
      ...(data.gaspar ? { gaspar: data.gaspar } : {}),
      ...(data.georisques_url ? { georisquesUrl: data.georisques_url } : {}),
    },
  };
}

// ── DVF normalizer ───────────────────────────────────────────────

/**
 * Normalise les données DVF depuis UNE source.
 *
 * ✅ FIX v2: Re-normalise les noms FR→EN dans tous les shapes.
 */
function normalizeDvf(raw: unknown): OperationSummary["dvf"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;

  // Shape A: already has stats sub-object
  if (r.stats && typeof r.stats === "object") {
    const s = r.stats;
    return {
      stats: {
        transactions_count:
          num(s.transactions_count ?? s.nb_transactions) ?? 0,
        price_median_eur_m2:
          num(s.price_median_eur_m2 ?? s.prix_m2_median ?? s.median_price),
        price_mean_eur_m2:
          num(s.price_mean_eur_m2 ?? s.prix_m2_moyen ?? s.mean_price),
        price_q1_eur_m2:
          num(s.price_q1_eur_m2 ?? s.prix_m2_q1 ?? s.prix_m2_min ?? s.q1),
        price_q3_eur_m2:
          num(s.price_q3_eur_m2 ?? s.prix_m2_q3 ?? s.prix_m2_max ?? s.q3),
        evolution_pct:
          num(s.evolution_pct ?? s.evolution_prix_pct),
      },
      comparables: r.comparables ?? [],
    };
  }

  // Shape B: nested dvf
  if (r.dvf && typeof r.dvf === "object") {
    return normalizeDvf(r.dvf);
  }

  // Shape C: has transactions array
  const transactions = r.transactions ?? r.mutations ?? [];
  if (transactions.length > 0 || r.median_price) {
    return {
      stats: {
        transactions_count:
          num(r.transactions_count ?? r.nb_transactions ?? r.count) ?? transactions.length,
        price_median_eur_m2:
          num(r.price_median_eur_m2 ?? r.prix_m2_median ?? r.median_price ?? r.medianPriceM2),
        price_mean_eur_m2:
          num(r.price_mean_eur_m2 ?? r.prix_m2_moyen ?? r.mean_price ?? r.meanPriceM2),
        price_q1_eur_m2:
          num(r.price_q1_eur_m2 ?? r.prix_m2_q1 ?? r.prix_m2_min ?? r.q1),
        price_q3_eur_m2:
          num(r.price_q3_eur_m2 ?? r.prix_m2_q3 ?? r.prix_m2_max ?? r.q3),
      },
      comparables: (r.comparables ?? transactions.slice(0, 10)).map((t: any) => ({
        date: t.date ?? t.date_mutation,
        price: num(t.price ?? t.valeur_fonciere),
        surface: num(t.surface ?? t.surface_reelle_bati ?? t.surface_m2),
        pricePerSqm: num(t.pricePerSqm ?? t.prix_m2 ?? t.price_m2),
      })),
    };
  }

  // Shape D: flat stats (nb_transactions, prix_m2_median at root level — raw market-study dvf blob)
  if (r.transactions_count || r.nb_transactions || r.price_median_eur_m2 || r.prix_m2_median) {
    return {
      stats: {
        transactions_count:
          num(r.transactions_count ?? r.nb_transactions),
        price_median_eur_m2:
          num(r.price_median_eur_m2 ?? r.prix_m2_median),
        price_mean_eur_m2:
          num(r.price_mean_eur_m2 ?? r.prix_m2_moyen),
        price_q1_eur_m2:
          num(r.price_q1_eur_m2 ?? r.prix_m2_q1 ?? r.prix_m2_min),
        price_q3_eur_m2:
          num(r.price_q3_eur_m2 ?? r.prix_m2_q3 ?? r.prix_m2_max),
        evolution_pct:
          num(r.evolution_pct ?? r.evolution_prix_pct),
      },
      comparables: (r.comparables ?? []).map((t: any) => ({
        date: t.date ?? t.date_mutation,
        price: num(t.price ?? t.valeur_fonciere),
        surface: num(t.surface ?? t.surface_reelle_bati ?? t.surface_m2),
        pricePerSqm: num(t.pricePerSqm ?? t.prix_m2 ?? t.price_m2),
      })),
    };
  }

  return undefined;
}

// ── ✅ FIX v4: DVF merger ────────────────────────────────────────
/**
 * Merge multiple DVF sources. The primary source may be incomplete
 * (e.g. base.dvf has only transactions_count from hydration, while
 * market.dvf has all the price fields from the raw API response).
 *
 * Strategy: take all non-undefined fields from each source,
 * with later sources filling gaps (not overwriting).
 */
function mergeDvfSources(...sources: Array<OperationSummary["dvf"] | undefined>): OperationSummary["dvf"] | undefined {
  const valid = sources.filter((s): s is NonNullable<OperationSummary["dvf"]> => !!s);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  // Start with the first source, fill gaps from subsequent sources
  const merged = { ...valid[0] };
  const mergedStats = { ...merged.stats };

  for (let i = 1; i < valid.length; i++) {
    const src = valid[i];
    if (!src.stats) continue;

    // Fill each stat field if missing in merged
    if (mergedStats.transactions_count === undefined || mergedStats.transactions_count === 0) {
      mergedStats.transactions_count = src.stats.transactions_count;
    }
    if (mergedStats.price_median_eur_m2 === undefined) {
      mergedStats.price_median_eur_m2 = src.stats.price_median_eur_m2;
    }
    if (mergedStats.price_mean_eur_m2 === undefined) {
      mergedStats.price_mean_eur_m2 = src.stats.price_mean_eur_m2;
    }
    if (mergedStats.price_q1_eur_m2 === undefined) {
      mergedStats.price_q1_eur_m2 = src.stats.price_q1_eur_m2;
    }
    if (mergedStats.price_q3_eur_m2 === undefined) {
      mergedStats.price_q3_eur_m2 = src.stats.price_q3_eur_m2;
    }
    if (mergedStats.evolution_pct === undefined) {
      mergedStats.evolution_pct = src.stats.evolution_pct;
    }

    // Fill comparables if empty
    if ((!merged.comparables || merged.comparables.length === 0) && src.comparables?.length) {
      merged.comparables = src.comparables;
    }
  }

  merged.stats = mergedStats;
  return merged;
}

// ── Market normalizer ────────────────────────────────────────────

/**
 * ✅ FIX v3: Préserve toutes les données hydratées via spread.
 */
function normalizeMarket(raw: unknown): OperationSummary["market"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;

  const data = r.data ?? r;

  // Shape A: has commune sub-object
  if (data.commune && typeof data.commune === "object" && (data.commune.nom ?? data.commune.commune)) {
    const commune = {
      nom: data.commune.nom ?? data.commune.commune,
      population: num(data.commune.population),
      densiteHabKm2: num(data.commune.densite_hab_km2 ?? data.commune.densiteHabKm2),
      departement: data.commune.departement ?? data.commune.nom_departement,
      region: data.commune.region ?? data.commune.nom_region,
      codeCommune: data.commune.code ?? data.commune.code_commune ?? data.commune.codeCommune,
    };

    const dvfBlock = data.dvf;
    const indicesBlock = data.indices ?? data.scores;

    const pricePerSqm = num(
      data.pricePerSqm ??
      dvfBlock?.price_median_eur_m2 ??
      dvfBlock?.prix_m2_median ??
      dvfBlock?.medianPriceM2
    );
    const demandIndex = num(
      data.demandIndex ??
      indicesBlock?.demand_index ??
      indicesBlock?.demand ??
      indicesBlock?.demandIndex
    );
    const compsCount = num(
      data.compsCount ??
      dvfBlock?.transactions_count ??
      dvfBlock?.nb_transactions ??
      data.transactions?.count
    );
    const evolutionPct = num(
      data.evolutionPct ??
      dvfBlock?.evolution_pct ??
      dvfBlock?.evolution_prix_pct
    );

    const sources: string[] = data.sources ?? [];
    if (sources.length === 0) {
      if (dvfBlock) sources.push("DVF");
      if (data.commune?.population) sources.push("INSEE");
      if (data.transport) sources.push("Transport");
      if (data.ecoles) sources.push("Écoles");
      if (data.finess) sources.push("FINESS");
      if (data.osmServices ?? data.osm_services) sources.push("OSM");
    }

    return {
      ...data,
      commune,
      osmServices: data.osmServices ?? data.osm_services ?? data.services ?? undefined,
      finess: data.finess ?? undefined,
      pricePerSqm,
      demandIndex,
      compsCount,
      evolutionPct,
      sources,
    };
  }

  // Shape B: demographics flat
  const demo = data.demographics ?? data.insee ?? data;
  const communeName =
    demo.commune_name ?? demo.nom_commune ?? demo.nom ?? demo.libelle;

  if (communeName) {
    return {
      ...data,
      commune: {
        nom: communeName,
        population: num(demo.population ?? demo.pop),
        densiteHabKm2: num(demo.densite ?? demo.densiteHabKm2 ?? demo.density),
        departement: demo.departement ?? demo.dep_name ?? demo.nom_departement,
        region: demo.region ?? demo.reg_name ?? demo.nom_region,
      },
      osmServices: data.osmServices ?? data.osm_services ?? data.services
        ? {
            count1km: num(
              get(data, "osmServices.count1km") ??
              get(data, "osm_services.count_1km") ??
              get(data, "services.total")
            ),
          }
        : undefined,
      finess: data.finess
        ? { count: num(data.finess.count ?? data.finess.total ?? data.finess.length) }
        : undefined,
    };
  }

  // Fallback
  if (data.pricePerSqm || data.demandIndex || data.compsCount) {
    return data;
  }

  return undefined;
}

// ── Main normalizer ──────────────────────────────────────────────

export function normalizeEnrichedOperation(
  enrichedOp: Record<string, any>,
  originalOp?: OperationSummary
): OperationSummary {
  const base = { ...(originalOp ?? {}), ...enrichedOp } as Record<string, any>;

  // ── Normalize sub-sections ──
  const risks = normalizeRisks(base.risks) ?? normalizeRisks(base.risksRefresh);

  // ✅ FIX v4: Normalize DVF from ALL available sources, then MERGE them.
  const dvfFromBase = normalizeDvf(base.dvf);
  const dvfFromMarket = normalizeDvf(base.market?.dvf);
  const dvfFromStudy = normalizeDvf(base.marketStudy?.dvf);
  const dvf = mergeDvfSources(dvfFromBase, dvfFromMarket, dvfFromStudy);

  const market = normalizeMarket(base.market) ?? normalizeMarket(base.marketStudy);

  // ── Merge normalized data ──
  const normalized: OperationSummary = {
    ...base,

    // Overwrite with normalized versions (only if we got data)
    ...(risks ? { risks } : {}),
    ...(dvf ? { dvf } : {}),
    ...(market ? { market } : {}),

    // Preserve metadata
    dossierId: base.dossierId,
    profile: base.profile,
    project: base.project,
    budget: base.budget,
    financing: base.financing,      // ✅ FIX v5: Préserve financing
    revenues: base.revenues,        // ✅ FIX v5: Préserve revenues
    kpis: base.kpis,
    meta: base.meta,
    missing: base.missing ?? [],

    // Keep raw data for debug
    _raw: {
      risks: base.risks,
      market: base.market,
      dvf: base.dvf,
      riskStudy: base.riskStudy,
      marketStudy: base.marketStudy,
      committee: base.committee,
    },
  } as OperationSummary;

  return normalized;
}

/**
 * Vérifie si une operation a des données enrichies exploitables.
 */
export function hasEnrichedData(op: OperationSummary): boolean {
  return !!(
    op.risks?.geo?.score !== undefined ||
    op.dvf?.stats?.transactions_count ||
    op.market?.commune?.nom ||
    op.market?.pricePerSqm
  );
}