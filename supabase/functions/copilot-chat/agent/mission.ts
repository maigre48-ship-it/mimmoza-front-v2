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
): Record<string, unknown> {
  return assemblerRapportV2(chargerBrouillon(etat.brouillon), brut, {
    actions_proposees: etat.actions_ids, memoire_ajoutee: etat.memoire_ajoutee,
    jetons_consommes: jetonsConsommes, limites_ajoutees: limitesAjoutees,
  });
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
  const amorce = amorceMission(c.m);
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

interface DemandeSpeciale { question?: string; rapport?: Record<string, unknown> }

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

  if (v.phase === 'rapport') {
    const raison = c.etat.raison_rapport ?? 'budget_atteint';
    const rapport = normaliserRapport(extraireJson(texteTour) ?? { titre: 'Rapport partiel', synthese: texte(texteTour, 6000) },
      c.etat, c.m.jetons_consommes, limitesRapport(raison));
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
    const rapport = normaliserRapport(speciale.rapport, c.etat, c.m.jetons_consommes);
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
    const ok = await c.depot.mettreEnAttente(c.m.id, speciale.question, c.etat);
    if (!ok) await c.depot.sauverEtat(c.m.id, c.etat);   // annulée entre-temps : l'état reste cohérent
    else await c.depot.journal(c.m.id, 'question', 'demander_utilisateur', null, speciale.question, 0);
    return 'pause';
  }
  await solderEnVol(c, v);
  return 'continuer';
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
      rapport: normaliserRapport(rapportDeSecours(c.m, c.etat, 'rédaction automatique indisponible'), c.etat, c.m.jetons_consommes, limitesRapport(raison)),
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
    rapport: normaliserRapport(rapportDeSecours(c.m, c.etat, raison), c.etat, c.m.jetons_consommes),
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
  if (etat.attente) {
    const rep = etat.derniere_reponse?.reponse?.trim();
    const txt = rep
      ? `Réponse de l'utilisateur à « ${etat.attente.question} » : ${rep}`
      : `L'utilisateur n'a pas répondu à « ${etat.attente.question} » : avance avec une hypothèse prudente, écrite au carnet.`;
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
