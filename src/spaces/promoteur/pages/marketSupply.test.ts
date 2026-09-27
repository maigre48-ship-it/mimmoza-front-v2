import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRpls, parseSitadel } from './marketSupply.ts';

test('Sitadel conserve la maille communale et somme trois exercices vérifiés', () => {
  const raw = { status: 'ok', stats: { commune_insee: '64065', logements: { par_annee: [
    { annee: '2025', total: 12, collectif: 8 }, { annee: '2024', total: 10, collectif: 4 }, { annee: '2023', total: 5, collectif: 0 },
  ] } } };
  assert.equal(parseSitadel(raw, '64065')?.authorisedHomes, 27);
  assert.equal(parseSitadel(raw, '64065')?.collectiveHomes, 12);
  assert.equal(parseSitadel(raw, '64122'), null);
  assert.equal(parseSitadel({ ...raw, stats: { ...raw.stats, logements: { par_annee: [{ annee: '2025', total: null, collectif: 0 }] } } }, '64065'), null);
});

test('RPLS refuse une estimation ou une autre commune', () => {
  const raw = { codeInsee: '64065', rplsMode: 'reel', rplsAnnee: 2025, logementsRpls: 310, demandesEnAttente: 82, attributionsAnnuelles: 25 };
  assert.equal(parseRpls(raw, '64065')?.homes, 310);
  assert.equal(parseRpls({ ...raw, rplsMode: 'estime' }, '64065'), null);
  assert.equal(parseRpls(raw, '64122'), null);
});
