// src/lib/studio/photoTelephone.ts
//
// LOT G9 (18/11/2026) — une photo de téléphone ORDINAIRE jointe au chat (« j'envoie la photo de ma maison ») doit
// passer, quelle que soit sa taille, son format ou son orientation.
//
// Constat (lot G3) : le chat refusait les images de plus de 5 Mo (limite de l'API du modèle pour une image), ne lisait
// pas le HEIC, et une photo enregistrée « tournée » (balise EXIF Orientation ≠ 1, fréquent sur téléphone) n'était pas
// redressée : l'aperçu du navigateur la montre droite, mais la machine de rendu ne prend en charge que l'orientation 1
// (worker/src/photoClient.ts) — le placement aurait été fait sur une image couchée.
//
// Ce module prépare DANS LE NAVIGATEUR, avant l'envoi :
//   · la copie POUR LE CHAT : JPEG, côté long ≤ 4096 px, ≤ 5 Mo, qualité ≥ 0,9 ; redressée (orientation 1) ;
//     EXIF utiles d'origine RECOPIÉS (position GPS, direction, focale, date) — seule l'orientation est ramenée à 1
//     et les dimensions EXIF mises à jour. Une photo déjà ≤ 5 Mo et droite part TELLE QUELLE (aucune recompression) ;
//   · la copie POUR LE PLACEMENT (calage) : l'ORIGINAL tel quel s'il est droit et ≤ 20 Mo (plafond de la photo du
//     projet) ; sinon l'original redressé en pleine résolution (qualité 0,95), réduit seulement s'il dépasse 20 Mo.
//     Envoyée à part (référence `originalPath` de la pièce jointe) seulement si elle diffère de la copie du chat.
// HEIC : conversion par heicVersJpeg.ts (lot G2, EXIF recopiés), puis même traitement.
//
// Parties PURES (testées, photoTelephone.test.ts) : lecture du bloc EXIF d'un JPEG, orientation, mise à jour des
// dimensions EXIF, décision (tel quel / recompresser / redresser / réduire), tailles successives. Partie navigateur :
// `preparerPhotoTelephone` (canevas) — ÉCRITE, NON VUE dans un navigateur.

import { avecOrientationNormale, convertirHeicEnJpeg, estHeic, jpegAvecExif } from './heicVersJpeg.ts';

/** Limite de l'API du modèle pour une image (= TAILLE_MAX_IMAGE de piecesJointesLogique.ts). */
export const OCTETS_MAX_CHAT = 5 * 1024 * 1024;
/** Côté long maximal de la copie envoyée au chat. */
export const COTE_MAX_CHAT_PX = 4096;
/** Plafond de la photo du projet (= OCTETS_PHOTO_PROJET_MAX de photo-projet.ts et OCTETS_PHOTO_MAX de fondImage.ts). */
export const OCTETS_MAX_CALAGE = 20 * 1024 * 1024;
/** Qualités JPEG essayées, de la meilleure à la plus basse admise (jamais sous 0,9). */
export const QUALITES_CHAT: readonly number[] = [0.92, 0.9];
export const QUALITES_CALAGE: readonly number[] = [0.95, 0.92, 0.9];
/** Réduction du côté long à chaque essai quand la qualité minimale ne suffit pas. */
export const FACTEUR_REDUCTION = 0.85;
/** En dessous, la photo n'est plus utile au placement : refus dit plutôt qu'une image floue. */
export const COTE_MIN_PX = 1280;

const quatre = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;

/** Bloc TIFF du segment APP1 « Exif » d'un JPEG (copie), ou null. Pur ; ne lève jamais. */
export function exifDuJpeg(jpeg: Uint8Array): Uint8Array | null {
  try {
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
      const m = jpeg[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m === 0xda || m === 0xd9) return null;
      const lg = u16be(jpeg, i + 2);
      if (lg < 2 || i + 2 + lg > jpeg.length) return null;
      if (m === 0xe1 && lg >= 8 && quatre(jpeg, i + 4) === 'Exif' && jpeg[i + 8] === 0 && jpeg[i + 9] === 0) {
        const tiff = jpeg.slice(i + 10, i + 2 + lg);
        const ii = tiff[0] === 0x49 && tiff[1] === 0x49, mm = tiff[0] === 0x4d && tiff[1] === 0x4d;
        return (ii || mm) && tiff.length >= 8 ? tiff : null;
      }
      i += 2 + lg;
    }
    return null;
  } catch {
    return null;
  }
}

interface Entree { readonly pos: number; readonly type: number; readonly nombre: number }

/** Entrées d'un IFD (bornées). Pur. */
function entreesIfd(dv: DataView, le: boolean, ifd: number): Map<number, Entree> {
  const out = new Map<number, Entree>();
  if (ifd < 8 || ifd + 2 > dv.byteLength) return out;
  const n = dv.getUint16(ifd, le);
  for (let k = 0; k < Math.min(n, 512); k += 1) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > dv.byteLength) break;
    out.set(dv.getUint16(e, le), { pos: e, type: dv.getUint16(e + 2, le), nombre: dv.getUint32(e + 4, le) });
  }
  return out;
}

/** Orientation EXIF (balise 0x0112 de l'IFD0, 1 à 8) ; null si absente ou illisible. Pur. */
export function orientationTiff(tiff: Uint8Array | null): number | null {
  try {
    if (!tiff || tiff.length < 8) return null;
    const le = tiff[0] === 0x49;
    const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const e = entreesIfd(dv, le, dv.getUint32(4, le)).get(0x0112);
    if (!e || e.type !== 3) return null;
    const v = dv.getUint16(e.pos + 8, le);
    return v >= 1 && v <= 8 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Copie du bloc TIFF avec l'orientation ramenée à 1 et les dimensions de l'image (PixelXDimension 0xA002,
 * PixelYDimension 0xA003 de l'IFD Exif ; ImageWidth 0x0100, ImageLength 0x0101 de l'IFD0) mises à jour, quand ces
 * balises existent (rien n'est ajouté). Une valeur qui ne tient pas dans son type est laissée telle quelle. Pur.
 */
export function exifPourCopie(tiff: Uint8Array, largeur: number, hauteur: number): Uint8Array {
  const t = avecOrientationNormale(tiff);
  try {
    const le = t[0] === 0x49;
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const ifd0 = entreesIfd(dv, le, dv.getUint32(4, le));
    const poser = (e: Entree | undefined, v: number) => {
      if (!e || e.nombre !== 1) return;
      if (e.type === 3 && v <= 0xffff) dv.setUint16(e.pos + 8, v, le);
      else if (e.type === 4) dv.setUint32(e.pos + 8, v, le);
    };
    poser(ifd0.get(0x0100), largeur);
    poser(ifd0.get(0x0101), hauteur);
    const pointeur = ifd0.get(0x8769);
    if (pointeur && pointeur.type === 4) {
      const exif = entreesIfd(dv, le, dv.getUint32(pointeur.pos + 8, le));
      poser(exif.get(0xa002), largeur);
      poser(exif.get(0xa003), hauteur);
    }
  } catch { /* bloc illisible : copie avec la seule orientation normalisée */ }
  return t;
}

/** Dimensions après réduction du côté long à `coteMax` (jamais agrandies), arrondies au pixel. Pur. */
export function dimensionsReduites(largeur: number, hauteur: number, coteMax: number): { largeur: number; hauteur: number } {
  const long = Math.max(largeur, hauteur);
  if (!(long > coteMax)) return { largeur, hauteur };
  const k = coteMax / long;
  return { largeur: Math.max(1, Math.round(largeur * k)), hauteur: Math.max(1, Math.round(hauteur * k)) };
}

/**
 * Côtés longs successifs à essayer : d'abord min(côté long, coteMax), puis ×0,85 à chaque fois, jamais sous
 * COTE_MIN_PX (le dernier essai est COTE_MIN_PX si la photo est plus grande). Pur.
 */
export function cotesSuccessifs(coteLong: number, coteMax: number, coteMin = COTE_MIN_PX): number[] {
  const depart = Math.round(Math.min(coteLong, coteMax));
  const out = [depart];
  let c = depart;
  while (c > coteMin) {
    c = Math.max(coteMin, Math.round(c * FACTEUR_REDUCTION));
    if (c >= out[out.length - 1]!) break;
    out.push(c);
  }
  return out;
}

export type DecisionCopie = 'tel_quel' | 'reencoder';

export interface DecisionPhoto {
  /** Copie envoyée au chat (et lue par le modèle). */
  readonly chat: DecisionCopie;
  /** Copie gardée pour le placement : l'original tel quel, ou réencodé (redressé, et réduit seulement au-delà de 20 Mo). */
  readonly calage: DecisionCopie;
  /** Photo exploitable comme photo du projet (JPEG ou PNG) ; GIF / WebP restent de simples pièces jointes. */
  readonly photoProjet: boolean;
  /** Ce qui sera fait, en clair (vide si rien). */
  readonly raisons: readonly string[];
}

/** Que faire de cette photo ? (type APRÈS une éventuelle conversion HEIC → JPEG). Pur. */
export function decisionPhoto(e: { readonly type: string; readonly octets: number; readonly orientation: number | null }): DecisionPhoto {
  const photoProjet = e.type === 'image/jpeg' || e.type === 'image/png';
  if (!photoProjet) return { chat: 'tel_quel', calage: 'tel_quel', photoProjet, raisons: [] };
  const tournee = e.orientation !== null && e.orientation !== 1;
  const raisons: string[] = [];
  if (tournee) raisons.push('photo enregistrée tournée : redressée');
  if (e.octets > OCTETS_MAX_CHAT) raisons.push('photo de plus de 5 Mo : réduite pour l’envoi');
  const chat: DecisionCopie = tournee || e.octets > OCTETS_MAX_CHAT ? 'reencoder' : 'tel_quel';
  const calage: DecisionCopie = tournee || e.octets > OCTETS_MAX_CALAGE ? 'reencoder' : 'tel_quel';
  return { chat, calage, photoProjet, raisons };
}

const mo = (o: number) => `${(o / 1048576).toFixed(1).replace('.', ',')} Mo`;

/** Phrase de la pastille de la pièce jointe (sans jargon). Pur. */
export function notePhotoPreparee(p: {
  readonly heic: boolean; readonly exifConserve: boolean; readonly redressee: boolean;
  readonly chat: { readonly octets: number; readonly largeur: number; readonly hauteur: number } | null;
  readonly originalGarde: boolean;
}): string {
  const m: string[] = [];
  if (p.heic) m.push('convertie de HEIC en JPEG');
  if (p.redressee) m.push('redressée');
  if (p.chat) m.push(`réduite à ${Math.max(p.chat.largeur, p.chat.hauteur)} px (${mo(p.chat.octets)})`);
  if (p.originalGarde) m.push('original gardé pour placer l’extension');
  if ((p.heic || p.chat || p.redressee) && !p.exifConserve) m.push('informations de prise de vue absentes');
  return m.length ? `Photo ${m.join(', ')}` : '';
}

// ── Navigateur ──────────────────────────────────────────────────────────────────────────────────────────────

export type PhotoTelephone =
  | {
    readonly ok: true;
    /** Copie envoyée au chat (≤ 5 Mo pour une photo du projet). */
    readonly pourChat: File;
    /** Copie pour le placement ; null si identique à pourChat (rien à envoyer en plus). */
    readonly pourCalage: File | null;
    /** Phrase de la pastille ; '' si la photo part telle quelle. */
    readonly note: string;
  }
  | { readonly ok: false; readonly raison: string };

const nomJpeg = (nom: string) => nom.replace(/\.(hei[cf]|png|jpe?g)$/i, '') + '.jpg';

async function decoder(f: Blob): Promise<ImageBitmap> {
  // `from-image` : le navigateur applique l'orientation EXIF au décodage (image redressée).
  try { return await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch { return await createImageBitmap(f); }
}

async function encoder(image: ImageBitmap, largeur: number, hauteur: number, qualite: number): Promise<Uint8Array | null> {
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  const g = toile.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(image, 0, 0, largeur, hauteur);
  const blob = await new Promise<Blob | null>((ok) => toile.toBlob(ok, 'image/jpeg', qualite));
  toile.width = 0; toile.height = 0; // libère la mémoire tout de suite (grosses photos sur téléphone)
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Première copie JPEG (EXIF recopiés) qui tient dans `octetsMax`, en réduisant si besoin ; null si aucune. */
async function copieSousPlafond(image: ImageBitmap, tiff: Uint8Array | null, coteMax: number, octetsMax: number, qualites: readonly number[]):
  Promise<{ octets: Uint8Array; largeur: number; hauteur: number; exif: boolean } | null> {
  for (const cote of cotesSuccessifs(Math.max(image.width, image.height), coteMax)) {
    const d = dimensionsReduites(image.width, image.height, cote);
    for (const q of qualites) {
      const jpeg = await encoder(image, d.largeur, d.hauteur, q);
      if (!jpeg) return null;
      const avec = tiff ? jpegAvecExif(jpeg, exifPourCopie(tiff, d.largeur, d.hauteur)) : null;
      const octets = avec ?? jpeg;
      if (octets.length <= octetsMax) return { octets, largeur: d.largeur, hauteur: d.hauteur, exif: !!avec };
    }
  }
  return null;
}

export const MESSAGE_PHOTO_ILLISIBLE = 'Cette photo n’a pas pu être lue par le navigateur. Envoyez-la en JPEG (sur iPhone : Réglages › Appareil photo › Formats › « Le plus compatible »).';

/**
 * Prépare une image choisie pour le chat. Ne lève jamais. Les images qui n'ont besoin de rien (JPEG/PNG droits
 * ≤ 5 Mo, GIF, WebP) sont rendues telles quelles, sans décodage. ÉCRIT, NON VU dans un navigateur.
 */
export async function preparerPhotoTelephone(fichier: File): Promise<PhotoTelephone> {
  try {
    let base = fichier;
    let heic = false;
    let exifConserve = true;
    const tete = new Uint8Array(await fichier.slice(0, 64).arrayBuffer());
    if (estHeic(tete, fichier.type, fichier.name)) {
      const c = await convertirHeicEnJpeg(fichier);
      if (!c.ok) return { ok: false, raison: c.raison };
      base = c.fichier;
      heic = true;
      exifConserve = c.exifConserve;
    }
    const octets = new Uint8Array(await base.arrayBuffer());
    const tiff = base.type === 'image/jpeg' ? exifDuJpeg(octets) : null;
    const d = decisionPhoto({ type: base.type, octets: base.size, orientation: orientationTiff(tiff) });
    if (d.chat === 'tel_quel' && d.calage === 'tel_quel') {
      return { ok: true, pourChat: base, pourCalage: null, note: notePhotoPreparee({ heic, exifConserve, redressee: false, chat: null, originalGarde: false }) };
    }
    const image = await decoder(base).catch(() => null);
    if (!image) return { ok: false, raison: MESSAGE_PHOTO_ILLISIBLE };
    try {
      const redressee = d.raisons.some((r) => r.startsWith('photo enregistrée tournée'));
      let pourChat = base;
      let chatInfo: { octets: number; largeur: number; hauteur: number } | null = null;
      if (d.chat === 'reencoder') {
        const c = await copieSousPlafond(image, tiff, COTE_MAX_CHAT_PX, OCTETS_MAX_CHAT, QUALITES_CHAT);
        if (!c) return { ok: false, raison: 'Cette photo est trop lourde même réduite : envoyez une photo de moins de 5 Mo.' };
        pourChat = new File([new Uint8Array(c.octets)], nomJpeg(base.name), { type: 'image/jpeg', lastModified: fichier.lastModified });
        chatInfo = c.largeur === image.width && c.hauteur === image.height && base.size <= OCTETS_MAX_CHAT ? null : { octets: c.octets.length, largeur: c.largeur, hauteur: c.hauteur };
        if (tiff && !c.exif) exifConserve = false;
        if (!tiff && base.type === 'image/jpeg') exifConserve = false;
      }
      let pourCalage: File | null = null;
      const chatPleineResolution = d.chat === 'reencoder' && chatInfo === null;
      if (d.calage === 'reencoder' && !chatPleineResolution) {
        const c = await copieSousPlafond(image, tiff, Number.POSITIVE_INFINITY, OCTETS_MAX_CALAGE, QUALITES_CALAGE);
        if (c) pourCalage = new File([new Uint8Array(c.octets)], `original-${nomJpeg(base.name)}`, { type: 'image/jpeg', lastModified: fichier.lastModified });
      } else if (d.calage === 'tel_quel' && d.chat === 'reencoder') {
        pourCalage = base; // original droit ≤ 20 Mo : gardé tel quel pour le placement
      }
      return {
        ok: true, pourChat, pourCalage,
        note: notePhotoPreparee({ heic, exifConserve, redressee, chat: chatInfo, originalGarde: pourCalage !== null }),
      };
    } finally {
      image.close?.();
    }
  } catch {
    return { ok: false, raison: MESSAGE_PHOTO_ILLISIBLE };
  }
}

/**
 * Copie POUR LE PLACEMENT seulement (carte « Votre photo du trottoir » / « Envoyer une photo de ma maison ») : HEIC
 * converti, photo tournée redressée en pleine résolution, réduite seulement au-delà de 20 Mo ; sinon le fichier
 * d'origine, tel quel. Ne lève jamais. ÉCRIT, NON VU dans un navigateur.
 */
export async function preparerPhotoPourCalage(fichier: File): Promise<{ readonly ok: true; readonly fichier: File; readonly note: string } | { readonly ok: false; readonly raison: string }> {
  try {
    let base = fichier;
    let heic = false;
    let exifConserve = true;
    const tete = new Uint8Array(await fichier.slice(0, 64).arrayBuffer());
    if (estHeic(tete, fichier.type, fichier.name)) {
      const c = await convertirHeicEnJpeg(fichier);
      if (!c.ok) return { ok: false, raison: c.raison };
      base = c.fichier;
      heic = true;
      exifConserve = c.exifConserve;
    }
    const tiff = base.type === 'image/jpeg' ? exifDuJpeg(new Uint8Array(await base.arrayBuffer())) : null;
    const d = decisionPhoto({ type: base.type, octets: base.size, orientation: orientationTiff(tiff) });
    if (d.calage === 'tel_quel') return { ok: true, fichier: base, note: notePhotoPreparee({ heic, exifConserve, redressee: false, chat: null, originalGarde: false }) };
    const image = await decoder(base).catch(() => null);
    if (!image) return { ok: false, raison: MESSAGE_PHOTO_ILLISIBLE };
    try {
      const c = await copieSousPlafond(image, tiff, Number.POSITIVE_INFINITY, OCTETS_MAX_CALAGE, QUALITES_CALAGE);
      if (!c) return { ok: false, raison: 'Cette photo est trop lourde : envoyez une photo de moins de 20 Mo.' };
      const reduite = c.largeur !== image.width || c.hauteur !== image.height;
      return {
        ok: true,
        fichier: new File([new Uint8Array(c.octets)], nomJpeg(base.name), { type: 'image/jpeg', lastModified: fichier.lastModified }),
        note: notePhotoPreparee({
          heic, exifConserve: exifConserve && (!tiff || c.exif), redressee: d.raisons.some((r) => r.startsWith('photo enregistrée tournée')),
          chat: reduite ? { octets: c.octets.length, largeur: c.largeur, hauteur: c.hauteur } : null, originalGarde: false,
        }),
      };
    } finally {
      image.close?.();
    }
  } catch {
    return { ok: false, raison: MESSAGE_PHOTO_ILLISIBLE };
  }
}
