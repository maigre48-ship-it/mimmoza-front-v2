// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/constat-volume.test.ts
// Lot C11 — le rapport d'une mission de conception ne conclut pas à la place des données.
//   · constat-volume.ts (pur) : constat chiffré, retrait des jugements sur la parcelle ou le programme ;
//   · mission.ts : constat gardé après studio_preparer_3d, consigne en tête du résultat, rapport nettoyé ;
//   · enregistrer_regles_conception : le message ne dit plus « statut estime » pour des règles restées confirmées.
// Le montage (dépôt en mémoire, faux LLM scripté, outil Studio réel) est repris de studio-mission.test.ts.
import * as na from 'node:assert/strict';
import type { ContexteOutilStudio, DepotMission, EtatMission, MissionRow, MoteurDeps, OutilDef, StatutMission, TourLLM } from './types.ts';
import { STATUTS_FINAUX } from './types.ts';
import { calculerDevis } from './devis.ts';
import { etatInitial, normaliserRapport, tickMissions } from './mission.ts';
import { appliquerConstatAuRapport, CONSIGNE_PROGRAMME_NON_ATTEINT, estJugement, lireConstatVolume, neutraliserJugements, phraseConstat } from './constat-volume.ts';
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
    async travauxActifs() { return 0; }, async travailParDevis() { return null; }, async jetonsDevis() { return []; }, async questionBriefPosee() { return false; }, insererTravail: non, async travail() { return null; },
    async positionFile() { return null; }, async urlSigneeRendu() { return null; },
  };
}

// Phrases du rapport réel du 10/11/2026 (mission de 17 h 01, Montreuil).
const LIMITE_REELLE = 'Programme 30 logements non atteint sur 804 m² : le moteur 3D plafonne à 7 logements (R+2, SDP 527 m²). La parcelle est probablement sous-dimensionnée pour ce programme.';
const VOLUME_7 = { batiments: 1, formes: ['plot'], gabarit: 'R+2', hauteur_indicative_m: 9, emprise_batie_m2: 176, emprise_pct: 21.5, sdp_estimee_m2: 527,
  logements_places: 7, logements_vises: 30, programme_atteint: false, alertes: ['30 logements : programme non atteint — 7 logements au plus (3 niveaux, 1 bâtiment, dans la bande principale).'],
  recul_applique_m: 4.5, implantation: 'Recul de 4,5 m sur toutes les limites, côté voie compris : le plus fort des reculs PLU (recul à la voie et reculs aux limites non différenciés).',
  plafonds: ['Emprise au sol : 175,5 m² dans la bande principale (21,5 % de la parcelle) pour 368 m² max. dans la bande principale (80 % de la bande de 18 m)', 'Niveaux : 3 niveaux (R+2) pour 6 niveaux max.'] };

Deno.test('C11-R1 : estJugement — les jugements sur la parcelle ou le programme sont reconnus, les constats ne le sont pas', () => {
  for (const s of ['La parcelle est probablement sous-dimensionnée pour ce programme.', 'Le terrain est trop petit pour 30 logements.', 'Le programme semble trop ambitieux au regard du PLU.',
    'La surface de la parcelle est insuffisante.', 'La parcelle ne permet pas d’atteindre 30 logements.', 'Programme surdimensionné.', 'Il faudrait une parcelle plus grande.', 'Parcelle sous dimensionnee pour le projet']) na.equal(estJugement(s), true, s);
  for (const s of ['Parcelle de 804 m².', '7 logements placés sur 30 demandés.', 'Surface de pleine terre insuffisante : 12 % pour 15 %.', 'Le recul H/2 ne permet pas plus de 3 niveaux.',
    'Programme 30 logements non atteint sur 804 m² : le moteur 3D plafonne à 7 logements (R+2, SDP 527 m²).', 'Le stationnement est insuffisant : 10 places pour 15 requises.',
    'La parcelle est en zone UC91Jb2.', 'Bande principale de 18 m : 461 m².']) na.equal(estJugement(s), false, s);
});

Deno.test('C11-R2 : neutraliserJugements — seule la phrase de jugement est retirée ; le constat chiffré de la même limite reste', () => {
  const n = neutraliserJugements(LIMITE_REELLE);
  na.equal(n.texte, 'Programme 30 logements non atteint sur 804 m² : le moteur 3D plafonne à 7 logements (R+2, SDP 527 m²).');
  na.deepEqual(n.retires, ['La parcelle est probablement sous-dimensionnée pour ce programme.']);
  // Texte sans jugement : rendu à l'identique (même objet de texte, espaces compris).
  const intact = 'Règles lues : 8 sur 9.  Mixité sociale : non trouvée.\nStationnement : 0,5 place par logement.';
  na.deepEqual(neutraliserJugements(intact), { texte: intact, retires: [] });
  // Liste à puces : la ligne de jugement part, les autres restent.
  const liste = '- 7 logements placés.\n- Le terrain est trop petit pour ce programme.\n- Recul de 4,5 m.';
  na.equal(neutraliserJugements(liste).texte, '- 7 logements placés.\n- Recul de 4,5 m.');
  na.deepEqual(neutraliserJugements(''), { texte: '', retires: [] });
});

Deno.test('C11-R3 : phraseConstat — demandé, placé, emprise, niveaux, plafonds, implantation et cause du moteur ; rien si le programme est atteint', () => {
  const c = lireConstatVolume(VOLUME_7)!;
  const p = phraseConstat(c)!;
  na.equal(p, 'Volume d’étude : 30 logements demandés, 7 logements placés par le moteur (1 bâtiment, R+2, 176 m² d’emprise (21,5 % de la parcelle), 527 m² de SDP estimée). ' +
    'Plafonds opposés au volume : Emprise au sol : 175,5 m² dans la bande principale (21,5 % de la parcelle) pour 368 m² max. dans la bande principale (80 % de la bande de 18 m) ; Niveaux : 3 niveaux (R+2) pour 6 niveaux max. ' +
    'Implantation retenue par le moteur : Recul de 4,5 m sur toutes les limites, côté voie compris : le plus fort des reculs PLU (recul à la voie et reculs aux limites non différenciés). ' +
    'Cause donnée par le moteur : 30 logements : programme non atteint — 7 logements au plus (3 niveaux, 1 bâtiment, dans la bande principale). ' +
    'Ces chiffres sont ceux du volume d’étude avec ses hypothèses (reculs, emprise, 3 m par étage, 70 m² de SDP par logement) : ils ne mesurent pas la capacité de la parcelle.');
  na.equal(estJugement(p), false, 'le constat lui-même ne porte aucun jugement');
  na.equal(phraseConstat(lireConstatVolume({ ...VOLUME_7, logements_places: 30, programme_atteint: true })), null);
  na.equal(phraseConstat(lireConstatVolume({ ...VOLUME_7, programme_atteint: null })), null);
  na.equal(phraseConstat(null), null);
  na.equal(lireConstatVolume({ message: 'échec' }), null);
  na.equal(lireConstatVolume('texte'), null);
});

Deno.test('C11-R4 : appliquerConstatAuRapport — programme non atteint : jugements retirés de la synthèse et des limites, constat ajouté une seule fois ; programme atteint : rapport intact', () => {
  const rapport: Record<string, unknown> = { synthese: 'Dossier prêt. La parcelle est probablement sous-dimensionnée pour ce programme. Huit règles lues.', limites: [LIMITE_REELLE, 'Le terrain est trop petit.', 'Mixité sociale non lue.'] };
  const retires = appliquerConstatAuRapport(rapport, lireConstatVolume(VOLUME_7));
  na.equal(retires.length, 3);
  na.equal(rapport.synthese, 'Dossier prêt. Huit règles lues.');
  const limites = rapport.limites as string[];
  na.equal(limites.length, 3, 'la limite réduite à un jugement disparaît, le constat est ajouté');
  na.equal(limites[0], 'Programme 30 logements non atteint sur 804 m² : le moteur 3D plafonne à 7 logements (R+2, SDP 527 m²).');
  na.equal(limites[1], 'Mixité sociale non lue.');
  na.match(limites[2], /^Volume d’étude : 30 logements demandés, 7 logements placés par le moteur/);
  na.ok(!limites.some(estJugement) && !estJugement(String(rapport.synthese)));
  // Deuxième passage : rien de plus (le constat n'est pas doublé).
  appliquerConstatAuRapport(rapport, lireConstatVolume(VOLUME_7));
  na.equal((rapport.limites as string[]).length, 3);
  // Programme atteint, ou aucun volume préparé : le rapport du modèle n'est pas touché.
  for (const constat of [lireConstatVolume({ ...VOLUME_7, logements_places: 30, programme_atteint: true }), null]) {
    const r: Record<string, unknown> = { synthese: 'S. Le terrain est trop petit.', limites: ['Le terrain est trop petit.'] };
    na.deepEqual(appliquerConstatAuRapport(r, constat), []);
    na.deepEqual(r, { synthese: 'S. Le terrain est trop petit.', limites: ['Le terrain est trop petit.'] });
  }
});

Deno.test('C11-R5 : mission complète — programme non atteint : consigne en tête du résultat de l’outil, puis rapport sans jugement et avec le constat du moteur', async () => {
  const horloge = { t: Date.parse('2026-11-10T17:01:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  const { id } = missionConception(depot);
  // 400 logements demandés sur 2 000 m² avec un recul de 8 m : le volume d'étude ne les loge pas.
  const m0 = depot.missions.get(id)!;
  ((m0.etat as unknown as { conception: { programme: { nb_logements: number } } }).conception.programme).nb_logements = 400;
  const studio = depotStudioMemoire();
  let n = 0; let retour = '';
  const { d } = deps(depot, (a) => {
    n++;
    if (n === 2) retour = JSON.stringify(a.messages);
    if (n === 1) return tourOutils(['studio_preparer_3d', {}]);
    return tourOutils(['terminer_mission', { titre: 'Conception AE0414', synthese: '3D préparée. La parcelle est probablement sous-dimensionnée pour ce programme.',
      limites: ['Programme 400 logements non atteint : le moteur 3D plafonne. La parcelle est probablement sous-dimensionnée pour ce programme.', 'Stationnement non lu.'] }]);
  }, horloge, async (nom, input, c) => (await executerOutilStudio(nom, input, { userId: c.userId, depot: studio, secret: null, requete: c.missionId, conversationId: c.conversationId,
    origine: 'https://mimmoza.vercel.app', mission: true, conception: c.conception }))!);
  await tickMissions(d, depot, { worker: 'w' });
  // 1. Le modèle a reçu la consigne, placée en tête du résultat (avant les données, qui peuvent être coupées).
  na.ok(retour.includes('consigne_rapport'), retour.slice(0, 600));
  na.ok(retour.indexOf('consigne_rapport') < retour.indexOf('preparation_id'), 'consigne avant les données');
  na.ok(retour.includes('N’écris AUCUN jugement sur la parcelle ou le programme'));
  na.ok(CONSIGNE_PROGRAMME_NON_ATTEINT.length < 520);
  // 2. Le constat est gardé dans l'état de la mission.
  const m = depot.missions.get(id)!;
  const rapport = m.rapport as Record<string, unknown>;
  na.ok(rapport, `mission ${m.statut} sans rapport`);
  // 3. Rapport final : plus de jugement, constat chiffré du moteur dans les limites, le reste intact.
  const limites = rapport.limites as string[];
  na.equal(rapport.synthese, '3D préparée.');
  na.ok(limites.includes('Programme 400 logements non atteint : le moteur 3D plafonne.'), JSON.stringify(limites));
  na.ok(limites.includes('Stationnement non lu.'));
  const constat = limites.find((l) => l.startsWith('Volume d’étude : 400 logements demandés, '));
  na.ok(constat, JSON.stringify(limites));
  // Chiffres du moteur pour cette parcelle d'essai (50 × 40 m, recul de 8 m, gabarit R+4) ; aucun plafond PLU d'emprise ou de hauteur n'y est lu.
  na.equal(constat, 'Volume d’étude : 400 logements demandés, 38 logements placés par le moteur (1 bâtiment, R+4, 544 m² d’emprise (27,2 % de la parcelle), 2\u202f720 m² de SDP estimée). ' +
    'Implantation retenue par le moteur : Recul de 8 m sur toutes les limites : le plus fort des reculs PLU (côté voie non identifié). ' +
    'Cause donnée par le moteur : 400 logements : programme non atteint — 38 logements au plus (5 niveaux, 1 bâtiment). ' +
    'Ces chiffres sont ceux du volume d’étude avec ses hypothèses (reculs, emprise, 3 m par étage, 70 m² de SDP par logement) : ils ne mesurent pas la capacité de la parcelle.');
  na.ok(!JSON.stringify(rapport).includes('sous-dimensionnée'));
});

Deno.test('C11-R6 : mission complète — programme atteint : aucune consigne, rapport du modèle laissé tel quel', async () => {
  const horloge = { t: Date.parse('2026-11-10T17:01:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  const { id } = missionConception(depot);
  const m0 = depot.missions.get(id)!;
  ((m0.etat as unknown as { conception: { programme: { nb_logements: number } } }).conception.programme).nb_logements = 4;
  const studio = depotStudioMemoire();
  let n = 0; let retour = '';
  const { d } = deps(depot, (a) => {
    n++;
    if (n === 2) retour = JSON.stringify(a.messages);
    if (n === 1) return tourOutils(['studio_preparer_3d', {}]);
    return tourOutils(['terminer_mission', { titre: 'T', synthese: '3D préparée : 4 logements placés.', limites: ['Stationnement non lu.'] }]);
  }, horloge, async (nom, input, c) => (await executerOutilStudio(nom, input, { userId: c.userId, depot: studio, secret: null, requete: c.missionId, conversationId: c.conversationId,
    origine: 'https://mimmoza.vercel.app', mission: true, conception: c.conception }))!);
  await tickMissions(d, depot, { worker: 'w' });
  na.ok(retour.includes('programme_atteint\\":true') || retour.includes('"programme_atteint":true'), retour.slice(0, 900));
  na.ok(!retour.includes('consigne_rapport'));
  const rapport = depot.missions.get(id)!.rapport as Record<string, unknown>;
  na.equal(rapport.synthese, '3D préparée : 4 logements placés.');
  na.ok(!(rapport.limites as string[]).some((l) => l.startsWith('Volume d’étude :')));
  na.ok((rapport.limites as string[]).includes('Stationnement non lu.'));
});

Deno.test('C11-R7 : enregistrer_regles_conception — le message dit ce qui est réellement écrit : une règle déjà confirmée n’est pas annoncée « au statut estime »', async () => {
  const horloge = { t: Date.parse('2026-11-10T17:01:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  const { id } = missionConception(depot);   // recul_limites_m et pleine_terre_min_pct : confirmées, lues dans le règlement avec leur article
  let n = 0; let retour = '';
  const { d } = deps(depot, (a) => {
    n++;
    if (n === 2) retour = JSON.stringify(a.messages);
    if (n === 1) return tourOutils(['enregistrer_regles_conception', { regles: [
      { cle: 'recul_limites_m', valeur: 8, source: 'synthèse du modèle' },
      { cle: 'pleine_terre_min_pct', valeur: 20, source: 'synthèse du modèle' },
      { cle: 'hauteur_max_m', valeur: 15, source: 'synthèse du modèle' },
    ] }]);
    return tourOutils(['terminer_mission', { titre: 'T', synthese: 'S' }]);
  }, horloge);
  await tickMissions(d, depot, { worker: 'w' });
  na.ok(retour.includes('Règles enregistrées au statut « estime » : 1 (hauteur_max_m)'), retour.slice(-1800));
  na.ok(retour.includes('NON remplacées, car déjà enregistrées avec une source plus sûre : recul_limites_m (confirmée, Règlement GPU — 92050_PLU_20251209) ; pleine_terre_min_pct (confirmée, Règlement GPU — 92050_PLU_20251209)'), retour.slice(-1800));
  na.ok(retour.includes('leur statut ne change pas, ne les présente pas comme estimées'));
  // Les règles confirmées le sont restées dans le dossier de la mission.
  const k = (depot.missions.get(id)!.etat as unknown as { conception: { regles: Array<{ cle: string; statut: string }> } }).conception.regles;
  na.deepEqual(['recul_limites_m', 'pleine_terre_min_pct', 'hauteur_max_m'].map((c) => k.find((r) => r.cle === c)!.statut), ['confirme', 'confirme', 'estime']);
});

Deno.test('C11-R8 : normaliserRapport sans volume préparé (mission ancienne, ou outil indisponible) — aucun retrait, aucun ajout', () => {
  const m = { id: 'm', user_id: USER, type: 'conception', objectif: 'o', criteres: { idu: '92050000AE0414' } } as unknown as MissionRow;
  const etat = { ...etatInitial(), conception: { id: 'c', idu: '92050000AE0414', commune: 'Nanterre', regles: REGLES, parcelle: PARCELLE, programme: null, origine_chargee: true } } as never;
  const r = normaliserRapport({ titre: 'T', synthese: 'Le terrain est trop petit.', limites: ['Le terrain est trop petit.'] }, etat, 0, [], m);
  na.equal(r.synthese, 'Le terrain est trop petit.');
  na.ok((r.limites as string[]).includes('Le terrain est trop petit.'));
  na.ok(!(r.limites as string[]).some((l) => l.startsWith('Volume d’étude :')));
});
