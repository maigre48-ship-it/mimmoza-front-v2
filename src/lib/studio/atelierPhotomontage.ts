// src/lib/studio/atelierPhotomontage.ts
//
// LOT P2 (11/11/2026) — « IMAGE DANS SA RUE » : atelier d'ajustement du placement (contrat
// agents-1111/CONTRAT-PHOTO-RUE.md, §3 et §4). Logique PURE (testée par photoRue.test.ts).
//
// Quand la machine de rendu n'a pas pu caler le projet dans la photo avec assez de précision, elle livre
// l'image d'étude, statut `a_valider`, et dépose la photo et le plan préparé (`atelier.photo_path`,
// `atelier.plan_path`, seau privé `studio-rendus`). Le site propose alors « Ajuster le placement » :
//   1. il ouvre le Studio (même origine, servi sous /studio/) sur `?atelier=photomontage&travail=<id>` ;
//   2. il lui envoie les adresses SIGNÉES (1 h) de la photo et du plan par postMessage, cible = origine
//      exacte du Studio, jamais « * » (message `mimmoza-atelier-photomontage-v1`, répété jusqu'au retour) ;
//   3. l'utilisateur clique 2 à 12 correspondances ; le Studio renvoie
//      `{ type: 'mimmoza-calage-v1', travail: <id>, calage_client: {…} }` ;
//   4. le site filtre ce retour (origine, fenêtre ouverte par lui, travail attendu, calage revalidé) puis
//      propose un NOUVEAU travail identique avec `calage_client` : devis affiché, confirmation explicite.

import { lireCalageClient, type CalageClient } from './fondImage.ts';
import { validerOptions, type OptionsImage, type PhotomontageResultat, type Validation } from './travauxLogique.ts';
// LOT P5-SITE (12/11/2026) — zone à effacer corrigée dans l'atelier (message `mimmoza-masque-existant-v1`, lot P4).
import { lireMessageMasqueExistant, TYPE_MESSAGE_MASQUE_EXISTANT, type MasqueExistantOption, type MasqueRecu } from './masqueExistant.ts';
// LOT X7 (16/11/2026) — hauteur à l'égout de la maison conservée SAISIE dans l'atelier : posée, CONFIRMÉE, dans
// `fiche.projet_extension` du nouveau travail (le contrat `calage_client` et la base n'admettent pas d'autre clé).
import { lireProjetExtension } from '../../../supabase/functions/_shared/extension/contrat.ts';

export const TYPE_MESSAGE_CALAGE = 'mimmoza-calage-v1';
/** Accusé de réception de l'atelier (lot P3) : les adresses sont reçues, le site cesse de répéter son message. */
export const TYPE_MESSAGE_RECU = 'mimmoza-atelier-photomontage-recu-v1';
/** Message du site vers l'atelier (défini par ce lot, à aligner sur le Studio s'il diffère). */
export const TYPE_MESSAGE_ATELIER = 'mimmoza-atelier-photomontage-v1';
/** Durée de validité des adresses signées envoyées à l'atelier (s). */
export const DUREE_URL_ATELIER_S = 3600;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Adresse de l'atelier : `<adresse du Studio>?atelier=photomontage&travail=<id>`. */
export function urlAtelier(urlStudio: string, travailId: string): string {
  const u = new URL(urlStudio);
  u.searchParams.set('atelier', 'photomontage');
  u.searchParams.set('travail', travailId);
  u.hash = '';
  return u.toString();
}

export interface MessageAtelier {
  type: typeof TYPE_MESSAGE_ATELIER;
  version: 1;
  travail: string;
  session: string;
  photo_url: string;
  plan_url: string;
  /** LOT P5-SITE — masque PROPOSÉ de l'existant (`atelier.masque_path`, signé comme la photo et le plan) ; facultatif. */
  masque_url?: string;
  expire_le: string;
}

export function messageAtelier(travail: string, session: string, photoUrl: string, planUrl: string, maintenantMs: number, masqueUrl: string | null = null): MessageAtelier {
  return {
    type: TYPE_MESSAGE_ATELIER, version: 1, travail, session, photo_url: photoUrl, plan_url: planUrl,
    ...(masqueUrl ? { masque_url: masqueUrl } : {}),
    expire_le: new Date(maintenantMs + DUREE_URL_ATELIER_S * 1000).toISOString(),
  };
}

export type DecisionCalage =
  | { type: 'ignore'; raison: string } | { type: 'recu' } | { type: 'calage'; calage: CalageClient; egout?: EgoutAtelier | null } | { type: 'refus'; raison: string }
  /** LOT P5-SITE — zone à effacer corrigée, envoyée par l'atelier AVANT le calage : à garder jusqu'au calage. */
  | { type: 'masque'; masque: MasqueRecu };

/**
 * Filtre pur d'un message reçu par la page Mimmoza pendant que l'atelier est ouvert.
 * `deLaFenetre` : vrai si `event.source` est la fenêtre ouverte par le site pour CE travail.
 */
export function examinerMessageCalage(evt: { origin: string; data: unknown }, origineStudio: string, deLaFenetre: boolean, travailAttendu: string): DecisionCalage {
  if (evt.origin !== origineStudio) return { type: 'ignore', raison: `origine non autorisée (${String(evt.origin)})` };
  if (!deLaFenetre) return { type: 'ignore', raison: 'message d’une autre fenêtre' };
  const d = evt.data;
  if (!estObj(d) || (d.type !== TYPE_MESSAGE_CALAGE && d.type !== TYPE_MESSAGE_RECU && d.type !== TYPE_MESSAGE_MASQUE_EXISTANT)) return { type: 'ignore', raison: 'autre message' };
  if (d.travail !== travailAttendu) return { type: 'ignore', raison: 'autre travail' };
  if (d.type === TYPE_MESSAGE_RECU) return { type: 'recu' };
  if (d.type === TYPE_MESSAGE_MASQUE_EXISTANT) {
    const m = lireMessageMasqueExistant(d, travailAttendu);
    return m.ok ? { type: 'masque', masque: m.valeur } : { type: 'refus', raison: m.erreur };
  }
  const c = lireCalageClient(d.calage_client);
  if (!c.ok) return { type: 'refus', raison: c.erreur };
  // LOT X7 — hauteur à l'égout saisie (facultative) : présente mais illisible → refus (jamais ignorée en silence).
  if (d.egout_saisi === undefined || d.egout_saisi === null) return { type: 'calage', calage: c.valeur, egout: null };
  const eg = lireEgoutAtelier(d.egout_saisi);
  if (!eg.ok) return { type: 'refus', raison: eg.erreur };
  return { type: 'calage', calage: c.valeur, egout: eg.valeur };
}

/** LOT X7 — hauteur à l'égout saisie dans l'atelier (message `mimmoza-calage-v1`, clé `egout_saisi`). */
export interface EgoutAtelier {
  valeur_m: number;
  statut: 'confirmee';
  source: string;
  batiment?: string;
}

/** Bornes de l'atelier (Studio, BORNES_EGOUT_SAISI_M) : 2 à 15 m. */
export const BORNES_EGOUT_ATELIER_M = [2, 15] as const;

export function lireEgoutAtelier(x: unknown): Validation<EgoutAtelier> {
  if (!estObj(x)) return { ok: false, erreur: 'Hauteur à l’égout saisie illisible.' };
  const inconnue = Object.keys(x).find((k) => !['valeur_m', 'statut', 'source', 'batiment'].includes(k));
  if (inconnue) return { ok: false, erreur: `Hauteur à l’égout saisie : champ « ${inconnue} » inconnu.` };
  const v = x.valeur_m;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < BORNES_EGOUT_ATELIER_M[0] || v > BORNES_EGOUT_ATELIER_M[1]) return { ok: false, erreur: `Hauteur à l’égout saisie hors bornes (${BORNES_EGOUT_ATELIER_M[0]} à ${BORNES_EGOUT_ATELIER_M[1]} m).` };
  if (x.statut !== 'confirmee') return { ok: false, erreur: 'Hauteur à l’égout saisie : statut « confirmee » attendu.' };
  if (typeof x.source !== 'string' || !x.source.trim() || x.source.length > 200) return { ok: false, erreur: 'Hauteur à l’égout saisie : source attendue.' };
  if (x.batiment !== undefined && (typeof x.batiment !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(x.batiment))) return { ok: false, erreur: 'Hauteur à l’égout saisie : bâtiment illisible.' };
  return { ok: true, valeur: { valeur_m: Math.round(v * 100) / 100, statut: 'confirmee', source: x.source.trim(), ...(typeof x.batiment === 'string' ? { batiment: x.batiment } : {}) } };
}

/**
 * LOT X7 — fiche dont le projet d'extension porte la hauteur à l'égout SAISIE (statut « confirmee ») sur la maison
 * conservée visée (`batiment`, sinon celle de l'extension). Refus si la fiche n'a pas de projet d'extension lisible,
 * si la maison visée n'est pas conservée, ou si le projet obtenu est refusé par le contrat. Pur.
 */
export function ficheAvecEgoutSaisi(fiche: Obj, egout: EgoutAtelier): Validation<Obj> {
  const lu = lireProjetExtension(fiche.projet_extension);
  if (!lu.ok || lu.projet.nature !== 'extension' || !lu.projet.extension) return { ok: false, erreur: 'La hauteur à l’égout saisie concerne une maison conservée, mais l’image d’origine n’a pas de projet d’extension.' };
  const cible = egout.batiment ?? lu.projet.extension.existantId;
  const brut = fiche.projet_extension as Obj;
  const existants = Array.isArray(brut.existants) ? (brut.existants as Obj[]) : [];
  const e = existants.find((x) => x.id === cible);
  if (!e || e.mode !== 'conserver') return { ok: false, erreur: 'La hauteur à l’égout saisie vise un bâtiment qui n’est pas la maison conservée du projet.' };
  const donnee = { valeur: egout.valeur_m, statut: 'confirmee', source: `${egout.source} (hauteur à l’égout saisie par l’utilisateur)`.slice(0, 300) };
  const projet = { ...brut, existants: existants.map((x) => (x.id === cible ? { ...x, hauteurEgoutM: donnee } : x)) };
  const v = lireProjetExtension(projet);
  if (!v.ok) return { ok: false, erreur: `Projet d’extension refusé avec la hauteur saisie : ${v.erreurs.slice(0, 2).join(' ; ')}` };
  return { ok: true, valeur: { ...fiche, projet_extension: projet } };
}

/**
 * Options du nouveau travail : celles de l'image d'origine, avec le calage validé (revalidées : mêmes règles que la base).
 * Fond « photo de la rue » : le calage porte sur LA photo de l'image d'origine — `photo_rue.id` est fixé sur
 * `resultat.photomontage.source_photo.id` (sinon la machine de rendu pourrait en choisir une autre et le calage échouerait).
 */
export function optionsAvecCalage(optionsOrigine: unknown, calage: CalageClient, photomontage: PhotomontageResultat | null = null, masque: MasqueExistantOption | null = null): Validation<OptionsImage> {
  const o: Record<string, unknown> = estObj(optionsOrigine) ? { ...optionsOrigine } : {};
  // LOT P5-SITE : la zone à effacer d'une image précédente portait sur SON calage ; seule celle de cet atelier est jointe.
  delete o.masque_existant;
  if (masque) o.masque_existant = masque;
  if (o.fond === 'photo_rue') {
    const id = photomontage?.source_photo?.type === 'panoramax' ? photomontage.source_photo.id : null;
    if (!id || !RE_UUID.test(id)) return { ok: false, erreur: 'La photo de rue de l’image d’origine n’est pas identifiée dans le résultat : le placement ne peut pas lui être réappliqué.' };
    o.photo_rue = { id };
  }
  const v = validerOptions('image', { ...o, calage_client: calage });
  if (!v.ok) return v;
  const im = v.valeur as OptionsImage;
  if (!im.fond) return { ok: false, erreur: 'L’image d’origine n’était pas demandée sur une photo : aucun calage à appliquer.' };
  return { ok: true, valeur: im };
}

/** Fiche du nouveau travail : celle de l'image d'origine (même projet), sans son devis, avec la trace de la reprise. */
export function ficheReprise(ficheOrigine: unknown, travailOrigine: string, egout: EgoutAtelier | null = null): Validation<Obj> {
  if (!estObj(ficheOrigine) || !RE_UUID.test(travailOrigine)) return { ok: false, erreur: 'La fiche de l’image d’origine est illisible.' };
  const { devis_id: _devis, reprise_de: _reprise, ...reste } = ficheOrigine;
  const base = { ...reste, reprise_de: travailOrigine };
  // LOT X7 — hauteur à l'égout saisie dans l'atelier : posée CONFIRMÉE dans le projet d'extension du nouveau travail.
  return egout ? ficheAvecEgoutSaisi(base, egout) : { ok: true, valeur: base };
}
