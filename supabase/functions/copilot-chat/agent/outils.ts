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
    properties: {
      question: { type: 'string', description: 'Question claire et autonome (≤ 1 000 caractères).' },
      formulaire: {
        type: 'string', enum: ['regles_conception'],
        description: "Mission de conception : affiche à l'utilisateur le FORMULAIRE des règles PLU clés, pré-rempli par le moteur avec les règles déjà enregistrées (tu n'as pas à les recopier).",
      },
    },
    required: ['question'],
  },
  available_in_modes: TOUS_MODES,
};

const REGLE_PROPS = {
  type: 'object',
  properties: {
    cle: { type: 'string', enum: ['hauteur_max_m', 'niveaux_max', 'emprise_sol_max_pct', 'recul_voie_m', 'recul_limites_m', 'recul_limites_formule', 'pleine_terre_min_pct', 'stationnement_par_logement', 'mixite_sociale_pct'] },
    valeur: { type: ['number', 'string', 'null'], description: 'Nombre (m, %, niveaux, places) ; texte pour recul_limites_formule ; null si inconnue. Pourcentages en pourcent (30 = 30 %).' },
    statut: { type: 'string', enum: ['confirme', 'estime', 'manquant'] },
    source: { type: 'string', description: 'Outil ou document d’origine (obligatoire).' },
    article: { type: 'string' },
    texte: { type: 'string', description: 'Citation courte du règlement.' },
  },
  required: ['cle', 'valeur', 'source'],
};

export const OUTIL_RECUPERER_PARCELLE: OutilDef = {
  name: 'recuperer_parcelle',
  description: 'Conception : récupère le CONTOUR cadastral réel (GeoJSON) et la contenance de la parcelle de la mission, et les enregistre dans le dossier.',
  input_schema: { type: 'object', properties: { idu: { type: 'string' } }, required: ['idu'] },
  available_in_modes: TOUS_MODES,
};
export const OUTIL_LIRE_REGLES_IMPORTEES: OutilDef = {
  name: 'lire_regles_plu_importees',
  description:
    "Conception : cherche les règles chiffrées d'un règlement PLU DÉJÀ IMPORTÉ dans Mimmoza pour (code INSEE, code de zone) " +
    "et les enregistre au dossier (statut « estime »). Couverture très partielle : un résultat vide est normal.",
  input_schema: { type: 'object', properties: { code_insee: { type: 'string' }, zone_code: { type: 'string' } }, required: ['code_insee', 'zone_code'] },
  available_in_modes: TOUS_MODES,
};
export const OUTIL_ENREGISTRER_REGLES: OutilDef = {
  name: 'enregistrer_regles_conception',
  description:
    "Conception : enregistre des règles PLU clés au dossier (ex. mixité sociale lue par get_prescriptions_urbanisme). " +
    "Aucune règle sans source ; « confirme » n'est accepté que pour une règle lue dans le règlement avec son article — " +
    "sinon elle est enregistrée « estime ». Une règle plus sûre déjà enregistrée n'est jamais écrasée.",
  input_schema: { type: 'object', properties: { regles: { type: 'array', items: REGLE_PROPS } }, required: ['regles'] },
  available_in_modes: TOUS_MODES,
};
export const OUTIL_ENREGISTRER_PROGRAMME: OutilDef = {
  name: 'enregistrer_programme',
  description: 'Conception : enregistre le PROGRAMME proposé (cohérent avec le rapport de prospection et les règles connues).',
  input_schema: {
    type: 'object',
    properties: {
      nb_logements: { type: ['number', 'null'] },
      typologies: { type: 'object', properties: { T1: { type: 'number' }, T2: { type: 'number' }, T3: { type: 'number' }, T4: { type: 'number' }, T5: { type: 'number' } } },
      shab_cible_m2: { type: ['number', 'null'] }, sdp_cible_m2: { type: ['number', 'null'] },
      gabarit: { type: ['string', 'null'] }, stationnement: { type: ['number', 'null'] },
      justification: { type: 'string', description: 'D’où viennent ces chiffres (rapport de prospection, règles).' },
    },
  },
  available_in_modes: TOUS_MODES,
};
export const OUTIL_LIRE_REGLEMENT_PDF: OutilDef = {
  name: 'lire_reglement_pdf',
  description:
    "Conception : fait lire par l'IA le règlement PDF déposé par l'utilisateur dans le dossier de la conception, à l'étape " +
    "suivante (coût compté en jetons). Les règles trouvées avec leur article sont enregistrées « confirme ».",
  input_schema: { type: 'object', properties: { chemin: { type: 'string' }, zone_code: { type: 'string' } }, required: ['chemin'] },
  available_in_modes: TOUS_MODES,
};

export const OUTILS_CONCEPTION: OutilDef[] = [
  OUTIL_RECUPERER_PARCELLE, OUTIL_LIRE_REGLES_IMPORTEES, OUTIL_ENREGISTRER_REGLES, OUTIL_ENREGISTRER_PROGRAMME, OUTIL_LIRE_REGLEMENT_PDF,
];
export const NOMS_OUTILS_CONCEPTION: ReadonlySet<string> = new Set(OUTILS_CONCEPTION.map((o) => o.name));

const HYP_PROPS: Record<string, unknown> = {
  programme: {
    type: 'object',
    properties: {
      nb_logements: { type: ['number', 'null'] }, shab_m2: { type: ['number', 'null'] },
      sdp_m2: { type: ['number', 'null'] }, gabarit: { type: ['string', 'null'], description: 'ex. « R+4 »' },
    },
  },
  prix_vente_libre_eur_m2_shab: { type: ['number', 'null'], description: '€ HT par m² SHAB.' },
  source_prix: { type: ['string', 'null'], description: 'Outil et périmètre (ex. « get_etude_marche — médiane DVF commune 93048 »).' },
  part_lls_pct: { type: ['number', 'null'], description: 'En pourcent (25 = 25 %). null si non chiffrée par le PLU.' },
  prix_cession_lls_eur_m2_shab: { type: ['number', 'null'] },
  cout_travaux_eur_m2_sdp: { type: ['number', 'null'] },
  source_couts: { type: ['string', 'null'] },
  honoraires_pct_travaux: { type: ['number', 'null'] },
  aleas_pct_travaux: { type: ['number', 'null'] },
  commercialisation_pct_ca: { type: ['number', 'null'] },
  frais_financiers_pct_ca: { type: ['number', 'null'] },
  frais_acquisition_pct_foncier: { type: ['number', 'null'] },
  taxes_urbanisme_eur: { type: ['number', 'null'] },
  vrd_eur: { type: ['number', 'null'] },
  demolition_eur: { type: ['number', 'null'] },
  marge_cible_pct_ca: { type: ['number', 'null'] },
};

export const OUTIL_RAPPORT_HYPOTHESES: OutilDef = {
  name: 'rapport_hypotheses',
  description:
    "Fixe (ou complète) les HYPOTHÈSES COMMUNES du bilan promoteur de la mission. Envoie TOUTES les clés que tu " +
    "connais ; une valeur inconnue s'envoie à null (jamais 0 inventé). Les pourcentages sont en pourcent (8 = 8 %). " +
    "Chaque chiffre issu d'un outil cite sa source (source_prix, source_couts). Appelle-le avant calculer_charge_fonciere.",
  input_schema: { type: 'object', properties: { hypotheses_communes: { type: 'object', properties: HYP_PROPS } }, required: ['hypotheses_communes'] },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_CALCULER_CF: OutilDef = {
  name: 'calculer_charge_fonciere',
  description:
    "Calcule la CHARGE FONCIÈRE ADMISSIBLE d'un terrain (bilan promoteur à rebours, déterministe) à partir des " +
    "hypothèses communes, en remplaçant celles qui diffèrent pour CE terrain (`hypotheses_specifiques`) : part de " +
    "logements sociaux imposée par une servitude de mixité, démolition si bâti, coût travaux majoré (fondations sur " +
    "argiles), programme réduit par une OAP ou un gabarit… Le résultat est enregistré dans le rapport : ne recalcule " +
    "rien de tête. Les postes inconnus sont listés dans `manques`.",
  input_schema: {
    type: 'object',
    properties: {
      idu: { type: 'string', description: 'Identifiant cadastral (14 caractères).' },
      surface_terrain_m2: { type: 'number' },
      hypotheses_specifiques: { type: 'object', properties: HYP_PROPS, description: 'Uniquement ce qui diffère des hypothèses communes, avec la raison dans `justification`.' },
      justification: { type: 'string', description: 'Pourquoi ces hypothèses propres (outil source).' },
    },
    required: ['idu', 'surface_terrain_m2'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_RAPPORT_TERRAIN: OutilDef = {
  name: 'rapport_terrain',
  description:
    "Dépose (ou met à jour) la FICHE d'un terrain dans le rapport, UN terrain par appel. Le bilan s'y rattache " +
    "automatiquement (calculer_charge_fonciere) : ne le recopie pas. Champs inconnus : null.",
  input_schema: {
    type: 'object',
    properties: {
      idu: { type: 'string' }, commune: { type: 'string' }, adresse: { type: ['string', 'null'] },
      surface_m2: { type: ['number', 'null'] }, zonage: { type: ['string', 'null'] }, libelle_zone: { type: ['string', 'null'] },
      score: { type: ['number', 'null'], description: 'score_tri de rechercher_parcelles' },
      verdict: { type: 'string', enum: ['prioritaire', 'a_etudier', 'ecarte', 'indetermine'] },
      potentiel_logements: { type: ['number', 'null'] },
      proprietaire: {
        type: ['object', 'null'],
        properties: { nom: { type: 'string' }, forme: { type: ['string', 'null'] }, siren: { type: ['string', 'null'] }, source: { type: 'string' } },
      },
      contraintes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mixite_sociale', 'ppr', 'argiles', 'bruit', 'dpu', 'oap', 'servitude', 'autre'] },
            libelle: { type: 'string' }, source: { type: 'string' },
          },
        },
      },
      points_forts: { type: 'array', items: { type: 'string' } },
      points_bloquants: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
    },
    required: ['idu', 'commune', 'verdict'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_RAPPORT_CONTACT: OutilDef = {
  name: 'rapport_contact',
  description: "Ajoute un CONTACT au rapport (mairie, propriétaire…), tel que donné par un outil. N'invente aucune coordonnée.",
  input_schema: {
    type: 'object',
    properties: {
      qualite: { type: 'string', enum: ['mairie', 'proprietaire', 'autre'] },
      nom: { type: 'string' }, telephone: { type: ['string', 'null'] }, email: { type: ['string', 'null'] },
      adresse: { type: ['string', 'null'] }, source: { type: 'string' },
    },
    required: ['qualite', 'nom', 'source'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_TERMINER_MISSION: OutilDef = {
  name: 'terminer_mission',
  description:
    "Termine la mission. Les terrains, bilans, hypothèses et contacts ont DÉJÀ été déposés par rapport_terrain, " +
    "calculer_charge_fonciere, rapport_hypotheses et rapport_contact : n'envoie ici QUE le titre, la synthèse " +
    "(5 à 12 phrases), le classement (idu + justification courte) et les limites. Appel COURT : un appel trop long " +
    "est coupé et n'aboutit pas.",
  input_schema: {
    type: 'object',
    properties: {
      titre: { type: 'string' },
      synthese: { type: 'string' },
      classement: {
        type: 'array',
        items: { type: 'object', properties: { idu: { type: 'string' }, justification: { type: 'string' } }, required: ['idu'] },
        description: 'Du meilleur au moins bon ; le rang est déduit de l’ordre.',
      },
      limites: { type: 'array', items: { type: 'string' } },
      elements: {
        type: 'array',
        description: 'Missions de veille uniquement : signaux qualifiés {source, genre, titre, detail, lien?, retenu}.',
        items: { type: 'object' },
      },
      rapport: { type: 'object', description: 'Ancien format (déconseillé) : objet rapport complet.' },
    },
  },
  available_in_modes: TOUS_MODES,
};

export const OUTILS_MISSION: OutilDef[] = [
  OUTIL_NOTER_CARNET, OUTIL_MEMORISER, OUTIL_REDIGER_ACTION, OUTIL_DEMANDER_UTILISATEUR,
  OUTIL_RAPPORT_HYPOTHESES, OUTIL_CALCULER_CF, OUTIL_RAPPORT_TERRAIN, OUTIL_RAPPORT_CONTACT,
  ...OUTILS_CONCEPTION,
  OUTIL_TERMINER_MISSION,
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
 *   chiffrer     : get_couts_construction, get_bilan_promoteur (le bilan à rebours se fait avec
 *                  l'outil de mission calculer_charge_fonciere ; calculer_bilan_financier est retiré :
 *                  10 postes obligatoires → 3 `partial` sur la 1re mission, et pas de charge foncière)
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
  'get_couts_construction', 'get_bilan_promoteur',
  'get_proprietaire_parcelle', 'get_contacts_mairies',
];
export const OUTILS_CHAT_MISSION_VEILLE: readonly string[] = [
  'rechercher_parcelles', 'get_parcelle_depuis_adresse', 'get_parcel_summary',
  'get_zonage_plu', 'get_prescriptions_urbanisme', 'get_servitudes', 'get_risks_georisques', 'get_ppr_detail',
  'get_etude_parcelle', 'get_dvf_comparables', 'get_etude_marche', 'get_sitadel', 'get_contexte_commune',
  'get_veille_marche',
];

/** Outils de mission retirés en veille (I4) : ni courrier, ni mémoire. */
export const OUTILS_MISSION_INTERDITS_VEILLE: ReadonlySet<string> = new Set([
  'rediger_action_externe', 'memoriser',
  // La veille qualifie des signaux (elements) : pas de bilan ni de fiches terrain.
  'rapport_hypotheses', 'calculer_charge_fonciere', 'rapport_terrain', 'rapport_contact',
]);

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
/** Outils du chat pour une mission de conception (parcelle, zonage, prescriptions, SRU). */
export const OUTILS_CHAT_MISSION_CONCEPTION: readonly string[] = [
  'get_parcel_summary', 'get_parcelle_depuis_adresse', 'get_zonage_plu', 'get_prescriptions_urbanisme',
  'get_servitudes', 'get_logement_social', 'get_risks_georisques',
];
/** Outils de mission propres aux rapports de prospection (fiches, bilan). */
const OUTILS_RAPPORT_PROSPECTION = new Set(['rapport_hypotheses', 'calculer_charge_fonciere', 'rapport_terrain', 'rapport_contact']);

/** Outils envoyés au modèle pour une mission de ce type. */
export function outilsPourMission(type: string, outilsChat: OutilDef[]): OutilDef[] {
  const veille = type === 'veille';
  const conception = type === 'conception';
  const blanche = new Set(veille ? OUTILS_CHAT_MISSION_VEILLE : conception ? OUTILS_CHAT_MISSION_CONCEPTION : OUTILS_CHAT_MISSION_PROSPECTION);
  const chat = outilsChat.filter((o) => blanche.has(o.name) && outilChatAutoriseEnMission(o.name) && !NOMS_OUTILS_MISSION.has(o.name));
  const propres = OUTILS_MISSION.filter((o) => {
    if (veille && OUTILS_MISSION_INTERDITS_VEILLE.has(o.name)) return false;
    if (NOMS_OUTILS_CONCEPTION.has(o.name)) return conception;          // outils de conception : seulement en conception
    if (conception && (OUTILS_RAPPORT_PROSPECTION.has(o.name) || o.name === 'rediger_action_externe')) return false;
    return true;
  });
  return [...chat, ...propres];
}
