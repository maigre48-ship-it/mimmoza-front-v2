// src/spaces/promoteur/shared/briefProjet.store.ts
// =============================================================================
// VIS-04 (18/11/2026) — PERSISTANCE DU BRIEF PROJET (un par étude, versionné).
//
// Convention du dépôt pour les données d'une étude promoteur : userStorage (localStorage SCOPÉ PAR COMPTE),
// clé par étude — comme `mimmoza.programme.{studyId}` (programme) et `mimmoza.promoteur.style-tendances.{studyId}`
// (Style & tendances). Clé : `mimmoza.promoteur.brief-projet.{studyId | hors-etude}`.
// Aucune table Supabase n'est créée : le serveur (chat) reçoit le brief dans le bloc ```mimmoza-brief``` du
// message de l'utilisateur, comme l'habillage (voir briefCreatif.ts / studio.ts briefDuMessage).
//
// Le brief est ASSEMBLÉ à la lecture depuis ses sources (Style & tendances, Programmation, habillage mémorisé,
// réglages de rendu) : une source mise à jour est reprise sans autre clic ; la révision n'augmente que si le
// contenu transmis au rendu change.
// =============================================================================

import { userStorage } from '@/lib/storage/userScopedStorage';
import {
  assemblerBriefProjet, champsContrat, lireBriefProjet, type BriefProjet, type ChampsContratBrief, type ReglagesRendu,
  type SourceHabillage, type SourceProgramme, type SourceReference, type SourceStyle,
} from '@/lib/studio/briefProjet';
import { EDITORIAL_SOURCES } from '@/spaces/promoteur/pages/designDirections';
import { programmeKey } from '@/spaces/promoteur/store/promoteurProgramme.store';
import { getActiveStudyId } from '@/spaces/promoteur/shared/promoteurSnapshot.store';
import { etudeDuChat } from '@/spaces/copilot/studio3d/projetChat';

export const BRIEF_PROJET_EVENT = 'mimmoza:brief-projet-updated';
export const cleBriefProjet = (studyId: string | null) => `mimmoza.promoteur.brief-projet.${studyId ?? 'hors-etude'}`;
const cleStyle = (studyId: string | null) => `mimmoza.promoteur.style-tendances.${studyId ?? 'hors-etude'}`;

function lireJson(cle: string): unknown {
  try { return JSON.parse(userStorage.getItem(cle) ?? 'null'); } catch { return null; }
}

/** Brief enregistré (sans réassemblage) ; null si aucun. */
export function briefProjetEnregistre(studyId: string | null): BriefProjet | null {
  return lireBriefProjet(lireJson(cleBriefProjet(studyId)));
}

/** Habillage mémorisé avec le brief (dernier choix de la carte « Brief créatif » / fiche Espace 3D). */
function habillageMemorise(studyId: string | null): SourceHabillage | null {
  const brut = lireJson(`${cleBriefProjet(studyId)}.habillage`);
  return brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as SourceHabillage : null;
}

function sourceStyle(studyId: string | null): { style: SourceStyle | null; references: SourceReference[] } {
  const d = lireJson(cleStyle(studyId)) as { brief?: SourceStyle | null; customSources?: SourceReference[] } | null;
  const style = d?.brief && Array.isArray(d.brief.directions) ? d.brief : null;
  return { style, references: [...EDITORIAL_SOURCES, ...(Array.isArray(d?.customSources) ? d!.customSources : [])] };
}

function sourceProgramme(studyId: string | null): SourceProgramme | null {
  if (!studyId) return null;
  const d = lireJson(programmeKey(studyId)) as { mix?: SourceProgramme } | null;
  return d?.mix && Array.isArray(d.mix.batiments) ? d.mix : null;
}

function enregistrer(studyId: string | null, b: BriefProjet, avant: BriefProjet | null): void {
  if (avant && avant.revision === b.revision && avant.majLe === b.majLe) return;
  userStorage.setItem(cleBriefProjet(studyId), JSON.stringify(b));
  try { window.dispatchEvent(new CustomEvent(BRIEF_PROJET_EVENT, { detail: { studyId, revision: b.revision } })); } catch { /* hors navigateur */ }
}

/**
 * Brief de l'étude, réassemblé depuis ses sources et ENREGISTRÉ s'il a changé. `reglages` : choix du promoteur
 * (gamme, vues, ambiance, saison, précisions) ; `habillage` : choix d'habillage à mémoriser.
 */
export function briefProjetDeLEtude(studyId: string | null, maj: { reglages?: ReglagesRendu; habillage?: SourceHabillage | null } = {}): BriefProjet {
  const avant = briefProjetEnregistre(studyId);
  if (maj.habillage !== undefined) {
    if (maj.habillage) userStorage.setItem(`${cleBriefProjet(studyId)}.habillage`, JSON.stringify(maj.habillage));
  }
  const habillage = maj.habillage !== undefined ? maj.habillage : habillageMemorise(studyId);
  const { style, references } = sourceStyle(studyId);
  const maintenant = new Date().toISOString();
  const b = assemblerBriefProjet({
    etudeId: studyId, precedent: avant, style, references, programme: sourceProgramme(studyId),
    habillage, reglages: maj.reglages, maintenant,
    dates: maj.habillage ? { habillage: maintenant } : {},
  });
  enregistrer(studyId, b, avant);
  return b;
}

/** Étude rattachée à la conversation (la même que le métré / bilan, figée par conversation). */
export function etudeDeLaConversation(conversationId: string): string | null {
  let stockage: Storage | null = null;
  try { stockage = localStorage; } catch { stockage = null; }
  return etudeDuChat(conversationId, getActiveStudyId(), stockage);
}

/** Champs du contrat pour une conversation (chat, FilmVisitePanel) ; null sans étude rattachée. */
export function champsBriefDeLaConversation(conversationId: string, maj: { reglages?: ReglagesRendu; habillage?: SourceHabillage | null } = {}): { brief: BriefProjet; champs: ChampsContratBrief } | null {
  const etude = etudeDeLaConversation(conversationId);
  if (!etude) return null;
  const brief = briefProjetDeLEtude(etude, maj);
  return { brief, champs: champsContrat(brief) };
}
