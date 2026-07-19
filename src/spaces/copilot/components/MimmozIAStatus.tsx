import type { MimmozIAOrbState } from './MimmozIAOrb';
import './MimmozIAStatus.css';

/** Textes complets (accueil). */
const STATUS_TEXT: Record<MimmozIAOrbState, string> = {
  idle: 'Je vous écoute…',
  listening: 'Je vous écoute…',
  thinking: 'Je réfléchis à votre demande…',
  searching: 'Je consulte les sources utiles…',
  responding: 'Je prépare votre réponse…',
  success: 'Analyse terminée',
  error: 'Une difficulté est survenue',
};

/** Textes très courts (orbe compacte pendant la conversation). */
const STATUS_TEXT_COMPACT: Record<MimmozIAOrbState, string> = {
  idle: 'Je vous écoute…',
  listening: 'Je vous écoute…',
  thinking: 'Je réfléchis…',
  searching: 'Je consulte les sources…',
  responding: 'Je vous réponds…',
  success: 'Terminé',
  error: 'Erreur',
};

export interface MimmozIAStatusProps {
  state: MimmozIAOrbState;
  /** Version courte, sous l'orbe compacte (masque la liste de sources). */
  compact?: boolean;
  /** Sources/moteurs mobilisés (max 4). Ignoré en mode compact. */
  tools?: string[];
  className?: string;
}

/** Panneau d'état sous l'orbe (présentational). */
export function MimmozIAStatus({ state, compact = false, tools = [], className }: MimmozIAStatusProps) {
  const text = compact ? STATUS_TEXT_COMPACT[state] : STATUS_TEXT[state];
  const shown = compact ? [] : tools.slice(0, 4);
  return (
    <div
      className={`mzia-status-panel${className ? ` ${className}` : ''}`}
      data-state={state}
      data-compact={compact ? '' : undefined}
      aria-live="polite"
    >
      <p className="mzia-status-panel__text">{text}</p>
      {shown.length > 0 && (
        <ul className="mzia-status-panel__tools">
          {shown.map((t) => (
            <li key={t} className="mzia-status-panel__tool">
              <span className="mzia-status-panel__dot" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MimmozIAStatus;