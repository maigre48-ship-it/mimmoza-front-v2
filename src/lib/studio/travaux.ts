// src/lib/studio/travaux.ts
//
// FILM, VISITE 360° OU IMAGE PHOTORÉALISTE EN 3 CLICS — service de la file `studio_jobs`.
//
// Créer, annuler, lister et suivre un travail ; URL signée du film ou de l'image
// (bucket privé `studio-rendus`) ; adresse publique du manifeste d'une visite (bucket
// public `visites`). Si la migration n'est pas encore appliquée, les fonctions
// renvoient `{ disponible: false }` au lieu de lever : l'interface affiche
// « Bientôt disponible ».
// La logique pure (construction, validation, libellés) est dans
// travauxLogique.ts ; les types du manifeste dans manifesteVisite.ts.

import { supabase } from '@/lib/supabaseClient';
import { fileIndisponible, lireTravail, messageErreurTravail, type NouveauTravail, type TravailStudio } from './travauxLogique';
// LOT P2 (11/11/2026) — image dans sa rue : couverture Panoramax (fonction en lecture seule), photo du client.
import { lireCouvertureTransmise, type CouverturePhotoRue, type LonLat } from './couverturePhotoRue';
import { cheminPhotoClient } from './photoClientLogique';
// LOT P5-SITE (12/11/2026) — zone à effacer corrigée dans l'atelier : même seau privé que la photo du client.
import { cheminMasqueExistant, OCTETS_MAX_MASQUE, type MasqueExistantOption } from './masqueExistant';
import { deposerDansBucket } from '@/spaces/copilot/pieces-jointes/televersement';

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
  if (!userId) throw new ErreurTravail('Connectez-vous pour lancer un rendu.');
  const { data, error } = await supabase.from('studio_jobs')
    .insert({ ...travail, user_id: userId })
    .select(COLONNES).single();
  if (error) {
    if (fileIndisponible(error)) return { disponible: false };
    throw new ErreurTravail(messageErreurTravail(error, travail.type));
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

/** Options du suivi (LOT E1-suivi : carte du chat). */
export interface OptionsSuivi {
  /** Intervalle du sondage de secours (5 s par défaut). */
  sondageMs?: number;
  /** Appelé quand la ligne n'est pas (ou plus) lisible : supprimée ou invisible (RLS). Le suivi s'arrête. */
  surAbsent?: () => void;
}

/**
 * Suit un travail en direct : abonnement temps réel sur la ligne + sondage
 * toutes les 5 s (filet de sécurité si le temps réel est coupé). Le rappel
 * reçoit chaque nouvel état ; le suivi s'arrête de lui-même quand le travail
 * est terminé, en échec ou annulé. Renvoie la fonction d'arrêt.
 * Chaque suivi a son propre canal : supabase.channel() renvoie le canal EXISTANT
 * quand le nom est déjà pris (realtime-js 2.112) — deux suivis du même travail
 * (carte du chat + Dossier 3D) partageaient alors un canal, et le premier arrêté
 * coupait le temps réel de l'autre.
 */
export function suivreTravail(id: string, rappel: (travail: TravailStudio) => void, options: OptionsSuivi = {}): () => void {
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
  const sonder = () => {
    void lireTravailParId(id).then((t) => {
      if (actif && !t && options.surAbsent) { options.surAbsent(); arreter(); return; }
      emettre(t);
    }).catch(() => undefined);
  };
  const minuterie = setInterval(sonder, options.sondageMs ?? SONDAGE_MS);
  const canal = supabase.channel(`studio-job-${id}-${Math.random().toString(36).slice(2, 10)}`)
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

/** URL signée (1 h) d'un fichier du bucket privé `studio-rendus` (film, affiche ou image). `telecharger` : nom du fichier proposé au téléchargement. */
export async function urlSigneeRendu(chemin: string, dureeS = 3600, telecharger?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_RENDUS).createSignedUrl(chemin, dureeS, telecharger ? { download: telecharger } : undefined);
  if (error || !data?.signedUrl) throw new ErreurTravail('Le fichier n’est pas encore accessible. Réessayez dans un instant.');
  return data.signedUrl;
}

/** Adresse publique d'un fichier d'une visite (`<visite_id>/manifest.json`, `<visite_id>/pano-1.jpg`…). */
export function urlPubliqueVisite(chemin: string): string {
  return supabase.storage.from(BUCKET_VISITES).getPublicUrl(chemin).data.publicUrl;
}

// ── LOT P2 (11/11/2026) — image dans sa rue ──────────────────────────────────

/** Seau PRIVÉ des photos du client (20 Mo, jpeg/png) : `<auth.uid()>/<uuid>.jpg`, politiques par propriétaire. */
export const BUCKET_PHOTO_CLIENT = 'studio-transfert';

/**
 * Fiche et options d'un travail de l'utilisateur (RLS : ses lignes seulement), pour créer un travail identique
 * avec le calage validé dans l'atelier. null si la ligne n'est pas lisible.
 */
export async function lireFicheTravail(id: string): Promise<{ type: string; conversation_id: string | null; fiche: unknown; options: unknown } | null> {
  const { data, error } = await supabase.from('studio_jobs').select('type,conversation_id,fiche,options').eq('id', id).maybeSingle();
  if (error) throw new ErreurTravail(messageErreurTravail(error));
  return data ? { type: String(data.type), conversation_id: (data.conversation_id as string | null) ?? null, fiche: data.fiche, options: data.options } : null;
}

/**
 * Couverture Panoramax (instance IGN, Licence Ouverte) autour d'un contour, par la fonction en lecture seule
 * `photo-rue-couverture` (l'appel direct depuis le navigateur dépendrait des en-têtes CORS de l'IGN, non vérifiés).
 */
export async function demanderCouverturePhotoRue(contour: readonly LonLat[]): Promise<{ ok: true; couverture: CouverturePhotoRue } | { ok: false; raison: string }> {
  const { data, error } = await supabase.functions.invoke('photo-rue-couverture', { body: { contour } });
  if (error) return { ok: false, raison: 'La vérification des photos de rue n’a pas abouti. Réessayez dans un instant.' };
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok === false) return { ok: false, raison: typeof d.raison === 'string' ? d.raison : 'Couverture non vérifiée.' };
  const c = lireCouvertureTransmise(d.couverture);
  return c ? { ok: true, couverture: c } : { ok: false, raison: 'Réponse illisible : couverture non vérifiée.' };
}

/**
 * Téléverse la photo du client TELLE QUELLE (fichier d'origine, EXIF compris, aucune recompression) dans
 * `studio-transfert/<uid>/<uuid>.jpg|png`. À n'appeler qu'APRÈS le consentement explicite de l'utilisateur.
 * Au-delà de 6 Mo : envoi reprenable (TUS), comme les pièces jointes.
 */
export async function televerserPhotoClient(fichier: File, surProgres?: (envoye: number, total: number) => void): Promise<{ chemin: string; octets: number }> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ErreurTravail('Connectez-vous pour envoyer votre photo.');
  const chemin = cheminPhotoClient(data.user.id, crypto.randomUUID(), fichier.type);
  if (!chemin) throw new ErreurTravail('Format non pris en charge : JPEG ou PNG.');
  await deposerDansBucket(BUCKET_PHOTO_CLIENT, chemin, fichier, fichier.type, surProgres);
  return { chemin, octets: fichier.size };
}

// ── LOT P5-SITE (12/11/2026) — effacement de l'existant ──────────────────────────────────────────

/**
 * Dépose la zone à effacer corrigée dans l'atelier (PNG relu par `lireMessageMasqueExistant`) dans
 * `studio-transfert/<uid>/<uuid>.png`, AVANT la création du nouveau travail (option `masque_existant`) : la machine
 * de rendu ne peut donc jamais prendre le travail sans son masque. Seau et politiques de la photo du client
 * (écriture et lecture par le propriétaire seulement) ; aucune clé de service côté site.
 */
export async function televerserMasqueExistant(png: Uint8Array): Promise<MasqueExistantOption> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ErreurTravail('Connectez-vous pour lancer un rendu.');
  if (png.length < 1 || png.length > OCTETS_MAX_MASQUE) throw new ErreurTravail('La zone à effacer est trop volumineuse : reprenez-la dans l’atelier.');
  const chemin = cheminMasqueExistant(data.user.id, crypto.randomUUID());
  if (!chemin) throw new ErreurTravail('Compte non reconnu : reconnectez-vous.');
  const copie = new Uint8Array(png);
  await deposerDansBucket(BUCKET_PHOTO_CLIENT, chemin, new Blob([copie.buffer], { type: 'image/png' }), 'image/png');
  return { chemin, octets: png.length };
}

/** Retire une zone à effacer déposée pour un travail qui n'a finalement pas été créé (au mieux : jamais d'erreur). */
export async function retirerMasqueExistant(chemin: string): Promise<void> {
  try { await supabase.storage.from(BUCKET_PHOTO_CLIENT).remove([chemin]); } catch { /* le dépôt reste privé ; sans effet sur le rendu */ }
}
