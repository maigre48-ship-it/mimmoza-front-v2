// src/spaces/copilot/utils/buildPredictiveSnapshotForCopilot.ts
// LOT 6 — Construit le PredictiveSnapshotContext à injecter dans MimmozaContext.
// Lit le snapshot Marchand (localStorage) + snapshot Investisseur en mémoire.
// Aucun appel réseau — données déjà calculées par le moteur prédictif Mimmoza.
// v4.4 — Ajout transport_gtfs (MobilityScore GTFS PostGIS)
// =============================================================================

import type { MobilityScore } from '../../../services/mobility/mobility.types';
import { formatMobilityForSnapshot } from '../../../services/mobility/mobilityClient';
import { getInvestisseurSnapshot } from '../../investisseur/shared/investisseurSnapshot.store';
import { readMarchandSnapshot } from '../../marchand/shared/marchandSnapshot.store';
import type { PredictiveSnapshotContext } from '../types/copilot.types';

// ── Helpers typés ─────────────────────────────────────────────────────────────

function n(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const p = parseFloat(v); if (Number.isFinite(p)) return p; }
  return null;
}
function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── Options passées depuis AnalysePredictivePanel ──────────────────────────────

export interface PredictiveSnapshotOpts {
  dealId: string;
  /** Horizon sélectionné dans l'UI (mois) */
  horizonMois?: number;
  /** Taux BCE et label pression (depuis getEcbRatesAnalysis) */
  bceRate?: number;
  bcePressureLabel?: string;
  /** Score Sitadel (depuis getPredictiveSitadelScore) */
  sitadelScore?: number;
  /** Score démographie calculé (depuis computeDemographieScoreFromRaw ou mrSpecific) */
  demographieScore?: number;
  /** Loyer médian saisi manuellement (€/m²/mois) */
  loyerMedianZone?: number;
  /** DPE détecté (ADEME, snap ou manuel) */
  dpe?: string;
  dpeSource?: string;
  /** Régime fiscal actif */
  fiscalRegime?: string;
  /** Nombre total de sources actives sur 17 (depuis snapshot.dataSources) */
  sourcesCount?: number;
  /**
   * v4.4 — Score mobilité GTFS PostGIS (depuis fetchMobilityScoreSafe).
   * Optionnel : si absent, transport_gtfs sera null dans le snapshot.
   */
  mobilityScore?: MobilityScore | null;
}

// ── Fonction principale ────────────────────────────────────────────────────────

/**
 * Lit le snapshot Marchand et Investisseur depuis les stores/localStorage,
 * et construit le PredictiveSnapshotContext à injecter dans MimmozaContext.
 *
 * À appeler dans useCopilotContext (buildContext) ou dans AnalysePredictivePanel
 * juste avant d'envoyer un message.
 *
 * v4.4 : passer `opts.mobilityScore` (résultat de fetchMobilityScoreSafe) pour
 * alimenter le bloc `transport_gtfs` — plus précis que le bloc `transport` legacy.
 *
 * Règle Copilot 4dodicies :
 *   - Utiliser transport_gtfs.total (plus précis) plutôt que transport.score
 *   - Citer les pillars si pertinent : rail (RER/Métro/TGV/TER), urban, employment, multimodal
 *   - Ne jamais confondre pillars.rail avec le SmartScore global (règle 4decies)
 *   - Si is_urban=false ET pillars.rail > 0 → mentionner TER/TGV même hors agglo
 */
export function buildPredictiveSnapshotForCopilot(
  opts: PredictiveSnapshotOpts,
): PredictiveSnapshotContext | null {
  try {
    const { dealId } = opts;
    const snap    = readMarchandSnapshot();
     
    const snapAny = snap as any;

    // ── Données marché (market-study-investisseur/marchand-v1) ──────────────
    const mr      = (snap.marcheRisquesByDeal?.[dealId] ?? null) as Record<string, unknown> | null;
    const mrData  = isObj((mr as any)?.data) ? (mr as any).data : (isObj(mr) ? mr : null);
    const mrCore  = isObj(mrData?.core)    ? (mrData.core    as Record<string, unknown>) : null;
    const mrScores = isObj(mrData?.scores) ? (mrData.scores  as Record<string, unknown>) : null;
    const mrInsee  = isObj(mrCore?.insee)  ? (mrCore.insee   as Record<string, unknown>) : null;
    const dvfObj   = isObj(mrCore?.dvf)    ? (mrCore.dvf     as Record<string, unknown>) : null;
    const bpeObj   = isObj(mrCore?.bpe)    ? (mrCore.bpe     as Record<string, unknown>) : null;
    const transportObj = isObj(mrCore?.transport) ? (mrCore.transport as Record<string, unknown>) : null;

    // ── Géorisques (clé localStorage dédiée, écrite par RisquesPage) ───────
    let georisquesRaw: Record<string, unknown> | null = null;
    try {
      const geoKeys = [
        `mimmoza.georisques.${dealId}`,
        snap.activeDealId ? `mimmoza.georisques.${snap.activeDealId}` : null,
      ].filter(Boolean) as string[];
      for (const k of geoKeys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (isObj(parsed)) { georisquesRaw = parsed; break; }
        }
      }
    } catch { /* noop */ }

    // Compte les risques non-nuls
    let nbRisques: number | null = null;
    if (georisquesRaw) {
      const riskKeys = [
        'inondation', 'seisme', 'argiles', 'cavites',
        'mouvements_terrain', 'radon', 'icpe', 'sis', 'feux_foret',
      ];
      nbRisques = riskKeys.filter(k => {
        const v = georisquesRaw![k];
        if (!isObj(v)) return false;
        const rl = (v as any).risk_level;
        return rl && rl !== 'nul' && rl !== 'faible';
      }).length;
    }

    // ── Rentabilité ──────────────────────────────────────────────────────────
    const rentaRaw     = (snap.rentabiliteByDeal?.[dealId] ?? null) as Record<string, unknown> | null;
    const rentaComp    = isObj((rentaRaw as any)?.computed) ? (rentaRaw as any).computed
                       : isObj((rentaRaw as any)?.results)  ? (rentaRaw as any).results
                       : null;
    const rentaInputs  = isObj((rentaRaw as any)?.inputs) ? (rentaRaw as any).inputs : null;

    // ── Budget travaux (Investisseur snapshot) ───────────────────────────────
    const investSnap   = getInvestisseurSnapshot();
    const investPid    = investSnap.activeProjectId;
    const investTravaux = investPid
      ? investSnap.projects?.[investPid]?.execution?.travaux?.computed
      : null;
    const travauxBudget =
      n(investTravaux?.totalWithBuffer ?? investTravaux?.total) ??
      n(rentaInputs?.travauxUtilises ?? rentaInputs?.travauxEstimes ?? rentaInputs?.travaux);

    // ── PLU zone (si stockée dans pluByDeal) ─────────────────────────────────
    const pluZone = s(snapAny?.pluByDeal?.[dealId]?.zone_code) ?? null;

    // ── Deal label ────────────────────────────────────────────────────────────
    const dealLabel =
      s(snapAny?.deals?.[dealId]?.label) ??
      s(snapAny?.deals?.[dealId]?.address) ??
      null;

    // ── v4.4 : Transport GTFS ─────────────────────────────────────────────────
    const transportGtfs = opts.mobilityScore
      ? formatMobilityForSnapshot(opts.mobilityScore)
      : null;

    // ── Comptage des sources actives ─────────────────────────────────────────
    let activeSources = 0;
    if (dvfObj?.prix_m2_median   != null) activeSources++;           // DVF prix médian
    if (dvfObj?.nb_transactions  != null) activeSources++;           // DVF volume
    if (dvfObj?.evolution_prix_pct != null) activeSources++;         // DVF évolution
    if (mrScores?.global         != null) activeSources++;           // Scores marché
    if (bpeObj?.score            != null) activeSources++;           // BPE
    if (opts.bceRate             != null) activeSources++;           // BCE
    if (opts.dpe                       ) activeSources++;            // DPE
    if (georisquesRaw && nbRisques != null) activeSources++;         // Géorisques
    if (opts.sitadelScore        != null) activeSources++;           // Sitadel
    if (opts.demographieScore    != null) activeSources++;           // Démographie
    if (rentaComp?.rendementBrut != null ||
        rentaComp?.margeBrute   != null)  activeSources++;           // Rentabilité
    if (travauxBudget            != null) activeSources++;           // Budget travaux
    if (rentaInputs?.regime || opts.fiscalRegime) activeSources++;  // Fiscalité
    if (mrInsee?.population      != null) activeSources++;           // INSEE
    if (opts.loyerMedianZone     != null) activeSources++;           // Loyer médian
    // v4.4 : transport GTFS compte comme source si score > 0
    if (transportGtfs != null && (transportGtfs.total ?? 0) > 0) activeSources++;
    activeSources += 2; // Source projection + Horizon toujours présents

    // ── Construction du snapshot ─────────────────────────────────────────────
    const snapshot: PredictiveSnapshotContext = {
      deal_id:       dealId,
      deal_label:    dealLabel,
      generated_at:  new Date().toISOString(),
      sources_count: opts.sourcesCount ?? activeSources,
      horizon_mois:  opts.horizonMois ?? null,

      dvf: dvfObj ? {
        prix_m2_median:     n(dvfObj.prix_m2_median),
        nb_transactions:    n(dvfObj.nb_transactions),
        evolution_prix_pct: n(dvfObj.evolution_prix_pct),
        prix_m2_min:        n(dvfObj.prix_m2_min),
        prix_m2_max:        n(dvfObj.prix_m2_max),
      } : null,

      market_scores: mrScores ? {
        global:          n(mrScores.global),
        demande:         n(mrScores.demande),
        offre:           n(mrScores.offre),
        accessibilite:   n(mrScores.accessibilite),
        environnement:   n(mrScores.environnement),
        transport_exclu: mrScores.transport_exclu === true,
      } : null,

      insee: mrInsee ? {
        population:    n(mrInsee.population),
        densite:       n(mrInsee.densite),
        revenu_median: n(mrInsee.revenu_median),
        taux_chomage:  n(mrInsee.taux_chomage),
        taux_pauvrete: n(mrInsee.taux_pauvrete),
        pct_75_plus:   n(mrInsee.pct_75_plus),
        pct_etudiants: n(mrInsee.pct_etudiants),
        commune_nom:   s(mrInsee.commune_nom),
        departement:   s(mrInsee.departement),
      } : null,

      bpe: bpeObj ? {
        score:              n(bpeObj.score),
        total_equipements:  n(bpeObj.total_equipements),
        nb_ecoles:          n(bpeObj.nb_ecoles),
        nb_pharmacies:      n(bpeObj.nb_pharmacies),
        nb_supermarches:    n(bpeObj.nb_supermarches),
        commerces_count:    n((bpeObj.commerces as any)?.count),
        sante_count:        n((bpeObj.sante     as any)?.count),
        education_count:    n((bpeObj.education as any)?.count),
        loisirs_count:      n((bpeObj.loisirs   as any)?.count),
      } : null,

      // transport legacy (OSM/IDFM) — maintenu pour rétro-compat
      transport: transportObj ? {
        score:           n(transportObj.score),
        has_metro_train: transportObj.has_metro_train === true,
        has_tram:        transportObj.has_tram === true,
        nearest_stop_m:  n(transportObj.nearest_stop_m),
        is_urban:        transportObj.is_urban === true,
      } : null,

      // v4.4 : transport GTFS PostGIS — plus précis, prioritaire pour le Copilot
      transport_gtfs: transportGtfs,

      georisques: georisquesRaw ? {
        nb_risques:         nbRisques,
        inondation: (() => {
          const v = georisquesRaw.inondation;
          if (!isObj(v)) return null;
          return (v as any).zone_inondable === true || (v as any).ppri === true ? true
               : (v as any).risk_level === 'nul' ? false : null;
        })(),
        sismique:           n((georisquesRaw.seisme as any)?.zone),
        retrait_gonflement: isObj(georisquesRaw.argiles) &&
          (georisquesRaw.argiles as any).risk_level !== 'nul' &&
          (georisquesRaw.argiles as any).risk_level != null ? true : null,
        radon:              n((georisquesRaw.radon as any)?.classe_potentiel),
        cavites:            isObj(georisquesRaw.cavites) &&
          n((georisquesRaw.cavites as any)?.count) != null &&
          n((georisquesRaw.cavites as any)?.count)! > 0 ? true : null,
      } : null,

      rentabilite: rentaComp ? {
        rendement_brut:     n(rentaComp.rendementBrut     ?? rentaComp.yieldBrut),
        rendement_net:      n(rentaComp.rendementNet      ?? rentaComp.yieldNet),
        cashflow_mensuel:   n(rentaComp.cashflowMensuel   ?? rentaComp.cashflow),
        marge_brute:        n(rentaComp.margeBrute),
        marge_brute_pct:    n(rentaComp.margeBrutePct),
        prix_revente_cible: n(rentaComp.prixReventeCible),
      } : null,

      dpe:               opts.dpe        ?? null,
      dpe_source:        opts.dpeSource  ?? null,
      plu_zone:          pluZone,
      sitadel_score:     opts.sitadelScore     ?? null,
      demographie_score: opts.demographieScore ?? null,
      loyer_median_zone: opts.loyerMedianZone  ?? null,
      travaux_budget:    travauxBudget         ?? null,
      fiscal_regime:     opts.fiscalRegime ??
                         s(rentaInputs?.regime ?? rentaInputs?.fiscalRegime) ??
                         null,
      bce_rate:           opts.bceRate           ?? null,
      bce_pressure_label: opts.bcePressureLabel  ?? null,
    };

    return snapshot;
  } catch (e) {
    console.error('[buildPredictiveSnapshotForCopilot] error:', e);
    return null;
  }
}