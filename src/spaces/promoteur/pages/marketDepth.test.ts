import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketDepth } from './marketDepth.ts';

test('le dossier sépare demande, concurrence et prix avec les périmètres sources', () => {
  const depth = buildMarketDepth({ key: 'logement', error: null, market: { meta: { commune_insee: '64065' },
    core: { dvf: { coverage: 'ok', nb_transactions: 34, prix_m2_median: 4300, perimetre_label: 'Commune 64065' } },
    specific: { demographie: { pct_logements_vacants_source: 'mesure', pct_logements_vacants: 5 } } } });
  assert.deepEqual(depth.chapters.map((chapter) => chapter.facts.map((fact) => fact.label)), [
    ['Transactions DVF'], ['Logements vacants'], ['Prix médian DVF'],
  ]);
  assert.equal(depth.chapters[2].facts[0].scope, 'Commune 64065');
  assert.equal(depth.observedActivity, true);
});

test('un dossier clinique sans demande mesurée ne présente aucune activité captée', () => {
  const depth = buildMarketDepth({ key: 'clinique', error: null, market: null });
  assert.equal(depth.observedActivity, false);
  assert.equal(depth.chapters[0].facts.length, 0);
  assert.match(depth.chapters[0].missing, /spécialité/);
});
