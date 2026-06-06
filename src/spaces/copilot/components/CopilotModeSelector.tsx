// src/spaces/copilot/components/CopilotModeSelector.tsx
import { Zap, Brain } from 'lucide-react';
import type { CopilotMode } from '../types/copilot.types';
import { CREDIT_COST, V1_AVAILABLE_MODES } from '../types/copilot.types';
import { COPILOT_THEME as T } from './copilotTheme';

const LABELS: Record<CopilotMode, { label: string; icon: typeof Zap }> = {
  quick:    { label: 'Rapide',  icon: Zap   },
  advanced: { label: 'Avancé', icon: Brain },
  report:   { label: 'Rapport', icon: Brain },
};

function isAnalyseRapidePage(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/analyse-rapide');
}

export function CopilotModeSelector({
  mode, onChange, disabled,
}: { mode: CopilotMode; onChange: (m: CopilotMode) => void; disabled?: boolean }) {

  // Sur la page Analyse rapide : on n'affiche que le mode Rapide
  const availableModes = isAnalyseRapidePage()
    ? V1_AVAILABLE_MODES.filter((m) => m === 'quick')
    : V1_AVAILABLE_MODES;

  return (
    <div style={{
      display: 'inline-flex', gap: 4, padding: 3, borderRadius: 12,
      background: 'rgb(255 255 255 / 0.04)', border: `1px solid ${T.borderSoft}`,
    }}>
      {availableModes.map((m) => {
        const active = m === mode;
        const { label, icon: Icon } = LABELS[m];
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            disabled={disabled}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 9, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
              background: active ? T.accent : 'transparent',
              color: active ? 'white' : T.textMuted,
              opacity: disabled ? 0.5 : 1, transition: 'all .15s ease',
            }}
          >
            <Icon size={13} />
            {label}
            <span style={{ fontSize: 10, opacity: 0.7 }}>{CREDIT_COST[m]}c</span>
          </button>
        );
      })}
    </div>
  );
}