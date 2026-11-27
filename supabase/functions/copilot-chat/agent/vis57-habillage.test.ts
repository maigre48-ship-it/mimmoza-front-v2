// supabase/functions/copilot-chat/agent/vis57-habillage.test.ts
// VIS-57 — « Habiller le projet » avant le rendu (garde du serveur, rappel, fiche), aménagement extérieur transmis,
// vraie cause d'un échec, durée de l'état de la machine de rendu. Même base en mémoire que vis46-films-chat.test.ts.
import * as na from 'node:assert/strict';
import { executerOutilDessinerBatiment } from './dessin-batiment.ts';
import { etatMachine, executerOutilStudio, plusRecente, studioPertinent, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue } from './studio.ts';
import { executerOutilProposerFilm, type DepotFilms } from './studio-films.ts';
import { empreinteModele, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { messageReproduireModele, referenceModeleDuMessage } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { descriptionDuMessage } from '../../../../src/lib/studio/descriptionBatiment.ts';
import { type ScenarioFilm } from '../../../../src/lib/studio/scenarioFilm.ts';
import { lireBlocScenario, messageScenario } from '../../../../src/lib/studio/filmsChat.ts';
import { messageHabillageTermine, paramsTraceHabillage, type ThemeHabillage, type ModeTheme } from '../../../../src/lib/studio/habillageProjet.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url)));
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '0113d281-835a-43af-9442-da7d4608c0a7';

type Travail = { id: string; user_id: string; conversation_id: string; type: string; statut: string; fiche: Record<string, unknown>; options: Record<string, unknown>; cree_le: string };

/** Base en mémoire : préparations, messages, sorties d'outils, travaux ; `scenarioAccepte` simule la migration. */
function base(o: { scenarioAccepte: boolean | null; refusInsertionScenario?: boolean; sansHabillage?: boolean; panneHabillage?: boolean } = { scenarioAccepte: true }) {
  const habillage: Record<string, unknown>[] = [];
  const causes: Record<string, string> = {};
  const lus: Record<string, unknown>[] = [];
  const lignes: (PreparationLue & { ordre: number })[] = [];
  const messages: { texte: string; cree_le: string }[] = [];
  const sortiesModele: unknown[] = [];
  const sortiesFilm: Record<string, unknown>[] = [];
  const travaux: Travail[] = [];
  const controles: Record<string, unknown>[] = [];
  let ordre = 0;
  const depot = {
    conception: () => Promise.resolve(structuredClone(FX.conception) as ConceptionLue),
    derniereVersion: () => Promise.resolve(null),
    enregistrerPreparation: (_u: string, l: PreparationLue) => {
      const deja = lignes.find((x) => x.empreinte === l.empreinte);
      if (deja) { deja.conversation_id = l.conversation_id; deja.ordre = ++ordre; return Promise.resolve(deja.id); }
      const id = `9b000000-0000-4000-8000-${String(lignes.length + 1).padStart(12, '0')}`;
      lignes.push({ ...structuredClone(l), id, ordre: ++ordre });
      return Promise.resolve(id);
    },
    preparation: (_u: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }) => {
      const tri = [...lignes].sort((a, b) => b.ordre - a.ordre);
      return Promise.resolve((q.id ? tri.find((x) => x.id === q.id) : q.conceptionId ? tri.find((x) => x.conception_id === q.conceptionId) : tri.find((x) => x.conversation_id === q.conversationId)) ?? null);
    },
    briefsMessages: () => Promise.resolve([...messages].reverse().filter((m) => m.texte.includes('```mimmoza-brief'))),
    sortiesModele: () => Promise.resolve([...sortiesModele].reverse()),
    sortiesExtension: () => Promise.resolve([]), sortiesMaison: () => Promise.resolve([]), dernierParcours: () => Promise.resolve(null),
    typeRenduAutorise: (type: string, opts: Record<string, unknown>) => { controles.push(opts); return Promise.resolve(type === 'film' && 'scenario' in opts ? o.scenarioAccepte : true); },
    statsFile: () => Promise.resolve({ attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null }),
    travauxActifs: (u: string) => Promise.resolve(travaux.filter((t) => t.user_id === u && t.statut === 'en_attente').length),
    travailParDevis: (u: string, d: string) => Promise.resolve(travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null),
    jetonsDevis: () => Promise.resolve([]),
    questionBriefPosee: () => Promise.resolve(true),
    insererTravail: (u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) => {
      if (o.refusInsertionScenario && 'scenario' in l.options) return Promise.reject(new Error('Options du travail invalides pour le type film'));
      const t: Travail = { id: crypto.randomUUID(), user_id: u, statut: 'en_attente', cree_le: new Date().toISOString(), ...structuredClone(l) };
      travaux.push(t);
      return Promise.resolve({ ...t, progression: 0, etape: null, resultat: null, elements_omis: [], erreur: null, demarre_le: null, termine_le: null });
    },
    positionFile: () => Promise.resolve(0),
    urlSigneeRendu: () => Promise.resolve(null),
    ...(o.sansHabillage ? {} : { habillageTraces: () => Promise.resolve(o.panneHabillage ? null : [...habillage].reverse()) }),
    causeEchec: (id: string) => Promise.resolve(causes[id] ?? null),
    travail: (_u: string, q: { id?: string }) => Promise.resolve(lus.find((t) => t.id === q.id) ?? null),
  } as unknown as DepotStudio;
  const depotFilms: DepotFilms = {
    sortiesFilm: () => Promise.resolve([...sortiesFilm].reverse()),
    scenariosMessages: () => Promise.resolve([...messages].reverse().filter((m) => m.texte.includes('```mimmoza-scenario'))),
  };
  const env = (plus: Partial<EnvStudio> = {}): EnvStudio => ({ userId: USER, depot, depotFilms, secret: 's', requete: crypto.randomUUID(), conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...plus });
  const envFilms = (plus: { scenarioCarte?: EnvStudio['scenarioCarte'] } = {}) => ({ userId: USER, conversationId: CONV, depot, depotFilms, ...plus });
  return { depot, depotFilms, env, envFilms, lignes, messages, sortiesModele, sortiesFilm, travaux, controles, habillage, causes, lus };
}

/** Dessin de la maison hexagonale + « Reproduire en 3D » (cas réel VIS-34). */
async function maisonHexagonale(b: ReturnType<typeof base>): Promise<ModeleBatiment> {
  const s = executerOutilDessinerBatiment(structuredClone(FX.dessin), { photoAuTour: false });
  na.equal(s.status, 'ok', s.message);
  b.sortiesModele.push(s);
  const m = (s.data as { modele: ModeleBatiment }).modele;
  const texte = messageReproduireModele(m, empreinteModele(m));
  b.messages.push({ texte, cree_le: new Date(Date.UTC(2026, 10, 25, 9, 0, b.messages.length)).toISOString() });
  const r = await executerOutilStudio('studio_preparer_3d', {}, b.env({ batimentCarte: descriptionDuMessage(texte), modeleCarte: referenceModeleDuMessage(texte) }));
  ok(r && r.status === 'ok', JSON.stringify(r?.message));
  return m;
}

/** Le site enregistre la sortie de l'outil EN FIN de requête (copilot_tool_calls). */
async function proposer(b: ReturnType<typeof base>, input: Record<string, unknown> = {}, plus: { scenarioCarte?: EnvStudio['scenarioCarte'] } = {}) {
  const r = await executerOutilProposerFilm(input, b.envFilms(plus));
  if (r.status === 'ok' && r.data) b.sortiesFilm.push(r.data);
  return r;
}
const props = (r: { data?: Record<string, unknown> }) => (r.data!.propositions as ScenarioFilm[]);

const AMENAGEMENT = {
  format: 'mimmozia.amenagement-exterieur', version: 1, pris: true, densite: null, contexteHorsParcelle: true, parcelleRef: [], compteur: 3,
  elements: [
    { id: 'e1', famille: 'arbre', modele: 'island_tree_01', hauteurM: 5, position: { x: 2, z: 3 } },
    { id: 'e2', famille: 'arbre', modele: 'island_tree_01', hauteurM: 5, position: { x: 6, z: 3 } },
    { id: 'e3', famille: 'haie', modele: 'haie_charmille', hauteurM: 1.6, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] },
  ],
};
function choisir(b: ReturnType<typeof base>, theme: ThemeHabillage, mode: ModeTheme, minute: number, amenagement: Record<string, unknown> | null = null) {
  b.habillage.push(paramsTraceHabillage(theme, mode, { resume: mode === 'choisi' && theme !== 'exterieur' ? 'réglé dans le Studio' : null, amenagement, le: new Date(Date.UTC(2026, 10, 26, 22, minute)).toISOString() }));
}
async function clicFilm(b: ReturnType<typeof base>) {
  await maisonHexagonale(b);
  const s = props(await proposer(b))[0];
  const texte = messageScenario('lancer', s, 1);
  b.messages.push({ texte, cree_le: new Date(Date.UTC(2026, 10, 26, 23, 0, 0)).toISOString() });
  return executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
}

Deno.test('GARDE — clic « Valider et lancer le film » sans habillage : AUCUN devis, AUCUN travail, carte « Habiller le projet »', async () => {
  const b = base({ scenarioAccepte: true });
  const r = await clicFilm(b);
  eq(r?.status, 'partial', r?.message);
  eq(b.travaux.length, 0, 'rien n’est lancé');
  const d = r!.data as Record<string, unknown>;
  eq(d.habillage_requis, true); eq(d.carte, 'habillage_projet'); eq(d.type, 'film');
  eq(d.manquants, ['matieres', 'deco', 'exterieur']);
  ok(/AUCUN DEVIS/.test(r!.message!) && /Laisser Mimmo choisir/.test(r!.message!));
});

Deno.test('GARDE — un seul thème manquant suffit à bloquer ; il est nommé', async () => {
  const b = base({ scenarioAccepte: true });
  choisir(b, 'matieres', 'delegue', 1); choisir(b, 'deco', 'delegue', 2);
  const r = await clicFilm(b);
  eq(r?.status, 'partial'); eq((r!.data as any).manquants, ['exterieur']); eq(b.travaux.length, 0);
});

Deno.test('LANCEMENT — tout choisi ou délégué : film lancé, rappel dans la fiche et le message, aménagement extérieur PLACÉ transmis', async () => {
  const b = base({ scenarioAccepte: true });
  choisir(b, 'matieres', 'choisi', 1); choisir(b, 'deco', 'delegue', 2); choisir(b, 'exterieur', 'choisi', 3, AMENAGEMENT);
  const r = await clicFilm(b);
  eq(r?.status, 'ok', r?.message);
  eq(b.travaux.length, 1, 'un seul travail');
  const f = b.travaux[0].fiche as Record<string, any>;
  eq(f.amenagement_exterieur, AMENAGEMENT, 'les plantations de l’utilisateur partent avec le travail');
  eq(f.habillage_projet.themes.deco.mode, 'delegue');
  eq(f.habillage_projet.rappel.length, 3);
  ok(/2 arbres, 1 haie/.test(f.habillage_projet.rappel[2]), f.habillage_projet.rappel[2]);
  ok(/Habillage du projet transmis/.test(r!.message!), r!.message);
  ok(Array.isArray((r!.data as any).devis?.habillage_projet), 'rappel aussi dans le devis');
});

Deno.test('LANCEMENT — extérieurs délégués : aucun aménagement transmis (jardin composé par Mimmo), rappel honnête', async () => {
  const b = base({ scenarioAccepte: true });
  choisir(b, 'matieres', 'delegue', 1); choisir(b, 'deco', 'delegue', 2);
  choisir(b, 'exterieur', 'choisi', 3, AMENAGEMENT); choisir(b, 'exterieur', 'delegue', 4); // le plus récent l'emporte
  const r = await clicFilm(b);
  eq(r?.status, 'ok', r?.message);
  const f = b.travaux[0].fiche as Record<string, any>;
  eq(f.amenagement_exterieur, undefined);
  ok(/Mimmo plante/.test(f.habillage_projet.rappel[2]));
});

Deno.test('SANS LECTURE DES TRACES (ancien dépôt) ou PANNE : la garde ne bloque pas (jamais de rendu impossible sur une panne)', async () => {
  for (const o of [{ sansHabillage: true }, { panneHabillage: true }]) {
    const b = base({ scenarioAccepte: true, ...o });
    const r = await clicFilm(b);
    eq(r?.status, 'ok', r?.message);
    eq(b.travaux.length, 1);
  }
});

Deno.test('CARTE DE SCÉNARIO — rappel de l’habillage (complet / manquants) dans la sortie de studio_proposer_film', async () => {
  const b = base({ scenarioAccepte: true });
  await maisonHexagonale(b);
  const r1 = await proposer(b);
  eq((r1.data as any).habillage.complet, false); eq((r1.data as any).habillage.manquants.length, 3);
  ok(/HABILLAGE DU PROJET/.test(r1.message!));
  choisir(b, 'matieres', 'delegue', 1); choisir(b, 'deco', 'delegue', 2); choisir(b, 'exterieur', 'delegue', 3);
  const r2 = await proposer(b);
  eq((r2.data as any).habillage.complet, true); ok(/rappelle-le en une ligne/.test(r2.message!));
});

Deno.test('ÉCHEC — « Vérifiez la description du bâtiment » remplacé par la VRAIE cause (client_errors)', async () => {
  const b = base({ scenarioAccepte: true });
  const id = 'aa000000-0000-4000-8000-000000000001';
  b.lus.push({ id, type: 'film', statut: 'echec', progression: 35, etape: 'Rendu du film', cree_le: '2026-11-26T20:00:00Z', demarre_le: null, termine_le: null, resultat: null, elements_omis: [],
    erreur: 'Le projet n’a pas pu être mis en scène pour le film (aucun plan de caméra exploitable). Vérifiez la description du bâtiment dans la conversation.' });
  b.causes[id] = 'worker_film — code 1 · REFUS : storyboard vide (0 plan placé)';
  const r = await executerOutilStudio('studio_etat_rendu', { job_id: id }, b.env());
  const d = r!.data as Record<string, unknown>;
  ok(!/V[ée]rifiez la description/.test(String(d.erreur)), String(d.erreur));
  ok(/storyboard vide/.test(String(d.cause_echec)), String(d.cause_echec));
});

Deno.test('MACHINE — jamais de durée inventée : date absente, illisible ou future → aucune durée ; date réelle → « dernier rendu traité », pas « inactive »', () => {
  const now = Date.parse('2026-11-27T10:00:00Z');
  for (const derniereActivite of [null, 'pas-une-date', '2026-11-28T10:00:00Z']) {
    const e = etatMachine({ attente: 1, plusAncienneAttente: '2026-11-27T09:00:00Z', enCours: 0, derniereActivite }, now);
    ok(!/il y a \d/.test(e.phrase.replace(/en attente depuis [^;)]*/, '')), e.phrase);
    ok(/aucun rendu traité connu/.test(e.phrase), e.phrase);
  }
  const e = etatMachine({ attente: 1, plusAncienneAttente: '2026-11-27T09:00:00Z', enCours: 0, derniereActivite: '2026-11-25T16:00:00Z' }, now);
  ok(/dernier rendu traité ou en cours il y a 42 h/.test(e.phrase), e.phrase);
  ok(/durée inconnue/.test(e.phrase) && !/inactiv/i.test(e.phrase), e.phrase);
  eq(plusRecente('2026-11-25T16:00:00Z', '2026-11-26T08:00:00Z'), '2026-11-26T08:00:00Z');
  eq(plusRecente(null, 'x'), null); eq(plusRecente('2026-11-25T16:00:00Z', null), '2026-11-25T16:00:00Z');
});

Deno.test('SUITE — le message « Continuer : établir le devis » de la carte rouvre bien les outils du Studio (image, visite, film)', () => {
  for (const t of ['image', 'visite360', 'film'] as const) ok(studioPertinent([messageHabillageTermine(t)]), t);
});
