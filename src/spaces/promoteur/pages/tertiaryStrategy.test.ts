import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTertiaryBrief,calculateTertiaryRental,emptyRentalInputs,TERTIARY_PROGRAMMES } from './tertiaryStrategy';
import { programmeKind, targetProposal } from './projectProgramme';
import { programmeBrief } from '../../copilot/dossier/parcelStrategy';
const inputs={surfaceM2:'1000',rentAnnualM2:'150',vacancyPct:'10',annualOwnerCosts:'15000',totalInvestment:'2000000',exitYieldPct:'6'};
test('économie tertiaire en loyers annuels : revenu net, rendement et capitalisation',()=>{
  const r=calculateTertiaryRental(inputs)!;assert.equal(r.gross,150000);assert.equal(r.effective,135000);assert.equal(r.net,120000);assert.equal(r.netYieldPct,6);assert.equal(r.valuation,2000000);assert.deepEqual(r.sensitivities.map(s=>s.net),[106500,105000]);
});
test('une hypothèse manquante ne devient pas zéro, ni un taux implicite',()=>{
  assert.equal(calculateTertiaryRental(emptyRentalInputs()),null);assert.equal(calculateTertiaryRental({...inputs,annualOwnerCosts:''}),null);assert.equal(calculateTertiaryRental({...inputs,exitYieldPct:''})?.valuation,null);assert.equal(calculateTertiaryRental({...inputs,vacancyPct:'101'}),null);
});
test('une vacance complète conserve les charges et ne fabrique pas de valeur positive',()=>{
  const r=calculateTertiaryRental({...inputs,vacancyPct:'100'})!;assert.equal(r.net,-15000);assert.equal(r.valuation,null);assert.equal(r.sensitivities[1].net,-15000);
});
test('locaux d’activité distincts des bureaux sans substituer un modèle de marché',()=>{
  assert.equal(programmeKind('Locaux d’activité'),'activity');assert.equal(programmeKind('Ateliers artisanaux'),'activity');assert.equal(programmeBrief('Locaux d’activité avec bureaux')?.marketType,null);assert.match(targetProposal('activity',null).programme.join(' '),/poids lourds/);assert.equal(TERTIARY_PROGRAMMES.length,3);
});
test('brief relié au terrain et aux hypothèses, distingue les preuves et la sortie',()=>{
  const brief=buildTertiaryBrief({location:'Lyon',surface:'4000',programme:'Locaux d’activité',exit:'Vente à un utilisateur',needs:'artisan, lot 250 m²',financial:inputs});assert.match(brief,/loyer 150 €\/m²\/an HT HC/);assert.match(brief,/4000 m²/);assert.match(brief,/Vente à un utilisateur/);assert.match(brief,/aucun modèle spécialisé/i);assert.match(brief,/médiane DVF résidentielle/);assert.match(brief,/ne prouve pas un besoin ni un intérêt/);
});
