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

import { useEffect, useState } from "react";
import { read2D, write2D } from "../../plan2d/editor2dStorage";
import {
  defaultAnchor,
  keyBuilding,
  orphanImportsFromBuildings,
  specsFromMix,
  syncProgramToBuildings,
} from "../../plan2d/programSync";
import { PROGRAMME_EVENT, usePromoteurProgrammeStore } from "../../store/promoteurProgramme.store";

// Études déjà migrées cette session (la migration est aussi naturellement
// idempotente : elle ne cible que les bâtiments sans clé).
const migratedStudies = new Set<string>();

/**
 * @returns true quand la synchro a tourné pour ce studyId (ou qu'il n'y en a pas).
 *
 * ⚠️ DEEP-LINK — pourquoi ce retour existe : les effets ENFANTS s'exécutent
 * AVANT les effets parents. Sur un accès direct à /implantation-2d?study=X
 * (bookmark, lien de l'Analyste), l'hydratation d'Impl2D (useLayoutEffect
 * enfant) lisait `mimmoza.editor2d.raw.{studyId}` AVANT que ce hook (parent)
 * n'y écrive → plan masse non synchronisé au premier rendu. Le guard doit donc
 * retenir l'<Outlet/> tant que ce hook n'a pas fini.
 */
export function usePromoteurProgramSync(studyId: string | null): boolean {
  // Tagué par studyId : passer d'une étude à l'autre repasse par "pas prêt"
  // au lieu de laisser croire que la nouvelle est déjà synchronisée.
  const [syncedFor, setSyncedFor] = useState<string | null>(null);

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
    setSyncedFor(sid);   // → libère l'<Outlet/> du guard (cf. deep-link).

    const onProgramme = (e: Event) => {
      const detail = (e as CustomEvent).detail as { studyId?: string } | undefined;
      if (detail?.studyId && detail.studyId !== sid) return;
      runDiff();
    };
    window.addEventListener(PROGRAMME_EVENT, onProgramme);
    return () => window.removeEventListener(PROGRAMME_EVENT, onProgramme);
  }, [studyId]);

  return studyId == null || syncedFor === studyId;
}
