// node --test src/spaces/copilot/studio3d/coteVoie.test.ts
// Fixture : géométries RÉELLES du cadastre (API Carto IGN, 10/11/2026) pour la parcelle 93048000AS0249
// (98 rue de Paris, Montreuil) et les cinq parcelles qui la touchent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distancePointSegment, empriseMaxParBande, identifierCoteVoie, mesurerBandes } from './coteVoie.ts';
import { lireRegles, reglesVolume } from './controlesVolume.ts';

const d = JSON.parse(readFileSync(new URL('./__fixtures__/cadastre-93048000AS0249.json', import.meta.url), 'utf8'));
const parcelle = d.parcelle.geometry;
const voisines = d.voisines.map((v: { geometry: unknown }) => v.geometry);

test('cas réel : le côté voie est la limite sud, sur la rue de Paris (deux segments, 28,65 m)', () => {
  const c = identifierCoteVoie(parcelle, voisines);
  assert.equal(c.statut, 'identifie');
  assert.equal(c.nbVoisines, 5);
  assert.equal(c.facades.length, 2);
  assert.ok(Math.abs(c.longueurFacadeM - 28.65) < 0.05, String(c.longueurFacadeM));
  // Les deux segments sont au sud de la parcelle (y local négatif) : le 98 rue de Paris est au sud.
  for (const f of c.facades) assert.ok(f.a.y < 0 && f.b.y < 0, JSON.stringify(f));
  assert.match(c.note, /Côté voie présumé : 28,65 m/);
});

test('la parcelle elle-même parmi les voisines ne supprime pas la façade', () => {
  const c = identifierCoteVoie(parcelle, [parcelle, ...voisines]);
  assert.equal(c.statut, 'identifie');
  assert.ok(Math.abs(c.longueurFacadeM - 28.65) < 0.05);
});

test('on ne conclut pas sans voisines, ni sur un contour illisible', () => {
  assert.equal(identifierCoteVoie(parcelle, []).statut, 'voisines_absentes');
  assert.equal(identifierCoteVoie(null, voisines).statut, 'contour_invalide');
  assert.equal(mesurerBandes(identifierCoteVoie(parcelle, []), 18), null);
});

test('parcelle enclavée (toutes ses limites sont mitoyennes) : aucune façade', () => {
  const carre = (x0: number, y0: number, c: number) => ({ type: 'Polygon' as const, coordinates: [[[x0, y0], [x0 + c, y0], [x0 + c, y0 + c], [x0, y0 + c], [x0, y0]]] });
  const k = 0.0002;   // environ 15 m × 22 m
  const centre = carre(2.4, 48.85, k);
  const autour = [carre(2.4 - k, 48.85, k), carre(2.4 + k, 48.85, k), carre(2.4, 48.85 - k, k), carre(2.4, 48.85 + k, k)];
  assert.equal(identifierCoteVoie(centre, autour).statut, 'aucune_facade');
  // On retire la voisine du sud : la limite sud devient le côté voie.
  const c = identifierCoteVoie(centre, autour.filter((_, i) => i !== 2));
  assert.equal(c.statut, 'identifie');
  assert.equal(c.facades.length, 1);
});

test('cas réel : bande principale de 18 m = 461 m², bande secondaire = 355 m², stable quand on affine la grille', () => {
  const c = identifierCoteVoie(parcelle, voisines);
  const m = mesurerBandes(c, 18)!;
  assert.deepEqual(m, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
  const fin = mesurerBandes(c, 18, 0.1)!;
  assert.ok(Math.abs(fin.bandePrincipaleM2 - m.bandePrincipaleM2) <= 1);
  // Une bande plus profonde que la parcelle la couvre entièrement.
  assert.equal(mesurerBandes(c, 100)!.bandeSecondaireM2, 0);
  assert.equal(mesurerBandes(c, 0), null);
});

test('cas réel : emprise maximale de l’indice J (80 % / 20 %) = 368 + 71 = 439 m², soit 53,8 % de la parcelle', () => {
  const m = mesurerBandes(identifierCoteVoie(parcelle, voisines), 18)!;
  assert.deepEqual(empriseMaxParBande(m, 80, 20), { principaleM2: 368, secondaireM2: 71, totalM2: 439, tauxParcellePct: 53.8 });
  assert.deepEqual(empriseMaxParBande(m, 80, null), { principaleM2: 368, secondaireM2: null, totalM2: null, tauxParcellePct: null });
  assert.equal(empriseMaxParBande(m, 120, 20), null);
});

test('distancePointSegment : projection bornée aux extrémités', () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
  assert.equal(distancePointSegment({ x: 5, y: 3 }, a, b), 3);
  assert.equal(distancePointSegment({ x: -4, y: 3 }, a, b), 5);
  assert.equal(distancePointSegment({ x: 2, y: 0 }, a, a), 2);
});

const REGLES = lireRegles([
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: 'Règlement GPU', article: 'indice b2, p. 263', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }] },
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: 'Règlement GPU', article: 'indice J, p. 237', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }] },
]);

test('reglesVolume avec les bandes mesurées : 80 % de 461 m² = 368 m², soit 45 % de la parcelle (bande secondaire non construite)', () => {
  const m = mesurerBandes(identifierCoteVoie(parcelle, voisines), 18)!;
  const v = reglesVolume(REGLES, null, m);
  assert.equal(v.regles.find((x) => x.cle === 'emprise_max_ratio')?.valeur, 0.45);   // 368 / 816 = 0,4509… arrondi par défaut
  assert.equal(v.regles.find((x) => x.cle === 'hauteur_max_m')?.valeur, 19.5);
  const notes = v.nonAppliquees.join(' | ');
  assert.match(notes, /80 % de la bande principale \(461 m² à moins de 18 m de la voie\) = 368 m², soit 45 % de la parcelle de 816 m²/);
  assert.match(notes, /Bande secondaire \(355 m², emprise 20 %\) : non construite/);
  assert.match(notes, /pas encore contraint à rester dans la bande principale/);
});

test('reglesVolume sans bandes mesurées, ou avec une autre profondeur : comportement prudent du lot C6 inchangé', () => {
  const sans = reglesVolume(REGLES, null);
  assert.equal(sans.regles.find((x) => x.cle === 'emprise_max_ratio')?.valeur, 0.2);
  assert.match(sans.nonAppliquees.join(' | '), /SOUS-ESTIME/);
  const autre = mesurerBandes(identifierCoteVoie(parcelle, voisines), 15)!;   // la règle dit 18 m : la mesure à 15 m n'est pas utilisée
  assert.equal(reglesVolume(REGLES, null, autre).regles.find((x) => x.cle === 'emprise_max_ratio')?.valeur, 0.2);
});
