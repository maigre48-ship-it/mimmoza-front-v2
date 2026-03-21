// src/spaces/promoteur/services/generatePromoteurSynthese.ts

import { mapToPromoteurSynthese } from './promoteurSynthese.mapper';
import type {
  PromoteurRawInput,
  PromoteurSynthese,
  SyntheseIA,
  RecommendationType,
} from './promoteurSynthese.types';

// ---- Kill switches ----------------------------------------------------------

interface KillSwitchResult {
  triggered: boolean;
  reasons: string[];
}

function evaluateKillSwitches(synthese: PromoteurSynthese): KillSwitchResult {
  const reasons: string[] = [];

  if (synthese.financier.margeNettePercent < 8) {
    reasons.push(
      `Marge nette insuffisante : ${synthese.financier.margeNettePercent.toFixed(1)}% (seuil minimum : 8%)`
    );
  }

  if (synthese.marche.positionPrix > 10) {
    reasons.push(
      `Prix de vente positionne a +${synthese.marche.positionPrix.toFixed(1)}% au-dessus du marche (seuil : +10%)`
    );
  }

  if (synthese.technique.contraintes.some((c) => c.statut === 'BLOQUANT')) {
    reasons.push('Contrainte PLU bloquante identifiee -- faisabilite technique compromise');
  }

  if (synthese.technique.faisabiliteTechnique === 'IMPOSSIBLE') {
    reasons.push('Faisabilite technique declaree impossible selon analyse PLU');
  }

  return { triggered: reasons.length > 0, reasons };
}

// ---- Recommendation ---------------------------------------------------------

function computeFinalRecommendation(
  synthese: PromoteurSynthese,
  killSwitch: KillSwitchResult,
): RecommendationType {
  if (killSwitch.triggered) return 'NO_GO';

  const { margeNettePercent } = synthese.financier;
  const { global: scoreGlobal } = synthese.executiveSummary.scores;
  const nbEleveRisques = synthese.risques.filter(
    (r) => r.niveau === 'ELEVE' || r.niveau === 'CRITIQUE'
  ).length;

  const isStrongGo =
    margeNettePercent >= 12 &&
    scoreGlobal >= 72 &&
    nbEleveRisques === 0 &&
    synthese.technique.faisabiliteTechnique === 'CONFIRME';

  if (isStrongGo) return 'GO';
  if (margeNettePercent < 8 || scoreGlobal < 35) return 'NO_GO';
  return 'GO_CONDITION';
}

// ---- IA text generation -----------------------------------------------------

function generateTexteExecutif(synthese: PromoteurSynthese): string {
  const { projet, financier, marche, executiveSummary } = synthese;
  const recLabel: Record<RecommendationType, string> = {
    GO: 'favorable',
    GO_CONDITION: 'conditionnel',
    NO_GO: 'defavorable',
  };
  return (
    `L'operation immobiliere situee ${projet.adresse}, ${projet.commune} (${projet.codePostal}) porte sur ` +
    `un programme de ${projet.nbLogements} logements pour une surface plancher de ${projet.surfacePlancher.toLocaleString('fr-FR')} m2. ` +
    `L'analyse globale conduit a un avis ${recLabel[executiveSummary.recommendation]}. ` +
    `Le chiffre d'affaires previsionnel s'etablit a ${(financier.chiffreAffairesTotal / 1000000).toFixed(2)} M EUR HT ` +
    `pour un cout de revient de ${(financier.coutRevientTotal / 1000000).toFixed(2)} M EUR, ` +
    `degageant une marge nette de ${financier.margeNettePercent.toFixed(1)}% ` +
    `(TRN : ${financier.trnRendement.toFixed(1)}%). ` +
    `Le positionnement prix du projet est de ${marche.positionPrix > 0 ? '+' : ''}${marche.positionPrix.toFixed(1)}% ` +
    `par rapport au marche local (${marche.zoneMarche.toLowerCase().replace('_', ' ')}).`
  );
}

function generateAnalyseMarche(synthese: PromoteurSynthese): string {
  const { marche } = synthese;
  return (
    `Le marche local se caracterise par une zone ${marche.zoneMarche.toLowerCase().replace('_', ' ')} ` +
    `avec un prix moyen du neuf estime a ${marche.prixNeufMoyenM2.toLocaleString('fr-FR')} EUR/m2. ` +
    `Le programme est tarifie a ${marche.prixProjetM2.toLocaleString('fr-FR')} EUR/m2, ` +
    `soit ${marche.positionPrix > 0 ? '+' : ''}${marche.positionPrix.toFixed(1)}% par rapport a la moyenne de marche. ` +
    (marche.absorptionMensuelle
      ? `Le rythme d'absorption estime est de ${marche.absorptionMensuelle} vente(s)/mois, ` +
        `conduisant a un delai d'ecoulement de ${marche.delaiEcoulementMois} mois. `
      : '') +
    `La concurrence directe recense ${marche.offreConcurrente} programme(s) actif(s) dans la zone de chalandise. ` +
    (marche.notesMarcheLibre.length > 0
      ? `Points de vigilance marche : ${marche.notesMarcheLibre.join(' -- ')}`
      : `Aucun signal d'alarme majeur sur le marche local.`)
  );
}

function generateAnalyseTechnique(synthese: PromoteurSynthese): string {
  const { technique } = synthese;
  const faisLabel: Record<typeof technique.faisabiliteTechnique, string> = {
    CONFIRME: 'confirmee',
    SOUS_RESERVE: 'confirmee sous reserve',
    IMPOSSIBLE: "impossible en l'etat",
  };
  return (
    `La faisabilite technique est ${faisLabel[technique.faisabiliteTechnique]} ` +
    `en zone PLU ${technique.zonePlu}` +
    (technique.cub ? ` (CUB : ${technique.cub})` : '') +
    (technique.hauteurMax ? `, hauteur maximale autorisee : ${technique.hauteurMax} m` : '') +
    `. Le projet prevoit ${technique.nbNiveaux ?? 'N/A'} niveaux ` +
    `pour une hauteur de ${technique.hauteurProjet ?? 'N/A'} m. ` +
    (technique.contraintes.length > 0
      ? `${technique.contraintes.length} regle(s) PLU ont ete analysees, dont ` +
        `${technique.contraintes.filter((c) => c.statut === 'BLOQUANT').length} bloquante(s) et ` +
        `${technique.contraintes.filter((c) => c.statut === 'LIMITE').length} en limite de conformite.`
      : 'Aucune contrainte PLU majeure identifiee.')
  );
}

function generateAnalyseFinanciere(synthese: PromoteurSynthese): string {
  const { financier, scenarios } = synthese;
  const stressScenario = scenarios.find((s) => s.type === 'STRESS');
  return (
    `L'analyse financiere porte sur un chiffre d'affaires de ${(financier.chiffreAffairesTotal / 1000000).toFixed(2)} M EUR. ` +
    `Le cout de revient se decompose en foncier (${(financier.coutFoncier / 1000000).toFixed(2)} M EUR), ` +
    `travaux (${(financier.coutTravaux / 1000000).toFixed(2)} M EUR -- ${financier.coutTravauxM2.toLocaleString('fr-FR')} EUR/m2), ` +
    `frais financiers (${(financier.coutFinanciers / 1000).toFixed(0)} k EUR) et frais annexes. ` +
    `La marge nette ressort a ${financier.margeNettePercent.toFixed(1)}% ` +
    `(${(financier.margeNette / 1000000).toFixed(2)} M EUR) pour un TRN de ${financier.trnRendement.toFixed(1)}%. ` +
    (stressScenario
      ? `En scenario de stress (prix -12%, travaux +10%), la marge tomberait a ${stressScenario.resultat.margeNettePercent.toFixed(1)}%.`
      : '')
  );
}

function generateAnalyseRisques(synthese: PromoteurSynthese): string {
  const { risques } = synthese;
  if (risques.length === 0) return "Aucun risque significatif identifie a ce stade de l'analyse.";
  const critiques = risques.filter((r) => r.niveau === 'CRITIQUE');
  const eleves = risques.filter((r) => r.niveau === 'ELEVE');
  return (
    `L'analyse recense ${risques.length} risque(s), dont ${critiques.length} critique(s) et ${eleves.length} eleve(s). ` +
    (critiques.length > 0
      ? `Risques critiques : ${critiques.map((r) => r.libelle).join(', ')}. `
      : '') +
    `Les mesures de mitigation prioritaires portent sur : ${risques
      .slice(0, 3)
      .map((r) => r.mitigation)
      .join(' | ')}.`
  );
}

function generateConclusion(synthese: PromoteurSynthese): string {
  const rec = synthese.executiveSummary.recommendation;
  const { killSwitchesActifs, pointsForts, pointsVigilance } = synthese.executiveSummary;

  if (rec === 'NO_GO') {
    return (
      `En conclusion, l'operation n'est pas recommandee en l'etat. ` +
      `Les elements bloquants suivants doivent imperativement etre leves : ${killSwitchesActifs.join('; ')}. ` +
      `Une revision en profondeur du programme ou de la strategie d'acquisition est necessaire avant tout engagement.`
    );
  }
  if (rec === 'GO_CONDITION') {
    return (
      `L'operation presente un potentiel reel, sous reserve de lever les points de vigilance identifies : ` +
      `${pointsVigilance.slice(0, 3).join('; ')}. ` +
      `Les atouts du projet (${pointsForts.slice(0, 2).join(', ')}) constituent des bases solides. ` +
      `Un engagement conditionnel est envisageable sous reserve des ajustements requis.`
    );
  }
  return (
    `L'operation est recommandee. Les indicateurs cles sont positifs : ${pointsForts.join(', ')}. ` +
    `Le dossier peut etre presente en comite d'investissement sous reserve de validation des points ` +
    `de vigilance residuels (${pointsVigilance.slice(0, 2).join(', ')}).`
  );
}

function buildSyntheseIA(synthese: PromoteurSynthese): SyntheseIA {
  return {
    texteExecutif:    generateTexteExecutif(synthese),
    analyseMarche:    generateAnalyseMarche(synthese),
    analyseTechnique: generateAnalyseTechnique(synthese),
    analyseFinanciere: generateAnalyseFinanciere(synthese),
    analyseRisques:   generateAnalyseRisques(synthese),
    conclusion:       generateConclusion(synthese),
    generatedAt:      new Date().toISOString(),
  };
}

// ---- Enrichment -------------------------------------------------------------

function enrichSynthese(synthese: PromoteurSynthese, killSwitch: KillSwitchResult): PromoteurSynthese {
  const finalRecommendation = computeFinalRecommendation(synthese, killSwitch);
  const updatedKillSwitches = killSwitch.triggered ? killSwitch.reasons : [];

  const motif =
    finalRecommendation === 'GO'
      ? 'Operation viable avec indicateurs financiers et marche satisfaisants.'
      : finalRecommendation === 'GO_CONDITION'
      ? 'Operation presentant un potentiel mais necessitant des ajustements cibles.'
      : `Operation bloquee : ${updatedKillSwitches[0] ?? 'indicateurs critiques detectes'}.`;

  return {
    ...synthese,
    updatedAt: new Date().toISOString(),
    executiveSummary: {
      ...synthese.executiveSummary,
      recommendation: finalRecommendation,
      killSwitchesActifs: updatedKillSwitches,
      motifRecommandation: motif,
    },
  };
}

// ---- Main export ------------------------------------------------------------

export function generatePromoteurSynthese(data: PromoteurRawInput): PromoteurSynthese {
  const rawSynthese = mapToPromoteurSynthese(data);
  const killSwitch = evaluateKillSwitches(rawSynthese);
  const enriched = enrichSynthese(rawSynthese, killSwitch);
  const syntheseIA = buildSyntheseIA(enriched);
  return { ...enriched, syntheseIA };
}