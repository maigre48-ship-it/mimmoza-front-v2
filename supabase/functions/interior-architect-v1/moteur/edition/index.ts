/**
 * LOT INT-09f — ÉDITION D'UNE IMPLANTATION : ajouter un meuble sans déplacer les autres, en retirer un.
 *
 * - `meublesInserables(analysis, roomId)` : specs du catalogue admises dans la pièce (`allowedRoles` contient son
 *   rôle ; arrivée d'eau présente si la spec en demande une), triées par catégorie puis libellé.
 * - `insererMeuble(...)` : `insererPlacement` du solveur (mode « insertion » : meilleure position faisable, mêmes
 *   contraintes dures et même score que `solveLayout`, AUCUN placement existant déplacé), puis le nouveau
 *   placement est habillé par `applyStyle` (même feuille de style, même graine) ; les finitions des meubles
 *   existants ne sont PAS modifiées (seule celle du nouveau est reprise). Refus : raison chiffrée en français.
 * - `retirerMeuble(layout, id)` : placement retiré ; rien d'autre ne bouge.
 *
 * Le critique n'est pas appelé ici : l'appelant revalide l'implantation obtenue (`critique`). Pur et déterministe.
 */
import type { FurnitureSpec, InteriorBrief, LayoutPlan, PlanAnalysis, PlanInput, Placement, RoomProgram } from '../types';
import type { StyleSheet } from '../style/types';
import { avecTailles, CATALOG, type TaillesSpecs } from '../data/catalog';
import { applyStyle } from '../style';
import { insererPlacement, type CodeRefusInsertion, type Rejet } from '../solver';

export function meublesInserables(analysis: PlanAnalysis, roomId: string): FurnitureSpec[] {
  const room = analysis.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  return CATALOG.filter((s) => s.allowedRoles.includes(room.role) && (!s.needsWater || room.hasWater))
    .slice()
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.label.localeCompare(b.label, 'fr') || (a.id < b.id ? -1 : 1)));
}

export interface InsertionMeuble {
  plan: PlanInput;
  analysis: PlanAnalysis;
  programs: RoomProgram[];
  layout: LayoutPlan;
  roomId: string;
  specId: string;
  id: string;
  brief?: InteriorBrief;
  /** Feuille de style du logement : le nouveau meuble est habillé comme les autres (absente : sans finition). */
  sheet?: StyleSheet;
  /** Graine de `applyStyle` (celle de l'aménagement). Défaut 1. */
  seed?: number;
  /** 0.5.0 — tailles réelles des modèles 3D (specId → {w, d, h}) : le meuble est inséré à la taille du modèle rendu. */
  tailles?: TaillesSpecs;
}

export type ResultatInsertionMeuble =
  | { ok: true; layout: LayoutPlan; placement: Placement; contraintesPieceDejaEnDefaut: boolean; candidats: number; faisables: number }
  | { ok: false; code: CodeRefusInsertion; raison: string; rejets: Partial<Record<Rejet, number>>; candidats: number };

export function insererMeuble(e: InsertionMeuble): ResultatInsertionMeuble {
  return avecTailles(e.tailles, () => insererMeubleBrut(e));
}

function insererMeubleBrut(e: InsertionMeuble): ResultatInsertionMeuble {
  const r = insererPlacement({ plan: e.plan, analysis: e.analysis, programs: e.programs, layout: e.layout, roomId: e.roomId, specId: e.specId, id: e.id, ...(e.brief ? { brief: e.brief } : {}) });
  if (!r.ok) return r;
  let placement = r.placement;
  if (e.sheet) {
    const habille = applyStyle({ ...e.layout, placements: [...e.layout.placements, placement] }, e.sheet, e.seed ?? 1);
    const fin = habille.placements.find((p) => p.id === placement.id)?.finish;
    if (fin) placement = { ...placement, finish: fin };
  }
  return {
    ok: true, placement, layout: { ...e.layout, placements: [...e.layout.placements, placement] },
    contraintesPieceDejaEnDefaut: r.contraintesPieceDejaEnDefaut, candidats: r.candidats, faisables: r.faisables,
  };
}

export function retirerMeuble(layout: LayoutPlan, id: string): LayoutPlan {
  if (!layout.placements.some((p) => p.id === id)) return layout;
  return { ...layout, placements: layout.placements.filter((p) => p.id !== id) };
}
