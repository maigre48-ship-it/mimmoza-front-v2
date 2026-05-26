// src/spaces/copilot/components/CopilotCreditsPill.tsx
import { Coins } from 'lucide-react';
import { COPILOT_THEME as T } from './copilotTheme';

export function CopilotCreditsPill({ credits }: { credits: number | null }) {
  return (
    <div
      title="Crédits Copilot restants"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: T.accentSoft, border: `1px solid ${T.border}`,
        color: T.text, fontSize: 12, fontWeight: 600,
      }}
    >
      <Coins size={13} color={T.accent} />
      {credits ?? '…'}
    </div>
  );
}