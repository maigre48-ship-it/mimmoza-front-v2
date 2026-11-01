// supabase/functions/copilot-chat/agent/mission.ts
// =============================================================
// MOTEUR DE MISSION — agent planificateur-exécutant (contrat §2, revue du 30/10).
//
// Appelé par le cron `agent-missions-tick` (chaque minute) via la route interne
// `{"interne":"mission_tick"}` de copilot-chat. Une invocation :
//   1. prend ≤ 3 missions (agent_mission_prendre, bail 150 s) ;
//   2. selon leur statut : règle (closes non réglées), réserve (en_attente),
//      clôt les attentes sans réponse depuis 72 h, fait avancer (en_cours) ;
//   3. s'arrête d'elle-même avant ~105 s d'horloge.
//
// Garanties :
//   · ÉTAPE EN VOL (B2) : le tour LLM est sauvé dans `etat` PAR l'appel de débit
//     (même transaction, idempotent par n). Une fonction tuée après le débit
//     reprend en rejouant seulement les outils : ni nouvel appel LLM, ni nouveau
//     débit. Les outils à effet de bord ne sont jamais rejoués (resultats).
//   · COÛT RÉEL (B4) : entrée estimée (caractères/3) avant chaque appel,
//     plafonnée à ENTREE_MAX_TOKENS (compaction forcée sinon, et jamais d'appel
//     au-delà) ; une étape ne démarre que si le reste couvre SON coût maximal réel
//     + le rapport final au plafond ;
//   · `etat` borné (B3) : 3 tours intacts, résultats d'outils ≤ 3 000 caractères,
//     compaction forcée au-delà de ~350 Ko ;
//   · rapport : 2 tentatives au plus, compteur sauvé AVANT l'appel, sortie
//     ≤ 4 000 tokens, démarré seulement en début de tick (I1) ; rapport normalisé
//     sauvé dans `etat` avant la clôture et réutilisé à la reprise (I8) ;
//   · règlement par agent_mission_regler (facture le consommé, rend le reste) ;
//   · rediger_action_externe ne crée QUE des brouillons : le moteur n'a aucun
//     chemin d'envoi (ni import, ni appel de send-mails / agent-action-envoyer).
// =============================================================

import type {
  DepotMission, EtapeEnVol, EtatMission, MessageLLM, MissionRow, MoteurDeps, OutilDef, ResultatOutil,
  StatutMission, Tier, TourHistorique, TypeMission,
} from './types.ts';
import { STATUTS_FINAUX, TYPES_MISSION } from './types.ts';
import {
  calculerDevis, devisExpire, devisViable, ENTREE_MAX_TOKENS, estimerTokens, pireCasEtapeMission,
  pireCasRapportMission, SORTIE_ETAPE_MAX_TOKENS, SORTIE_RAPPORT_MAX_TOKENS,
} from './devis.ts';
import { chargerBlocMemoire, estUuid, projetDuContexte, validerMemoire } from './memoire.ts';
import {
  amorceMission, CONSIGNE_CONTINUER, CONSIGNE_PLAN, consigneRapport, systemeMission,
} from './prompt-promoteur.ts';
import { NOMS_OUTILS_MISSION, OUTILS_MISSION_INTERDITS_VEILLE, outilChatAutoriseEnMission, outilsPourMission } from './outils.ts';
import {
  appliquerReponseFormulaire, centroideParcelle, cheminReglementAutorise, cheminTexteReglement, chercherContourParcelle,
  completerRegles, compterTokensAnthropic, construireQuestionRegles, CONSIGNE_LECTURE_REGLEMENT, controlerProgramme,
  fusionnerRegles, normaliserProgramme, normaliserRegle, REGLEMENT_LECTURE_DIRECTE_MAX_OCTETS, REGLEMENT_MAX_OCTETS,
  reglesDepuisLecture, reglesDepuisRulesets, reglesManquantes, signalementsFormules,
  suiteProposee, type ConflitRegle, type ParcelleConception, type Programme, type RegleConception,
} from './conception.ts';
import { lireTexteExtrait, planifierLecture } from '../../_shared/documents/piecesJointes.ts';
import { normaliserCodeZone, plagesLisibles } from '../../_shared/documents/lectureCiblee.ts';
import {
  assemblerRapportV2, calculerChargeFonciere, chargerBrouillon, fusionnerHypotheses, lireHypothesesPartielles,
  normaliserContact, normaliserIdu, normaliserTerrainBrut,
} from './rapport.ts';

// ── Réglages ────────────────────────────────────────────────────────────────

/** Durée de travail d'une invocation (le wall clock Edge est de 150 s). */
export const DUREE_TICK_MS = 105_000;
/** On ne démarre pas une étape s'il reste moins que ça avant la fin du tick. */
export const MARGE_ETAPE_MS = 55_000;
/** Le rapport ne démarre qu'en début de tick (I1). */
export const MARGE_RAPPORT_MS = 90_000;
export const BAIL_S = 150;
/** Historique gardé intact (B3) ; au-delà, résumé. */
export const TOURS_GARDES = 3;
export const RESUME_TOUR_MAX_CARS = 1600;   // ≈ 400 tokens
export const RESUMES_MAX = 30;
/** Résultat d'outil STOCKÉ (et donc relu par le modèle) : 3 000 caractères (B3). */
export const RESULTAT_OUTIL_MAX_CARS = 3000;
/** Taille sérialisée de `etat` au-delà de laquelle on compacte de force (B3). */
export const ETAT_MAX_CARS = 350_000;
export const CARNET_MAX = 60;
export const OUTILS_PAR_ETAPE_MAX = 6;
export const TIMEOUT_OUTIL_MS = 40_000;
export const ERREURS_MAX = 3;
export const TENTATIVES_RAPPORT_MAX = 2;
/** Attente d'une réponse utilisateur au-delà de laquelle la mission est close (I2). */
export const ATTENTE_MAX_MS = 72 * 3600 * 1000;

/** Outils de mission à effet de bord externe : leur résultat est sauvé aussitôt, jamais rejoué. */
const OUTILS_A_EFFET = new Set(['rediger_action_externe', 'memoriser']);

// ── Dossier de conception (etat.conception) ────────────────────────────────

export interface EtatConception {
  id: string | null;
  idu: string | null;
  commune: string | null;
  regles: RegleConception[];
  programme: Programme | null;
  parcelle: ParcelleConception | null;
  origine_chargee: boolean;
  donnees_prospection: string | null;
  /**
   * Lecture de règlement programmée pour la prochaine étape. V1.8 : `source`
   * 'gpu' = règlement publié au Géoportail de l'urbanisme (chemin 'gpu') ;
   * `essais` = extractions encore en cours (reprise au tick suivant) ;
   * `libelle` = provenance affichée des règles lues.
   */
  lecture: {
    chemin: string; zone: string | null; source?: 'depot' | 'gpu'; essais?: number; libelle?: string;
    /** V1.8 : choix de l'utilisateur (pièce du règlement GPU, pages). */
    fichier?: string | null; pages?: number[] | null;
  } | null;
  /** Valeurs proposées (PDF, outils) en désaccord avec une règle confirmée par l'utilisateur : signalées, jamais appliquées. */
  conflits: ConflitRegle[];
}

export function chargerConception(brut: unknown, m: MissionRow): EtatConception {
  const b = (brut && typeof brut === 'object' ? brut : {}) as Partial<EtatConception>;
  const crit = (m.criteres ?? {}) as Record<string, unknown>;
  return {
    id: typeof b.id === 'string' ? b.id : null,
    idu: typeof b.idu === 'string' ? b.idu : (typeof crit.idu === 'string' ? crit.idu.replace(/\s/g, '').toUpperCase() : null),
    commune: typeof b.commune === 'string' ? b.commune : (typeof crit.commune === 'string' ? crit.commune : null),
    regles: completerRegles(Array.isArray(b.regles) ? b.regles.map((r) => normaliserRegle(r, 'base')).filter((r): r is RegleConception => r != null) : []),
    programme: b.programme ? normaliserProgramme(b.programme) : null,
    parcelle: b.parcelle && typeof b.parcelle === 'object' ? b.parcelle : null,
    origine_chargee: b.origine_chargee === true,
    donnees_prospection: typeof b.donnees_prospection === 'string' ? b.donnees_prospection : null,
    lecture: b.lecture && typeof b.lecture === 'object' && typeof b.lecture.chemin === 'string' ? b.lecture : null,
    conflits: Array.isArray(b.conflits) ? b.conflits.slice(0, 20) : [],
  };
}

/** Ajoute des conflits (dédoublonnés par clé et valeur) et renvoie leur description pour le modèle. */
function noterConflits(k: EtatConception, conflits: ConflitRegle[]): string {
  for (const c of conflits) {
    if (!k.conflits.some((x) => x.cle === c.cle && x.valeur_proposee === c.valeur_proposee)) k.conflits.push(c);
  }
  return conflits.length
    ? ` CONFLIT : ${conflits.map((c) => `${c.cle} confirmé ${c.valeur_utilisateur} par l'utilisateur, ${c.source_proposee} indique ${c.valeur_proposee}${c.article ? ` (art. ${c.article})` : ''}`).join(' ; ')}. La valeur de l'utilisateur est conservée : signale-le-lui (nouvelle question si c'est décisif).`
    : '';
}

/** Écrit le dossier dans agent_conceptions (création au premier appel). */
async function persisterConception(c: CtxEtape, k: EtatConception, statut?: 'regles' | 'plan'): Promise<void> {
  const crit = (c.m.criteres ?? {}) as Record<string, unknown>;
  const champs: Record<string, unknown> = {
    idu: k.idu, commune: k.commune, regles_plu: completerRegles(k.regles),
    ...(k.programme ? { programme: k.programme } : {}),
    ...(k.parcelle ? { parcelle: k.parcelle } : {}),
    ...(estUuid(crit.mission_origine_id) ? { mission_origine_id: crit.mission_origine_id } : {}),
    ...(statut ? { statut } : {}),
  };
  if (!k.idu) return;   // idu obligatoire en base
  k.id = await c.depot.enregistrerConception(c.m.id, c.m.user_id, champs);
}

/** Consigne ajoutée quand la sortie d'un tour a été coupée (diagnostic mission 7a7c855a). */
export const CONSIGNE_SORTIE_COUPEE =
  "⚠️ Ta réponse précédente a été COUPÉE à la limite de sortie : l'appel d'outil en cours d'écriture n'est pas parti. " +
  'Fais des appels plus courts : rapport_terrain un terrain à la fois, puis terminer_mission avec seulement titre, ' +
  'synthèse (5 à 12 phrases), classement et limites.';

// ── État ────────────────────────────────────────────────────────────────────

export function etatInitial(): EtatMission {
  return {
    version: 1, phase: 'plan', plan: [], carnet: [], tours: [], resumes: [], n_etape: 0, en_vol: null,
    peut_continuer: true, attente: null, actions_ids: [], memoire_ajoutee: 0,
    erreurs_consecutives: 0, tentatives_rapport: 0, raison_rapport: null, cloture: null,
  };
}

export function chargerEtat(brut: unknown): EtatMission {
  const e = (brut && typeof brut === 'object' ? brut : {}) as Partial<EtatMission>;
  const base = etatInitial();
  return {
    ...base, ...e,
    version: 1,
    plan: Array.isArray(e.plan) ? e.plan.map(String) : [],
    carnet: Array.isArray(e.carnet) ? e.carnet.map(String) : [],
    tours: Array.isArray(e.tours) ? e.tours : [],
    resumes: Array.isArray(e.resumes) ? e.resumes.map(String) : [],
    actions_ids: Array.isArray(e.actions_ids) ? e.actions_ids.map(String) : [],
    n_etape: Number(e.n_etape) || 0,
    en_vol: e.en_vol && typeof e.en_vol === 'object' ? { ...e.en_vol, resultats: e.en_vol.resultats ?? {} } : null,
    peut_continuer: e.peut_continuer !== false,
    memoire_ajoutee: Number(e.memoire_ajoutee) || 0,
    erreurs_consecutives: Number(e.erreurs_consecutives) || 0,
    tentatives_rapport: Number(e.tentatives_rapport) || 0,
    phase: (['plan', 'travail', 'rapport', 'fini'] as const).includes(e.phase as EtatMission['phase'])
      ? e.phase as EtatMission['phase'] : 'plan',
  };
}

function texte(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Résumé compact d'un tour ancien (≤ RESUME_TOUR_MAX_CARS). */
export function resumerTour(t: TourHistorique): string {
  const noms = new Map<string, { name: string; input: unknown }>();
  const morceaux: string[] = [];
  for (const b of t.assistant as Array<Record<string, unknown>>) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) morceaux.push(texte(b.text.trim(), 300));
    if (b?.type === 'tool_use') noms.set(String(b.id), { name: String(b.name), input: b.input });
  }
  for (const b of t.user as Array<Record<string, unknown>>) {
    if (b?.type === 'tool_result') {
      const o = noms.get(String(b.tool_use_id));
      const contenu = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      morceaux.push(`${o?.name ?? 'outil'}(${texte(o?.input, 120)}) → ${texte(contenu, 360)}`);
    } else if (b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith('Réponse de l')) {
      morceaux.push(texte(b.text, 400));
    }
  }
  return texte(`Étape ${t.n} : ${morceaux.join(' | ')}`, RESUME_TOUR_MAX_CARS);
}

function tailleEtat(etat: EtatMission): number {
  try { return JSON.stringify(etat).length; } catch { return Number.POSITIVE_INFINITY; }
}

/**
 * Compaction : garde `garder` tours intacts, résume les autres, borne résumés et
 * carnet ; si `etat` sérialisé dépasse ETAT_MAX_CARS, compacte jusqu'à passer dessous.
 */
export function compacter(etat: EtatMission, garder = TOURS_GARDES, resumesMax = RESUMES_MAX): void {
  const fusionner = (liste: string[], max: number, sep: string, borne: number) => {
    while (liste.length > max) {
      const a = liste.shift()!;
      const b = liste.shift() ?? '';
      liste.unshift(texte(`${a}${sep}${b}`, borne));
    }
  };
  while (etat.tours.length > garder) etat.resumes.push(resumerTour(etat.tours.shift()!));
  fusionner(etat.resumes, resumesMax, ' || ', RESUME_TOUR_MAX_CARS);
  fusionner(etat.carnet, CARNET_MAX, ' / ', 600);
  // Filet de taille (B3) : tours d'abord, puis résumés et carnet.
  while (tailleEtat(etat) > ETAT_MAX_CARS && etat.tours.length) etat.resumes.push(resumerTour(etat.tours.shift()!));
  while (tailleEtat(etat) > ETAT_MAX_CARS && etat.resumes.length > 5) etat.resumes.splice(0, 2, texte(etat.resumes.slice(0, 2).join(' || '), 400));
  while (tailleEtat(etat) > ETAT_MAX_CARS && etat.carnet.length > 5) etat.carnet.splice(0, 2, texte(etat.carnet.slice(0, 2).join(' / '), 300));
}

/** Compaction forcée d'un cran (entrée trop grosse, état trop gros). Renvoie false si plus rien à réduire. */
export function compacterForce(etat: EtatMission): boolean {
  const avant = tailleEtat(etat);
  if (etat.tours.length) compacter(etat, Math.max(0, etat.tours.length - 1), RESUMES_MAX);
  else if (etat.resumes.length > 4) compacter(etat, 0, Math.max(4, Math.floor(etat.resumes.length / 2)));
  else if (etat.carnet.length > 10) etat.carnet.splice(0, etat.carnet.length - 10, texte(etat.carnet.slice(0, etat.carnet.length - 10).join(' / '), 800));
  return tailleEtat(etat) < avant;
}

/** Messages envoyés au modèle : amorce + tours intacts (+ consigne finale éventuelle). */
export function construireMessages(etat: EtatMission, consigneFinale: string | null, amorce = 'Début de la mission.'): MessageLLM[] {
  if (!etat.tours.length) {
    return [{ role: 'user', content: `${amorce}\n\n${consigneFinale ?? CONSIGNE_CONTINUER}` }];
  }
  const msgs: MessageLLM[] = [{ role: 'user', content: `${amorce}\n\nSuis ton plan.` }];
  etat.tours.forEach((t, i) => {
    msgs.push({ role: 'assistant', content: t.assistant });
    const user = [...t.user];
    if (i === etat.tours.length - 1 && consigneFinale) user.push({ type: 'text', text: consigneFinale });
    msgs.push({ role: 'user', content: user });
  });
  return msgs;
}

/** Entrée estimée d'un appel (caractères/3 sur système + définitions d'outils + messages). */
export function estimerEntree(system: string, tools: OutilDef[], messages: MessageLLM[]): number {
  const defs = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })));
  return estimerTokens(system.length + defs.length + JSON.stringify(messages).length);
}

export function extrairePlan(t: string): string[] {
  const lignes = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numerotees = lignes
    .map((l) => l.match(/^(?:\d+\s*[.)-]|[-*•])\s+(.+)$/)?.[1]?.trim())
    .filter((l): l is string => Boolean(l));
  const plan = (numerotees.length ? numerotees : lignes).slice(0, 8).map((l) => texte(l, 300));
  return plan.length ? plan : ['Cadrer la demande', 'Rechercher', 'Analyser', 'Rédiger le rapport'];
}

/** Extrait le premier objet JSON d'un texte (tolère des balises de code autour). */
export function extraireJson(t: string): Record<string, unknown> | null {
  const debut = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  try {
    const v = JSON.parse(t.slice(debut, fin + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Rapport final au format v2 (CONTRAT_RAPPORT_ET_BILAN.md §A) : assemble le
 * brouillon accumulé dans `etat.brouillon` (hypothèses, fiches, bilans calculés,
 * contacts) et le rapport final (terminer_mission v2 léger, ancien rapport v1
 * complet, ou rapport partiel JSON). Tout champ inattendu est écarté.
 */
export function normaliserRapport(
  brut: Record<string, unknown> | null,
  etat: EtatMission,
  jetonsConsommes: number,
  limitesAjoutees: string[] = [],
  m?: MissionRow,
): Record<string, unknown> {
  const r = assemblerRapportV2(chargerBrouillon(etat.brouillon), brut, {
    actions_proposees: etat.actions_ids, memoire_ajoutee: etat.memoire_ajoutee,
    jetons_consommes: jetonsConsommes, limites_ajoutees: limitesAjoutees,
  });
  if (m?.type === 'prospection_fonciere' || m?.type === 'faisabilite') {
    // Fin de prospection : proposer la suite « Concevoir le projet » (terrains non écartés, classés).
    const suite = suiteProposee(r.terrains as Array<Record<string, unknown>>, r.classement as Array<{ idu: string; rang: number; justification: string }>);
    if (suite) r.suite_proposee = suite;
  }
  if (m?.type === 'conception') {
    const k = chargerConception(etat.conception, m);
    r.conception = {
      conception_id: k.id, idu: k.idu, commune: k.commune,
      parcelle: k.parcelle ? { surface_m2: k.parcelle.surface_m2, source: k.parcelle.source } : null,
      regles: completerRegles(k.regles), regles_manquantes: reglesManquantes(k.regles),
      conflits: k.conflits, signalements: signalementsFormules(k.regles),
      programme: k.programme, alertes_programme: k.programme ? controlerProgramme(k.programme) : [],
      prochaine_etape: 'Choisissez la voie du plan : plan fourni (le plus précis), dessin de l’emprise, ou proposition Mimmoza.',
    };
    if (!k.parcelle) (r.limites as string[]).push('Contour cadastral non récupéré : le Studio devra le recharger.');
    for (const x of k.conflits) {
      (r.limites as string[]).push(`Règle ${x.cle} : vous avez confirmé ${x.valeur_utilisateur}, ${x.source_proposee} indique ${x.valeur_proposee}${x.article ? ` (art. ${x.article})` : ''}. Votre valeur est conservée ; à vérifier.`);
    }
    for (const x of signalementsFormules(k.regles)) (r.limites as string[]).push(x);
  }
  return r;
}

/** Rapport de secours, sans LLM, à partir du carnet. */
export function rapportDeSecours(m: MissionRow, etat: EtatMission, raison: string): Record<string, unknown> {
  return {
    titre: `Rapport partiel — ${texte(m.objectif, 120)}`,
    synthese: etat.carnet.length
      ? `Le rapport n'a pas pu être rédigé automatiquement (${raison}). Notes de travail de la mission :\n` +
        etat.carnet.map((c) => `- ${c}`).join('\n')
      : `Le rapport n'a pas pu être rédigé automatiquement (${raison}) et aucune note de travail n'a été prise.`,
    terrains: [],
    limites: [raison],
  };
}

// ── Facilitateurs ───────────────────────────────────────────────────────────

function avecDelai<T>(p: Promise<T>, ms: number, libelle: string): Promise<T> {
  let id: number | undefined;
  const garde = new Promise<T>((_, rej) => {
    id = setTimeout(() => rej(new Error(`${libelle} : délai de ${Math.round(ms / 1000)} s dépassé`)), ms) as unknown as number;
  });
  return Promise.race([p, garde]).finally(() => clearTimeout(id));
}

function contexteMission(m: MissionRow): Record<string, unknown> {
  // Contexte minimal : les outils retombent sur leurs entrées explicites.
  return {
    vertical: 'promoteur', route: '/mimmozia/missions',
    ...(m.projet_id ? { projet_id: m.projet_id } : {}),
    pageContext: { space: 'promoteur', mode: 'mission' },
  };
}

function resumeResultat(r: ResultatOutil): string {
  return texte(`${r.status}${r.message ? ` — ${r.message}` : ''}`, 300);
}

class ArretMission extends Error {}

// ── Exécution d'une étape ───────────────────────────────────────────────────

type IssueEtape = 'continuer' | 'pause' | 'fin' | 'differe';

interface CtxEtape {
  m: MissionRow;
  etat: EtatMission;
  tier: Tier;
  /** Pire cas du rapport final au plafond d'entrée (toujours gardé en réserve). */
  pireRapport: number;
  blocMemoire: string;
  deps: MoteurDeps;
  depot: DepotMission;
}

/** Prépare un appel sous le plafond d'entrée (compaction forcée sinon). */
function preparerAppel(c: CtxEtape, consigne: string | null, tools: OutilDef[]): { system: string; messages: MessageLLM[]; entree: number } {
  const amorce = amorceMission(c.m, c.m.type === 'conception' ? chargerConception(c.etat.conception, c.m).donnees_prospection : null);
  for (let i = 0; i < 50; i++) {
    const system = systemeMission(c.m, c.etat, c.blocMemoire);
    const messages = construireMessages(c.etat, consigne, amorce);
    const entree = estimerEntree(system, tools, messages);
    if (entree <= ENTREE_MAX_TOKENS) return { system, messages, entree };
    if (!compacterForce(c.etat)) break;
  }
  // Garde dure : jamais d'appel au-delà du plafond qui a servi au devis.
  throw new Error(`entrée de l'étape au-delà de ${ENTREE_MAX_TOKENS} tokens même après compaction`);
}

/**
 * Appel LLM puis débit idempotent qui sauve l'étape EN VOL dans la même
 * transaction. Après ce point, l'étape est payée et ne sera jamais rappelée.
 */
async function appelerEtDebiter(
  c: CtxEtape, phase: EtapeEnVol['phase'], p: { system: string; messages: MessageLLM[] }, tools: OutilDef[], maxTokens: number,
): Promise<EtapeEnVol> {
  const tour = await c.deps.streamLLMTurn({
    model: c.deps.modelePourTier(c.tier), system: p.system, messages: p.messages, tools, maxTokens,
  });
  // La RPC refuse un débit ≤ 0 (22023) : debitJetons renvoie déjà ≥ 1 ; on le garantit.
  const cout = Math.max(1, Math.ceil(c.deps.debitJetons(c.tier, tour.inputTokens, tour.outputTokens, 0)));
  const n = c.etat.n_etape + 1;
  c.etat.en_vol = {
    n, phase, cout, resultats: {},
    textBlocks: tour.textBlocks,
    contentBlocks: tour.contentBlocks,
    toolUses: tour.toolUses,
    stopReason: tour.stopReason,
  };
  compacter(c.etat);
  for (let essai = 0; essai < 3; essai++) {
    // p_pire_cas_suivant > 0 exigé : après le rapport il n'y a plus d'étape, on passe 1.
    const r = await c.depot.debiter(c.m.id, n, cout, phase === 'rapport' ? 1 : Math.max(1, c.pireRapport), c.etat);
    if (r.ok || r.deja_debite) {
      c.etat.peut_continuer = r.ok ? r.peut_continuer : c.etat.peut_continuer;
      if (typeof r.jetons_consommes === 'number') c.m.jetons_consommes = r.jetons_consommes;
      else if (r.ok) c.m.jetons_consommes = Math.max(0, c.m.jetons_reserves - r.reste);
      if (!r.deja_debite) c.m.etapes_faites += 1;
      return c.etat.en_vol!;
    }
    if (r.raison === 'etat_trop_gros' && compacterForce(c.etat)) continue;
    throw new Error(`débit refusé : ${r.raison ?? r.statut ?? 'inconnu'}`);
  }
  throw new Error('débit refusé : état trop gros');
}

/** Termine une étape en vol : n_etape avance, en_vol vidé, état sauvé. */
async function solderEnVol(c: CtxEtape, v: EtapeEnVol): Promise<void> {
  c.etat.n_etape = Math.max(c.etat.n_etape, v.n);
  c.etat.en_vol = null;
  compacter(c.etat);
  await c.depot.sauverEtat(c.m.id, c.etat);
}

async function etapePlan(c: CtxEtape): Promise<IssueEtape> {
  const p = preparerAppel(c, CONSIGNE_PLAN, []);
  const v = await appelerEtDebiter(c, 'plan', p, [], SORTIE_ETAPE_MAX_TOKENS);
  return await traiterEnVol(c, v);
}

interface DemandeSpeciale { question?: string; questionAffichee?: string; rapport?: Record<string, unknown> }

async function executerOutilMission(
  c: CtxEtape, tu: { id: string; name: string; input: Record<string, unknown> }, speciale: DemandeSpeciale,
): Promise<string> {
  const input = tu.input ?? {};
  if (c.m.type === 'veille' && OUTILS_MISSION_INTERDITS_VEILLE.has(tu.name)) {
    return 'Outil indisponible en mission de veille.';
  }
  switch (tu.name) {
    case 'noter_carnet': {
      const note = texte(String(input.note ?? '').trim(), 500);
      if (!note) return 'Note vide : rien ajouté.';
      c.etat.carnet.push(note);
      return 'Note ajoutée au carnet.';
    }
    case 'memoriser': {
      // Ce qui vient d'une mission n'est jamais épinglé ni « confirmé » et reste
      // attaché au projet de la mission (revue I4).
      const v = validerMemoire({ ...input, epingle: false, confiance: 'a_verifier', projet_id: undefined }, 'mission', c.m.projet_id);
      if (!v.ok) return `Mémoire refusée : ${v.message}`;
      v.element.epingle = false;
      v.element.confiance = 'a_verifier';
      v.element.projet_id = c.m.projet_id;
      await c.depot.memoriser(c.m.user_id, c.m.id, v.element);
      c.etat.memoire_ajoutee += 1;
      await c.depot.journal(c.m.id, 'memoire', 'memoriser', { genre: v.element.genre, cle: v.element.cle },
        `Mémorisé (${v.element.genre}, à vérifier) : ${texte(v.element.contenu, 300)}`, 0);
      return 'Élément enregistré dans la mémoire du projet (marqué « à vérifier »).';
    }
    case 'rediger_action_externe': {
      const canal = input.canal === 'email' ? 'email' : input.canal === 'courrier' ? 'courrier' : null;
      const d = (input.destinataire && typeof input.destinataire === 'object' ? input.destinataire : {}) as Record<string, unknown>;
      const qualite = ['proprietaire', 'mairie', 'notaire', 'agence', 'autre'].includes(String(d.qualite)) ? String(d.qualite) : 'autre';
      const nom = texte(String(d.nom ?? '').trim(), 200);
      const objet = texte(String(input.objet ?? '').trim(), 290);
      const corps = String(input.corps ?? '').trim().slice(0, 20000);
      if (!canal || !nom || !objet || !corps) return 'Brouillon refusé : canal, destinataire.nom, objet et corps sont requis.';
      const destinataire: { nom: string; qualite: string; email?: string; adresse?: string } = { nom, qualite };
      if (typeof d.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) destinataire.email = texte(d.email.trim(), 200);
      if (typeof d.adresse === 'string' && d.adresse.trim()) destinataire.adresse = texte(d.adresse.trim(), 400);
      const id = await c.depot.creerActionBrouillon({
        user_id: c.m.user_id, mission_id: c.m.id, projet_id: c.m.projet_id,
        canal, destinataire, objet, corps,
      });
      c.etat.actions_ids.push(id);
      await c.depot.journal(c.m.id, 'action', 'rediger_action_externe', { action_id: id, canal, destinataire: { nom, qualite } },
        `Brouillon de ${canal === 'email' ? 'e-mail' : 'courrier'} préparé pour ${nom} — à relire et valider par vous, rien n'est envoyé.`, 0);
      return `Brouillon ${id} créé. Il N'EST PAS envoyé : l'utilisateur le relira et décidera seul de l'envoi.`;
    }
    case 'demander_utilisateur': {
      const q = texte(String(input.question ?? '').trim(), 1000);
      if (!q) return 'Question vide : ignorée.';
      speciale.question = q;
      if (c.m.type === 'conception' && input.formulaire === 'regles_conception') {
        // Format imposé par le front : question_en_attente = JSON du formulaire, pré-rempli par le MOTEUR.
        const k = chargerConception(c.etat.conception, c.m);
        speciale.questionAffichee = construireQuestionRegles(k.regles, q, k.idu, k.id, c.m.user_id);
      }
      return "Question transmise à l'utilisateur. La mission est en pause jusqu'à sa réponse.";
    }
    case 'terminer_mission': {
      // v2 : titre/synthese/classement/limites au premier niveau ; v1 : objet `rapport` complet.
      const v1 = input.rapport && typeof input.rapport === 'object' ? input.rapport as Record<string, unknown> : null;
      const { rapport: _ancien, ...v2 } = input;
      speciale.rapport = { ...(v1 ?? {}), ...Object.fromEntries(Object.entries(v2).filter(([, x]) => x != null)) };
      if (!speciale.rapport.titre) speciale.rapport.titre = 'Rapport de mission';
      return 'Rapport reçu.';
    }
    case 'recuperer_parcelle':
    case 'lire_regles_plu_importees':
    case 'enregistrer_regles_conception':
    case 'enregistrer_programme':
    case 'lire_reglement_pdf':
      // agent_conceptions.mission_id doit être une mission de type 'conception' (contrainte en base).
      if (c.m.type !== 'conception') return 'Outil réservé aux missions de conception.';
      break;
  }
  switch (tu.name) {
    case 'recuperer_parcelle': {
      const k = chargerConception(c.etat.conception, c.m);
      const idu = String(input.idu ?? k.idu ?? '').replace(/\s/g, '').toUpperCase();
      if (k.idu && idu !== k.idu) return `Refusé : la mission porte sur ${k.idu}.`;
      const p = await chercherContourParcelle(idu, c.deps.fetch ?? fetch);
      if (!p) return 'Contour cadastral introuvable (API Carto IGN) : le Studio devra le recharger. Ne déduis aucune surface.';
      k.idu = idu; k.parcelle = p;
      await persisterConception(c, k, 'regles');
      c.etat.conception = k;
      return JSON.stringify({ idu, surface_m2: p.surface_m2, source: p.source, conception_id: k.id, type_geometrie: p.geometrie.type });
    }
    case 'lire_regles_plu_importees': {
      const insee = String(input.code_insee ?? '').trim();
      const zone = String(input.zone_code ?? '').trim();
      if (!/^(?:\d{5}|2[AB]\d{3})$/i.test(insee) || !zone) return 'Refusé : code INSEE et code de zone requis.';
      const rows = await c.depot.reglesPluImportees(insee, zone);
      const trouvees = reglesDepuisRulesets(rows, zone.toUpperCase());
      const k = chargerConception(c.etat.conception, c.m);
      const f = fusionnerRegles(k.regles, trouvees, 'import');
      k.regles = f.regles;
      const conflit = noterConflits(k, f.conflits);
      if (trouvees.length) await persisterConception(c, k);
      c.etat.conception = k;
      return trouvees.length
        ? JSON.stringify({ regles_trouvees: trouvees, manquantes: reglesManquantes(k.regles), signalements: signalementsFormules(trouvees) }) + conflit
        : `Aucun règlement importé dans Mimmoza pour ${insee} zone ${zone} (couverture actuelle très partielle). Règles manquantes : ${reglesManquantes(k.regles).join(', ')}.` +
          (c.deps.reglementGpu ? ` Avant de les demander à l'utilisateur, appelle lire_reglement_pdf avec source « gpu » et zone_code « ${zone} » : le règlement publié au Géoportail de l'urbanisme sera lu (pages de la zone seulement).` : '');
    }
    case 'enregistrer_regles_conception': {
      const k = chargerConception(c.etat.conception, c.m);
      const brutes = Array.isArray(input.regles) ? input.regles : [];
      // Depuis le modèle : JAMAIS 'confirme' (au plus 'estime'), jamais sans source,
      // jamais par-dessus une règle confirmée par l'utilisateur (revue B2).
      const nouvelles = brutes.map((r) => normaliserRegle(r, 'modele')).filter((r): r is RegleConception => r != null);
      const refusees = brutes.length - nouvelles.length;
      const f = fusionnerRegles(k.regles, nouvelles, 'modele');
      k.regles = f.regles;
      const conflit = noterConflits(k, f.conflits);
      await persisterConception(c, k);
      c.etat.conception = k;
      return `Règles enregistrées au statut « estime » : ${nouvelles.length}${refusees ? ` (${refusees} refusée(s) : clé inconnue ou sans source)` : ''}. ` +
        `Seuls l'utilisateur (formulaire) ou le règlement lu avec son article peuvent les confirmer. Manquantes : ${reglesManquantes(k.regles).join(', ') || 'aucune'}.${conflit}`;
    }
    case 'enregistrer_programme': {
      const k = chargerConception(c.etat.conception, c.m);
      k.programme = normaliserProgramme(input);
      await persisterConception(c, k);
      c.etat.conception = k;
      const alertes = controlerProgramme(k.programme);
      if (typeof input.justification === 'string' && input.justification.trim()) c.etat.carnet.push(texte(`Programme : ${input.justification.trim()}`, 500));
      return `Programme enregistré.${alertes.length ? ` Attention : ${alertes.join(' ')}` : ''}`;
    }
    case 'lire_reglement_pdf': {
      const k = chargerConception(c.etat.conception, c.m);
      const zone = typeof input.zone_code === 'string' ? normaliserCodeZone(input.zone_code) : null;
      const pages = Array.isArray(input.pages)
        ? (input.pages as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1).slice(0, 300)
        : null;
      const choix = { fichier: typeof input.fichier === 'string' && input.fichier.trim() ? input.fichier.trim() : null, pages: pages?.length ? pages : null };
      if (input.source === 'gpu') {
        if (!c.deps.reglementGpu) return 'Lecture du règlement au Géoportail de l’urbanisme non disponible.';
        if (!centroideParcelle(k.parcelle)) return 'Refusé : récupère d’abord le contour de la parcelle (recuperer_parcelle).';
        k.lecture = { chemin: 'gpu', zone, source: 'gpu', ...choix };
        c.etat.conception = k;
        return 'Lecture du règlement publié au Géoportail de l’urbanisme programmée à l’étape suivante.';
      }
      const chemin = String(input.chemin ?? '').trim();
      if (!cheminReglementAutorise(chemin, c.m.user_id, k.id)) return 'Refusé : le règlement doit être dans le dossier de cette conception.';
      k.lecture = { chemin, zone, source: 'depot', pages: choix.pages };
      c.etat.conception = k;
      return 'Lecture du règlement programmée à l’étape suivante.';
    }
    case 'rapport_hypotheses': {
      const b = chargerBrouillon(c.etat.brouillon);
      const ajout = lireHypothesesPartielles(input.hypotheses_communes);
      b.hypotheses_communes = fusionnerHypotheses(b.hypotheses_communes, ajout);
      c.etat.brouillon = b;
      const inconnues = Object.entries(b.hypotheses_communes).filter(([k, x]) => k !== 'programme' && x == null).map(([k]) => k);
      return `Hypothèses communes enregistrées.${inconnues.length ? ` Encore inconnues (null) : ${inconnues.join(', ')}.` : ''}`;
    }
    case 'calculer_charge_fonciere': {
      const idu = normaliserIdu(input.idu);
      if (!idu) return 'Calcul refusé : idu invalide.';
      const b = chargerBrouillon(c.etat.brouillon);
      const surface = typeof input.surface_terrain_m2 === 'number' && input.surface_terrain_m2 > 0 ? input.surface_terrain_m2 : null;
      const bilan = calculerChargeFonciere(b.hypotheses_communes, lireHypothesesPartielles(input.hypotheses_specifiques), surface);
      if (typeof input.justification === 'string' && input.justification.trim() && Object.keys(bilan.hypotheses_specifiques).length) {
        bilan.hypotheses_specifiques.justification = texte(input.justification.trim(), 400);
      }
      b.bilans[idu] = bilan;
      c.etat.brouillon = b;
      return JSON.stringify({
        idu, statut: bilan.statut, ca_ht: bilan.ca_ht, couts_hors_foncier_ht: bilan.couts_hors_foncier_ht,
        charge_fonciere_admissible_ht: bilan.charge_fonciere_admissible_ht,
        charge_fonciere_eur_m2_terrain: bilan.charge_fonciere_eur_m2_terrain,
        charge_fonciere_eur_m2_sdp: bilan.charge_fonciere_eur_m2_sdp,
        hypotheses_specifiques: bilan.hypotheses_specifiques, manques: bilan.manques,
        note: 'Enregistré dans le rapport (source calculer_charge_fonciere). Cite ces chiffres tels quels.',
      });
    }
    case 'rapport_terrain': {
      const t = normaliserTerrainBrut(input);
      if (!t) return 'Fiche refusée : idu invalide.';
      const b = chargerBrouillon(c.etat.brouillon);
      b.terrains[String(t.idu)] = t;
      c.etat.brouillon = b;
      return `Fiche du terrain ${t.idu} enregistrée${b.bilans[String(t.idu)] ? ' (bilan rattaché)' : ' (aucun bilan calculé pour ce terrain)'}.`;
    }
    case 'rapport_contact': {
      const n = normaliserContact(input);
      if (!n) return 'Contact refusé : nom requis.';
      const b = chargerBrouillon(c.etat.brouillon);
      b.contacts.push(n);
      c.etat.brouillon = b;
      return 'Contact ajouté au rapport.';
    }
  }
  return 'Outil de mission inconnu.';
}

async function executerOutilChat(c: CtxEtape, tu: { id: string; name: string; input: Record<string, unknown> }): Promise<string> {
  const debut = Date.now();
  let res: ResultatOutil;
  const autorises = new Set(outilsPourMission(c.m.type, c.deps.outilsChat()).map((o) => o.name));
  if (!autorises.has(tu.name) || !outilChatAutoriseEnMission(tu.name)) {
    res = { status: 'error', source: tu.name, message: 'Outil non disponible en mission.' };
  } else {
    try {
      res = await avecDelai(c.deps.executeTool(tu.name, tu.input ?? {}, contexteMission(c.m)), TIMEOUT_OUTIL_MS, tu.name);
    } catch (e) {
      res = { status: 'error', source: tu.name, message: e instanceof Error ? e.message : String(e) };
    }
  }
  await c.depot.journal(c.m.id, 'outil', tu.name, tu.input,
    `${tu.name} : ${resumeResultat(res)} (${Math.round((Date.now() - debut) / 100) / 10} s)`, 0);
  let s: string;
  try { s = JSON.stringify(res); } catch { s = String(res?.message ?? res?.status); }
  return s.length > RESULTAT_OUTIL_MAX_CARS
    ? `${s.slice(0, RESULTAT_OUTIL_MAX_CARS)}\n[…résultat tronqué : ne complète pas la suite de mémoire]`
    : s;
}

async function etapeTravail(c: CtxEtape, tools: OutilDef[]): Promise<IssueEtape> {
  const p = preparerAppel(c, null, tools);
  const v = await appelerEtDebiter(c, 'travail', p, tools, SORTIE_ETAPE_MAX_TOKENS);
  return await traiterEnVol(c, v);
}

/** Traite une étape payée (au premier passage comme à la reprise). */
async function traiterEnVol(c: CtxEtape, v: EtapeEnVol): Promise<IssueEtape> {
  c.etat.erreurs_consecutives = 0;
  const texteTour = v.textBlocks.join('\n').trim();

  if (v.phase === 'plan') {
    c.etat.plan = extrairePlan(texteTour);
    c.etat.phase = 'travail';
    await solderEnVol(c, v);
    await c.depot.journal(c.m.id, 'plan', null, { plan: c.etat.plan },
      `Plan : ${c.etat.plan.map((p, i) => `${i + 1}. ${p}`).join(' ')}`, v.cout);
    return 'continuer';
  }

  if (v.phase === 'lecture') {
    const k = chargerConception(c.etat.conception, c.m);
    const lecture = k.lecture;
    const chemin = lecture?.chemin ?? 'règlement';
    const lues = reglesDepuisLecture(extraireJson(texteTour), chemin, lecture?.libelle);
    const f = fusionnerRegles(k.regles, lues, 'reglement');
    k.regles = f.regles;
    const conflit = noterConflits(k, f.conflits);
    k.lecture = null;
    c.etat.conception = k;
    await persisterConception(c, k);
    const quoi = lecture?.libelle ?? chemin.split('/').pop();
    const resume = lues.length
      ? `Règlement lu (${quoi}) : ${lues.map((r) => `${r.cle} = ${r.valeur}${r.article ? ` (art. ${r.article})` : ''}`).join(' ; ')}.`
      : `Règlement lu (${quoi}) : aucune règle clé trouvée pour cette zone.`;
    const resumeConflits = conflit;
    c.etat.tours.push({ n: v.n, assistant: [{ type: 'text', text: lecture?.source === 'gpu' ? 'Lecture du règlement publié au Géoportail de l’urbanisme.' : 'Lecture du règlement PDF déposé.' }],
      user: [{ type: 'text', text: `${resume}${resumeConflits} Règles encore manquantes : ${reglesManquantes(k.regles).join(', ') || 'aucune'}. ${CONSIGNE_CONTINUER}` }] });
    await solderEnVol(c, v);
    await c.depot.journal(c.m.id, 'resultat', 'lire_reglement_pdf', { regles: lues.length }, resume, v.cout);
    return 'continuer';
  }

  if (v.phase === 'rapport') {
    const raison = c.etat.raison_rapport ?? 'budget_atteint';
    const rapport = normaliserRapport(extraireJson(texteTour) ?? { titre: 'Rapport partiel', synthese: texte(texteTour, 6000) },
      c.etat, c.m.jetons_consommes, limitesRapport(raison), c.m);
    c.etat.cloture = { statut: raison === 'erreurs' ? 'echec' : 'budget_atteint', rapport, erreur: raison === 'erreurs' ? 'erreurs techniques répétées' : null };
    c.etat.phase = 'fini';
    await solderEnVol(c, v);
    await appliquerCloture(c);
    return 'fin';
  }

  const premierPassage = Object.keys(v.resultats).length === 0;
  const usages = v.toolUses.slice(0, OUTILS_PAR_ETAPE_MAX);
  const ignores = v.toolUses.slice(OUTILS_PAR_ETAPE_MAX);
  if (premierPassage) {
    await c.depot.journal(c.m.id, 'pensee', null, null,
      texteTour ? texte(texteTour, 1000) : `Étape ${v.n} : ${usages.map((u) => u.name).join(', ') || 'réflexion'}`, v.cout);
  }

  if (!v.toolUses.length) {
    c.etat.tours.push({
      n: v.n,
      assistant: v.contentBlocks.length ? v.contentBlocks : [{ type: 'text', text: texteTour || '…' }],
      user: [{ type: 'text', text: v.stopReason === 'max_tokens' ? CONSIGNE_SORTIE_COUPEE : CONSIGNE_CONTINUER }],
    });
    if (v.stopReason === 'max_tokens') {
      await c.depot.journal(c.m.id, 'erreur', null, null, 'Réponse coupée à la limite de sortie : nouvelle tentative plus courte.', 0);
    }
    await solderEnVol(c, v);
    return 'continuer';
  }

  // 1. Outils du chat (lecture seule) en parallèle — rejouables sans risque.
  const speciale: DemandeSpeciale = {};
  const aFaire = usages.filter((u) => !NOMS_OUTILS_MISSION.has(u.name) && v.resultats[u.id] == null);
  await Promise.all(aFaire.map(async (u) => { v.resultats[u.id] = await executerOutilChat(c, u); }));
  // 2. Outils de mission, dans l'ordre. Ceux à effet de bord sont sauvés aussitôt :
  //    une reprise ne recrée jamais un brouillon ni une mémoire.
  for (const u of usages.filter((x) => NOMS_OUTILS_MISSION.has(x.name))) {
    if (v.resultats[u.id] != null && OUTILS_A_EFFET.has(u.name)) continue;
    try {
      v.resultats[u.id] = await executerOutilMission(c, u, speciale);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await c.depot.journal(c.m.id, 'erreur', u.name, null, `${u.name} : ${texte(msg, 600)}`, 0);
      v.resultats[u.id] = `Erreur : ${msg}`;
    }
    if (OUTILS_A_EFFET.has(u.name)) await c.depot.sauverEtat(c.m.id, c.etat);
  }
  for (const u of ignores) v.resultats[u.id] = `Non exécuté : au plus ${OUTILS_PAR_ETAPE_MAX} outils par étape.`;

  c.etat.tours.push({
    n: v.n,
    assistant: v.contentBlocks,
    user: v.toolUses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: v.resultats[u.id] ?? '' })),
  });

  if (speciale.rapport) {
    const rapport = normaliserRapport(speciale.rapport, c.etat, c.m.jetons_consommes, [], c.m);
    c.etat.cloture = { statut: 'terminee', rapport, erreur: null };
    c.etat.phase = 'fini';
    await solderEnVol(c, v);
    await appliquerCloture(c);
    return 'fin';
  }
  if (speciale.question) {
    c.etat.attente = { question: speciale.question };
    c.etat.n_etape = Math.max(c.etat.n_etape, v.n);
    c.etat.en_vol = null;
    compacter(c.etat);
    const ok = await c.depot.mettreEnAttente(c.m.id, speciale.questionAffichee ?? speciale.question, c.etat);
    if (!ok) await c.depot.sauverEtat(c.m.id, c.etat);   // annulée entre-temps : l'état reste cohérent
    else await c.depot.journal(c.m.id, 'question', 'demander_utilisateur', null, speciale.question, 0);
    return 'pause';
  }
  await solderEnVol(c, v);
  return 'continuer';
}

/**
 * Lecture IA du règlement PDF (étape dédiée). Garde : comptage EXACT des tokens
 * avant l'appel ; refus si inconnu ou au-delà du plafond qui a servi au devis,
 * ou si le reste ne couvre pas cette lecture + le rapport final.
 */
async function etapeLecture(c: CtxEtape): Promise<IssueEtape> {
  const k = chargerConception(c.etat.conception, c.m);
  const lec = k.lecture!;
  const refuser = async (raison: string) => {
    k.lecture = null;
    c.etat.conception = k;
    c.etat.carnet.push(texte(`Règlement non lu : ${raison}`, 400));
    await c.depot.journal(c.m.id, 'erreur', 'lire_reglement_pdf', null, `Règlement non lu : ${raison}`, 0);
    await c.depot.sauverEtat(c.m.id, c.etat);
    return 'continuer' as IssueEtape;
  };
  // Extraction serveur encore en cours : on rend la main, le tick suivant reprend là où elle s'est arrêtée.
  const patienter = async (quoi: string) => {
    if ((lec.essais ?? 0) >= ESSAIS_EXTRACTION_MAX) return await refuser(`${quoi} : extraction du texte trop longue`);
    k.lecture = { ...lec, essais: (lec.essais ?? 0) + 1 };
    c.etat.conception = k;
    await c.depot.journal(c.m.id, 'outil', 'lire_reglement_pdf', null, `${quoi} : extraction du texte en cours (essai ${k.lecture.essais}).`, 0);
    await c.depot.sauverEtat(c.m.id, c.etat);
    return 'continuer' as IssueEtape;
  };
  // V1.8 (décision d'Albé) : quand le moteur ne peut pas choisir seul quoi lire,
  // il DEMANDE à l'utilisateur (mécanisme de demander_utilisateur : mise en
  // attente). Rien n'est lu ni débité ; à la reprise, la réponse arrive au
  // modèle, qui rappelle lire_reglement_pdf avec le choix (fichier, zone, pages).
  const demander = async (question: string) => {
    const q = texte(question, 1000);
    k.lecture = null;
    c.etat.conception = k;
    c.etat.carnet.push(texte(`Question posée avant lecture du règlement : ${q} — à la réponse, rappelle lire_reglement_pdf ` +
      `(source « ${lec.source ?? 'depot'} »${lec.source === 'gpu' ? '' : `, chemin ${lec.chemin}`}) avec fichier, zone_code ou pages.`, 1400));
    c.etat.attente = { question: q };
    compacter(c.etat);
    const ok = await c.depot.mettreEnAttente(c.m.id, q, c.etat);
    if (!ok) { await c.depot.sauverEtat(c.m.id, c.etat); return 'continuer' as IssueEtape; }
    await c.depot.journal(c.m.id, 'question', 'lire_reglement_pdf', null, q, 0);
    return 'pause' as IssueEtape;
  };
  const docTexte = (texteDoc: string, titre: string, contexte: string) =>
    ({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: texteDoc }, title: titre, context: contexte });
  const zone = lec.zone ?? await zoneDeLaParcelle(c, k);
  let contenu: unknown[];
  let libelle: string;

  if (lec.source === 'gpu') {
    // ── Règlement publié au Géoportail de l'urbanisme (plu-reglement-v1) ──
    const pt = centroideParcelle(k.parcelle);
    if (!c.deps.reglementGpu || !pt) return await refuser('lecture au Géoportail de l’urbanisme indisponible (contour de parcelle ou service manquant)');
    const r = await c.deps.reglementGpu({ ...pt, zone, fichier: lec.fichier ?? null, pages: lec.pages ?? null });
    if (r.statut === 'en_cours') return await patienter('Règlement du Géoportail de l’urbanisme');
    if (['choix_requis', 'zone_non_reperee', 'selection_trop_longue'].includes(String(r.statut)) && typeof r.message === 'string') {
      return await demander(`Règlement du PLU (Géoportail de l’urbanisme) : ${r.message}`);
    }
    if (r.statut !== 'pret' || typeof r.texte !== 'string' || !r.texte.trim()) {
      return await refuser(texte(String(r.message ?? `règlement non lisible au Géoportail de l'urbanisme (${String(r.statut)})`), 300));
    }
    libelle = texte(`Règlement GPU — ${String(r.source ?? r.fichier ?? 'Géoportail de l’urbanisme')}`, 200);
    contenu = [docTexte(r.texte, String(r.fichier ?? 'Règlement'), `Zone ${String(r.zone_lue ?? zone ?? '?')} — chapitre p. ${String(r.pages_zone ?? '?')}, dispositions générales p. ${String(r.pages_dispositions_generales ?? '—')}.`),
      { type: 'text', text: CONSIGNE_LECTURE_REGLEMENT(String(r.zone_lue ?? zone ?? '') || null, 'gpu') }];
  } else {
    // ── Règlement déposé par l'utilisateur ──
    if (!cheminReglementAutorise(lec.chemin, c.m.user_id, k.id)) return await refuser('chemin hors du dossier de la conception');
    const nom = lec.chemin.split('/').pop()!;
    libelle = `Règlement PDF déposé (${nom})`;
    // 1. Texte extrait par le navigateur, déposé à côté du PDF.
    let pages = c.depot.telechargerJson
      ? lireTexteExtrait(await c.depot.telechargerJson('agent-conception', cheminTexteReglement(lec.chemin), 8 * 1024 * 1024).catch(() => null))
      : null;
    let base64: string | null = null;
    let taille = 0;
    if (!pages) {
      // 2. Petit PDF : envoyé tel quel (ancien comportement).
      const f = await c.depot.telechargerFichier('agent-conception', lec.chemin, REGLEMENT_LECTURE_DIRECTE_MAX_OCTETS);
      if (!f) return await refuser('fichier introuvable dans le dossier');
      taille = f.octets;
      if (!('trop_gros' in f)) base64 = f.base64;
      else if (f.octets > REGLEMENT_MAX_OCTETS) return await refuser(`fichier trop volumineux (${Math.round(f.octets / 1048576)} Mo > ${Math.round(REGLEMENT_MAX_OCTETS / 1048576)} Mo) : déposez seulement les pages de la zone`);
      else {
        // 3. Gros PDF sans texte du navigateur : extraction serveur (par lots, en cache).
        pages = c.deps.extraireTextePdf ? await c.deps.extraireTextePdf('agent-conception', lec.chemin).catch(() => null) : null;
        if (!pages) return c.deps.extraireTextePdf ? await patienter(nom) : await refuser('texte du règlement non extrait : déposez seulement les pages de la zone');
      }
    }
    if (base64) {
      contenu = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: CONSIGNE_LECTURE_REGLEMENT(zone) }];
    } else {
      const plan = planifierLecture({ mediaType: 'application/pdf', taille, nom, pages, zone, message: '', budgetTokens: ENTREE_MAX_TOKENS - 4000, pagesDemandees: lec.pages ?? null });
      if (plan.mode === 'pdf_entier') {
        // Petit PDF (≤ 20 pages) mais lourd (plans, images) : envoyé entier si ≤ 50 Mo.
        const f = await c.depot.telechargerFichier('agent-conception', lec.chemin, REGLEMENT_MAX_OCTETS);
        if (!f || 'trop_gros' in f) return await refuser('fichier introuvable ou trop volumineux');
        contenu = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } },
          { type: 'text', text: CONSIGNE_LECTURE_REGLEMENT(zone) }];
      } else if (plan.mode === 'sommaire' && plan.question) {
        return await demander(plan.question);
      } else if (plan.texte && ['texte_cible', 'texte_integral', 'pages_demandees'].includes(plan.mode)) {
        contenu = [docTexte(plan.texte, nom, plan.description), { type: 'text', text: CONSIGNE_LECTURE_REGLEMENT(plan.zone ?? zone) }];
        libelle = texte(`Règlement PDF déposé (${nom}, ${plan.mode === 'texte_cible' ? `zone ${plan.zone}, ` : ''}p. ${plagesLisibles(plan.pages)})`, 200);
      } else {
        return await refuser(texte(`${plan.description}${zone ? '' : ' — zone de la parcelle inconnue (appelle get_zonage_plu puis lire_reglement_pdf avec zone_code)'}`, 400));
      }
    }
  }

  k.lecture = { ...lec, zone, libelle };
  c.etat.conception = k;
  const system = 'Tu extrais des règles d\'urbanisme d\'un règlement de PLU. Tu réponds en JSON strict.';
  const messages: MessageLLM[] = [{ role: 'user', content: contenu }];
  const model = c.deps.modelePourTier(c.tier);
  const compter = c.deps.compterTokens ?? ((p) => compterTokensAnthropic(p));
  const entree = await compter({ model, system, messages });
  if (entree == null) return await refuser('taille du document impossible à mesurer');
  if (entree > ENTREE_MAX_TOKENS) return await refuser(`document trop long (${entree} tokens > ${ENTREE_MAX_TOKENS}) : déposez seulement les pages de la zone`);
  await c.depot.sauverEtat(c.m.id, c.etat);   // libellé et zone de la lecture conservés pour le traitement du résultat
  const pire = c.deps.debitJetons(c.tier, entree, SORTIE_ETAPE_MAX_TOKENS, 0);
  if (c.m.jetons_reserves - c.m.jetons_consommes < pire + c.pireRapport) return await refuser('réserve de jetons insuffisante pour cette lecture');
  const v = await appelerEtDebiter(c, 'lecture', { system, messages }, [], SORTIE_ETAPE_MAX_TOKENS);
  return await traiterEnVol(c, v);
}

/** Extractions serveur « en cours » tolérées avant d'abandonner la lecture (≈ un tick chacune). */
export const ESSAIS_EXTRACTION_MAX = 4;

/** Zone PLU au point de la parcelle (get_zonage_plu, GPU) ; null si inconnue. Jamais bloquant. */
async function zoneDeLaParcelle(c: CtxEtape, k: EtatConception): Promise<string | null> {
  const pt = centroideParcelle(k.parcelle);
  if (!pt) return null;
  try {
    const r = await avecDelai(c.deps.executeTool('get_zonage_plu', { lat: pt.lat, lng: pt.lon }, contexteMission(c.m)), TIMEOUT_OUTIL_MS, 'get_zonage_plu');
    const z = (r?.data as { zone_principale?: { zone?: unknown } } | undefined)?.zone_principale?.zone;
    return normaliserCodeZone(z);
  } catch { return null; }
}

function limitesRapport(raison: EtatMission['raison_rapport']): string[] {
  return raison === 'erreurs'
    ? ['Mission interrompue par des erreurs techniques répétées.']
    : ['Réserve de jetons de la mission épuisée : rapport partiel.'];
}

async function etapeRapport(c: CtxEtape): Promise<IssueEtape> {
  const raison = c.etat.raison_rapport ?? 'budget_atteint';
  if (c.etat.tentatives_rapport >= TENTATIVES_RAPPORT_MAX) {
    c.etat.cloture = {
      statut: raison === 'erreurs' ? 'echec' : 'budget_atteint',
      rapport: normaliserRapport(rapportDeSecours(c.m, c.etat, 'rédaction automatique indisponible'), c.etat, c.m.jetons_consommes, limitesRapport(raison), c.m),
      erreur: raison === 'erreurs' ? 'erreurs techniques répétées' : null,
    };
    c.etat.phase = 'fini';
    await c.depot.sauverEtat(c.m.id, c.etat);
    await appliquerCloture(c);
    return 'fin';
  }
  // Compteur sauvé AVANT l'appel (I1) : une fonction tuée pendant la rédaction compte.
  c.etat.tentatives_rapport += 1;
  await c.depot.sauverEtat(c.m.id, c.etat);
  const p = preparerAppel(c, consigneRapport(raison), []);
  const v = await appelerEtDebiter(c, 'rapport', p, [], SORTIE_RAPPORT_MAX_TOKENS);   // dernier tour SANS outils
  return await traiterEnVol(c, v);
}

/** Clôture à partir du rapport normalisé sauvé dans `etat` (I8), puis règlement. */
async function appliquerCloture(c: CtxEtape): Promise<void> {
  const cl = c.etat.cloture;
  if (!cl) return;
  if (c.m.type === 'conception' && cl.statut !== 'annulee') {
    // Dossier prêt pour le choix du plan (règles éventuellement incomplètes : signalées dans le rapport).
    // Revue I7 : sans dossier enregistré, la mission ne peut PAS finir « terminee ».
    const k = chargerConception(c.etat.conception, c.m);
    let echec: string | null = null;
    try { await persisterConception(c, k, 'plan'); } catch (e) { echec = e instanceof Error ? e.message : String(e); }
    if (!k.id) {
      const limite = `Le dossier de conception n'a pas pu être enregistré (${echec ?? 'identifiant de parcelle manquant'}) : rien n'est prêt pour le plan. Seuls les jetons réellement consommés sont facturés.`;
      cl.statut = 'echec';
      cl.erreur = texte(`dossier de conception non enregistré : ${echec ?? 'idu manquant'}`, 1000);
      cl.rapport = { ...cl.rapport, limites: [...((cl.rapport.limites as string[]) ?? []), limite] };
      await c.depot.sauverEtat(c.m.id, c.etat).catch(() => {});
    } else {
      (cl.rapport.conception as Record<string, unknown> | undefined) && ((cl.rapport.conception as Record<string, unknown>).conception_id = k.id);
    }
  }
  await c.depot.cloturer(c.m.id, cl.statut, cl.rapport, cl.erreur);
  const m = await c.depot.chargerMission(c.m.id);
  if (m) await reglerMission(m, c.deps, c.depot);
}

/** Clôture immédiate sans LLM (attente expirée, veille coupée, erreurs). */
async function cloturerSansLLM(
  c: CtxEtape, statut: StatutMission, raison: string, erreur: string | null,
): Promise<void> {
  c.etat.cloture = {
    statut,
    rapport: normaliserRapport(rapportDeSecours(c.m, c.etat, raison), c.etat, c.m.jetons_consommes, [], c.m),
    erreur,
  };
  c.etat.phase = 'fini';
  c.etat.en_vol = null;
  compacter(c.etat);
  await c.depot.sauverEtat(c.m.id, c.etat);
  await appliquerCloture(c);
}

// ── Règlement ───────────────────────────────────────────────────────────────

/**
 * Mission close : briefing de veille éventuel (idempotent), puis
 * agent_mission_regler (idempotent). Appelé à la clôture ET par le balayage des
 * missions closes non réglées (annulation, fonction coupée entre clôture et règlement).
 */
export async function reglerMission(m: MissionRow, deps: MoteurDeps, depot: DepotMission): Promise<Record<string, unknown>> {
  const etat = chargerEtat(m.etat);
  if (m.type === 'veille' && !etat.briefing_ecrit && deps.briefingPourMissionVeille) {
    try {
      const b = deps.briefingPourMissionVeille({ id: m.id, statut: m.statut, rapport: m.rapport, criteres: m.criteres });
      // Doublon impossible : contrainte unique agent_briefings(mission_id) ; 23505 = déjà écrit.
      if (b) await depot.creerBriefing(m.user_id, m.id, b);
      etat.briefing_ecrit = true;
      await depot.sauverEtat(m.id, etat);
    } catch (e) {
      console.warn('[agent] briefing', e instanceof Error ? e.message : String(e));
    }
  }
  const r = await depot.regler(m.id);
  if (r.ok && !r.deja_regle) {
    await depot.journal(m.id, 'fin', 'facturation', r,
      `Jetons facturés : ${r.jetons_factures ?? 0}. Jetons rendus sur votre solde : ${r.jetons_rembourses ?? 0}.`, 0);
  }
  return r as Record<string, unknown>;
}

// ── Boucle d'une mission ────────────────────────────────────────────────────

/** Extrait compact (≤ 8 000 car.) de la prospection d'origine pour le terrain de la conception. */
export function extraireDonneesProspection(rapport: Record<string, unknown>, idu: string | null): string | null {
  const terrains = Array.isArray(rapport.terrains) ? rapport.terrains as Array<Record<string, unknown>> : [];
  const t = terrains.find((x) => String(x.idu ?? '').toUpperCase() === (idu ?? '').toUpperCase()) ?? null;
  const donnees = {
    titre: rapport.titre ?? null,
    terrain: t,
    hypotheses_communes: rapport.hypotheses_communes ?? null,
  };
  if (!t && !rapport.hypotheses_communes) return null;
  return texte(JSON.stringify(donnees), 8000);
}

export async function travaillerMission(
  id: string, deps: MoteurDeps, depot: DepotMission, worker: string, finA: number,
): Promise<{ etapes: number; issue: string }> {
  const now = deps.now ?? Date.now;
  let m = await depot.chargerMission(id);
  if (!m || m.statut !== 'en_cours') {
    await depot.libererBail(id, worker);
    return { etapes: 0, issue: 'non_en_cours' };
  }
  const etat = chargerEtat(m.etat);
  const tier: Tier = (m.devis?.tier as Tier) ?? await deps.tierUtilisateur(m.user_id);
  const pireRapport = pireCasRapportMission(deps.debitJetons, tier);
  const blocMemoire = m.type === 'veille' ? '' : await chargerBlocMemoire(depot, m.user_id, m.projet_id);
  const tools = outilsPourMission(m.type, deps.outilsChat());

  // Reprise après une question : la RPC agent_mission_repondre a posé
  // etat.derniere_reponse. On l'ajoute au dernier tour (après les tool_result).
  if (m.type === 'conception') {
    // Données de la prospection d'origine (terrain + hypothèses du bilan), une seule fois,
    // et seulement si la mission d'origine appartient au même utilisateur.
    const k = chargerConception(etat.conception, m);
    if (!k.id) {
      // Revue I7 : vérifier DÈS LE DÉBUT que le dossier peut être écrit (table présente, idu valide).
      const c0: CtxEtape = { m, etat, tier, pireRapport, blocMemoire, deps, depot };
      try {
        await persisterConception(c0, k, 'regles');
      } catch (e) {
        etat.conception = k;
        await cloturerSansLLM(c0, 'echec', 'le dossier de conception ne peut pas être enregistré (table agent_conceptions indisponible ou écriture refusée)',
          texte(e instanceof Error ? e.message : String(e), 1000));
        return { etapes: 0, issue: 'echec' };
      }
      if (!k.id) {
        etat.conception = k;
        await cloturerSansLLM(c0, 'echec', 'aucun identifiant de parcelle (idu) pour cette conception', 'idu manquant');
        return { etapes: 0, issue: 'echec' };
      }
      etat.conception = k;
      await depot.sauverEtat(id, etat);
    }
    if (!k.origine_chargee) {
      const origineId = (m.criteres as Record<string, unknown>)?.mission_origine_id;
      if (estUuid(origineId)) {
        const o = await depot.chargerMission(origineId).catch(() => null);
        if (o && o.user_id === m.user_id && o.rapport) k.donnees_prospection = extraireDonneesProspection(o.rapport, k.idu);
      }
      k.origine_chargee = true;
      etat.conception = k;
      await depot.sauverEtat(id, etat);
    }
  }

  if (etat.attente) {
    const rep = etat.derniere_reponse?.reponse?.trim();
    let txt = rep
      ? `Réponse de l'utilisateur à « ${etat.attente.question} » : ${rep}`
      : `L'utilisateur n'a pas répondu à « ${etat.attente.question} » : avance avec une hypothèse prudente, écrite au carnet.`;
    if (rep && m.type === 'conception') {
      // Réponse structurée du formulaire de règles (format imposé par le front).
      const k = chargerConception(etat.conception, m);
      const a = appliquerReponseFormulaire(k.regles, rep);
      if (a.ok) {
        k.regles = a.regles;
        // L'utilisateur a tranché : les conflits sur les règles qu'il vient de confirmer sont levés.
        k.conflits = k.conflits.filter((x) => !a.regles.some((r) => r.cle === x.cle && r.statut === 'confirme' && /utilisateur/i.test(r.source)));
        const pdfOk = a.lire_reglement && a.reglement && cheminReglementAutorise(a.reglement, m.user_id, k.id);
        if (pdfOk) k.lecture = { chemin: a.reglement!, zone: null };
        etat.conception = k;
        if (k.idu) {
          try { await depot.enregistrerConception(m.id, m.user_id, { idu: k.idu, regles_plu: k.regles }); } catch (e) { console.warn('[agent] conception', e instanceof Error ? e.message : String(e)); }
        }
        txt = `Réponse de l'utilisateur au formulaire des règles : ${a.resume}.` +
          (a.commentaire ? ` Commentaire : ${a.commentaire}` : '') +
          (a.hors_bornes.length ? ` Valeurs non valables ignorées (à redemander) : ${a.hors_bornes.join(' ; ')}.` : '') +
          (pdfOk ? ' Le règlement PDF déposé sera lu automatiquement à l’étape suivante.' : (a.lire_reglement ? ' (Règlement demandé mais introuvable dans le dossier de la conception : non lu.)' : ''));
      }
    }
    const dernier = etat.tours.at(-1);
    if (dernier) dernier.user = [...dernier.user, { type: 'text', text: txt }];
    else etat.carnet.push(txt);
    etat.attente = null;
    etat.derniere_reponse = null;
    await depot.sauverEtat(id, etat);
  }

  let etapes = 0;
  while (true) {
    const restant = finA - now();
    const enRapport = etat.phase === 'rapport' && !etat.en_vol;
    if (restant < (enRapport ? MARGE_RAPPORT_MS : MARGE_ETAPE_MS)) break;
    if (etapes > 0) {
      m = await depot.chargerMission(id);         // annulation pendant le travail ?
      if (!m || m.statut !== 'en_cours') break;
      // Bail perdu : un autre worker a la main → on s'arrête SANS sauvegarder (I7).
      if (!(await depot.prolongerBail(id, worker, BAIL_S))) return { etapes, issue: 'bail_perdu' };
    }
    const c: CtxEtape = { m: m!, etat, tier, pireRapport, blocMemoire, deps, depot };

    // Veille proactive coupée par l'utilisateur entre-temps (I3).
    if (m!.origine === 'proactif') {
      const p = await depot.proactifEtat(m!.user_id).catch(() => null);
      if (p && (!p.actif || !p.learning_enabled)) {
        await cloturerSansLLM(c, 'annulee', 'veille proactive désactivée par l’utilisateur', 'veille proactive désactivée');
        return { etapes, issue: 'proactif_coupe' };
      }
    }

    if (etat.phase === 'fini') {
      // Fonction coupée entre la sauvegarde finale et la clôture : on rejoue
      // la clôture À L'IDENTIQUE avec le rapport sauvé (I8).
      if (etat.cloture) await appliquerCloture(c);
      else await cloturerSansLLM(c, 'echec', 'clôture interrompue', 'clôture interrompue');
      return { etapes, issue: 'fin' };
    }

    let issue: IssueEtape;
    try {
      if (etat.en_vol) {
        // Étape payée mais pas traitée : on la termine sans rappeler le LLM (B2).
        issue = await traiterEnVol(c, etat.en_vol);
      } else if (etat.phase === 'travail' && m!.type === 'conception' && chargerConception(etat.conception, m!).lecture) {
        issue = await etapeLecture(c);
      } else if (etat.phase === 'rapport') {
        issue = await etapeRapport(c);
      } else {
        // Garde budgétaire AVANT l'étape, sur l'entrée RÉELLE estimée (B4).
        const outilsEtape = etat.phase === 'plan' ? [] : tools;
        const p = preparerAppel(c, etat.phase === 'plan' ? CONSIGNE_PLAN : null, outilsEtape);
        const pireEtape = deps.debitJetons(tier, p.entree, SORTIE_ETAPE_MAX_TOKENS, 0);
        const reste = m!.jetons_reserves - m!.jetons_consommes;
        const etapesOk = m!.etapes_faites < m!.etapes_max - 1;
        if (!etat.peut_continuer || reste < pireEtape + pireRapport || !etapesOk) {
          etat.phase = 'rapport';
          etat.raison_rapport = etapesOk ? 'budget_atteint' : 'etapes_max';
          await depot.sauverEtat(id, etat);
          await depot.journal(id, 'pensee', null, { reste, pire_etape: pireEtape, pire_rapport: pireRapport },
            'Réserve de la mission bientôt épuisée : rédaction du rapport partiel.', 0);
          continue;
        }
        issue = etat.phase === 'plan' ? await etapePlan(c) : await etapeTravail(c, tools);
      }
    } catch (e) {
      if (e instanceof ArretMission) return { etapes, issue: 'arret' };
      const msg = e instanceof Error ? e.message : String(e);
      etat.erreurs_consecutives += 1;
      await depot.journal(id, 'erreur', null, null, `Étape interrompue : ${texte(msg, 800)}`, 0);
      if (etat.erreurs_consecutives >= ERREURS_MAX && etat.phase !== 'rapport' && (etat.phase as string) !== 'fini') {
        etat.phase = 'rapport';
        etat.raison_rapport = 'erreurs';
      }
      await depot.sauverEtat(id, etat).catch(() => {});
      if (etat.erreurs_consecutives >= ERREURS_MAX + TENTATIVES_RAPPORT_MAX + 1 && (etat.phase as string) !== 'fini') {
        await cloturerSansLLM(c, 'echec', 'erreurs répétées', texte(msg, 1000));
        return { etapes, issue: 'echec' };
      }
      issue = 'continuer';
    }
    etapes += 1;
    if (issue !== 'continuer') return { etapes, issue };
  }
  await depot.libererBail(id, worker);
  return { etapes, issue: 'tick_termine' };
}

// ── Tick ────────────────────────────────────────────────────────────────────

export interface BilanTick {
  prises: number;
  reservees: string[];
  refusees: Array<{ id: string; raison: string }>;
  reglees: string[];
  closes_sans_reponse: string[];
  travaillees: Array<{ id: string; etapes: number; issue: string }>;
  erreurs: Array<{ id: string; erreur: string }>;
  duree_ms: number;
}

export async function tickMissions(
  deps: MoteurDeps, depot: DepotMission, opts: { worker?: string; dureeMs?: number } = {},
): Promise<BilanTick> {
  const now = deps.now ?? Date.now;
  const debut = now();
  const finA = debut + (opts.dureeMs ?? DUREE_TICK_MS);
  const worker = opts.worker ?? `copilot-chat:${crypto.randomUUID().slice(0, 8)}`;
  const bilan: BilanTick = {
    prises: 0, reservees: [], refusees: [], reglees: [], closes_sans_reponse: [], travaillees: [], erreurs: [], duree_ms: 0,
  };

  const missions = await depot.prendreMissions(worker, BAIL_S);
  bilan.prises = missions.length;

  await Promise.all(missions.map(async (m) => {
    try {
      if (STATUTS_FINAUX.includes(m.statut)) {
        await reglerMission(m, deps, depot);
        bilan.reglees.push(m.id);
        return;
      }
      if (m.statut === 'attente_utilisateur') {
        // I2 : agent_mission_prendre ne renvoie une mission en attente que si
        // elle attend depuis plus de 72 h → clôture terminee + rapport partiel.
        // (On ne revérifie pas maj_le ici : prendre vient de le mettre à jour.)
        const etat = chargerEtat(m.etat);
        const c: CtxEtape = { m, etat, tier: 'haiku', pireRapport: 1, blocMemoire: '', deps, depot };
        await cloturerSansLLM(c, 'terminee',
          `mission arrêtée sans réponse de votre part à la question : « ${texte(m.question_en_attente ?? etat.attente?.question ?? '', 300)} »`, null);
        bilan.closes_sans_reponse.push(m.id);
        return;
      }
      if (m.statut === 'en_attente') {
        // M8 : un devis de plus de 24 h ne se réserve pas (garde moteur, en plus de valider_devis).
        if (m.origine === 'chat' && devisExpire(m.devis, now())) {
          await depot.cloturer(m.id, 'echec', null, 'devis expiré (plus de 24 h) : demandez un nouveau devis');
          bilan.refusees.push({ id: m.id, raison: 'devis_expire' });
          return;
        }
        const r = await depot.reserver(m.id);
        if (!r.ok) {
          bilan.refusees.push({ id: m.id, raison: r.raison ?? 'inconnue' });
          // solde insuffisant / devis invalide → la RPC a mis la mission en échec ;
          // proactif_desactive / budget_proactif_epuise → annulée : on la règle (no-op sans réservation).
          const close = await depot.chargerMission(m.id);
          if (close && STATUTS_FINAUX.includes(close.statut)) await reglerMission(close, deps, depot);
          return;
        }
        bilan.reservees.push(m.id);
        await depot.journal(m.id, 'plan', 'facturation', { jetons_reserves: r.jetons_reserves },
          `Mission lancée : ${r.jetons_reserves ?? 0} jetons réservés. Seul le consommé sera débité, le reste vous sera rendu.`, 0);
      }
      const t = await travaillerMission(m.id, deps, depot, worker, finA);
      bilan.travaillees.push({ id: m.id, ...t });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bilan.erreurs.push({ id: m.id, erreur: msg });
      console.error('[agent] mission', m.id, msg);
      await depot.libererBail(m.id, worker).catch(() => {});
    }
  }));
  bilan.duree_ms = now() - debut;
  return bilan;
}

// ── Outils du CHAT ──────────────────────────────────────────────────────────

function libelleStatut(s: string): string {
  return ({
    devis: 'devis à valider', en_attente: 'en file de lancement', en_cours: 'en cours',
    attente_utilisateur: 'en attente de votre réponse', terminee: 'terminée',
    budget_atteint: 'arrêtée (budget atteint, rapport partiel)', echec: 'en échec', annulee: 'annulée',
  } as Record<string, string>)[s] ?? s;
}

function vueMission(m: MissionRow): Record<string, unknown> {
  const rapport = (m.rapport ?? null) as Record<string, unknown> | null;
  return {
    mission_id: m.id, type: m.type, objectif: m.objectif, statut: m.statut, statut_libelle: libelleStatut(m.statut),
    etapes: `${m.etapes_faites}/${m.etapes_max}`,
    jetons_consommes: m.jetons_consommes, jetons_reserves: m.jetons_reserves,
    devis: m.devis ?? null,
    question_en_attente: m.question_en_attente ?? null,
    ...(rapport ? {
      rapport_titre: rapport.titre ?? null,
      rapport_synthese: texte(rapport.synthese ?? '', 1500),
      nb_terrains: Array.isArray(rapport.terrains) ? rapport.terrains.length : 0,
      nb_brouillons: Array.isArray(rapport.actions_proposees) ? rapport.actions_proposees.length : 0,
    } : {}),
    erreur: m.erreur ?? null,
  };
}

const SOURCE = 'MimmozIA · Missions';

/**
 * Exécute un outil d'agent appelé depuis le CHAT. Renvoie null si le nom n'est
 * pas un outil d'agent (l'index retombe alors sur « outil inconnu »).
 * `userId` vient TOUJOURS du JWT vérifié par l'index.
 */
export async function executerOutilAgentChat(
  name: string,
  input: Record<string, unknown>,
  ctx: Record<string, unknown>,
  userId: string | null,
  deps: Pick<MoteurDeps, 'debitJetons' | 'tierUtilisateur'>,
  depot: DepotMission,
): Promise<ResultatOutil | null> {
  if (!['proposer_mission', 'etat_mission', 'lister_missions', 'memoriser'].includes(name)) return null;
  if (!userId) return { status: 'error', source: SOURCE, message: 'Session requise.' };
  try {
    switch (name) {
      case 'proposer_mission': {
        const type = String(input.type ?? '') as TypeMission;
        if (!TYPES_MISSION.includes(type)) {
          return { status: 'error', source: SOURCE, message: `type invalide : ${TYPES_MISSION.join(', ')}` };
        }
        const objectif = String(input.objectif ?? '').trim().slice(0, 2000);
        if (!objectif) return { status: 'error', source: SOURCE, message: 'objectif requis' };
        let criteres = (input.criteres && typeof input.criteres === 'object' && !Array.isArray(input.criteres)
          ? input.criteres : {}) as Record<string, unknown>;
        if (JSON.stringify(criteres).length > 8000) criteres = { note: texte(criteres, 8000) };
        if (type === 'conception') {
          // Conception : un terrain précis (idu) et, si connue, la prospection d'origine (même utilisateur).
          const idu = typeof criteres.idu === 'string' ? criteres.idu.replace(/\s/g, '').toUpperCase() : '';
          if (!/^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/.test(idu)) {
            return { status: 'error', source: SOURCE, message: 'Conception : criteres.idu (identifiant cadastral à 14 caractères) est requis.' };
          }
          criteres = { ...criteres, idu };
          if (criteres.mission_origine_id != null) {
            const o = estUuid(criteres.mission_origine_id) ? await depot.chargerMissionUtilisateur(userId, criteres.mission_origine_id) : null;
            if (!o) criteres = { ...criteres, mission_origine_id: null };
          }
        }
        const tier = await deps.tierUtilisateur(userId);
        // Pire cas PROPRE aux missions (entrée plafonnée, sortie d'étape, sans web).
        const pire = pireCasEtapeMission(deps.debitJetons, tier);
        const devis = calculerDevis({ type, tier, pireCasEtape: pire });
        if (!devisViable(devis, pire)) {
          return { status: 'error', source: SOURCE, message: 'Devis impossible à établir.' };
        }
        let projet: string | null = estUuid(input.projet_id) ? input.projet_id : projetDuContexte(ctx);
        if (projet && !(await depot.projetAccessible(userId, projet))) projet = null;
        const conversation = estUuid(ctx.conversation_id) ? ctx.conversation_id : null;
        const missionId = await depot.creerMission({
          user_id: userId, projet_id: projet, conversation_id: conversation,
          origine: 'chat', type, objectif, criteres, statut: 'devis', devis, etapes_max: devis.etapes_max,
        });
        return {
          status: 'ok', source: SOURCE,
          data: { mission_id: missionId, type, objectif, criteres, devis, statut: 'devis', projet_id: projet },
          message:
            "Devis affiché à l'utilisateur sous forme de carte. RIEN n'est lancé ni débité tant qu'il n'a pas cliqué " +
            "« Lancer la mission ». Présente le devis en deux phrases (fourchette de jetons, ce que fera la mission) " +
            'sans dire que la mission a démarré.',
        };
      }
      case 'etat_mission': {
        let m: MissionRow | null = null;
        if (estUuid(input.mission_id)) m = await depot.chargerMissionUtilisateur(userId, input.mission_id);
        else m = (await depot.listerMissions(userId, 1))[0] ?? null;
        if (!m) return { status: 'not_found', source: SOURCE, message: 'Aucune mission trouvée.' };
        return { status: 'ok', source: SOURCE, data: vueMission(m) };
      }
      case 'lister_missions': {
        const ms = await depot.listerMissions(userId, 10);
        return {
          status: ms.length ? 'ok' : 'not_found', source: SOURCE,
          data: { missions: ms.map(vueMission) },
          message: ms.length ? undefined : "Aucune mission pour l'instant.",
        };
      }
      case 'memoriser': {
        const v = validerMemoire(input, 'chat', projetDuContexte(ctx));
        if (!v.ok) return { status: 'error', source: SOURCE, message: v.message };
        if (v.element.projet_id && !(await depot.projetAccessible(userId, v.element.projet_id))) v.element.projet_id = null;
        await depot.memoriser(userId, null, v.element);
        return {
          status: 'ok', source: 'Mémoire du projet',
          data: { genre: v.element.genre, cle: v.element.cle, projet_id: v.element.projet_id },
          message: "Enregistré. L'utilisateur peut consulter, modifier ou supprimer sa mémoire à tout moment.",
        };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const plafond = /3 missions|agent_missions_plafond/.test(msg);
    return {
      status: 'error', source: SOURCE,
      message: plafond ? 'Vous avez déjà 3 missions en cours : attendez qu’une se termine ou annulez-en une.'
        : `Service des missions indisponible : ${texte(msg, 300)}`,
    };
  }
  return null;
}

/** Données de l'événement SSE `mission_devis`, à partir du résultat de proposer_mission. */
export function evenementDevis(res: ResultatOutil): Record<string, unknown> | null {
  if (res.status !== 'ok' || !res.data || !res.data.mission_id) return null;
  const d = res.data;
  return {
    id: d.mission_id, mission_id: d.mission_id, type: d.type, objectif: d.objectif,
    criteres: d.criteres ?? {}, devis: d.devis, statut: 'devis',
  };
}
