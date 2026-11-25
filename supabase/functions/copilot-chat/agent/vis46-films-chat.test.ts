// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis46-films-chat.test.ts
// =============================================================================
// VIS-46 — FILMS COMMANDÉS PAR LE CHAT, sur le CAS RÉEL de VIS-34 (Ascain AI0002, « Maison hexagonale avec tourelle et
// garage » dessinée puis reproduite en 3D) :
//   demande de film → 3 scénarios SANS plan impossible (pas de balcon, de terrasse ni de baie) → modification par phrase
//   → « Valider et lancer le film » (UN clic = devis + lancement, scénario dans options.scenario) → second clic : rien
//   n'est relancé (un seul travail) → base sans migration : film lancé avec les options d'avant + AVERTISSEMENT.
// =============================================================================
import * as na from 'node:assert/strict';
import { executerOutilDessinerBatiment } from './dessin-batiment.ts';
import { AVERTISSEMENT_SCENARIO_SANS_MIGRATION, executerOutilStudio, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue } from './studio.ts';
import { demandeFilm, executerOutilProposerFilm, modificationFilm, type DepotFilms } from './studio-films.ts';
import { empreinteModele, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { messageReproduireModele, referenceModeleDuMessage } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { descriptionDuMessage } from '../../../../src/lib/studio/descriptionBatiment.ts';
import { empreinteScenario, validerScenario, type ScenarioFilm } from '../../../../src/lib/studio/scenarioFilm.ts';
import { lireBlocScenario, messageScenario } from '../../../../src/lib/studio/filmsChat.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url)));
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '0113d281-835a-43af-9442-da7d4608c0a7';

type Travail = { id: string; user_id: string; conversation_id: string; type: string; statut: string; fiche: Record<string, unknown>; options: Record<string, unknown>; cree_le: string };

/** Base en mémoire : préparations, messages, sorties d'outils, travaux ; `scenarioAccepte` simule la migration. */
function base(o: { scenarioAccepte: boolean | null; refusInsertionScenario?: boolean } = { scenarioAccepte: true }) {
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
  } as unknown as DepotStudio;
  const depotFilms: DepotFilms = {
    sortiesFilm: () => Promise.resolve([...sortiesFilm].reverse()),
    scenariosMessages: () => Promise.resolve([...messages].reverse().filter((m) => m.texte.includes('```mimmoza-scenario'))),
  };
  const env = (plus: Partial<EnvStudio> = {}): EnvStudio => ({ userId: USER, depot, depotFilms, secret: 's', requete: crypto.randomUUID(), conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...plus });
  const envFilms = (plus: { scenarioCarte?: EnvStudio['scenarioCarte'] } = {}) => ({ userId: USER, conversationId: CONV, depot, depotFilms, ...plus });
  return { depot, depotFilms, env, envFilms, lignes, messages, sortiesModele, sortiesFilm, travaux, controles };
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

Deno.test('AIGUILLAGE — demande de film reconnue ; accord à un devis et visite 360 : non ; modification reconnue', () => {
  ok(demandeFilm('Fais-moi un film de la maison'));
  ok(demandeFilm('une vidéo pour les réseaux'));
  ok(!demandeFilm('oui, lance le film'));
  ok(!demandeFilm('pas de film, une image'));
  ok(!demandeFilm('une visite 360'));
  ok(modificationFilm('raccourcis à 30 s'));
  ok(modificationFilm('plus de drone'));
  ok(!modificationFilm('merci'));
});

Deno.test('PROPOSITION — maison hexagonale : 3 scénarios valides et différents, AUCUN plan impossible (balcon, terrasse, baie)', async () => {
  const b = base();
  const m = await maisonHexagonale(b);
  const r = await proposer(b);
  eq(r.status, 'ok', r.message);
  const ps = props(r);
  eq(ps.length, 3);
  eq(new Set(ps.map(empreinteScenario)).size, 3);
  for (const s of ps) {
    ok(validerScenario(s).ok, s.titre);
    eq(s.empreinte_projet, empreinteModele(m), 'scénario construit sur le projet EN VIGUEUR (empreinte du dessin)');
    for (const p of s.plans) ok(!['balcon', 'terrasse', 'vue_depuis_baie'].includes(p.sujet), `${s.titre} : ${p.sujet}`);
  }
  eq(ps.map((s) => s.titre), ['Arrivée par la rue au coucher du soleil', 'Visite intérieure lumineuse', 'Format réseaux 9:16 de 20 s']);
  const d = r.data as Record<string, any>;
  eq(d.carte, 'scenarios-film'); eq(d.projet.source, 'dessin'); eq(d.projet.nom, 'Maison hexagonale avec tourelle et garage');
  ok(/pas de plan sur : .*balcon/.test(r.message!), r.message);
  ok(/Ne recopie pas les plans, ne pose AUCUNE question/.test(r.message!));
  ok(String(d.cout).includes('Aucun débit'));
});

Deno.test('PROPOSITION — sans 3D préparée : rien n’est proposé, la raison est dite', async () => {
  const b = base();
  const r = await proposer(b);
  eq(r.status, 'partial');
  ok(/Aucune 3D préparée/.test(r.message!));
});

Deno.test('MODIFICATION PAR PHRASE — « raccourcis à 30 s » (les 3), puis « ajoute un plan sur le balcon » refusé avec sa raison', async () => {
  const b = base();
  await maisonHexagonale(b);
  const v1 = await proposer(b);
  const v2 = await proposer(b, { modification: 'raccourcis à 30 s' });
  eq(v2.status, 'ok', v2.message);
  eq((v2.data as any).version, 2);
  for (const s of props(v2)) eq(s.duree_s, s.titre.includes('20 s') ? 30 : 30, s.titre);
  ok((v2.data as any).differences.some((d: any) => d.champs.includes('duree_s')), 'différences pour le surlignage');
  ok(props(v1).length === props(v2).length);
  const balcon = await proposer(b, { modification: 'ajoute un plan sur le balcon' });
  eq(balcon.status, 'partial');
  ok(/pas de balcon/.test(balcon.message!), balcon.message);
  const cuisine = await proposer(b, { modification: 'ajoute un plan sur la cuisine' });
  eq(cuisine.status, 'ok', cuisine.message);
  ok(props(cuisine).every((s) => s.plans.some((p) => p.sujet === 'cuisine')));
});

Deno.test('CARTE MODIFIÉE À LA MAIN — un plan impossible glissé dans le bloc est RETIRÉ et dit', async () => {
  const b = base();
  await maisonHexagonale(b);
  const v1 = await proposer(b);
  const s = structuredClone(props(v1)[0]);
  s.plans.splice(1, 0, { id: 'balcon-x', prompt: 'Le balcon', sujet: 'balcon', mouvement: 'panoramique', duree_s: 5 });
  const bloc = lireBlocScenario(messageScenario('modifier', { ...s, duree_s: s.duree_s + 5 }, 2));
  ok(bloc && bloc.ok);
  const r = await proposer(b, {}, { scenarioCarte: bloc });
  eq(r.status, 'ok', r.message);
  ok(!props(r)[0].plans.some((p) => p.sujet === 'balcon'));
  ok(/pas de balcon/.test(r.message!));
});

Deno.test('VALIDER ET LANCER — UN clic : devis + lancement dans le même tour, scénario dans options.scenario ; second clic : rien n’est relancé', async () => {
  const b = base({ scenarioAccepte: true });
  await maisonHexagonale(b);
  const s = props(await proposer(b))[0];
  const texte = messageScenario('lancer', s, 1);
  b.messages.push({ texte, cree_le: new Date(Date.UTC(2026, 10, 25, 10, 0, 0)).toISOString() });
  const r = await executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
  eq(r?.status, 'ok', r?.message);
  eq(b.travaux.length, 1, 'un travail');
  const t = b.travaux[0];
  eq(t.type, 'film');
  eq(empreinteScenario(t.options.scenario as ScenarioFilm), empreinteScenario(s), 'scénario transmis tel quel');
  eq(t.options.duree_s, 30, '45 s → palier 30 (options de secours)'); eq(t.options.ambiance, 'fin_de_journee'); eq(t.options.format, '16:9');
  eq(empreinteScenario(t.fiche.scenario_film as ScenarioFilm), empreinteScenario(s), 'fiche.scenario_film = le scénario (repli VIS-47 et historique)');
  ok(/AVEC le scénario validé/.test(r!.message!));
  ok(String((r!.data as any).devis?.scenario).includes('Arrivée par la rue'), 'le devis du clic est rendu à la carte');
  // Second clic (même scénario, même projet, autre requête) : déjà lancé, aucun second travail.
  const bis = await executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
  eq(b.travaux.length, 1, 'jamais deux travaux pour le même scénario');
  ok((bis!.data as any).deja_lance === true, bis?.message);
});

Deno.test('REPLI SANS MIGRATION — la base refuse `options.scenario` : options d’avant + scénario dans la fiche + AVERTISSEMENT (jamais d’échec silencieux)', async () => {
  const b = base({ scenarioAccepte: false });
  await maisonHexagonale(b);
  const s = props(await proposer(b))[2];
  const texte = messageScenario('lancer', s, 1);
  const r = await executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
  eq(r?.status, 'ok', r?.message);
  eq(b.travaux.length, 1);
  ok(!('scenario' in b.travaux[0].options), 'options d’avant seulement');
  eq(b.travaux[0].options.format, '9:16'); eq(b.travaux[0].options.duree_s, 30);
  eq(empreinteScenario(b.travaux[0].fiche.scenario_film as ScenarioFilm), empreinteScenario(s), 'le scénario part dans la fiche (lu par le worker VIS-47)');
  ok(r!.message!.includes(AVERTISSEMENT_SCENARIO_SANS_MIGRATION), r?.message);
  ok((r!.data as any).scenario_transmis === false);
});

Deno.test('REPLI — contrôle indisponible puis insertion refusée : relance UNE fois sans `scenario`, dit', async () => {
  const b = base({ scenarioAccepte: null, refusInsertionScenario: true });
  await maisonHexagonale(b);
  const s = props(await proposer(b))[1];
  const texte = messageScenario('lancer', s, 1);
  const r = await executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
  eq(r?.status, 'ok', r?.message);
  eq(b.travaux.length, 1);
  ok(!('scenario' in b.travaux[0].options));
  ok(r!.message!.includes(AVERTISSEMENT_SCENARIO_SANS_MIGRATION));
});

Deno.test('BLOC REFUSÉ — un scénario invalide dans le clic : RIEN N’EST LANCÉ', async () => {
  const b = base();
  await maisonHexagonale(b);
  const r = await executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario('```mimmoza-scenario\n{"v":1,"action":"lancer","scenario":{"v":1,"titre":"x"}}\n```') }));
  eq(r?.status, 'error');
  ok(/RIEN N’A ÉTÉ LANCÉ/.test(r!.message!));
  eq(b.travaux.length, 0);
});
