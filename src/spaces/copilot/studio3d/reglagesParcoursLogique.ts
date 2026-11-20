// src/spaces/copilot/studio3d/reglagesParcoursLogique.ts
// =============================================================================
// VIS-18b (20/11/2026) — logique PURE des petits réglages DANS les étapes du parcours (testée par node) :
//   · fond de l'image (étape 6 du parcours Images) : étude / photo de la rue / votre photo — mêmes tuiles et mêmes
//     règles que la carte « Fond de l'image » du devis (choixFond.ts tuilesFond, fondImage.ts) ; le choix est
//     MÉMORISÉ (parcours.store) et repris par le devis d'image du chat (instantané → copilot-chat env.fondParcours) ;
//   · gamme / cible sans étude rattachée (étapes 4 / 5) : listes de src/lib/studio/parcours.ts.
// =============================================================================
import { fondDe, LIBELLES_FOND, type FondImage, type OptionsFond, type PhotoClientOption } from '../../../lib/studio/fondImage.ts';
import { lireContour, type LonLat } from '../../../lib/studio/couverturePhotoRue.ts';
import { lireDevisFond, type DevisFond } from './choixFond.ts';
import type { MessageOutils } from './preparationStudio.ts';

/** Fond à mémoriser pour un choix (étude : objet vide, la valeur par défaut n'est jamais recopiée). */
export function fondDuChoix(fond: FondImage, photo?: PhotoClientOption | null): OptionsFond {
  if (fond === 'photo_client') return photo ? { fond: 'photo_client', photo_client: photo } : {};
  return fond === 'photo_rue' ? { fond: 'photo_rue' } : {};
}

/** Dernier devis d'IMAGE du fil (carte « Fond de l'image ») ; null s'il n'y en a pas. */
export function dernierDevisImage(messages: readonly MessageOutils[]): DevisFond | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const t of [...(messages[i].toolCalls ?? [])].reverse()) {
      if (t.name !== 'studio_lancer_rendu') continue;
      return lireDevisFond(t);
    }
  }
  return null;
}

/**
 * Un devis d'image attend-il l'accord de l'utilisateur (dernière réponse de Mimmo, rien d'écrit depuis) ? Alors un
 * fond choisi dans l'étape demande un NOUVEAU devis (message au chat) ; sinon il est seulement mémorisé.
 */
export function devisImageEnAttente(messages: readonly MessageOutils[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return false;
    if (m.role !== 'assistant') continue;
    return (m.toolCalls ?? []).some((t) => t.name === 'studio_lancer_rendu' && lireDevisFond(t) !== null);
  }
  return false;
}

/** Contour (WGS 84) de la parcelle retenue (GeoJSON Polygon / MultiPolygon : anneau extérieur du premier polygone). */
export function contourDeParcelle(parcel: { geometry?: { type?: string; coordinates?: unknown } | null } | null | undefined): LonLat[] | null {
  const g = parcel?.geometry;
  if (!g || !Array.isArray(g.coordinates)) return null;
  const anneau = g.type === 'Polygon' ? (g.coordinates as unknown[])[0] : g.type === 'MultiPolygon' ? ((g.coordinates as unknown[])[0] as unknown[] | undefined)?.[0] : null;
  return lireContour(anneau);
}

/**
 * Devis « vu par l'étape » : celui du chat s'il existe (couverture vérifiée par le serveur), sinon un devis vide sur le
 * contour de la parcelle (couverture à vérifier d'un clic). Le fond choisi est le fond MÉMORISÉ s'il y en a un.
 */
export function devisDeLEtape(messages: readonly MessageOutils[], memorise: OptionsFond | null, contour: LonLat[] | null): DevisFond {
  const d = dernierDevisImage(messages);
  const base: DevisFond = d ?? { choisi: 'etude', couverture: null, raisonCouverture: 'Photos de rue disponibles : à vérifier.', facade: null, contour };
  return { ...base, choisi: memorise ? fondDe(memorise) : base.choisi, contour: base.contour ?? contour };
}

/** Message au chat quand un devis d'image attend : Mimmo refait le devis (le serveur lit le fond dans le parcours). */
export function messageFondParcours(fond: OptionsFond): string {
  const f = fondDe(fond);
  return `Fond de l’image : ${LIBELLES_FOND[f]}${f === 'photo_client' ? ' (photo envoyée avec mon accord)' : ''} — choisi dans le parcours, refais le devis avec ce fond.`;
}

/** Résumé d'une ligne du fond (étape 6). */
export function resumeFond(fond: OptionsFond | null): string {
  return fond ? `Fond : ${LIBELLES_FOND[fondDe(fond)].toLowerCase()}.` : 'Fond : étude seule (par défaut) — ou photo de la rue, ou votre photo.';
}
