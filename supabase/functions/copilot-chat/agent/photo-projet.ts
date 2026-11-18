// supabase/functions/copilot-chat/agent/photo-projet.ts
// =============================================================================
// LOT G3 (17/11/2026) — « J'envoie une photo de ma maison avec mes instructions » (objectif d'Albé : comme avec
// ChatGPT, mais avec une géométrie exacte et un plan).
//
// La photo JOINTE au message (pièce jointe du chat) devient la PHOTO DU PROJET d'extension :
//   1. ses données EXIF sont lues sur le serveur (même lecteur que la carte « Votre photo du trottoir ») ;
//   2. si aucune parcelle n'est connue, la position GPS de la photo retrouve la parcelle au cadastre (API Carto IGN) :
//      la parcelle qui CONTIENT le point (photo prise depuis le terrain), sinon la première parcelle traversée dans la
//      direction de prise de vue (GPSImgDirection) ; sans direction et hors de toute parcelle, rien n'est deviné :
//      l'adresse est demandée ;
//   3. la photo d'ORIGINE (aucune recompression) est déposée dans l'espace privé de l'utilisateur
//      (`studio-transfert/<uid>/<uuid>.jpg`, seau et motif de la photo du client) ;
//   4. elle est mémorisée dans la sortie du parcours (`photo_projet`) et sert ensuite de fond à l'image de l'extension
//      (studio.ts) : jamais la photo de la rue à sa place, jamais une image de synthèse.
// Rien n'est deviné : une valeur absente reste absente (statut et source dits).
// Module à I/O injectées (fetch, dépôt) : testé hors ligne (extension-g3.test.ts).
// =============================================================================

import { lireExifPhoto, type ExifPhotoClient } from '../../../../src/lib/studio/photoClientLogique.ts';
import type { PhotoClientOption } from '../../../../src/lib/studio/fondImage.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const VERSION_PHOTO_PROJET = 1;
export const TYPES_PHOTO_PROJET = ['image/jpeg', 'image/png'] as const;
/** Même plafond que la photo du client (fondImage.ts, OCTETS_PHOTO_MAX). */
export const OCTETS_PHOTO_PROJET_MAX = 20 * 1024 * 1024;
export const URL_CADASTRE = 'https://apicarto.ign.fr/api/cadastre/parcelle';
/** Rayon de recherche des parcelles autour de la position de la photo (m). */
export const RAYON_RECHERCHE_M = 60;
/** Portée de la direction de prise de vue : au-delà, la maison photographiée n'est pas retenue (m). */
export const PORTEE_VISEE_M = 80;
const DELAI_MS = 8000;
const RE_IDU = /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;

/** Photo du projet mémorisée d'un tour à l'autre (sortie de l'outil du parcours). */
export interface PhotoProjet {
  readonly v: 1;
  /** `<uid>/<uuid>.<ext>` dans le seau privé `studio-transfert`. */
  readonly chemin: string;
  readonly octets: number;
  readonly media_type: 'image/jpeg' | 'image/png';
  /** Date de réception (AAAA-MM-JJ). */
  readonly recue_le: string;
  /** Nom du fichier joint (affichage). */
  readonly nom: string | null;
  /** Position et direction LUES dans la photo (EXIF) ; null si absentes. */
  readonly position: { readonly lon: number; readonly lat: number } | null;
  readonly cap_deg: number | null;
  /** Photo prise DEPUIS la parcelle (position dans le contour) ; null si inconnu. */
  readonly depuis_terrain: boolean | null;
  /** Parcelle du projet à laquelle la photo est rattachée ; null tant qu'elle n'est pas connue. */
  readonly idu: string | null;
  /** LOT G9 : date de l'accord explicite (mode 'bouton' seulement, voir ACCORD_PHOTO_JOINTE) ; absent sinon. */
  readonly accord_le?: string | null;
}

/** Photo jointe au message de CE tour (posée par le serveur à partir des pièces jointes ; jamais par le modèle). */
export interface PhotoDuTour {
  readonly nom: string | null;
  readonly mediaType: string;
  /** Octets du fichier d'origine ; null si illisible. */
  charger(): Promise<Uint8Array | null>;
}

/**
 * LOT G9 — quelle copie de la photo jointe garder comme photo du projet. Le navigateur envoie au chat une copie
 * ≤ 5 Mo (réduite et redressée si besoin) et, à côté, l'ORIGINAL pour le placement (`originalPath`, même bucket).
 * L'original est retenu s'il est dans le dossier du compte, sans « .. », en JPEG ou PNG ; sinon la copie du chat. Pur.
 */
export function photoDuTourGardee(
  a: { readonly name?: string; readonly mediaType: string; readonly data?: string; readonly storagePath?: string; readonly originalPath?: string; readonly originalMediaType?: string },
  userId: string,
): { nom: string | null; mediaType: string; data?: string; storagePath?: string } {
  const nom = typeof a.name === 'string' ? a.name : null;
  const o = a.originalPath;
  if (typeof o === 'string' && o.startsWith(`${userId}/`) && !o.includes('..') && (a.originalMediaType === 'image/jpeg' || a.originalMediaType === 'image/png')) {
    return { nom, mediaType: a.originalMediaType, storagePath: o };
  }
  return { nom, mediaType: a.mediaType, ...(typeof a.data === 'string' ? { data: a.data } : {}), ...(typeof a.storagePath === 'string' ? { storagePath: a.storagePath } : {}) };
}

/**
 * LOT G9 — ACCORD pour utiliser une photo JOINTE au message comme fond de l'image de l'extension.
 * DÉCISION EN ATTENTE D'ALBÉ (question posée le 17/11/2026) ; le comportement actuel (lot G3) est gardé :
 *   · 'implicite' (ACTUEL) : joindre la photo avec une demande d'agrandissement vaut accord ; la mention « visages et
 *     plaques ne sont pas floutés » est affichée sous la carte du parcours (lignesPhotoProjet) et dans le devis ;
 *   · 'bouton' : la photo est gardée, mais ne sert de fond qu'une fois `accord_le` renseigné (clic « J'accepte… »,
 *     texte TEXTE_CONSENTEMENT de photoClientLogique.ts). ATTENTION : ce bouton n'existe PAS encore dans le chat ;
 *     passer à 'bouton' sans le lot qui l'ajoute empêcherait toute image sur la photo jointe (photo de la rue à la place).
 */
export type ModeAccordPhotoJointe = 'implicite' | 'bouton';
export const ACCORD_PHOTO_JOINTE: ModeAccordPhotoJointe = 'implicite';

/** La photo du projet peut-elle servir de fond, selon le mode d'accord ? Pur. */
export function photoProjetUtilisableCommeFond(p: PhotoProjet, mode: ModeAccordPhotoJointe = ACCORD_PHOTO_JOINTE): boolean {
  return mode === 'implicite' || (typeof p.accord_le === 'string' && p.accord_le.length > 0);
}

/** Dépôt de la photo d'origine dans l'espace privé de l'utilisateur ; renvoie le chemin, ou null en cas d'échec. */
export interface DepotPhotoProjet {
  deposer(userId: string, octets: Uint8Array, mediaType: 'image/jpeg' | 'image/png'): Promise<string | null>;
}

// ── Intention ───────────────────────────────────────────────────────────────────────────────────────────────
const norm = (t: string) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Une photo est jointe et le message demande d'agrandir la maison (extension, surélévation, garage, véranda…). */
export function intentionPhotoExtension(texte: string, photoJointe: boolean): boolean {
  if (!photoJointe) return false;
  const t = norm(texte);
  if (/\bextension (?:de|du|des) (?:delai|delais|navigateur|fichier|garantie|contrat)\b/.test(t)) return false;
  return /\b(?:extension|agrandi\w*|agrandissement|surelev\w*|rehauss\w*|garage|veranda|ajoute[rz]? (?:une |un )?(?:piece|chambre|etage|volume))\b/.test(t);
}

// ── Relecture ───────────────────────────────────────────────────────────────────────────────────────────────
const RE_CHEMIN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png)$/;
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Relit une photo du projet stockée ; tout objet mal formé est écarté (jamais corrigé). */
export function lirePhotoProjet(v: unknown): PhotoProjet | null {
  if (!estObj(v) || v.v !== VERSION_PHOTO_PROJET) return null;
  if (typeof v.chemin !== 'string' || !RE_CHEMIN.test(v.chemin)) return null;
  if (!fini(v.octets) || !Number.isInteger(v.octets) || v.octets < 1 || v.octets > OCTETS_PHOTO_PROJET_MAX) return null;
  if (v.media_type !== 'image/jpeg' && v.media_type !== 'image/png') return null;
  if (typeof v.recue_le !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.recue_le)) return null;
  const p = v.position;
  const position = estObj(p) && fini(p.lon) && fini(p.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90 ? { lon: p.lon, lat: p.lat } : null;
  const cap = fini(v.cap_deg) && v.cap_deg >= 0 && v.cap_deg < 360 ? v.cap_deg : null;
  return {
    v: 1, chemin: v.chemin, octets: v.octets, media_type: v.media_type, recue_le: v.recue_le,
    nom: typeof v.nom === 'string' ? v.nom.slice(0, 120) : null,
    position, cap_deg: cap,
    depuis_terrain: typeof v.depuis_terrain === 'boolean' ? v.depuis_terrain : null,
    idu: typeof v.idu === 'string' && RE_IDU.test(v.idu) ? v.idu : null,
    ...(typeof v.accord_le === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.accord_le) ? { accord_le: v.accord_le.slice(0, 32) } : {}),
  };
}

/** Dernière photo du projet de la conversation (sorties du parcours, de la plus récente à la plus ancienne). */
export function photoProjetDesSorties(sorties: readonly Obj[]): PhotoProjet | null {
  for (const d of sorties) {
    if (!estObj(d) || d.photo_projet === undefined) continue;
    const p = lirePhotoProjet(d.photo_projet);
    if (p) return p;
  }
  return null;
}

/**
 * Option `photo_client` du rendu (fondImage.ts). Aucun point de vue n'est transmis : la machine de rendu relit
 * elle-même la position et la direction dans la photo d'origine ; une direction absente n'est jamais devinée ici.
 */
export function optionPhotoClient(p: PhotoProjet): PhotoClientOption {
  return { chemin: p.chemin, octets: p.octets };
}

// ── Géométrie locale (mètres autour d'un point) ─────────────────────────────────────────────────────────────
type P2 = readonly [number, number];
function repere(o: { lon: number; lat: number }) {
  const kx = 111_320 * Math.cos(o.lat * Math.PI / 180), ky = 111_132;
  return (lon: number, lat: number): P2 => [(lon - o.lon) * kx, (lat - o.lat) * ky];
}

function anneauxExterieurs(g: unknown): number[][][] {
  if (!estObj(g)) return [];
  const ok = (a: unknown): a is number[][] => Array.isArray(a) && a.length >= 4 && a.every((c) => Array.isArray(c) && fini(c[0]) && fini(c[1]));
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && ok(g.coordinates[0])) return [g.coordinates[0]];
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    return (g.coordinates as unknown[]).flatMap((poly) => (Array.isArray(poly) && ok(poly[0]) ? [poly[0] as number[][]] : []));
  }
  return [];
}

function dansAnneau(p: P2, a: readonly P2[]): boolean {
  let dedans = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i]!, [xj, yj] = a[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** Distance (m) le long du rayon (origine, direction unitaire) jusqu'à la première arête de l'anneau ; null si aucune. */
function distanceRayon(d: P2, a: readonly P2[]): number | null {
  let mini: number | null = null;
  for (let i = 0; i < a.length - 1; i++) {
    const [x1, y1] = a[i]!, [x2, y2] = a[i + 1]!;
    const ex = x2 - x1, ey = y2 - y1;
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (x1 * ey - y1 * ex) / den;      // distance le long du rayon
    const u = (x1 * d[1] - y1 * d[0]) / den;   // position sur l'arête
    if (t > 0 && u >= 0 && u <= 1 && (mini === null || t < mini)) mini = t;
  }
  return mini;
}

/** La position de la photo est-elle dans le contour (WGS 84, anneau extérieur) de la parcelle ? */
export function pointDansContour(position: { lon: number; lat: number }, anneau: readonly (readonly [number, number])[]): boolean {
  const loc = repere(position);
  return anneau.length >= 3 && dansAnneau([0, 0], anneau.map(([lon, lat]) => loc(lon, lat)));
}

export interface ParcelleDeLaPhoto {
  readonly idu: string;
  readonly geometrie: unknown;
  readonly surfaceM2: number | null;
  readonly depuisTerrain: boolean;
  /** Comment la parcelle a été retrouvée (phrase lisible, datée par l'appelant). */
  readonly methode: string;
}

function iduDeFeature(props: unknown): string | null {
  if (!estObj(props)) return null;
  const brut = typeof props.idu === 'string' ? props.idu.replace(/\s/g, '').toUpperCase() : '';
  if (RE_IDU.test(brut)) return brut;
  const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().toUpperCase() : '');
  const insee = s(props.code_insee) || `${s(props.code_dep)}${s(props.code_com)}`;
  const section = s(props.section), numero = s(props.numero), prefixe = s(props.com_abs) || '000';
  const idu = `${insee}${prefixe.padStart(3, '0')}${section.padStart(2, '0')}${numero.padStart(4, '0')}`;
  return RE_IDU.test(idu) && section && numero ? idu : null;
}

/**
 * Parcelle photographiée, d'après la position (et la direction) lues dans la photo. Pur à partir de la réponse du
 * cadastre : `features` = parcelles API Carto autour du point. null + raison si rien n'est sûr.
 */
export function choisirParcelle(features: readonly unknown[], position: { lon: number; lat: number }, capDeg: number | null): { ok: true; parcelle: ParcelleDeLaPhoto } | { ok: false; raison: string } {
  const loc = repere(position);
  const parcelles = features.flatMap((f) => {
    if (!estObj(f)) return [];
    const idu = iduDeFeature(f.properties);
    const anneaux = anneauxExterieurs(f.geometry).map((a) => a.map(([lon, lat]) => loc(lon!, lat!)));
    if (!idu || !anneaux.length) return [];
    const surf = estObj(f.properties) && fini(f.properties.contenance) ? f.properties.contenance : null;
    return [{ idu, geometrie: f.geometry, anneaux, surf }];
  });
  if (!parcelles.length) return { ok: false, raison: 'aucune parcelle cadastrale autour de la position enregistrée dans la photo' };
  const contenant = parcelles.filter((p) => p.anneaux.some((a) => dansAnneau([0, 0], a)));
  if (contenant.length === 1) {
    const p = contenant[0]!;
    return { ok: true, parcelle: { idu: p.idu, geometrie: p.geometrie, surfaceM2: p.surf, depuisTerrain: true, methode: 'position enregistrée dans la photo (prise depuis la parcelle)' } };
  }
  if (capDeg === null) {
    return { ok: false, raison: 'la photo a été prise hors de toute parcelle (depuis la rue) et n’indique pas sa direction de prise de vue : la maison photographiée ne peut pas être déterminée' };
  }
  const r = capDeg * Math.PI / 180;
  const dir: P2 = [Math.sin(r), Math.cos(r)];
  const touchees = parcelles
    .map((p) => ({ p, d: p.anneaux.map((a) => distanceRayon(dir, a)).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null }))
    .filter((x): x is { p: typeof parcelles[number]; d: number } => x.d !== null && x.d <= PORTEE_VISEE_M)
    .sort((a, b) => a.d - b.d);
  if (!touchees.length) return { ok: false, raison: `aucune parcelle à moins de ${PORTEE_VISEE_M} m dans la direction de prise de vue enregistrée dans la photo` };
  const t = touchees[0]!;
  return { ok: true, parcelle: { idu: t.p.idu, geometrie: t.p.geometrie, surfaceM2: t.p.surf, depuisTerrain: false, methode: `position et direction de prise de vue enregistrées dans la photo (première parcelle visée, à ${Math.round(t.d)} m)` } };
}

/** Carré de recherche (GeoJSON WGS 84) de `rayonM` mètres autour du point. */
export function carreRecherche(position: { lon: number; lat: number }, rayonM = RAYON_RECHERCHE_M): { type: 'Polygon'; coordinates: number[][][] } {
  const dLat = rayonM / 111_132, dLon = rayonM / (111_320 * Math.max(0.01, Math.cos(position.lat * Math.PI / 180)));
  const a = (v: number) => Math.round(v * 1e7) / 1e7;
  const [O, E, S, N] = [a(position.lon - dLon), a(position.lon + dLon), a(position.lat - dLat), a(position.lat + dLat)];
  return { type: 'Polygon', coordinates: [[[O, S], [E, S], [E, N], [O, N], [O, S]]] };
}

/** Parcelle photographiée, lue au cadastre (API Carto IGN ; 2 tentatives). Ne lève jamais. */
export async function parcelleDepuisPhoto(position: { lon: number; lat: number }, capDeg: number | null, f: typeof fetch, attenteMs = 800): Promise<{ ok: true; parcelle: ParcelleDeLaPhoto } | { ok: false; raison: string }> {
  const url = new URL(URL_CADASTRE);
  url.searchParams.set('geom', JSON.stringify(carreRecherche(position)));
  url.searchParams.set('_limit', '200');
  let derniere = 'le cadastre (API Carto IGN) n’a pas répondu';
  for (let essai = 0; essai < 2; essai++) {
    if (essai) await new Promise((r) => setTimeout(r, attenteMs));
    try {
      const r = await f(url.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(DELAI_MS) });
      if (!r.ok) { derniere = `le cadastre (API Carto IGN) a refusé la demande (réponse ${r.status})`; continue; }
      const fc = await r.json();
      const feats = estObj(fc) && Array.isArray(fc.features) ? fc.features as unknown[] : null;
      if (!feats) return { ok: false, raison: 'réponse du cadastre illisible' };
      return choisirParcelle(feats, position, capDeg);
    } catch {
      derniere = 'le cadastre (API Carto IGN) n’a pas répondu';
    }
  }
  return { ok: false, raison: derniere };
}

// ── Réception de la photo du tour ───────────────────────────────────────────────────────────────────────────
export interface PhotoRecue {
  readonly photo: PhotoProjet | null;
  readonly exif: ExifPhotoClient | null;
  /** Pourquoi la photo n'a pas pu être gardée (phrase lisible) ; null si gardée. */
  readonly raison: string | null;
}

/** Lit la photo du tour (EXIF) et la dépose dans l'espace privé de l'utilisateur. Ne lève jamais. */
export async function recevoirPhoto(photo: PhotoDuTour, userId: string, depot: DepotPhotoProjet | null | undefined, date: string, idu: string | null): Promise<PhotoRecue> {
  const type = photo.mediaType === 'image/jpeg' || photo.mediaType === 'image/png' ? photo.mediaType : null;
  if (!type) return { photo: null, exif: null, raison: 'la photo doit être au format JPEG ou PNG pour servir de fond à l’image' };
  let octets: Uint8Array | null = null;
  try { octets = await photo.charger(); } catch { octets = null; }
  if (!octets || !octets.length) return { photo: null, exif: null, raison: 'la photo jointe n’a pas pu être relue' };
  if (octets.length > OCTETS_PHOTO_PROJET_MAX) return { photo: null, exif: null, raison: 'la photo dépasse 20 Mo' };
  let exif: ExifPhotoClient | null = null;
  try { exif = type === 'image/jpeg' ? lireExifPhoto(octets) : null; } catch { exif = null; }
  // LOT G9 : le site redresse la photo avant l'envoi ; une photo encore enregistrée « tournée » (envoyée autrement)
  // ne peut pas être placée (la machine de rendu ne prend en charge que l'orientation 1) : dit, pas gardée.
  if (exif && exif.orientation !== null && exif.orientation !== 1) {
    return { photo: null, exif, raison: 'la photo est enregistrée tournée (orientation de l’appareil) : renvoyez-la depuis le chat de Mimmoza, qui la redresse' };
  }
  if (!depot) return { photo: null, exif, raison: 'l’espace privé des photos n’est pas disponible' };
  let chemin: string | null = null;
  try { chemin = await depot.deposer(userId, octets, type); } catch { chemin = null; }
  if (!chemin || !RE_CHEMIN.test(chemin)) return { photo: null, exif, raison: 'la photo n’a pas pu être enregistrée dans votre espace privé' };
  return {
    exif, raison: null,
    photo: {
      v: 1, chemin, octets: octets.length, media_type: type, recue_le: date, nom: photo.nom ? photo.nom.slice(0, 120) : null,
      position: exif?.gps ? { lon: exif.gps.lon, lat: exif.gps.lat } : null,
      cap_deg: exif && exif.capDeg !== null && exif.capDeg >= 0 && exif.capDeg < 360 ? exif.capDeg : null,
      depuis_terrain: null, idu,
    },
  };
}

/** Lignes affichées sous la carte du parcours à propos de la photo du projet (sans nom interne). */
export function lignesPhotoProjet(p: PhotoProjet, nouvelle: boolean, parcelle: ParcelleDeLaPhoto | null): string[] {
  const l: string[] = [];
  if (nouvelle) l.push(`Votre photo${p.nom ? ` « ${p.nom} »` : ''} servira de fond à l’image de l’extension (conservée dans votre espace privé, utilisée seulement pour vos rendus ; visages et plaques ne sont pas floutés).`);
  if (parcelle) l.push(`Parcelle ${parcelle.idu} retrouvée d’après la ${parcelle.methode}. Si ce n’est pas votre maison, donnez-moi son adresse.`);
  if (p.depuis_terrain === true) l.push('Votre photo semble prise depuis votre terrain : « à gauche » et « à droite » s’entendent toujours vus depuis la rue. Si vous parliez de la gauche de la photo, corrigez le côté.');
  if (nouvelle && !p.position) l.push('La photo ne contient pas sa position : si l’extension ne peut pas être placée précisément dessus, je vous demanderai d’indiquer quelques points de la maison sur la photo.');
  return l;
}
