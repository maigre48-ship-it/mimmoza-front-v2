// ============================================================================
// investisseurSnapshot.store.ts (PROXY + compat)
// src/spaces/marchand/store/investisseurSnapshot.store.ts
//
// ⚠️ DEPRECATED: le store Investisseur canonique vit désormais dans :
//   src/spaces/investisseur/shared/investisseurSnapshot.store.ts
//
// Ce fichier reste pour compatibilité des imports existants côté Marchand
// ("Espace Investisseur").
//
// Exports legacy attendus (AnalyseBien.tsx):
// - loadSnapshot, saveSnapshot, resetSnapshot, updateEnriched, isMinimumViable
// - type InvestisseurSnapshot
// ============================================================================

import {
  getInvestisseurSnapshot,
  saveInvestisseurSnapshot,
  upsertInvestisseurProject,
  setActiveInvestisseurProjectId,
  addInvestisseurEvent,
  INVESTISSEUR_SNAPSHOT_KEY,
} from "@/spaces/investisseur/shared/investisseurSnapshot.store";

// Réexporte tout (dont les types) depuis le store canonique
export * from "@/spaces/investisseur/shared/investisseurSnapshot.store";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function notifySnapshotUpdated() {
  try {
    window.dispatchEvent(new Event("mimmoza:investisseur-snapshot-updated"));
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compat exports (aliases)
// ─────────────────────────────────────────────────────────────────────────────

/** Alias attendu: loadSnapshot() */
export function loadSnapshot() {
  return getInvestisseurSnapshot();
}

/** Alias attendu: saveSnapshot(snapshot) */
export function saveSnapshot(next: any) {
  saveInvestisseurSnapshot(next);
  notifySnapshotUpdated();
}

/** Alias attendu: resetSnapshot() */
export function resetSnapshot(): void {
  try {
    localStorage.removeItem(INVESTISSEUR_SNAPSHOT_KEY);
  } catch {
    // ignore
  }
  notifySnapshotUpdated();
}

/** Alias attendu: setActiveDealId(id) (utile si d'autres pages l'utilisent) */
export function setActiveDealId(id: string | null) {
  setActiveInvestisseurProjectId(id);
  notifySnapshotUpdated();
}

/** Alias attendu: upsertDeal(id, patch) (utile si d'autres pages l'utilisent) */
export function upsertDeal(id: string, patch: any) {
  const p = upsertInvestisseurProject(id, patch);
  notifySnapshotUpdated();
  return p;
}

/** Alias attendu: addEvent({type, dealId, message}) (utile si d'autres pages l'utilisent) */
export function addEvent(e: { type: string; dealId?: string; message?: string }) {
  addInvestisseurEvent({
    type: e.type,
    projectId: e.dealId,
    message: e.message,
  });
  notifySnapshotUpdated();
}

/**
 * ✅ Alias attendu: updateEnriched(dealId, enriched)
 * "Enriched" = données enrichies (marché/risques/geo/etc.)
 * On mappe vers le project canonique via upsertInvestisseurProject().
 */
export function updateEnriched(dealId: string, enriched: any) {
  const patch: any = {};

  if (enriched && typeof enriched === "object") {
    // Canonique
    if ("market" in enriched) patch.market = (enriched as any).market;
    if ("risks" in enriched) patch.risks = (enriched as any).risks;
    if ("asset" in enriched) patch.asset = (enriched as any).asset;
    if ("acquisition" in enriched) patch.acquisition = (enriched as any).acquisition;
    if ("financing" in enriched) patch.financing = (enriched as any).financing;
    if ("operation" in enriched) patch.operation = (enriched as any).operation;
    if ("kpis" in enriched) patch.kpis = (enriched as any).kpis;

    // Fallbacks legacy fréquents
    if (!patch.market && ((enriched as any).marketContext || (enriched as any).marketStudy || (enriched as any).study)) {
      patch.market = (enriched as any).marketContext ?? (enriched as any).marketStudy ?? (enriched as any).study;
    }
    if (!patch.risks && ((enriched as any).geoRisques || (enriched as any).georisques || (enriched as any).riskStudy || (enriched as any).risque)) {
      patch.risks =
        (enriched as any).geoRisques ??
        (enriched as any).georisques ??
        (enriched as any).riskStudy ??
        (enriched as any).risque;
    }

    // Si l'enrich retourne un snapshot entier par erreur, on essaye d'en extraire une partie
    if (!patch.market && (enriched as any).projects && (enriched as any).activeProjectId) {
      const pid = (enriched as any).activeProjectId;
      const proj = (enriched as any).projects?.[pid];
      if (proj?.market) patch.market = proj.market;
      if (proj?.risks) patch.risks = proj.risks;
    }
  }

  const p = upsertInvestisseurProject(dealId, patch);
  notifySnapshotUpdated();
  return p;
}

/** Compat: certaines pages attendent `isMinimumViable` */
export function isMinimumViable(input: any): boolean {
  try {
    const obj = input ?? {};

    // Si snapshot canonique : { activeProjectId, projects: {...} }
    const maybeSnap =
      obj && typeof obj === "object" && (obj as any).projects && "activeProjectId" in (obj as any);

    const project = maybeSnap
      ? ((obj as any).projects?.[(obj as any).activeProjectId] ??
        (obj as any).projects?.[Object.keys((obj as any).projects ?? {})[0]])
      : obj;

    if (!project || typeof project !== "object") return false;

    const acquisition = (project as any).acquisition ?? {};
    const operation = (project as any).operation ?? {};
    const financing = (project as any).financing ?? {};
    const asset = (project as any).asset ?? {};

    const hasPrice =
      typeof acquisition.price === "number" ||
      typeof acquisition.purchasePrice === "number" ||
      typeof financing.loanAmount === "number";

    const hasRent =
      typeof operation.rentMonthly === "number" ||
      typeof operation.rentAnnual === "number";

    const hasAsset =
      typeof asset.surfaceM2 === "number" ||
      (typeof asset.address === "string" && asset.address.trim().length > 3);

    return (hasPrice && hasRent) || (hasPrice && hasAsset) || (hasRent && hasAsset);
  } catch {
    return false;
  }
}
