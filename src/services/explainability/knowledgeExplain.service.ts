// =============================================================================
// Mimmoza — Explainability Engine
// knowledgeExplain.service.ts  (PHASE 6)
//
// Le Knowledge Graph N'EST PLUS un produit. Il devient une SOURCE DE FACTEURS.
// Aucun calcul n'est dupliqué : on lit des signaux DÉJÀ produits par le KG
// et on les traduit en ExplanationFactor[]. Rien d'autre.
//
// Seul point à câbler sur ton code réel : mapKnowledgeGraphToSignals().
// =============================================================================

import type {
  ExplanationFactor,
  FactorCategory,
  FactorType,
} from "./explainability.types";

/**
 * Signal normalisé issu du Knowledge Graph.
 * weight = magnitude 0..1 (déjà calculée côté KG : pondération d'arête,
 * centralité, force de relation...). On NE recalcule pas, on traduit.
 */
export interface KnowledgeGraphSignal {
  id?: string;
  category: FactorCategory;
  polarity: FactorType;
  weight: number;
  label: string;
  description?: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Traduit des signaux KG en facteurs d'explication.
 * Pur, déterministe, sans I/O.
 */
export function knowledgeGraphFactors(
  signals: KnowledgeGraphSignal[] | undefined | null,
): ExplanationFactor[] {
  if (!signals?.length) return [];
  return signals
    .filter((s) => s && typeof s.weight === "number" && Number.isFinite(s.weight))
    .map((s, i) => ({
      id: s.id ?? `kg_${s.category}_${i}`,
      type: s.polarity ?? "neutral",
      category: s.category,
      label: s.label,
      description: s.description,
      impact: clamp01(s.weight),
    }));
}

// -----------------------------------------------------------------------------
// SEAM À CÂBLER — adapte ceci à la structure réelle de ton KG.
// Tu y branches l'accès aux données KG DÉJÀ disponibles (nodes/edges/scores
// utilisés aujourd'hui par KnowledgeGraphPage en debug). Aucune nouvelle table,
// aucune nouvelle Edge Function : tu réutilises la donnée existante.
// -----------------------------------------------------------------------------

/** Payload brut tel que ton KG le produit déjà (à typer selon ton existant). */
export type RawKnowledgeGraph = unknown;

export function mapKnowledgeGraphToSignals(
  raw: RawKnowledgeGraph,
): KnowledgeGraphSignal[] {
  // EXEMPLE d'implémentation à remplacer par ton mapping réel.
  // Hypothèse : le KG expose déjà des relations pondérées entre le bien
  // et des entités (commune, axe transport, aléa, segment de marché...).
  //
  // const kg = raw as { edges: Array<{ kind: string; weight: number; ... }> };
  // return kg.edges.map(e => ({
  //   category: mapKind(e.kind),       // "transport" -> "mobility", etc.
  //   polarity: e.weight >= 0 ? "positive" : "negative",
  //   weight: Math.abs(e.weight),
  //   label: e.label,
  //   description: e.detail,
  // }));
  if (!raw) return [];
  return [];
}

/** Helper de bout en bout : KG brut -> facteurs prêts à fusionner. */
export function explainFromKnowledgeGraph(
  raw: RawKnowledgeGraph,
): ExplanationFactor[] {
  return knowledgeGraphFactors(mapKnowledgeGraphToSignals(raw));
}