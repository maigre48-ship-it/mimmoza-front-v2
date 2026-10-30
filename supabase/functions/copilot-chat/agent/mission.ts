// supabase/functions/copilot-chat/agent/mission.ts
// =============================================================
// MOTEUR DE MISSION — agent planificateur-exécutant (contrat §2).
//
// Appelé par le cron `agent-missions-tick` (chaque minute) via la route interne
// `{"interne":"mission_tick"}` de copilot-chat. Une invocation :
//   1. prend ≤ 3 missions (agent_mission_prendre, bail 120 s) ;
//   2. selon leur statut : règle (closes non réglées), réserve (en_attente),
//      fait avancer (en_cours) ;
//   3. s'arrête d'elle-même avant ~110 s d'horloge.
//
// Garanties :
//   · état sauvegardé APRÈS CHAQUE étape → une fonction tuée reprend au tick suivant ;
//   · débit après chaque tour LLM (agent_mission_debiter, plafonné à la réserve) ;
//   · une étape ne démarre que si le reste couvre son pire cas + celui du rapport ;
//   · budget épuisé → dernier tour SANS outils → rapport partiel, statut budget_atteint ;
//   · règlement par agent_mission_regler (facture le consommé, rembourse le reste) ;
//   · rediger_action_externe ne crée QUE des brouillons : le moteur n'a aucun
//     chemin d'envoi (ni import, ni appel de send-mails / agent-action-envoyer).
// =============================================================

import type {
  DepotMission, EtatMission, MessageLLM, MissionRow, MoteurDeps, OutilDef, ResultatOutil,
  StatutMission, Tier, TourHistorique, TourLLM, TypeMission,
} from './types.ts';
import { STATUTS_FINAUX, TYPES_MISSION } from './types.ts';
import { calculerDevis, devisViable, pireCasAvantEtape } from './devis.ts';
import { chargerBlocMemoire, estUuid, projetDuContexte, validerMemoire } from './memoire.ts';
import {
  CONSIGNE_CONTINUER, CONSIGNE_PLAN, consigneRapport, systemeMission,
} from './prompt-promoteur.ts';
import { NOMS_OUTILS_MISSION, OUTILS_MISSION, outilChatAutoriseEnMission } from './outils.ts';

// ── Réglages ────────────────────────────────────────────────────────────────

/** Durée de travail d'une invocation (le wall clock Edge est de 150 s). */
export const DUREE_TICK_MS = 105_000;
/** On ne démarre pas une étape s'il reste moins que ça avant la fin du tick. */
export const MARGE_ETAPE_MS = 55_000;
/** Idem pour le tour de rapport (plus long à écrire). */
export const MARGE_RAPPORT_MS = 65_000;
export const BAIL_S = 150;
/** Sortie max d'un tour de travail (le pire cas de facturation suppose 8 000). */
export const ETAPE_MAX_TOKENS = 4096;
export const RAPPORT_MAX_TOKENS = 8000;
/** Historique gardé intact ; au-delà, résumé. */
export const TOURS_GARDES = 6;
export const RESUME_TOUR_MAX_CARS = 1600;   // ≈ 400 tokens
export const RESUMES_MAX = 40;
export const RESULTAT_OUTIL_MAX_CARS = 8000;
export const CARNET_MAX = 60;
export const OUTILS_PAR_ETAPE_MAX = 6;
export const TIMEOUT_OUTIL_MS = 40_000;
export const ERREURS_MAX = 3;

// ── État ────────────────────────────────────────────────────────────────────

export function etatInitial(): EtatMission {
  return {
    version: 1, phase: 'plan', plan: [], carnet: [], tours: [], resumes: [],
    peut_continuer: true, attente: null, actions_ids: [], memoire_ajoutee: 0,
    erreurs_consecutives: 0, raison_rapport: null,
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
    peut_continuer: e.peut_continuer !== false,
    memoire_ajoutee: Number(e.memoire_ajoutee) || 0,
    erreurs_consecutives: Number(e.erreurs_consecutives) || 0,
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

/** Garde les TOURS_GARDES derniers tours, résume les autres. */
export function compacter(etat: EtatMission): void {
  while (etat.tours.length > TOURS_GARDES) {
    const t = etat.tours.shift()!;
    etat.resumes.push(resumerTour(t));
  }
  while (etat.resumes.length > RESUMES_MAX) {
    const a = etat.resumes.shift()!;
    const b = etat.resumes.shift()!;
    etat.resumes.unshift(texte(`${a} || ${b}`, RESUME_TOUR_MAX_CARS));
  }
  while (etat.carnet.length > CARNET_MAX) {
    const a = etat.carnet.shift()!;
    const b = etat.carnet.shift()!;
    etat.carnet.unshift(texte(`${a} / ${b}`, 600));
  }
}

/** Messages envoyés au modèle : amorce + tours intacts (+ consigne finale éventuelle). */
export function construireMessages(etat: EtatMission, consigneFinale: string | null): MessageLLM[] {
  if (!etat.tours.length) {
    return [{ role: 'user', content: consigneFinale ?? CONSIGNE_CONTINUER }];
  }
  const msgs: MessageLLM[] = [{ role: 'user', content: 'Début de la mission. Suis ton plan.' }];
  etat.tours.forEach((t, i) => {
    msgs.push({ role: 'assistant', content: t.assistant });
    const user = [...t.user];
    if (i === etat.tours.length - 1 && consigneFinale) user.push({ type: 'text', text: consigneFinale });
    msgs.push({ role: 'user', content: user });
  });
  return msgs;
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

const VERDICTS = new Set(['prioritaire', 'a_etudier', 'ecarte', 'indetermine']);
const nombreOuNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const listeTextes = (v: unknown, max = 20) =>
  Array.isArray(v) ? v.filter((x) => x != null).map((x) => texte(x, 400)).slice(0, max) : [];

/** Rapport au format du contrat §2.5 — tout champ inattendu est écarté. */
export function normaliserRapport(
  brut: Record<string, unknown> | null,
  etat: EtatMission,
  jetonsConsommes: number,
  limitesAjoutees: string[] = [],
): Record<string, unknown> {
  const b = brut ?? {};
  const terrains = (Array.isArray(b.terrains) ? b.terrains : []).slice(0, 30).map((x) => {
    const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const verdict = String(t.verdict ?? 'indetermine');
    return {
      idu: texte(t.idu ?? '', 20),
      commune: texte(t.commune ?? '', 120),
      ...(t.adresse ? { adresse: texte(t.adresse, 200) } : {}),
      surface_m2: nombreOuNull(t.surface_m2),
      zonage: t.zonage == null ? null : texte(t.zonage, 40),
      verdict: VERDICTS.has(verdict) ? verdict : 'indetermine',
      potentiel_logements: nombreOuNull(t.potentiel_logements),
      charge_fonciere_admissible: nombreOuNull(t.charge_fonciere_admissible),
      points_forts: listeTextes(t.points_forts),
      points_bloquants: listeTextes(t.points_bloquants),
      sources: listeTextes(t.sources),
    };
  });
  return {
    titre: texte(b.titre ?? 'Rapport de mission', 200),
    synthese: texte(b.synthese ?? '', 6000),
    terrains,
    actions_proposees: [...etat.actions_ids],
    memoire_ajoutee: etat.memoire_ajoutee,
    limites: [...listeTextes(b.limites, 30), ...limitesAjoutees],
    jetons_consommes: jetonsConsommes,
    // Missions de veille : éléments qualifiés, lus par briefing.ts (bornés, non réinterprétés ici).
    ...(Array.isArray(b.elements) ? { elements: b.elements.slice(0, 40) } : {}),
  };
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

function outilsDeMission(deps: MoteurDeps): OutilDef[] {
  const chat = deps.outilsChat().filter((o) => outilChatAutoriseEnMission(o.name) && !NOMS_OUTILS_MISSION.has(o.name));
  return [...chat, ...OUTILS_MISSION];
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

// ── Exécution d'une étape ───────────────────────────────────────────────────

type IssueEtape = 'continuer' | 'pause' | 'fin';

interface CtxEtape {
  m: MissionRow;
  etat: EtatMission;
  tier: Tier;
  pire: number;
  blocMemoire: string;
  deps: MoteurDeps;
  depot: DepotMission;
}

async function debiterTour(c: CtxEtape, tour: TourLLM, pireSuivant: number): Promise<number> {
  const cout = c.deps.debitJetons(c.tier, tour.inputTokens, tour.outputTokens, tour.webSearches ?? 0);
  if (cout <= 0) return 0;
  const r = await c.depot.debiter(c.m.id, cout, pireSuivant);
  c.etat.peut_continuer = r.ok && r.peut_continuer;
  if (typeof r.jetons_consommes === 'number') c.m.jetons_consommes = r.jetons_consommes;
  else c.m.jetons_consommes = Math.max(0, c.m.jetons_reserves - r.reste);
  c.m.etapes_faites += 1;
  return cout;
}

async function etapePlan(c: CtxEtape): Promise<IssueEtape> {
  const tour = await c.deps.streamLLMTurn({
    model: c.deps.modelePourTier(c.tier),
    system: systemeMission(c.m, c.etat, c.blocMemoire),
    messages: [{ role: 'user', content: CONSIGNE_PLAN }],
    tools: [],
    maxTokens: ETAPE_MAX_TOKENS,
  });
  const cout = await debiterTour(c, tour, pireCasAvantEtape(c.pire));
  c.etat.plan = extrairePlan(tour.textBlocks.join('\n'));
  c.etat.phase = 'travail';
  c.etat.erreurs_consecutives = 0;
  await c.depot.sauverEtat(c.m.id, c.etat);
  await c.depot.journal(c.m.id, 'plan', null, { plan: c.etat.plan },
    `Plan : ${c.etat.plan.map((p, i) => `${i + 1}. ${p}`).join(' ')}`, cout);
  return 'continuer';
}

interface DemandeSpeciale { question?: string; rapport?: Record<string, unknown> }

async function executerOutilMission(
  c: CtxEtape, tu: { id: string; name: string; input: Record<string, unknown> }, speciale: DemandeSpeciale,
): Promise<string> {
  const input = tu.input ?? {};
  switch (tu.name) {
    case 'noter_carnet': {
      const note = texte(String(input.note ?? '').trim(), 500);
      if (!note) return 'Note vide : rien ajouté.';
      c.etat.carnet.push(note);
      return 'Note ajoutée au carnet.';
    }
    case 'memoriser': {
      const v = validerMemoire(input, 'mission', c.m.projet_id);
      if (!v.ok) return `Mémoire refusée : ${v.message}`;
      await c.depot.memoriser(c.m.user_id, c.m.id, v.element);
      c.etat.memoire_ajoutee += 1;
      await c.depot.journal(c.m.id, 'memoire', 'memoriser', { genre: v.element.genre, cle: v.element.cle },
        `Mémorisé (${v.element.genre}) : ${texte(v.element.contenu, 300)}`, 0);
      return 'Élément enregistré dans la mémoire du projet.';
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
      if (typeof d.email === 'string' && d.email.includes('@')) destinataire.email = texte(d.email.trim(), 200);
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
      const r = input.rapport && typeof input.rapport === 'object' ? input.rapport as Record<string, unknown> : null;
      speciale.rapport = r ?? { titre: 'Rapport de mission', synthese: '' };
      return 'Rapport reçu.';
    }
  }
  return 'Outil de mission inconnu.';
}

async function executerOutilChat(c: CtxEtape, tu: { id: string; name: string; input: Record<string, unknown> }): Promise<string> {
  const debut = Date.now();
  let res: ResultatOutil;
  try {
    res = await avecDelai(c.deps.executeTool(tu.name, tu.input ?? {}, contexteMission(c.m)), TIMEOUT_OUTIL_MS, tu.name);
  } catch (e) {
    res = { status: 'error', source: tu.name, message: e instanceof Error ? e.message : String(e) };
  }
  await c.depot.journal(c.m.id, 'outil', tu.name, tu.input,
    `${tu.name} : ${resumeResultat(res)} (${Math.round((Date.now() - debut) / 100) / 10} s)`, 0);
  let s: string;
  try { s = JSON.stringify(res); } catch { s = String(res?.message ?? res?.status); }
  return s.length > RESULTAT_OUTIL_MAX_CARS
    ? `${s.slice(0, RESULTAT_OUTIL_MAX_CARS)}\n[…résultat tronqué : ne complète pas la suite de mémoire]`
    : s;
}

async function etapeTravail(c: CtxEtape): Promise<IssueEtape> {
  const outils = outilsDeMission(c.deps);
  const tour = await c.deps.streamLLMTurn({
    model: c.deps.modelePourTier(c.tier),
    system: systemeMission(c.m, c.etat, c.blocMemoire),
    messages: construireMessages(c.etat, null),
    tools: outils,
    maxTokens: ETAPE_MAX_TOKENS,
  });
  // Débit IMMÉDIAT : le coût du tour est connu, il ne doit pas dépendre de la
  // suite (outils lents, fonction tuée). Plafonné à la réserve par la RPC.
  const cout = await debiterTour(c, tour, pireCasAvantEtape(c.pire));
  c.etat.erreurs_consecutives = 0;
  const n = c.m.etapes_faites;
  const texteTour = tour.textBlocks.join('\n').trim();
  const usages = tour.toolUses.slice(0, OUTILS_PAR_ETAPE_MAX);
  const ignores = tour.toolUses.slice(OUTILS_PAR_ETAPE_MAX);

  await c.depot.journal(c.m.id, 'pensee', null, null,
    texteTour ? texte(texteTour, 1000) : `Étape ${n} : ${usages.map((u) => u.name).join(', ') || 'réflexion'}`, cout);

  if (!tour.toolUses.length) {
    c.etat.tours.push({
      n,
      assistant: tour.contentBlocks.length ? tour.contentBlocks : [{ type: 'text', text: texteTour || '…' }],
      user: [{ type: 'text', text: CONSIGNE_CONTINUER }],
    });
    compacter(c.etat);
    await c.depot.sauverEtat(c.m.id, c.etat);
    return 'continuer';
  }

  // Outils du chat en parallèle (indépendants), outils de mission ensuite, dans l'ordre.
  const speciale: DemandeSpeciale = {};
  const resultats = new Map<string, string>();
  await Promise.all(usages.filter((u) => !NOMS_OUTILS_MISSION.has(u.name)).map(async (u) => {
    resultats.set(u.id, await executerOutilChat(c, u));
  }));
  for (const u of usages.filter((x) => NOMS_OUTILS_MISSION.has(x.name))) {
    try {
      resultats.set(u.id, await executerOutilMission(c, u, speciale));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await c.depot.journal(c.m.id, 'erreur', u.name, null, `${u.name} : ${texte(msg, 600)}`, 0);
      resultats.set(u.id, `Erreur : ${msg}`);
    }
  }
  for (const u of ignores) resultats.set(u.id, `Non exécuté : au plus ${OUTILS_PAR_ETAPE_MAX} outils par étape.`);

  c.etat.tours.push({
    n,
    assistant: tour.contentBlocks,
    user: tour.toolUses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: resultats.get(u.id) ?? '' })),
  });
  compacter(c.etat);

  if (speciale.rapport) {
    c.etat.phase = 'fini';
    await c.depot.sauverEtat(c.m.id, c.etat);
    const rapport = normaliserRapport(speciale.rapport, c.etat, c.m.jetons_consommes);
    await cloturerEtRegler(c, 'terminee', rapport, null);
    return 'fin';
  }
  if (speciale.question) {
    c.etat.attente = { question: speciale.question };
    const ok = await c.depot.mettreEnAttente(c.m.id, speciale.question, c.etat);
    if (!ok) await c.depot.sauverEtat(c.m.id, c.etat);   // annulée entre-temps : l'état reste cohérent
    else await c.depot.journal(c.m.id, 'question', 'demander_utilisateur', null, speciale.question, 0);
    return 'pause';
  }
  await c.depot.sauverEtat(c.m.id, c.etat);
  return 'continuer';
}

async function etapeRapport(c: CtxEtape): Promise<IssueEtape> {
  const raison = c.etat.raison_rapport ?? 'budget_atteint';
  const statut: StatutMission = raison === 'erreurs' ? 'echec' : 'budget_atteint';
  const limites = raison === 'erreurs'
    ? ['Mission interrompue par des erreurs techniques répétées.']
    : ['Réserve de jetons de la mission épuisée : rapport partiel.'];
  let rapport: Record<string, unknown>;
  try {
    const tour = await c.deps.streamLLMTurn({
      model: c.deps.modelePourTier(c.tier),
      system: systemeMission(c.m, c.etat, c.blocMemoire),
      messages: construireMessages(c.etat, consigneRapport(raison)),
      tools: [],                                    // dernier tour SANS outils
      maxTokens: RAPPORT_MAX_TOKENS,
    });
    await debiterTour(c, tour, 0);
    const t = tour.textBlocks.join('\n');
    rapport = normaliserRapport(extraireJson(t) ?? { titre: 'Rapport partiel', synthese: texte(t, 6000) },
      c.etat, c.m.jetons_consommes, limites);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await c.depot.journal(c.m.id, 'erreur', null, null, `Rédaction du rapport impossible : ${texte(msg, 600)}`, 0);
    rapport = normaliserRapport(rapportDeSecours(c.m, c.etat, 'rédaction automatique indisponible'),
      c.etat, c.m.jetons_consommes, limites);
  }
  c.etat.phase = 'fini';
  await c.depot.sauverEtat(c.m.id, c.etat);
  await cloturerEtRegler(c, statut, rapport, raison === 'erreurs' ? 'erreurs techniques répétées' : null);
  return 'fin';
}

async function cloturerEtRegler(
  c: CtxEtape, statut: StatutMission, rapport: Record<string, unknown>, erreur: string | null,
): Promise<void> {
  await c.depot.cloturer(c.m.id, statut, rapport, erreur);
  const m = await c.depot.chargerMission(c.m.id);
  if (m) await reglerMission(m, c.deps, c.depot);
}

// ── Règlement ───────────────────────────────────────────────────────────────

/**
 * Mission close : briefing de veille éventuel, puis agent_mission_regler
 * (idempotent). Appelé à la clôture ET par le balayage des missions closes non
 * réglées (annulation, fonction coupée entre clôture et règlement).
 */
export async function reglerMission(m: MissionRow, deps: MoteurDeps, depot: DepotMission): Promise<Record<string, unknown>> {
  const etat = chargerEtat(m.etat);
  // Toute mission de veille close (même interrompue) : briefing.ts décide —
  // précision > rappel, null = aucun briefing.
  if (m.type === 'veille' && !etat.briefing_ecrit && deps.briefingPourMissionVeille) {
    try {
      const b = deps.briefingPourMissionVeille({ id: m.id, statut: m.statut, rapport: m.rapport, criteres: m.criteres });
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
  if (!m || m.statut !== 'en_cours') return { etapes: 0, issue: 'non_en_cours' };
  const etat = chargerEtat(m.etat);
  const tier: Tier = (m.devis?.tier as Tier) ?? await deps.tierUtilisateur(m.user_id);
  const pire = deps.worstCaseJetons(tier, 'report');
  const blocMemoire = await chargerBlocMemoire(depot, m.user_id, m.projet_id);

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
    if (restant < (etat.phase === 'rapport' ? MARGE_RAPPORT_MS : MARGE_ETAPE_MS)) break;
    if (etapes > 0) {
      m = await depot.chargerMission(id);         // annulation pendant le travail ?
      if (!m || m.statut !== 'en_cours') break;
      await depot.prolongerBail(id, worker, BAIL_S);
    }
    const c: CtxEtape = { m: m!, etat, tier, pire, blocMemoire, deps, depot };

    if (etat.phase === 'fini') {
      // Fonction coupée entre la sauvegarde finale et la clôture.
      await cloturerEtRegler(c, 'echec', rapportDeSecours(m!, etat, 'clôture interrompue'), 'clôture interrompue');
      return { etapes, issue: 'fin' };
    }

    // Garde budgétaire AVANT l'étape : son pire cas + celui du rapport final.
    if (etat.phase !== 'rapport') {
      const reste = m!.jetons_reserves - m!.jetons_consommes;
      const etapesOk = m!.etapes_faites < m!.etapes_max - 1;
      if (!etat.peut_continuer || reste < pireCasAvantEtape(pire) || !etapesOk) {
        etat.phase = 'rapport';
        etat.raison_rapport = etapesOk ? 'budget_atteint' : 'etapes_max';
        await depot.sauverEtat(id, etat);
        await depot.journal(id, 'pensee', null, { reste, etapes_faites: m!.etapes_faites },
          'Réserve de la mission bientôt épuisée : rédaction du rapport partiel.', 0);
        continue;
      }
    }

    let issue: IssueEtape;
    try {
      issue = etat.phase === 'plan' ? await etapePlan(c)
        : etat.phase === 'rapport' ? await etapeRapport(c)
        : await etapeTravail(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      etat.erreurs_consecutives += 1;
      await depot.journal(id, 'erreur', null, null, `Étape interrompue : ${texte(msg, 800)}`, 0);
      if (etat.erreurs_consecutives >= ERREURS_MAX && etat.phase !== 'rapport') {
        etat.phase = 'rapport';
        etat.raison_rapport = 'erreurs';
      }
      await depot.sauverEtat(id, etat).catch(() => {});
      if (etat.erreurs_consecutives >= ERREURS_MAX + 2) {
        // Même le rapport échoue : clôture de secours, sans LLM.
        await cloturerEtRegler(c, 'echec', normaliserRapport(rapportDeSecours(m!, etat, 'erreurs répétées'), etat, m!.jetons_consommes), texte(msg, 1000));
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
  const bilan: BilanTick = { prises: 0, reservees: [], refusees: [], reglees: [], travaillees: [], erreurs: [], duree_ms: 0 };

  const missions = await depot.prendreMissions(worker, BAIL_S);
  bilan.prises = missions.length;

  await Promise.all(missions.map(async (m) => {
    try {
      if (STATUTS_FINAUX.includes(m.statut)) {
        await reglerMission(m, deps, depot);
        bilan.reglees.push(m.id);
        return;
      }
      if (m.statut === 'en_attente') {
        const r = await depot.reserver(m.id);
        if (!r.ok) {
          bilan.refusees.push({ id: m.id, raison: r.raison ?? 'inconnue' });
          return;   // solde insuffisant / devis invalide : la RPC a déjà mis la mission en échec
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
  deps: Pick<MoteurDeps, 'worstCaseJetons' | 'tierUtilisateur'>,
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
        const pire = deps.worstCaseJetons(tier, 'report');
        const devis = calculerDevis({ type, tier, pireCasEtape: pire });
        if (!devisViable(devis, pire)) {
          return { status: 'error', source: SOURCE, message: 'Devis impossible à établir.' };
        }
        let projet: string | null = estUuid(input.projet_id) ? input.projet_id : projetDuContexte(ctx);
        if (projet && !(await depot.projetExiste(projet))) projet = null;
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
        if (v.element.projet_id && !(await depot.projetExiste(v.element.projet_id))) v.element.projet_id = null;
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
