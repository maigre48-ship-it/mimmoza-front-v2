// src/spaces/quartier/PictoCategorie.tsx — VIS-70 : pictogramme d'une catégorie du quartier (tracé du module pur).
import { DEFINITIONS_CATEGORIES, type CategorieQuartier } from '../../lib/quartier/categoriesQuartier.ts';

export function PictoCategorie({ id, taille = 18, couleur = 'currentColor', epaisseur = 1.8 }: { id: CategorieQuartier; taille?: number; couleur?: string; epaisseur?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={DEFINITIONS_CATEGORIES[id].picto} />
    </svg>
  );
}

/** Pastille ronde colorée avec le pictogramme blanc (repères de carte, liste des catégories). */
export function PastilleCategorie({ id, taille = 30 }: { id: CategorieQuartier; taille?: number }) {
  return (
    <span className="mz-qr-pastille" style={{ width: taille, height: taille, background: DEFINITIONS_CATEGORIES[id].couleur }} aria-hidden="true">
      <PictoCategorie id={id} taille={Math.round(taille * 0.56)} couleur="#ffffff" epaisseur={2} />
    </span>
  );
}
