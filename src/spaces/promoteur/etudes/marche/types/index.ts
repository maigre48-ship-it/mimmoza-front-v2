// FILE: src/spaces/promoteur/etudes/marche/types/index.ts
//
// Barrel des types etudes/marche.
// Règle anti-TS2308 : pour chaque type partagé par plusieurs fichiers,
// une seule source canonique est ré-exportée. Les fichiers à conflit sont
// importés de façon explicite (pas de `export *`) pour exclure les doublons.

// ── Source canonique : market.types ──────────────────────────────────────
// Détient ProjectType, DataSourceType, MarketStudyResult et tous les types
// de données marché.
export * from "./market.types";

// ── POI / KPI : pas de conflit connu ─────────────────────────────────────
export * from "./poi.types";
export * from "./kpi.types";

// ── competition.ts : types de concurrence/démographie ────────────────────
// On EXCLUT MarketStudyResult (déjà dans market.types) et DataSourceStatus
// (forme divergente). ProjectType est déjà ré-exporté par competition depuis
// market.types, donc on ne le reprend pas ici.
export type {
  Competitor,
  CompetitionData,
  DemographicsData,
  RealEstateData,
  DataSourceResult,
} from "./competition";

// ── project.types : config projet ────────────────────────────────────────
// On EXCLUT ProjectType / DataSourceType / DataSourceStatus (doublons de
// market.types). On ne prend que les types propres à la config projet.
export type {
  DemographicSegment,
  RadiusConfig,
  ScoreWeights,
  ProjectTypeConfig,
} from "./project.types";