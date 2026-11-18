// INTÉGRATION DU 18/11/2026 — côté de la rue DÉSIGNÉ par l'utilisateur (puces « Côté de la rue ») : mémorisé comme
// limite sur rue (source « utilisateur ») et relu pour la machine de rendu ; une lecture du cadastre reste prioritaire.
import * as na from 'node:assert/strict';
const assert = (c: unknown, m?: string) => na.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => na.deepEqual(a, b);
import { facadesChoisiesDesSorties, facadesDuCoteChoisi, facadesLuesDesSorties, lireFacadesLues, longueurAreteM } from './extension.ts';
import { candidatsCoteRue } from '../../_shared/extension/coteRue.ts';

// Parcelle rectangulaire d'environ 20 × 30 m (WGS 84).
const anneau: [number, number][] = [[2.40000, 48.90000], [2.40027, 48.90000], [2.40027, 48.90027], [2.40000, 48.90027], [2.40000, 48.90000]];
const IDU = '930470000P0646';

Deno.test('INT-C1 côté choisi → limite sur rue « utilisateur » aux bonnes arêtes, longueur cohérente', () => {
  const candidats = candidatsCoteRue(anneau);
  assert(candidats.length >= 2);
  const choix = candidats[0]!;
  const f = facadesDuCoteChoisi(IDU, '2026-11-18', anneau, choix.libelle)!;
  assert(f);
  assertEquals(f.idu, IDU);
  assert(f.facades.every((x) => x.source === 'utilisateur'));
  const total = f.facades.reduce((s, x) => s + x.longueurM, 0);
  assert(Math.abs(total - choix.longueurM) < 0.5, `${total} ≠ ${choix.longueurM}`);
  assertEquals(facadesDuCoteChoisi(IDU, '2026-11-18', anneau, 'Côté inconnu'), null);
  assertEquals(facadesDuCoteChoisi(IDU, '2026-11-18', null, choix.libelle), null);
});

Deno.test('INT-C2 relecture : « utilisateur » relu seulement comme tel ; jamais confondu avec une lecture du cadastre', () => {
  const f = facadesDuCoteChoisi(IDU, '2026-11-18', anneau, candidatsCoteRue(anneau)[0]!.libelle)!;
  const sorties = [{ facades_voie_choisies: JSON.parse(JSON.stringify(f)) }];
  assertEquals(facadesChoisiesDesSorties(sorties, IDU)?.facades.length, f.facades.length);
  assertEquals(facadesChoisiesDesSorties(sorties, '930470000P0647'), null);
  assertEquals(facadesLuesDesSorties([{ facades_voie_lues: JSON.parse(JSON.stringify(f)) }], IDU), null);
  assertEquals(lireFacadesLues(JSON.parse(JSON.stringify(f)), 'utilisateur')?.facades[0]?.source, 'utilisateur');
});

Deno.test('INT-C3 longueur d’une arête : 0,00027° de longitude à 48,9° N ≈ 19,8 m', () => {
  const l = longueurAreteM([2.4, 48.9], [2.40027, 48.9]);
  assert(l > 19.5 && l < 20.1, String(l));
});
