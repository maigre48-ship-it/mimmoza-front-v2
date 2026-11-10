// node --test src/spaces/copilot/studio3d/volumeParcelleBande.test.ts
// Lot C7b : volume d'étude dans la bande principale d'un PLU « par bande ».
// Fixtures : géométries RÉELLES du cadastre (parcelle 93048000AS0249, 98 rue de Paris, Montreuil, lot C7a) et
// résultats du moteur AVANT le lot (volume-parcelle-reference-c7b.json) pour la non-régression.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculerVolumeParcelle, dansPolygone, type BandeVoie, type GeometrieParcelle, type PointLocal, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume, type VolumePropose } from './volumeParcelle.ts';
import { directionVoie, preparerBande, rectangleDansBande } from './bandePrincipale.ts';
import { distanceALaVoie, distancePointSegment, empriseMaxParBande, identifierCoteVoie, mesurerBandes, type CoteVoie } from './coteVoie.ts';
import { lireRegles, reglesVolume } from './controlesVolume.ts';

const lire = (nom: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${nom}`, import.meta.url), 'utf8'));
const cadastre = lire('cadastre-93048000AS0249.json');
const PARCELLE: GeometrieParcelle = cadastre.parcelle.geometry;
const VOISINES: GeometrieParcelle[] = cadastre.voisines.map((v: { geometry: GeometrieParcelle }) => v.geometry);
const COTE = identifierCoteVoie(PARCELLE, VOISINES);
const BANDES = mesurerBandes(COTE, 18)!;
const SANS: ProgrammeVolume = { logements: null, libelle: null, origine: null };
const LOGTS = (n: number): ProgrammeVolume => ({ logements: n, libelle: `${n} logements`, origine: 'conversation' });
const regle = (cle: ReglePlu['cle'], valeur: number, extra: Partial<ReglePlu> = {}): ReglePlu => ({ cle, valeur, source: 'Règlement PLU', reference: 'art. 10', statut: 'lue', ...extra });
const avec = (...regles: ReglePlu[]): ReglesPluVolume => ({ source: 'plu-chiffre', regles, nonAppliquees: [] });
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

/**
 * Vérification GÉOMÉTRIQUE indépendante du moteur : chaque sommet de l'emprise, puis chaque point d'une grille
 * de 0,25 m sur l'emprise, est dans la parcelle, à ≥ recul des limites, et à ≤ profondeur du côté voie.
 */
function verifierDansParcelleEtBande(v: VolumePropose, cote: CoteVoie, profondeurM: number) {
  assert.ok(v.emprise, 'aucune emprise');
  const [c0, c1, , c3] = v.emprise.coins;
  const points: PointLocal[] = [...v.emprise.coins];
  const nu = Math.ceil(v.emprise.largeurM / 0.25), nv = Math.ceil(v.emprise.profondeurM / 0.25);
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    points.push({ x: c0.x + (c1.x - c0.x) * i / nu + (c3.x - c0.x) * j / nv, y: c0.y + (c1.y - c0.y) * i / nu + (c3.y - c0.y) * j / nv });
  }
  const contour = cote.anneaux[0];
  let distanceMax = 0;
  for (const p of points) {
    // Un sommet est sur le bord de l'emprise : on teste un point rentré d'un millimètre vers le centre.
    const q = { x: p.x + (v.emprise.centre.x - p.x) * 1e-4, y: p.y + (v.emprise.centre.y - p.y) * 1e-4 };
    assert.ok(dansPolygone(cote.anneaux, q.x, q.y), `point hors parcelle : ${JSON.stringify(p)}`);
    for (let i = 0; i < contour.length; i++) {
      assert.ok(distancePointSegment(p, contour[i], contour[(i + 1) % contour.length]) >= v.reculM - 0.01, `point à moins de ${v.reculM} m d’une limite : ${JSON.stringify(p)}`);
    }
    const d = distanceALaVoie(p, cote);
    assert.ok(d <= profondeurM + 1e-6, `point hors bande (${d.toFixed(3)} m de la voie) : ${JSON.stringify(p)}`);
    distanceMax = Math.max(distanceMax, d);
  }
  return distanceMax;
}

/** Écart d'angle entre deux directions (axes), en degrés. */
const ecartAxes = (a: number, b: number) => { const e = Math.abs(a - b) % 180; return Math.min(e, 180 - e); };
const angleSegment = (a: PointLocal, b: PointLocal) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

// ─────────────────────────────── Non-régression : sans le paramètre ───────────────────────────────

test('sans bande : résultats strictement identiques à ceux du moteur avant le lot (22 cas relevés, dont la parcelle réelle)', () => {
  const ref = lire('volume-parcelle-reference-c7b.json');
  assert.equal(ref.cas.length, 22);
  for (const c of ref.cas) {
    const v = c.regles ? calculerVolumeParcelle(c.geometrie, c.programme, c.regles) : calculerVolumeParcelle(c.geometrie, c.programme);
    assert.deepEqual(json(v), c.attendu, c.nom);
    assert.equal('bande' in v, false, c.nom);
    // `undefined` et `null` valent « pas de bande ».
    assert.deepEqual(calculerVolumeParcelle(c.geometrie, c.programme, c.regles ?? undefined, undefined), v, c.nom);
    assert.deepEqual(calculerVolumeParcelle(c.geometrie, c.programme, c.regles ?? undefined, null), v, c.nom);
  }
});

// ─────────────────────────────── Parcelle réelle : bande de 18 m ───────────────────────────────

test('cas réel : la fixture est bien celle du lot C7a (816 m², façade sud 28,65 m, bande principale 461 m²)', () => {
  assert.equal(COTE.statut, 'identifie');
  assert.ok(Math.abs(COTE.longueurFacadeM - 28.65) < 0.05);
  assert.deepEqual(BANDES, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
});

test('cas réel, valeurs par défaut : l’emprise est dans la parcelle ET dans la bande de 18 m, parallèle à la rue', () => {
  const sans = calculerVolumeParcelle(PARCELLE, SANS);
  const v = calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 18 });
  assert.equal(v.statut, 'indicatif');
  assert.equal(v.bande?.statut, 'appliquee');
  assert.equal(v.bande?.raison, null);
  const distanceMax = verifierDansParcelleEtBande(v, COTE, 18);
  // Valeurs relevées : 14 m le long de la rue × 13,5 m de profondeur = 189 m², à 4 m de la rue (recul par défaut).
  assert.equal(v.emprise!.largeurM, 14);
  assert.equal(v.emprise!.profondeurM, 13.5);
  assert.equal(v.emprise!.surfaceM2, 189);
  assert.equal(v.reculM, 4);
  assert.ok(Math.abs(distanceMax - 17.51) < 0.01, String(distanceMax));
  assert.equal(v.bande?.distanceMaxVoieM, 17.51);
  assert.equal(v.bande?.profondeurM, 18);
  assert.equal(v.bande?.longueurFacadeM, 28.65);
  // Parallèle à la voie : le côté « largeur » suit chacun des deux segments de façade à moins de 1°.
  const [c0, c1] = v.emprise!.coins;
  for (const f of COTE.facades) assert.ok(ecartAxes(angleSegment(c0, c1), angleSegment(f.a, f.b)) < 1, JSON.stringify(f));
  assert.ok(ecartAxes(v.emprise!.angleDeg, angleSegment(COTE.facades[1].b, COTE.facades[0].a)) < 0.1);
  assert.equal(v.bande?.angleVoieDeg, v.emprise!.angleDeg);
  assert.equal(v.emprise!.angleDeg, 15.1);
  // Sans bande, le moteur suit le grand côté de la parcelle (104,8°) et sort de la bande (21,6 m de la rue).
  assert.equal(sans.emprise!.angleDeg, 104.8);
  assert.ok(Math.max(...sans.emprise!.coins.map((p) => distanceALaVoie(p, COTE))) > 21);
  // L'emprise ne dépasse ni la surface de la bande, ni le maximum de l'indice J (80 % de 461 m² = 368 m²).
  assert.ok(v.emprise!.surfaceM2 <= BANDES.bandePrincipaleM2);
  assert.ok(v.emprise!.surfaceM2 <= empriseMaxParBande(BANDES, 80, 20)!.principaleM2);
  const textes = v.hypotheses.join(' | ');
  assert.match(textes, /implanté dans la bande principale \(18 m depuis le côté voie présumé\), parallèlement à la voie/);
  assert.match(textes, /Recul de 4 m sur toutes les limites, côté voie compris \(valeur par défaut\)/);
  assert.match(textes, /Bande secondaire \(au-delà de 18 m depuis la voie\) : non construite/);
  assert.doesNotMatch(textes, /grand côté de la parcelle/);
  // Déterministe.
  assert.deepEqual(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 18 }), v);
});

const REGLES_C7A = lireRegles([
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: 'Règlement GPU', article: 'indice b2, p. 263', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }] },
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: 'Règlement GPU', article: 'indice J, p. 237', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }] },
]);

test('cas réel, règles du lot C7a (19,5 m, 80 % de la bande) et 40 logements : 6 niveaux dans la bande, emprise ≤ 368 m²', () => {
  const regles = reglesVolume(REGLES_C7A, null, BANDES);
  const max = empriseMaxParBande(BANDES, 80, 20)!.principaleM2;
  assert.equal(max, 368);
  const v = calculerVolumeParcelle(PARCELLE, LOGTS(40), regles, { cote: COTE, profondeurM: 18, empriseMaxM2: max });
  assert.equal(v.bande?.statut, 'appliquee');
  assert.equal(v.bande?.empriseMaxM2, 368);
  verifierDansParcelleEtBande(v, COTE, 18);
  assert.equal(v.niveaux, 6);                       // 19,5 m / 3 m
  assert.equal(v.hauteurM, 18);
  assert.equal(v.emprise!.surfaceM2, 189);          // reculs non lus : 4 m par défaut, d'où 14 × 13,5 m
  assert.equal(v.sdpM2, 1134);
  assert.equal(v.programmeAtteint, false);          // 40 × 70 = 2 800 m² visés
  assert.ok(v.emprise!.surfaceM2 <= max);
  assert.match(v.alertes.join(' | '), /Hauteur bornée par le PLU \(19,5 m, soit 6 niveaux\) : programme non atteint/);
  assert.match(v.hypotheses.join(' | '), /Emprise au sol bornée à 368 m² : maximum de la bande principale/);
});

test('cas réel, recul de 1 m (règle d’essai, non lue à Montreuil) : l’emprise remplit la bande et reste sous le maximum par bande', () => {
  const regles = avec(regle('recul_limites_m', 1), regle('emprise_max_ratio', 1), regle('epaisseur_max_m', 20));
  const libre = calculerVolumeParcelle(PARCELLE, SANS, regles, { cote: COTE, profondeurM: 18 });
  verifierDansParcelleEtBande(libre, COTE, 18);
  assert.ok(libre.emprise!.profondeurM <= 17);      // 18 m de bande − 1 m de recul sur la rue
  // Relevé : 20,5 × 16,5 m = 338 m². Un rectangle parallèle à la rue ne peut pas atteindre les 368 m² de l'indice J
  // sur cette parcelle (limite ouest en biais) : le maximum par bande est respecté même sans le fournir.
  assert.equal(libre.emprise!.largeurM, 20.5);
  assert.equal(libre.emprise!.profondeurM, 16.5);
  assert.equal(libre.emprise!.surfaceM2, 338);
  assert.ok(libre.emprise!.surfaceM2 <= empriseMaxParBande(BANDES, 80, 20)!.principaleM2);
  assert.ok(libre.emprise!.surfaceM2 <= BANDES.bandePrincipaleM2);
  const m368 = calculerVolumeParcelle(PARCELLE, SANS, regles, { cote: COTE, profondeurM: 18, empriseMaxM2: 368 });
  assert.deepEqual(m368.emprise, libre.emprise);
  // Un maximum plus bas (250 m², valeur d'essai) est appliqué : l'emprise est réduite, toujours dans la bande.
  const plafonne = calculerVolumeParcelle(PARCELLE, SANS, regles, { cote: COTE, profondeurM: 18, empriseMaxM2: 250 });
  verifierDansParcelleEtBande(plafonne, COTE, 18);
  assert.ok(plafonne.emprise!.largeurM * plafonne.emprise!.profondeurM <= 250 + 1e-6);
  assert.ok(plafonne.emprise!.surfaceM2 >= 240, String(plafonne.emprise!.surfaceM2));
  assert.equal(plafonne.emprise!.angleDeg, 15.1);
  assert.match(plafonne.hypotheses.join(' | '), /Emprise au sol bornée à 250 m² : maximum de la bande principale/);
  // Le coefficient d'emprise des règles reste appliqué en plus (le plus bas des deux plafonds gagne).
  const ces = calculerVolumeParcelle(PARCELLE, SANS, avec(regle('recul_limites_m', 1), regle('emprise_max_ratio', 0.2)), { cote: COTE, profondeurM: 18, empriseMaxM2: 368 });
  verifierDansParcelleEtBande(ces, COTE, 18);
  assert.ok(ces.emprise!.largeurM * ces.emprise!.profondeurM <= 0.2 * 816.2);
  assert.ok(ces.emprise!.surfaceM2 >= 150, String(ces.emprise!.surfaceM2));
});

test('cas réel, recul H/2 (min. 3 m) : le recul suit la hauteur, l’emprise reste dans la bande', () => {
  const v = calculerVolumeParcelle(PARCELLE, LOGTS(12), avec(regle('recul_limites_formule', 2, { minimumM: 3 }), regle('hauteur_max_m', 19.5)), { cote: COTE, profondeurM: 18 });
  assert.equal(v.bande?.statut, 'appliquee');
  verifierDansParcelleEtBande(v, COTE, 18);
  assert.equal(v.reculM, Math.max(3, v.hauteurM / 2));
  assert.match(v.hypotheses[0], /côté voie compris : le plus fort des reculs PLU pour cette hauteur/);
});

test('cas réel, autres profondeurs de bande (12 m, 15 m, 25 m, 100 m) : toujours dans la bande', () => {
  for (const profondeurM of [12, 15, 25, 100]) {
    const v = calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM });
    assert.equal(v.bande?.statut, 'appliquee', String(profondeurM));
    verifierDansParcelleEtBande(v, COTE, profondeurM);
    assert.equal(v.emprise!.angleDeg, 15.1);
    assert.ok(v.emprise!.profondeurM <= profondeurM - v.reculM + 1e-9, String(profondeurM));
  }
});

// ─────────────────────────────── Bande inutilisable : comportement actuel + raison ───────────────────────────────

/** Le résultat est celui du calcul sans bande, plus une alerte et le champ `bande` (statut « non-appliquee »). */
function verifierRepli(avecBande: VolumePropose, sansBande: VolumePropose, motif: RegExp) {
  assert.equal(avecBande.bande?.statut, 'non-appliquee');
  assert.match(avecBande.bande!.raison!, /^Bande principale non appliquée : /);
  assert.match(avecBande.bande!.raison!, motif);
  assert.equal(avecBande.bande!.distanceMaxVoieM, null);
  assert.equal(avecBande.bande!.angleVoieDeg, null);
  assert.deepEqual(avecBande.alertes, [...sansBande.alertes, avecBande.bande!.raison]);
  const { bande: _b, alertes: _a, ...reste } = avecBande;
  const { alertes: _a2, ...attendu } = sansBande;
  assert.deepEqual(reste, attendu);
}

test('côté voie non identifié (voisines absentes, parcelle enclavée, contour illisible) : calcul habituel, raison écrite', () => {
  const sans = calculerVolumeParcelle(PARCELLE, LOGTS(40));
  const v = calculerVolumeParcelle(PARCELLE, LOGTS(40), undefined, { cote: identifierCoteVoie(PARCELLE, []), profondeurM: 18 });
  verifierRepli(v, sans, /côté voie non identifié \(Parcelles voisines non fournies : le côté voie ne peut pas être déduit du cadastre\)\. Volume placé sans tenir compte de la bande\.$/);
  assert.equal(v.bande!.profondeurM, 18);
  const enclavee: CoteVoie = { ...COTE, statut: 'aucune_facade', facades: [], longueurFacadeM: 0, note: 'Aucune limite libre de voisine.' };
  verifierRepli(calculerVolumeParcelle(PARCELLE, LOGTS(40), undefined, { cote: enclavee, profondeurM: 18 }), sans, /côté voie non identifié \(Aucune limite libre de voisine\)/);
  // Contour illisible : aucun volume, aucune exception.
  const rien = calculerVolumeParcelle(null, SANS, undefined, { cote: identifierCoteVoie(null, VOISINES), profondeurM: 18 });
  assert.equal(rien.statut, 'contour-invalide');
  verifierRepli(rien, calculerVolumeParcelle(null, SANS), /contour cadastral illisible\.$/);
});

test('bande plus petite que le minimum constructible : calcul habituel, raison écrite', () => {
  const sans = calculerVolumeParcelle(PARCELLE, SANS);
  // 5 m de bande : moins que le côté minimal de 6 m.
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 5 }), sans, /bande principale de 5 m, moins profonde que le côté minimal constructible de 6 m/);
  // 9 m de bande − 4 m de recul = 5 m : aucun rectangle de 6 × 6 m.
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 9 }), sans, /aucun rectangle de 6 × 6 m ne tient à la fois à 4 m des limites et à moins de 9 m du côté voie/);
  // 10 m de bande − 4 m = 6 m : le minimum tient.
  const juste = calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 10.5 });
  assert.equal(juste.bande?.statut, 'appliquee');
  verifierDansParcelleEtBande(juste, COTE, 10.5);
  assert.equal(juste.emprise!.profondeurM, 6);
  // Emprise maximale de la bande sous 36 m².
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 18, empriseMaxM2: 30 }), sans, /emprise maximale de la bande principale \(30 m²\) inférieure au minimum constructible de 36 m²/);
});

test('paramètres illisibles ou incohérents : jamais d’exception, jamais de valeur supposée', () => {
  const sans = calculerVolumeParcelle(PARCELLE, SANS);
  for (const profondeurM of [Number.NaN, 0, -3, Infinity, undefined as unknown as number, '18' as unknown as number]) {
    const v = calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM });
    verifierRepli(v, sans, /profondeur de la bande principale non fournie/);
    assert.equal(v.bande!.profondeurM, null);
  }
  for (const empriseMaxM2 of [Number.NaN, 0, -10]) {
    verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: COTE, profondeurM: 18, empriseMaxM2 }), sans, /emprise maximale de la bande principale illisible/);
  }
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: undefined as unknown as CoteVoie, profondeurM: 18 }), sans, /côté voie non fourni/);
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, {} as BandeVoie), sans, /côté voie non fourni/);
  // Côté voie d'une AUTRE parcelle (la voisine AS0108) : refusé, pas appliqué à côté.
  const autre = identifierCoteVoie(VOISINES[1], [PARCELLE, ...VOISINES.filter((_, i) => i !== 1)]);
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: autre, profondeurM: 18 }), sans, /autre géométrie que celle de la parcelle/);
  // Même origine, façades déplacées de 2 m : refusé aussi.
  const decale: CoteVoie = { ...COTE, facades: COTE.facades.map((f) => ({ ...f, a: { x: f.a.x, y: f.a.y - 2 }, b: { x: f.b.x, y: f.b.y - 2 } })) };
  verifierRepli(calculerVolumeParcelle(PARCELLE, SANS, undefined, { cote: decale, profondeurM: 18 }), sans, /autre géométrie que celle de la parcelle/);
  // Hauteur PLU inférieure à un étage : aucun volume, avec ou sans bande.
  const bas = avec(regle('hauteur_max_m', 2));
  const h = calculerVolumeParcelle(PARCELLE, SANS, bas, { cote: COTE, profondeurM: 18 });
  assert.equal(h.statut, 'hauteur-insuffisante');
  verifierRepli(h, calculerVolumeParcelle(PARCELLE, SANS, bas), /aucun volume proposé sur cette parcelle\.$/);
});

// ─────────────────────────────── Parcelles d'essai (géométries construites) ───────────────────────────────

const LAT = 48.87, LON = 2.18;
const KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function polygone(points: [number, number][], rotationDeg = 0): GeometrieParcelle {
  const a = rotationDeg * Math.PI / 180;
  const ring = points.map(([x, y]) => {
    const xr = x * Math.cos(a) - y * Math.sin(a), yr = x * Math.sin(a) + y * Math.cos(a);
    return [LON + xr / KX, LAT + yr / 111_320];
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
const pave = (x0: number, y0: number, l: number, h: number, rot = 0) => polygone([[x0, y0], [x0 + l, y0], [x0 + l, y0 + h], [x0, y0 + h]], rot);

test('parcelle en lanière 20 × 60 m, voie sur le petit côté : le bâtiment passe du grand côté à la façade sur voie', () => {
  for (const rot of [0, 30, 90, 137]) {
    const parcelle = pave(0, 0, 20, 60, rot);
    // Voisines à l'ouest, à l'est et au fond ; rien au sud : la voie.
    const cote = identifierCoteVoie(parcelle, [pave(-20, 0, 20, 60, rot), pave(20, 0, 20, 60, rot), pave(0, 60, 20, 30, rot)]);
    assert.equal(cote.statut, 'identifie');
    assert.ok(Math.abs(cote.longueurFacadeM - 20) < 0.05);
    const sans = calculerVolumeParcelle(parcelle, SANS);
    const v = calculerVolumeParcelle(parcelle, SANS, undefined, { cote, profondeurM: 18 });
    assert.equal(v.bande?.statut, 'appliquee');
    verifierDansParcelleEtBande(v, cote, 18);
    assert.ok(ecartAxes(sans.emprise!.angleDeg, rot + 90) < 0.2, `sans bande : ${sans.emprise!.angleDeg}`);
    assert.ok(ecartAxes(v.emprise!.angleDeg, rot) < 0.2, `avec bande : ${v.emprise!.angleDeg}`);
    // 20 m de façade − 2 × 4 m = 12 m ; 18 m de bande − 4 m = 14 m (au pas de 0,5 m du moteur près).
    assert.ok(v.emprise!.largeurM >= 11.5 && v.emprise!.largeurM <= 12, String(v.emprise!.largeurM));
    assert.ok(v.emprise!.profondeurM >= 13.5 && v.emprise!.profondeurM <= 14, String(v.emprise!.profondeurM));
    assert.ok(v.bande!.distanceMaxVoieM! <= 18 && v.bande!.distanceMaxVoieM! >= 17.5, String(v.bande!.distanceMaxVoieM));
    assert.ok(Math.max(...sans.emprise!.coins.map((p) => distanceALaVoie(p, cote))) > 18);
  }
});

test('parcelle d’angle (deux voies) et parcelle traversante : emprise dans la bande, sans exception', () => {
  const parcelle = pave(0, 0, 30, 40);
  // Angle : voies au sud et à l'ouest.
  const angle = identifierCoteVoie(parcelle, [pave(30, 0, 30, 40), pave(0, 40, 30, 30)]);
  assert.equal(angle.facades.length, 2);
  const v = calculerVolumeParcelle(parcelle, SANS, undefined, { cote: angle, profondeurM: 18 });
  assert.equal(v.bande?.statut, 'appliquee');
  verifierDansParcelleEtBande(v, angle, 18);
  assert.ok(ecartAxes(v.emprise!.angleDeg, 90) < 0.2);   // la plus longue des deux voies (40 m, à l'ouest)
  // Traversante : voies au sud et au nord.
  const traversante = identifierCoteVoie(parcelle, [pave(30, 0, 30, 40), pave(-30, 0, 30, 40)]);
  const t = calculerVolumeParcelle(parcelle, SANS, undefined, { cote: traversante, profondeurM: 18 });
  assert.equal(t.bande?.statut, 'appliquee');
  verifierDansParcelleEtBande(t, traversante, 18);
  assert.ok(ecartAxes(t.emprise!.angleDeg, 0) < 0.2);
});

// ─────────────────────────────── Géométrie de la bande (bandePrincipale.ts) ───────────────────────────────

test('directionVoie : moyenne d’axes pondérée par la longueur ; plus longue façade si elles ne s’accordent pas', () => {
  const P = (x: number, y: number) => ({ x, y });
  assert.equal(directionVoie([]), null);
  assert.equal(directionVoie([{ a: P(0, 0), b: P(10, 0) }]), 0);
  assert.equal(directionVoie([{ a: P(10, 0), b: P(0, 0) }]), 0);                       // sens opposé : même axe
  assert.ok(Math.abs(directionVoie([{ a: P(0, 0), b: P(0, 10) }])! - Math.PI / 2) < 1e-12);
  // Deux voies perpendiculaires de même longueur : la première.
  assert.equal(directionVoie([{ a: P(0, 0), b: P(10, 0) }, { a: P(0, 0), b: P(0, 10) }]), 0);
  // Deux segments presque alignés : direction entre les deux, plus près du plus long.
  const d = directionVoie([{ a: P(0, 0), b: P(30, 0) }, { a: P(30, 0), b: P(40, 1) }])! * 180 / Math.PI;
  assert.ok(d > 0 && d < 2.9, String(d));
});

test('rectangleDansBande : sûr même quand les quatre coins sont dans la bande mais pas le milieu', () => {
  const P = (x: number, y: number) => ({ x, y });
  const rect = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  const voie = [{ a: P(0, 0), b: P(30, 0) }];
  assert.equal(rectangleDansBande(rect(2, 1, 28, 18), voie, 18), true);
  assert.equal(rectangleDansBande(rect(2, 1, 28, 18.01), voie, 18), false);
  // Deux bouts de façade éloignés : les coins sont à moins de 10 m d'une façade, le milieu est à 15 m → refus.
  const deuxBouts = [{ a: P(0, 0), b: P(10, 0) }, { a: P(40, 0), b: P(50, 0) }];
  for (const c of rect(5, 1, 45, 8)) assert.ok(Math.min(...deuxBouts.map((f) => distancePointSegment(c, f.a, f.b))) <= 10);
  assert.equal(rectangleDansBande(rect(5, 1, 45, 8), deuxBouts, 10), false);
  // Deux segments bout à bout : couvert tranche par tranche.
  const suite = [{ a: P(0, 0), b: P(15, 0) }, { a: P(15, 0), b: P(30, 0) }];
  assert.equal(rectangleDansBande(rect(2, 1, 28, 18), suite, 18), true);
  assert.equal(rectangleDansBande(rect(2, 1, 28, 18.5), suite, 18), false);
  assert.equal(rectangleDansBande(rect(2, 1, 28, 18), [], 18), false);
});

test('preparerBande : accepte le côté voie de la parcelle, refuse le reste avec une raison', () => {
  const ok = preparerBande({ cote: COTE, profondeurM: 18, empriseMaxM2: 368 }, COTE.origine!, COTE.anneaux[0], 6);
  assert.ok(ok.ok);
  assert.equal(ok.bande.facades.length, 2);
  assert.equal(ok.bande.longueurFacadeM, 28.65);
  assert.equal(ok.bande.empriseMaxM2, 368);
  assert.ok(Math.abs(ok.bande.angle * 180 / Math.PI - 15.1) < 0.05);
  const non = preparerBande({ cote: COTE, profondeurM: 18 }, { lon: COTE.origine!.lon + 1e-5, lat: COTE.origine!.lat }, COTE.anneaux[0], 6);
  assert.deepEqual(non, { ok: false, raison: 'côté voie calculé pour une autre géométrie que celle de la parcelle.' });
  assert.equal(preparerBande(null, COTE.origine!, COTE.anneaux[0], 6).ok, false);
});
