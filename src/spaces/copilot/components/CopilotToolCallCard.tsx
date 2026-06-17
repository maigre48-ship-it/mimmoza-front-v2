// src/spaces/copilot/components/CopilotToolCallCard.tsx
import { AlertTriangle, Check, Info, Loader2, Wrench } from 'lucide-react';
import type { ActiveToolCall } from '../types/copilot.types';
import { COPILOT_THEME as T } from './copilotTheme';

const TOOL_LABELS: Record<string, string> = {
  get_parcel_summary:       'Résumé parcelle',
  get_parcel_plu:           'Règles PLU',
  get_dvf_comparables:      'Comparables DVF',
  get_risks_georisques:     'Risques Géorisques',
  compute_smartscore:       'SmartScore',
  get_quick_market_insight: 'Analyse marché',
};

function statusVisual(status: string) {
  if (status === 'running')
    return { icon: Loader2,        color: T.accent,               spin: true,  text: 'En cours…'     };
  if (status === 'success')
    return { icon: Check,          color: 'rgb(74 222 128)',       spin: false, text: 'Terminé'        };
  if (status === 'not_configured')
    return { icon: Info,           color: 'rgb(148 163 184)',      spin: false, text: 'Non connecté'   };
  if (status === 'not_found')
    return { icon: Info,           color: 'rgb(148 163 184)',      spin: false, text: 'Non disponible' };
  if (status === 'error')
    return { icon: AlertTriangle,  color: 'rgb(251 191 36)',       spin: false, text: 'Indisponible'   };
  // fallback
  return   { icon: Info,           color: 'rgb(148 163 184)',      spin: false, text: status           };
}

export function CopilotToolCallCard({ call }: { call: ActiveToolCall }) {
  const v = statusVisual(call.status);
  const Icon = v.icon;
  const label = TOOL_LABELS[call.name] ?? call.name;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 11px', margin: '4px 0', borderRadius: 10,
      background: 'rgb(255 255 255 / 0.03)', border: `1px solid ${T.borderSoft}`,
      fontSize: 12.5, color: T.textMuted,
    }}>
      <Wrench size={13} color={T.textMuted} style={{ opacity: 0.6 }} />
      <span style={{ color: T.text, fontWeight: 600 }}>{label}</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: v.color }}>
        <Icon size={13} style={v.spin ? { animation: 'copilot-spin 1s linear infinite' } : undefined} />
        {v.text}
        {call.durationMs
          ? <span style={{ opacity: 0.5, fontSize: 11 }}>· {(call.durationMs / 1000).toFixed(1)}s</span>
          : null}
      </span>
    </div>
  );
}