// src/spaces/promoteur/services/promoteurPdf.audit.ts
// Document audit: completeness scoring, document status classification,
// conservative recommendation override, and structured metadata for the PDF.

import type { PromoteurSynthese, RecommendationType } from './promoteurSynthese.types';
import { validateSynthese, type ValidationResult } from './promoteurPdf.validators';
import type { DocumentStatus } from './promoteurPdf.formatters';

// ============================================================================
// TYPES
// ============================================================================

export interface ComputedFlags {
  hasCriticalProjectData: boolean;
  hasCriticalFinancialData: boolean;
  hasCriticalMarketData: boolean;
  hasCriticalTechnicalData: boolean;
}

export interface DocumentAudit {
  /** Overall document status */
  documentStatus: DocumentStatus;
  /** 0–100 completeness score */
  completenessScore: number;
  /** Fields that are missing and critical */
  criticalMissingFields: string[];
  /** Non-blocking warnings */
  warnings: string[];
  /** Blocking issues preventing committee use */
  blockingIssues: string[];
  /** Data category flags */
  flags: ComputedFlags;
  /** Validation result (raw) */
  validation: ValidationResult;
  /** Effective recommendation after conservative override */
  effectiveRecommendation: RecommendationType;
  /** True if the original recommendation was downgraded */
  recommendationOverridden: boolean;
  /** Unique document identifier */
  documentId: string;
}

// ============================================================================
// COMPLETENESS SCORING
// ============================================================================
// Each field contributes a weight. Total possible = 100.
// Fields are grouped by category for the flags computation.

interface FieldCheck {
  category: 'project' | 'financial' | 'market' | 'technical';
  weight: number;
  label: string;
  present: (syn: PromoteurSynthese) => boolean;
}

const FIELDS: FieldCheck[] = [
  // Project (25 pts)
  { category: 'project', weight: 5, label: 'Adresse',            present: syn => !!syn.projet.adresse?.trim() },
  { category: 'project', weight: 5, label: 'Commune',            present: syn => !!syn.projet.commune?.trim() },
  { category: 'project', weight: 3, label: 'Code postal',        present: syn => !!syn.projet.codePostal?.trim() },
  { category: 'project', weight: 4, label: 'Surface plancher',   present: syn => (syn.projet.surfacePlancher ?? 0) > 0 },
  { category: 'project', weight: 4, label: 'Nb logements',       present: syn => (syn.projet.nbLogements ?? 0) > 0 },
  { category: 'project', weight: 2, label: 'Surface terrain',    present: syn => (syn.projet.surfaceTerrain ?? 0) > 0 },
  { category: 'project', weight: 2, label: 'Type de programme',  present: syn => !!syn.projet.programmeType?.trim() },

  // Financial (30 pts)
  { category: 'financial', weight: 6, label: 'CA total HT',       present: syn => (syn.financier.chiffreAffairesTotal ?? 0) > 0 },
  { category: 'financial', weight: 5, label: 'Coût de revient',   present: syn => (syn.financier.coutRevientTotal ?? 0) > 0 },
  { category: 'financial', weight: 4, label: 'Coût foncier',      present: syn => (syn.financier.coutFoncier ?? 0) > 0 },
  { category: 'financial', weight: 4, label: 'Coût travaux',      present: syn => (syn.financier.coutTravaux ?? 0) > 0 },
  { category: 'financial', weight: 3, label: 'Marge nette',       present: syn => syn.financier.margeNettePercent != null && isFinite(syn.financier.margeNettePercent) },
  { category: 'financial', weight: 3, label: 'TRN',               present: syn => syn.financier.trnRendement != null && isFinite(syn.financier.trnRendement) },
  { category: 'financial', weight: 3, label: 'Fonds propres',     present: syn => (syn.financement.fondsPropresRequis ?? 0) > 0 },
  { category: 'financial', weight: 2, label: 'Crédit promoteur',  present: syn => (syn.financement.creditPromoteurMontant ?? 0) > 0 },

  // Market (25 pts)
  { category: 'market', weight: 5, label: 'Prix neuf moyen',      present: syn => (syn.marche.prixNeufMoyenM2 ?? 0) > 0 },
  { category: 'market', weight: 4, label: 'Prix projet /m²',      present: syn => (syn.marche.prixProjetM2 ?? 0) > 0 },
  { category: 'market', weight: 4, label: 'Transactions DVF',     present: syn => (syn.marche.transactionsRecentes.nbTransactions ?? 0) > 0 },
  { category: 'market', weight: 3, label: 'Prix ancien moyen',    present: syn => (syn.marche.prixAncienMoyenM2 ?? 0) > 0 },
  { category: 'market', weight: 3, label: 'Absorption mensuelle', present: syn => syn.marche.absorptionMensuelle != null },
  { category: 'market', weight: 3, label: 'Offre concurrente',    present: syn => (syn.marche.offreConcurrente ?? 0) > 0 },
  { category: 'market', weight: 3, label: 'Données démographie',  present: syn => (syn.marche.demographieIndicateurs?.length ?? 0) > 0 },

  // Technical (20 pts)
  { category: 'technical', weight: 5, label: 'Zone PLU',          present: syn => !!syn.technique.zonePlu?.trim() },
  { category: 'technical', weight: 4, label: 'Hauteur max',       present: syn => syn.technique.hauteurMax != null },
  { category: 'technical', weight: 3, label: 'Recul voirie',      present: syn => syn.technique.reculs.voirie != null },
  { category: 'technical', weight: 3, label: 'Pleine terre',      present: syn => syn.technique.pleineTerre != null },
  { category: 'technical', weight: 3, label: 'Scénarios',         present: syn => (syn.scenarios?.length ?? 0) > 0 },
  { category: 'technical', weight: 2, label: 'Risques identifiés', present: syn => (syn.risques?.length ?? 0) > 0 },
];

function computeCompleteness(syn: PromoteurSynthese): {
  score: number;
  missing: string[];
  flags: ComputedFlags;
} {
  let earned = 0;
  const missing: string[] = [];
  const catScores: Record<string, { earned: number; total: number }> = {
    project:   { earned: 0, total: 0 },
    financial: { earned: 0, total: 0 },
    market:    { earned: 0, total: 0 },
    technical: { earned: 0, total: 0 },
  };

  for (const f of FIELDS) {
    catScores[f.category].total += f.weight;
    if (f.present(syn)) {
      earned += f.weight;
      catScores[f.category].earned += f.weight;
    } else {
      missing.push(f.label);
    }
  }

  const total = FIELDS.reduce((sum, f) => sum + f.weight, 0);

  // A category is "critical" if it has at least 60% of its weight filled
  const threshold = 0.6;
  const flags: ComputedFlags = {
    hasCriticalProjectData:   catScores.project.earned   / catScores.project.total   >= threshold,
    hasCriticalFinancialData: catScores.financial.earned / catScores.financial.total >= threshold,
    hasCriticalMarketData:    catScores.market.earned    / catScores.market.total    >= threshold,
    hasCriticalTechnicalData: catScores.technical.earned / catScores.technical.total >= threshold,
  };

  return {
    score: Math.round((earned / total) * 100),
    missing,
    flags,
  };
}

// ============================================================================
// DOCUMENT STATUS
// ============================================================================

function determineStatus(
  validation: ValidationResult,
  completenessScore: number,
  flags: ComputedFlags,
): DocumentStatus {
  // Any blocking issue → incomplete
  if (!validation.isValid) return 'incomplete';

  // Low completeness → provisional
  if (completenessScore < 60) return 'provisional';

  // Missing a critical category → provisional
  if (!flags.hasCriticalProjectData || !flags.hasCriticalFinancialData) return 'provisional';

  // Many warnings → provisional
  if (validation.warningCount >= 5) return 'provisional';

  // Otherwise → committee ready
  return 'committee_ready';
}

// ============================================================================
// CONSERVATIVE RECOMMENDATION OVERRIDE
// ============================================================================

function overrideRecommendation(
  original: RecommendationType,
  status: DocumentStatus,
  syn: PromoteurSynthese,
): { effective: RecommendationType; overridden: boolean } {
  let effective = original;

  // Rule 1: Incomplete dossier cannot be GO
  if (status === 'incomplete') {
    if (original === 'GO' || original === 'GO_CONDITION') {
      effective = 'NO_GO';
    }
  }

  // Rule 2: Provisional dossier caps at GO_CONDITION
  if (status === 'provisional' && original === 'GO') {
    effective = 'GO_CONDITION';
  }

  // Rule 3: Active kill switches force at most GO_CONDITION
  if ((syn.executiveSummary.killSwitchesActifs?.length ?? 0) > 0 && original === 'GO') {
    effective = 'GO_CONDITION';
  }

  // Rule 4: Margin sanity — if margin > 50% with low cost data, suspicious
  if (syn.financier.margeNettePercent > 50 && syn.financier.coutTravaux <= 0 && original === 'GO') {
    effective = 'GO_CONDITION';
  }

  return { effective, overridden: effective !== original };
}

// ============================================================================
// DOCUMENT ID GENERATION
// ============================================================================

function generateDocumentId(syn: PromoteurSynthese): string {
  const commune = (syn.projet.commune || 'XXX').substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
  const cp = (syn.projet.codePostal || '00000').substring(0, 5);
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MMZ-${commune}-${cp}-${ts}-${rand}`;
}

// ============================================================================
// MAIN AUDIT FUNCTION
// ============================================================================

export function auditSynthese(syn: PromoteurSynthese): DocumentAudit {
  const validation = validateSynthese(syn);
  const { score, missing, flags } = computeCompleteness(syn);
  const status = determineStatus(validation, score, flags);
  const { effective, overridden } = overrideRecommendation(
    syn.executiveSummary.recommendation, status, syn
  );

  return {
    documentStatus: status,
    completenessScore: score,
    criticalMissingFields: missing,
    warnings:       validation.issues.filter(i => i.severity === 'warning').map(i => i.message),
    blockingIssues: validation.issues.filter(i => i.severity === 'blocking').map(i => i.message),
    flags,
    validation,
    effectiveRecommendation: effective,
    recommendationOverridden: overridden,
    documentId: generateDocumentId(syn),
  };
}