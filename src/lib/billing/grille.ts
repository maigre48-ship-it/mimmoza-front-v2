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
    exportsPdf: true,
    points: [
      "3 analyses rapides par mois",
      "Mimmo : 10 messages par mois",
      "Export PDF des analyses",
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
      "100 analyses rapides par mois",
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
    analysesRapidesMois: 300,
    messagesMimmoMois: null,
    exportsPdf: true,
    miseEnAvant: true,
    points: [
      "Les 3 modules : Promotion, Marchand de biens, Réhabilitation",
      "Veille foncière",
      "Bilan promoteur",
      "300 analyses rapides par mois",
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
    analysesRapidesMois: 1000,
    messagesMimmoMois: null,
    exportsPdf: true,
    points: [
      "5 utilisateurs",
      "Tout le contenu Pro",
      "1 000 analyses rapides par mois",
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

/**
 * Analyses rapides incluses chaque mois, par formule — PLAFONDS APPLIQUÉS PAR LE SERVEUR
 * (consume_free_quick_analysis, migration 20261021_plafonds_formules.sql). Au-delà : 10 jetons.
 */
export const ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE: Record<PlanId, number> = {
  basique: 3,
  avance: 100,
  pro: 300,
  proplus: 1000,
};

/**
 * Messages Mimmo offerts chaque mois en Découverte — plafond appliqué par copilot-chat
 * (consume_copilot_free_message). Au-delà : les jetons du compte, s'il en a.
 */
export const MESSAGES_MIMMO_DECOUVERTE_MOIS = 10;

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

// Grille issue de l'audit « MimmozIA Studio — Audit et grille tarifaire » du
// 21/10/2026. Chaque prix reste bénéficiaire même si le client consomme 100 %
// de ce qui est inclus (coût complet = GPU + streaming + IA + temps de contrôle
// valorisé 60 €/h, 3 % de frais de paiement retenus). Les remises (annuel −10 %,
// abonné Pro/Équipe −15 %) NE SE CUMULENT PAS : cumulées, la marge au pire cas
// de l'offre Entreprise tomberait à 23 % ; seule, la plus forte la laisse ≥ 30 %.
//
// Le Studio est vendu en SERVICE ACCOMPAGNÉ (rendus réalisés et contrôlés par
// Mimmoza) tant que les comptes clients et le rendu cloud ne sont pas en place :
// aucune souscription en libre-service, demande par e-mail.

export interface OffreStudio {
  code: string;
  libelle: string;
  /** Prix HT ; pour un abonnement, prix mensuel. */
  prixHT: number;
  /** « à partir de » (offre sur mesure). */
  aPartirDe?: boolean;
  detail?: string;
  inclus?: readonly string[];
}

export const STUDIO_3D = {
  libelle: "MimmozIA Studio 3D",
  accroche: "Maquette 3D, images, film et visite virtuelle de vos programmes",
  prixMensuelDesHT: 390,
  /** Remise accordée aux abonnés de ces formules de la plateforme. */
  remisePct: 15,
  formulesRemisees: ["pro", "proplus"] as PlanId[],
  /** Abonnements : engagement de 12 mois. */
  engagementMois: 12,
  /** Remise maximale en cas de paiement annuel d'avance (non cumulable avec remisePct). */
  remiseAnnuellePct: 10,
  remisesCumulables: false,
  abonnements: [
    {
      code: "studio_essentiel",
      libelle: "Essentiel",
      prixHT: 390,
      inclus: ["2 projets actifs", "Mimmo : 500 messages par mois", "5 images 4K par mois"],
    },
    {
      code: "studio_pro",
      libelle: "Pro",
      prixHT: 1190,
      inclus: [
        "5 projets actifs",
        "Mimmo : 1 500 messages par mois",
        "15 images 4K par mois",
        "1 film 60 s par trimestre",
        "1 visite virtuelle active, 30 h par mois",
      ],
    },
    {
      code: "studio_entreprise",
      libelle: "Entreprise",
      prixHT: 2990,
      aPartirDe: true,
      inclus: [
        "12 projets actifs",
        "Mimmo : 4 000 messages par mois",
        "40 images 4K par mois",
        "1 film 60 s par mois",
        "2 visites virtuelles actives, 100 h par mois",
      ],
    },
  ] as readonly OffreStudio[],
  aLActe: [
    { code: "image_4k", libelle: "Image 4K", prixHT: 149, detail: "1 vue extérieure ou intérieure" },
    { code: "pack_5_images", libelle: "Pack 5 images 4K", prixHT: 590, detail: "Extérieur et intérieur" },
    { code: "film_60s", libelle: "Film 60 s 4K", prixHT: 1490, detail: "Storyboard, musique libre de droits, 1 reprise" },
    { code: "visite_6_mois", libelle: "Visite virtuelle 6 mois", prixHT: 1490, detail: "100 h de visite incluses" },
    {
      code: "pack_lancement",
      libelle: "Pack lancement commercial",
      prixHT: 3290,
      detail: "5 images 4K + film 60 s + visite virtuelle 6 mois",
    },
  ] as readonly OffreStudio[],
  /** Au-delà des quotas (abonnés) ou de la visite (à l'acte). */
  depassements: [
    { code: "image_sup", libelle: "Image 4K supplémentaire (abonnés)", prixHT: 49 },
    { code: "film_sup", libelle: "Film 60 s supplémentaire (abonnés)", prixHT: 990 },
    { code: "visite_sup", libelle: "Visite supplémentaire 6 mois, 50 h (abonnés)", prixHT: 690 },
    { code: "heure_visite_abonne", libelle: "Heure de visite au-delà (abonnés)", prixHT: 5 },
    { code: "heure_visite", libelle: "Heure de visite au-delà (à l'acte)", prixHT: 6 },
  ] as readonly OffreStudio[],
  offrePilote: {
    libelle: "Offre pilote",
    remisePct: 40,
    nbClients: 3,
    /** Pack lancement à −40 % : 3 290 € → 1 974 €. */
    prixHT: 1974,
  },
} as const;

/** Lien mailto prérempli pour une demande Studio 3D (devis, pilote, démo). */
export function mailtoDemandeStudio(offre: string): string {
  const sujet = `MimmozIA Studio 3D — ${offre}`;
  const corps =
    `Bonjour,\n\nJe souhaite échanger sur l'offre « ${offre} » de MimmozIA Studio 3D.\n\n` +
    `Société : \nProgramme concerné (adresse, nombre de logements) : \nÉchéance souhaitée : \n\nMerci.`;
  return `mailto:${CONTACT_ACCES}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

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
