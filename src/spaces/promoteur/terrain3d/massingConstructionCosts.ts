// src/spaces/promoteur/terrain3d/massingConstructionCosts.ts
//
// Prix unitaires de construction DÉRIVÉS de la géométrie Massing 3D.
// Le coût au m² n'est pas constant : un R+5 coûte plus cher au m² qu'un R+1
// (fondations renforcées, grue, ascenseur, structure, accès façade en hauteur).
//
// Module PUR : aucune dépendance React/THREE. L'utilisateur peut toujours
// personnaliser ensuite (mode manuel dans le Bilan) — ceci ne fournit que les
// valeurs AUTO par défaut, recalculées à chaque changement de volume.

import type { MassingMetrics } from "./massingBilanBridge";

export interface DerivedConstructionCosts {
  structureCostEurM2Sdp: number;   // gros œuvre / structure
  facadeCostEurM2: number;         // ravalement / ITE
  roofTerrasseCostEurM2: number;   // étanchéité
  roofPenteCostEurM2: number;      // charpente + couverture
  balconyCostEurM2: number;        // dalles de balcon
  windowUnitCostEur: number;       // menuiserie à l'unité
  foundationCostEurM2Emprise: number; // fondations €/m² d'emprise (selon charge/niveaux)
  // Infos pour l'affichage / explication.
  niveaux: number;
  structMultPct: number;           // surcoût gros œuvre en % (peut être négatif)
  facadeMultPct: number;
  basis: string;                   // libellé court « R+5 (6 niv.) · gros œuvre +15 % »
}

// ── Prix de référence (immeuble R+2 ≈ 3 niveaux), en €. ──
const REF = {
  structure:    1100,  // gros œuvre €/m² SDP à 3 niveaux
  facade:        180,  // €/m² de façade
  roofTerrasse:  180,  // €/m² étanchéité
  roofPente:     220,  // €/m² charpente + couverture
  balcony:       600,  // €/m² de balcon
  window:        650,  // €/menuiserie
  foundation:    290,  // €/m² d'emprise (semelles, sol normal, R+2)
};

// Niveaux de référence où le multiplicateur vaut 1.
const NIVEAUX_REF = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round10 = (v: number) => Math.round(v / 10) * 10;

/**
 * Estime le nb de niveaux depuis la géométrie : SDP ≈ emprise × niveaux.
 * Robuste : pas besoin d'un champ « niveaux » explicite dans le métré.
 */
export function estimateNiveaux(m: MassingMetrics): number {
  const emprise = m.totaux.empriseSolM2 || 0;
  const sdp = m.totaux.sdpM2 || 0;
  if (emprise <= 0 || sdp <= 0) return 1;
  return clamp(Math.round(sdp / emprise), 1, 40);
}

export function deriveConstructionCosts(m: MassingMetrics): DerivedConstructionCosts {
  const niveaux = estimateNiveaux(m);

  // Surcoût gros œuvre : +5 % par niveau au-delà de R+2, plafonné [-10 %, +60 %].
  // Fondations, structure, grue, ascenseur obligatoire dès R+3, etc.
  const structMult = clamp(1 + 0.05 * (niveaux - NIVEAUX_REF), 0.9, 1.6);
  // Surcoût façade : accès en hauteur (échafaudage/nacelle), plafonné [-5 %, +30 %].
  const facadeMult = clamp(1 + 0.03 * (niveaux - NIVEAUX_REF), 0.95, 1.3);
  // Surcoût fondations : la charge augmente avec les niveaux → semelles plus
  // profondes / radier. Plafonné [-15 %, +80 %].
  const foundMult = clamp(1 + 0.08 * (niveaux - NIVEAUX_REF), 0.85, 1.8);

  const structMultPct = Math.round((structMult - 1) * 100);
  const facadeMultPct = Math.round((facadeMult - 1) * 100);

  return {
    structureCostEurM2Sdp: round10(REF.structure * structMult),
    facadeCostEurM2:        round10(REF.facade * facadeMult),
    roofTerrasseCostEurM2:  REF.roofTerrasse,
    roofPenteCostEurM2:     REF.roofPente,
    balconyCostEurM2:       REF.balcony,
    windowUnitCostEur:      REF.window,
    foundationCostEurM2Emprise: round10(REF.foundation * foundMult),
    niveaux,
    structMultPct,
    facadeMultPct,
    basis: `R+${Math.max(0, niveaux - 1)} (${niveaux} niv.) · gros œuvre ${structMultPct >= 0 ? "+" : ""}${structMultPct} %`,
  };
}