// src/spaces/copilot/components/CopilotChat.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCopilot } from '../hooks/useCopilot';
import { useCopilotContext } from '../hooks/useCopilotContext';
import { getCopilotQuickQuestions } from '../utils/quickQuestions';
import { useLocation } from 'react-router-dom';
import { CopilotEmptyState } from './CopilotEmptyState';
import { CopilotInput } from './CopilotInput';
import { CopilotMessage } from './CopilotMessage';
import { COPILOT_THEME as T } from './copilotTheme';
import type { CopilotMode } from '../types/copilot.types';
import { FollowupPanel } from '../followup/FollowupPanel';
import { JarvisDraftPanel, type IssueOuvertureStudio } from '../studio3d/JarvisDraftPanel';
import type { ConfirmedTerrain } from '../studio3d/terrainCadastre';
import { is3DPreparationRequest, readJarvisDraft, withoutJarvisDraft, type JarvisDraft } from '../studio3d/jarvisDraft';
import { Box, Volume2, VolumeX } from 'lucide-react';
import { BoutonFenetre, GlypheAgrandir, GlypheFermer, GlypheReduire, GlypheRestaurer } from './FenetreBoutons';
import './CopilotFenetres.css';

/** Fenêtre « Espace 3D » : ouverte, agrandie, réduite en bande sur le côté, ou fermée. */
type EtatFenetre3D = 'ouvert' | 'large' | 'reduit' | 'ferme';
const CLE_FENETRE_3D = 'mzia.atelier3d.fenetre';
const ETATS_FENETRE_3D: readonly EtatFenetre3D[] = ['ouvert', 'large', 'reduit', 'ferme'];

function lireEtatFenetre3D(): EtatFenetre3D {
  try {
    const valeur = window.localStorage.getItem(CLE_FENETRE_3D);
    return ETATS_FENETRE_3D.includes(valeur as EtatFenetre3D) ? valeur as EtatFenetre3D : 'ouvert';
  } catch {
    return 'ouvert';
  }
}

export function CopilotChat({
  forceMode,
  hideQuickQuestions,
  composerToolbar,
  onIntercept,
  onMessageSent,
  showStudioDraft = false,
  onOpenStudioDraft,
  onPrepareStudioDetailed,
}: {
  forceMode?: CopilotMode;
  hideQuickQuestions?: boolean;
  /** Contrôles de l'écran hôte affichés au-dessus du composeur (cf. CopilotInput). */
  composerToolbar?: ReactNode;
  /** CH2 — l'écran hôte peut prendre en charge un message (ex. « génère la prévisualisation ») : true = ne pas l'envoyer. */
  onIntercept?: (text: string, options?: { attachments?: { mediaType: string; data: string; name?: string }[] }) => boolean;
  onMessageSent?: (text: string, options?: Parameters<ReturnType<typeof useCopilot>['sendMessage']>[1]) => void | Promise<void>;
  showStudioDraft?: boolean;
  /** R2 — « Voir en 3D » : `parcelle-requise` fait poser la question minimale dans le dossier. */
  onOpenStudioDraft?: (draft: JarvisDraft, conversationId: string, terrain?: ConfirmedTerrain & { adresse?: string | null }) => Promise<IssueOuvertureStudio>;
  /** R2 — l'ancienne fenêtre de transfert, en mode détaillé (photos, plans, 360°). */
  onPrepareStudioDetailed?: (draft: JarvisDraft, conversationId: string) => Promise<void>;
} = {}) {
  const { messages, sendMessage, cancel, isStreaming, mode, setMode, loadingMessages, currentConversationId } = useCopilot();
  // `vertical` est désormais une valeur mémorisée exposée par le hook.
  // AVANT : `buildContext().vertical` était évalué à chaque rendu — donc à
  // chaque paquet de tokens pendant le streaming — pour lire un seul champ.
  // Chaque appel parcourait tout le localStorage deux fois, désérialisait deux
  // snapshots et imprimait douze lignes de trace. Voir useCopilotContext.
  const { vertical } = useCopilotContext();
  const { pathname } = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [studioRecoveryHint, setStudioRecoveryHint] = useState(false);
  const [fenetre3D, setFenetre3D] = useState<EtatFenetre3D>(lireEtatFenetre3D);
  const [pleinEcran, setPleinEcran] = useState(false);
  const changerFenetre3D = (etat: EtatFenetre3D) => {
    setFenetre3D(etat);
    try { window.localStorage.setItem(CLE_FENETRE_3D, etat); } catch { /* stockage indisponible : l'état reste en mémoire */ }
  };

  // Échap quitte le plein écran (comme une fenêtre agrandie qu'on restaure).
  useEffect(() => {
    if (!pleinEcran) return;
    const surTouche = (event: KeyboardEvent) => { if (event.key === 'Escape') setPleinEcran(false); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [pleinEcran]);
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showStudioDraft || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const latest = [...messages].reverse().find(message => message.role === 'assistant');
    const key = latest ? `${currentConversationId ?? 'new'}:${latest.id}` : null;
    if (!voiceReplies) {
      lastSpokenRef.current = key;
      window.speechSynthesis.cancel();
      return;
    }
    if (isStreaming || !latest || !key || lastSpokenRef.current === key) return;
    lastSpokenRef.current = key;
    const spoken = withoutJarvisDraft(latest.text)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_#|>`]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!spoken || /massing 3d/i.test(spoken) && is3DPreparationRequest(messages.find(message => message.role === 'user')?.text ?? '')) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = 'fr-FR';
    utterance.rate = 1.03;
    window.speechSynthesis.speak(utterance);
  }, [messages, currentConversationId, isStreaming, showStudioDraft, voiceReplies]);

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  // Mode effectif : si forceMode est fourni (ex. MimmozIA en "advanced"),
  // il prime sur le mode global du store — sans jamais écrire dans le store,
  // pour ne pas impacter le drawer flottant partagé.
  const effectiveMode: CopilotMode = forceMode ?? mode;

  // Si le mode est forcé, on envoie toujours dans ce mode (setMode reste global,
  // donc on passe par un sendMessage qui garantit le bon mode à l'appel).
  // V1.8 : `options` relaie les pièces jointes du composeur. Sans ce paramètre,
  // les fichiers joints étaient silencieusement perdus à l'envoi.
  const handleSend = (
    text: string,
    options?: Parameters<typeof sendMessage>[1],
  ) => {
    if (showStudioDraft && /^préparer la demande (?:jarvis|mimmo)[.!?\s]*$/i.test(text.trim().normalize('NFC'))) {
      setStudioRecoveryHint(true);
      return;
    }
    setStudioRecoveryHint(false);
    if (onIntercept?.(text, options as never)) return;
    if (voiceReplies && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    if (forceMode && mode !== forceMode) {
      setMode(forceMode);
    }
    void sendMessage(text, options).then(() => onMessageSent?.(text, options));
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Filet de sécurité : si on entre dans MimmozIA alors que le store est resté
  // sur "quick" (usage précédent du drawer), on aligne une fois sur le mode forcé.
  useEffect(() => {
    if (forceMode && mode !== forceMode) {
      setMode(forceMode);
    }
    // volontairement sur le montage / changement de forceMode uniquement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceMode]);

  const empty = messages.length === 0 && !loadingMessages;
  const projetEnCours = showStudioDraft && messages.some(m => m.role === 'assistant' && Boolean(readJarvisDraft(m.text)));
  const strategyQuestions = pathname === '/promoteur/strategie-projet'
    ? getCopilotQuickQuestions({ pathname, mode: effectiveMode === 'quick' ? 'quick' : 'advanced' }) : null;

  return (
    <div className={`copilot-chat${showStudioDraft ? ` copilot-chat--jarvis is-3d-${fenetre3D}${pleinEcran ? ' is-plein-ecran' : ''}` : ''}`}>
      {showStudioDraft && <header className="mzia-fen__barre" onDoubleClick={event => {
        if ((event.target as HTMLElement).closest('button')) return;
        setPleinEcran(value => !value);
      }}>
        <div className="mzia-fen__titre">Mimmo<small>Atelier 3D</small></div>
        <div className="mzia-fen__espace" />
        <div className="mzia-fen__outils">
          <span className={`mzia-fen__statut${isStreaming ? ' is-actif' : ''}`} role="status">
            <i aria-hidden="true" /><span>{isStreaming ? 'Analyse en cours…' : 'En ligne'}</span>
          </span>
          {'speechSynthesis' in window && <button type="button" className="mzia-fen__outil"
            aria-pressed={voiceReplies} title={voiceReplies ? 'Désactiver la lecture vocale' : 'Lire les réponses à voix haute'}
            aria-label={voiceReplies ? 'Désactiver la lecture vocale' : 'Activer la lecture vocale'}
            onClick={() => setVoiceReplies(value => !value)}>
            {voiceReplies ? <Volume2 size={15} /> : <VolumeX size={15} />}<span>Voix</span>
          </button>}
          <button type="button" className="mzia-fen__outil" aria-pressed={fenetre3D !== 'ferme'}
            title={fenetre3D === 'ferme' ? 'Afficher l’espace 3D' : 'Masquer l’espace 3D'}
            aria-label={fenetre3D === 'ferme' ? 'Afficher l’espace 3D' : 'Masquer l’espace 3D'}
            onClick={() => changerFenetre3D(fenetre3D === 'ferme' ? 'ouvert' : 'ferme')}>
            <Box size={15} /><span>Espace 3D</span>
            {fenetre3D === 'ferme' && projetEnCours && <i className="mzia-fen__pastille" aria-hidden="true" />}
          </button>
        </div>
        <div className="mzia-fen__boutons">
          <BoutonFenetre libelle={pleinEcran ? 'Restaurer (Échap)' : 'Agrandir'} onClick={() => setPleinEcran(value => !value)}>
            {pleinEcran ? <GlypheRestaurer /> : <GlypheAgrandir />}
          </BoutonFenetre>
        </div>
      </header>}
      <FollowupPanel conversationId={currentConversationId} onSend={handleSend} isStreaming={isStreaming} />
      {showStudioDraft && <div className="jarvis-console-rail">
        {fenetre3D === 'reduit' && <button type="button" className="mzia-fen3d__bande"
          onClick={() => changerFenetre3D('ouvert')} title="Rouvrir l’espace 3D" aria-label="Rouvrir l’espace 3D">
          <Box size={16} /><span>Espace 3D</span>
        </button>}
        {/* Le dossier reste monté quand la fenêtre est réduite ou fermée : une saisie en cours n'est pas perdue. */}
        <section className="mzia-fen3d" aria-label="Espace 3D" hidden={fenetre3D === 'reduit'}>
          <header className="mzia-fen__barre" onDoubleClick={event => {
            if ((event.target as HTMLElement).closest('button')) return;
            changerFenetre3D(fenetre3D === 'large' ? 'ouvert' : 'large');
          }}>
            <div className="mzia-fen__titre">Espace 3D<small>Dossier du projet</small></div>
            <div className="mzia-fen__espace" />
            <div className="mzia-fen__boutons">
              <BoutonFenetre libelle="Réduire sur le côté" onClick={() => changerFenetre3D('reduit')}><GlypheReduire /></BoutonFenetre>
              <span className="mzia-fen__btn--agrandir3d">
                <BoutonFenetre libelle={fenetre3D === 'large' ? 'Restaurer' : 'Agrandir'}
                  onClick={() => changerFenetre3D(fenetre3D === 'large' ? 'ouvert' : 'large')}>
                  {fenetre3D === 'large' ? <GlypheRestaurer /> : <GlypheAgrandir />}
                </BoutonFenetre>
              </span>
              <BoutonFenetre libelle="Fermer l’espace 3D" fermer onClick={() => changerFenetre3D('ferme')}><GlypheFermer /></BoutonFenetre>
            </div>
          </header>
          <div className="mzia-fen3d__contenu">
            <JarvisDraftPanel key={currentConversationId ?? 'new'} messages={messages} conversationId={currentConversationId} onOpenStudio={onOpenStudioDraft} onPrepareDetailed={onPrepareStudioDetailed} />
          </div>
        </section>
      </div>}
      <div ref={scrollRef} className="copilot-chat__messages">
        {studioRecoveryHint && <div role="status" className="jarvis-legacy-reply">
          <strong>Cette action se fait dans l’onglet Mimmoza Studio.</strong>
          <p>Dans la fenêtre « Sauvegarde locale disponible », cliquez sur « Charger la nouvelle maquette ». Si Studio n’est pas ouvert, utilisez « Préparer dans Studio » dans le dossier 3D ci-dessus.</p>
        </div>}
        {empty ? (
          <CopilotEmptyState
            vertical={vertical}
            mode={effectiveMode}
            onPick={(s) => handleSend(s)}
            hideQuickQuestions={hideQuickQuestions}
          />
        ) : (
          messages.map((m, index) => {
            const previousUser = [...messages.slice(0, index)].reverse().find(item => item.role === 'user');
            const oldMassingReply = showStudioDraft && m.role === 'assistant'
              && is3DPreparationRequest(previousUser?.text ?? '')
              && /massing 3d/i.test(m.text) && !readJarvisDraft(m.text);
            if (oldMassingReply) return <div key={m.id} role="status" className="jarvis-legacy-reply">
              <strong>Votre projet est prêt dans le Dossier 3D.</strong>
              <p>Vérifiez les dimensions et les logements, puis choisissez « Valider et préparer dans Studio ».</p>
              <details><summary>Voir la réponse de Mimmo utilisant l’ancien parcours Massing 3D</summary>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              </details>
            </div>;
            if (showStudioDraft && m.role === 'assistant' && /je ne connais pas de fonction ou de module appelé/i.test(m.text) && /jarvis/i.test(m.text)) {
              return <div key={m.id} role="status" className="jarvis-legacy-reply">
                <strong>Correction : Mimmo prépare bien vos maquettes dans l’atelier 3D de Mimmoza.</strong>
                <p>Pour préparer la nouvelle maquette, passez dans l’onglet Mimmoza Studio et cliquez sur « Charger la nouvelle maquette » dans la fenêtre de sauvegarde locale.</p>
                <details><summary>Voir la réponse erronée</summary><div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div></details>
              </div>;
            }
            return <CopilotMessage key={m.id} message={m} conversationId={currentConversationId} onSend={handleSend} />;
          })
        )}
      </div>
      {!empty && strategyQuestions && <div aria-label="Questions pour cette étude" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '9px 12px', borderTop: `1px solid ${T.borderSoft}` }}>
        {strategyQuestions.map((question) => <button key={question.label} type="button" onClick={() => handleSend(question.prompt)} disabled={isStreaming}
          style={{ flexShrink: 0, border: `1px solid ${T.border}`, borderRadius: 999, background: T.accentSoft,
            color: T.text, padding: '6px 10px', fontSize: 11, cursor: isStreaming ? 'not-allowed' : 'pointer', opacity: isStreaming ? 0.5 : 1 }}>{question.label}</button>)}
      </div>}
      <CopilotInput
        mode={effectiveMode}
        onChangeMode={setMode}
        onSend={(t, options) => handleSend(t, options)}
        onCancel={cancel}
        isStreaming={isStreaming}
        hideModeSelector={Boolean(forceMode)}
        toolbar={composerToolbar}
      />
      <div className="copilot-chat__disclaimer" style={{ color: T.textMuted, borderTop: `1px solid ${T.borderSoft}` }}>
        ⚠️ Mimmo peut commettre des erreurs. Les analyses doivent être vérifiées,
        notamment pour les données juridiques, urbanistiques, fiscales ou financières.
      </div>
    </div>
  );
}
