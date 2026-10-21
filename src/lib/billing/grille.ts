// src/lib/billing/grille.ts
// =============================================================================
// GRILLE TARIFAIRE MIMMOZA — SOURCE DE VÉRITÉ UNIQUE (audit du 21/10/2026)
// =============================================================================
//
// Tout écran qui affiche un prix, un quota ou un nombre de jetons inclus lit
// CE fichier : /tarifs (page publique), /abonnement, le menu d'abonnement de
// MimmozIA, l'administration (/admin/tarifs), le catalogue de facturation
// (catalog.ts). Changer un prix = changer une ligne ici.
//
// Les codes de plan (basique / avance / pro / proplus) sont CONSERVÉS : ce sont
// ceux que comprennent le serveur (copilot-chat → normalizePlan) et
// syncPlanFromServer. Seuls les libellés commerciaux changent.
//
// Tous les montants sont HORS TAXES, en euros.
//
// ⚠️ Paiement en ligne NON branché (société en cours de création) : aucun
// bouton ne doit accorder une formule payante côté navigateur. Voir
// PAIEMENT_EN_LIGNE_DISPONIBLE et CONTACT_ACCES.
// =============================================================================

import type { ModuleSpace, PlanId } from "./planAccess";

/** Valeur d'un jeton, partout dans l'application. 1 jeton = 0,10 € HT. */
export const JETON_VALEUR_EUR = 0.1;

/** Tant que Stripe n'est pas branché, les formules payantes s'ouvrent sur demande. */
export const PAIEMENT_EN_LIGNE_DISPONIBLE = false;

/** Adresse de contact déjà utilisée dans les pages légales (CGU, CGV, mentions). */
export const CONTACT_ACCES = "contact@mimmoza.fr";

export const MESSAGE_PAIEMENT_INDISPONIBLE =
  "Paiement en ligne bientôt disponible — demandez l'ouverture de votre accès";

/** Lien mailto prérempli pour demander l'ouverture d'une formule. */
export function mailtoDemandeAcces(formule: string, periodicite?: "mensuel" | "annuel"): string {
  const sujet = `Ouverture de mon accès Mimmoza — formule ${formule}`;
  const corps =
    `Bonjour,\n\nJe souhaite ouvrir un accès à la formule ${formule}` +
    (periodicite ? ` (facturation ${periodicite})` : "") +
    `.\n\nAdresse e-mail de mon compte Mimmoza : \nSociété / activité : \n\nMerci.`;
  return `mailto:${CONTACT_ACCES}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

// ── Formules ─────────────────────────────────────────────────────────────────

export type ModulesInclus = "aucun" | "un_au_choix" | "tous";

export interface Formule {
  /** Code technique conservé (base, serveur, localStorage). */
  id: PlanId;
  /** Libellé commercial. */
  nom: string;
  accroche: string;
  /** Prix mensuel HT, sans engagement. 0 = gratuit. */
  prixMensuelHT: number;
  /** Prix mensuel HT équivalent en engagement annuel (null si sans objet). */
  prixMensuelAnnuelHT: number | null;
  utilisateurs: number;
  modules: ModulesInclus;
  /** Jetons IA inclus chaque mois (0 si aucun). */
  jetonsMensuels: number;
  /** Analyses rapides incluses par mois (null = selon jetons / illimité raisonnable). */
  analysesRapidesMois: number | null;
  /** Messages Mimmo inclus par mois (null = débit en jetons). */
  messagesMimmoMois: number | null;
  exportsPdf: boolean;
  /** Points de la carte tarifaire, dans l'ordre d'affichage. */
  points: string[];
  miseEnAvant?: boolean;
}

export const FORMULES: readonly Formule[] = [
  {
    id: "basique",
    nom: "Découverte",
    accroche: "Pour essayer Mimmoza",
    prixMensuelHT: 0,
    prixMensuelAnnuelHT: null,
    utilisateurs: 1,
    modules: "aucun",
    jetonsMensuels: 0,
    analysesRapidesMois: 3,
    messagesMimmoMois: 10,
    exportsPdf: false,
    points: [
      "3 analyses rapides par mois",
      "Mimmo : 10 messages par mois",
      "Sans export",
    ],
  },
  {
    id: "avance",
    nom: "Indépendant",
    accroche: "1 métier au choix",
    prixMensuelHT: 49,
    prixMensuelAnnuelHT: 39,
    utilisateurs: 1,
    modules: "un_au_choix",
    jetonsMensuels: 200,
    analysesRapidesMois: 100,
    messagesMimmoMois: null,
    exportsPdf: true,
    points: [
      "1 utilisateur",
      "1 module métier au choix",
      "100 analyses par mois",
      "200 jetons par mois",
      "Exports PDF",
    ],
  },
  {
    id: "pro",
    nom: "Pro",
    accroche: "Les 3 métiers",
    prixMensuelHT: 149,
    prixMensuelAnnuelHT: 129,
    utilisateurs: 1,
    modules: "tous",
    jetonsMensuels: 800,
    analysesRapidesMois: null,
    messagesMimmoMois: null,
    exportsPdf: true,
    miseEnAvant: true,
    points: [
      "Les 3 modules : Promotion, Marchand de biens, Réhabilitation",
      "Veille foncière",
      "Bilan promoteur",
      "800 jetons par mois",
      "Exports PDF",
    ],
  },
  {
    id: "proplus",
    nom: "Équipe",
    accroche: "Pour les structures",
    prixMensuelHT: 349,
    prixMensuelAnnuelHT: 299,
    utilisateurs: 5,
    modules: "tous",
    jetonsMensuels: 2500,
    analysesRapidesMois: null,
    messagesMimmoMois: null,
    exportsPdf: true,
    points: [
      "5 utilisateurs",
      "Tout le contenu Pro",
      "2 500 jetons partagés par mois",
      "Agent commercial",
      "API : 10 000 crédits inclus",
    ],
  },
];

export function formule(id: PlanId): Formule {
  return FORMULES.find((f) => f.id === id) ?? FORMULES[0];
}

/** Libellé commercial d'un code de plan. */
export const NOM_FORMULE: Record<PlanId, string> = {
  basique: "Découverte",
  avance: "Indépendant",
  pro: "Pro",
  proplus: "Équipe",
};

/** Nombre de modules métier accordés par formule (cf. planAccess.allowedModules). */
export const MODULES_PAR_FORMULE: Record<PlanId, number> = {
  basique: 0,
  avance: 1,
  pro: 3,
  proplus: 3,
};

/** Jetons inclus chaque mois, par code de plan (repris par le webhook). */
export const JETONS_INCLUS_PAR_FORMULE: Record<PlanId, number> = {
  basique: 0,
  avance: 200,
  pro: 800,
  proplus: 2500,
};

/** Quota d'analyses rapides GRATUITES par mois, pour tout compte (serveur : consume_free_quick_analysis). */
export const ANALYSES_RAPIDES_GRATUITES_MOIS = 3;

// ── Achats à l'unité ─────────────────────────────────────────────────────────

export interface ProduitUnitaire {
  code: string;
  libelle: string;
  prixHT: number;
  detail?: string;
}

export const RAPPORT_FAISABILITE_PARCELLE: ProduitUnitaire = {
  code: "rapport_faisabilite_parcelle",
  libelle: "Rapport de faisabilité d'une parcelle (PDF)",
  prixHT: 29,
};

/**
 * Analyse « particulier » à l'unité, annoncée 4,90 € sur l'accueil.
 * NON VENDUE tant que le paiement n'est pas branché : le formulaire d'accueil
 * passe par le parcours gratuit (compte gratuit, 3 analyses par mois).
 * Conservée ici pour le jour où Stripe sera en place.
 */
export const ANALYSE_PARTICULIER_UNITE: ProduitUnitaire = {
  code: "analyse_particulier_unite",
  libelle: "Analyse express d'un bien (particulier)",
  prixHT: 4.9,
};

export interface PackJetons {
  code: "tokens_100" | "tokens_500" | "tokens_2000";
  jetons: number;
  prixHT: number;
}

export const PACKS_JETONS: readonly PackJetons[] = [
  { code: "tokens_100", jetons: 100, prixHT: 10 },
  { code: "tokens_500", jetons: 500, prixHT: 45 },
  { code: "tokens_2000", jetons: 2000, prixHT: 160 },
];

export interface PackApi {
  code: "api_10k" | "api_50k";
  credits: number;
  prixHT: number;
}

export const PACKS_API: readonly PackApi[] = [
  { code: "api_10k", credits: 10_000, prixHT: 49 },
  { code: "api_50k", credits: 50_000, prixHT: 149 },
];

// ── Studio 3D (application liée) ─────────────────────────────────────────────

export const STUDIO_3D = {
  libelle: "MimmozIA Studio 3D",
  prixMensuelDesHT: 390,
  /** Remise accordée aux abonnés de ces formules. */
  remisePct: 15,
  formulesRemisees: ["pro", "proplus"] as PlanId[],
} as const;

// ── Modules métier ───────────────────────────────────────────────────────────

export const NOM_MODULE: Record<ModuleSpace, string> = {
  promoteur: "Promotion",
  marchand: "Marchand de biens",
  rehabilitation: "Réhabilitation",
};

// ── Formatage ────────────────────────────────────────────────────────────────

export function formatEurHT(montant: number, avecDecimales = false): string {
  const decimales = avecDecimales || !Number.isInteger(montant) ? 2 : 0;
  return (
    montant.toLocaleString("fr-FR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }) + " € HT"
  );
}

/** Prix affiché d'une formule : « Gratuit » ou « 49 € HT/mois ». */
export function prixFormule(f: Formule, periodicite: "mensuel" | "annuel" = "mensuel"): string {
  if (f.prixMensuelHT === 0) return "Gratuit";
  const prix = periodicite === "annuel" && f.prixMensuelAnnuelHT != null ? f.prixMensuelAnnuelHT : f.prixMensuelHT;
  return `${formatEurHT(prix)}/mois`;
}
