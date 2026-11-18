// LOT G9 (18/11/2026) — photo de téléphone jointe au chat : parties pures (EXIF d'un JPEG, orientation, dimensions EXIF,
// décision tel quel / réencodé, tailles successives, phrase de la pastille). JPEG construits ici, octet par octet.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COTE_MAX_CHAT_PX, COTE_MIN_PX, cotesSuccessifs, decisionPhoto, dimensionsReduites, exifDuJpeg, exifPourCopie, notePhotoPreparee,
  OCTETS_MAX_CALAGE, OCTETS_MAX_CHAT, orientationTiff, QUALITES_CALAGE, QUALITES_CHAT,
} from './photoTelephone.ts';
import { jpegAvecExif } from './heicVersJpeg.ts';
import { lireExifPhoto } from './photoClientLogique.ts';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
const Mo = 1024 * 1024;

/**
 * TIFF « II » : IFD0 { Orientation, pointeur Exif } ; IFD Exif { FocalLengthIn35mmFilm 26, PixelXDimension 4032 (LONG),
 * PixelYDimension 3024 (SHORT) } ; puis un IFD GPS minimal (latitude N 48°) pour vérifier qu'il est recopié.
 */
function tiffEssai(orientation: number): number[] {
  // En-tête 8 ; IFD0 à 8 : 2 + 3×12 + 4 = 42 → IFD Exif à 50 : 2 + 3×12 + 4 = 42 → IFD GPS à 92 : 2 + 2×12 + 4 = 30 → données à 122.
  const ifd0 = [...le16(3),
    ...le16(0x0112), ...le16(3), ...le32(1), ...le16(orientation), 0, 0,
    ...le16(0x8769), ...le16(4), ...le32(1), ...le32(50),
    ...le16(0x8825), ...le16(4), ...le32(1), ...le32(92),
    ...le32(0)];
  const ifdExif = [...le16(3),
    ...le16(0xa002), ...le16(4), ...le32(1), ...le32(4032),
    ...le16(0xa003), ...le16(3), ...le32(1), ...le16(3024), 0, 0,
    ...le16(0xa405), ...le16(3), ...le32(1), ...le16(26), 0, 0,
    ...le32(0)];
  const ifdGps = [...le16(2),
    ...le16(0x0001), ...le16(2), ...le32(2), ...ascii('N'), 0, 0, 0,
    ...le16(0x0002), ...le16(5), ...le32(3), ...le32(122),
    ...le32(0)];
  const lat = [...le32(48), ...le32(1), ...le32(30), ...le32(1), ...le32(0), ...le32(1)];
  return [0x49, 0x49, 0x2a, 0, ...le32(8), ...ifd0, ...ifdExif, ...ifdGps, ...lat];
}

/** JPEG minimal : SOI, APP0 JFIF, [APP1 Exif], SOS, EOI (le contenu image n'est pas décodé par ces tests). */
function jpegEssai(tiff: number[] | null): Uint8Array {
  const app0 = [0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const app1 = tiff ? [0xff, 0xe1, ...be16(2 + 6 + tiff.length), ...ascii('Exif'), 0, 0, ...tiff] : [];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, 0xff, 0xda, ...be16(2), 0x11, 0x22, 0xff, 0xd9]);
}

const lireDimsExif = (tiff: Uint8Array): { x: number; y: number } => {
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  // IFD Exif à 50 ; entrées 0 (0xA002, LONG) et 1 (0xA003, SHORT)
  return { x: dv.getUint32(50 + 2 + 8, true), y: dv.getUint16(50 + 2 + 12 + 8, true) };
};

test('G9-1 : bloc EXIF d’un JPEG relu (et absent → null) ; orientation lue', () => {
  const t = exifDuJpeg(jpegEssai(tiffEssai(6)));
  assert.ok(t);
  assert.equal(orientationTiff(t), 6);
  assert.equal(exifDuJpeg(jpegEssai(null)), null);
  assert.equal(orientationTiff(null), null);
  assert.equal(exifDuJpeg(new Uint8Array([1, 2, 3, 4])), null, 'pas un JPEG');
});

test('G9-2 : copie EXIF : orientation 1, dimensions mises à jour, GPS et focale gardés ; original intact', () => {
  const tiff = new Uint8Array(tiffEssai(6));
  const copie = exifPourCopie(tiff, 4096, 3072);
  assert.equal(orientationTiff(copie), 1);
  assert.deepEqual(lireDimsExif(copie), { x: 4096, y: 3072 });
  assert.equal(orientationTiff(tiff), 6, 'le bloc d’origine n’est pas modifié');
  assert.deepEqual(lireDimsExif(tiff), { x: 4032, y: 3024 });
  // Valeur qui ne tient pas dans un SHORT : laissée telle quelle (rien d'inventé).
  assert.deepEqual(lireDimsExif(exifPourCopie(tiff, 4096, 70000)), { x: 4096, y: 3024 });
  // Réinséré dans un JPEG : relu par le lecteur EXIF du site (même lecteur que le serveur) : position et focale gardées.
  const jpeg = jpegAvecExif(jpegEssai(null), copie);
  assert.ok(jpeg);
  const exif = lireExifPhoto(jpeg!.buffer.slice(jpeg!.byteOffset, jpeg!.byteOffset + jpeg!.byteLength) as ArrayBuffer);
  assert.equal(exif.orientation, 1);
  assert.equal(exif.focale35mm, 26);
});

test('G9-3 : décision : photo droite ≤ 5 Mo telle quelle ; > 5 Mo réduite pour le chat, original gardé ; tournée redressée', () => {
  assert.deepEqual(decisionPhoto({ type: 'image/jpeg', octets: 3 * Mo, orientation: 1 }), { chat: 'tel_quel', calage: 'tel_quel', photoProjet: true, raisons: [] });
  assert.deepEqual(decisionPhoto({ type: 'image/jpeg', octets: 3 * Mo, orientation: null }).chat, 'tel_quel', 'sans EXIF : rien à redresser');
  const grosse = decisionPhoto({ type: 'image/jpeg', octets: 9 * Mo, orientation: 1 });
  assert.equal(grosse.chat, 'reencoder');
  assert.equal(grosse.calage, 'tel_quel', 'original droit ≤ 20 Mo gardé tel quel pour le placement');
  const tournee = decisionPhoto({ type: 'image/jpeg', octets: 3 * Mo, orientation: 6 });
  assert.equal(tournee.chat, 'reencoder');
  assert.equal(tournee.calage, 'reencoder');
  const enorme = decisionPhoto({ type: 'image/png', octets: OCTETS_MAX_CALAGE + 1, orientation: null });
  assert.equal(enorme.calage, 'reencoder');
  assert.equal(enorme.chat, 'reencoder');
  assert.equal(decisionPhoto({ type: 'image/webp', octets: 9 * Mo, orientation: null }).photoProjet, false, 'WebP : simple pièce jointe');
  assert.equal(decisionPhoto({ type: 'image/webp', octets: 9 * Mo, orientation: null }).chat, 'tel_quel', 'refus laissé à modeEnvoi');
});

test('G9-4 : tailles : côté long ≤ 4096 px au départ, puis ×0,85, jamais sous le minimum ; qualités ≥ 0,9', () => {
  assert.deepEqual(dimensionsReduites(4032, 3024, 4096), { largeur: 4032, hauteur: 3024 }, 'jamais agrandie');
  assert.deepEqual(dimensionsReduites(8000, 6000, 4096), { largeur: 4096, hauteur: 3072 });
  assert.deepEqual(dimensionsReduites(3000, 8000, 4096), { largeur: 1536, hauteur: 4096 });
  const c = cotesSuccessifs(8000, COTE_MAX_CHAT_PX);
  assert.equal(c[0], 4096);
  assert.ok(c.every((x, i) => i === 0 || x < c[i - 1]!));
  assert.equal(c[c.length - 1], COTE_MIN_PX);
  assert.deepEqual(cotesSuccessifs(1000, COTE_MAX_CHAT_PX), [1000], 'petite image : un seul essai, à sa taille');
  assert.equal(cotesSuccessifs(6000, Number.POSITIVE_INFINITY)[0], 6000, 'copie pour le placement : pleine résolution d’abord');
  assert.ok(QUALITES_CHAT.every((q) => q >= 0.9) && QUALITES_CALAGE.every((q) => q >= 0.9));
  assert.equal(OCTETS_MAX_CHAT, 5 * Mo);
});

test('G9-5 : phrase de la pastille, sans jargon', () => {
  assert.equal(notePhotoPreparee({ heic: false, exifConserve: true, redressee: false, chat: null, originalGarde: false }), '');
  assert.equal(
    notePhotoPreparee({ heic: true, exifConserve: true, redressee: false, chat: { octets: 3.8 * Mo, largeur: 4096, hauteur: 3072 }, originalGarde: true }),
    'Photo convertie de HEIC en JPEG, réduite à 4096 px (3,8 Mo), original gardé pour placer l’extension',
  );
  assert.equal(notePhotoPreparee({ heic: false, exifConserve: true, redressee: true, chat: null, originalGarde: false }), 'Photo redressée');
  assert.match(notePhotoPreparee({ heic: false, exifConserve: false, redressee: true, chat: null, originalGarde: false }), /informations de prise de vue absentes/);
});
