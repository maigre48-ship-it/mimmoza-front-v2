// VIS-04 (18/11/2026) — brief projet relié au rendu, côté front : catalogue des vues, assemblage et versionnage du
// brief, passage unique vers le contrat v2 (construireProjetChat), rétrocompatibilité stricte, blocs du chat,
// options d'image, vues non produites, matière de façade prioritaire sur le texte de la fiche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueVues, PACK_PLAQUETTE, VUES_DISPONIBLES, vuesARendre, vuesPreCochees, vuesDisponibles } from './catalogueVues.ts';
import {
  assemblerBriefProjet, champsContrat, empreinteBriefProjet, empreinteChamps, facadeDesChamps, lireBriefProjet, lireChampsContrat,
  materiauxHabillage, partieProgramme, projetAvecBriefProjet, resumeBriefProjet,
} from './briefProjet.ts';
import { lireVuesNonProduites, phrasesVuesNonProduites, validerOptions } from './travauxLogique.ts';
import { construireProjetChat, type EntreeProjetChat } from '../../spaces/copilot/studio3d/projetChat.ts';
import { messageBrief, etatInitial, champsBloc } from '../../spaces/copilot/studio3d/briefCreatif.ts';
import { messageVues } from '../../spaces/copilot/studio3d/choixFond.ts';
import { studioCommand } from '../../spaces/copilot/studio3d/jarvisDraft.ts';

const STYLE = {
  target: 'Jeunes actifs', selectedFamily: 'durable', generatedAt: '2026-11-18T10:00:00.000Z',
  directions: [
    { family: 'durable', title: 'Durable chaleureux', intent: 'Matières naturelles', palette: [{ name: 'Bronze', hex: '#7D6748', use: 'menuiseries' }, { name: 'x', hex: 'rouge', use: '' }], materials: ['Bois certifié'], sourceIds: ['ref1'] },
    { family: 'expressif', title: 'Expressif', intent: '…', palette: [], materials: ['Céramique'], sourceIds: [] },
  ],
};
const PROGRAMME = { batiments: [{ niveaux: 4, typologies: { T2: 10, T3: 6 }, surfaces: { T2: 48, T3: 66 } }, { niveaux: 3, typologies: { T2: 2 }, surfaces: { T2: 54 } }] };
const base = (maj: Partial<Parameters<typeof assemblerBriefProjet>[0]> = {}) => assemblerBriefProjet({
  etudeId: 'etude-1', precedent: null, maintenant: '2026-11-18T12:00:00.000Z', style: STYLE,
  references: [{ id: 'ref1', title: 'Les Ateliers', url: 'https://exemple.fr/a', observation: 'Socle minéral' }, { id: 'ref2', title: 'Autre', url: 'http://non-https', observation: '' }],
  programme: PROGRAMME, habillage: { facade: 'brique', teinte: 'claire', menuiseries: 'anthracite', garde_corps: 'verre', balcons: 'balcons', soubassement: 'aucun' }, ...maj,
});

const PARCELLE = { type: 'Feature', properties: { idu: '64065000AI0001', code_insee: '64065', contenance: 812 },
  geometry: { type: 'Polygon', coordinates: [[[-1.4750, 43.4920], [-1.4744, 43.4920], [-1.4744, 43.4925], [-1.4750, 43.4925], [-1.4750, 43.4920]]] } };
const ENTREE = {
  conversationId: '3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f', etudeId: 'etude-1', sessionId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  origine: 'https://mimmoza.vercel.app', retourUrl: null, revision: 0, horodatage: '2026-11-18T12:00:00.000Z',
  parcelles: [{ id: '64065000AI0001', feature: PARCELLE }], communeInsee: '64065', adresse: 'Bayonne', pointAdresse: { lat: 43.4921, lon: -1.4747 }, relief: null,
  implantation: { lon: -1.4747, lat: 43.49225, orientationDeg: 12, entryOffsetM: 0 },
  brief: 'Dossier 3D', commandeArchitecture: 'Crée un immeuble R+3 de 30 m sur 14 m.',
} as unknown as EntreeProjetChat;

// VIS-10 (19/11/2026) : privatifs et séjour / chambre / vue_baie « sous condition » (worker VIS-INT-2), hall « bientôt ».
test('catalogue des vues : 15 identifiants communs, extérieurs livrés, privatifs et intérieurs « sous condition », hall « bientôt »', () => {
  const c = catalogueVues();
  assert.equal(c.length, 15);
  assert.deepEqual(VUES_DISPONIBLES, ['trois_quarts_gauche', 'trois_quarts_droite', 'face', 'angle_rue', 'aerienne', 'entree', 'coeur_ilot',
    'terrasse', 'balcon', 'jardin_prive', 'rooftop', 'sejour', 'chambre', 'vue_baie']);
  assert.ok(c.filter((v) => v.groupe !== 'exterieur' && v.id !== 'hall').every((v) => v.statut === 'sous_condition' && !!v.condition));
  assert.equal(c.find((v) => v.id === 'hall')?.statut, 'bientot');
  assert.ok(c.filter((v) => v.groupe === 'exterieur').every((v) => v.statut === 'disponible' && v.condition === undefined));
  // Pack plaquette pré-coché : identique au worker (PACKS.pack_plaquette), entier.
  assert.deepEqual(PACK_PLAQUETTE, ['trois_quarts_gauche', 'trois_quarts_droite', 'aerienne', 'coeur_ilot', 'terrasse', 'sejour']);
  assert.deepEqual(vuesPreCochees(), ['trois_quarts_gauche', 'trois_quarts_droite', 'aerienne', 'coeur_ilot', 'terrasse', 'sejour']);
  // Repli VIS-10 coupé : exactement le catalogue VIS-04 ; les deux coupés : les 3 vues d'avant le chantier.
  assert.deepEqual(vuesDisponibles(true, false), ['trois_quarts_gauche', 'trois_quarts_droite', 'face', 'angle_rue', 'aerienne', 'entree', 'coeur_ilot']);
  assert.deepEqual(vuesPreCochees(true, false), ['trois_quarts_gauche', 'trois_quarts_droite', 'aerienne', 'coeur_ilot']);
  assert.ok(catalogueVues(true, false).filter((v) => v.groupe !== 'exterieur').every((v) => v.statut === 'bientot'));
  assert.deepEqual(vuesDisponibles(false, false), ['trois_quarts_gauche', 'trois_quarts_droite', 'face']);
  assert.deepEqual(vuesARendre(['hall', 'sejour', 'aerienne', 'vue_mer', 'face']), { vues: ['face', 'aerienne', 'sejour'], nonProduites: ['hall'], inconnues: ['vue_mer'] });
});

test('brief projet : direction RETENUE, palette valide, références https de la direction, programme agrégé, habillage en premier', () => {
  const b = base();
  assert.equal(b.revision, 1);
  assert.equal(b.cible, 'Jeunes actifs');
  assert.equal(b.directionStyle?.titre, 'Durable chaleureux');
  assert.deepEqual(b.palette, [{ nom: 'Bronze', hex: '#7d6748', usage: 'menuiseries' }]);
  assert.deepEqual(b.references, [{ titre: 'Les Ateliers', url: 'https://exemple.fr/a', note: 'Socle minéral' }]);
  assert.deepEqual(b.programme.typologies, [{ type: 'T2', nombre: 12, shabM2: 49 }, { type: 'T3', nombre: 6, shabM2: 66 }]);
  assert.deepEqual(b.programme.mix, { batiments: 2, niveaux: 4, shabTotaleM2: 984, nature: 'vise' });
  assert.deepEqual(b.materiaux.map((m) => `${m.role}:${m.libelle}`), ['facade:brique claire', 'menuiseries:menuiseries anthracite', 'garde_corps:garde-corps en verre', 'autre:Bois certifié']);
  assert.equal(facadeDesChamps(champsContrat(b)), 'brique claire');
  assert.match(String(resumeBriefProjet(b)), /direction Durable chaleureux · 18 logements \(T2 × 12, T3 × 6\)/);
});

test('versionnage : la révision n’augmente que si ce qui part au rendu change ; relecture défensive du stockage', () => {
  const b1 = base();
  const b2 = base({ precedent: b1, maintenant: '2026-11-18T13:00:00.000Z' });
  assert.equal(b2.revision, 1);
  assert.equal(b2.majLe, b1.majLe);
  const b3 = base({ precedent: b2, reglages: { gamme: 'premium', vues: ['aerienne', 'face'] }, maintenant: '2026-11-18T14:00:00.000Z' });
  assert.equal(b3.revision, 2);
  assert.deepEqual(b3.rendu.vues, ['face', 'aerienne']);
  assert.notEqual(empreinteBriefProjet(b3), empreinteBriefProjet(b2));
  assert.deepEqual(lireBriefProjet(JSON.parse(JSON.stringify(b3))), b3);
  assert.equal(lireBriefProjet({ version: 2 }), null);
  const pollue = lireBriefProjet({ ...b3, gamme: 'ultra', palette: [{ nom: 'x', hex: 'javascript:' }], rendu: { vues: ['vue_mer', 'face'] } })!;
  assert.equal(pollue.gamme, null);
  assert.deepEqual(pollue.palette, []);
  assert.deepEqual(pollue.rendu.vues, ['face']);
});

test('habillage → libellés du lexique du Studio (teinte comprise, garde-corps seulement avec balcons)', () => {
  assert.deepEqual(materiauxHabillage({ facade: 'beton', teinte: 'claire', menuiseries: 'gris', garde_corps: 'metal', balcons: 'aucun', soubassement: 'pierre', toiture: 'deux_pans_zinc' }).map((m) => m.libelle),
    ['béton blanc', 'menuiseries aluminium gris', 'soubassement en pierre', 'toiture en zinc']);
  assert.deepEqual(materiauxHabillage({ facade: 'bardage_bois', teinte: 'foncee' }).map((m) => m.libelle), ['bois brûlé']);
  assert.deepEqual(partieProgramme(null), { typologies: [], mix: null });
});

test('contrat : passage unique — sans brief, MÊME objet et même projet ; avec, champs validés par le contrat v2', () => {
  const sans = construireProjetChat(ENTREE);
  const nul = construireProjetChat({ ...ENTREE, briefProjet: null });
  const vide = construireProjetChat({ ...ENTREE, briefProjet: {} });
  assert.ok(sans.ok && nul.ok && vide.ok);
  assert.equal(JSON.stringify(nul), JSON.stringify(sans));
  assert.equal(JSON.stringify(vide), JSON.stringify(sans));
  if (!sans.ok) return;
  assert.equal(projetAvecBriefProjet(sans.projet, null).ok && (projetAvecBriefProjet(sans.projet, null) as { projet: unknown }).projet, sans.projet);
  const champs = champsContrat(base({ reglages: { vues: ['aerienne'], saison: 'hiver' } }));
  const avec = construireProjetChat({ ...ENTREE, briefProjet: champs });
  assert.ok(avec.ok, avec.ok ? '' : avec.erreur);
  if (!avec.ok) return;
  assert.equal(avec.projet.brief?.directionStyle?.titre, 'Durable chaleureux');
  assert.deepEqual(avec.projet.rendu, { vues: ['aerienne'], ambiance: null, saison: 'hiver' });
  assert.equal(avec.projet.programme.typologies?.length, 2);
  assert.equal(avec.projet.programme.commandeArchitecture, sans.projet.programme.commandeArchitecture);
  const refuse = construireProjetChat({ ...ENTREE, briefProjet: { rendu: { vues: ['vue_mer'] } } as never });
  assert.equal(refuse.ok, false);
  assert.equal(empreinteChamps({}), 'vide');
  assert.deepEqual(lireChampsContrat({ brief: {}, rendu: {} }), { brief: {}, rendu: {} });
  assert.equal(lireChampsContrat({ autre: 1 }), null);
});

test('blocs du chat : sans brief projet, message de brief identique ; avec, `projet` et `vues` (image seulement)', () => {
  const etat = etatInitial({ actuel: null, ambiances: ['jour', 'fin_de_journee'] });
  const d = { type: 'image' as const, limites: { batiments: 1, balcons: true, ailes: false } };
  assert.equal(messageBrief(etat, d, true), messageBrief(etat, d, true, {}));
  assert.ok(!messageBrief(etat, d, true).includes('"projet"'));
  const avec = messageBrief(etat, d, true, { projet: { rendu: { vues: ['face'], ambiance: null, saison: null } }, vues: ['face'] });
  assert.match(avec, /"projet":\{"rendu"/);
  assert.match(avec, /"vues":\["face"\]/);
  assert.deepEqual(champsBloc({ vues: ['face'] }, false), {});
  const v = messageVues({ actuel: { ...etat.choix, defauts: [], origine: 'message' } as never }, ['trois_quarts_gauche', 'aerienne'], null, {});
  assert.match(String(v), /^Vues de l’image : 3\/4 gauche, aérienne\./);
  assert.match(String(v), /"vues":\["trois_quarts_gauche","aerienne"\]/);
});

test('options image (FilmVisitePanel) : 1 à 6 vues livrées, crépuscule ; vues non produites lues avec leur raison', () => {
  assert.equal(validerOptions('image', { vues: ['aerienne', 'coeur_ilot'], ambiance: 'crepuscule' }).ok, true);
  assert.equal(validerOptions('image', { vues: ['sejour'] }).ok, true); // VIS-10 : sous condition (le worker tranche)
  assert.equal(validerOptions('image', { vues: ['hall'] }).ok, false);
  const r = validerOptions('image', { vues: ['face', 'aerienne', 'entree', 'angle_rue', 'coeur_ilot', 'trois_quarts_gauche', 'trois_quarts_droite'] });
  assert.equal(r.ok, false);
  assert.match((r as { erreur: string }).erreur, /de 1 à 6 vues/);
  const nonProduites = lireVuesNonProduites([{ id: 'terrasse', raison: 'composition des vues d’extérieurs privatifs non livrée.' }, { id: 7 }]);
  assert.deepEqual(phrasesVuesNonProduites({ vues_non_produites: nonProduites }), ['Vue « Terrasse » non produite : composition des vues d’extérieurs privatifs non livrée.']);
});

test('matière de façade : celle du brief passe avant le texte de la fiche ; sans brief, commande inchangée', () => {
  const draft = { version: 1, objectif: 'Crée un immeuble R+3', localisation: null, programme: null, dimensions: '30 m sur 14 m', style: 'façade en brique', contraintes: null, questions: [], pieces: [] } as never;
  assert.equal(studioCommand(draft), 'Crée un immeuble R+3 de 30 m sur 14 m en brique.');
  assert.equal(studioCommand(draft, null), studioCommand(draft));
  assert.equal(studioCommand(draft, 'pierre claire'), 'Crée un immeuble R+3 de 30 m sur 14 m en pierre claire.');
});
