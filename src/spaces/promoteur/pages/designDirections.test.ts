import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesignBrief, designBriefText, EDITORIAL_SOURCES } from './designDirections.ts';

test('le brief EHPAD privilégie confort, entretien et adaptation sans promettre le PLU', () => {
  const brief = buildDesignBrief({ programme: 'EHPAD', target: 'résidents dépendants et leurs proches', location: 'Ascain',
    horizonYears: 20, priority: 'Confort et accessibilité', sources: EDITORIAL_SOURCES, generatedAt: '2026-09-28' });
  assert.equal(brief.directions.length, 3);
  assert.match(brief.directions[0].architecture.join(' '), /jardin|unités de vie/);
  assert.match(brief.directions[1].interiors.join(' '), /acoustique/);
  assert.match(brief.directions[2].vigilance, /soignants/);
  assert.equal(brief.selectedFamily, null);
  assert.match(brief.directions[0].architecture.join(' '), /règles locales/);
});

test('le texte exporté cite seulement les références retenues pour la direction', () => {
  const brief = buildDesignBrief({ programme: 'Hôtel', target: 'séjours de loisirs à tester', location: 'Saint-Jean-de-Luz',
    horizonYears: 15, priority: 'Durabilité et entretien simple', sources: EDITORIAL_SOURCES, generatedAt: '2026-09-28' });
  brief.selectedFamily = 'expressif';
  const text = designBriefText(brief, EDITORIAL_SOURCES);
  assert.match(text, /Pinterest Predicts/);
  assert.match(text, /règlement PLU opposable/);
  assert.match(text, /entretien/);
  assert.doesNotMatch(text, /Houzz · Prévisions/);
});
