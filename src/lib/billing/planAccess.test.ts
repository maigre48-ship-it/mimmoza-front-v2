import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORMULES_VENDUES,
  MODULE_SPACES,
  PLAN_LABEL,
  PLAN_MODULE_COUNT,
  allowedModules,
  canAccessPath,
  getSpaceAccess,
  normaliserPlan,
  remainingModuleChoices,
} from './planAccess.ts';

test('formules vendues : Découverte, Indépendant, Pro', () => {
  assert.deepEqual([...FORMULES_VENDUES], ['basique', 'avance', 'pro']);
});

test('normaliserPlan : proplus (ex-« Équipe ») → pro, les autres inchangés', () => {
  assert.equal(normaliserPlan('proplus'), 'pro');
  for (const p of FORMULES_VENDUES) assert.equal(normaliserPlan(p), p);
});

test('proplus : mêmes droits que Pro, libellé « Pro »', () => {
  assert.equal(PLAN_LABEL.proplus, 'Pro');
  assert.equal(PLAN_MODULE_COUNT.proplus, PLAN_MODULE_COUNT.pro);
  assert.deepEqual(allowedModules('proplus'), [...MODULE_SPACES]);
  assert.deepEqual(allowedModules('proplus'), allowedModules('pro'));
  for (const m of MODULE_SPACES) {
    assert.deepEqual(getSpaceAccess(m, 'proplus'), { unlocked: true, selectable: false, requiresUpgrade: false });
  }
  assert.equal(canAccessPath('/promoteur/bilan', 'proplus'), true);
  assert.equal(remainingModuleChoices('proplus'), 0);
});

test('droits des formules vendues inchangés', () => {
  assert.deepEqual(allowedModules('basique'), []);
  assert.deepEqual(allowedModules('avance'), []);
  assert.deepEqual(allowedModules('avance', ['marchand', 'promoteur']), ['marchand']);
  assert.deepEqual(allowedModules('pro'), [...MODULE_SPACES]);
  assert.equal(canAccessPath('/rehabilitation', 'basique'), false);
});
