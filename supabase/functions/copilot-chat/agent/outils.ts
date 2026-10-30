// supabase/functions/copilot-chat/agent/outils.ts
// =============================================================
// Déclarations des outils de l'agent :
//   · outils du CHAT (vertical promoteur) : proposer_mission, etat_mission,
//     lister_missions, memoriser ;
//   · outils PROPRES À LA MISSION (jamais exposés au chat) : noter_carnet,
//     memoriser, rediger_action_externe, demander_utilisateur, terminer_mission.
// =============================================================

import type { OutilDef } from './types.ts';
import { TYPES_MISSION, GENRES_MEMOIRE } from './types.ts';

const TOUS_MODES: OutilDef['available_in_modes'] = ['quick', 'advanced', 'report'];

export const OUTIL_MEMORISER: OutilDef = {
  name: 'memoriser',
  description:
    "Enregistre un élément dans la MÉMOIRE DU PROJET (persistante d'une conversation à l'autre) : une décision " +
    "prise, une hypothèse retenue, une préférence de l'utilisateur, un fait établi par un outil, un contact, un " +
    "document de référence. N'enregistre que ce que l'utilisateur a dit ou ce qu'un outil a établi — jamais une " +
    "supposition présentée comme un fait. Une même `cle` met à jour l'élément existant.",
  input_schema: {
    type: 'object',
    properties: {
      genre: { type: 'string', enum: [...GENRES_MEMOIRE] },
      cle: { type: 'string', description: "Identifiant court et stable (ex. « budget-charge-fonciere », « programme-vise »)." },
      contenu: { type: 'string', description: 'Le contenu à retenir, en une ou quelques phrases (≤ 4 000 caractères).' },
      confiance: { type: 'string', enum: ['confirme', 'estime', 'a_verifier'] },
      source: { type: 'string', description: "Outil ou « utilisateur » à l'origine de l'information." },
      projet_id: { type: 'string', description: 'Identifiant du projet (uuid) si connu ; sinon le projet courant.' },
    },
    required: ['genre', 'contenu'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_PROPOSER_MISSION: OutilDef = {
  name: 'proposer_mission',
  description:
    "Propose une MISSION AUTONOME en arrière-plan (agent foncier) et affiche un DEVIS à l'utilisateur. " +
    "À utiliser dès que la demande dépasse ~5 appels d'outils : prospection foncière sur une ou plusieurs " +
    "communes, comparaison de plusieurs terrains, dossier complet, faisabilité multi-parcelles, étude de marché " +
    "approfondie. NE LANCE RIEN et NE DÉBITE RIEN : l'utilisateur valide lui-même le devis. Renseigne un objectif " +
    "précis et des critères complets.",
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...TYPES_MISSION] },
      objectif: { type: 'string', description: 'Objectif de la mission en une à trois phrases (≤ 2 000 caractères).' },
      criteres: {
        type: 'object',
        description: 'Critères : communes (noms et/ou codes INSEE), surface_min_m2, surface_max_m2, zonages, programme, budget_charge_fonciere_eur, nombre_logements_vise, contraintes…',
      },
      projet_id: { type: 'string', description: 'Identifiant du projet (uuid) si la mission s’y rattache.' },
    },
    required: ['type', 'objectif'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_ETAT_MISSION: OutilDef = {
  name: 'etat_mission',
  description:
    "Donne l'état d'une mission autonome (statut, progression, jetons consommés/réservés, question en attente, " +
    'synthèse du rapport). Sans identifiant : la mission la plus récente.',
  input_schema: { type: 'object', properties: { mission_id: { type: 'string' } } },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_LISTER_MISSIONS: OutilDef = {
  name: 'lister_missions',
  description: "Liste les 10 dernières missions autonomes de l'utilisateur avec leur statut.",
  input_schema: { type: 'object', properties: {} },
  available_in_modes: TOUS_MODES,
};

/** Outils exposés au LLM du chat (vertical promoteur uniquement). */
export const OUTILS_AGENT_CHAT: OutilDef[] = [
  OUTIL_PROPOSER_MISSION, OUTIL_ETAT_MISSION, OUTIL_LISTER_MISSIONS, OUTIL_MEMORISER,
];
export const NOMS_OUTILS_AGENT_CHAT: ReadonlySet<string> = new Set(OUTILS_AGENT_CHAT.map((o) => o.name));

// ── Outils propres à la mission ─────────────────────────────────────────────

export const OUTIL_NOTER_CARNET: OutilDef = {
  name: 'noter_carnet',
  description:
    "Ajoute une note à ton CARNET DE TRAVAIL (ce qui est fait, écarté et pourquoi, à faire, chiffres clés avec leur " +
    'outil source). Le carnet est la seule mémoire de travail qui survit entre les étapes : note tout ce dont tu auras besoin.',
  input_schema: {
    type: 'object',
    properties: { note: { type: 'string', description: 'Une note courte (≤ 500 caractères).' } },
    required: ['note'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_REDIGER_ACTION: OutilDef = {
  name: 'rediger_action_externe',
  description:
    "Prépare un BROUILLON de courrier ou d'e-mail (propriétaire, mairie, notaire, agence). RIEN N'EST ENVOYÉ : " +
    "l'utilisateur relit, modifie et décide seul de l'envoi. Ton professionnel, sobre, sans promesse ni prix ; " +
    "n'invente aucune coordonnée (laisse email/adresse vides si un outil ne les a pas fournis).",
  input_schema: {
    type: 'object',
    properties: {
      canal: { type: 'string', enum: ['email', 'courrier'] },
      destinataire: {
        type: 'object',
        properties: {
          nom: { type: 'string' },
          qualite: { type: 'string', enum: ['proprietaire', 'mairie', 'notaire', 'agence', 'autre'] },
          email: { type: 'string' },
          adresse: { type: 'string' },
        },
        required: ['nom', 'qualite'],
      },
      objet: { type: 'string', description: '≤ 300 caractères.' },
      corps: { type: 'string', description: 'Texte complet du courrier (≤ 20 000 caractères).' },
    },
    required: ['canal', 'destinataire', 'objet', 'corps'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_DEMANDER_UTILISATEUR: OutilDef = {
  name: 'demander_utilisateur',
  description:
    "Pose UNE question à l'utilisateur et met la mission en pause jusqu'à sa réponse. À réserver aux informations " +
    'décisives impossibles à supposer raisonnablement (programme, budget, commune…). La mission dort ensuite.',
  input_schema: {
    type: 'object',
    properties: { question: { type: 'string', description: 'Question claire et autonome (≤ 1 000 caractères).' } },
    required: ['question'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_TERMINER_MISSION: OutilDef = {
  name: 'terminer_mission',
  description:
    "Termine la mission en remettant le RAPPORT final structuré (titre, synthese, terrains[], limites[]). " +
    "N'appelle cet outil qu'une fois l'objectif atteint ou impossible à atteindre.",
  input_schema: {
    type: 'object',
    properties: {
      rapport: {
        type: 'object',
        properties: {
          titre: { type: 'string' },
          synthese: { type: 'string' },
          terrains: { type: 'array', items: { type: 'object' } },
          limites: { type: 'array', items: { type: 'string' } },
          elements: {
            type: 'array',
            description: 'Missions de veille uniquement : signaux qualifiés {source, genre, titre, detail, lien?, retenu}.',
            items: { type: 'object' },
          },
        },
        required: ['titre', 'synthese'],
      },
    },
    required: ['rapport'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTILS_MISSION: OutilDef[] = [
  OUTIL_NOTER_CARNET, OUTIL_MEMORISER, OUTIL_REDIGER_ACTION, OUTIL_DEMANDER_UTILISATEUR, OUTIL_TERMINER_MISSION,
];
export const NOMS_OUTILS_MISSION: ReadonlySet<string> = new Set(OUTILS_MISSION.map((o) => o.name));

/**
 * Outils du chat proposés en MISSION — liste BLANCHE (revue 30/10/2026, B4).
 *
 * La liste complète du mode report pèse ~20-25 k tokens par tour : multipliée
 * par 30 étapes, c'était l'essentiel du coût d'une mission. On ne garde que ce
 * qui sert la méthode du directeur foncier (repérer, filtrer, approfondir,
 * identifier, chiffrer) :
 *   repérer      : rechercher_parcelles, get_parcelle_depuis_adresse, get_parcel_summary
 *   filtrer      : get_zonage_plu, get_prescriptions_urbanisme, get_servitudes,
 *                  get_risks_georisques, get_ppr_detail
 *   approfondir  : get_etude_parcelle, get_dvf_comparables, get_etude_marche,
 *                  get_sitadel, get_logement_social, get_contexte_commune
 *   chiffrer     : get_couts_construction, calculer_bilan_financier, get_bilan_promoteur
 *   identifier   : get_proprietaire_parcelle, get_contacts_mairies
 * Veille : mêmes outils de vérification + get_veille_marche, sans les outils
 * d'identification ni de chiffrage (on qualifie un signal, on ne monte pas d'opération).
 * Tout outil absent de `outilsChat()` (non déployé) est simplement ignoré.
 */
export const OUTILS_CHAT_MISSION_PROSPECTION: readonly string[] = [
  'rechercher_parcelles', 'get_parcelle_depuis_adresse', 'get_parcel_summary',
  'get_zonage_plu', 'get_prescriptions_urbanisme', 'get_servitudes', 'get_risks_georisques', 'get_ppr_detail',
  'get_etude_parcelle', 'get_dvf_comparables', 'get_etude_marche', 'get_sitadel', 'get_logement_social',
  'get_contexte_commune',
  'get_couts_construction', 'calculer_bilan_financier', 'get_bilan_promoteur',
  'get_proprietaire_parcelle', 'get_contacts_mairies',
];
export const OUTILS_CHAT_MISSION_VEILLE: readonly string[] = [
  'rechercher_parcelles', 'get_parcelle_depuis_adresse', 'get_parcel_summary',
  'get_zonage_plu', 'get_prescriptions_urbanisme', 'get_servitudes', 'get_risks_georisques', 'get_ppr_detail',
  'get_etude_parcelle', 'get_dvf_comparables', 'get_etude_marche', 'get_sitadel', 'get_contexte_commune',
  'get_veille_marche',
];

/** Outils de mission retirés en veille (I4) : ni courrier, ni mémoire. */
export const OUTILS_MISSION_INTERDITS_VEILLE: ReadonlySet<string> = new Set(['rediger_action_externe', 'memoriser']);

/**
 * Garde-fou supplémentaire (défense en profondeur) : même présent dans une liste
 * blanche, un outil d'action d'interface, d'écriture sous identité utilisateur
 * ou de mission n'est jamais exécuté depuis une mission.
 */
export function outilChatAutoriseEnMission(nom: string): boolean {
  if (nom.startsWith('action_')) return false;
  if (/^(creer|desactiver|modifier|marquer)_/.test(nom)) return false;
  if (['proposer_suivi_projet', 'get_suivi_projet'].includes(nom)) return false;
  if (NOMS_OUTILS_AGENT_CHAT.has(nom)) return false;
  return true;
}

/** Outils envoyés au modèle pour une mission de ce type. */
export function outilsPourMission(type: string, outilsChat: OutilDef[]): OutilDef[] {
  const veille = type === 'veille';
  const blanche = new Set(veille ? OUTILS_CHAT_MISSION_VEILLE : OUTILS_CHAT_MISSION_PROSPECTION);
  const chat = outilsChat.filter((o) => blanche.has(o.name) && outilChatAutoriseEnMission(o.name) && !NOMS_OUTILS_MISSION.has(o.name));
  const propres = OUTILS_MISSION.filter((o) => !(veille && OUTILS_MISSION_INTERDITS_VEILLE.has(o.name)));
  return [...chat, ...propres];
}
