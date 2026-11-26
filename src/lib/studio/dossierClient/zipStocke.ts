/**
 * VIS-60 — ZIP « stocké » (sans compression) écrit en mémoire, sans dépendance. PUR, testé.
 *
 * Pourquoi sans compression : le contenu du dossier client (MP4, JPEG, PDF d'images) est déjà compressé ; DEFLATE ne
 * ferait gagner que quelques pour cent pour un coût CPU important dans le navigateur. Noms en UTF-8 (bit 11).
 * Limite : 4 Gio au total et 65 535 entrées (pas de ZIP64) — une erreur claire au-delà.
 */

export interface EntreeZipStocke {
  readonly nom: string;
  readonly donnees: Uint8Array;
  readonly date?: Date;
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = TABLE_CRC[(c ^ d[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dateDos(d: Date): { heure: number; jour: number } {
  const an = Math.max(1980, d.getFullYear());
  return {
    heure: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f),
    jour: (((an - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f),
  };
}

export const TAILLE_MAX_ZIP = 0xffffffff;

/** Nom d'entrée sûr : relatif, séparateur « / », sans « .. ». */
export function nomEntreeValide(nom: string): boolean {
  return nom.length > 0 && nom.length < 512 && !nom.startsWith('/') && !nom.includes('\\') && !nom.split('/').some((p) => p === '..' || p === '');
}

export function creerZipStocke(entrees: readonly EntreeZipStocke[]): Uint8Array {
  if (entrees.length > 0xffff) throw new Error('ZIP : trop de fichiers (65 535 au plus).');
  const enc = new TextEncoder();
  const noms = new Set<string>();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let decalage = 0;
  for (const e of entrees) {
    if (!nomEntreeValide(e.nom)) throw new Error(`ZIP : nom de fichier refusé (${e.nom}).`);
    if (noms.has(e.nom)) throw new Error(`ZIP : fichier en double (${e.nom}).`);
    noms.add(e.nom);
    const nom = enc.encode(e.nom);
    const crc = crc32(e.donnees);
    const { heure, jour } = dateDos(e.date ?? new Date());
    const taille = e.donnees.length;
    const tete = new Uint8Array(30 + nom.length);
    const v = new DataView(tete.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, heure, true); v.setUint16(12, jour, true); v.setUint32(14, crc, true);
    v.setUint32(18, taille, true); v.setUint32(22, taille, true); v.setUint16(26, nom.length, true); v.setUint16(28, 0, true);
    tete.set(nom, 30);
    const c = new Uint8Array(46 + nom.length);
    const w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 0x0314, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true); w.setUint16(12, heure, true); w.setUint16(14, jour, true); w.setUint32(16, crc, true);
    w.setUint32(20, taille, true); w.setUint32(24, taille, true); w.setUint16(28, nom.length, true);
    w.setUint16(30, 0, true); w.setUint16(32, 0, true); w.setUint16(34, 0, true); w.setUint16(36, 0, true);
    w.setUint32(38, (0o100644 << 16) >>> 0, true); w.setUint32(42, decalage, true);
    c.set(nom, 46);
    locales.push(tete, e.donnees);
    centrales.push(c);
    decalage += tete.length + taille;
    if (decalage > TAILLE_MAX_ZIP) throw new Error('ZIP : dossier trop volumineux (4 Go au plus).');
  }
  const tailleCentrale = centrales.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, entrees.length, true); f.setUint16(10, entrees.length, true);
  f.setUint32(12, tailleCentrale, true); f.setUint32(16, decalage, true);
  const total = decalage + tailleCentrale + 22;
  if (total > TAILLE_MAX_ZIP) throw new Error('ZIP : dossier trop volumineux (4 Go au plus).');
  const sortie = new Uint8Array(total);
  let p = 0;
  for (const m of [...locales, ...centrales, fin]) { sortie.set(m, p); p += m.length; }
  return sortie;
}

/** Relecture (contrôle et tests) : nom, taille, crc et données de chaque entrée, via le répertoire central. */
export function lireZipStocke(z: Uint8Array): { nom: string; taille: number; crc: number; donnees: Uint8Array }[] {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let fin = -1;
  for (let i = z.length - 22; i >= Math.max(0, z.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('ZIP illisible : fin de répertoire introuvable.');
  const n = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  const res: { nom: string; taille: number; crc: number; donnees: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP illisible : répertoire central corrompu.');
    const crc = v.getUint32(p + 16, true);
    const taille = v.getUint32(p + 24, true);
    const ln = v.getUint16(p + 28, true);
    const lx = v.getUint16(p + 30, true);
    const lc = v.getUint16(p + 32, true);
    const loc = v.getUint32(p + 42, true);
    const nom = dec.decode(z.subarray(p + 46, p + 46 + ln));
    const debut = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
    res.push({ nom, taille, crc, donnees: z.subarray(debut, debut + taille) });
    p += 46 + ln + lx + lc;
  }
  return res;
}
