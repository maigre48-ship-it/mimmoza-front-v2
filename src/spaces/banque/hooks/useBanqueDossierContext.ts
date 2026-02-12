// FILE: src/spaces/banque/hooks/useBanqueDossierContext.ts
//
// ✅ FIX: L'alignement URL→store préserve toutes les données existantes
//    du dossier (documents, analyse, garanties, etc.) au lieu d'écraser
//    avec un objet minimal {id, nom, sponsor, statut}.

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useBanqueSnapshotTick } from "./useBanqueSnapshotTick";
import {
  readBanqueSnapshot,
  selectDossier,
  selectActiveDossierId,
  upsertDossier,
  removeDossier,
} from "../store/banqueSnapshot.store";

/**
 * Contexte dossier Banque (hook)
 * - Source de vérité: l'URL /:id si présent, sinon le dossier actif dans le snapshot
 * - Si :id est présent, on force le store à activer ce dossier (et on le crée si besoin)
 * - Expose un refresh() compat (no-op) pour éviter les crashes côté pages
 */
export function useBanqueDossierContext() {
  // 🔁 force re-render à chaque changement snapshot
  useBanqueSnapshotTick();

  // ✅ ID dossier depuis l'URL (routes: /banque/documents/:id etc.)
  const params = useParams();
  const dossierIdFromUrl = (params as { id?: string }).id ?? null;

  // Snapshot courant (relit à chaque render)
  const current = readBanqueSnapshot();

  // Dossier actif selon store
  const selectedDossierId = selectActiveDossierId(current) ?? null;

  // ✅ ID final utilisé par les pages
  const dossierId = dossierIdFromUrl ?? selectedDossierId;

  // Dossier actif (dans ton store : snap.dossier)
  const dossier = selectDossier(current);

  const hasDossier = !!dossierId;

  /**
   * Assure que le store est aligné avec l'URL.
   * Si on est sur /banque/.../:id et que le store est sur un autre dossier,
   * on upsert le dossier minimal + activeDossierId.
   *
   * ✅ FIX: On préserve TOUTES les données existantes du dossier
   *    pour ne pas perdre documents, analyse, garanties, etc.
   */
  useEffect(() => {
    if (!dossierIdFromUrl) return;

    const snap = readBanqueSnapshot();
    const active = selectActiveDossierId(snap) ?? null;

    // Si déjà aligné, rien à faire
    if (active === dossierIdFromUrl && snap.dossier?.id === dossierIdFromUrl) return;

    // ✅ FIX: Préserver toutes les données existantes du dossier
    // Si le dossier dans le store est celui qu'on veut activer, on le garde tel quel
    // Sinon on crée un dossier minimal
    const existing =
      snap.dossier?.id === dossierIdFromUrl ? snap.dossier : {};

    upsertDossier({
      ...existing,
      id: dossierIdFromUrl,
      nom: (existing as any).nom ?? "Dossier",
      sponsor: (existing as any).sponsor ?? "",
      statut: (existing as any).statut ?? "BROUILLON",
    } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierIdFromUrl]);

  function ensureDossier(): string | null {
    const s = readBanqueSnapshot();
    const active = selectActiveDossierId(s) ?? null;
    return dossierIdFromUrl ?? active;
  }

  function selectOrUpsert(d: any) {
    upsertDossier(d);
  }

  function removeSelected() {
    const id = ensureDossier();
    if (!id) return;
    removeDossier(id);
  }

  /**
   * ✅ Compat: certaines pages appellent refresh() après une mutation.
   * Ici no-op car useBanqueSnapshotTick() + events store suffisent à rafraîchir l'UI.
   */
  function refresh() {
    // no-op
  }

  return {
    snap: current,
    dossierId,
    dossier,
    selectedDossierId,
    hasDossier,

    // helpers
    ensureDossier,
    selectOrUpsert,
    removeSelected,

    // compat
    refresh,
  } as const;
}

export default useBanqueDossierContext;