import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as brouillon from './jarvisDraft.ts';
import * as preparation from './preparation3D.ts';
import { diagnostiquerPreparation3D, exigerPreparation3D, exigerParcelle3D } from './preparation3D.ts';
import type { JarvisDraft } from './jarvisDraft.ts';
const fiche = (patch: Partial<JarvisDraft> = {}): JarvisDraft => ({ version: 1, objectif: 'Créer une maison R+1', dimensions: '20 m sur 10 m', localisation: null, programme: null, style: null, contraintes: null, questions: [], pieces: [], ...patch });
test('fiche complète acceptée sans imposer adresse, style ou programme', () => {
  const r = diagnostiquerPreparation3D(fiche()); assert.equal(r.pret, true);
  assert.equal(r.questions.length, 0);
  assert.ok(r.informations.some(i => i.cle === 'dimensions' && i.statut === 'fourni-dans-fiche'));
  assert.ok(r.informations.some(i => i.cle === 'style' && i.statut === 'hypothese'));
});
test('questions minimales sur objectif, dimensions ou niveaux absents', () => {
  for (const p of [{ objectif: null }, { dimensions: null }, { objectif: 'Créer une maison' }]) {
    const r = diagnostiquerPreparation3D(fiche(p)); assert.equal(r.pret, false); assert.equal(r.questions.length, p.objectif === null ? 2 : 1);
    assert.throws(() => exigerPreparation3D(fiche(p)), /à préciser/);
  }
});
test('surface seule et nombre étages non R+ ne créent pas de commande', () => {
  assert.equal(diagnostiquerPreparation3D(fiche({ dimensions: '120 m²' })).pret, false);
  assert.equal(diagnostiquerPreparation3D(fiche({ objectif: 'Une maison de deux étages' })).pret, false);
});
test('dimensions présentes seulement dans objectif : garde empêche leur perte par studioCommand', () => {
  const r = diagnostiquerPreparation3D(fiche({ objectif: 'Maison R+1 de 20 m sur 10 m', dimensions: null }));
  assert.equal(r.pret, false); assert.ok(r.blocages.includes('commande'));
});
test('dimensions contradictoires entre champs : question plutôt que choix silencieux', () => {
  const r = diagnostiquerPreparation3D(fiche({ objectif: 'Maison R+1 de 30 m sur 12 m' }));
  assert.ok(r.blocages.includes('dimensions-contradictoires'));
});
test('hauteurs contradictoires, alternatives et nombre total niveaux incompatibles', () => {
  for (const p of [{ programme: 'R+4' }, { objectif: 'Maison R+1 ou R+2' }, { objectif: 'Maison R+1 à 3' }, { programme: '3 niveaux' }]) {
    const r = diagnostiquerPreparation3D(fiche(p)); assert.equal(r.pret, false); assert.ok(r.blocages.some(b => b.startsWith('niveaux-')));
  }
  assert.equal(diagnostiquerPreparation3D(fiche({ programme: '2 niveaux' })).pret, true);
});
test('dimensions hors bornes ou type bâtiment inexploitable refusés', () => {
  for (const p of [{ dimensions: '250 m sur 10 m' }, { objectif: 'Créer une idée R+1' }]) assert.equal(diagnostiquerPreparation3D(fiche(p)).pret, false);
});
const multi = fiche({ objectif: 'Deux bâtiments. Bâtiment A 20 m sur 10 m R+1. Bâtiment B 30 m sur 12 m R+2', dimensions: null });
test('deux bâtiments complets : conserve chacun et expose espacement 8m comme hypothèse', () => {
  const r = diagnostiquerPreparation3D(multi); assert.equal(r.pret, true);
  assert.equal(r.informations.filter(i => i.cle.startsWith('batiment-')).length, 2);
  assert.ok(r.informations.some(i => i.cle === 'separation' && i.statut === 'hypothese' && /8 m/.test(i.detail)));
});
test('bâtiment B incomplet : aucun repli vers A, ni réutilisation dimensions', () => {
  const r = diagnostiquerPreparation3D({ ...multi, objectif: 'Deux bâtiments. Bâtiment A 20 m sur 10 m R+1. Bâtiment B R+2' });
  assert.equal(r.pret, false); assert.ok(r.blocages.includes('composition'));
});
test('nombre demandé dans programme et bâtiments identiques sans description par bâtiment', () => {
  for (const p of [{ programme: 'Deux bâtiments identiques' }, { programme: '9 immeubles' }, { programme: 'trois bâtiments' }]) assert.equal(diagnostiquerPreparation3D(fiche(p)).pret, false);
});
test('neuvième bâtiment I détecté même si parser existant ne lit que A-H', () => {
  const objectif = 'ABCDEFGHI'.split('').map(n => 'Bâtiment ' + n + ' 20 m sur 10 m R+1').join('. ');
  const r = diagnostiquerPreparation3D(fiche({ objectif, dimensions: null }));
  assert.equal(r.pret, false); assert.ok(r.blocages.includes('composition-limite'));
});
test('plusieurs ailes dont une incomplète : pas de repli monovolume', () => {
  assert.equal(diagnostiquerPreparation3D(fiche({ objectif: 'Maison R+1, partie centrale 20 m sur 10 m R+1 et aile gauche à préciser' })).pret, false);
});
test('charge film/3D appelle les deux gardes avant toute opération I/O', () => {
  const source = readFileSync(new URL('./chargeVoirEn3D.ts', import.meta.url), 'utf8');
  const corps = source.slice(source.indexOf('): Promise<PreparationChargeStudio> {'));
  assert.match(corps, /exigerPreparation3D\(fiche\)/);
  assert.match(corps, /exigerParcelle3D\(retenue\?\.parcel\)/);
  assert.ok(corps.indexOf('exigerPreparation3D(fiche)') < corps.indexOf('await '));
  assert.ok(corps.indexOf('exigerParcelle3D(retenue?.parcel)') < corps.indexOf('await '));
});

test('contradictions locales de chaque bâtiment : dimensions, R+N et niveaux totaux', () => {
  for (const a of ['Bâtiment A 20 m sur 10 m et 30 m sur 12 m R+1', 'Bâtiment A 20 m sur 10 m R+1 puis R+4', 'Bâtiment A 20 m sur 10 m R+1 et 3 niveaux']) {
    const r = diagnostiquerPreparation3D(fiche({ objectif: a + '. Bâtiment B 30 m sur 12 m R+2', dimensions: null }));
    assert.equal(r.pret, false); assert.ok(r.blocages.some(b => b.startsWith('contradiction-')));
  }
});

const ring = [[2,48],[2.001,48],[2.001,48.001],[2,48.001],[2,48]];
const geom = (coordinates: unknown = [ring]) => ({ type: 'Polygon', coordinates });
test('parcelle géométrique valide, feature sans properties, multi et trous', () => {
  assert.doesNotThrow(() => exigerParcelle3D(geom()));
  assert.doesNotThrow(() => exigerParcelle3D({ type: 'Feature', geometry: geom() }));
  assert.doesNotThrow(() => exigerParcelle3D({ type: 'MultiPolygon', coordinates: [[ring], [ring]] }));
  const trou = [[2.0002,48.0002],[2.0003,48.0002],[2.0003,48.0003],[2.0002,48.0002]];
  assert.doesNotThrow(() => exigerParcelle3D(geom([ring, trou])));
});
test('refuse parcelles nulles, non fermées, dégénérées, trous invalides ou coordonnées hors bornes', () => {
  const invalides = [null, {}, { type: 'Point', coordinates: [2,48] }, geom([]), geom([ring.slice(0,-1)]),
    geom([[[2,48],[3,49],[4,50],[2,48]]]), geom([ring, []]),
    geom([[[200,48],[201,48],[201,49],[200,48]]]), geom([[[2,NaN],[3,48],[3,49],[2,NaN]]]),
    { type: 'MultiPolygon', coordinates: [] }, { type: 'Feature', geometry: null }];
  for (const v of invalides) assert.throws(() => exigerParcelle3D(v), /contour cadastral/);
});

test('nombre zéro et nombre annoncé différent des bâtiments nommés bloquent', () => {
  for (const f of [fiche({ programme: '0 bâtiment' }), { ...multi, programme: '1 bâtiment' }, { ...multi, programme: '3 bâtiments' }]) {
    const r = diagnostiquerPreparation3D(f); assert.equal(r.pret, false); assert.ok(r.blocages.includes('nombre-contradictoire'));
  }
});

test('appel réel de preparerChargeVoirEn3D : fiche ou parcelle invalide, zéro I/O', async () => {
  // Exécute le vrai corps du module ; seules ses dépendances externes sont remplacées.
  const source = readFileSync(new URL('./chargeVoirEn3D.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let io = 0;
  const fauxRequire = (nom: string) => {
    if (nom === './preparation3D') return preparation;
    if (nom === './jarvisDraft') return brouillon;
    return new Proxy({}, { get: () => (..._args: unknown[]) => { io++; throw new Error('I/O interdit pendant le garde'); } });
  };
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', js)(fauxRequire, exports);
  const lancer = exports.preparerChargeVoirEn3D as (f: JarvisDraft, c: string, t: unknown) => Promise<unknown>;
  await assert.rejects(lancer(fiche({ dimensions: null }), 'conversation', { parcel: { type: 'Feature', geometry: geom() } }), /à préciser/);
  assert.equal(io, 0);
  await assert.rejects(lancer(fiche(), 'conversation', { parcel: { type: 'Feature', geometry: geom([ring.slice(0,-1)]) } }), /contour cadastral/);
  assert.equal(io, 0);
});

test('m5 « R+N maximum » est une limite, pas une contradiction ; Voir en 3D existant préservé', () => {
  for (const contraintes of ['R+4 maximum', 'Hauteur limitée à R+4', 'jusqu’à R+4 selon le PLU', 'PLU : R+4 max.', '6 niveaux maximum', 'pas plus de R+5'])
    assert.equal(diagnostiquerPreparation3D(fiche({ objectif: 'Immeuble de logements R+3', contraintes })).pret, true, contraintes);
  // La limite ne remplace jamais la hauteur du projet ni n'en tient lieu.
  const sansHauteur = diagnostiquerPreparation3D(fiche({ objectif: 'Immeuble de logements', contraintes: 'R+4 maximum' }));
  assert.equal(sansHauteur.pret, false); assert.ok(sansHauteur.blocages.includes('niveaux'));
  assert.equal(brouillon.jarvisMassing(fiche({ objectif: 'Immeuble de logements R+3', contraintes: 'R+4 maximum' }))?.niveaux, 4);
  // Les vraies contradictions restent bloquantes.
  assert.equal(diagnostiquerPreparation3D(fiche({ objectif: 'Immeuble R+3', contraintes: 'R+4' })).pret, false);
  assert.equal(diagnostiquerPreparation3D(fiche({ objectif: 'Immeuble R+3 ou R+4' })).pret, false);
  assert.equal(diagnostiquerPreparation3D(fiche({ objectif: 'Immeuble R+3', contraintes: '6 niveaux' })).pret, false);
  // Multi-bâtiments : la limite dans une section n'est pas une seconde hauteur.
  const multi = fiche({ objectif: 'Deux bâtiments : bâtiment A 20 m sur 10 m R+2, bâtiment B 15 m sur 10 m R+3 (R+4 maximum)', dimensions: null });
  assert.ok(!diagnostiquerPreparation3D(multi).blocages.some(b => b.startsWith('contradiction')), JSON.stringify(diagnostiquerPreparation3D(multi).questions));
});
