import type { LucideIcon } from 'lucide-react';
import './MimmozIAQuickAction.css';

export interface MimmozIAQuickActionProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Oriente le liseré de connexion vers l'orbe (déco au survol). */
  side?: 'left' | 'right';
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Carte d'action rapide flottant autour de l'orbe.
 * Toute l'interaction visuelle (lift, glow, liseré vers l'orbe) est gérée en CSS.
 */
export function MimmozIAQuickAction({
  icon: Icon,
  title,
  subtitle,
  side = 'left',
  onClick,
  disabled = false,
}: MimmozIAQuickActionProps) {
  return (
    <button
      type="button"
      className="mzia-qa"
      data-side={side}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="mzia-qa__icon" aria-hidden>
        <Icon size={18} strokeWidth={2} />
      </span>
      <span className="mzia-qa__text">
        <span className="mzia-qa__title">{title}</span>
        <span className="mzia-qa__subtitle">{subtitle}</span>
      </span>
    </button>
  );
}

export default MimmozIAQuickAction;