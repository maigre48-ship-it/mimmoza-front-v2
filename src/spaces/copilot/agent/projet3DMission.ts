// src/spaces/copilot/agent/projet3DMission.ts
// =============================================================================
// LOT VIS-15 — « Ouvrir mon projet en 3D » à la fin d'une mission de CONCEPTION (logique pure, testée par node).
//
// 19/11/2026 : la mission « Conception du projet » se terminait avec seulement « Ouvrir le rapport en pleine page ».
// Le fondateur : « je m'en fous du rapport, je veux ouvrir mon projet en 3D ». L'action principale devient l'ouverture
// de la 3D : le serveur prépare le volume de la conception de la mission (copilot-chat, action directe
// « preparer_3d_conception » = outil studio_preparer_3d, moteur déterministe, aucun jeton), puis la page ouvre le
// Studio par le parcours existant « Voir en 3D » (comme « Ouvrir la 3D préparée » du Dossier 3D).
// =============================================================================
import type { Mission } from './agent.types';
import { referencesMission } from '../studio3d/missionPreparation3D.ts';

/** Même valeur que ACTION_PREPARER_3D_CONCEPTION côté serveur (supabase/functions/copilot-chat/agent/studio.ts). */
export const ACTION_PREPARER_3D_CONCEPTION = 'preparer_3d_conception';
/** Événement fenêtre écouté par la page MimmozIA (qui seule sait ouvrir le Studio). */
export const EVENEMENT_OUVRIR_PROJET_3D = 'mimmoza:ouvrir-projet-3d';

const STATUTS_FINIS = new Set(['terminee', 'budget_atteint']);

/** Une mission de conception terminée (même partiellement) ouvre son projet en 3D. */
export function missionConceptionOuvrable3D(m: Pick<Mission, 'type' | 'statut' | 'erreur'> | null | undefined): boolean {
  return !!m && m.type === 'conception' && STATUTS_FINIS.has(String(m.statut)) && !m.erreur;
}

/** Corps de l'action directe : la conception est celle de la mission ; les parcelles demandées sont contrôlées. */
export function corpsPreparation3D(m: Pick<Mission, 'id' | 'conversation_id' | 'criteres' | 'rapport'>): Record<string, unknown> {
  const idus = referencesMission(m as Mission).idus;
  return {
    action: ACTION_PREPARER_3D_CONCEPTION, mission_id: m.id,
    ...(m.conversation_id ? { conversation_id: m.conversation_id } : {}),
    ...(idus.length > 1 ? { parcel_ids: idus } : {}),
  };
}

/** Phrase de Mimmo à la clôture de la mission : il propose la suite lui-même. */
export function phraseSuiteConception(m: Pick<Mission, 'statut'>): string {
  return (m.statut === 'budget_atteint'
    ? 'La conception s’est arrêtée au plafond prévu, mais elle suffit pour une première 3D. '
    : 'Votre conception est prête. ')
    + 'Voulez-vous voir le projet en 3D ? Ensuite, je peux préparer le pack plaquette (visuels de commercialisation).';
}

/** Message envoyé à Mimmo par le bouton secondaire « Préparer la plaquette ». */
export const MESSAGE_PACK_PLAQUETTE = 'Prépare le pack plaquette de ce projet (visuels de commercialisation), à partir de la 3D de la conception.';

export type IssuePreparation3D =
  | { ok: true; preparationId: string; gabaritRetenu: string | null; assiette: string | null }
  | { ok: false; message: string };

/** Texte du serveur destiné au modèle → phrase pour l'utilisateur (consignes « Dis-le… », « propose… » retirées). */
export function phraseUtilisateur(message: string): string {
  const t = message.replace(/^(?:AUCUNE 3D PRÉPARÉE|PAS ENCORE DE CONCEPTION|RIEN N’A ÉTÉ LANCÉ)\s*[:.]?\s*/u, '')
    .split(/\s(?:Dis-le|Dis en|Propose|N’annonce|N'annonce)\b/u)[0].trim();
  const p = t.charAt(0).toUpperCase() + t.slice(1);
  return p && !/[.!?]$/.test(p) ? `${p}.` : p;
}

/** Lit la réponse de l'action directe « preparer_3d_conception ». */
export function lireIssuePreparation3D(r: unknown): IssuePreparation3D {
  const o = r && typeof r === 'object' ? r as Record<string, unknown> : {};
  const d = o.data && typeof o.data === 'object' ? o.data as Record<string, unknown> : {};
  if (o.status === 'ok' && typeof d.preparation_id === 'string' && d.preparation_id) {
    return {
      ok: true, preparationId: d.preparation_id,
      gabaritRetenu: typeof d.gabarit_retenu === 'string' ? d.gabarit_retenu : null,
      assiette: typeof d.assiette === 'string' ? d.assiette : null,
    };
  }
  if (o.status === 'not_found') return { ok: false, message: 'La conception de cette mission est introuvable : relancez une mission de conception pour préparer la 3D.' };
  const m = typeof o.message === 'string' && o.message.trim() ? phraseUtilisateur(o.message) : '';
  return { ok: false, message: m || 'La 3D n’a pas pu être préparée. Réessayez dans un instant.' };
}

interface AppelOutil { name: string; status?: string; output?: unknown }

/**
 * VIS-15 : `studio_preparer_3d` sans conception (« Aucun résultat » sur une carte technique vide, 19/11) ou sur une
 * conception qui ne couvre pas l'assiette → une phrase claire à la place de la carte. null pour tout autre appel.
 */
export function phraseStudioSansConception(tc: AppelOutil): string | null {
  if (tc.name !== 'studio_preparer_3d' || tc.status === 'running') return null;
  const o = tc.output && typeof tc.output === 'object' ? tc.output as Record<string, unknown> : {};
  const statut = String(tc.status ?? o.status ?? '');
  const message = typeof o.message === 'string' ? o.message : '';
  if (statut === 'not_found' || o.status === 'not_found') {
    return 'Pas encore de 3D : ce projet n’a pas encore de conception enregistrée (parcelle, règles, programme). Elle se prépare avec une mission de conception ; la 3D s’ouvre ensuite en un clic.';
  }
  if (/^AUCUNE 3D PRÉPARÉE/u.test(message)) return phraseUtilisateur(message);
  return null;
}
