// src/lib/studio/couverturePhotoRue.ts
//
// LOT P2 (11/11/2026) — « IMAGE DANS SA RUE » : couverture Panoramax d'une parcelle.
//
// Question posée, et seulement celle-là : existe-t-il, sur l'instance IGN de Panoramax, des photos sous
// Licence Ouverte 2.0 (`license === 'etalab-2.0'`, filtre PAR PHOTO) à 60 m au plus du contour de la
// parcelle ? Le verdict fin (façade visible, champ, calage, bâtiment existant) reste à la machine de rendu,
// qui sait se replier sur l'image d'étude. Ici on ne dit jamais « la façade est visible ».
//
// Source : `GET https://panoramax.ign.fr/api/search?bbox=…&limit=…` (FeatureCollection STAC), même emprise
// que `urlRecherche` du Studio (src/core/panoramax/metadonnees.ts, 60 m). Photos CC-BY-SA et autres licences :
// écartées (jamais livrées). Google Street View : exclu (décision d'Albé du 11/11).
//
// PUR (aucune dépendance) sauf `verifierCouverture`, dont l'appel réseau est injecté (`fetchFn`) : le même
// module sert au serveur (copilot-chat/agent/studio.ts, devis d'une image), à la fonction
// `photo-rue-couverture` (lecture seule) et aux tests (node --test, deno test) sans réseau.

export const API_PANORAMAX_IGN = 'https://panoramax.ign.fr/api';
export const LICENCE_PHOTO_RUE = 'etalab-2.0';
/** Distance maximale entre une photo et le contour de la parcelle (m). */
export const RAYON_COUVERTURE_M = 60;
/** Photos demandées à l'API (au-delà, la réponse est tronquée : « couverte » reste vrai si une photo est retenue). */
export const LIMITE_RECHERCHE = 100;
/** Photos rendues au plus (les plus proches). */
export const PHOTOS_RENDUES_MAX = 10;
export const DELAI_COUVERTURE_MS = 6000;
/** Sommets du contour acceptés au plus (entrée de la fonction publique). */
export const SOMMETS_CONTOUR_MAX = 400;
/** Côté maximal de l'emprise d'une parcelle (m) : au-delà, la demande est refusée (pas une parcelle). */
export const COTE_EMPRISE_MAX_M = 1500;

export type LonLat = readonly [number, number];
export interface PhotoCouverture { id: string; date: string; distanceM: number }
/** Réponse du contrat : `{ couverte, photos, verifieLe }`. */
export interface CouverturePhotoRue { couverte: boolean; photos: PhotoCouverture[]; verifieLe: string }
export type ResultatCouverture = { ok: true; couverture: CouverturePhotoRue } | { ok: false; raison: string };

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const M_PAR_DEGRE_LAT = 111_132;
const M_PAR_DEGRE_LON_EQ = 111_320;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contour lisible : 3 sommets au moins, lon/lat valides, sans le sommet de fermeture répété. null sinon. */
export function lireContour(v: unknown): LonLat[] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > SOMMETS_CONTOUR_MAX + 1) return null;
  const pts: LonLat[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2 || !fini(p[0]) || !fini(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return null;
    pts.push([p[0], p[1]]);
  }
  const a = pts[0], z = pts[pts.length - 1];
  if (pts.length > 3 && a[0] === z[0] && a[1] === z[1]) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** Anneau extérieur de la plus grande partie d'une géométrie cadastrale (Polygon / MultiPolygon), ou null. */
export function contourDepuisGeometrie(g: unknown): LonLat[] | null {
  if (!estObj(g) || !Array.isArray(g.coordinates)) return null;
  const parties = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let meilleur: LonLat[] | null = null;
  let aire = -1;
  for (const partie of parties) {
    const c = Array.isArray(partie) ? lireContour(partie[0]) : null;
    if (!c) continue;
    const a = Math.abs(aireLocale(c));
    if (a > aire) { aire = a; meilleur = c; }
  }
  return meilleur;
}

function aireLocale(c: readonly LonLat[]): number {
  const o = c[0];
  const kx = M_PAR_DEGRE_LON_EQ * Math.cos(o[1] * Math.PI / 180);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length];
    s += ((p[0] - o[0]) * kx) * ((q[1] - o[1]) * M_PAR_DEGRE_LAT) - ((q[0] - o[0]) * kx) * ((p[1] - o[1]) * M_PAR_DEGRE_LAT);
  }
  return s / 2;
}

/** Emprise [ouest, sud, est, nord] du contour élargie de `margeM` mètres (même calcul que le Studio). */
export function empriseRecherche(contour: readonly LonLat[], margeM = RAYON_COUVERTURE_M): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [lon, lat] of contour) { a = Math.min(a, lon); b = Math.min(b, lat); c = Math.max(c, lon); d = Math.max(d, lat); }
  const lat0 = (b + d) / 2;
  const dLat = margeM / M_PAR_DEGRE_LAT;
  const dLon = margeM / (M_PAR_DEGRE_LON_EQ * Math.cos((lat0 * Math.PI) / 180));
  const r7 = (v: number): number => Math.round(v * 1e7) / 1e7;
  return [r7(a - dLon), r7(b - dLat), r7(c + dLon), r7(d + dLat)];
}

/** Côté le plus long de l'emprise du contour (m), sans marge. */
export function coteEmpriseM(contour: readonly LonLat[]): number {
  const [o, s, e, n] = empriseRecherche(contour, 0);
  const kx = M_PAR_DEGRE_LON_EQ * Math.cos(((s + n) / 2) * Math.PI / 180);
  return Math.max((e - o) * kx, (n - s) * M_PAR_DEGRE_LAT);
}

export function urlRechercheIgn(contour: readonly LonLat[], margeM = RAYON_COUVERTURE_M, limite = LIMITE_RECHERCHE): string {
  const [a, b, c, d] = empriseRecherche(contour, margeM);
  return `${API_PANORAMAX_IGN}/search?bbox=${a},${b},${c},${d}&limit=${Math.max(1, Math.min(500, Math.round(limite)))}`;
}

/** Distance (m) d'un point au contour : 0 s'il est à l'intérieur, sinon à la limite la plus proche. */
export function distanceAuContourM(p: LonLat, contour: readonly LonLat[]): number {
  const o = contour[0];
  const kx = M_PAR_DEGRE_LON_EQ * Math.cos(o[1] * Math.PI / 180);
  const loc = (q: LonLat) => ({ x: (q[0] - o[0]) * kx, y: (q[1] - o[1]) * M_PAR_DEGRE_LAT });
  const P = loc(p);
  const pts = contour.map(loc);
  let dedans = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > P.y) !== (b.y > P.y) && P.x < (b.x - a.x) * (P.y - a.y) / (b.y - a.y) + a.x) dedans = !dedans;
  }
  if (dedans) return 0;
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / l2));
    d = Math.min(d, Math.hypot(P.x - (a.x + t * dx), P.y - (a.y + t * dy)));
  }
  return d;
}

/** Date de prise de vue (AAAA-MM-JJ) : date locale écrite par l'appareil si elle existe, sinon date UTC. */
function datePriseDeVue(p: Obj): string | null {
  const tz = typeof p.datetimetz === 'string' ? /^(\d{4}-\d{2}-\d{2})T/.exec(p.datetimetz) : null;
  if (tz && !Number.isNaN(Date.parse(p.datetimetz as string))) return tz[1];
  if (typeof p.datetime !== 'string' || Number.isNaN(Date.parse(p.datetime))) return null;
  return new Date(Date.parse(p.datetime)).toISOString().slice(0, 10);
}

/**
 * Réponse de recherche Panoramax → couverture. Ne retient que les photos `etalab-2.0`, datées, positionnées,
 * à `rayonM` au plus du contour ; doublons ignorés ; les plus proches d'abord.
 */
export function lireCouverture(reponse: unknown, contour: readonly LonLat[], verifieLe: string, rayonM = RAYON_COUVERTURE_M): CouverturePhotoRue {
  const feats = estObj(reponse) && Array.isArray(reponse.features) ? reponse.features : [];
  const vus = new Set<string>();
  const photos: PhotoCouverture[] = [];
  for (const f of feats) {
    if (!estObj(f) || typeof f.id !== 'string' || !RE_UUID.test(f.id) || vus.has(f.id.toLowerCase())) continue;
    const p = estObj(f.properties) ? f.properties : {};
    if (p.license !== LICENCE_PHOTO_RUE) continue;
    const g = estObj(f.geometry) ? f.geometry : null;
    const c = g && g.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates : null;
    if (!c || !fini(c[0]) || !fini(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) continue;
    const date = datePriseDeVue(p);
    if (!date) continue;
    const d = distanceAuContourM([c[0], c[1]], contour);
    if (d > rayonM) continue;
    vus.add(f.id.toLowerCase());
    photos.push({ id: f.id.toLowerCase(), date, distanceM: Math.round(d * 10) / 10 });
  }
  photos.sort((u, v) => u.distanceM - v.distanceM || (u.date < v.date ? 1 : u.date > v.date ? -1 : 0));
  const retenues = photos.slice(0, PHOTOS_RENDUES_MAX);
  return { couverte: retenues.length > 0, photos: retenues, verifieLe };
}

/**
 * Interroge l'instance IGN (appel injecté) et rend la couverture. Ne lève jamais : tout échec rend
 * `{ ok: false, raison }` — la couverture est alors « non vérifiée », jamais « absente ».
 */
export async function verifierCouverture(contourBrut: unknown, fetchFn: typeof fetch, maintenant: () => number = Date.now): Promise<ResultatCouverture> {
  const contour = lireContour(contourBrut);
  if (!contour) return { ok: false, raison: 'Contour de la parcelle illisible : couverture Panoramax non vérifiée.' };
  if (coteEmpriseM(contour) > COTE_EMPRISE_MAX_M) return { ok: false, raison: 'Emprise trop grande pour une parcelle : couverture Panoramax non vérifiée.' };
  let corps: unknown;
  try {
    const r = await fetchFn(urlRechercheIgn(contour), { signal: AbortSignal.timeout(DELAI_COUVERTURE_MS), headers: { accept: 'application/geo+json, application/json' } });
    if (!r.ok) return { ok: false, raison: `Panoramax (instance IGN) a refusé la recherche (réponse ${r.status}) : couverture non vérifiée.` };
    corps = await r.json();
  } catch {
    return { ok: false, raison: 'Panoramax (instance IGN) n’a pas répondu : couverture non vérifiée.' };
  }
  if (!estObj(corps) || !Array.isArray(corps.features)) return { ok: false, raison: 'Réponse de Panoramax illisible : couverture non vérifiée.' };
  return { ok: true, couverture: lireCouverture(corps, contour, new Date(maintenant()).toISOString()) };
}

/** Relit une couverture transmise (sortie d'outil, réponse de la fonction) ; null si illisible. */
export function lireCouvertureTransmise(v: unknown): CouverturePhotoRue | null {
  if (!estObj(v) || typeof v.couverte !== 'boolean' || typeof v.verifieLe !== 'string' || !Array.isArray(v.photos)) return null;
  const photos: PhotoCouverture[] = [];
  for (const p of v.photos.slice(0, PHOTOS_RENDUES_MAX)) {
    if (!estObj(p) || typeof p.id !== 'string' || !RE_UUID.test(p.id) || typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !fini(p.distanceM) || p.distanceM < 0) return null;
    photos.push({ id: p.id.toLowerCase(), date: p.date, distanceM: p.distanceM });
  }
  if (v.couverte !== photos.length > 0) return null;
  return { couverte: v.couverte, photos, verifieLe: v.verifieLe };
}

/** Phrase lisible (« 3 photos sous Licence Ouverte à moins de 60 m, la plus proche à 11,4 m (28/04/2026) »). */
export function phraseCouverture(c: CouverturePhotoRue): string {
  if (!c.couverte) return `Aucune photo de rue sous Licence Ouverte (Panoramax, instance IGN) à moins de ${RAYON_COUVERTURE_M} m de la parcelle.`;
  const p = c.photos[0];
  const [a, m, j] = p.date.split('-');
  const n = c.photos.length;
  return `${n} photo${n > 1 ? 's' : ''} de rue sous Licence Ouverte (Panoramax, instance IGN) à moins de ${RAYON_COUVERTURE_M} m de la parcelle ; ` +
    `la plus proche à ${String(p.distanceM).replace('.', ',')} m (prise le ${j}/${m}/${a}). La machine de rendu vérifiera que la façade sur rue y est visible.`;
}
