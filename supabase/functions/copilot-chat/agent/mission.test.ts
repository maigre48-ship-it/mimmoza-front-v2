// deno test supabase/functions/copilot-chat/agent/mission.test.ts
// Tests SANS réseau : faux LLM, faux executeTool, dépôt en mémoire qui reproduit
// la sémantique des RPC de la migration 20261030_agent_autonome.sql.
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);

import type {
  ActionExterne, Briefing, DepotMission, ElementMemoire, EtatMission, MissionRow, MoteurDeps,
  OutilDef, ResultatOutil, StatutMission, TourLLM,
} from './types.ts';
import { STATUTS_FINAUX } from './types.ts';
import { calculerDevis, devisViable, ETAPES_PAR_TYPE, pireCasAvantEtape } from './devis.ts';
import {
  chargerEtat, compacter, construireMessages, etatInitial, evenementDevis, executerOutilAgentChat,
  extraireJson, extrairePlan, tickMissions, TOURS_GARDES,
} from './mission.ts';
import { formaterBlocMemoire, slugCle, validerMemoire } from './memoire.ts';
import { outilChatAutoriseEnMission } from './outils.ts';
import { briefingPourMissionVeille } from './briefing.ts';

// Aucun accès réseau pendant ces tests : tout fetch est une faute.
globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;

const USER = '11111111-1111-4111-8111-111111111111';
const PIRE = 10;   // pire cas d'une étape (faux worstCaseJetons)

// ── Dépôt en mémoire ─────────────────────────────────────────────────────────
class DepotMemoire implements DepotMission {
  missions = new Map<string, MissionRow & { bail?: number | null; worker?: string | null }>();
  journalLignes: Array<{ mission_id: string; n: number; genre: string; outil: string | null; resume: string; jetons: number }> = [];
  actions: Array<ActionExterne & { id: string; statut: string }> = [];
  memoire: Array<ElementMemoire & { user_id: string }> = [];
  briefings: Briefing[] = [];
  solde = 1000;
  reservations = new Map<string, { montant: number; statut: 'reserved' | 'settled' | 'refunded' }>();
  pertes = 0;
  horloge: () => number;
  constructor(horloge: () => number) { this.horloge = horloge; }

  ajouter(p: Partial<MissionRow> & { statut: StatutMission }): MissionRow {
    const id = crypto.randomUUID();
    const devis = p.devis ?? calculerDevis({ type: p.type ?? 'prospection_fonciere', tier: 'sonnet', pireCasEtape: PIRE, etapes: 6 });
    const m: MissionRow = {
      id, user_id: USER, projet_id: null, conversation_id: null, origine: 'chat',
      type: 'prospection_fonciere', objectif: 'Trouver des terrains à Rennes', criteres: { communes: ['Rennes'] },
      devis, reservation_id: null, jetons_reserves: 0, jetons_consommes: 0, etapes_faites: 0,
      etapes_max: devis.etapes_max, etat: {}, question_en_attente: null, rapport: null, erreur: null, regle_le: null,
      ...p,
    };
    this.missions.set(id, structuredClone(m));
    return m;
  }
  private m(id: string) { const m = this.missions.get(id); if (!m) throw new Error('introuvable'); return m; }

  async prendreMissions(worker: string, bailS: number) {
    const t = this.horloge();
    const pris = [...this.missions.values()].filter((m) =>
      (m.statut === 'en_attente' || m.statut === 'en_cours' ||
        (STATUTS_FINAUX.includes(m.statut) && m.reservation_id && !m.regle_le)) &&
      (m.bail == null || m.bail < t)).slice(0, 3);
    for (const m of pris) { m.bail = t + bailS * 1000; m.worker = worker; }
    return structuredClone(pris);
  }
  async reserver(id: string) {
    const m = this.m(id);
    if (m.statut !== 'en_attente' || m.reservation_id) return { ok: false, raison: 'statut' };
    const max = m.devis?.jetons_max ?? 0;
    if (this.solde < max) {
      m.statut = 'echec'; m.erreur = 'solde insuffisant'; m.bail = null;
      return { ok: false, raison: 'solde_insuffisant' };
    }
    this.solde -= max;
    const rid = crypto.randomUUID();
    this.reservations.set(rid, { montant: max, statut: 'reserved' });
    m.statut = 'en_cours'; m.reservation_id = rid; m.jetons_reserves = max;
    return { ok: true, jetons_reserves: max };
  }
  async prolongerBail(id: string, worker: string, s: number) { const m = this.m(id); if (m.worker !== worker) return false; m.bail = this.horloge() + s * 1000; return true; }
  async libererBail(id: string, worker: string) { const m = this.m(id); if (m.worker === worker) m.bail = null; }
  async chargerMission(id: string) { const m = this.missions.get(id); return m ? structuredClone(m) : null; }
  async sauverEtat(id: string, etat: EtatMission) {
    const s = JSON.stringify(etat);
    assert(s.length < 524288, 'état < 512 Ko');
    this.m(id).etat = JSON.parse(s);
  }
  async mettreEnAttente(id: string, question: string, etat: EtatMission) {
    const m = this.m(id); if (m.statut !== 'en_cours') return false;
    m.statut = 'attente_utilisateur'; m.question_en_attente = question; m.etat = structuredClone(etat); m.bail = null;
    return true;
  }
  async debiter(id: string, jetons: number, pire: number) {
    assert(jetons >= 0, 'p_jetons >= 0');
    const m = this.m(id);
    if (!m.reservation_id || m.regle_le) return { ok: false, reste: 0, peut_continuer: false };
    const conso = Math.min(m.jetons_consommes + jetons, m.jetons_reserves);
    this.pertes += Math.max(0, m.jetons_consommes + jetons - m.jetons_reserves);
    m.jetons_consommes = conso; m.etapes_faites += 1;
    const reste = m.jetons_reserves - conso;
    return { ok: true, reste, jetons_consommes: conso, peut_continuer: m.statut === 'en_cours' && reste >= pire && m.etapes_faites < m.etapes_max };
  }
  async cloturer(id: string, statut: StatutMission, rapport: Record<string, unknown> | null, erreur: string | null) {
    const m = this.m(id);
    if (!STATUTS_FINAUX.includes(m.statut)) m.statut = statut;
    m.rapport = rapport ?? m.rapport; m.erreur = erreur ?? m.erreur; m.question_en_attente = null; m.bail = null;
  }
  async regler(id: string) {
    const m = this.m(id);
    if (m.regle_le || !m.reservation_id) return { ok: true, deja_regle: true };
    if (!STATUTS_FINAUX.includes(m.statut)) return { ok: false, raison: 'mission_active' };
    const r = this.reservations.get(m.reservation_id)!;
    const final = Math.min(m.jetons_consommes, m.jetons_reserves, r.montant);
    this.solde += r.montant - final;
    r.statut = final > 0 ? 'settled' : 'refunded';
    m.regle_le = new Date().toISOString();
    return { ok: true, deja_regle: false, jetons_factures: final, jetons_rembourses: r.montant - final };
  }
  async journal(missionId: string, genre: string, outil: string | null, _e: unknown, resume: string, jetons: number) {
    const n = this.journalLignes.filter((l) => l.mission_id === missionId).length + 1;
    this.journalLignes.push({ mission_id: missionId, n, genre, outil, resume, jetons });
  }
  async creerActionBrouillon(a: ActionExterne) {
    const id = crypto.randomUUID();
    this.actions.push({ ...a, id, statut: 'brouillon' });   // forcé par le déclencheur en base
    return id;
  }
  async memoriser(userId: string, _missionId: string | null, e: ElementMemoire) { this.memoire.unshift({ ...e, user_id: userId }); }
  async lireMemoire(userId: string) { return this.memoire.filter((e) => e.user_id === userId); }
  async creerBriefing(_u: string, _m: string, b: Briefing) { this.briefings.push(b); }
  async creerMission(row: Record<string, unknown>) {
    const id = crypto.randomUUID();
    this.missions.set(id, { ...(row as unknown as MissionRow), id, jetons_reserves: 0, jetons_consommes: 0, etapes_faites: 0, etat: {}, rapport: null, erreur: null, question_en_attente: null, reservation_id: null });
    return id;
  }
  async listerMissions(userId: string, n: number) { return [...this.missions.values()].filter((m) => m.user_id === userId).reverse().slice(0, n); }
  async chargerMissionUtilisateur(userId: string, id: string) { const m = this.missions.get(id); return m && m.user_id === userId ? m : null; }
  async projetExiste() { return false; }

  /** Simule la RPC utilisateur agent_mission_repondre. */
  repondre(id: string, reponse: string) {
    const m = this.m(id);
    assert(m.statut === 'attente_utilisateur');
    m.etat = { ...(m.etat ?? {}), derniere_reponse: { question: m.question_en_attente, reponse } } as Partial<EtatMission>;
    m.statut = 'en_cours'; m.question_en_attente = null; m.bail = null;
  }
  /** Simule la RPC utilisateur agent_mission_annuler. */
  annuler(id: string) { this.m(id).statut = 'annulee'; }
}

// ── Faux LLM et fausses dépendances ─────────────────────────────────────────
type Script = (appel: { system: string; messages: unknown[]; tools: OutilDef[] }) => Partial<TourLLM>;

function tourOutils(...usages: Array<[string, Record<string, unknown>]>): Partial<TourLLM> {
  const toolUses = usages.map(([name, input], i) => ({ id: `tu_${crypto.randomUUID().slice(0, 6)}_${i}`, name, input }));
  return {
    textBlocks: ['Je continue.'], stopReason: 'tool_use', toolUses,
    contentBlocks: [{ type: 'text', text: 'Je continue.' }, ...toolUses.map((u) => ({ type: 'tool_use', ...u }))],
  };
}

function fabriquerDeps(depot: DepotMemoire, script: Script, horloge: { t: number }) {
  const appelsLLM: Array<{ tools: string[]; messages: unknown[] }> = [];
  const appelsOutils: string[] = [];
  const deps: MoteurDeps = {
    async executeTool(name) {
      appelsOutils.push(name);
      horloge.t += 2000;
      return { status: 'ok', source: name, data: { exemple: 1 } } as ResultatOutil;
    },
    async streamLLMTurn(p) {
      horloge.t += 10_000;
      appelsLLM.push({ tools: p.tools.map((t) => t.name), messages: p.messages });
      const r = script({ system: p.system, messages: p.messages, tools: p.tools });
      return {
        textBlocks: [], contentBlocks: [], toolUses: [], webSearches: 0, stopReason: 'end_turn',
        inputTokens: 1000, outputTokens: 100, ...r,
      } as TourLLM;
    },
    debitJetons: () => 4,          // coût réel d'un tour (< pire cas)
    worstCaseJetons: () => PIRE,
    tierUtilisateur: async () => 'sonnet',
    modelePourTier: () => 'faux-modele',
    outilsChat: () => [
      { name: 'get_etude_parcelle', description: '', input_schema: { type: 'object', properties: {} }, available_in_modes: ['report'] },
      { name: 'action_ouvrir_page', description: '', input_schema: { type: 'object', properties: {} }, available_in_modes: ['report'] },
      { name: 'creer_zone_veille', description: '', input_schema: { type: 'object', properties: {} }, available_in_modes: ['report'] },
      { name: 'proposer_mission', description: '', input_schema: { type: 'object', properties: {} }, available_in_modes: ['report'] },
    ],
    briefingPourMissionVeille,
    now: () => horloge.t,
  };
  return { deps, appelsLLM, appelsOutils };
}

const estPlan = (a: { tools: OutilDef[]; messages: unknown[] }) =>
  a.tools.length === 0 && JSON.stringify(a.messages).includes('PLAN');
const estRapport = (a: { tools: OutilDef[]; messages: unknown[] }) =>
  a.tools.length === 0 && JSON.stringify(a.messages).includes('RAPPORT PARTIEL');

// ── Tests ───────────────────────────────────────────────────────────────────

Deno.test('devis : déterministe, max = étapes × pire cas, min ≈ 40 %, plafond', () => {
  const d = calculerDevis({ type: 'prospection_fonciere', tier: 'sonnet', pireCasEtape: 19 });
  assertEquals(d.etapes_max, ETAPES_PAR_TYPE.prospection_fonciere);
  assertEquals(d.jetons_max, 30 * 19);
  assertEquals(d.jetons_min, Math.ceil(30 * 19 * 0.4));
  assertEquals(d, calculerDevis({ type: 'prospection_fonciere', tier: 'sonnet', pireCasEtape: 19 }));
  const p = calculerDevis({ type: 'veille', tier: 'haiku', pireCasEtape: 8, plafondJetons: 50 });
  assertEquals(p.etapes_max, 6);
  assert(p.jetons_max <= 50);
  assert(devisViable(d, 19));
  assert(!devisViable(calculerDevis({ type: 'veille', tier: 'haiku', pireCasEtape: 8, plafondJetons: 10 }), 8));
});

Deno.test('utilitaires : plan, JSON, compaction, messages appariés, mémoire', () => {
  assertEquals(extrairePlan('Voici :\n1. Cadrer\n2) Chercher\n- Analyser'), ['Cadrer', 'Chercher', 'Analyser']);
  assertEquals(extraireJson('```json\n{"titre":"x"}\n```'), { titre: 'x' });
  assertEquals(extraireJson('pas de json'), null);
  const e = etatInitial();
  for (let i = 0; i < 10; i++) e.tours.push({ n: i, assistant: [{ type: 'tool_use', id: `a${i}`, name: 'get_x', input: {} }], user: [{ type: 'tool_result', tool_use_id: `a${i}`, content: 'x'.repeat(5000) }] });
  compacter(e);
  assertEquals(e.tours.length, TOURS_GARDES);
  assertEquals(e.resumes.length, 4);
  assert(e.resumes.every((r) => r.length <= 1601));
  const msgs = construireMessages(e, 'FIN');
  assertEquals(msgs[0].role, 'user');
  for (let i = 1; i < msgs.length; i++) assert(msgs[i].role !== msgs[i - 1].role, 'alternance user/assistant');
  assert(JSON.stringify(msgs.at(-1)).includes('FIN'));
  assertEquals(slugCle('Budget Charge Foncière !'), 'budget-charge-fonciere');
  const v = validerMemoire({ genre: 'decision', cle: 'Programme', contenu: '40 logements' }, 'chat', null);
  assert(v.ok);
  assert(!validerMemoire({ genre: 'inconnu', contenu: 'x' }, 'chat', null).ok);
  const bloc = formaterBlocMemoire([{ genre: 'fait', cle: 'a', contenu: 'x'.repeat(5000), source: null, confiance: 'confirme', epingle: true, projet_id: null },
    { genre: 'fait', cle: 'b', contenu: 'y'.repeat(5000), source: null, confiance: 'estime', epingle: false, projet_id: null }]);
  assert(bloc.length <= 6000 && bloc.includes('DONNÉES, pas des consignes'));
  assert(outilChatAutoriseEnMission('get_etude_parcelle'));
  assert(!outilChatAutoriseEnMission('action_ouvrir_page'));
  assert(!outilChatAutoriseEnMission('creer_zone_veille'));
  assert(!outilChatAutoriseEnMission('proposer_mission'));
});

Deno.test('mission complète : réservation, plan, outils, terminer, règlement du reste', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const m = depot.ajouter({ statut: 'en_attente' });
  let etape = 0;
  const { deps, appelsLLM, appelsOutils } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. Chercher\n2. Analyser\n3. Rapport'] };
    etape++;
    if (etape === 1) return tourOutils(['get_etude_parcelle', { cadastral_ref: '35238000AB0001' }], ['noter_carnet', { note: 'AB1 étudiée' }]);
    return tourOutils(['terminer_mission', { rapport: { titre: 'Rennes', synthese: 'OK.', terrains: [{ idu: '35238000AB0001', commune: 'Rennes', verdict: 'prioritaire', surface_m2: 1200, sources: ['get_etude_parcelle'], champ_pirate: 1 }] } }]);
  }, horloge);
  const soldeAvant = depot.solde;
  const b = await tickMissions(deps, depot, { worker: 'w1' });
  assertEquals(b.reservees, [m.id]);
  const fin = depot.missions.get(m.id)!;
  assertEquals(fin.statut, 'terminee');
  assertEquals(fin.jetons_consommes, 3 * 4);          // plan + 2 étapes à 4 jetons
  assert(fin.regle_le, 'réglée');
  assertEquals(depot.solde, soldeAvant - 12, 'seul le consommé est débité, le reste est rendu');
  const r = fin.rapport as Record<string, unknown>;
  assertEquals((r.terrains as Array<Record<string, unknown>>)[0].verdict, 'prioritaire');
  assert(!('champ_pirate' in (r.terrains as Array<Record<string, unknown>>)[0]));
  assertEquals(r.jetons_consommes, 12);
  assertEquals(appelsOutils, ['get_etude_parcelle']);
  // Outils d'interface / d'écriture jamais proposés au modèle en mission.
  const offerts = appelsLLM.find((x) => x.tools.length)!.tools;
  assert(offerts.includes('get_etude_parcelle') && offerts.includes('terminer_mission'));
  assert(!offerts.includes('action_ouvrir_page') && !offerts.includes('creer_zone_veille') && !offerts.includes('proposer_mission'));
  assertEquals(chargerEtat(fin.etat).carnet, ['AB1 étudiée']);
  assert(depot.journalLignes.some((l) => l.genre === 'plan'));
});

Deno.test('budget : débit qui stoppe AVANT dépassement, dernier tour sans outils, rapport partiel', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  // Réserve de 50 : pire cas avant étape = 2 × 10 = 20.
  const devis = { jetons_min: 20, jetons_max: 50, etapes_max: 5, duree_estimee_min: 2, tier: 'sonnet' as const, explication: '' };
  const m = depot.ajouter({ statut: 'en_attente', devis });
  const { deps, appelsLLM } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. Chercher'] };
    if (estRapport(a)) return { textBlocks: ['{"titre":"Partiel","synthese":"Ce qui a été vu.","terrains":[]}'], inputTokens: 1, outputTokens: 1 };
    return tourOutils(['get_etude_parcelle', {}]);   // ne termine jamais de lui-même
  }, horloge);
  deps.debitJetons = () => 9;   // proche du pire cas
  await tickMissions(deps, depot, { worker: 'w' });
  // Le rapport n'est entamé que s'il reste assez de temps dans l'invocation :
  // sinon il part au tick suivant (état sauvegardé en phase « rapport »).
  if (depot.missions.get(m.id)!.statut === 'en_cours') {
    assertEquals(chargerEtat(depot.missions.get(m.id)!.etat).phase, 'rapport');
    horloge.t += 1;
    await tickMissions(deps, depot, { worker: 'w2' });
  }
  const fin = depot.missions.get(m.id)!;
  assertEquals(fin.statut, 'budget_atteint');
  assert(fin.jetons_consommes <= fin.jetons_reserves, 'jamais au-delà de la réserve');
  assertEquals(depot.pertes, 0, 'la garde a arrêté avant tout dépassement');
  const dernier = appelsLLM.at(-1)!;
  assertEquals(dernier.tools, [], 'rapport rédigé SANS outils');
  const r = fin.rapport as Record<string, unknown>;
  assertEquals(r.titre, 'Partiel');
  assert((r.limites as string[]).some((l) => l.includes('épuisée')));
  assert(fin.regle_le);
  // Chaque étape de travail a démarré avec ≥ pire cas étape + rapport.
  assertEquals(pireCasAvantEtape(PIRE), 20);
});

Deno.test('reprise après coupure : état rechargé, plan non refait, tours conservés', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const m = depot.ajouter({ statut: 'en_attente' });
  let plans = 0;
  let travail = 0;
  const script: Script = (a) => {
    if (estPlan(a)) { plans++; return { textBlocks: ['1. A\n2. B'] }; }
    travail++;
    if (travail >= 4) return tourOutils(['terminer_mission', { rapport: { titre: 'T', synthese: 'S' } }]);
    return tourOutils(['noter_carnet', { note: `étape ${travail}` }]);
  };
  // Premier tick très court : fonction « tuée » après ~2 étapes.
  const d1 = fabriquerDeps(depot, script, horloge);
  await tickMissions(d1.deps, depot, { worker: 'w1', dureeMs: 77_000 });
  const milieu = depot.missions.get(m.id)!;
  assertEquals(milieu.statut, 'en_cours');
  const etatMilieu = chargerEtat(milieu.etat);
  assert(etatMilieu.plan.length === 2 && etatMilieu.tours.length >= 1, 'état sauvegardé après chaque étape');
  // Le bail est libéré : un nouveau worker (nouvelle invocation) reprend.
  horloge.t += 1;
  const d2 = fabriquerDeps(depot, script, horloge);
  await tickMissions(d2.deps, depot, { worker: 'w2' });
  const fin = depot.missions.get(m.id)!;
  assertEquals(fin.statut, 'terminee');
  assertEquals(plans, 1, 'le plan n’est pas refait à la reprise');
  assertEquals(chargerEtat(fin.etat).carnet, ['étape 1', 'étape 2', 'étape 3']);
  // Messages de la reprise : historique rejoué, tool_use/tool_result appariés.
  const msgs = d2.appelsLLM[0].messages as Array<{ role: string; content: unknown }>;
  assert(msgs.length > 2);
});

Deno.test('reprise après erreur d’outil ou de LLM : jamais bloquée, échec propre après erreurs répétées', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const m = depot.ajouter({ statut: 'en_attente' });
  const { deps } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. A'] };
    throw new Error('Anthropic 529');
  }, horloge);
  await tickMissions(deps, depot, { worker: 'w' });
  const fin = depot.missions.get(m.id)!;
  assert(['echec', 'budget_atteint'].includes(fin.statut), fin.statut);
  assertEquals(fin.statut, 'echec');
  assert(fin.rapport, 'rapport de secours présent');
  assert(fin.regle_le, 'réglée : le non-consommé est rendu');
  assertEquals(fin.jetons_consommes, 4, 'seul le plan a été facturé');
});

Deno.test('demander_utilisateur : met en pause, la mission dort, la réponse est reprise', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const m = depot.ajouter({ statut: 'en_attente' });
  let vuReponse = false;
  const { deps } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. Cadrer'] };
    if (JSON.stringify(a.messages).includes('Réponse de l\'utilisateur')) {
      vuReponse = JSON.stringify(a.messages).includes('40 logements');
      return tourOutils(['terminer_mission', { rapport: { titre: 'T', synthese: 'S' } }]);
    }
    return tourOutils(['demander_utilisateur', { question: 'Quel programme visez-vous ?' }]);
  }, horloge);
  await tickMissions(deps, depot, { worker: 'w' });
  let x = depot.missions.get(m.id)!;
  assertEquals(x.statut, 'attente_utilisateur');
  assertEquals(x.question_en_attente, 'Quel programme visez-vous ?');
  // Un tick pendant l'attente ne la prend pas.
  horloge.t += 200_000;
  const b = await tickMissions(deps, depot, { worker: 'w' });
  assertEquals(b.prises, 0);
  depot.repondre(m.id, '40 logements collectifs');
  await tickMissions(deps, depot, { worker: 'w' });
  x = depot.missions.get(m.id)!;
  assertEquals(x.statut, 'terminee');
  assert(vuReponse, 'la réponse de l’utilisateur est transmise au modèle');
});

Deno.test('annulation : la mission s’arrête et le non-consommé est remboursé', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const m = depot.ajouter({ statut: 'en_attente' });
  const soldeAvant = depot.solde;
  const { deps } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. A'] };
    depot.annuler(m.id);   // l'utilisateur annule pendant l'étape
    return tourOutils(['noter_carnet', { note: 'x' }]);
  }, horloge);
  await tickMissions(deps, depot, { worker: 'w' });
  let x = depot.missions.get(m.id)!;
  assertEquals(x.statut, 'annulee');
  // Le bail en vol expire, le tick suivant règle.
  horloge.t += 200_000;
  const b = await tickMissions(deps, depot, { worker: 'w2' });
  assertEquals(b.reglees, [m.id]);
  x = depot.missions.get(m.id)!;
  assert(x.regle_le);
  assertEquals(depot.solde, soldeAvant - x.jetons_consommes, 'rien d’autre que le consommé n’est perdu');
  // Règlement idempotent.
  const r = await depot.regler(m.id);
  assertEquals(r.deja_regle, true);
});

Deno.test('solde insuffisant : échec, rien débité', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  depot.solde = 5;
  const m = depot.ajouter({ statut: 'en_attente' });
  const { deps, appelsLLM } = fabriquerDeps(depot, () => ({}), horloge);
  const b = await tickMissions(deps, depot, { worker: 'w' });
  assertEquals(b.refusees, [{ id: m.id, raison: 'solde_insuffisant' }]);
  assertEquals(depot.missions.get(m.id)!.statut, 'echec');
  assertEquals(depot.solde, 5);
  assertEquals(appelsLLM.length, 0);
});

Deno.test('actions externes : uniquement des brouillons, jamais d’envoi', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const m = depot.ajouter({ statut: 'en_attente' });
  let n = 0;
  const { deps, appelsOutils } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. Courrier'] };
    n++;
    if (n === 1) {
      return tourOutils(['rediger_action_externe', {
        canal: 'courrier', destinataire: { nom: 'M. Dupont', qualite: 'proprietaire', email: 'pas-un-mail' },
        objet: 'Votre terrain AB 1', corps: 'Madame, Monsieur, …', statut: 'envoye',
      }], ['rediger_action_externe', { canal: 'fax', destinataire: { nom: 'X' }, objet: 'o', corps: 'c' }]);
    }
    return tourOutils(['terminer_mission', { rapport: { titre: 'T', synthese: 'S' } }]);
  }, horloge);
  await tickMissions(deps, depot, { worker: 'w' });
  assertEquals(depot.actions.length, 1, 'canal invalide refusé');
  assertEquals(depot.actions[0].statut, 'brouillon');
  assert(!('email' in depot.actions[0].destinataire), 'aucune coordonnée inventée/invalide transmise');
  assertEquals(appelsOutils, [], 'aucun outil d’envoi appelé');
  const r = depot.missions.get(m.id)!.rapport as Record<string, unknown>;
  assertEquals(r.actions_proposees, [depot.actions[0].id]);
  assert(depot.journalLignes.some((l) => l.genre === 'action' && l.resume.includes("rien n'est envoyé")));
});

Deno.test('veille : briefing écrit en fin de mission, seulement les éléments retenus', async () => {
  const horloge = { t: 0 };
  const depot = new DepotMemoire(() => horloge.t);
  const devis = calculerDevis({ type: 'veille', tier: 'sonnet', pireCasEtape: PIRE });
  depot.ajouter({ statut: 'en_attente', type: 'veille', origine: 'proactif', devis });
  const { deps } = fabriquerDeps(depot, (a) => {
    if (estPlan(a)) return { textBlocks: ['1. Qualifier'] };
    return tourOutils(['terminer_mission', { rapport: { titre: 'Veille', synthese: 'Un permis.', elements: [
      { genre: 'permis', titre: 'PC 40 logements rue X', detail: 'Déposé le 12/10', source: 'get_sitadel', retenu: true },
      { genre: 'marche', titre: 'Bruit', detail: '?', source: 'get_x', retenu: false },
    ] } }]);
  }, horloge);
  await tickMissions(deps, depot, { worker: 'w' });
  assertEquals(depot.briefings.length, 1);
  assertEquals((depot.briefings[0].elements as unknown[]).length, 1);
});

Deno.test('chat : proposer_mission crée un devis (rien réservé) et l’événement SSE', async () => {
  const depot = new DepotMemoire(() => 0);
  const deps = { worstCaseJetons: () => 19, tierUtilisateur: async () => 'sonnet' as const };
  const soldeAvant = depot.solde;
  const r = await executerOutilAgentChat('proposer_mission',
    { type: 'prospection_fonciere', objectif: 'Terrains 2 000 m² zone U à Rennes', criteres: { communes: ['Rennes'] } },
    { vertical: 'promoteur', route: '/' }, USER, deps, depot);
  assert(r && r.status === 'ok');
  const ev = evenementDevis(r!)!;
  assertEquals((ev.devis as { jetons_max: number }).jetons_max, 30 * 19);
  const m = depot.missions.get(String(ev.mission_id))!;
  assertEquals(m.statut, 'devis');
  assertEquals(m.user_id, USER);
  assertEquals(depot.solde, soldeAvant, 'aucune réservation au devis');
  assertEquals(await executerOutilAgentChat('get_etude_parcelle', {}, {}, USER, deps, depot), null);
  const sansSession = await executerOutilAgentChat('lister_missions', {}, {}, null, deps, depot);
  assertEquals(sansSession?.status, 'error');
  const mem = await executerOutilAgentChat('memoriser', { genre: 'decision', cle: 'programme', contenu: '40 logements' }, {}, USER, deps, depot);
  assertEquals(mem?.status, 'ok');
  assertEquals(depot.memoire.length, 1);
});

import { clesServiceRole, egalTempsConstant, estCleServiceRole } from './interne.ts';

Deno.test('route interne : seule la clé de service ouvre le tick', () => {
  const env = (n: string) => ({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_abcdefghijklmnopqrstuvwxyz' }),
    SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.legacy-service-role-jwt',
  } as Record<string, string>)[n];
  const cles = clesServiceRole(env);
  assertEquals(cles.length, 2);
  assert(estCleServiceRole('Bearer sb_secret_abcdefghijklmnopqrstuvwxyz', cles));
  assert(estCleServiceRole('Bearer eyJhbGciOiJIUzI1NiJ9.legacy-service-role-jwt', cles));
  assert(!estCleServiceRole('Bearer sb_secret_abcdefghijklmnopqrstuvwxyZ', cles));
  assert(!estCleServiceRole('Bearer eyJ.jwt-utilisateur', cles));
  assert(!estCleServiceRole(null, cles));
  assert(!estCleServiceRole('Bearer ', []));
  assert(egalTempsConstant('abc', 'abc') && !egalTempsConstant('abc', 'abcd'));
});
