// deno test -A supabase/functions/copilot-chat/agent/studio-mission.test.ts
// LOT E1 — la mission de CONCEPTION prépare la 3D (outil de mission studio_preparer_3d, injecté par
// l'index via MoteurDeps.outilStudio) ; jamais de rendu en mission ; autres missions : outil absent.
// Moteur réel (tickMissions), faux LLM scripté, dépôt en mémoire minimal (sémantique des RPC de
// 20261030_agent_autonome.sql reprise de mission.test.ts), outil Studio RÉEL (studio.ts) sur un dépôt mémoire.
import * as na from 'node:assert/strict';
import type { ContexteOutilStudio, DepotMission, EtatMission, MissionRow, MoteurDeps, OutilDef, StatutMission, TourLLM } from './types.ts';
import { STATUTS_FINAUX } from './types.ts';
import { calculerDevis } from './devis.ts';
import { etatInitial, tickMissions } from './mission.ts';
import { executerOutilStudio, type DepotStudio } from './studio.ts';
import { completerRegles, normaliserRegle, type RegleConception } from './conception.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const USER = '11111111-1111-4111-8111-111111111111';
const PIRE = 10;

class DepotMissionMemoire implements DepotMission {
  missions = new Map<string, MissionRow & { bail?: number | null; worker?: string | null }>();
  journalLignes: Array<{ genre: string; outil: string | null; resume: string }> = [];
  debits = new Set<string>();
  conceptions = new Map<string, Record<string, unknown>>();
  constructor(private horloge: () => number) {}
  private m(id: string) { const m = this.missions.get(id); if (!m) throw new Error('introuvable'); return m; }
  async prendreMissions(worker: string, bailS: number) {
    const t = this.horloge();
    const pris = [...this.missions.values()].filter((m) => (m.statut === 'en_cours' || (STATUTS_FINAUX.includes(m.statut) && m.reservation_id && !m.regle_le)) && (m.bail == null || m.bail < t));
    for (const m of pris) { m.bail = t + bailS * 1000; m.worker = worker; }
    return structuredClone(pris);
  }
  async reserver() { return { ok: false, raison: 'statut' }; }
  async prolongerBail(id: string, worker: string, s: number) { const m = this.m(id); if (m.worker !== worker) return false; m.bail = this.horloge() + s * 1000; return true; }
  async libererBail(id: string) { this.m(id).bail = null; }
  async chargerMission(id: string) { const m = this.missions.get(id); return m ? structuredClone(m) : null; }
  async sauverEtat(id: string, etat: EtatMission) { this.m(id).etat = JSON.parse(JSON.stringify(etat)); }
  async mettreEnAttente() { return false; }
  async debiter(id: string, n: number, jetons: number, pire: number, etat: EtatMission | null) {
    const m = this.m(id);
    if (this.debits.has(`${id}:${n}`)) return { ok: false, deja_debite: true, reste: m.jetons_reserves - m.jetons_consommes, peut_continuer: true };
    this.debits.add(`${id}:${n}`);
    m.jetons_consommes = Math.min(m.jetons_consommes + jetons, m.jetons_reserves); m.etapes_faites += 1;
    if (etat) m.etat = JSON.parse(JSON.stringify(etat));
    const reste = m.jetons_reserves - m.jetons_consommes;
    return { ok: true, reste, jetons_consommes: m.jetons_consommes, peut_continuer: m.statut === 'en_cours' && reste >= pire && m.etapes_faites < m.etapes_max };
  }
  async proactifEtat() { return { actif: true, learning_enabled: true, restant: 100 }; }
  async cloturer(id: string, statut: StatutMission, rapport: Record<string, unknown> | null, erreur: string | null) {
    const m = this.m(id); if (!STATUTS_FINAUX.includes(m.statut)) m.statut = statut; m.rapport = rapport ?? m.rapport; m.erreur = erreur ?? m.erreur; m.bail = null;
  }
  async regler(id: string) { const m = this.m(id); m.regle_le = new Date().toISOString(); return { ok: true, deja_regle: false, jetons_factures: m.jetons_consommes, jetons_rembourses: 0 }; }
  async journal(_m: string, genre: string, outil: string | null, _e: unknown, resume: string) { this.journalLignes.push({ genre, outil, resume }); }
  async creerActionBrouillon() { return crypto.randomUUID(); }
  async memoriser() {}
  async lireMemoire() { return []; }
  async creerBriefing() {}
  async creerMission() { return crypto.randomUUID(); }
  async listerMissions() { return []; }
  async chargerMissionUtilisateur() { return null; }
  async projetAccessible() { return false; }
  async reglesPluImportees() { return []; }
  async enregistrerConception(missionId: string, userId: string, champs: Record<string, unknown>) {
    const ex = [...this.conceptions.entries()].find(([, v]) => v.mission_id === missionId);
    if (ex) { Object.assign(ex[1], champs); return ex[0]; }
    const id = crypto.randomUUID(); this.conceptions.set(id, { ...champs, user_id: userId, mission_id: missionId }); return id;
  }
  async telechargerFichier() { return null; }
}

function tourOutils(...usages: Array<[string, Record<string, unknown>]>): Partial<TourLLM> {
  const toolUses = usages.map(([name, input], i) => ({ id: `tu_${i}_${crypto.randomUUID().slice(0, 6)}`, name, input }));
  return { textBlocks: ['Je continue.'], stopReason: 'tool_use', toolUses, contentBlocks: [{ type: 'text', text: 'Je continue.' }, ...toolUses.map((u) => ({ type: 'tool_use', ...u }))] };
}

const LON = 2.2068, LAT = 48.892, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
const ring = [[0, 0], [50, 0], [50, 40], [0, 40]].map(([x, y]) => [LON + x / KX, LAT + y / 111_320]);
const PARCELLE = { idu: '92050000AE0414', geometrie: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, surface_m2: 2000, source: 'synthétique (test)' };
const REGLES: RegleConception[] = completerRegles([
  normaliserRegle({ cle: 'recul_limites_m', valeur: 8, source: 'Règlement GPU — 92050_PLU_20251209', article: 'UC 7' }, 'reglement')!,
  normaliserRegle({ cle: 'pleine_terre_min_pct', valeur: 20, source: 'Règlement GPU — 92050_PLU_20251209', article: 'UC 13' }, 'reglement')!,
]);

function missionConception(depot: DepotMissionMemoire, type: 'conception' | 'prospection_fonciere' = 'conception') {
  const devis = calculerDevis({ type, tier: 'sonnet', pireCasEtape: PIRE });
  const id = crypto.randomUUID();
  const cid = crypto.randomUUID();
  const m: MissionRow = {
    id, user_id: USER, projet_id: null, conversation_id: null, origine: 'chat', type, objectif: 'Concevoir sur AE0414', criteres: { idu: '92050000AE0414' },
    statut: 'en_cours', devis, reservation_id: crypto.randomUUID(), jetons_reserves: devis.jetons_max, jetons_consommes: 0, etapes_faites: 0,
    etapes_max: devis.etapes_max, question_en_attente: null, rapport: null, erreur: null, regle_le: null,
    etat: { ...etatInitial(), phase: 'travail', plan: ['3D'], n_etape: 1,
      conception: { id: cid, idu: '92050000AE0414', commune: 'Nanterre', regles: REGLES, parcelle: PARCELLE,
        programme: { nb_logements: 40, typologies: {}, shab_cible_m2: null, sdp_cible_m2: null, gabarit: 'R+4', stationnement: null }, origine_chargee: true } } as never,
  };
  depot.missions.set(id, m);
  depot.conceptions.set(cid, { mission_id: id, user_id: USER, idu: '92050000AE0414' });
  return { id, cid };
}

function deps(depot: DepotMissionMemoire, script: (a: { tools: OutilDef[]; messages: unknown[] }) => Partial<TourLLM>, horloge: { t: number }, outilStudio?: MoteurDeps['outilStudio']) {
  const appelsLLM: Array<{ tools: string[]; messages: unknown[] }> = [];
  const d: MoteurDeps = {
    async executeTool(name) { return { status: 'ok', source: name, data: {} }; },
    async streamLLMTurn(p) {
      horloge.t += 10_000;
      appelsLLM.push({ tools: p.tools.map((t) => t.name), messages: p.messages });
      return { textBlocks: [], contentBlocks: [], toolUses: [], webSearches: 0, stopReason: 'end_turn', inputTokens: 1000, outputTokens: 100, ...script({ tools: p.tools, messages: p.messages }) } as TourLLM;
    },
    debitJetons: () => 4, tierUtilisateur: async () => 'sonnet', modelePourTier: () => 'faux-modele',
    outilsChat: () => [
      { name: 'studio_lancer_rendu', description: '', input_schema: { type: 'object', properties: {} }, available_in_modes: ['report'] },
      { name: 'get_zonage_plu', description: '', input_schema: { type: 'object', properties: {} }, available_in_modes: ['report'] },
    ],
    now: () => horloge.t,
    ...(outilStudio ? { outilStudio } : {}),
  };
  return { d, appelsLLM };
}

function depotStudioMemoire(): DepotStudio & { lignes: unknown[] } {
  const lignes: unknown[] = [];
  const non = async () => { throw new Error('jamais appelé en mission'); };
  return {
    lignes,
    async conception() { return null; }, async derniereVersion() { return null; },
    async enregistrerPreparation(u, l) { lignes.push({ ...l, user_id: u }); return '9b2c0000-0000-4000-8000-000000000001'; },
    async preparation() { return null; }, async typeRenduAutorise() { return null; }, async statsFile() { return null; },
    async travauxActifs() { return 0; }, async travailParDevis() { return null; }, insererTravail: non, async travail() { return null; },
    async positionFile() { return null; }, async urlSigneeRendu() { return null; },
  };
}

Deno.test('E1-M1 : mission de conception — studio_preparer_3d proposé, exécuté sur le dossier en mémoire, rendu jamais proposé', async () => {
  const horloge = { t: Date.parse('2026-11-05T10:00:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  const { id, cid } = missionConception(depot);
  const studio = depotStudioMemoire();
  const contextes: ContexteOutilStudio[] = [];
  let n = 0; let retour = '';
  const { d, appelsLLM } = deps(depot, (a) => {
    n++;
    if (n === 2) retour = JSON.stringify(a.messages);
    if (n === 1) return tourOutils(['studio_preparer_3d', {}]);
    return tourOutils(['terminer_mission', { titre: 'Conception AE0414', synthese: '3D préparée.' }]);
  }, horloge, async (nom, input, c) => {
    contextes.push(c);
    return (await executerOutilStudio(nom, input, { userId: c.userId, depot: studio, secret: null, requete: c.missionId, conversationId: c.conversationId,
      origine: 'https://mimmoza.vercel.app', mission: true, conception: c.conception }))!;
  });
  await tickMissions(d, depot, { worker: 'w' });
  na.ok(appelsLLM[0].tools.includes('studio_preparer_3d'), 'outil proposé en conception');
  na.ok(!appelsLLM.some((a) => a.tools.includes('studio_lancer_rendu')), 'jamais de rendu en mission');
  na.equal(contextes.length, 1);
  na.deepStrictEqual([contextes[0].userId, contextes[0].missionId, contextes[0].conception.id, contextes[0].conception.idu], [USER, id, cid, '92050000AE0414']);
  na.equal(studio.lignes.length, 1);
  na.ok(retour.includes('9b2c0000-0000-4000-8000-000000000001') && retour.includes('batiments'), 'résultat compact rendu au modèle');
  na.ok(depot.journalLignes.some((l) => l.outil === 'studio_preparer_3d'));
});

Deno.test('E1-M2 : sans injection → « indisponible » ; mission de prospection → outil absent et refusé', async () => {
  const horloge = { t: Date.parse('2026-11-05T10:00:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  missionConception(depot);
  let n = 0; let retour = '';
  const { d } = deps(depot, (a) => {
    n++;
    if (n === 2) retour = JSON.stringify(a.messages);
    return n === 1 ? tourOutils(['studio_preparer_3d', {}]) : tourOutils(['terminer_mission', { titre: 'T', synthese: 'S' }]);
  }, horloge);
  await tickMissions(d, depot, { worker: 'w' });
  na.ok(retour.includes('Préparation 3D indisponible'), retour.slice(0, 400));

  const depot2 = new DepotMissionMemoire(() => horloge.t);
  missionConception(depot2, 'prospection_fonciere');
  let m = 0; let retour2 = '';
  const { d: d2, appelsLLM } = deps(depot2, (a) => {
    m++;
    if (m === 2) retour2 = JSON.stringify(a.messages);
    return m === 1 ? tourOutils(['studio_preparer_3d', {}]) : tourOutils(['terminer_mission', { titre: 'T', synthese: 'S' }]);
  }, horloge, async () => { throw new Error('ne doit pas être appelé'); });
  await tickMissions(d2, depot2, { worker: 'w' });
  na.ok(!appelsLLM[0].tools.includes('studio_preparer_3d'));
  na.ok(retour2.includes('réservé aux missions de conception'), retour2.slice(0, 400));
});
