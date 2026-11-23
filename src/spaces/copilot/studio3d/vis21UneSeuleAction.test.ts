// node --test src/spaces/copilot/studio3d/vis21UneSeuleAction.test.ts
// VIS-21 (23/11/2026) — « Il faut avoir un choix » : une seule action par chose à faire, et une panne du fournisseur
// d'IA n'est jamais présentée comme un manque de jetons.
// Cas réel : conversation a7cca310… (Ascain, AI0002) — 09:25:49 UTC devis de conception (51 à 126 jetons) avec
// « Lancer la mission » ; la carte du parcours montrait AUSSI « Valider », qui envoyait « Lance la conception de mon projet
// sur ce terrain. » ; la réponse s'est interrompue (Anthropic 400 « credit balance is too low ») et le chat a affiché
// « Vous n'avez plus assez de jetons » à un utilisateur qui en avait 1 049 ; la mission lancée à 09:27 a échoué (même cause).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { blocParcoursSysteme, calculerParcours, DEVIS_RENDU_DANS_LE_FIL, prochaineEtape, sourcesVides, TYPES_PARCOURS, type SourcesParcours } from '../../../lib/studio/parcours.ts';
import { assemblerSourcesEcran, devisRenduEnAttente } from './parcoursEcran.ts';
import { lancerMissionAvec, type DepsLancement } from '../agent/lancementMissionLogique.ts';
import { messageErreurLisible } from '../store/erreurLisible.ts';
import { deciderReprise } from '../store/repriseFlux.ts';
import { erreurMissionLisible, missionEnPauseFournisseur } from '../agent/agentLogique.ts';
import {
  estPauseFournisseur, MESSAGE_FOURNISSEUR_CREDIT, panneFournisseurIA, questionPauseFournisseur,
} from '../../../../supabase/functions/_shared/copilot-stream/fournisseurIA.ts';

const MISSION = 'e50ffdf7-351e-4ea4-88dc-aa4b25131fcc';
const CONV = 'a7cca310-82fc-4be7-84f3-d4b3cb25a5f1';
const ERREUR_REELLE = 'Stream error : Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
const ERREUR_MISSION = 'erreur répétée 3 fois : Anthropic API 400 : {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011ChKd9MDUedMmr1Yf9uSuY"}';

const avecDevis = (s: Partial<SourcesParcours> = {}): SourcesParcours => ({ ...sourcesVides(), terrain: 'AI0002 · Ascain', conception: { statut: 'devis', resume: null, missionId: MISSION }, ...s });

// ── 1. Une seule action : le parcours lance la MÊME mission, jamais un message à Mimmo ───────────────────────────────
test('devis en attente : l’étape 2 porte l’action « mission » (lancer, id du devis), aucun message à Mimmo', () => {
  for (const type of TYPES_PARCOURS) {
    const e = calculerParcours({ ...avecDevis(), type }).etapes[1];
    assert.deepEqual(e.action, { cible: 'mission', operation: 'lancer', libelle: 'Lancer la mission', missionId: MISSION });
    assert.equal(e.action.message, undefined);
    assert.match(e.carteDansLeFil ?? '', /Lancer la mission/);
    assert.match(e.resume, /devis à valider/);
  }
  const enCours = calculerParcours({ ...avecDevis(), conception: { statut: 'en_cours', resume: null, missionId: MISSION } }).etapes[1];
  assert.deepEqual(enCours.action, { cible: 'mission', operation: 'suivre', libelle: 'Suivre la mission', missionId: MISSION });
  assert.equal(enCours.carteDansLeFil, undefined);
  // Aucune étape, dans aucun état, n'envoie plus « Lance la conception de mon projet sur ce terrain. ».
  for (const statut of ['devis', 'en_cours', 'echec', 'terminee', 'attente_utilisateur']) {
    for (const e of calculerParcours({ ...avecDevis(), conception: { statut, resume: null, missionId: MISSION } }).etapes) {
      assert.doesNotMatch(e.action.message ?? '', /Lance la conception/);
    }
  }
});

test('écran : la mission de conception de la conversation donne son identifiant à l’étape', () => {
  const s = assemblerSourcesEcran({
    messages: [], conversationId: CONV, typeChoisi: null, parcelle: null, brief: null, film: null, visite: null,
    missions: [{ id: MISSION, type: 'conception', statut: 'devis', conversation_id: CONV, cree_le: '2026-11-23T09:25:43Z', criteres: { idu: '64065000AI0002' } }],
    travaux: [],
  });
  assert.equal(s.conception?.missionId, MISSION);
  assert.equal(calculerParcours(s).etapes[1].action.missionId, MISSION);
});

test('cartes d’action déjà dans le fil : brief créatif attendu, devis d’aperçu / de rendu final → renvoi, pas de 2e bouton', () => {
  const fait = { ...sourcesVides(), terrain: 'AI0002', conception: { statut: 'terminee', resume: 'R+2' }, volume: { pret: true, resume: 'R+2' } };
  const brief = calculerParcours({ ...fait, habillage: { resume: null, attenduParMimmo: true } });
  assert.equal(prochaineEtape(brief)?.cle, 'style');
  assert.match(prochaineEtape(brief)?.carteDansLeFil ?? '', /brief créatif/);
  assert.equal(calculerParcours(fait).etapes.find((e) => e.cle === 'style')?.carteDansLeFil, undefined);
  const apercu = calculerParcours({ ...fait, devisRenduEnAttente: 'apercu' }).etapes.find((e) => e.cle === 'apercu');
  assert.equal(apercu?.carteDansLeFil, DEVIS_RENDU_DANS_LE_FIL);
  assert.equal(calculerParcours({ ...fait, devisRenduEnAttente: 'finale' }).etapes.find((e) => e.cle === 'apercu')?.carteDansLeFil, undefined);
  // Lecture du fil : devis « confirmation_requise » dans la dernière réponse, rien écrit depuis.
  const devis = (qualite: string) => ({ id: 'a', role: 'assistant', text: 'Devis', toolCalls: [{ id: 't', name: 'studio_lancer_rendu', status: 'success', output: { status: 'confirmation_requise', data: { options: { qualite } } } }] });
  assert.equal(devisRenduEnAttente([devis('apercu')] as never), 'apercu');
  assert.equal(devisRenduEnAttente([devis('finale')] as never), 'finale');
  assert.equal(devisRenduEnAttente([devis('apercu'), { id: 'u', role: 'user', text: 'oui' }] as never), null);
  assert.equal(devisRenduEnAttente([{ id: 'a', role: 'assistant', text: 'x', toolCalls: [{ id: 't', name: 'studio_lancer_rendu', status: 'success', output: { status: 'ok', data: { lance: true } } }] }] as never), null);
});

test('même handler : carte du devis, panneau Missions et parcours appellent lancerMissionDuDevis ; jamais validerDevis en direct', () => {
  const lire = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const carte = lire('../agent/CarteDevisMission.tsx');
  const panneau = lire('../agent/PanneauMissions.tsx');
  const chat = lire('../components/CopilotChat.tsx');
  for (const [nom, src] of [['CarteDevisMission', carte], ['PanneauMissions', panneau], ['CopilotChat', chat]] as const) {
    assert.match(src, /lancerMissionDuDevis\(/, nom);
    assert.doesNotMatch(src, /validerDevis\(/, nom);
  }
  assert.match(chat, /action\.cible === 'mission'/);
  // La carte du parcours du chat remplace son bouton par le renvoi quand une carte d'action existe.
  assert.match(lire('./ParcoursGuide.tsx'), /!e\.carteDansLeFil/);
  assert.match(lire('./ParcoursGuide.tsx'), /mz-parcours__renvoi/);
});

test('lancement : une seule réservation même si la carte du devis et le parcours sont cliqués ensemble', async () => {
  const appels: string[] = [];
  let signale = 0; let suivi = '';
  const deps: DepsLancement = {
    valider: async (id) => { appels.push(id); await new Promise((r) => setTimeout(r, 5)); return { id, statut: 'en_attente' } as never; },
    signaler: () => { signale += 1; }, rafraichirSolde: () => undefined, planifier: () => undefined,
    suiviDisponible: () => true, ouvrirSuivi: (id) => { suivi = id; },
  };
  const [a, b] = await Promise.all([lancerMissionAvec(MISSION, deps), lancerMissionAvec(MISSION, deps)]);
  assert.deepEqual(appels, [MISSION]);
  assert.equal(a, b);
  assert.equal(signale, 1);
  assert.equal(suivi, MISSION);
  // Une erreur (ex. solde réellement insuffisant) remonte telle quelle et libère le verrou.
  const refus: DepsLancement = { ...deps, valider: async () => { throw new Error('Solde insuffisant. Vous pouvez recharger vos jetons depuis votre abonnement.'); } };
  await assert.rejects(lancerMissionAvec('m2', refus), /Solde insuffisant/);
  await assert.rejects(lancerMissionAvec('m2', refus), /Solde insuffisant/);
});

// ── 2. « Pas assez de jetons » avec 1 049 jetons : panne du fournisseur ───────────────────────────────────────────────
test('erreur réelle du 23/11 : crédit du fournisseur épuisé → message honnête, jamais « pas assez de jetons »', () => {
  const avant = console.warn; console.warn = () => undefined;
  try {
    assert.equal(panneFournisseurIA(ERREUR_REELLE), 'credit_epuise');
    assert.equal(messageErreurLisible(ERREUR_REELLE), MESSAGE_FOURNISSEUR_CREDIT);
    assert.doesNotMatch(messageErreurLisible(ERREUR_REELLE), /assez de jetons/);
    assert.match(MESSAGE_FOURNISSEUR_CREDIT, /Vos jetons ne sont pas débités/);
    assert.match(messageErreurLisible('Anthropic API 529 : {"type":"error","error":{"type":"overloaded_error"}}'), /saturé/);
    // Le vrai manque de jetons reste dit comme tel.
    assert.match(messageErreurLisible('INSUFFICIENT_CREDITS'), /plus assez de jetons/);
    assert.match(messageErreurLisible('Solde insuffisant'), /plus assez de jetons/);
    assert.equal(panneFournisseurIA('Solde insuffisant'), null);
  } finally { console.warn = avant; }
  // Pas de suite automatique : redemander la suite au même fournisseur n'a aucun sens.
  assert.equal(deciderReprise({ terminal: 'error', partielPersiste: true, erreur: ERREUR_REELLE, annuleParUtilisateur: false, conversationId: CONV, dejaRepris: false }), 'rien');
});

test('mission : erreur lisible, pause reconnue (bouton « Reprendre »)', () => {
  assert.match(erreurMissionLisible(ERREUR_MISSION) ?? '', /^Mission interrompue : le service d'IA de Mimmoza est momentanément indisponible/);
  assert.doesNotMatch(erreurMissionLisible(ERREUR_MISSION) ?? '', /request_id|invalid_request_error/);
  assert.equal(erreurMissionLisible('devis expiré (plus de 24 h) : demandez un nouveau devis'), 'devis expiré (plus de 24 h) : demandez un nouveau devis');
  const q = questionPauseFournisseur('credit_epuise');
  assert.ok(estPauseFournisseur(q));
  assert.ok(missionEnPauseFournisseur({ statut: 'attente_utilisateur', question_en_attente: q }));
  assert.ok(!missionEnPauseFournisseur({ statut: 'attente_utilisateur', question_en_attente: 'Quel secteur de hauteur ?' }));
  assert.ok(!missionEnPauseFournisseur({ statut: 'echec', question_en_attente: q }));
});

test('bloc serveur : un devis en attente ne se repropose pas', () => {
  const bloc = blocParcoursSysteme(calculerParcours(avecDevis()));
  assert.match(bloc, /ne se repropose PAS/);
  assert.match(bloc, /2\. Programme & conception — À FAIRE — Mission de conception proposée : devis à valider/);
});

// ── Rendu de la carte du chat (esbuild + react-dom/server, comme vis20) ───────────────────────────────────────────
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
test('rendu : carte « Votre parcours » sous un devis → aucun bouton concurrent ; récapitulatif sans commande', async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const r = await esbuild.build({
    stdin: { contents: "export * from './ParcoursGuide.tsx';", resolveDir: ICI, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', alias: { '@': path.join(RACINE, 'src') },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis21');
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, 'Parcours.mjs');
  writeFileSync(fichier, r.outputFiles[0].text);
  const m = await import(pathToFileURL(fichier).href) as typeof import('./ParcoursGuide.tsx');
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup: rendre } = await import('react-dom/server');
  const p = calculerParcours(avecDevis());
  const recus: string[] = [];
  const chat = rendre(h(m.CarteParcours, { parcours: p, onAction: (_e, a) => { recus.push(a.cible); } }));
  assert.match(chat, /2\. Programme &amp; conception/);
  assert.match(chat, /mz-parcours__renvoi/);
  assert.doesNotMatch(chat, /aria-label="Étape 2[^"]*"/, 'devis dans le fil : aucun bouton concurrent sur l’étape 2');
  assert.doesNotMatch(chat, />(Valider|Lancer la mission)</);
  // 23/11 : le récapitulatif de l'Espace 3D n'a aucune commande (la carte du devis, dans le fil, est la seule).
  const panneau = rendre(h(m.ParcoursPanneau, { parcours: p }));
  assert.doesNotMatch(panneau, /mz-parcours__action|>Lancer la mission</);
});

// ── 3. Conception terminée puis devis postérieurs non lancés (données réelles du 23/11, agent_missions) ────────────────
const MISSIONS_REELLES = [
  { id: 'e50ffdf7-351e-4ea4-88dc-aa4b25131fcc', type: 'conception', statut: 'echec', conversation_id: CONV, cree_le: '2026-11-23T09:25:43Z', criteres: { idu: '64065000AI0002', programme: 'petit collectif R+2' } },
  { id: 'd1cde026-7f59-460f-bae4-e41125555b4c', type: 'conception', statut: 'terminee', conversation_id: CONV, cree_le: '2026-11-23T09:42:35Z', criteres: { idu: '64065000AI0002', programme: 'Collectif R+2, ~12 logements dont 60% LLS, toiture à pentes' } },
  { id: 'fe48713e-6034-4890-91eb-a164b91ecc17', type: 'conception', statut: 'devis', conversation_id: CONV, cree_le: '2026-11-23T10:01:03Z', criteres: { idu: '64065000AI0002', programme: 'Collectif R+2 toiture à pentes' } },
  { id: 'bd7b18cb-3a7c-4330-924c-321ef057720a', type: 'conception', statut: 'devis', conversation_id: CONV, cree_le: '2026-11-23T10:02:47Z', criteres: { idu: '64065000AI0002', programme: 'logements collectifs R+2' } },
];

test('cas réel : conception d1cde026 TERMINÉE + 2 devis postérieurs non lancés → étape 2 FAITE, pas de « Lancer »', async () => {
  const { missionConceptionDeReference } = await import('../../../lib/studio/parcours.ts');
  const ref = missionConceptionDeReference(MISSIONS_REELLES);
  assert.equal(ref.mission?.id, 'd1cde026-7f59-460f-bae4-e41125555b4c');
  assert.equal(ref.autreDevis?.id, 'bd7b18cb-3a7c-4330-924c-321ef057720a');
  const s = assemblerSourcesEcran({ messages: [], conversationId: CONV, typeChoisi: null, parcelle: null, brief: null, film: null, visite: null, missions: MISSIONS_REELLES, travaux: [] });
  assert.equal(s.conception?.statut, 'terminee');
  const e = calculerParcours(s).etapes[1];
  assert.equal(e.statut, 'fait');
  assert.notEqual(e.action.cible, 'mission');
  assert.equal(e.carteDansLeFil, undefined);
  assert.match(e.resume, /Un autre devis de conception attend/);
  // Une mission postérieure réellement LANCÉE sur ce terrain reprend la main (conception refaite en cours).
  const relance = [...MISSIONS_REELLES, { id: 'x1', type: 'conception', statut: 'en_cours', conversation_id: CONV, cree_le: '2026-11-23T10:05:00Z', criteres: { idu: '64065000AI0002' } }];
  assert.equal(missionConceptionDeReference(relance).mission?.id, 'x1');
  // Un devis sur un AUTRE terrain est un nouveau projet : il fait foi.
  const autre = [...MISSIONS_REELLES, { id: 'x2', type: 'conception', statut: 'devis', conversation_id: CONV, cree_le: '2026-11-23T10:06:00Z', criteres: { idu: '64065000AI0001' } }];
  assert.equal(missionConceptionDeReference(autre).mission?.id, 'x2');
  // Le bloc serveur interdit de reproposer une conception faite.
  assert.match(blocParcoursSysteme(calculerParcours(s)), /ne propose PAS de nouvelle mission de conception/);
});
