// NUIT-1 — non-régression du moteur embarqué sur le banc (studio, T2–T5) : passage 0.3.0 → 0.6.0.
// Attendus RELEVÉS avec le moteur 0.3.0 (avant la recopie) : graine, verdict, score de tri, meubles placés, non placés
// de chaque variante (seed 1, 3 variantes). Sans `tailles` ni `disponibles`, la 0.6.0 doit les reproduire à l'identique.
import { strict as assert } from 'node:assert';
import { calculerVariantes, VERSION_MOTEUR } from '../pipeline.ts';

const lire = async (n: string) => JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${n}.json`, import.meta.url)));
const BRIEF = (await lire('p03-t3')).brief;

/** [graine, verdict, score de tri, placés, non placés] par variante, dans l'ordre de tri — relevés sous 0.3.0. */
const ATTENDU_03: Record<string, Array<[number, string, number, number, number]>> = {
  'p01-studio': [[1, "defavorable", 99.1, 19, 3], [3, "defavorable", 97.9, 19, 3], [2, "defavorable", 94.5, 20, 2]],
  'p02-t2': [[2, "defavorable", 97.8, 24, 4], [1, "defavorable", 97.7, 24, 4], [3, "defavorable", 96.1, 24, 4]],
  'p03-t3': [[1, "reserve", 98.2, 31, 2], [2, "reserve", 98.2, 31, 2], [3, "reserve", 97.4, 31, 2]],
  'p04-t4': [[3, "favorable", 99.2, 41, 0], [1, "favorable", 96.8, 41, 0], [2, "favorable", 96.8, 40, 1]],
  'p05-t5': [[3, "favorable", 99.6, 47, 0], [1, "favorable", 99.3, 47, 0], [2, "favorable", 99, 47, 0]],
};

Deno.test('moteur embarqué : version 0.6.0', () => {
  assert.equal(VERSION_MOTEUR, '0.6.0');
});

for (const [cas, attendu] of Object.entries(ATTENDU_03)) {
  Deno.test(`banc ${cas} : variantes identiques à celles du moteur 0.3.0`, async () => {
    const fx = await lire(cas);
    const r = calculerVariantes(fx.plan, BRIEF, { seed: 1, nombre: 3, budgetMs: 60_000 });
    assert.equal(r.ecartees.length, 0);
    const obtenu = r.variantes.map((v) => [v.seed, v.verdict, v.score, v.layout.placements.length, v.layout.unplaced.length]);
    assert.deepEqual(obtenu, attendu);
  });
}
