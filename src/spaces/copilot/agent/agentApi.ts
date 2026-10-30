// src/spaces/copilot/agent/agentApi.ts
// =============================================================================
// Accès Supabase de l'agent autonome (navigateur, rôle « authenticated »).
// Contrat : migration 20261030_agent_autonome.sql.
//   · lecture : SELECT direct sur les tables (RLS = propriétaire seulement) ;
//   · écriture : uniquement par les RPC prévues, sauf la mémoire du projet
//     (UPDATE contenu / epingle / confiance, DELETE) ;
//   · envoi d'une action validée : Edge Function agent-action-envoyer-v1.
// Toutes les fonctions lèvent une `ErreurAgent` au message déjà lisible.
// =============================================================================

import { supabase } from '@/lib/supabaseClient';
import type {
  ActionExterne, Briefing, ElementMemoire, LigneJournal, Mission, PreferencesProactif,
} from './agent.types';
import {
  agentNonInstalle, bornerBudget, consommeCeMois, lireAction, lireBriefing, lireIssueEnvoi,
  lireLigneJournal, lireMemoire, lireMission, messageErreurAgent, type IssueEnvoi,
} from './agentLogique';

export class ErreurAgent extends Error {
  readonly nonInstalle: boolean;
  constructor(message: string, nonInstalle = false) {
    super(message);
    this.name = 'ErreurAgent';
    this.nonInstalle = nonInstalle;
  }
}

function lever(err: unknown): never {
  throw new ErreurAgent(messageErreurAgent(err), agentNonInstalle(err));
}

const COLONNES_MISSION =
  'id, projet_id, conversation_id, origine, type, objectif, statut, devis, jetons_reserves, jetons_consommes, ' +
  'etapes_faites, etapes_max, question_en_attente, rapport, erreur, cree_le, maj_le, termine_le';

// ── Missions ─────────────────────────────────────────────────────────────────

export async function listerMissions(limite = 30): Promise<Mission[]> {
  const { data, error } = await supabase
    .from('agent_missions').select(COLONNES_MISSION)
    .order('cree_le', { ascending: false }).limit(limite);
  if (error) lever(error);
  return ((data ?? []) as unknown[]).map(lireMission).filter((m): m is Mission => m !== null);
}

export async function lireMissionParId(id: string): Promise<Mission | null> {
  const { data, error } = await supabase
    .from('agent_missions').select(COLONNES_MISSION).eq('id', id).maybeSingle();
  if (error) lever(error);
  return lireMission(data);
}

export async function lireJournal(missionId: string, limite = 300): Promise<LigneJournal[]> {
  const { data, error } = await supabase
    .from('agent_mission_journal').select('id, n, genre, outil, resume, jetons, cree_le')
    .eq('mission_id', missionId).order('n', { ascending: true }).order('id', { ascending: true }).limit(limite);
  if (error) lever(error);
  return ((data ?? []) as unknown[]).map(lireLigneJournal).filter((l): l is LigneJournal => l !== null);
}

export async function validerDevis(id: string): Promise<Mission | null> {
  const { data, error } = await supabase.rpc('agent_mission_valider_devis', { p_id: id });
  if (error) lever(error);
  return lireMission(data);
}

export async function repondreMission(id: string, reponse: string): Promise<Mission | null> {
  const { data, error } = await supabase.rpc('agent_mission_repondre', { p_id: id, p_reponse: reponse });
  if (error) lever(error);
  return lireMission(data);
}

export async function annulerMission(id: string): Promise<Mission | null> {
  const { data, error } = await supabase.rpc('agent_mission_annuler', { p_id: id });
  if (error) lever(error);
  return lireMission(data);
}

/**
 * Suivi en temps réel d'une mission (Realtime sur la mission et son journal).
 * `surChangement` est appelé à chaque modification ; l'appelant relit alors
 * les données. Renvoie la fonction de désabonnement.
 */
export function suivreMission(missionId: string, surChangement: () => void): () => void {
  try {
    const canal = supabase
      .channel(`agent-mission-${missionId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_mission_journal', filter: `mission_id=eq.${missionId}` }, surChangement)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_missions', filter: `id=eq.${missionId}` }, surChangement)
      .subscribe();
    return () => { void supabase.removeChannel(canal); };
  } catch {
    return () => undefined;
  }
}

// ── Actions externes ─────────────────────────────────────────────────────────

export async function listerActions(): Promise<ActionExterne[]> {
  const { data, error } = await supabase
    .from('agent_actions_externes')
    .select('id, mission_id, projet_id, canal, destinataire, objet, corps, statut, erreur, cree_le, envoye_le')
    .order('cree_le', { ascending: false }).limit(60);
  if (error) lever(error);
  return ((data ?? []) as unknown[]).map(lireAction).filter((a): a is ActionExterne => a !== null);
}

export async function compterActionsAValider(): Promise<number> {
  const { count, error } = await supabase
    .from('agent_actions_externes').select('id', { count: 'exact', head: true })
    .in('statut', ['brouillon', 'echec']);
  if (error) lever(error);
  return count ?? 0;
}

export async function validerAction(id: string, objet: string, corps: string): Promise<ActionExterne | null> {
  const { data, error } = await supabase.rpc('agent_action_valider', { p_id: id, p_objet: objet, p_corps: corps });
  if (error) lever(error);
  return lireAction(data);
}

export async function refuserAction(id: string): Promise<void> {
  const { error } = await supabase.rpc('agent_action_refuser', { p_id: id });
  if (error) lever(error);
}

/** Envoi d'une action DÉJÀ validée. Ne lève pas : renvoie l'issue lisible. */
export async function envoyerAction(id: string): Promise<IssueEnvoi> {
  try {
    const { data, error } = await supabase.functions.invoke('agent-action-envoyer-v1', {
      body: { action_id: id, id },
    });
    if (error) {
      // Une réponse HTTP d'erreur porte souvent un corps JSON lisible.
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      if (ctx?.json) {
        try { return lireIssueEnvoi(await ctx.json()); } catch { /* corps illisible */ }
      }
      return { genre: 'echec', message: messageErreurAgent(error) };
    }
    return lireIssueEnvoi(data);
  } catch (e) {
    return { genre: 'echec', message: messageErreurAgent(e) };
  }
}

// ── Mémoire du projet ────────────────────────────────────────────────────────

export async function listerMemoire(): Promise<ElementMemoire[]> {
  const { data, error } = await supabase
    .from('agent_memoire_projet')
    .select('id, projet_id, mission_id, genre, cle, contenu, source, confiance, epingle, cree_le, maj_le')
    .order('maj_le', { ascending: false }).limit(300);
  if (error) lever(error);
  return ((data ?? []) as unknown[]).map(lireMemoire).filter((m): m is ElementMemoire => m !== null);
}

export async function modifierMemoire(
  id: string, champs: Partial<Pick<ElementMemoire, 'contenu' | 'epingle' | 'confiance'>>,
): Promise<void> {
  const { error } = await supabase.from('agent_memoire_projet').update(champs).eq('id', id);
  if (error) lever(error);
}

export async function supprimerMemoire(id: string): Promise<void> {
  const { error } = await supabase.from('agent_memoire_projet').delete().eq('id', id);
  if (error) lever(error);
}

/** Noms des projets (table `projects`) ; une erreur de lecture renvoie une table vide. */
export async function nomsProjets(ids: string[]): Promise<Record<string, string>> {
  const uniques = [...new Set(ids.filter(Boolean))];
  if (uniques.length === 0) return {};
  const { data, error } = await supabase.from('projects').select('id, name').in('id', uniques);
  if (error || !data) return {};
  const res: Record<string, string> = {};
  for (const r of data as { id: string; name: string | null }[]) if (r.name) res[r.id] = r.name;
  return res;
}

// ── Briefings ────────────────────────────────────────────────────────────────

export async function dernierBriefingNonLu(): Promise<Briefing | null> {
  const { data, error } = await supabase
    .from('agent_briefings').select('id, titre, resume, elements, lu, cree_le, mission_id')
    .eq('lu', false).order('cree_le', { ascending: false }).limit(1).maybeSingle();
  if (error) lever(error);
  return lireBriefing(data);
}

export async function marquerBriefingLu(id: string): Promise<void> {
  const { error } = await supabase.rpc('agent_briefing_marquer_lu', { p_id: id });
  if (error) lever(error);
}

// ── Veille proactive ─────────────────────────────────────────────────────────

export async function lirePreferencesProactif(): Promise<PreferencesProactif> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new ErreurAgent('Votre session a expiré. Reconnectez-vous.');
  const { data, error } = await supabase
    .from('user_ai_preferences')
    .select('learning_enabled, proactif_actif, budget_proactif_mensuel, proactif_consomme_mois, proactif_mois')
    .eq('user_id', uid).maybeSingle();
  if (error) lever(error);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    proactif_actif: r.proactif_actif === true,
    budget_proactif_mensuel: bornerBudget(Number(r.budget_proactif_mensuel ?? 0)),
    proactif_consomme_mois: consommeCeMois(r.proactif_consomme_mois, r.proactif_mois),
    // Ligne absente = apprentissage actif par défaut (cf. track.ts).
    learning_enabled: r.learning_enabled !== false,
  };
}

export async function enregistrerPreferencesProactif(actif: boolean, budget: number): Promise<PreferencesProactif> {
  const { data, error } = await supabase.rpc('agent_preferences_proactif', { p_actif: actif, p_budget: bornerBudget(budget) });
  if (error) lever(error);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    proactif_actif: r.actif === true,
    budget_proactif_mensuel: bornerBudget(Number(r.budget_mensuel ?? budget)),
    proactif_consomme_mois: Math.max(0, Number(r.consomme_mois ?? 0) || 0),
    learning_enabled: r.learning_enabled !== false,
  };
}
