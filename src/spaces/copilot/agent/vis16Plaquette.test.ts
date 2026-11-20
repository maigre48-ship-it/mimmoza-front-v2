// node --test src/spaces/copilot/agent/vis16Plaquette.test.ts
// LOT VIS-16 — « Préparer la plaquette » (essai du 20/11/2026, conversation f9fa5476…) côté écran :
//   1. clic dans le panneau Missions → la conversation de la mission revient au premier plan (panneau fermé, défilement) ;
//   3. les vues prévues par le serveur (pack plaquette) repartent avec l'habillage (tour suivant sans le mot « plaquette ») ;
//   4. carte d'action : pré-remplie avec le brief projet, ce qui sera chiffré est DIT, « À toi de choisir » possible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationAOuvrir, EVENEMENT_CONVERSATION_PREMIER_PLAN, MESSAGE_PACK_PLAQUETTE } from './projet3DMission.ts';
import { demandePreremplie, etatInitial, lireDemandeBrief, messageBrief, phraseAttenteBrief } from '../studio3d/briefCreatif.ts';
import { habillageDuBriefProjet, materiauxHabillage } from '../../../lib/studio/briefProjet.ts';
import { PACK_PLAQUETTE } from '../../../lib/studio/catalogueVues.ts';

const CONV = 'f9fa5476-11db-4eda-8692-2051aa13b653';
const PACK = [...PACK_PLAQUETTE];
/** Durée RÉELLE annoncée par le serveur pour ces 6 vues (studio.ts dureeAnnoncee). */
const DUREE = 'environ 2 h 29 à 9 h 23 une fois le rendu démarré (préparation, aperçu de contrôle, puis 20 à 60 min par vue, jusqu’au double pour une vue décentrée ou aérienne rendue plus grande)';

/** Sortie RÉELLE (forme) de studio_lancer_rendu au 3e clic, après VIS-16 : brief requis + vues prévues du pack. */
const sortieBrief = (extra: Record<string, unknown> = {}) => ({
  name: 'studio_lancer_rendu', status: 'success',
  output: { status: 'partial', data: {
    brief_requis: true, type: 'image', carte: 'brief_creatif', champs: { ambiance: { valeurs: ['jour', 'fin_de_journee'] } },
    limites: { batiments: 3, balcons: true }, vues_prevues: PACK, duree_prevue: DUREE, pack: 'plaquette', ...extra,
  } },
});

test('VIS-16 point 1 : la carte du panneau Missions ramène la conversation de la mission au premier plan', () => {
  assert.equal(EVENEMENT_CONVERSATION_PREMIER_PLAN, 'mimmoza:conversation-premier-plan');
  // Déjà affichée : rien à rouvrir (le panneau se ferme, la conversation défile jusqu'à la réponse).
  assert.equal(conversationAOuvrir({ conversation_id: CONV }, CONV, 'conversation'), null);
  // Autre conversation à l'écran, ou accueil : celle de la mission est rouverte AVANT l'envoi.
  assert.equal(conversationAOuvrir({ conversation_id: CONV }, 'autre', 'conversation'), CONV);
  assert.equal(conversationAOuvrir({ conversation_id: CONV }, CONV, 'welcome'), CONV);
  assert.equal(conversationAOuvrir({ conversation_id: null }, 'autre', 'conversation'), null);
  // Le message de la carte demande bien la plaquette (lu par le serveur : pack plaquette + état réel de la mission).
  assert.match(MESSAGE_PACK_PLAQUETTE, /plaquette/);
});

test('VIS-16 point 3 : vues prévues (pack plaquette, 6 vues) lues et renvoyées avec l’habillage', () => {
  const d = lireDemandeBrief(sortieBrief());
  assert.ok(d);
  assert.deepEqual(d!.vuesPrevues, PACK);
  assert.equal(d!.pack, true);
  const m = messageBrief(etatInitial(d!), d!, true);
  const bloc = JSON.parse(m.slice(m.indexOf('{'), m.lastIndexOf('}') + 1));
  assert.deepEqual(bloc.vues, PACK, 'le tour suivant (« Brief créatif… ») garde le pack');
  assert.equal(bloc.brief.a_toi_de_choisir, true);
  // Vues choisies explicitement (carte du devis) : elles priment.
  const m2 = messageBrief(etatInitial(d!), d!, false, { vues: ['aerienne'] });
  assert.deepEqual(JSON.parse(m2.slice(m2.indexOf('{'), m2.lastIndexOf('}') + 1)).vues, ['aerienne']);
  // Sortie d'avant VIS-16 (sans vues prévues) : bloc identique à avant.
  const ancien = lireDemandeBrief({ ...sortieBrief(), output: { status: 'partial', data: { brief_requis: true, type: 'image' } } });
  const m3 = messageBrief(etatInitial(ancien!), ancien!, true);
  assert.equal('vues' in JSON.parse(m3.slice(m3.indexOf('{'), m3.lastIndexOf('}') + 1)), false);
});

test('VIS-16 point 4 : carte d’action — ce qui sera chiffré est dit, avec la durée courte ; pré-remplissage dit', () => {
  const d = lireDemandeBrief(sortieBrief())!;
  const p = phraseAttenteBrief(d);
  assert.match(p, /^Mimmo attend votre habillage pour chiffrer le pack plaquette : 6 vues \(3\/4 gauche, 3\/4 droite, aérienne, cœur d’îlot, terrasse, séjour\), environ 2 h 29 à 9 h 23 une fois le rendu démarré\./);
  assert.doesNotMatch(p, /\(préparation/);
  assert.match(p, /laissez Mimmo choisir/);
  // Pré-remplie par le serveur (brief projet vu dans le fil).
  const serveur = lireDemandeBrief(sortieBrief({ prerempli: 'brief_projet', actuel: {
    facade: 'brique', ouvertures: 'fenetres_verticales', balcons: 'balcons', attique: false, rdc: 'logements', ambiance: 'jour',
    toiture: 'terrasse', teinte: 'claire', garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'aucun', defauts: ['ouvertures', 'attique', 'rdc'],
  } }))!;
  assert.equal(serveur.prerempli, true);
  assert.equal(serveur.actuel?.facade, 'brique');
  assert.match(phraseAttenteBrief(serveur), /pré-rempli avec votre brief projet/);
});

test('VIS-16 point 4 : pré-remplissage avec l’habillage mémorisé du brief projet de l’étude', () => {
  const d = lireDemandeBrief(sortieBrief())!;
  assert.equal(d.actuel, null);
  const h = { facade: 'bardage_bois', teinte: 'foncee', menuiseries: 'bronze', balcons: 'loggias', ambiance: 'fin_de_journee' };
  const p = demandePreremplie(d, h);
  assert.equal(p.prerempli, true);
  assert.deepEqual([p.actuel?.facade, p.actuel?.teinte, p.actuel?.balcons, p.actuel?.ambiance], ['bardage_bois', 'foncee', 'loggias', 'fin_de_journee']);
  // Champs absents : proposés par Mimmo (comptés « par défaut ») ; les connus sont gardés par « À toi de choisir ».
  assert.ok(p.actuel?.defauts.includes('rdc') && !p.actuel?.defauts.includes('facade'));
  const e = etatInitial(p);
  assert.ok(e.touches.includes('facade') && !e.touches.includes('rdc'));
  const bloc = JSON.parse(messageBrief(e, p, true).split('```')[1].replace(/^mimmoza-brief\n/, ''));
  assert.deepEqual([bloc.brief.facade, bloc.brief.a_toi_de_choisir], ['bardage_bois', true]);
  // Rien à pré-remplir : demande inchangée ; habillage illisible : inchangée ; sous un devis : inchangée.
  assert.equal(demandePreremplie(d, null), d);
  assert.equal(demandePreremplie(d, { facade: 'marbre' }), d);
  assert.equal(demandePreremplie({ ...d, origine: 'devis' }, h).prerempli, undefined);
});

test('VIS-16 : brief projet enregistré → habillage (sens inverse exact de materiauxHabillage)', () => {
  const h = { facade: 'brique', teinte: 'claire', menuiseries: 'anthracite', garde_corps: 'verre', soubassement: 'pierre', toiture: 'deux_pans_zinc', balcons: 'balcons' };
  const lu = habillageDuBriefProjet({ brief: { materiaux: materiauxHabillage(h) }, rendu: { ambiance: 'fin_de_journee' } });
  assert.deepEqual(lu, { facade: 'brique', teinte: 'claire', menuiseries: 'anthracite', garde_corps: 'verre', soubassement: 'pierre', toiture: 'deux_pans_zinc', ambiance: 'fin_de_journee' });
  assert.equal(habillageDuBriefProjet({ brief: { materiaux: [{ role: 'autre', libelle: 'Bois certifié' }] }, rendu: { ambiance: 'crepuscule' } }), null);
  assert.equal(habillageDuBriefProjet(null), null);
});
