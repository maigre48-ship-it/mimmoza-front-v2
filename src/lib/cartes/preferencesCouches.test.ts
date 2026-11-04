import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEUIL_ERREURS_PANNE, bornerOpacite, clePreferencesCouches, ecrirePreferences, enregistrerTuile, fondEffectif,
  lirePreferences, normaliserPreferences, suiviInitial, type StockageCles, type SuiviTuiles,
} from './preferencesCouches.ts';
import { PREFERENCES_PAR_DEFAUT } from './couchesIgn.ts';

function memoire(initial: Record<string, string> = {}): StockageCles & { donnees: Record<string, string> } {
  const donnees = { ...initial };
  return {
    donnees,
    getItem: (k) => (k in donnees ? donnees[k] : null),
    setItem: (k, v) => { donnees[k] = v; },
  };
}

describe('preferencesCouches — persistance du choix', () => {
  it('clé distincte par contexte (versionnée)', () => {
    assert.equal(clePreferencesCouches('parcelle'), 'mimmoza.cartes.couches.parcelle.v1');
    assert.notEqual(clePreferencesCouches('parcelle'), clePreferencesCouches('thematique'));
  });

  it('sans rien de stocké : préférences par défaut du contexte', () => {
    assert.deepEqual(lirePreferences(memoire(), 'parcelle'), PREFERENCES_PAR_DEFAUT.parcelle);
    assert.deepEqual(lirePreferences(memoire(), 'thematique'), PREFERENCES_PAR_DEFAUT.thematique);
    assert.deepEqual(lirePreferences(null, 'parcelle'), PREFERENCES_PAR_DEFAUT.parcelle);
  });

  it('aller-retour écriture → lecture', () => {
    const s = memoire();
    ecrirePreferences(s, 'parcelle', { fond: 'plan', cadastre: false, opaciteCadastre: 0.45 });
    assert.deepEqual(lirePreferences(s, 'parcelle'), { fond: 'plan', cadastre: false, opaciteCadastre: 0.45 });
    // l'autre contexte n'est pas touché
    assert.deepEqual(lirePreferences(s, 'thematique'), PREFERENCES_PAR_DEFAUT.thematique);
  });

  it('JSON abîmé ou stockage qui lève : jamais d’exception, défauts', () => {
    const abime = memoire({ [clePreferencesCouches('parcelle')]: '{pas du json' });
    assert.deepEqual(lirePreferences(abime, 'parcelle'), PREFERENCES_PAR_DEFAUT.parcelle);
    const hostile: StockageCles = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('quota'); } };
    assert.deepEqual(lirePreferences(hostile, 'parcelle'), PREFERENCES_PAR_DEFAUT.parcelle);
    assert.doesNotThrow(() => ecrirePreferences(hostile, 'parcelle', PREFERENCES_PAR_DEFAUT.parcelle));
  });

  it('champs invalides remplacés un par un par le défaut', () => {
    const d = PREFERENCES_PAR_DEFAUT.parcelle;
    assert.deepEqual(normaliserPreferences({ fond: 'hybride', cadastre: 'oui', opaciteCadastre: 'abc' }, d), d);
    assert.deepEqual(normaliserPreferences({ fond: 'plan' }, d), { ...d, fond: 'plan' });
    assert.deepEqual(normaliserPreferences(null, d), d);
  });

  it('opacité bornée [0.2 ; 1] et arrondie au pas de 0.05', () => {
    assert.equal(bornerOpacite(0), 0.2);
    assert.equal(bornerOpacite(3), 1);
    assert.equal(bornerOpacite(0.83), 0.85);
    assert.equal(bornerOpacite('0.6'), 0.6);
    assert.equal(bornerOpacite(Number.NaN, 0.8), 0.8);
    assert.equal(bornerOpacite(undefined, 0.7), 0.7);
  });
});

describe('preferencesCouches — repli Satellite → Plan', () => {
  const rejouer = (suite: boolean[]): SuiviTuiles => suite.reduce(enregistrerTuile, suiviInitial());

  it('quelques tuiles manquantes ne déclenchent pas le repli', () => {
    assert.equal(rejouer([false, false, false]).enPanne, false);
    assert.equal(rejouer([true, true, true, true, true, false, false, false, false]).enPanne, false);
  });

  it(`panne dès ${SEUIL_ERREURS_PANNE} échecs majoritaires`, () => {
    assert.equal(rejouer([false, false, false, false]).enPanne, true);
    assert.equal(rejouer([true, false, false, false, false]).enPanne, true);
  });

  it('une fois en panne, l’état reste figé (pas de clignotement)', () => {
    const panne = rejouer([false, false, false, false]);
    assert.equal(enregistrerTuile(panne, true), panne);
  });

  it('fond effectif : plan si le satellite choisi est en panne', () => {
    assert.equal(fondEffectif('satellite', false), 'satellite');
    assert.equal(fondEffectif('satellite', true), 'plan');
    assert.equal(fondEffectif('plan', true), 'plan');
  });
});
