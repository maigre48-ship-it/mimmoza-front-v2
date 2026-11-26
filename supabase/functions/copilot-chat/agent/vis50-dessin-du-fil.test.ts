// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis50-dessin-du-fil.test.ts
// =============================================================================
// VIS-50 — CAS RÉEL du 26/11 (conversation 0113d281, travail film 153e93ee) : la maison hexagonale a été dessinée et
// « reproduite en 3D » le 24/11 AVANT VIS-34 → rien d'enregistré dans studio_preparations (ligne 115bd8de = 3 plots,
// sans `entree.projet_en_vigueur`). Le film lancé depuis le chat partait SANS `modele_batiment` : il filmait les 3 plots.
// Lecture SQL du 26/11 (seule) : dernier message d'habillage = « Reproduis ce bâtiment en 3D … » avec la référence
// `mimmoza-modele-ref` mb1-1c39e983 ; studio_dessiner_batiment ok (carte « modele », mb1-1c39e983) ; préparation sans
// projet en vigueur. Fixture : celle de VIS-34 (anonymisée, même dessin).
// =============================================================================
import * as na from 'node:assert/strict';
import { executerOutilDessinerBatiment } from './dessin-batiment.ts';
import { dessinDuFil, executerOutilStudio, ficheDepuisPreparation, NOTE_DESSIN_DU_FIL, NOTE_DESSIN_INTROUVABLE, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue } from './studio.ts';
import { projetFilme, type DepotFilms } from './studio-films.ts';
import { empreinteModele, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { messageReproduireModele } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { lireProjetEnVigueur } from '../../../../src/lib/studio/projetEnVigueur.ts';
import { validerScenario, type ScenarioFilm } from '../../../../src/lib/studio/scenarioFilm.ts';
import { lireBlocScenario, messageScenario } from '../../../../src/lib/studio/filmsChat.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url)));
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '0113d281-835a-43af-9442-da7d4608c0a7';
const NOM = 'Maison hexagonale avec tourelle et garage';

/** Scénario RÉEL du travail 153e93ee (scenario-film.json). */
const SCENARIO_REEL: ScenarioFilm = validerScenario({
  v: 1, titre: 'Arrivée par la rue au coucher du soleil', intention: 'Arrivée par la rue, façade, entrée, séjour, envol.', duree_s: 39, format: '16:9', ambiance: 'fin_de_journee',
  style: 'cinematique', musique: { ambiance: 'elegante' }, voix_off: null,
  plans: [
    { id: 'p1', prompt: 'On arrive par la rue vers le projet, à hauteur de piéton — travelling avant.', sujet: 'exterieur_rue', mouvement: 'travelling_avant', duree_s: 8, texte_ecran: 'le projet' },
    { id: 'p2', prompt: 'La façade se découvre, verticales droites — travelling latéral.', sujet: 'facade', mouvement: 'travelling_lateral', duree_s: 8, transition: 'fondu' },
    { id: 'p3', prompt: 'On s’approche de la porte d’entrée — approche de la porte.', sujet: 'entree', mouvement: 'approche_porte', duree_s: 6 },
    { id: 'p4', prompt: 'Le séjour meublé et ses volumes — travelling avant.', sujet: 'sejour', mouvement: 'travelling_avant', duree_s: 7 },
    { id: 'p5', prompt: 'Vue aérienne sur sa parcelle — drone en montée.', sujet: 'aerien', mouvement: 'drone_montee', duree_s: 10, transition: 'fondu' },
  ],
}).scenario!;

type Travail = { id: string; user_id: string; conversation_id: string; type: string; statut: string; fiche: Record<string, unknown>; options: Record<string, unknown>; cree_le: string };

function base() {
  const lignes: (PreparationLue & { ordre: number })[] = [];
  const messages: { texte: string; cree_le: string }[] = [];
  const sortiesModele: unknown[] = [];
  const travaux: Travail[] = [];
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
    typeRenduAutorise: (type: string, opts: Record<string, unknown>) => Promise.resolve(type === 'film' && 'scenario' in opts ? false : true),
    statsFile: () => Promise.resolve({ attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null }),
    travauxActifs: () => Promise.resolve(0),
    travailParDevis: (u: string, d: string) => Promise.resolve(travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null),
    jetonsDevis: () => Promise.resolve([]),
    questionBriefPosee: () => Promise.resolve(true),
    insererTravail: (u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) => {
      const t: Travail = { id: crypto.randomUUID(), user_id: u, statut: 'en_attente', cree_le: new Date().toISOString(), ...structuredClone(l) };
      travaux.push(t);
      return Promise.resolve({ ...t, progression: 0, etape: null, resultat: null, elements_omis: [], erreur: null, demarre_le: null, termine_le: null });
    },
    positionFile: () => Promise.resolve(0),
    urlSigneeRendu: () => Promise.resolve(null),
  } as unknown as DepotStudio;
  const depotFilms: DepotFilms = {
    sortiesFilm: () => Promise.resolve([]),
    scenariosMessages: () => Promise.resolve([...messages].reverse().filter((m) => m.texte.includes('```mimmoza-scenario'))),
  };
  const env = (plus: Partial<EnvStudio> = {}): EnvStudio => ({ userId: USER, depot, depotFilms, secret: 's', requete: crypto.randomUUID(), conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...plus });
  const courante = () => [...lignes].sort((a, b) => b.ordre - a.ordre).find((x) => x.conversation_id === CONV)!;
  return { depot, env, lignes, messages, sortiesModele, travaux, courante };
}

/**
 * État RÉEL d'avant VIS-34 : 3D préparée du moteur (3 plots, sans projet en vigueur) ; dessin + message « Reproduis ce
 * bâtiment en 3D » (habillage + référence) dans la conversation, mais AUCUNE ligne enregistrée pour le dessin.
 */
async function casReel(b: ReturnType<typeof base>, o: { dessinLisible?: boolean } = {}): Promise<ModeleBatiment> {
  const prep = await executerOutilStudio('studio_preparer_3d', {}, b.env());
  ok(prep && prep.status === 'ok', JSON.stringify(prep?.message));
  ok((b.courante().resume as { batiments: number }).batiments > 1, '3 plots préparés');
  ok(!lireProjetEnVigueur(b.courante().entree, CONV), 'aucun projet en vigueur enregistré (cas d’avant VIS-34)');
  const s = executerOutilDessinerBatiment(structuredClone(FX.dessin), { photoAuTour: false });
  na.equal(s.status, 'ok', s.message);
  if (o.dessinLisible !== false) b.sortiesModele.push(s);
  const m = (s.data as { modele: ModeleBatiment }).modele;
  b.messages.push({ texte: messageReproduireModele(m, empreinteModele(m)), cree_le: '2026-11-24T15:11:15.803Z' });
  return m;
}

async function lancerScenario(b: ReturnType<typeof base>, s: ScenarioFilm = SCENARIO_REEL) {
  const texte = messageScenario('lancer', s, 1);
  b.messages.push({ texte, cree_le: new Date().toISOString() });
  return await executerOutilStudio('studio_lancer_rendu', {}, b.env({ scenarioCarte: lireBlocScenario(texte) }));
}

Deno.test('VIS-50 — dessinDuFil : la règle du repli client (dernier habillage + référence → dessin par empreinte)', async () => {
  const b = base();
  const m = await casReel(b);
  const r = await dessinDuFil(b.depot, USER, CONV);
  ok(r && 'modele' in r);
  eq(r && 'modele' in r ? r.empreinte : null, empreinteModele(m));
  const b2 = base();
  await casReel(b2, { dessinLisible: false });
  const r2 = await dessinDuFil(b2.depot, USER, CONV);
  eq(r2, { introuvable: empreinteModele(m) }, 'référence présente, modèle illisible : « introuvable »');
});

Deno.test('VIS-50 — CAS RÉEL : le film lancé depuis le chat reçoit LE DESSIN (modele_batiment + projet_en_vigueur, portée « projet »), et le dessin est ENREGISTRÉ', async () => {
  const b = base();
  const m = await casReel(b);
  const E = empreinteModele(m);
  const prepAvant = b.courante().id;
  const r = await lancerScenario(b);
  eq(r?.status, 'ok', r?.message);
  eq(b.travaux.length, 1);
  const f = b.travaux[0].fiche as Record<string, any>;
  ok(f.modele_batiment, `fiche sans modele_batiment : ${Object.keys(f).join(', ')}`);
  eq(f.modele_batiment.empreinte, E); eq(f.modele_batiment.portee, 'projet');
  eq(f.projet_en_vigueur, { v: 1, source: 'dessin', empreinte: E, nom: NOM, portee: 'projet' });
  ok(String(f.titre).startsWith(NOM), `titre : ${f.titre}`);
  ok(!f.dessin_attendu);
  eq(b.travaux[0].options.interieurs, true, 'le scénario a un plan séjour → interieurs');
  ok(r!.message!.includes(NOTE_DESSIN_DU_FIL), r!.message!);
  eq((r!.data as any).dessin_du_fil?.enregistre, true);
  // Persistance : nouvelle ligne PROPRE, courante, avec projet en vigueur (même volume), l'ancienne gardée.
  const ligne = b.courante();
  ok(ligne.id !== prepAvant, 'ligne propre au dessin');
  const pv = lireProjetEnVigueur(ligne.entree, CONV)!;
  ok(pv); eq(pv.empreinte, E); eq(pv.portee, 'projet'); eq(pv.portee_choisie, false);
  eq(JSON.stringify(ligne.volume), JSON.stringify(b.lignes.find((x) => x.id === prepAvant)!.volume), 'même volume');
  // La suite lit la source enregistrée : un second rendu (autre scénario) part avec le même dessin, sans le note « messages ».
  const s2 = validerScenario({ ...SCENARIO_REEL, titre: 'Deuxième film', plans: SCENARIO_REEL.plans.slice(1) }).scenario!;
  const r2 = await lancerScenario(b, s2);
  eq(r2?.status, 'ok', r2?.message);
  const f2 = b.travaux.at(-1)!.fiche as Record<string, any>;
  eq(f2.modele_batiment?.empreinte, E);
  ok(!r2!.message!.includes(NOTE_DESSIN_DU_FIL), 'source enregistrée : plus de repli');
});

Deno.test('VIS-50 — les scénarios proposés suivent le dessin retrouvé (source « dessin »)', async () => {
  const b = base();
  const m = await casReel(b);
  const p = await projetFilme(b.depot, USER, CONV);
  eq(p?.source, 'dessin');
  eq(p?.capacites.empreinte_projet, empreinteModele(m));
});

Deno.test('VIS-50 — dessin validé mais illisible : `dessin_attendu` + avertissement EN TÊTE (jamais un autre bâtiment en silence)', async () => {
  const b = base();
  await casReel(b, { dessinLisible: false });
  const r = await lancerScenario(b);
  eq(r?.status, 'ok', r?.message);
  const f = b.travaux[0].fiche as Record<string, any>;
  ok(!f.modele_batiment);
  ok(f.dessin_attendu && typeof f.dessin_attendu.empreinte === 'string');
  ok(r!.message!.startsWith('AVERTISSEMENT À DIRE EN PREMIER'), r!.message!);
  ok(r!.message!.includes(NOTE_DESSIN_INTROUVABLE));
});

Deno.test('VIS-50 — sans dessin dans la conversation : fiche inchangée (ni modele_batiment ni dessin_attendu)', async () => {
  const b = base();
  const prep = await executerOutilStudio('studio_preparer_3d', {}, b.env());
  ok(prep && prep.status === 'ok');
  const f = ficheDepuisPreparation(b.courante(), CONV, new Date(0).toISOString(), crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(f.ok);
  if (f.ok) { ok(!f.valeur.modele_batiment); ok(!f.valeur.dessin_attendu); ok(!f.valeur.projet_en_vigueur); }
});
