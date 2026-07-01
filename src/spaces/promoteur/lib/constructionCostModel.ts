// src/spaces/promoteur/lib/constructionCostModel.ts
//
// Estimation du coût de construction NEUVE (terrain nu) — espace Promoteur.
// Modèle paramétrique, ratios €/m² SDP HT, ordres de grandeur marché France
// 2025-2026 (post-RE2020). Montants INDICATIFS HT.
//
// Périmètre INCLUS : bâtiment (GO, clos-couvert, second œuvre, lots techniques),
// ouvrages annexes (balcons, terrasses, ascenseurs, parking), VRD de parcelle,
// honoraires de maîtrise d'œuvre et aléas.
// Périmètre EXCLU : foncier, démolition/désamiantage, dépollution, fondations
// spéciales non standard, taxes d'aménagement (TA/RAP), participations, portage
// financier, commercialisation, assurances (DO/CNR/RC). À ajouter séparément.
//
// Sans dépendance externe — barème centralisé, migrable vers Supabase.

/* ────────────────────────────── Types ─────────────────────────────────────── */

export type Typologie = "collectif" | "individuel_groupe" | "maison_individuelle";
export type Gamme = "eco" | "standard" | "premium";
export type TypeToiture = "plate" | "pente";
export type TypeVolets = "aucun" | "battant" | "roulant_manuel" | "roulant_elec";
export type Region =
  | "ile_de_france"
  | "paca_littoral"
  | "rhone_alpes"
  | "metropoles_regionales"
  | "national_moyen"
  | "zones_detendues"
  | "outre_mer";
export type Complexite = "simple" | "normal" | "complexe" | "tres_complexe";
export type TypeParking =
  | "aucun"
  | "aerien"
  | "semi_enterre"
  | "sous_sol"
  | "sous_sol_complexe";
export type GabaritAscenseur = "basique" | "pmr" | "lit";

export type WarningLevel = "info" | "warning" | "error";
export interface Warning {
  level: WarningLevel;
  code: string;
  message: string;
}

/* ─────────────────────── Métadonnées (pour l'UI) ───────────────────────────── */

export const TYPOLOGIES: { id: Typologie; label: string; description: string }[] = [
  { id: "collectif",           label: "Logement collectif",  description: "Immeuble R+2 et plus" },
  { id: "individuel_groupe",   label: "Individuel groupé",   description: "Maisons en bande / intermédiaire" },
  { id: "maison_individuelle", label: "Maison individuelle", description: "Pavillon isolé" },
];

export const GAMMES: { id: Gamme; label: string; description: string }[] = [
  { id: "eco",      label: "Éco",      description: "Social / entrée de gamme" },
  { id: "standard", label: "Standard", description: "Prestations courantes" },
  { id: "premium",  label: "Premium",  description: "Haut de gamme" },
];

export const TOITURES: { id: TypeToiture; label: string }[] = [
  { id: "plate", label: "Toit plat" },
  { id: "pente", label: "Toiture en pente" },
];

export const VOLETS: { id: TypeVolets; label: string }[] = [
  { id: "aucun",          label: "Aucun" },
  { id: "battant",        label: "Battants" },
  { id: "roulant_manuel", label: "Roulant manuel" },
  { id: "roulant_elec",   label: "Roulant élec." },
];

export const REGIONS: { id: Region; label: string }[] = [
  { id: "ile_de_france",         label: "Île-de-France" },
  { id: "paca_littoral",         label: "PACA / littoral Sud-Est" },
  { id: "rhone_alpes",           label: "Rhône-Alpes / Alpes" },
  { id: "metropoles_regionales", label: "Grandes métropoles régionales" },
  { id: "national_moyen",        label: "Moyenne nationale" },
  { id: "zones_detendues",       label: "Zones détendues / rural" },
  { id: "outre_mer",             label: "Outre-mer (DROM)" },
];

export const COMPLEXITES: { id: Complexite; label: string; description: string }[] = [
  { id: "simple",        label: "Simple",        description: "Terrain plat, accès aisé, plan régulier" },
  { id: "normal",        label: "Normal",        description: "Conditions courantes" },
  { id: "complexe",      label: "Complexe",      description: "Terrain contraint, mitoyenneté, archi. travaillée" },
  { id: "tres_complexe", label: "Très complexe", description: "Site urbain dense, sous-œuvre, géométrie difficile" },
];

export const PARKINGS: { id: TypeParking; label: string }[] = [
  { id: "aucun",             label: "Aucun" },
  { id: "aerien",            label: "Aérien / surface" },
  { id: "semi_enterre",      label: "Semi-enterré" },
  { id: "sous_sol",          label: "Sous-sol" },
  { id: "sous_sol_complexe", label: "Sous-sol complexe (nappe, R-2…)" },
];

export const GABARITS_ASCENSEUR: { id: GabaritAscenseur; label: string }[] = [
  { id: "basique", label: "Basique" },
  { id: "pmr",     label: "Accessible PMR (fauteuil)" },
  { id: "lit",     label: "Dimensionné lit / brancard" },
];

/* ─────────────────────────────── Barème ────────────────────────────────────── */

// Coût BÂTIMENT central €/m² SDP HT (GO + clos-couvert + second œuvre + lots
// techniques). Hors VRD / honoraires / aléas / ouvrages annexes / parking.
// NB : l'individuel groupé bénéficie de la mitoyenneté et de l'effet de série ;
// la maison isolée a le plus mauvais ratio enveloppe/surface → coût/m² le plus
// élevé à prestations comparables.
const RATIO_BATIMENT: Record<Typologie, Record<Gamme, number>> = {
  collectif:           { eco: 1600, standard: 1850, premium: 2500 },
  individuel_groupe:   { eco: 1450, standard: 1650, premium: 2150 },
  maison_individuelle: { eco: 1550, standard: 1950, premium: 2600 },
};

// Répartition interne du coût bâtiment (somme = 1).
const REPARTITION_BATIMENT = {
  gros_oeuvre:     0.32,
  clos_couvert:    0.24,
  second_oeuvre:   0.24,
  lots_techniques: 0.20,
} as const;

// Coefficient régional (main d'œuvre + matériaux locaux).
const COEF_REGION: Record<Region, number> = {
  ile_de_france:         1.18,
  paca_littoral:         1.12,
  rhone_alpes:           1.06,
  metropoles_regionales: 1.04,
  national_moyen:        1.0,
  zones_detendues:       0.93,
  outre_mer:             1.28,
};

// Coefficient de complexité chantier (appliqué au bâtiment et à la VRD).
const COEF_COMPLEXITE: Record<Complexite, number> = {
  simple:        0.95,
  normal:        1.0,
  complexe:      1.12,
  tres_complexe: 1.25,
};

// Demi-amplitude de la fourchette d'incertitude (phase faisabilité).
const SPREAD_COMPLEXITE: Record<Complexite, number> = {
  simple:        0.1,
  normal:        0.14,
  complexe:      0.2,
  tres_complexe: 0.25,
};

// Leviers constructifs.
const MAJ_GO_PAR_NIVEAU = 0.02;                 // +2 % de GO / niveau au-delà de R+2
const FACTEUR_TOITURE: Record<TypeToiture, number> = { plate: 1.0, pente: 1.1 };
const DELTA_VOLETS_M2: Record<TypeVolets, number> = {
  aucun: 0, battant: 8, roulant_manuel: 18, roulant_elec: 32, // €/m² SDP
};
const COUT_BALCON_M2 = 1000;                    // €/m²
const COUT_TERRASSE_M2 = 600;                   // €/m²

// Parking : coût central € HT / place (× coef régional ensuite).
const COUT_PARKING: Record<TypeParking, number> = {
  aucun:             0,
  aerien:            6000,
  semi_enterre:      18000,
  sous_sol:          25000,
  sous_sol_complexe: 38000,
};

// Ascenseur : coût € HT / cage selon gamme, ajusté par complexité, borné 75–120 k.
const ASCENSEUR_BASE: Record<Gamme, number> = { eco: 75000, standard: 90000, premium: 110000 };
const ASCENSEUR_FACT_COMPLEXITE: Record<Complexite, number> = {
  simple: 0.98, normal: 1.0, complexe: 1.08, tres_complexe: 1.15,
};
const ASCENSEUR_MIN = 75000;
const ASCENSEUR_MAX = 120000;
const COUT_ASCENSEUR_PAR_NIVEAU = 9000;         // surcoût / arrêt au-delà de 2 niveaux desservis
const COEF_GABARIT_ASCENSEUR: Record<GabaritAscenseur, number> = {
  basique: 1.0,                                 // cabine standard
  pmr:     1.15,                                // cabine accessible fauteuil
  lit:     1.5,                                 // cabine lit / brancard (médicalisé)
};
const SEUIL_ASCENSEUR_NIVEAUX = 4;              // R+3 → ascenseur obligatoire (collectif)
const SDP_PAR_ASCENSEUR = 1500;                 // 1 cage / 1500 m² SDP

// Seuils d'alerte.
const SEUIL_COUT_M2_BAS = 1700;                 // €/m² total HT jugé bas pour du neuf
const SEUIL_PART_PARKING = 0.12;                // part du parking enterré dans le total

/* ──────────────────────────── Entrée / Sortie ─────────────────────────────── */

export interface HypothesesCout {
  typologie: Typologie;
  gamme: Gamme;
  sdp: number;                 // surface de plancher (m²) — dénominateur
  niveaux: number;             // niveaux hors sol (RDC compris)
  typeToiture: TypeToiture;
  typeVolets: TypeVolets;
  surfaceBalcons: number;      // m²
  surfaceTerrasses: number;    // m²
  vrdPct: number;              // fraction du coût bâtiment (0–1)
  honorairesPct: number;       // fraction du sous-total travaux (0–1)
  aleasPct: number;            // fraction du (travaux + honoraires) (0–1)
  parkingPlaces: number;       // nb de places
  // ── Nouveaux paramètres (optionnels → compat UI existante) ────────────────
  region?: Region;             // défaut national_moyen
  complexite?: Complexite;     // défaut normal
  typeParking?: TypeParking;   // défaut aucun
  parkingCoutPlace?: number;   // override manuel du coût/place (sinon dérivé du type)
  avecAscenseur?: boolean;     // ascenseur optionnel dès R+1 (forcé si obligatoire)
  nbCages?: number;            // override du nombre de cages (0/absent = auto)
  gabaritAscenseur?: GabaritAscenseur; // défaut basique
}

export const HYPOTHESES_DEFAUT: Omit<HypothesesCout, "typologie" | "gamme" | "sdp"> = {
  niveaux: 3,
  typeToiture: "plate",
  typeVolets: "roulant_manuel",
  surfaceBalcons: 0,
  surfaceTerrasses: 0,
  vrdPct: 0.08,
  honorairesPct: 0.12,
  aleasPct: 0.05,
  parkingPlaces: 0,
  region: "national_moyen",
  complexite: "normal",
  typeParking: "aucun",
  avecAscenseur: false,
  gabaritAscenseur: "basique",
};

export interface PosteResultat {
  id: string;
  label: string;
  montant: number; // € HT
  ratioM2: number; // € / m² SDP
}

export interface MontantFourchette {
  total: number;   // € HT
  coutM2: number;  // € / m² SDP
}

export interface Fourchette {
  low: MontantFourchette;
  central: MontantFourchette;
  high: MontantFourchette;
}

export interface Ventilation {
  batiment: number;         // GO + clos-couvert + second œuvre + technique
  ouvragesAnnexes: number;  // balcons + terrasses + ascenseurs + parking
  vrd: number;
  sousTotalTravaux: number; // bâtiment + annexes + VRD
  honoraires: number;
  aleas: number;
  totalHT: number;
}

export interface EstimationResultat {
  postes: PosteResultat[];
  ventilation: Ventilation;
  fourchette: Fourchette;
  warnings: Warning[];
  meta: { regionCoef: number; complexiteCoef: number; spread: number };
  // ── Compat directe (valeurs centrales) ────────────────────────────────────
  sousTotalBatiment: number;
  sousTotalTravaux: number;
  totalHT: number;
  coutM2: number;
  nbAscenseurs: number;
  ascenseurPossible: boolean;      // au moins un étage (R+1)
  ascenseurObligatoire: boolean;   // collectif R+3+
}

/* ──────────────────────────────── Calcul ──────────────────────────────────── */

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function estimerCoutConstruction(h: HypothesesCout): EstimationResultat {
  const sdp = Number.isFinite(h.sdp) && h.sdp > 0 ? h.sdp : 0;
  const niveaux = Math.max(1, Math.round(h.niveaux || 1));
  const region = h.region ?? "national_moyen";
  const complexite = h.complexite ?? "normal";
  const typeParking = h.typeParking ?? "aucun";

  const regionCoef = COEF_REGION[region];
  const complexiteCoef = COEF_COMPLEXITE[complexite];
  const coefGlobal = regionCoef * complexiteCoef;
  const spread = SPREAD_COMPLEXITE[complexite];

  // ── Bâtiment ───────────────────────────────────────────────────────────────
  const batimentBase = RATIO_BATIMENT[h.typologie][h.gamme] * sdp * coefGlobal;
  const facteurGO = 1 + Math.max(0, niveaux - 2) * MAJ_GO_PAR_NIVEAU;
  const facteurToit = FACTEUR_TOITURE[h.typeToiture];
  const deltaVolets = DELTA_VOLETS_M2[h.typeVolets] * sdp * regionCoef;

  const grosOeuvre     = batimentBase * REPARTITION_BATIMENT.gros_oeuvre * facteurGO;
  const closCouvert    = batimentBase * REPARTITION_BATIMENT.clos_couvert * facteurToit;
  const secondOeuvre   = batimentBase * REPARTITION_BATIMENT.second_oeuvre + deltaVolets;
  const lotsTechniques = batimentBase * REPARTITION_BATIMENT.lots_techniques;
  const sousTotalBatiment = grosOeuvre + closCouvert + secondOeuvre + lotsTechniques;

  // ── Ouvrages annexes ─────────────────────────────────────────────────────
  const balconsTerrasses =
    (Math.max(0, h.surfaceBalcons) * COUT_BALCON_M2 +
      Math.max(0, h.surfaceTerrasses) * COUT_TERRASSE_M2) * coefGlobal;

  const ascenseurPossible = niveaux >= 2 && sdp > 0; // au moins un étage
  const ascenseurObligatoire =
    h.typologie === "collectif" && niveaux >= SEUIL_ASCENSEUR_NIVEAUX && sdp > 0;
  const ascenseurActif = ascenseurPossible && (ascenseurObligatoire || (h.avecAscenseur ?? false));

  const nbCagesAuto = h.typologie === "collectif" ? Math.max(1, Math.ceil(sdp / SDP_PAR_ASCENSEUR)) : 1;
  const nbCagesOverride = h.nbCages && h.nbCages > 0 ? Math.round(h.nbCages) : 0;
  const nbAscenseurs = ascenseurActif ? Math.max(1, nbCagesOverride || nbCagesAuto) : 0;

  // Coût / cage : socle gamme×complexité borné 75–120 k€, + surcoût par arrêt
  // au-delà de 2 niveaux desservis (portes palières, course), × gabarit cabine,
  // × coef régional.
  const socleCage = clamp(
    ASCENSEUR_BASE[h.gamme] * ASCENSEUR_FACT_COMPLEXITE[complexite],
    ASCENSEUR_MIN,
    ASCENSEUR_MAX,
  );
  const surcoutArrets = Math.max(0, niveaux - 2) * COUT_ASCENSEUR_PAR_NIVEAU;
  const coefGabarit = COEF_GABARIT_ASCENSEUR[h.gabaritAscenseur ?? "basique"];
  const coutCage = (socleCage + surcoutArrets) * coefGabarit * regionCoef;
  const ascenseur = nbAscenseurs * coutCage;

  const coutPlace =
    h.parkingCoutPlace && h.parkingCoutPlace > 0
      ? h.parkingCoutPlace
      : COUT_PARKING[typeParking];
  const parking = Math.max(0, h.parkingPlaces) * coutPlace * regionCoef;

  const ouvragesAnnexes = balconsTerrasses + ascenseur + parking;

  // ── VRD, honoraires, aléas ────────────────────────────────────────────────
  const vrd = sousTotalBatiment * h.vrdPct;
  const sousTotalTravaux = sousTotalBatiment + ouvragesAnnexes + vrd;
  const honoraires = sousTotalTravaux * h.honorairesPct;
  const aleas = (sousTotalTravaux + honoraires) * h.aleasPct;
  const totalHT = sousTotalTravaux + honoraires + aleas;
  const coutM2 = sdp > 0 ? totalHT / sdp : 0;

  const m2 = (v: number): number => (sdp > 0 ? v / sdp : 0);

  // ── Postes détaillés ──────────────────────────────────────────────────────
  const postes: PosteResultat[] = [
    { id: "vrd",             label: "VRD & aménagements", montant: vrd,            ratioM2: m2(vrd) },
    { id: "gros_oeuvre",     label: "Gros œuvre",         montant: grosOeuvre,     ratioM2: m2(grosOeuvre) },
    { id: "clos_couvert",    label: "Clos-couvert",       montant: closCouvert,    ratioM2: m2(closCouvert) },
    { id: "second_oeuvre",   label: "Second œuvre",       montant: secondOeuvre,   ratioM2: m2(secondOeuvre) },
    { id: "lots_techniques", label: "Lots techniques",    montant: lotsTechniques, ratioM2: m2(lotsTechniques) },
  ];
  if (balconsTerrasses > 0) {
    postes.push({ id: "balcons_terrasses", label: "Balcons & terrasses", montant: balconsTerrasses, ratioM2: m2(balconsTerrasses) });
  }
  if (ascenseur > 0) {
    postes.push({ id: "ascenseur", label: `Ascenseur${nbAscenseurs > 1 ? "s" : ""} (${nbAscenseurs})`, montant: ascenseur, ratioM2: m2(ascenseur) });
  }
  if (parking > 0) {
    postes.push({ id: "parking", label: "Parking / stationnement", montant: parking, ratioM2: m2(parking) });
  }
  postes.push(
    { id: "honoraires", label: "Honoraires (MOE, BET, CT)", montant: honoraires, ratioM2: m2(honoraires) },
    { id: "aleas",      label: "Aléas & imprévus",          montant: aleas,      ratioM2: m2(aleas) },
  );

  // ── Fourchette ────────────────────────────────────────────────────────────
  const fourchette: Fourchette = {
    low:     { total: totalHT * (1 - spread), coutM2: coutM2 * (1 - spread) },
    central: { total: totalHT,                coutM2 },
    high:    { total: totalHT * (1 + spread), coutM2: coutM2 * (1 + spread) },
  };

  // ── Avertissements métier ─────────────────────────────────────────────────
  const warnings: Warning[] = [];

  if (sdp <= 0) {
    warnings.push({ level: "error", code: "SDP_NULLE", message: "Renseignez une surface de plancher supérieure à 0." });
  }
  if (sdp > 0 && coutM2 < SEUIL_COUT_M2_BAS) {
    warnings.push({
      level: "warning",
      code: "COUT_M2_BAS",
      message: `Coût de ${Math.round(coutM2)} €/m² anormalement bas pour du neuf 2025-2026 — vérifiez la gamme, la région et les hypothèses.`,
    });
  }
  if (parking > 0 && (typeParking === "sous_sol" || typeParking === "sous_sol_complexe")) {
    const part = totalHT > 0 ? parking / totalHT : 0;
    if (part > SEUIL_PART_PARKING) {
      warnings.push({
        level: "warning",
        code: "PARKING_SOUS_SOL",
        message: `Le parking enterré représente ${Math.round(part * 100)} % du coût total — poste sensible à sécuriser (études de sol, nappe).`,
      });
    }
  }
  if (nbAscenseurs > 0 && ascenseurObligatoire) {
    warnings.push({
      level: "info",
      code: "ASCENSEUR_OBLIGATOIRE",
      message: `Collectif R+${niveaux - 1} : ${nbAscenseurs} ascenseur${nbAscenseurs > 1 ? "s" : ""} intégré${nbAscenseurs > 1 ? "s" : ""} (obligatoire dès R+3).`,
    });
  }
  if (complexite === "complexe" || complexite === "tres_complexe") {
    warnings.push({
      level: "warning",
      code: "COMPLEXITE_ELEVEE",
      message: "Complexité chantier élevée : fourchette élargie, chiffrage à fiabiliser par consultation d'entreprises.",
    });
  }
  if (h.typologie === "maison_individuelle" && niveaux > 3) {
    warnings.push({
      level: "warning",
      code: "MI_NIVEAUX",
      message: `R+${niveaux - 1} inhabituel pour une maison individuelle — vérifiez la typologie retenue.`,
    });
  }

  return {
    postes,
    ventilation: {
      batiment: sousTotalBatiment,
      ouvragesAnnexes,
      vrd,
      sousTotalTravaux,
      honoraires,
      aleas,
      totalHT,
    },
    fourchette,
    warnings,
    meta: { regionCoef, complexiteCoef, spread },
    sousTotalBatiment,
    sousTotalTravaux,
    totalHT,
    coutM2,
    nbAscenseurs,
    ascenseurPossible,
    ascenseurObligatoire,
  };
}