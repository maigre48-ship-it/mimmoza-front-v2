// src/lib/studio/travaux.ts
//
// FILM OU VISITE 360° EN 3 CLICS — service de la file `studio_jobs`.
//
// Créer, annuler, lister et suivre un travail ; URL signée du film (bucket
// privé `studio-rendus`) ; adresse publique du manifeste d'une visite (bucket
// public `visites`). Si la migration n'est pas encore appliquée, les fonctions
// renvoient `{ disponible: false }` au lieu de lever : l'interface affiche
// « Bientôt disponible ».
// La logique pure (construction, validation, libellés) est dans
// travauxLogique.ts ; les types du manifeste dans manifesteVisite.ts.

import { supabase } from '@/lib/supabaseClient';
import { fileIndisponible, lireTravail, messageErreurTravail, type NouveauTravail, type TravailStudio } from './travauxLogique';

export * from './travauxLogique';
export * from './manifesteVisite';

export const BUCKET_RENDUS = 'studio-rendus';
export const BUCKET_VISITES = 'visites';
const COLONNES = 'id,conversation_id,type,statut,progression,etape,options,resultat,elements_omis,erreur,cree_le,maj_le,demarre_le,termine_le';
const SONDAGE_MS = 5000;

export type Reponse<T> = { disponible: true; valeur: T } | { disponible: false };

export class ErreurTravail extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurTravail';
  }
}

/** Liste courte des films et visites de la conversation (plus récents d'abord). */
export async function listerTravaux(conversationId: string, limite = 6): Promise<Reponse<TravailStudio[]>> {
  const { data, error } = await supabase.from('studio_jobs').select(COLONNES)
    .eq('conversation_id', conversationId)
    .order('cree_le', { ascending: false })
    .limit(limite);
  if (error) {
    if (fileIndisponible(error)) return { disponible: false };
    throw new ErreurTravail(messageErreurTravail(error));
  }
  return { disponible: true, valeur: (data ?? []).map(lireTravail).filter((t): t is TravailStudio => t !== null) };
}

export async function lireTravailParId(id: string): Promise<TravailStudio | null> {
  const { data, error } = await supabase.from('studio_jobs').select(COLONNES).eq('id', id).maybeSingle();
  if (error) throw new ErreurTravail(messageErreurTravail(error));
  return lireTravail(data);
}

/** Clic « Lancer » : insère le travail (le serveur force statut et suivi). */
export async function creerTravail(travail: NouveauTravail): Promise<Reponse<TravailStudio>> {
  const { data: session } = await supabase.auth.getUser();
  const userId = session.user?.id;
  if (!userId) throw new ErreurTravail('Connectez-vous pour lancer un film ou une visite.');
  const { data, error } = await supabase.from('studio_jobs')
    .insert({ ...travail, user_id: userId })
    .select(COLONNES).single();
  if (error) {
    if (fileIndisponible(error)) return { disponible: false };
    throw new ErreurTravail(messageErreurTravail(error));
  }
  const lu = lireTravail(data);
  if (!lu) throw new ErreurTravail('Le lancement n’a pas été confirmé.');
  return { disponible: true, valeur: lu };
}

/** Annule un travail en attente ou en cours (seule modification permise à l'utilisateur). */
export async function annulerTravail(id: string): Promise<TravailStudio | null> {
  const { data, error } = await supabase.from('studio_jobs')
    .update({ statut: 'annule' }).eq('id', id)
    .select(COLONNES).maybeSingle();
  if (error) throw new ErreurTravail(messageErreurTravail(error));
  return lireTravail(data);
}

/**
 * Suit un travail en direct : abonnement temps réel sur la ligne + sondage
 * toutes les 5 s (filet de sécurité si le temps réel est coupé). Le rappel
 * reçoit chaque nouvel état ; le suivi s'arrête de lui-même quand le travail
 * est terminé, en échec ou annulé. Renvoie la fonction d'arrêt.
 */
export function suivreTravail(id: string, rappel: (travail: TravailStudio) => void): () => void {
  let actif = true;
  let dernier = '';
  const emettre = (t: TravailStudio | null) => {
    if (!actif || !t) return;
    const empreinte = `${t.statut}|${String(t.progression)}|${t.etape ?? ''}|${t.maj_le}`;
    if (empreinte === dernier) return;
    dernier = empreinte;
    rappel(t);
    if (t.statut !== 'en_attente' && t.statut !== 'en_cours') arreter();
  };
  const sonder = () => { void lireTravailParId(id).then(emettre).catch(() => undefined); };
  const minuterie = setInterval(sonder, SONDAGE_MS);
  const canal = supabase.channel(`studio-job-${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'studio_jobs', filter: `id=eq.${id}` },
      charge => emettre(lireTravail(charge.new)))
    .subscribe();
  sonder();
  function arreter() {
    if (!actif) return;
    actif = false;
    clearInterval(minuterie);
    void supabase.removeChannel(canal);
  }
  return arreter;
}

/** URL signée (1 h) d'un fichier du bucket privé `studio-rendus` (film ou affiche). */
export async function urlSigneeRendu(chemin: string, dureeS = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_RENDUS).createSignedUrl(chemin, dureeS);
  if (error || !data?.signedUrl) throw new ErreurTravail('Le film n’est pas encore accessible. Réessayez dans un instant.');
  return data.signedUrl;
}

/** Adresse publique d'un fichier d'une visite (`<visite_id>/manifest.json`, `<visite_id>/pano-1.jpg`…). */
export function urlPubliqueVisite(chemin: string): string {
  return supabase.storage.from(BUCKET_VISITES).getPublicUrl(chemin).data.publicUrl;
}
