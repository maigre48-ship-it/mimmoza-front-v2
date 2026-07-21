import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin, Home, TrendingUp, Gauge, LandPlot, Sparkles,
  Paperclip, ImagePlus, Mic, ArrowUp,
  ShieldCheck, Lock, BrainCircuit, GitBranch, Plus,
} from 'lucide-react';

import { CopilotChat } from './components/CopilotChat';
import { useCopilot } from './hooks/useCopilot';
import { MimmozIAOrb, type MimmozIAOrbState } from './components/MimmozIAOrb';
import { MimmozIAQuickAction } from './components/MimmozIAQuickAction';
import { MimmozIAStatus } from './components/MimmozIAStatus';
import { supabase } from '@/lib/supabaseClient';
import { track, type MimmoziaEventPayload } from '@/lib/mimmozia/track';
import './MimmozIAPage.css';

/* =========================================================================
   ⚠️  POINTS D'INTÉGRATION (à vérifier une fois dans useCopilot.ts).
   Chaque helper s'adapte au runtime aux noms les plus probables.
   ========================================================================= */
type SendFn = (text: string) => unknown | Promise<unknown>;

interface LooseCopilotApi {
  credits?: unknown;
  refreshCredits?: () => unknown;
  loadConversations?: () => unknown;
  sendMessage?: SendFn; send?: SendFn; submitMessage?: SendFn; ask?: SendFn; createMessage?: SendFn;
  newConversation?: () => unknown; startNewConversation?: () => unknown;
  resetConversation?: () => unknown; clearConversation?: () => unknown;
  activeConversationId?: string | null; currentConversationId?: string | null; conversationId?: string | null;
  currentConversation?: { messages?: unknown[] } | null;
  messages?: unknown[];
  isStreaming?: boolean; streaming?: boolean; isSearching?: boolean; toolRunning?: boolean;
  isLoading?: boolean; loading?: boolean; isThinking?: boolean;
  status?: string; phase?: string;
  error?: unknown; lastError?: unknown;
  activeTools?: unknown; runningTools?: unknown; tools?: unknown;
  [key: string]: unknown;
}

const pickSend = (a: LooseCopilotApi): SendFn | undefined =>
  a.sendMessage ?? a.send ?? a.submitMessage ?? a.ask ?? a.createMessage;
const pickNew = (a: LooseCopilotApi): (() => unknown) | undefined =>
  a.newConversation ?? a.startNewConversation ?? a.resetConversation ?? a.clearConversation;

/** Vrai si la conversation active contient ≥1 message (couvre la reprise d'historique). */
function hasActiveConversation(a: LooseCopilotApi): boolean {
  if (Array.isArray(a.currentConversation?.messages) && a.currentConversation!.messages!.length > 0) return true;
  if (Array.isArray(a.messages) && a.messages.length > 0) return true;
  return Boolean(a.activeConversationId || a.currentConversationId || a.conversationId);
}

function deriveLiveState(a: LooseCopilotApi): MimmozIAOrbState {
  if (a.error || a.lastError) return 'error';
  if (a.isStreaming || a.streaming || a.status === 'streaming' || a.status === 'responding') return 'responding';
  if (a.isSearching || a.toolRunning || a.status === 'tool' || a.phase === 'search') return 'searching';
  if (a.isLoading || a.loading || a.isThinking || a.status === 'thinking' || a.status === 'pending') return 'thinking';
  return 'idle';
}

function deriveActiveTools(a: LooseCopilotApi): string[] {
  const raw = (a.activeTools ?? a.runningTools ?? a.tools) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === 'string' ? t : (t as { label?: string; name?: string })?.label ?? (t as { name?: string })?.name))
    .filter((x): x is string => Boolean(x))
    .slice(0, 4);
}

/**
 * Prénom d'affichage pour l'accueil personnalisé.
 * Best-effort depuis les métadonnées Supabase (signup standard). Dégrade
 * proprement vers `undefined` → l'accueil affiche « Bonjour » sans prénom.
 *
 * ⚠️ SI ton prénom vit dans une table `profiles` (et non dans user_metadata),
 *    dis-le-moi : je remplace ce corps par une lecture de `profiles`.
 */
function useDisplayFirstName(): string | undefined {
  const [firstName, setFirstName] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

        // Source autoritaire : users_profiles.full_name
        let raw: string | undefined;
        if (uid) {
          const { data: profile } = await supabase
            .from('users_profiles')
            .select('full_name')
            .eq('id', uid)              // ⚠️ si la clé est `user_id`, remplace 'id' par 'user_id'
            .maybeSingle();
          raw = pick(profile?.full_name);
        }
        // Repli : métadonnées d'inscription
        if (!raw) {
          const m = (auth.user?.user_metadata ?? {}) as Record<string, unknown>;
          raw = pick(m.first_name) ?? pick(m.firstName) ?? pick(m.prenom) ?? pick(m.name);
        }
        if (alive) setFirstName(raw ? raw.split(/\s+/)[0] : undefined);
      } catch {
        /* silencieux → « Bonjour » */
      }
    })();
    return () => { alive = false; };
  }, []);
  return firstName;
}

interface QuickAction {
  icon: typeof MapPin;
  title: string;
  subtitle: string;
  prompt: string;
  side: 'left' | 'right';
  /** Signal (facultatif) versé au profil dès que l'utilisateur clique l'action. */
  signal?: MimmoziaEventPayload;
}
const QUICK_ACTIONS: QuickAction[] = [
  { icon: MapPin, title: 'Analyser une adresse', subtitle: 'Faisabilité, contraintes, potentiel', side: 'left', prompt: 'Analyse cette adresse (faisabilité, contraintes réglementaires et potentiel) : ' },
  { icon: Home, title: 'Estimer un bien', subtitle: 'Valeur, tendances, comparables', side: 'left', prompt: 'Estime la valeur de ce bien (tendances de marché et comparables DVF) : ', signal: { strategy: 'estimation' } },
  { icon: TrendingUp, title: 'Calculer une rentabilité', subtitle: 'Cash-flow, TRI, rendement, scénarios', side: 'left', prompt: 'Calcule la rentabilité de cette opération (cash-flow, TRI, rendement et scénarios) : ', signal: { strategy: 'rendement' } },
  { icon: Gauge, title: 'Expliquer un DPE', subtitle: 'Points clés et recommandations', side: 'right', prompt: 'Explique ce DPE : points clés, faiblesses et recommandations de travaux : ' },
  { icon: LandPlot, title: 'Étudier un terrain', subtitle: 'PLU, règles, constructibilité, réseaux', side: 'right', prompt: 'Étudie ce terrain : règles du PLU, constructibilité, contraintes et réseaux : ', signal: { property_type: 'terrain' } },
  { icon: Sparkles, title: 'Trouver des opportunités', subtitle: 'Biens, terrains, off-market, appels d’offres', side: 'right', prompt: 'Trouve des opportunités immobilières (biens, terrains, off-market, appels d’offres) selon ces critères : ' },
];
const TRUST = [
  { icon: ShieldCheck, label: 'Données publiques vérifiées' },
  { icon: Lock, label: 'Analyses sécurisées' },
  { icon: BrainCircuit, label: 'IA spécialisée immobilier' },
  { icon: GitBranch, label: 'Sources et hypothèses traçables' },
];

export default function MimmozIAPage() {
  const copilot = useCopilot() as unknown as LooseCopilotApi;
  const firstName = useDisplayFirstName();
  const send = useMemo(() => pickSend(copilot), [copilot]);

  // --- Détection du mode conversation (store d'abord, filet local) ---
  const storeActive = hasActiveConversation(copilot);
  const [optimistic, setOptimistic] = useState(false);
  const [welcomeOverride, setWelcomeOverride] = useState(false);
  const conversationActive = !welcomeOverride && (storeActive || optimistic);

  // --- État de l'orbe = miroir de l'état réel du Copilot ---
  const live = deriveLiveState(copilot);
  const busy = live === 'thinking' || live === 'searching' || live === 'responding';
  const prevBusy = useRef(false);
  const [successFlash, setSuccessFlash] = useState(false);
  useEffect(() => {
    if (prevBusy.current && !busy && live !== 'error') {
      setSuccessFlash(true);
      const t = window.setTimeout(() => setSuccessFlash(false), 850);
      prevBusy.current = busy;
      return () => window.clearTimeout(t);
    }
    prevBusy.current = busy;
  }, [busy, live]);

  const [recording, setRecording] = useState(false);
  const orbState: MimmozIAOrbState = successFlash ? 'success'
    : live !== 'idle' ? live
    : recording ? 'listening' : 'idle';
  const activeTools = deriveActiveTools(copilot);

  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 1er geste tracé : MimmozIA commence à apprendre les habitudes (horaires,
    // fréquence). No-op si l'utilisateur a désactivé l'apprentissage.
    void track('session_start');
    void copilot.refreshCredits?.();
    void copilot.loadConversations?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const startWith = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    void track('search', { source: 'mimmozia' });
    setWelcomeOverride(false);
    setOptimistic(true);
    try {
      if (send) await send(message);
      else console.warn('[MimmozIA] Aucune fonction d’envoi détectée — voir INTEGRATION.md.');
    } catch (err) {
      console.error('[MimmozIA] Échec de l’envoi :', err);
    }
  }, [send]);

  const handleLauncherSend = useCallback(() => { void startWith(draft); setDraft(''); }, [draft, startWith]);
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleLauncherSend(); }
  }, [handleLauncherSend]);

  const handleQuickAction = useCallback((qa: QuickAction) => {
    if (qa.signal) void track('filter_apply', qa.signal);
    setDraft(qa.prompt);
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, []);

  const handleNewConversation = useCallback(() => {
    pickNew(copilot)?.();
    setOptimistic(false);
    setWelcomeOverride(true);
    setDraft('');
  }, [copilot]);

  const recognitionRef = useRef<any>(null);
  const toggleDictation = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (recording) { recognitionRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => setRecording(true);
    rec.onresult = (e: any) => {
      let tr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) tr += e.results[i][0].transcript;
      setDraft((prev) => (prev ? `${prev} ${tr}` : tr));
    };
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
  }, [recording]);
  useEffect(() => () => recognitionRef.current?.stop?.(), []);

  const greeting = firstName ? `Bonjour ${firstName}` : 'Bonjour';

  return (
    <div className={`mzia-page ${conversationActive ? 'is-chatting' : 'is-welcome'}`}>
      {/* En-tête interne retiré. Seul le bouton "Nouvelle conversation" subsiste en conversation. */}
      {conversationActive && (
        <button
          type="button"
          className="mzia-fab mzia-fab--newchat"
          onClick={handleNewConversation}
          title="Nouvelle conversation"
        >
          <Plus size={14} />Nouvelle conversation
        </button>
      )}

      {conversationActive ? (
        /* ============ ÉTAT CONVERSATION : chat pleine largeur + orbe flottante ============ */
        <div className="mzia-conversation-layout">
          <div className="mzia-chat-orb" aria-hidden>
            <MimmozIAOrb state={orbState} />
            <MimmozIAStatus state={orbState} compact />
          </div>
          <div className="mzia-chat-content">
            <CopilotChat forceMode="advanced" hideQuickQuestions />
          </div>
        </div>
      ) : (
        /* ============ ÉTAT ACCUEIL : orbe centrale + cartes + saisie ============ */
        <main className="mzia-welcome">
          <div className="mzia-hero">
            <h1 className="mzia-hero__title">
              {greeting}
              <br />
              Que souhaitez-vous <em>analyser</em> aujourd’hui&nbsp;?
            </h1>
            <p className="mzia-hero__sub">
              Je peux analyser un bien, un terrain, un projet — ou répondre à toutes vos questions immobilières.
            </p>
          </div>

          <div className="mzia-welcome__stage">
            <div className="mzia-qa-col mzia-qa-col--left">
              {QUICK_ACTIONS.filter((q) => q.side === 'left').map((qa) => (
                <MimmozIAQuickAction key={qa.title} icon={qa.icon} title={qa.title}
                  subtitle={qa.subtitle} side="left" onClick={() => handleQuickAction(qa)} />
              ))}
            </div>

            <div className="mzia-welcome__orb">
              <MimmozIAOrb state={orbState} />
              <MimmozIAStatus state={orbState} tools={activeTools} />
            </div>

            <div className="mzia-qa-col mzia-qa-col--right">
              {QUICK_ACTIONS.filter((q) => q.side === 'right').map((qa) => (
                <MimmozIAQuickAction key={qa.title} icon={qa.icon} title={qa.title}
                  subtitle={qa.subtitle} side="right" onClick={() => handleQuickAction(qa)} />
              ))}
            </div>
          </div>

          <div className="mzia-launcher">
            <div className="mzia-launcher__field">
              <textarea ref={inputRef} className="mzia-launcher__input" rows={1}
                placeholder="Écrivez ou dictez votre message…" value={draft}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown} />
              <div className="mzia-launcher__tools">
                <button type="button" className="mzia-iconbtn" title="Joindre un fichier"
                  onClick={() => setOptimistic(true)}><Paperclip size={18} /></button>
                <button type="button" className="mzia-iconbtn" title="Ajouter une photo"
                  onClick={() => setOptimistic(true)}><ImagePlus size={18} /></button>
                <button type="button" title="Dicter"
                  className={`mzia-iconbtn mzia-iconbtn--rec${recording ? ' is-active' : ''}`}
                  onClick={toggleDictation}><Mic size={18} /></button>
                <button type="button" className="mzia-send" title="Envoyer"
                  disabled={!draft.trim()} onClick={handleLauncherSend}><ArrowUp size={18} /></button>
              </div>
            </div>
          </div>

          <div className="mzia-trust">
            {TRUST.map(({ icon: Icon, label }) => (
              <span key={label} className="mzia-trust__item"><Icon size={13} />{label}</span>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}