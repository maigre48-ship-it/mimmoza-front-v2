import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesignBrief, EDITORIAL_SOURCES } from './designDirections.ts';
import { buildStudioHandoff, criterionReading, designDossierHtml, documentedCriteria, parseStudioHandoff } from './designDecisionDossier.ts';

const brief = buildDesignBrief({ programme: 'Hôtel', target: 'séjours de loisirs', location: 'Ascain', horizonYears: 15,
  priority: 'Entretien simple', sources: EDITORIAL_SOURCES, generatedAt: '2026-09-28' });
brief.selectedFamily = 'durable';

test('le coût annuel reste absent tant que son origine n’est pas donnée', () => {
  brief.review!.maintenance.durable = { annualEur: '18000', source: '' };
  assert.match(criterionReading(brief, brief.directions[0], 'entretien').proposal, /non chiffré/);
  assert.doesNotMatch(designDossierHtml(brief, EDITORIAL_SOURCES), /18000 €/);
  brief.review!.maintenance.durable.source = 'Devis entretien du 28 septembre';
  assert.match(criterionReading(brief, brief.directions[0], 'entretien').proposal, /18000 €/);
});

test('un avis favorable exige une pièce ou un constat renseigné', () => {
  brief.review!.criteria.durable = { cible: { verdict: 'favorable', evidence: '' } };
  assert.equal(documentedCriteria(brief), 0);
  brief.review!.criteria.durable.cible!.evidence = 'Compte rendu du test utilisateurs';
  assert.equal(documentedCriteria(brief), 1);
});

test('le dossier échappe les contenus saisis et le brief visuel reste lié à son étude', () => {
  brief.review!.selectionReason = '<script>alert(1)</script>';
  assert.match(designDossierHtml(brief, EDITORIAL_SOURCES), /&lt;script&gt;/);
  assert.doesNotMatch(designDossierHtml(brief, EDITORIAL_SOURCES), /<script>/);
  const handoff = buildStudioHandoff(brief, 'etude-1');
  assert.ok(handoff);
  assert.ok(parseStudioHandoff(JSON.stringify(handoff), 'etude-1'));
  assert.equal(parseStudioHandoff(JSON.stringify(handoff), 'etude-2'), null);
});
