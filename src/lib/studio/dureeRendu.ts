/**
 * LOT G8 (18/11/2026) — durée annoncée d'une IMAGE DANS UNE PHOTO (extension ou projet dans sa rue). Module PUR,
 * sans import (front Vite et fonctions Deno).
 *
 * Avant ce lot, le devis appliquait à toute image la formule de l'image d'étude (préparation + aperçu de contrôle +
 * 20 à 60 min par vue) : « environ 57 min à 2 h 17 » pour une image qui, insérée dans une photo, prend en réalité
 * 287 à 391 s une fois le travail pris (mesuré sur les travaux du 13 au 17/11/2026, table studio_jobs et journaux de
 * la machine de rendu). La machine de rendu passe en voie EXPRESS pour ces images (mêmes contrôles, publication Unreal
 * réutilisée quand la scène n'a pas changé, détourage du premier plan accéléré) : la durée annoncée est alors une
 * ESTIMATION, dite comme telle, tant que de nouveaux travaux ne l'ont pas mesurée.
 * Mêmes chiffres que le Studio (src/core/rendu/renduExpress.ts).
 */

/** Secondes, une fois le travail pris par la machine. */
export const DUREE_IMAGE_PHOTO_S = {
  /** Mesuré avant la voie express (13 au 17/11/2026). */
  mesuree: { min: 287, max: 391 },
  /** Voie express, ESTIMÉE : scène 11 + publication 70 + photo 19 + envoi 10 + premier plan 15–35 + passes 95–166. */
  express: { min: 220, max: 311 },
  /** Voie express quand la scène n'a pas changé (publication réutilisée), ESTIMÉE. */
  expressSceneInchangee: { min: 150, max: 241 },
} as const;

const minutes = (minS: number, maxS: number): string => {
  const a = Math.max(1, Math.round(minS / 60));
  const b = Math.max(a, Math.ceil(maxS / 60));
  return a === b ? `${a} min` : `${a} à ${b} min`;
};

/** « 1 h 17 », « 37 min ». */
const heures = (m: number): string => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);

export function estFondPhoto(fond: unknown): boolean {
  return fond === 'photo_rue' || fond === 'photo_client';
}

/** Durée courte d'une image dans une photo (cartes du site) : « environ 4 à 6 min (estimé) ». */
export function dureeImagePhotoCourte(): string {
  const e = DUREE_IMAGE_PHOTO_S.express;
  return `environ ${minutes(e.min, e.max)} (estimé)`;
}

/**
 * Phrase du devis d'une image dans une photo. `extension` : aucune image d'étude de repli (photo réelle obligatoire),
 * sinon le repli possible est dit avec sa durée (formule de l'image d'étude, `nombreVues` vues).
 */
export function dureeAnnonceeImagePhoto(o: { readonly extension: boolean; readonly nombreVues: number }): string {
  const e = DUREE_IMAGE_PHOTO_S.express;
  const r = DUREE_IMAGE_PHOTO_S.expressSceneInchangee;
  const m = DUREE_IMAGE_PHOTO_S.mesuree;
  const base = `environ ${minutes(e.min, e.max)} une fois le rendu démarré (estimé ; ${minutes(r.min, r.max)} si la scène n’a pas changé depuis le dernier rendu ; mesuré avant les derniers réglages : ${minutes(m.min, m.max)})`;
  if (o.extension) return base;
  const n = Math.max(1, Math.min(3, Math.round(Number.isFinite(o.nombreVues) ? o.nombreVues : 1)));
  return `${base} ; si la photo ne peut pas être utilisée, l’image d’étude demande ${heures(10 + 7 + 20 * n)} à ${heures(10 + 7 + 60 * n)} de plus`;
}

/** « 2 min 10 », « 45 s ». */
export function dureeEcoulee(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  if (t < 60) return `${t} s`;
  const mn = Math.floor(t / 60);
  const s = t % 60;
  return s ? `${mn} min ${String(s).padStart(2, '0')}` : `${mn} min`;
}

/**
 * Ligne de suivi d'un rendu en cours (image dans une photo seulement) : temps écoulé et durée habituelle.
 * null si ce n'est pas une image dans une photo ou si le démarrage est inconnu.
 */
export function ligneTempsRendu(t: { readonly type: string; readonly options: Record<string, unknown> | null; readonly demarre_le: string | null }, maintenant: number): string | null {
  if (t.type !== 'image' || !estFondPhoto(t.options?.['fond'])) return null;
  const debut = t.demarre_le ? Date.parse(t.demarre_le) : NaN;
  if (!Number.isFinite(debut)) return null;
  const e = DUREE_IMAGE_PHOTO_S.express;
  const ecoule = maintenant - debut;
  const depasse = ecoule > e.max * 1000 * 1.5;
  return `Démarré il y a ${dureeEcoulee(ecoule)} — une image dans une photo prend habituellement ${minutes(e.min, e.max)} (estimé)${depasse ? ' ; celle-ci est plus longue que d’habitude' : ''}.`;
}
