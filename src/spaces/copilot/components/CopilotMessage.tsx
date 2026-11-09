// src/spaces/copilot/components/CopilotMessage.tsx
import type { Mission } from '../agent/agent.types';
import type { ChatMessage } from '../types/copilot.types';
import { CopilotWebResearchCard } from './CopilotToolCallCard';
import { CopilotApiResultCard } from './CopilotApiResultCard';
import { CopilotFinancialCard } from './CopilotFinancialCard';
import { CopilotActionCard } from './CopilotActionCard';
import { isActionTool, readAction, sameAction } from '../actions/copilotActions';
import { useCopilotStore } from '../store/copilotStore';
import { COPILOT_THEME as T } from './copilotTheme';
import { Download } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { exportCopilotResponseToPdf, markdownToSafeHtml } from '../utils/exportCopilotPdf';
import { htmlLisible, mettreEnForme } from '../utils/lisibilite';
import { structurerRapportFactuel } from '../utils/rapportAnalyse';
import { decouperSegments } from '../charts/copilotChart.types';
import { buildParcelDossier } from '../dossier/parcelDossier';
import './CopilotMessage.css';
import { isGeoCall } from '../maps/thematicMapModel';
import { CopilotRenderBoundary } from './CopilotRenderBoundary';
import { tertiaryReview } from '../results/tertiaryReview';
import { FollowupProposalCard } from '../followup/FollowupProposalCard';
import { withoutJarvisDraft } from '../studio3d/jarvisDraft';
import { useCopilotStreaming } from '../hooks/useCopilotStreaming';
import { trackFire } from '@/lib/mimmozia/track';
import { CarteDevisMission } from '../agent/CarteDevisMission';
import { devisAAfficher, estAppelDevis } from '../agent/agentLogique';
import { CarteSuiviRendu } from '../studio3d/CarteSuiviRendu';
import { cartesSuivi } from '../studio3d/suiviRenduChat';
import { CarteBriefCreatif } from '../studio3d/CarteBriefCreatif';
// Lot brief-unifié : avec le panneau Espace 3D, le chat n'affiche qu'une ligne qui ouvre l'habillage dans le panneau.
import { LigneHabillage } from '../studio3d/LigneHabillage';
import type { DemandeBrief } from '../studio3d/briefCreatif';
import { lireBlocBrief, lireDemandeBrief } from '../studio3d/briefCreatif';
import { ChoixCliquables, type RemplirSaisie } from './ChoixCliquables';
import { lireBlocChoix, situationChoix } from '../utils/choixCliquables';
// LOT D1 : réponse longue → aperçu dans le fil + document complet dans le panneau.
import { ApercuDocument } from '../document/ApercuDocument';
import { estReponseDocument } from '../document/documentModele';
import { useDocumentUi } from '../document/documentUi.store';
const CopilotThematicMaps = lazy(() => import('../maps/CopilotThematicMaps').then(m => ({ default: m.CopilotThematicMaps })));

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

type MessageProps = {
  onVisualiserMission?: (mission: Mission) => void;
  message: ChatMessage; question?: string | null; conversationId?: string | null; onSend?: (text: string) => void;
  /** LOT CHOIX-CLIQUABLES : écrit dans le champ de saisie du chat (sans envoyer). */
  onRemplirSaisie?: RemplirSaisie;
  /** Lot brief-unifié : ouvre l'habillage dans le panneau Espace 3D (absent : carte complète dans le fil, comme avant). */
  onOuvrirHabillage?: (demande: DemandeBrief) => void;
};

export function CopilotMessage(props: MessageProps) {
  return <CopilotRenderBoundary key={props.message.id} label="Réponse" fallback={<div role="status" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 12 }}>
    <p>Un élément de cette réponse n’a pas pu être affiché. Voici le texte reçu :</p>
    {props.message.text || 'La réponse est en cours de réception…'}
    {props.message.error && <p>{props.message.error}</p>}
  </div>}><CopilotMessageContent {...props} /></CopilotRenderBoundary>;
}

function CopilotMessageContent({ message, question, conversationId, onSend, onVisualiserMission, onRemplirSaisie, onOuvrirHabillage }: MessageProps) {
  const isUser = message.role === 'user';
  const actionRuns = useCopilotStore((s) => s.actionRuns);
  const messages = useCopilotStore((s) => s.messages);
  // Réponse arrêtée ou coupée avant la fin : « Reprendre » relit la réponse
  // complète en base (sans coût) ou demande la suite une seule fois.
  const incomplet = useCopilotStore((s) => Boolean(s.incomplets?.[message.id]));
  const { resume } = useCopilotStreaming();
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | 'docx' | 'pptx' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Recalculé à chaque paquet de tokens pendant le streaming : c'est ce qui
  // permet au graphique d'apparaître dès que son bloc se referme, sans attendre
  // la fin de la réponse.
  const dossier = useMemo(() => buildParcelDossier(message.toolCalls, message.createdAt), [message.toolCalls, message.createdAt]);
  const { visibleText, factualReport } = useMemo(() => {
    if (!dossier || message.status !== 'complete') return { visibleText: message.text, factualReport: '' };
    const match = /(^|\n)#{1,3}\s+Ce qu['’]il faut retenir\b/im.exec(message.text);
    if (!match || match.index < 100) return { visibleText: message.text, factualReport: '' };
    const splitAt = match.index + match[1].length;
    return { visibleText: message.text.slice(splitAt), factualReport: message.text.slice(0, splitAt).trim() };
  }, [dossier, message.status, message.text]);
  // LOT CHOIX-CLIQUABLES : le bloc ```mimmoza-choix n'est jamais affiché tel quel (puces sous le texte).
  const choix = useMemo(() => lireBlocChoix(visibleText), [visibleText]);
  const segments = useMemo(() => decouperSegments(withoutJarvisDraft(choix.visible)), [choix.visible]);
  // LOT F1 : la première phrase-réponse n'est mise en évidence qu'une fois la réponse complète.
  const premierTexte = segments.findIndex((s) => s.kind !== 'chart');

  const linkedQuestion = question ?? (() => {
    const index = messages.findIndex((item) => item.id === message.id);
    // Brief créatif : le bloc technique n'est ni affiché ni exporté (seule la ligne lisible).
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') return lireBlocBrief(messages[i].text).visible;
    return null;
  })();
  const decisionLimits = tertiaryReview(linkedQuestion, message.toolCalls);
  // Agent autonome : une carte de devis par mission proposée (sans doublon).
  const devisMissions = useMemo(() => devisAAfficher(message.toolCalls), [message.toolCalls]);
  // LOT E1-suivi : carte de suivi vivante d'un rendu Studio (dernier appel qui cite chaque travail).
  const suivisRendu = useMemo(() => cartesSuivi(messages), [messages]);
  // LOT CHOIX-CLIQUABLES : puces actives sur le dernier message seulement ; sinon figées avec la réponse donnée.
  // La carte « Brief créatif » fait déjà le choix d'habillage : pas de puces en double sous elle.
  const situation = useMemo(() => situationChoix(messages, message.id), [messages, message.id]);
  const carteBriefDemandee = message.toolCalls.some((tc) => lireDemandeBrief(tc)?.origine === 'demande');
  // LOT D1 : seulement si un panneau document est monté (sinon affichage complet, comme avant).
  const panneauDocument = useDocumentUi((s) => s.hotes > 0);
  const enDocument = !isUser && panneauDocument && message.status === 'complete' && estReponseDocument(choix.visible);
  // Ouverture automatique quand une réponse longue VIENT de se terminer (pas à la relecture d'une conversation).
  const statutPrecedent = useRef(message.status);
  useEffect(() => {
    const avant = statutPrecedent.current;
    statutPrecedent.current = message.status;
    if (enDocument && avant === 'streaming') useDocumentUi.getState().ouvrir({ genre: 'reponse', messageId: message.id, question: linkedQuestion });
  }, [enDocument, message.status, message.id, linkedQuestion]);

  const handleResponseExport = async (format: 'pdf' | 'xlsx' | 'docx' | 'pptx') => {
    if (exporting) return;
    setExporting(format); setExportError(null);
    try {
      if (format === 'pdf') {
        trackFire('report_download', { format: 'pdf' });
        const result = await exportCopilotResponseToPdf({ response: message, question: linkedQuestion });
        if (result === 'popup_blocked') setExportError('Autorisez les fenêtres contextuelles pour exporter le PDF.');
      } else {
        const { exportCopilotOffice } = await import('../exports/exportCopilotOffice');
        await exportCopilotOffice(format, { response: message, question: linkedQuestion });
      }
    } catch {
      setExportError('Le fichier n’a pas pu être préparé. Réessayez dans quelques instants.');
    } finally { setExporting(null); }
  };

  if (isUser) {
    // LOT BRIEF-CRÉATIF : le bloc ```mimmoza-brief``` (relu par le serveur) est masqué ; une pastille le signale.
    const blocBrief = lireBlocBrief(message.text);
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
        <div style={{
          maxWidth: '82%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
          background: T.userBubble, border: `1px solid ${T.border}`,
          color: T.text, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        }}>
          {blocBrief.brief && <span style={{ display: 'inline-block', marginBottom: 4, padding: '1px 8px', borderRadius: 999, background: '#ede9fe', color: '#5b21b6', fontSize: 11, fontWeight: 600 }}>Brief créatif</span>}
          {blocBrief.brief && <br />}
          {blocBrief.visible}
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: '10px 0' }}>
      {decisionLimits.length > 0 && <aside role="status" style={{ padding: 12, marginBottom: 12, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, color: '#9a3412', fontSize: 13 }}>
        <strong>Comparaison exploratoire · décision à confirmer</strong>
        <ul>{decisionLimits.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>Ce contrôle porte sur les résultats d’outils de cette réponse. Une pièce fournie ou un contexte antérieur peut apporter des preuves complémentaires.</p>
      </aside>}
      {message.toolCalls.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {message.toolCalls.map((tc) => <CopilotRenderBoundary key={tc.id} label="Résultat d’outil">{(() => {
            if (estAppelDevis(tc.name)) { const d = devisMissions.get(tc.id); return d ? <CarteDevisMission affichage={d} onSend={onSend} conversationId={conversationId} onVisualiserMission={onVisualiserMission} /> : null; }
            { const suivi = suivisRendu.get(tc.id); if (suivi) return <CarteSuiviRendu indice={suivi} />; }
            // LOT BRIEF-CRÉATIF : demande de brief → carte à la place de la carte d'outil ; devis → carte + « Modifier l'habillage ».
            // LOT BRIEF-UNIFIÉ : panneau Espace 3D présent → une seule ligne compacte qui l'ouvre sur l'habillage.
            { const demande = lireDemandeBrief(tc); if (demande) {
              const brief = onOuvrirHabillage
                ? <LigneHabillage demande={demande} messageId={message.id} onOuvrir={onOuvrirHabillage} />
                : <CarteBriefCreatif demande={demande} messageId={message.id} onSend={onSend} />;
              return demande.origine === 'demande' ? brief : <><CopilotApiResultCard call={tc} />{brief}</>;
            } }
            if (tc.name === 'proposer_suivi_projet') return <FollowupProposalCard call={tc} complete={message.status === 'complete'} />;
            if (tc.name === 'calculer_bilan_financier') return <CopilotFinancialCard key={tc.id} call={tc} onSend={onSend} />;
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
            if (tc.name === 'web_search' || tc.name === 'web_fetch') {
              const webCalls = message.toolCalls.filter((call) => call.name === 'web_search' || call.name === 'web_fetch');
              return tc.id === webCalls[0]?.id ? <CopilotWebResearchCard key={tc.id} calls={webCalls} /> : null;
            }
            return <CopilotApiResultCard key={tc.id} call={tc} />;
          })()}</CopilotRenderBoundary>)}
        </div>
      )}
      {message.status === 'complete' && message.toolCalls.some(isGeoCall) && <CopilotRenderBoundary label="Cartes thématiques"><Suspense fallback={<div>Préparation des cartes thématiques…</div>}><CopilotThematicMaps calls={message.toolCalls} onSend={onSend} /></Suspense></CopilotRenderBoundary>}
      {message.status === 'complete' && dossier && conversationId && (
        <CopilotRenderBoundary label="Dossier de parcelle"><Suspense fallback={<div>Préparation du dossier…</div>}>
          <ParcelDecisionDossier dossier={dossier} conversationId={conversationId} messageId={message.id} onAnalyze={onSend} />
        </Suspense></CopilotRenderBoundary>
      )}
      {/* Texte et graphiques sont entrelacés : le modèle place ses blocs
          ```mimmoza-chart là où ils éclairent son propos, pas tous à la fin.
          Pendant le streaming, un bloc encore ouvert est masqué — son JSON est
          tronqué, donc invalide, et le laisser défiler serait illisible. */}
      {enDocument && <CopilotRenderBoundary label="Document"><ApercuDocument message={message} texte={choix.visible} question={linkedQuestion} /></CopilotRenderBoundary>}
      {message.text && !enDocument && segments.map((seg, i) =>
        seg.kind === 'chart' ? (
          // Réserve de hauteur pendant le chargement du module : sans elle, le
          // fil sauterait au moment où recharts arrive.
          <CopilotRenderBoundary key={`c${i}`} label="Graphique" fallback={<div role="status"><p>Le graphique ne peut pas être affiché. Ses données restent disponibles :</p><div style={{ overflowX: 'auto' }}><table><caption>{seg.spec.title}</caption><thead><tr><th>Libellé</th>{(seg.spec.series ?? ['value']).map(s => <th key={s}>{s === 'value' ? 'Valeur' : s}{seg.spec.unit ? ` (${seg.spec.unit})` : ''}</th>)}</tr></thead><tbody>{seg.spec.data.map((p, index) => <tr key={index}><td>{p.label}</td>{(seg.spec.series ?? ['value']).map(s => <td key={s}>{p[s] ?? '—'}</td>)}</tr>)}</tbody></table></div>{seg.spec.source && <p>Source : {seg.spec.source}</p>}</div>}><Suspense fallback={<div style={{ height: 240 }} />}>
            <CopilotChart spec={seg.spec} />
          </Suspense></CopilotRenderBoundary>
        ) : (
          <div
            key={`m${i}`}
            className="copilot-message-markdown"
            style={{ color: T.text, fontSize: 14, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: htmlLisible(seg.text, markdownToSafeHtml, { reponseDabord: i === premierTexte && message.status === 'complete' }) }}
          />
        ),
      )}
      {choix.bloc && message.status === 'complete' && !carteBriefDemandee && <CopilotRenderBoundary label="Réponses proposées">
        <ChoixCliquables bloc={choix.bloc} messageId={message.id} actif={situation.actif}
          reponse={situation.reponse === null ? null : lireBlocBrief(situation.reponse).visible} onRemplirSaisie={onRemplirSaisie} />
      </CopilotRenderBoundary>}
      {factualReport && <details className="copilot-message-source-report">
        <summary>Ouvrir le rapport factuel complet et les sources</summary>
        <div className="copilot-message-markdown copilot-rapport" dangerouslySetInnerHTML={{ __html: structurerRapportFactuel(factualReport, (md) => markdownToSafeHtml(mettreEnForme(md))).annexeHtml }} />
      </details>}
      {message.status === 'complete' && (message.text.trim() || message.toolCalls.length > 0) && (
        <div className="copilot-message-actions" aria-busy={exporting !== null} aria-label="Exporter cette réponse">
          <span className="copilot-message-export-label">Exporter</span>
          {([{ format: 'pdf', label: 'PDF' }, { format: 'xlsx', label: 'Excel' }, { format: 'docx', label: 'Word' }, { format: 'pptx', label: 'PowerPoint' }] as const).map(({ format, label }) => <button key={format} type="button" onClick={() => void handleResponseExport(format)} disabled={exporting !== null} aria-label={`Exporter cette réponse en ${label}`} title={`Télécharger cette réponse en ${label}`}>
            <Download size={14} aria-hidden="true" /> {exporting === format ? 'Préparation…' : label}
          </button>)}
          {exportError && <span role="alert">{exportError}</span>}
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
          {incomplet && (
            <button
              type="button"
              onClick={() => void resume(message.id)}
              style={{ marginLeft: 10, padding: '3px 10px', borderRadius: 8, border: `1px solid ${T.accent}`, background: 'transparent', color: T.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Reprendre
            </button>
          )}
        </div>
      )}
    </div>
  );
}
