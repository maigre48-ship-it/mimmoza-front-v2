// src/lib/studio/photoClientLogique.ts
//
// LOT P2 (11/11/2026) — « IMAGE DANS SA RUE » : la photo prise par l'utilisateur depuis le trottoir d'en face,
// quand aucune photo de rue sous Licence Ouverte n'existe (contrat agents-1111/CONTRAT-PHOTO-RUE.md, §1).
// Logique PURE (aucune I/O) : lecture des EXIF dans le navigateur, diagnostic en phrases claires, point de vue
// et direction saisis sur le plan, chemin de l'objet dans le seau `studio-transfert`.
//
// Lecture EXIF : mêmes balises et mêmes règles que le lecteur du Studio (mimmozia-studio,
// src/core/photomontage/exif.ts, lu par la machine de rendu) — une valeur absente vaut null, jamais devinée.
// La photo est envoyée TELLE QUELLE (fichier d'origine, aucune recompression) : la machine de rendu relit ces
// EXIF elle-même ; la lecture ici sert seulement à prévenir l'utilisateur tout de suite.

import { OCTETS_PHOTO_MAX, type PointDeVue } from './fondImage.ts';

export interface ExifPhotoClient {
  orientation: number | null;
  focaleMm: number | null;
  focale35mm: number | null;
  largeurExif: number | null;
  hauteurExif: number | null;
  /** « AAAA:MM:JJ HH:MM:SS », heure locale de l'appareil. */
  dateHeure: string | null;
  gps: { lat: number; lon: number } | null;
  /** Direction de la prise de vue (GPSImgDirection), degrés ; référence vraie (T) ou magnétique (M). */
  capDeg: number | null;
  capReference: 'T' | 'M' | null;
}

export const EXIF_ABSENT: ExifPhotoClient = {
  orientation: null, focaleMm: null, focale35mm: null, largeurExif: null, hauteurExif: null, dateHeure: null, gps: null, capDeg: null, capReference: null,
};

type Valeur = number | number[] | string | null;

/** EXIF d'un JPEG (premier segment APP1 « Exif ») ; EXIF_ABSENT si absent, illisible ou autre format. */
export function lireExifPhoto(octets: ArrayBuffer | Uint8Array): ExifPhotoClient {
  try {
    const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return EXIF_ABSENT;
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return EXIF_ABSENT;
      const marqueur = b[i + 1];
      const longueur = (b[i + 2] << 8) | b[i + 3];
      if (marqueur === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
        return lireTiff(b.subarray(i + 10, i + 2 + longueur));
      }
      if (marqueur === 0xda || marqueur === 0xd9) break;
      i += 2 + longueur;
    }
    return EXIF_ABSENT;
  } catch {
    return EXIF_ABSENT;
  }
}

function lireTiff(t: Uint8Array): ExifPhotoClient {
  if (t.length < 8) return EXIF_ABSENT;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const le = t[0] === 0x49;
  const u16 = (o: number): number => dv.getUint16(o, le);
  const u32 = (o: number): number => dv.getUint32(o, le);
  const i32 = (o: number): number => dv.getInt32(o, le);
  const TAILLES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = (offset: number): Map<number, Valeur> => {
    const m = new Map<number, Valeur>();
    if (offset <= 0 || offset + 2 > t.length) return m;
    const n = u16(offset);
    for (let k = 0; k < n; k += 1) {
      const e = offset + 2 + k * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e), type = u16(e + 2), nombre = u32(e + 4);
      const taille = (TAILLES[type] ?? 1) * nombre;
      const pos = taille > 4 ? u32(e + 8) : e + 8;
      if (pos + taille > t.length) continue;
      if (type === 2) {
        let s = '';
        for (let c = 0; c < nombre; c += 1) { const ch = t[pos + c]; if (ch === 0) break; s += String.fromCharCode(ch); }
        m.set(tag, s.trim());
        continue;
      }
      const vals: number[] = [];
      for (let c = 0; c < Math.min(nombre, 16); c += 1) {
        if (type === 3) vals.push(u16(pos + c * 2));
        else if (type === 4) vals.push(u32(pos + c * 4));
        else if (type === 9) vals.push(i32(pos + c * 4));
        else if (type === 5) { const d = u32(pos + c * 8 + 4); vals.push(d ? u32(pos + c * 8) / d : Number.NaN); }
        else if (type === 10) { const d = i32(pos + c * 8 + 4); vals.push(d ? i32(pos + c * 8) / d : Number.NaN); }
        else vals.push(t[pos + c]);
      }
      m.set(tag, vals.length === 1 ? vals[0] : vals);
    }
    return m;
  };
  const ifd0 = ifd(u32(4));
  const exifPtr = ifd0.get(0x8769), gpsPtr = ifd0.get(0x8825);
  const ex = typeof exifPtr === 'number' ? ifd(exifPtr) : new Map<number, Valeur>();
  const gp = typeof gpsPtr === 'number' ? ifd(gpsPtr) : new Map<number, Valeur>();
  const nombre = (m: Map<number, Valeur>, tag: number): number | null => {
    const v = m.get(tag);
    const x = Array.isArray(v) ? v[0] : v;
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
  };
  const texte = (m: Map<number, Valeur>, tag: number): string | null => { const v = m.get(tag); return typeof v === 'string' && v !== '' ? v : null; };
  const dms = (tag: number, refTag: number, negatif: string): number | null => {
    const v = gp.get(tag);
    if (!Array.isArray(v) || v.length < 3) return typeof v === 'number' && Number.isFinite(v) ? v : null;
    const d = v[0] + v[1] / 60 + v[2] / 3600;
    if (!Number.isFinite(d)) return null;
    return texte(gp, refTag) === negatif ? -d : d;
  };
  const lat = dms(0x0002, 0x0001, 'S'), lon = dms(0x0004, 0x0003, 'W');
  const gpsOk = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  const cap = nombre(gp, 0x0011);
  const capRef = texte(gp, 0x0010);
  const f35 = nombre(ex, 0xa405);
  const f = nombre(ex, 0x920a);
  return {
    orientation: nombre(ifd0, 0x0112),
    focaleMm: f !== null && f > 0 ? f : null,
    focale35mm: f35 !== null && f35 > 0 ? f35 : null,
    largeurExif: nombre(ex, 0xa002),
    hauteurExif: nombre(ex, 0xa003),
    dateHeure: texte(ex, 0x9003) ?? texte(ifd0, 0x0132),
    gps: gpsOk ? { lat: lat as number, lon: lon as number } : null,
    capDeg: cap !== null && gpsOk && cap >= 0 && cap <= 360 ? cap % 360 : null,
    capReference: capRef === 'T' || capRef === 'M' ? capRef : null,
  };
}

// ── Diagnostic ────────────────────────────────────────────────────────────

export type NiveauDiagnostic = 'bloquant' | 'a_saisir' | 'avertissement' | 'ok';
export interface LigneDiagnostic { niveau: NiveauDiagnostic; texte: string }

export const TYPES_PHOTO_CLIENT = ['image/jpeg', 'image/png'] as const;
/** Équivalent 35 mm au-delà duquel la photo est sans doute prise au zoom (objectif principal d'un téléphone : 24 à 28 mm). */
export const FOCALE_ZOOM_MM = 35;
/** En deçà : ultra grand-angle (×0,5), déformation forte sur les bords. */
export const FOCALE_ULTRA_GRAND_ANGLE_MM = 18;
/** Distance photo ↔ parcelle au-delà de laquelle la position GPS est douteuse (m). */
export const ECART_GPS_DOUTEUX_M = 150;

export interface EntreeDiagnostic {
  type: string;
  octets: number;
  exif: ExifPhotoClient;
  /** Dimensions AFFICHÉES de l'image décodée par le navigateur (orientation EXIF appliquée) ; null si non décodée. */
  largeur: number | null;
  hauteur: number | null;
  /** Distance (m) entre la position GPS de la photo et la parcelle, si les deux sont connues. */
  ecartParcelleM?: number | null;
}

const fr = (n: number) => String(Math.round(n)).replace('.', ',');

/** Messages clairs sur la photo choisie, du plus grave au moins grave. */
export function diagnostiquerPhoto(e: EntreeDiagnostic): LigneDiagnostic[] {
  const l: LigneDiagnostic[] = [];
  if (!(TYPES_PHOTO_CLIENT as readonly string[]).includes(e.type)) {
    l.push({ niveau: 'bloquant', texte: 'Format non pris en charge : choisissez la photo d’origine en JPEG (ou PNG). Sur iPhone, réglage Appareil photo › Formats › « Le plus compatible ».' });
  }
  if (e.octets > OCTETS_PHOTO_MAX) l.push({ niveau: 'bloquant', texte: 'Photo de plus de 20 Mo : elle ne peut pas être envoyée.' });
  if (e.largeur !== null && e.hauteur !== null && e.hauteur > e.largeur) {
    l.push({ niveau: 'bloquant', texte: 'Photo en portrait : reprenez-la en tenant le téléphone à l’horizontale (paysage), toute la façade sur rue dans le cadre.' });
  }
  if (!e.exif.gps) l.push({ niveau: 'a_saisir', texte: 'Pas de position GPS dans la photo (localisation de l’appareil photo désactivée, ou photo transformée) : placez sur le plan l’endroit d’où elle a été prise.' });
  if (e.exif.capDeg === null) l.push({ niveau: 'a_saisir', texte: 'Pas de direction de prise de vue (boussole) dans la photo : indiquez sur le plan vers où vous visiez.' });
  if (e.exif.focaleMm === null && e.exif.focale35mm === null) {
    l.push({ niveau: 'avertissement', texte: 'Pas de focale dans la photo : le placement automatique sera moins sûr ; vous pourrez l’ajuster à la main.' });
  } else if (e.exif.focale35mm !== null && e.exif.focale35mm > FOCALE_ZOOM_MM) {
    l.push({ niveau: 'avertissement', texte: `La photo semble prise avec le zoom (équivalent ${fr(e.exif.focale35mm)} mm) : préférez l’objectif principal (×1), la façade entière dans le cadre.` });
  } else if (e.exif.focale35mm !== null && e.exif.focale35mm < FOCALE_ULTRA_GRAND_ANGLE_MM) {
    l.push({ niveau: 'avertissement', texte: `La photo semble prise à l’ultra grand-angle (équivalent ${fr(e.exif.focale35mm)} mm, ×0,5) : les bords sont déformés ; préférez l’objectif principal (×1).` });
  }
  if (e.exif.gps && e.ecartParcelleM !== undefined && e.ecartParcelleM !== null && e.ecartParcelleM > ECART_GPS_DOUTEUX_M) {
    l.push({ niveau: 'avertissement', texte: `La position GPS de la photo est à ${fr(e.ecartParcelleM)} m de la parcelle : vérifiez sur le plan l’endroit de la prise de vue.` });
  }
  if (e.exif.capDeg !== null && e.exif.capReference === 'M') {
    l.push({ niveau: 'avertissement', texte: 'Direction enregistrée par rapport au nord magnétique (écart de l’ordre du degré en France) : le placement reste à vérifier.' });
  }
  if (!l.some((x) => x.niveau !== 'ok')) l.push({ niveau: 'ok', texte: 'Position, direction et focale présentes dans la photo.' });
  return l;
}

// ── Point de vue saisi sur le plan ──────────────────────────────────────────

/** Cap (degrés depuis le nord vrai, sens horaire) de A vers B, sur une petite distance (approximation locale). */
export function capEntre(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number | null {
  const dx = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dy = b.lat - a.lat;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  const c = (Math.atan2(dx, dy) * 180) / Math.PI;
  return Math.round((((c % 360) + 360) % 360) * 10) / 10 % 360;
}

export interface SaisiePlan { position: { lon: number; lat: number } | null; visee: { lon: number; lat: number } | null }

/**
 * Point de vue à transmettre (`photo_client.point_de_vue`). Contrat : seulement quand l'EXIF n'a pas la position
 * ou la direction ; ce qui manque est pris dans la saisie. `{ pret: false }` tant qu'une donnée requise manque.
 */
export function pointDeVueATransmettre(exif: ExifPhotoClient, s: SaisiePlan): { pret: true; point: PointDeVue | null } | { pret: false; manque: string } {
  if (exif.gps && exif.capDeg !== null) return { pret: true, point: null };
  const position = exif.gps ?? s.position;
  if (!position) return { pret: false, manque: 'Placez sur le plan l’endroit d’où la photo a été prise.' };
  const cap = exif.capDeg ?? (s.visee ? capEntre(position, s.visee) : null);
  if (cap === null) return { pret: false, manque: 'Indiquez sur le plan vers où vous visiez (un second clic).' };
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  return { pret: true, point: { lon: r6(position.lon), lat: r6(position.lat), cap_deg: cap } };
}

/** Objet du seau privé `studio-transfert` : `<uid>/<uuid>.<ext>` (motif du contrat). null si invalide. */
export function cheminPhotoClient(uid: string, uuid: string, type: string): string | null {
  const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : null;
  const u = uid.toLowerCase(), v = uuid.toLowerCase();
  if (!ext || !/^[0-9a-f-]{36}$/.test(u) || !/^[0-9a-f-]{36}$/.test(v)) return null;
  return `${u}/${v}.${ext}`;
}

/** Texte du consentement (affiché tel quel, case à cocher obligatoire avant tout envoi). */
export const TEXTE_CONSENTEMENT = 'J’accepte que cette photo soit envoyée à Mimmoza pour ce rendu. Les visages et les plaques d’immatriculation ne sont pas floutés.';

/** Consignes de prise de vue (affichées avant le choix du fichier). */
export const CONSIGNES_PHOTO: readonly string[] = [
  'Depuis le trottoir d’en face, téléphone à l’horizontale (paysage).',
  'Objectif principal (×1), sans zoom.',
  'Toute la façade sur rue de la parcelle dans le cadre, avec un peu de trottoir et de ciel.',
  'Localisation de l’appareil photo activée (GPS), de jour.',
  'Envoyez la photo d’origine, sans retouche ni capture d’écran.',
];
