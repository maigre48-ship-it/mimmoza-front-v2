// src/spaces/copilot/studio3d/pontCommandesSite.ts
// =============================================================================
// VIS-45 (25/11/2026) — UN SEUL CHAT, CELUI DE MIMMOZA, QUI PILOTE LE STUDIO (côté site).
//
// Protocole : src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts (copie identique du Studio).
//  - `envoyerCommandeStudio` : une commande décidée dans le chat (outil `studio_commander`, ou bouton d'une carte)
//    part vers l'onglet Studio relié à la conversation (BroadcastChannel, même origine). Accusé reçu → « en cours » ;
//    pas d'accusé en 1,5 s → la commande est MISE EN ATTENTE (localStorage) et le Studio l'exécutera à son ouverture.
//    Une commande n'est envoyée qu'UNE fois par appel d'outil / clic (registre local des envois + trace en base).
//  - `installerPontCommandesSite` (MimmozIAPage) : reçoit les comptes rendus et les notifications du Studio, dépose
//    les fichiers (plans), les range dans la conversation (copilot_action_runs, sans jetons), publie le FIL de la
//    conversation au Studio et envoie dans la conversation ce qui est saisi dans le Studio.
// Aucun import « @/… » : testable par `npx tsx --test` (les accès Supabase sont injectés).
// =============================================================================
import { create } from 'zustand';
import {
  ajouterEnAttente, CANAL_DIFFUSION_COMMANDES, conversationDuProjet, creerMessageCommandes, DELAI_ACCUSE_COMMANDE_MS, lireMessageCommandes,
  MAX_MESSAGES_FIL, MAX_TEXTE_FIL, nouvelIdRequete, PHRASE_EN_ATTENTE, phraseCompteRendu, prendreComptesRendusEnAttente, retirerEnAttente,
  type ChargeCommande, type ChargeCompteRendu, type FichierCompteRendu, type MessageCommandes, type MessageFil, type StockageSimple, type SurfacesPlans,
} from '../../promoteur/shared/echangeStudio/pontCommandesStudio.ts';

/* ─── État des commandes (cartes du chat) ─── */

export type EtatCommande = 'envoi' | 'en-cours' | 'attente' | 'fait' | 'echec' | 'confirmation' | 'refus';
export interface LienFichier { nom: string; format: string; url: string | null; chemin: string | null; note: string | null }
export interface SuiviCommande {
  requeteId: string;
  appelId: string | null;
  libelle: string;
  etat: EtatCommande;
  message: string;
  fichiers: LienFichier[];
  surfaces: SurfacesPlans | null;
}

export const useCommandesStudio = create<{ parAppel: Record<string, SuiviCommande> }>(() => ({ parAppel: {} }));
const majSuivi = (cle: string, s: Partial<SuiviCommande> & { requeteId: string }): void => {
  useCommandesStudio.setState((e) => ({ parAppel: { ...e.parAppel, [cle]: { ...{ appelId: null, libelle: '', etat: 'envoi' as EtatCommande, message: '', fichiers: [], surfaces: null }, ...e.parAppel[cle], ...s } } }));
};

/* ─── Transport ─── */

export interface CanalCommandes {
  postMessage(m: unknown): void;
  ecouter(f: (data: unknown) => void): () => void;
  fermer?(): void;
}

export function canalParDefaut(): CanalCommandes | null {
  try {
    if (typeof BroadcastChannel !== 'function') return null;
    const bc = new BroadcastChannel(CANAL_DIFFUSION_COMMANDES);
    return {
      postMessage: (m) => bc.postMessage(m),
      ecouter: (f) => { const h = (e: MessageEvent) => f(e.data); bc.addEventListener('message', h); return () => bc.removeEventListener('message', h); },
      fermer: () => bc.close(),
    };
  } catch { return null; }
}

function stockageParDefaut(): StockageSimple | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Registre local des envois (un appel d'outil / un clic = UNE commande, même après rechargement de la page). */
export const CLE_ENVOIS = 'mimmoza.studio.commandes-envoyees';
export function dejaEnvoyee(s: StockageSimple | null, appelId: string): boolean {
  if (!s) return false;
  try { return (JSON.parse(s.getItem(CLE_ENVOIS) ?? '[]') as string[]).includes(appelId); } catch { return false; }
}
export function noterEnvoi(s: StockageSimple | null, appelId: string): void {
  if (!s) return;
  try {
    const l = (JSON.parse(s.getItem(CLE_ENVOIS) ?? '[]') as string[]).filter((x) => x !== appelId);
    s.setItem(CLE_ENVOIS, JSON.stringify([...l, appelId].slice(-200)));
  } catch { /* ignoré */ }
}

export interface DemandeCommande {
  projetId: string;
  conversationId: string;
  messageId: string | null;
  /** Appel d'outil ou identifiant du clic : clé d'unicité de l'envoi. */
  appelId: string;
  libelle: string;
  commande?: { id: string; params: Record<string, string | number | boolean>; confirme?: boolean };
  phrase?: string;
}

export interface IssueEnvoi { etat: 'en-cours' | 'attente' | 'deja'; requeteId: string | null; message: string }

/**
 * Envoie UNE commande au Studio (attend l'accusé ; sinon file d'attente). Ne rejette jamais.
 * Le compte rendu arrive plus tard par `installerPontCommandesSite` (ou `attendreCompteRendu` dans les tests).
 */
export async function envoyerCommandeStudio(d: DemandeCommande, o: { canal?: CanalCommandes | null; stockage?: StockageSimple | null; delaiMs?: number; maintenant?: () => number } = {}): Promise<IssueEnvoi> {
  const s = o.stockage === undefined ? stockageParDefaut() : o.stockage;
  if (dejaEnvoyee(s, d.appelId)) return { etat: 'deja', requeteId: null, message: '' };
  noterEnvoi(s, d.appelId);
  const maintenant = o.maintenant ?? Date.now;
  const requeteId = nouvelIdRequete();
  const charge: ChargeCommande = {
    requeteId, projetId: d.projetId, ...(d.commande ? { commande: d.commande } : {}), ...(d.phrase ? { phrase: d.phrase } : {}),
    libelle: d.libelle, demandeLe: maintenant(), origine: { conversationId: d.conversationId, messageId: d.messageId, appelId: d.appelId },
  };
  majSuivi(d.appelId, { requeteId, appelId: d.appelId, libelle: d.libelle, etat: 'envoi', message: 'Envoi au Studio…' });
  const canalDefaut = o.canal === undefined ? canalParDefaut() : null;
  const canal = o.canal ?? canalDefaut;
  let accuse = false;
  if (canal) {
    accuse = await new Promise<boolean>((resoudre) => {
      let fini = false;
      const retirer = canal.ecouter((data) => {
        const lu = lireMessageCommandes(data);
        if (fini || !lu.ok || lu.message.canal !== 'commande.accuse' || lu.message.charge.requeteId !== requeteId) return;
        fini = true; clearTimeout(t); retirer(); resoudre(true);
      });
      const t = setTimeout(() => { if (fini) return; fini = true; retirer(); resoudre(false); }, o.delaiMs ?? DELAI_ACCUSE_COMMANDE_MS);
      canal.postMessage(creerMessageCommandes('commande.executer', charge));
    });
  }
  canalDefaut?.fermer?.();
  if (accuse) {
    if (s) retirerEnAttente(s, requeteId, maintenant());
    majSuivi(d.appelId, { requeteId, etat: 'en-cours', message: 'Le Studio exécute la commande…' });
    return { etat: 'en-cours', requeteId, message: 'Le Studio exécute la commande…' };
  }
  if (s) ajouterEnAttente(s, charge, maintenant());
  majSuivi(d.appelId, { requeteId, etat: 'attente', message: PHRASE_EN_ATTENTE });
  return { etat: 'attente', requeteId, message: PHRASE_EN_ATTENTE };
}

/* ─── Comptes rendus → conversation ─── */

/** Trace d'un compte rendu ou d'une notification dans copilot_action_runs (sans jetons : écrite par le site). */
export interface TraceStudio {
  messageId: string;
  actionKind: 'run_step';
  params: Record<string, unknown>;
  outcome: 'done' | 'failed' | 'refused';
  decidedBy: 'auto';
  message: string;
  createdAt: string;
}

export const ORIGINE_TRACE = 'studio';

/** PURE — trace d'un compte rendu (fichiers : chemins de dépôt seulement, jamais d'octets). */
export function traceCompteRendu(c: ChargeCompteRendu, messageId: string, fichiers: LienFichier[], quand: string): TraceStudio {
  const outcome = c.statut === 'fait' ? 'done' : c.statut === 'confirmation' || c.statut === 'autre-projet' ? 'refused' : 'failed';
  return {
    messageId, actionKind: 'run_step', outcome, decidedBy: 'auto', createdAt: quand,
    message: phraseCompteRendu(c).slice(0, 1500),
    params: {
      origine: ORIGINE_TRACE, type: 'compte-rendu', requeteId: c.requeteId, appelId: c.origine.appelId, commande: c.commandeId, libelle: c.libelle, statut: c.statut,
      ...(fichiers.length ? { fichiers: fichiers.map((f) => ({ nom: f.nom, format: f.format, chemin: f.chemin, note: f.note })) } : {}),
      ...(c.surfaces ? { surfaces: c.surfaces } : {}),
    },
  };
}

/** PURE — trace d'une notification automatique du Studio. */
export function traceNotification(id: string, texte: string, messageId: string, quand: string): TraceStudio {
  return { messageId, actionKind: 'run_step', outcome: 'done', decidedBy: 'auto', createdAt: quand, message: texte.slice(0, 1500), params: { origine: ORIGINE_TRACE, type: 'notification', notificationId: id } };
}

/** Une trace est-elle du Studio ? (lecture des action_runs relus en base) */
export function estTraceStudio(r: { params?: Record<string, unknown> | null }): boolean {
  return r.params?.origine === ORIGINE_TRACE;
}

/** PURE — dernier message de Mimmo persisté (id de base) d'une conversation : point d'attache des notifications. */
export function dernierMessagePersiste(messages: readonly { id: string; role: string; status?: string }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'assistant' && m.status !== 'streaming' && !m.id.startsWith('local-')) return m.id;
  }
  return null;
}

/* ─── Fil de la conversation → Studio ─── */

const RE_BLOC = /```[a-z0-9-]*[ \t]*\r?\n[\s\S]*?```/gi;
/** PURE — fil lisible : blocs techniques retirés, textes bornés, comptes rendus du Studio intercalés. */
export function filDeLaConversation(
  messages: readonly { id: string; role: string; text: string; createdAt?: string; status?: string }[],
  traces: readonly { messageId: string; message?: string; params?: Record<string, unknown> | null; createdAt?: string }[] = [],
): MessageFil[] {
  const out: MessageFil[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const texte = m.text.replace(RE_BLOC, '').replace(/\n{3,}/g, '\n\n').trim();
    if (texte) out.push({ id: m.id, role: m.role, texte: texte.slice(0, MAX_TEXTE_FIL), quand: m.createdAt ?? null });
    for (const t of traces) if (t.messageId === m.id && estTraceStudio(t) && t.message) out.push({ id: `trace-${String(t.params?.requeteId ?? t.params?.notificationId ?? out.length)}`, role: 'info', texte: t.message.slice(0, MAX_TEXTE_FIL), quand: t.createdAt ?? null });
  }
  return out.slice(-MAX_MESSAGES_FIL);
}

/* ─── Installation (MimmozIAPage) ─── */

export interface DepsPontSite {
  conversationCourante(): string | null;
  messages(): readonly { id: string; role: string; text: string; createdAt?: string; status?: string }[];
  traces(): readonly { messageId: string; message?: string; params?: Record<string, unknown> | null; createdAt?: string }[];
  enCours(): boolean;
  /** Envoie un texte dans la conversation courante (même chemin que la saisie du chat). */
  envoyer(texte: string): void;
  /** Range la trace dans la conversation (store + base si la conversation est courante, sinon base seule). */
  ranger(trace: TraceStudio, conversationId: string): void;
  /** Dépose un fichier produit par le Studio ; rend le lien (signé) ou une note (format non accepté par le dépôt). */
  deposer(f: FichierCompteRendu, conversationId: string, requeteId: string): Promise<LienFichier>;
  /** S'abonne aux changements de messages (pour republier le fil). */
  abonner(f: () => void): () => void;
  canal?: CanalCommandes | null;
  stockage?: StockageSimple | null;
}

/** Traitement d'un compte rendu (testé) : fichiers déposés, trace rangée, carte mise à jour. Une fois par requête. */
export async function recevoirCompteRendu(c: ChargeCompteRendu, deps: Pick<DepsPontSite, 'ranger' | 'deposer' | 'messages' | 'conversationCourante'>, vus: Set<string>): Promise<SuiviCommande | null> {
  if (vus.has(c.requeteId)) return null;
  vus.add(c.requeteId);
  const conversationId = c.origine.conversationId ?? conversationDuProjet(c.projetId);
  if (!conversationId) return null;
  const fichiers: LienFichier[] = [];
  for (const f of c.fichiers) {
    if (!f.octets) { fichiers.push({ nom: f.nom, format: f.format, url: null, chemin: null, note: 'téléchargé dans l’onglet du Studio' }); continue; }
    try { fichiers.push(await deps.deposer(f, conversationId, c.requeteId)); } catch (e) {
      fichiers.push({ nom: f.nom, format: f.format, url: null, chemin: null, note: `dépôt impossible : ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  const messageId = c.origine.messageId && !c.origine.messageId.startsWith('local-')
    ? c.origine.messageId
    : conversationId === deps.conversationCourante() ? dernierMessagePersiste(deps.messages()) : null;
  if (messageId) deps.ranger(traceCompteRendu(c, messageId, fichiers, new Date(c.termineLe || Date.now()).toISOString()), conversationId);
  const etat: EtatCommande = c.statut === 'fait' ? 'fait' : c.statut === 'confirmation' ? 'confirmation' : c.statut === 'echec' || c.statut === 'occupe' ? 'echec' : 'refus';
  const suivi: SuiviCommande = { requeteId: c.requeteId, appelId: c.origine.appelId, libelle: c.libelle, etat, message: phraseCompteRendu(c), fichiers, surfaces: c.surfaces };
  if (c.origine.appelId) majSuivi(c.origine.appelId, suivi);
  return suivi;
}

export function installerPontCommandesSite(deps: DepsPontSite): () => void {
  const canalDefaut = deps.canal === undefined ? canalParDefaut() : null;
  const canal = deps.canal ?? canalDefaut;
  const stockage = deps.stockage === undefined ? stockageParDefaut() : deps.stockage;
  if (!canal) return () => undefined;
  const vus = new Set<string>();
  const notifVues = new Set<string>();
  const projetCourant = (): string | null => { const c = deps.conversationCourante(); return c ? `mzchat-${c}`.slice(0, 80) : null; };
  const publierFil = (): void => {
    const conv = deps.conversationCourante();
    const p = projetCourant();
    if (!conv || !p) return;
    canal.postMessage(creerMessageCommandes('fil.etat', { projetId: p, conversationId: conv, messages: filDeLaConversation(deps.messages(), deps.traces()), envoiPossible: !deps.enCours(), enCours: deps.enCours() }));
  };
  const viderEnAttente = (): void => {
    const p = projetCourant();
    if (!p || !stockage) return;
    for (const c of prendreComptesRendusEnAttente(stockage, p)) void recevoirCompteRendu(c, deps, vus);
  };
  const retirer = canal.ecouter((data) => {
    const lu = lireMessageCommandes(data);
    if (!lu.ok) return;
    const m: MessageCommandes = lu.message;
    switch (m.canal) {
      case 'commande.compte-rendu':
        // Reçu en direct : la copie gardée par le Studio est retirée de la file (traitée une seule fois : `vus`).
        void recevoirCompteRendu(m.charge, deps, vus).then(() => {
          if (stockage) for (const x of prendreComptesRendusEnAttente(stockage, m.charge.projetId)) void recevoirCompteRendu(x, deps, vus);
          publierFil();
        });
        return;
      case 'studio.notification': {
        const conv = conversationDuProjet(m.charge.projetId);
        if (!conv || notifVues.has(m.charge.id)) return;
        notifVues.add(m.charge.id);
        const messageId = conv === deps.conversationCourante() ? dernierMessagePersiste(deps.messages()) : null;
        if (messageId) deps.ranger(traceNotification(m.charge.id, m.charge.texte, messageId, new Date(m.charge.quand || Date.now()).toISOString()), conv);
        publierFil();
        return;
      }
      case 'studio.pret': case 'fil.demander':
        if (m.charge.projetId === projetCourant()) publierFil();
        return;
      case 'fil.envoyer':
        if (m.charge.projetId === projetCourant() && !deps.enCours()) deps.envoyer(m.charge.texte);
        return;
      case 'fil.revenir':
        if (m.charge.projetId === projetCourant()) { try { window.focus(); } catch { /* navigateur */ } }
        return;
      default:
    }
  });
  const desabonner = deps.abonner(() => { publierFil(); viderEnAttente(); });
  viderEnAttente();
  publierFil();
  return () => { retirer(); desabonner(); canalDefaut?.fermer?.(); };
}

/* ─── Carte de l'outil `studio_commander` ─── */

export const OUTIL_STUDIO_COMMANDER = 'studio_commander';
/** Au-delà, une carte relue (ancienne conversation) n'envoie plus rien d'elle-même. */
export const FENETRE_ENVOI_MS = 15 * 60_000;

export interface CarteCommande {
  appelId: string;
  libelle: string;
  commande: { id: string; params: Record<string, string | number | boolean>; confirme?: boolean } | null;
  phrase: string | null;
  emisLe: number;
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** PURE — carte d'un appel `studio_commander` terminé (null : autre outil, en cours, ou attente de l'accord). */
export function lireCarteCommande(tc: { id: string; name: string; status?: string; output?: unknown }): CarteCommande | null {
  if (tc.name !== OUTIL_STUDIO_COMMANDER || tc.status === 'running') return null;
  const o = tc.output;
  if (!estObjet(o) || o.status !== 'ok' || !estObjet(o.data) || o.data.carte !== 'commande-studio') return null;
  const d = o.data;
  const c = estObjet(d.commande) && typeof d.commande.id === 'string' && estObjet(d.commande.params)
    ? { id: d.commande.id, params: d.commande.params as Record<string, string | number | boolean>, ...(d.commande.confirme === true ? { confirme: true } : {}) }
    : null;
  const phrase = typeof d.phrase === 'string' && d.phrase.trim() ? d.phrase.trim() : null;
  if (!c && !phrase) return null;
  return { appelId: tc.id, libelle: typeof d.libelle === 'string' ? d.libelle : (c?.id ?? 'Demande au Studio'), commande: c, phrase, emisLe: typeof d.emis_le === 'number' ? d.emis_le : 0 };
}

/** PURE — la carte doit-elle envoyer sa commande maintenant ? (une fois, et seulement si elle est récente). */
export function doitEnvoyer(carte: CarteCommande, maintenant: number, dejaTracee: boolean, dejaEnvoyeeIci: boolean): boolean {
  return !dejaTracee && !dejaEnvoyeeIci && carte.emisLe > 0 && maintenant - carte.emisLe <= FENETRE_ENVOI_MS;
}

/** Tests. */
export function reinitialiserCommandesSite(): void { useCommandesStudio.setState({ parAppel: {} }); }
