import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEhpadOrganizations } from './parse.ts';

test('FINESS ne retient que les EHPAD actifs de la commune vérifiée', () => {
  const item = (city: string, active: boolean, code: string, number: string) => ({ resource: { resourceType: 'Organization', active, name: 'Résidence du Centre',
    type: [{ coding: [{ system: 'https://mos.esante.gouv.fr/NOS/TRE_R66-CategorieEtablissement/FHIR/TRE-R66-CategorieEtablissement', code }] }],
    address: [{ city }], identifier: [{ system: 'https://finess.esante.gouv.fr', value: number }] } });
  const parsed = parseEhpadOrganizations({ resourceType: 'Bundle', total: 4, entry: [item('Ascain', true, '500', '640123456'),
    item('Ascain', false, '500', '640123457'), item('Bayonne', true, '500', '640123458'), item('Ascain', true, '101', '640123459')] }, 'Ascain');
  assert.equal(parsed?.items.length, 1);
  assert.equal(parsed?.items[0].finess, '640123456');
  assert.equal(parsed?.complete, true);
  assert.deepEqual(parseEhpadOrganizations({ resourceType: 'Bundle', total: 0 }, 'Ascain')?.items, []);
});
