// src/spaces/copilot/agent/conception/conceptionApi.ts
// Accès Supabase de la conception (navigateur, rôle « authenticated »).
// Tables agent_conceptions / agent_conception_versions et bucket privé
// agent-conception (migration 20261031_agent_conception.sql). Tant que la
// migration n'est pas appliquée, les erreurs disent « pas encore activée ».
import { supabase } from '@/lib/supabaseClient';
import { ErreurAgent } from '../agentApi';
import { agentNonInstalle, lireMission, messageErreurAgent } from '../agentLogique';
import type { Mission } from '../agent.types';
import {
  BUCKET_CONCEPTION, cheminModele, lireConception, suffixeAleatoire, lireVersion, type BilanVersion, type Conception, type OrigineVersion, type VersionConception,
} from './conceptionLogique';
import type { ControleRegle, MetriquesModele, PrecisionPlan } from '@/spaces/promoteur/shared/echangeStudio/conception';

function lever(err: unknown): never {
  throw new ErreurAgent(messageErreurAgent(err), agentNonInstalle(err));
}

const COLONNES = 'id, mission_id, mission_origine_id, idu, commune, parcelle, regles_plu, programme, plan_source, plan_fichier, statut, version_courante, cree_le, maj_le';

export async function utilisateurId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ErreurAgent('Votre session a expiré. Reconnectez-vous.');
  return data.user.id;
}

export async function listerConceptions(): Promise<Conception[]> {
  const { data, error } = await supabase.from('agent_conceptions').select(COLONNES).neq('statut', 'archive').order('maj_le', { ascending: false }).limit(30);
  if (error) lever(error);
  return ((data ?? []) as unknown[]).map(lireConception).filter((c): c is Conception => c !== null);
}

export async function lireConceptionParId(id: string): Promise<Conception | null> {
  const { data, error } = await supabase.from('agent_conceptions').select(COLONNES).eq('id', id).maybeSingle();
  if (error) lever(error);
  return lireConception(data);
}

export async function listerVersions(conceptionId: string): Promise<VersionConception[]> {
  const { data, error } = await supabase.from('agent_conception_versions')
    .select('id, n, origine, resume, metriques, conformite, bilan, modele_ref, cree_le')
    .eq('conception_id', conceptionId).order('n', { ascending: false }).limit(50);
  if (error) lever(error);
  return ((data ?? []) as unknown[]).map(lireVersion).filter((v): v is VersionConception => v !== null);
}

/** Rapport de la mission de prospection d'origine (hypothèses du bilan). */
export async function lireMissionOrigine(id: string | null): Promise<Mission | null> {
  if (!id) return null;
  const { data, error } = await supabase.from('agent_missions')
    .select('id, projet_id, conversation_id, origine, type, objectif, statut, devis, jetons_reserves, jetons_consommes, etapes_faites, etapes_max, question_en_attente, rapport, criteres, erreur, cree_le, maj_le, termine_le')
    .eq('id', id).maybeSingle();
  if (error) lever(error);
  return lireMission(data);
}

export async function choisirVoiePlan(conceptionId: string, voie: PrecisionPlan, planFichier: string | null): Promise<void> {
  // Jamais de désarchivage depuis l'interface : une conception archivée n'est pas modifiée.
  const { data, error } = await supabase.from('agent_conceptions')
    .update({ plan_source: voie, plan_fichier: planFichier, statut: 'modele' }).eq('id', conceptionId).neq('statut', 'archive').select('id');
  if (error) lever(error);
  if (!data?.length) throw new ErreurAgent('Ce projet est archivé : il ne peut plus être modifié.');
}

let disponibilite: Promise<boolean> | null = null;
/**
 * La conception est-elle installée en base ? (ordre de déploiement moteur → front :
 * tant que la table n'existe pas, on ne propose pas « Concevoir le projet »).
 * Une erreur réseau ne tranche pas (on réessaiera au prochain affichage).
 */
export function conceptionDisponible(): Promise<boolean> {
  disponibilite ??= (async () => {
    const { error } = await supabase.from('agent_conceptions').select('id', { head: true, count: 'exact' }).limit(1);
    if (!error) return true;
    if (agentNonInstalle(error)) return false;
    disponibilite = null;
    return false;
  })();
  return disponibilite;
}

export async function deposerFichier(chemin: string, fichier: Blob, type: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET_CONCEPTION).upload(chemin, fichier, { contentType: type, upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new ErreurAgent("Le dépôt de fichiers n'est pas encore activé. Réessayez un peu plus tard.", true);
    throw new ErreurAgent('Le fichier n’a pas pu être envoyé. Réessayez.');
  }
}

export async function urlSignee(chemin: string, secondes = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_CONCEPTION).createSignedUrl(chemin, secondes);
  return error ? null : data?.signedUrl ?? null;
}

export interface NouvelleVersion {
  conception: Conception;
  origine: OrigineVersion;
  resume: string;
  metriques: MetriquesModele;
  conformite: ControleRegle[];
  bilan: BilanVersion;
  modele: Record<string, unknown>;
}

async function versionCourante(conceptionId: string): Promise<number> {
  const { data, error } = await supabase.from('agent_conceptions').select('version_courante').eq('id', conceptionId).maybeSingle();
  if (error) lever(error);
  return Math.max(0, Number((data as { version_courante?: number } | null)?.version_courante ?? 0));
}

/**
 * Enregistre une version : modèle dans le bucket (modele-v<n>-<8 hex>.mstudio.json,
 * jamais remplacé), puis ligne de version (immuable). n = version_courante + 1,
 * relue juste avant ; si une autre version passe entre-temps (23505), on relit
 * et on réessaie (3 fois au plus). La base tient version_courante elle-même.
 */
export async function enregistrerVersion(v: NouvelleVersion): Promise<VersionConception> {
  const uid = await utilisateurId();
  const json = JSON.stringify(v.modele);
  for (let essai = 0; essai < 3; essai++) {
    const n = (await versionCourante(v.conception.id)) + 1;
    // Nom unique à chaque essai : la version référence EXACTEMENT le fichier envoyé.
    const chemin = cheminModele(uid, v.conception.id, n, suffixeAleatoire());
    const { error: eDepot } = await supabase.storage.from(BUCKET_CONCEPTION).upload(chemin, new Blob([json], { type: 'application/json' }), { contentType: 'application/json', upsert: false });
    if (eDepot) {
      if (/bucket not found/i.test(eDepot.message)) throw new ErreurAgent("Le dépôt de fichiers n'est pas encore activé. Réessayez un peu plus tard.", true);
      throw new ErreurAgent('Le modèle n’a pas pu être envoyé. Réessayez.');
    }
    const { data, error } = await supabase.from('agent_conception_versions').insert({
      conception_id: v.conception.id, user_id: uid, n, origine: v.origine, resume: v.resume.slice(0, 1000),
      metriques: v.metriques, conformite: v.conformite, bilan: v.bilan, modele_ref: chemin,
    }).select('id, n, origine, resume, metriques, conformite, bilan, modele_ref, cree_le').single();
    if (error?.code === '23505') continue;
    if (error) lever(error);
    const lu = lireVersion(data);
    if (!lu) throw new ErreurAgent('La version n’a pas été confirmée.');
    return lu;
  }
  throw new ErreurAgent('D’autres versions sont enregistrées en même temps. Réessayez dans un instant.');
}
