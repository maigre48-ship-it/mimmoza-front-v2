import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateIndicativeCapacity, extractPluEnvelope, programmeKind, targetProposal } from './projectProgramme.ts';

test('le volume n’est calculé que sur une emprise PLU et des hypothèses complètes', () => {
  const absent = extractPluEnvelope(null);
  assert.equal(calculateIndicativeCapacity('hotel', absent, { terrainM2: 1000, floors: 2, floorHeightM: 3, grossM2PerUnit: 40, siteEfficiencyPct: 70 }), null);
  const plu = extractPluEnvelope({ ces: { max_ratio: 0.3 }, hauteur: { max_m: 8 }, stationnement: { par_logement: 1.5 } });
  const result = calculateIndicativeCapacity('housing', plu, { terrainM2: 1000, floors: 2, floorHeightM: 3, grossM2PerUnit: 60, siteEfficiencyPct: 70 });
  assert.equal(result?.indicativeUnits, 7);
  assert.equal(result?.parkingMinimum, 11);
  assert.equal(result?.heightTest, 'within');
});

test('le plafond doit signaler une hauteur dépassée et la cible hôtelière reste conditionnelle', () => {
  const plu = extractPluEnvelope({ densite_emprise: { emprise_max_ratio: 45 }, hauteurs: { h_max_egout_m: 8 } });
  assert.equal(calculateIndicativeCapacity('hotel', plu, { terrainM2: 1000, floors: 3, floorHeightM: 3, grossM2PerUnit: 40, siteEfficiencyPct: 80 })?.heightTest, 'above');
  assert.equal(programmeKind('Clinique'), 'clinic');
  assert.match(targetProposal('hotel', null).title, /à établir/);
});

test('la résidence en France ne devient jamais une preuve de séjour de loisirs', () => {
  const hotel = { nonResidentSharePct: 21.9, frequencyYear: 2025, months: [] } as Parameters<typeof targetProposal>[1];
  const proposal = targetProposal('hotel', hotel);
  assert.match(proposal.title, /motif du séjour inconnu/);
  assert.doesNotMatch(proposal.title, /loisirs/);
  assert.match(proposal.reasons[0], /loisirs, affaires ou autre/);
});

test('la piste loisirs du Pays basque reste une hypothèse de destination', () => {
  const hotel = { codeEpci: '200067106', nonResidentSharePct: 21.9, frequencyYear: 2025, months: [] } as Parameters<typeof targetProposal>[1];
  const proposal = targetProposal('hotel', hotel);
  assert.match(proposal.title, /à tester/);
  assert.match(proposal.reasons[0], /non une part de marché acquise/);
  assert.match(proposal.reasons[2], /ne mesure pas le motif/);
});
