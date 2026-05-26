// ─────────────────────────────────────────────────────────────────────────────
// planValidation.types.ts
// Types de validation métier des éléments extraits d'un plan de réhabilitation
// ─────────────────────────────────────────────────────────────────────────────

// ── Statut de validation d'un élément ────────────────────────────────────────

export type ElementValidationStatus =
  | 'en_attente'    // détecté, non encore examiné
  | 'validé'        // confirmé correct par l'utilisateur ou auto-validation
  | 'rejeté'        // identifié comme faux positif
  | 'corrigé';      // données modifiées manuellement

// ── Sévérité d'un problème de validation ─────────────────────────────────────

export type ValidationSeverity = 'info' | 'avertissement' | 'erreur';

// ── Catégorie de règle de validation ─────────────────────────────────────────

export type ValidationRuleCategory =
  | 'surface'
  | 'dimension'
  | 'cohérence_géométrique'
  | 'usage_réglementaire'
  | 'accessibilité_pmr'
  | 'sécurité_incendie'
  | 'habitabilité';

// ── Règle de validation ───────────────────────────────────────────────────────

export interface ValidationRule {
  readonly id: string;
  readonly categorie: ValidationRuleCategory;
  readonly description: string;
  readonly severite: ValidationSeverity;
}

// ── Problème détecté lors de la validation ────────────────────────────────────

export interface ValidationIssue {
  readonly rule_id: string;
  readonly severite: ValidationSeverity;
  readonly message: string;
  readonly element_id: string | null;
  readonly valeur_detectee: number | string | null;
  readonly valeur_attendue: number | string | null;
  readonly suggestion: string | null;
}

// ── Validation d'un élément individuel ───────────────────────────────────────

export interface ElementValidation<TCorrection = Record<string, unknown>> {
  readonly element_id: string;
  readonly element_type: 'room' | 'wall' | 'opening' | 'annotation';
  readonly status: ElementValidationStatus;
  readonly issues: ReadonlyArray<ValidationIssue>;
  readonly correction: TCorrection | null;
  readonly validated_at: string | null; // ISO 8601
  readonly validated_by: 'auto' | 'user';
}

// ── Corrections possibles par type d'élément ─────────────────────────────────

export interface RoomCorrection {
  readonly nom?: string;
  readonly usage?: string;
  readonly surface_m2?: number;
  readonly surface_habitable?: boolean;
  readonly etage?: number;
}

export interface WallCorrection {
  readonly epaisseur_cm?: number;
  readonly materiau?: string;
  readonly porteur?: boolean;
}

export interface OpeningCorrection {
  readonly type?: string;
  readonly largeur_m?: number;
  readonly hauteur_m?: number;
}

// ── Score de qualité global du plan ──────────────────────────────────────────

export interface PlanQualityScore {
  readonly score_global: number;         // 0–100
  readonly score_completude: number;     // tous les éléments renseignés ?
  readonly score_coherence: number;      // cohérence géométrique
  readonly score_conformite: number;     // conformité réglementaire
  readonly nb_erreurs: number;
  readonly nb_avertissements: number;
  readonly nb_infos: number;
}

// ── Résumé de conformité réglementaire ───────────────────────────────────────

export interface ConformiteReglementaire {
  readonly pmr_conforme: boolean | null;      // accessibilité PMR
  readonly erp_applicable: boolean | null;    // si usage ERP détecté
  readonly surface_min_chambre_ok: boolean | null; // ≥ 9m² loi Boutin
  readonly hauteur_sous_plafond_ok: boolean | null; // ≥ 2.20m
  readonly surface_habitable_totale_ok: boolean | null; // ≥ 14m² logement
  readonly remarques_reglementaires: ReadonlyArray<string>;
}

// ── Rapport de validation complet d'un plan ───────────────────────────────────

export interface PlanValidationReport {
  readonly plan_id: string;
  readonly generated_at: string; // ISO 8601
  readonly quality_score: PlanQualityScore;
  readonly conformite: ConformiteReglementaire;
  readonly element_validations: ReadonlyArray<ElementValidation>;
  readonly issues_globales: ReadonlyArray<ValidationIssue>;
  readonly validation_complete: boolean;
  readonly nb_elements_en_attente: number;
}

// ── État de validation dans le store ─────────────────────────────────────────

export interface PlanValidationState {
  readonly plan_id: string;
  readonly report: PlanValidationReport | null;
  readonly is_validating: boolean;
  readonly last_error: string | null;
}

// ── Règles de validation métier intégrées ────────────────────────────────────
// Référentiel statique embarqué (pas de fetch réseau)

export const VALIDATION_RULES: ReadonlyArray<ValidationRule> = [
  {
    id: 'SURF_MIN_CHAMBRE',
    categorie: 'usage_réglementaire',
    description: 'Surface minimale chambre ≥ 9 m² (loi Boutin)',
    severite: 'erreur',
  },
  {
    id: 'SURF_MIN_LOGEMENT',
    categorie: 'usage_réglementaire',
    description: 'Surface habitable totale logement ≥ 14 m²',
    severite: 'erreur',
  },
  {
    id: 'SURF_MIN_CUISINE',
    categorie: 'usage_réglementaire',
    description: 'Surface cuisine ≥ 3.5 m² si séparée',
    severite: 'avertissement',
  },
  {
    id: 'HAUTEUR_MIN',
    categorie: 'habitabilité',
    description: 'Hauteur sous plafond ≥ 2.20 m pour surface habitable',
    severite: 'erreur',
  },
  {
    id: 'PMR_LARGEUR_PORTE',
    categorie: 'accessibilité_pmr',
    description: 'Largeur porte ≥ 0.83 m (PMR) ou ≥ 0.77 m passage utile',
    severite: 'avertissement',
  },
  {
    id: 'PMR_LARGEUR_COULOIR',
    categorie: 'accessibilité_pmr',
    description: 'Largeur couloir ≥ 0.90 m (PMR)',
    severite: 'avertissement',
  },
  {
    id: 'COHERENCE_SURFACE',
    categorie: 'cohérence_géométrique',
    description: 'Somme des surfaces pièces cohérente avec surface totale (±15%)',
    severite: 'avertissement',
  },
  {
    id: 'PIECE_SANS_USAGE',
    categorie: 'cohérence_géométrique',
    description: 'Pièce détectée sans usage identifiable',
    severite: 'info',
  },
] as const;