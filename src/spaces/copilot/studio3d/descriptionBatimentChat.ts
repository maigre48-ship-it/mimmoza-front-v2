// src/spaces/copilot/studio3d/descriptionBatimentChat.ts
// =============================================================================
// VIS-22 — carte « Votre bâtiment » du chat : logique PURE (testée par descriptionBatimentChat.test.ts, `node --test`).
// Aucune E/S, aucun React. Le contrat et ses traductions vivent dans src/lib/studio/descriptionBatiment.ts.
//
// - `lireCarteBatiment` : sortie de l'outil `studio_decrire_batiment` relue SANS confiance (description revalidée en
//   mode strict : une sortie abîmée n'affiche aucune carte) ;
// - `modifier…` : chaque modification de la carte repasse par la validation du contrat (cohérences rétablies et dites) ;
// - `descriptionCourante` : description en vigueur dans la conversation — même règle que le serveur
//   (studio.ts::descriptionDuFil) : celle du DERNIER message d'habillage, sinon aucune ;
// - `envoyeeApres` : la carte sait qu'elle a été envoyée (bouton « Reproduire en 3D » déjà cliqué).
// =============================================================================
import {
  bilanRendu, descriptionDuMessage, MENTION_PHOTO, OUTIL_DECRIRE_BATIMENT, validerDescription, toitEnPenteBatiment,
  type DescriptionBatiment, type ElementRemarquable, type LigneBilan,
} from '../../../lib/studio/descriptionBatiment.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface CarteBatiment {
  description: DescriptionBatiment;
  /** Ce que le serveur a ajusté dans la proposition (phrases courtes). */
  corrections: string[];
  /** Mention « référence de style » quand la description vient d'une photo. */
  mentionPhoto: string | null;
}

/** Sortie de `studio_decrire_batiment` → carte ; null : autre outil, appel en cours, sortie refusée ou illisible. */
export function lireCarteBatiment(appel: { name: string; status?: string; output?: unknown }): CarteBatiment | null {
  if (appel.name !== OUTIL_DECRIRE_BATIMENT || appel.status === 'running') return null;
  const o = appel.output;
  if (!estObj(o) || o.status !== 'ok' || !estObj(o.data) || o.data.carte !== 'batiment') return null;
  const v = validerDescription(o.data.description, true);
  if (!v.ok) return null;
  const corrections = Array.isArray(o.data.corrections) ? o.data.corrections.filter((c): c is string => typeof c === 'string').slice(0, 6).map((c) => c.slice(0, 160)) : [];
  return { description: v.valeur, corrections, mentionPhoto: v.valeur.origine === 'photo' ? MENTION_PHOTO : null };
}

export interface Modification { description: DescriptionBatiment; /** Ajustements de cohérence à dire à l'utilisateur. */ notes: string[] }

/** Applique une modification de la carte et rétablit les cohérences du contrat (jamais une description invalide). */
export function modifierDescription(d: DescriptionBatiment, patch: Partial<DescriptionBatiment>): Modification {
  const brut: DescriptionBatiment = { ...d, ...patch };
  // Passage à un toit en pente sans couverture choisie : tuiles proposées sans le signaler comme une correction.
  if (toitEnPenteBatiment(brut.toiture.forme) && !brut.toiture.couverture) brut.toiture = { ...brut.toiture, couverture: d.toiture.couverture ?? 'tuiles' };
  if (!toitEnPenteBatiment(brut.toiture.forme)) brut.toiture = { ...brut.toiture, couverture: null };
  if (brut.ouvertures.volets === 'aucun') brut.ouvertures = { ...brut.ouvertures, couleurVolets: null };
  // Un point que l'utilisateur vient de régler n'est plus « à vérifier ».
  const regles = new Set<string>(Object.keys(patch));
  if (patch.ouvertures) { regles.add('menuiseries'); regles.add('volets'); }
  if (patch.balcons) regles.add('garde_corps');
  brut.incertains = d.incertains.filter((c) => !regles.has(c));
  const v = validerDescription(brut, false);
  // Par construction la carte ne produit que des valeurs du contrat ; en cas d'échec la description d'avant est gardée.
  return v.ok ? { description: v.valeur, notes: v.corrections } : { description: d, notes: [] };
}

export function retirerElement(d: DescriptionBatiment, index: number): Modification {
  return modifierDescription(d, { elements: d.elements.filter((_, i) => i !== index) });
}
export function ajouterElement(d: DescriptionBatiment, type: ElementRemarquable['type']): Modification {
  if (type === 'autre' || d.elements.length >= 8 || d.elements.some((e) => e.type === type && e.cote === null)) return { description: d, notes: [] };
  return modifierDescription(d, { elements: [...d.elements, { type, couleur: null, cote: null, precision: null }] });
}

export interface ResumeBilan { reproduits: number; approches: number; nonReproduits: number; aVerifier: number; lignes: LigneBilan[] }
export function resumeBilan(d: DescriptionBatiment): ResumeBilan {
  const lignes = bilanRendu(d);
  return {
    lignes,
    reproduits: lignes.filter((l) => l.etat === 'reproduit').length,
    approches: lignes.filter((l) => l.etat === 'approche').length,
    nonReproduits: lignes.filter((l) => l.etat === 'non_reproduit').length,
    aVerifier: lignes.filter((l) => l.aVerifier).length,
  };
}

/** Phrase de pied de carte : « 13 points repris, 1 approché, 1 pas encore reproduit ». */
export function phraseBilan(r: ResumeBilan): string {
  const s = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
  return [
    s(r.reproduits, 'point repris', 'points repris'),
    r.approches ? s(r.approches, 'approché', 'approchés') : null,
    r.nonReproduits ? s(r.nonReproduits, 'pas encore reproduit', 'pas encore reproduits') : null,
  ].filter(Boolean).join(' · ');
}

interface MessageLu { id: string; role: string; text: string }
const A_UN_BRIEF = /```mimmoza-brief[ \t]*\r?\n/;

/**
 * Description en vigueur dans la conversation — même règle que le serveur (studio.ts::descriptionDuFil) : celle du
 * DERNIER message d'habillage envoyé ; un habillage choisi ensuite dans l'Espace 3D la remplace. null : aucune.
 */
export function descriptionCourante(messages: readonly Pick<MessageLu, 'role' | 'text'>[]): DescriptionBatiment | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !A_UN_BRIEF.test(m.text)) continue;
    const v = descriptionDuMessage(m.text);
    return v?.ok ? v.valeur : null;
  }
  return null;
}

/** La description de cette carte (message `messageId`) a-t-elle été envoyée ensuite ? Renvoie la description envoyée. */
export function envoyeeApres(messages: readonly MessageLu[], messageId: string): DescriptionBatiment | null {
  const i = messages.findIndex((m) => m.id === messageId);
  if (i < 0) return null;
  for (let k = i + 1; k < messages.length; k++) {
    const m = messages[k];
    // Une autre carte « Votre bâtiment » plus bas (nouvelle description) : les envois suivants sont les siens.
    if (m.role !== 'user') continue;
    const v = descriptionDuMessage(m.text);
    if (v?.ok) return v.valeur;
  }
  return null;
}
