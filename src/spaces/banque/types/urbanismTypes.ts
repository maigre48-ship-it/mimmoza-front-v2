// ============================================================================
// urbanismTypes.ts
// src/spaces/banque/types/urbanismTypes.ts
//
// Types pour la section Urbanisme du module Banque.
// ⚠️ PREUVE / COMPLÉTUDE uniquement — aucune lecture automatique du PLU.
// Le chargé de crédit remplit manuellement le statut et attache les pièces.
// ============================================================================

/**
 * Statut de conformité urbanistique — rempli manuellement.
 */
export type UrbanismStatus =
  | "non_verifie"     // Pas encore vérifié
  | "en_cours"        // Vérification en cours (instruction mairie, etc.)
  | "conforme"        // Validé conforme (PC obtenu, CU favorable, etc.)
  | "non_conforme"    // Non conforme (refus, incompatibilité PLU)
  | "reserve"         // Conforme sous réserve (prescriptions)
  | "sans_objet";     // N/A (ex: terrain nu sans construction prévue)

/**
 * Pièce justificative urbanistique.
 */
export interface UrbanismEvidence {
  /** Identifiant unique de la pièce */
  id: string;
  /** Type de document */
  type:
    | "permis_construire"
    | "declaration_prealable"
    | "certificat_urbanisme"
    | "arrete_pc"
    | "avis_abe"
    | "note_conformite"
    | "plu_extrait"
    | "autre";
  /** Libellé affiché */
  label: string;
  /** Nom du fichier (si uploadé) */
  fileName?: string;
  /** URL du fichier (Supabase Storage ou autre) */
  fileUrl?: string;
  /** Date d'ajout */
  addedAt: string;
  /** Ajouté par (nom ou ID utilisateur) */
  addedBy?: string;
  /** Notes libres */
  notes?: string;
}

/**
 * Bloc urbanisme de l'OperationSummary.
 * Attaché à operation.urbanism
 */
export interface OperationUrbanism {
  /** Statut de conformité (rempli manuellement) */
  status: UrbanismStatus;
  /** Pièces justificatives */
  evidence: UrbanismEvidence[];
  /** Notes libres du chargé de crédit */
  notes: string;
  /** Dernière vérification */
  lastCheckedAt: string | null;
  /** Source de la vérification */
  source: string;
}

/**
 * Valeur par défaut pour un nouveau dossier.
 */
export function defaultUrbanism(): OperationUrbanism {
  return {
    status: "non_verifie",
    evidence: [],
    notes: "",
    lastCheckedAt: null,
    source: "",
  };
}

/**
 * Labels lisibles pour les statuts.
 */
export const URBANISM_STATUS_LABELS: Record<UrbanismStatus, string> = {
  non_verifie: "Non vérifié",
  en_cours: "En cours de vérification",
  conforme: "Conforme",
  non_conforme: "Non conforme",
  reserve: "Conforme sous réserve",
  sans_objet: "Sans objet",
};

/**
 * Couleurs Tailwind pour les badges de statut.
 */
export const URBANISM_STATUS_COLORS: Record<UrbanismStatus, string> = {
  non_verifie: "bg-gray-100 text-gray-700",
  en_cours: "bg-yellow-100 text-yellow-800",
  conforme: "bg-green-100 text-green-800",
  non_conforme: "bg-red-100 text-red-800",
  reserve: "bg-orange-100 text-orange-800",
  sans_objet: "bg-gray-50 text-gray-500",
};

/**
 * Labels pour les types de pièces.
 */
export const EVIDENCE_TYPE_LABELS: Record<UrbanismEvidence["type"], string> = {
  permis_construire: "Permis de construire",
  declaration_prealable: "Déclaration préalable",
  certificat_urbanisme: "Certificat d'urbanisme",
  arrete_pc: "Arrêté de PC",
  avis_abe: "Avis ABF",
  note_conformite: "Note de conformité",
  plu_extrait: "Extrait PLU",
  autre: "Autre document",
};
