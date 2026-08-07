// ============================================================================
// Chaîne d'opération promoteur — état des étapes et de leurs dépendances.
//
// Le graphe vit en base (`promoteur_step_deps`), pas dans le code : l'agent le
// lit pour planifier, un trigger Postgres l'utilise pour propager la péremption.
// Recalculer le PLU rend périmés l'enveloppe, la programmation et le bilan —
// automatiquement, sans que le front ait à y penser.
//
// Une étape n'est jamais calculée ici. Le calcul reste dans sa page (source
// unique de vérité) ; ce module ne fait que suivre son état.
// ============================================================================

import { supabase } from '@/lib/supabaseClient';

export type PromoteurStep =
  | 'foncier' | 'plu' | 'marche' | 'risques'
  | 'enveloppe' | 'programmation' | 'bilan' | 'synthese';

export type StepStatus = 'empty' | 'running' | 'ready' | 'stale' | 'error';

export interface ChainStep {
  step: PromoteurStep;
  label: string;
  ordre: number;
  route: string;
  status: StepStatus;
  producedBy: 'user' | 'agent' | null;
  producedAt: string | null;
  dependsOn: PromoteurStep[];
  /** Dépendances pas encore prêtes — l'étape ne peut pas être lancée. */
  blockedBy: PromoteurStep[];
  runnable: boolean;
}

interface ChainRow {
  step: PromoteurStep;
  label: string;
  ordre: number;
  route: string;
  status: StepStatus;
  produced_by: 'user' | 'agent' | null;
  produced_at: string | null;
  depends_on: PromoteurStep[] | null;
  blocked_by: PromoteurStep[] | null;
  runnable: boolean;
}

export async function getChainState(studyId: string): Promise<ChainStep[]> {
  const { data, error } = await supabase.rpc('promoteur_chain_state', { p_study_id: studyId });
  if (error || !data) return [];
  return (data as ChainRow[]).map((r) => ({
    step: r.step,
    label: r.label,
    ordre: r.ordre,
    route: r.route,
    status: r.status,
    producedBy: r.produced_by,
    producedAt: r.produced_at,
    dependsOn: r.depends_on ?? [],
    blockedBy: r.blocked_by ?? [],
    runnable: r.runnable,
  }));
}

/**
 * Enregistre le résultat d'une étape. `inputsHash` sert à ne pas re-marquer
 * périmé l'aval quand on réenregistre à l'identique (auto-save, revisite).
 */
export async function setStepStatus(params: {
  studyId: string;
  step: PromoteurStep;
  status: StepStatus;
  producedBy?: 'user' | 'agent';
  inputsHash?: string | null;
  summary?: unknown;
  error?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { studyId, step, status } = params;

  // Une étape sans étude ne veut rien dire, et l'appel partirait quand même
  // vers Postgres pour y échouer sur la clé étrangère. Autant le dire ici.
  if (!studyId) {
    const message = `[chaîne] étape « ${step} » non enregistrée : aucune étude active`;
    console.warn(message);
    return { ok: false, error: message };
  }

  const { error } = await supabase
    .from('promoteur_study_steps')
    .upsert(
      {
        study_id: studyId,
        step,
        status,
        inputs_hash: params.inputsHash ?? null,
        summary: params.summary ?? null,
        produced_by: params.producedBy ?? 'user',
        produced_at: status === 'ready' ? new Date().toISOString() : null,
        error: params.error ?? null,
      },
      { onConflict: 'study_id,step' },
    );

  // Aucun appelant ne regardait la valeur de retour. Une chaîne qui n'enregistre
  // rien sans le dire est pire qu'une absence de chaîne : la page affiche
  // « validé », la base reste vide, et on cherche dans le noir. Le journal est
  // le minimum ; c'est ce qui manquait au premier test réel.
  if (error) {
    console.error(
      `[chaîne] étape « ${step} » NON enregistrée (étude ${studyId.slice(0, 8)}…) :`,
      error.message,
    );
    return { ok: false, error: error.message };
  }

  if (import.meta.env.DEV) {
    console.debug(`[chaîne] étape « ${step} » → ${status}`);
  }
  return { ok: true };
}

/**
 * Le copilote a-t-il ouvert cette page pour exécuter l'étape lui-même ?
 * Sert uniquement à renseigner la provenance (`user` / `agent`) au moment de
 * l'écriture — la décision de calculer, elle, reste à la page.
 */
export function isAgentRun(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('autorun') === '1';
  } catch {
    return false;
  }
}

/** Empreinte stable d'un objet d'entrées, pour détecter un vrai changement. */
export function hashInputs(input: unknown): string {
  const stable = JSON.stringify(input, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as object).sort().reduce((acc, k) => {
          (acc as Record<string, unknown>)[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {} as Record<string, unknown>)
      : v,
  );
  let h = 0;
  for (let i = 0; i < stable.length; i++) {
    h = (h << 5) - h + stable.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

/** Prochaine étape lançable, dans l'ordre du process. */
export function nextRunnable(chain: ChainStep[]): ChainStep | null {
  return chain.find((s) => s.runnable && (s.status === 'empty' || s.status === 'stale')) ?? null;
}

/** Étapes devenues périmées — c'est ce qu'on affiche en tête de page. */
export function staleSteps(chain: ChainStep[]): ChainStep[] {
  return chain.filter((s) => s.status === 'stale');
}
