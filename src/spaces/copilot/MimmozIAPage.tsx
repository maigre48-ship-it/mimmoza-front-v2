import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin, Home, TrendingUp, Gauge, LandPlot, Sparkles,
  Paperclip, Mic, ArrowUp, X,
  ShieldCheck, Lock, BrainCircuit, GitBranch, Plus, Menu,
} from 'lucide-react';

import { CopilotChat } from './components/CopilotChat';
import { useCopilot } from './hooks/useCopilot';
import { MimmozIAOrb, type MimmozIAOrbState } from './components/MimmozIAOrb';
import { MimmozIAQuickAction } from './components/MimmozIAQuickAction';
import { MimmozIAStatus } from './components/MimmozIAStatus';
import { MimmozIASidebar } from './MimmozIASidebar';
import { MimmozIAModelPicker, type ModelTier, type Plan as PickerPlan } from './components/MimmozIAModelPicker';
import { usePlanAccess } from '@/lib/billing/usePlanAccess';
import { supabase } from '@/lib/supabaseClient';
import { track, type MimmoziaEventPayload } from '@/lib/mimmozia/track';
import './MimmozIAPage.css';
import { useMimmozIAProfile } from '@/lib/mimmozia/useMimmozIAProfile';
import AlertesAccueil from '@/components/AlertesAccueil';
import { useCopilotStore } from './store/copilotStore';

/* =========================================================================
   ⚠️  POINTS D'INTÉGRATION (à vérifier une fois dans useCopilot.ts).
   Chaque helper s'adapte au runtime aux noms les plus probables.
   ========================================================================= */

/** V1.7 — Pièce jointe. Type défini LOCALEMENT pour que cette page compile
 *  sans dépendre du patch copilot.types.ts. Quand ce dernier sera en place,
 *  remplacer par : import type { CopilotAttachment } from './types/copilot.types'; */
interface CopilotAttachment {
  mediaType: string;   // image/png|jpeg|gif|webp ou application/pdf
  data: string;        // base64 SANS le prefixe data:
  name?: string;
}

type SendFn = (
  text: string,
  options?: { attachments?: CopilotAttachment[] },
) => unknown | Promise<unknown>;

/** Pièce jointe côté UI : le base64 + de quoi afficher une pastille. */
interface UiAttachment extends CopilotAttachment {
  id: string;
  name: string;
  size: number;
}

const ACCEPT_FILES = 'image/png,image/jpeg,image/gif,image/webp,application/pdf';
const MAX_FILE_BYTES = 3 * 1024 * 1024;   // 3 Mo par fichier
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;  // 4 Mo cumulés (le base64 gonfle de 33 %)

/** Lit un fichier en base64 SANS le préfixe `data:…;base64,`. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(new Error('lecture impossible'));
    r.readAsDataURL(file);
  });
}

interface LooseCopilotApi {
  credits?: unknown;
  /** Niveau de modèle courant + son setter (store copilot, V1.5). */
  tier?: ModelTier;
  setTier?: (t: ModelTier) => void;
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
 * Source autoritaire : users_profiles.full_name ; repli user_metadata.
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

        let raw: string | undefined;
        if (uid) {
          const { data: profile } = await supabase
            .from('users_profiles')
            .select('full_name')
            .eq('id', uid)
            .maybeSingle();
          raw = pick(profile?.full_name);
        }
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

const SIDEBAR_KEY = 'mzia.sidebar.collapsed';

export default function MimmozIAPage() {
  const copilot = useCopilot() as unknown as LooseCopilotApi;
  const mimmoziaView = useCopilotStore((state) => state.mimmoziaView);
  const firstName = useDisplayFirstName();
  const { tagline } = useMimmozIAProfile();
  const send = useMemo(() => pickSend(copilot), [copilot]);

  // --- Sidebar : repli (persistant) + drawer mobile ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);
  const toggleCollapsed = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, []);

  // Le store est l'unique source de vérité : le bouton + et le logo peuvent
  // ainsi déclencher exactement le même retour à l'accueil.
  const conversationActive = mimmoziaView === 'conversation' && hasActiveConversation(copilot);

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
  /** La dictée n'existe que si le navigateur expose SpeechRecognition (Chrome,
   *  Edge, Safari récents — PAS Firefox) ET que la page est en HTTPS. */
  const dictationSupported = useMemo(
    () => typeof window !== 'undefined' &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    [],
  );
  const orbState: MimmozIAOrbState = successFlash ? 'success'
    : live !== 'idle' ? live
    : recording ? 'listening' : 'idle';
  const activeTools = deriveActiveTools(copilot);

  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // --- V1.7 : pièces jointes (images + PDF) --------------------------------
  const [attachments, setAttachments] = useState<UiAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachError(null);
    const accepted: UiAttachment[] = [];
    let total = attachments.reduce((s, a) => s + a.size, 0);

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(`« ${file.name} » dépasse 3 Mo.`);
        continue;
      }
      if (total + file.size > MAX_TOTAL_BYTES) {
        setAttachError('Taille cumulée des pièces jointes dépassée (4 Mo).');
        break;
      }
      try {
        accepted.push({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          size: file.size,
          mediaType: file.type,
          data: await readAsBase64(file),
        });
        total += file.size;
      } catch {
        setAttachError(`Lecture impossible : ${file.name}`);
      }
    }
    if (accepted.length) {
      setAttachments((prev) => [
        ...prev,
        ...accepted.filter((a) => !prev.some((p) => p.id === a.id)),
      ]);
    }
  }, [attachments]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // --- Niveau d'analyse (V1.5) : la valeur vit dans le store copilot, le plan
  //     décide des niveaux sélectionnables. copilot-chat revérifie de toute
  //     façon via resolveTier : cette UI est un confort, pas la sécurité.
  const { plan: planId } = usePlanAccess();
  const plan: PickerPlan =
    planId === 'pro' || planId === 'proplus' ? 'pro'
    : planId === 'avance' ? 'advanced'
    : 'basic';                                   // basique + tout inconnu
  const tier: ModelTier = copilot.tier ?? 'sonnet';

  useEffect(() => {
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
    const files = attachments.map(({ mediaType, data, name }) => ({ mediaType, data, name }));
    try {
      if (send) await send(message, files.length ? { attachments: files } : undefined);
      else console.warn('[MimmozIA] Aucune fonction d’envoi détectée — voir INTEGRATION.md.');
      setAttachments([]);
      setAttachError(null);
    } catch (err) {
      console.error('[MimmozIA] Échec de l’envoi :', err);
    }
  }, [send, attachments]);

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
    useCopilotStore.getState().newConversation();
    setDraft('');
    setAttachments([]);
  }, []);

  const recognitionRef = useRef<any>(null);
  const toggleDictation = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setAttachError('Dictée non prise en charge par ce navigateur (essayez Chrome ou Edge).');
      return;
    }
    if (recording) { recognitionRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { setAttachError(null); setRecording(true); };
    rec.onresult = (e: any) => {
      let tr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) tr += e.results[i][0].transcript;
      setDraft((prev) => (prev ? `${prev} ${tr}` : tr));
    };
    rec.onend = () => setRecording(false);
    // Sans onerror, une permission micro refusée échoue en silence et l'orbe
    // reste bloquée en 'listening'.
    rec.onerror = (e: any) => {
      console.warn('[MimmozIA] dictée :', e?.error);
      setRecording(false);
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        setAttachError('Accès au micro refusé. Autorisez-le dans les réglages du navigateur.');
      } else if (e?.error === 'network') {
        setAttachError('Reconnaissance vocale indisponible (service distant injoignable).');
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.warn('[MimmozIA] démarrage dictée impossible :', err);
      setRecording(false);
    }
  }, [recording]);
  useEffect(() => () => recognitionRef.current?.stop?.(), []);

  const greeting = firstName ? `Bonjour ${firstName}` : 'Bonjour';

  const pageClass = [
    'mzia-page',
    conversationActive ? 'is-chatting' : 'is-welcome',
    'has-sidebar',
    sidebarCollapsed ? 'sidebar-collapsed' : '',
    mobileOpen ? 'mobile-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={pageClass}>
      {/* ============ MENU LATÉRAL ============ */}
      <button
        type="button"
        className="mzia-side__mobiletoggle"
        onClick={() => setMobileOpen(true)}
        title="Ouvrir le menu"
        aria-label="Ouvrir les conversations et projets"
        aria-controls="mzia-conversation-sidebar"
        aria-expanded={mobileOpen}
      >
        <Menu size={18} />
      </button>
      <button
        type="button"
        className="mzia-side__overlay"
        onClick={() => setMobileOpen(false)}
        aria-label="Fermer le menu"
      />
      <MimmozIASidebar
        copilot={copilot}
        onNewConversation={handleNewConversation}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleCollapsed}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Bouton "Nouvelle conversation" flottant conservé en conversation */}
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
              {tagline
                ? `${tagline} Que voulez-vous étudier aujourd’hui\u00A0?`
                : 'Je peux analyser un bien, un terrain, un projet — ou répondre à toutes vos questions immobilières.'}
            </p>
            <AlertesAccueil />
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
              {(attachments.length > 0 || attachError) && (
                <div className="mzia-attachments">
                  {attachments.map((a) => (
                    <span key={a.id} className="mzia-chip" title={a.name}>
                      <Paperclip size={13} />
                      <span className="mzia-chip__name">{a.name}</span>
                      <button type="button" className="mzia-chip__x"
                        onClick={() => removeAttachment(a.id)} title="Retirer">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {attachError && <span className="mzia-attachments__err">{attachError}</span>}
                </div>
              )}

              <textarea ref={inputRef} className="mzia-launcher__input" rows={1}
                placeholder="Écrivez ou dictez votre message…" value={draft}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown} />

              {/* Sélecteur de fichiers : caché, déclenché par le trombone.
                  On remet value='' après coup pour pouvoir rechoisir le même fichier. */}
              <input ref={fileInputRef} type="file" hidden multiple accept={ACCEPT_FILES}
                onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }} />

              <div className="mzia-launcher__tools">
                <MimmozIAModelPicker
                  plan={plan}
                  value={tier}
                  onChange={(t) => copilot.setTier?.(t)}
                  disabled={busy}
                />
                <button type="button" className="mzia-iconbtn" title="Joindre un fichier (image ou PDF)"
                  onClick={() => fileInputRef.current?.click()}><Paperclip size={18} /></button>
                <button type="button" disabled={!dictationSupported}
                  title={dictationSupported ? 'Dicter' : 'Dictée non prise en charge par ce navigateur'}
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
