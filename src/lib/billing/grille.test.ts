import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE,
  FORMULES,
  JETONS_INCLUS_PAR_FORMULE,
  MODULES_PAR_FORMULE,
  NOM_FORMULE,
  STUDIO_3D,
  beneficieRemiseStudio,
  formule,
} from './grille.ts';
import { FORMULES_VENDUES } from './planAccess.ts';

// Formule « Équipe » (code proplus) retirée de l'offre le 23/10/2026.

test('grille : seules Découverte, Indépendant et Pro sont proposées', () => {
  assert.deepEqual(FORMULES.map((f) => f.id), [...FORMULES_VENDUES]);
  assert.deepEqual(FORMULES.map((f) => f.nom), ['Découverte', 'Indépendant', 'Pro']);
  const textes = FORMULES.flatMap((f) => [f.nom, f.accroche, ...f.points]).join(' | ');
  assert.doesNotMatch(textes, /[ÉE]quipe/);
  assert.doesNotMatch(textes, /agent commercial/i);
  assert.doesNotMatch(textes, /jetons partagés/i);
});

test("grille : aucune formule ne promet de crédits API inclus (l'API se souscrit à part)", () => {
  for (const f of FORMULES) {
    for (const p of f.points) {
      assert.doesNotMatch(p, /\bAPI\b/i, `${f.nom} : « ${p} »`);
      assert.doesNotMatch(p, /crédits? inclus/i, `${f.nom} : « ${p} »`);
    }
  }
});

test('ancien code proplus : traité comme Pro partout dans la grille', () => {
  assert.equal(formule('proplus').id, 'pro');
  assert.equal(NOM_FORMULE.proplus, 'Pro');
  assert.equal(MODULES_PAR_FORMULE.proplus, MODULES_PAR_FORMULE.pro);
  assert.equal(JETONS_INCLUS_PAR_FORMULE.proplus, JETONS_INCLUS_PAR_FORMULE.pro);
  assert.equal(ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE.proplus, ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE.pro);
});

test('Studio 3D : la remise vise les abonnés Pro (ancien code proplus compris), pas les autres', () => {
  assert.deepEqual([...STUDIO_3D.formulesRemisees], ['pro']);
  assert.equal(beneficieRemiseStudio('pro'), true);
  assert.equal(beneficieRemiseStudio('proplus'), true);
  assert.equal(beneficieRemiseStudio('avance'), false);
  assert.equal(beneficieRemiseStudio('basique'), false);
});
