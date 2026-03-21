// src/spaces/promoteur/services/promoteurSynthese.mapper.ts

import type {
  PromoteurRawInput,
  PromoteurSynthese,
  ProjetInfo,
  TechniqueAnalysis,
  MarcheAnalysis,
  FinancierAnalysis,
  RisqueItem,
  FinancementAnalysis,
  Scores,
  ExecutiveSummary,
  Scenario,
  PluConstrainte,
  RecommendationType,
  PrixMarche,
  RisqueNiveau,
} from './promoteurSynthese.types';

// ---- Helpers ----------------------------------------------------------------

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!denominator || denominator === 0) return fallback;
  return numerator / denominator;
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function generateId(): string {
  return `synthese_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---- ProjetInfo -------------------------------------------------------------

function mapProjetInfo(input: PromoteurRawInput): ProjetInfo {
  const { foncier, conception } = input;
  return {
    adresse: foncier.adresse ?? 'Non renseignee',
    commune: foncier.commune ?? 'Non renseignee',
    codePostal: foncier.codePostal ?? '',
    departement: foncier.departement ?? '',
    surfaceTerrain: foncier.surfaceTerrain ?? 0,
    surfacePlancher: conception.surfacePlancher ?? 0,
    nbLogements: conception.nbLogements ?? 0,
    typologieMix: conception.typologieMix ?? {},
    programmeType: conception.programmeType ?? 'Residentiel collectif',
    dateEtude: new Date().toISOString(),
  };
}

// ---- TechniqueAnalysis ------------------------------------------------------

function mapTechniqueAnalysis(input: PromoteurRawInput): TechniqueAnalysis {
  const { plu, conception } = input;

  const contraintes: PluConstrainte[] = (plu.reglesPlu ?? []).map((r) => ({
    libelle: r.libelle,
    valeur: r.valeur,
    statut: r.statut ?? 'CONFORME',
    detail: String(r.valeur ?? ''),
  }));

  const hasBlockingConstraint = contraintes.some((c) => c.statut === 'BLOQUANT');
  const hasLimitedConstraint = contraintes.some((c) => c.statut === 'LIMITE');

  const faisabiliteTechnique: TechniqueAnalysis['faisabiliteTechnique'] = hasBlockingConstraint
    ? 'IMPOSSIBLE'
    : hasLimitedConstraint
    ? 'SOUS_RESERVE'
    : 'CONFIRME';

  const notesTechniques: string[] = [];
  if (hasBlockingConstraint) {
    notesTechniques.push('Des contraintes PLU bloquantes ont ete identifiees.');
  }
  if (hasLimitedConstraint) {
    notesTechniques.push('Certaines regles PLU sont en limite de conformite.');
  }
  if (!plu.zone) {
    notesTechniques.push('Zone PLU non renseignee. Analyse incomplete.');
  }

  return {
    zonePlu: plu.zone ?? 'Inconnue',
    cub: plu.cub ?? null,
    hauteurMax: plu.hauteurMax ?? null,
    reculs: {
      voirie: plu.reculs?.voirie ?? null,
      limitesSeparatives: plu.reculs?.limitesSeparatives ?? null,
      fond: plu.reculs?.fond ?? null,
    },
    pleineTerre: plu.pleineTerre ?? null,
    contraintes,
    faisabiliteTechnique,
    notesTechniques,
    empriseBatie: conception.empriseBatie ?? null,
    hauteurProjet: conception.hauteurProjet ?? null,
    nbNiveaux: conception.nbNiveaux ?? null,
    parking: {
      nbPlacesRequises: conception.parking?.nbPlacesRequises ?? null,
      nbPlacesPrevues: conception.parking?.nbPlacesPrevues ?? null,
      type: conception.parking?.type ?? null,
    },
  };
}

// ---- MarcheAnalysis ---------------------------------------------------------

function mapMarcheAnalysis(input: PromoteurRawInput): MarcheAnalysis {
  const { marche, evaluation } = input;

  const prixNeuf = marche.prixNeufM2 ?? 0;
  const prixProjet = evaluation.prixVenteM2 ?? 0;
  const prixAncien = marche.prixAncienM2 ?? 0;

  const positionPrix = prixNeuf > 0
    ? roundTo(safeDiv(prixProjet - prixNeuf, prixNeuf) * 100, 1)
    : 0;
  const primiumNeuf = prixAncien > 0
    ? roundTo(safeDiv(prixNeuf - prixAncien, prixAncien) * 100, 1)
    : 0;

  const zoneMarche: MarcheAnalysis['zoneMarche'] =
    prixNeuf > 6000 ? 'TENDU' : prixNeuf > 3500 ? 'INTERMEDIAIRE' : 'DETENDU';

  const transactionsRecentes: PrixMarche = {
    prixMoyenM2: marche.prixMoyenDvf ?? prixAncien,
    prixMin: marche.prixMinDvf ?? 0,
    prixMax: marche.prixMaxDvf ?? 0,
    nbTransactions: marche.nbTransactionsDvf ?? 0,
    periode: marche.periodeDvf ?? '2022-2024',
    source: 'DVF',
  };

  const notesMarcheLibre: string[] = [];
  if (positionPrix > 10) {
    notesMarcheLibre.push(
      `Prix projet superieur de ${positionPrix}% au marche -- risque absorption lente.`
    );
  }
  if (positionPrix < -5) {
    notesMarcheLibre.push('Prix projet inferieur au marche -- marge potentiellement optimisable.');
  }
  if ((marche.offreConcurrente ?? 0) > 5) {
    notesMarcheLibre.push(
      `Concurrence elevee : ${marche.offreConcurrente} programmes en cours sur la zone.`
    );
  }

  return {
    zoneMarche,
    prixNeufMoyenM2: prixNeuf,
    prixProjetM2: prixProjet,
    positionPrix,
    prixAncienMoyenM2: prixAncien,
    primiumNeuf,
    prixParTypologie: marche.prixParTypologie ?? {},
    offreConcurrente: marche.offreConcurrente ?? 0,
    demandeLocative: null,
    demographieIndicateurs: marche.demographieData ?? [],
    transactionsRecentes,
    absorptionMensuelle: marche.absorptionMensuelle ?? null,
    delaiEcoulementMois:
      marche.absorptionMensuelle && input.conception.nbLogements
        ? roundTo(safeDiv(input.conception.nbLogements, marche.absorptionMensuelle), 1)
        : null,
    notesMarcheLibre,
  };
}

// ---- FinancierAnalysis ------------------------------------------------------

function mapFinancierAnalysis(input: PromoteurRawInput): FinancierAnalysis {
  const { bilan, evaluation, foncier, conception } = input;

  const ca = bilan.chiffreAffaires ?? evaluation.prixVenteTotal ?? 0;
  const sp = conception.surfacePlancher ?? 1;

  const coutFoncierTotal =
    (foncier.prixAcquisition ?? bilan.coutFoncier ?? 0) +
    (foncier.fraisNotaire ?? 0) +
    (foncier.fraisDemolition ?? 0);

  const coutTravaux = bilan.coutTravaux ?? 0;
  const coutTravauxM2 = bilan.coutTravauxM2 ?? roundTo(safeDiv(coutTravaux, sp), 0);
  const fraisFinanciers = bilan.fraisFinanciers ?? 0;
  const fraisComm = bilan.fraisCommercialisation ?? 0;
  const fraisGestion = bilan.fraisGestion ?? 0;
  const autresCoutsVal = bilan.autresCouts ?? 0;

  const autresCouts: FinancierAnalysis['autresCouts'] = autresCoutsVal > 0
    ? [{
        libelle: 'Autres couts',
        montantHT: autresCoutsVal,
        pourcentageCA: roundTo(safeDiv(autresCoutsVal, ca) * 100, 1),
      }]
    : [];

  const coutRevientTotal =
    coutFoncierTotal + coutTravaux + fraisFinanciers + fraisComm + fraisGestion + autresCoutsVal;
  const coutRevientM2 = roundTo(safeDiv(coutRevientTotal, sp), 0);
  const margeNette = ca - coutRevientTotal;
  const margeNettePercent = roundTo(safeDiv(margeNette, ca) * 100, 1);
  const margeOp = ca - coutFoncierTotal - coutTravaux;
  const margeOpPercent = roundTo(safeDiv(margeOp, ca) * 100, 1);
  const trn = roundTo(safeDiv(margeNette, coutRevientTotal) * 100, 1);
  const bilancielRatio = roundTo(safeDiv(coutFoncierTotal, ca) * 100, 1);

  return {
    chiffreAffairesTotal: ca,
    chiffreAffairesM2: roundTo(safeDiv(ca, sp), 0),
    coutFoncier: coutFoncierTotal,
    coutTravaux,
    coutTravauxM2,
    coutFinanciers: fraisFinanciers,
    fraisCommercialisation: fraisComm,
    fraisGestion,
    autresCouts,
    coutRevientTotal,
    coutRevientM2,
    margeNette,
    margeNettePercent,
    margeOperationnelle: margeOp,
    margeOperationnellePercent: margeOpPercent,
    trnRendement: trn,
    vatRecoverable: true,
    bilancielRatio,
  };
}

// ---- Risques ----------------------------------------------------------------

function mapRisques(input: PromoteurRawInput, financier: FinancierAnalysis): RisqueItem[] {
  const risques: RisqueItem[] = [];
  let idx = 0;

  const add = (
    categorie: RisqueItem['categorie'],
    libelle: string,
    niveau: RisqueNiveau,
    probabilite: number,
    impact: number,
    mitigation: string,
    isKillSwitch = false,
  ): void => {
    risques.push({
      id: `R${String(++idx).padStart(3, '0')}`,
      categorie,
      libelle,
      niveau,
      probabilite,
      impact,
      scoreCombine: roundTo(probabilite * impact, 2),
      mitigation,
      isKillSwitch,
    });
  };

  if (financier.margeNettePercent < 8) {
    add('FINANCIER', 'Marge nette insuffisante (< 8%)', 'CRITIQUE', 1, 1,
      'Renegociation foncier ou revision programme indispensable.', true);
  } else if (financier.margeNettePercent < 12) {
    add('FINANCIER', 'Marge nette sous le seuil cible (< 12%)', 'ELEVE', 0.7, 0.8,
      'Surveiller absorption et maitrise des couts travaux.');
  }

  const prixNeuf = input.marche.prixNeufM2 ?? 0;
  const prixProjet = input.evaluation.prixVenteM2 ?? 0;
  if (prixNeuf > 0 && prixProjet > prixNeuf * 1.1) {
    const delta = roundTo(safeDiv(prixProjet - prixNeuf, prixNeuf) * 100, 1);
    add('MARCHE', `Prix de vente > marche +10% (${delta}%)`, 'CRITIQUE', 0.8, 0.9,
      'Repositionnement tarifaire ou differenciation produit necessaire.', true);
  }

  const pluBloquant = (input.plu.reglesPlu ?? []).some((r) => r.statut === 'BLOQUANT');
  if (pluBloquant) {
    add('REGLEMENTAIRE', 'Contrainte PLU bloquante detectee', 'CRITIQUE', 1, 1,
      'Consultation urbanisme prealable et eventuelle derogation.', true);
  }

  if (input.foncier.pollutionDetectee) {
    add('ENVIRONNEMENTAL', 'Pollution de terrain detectee', 'ELEVE', 0.8, 0.7,
      'Diagnostic pollution approfondi et estimation cout depollution.');
  }

  const probMap: Record<RisqueNiveau, number> = { FAIBLE: 0.2, MODERE: 0.4, ELEVE: 0.7, CRITIQUE: 0.9 };
  const impMap: Record<RisqueNiveau, number> = { FAIBLE: 0.2, MODERE: 0.5, ELEVE: 0.7, CRITIQUE: 0.9 };

  for (const r of input.risques.risquesIdentifies ?? []) {
    const niv: RisqueNiveau = r.niveau ?? 'MODERE';
    add(
      r.categorie ?? 'TECHNIQUE',
      r.libelle,
      niv,
      probMap[niv],
      impMap[niv],
      r.mitigation ?? 'Surveillance et plan de mitigation a definir.',
    );
  }

  return risques.sort((a, b) => b.scoreCombine - a.scoreCombine);
}

// ---- Financement ------------------------------------------------------------

function mapFinancement(input: PromoteurRawInput, financier: FinancierAnalysis): FinancementAnalysis {
  const { bilan } = input;
  const fondsPropres = bilan.fondsPropres ?? financier.coutRevientTotal * 0.2;
  const credit = bilan.creditPromoteur ?? financier.coutRevientTotal - fondsPropres;
  const fondsPropresPercent = roundTo(safeDiv(fondsPropres, financier.coutRevientTotal) * 100, 1);

  const notes: string[] = [];
  if (fondsPropresPercent < 20) {
    notes.push('Ratio fonds propres < 20% -- renforcement des capitaux propres recommande.');
  }
  if (financier.margeNettePercent < 10) {
    notes.push('Marge reduite susceptible de compliquer le financement bancaire.');
  }

  return {
    fondsPropresRequis: fondsPropres,
    fondsPropresPercent,
    creditPromoteurMontant: credit,
    creditPromoteurDuree: 24,
    tauxCredit: 4.5,
    garantiesRequises: [
      "Garantie d'achevement (GFA)",
      'Hypotheque de premier rang',
      'Nantissement des parts',
    ],
    ratioFondsPropres: fondsPropresPercent,
    prefinancementVentes: 30,
    notesBancaires: notes,
  };
}

// ---- Scenarios --------------------------------------------------------------

function buildScenarios(financier: FinancierAnalysis, input: PromoteurRawInput): Scenario[] {
  const sp = input.conception.surfacePlancher ?? 1;
  const baseTravauxM2 = financier.coutTravauxM2;
  const basePrixM2 = financier.chiffreAffairesM2;

  const computeMarge = (
    prixM2: number,
    travM2: number,
  ): { marge: number; resultat: number; trn: number } => {
    const ca = prixM2 * sp;
    const travaux = travM2 * sp;
    const autresCouts = financier.coutRevientTotal - financier.coutTravaux;
    const coutRevient = travaux + autresCouts;
    const resultat = ca - coutRevient;
    return {
      marge: roundTo(safeDiv(resultat, ca) * 100, 1),
      resultat,
      trn: roundTo(safeDiv(resultat, coutRevient) * 100, 1),
    };
  };

  const reco = (m: number): RecommendationType =>
    m < 8 ? 'NO_GO' : m < 10 ? 'GO_CONDITION' : 'GO';

  return [
    {
      id: 'S_BASE',
      libelle: 'Scenario de base',
      type: 'BASE',
      hypotheses: { prixVenteM2: basePrixM2, coutTravauxM2: baseTravauxM2, tauxAbsorption: 12, tauxCredit: 4.5 },
      resultat: {
        margeNettePercent: financier.margeNettePercent,
        resultatNet: financier.margeNette,
        trnRendement: financier.trnRendement,
        recommendation: reco(financier.margeNettePercent),
      },
    },
    {
      id: 'S_OPTIM',
      libelle: 'Scenario optimiste',
      type: 'OPTIMISTE',
      hypotheses: { prixVenteM2: basePrixM2 * 1.05, coutTravauxM2: baseTravauxM2 * 0.97, tauxAbsorption: 9, tauxCredit: 4.2 },
      resultat: (() => {
        const r = computeMarge(basePrixM2 * 1.05, baseTravauxM2 * 0.97);
        return { margeNettePercent: r.marge, resultatNet: r.resultat, trnRendement: r.trn, recommendation: reco(r.marge) };
      })(),
    },
    {
      id: 'S_PESS',
      libelle: 'Scenario pessimiste',
      type: 'PESSIMISTE',
      hypotheses: { prixVenteM2: basePrixM2 * 0.95, coutTravauxM2: baseTravauxM2 * 1.05, tauxAbsorption: 18, tauxCredit: 5.0 },
      resultat: (() => {
        const r = computeMarge(basePrixM2 * 0.95, baseTravauxM2 * 1.05);
        return { margeNettePercent: r.marge, resultatNet: r.resultat, trnRendement: r.trn, recommendation: reco(r.marge) };
      })(),
    },
    {
      id: 'S_STRESS',
      libelle: 'Scenario stress test',
      type: 'STRESS',
      hypotheses: { prixVenteM2: basePrixM2 * 0.88, coutTravauxM2: baseTravauxM2 * 1.1, tauxAbsorption: 24, tauxCredit: 5.5 },
      resultat: (() => {
        const r = computeMarge(basePrixM2 * 0.88, baseTravauxM2 * 1.1);
        return { margeNettePercent: r.marge, resultatNet: r.resultat, trnRendement: r.trn, recommendation: reco(r.marge) };
      })(),
    },
  ];
}

// ---- Scores -----------------------------------------------------------------

function buildScores(
  technique: TechniqueAnalysis,
  marche: MarcheAnalysis,
  financier: FinancierAnalysis,
  risques: RisqueItem[],
): Scores {
  const foncierScore = 70;

  const techScore =
    technique.faisabiliteTechnique === 'CONFIRME' ? 90 :
    technique.faisabiliteTechnique === 'SOUS_RESERVE' ? 60 : 20;

  const posAbs = Math.abs(marche.positionPrix);
  const marcheScore = clamp(80 - posAbs * 2 - (marche.offreConcurrente > 5 ? 10 : 0), 20, 100);

  const finScore = clamp(
    financier.margeNettePercent < 8 ? 20 :
    financier.margeNettePercent < 10 ? 50 :
    financier.margeNettePercent < 15 ? 75 : 90,
    0, 100,
  );

  const nbCritique = risques.filter((r) => r.niveau === 'CRITIQUE').length;
  const nbEleve = risques.filter((r) => r.niveau === 'ELEVE').length;
  const risqueScore = clamp(nbCritique * 30 + nbEleve * 15, 0, 100);

  const global = roundTo(
    foncierScore * 0.1 +
    techScore * 0.2 +
    marcheScore * 0.25 +
    finScore * 0.35 +
    (100 - risqueScore) * 0.1,
    0,
  );

  return { foncier: foncierScore, technique: techScore, marche: marcheScore, financier: finScore, risque: risqueScore, global };
}

// ---- Executive Summary ------------------------------------------------------

function buildExecutiveSummary(
  input: PromoteurRawInput,
  financier: FinancierAnalysis,
  risques: RisqueItem[],
  scores: Scores,
  projet: ProjetInfo,
): ExecutiveSummary {
  const killSwitches: string[] = [];

  if (financier.margeNettePercent < 8) {
    killSwitches.push(`Marge nette ${financier.margeNettePercent}% < seuil 8%`);
  }

  const prixNeuf = input.marche.prixNeufM2 ?? 0;
  const prixProjet = input.evaluation.prixVenteM2 ?? 0;
  if (prixNeuf > 0 && prixProjet > prixNeuf * 1.1) {
    const delta = roundTo(safeDiv(prixProjet - prixNeuf, prixNeuf) * 100, 0);
    killSwitches.push(`Prix projet +${delta}% vs marche (> +10%)`);
  }

  if ((input.plu.reglesPlu ?? []).some((r) => r.statut === 'BLOQUANT')) {
    killSwitches.push('Contrainte PLU bloquante non levee');
  }

  const recommendation: RecommendationType =
    killSwitches.length > 0 ? 'NO_GO' :
    financier.margeNettePercent < 10 || scores.global < 60 ? 'GO_CONDITION' : 'GO';

  const motifMap: Record<RecommendationType, string> = {
    GO: 'Operation viable avec une marge satisfaisante et un positionnement marche coherent.',
    GO_CONDITION: 'Operation presentant un potentiel mais necessitant des ajustements avant engagement.',
    NO_GO: "Des indicateurs critiques bloquent la viabilite de l'operation en l'etat.",
  };

  const pointsForts: string[] = [];
  if (financier.margeNettePercent >= 12) pointsForts.push(`Marge nette solide : ${financier.margeNettePercent}%`);
  if (scores.marche >= 75) pointsForts.push('Bon positionnement marche');
  if (scores.technique >= 80) pointsForts.push('Faisabilite technique confirmee');
  if (financier.bilancielRatio < 25) pointsForts.push('Part fonciere maitrisee dans le bilan');

  const pointsVigilance: string[] = [];
  if (financier.margeNettePercent < 12) {
    pointsVigilance.push(`Marge sous le seuil cible (${financier.margeNettePercent}% < 12%)`);
  }
  risques
    .filter((r) => r.niveau === 'CRITIQUE' || r.niveau === 'ELEVE')
    .slice(0, 3)
    .forEach((r) => pointsVigilance.push(r.libelle));

  return {
    titreOperation: `${projet.programmeType} -- ${projet.nbLogements} logements -- ${projet.commune} (${projet.codePostal})`,
    recommendation,
    motifRecommandation: motifMap[recommendation],
    pointsForts: pointsForts.length > 0 ? pointsForts : ['A completer avec les donnees du dossier'],
    pointsVigilance: pointsVigilance.length > 0 ? pointsVigilance : ['Aucun point de vigilance majeur identifie'],
    killSwitchesActifs: killSwitches,
    scores,
    margeNette: financier.margeNettePercent,
    trnRendement: financier.trnRendement,
    caTotal: financier.chiffreAffairesTotal,
    resultatNet: financier.margeNette,
  };
}

// ---- Main export ------------------------------------------------------------

export function mapToPromoteurSynthese(input: PromoteurRawInput): PromoteurSynthese {
  const now = new Date().toISOString();

  const projet = mapProjetInfo(input);
  const technique = mapTechniqueAnalysis(input);
  const marche = mapMarcheAnalysis(input);
  const financier = mapFinancierAnalysis(input);
  const risques = mapRisques(input, financier);
  const financement = mapFinancement(input, financier);
  const scenarios = buildScenarios(financier, input);
  const scores = buildScores(technique, marche, financier, risques);
  const executiveSummary = buildExecutiveSummary(input, financier, risques, scores, projet);

  const avertissements: string[] = [];
  if (!input.foncier.surfaceTerrain) avertissements.push('Surface terrain manquante.');
  if (!input.conception.surfacePlancher) avertissements.push('Surface plancher manquante.');
  if (!input.marche.prixNeufM2) avertissements.push('Prix marche neuf absent.');
  if (!input.bilan.chiffreAffaires) avertissements.push("Chiffre d'affaires non renseigne -- calcule par estimation.");

  const dataQualite: PromoteurSynthese['metadata']['dataQualite'] =
    avertissements.length === 0 ? 'HAUTE' :
    avertissements.length <= 2 ? 'MOYENNE' : 'FAIBLE';

  return {
    id: generateId(),
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
    projet,
    executiveSummary,
    technique,
    marche,
    financier,
    risques,
    financement,
    scenarios,
    syntheseIA: null,
    metadata: {
      sourceFoncier: 'Saisie manuelle / cadastre',
      sourcePlu: 'PLU communal analyse',
      sourceMarche: 'DVF + donnees marche',
      dataQualite,
      avertissements,
    },
  };
}