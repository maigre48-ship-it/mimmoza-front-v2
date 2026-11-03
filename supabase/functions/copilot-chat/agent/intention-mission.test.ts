// deno test copilot-chat/agent/intention-mission.test.ts
import * as na from 'node:assert/strict';
import {
  CONSIGNE_FILET_MISSION, OUTILS_CADRAGE_MISSION, consigneIntentionMission, detecterIntentionMission, proposeMissionEnTexte,
} from './intention-mission.ts';

const OUI: Array<[string, string]> = [
  // L'incident réel du 02/11.
  ['trouve les 4 meilleurs terrains pour faire un immeuble social de 40 logements à Nanterre', 'prospection_fonciere'],
  ['Trouve-moi des terrains de 1 000 à 3 000 m² en zone U à Montreuil', 'prospection_fonciere'],
  ['Cherche 3 parcelles constructibles à Bezons', 'prospection_fonciere'],
  ['Peux-tu prospecter du foncier à Colombes pour 60 logements ?', 'prospection_fonciere'],
  ['Lance une prospection foncière sur Rueil et Suresnes', 'prospection_fonciere'],
  ['Quels sont les 3 meilleurs sites pour une résidence senior à Puteaux ?', 'prospection_fonciere'],
  ['Où puis-je construire 30 logements à Nanterre ? Donne-moi les meilleures parcelles', 'prospection_fonciere'],
  ['Compare les parcelles 92050000AB0012 et 92050000AB0013', 'faisabilite'],
  ['Compare ces trois terrains et dis-moi lequel est le meilleur', 'faisabilite'],
  ['Classe ces parcelles par potentiel', 'faisabilite'],
  ['Fais un dossier complet sur chacune des 5 parcelles de la liste', 'faisabilite'],
  ['Étude de faisabilité multi-parcelles sur l\'îlot', 'faisabilite'],
];

const NON: string[] = [
  "Fais l'étude de la parcelle 92050000AB0012",
  'Quel est le zonage PLU de ce terrain ?',
  'Analyse complète du 6 parc de la Bérengère à Saint-Cloud',
  'Compare les prix DVF de Nanterre et de Puteaux',
  'Quel est le taux de logements sociaux à Nanterre ?',
  'Où en est ma mission de prospection ?',
  'Statut de la mission sur les terrains de Nanterre',
  'Liste mes missions',
  'trouve les 4 meilleurs terrains à Nanterre, sans mission, fais-le ici',
  'Quel est le coût de construction au m² pour 40 logements ?',
  'merci',
  'Quelles sont les parcelles voisines de mon terrain ?',
  'Liste des parcelles de la section AB',
  'Donne-moi les parcelles cadastrales de cette adresse',
  '',
];

Deno.test('intention mission : demandes multi-terrains détectées (dont l\'incident du 02/11)', () => {
  for (const [m, type] of OUI) {
    const r = detecterIntentionMission(m);
    na.equal(r.mission, true, `devrait déclencher : ${m}`);
    na.equal(r.type, type, `type pour : ${m}`);
  }
});

Deno.test('intention mission : demandes simples, refus et suivi de mission ignorés', () => {
  for (const m of NON) na.equal(detecterIntentionMission(m).mission, false, `ne devrait pas déclencher : ${m}`);
});

Deno.test('filet : la proposition de mission EN TEXTE est reconnue (phrase de l\'incident)', () => {
  na.equal(proposeMissionEnTexte(
    'Souhaitez-vous que je lance une mission approfondie pour instruire les 4 parcelles (PLU, bilan, propriétaires) ?'), true);
  na.equal(proposeMissionEnTexte('Je peux lancer une mission autonome pour comparer ces terrains.'), true);
  na.equal(proposeMissionEnTexte('Veux-tu que je prépare une mission de prospection ?'), true);
  na.equal(proposeMissionEnTexte('Prochaine étape : lancer une mission de prospection sur Nanterre.'), true);
});

Deno.test('filet : pas de faux positif', () => {
  na.equal(proposeMissionEnTexte('Le terrain est situé en zone UA. Aucune servitude relevée.'), false);
  na.equal(proposeMissionEnTexte("Ces fichiers sont réservés aux organismes chargés d'une mission de service public."), false);
  na.equal(proposeMissionEnTexte('Signez la lettre de mission avec votre architecte.'), false);
  na.equal(proposeMissionEnTexte('Votre mission est en cours : 3 parcelles étudiées sur 5.'), false);
});

Deno.test('cadrage : les études coûteuses sont exclues, proposer_mission inclus', () => {
  na.ok(OUTILS_CADRAGE_MISSION.has('proposer_mission'));
  na.ok(OUTILS_CADRAGE_MISSION.has('rechercher_parcelles'));
  for (const lourd of ['get_etude_parcelle', 'get_etude_marche', 'get_dvf_comparables', 'get_risks_georisques', 'get_parcel_plu']) {
    na.ok(!OUTILS_CADRAGE_MISSION.has(lourd), lourd);
  }
  const c = consigneIntentionMission({ mission: true, type: 'prospection_fonciere', motif: 'x' });
  na.match(c, /proposer_mission/);
  na.match(c, /AU PLUS un appel de cadrage/);
  na.match(CONSIGNE_FILET_MISSION, /proposer_mission/);
});
