// src/spaces/promoteur/shared/hooks/usePromoteurProgramSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Synchro « Programmation → bâtiments 2D » (Modèle : Programmation = source de
// vérité). Monté dans PromoteurStudyRequired → vivant dès qu'on est dans une
// étude, quelle que soit la sous-page active.
//
// SÛRETÉ (pas de course) : Programmation et Implantation2DPage ne sont JAMAIS
// montées en même temps (Outlet unique). La synchro écrit donc directement la
// clé par-étude `mimmoza.editor2d.raw.{studyId}` (celle qu'Impl2D relit à son
// montage) SANS toucher au store live ni à l'hydratation V6.7 d'Impl2D.
//
// ANTI-BOUCLE : la migration écrit le programme (→ PROGRAMME_EVENT) ; l'écoute
// de cet event ne relance QUE le diff (pas la migration, gardée par étude). Le
// diff écrit la clé 2D (pas le programme) → aucun PROGRAMME_EVENT → pas de boucle.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { userStorage } from "@/lib/storage/userScopedStorage";
import type { Building2D, Parking2D } from "../../plan2d/editor2d.types";
import {
  defaultAnchor,
  keyBuilding,
  orphanImportsFromBuildings,
  specsFromMix,
  syncProgramToBuildings,
} from "../../plan2d/programSync";
import { PROGRAMME_EVENT, usePromoteurProgrammeStore } from "../../store/promoteurProgramme.store";

// ⚠ Réplique de Implantation2DPage.editorStorageKey — GARDER IDENTIQUE.
function editor2dKey(studyId: string): string {
  return `mimmoza.editor2d.raw.${studyId}`;
}

interface Editor2DPersist {
  buildings: Building2D[];
  parkings: Parking2D[];
}

function read2D(studyId: string): Editor2DPersist {
  try {
    const raw = userStorage.getItem(editor2dKey(studyId));
    if (!raw) return { buildings: [], parkings: [] };
    const p = JSON.parse(raw) as Editor2DPersist;
    return { buildings: p.buildings ?? [], parkings: p.parkings ?? [] };
  } catch {
    return { buildings: [], parkings: [] };
  }
}

function write2D(studyId: string, buildings: Building2D[], parkings: Parking2D[]): void {
  try {
    userStorage.setItem(editor2dKey(studyId), JSON.stringify({ buildings, parkings }));
  } catch {
    /* quota / SSR : silencieux */
  }
}

// Études déjà migrées cette session (la migration est aussi naturellement
// idempotente : elle ne cible que les bâtiments sans clé).
const migratedStudies = new Set<string>();

export function usePromoteurProgramSync(studyId: string | null): void {
  useEffect(() => {
    if (!studyId) return;
    const sid = studyId;

    usePromoteurProgrammeStore.getState().loadStudy(sid);

    // Diff programme → clé 2D (réutilisé par l'event PROGRAMME_EVENT).
    const runDiff = () => {
      const { buildings, parkings } = read2D(sid);
      const mix = usePromoteurProgrammeStore.getState().mix;
      const { anchor, fromExisting } = defaultAnchor(buildings);
      if (!fromExisting) {
        console.debug(
          "[programSync] placement par défaut (origine) — aucun bâtiment positionné / enveloppe non importée",
          { studyId: sid },
        );
      }
      const { next } = syncProgramToBuildings(specsFromMix(mix), buildings, anchor);
      write2D(sid, next, parkings);
    };

    // 1. Migration une fois par étude : bâtiments 2D keyless → programme.
    if (!migratedStudies.has(sid)) {
      const { buildings, parkings } = read2D(sid);
      const orphans = orphanImportsFromBuildings(buildings);
      if (orphans.length > 0) {
        const ids = usePromoteurProgrammeStore
          .getState()
          .importBatiments(orphans.map((o) => ({ nom: o.nom, niveaux: o.niveaux, empriseSolM2: o.empriseSolM2 })));
        const idByBuilding = new Map<string, string>();
        orphans.forEach((o, i) => {
          if (ids[i]) idByBuilding.set(o.buildingId, ids[i]);
        });
        const keyed = buildings.map((b) => {
          const key = idByBuilding.get(b.id);
          return key ? keyBuilding(b, key, Math.max(0, Math.round(b.rect.width * b.rect.depth))) : b;
        });
        write2D(sid, keyed, parkings);
      }
      migratedStudies.add(sid);
    }

    // 2. Diff initial + abonnement aux changements de programme.
    runDiff();

    const onProgramme = (e: Event) => {
      const detail = (e as CustomEvent).detail as { studyId?: string } | undefined;
      if (detail?.studyId && detail.studyId !== sid) return;
      runDiff();
    };
    window.addEventListener(PROGRAMME_EVENT, onProgramme);
    return () => window.removeEventListener(PROGRAMME_EVENT, onProgramme);
  }, [studyId]);
}
