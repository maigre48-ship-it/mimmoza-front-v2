// src/spaces/copilot/studio3d/usePontCommandesStudio.ts
// =============================================================================
// VIS-45 — branchement du pont « chat Mimmoza → Studio » dans la page MimmozIA (accès Supabase réels).
// Logique : pontCommandesSite.ts (testée). Ici : store du chat, envoi d'un message, dépôt des fichiers, traces.
// =============================================================================
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useCopilotStore } from '../store/copilotStore';
import { persistActionRun } from '../actions/copilotActions';
import type { ActionRun } from '../types/copilot.types';
import { installerPontCommandesSite, type LienFichier, type TraceStudio } from './pontCommandesSite';
import { NOM_ONGLET_CHAT_MIMMOZA, type FichierCompteRendu } from '@/spaces/promoteur/shared/echangeStudio/pontCommandesStudio';

/** Dépôt : bucket privé existant `studio-transfert` (dossier = identifiant de l'utilisateur, politiques en place). */
export const BUCKET_PLANS = 'studio-transfert';
/** Formats acceptés AUJOURD'HUI par le bucket (images, PDF). DXF / IFC / SVG : voir la migration proposée (journal VIS-45). */
const MIMES_ACCEPTES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const DUREE_LIEN_S = 7 * 24 * 3600;

export function cheminPlans(userId: string, conversationId: string, requeteId: string, nom: string): string {
  const sur = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120);
  return `${userId}/plans/${conversationId}/${requeteId}/${sur}`;
}

/** Lien signé (relu à la demande pour un fichier déposé lors d'une session précédente). */
export async function lienSigne(chemin: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_PLANS).createSignedUrl(chemin, DUREE_LIEN_S);
  return error ? null : data?.signedUrl ?? null;
}

export async function deposerFichierStudio(f: FichierCompteRendu, conversationId: string, requeteId: string): Promise<LienFichier> {
  const blob = new Blob([f.octets ?? new ArrayBuffer(0)], { type: f.mime });
  if (!MIMES_ACCEPTES.has(f.mime)) {
    // Repli sans migration : lien local (cette session du navigateur) ; le Studio garde aussi son téléchargement direct.
    return { nom: f.nom, format: f.format, url: URL.createObjectURL(blob), chemin: null, note: 'lien valable pendant cette session (format pas encore accepté par le dépôt en ligne)' };
  }
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('session requise');
  const chemin = cheminPlans(userId, conversationId, requeteId, f.nom);
  const { error } = await supabase.storage.from(BUCKET_PLANS).upload(chemin, blob, { contentType: f.mime, upsert: true });
  if (error) {
    return { nom: f.nom, format: f.format, url: URL.createObjectURL(blob), chemin: null, note: `dépôt refusé (${error.message}) : lien valable pendant cette session` };
  }
  return { nom: f.nom, format: f.format, url: await lienSigne(chemin), chemin, note: null };
}

function ranger(trace: TraceStudio, conversationId: string): void {
  const st = useCopilotStore.getState();
  const run = trace as unknown as ActionRun;
  if (st.currentConversationId === conversationId) st.rememberActionRun(run);
  else void persistActionRun(run, conversationId);
}

/** À monter UNE fois, dans la page MimmozIA. `envoyer` = la saisie du chat (même chemin, même facturation). */
export function usePontCommandesStudio(envoyer: ((texte: string) => unknown) | undefined): void {
  const envoi = useRef(envoyer);
  envoi.current = envoyer;
  useEffect(() => {
    // Le Studio ramène cet onglet au premier plan par son nom (« Revenir au chat Mimmoza »).
    try { if (!window.name) window.name = NOM_ONGLET_CHAT_MIMMOZA; } catch { /* navigateur */ }
    return installerPontCommandesSite({
      conversationCourante: () => useCopilotStore.getState().currentConversationId ?? null,
      messages: () => useCopilotStore.getState().messages,
      traces: () => useCopilotStore.getState().actionRuns,
      enCours: () => useCopilotStore.getState().status === 'streaming',
      envoyer: (t) => { void envoi.current?.(t); },
      ranger,
      deposer: deposerFichierStudio,
      abonner: (f) => {
        let minuterie: ReturnType<typeof setTimeout> | null = null;
        const stop = useCopilotStore.subscribe((s, p) => {
          if (s.messages === p.messages && s.status === p.status && s.currentConversationId === p.currentConversationId && s.actionRuns === p.actionRuns) return;
          if (minuterie) clearTimeout(minuterie);
          minuterie = setTimeout(() => { minuterie = null; f(); }, 500);
        });
        return () => { stop(); if (minuterie) clearTimeout(minuterie); };
      },
    });
  }, []);
}
