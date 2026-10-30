// src/spaces/copilot/agent/conception/projetConception.ts
// Projet Studio v2 d'une conception : la parcelle réelle (contour cadastral),
// au même format que « Voir en 3D » (projetChat.construireProjetChat).
import { construireProjetChat, type IssueProjetChat } from '../../studio3d/projetChat';
import type { Conception } from './conceptionLogique';

export const conversationConception = (conceptionId: string): string => `conception-${conceptionId}`;

export function parcellesConception(c: Pick<Conception, 'idu' | 'parcelle'>) {
  return c.parcelle ? [{ id: c.idu, feature: { type: 'Feature', properties: { id: c.idu }, geometry: c.parcelle.geometrie } }] : [];
}

export const inseeConception = (idu: string): string | null => (/^\d{5}/.test(idu) ? idu.slice(0, 5) : null);

export function projetConception(c: Conception, sessionId: string, origine: string, pageSansAncre: string): IssueProjetChat {
  if (!c.parcelle) return { ok: false, erreur: 'contour de la parcelle manquant' };
  return construireProjetChat({
    conversationId: conversationConception(c.id), sessionId, origine, retourUrl: pageSansAncre, revision: 0,
    horodatage: new Date().toISOString(), parcelles: parcellesConception(c), communeInsee: inseeConception(c.idu),
    adresse: c.commune, pointAdresse: null, relief: null,
  });
}
