// src/spaces/copilot/studio3d/renduParcours.ts
// =============================================================================
// VIS-28 (24/11/2026) — écran des étapes 6, 7 et 8 de l'Espace 3D quand un parcours est choisi (Images, Film ou
// Visite 360°) : logique pure, testée sans navigateur.
//   · feuilleDeLEtape : l'écran s'ouvre DIRECTEMENT sur la feuille du type du parcours (pas de nouveau choix
//     « Film, visite 360° ou image ») — étape 6 : réglages, étape 7 : aperçu, étape 8 : final ; rendus à revoir ou
//     étape bloquée : aucune feuille (la liste des rendus du type suffit, pas de lancement concurrent).
//   · rendusDuType : « Déjà réalisés » ne montre que les rendus du type du parcours ; les autres restent accessibles
//     derrière « Autres rendus (n) ».
// =============================================================================
import type { CleEtape, EtapeParcours, TypeParcours } from '../../../lib/studio/parcours.ts';
import type { QualiteImage, TravailStudio, TypeTravail } from '../../../lib/studio/travauxLogique.ts';

/** Type de rendu (studio_jobs) du parcours. */
export const TRAVAIL_DU_PARCOURS: Readonly<Record<TypeParcours, TypeTravail>> = { image: 'image', film: 'film', visite: 'visite360' };

/** Étapes dont l'écran est la feuille de rendu (FilmVisitePanel). */
export const ETAPES_RENDU: readonly CleEtape[] = ['vues', 'scenario', 'pieces', 'apercu', 'final'];

/** Feuille ouverte d'office par l'écran d'une étape ; `qualite` absente : celle déjà choisie dans la feuille. */
export interface FeuilleEtape { feuille: TypeTravail; qualite?: QualiteImage }

export function feuilleDeLEtape(type: TypeParcours, etape: Pick<EtapeParcours, 'cle' | 'statut' | 'action'> | null | undefined): FeuilleEtape | null {
  if (!etape || !ETAPES_RENDU.includes(etape.cle) || etape.statut === 'bloquee') return null;
  const feuille = TRAVAIL_DU_PARCOURS[type];
  if (etape.cle === 'apercu' || etape.cle === 'final') {
    // Aperçu prêt / validé, final en calcul ou livré : on montre les rendus (action « Voir », « Suivre »), pas la feuille.
    if (etape.action.cible === 'resultats') return null;
    return { feuille, qualite: etape.cle === 'apercu' ? 'apercu' : 'finale' };
  }
  return { feuille };
}

/** Sépare les rendus du type du parcours des autres (type null : pas de parcours, tout est « du type »). */
export function rendusDuType<T extends Pick<TravailStudio, 'type'>>(travaux: readonly T[], type: TypeTravail | null | undefined): { duType: T[]; autres: T[] } {
  if (!type) return { duType: [...travaux], autres: [] };
  return { duType: travaux.filter((t) => t.type === type), autres: travaux.filter((t) => t.type !== type) };
}
