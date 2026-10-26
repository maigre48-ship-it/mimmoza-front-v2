import { texteDictee } from './utils/texteDictee';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin, Home, TrendingUp, Gauge, LandPlot, Sparkles,
  Paperclip, Mic, ArrowUp, X, Box,
  ShieldCheck, Lock, BrainCircuit, GitBranch, Plus, Menu,
} from 'lucide-react';

import { CopilotChat } from './components/CopilotChat';
import { useCopilot } from './hooks/useCopilot';
import { MimmozIAOrb, type MimmozIAOrbState } from './components/MimmozIAOrb';
import { phaseReponseEnFlux, reponseClairementNegative } from './components/orbResponseOutcome';
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
import { PreparationStudio3D } from './studio3d/PreparationStudio3D';
import { draftBrief, is3DPreparationRequest, latestJarvisDraft, studioCommand, studioComposition, studioSegmentedVolume, type JarvisDraft, type JarvisStudioBuilding, type JarvisSegment } from './studio3d/jarvisDraft';
import { listJarvisTransferFiles, retainJarvisFiles, type JarvisStoredFile } from './studio3d/jarvisFiles';
import { STUDIO_BRIDGE_CHANNEL, activeStudioSession, readStudioVolumeMessage, rememberStudioSession, saveStudioVolume } from './studio3d/studioBridge';
import type { ConfirmedTerrain } from './studio3d/terrainCadastre';
import { urlStudio3D } from '@/spaces/promoteur/shared/ouvrirStudio3D';
// R2 — chat → Studio en un clic, dans la page (panneau même origine), sans perte.
import { StudioIntegre, type DemandeStudioIntegre } from './studio3d/StudioIntegre';
import { adresseStudioIntegre, projetIdChat } from './studio3d/projetChat';
import { prechargerRelief, reliefAvecDelai } from './studio3d/reliefCache';
import { parcelleRetenue, retenirParcelle } from './studio3d/parcelleConfirmee';
import { parcelId } from './studio3d/parcelFromGps';
import { demandePrevisualisation } from './studio3d/intentionPrevisualisation';
import type { IssueOuvertureStudio } from './studio3d/JarvisDraftPanel';
import { avecProchaineRevision, preparerChargeVoirEn3D } from './studio3d/chargeVoirEn3D';
import { empreinteProjet } from '@/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2';
import { urlStudio } from '@/lib/studioConfig';
// Premier contact guidé : encart + checklist chargés en différé ; le suivi des
// exports PDF et la réservation de place sont des modules légers.
import { useSuiviExportPdf } from './onboarding/useSuiviExportPdf';
import { affichageMemorise } from './onboarding/reserve';
const PremierContact = lazy(() => import('./onboarding/PremierContact'));

/** CH2 — pièce jointe base64 du tchat → File (pour l'envoyer au Studio 3D). */
async function versFichier(a: { mediaType: string; data: string; name?: string }): Promise<File> {
  const blob = await (await fetch(`data:${a.mediaType};base64,${a.data}`)).blob();
  return new File([blob], a.name ?? 'piece-jointe', { type: a.mediaType });
}

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
  selectConversation?: (id: string) => unknown;
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
  if (a.isStreaming || a.streaming || a.status === 'streaming' || a.status === 'responding')
    return phaseReponseEnFlux((a.messages ?? []) as { role?: string; text?: string }[]);
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
const StudioHeroBuilding3D = lazy(() => import('./studio3d/StudioHeroBuilding3D').then(module => ({ default: module.StudioHeroBuilding3D })));

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
  const { tagline, profile: profilAppris } = useMimmozIAProfile();
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
  const [completionFlash, setCompletionFlash] = useState<'success' | 'negative' | null>(null);
  const dernierTexteAssistant = [...(Array.isArray(copilot.messages) ? copilot.messages : [])]
    .reverse().find((message) => (message as { role?: string }).role === 'assistant') as { text?: string } | undefined;
  const conclusionNegative = reponseClairementNegative(dernierTexteAssistant?.text ?? '');
  useEffect(() => {
    if (prevBusy.current && !busy && live !== 'error') {
      setCompletionFlash(conclusionNegative ? 'negative' : 'success');
      const t = window.setTimeout(() => setCompletionFlash(null), 850);
      prevBusy.current = busy;
      return () => window.clearTimeout(t);
    }
    prevBusy.current = busy;
  }, [busy, live, conclusionNegative]);

  const [recording, setRecording] = useState(false);
  /** La dictée n'existe que si le navigateur expose SpeechRecognition (Chrome,
   *  Edge, Safari récents — PAS Firefox) ET que la page est en HTTPS. */
  const dictationSupported = useMemo(
    () => typeof window !== 'undefined' &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    [],
  );
  const orbState: MimmozIAOrbState = live !== 'idle' ? live
    : completionFlash ?? (recording ? 'listening' : 'idle');
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
    const linkedConversation = new URLSearchParams(window.location.search).get('conversation');
    if (linkedConversation && /^[0-9a-f-]{36}$/i.test(linkedConversation)) {
      void copilot.selectConversation?.(linkedConversation);
      const url = new URL(window.location.href);
      url.searchParams.delete('conversation');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  // CH2 — préparation de la prévisualisation 3D (parcelles, photos, plans, 360°).
  const [prepa3d, setPrepa3d] = useState<{ ouvert: boolean; key?: string; brief?: string; adresse?: string; fichiers?: File[]; conserves?: JarvisStoredFile[]; commande?: string | null; composition?: JarvisStudioBuilding[] | null; volumeAiles?: JarvisSegment[] | null; terrain?: ConfirmedTerrain }>({ ouvert: false });
  const activeStudioSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const accept = (value: unknown) => {
      const message = readStudioVolumeMessage(value);
      if (!message || message.conversationId !== useCopilotStore.getState().currentConversationId) return;
      const sessionId = activeStudioSession(message.conversationId) ?? activeStudioSessionRef.current;
      if (message.bridgeSessionId !== sessionId) return;
      saveStudioVolume(message);
      window.dispatchEvent(new CustomEvent('mzia-studio-volume', { detail: message }));
    };
    const onStudioVolume = (event: MessageEvent) => {
      try { if (event.origin !== new URL(urlStudio3D()).origin) return; }
      catch { return; }
      accept(event.data);
    };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(STUDIO_BRIDGE_CHANNEL) : null;
    if (channel) channel.onmessage = event => accept(event.data);
    const onStorage = (event: StorageEvent) => {
      const id = useCopilotStore.getState().currentConversationId;
      if (id && event.key === `mzia.studio.volume.${id}` && event.newValue) {
        try { accept(JSON.parse(event.newValue)); } catch { /* stockage malformé */ }
      }
    };
    window.addEventListener('message', onStudioVolume);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('message', onStudioVolume); window.removeEventListener('storage', onStorage); channel?.close(); };
  }, []);
  const ouvrirPrepa3d = useCallback(async (brief?: string, pj?: { mediaType: string; data: string; name?: string }[]) => {
    const fichiers = pj && pj.length > 0 ? await Promise.all(pj.map(versFichier)) : undefined;
    setPrepa3d({ ouvert: true, key: crypto.randomUUID(), brief, fichiers });
  }, []);
  const ouvrirFicheStudio = useCallback(async (fiche: JarvisDraft, conversationId: string, terrain?: ConfirmedTerrain) => {
    const conserves = await listJarvisTransferFiles(conversationId).catch(() => [] as JarvisStoredFile[]);
    const composition = studioComposition(fiche);
    setPrepa3d({ ouvert: true, key: crypto.randomUUID(), brief: draftBrief(fiche), adresse: fiche.localisation ?? undefined, conserves, commande: composition ? null : studioCommand(fiche), composition, volumeAiles: studioSegmentedVolume(fiche), terrain });
  }, []);
  /*
   * R2 — « VOIR EN 3D » EN UN CLIC.
   * Parcelle confirmée (parcours photo/GPS, question minimale, ou retenue pour
   * cette conversation) → projet v2 (identifiant commun `mzchat-<conversation>`)
   * → Studio dans un panneau de la page, qui crée tout de suite le bâtiment ;
   * le relief vient du cache ou suit en tâche de fond (25 s au plus).
   */
  const [studio3d, setStudio3d] = useState<{ demande: DemandeStudioIntegre | null; ouvert: boolean; empreinte: string | null; conversationId: string | null }>({ demande: null, ouvert: false, empreinte: null, conversationId: null });
  const studio3dRef = useRef(studio3d);
  studio3dRef.current = studio3d;
  const voirEn3D = useCallback(async (fiche: JarvisDraft, conversationId: string, terrainArg?: ConfirmedTerrain & { adresse?: string | null }): Promise<IssueOuvertureStudio> => {
    if (terrainArg) retenirParcelle(conversationId, terrainArg);
    const retenue = terrainArg ?? parcelleRetenue(conversationId);
    if (!retenue) {
      window.dispatchEvent(new CustomEvent('mzia-3d-parcelle-requise', { detail: conversationId }));
      return 'parcelle-requise';
    }
    // Charge Studio construite en un seul endroit (aussi utilisée pour les films et visites 360°).
    const { construit, parcelles, insee, reliefConnu, conserves, sessionId, etudeId } = await preparerChargeVoirEn3D(fiche, conversationId, retenue, terrainArg);
    if (!construit.ok) throw new Error(`Transfert vers Studio impossible : ${construit.erreur}.`);
    // Même contenu qu'à l'ouverture précédente, Studio encore chargé : on le remontre, sans renvoi.
    const empreinte = empreinteProjet(construit.projet);
    const avant = studio3dRef.current;
    if (avant.demande && avant.conversationId === conversationId && avant.empreinte === empreinte) {
      setStudio3d({ ...avant, ouvert: true });
      return;
    }
    const projet = avecProchaineRevision(construit.projet, conversationId);
    activeStudioSessionRef.current = sessionId;
    rememberStudioSession(conversationId, sessionId);
    // R1 — point unique de l'adresse de Studio (même origine : <origine>/studio/).
    const url = adresseStudioIntegre(urlStudio(), projetIdChat(conversationId), sessionId, etudeId);
    setStudio3d({
      demande: {
        cle: sessionId, url, sessionId, projet,
        relief: reliefConnu ? { etat: 'inclus', source: terrainArg?.terrainData ? 'mesure' : 'cache' }
          : { etat: 'differe', promesse: reliefAvecDelai(parcelles, insee), relancer: () => reliefAvecDelai(parcelles, insee) },
        implantation: reliefConnu ? null : retenue.implantation ?? null,
        imagesNonEnvoyees: conserves.filter(f => f.kind === 'image').length,
      },
      ouvert: true, empreinte, conversationId,
    });
  }, []);
  const fermerStudio3d = useCallback((vers: 'projet' | 'bilan') => {
    setStudio3d(s => ({ ...s, ouvert: false }));
    // R4/R5 — point d'accroche du bilan en temps réel (même fenêtre, même origine).
    if (vers === 'bilan') {
      const projet = studio3dRef.current.demande?.projet;
      window.dispatchEvent(new CustomEvent('mimmoza:studio-bilan', { detail: { projetId: projet?.projetId ?? null, etudeId: projet?.etudeId ?? null } }));
      // Étude rattachée : le Bilan promoteur (R5) suit le modèle en temps réel ; sinon on reste sur le projet.
      if (projet?.etudeId) window.location.assign(`/promoteur/bilan-promoteur?study=${encodeURIComponent(projet.etudeId)}`);
    }
  }, []);
  // Parcelle déjà retenue pour la conversation : le relief se précharge, « Voir en 3D » n'attendra pas.
  useEffect(() => {
    const id = copilot.currentConversationId;
    const retenue = id ? parcelleRetenue(id) : null;
    if (!retenue) return;
    const insee = typeof retenue.parcel.properties.code_insee === 'string' ? retenue.parcel.properties.code_insee : null;
    prechargerRelief([{ id: parcelId(retenue.parcel), feature: retenue.parcel }], insee);
  }, [copilot.currentConversationId]);
  // R2 — « génère la 3D » (ou « voir en 3D », « ouvre Studio ») : même geste que le bouton, si une fiche existe.
  const intercepter3d = useCallback((text: string) => {
    if (!demandePrevisualisation(text)) return false;
    const state = useCopilotStore.getState();
    const fiche = latestJarvisDraft(state.messages);
    if (!fiche || !state.currentConversationId) return false;
    void voirEn3D(fiche, state.currentConversationId).catch(error => setAttachError(error instanceof Error ? error.message : 'Ouverture de Studio impossible.'));
    return true;
  }, [voirEn3D]);
  const boutonStudio3d = useCallback(() => {
    const state = useCopilotStore.getState();
    const fiche = latestJarvisDraft(state.messages);
    if (fiche && state.currentConversationId) {
      void voirEn3D(fiche, state.currentConversationId).catch(error => setAttachError(error instanceof Error ? error.message : 'Ouverture de Studio impossible.'));
      return;
    }
    void ouvrirPrepa3d();
  }, [voirEn3D, ouvrirPrepa3d]);
  const conserverPieces3d = useCallback(async (text: string, options?: { attachments?: { mediaType: string; data: string; name?: string }[] }) => {
    const files = options?.attachments ?? [];
    if (files.length === 0) return;
    const state = useCopilotStore.getState();
    if (!is3DPreparationRequest(text) && !latestJarvisDraft(state.messages)) return;
    if (state.status === 'error' || !state.currentConversationId) return;
    try {
      await retainJarvisFiles(state.currentConversationId, files);
    } catch (error) {
      setAttachError(error instanceof Error ? `Le dossier 3D n'a pas conservé les pièces jointes : ${error.message}` : 'Enregistrement des pièces jointes impossible.');
    }
  }, []);

  const startWith = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    void track('search', { source: 'mimmozia' });
    const files = attachments.map(({ mediaType, data, name }) => ({ mediaType, data, name }));
    try {
      setAttachError(null);
      if (send) {
        await send(message, files.length ? { attachments: files } : undefined);
        await conserverPieces3d(message, { attachments: files });
      }
      else console.warn('[MimmozIA] Aucune fonction d’envoi détectée — voir INTEGRATION.md.');
      setAttachments([]);
    } catch (err) {
      console.error('[MimmozIA] Échec de l’envoi :', err);
    }
  }, [send, attachments, conserverPieces3d]);

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

  // Premier contact guidé : place réservée (dernier affichage connu), lancement
  // direct d'une demande, ou pré-remplissage de la saisie si un champ manque.
  useSuiviExportPdf();
  const [affichagePremierContact] = useState(affichageMemorise);
  const lancerDepuisAccueil = useCallback((demande: string) => { void startWith(demande); }, [startWith]);
  const preRemplirDepuisAccueil = useCallback((demande: string) => {
    setDraft(demande);
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, []);
  const rendreFocusSaisie = useCallback(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
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
    const base = draft;
    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { setAttachError(null); setRecording(true); };
    rec.onresult = (e: any) => {
      setDraft(texteDictee(base, e.results));
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
  }, [recording, draft]);
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
      <StudioIntegre demande={studio3d.demande} ouvert={studio3d.ouvert} onFermer={fermerStudio3d} />
      <PreparationStudio3D
        key={prepa3d.key ?? 'initial'}
        ouvert={prepa3d.ouvert}
        briefInitial={prepa3d.brief}
        adresseInitiale={prepa3d.adresse}
        fichiersInitiaux={prepa3d.fichiers}
        fichiersConserves={prepa3d.conserves}
        commandeArchitecture={prepa3d.commande}
        compositionArchitecture={prepa3d.composition}
        volumeAiles={prepa3d.volumeAiles}
        terrainInitial={prepa3d.terrain}
        bridgeSessionId={prepa3d.key}
        conversationId={copilot.currentConversationId}
        onStudioStarted={sessionId => {
          activeStudioSessionRef.current = sessionId;
          if (copilot.currentConversationId) rememberStudioSession(copilot.currentConversationId, sessionId);
        }}
        onFermer={() => setPrepa3d({ ouvert: false })}
      />
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
            {attachError && <p role="alert" className="mzia-attachments__err">{attachError}</p>}
            <CopilotChat
              forceMode="advanced"
              hideQuickQuestions
              showStudioDraft
              onOpenStudioDraft={voirEn3D}
              onPrepareStudioDetailed={ouvrirFicheStudio}
              onIntercept={intercepter3d}
              onMessageSent={conserverPieces3d}
              /* Le sélecteur de niveau ne vivait que dans la branche « accueil »
                 ci-dessous : dès le premier message la vue basculait ici et le
                 contrôle disparaissait, obligeant à ouvrir une nouvelle
                 conversation pour changer de niveau. Le `tier` étant relu du
                 store à chaque envoi, le remonter dans le composeur suffit :
                 le changement s'applique dès le message suivant.

                 Rendu UNIQUEMENT quand le plan offre un vrai choix : hors Pro,
                 MimmozIAModelPicker se réduit à un badge verrouillé, qui ferait
                 doublon avec la mention « Réponse produite au niveau Standard »
                 affichée sous chaque réponse. Sur l'écran d'accueil le badge
                 garde son sens — il annonce le niveau avant le premier envoi —
                 mais en cours de conversation il n'apporte rien. */
              composerToolbar={
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className="mzia-iconbtn" title="Voir en 3D (Studio dans cette page)"
                    onClick={boutonStudio3d}><Box size={18} /></button>
                  {plan === 'pro' && (
                    <MimmozIAModelPicker
                      plan={plan}
                      value={tier}
                      onChange={(t) => copilot.setTier?.(t)}
                      disabled={busy}
                    />
                  )}
                </span>
              }
            />
          </div>
        </div>
      ) : (
        /* ============ ÉTAT ACCUEIL : orbe centrale + cartes + saisie ============ */
        <main className="mzia-welcome">
          <div className="mzia-home-intro">
            <h1>{greeting}, que souhaitez-vous créer aujourd’hui&nbsp;?</h1>
            <p>{tagline || 'Imaginez, analysez et donnez forme à vos projets immobiliers.'}</p>
          </div>

          <Suspense fallback={affichagePremierContact === 'rien' ? null : (
            <div className={affichagePremierContact === 'checklist' ? 'mzia-onb-skel mzia-onb-skel--check' : 'mzia-onb-skel'} aria-hidden />
          )}>
            <PremierContact
              plan={planId}
              profilDeduit={profilAppris?.derivedProfile ?? null}
              onLancer={lancerDepuisAccueil}
              onPreRemplir={preRemplirDepuisAccueil}
              onFerme={rendreFocusSaisie}
              affichageReserve={affichagePremierContact}
            />
          </Suspense>

          <section className="mzia-studio-hero" aria-label="Mimmoza Studio 3D">
            <div className="mzia-studio-hero__copy">
              <span className="mzia-studio-hero__eyebrow"><Box size={15} /> MIMMOZA STUDIO · 3D</span>
              <h2>Donnez vie à vos projets en 3D.</h2>
              <p>Décrivez un bâtiment à Mimmo, puis explorez et ajustez sa maquette dans Studio.</p>
              <div className="mzia-studio-hero__actions">
                <button type="button" className="mzia-studio-hero__primary" onClick={() => handleQuickAction({
                  icon: Box, title: 'Créer une maquette 3D', subtitle: '', side: 'left',
                  prompt: 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m, avec 12 logements.',
                })}>Demander une maquette 3D</button>
                <button type="button" className="mzia-studio-hero__secondary" onClick={() => void ouvrirPrepa3d()}>Ouvrir l’atelier 3D</button>
              </div>
            </div>
            <div className="mzia-studio-hero__art">
              <Suspense fallback={<img src="/illustrations/mimmoza-studio-building.webp" alt="Immeuble contemporain en trois dimensions" />}>
                <StudioHeroBuilding3D />
              </Suspense>
              <span className="mzia-studio-hero__caption">GLISSEZ POUR TOURNER</span>
            </div>
          </section>

          <AlertesAccueil />

          <div className="mzia-home-actions-heading">OU COMMENCEZ PAR UNE ANALYSE</div>
          <div className="mzia-home-actions">
            {QUICK_ACTIONS.map((qa) => (
              <MimmozIAQuickAction key={qa.title} icon={qa.icon} title={qa.title}
                subtitle={qa.subtitle} side={qa.side} onClick={() => handleQuickAction(qa)} />
            ))}
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
                <button type="button" className="mzia-iconbtn" title="Prévisualisation 3D (parcelle, photos, plans)"
                  onClick={() => void ouvrirPrepa3d(draft.trim() || undefined, attachments.map(({ mediaType, data, name }) => ({ mediaType, data, name })))}>
                  <Box size={18} />
                </button>
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
