// src/lib/studio/masqueExistant.ts
//
// LOT P5-SITE (12/11/2026) — « EFFACEMENT DE L'EXISTANT » côté site. Logique PURE (testée par masqueExistant.test.ts).
//
// Quand un bâtiment existant sur la parcelle dépasse du projet dans la photo, la machine de rendu l'efface et
// reconstitue la zone (lot P4). Deux choses arrivent au site :
//   1. dans l'atelier, l'utilisateur peut CORRIGER la zone à effacer au pinceau ; l'atelier renvoie, AVANT le calage,
//      `{ type: 'mimmoza-masque-existant-v1', version: 1, travail, largeur, hauteur, png_base64 }` (blanc = à effacer) ;
//      le site dépose ce PNG dans le seau privé `studio-transfert/<auth.uid()>/<uuid>.png` (même seau et mêmes
//      politiques que la photo du client) PUIS crée le nouveau travail avec l'option `masque_existant: { chemin, octets }`.
//      Pourquoi pas `studio-rendus/<user>/<nouveau travail>/atelier/masque-existant.png` (piste du lot P4) : l'utilisateur
//      n'a que le droit de LIRE `studio-rendus`, et le déclencheur `_studio_jobs_proteger` impose un identifiant tiré par
//      la base à chaque insertion (`new.id := gen_random_uuid()`) : l'id ne peut pas être fixé par le navigateur.
//   2. sur l'image livrée, `resultat.photomontage.existant` : { efface, batiments, surface_reconstituee_pct, methode,
//      masque_source, zones_path? } — affiché tel quel, jamais complété.

/** Message de l'atelier (Studio, `src/core/effacement/atelier.ts`, lot P4). */
export const TYPE_MESSAGE_MASQUE_EXISTANT = 'mimmoza-masque-existant-v1';
/** Taille maximale du PNG renvoyé par l'atelier (même borne que le Studio et le worker). */
export const OCTETS_MAX_MASQUE = 8 * 1024 * 1024;
/** Objet du seau `studio-transfert` : `<auth.uid()>/<uuid>.png` (même motif que la base, migration du lot P5). */
export const RE_CHEMIN_MASQUE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/;
/** Mention du résultat (identique à `MENTION_EFFACEMENT` du Studio). */
export const MENTION_EFFACEMENT = 'Bâtiment existant effacé — zone reconstituée (non photographique)';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type R<T> = { ok: true; valeur: T } | { ok: false; erreur: string };
type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Option d'un travail `image` relancé depuis l'atelier : masque corrigé de l'existant. */
export interface MasqueExistantOption { chemin: string; octets: number }

/** Masque reçu de l'atelier, relu et vérifié (PNG binaire). */
export interface MasqueRecu { travail: string; largeur: number; hauteur: number; octets: Uint8Array }

function decoderBase64(s: string): Uint8Array {
  const bin = atob(s);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) o[i] = bin.charCodeAt(i);
  return o;
}

/**
 * Relecture STRICTE du message de l'atelier (même règles que `lireMessageMasqueExistant` du Studio) : forme exacte,
 * travail attendu, dimensions 16–20 000 px, PNG véritable (signature, dimensions de l'en-tête), 8 Mo au plus. Pur.
 */
export function lireMessageMasqueExistant(x: unknown, travailAttendu: string): R<MasqueRecu> {
  if (!estObj(x) || x.type !== TYPE_MESSAGE_MASQUE_EXISTANT) return { ok: false, erreur: 'Message de masque inconnu.' };
  if (Object.keys(x).sort().join(',') !== 'hauteur,largeur,png_base64,travail,type,version') return { ok: false, erreur: 'Masque de l’atelier : champs inattendus.' };
  if (x.version !== 1) return { ok: false, erreur: 'Masque de l’atelier : version inconnue.' };
  if (typeof x.travail !== 'string' || !RE_UUID.test(x.travail)) return { ok: false, erreur: 'Masque de l’atelier : image d’origine invalide.' };
  if (x.travail.toLowerCase() !== travailAttendu.toLowerCase()) return { ok: false, erreur: 'Masque de l’atelier : il concerne une autre image.' };
  const dim = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 16 && v <= 20000;
  if (!dim(x.largeur) || !dim(x.hauteur)) return { ok: false, erreur: 'Masque de l’atelier : dimensions invalides.' };
  const b = x.png_base64;
  if (typeof b !== 'string' || b.length < 16 || b.length > Math.ceil((OCTETS_MAX_MASQUE * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b)) {
    return { ok: false, erreur: 'Masque de l’atelier : image absente ou trop volumineuse.' };
  }
  let octets: Uint8Array;
  try { octets = decoderBase64(b); } catch { return { ok: false, erreur: 'Masque de l’atelier : image illisible.' }; }
  if (octets.length > OCTETS_MAX_MASQUE) return { ok: false, erreur: 'Masque de l’atelier : image trop volumineuse.' };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length < 24 || sig.some((o, i) => octets[i] !== o)) return { ok: false, erreur: 'Masque de l’atelier : ce n’est pas une image PNG.' };
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  if (dv.getUint32(16) !== x.largeur || dv.getUint32(20) !== x.hauteur) return { ok: false, erreur: 'Masque de l’atelier : dimensions de l’image différentes de celles annoncées.' };
  return { ok: true, valeur: { travail: x.travail.toLowerCase(), largeur: x.largeur, hauteur: x.hauteur, octets } };
}

/** Le masque doit avoir EXACTEMENT la taille de la photo calée (l'atelier les tire du même plan préparé). Pur. */
export function masqueAccordeAuCalage(m: Pick<MasqueRecu, 'largeur' | 'hauteur'>, calage: { largeur_image: number; hauteur_image: number }): R<true> {
  if (m.largeur !== calage.largeur_image || m.hauteur !== calage.hauteur_image) {
    return { ok: false, erreur: `La zone à effacer (${m.largeur} × ${m.hauteur} px) n’a pas la taille de la photo calée (${calage.largeur_image} × ${calage.hauteur_image} px) : reprenez-la dans l’atelier.` };
  }
  return { ok: true, valeur: true };
}

/** Chemin du dépôt : `<auth.uid()>/<uuid>.png` ; null si l'un des identifiants est invalide. Pur. */
export function cheminMasqueExistant(userId: string, uuid: string): string | null {
  if (!RE_UUID.test(userId) || !RE_UUID.test(uuid)) return null;
  return `${userId.toLowerCase()}/${uuid.toLowerCase()}.png`;
}

/**
 * Option `masque_existant` (mêmes règles que la base, migration du lot P5) : `{ chemin, octets }` seulement, chemin dans
 * le dossier du compte quand il est connu, 1 octet à 8 Mo. Pur.
 */
export function lireMasqueExistantOption(v: unknown, proprietaire: string | null = null): R<MasqueExistantOption> {
  if (!estObj(v)) return { ok: false, erreur: 'Zone à effacer : option illisible.' };
  const k = Object.keys(v).find((c) => c !== 'chemin' && c !== 'octets');
  if (k) return { ok: false, erreur: `Zone à effacer : champ inconnu ${k}.` };
  if (typeof v.chemin !== 'string' || !RE_CHEMIN_MASQUE.test(v.chemin)) return { ok: false, erreur: 'Zone à effacer : emplacement invalide.' };
  if (proprietaire !== null && v.chemin.split('/')[0] !== proprietaire.toLowerCase()) return { ok: false, erreur: 'Zone à effacer : elle n’appartient pas à ce compte.' };
  if (typeof v.octets !== 'number' || !Number.isInteger(v.octets) || v.octets < 1 || v.octets > OCTETS_MAX_MASQUE) return { ok: false, erreur: 'Zone à effacer : taille invalide (8 Mo au plus).' };
  return { ok: true, valeur: { chemin: v.chemin, octets: v.octets } };
}

// ── Résultat : bâtiment existant effacé ───────────────────────────────────────────────────────────

export type MethodeReconstitution = 'lama' | 'opencv' | 'diffusion';

/** `resultat.photomontage.existant` (contrat §3, lot P4), relu sans rien compléter. */
export interface ExistantResultat {
  efface: true;
  batiments: string[];
  /** Part de l'image reconstituée ET visible, en % ; null si absente ou illisible. */
  surface_reconstituee_pct: number | null;
  /** null si absente ou inconnue du site. */
  methode: MethodeReconstitution | null;
  masque_source: 'auto' | 'utilisateur' | null;
  /** Image d'accompagnement (seau privé `studio-rendus`) ; null si absente. */
  zones_path: string | null;
}

/** Libellés montrés à l'utilisateur : ce que la méthode implique, sans nom d'outil. */
export const LIBELLES_METHODE_SITE: Readonly<Record<MethodeReconstitution, string>> = {
  lama: 'reconstitution par réseau de neurones (contenu inventé, plausible)',
  opencv: 'reconstitution classique (peut paraître floue ou étirée)',
  diffusion: 'remplissage par diffusion (flou, se voit de près)',
};

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function lireExistant(brut: unknown): ExistantResultat | null {
  if (!estObj(brut) || brut.efface !== true) return null;
  const p = brut.surface_reconstituee_pct;
  const m = brut.methode;
  return {
    efface: true,
    batiments: Array.isArray(brut.batiments) ? brut.batiments.filter((b): b is string => typeof b === 'string').slice(0, 20) : [],
    surface_reconstituee_pct: typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100 ? p : null,
    methode: m === 'lama' || m === 'opencv' || m === 'diffusion' ? m : null,
    masque_source: brut.masque_source === 'auto' || brut.masque_source === 'utilisateur' ? brut.masque_source : null,
    zones_path: texte(brut.zones_path),
  };
}

/** Ce que la carte affiche d'un effacement (uniquement ce que le résultat contient). */
export interface LibelleEffacement {
  /** « Bâtiment existant effacé — zone reconstituée (non photographique), 12,3 % de l'image, méthode : … ». */
  mention: string;
  /** Origine de la zone effacée ; null si le résultat ne la dit pas. */
  masque: string | null;
  /** Lien vers l'image des zones (chemin `studio-rendus`, à signer) ; null si absente. */
  zonesPath: string | null;
}

const pct = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');

export function libelleEffacement(e: ExistantResultat | null | undefined): LibelleEffacement | null {
  if (!e) return null;
  const parts = [MENTION_EFFACEMENT];
  if (e.surface_reconstituee_pct !== null) parts.push(`${pct(e.surface_reconstituee_pct)} % de l’image`);
  if (e.methode) parts.push(`méthode : ${LIBELLES_METHODE_SITE[e.methode]}`);
  return {
    mention: parts.join(', ') + '.',
    masque: e.masque_source === 'utilisateur' ? 'Zone à effacer corrigée par vous dans l’atelier.'
      : e.masque_source === 'auto' ? 'Zone à effacer calculée automatiquement d’après les bâtiments connus (BD TOPO).' : null,
    zonesPath: e.zones_path,
  };
}

/** Avertissements à afficher quand la mention a son propre bloc : la mention seule n'est pas répétée. Pur. */
export function avertissementsSansMention(avertissements: readonly string[], effacement: LibelleEffacement | null): string[] {
  return effacement ? avertissements.filter((a) => a.trim() !== MENTION_EFFACEMENT) : [...avertissements];
}
