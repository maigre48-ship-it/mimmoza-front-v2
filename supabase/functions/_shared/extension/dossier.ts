// supabase/functions/_shared/extension/dossier.ts
// =============================================================================
// LOT D9 (16/11/2026) — « PRÉPARER MON DOSSIER » : aperçu DÉTERMINISTE des pièces du dossier, établi par le serveur à
// la fin du parcours d'extension (aucun texte du modèle de langage).
//
// Les pièces suivent la notice officielle cerfa n° 51434#13 (mise à jour septembre 2025), comme le moteur de dossier du
// Studio (lot D4) : PC maison individuelle (cerfa 13406) PCMI1 à PCMI8 ; DP (cerfa 16702) DP1 à DP8, plus DP11 en
// secteur protégé. Pour chaque pièce : qui la produit (le Studio, à partir du modèle ; ou la personne). Le statut RÉEL
// (prête / à compléter / manquante) est calculé par le Studio au moment de la génération, jamais ici.
//
// Régime indicatif « DP ou PC » : la carte DEMANDE le choix (deux boutons) ; le dossier n'est préparé qu'en DP ou en PC.
// Coût : aucun calcul serveur n'est facturé pour le dossier (gratuit, aucun jeton), dit sur la carte.
// =============================================================================

import type { Regime } from './reglementation.ts';

export type OrigineIndicative = 'studio' | 'personne' | 'studio-et-personne';

export interface PiecePrevue {
  readonly code: string;
  readonly intitule: string;
  readonly origine: OrigineIndicative;
  /** Condition de la notice pour une pièce conditionnelle ; null : toujours exigée. */
  readonly condition: string | null;
}

export interface VueDossier {
  readonly v: 1;
  /** Régime indicatif du parcours (X3 / X3b). */
  readonly regimeIndicatif: Regime;
  /** Régimes entre lesquels préparer un dossier ([] si le régime est inconnu). */
  readonly choix: readonly ('DP' | 'PC')[];
  readonly question: string | null;
  readonly pieces: { readonly DP?: readonly PiecePrevue[]; readonly PC?: readonly PiecePrevue[] };
  readonly cout: string;
  readonly mention: string;
}

const PC: readonly PiecePrevue[] = [
  { code: 'PCMI1', intitule: 'Plan de situation du terrain', origine: 'studio', condition: null },
  { code: 'PCMI2', intitule: 'Plan de masse', origine: 'studio-et-personne', condition: null },
  { code: 'PCMI3', intitule: 'Plan en coupe du terrain et de la construction', origine: 'studio', condition: null },
  { code: 'PCMI4', intitule: 'Notice décrivant le terrain et présentant le projet', origine: 'studio-et-personne', condition: null },
  { code: 'PCMI5', intitule: 'Plan des façades et des toitures (état initial et projeté)', origine: 'studio', condition: null },
  { code: 'PCMI6', intitule: 'Document graphique d’insertion (photomontage)', origine: 'studio-et-personne', condition: null },
  { code: 'PCMI7', intitule: 'Photographie du terrain dans l’environnement proche', origine: 'personne', condition: null },
  { code: 'PCMI8', intitule: 'Photographie du terrain dans le paysage lointain', origine: 'personne', condition: null },
];

const DP: readonly PiecePrevue[] = [
  { code: 'DP1', intitule: 'Plan de situation du terrain', origine: 'studio', condition: null },
  { code: 'DP2', intitule: 'Plan de masse', origine: 'studio-et-personne', condition: 'si le projet modifie le volume ou crée de l’emprise' },
  { code: 'DP3', intitule: 'Plan en coupe', origine: 'studio', condition: 'si le profil du terrain est modifié' },
  { code: 'DP4', intitule: 'Plan des façades et des toitures', origine: 'studio', condition: 'si les façades ou la toiture sont modifiées' },
  { code: 'DP6', intitule: 'Document graphique d’insertion (photomontage)', origine: 'studio-et-personne', condition: 'si le projet est visible depuis l’espace public ou en secteur protégé' },
  { code: 'DP7', intitule: 'Photographie du terrain dans l’environnement proche', origine: 'personne', condition: null },
  { code: 'DP8', intitule: 'Photographie du terrain dans le paysage lointain', origine: 'personne', condition: null },
];

const DP11: PiecePrevue = { code: 'DP11', intitule: 'Notice des matériaux', origine: 'studio-et-personne', condition: 'en secteur protégé (site patrimonial remarquable, abords de monument historique)' };

export const COUT_DOSSIER = 'Gratuit : le dossier est calculé dans le Studio, aucun jeton n’est consommé.';
export const MENTION_DOSSIER = 'Aperçu indicatif des pièces (notice cerfa 51434#13). Le Studio produit les plans et la notice à partir du modèle ; photographies et précisions restent à fournir par vous. Document établi sans architecte, à vérifier ; rien n’est envoyé à la mairie.';

/** Pièces à prévoir selon le régime indicatif et le secteur protégé (X3b). Pur et déterministe. */
export function dossierPrevisionnel(regime: Regime, secteur: 'oui' | 'non_trouve' | 'non_verifie' | null): VueDossier {
  const choix: ('DP' | 'PC')[] = regime === 'DP' ? ['DP'] : regime === 'PC' ? ['PC'] : regime === 'DP ou PC' ? ['DP', 'PC'] : [];
  const dp = secteur === 'non_trouve' ? DP : [...DP, DP11];
  return {
    v: 1,
    regimeIndicatif: regime,
    choix,
    question: regime === 'DP ou PC'
      ? 'Votre projet peut relever d’une déclaration préalable ou d’un permis de construire selon la surface réelle et le zonage : pour quel dossier voulez-vous préparer les pièces ?'
      : regime === 'inconnu' ? 'Le régime n’a pas pu être établi : précisez la surface de plancher existante réelle dans le parcours pour préparer un dossier.' : null,
    pieces: { ...(choix.includes('DP') ? { DP: dp } : {}), ...(choix.includes('PC') ? { PC } : {}) },
    cout: COUT_DOSSIER,
    mention: MENTION_DOSSIER,
  };
}
