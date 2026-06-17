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
  AlertSeverity, BanqueCommittee, BanqueDocuments, BanqueDossier,
  BanqueDossierStatut, BanqueGuarantees, BanqueMarketData, BanqueModuleKey, BanqueMonitoring, BanqueRiskAnalysis, BanqueSmartScore, BanqueSnapshot, BanqueTag, CommitteeCondition, CommitteeDecision,
  CommitteeTone, DocumentItem, GuaranteeItem, MonitoringAlert,
  MonitoringRule, RiskItem, RiskLevel, RiskSubscore, ScorePenalty, SmartScoreSubscore
} from "./types/banque.types";

// Store — lecture
export {
  BANQUE_SNAPSHOT_EVENT, LS_BANQUE_SNAPSHOT_V1, readActiveDossier, readBanqueSnapshot, readModule
} from "./store/banqueSnapshot.store";

// Store — écriture
export {
  acknowledgeAlert, clearBanqueSnapshot,
  clearModule,
  onBanqueSnapshotChange, patchBanqueSnapshot, patchCommittee, patchDocuments,
  patchGuarantees, patchMarket, patchModule, patchMonitoringConfig, patchRiskAnalysis, patchSmartScore, removeAlert, updateDossierStatut, upsertAlert, upsertDossier
} from "./store/banqueSnapshot.store";

// Selectors
export {
  buildCommitteePayload, buildDashboardOneLiner, buildGuaranteesSummary, buildMarketSummary, buildRiskSummary, computeCompleteness, computeSmartScore,
  getDossierHealth
} from "./selectors/banqueSelectors";
export type {
  CommitteePayload, CompletenessResult, DossierHealth, GuaranteesSummary, MarketSummary, RiskSummary
} from "./selectors/banqueSelectors";

// Hook
export { useBanqueSnapshot } from "./hooks/useBanqueSnapshot";
