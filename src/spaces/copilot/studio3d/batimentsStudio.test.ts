// Transmission à Studio de TOUS les bâtiments du Dossier 3D (projet v2 `batiments`),
// compatible avec le bâtiment unique historique.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decoderProjet, encoderProjet, validerProjet } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { batimentsV2DepuisVolume, rotationContrat, signatureFiche, volumeBatimentsStudio } from './batimentsStudio.ts';
import { implantationDepuisVolume } from './confirmationRapide.ts';
import { calculerVolumeProgramme } from './implantationProgramme.ts';
import { programmeBatiDepuisTexte } from './programmeBati.ts';
import { chargeV1Chat, construireProjetChat, type EntreeProjetChat } from './projetChat.ts';
import { ficheStudioDepuisVolume, type GeometrieParcelle, type ProgrammeVolume } from './volumeParcelle.ts';
import { diagnostiquerPreparation3D } from './preparation3D.ts';
import { construirePlanAxo, svgPlanAxo } from './planAxonometriqueLogique.ts';

const LAT = 43.355, LON = -1.62, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function rectangle(l: number, h: number, rot = 0): GeometrieParcelle {
  const a = rot * Math.PI / 180;
  const ring = [[0, 0], [l, 0], [l, h], [0, h]].map(([x, y]) => [LON + (x * Math.cos(a) - y * Math.sin(a)) / KX, LAT + (x * Math.sin(a) + y * Math.cos(a)) / 111_320]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
const programme = (t: string): ProgrammeVolume => ({ ...programmeBatiDepuisTexte(t)!, origine: 'conversation' });
const CONV = '3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f', SESSION = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function entree(g: GeometrieParcelle, partiel: Partial<EntreeProjetChat> = {}): EntreeProjetChat {
  return {
    conversationId: CONV, sessionId: SESSION, origine: 'https://mimmoza.vercel.app', retourUrl: null, revision: 1, horodatage: '2026-11-03T10:00:00.000Z',
    parcelles: [{ id: '64065000AI0001', feature: { type: 'Feature', properties: { idu: '64065000AI0001' }, geometry: g } }],
    communeInsee: '64065', adresse: 'Ascain', pointAdresse: { lat: LAT, lon: LON }, relief: null,
    implantation: { lon: LON, lat: LAT, orientationDeg: -20, entryOffsetM: 0 }, accesses: [{ kind: 'pieton', lon: LON, lat: LAT }],
    brief: 'Dossier 3D', commandeArchitecture: 'Crée une maison R+1 de 39 m sur 8,5 m.', ...partiel,
  };
}

test('rotation du contrat : −angle, ramenée dans ]−180, 180] (même convention que implantationDepuisVolume)', () => {
  assert.equal(rotationContrat(20), -20);
  assert.equal(rotationContrat(110), -110);
  assert.equal(rotationContrat(0), 0);
  assert.equal(rotationContrat(180), 180);
  assert.equal(rotationContrat(-190), -170);
  assert.equal(rotationContrat(190), 170);
  const v = calculerVolumeProgramme(rectangle(100, 50, 20), programme('village sénior de 25 maisons'));
  assert.equal(implantationDepuisVolume(v)!.orientationDeg, rotationContrat(v.emprise!.angleDeg));
});

test('bâtiments v2 : un par bâtiment, géoréférencés, emprise fermée, nature « estime », identifiants stables', () => {
  const g = rectangle(100, 50, 20);
  const v = calculerVolumeProgramme(g, programme('village sénior de 25 maisons'));
  const b = batimentsV2DepuisVolume(v);
  assert.equal(b.length, v.batiments!.length);
  assert.ok(b.length >= 2);
  b.forEach((x, i) => {
    assert.equal(x.id, `mz-vol-${i + 1}`);
    assert.equal(x.refs.front, x.id); assert.equal(x.refs.studio, null);
    assert.equal(x.nature, 'estime');
    assert.equal(x.niveaux, v.batiments![i].niveaux);
    assert.equal(x.largeurM, v.batiments![i].largeurM);
    assert.equal(x.rotationDeg, rotationContrat(v.batiments![i].angleDeg));
    const anneau = x.emprise[0];
    assert.equal(anneau.length, 5); assert.deepEqual(anneau[0], anneau[4]);
    // Le centre est au milieu de l'emprise (WGS 84).
    const lon = anneau.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4, lat = anneau.slice(0, 4).reduce((s, p) => s + p[1], 0) / 4;
    assert.ok(Math.abs(lon - x.centre.lon) < 1e-7 && Math.abs(lat - x.centre.lat) < 1e-7);
  });
  // Un seul bâtiment : rien (chemin historique).
  const seul = calculerVolumeProgramme(rectangle(40, 40), programme('1 maison'));
  assert.equal(seul.batiments?.length ?? 0, 1);
  assert.deepEqual(batimentsV2DepuisVolume(seul), []);
  assert.equal(volumeBatimentsStudio(seul, { objectif: 'x', dimensions: 'y' }), null);
});

test('projet v2 du tchat : TOUS les bâtiments transmis, valides au contrat, sans pose unique ni accès ; aller-retour sans perte', () => {
  const g = rectangle(100, 50, 20);
  const v = calculerVolumeProgramme(g, programme('village sénior de 25 maisons'));
  const fiche = ficheStudioDepuisVolume(v, { reference: 'AI 0001', programme: programme('village sénior de 25 maisons') })!;
  const vb = volumeBatimentsStudio(v, fiche)!;
  assert.equal(vb.signatureFiche, signatureFiche(fiche));
  const r = construireProjetChat(entree(g, { batiments: vb.batiments, programmeVolume: vb }));
  assert.ok(r.ok, r.ok ? '' : r.erreur);
  if (!r.ok) return;
  assert.equal(r.projet.batiments.length, v.batiments!.length);
  assert.deepEqual(r.projet.batiments.map(b => b.id), v.batiments!.map(b => b.id));
  assert.equal(r.projet.extensionsV1.implantation, null, 'pas de pose unique qui déplacerait le premier bâtiment');
  assert.equal(r.projet.acces.length, 0);
  assert.equal(r.projet.programme.logementsVises, 25);
  assert.equal(r.projet.programme.logementsModelises, v.kpi!.maisons);
  assert.deepEqual(r.projet.programme.surfacePlancherM2, { valeur: v.kpi!.sdpTotaleM2, nature: 'estime' });
  assert.ok(validerProjet(JSON.parse(JSON.stringify(r.projet))).ok);
  const relu = decoderProjet(encoderProjet(r.projet));
  assert.ok(relu.ok);
  if (relu.ok) assert.deepEqual(relu.projet.batiments, r.projet.batiments);
  // La fiche (bâtiment principal) reste exploitable par le diagnostic 3D (pas de « composition A à H »).
  assert.equal(diagnostiquerPreparation3D(fiche).pret, true, diagnostiquerPreparation3D(fiche).questions.join(' '));
});

test('bâtiment unique : charge historique inchangée (implantation, accès, aucun bâtiment v2)', () => {
  const g = rectangle(100, 50);
  const sans = construireProjetChat(entree(g));
  const avecUn = construireProjetChat(entree(g, { batiments: [], programmeVolume: null }));
  assert.ok(sans.ok && avecUn.ok);
  if (!sans.ok || !avecUn.ok) return;
  assert.deepEqual(avecUn.projet, sans.projet);
  assert.equal(sans.projet.batiments.length, 0);
  assert.ok(sans.projet.extensionsV1.implantation);
  assert.ok('implantation' in chargeV1Chat(entree(g)));
});

test('limite Studio : plus de 12 bâtiments refusés avec un message clair', () => {
  const g = rectangle(100, 50);
  const v = calculerVolumeProgramme(g, programme('village sénior de 25 maisons'));
  const b = batimentsV2DepuisVolume(v);
  const treize = Array.from({ length: 13 }, (_, i) => ({ ...b[0], id: `mz-vol-${i + 1}` }));
  const r = construireProjetChat(entree(g, { batiments: treize }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erreur, /12 au plus/);
  assert.throws(() => batimentsV2DepuisVolume({ origine: v.origine, batiments: Array.from({ length: 13 }, () => v.batiments![0]) }), /12 au plus/);
});

test('plan axonométrique multi-bâtiments : faces de chaque bâtiment, voies, cartouche « N bâtiments », SVG sans NaN', () => {
  const v = calculerVolumeProgramme(rectangle(100, 50, 20), programme('village sénior de 25 maisons'));
  const plan = construirePlanAxo(v, { largeur: 640 });
  assert.equal(plan.groupes.length, v.batiments!.length);
  assert.equal(plan.groupes.reduce((s, g) => s + g.faces, 0), plan.faces.length);
  assert.equal(plan.faces.filter(f => f.ton === 'dessus').length, v.batiments!.length);
  assert.equal(plan.voies.length, v.voies!.length);
  assert.deepEqual(plan.cotes.map(c => c.lettre), ['L', 'P', 'H']);
  const svg = svgPlanAxo(v, { idu: '64065000AI0001', mention: v.mentionPlu, programme: '25 maisons seniors' });
  assert.ok(!/NaN|undefined/.test(svg));
  assert.match(svg, new RegExp(`${v.batiments!.length} bâtiments · 25 maisons`));
  assert.match(svg, /data-voie/);
});
