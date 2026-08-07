// ============================================================================
// Actions du copilote — le chat propose, le front exécute.
//
// Choix d'architecture : l'Edge Function reste STRICTEMENT en lecture. Les
// outils d'action ne mutent rien côté serveur ; ils renvoient une *proposition*
// que le front exécute avec la session de l'utilisateur. Trois bénéfices :
//   · les écritures passent par RLS, jamais par une clé service_role ;
//   · la provenance (user / agent) est connue au moment de l'écriture ;
//   · le copilote reste inoffensif s'il hallucine — rien ne part sans passage
//     par cet exécuteur, qui valide la forme de l'action.
//
// Le calcul métier n'est JAMAIS refait ici : `run_step` ouvre la page de
// l'étape, qui reste l'unique implémentation du calcul. Le chat orchestre,
// il ne recalcule pas.
// ============================================================================

import { supabase } from '@/lib/supabase';
import { PromoteurStudyService } from '@/spaces/promoteur/shared/promoteurStudyService';
import { setStepStatus, type PromoteurStep } from '@/spaces/promoteur/shared/promoteurChain';
import {
  getActiveStudyId as getPromoteurActiveStudyId,
  setActiveStudyId as setPromoteurActiveStudyId,
} from '@/spaces/promoteur/shared/promoteurSnapshot.store';
import type { ActionOutcome, ActionRun } from '../types/copilot.types';

export type CopilotActionKind = 'open_page' | 'create_operation' | 'run_step';

export interface CopilotAction {
  kind: CopilotActionKind;
  /** Phrase affichée sur le bouton de confirmation. */
  label: string;
  /** Ce que l'action va faire, en clair. Obligatoire : l'utilisateur confirme
   *  ce qu'il lit, pas un nom d'outil. */
  summary: string;
  params: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Route vers laquelle naviguer après exécution. */
  navigateTo?: string;
  studyId?: string;
}

// ── Autonomie ───────────────────────────────────────────────────────────────
// Un seul réglage sépare « piloter » d'« agent autonome » : qui confirme.
// En `auto`, l'exécuteur enchaîne sans demander — sauf pour les actions
// marquées comme point d'arbitrage (décision métier, pas technique).

export type AutonomyMode = 'confirm_each' | 'auto';
const AUTONOMY_KEY = 'mzia.autonomy';

export function getAutonomy(): AutonomyMode {
  try {
    return localStorage.getItem(AUTONOMY_KEY) === 'auto' ? 'auto' : 'confirm_each';
  } catch {
    return 'confirm_each';
  }
}

export function setAutonomy(mode: AutonomyMode): void {
  try { localStorage.setItem(AUTONOMY_KEY, mode); } catch { /* noop */ }
}

/** Actions qui restent confirmées même en mode autonome. */
const ALWAYS_CONFIRM: CopilotActionKind[] = [];

export function needsConfirmation(action: CopilotAction): boolean {
  if (getAutonomy() === 'confirm_each') return true;
  return ALWAYS_CONFIRM.includes(action.kind);
}

// ── Extraction depuis un tool call ──────────────────────────────────────────

const ACTION_TOOLS = new Set(['action_ouvrir_page', 'action_creer_operation', 'action_lancer_etape']);

export function isActionTool(name: string): boolean {
  return ACTION_TOOLS.has(name);
}

/** Lit l'action proposée dans la sortie d'un tool call, en validant sa forme. */
export function readAction(output: unknown): CopilotAction | null {
  const data = (output as { data?: unknown } | null)?.data ?? output;
  const a = (data as { action?: unknown } | null)?.action;
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !['open_page', 'create_operation', 'run_step'].includes(o.kind)) {
    return null;
  }
  return {
    kind: o.kind as CopilotActionKind,
    label: typeof o.label === 'string' ? o.label : 'Exécuter',
    summary: typeof o.summary === 'string' ? o.summary : '',
    params: (o.params && typeof o.params === 'object' ? o.params : {}) as Record<string, unknown>,
  };
}

// ── Trace d'exécution ───────────────────────────────────────────────────────
// `copilot_tool_calls` n'enregistre que ce que le modèle a *proposé*. Sans la
// trace de ce qui a été fait, recharger une conversation rouvre chaque action
// en « proposée » — et en mode autonome la carte se relance seule : une
// opération recréée, une étape relancée, sans que personne l'ait demandé.
//
// L'identité d'une exécution est (message, genre d'action, paramètres) : c'est
// la seule chose que le front et la base désignent de la même façon. L'uuid de
// `copilot_tool_calls` n'est jamais renvoyé au front, et l'id Anthropic n'est
// stocké nulle part.

/** Deux actions sont la même si elles portent le même genre et les mêmes params. */
export function sameAction(run: ActionRun, messageId: string, action: CopilotAction): boolean {
  return (
    run.messageId === messageId &&
    run.actionKind === action.kind &&
    stableJson(run.params) === stableJson(action.params)
  );
}

function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as object).sort().reduce((acc, k) => {
          (acc as Record<string, unknown>)[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {} as Record<string, unknown>)
      : val,
  );
}

/**
 * Pendant le flux, le message n'a qu'un id local : l'Edge Function n'émet le
 * vrai `message_id` qu'après avoir tout persisté, donc bien après les cartes
 * d'action. Une trace écrite à cet instant violerait la clé étrangère.
 * Le store retient donc la trace et la pousse quand l'id réel arrive.
 */
export function isLocalMessageId(id: string): boolean {
  return id.startsWith('local-');
}

export async function persistActionRun(run: ActionRun, conversationId: string): Promise<boolean> {
  if (isLocalMessageId(run.messageId)) return false;

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return false;

  const { error } = await supabase.from('copilot_action_runs').insert({
    message_id: run.messageId,
    conversation_id: conversationId,
    user_id: userId,
    action_kind: run.actionKind,
    params: run.params,
    outcome: run.outcome,
    decided_by: run.decidedBy,
    message: run.message ?? null,
    study_id: run.studyId ?? null,
    navigated_to: run.navigatedTo ?? null,
  });

  // Un index unique protège contre le double enregistrement. Si on tombe
  // dessus, l'action était déjà tracée : ce n'est pas une erreur, c'est le
  // garde-fou qui fonctionne.
  if (error && error.code !== '23505') {
    console.warn('[copilot] trace d’action non enregistrée:', error.message);
    return false;
  }
  return true;
}

/**
 * Décrit ce qu'une action est devenue. N'écrit rien : la persistance appartient
 * au store, seul à savoir si l'id du message est encore local.
 */
export function buildActionRun(params: {
  messageId: string;
  action: CopilotAction;
  outcome: ActionOutcome;
  decidedBy: 'user' | 'auto';
  result?: ActionResult | null;
}): ActionRun {
  return {
    messageId: params.messageId,
    actionKind: params.action.kind,
    params: params.action.params,
    outcome: params.outcome,
    decidedBy: params.decidedBy,
    message: params.result?.message,
    studyId: params.result?.studyId,
    navigatedTo: params.result?.navigateTo,
    createdAt: new Date().toISOString(),
  };
}

// ── Exécution ───────────────────────────────────────────────────────────────

// L'étude active a longtemps été mémorisée ici sous `promoteur.activeStudyId`,
// dans un localStorage brut — pendant que l'espace promoteur lisait
// `mimmoza.promoteur.active_study_id`, scopé par utilisateur. Les deux clés ne
// se sont jamais parlé : le copilote créait une opération que la navigation
// promoteur ne retrouvait pas. On s'aligne sur celle du métier, qui a en outre
// le mérite d'être scopée par compte.
function rememberActiveStudy(id: string): void {
  setPromoteurActiveStudyId(id);
}

export function getActiveStudyId(): string | null {
  return getPromoteurActiveStudyId();
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export async function executeAction(action: CopilotAction): Promise<ActionResult> {
  switch (action.kind) {
    case 'open_page': {
      const route = str(action.params.route);
      if (!route || !route.startsWith('/')) {
        return { ok: false, message: 'Route invalide.' };
      }
      return { ok: true, message: 'Page ouverte.', navigateTo: route };
    }

    case 'create_operation': {
      const title = str(action.params.title) ?? 'Nouvelle opération';
      const created = await PromoteurStudyService.createStudy(title);
      if (!created.ok) return { ok: false, message: created.error };

      const studyId = created.data.id;
      rememberActiveStudy(studyId);

      const communeInsee = str(action.params.commune_insee);
      const parcelIds = Array.isArray(action.params.parcel_ids)
        ? (action.params.parcel_ids as unknown[]).filter((p): p is string => typeof p === 'string')
        : [];
      const surface = num(action.params.surface_m2);

      // Le foncier n'est « prêt » que si on a de quoi enchaîner : une commune
      // et au moins une parcelle. Sinon l'étape reste à compléter à la main.
      if (communeInsee || parcelIds.length) {
        await PromoteurStudyService.patchFoncier(studyId, {
          prix_foncier: null,
          parcel_ids: parcelIds,
          focus_id: parcelIds[0] ?? '',
          commune_insee: communeInsee ?? '',
          surface_m2: surface ?? null,
          parcels_raw: [],
          done: Boolean(communeInsee && parcelIds.length),
        } as never);

        if (communeInsee && parcelIds.length) {
          await setStepStatus({
            studyId, step: 'foncier', status: 'ready', producedBy: 'agent',
            summary: { commune_insee: communeInsee, parcel_ids: parcelIds, surface_m2: surface ?? null },
          });
        }
      }

      return {
        ok: true,
        message: `Opération « ${title} » créée.`,
        studyId,
        navigateTo: '/promoteur/foncier',
      };
    }

    case 'run_step': {
      const step = str(action.params.step) as PromoteurStep | undefined;
      const route = str(action.params.route);
      const studyId = str(action.params.study_id) ?? getActiveStudyId() ?? undefined;
      if (!step || !route) return { ok: false, message: 'Étape inconnue.' };
      if (!studyId) return { ok: false, message: 'Aucune opération active. Créez-en une d’abord.' };

      rememberActiveStudy(studyId);
      await setStepStatus({ studyId, step, status: 'running', producedBy: 'agent' });

      // La page de l'étape reste l'unique lieu du calcul : on l'ouvre avec le
      // contexte, `autorun` lui demande de lancer le calcul à l'arrivée.
      const qs = new URLSearchParams({ study: studyId, step, autorun: '1' });
      return {
        ok: true,
        message: `Étape « ${step} » lancée.`,
        studyId,
        navigateTo: `${route}?${qs.toString()}`,
      };
    }

    default:
      return { ok: false, message: 'Action non reconnue.' };
  }
}
