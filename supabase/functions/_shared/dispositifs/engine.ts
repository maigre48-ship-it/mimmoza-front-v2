// supabase/functions/_shared/dispositifs/engine.ts
//
// Moteur de calcul des dispositifs fiscaux d'investissement locatif.
// Source unique, partagée entre les edge functions (Deno) et le front (Vite,
// via l'alias @shared) : un même cas doit produire le même chiffre partout.
//
// ─── Principe de conception ──────────────────────────────────────────────────
// Le moteur ne refuse jamais silencieusement. Toute condition non remplie ou
// non vérifiable produit un `Constat` explicite :
//   • `bloquant`      → le dispositif ne s'applique pas, `eligible` passe à false
//   • `avertissement` → une condition n'a pas pu être contrôlée faute d'entrée
//   • `information`   → une précision utile au lecteur
// Un résultat non éligible conserve ses chiffres : l'utilisateur voit ce qu'il
// aurait obtenu ET pourquoi il n'y a pas droit. Masquer le calcul le priverait
// de l'information la plus utile.
//
// ─── Ce que le moteur ne fait PAS ────────────────────────────────────────────
// Il ne se prononce pas sur l'éligibilité communale du Denormandie (liste
// ministérielle, ORT, copropriétés en difficulté), ni sur la réalité d'une
// convention Anah. Ces vérifications supposent des données que Mimmoza n'a pas.
// Il le dit, plutôt que de supposer.

import {
  COEFFICIENT_STRUCTURE,
  COMPLEMENTS_PROROGATION_DENORMANDIE_PCT,
  DATE_LIMITE_DENORMANDIE,
  DATE_LIMITE_LOC_AVANTAGES,
  DISPOSITIFS_CLOS,
  DPE_ADMIS_JEANBRUN_ANCIEN,
  DPE_MINIMAL_LOC_AVANTAGES,
  DUREE_CONVENTION_LOC_AVANTAGES_ANS,
  DUREE_ENGAGEMENT_JEANBRUN_ANS,
  FENETRE_JEANBRUN,
  MAJORATION_5E_PERSONNE_INTERMEDIAIRE,
  MAJORATION_5E_PERSONNE_SOCIAL,
  MAJORATION_5E_PERSONNE_TRES_SOCIAL,
  MAX_LOGEMENTS_DENORMANDIE_PAR_AN,
  MILLESIME_BAREMES,
  PART_AMORTISSABLE_JEANBRUN,
  PLAFOND_ANNUEL_JEANBRUN_EUR,
  PLAFOND_NICHES_EUR,
  PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR,
  PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR_M2,
  PLAFONDS_LOYER_INTERMEDIAIRE_EUR_M2,
  PLAFONDS_RESSOURCES_INTERMEDIAIRE,
  PLAFONDS_RESSOURCES_SOCIAL,
  PLAFONDS_RESSOURCES_TRES_SOCIAL,
  PRELEVEMENTS_SOCIAUX_PCT,
  SEUIL_TRAVAUX_DENORMANDIE_PCT_COUT_TOTAL,
  SEUIL_TRAVAUX_JEANBRUN_ANCIEN_PCT,
  TAUX_AMORTISSEMENT_JEANBRUN,
  TAUX_DENORMANDIE_OUTRE_MER_PCT,
  TAUX_DENORMANDIE_PCT,
  TAUX_LOC_AVANTAGES_PCT,
  type LignePlafondRessources,
} from "./baremes.ts";
import type {
  Constat,
  DenormandieInput,
  DispositifCode,
  DispositifFiche,
  DispositifResultat,
  JeanbrunInput,
  LocAvantagesInput,
  LogementInput,
  NiveauLoyer,
  PlafondLoyerResultat,
  PlafondRessourcesResultat,
  ProjectionAnnuelle,
  SituationFiscale,
  ZoneAbc,
} from "./types.ts";

// ── Outils numériques ────────────────────────────────────────────────────────

function arrondi2(n: number): number {
  return Math.round(n * 100) / 100;
}

function euros(n: number): number {
  return Math.round(n);
}

function estNombreFini(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Coefficient de structure : 0,7 + 19/S, arrondi à deux décimales, plafonné
 * à 1,2. L'arrondi précède le plafonnement, conformément au BOFiP.
 */
export function coefficientStructure(surfaceM2: number): number {
  if (!estNombreFini(surfaceM2) || surfaceM2 <= 0) return COEFFICIENT_STRUCTURE.plafond;
  const brut = COEFFICIENT_STRUCTURE.constante + COEFFICIENT_STRUCTURE.numerateur / surfaceM2;
  return Math.min(arrondi2(brut), COEFFICIENT_STRUCTURE.plafond);
}

/**
 * Surface fiscale au sens de Loc'Avantages : habitable + moitié des annexes,
 * la majoration ne pouvant excéder 8 m². Différente de la surface retenue par
 * le Pinel — les confondre fausse le loyer plafond dès qu'il y a un balcon.
 */
export function surfaceFiscale(habitableM2: number, annexesM2 = 0): number {
  const majoration = Math.min(
    Math.max(annexesM2, 0) / 2,
    COEFFICIENT_STRUCTURE.majorationAnnexesMaxM2,
  );
  return habitableM2 + majoration;
}

function dansFenetre(dateIso: string, debut: string, fin: string): boolean {
  return dateIso >= debut && dateIso <= fin;
}

// ── Plafonds ─────────────────────────────────────────────────────────────────

/**
 * Loyer plafond du secteur intermédiaire, par zone. Sert au Pinel (clos), au
 * Denormandie et au Jeanbrun intermédiaire.
 */
export function plafondLoyerIntermediaire(
  zone: ZoneAbc,
  surfaceHabitableM2: number,
  loyerMensuelHcEur?: number,
): PlafondLoyerResultat {
  const plafondBase = PLAFONDS_LOYER_INTERMEDIAIRE_EUR_M2[zone];
  const coef = coefficientStructure(surfaceHabitableM2);
  const loyerMax = arrondi2(plafondBase * coef * surfaceHabitableM2);
  return {
    plafondBaseEurM2: plafondBase,
    coefficientStructure: coef,
    surfaceRetenueM2: surfaceHabitableM2,
    loyerMensuelMaxEur: loyerMax,
    respecte: estNombreFini(loyerMensuelHcEur) ? loyerMensuelHcEur <= loyerMax : null,
    source: `BOI-BAREME-000017 (baux ${MILLESIME_BAREMES}), I-I § 150`,
  };
}

/**
 * Loyer plafond Loc'Avantages. Le plafond de base est COMMUNAL, pas zonal :
 * il doit être fourni par l'appelant, qui l'aura lu dans la table alimentée
 * par l'arrêté annuel. Sans lui, aucun calcul n'est possible — et c'est
 * préférable à un plafond zonal inventé.
 */
export function plafondLoyerLocAvantages(
  plafondCommunalEurM2: number,
  surfaceHabitableM2: number,
  surfaceAnnexesM2 = 0,
  loyerMensuelHcEur?: number,
): PlafondLoyerResultat {
  const surface = surfaceFiscale(surfaceHabitableM2, surfaceAnnexesM2);
  const coef = coefficientStructure(surface);
  const loyerMax = arrondi2(plafondCommunalEurM2 * coef * surface);
  return {
    plafondBaseEurM2: plafondCommunalEurM2,
    coefficientStructure: coef,
    surfaceRetenueM2: arrondi2(surface),
    loyerMensuelMaxEur: loyerMax,
    respecte: estNombreFini(loyerMensuelHcEur) ? loyerMensuelHcEur <= loyerMax : null,
    source: "Arrêté du 6 janvier 2026 (plafonds communaux Loc'Avantages)",
  };
}

function grilleRessources(niveau: NiveauLoyer): {
  lignes: LignePlafondRessources[];
  majorations: Record<ZoneAbc, number>;
  source: string;
} {
  if (niveau === "social") {
    return {
      lignes: PLAFONDS_RESSOURCES_SOCIAL,
      majorations: MAJORATION_5E_PERSONNE_SOCIAL,
      source: `BOI-BAREME-000017 (baux ${MILLESIME_BAREMES}), II-I § 330`,
    };
  }
  if (niveau === "tres_social") {
    return {
      lignes: PLAFONDS_RESSOURCES_TRES_SOCIAL,
      majorations: MAJORATION_5E_PERSONNE_TRES_SOCIAL,
      source: `BOI-BAREME-000017 (baux ${MILLESIME_BAREMES}), II-I § 340`,
    };
  }
  return {
    lignes: PLAFONDS_RESSOURCES_INTERMEDIAIRE,
    majorations: MAJORATION_5E_PERSONNE_INTERMEDIAIRE,
    source: `BOI-BAREME-000017 (baux ${MILLESIME_BAREMES}), II-F § 270`,
  };
}

export function plafondsRessources(
  zone: ZoneAbc,
  niveau: NiveauLoyer,
): PlafondRessourcesResultat {
  const { lignes, majorations, source } = grilleRessources(niveau);
  const colonne = (l: LignePlafondRessources): number =>
    zone === "Abis" ? l.Abis : zone === "A" ? l.A : zone === "B1" ? l.B1 : l.B2C;
  return {
    zone,
    parComposition: lignes.map((l) => ({ composition: l.composition, plafondEur: colonne(l) })),
    majorationCinquiemePersonneEur: majorations[zone],
    source,
  };
}

// ── Contrôles communs ────────────────────────────────────────────────────────

function tauxImpositionFoncier(situation: SituationFiscale): number {
  const ps = estNombreFini(situation.prelevementsSociauxPct)
    ? situation.prelevementsSociauxPct
    : PRELEVEMENTS_SOCIAUX_PCT;
  return (situation.tmiPct + ps) / 100;
}

function controlerPlafondNiches(
  reductionAnnuelleEur: number,
  situation: SituationFiscale,
  constats: Constat[],
): void {
  const plafond = situation.outreMer ? PLAFOND_NICHES_EUR.outreMer : PLAFOND_NICHES_EUR.metropole;
  const dejaConsomme = estNombreFini(situation.nichesDejaConsommeesEur)
    ? situation.nichesDejaConsommeesEur
    : 0;
  const total = reductionAnnuelleEur + dejaConsomme;
  if (total > plafond) {
    constats.push({
      niveau: "avertissement",
      message:
        `Le plafonnement global des niches fiscales est dépassé : ${euros(total)} € ` +
        `pour un plafond de ${plafond} €. La fraction excédentaire est perdue, ` +
        `sans report ni restitution.`,
      reference: "CGI art. 200-0 A",
    });
  }
}

/**
 * L'amortissement n'entre PAS dans le plafonnement des niches : il réduit le
 * revenu foncier imposable, il ne s'impute pas sur l'impôt. Cette note existe
 * parce que la confusion est fréquente.
 */
function noterMecaniqueAmortissement(constats: Constat[]): void {
  constats.push({
    niveau: "information",
    message:
      "L'amortissement est une déduction du revenu foncier, non une réduction " +
      "d'impôt : il échappe au plafonnement global des niches fiscales, mais son " +
      "gain dépend du taux marginal d'imposition.",
    reference: "CGI art. 31, I, 1°",
  });
}

// ── Jeanbrun ─────────────────────────────────────────────────────────────────

function calculerJeanbrun(
  variante: "neuf" | "ancien",
  input: JeanbrunInput,
): DispositifResultat {
  const { logement, situation, niveauLoyer } = input;
  const constats: Constat[] = [];
  let eligible = true;

  const prix = logement.prixAcquisitionNetFraisEur;
  const travaux = estNombreFini(logement.travauxEur) ? logement.travauxEur : 0;

  // — Conditions communes —
  if (logement.dateAcquisition) {
    if (!dansFenetre(logement.dateAcquisition, FENETRE_JEANBRUN.debut, FENETRE_JEANBRUN.fin)) {
      eligible = false;
      constats.push({
        niveau: "bloquant",
        message:
          `Le dispositif ne vise que les acquisitions réalisées entre le ` +
          `${FENETRE_JEANBRUN.debut} et le ${FENETRE_JEANBRUN.fin}.`,
        reference: "LF 2026 art. 47",
      });
    }
  } else {
    constats.push({
      niveau: "avertissement",
      message: "Date d'acquisition non fournie : la fenêtre 21/02/2026 – 31/12/2028 n'a pas été vérifiée.",
    });
  }

  if (logement.habitatCollectif === false) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message: "Le dispositif est réservé aux logements situés dans un bâtiment d'habitation collectif. Une maison individuelle en est exclue.",
      reference: "CCH art. L. 111-1, 6°",
    });
  } else if (logement.habitatCollectif === undefined) {
    constats.push({
      niveau: "avertissement",
      message: "Nature du bâtiment non précisée : la condition d'habitat collectif n'a pas été vérifiée.",
    });
  }

  if (input.regimeReelFoncier === false) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message: "L'option n'est ouverte qu'aux propriétaires soumis au régime réel foncier. Le micro-foncier en est exclu.",
      reference: "LF 2026 art. 47",
    });
  }

  // — Conditions propres à l'ancien —
  if (variante === "ancien") {
    const seuilTravaux = (prix * SEUIL_TRAVAUX_JEANBRUN_ANCIEN_PCT) / 100;
    if (travaux <= 0) {
      constats.push({
        niveau: "avertissement",
        message: `Montant de travaux non fourni : le seuil de ${SEUIL_TRAVAUX_JEANBRUN_ANCIEN_PCT} % du prix d'acquisition n'a pas été vérifié.`,
      });
    } else if (travaux < seuilTravaux) {
      eligible = false;
      constats.push({
        niveau: "bloquant",
        message:
          `Les travaux (${euros(travaux)} €) n'atteignent pas ${SEUIL_TRAVAUX_JEANBRUN_ANCIEN_PCT} % ` +
          `du prix d'acquisition, soit ${euros(seuilTravaux)} € minimum.`,
        reference: "LF 2026 art. 47",
      });
    }

    const dpe = (logement.dpeApresTravaux ?? "").toUpperCase();
    if (!dpe) {
      constats.push({
        niveau: "avertissement",
        message: "Classe DPE après travaux non fournie : la condition de réhabilitation lourde (A ou B) n'a pas été vérifiée.",
      });
    } else if (!DPE_ADMIS_JEANBRUN_ANCIEN.includes(dpe)) {
      eligible = false;
      constats.push({
        niveau: "bloquant",
        message: `Le logement doit atteindre la classe A ou B après travaux. Classe annoncée : ${dpe}.`,
        reference: "CGI art. 150 U, II, 7°, b",
      });
    }
  }

  // — Assiette et taux —
  // Le foncier, non amortissable, est forfaitisé à 20 % : la base est donc
  // 80 % du prix, majoré des travaux dans l'ancien.
  const assietteAvantForfait = variante === "ancien" ? prix + travaux : prix;
  const baseEligible = assietteAvantForfait * PART_AMORTISSABLE_JEANBRUN;
  const taux = TAUX_AMORTISSEMENT_JEANBRUN[variante][niveauLoyer];

  // Le plafond annuel dépend de la part des revenus du FOYER affectée au
  // social, pas du niveau de loyer du seul logement calculé.
  const partSocial = input.partRevenusSocialPct ?? 0;
  const partTresSocial = input.partRevenusTresSocialPct ?? 0;
  let plafondAnnuel = PLAFOND_ANNUEL_JEANBRUN_EUR.base;
  if (partTresSocial >= 50) plafondAnnuel = PLAFOND_ANNUEL_JEANBRUN_EUR.siMajoriteTresSocial;
  else if (partSocial >= 50) plafondAnnuel = PLAFOND_ANNUEL_JEANBRUN_EUR.siMajoriteSocial;

  const amortissementTheorique = (baseEligible * taux) / 100;
  const amortissementRetenu = Math.min(amortissementTheorique, plafondAnnuel);

  if (amortissementTheorique > plafondAnnuel) {
    constats.push({
      niveau: "information",
      message:
        `L'amortissement théorique de ${euros(amortissementTheorique)} €/an est ramené ` +
        `au plafond annuel de ${plafondAnnuel} € par foyer fiscal. Ce plafond est commun ` +
        `aux volets neuf et ancien.`,
      reference: "LF 2026 art. 47",
    });
  }

  noterMecaniqueAmortissement(constats);

  // — Projection sur l'engagement —
  const tauxImpot = tauxImpositionFoncier(situation);
  const projection: ProjectionAnnuelle[] = [];
  let cumul = 0;
  for (let annee = 1; annee <= DUREE_ENGAGEMENT_JEANBRUN_ANS; annee += 1) {
    // Second plafond : le cumul des amortissements ne peut excéder la base.
    const restant = Math.max(baseEligible - cumul, 0);
    const amortissement = Math.min(amortissementRetenu, restant);
    cumul += amortissement;
    projection.push({
      annee,
      amortissementEur: euros(amortissement),
      gainImpotEur: euros(amortissement * tauxImpot),
    });
  }

  const avantageTotal = projection.reduce((acc, p) => acc + p.gainImpotEur, 0);

  // — Plafonds de loyer et de ressources —
  let plafondLoyer: PlafondLoyerResultat | undefined;
  if (logement.zone && estNombreFini(logement.surfaceHabitableM2)) {
    if (niveauLoyer === "intermediaire") {
      plafondLoyer = plafondLoyerIntermediaire(
        logement.zone,
        logement.surfaceHabitableM2,
        logement.loyerMensuelHcEur,
      );
    } else {
      constats.push({
        niveau: "avertissement",
        message:
          "En location sociale ou très sociale, le plafond de loyer suit le référentiel " +
          "Loc'Avantages, fixé commune par commune et non par zone. Il n'a pas été " +
          "vérifié ici faute de plafond communal fourni.",
        reference: "Arrêté du 6 janvier 2026",
      });
    }
  }

  if (plafondLoyer?.respecte === false) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message:
        `Le loyer envisagé (${logement.loyerMensuelHcEur} €/mois) dépasse le plafond ` +
        `de ${plafondLoyer.loyerMensuelMaxEur} €/mois.`,
      reference: plafondLoyer.source,
    });
  }

  const plafondRessources = logement.zone
    ? plafondsRessources(logement.zone, niveauLoyer)
    : undefined;

  return {
    code: variante === "neuf" ? "jeanbrun_neuf" : "jeanbrun_ancien",
    libelle: variante === "neuf" ? "Jeanbrun — logement neuf" : "Jeanbrun — ancien avec travaux",
    mecanique: "amortissement",
    eligible,
    constats,
    baseEligibleEur: euros(baseEligible),
    tauxPct: taux,
    avantageAnnuelEur: projection[0]?.gainImpotEur ?? 0,
    avantageTotalEur: avantageTotal,
    dureeEngagementAns: DUREE_ENGAGEMENT_JEANBRUN_ANS,
    projection,
    plafondLoyer,
    plafondRessources,
    millesimeBaremes: MILLESIME_BAREMES,
    sources: [
      "Loi n° 2026-103 du 19 février 2026 de finances pour 2026, art. 47",
      "CGI art. 31, I, 1°, i et j",
      `BOI-BAREME-000017 (baux ${MILLESIME_BAREMES})`,
    ],
  };
}

export function calculerJeanbrunNeuf(input: JeanbrunInput): DispositifResultat {
  return calculerJeanbrun("neuf", input);
}

export function calculerJeanbrunAncien(input: JeanbrunInput): DispositifResultat {
  return calculerJeanbrun("ancien", input);
}

// ── Denormandie ──────────────────────────────────────────────────────────────

export function calculerDenormandie(input: DenormandieInput): DispositifResultat {
  const { logement, situation, dureeEngagementAns } = input;
  const constats: Constat[] = [];
  let eligible = true;

  const acquisition = logement.prixAcquisitionNetFraisEur;
  const travaux = estNombreFini(logement.travauxEur) ? logement.travauxEur : 0;
  const coutTotal = acquisition + travaux;

  // — Date limite —
  if (logement.dateAcquisition && logement.dateAcquisition > DATE_LIMITE_DENORMANDIE) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message: `Le dispositif ne vise que les acquisitions réalisées jusqu'au ${DATE_LIMITE_DENORMANDIE}.`,
      reference: "CGI art. 199 novovicies, 5° du B du I",
    });
  }

  // — Condition de travaux : 25 % du COÛT TOTAL, travaux inclus —
  // T ≥ 0,25 × (A + T) équivaut à T ≥ A/3, soit ~33 % du prix d'acquisition.
  const seuilTravaux = acquisition / 3;
  const partTravaux = coutTotal > 0 ? (travaux / coutTotal) * 100 : 0;
  if (travaux <= 0) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message: "Le Denormandie suppose des travaux facturés par une entreprise. Aucun montant n'a été fourni.",
      reference: "CGI art. 199 novovicies, 5° du B du I",
    });
  } else if (travaux < seuilTravaux) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message:
        `Les travaux doivent représenter au moins ${SEUIL_TRAVAUX_DENORMANDIE_PCT_COUT_TOTAL} % du coût ` +
        `TOTAL de l'opération, travaux compris. Ici ${arrondi2(partTravaux)} %. Pour un prix ` +
        `d'acquisition de ${euros(acquisition)} €, il faut au minimum ${euros(seuilTravaux)} € ` +
        `de travaux — soit environ un tiers du prix, et non un quart.`,
      reference: "BOI-IR-RICI-365-20 § 10",
    });
  }

  // — Éligibilité communale : hors du champ de Mimmoza —
  if (input.communeEligible === false) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message: "La commune n'ouvre pas droit au Denormandie.",
      reference: "CGI art. 199 novovicies, IV bis",
    });
  } else if (input.communeEligible === undefined) {
    constats.push({
      niveau: "avertissement",
      message:
        "L'éligibilité de la commune n'a pas été vérifiée : elle suppose une liste " +
        "ministérielle, une convention ORT, ou une copropriété en difficulté. À contrôler " +
        "sur le simulateur officiel avant tout engagement.",
      reference: "https://www.service-public.gouv.fr/simulateur/calcul/Zone-Denormandie",
    });
  }

  // — Assiette : double plafond, 300 000 € et 5 500 €/m² —
  let base = coutTotal;
  if (estNombreFini(logement.surfaceHabitableM2) && logement.surfaceHabitableM2 > 0) {
    const plafondSurface = logement.surfaceHabitableM2 * PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR_M2;
    if (base > plafondSurface) {
      constats.push({
        niveau: "information",
        message:
          `Assiette ramenée à ${euros(plafondSurface)} € par le plafond de ` +
          `${PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR_M2} €/m² de surface habitable.`,
        reference: "CGI ann. III art. 46 AZA octies B",
      });
      base = plafondSurface;
    }
  } else {
    constats.push({
      niveau: "avertissement",
      message: `Surface habitable non fournie : le plafond de ${PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR_M2} €/m² n'a pas été appliqué.`,
    });
  }
  if (base > PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR) {
    constats.push({
      niveau: "information",
      message:
        `Assiette ramenée à ${PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR} €, plafond annuel par ` +
        `contribuable — commun au Pinel et au Denormandie.`,
      reference: "CGI art. 199 novovicies, V-A",
    });
    base = PLAFOND_PRIX_REVIENT_DENORMANDIE_EUR;
  }

  constats.push({
    niveau: "information",
    message: `L'avantage est limité à ${MAX_LOGEMENTS_DENORMANDIE_PAR_AN} logements par an et par contribuable.`,
    reference: "BOI-IR-RICI-365-30 § 180",
  });

  // — Taux et prorogations —
  const grilleTaux = situation.outreMer ? TAUX_DENORMANDIE_OUTRE_MER_PCT : TAUX_DENORMANDIE_PCT;
  const tauxInitial = grilleTaux[dureeEngagementAns];
  const complementsPossibles = COMPLEMENTS_PROROGATION_DENORMANDIE_PCT[dureeEngagementAns];
  const nbProrogations = Math.min(
    input.prorogationsTriennales ?? 0,
    complementsPossibles.length,
  );
  if ((input.prorogationsTriennales ?? 0) > complementsPossibles.length) {
    constats.push({
      niveau: "avertissement",
      message:
        `Un engagement de ${dureeEngagementAns} ans n'autorise que ` +
        `${complementsPossibles.length} période(s) triennale(s) de prorogation.`,
      reference: "CGI art. 199 novovicies, VII bis",
    });
  }
  const complements = complementsPossibles.slice(0, nbProrogations);
  const tauxTotal = tauxInitial + complements.reduce((a, b) => a + b, 0);

  constats.push({
    niveau: "information",
    message:
      "Il n'existe pas d'engagement initial de 12 ans : les 21 % souvent annoncés " +
      "résultent de l'engagement initial augmenté de prorogations triennales, " +
      "décidées à l'échéance et non à la signature.",
    reference: "CGI art. 199 novovicies, VII bis",
  });

  // — Projection : étalement par 1/6 ou 1/9, puis compléments —
  const reductionInitiale = (base * tauxInitial) / 100;
  const parAnInitial = reductionInitiale / dureeEngagementAns;
  const projection: ProjectionAnnuelle[] = [];
  for (let annee = 1; annee <= dureeEngagementAns; annee += 1) {
    projection.push({
      annee,
      reductionImpotEur: euros(parAnInitial),
      gainImpotEur: euros(parAnInitial),
    });
  }
  // Chaque prorogation est une période de trois ans, son complément étalé sur elle.
  let anneeCourante = dureeEngagementAns;
  for (const complement of complements) {
    const montant = (base * complement) / 100;
    const parAn = montant / 3;
    for (let i = 0; i < 3; i += 1) {
      anneeCourante += 1;
      projection.push({
        annee: anneeCourante,
        reductionImpotEur: euros(parAn),
        gainImpotEur: euros(parAn),
      });
    }
  }

  const avantageTotal = projection.reduce((acc, p) => acc + p.gainImpotEur, 0);
  controlerPlafondNiches(projection[0]?.gainImpotEur ?? 0, situation, constats);

  constats.push({
    niveau: "information",
    message: "La fraction de réduction non imputée une année est perdue : ni report, ni restitution.",
    reference: "BOI-IR-RICI-365-30 § 160",
  });

  // — Plafonds de loyer et de ressources : grille intermédiaire —
  let plafondLoyer: PlafondLoyerResultat | undefined;
  if (logement.zone && estNombreFini(logement.surfaceHabitableM2)) {
    plafondLoyer = plafondLoyerIntermediaire(
      logement.zone,
      logement.surfaceHabitableM2,
      logement.loyerMensuelHcEur,
    );
    if (plafondLoyer.respecte === false) {
      eligible = false;
      constats.push({
        niveau: "bloquant",
        message:
          `Le loyer envisagé (${logement.loyerMensuelHcEur} €/mois) dépasse le plafond ` +
          `de ${plafondLoyer.loyerMensuelMaxEur} €/mois.`,
        reference: plafondLoyer.source,
      });
    }
  }

  return {
    code: "denormandie",
    libelle: "Denormandie ancien",
    mecanique: "reduction_impot",
    eligible,
    constats,
    baseEligibleEur: euros(base),
    tauxPct: tauxTotal,
    avantageAnnuelEur: projection[0]?.gainImpotEur ?? 0,
    avantageTotalEur: avantageTotal,
    dureeEngagementAns: dureeEngagementAns + nbProrogations * 3,
    projection,
    plafondLoyer,
    plafondRessources: logement.zone
      ? plafondsRessources(logement.zone, "intermediaire")
      : undefined,
    millesimeBaremes: MILLESIME_BAREMES,
    sources: [
      "CGI art. 199 novovicies, 5° du B du I",
      "BOI-IR-RICI-365-10, -20 et -30",
      `BOI-BAREME-000017 (baux ${MILLESIME_BAREMES})`,
      "Loi n° 2024-322 du 9 avril 2024, art. 42 (prorogation au 31/12/2027)",
    ],
  };
}

// ── Loc'Avantages ────────────────────────────────────────────────────────────

export function calculerLocAvantages(input: LocAvantagesInput): DispositifResultat {
  const { logement, situation, niveauLoyer } = input;
  const constats: Constat[] = [];
  let eligible = true;

  const mode = input.intermediationLocative ? "intermediation" : "directe";
  const taux = TAUX_LOC_AVANTAGES_PCT[mode][niveauLoyer];

  // Le très social n'existe pas en location directe : la case est vide au
  // BOFiP. Beaucoup de sites annoncent 50 % — ce taux n'existe pas.
  if (taux === null) {
    eligible = false;
    constats.push({
      niveau: "bloquant",
      message:
        "Le niveau très social (Loc3) n'est pas ouvert en location directe : il " +
        "suppose une intermédiation locative par un organisme agréé. Le taux de 65 % " +
        "n'est accessible que par cette voie.",
      reference: "BOI-IR-RICI-400-30 § 70",
    });
  }

  const tauxApplicable = taux ?? 0;

  // — Assiette : revenus bruts, sans plafond propre au dispositif —
  const revenusBruts = estNombreFini(input.revenusBrutsAnnuelsEur)
    ? input.revenusBrutsAnnuelsEur
    : estNombreFini(logement.loyerMensuelHcEur)
      ? logement.loyerMensuelHcEur * 12
      : 0;

  if (revenusBruts <= 0) {
    constats.push({
      niveau: "avertissement",
      message: "Ni revenus bruts annuels ni loyer mensuel fournis : la réduction ne peut pas être chiffrée.",
    });
  }

  // — Plafond de loyer : COMMUNAL, jamais zonal —
  let plafondLoyer: PlafondLoyerResultat | undefined;
  if (estNombreFini(input.plafondLoyerCommunalEurM2) && estNombreFini(logement.surfaceHabitableM2)) {
    plafondLoyer = plafondLoyerLocAvantages(
      input.plafondLoyerCommunalEurM2,
      logement.surfaceHabitableM2,
      logement.surfaceAnnexesM2 ?? 0,
      logement.loyerMensuelHcEur,
    );
    if (plafondLoyer.respecte === false) {
      eligible = false;
      constats.push({
        niveau: "bloquant",
        message:
          `Le loyer envisagé (${logement.loyerMensuelHcEur} €/mois) dépasse le plafond ` +
          `communal de ${plafondLoyer.loyerMensuelMaxEur} €/mois.`,
        reference: plafondLoyer.source,
      });
    }
  } else {
    constats.push({
      niveau: "avertissement",
      message:
        "Plafond de loyer non vérifié : les plafonds Loc'Avantages sont fixés commune " +
        "par commune, et non par zone A/B/C. Sans la valeur communale, aucun contrôle " +
        "n'est possible.",
      reference: "Arrêté du 6 janvier 2026",
    });
  }

  constats.push({
    niveau: "information",
    message:
      "Le dispositif suppose une convention conclue avec l'Anah, d'une durée minimale " +
      `de ${DUREE_CONVENTION_LOC_AVANTAGES_ANS} ans, et une location nue à usage de ` +
      "résidence principale. La date limite du 31/12/2027 porte sur l'enregistrement de " +
      "la DEMANDE de conventionnement, non sur le bail.",
    reference: "CGI art. 199 tricies, I.A",
  });

  constats.push({
    niveau: "information",
    message:
      `Classe DPE minimale : ${DPE_MINIMAL_LOC_AVANTAGES.jusqua2027} pour les baux ` +
      `conclus jusqu'au 31/12/2027, ${DPE_MINIMAL_LOC_AVANTAGES.apartir2028} à compter du ` +
      "01/01/2028.",
    reference: "BOI-IR-RICI-400-10 § 90 et § 100",
  });

  constats.push({
    niveau: "information",
    message: "Le régime micro-foncier est incompatible avec Loc'Avantages.",
    reference: "BOI-IR-RICI-400-30 § 150",
  });

  // — Projection sur la durée de convention —
  const reductionAnnuelle = (revenusBruts * tauxApplicable) / 100;
  const projection: ProjectionAnnuelle[] = [];
  for (let annee = 1; annee <= DUREE_CONVENTION_LOC_AVANTAGES_ANS; annee += 1) {
    projection.push({
      annee,
      reductionImpotEur: euros(reductionAnnuelle),
      gainImpotEur: euros(reductionAnnuelle),
    });
  }

  controlerPlafondNiches(euros(reductionAnnuelle), situation, constats);

  return {
    code: "loc_avantages",
    libelle: `Loc'Avantages — ${
      niveauLoyer === "intermediaire" ? "Loc1 intermédiaire"
        : niveauLoyer === "social" ? "Loc2 social" : "Loc3 très social"
    }${input.intermediationLocative ? " avec intermédiation" : ""}`,
    mecanique: "reduction_impot",
    eligible,
    constats,
    baseEligibleEur: euros(revenusBruts),
    tauxPct: tauxApplicable,
    avantageAnnuelEur: euros(reductionAnnuelle),
    avantageTotalEur: euros(reductionAnnuelle * DUREE_CONVENTION_LOC_AVANTAGES_ANS),
    dureeEngagementAns: DUREE_CONVENTION_LOC_AVANTAGES_ANS,
    projection,
    plafondLoyer,
    plafondRessources: logement.zone
      ? plafondsRessources(logement.zone, niveauLoyer)
      : undefined,
    millesimeBaremes: MILLESIME_BAREMES,
    sources: [
      "CGI art. 199 tricies",
      "BOI-IR-RICI-400, -400-10, -400-20 et -400-30",
      "Arrêté du 6 janvier 2026 (plafonds de loyer communaux)",
      "Loi n° 2025-127 du 14 février 2025, art. 88 (prorogation au 31/12/2027)",
    ],
  };
}

// ── Fiches pédagogiques ──────────────────────────────────────────────────────

export const FICHES_DISPOSITIFS: Record<DispositifCode, DispositifFiche> = {
  jeanbrun_neuf: {
    code: "jeanbrun_neuf",
    libelle: "Jeanbrun — logement neuf",
    mecanique: "amortissement",
    resume:
      "Déduction du revenu foncier au titre de l'amortissement du prix d'acquisition, " +
      "à 3,5 % par an en location intermédiaire, 4,5 % en social, 5,5 % en très social, " +
      "sur une base de 80 % du prix. Créé par la loi de finances pour 2026 pour succéder au Pinel.",
    conditions: [
      "Logement neuf ou en VEFA, dans un bâtiment d'habitation collectif",
      "Acquisition ou dépôt de permis entre le 21/02/2026 et le 31/12/2028",
      "Régime réel foncier obligatoire",
      "Location nue, à usage de résidence principale, pendant au moins 9 ans",
      "Mise en location dans les 12 mois suivant l'achèvement",
      "Locataire hors foyer fiscal et hors parenté jusqu'au deuxième degré",
      "Plafonds de loyer et de ressources selon la zone et le niveau de loyer",
    ],
    dateLimite: FENETRE_JEANBRUN.fin,
    faitGenerateurDateLimite: "Acquisition du logement, ou dépôt de la demande de permis de construire",
    plafondNichesEur: 0,
    sources: [
      "Loi n° 2026-103 du 19 février 2026, art. 47",
      "CGI art. 31, I, 1°, i",
    ],
    piegesCourants: [
      "Ce n'est pas une réduction d'impôt : l'amortissement diminue le revenu foncier imposable, donc son gain dépend du taux marginal d'imposition.",
      "Le plafond annuel de 8 000 € (10 000 ou 12 000 € en social) s'apprécie par foyer fiscal et non par logement, et couvre aussi le volet ancien.",
      "Les 10 000 ou 12 000 € dépendent de la part des revenus du foyer affectée au social, pas du niveau de loyer du logement pris isolément.",
      "La maison individuelle est exclue : seul l'habitat collectif ouvre droit au dispositif.",
      "À la revente, le prix d'acquisition est minoré des amortissements déduits, ce qui augmente la plus-value imposable.",
    ],
  },
  jeanbrun_ancien: {
    code: "jeanbrun_ancien",
    libelle: "Jeanbrun — ancien avec travaux",
    mecanique: "amortissement",
    resume:
      "Même mécanique que le volet neuf, à des taux plus faibles : 3 % en intermédiaire, " +
      "3,5 % en social, 4 % en très social. La base inclut les travaux.",
    conditions: [
      "Logement ancien acquis entre le 21/02/2026 et le 31/12/2028, en habitat collectif",
      "Travaux d'amélioration représentant au moins 30 % du prix d'acquisition",
      "Classe DPE A ou B après travaux (réhabilitation lourde)",
      "Logement non classé ni inscrit au titre des monuments historiques",
      "Logement inoccupé depuis l'achèvement des travaux",
      "Régime réel foncier, location nue en résidence principale pendant 9 ans",
    ],
    dateLimite: FENETRE_JEANBRUN.fin,
    faitGenerateurDateLimite: "Acquisition du logement",
    plafondNichesEur: 0,
    sources: [
      "Loi n° 2026-103 du 19 février 2026, art. 47",
      "CGI art. 31, I, 1°, j",
    ],
    piegesCourants: [
      "Les taux du volet ancien sont plus faibles que ceux du neuf : 3 % et non 3,5 % en intermédiaire.",
      "Le « plafond unique de 10 700 € dans l'ancien » que l'on lit parfois n'existe pas : 10 700 € est le plafond du déficit foncier, qui est un autre mécanisme.",
      "Non cumulable, sur le même logement, avec le Malraux, le Denormandie ou le Girardin.",
    ],
  },
  denormandie: {
    code: "denormandie",
    libelle: "Denormandie ancien",
    mecanique: "reduction_impot",
    resume:
      "Réduction d'impôt de 12 % sur 6 ans ou 18 % sur 9 ans, calculée sur le prix de " +
      "revient plafonné, pour l'acquisition d'un logement ancien à rénover dans une " +
      "commune éligible.",
    conditions: [
      "Commune éligible : liste ministérielle, convention ORT, ou copropriété en difficulté",
      "Travaux facturés par une entreprise représentant au moins 25 % du coût total de l'opération",
      "Travaux achevés au plus tard le 31 décembre de la deuxième année suivant l'acquisition",
      "Condition de performance énergétique après travaux",
      "Acquisition au plus tard le 31/12/2027",
      "Location nue en résidence principale, plafonds de loyer et de ressources du secteur intermédiaire",
    ],
    dateLimite: DATE_LIMITE_DENORMANDIE,
    faitGenerateurDateLimite: "Acquisition du logement",
    plafondNichesEur: PLAFOND_NICHES_EUR.metropole,
    sources: [
      "CGI art. 199 novovicies, 5° du B du I",
      "BOI-IR-RICI-365",
      "Loi n° 2024-322 du 9 avril 2024, art. 42",
    ],
    piegesCourants: [
      "Les 25 % de travaux se calculent sur le coût TOTAL de l'opération, travaux compris — soit environ un tiers du prix d'acquisition, et non un quart.",
      "Il n'existe pas d'engagement initial de 12 ans : les 21 % s'obtiennent par prorogation triennale, décidée à l'échéance.",
      "Le Denormandie a échappé au rabotage des taux Pinel de 2023-2024 : ses taux sont restés à 12 % et 18 %.",
      "Le BOFiP affiche encore le 31/12/2026 comme date limite ; la loi du 9 avril 2024 l'a portée au 31/12/2027, et la loi prime sur la doctrine.",
      "L'éligibilité est communale et non zonale : le zonage A/B/C ne sert qu'aux plafonds de loyer et de ressources.",
    ],
  },
  loc_avantages: {
    code: "loc_avantages",
    libelle: "Loc'Avantages",
    mecanique: "reduction_impot",
    resume:
      "Réduction d'impôt calculée sur les revenus bruts du logement, en contrepartie " +
      "d'une convention Anah plafonnant le loyer : 15 % en Loc1, 35 % en Loc2, et " +
      "20 %, 40 % ou 65 % avec intermédiation locative.",
    conditions: [
      "Convention conclue avec l'Anah, d'une durée minimale de 6 ans",
      "Demande de conventionnement enregistrée par l'Anah au plus tard le 31/12/2027",
      "Location nue à usage de résidence principale",
      "Loyer sous le plafond communal, ressources du locataire sous le plafond zonal",
      "Locataire hors foyer fiscal, hors ascendant et descendant",
      "Classe DPE E jusqu'aux baux 2027, D à partir des baux 2028",
      "Incompatible avec le micro-foncier",
    ],
    dateLimite: DATE_LIMITE_LOC_AVANTAGES,
    faitGenerateurDateLimite: "Enregistrement par l'Anah de la demande de conventionnement",
    plafondNichesEur: PLAFOND_NICHES_EUR.metropole,
    sources: [
      "CGI art. 199 tricies",
      "BOI-IR-RICI-400",
      "Loi n° 2025-127 du 14 février 2025, art. 88",
    ],
    piegesCourants: [
      "Le niveau très social (Loc3) n'existe pas en location directe : le taux de 65 % suppose une intermédiation locative. Le « 50 % en direct » que l'on lit parfois n'existe pas.",
      "C'est une réduction d'impôt depuis mars 2022, et non la déduction sur revenus fonciers de l'ancien dispositif Cosse.",
      "Les plafonds de LOYER sont communaux, alors que les plafonds de RESSOURCES sont zonaux : deux logiques différentes dans le même dispositif.",
      "La durée de 9 ans en cas de travaux subventionnés par l'Anah a été supprimée : c'est 6 ans partout.",
      "La date limite porte sur l'enregistrement de la demande par l'Anah, pas sur la signature du bail.",
    ],
  },
};

/** Dispositifs clos, exposés pour pouvoir répondre « ce dispositif n'existe plus ». */
export function listerDispositifsClos() {
  return DISPOSITIFS_CLOS;
}

/** Retrouve un dispositif clos par son nom, insensible à la casse et aux accents. */
export function trouverDispositifClos(nom: string) {
  const normaliser = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/[^a-z0-9]/gu, "");
  const cible = normaliser(nom);
  return DISPOSITIFS_CLOS.find((d) => normaliser(d.nom).includes(cible) || cible.includes(normaliser(d.nom))) ?? null;
}
