// src/spaces/copilot/onboarding/onboardingRegles.ts
// =============================================================================
// PREMIER CONTACT GUIDÉ — règles pures (sans React, sans réseau), testées par
// onboardingRegles.test.ts.
// =============================================================================

import {
  ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE,
  FORMULES,
  JETONS_INCLUS_PAR_FORMULE,
  MESSAGES_MIMMO_DECOUVERTE_MOIS,
  NOM_FORMULE,
} from '../../../lib/billing/grille.ts';
import { ACTION_COSTS } from '../../../lib/billing/actionCosts.ts';
import type { PlanId } from '../../../lib/billing/planAccess.ts';

export type ProfilDeclare = 'promoteur' | 'marchand' | 'particulier' | 'autre';

export const PROFILS: readonly { id: ProfilDeclare; libelle: string }[] = [
  { id: 'promoteur', libelle: 'Promoteur' },
  { id: 'marchand', libelle: 'Marchand de biens / investisseur' },
  { id: 'particulier', libelle: 'Particulier' },
  { id: 'autre', libelle: 'Autre' },
];

/** Profil déduit (v_user_profile.derived_profile) → profil de l'encart. */
export function normaliserProfil(v: string | null | undefined): ProfilDeclare | null {
  switch ((v ?? '').toLowerCase()) {
    case 'promoteur':
      return 'promoteur';
    case 'marchand':
    case 'investisseur':
    case 'rehabilitation':
      return 'marchand';
    case 'particulier':
      return 'particulier';
    case 'autre':
    case 'apporteur':
    case 'banque':
      return 'autre';
    default:
      return null;
  }
}

export type IconeAction = 'adresse' | 'bilan' | '3d' | 'rentabilite' | 'plu' | 'estimation';

export interface ActionDemarrage {
  id: string;
  icone: IconeAction;
  titre: string;
  sousTitre: string;
  /** Champ à remplir avant le lancement (adresse…). Absent = la demande part telle quelle. */
  champ?: { libelle: string; placeholder: string };
  /** Mention sous l'action (ex. hypothèses d'exemple). */
  mention?: string;
  /** Demande envoyée à Mimmo. */
  demande: (valeur?: string) => string;
}

const ANALYSER_ADRESSE: ActionDemarrage = {
  id: 'analyser-adresse',
  icone: 'adresse',
  titre: 'Analyser une adresse',
  sousTitre: 'PLU, contraintes, risques et potentiel',
  champ: { libelle: 'Adresse ou référence cadastrale', placeholder: 'Ex. 12 rue de la Paix, 75002 Paris' },
  demande: (v) => `Analyse cette adresse (faisabilité, contraintes réglementaires et potentiel) : ${(v ?? '').trim()}`,
};

const BILAN_PROMOTEUR: ActionDemarrage = {
  id: 'evaluer-operation',
  icone: 'bilan',
  titre: 'Évaluer une opération (bilan)',
  sousTitre: 'Bilan promoteur simplifié, marge et points de vigilance',
  mention: 'Lancé avec des hypothèses d’exemple, à remplacer par les vôtres.',
  demande: () =>
    'Fais un bilan promoteur simplifié avec ces hypothèses d’exemple : terrain de 1 500 m² acquis 900 000 €, ' +
    '25 logements pour 1 700 m² de surface de plancher, prix de vente moyen 4 500 €/m², ' +
    'coût de construction 1 900 €/m². Donne la marge, le prix de revient et les points de vigilance.',
};

const MAQUETTE_3D: ActionDemarrage = {
  id: 'maquette-3d',
  icone: '3d',
  titre: 'Créer une maquette 3D',
  sousTitre: 'Décrivez un bâtiment, Mimmo prépare le volume',
  demande: () => 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m, avec 12 logements.',
};

const OPERATION_MARCHAND: ActionDemarrage = {
  id: 'evaluer-operation-marchand',
  icone: 'rentabilite',
  titre: 'Évaluer une opération',
  sousTitre: 'Achat, travaux, revente : marge et rentabilité',
  mention: 'Lancé avec des hypothèses d’exemple, à remplacer par les vôtres.',
  demande: () =>
    'Évalue cette opération de marchand de biens avec des hypothèses d’exemple : achat 250 000 € frais compris, ' +
    'travaux 40 000 €, revente visée 340 000 €, durée 9 mois, financement à 80 %. ' +
    'Donne la marge nette, la rentabilité et les risques principaux.',
};

const REGLES_TERRAIN: ActionDemarrage = {
  id: 'regles-terrain',
  icone: 'plu',
  titre: 'Comprendre les règles de mon terrain',
  sousTitre: 'Ce que le PLU permet de construire',
  champ: { libelle: 'Adresse du terrain', placeholder: 'Ex. 5 chemin des Vignes, 33000 Bordeaux' },
  demande: (v) => `Explique-moi simplement ce que le PLU permet de construire à cette adresse : ${(v ?? '').trim()}`,
};

const ESTIMER_BIEN: ActionDemarrage = {
  id: 'estimer-bien',
  icone: 'estimation',
  titre: 'Situer un bien dans son marché',
  sousTitre: 'Tendances du quartier et ventes comparables',
  champ: { libelle: 'Adresse du bien', placeholder: 'Ex. 8 avenue Jean Jaurès, 69007 Lyon' },
  demande: (v) => `Situe ce bien dans son marché local (tendances et ventes comparables) : ${(v ?? '').trim()}`,
};

/** Trois actions proposées selon le profil (par défaut : adresse, bilan, 3D). */
export function actionsPourProfil(profil: ProfilDeclare | null): ActionDemarrage[] {
  switch (profil) {
    case 'marchand':
      return [ANALYSER_ADRESSE, OPERATION_MARCHAND, MAQUETTE_3D];
    case 'particulier':
      return [ANALYSER_ADRESSE, REGLES_TERRAIN, ESTIMER_BIEN];
    case 'promoteur':
    case 'autre':
    default:
      return [ANALYSER_ADRESSE, BILAN_PROMOTEUR, MAQUETTE_3D];
  }
}

// ── Checklist « Bien démarrer » ──────────────────────────────────────────────

export interface EtatOnboarding {
  nbConversations: number;
  analysesRapides: number;
  exportPdf: boolean;
  moduleOuvert: boolean;
  encartFerme: boolean;
  checklistFermee: boolean;
  /** Ancienneté du compte en jours (null si inconnue). */
  ancienneteJours: number | null;
}

export type IdEtape = 'analyse' | 'export_pdf' | 'module';

export interface Etape {
  id: IdEtape;
  libelle: string;
  aide: string;
  fait: boolean;
}

export function etapesChecklist(e: EtatOnboarding): Etape[] {
  return [
    {
      id: 'analyse',
      libelle: 'Lancer une première analyse',
      aide: 'Une adresse suffit.',
      fait: e.nbConversations > 0 || e.analysesRapides > 0,
    },
    {
      id: 'export_pdf',
      libelle: 'Exporter un rapport en PDF',
      aide: 'Bouton « PDF » sous une réponse de Mimmo.',
      fait: e.exportPdf,
    },
    {
      id: 'module',
      libelle: 'Explorer un module métier',
      aide: 'Promotion, Marchand de biens, Réhabilitation…',
      fait: e.moduleOuvert,
    },
  ];
}

/** Nouveau compte : rien lancé et encart jamais fermé. */
export function afficherEncart(e: EtatOnboarding): boolean {
  return !e.encartFerme && e.nbConversations === 0 && e.analysesRapides === 0;
}

/** Checklist : compte récent (≤ 30 jours) ou encart affiché, ni fermée ni terminée. */
export function afficherChecklist(e: EtatOnboarding): boolean {
  if (e.checklistFermee) return false;
  if (etapesChecklist(e).every((x) => x.fait)) return false;
  return afficherEncart(e) || (e.ancienneteJours !== null && e.ancienneteJours <= 30);
}

// ── Rappel des quotas de la formule (grille.ts = source unique) ─────────────

export interface RappelQuota {
  nomFormule: string;
  lignes: string[];
  apres: string;
}

export function rappelQuota(plan: PlanId): RappelQuota {
  const f = FORMULES.find((x) => x.id === plan) ?? FORMULES[0];
  const analyses = ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE[f.id];
  const jetons = JETONS_INCLUS_PAR_FORMULE[f.id];
  const nf = (n: number) => n.toLocaleString('fr-FR');
  const lignes = [`${nf(analyses)} analyses rapides par mois`];
  if (f.id === 'basique') lignes.push(`${nf(MESSAGES_MIMMO_DECOUVERTE_MOIS)} messages à Mimmo par mois`);
  if (jetons > 0) lignes.push(`${nf(jetons)} jetons par mois`);
  if (f.exportsPdf) lignes.push('Exports PDF');
  return {
    nomFormule: NOM_FORMULE[f.id],
    lignes,
    apres: `Au-delà : ${ACTION_COSTS.analyse_rapide} jetons par analyse rapide.`,
  };
}
