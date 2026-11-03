// Liaison explicite uniquement : aucune lecture de l'étude active.
export const UUID_ETUDE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `archivee` : étude archivée, jamais proposée comme destinataire (refusée aussi par la RPC). */
export interface EtudeChoix { id: string; title: string; archivee?: boolean }
export interface DepotLiaison {
  lister(): Promise<EtudeChoix[]>;
  lire(conceptionId: string): Promise<string | null>;
  enregistrer(conceptionId: string, etudeId: string | null): Promise<void>;
}
export async function chargerChoixLiaison(conceptionId: string, depot: DepotLiaison): Promise<{ etudes: EtudeChoix[]; etudeId: string | null; avertissement?: string }> {
  const [toutes, etudeId] = await Promise.all([depot.lister(), depot.lire(conceptionId)]);
  const etudes = toutes.filter(e => !e.archivee);
  // Étude liée archivée depuis : rien n'est présélectionné, l'utilisateur choisit (la liaison enregistrée reste intacte tant qu'il n'a pas confirmé).
  if (etudeId && toutes.some(e => e.id === etudeId && e.archivee)) {
    return { etudes, etudeId: null, avertissement: 'L’étude liée à cette conception est archivée. Choisissez une autre étude ou ouvrez sans liaison au bilan.' };
  }
  if (etudeId && !etudes.some(e => e.id === etudeId)) throw new Error('L’étude liée n’est plus accessible. Réessayez avant de choisir une autre étude.');
  return { etudes, etudeId };
}
export async function confirmerLiaison(conceptionId: string, etudeId: string | null, etudes: readonly EtudeChoix[], depot: DepotLiaison): Promise<string | null> {
  if (etudeId && (!UUID_ETUDE.test(etudeId) || !etudes.some(e => e.id === etudeId && !e.archivee))) throw new Error('Choisissez une étude accessible dans la liste.');
  await depot.enregistrer(conceptionId, etudeId);
  return etudeId;
}
