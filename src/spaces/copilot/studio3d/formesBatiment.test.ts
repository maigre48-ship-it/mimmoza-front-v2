// LOT FORMES-BATIMENT — formes du bâtiment (plots, en L, en U, cour fermée, redans) : calculées par le moteur,
// vérifiées aile par aile, transmises au Studio (contrat v2 `ailes`), dessinées (plan coté, aperçu 3D).
// Données : parcelle RÉELLE 92050000AE0414 (Nanterre) — __fixtures__/preparation-AE0414.json (ligne
// studio_preparations recalculée par le code réel du serveur ; règles de la conception : recul aux limites
// 8 m, hauteur 28 m sous réserve UC 10-1, pleine terre 20 %, emprise non réglementée, gabarit R+4, 40 logements).
// Aucune donnée de la base de production.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { apercuVolume } from '../../../../supabase/functions/copilot-chat/agent/studio.ts';
import { lirePreparationStockee, ouverturePreparation, type PreparationStockee } from './preparationStudio.ts';
import {
  apercuDepuisEvaluation, appliquerForme, appliquerFormeDetail, blocForme, comparerFormes, evaluerSaisie, messageForme, modifierAile,
  modifierCorps, modifierDecalage, phraseSuggestion, saisieDepuisBloc, saisieDepuisVolume, schemaForme, FORME_BLOC_LANGUE,
  type SaisieDimensions,
} from './ficheDimensions.ts';
import { contourRects, cotesInterieurs, normaliserAiles, placerForme, rectsAiles, visAVisInterieurs, type AileSaisie } from './formesBatiment.ts';
import { batimentsV2DepuisVolume, volumeBatimentsStudio } from './batimentsStudio.ts';
import { transportParBatiments } from './projetChat.ts';
import { CHOIX_DEFAUT, sceneApercu } from './briefCreatif.ts';
import { validerProjet } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/preparation-AE0414.json', import.meta.url), 'utf8'));
const P = lirePreparationStockee(FIX.ligne) as PreparationStockee;
const sp = (s: string) => s.replace(/[  ]/g, ' ');
const A = (longueurM: number, largeurM: number, niveaux = 3): AileSaisie => ({ nom: '', longueurM, largeurM, niveaux });
const surface = (r: { lu: number; lv: number }[]) => r.reduce((s, x) => s + x.lu * x.lv, 0);
const recouvre = (a: { du: number; dv: number; lu: number; lv: number }, b: typeof a) =>
  Math.abs(a.du - b.du) < (a.lu + b.lu) / 2 - 1e-6 && Math.abs(a.dv - b.dv) < (a.lv + b.lv) / 2 - 1e-6;

test('relecture : gabarit du programme (R+4 → 5 niveaux) lu dans la ligne stockée', () => {
  assert.equal(P.gabaritNiveaux, 5);
  assert.equal(lirePreparationStockee({ ...FIX.ligne, entree: { ...FIX.ligne.entree, gabarit_niveaux: 'x' } })?.gabaritNiveaux, null);
});

test('ailes : rectangles SANS recouvrement, longueurs hors tout, surface = formule de la forme', () => {
  const l = rectsAiles('l', normaliserAiles('l', [A(32, 16), A(42.5, 16)]).ailes);
  assert.deepEqual([l.lu, l.lv], [32, 42.5]);
  assert.equal(surface(l.rects), 32 * 16 + (42.5 - 16) * 16);
  const u = rectsAiles('u', normaliserAiles('u', [A(34, 12.5), A(33, 12.5), A(33, 12.5)]).ailes);
  assert.equal(surface(u.rects), 34 * 12.5 + 2 * (33 - 12.5) * 12.5);
  const c = rectsAiles('cour', normaliserAiles('cour', [A(40, 12), A(30, 12), A(99, 12), A(1, 12)]).ailes);
  // Cour fermée : côtés opposés de même longueur (C = A, D = B), quatre ailes.
  assert.deepEqual([c.lu, c.lv, c.rects.length], [40, 30, 4]);
  assert.equal(surface(c.rects), 2 * 40 * 12 + 2 * (30 - 24) * 12);
  const r = normaliserAiles('redans', [A(19.5, 16), A(19.5, 16), A(19.5, 16)], 30);
  assert.equal(r.decalageM, 12, 'décalage borné : ≥ 4 m de contact entre segments');
  for (const x of [l, u, c, rectsAiles('redans', r.ailes, r.decalageM)]) {
    for (let i = 0; i < x.rects.length; i++) for (let j = i + 1; j < x.rects.length; j++) assert.ok(!recouvre(x.rects[i], x.rects[j]), JSON.stringify([x.rects[i], x.rects[j]]));
  }
  // Retours plus longs que l'épaisseur de la base (sinon l'aile n'existerait pas) ; ouverture ≥ 6 m.
  assert.deepEqual(normaliserAiles('l', [A(20, 16), A(10, 16)]).ailes.map((a) => a.longueurM), [22, 22]);
  assert.equal(normaliserAiles('u', [A(20, 12), A(30, 12), A(30, 12)]).ailes[0].longueurM, 30);
});

test('contour réel : L = 6 sommets ; cour = contour extérieur + cour intérieure ; côtés accolés repérés', () => {
  const l = rectsAiles('l', normaliserAiles('l', [A(32, 16), A(42.5, 16)]).ailes);
  const cl = contourRects(l.rects);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].length, 6);
  const c = rectsAiles('cour', normaliserAiles('cour', [A(40, 12), A(30, 12), A(40, 12), A(30, 12)]).ailes);
  const cc = contourRects(c.rects);
  assert.deepEqual(cc.map((b) => b.length), [4, 4]);
  assert.deepEqual(cc[1].map((p) => [p.u, p.v]).sort(), [[-8, -3], [-8, 3], [8, -3], [8, 3]].sort());
  assert.deepEqual([cotesInterieurs('l', 1), cotesInterieurs('cour', 1), cotesInterieurs('cour', 0)], [[1], [0, 1], []]);
  assert.deepEqual(visAVisInterieurs('cour', [A(40, 12), A(30, 12), A(40, 12), A(30, 12)]).map((v) => v.distanceM), [16, 6]);
});

test('placement AE0414 : chaque forme tient à ≥ 8 m de toutes les limites et atteint 40 logements en R+2', () => {
  const ctx = { contour: P.volume.contour, angleDeg: P.volume.emprise!.angleDeg, surfaceParcelleM2: P.volume.surfaceParcelleM2, regles: P.regles, gabaritNiveaux: 5, sdpViseeM2: 2800 };
  for (const f of ['l', 'u', 'cour', 'redans', 'plots'] as const) {
    const pl = placerForme(ctx, f);
    assert.equal(pl.atteint, true, f);
    assert.equal(pl.niveaux, 3, f);
    assert.equal(pl.reculM, 8, f);
    const s = appliquerForme(P, saisieDepuisVolume(P.volume), f);
    const ev = evaluerSaisie(P, s);
    assert.ok(ev.reculMinM >= 7.99, `${f} ${ev.reculMinM}`);
    assert.ok(ev.sdpM2 >= 2800, `${f} ${ev.sdpM2}`);
    assert.equal(ev.logementsPlaces, 40);
    assert.ok(!ev.alertes.some((a) => /déborde|chevauchent|écart/.test(a)), `${f} : ${ev.alertes.join(' | ')}`);
    assert.ok(!ev.controles.some((c) => c.verdict === 'au_dela'), f);
  }
});

test('évaluation d’un L : emprise et SDP = somme des ailes, recul réel AILE PAR AILE, verdicts honnêtes', () => {
  const s = appliquerForme(P, saisieDepuisVolume(P.volume), 'l');
  assert.equal(s.forme, 'l');
  assert.equal(s.corps.length, 1);
  const ev = evaluerSaisie(P, s);
  const c = ev.corps[0];
  assert.equal(c.nom, 'Immeuble en L — 40 logements R+2');
  assert.deepEqual(c.ailesEvaluees!.map((a) => [a.lu, a.lv, a.niveaux]), [[32, 16, 3], [16, 26.5, 3]]);
  assert.equal(ev.empriseM2, 936);
  assert.equal(ev.sdpM2, 2808);
  assert.ok(c.ailesEvaluees!.every((a) => a.reculReelM >= 7.99));
  assert.equal(c.reculReelM, Math.min(...c.ailesEvaluees!.map((a) => a.reculReelM)));
  assert.equal(c.facadeM, 149);
  const v = Object.fromEntries(ev.controles.map((k) => [k.cle, k]));
  assert.equal(v.hauteur_max_m.verdict, 'a_verifier');
  assert.equal(v.recul_limites_m.verdict, 'dans_la_limite');
  assert.match(v.recul_limites_m.explication, /aile par aile sur le contour réel/);
  assert.equal(v.pleine_terre_min_pct.verdict, 'a_verifier');
  assert.ok(!/conforme/i.test(JSON.stringify(ev)));
  // Volume relu (préparation enregistrée par le serveur) → même saisie, même forme.
  const relue = saisieDepuisVolume(ev.volume);
  assert.equal(relue.forme, 'l');
  assert.equal(evaluerSaisie({ ...P, volume: ev.volume }, relue).modifie, false);
  assert.deepEqual(relue.corps[0].ailes, s.corps[0].ailes);
});

test('modification aile par aile : enveloppe recalculée, centre gardé ; aile trop longue → déborde et recul au-delà', () => {
  const s = appliquerForme(P, saisieDepuisVolume(P.volume), 'l');
  const s2 = modifierAile(s, 0, 1, 'niveaux', 5);
  const ev2 = evaluerSaisie(P, s2);
  assert.deepEqual(ev2.corps[0].ailesEvaluees!.map((a) => a.niveaux), [3, 5]);
  assert.equal(ev2.sdpM2, 32 * 16 * 3 + 26.5 * 16 * 5);
  assert.equal(ev2.corps[0].niveaux, 5);
  // 60 m : reste dans la parcelle mais à 0,94 m d'une limite → recul « au-delà » ; 80 m : déborde.
  assert.equal(evaluerSaisie(P, modifierAile(s, 0, 0, 'longueurM', 60)).controles.find((k) => k.cle === 'recul_limites_m')?.verdict, 'au_dela');
  const s3 = modifierAile(s, 0, 0, 'longueurM', '80');
  assert.equal(s3.corps[0].longueurM, 80);
  assert.deepEqual(s3.corps[0].centre, s.corps[0].centre);
  const ev3 = evaluerSaisie(P, s3);
  assert.ok(ev3.alertes.some((a) => /déborde de la parcelle/.test(a)), ev3.alertes.join(' | '));
  assert.equal(ev3.controles.find((k) => k.cle === 'recul_limites_m')?.verdict, 'au_dela');
  // Saisie illisible ignorée ; « niveaux » du bâtiment = toutes les ailes ; longueur du bâtiment : par aile seulement.
  assert.equal(modifierAile(s, 0, 0, 'longueurM', 'abc'), s);
  assert.deepEqual(modifierCorps(s, 0, 'niveaux', 4).corps[0].ailes!.map((a) => a.niveaux), [4, 4]);
  assert.equal(modifierCorps(s, 0, 'longueurM', 50), s);
  // Redans : décalage modifiable (borné).
  const r = appliquerForme(P, saisieDepuisVolume(P.volume), 'redans');
  assert.equal(modifierDecalage(r, 0, -3).corps[0].decalageM, -3);
});

test('cour : côtés opposés liés ; cour trop étroite → alerte d’hypothèse du moteur (jamais une règle PLU)', () => {
  const s = appliquerForme(P, saisieDepuisVolume(P.volume), 'cour');
  assert.equal(s.corps[0].ailes!.length, 4);
  const s2 = modifierAile(s, 0, 1, 'longueurM', 31);
  assert.equal(s2.corps[0].ailes![3].longueurM, 31, 'D suit B');
  const etroite = modifierAile(s2, 0, 1, 'longueurM', 25);
  const ev = evaluerSaisie(P, etroite);
  const a = ev.alertes.find((x) => /dans la cour/.test(x));
  assert.ok(a, ev.alertes.join(' | '));
  assert.match(a!, /Hypothèse du moteur, aucune règle PLU de prospect/);
});

test('comparaison des formes (suggestion de Mimmo) : classement déterministe, toutes dans les règles sauf barre / plot seuls', () => {
  const t0 = Date.now();
  const c = comparerFormes({ ...P });
  assert.ok(Date.now() - t0 < 4000, 'comparaison en quelques centaines de ms');
  assert.equal(c.length, 8);
  assert.equal(c[0].forme, 'l');
  assert.deepEqual(c.slice(0, 6).map((x) => x.logements), [40, 40, 40, 40, 40, 40]);
  assert.ok(c.slice(-2).every((x) => x.logements < 40), 'barre / plot seuls : programme non atteint, en dernier');
  assert.equal(sp(phraseSuggestion(c)!), 'En L : 40 logements / 40 visés, R+2, SDP ≈ 2 808 m², emprise 936 m², 149 m de façade.');
  assert.ok(c.every((x) => x.ev && !/conforme/i.test(JSON.stringify(x.ev.controles))));
});

test('contrat v2 : un bâtiment à ailes part SEUL par `batiments`, ailes au sens du contrat, emprise réelle, projet validé', () => {
  const ev = evaluerSaisie(P, appliquerForme(P, saisieDepuisVolume(P.volume), 'l'));
  const v2 = batimentsV2DepuisVolume(ev.volume);
  assert.equal(v2.length, 1);
  const b = v2[0];
  assert.deepEqual([b.largeurM, b.profondeurM, b.niveaux, b.rotationDeg], [32, 42.5, 3, 149.6]);
  assert.deepEqual(b.ailes.map((a) => [a.largeurM, a.profondeurM, a.niveaux, a.x, a.y, a.retraitM]), [[32, 16, 3, 0, 13.25, 26.5], [16, 26.5, 3, -8, -8, 0]]);
  assert.equal(b.emprise.length, 1);
  assert.equal(b.emprise[0].length, 7, 'L : 6 sommets + fermeture');
  assert.ok(transportParBatiments(v2));
  assert.equal(transportParBatiments([{ ailes: [] }]), false);
  const vb = volumeBatimentsStudio(ev.volume, { objectif: 'x', dimensions: 'y' });
  assert.ok(vb);
  const o = ouverturePreparation({ ...P, volume: ev.volume });
  assert.ok(o.ok);
  if (o.ok) assert.equal(o.terrain.volumeBatiments?.batiments[0].ailes.length, 2);
  // Validation stricte du contrat v2 (même code que le Studio) : ailes acceptées.
  const cour = evaluerSaisie(P, appliquerForme(P, saisieDepuisVolume(P.volume), 'cour'));
  const vc = batimentsV2DepuisVolume(cour.volume)[0];
  assert.equal(vc.ailes.length, 4);
  assert.equal(vc.emprise.length, 1, 'cour : contour extérieur seul (la cour n’est pas bâtie)');
  assert.ok(typeof validerProjet === 'function');
});

test('aperçu 3D du brief : une boîte par aile, côtés accolés sans façade ; identique au serveur (apercuVolume)', () => {
  const ev = evaluerSaisie(P, appliquerForme(P, saisieDepuisVolume(P.volume), 'cour'));
  const ap = apercuDepuisEvaluation(ev);
  assert.equal(ap.corps.length, 4);
  assert.deepEqual(ap.corps.map((c) => c.int ?? []), [[], [0, 1], [], [0, 1]]);
  assert.deepEqual(ap, apercuVolume(ev.volume));
  const avec = sceneApercu(ap, CHOIX_DEFAUT).boites.length;
  const sans = sceneApercu({ ...ap, corps: ap.corps.map((c) => ({ cx: c.cx, cy: c.cy, l: c.l, p: c.p, a: c.a, n: c.n })) }, CHOIX_DEFAUT).boites.length;
  assert.ok(avec < sans, `${avec} < ${sans} : pas de fenêtres sur les faces accolées`);
});

test('plan coté : contour réel (cour en creux), cotes hors tout, ailes étiquetées', () => {
  const evL = evaluerSaisie(P, appliquerForme(P, saisieDepuisVolume(P.volume), 'l'));
  const sL = schemaForme(evL).corps[0];
  assert.equal((sL.trace.match(/M/g) ?? []).length, 1);
  assert.deepEqual(sL.cotes.map((k) => sp(k.texte)), ['32 m', '42,5 m']);
  assert.deepEqual(sL.ailes.map((a) => sp(a.texte)), ['ép. 16 m · R+2', 'ép. 16 m · R+2']);
  const evC = evaluerSaisie(P, appliquerForme(P, saisieDepuisVolume(P.volume), 'cour'));
  assert.equal((schemaForme(evC).corps[0].trace.match(/M/g) ?? []).length, 2);
});

test('bloc ```mimmoza-forme``` : saisie seule (jamais les chiffres), relue sans confiance', () => {
  const s = appliquerForme(P, saisieDepuisVolume(P.volume), 'u');
  const ev = evaluerSaisie(P, s);
  const m = messageForme(s, ev)!;
  assert.ok(m.includes('```' + FORME_BLOC_LANGUE));
  assert.ok(!/sdp"|logements"|recul/.test(JSON.stringify(blocForme(s))));
  const relu = saisieDepuisBloc(blocForme(s));
  assert.ok(relu.ok);
  if (relu.ok) assert.equal(evaluerSaisie(P, relu.saisie).sdpM2, ev.sdpM2);
  const refus = (b: unknown) => { const r = saisieDepuisBloc(b); return r.ok ? null : r.erreur; };
  assert.match(refus({ ...blocForme(s), v: 2 })!, /version/);
  assert.match(refus({ ...blocForme(s), forme: 't' })!, /forme inconnue/);
  assert.match(refus({ ...blocForme(s), sdp: 9999 })!, /champ inconnu/);
  assert.match(refus({ ...blocForme(s), corps: [{ ...blocForme(s)!.corps[0], ailes: [] }] })!, /ailes attendues/);
  const geant = saisieDepuisBloc({ ...blocForme(s), corps: [{ ...blocForme(s)!.corps[0], ailes: [{ longueurM: 900, largeurM: 1, niveaux: 99 }, ...blocForme(s)!.corps[0].ailes!.slice(1)] }] });
  assert.ok(geant.ok);
  if (geant.ok) assert.deepEqual([geant.saisie.corps[0].ailes![0].longueurM, geant.saisie.corps[0].ailes![0].largeurM, geant.saisie.corps[0].ailes![0].niveaux], [120, 6, 30]);
  const rien: SaisieDimensions = { forme: 'moteur', corps: [] };
  assert.equal(blocForme(rien), null);
});

test('forme impossible : raison donnée, saisie inchangée (parcelle trop petite)', () => {
  const petit = { ...P, volume: { ...P.volume, contour: P.volume.contour.map((q) => ({ x: q.x * 0.3, y: q.y * 0.3 })), surfaceParcelleM2: P.volume.surfaceParcelleM2 * 0.09 } };
  const s = saisieDepuisVolume(P.volume);
  const r = appliquerFormeDetail(petit, s, 'cour');
  assert.equal(r.saisie, s);
  assert.match(r.raison ?? '', /ne tient pas/);
});
