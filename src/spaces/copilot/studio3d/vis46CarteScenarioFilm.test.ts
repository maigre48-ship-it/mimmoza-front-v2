// npx tsx --test src/spaces/copilot/studio3d/vis46CarteScenarioFilm.test.ts
// VIS-46 — carte « Scénario du film » : lecture de la sortie de l'outil, retouches à la main (total recalculé en
// direct, bornes), ajout impossible refusé, même carte pour l'Espace 3D, message du clic relu par le serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capacitesDepuisModele, lireBlocScenario, messageScenario, proposerScenarios, OUTIL_PROPOSER_FILM } from '../../../lib/studio/filmsChat.ts';
import { empreinteScenario } from '../../../lib/studio/scenarioFilm.ts';
import { ajouterPlan, deplacerPlan, derniereCarteScenarios, etatScenario, lireCarteScenarios, majPlan, supprimerPlan } from './scenarioFilmChat.ts';

const FX = JSON.parse(readFileSync(new URL('../../../lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url), 'utf8'));
const cap = capacitesDepuisModele(FX.dessin.modele, { empreinte: 'mb1-x' });
const props = proposerScenarios(cap);
const tc = { id: 'tc1', name: OUTIL_PROPOSER_FILM, status: 'success', output: { status: 'ok', data: { carte: 'scenarios-film', version: 1, choisi: null, propositions: props, differences: [], projet: { nom: cap.nom, sujets: cap.sujets, raisons: cap.raisons }, cout: 'Aucun débit' } } };

test('lecture de la carte (et refus des autres outils / sorties)', () => {
  const c = lireCarteScenarios(tc)!;
  assert.equal(c.propositions.length, 3);
  assert.equal(c.projet.nom, 'Maison hexagonale avec tourelle et garage');
  assert.equal(lireCarteScenarios({ ...tc, name: 'studio_lancer_rendu' }), null);
  assert.equal(lireCarteScenarios({ ...tc, status: 'running' }), null);
  assert.equal(lireCarteScenarios({ ...tc, output: { status: 'error' } }), null);
});

test('retouches : durée bornée, total recalculé en direct, ordre, retrait (3 plans minimum)', () => {
  let s = props[0];
  const t0 = s.duree_s;
  s = majPlan(s, 0, { duree_s: 40 });
  assert.equal(s.plans[0].duree_s, 15);
  assert.equal(s.duree_s, t0 - 8 + 15);
  s = deplacerPlan(s, 0, 2);
  assert.equal(s.plans[2].sujet, 'exterieur_rue');
  const trois = supprimerPlan(supprimerPlan(supprimerPlan(props[2], 0), 0), 0);
  assert.equal(trois.plans.length, 3, 'jamais moins de 3 plans');
  assert.ok(etatScenario(s).ok);
});

test('ajout : cuisine possible ; balcon impossible pour la maison hexagonale (rien ne change)', () => {
  const c = lireCarteScenarios(tc)!;
  const avec = ajouterPlan(props[0], 'cuisine', c.projet);
  assert.equal(avec.plans.length, props[0].plans.length + 1);
  assert.equal(avec.plans[avec.plans.length - 2].sujet, 'cuisine');
  assert.equal(ajouterPlan(props[0], 'balcon', c.projet), props[0]);
});

test('bornes : total sous 15 s signalé, bouton de lancement désactivé', () => {
  let s = props[2];
  s.plans.forEach((_, i) => { s = majPlan(s, i, { duree_s: 2 }); });
  const e = etatScenario(s);
  assert.equal(e.ok, false);
  assert.match(e.erreurs.join(' '), /de 15 à 120 s/);
});

test('Espace 3D : même carte (dernière de la conversation) ; message du clic = bloc relu tel quel', () => {
  const c = derniereCarteScenarios([{ role: 'assistant', toolCalls: [tc] }, { role: 'user' }]);
  assert.equal(c?.appelId, 'tc1');
  const s = majPlan(props[1], 1, { prompt: 'Le séjour au petit matin' });
  const b = lireBlocScenario(messageScenario('lancer', s, 2));
  assert.ok(b && b.ok);
  if (b && b.ok) assert.equal(empreinteScenario(b.valeur.scenario), empreinteScenario(s));
});
