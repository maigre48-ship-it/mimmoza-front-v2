// supabase/functions/copilot-chat/agent/dossier-client.ts
// =============================================================
// VIS-60 (27/11/2026) — DOSSIER CLIENT. Outil `studio_dossier_client` : Mimmo PROPOSE « Préparer le dossier client »
// quand tous les livrables du projet sont prêts (au moins une image ou un film terminés, plus aucun rendu en attente
// ou en cours). L'outil LIT seulement (studio_jobs de l'utilisateur ET de la conversation) ; il n'écrit rien, ne
// débite rien et ne prépare rien : le dossier (PDF + ZIP) est assemblé par le bouton de l'Espace 3D
// (src/spaces/copilot/studio3d/BoutonDossierClient.tsx), que la sortie `data.pret` met en évidence.
// Logique de choix partagée avec le site : src/lib/studio/dossierClient/dossierClientLogique.ts (pur, sans import).
// =============================================================
import type { OutilDef, ResultatOutil } from './types.ts';
import { collecterLivrables, etatDossier, type TravailDossier } from '../../../../src/lib/studio/dossierClient/dossierClientLogique.ts';

export const OUTIL_DOSSIER_CLIENT = 'studio_dossier_client';
export const SOURCE_DOSSIER_CLIENT = 'MimmozIA · Dossier client';
export const LIBELLE_BOUTON_DOSSIER = 'Préparer le dossier client';

export const OUTIL_DOSSIER_CLIENT_DEF: OutilDef = {
  name: OUTIL_DOSSIER_CLIENT,
  description:
    'DOSSIER CLIENT (dossier de présentation) : vérifie si les livrables 3D du projet sont prêts (film, images HD, visite 360°, ' +
    'plans) et, s’ils le sont, fait apparaître le bouton « Préparer le dossier client » de l’Espace 3D (PDF de présentation + ' +
    'archive ZIP : film MP4, images HD, plans PDF/DXF/IFC, notice). QUAND : l’utilisateur demande son dossier, ses livrables, ' +
    'une plaquette ou un dossier de présentation pour son client ; ou juste après l’annonce qu’un rendu est terminé. ' +
    'APRÈS L’APPEL : si `pret` est vrai, propose le bouton en UNE phrase (ce que contient le dossier, « aucun jeton débité ») ; ' +
    'sinon dis ce qui manque (rendus en cours, ou rien de terminé). Ne promets aucun envoi par e-mail, ne cite aucun ' +
    'fournisseur de modèles 3D, n’invente aucune surface.',
  input_schema: { type: 'object', properties: {} },
  available_in_modes: ['quick', 'advanced', 'report'],
};

export interface DepotDossierClient {
  /** Travaux de l'utilisateur dans la conversation (les plus récents d'abord) ; erreur → lève. */
  travaux(userId: string, conversationId: string): Promise<TravailDossier[]>;
}

/** Le tour parle-t-il du dossier client ? (proposition de l'outil, pas d'appel forcé) */
export function demandeDossierClient(texte: string): boolean {
  const t = texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\bdossier (client|de presentation|commercial|de vente)\b|\b(pack|kit) (commercial|client|de vente)\b|\bplaquette\b|\b(mes|les|tous les) livrables\b|\bpreparer le dossier\b/.test(t);
}

/** Vrai quand Mimmo doit proposer le dossier SANS qu'on le demande : tout est prêt et un livrable vient de se terminer. */
export function proposerDossierSpontanement(travaux: readonly TravailDossier[], derniereProposition: string | null): boolean {
  const e = etatDossier(travaux);
  if (!e.pret) return false;
  const dernierFini = travaux.filter((t) => t.statut === 'termine').map((t) => Date.parse(t.termine_le ?? t.cree_le)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (dernierFini === undefined) return false;
  return derniereProposition === null || dernierFini > Date.parse(derniereProposition);
}

export async function executerOutilDossierClient(_input: Record<string, unknown>, env: { userId?: string | null; conversationId?: string | null; depot: DepotDossierClient }): Promise<ResultatOutil> {
  if (!env.userId) return { status: 'error', source: SOURCE_DOSSIER_CLIENT, message: 'Session expirée : reconnectez-vous.' };
  if (!env.conversationId) return { status: 'error', source: SOURCE_DOSSIER_CLIENT, message: 'Ouvrez d’abord la conversation du projet.' };
  let travaux: TravailDossier[];
  try {
    travaux = await env.depot.travaux(env.userId, env.conversationId);
  } catch (e) {
    return { status: 'error', source: SOURCE_DOSSIER_CLIENT, message: `Livrables illisibles pour le moment (${e instanceof Error ? e.message : String(e)}). Rien n’a été préparé.` };
  }
  const m = collecterLivrables(travaux);
  const e = etatDossier(travaux, m);
  const data = {
    pret: e.pret, preparable: e.preparable, presents: e.presents, absents: e.absents, rendus_en_cours: e.enCours,
    images: m.images.length, film: m.film !== null, visite_360: m.visite !== null, plans: m.plans.length,
    bouton: LIBELLE_BOUTON_DOSSIER, debit_jetons: 0,
  };
  const message = e.pret
    ? `${e.phrase} Le bouton « ${LIBELLE_BOUTON_DOSSIER} » est en évidence dans l’Espace 3D : propose-le en une phrase (PDF de présentation + archive ZIP avec film, images HD, plans et notice ; aucun jeton débité). Ne recopie pas la liste des fichiers.`
    : e.preparable
      ? `${e.phrase} Propose d’attendre la fin des rendus pour un dossier complet ; le bouton « ${LIBELLE_BOUTON_DOSSIER} » de l’Espace 3D reste utilisable dès maintenant.`
      : `${e.phrase} Ne propose pas le dossier : propose plutôt un film ou des images du projet.`;
  return { status: 'ok', source: SOURCE_DOSSIER_CLIENT, data, message };
}

/** Dépôt Supabase (client service) : lecture bornée à l'utilisateur ET à la conversation. */
export function depotDossierClientSupabase(admin: { from: (t: string) => any }): DepotDossierClient {
  return {
    async travaux(userId, conversationId) {
      const { data, error } = await admin.from('studio_jobs').select('id,type,statut,resultat,cree_le,termine_le')
        .eq('user_id', userId).eq('conversation_id', conversationId).order('cree_le', { ascending: false }).limit(200);
      if (error) throw new Error(error.message ?? 'lecture impossible');
      return (data ?? []) as TravailDossier[];
    },
  };
}

/** Consigne ajoutée au système quand `proposerDossierSpontanement` est vrai (branchement dans index.ts). */
export const CONSIGNE_DOSSIER_CLIENT =
  `DOSSIER CLIENT (VIS-60) : tous les livrables 3D de ce projet sont terminés. En fin de réponse, appelle ${OUTIL_DOSSIER_CLIENT} puis propose ` +
  `en une phrase le bouton « ${LIBELLE_BOUTON_DOSSIER} » de l’Espace 3D. Une seule fois : ne le repropose pas s’il l’a déjà été après le dernier rendu.`;
