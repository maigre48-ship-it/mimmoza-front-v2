// ============================================================================
// Carte d'action — ce que le copilote propose de FAIRE, pas de dire.
//
// En mode « piloter », l'utilisateur lit le résumé et confirme. En mode
// « autonome », l'action part seule, mais la carte reste affichée avec son
// résultat : ce qui a été fait sans vous doit rester lisible après coup.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Loader2, Play, X } from 'lucide-react';
import {
  buildActionRun, executeAction, needsConfirmation,
  type ActionResult, type CopilotAction,
} from '../actions/copilotActions';
import { useCopilotStore } from '../store/copilotStore';
import type { ActionRun } from '../types/copilot.types';
import { COPILOT_THEME as T } from './copilotTheme';

type Phase = 'proposed' | 'running' | 'done' | 'refused' | 'failed';

interface Props {
  action: CopilotAction;
  messageId: string;
  /**
   * Trace relue en base : cette action a déjà été tranchée. La carte devient
   * un compte rendu, plus une proposition.
   */
  run?: ActionRun;
}

export function CopilotActionCard({ action, messageId, run: past }: Props) {
  const navigate = useNavigate();
  const rememberActionRun = useCopilotStore((s) => s.rememberActionRun);

  // Une action déjà tranchée s'affiche dans son état final, sans bouton.
  const [phase, setPhase] = useState<Phase>(past ? past.outcome : 'proposed');
  const [result, setResult] = useState<ActionResult | null>(
    past ? { ok: past.outcome === 'done', message: past.message ?? '', studyId: past.studyId } : null,
  );
  const autoFired = useRef(false);

  // C'est le store qui décide où la trace s'écrit : lui seul sait si l'id du
  // message est encore local, et donc s'il faut attendre `message_start`.
  const settle = useCallback(
    (outcome: 'done' | 'failed' | 'refused', decidedBy: 'user' | 'auto', res: ActionResult | null) => {
      rememberActionRun(buildActionRun({ messageId, action, outcome, decidedBy, result: res }));
    },
    [action, messageId, rememberActionRun],
  );

  const run = useCallback(async (decidedBy: 'user' | 'auto') => {
    setPhase('running');
    const res = await executeAction(action);
    setResult(res);
    setPhase(res.ok ? 'done' : 'failed');
    // La trace part avant la navigation : sinon le démontage du composant
    // emporterait l'enregistrement avec lui.
    settle(res.ok ? 'done' : 'failed', decidedBy, res);
    if (res.ok && res.navigateTo) navigate(res.navigateTo);
  }, [action, navigate, settle]);

  const refuse = useCallback(() => {
    setPhase('refused');
    settle('refused', 'user', null);
  }, [settle]);

  // Mode autonome : on exécute sans attendre, une seule fois.
  // `past` coupe court — une action déjà exécutée ne se rejoue jamais, c'est
  // toute la raison d'être de la trace.
  useEffect(() => {
    if (past) return;
    if (autoFired.current) return;
    if (needsConfirmation(action)) return;
    autoFired.current = true;
    // Différé d'une microtâche : `run` commence par un `setPhase`, et poser un
    // état de façon synchrone depuis un effet est ce que la règle
    // react-hooks/set-state-in-effect interdit.
    void Promise.resolve().then(() => run('auto'));
  }, [action, past, run]);

  const box = {
    margin: '8px 0', padding: '11px 13px', borderRadius: 12,
    border: `1px solid ${T.borderSoft}`,
    background: 'rgb(124 92 246 / 0.06)',
  } as const;

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <Play size={13} aria-hidden style={{ color: T.accent }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, letterSpacing: '.01em' }}>
          {past ? 'Action' : 'Action proposée'}
        </span>
        {past?.decidedBy === 'auto' && (
          <span style={{ fontSize: 11, color: T.textMuted }}>· mode autonome</span>
        )}
      </div>

      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.text }}>
        {action.summary || action.label}
      </div>

      {phase === 'proposed' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => void run('user')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: T.accent, color: '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            {action.label}
            <ArrowRight size={13} aria-hidden />
          </button>
          <button
            type="button"
            onClick={refuse}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${T.borderSoft}`, background: 'transparent',
              color: T.textMuted, fontSize: 13,
            }}
          >
            <X size={13} aria-hidden />
            Ignorer
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, color: T.textMuted }}>
          <Loader2 size={13} aria-hidden style={{ animation: 'spin 1s linear infinite' }} />
          Exécution…
        </div>
      )}

      {phase === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, color: 'rgb(74 222 128)' }}>
          <Check size={13} aria-hidden />
          {result?.message ?? 'Fait.'}
        </div>
      )}

      {phase === 'failed' && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: 'rgb(251 191 36)' }}>
          {result?.message ?? 'Action impossible.'}
        </div>
      )}

      {phase === 'refused' && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: T.textMuted }}>
          Ignorée.
        </div>
      )}
    </div>
  );
}
