// supabase/functions/copilot-chat/agent/types.ts
// =============================================================
// Types partagés du moteur de mission.
//
// Volontairement AUTONOMES : aucun import de ../index.ts. L'index importe le
// moteur, le moteur ne doit jamais importer l'index (import circulaire, et
// surtout `Deno.serve` exécuté au chargement des tests). Les fonctions de
// l'index (executeTool, streamLLMTurn, facturation…) sont INJECTÉES via
// `MoteurDeps`. Les formes ci-dessous sont des sous-ensembles structurels des
// types de l'index : TypeScript vérifie la compatibilité au point d'injection.
// =============================================================

export type ModeCopilot = 'quick' | 'advanced' | 'report';
export type Tier = 'haiku' | 'sonnet' | 'opus';

export type TypeMission = 'prospection_fonciere' | 'faisabilite' | 'etude_marche' | 'veille' | 'libre';
export const TYPES_MISSION: readonly TypeMission[] = [
  'prospection_fonciere', 'faisabilite', 'etude_marche', 'veille', 'libre',
];

export type StatutMission =
  | 'devis' | 'en_attente' | 'en_cours' | 'attente_utilisateur'
  | 'terminee' | 'budget_atteint' | 'echec' | 'annulee';

export const STATUTS_FINAUX: readonly StatutMission[] = ['terminee', 'budget_atteint', 'echec', 'annulee'];

/** Sous-ensemble structurel de `ToolDef` (index.ts). */
export interface OutilDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  available_in_modes: ModeCopilot[];
}

/** Sous-ensemble structurel de `ToolResult` (index.ts). */
export interface ResultatOutil {
  status: string;
  source: string;
  data?: Record<string, unknown>;
  message?: string;
}

export type MessageLLM = { role: 'user' | 'assistant'; content: string | unknown[] };

/** Sous-ensemble structurel de `LLMTurnResult` (index.ts). */
export interface TourLLM {
  textBlocks: string[];
  contentBlocks: Record<string, unknown>[];
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  webSearches: number;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Devis {
  jetons_min: number;
  jetons_max: number;
  etapes_max: number;
  duree_estimee_min: number;
  tier: Tier;
  explication: string;
  /** Pire cas d'une étape au plafond d'entrée (base du devis). */
  pire_cas_etape?: number;
  entree_max_tokens?: number;
  emis_le?: string;
  expire_le?: string;
}

export interface MissionRow {
  id: string;
  user_id: string;
  projet_id: string | null;
  conversation_id: string | null;
  origine: 'chat' | 'proactif';
  type: TypeMission;
  objectif: string;
  criteres: Record<string, unknown>;
  statut: StatutMission;
  devis: Devis | null;
  reservation_id: string | null;
  jetons_reserves: number;
  jetons_consommes: number;
  etapes_faites: number;
  etapes_max: number;
  etat: Partial<EtatMission> | null;
  question_en_attente: string | null;
  rapport: Record<string, unknown> | null;
  erreur: string | null;
  regle_le?: string | null;
  worker?: string | null;
  cree_le?: string | null;
  maj_le?: string | null;
}

/** Un « tour » d'historique : toujours une paire assistant → user. */
export interface TourHistorique {
  n: number;
  assistant: unknown[];
  user: unknown[];
}

/** Tour LLM déjà payé, pas encore traité (revue B2) : rejoué sans nouvel appel ni débit. */
export interface EtapeEnVol {
  n: number;
  phase: 'plan' | 'travail' | 'rapport';
  textBlocks: string[];
  contentBlocks: Record<string, unknown>[];
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  cout: number;
  /** Résultats déjà obtenus (outils à effet de bord) : jamais rejoués à la reprise. */
  resultats: Record<string, string>;
}

/** État interne du moteur, persisté dans agent_missions.etat après CHAQUE étape. */
export interface EtatMission {
  version: 1;
  phase: 'plan' | 'travail' | 'rapport' | 'fini';
  plan: string[];
  carnet: string[];
  /** Les derniers tours, intacts (appariement tool_use/tool_result garanti). */
  tours: TourHistorique[];
  /** Résumés des tours plus anciens (≤ ~400 tokens chacun). */
  resumes: string[];
  /** Dernier n d'étape débité ET traité (clé d'idempotence du débit). */
  n_etape: number;
  /** Étape payée mais pas encore traitée. */
  en_vol?: EtapeEnVol | null;
  /** Dernier verdict de `agent_mission_debiter`. */
  peut_continuer: boolean;
  /** Question posée à l'utilisateur, en attente de réponse. */
  attente?: { question: string } | null;
  /** Écrit par la RPC agent_mission_repondre ; consommé par le moteur à la reprise. */
  derniere_reponse?: { question?: string | null; reponse: string; le?: string } | null;
  actions_ids: string[];
  memoire_ajoutee: number;
  erreurs_consecutives: number;
  /** Tentatives de rédaction du rapport (sauvegardé AVANT l'appel, revue I1). */
  tentatives_rapport: number;
  /** Raison de passage en phase rapport. */
  raison_rapport?: 'budget_atteint' | 'etapes_max' | 'erreurs' | null;
  /** Rapport normalisé et statut final, sauvegardés AVANT la clôture (revue I8). */
  cloture?: { statut: StatutMission; rapport: Record<string, unknown>; erreur: string | null } | null;
  /** Vrai une fois le briefing écrit (missions de veille). */
  briefing_ecrit?: boolean;
}

export type GenreJournal =
  | 'plan' | 'pensee' | 'outil' | 'resultat' | 'question' | 'reponse'
  | 'memoire' | 'action' | 'erreur' | 'fin';

export type GenreMemoire = 'fait' | 'hypothese' | 'decision' | 'preference' | 'document' | 'contact';
export const GENRES_MEMOIRE: readonly GenreMemoire[] = ['fait', 'hypothese', 'decision', 'preference', 'document', 'contact'];

export interface ElementMemoire {
  id?: string;
  genre: GenreMemoire;
  cle: string | null;
  contenu: string;
  source: string | null;
  confiance: 'confirme' | 'estime' | 'a_verifier' | null;
  epingle: boolean;
  projet_id: string | null;
  maj_le?: string | null;
}

export interface ActionExterne {
  user_id: string;
  mission_id: string | null;
  projet_id: string | null;
  canal: 'email' | 'courrier';
  destinataire: { nom: string; qualite: string; email?: string; adresse?: string };
  objet: string;
  corps: string;
}

export interface Briefing {
  titre: string;
  resume: string;
  elements: unknown[];
}

export interface ResultatDebit {
  ok: boolean;
  deja_debite?: boolean;
  reste: number;
  peut_continuer: boolean;
  jetons_consommes?: number;
  jetons_reserves?: number;
  statut?: string;
  raison?: string;
}

/**
 * Accès aux données du moteur — une méthode par RPC / requête de la migration
 * 20261030_agent_autonome.sql. Implémentation réelle : `depotSupabase`
 * (depot.ts) ; implémentation de test : en mémoire (mission.test.ts).
 */
export interface DepotMission {
  /** agent_mission_prendre : en_attente, en_cours, closes non réglées ; pose le bail. */
  prendreMissions(worker: string, bailS: number): Promise<MissionRow[]>;
  /** agent_mission_reserver : réserve devis.jetons_max ET passe en_cours (atomique). */
  reserver(id: string): Promise<{ ok: boolean; raison?: string; jetons_reserves?: number }>;
  prolongerBail(id: string, worker: string, bailS: number): Promise<boolean>;
  libererBail(id: string, worker: string): Promise<void>;
  chargerMission(id: string): Promise<MissionRow | null>;
  /** Sauvegarde de l'état interne (jamais du statut). */
  sauverEtat(id: string, etat: EtatMission): Promise<void>;
  /** en_cours → attente_utilisateur (conditionnel : false si la mission a changé de statut). */
  mettreEnAttente(id: string, question: string, etat: EtatMission): Promise<boolean>;
  /**
   * agent_mission_debiter(p_id, p_n, p_jetons, p_pire_cas_suivant, p_etat) :
   * idempotent par (mission, n), sauve `etat` dans la même transaction ;
   * raison 'etat_trop_gros' (> 512 Ko) → rien débité, rien sauvé.
   */
  debiter(id: string, n: number, jetons: number, pireCasSuivant: number, etat: EtatMission | null): Promise<ResultatDebit>;
  /** agent_proactif_etat : veille proactive toujours autorisée ? */
  proactifEtat(userId: string): Promise<{ actif: boolean; learning_enabled: boolean; restant?: number }>;
  cloturer(id: string, statut: StatutMission, rapport: Record<string, unknown> | null, erreur: string | null): Promise<void>;
  /** agent_mission_regler : facture least(consommé, réservé), rembourse le reste. Idempotent. */
  regler(id: string): Promise<{ ok: boolean; deja_regle?: boolean; jetons_factures?: number; jetons_rembourses?: number; raison?: string }>;
  journal(missionId: string, genre: GenreJournal, outil: string | null, entree: unknown, resume: string, jetons: number): Promise<void>;
  creerActionBrouillon(a: ActionExterne): Promise<string>;
  memoriser(userId: string, missionId: string | null, e: ElementMemoire): Promise<void>;
  lireMemoire(userId: string, projetId: string | null, limite: number): Promise<ElementMemoire[]>;
  creerBriefing(userId: string, missionId: string, b: Briefing): Promise<void>;
  creerMission(row: Record<string, unknown>): Promise<string>;
  listerMissions(userId: string, limite: number): Promise<MissionRow[]>;
  chargerMissionUtilisateur(userId: string, id: string): Promise<MissionRow | null>;
  /** Le projet existe ET appartient à l'utilisateur (créateur ou membre de l'organisation). */
  projetAccessible(userId: string, id: string): Promise<boolean>;
}

/** Fonctions de l'index injectées dans le moteur (pas d'import circulaire). */
export interface MoteurDeps {
  executeTool(name: string, input: Record<string, unknown>, ctx: Record<string, unknown>): Promise<ResultatOutil>;
  streamLLMTurn(p: {
    model: string; system: string; messages: MessageLLM[]; tools: OutilDef[];
    maxTokens: number;
  }): Promise<TourLLM>;
  debitJetons(tier: Tier, inputTokens: number, outputTokens: number, webSearches?: number): number;
  /** Conservé pour compatibilité d'injection ; le moteur ne s'en sert plus (devis propre aux missions). */
  worstCaseJetons?(tier: Tier, mode: ModeCopilot): number;
  tierUtilisateur(userId: string): Promise<Tier>;
  modelePourTier(tier: Tier): string;
  /** Outils du chat utilisables en mission (le moteur retire lui-même les actions d'interface). */
  outilsChat(): OutilDef[];
  /** Fonction pure fournie par l'agent PROACTIF (briefing.ts) ; optionnelle. */
  briefingPourMissionVeille?: (mission: { id?: string; statut?: string; rapport?: unknown; criteres?: unknown }) => Briefing | null;
  now?: () => number;
}
