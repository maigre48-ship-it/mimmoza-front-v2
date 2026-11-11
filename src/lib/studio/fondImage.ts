// src/lib/studio/fondImage.ts
//
// LOT P2 (11/11/2026) — « IMAGE DANS SA RUE » : options de fond d'un travail `image` (contrat
// _mimmoza-agents/agents-1111/CONTRAT-PHOTO-RUE.md, §1). Logique PURE, sans dépendance : importée
// par le site (travauxLogique.ts) ET par le serveur (copilot-chat/agent/studio.ts), pour que les deux
// appliquent EXACTEMENT les mêmes règles que la base (`_studio_job_options_valides`, migration
// 20261111120000_studio_image_photo_rue.sql).
//
//   fond          : 'etude' (défaut) | 'photo_rue' | 'photo_client'
//   photo_rue     : { id } — seulement si fond = photo_rue ; facultatif (la machine de rendu choisit)
//   photo_client  : { chemin, octets, point_de_vue? } — obligatoire si et seulement si fond = photo_client
//   calage_client : calage validé par l'utilisateur dans l'atelier (2 à 12 correspondances) — fond photo seulement
//
// Normalisation : `fond: 'etude'` n'est PAS recopié (c'est la valeur par défaut) — les options d'une
// image d'étude restent celles d'avant ce lot, acceptées par la base même sans la nouvelle migration.

export type FondImage = 'etude' | 'photo_rue' | 'photo_client';
export const FONDS_IMAGE: readonly FondImage[] = ['etude', 'photo_rue', 'photo_client'];
/** Clés d'options ajoutées par ce lot au type `image`. */
export const CLES_FOND = ['fond', 'photo_rue', 'photo_client', 'calage_client'] as const;

/** Taille maximale d'une photo du client : celle du seau `studio-transfert` (20 Mo). */
export const OCTETS_PHOTO_MAX = 20 * 1024 * 1024;
/** Objet du seau `studio-transfert` : `<auth.uid()>/<uuid>.jpg|jpeg|png` (même motif que la base). */
export const RE_CHEMIN_PHOTO = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png)$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CORRESPONDANCES_MIN = 2;
export const CORRESPONDANCES_MAX = 12;
/** Côté maximal d'une image accepté pour un calage (pixels). */
export const COTE_IMAGE_MAX = 20000;
/** Date de validation : horodatage ISO 8601 (même motif que la base). */
export const RE_DATE_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/;

export interface PointDeVue { lon: number; lat: number; cap_deg?: number }
export interface PhotoClientOption { chemin: string; octets: number; point_de_vue?: PointDeVue }
export interface Correspondance { image: [number, number]; monde: [number, number, number] }
export interface CalageClient {
  version: 1;
  correspondances: Correspondance[];
  largeur_image: number;
  hauteur_image: number;
  valide_le: string;
}
/** Options de fond normalisées (aucune clé pour une image d'étude sans calage). */
export interface OptionsFond {
  fond?: 'photo_rue' | 'photo_client';
  photo_rue?: { id: string };
  photo_client?: PhotoClientOption;
  calage_client?: CalageClient;
}

export const LIBELLES_FOND: Record<FondImage, string> = {
  photo_rue: 'Photo de la rue (Panoramax / IGN)',
  photo_client: 'Votre photo du trottoir',
  etude: 'Étude seule',
};

type R<T> = { ok: true; valeur: T } | { ok: false; erreur: string };
type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cleEnTrop = (o: Obj, permises: readonly string[]): string | undefined => Object.keys(o).find((k) => !permises.includes(k));

function lirePointDeVue(v: unknown): R<PointDeVue> {
  if (!estObj(v)) return { ok: false, erreur: 'Point de vue de la photo illisible.' };
  const k = cleEnTrop(v, ['lon', 'lat', 'cap_deg']);
  if (k) return { ok: false, erreur: `Point de vue de la photo : champ inconnu ${k}.` };
  if (!fini(v.lon) || !fini(v.lat) || Math.abs(v.lon) > 180 || Math.abs(v.lat) > 90) return { ok: false, erreur: 'Point de vue de la photo : position invalide.' };
  if (v.cap_deg !== undefined && (!fini(v.cap_deg) || v.cap_deg < 0 || v.cap_deg >= 360)) return { ok: false, erreur: 'Point de vue de la photo : direction invalide (0 à 360°).' };
  return { ok: true, valeur: { lon: v.lon, lat: v.lat, ...(v.cap_deg !== undefined ? { cap_deg: v.cap_deg as number } : {}) } };
}

function lirePhotoClient(v: unknown, proprietaire: string | null): R<PhotoClientOption> {
  if (!estObj(v)) return { ok: false, erreur: 'Votre photo est requise pour ce fond (téléversez-la d’abord).' };
  const k = cleEnTrop(v, ['chemin', 'octets', 'point_de_vue']);
  if (k) return { ok: false, erreur: `Votre photo : champ inconnu ${k}.` };
  if (typeof v.chemin !== 'string' || !RE_CHEMIN_PHOTO.test(v.chemin)) return { ok: false, erreur: 'Votre photo : emplacement invalide.' };
  // Le dossier est celui du compte : jamais la photo d'un autre utilisateur (la machine de rendu lit avec la clé de service).
  if (proprietaire !== null && v.chemin.split('/')[0] !== proprietaire.toLowerCase()) return { ok: false, erreur: 'Votre photo : elle n’appartient pas à ce compte.' };
  if (!fini(v.octets) || !Number.isInteger(v.octets) || v.octets < 1 || v.octets > OCTETS_PHOTO_MAX) return { ok: false, erreur: 'Votre photo : taille invalide (20 Mo au plus).' };
  let point: PointDeVue | undefined;
  if (v.point_de_vue !== undefined) {
    const p = lirePointDeVue(v.point_de_vue);
    if (!p.ok) return p;
    point = p.valeur;
  }
  return { ok: true, valeur: { chemin: v.chemin, octets: v.octets, ...(point ? { point_de_vue: point } : {}) } };
}

/** Calage validé dans l'atelier (contrat §1 et §4) ; jamais complété ni deviné. */
export function lireCalageClient(v: unknown): R<CalageClient> {
  if (!estObj(v)) return { ok: false, erreur: 'Calage illisible.' };
  const k = cleEnTrop(v, ['version', 'correspondances', 'largeur_image', 'hauteur_image', 'valide_le']);
  if (k) return { ok: false, erreur: `Calage : champ inconnu ${k}.` };
  if (v.version !== 1) return { ok: false, erreur: 'Calage d’une version inconnue.' };
  const L = v.largeur_image, H = v.hauteur_image;
  if (!fini(L) || !fini(H) || !Number.isInteger(L) || !Number.isInteger(H) || L < 1 || H < 1 || L > COTE_IMAGE_MAX || H > COTE_IMAGE_MAX) {
    return { ok: false, erreur: 'Calage : dimensions de la photo invalides.' };
  }
  if (typeof v.valide_le !== 'string' || v.valide_le.length > 40 || !RE_DATE_ISO.test(v.valide_le) || Number.isNaN(Date.parse(v.valide_le))) return { ok: false, erreur: 'Calage : date de validation invalide.' };
  const c = v.correspondances;
  if (!Array.isArray(c) || c.length < CORRESPONDANCES_MIN || c.length > CORRESPONDANCES_MAX) {
    return { ok: false, erreur: `Calage : il faut de ${CORRESPONDANCES_MIN} à ${CORRESPONDANCES_MAX} points de correspondance.` };
  }
  const correspondances: Correspondance[] = [];
  for (const x of c) {
    if (!estObj(x) || cleEnTrop(x, ['image', 'monde']) || !Array.isArray(x.image) || !Array.isArray(x.monde) || x.image.length !== 2 || x.monde.length !== 3) {
      return { ok: false, erreur: 'Calage : point de correspondance illisible.' };
    }
    const [px, py] = x.image as unknown[];
    const [lon, lat, z] = x.monde as unknown[];
    if (!fini(px) || !fini(py) || px < 0 || py < 0 || px > L || py > H) return { ok: false, erreur: 'Calage : point hors de la photo.' };
    if (!fini(lon) || !fini(lat) || !fini(z) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || Math.abs(z) > 1000) return { ok: false, erreur: 'Calage : position sur le terrain invalide.' };
    correspondances.push({ image: [px, py], monde: [lon, lat, z] });
  }
  return { ok: true, valeur: { version: 1, correspondances, largeur_image: L, hauteur_image: H, valide_le: v.valide_le } };
}

/**
 * Lit les options de fond d'un travail `image` (les autres clés sont ignorées ici : vues, ambiance, qualité).
 * `proprietaire` : identifiant du compte (serveur, site connecté) — le chemin de la photo doit être dans SON dossier.
 * null : contrôle du motif seulement (la base vérifie aussi le dossier, contrainte `studio_jobs_photo_client_proprietaire`).
 */
export function validerFond(o: Obj, proprietaire: string | null = null): R<OptionsFond> {
  const fond = o.fond ?? 'etude';
  if (!FONDS_IMAGE.includes(fond as FondImage)) return { ok: false, erreur: 'Choisissez un fond : photo de la rue, votre photo du trottoir ou étude seule.' };
  const r: OptionsFond = {};
  if (fond !== 'etude') r.fond = fond as 'photo_rue' | 'photo_client';
  if (o.photo_rue !== undefined) {
    if (fond !== 'photo_rue') return { ok: false, erreur: 'Une photo Panoramax n’est choisie qu’avec le fond « photo de la rue ».' };
    if (!estObj(o.photo_rue) || cleEnTrop(o.photo_rue, ['id']) || typeof o.photo_rue.id !== 'string' || !RE_UUID.test(o.photo_rue.id)) {
      return { ok: false, erreur: 'Photo Panoramax : identifiant invalide.' };
    }
    r.photo_rue = { id: o.photo_rue.id.toLowerCase() };
  }
  if (fond === 'photo_client') {
    const p = lirePhotoClient(o.photo_client, proprietaire);
    if (!p.ok) return p;
    r.photo_client = p.valeur;
  } else if (o.photo_client !== undefined) {
    return { ok: false, erreur: 'Votre photo n’est utilisée qu’avec le fond « votre photo du trottoir ».' };
  }
  if (o.calage_client !== undefined) {
    if (fond === 'etude') return { ok: false, erreur: 'Un calage ne s’applique qu’à une image sur photo.' };
    const c = lireCalageClient(o.calage_client);
    if (!c.ok) return c;
    r.calage_client = c.valeur;
  }
  return { ok: true, valeur: r };
}

/** Fond effectif d'options d'image déjà validées. */
export function fondDe(o: { fond?: unknown } | null | undefined): FondImage {
  return o?.fond === 'photo_rue' || o?.fond === 'photo_client' ? o.fond : 'etude';
}
