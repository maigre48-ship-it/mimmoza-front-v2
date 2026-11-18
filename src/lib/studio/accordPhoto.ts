// FINITIONS DU 18/11/2026 — carte « Utiliser cette photo pour l'image ? » (mode d'accord 'bouton' du serveur,
// constante ACCORD_PHOTO_JOINTE de supabase/functions/copilot-chat/agent/photo-projet.ts).
// Pur. Le serveur décide seul si la carte est demandée (`data.accord_photo_requis`) ; le site n'invente rien : il
// affiche le titre, le texte et les deux réponses EXACTES que le serveur reconnaît, sur le DERNIER appel de parcours
// seulement (une fois la réponse donnée, le tour suivant ne la redemande plus).

export interface DemandeAccordPhoto {
  readonly titre: string;
  readonly texte: string;
  readonly oui: string;
  readonly non: string;
}

interface AppelOutil { readonly id: string; readonly name: string; readonly status?: string; readonly output?: unknown }
interface MessageAvecAppels { readonly toolCalls?: readonly AppelOutil[] }

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Outils de parcours qui peuvent porter la photo du projet. */
export const OUTILS_PHOTO_PROJET: ReadonlySet<string> = new Set(['extension_maison', 'maison_neuve']);

/** Lit `data.accord_photo_requis` d'une sortie d'outil ; null si absent ou mal formé. */
export function lireDemandeAccordPhoto(sortie: unknown): DemandeAccordPhoto | null {
  if (!estObj(sortie) || sortie.status !== 'ok' || !estObj(sortie.data) || !estObj(sortie.data.accord_photo_requis)) return null;
  const a = sortie.data.accord_photo_requis;
  const titre = txt(a.titre, 120); const texte = txt(a.texte, 400);
  const choix = Array.isArray(a.choix) ? a.choix : [];
  const oui = txt(choix[0], 120); const non = txt(choix[1], 120);
  return titre && texte && oui && non ? { titre, texte, oui, non } : null;
}

/** Identifiant du dernier appel de parcours de la conversation qui porte une photo du projet (null s'il n'y en a pas). */
export function dernierAppelPhotoProjet(messages: readonly MessageAvecAppels[]): string | null {
  let id: string | null = null;
  for (const m of messages) for (const a of m.toolCalls ?? []) {
    if (!OUTILS_PHOTO_PROJET.has(a.name) || !estObj(a.output) || !estObj(a.output.data)) continue;
    if (a.output.data.photo_projet !== undefined) id = a.id;
  }
  return id;
}
