// FILE: src/spaces/banque/config/required-documents.ts

import type { ProjectType } from "../types";

// ============================================================================
// DOCUMENTS REQUIS PAR TYPE DE PROJET
// ============================================================================

export interface RequiredDocument {
  id: string;
  label: string;
  category: string;
}

// ── Promotion immobilière (18 docs) ─────────────────────────────────────────

const PROMOTION_DOCUMENTS: RequiredDocument[] = [
  // Identité & juridique
  { id: "promo-01", label: "Statuts de la société (SCI/SCCV)", category: "Juridique" },
  { id: "promo-02", label: "Extrait Kbis de moins de 3 mois", category: "Juridique" },
  { id: "promo-03", label: "Pièce d'identité du gérant / dirigeant", category: "Juridique" },
  { id: "promo-04", label: "Pouvoirs de signature", category: "Juridique" },
  // Foncier & urbanisme
  { id: "promo-05", label: "Promesse de vente ou compromis signé", category: "Foncier" },
  { id: "promo-06", label: "Titre de propriété ou attestation notariée", category: "Foncier" },
  { id: "promo-07", label: "Permis de construire purgé de tout recours", category: "Urbanisme" },
  { id: "promo-08", label: "Plans architecturaux (masse, niveaux, coupes)", category: "Urbanisme" },
  // Financier
  { id: "promo-09", label: "Bilan prévisionnel de l'opération (TTC/HT)", category: "Financier" },
  { id: "promo-10", label: "Plan de trésorerie mensuel", category: "Financier" },
  { id: "promo-11", label: "Grille de prix de vente par lot", category: "Financier" },
  { id: "promo-12", label: "Bilans et liasses fiscales N-1, N-2 du promoteur", category: "Financier" },
  { id: "promo-13", label: "Tableau de pré-commercialisation (réservations)", category: "Commercial" },
  { id: "promo-14", label: "Étude de marché ou avis de valeur", category: "Commercial" },
  // Technique
  { id: "promo-15", label: "Étude géotechnique (G2 AVP minimum)", category: "Technique" },
  { id: "promo-16", label: "Attestation d'assurance Dommages-Ouvrage", category: "Assurance" },
  { id: "promo-17", label: "Contrat de maîtrise d'œuvre ou entreprise générale", category: "Technique" },
  { id: "promo-18", label: "Garantie Financière d'Achèvement (GFA) - projet ou engagement", category: "Assurance" },
];

// ── Marchand de biens (15 docs) ─────────────────────────────────────────────

const MARCHAND_DOCUMENTS: RequiredDocument[] = [
  // Identité & juridique
  { id: "march-01", label: "Statuts de la société", category: "Juridique" },
  { id: "march-02", label: "Extrait Kbis de moins de 3 mois", category: "Juridique" },
  { id: "march-03", label: "Pièce d'identité du gérant / dirigeant", category: "Juridique" },
  // Acquisition
  { id: "march-04", label: "Promesse ou compromis de vente", category: "Acquisition" },
  { id: "march-05", label: "Titre de propriété ou acte notarié", category: "Acquisition" },
  { id: "march-06", label: "Diagnostics immobiliers obligatoires (DPE, amiante, plomb…)", category: "Technique" },
  // Financier
  { id: "march-07", label: "Plan de financement de l'opération", category: "Financier" },
  { id: "march-08", label: "Budget travaux détaillé (devis signés)", category: "Financier" },
  { id: "march-09", label: "Estimation de la valeur de revente (avis de valeur)", category: "Financier" },
  { id: "march-10", label: "Bilans et liasses fiscales N-1, N-2", category: "Financier" },
  { id: "march-11", label: "Tableau récapitulatif des opérations passées", category: "Financier" },
  // Travaux & revente
  { id: "march-12", label: "Descriptif des travaux envisagés", category: "Technique" },
  { id: "march-13", label: "Permis de construire ou déclaration préalable (si travaux)", category: "Urbanisme" },
  { id: "march-14", label: "Attestation d'assurance RC Pro", category: "Assurance" },
  { id: "march-15", label: "Planning prévisionnel (acquisition → revente)", category: "Commercial" },
];

// ── Baseline / Investissement classique (11 docs) ───────────────────────────

const BASELINE_DOCUMENTS: RequiredDocument[] = [
  // Identité
  { id: "base-01", label: "Pièce d'identité de l'emprunteur", category: "Juridique" },
  { id: "base-02", label: "Justificatif de domicile de moins de 3 mois", category: "Juridique" },
  { id: "base-03", label: "Avis d'imposition N-1 et N-2", category: "Financier" },
  // Revenus & patrimoine
  { id: "base-04", label: "Trois derniers bulletins de salaire ou bilan comptable", category: "Financier" },
  { id: "base-05", label: "Relevés de comptes bancaires (3 derniers mois)", category: "Financier" },
  { id: "base-06", label: "Tableau d'endettement (crédits en cours)", category: "Financier" },
  // Bien
  { id: "base-07", label: "Compromis de vente ou promesse signée", category: "Acquisition" },
  { id: "base-08", label: "Estimation ou avis de valeur du bien", category: "Acquisition" },
  { id: "base-09", label: "Diagnostics immobiliers obligatoires", category: "Technique" },
  // Assurance
  { id: "base-10", label: "Questionnaire de santé (assurance emprunteur)", category: "Assurance" },
  { id: "base-11", label: "Attestation d'assurance habitation (ou projet)", category: "Assurance" },
];

// ── Accessor ────────────────────────────────────────────────────────────────

const DOCUMENTS_BY_TYPE: Record<ProjectType, RequiredDocument[]> = {
  promotion: PROMOTION_DOCUMENTS,
  marchand: MARCHAND_DOCUMENTS,
  baseline: BASELINE_DOCUMENTS,
};

/**
 * Retourne la liste des documents requis pour un type de projet donné.
 * Retourne baseline par défaut si le type est inconnu.
 */
export function getRequiredDocuments(projectType: ProjectType): RequiredDocument[] {
  return DOCUMENTS_BY_TYPE[projectType] ?? BASELINE_DOCUMENTS;
}

/**
 * Retourne toutes les catégories distinctes pour un type de projet.
 */
export function getDocumentCategories(projectType: ProjectType): string[] {
  const docs = getRequiredDocuments(projectType);
  return [...new Set(docs.map((d) => d.category))];
}