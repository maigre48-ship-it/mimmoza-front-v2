// Implantation multi-bâtiments adaptée au programme : typologie, placement, reculs,
// non-chevauchement, limite Studio, programme non atteint, cas réels (Ascain, Nanterre).
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculerVolumeProgramme, contraintesPlu, HYPOTHESES_PROGRAMME, LIMITE_BATIMENTS_STUDIO } from './implantationProgramme.ts';
import { programmeBatiDepuisTexte } from './programmeBati.ts';
import { calculerVolumeParcelle, type GeometrieParcelle, type PointLocal, type ProgrammeVolume, type ReglesPluVolume, type VolumePropose } from './volumeParcelle.ts';

const LAT = 43.355, LON = -1.62; // Ascain
const KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function polygone(points: [number, number][], rotationDeg = 0): GeometrieParcelle {
  const a = rotationDeg * Math.PI / 180;
  const ring = points.map(([x, y]) => [LON + (x * Math.cos(a) - y * Math.sin(a)) / KX, LAT + (x * Math.sin(a) + y * Math.cos(a)) / 111_320]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
const rectangle = (l: number, h: number, rot = 0) => polygone([[0, 0], [l, 0], [l, h], [0, h]], rot);
const programme = (texte: string): ProgrammeVolume => ({ ...programmeBatiDepuisTexte(texte)!, origine: 'conversation' });
const regles = (r: { cle: string; valeur: number; minimumM?: number }[]): ReglesPluVolume =>
  ({ source: 'plu-chiffre', regles: r.map(x => ({ ...x, source: 'Règlement PLU', statut: 'lue' })) as ReglesPluVolume['regles'], nonAppliquees: [] });

const dansAnneau = (r: PointLocal[], x: number, y: number) => { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) d = !d; } return d; };
const distSeg = (p: PointLocal, a: PointLocal, b: PointLocal) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
/** Boîte d'un rectangle dans le repère tourné de l'implantation. */
const boite = (coins: PointLocal[], angleDeg: number) => {
  const a = -angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const us = coins.map(p => p.x * c - p.y * s), vs = coins.map(p => p.x * s + p.y * c);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
};
const ecart = (a: ReturnType<typeof boite>, b: ReturnType<typeof boite>) => Math.max(a.u0 - b.u1, b.u0 - a.u1, a.v0 - b.v1, b.v0 - a.v1);

/** Invariants : dans la parcelle à ≥ recul, aucun chevauchement, ≥ 4 m entre maisons et ≥ 6 m sinon, voies hors bâti, ≤ 12 bâtiments, CES. */
function verifier(v: VolumePropose, ces = 0.4) {
  const bats = v.batiments ?? [];
  assert.ok(bats.length >= 1 && bats.length <= LIMITE_BATIMENTS_STUDIO, `nombre de bâtiments ${bats.length}`);
  const r = v.contour;
  for (const b of bats) for (const c of b.coins) {
    assert.ok(dansAnneau(r, c.x, c.y), `${b.nom} : coin hors parcelle`);
    for (let i = 0; i < r.length; i++) assert.ok(distSeg(c, r[i], r[(i + 1) % r.length]) >= v.reculM - 0.05, `${b.nom} : trop près d’une limite`);
  }
  const angle = bats[0].angleDeg;
  for (const b of bats) assert.equal(b.angleDeg, angle);
  for (let i = 0; i < bats.length; i++) for (let j = i + 1; j < bats.length; j++)
    assert.ok(ecart(boite(bats[i].coins, angle), boite(bats[j].coins, angle)) >= (bats[i].forme.startsWith('maison') && bats[j].forme.startsWith('maison')
      ? HYPOTHESES_PROGRAMME.ecartPignonsMaisonsM : HYPOTHESES_PROGRAMME.distancePignonsMinM) - 0.01, `${bats[i].nom} / ${bats[j].nom} trop proches`);
  for (const w of v.voies ?? []) for (const b of bats)
    assert.ok(ecart(boite(w.coins, angle), boite(b.coins, angle)) >= HYPOTHESES_PROGRAMME.reculVoieM - 0.01, `voie trop près de ${b.nom}`);
  assert.ok(v.kpi!.empriseTotaleM2 <= ces * v.surfaceParcelleM2 + 1, `emprise ${v.kpi!.empriseTotaleM2}`);
  assert.equal(v.kpi!.batiments, bats.length);
  assert.equal(v.kpi!.unites, bats.reduce((s, b) => s + b.unites, 0));
  // Le bâtiment principal (emprise) est l'un des bâtiments.
  assert.ok(bats.some(b => b.centre.x === v.emprise!.centre.x && b.centre.y === v.emprise!.centre.y));
}

// Parcelle irrégulière d'environ 5 000 m² (pentagone), orientée à 20°.
const ASCAIN = polygone([[0, 0], [104, 0], [110, 38], [62, 54], [0, 48]], 20);

test('Ascain — village seniors de 25 maisons : maisons groupées, voie, reculs, et non plus un bloc R+3 unique', () => {
  const p = programme('trouve moi le meilleur terrain à Ascain pour lancer un projet de villages séniors avec 25 maisons');
  const ancien = calculerVolumeParcelle(ASCAIN, p);
  const v = calculerVolumeProgramme(ASCAIN, p);
  assert.ok(Math.abs(v.surfaceParcelleM2 - 5000) < 300, String(v.surfaceParcelleM2));
  assert.equal(v.statut, 'calcule');
  verifier(v);
  assert.ok(v.batiments!.length >= 3, 'plusieurs bâtiments');
  assert.ok(v.batiments!.every(b => b.forme.startsWith('maison') && b.niveaux <= 2), 'maisons plain-pied ou R+1');
  assert.ok(v.niveaux <= 2 && v.niveaux < ancien.niveaux || ancien.niveaux <= 2);
  assert.ok(v.voies!.length >= 1, 'voie de desserte dessinée');
  assert.equal(v.kpi!.maisons, 25);
  assert.equal(v.programmeAtteint, true);
  assert.ok(v.batiments!.length <= 6, 'bandes, pas 25 bâtiments');
  // Plain-pied impossible (CES 40 % : 25 × 88 m² > 2 000 m²) : dit, avec le chiffre.
  assert.ok(v.alertes.some(a => /Plain-pied impossible/.test(a) && /CES/.test(a)), v.alertes.join(' | '));
  // Hypothèses chiffrées affichées.
  const h = v.hypotheses.join(' ');
  for (const motif of [/voie de desserte de 6 m/, /jardins arrière ≥ 6 m/, /4 m entre pignons/, /6,5 × 8,5 m par maison/, /12 bâtiments au plus/]) assert.match(h, motif);
});

test('parcelle rectangulaire de 5 000 m² (100 × 50) : les 25 maisons tiennent', () => {
  const v = calculerVolumeProgramme(rectangle(100, 50), programme('village sénior de 25 maisons'));
  verifier(v);
  assert.equal(v.kpi!.maisons, 25);
});

test('collectif : pignons à ≥ max(H/2, 6 m) dans une même rangée', () => {
  const v = calculerVolumeProgramme(rectangle(140, 40), programme('90 logements'));
  verifier(v);
  const bats = v.batiments!, angle = bats[0].angleDeg;
  for (let i = 0; i < bats.length; i++) for (let j = i + 1; j < bats.length; j++) {
    const a = boite(bats[i].coins, angle), b = boite(bats[j].coins, angle);
    if (Math.max(a.v0 - b.v1, b.v0 - a.v1) < 0) assert.ok(Math.max(a.u0 - b.u1, b.u0 - a.u1) >= Math.max(bats[i].hauteurM / 2, 6) - 0.01);
  }
});

test('maisons seniors qui tiennent de plain-pied : plain-pied retenu', () => {
  const v = calculerVolumeProgramme(rectangle(120, 70), programme('village sénior de 12 maisons'));
  verifier(v);
  assert.equal(v.kpi!.maisons, 12);
  assert.ok(v.batiments!.every(b => b.niveaux === 1 && b.profondeurM === HYPOTHESES_PROGRAMME.maisonPlainPied.profondeurM));
  assert.equal(v.programmeAtteint, true);
});

test('typologie : individuelles (≤ 3), jumelées (4 à 12), bandes (> 12), forme demandée respectée', () => {
  const ind = calculerVolumeProgramme(rectangle(90, 60), programme('3 maisons'));
  verifier(ind); assert.ok(ind.batiments!.every(b => b.forme === 'maison-individuelle'));
  const jum = calculerVolumeProgramme(rectangle(120, 70), programme('8 maisons'));
  verifier(jum); assert.ok(jum.batiments!.every(b => b.forme === 'maisons-jumelees')); assert.equal(jum.batiments!.length, 4);
  const bande = calculerVolumeProgramme(rectangle(120, 70), programme('8 maisons en bande'));
  verifier(bande); assert.ok(bande.batiments!.every(b => b.forme === 'maisons-en-bande' || b.unites <= 2)); assert.ok(bande.batiments!.length <= 3);
});

test('limite Studio : 30 maisons individuelles demandées → regroupées (≤ 12 bâtiments), et c’est expliqué', () => {
  const v = calculerVolumeProgramme(rectangle(180, 90), programme('30 maisons individuelles'));
  verifier(v);
  assert.ok(v.batiments!.length <= 12);
  assert.ok(v.alertes.some(a => /Studio accepte 12 bâtiments au plus/.test(a)), v.alertes.join(' | '));
});

test('Nanterre — 40 logements sociaux : un ou plusieurs plots / barres, programme atteint, R+2 au moins', () => {
  const v = calculerVolumeProgramme(rectangle(70, 56), programme('immeuble social de 40 logements'));
  verifier(v);
  assert.equal(v.kpi!.logements, 40);
  assert.ok(v.sdpM2 >= 2800);
  assert.ok(v.batiments!.every(b => b.forme === 'barre' || b.forme === 'plot'));
  assert.ok(v.batiments!.every(b => b.largeurM <= HYPOTHESES_PROGRAMME.longueurBarreMaxM && b.niveaux >= 3));
  assert.equal(v.programmeAtteint, true);
});

test('collectif : façades à ≥ max(H, 8 m) entre rangées', () => {
  const v = calculerVolumeProgramme(rectangle(60, 90), programme('60 logements'));
  verifier(v);
  const bats = v.batiments!, angle = bats[0].angleDeg;
  for (let i = 0; i < bats.length; i++) for (let j = i + 1; j < bats.length; j++) {
    const a = boite(bats[i].coins, angle), b = boite(bats[j].coins, angle);
    const vEcart = Math.max(a.v0 - b.v1, b.v0 - a.v1);
    if (vEcart > 0) assert.ok(vEcart >= Math.max(bats[i].hauteurM, 8) - 0.01, `vis-à-vis ${vEcart}`);
  }
});

test('résidence de 80 lits : barres de 14 m, 55 m² par lit', () => {
  const v = calculerVolumeProgramme(rectangle(60, 50), programme('résidence seniors de 80 lits'));
  verifier(v);
  assert.equal(v.kpi!.lits, 80);
  assert.ok(v.batiments!.every(b => b.forme === 'residence' && b.profondeurM === 14));
  assert.ok(v.sdpM2 >= 80 * 55);
});

test('programme mixte : collectif + maisons sur la même parcelle, sans chevauchement', () => {
  const v = calculerVolumeProgramme(rectangle(120, 60), programme('15 maisons et un petit collectif de 20 logements'));
  verifier(v);
  assert.equal(v.kpi!.maisons, 15); assert.equal(v.kpi!.logements, 20);
  assert.ok(v.batiments!.some(b => b.forme.startsWith('maison')) && v.batiments!.some(b => b.forme === 'barre' || b.forme === 'plot'));
});

test('PLU : 1 niveau max → maisons plain-pied ; CES 20 % respecté ; recul H/k appliqué', () => {
  const v = calculerVolumeProgramme(rectangle(140, 80), programme('20 maisons'), regles([{ cle: 'niveaux_max', valeur: 1 }, { cle: 'emprise_max_ratio', valeur: 0.2 }]));
  verifier(v, 0.2);
  assert.ok(v.batiments!.every(b => b.niveaux === 1));
  const f = calculerVolumeProgramme(rectangle(80, 80), programme('40 logements'), regles([{ cle: 'recul_limites_formule', valeur: 2, minimumM: 4 }]));
  verifier(f);
  assert.ok(f.reculM >= f.hauteurM / 2 - 0.01, `${f.reculM} / ${f.hauteurM}`);
});

test('programme trop grand : maximum proposé et alerte « non atteint »', () => {
  const v = calculerVolumeProgramme(rectangle(60, 40), programme('25 maisons'));
  verifier(v);
  assert.ok(v.kpi!.maisons < 25);
  assert.equal(v.programmeAtteint, false);
  assert.ok(v.alertes.some(a => /non atteint/.test(a)));
});

test('parcelle en L : bâtiments hors de l’angle rentrant ; déterminisme', () => {
  const enL = polygone([[0, 0], [110, 0], [110, 40], [45, 40], [45, 100], [0, 100]]);
  const a = calculerVolumeProgramme(enL, programme('16 maisons'));
  const b = calculerVolumeProgramme(enL, programme('16 maisons'));
  assert.deepEqual(a, b);
  verifier(a);
  // Aucun coin dans la partie retirée du L.
  for (const bt of a.batiments!) for (const c of bt.coins) assert.ok(dansAnneau(a.contour, c.x, c.y));
});

test('sans programme détaillé : volume unique historique, inchangé', () => {
  const p: ProgrammeVolume = { logements: null, libelle: null, origine: null };
  assert.deepEqual(calculerVolumeProgramme(rectangle(70, 56), p), calculerVolumeParcelle(rectangle(70, 56), p));
  const ancien: ProgrammeVolume = { logements: 40, libelle: '40 logements', origine: 'fiche' };
  assert.deepEqual(calculerVolumeProgramme(rectangle(70, 56), ancien), calculerVolumeParcelle(rectangle(70, 56), ancien));
});

test('parcelle trop petite : aucun bâtiment, alerte, pas d’exception', () => {
  const v = calculerVolumeProgramme(rectangle(14, 12), programme('10 maisons'));
  assert.ok(!v.batiments || v.batiments.length === 0);
  assert.ok(v.alertes.length > 0);
});

test('contraintes PLU : sélection la plus contraignante', () => {
  const c = contraintesPlu(regles([{ cle: 'hauteur_max_m', valeur: 10 }, { cle: 'hauteur_faitage_m', valeur: 7 }, { cle: 'emprise_max_ratio', valeur: 0.5 }, { cle: 'pleine_terre_min_ratio', valeur: 0.6 }]));
  assert.equal(c.niveauxMax, 2);
  assert.ok(Math.abs(c.ratioEmprise - 0.4) < 1e-9);
});
