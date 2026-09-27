import assert from 'node:assert/strict';
import test from 'node:test';
import { readSector, SCREENING_SECTORS } from './sectorScreening.ts';

test('la présélection couvre six études existantes et signale la clinique non connectée', () => {
  assert.deepEqual(SCREENING_SECTORS.map((sector) => sector.key), [
    'logement', 'hotel', 'ehpad', 'commerce', 'bureaux', 'residence_etudiante', 'clinique',
  ]);
  const clinic = readSector({ key: 'clinique', market: null, error: 'Étude spécialisée non connectée.' });
  assert.equal(clinic.status, 'insuffisant');
  assert.equal(clinic.facts.length, 0);
  assert.match(clinic.missing.join(' '), /autorisations/);
});

test('un revenu de repli départemental et un BPE partiel ne deviennent pas des preuves commerciales', () => {
  const result = readSector({ key: 'commerce', error: null, market: {
    meta: { commune_insee: '64065' },
    core: { bpe: { coverage: 'ok', bpe_quality: { full_coverage: false } } },
    specific: { zone_chalandise: { population: 4658, revenu_median: null, revenu_median_estime: 22000, revenu_median_source: 'dept_fallback' }, concurrence: { supermarches: 0 } },
  } });
  assert.deepEqual(result.facts.map((fact) => fact.label), ['Population communale']);
  assert.equal(result.target.includes('chalandise'), true);
});

test('les proxys bureaux restent du contexte et ne classent pas le projet', () => {
  const result = readSector({ key: 'bureaux', error: null, market: {
    meta: { commune_insee: '64065' }, core: { insee: { population: 4658 } },
    specific: { bassin_emploi: { pct_actifs_source: 'estimation_dept', pct_actifs: null, pct_actifs_estime: 45 } },
  } });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].direct, false);
  assert.equal(result.status, 'insuffisant');
});

test('l’EHPAD ne traite pas des lits estimés comme une capacité FINESS certifiée', () => {
  const result = readSector({ key: 'ehpad', error: null, market: {
    meta: { commune_insee: '64065' },
    specific: { demographie_senior: { population_75_plus_source: 'mesure', population_75_plus: 510 }, concurrence: { count: 2, total_lits: 120, coverage: 'ok' } },
  } });
  assert.equal(result.facts[0].label, 'Habitants de 75 ans ou plus');
  assert.equal(result.facts[1].direct, false);
  assert.equal(result.facts.some((fact) => /Lits/.test(fact.label)), false);
});
