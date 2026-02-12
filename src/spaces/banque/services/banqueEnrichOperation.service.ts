// ============================================================================
// banqueEnrichOperation.service.ts
// src/spaces/banque/services/banqueEnrichOperation.service.ts
//
// Service front pour enrichir un OperationSummary via l'Edge Function
// banque-operation-enrich-v1.
//
// ✅ Singleton Supabase client (importé de src/lib/supabaseClient.ts)
// ✅ extractOperationEnriched tolérant (multiple shapes)
// ✅ Logging amélioré: status HTTP + body brut + timing pour debug
// ✅ FIX: envoie options.withMarketStudy = true pour déclencher STEP 3
// ✅ FIX v2: hydrateMarketData() — injecte les données marché/risques
//    retournées par l'Edge Function dans l'OperationSummary extraite.
//    Résout: hasDvfStats=false, hasMarketCommune=false, hasMarketPricePerSqm=false
// ✅ FIX v3: normalizeOperationForEnrich() — utilise la localisation PROJET
//    (pas emprunteur) + injecte les garanties dans le payload.
// ✅ FIX v3.1: normalizeOperationForEnrich() lit aussi operation.origination.*
//    (shape BanqueSnapshot) et n'utilise JAMAIS les champs emprunteur.
// ============================================================================

import { supabase } from "@/lib/supabaseClient";
import type {
  OperationSummary,
  OperationProfile,
} from "../types/operationSummary.types";

// ── Types ──

export interface EnrichResult {
  operation: OperationSummary;
  sources: string[];
  warnings: string[];
}

export interface EnrichError {
  message: string;
  details?: string;
  httpStatus?: number;
}

// ── FIX v3.1: Normalize operation before sending to backend ──

/**
 * Normalise l'opération AVANT envoi au backend pour garantir :
 *  1. operation.project contient la localisation du PROJET (pas de l'emprunteur)
 *  2. Les garanties sont présentes dans le payload
 *
 * Règle : si origination.adresseProjet / codePostalProjet existent,
 *         ils ont priorité absolue.
 *         L'emprunteur ne pilote JAMAIS la géo si une adresse projet est renseignée.
 */
function normalizeOperationForEnrich(operation: OperationSummary): OperationSummary {
  // Deep clone to avoid mutations
  const op = JSON.parse(JSON.stringify(operation)) as any;

  // Ensure op.project exists
  if (!op.project || typeof op.project !== "object") {
    op.project = {};
  }

  const p = op.project as any;

  // ✅ NEW: BanqueSnapshot / Dossier shape stores project location under origination.*
  const o = (op.origination && typeof op.origination === "object") ? op.origination : null;

  // ──────────────────────────────────────────────────────────
  // 1. ADDRESS NORMALIZATION — Project location has priority
  // ──────────────────────────────────────────────────────────

  // STRICT project-first chain (origination > project)
  const resolvedAddress =
    o?.adresseProjet ??
    p.adresseProjet ??
    p.projectAddress ??
    p.addressProjet ??
    p.address ??
    p.adresse ??
    null;

  const resolvedPostalCode =
    o?.codePostalProjet ??
    p.codePostalProjet ??
    p.postalCode ??
    p.codePostal ??
    p.cp ??
    null;

  const resolvedCity =
    o?.communeProjet ??
    p.communeProjet ??
    p.city ??
    p.commune ??
    p.ville ??
    null;

  const resolvedInsee =
    o?.communeInseeProjet ??
    p.communeInseeProjet ??
    p.communeInsee ??
    p.insee ??
    p.codeInsee ??
    null;

  // ── Parcelle cadastrale / section / département ──
  const resolvedParcelle =
    p.parcelleCadastrale ??
    p.parcelle ??
    p.parcel ??
    p.cadastralParcel ??
    null;

  const resolvedSection =
    p.sectionCadastrale ??
    p.section ??
    p.cadastralSection ??
    null;

  const resolvedPrefixe =
    p.prefixeCadastral ??
    p.prefixe ??
    p.cadastralPrefix ??
    null;

  const resolvedDepartement =
    o?.departementProjet ??
    p.departementProjet ??
    p.departement ??
    p.department ??
    (resolvedPostalCode ? String(resolvedPostalCode).substring(0, 2) : null);

  const resolvedLat = p.latProjet ?? p.lat ?? p.latitude ?? null;
  const resolvedLng = p.lngProjet ?? p.lng ?? p.longitude ?? null;

  // 🚫 IMPORTANT: never fall back to borrower/emprunteur address fields
  // (avoid accidental geo on emprunteur)
  delete p.adresse_emprunteur;
  delete p.borrowerAddress;

  // Inject normalized fields into project (overwrite to ensure correctness)
  if (resolvedAddress) p.address = resolvedAddress;
  if (resolvedPostalCode) p.postalCode = resolvedPostalCode;
  if (resolvedCity) p.city = resolvedCity;
  if (resolvedInsee) p.communeInsee = resolvedInsee;

  if (resolvedParcelle) p.parcelleCadastrale = resolvedParcelle;
  if (resolvedSection) p.sectionCadastrale = resolvedSection;
  if (resolvedPrefixe) p.prefixeCadastral = resolvedPrefixe;
  if (resolvedDepartement) p.departement = resolvedDepartement;
  if (resolvedLat != null) p.lat = resolvedLat;
  if (resolvedLng != null) p.lng = resolvedLng;

  console.log("[BanqueEnrich] ✅ Using PROJECT location for enrich:", {
    address: resolvedAddress,
    postalCode: resolvedPostalCode,
    city: resolvedCity,
    communeInsee: resolvedInsee,
    departement: resolvedDepartement,
    parcelle: resolvedParcelle,
    section: resolvedSection,
    lat: resolvedLat,
    lng: resolvedLng,
    // helpful debug: show whether origination was used
    usedOrigination: !!(o?.adresseProjet || o?.communeProjet || o?.communeInseeProjet || o?.codePostalProjet),
  });

  // ──────────────────────────────────────────────────────────
  // 2. GARANTIES INJECTION
  // ──────────────────────────────────────────────────────────

  // Detect garanties from multiple possible shapes
  const existingGaranties =
    op.garanties ??
    op.guarantees ??
    op.collateral ??
    p.garanties ??
    null;

  if (existingGaranties && typeof existingGaranties === "object") {
    // Normalize to standard shape
    const items = Array.isArray(existingGaranties)
      ? existingGaranties
      : existingGaranties.items ?? [];

    const couvertureTotale =
      existingGaranties.couvertureTotale ??
      (Array.isArray(items)
        ? items.reduce((sum: number, g: any) => sum + (g.valeurEstimee ?? g.value ?? 0), 0)
        : 0);

    const ratioGarantieSurPret =
      existingGaranties.ratioGarantieSurPret ??
      existingGaranties.ratio ??
      null;

    op.garanties = {
      items,
      couvertureTotale,
      ratioGarantieSurPret,
      commentaire: existingGaranties.commentaire ?? existingGaranties.comment ?? undefined,
    };

    console.log("[BanqueEnrich] ✅ Garanties in payload:", {
      count: items.length,
      couvertureTotale,
      ratio: ratioGarantieSurPret,
    });
  } else {
    console.warn("[BanqueEnrich] ⚠️ No garanties found in operation payload");
  }

  return op as OperationSummary;
}

// ── Tolerant extraction of the enriched operation from backend response ──

/**
 * Extracts the enriched operation from the backend response.
 * Tries multiple known shapes:
 *   1. data.operation_enriched
 *   2. data.operation
 *   3. data.operationEnriched
 *   4. data.result.operation_enriched
 *   5. data.result.operationEnriched
 *   6. data.result.operation
 *   7. Fallback: data.committee (wrap as partial operation)
 *
 * Returns null if nothing found.
 */
function extractOperationEnriched(data: any): OperationSummary | null {
  if (!data || typeof data !== "object") return null;

  // Direct top-level keys
  if (data.operation_enriched && typeof data.operation_enriched === "object") {
    return data.operation_enriched as OperationSummary;
  }
  if (data.operation && typeof data.operation === "object") {
    return data.operation as OperationSummary;
  }
  if (data.operationEnriched && typeof data.operationEnriched === "object") {
    return data.operationEnriched as OperationSummary;
  }

  // Nested under result
  const result = data.result;
  if (result && typeof result === "object") {
    if (result.operation_enriched && typeof result.operation_enriched === "object") {
      return result.operation_enriched as OperationSummary;
    }
    if (result.operationEnriched && typeof result.operationEnriched === "object") {
      return result.operationEnriched as OperationSummary;
    }
    if (result.operation && typeof result.operation === "object") {
      return result.operation as OperationSummary;
    }
  }

  // Last resort: if there's a committee payload, wrap it
  const committee = data.committee ?? result?.committee;
  if (committee && typeof committee === "object") {
    console.warn(
      "[BanqueEnrich] ⚠️ No operation_enriched found, using committee fallback"
    );
    return {
      committee,
      dossierId: data.dossierId,
    } as unknown as OperationSummary;
  }

  return null;
}

// ── Market data hydration ──

/**
 * Injecte les données marché / risques retournées par l'Edge Function
 * dans l'OperationSummary extraite.
 *
 * Problème résolu:
 *   L'Edge Function retourne les données marché au ROOT de la réponse
 *   (data.market, data.risks, etc.) ou sous data.result.market,
 *   mais extractOperationEnriched() ne copie que l'objet "operation".
 *   → Le scoring engine ne trouve jamais market.dvf, market.prices, etc.
 *
 * Cette fonction cherche les données marché dans la réponse brute
 * et les fusionne dans operation.market / operation.risks.
 *
 * ✅ FIX v3: Préserve les garanties à travers l'hydratation.
 */
function hydrateMarketData(
  operation: OperationSummary,
  rawResponse: any
): OperationSummary {
  if (!rawResponse || typeof rawResponse !== "object") return operation;

  const op = { ...operation } as any;
  const result = rawResponse.result ?? rawResponse;

  // ── FIX v3: Preserve garanties from the normalized operation ──
  // Save garanties BEFORE any merge that could overwrite them
  const savedGaranties = (operation as any).garanties ?? null;

  // ── 1. Trouver le bloc market dans la réponse ──
  // L'Edge Function retourne le market sous différents chemins
  const marketPayload =
    rawResponse.market ??
    result?.market ??
    rawResponse.marketStudy ??
    result?.marketStudy ??
    null;

  if (marketPayload && typeof marketPayload === "object") {
    // Initialise operation.market si absent
    if (!op.market || typeof op.market !== "object") {
      op.market = {};
    }

    // ─────────────────────────────────────────────────────────
    // SHAPE A: market-study-promoteur-v1 v1.1.0+
    //   { success, version, meta, core, specific, scores,
    //     scoring_details, insights, commune, pricePerSqm }
    //   core.dvf = { nb_transactions, prix_m2_median, ... }
    //   meta = { commune_insee, commune_nom, departement, ... }
    // ─────────────────────────────────────────────────────────
    const core = marketPayload.core;
    const meta = marketPayload.meta;
    const scores = marketPayload.scores;
    const specific = marketPayload.specific;

    if (core && typeof core === "object") {
      // ── DVF from core.dvf ──
      const dvfRaw = core.dvf;
      if (dvfRaw && typeof dvfRaw === "object") {
        // Normalize DVF: include BOTH naming conventions so any consumer finds the data
        // market-study-promoteur-v1 uses: prix_m2_median, nb_transactions, prix_m2_moyen
        // smartscore-enriched-v3 uses: price_median_eur_m2, transactions_count, price_mean_eur_m2
        const medianPrice = dvfRaw.prix_m2_median ?? dvfRaw.price_median_eur_m2 ?? null;
        const meanPrice = dvfRaw.prix_m2_moyen ?? dvfRaw.price_mean_eur_m2 ?? null;
        const minPrice = dvfRaw.prix_m2_min ?? dvfRaw.price_q1_eur_m2 ?? null;
        const maxPrice = dvfRaw.prix_m2_max ?? dvfRaw.price_q3_eur_m2 ?? null;
        const q1Price = dvfRaw.prix_m2_q1 ?? dvfRaw.price_q1_eur_m2 ?? minPrice;
        const q3Price = dvfRaw.prix_m2_q3 ?? dvfRaw.price_q3_eur_m2 ?? maxPrice;
        const txCount = dvfRaw.nb_transactions ?? dvfRaw.transactions_count ?? 0;
        const evoPct = dvfRaw.evolution_prix_pct ?? dvfRaw.evolution_pct ?? null;

        if (!op.market.dvf) {
          op.market.dvf = {
            coverage: txCount > 0 ? "ok" : "no_data",
            source: "market-study-promoteur-v1",
            // Original raw data
            ...dvfRaw,
            // Normalized fields (enriched-v3 convention)
            price_median_eur_m2: medianPrice,
            price_mean_eur_m2: meanPrice,
            price_q1_eur_m2: q1Price,
            price_q3_eur_m2: q3Price,
            transactions_count: txCount,
            evolution_pct: evoPct,
            // market-study-promoteur convention (keep both)
            prix_m2_median: medianPrice,
            prix_m2_moyen: meanPrice,
            prix_m2_min: minPrice,
            prix_m2_max: maxPrice,
            nb_transactions: txCount,
          };
        }
        if (!op.market.prices) {
          op.market.prices = {
            median_eur_m2: medianPrice,
            mean_eur_m2: meanPrice,
            min_eur_m2: minPrice,
            max_eur_m2: maxPrice,
            q1_eur_m2: q1Price,
            q3_eur_m2: q3Price,
            // Also keep French naming
            prix_m2_median: medianPrice,
            prix_m2_moyen: meanPrice,
          };
        }
        if (!op.market.transactions) {
          op.market.transactions = {
            count: txCount,
            transactions_count: txCount,
            nb_transactions: txCount,
            evolution_pct: evoPct,
          };
        }
        if (op.market.pricePerSqm == null && medianPrice != null) {
          op.market.pricePerSqm = medianPrice;
        }
        // Comps (transactions list)
        if (!op.market.comps && Array.isArray(dvfRaw.transactions)) {
          op.market.comps = dvfRaw.transactions;
        }

        // ── ALSO populate operation.dvf for AnalysePage consumption ──
        // AnalysePage reads: operation.dvf.stats.* and operation.dvf.comparables[]
        if (!op.dvf || typeof op.dvf !== "object") {
          op.dvf = {};
        }
        if (!op.dvf.stats) {
          op.dvf.stats = {
            transactions_count: txCount,
            price_median_eur_m2: medianPrice,
            price_mean_eur_m2: meanPrice,
            price_q1_eur_m2: q1Price,
            price_q3_eur_m2: q3Price,
            evolution_pct: evoPct,
          };
        }
        if (!op.dvf.comparables && Array.isArray(dvfRaw.transactions)) {
          op.dvf.comparables = dvfRaw.transactions.map((t: any) => ({
            date: t.date_mutation ?? t.date ?? null,
            price: t.valeur_fonciere ?? t.price ?? null,
            surface: t.surface_reelle_bati ?? t.surface ?? t.surface_m2 ?? null,
            pricePerSqm: t.prix_m2 ?? t.price_m2 ?? t.pricePerSqm ?? null,
            type: t.type_local ?? t.type ?? null,
            commune: t.commune ?? null,
          }));
        }
      }

      // ── Other core sections (insee, bpe, transport, etc.) ──
      if (!op.market.insee && core.insee) {
        op.market.insee = core.insee;
      }
      if (!op.market.bpe && core.bpe) {
        op.market.bpe = core.bpe;
      }
      if (!op.market.transport && core.transport) {
        op.market.transport = core.transport;
      }
      if (!op.market.ecoles && core.ecoles) {
        op.market.ecoles = core.ecoles;
      }
      if (!op.market.sante && (core.sante ?? core.healthSummary)) {
        op.market.sante = core.sante ?? core.healthSummary;
      }
      if (!op.market.services_ruraux && core.services_ruraux) {
        op.market.services_ruraux = core.services_ruraux;
      }
      if (!op.market.essential_services && core.essential_services) {
        op.market.essential_services = core.essential_services;
      }
    }

    // ── Meta → commune / INSEE code / population ──
    if (meta && typeof meta === "object") {
      // AnalysePage reads operation.market.commune as an OBJECT: { nom, population, ... }
      if (!op.market.commune || typeof op.market.commune === "string") {
        const communeNom =
          meta.commune_nom ??
          (typeof op.market.commune === "string" ? op.market.commune : null);
        const population = core?.insee?.population ?? meta.population ?? null;
        const densiteHabKm2 =
          core?.insee?.densite ?? core?.insee?.densiteHabKm2 ?? meta.densite ?? null;
        const departement = meta.departement ?? null;
        const region = core?.insee?.region ?? meta.region ?? null;

        op.market.commune = {
          nom: communeNom,
          code: meta.commune_insee ?? null,
          population: population,
          densiteHabKm2: densiteHabKm2,
          departement: departement,
          region: region,
        };
      }
      if (!op.market.communeInsee) {
        op.market.communeInsee = meta.commune_insee ?? null;
      }
      if (!op.market.communeNom) {
        op.market.communeNom = meta.commune_nom ?? null;
      }
      if (!op.market.departement) {
        op.market.departement = meta.departement ?? null;
      }
      if (op.market.population == null) {
        op.market.population = core?.insee?.population ?? meta.population ?? null;
      }
      if (!op.market.meta) {
        op.market.meta = meta;
      }
    }

    // ── Scores from market-study ──
    if (scores && typeof scores === "object") {
      if (op.market.score == null && scores.global != null) {
        op.market.score = scores.global;
      }
      if (!op.market.scores) {
        op.market.scores = scores;
      }
      // Map indices for scoring engine
      if (op.market.demand_index == null && scores.demand != null) {
        op.market.demand_index = scores.demand;
      }
      if (op.market.supply_index == null && scores.supply != null) {
        op.market.supply_index = scores.supply;
      }
      if (op.market.price_index == null && scores.price != null) {
        op.market.price_index = scores.price;
      }
    }

    // ── Specific (project-type-specific data) ──
    if (specific && typeof specific === "object" && !op.market.specific) {
      op.market.specific = specific;
    }

    // ── Scoring details ──
    if (marketPayload.scoring_details && !op.market.scoring_details) {
      op.market.scoring_details = marketPayload.scoring_details;
    }

    // ── Insights ──
    if (marketPayload.insights && !op.market.insights) {
      op.market.insights = marketPayload.insights;
    }

    // ─────────────────────────────────────────────────────────
    // SHAPE B: Legacy / flat structure fallback
    //   { dvf, prices, transactions, commune, insee, ... }
    // ─────────────────────────────────────────────────────────
    if (!core) {
      // Direct flat keys (legacy shape)
      if (!op.market.dvf && marketPayload.dvf) {
        op.market.dvf = marketPayload.dvf;
      }
      if (!op.market.prices && marketPayload.prices) {
        op.market.prices = marketPayload.prices;
      }
      if (!op.market.transactions && marketPayload.transactions) {
        op.market.transactions = marketPayload.transactions;
      }
      if (op.market.score == null && marketPayload.score != null) {
        op.market.score = marketPayload.score;
      }
      if (!op.market.commune) {
        const legacyNom =
          marketPayload.commune ?? marketPayload.input?.commune_insee ?? null;
        if (legacyNom) {
          op.market.commune =
            typeof legacyNom === "string"
              ? {
                  nom: legacyNom,
                  code: null,
                  population: null,
                  densiteHabKm2: null,
                  departement: null,
                  region: null,
                }
              : legacyNom;
        }
      }
      if (!op.market.insee && marketPayload.insee) {
        op.market.insee = marketPayload.insee;
      }
      if (op.market.pricePerSqm == null) {
        op.market.pricePerSqm =
          marketPayload.prices?.median_eur_m2 ?? marketPayload.prix_m2_median ?? null;
      }
      if (!op.market.bpe && marketPayload.bpe) {
        op.market.bpe = marketPayload.bpe;
      }
      if (!op.market.transport && marketPayload.transport) {
        op.market.transport = marketPayload.transport;
      }
      if (!op.market.ecoles && marketPayload.ecoles) {
        op.market.ecoles = marketPayload.ecoles;
      }
      if (
        !op.market.sante &&
        (marketPayload.sante ?? marketPayload.healthSummary)
      ) {
        op.market.sante = marketPayload.sante ?? marketPayload.healthSummary;
      }
      if (!op.market.services_ruraux && marketPayload.services_ruraux) {
        op.market.services_ruraux = marketPayload.services_ruraux;
      }
      if (!op.market.essential_services && marketPayload.essential_services) {
        op.market.essential_services = marketPayload.essential_services;
      }
      if (!op.market.ehpad && marketPayload.ehpad) {
        op.market.ehpad = marketPayload.ehpad;
      }
      if (!op.market.residences_seniors && marketPayload.residences_seniors) {
        op.market.residences_seniors = marketPayload.residences_seniors;
      }
      if (!op.market.comps && marketPayload.comps) {
        op.market.comps = marketPayload.comps;
      }
      if (!op.market.kpis && marketPayload.kpis) {
        op.market.kpis = marketPayload.kpis;
      }
      if (!op.market.verdict && marketPayload.verdict) {
        op.market.verdict = marketPayload.verdict;
      }
      if (!op.market.insights && marketPayload.insights) {
        op.market.insights = marketPayload.insights;
      }
      // Indices flat
      for (const idx of [
        "supply_index",
        "demand_index",
        "price_index",
        "accessibility_index",
        "risk_index",
        "global_score",
      ]) {
        if (op.market[idx] == null && marketPayload[idx] != null) {
          op.market[idx] = marketPayload[idx];
        }
      }
    }

    // ── Top-level commune/pricePerSqm (present in both shapes) ──
    if (!op.market.commune && marketPayload.commune) {
      const val = marketPayload.commune;
      op.market.commune =
        typeof val === "string"
          ? {
              nom: val,
              code: null,
              population: null,
              densiteHabKm2: null,
              departement: null,
              region: null,
            }
          : val;
    }
    if (op.market.pricePerSqm == null && marketPayload.pricePerSqm != null) {
      op.market.pricePerSqm = marketPayload.pricePerSqm;
    }

    console.log("[BanqueEnrich] 🔗 Market data hydrated into operation:", {
      shape: core ? "v1.1 (core/meta/scores)" : "legacy (flat)",
      hasDvf: !!op.market.dvf,
      hasPrices: !!op.market.prices,
      hasTransactions: !!op.market.transactions,
      hasCommune: !!op.market.commune,
      hasPricePerSqm: op.market.pricePerSqm != null,
      hasInsee: !!op.market.insee,
      hasBpe: !!op.market.bpe,
      hasScores: !!op.market.scores,
      score: op.market.score,
      pricePerSqm: op.market.pricePerSqm,
      commune: op.market.commune?.nom ?? op.market.commune,
      hasDvfOnOperation: !!op.dvf?.stats,
      transactionsCount: op.market.transactions?.count,
      marketKeys: Object.keys(op.market),
    });
  } else {
    console.warn(
      "[BanqueEnrich] ⚠️ No market payload found in raw response.",
      "Root keys:",
      Object.keys(rawResponse),
      "Result keys:",
      result ? Object.keys(result) : "none"
    );
  }

  // ── 2. Trouver le bloc risks dans la réponse ──
  const risksPayload =
    rawResponse.risks ??
    result?.risks ??
    rawResponse.riskAnalysis ??
    result?.riskAnalysis ??
    null;

  if (risksPayload && typeof risksPayload === "object") {
    if (!op.risks || typeof op.risks !== "object") {
      op.risks = {};
    }

    // Merge without overwriting existing data
    if (!op.risks.geo && risksPayload.geo) {
      op.risks.geo = risksPayload.geo;
    }
    if (!op.risks.natural && risksPayload.natural) {
      op.risks.natural = risksPayload.natural;
    }
    if (!op.risks.environmental && risksPayload.environmental) {
      op.risks.environmental = risksPayload.environmental;
    }
    if (op.risks.score == null && risksPayload.score != null) {
      op.risks.score = risksPayload.score;
    }
    if (!op.risks.level && risksPayload.level) {
      op.risks.level = risksPayload.level;
    }

    console.log("[BanqueEnrich] 🔗 Risks data hydrated into operation:", {
      hasGeo: !!op.risks.geo,
      score: op.risks.score,
      level: op.risks.level,
    });
  }

  // ── FIX v3: Restore garanties if they were lost during hydration ──
  if (savedGaranties && (!op.garanties || !op.garanties.items?.length)) {
    op.garanties = savedGaranties;
    console.log("[BanqueEnrich] 🔗 Garanties restored after hydration:", {
      count: savedGaranties.items?.length ?? 0,
      couvertureTotale: savedGaranties.couvertureTotale,
    });
  }

  return op as OperationSummary;
}

// ── Main service ──

/**
 * Enrichit une OperationSummary via l'Edge Function backend.
 * Appelle les moteurs : BAN geocoding, Géorisques, DVF, Market (INSEE/BPE/FINESS/OSM).
 * ⚠️ PLU/Urbanisme n'est PAS appelé (preuve/complétude côté front uniquement).
 */
export async function enrichOperationForDossier(
  dossierId: string,
  profile: OperationProfile,
  operation: OperationSummary,
  refresh = false
): Promise<{ data: EnrichResult | null; error: EnrichError | null }> {
  const startMs = performance.now();

  try {
    // ── FIX v3.1: Normalize operation (project location from origination + garanties) ──
    const normalizedOperation = normalizeOperationForEnrich(operation);

    // ── Log request payload ──
    console.group(`[BanqueEnrich] 🚀 Calling banque-operation-enrich-v1`);
    console.log("dossierId:", dossierId);
    console.log("profile:", profile);
    console.log("refresh:", refresh);
    console.log("operation.project (normalized):", normalizedOperation.project);
    console.log("operation.budget:", (normalizedOperation as any).budget);
    console.log("operation.garanties:", (normalizedOperation as any).garanties);
    console.groupEnd();

    const { data, error } = await supabase.functions.invoke(
      "banque-operation-enrich-v1",
      {
        body: {
          dossierId,
          profile,
          operation: normalizedOperation,
          options: {
            refresh,
            withMarketStudy: true,
            withRiskStudy: false,
            projectType: "logement",
            radiusKm: 5,
            debug: false,
          },
        },
      }
    );

    const elapsedMs = Math.round(performance.now() - startMs);

    // ── Log raw response ──
    console.group(`[BanqueEnrich] 📦 Response (${elapsedMs}ms)`);

    if (error) {
      // Supabase SDK wraps errors — extract what we can
      console.error("SDK error object:", error);
      console.error("error.message:", error.message);
      console.error("error.context:", (error as any).context);

      const httpStatus =
        (error as any).context?.status ?? (error as any).status ?? null;
      console.error("HTTP status:", httpStatus);
      console.groupEnd();

      return {
        data: null,
        error: {
          message: "Erreur lors de l'enrichissement",
          details: error.message ?? String(error),
          httpStatus: httpStatus ?? undefined,
        },
      };
    }

    // ── Log successful response ──
    console.log("data keys:", data ? Object.keys(data) : "null");
    console.log("sources:", (data as any)?.sources ?? []);
    console.log("warnings:", (data as any)?.warnings ?? []);
    console.groupEnd();

    // ── Tolerant extraction ──
    let enrichedOp = extractOperationEnriched(data);

    if (!enrichedOp) {
      console.error(
        "[BanqueEnrich] ⚠️ Réponse valide mais aucune operation enrichie trouvée.",
        "Keys:",
        data ? Object.keys(data) : "null",
        "Result keys:",
        (data as any)?.result ? Object.keys((data as any).result) : "none",
        "Full data:",
        JSON.stringify(data).slice(0, 2000)
      );
      return {
        data: null,
        error: {
          message: "Réponse invalide du serveur",
          details: "La réponse ne contient pas d'operation enrichie",
        },
      };
    }

    // ── FIX v3: Re-inject garanties from normalized operation into enriched ──
    // The backend may not return garanties in its response, so we preserve them.
    const normalizedGaranties = (normalizedOperation as any).garanties;
    if (normalizedGaranties && !(enrichedOp as any).garanties) {
      (enrichedOp as any).garanties = normalizedGaranties;
    }

    // ── FIX v2: Hydrate market/risk data from raw response ──
    // L'Edge Function retourne souvent market/risks au root level,
    // pas à l'intérieur de l'operation. On les injecte ici.
    enrichedOp = hydrateMarketData(enrichedOp, data);

    console.log(
      `[BanqueEnrich] ✓ Success (${elapsedMs}ms) — sources: [${(
        (data as any).sources ?? []
      ).join(", ")}], warnings: ${((data as any).warnings ?? []).length}`
    );

    return {
      data: {
        operation: enrichedOp,
        sources: (data as any).sources ?? [],
        warnings: (data as any).warnings ?? [],
      },
      error: null,
    };
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - startMs);
    console.error(`[BanqueEnrich] ✗ Exception after ${elapsedMs}ms:`, err);

    const isNetworkError =
      err instanceof TypeError &&
      (err.message.includes("fetch") || err.message.includes("network"));

    return {
      data: null,
      error: {
        message: isNetworkError
          ? "Erreur réseau — vérifiez votre connexion et que Supabase est accessible"
          : "Erreur inattendue lors de l'enrichissement",
        details: err instanceof Error ? err.message : "Erreur inconnue",
      },
    };
  }
}

/**
 * Convenience: enrichit puis retourne uniquement l'operation.
 * Throws si erreur (utile pour les workflows séquentiels).
 */
export async function enrichOrThrow(
  dossierId: string,
  profile: OperationProfile,
  operation: OperationSummary,
  refresh = false
): Promise<EnrichResult> {
  const { data, error } = await enrichOperationForDossier(
    dossierId,
    profile,
    operation,
    refresh
  );
  if (error || !data) {
    throw new Error(error?.message ?? "Enrichissement échoué");
  }
  return data;
}
