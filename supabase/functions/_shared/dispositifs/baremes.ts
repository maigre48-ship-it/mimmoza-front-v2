// supabase/functions/_shared/dispositifs/baremes.ts
//
// Barèmes officiels 2026. Chaque valeur est transcrite d'une source publique
// citée en commentaire — aucune n'est estimée, interpolée ou reconduite.
//
// ⚠️ CES VALEURS SE PÉRIMENT AU 1er JANVIER. Les plafonds de loyer et de
// ressources sont révisés chaque année. Au 1er janvier 2027, il faudra relire
// le nouveau BOI-BAREME-000017 et incrémenter MILLESIME_BAREMES. Le moteur
// expose le millésime dans chacun de ses résultats pour que la péremption soit
// visible plutôt que silencieuse.
//
// Source principale des plafonds :
//   BOI-BAREME-000017, version du 10/03/2026
//   https://bofip.impots.gouv.fr/bofip/10130-PGP.html

import type { NiveauLoyer, ZoneAbc } from "./types.ts";

/** Année des baux à laquelle se rapportent les barèmes ci-dessous. */
export const MILLESIME_BAREMES = 2026;

/** Prélèvements sociaux sur les revenus du patrimoine, au 01/09/2026. */
export const PRELEVEMENTS_SOCIAUX_PCT = 17.2;

// ─────────────────────────────────────────────────────────────────────────────
// Plafonds de loyer — secteur intermédiaire
// ─────────────────────────────────────────────────────────────────────────────
//
// Grille « Duflot / Pinel métropole » (BOI-BAREME-000017, I-I § 150).
// Elle sert de référence à trois dispositifs :
//   • Denormandie, par renvoi exprès (BOI-IR-RICI-365-20 § 50, « mutatis
//     mutandis ») — il n'existe aucune ligne « Denormandie » propre au BOFiP ;
//   • Jeanbrun en location intermédiaire (LF 2026 art. 47, renvoi au III de
//     l'art. 199 novovicies) ;
//   • le Pinel lui-même, CLOS aux nouveaux investisseurs depuis le 01/01/2025 —
//     conservé ici uniquement pour les engagements en cours.
//
// Noter que B2 et C partagent la même valeur : ce n'est pas une omission.

export const PLAFONDS_LOYER_INTERMEDIAIRE_EUR_M2: Record<ZoneAbc, number> = {
  Abis: 19.71,
  A: 14.64,
  B1: 11.80,
  B2: 10.26,
  C: 10.26,
};

/** Outre-mer, même grille (BOI-BAREME-000017, I-J § 160). */
export const PLAFONDS_LOYER_INTERMEDIAIRE_OUTRE_MER_EUR_M2 = {
  /** DOM, Saint-Martin, Saint-Pierre-et-Miquelon. */
  dom: 12.21,
  /** Polynésie française, Nouvelle-Calédonie, Wallis-et-Futuna. */
  pacifique: 14.46,
};

// ─────────────────────────────────────────────────────────────────────────────
// Plafonds de ressources — secteur intermédiaire
// ─────────────────────────────────────────────────────────────────────────────
//
// BOI-BAREME-000017, II-F § 270. Revenu fiscal de référence de l'année N-2
// (revenus 2024 pour un bail 2026), apprécié à la date de conclusion du bail.
// S'appliquent au Pinel, au Denormandie, au Jeanbrun intermédiaire et au
// Loc'Avantages Loc1 (ce dernier par renvoi, BOI-IR-RICI-400-20-30 § 290).
//
// A bis et A ne divergent qu'à partir d'une personne à charge.

export interface LignePlafondRessources {
  composition: string;
  Abis: number;
  A: number;
  B1: number;
  /** B2 et C partagent la même colonne au BOFiP. */
  B2C: number;
}

export const PLAFONDS_RESSOURCES_INTERMEDIAIRE: LignePlafondRessources[] = [
  { composition: "Personne seule",                        Abis:  44344, A:  44344, B1: 36144, B2C: 32530 },
  { composition: "Couple",                                Abis:  66276, A:  66276, B1: 48268, B2C: 43439 },
  { composition: "+ 1 personne à charge",                 Abis:  86878, A:  79666, B1: 58043, B2C: 52239 },
  { composition: "+ 2 personnes à charge",                Abis: 103727, A:  95427, B1: 70073, B2C: 63066 },
  { composition: "+ 3 personnes à charge",                Abis: 123415, A: 112968, B1: 82432, B2C: 74189 },
  { composition: "+ 4 personnes à charge",                Abis: 138874, A: 127122, B1: 92900, B2C: 83611 },
];

/** Majoration par personne à charge à partir de la cinquième. */
export const MAJORATION_5E_PERSONNE_INTERMEDIAIRE: Record<ZoneAbc, number> = {
  Abis: 15471,
  A: 14164,
  B1: 10364,
  B2: 9325,
  C: 9325,
};

// ─────────────────────────────────────────────────────────────────────────────
// Plafonds de ressources — secteurs social et très social (Loc'Avantages)
// ─────────────────────────────────────────────────────────────────────────────
//
// BOI-BAREME-000017, II-I § 330 (social) et § 340 (très social).
// Ces grilles s'appliquent à Loc'Avantages Loc2/Loc3 et, par renvoi de la
// LF 2026 art. 47, au Jeanbrun en location sociale ou très sociale.
//
// La colonne outre-mer diffère de la métropole en zones A et B1 seulement ;
// on ne conserve ici que la métropole, le moteur refusant de chiffrer
// l'outre-mer plutôt que d'y appliquer une grille qui ne lui correspond pas.

export const PLAFONDS_RESSOURCES_SOCIAL: LignePlafondRessources[] = [
  { composition: "Personne seule",         Abis:  32463, A: 32463, B1: 26460, B2C: 23814 },
  { composition: "Couple",                 Abis:  48521, A: 48521, B1: 35338, B2C: 31804 },
  { composition: "+ 1 personne à charge",  Abis:  63604, A: 58324, B1: 42494, B2C: 38244 },
  { composition: "+ 2 personnes à charge", Abis:  75940, A: 69863, B1: 51302, B2C: 46171 },
  { composition: "+ 3 personnes à charge", Abis:  90352, A: 82705, B1: 60349, B2C: 54315 },
  { composition: "+ 4 personnes à charge", Abis: 101674, A: 93072, B1: 68016, B2C: 61214 },
];

export const MAJORATION_5E_PERSONNE_SOCIAL: Record<ZoneAbc, number> = {
  Abis: 11330,
  A: 10371,
  B1: 7588,
  B2: 6828,
  C: 6828,
};

export const PLAFONDS_RESSOURCES_TRES_SOCIAL: LignePlafondRessources[] = [
  { composition: "Personne seule",         Abis: 17855, A: 17855, B1: 14553, B2C: 13097 },
  { composition: "Couple",                 Abis: 29114, A: 29114, B1: 21204, B2C: 19082 },
  { composition: "+ 1 personne à charge",  Abis: 38164, A: 34995, B1: 25497, B2C: 22946 },
  { composition: "+ 2 personnes à charge", Abis: 41995, A: 38635, B1: 28369, B2C: 25533 },
  { composition: "+ 3 personnes à charge", Abis: 49695, A: 45490, B1: 33195, B2C: 29875 },
  { composition: "+ 4 personnes à charge", Abis: 55921, A: 51190, B1: 37408, B2C: 33668 },
];

export const MAJORATION_5E_PERSONNE_TRES_SOCIAL: Record<ZoneAbc, number> = {
  Abis: 6230,
  A: 5703,
  B1: 4172,
  B2: 3754,
  C: 3754,
};

// ─────────────────────────────────────────────────────────────────────────────
// Jeanbrun — LF 2026 (loi n° 2026-103 du 19/02/2026), art. 47
// CGI art. 31, I, 1°, i (neuf) et j (ancien)
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux dispositifs distincts, aux taux différents. Les sites commerciaux les
// présentent souvent comme un seul « dispositif Jeanbrun » à 3,5–5,5 % : c'est
// la grille du NEUF, appliquée à tort à l'ancien.

/** Taux d'amortissement annuel, en pourcentage de la base éligible. */
export const TAUX_AMORTISSEMENT_JEANBRUN: Record<
  "neuf" | "ancien",
  Record<NiveauLoyer, number>
> = {
  // Intermédiaire 3,5 % ; social +1 pt ; très social +2 pts.
  neuf:   { intermediaire: 3.5, social: 4.5, tres_social: 5.5 },
  // Intermédiaire 3 % ; social +0,5 pt ; très social +1 pt.
  ancien: { intermediaire: 3.0, social: 3.5, tres_social: 4.0 },
};

/**
 * Part du prix retenue dans l'assiette. Le foncier, non amortissable, est
 * forfaitisé à 20 % du prix d'acquisition — il ne s'agit pas d'une estimation
 * du produit mais d'un forfait légal.
 */
export const PART_AMORTISSABLE_JEANBRUN = 0.80;

/**
 * Plafond annuel de déduction, par foyer fiscal et TOUS logements confondus
 * (les deux volets neuf et ancien s'imputent sur le même plafond).
 *
 * Le passage à 10 000 ou 12 000 € ne dépend PAS du niveau de loyer du logement
 * calculé, mais de la part des revenus bruts du foyer affectée au social ou au
 * très social — au moins 50 %.
 */
export const PLAFOND_ANNUEL_JEANBRUN_EUR = {
  base: 8000,
  siMajoriteSocial: 10000,
  siMajoriteTresSocial: 12000,
};

/** Durée minimale de l'engagement de location, en années. */
export const DUREE_ENGAGEMENT_JEANBRUN_ANS = 9;

/** Fenêtre d'acquisition ouvrant droit au dispositif. */
export const FENETRE_JEANBRUN = { debut: "2026-02-21", fin: "2028-12-31" };

/** Part minimale de travaux dans le volet ancien, en % du prix d'acquisition. */
export const SEUIL_TRAVAUX_JEANBRUN_ANCIEN_PCT = 30;

/** Classes DPE admises après travaux pour le volet ancien. */
export const DPE_ADMIS_JEANBRUN_ANCIEN = ["A", "B"];

// ─────────────────────────────────────────────────────────────────────────────
// Denormandie — CGI art. 199 novovicies, 5° du B du I
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ Le Denormandie a été EXPRESSÉMENT EXCLU du rabotage des taux Pinel de
// 2023-2024 : le VI de l'article vise « les acquisitions AUTRES que celles
// mentionnées au 5° du B du I ». Ses taux sont donc restés à 12 % / 18 %.

/** Taux de réduction d'impôt selon la durée d'engagement INITIALE. */
export const TAUX_DENORMANDIE_PCT: Record<6 | 9, number> = { 6: 12, 9: 18 };

/** Métropole. Outre-mer : 23 % (6 ans) / 29 % (9 ans), art. 199 novovicies XII-3°. */
export const TAUX_DENORMANDIE_OUTRE_MER_PCT: Record<6 | 9, number> = { 6: 23, 9: 29 };

/**
 * Compléments obtenus par prorogation triennale (VII bis, A).
 *
 * ⚠️ Il n'existe AUCUN engagement initial de 12 ans. Le « 21 % sur 12 ans »
 * qu'affichent les tableaux de vulgarisation est une addition : 12 + 6 + 3
 * (engagement de 6 ans, deux prorogations) ou 18 + 3 (engagement de 9 ans, une
 * seule prorogation possible). Ce total n'est écrit dans aucun texte.
 */
export const COMPLEMENTS_PROROGATION_DENORMANDIE_PCT: Record<6 | 9, number[]> = {
  6: [6, 3],
  9: [3],
};

/** Plafond de prix de revient, par contribuable et par an (Pinel inclus). */
export const PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR = 300000;

/** Plafond au mètre carré de surface habitable, métropole et outre-mer. */
export const PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR_M2 = 5500;

/** Nombre de logements ouvrant droit à l'avantage, par an (Pinel inclus). */
export const MAX_LOGEMENTS_DENORMANDIE_PAR_AN = 2;

/**
 * Part minimale des travaux dans le COÛT TOTAL DE L'OPÉRATION.
 *
 * ⚠️ L'erreur classique est de lire « 25 % du prix d'acquisition ». Le coût
 * total inclut les travaux eux-mêmes (BOI-IR-RICI-365-20 § 10), d'où :
 *     T ≥ 0,25 × (A + T)   ⟺   T ≥ A / 3
 * soit environ 33 % du prix d'acquisition frais compris, et non 25 %.
 */
export const SEUIL_TRAVAUX_DENORMANDIE_PCT_COUT_TOTAL = 25;

/** Date limite, appréciée à la date d'ACQUISITION du logement. */
export const DATE_LIMITE_DENORMANDIE = "2027-12-31";

// ─────────────────────────────────────────────────────────────────────────────
// Loc'Avantages — CGI art. 199 tricies
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est une RÉDUCTION D'IMPÔT depuis le 01/03/2022, et non la déduction sur
// revenus fonciers de l'ancien dispositif « Cosse ». Les conventions
// enregistrées jusqu'au 28/02/2022 relèvent encore du Cosse.

/**
 * Taux de réduction, appliqués aux revenus BRUTS du logement.
 *
 * ⚠️ Le très social n'existe PAS en location directe : la case est vide dans
 * le tableau officiel (BOI-IR-RICI-400-30 § 70). Le taux de 65 % n'est
 * accessible que par intermédiation locative. `null` porte cette absence.
 */
export const TAUX_LOC_AVANTAGES_PCT: Record<
  "directe" | "intermediation",
  Record<NiveauLoyer, number | null>
> = {
  directe:        { intermediaire: 15, social: 35, tres_social: null },
  intermediation: { intermediaire: 20, social: 40, tres_social: 65 },
};

/** Durée minimale de la convention Anah, en années. */
export const DUREE_CONVENTION_LOC_AVANTAGES_ANS = 6;

/**
 * Date limite, appréciée à la date d'ENREGISTREMENT PAR L'ANAH DE LA DEMANDE
 * de conventionnement — ni la prise d'effet de la convention, ni la date du
 * bail. Prorogation par la LF 2025 (loi n° 2025-127 du 14/02/2025), art. 88.
 */
export const DATE_LIMITE_LOC_AVANTAGES = "2027-12-31";

/** Classe DPE minimale exigée, selon l'année de conclusion du bail. */
export const DPE_MINIMAL_LOC_AVANTAGES = {
  /** Baux conclus ou renouvelés au plus tard le 31/12/2027. */
  jusqua2027: "E",
  /** Baux conclus ou renouvelés à compter du 01/01/2028. */
  apartir2028: "D",
};

// ─────────────────────────────────────────────────────────────────────────────
// Plafonnement global des niches fiscales — CGI art. 200-0 A
// ─────────────────────────────────────────────────────────────────────────────

export const PLAFOND_NICHES_EUR = {
  metropole: 10000,
  /** Réservé aux dispositifs outre-mer : le XII de l'art. 199 novovicies y est. */
  outreMer: 18000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Coefficient de structure
// ─────────────────────────────────────────────────────────────────────────────
//
// Même formule pour tous les dispositifs — 0,7 + 19/S, arrondi à deux
// décimales, plafonné à 1,2 — mais S n'a PAS la même définition partout :
//
//   • Pinel / Denormandie / Jeanbrun intermédiaire : surface à prendre en
//     compte au sens du BOI-IR-RICI-360-20-30 § 120 ;
//   • Loc'Avantages : surface FISCALE, soit la surface habitable augmentée de
//     la moitié des annexes, majoration plafonnée à 8 m².
//
// Coder les deux à l'identique donnerait un loyer plafond faux dès qu'un
// logement possède un balcon ou une cave.

export const COEFFICIENT_STRUCTURE = {
  constante: 0.7,
  numerateur: 19,
  plafond: 1.2,
  /** Majoration maximale d'annexes dans la surface fiscale Loc'Avantages. */
  majorationAnnexesMaxM2: 8,
};

// ─────────────────────────────────────────────────────────────────────────────
// Dispositifs fermés — pour pouvoir le DIRE, pas pour calculer
// ─────────────────────────────────────────────────────────────────────────────
//
// Le produit doit répondre « ce dispositif est clos » quand on l'interroge,
// plutôt que de faire comme s'il n'avait jamais existé. Aucune de ces entrées
// n'est calculable.

export interface DispositifClos {
  nom: string;
  finPourNouveauxInvestisseurs: string;
  remplacePar: string | null;
  precision: string;
}

export const DISPOSITIFS_CLOS: DispositifClos[] = [
  {
    nom: "Pinel",
    finPourNouveauxInvestisseurs: "2024-12-31",
    remplacePar: "Jeanbrun (neuf)",
    precision:
      "Non prorogé par la loi de finances pour 2025. Aucun nouvel investissement " +
      "depuis le 01/01/2025 ; les engagements en cours produisent leurs effets " +
      "jusqu'à leur terme. Le zonage A/B/C subsiste mais n'ouvre plus droit au Pinel.",
  },
  {
    nom: "Pinel+",
    finPourNouveauxInvestisseurs: "2024-12-31",
    remplacePar: "Jeanbrun (neuf)",
    precision: "Variante du Pinel, close à la même date.",
  },
  {
    nom: "Cosse (« Louer abordable »)",
    finPourNouveauxInvestisseurs: "2022-02-28",
    remplacePar: "Loc'Avantages",
    precision:
      "Déduction sur revenus fonciers, remplacée par une réduction d'impôt. Les " +
      "conventions enregistrées jusqu'au 28/02/2022 continuent de produire leurs effets.",
  },
  {
    nom: "Censi-Bouvard",
    finPourNouveauxInvestisseurs: "2022-12-31",
    remplacePar: null,
    precision: "Non prorogé. Le LMNP au réel reste ouvert, mais c'est un régime, pas un dispositif.",
  },
  {
    nom: "Scellier",
    finPourNouveauxInvestisseurs: "2012-12-31",
    remplacePar: null,
    precision: "Abrogé. Réductions en cours d'étalement uniquement.",
  },
  {
    nom: "Duflot",
    finPourNouveauxInvestisseurs: "2014-08-31",
    remplacePar: null,
    precision: "Remplacé en son temps par le Pinel, lui-même clos.",
  },
  {
    nom: "Borloo ancien",
    finPourNouveauxInvestisseurs: "2017-12-31",
    remplacePar: "Loc'Avantages",
    precision: "Conventionnement Anah antérieur au Cosse.",
  },
  {
    nom: "Robien",
    finPourNouveauxInvestisseurs: "2009-12-31",
    remplacePar: null,
    precision: "Amortissement, ancêtre lointain du Jeanbrun.",
  },
  {
    nom: "Besson",
    finPourNouveauxInvestisseurs: "2006-12-31",
    remplacePar: null,
    precision: "Abrogé par la loi de finances pour 2024.",
  },
];
