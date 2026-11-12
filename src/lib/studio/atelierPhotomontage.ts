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
  | { type: 'ignore'; raison: string } | { type: 'recu' } | { type: 'calage'; calage: CalageClient } | { type: 'refus'; raison: string }
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
  return { type: 'calage', calage: c.valeur };
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
export function ficheReprise(ficheOrigine: unknown, travailOrigine: string): Validation<Obj> {
  if (!estObj(ficheOrigine) || !RE_UUID.test(travailOrigine)) return { ok: false, erreur: 'La fiche de l’image d’origine est illisible.' };
  const { devis_id: _devis, reprise_de: _reprise, ...reste } = ficheOrigine;
  return { ok: true, valeur: { ...reste, reprise_de: travailOrigine } };
}
