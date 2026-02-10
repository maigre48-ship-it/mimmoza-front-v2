/**
 * useBanqueSnapshot.ts
 * ────────────────────────────────────────────────────────────────────
 * Hook React qui fournit une lecture réactive du BanqueSnapshot.
 * Se re-render automatiquement quand le snapshot change (même tab ou cross-tab).
 *
 * Usage :
 *   const { snap, dossier, riskSummary, completeness } = useBanqueSnapshot();
 * ────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BanqueSnapshot } from "../types/banque.types";
import { onBanqueSnapshotChange, readBanqueSnapshot } from "../store/banqueSnapshot.store";
import {
  buildDashboardOneLiner,
  buildGuaranteesSummary,
  buildMarketSummary,
  buildRiskSummary,
  computeCompleteness,
  computeSmartScore,
  getDossierHealth,
} from "../shared/selectors/banqueSelectors";

export function useBanqueSnapshot() {
  const [snap, setSnap] = useState<BanqueSnapshot>(() => readBanqueSnapshot());

  useEffect(() => {
    const cleanup = onBanqueSnapshotChange((newSnap) => setSnap(newSnap));
    return cleanup;
  }, []);

  const refresh = useCallback(() => setSnap(readBanqueSnapshot()), []);

  const dossier = snap.dossier ?? null;
  const dossierId = dossier?.id ?? null;

  const completeness = useMemo(() => computeCompleteness(snap), [snap]);
  const riskSummary = useMemo(() => buildRiskSummary(snap), [snap]);
  const marketSummary = useMemo(() => buildMarketSummary(snap), [snap]);
  const guaranteesSummary = useMemo(() => buildGuaranteesSummary(snap), [snap]);
  const smartScoreComputed = useMemo(() => computeSmartScore(snap), [snap]);
  const health = useMemo(() => getDossierHealth(snap), [snap]);
  const oneLiner = useMemo(() => buildDashboardOneLiner(snap), [snap]);

  const activeAlerts = useMemo(
    () => snap.monitoring?.alerts?.filter((a) => !a.acknowledgedAt) ?? [],
    [snap]
  );

  return {
    // Raw
    snap,
    refresh,

    // Dossier
    dossier,
    dossierId,

    // Modules bruts
    riskAnalysis: snap.riskAnalysis ?? null,
    guarantees: snap.guarantees ?? null,
    documents: snap.documents ?? null,
    committee: snap.committee ?? null,
    monitoring: snap.monitoring ?? null,
    smartScore: snap.smartScore ?? null,
    market: snap.market ?? null,

    // Selectors dérivés
    completeness,
    riskSummary,
    marketSummary,
    guaranteesSummary,
    smartScoreComputed,
    health,
    oneLiner,
    activeAlerts,
  } as const;
}

export default useBanqueSnapshot;
