// src/spaces/promoteur/plan2d/editor2dStorage.ts
// ─────────────────────────────────────────────────────────────────────────────
// LA définition unique de la clé de stockage par-étude du plan masse 2D.
//
// Historique : trois consommateurs l'avaient DUPLIQUÉE — Implantation2DPage
// (`editorStorageKey`), usePromoteurProgramSync (`editor2dKey`), et
// MassingEditor3D (`PLAN2D_KEY = "mimmoza_plan2d_v1"`, valeur PÉRIMÉE depuis la
// V6.8 où le scoping par studyId a été introduit). Résultat : le Massing lisait
// une clé morte → plan masse invisible, sans que personne ne le voie. On
// centralise ici pour qu'il n'y ait plus qu'une vérité.
//
// Format : { buildings: Building2D[], parkings: Parking2D[] }.
// ─────────────────────────────────────────────────────────────────────────────

import { userStorage } from "@/lib/storage/userScopedStorage";
import type { Building2D, Parking2D } from "./editor2d.types";

/** Clé localStorage (user-scoped) du plan masse 2D d'une étude. */
export function editor2dStorageKey(studyId: string): string {
  return `mimmoza.editor2d.raw.${studyId}`;
}

export interface Editor2DPersist {
  buildings: Building2D[];
  parkings: Parking2D[];
}

/**
 * Émis APRÈS écriture de la clé 2D (write2D). Un consommateur qui l'écoute (ex.
 * Massing 3D) lit donc FORCÉMENT une clé déjà à jour : plus aucune dépendance à
 * l'ordre des listeners de PROGRAMME_EVENT.
 */
export const EDITOR2D_EVENT = "mimmoza:promoteur-editor2d-updated";

export function read2D(studyId: string): Editor2DPersist {
  try {
    const raw = userStorage.getItem(editor2dStorageKey(studyId));
    if (!raw) return { buildings: [], parkings: [] };
    const p = JSON.parse(raw) as Editor2DPersist;
    return { buildings: p.buildings ?? [], parkings: p.parkings ?? [] };
  } catch {
    return { buildings: [], parkings: [] };
  }
}

export function write2D(studyId: string, buildings: Building2D[], parkings: Parking2D[]): void {
  try {
    userStorage.setItem(editor2dStorageKey(studyId), JSON.stringify({ buildings, parkings }));
    window.dispatchEvent(new CustomEvent(EDITOR2D_EVENT, { detail: { studyId } }));
  } catch {
    /* quota / SSR : silencieux */
  }
}
