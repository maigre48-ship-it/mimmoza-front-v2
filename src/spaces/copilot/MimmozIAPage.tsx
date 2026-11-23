import { texteDictee } from './utils/texteDictee';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin, Home, TrendingUp, Gauge, LandPlot, Sparkles,
  Paperclip, Mic, ArrowUp, X, Box,
  ShieldCheck, Lock, BrainCircuit, GitBranch, Menu,
} from 'lucide-react';

import { CopilotChat } from './components/CopilotChat';
import { CarrouselStudio3D } from './accueil/CarrouselStudio3D';
import { useCopilot } from './hooks/useCopilot';
import { MimmozIAOrb, type MimmozIAOrbState } from './components/MimmozIAOrb';
import { phaseReponseEnFlux, reponseClairementNegative } from './components/orbResponseOutcome';
import { MimmozIAQuickAction } from './components/MimmozIAQuickAction';
import { MimmozIAStatus } from './components/MimmozIAStatus';
import { MimmozIASidebar } from './MimmozIASidebar';
import { PanneauAgent } from './agent/PanneauAgent';
import { PanneauDocument } from './document/PanneauDocument';
import { BandeauBriefing } from './agent/BandeauBriefing';
import { MissionPreparation3DPanel, type ParcelleMissionConfirmee } from './studio3d/MissionPreparation3DPanel';
import { missionVisualisable, iduAttenduMission, iduDeParcelle, verifierTerrainMission, preparerTransfertMission } from './studio3d/missionPreparation3D';
import type { Mission } from './agent/agent.types';
import { lireMissionParId } from './agent/agentApi';
// VIS-15 : ouverture du projet en 3D à la fin d'une mission de conception.
import { corpsPreparation3D, EVENEMENT_OUVRIR_PROJET_3D, lireIssuePreparation3D } from './agent/projet3DMission';
import type { DemandeOuvertureProjet3D } from './agent/BoutonProjet3D';
import { lirePreparationStockee, ouverturePreparation } from './studio3d/preparationStudio';
import { chargerPreparationBase, preparationCourante } from './studio3d/preparationBase';
// VIS-17 : une étape du parcours ouvre le Studio intégré sur la bonne étape (Bâtiment, Aménagement → Intérieur).
import { EVENEMENT_PARCOURS_STUDIO, preparerEtapeStudio, type DemandeParcoursStudio } from './studio3d/parcours.store';
// VIS-18a : Studio DÉJÀ ouvert (cadre ou autre onglet) → il passe sur l'étape cliquée (accusé) ; témoin personnalisé reçu.
import { EVENEMENT_OUVRIR_ETAPE_STUDIO, ouvrirEtapeStudio, type CadreStudio, type DetailOuvrirEtape } from './studio3d/pontParcoursSite';
import { recevoirTemoinStudio, temoinPourConversation, type ClientTemoins } from './studio3d/temoinStudio';
import { CANAL_DIFFUSION_PARCOURS, creerMessagePont, examinerMessagePont } from '@/spaces/promoteur/shared/echangeStudio/pontParcoursStudio';
import { AtelierConception } from './agent/conception/AtelierConception';
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
// LOT D9 — « Préparer mon dossier » (carte Extension de maison) → Studio intégré, espace Dossier.
import { blocDossierPourStudio, EVENEMENT_PREPARER_DOSSIER, rendusLivresPourDossier, verifierPreparationDossier } from './studio3d/dossierExtension';
// LOT G4 — « Modifier dans le Studio » depuis la carte des plans : même ouverture que « Préparer mon dossier ».
import { EVENEMENT_OUVRIR_PLANS_STUDIO } from '@/lib/studio/plansExtension';
import { derniereVueExtension } from './studio3d/extensionMaison';
// LOT F5 — lecture du plan de l'existant confiée au Studio intégré (aucun jeton), photo calée, relevé validé en retour.
import {
  blocPhotoCalee, blocPlanExistant, contexteCopilotReleve, DUREE_URL_PLAN_S, etatLirePlanExistant, EVENEMENT_IMPORTER_PLAN_EXISTANT,
  lignesReleve, memoriserReleve, MENTION_LECTURE_LOCALE, oublierPlanEnAttente, photoCaleePourStudio, planEnAttente,
  type BlocPhotoCalee, type SyntheseReleve,
  deposerPlanEnAttente,
} from './studio3d/planExistantStudio';
// LOT G6 — plan joint dans le chat (lu dans le Studio, jamais par le modèle) et carte « Plan lu » (confirmations, saisie).
import { base64VersOctets, contextePlanLu, indicePlanJoint, messageValidationPlan, texteAvecMarqueurPlan, type PlanLuSite } from './studio3d/planLuChat';
import { CartePlanLu, type EtatCartePlanLu } from './studio3d/CartePlanLu';
import { BUCKET_PIECES_JOINTES } from './pieces-jointes/piecesJointesLogique';
import { signerTransferts } from './studio3d/transfertStudio';
import { userStorage } from '@/lib/storage/userScopedStorage';
import { setActiveCopilotContext } from './store/activeCopilotContext.store';
import { listerTravaux, urlSigneeRendu } from '@/lib/studio/travaux';
import { adresseStudioIntegre, baseStudioIntegre, projetIdChat } from './studio3d/projetChat';
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
// V1.8 — pièces jointes par stockage (PDF ≤ 50 Mo, lecture ciblée des gros documents).
import { piecesBase64, preparerPiecesJointes, versPayload, type CopilotAttachment, type UiAttachment } from './pieces-jointes/televersement';
import { ACCEPT_FILES, AVERTISSEMENT_TAILLE } from './pieces-jointes/piecesJointesLogique';
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

type SendFn = (
  text: string,
  options?: { attachments?: CopilotAttachment[] },
) => unknown | Promise<unknown>;


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
  // V1.8 : téléversement + extraction du texte en cours (l'envoi attend).
  const [preparationPj, setPreparationPj] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // V1.8 : PDF jusqu'à 50 Mo (téléversés, texte extrait dans le navigateur),
  // petites images en base64 comme avant — voir pieces-jointes/televersement.ts.
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachError(null);
    const liste = Array.from(files);
    setPreparationPj(liste.length > 1 ? `Préparation de ${liste.length} fichiers…` : `Préparation de « ${liste[0].name} »…`);
    try {
      const st = useCopilotStore.getState();
      const { acceptees, erreur } = await preparerPiecesJointes(liste, attachments, {
        conversationId: st.currentConversationId, niveau: st.tier, surEtape: setPreparationPj,
      });
      if (erreur) setAttachError(erreur);
      if (acceptees.length) {
        setAttachments((prev) => [...prev, ...acceptees.filter((a) => !prev.some((p) => p.id === a.id))]);
      }
    } finally {
      setPreparationPj(null);
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
      // LIAISON 03/11 — Studio intégré (même origine) OU Studio configuré.
      try { if (event.origin !== window.location.origin && event.origin !== new URL(urlStudio3D()).origin) return; }
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
  const [mission3d, setMission3d] = useState<{ mission: Mission } | null>(null);
  const mission3dRef = useRef(mission3d); mission3dRef.current = mission3d;
  const studio3dRef = useRef(studio3d);
  studio3dRef.current = studio3d;
  // VIS-18a — fenêtre et origine EXACTES du Studio intégré (données par StudioIntegre à chaque « prêt »).
  const cadreStudioRef = useRef<(CadreStudio & { conversationId: string | null }) | null>(null);
  const surCadreStudioPret = useCallback((fenetre: Window, origine: string) => {
    const conversationId = studio3dRef.current.conversationId;
    cadreStudioRef.current = { fenetre, origine, conversationId };
    const id = `req-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try { fenetre.postMessage(creerMessagePont('temoin.demander', { requeteId: id, ...(conversationId ? { projetId: projetIdChat(conversationId) } : {}) }), origine); } catch { /* cadre fermé */ }
  }, []);
  /** VIS-18a — cadre du Studio utilisable pour la conversation courante (sinon null : autre onglet ou repli). */
  const cadreCourant = useCallback((conversationId: string | null): CadreStudio | null => {
    const c = cadreStudioRef.current;
    const s = studio3dRef.current;
    return c && s.demande && conversationId && s.conversationId === conversationId && c.conversationId === conversationId ? { fenetre: c.fenetre, origine: c.origine } : null;
  }, []);
  const voirEn3D = useCallback(async (fiche: JarvisDraft, conversationId: string, terrainArg?: ConfirmedTerrain & { adresse?: string | null }, options?: { mission?: boolean; estCourante?: () => boolean; remplacerMaquette?: boolean; complements?: Readonly<Record<string, unknown>> }): Promise<IssueOuvertureStudio> => {
    const verifierContexteMission = () => { if (options?.mission && (useCopilotStore.getState().currentConversationId !== conversationId || !options.estCourante?.())) throw new Error('La préparation de mission ou la conversation a changé. Aucun projet ne sera ouvert.'); };
    verifierContexteMission();
    // Mission : la parcelle confirmée vaut pour la mission seulement ; la parcelle retenue de la conversation n'est pas modifiée.
    if (terrainArg && !options?.mission) retenirParcelle(conversationId, terrainArg);
    const retenue = terrainArg ?? parcelleRetenue(conversationId);
    if (!retenue) {
      window.dispatchEvent(new CustomEvent('mzia-3d-parcelle-requise', { detail: conversationId }));
      return 'parcelle-requise';
    }
    // Charge Studio construite en un seul endroit (aussi utilisée pour les films et visites 360°).
    const preparer = () => preparerChargeVoirEn3D(fiche, conversationId, retenue, terrainArg, { autoriserEtudeActive: options?.mission !== true });
    // Mission : maquette déjà chargée contrôlée AVANT toute entrée/sortie (relief, fichiers, signatures, panorama), puis après l'attente.
    const { construit, parcelles, insee, reliefConnu, conserves, sessionId, etudeId } = options?.mission
      ? await preparerTransfertMission({
        conversationId, remplacer: options.remplacerMaquette === true, preparer,
        courante: () => useCopilotStore.getState().currentConversationId === conversationId && !!options.estCourante?.(),
        maquette: () => ({ chargee: !!studio3dRef.current.demande, conversationId: studio3dRef.current.conversationId }),
      })
      : await preparer();
    verifierContexteMission();
    if (!construit.ok) throw new Error(`Transfert vers Studio impossible : ${construit.erreur}.`);
    // Même contenu qu'à l'ouverture précédente, Studio encore chargé : on le remontre, sans renvoi.
    const empreinte = empreinteProjet(construit.projet);
    const avant = studio3dRef.current;
    // LOT D9 — avec des compléments (dossier), le projet est RENVOYÉ : le Studio doit recevoir la demande de dossier.
    if (!options?.complements && avant.demande && avant.conversationId === conversationId && avant.empreinte === empreinte) {
      setStudio3d({ ...avant, ouvert: true });
      return;
    }
    const projet = avecProchaineRevision(construit.projet, conversationId);
    activeStudioSessionRef.current = sessionId;
    rememberStudioSession(conversationId, sessionId);
    // R1 — point unique de l'adresse de Studio. LIAISON 03/11 — Studio intégré : toujours la même origine
    // (<origine>/studio/), quelle que soit VITE_MIMMOZIA_STUDIO_URL (voir baseStudioIntegre).
    const url = adresseStudioIntegre(baseStudioIntegre(urlStudio(), window.location.origin), projetIdChat(conversationId), sessionId, etudeId);
    setStudio3d({
      demande: {
        cle: sessionId, url, sessionId, projet,
        relief: reliefConnu ? { etat: 'inclus', source: terrainArg?.terrainData ? 'mesure' : 'cache' }
          : { etat: 'differe', promesse: reliefAvecDelai(parcelles, insee), relancer: () => reliefAvecDelai(parcelles, insee) },
        implantation: reliefConnu ? null : retenue.implantation ?? null,
        imagesNonEnvoyees: conserves.filter(f => f.kind === 'image').length,
        ...(options?.complements ? { complements: options.complements } : {}),
      },
      ouvert: true, empreinte, conversationId,
    });
  }, []);
  /*
   * LOT D9 — « PRÉPARER MON DOSSIER ». Le bouton de la carte (parcours terminé) envoie le régime choisi ; ici : contrôles,
   * rendus LIVRÉS de la conversation (URL signées 1 h, proposés comme insertion — aucun choisi d'office), puis ouverture du
   * Studio intégré avec `projetExtension` et le bloc `dossier`. Rien n'est envoyé ailleurs ; aucun jeton consommé.
   */
  /** LOT F5 — photo calée du travail d'image (photo + plan de calage déposés par la machine de rendu), adresses signées 1 h. */
  const photoCaleeDeLaConversation = useCallback(async (conversationId: string): Promise<BlocPhotoCalee | null> => {
    const travaux = await listerTravaux(conversationId, 12).catch(() => ({ disponible: false as const }));
    const p = travaux.disponible ? photoCaleePourStudio(travaux.valeur) : null;
    if (!p) return null;
    try {
      const [photo, plan] = await Promise.all([urlSigneeRendu(p.photoPath, DUREE_URL_PLAN_S), urlSigneeRendu(p.planPath, DUREE_URL_PLAN_S)]);
      return blocPhotoCalee(p, photo, plan, Date.now());
    } catch { return null; }
  }, []);
  const preparerDossier = useCallback(async (regime: 'DP' | 'PC') => {
    const state = useCopilotStore.getState();
    const conversationId = state.currentConversationId;
    const fiche = latestJarvisDraft(state.messages);
    const v = verifierPreparationDossier({ conversationId, vue: derniereVueExtension(state.messages as never), ficheDisponible: !!fiche, regime });
    if (!v.ok) { setAttachError(v.message); return; }
    const vue = derniereVueExtension(state.messages as never)!;
    const travaux = await listerTravaux(conversationId!, 12).catch(() => ({ disponible: false as const }));
    const candidats = travaux.disponible ? rendusLivresPourDossier(travaux.valeur) : [];
    const rendus = (await Promise.all(candidats.map(async (r) => {
      try { return { id: r.id, libelle: r.libelle, url: await urlSigneeRendu(r.chemin, 3600), date: r.date, statut: r.statut }; } catch { return null; }
    }))).filter((r): r is NonNullable<typeof r> => r !== null);
    const dossier = blocDossierPourStudio({ regime, dossier: v.dossier, secteur: vue.secteur ? { etat: vue.secteur.etat, date: vue.secteur.date } : null, projet: v.projet, rendus });
    // LOT F5 — la photo calée du travail d'image part aussi : « Relever sur la photo » la trouve dans le Studio.
    const photoCalee = await photoCaleeDeLaConversation(conversationId!);
    const issue = await voirEn3D(fiche!, conversationId!, undefined, { complements: { projetExtension: v.projet, dossier, ...(photoCalee ? { photoCalee } : {}) } });
    // LOT F5 — parcelle non confirmée : la demande de dossier n'est pas perdue en silence.
    if (issue === 'parcelle-requise') setAttachError('Confirmez d’abord la parcelle de la maison (question ci-dessus), puis cliquez de nouveau « Préparer mon dossier ».');
  }, [voirEn3D, photoCaleeDeLaConversation]);
  /*
   * LOT F5 — « LIRE LE PLAN DE L'EXISTANT » : remplace la transcription de plans par un modèle de langage. Le plan fourni
   * (déposé sur une autre page du site, sinon les PDF de la conversation) est transmis au Studio intégré, qui l'ouvre sur
   * « Plans & dossier › Plan de l'existant › Importer un plan » ; la lecture se fait dans le navigateur, sans jeton.
   */
  const [noticePlan, setNoticePlan] = useState<string | null>(null);
  const preparerPlanExistant = useCallback(async () => {
    const state = useCopilotStore.getState();
    const conversationId = state.currentConversationId;
    const fiche = latestJarvisDraft(state.messages);
    const vue = derniereVueExtension(state.messages as never);
    if (!conversationId) { setNoticePlan('Ouvrez d’abord la conversation de la maison avec Mimmo.'); return; }
    if (!etatLirePlanExistant(vue) || !vue?.projetExtension) {
      setNoticePlan('Le plan de l’existant se lit sur une maison conservée : terminez d’abord avec Mimmo le parcours « agrandir ma maison » (maison existante conservée), puis cliquez « Lire le plan de l’existant » sur la carte.');
      return;
    }
    if (!fiche) { setNoticePlan('Le Studio a besoin de la préparation 3D de la parcelle : demandez d’abord « voir en 3D » à Mimmo, puis cliquez de nouveau « Lire le plan de l’existant ».'); return; }
    const attente = planEnAttente(Date.now());
    let fichiers: { nom: string; type: string; taille: number; octets?: ArrayBuffer; url?: string }[] = [];
    if (attente) {
      fichiers = [{ nom: attente.nom, type: attente.type, taille: attente.taille, octets: attente.octets }];
    } else {
      const pdf = (await listJarvisTransferFiles(conversationId).catch(() => [] as JarvisStoredFile[])).filter(f => f.kind === 'pdf' && typeof f.taille === 'number').slice(0, 6);
      for (const f of pdf) {
        const [signe] = await signerTransferts([f]).catch(() => []);
        if (signe) fichiers.push({ nom: f.nom, type: 'application/pdf', taille: f.taille!, url: signe.url });
      }
    }
    const b = blocPlanExistant({ provenance: attente ? attente.provenance : 'conversation', fichiers, maintenantMs: Date.now() });
    if (!b.ok) { setNoticePlan(b.raison); return; }
    const photoCalee = await photoCaleeDeLaConversation(conversationId);
    const issue = await voirEn3D(fiche, conversationId, undefined, { complements: { projetExtension: vue.projetExtension, planExistant: b.bloc, ...(photoCalee ? { photoCalee } : {}) } });
    if (issue === 'parcelle-requise') { setNoticePlan('Confirmez d’abord la parcelle de la maison (question ci-dessus), puis cliquez de nouveau « Lire le plan de l’existant ».'); return; }
    if (attente) oublierPlanEnAttente();
    const noms = b.bloc.fichiers.map(f => f.nom).join(', ');
    setNoticePlan(`${noms ? `Plan transmis au Studio (${noms})` : 'Studio ouvert sur « Plan de l’existant » : choisissez votre plan (DXF, PDF, PNG ou JPEG)'}${photoCalee ? ' ; la photo calée de votre image est aussi disponible pour « Relevé sur la photo calée »' : ''}. ${MENTION_LECTURE_LOCALE}`);
  }, [voirEn3D, photoCaleeDeLaConversation]);
  useEffect(() => {
    const surPlan = () => { void preparerPlanExistant().catch(error => setNoticePlan(error instanceof Error ? error.message : 'Ouverture du Studio impossible.')); };
    window.addEventListener(EVENEMENT_IMPORTER_PLAN_EXISTANT, surPlan);
    return () => window.removeEventListener(EVENEMENT_IMPORTER_PLAN_EXISTANT, surPlan);
  }, [preparerPlanExistant]);
  // LOT F5 — arrivée depuis une autre page avec un plan déposé (« Lire ce plan dans le Studio ») : on dit quoi faire.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('plan-existant')) return;
    const p = planEnAttente(Date.now());
    setNoticePlan(p
      ? `Plan « ${p.nom} » prêt à être lu. Ouvrez la conversation de la maison (ou dites à Mimmo « agrandir ma maison » avec son adresse) ; quand le projet est enregistré avec la maison conservée, cliquez « Lire le plan de l’existant » sur la carte. ${MENTION_LECTURE_LOCALE}`
      : 'Aucun plan en attente (la page a été rechargée ?) : déposez de nouveau le plan, ou choisissez-le directement dans le Studio.');
  }, []);
  /** LOT F5 — relevé VALIDÉ dans le Studio : mémorisé (écrans du site), donné au copilote (surfaces avec statuts). */
  const surReleveStudio = useCallback((s: SyntheseReleve) => {
    memoriserReleve(userStorage, s, useCopilotStore.getState().currentConversationId);
    setActiveCopilotContext({ pageSnapshot: contexteCopilotReleve(s) });
    setNoticePlan(lignesReleve(s).join(' '));
    // LOT G6 — plan fourni lu : carte « Plan lu » (valeurs clés à confirmer, points douteux).
    releveCourantRef.current = s;
    if (s.planLu) setCartePlan({ mode: 'lu', plan: s.planLu });
  }, []);
  /** LOT G6 — carte « Plan lu » : état, plan confirmé / corrigé (mémorisé et donné au contexte de la page). */
  const [cartePlan, setCartePlan] = useState<EtatCartePlanLu | null>(null);
  const releveCourantRef = useRef<SyntheseReleve | null>(null);
  const surPlanLu = useCallback((p: PlanLuSite) => {
    setCartePlan({ mode: 'lu', plan: p });
    const s = releveCourantRef.current;
    if (s && p.source === 'import-plan') {
      const maj = { ...s, planLu: p };
      releveCourantRef.current = maj;
      memoriserReleve(userStorage, maj, useCopilotStore.getState().currentConversationId);
      setActiveCopilotContext({ pageSnapshot: contexteCopilotReleve(maj) });
    } else {
      setActiveCopilotContext({ pageSnapshot: contextePlanLu(p) });
    }
  }, []);
  useEffect(() => {
    const surDossier = (e: Event) => {
      const r = (e as CustomEvent<{ regime?: unknown }>).detail?.regime;
      if (r !== 'DP' && r !== 'PC') return;
      void preparerDossier(r).catch(error => setAttachError(error instanceof Error ? error.message : 'Ouverture du dossier impossible.'));
    };
    window.addEventListener(EVENEMENT_PREPARER_DOSSIER, surDossier);
    return () => window.removeEventListener(EVENEMENT_PREPARER_DOSSIER, surDossier);
  }, [preparerDossier]);
  useEffect(() => {
    const surPlans = () => {
      const regime = derniereVueExtension(useCopilotStore.getState().messages as never)?.dossier?.choix?.[0] ?? null;
      if (!regime) { setAttachError('Pour modifier les plans dans le Studio, terminez d’abord le parcours d’extension avec Mimmo.'); return; }
      void preparerDossier(regime).catch(error => setAttachError(error instanceof Error ? error.message : 'Ouverture du Studio impossible.'));
    };
    window.addEventListener(EVENEMENT_OUVRIR_PLANS_STUDIO, surPlans);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_PLANS_STUDIO, surPlans);
  }, [preparerDossier]);
  // VIS-15 : « Ouvrir mon projet en 3D » (fin de mission de conception, chat ou panneau Missions) — le serveur prépare la 3D
  // de la conception de la mission (action directe, moteur déterministe, aucun jeton), puis le Studio s'ouvre par le
  // parcours existant « Voir en 3D », comme « Ouvrir la 3D préparée » du Dossier 3D.
  useEffect(() => {
    const surProjet3D = (e: Event) => {
      const d = (e as CustomEvent<DemandeOuvertureProjet3D>).detail;
      if (!d?.mission) return;
      d.prise = true;
      d.repondre((async () => {
        const conversationId = d.mission.conversation_id ?? useCopilotStore.getState().currentConversationId;
        if (!conversationId) return { ok: false as const, message: 'Conversation de la mission introuvable.' };
        const { data, error } = await supabase.functions.invoke('copilot-chat', { body: corpsPreparation3D(d.mission) });
        if (error) return { ok: false as const, message: 'La 3D n’a pas pu être préparée (service indisponible). Réessayez dans un instant.' };
        const issue = lireIssuePreparation3D(data);
        if (!issue.ok) return issue;
        // 23/11 : la 3D vient d'être préparée → tous les écrans (parcours, fiche, rendus) la relisent en base.
        void chargerPreparationBase(conversationId).catch(() => undefined);
        const lu = await supabase.from('studio_preparations').select('id,idu,entree,volume').eq('id', issue.preparationId).maybeSingle();
        const p = lu.error ? null : lirePreparationStockee(lu.data);
        if (!p) return { ok: false as const, message: 'La 3D préparée est illisible : réessayez.' };
        const o = ouverturePreparation(p);
        if (!o.ok) return { ok: false as const, message: o.erreur };
        const res = await voirEn3D(o.fiche, conversationId, o.terrain);
        return { ...issue, ouvert: res !== 'parcelle-requise' };
      })());
    };
    window.addEventListener(EVENEMENT_OUVRIR_PROJET_3D, surProjet3D);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_PROJET_3D, surProjet3D);
  }, [voirEn3D]);
  // VIS-18a — logement témoin personnalisé envoyé par le Studio (cadre : sa fenêtre et son origine ; autre onglet :
  // BroadcastChannel, même origine, projet de la conversation courante) → copie locale, studio_temoins, événement.
  useEffect(() => {
    const recevoir = (data: unknown, origine: string, autorisees: string[], via: 'cadre' | 'canal') => {
      const d = examinerMessagePont({ origin: origine, data }, autorisees, window.location.origin, false);
      if (d.type !== 'message' || d.message.canal !== 'temoin.etat') return;
      const charge = d.message.charge;
      const conversationId = useCopilotStore.getState().currentConversationId;
      if (!conversationId) return;
      const projetId = projetIdChat(conversationId);
      // VIS-19 : par le canal, le projet DOIT être celui de la conversation (un onglet Studio non relié envoie null) ;
      // null n'est toléré que par le cadre ouvert pour la conversation courante (même contrôle que cadreCourant) ; la
      // ligne en base n'est supprimée que sur `retire` d'un Studio relié à CE projet.
      const decision = temoinPourConversation({
        via, projetIdCharge: charge.projetId, projetIdAttendu: projetId,
        cadreDeLaConversation: via === 'cadre' && cadreCourant(conversationId) !== null, retire: charge.retire === true,
      });
      if (!decision.accepte) return;
      void (async () => {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (!userId) return;
        const r = await recevoirTemoinStudio(supabase as unknown as ClientTemoins, userId, conversationId, projetId, charge.temoin, undefined, decision.retirer);
        // Échec d'écriture : l'étape « Intérieurs » du parcours affiche « enregistré sur cet appareil seulement ».
        if (r.base && !r.base.ok) console.warn('[VIS-19] témoin personnalisé : base non mise à jour (gardé sur cet appareil) :', r.base.erreur);
      })();
    };
    const surFenetre = (e: MessageEvent) => {
      const c = cadreStudioRef.current;
      if (!c || e.source !== c.fenetre || e.origin !== c.origine) return;
      recevoir(e.data, e.origin, [c.origine], 'cadre');
    };
    window.addEventListener('message', surFenetre);
    let canal: BroadcastChannel | null = null;
    try { canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CANAL_DIFFUSION_PARCOURS) : null; } catch { canal = null; }
    const surCanal = (e: MessageEvent) => recevoir(e.data, window.location.origin, [], 'canal');
    canal?.addEventListener('message', surCanal);
    return () => { window.removeEventListener('message', surFenetre); canal?.removeEventListener('message', surCanal); canal?.close(); };
  }, [cadreCourant]);
  // VIS-18a — n'importe quelle étape du parcours (Style & façades, Vues & ambiance…) : Studio déjà ouvert → il y passe.
  // Aucun Studio ouvert : `absent`, le parcours garde son action habituelle (rien n'est ouvert ici).
  useEffect(() => {
    const surEtape = (e: Event) => {
      const d = (e as CustomEvent<DetailOuvrirEtape>).detail;
      if (!d || typeof d.repondre !== 'function') return;
      d.prise = true;
      const conversationId = useCopilotStore.getState().currentConversationId;
      const cadre = cadreCourant(conversationId);
      void ouvrirEtapeStudio(d, { cadre, projetId: conversationId ? projetIdChat(conversationId) : null }).then((issue) => {
        if (issue.ou === 'cadre' && issue.etat === 'ok') setStudio3d({ ...studio3dRef.current, ouvert: true });
        d.repondre(issue);
      });
    };
    window.addEventListener(EVENEMENT_OUVRIR_ETAPE_STUDIO, surEtape);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_ETAPE_STUDIO, surEtape);
  }, [cadreCourant]);
  // VIS-17 : étape du parcours → Studio intégré ouvert sur l'étape voulue (mémoire des colonnes du Studio, même origine),
  // par les parcours existants : 3D préparée par Mimmo (comme « Ouvrir la 3D préparée »), sinon fiche du projet.
  useEffect(() => {
    const surStudio = (e: Event) => {
      const d = (e as CustomEvent<DemandeParcoursStudio>).detail;
      if (!d) return;
      d.prise = true;
      preparerEtapeStudio(d.etape, d.sous);
      const libelle = d.etape === 'amenagement' ? '« Aménagement », onglet « Intérieur »' : '« Bâtiment »';
      const state = useCopilotStore.getState();
      const conversationId = state.currentConversationId;
      const avant = studio3dRef.current;
      if (conversationId && avant.demande && avant.conversationId === conversationId) {
        // Studio déjà chargé : rien n'est rechargé (aucune modification perdue). VIS-18a : il passe sur l'étape (accusé) ;
        // sans accusé (Studio d'avant VIS-18a, encore en chargement), le message VIS-17 d'origine.
        setStudio3d({ ...avant, ouvert: true });
        void ouvrirEtapeStudio({ etapeStudio: d.etape, sousOnglet: d.sous }, { cadre: cadreCourant(conversationId), projetId: projetIdChat(conversationId), canal: null })
          .then((issue) => d.repondre(issue.etat === 'ok' ? null : issue.etat === 'refus' ? issue.message : `Le Studio était déjà ouvert : revenez sur son onglet (étape ${libelle}).`));
        return;
      }
      void (async () => {
        try {
          if (!conversationId) throw new Error('Ouvrez d’abord la conversation du projet.');
          // VIS-18a — Studio ouvert dans un AUTRE onglet sur ce projet : il passe sur l'étape, rien n'est ouvert ici.
          const ailleurs = await ouvrirEtapeStudio({ etapeStudio: d.etape, sousOnglet: d.sous }, { cadre: null, projetId: projetIdChat(conversationId), delaiMs: 600 });
          if (ailleurs.etat === 'ok') { d.repondre(ailleurs.message); return; }
          const ref = preparationCourante(state.messages as never, conversationId) ?? await chargerPreparationBase(conversationId);
          if (ref) {
            const lu = await supabase.from('studio_preparations').select('id,idu,entree,volume').eq('id', ref.preparationId).maybeSingle();
            const p = lu.error ? null : lirePreparationStockee(lu.data);
            if (!p) throw new Error('La 3D préparée est illisible : demandez à Mimmo de la préparer à nouveau.');
            const o = ouverturePreparation(p);
            if (!o.ok) throw new Error(o.erreur);
            const res = await voirEn3D(o.fiche, conversationId, o.terrain);
            d.repondre(res === 'parcelle-requise' ? 'Le Studio demande de confirmer la parcelle.' : null);
            return;
          }
          const fiche = latestJarvisDraft(state.messages);
          if (fiche) {
            const res = await voirEn3D(fiche, conversationId);
            d.repondre(res === 'parcelle-requise' ? 'Le Studio demande de confirmer la parcelle.' : null);
            return;
          }
          d.repondre('Préparez d’abord la 3D du projet (étape 3) : le Studio s’ouvrira ensuite sur cette étape.');
        } catch (erreur) {
          d.repondre(erreur instanceof Error ? erreur.message : 'Ouverture du Studio impossible.');
        }
      })();
    };
    window.addEventListener(EVENEMENT_PARCOURS_STUDIO, surStudio);
    return () => window.removeEventListener(EVENEMENT_PARCOURS_STUDIO, surStudio);
  }, [voirEn3D, cadreCourant]);
  const preparerMission3D = useCallback((mission: Mission) => {
    const state = useCopilotStore.getState();
    if (!missionVisualisable(mission, state.currentConversationId)) throw new Error('Ouvrez la conversation de cette mission pour préparer son projet.');
    setMission3d({ mission });
  }, []);
  /** Décharge explicitement la maquette de Studio (choix de l'utilisateur dans la préparation de mission). */
  const fermerMaquette3d = useCallback(() => {
    activeStudioSessionRef.current = null;
    setStudio3d({ demande: null, ouvert: false, empreinte: null, conversationId: null });
  }, []);
  useEffect(() => { if (mission3d && mission3d.mission.conversation_id !== copilot.currentConversationId) setMission3d(null); }, [mission3d, copilot.currentConversationId]);
  const ouvrirMission3D = useCallback(async (fiche: JarvisDraft, parcelle: ParcelleMissionConfirmee, remplacerMaquette: boolean) => {
    if (!mission3d) return;
    const preparation = mission3d;
    const estCourante = () => mission3dRef.current === preparation && useCopilotStore.getState().currentConversationId === preparation.mission.conversation_id;
    const mission = await lireMissionParId(preparation.mission.id);
    if (!estCourante()) throw new Error('La préparation a changé pendant la vérification.');
    if (!mission || mission.id !== preparation.mission.id || mission.conversation_id !== preparation.mission.conversation_id
      || !missionVisualisable(mission, useCopilotStore.getState().currentConversationId)) throw new Error('Cette mission ou sa conversation ne permet plus le transfert.');
    // Garde réelle : la confirmation vient de l'état du panneau et doit désigner la mission relue au serveur et sa parcelle.
    verifierTerrainMission(mission.id, mission.conversation_id!, { missionId: parcelle.missionId, conversationId: parcelle.conversationId, parcelId: iduDeParcelle(parcelle.valeur.parcel) ?? parcelle.parcelId }, iduAttenduMission(mission));
    await voirEn3D(fiche, mission.conversation_id!, parcelle.valeur, { mission: true, estCourante, remplacerMaquette });
    setMission3d(null);
  }, [mission3d, voirEn3D]);
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
  const conserverPieces3d = useCallback(async (text: string, options?: { attachments?: { mediaType: string; data?: string; name?: string }[] }) => {
    // V1.8 : seules les pièces encore en base64 (≤ 3 Mo) sont recopiées au dossier 3D.
    const files = (options?.attachments ?? []).filter((a) => typeof a.data === 'string');
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
    if (preparationPj) { setAttachError('Patientez : la pièce jointe est en cours de préparation.'); return; }
    // LOT G6 — plan de la maison joint : gardé dans l'onglet et lu dans le Studio (sans jeton), JAMAIS envoyé au modèle
    // de langage ; le message part avec un marqueur « [Plan de la maison joint …] ».
    let pieces = attachments;
    let texte = message;
    const iPlan = indicePlanJoint(attachments, message);
    if (iPlan >= 0) {
      const pj = attachments[iPlan]!;
      pieces = attachments.filter((_, i) => i !== iPlan);
      let octets: ArrayBuffer | null = null;
      try {
        if (typeof pj.data === 'string') octets = base64VersOctets(pj.data);
        else if (pj.storagePath) { const { data } = await supabase.storage.from(BUCKET_PIECES_JOINTES).download(pj.storagePath); octets = data ? await data.arrayBuffer() : null; }
      } catch { octets = null; }
      const c = octets ? deposerPlanEnAttente({ nom: pj.name, type: pj.mediaType || 'application/octet-stream', taille: octets.byteLength, octets, provenance: 'conversation', deposeLeMs: Date.now() }) : { ok: false as const, raison: 'fichier illisible' };
      if (c.ok) {
        texte = texteAvecMarqueurPlan(message, pj.name);
        setCartePlan({ mode: 'attente', nom: pj.name });
        const vue = derniereVueExtension(useCopilotStore.getState().messages as never);
        if (etatLirePlanExistant(vue)) window.setTimeout(() => window.dispatchEvent(new Event(EVENEMENT_IMPORTER_PLAN_EXISTANT)), 0);
        else setNoticePlan(`Plan « ${pj.name} » gardé : il sera lu dans le Studio dès que la maison est identifiée et conservée (parcours « agrandir ma maison »), avec le bouton « Lire le plan de l’existant » de la carte. ${MENTION_LECTURE_LOCALE}`);
      } else {
        setAttachError(`Le plan « ${pj.name} » n’a pas pu être gardé pour la lecture (${c.raison}) : il n’est pas envoyé.`);
      }
    }
    // V1.8 : une pièce stockée part en RÉFÉRENCE ; le dossier 3D ne reçoit que le base64.
    const files = versPayload(pieces);
    try {
      setAttachError(null);
      if (send) {
        await send(texte, files.length ? { attachments: files } : undefined);
        await conserverPieces3d(texte, { attachments: piecesBase64(pieces) });
      }
      else console.warn('[MimmozIA] Aucune fonction d’envoi détectée — voir INTEGRATION.md.');
      setAttachments([]);
    } catch (err) {
      console.error('[MimmozIA] Échec de l’envoi :', err);
    }
  }, [send, attachments, conserverPieces3d, preparationPj]);

  // V1.8 : rien ne part (et le brouillon reste) tant qu'une pièce jointe est en préparation.
  const handleLauncherSend = useCallback(() => { if (preparationPj) return; void startWith(draft); setDraft(''); }, [draft, startWith, preparationPj]);
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
      <StudioIntegre demande={studio3d.demande} ouvert={studio3d.ouvert} onFermer={fermerStudio3d} onReleve={surReleveStudio} onCadrePret={surCadreStudioPret} />
      {noticePlan && <div role="status" style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 900, maxWidth: 'min(720px, 92vw)', background: '#f5f3ff', border: '1px solid #c4b5fd', color: '#312e81', borderRadius: 10, padding: '8px 12px', fontSize: 13, lineHeight: 1.4, boxShadow: '0 6px 20px rgba(15,23,42,.12)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flex: 1 }}>{noticePlan}</span>
        <button type="button" onClick={() => setNoticePlan(null)} aria-label="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#312e81' }}><X size={14} /></button>
      </div>}
      {/* LOT G6 — carte « Plan lu » : plan joint en lecture, plan lu à confirmer, ou cotes saisies. */}
      {cartePlan && <CartePlanLu etat={cartePlan}
        onPlan={surPlanLu}
        onValider={(p) => { surPlanLu(p); setCartePlan(null); setNoticePlan('Plan transmis à Mimmo : il en tient compte pour votre projet.'); void startWith(messageValidationPlan(p)); }}
        onSaisie={() => setCartePlan({ mode: 'saisie' })}
        onRelevePhoto={() => window.dispatchEvent(new Event(EVENEMENT_IMPORTER_PLAN_EXISTANT))}
        onRelire={() => window.dispatchEvent(new Event(EVENEMENT_IMPORTER_PLAN_EXISTANT))}
        onFermer={() => setCartePlan(null)} />}
      {/* Agent autonome : panneau Missions / À valider / Mémoire (fermé par défaut) */}
      <PanneauAgent />
      {/* LOT D1 : réponses longues, ordre et rapport de mission présentés comme des documents (fermé par défaut) */}
      <PanneauDocument />
      {/* Agent autonome : Atelier 3D en mode conception + bilan vivant (fermé par défaut) */}
      <AtelierConception />
      {mission3d && <MissionPreparation3DPanel key={mission3d.mission.id} mission={mission3d.mission} onFermer={() => setMission3d(null)} onOuvrir={ouvrirMission3D} onFermerMaquette={fermerMaquette3d} />}
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

      {/* « Nouvelle conversation » : désormais dans la barre de titre de la
          fenêtre Atelier 3D (prop `onNewConversation` de CopilotChat). Le
          bouton flottant d'avant était ancré dans la marge du menu latéral
          fixe et passait dessous (« uvelle conversation »). */}

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
              onNewConversation={handleNewConversation}
              onOpenStudioDraft={voirEn3D}
              onVisualiserMission={preparerMission3D}
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

          {/* Veille proactive : « Pendant votre absence… » (rien si aucun briefing non lu) */}
          <BandeauBriefing />

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
              {/* Rendus Unreal fixes (public/accueil/studio-3d/manifeste.json) ;
                  la maquette three.js StudioHeroBuilding3D ne sert plus qu'à la vitrine. */}
              <CarrouselStudio3D />
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
              {(attachments.length > 0 || attachError || preparationPj) && (
                <div className="mzia-attachments">
                  {preparationPj && <span className="mzia-chip__name" role="status">{preparationPj}</span>}
                  {attachments.map((a) => (
                    <span key={a.id} className="mzia-chip" title={a.detail ? `${a.name} — ${a.detail}` : a.name}>
                      <Paperclip size={13} />
                      <span className="mzia-chip__name">{a.name}</span>
                      <button type="button" className="mzia-chip__x"
                        onClick={() => removeAttachment(a.id)} title="Retirer">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {attachError && <span className="mzia-attachments__err">{attachError}</span>}
                  {/* V1.8 : le coût suit le poids du document (décision d'Albé). */}
                  {(attachments.length > 0 || preparationPj) && <span className="mzia-chip__name" style={{ whiteSpace: 'normal', opacity: 0.8 }}>{AVERTISSEMENT_TAILLE}</span>}
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
                  onClick={() => void ouvrirPrepa3d(draft.trim() || undefined, piecesBase64(attachments))}>
                  <Box size={18} />
                </button>
                <button type="button" disabled={!dictationSupported}
                  title={dictationSupported ? 'Dicter' : 'Dictée non prise en charge par ce navigateur'}
                  className={`mzia-iconbtn mzia-iconbtn--rec${recording ? ' is-active' : ''}`}
                  onClick={toggleDictation}><Mic size={18} /></button>
                <button type="button" className="mzia-send" title={preparationPj ? 'Pièce jointe en préparation…' : 'Envoyer'}
                  disabled={!draft.trim() || !!preparationPj} onClick={handleLauncherSend}><ArrowUp size={18} /></button>
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
