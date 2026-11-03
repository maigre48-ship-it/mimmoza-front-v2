import assert from 'node:assert/strict';
import test from 'node:test';
import { calculerVolumeParcelle, ficheStudioDepuisVolume, HYPOTHESES_VOLUME, orientationParcelle, projeterParcelle, type GeometrieParcelle, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume } from './volumeParcelle.ts';
import { diagnostiquerPreparation3D } from './preparation3D.ts';
import { jarvisMassing, studioCommand } from './jarvisDraft.ts';

const LAT = 48.87, LON = 2.18;
const KX = 111_320 * Math.cos(LAT * Math.PI / 180);
/** Polygone WGS84 depuis des points en mètres (x est, y nord), avec rotation éventuelle. */
function polygone(points: [number, number][], rotationDeg = 0): GeometrieParcelle {
  const a = rotationDeg * Math.PI / 180;
  const ring = points.map(([x, y]) => {
    const xr = x * Math.cos(a) - y * Math.sin(a), yr = x * Math.sin(a) + y * Math.cos(a);
    return [LON + xr / KX, LAT + yr / 111_320];
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
const rectangle = (l: number, h: number, rot = 0) => polygone([[0, 0], [l, 0], [l, h], [0, h]], rot);
const SANS: ProgrammeVolume = { logements: null, libelle: null, origine: null };
const LOGTS = (n: number): ProgrammeVolume => ({ logements: n, libelle: `${n} logements`, origine: 'conversation' });

/** Tous les coins du volume dans la parcelle, à ≥ recul des limites. */
function verifierDansParcelle(v: ReturnType<typeof calculerVolumeParcelle>) {
  assert.ok(v.emprise);
  const r = v.contour;
  const inside = (x: number, y: number) => { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) d = !d; } return d; };
  for (const c of v.emprise.coins) {
    assert.ok(inside(c.x, c.y), 'coin hors parcelle');
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)));
      assert.ok(Math.hypot(c.x - a.x - t * dx, c.y - a.y - t * dy) >= v.reculM - 0.05, 'coin trop près d’une limite');
    }
  }
}

test('parcelle rectangulaire sans programme : volume indicatif R+3, surface mesurée, mention « règlement PLU non lu »', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), SANS);
  assert.equal(v.statut, 'indicatif');
  assert.ok(Math.abs(v.surfaceParcelleM2 - 3920) < 5, String(v.surfaceParcelleM2));
  assert.equal(v.niveaux, HYPOTHESES_VOLUME.niveauxIndicatifs);
  assert.equal(v.hauteurM, 12);
  assert.equal(v.mentionPlu, 'Hypothèse — règlement PLU non lu');
  // Épaisseur 16 m, longueur = parcelle moins 2 × 4 m de recul.
  assert.equal(v.emprise!.profondeurM, 16);
  assert.ok(v.emprise!.largeurM >= 61 && v.emprise!.largeurM <= 62, String(v.emprise!.largeurM));
  assert.equal(v.sdpM2, Math.round(v.emprise!.largeurM * 16) * 4);
  assert.ok(v.emprise!.surfaceM2 <= 0.4 * v.surfaceParcelleM2);
  assert.match(v.hypotheses.join(' '), /Programme inconnu/);
  verifierDansParcelle(v);
});

test('le calcul est déterministe et suit l’orientation de la parcelle', () => {
  const a = calculerVolumeParcelle(rectangle(70, 40, 30), LOGTS(20));
  const b = calculerVolumeParcelle(rectangle(70, 40, 30), LOGTS(20));
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.emprise!.angleDeg - 30) < 0.5, String(a.emprise!.angleDeg));
  const p = projeterParcelle(rectangle(70, 40, 120))!;
  assert.ok(Math.abs(orientationParcelle(p.anneaux[0]) * 180 / Math.PI - 120) < 0.5);
  verifierDansParcelle(a);
});

test('programme de 40 logements : SDP visée 2 800 m², niveaux = ⌈SDP / emprise possible⌉, emprise réduite au besoin', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), LOGTS(40));
  assert.equal(v.statut, 'calcule');
  assert.equal(v.sdpViseeM2, 2800);
  // Emprise possible ≈ 61,5 × 16 = 984 m² → 3 niveaux (R+2).
  assert.equal(v.niveaux, 3);
  assert.equal(v.hauteurM, 9);
  assert.ok(v.programmeAtteint);
  assert.ok(v.sdpM2 >= 2800 && v.sdpM2 < 2800 + 3 * 16 * 0.5 + 1, String(v.sdpM2));
  assert.ok(v.logementsEstimes! >= 40);
  verifierDansParcelle(v);
});

test('polygone irrégulier (en L) : le volume reste dans la parcelle, loin de l’angle rentrant', () => {
  const enL = polygone([[0, 0], [80, 0], [80, 25], [30, 25], [30, 70], [0, 70]]);
  const v = calculerVolumeParcelle(enL, LOGTS(24));
  assert.equal(v.statut, 'calcule');
  assert.ok(Math.abs(v.surfaceParcelleM2 - (80 * 25 + 30 * 45)) < 5);
  verifierDansParcelle(v);
  // Aucun sommet de la parcelle dans le rectangle (l’angle rentrant 30,25 notamment).
  const xs = v.emprise!.coins.map(c => c.x), ys = v.emprise!.coins.map(c => c.y);
  const p = projeterParcelle(enL)!.anneaux[0];
  const angleRentrant = p[3];
  assert.ok(!(angleRentrant.x > Math.min(...xs) && angleRentrant.x < Math.max(...xs) && angleRentrant.y > Math.min(...ys) && angleRentrant.y < Math.max(...ys)));
});

const regle = (cle: ReglePlu['cle'], valeur: number, extra: Partial<ReglePlu> = {}): ReglePlu => ({ cle, valeur, source: 'Règlement PLU test', reference: 'art. UB 10, p. 42', statut: 'lue', ...extra });
const avec = (...regles: ReglePlu[]): ReglesPluVolume => ({ source: 'plu-chiffre', regles, nonAppliquees: [] });

test('hauteur PLU qui borne : niveaux plafonnés, programme non atteint signalé, règles listées avec source', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), LOGTS(80), avec(regle('hauteur_max_m', 10), regle('emprise_max_ratio', 0.5), regle('recul_voie_m', 5), regle('recul_limites_m', 3)));
  assert.equal(v.niveaux, 3);
  assert.equal(v.hauteurM, 9);
  assert.equal(v.reculM, 5);
  assert.equal(v.programmeAtteint, false);
  assert.match(v.alertes.join(' '), /Hauteur bornée par le PLU \(10 m, soit 3 niveaux\) : programme non atteint/);
  assert.equal(v.mentionPlu, 'Règles PLU appliquées — conformité à vérifier par un professionnel');
  assert.doesNotMatch(v.mentionPlu + v.reglesAppliquees.join(' '), /\bconforme\b/);
  assert.ok(v.reglesAppliquees.some(l => /Hauteur maximale : 10 m .*Règlement PLU test, art\. UB 10, p\. 42 ; lue dans le règlement/.test(l)), v.reglesAppliquees.join('\n'));
  assert.equal(v.reglesAppliquees.length, 4);
  verifierDansParcelle(v);
});

test('égout et faîtage : la hauteur la plus basse est retenue et dite ; niveaux max PLU', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), LOGTS(80), avec(regle('hauteur_max_m', 15), regle('hauteur_faitage_m', 12.5)));
  assert.equal(v.niveaux, 4);
  assert.match(v.reglesAppliquees.join(' '), /hauteur retenue 12,5 m \(la plus basse entre égout 15 m et faîtage 12,5 m\)/);
  const n = calculerVolumeParcelle(rectangle(70, 56), LOGTS(80), avec(regle('niveaux_max', 3)));
  assert.equal(n.niveaux, 3);
  assert.match(n.alertes.join(' '), /Niveaux bornés par le PLU \(3\)/);
});

test('coefficient d’emprise PLU qui borne l’emprise ; ratio hors bornes ignoré', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), SANS, avec(regle('emprise_max_ratio', 0.2)));
  assert.ok(v.emprise!.surfaceM2 <= 0.2 * v.surfaceParcelleM2 + 1, String(v.emprise!.surfaceM2));
  const ambigu = calculerVolumeParcelle(rectangle(70, 56), SANS, avec(regle('emprise_max_ratio', 40)));
  assert.equal(ambigu.cesRetenu, 0.4);
  assert.equal(ambigu.reglesAppliquees.length, 0);
});

test('pleine terre : emprise ≤ (1 − part de pleine terre) × parcelle', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), LOGTS(200), avec(regle('pleine_terre_min_ratio', 0.8), regle('emprise_max_ratio', 0.5)));
  assert.ok(v.emprise!.surfaceM2 <= 0.2 * v.surfaceParcelleM2 + 1, String(v.emprise!.surfaceM2));
  assert.match(v.reglesAppliquees.join(' '), /Pleine terre .*80 % — emprise plafonnée à 20 %/);
});

test('recul H/2 avec minimum : itération niveaux ↔ recul', () => {
  // H/2 min 4 m : R+1 (6 m) → recul 4 m ; R+4 (15 m) → 7,5 m.
  const v = calculerVolumeParcelle(rectangle(70, 56), LOGTS(60), avec(regle('recul_limites_formule', 2, { minimumM: 4 })));
  const hauteur = v.niveaux * 3;
  assert.equal(v.reculM, Math.max(4, hauteur / 2));
  assert.ok(v.programmeAtteint, String(v.sdpM2));
  assert.match(v.reglesAppliquees.join(' '), new RegExp(`H/2, min\\. 4 m — recul recalculé pour H = ${hauteur} m`));
  verifierDansParcelle(v);
  // Parcelle étroite : plus on monte, plus le recul mange l'emprise → programme non atteint.
  const etroite = calculerVolumeParcelle(rectangle(80, 30), LOGTS(80), avec(regle('recul_limites_formule', 2, { minimumM: 3 })));
  assert.ok(etroite.emprise);
  assert.ok(etroite.reculM >= etroite.niveaux * 3 / 2 - 1e-9);
  assert.equal(etroite.programmeAtteint, false);
  verifierDansParcelle(etroite);
});

test('parcelle trop petite ou trop étroite : aucun volume, explication', () => {
  const petite = calculerVolumeParcelle(rectangle(12, 10), LOGTS(2));
  assert.equal(petite.statut, 'trop-petite');
  assert.equal(petite.emprise, null);
  assert.match(petite.alertes[0], /trop petite/);
  assert.equal(calculerVolumeParcelle(rectangle(200, 13), SANS).statut, 'trop-petite');
  assert.equal(calculerVolumeParcelle(rectangle(40, 40), SANS, avec(regle('hauteur_max_m', 2))).statut, 'hauteur-insuffisante');
  assert.equal(calculerVolumeParcelle(null, SANS).statut, 'contour-invalide');
});

test('MultiPolygon : la plus grande partie porte le volume', () => {
  const grande = rectangle(60, 40).coordinates as number[][][];
  const petite = polygone([[200, 200], [205, 200], [205, 205], [200, 205]]).coordinates as number[][][];
  const v = calculerVolumeParcelle({ type: 'MultiPolygon', coordinates: [petite, grande] }, SANS);
  assert.ok(Math.abs(v.surfaceParcelleM2 - 2400) < 5);
});

test('la fiche Studio tirée du volume passe le diagnostic 3D et garde l’hypothèse', () => {
  const v = calculerVolumeParcelle(rectangle(70, 56), LOGTS(40));
  const fiche = ficheStudioDepuisVolume(v, { adresse: '12 rue X, Rueil-Malmaison', reference: '92050000AN0412', programme: { logements: 40, libelle: '40 logements sociaux', origine: 'conversation' } })!;
  assert.match(fiche.objectif!, /R\+2/);
  assert.equal(fiche.programme, '40 logements sociaux');
  assert.match(fiche.contraintes!, /Hypothèse — règlement PLU non lu/);
  const diagnostic = diagnostiquerPreparation3D(fiche);
  assert.equal(diagnostic.pret, true, diagnostic.questions.join(' '));
  const massing = jarvisMassing(fiche)!;
  assert.equal(massing.niveaux, 3);
  assert.equal(massing.largeurM, v.emprise!.largeurM);
  assert.equal(massing.profondeurM, v.emprise!.profondeurM);
  assert.ok(studioCommand(fiche));
  assert.equal(ficheStudioDepuisVolume(calculerVolumeParcelle(rectangle(10, 10), SANS), {}), null);
});

test('fiche Studio avec dimensions décimales (virgule) : toujours exploitable', () => {
  const v = calculerVolumeParcelle(rectangle(47.3, 33.1, 12), SANS);
  const fiche = ficheStudioDepuisVolume(v, {})!;
  assert.equal(diagnostiquerPreparation3D(fiche).pret, true, diagnostiquerPreparation3D(fiche).questions.join(' '));
  assert.equal(jarvisMassing(fiche)!.largeurM, v.emprise!.largeurM);
});
