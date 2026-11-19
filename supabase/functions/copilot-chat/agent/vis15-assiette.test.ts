// deno test -A supabase/functions/copilot-chat/agent/vis15-assiette.test.ts
// LOT VIS-15 — parcours chat → projet en 3D (Ascain, 19/11/2026) :
//   1. devis de conception accepté avec la seule assiette (parcel_ids sans idu) ;
//   2. studio_preparer_3d sans conception → phrase claire ; conception ne couvrant pas l'assiette → aucune 3D ;
//   4. assiette groupée de bout en bout : deux parcelles → conception groupée (union, somme des contenances) → 3D sur l'union ;
//      non contiguës → rien d'inventé, question posée ;
//   5. gabarit retenu (R+2) ≠ demandé (R+4) → dit clairement, volume en R+2.
// Moteur réel (tickMissions), faux LLM scripté, cadastre simulé (aucun réseau), outil Studio RÉEL.
import * as na from 'node:assert/strict';
import type { ContexteOutilStudio, DepotMission, EtatMission, MissionRow, MoteurDeps, OutilDef, StatutMission, TourLLM } from './types.ts';
import { STATUTS_FINAUX } from './types.ts';
import { calculerDevis } from './devis.ts';
import { etatInitial, executerOutilAgentChat, tickMissions } from './mission.ts';
import {
  ACTION_PREPARER_3D_CONCEPTION, choisirConception, executerOutilStudio, idusDemandees, messageAssietteNonCouverte, messageSansConception,
  phraseGabaritRetenu, preparer3DDirect, preparerVolume, type ConceptionLue, type DepotStudio,
} from './studio.ts';
import { completerRegles, normaliserRegle, type RegleConception } from './conception.ts';
import { assemblerAssiette, idusDeLaConception, idusDeLaDemande, surfaceCalculeeM2, unionContours, voisinesDeLAssiette } from './assiette.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const USER = '11111111-1111-4111-8111-111111111111';
const PIRE = 10;
const A1 = '64065000AI0001', A2 = '64065000AI0002';

// Contours RÉELS lus en base (agent_conceptions f9ba67c4 / 6fe54f29, API Carto IGN) — arête commune exacte.
const G2 = { type: 'MultiPolygon' as const, coordinates: [[[[-1.62138314,43.34842995],[-1.62115568,43.34818375],[-1.6210962,43.34811961],[-1.62105021,43.34806976],[-1.62101086,43.34802719],[-1.62053462,43.3475121],[-1.62057694,43.34751633],[-1.62065978,43.34751468],[-1.62076856,43.34749912],[-1.62082957,43.34751003],[-1.62086819,43.34752045],[-1.62090609,43.3475419],[-1.62093588,43.34756082],[-1.62096429,43.34758096],[-1.62100377,43.34761432],[-1.62104468,43.3476625],[-1.62117855,43.34785502],[-1.62126076,43.34795613],[-1.62130915,43.34800831],[-1.62135228,43.34805171],[-1.62139705,43.34809422],[-1.621418,43.34812135],[-1.62146652,43.34823498],[-1.62148356,43.34829967],[-1.62138438,43.34842845],[-1.62138314,43.34842995]]]] };
const G1 = { type: 'MultiPolygon' as const, coordinates: [[[[-1.62148356,43.34829967],[-1.62148586,43.34830678],[-1.6214902,43.34832543],[-1.62149271,43.34834434],[-1.62149288,43.34836344],[-1.62149107,43.34838244],[-1.62148715,43.34840126],[-1.62146762,43.34844409],[-1.62138438,43.34842845],[-1.62148356,43.34829967]]]] };
/** AI0001 déplacée de ~400 m : plus aucune limite commune. */
const G1_LOIN = { type: 'MultiPolygon' as const, coordinates: [[G1.coordinates[0][0].map(([x, y]) => [x + 0.005, y])]] };
const VOISINE = { type: 'MultiPolygon' as const, coordinates: [[[[-1.6216, 43.3484], [-1.6215, 43.3484], [-1.6215, 43.3485], [-1.6216, 43.3485], [-1.6216, 43.3484]]]] };

const SOURCE_V = 'API Carto IGN — cadastre';
const contour = (idu: string, g: typeof G1, s: number, voisins: Array<[string, typeof G1]> = []) => ({
  idu, geometrie: g, surface_m2: s, source: 'API Carto IGN — cadastre (contenance cadastrale)',
  voisines: { statut: 'disponibles' as const, source: SOURCE_V, parcelles: voisins.map(([i, gg]) => ({ idu: i, geometrie: gg })) },
});

// ── 4. Assiette : lecture de la demande, union, contrôle des surfaces ────────────────────────────

Deno.test('VIS-15 assiette : parcelles lues dans idu / parcel_ids / « A+B » (dédoublonnées, format contrôlé)', () => {
  na.deepEqual(idusDeLaDemande({ parcel_ids: [A1, A2] }), [A1, A2]);
  na.deepEqual(idusDeLaDemande({ idu: A2, parcel_ids: [A1, A2] }), [A2, A1], 'idu = parcelle principale');
  na.deepEqual(idusDeLaDemande({ parcelles: [{ idu: '64065000ai0001' }, ' 64065000AI 0002 ', '64065000AI00'] }), [A1, A2]);
  na.deepEqual(idusDeLaDemande({ assiette: `${A1}+${A2}` }), [A1, A2]);
  na.deepEqual(idusDeLaDemande({ idu: '93048 000 AJ 0209' }), ['93048000AJ0209'], 'espaces internes : une seule référence');
  na.deepEqual(idusDeLaDemande({ assiette: `${A1} ${A2}` }), [A1, A2]);
  na.deepEqual(idusDeLaDemande({ idu: 'AI0001', parcel_ids: ['n’importe quoi'] }), []);
  // Le modèle avait écrit l'assiette dans conception_id le 19/11 : relue comme parcelles demandées.
  na.deepEqual(idusDemandees({ idu: A1, conception_id: `${A1}+${A2}` }), [A1, A2]);
  na.deepEqual(idusDeLaConception({ idu: A1, parcelle: { assiette: { idus: [A1, A2] } } }), [A1, A2]);
  na.deepEqual(idusDeLaConception({ idu: A1, parcelle: { idu: A1 } }), [A1]);
});

Deno.test('VIS-15 assiette : Ascain AI0001 (66 m²) + AI0002 (2 283 m²) → union d’un seul tenant, surface = somme, contrôle par parcelle', () => {
  const a = assemblerAssiette([contour(A1, G1, 66, [[A2, G2], ['64065000AI0151', VOISINE]]), contour(A2, G2, 2283, [[A1, G1], ['64065000AI0151', VOISINE]])]);
  na.ok(a.ok, JSON.stringify(a));
  if (!a.ok) return;
  const as = a.parcelle.assiette;
  na.deepEqual(as.idus, [A1, A2]);
  na.equal(as.surface_m2, 2349);
  na.equal(a.parcelle.surface_m2, 2349);
  na.equal(a.parcelle.idu, A1);
  na.equal(a.parcelle.geometrie.type, 'MultiPolygon');
  na.equal((a.parcelle.geometrie.coordinates as number[][][][]).length, 1, 'un seul polygone');
  na.equal((a.parcelle.geometrie.coordinates as number[][][][])[0].length, 1, 'sans trou');
  // Union = somme des contours calculés (l'arête commune est retirée, rien n'est perdu ni compté deux fois).
  const somme = surfaceCalculeeM2(G1) + surfaceCalculeeM2(G2);
  na.ok(Math.abs(as.surface_union_calculee_m2 - somme) < 2, `${as.surface_union_calculee_m2} vs ${somme}`);
  na.ok(as.parcelles.every((p) => p.ecart_pct !== null && p.ecart_pct < 10), JSON.stringify(as.parcelles));
  na.match(as.controle.replace(/[\u202f\u00a0]/g, ' '), /Assiette groupée de 2 349 m² = 64065000AI0001 : 66 m²/);
  // Voisines de l'assiette : sans les parcelles de l'assiette, sans doublon.
  na.deepEqual(a.parcelle.voisines?.parcelles.map((v) => v.idu), ['64065000AI0151']);
});

Deno.test('VIS-15 assiette : parcelles non contiguës → rien d’inventé, question « laquelle utiliser »', () => {
  const a = assemblerAssiette([contour(A1, G1_LOIN, 66), contour(A2, G2, 2283)]);
  na.equal(a.ok, false);
  if (a.ok) return;
  na.equal(a.motif, 'non_contigue');
  na.deepEqual(a.groupes, [[A1], [A2]]);
  na.match(a.question, /Sur quelle parcelle .* 64065000AI0001 ou 64065000AI0002 \?/);
});

Deno.test('VIS-15 assiette : jonction en T (sommet du voisin posé au milieu d’une arête) → union d’un seul tenant', () => {
  const k = 1e-4;
  const grand = { type: 'Polygon' as const, coordinates: [[[0, 0], [2 * k, 0], [2 * k, 2 * k], [0, 2 * k], [0, 0]]] };
  const petit = { type: 'Polygon' as const, coordinates: [[[2 * k, 0], [3 * k, 0], [3 * k, k], [2 * k, k], [2 * k, 0]]] };
  const anneaux = unionContours([grand, petit]);
  na.equal(anneaux.length, 1);
  const s = surfaceCalculeeM2({ type: 'Polygon', coordinates: anneaux });
  na.ok(Math.abs(s - (surfaceCalculeeM2(grand) + surfaceCalculeeM2(petit))) < 1);
  // Une seule voisine indisponible → l'assiette n'utilise aucune voisine (jamais une liste incomplète).
  const v = voisinesDeLAssiette([contour(A1, G1, 66), { ...contour(A2, G2, 2283), voisines: { statut: 'indisponibles', source: SOURCE_V, parcelles: [], raison: 'HTTP 503' } }]);
  na.equal(v?.statut, 'indisponibles');
});

// ── 5. Gabarit retenu ≠ demandé ──────────────────────────────────────────────────────────────

Deno.test('VIS-15 gabarit : « R+2 (hauteur 7 m UC) — R+4 incompatible » → phrase claire ; sinon rien', () => {
  na.equal(phraseGabaritRetenu({ gabarit: 'R+2 (hauteur 7 m UC) — R+4 incompatible …' }), 'R+4 demandé, R+2 retenu car hauteur max 7 m en UC — modifiable');
  na.equal(phraseGabaritRetenu({ gabarit: 'R+3 (hauteur ≤ 9 m en UCa, à vérifier se…', gabarit_demande: 'R+4' }), 'R+4 demandé, R+3 retenu car hauteur max 9 m en UCa — modifiable');
  na.equal(phraseGabaritRetenu({ gabarit: 'R+2 — R+4 refusé' }, [{ cle: 'hauteur_max_m', valeur: 7 }]), 'R+4 demandé, R+2 retenu car hauteur max 7 m (règle du PLU) — modifiable');
  na.equal(phraseGabaritRetenu({ gabarit: 'R+4' }), null);
  // Niveaux du VOLUME donnés : la phrase dit ce que montre la 3D.
  na.equal(phraseGabaritRetenu({ gabarit: 'R+2 (hauteur 7 m UC) — R+4 incompatible' }, [], 2), 'R+4 demandé, R+1 retenu dans la 3D car hauteur max 7 m en UC — modifiable');
  na.equal(phraseGabaritRetenu({ gabarit: 'R+4' }, [{ cle: 'hauteur_max_m', valeur: 9 }], 3), 'R+4 demandé, R+2 retenu dans la 3D car hauteur max 9 m (règle du PLU) — modifiable');
  na.equal(phraseGabaritRetenu({ gabarit: 'R+2' }, [], 3), null);
  na.equal(phraseGabaritRetenu({ gabarit: 'R+4 (R+2 en retrait)' }), null, 'un niveau plus bas cité n’est pas un écart');
  na.equal(phraseGabaritRetenu(null), null);
});

// ── 2. studio_preparer_3d : messages clairs, assiette non couverte ───────────────────────────

Deno.test('VIS-15 studio : choix de la conception par parcelle, assiette comprise', () => {
  const lignes = [
    { id: 'c-seule', idu: A1, assiette: null },
    { id: 'c-groupee', idu: A1, assiette: { idus: [A1, A2], surface_m2: 2349 } },
    { id: 'c-a2', idu: A2, assiette: null },
  ];
  na.equal(choisirConception(lignes, [A1, A2]), 'c-groupee');
  na.equal(choisirConception(lignes, [A2]), 'c-groupee', 'la plus récente qui contient AI0002 (assiette)');
  na.equal(choisirConception([lignes[0]], [A1, A2]), 'c-seule', 'à défaut une partielle (preparer3D refusera)');
  na.equal(choisirConception(lignes, ['64065000AI0999']), null);
  na.match(messageSansConception([A1, A2]), /PAS ENCORE DE CONCEPTION pour l’assiette 64065000AI0001 \+ 64065000AI0002.*parcel_ids/);
  na.equal(messageAssietteNonCouverte({ idu: A1, parcelle: { surface_m2: 66 } }, [A1]), null);
  na.match(String(messageAssietteNonCouverte({ idu: A1, parcelle: { idu: A1, surface_m2: 66 } }, [A1, A2])), /AUCUNE 3D PRÉPARÉE : la conception enregistrée porte sur 64065000AI0001 \(66 m²\)/);
});

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

const REGLES: RegleConception[] = completerRegles([
  normaliserRegle({ cle: 'recul_limites_m', valeur: 3, source: 'Règlement GPU — 64065_PLU_20230204', article: 'UC 7' }, 'reglement')!,
  normaliserRegle({ cle: 'emprise_sol_max_pct', valeur: 40, source: 'Règlement GPU — 64065_PLU_20230204', article: 'UC 9' }, 'reglement')!,
  normaliserRegle({ cle: 'hauteur_max_m', valeur: 7, source: 'Règlement GPU — 64065_PLU_20230204', article: 'UC 10' }, 'reglement')!,
]);
const PROGRAMME = { nb_logements: 28, typologies: { T1: 14, T3: 14 }, shab_cible_m2: 2520, sdp_cible_m2: 2800, gabarit: 'R+2 (hauteur 7 m UC) — R+4 incompatible …', stationnement: 45 };

function depotStudioMemoire(conceptions: ConceptionLue[] = []): DepotStudio & { lignes: Array<Record<string, unknown>> } {
  const lignes: Array<Record<string, unknown>> = [];
  const non = async () => { throw new Error('non attendu'); };
  return {
    lignes,
    async conception(_u, q) {
      if (q.id) return conceptions.find((c) => c.id === q.id) ?? null;
      if (q.missionId) return conceptions.find((c) => (c as unknown as { mission_id?: string }).mission_id === q.missionId) ?? null;
      if (q.idu) { const id = choisirConception(conceptions.map((c) => ({ id: c.id, idu: c.idu, assiette: (c.parcelle as { assiette?: unknown } | null)?.assiette ?? null })), [q.idu]); return conceptions.find((c) => c.id === id) ?? null; }
      return conceptions[0] ?? null;
    },
    async derniereVersion() { return null; },
    async enregistrerPreparation(u, l) { lignes.push({ ...l, user_id: u }); return '9b2c0000-0000-4000-8000-0000000000' + String(lignes.length).padStart(2, '0'); },
    async preparation() { return null; }, async typeRenduAutorise() { return null; }, async statsFile() { return null; },
    async travauxActifs() { return 0; }, async travailParDevis() { return null; }, async jetonsDevis() { return []; }, async questionBriefPosee() { return false; }, insererTravail: non, async travail() { return null; },
    async positionFile() { return null; }, async urlSigneeRendu() { return null; },
  } as DepotStudio & { lignes: Array<Record<string, unknown>> };
}

/** Cadastre simulé : contour par numéro de parcelle, voisines par emprise. */
function cadastre(g1: typeof G1) {
  const feature = (idu: string, g: typeof G1, contenance: number) => ({ type: 'Feature', geometry: g, properties: { idu, contenance } });
  return (async (u: string) => {
    const url = new URL(String(u));
    if (!url.href.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle')) throw new Error(`réseau interdit : ${url.href}`);
    if (url.searchParams.get('geom')) return new Response(JSON.stringify({ features: [feature(A1, g1, 66), feature(A2, G2, 2283), feature('64065000AI0151', VOISINE, 500)] }));
    const num = Number(url.searchParams.get('numero'));
    if (num === 1) return new Response(JSON.stringify({ features: [feature(A1, g1, 66)] }));
    if (num === 2) return new Response(JSON.stringify({ features: [feature(A2, G2, 2283)] }));
    return new Response(JSON.stringify({ features: [] }));
  }) as unknown as typeof fetch;
}

function missionAssiette(depot: DepotMissionMemoire, criteres: Record<string, unknown>) {
  const devis = calculerDevis({ type: 'conception', tier: 'sonnet', pireCasEtape: PIRE });
  const id = crypto.randomUUID();
  const m: MissionRow = {
    id, user_id: USER, projet_id: null, conversation_id: null, origine: 'chat', type: 'conception',
    objectif: 'Concevoir un immeuble R+4 de 28 logements sur l’assiette groupée AI0001 + AI0002 à Ascain', criteres,
    statut: 'en_cours', devis, reservation_id: crypto.randomUUID(), jetons_reserves: devis.jetons_max, jetons_consommes: 0, etapes_faites: 0,
    etapes_max: devis.etapes_max, question_en_attente: null, rapport: null, erreur: null, regle_le: null,
    etat: { ...etatInitial(), phase: 'travail', plan: ['parcelle', '3D'], n_etape: 1,
      conception: { id: null, idu: A1, commune: 'Ascain', regles: REGLES, parcelle: null, programme: PROGRAMME, origine_chargee: true } } as never,
  };
  depot.missions.set(id, m);
  return id;
}

Deno.test('VIS-15 bout en bout : devis sans idu (parcel_ids) → mission → conception groupée → 3D sur l’union, écart de gabarit dit', async () => {
  // 1. Devis : l'appel exact du 19/11 (parcel_ids sans idu) est maintenant ACCEPTÉ.
  const crees: Array<Record<string, unknown>> = [];
  const depotChat = { async creerMission(l: Record<string, unknown>) { crees.push(l); return '344c865d-0180-41d1-af19-d874e1ca9ccd'; }, async projetAccessible() { return false; }, async chargerMissionUtilisateur() { return null; } } as unknown as DepotMission;
  const r = await executerOutilAgentChat('proposer_mission', {
    type: 'conception', objectif: 'Concevoir un immeuble collectif R+4 de 28 logements (T1 + T3) sur l’assiette groupée AI0001 + AI0002 à Ascain.',
    criteres: { communes: ['Ascain'], programme: 'collectif_r4', code_insee: '64065', parcel_ids: [A1, A2], nb_logements: 28 },
  }, {}, USER, { debitJetons: () => 4, tierUtilisateur: async () => 'sonnet' }, depotChat);
  na.equal(r?.status, 'ok', JSON.stringify(r));
  const criteres = crees[0].criteres as Record<string, unknown>;
  na.equal(criteres.idu, A1);
  na.deepEqual(criteres.parcel_ids, [A1, A2]);
  // Sans aucune parcelle : message qui nomme les deux formes possibles.
  const ko = await executerOutilAgentChat('proposer_mission', { type: 'conception', objectif: 'x', criteres: { communes: ['Ascain'] } }, {}, USER, { debitJetons: () => 4, tierUtilisateur: async () => 'sonnet' }, depotChat);
  na.match(String(ko?.message), /criteres\.idu .* ou criteres\.parcel_ids/);

  // 2. Mission : recuperer_parcelle lit les DEUX parcelles et enregistre l'union ; studio_preparer_3d la construit.
  const horloge = { t: Date.parse('2026-11-19T16:55:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  const id = missionAssiette(depot, criteres);
  const studio = depotStudioMemoire();
  const contextes: ContexteOutilStudio[] = [];
  let n = 0; let retours = '';
  const { d } = deps(depot, (a) => {
    n++;
    retours = JSON.stringify(a.messages);
    if (n === 1) return tourOutils(['recuperer_parcelle', { idu: A2 }]);   // la 2e parcelle n'est plus refusée
    if (n === 2) return tourOutils(['studio_preparer_3d', {}]);
    return tourOutils(['terminer_mission', { titre: 'Conception Ascain', synthese: 'Assiette groupée, 3D préparée.' }]);
  }, horloge, async (nom, input, c) => {
    contextes.push(c);
    return (await executerOutilStudio(nom, input, { userId: c.userId, depot: studio, secret: null, requete: c.missionId, conversationId: c.conversationId,
      origine: 'https://mimmoza.vercel.app', mission: true, conception: c.conception }))!;
  });
  d.fetch = cadastre(G1);
  await tickMissions(d, depot, { worker: 'w' });
  const conception = [...depot.conceptions.values()][0] as { idu: string; parcelle: { surface_m2: number; assiette: { idus: string[]; surface_m2: number } } };
  na.equal(conception.idu, A1);
  na.deepEqual(conception.parcelle.assiette.idus, [A1, A2]);
  na.equal(conception.parcelle.surface_m2, 2349, 'surface = somme des contenances, pas 66 m²');
  na.ok(retours.includes('ASSIETTE GROUPÉE') || retours.includes('assiette'), 'le modèle est informé de l’assiette');
  na.equal(contextes.length, 1);
  na.equal(studio.lignes.length, 1);
  const prep = studio.lignes[0] as { entree: { parcelle: { geometrie: { coordinates: number[][][][] } } }; resume: { surface_parcelle_m2: number; niveaux: number; gabarit_retenu?: string; assiette?: string; alertes: string[] } };
  na.equal(prep.entree.parcelle.geometrie.coordinates.length, 1, 'une seule emprise : l’union');
  na.ok(prep.resume.surface_parcelle_m2 > 2300, `volume sur l’union (${prep.resume.surface_parcelle_m2} m²), jamais sur 66 m²`);
  // Le moteur compte la hauteur acrotère compris : sous 7 m, il place R+1 (6 m), pas R+2 — et la carte le DIT.
  na.equal(prep.resume.niveaux, 2, 'jamais au-dessus du gabarit retenu (R+2) ni de la hauteur max');
  na.equal(prep.resume.gabarit_retenu, 'R+4 demandé, R+1 retenu dans la 3D car hauteur max 7 m en UC — modifiable');
  na.equal(prep.resume.alertes[0], prep.resume.gabarit_retenu);
  na.equal(String(prep.resume.assiette).replace(/[\u202f\u00a0]/g, ' '), 'AI0001 + AI0002 (2 349 m²)');
  na.equal(depot.missions.get(id)!.statut, 'terminee');

  // 3. « Ouvrir mon projet en 3D » (action directe, sans LLM) : conception de la mission, parcelles contrôlées.
  const c = { id: '7a000000-0000-4000-8000-000000000001', mission_id: id, idu: A1, commune: 'Ascain', parcelle: conception.parcelle, regles_plu: REGLES, programme: PROGRAMME } as unknown as ConceptionLue;
  const studio2 = depotStudioMemoire([c]);
  const env = { userId: USER, depot: studio2, secret: null, requete: 'r', conversationId: null, origine: 'https://mimmoza.vercel.app' };
  const direct = await preparer3DDirect({ action: ACTION_PREPARER_3D_CONCEPTION, mission_id: id, parcel_ids: [A1, A2] }, env);
  na.equal(direct.status, 'ok', JSON.stringify(direct).slice(0, 400));
  const data = direct.data as Record<string, unknown>;
  na.equal(data.gabarit_retenu, 'R+4 demandé, R+1 retenu dans la 3D car hauteur max 7 m en UC — modifiable');
  na.equal(String(data.assiette).replace(/[\u202f\u00a0]/g, ' '), 'AI0001 + AI0002 (2 349 m²)');
  na.match(String(direct.message), /^GABARIT : écris tel quel « R\+4 demandé, R\+1 retenu dans la 3D/);
  na.equal((await preparer3DDirect({ action: ACTION_PREPARER_3D_CONCEPTION }, env)).status, 'error');
});

Deno.test('VIS-15 bout en bout : parcelles non contiguës → assiette NON enregistrée, question posée, aucune 3D', async () => {
  const horloge = { t: Date.parse('2026-11-19T16:55:00Z') };
  const depot = new DepotMissionMemoire(() => horloge.t);
  missionAssiette(depot, { idu: A1, parcel_ids: [A1, A2] });
  let n = 0; let retour = '';
  const { d } = deps(depot, (a) => {
    n++;
    if (n === 2) retour = JSON.stringify(a.messages);
    return n === 1 ? tourOutils(['recuperer_parcelle', { idu: A1 }]) : tourOutils(['terminer_mission', { titre: 'T', synthese: 'S' }]);
  }, horloge);
  d.fetch = cadastre(G1_LOIN);
  await tickMissions(d, depot, { worker: 'w' });
  na.ok(retour.includes('ASSIETTE NON ENREGISTRÉE') && retour.includes('Sur quelle parcelle'), retour.slice(0, 600));
  na.equal([...depot.conceptions.values()].filter((c) => (c as { parcelle?: unknown }).parcelle).length, 0, 'aucune parcelle inventée');
});

Deno.test('VIS-15 bout en bout : 3D demandée sur l’assiette alors que la conception ne porte que sur AI0001 (66 m²) → refus clair', async () => {
  const seule = { id: 'f9ba67c4-059c-415c-8f61-5779bf0efef0', idu: A1, commune: null, parcelle: { idu: A1, geometrie: G1, surface_m2: 66, source: 'IGN' }, regles_plu: REGLES, programme: PROGRAMME } as unknown as ConceptionLue;
  const studio = depotStudioMemoire([seule]);
  const env = { userId: USER, depot: studio, secret: null, requete: 'r', conversationId: null, origine: 'https://mimmoza.vercel.app' };
  const r = await executerOutilStudio('studio_preparer_3d', { idu: A1, conception_id: `${A1}+${A2}` }, env);
  na.equal(r?.status, 'partial');
  na.match(String(r?.message), /AUCUNE 3D PRÉPARÉE : la conception enregistrée porte sur 64065000AI0001 \(66 m²\), pas sur l’assiette groupée/);
  na.equal(studio.lignes.length, 0, 'aucun volume sur 66 m²');
  const vide = await executerOutilStudio('studio_preparer_3d', { idu: A1, parcel_ids: [A1, A2] }, { ...env, depot: depotStudioMemoire([]) });
  na.equal(vide?.status, 'not_found');
  na.match(String(vide?.message), /^PAS ENCORE DE CONCEPTION pour l’assiette/);
});

Deno.test('VIS-15 : preparerVolume sur une conception groupée travaille sur l’union', async () => {
  const a = assemblerAssiette([contour(A1, G1, 66), contour(A2, G2, 2283)]);
  na.ok(a.ok);
  if (!a.ok) return;
  const p = await preparerVolume({ id: 'c', idu: A1, commune: 'Ascain', parcelle: a.parcelle, regles_plu: REGLES, programme: PROGRAMME });
  na.ok(p.ok, JSON.stringify(p).slice(0, 300));
  if (!p.ok) return;
  na.ok(p.resume.surface_parcelle_m2 > 2300);
  const seule = await preparerVolume({ id: 'c', idu: A1, commune: 'Ascain', parcelle: { idu: A1, geometrie: G1, surface_m2: 66, source: 'IGN' }, regles_plu: REGLES, programme: PROGRAMME });
  na.ok(!seule.ok || seule.resume.surface_parcelle_m2 < 100, 'contrôle : une seule parcelle reste à 66 m²');
});
