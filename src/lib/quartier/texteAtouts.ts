// src/lib/quartier/texteAtouts.ts
// =============================================================================
// VIS-70 — textes des atouts du quartier : carte du chat (Mimmo), page Quartier et dossier client (VIS-60, branchement
// décrit seulement). Aucun superlatif inventé : chaque phrase cite un lieu réel, sa distance et un temps estimé.
// Module PUR.
// =============================================================================
import { DEFINITIONS_CATEGORIES, type CategorieQuartier } from './categoriesQuartier.ts';
import { libelleDistance } from './tempsTrajet.ts';
import { lireAtouts, type AtoutsQuartier, type LieuQuartier } from './atoutsQuartier.ts';

export const OUTIL_QUARTIER_VENTE = 'quartier_atouts';
export const CARTE_QUARTIER = 'quartier-vente';

/** « 350 m · 5 min à pied · 2 min à vélo » */
export function ligneTemps(l: LieuQuartier): string {
  const p = [libelleDistance(l.distance_m), `${l.pied_min} min à pied`];
  if (l.velo_min !== null && l.distance_m >= 400) p.push(`${l.velo_min} min à vélo`);
  if (l.transport_min !== null) p.push(`≈ ${l.transport_min} min en transport`);
  return p.join(' · ');
}

/** Lignes « Catégorie — plus proche » pour une carte compacte (chat, PDF). */
export function lignesSynthese(a: AtoutsQuartier, max = 7): { categorie: CategorieQuartier; libelle: string; valeur: string }[] {
  return a.categories.slice(0, max).map((c) => ({
    categorie: c.id, libelle: c.libelle,
    valeur: c.etat === 'indisponible' ? 'Donnée indisponible'
      : c.plusProche ? `${c.plusProche.nom === c.plusProche.sousType ? c.plusProche.sousType : `${c.plusProche.nom} (${c.plusProche.sousType.split(' · ')[0]!.toLowerCase()})`} — ${ligneTemps(c.plusProche)}`
        : 'Aucun lieu recensé dans le rayon',
  }));
}

/** Bloc « Le quartier » du dossier client : titre, accroche, puis une ligne par catégorie renseignée, et les sources. */
export function texteDossierQuartier(a: AtoutsQuartier): { titre: string; accroche: string; lignes: [string, string][]; sources: string; mention: string } {
  const lignes = lignesSynthese(a).filter((l) => l.valeur !== 'Donnée indisponible').map((l) => [l.libelle, l.valeur] as [string, string]);
  return {
    titre: 'Le quartier',
    accroche: `${a.synthese.phrase} ${a.synthese.phraseTransports}`.trim(),
    lignes,
    sources: `Sources : ${a.sources.filter((s) => s.ok).map((s) => `${s.libelle} (${s.licence})`).join(' ; ')}.`,
    mention: 'Distances à vol d’oiseau ; temps estimés, indicatifs et non contractuels.',
  };
}

/** Résumé pour Mimmo (sortie d'outil) : court, factuel, sans recopier toute la liste. */
export function resumePourMimmo(a: AtoutsQuartier): string {
  const parts = [a.synthese.phrase, a.synthese.phraseTransports];
  for (const c of a.categories) if (c.id !== 'transports' && c.etat !== 'ok') parts.push(c.phrase);
  return parts.join(' ');
}

export interface CarteQuartierChat {
  readonly appelId: string;
  readonly atouts: AtoutsQuartier;
  readonly lienPage: string;
}

/** Carte d'un appel `quartier_atouts` terminé (null : autre outil, en cours, erreur, sortie illisible). */
export function lireCarteQuartier(tc: { id: string; name: string; status?: string; output?: unknown }): CarteQuartierChat | null {
  if (tc.name !== OUTIL_QUARTIER_VENTE || tc.status === 'running') return null;
  const o = tc.output as Record<string, unknown> | null | undefined;
  if (!o || o.status !== 'ok' || typeof o.data !== 'object' || o.data === null) return null;
  const d = o.data as Record<string, unknown>;
  if (d.carte !== CARTE_QUARTIER || typeof d.lien_page !== 'string') return null;
  const atouts = lireAtouts(d.atouts);
  return atouts ? { appelId: tc.id, atouts, lienPage: d.lien_page } : null;
}

/** Couleur d'une catégorie (pastilles). */
export const couleurCategorie = (c: CategorieQuartier): string => DEFINITIONS_CATEGORIES[c].couleur;
