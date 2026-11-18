// src/lib/studio/heicVersJpeg.ts
//
// LOT G2 (17/11/2026) — photo HEIC (iPhone) → JPEG DANS LE NAVIGATEUR, avant l'envoi de la photo de la maison.
//
// La machine de rendu ne lit que JPEG et PNG, et ses EXIF lui sont indispensables : date et heure (lumière du soleil),
// focale (placement). Une conversion par canevas PERD les EXIF ; elle n'est donc faite qu'avec la recopie des EXIF
// d'origine du HEIC dans le JPEG produit (segment APP1), orientation ramenée à 1 (le décodage du navigateur a déjà
// redressé l'image). Rien n'est deviné : sans EXIF lisibles dans le HEIC, le JPEG part sans EXIF et c'est dit.
//
// Aucune bibliothèque : le décodage HEIC est celui du navigateur (Safari sur iPhone et Mac le sait ; Chrome et Firefox,
// non — un message clair le dit, avec le réglage iPhone « Le plus compatible »). Les bibliothèques HEIC du navigateur
// (libheif compilée) sont sous LGPL : écartées (licence non retenue pour Mimmoza).
// Sur iPhone, le sélecteur de fichiers du site n'accepte que JPEG et PNG : iOS convertit lui-même la photo en JPEG
// (EXIF conservés). Ce module sert aux HEIC choisis malgré tout (fichier copié sur un ordinateur, glisser-déposer).
//
// Parties PURES (testées) : reconnaissance du HEIC, extraction du bloc EXIF (boîtes ISO BMFF meta / iinf / iloc),
// orientation ramenée à 1, insertion du segment APP1 dans un JPEG. Partie navigateur : `convertirHeicEnJpeg`.

const TYPES_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

const quatre = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const uN = (b: Uint8Array, o: number, n: number): number => (n === 0 ? 0 : n === 2 ? u16(b, o) : n === 4 ? u32(b, o) : n === 8 ? u32(b, o) * 2 ** 32 + u32(b, o + 4) : Number.NaN);

/** Photo HEIC / HEIF ? (type déclaré, extension, ou CONTENU : boîte « ftyp » d'une marque HEIF). Pur. */
export function estHeic(octets: Uint8Array, type = '', nom = ''): boolean {
  if (octets.length >= 12 && quatre(octets, 4) === 'ftyp') {
    if (TYPES_HEIC.has(quatre(octets, 8))) return true;
    const taille = u32(octets, 0);
    for (let o = 16; o + 4 <= Math.min(taille, octets.length); o += 4) if (TYPES_HEIC.has(quatre(octets, o))) return true;
    return false;
  }
  return /^image\/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(nom);
}

interface Boite { readonly type: string; readonly debut: number; readonly contenu: number; readonly fin: number }

/** Boîtes ISO BMFF entre `debut` et `fin` (taille 0 = jusqu'à la fin, taille 1 = 64 bits). Pur, borné. */
function boites(b: Uint8Array, debut: number, fin: number): Boite[] {
  const out: Boite[] = [];
  let o = debut;
  while (o + 8 <= fin && out.length < 512) {
    let taille = u32(b, o);
    const type = quatre(b, o + 4);
    let entete = 8;
    if (taille === 1) {
      if (o + 16 > fin) break;
      taille = uN(b, o + 8, 8);
      entete = 16;
    } else if (taille === 0) taille = fin - o;
    if (!Number.isFinite(taille) || taille < entete || o + taille > fin) break;
    out.push({ type, debut: o, contenu: o + entete, fin: o + taille });
    o += taille;
  }
  return out;
}

/**
 * Bloc TIFF des EXIF d'un fichier HEIF (« II*\0 » ou « MM\0* » …), ou null s'il n'y en a pas ou s'il est illisible.
 * Chemin : meta → iinf (élément de type « Exif ») → iloc (position dans le fichier) ; l'élément commence par un
 * décalage 32 bits vers l'en-tête TIFF. Pur ; ne lève jamais.
 */
export function exifDuHeif(b: Uint8Array): Uint8Array | null {
  try {
    const meta = boites(b, 0, b.length).find((x) => x.type === 'meta');
    if (!meta) return null;
    const enfants = boites(b, meta.contenu + 4, meta.fin); // « meta » est une boîte pleine (version + drapeaux)
    const iinf = enfants.find((x) => x.type === 'iinf');
    const iloc = enfants.find((x) => x.type === 'iloc');
    if (!iinf || !iloc) return null;
    // iinf : version, puis nombre d'entrées (16 bits en version 0, sinon 32), puis des boîtes « infe ».
    const vInf = b[iinf.contenu]!;
    const premiere = iinf.contenu + 4 + (vInf === 0 ? 2 : 4);
    let idExif: number | null = null;
    for (const infe of boites(b, premiere, iinf.fin)) {
      if (infe.type !== 'infe') continue;
      const v = b[infe.contenu]!;
      if (v < 2) continue;
      let o = infe.contenu + 4;
      const id = v === 2 ? u16(b, o) : u32(b, o);
      o += v === 2 ? 2 : 4;
      o += 2; // item_protection_index
      if (quatre(b, o) === 'Exif') { idExif = id; break; }
    }
    if (idExif === null) return null;
    // iloc : tailles des champs en quartets, puis les éléments et leurs étendues.
    const v = b[iloc.contenu]!;
    let o = iloc.contenu + 4;
    const tOffset = b[o]! >> 4, tLongueur = b[o]! & 15, tBase = b[o + 1]! >> 4, tIndex = v === 1 || v === 2 ? b[o + 1]! & 15 : 0;
    o += 2;
    const nombre = v < 2 ? u16(b, o) : u32(b, o);
    o += v < 2 ? 2 : 4;
    for (let k = 0; k < nombre && o < iloc.fin; k += 1) {
      const id = v < 2 ? u16(b, o) : u32(b, o);
      o += v < 2 ? 2 : 4;
      const methode = v === 1 || v === 2 ? u16(b, o) & 15 : 0;
      if (v === 1 || v === 2) o += 2;
      o += 2; // data_reference_index
      const base = uN(b, o, tBase);
      o += tBase;
      const etendues = u16(b, o);
      o += 2;
      const morceaux: [number, number][] = [];
      for (let e = 0; e < etendues; e += 1) {
        o += tIndex;
        const dep = uN(b, o, tOffset);
        o += tOffset;
        const lg = uN(b, o, tLongueur);
        o += tLongueur;
        morceaux.push([base + dep, lg]);
      }
      if (id !== idExif) continue;
      if (methode !== 0 || morceaux.length === 0) return null; // données hors fichier (idat, autre élément) : non lues
      const total = morceaux.reduce((s, [, lg]) => s + lg, 0);
      if (!(total > 4) || total > 1 << 20) return null;
      const donnees = new Uint8Array(total);
      let p = 0;
      for (const [dep, lg] of morceaux) {
        if (dep + lg > b.length) return null;
        donnees.set(b.subarray(dep, dep + lg), p);
        p += lg;
      }
      const decalage = u32(donnees, 0);
      const tiff = donnees.subarray(4 + decalage);
      const ii = tiff[0] === 0x49 && tiff[1] === 0x49 && tiff[2] === 0x2a && tiff[3] === 0;
      const mm = tiff[0] === 0x4d && tiff[1] === 0x4d && tiff[2] === 0 && tiff[3] === 0x2a;
      return ii || mm ? new Uint8Array(tiff) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Copie du bloc TIFF avec l'orientation (balise 0x0112 de l'IFD0) ramenée à 1, si elle y est. Pur. */
export function avecOrientationNormale(tiff: Uint8Array): Uint8Array {
  const t = new Uint8Array(tiff);
  if (t.length < 8) return t;
  const le = t[0] === 0x49;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const ifd0 = dv.getUint32(4, le);
  if (ifd0 + 2 > t.length) return t;
  const n = dv.getUint16(ifd0, le);
  for (let k = 0; k < n; k += 1) {
    const e = ifd0 + 2 + k * 12;
    if (e + 12 > t.length) break;
    if (dv.getUint16(e, le) === 0x0112 && dv.getUint16(e + 2, le) === 3) dv.setUint16(e + 8, 1, le);
  }
  return t;
}

/**
 * JPEG avec le segment APP1 « Exif » donné (inséré juste après le marqueur SOI, après un éventuel APP0 « JFIF » ;
 * un APP1 Exif déjà présent est retiré). null si le JPEG est illisible ou le bloc trop grand pour un segment. Pur.
 */
export function jpegAvecExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  const longueur = 2 + 6 + tiff.length;
  if (longueur > 0xffff) return null;
  const app1 = new Uint8Array(2 + longueur);
  app1.set([0xff, 0xe1, longueur >> 8, longueur & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(tiff, 10);
  // Segments d'en-tête jusqu'au premier qui n'est ni APP0 ni APP1 Exif.
  let i = 2;
  let apresApp0 = 2;
  const retires: [number, number][] = [];
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const m = jpeg[i + 1]!;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) break;
    const lg = u16(jpeg, i + 2);
    if (lg < 2 || i + 2 + lg > jpeg.length) return null;
    if (m === 0xe0 && i === apresApp0) apresApp0 = i + 2 + lg;
    if (m === 0xe1 && quatre(jpeg, i + 4) === 'Exif') retires.push([i, i + 2 + lg]);
    i += 2 + lg;
  }
  const morceaux: Uint8Array[] = [jpeg.subarray(0, apresApp0), app1];
  let o = apresApp0;
  for (const [a, z] of retires) {
    if (a < o) continue;
    morceaux.push(jpeg.subarray(o, a));
    o = z;
  }
  morceaux.push(jpeg.subarray(o));
  const out = new Uint8Array(morceaux.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of morceaux) { out.set(x, p); p += x.length; }
  return out;
}

export const MESSAGE_HEIC_ILLISIBLE = 'Ce navigateur ne sait pas lire les photos HEIC. Sur iPhone : Réglages › Appareil photo › Formats › « Le plus compatible », puis reprenez la photo ; ou envoyez-la directement depuis l’iPhone (elle est alors convertie en JPEG).';

export type ConversionHeic =
  | { readonly ok: true; readonly fichier: File; readonly exifConserve: boolean; readonly note: string }
  | { readonly ok: false; readonly raison: string };

/**
 * HEIC → JPEG (qualité 0,92) dans le navigateur, EXIF d'origine recopiés (orientation 1). Navigateur seulement ;
 * ne lève jamais. ÉCRIT, NON VU (aucun navigateur dans le lot) ; les parties pures sont testées.
 */
export async function convertirHeicEnJpeg(fichier: File): Promise<ConversionHeic> {
  try {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    let image: ImageBitmap;
    try {
      image = await createImageBitmap(fichier);
    } catch {
      return { ok: false, raison: MESSAGE_HEIC_ILLISIBLE };
    }
    const toile = document.createElement('canvas');
    toile.width = image.width;
    toile.height = image.height;
    const g = toile.getContext('2d');
    if (!g) return { ok: false, raison: MESSAGE_HEIC_ILLISIBLE };
    g.drawImage(image, 0, 0);
    image.close?.();
    const blob = await new Promise<Blob | null>((ok) => toile.toBlob(ok, 'image/jpeg', 0.92));
    if (!blob) return { ok: false, raison: MESSAGE_HEIC_ILLISIBLE };
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const tiff = exifDuHeif(octets);
    const avec = tiff ? jpegAvecExif(jpeg, avecOrientationNormale(tiff)) : null;
    const nom = fichier.name.replace(/\.hei[cf]$/i, '') + '.jpg';
    return {
      ok: true,
      fichier: new File([new Uint8Array(avec ?? jpeg)], nom, { type: 'image/jpeg', lastModified: fichier.lastModified }),
      exifConserve: !!avec,
      note: avec
        ? 'Photo HEIC convertie en JPEG sur votre appareil ; ses informations de prise de vue (date, focale, position) sont conservées.'
        : 'Photo HEIC convertie en JPEG sur votre appareil, mais ses informations de prise de vue n’ont pas pu être relues : la date et la focale manqueront.',
    };
  } catch {
    return { ok: false, raison: MESSAGE_HEIC_ILLISIBLE };
  }
}
