// src/spaces/copilot/studio3d/confirmationRapide.ts
//
// CONFIRMATION RAPIDE D'UNE PARCELLE PROPOSÉE — logique PURE (testée par
// confirmationRapide.test.ts, node --test).
//
// Le Dossier 3D connaît déjà la parcelle (IDU + contour IGN) : on ne redemande
// pas d'adresse. On montre côte à côte la référence cadastrale et l'adresse la
// plus proche (géocodage inverse BAN), puis un clic confirme. Le point transmis
// à Studio est TOUJOURS à l'intérieur de la parcelle.
import type { ConfirmedTerrain } from './terrainCadastre.ts';
import { parcelCenter, parcelContains, type GpsPoint, type TerrainParcel } from './parcelFromGps.ts';
import type { VolumePropose } from './volumeParcelle.ts';

export const URL_ADRESSE_INVERSE = 'https://api-adresse.data.gouv.fr/reverse/';

/** Centre de la parcelle s'il est dedans ; sinon le point intérieur (grille 24×24) le plus proche du centre. */
export function pointDansParcelle(parcelle: TerrainParcel): GpsPoint {
  const centre = parcelCenter(parcelle);
  if (parcelContains(parcelle, centre)) return centre;
  const polygones = parcelle.geometry.type === 'Polygon' ? [parcelle.geometry.coordinates] : parcelle.geometry.coordinates;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const poly of polygones) for (const [lon, lat] of (poly[0] ?? [])) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLon)) return centre;
  const N = 24;
  let meilleur: GpsPoint | null = null, dMin = Infinity;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = { lon: minLon + (maxLon - minLon) * i / N, lat: minLat + (maxLat - minLat) * j / N };
    if (!parcelContains(parcelle, p)) continue;
    const d = (p.lon - centre.lon) ** 2 + (p.lat - centre.lat) ** 2;
    if (d < dMin) { dMin = d; meilleur = p; }
  }
  return meilleur ?? centre;
}

/** URL du géocodage inverse (adresse la plus proche du point). */
export function urlAdresseInverse(point: GpsPoint): string {
  return `${URL_ADRESSE_INVERSE}?lon=${point.lon.toFixed(7)}&lat=${point.lat.toFixed(7)}&limit=1`;
}

/** Libellé de la première adresse d'une réponse BAN ; null si aucune. */
export function adresseDepuisReponse(json: unknown): string | null {
  const f = (json as { features?: { properties?: { label?: unknown } }[] } | null)?.features?.[0];
  const label = f?.properties?.label;
  return typeof label === 'string' && label.trim() ? label.trim().slice(0, 200) : null;
}

/** Lien Géoportail (plan + cadastre) centré sur la parcelle, pour vérifier d'un coup d'œil. */
export function lienGeoportail(point: GpsPoint): string {
  return `https://www.geoportail.gouv.fr/carte?c=${point.lon.toFixed(6)},${point.lat.toFixed(6)}&z=19`
    + '&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)'
    + '&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes';
}

/** Terrain confirmé à partir de la parcelle proposée (l'IDU affiché est celui transmis). */
export function terrainDepuisParcelle(parcelle: TerrainParcel, idu: string, point: GpsPoint, adresse: string | null): ConfirmedTerrain & { adresse: string | null } {
  return { parcel: { ...parcelle, properties: { ...parcelle.properties, idu } }, point, adresse };
}

/**
 * IMPLANTATION DU VOLUME POUR STUDIO — le bâtiment est posé comme sur le plan
 * axonométrique (même centre, même orientation), au lieu d'être placé par Studio.
 *
 * Conventions : volumeParcelle.ts mesure `angleDeg` dans le sens trigonométrique
 * depuis l'EST (x est, y nord) ; Studio (rotatePoint, z vers le SUD) et
 * footprintPoints tournent dans le sens horaire vu du ciel. Donc
 * orientationDeg = −angleDeg. La largeur (grand côté) reste l'axe x du bâtiment.
 * Entrée au niveau du terrain naturel (entryOffsetM = 0). Studio n'applique la
 * pose qu'avec le relief mesuré et vérifie que le centre tombe dans la parcelle.
 */
export function implantationDepuisVolume(v: Pick<VolumePropose, 'emprise'>): { lon: number; lat: number; orientationDeg: number; entryOffsetM: number } | null {
  const e = v.emprise;
  if (!e || !Number.isFinite(e.centreWgs84.lon) || !Number.isFinite(e.centreWgs84.lat) || !Number.isFinite(e.angleDeg)) return null;
  // Lot P9 : le Studio lit « L m x P m » en longueur = plus grand côté, posée le long de orientationDeg
  // (nl.findDimensions). angleDeg est l'axe de la LARGEUR du moteur : si la profondeur est plus grande, +90°.
  const axe = e.profondeurM > e.largeurM + 1e-9 ? e.angleDeg + 90 : e.angleDeg;
  let o = -axe;
  o = ((o % 360) + 540) % 360 - 180; // ]-180, 180]
  if (o === -180) o = 180;
  return { lon: e.centreWgs84.lon, lat: e.centreWgs84.lat, orientationDeg: Math.round(o * 10) / 10 || 0, entryOffsetM: 0 };
}
