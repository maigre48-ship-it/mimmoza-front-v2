// LOT G2 (17/11/2026) — HEIC → JPEG dans le navigateur : parties pures (reconnaissance, EXIF du HEIF, orientation,
// insertion APP1). Fichiers construits ici, octet par octet (aucune photo réelle : pas de HEIC d'iPhone dans le lot).
import assert from 'node:assert/strict';
import test from 'node:test';
import { avecOrientationNormale, estHeic, exifDuHeif, jpegAvecExif } from './heicVersJpeg.ts';
import { lireExifPhoto } from './photoClientLogique.ts';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const boite = (type: string, corps: number[]): number[] => [...be32(8 + corps.length), ...ascii(type), ...corps];

/** TIFF « II » : IFD0 { Orientation 6, pointeur Exif } ; IFD Exif { DateTimeOriginal, FocalLengthIn35mmFilm 26 }. */
function tiffEssai(): number[] {
  const date = [...ascii('2026:11:17 14:00:00'), 0]; // 20 octets
  // En-tête (8) + IFD0 (2 + 2×12 + 4 = 30) → IFD Exif à 38 : 2 + 2×12 + 4 = 30 → données à 68.
  const ifd0 = [...le16(2), ...le16(0x0112), ...le16(3), ...le32(1), ...le16(6), 0, 0, ...le16(0x8769), ...le16(4), ...le32(1), ...le32(38), ...le32(0)];
  const ifdExif = [...le16(2), ...le16(0x9003), ...le16(2), ...le32(20), ...le32(68), ...le16(0xa405), ...le16(3), ...le32(1), ...le16(26), 0, 0, ...le32(0)];
  return [0x49, 0x49, 0x2a, 0, ...le32(8), ...ifd0, ...ifdExif, ...date];
}

/** HEIF minimal : ftyp heic, meta { iinf (1 élément « Exif »), iloc v0 (décalage 4, longueur 4) }, mdat. */
function heifEssai(): Uint8Array {
  const tiff = tiffEssai();
  const donnees = [...be32(6), ...ascii('Exif'), 0, 0, ...tiff];
  const ftyp = boite('ftyp', [...ascii('heic'), ...be32(0), ...ascii('mif1'), ...ascii('heic')]);
  const infe = boite('infe', [2, 0, 0, 0, ...be16(1), ...be16(0), ...ascii('Exif'), 0]);
  const iinf = boite('iinf', [0, 0, 0, 0, ...be16(1), ...infe]);
  const ilocCorps = (decalage: number): number[] => [0, 0, 0, 0, 0x44, 0x00, ...be16(1), ...be16(1), ...be16(0), ...be16(1), ...be32(decalage), ...be32(donnees.length)];
  const metaTaille = boite('meta', [0, 0, 0, 0, ...iinf, ...boite('iloc', ilocCorps(0))]).length;
  const debutDonnees = ftyp.length + metaTaille + 8;
  const meta = boite('meta', [0, 0, 0, 0, ...iinf, ...boite('iloc', ilocCorps(debutDonnees))]);
  return new Uint8Array([...ftyp, ...meta, ...boite('mdat', donnees)]);
}

/** JPEG minimal : SOI, APP0 JFIF, SOS (vide), EOI. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);

test('G2 — HEIC reconnu au contenu (ftyp), au type ou à l’extension ; JPEG non', () => {
  assert.equal(estHeic(heifEssai()), true);
  assert.equal(estHeic(new Uint8Array(4), 'image/heic'), true);
  assert.equal(estHeic(new Uint8Array(4), '', 'IMG_0001.HEIC'), true);
  assert.equal(estHeic(JPEG, 'image/jpeg', 'a.jpg'), false);
});

test('G2 — EXIF relus dans le HEIF (meta / iinf / iloc) : bloc TIFF exact', () => {
  const t = exifDuHeif(heifEssai());
  assert.ok(t);
  assert.deepEqual([...t!], tiffEssai());
  assert.equal(exifDuHeif(JPEG), null);
});

test('G2 — JPEG converti : EXIF d’origine recopiés (date, focale), orientation ramenée à 1, JFIF gardé', () => {
  const t = avecOrientationNormale(exifDuHeif(heifEssai())!);
  const j = jpegAvecExif(JPEG, t)!;
  assert.ok(j);
  assert.deepEqual([...j.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...j.subarray(2, 4)], [0xff, 0xe0]); // APP0 JFIF d'abord
  const e = lireExifPhoto(j);
  assert.equal(e.orientation, 1);
  assert.equal(e.focale35mm, 26);
  assert.equal(e.dateHeure, '2026:11:17 14:00:00');
  // Un APP1 Exif déjà présent est remplacé, pas doublé.
  const deux = jpegAvecExif(j, t)!;
  assert.equal(deux.length, j.length);
});

test('G2 — JPEG illisible ou bloc trop grand : null (rien d’inventé)', () => {
  assert.equal(jpegAvecExif(new Uint8Array([1, 2, 3, 4]), new Uint8Array(tiffEssai())), null);
  assert.equal(jpegAvecExif(JPEG, new Uint8Array(70_000)), null);
});
