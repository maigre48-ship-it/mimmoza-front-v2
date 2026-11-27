// supabase/functions/copilot-chat/agent/vis71-integration.test.ts
// VIS-71 — intégration des lots du 27/11 dans copilot-chat : style de façade (carte « Habiller le projet » et phrase du
// chat) reporté dans la fiche du rendu, phrase de la machine par le signal de vie (repli sur la file), branchement des
// outils studio_dossier_client / quartier_atouts / grille_vente dans index.ts. Base en mémoire reprise de vis57-habillage.
import * as na from 'node:assert/strict';
import { executerOutilDessinerBatiment } from './dessin-batiment.ts';
import { etatMachine, executerOutilStudio, phraseMachine, styleFacadeDuProjet, plusRecente, studioPertinent, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue } from './studio.ts';
import { executerOutilProposerFilm, type DepotFilms } from './studio-films.ts';
import { empreinteModele, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { messageReproduireModele, referenceModeleDuMessage } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { descriptionDuMessage } from '../../../../src/lib/studio/descriptionBatiment.ts';
import { type ScenarioFilm } from '../../../../src/lib/studio/scenarioFilm.ts';
import { lireBlocScenario, messageScenario } from '../../../../src/lib/studio/filmsChat.ts';
import { habillageDesTraces, messageHabillageTermine, paramsTraceHabillage, type ThemeHabillage, type ModeTheme } from '../../../../src/lib/studio/habillageProjet.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url)));
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '0113d281-835a-43af-9442-da7d4608c0a7';

type Travail = { id: string; user_id: string; conversation_id: string; type: string; statut: string; fiche: Record<string, unknown>; options: Record<string, unknown>; cree_le: string };

/** Base en mémoire : préparations, messages, sorties d'outils, travaux ; `scenarioAccepte` simule la migration. */
function base(o: { scenarioAccepte: boolean | null; refusInsertionScenario?: boolean; sansHabillage?: boolean; panneHabillage?: boolean; signal?: unknown } = { scenarioAccepte: true }) {
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
    messagesUtilisateur: () => Promise.resolve([...messages].reverse()),
    ...(o.signal !== undefined ? { signalMachine: () => (o.signal instanceof Error ? Promise.reject(o.signal) : Promise.resolve(o.signal)) } : {}),
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
function choisir(b: ReturnType<typeof base>, theme: ThemeHabillage, mode: ModeTheme, minute: number, amenagement: Record<string, unknown> | null = null, styleFacade: string | null = null) {
  b.habillage.push(paramsTraceHabillage(theme, mode, { resume: mode === 'choisi' && theme !== 'exterieur' ? 'réglé dans le Studio' : null, amenagement, styleFacade, le: new Date(Date.UTC(2026, 10, 26, 22, minute)).toISOString() }));
}
async function clicFilm(b: ReturnType<typeof base>) {
  await maisonHexagonale(b);
  const s = props(await proposer(b))[0];
  const texte = messageScenario('lancer', s, 1);
  b.messages.push({ texte, cree_le: new Date(Date.UTC(2026, 10, 26, 23, 0, 0)).toISOString() });
  return executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
}


const minute = (h: number, m: number) => new Date(Date.UTC(2026, 10, 26, h, m)).toISOString();
const detailsDe = (f: Record<string, any>) => f.habillage_batiments?.details ?? null;

Deno.test('STYLE — choisi dans le thème Matières : posé dans habillage_batiments.details.style_facade, dit dans le devis', async () => {
  const b = base({ scenarioAccepte: true });
  choisir(b, 'matieres', 'choisi', 1, null, 'neo_basque'); choisir(b, 'deco', 'delegue', 2); choisir(b, 'exterieur', 'delegue', 3);
  const r = await clicFilm(b);
  eq(r?.status, 'ok', r?.message);
  const f = b.travaux[0].fiche as Record<string, any>;
  eq(detailsDe(f)?.style_facade, 'neo_basque');
  ok(/néo-basque/.test(f.habillage_projet.rappel[0]), f.habillage_projet.rappel[0]);
  ok(/néo-basque/.test(String((r!.data as any).devis?.style_facade)), JSON.stringify((r!.data as any).devis?.style_facade));
});

Deno.test('STYLE — « passe la façade en contemporain bois et zinc » dans le chat, PLUS RÉCENT que la carte : il l’emporte', async () => {
  const b = base({ scenarioAccepte: true });
  choisir(b, 'matieres', 'choisi', 1, null, 'neo_basque'); choisir(b, 'deco', 'delegue', 2); choisir(b, 'exterieur', 'delegue', 3);
  b.messages.push({ texte: 'passe la façade en contemporain bois et zinc', cree_le: minute(22, 30) });
  const r = await clicFilm(b);
  eq(r?.status, 'ok', r?.message);
  eq(detailsDe(b.travaux[0].fiche as Record<string, any>)?.style_facade, 'contemporain_bois_zinc');
});

Deno.test('STYLE — « Laisser Mimmo choisir » : aucun style écrit (le Studio garde le style sobre / celui du dessin)', async () => {
  const b = base({ scenarioAccepte: true });
  choisir(b, 'matieres', 'choisi', 1, null, 'beton_brut'); choisir(b, 'matieres', 'delegue', 2); choisir(b, 'deco', 'delegue', 3); choisir(b, 'exterieur', 'delegue', 4);
  eq(habillageDesTraces([...b.habillage].reverse()).styleFacade, null, 'la délégation efface le style choisi avant');
  const r = await clicFilm(b);
  eq(r?.status, 'ok', r?.message);
  eq(detailsDe(b.travaux[0].fiche as Record<string, any>)?.style_facade, undefined);
});

Deno.test('STYLE — liste blanche : un style inconnu dans une trace est ignoré ; sans lecture des messages, la carte suffit', async () => {
  const b = base({ scenarioAccepte: true });
  b.habillage.push({ ...paramsTraceHabillage('matieres', 'choisi', { resume: null, le: minute(22, 1) }), style_facade: 'gothique_flamboyant' });
  eq(await styleFacadeDuProjet(b.depot, USER, CONV, [...b.habillage]), null);
  const sansMessages = { ...b.depot, messagesUtilisateur: undefined } as DepotStudio;
  const t = [paramsTraceHabillage('matieres', 'choisi', { resume: null, le: minute(22, 2), styleFacade: 'mediterraneen' })];
  eq((await styleFacadeDuProjet(sansMessages, USER, CONV, t))?.id, 'mediterraneen');
  const enPanne = { ...b.depot, messagesUtilisateur: () => Promise.reject(new Error('panne')) } as unknown as DepotStudio;
  eq((await styleFacadeDuProjet(enPanne, USER, CONV, t))?.id, 'mediterraneen', 'panne de lecture : jamais d’erreur');
});

Deno.test('MACHINE — signal de vie présent : phrase du signal ; absent (migration non appliquée) ou en panne : phrase de la file', async () => {
  const maintenant = Date.parse('2026-11-27T20:00:00Z');
  const stats = { attente: 1, plusAncienneAttente: '2026-11-27T19:50:00Z', enCours: 0, derniereActivite: '2026-11-27T19:58:00Z' };
  const repli = etatMachine(stats, maintenant).phrase;
  eq(await phraseMachine({}, stats, maintenant), repli, 'ancien dépôt sans signalMachine');
  eq(await phraseMachine({ signalMachine: () => Promise.resolve(null) }, stats, maintenant), repli, 'rpc absente → null → repli');
  eq(await phraseMachine({ signalMachine: () => Promise.reject(new Error('42883')) }, stats, maintenant), repli, 'erreur → repli');
  const hors = await phraseMachine({ signalMachine: () => Promise.resolve({ vu_le: '2026-11-27T18:00:00Z', etat: 'pret', maintenant: '2026-11-27T20:00:00Z' }) }, stats, maintenant);
  ok(/hors ligne/i.test(hors) && /EN ATTENTE/.test(hors) && /rien n’est débité/.test(hors), hors);
  ok(hors !== repli);
});

Deno.test('MACHINE — le devis du film porte la phrase du signal de vie quand il existe', async () => {
  const b = base({ scenarioAccepte: true, signal: { vu_le: '2020-01-01T00:00:00Z', etat: 'pret' } });
  choisir(b, 'matieres', 'delegue', 1); choisir(b, 'deco', 'delegue', 2); choisir(b, 'exterieur', 'delegue', 3);
  const r = await clicFilm(b);
  eq(r?.status, 'ok', r?.message);
  ok(/hors ligne/i.test(String((r!.data as any).machine)), String((r!.data as any).machine));
});

Deno.test('BRANCHEMENT index.ts — trois outils : import, liste, case executeTool, filtre du vertical, proposition au tour ; consignes', () => {
  const idx = Deno.readTextFileSync(new URL('../index.ts', import.meta.url));
  for (const [def, nom, garde] of [
    ['OUTIL_DOSSIER_CLIENT_DEF', 'OUTIL_DOSSIER_CLIENT', 'dossierClientAuTour'],
    ['OUTIL_QUARTIER_VENTE_DEF', 'OUTIL_QUARTIER_VENTE', 'quartierAuTour'],
    ['OUTIL_GRILLE_VENTE_DEF', 'OUTIL_GRILLE_VENTE', 'grilleVenteAuTour'],
  ]) {
    ok(new RegExp(`\\n  ${def},\\n`).test(idx), `${def} dans TOOLS`);
    ok(idx.includes(`case ${nom}: {`), `case ${nom}`);
    ok(idx.includes(`tool.name === ${nom}`), `${nom} réservé au vertical agent`);
    ok(idx.includes(`...(${garde} ? [${nom}] : []),`), `${nom} proposé au tour`);
  }
  ok(idx.includes('system = `${system}\\n\\n${CONSIGNE_QUARTIER}`'), 'consigne quartier');
  ok(idx.includes('consigneStyleFacade(userText)'), 'style de façade lu dans le message reçu');
});

Deno.test('PROPOSITION AU TOUR — phrases réelles', async () => {
  const { demandeDossierClient } = await import('./dossier-client.ts');
  const { demandeQuartier } = await import('./quartier-vente.ts');
  const { grilleVentePertinente } = await import('./grille-vente.ts');
  const { commandeStyleFacade } = await import('../../../../src/lib/studio/styleFacade.ts');
  ok(demandeDossierClient('prépare-moi le dossier client'));
  ok(demandeQuartier('qu’y a-t-il autour du projet ? les écoles à proximité'));
  ok(grilleVentePertinente(['montre-moi les T3 libres au-dessus du 2e étage orientés sud']));
  eq(commandeStyleFacade('passe la façade en contemporain bois et zinc')?.style.id, 'contemporain_bois_zinc');
  eq(commandeStyleFacade('style de façade : béton brut')?.style.id, 'beton_brut');
  ok(/aperçu, matières incomplètes/.test(commandeStyleFacade('style de façade : béton brut')!.reponse));
  eq(commandeStyleFacade('fais-moi un film du projet'), null);
});
