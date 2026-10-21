// src/spaces/promoteur/implantation/implantationCheck.ts
//
// LOT L1b — CONTRÔLE D'IMPLANTATION SOURCÉ (front).
//
// ORIGINE : portage de `mimmozia-studio/src/core/site/implantationCheck.ts`
// (Lot 1 Studio, R1 à R3), adapté au ruleset du front
// (`mimmoza.plu.resolved_ruleset_v1`) et au classement des limites de
// l'éditeur 2D. INTENTION : mutualiser avec le Studio plus tard.
//
// Règles de vérité :
//  - « respecté » / « non respecté » UNIQUEMENT si la limite est classée par
//    l'utilisateur et que la règle applicable est sourcée (voir
//    `rulesetReculs.motifNonSourcee` : valeur chiffrée, document identifiable,
//    validation nominative à jour, référence non factice) ;
//  - une emprise qui FRANCHIT une limite donne « non respecté » sur cette
//    limite (fait géométrique) ; les autres limites d'un bâtiment hors parcelle
//    ne valent jamais mieux que « à vérifier » ;
//  - sinon « à vérifier », avec la raison ; la comparaison numérique reste
//    affichée À TITRE INDICATIF seulement ;
//  - jamais de « conforme » global : au mieux « respecte les règles sourcées
//    connues », avec ce qui reste à vérifier.
//  - Les reculs de DESSIN de l'éditeur (5/3/3 m par défaut) ne sont jamais
//    lus ici.

import type { CategorieLimite, DistanceBatimentLimite, OrigineClassement, PortionFacade, Pt, RapportDistances, SegmentLimite } from "./boundaryDistances.ts";
import type { EtatRuleset, MotifRegle, ProvenanceRuleset, RegleRetrait, ValidationRegle, ValidationsRegles, CategorieRegle } from "./rulesetReculs.ts";
import { LIBELLES_CATEGORIE, avertissementsRegle, extraireReglesRetrait, motifNonSourcee, natureReference, referenceAffichee } from "./rulesetReculs.ts";
import { etatDateDocument, lireProvenancePlu, type DocumentPlu, type EtatDateDocument, type ProvenancePlu } from "../lib/pluProvenance.ts";

export type Verdict = "respecte" | "non-respecte" | "a-verifier";

export const VERDICT_LABELS: Readonly<Record<Verdict, string>> = {
  respecte: "Respecté",
  "non-respecte": "Non respecté",
  "a-verifier": "À vérifier",
};

export const VERDICT_COLORS: Readonly<Record<Verdict, string>> = {
  respecte: "#15803d",
  "non-respecte": "#dc2626",
  "a-verifier": "#d97706",
};

export type RaisonAVerifier =
  | "ruleset-absent"
  | "ruleset-illisible"
  | "ruleset-format-inconnu"
  | "ruleset-autre-commune"
  | "commune-non-verifiable"
  | "limite-non-classee"
  | "classement-deduit"
  | MotifRegle
  | "implantation-en-limite-possible"
  | "batiment-hors-parcelle";

export const RAISON_LABELS: Readonly<Record<RaisonAVerifier, string>> = {
  "ruleset-absent": "Aucun règlement PLU chargé : ouvrez la page Foncier / PLU pour identifier la zone et ses règles",
  "ruleset-illisible": "Règlement PLU enregistré illisible : rechargez-le depuis la page Foncier / PLU",
  "ruleset-format-inconnu": "Règlement PLU dans un format non reconnu : rechargez-le depuis la page Foncier / PLU",
  "ruleset-autre-commune": "Le règlement PLU chargé vise une autre commune que la parcelle",
  "commune-non-verifiable": "Commune de la parcelle ou du règlement inconnue : impossible de vérifier que le règlement s'applique à cette parcelle",
  "limite-non-classee": "Limite non classée (voirie, séparative ou fond) : aucune règle ne peut lui être rattachée",
  "classement-deduit": "Classement de la limite déduit automatiquement : à confirmer",
  "valeur-absente": "Valeur absente du règlement chargé : complétez-la depuis la page Foncier / PLU",
  "regle-non-chiffree": "Règle dépendant de la hauteur (H/2…) : le retrait n'est pas une valeur fixe",
  "regle-alternative": "Règle alternative (à l'alignement OU en retrait) : le retrait n'est pas un minimum simple",
  "regle-non-sourcee": "Règle sans document identifié",
  "reference-factice": "Référence non exploitable (« n/a », « - », « non renseigné », « sans objet »…)",
  "regle-ia-non-confirmee": "Règle extraite automatiquement : à confirmer par une personne nommée (référence + nom)",
  "validation-perimee": "La validation ne correspond plus à la valeur, au document ou à la zone en cours",
  "implantation-en-limite-possible": "Le règlement autorise l'implantation en limite : la règle alternative doit être vérifiée",
  "batiment-hors-parcelle": "Bâtiment hors parcelle : aucune limite ne peut être jugée respectée",
};

export type NiveauImplantation = "non-respecte" | "a-verifier" | "respecte-regles-sourcees-connues" | "non-evaluable";

export const NIVEAU_LABELS: Readonly<Record<NiveauImplantation, string>> = {
  "non-respecte": "Au moins un retrait sourcé n'est pas respecté",
  "a-verifier": "À vérifier : aucune règle sourcée ne permet de conclure",
  "respecte-regles-sourcees-connues": "Respecte les retraits sourcés connus (ce n'est pas une attestation de conformité)",
  "non-evaluable": "Non évaluable : parcelle ou bâtiment manquant",
};

export const LIBELLE_EMPRISE_HORS_PARCELLE = "Une emprise déborde de la parcelle (fait géométrique, indépendant des règles)";

/** Tolérance (m) : un bâtiment posé pile au retrait le respecte. */
export const TOLERANCE_RETRAIT_M = 1e-6;

export interface ControleLimite {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly categorie: CategorieLimite;
  readonly origineClassement: OrigineClassement;
  readonly distance: number;
  readonly distanceSignee: number;
  readonly pointOnBuilding: Pt;
  readonly pointOnBoundary: Pt;
  readonly portion: PortionFacade;
  readonly retraitRequis: number | null;
  readonly regle: RegleRetrait | null;
  readonly reference: string | null;
  readonly validation: ValidationRegle | null;
  /** R2 — avertissements maintenus même après validation (confiance faible, source de repli, valeur conditionnelle). */
  readonly avertissements: readonly string[];
  readonly verdict: Verdict;
  readonly raison: RaisonAVerifier | null;
  readonly verdictIndicatif: "respecte" | "non-respecte" | null;
  readonly marge: number | null;
  readonly explication: string;
  readonly horsParcelle: boolean;
  /** L2 — nature de la référence : documentaire (provenance extraite), saisie, ou aucune. */
  readonly natureReference: "documentaire" | "saisie" | "aucune";
}

export interface ControleBatiment {
  readonly buildingId: string;
  readonly buildingName: string;
  readonly insideParcel: boolean;
  readonly minDistance: number | null;
  readonly limites: readonly ControleLimite[];
  readonly verdict: Verdict;
}

export interface ControleImplantation {
  readonly batiments: readonly ControleBatiment[];
  readonly niveau: NiveauImplantation;
  readonly libelleNiveau: string;
  readonly aVerifier: readonly string[];
  readonly regles: Readonly<Record<CategorieRegle, { readonly regle: RegleRetrait; readonly motif: MotifRegle | null; readonly reference: string; readonly avertissements: readonly string[]; readonly natureReference: "documentaire" | "saisie" | "aucune" }>> | null;
  readonly provenance: ProvenanceRuleset | null;
  /** L2 — provenance par valeur du ruleset (null : ancien format v1 sans provenance). */
  readonly provenancePlu: ProvenancePlu | null;
  /** L2 — document source et état de sa date (« date du document inconnue », ancienneté). */
  readonly document: DocumentPlu | null;
  readonly etatDateDocument: EtatDateDocument | null;
  readonly etatRuleset: EtatRuleset["statut"];
  readonly horsPerimetre: readonly string[];
}

export interface OptionsControle {
  /** Code INSEE de la commune de la parcelle (pour détecter un ruleset d'une autre commune). */
  readonly communeParcelle?: string | null;
  /** L2 — date de référence pour l'ancienneté du document (tests). */
  readonly maintenant?: Date;
}

export const HORS_PERIMETRE_L1B: readonly string[] = [
  "Seuls les retraits aux limites sont contrôlés ; hauteur, emprise au sol, pleine terre, stationnement, accès et servitudes ne le sont pas ici.",
  "Distances mesurées sur l'emprise du rez-de-chaussée : retraits par niveau, attiques, balcons et débords ne sont pas mesurés.",
  "Mesures dans le repère local de l'éditeur (projection équirectangulaire autour de la parcelle) : écart d'environ 0,5 % (environ 10 cm sur 20 m, dans le sens d'une parcelle légèrement réduite) ; ce n'est pas un relevé de géomètre.",
  "Les enclaves (trous) de la parcelle ne sont pas des limites mesurées.",
];

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const fmt = (v: number): string => v.toFixed(2).replace(".", ",");

function raisonRuleset(etat: EtatRuleset, prov: ProvenanceRuleset | null, communeParcelle: string | null): RaisonAVerifier | null {
  if (etat.statut === "absent") return "ruleset-absent";
  if (etat.statut === "illisible") return "ruleset-illisible";
  if (etat.statut === "format-inconnu") return "ruleset-format-inconnu";
  // R2 : une commune inconnue (parcelle ou règlement) n'est pas vérifiable.
  if (!communeParcelle || !prov?.communeInsee) return "commune-non-verifiable";
  if (prov.communeInsee !== communeParcelle) return "ruleset-autre-commune";
  return null;
}

function controlerLimite(
  segment: SegmentLimite,
  mesure: DistanceBatimentLimite,
  regles: Record<CategorieRegle, RegleRetrait> | null,
  validations: ValidationsRegles,
  raisonGlobale: RaisonAVerifier | null,
): ControleLimite {
  const cat = segment.categorie;
  const regle = cat !== "non-classee" && regles ? regles[cat] : null;
  const validation = cat !== "non-classee" ? (validations[cat] ?? null) : null;
  const retraitRequis = regle?.valeur ?? null;
  const marge = retraitRequis === null ? null : r3(mesure.distance - retraitRequis);
  const verdictIndicatif =
    retraitRequis === null ? null : mesure.distance + TOLERANCE_RETRAIT_M >= retraitRequis ? "respecte" : "non-respecte";

  let raison: RaisonAVerifier | null = null;
  if (cat === "non-classee") raison = "limite-non-classee";
  else if (raisonGlobale !== null) raison = raisonGlobale;
  else if (segment.origineClassement !== "utilisateur") raison = "classement-deduit";
  else if (regle === null) raison = "valeur-absente";
  else raison = motifNonSourcee(regle, validation);
  if (raison === null && verdictIndicatif === "non-respecte" && cat === "separative" && regle?.implantationEnLimite === true) {
    raison = "implantation-en-limite-possible";
  }

  const franchie = mesure.exceedsBoundary;
  const verdict: Verdict = franchie ? "non-respecte" : raison !== null ? "a-verifier" : (verdictIndicatif ?? "a-verifier");
  const reference = regle ? referenceAffichee(regle, validation) : null;
  const avertissements = regle ? avertissementsRegle(regle) : [];
  const nature = regle ? natureReference(regle, validation) : "aucune";
  const nom = `${LIBELLES_CATEGORIE[cat]} ${segment.id}`;
  const mesureTxt = `${fmt(mesure.distance)} m mesurés`;
  let explication: string;
  if (franchie) {
    explication =
      `${nom} : l'emprise franchit cette limite (dépassement de ${fmt(mesure.outsideDepth)} m hors de la parcelle) — non respecté.` +
      (raison !== null ? ` Règle de retrait : ${RAISON_LABELS[raison].toLowerCase()}.` : "");
  } else if (raison === null) {
    explication =
      `${nom} : ${mesureTxt} pour un retrait de ${fmt(retraitRequis ?? 0)} m (${reference}) — ` +
      (verdict === "respecte" ? `respecté, marge ${fmt(marge ?? 0)} m.` : `non respecté, il manque ${fmt(Math.abs(marge ?? 0))} m.`);
  } else {
    const indicatif =
      verdictIndicatif === null
        ? ""
        : ` À titre indicatif, la valeur du règlement chargé (${fmt(retraitRequis ?? 0)} m) serait ${verdictIndicatif === "respecte" ? "respectée" : "dépassée"}.`;
    explication = `${nom} : ${mesureTxt}. À vérifier — ${RAISON_LABELS[raison]}.${indicatif}`;
  }
  if (avertissements.length > 0) explication += ` Attention : ${avertissements.join(" ")}`;
  return {
    buildingId: mesure.buildingId,
    buildingName: mesure.buildingName,
    segmentId: segment.id,
    segmentIndex: segment.index,
    categorie: cat,
    origineClassement: segment.origineClassement,
    distance: mesure.distance,
    distanceSignee: mesure.distanceSignee,
    pointOnBuilding: mesure.pointOnBuilding,
    pointOnBoundary: mesure.pointOnBoundary,
    portion: mesure.portion,
    retraitRequis,
    regle,
    reference,
    validation,
    avertissements,
    verdict,
    raison,
    verdictIndicatif,
    marge,
    explication,
    horsParcelle: franchie,
    natureReference: nature,
  };
}

function pire(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes("non-respecte")) return "non-respecte";
  if (verdicts.includes("a-verifier") || verdicts.length === 0) return "a-verifier";
  return "respecte";
}

/** Contrôle sourcé de l'implantation de tous les bâtiments mesurés. */
export function controlerImplantation(
  segments: readonly SegmentLimite[],
  rapport: RapportDistances,
  etat: EtatRuleset,
  validations: ValidationsRegles,
  options: OptionsControle = {},
): ControleImplantation {
  const regles = etat.statut === "ok" ? extraireReglesRetrait(etat.ruleset) : null;
  const prov = regles ? regles.voirie.provenance : null;
  const raisonGlobale = raisonRuleset(etat, prov, options.communeParcelle ?? null);
  const byId = new Map(segments.map((s) => [s.id, s]));

  const batiments: ControleBatiment[] = rapport.buildings.map((b) => {
    const brutes = b.perSegment
      .map((m) => {
        const s = byId.get(m.segmentId);
        return s && !s.interne ? controlerLimite(s, m, regles, validations, raisonGlobale) : null;
      })
      .filter((x): x is ControleLimite => x !== null);
    const limites = b.insideParcel
      ? brutes
      : brutes.map((l) =>
          l.horsParcelle || l.verdict === "non-respecte"
            ? l
            : {
                ...l,
                verdict: "a-verifier" as const,
                raison: "batiment-hors-parcelle" as const,
                explication: `${LIBELLES_CATEGORIE[l.categorie]} ${l.segmentId} : ${fmt(l.distance)} m mesurés. À vérifier — ${RAISON_LABELS["batiment-hors-parcelle"]}.`,
              },
        );
    const verdict = b.insideParcel ? pire(limites.map((l) => l.verdict)) : "non-respecte";
    return { buildingId: b.buildingId, buildingName: b.buildingName, insideParcel: b.insideParcel, minDistance: b.minDistance, limites, verdict };
  });

  const aVerifier: string[] = [];
  for (const b of batiments) {
    if (!b.insideParcel) aVerifier.push(`« ${b.buildingName} » : l'emprise déborde de la parcelle.`);
    for (const l of b.limites) if (l.verdict === "a-verifier") aVerifier.push(`« ${b.buildingName} » — ${l.explication}`);
  }

  const tous = batiments.flatMap((b) => b.limites);
  const exterieurs = segments.filter((s) => !s.interne);
  let niveau: NiveauImplantation;
  if (batiments.length === 0 || exterieurs.length === 0) niveau = "non-evaluable";
  else if (batiments.some((b) => b.verdict === "non-respecte")) niveau = "non-respecte";
  else if (!tous.some((l) => l.verdict === "respecte")) niveau = "a-verifier";
  else niveau = "respecte-regles-sourcees-connues";

  const retraitViole = tous.some((l) => l.verdict === "non-respecte" && !l.horsParcelle);
  const deborde = batiments.some((b) => !b.insideParcel || b.limites.some((l) => l.horsParcelle));
  let libelleNiveau: string;
  if (niveau === "non-respecte") {
    libelleNiveau = retraitViole
      ? deborde
        ? `${NIVEAU_LABELS["non-respecte"]} ; ${LIBELLE_EMPRISE_HORS_PARCELLE.charAt(0).toLowerCase()}${LIBELLE_EMPRISE_HORS_PARCELLE.slice(1)}`
        : NIVEAU_LABELS["non-respecte"]
      : LIBELLE_EMPRISE_HORS_PARCELLE;
  } else if (niveau === "respecte-regles-sourcees-connues" && aVerifier.length > 0) {
    libelleNiveau = `${NIVEAU_LABELS[niveau]} — ${aVerifier.length} point(s) restent à vérifier`;
  } else {
    libelleNiveau = NIVEAU_LABELS[niveau];
  }

  const reglesOut = regles
    ? (Object.fromEntries(
        (["voirie", "separative", "fond"] as const).map((c) => [
          c,
          {
            regle: regles[c],
            motif: motifNonSourcee(regles[c], validations[c] ?? null),
            reference: referenceAffichee(regles[c], validations[c] ?? null),
            avertissements: avertissementsRegle(regles[c]),
            natureReference: natureReference(regles[c], validations[c] ?? null),
          },
        ]),
      ) as unknown as ControleImplantation["regles"])
    : null;

  const provenancePlu = etat.statut === "ok" ? lireProvenancePlu(etat.ruleset) : null;
  const document = provenancePlu?.document ?? null;
  return {
    batiments,
    niveau,
    libelleNiveau,
    aVerifier,
    regles: reglesOut,
    provenance: prov,
    provenancePlu,
    document,
    etatDateDocument: etat.statut === "ok" ? etatDateDocument(document, options.maintenant ?? new Date()) : null,
    etatRuleset: etat.statut,
    horsPerimetre: HORS_PERIMETRE_L1B,
  };
}
