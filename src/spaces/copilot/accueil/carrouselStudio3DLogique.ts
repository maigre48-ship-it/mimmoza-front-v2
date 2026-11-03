// Carrousel du bandeau « Mimmoza Studio · 3D » de l'accueil MimmozIA —
// logique PURE (aucun accès au DOM) : lecture du manifeste, sources d'image,
// navigation. Testé par carrouselStudio3DLogique.test.ts (node --test).
//
// Les images vivent dans public/accueil/studio-3d/ ; le manifeste
// (manifeste.json) les décrit. Chaque image existe en 2 tailles (1x = 800 px,
// 2x = 1600 px de large, 16:9) et 3 formats (AVIF, WebP, JPEG de repli) :
//   <fichier>-800.avif  <fichier>-800.webp  <fichier>-800.jpg
//   <fichier>-1600.avif <fichier>-1600.webp <fichier>-1600.jpg
// Le script de conversion (outils de l'agent accueil-carrousel) les produit à
// partir des PNG rendus par Unreal et réécrit le manifeste.

export const DOSSIER_STUDIO_3D = '/accueil/studio-3d/';
export const URL_MANIFESTE_STUDIO_3D = `${DOSSIER_STUDIO_3D}manifeste.json`;
/** Le bandeau montre au plus 4 images (au-delà, la pagination perd son sens). */
export const MAX_IMAGES_CARROUSEL = 4;
/** Largeur 1x (px CSS) et 2x des variantes ; ratio 16:9. */
export const LARGEUR_1X = 800;
export const LARGEUR_2X = 1600;
export const HAUTEUR_1X = 450;
/** Délai entre deux images en lecture automatique. */
export const DELAI_DEFILEMENT_MS = 6500;
/** Glissement horizontal minimal (px) pour changer d'image au doigt. */
export const SEUIL_GLISSEMENT_PX = 40;

export interface ImageCarrousel {
  /** Nom de base, sans taille ni extension (ex. « maison-temoin-aerienne »). */
  fichier: string;
  /** Légende courte affichée sur l'image (facultative). */
  titre: string | null;
  /** Texte alternatif (obligatoire : une image sans alt est écartée). */
  alt: string;
  /** Emplacement de démonstration, à remplacer par un vrai rendu Unreal. */
  demo: boolean;
}

export interface SourcesImage {
  avif: string;
  webp: string;
  /** srcset JPEG (repli) */
  jpeg: string;
  /** src du <img> (JPEG 1x) */
  src: string;
}

const NOM_FICHIER = /^[a-z0-9][a-z0-9-]{0,80}$/;

/**
 * Lit un manifeste (JSON déjà parsé) et rend les images valides, dans l'ordre,
 * 4 au plus. Tolérant : une entrée invalide est ignorée, pas le manifeste entier.
 */
export function lireManifeste(brut: unknown): ImageCarrousel[] {
  const liste = (brut && typeof brut === 'object' && Array.isArray((brut as { images?: unknown }).images))
    ? (brut as { images: unknown[] }).images : [];
  const vus = new Set<string>();
  const images: ImageCarrousel[] = [];
  for (const e of liste) {
    if (!e || typeof e !== 'object') continue;
    const { fichier, titre, alt, demo } = e as Record<string, unknown>;
    if (typeof fichier !== 'string' || !NOM_FICHIER.test(fichier) || vus.has(fichier)) continue;
    if (typeof alt !== 'string' || alt.trim() === '') continue;
    vus.add(fichier);
    const t = typeof titre === 'string' ? titre.trim().slice(0, 80) : '';
    images.push({ fichier, titre: t || null, alt: alt.trim().slice(0, 240), demo: demo === true });
    if (images.length === MAX_IMAGES_CARROUSEL) break;
  }
  return images;
}

/** srcset 1x/2x par format, pour un <picture>. */
export function sourcesImage(image: Pick<ImageCarrousel, 'fichier'>, dossier = DOSSIER_STUDIO_3D): SourcesImage {
  const base = `${dossier}${image.fichier}`;
  const jeu = (ext: string) => `${base}-${LARGEUR_1X}.${ext} 1x, ${base}-${LARGEUR_2X}.${ext} 2x`;
  return { avif: jeu('avif'), webp: jeu('webp'), jpeg: jeu('jpg'), src: `${base}-${LARGEUR_1X}.jpg` };
}

/** Indice voisin, en boucle (delta = +1 suivant, -1 précédent). */
export function indiceVoisin(indice: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (((indice + delta) % total) + total) % total;
}

/** Sens d'un glissement au doigt : +1 (image suivante), -1 (précédente), 0 (rien). */
export function sensGlissement(dx: number, dy: number, seuil = SEUIL_GLISSEMENT_PX): -1 | 0 | 1 {
  if (Math.abs(dx) < seuil || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Images à monter dans le DOM : l'image affichée, la suivante (préchargée
 * pendant la pause) et celles déjà vues. Les autres attendent : le carrousel
 * ne télécharge pas 4 images d'un coup.
 */
export function imagesAMonter(indice: number, total: number, dejaVues: ReadonlySet<number>): Set<number> {
  const a = new Set<number>(dejaVues);
  if (total <= 0) return a;
  a.add(indice);
  if (total > 1) a.add(indiceVoisin(indice, total, 1));
  return a;
}
