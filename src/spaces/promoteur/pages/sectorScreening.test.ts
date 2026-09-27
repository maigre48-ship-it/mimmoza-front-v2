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

test('la clinique affiche une offre BPE datée sans prétendre mesurer la demande ni les autorisations', () => {
  const clinic = readSector({ key: 'clinique', market: null, error: null, bpe: {
    year: 2025, communeInsee: '64065', department: '64', commune: {}, departmentCounts: { D101: 22, D102: 9 },
    communeUrl: 'https://api.insee.fr/melodi/data/DS_BPE?GEO=COM-64065', departmentUrl: 'https://api.insee.fr/melodi/data/DS_BPE?GEO=DEP-64', fetchedAt: '2026-09-27',
  } });
  assert.deepEqual(clinic.facts.map((fact) => fact.value), ['22', '9']);
  assert.ok(clinic.facts.every((fact) => fact.scope.includes('Département 64 · 2025') && !fact.direct));
  assert.equal(clinic.status, 'insuffisant');
});

test('l’EHPAD conserve le libellé large de la BPE et le périmètre communal', () => {
  const ehpad = readSector({ key: 'ehpad', market: null, error: null, bpe: {
    year: 2025, communeInsee: '64065', department: '64', commune: { D401: 1 }, departmentCounts: { D401: 134 },
    communeUrl: 'https://api.insee.fr/melodi/data/DS_BPE?GEO=COM-64065', departmentUrl: 'https://api.insee.fr/melodi/data/DS_BPE?GEO=DEP-64', fetchedAt: '2026-09-27',
  } });
  assert.equal(ehpad.facts[0].label, 'Hébergements pour personnes âgées');
  assert.equal(ehpad.facts[0].scope, 'Commune 64065 · 2025');
  assert.equal(ehpad.status, 'insuffisant');
});

test('population senior, revenu et part étudiante restent du contexte, pas une demande captée', () => {
  const common = { meta: { commune_insee: '64065' } };
  const senior = readSector({ key: 'ehpad', error: null, market: { ...common, specific: { demographie_senior: { population_75_plus_source: 'mesure', population_75_plus: 510 } } } });
  const retail = readSector({ key: 'commerce', error: null, market: { ...common, specific: { zone_chalandise: { population: 4658, revenu_median: 24000, revenu_median_source: 'mesure' } } } });
  const student = readSector({ key: 'residence_etudiante', error: null, market: { ...common, specific: { population_etudiante: { pct_etudiants_source: 'mesure', pct_etudiants: 8 } } } });
  for (const reading of [senior, retail, student]) {
    assert.equal(reading.status, 'insuffisant');
    assert.ok(reading.facts.length > 0);
    assert.ok(reading.facts.every((fact) => !fact.direct));
  }
});

test('les prix DVF enrichissent le logement sans être pris pour des ventes supplémentaires', () => {
  const reading = readSector({ key: 'logement', error: null, market: { meta: { commune_insee: '64065' },
    core: { dvf: { coverage: 'ok', nb_transactions: 34, prix_m2_median: 4300, perimetre_label: 'Commune 64065' } } } });
  assert.deepEqual(reading.facts.map((fact) => fact.label), ['Transactions DVF', 'Prix médian DVF']);
  assert.equal(reading.facts[0].direct, true);
  assert.equal(reading.facts[1].direct, false);
});
