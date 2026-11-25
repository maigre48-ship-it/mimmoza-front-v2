// npx tsx --test src/lib/studio/vis46ScenarioFilm.test.ts
// VIS-46 — contrat ScenarioFilm v1 (bornes, corrections, empreinte) et films proposés par le chat (projet réel :
// « Maison hexagonale avec tourelle et garage », Ascain AI0002, sans balcon ni terrasse ni baie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { empreinteScenario, resumerScenario, validerScenario, type ScenarioFilm } from './scenarioFilm.ts';
import {
  capacitesDepuisBrief, capacitesDepuisModele, differencesScenarios, lireBlocScenario, messageScenario, modifierScenarioParPhrase,
  optionsFilmDepuisScenario, plansImpossibles, proposerScenarios, sansBlocScenario,
} from './filmsChat.ts';

const FX = JSON.parse(readFileSync(new URL('./__fixtures__/vis34-ascain-ai0002.json', import.meta.url), 'utf8'));
const HEX = FX.dessin.modele;

const base = (): ScenarioFilm => ({
  v: 1, titre: 'Essai', intention: 'Un film court.', duree_s: 30, format: '16:9', ambiance: 'jour', style: 'commercial',
  musique: { ambiance: 'douce' }, voix_off: null,
  plans: [
    { id: 'a', prompt: 'Rue', sujet: 'exterieur_rue', mouvement: 'travelling_avant', duree_s: 10 },
    { id: 'b', prompt: 'Façade', sujet: 'facade', mouvement: 'orbite', duree_s: 10 },
    { id: 'c', prompt: 'Ciel', sujet: 'aerien', mouvement: 'drone_montee', duree_s: 10 },
  ],
});

test('validerScenario : scénario correct accepté sans correction', () => {
  const v = validerScenario(base());
  assert.ok(v.ok);
  if (v.ok) { assert.deepEqual(v.corrections, []); assert.equal(v.scenario.duree_s, 30); }
});

test('validerScenario : bornes du nombre de plans (3 à 12)', () => {
  const s = base();
  assert.equal(validerScenario({ ...s, plans: s.plans.slice(0, 2) }).ok, false);
  const treize = Array.from({ length: 13 }, (_, i) => ({ ...s.plans[0], id: `x${i}`, duree_s: 5 }));
  assert.equal(validerScenario({ ...s, plans: treize, duree_s: 65 }).ok, false);
  const douze = treize.slice(0, 12);
  assert.ok(validerScenario({ ...s, plans: douze, duree_s: 60 }).ok);
});

test('validerScenario : durée de plan ramenée dans 2–15 s, total corrigé ET dit', () => {
  const s = base();
  s.plans[0].duree_s = 20; s.plans[1].duree_s = 1;
  const v = validerScenario(s);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.scenario.plans[0].duree_s, 15);
  assert.equal(v.scenario.plans[1].duree_s, 2);
  assert.equal(v.scenario.duree_s, 27);
  assert.ok(v.corrections.some((c) => /durée du film 30 s corrigée en 27 s/.test(c)), v.corrections.join(' | '));
  assert.ok(v.corrections.some((c) => /plan 1 : durée 20 s ramenée à 15 s/.test(c)));
});

test('validerScenario : total hors 15–120 s ramené dans les bornes (plans étirés) ET dit', () => {
  const s = base();
  s.plans.forEach((p) => { p.duree_s = 4; });
  const v = validerScenario(s);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.scenario.duree_s, 15);
  assert.ok(v.corrections.some((c) => /12 s allongée à 15 s/.test(c)), v.corrections.join(' | '));
});

test('validerScenario : prompt > 280 et texte à l’écran > 60 raccourcis (dit) ; enums inconnus refusés', () => {
  const s = base();
  s.plans[0].prompt = 'x'.repeat(400);
  s.plans[0].texte_ecran = 'y'.repeat(90);
  const v = validerScenario(s);
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.scenario.plans[0].prompt.length, 280);
    assert.equal(v.scenario.plans[0].texte_ecran!.length, 60);
    assert.equal(v.corrections.length, 2);
  }
  assert.equal(validerScenario({ ...base(), format: '4:3' }).ok, false);
  assert.equal(validerScenario({ ...base(), plans: [{ ...base().plans[0], sujet: 'piscine' }, ...base().plans.slice(1)] }).ok, false);
  assert.equal(validerScenario({ ...base(), v: 2 }).ok, false);
  assert.equal(validerScenario('film').ok, false);
});

test('validerScenario : identifiants en double renumérotés, voix off vide retirée', () => {
  const s = base();
  s.plans[1].id = 'a';
  const v = validerScenario({ ...s, voix_off: { texte: '  ' } });
  assert.ok(v.ok);
  if (v.ok) { assert.equal(new Set(v.scenario.plans.map((p) => p.id)).size, 3); assert.equal(v.scenario.voix_off, null); }
});

test('empreinteScenario : stable (ordre des clés indifférent) ; change avec le contenu et avec le projet', () => {
  const a = validerScenario(base());
  const inverse = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(base()))).reverse());
  const b = validerScenario(inverse);
  const p = validerScenario({ ...base(), empreinte_projet: 'mb1-12345678' });
  assert.ok(a.ok && b.ok && p.ok);
  if (!a.ok || !b.ok || !p.ok) return;
  assert.match(empreinteScenario(a.scenario), /^sf1-[0-9a-f]{8}$/);
  assert.equal(empreinteScenario(a.scenario), empreinteScenario(b.scenario));
  assert.notEqual(empreinteScenario(a.scenario), empreinteScenario(p.scenario));
  const c = validerScenario({ ...base(), titre: 'Autre' });
  assert.ok(c.ok);
  if (c.ok) assert.notEqual(empreinteScenario(c.scenario), empreinteScenario(a.scenario));
  assert.match(resumerScenario(a.scenario), /^« Essai » — 30 s, 16:9, jour, 3 plans/);
});

test('maison hexagonale : 3 propositions différentes, valides, SANS plan impossible (ni balcon, ni terrasse, ni baie)', () => {
  const cap = capacitesDepuisModele(HEX, { empreinte: 'mb1-hexagone' });
  assert.equal(cap.type, 'maison');
  for (const s of ['balcon', 'terrasse', 'vue_depuis_baie'] as const) assert.ok(!cap.sujets.includes(s), s);
  assert.ok(cap.sujets.includes('jardin') && cap.sujets.includes('sejour') && cap.sujets.includes('entree'));
  const props = proposerScenarios(cap);
  assert.equal(props.length, 3);
  assert.equal(new Set(props.map((p) => p.titre)).size, 3);
  assert.equal(new Set(props.map(empreinteScenario)).size, 3);
  for (const p of props) {
    assert.ok(validerScenario(p).ok, p.titre);
    assert.deepEqual(plansImpossibles(p, cap), [], p.titre);
    assert.equal(p.empreinte_projet, 'mb1-hexagone');
    assert.ok(p.plans.every((x) => !['balcon', 'terrasse', 'vue_depuis_baie'].includes(x.sujet)), p.titre);
  }
  assert.equal(props[2].format, '9:16');
  assert.equal(props[2].duree_s, 20);
  assert.match(props[0].titre, /coucher du soleil/);
  assert.match(props[1].titre, /intérieure/);
});

test('collectif sans logement intérieur connu : la 2e proposition devient un tour extérieur', () => {
  const cap = capacitesDepuisModele({ type: 'autre', nom: 'Hangar', ouvertures: [{ type: 'porte' }] });
  const props = proposerScenarios(cap);
  assert.match(props[1].titre, /Tour du bâtiment/);
  for (const p of props) assert.deepEqual(plansImpossibles(p, cap), []);
});

test('modification par phrase : « raccourcis à 30 s »', () => {
  const cap = capacitesDepuisModele(HEX);
  const s = proposerScenarios(cap)[1];
  const r = modifierScenarioParPhrase(s, 'raccourcis à 30 s', cap);
  assert.ok(r.ok, r.refus.join(' | '));
  assert.equal(r.scenario.duree_s, 30);
  assert.ok(r.scenario.plans.length >= 3 && r.scenario.plans.every((p) => p.duree_s >= 2 && p.duree_s <= 15));
});

test('modification par phrase : ajout cuisine accepté ; ajout balcon REFUSÉ avec raison (maison sans balcon)', () => {
  const cap = capacitesDepuisModele(HEX);
  const s = proposerScenarios(cap)[0];
  const r = modifierScenarioParPhrase(s, 'ajoute un plan sur la cuisine', cap);
  assert.ok(r.ok);
  assert.equal(r.scenario.plans.length, s.plans.length + 1);
  assert.equal(r.scenario.plans[r.scenario.plans.length - 2].sujet, 'cuisine');
  const d = differencesScenarios(s, r.scenario);
  assert.deepEqual(d.plans.filter((p) => p.statut === 'ajoute').length, 1);
  assert.ok(d.champs.includes('duree_s'));
  const b = modifierScenarioParPhrase(s, 'ajoute un plan sur le balcon', cap);
  assert.equal(b.ok, false);
  assert.match(b.refus.join(' '), /Balcon : pas de balcon/);
});

test('modification par phrase : « plus de drone », « en vertical », « sans musique », « de nuit »', () => {
  const cap = capacitesDepuisModele(HEX);
  const s = proposerScenarios(cap)[1];
  const r = modifierScenarioParPhrase(s, 'plus de drone, en vertical, sans musique et de nuit', cap);
  assert.ok(r.ok, r.refus.join(' | '));
  assert.ok(r.scenario.plans.some((p) => p.mouvement === 'drone_survol'));
  assert.equal(r.scenario.format, '9:16');
  assert.equal(r.scenario.musique.ambiance, 'aucune');
  assert.equal(r.scenario.ambiance, 'nuit');
  assert.equal(modifierScenarioParPhrase(s, 'bonjour', cap).ok, false);
});

test('bloc mimmoza-scenario : aller-retour, bloc masqué, bloc invalide refusé', () => {
  const cap = capacitesDepuisModele(HEX);
  const s = proposerScenarios(cap)[0];
  const msg = messageScenario('lancer', s, 2);
  const lu = lireBlocScenario(msg);
  assert.ok(lu && lu.ok);
  if (lu && lu.ok) { assert.equal(lu.valeur.action, 'lancer'); assert.equal(lu.valeur.version, 2); assert.equal(empreinteScenario(lu.valeur.scenario), empreinteScenario(s)); }
  assert.ok(!sansBlocScenario(msg).includes('```'));
  assert.equal(lireBlocScenario('rien'), null);
  const mauvais = lireBlocScenario('```mimmoza-scenario\n{"v":1,"action":"lancer","scenario":{"v":1}}\n```');
  assert.ok(mauvais && !mauvais.ok);
});

test('options film d’avant (repli) : palier de durée, couvert → jour, carré → 16:9, écarts DITS', () => {
  const s = validerScenario({ ...base(), ambiance: 'couvert', format: '1:1' });
  assert.ok(s.ok);
  if (!s.ok) return;
  const o = optionsFilmDepuisScenario(s.scenario);
  assert.deepEqual(o.options, { duree_s: 30, ambiance: 'jour', format: '16:9', interieurs: false, musique: true });
  assert.equal(o.ecarts.length, 2);
  const cap = capacitesDepuisBrief({ nom: 'Résidence', balcons: 'aucun' });
  assert.ok(!cap.sujets.includes('balcon') && !cap.sujets.includes('jardin'));
});
