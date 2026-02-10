/**
 * src/spaces/banque/shared/index.ts
 * ────────────────────────────────────────────────────────────────────
 * Barrel export — une seule ligne d'import dans les pages :
 *
 *   import {
 *     useBanqueSnapshot,
 *     patchRiskAnalysis,
 *     buildRiskSummary,
 *     type BanqueDossier,
 *   } from "../shared";
 * ────────────────────────────────────────────────────────────────────
 */

// Types
export type {
  BanqueDossier,
  BanqueDossierStatut,
  BanqueTag,
  RiskLevel,
  BanqueRiskAnalysis,
  RiskSubscore,
  RiskItem,
  BanqueGuarantees,
  GuaranteeItem,
  BanqueDocuments,
  DocumentItem,
  BanqueCommittee,
  CommitteeDecision,
  CommitteeTone,
  CommitteeCondition,
  BanqueMonitoring,
  MonitoringAlert,
  MonitoringRule,
  AlertSeverity,
  BanqueSmartScore,
  SmartScoreSubscore,
  ScorePenalty,
  BanqueMarketData,
  BanqueSnapshot,
  BanqueModuleKey,
} from "./types/banque.types";

// Store — lecture
export {
  LS_BANQUE_SNAPSHOT_V1,
  BANQUE_SNAPSHOT_EVENT,
  readBanqueSnapshot,
  readActiveDossier,
  readModule,
} from "./store/banqueSnapshot.store";

// Store — écriture
export {
  patchBanqueSnapshot,
  patchModule,
  upsertDossier,
  updateDossierStatut,
  patchRiskAnalysis,
  patchDocuments,
  patchGuarantees,
  patchCommittee,
  patchSmartScore,
  patchMarket,
  upsertAlert,
  acknowledgeAlert,
  removeAlert,
  patchMonitoringConfig,
  clearBanqueSnapshot,
  clearModule,
  onBanqueSnapshotChange,
} from "./store/banqueSnapshot.store";

// Selectors
export {
  computeCompleteness,
  buildRiskSummary,
  buildMarketSummary,
  buildGuaranteesSummary,
  buildCommitteePayload,
  computeSmartScore,
  getDossierHealth,
  buildDashboardOneLiner,
} from "./selectors/banqueSelectors";
export type {
  CompletenessResult,
  RiskSummary,
  MarketSummary,
  GuaranteesSummary,
  CommitteePayload,
  DossierHealth,
} from "./selectors/banqueSelectors";

// Hook
export { useBanqueSnapshot } from "./hooks/useBanqueSnapshot";