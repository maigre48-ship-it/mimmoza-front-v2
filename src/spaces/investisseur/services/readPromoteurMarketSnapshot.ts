/**
 * readPromoteurMarketSnapshot.ts
 * ─────────────────────────────────────────────────────────────────────
 * Lecture seule du snapshot promoteur depuis le front investisseur.
 *
 * Ce fichier ne touche PAS au module promoteur.
 * Il lit directement le localStorage utilisé par le promoteur
 * et retourne un objet typé ou null.
 *
 * Clés localStorage lues (définie dans promoteurSnapshot.store.ts) :
 *   - "mimmoza.promoteur.snapshot.v1"     → snapshot agrégé
 *   - "mimmoza.promoteur.active_study_id" → studyId actif
 *
 * Préfixe logs : [InvestisseurBridge]
 * ─────────────────────────────────────────────────────────────────────
 */

// ─── Clés localStorage du promoteur ──────────────────────────────────
// Doivent correspondre exactement aux constantes de
// promoteurSnapshot.store.ts — si le promoteur change ses clés,
// mettre à jour ici uniquement.

const PROMOTEUR_SNAPSHOT_KEY  = "mimmoza.promoteur.snapshot.v1";
const PROMOTEUR_ACTIVE_STUDY  = "mimmoza.promoteur.active_study_id";

// ─── Types minimaux attendus ─────────────────────────────────────────
// On ne ré-importe PAS les types promoteur pour éviter le couplage.
// On déclare uniquement ce qu'on lit.

export interface PromoteurMarketData {
  /** Données DVF (transactions historiques) */
  dvf?: {
    transactions?: unknown[];
    stats?: Record<string, unknown>;
    prixM2Median?: number;
    prixM2Moyen?: number;
    nbTransactions?: number;
    [key: string]: unknown;
  };
  /** Données INSEE / démographie */
  insee?: {
    population?: number;
    densiteHabKm2?: number;
    revenuMedian?: number;
    tauxChomage?: number;
    [key: string]: unknown;
  };
  /** Données BPE (équipements) */
  bpe?: {
    equipements?: unknown[];
    scores?: Record<string, unknown>;
    score_v2?: number;
    coverage_pct_v2?: number;
    [key: string]: unknown;
  };
  /** Données transport */
  transport?: {
    score?: number;
    stations?: unknown[];
    [key: string]: unknown;
  };
  /** Données FINESS (santé) */
  finess?: {
    etablissements?: unknown[];
    [key: string]: unknown;
  };
  /** Données risques (GeoRisques etc.) */
  risques?: {
    naturels?: unknown[];
    technologiques?: unknown[];
    scoreGlobal?: number;
    [key: string]: unknown;
  };
  /** Données concurrence / OSM */
  concurrence?: {
    programmes?: unknown[];
    [key: string]: unknown;
  };
  /** Scores agrégés */
  scores?: {
    global?: number;
    demande?: number;
    offre?: number;
    accessibilite?: number;
    environnement?: number;
    liquidite?: number;
    opportunity?: number;
    pressionRisque?: number;
    [key: string]: unknown;
  };
  /** Coordonnées géographiques */
  lat?: number;
  lng?: number;
  /** Commune / code postal */
  commune?: string;
  codePostal?: string;
  codeInsee?: string;
  /** Surface, adresse etc. */
  adresse?: string;
  surfaceM2?: number;
  /** Tout champ supplémentaire */
  [key: string]: unknown;
}

export interface PromoteurSnapshotEnvelope {
  /** Données de marché (module "marketStudy" ou "marcheRisques") */
  marketStudy?: PromoteurMarketData;
  marcheRisques?: PromoteurMarketData;
  marche?: PromoteurMarketData;
  /** Sous-objet "data" si wrappé */
  data?: PromoteurMarketData;
  /** Sous-objet "core" si wrappé */
  core?: Record<string, unknown>;
  /** Scores au top-level */
  scores?: Record<string, unknown>;
  scoreGlobal?: number;
  /** projectInfo (contient parfois commune, address, etc.) */
  projectInfo?: Record<string, unknown>;
  /** Tout champ supplémentaire */
  [key: string]: unknown;
}

// ─── Fonction principale ─────────────────────────────────────────────

/**
 * Lit le snapshot promoteur depuis localStorage.
 *
 * @param expectedDealId  – Le dealId investisseur actif.
 *   Si le snapshot promoteur concerne un studyId différent, retourne null.
 *   Si `expectedDealId` est vide/undefined, retourne null (sécurité).
 *
 * @returns Le snapshot promoteur typé, ou null.
 */
export function readPromoteurMarketSnapshot(
  expectedDealId: string | undefined,
): PromoteurSnapshotEnvelope | null {
  if (!expectedDealId) {
    console.debug(
      "[InvestisseurBridge] readPromoteurMarketSnapshot — pas de dealId fourni, skip",
    );
    return null;
  }

  try {
    // ── Vérifier le studyId actif du promoteur ───────────────────────
    const activeStudyId = localStorage.getItem(PROMOTEUR_ACTIVE_STUDY);

    // Si le promoteur a un studyId actif et qu'il ne correspond pas
    // au dealId investisseur, on ignore le snapshot.
    if (activeStudyId && activeStudyId !== expectedDealId) {
      console.debug(
        `[InvestisseurBridge] readPromoteurMarketSnapshot — studyId mismatch : ` +
        `promoteur="${activeStudyId}" vs investisseur="${expectedDealId}", skip`,
      );
      return null;
    }

    // ── Lire le snapshot ─────────────────────────────────────────────
    const raw = localStorage.getItem(PROMOTEUR_SNAPSHOT_KEY);
    if (!raw) {
      console.debug(
        "[InvestisseurBridge] readPromoteurMarketSnapshot — aucun snapshot promoteur en localStorage",
      );
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      console.debug(
        "[InvestisseurBridge] readPromoteurMarketSnapshot — snapshot promoteur invalide (pas un objet)",
      );
      return null;
    }

    const envelope = parsed as PromoteurSnapshotEnvelope;

    console.debug(
      "[InvestisseurBridge] readPromoteurMarketSnapshot — snapshot promoteur lu avec succès",
      {
        activeStudyId: activeStudyId || "(non défini)",
        topLevelKeys: Object.keys(envelope),
        hasMarketStudy: !!(envelope.marketStudy || envelope.marcheRisques || envelope.marche),
        hasScores: !!(envelope.scores || envelope.scoreGlobal),
        hasCore: !!envelope.core,
        hasData: !!envelope.data,
      },
    );

    return envelope;
  } catch (err) {
    console.debug(
      "[InvestisseurBridge] readPromoteurMarketSnapshot — erreur lecture/parse :",
      err,
    );
    return null;
  }
}

// ─── Helper : extraire les données marché du snapshot ─────────────────

/**
 * Raccourci : retourne un objet PromoteurMarketData agrégé depuis
 * le snapshot, en cherchant dans les clés connues.
 */
export function readPromoteurMarketData(
  expectedDealId: string | undefined,
): PromoteurMarketData | null {
  const envelope = readPromoteurMarketSnapshot(expectedDealId);
  if (!envelope) return null;

  // Le snapshot promoteur est un Record plat — les données marché
  // peuvent être sous différentes clés selon le flux qui les a écrites.
  const market: PromoteurMarketData =
    envelope.marketStudy ??
    envelope.marcheRisques ??
    envelope.marche ??
    envelope.data ??
    null as unknown as PromoteurMarketData;

  if (market && typeof market === "object") {
    console.debug(
      "[InvestisseurBridge] readPromoteurMarketData — données marché extraites",
      { keys: Object.keys(market) },
    );
    return market;
  }

  // Fallback : le snapshot lui-même contient peut-être les champs
  // directement au top-level (dvf, insee, bpe…)
  const hasDirect =
    envelope.dvf != null ||
    envelope.insee != null ||
    envelope.bpe != null ||
    envelope.scores != null ||
    envelope.core != null;

  if (hasDirect) {
    console.debug(
      "[InvestisseurBridge] readPromoteurMarketData — données marché au top-level du snapshot",
    );
    return envelope as PromoteurMarketData;
  }

  console.debug(
    "[InvestisseurBridge] readPromoteurMarketData — pas de données marché exploitables",
  );
  return null;
}