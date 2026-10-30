// src/spaces/copilot/agent/agent.types.ts
// =============================================================================
// Types de l'« agent autonome » MimmozIA, côté navigateur.
// Reprennent le contrat commun (CONTRAT_AGENT_AUTONOME.md, §1 et §2.5) :
// tables agent_missions, agent_mission_journal, agent_memoire_projet,
// agent_actions_externes, agent_briefings, colonnes ajoutées à
// user_ai_preferences. Tout champ venu du serveur est relu avec prudence
// (agentLogique.ts) : un champ absent ne doit jamais casser l'écran.
// =============================================================================

export type MissionStatut =
  | 'devis' | 'en_attente' | 'en_cours' | 'attente_utilisateur'
  | 'terminee' | 'budget_atteint' | 'echec' | 'annulee';

export type MissionType =
  | 'prospection_fonciere' | 'faisabilite' | 'etude_marche' | 'veille' | 'libre';

export interface DevisMission {
  jetons_min: number;
  jetons_max: number;
  etapes_max?: number;
  duree_estimee_min?: number;
  tier?: string;
  explication?: string;
  /** Dates ISO d'émission et d'expiration du devis (valable 24 h). */
  emis_le?: string;
  expire_le?: string;
}

export interface TerrainRapport {
  idu: string;
  commune?: string;
  adresse?: string;
  surface_m2?: number | null;
  zonage?: string | null;
  verdict?: string;
  potentiel_logements?: number | null;
  charge_fonciere_admissible?: number | null;
  points_forts: string[];
  points_bloquants: string[];
  sources: string[];
}

export interface RapportMission {
  titre: string;
  synthese: string;
  terrains: TerrainRapport[];
  actions_proposees: string[];
  memoire_ajoutee: number;
  limites: string[];
  jetons_consommes: number | null;
}

export interface Mission {
  id: string;
  projet_id: string | null;
  conversation_id: string | null;
  origine: 'chat' | 'proactif' | string;
  type: MissionType | string;
  objectif: string;
  statut: MissionStatut | string;
  devis: DevisMission | null;
  jetons_reserves: number;
  jetons_consommes: number;
  etapes_faites: number;
  etapes_max: number;
  question_en_attente: string | null;
  rapport: RapportMission | null;
  erreur: string | null;
  cree_le: string | null;
  maj_le: string | null;
  termine_le: string | null;
}

export type GenreJournal =
  | 'plan' | 'pensee' | 'outil' | 'resultat' | 'question' | 'reponse'
  | 'memoire' | 'action' | 'erreur' | 'fin';

export interface LigneJournal {
  id: number | string;
  n: number;
  genre: GenreJournal | string;
  outil: string | null;
  resume: string;
  jetons: number;
  cree_le: string | null;
}

export type GenreMemoire = 'fait' | 'hypothese' | 'decision' | 'preference' | 'document' | 'contact';

export interface ElementMemoire {
  id: string;
  projet_id: string | null;
  mission_id: string | null;
  genre: GenreMemoire | string;
  cle: string | null;
  contenu: string;
  source: string | null;
  confiance: 'confirme' | 'estime' | 'a_verifier' | string | null;
  epingle: boolean;
  cree_le: string | null;
  maj_le: string | null;
}

export interface DestinataireAction {
  nom: string;
  qualite: string;
  email?: string;
  adresse?: string;
}

export type StatutAction = 'brouillon' | 'valide' | 'envoye' | 'refuse' | 'echec';

export interface ActionExterne {
  id: string;
  mission_id: string | null;
  projet_id: string | null;
  canal: 'email' | 'courrier' | string;
  destinataire: DestinataireAction;
  objet: string;
  corps: string;
  statut: StatutAction | string;
  erreur: string | null;
  cree_le: string | null;
  envoye_le: string | null;
}

export interface ElementBriefing {
  genre: string;
  titre: string;
  detail: string;
  lien?: string;
  mission_id?: string;
  source?: string;
}

export interface Briefing {
  id: string;
  titre: string;
  resume: string;
  elements: ElementBriefing[];
  lu: boolean;
  cree_le: string | null;
  mission_id: string | null;
}

export interface PreferencesProactif {
  proactif_actif: boolean;
  budget_proactif_mensuel: number;
  proactif_consomme_mois: number;
  learning_enabled: boolean;
}

/** Ce que la carte de devis sait d'une proposition de mission, lue dans le fil. */
export interface PropositionDevis {
  missionId: string | null;
  objectif: string | null;
  type: string | null;
  devis: DevisMission | null;
}
