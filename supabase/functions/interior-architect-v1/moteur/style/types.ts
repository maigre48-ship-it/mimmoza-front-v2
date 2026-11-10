/**
 * LOT INT-07 — Direction artistique : types du module style.
 *
 * Tout identifiant `materialId` désigne un matériau de la bibliothèque PBR du Studio
 * (mimmozia-studio/src/core/materials/archvizLibrary.ts) : voir ./bibliotheque-studio.ts.
 * Un besoin sans matériau correspondant n'est JAMAIS inventé : on prend le plus proche existant
 * et le manque est consigné (`manque`), puis agrégé dans `StyleDefinition.manques`.
 */
import type { FurnitureCategory, Gamme, RoomRole, StyleId } from '../types';

/** Rang de couleur dans la règle 60 / 30 / 10. */
export type Tier = 'dominante' | 'secondaire' | 'accent';
export const TIERS: Tier[] = ['dominante', 'secondaire', 'accent'];

export interface CouleurNommee {
  nom: string;
  /** '#RRGGBB'. */
  hex: string;
  /** Part visée (0,6 / 0,3 / 0,1). */
  part: number;
}

/** Revêtement (sol, mur) : un matériau de la bibliothèque Studio. */
export interface Revetement {
  materialId: string;
  /** Libellé lisible (ex. « parquet contrecollé chêne clair »). */
  label: string;
  /** Essence si le revêtement est en bois (ex. 'chene'), sinon null. */
  woodSpecies: string | null;
  /** Besoin non couvert par la bibliothèque (le matériau retenu est le plus proche existant). */
  manque?: string;
}

/** Une finition possible d'une catégorie de meuble, rattachée à un rang de la palette. */
export interface OptionFinition {
  tier: Tier;
  /** Famille de matériau visible (valeur de PlacementFinish.material) : 'bois', 'laque', 'tissu', 'metal', 'ceramique'. */
  material: string;
  materialId: string;
  label: string;
  /**
   * Couleur propre (équipements techniques hors palette : céramique blanche, inox…).
   * Absente => couleur du rang (`palette[tier].hex`).
   */
  color?: string;
  manque?: string;
}

/** Variante d'un style pour une gamme. */
export interface VarianteGamme {
  sols: { sec: Revetement; humide: Revetement; exterieur: Revetement };
  /** Qualité des bois du mobilier (ex. « mélaminé décor chêne », « placage chêne », « chêne massif »). */
  qualiteBois: string;
  qualiteTextile: string;
  /** Rôles de pièce recevant un mur d'accent ([] = aucun). */
  murAccentRoles: RoomRole[];
}

export interface StyleDefinition {
  id: StyleId;
  nom: string;
  description: string;
  palette: Record<Tier, CouleurNommee>;
  /** Les 3 familles de matériaux principales du style (au plus 3, cf. STY-03), par ordre de préférence. */
  familles: string[];
  murs: { dominante: Revetement; accent: Revetement; humide: Revetement };
  bois: { principale: string; compatibles: string[] };
  metal: { nom: string; materialId: string; hex: string; manque?: string };
  /** Options de finition par catégorie, de la préférée à la moins préférée (au moins une). */
  mobilier: Record<FurnitureCategory, OptionFinition[]>;
  lumiereK: number;
  gammes: Record<Gamme, VarianteGamme>;
  /** Matériaux absents de la bibliothèque Studio (liste lisible, dédoublonnée). */
  manques: string[];
}

/** Revêtements retenus pour une pièce du logement. */
export interface RoomStyle {
  roomId: string;
  role: RoomRole;
  typeSol: 'sec' | 'humide' | 'exterieur';
  sol: Revetement;
  murs: { dominante: Revetement; accent: Revetement | null };
}

/** Feuille de style d'un logement : résultat de buildStyleSheet(brief, analysis). */
export interface StyleSheet {
  version: 1;
  styleId: StyleId;
  nom: string;
  gamme: Gamme;
  palette: Record<Tier, CouleurNommee>;
  familles: string[];
  /** Essence unique de tout le mobilier bois du logement. */
  essencePrincipale: string;
  /** Essences admises dans le logement (principale + au plus une compatible, ex. celle du parquet). */
  essencesAdmises: string[];
  metal: StyleDefinition['metal'];
  lumiereK: number;
  qualiteBois: string;
  qualiteTextile: string;
  mobilier: Record<FurnitureCategory, OptionFinition[]>;
  rooms: RoomStyle[];
  manques: string[];
  assumptions: string[];
}
