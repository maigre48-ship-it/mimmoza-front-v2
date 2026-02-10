// FILE: src/spaces/banque/hooks/useCommitteeWorkflow.ts

import { useState, useCallback, useMemo, useEffect } from "react";

import type {
  BanqueDossier,
  BanqueSnapshot,
  Condition,
  DossierDocument,
  DossierGuarantee,
  Verdict,
} from "../types";

import { getRequiredDocuments } from "../config/required-documents";

import {
  computeCompleteness,
  computeLtvFromDossier,
  computeRiskLevel,
  suggestConditions,
  buildDecisionDraft,
  resetConditionIdCounter,
} from "../services/committee-engine";

import {
  loadSnapshot,
  saveSnapshot,
  getActiveDossier,
  patchAddOrUpdateDocument,
  patchRemoveDocument,
  patchAddOrUpdateGuarantee,
  patchRemoveGuarantee,
  patchSetConditions,
  patchSetDecision,
} from "../services/dossier-committee-service";

// ============================================================================
// HOOK
// ============================================================================

export interface CommitteeWorkflow {
  // State
  snapshot: BanqueSnapshot;
  dossier: BanqueDossier | null;

  // Computed (recalculés à chaque changement)
  requiredDocs: ReturnType<typeof getRequiredDocuments>;
  completeness: ReturnType<typeof computeCompleteness>;
  ltv: number | null;
  riskLevel: ReturnType<typeof computeRiskLevel>;
  suggestedConditions: Condition[];
  decisionDraft: ReturnType<typeof buildDecisionDraft>;

  // Actions
  addOrUpdateDocument: (doc: DossierDocument) => void;
  removeDocument: (id: string) => void;
  addOrUpdateGuarantee: (guarantee: DossierGuarantee) => void;
  removeGuarantee: (id: string) => void;
  applySuggestedConditions: () => void;
  setDecision: (verdict: Verdict, motivation: string) => void;

  // Utilities
  reload: () => void;
}

// Default completeness pour éviter les null checks
const EMPTY_COMPLETENESS = { total: 0, provided: 0, missing: [] as string[], percentage: 0 };

const EMPTY_DECISION_DRAFT = {
  verdict: "NO_GO" as const,
  motivation: "Aucun dossier sélectionné.",
  confidence: 0,
  suggestedConditions: [] as Condition[],
};

export function useCommitteeWorkflow(): CommitteeWorkflow {
  // ── State ─────────────────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<BanqueSnapshot>(() => loadSnapshot());

  // Reload depuis localStorage (ex: autre onglet)
  const reload = useCallback(() => {
    setSnapshot(loadSnapshot());
  }, []);

  // Écouter les changements cross-tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "mimmoza.banque.snapshot.v1") reload();
    };
    const onCustom = () => reload();

    window.addEventListener("storage", onStorage);
    window.addEventListener("mimmoza:banque-snapshot-updated", onCustom);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mimmoza:banque-snapshot-updated", onCustom);
    };
  }, [reload]);

  // ── Dossier actif ─────────────────────────────────────────────────────
  const dossier = useMemo(() => getActiveDossier(snapshot), [snapshot]);

  // ── Computed values ───────────────────────────────────────────────────
  const requiredDocs = useMemo(
    () => (dossier ? getRequiredDocuments(dossier.projectType) : []),
    [dossier],
  );

  const completeness = useMemo(
    () => (dossier ? computeCompleteness(dossier, requiredDocs) : EMPTY_COMPLETENESS),
    [dossier, requiredDocs],
  );

  const ltv = useMemo(
    () => (dossier ? computeLtvFromDossier(dossier) : null),
    [dossier],
  );

  const riskLevel = useMemo(
    () => (dossier ? computeRiskLevel(dossier, ltv) : "inconnu" as const),
    [dossier, ltv],
  );

  const computedSuggestedConditions = useMemo(() => {
    if (!dossier) return [] as Condition[];
    resetConditionIdCounter();
    return suggestConditions(dossier, requiredDocs, ltv, riskLevel);
  }, [dossier, requiredDocs, ltv, riskLevel]);

  const decisionDraft = useMemo(
    () =>
      dossier
        ? buildDecisionDraft(dossier, completeness, ltv, riskLevel, computedSuggestedConditions)
        : EMPTY_DECISION_DRAFT,
    [dossier, completeness, ltv, riskLevel, computedSuggestedConditions],
  );

  // ── Persist helper ────────────────────────────────────────────────────
  const persist = useCallback((next: BanqueSnapshot) => {
    saveSnapshot(next);
    setSnapshot(next);
  }, []);

  const dossierId = dossier?.id;

  // ── Actions ───────────────────────────────────────────────────────────

  const addOrUpdateDocument = useCallback(
    (doc: DossierDocument) => {
      if (!dossierId) return;
      persist(patchAddOrUpdateDocument(snapshot, dossierId, doc));
    },
    [snapshot, dossierId, persist],
  );

  const removeDocument = useCallback(
    (id: string) => {
      if (!dossierId) return;
      persist(patchRemoveDocument(snapshot, dossierId, id));
    },
    [snapshot, dossierId, persist],
  );

  const addOrUpdateGuarantee = useCallback(
    (guarantee: DossierGuarantee) => {
      if (!dossierId) return;
      persist(patchAddOrUpdateGuarantee(snapshot, dossierId, guarantee));
    },
    [snapshot, dossierId, persist],
  );

  const removeGuarantee = useCallback(
    (id: string) => {
      if (!dossierId) return;
      persist(patchRemoveGuarantee(snapshot, dossierId, id));
    },
    [snapshot, dossierId, persist],
  );

  const applySuggestedConditions = useCallback(() => {
    if (!dossierId) return;
    // Merge : on garde les conditions manuelles existantes, on remplace les auto
    const manualConditions = (dossier?.conditions ?? []).filter((c) => c.source === "manual");
    const merged = [...computedSuggestedConditions, ...manualConditions];
    persist(patchSetConditions(snapshot, dossierId, merged));
  }, [snapshot, dossierId, dossier, computedSuggestedConditions, persist]);

  const setDecision = useCallback(
    (verdict: Verdict, motivation: string) => {
      if (!dossierId) return;
      persist(
        patchSetDecision(snapshot, dossierId, {
          verdict,
          motivation,
          confidence: decisionDraft.confidence,
          date: new Date().toISOString(),
        }),
      );
    },
    [snapshot, dossierId, decisionDraft.confidence, persist],
  );

  // ── Return ────────────────────────────────────────────────────────────

  return {
    snapshot,
    dossier,
    requiredDocs,
    completeness,
    ltv,
    riskLevel,
    suggestedConditions: computedSuggestedConditions,
    decisionDraft,
    addOrUpdateDocument,
    removeDocument,
    addOrUpdateGuarantee,
    removeGuarantee,
    applySuggestedConditions,
    setDecision,
    reload,
  };
}