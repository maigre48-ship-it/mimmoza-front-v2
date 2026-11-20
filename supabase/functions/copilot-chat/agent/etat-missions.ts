// supabase/functions/copilot-chat/agent/etat-missions.ts
// =============================================================================
// VIS-19 (20/11/2026) — quand injecter le bloc « ÉTAT RÉEL DES MISSIONS » (VIS-16, plaquette.ts blocEtatMissions) ?
// Module PUR (testé par Deno). Avant : à CHAQUE message de chaque conversation ayant une mission (coût en jetons à
// chaque tour). Désormais seulement :
//   - si le tour concerne la 3D / le rendu / la plaquette (MÊMES détecteurs que `studioAuTour` / `plaquetteAuTour`
//     d'index.ts : carte de brief / de forme du message, demandePlaquette, studioPertinent sur le message et la
//     dernière réponse) ou les missions elles-mêmes (« mission », « conception », « où en est »…) ;
//   - ou si une mission de la conversation a bougé (`maj_le`, mis à jour par la base à chaque changement de statut ou
//     d'avancement) depuis le dernier message de la conversation — l'état écrit plus haut est alors périmé.
// =============================================================================
import { demandePlaquette } from './plaquette.ts';
import { studioPertinent } from './studio.ts';

export interface MissionMaj { statut: string; maj_le?: string | null }

export interface TourEtatMissions {
  /** Message reçu (pas encore en base). */
  messageCourant: string;
  /** Dernière réponse de Mimmo (dernier message en base, s'il est de l'assistant). */
  dernierAssistant: string | null;
  /** Carte de brief / de forme validée dans le message (contexte `brief_carte` / `forme_carte`). */
  carte: boolean;
  /** Missions de la conversation (les plus récentes). */
  missions: readonly MissionMaj[];
  /** Date du dernier message de la conversation en base (null : premier message). */
  dernierMessageLe: string | null;
}

const RE_MISSION = /(^|[^\p{L}])(missions?|conceptions?|avancement|o[uù]\s+en\s+(?:est|sont|êtes|es)|termin[ée]e?s?|lanc[ée]e?s?)(?![\p{L}])/iu;

/** Le message parle-t-il des missions (suivi, conception, avancement) ? */
export function tourParleDesMissions(texte: string | null | undefined): boolean {
  return RE_MISSION.test(texte ?? '');
}

/** Une mission a-t-elle bougé depuis le dernier message ? (date absente ou illisible : oui, par prudence) */
export function missionChangeeDepuis(missions: readonly MissionMaj[], dernierMessageLe: string | null): boolean {
  if (!missions.length) return false;
  if (!dernierMessageLe) return true;
  const t0 = Date.parse(dernierMessageLe);
  if (!Number.isFinite(t0)) return true;
  return missions.some((m) => {
    const t = m.maj_le ? Date.parse(m.maj_le) : Number.NaN;
    return !Number.isFinite(t) || t > t0;
  });
}

/** Le bloc « ÉTAT RÉEL DES MISSIONS » est-il utile à ce tour ? */
export function etatMissionsUtile(e: TourEtatMissions): boolean {
  if (!e.missions.length) return false;
  if (e.carte || demandePlaquette(e.messageCourant) || studioPertinent([e.messageCourant, e.dernierAssistant ?? ''])) return true;
  if (tourParleDesMissions(e.messageCourant)) return true;
  return missionChangeeDepuis(e.missions, e.dernierMessageLe);
}
