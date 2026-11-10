// node --test src/spaces/copilot/studio3d/implantationLimite.test.ts
// Lot C11 — implantation en limite séparative, alignement retenu quand le recul sur voie n'est pas réglementé,
// côté voie sondé par portions d'arête, pleine terre par bande dite « non contrôlée ».
//
// Parcelle réelle : 93048000AS0249 (98 rue de Paris, Montreuil) et ses cinq voisines (fixture du lot C7a).
// Règles : EXACTEMENT celles enregistrées par la mission de conception du 10/11/2026 à 17 h 01 (zone UC91Jb2).
// Ce jour-là le moteur plaçait 7 logements (R+2, 175,5 m², recul de 4,5 m partout) pour 30 demandés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculerVolumeProgramme, contraintesPlu } from './implantationProgramme.ts';
import { calculerVolumeParcelle, dansPolygone, reculsRetenus, type GeometrieParcelle, type PointLocal, type ProgrammeVolume, type VolumePropose } from './volumeParcelle.ts';
import { CONTACT_LIMITE_M, lateralesAdmises, marquerSegmentsLateraux, mesurerReculsVolume, verifierBandeVolume } from './bandePrincipale.ts';
import { distanceALaVoie, distancePointSegment, empriseMaxParBande, identifierCoteVoie, mesurerBandes } from './coteVoie.ts';
import { controlerVolume, formuleRecul, implantationDesRegles, lireRegles, reglesVolume } from './controlesVolume.ts';
import { programmeBatiDepuisTexte } from './programmeBati.ts';

const cadastre = JSON.parse(readFileSync(new URL('./__fixtures__/cadastre-93048000AS0249.json', import.meta.url), 'utf8'));
const PARCELLE: GeometrieParcelle = cadastre.parcelle.geometry;
const VOISINES: GeometrieParcelle[] = cadastre.voisines.map((v: { geometry: GeometrieParcelle }) => v.geometry);
const COTE = identifierCoteVoie(PARCELLE, VOISINES);
const BANDES = mesurerBandes(COTE, 18)!;
const PLAFOND = empriseMaxParBande(BANDES, 80, null)!.principaleM2;
const prog = (texte: string): ProgrammeVolume => ({ ...programmeBatiDepuisTexte(texte)!, origine: 'fiche' });

const SRC = 'Règlement GPU — PLUi Est Ensemble';
const bande = (principale: number, secondaire: number) => [{ libelle: 'bande principale (18 m)', valeur: principale }, { libelle: 'bande secondaire', valeur: secondaire }];
const VOISINAGE = 'L\'implantation des constructions doit prendre en compte l\'implantation des constructions voisines pour s\'insérer de manière harmonieuse au sein du tissu existant.';
/** Les règles de la mission du 10/11/2026 à 17 h 01, telles qu'elles sont enregistrées. */
const REGLES_17H01 = [
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(19.5, 13.5) },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(6, 4) },
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(80, 20) },
  { cle: 'pleine_terre_min_pct', valeur: 15, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(15, 50) },
  { cle: 'recul_voie_m', valeur: null, statut: 'confirme', source: SRC, article: 'indice 9, p. 200', nature: 'non_reglementee', regle_relative: VOISINAGE },
  { cle: 'recul_limites_m', valeur: 0, statut: 'confirme', source: SRC, article: 'indice 1, p. 214', nature: 'alternative',
    alternatives: [{ libelle: 'sur limite séparative', valeur: 0 }, { libelle: 'en retrait (minimum)', valeur: 3 }] },
  { cle: 'recul_limites_formule', valeur: 'en cas de retrait : H/2 et 3 mètres minimum', statut: 'confirme', source: SRC, article: 'indice 1, p. 214' },
  { cle: 'stationnement_par_logement', valeur: 0.5, statut: 'confirme', source: SRC, article: 'dispositions communes, p. 89' },
  { cle: 'mixite_sociale_pct', valeur: null, statut: 'manquant', source: 'aucune' },
];
const sans = (cle: string, remplace?: Record<string, unknown>) => REGLES_17H01.flatMap(r => r.cle !== cle ? [r] : remplace ? [{ ...r, ...remplace }] : []);

/** Volume du serveur pour ces règles (même enchaînement que preparerVolume). */
function volumeEnBande(brut: unknown[], programme: ProgrammeVolume): VolumePropose {
  const regles = lireRegles(brut);
  const rv = reglesVolume(regles, null, BANDES, { implantationDansBande: true });
  return calculerVolumeProgramme(PARCELLE, programme, rv, { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND, surfaceBandeM2: BANDES.bandePrincipaleM2, implantation: implantationDesRegles(regles) });
}

// Limites de la parcelle réelle, nommées ICI par leur rang dans le contour (relevé à la main sur la fixture, sans
// passer par marquerSegmentsLateraux) : 6 et 7 sur voie (28,65 m) ; 2 à 5 limite latérale est ; 8 limite latérale
// ouest ; 0, 1, 9, 10 et 11 fond de parcelle (dont le décroché nord-ouest).
const VOIE = [6, 7], EST = [2, 3, 4, 5], OUEST = [8], FOND = [0, 1, 9, 10, 11];

/**
 * Vérification GÉOMÉTRIQUE indépendante du moteur : grille de 0,25 m sur chaque bâtiment. Dans la parcelle ; à
 * 18 m au plus de la voie ; distances minimales à la voie, à chaque limite latérale et au fond.
 */
function grille(v: VolumePropose) {
  const contour = COTE.anneaux[0];
  const seg = (i: number): [PointLocal, PointLocal] => [contour[i], contour[(i + 1) % contour.length]];
  const corps = v.batiments?.length ? v.batiments : v.emprise ? [v.emprise] : [];
  assert.ok(corps.length > 0, 'aucun bâtiment');
  const min = { voie: Infinity, est: Infinity, ouest: Infinity, fond: Infinity };
  let distanceMax = 0, emprise = 0, points = 0;
  for (const b of corps) {
    const [c0, c1, c2, c3] = b.coins;
    assert.ok(Math.abs(Math.hypot(c1.x - c0.x, c1.y - c0.y) - b.largeurM) < 0.02 && Math.abs(Math.hypot(c3.x - c0.x, c3.y - c0.y) - b.profondeurM) < 0.02, 'coins ≠ largeur × profondeur');
    emprise += b.largeurM * b.profondeurM;
    const centre = { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 };
    const nu = Math.ceil(b.largeurM / 0.25), nv = Math.ceil(b.profondeurM / 0.25);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p: PointLocal = { x: c0.x + (c1.x - c0.x) * i / nu + (c3.x - c0.x) * j / nv, y: c0.y + (c1.y - c0.y) * i / nu + (c3.y - c0.y) * j / nv };
      // Un point du bord peut être à 1 cm de la limite : on le rentre de 2 cm vers le centre avant de tester « dans la parcelle ».
      const dc = Math.hypot(centre.x - p.x, centre.y - p.y) || 1;
      const q = { x: p.x + (centre.x - p.x) * 0.02 / dc, y: p.y + (centre.y - p.y) * 0.02 / dc };
      assert.ok(dansPolygone(COTE.anneaux, q.x, q.y), `point hors parcelle : ${JSON.stringify(p)}`);
      const d = (ids: number[]) => Math.min(...ids.map(k => distancePointSegment(p, ...seg(k))));
      min.voie = Math.min(min.voie, d(VOIE)); min.est = Math.min(min.est, d(EST)); min.ouest = Math.min(min.ouest, d(OUEST)); min.fond = Math.min(min.fond, d(FOND));
      const dv = distanceALaVoie(p, COTE);
      assert.ok(dv <= 18 + 1e-6, `point hors bande (${dv.toFixed(3)} m de la voie)`);
      distanceMax = Math.max(distanceMax, dv);
      points++;
    }
  }
  return { ...min, distanceMax, emprise, points, batiments: corps.length };
}

test('C11 — fixture réelle inchangée par le sondage par portions : façade 28,65 m en 2 arêtes, 816 m², bande principale 461 m², plafond 368 m²', () => {
  assert.equal(COTE.statut, 'identifie');
  assert.deepEqual([COTE.longueurFacadeM, COTE.facades.length, COTE.nbVoisines], [28.65, 2, 5]);
  assert.deepEqual(BANDES, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
  assert.equal(PLAFOND, 368);
  // Chaque façade est une arête ENTIÈRE du contour (sommet à sommet) : condition du recul différencié.
  const contour = COTE.anneaux[0];
  for (const f of COTE.facades) assert.ok(VOIE.some(i => contour[i] === f.a && contour[(i + 1) % contour.length] === f.b), 'façade ≠ arête du contour');
});

test('C11 — limites latérales de la parcelle réelle : 2 côtés (est : 4 arêtes ; ouest : 1 arête) ; le fond et le décroché nord-ouest ne sont pas latéraux', () => {
  const contour = COTE.anneaux[0];
  const segments = contour.map((a, i) => ({ a, b: contour[(i + 1) % contour.length] } as { a: PointLocal; b: PointLocal; voie?: boolean; laterale?: number }));
  assert.equal(marquerSegmentsLateraux(segments, segments.length, COTE.facades), 2);
  const rangs = (pred: (s: typeof segments[number]) => boolean) => segments.flatMap((s, i) => pred(s) ? [i] : []);
  assert.deepEqual(rangs(s => !!s.voie), VOIE);
  assert.deepEqual(rangs(s => s.laterale !== undefined).sort((a, b) => a - b), [...EST, ...OUEST].sort((a, b) => a - b));
  assert.deepEqual(rangs(s => !s.voie && s.laterale === undefined), [0, 1, 9, 10, 11].sort((a, b) => a - b));
  // Les deux côtés portent des numéros différents.
  assert.notEqual(segments[EST[0]].laterale, segments[OUEST[0]].laterale);
  assert.ok(EST.every(i => segments[i].laterale === segments[EST[0]].laterale));
  // Façade qui n'est pas une arête du contour : rien n'est marqué.
  const autres = contour.map((a, i) => ({ a, b: contour[(i + 1) % contour.length] } as { a: PointLocal; b: PointLocal; voie?: boolean; laterale?: number }));
  assert.equal(marquerSegmentsLateraux(autres, autres.length, [{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }]), 0);
  assert.ok(autres.every(s => s.laterale === undefined && !s.voie));
});

test('C11 — lateralesAdmises : une limite latérale est touchée, ou tenue au retrait ; jamais entre les deux', () => {
  assert.equal(lateralesAdmises([0, 0.01], 9), true);
  assert.equal(lateralesAdmises([0.04, 9], 9), true);
  assert.equal(lateralesAdmises([0, 8.99], 9), true, 'tolérance de 2 cm');
  assert.equal(lateralesAdmises([0, 6.65], 9), false, 'à 6,65 m : ni en limite ni à H/2');
  assert.equal(lateralesAdmises([0.2, 12], 9), false);
  assert.equal(lateralesAdmises([], 9), true);
  assert.equal(CONTACT_LIMITE_M, 0.05);
});

test('C11 — formule de recul : le minimum écrit APRÈS le nombre est lu (« H/2 et 3 mètres minimum »)', () => {
  assert.deepEqual(formuleRecul('en cas de retrait : H/2 et 3 mètres minimum'), { diviseur: 2, minimumM: 3 });
  assert.deepEqual(formuleRecul('en cas de retrait : H/2 min 3 m'), { diviseur: 2, minimumM: 3 });
  assert.deepEqual(formuleRecul('H/2'), { diviseur: 2, minimumM: null });
  assert.deepEqual(formuleRecul('H/3 minimum 4,5 m'), { diviseur: 3, minimumM: 4.5 });
  assert.deepEqual(formuleRecul('H/2 pour une hauteur de 12 m'), { diviseur: 2, minimumM: null }, '« 12 m » sans « minimum » n’est pas un minimum');
});

test('C11 — formule « H/2 et 3 mètres minimum », bâtiment de plain-pied (H = 3 m) : retrait de 3 m, et non plus 1,5 m', () => {
  const brut = sans('recul_voie_m').map(r => r.cle === 'recul_limites_m' ? { ...r, valeur: null, statut: 'manquant', alternatives: [] } : r);
  const rv = reglesVolume(lireRegles(brut), null, null);
  assert.deepEqual(rv.regles.filter(r => r.cle === 'recul_limites_formule').map(r => [r.valeur, r.minimumM]), [[2, 3]]);
  assert.equal(contraintesPlu(rv).reculPour(3), 3);
  assert.equal(contraintesPlu(rv).reculPour(18), 9);
  // Avant ce lot, la même règle donnait H/2 sans minimum : 1,5 m pour un rez-de-chaussée.
  assert.equal(contraintesPlu({ ...rv, regles: rv.regles.map(r => r.cle === 'recul_limites_formule' ? { ...r, minimumM: null } : r) }).reculPour(3), 1.5);
});

test('C11 — implantationDesRegles, règles de 17 h 01 : alignement retenu (voie non réglementée, citée), implantation en limite transmise (confirmée, citée)', () => {
  const i = implantationDesRegles(lireRegles(REGLES_17H01));
  assert.deepEqual([i.reculVoieM, i.motifVoie, i.sourceVoie], [0, 'non_reglementee', 'Règlement GPU — PLUi Est Ensemble, indice 9, p. 200']);
  assert.equal(i.note, 'Recul sur voie non réglementé (indice 9, p. 200) : alignement retenu ; le règlement demande de tenir compte de l’implantation des constructions voisines — à vérifier sur place.');
  assert.deepEqual([i.limiteSeparativePermise, i.sourceLimites], [true, 'Règlement GPU — PLUi Est Ensemble, indice 1, p. 214']);
  // Règle complémentaire d'une autre teneur : citée telle quelle, sans rien en déduire.
  const autre = implantationDesRegles(lireRegles(sans('recul_voie_m', { regle_relative: 'Les saillies sur le domaine public sont interdites.' })));
  assert.equal(autre.note, 'Recul sur voie non réglementé (indice 9, p. 200) : alignement retenu ; règle complémentaire non chiffrée du règlement : « Les saillies sur le domaine public sont interdites. » — à vérifier sur place.');
  // Limite permise mais règle sans article, ou estimée : non transmise.
  for (const r of [{ article: null }, { statut: 'estime' }]) {
    const x = implantationDesRegles(lireRegles(sans('recul_limites_m', r)));
    assert.equal(x.limiteSeparativePermise, false);
    assert.match(x.noteLimites!, /non appliquée, retrait conservé sur les limites séparatives\.$/);
  }
  // Valeur 0 sans l'option « sur limite » (forme que le lot C9 n'écrit pas) : rien n'est déduit.
  assert.equal(implantationDesRegles(lireRegles(sans('recul_limites_m', { alternatives: [] }))).limiteSeparativePermise, false);
});

test('C11 — Montreuil, règles EXACTES de 17 h 01, 30 logements : programme atteint dans la bande principale, vérifié sur une grille indépendante', () => {
  const v = volumeEnBande(REGLES_17H01, prog('30 logements collectifs'));
  assert.equal(v.bande?.statut, 'appliquee');
  assert.deepEqual([v.bande?.reculVoieM, v.bande?.reculLateralM, v.bande?.reculLimitesM, v.bande?.surfaceBandeM2], [0, 0, 9, 461]);
  // Une barre de 22,91 × 16 m (de limite latérale à limite latérale), R+5 : 366,6 m² d'emprise, 2 199 m² de SDP, 30 logements.
  assert.deepEqual(v.batiments!.map(b => [b.largeurM, b.profondeurM, b.niveaux, b.unites]), [[22.91, 16, 6, 30]]);
  assert.deepEqual([v.kpi!.empriseTotaleM2, v.niveaux, v.hauteurM, v.sdpM2, v.logementsEstimes, v.programmeAtteint, v.reculM], [367, 6, 18, 2199, 30, true, 9]);
  assert.deepEqual(v.alertes, []);
  // Grille indépendante : dans la parcelle, dans la bande de 18 m, emprise ≤ 368 m², hauteur ≤ 19,5 m et 6 niveaux,
  // contre les deux limites latérales, jamais contre le fond (retrait H/2 = 9 m au moins).
  const g = grille(v);
  assert.ok(g.emprise <= PLAFOND && g.emprise <= 0.8 * BANDES.bandePrincipaleM2, `emprise ${g.emprise}`);
  assert.ok(g.distanceMax <= 18, `distance max à la voie ${g.distanceMax}`);
  assert.ok(v.hauteurM <= 19.5 && v.niveaux <= 6);
  assert.ok(g.est <= CONTACT_LIMITE_M && g.ouest <= CONTACT_LIMITE_M, `limites latérales : est ${g.est.toFixed(3)} m, ouest ${g.ouest.toFixed(3)} m`);
  assert.ok(g.fond >= 9 - 0.02, `fond à ${g.fond.toFixed(2)} m pour 9 m`);
  assert.ok(g.voie >= 0 && g.voie < 1, `voie à ${g.voie.toFixed(2)} m`);
  assert.deepEqual([Math.round(g.voie * 100) / 100, Math.round(g.fond * 100) / 100, Math.round(g.distanceMax * 100) / 100, Math.round(g.emprise * 10) / 10], [0.75, 17.7, 16.75, 366.6]);
  // La mesure du moteur dit la même chose, et la preuve de bande tient.
  const m = mesurerReculsVolume(v)!;
  assert.deepEqual([m.voieM, m.limitesM], [0.75, 17.7]);
  assert.ok(m.laterales!.length === 1 && m.laterales![0].distancesM.every(d => d <= CONTACT_LIMITE_M));
  assert.equal(verifierBandeVolume(v).prouvee, true);
  // Hypothèses : alignement retenu (et pourquoi), limites latérales touchées, vide en biais dit, fond en retrait.
  assert.match(v.hypotheses[0], /^Côté voie : implantation à l’alignement \(recul 0 m\) RETENUE par le volume d’étude, le recul sur voie n’étant pas réglementé \(Règlement GPU — PLUi Est Ensemble, indice 9, p\. 200\) ; limites latérales \(celles qui partent de la voie\) : implantation en limite séparative permise par la règle lue \(Règlement GPU — PLUi Est Ensemble, indice 1, p\. 214\) — 2 sur 2 touchées par ce volume ; limite non parallèle au pignon : contact en un point, vide en biais jusqu’à 5,2 m à traiter au plan ; retrait de 9 m sur le fond de parcelle et sur toute limite latérale non touchée/);
  assert.ok(v.hypotheses.includes('Recul sur voie non réglementé (indice 9, p. 200) : alignement retenu ; le règlement demande de tenir compte de l’implantation des constructions voisines — à vérifier sur place.'));
  assert.ok(v.hypotheses.length <= 12, `${v.hypotheses.length} lignes : le résumé de la préparation en garde 12`);
  // Le stationnement n'est pas implanté : un seul bâtiment, aucune voie, et la règle est dite « non modélisée ».
  assert.deepEqual([v.batiments!.length, v.voies?.length ?? 0], [1, 0]);
});

test('C11 — Montreuil, mêmes règles : 40 logements (programme non atteint) → 31 logements, même barre ; 10 logements → un pignon en limite, l’autre au retrait', () => {
  const v40 = volumeEnBande(REGLES_17H01, prog('40 logements'));
  assert.deepEqual([v40.kpi!.empriseTotaleM2, v40.niveaux, v40.logementsEstimes, v40.programmeAtteint], [367, 6, 31, false]);
  assert.match(v40.alertes.join(' | '), /programme non atteint — 31 logements au plus \(6 niveaux, 1 bâtiment, dans la bande principale\)/);
  const g40 = grille(v40);
  assert.ok(g40.emprise <= PLAFOND && g40.fond >= 9 - 0.02 && g40.est <= CONTACT_LIMITE_M && g40.ouest <= CONTACT_LIMITE_M, JSON.stringify(g40));
  // 10 logements : R+2 (retrait H/2 = 4,5 m). Le bâtiment touche UNE limite latérale et tient l'autre à 4,5 m au moins.
  const v10 = volumeEnBande(REGLES_17H01, prog('10 logements'));
  assert.deepEqual([v10.niveaux, v10.logementsEstimes, v10.programmeAtteint, v10.bande?.reculLateralM, v10.reculM], [3, 10, true, 0, 4.5]);
  const g10 = grille(v10);
  const [pres, loin] = [Math.min(g10.est, g10.ouest), Math.max(g10.est, g10.ouest)];
  assert.ok(pres <= CONTACT_LIMITE_M && loin >= 4.5 - 0.02, `limites latérales à ${pres.toFixed(2)} m et ${loin.toFixed(2)} m`);
  assert.ok(g10.fond >= 4.5 - 0.02 && g10.emprise <= PLAFOND);
});

test('C11 — l’implantation en limite n’est utilisée que si le programme ne tient pas en retrait', () => {
  // 6 logements tiennent en retrait des limites (R+1) : même volume qu'avec une règle qui n'autorise pas la limite, et l'hypothèse le dit.
  const v = volumeEnBande(REGLES_17H01, prog('6 logements'));
  const retrait = volumeEnBande(sans('recul_limites_m', { valeur: 3, alternatives: [] }), prog('6 logements'));
  assert.equal(v.programmeAtteint, true);
  assert.equal(v.bande?.reculLateralM, undefined);
  assert.deepEqual(v.batiments, retrait.batiments);
  assert.ok(v.hypotheses.includes('Implantation en limite séparative permise selon la règle lue (Règlement GPU — PLUi Est Ensemble, indice 1, p. 214) : non utilisée dans ce volume d’étude, le programme tient en retrait des limites séparatives.'));
});

test('C11 — prudence inchangée : règle absente, estimée ou non citée → aucun alignement, aucune implantation en limite (mêmes bâtiments que sans ces règles)', () => {
  const p = prog('30 logements');
  const reference = volumeEnBande(sans('recul_voie_m').filter(r => r.cle !== 'recul_limites_m'), p);
  assert.equal(reference.bande?.reculVoieM, undefined);
  assert.equal(reference.bande?.reculLateralM, undefined);
  // Référence : recul uniforme H/2 (minimum 3 m) sur toutes les limites, côté voie compris — 13 × 13,5 m en R+2, 7 logements.
  assert.deepEqual(reference.batiments!.map(b => [b.largeurM, b.profondeurM, b.niveaux]), [[13, 13.5, 3]]);
  assert.deepEqual([reference.kpi!.empriseTotaleM2, reference.sdpM2, reference.logementsEstimes, reference.reculM], [176, 527, 7, 4.5]);
  const cas: [string, unknown[]][] = [
    ['voie et limites estimées', sans('recul_voie_m', { statut: 'estime' }).map(r => r.cle === 'recul_limites_m' ? { ...r, statut: 'estime' } : r)],
    ['voie et limites sans article', sans('recul_voie_m', { article: null }).map(r => r.cle === 'recul_limites_m' ? { ...r, article: null } : r)],
    ['voie manquante, limites estimées', sans('recul_voie_m', { statut: 'manquant' }).map(r => r.cle === 'recul_limites_m' ? { ...r, statut: 'estime' } : r)],
  ];
  for (const [nom, brut] of cas) {
    const v = volumeEnBande(brut, p);
    assert.deepEqual(v.batiments, reference.batiments, nom);
    assert.deepEqual([v.bande?.reculVoieM, v.bande?.reculLateralM, v.reculM], [undefined, undefined, 4.5], nom);
  }
  // Une seule des deux lectures est sûre : l'autre reste prudente.
  const voieSeule = volumeEnBande(REGLES_17H01.map(r => r.cle === 'recul_limites_m' ? { ...r, statut: 'estime' } : r), p);
  assert.deepEqual([voieSeule.bande?.reculVoieM, voieSeule.bande?.reculLateralM], [0, undefined]);
  assert.ok(voieSeule.hypotheses.some(h => /^Implantation en limite séparative lue mais non confirmée \(règle estimée\)/.test(h)));
  const limiteSeule = volumeEnBande(sans('recul_voie_m', { statut: 'estime' }), p);
  assert.deepEqual([limiteSeule.bande?.reculVoieM, limiteSeule.bande?.reculLateralM], [undefined, 0]);
  // Recul à la voie non établi : le retrait H/2 reste dû côté voie, mesuré sur la grille.
  const g = grille(limiteSeule);
  assert.ok(g.voie >= limiteSeule.reculM - 0.02 && g.fond >= limiteSeule.reculM - 0.02, JSON.stringify(g));
  assert.ok(Math.min(g.est, g.ouest) <= CONTACT_LIMITE_M || Math.min(g.est, g.ouest) >= limiteSeule.reculM - 0.02);
});

test('C11 — sans bande ni côté voie : l’implantation fournie est sans effet (reculsRetenus, contraintesPlu, volume)', () => {
  const rv = reglesVolume(lireRegles(REGLES_17H01), null, null);
  assert.equal(reculsRetenus(rv.regles, null).enLimite, false);
  assert.equal(contraintesPlu(rv).enLimite, false);
  const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), rv);
  assert.equal('bande' in v, false);
  // Calcul prudent : la note dit que l'implantation en limite n'est pas appliquée, et le recul reste uniforme.
  assert.match(rv.nonAppliquees.join(' | '), /recul_limites_m : 0 m \(implantation en limite séparative permise\) — non appliqué : le volume garde un retrait sur les limites séparatives/);
  assert.match(rv.nonAppliquees.join(' | '), /recul_voie_m : valeur non chiffrée/);
  assert.match(v.hypotheses[0], /sur toutes les limites/);
  // Côté voie NON identifié (voisines absentes) : bande refusée, même volume que sans bande.
  const coteVide = identifierCoteVoie(PARCELLE, []);
  const refuse = calculerVolumeProgramme(PARCELLE, prog('30 logements'), rv, { cote: coteVide, profondeurM: 18, empriseMaxM2: PLAFOND, implantation: implantationDesRegles(lireRegles(REGLES_17H01)) });
  assert.equal(refuse.bande?.statut, 'non-appliquee');
  assert.deepEqual(refuse.batiments, v.batiments);
});

test('C11 — volume unique (sans programme détaillé) : même implantation en limite, rectangle ancré aux deux limites', () => {
  const regles = lireRegles(REGLES_17H01);
  const rv = reglesVolume(regles, null, BANDES, { implantationDansBande: true });
  const b = { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND, implantation: implantationDesRegles(regles) };
  const v = calculerVolumeParcelle(PARCELLE, { logements: 30, libelle: null, origine: 'fiche' }, rv, b);
  assert.deepEqual([v.bande?.statut, v.bande?.reculVoieM, v.bande?.reculLateralM, v.niveaux, v.programmeAtteint], ['appliquee', 0, 0, 6, true]);
  assert.deepEqual([v.emprise!.largeurM, v.emprise!.profondeurM], [22.91, 16]);
  const g = grille(v);
  assert.ok(g.emprise <= PLAFOND && g.fond >= 9 - 0.02 && g.est <= CONTACT_LIMITE_M && g.ouest <= CONTACT_LIMITE_M && g.distanceMax <= 18, JSON.stringify(g));
});

test('C11 — contrôles sur le volume de 17 h 01 : voie, limites (en limite ou en retrait), pleine terre par bande dite « non contrôlée par le moteur »', () => {
  const v = volumeEnBande(REGLES_17H01, prog('30 logements'));
  const c = Object.fromEntries(controlerVolume(v, lireRegles(REGLES_17H01), v.logementsEstimes).map(x => [x.cle, x]));
  assert.equal(c.recul_voie_m.verdict, 'a_verifier', 'la règle complémentaire (constructions voisines) n’est pas vérifiable par le calcul');
  assert.match(c.recul_voie_m.explication, /Le volume d’étude retient l’implantation à l’alignement \(0,75 m mesuré côté voie\)\. Règle complémentaire non chiffrée, non vérifiée par le calcul : « L'implantation des constructions doit prendre en compte l'implantation des constructions voisines/);
  assert.equal(c.recul_limites_m.verdict, 'a_verifier');
  assert.equal(c.recul_limites_m.valeur_volume, '2 limites latérales touchées sur 2, 17,7 m du fond de parcelle et des autres limites (mesuré)');
  assert.match(c.recul_limites_m.regle!, /^en limite séparative ou en retrait \(en cas de retrait : H\/2 et 3 mètres minimum, soit 9 m pour ≈ 18 m\)/);
  assert.match(c.recul_limites_m.explication, /vide en biais jusqu’à 5,18 m, à traiter au plan/);
  // Pleine terre : 461 − 366,6 = 94 m² non bâtis dans la bande principale (20,5 % pour 15 %) ; bande secondaire non construite.
  assert.equal(c.pleine_terre_min_pct.verdict, 'a_verifier');
  assert.equal(c.pleine_terre_min_pct.valeur_volume, '≤ 20,5 % non bâti dans la bande principale (94 m² sur 461 m²) ; bande secondaire non construite (355 m²)');
  assert.match(c.pleine_terre_min_pct.explication, /^Pleine terre par bande : NON contrôlée par le moteur de volume\. .* Surface non bâtie n’est pas pleine terre/);
  const rv = reglesVolume(lireRegles(REGLES_17H01), null, BANDES, { implantationDansBande: true });
  assert.ok(rv.nonAppliquees.some(l => /^Règle par bande, pleine terre \(bande principale de 18 m depuis la voie : 15 % ; bande secondaire : 50 %\) — NON contrôlée bande par bande par le moteur de volume/.test(l)));
  assert.ok(rv.nonAppliquees.some(l => /^recul_voie_m : non réglementé \(Règlement GPU — PLUi Est Ensemble, indice 9, p\. 200\) — aucune valeur chiffrée ; alignement retenu côté voie dans la bande principale/.test(l)));
  assert.ok(rv.nonAppliquees.some(l => /^Stationnement : 0\.5 place\(s\)\/logement .* non modélisé dans le volume$/.test(l)));
  // Volume modifié dans la fiche : le bâtiment décollé de 3 m d'une limite latérale (ni en limite, ni à 9 m) → « au-delà ».
  const b = v.batiments![0];
  const a = b.angleDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
  const raccourci = (sens: 1 | -1): VolumePropose => ({ ...v, batiments: [{ ...b, largeurM: b.largeurM - 3,
    coins: b.coins.map((q, i) => ((sens === 1 ? [0, 3] : [1, 2]).includes(i) ? { x: q.x + sens * 3 * ux, y: q.y + sens * 3 * uy } : q)) }] });
  for (const s of [1, -1] as const) {
    const x = controlerVolume(raccourci(s), lireRegles(REGLES_17H01), 30).find(k => k.cle === 'recul_limites_m')!;
    assert.equal(x.verdict, 'au_dela', x.explication);
    assert.match(x.explication, /ni en limite ni au retrait de 9 m/);
  }
});

test('C11 — côté voie par portions : une arête EN PARTIE mitoyenne n’est plus une façade sur toute sa longueur ; le moteur garde alors le recul uniforme', () => {
  const LAT = 48.87, LON = 2.18, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
  const poly = (pts: number[][]): GeometrieParcelle => { const r = pts.map(([x, y]) => [LON + x / KX, LAT + y / 111_320]); return { type: 'Polygon', coordinates: [[...r, r[0]]] }; };
  const parcelle = poly([[0, 0], [40, 0], [40, 30], [0, 30]]);
  const autour = [poly([[-50, 0], [0, 0], [0, 30], [-50, 30]]), poly([[40, 0], [90, 0], [90, 30], [40, 30]]), poly([[-50, 30], [90, 30], [90, 60], [-50, 60]])];
  // Arête sud entièrement libre : une façade de 40 m, de sommet à sommet (comme avant).
  const libre = identifierCoteVoie(parcelle, autour);
  assert.deepEqual([libre.statut, libre.longueurFacadeM, libre.facades.length], ['identifie', 40, 1]);
  // Une voisine borde les 10 premiers mètres de l'arête sud : la façade ne couvre plus que la portion libre (au pas de sondage près).
  const partielle = identifierCoteVoie(parcelle, [...autour, poly([[0, -20], [10, -20], [10, 0], [0, 0]])]);
  assert.equal(partielle.statut, 'identifie');
  assert.equal(partielle.facades.length, 1);
  assert.ok(partielle.longueurFacadeM >= 29 && partielle.longueurFacadeM <= 30, `${partielle.longueurFacadeM} m`);
  const xs = partielle.facades[0], x0 = Math.min(xs.a.x, xs.b.x) + 20;   // repère de la parcelle : origine au centre
  assert.ok(x0 >= 10 - 0.01 && x0 <= 10.5 + 0.01, `la façade commence à ${x0.toFixed(2)} m, après la portion mitoyenne`);
  // Portion libre ENTRE deux points de l'ancien sondage (10 m, 20 m, 30 m) : vue maintenant.
  const cachee = identifierCoteVoie(parcelle, [...autour, poly([[0, -20], [12, -20], [12, 0], [0, 0]]), poly([[18, -20], [40, -20], [40, 0], [18, 0]])]);
  assert.equal(cachee.statut, 'identifie');
  assert.ok(cachee.longueurFacadeM >= 5 && cachee.longueurFacadeM <= 6, `${cachee.longueurFacadeM} m libres entre 12 et 18 m`);
  // Avec une façade partielle, le recul différencié et l'implantation en limite ne s'appliquent pas : recul uniforme, et aucun bâtiment contre la portion mitoyenne.
  const rv = { source: 'plu-chiffre' as const, regles: [{ cle: 'recul_limites_formule' as const, valeur: 2, minimumM: 3, source: 'PLU', statut: 'lue' as const }], nonAppliquees: [] };
  const v = calculerVolumeProgramme(parcelle, prog('20 logements'), rv, { cote: partielle, profondeurM: 18, empriseMaxM2: null, implantation: { reculVoieM: 0, motifVoie: 'non_reglementee', limiteSeparativePermise: true } });
  assert.deepEqual([v.bande?.reculVoieM, v.bande?.reculLateralM], [undefined, undefined]);
  const corps = v.batiments ?? [];
  assert.ok(corps.length > 0);
  for (const b of corps) for (const q of b.coins) assert.ok(q.y + 15 >= v.reculM - 0.02 && q.x + 20 >= v.reculM - 0.02 && 20 - q.x >= v.reculM - 0.02, `coin à moins de ${v.reculM} m d’une limite : ${JSON.stringify(q)}`);
});

test('C11 — 120 parcelles tirées, implantation en limite permise : chaque bâtiment est dans la parcelle et dans la bande, touche une limite latérale ou la tient au retrait, jamais le fond', () => {
  const LAT = 48.87, LON = 2.18, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
  const poly = (pts: number[][], rot: number): GeometrieParcelle => { const a = rot * Math.PI / 180; const r = pts.map(([x, y]) => [LON + (x * Math.cos(a) - y * Math.sin(a)) / KX, LAT + (x * Math.sin(a) + y * Math.cos(a)) / 111_320]); return { type: 'Polygon', coordinates: [[...r, r[0]]] }; };
  let graine = 1110; const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 2 ** 32; };
  let enLimite = 0, contacts = 0;
  for (let k = 0; k < 120; k++) {
    const l = 14 + alea() * 50, h = 22 + alea() * 50, rot = alea() * 180, b1 = (alea() - 0.5) * 10, b2 = (alea() - 0.5) * 10;
    const g = poly([[0, 0], [l, 0], [l + b1, h], [b2, h]], rot);
    const cote = identifierCoteVoie(g, [poly([[-80, 0], [0, 0], [b2, h], [-80, h]], rot), poly([[l, 0], [l + 80, 0], [l + 80, h], [l + b1, h]], rot), poly([[-80, h], [l + 80, h], [l + 80, h + 40], [-80, h + 40]], rot)]);
    const hauteur = 9 + Math.floor(alea() * 4) * 3;
    const rv = { source: 'plu-chiffre' as const, nonAppliquees: [], regles: [
      { cle: 'hauteur_max_m' as const, valeur: hauteur, source: 'PLU', statut: 'lue' as const }, { cle: 'recul_limites_formule' as const, valeur: 2, minimumM: 3, source: 'PLU', statut: 'lue' as const }] };
    const D = [15, 18, 20][Math.floor(alea() * 3)];
    const v = calculerVolumeProgramme(g, prog(['20 logements', '45 logements', '90 logements'][Math.floor(alea() * 3)]), rv,
      { cote, profondeurM: D, empriseMaxM2: Math.round(l * D * 0.8), implantation: { reculVoieM: alea() < 0.7 ? 0 : null, limiteSeparativePermise: true } });
    if (v.bande?.reculLateralM !== 0) continue;
    enLimite++;
    const contour = cote.anneaux[0];
    // Contour : 0 = voie (sud), 1 = latérale, 2 = fond, 3 = latérale (ordre de construction du trapèze).
    const seg = (i: number): [PointLocal, PointLocal] => [contour[i], contour[(i + 1) % 4]];
    for (const b of v.batiments!) {
      const exige = Math.max(3, b.hauteurM / 2);
      const [c0, c1, c2, c3] = b.coins, centre = { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 };
      const min = [Infinity, Infinity, Infinity, Infinity];
      const nu = Math.ceil(b.largeurM / 0.5), nv = Math.ceil(b.profondeurM / 0.5);
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
        const p = { x: c0.x + (c1.x - c0.x) * i / nu + (c3.x - c0.x) * j / nv, y: c0.y + (c1.y - c0.y) * i / nu + (c3.y - c0.y) * j / nv };
        const dc = Math.hypot(centre.x - p.x, centre.y - p.y) || 1;
        assert.ok(dansPolygone(cote.anneaux, p.x + (centre.x - p.x) * 0.02 / dc, p.y + (centre.y - p.y) * 0.02 / dc), `tirage ${k} : point hors parcelle`);
        assert.ok(distanceALaVoie(p, cote) <= D + 1e-6, `tirage ${k} : point hors bande`);
        for (let s = 0; s < 4; s++) min[s] = Math.min(min[s], distancePointSegment(p, ...seg(s)));
      }
      assert.ok(min[2] >= exige - 0.02, `tirage ${k} : fond à ${min[2].toFixed(2)} m pour ${exige} m`);
      for (const s of [1, 3]) {
        assert.ok(min[s] <= CONTACT_LIMITE_M + 1e-6 || min[s] >= exige - 0.02, `tirage ${k} : limite latérale à ${min[s].toFixed(2)} m (ni en limite, ni à ${exige} m)`);
        if (min[s] <= CONTACT_LIMITE_M + 1e-6) contacts++;
      }
      assert.ok(min[0] >= (v.bande!.reculVoieM ?? exige) - 0.02, `tirage ${k} : voie à ${min[0].toFixed(2)} m`);
    }
  }
  assert.ok(enLimite >= 30 && contacts >= 30, `${enLimite} volumes en limite, ${contacts} contacts`);
});
