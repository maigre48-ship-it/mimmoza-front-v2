// src/spaces/copilot/studio3d/variantesChat.ts
// =============================================================================
// LOT G7 (18/11/2026) — Carte « Variantes » du chat : logique PURE (testée par variantesChat.test.ts).
//
//   · `variantesDeConversation` : historique des variantes du projet d'extension (V1, V2…) relu dans la DERNIÈRE sortie
//     du parcours, et, pour chaque variante, l'image lancée pendant qu'elle était affichée (ordre de la conversation :
//     un rendu lancé après la variante n et avant la variante n+1 est celui de la variante n) ;
//   · `etatVignette` : état d'une image de variante (en cours, livrable, à valider, photo nécessaire, échec).
// Lecture défensive : une valeur absente ou illisible n'est jamais remplacée par une valeur inventée.
// =============================================================================

import { lireVariantes, type VarianteHistorique } from '../../../../supabase/functions/_shared/extension/variantesExtension.ts';
import { OUTIL_EXTENSION_MAISON } from './extensionMaison.ts';
import { lireIndiceSuivi, extensionSansPhotoReelle, type AppelOutil } from './suiviRenduChat.ts';
import type { TravailStudio } from '../../../lib/studio/travauxLogique.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface VarianteChat extends VarianteHistorique {
  /** Travail d'image lancé pendant que cette variante était affichée (le plus récent) ; null sinon. */
  readonly jobId: string | null;
}

export interface VariantesConversation {
  readonly variantes: readonly VarianteChat[];
  /** Appel du parcours qui porte la carte (le plus récent) ; null sans historique. */
  readonly appelId: string | null;
}

export interface MessageAvecAppels { readonly toolCalls?: readonly AppelOutil[] }

/** Historique des variantes et images rattachées, relu dans les messages (du plus ancien au plus récent). Pur. */
export function variantesDeConversation(messages: readonly MessageAvecAppels[]): VariantesConversation {
  let historique: VarianteHistorique[] = [];
  let appelId: string | null = null;
  let courante: number | null = null;
  const jobs = new Map<number, string>();
  for (const m of messages) {
    for (const a of m.toolCalls ?? []) {
      if (a.name === OUTIL_EXTENSION_MAISON && a.status === 'success' && estObj(a.output) && a.output.status === 'ok' && estObj(a.output.data)) {
        const d = a.output.data;
        const v = lireVariantes(d.variantes);
        if (v.length) { historique = v; appelId = a.id; }
        const n = estObj(d.etat) && typeof d.etat.variante === 'number' && Number.isInteger(d.etat.variante) ? d.etat.variante : null;
        if (n !== null) courante = n;
        continue;
      }
      const indice = lireIndiceSuivi(a);
      if (indice && courante !== null && (indice.type === 'image' || indice.type === null) && indice.origine !== 'etat') jobs.set(courante, indice.jobId);
    }
  }
  return { variantes: historique.map((v) => ({ ...v, jobId: jobs.get(v.n) ?? null })), appelId };
}

export type EtatVignette = 'aucune' | 'chargement' | 'en_cours' | 'livrable' | 'a_valider' | 'photo_requise' | 'echec';

/** État de l'image d'une variante, en mots simples. Pur. */
export function etatVignette(jobId: string | null, travail: TravailStudio | null): { etat: EtatVignette; libelle: string } {
  if (!jobId) return { etat: 'aucune', libelle: 'Pas encore d’image' };
  if (!travail) return { etat: 'chargement', libelle: 'Lecture…' };
  if (travail.statut === 'en_attente' || travail.statut === 'en_cours') return { etat: 'en_cours', libelle: 'Image en préparation' };
  if (travail.statut !== 'termine') return { etat: 'echec', libelle: 'Image non produite' };
  if (extensionSansPhotoReelle(travail)) return { etat: 'photo_requise', libelle: 'Photo de la maison nécessaire' };
  const rx = estObj(travail.resultat_extension) ? travail.resultat_extension : null;
  const r = estObj(travail.resultat) ? travail.resultat : null;
  const pm = r && estObj(r.photomontage) ? r.photomontage : null;
  const aValider = (rx && (rx.livrable === false || (typeof rx.statut_x7 === 'string' && rx.statut_x7 !== 'livrable'))) || (pm && pm.statut === 'a_valider');
  return aValider ? { etat: 'a_valider', libelle: 'Image à valider' } : { etat: 'livrable', libelle: 'Image livrable' };
}

/** Libellé court d'une variante (« V2 · placée »). Pur. */
export function titreVariante(v: VarianteHistorique): string {
  return `V${v.n} · ${v.verdict === 'placee' ? 'placée' : 'non placée'}`;
}
