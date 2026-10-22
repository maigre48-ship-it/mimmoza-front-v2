import test from 'node:test';
import assert from 'node:assert/strict';
import { texteDictee } from './texteDictee.ts';

const resultat = (transcript: string, isFinal = false) => ({ isFinal, 0: { transcript } });

for (const base of ['', 'Bonjour']) {
  test('les provisoires successifs remplacent la phrase, base : ' + base, () => {
    let zone = base;
    for (const phrase of ['est-ce que', 'est-ce que tu', 'est-ce que tu penses']) {
      zone = texteDictee(base, [resultat(phrase)]);
      assert.equal(zone, [base, phrase].filter(Boolean).join(' '));
    }
    assert.equal(zone, [base, 'est-ce que tu penses'].filter(Boolean).join(' '));
  });
}

test('conserve le segment final quand le second segment provisoire évolue', () => {
  const final = resultat('est-ce que tu penses ', true);
  assert.equal(texteDictee('', [final, resultat('que')]), 'est-ce que tu penses que');
  assert.equal(texteDictee('', [final, resultat("que c'est une idée")]),
    "est-ce que tu penses que c'est une idée");
  assert.equal(texteDictee('Bonjour', [final, resultat("que c'est une idée", true)]),
    "Bonjour est-ce que tu penses que c'est une idée");
});

test('une nouvelle session repart du texte corrigé à la main', () => {
  assert.equal(texteDictee('Texte corrigé', [resultat('nouvelle phrase')]),
    'Texte corrigé nouvelle phrase');
  assert.equal(texteDictee('Bonjour', []), 'Bonjour');
});
