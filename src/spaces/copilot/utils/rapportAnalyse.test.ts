import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCopilotResponsePrintHtml } from './exportCopilotPdf.ts';
import { decouperReponse, humaniserValeur, titreDepuisQuestion } from './rapportAnalyse.ts';
import { QUESTION_ETUDE, REPONSE_ETUDE } from './__fixtures__/etudeParcelle.fixture.ts';

test('découpe préambule, rapport factuel et synthèse', () => {
  const d = decouperReponse(REPONSE_ETUDE);
  assert.ok(d);
  assert.match(d.preambule, /^Je commence/);
  assert.match(d.factuel, /^## Périmètre/);
  assert.match(d.synthese, /^## Ce qu'il faut retenir/);
  assert.equal(decouperReponse('## Résultat\nTexte simple'), null);
});

test('traduit les valeurs techniques du moteur', () => {
  assert.equal(humaniserValeur('cadastral_parcel'), 'Parcelle cadastrale');
  assert.equal(humaniserValeur('poursuivre_sous_conditions'), 'Poursuivre sous conditions');
  assert.equal(humaniserValeur('mode : non collectif'), 'Non collectif');
  assert.equal(humaniserValeur('5.7 %'), '5,7 %');
  const sup = humaniserValeur('detail : count : 1 ; label : Plan_de_prevention_des_risques, count : 1 ; label : Maison Earle ; intersection démontrée : non ; nb recensees : 2');
  assert.equal(sup, '2 recensées à proximité : Plan de prévention des risques, Maison Earle — aucune intersection démontrée avec la parcelle');
  assert.match(humaniserValeur('categories : Maison ; prix m2 median robuste : 4460 €/m²'), /^Prix médian : 4\s?460 €\/m²/u);
});

test('titre tiré de la question', () => {
  assert.equal(titreDepuisQuestion(QUESTION_ETUDE), '32 Chemin de Behereko Errota, Ascain');
});

test('le rapport imprimé d’une étude est rédigé pour un client', () => {
  const html = buildCopilotResponsePrintHtml({ response: { role: 'assistant', text: REPONSE_ETUDE }, question: QUESTION_ETUDE }, { generatedAt: '21 octobre 2026' });
  for (const brut of ['cadastral_parcel', 'confirmed', 'estimated', 'municipality', 'nearby', 'count : 1', 'label :',
    'Je commence par', 'Ne pas écrire', 'no_data', 'information non restituée', 'poursuivre_sous_conditions', 'Plan_de_prevention', 'PROXIMITÉ', 'COMMUNALE']) {
    assert.ok(!html.includes(brut), `valeur brute restée dans le PDF : ${brut}`);
  }
  assert.match(html, /Annexe — Données détaillées et sources/);
  assert.match(html, /<table class="data">/);
  assert.match(html, /@page\{size:A4;margin:0\}/);
  assert.ok(html.indexOf('Ce qu') < html.indexOf('Annexe'), 'la synthèse précède l’annexe');
  assert.match(html, /Poursuivre sous conditions/);
});
