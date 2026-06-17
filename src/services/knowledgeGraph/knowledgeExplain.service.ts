// ============================================================================
// Knowledge Graph — Explainability Engine (déterministe, aucune IA)
// Génère raisons + signaux positifs + score traçable à partir d'un snapshot.
// ============================================================================

import { buildOpportunityGraph } from './builders/opportunityGraph.builder';
import { buildParcelGraph } from './builders/parcelGraph.builder';
import { buildValuationGraph } from './builders/valuationGraph.builder';
import {
  type Explanation,
  type ExplanationReason,
  type GeoConfidence,
  type GeoProvenance,
  type GeoSource,
  type JsonObject,
  type KnowledgeGraphContext,
  type KnowledgeNode,
  type KnowledgeNodeType,
  type KnowledgeSnapshotPayload,
  type PositiveSignal,
  type ScoreContribution,
} from './knowledgeGraph.types';

// --- Lecture sûre des métadonnées -------------------------------------------
function readNumber(meta: JsonObject, key: string): number | undefined {
  const v = meta[key];
  return typeof v === 'number' ? v : undefined;
}
function readString(meta: JsonObject, key: string): string | undefined {
  const v = meta[key];
  return typeof v === 'string' ? v : undefined;
}
function readBool(meta: JsonObject, key: string): boolean | undefined {
  const v = meta[key];
  return typeof v === 'boolean' ? v : undefined;
}

function byType(payload: KnowledgeSnapshotPayload, type: KnowledgeNodeType): KnowledgeNode[] {
  return payload.nodes.filter((n) => n.node_type === type);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// --- Barème de score (déterministe, traçable) -------------------------------
const SCORE_BASELINE = 50;
const PROXIMITY_THRESHOLD_M = 800;
const TX_DENSITY_THRESHOLD = 30;

const IMPACT = {
  pluFavorable: 15,
  pluConstrained: -15,
  riskFort: -15,
  riskMoyen: -10,
  mobilityClose: 10,
  marketUp: 10,
  marketStable: 5,
  marketDown: -10,
  highTxDensity: 5,
} as const;

// --- Raisons qualitatives (inchangé) ----------------------------------------
function pluReasons(payload: KnowledgeSnapshotPayload): ExplanationReason[] {
  return byType(payload, 'plu_zone').map((node) => {
    const label = readString(node.metadata, 'label') ?? node.display_name ?? 'Zone PLU';
    const buildable = readBool(node.metadata, 'buildable');
    if (buildable === true) {
      return { type: 'positive', label: `Zone PLU favorable : ${label}`, source: 'plu_zone' };
    }
    if (buildable === false) {
      return { type: 'negative', label: `Zone PLU contraignante : ${label}`, source: 'plu_zone' };
    }
    return { type: 'neutral', label: `Zone PLU : ${label}`, source: 'plu_zone' };
  });
}

function oapReasons(payload: KnowledgeSnapshotPayload): ExplanationReason[] {
  return byType(payload, 'oap').map((node) => {
    const label = readString(node.metadata, 'label') ?? node.display_name ?? 'OAP';
    return { type: 'neutral', label: `OAP applicable : ${label}`, source: 'oap' };
  });
}

function riskReasons(payload: KnowledgeSnapshotPayload): ExplanationReason[] {
  return byType(payload, 'risk_zone').map((node) => {
    const riskType = readString(node.metadata, 'riskType') ?? node.display_name ?? 'Risque';
    const severity = readString(node.metadata, 'severity');
    if (severity === 'fort' || severity === 'moyen') {
      return {
        type: 'negative',
        label: `Risque ${riskType}`,
        source: 'risk_zone',
        weight: severity === 'fort' ? 3 : 2,
        detail: readString(node.metadata, 'detail') ?? `Sévérité ${severity}`,
      };
    }
    return { type: 'neutral', label: `Risque ${riskType} (faible)`, source: 'risk_zone' };
  });
}

function mobilityReasons(payload: KnowledgeSnapshotPayload): ExplanationReason[] {
  const reasons: ExplanationReason[] = [];
  for (const node of byType(payload, 'mobility_zone')) {
    const label = readString(node.metadata, 'label') ?? node.display_name ?? 'Transport';
    const distance = readNumber(node.metadata, 'distanceM');
    const score = readNumber(node.metadata, 'score');
    if (
      (distance !== undefined && distance <= PROXIMITY_THRESHOLD_M) ||
      (score !== undefined && score >= 0.6)
    ) {
      reasons.push({
        type: 'positive',
        label: `Proximité ${label}`,
        source: 'mobility_zone',
        detail: distance !== undefined ? `${Math.round(distance)} m` : undefined,
      });
    } else {
      reasons.push({ type: 'neutral', label: `Desserte ${label}`, source: 'mobility_zone' });
    }
  }
  return reasons;
}

function marketReasons(payload: KnowledgeSnapshotPayload): ExplanationReason[] {
  return byType(payload, 'dvf_cluster').map((node) => {
    const trend = readString(node.metadata, 'trend');
    const median = readNumber(node.metadata, 'medianPricePerM2');
    const detail = median !== undefined ? `${Math.round(median)} €/m²` : undefined;
    if (trend === 'up') {
      return { type: 'positive', label: 'Marché DVF en hausse', source: 'dvf_cluster', detail };
    }
    if (trend === 'down') {
      return { type: 'negative', label: 'Marché DVF en baisse', source: 'dvf_cluster', detail };
    }
    if (trend === 'stable') {
      return { type: 'neutral', label: 'Marché DVF stable', source: 'dvf_cluster', detail };
    }
    return { type: 'neutral', label: 'Marché DVF — tendance indisponible', source: 'dvf_cluster', detail };
  });
}

function comparableReasons(payload: KnowledgeSnapshotPayload): ExplanationReason[] {
  const comparables = byType(payload, 'transaction').filter(
    (n) => readBool(n.metadata, 'comparable') === true,
  );
  if (comparables.length === 0) return [];
  const prices = comparables
    .map((n) => readNumber(n.metadata, 'pricePerM2'))
    .filter((p): p is number => typeof p === 'number');
  const detail =
    prices.length > 0
      ? `${comparables.length} comparables, médiane ${Math.round(median(prices))} €/m²`
      : `${comparables.length} comparables`;
  return [{ type: 'neutral', label: 'Comparables DVF retenus', source: 'transaction', detail }];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Tri raisons : positifs, négatifs, neutres ; par poids décroissant.
function order(reasons: ExplanationReason[]): ExplanationReason[] {
  const rank: Record<string, number> = { positive: 0, negative: 1, neutral: 2 };
  return [...reasons].sort((a, b) => {
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
    return (b.weight ?? 1) - (a.weight ?? 1);
  });
}

function rootScore(payload: KnowledgeSnapshotPayload, key: string): number | null {
  const v = payload.root.metadata[key];
  return typeof v === 'number' ? v : null;
}

// ============================================================================
// ÉTAPE 4 + 5 — contributions chiffrées (positifs/négatifs), 100% données réelles.
// ============================================================================
function buildContributions(payload: KnowledgeSnapshotPayload): ScoreContribution[] {
  const out: ScoreContribution[] = [];

  // PLU
  for (const n of byType(payload, 'plu_zone')) {
    const label = readString(n.metadata, 'label') ?? n.display_name ?? 'Zone PLU';
    const buildable = readBool(n.metadata, 'buildable');
    if (buildable === true) {
      out.push({ type: 'positive', label: `Zone PLU favorable : ${label}`, impact: IMPACT.pluFavorable, source: 'plu_zone' });
    } else if (buildable === false) {
      out.push({ type: 'negative', label: `Zone PLU contraignante : ${label}`, impact: IMPACT.pluConstrained, source: 'plu_zone' });
    }
  }

  // Mobilité
  for (const n of byType(payload, 'mobility_zone')) {
    const label = readString(n.metadata, 'label') ?? n.display_name ?? 'Transport';
    const distance = readNumber(n.metadata, 'distanceM');
    const score = readNumber(n.metadata, 'score');
    const close =
      (distance !== undefined && distance <= PROXIMITY_THRESHOLD_M) ||
      (score !== undefined && score >= 0.6);
    if (close) {
      out.push({
        type: 'positive',
        label: `Proximité ${label}`,
        impact: IMPACT.mobilityClose,
        source: 'mobility_zone',
        detail: distance !== undefined ? `${Math.round(distance)} m` : undefined,
      });
    }
  }

  // Marché DVF
  for (const n of byType(payload, 'dvf_cluster')) {
    const trend = readString(n.metadata, 'trend');
    const median_ = readNumber(n.metadata, 'medianPricePerM2');
    const sample = readNumber(n.metadata, 'sampleSize');
    const detail = median_ !== undefined ? `${Math.round(median_)} €/m²` : undefined;
    if (trend === 'up') {
      out.push({ type: 'positive', label: 'Marché actif (hausse)', impact: IMPACT.marketUp, source: 'dvf_cluster', detail });
    } else if (trend === 'down') {
      out.push({ type: 'negative', label: 'Marché en baisse', impact: IMPACT.marketDown, source: 'dvf_cluster', detail });
    } else if (trend === 'stable') {
      out.push({ type: 'positive', label: 'Marché stable', impact: IMPACT.marketStable, source: 'dvf_cluster', detail });
    }
    if (sample !== undefined && sample >= TX_DENSITY_THRESHOLD) {
      out.push({ type: 'positive', label: 'Forte densité de transactions', impact: IMPACT.highTxDensity, source: 'dvf_cluster', detail: `${sample} ventes` });
    }
  }

  // Risques
  for (const n of byType(payload, 'risk_zone')) {
    const riskType = readString(n.metadata, 'riskType') ?? n.display_name ?? 'Risque';
    const severity = readString(n.metadata, 'severity');
    const detail = readString(n.metadata, 'detail');
    if (severity === 'fort') {
      out.push({ type: 'negative', label: `Risque ${riskType} (fort)`, impact: IMPACT.riskFort, source: 'risk_zone', detail });
    } else if (severity === 'moyen') {
      out.push({ type: 'negative', label: `Risque ${riskType} (moyen)`, impact: IMPACT.riskMoyen, source: 'risk_zone', detail });
    }
  }

  return out;
}

function orderContributions(list: ScoreContribution[]): ScoreContribution[] {
  const rank: Record<string, number> = { positive: 0, negative: 1, neutral: 2 };
  return [...list].sort((a, b) => {
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
    return Math.abs(b.impact) - Math.abs(a.impact);
  });
}

/** ÉTAPE 5 — décomposition chiffrée du score [{type,label,impact}]. */
export function buildScoreExplanation(payload: KnowledgeSnapshotPayload): ScoreContribution[] {
  return orderContributions(buildContributions(payload));
}

/** ÉTAPE 4 — signaux positifs (DVF / PLU / mobilité), dérivés des données réelles. */
export function buildPositiveSignals(payload: KnowledgeSnapshotPayload): PositiveSignal[] {
  return buildContributions(payload)
    .filter((c) => c.type === 'positive')
    .map((c) => ({ label: c.label, source: c.source, detail: c.detail }));
}

/** Score parcelle = base 50 ± impacts, borné [0,100] (traçable via scoreBreakdown). */
function computeParcelScore(breakdown: ScoreContribution[]): number {
  const total = breakdown.reduce((s, c) => s + c.impact, SCORE_BASELINE);
  return clamp(Math.round(total), 0, 100);
}

/** Provenance géo lue sur le nœud racine (injectée par le provider getParcel). */
function readGeo(root: KnowledgeNode): GeoProvenance | undefined {
  const source = readString(root.metadata, 'geo_source');
  if (source !== 'parcel' && source !== 'commune_centroid') return undefined;
  const conf = readString(root.metadata, 'geo_confidence');
  const confidence: GeoConfidence =
    conf === 'high' || conf === 'medium' || conf === 'low' ? conf : 'low';
  return {
    source: source as GeoSource,
    confidence,
    latitude: readNumber(root.metadata, 'lat'),
    longitude: readNumber(root.metadata, 'lon'),
  };
}

// --- API publique ------------------------------------------------------------
export async function explainParcel(
  parcelKey: string,
  ctx: KnowledgeGraphContext,
): Promise<Explanation> {
  const snapshot = await buildParcelGraph(parcelKey, ctx);
  const payload = snapshot.payload;

  const reasons = order([
    ...pluReasons(payload),
    ...oapReasons(payload),
    ...mobilityReasons(payload),
    ...marketReasons(payload),
    ...riskReasons(payload),
  ]);

  const scoreBreakdown = buildScoreExplanation(payload);
  const positiveSignals = buildPositiveSignals(payload);

  return {
    root_node_id: snapshot.root_node_id,
    subject: 'parcel',
    score: computeParcelScore(scoreBreakdown),
    scoreBaseline: SCORE_BASELINE,
    scoreBreakdown,
    positiveSignals,
    geo: readGeo(payload.root),
    reasons,
    generated_at: new Date().toISOString(),
  };
}

export async function explainOpportunity(
  opportunityKey: string,
  ctx: KnowledgeGraphContext,
): Promise<Explanation> {
  const snapshot = await buildOpportunityGraph(opportunityKey, ctx);
  const payload = snapshot.payload;
  const reasons = order([
    ...pluReasons(payload),
    ...oapReasons(payload),
    ...mobilityReasons(payload),
    ...marketReasons(payload),
    ...riskReasons(payload),
  ]);
  return {
    root_node_id: snapshot.root_node_id,
    subject: 'opportunity',
    score: rootScore(payload, 'score'),
    reasons,
    generated_at: new Date().toISOString(),
  };
}

export async function explainValuation(
  valuationKey: string,
  ctx: KnowledgeGraphContext,
): Promise<Explanation> {
  const snapshot = await buildValuationGraph(valuationKey, ctx);
  const payload = snapshot.payload;
  const reasons = order([
    ...comparableReasons(payload),
    ...marketReasons(payload),
    ...mobilityReasons(payload),
    ...pluReasons(payload),
    ...riskReasons(payload),
  ]);
  return {
    root_node_id: snapshot.root_node_id,
    subject: 'valuation',
    score: rootScore(payload, 'value'),
    reasons,
    generated_at: new Date().toISOString(),
  };
}