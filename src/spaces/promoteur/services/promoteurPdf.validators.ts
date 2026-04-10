// src/spaces/promoteur/services/promoteurPdf.validators.ts
// Business validation rules applied BEFORE PDF generation.
// Ensures no absurd or misleading document can be produced.

import type { PromoteurSynthese } from './promoteurSynthese.types';

// ============================================================================
// TYPES
// ============================================================================

export type Severity = 'blocking' | 'warning' | 'info';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
}

export interface ValidationResult {
  isValid: boolean;               // false = at least one blocking issue
  issues: ValidationIssue[];
  blockingCount: number;
  warningCount: number;
}

// ============================================================================
// INDIVIDUAL RULES
// ============================================================================

type Rule = (syn: PromoteurSynthese) => ValidationIssue | null;

const blocking = (code: string, message: string, field?: string): ValidationIssue =>
  ({ code, severity: 'blocking', message, field });

const warning = (code: string, message: string, field?: string): ValidationIssue =>
  ({ code, severity: 'warning', message, field });

// ── Projet ──────────────────────────────────────────────────────────────────

const rules: Rule[] = [
  // BLOCKING — Project identity
  (syn) => !syn.projet.commune?.trim()
    ? blocking('PROJ_NO_COMMUNE', 'Commune non renseignée', 'projet.commune') : null,
  (syn) => !syn.projet.codePostal?.trim()
    ? blocking('PROJ_NO_CP', 'Code postal absent', 'projet.codePostal') : null,
  (syn) => !syn.projet.adresse?.trim()
    ? blocking('PROJ_NO_ADDR', 'Adresse non renseignée', 'projet.adresse') : null,

  // BLOCKING — Critical dimensions
  (syn) => (syn.projet.surfacePlancher ?? 0) <= 0
    ? blocking('PROJ_NO_SDP', 'Surface de plancher <= 0', 'projet.surfacePlancher') : null,
  (syn) => (syn.projet.nbLogements ?? 0) <= 0
    ? blocking('PROJ_NO_LOTS', 'Nombre de logements <= 0', 'projet.nbLogements') : null,
  (syn) => (syn.projet.surfaceTerrain ?? 0) <= 0
    ? warning('PROJ_NO_TERRAIN', 'Surface terrain non renseignée', 'projet.surfaceTerrain') : null,

  // BLOCKING — Financial fundamentals
  (syn) => (syn.financier.chiffreAffairesTotal ?? 0) <= 0
    ? blocking('FIN_NO_CA', 'Chiffre d\'affaires total <= 0', 'financier.chiffreAffairesTotal') : null,
  (syn) => (syn.financier.coutRevientTotal ?? 0) <= 0
    ? blocking('FIN_NO_CDR', 'Coût de revient total <= 0', 'financier.coutRevientTotal') : null,

  // BLOCKING — Incoherent recommendation
  (syn) => {
    const hasCA = (syn.financier.chiffreAffairesTotal ?? 0) > 0;
    const hasCDR = (syn.financier.coutRevientTotal ?? 0) > 0;
    const hasSDP = (syn.projet.surfacePlancher ?? 0) > 0;
    const hasLots = (syn.projet.nbLogements ?? 0) > 0;
    const isGO = syn.executiveSummary.recommendation === 'GO';
    if (isGO && (!hasCA || !hasCDR || !hasSDP || !hasLots))
      return blocking('REC_INCOHERENT_GO',
        'Recommandation GO alors que des données critiques sont absentes');
    return null;
  },

  // BLOCKING — PLU incoherence
  (syn) => {
    const faisOK = syn.technique.faisabiliteTechnique === 'CONFIRME';
    const noZone = !syn.technique.zonePlu?.trim();
    if (faisOK && noZone)
      return blocking('PLU_INCOHERENT',
        'Faisabilité marquée CONFIRMÉE sans zone PLU renseignée');
    return null;
  },

  // WARNING — Market data gaps
  (syn) => (syn.marche.prixNeufMoyenM2 ?? 0) <= 0
    ? warning('MKT_NO_PRIX_NEUF', 'Prix neuf moyen non renseigné') : null,
  (syn) => (syn.marche.transactionsRecentes.nbTransactions ?? 0) === 0
    ? warning('MKT_NO_DVF', 'Aucune transaction DVF disponible') : null,
  (syn) => syn.marche.absorptionMensuelle == null
    ? warning('MKT_NO_ABSORPTION', 'Absorption mensuelle non renseignée') : null,
  (syn) => (syn.marche.offreConcurrente ?? 0) === 0
    ? warning('MKT_NO_CONCURRENCE', 'Offre concurrente non renseignée') : null,

  // WARNING — Financial completeness
  (syn) => (syn.financier.coutFoncier ?? 0) <= 0
    ? warning('FIN_NO_FONCIER', 'Coût foncier non renseigné') : null,
  (syn) => (syn.financier.coutTravaux ?? 0) <= 0
    ? warning('FIN_NO_TRAVAUX', 'Coût travaux non renseigné') : null,

  // WARNING — Margin sanity
  (syn) => {
    const m = syn.financier.margeNettePercent;
    if (m != null && isFinite(m) && m > 50)
      return warning('FIN_MARGE_SUSPECT',
        `Marge nette de ${m.toFixed(1)}% anormalement élevée — vérifier les coûts`);
    return null;
  },

  // WARNING — TRN sanity
  (syn) => {
    const t = syn.financier.trnRendement;
    if (t != null && isFinite(t) && t > 60)
      return warning('FIN_TRN_SUSPECT',
        `TRN de ${t.toFixed(1)}% anormalement élevé — vérifier les hypothèses`);
    return null;
  },

  // WARNING — Kill switches with GO
  (syn) => {
    const ks = syn.executiveSummary.killSwitchesActifs?.length ?? 0;
    if (ks > 0 && syn.executiveSummary.recommendation === 'GO')
      return warning('REC_GO_WITH_KS',
        'Recommandation GO malgré kill switches actifs');
    return null;
  },

  // WARNING — No scenarios
  (syn) => (syn.scenarios?.length ?? 0) === 0
    ? warning('SCEN_EMPTY', 'Aucun scénario de sensibilité défini') : null,

  // WARNING — No risks identified (suspicious)
  (syn) => (syn.risques?.length ?? 0) === 0
    ? warning('RISK_EMPTY', 'Aucun risque identifié — analyse incomplète') : null,

  // INFO — No IA synthesis
  (syn) => !syn.syntheseIA
    ? warning('IA_ABSENT', 'Synthèse analytique IA absente') : null,
];

// ============================================================================
// VALIDATE
// ============================================================================

export function validateSynthese(syn: PromoteurSynthese): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    const issue = rule(syn);
    if (issue) issues.push(issue);
  }

  const blockingCount = issues.filter(i => i.severity === 'blocking').length;
  const warningCount  = issues.filter(i => i.severity === 'warning').length;

  return {
    isValid: blockingCount === 0,
    issues,
    blockingCount,
    warningCount,
  };
}