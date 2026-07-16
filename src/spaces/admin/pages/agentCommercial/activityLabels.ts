// src/spaces/admin/pages/agentCommercial/activityLabels.ts
// Libellés FR des types d'événements du journal d'activité.

const LABELS: Record<string, string> = {
  prospect_created: "Prospect créé",
  prospect_updated: "Prospect modifié",
  prospect_archived: "Prospect archivé",
  prospect_restored: "Prospect restauré",
  status_changed: "Changement de statut",
  exclusion_added: "Ajout à la liste d'exclusion",
  exclusion_removed: "Retrait de la liste d'exclusion",
  csv_import: "Import CSV",
  knowledge_created: "Entrée de connaissance créée",
  knowledge_updated: "Entrée de connaissance modifiée",
  knowledge_deleted: "Entrée de connaissance supprimée",
  knowledge_reordered: "Réorganisation de la base de connaissances",
  email_generated: "Email généré par l'IA",
  email_updated: "Email modifié",
  email_approved: "Email validé",
  email_rejected: "Email rejeté",
};

export function activityLabel(eventType: string): string {
  return LABELS[eventType] ?? eventType;
}
