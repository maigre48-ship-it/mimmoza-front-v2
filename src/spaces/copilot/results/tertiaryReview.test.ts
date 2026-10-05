import test from 'node:test';
import assert from 'node:assert/strict';
import { tertiaryReview } from './tertiaryReview';
import type { ActiveToolCall } from '../types/copilot.types';
const call = (name: string, data: unknown): ActiveToolCall => ({id:name, name, input:{}, status:'success', output:{status:'ok',data}});
test('la comparaison sans PLU reste non validée même après une recherche web', () => {
  const reasons = tertiaryReview('Compare bureaux, commerces et locaux d’activité. Quel projet ?', [call('web_search',{sources:[]}),call('get_etude_marche',{scores:{global:75}})]);
  assert.equal(reasons.length,3); assert.match(reasons[0],/non confirmés/);
});
test('une règle PLU confirmée lève seulement la réserve correspondante', () => {
  assert.equal(tertiaryReview('Compare bureaux, commerces et locaux d’activité', [call('get_parcel_plu',{zone_code:'UE',regles:{hauteur_max_m:10}})]).length,1);
  assert.deepEqual(tertiaryReview('Établis mon bilan financier', []),[]);
});
