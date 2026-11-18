// src/lib/studio/photoReelle.ts
//
// LOT X9 (17/11/2026) — « PHOTO RÉELLE OBLIGATOIRE » pour une image d'EXTENSION de maison.
// Décision d'Albé (17/11/2026, 13 h 50) : « il faut que Mimmoza demande une photo de la maison dans ce cas ».
// Une image d'extension n'est montrée QUE si l'extension a été insérée dans une vraie photo de la maison
// (`resultat.photomontage.statut === 'livre'` avec sa photo source). Sinon : aucune image n'est affichée (même si une
// ancienne machine de rendu en a livré une), et l'utilisateur est invité à envoyer une photo de sa maison.
//
// Logique PURE (aucune I/O), partagée par le site (carte de suivi) et la fonction du chat (studio.ts).
// Mêmes codes et mêmes textes que la machine de rendu (mimmozia-studio, src/core/extension/photoRequise.ts).

import { contourDepuisGeometrie, lireContour, type LonLat } from './couverturePhotoRue.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const texte = (v: unknown, max = 400): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export type CodePhotoRequise = 'aucune_photo' | 'calage_insuffisant' | 'photo_inutilisable';

export interface PhotoRequise {
  code: CodePhotoRequise;
  /** Phrase pour un particulier (textes du site, jamais le texte reçu tel quel). */
  texte: string;
  /** Raison détaillée donnée par l'étape photo (français) ; null si aucune. */
  raison: string | null;
  /** « Ajuster le placement » possible (photo et plan déposés pour l'atelier). */
  atelier: boolean;
  /** Photo essayée : publique (rue) ou celle de l'utilisateur ; null si aucune. */
  source: 'panoramax' | 'client' | null;
  /** LOT G10b — projet concerné : extension d'une maison existante (défaut) ou maison neuve sur un terrain. */
  nature?: 'extension' | 'maison';
}

/** Consignes de prise de vue (mêmes textes que la machine de rendu). */
export const CONSIGNES_PHOTO_MAISON: readonly string[] = [
  'Depuis la rue (le trottoir d’en face) ou depuis le jardin, en plein jour, téléphone à l’horizontale.',
  'De face ou de trois quarts, toute la maison dans le cadre : le pied des murs et le toit visibles.',
  'Le côté où se fera l’extension bien visible, avec au moins deux angles de la maison.',
  'Objectif principal (×1), sans zoom ; localisation de l’appareil activée si possible.',
  'La photo d’origine (JPEG, PNG ou HEIC d’iPhone), sans retouche ni capture d’écran.',
];

export const TEXTES_PHOTO_REQUISE: Readonly<Record<CodePhotoRequise, string>> = {
  aucune_photo: 'Aucune photo de votre maison n’est disponible : sans vraie photo, aucune image de l’extension n’est montrée. Envoyez une photo de votre maison, prise depuis la rue ou depuis le jardin.',
  calage_insuffisant: 'L’extension n’a pas pu être placée assez précisément dans la photo : aucune image n’est montrée. Placez votre maison sur la photo en touchant 4 à 6 de ses angles, ou envoyez une autre photo.',
  photo_inutilisable: 'La photo disponible ne permet pas d’insérer l’extension : aucune image n’est montrée. Envoyez une photo de votre maison, prise depuis la rue ou depuis le jardin.',
};
const TEXTE_CALAGE_SANS_ATELIER = 'L’extension n’a pas pu être placée assez précisément dans la photo : aucune image n’est montrée. Envoyez une autre photo de votre maison prise depuis la rue.';

/** Libellé du bouton (carte du chat). */
export const LIBELLE_ENVOYER_PHOTO = 'Envoyer une photo de ma maison';

/** LOT G10b — maison NEUVE : consignes de prise de vue du TERRAIN (mêmes textes que la machine de rendu). */
export const CONSIGNES_PHOTO_TERRAIN: readonly string[] = [
  'Depuis la rue (le trottoir d’en face), en plein jour, téléphone à l’horizontale.',
  'Tout le terrain dans le cadre, avec au moins un angle du terrain (borne, piquet ou poteau de clôture) bien visible au sol.',
  'Si possible, une ou deux maisons voisines dans le cadre, avec le pied de leurs murs et leur toit.',
  'Objectif principal (×1), sans zoom ; localisation de l’appareil activée si possible.',
  'La photo d’origine (JPEG, PNG ou HEIC d’iPhone), sans retouche ni capture d’écran.',
];
export const TEXTES_PHOTO_REQUISE_TERRAIN: Readonly<Record<CodePhotoRequise, string>> = {
  aucune_photo: 'Aucune photo du terrain n’est disponible : sans vraie photo, aucune image de la maison n’est montrée. Envoyez une photo du terrain prise depuis la rue.',
  calage_insuffisant: 'La maison n’a pas pu être placée assez précisément dans la photo : aucune image n’est montrée. Placez le terrain sur la photo en touchant 4 à 6 repères (angles du terrain, maisons voisines), ou envoyez une autre photo.',
  photo_inutilisable: 'La photo disponible ne permet pas d’insérer la maison : aucune image n’est montrée. Envoyez une photo du terrain prise depuis la rue.',
};
const TEXTE_CALAGE_SANS_ATELIER_TERRAIN = 'La maison n’a pas pu être placée assez précisément dans la photo : aucune image n’est montrée. Envoyez une autre photo du terrain prise depuis la rue.';
export const LIBELLE_ENVOYER_PHOTO_TERRAIN = 'Envoyer une photo du terrain';
export const TITRE_PHOTO_TERRAIN_NECESSAIRE = 'Photo du terrain nécessaire';

/** Titre de la carte quand aucune image n'est montrée. */
export const TITRE_PHOTO_NECESSAIRE = 'Photo de votre maison nécessaire';

/** Le travail porte-t-il un projet d'EXTENSION (fiche ou résultat) ? */
export function estTravailExtension(t: { projet_extension?: unknown; resultat_extension?: unknown; resultat?: unknown } | null | undefined): boolean {
  if (!t) return false;
  if (estObj(t.projet_extension) || estObj(t.resultat_extension)) return true;
  // LOT G10b — maison neuve : même règle (photo réelle obligatoire).
  return estObj(t.resultat) && (estObj(t.resultat.extension) || estObj(t.resultat.photo_requise) || estObj(t.resultat.maison));
}

/** Preuve d'une vraie photo de fond : projet inséré (« livre ») ET photo source connue (rue ou utilisateur). */
export function imageSurPhotoReelle(resultat: unknown): boolean {
  if (!estObj(resultat) || estObj(resultat.photo_requise)) return false;
  const p = estObj(resultat.photomontage) ? resultat.photomontage : null;
  const sp = p && estObj(p.source_photo) ? p.source_photo : null;
  return !!p && p.statut === 'livre' && !!sp && (sp.type === 'panoramax' || sp.type === 'client');
}

const CODES: readonly CodePhotoRequise[] = ['aucune_photo', 'calage_insuffisant', 'photo_inutilisable'];

/**
 * Photo à demander pour le résultat d'une image d'extension ; null si l'image est insérée dans une vraie photo.
 * Lit `resultat.photo_requise` (machine de rendu à jour) ; à défaut (ancienne machine, image d'étude livrée), la
 * déduit de `resultat.photomontage`. Toujours avec les textes du site.
 */
export function photoRequiseDuResultat(resultat: unknown): PhotoRequise | null {
  if (imageSurPhotoReelle(resultat)) return null;
  const r = estObj(resultat) ? resultat : {};
  const p = estObj(r.photomontage) ? r.photomontage : null;
  const sp = p && estObj(p.source_photo) ? p.source_photo : null;
  const source = sp && (sp.type === 'panoramax' || sp.type === 'client') ? sp.type : null;
  const at = p && estObj(p.atelier) ? p.atelier : null;
  const atelierDepose = !!(at && texte(at.photo_path) && texte(at.plan_path));
  const pr = estObj(r.photo_requise) ? r.photo_requise : null;
  const code: CodePhotoRequise = pr && CODES.includes(pr.code as CodePhotoRequise) ? pr.code as CodePhotoRequise
    : p?.statut === 'a_valider' ? 'calage_insuffisant'
      : p?.statut === 'repli_etude' && source ? 'photo_inutilisable'
        : 'aucune_photo';
  const atelier = code === 'calage_insuffisant' && atelierDepose && (pr ? pr.atelier !== false : true);
  // LOT G10b — maison neuve (résultat `maison`) : textes du terrain.
  if (estObj(r.maison)) {
    return {
      code, nature: 'maison',
      texte: code === 'calage_insuffisant' && !atelier ? TEXTE_CALAGE_SANS_ATELIER_TERRAIN : TEXTES_PHOTO_REQUISE_TERRAIN[code],
      raison: texte(pr?.raison, 300) ?? texte(p?.raison, 300),
      atelier,
      source: code === 'aucune_photo' ? null : source,
    };
  }
  return {
    code,
    texte: code === 'calage_insuffisant' && !atelier ? TEXTE_CALAGE_SANS_ATELIER : TEXTES_PHOTO_REQUISE[code],
    raison: texte(pr?.raison, 300) ?? texte(p?.raison, 300),
    atelier,
    source: code === 'aucune_photo' ? null : source,
  };
}

/** Contour de la parcelle (WGS 84) d'une fiche de travail (`charge.site.parcelles[0].geometrie`) ; null sinon. */
export function contourDeLaFiche(fiche: unknown): LonLat[] | null {
  const c = estObj(fiche) && estObj(fiche.charge) ? fiche.charge : null;
  const site = c && estObj(c.site) ? c.site : null;
  const p0 = site && Array.isArray(site.parcelles) && estObj(site.parcelles[0]) ? site.parcelles[0] : null;
  return p0 ? contourDepuisGeometrie(p0.geometrie) : null;
}

/** Outil du chat qui lance les rendus (même nom que copilot-chat/agent/studio.ts). */
export const OUTIL_LANCER_RENDU_PHOTO = 'studio_lancer_rendu';

export interface DemandePhotoLue extends PhotoRequise {
  /** Contour de la parcelle (WGS 84) pour le plan du point de vue ; null si absent. */
  contour: LonLat[] | null;
}

/**
 * Sortie de `studio_lancer_rendu` qui n'a RIEN lancé faute de vraie photo (`data.photo_maison`) → demande à afficher
 * sous la réponse de Mimmo ; null sinon. Textes du site (le texte reçu n'est jamais affiché tel quel).
 */
export function lireDemandePhotoMaison(call: { name: string; status?: string; output?: unknown }): DemandePhotoLue | null {
  if (call.name !== OUTIL_LANCER_RENDU_PHOTO || call.status === 'running' || !estObj(call.output)) return null;
  const d = estObj(call.output.data) ? call.output.data : null;
  const pm = d && estObj(d.photo_maison) ? d.photo_maison : null;
  if (!pm) return null;
  const code: CodePhotoRequise = CODES.includes(pm.code as CodePhotoRequise) ? pm.code as CodePhotoRequise : 'aucune_photo';
  return { code, texte: TEXTES_PHOTO_REQUISE[code] === TEXTES_PHOTO_REQUISE.calage_insuffisant ? TEXTE_CALAGE_SANS_ATELIER : TEXTES_PHOTO_REQUISE[code], raison: texte(pm.raison, 300), atelier: false, source: null, contour: lireContour(pm.contour) };
}
