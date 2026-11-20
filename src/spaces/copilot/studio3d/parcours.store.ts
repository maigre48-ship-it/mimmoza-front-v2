// src/spaces/copilot/studio3d/parcours.store.ts
// =============================================================================
// VIS-17 (20/11/2026) — mémoire NAVIGATEUR du parcours guidé, par conversation :
//   · type choisi (Images / Film / Visite 360°) dans le sélecteur ;
//   · réglages du film et de la visite choisis dans la feuille « Film, visite 360° ou image » (personnalisation gardée,
//     reprise par l'étape 6 « Scénario du film » / « Pièces & points de vue ») ;
//   · instantané du parcours courant (envoyé au serveur avec chaque message : context.parcours).
// Les vues, la lumière, la saison et la gamme vivent dans le brief projet de l'étude (briefProjet.store), pas ici.
// Clé : `mimmoza.parcours.{conversationId}` (localStorage ; jamais bloquant).
// =============================================================================
import type { InstantaneParcours, ReglagesFilm, ReglagesVisite, TypeParcours } from '@/lib/studio/parcours';

export const PARCOURS_EVENT = 'mimmoza:parcours-maj';
export interface MemoireParcours { type: TypeParcours | null; film: ReglagesFilm | null; visite: ReglagesVisite | null }
const VIDE: MemoireParcours = { type: null, film: null, visite: null };
const cle = (conversationId: string) => `mimmoza.parcours.${conversationId}`;

export function lireMemoireParcours(conversationId: string | null | undefined): MemoireParcours {
  if (!conversationId) return VIDE;
  try {
    const brut = JSON.parse(window.localStorage.getItem(cle(conversationId)) ?? 'null') as Partial<MemoireParcours> | null;
    if (!brut || typeof brut !== 'object') return VIDE;
    return {
      type: brut.type === 'image' || brut.type === 'film' || brut.type === 'visite' ? brut.type : null,
      film: brut.film && typeof brut.film === 'object' ? brut.film : null,
      visite: brut.visite && typeof brut.visite === 'object' ? brut.visite : null,
    };
  } catch { return VIDE; }
}

export function majMemoireParcours(conversationId: string | null | undefined, maj: Partial<MemoireParcours>): void {
  if (!conversationId) return;
  const suivante = { ...lireMemoireParcours(conversationId), ...maj };
  try { window.localStorage.setItem(cle(conversationId), JSON.stringify(suivante)); } catch { /* stockage indisponible */ }
  try { window.dispatchEvent(new CustomEvent(PARCOURS_EVENT, { detail: { conversationId } })); } catch { /* hors navigateur */ }
}

// Instantané courant (tenu par useParcours, lu par useCopilot à l'envoi d'un message).
let instantane: { conversationId: string | null; valeur: InstantaneParcours } | null = null;
export function publierInstantaneParcours(conversationId: string | null, valeur: InstantaneParcours): void { instantane = { conversationId, valeur }; }
export function instantaneParcoursPour(conversationId: string | null | undefined): InstantaneParcours | null {
  return instantane && instantane.conversationId === (conversationId ?? null) ? instantane.valeur : null;
}

/** Studio intégré (même origine) : étape et sous-onglet ouverts au prochain chargement (mémoire des colonnes du Studio). */
export const CLE_COLONNES_STUDIO = 'mimmozia.ui.colonnes';
export function preparerEtapeStudio(etape: 'batiment' | 'amenagement', sous: string): void {
  try {
    const brut = JSON.parse(window.localStorage.getItem(CLE_COLONNES_STUDIO) ?? 'null') as Record<string, unknown> | null;
    const base = brut && typeof brut === 'object' ? brut : {};
    const sousAvant = base.sous && typeof base.sous === 'object' ? base.sous as Record<string, string> : {};
    window.localStorage.setItem(CLE_COLONNES_STUDIO, JSON.stringify({
      panneauReplie: false, expert: false, ...base, etape, sous: { ...sousAvant, [etape]: sous },
    }));
  } catch { /* stockage indisponible : le Studio s'ouvre sur sa dernière étape */ }
}

/** Événement : ouvrir le Studio intégré sur une étape (MimmozIAPage l'écoute). */
export const EVENEMENT_PARCOURS_STUDIO = 'mimmoza:parcours-studio';
export interface DemandeParcoursStudio {
  etape: 'batiment' | 'amenagement';
  sous: string;
  /** Réponse de la page (message à afficher), null si le Studio s'est ouvert sans remarque. */
  repondre: (message: string | null) => void;
  prise?: boolean;
}
