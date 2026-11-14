// deno test --no-lock -A supabase/functions/servitudes-gpu-v1/logique.test.ts — LOT P11, sans réseau.
// Les identifiants ci-dessous sont ceux des réponses RÉELLES de servitudes-gpu-v1 enregistrées dans
// copilot_tool_calls (production, lecture seule) : Bayonne 04/08/2026, Ciboure 26/09 et 05/10/2026,
// Montreuil 10/11/2026. Dans toutes, `categorie` valait null.
import assert from 'node:assert/strict';
import { categorieServitude, codeCnig } from './logique.ts';

const REELS = [
  { nom: 'Site patrimonial remarquable de Bayonne', idass: 'AC4-172014607-1911140477-1-1', idgen: 'AC4-172014607-1911140477-1', partition: '172014607_SUP_64_AC4', categorie: null, attendu: 'AC4' },
  { nom: "Eglise de l'Assomption", idass: 'AC1-172014607-1907231266-1-2', idgen: 'AC1-172014607-1907231266-1', partition: '172014607_SUP_64_AC1', categorie: null, attendu: 'AC1' },
  { nom: 'Ensemble dit du Labourd', idass: 'AC2-130010457-251-1-1', idgen: 'AC2-130010457-251-1', partition: '130010457_SUP_R75_AC2', categorie: null, attendu: 'AC2' },
  { nom: 'Plan_de_prevention_des_risques_naturels_previsibles_et_des_risques_miniers', idass: 'PM1-130011570-82-1-1', idgen: 'PM1-130011570-82-1', partition: '130011570_SUP_64_PM1', categorie: null, attendu: 'PM1' },
  { nom: 'Périmètre approuvé du plan de prévention des risques mouvements de terrain de Montreuil', idass: 'PM1-130029325-51-1-1', idgen: 'PM1-130029325-51-1', partition: '130029325_SUP_93_PM1', categorie: null, attendu: 'PM1' },
];

Deno.test('P11-S1 : catégorie vide en réel → lue dans idgen (AC1, AC2, AC4, PM1)', () => {
  for (const r of REELS) {
    assert.deepEqual(categorieServitude(r), { code: r.attendu, origine: 'idgen' }, r.nom);
  }
});

Deno.test('P11-S2 : repli idass puis partition ; champ categorie prioritaire s’il est un code', () => {
  const ac1 = REELS[1]!;
  assert.deepEqual(categorieServitude({ idass: ac1.idass, partition: ac1.partition }), { code: 'AC1', origine: 'idass' });
  assert.deepEqual(categorieServitude({ partition: '130010457_SUP_R75_AC2' }), { code: 'AC2', origine: 'partition' });
  assert.deepEqual(categorieServitude({ partition: '172014607_SUP_64_AC1' }), { code: 'AC1', origine: 'partition' });
  assert.deepEqual(categorieServitude({ categorie: 'ac1', idgen: 'PM1-1-2' }), { code: 'AC1', origine: 'categorie' });
  assert.deepEqual(categorieServitude({ categorie: '', idgen: 'INT1-210000000-3-1' }), { code: 'INT1', origine: 'idgen' });
});

Deno.test('P11-S3 : rien de devinable → null (aucune catégorie inventée)', () => {
  assert.equal(categorieServitude({}), null);
  assert.equal(categorieServitude({ categorie: null, idgen: null, idass: undefined, partition: '' }), null);
  assert.equal(categorieServitude({ categorie: 'Monuments historiques', idgen: '172014607-xx', partition: 'SUP_AC1' }), null);
  assert.equal(codeCnig('AC12345'), null);
  assert.equal(codeCnig(' pt2 '), 'PT2');
});
