// src/spaces/promoteur/services/promoteurPdf.narrative.ts
// ============================================================================
// SEMANTIC LOCKDOWN ENGINE
// ============================================================================
// Every piece of narrative text in the PDF must pass through this module.
// It enforces strict tone/content rules based on audit.documentStatus:
//
//   INCOMPLETE  → only factual statements, no positive conclusions
//   PROVISIONAL → cautious analysis, always conditioned
//   COMMITTEE_READY → assertive, conclusion-driven
//
// RULE: if the data doesn't support a claim, the claim must not appear.
// ============================================================================

import type { PromoteurSynthese, RecommendationType } from './promoteurSynthese.types';
import type { DocumentAudit } from './promoteurPdf.audit';
import type { DocumentStatus } from './promoteurPdf.formatters';

// ============================================================================
// METRIC RELIABILITY
// ============================================================================

export interface MetricContext {
  hasCA: boolean;
  hasCDR: boolean;
  hasSDP: boolean;
  hasLots: boolean;
  hasFoncier: boolean;
  hasTravaux: boolean;
  hasPrixNeuf: boolean;
  hasDVF: boolean;
  hasZonePlu: boolean;
  hasAbsorption: boolean;
}

export function buildMetricContext(syn: PromoteurSynthese): MetricContext {
  return {
    hasCA:        (syn.financier.chiffreAffairesTotal ?? 0) > 0,
    hasCDR:       (syn.financier.coutRevientTotal ?? 0) > 0,
    hasSDP:       (syn.projet.surfacePlancher ?? 0) > 0,
    hasLots:      (syn.projet.nbLogements ?? 0) > 0,
    hasFoncier:   (syn.financier.coutFoncier ?? 0) > 0,
    hasTravaux:   (syn.financier.coutTravaux ?? 0) > 0,
    hasPrixNeuf:  (syn.marche.prixNeufMoyenM2 ?? 0) > 0,
    hasDVF:       (syn.marche.transactionsRecentes.nbTransactions ?? 0) > 0,
    hasZonePlu:   !!syn.technique.zonePlu?.trim(),
    hasAbsorption: syn.marche.absorptionMensuelle != null,
  };
}

export function isMarginReliable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR && mc.hasTravaux;
}

export function isTrnReliable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR && mc.hasFoncier;
}

export function isFinancialExploitable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR;
}

export function isMarketPositionReliable(mc: MetricContext): boolean {
  return mc.hasPrixNeuf && mc.hasDVF;
}

export function areScenariosExploitable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR && mc.hasTravaux && mc.hasFoncier;
}

// ============================================================================
// BUSINESS RECOMMENDATION WORDING
// ============================================================================

function getMargeLecture(marge: number): string {
  if (marge >= 15) {
    return `Marge nette ${marge.toFixed(1)}% : niveau confortable, opération recommandée.`;
  }

  if (marge >= 10) {
    return `Marge nette ${marge.toFixed(1)}% : niveau correct, opération viable sous suivi.`;
  }

  if (marge >= 8) {
    return `Marge nette ${marge.toFixed(1)}% : niveau limite, opération envisageable sous conditions.`;
  }

  return `Marge nette ${marge.toFixed(1)}% : marge insuffisante, opération non recommandée en l'état.`;
}

// ============================================================================
// BANNED PHRASES
// ============================================================================

const BANNED_INCOMPLETE: RegExp[] = [
  /op[eé]ration\s+(viable|recommand[eé]e|solide|robuste)/i,
  /dossier\s+(pr[eé]sentable|solide|complet)/i,
  /march[eé]\s+(favorable|porteur|dynamique|tendu\s+favorable)/i,
  /positionnement\s+(pertinent|coh[eé]rent|optimal)/i,
  /marge\s+(solide|confortable|excellente|bonne)/i,
  /(bonne|excellente|forte)\s+rentabilit[eé]/i,
  /faisabilit[eé]\s+confirm[eé]e/i,
  /aucun\s+risque\s+majeur/i,
  /recommandation\s*:\s*go(?!\s*conditionnel)/i,
  /rentabilit[eé]\s+(attractive|int[eé]ressante)/i,
  /sans\s+difficult[eé]\s+majeure/i,
];

function stripBannedPhrases(text: string, status: DocumentStatus): string {
  if (status !== 'incomplete') return text;

  let result = text;
  for (const re of BANNED_INCOMPLETE) {
    result = result.replace(re, '[donnée insuffisante]');
  }
  return result;
}

// ============================================================================
// POINTS FORTS FILTERING
// ============================================================================

export function filterPointsForts(
  pointsForts: string[],
  status: DocumentStatus,
  mc: MetricContext,
): string[] {
  if (status === 'committee_ready') return pointsForts;
  if (status === 'incomplete') return [];

  return pointsForts.filter(pf => {
    const lower = pf.toLowerCase();

    if ((lower.includes('marge') || lower.includes('rentabilit')) && !isMarginReliable(mc)) return false;
    if (lower.includes('trn') && !isTrnReliable(mc)) return false;
    if ((lower.includes('march') || lower.includes('prix') || lower.includes('positionn')) && !isMarketPositionReliable(mc)) return false;
    if (lower.includes('faisabilit') && !mc.hasZonePlu) return false;

    return true;
  });
}

// ============================================================================
// SAFE EXECUTIVE SUMMARY TEXT
// ============================================================================

export function generateExecMotif(
  audit: DocumentAudit,
  syn: PromoteurSynthese,
  mc: MetricContext,
): string {
  const status = audit.documentStatus;

  if (status === 'incomplete') {
    const missing = audit.criticalMissingFields.slice(0, 5).join(', ');
    return `Le dossier est incomplet et ne permet pas de formuler une recommandation d'investissement fiable. `
      + `Données manquantes critiques : ${missing || 'multiples champs requis'}. `
      + `Les conclusions présentées dans ce document sont non exploitables en l'état. `
      + `Une validation complémentaire est impérative avant toute décision.`;
  }

  if (status === 'provisional') {
    const original = stripBannedPhrases(syn.executiveSummary.motifRecommandation, status);
    return `${original} `
      + `Note : cette analyse repose sur des données partielles (complétude ${audit.completenessScore}%). `
      + `Les conclusions sont à confirmer après collecte des données manquantes.`;
  }

  if (isMarginReliable(mc)) {
    return getMargeLecture(syn.financier.margeNettePercent);
  }

  return syn.executiveSummary.motifRecommandation;
}

// ============================================================================
// SAFE SECTION CONCLUSIONS
// ============================================================================

export function generateFinancierConclusion(
  status: DocumentStatus,
  mc: MetricContext,
  syn: PromoteurSynthese,
): string | null {
  if (status === 'incomplete') {
    if (!isFinancialExploitable(mc)) {
      return 'Analyse financière non exploitable à ce stade. '
        + 'Les ratios de marge, TRN et coût de revient ne peuvent pas être calculés '
        + 'faute de données suffisantes sur les coûts et le chiffre d\'affaires.';
    }

    return 'Les indicateurs financiers sont présentés à titre indicatif uniquement. '
      + 'Leur fiabilité est insuffisante pour fonder une décision d\'investissement.';
  }

  if (status === 'provisional') {
    if (!isMarginReliable(mc)) {
      return 'Les ratios de marge sont à interpréter avec prudence : '
        + 'certains postes de coûts ne sont pas renseignés.';
    }
    return null;
  }

  return null;
}

export function generateMarcheConclusion(
  status: DocumentStatus,
  mc: MetricContext,
): string | null {
  if (status === 'incomplete') {
    if (!mc.hasDVF && !mc.hasPrixNeuf) {
      return 'L\'analyse de marché ne peut pas être conduite faute de données DVF et de références de prix neuf. '
        + 'Aucune conclusion sur le positionnement tarifaire n\'est possible.';
    }

    return 'Les données de marché sont insuffisantes. Les indicateurs présentés '
      + 'ne permettent pas de valider le positionnement tarifaire du projet.';
  }

  if (status === 'provisional') {
    if (!mc.hasDVF) {
      return 'En l\'absence de données DVF suffisantes, le positionnement prix est à confirmer '
        + 'par une étude de marché complémentaire.';
    }

    if (!mc.hasAbsorption) {
      return 'Le rythme d\'absorption n\'est pas renseigné. Le délai d\'écoulement '
        + 'reste à valider par une analyse commerciale locale.';
    }

    return null;
  }

  return null;
}

export function generateTechniqueConclusion(
  status: DocumentStatus,
  mc: MetricContext,
  syn: PromoteurSynthese,
): string | null {
  if (status === 'incomplete' && !mc.hasZonePlu) {
    return 'La faisabilité technique ne peut pas être confirmée en l\'absence de zone PLU identifiée. '
      + 'Le statut réglementaire du terrain doit être vérifié avant toute étude approfondie.';
  }

  if (status === 'provisional' && !mc.hasZonePlu) {
    return 'La zone PLU n\'est pas renseignée. La faisabilité technique reste sous réserve '
      + 'de la confirmation du zonage réglementaire.';
  }

  return null;
}

// ============================================================================
// EFFECTIVE FEASIBILITY LABEL
// ============================================================================

export function getEffectiveFaisabilite(
  original: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE',
  status: DocumentStatus,
  mc: MetricContext,
): 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' {
  if (!mc.hasZonePlu && original === 'CONFIRME') {
    return 'SOUS_RESERVE';
  }

  if (status === 'incomplete' && original === 'CONFIRME') {
    return 'SOUS_RESERVE';
  }

  return original;
}

// ============================================================================
// SCENARIOS GATE
// ============================================================================

export function scenariosGate(
  status: DocumentStatus,
  mc: MetricContext,
  scenarios: unknown[],
): string | null {
  if ((scenarios?.length ?? 0) === 0) return null;

  if (status === 'incomplete' && !areScenariosExploitable(mc)) {
    return 'Les scénarios de sensibilité ne sont pas exploitables en l\'état. '
      + 'Les hypothèses économiques structurantes (coûts travaux, foncier, CA) ne sont pas suffisamment '
      + 'renseignées pour produire des résultats fiables. '
      + 'Cette section sera disponible après complétion du bilan financier.';
  }

  return null;
}

// ============================================================================
// SYNTHESE IA GATE
// ============================================================================

export function filterSyntheseIA(
  text: string | undefined | null,
  sectionName: string,
  status: DocumentStatus,
  mc: MetricContext,
): string | null {
  if (!text?.trim()) return null;

  if (status === 'incomplete') {
    return null;
  }

  if (status === 'provisional') {
    return stripBannedPhrases(text, status);
  }

  return stripBannedPhrases(text, status);
}

export function shouldShowSyntheseIA(
  status: DocumentStatus,
  syn: PromoteurSynthese,
): boolean {
  if (!syn.syntheseIA) return false;
  if (status === 'incomplete') return false;
  return true;
}

// ============================================================================
// SAFE RECOMMENDATION FINALE TEXT
// ============================================================================

export function generateFinalRecommendationText(
  audit: DocumentAudit,
  syn: PromoteurSynthese,
  mc: MetricContext,
): string {
  const status = audit.documentStatus;

  if (status === 'incomplete') {
    const blocking = audit.blockingIssues.slice(0, 3).join(' ; ');
    return `Le dossier ne peut pas être présenté en comité d'investissement en l'état. `
      + `Problèmes identifiés : ${blocking || 'données critiques manquantes'}. `
      + `La décision d'investissement n'est pas sécurisée. `
      + `Il est impératif de compléter les données avant toute présentation.`;
  }

  if (status === 'provisional') {
    const original = stripBannedPhrases(syn.executiveSummary.motifRecommandation, status);
    return `${original} `
      + `Le dossier est en cours de constitution (complétude ${audit.completenessScore}%). `
      + `Les conclusions sont à confirmer avant présentation définitive en comité.`;
  }

  if (isMarginReliable(mc)) {
    return getMargeLecture(syn.financier.margeNettePercent);
  }

  return syn.executiveSummary.motifRecommandation;
}

export function generateFinalIAConclusion(
  audit: DocumentAudit,
  syn: PromoteurSynthese,
): string | null {
  if (!syn.syntheseIA?.conclusion?.trim()) return null;

  if (audit.documentStatus === 'incomplete') {
    return null;
  }

  if (audit.documentStatus === 'provisional') {
    return stripBannedPhrases(syn.syntheseIA.conclusion, 'provisional')
      + ' (Analyse provisoire — à confirmer.)';
  }

  return syn.syntheseIA.conclusion;
}

// ============================================================================
// INCOMPLETE MODE: "POINTS FORTS" FALLBACK
// ============================================================================

export const INCOMPLETE_NO_POINTS_FORTS =
  'Aucun point fort exploitable compte tenu du niveau de données disponibles.';

// ============================================================================
// STATUS-AWARE COVER TEXT
// ============================================================================

export function getCoverDocTypeLabel(status: DocumentStatus): string {
  if (status === 'incomplete') return 'DOSSIER INCOMPLET — USAGE INTERNE UNIQUEMENT';
  if (status === 'provisional') return 'PRÉ-ÉTUDE — VALIDATION COMPLÉMENTAIRE REQUISE';
  return "DOSSIER COMITÉ D'INVESTISSEMENT";
}

export function getCoverStatusLabel(status: DocumentStatus): string {
  if (status === 'incomplete') return 'DOSSIER INCOMPLET';
  if (status === 'provisional') return 'ANALYSE PROVISOIRE';
  return 'PRÊT COMITÉ';
}

export function getCoverRecommendationLabel(
  status: DocumentStatus,
  effectiveRec: RecommendationType,
): string {
  if (status === 'incomplete') return 'AVIS NON DÉCIDABLE EN L\'ÉTAT';

  if (status === 'provisional') {
    if (effectiveRec === 'GO_CONDITION') return 'GO CONDITIONNEL — SOUS RÉSERVE';
    if (effectiveRec === 'NO_GO') return 'NO GO';
    return 'AVIS CONDITIONNEL';
  }

  if (effectiveRec === 'GO') return 'GO — OPÉRATION RECOMMANDÉE';
  if (effectiveRec === 'GO_CONDITION') return 'GO CONDITIONNEL';
  return 'NO GO';
}