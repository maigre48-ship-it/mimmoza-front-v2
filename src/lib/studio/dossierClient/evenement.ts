/**
 * VIS-60 — met en évidence le bouton « Préparer le dossier client » de l'Espace 3D quand Mimmo le propose dans le chat
 * (sortie de l'outil copilot-chat `studio_dossier_client` avec `data.pret === true`). Aucune préparation automatique :
 * le client clique.
 */
export const EVENEMENT_DOSSIER_CLIENT = 'mimmoza:dossier-client';
export const OUTIL_DOSSIER_CLIENT = 'studio_dossier_client';

/** PURE — l'appel d'outil du chat propose-t-il le dossier ? (forme des appels lus par CopilotMessage : { name, status, output }) */
export function appelProposeDossier(tc: { name?: string; status?: string; output?: unknown } | null | undefined): boolean {
  if (!tc || tc.name !== OUTIL_DOSSIER_CLIENT || tc.status === 'running') return false;
  const o = tc.output as { status?: unknown; data?: { pret?: unknown } } | null | undefined;
  return !!o && o.status === 'ok' && o.data?.pret === true;
}

/** À appeler par l'affichage des appels d'outils du chat (branchement documenté dans le rapport VIS-60). */
export function signalerDossierClient(conversationId: string, tc: { name?: string; status?: string; output?: unknown } | null | undefined): boolean {
  if (!appelProposeDossier(tc) || typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent<string>(EVENEMENT_DOSSIER_CLIENT, { detail: conversationId }));
  return true;
}
