import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptAiRecommendation, recommendProjectLocally, type RecommendationPacket } from './projectRecommendation.ts';
import { SCREENING_SECTORS } from './sectorScreening.ts';

const packet = (): RecommendationPacket => ({ parcelId: '64065000AI0002', communeInsee: '64065', terrainM2: 1500,
  pluZone: null, dataDate: '2026-09-27', sectors: SCREENING_SECTORS.map((sector) => ({
    ...sector, eligible: false, targetHypothesis: 'Cible à tester', programmeHint: 'Programme à définir', facts: [], missing: ['Marché local'],
  })) });

test('les seules offres BPE ne déclenchent pas un meilleur projet inventé', () => {
  const input = packet();
  input.sectors.find((sector) => sector.key === 'ehpad')!.facts.push({ id: 'ehpad:1', label: 'Hébergements pour personnes âgées', value: '1', scope: 'Commune 64065 · 2025', source: 'INSEE BPE', direct: false });
  const result = recommendProjectLocally(input);
  assert.equal(result.status, 'aucune_priorite');
  assert.equal(result.projectKey, null);
});

test('une activité immobilière communale est instruite avant une fréquentation hôtelière départementale', () => {
  const input = packet();
  const housing = input.sectors.find((sector) => sector.key === 'logement')!;
  housing.facts.push({ id: 'logement:1', label: 'Transactions DVF', value: '34', scope: 'Commune 64065', source: 'DVF', direct: true });
  housing.eligible = true;
  input.sectors.find((sector) => sector.key === 'hotel')!.facts.push({ id: 'hotel:1', label: 'Nuitées hôtelières', value: '2 790 000', scope: 'Département 64 · 2025', source: 'INSEE', direct: true });
  const result = recommendProjectLocally(input);
  assert.equal(result.projectKey, 'logement');
  assert.deepEqual(result.evidenceIds, ['logement:1']);
  assert.match(result.rationale, /ne prouve ni la demande/);
});

test('deux marchés observés au même périmètre restent indépartageables sans bilans', () => {
  const input = packet();
  input.sectors.find((sector) => sector.key === 'logement')!.facts.push({ id: 'logement:1', label: 'Transactions DVF', value: '34', scope: 'Commune 64065', source: 'DVF', direct: true });
  input.sectors.find((sector) => sector.key === 'hotel')!.facts.push({ id: 'hotel:1', label: 'Nuitées hôtelières', value: '279000', scope: 'Commune 64065', source: 'INSEE', direct: true });
  assert.equal(recommendProjectLocally(input).status, 'aucune_priorite');
});

test('la page refuse une recommandation IA qui cite une preuve inexistante', () => {
  const input = packet();
  const housing = input.sectors.find((sector) => sector.key === 'logement')!;
  housing.facts.push({ id: 'logement:1', label: 'Transactions DVF', value: '34', scope: 'Commune 64065', source: 'DVF', direct: true });
  housing.eligible = true;
  const recommendation = { status: 'piste_prioritaire', projectKey: 'logement', target: 'Ménages locaux', programme: 'Logements à tester',
    rationale: 'Signal de transactions locales.', evidenceIds: ['preuve-inventee'], alternatives: [], conditions: ['PLU et bilan à vérifier.'] };
  assert.equal(acceptAiRecommendation({ recommendation }, input), null);
  recommendation.evidenceIds = ['logement:1'];
  assert.equal(acceptAiRecommendation({ recommendation }, input)?.projectKey, 'logement');
});
