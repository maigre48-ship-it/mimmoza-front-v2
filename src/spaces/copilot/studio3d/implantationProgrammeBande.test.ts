// node --test src/spaces/copilot/studio3d/implantationProgrammeBande.test.ts
// Lot C7c : programme détaillé (plusieurs bâtiments) implanté dans la bande principale d'un PLU « par bande »,
// et contrôles du volume dits selon l'état réel (bande prouvée ou non).
// Fixtures : géométries RÉELLES du cadastre (parcelle 93048000AS0249, 98 rue de Paris, Montreuil, lot C7a) et
// résultats de calculerVolumeProgramme AVANT le lot (implantation-programme-reference-c7c.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculerVolumeProgramme } from './implantationProgramme.ts';
import { dansPolygone, type BandeVoie, type GeometrieParcelle, type PointLocal, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume, type VolumePropose } from './volumeParcelle.ts';
import { verifierBandeVolume } from './bandePrincipale.ts';
import { distanceALaVoie, distancePointSegment, empriseMaxParBande, identifierCoteVoie, mesurerBandes, type CoteVoie } from './coteVoie.ts';
import { controlerVolume, lireRegles, reglesVolume } from './controlesVolume.ts';
import { programmeBatiDepuisTexte } from './programmeBati.ts';

const lire = (nom: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${nom}`, import.meta.url), 'utf8'));
const cadastre = lire('cadastre-93048000AS0249.json');
const PARCELLE: GeometrieParcelle = cadastre.parcelle.geometry;
const VOISINES: GeometrieParcelle[] = cadastre.voisines.map((v: { geometry: GeometrieParcelle }) => v.geometry);
const COTE = identifierCoteVoie(PARCELLE, VOISINES);
const BANDES = mesurerBandes(COTE, 18)!;
const PLAFOND = empriseMaxParBande(BANDES, 80, null)!.principaleM2;
const BANDE: BandeVoie = { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND };
const prog = (texte: string): ProgrammeVolume => ({ ...programmeBatiDepuisTexte(texte)!, origine: 'fiche' });
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

// Règles du PLUi Est Ensemble telles que le lot C6 les enregistre (indices J et b2, mission du 10/11/2026).
const REGLES_CONCEPTION = lireRegles([
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice J', nature: 'alternative',
    texte: 'selon la bande', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }] },
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'alternative',
    alternatives: [{ libelle: 'bande principale (18 m)', valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }] },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'alternative',
    alternatives: [{ libelle: 'bande principale (18 m)', valeur: 6 }, { libelle: 'bande secondaire', valeur: 4 }] },
]);
/** Règles du volume AVEC bandes mesurées (plafond 45 %) et SANS (plafond prudent 20 %). */
const RV_BANDE = (): ReglesPluVolume => reglesVolume(REGLES_CONCEPTION, null, BANDES, { implantationDansBande: true });
const RV_PRUDENT = (): ReglesPluVolume => reglesVolume(REGLES_CONCEPTION, null, null);

/**
 * Vérification GÉOMÉTRIQUE indépendante du moteur (aucune fonction du placement n'est réutilisée) : pour CHAQUE
 * bâtiment, ses sommets et une grille de 0,25 m sont dans la parcelle, à ≥ recul des limites et à ≤ profondeur
 * du côté voie ; aucun chevauchement entre bâtiments. Rend la plus grande distance à la voie et l'emprise totale.
 */
function verifierTousLesBatiments(v: VolumePropose, cote: CoteVoie, profondeurM: number | null) {
  const corps = v.batiments?.length ? v.batiments : v.emprise ? [v.emprise] : [];
  assert.ok(corps.length > 0, 'aucun bâtiment');
  const contour = cote.anneaux[0];
  let distanceMax = 0, emprise = 0, points = 0;
  for (const b of corps) {
    const [c0, c1, c2, c3] = b.coins;
    // Les coins forment bien un rectangle largeur × profondeur (à 2 cm près).
    assert.ok(Math.abs(Math.hypot(c1.x - c0.x, c1.y - c0.y) - b.largeurM) < 0.02 && Math.abs(Math.hypot(c3.x - c0.x, c3.y - c0.y) - b.profondeurM) < 0.02);
    assert.ok(Math.abs((c1.x - c0.x) * (c3.x - c0.x) + (c1.y - c0.y) * (c3.y - c0.y)) < 1e-6, 'coins non perpendiculaires');
    assert.ok(Math.hypot(c2.x - (c1.x + c3.x - c0.x), c2.y - (c1.y + c3.y - c0.y)) < 1e-6);
    emprise += b.largeurM * b.profondeurM;
    const centre = { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 };
    const nu = Math.ceil(b.largeurM / 0.25), nv = Math.ceil(b.profondeurM / 0.25);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p: PointLocal = { x: c0.x + (c1.x - c0.x) * i / nu + (c3.x - c0.x) * j / nv, y: c0.y + (c1.y - c0.y) * i / nu + (c3.y - c0.y) * j / nv };
      const q = { x: p.x + (centre.x - p.x) * 1e-4, y: p.y + (centre.y - p.y) * 1e-4 };
      assert.ok(dansPolygone(cote.anneaux, q.x, q.y), `point hors parcelle : ${JSON.stringify(p)}`);
      for (let s = 0; s < contour.length; s++) {
        assert.ok(distancePointSegment(p, contour[s], contour[(s + 1) % contour.length]) >= v.reculM - 0.02, `point à moins de ${v.reculM} m d’une limite`);
      }
      const d = distanceALaVoie(p, cote);
      if (profondeurM !== null) assert.ok(d <= profondeurM + 1e-6, `point hors bande (${d.toFixed(3)} m de la voie)`);
      distanceMax = Math.max(distanceMax, d);
      points++;
    }
  }
  return { distanceMax, emprise, points, batiments: corps.length };
}
const ecartAxes = (a: number, b: number) => { const e = Math.abs(a - b) % 180; return Math.min(e, 180 - e); };

// ─────────────────────────────── Non-régression : sans le paramètre ───────────────────────────────

test('sans bande : résultats strictement identiques à ceux du moteur avant le lot (20 cas relevés, dont la parcelle réelle)', () => {
  const ref = lire('implantation-programme-reference-c7c.json');
  assert.equal(ref.cas.length, 20);
  let multi = 0;
  for (const c of ref.cas) {
    const v = c.regles ? calculerVolumeProgramme(c.geometrie, c.programme, c.regles) : calculerVolumeProgramme(c.geometrie, c.programme);
    assert.deepEqual(json(v), c.attendu, c.nom);
    assert.equal('bande' in v, false, c.nom);
    assert.deepEqual(calculerVolumeProgramme(c.geometrie, c.programme, c.regles ?? undefined, undefined), v, c.nom);
    assert.deepEqual(calculerVolumeProgramme(c.geometrie, c.programme, c.regles ?? undefined, null), v, c.nom);
    if ((v.batiments?.length ?? 0) > 1) multi++;
  }
  assert.ok(multi >= 6, `cas à plusieurs bâtiments : ${multi}`);
});

// ─────────────────────────────── Parcelle réelle : bande de 18 m, plafond 368 m² ───────────────────────────────

test('cas réel : la fixture et le plafond sont ceux des lots C7a / C7b (816 m², bande principale 461 m², 368 m², 45 %)', () => {
  assert.equal(COTE.statut, 'identifie');
  assert.deepEqual(BANDES, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
  assert.equal(PLAFOND, 368);
  assert.equal(RV_BANDE().regles.find(r => r.cle === 'emprise_max_ratio')?.valeur, 0.45);
  assert.equal(RV_PRUDENT().regles.find(r => r.cle === 'emprise_max_ratio')?.valeur, 0.2);
});

for (const n of [30, 40]) {
  test(`cas réel, ${n} logements collectifs : TOUS les bâtiments dans la parcelle et à 18 m au plus de la voie, emprise ≤ 368 m²`, () => {
    const v = calculerVolumeProgramme(PARCELLE, prog(`${n} logements`), RV_BANDE(), BANDE);
    assert.equal(v.bande?.statut, 'appliquee');
    assert.equal(v.bande?.raison, null);
    assert.ok(v.batiments && v.batiments.length >= 1);
    const g = verifierTousLesBatiments(v, COTE, 18);
    assert.ok(g.distanceMax <= 18 + 1e-6, String(g.distanceMax));
    assert.ok(v.bande!.distanceMaxVoieM! <= 18 && v.bande!.distanceMaxVoieM! >= g.distanceMax - 0.011);
    // Emprise : sous le plafond de la bande principale ET sous le coefficient passé (45 % de 816 m²).
    assert.ok(g.emprise <= PLAFOND + 1e-6 && g.emprise <= 0.45 * 816 + 1e-6, String(g.emprise));
    assert.equal(v.kpi?.empriseTotaleM2, Math.round(g.emprise));
    // Rangées parallèles à la voie (15,1°), hauteur et niveaux de la bande principale respectés.
    for (const b of v.batiments!) assert.ok(ecartAxes(b.angleDeg, v.bande!.angleVoieDeg!) < 0.11, `${b.angleDeg} / ${v.bande!.angleVoieDeg}`);
    assert.ok(v.niveaux <= 6 && v.hauteurM <= 19.5);
    // Chiffres relevés le 10/11/2026 : un plot de 14 × 14 m (196 m²), R+5, 16 logements — programme non atteint, et c'est dit.
    assert.deepEqual(v.batiments!.map(b => [b.forme, b.largeurM, b.profondeurM, b.niveaux, b.unites]), [['plot', 14, 14, 6, 16]]);
    assert.equal(v.programmeAtteint, false);
    assert.ok(v.alertes.some(a => /programme non atteint — 16 logements au plus \(6 niveaux, 1 bâtiment, dans la bande principale\)/.test(a)), v.alertes.join(' | '));
    assert.ok(v.hypotheses.some(h => /rangées parallèles à la voie, dans la bande principale \(18 m depuis le côté voie présumé\)/.test(h)));
    assert.ok(v.hypotheses.some(h => h === 'Emprise au sol bornée à 368 m² : maximum de la bande principale.'));
    assert.ok(v.hypotheses.some(h => /^Bande secondaire \(au-delà de 18 m depuis la voie\) : non construite/.test(h)));
    assert.ok(v.hypotheses.some(h => /côté voie compris/.test(h)));
    assert.ok(!v.hypotheses.some(h => /grand côté|petit côté|côté voie non identifié/.test(h)));
    // La preuve du moteur est rejouable sur le résultat (façades jointes), y compris après un aller-retour JSON.
    assert.equal(v.bande!.facades!.length, 2);
    assert.deepEqual(verifierBandeVolume(json(v)), { prouvee: true, raison: null, empriseM2: g.emprise, distanceMaxVoieM: v.bande!.distanceMaxVoieM });
    assert.deepEqual(calculerVolumeProgramme(PARCELLE, prog(`${n} logements`), RV_BANDE(), BANDE), v, 'déterministe');
  });
}

test('cas réel : sans la bande, les mêmes règles à 45 % placent le bâtiment HORS de la bande principale (le défaut corrigé)', () => {
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE());
  assert.equal('bande' in v, false);
  const g = verifierTousLesBatiments(v, COTE, null);
  assert.ok(g.distanceMax > 18.5, `bâtiment jusqu’à ${g.distanceMax.toFixed(2)} m de la voie`);
});

test('cas réel : sans hauteur PLU, maisons, résidence, programme mixte — toujours dans la bande, emprise sous le plafond', () => {
  const sansRegle: ReglesPluVolume = { source: 'aucune', regles: [], nonAppliquees: [] };
  for (const [texte, regles] of [['30 logements', sansRegle], ['40 logements', sansRegle], ['8 maisons', RV_BANDE()], ['résidence de 40 lits', RV_BANDE()], ['12 logements et 4 maisons', RV_BANDE()], ['12 logements et 4 maisons', sansRegle]] as const) {
    const v = calculerVolumeProgramme(PARCELLE, prog(texte), regles, BANDE);
    assert.equal(v.bande?.statut, 'appliquee', texte);
    const g = verifierTousLesBatiments(v, COTE, 18);
    assert.ok(g.emprise <= PLAFOND + 1e-6 && g.emprise <= v.cesRetenu * 816 + 1e-6, `${texte} : ${g.emprise}`);
    assert.equal(verifierBandeVolume(v).prouvee, true, texte);
  }
  // Programme mixte : les maisons ne tiennent pas dans la bande après le collectif, et l'alerte le dit sans les placer ailleurs.
  const mixte = calculerVolumeProgramme(PARCELLE, prog('12 logements et 4 maisons'), RV_BANDE(), BANDE);
  assert.ok(mixte.alertes.some(a => /aucune maison ne tient dans la bande principale/.test(a)), mixte.alertes.join(' | '));
  assert.equal(mixte.kpi?.maisons, 0);
});

test('plafond de la bande plus bas que la place disponible : jamais dépassé (pas d’arrondi au-dessus)', () => {
  for (const plafond of [150, 137.3, 101]) {
    const v = calculerVolumeProgramme(PARCELLE, prog('40 logements'), RV_BANDE(), { ...BANDE, empriseMaxM2: plafond });
    assert.equal(v.bande?.statut, 'appliquee', String(plafond));
    const g = verifierTousLesBatiments(v, COTE, 18);
    assert.ok(g.emprise <= plafond + 1e-6, `${g.emprise} m² pour ${plafond} m²`);
  }
});

// ─────────────────────────────── Repli : la bande n'est pas appliquée, et c'est dit ───────────────────────────────

/** Le repli rend l'implantation d'origine, plus UNE alerte et le champ `bande`. */
function estRepli(v: VolumePropose, programme: ProgrammeVolume, regles: ReglesPluVolume, raison: RegExp) {
  assert.equal(v.bande?.statut, 'non-appliquee');
  assert.match(v.bande!.raison!, raison);
  assert.match(v.bande!.raison!, /^Bande principale non appliquée : /);
  assert.equal(v.bande!.facades, undefined);
  assert.equal(verifierBandeVolume(v).prouvee, false);
  const origine = calculerVolumeProgramme(PARCELLE, programme, regles);
  const { bande: _b, alertes, ...reste } = v;
  const { alertes: alertesOrigine, ...resteOrigine } = origine;
  assert.deepEqual(reste, resteOrigine);
  assert.deepEqual(alertes, [...alertesOrigine, v.bande!.raison]);
}

test('repli : côté voie non identifié (voisines absentes) → implantation d’origine, raison dite', () => {
  const sansVoisines = identifierCoteVoie(PARCELLE, []);
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE(), { cote: sansVoisines, profondeurM: 18, empriseMaxM2: PLAFOND });
  estRepli(v, prog('30 logements'), RV_BANDE(), /côté voie non identifié/);
});

test('repli : bande trop peu profonde pour un bâtiment (8 m, recul de 4 m) → implantation d’origine, raison dite', () => {
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE(), { cote: COTE, profondeurM: 8, empriseMaxM2: 174 });
  estRepli(v, prog('30 logements'), RV_BANDE(), /aucun rectangle de 6 × 6 m ne tient à la fois à 4 m des limites et à moins de 8 m du côté voie/);
});

test('repli : un volume simple tiendrait dans la bande, mais AUCUN bâtiment du programme (maisons, bande de 12 m)', () => {
  const v = calculerVolumeProgramme(PARCELLE, prog('8 maisons'), RV_BANDE(), { cote: COTE, profondeurM: 12, empriseMaxM2: 200 });
  estRepli(v, prog('8 maisons'), RV_BANDE(), /aucun bâtiment du programme ne tient à la fois à 4 m des limites et à moins de 12 m du côté voie \(emprise maximale 200 m²\)\. Bâtiments placés sans tenir compte de la bande\.$/);
  // Le repli a bien des bâtiments hors de la bande demandée : le plafond « bande » ne vaut pas pour lui.
  assert.ok(verifierTousLesBatiments(v, COTE, null).distanceMax > 12);
});

test('repli : côté voie d’une autre géométrie, plafond illisible → refus avec raison', () => {
  const autre = identifierCoteVoie(VOISINES[0], [PARCELLE]);
  estRepli(calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE(), { cote: autre, profondeurM: 18 }), prog('30 logements'), RV_BANDE(), /autre géométrie/);
  estRepli(calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE(), { cote: COTE, profondeurM: 18, empriseMaxM2: Number.NaN }), prog('30 logements'), RV_BANDE(), /emprise maximale de la bande principale illisible/);
});

test('sans programme détaillé : volume unique du lot C7b, avec les façades jointes pour la revérification', () => {
  const simple: ProgrammeVolume = { logements: 30, libelle: '30 logements', origine: 'fiche' };
  const v = calculerVolumeProgramme(PARCELLE, simple, RV_BANDE(), BANDE);
  assert.equal(v.bande?.statut, 'appliquee');
  assert.equal(v.batiments, undefined);
  verifierTousLesBatiments(v, COTE, 18);
  assert.equal(verifierBandeVolume(v).prouvee, true);
});

// ─────────────────────────────── Revérification et contrôles ───────────────────────────────

test('verifierBandeVolume : un volume « appliquee » dont un bâtiment a été déplacé hors de la bande n’est plus prouvé', () => {
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE(), BANDE);
  // Bâtiment glissé de 6 m vers le fond de parcelle (perpendiculairement à la voie), comme une modification dans la fiche.
  const a = (v.bande!.angleVoieDeg! + 90) * Math.PI / 180;
  const glisse = (p: PointLocal) => ({ x: p.x + 6 * Math.cos(a), y: p.y + 6 * Math.sin(a) });
  const versFond = distanceALaVoie(glisse(v.batiments![0].centre), COTE) > distanceALaVoie(v.batiments![0].centre, COTE) ? glisse : (p: PointLocal) => ({ x: p.x - 6 * Math.cos(a), y: p.y - 6 * Math.sin(a) });
  const deplace: VolumePropose = { ...v, batiments: v.batiments!.map(b => ({ ...b, centre: versFond(b.centre), coins: b.coins.map(versFond) })) };
  const preuve = verifierBandeVolume(deplace);
  assert.equal(preuve.prouvee, false);
  assert.match(preuve.raison!, /1 emprise bâtie sur 1 non contenue dans la bande principale de 18 m/);
  assert.ok(preuve.distanceMaxVoieM! > 18);
  // Emprise gonflée au-dessus du plafond, sans bouger : non prouvé non plus.
  const gonfle: VolumePropose = { ...v, bande: { ...v.bande!, empriseMaxM2: 150 } };
  assert.match(verifierBandeVolume(gonfle).raison!, /emprise de 196 m² au-dessus du maximum de 150 m² de la bande principale/);
  // Sans façades, ou sans bande : non prouvé.
  assert.equal(verifierBandeVolume({ ...v, bande: { ...v.bande!, facades: undefined } }).prouvee, false);
  assert.equal(verifierBandeVolume(calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE())).prouvee, false);

  // Les contrôles suivent la géométrie réelle, pas le champ `statut`.
  const emprise = controlerVolume(deplace, REGLES_CONCEPTION, 16).find(c => c.cle === 'emprise_sol_max_pct')!;
  assert.equal(emprise.verdict, 'a_verifier');
  assert.match(emprise.regle!, /^20 % de la parcelle \(plafond prudent\)/);
  assert.match(emprise.explication, /ne sont pas prouvés dans la bande principale \(1 emprise bâtie sur 1 non contenue/);
});

test('contrôles, bande prouvée : emprise comparée au plafond de la bande en m², textes à jour, jamais « dans la limite »', () => {
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_BANDE(), BANDE);
  const controles = controlerVolume(v, REGLES_CONCEPTION, v.logementsEstimes);
  const emprise = controles.find(c => c.cle === 'emprise_sol_max_pct')!;
  assert.equal(emprise.verdict, 'a_verifier');
  assert.equal(emprise.valeur_volume, '196 m² dans la bande principale (24 % de la parcelle)');
  assert.equal(emprise.regle, '368 m² max. dans la bande principale (80 % de la bande de 18 m) (Règlement GPU — PLUi Est Ensemble, indice J)');
  assert.match(emprise.explication, /tous les bâtiments du volume d’étude sont dans la bande principale \(à 18 m au plus du côté voie, pour 18 m\)/);
  assert.match(emprise.explication, /vérifié par le calcul\. Reste à vérifier : le côté voie est présumé d’après le cadastre/);
  const tout = JSON.stringify(controles);
  assert.doesNotMatch(tout, /côté voie non identifié par le volume|80 % max\.|pas encore contraint/);
  assert.ok(!controles.some(c => c.verdict === 'dans_la_limite' && /bande/.test(c.explication)), 'une règle par bande ne devient pas « dans la limite » : côté voie présumé');
  const hauteur = controles.find(c => c.cle === 'hauteur_max_m')!;
  assert.equal(hauteur.verdict, 'a_verifier');
  assert.match(hauteur.explication, /Condition complémentaire : règle par bande — bande principale de 18 m depuis la voie : 19,5 m ; bande secondaire : 13,5 m ; volume d’étude contenu dans la bande principale \(vérifié par le calcul\), côté voie présumé d’après le cadastre, à confirmer\./);
});

test('contrôles, bande non appliquée : plafond prudent, « côté voie non identifié » conservé, dépassement certain = au-delà', () => {
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), RV_PRUDENT());
  const controles = controlerVolume(v, REGLES_CONCEPTION, v.logementsEstimes);
  const emprise = controles.find(c => c.cle === 'emprise_sol_max_pct')!;
  assert.equal(emprise.verdict, 'a_verifier');
  assert.equal(emprise.valeur_volume, '20,6 %');
  assert.match(emprise.regle!, /^20 % de la parcelle \(plafond prudent\) — règle par bande — bande principale de 18 m depuis la voie : 80 % ; bande secondaire : 20 % \(/);
  assert.match(emprise.explication, /au-dessus du plafond prudent de 20 %.*admissible seulement pour la part d’emprise située dans la bande principale \(80 %\), ce que le calcul ne prouve pas ici\./);
  assert.match(emprise.explication, /\(bande principale non demandée pour ce volume\)/);
  assert.doesNotMatch(JSON.stringify(emprise), /80 % max\./);
  assert.match(controles.find(c => c.cle === 'hauteur_max_m')!.explication, /Condition complémentaire non vérifiée : .*côté voie non identifié par le volume\./);
  // Sous le plafond prudent : dit comme tel.
  const petit: VolumePropose = { ...v, kpi: { ...v.kpi!, empriseTotaleM2: 150 } };
  assert.match(controlerVolume(petit, REGLES_CONCEPTION, 10).find(c => c.cle === 'emprise_sol_max_pct')!.explication, /^18,4 % de la parcelle : sous le plafond prudent de 20 %/);
  // Au-dessus du taux le plus élevé des bandes (80 %) : dépassement certain.
  const enorme: VolumePropose = { ...v, kpi: { ...v.kpi!, empriseTotaleM2: 700 } };
  const auDela = controlerVolume(enorme, REGLES_CONCEPTION, 10).find(c => c.cle === 'emprise_sol_max_pct')!;
  assert.equal(auDela.verdict, 'au_dela');
  assert.match(auDela.explication, /plus que le taux le plus élevé des bandes \(80 %\)/);
});

test('contrôles : une règle d’emprise ORDINAIRE (sans bande) est jugée comme avant le lot', () => {
  const ordinaires = lireRegles([{ cle: 'emprise_sol_max_pct', valeur: 40, statut: 'confirme', source: 'PLU', article: 'UA 9' }]);
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), reglesVolume(ordinaires, null));
  const emprise = controlerVolume(v, ordinaires, v.logementsEstimes).find(c => c.cle === 'emprise_sol_max_pct')!;
  assert.equal(emprise.verdict, 'dans_la_limite');
  assert.match(emprise.regle!, /^40 % max\. \(PLU, UA 9\)$/);
});

test('reglesVolume : la note « pas encore contraint » n’est remplacée que si l’appelant garantit l’implantation dans la bande', () => {
  const sans = reglesVolume(REGLES_CONCEPTION, null, BANDES).nonAppliquees.join(' | ');
  const avec = RV_BANDE().nonAppliquees.join(' | ');
  assert.match(sans, /pas encore contraint à rester dans la bande principale/);
  assert.doesNotMatch(avec, /pas encore contraint/);
  assert.match(avec, /Côté voie présumé d’après le cadastre \(limite sans parcelle mitoyenne\), à confirmer ; les bâtiments du volume d’étude sont contenus dans la bande principale \(vérifié par le calcul\)/);
  assert.deepEqual(RV_BANDE().regles, reglesVolume(REGLES_CONCEPTION, null, BANDES).regles);
});
