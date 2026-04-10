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

/** Extract a snapshot of which key metrics are actually populated */
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

/** Is a financial margin metric reliable? */
export function isMarginReliable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR && mc.hasTravaux;
}

/** Is TRN reliable? */
export function isTrnReliable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR && mc.hasFoncier;
}

/** Is the financial analysis overall exploitable? */
export function isFinancialExploitable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR;
}

/** Is market positioning reliable? */
export function isMarketPositionReliable(mc: MetricContext): boolean {
  return mc.hasPrixNeuf && mc.hasDVF;
}

/** Is the scenario analysis meaningful? */
export function areScenariosExploitable(mc: MetricContext): boolean {
  return mc.hasCA && mc.hasCDR && mc.hasTravaux && mc.hasFoncier;
}

// ============================================================================
// BANNED PHRASES (mode incomplete)
// ============================================================================
// These phrases or close equivalents must NEVER appear when status = incomplete.

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

/** Sanitize IA-generated or stored text: strip banned phrases in incomplete mode */
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

/** Filter points forts to only keep those backed by real data */
export function filterPointsForts(
  pointsForts: string[],
  status: DocumentStatus,
  mc: MetricContext,
): string[] {
  if (status === 'committee_ready') return pointsForts;

  // In incomplete mode, no points forts at all unless very solid
  if (status === 'incomplete') return [];

  // In provisional mode, filter out any that reference unreliable metrics
  return pointsForts.filter(pf => {
    const lower = pf.toLowerCase();
    // Reject margin/TRN-based claims if financial data is unreliable
    if ((lower.includes('marge') || lower.includes('rentabilit')) && !isMarginReliable(mc)) return false;
    if (lower.includes('trn') && !isTrnReliable(mc)) return false;
    // Reject market claims if market data is missing
    if ((lower.includes('march') || lower.includes('prix') || lower.includes('positionn')) && !isMarketPositionReliable(mc)) return false;
    // Reject feasibility claims if PLU is missing
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

  // committee_ready — use original text
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
    return null; // no extra conclusion needed
  }

  return null; // committee_ready — data speaks for itself
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

/**
 * Override the displayed feasibility status when data is missing.
 * NEVER display "CONFIRMÉE" if the PLU zone is unknown.
 */
export function getEffectiveFaisabilite(
  original: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE',
  status: DocumentStatus,
  mc: MetricContext,
): 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' {
  // If PLU zone is missing, cap at SOUS_RESERVE regardless of input
  if (!mc.hasZonePlu && original === 'CONFIRME') {
    return 'SOUS_RESERVE';
  }

  // If incomplete, never show CONFIRME
  if (status === 'incomplete' && original === 'CONFIRME') {
    return 'SOUS_RESERVE';
  }

  return original;
}

// ============================================================================
// SCENARIOS GATE
// ============================================================================

/**
 * Determine if scenarios should be rendered or suppressed.
 * Returns null if scenarios should show, or a replacement message if suppressed.
 */
export function scenariosGate(
  status: DocumentStatus,
  mc: MetricContext,
  scenarios: unknown[],
): string | null {
  if ((scenarios?.length ?? 0) === 0) return null; // no scenarios to show anyway

  if (status === 'incomplete' && !areScenariosExploitable(mc)) {
    return 'Les scénarios de sensibilité ne sont pas exploitables en l\'état. '
      + 'Les hypothèses économiques structurantes (coûts travaux, foncier, CA) ne sont pas suffisamment '
      + 'renseignées pour produire des résultats fiables. '
      + 'Cette section sera disponible après complétion du bilan financier.';
  }

  return null; // show scenarios normally
}

// ============================================================================
// SYNTHESE IA GATE
// ============================================================================

/**
 * Filter or suppress IA synthesis text.
 * In incomplete mode: suppress entirely (return null).
 * In provisional mode: wrap each section with a caveat.
 * In committee_ready: pass through with banned-phrase check.
 */
export function filterSyntheseIA(
  text: string | undefined | null,
  sectionName: string,
  status: DocumentStatus,
  mc: MetricContext,
): string | null {
  if (!text?.trim()) return null;

  if (status === 'incomplete') {
    return null; // suppress entirely
  }

  if (status === 'provisional') {
    const cleaned = stripBannedPhrases(text, status);
    return cleaned;
  }

  // committee_ready
  return stripBannedPhrases(text, status);
}

/** Should the IA synthesis section be shown at all? */
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

  // committee_ready
  return syn.executiveSummary.motifRecommandation;
}

/** Conclusion text from IA, filtered by status */
export function generateFinalIAConclusion(
  audit: DocumentAudit,
  syn: PromoteurSynthese,
): string | null {
  if (!syn.syntheseIA?.conclusion?.trim()) return null;

  if (audit.documentStatus === 'incomplete') {
    return null; // no IA conclusion on incomplete dossiers
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
  if (status === 'incomplete')  return 'DOSSIER INCOMPLET — USAGE INTERNE UNIQUEMENT';
  if (status === 'provisional') return 'PRÉ-ÉTUDE — VALIDATION COMPLÉMENTAIRE REQUISE';
  return "DOSSIER COMITÉ D'INVESTISSEMENT";
}

/** Short status label for the decision block */
export function getCoverStatusLabel(status: DocumentStatus): string {
  if (status === 'incomplete')  return 'DOSSIER INCOMPLET';
  if (status === 'provisional') return 'ANALYSE PROVISOIRE';
  return 'PRÊT COMITÉ';
}

/** Recommendation label adapted for cover display — never show GO on bad data */
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
  // committee_ready
  if (effectiveRec === 'GO') return 'GO — OPÉRATION RECOMMANDÉE';
  if (effectiveRec === 'GO_CONDITION') return 'GO CONDITIONNEL';
  return 'NO GO';
}