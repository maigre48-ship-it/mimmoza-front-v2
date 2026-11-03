// Programme bâti lu dans la conversation : maisons, collectif, résidence, mixte, plafonds.
import assert from 'node:assert/strict';
import test from 'node:test';
import { nombreFrancais, programmeBatiDepuisTexte, programmeBatiDuContexte } from './programmeBati.ts';
import { programmeDuContexte, type MessageContexte } from './contexteVolume.ts';

const user = (text: string): MessageContexte => ({ id: text.slice(0, 8), role: 'user', text, createdAt: '2026-11-03T10:00:00Z' });

test('nombres en lettres', () => {
  assert.equal(nombreFrancais('vingt-cinq'), 25);
  assert.equal(nombreFrancais('soixante-dix'), 70);
  assert.equal(nombreFrancais('quatre-vingt-dix'), 90);
  assert.equal(nombreFrancais('vingt et un'), 21);
  assert.equal(nombreFrancais('deux cents'), 200);
  assert.equal(nombreFrancais('1 200'), 1200);
  assert.equal(nombreFrancais('douze'), 12);
});

test('cas réel Ascain : village seniors de 25 maisons', () => {
  const p = programmeBatiDepuisTexte('trouve moi le meilleur terrain à Ascain pour lancer un projet de villages séniors avec 25 maisons')!;
  assert.equal(p.logements, 25);
  assert.equal(p.composantes.length, 1);
  assert.deepEqual({ ...p.composantes[0], libelle: undefined }, { type: 'maisons', nombre: 25, unite: 'maisons', public: 'seniors', forme: null, niveaux: null, libelle: undefined });
  assert.equal(p.libelle, '25 maisons seniors');
});

test('maisons : forme, niveaux, nombres en lettres, synonymes', () => {
  const a = programmeBatiDepuisTexte('village sénior de 10 maisons')!.composantes[0];
  assert.equal(a.nombre, 10); assert.equal(a.public, 'seniors');
  const b = programmeBatiDepuisTexte('12 maisons jumelées de plain-pied')!.composantes[0];
  assert.equal(b.forme, 'jumelee'); assert.equal(b.niveaux, 1);
  assert.equal(programmeBatiDepuisTexte('vingt-cinq maisons en bande R+1')!.composantes[0].nombre, 25);
  assert.equal(programmeBatiDepuisTexte('vingt-cinq maisons en bande R+1')!.composantes[0].forme, 'bande');
  assert.equal(programmeBatiDepuisTexte('vingt-cinq maisons en bande R+1')!.composantes[0].niveaux, 2);
  assert.equal(programmeBatiDepuisTexte('6 villas individuelles')!.composantes[0].forme, 'individuelle');
  assert.equal(programmeBatiDepuisTexte('18 pavillons')!.composantes[0].type, 'maisons');
  assert.equal(programmeBatiDepuisTexte('8 logements individuels')!.composantes[0].type, 'maisons');
});

test('collectif et résidence', () => {
  const s = programmeBatiDepuisTexte('immeuble social de 40 logements')!;
  assert.deepEqual(s.composantes.map(c => [c.type, c.nombre, c.public]), [['collectif', 40, 'social']]);
  assert.equal(s.libelle, '40 logements sociaux');
  const r = programmeBatiDepuisTexte('une résidence de 80 lits pour personnes âgées')!;
  assert.deepEqual(r.composantes.map(c => [c.type, c.nombre, c.unite, c.public]), [['residence', 80, 'lits', 'seniors']]);
  const rs = programmeBatiDepuisTexte('résidence services seniors de 60 logements')!;
  assert.deepEqual(rs.composantes.map(c => [c.type, c.nombre, c.unite]), [['residence', 60, 'logements']]);
  assert.equal(programmeBatiDepuisTexte('EHPAD de 90 chambres')!.composantes[0].nombre, 90);
});

test('programmes mixtes', () => {
  const m = programmeBatiDepuisTexte('15 maisons et un petit collectif de 20 logements')!;
  assert.deepEqual(m.composantes.map(c => [c.type, c.nombre]), [['maisons', 15], ['collectif', 20]]);
  assert.equal(m.logements, 35);
  const d = programmeBatiDepuisTexte('40 logements dont 10 maisons')!;
  assert.deepEqual(d.composantes.map(c => [c.type, c.nombre]), [['maisons', 10], ['collectif', 30]]);
  const soit = programmeBatiDepuisTexte('25 maisons, soit 25 logements')!;
  assert.deepEqual(soit.composantes.map(c => [c.type, c.nombre]), [['maisons', 25]]);
});

test('plafonds et textes sans programme', () => {
  assert.equal(programmeBatiDepuisTexte('40 logements maximum selon l’OAP'), null);
  assert.equal(programmeBatiDepuisTexte('au plus 20 maisons'), null);
  assert.equal(programmeBatiDepuisTexte('un village de maisons pour seniors'), null);
  assert.equal(programmeBatiDepuisTexte('parcelle de 2 870 m², zone UA'), null);
  assert.equal(programmeBatiDepuisTexte(null), null);
});

test('contexte : fiche d’abord, sinon dernier message utilisateur ; programmeDuContexte suit', () => {
  const msgs = [user('Trouve un terrain à Ascain'), user('village sénior de 25 maisons'), { ...user('ok'), role: 'assistant' as const, text: '40 logements possibles' }];
  const p = programmeBatiDuContexte(msgs, null)!;
  assert.equal(p.origine, 'conversation'); assert.equal(p.logements, 25);
  const c = programmeDuContexte(msgs, null);
  assert.equal(c.logements, 25);
  assert.equal(c.composantes?.[0].type, 'maisons');
  const fiche = { version: 1 as const, objectif: 'Immeuble', programme: '24 logements', localisation: null, dimensions: null, style: null, contraintes: null, questions: [], pieces: [] };
  assert.equal(programmeDuContexte(msgs, fiche).logements, 24);
  assert.deepEqual(programmeDuContexte([user('bonjour')], null), { logements: null, libelle: null, origine: null });
});
