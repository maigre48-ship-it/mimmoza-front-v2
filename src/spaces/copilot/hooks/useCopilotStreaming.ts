// src/spaces/copilot/hooks/useCopilotStreaming.ts
import {
  CopilotClientError,
  fetchRecentAssistantReplies,
  streamCopilotChat,
} from '../lib/copilotClient';
import { useCopilotStore } from '../store/copilotStore';
import {
  DELAIS_RELECTURE_MS,
  MESSAGES_REPRISE,
  choisirReponseServeur,
  deciderReprise,
  messageDeSuite,
  reponseComplete,
} from '../store/repriseFlux';
import type { CopilotChatRequest } from '../types/copilot.types';
import { track } from '@/lib/mimmozia/track';
import { signalerErreur } from '@/lib/monitoring';

/**
 * Journalise l'appel d'un outil copilot pour l'apprentissage MimmozIA.
 * Observe le flux SSE sans le perturber : fire-and-forget, opt-out géré dans
 * track(), et jamais d'exception propagée (appelé sous try/catch dans onEvent).
 *
 * On ne journalise que le DÉBUT d'un appel outil (pas son résultat) pour ne pas
 * compter deux fois. Les arguments de l'outil portent souvent l'insee/la ville
 * → signal géographique fort pour v_user_profile.
 */
function maybeTrackToolCall(event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const e = event as Record<string, unknown>;
  const type = String(e.type ?? e.event ?? '');

  const isToolStart =
    type === 'tool_call' ||
    type === 'tool_use' ||
    type === 'tool_start' ||
    type === 'tool' ||
    type === 'tool.start';
  if (!isToolStart) return;

  const data = (e.data ?? {}) as Record<string, unknown>;
  const tool =
    (e.tool ?? e.name ?? e.tool_name ?? data.tool ?? data.name) as string | undefined;
  if (!tool) return;

  const args =
    (e.input ?? e.args ?? e.arguments ?? data.input ?? data.args ?? {}) as Record<string, unknown>;
  const insee = (args.insee ?? args.code_insee ?? args.commune_insee) as string | undefined;
  const city = (args.city ?? args.commune ?? args.ville) as string | undefined;

  void track('tool_call', { tool, insee, city });
}

const attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------
// Moteur de flux — au niveau du module, partagé par toutes les surfaces (page
// MimmozIA, tiroir) : il n'y a qu'un store, donc qu'une réponse en cours.
//
// Une réponse n'est JAMAIS laissée tronquée en apparence complète :
//   · coupure côté navigateur → la réponse finale est relue en base (le serveur
//     va au bout et la persiste, facturée une seule fois) ;
//   · partiel persisté par le serveur (échéance, erreur modèle) → UNE demande
//     de suite, facturée pour la seule suite ;
//   · sinon → réponse marquée incomplète, reprenable par `resume`.
// -----------------------------------------------------------------------------

let abortCourant: AbortController | null = null;
// Dernière requête complète : sert de modèle (mode, niveau, contexte) aux
// demandes de suite.
let derniereRequete: CopilotChatRequest | null = null;

const actif = (requestId: string) => useCopilotStore.getState().activeRequestId === requestId;

/** Relit en base la réponse d'une requête dont le flux s'est coupé. */
async function relireServeur(
  requestId: string, conversationId: string, departMs: number, dejaRepris: boolean,
): Promise<void> {
  for (const delai of DELAIS_RELECTURE_MS) {
    await attendre(delai);
    if (!actif(requestId)) return; // l'utilisateur a arrêté ou changé de conversation
    let lignes;
    try {
      lignes = await fetchRecentAssistantReplies(conversationId);
    } catch {
      continue; // réseau encore instable : on retente au prochain délai
    }
    const st = useCopilotStore.getState();
    const cibleId = st.streamingId;
    if (!cibleId || !actif(requestId)) return;
    const connus = new Set(st.messages.filter((m) => m.id !== cibleId).map((m) => m.id));
    const reponse = choisirReponseServeur(lignes, connus, departMs);
    if (!reponse) continue;

    const complete = reponseComplete(reponse);
    st.adoptServerReply(cibleId, { id: reponse.id, text: reponse.text, complete });
    if (complete) {
      void useCopilotStore.getState().refreshCredits?.();
      return;
    }
    if (!dejaRepris) await demanderSuite(reponse.id);
    return;
  }
  const cibleId = useCopilotStore.getState().streamingId;
  if (cibleId && actif(requestId)) {
    useCopilotStore.getState().markIncomplete(cibleId, MESSAGES_REPRISE.coupureIrrecuperable);
    void signalerErreur({
      source: 'copilot', message: 'flux copilote coupé, réponse introuvable en base après relecture',
      context: { etape: 'relecture', duree_ms: Date.now() - departMs },
    });
  }
}

/** Demande UNE suite pour la réponse `cibleId` (partiel persisté côté serveur). */
async function demanderSuite(cibleId: string): Promise<void> {
  const st = useCopilotStore.getState();
  const conversationId = st.currentConversationId;
  const modele = derniereRequete;
  if (!conversationId) return;
  const requestId = st.beginContinuation(cibleId);
  if (!requestId) return;
  await demarrer({
    conversation_id: conversationId,
    message: messageDeSuite(),
    mode: modele?.mode ?? st.mode,
    tier: modele?.tier ?? st.tier,
    context: modele?.context ?? ({} as CopilotChatRequest['context']),
  }, requestId, { dejaRepris: true });
  // La suite elle-même a échoué : la réponse reste incomplète, et le dit.
  const apres = useCopilotStore.getState();
  const m = apres.messages.find((x) => x.id === cibleId || (apres.streamingId != null && x.id === apres.streamingId));
  if (m && m.status === 'error') apres.markIncomplete(m.id, MESSAGES_REPRISE.suiteEchouee);
}

async function demarrer(
  request: CopilotChatRequest,
  requestId: string,
  options?: { dejaRepris?: boolean },
): Promise<void> {
  abortCourant?.abort();
  const ac = new AbortController();
  abortCourant = ac;
  if (!options?.dejaRepris) derniereRequete = request;

  const departMs = Date.now();
  const suivi = {
    terminal: null as 'done' | 'error' | null,
    partielPersiste: false,
    messageIdPartiel: null as string | null,
    erreur: null as string | null,
    conversationId: request.conversation_id ?? null,
    recu: false,
  };

  try {
    await streamCopilotChat({
      request,
      signal: ac.signal,
      onEvent: (event) => {
        // Un ancien flux peut encore livrer des événements après son annulation.
        if (ac.signal.aborted || !actif(requestId)) return;
        suivi.recu = true;
        if (event.type === 'conversation') suivi.conversationId = event.conversation_id;
        if (event.type === 'done') suivi.terminal = 'done';
        if (event.type === 'error') {
          suivi.terminal = 'error';
          suivi.erreur = event.error;
          suivi.partielPersiste = Boolean(event.message_id);
          suivi.messageIdPartiel = event.message_id ?? null;
        }
        try { maybeTrackToolCall(event); } catch { /* silencieux par conception */ }
        useCopilotStore.getState().handleStreamEvent(event, requestId);
      },
    });
  } catch (err) {
    if (ac.signal.aborted) return; // annulation utilisateur → déjà géré
    const message = err instanceof CopilotClientError
      ? err.message
      : err instanceof Error ? err.message : 'Erreur inconnue';
    if (!suivi.recu) {
      // Échec AVANT le flux (HTTP 4xx/5xx, session…) : rien à reprendre.
      useCopilotStore.getState().failStreaming(message, requestId);
      return;
    }
    // Coupure EN COURS de flux : traitée plus bas comme une fin sans `done`.
    void signalerErreur({ source: 'copilot', message: `flux copilote coupé : ${message}`, context: { etape: 'flux', duree_ms: Date.now() - departMs } });
  } finally {
    if (abortCourant === ac) abortCourant = null;
  }

  // Après `done` ou `error`, le store a déjà libéré la requête : seul le cas
  // `error` peut encore appeler une suite.
  if (ac.signal.aborted || (!actif(requestId) && suivi.terminal !== 'error')) return;

  if (suivi.terminal === 'error') {
    void signalerErreur({
      source: 'copilot', message: `réponse interrompue côté serveur : ${suivi.erreur ?? ''}`,
      context: { etape: 'serveur', partiel: suivi.partielPersiste, duree_ms: Date.now() - departMs, suite: Boolean(options?.dejaRepris) },
    });
  }

  const decision = deciderReprise({
    terminal: suivi.terminal,
    partielPersiste: suivi.partielPersiste,
    erreur: suivi.erreur,
    annuleParUtilisateur: false,
    conversationId: suivi.conversationId,
    dejaRepris: Boolean(options?.dejaRepris),
  });

  switch (decision) {
    case 'rien':
      return;
    case 'demander_suite':
      if (suivi.messageIdPartiel) await demanderSuite(suivi.messageIdPartiel);
      return;
    case 'relire_serveur':
      if (!suivi.terminal) {
        void signalerErreur({ source: 'copilot', message: 'flux copilote terminé sans fin de réponse', context: { etape: 'flux', duree_ms: Date.now() - departMs } });
      }
      await relireServeur(requestId, suivi.conversationId!, departMs, Boolean(options?.dejaRepris));
      return;
    case 'echec': {
      const cibleId = useCopilotStore.getState().streamingId;
      if (cibleId) useCopilotStore.getState().markIncomplete(cibleId, MESSAGES_REPRISE.coupureIrrecuperable);
      return;
    }
  }
}

function annuler(): void {
  abortCourant?.abort();
  useCopilotStore.getState().cancelStreaming();
}

/**
 * « Reprendre » une réponse incomplète : on relit d'abord la base (réponse
 * arrêtée ou coupée que le serveur a terminée — aucun coût) ; si le serveur
 * n'a persisté qu'un partiel, on en demande la suite.
 */
async function reprendre(messageId: string): Promise<void> {
  const st = useCopilotStore.getState();
  const conversationId = st.currentConversationId;
  if (!conversationId || st.status === 'streaming') return;
  const cible = st.messages.find((m) => m.id === messageId && m.role === 'assistant');
  if (!cible) return;
  const requestId = st.markRecovering(messageId);
  if (!requestId) return;
  const depart = Number.isFinite(Date.parse(cible.createdAt)) ? Date.parse(cible.createdAt) : Date.now();

  try {
    const lignes = await fetchRecentAssistantReplies(conversationId);
    const courant = useCopilotStore.getState();
    const connus = new Set(courant.messages.filter((m) => m.id !== messageId).map((m) => m.id));
    const reponse = choisirReponseServeur(lignes, connus, depart);
    if (reponse) {
      const complete = reponseComplete(reponse);
      courant.adoptServerReply(messageId, { id: reponse.id, text: reponse.text, complete });
      if (!complete) await demanderSuite(reponse.id);
      return;
    }
  } catch { /* on retombe sur la relecture espacée */ }

  // Rien encore en base : le serveur termine peut-être la réponse.
  await relireServeur(requestId, conversationId, depart, false);
}

export function useCopilotStreaming() {
  return { start: demarrer, cancel: annuler, resume: reprendre };
}
