// src/spaces/copilot/components/CopilotMessage.tsx
import type { ChatMessage } from '../types/copilot.types';
import { CopilotToolCallCard } from './CopilotToolCallCard';
import { CopilotActionCard } from './CopilotActionCard';
import { isActionTool, readAction, sameAction } from '../actions/copilotActions';
import { useCopilotStore } from '../store/copilotStore';
import { COPILOT_THEME as T } from './copilotTheme';
import { Download } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { exportCopilotResponseToPdf, markdownToSafeHtml } from '../utils/exportCopilotPdf';
import { decouperSegments } from '../charts/copilotChart.types';
import { buildParcelDossier } from '../dossier/parcelDossier';
import './CopilotMessage.css';

// recharts pèse plusieurs centaines de Ko et n'est utilisé QUE par les
// graphiques, réservés au mode `report` (offre Pro). Un import statique
// l'aurait fait entrer dans le chunk du chat pour tout le monde, y compris les
// comptes qui n'en verront jamais un seul.
const CopilotChart = lazy(() =>
  import('../charts/CopilotChart').then((m) => ({ default: m.CopilotChart })),
);
const ParcelDecisionDossier = lazy(() =>
  import('../dossier/ParcelDecisionDossier').then((m) => ({ default: m.ParcelDecisionDossier })),
);

export function CopilotMessage({ message, question, conversationId, onSend }: {
  message: ChatMessage; question?: string | null; conversationId?: string | null; onSend?: (text: string) => void;
}) {
  const isUser = message.role === 'user';
  const actionRuns = useCopilotStore((s) => s.actionRuns);
  const messages = useCopilotStore((s) => s.messages);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Recalculé à chaque paquet de tokens pendant le streaming : c'est ce qui
  // permet au graphique d'apparaître dès que son bloc se referme, sans attendre
  // la fin de la réponse.
  const segments = useMemo(() => decouperSegments(message.text), [message.text]);
  const dossier = useMemo(() => buildParcelDossier(message.toolCalls, message.createdAt), [message.toolCalls, message.createdAt]);

  const linkedQuestion = question ?? (() => {
    const index = messages.findIndex((item) => item.id === message.id);
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].text;
    return null;
  })();

  const handleResponseExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const result = await exportCopilotResponseToPdf({ response: message, question: linkedQuestion });
      if (result === 'popup_blocked') setExportError('Autorisez les fenêtres contextuelles pour exporter le PDF.');
    } catch {
      setExportError('Le rapport PDF n’a pas pu être préparé.');
    } finally { setExporting(false); }
  };

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
        <div style={{
          maxWidth: '82%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
          background: T.userBubble, border: `1px solid ${T.border}`,
          color: T.text, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        }}>
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: '10px 0' }}>
      {message.toolCalls.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {message.toolCalls.map((tc) => {
            // Un outil d'action ne raconte pas ce qu'il a lu : il propose de
            // faire quelque chose. Tant qu'il tourne, on garde la carte
            // technique ; dès qu'il a répondu, on rend la carte d'action.
            if (isActionTool(tc.name) && tc.status !== 'running') {
              const action = readAction(tc.output);
              if (action) {
                // Si cette action a déjà été tranchée, la carte affiche le
                // résultat au lieu de reproposer — et ne se relance pas.
                const past = actionRuns.find((r) => sameAction(r, message.id, action));
                return (
                  <CopilotActionCard
                    key={tc.id}
                    action={action}
                    messageId={message.id}
                    run={past}
                  />
                );
              }
            }
            return <CopilotToolCallCard key={tc.id} call={tc} />;
          })}
        </div>
      )}
      {message.status === 'complete' && dossier && conversationId && (
        <Suspense fallback={<div>Préparation du dossier…</div>}>
          <ParcelDecisionDossier dossier={dossier} conversationId={conversationId} messageId={message.id} onAnalyze={onSend} />
        </Suspense>
      )}
      {/* Texte et graphiques sont entrelacés : le modèle place ses blocs
          ```mimmoza-chart là où ils éclairent son propos, pas tous à la fin.
          Pendant le streaming, un bloc encore ouvert est masqué — son JSON est
          tronqué, donc invalide, et le laisser défiler serait illisible. */}
      {message.text && segments.map((seg, i) =>
        seg.kind === 'chart' ? (
          // Réserve de hauteur pendant le chargement du module : sans elle, le
          // fil sauterait au moment où recharts arrive.
          <Suspense key={`c${i}`} fallback={<div style={{ height: 240 }} />}>
            <CopilotChart spec={seg.spec} />
          </Suspense>
        ) : (
          <div
            key={`m${i}`}
            className="copilot-message-markdown"
            style={{ color: T.text, fontSize: 14, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(seg.text) }}
          />
        ),
      )}
      {message.status === 'complete' && message.text.trim() && (
        <div className="copilot-message-actions">
          <button type="button" onClick={() => void handleResponseExport()} disabled={exporting} aria-label="Exporter cette réponse en PDF" aria-busy={exporting}>
            <Download size={14} aria-hidden="true" /> {exporting ? 'Préparation…' : 'Exporter en PDF'}
          </button>
          {exportError && <span role="status">{exportError}</span>}
        </div>
      )}
      {/* Le mode `quick` n'existe que sur l'offre Basique (PLAN_POLICY côté
          serveur) : la mention est donc toujours pertinente quand il s'affiche.
          Elle est rendue à partir du mode RÉELLEMENT appliqué renvoyé par le
          serveur, jamais du niveau demandé — le serveur écrase la demande selon
          le plan, et afficher le niveau demandé reviendrait à annoncer une
          profondeur d'analyse qui n'a pas eu lieu. Les messages relus depuis la
          base n'ont pas ce champ : aucune mention n'est alors affichée, plutôt
          qu'une mention devinée. */}
      {message.status === 'complete' && message.effectiveMode === 'quick' && message.text.trim() && (
        <div className="copilot-message-upgrade">
          <span aria-hidden="true">⚡</span>
          <span>
            Réponse produite au niveau <strong>Standard</strong>. Le niveau{' '}
            <strong>Approfondi</strong> croise davantage de sources — comparables DVF,
            risques, DPE, score de marché — et développe l'analyse.{' '}
            <Link to="/abonnement">Voir les niveaux</Link>
          </span>
        </div>
      )}
      {message.status === 'streaming' && !message.text && message.toolCalls.length === 0 && (
        <div style={{ display: 'inline-flex', gap: 4, padding: '4px 0' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%', background: T.accent,
              animation: `copilot-bounce 1.2s ${i * 0.15}s infinite ease-in-out`,
            }} />
          ))}
        </div>
      )}
      {message.status === 'error' && (
        <div style={{ color: 'rgb(248 113 113)', fontSize: 13, marginTop: 6 }}>
          ⚠️ {message.error ?? 'Une erreur est survenue.'}
        </div>
      )}
    </div>
  );
}
