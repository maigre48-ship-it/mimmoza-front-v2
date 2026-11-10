// node --test src/spaces/copilot/studio3d/reculVoie.test.ts
// Lot C10 :
//   A. fiche « Dossier 3D » du site : une règle PAR BANDE suit le plafond prudent du serveur (reglesPlu.ts),
//      formes et contrôle de hauteur dits selon l'état réel de la bande ;
//   B. recul différencié voie / limites quand le côté voie est identifié, alignement seulement s'il est LU ;
//   C. plafond d'emprise strict (le moteur ne dépasse plus le plafond qu'il affiche) ;
//   D. hauteur, niveaux, pleine terre les plus contraignants des bandes quand la bande n'est pas appliquée.
// Fixture : géométries RÉELLES du cadastre (parcelle 93048000AS0249, 98 rue de Paris, Montreuil, lot C7a).
// Règles : celles réellement lues à l'essai 5 du 10/11/2026 (lot-2a-temoin/RESULTATS.md) ; toute valeur qui
// n'a PAS été lue à Montreuil est marquée « VALEUR D’ESSAI » dans sa source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculerVolumeProgramme, contraintesPlu } from './implantationProgramme.ts';
import { calculerVolumeParcelle, dansPolygone, reculsRetenus, type BandeVoie, type GeometrieParcelle, type PointLocal, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume, type VolumePropose } from './volumeParcelle.ts';
import { marquerSegmentsVoie, mesurerReculsVolume, verifierBandeVolume } from './bandePrincipale.ts';
import { distanceALaVoie, distancePointSegment, empriseMaxParBande, identifierCoteVoie, mesurerBandes, type CoteVoie } from './coteVoie.ts';
import { controlerVolume, implantationDesRegles, limiteSelonBande, lireRegles, reglesVolume } from './controlesVolume.ts';
import { lotsReglesDesMessages, reglesPourParcelle } from './reglesPlu.ts';
import { comparerFormes, contexteForme, controleHauteurStudio, evaluerSaisie, saisieDepuisVolume, type PreparationFiche } from './ficheDimensions.ts';
import { placerForme } from './formesBatiment.ts';
import { programmeBatiDepuisTexte } from './programmeBati.ts';

const lire = (nom: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${nom}`, import.meta.url), 'utf8'));
const cadastre = lire('cadastre-93048000AS0249.json');
const IDU = '93048000AS0249';
const PARCELLE: GeometrieParcelle = cadastre.parcelle.geometry;
const VOISINES: GeometrieParcelle[] = cadastre.voisines.map((v: { geometry: GeometrieParcelle }) => v.geometry);
const COTE = identifierCoteVoie(PARCELLE, VOISINES);
const BANDES = mesurerBandes(COTE, 18)!;
const PLAFOND = empriseMaxParBande(BANDES, 80, null)!.principaleM2;
const prog = (texte: string): ProgrammeVolume => ({ ...programmeBatiDepuisTexte(texte)!, origine: 'fiche' });

// ── Règles de Montreuil ───────────────────────────────────────────────────────────────────────────
const SRC = 'Règlement GPU — PLUi Est Ensemble';
const bande = (principale: number, secondaire: number) => [{ libelle: 'bande principale (18 m)', valeur: principale }, { libelle: 'bande secondaire', valeur: secondaire }];
/** Règles par bande telles que le lot C6 les enregistre (indices J et b2). */
const PAR_BANDE = [
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(80, 20) },
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(19.5, 13.5) },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(6, 4) },
  { cle: 'pleine_terre_min_pct', valeur: 15, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(15, 50) },
];
/** Essai 5 : « Recul sur voie : non réglementé (indice 9, p. 200) — Il n'est pas fixé de règle ». AUCUNE valeur chiffrée lue. */
const VOIE_LUE = { cle: 'recul_voie_m', valeur: null, statut: 'confirme', source: SRC, article: 'indice 9, p. 200', nature: 'non_reglementee', texte: 'Il n’est pas fixé de règle' };
/** Essai 5 : « Recul aux limites : 3 m (indice 1, p. 214) » et « Formule de recul : H/2 (indice 1) ». */
const LIMITES_LUES = [
  { cle: 'recul_limites_m', valeur: 3, statut: 'confirme', source: SRC, article: 'indice 1, p. 214' },
  { cle: 'recul_limites_formule', valeur: 'H/2', statut: 'confirme', source: SRC, article: 'indice 1, p. 214' },
];
/** N'A PAS été lue à Montreuil : sert à montrer ce que donnerait un alignement écrit dans le règlement. */
const VOIE_ESSAI_ALIGNEMENT = { cle: 'recul_voie_m', valeur: 0, statut: 'confirme', source: 'VALEUR D’ESSAI (non lue à Montreuil)', article: 'essai', nature: 'chiffree' };
const REGLES_LUES = [...PAR_BANDE, VOIE_LUE, ...LIMITES_LUES];
const REGLES_ESSAI = [...PAR_BANDE, VOIE_ESSAI_ALIGNEMENT, ...LIMITES_LUES];

/** Volume du serveur pour ces règles : règles avec bandes mesurées, bande + implantation tirée des règles lues. */
function volumeEnBande(brut: unknown[], programme: ProgrammeVolume, parcelle = PARCELLE, cote = COTE, bandes = BANDES, plafond: number | null = PLAFOND): VolumePropose {
  const regles = lireRegles(brut);
  const rv = reglesVolume(regles, null, bandes, { implantationDansBande: true });
  return calculerVolumeProgramme(parcelle, programme, rv, { cote, profondeurM: bandes.profondeurM, empriseMaxM2: plafond, implantation: implantationDesRegles(regles) });
}

/**
 * Vérification GÉOMÉTRIQUE indépendante du moteur (aucune fonction du placement n'est réutilisée). Pour CHAQUE
 * bâtiment, ses sommets et une grille de 0,25 m : dans la parcelle ; à ≥ `reculVoieM` de chaque limite SUR VOIE
 * et à ≥ `reculLimitesM` de chaque AUTRE limite (limites sur voie reconnues ici par leurs extrémités, comparées à
 * celles de identifierCoteVoie) ; à ≤ `profondeurM` de la voie. Rend les distances extrêmes et l'emprise.
 */
function verifierGrille(v: VolumePropose, cote: CoteVoie, o: { reculVoieM: number; reculLimitesM: number; profondeurM: number | null }) {
  const corps = v.batiments?.length ? v.batiments : v.emprise ? [v.emprise] : [];
  assert.ok(corps.length > 0, 'aucun bâtiment');
  const contour = cote.anneaux[0];
  const meme = (p: PointLocal, q: PointLocal) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  const surVoie = contour.map((a, i) => { const b = contour[(i + 1) % contour.length]; return cote.facades.some(f => (meme(f.a, a) && meme(f.b, b)) || (meme(f.a, b) && meme(f.b, a))); });
  assert.equal(surVoie.filter(Boolean).length, cote.facades.length, 'chaque façade sur voie est une arête du contour');
  let minVoie = Infinity, minLimites = Infinity, distanceMax = 0, emprise = 0, points = 0;
  for (const b of corps) {
    const [c0, c1, c2, c3] = b.coins;
    assert.ok(Math.abs(Math.hypot(c1.x - c0.x, c1.y - c0.y) - b.largeurM) < 0.02 && Math.abs(Math.hypot(c3.x - c0.x, c3.y - c0.y) - b.profondeurM) < 0.02, 'coins ≠ largeur × profondeur');
    emprise += b.largeurM * b.profondeurM;
    const centre = { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 };
    const nu = Math.ceil(b.largeurM / 0.25), nv = Math.ceil(b.profondeurM / 0.25);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p: PointLocal = { x: c0.x + (c1.x - c0.x) * i / nu + (c3.x - c0.x) * j / nv, y: c0.y + (c1.y - c0.y) * i / nu + (c3.y - c0.y) * j / nv };
      const q = { x: p.x + (centre.x - p.x) * 1e-4, y: p.y + (centre.y - p.y) * 1e-4 };
      assert.ok(dansPolygone(cote.anneaux, q.x, q.y), `point hors parcelle : ${JSON.stringify(p)}`);
      for (let s = 0; s < contour.length; s++) {
        const d = distancePointSegment(p, contour[s], contour[(s + 1) % contour.length]);
        if (surVoie[s]) minVoie = Math.min(minVoie, d); else minLimites = Math.min(minLimites, d);
      }
      const dv = distanceALaVoie(p, cote);
      if (o.profondeurM !== null) assert.ok(dv <= o.profondeurM + 1e-6, `point hors bande (${dv.toFixed(3)} m de la voie)`);
      distanceMax = Math.max(distanceMax, dv);
      points++;
    }
  }
  assert.ok(minVoie >= o.reculVoieM - 0.02, `bâtiment à ${minVoie.toFixed(3)} m du côté voie pour ${o.reculVoieM} m`);
  assert.ok(minLimites >= o.reculLimitesM - 0.02, `bâtiment à ${minLimites.toFixed(3)} m d’une limite séparative pour ${o.reculLimitesM} m`);
  return { minVoie, minLimites, distanceMax, emprise, points, batiments: corps.length };
}
const empriseDe = (v: VolumePropose) => (v.batiments?.length ? v.batiments : v.emprise ? [v.emprise] : []).reduce((s, b) => s + b.largeurM * b.profondeurM, 0);
/** Parcelles d'essai (dites comme telles) : polygone en mètres autour d'un point fixe, tourné de `rot` degrés. */
const LAT = 48.87, LON = 2.18, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
const polygone = (points: number[][], rot = 0): GeometrieParcelle => {
  const a = rot * Math.PI / 180;
  const ring = points.map(([x, y]) => [LON + (x * Math.cos(a) - y * Math.sin(a)) / KX, LAT + (x * Math.sin(a) + y * Math.cos(a)) / 111_320]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
};
/** Rectangle l × h, voie au sud (côté y = 0), trois voisines : côté voie identifié par le cadastre d'essai. */
const rectangleSurVoie = (l: number, h: number) => {
  const g = polygone([[0, 0], [l, 0], [l, h], [0, h]]);
  const cote = identifierCoteVoie(g, [polygone([[-30, 0], [0, 0], [0, h], [-30, h]]), polygone([[l, 0], [l + 30, 0], [l + 30, h], [l, h]]), polygone([[-30, h], [l + 30, h], [l + 30, h + 30], [-30, h + 30]])]);
  assert.equal(cote.statut, 'identifie');
  return { g, cote };
};
const regle = (cle: ReglePlu['cle'], valeur: number, extra: Partial<ReglePlu> = {}): ReglePlu => ({ cle, valeur, source: 'PLU d’essai', reference: 'art.', statut: 'lue', ...extra });

// ══════════════════════════ B. Recul différencié voie / limites ══════════════════════════

test('B — implantationDesRegles : l’alignement n’est retenu que pour un recul à la voie LU à 0 m ou « non réglementé », confirmé et cité', () => {
  // Lot C11 (décision du 10/11/2026) — Montreuil, essai 5 : voie « non réglementée », confirmée et citée → alignement RETENU, et la note le dit.
  const lues = implantationDesRegles(lireRegles(REGLES_LUES));
  assert.equal(lues.reculVoieM, 0);
  assert.equal(lues.motifVoie, 'non_reglementee');
  assert.equal(lues.limiteSeparativePermise, false);
  assert.equal(lues.note, 'Recul sur voie non réglementé (indice 9, p. 200) : alignement retenu ; aucune règle complémentaire lue ; implantation réelle à vérifier sur place.');
  // « Non réglementé » seulement estimé, ou confirmé sans article : rien n'est établi (comportement prudent du lot C10).
  for (const [r, motif] of [[{ ...VOIE_LUE, statut: 'estime' }, /règle non confirmée \(estimée\) — alignement non supposé, recul prudent conservé côté voie\.$/], [{ ...VOIE_LUE, article: null }, /règle sans article cité — alignement non supposé/]] as const) {
    const i = implantationDesRegles(lireRegles([r]));
    assert.equal(i.reculVoieM, null);
    assert.match(i.note!, motif);
  }
  // Règle absente.
  assert.deepEqual(implantationDesRegles(lireRegles(PAR_BANDE)), { reculVoieM: null, sourceVoie: null, limiteSeparativePermise: false, note: 'Recul à la voie : règle non lue — alignement non supposé, recul prudent conservé côté voie.' });
  // 0 m seulement ESTIMÉ, ou confirmé sans article : non retenu.
  const estimee = implantationDesRegles(lireRegles([{ cle: 'recul_voie_m', valeur: 0, statut: 'estime', source: 'saisie', article: 'UA 6' }]));
  assert.equal(estimee.reculVoieM, null);
  assert.match(estimee.note!, /0 m \(alignement\) non confirmé \(règle estimée\)/);
  assert.equal(implantationDesRegles(lireRegles([{ cle: 'recul_voie_m', valeur: 0, statut: 'confirme', source: 'PLU' }])).reculVoieM, null);
  // 0 m lu, confirmé, cité (ex. « à l'alignement ou en recul de 4 m », lot Q3) : alignement retenu, avec sa source.
  const lu = implantationDesRegles(lireRegles([{ cle: 'recul_voie_m', valeur: 0, statut: 'confirme', source: 'PLU de Nanterre', article: 'UC 6-1', nature: 'alternative', alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }] }]));
  assert.deepEqual(lu, { reculVoieM: 0, sourceVoie: 'PLU de Nanterre, UC 6-1', limiteSeparativePermise: false, note: null, motifVoie: 'regle' });
  // Recul POSITIF : il passe par les règles du volume (reglesVolume), pas par l'implantation.
  assert.equal(implantationDesRegles(lireRegles([{ cle: 'recul_voie_m', valeur: 5, statut: 'confirme', source: 'PLU', article: 'UA 6' }])).reculVoieM, null);
  // Présentation du lot C9 (« sur limite séparative ou en retrait ») : signalée, jamais déduite d'autre chose.
  const c9 = implantationDesRegles(lireRegles([{ cle: 'recul_limites_m', valeur: 0, statut: 'confirme', source: SRC, article: 'indice 1, p. 208', nature: 'alternative',
    alternatives: [{ libelle: 'sur limite séparative', valeur: 0 }, { libelle: 'en retrait, minimum cité', valeur: 3 }] }]));
  assert.equal(c9.limiteSeparativePermise, true);
  assert.equal(c9.sourceLimites, 'Règlement GPU — PLUi Est Ensemble, indice 1, p. 208');
  assert.equal(implantationDesRegles(lireRegles(LIMITES_LUES)).limiteSeparativePermise, false);
  // Lot C11 : la même lecture seulement ESTIMÉE, ou sans article → non transmise au moteur, et la raison est dite.
  const c9estimee = implantationDesRegles(lireRegles([{ cle: 'recul_limites_m', valeur: 0, statut: 'estime', source: SRC, article: 'indice 1, p. 208', nature: 'alternative',
    alternatives: [{ libelle: 'sur limite séparative', valeur: 0 }, { libelle: 'en retrait, minimum cité', valeur: 3 }] }]));
  assert.equal(c9estimee.limiteSeparativePermise, false);
  assert.match(c9estimee.noteLimites!, /^Implantation en limite séparative lue mais non confirmée \(règle estimée\) .* non appliquée, retrait conservé/);
});

test('B — reculsRetenus : hors bande aucun recul différencié ; dans la bande, voie établie par une règle chiffrée ou par l’implantation lue', () => {
  const regles = [regle('recul_voie_m', 5), regle('recul_limites_m', 3), regle('recul_limites_formule', 2, { minimumM: 3 })];
  const hors = reculsRetenus(regles, null);
  assert.equal(hors.voieM, null);
  assert.equal(hors.uniformePour(12), 6);                          // max(5, 3, 12/2) : le calcul d'origine
  const dans = reculsRetenus(regles, { reculVoieM: null });
  assert.equal(dans.voieM, 5);
  assert.equal(dans.origineVoie, 'regle');
  assert.equal(dans.limitesPour(12), 6);
  assert.equal(dans.limitesPour(3), 3);                            // le recul à la voie (5 m) ne pèse plus sur les autres limites
  // Alignement lu ET règle chiffrée de 5 m : le plus fort des deux (jamais moins que ce qui est lu).
  assert.equal(reculsRetenus(regles, { reculVoieM: 0 }).voieM, 5);
  // Alignement lu, aucun recul aux limites lu : 4 m par défaut ailleurs.
  const aligne = reculsRetenus([], { reculVoieM: 0 });
  assert.deepEqual([aligne.voieM, aligne.origineVoie, aligne.limitesLues, aligne.limitesPour(18)], [0, 'implantation', false, 4]);
  // Rien d'établi côté voie : pas de différenciation.
  assert.equal(reculsRetenus([regle('recul_limites_m', 3)], { reculVoieM: null }).voieM, null);
});

test('B — Montreuil, règles de l’essai 5 (voie « non réglementée », limites 3 m + H/2) : alignement retenu côté voie (lot C11), H/2 aux autres limites', () => {
  for (const n of [30, 40]) {
    const v = volumeEnBande(REGLES_LUES, prog(`${n} logements`));
    assert.equal(v.bande?.statut, 'appliquee');
    // Lot C11 : « non réglementé », confirmé et cité → alignement retenu. Aucune implantation en limite dans ces règles (3 m lus comme un minimum).
    assert.equal(v.bande?.reculVoieM, 0);
    assert.equal(v.bande?.reculLateralM, undefined);
    assert.match(v.hypotheses[0], /^Côté voie : implantation à l’alignement \(recul 0 m\) RETENUE par le volume d’étude, le recul sur voie n’étant pas réglementé \(Règlement GPU — PLUi Est Ensemble, indice 9, p\. 200\) ; recul de 6 m aux autres limites/);
    assert.ok(v.hypotheses.includes('Recul sur voie non réglementé (indice 9, p. 200) : alignement retenu ; aucune règle complémentaire lue ; implantation réelle à vérifier sur place.'));
    // Mêmes bâtiments qu'avec la valeur d'essai « alignement lu » du lot C10 : 10,5 × 16 m, R+3, 9 logements.
    const essai = volumeEnBande(REGLES_ESSAI, prog(`${n} logements`));
    assert.deepEqual(v.batiments, essai.batiments);
    assert.deepEqual(v.batiments!.map(b => [b.largeurM, b.profondeurM, b.niveaux]), [[10.5, 16, 4]]);
    assert.deepEqual([v.kpi!.empriseTotaleM2, v.sdpM2, v.logementsEstimes, v.reculM], [168, 672, 9, 6]);
    const g = verifierGrille(v, COTE, { reculVoieM: 0, reculLimitesM: 6, profondeurM: 18 });
    assert.ok(g.emprise <= PLAFOND && g.minVoie < 0.5, JSON.stringify(g));
    // Sans implantation fournie (bande seule) : recul uniforme d'origine du lot C10, 13 × 13,5 m en R+2 — le comportement prudent n'a pas changé.
    const rv = reglesVolume(lireRegles(REGLES_LUES), null, BANDES, { implantationDansBande: true });
    const sans = calculerVolumeProgramme(PARCELLE, prog(`${n} logements`), rv, { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND });
    assert.deepEqual(sans.batiments!.map(b => [b.largeurM, b.profondeurM, b.niveaux]), [[13, 13.5, 3]]);
    assert.deepEqual([sans.kpi!.empriseTotaleM2, sans.sdpM2, sans.logementsEstimes, sans.reculM], [176, 527, 7, 4.5]);
    assert.equal(sans.bande?.reculVoieM, undefined);
  }
});

test('B — Montreuil, VALEUR D’ESSAI (alignement supposé lu) : 0 m côté voie, H/2 aux autres limites, vérifié sur une grille indépendante', () => {
  for (const n of [30, 40]) {
    const v = volumeEnBande(REGLES_ESSAI, prog(`${n} logements`));
    assert.equal(v.bande?.statut, 'appliquee');
    assert.equal(v.bande?.reculVoieM, 0);
    assert.equal(v.bande?.reculLimitesM, v.reculM);
    // Chiffres obtenus : 10,5 × 16 m = 168 m², R+3, 672 m² de SDP, 9 logements (H/2 = 6 m aux limites latérales).
    assert.deepEqual(v.batiments!.map(b => [b.largeurM, b.profondeurM, b.niveaux]), [[10.5, 16, 4]]);
    assert.deepEqual([v.sdpM2, v.logementsEstimes, v.reculM], [672, 9, 6]);
    const g = verifierGrille(v, COTE, { reculVoieM: 0, reculLimitesM: 6, profondeurM: 18 });
    assert.ok(g.minVoie < 0.5, `le bâtiment vient à l’alignement (${g.minVoie.toFixed(2)} m de la voie)`);
    assert.ok(g.emprise <= PLAFOND + 1e-6);
    assert.equal(verifierBandeVolume(v).prouvee, true);
    assert.match(v.hypotheses[0], /^Côté voie : implantation à l’alignement \(recul 0 m\), permise par la règle lue \(VALEUR D’ESSAI \(non lue à Montreuil\), essai\) ; recul de 6 m aux autres limites : le plus fort des reculs aux limites séparatives lus pour cette hauteur\. Reculs différenciés : le côté voie est présumé d’après le cadastre/);
    // La mesure du module (indépendante du placement) concorde avec la grille.
    const m = mesurerReculsVolume(v)!;
    assert.ok(Math.abs(m.voieM - g.minVoie) < 0.02 && Math.abs(m.limitesM! - g.minLimites) < 0.02, JSON.stringify({ m, g }));
  }
});

test('B — Montreuil, VALEUR D’ESSAI sans recul aux limites lu : alignement côté voie, 4 m par défaut ailleurs (232 m² au lieu de 196 m²)', () => {
  const sans = volumeEnBande(PAR_BANDE, prog('30 logements'));
  assert.deepEqual([empriseDe(sans), sans.niveaux, sans.reculM, sans.bande?.reculVoieM], [196, 6, 4, undefined]);   // résultat du lot C7c, inchangé
  verifierGrille(sans, COTE, { reculVoieM: 4, reculLimitesM: 4, profondeurM: 18 });
  const v = volumeEnBande([...PAR_BANDE, VOIE_ESSAI_ALIGNEMENT], prog('30 logements'));
  assert.deepEqual(v.batiments!.map(b => [b.largeurM, b.profondeurM, b.niveaux]), [[14.5, 16, 6]]);
  assert.deepEqual([empriseDe(v), v.sdpM2, v.logementsEstimes, v.reculM, v.bande?.reculVoieM], [232, 1392, 19, 4, 0]);
  verifierGrille(v, COTE, { reculVoieM: 0, reculLimitesM: 4, profondeurM: 18 });
  assert.match(v.hypotheses[0], /recul de 4 m aux autres limites \(valeur par défaut : recul aux limites séparatives non lu\)/);
});

test('B — « implantation en limite séparative permise » : APPLIQUÉE aux limites latérales depuis le lot C11 (détail dans implantationLimite.test.ts)', () => {
  const regles = lireRegles(REGLES_ESSAI);
  const rv = reglesVolume(regles, null, BANDES, { implantationDansBande: true });
  const base: BandeVoie = { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND, implantation: implantationDesRegles(regles) };
  const sans = calculerVolumeProgramme(PARCELLE, prog('30 logements'), rv, base);
  const avec = calculerVolumeProgramme(PARCELLE, prog('30 logements'), rv, { ...base, implantation: { ...base.implantation, limiteSeparativePermise: true } });
  assert.equal(sans.bande?.reculLateralM, undefined);
  assert.equal(avec.bande?.reculLateralM, 0);
  assert.ok(avec.kpi!.empriseTotaleM2 > sans.kpi!.empriseTotaleM2 && avec.kpi!.empriseTotaleM2 <= PLAFOND, `${avec.kpi!.empriseTotaleM2} m² avec, ${sans.kpi!.empriseTotaleM2} m² sans`);
  assert.match(avec.hypotheses[0], /limites latérales \(celles qui partent de la voie\) : implantation en limite séparative permise par la règle lue/);
  assert.ok(!avec.hypotheses.some(h => /NON appliquée/.test(h)));
  // Volume unique (sans programme détaillé) : appliquée aussi.
  const unique = calculerVolumeParcelle(PARCELLE, { logements: 30, libelle: null, origine: 'fiche' }, rv, { ...base, implantation: { reculVoieM: 0, limiteSeparativePermise: true } });
  assert.equal(unique.bande?.reculLateralM, 0);
});

test('B — une valeur de recul à la voie illisible ou hors bornes n’est jamais appliquée', () => {
  const rv = reglesVolume(lireRegles(PAR_BANDE), null, BANDES, { implantationDansBande: true });
  const ref = calculerVolumeProgramme(PARCELLE, prog('30 logements'), rv, { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND });
  for (const reculVoieM of [-1, 80, Number.NaN, '0' as unknown as number]) {
    const v = calculerVolumeProgramme(PARCELLE, prog('30 logements'), rv, { cote: COTE, profondeurM: 18, empriseMaxM2: PLAFOND, implantation: { reculVoieM } });
    assert.deepEqual(v.batiments, ref.batiments, String(reculVoieM));
    assert.equal(v.bande?.reculVoieM, undefined);
    assert.ok(v.hypotheses.includes('Recul à la voie fourni illisible ou hors bornes : non appliqué, recul prudent conservé côté voie.'));
  }
});

test('B — côté voie NON identifié : l’implantation fournie est sans effet, résultat identique au calcul sans bande', () => {
  const rv = reglesVolume(lireRegles(REGLES_ESSAI), null, null);
  const sansVoisines = identifierCoteVoie(PARCELLE, []);
  assert.equal(sansVoisines.statut, 'voisines_absentes');
  for (const p of [prog('30 logements'), { logements: 30, libelle: null, origine: 'fiche' as const }]) {
    const ref = calculerVolumeProgramme(PARCELLE, p, rv);
    const v = calculerVolumeProgramme(PARCELLE, p, rv, { cote: sansVoisines, profondeurM: 18, empriseMaxM2: PLAFOND, implantation: { reculVoieM: 0, sourceVoie: 'essai' } });
    assert.equal(v.bande?.statut, 'non-appliquee');
    const { bande: _b, alertes, ...reste } = v;
    const { alertes: alertesRef, ...resteRef } = ref;
    assert.deepEqual(reste, resteRef);
    assert.deepEqual(alertes, [...alertesRef, v.bande!.raison]);
  }
});

test('B — règle CHIFFRÉE de recul à la voie (5 m) et recul aux limites (3 m), parcelle d’essai : 5 m côté voie, 3 m ailleurs', () => {
  const { g, cote } = rectangleSurVoie(40, 60);
  const regles: ReglesPluVolume = { source: 'plu-chiffre', regles: [regle('recul_voie_m', 5), regle('recul_limites_m', 3), regle('hauteur_max_m', 12)], nonAppliquees: [] };
  for (const p of [prog('60 logements'), { logements: 60, libelle: null, origine: 'fiche' as const }]) {
    const v = calculerVolumeProgramme(g, p, regles, { cote, profondeurM: 20, empriseMaxM2: null });
    assert.equal(v.bande?.statut, 'appliquee');
    assert.deepEqual([v.bande?.reculVoieM, v.bande?.reculLimitesM, v.reculM], [5, 3, 3]);
    const m = verifierGrille(v, cote, { reculVoieM: 5, reculLimitesM: 3, profondeurM: 20 });
    // Largeur disponible : 40 − 2 × 3 = 34 m (avant le lot : 40 − 2 × 5 = 30 m au plus, recul uniforme le plus fort).
    const largeur = Math.max(...(v.batiments ?? [v.emprise!]).map(b => b.largeurM));
    assert.ok(largeur > 30 && largeur <= 34, `largeur ${largeur} m`);
    assert.ok(m.minVoie >= 4.98 && m.minLimites >= 2.98 && m.minLimites < 3.1, JSON.stringify(m));
    assert.match(v.hypotheses[0], /^Recul de 5 m côté voie : règle de recul à la voie lue ; recul de 3 m aux autres limites/);
    // Sans la bande : recul uniforme de 5 m, comme avant.
    const sans = calculerVolumeProgramme(g, p, regles);
    assert.equal(sans.reculM, 5);
    assert.equal('bande' in sans, false);
  }
});

test('B — marquerSegmentsVoie / mesurerReculsVolume : une façade qui n’est pas une arête du contour → rien n’est marqué, rien n’est mesuré', () => {
  const contour = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
  const segs = () => contour.map((a, i) => ({ a, b: contour[(i + 1) % 4] } as { a: PointLocal; b: PointLocal; voie?: boolean }));
  const s1 = segs();
  assert.equal(marquerSegmentsVoie(s1, [{ a: { x: 10, y: 0 }, b: { x: 0, y: 0 } }]), true);     // sens inverse accepté
  assert.deepEqual(s1.map(s => !!s.voie), [true, false, false, false]);
  const s2 = segs();
  assert.equal(marquerSegmentsVoie(s2, [{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }]), false);     // demi-arête : refusée
  assert.ok(s2.every(s => !s.voie));
  assert.equal(marquerSegmentsVoie(segs(), []), false);
  const rect = { largeurM: 4, profondeurM: 3, coins: [{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 4 }, { x: 2, y: 4 }] };
  const etat = { statut: 'appliquee' as const, raison: null, profondeurM: 8, longueurFacadeM: 10, angleVoieDeg: 0, distanceMaxVoieM: 4, empriseMaxM2: null, facades: [{ a: contour[0], b: contour[1] }] };
  assert.deepEqual(mesurerReculsVolume({ bande: etat, contour, emprise: rect }), { voieM: 1, limitesM: 2 });
  assert.equal(mesurerReculsVolume({ bande: { ...etat, facades: [{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }] }, contour, emprise: rect }), null);
  assert.equal(mesurerReculsVolume({ bande: { ...etat, facades: undefined }, contour, emprise: rect }), null);
});

test('B — 150 parcelles tirées, recul à la voie différencié (alignement ou règle chiffrée) : parcelle, reculs, bande, plafond vérifiés sur grille', () => {
  let graine = 20261110;
  const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 2 ** 32; };
  const PROGRAMMES = ['12 logements', '30 logements', '40 logements', '90 logements', '6 maisons', '14 maisons', 'résidence de 60 lits', '20 logements et 8 maisons'];
  let differencies = 0, replis = 0, batiments = 0, alignes = 0;
  for (let k = 0; k < 150; k++) {
    const l = 16 + alea() * 100, h = 16 + alea() * 90, rot = alea() * 180, biais = (alea() - 0.5) * 14, biais2 = (alea() - 0.5) * 14;
    const g = polygone([[0, 0], [l, 0], [l + biais, h], [biais2, h]], rot);
    const cote = identifierCoteVoie(g, [polygone([[-80, 0], [0, 0], [biais2, h], [-80, h]], rot), polygone([[l, 0], [l + 80, 0], [l + 80, h], [l + biais, h]], rot), polygone([[-80, h], [l + 80, h], [l + 80, h + 40], [-80, h + 40]], rot)]);
    assert.equal(cote.statut, 'identifie');
    const regles: ReglePlu[] = [];
    if (alea() < 0.5) regles.push(regle('hauteur_max_m', 6 + alea() * 20));
    if (alea() < 0.4) regles.push(regle('emprise_max_ratio', 0.2 + alea() * 0.7));
    if (alea() < 0.5) regles.push(regle('recul_limites_m', 1 + alea() * 5));
    if (alea() < 0.3) regles.push(regle('recul_limites_formule', 2, { minimumM: 3 }));
    const voieChiffree = alea() < 0.4 ? Math.round((1 + alea() * 6) * 2) / 2 : null;
    if (voieChiffree !== null) regles.push(regle('recul_voie_m', voieChiffree));
    const rv: ReglesPluVolume = { source: regles.length ? 'plu-chiffre' : 'aucune', regles, nonAppliquees: [] };
    const D = [12, 15, 18, 20, 25][Math.floor(alea() * 5)];
    const plafond = alea() < 0.5 ? null : Math.round(40 + alea() * l * D * 0.8);
    const implantation = voieChiffree === null || alea() < 0.3 ? { reculVoieM: 0, sourceVoie: 'essai' } : null;
    const p = prog(PROGRAMMES[Math.floor(alea() * PROGRAMMES.length)]);
    const v = calculerVolumeProgramme(g, p, rv, { cote, profondeurM: D, empriseMaxM2: plafond, implantation });
    if (v.bande?.statut !== 'appliquee') { replis++; continue; }
    const voie = voieChiffree ?? 0;
    assert.equal(v.bande.reculVoieM, voie, `tirage ${k}`);
    assert.equal(verifierBandeVolume(v).prouvee, true);
    const ct = contraintesPlu(rv, { reculVoieM: implantation ? 0 : null });
    // Chaque bâtiment contre SON recul aux limites (règle H/k : dépend de sa hauteur).
    for (const b of v.batiments?.length ? v.batiments : [{ ...v.emprise!, hauteurM: v.hauteurM }]) {
      const seul = { ...v, batiments: undefined, emprise: { ...v.emprise!, ...b } } as VolumePropose;
      const m = verifierGrille(seul, cote, { reculVoieM: voie, reculLimitesM: ct.reculPour(b.hauteurM), profondeurM: D });
      if (m.minVoie < 0.5) alignes++;
      batiments++;
    }
    if (plafond !== null) assert.ok(empriseDe(v) <= plafond + 1e-6, `tirage ${k} : emprise ${empriseDe(v)} > plafond ${plafond}`);
    assert.ok(empriseDe(v) <= ct.ratioEmprise * v.surfaceParcelleM2 + 1e-6, `tirage ${k} : emprise au-dessus du coefficient`);
    differencies++;
  }
  assert.ok(differencies >= 100 && batiments >= 120 && alignes >= 30, JSON.stringify({ differencies, replis, batiments, alignes }));
});

test('B — contrôles : distances MESURÉES à la voie et aux autres limites, chacune contre sa règle ; « non réglementé » n’est pas « inconnu »', () => {
  // Valeur d'essai (alignement) : le bâtiment est à 0,25 m de la voie et à 6 m des limites latérales.
  const essai = volumeEnBande(REGLES_ESSAI, prog('30 logements'));
  const c = Object.fromEntries(controlerVolume(essai, lireRegles(REGLES_ESSAI), essai.logementsEstimes).map(x => [x.cle, x]));
  assert.equal(c.recul_voie_m.valeur_volume, '0,25 m du côté voie présumé (mesuré)');
  assert.match(c.recul_voie_m.regle!, /^alignement autorisé \(0 m\)/);
  assert.equal(c.recul_voie_m.verdict, 'dans_la_limite');
  assert.match(c.recul_voie_m.explication, /Côté voie présumé d’après le cadastre \(limite sans parcelle mitoyenne\), à confirmer/);
  assert.equal(c.recul_limites_m.valeur_volume, '5,99 m des limites autres que la voie (mesuré)');
  assert.notEqual(c.recul_limites_m.verdict, 'au_dela');
  // Règles réellement lues : voie non réglementée → dite telle, sans en déduire l'alignement.
  const lues = volumeEnBande(REGLES_LUES, prog('30 logements'));
  const cl = Object.fromEntries(controlerVolume(lues, lireRegles(REGLES_LUES), lues.logementsEstimes).map(x => [x.cle, x]));
  assert.equal(cl.recul_voie_m.regle, 'non réglementé (Règlement GPU — PLUi Est Ensemble, indice 9, p. 200)');
  // Lot C11 : l'alignement est retenu, et le contrôle le dit avec la distance mesurée.
  assert.match(cl.recul_voie_m.explication, /^Recul à la voie non réglementé \(indice 9, p\. 200\) : aucun minimum chiffré à respecter\. Le volume d’étude retient l’implantation à l’alignement \(0,25 m mesuré côté voie\)\./);
  assert.equal(cl.recul_voie_m.verdict, 'dans_la_limite');
  // Sans côté voie (calcul prudent) : le texte du lot C10 reste — l'alignement n'est pas déduit.
  const prudent = calculerVolumeProgramme(PARCELLE, prog('30 logements'), reglesVolume(lireRegles(REGLES_LUES), null, null));
  const cp = Object.fromEntries(controlerVolume(prudent, lireRegles(REGLES_LUES), prudent.logementsEstimes).map(x => [x.cle, x]));
  assert.match(cp.recul_voie_m.explication, /Le volume d’étude n’en déduit pas l’implantation à l’alignement : il garde/);
  // Volume modifié (bâtiment poussé de 5,5 m le long de la voie) : la mesure le voit, quelle que soit la valeur déclarée.
  const b = essai.batiments![0];
  const a = b.angleDeg * Math.PI / 180, du = { x: Math.cos(a) * 5.5, y: Math.sin(a) * 5.5 };
  const pousse = (sens: 1 | -1): VolumePropose => ({ ...essai, batiments: [{ ...b, coins: b.coins.map(q => ({ x: q.x + sens * du.x, y: q.y + sens * du.y })) }] });
  const verdicts = ([1, -1] as const).map(s => controlerVolume(pousse(s), lireRegles(REGLES_ESSAI), 9).find(x => x.cle === 'recul_limites_m')!.verdict);
  assert.ok(verdicts.includes('au_dela'), `un des deux déplacements de 5,5 m viole le recul de 3 m : ${verdicts.join(', ')}`);
});

// ══════════════════════════ C. Plafond d'emprise strict ══════════════════════════

test('C — Montreuil, plafond prudent 20 % (163,2 m²) : 160 m² et non plus 168 m² ; l’écart est consigné dans la fixture', () => {
  const rv = reglesVolume(lireRegles(PAR_BANDE), null, null);
  const v = calculerVolumeProgramme(PARCELLE, prog('40 logements'), rv);
  assert.equal(rv.regles.find(r => r.cle === 'emprise_max_ratio')?.valeur, 0.2);
  assert.equal(empriseDe(v), 160);
  assert.ok(empriseDe(v) <= 0.2 * v.surfaceParcelleM2);
  assert.equal(v.kpi?.ratioEmprise, 0.196);
  const ref = lire('implantation-programme-reference-c7c.json');
  assert.equal(ref.cas.length, 20);
  assert.equal(ref._ecarts_c10.ecarts.length, 1);
  assert.deepEqual([ref._ecarts_c10.ecarts[0].plafond_m2, ref._ecarts_c10.ecarts[0].avant.emprise_m2, ref._ecarts_c10.ecarts[0].apres.emprise_m2], [163.2, 168, 160]);
});

test('C — 300 parcelles tirées sans bande : l’emprise bâtie ne dépasse JAMAIS le plafond (coefficient d’emprise, pleine terre)', () => {
  let graine = 20261110;
  const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 2 ** 32; };
  const PROGRAMMES = ['12 logements', '30 logements', '40 logements', '90 logements', '6 maisons', '14 maisons', '25 maisons seniors', '30 maisons en bande', 'résidence de 60 lits', '20 logements et 8 maisons'];
  let places = 0, pres = 0;
  for (let k = 0; k < 300; k++) {
    const l = 14 + alea() * 110, h = 14 + alea() * 100, rot = alea() * 180, biais = (alea() - 0.5) * 16, biais2 = (alea() - 0.5) * 16;
    const g = polygone([[0, 0], [l, 0], [l + biais, h], [biais2, h]], rot);
    const regles: ReglePlu[] = [];
    if (alea() < 0.5) regles.push(regle('hauteur_max_m', 6 + alea() * 20));
    if (alea() < 0.6) regles.push(regle('emprise_max_ratio', 0.1 + alea() * 0.6));
    if (alea() < 0.2) regles.push(regle('pleine_terre_min_ratio', 0.3 + alea() * 0.5));
    if (alea() < 0.3) regles.push(regle('recul_limites_m', 1 + alea() * 5));
    if (alea() < 0.2) regles.push(regle('epaisseur_max_m', 8 + alea() * 12));
    const rv: ReglesPluVolume = { source: regles.length ? 'plu-chiffre' : 'aucune', regles, nonAppliquees: [] };
    const v = calculerVolumeProgramme(g, prog(PROGRAMMES[Math.floor(alea() * PROGRAMMES.length)]), rv);
    if (!v.emprise) continue;
    const plafond = contraintesPlu(rv).ratioEmprise * v.surfaceParcelleM2;
    assert.ok(empriseDe(v) <= plafond + 1e-6, `tirage ${k} : ${empriseDe(v)} m² > plafond ${plafond.toFixed(1)} m²`);
    places++;
    if (empriseDe(v) > plafond - 8) pres++;
  }
  assert.ok(places >= 250 && pres >= 5, JSON.stringify({ places, pres }));   // `pres` : cas à moins de 8 m² du plafond (le plafond mord vraiment)
});

// ══════════════════════════ D. Hauteur du calcul prudent ══════════════════════════

test('D — limiteSelonBande : bande principale si elle est prouvée, sinon la valeur la plus contraignante des bandes', () => {
  const r = Object.fromEntries(lireRegles(PAR_BANDE).map(x => [x.cle, x]));
  assert.deepEqual(limiteSelonBande(r.hauteur_max_m, true), { valeur: 19.5, parBande: true, plusPermissive: null });
  assert.deepEqual(limiteSelonBande(r.hauteur_max_m, false), { valeur: 13.5, parBande: true, plusPermissive: 19.5 });
  assert.deepEqual(limiteSelonBande(r.niveaux_max, false), { valeur: 4, parBande: true, plusPermissive: 6 });
  assert.deepEqual(limiteSelonBande(r.pleine_terre_min_pct, false), { valeur: 50, parBande: true, plusPermissive: 15 });   // minimum exigé : le plus fort
  const ordinaire = lireRegles([{ cle: 'hauteur_max_m', valeur: 12, statut: 'confirme', source: 'PLU', article: 'UA 10' }])[0];
  assert.deepEqual(limiteSelonBande(ordinaire, false), { valeur: 12, parBande: false, plusPermissive: null });
  assert.equal(limiteSelonBande(undefined, false), null);
});

test('D — Montreuil, calcul prudent (côté voie non situé) : 13,5 m et 4 niveaux au plus, et non 19,5 m / 6 niveaux', () => {
  const regles = lireRegles(PAR_BANDE);
  const rv = reglesVolume(regles, null, null);
  const val = (cle: string) => rv.regles.find(x => x.cle === cle)?.valeur;
  assert.deepEqual([val('hauteur_max_m'), val('niveaux_max'), val('emprise_max_ratio'), val('pleine_terre_min_ratio')], [13.5, 4, 0.2, 0.5]);
  const v = calculerVolumeProgramme(PARCELLE, prog('40 logements'), rv);
  assert.deepEqual([v.niveaux, v.hauteurM, empriseDe(v), v.sdpM2, v.logementsEstimes], [4, 12, 160, 640, 9]);
  assert.ok(v.reglesNonAppliquees.includes('Règle par bande, hauteur (bande principale de 18 m depuis la voie : 19,5 m ; bande secondaire : 13,5 m) — le volume d’étude n’est pas situé dans la bande principale : 13,5 m appliqué, et non 19,5 m'));
  // Bandes mesurées (volume destiné à la bande principale) ou implantation garantie : valeurs de la bande principale.
  for (const dans of [reglesVolume(regles, null, BANDES), reglesVolume(regles, null, BANDES, { implantationDansBande: true }), reglesVolume(regles, null, null, { implantationDansBande: true })]) {
    assert.deepEqual([dans.regles.find(x => x.cle === 'hauteur_max_m')?.valeur, dans.regles.find(x => x.cle === 'niveaux_max')?.valeur], [19.5, 6]);
  }
  // Règles ordinaires (sans bande) : conversion inchangée.
  const ord = reglesVolume(lireRegles([{ cle: 'hauteur_max_m', valeur: 12, statut: 'confirme', source: 'PLU', article: 'UA 10' }, { cle: 'niveaux_max', valeur: 4, statut: 'estime', source: 'saisie' }]), null);
  assert.deepEqual(ord.regles.map(x => [x.cle, x.valeur, x.source]), [['hauteur_max_m', 12, 'PLU'], ['niveaux_max', 4, 'saisie']]);
  assert.deepEqual(ord.nonAppliquees, []);
});

test('D — contrôles, bande non prouvée : une hauteur entre 13,5 m et 19,5 m est « à vérifier », au-dessus de 19,5 m « au-delà »', () => {
  const regles = lireRegles(PAR_BANDE);
  const v = calculerVolumeProgramme(PARCELLE, prog('40 logements'), reglesVolume(regles, null, null));
  const hauteur = (niveaux: number) => controlerVolume({ ...v, niveaux, hauteurM: niveaux * 3 }, regles, 9).find(c => c.cle === 'hauteur_max_m')!;
  assert.equal(hauteur(4).verdict, 'a_verifier');
  assert.match(hauteur(4).explication, /^≈ 12 m : sous la valeur la plus contraignante des bandes \(13,5 m max\.\), appliquée à tout le volume\./);
  assert.equal(hauteur(6).verdict, 'a_verifier');
  assert.match(hauteur(6).explication, /^≈ 18 m : au-dessus de la valeur la plus contraignante des bandes \(13,5 m max\.\) ; admissible seulement pour un bâtiment situé dans la bande principale \(19,5 m max\.\), ce que le calcul ne prouve pas ici\./);
  assert.equal(hauteur(7).verdict, 'au_dela');
  const niveaux = controlerVolume({ ...v, niveaux: 6, hauteurM: 18 }, regles, 9).find(c => c.cle === 'niveaux_max')!;
  assert.equal(niveaux.verdict, 'a_verifier');
  assert.match(niveaux.regle!, /^4 niveaux max\. \(valeur la plus contraignante des bandes\)/);
});

// ══════════════════════════ A. Fiche « Dossier 3D » du site ══════════════════════════

const messagesConception = (regles: unknown[]) => [{ role: 'assistant' as const, toolCalls: [
  { name: 'recuperer_parcelle', status: 'success', input: { idu: IDU }, output: {} },
  { name: 'enregistrer_regles_conception', status: 'success', input: { regles }, output: {} }] }];

test('A — fiche du site : une emprise PAR BANDE enregistrée à 80 n’est plus 80 % de toute la parcelle, mais le plafond prudent du serveur', () => {
  const regles = reglesPourParcelle(lotsReglesDesMessages(messagesConception(PAR_BANDE)), { idu: IDU, zone: null }, true);
  const val = (cle: string) => regles.regles.find(x => x.cle === cle)?.valeur;
  assert.deepEqual([val('emprise_max_ratio'), val('hauteur_max_m'), val('niveaux_max'), val('pleine_terre_min_ratio')], [0.2, 13.5, 4, 0.5]);
  // MÊMES règles et MÊMES notes que le serveur sans bandes mesurées (aucune seconde logique).
  const serveur = reglesVolume(lireRegles(PAR_BANDE), null, null);
  assert.deepEqual(regles.regles, serveur.regles);
  assert.deepEqual(regles.nonAppliquees, serveur.nonAppliquees);
  assert.match(regles.nonAppliquees[0], /^Emprise par bande : 80 % dans la bande principale de 18 m depuis la voie, 20 % dans la bande secondaire — le volume d’étude ne situe pas la voie : 20 % appliqué à toute la parcelle, ce qui SOUS-ESTIME l’emprise possible sur rue$/);
  assert.equal(regles.nonAppliquees.length, 4);
  // Volume affiché : sous le plafond prudent, à la hauteur prudente (avant : 208 m², 6 niveaux, au titre de « 80 % »).
  for (const n of [30, 60]) {
    const v = calculerVolumeProgramme(PARCELLE, { ...programmeBatiDepuisTexte(`${n} logements`)!, origine: 'conversation' }, regles);
    assert.deepEqual([empriseDe(v), v.niveaux], [160, 4]);
    assert.ok(empriseDe(v) <= 0.2 * v.surfaceParcelleM2);
    assert.match(v.reglesAppliquees.join(' | '), /Emprise au sol \(CES\) : 20 % — emprise au sol plafonnée \(Règlement GPU — PLUi Est Ensemble — emprise par bande, côté voie non identifié : taux le plus contraignant appliqué à la parcelle, indice J, p\. 237/);
  }
  // Même résultat que la règle soit enregistrée avec la valeur de la bande principale (80) ou celle du fond (20, avant le lot C6).
  const anciennes = PAR_BANDE.map(r => r.cle === 'emprise_sol_max_pct' ? { ...r, valeur: 20 } : r);
  assert.deepEqual(reglesPourParcelle(lotsReglesDesMessages(messagesConception(anciennes)), { idu: IDU, zone: null }, true).regles, regles.regles);
});

test('A — fiche du site : les règles SANS bande sont converties comme avant (aucun écart)', () => {
  const ordinaires = [
    { cle: 'hauteur_max_m', valeur: 15, statut: 'confirme', source: 'PLU de Nanterre', article: 'UA 10' },
    { cle: 'emprise_sol_max_pct', valeur: '60', statut: 'estime', source: null, article: null },
    { cle: 'recul_limites_formule', valeur: 'H/2 min 4 m', statut: 'confirme', source: 'PLU', article: 'UA 7' },
    { cle: 'recul_voie_m', valeur: 0, statut: 'confirme', source: 'PLU', article: 'UA 6', nature: 'alternative', alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }] },
    { cle: 'pleine_terre_min_pct', valeur: null, statut: 'manquant', source: 'PLU' },
  ];
  const lots = lotsReglesDesMessages(messagesConception(ordinaires));
  assert.deepEqual(lots[0].regles, [
    { cle: 'hauteur_max_m', valeur: 15, source: 'PLU de Nanterre', reference: 'UA 10', statut: 'lue' },
    { cle: 'emprise_max_ratio', valeur: 0.6, source: 'Règles de conception', reference: null, statut: 'estimee' },
    { cle: 'recul_limites_formule', valeur: 2, minimumM: 4, source: 'PLU', reference: 'UA 7', statut: 'lue' },
    { cle: 'recul_voie_m', valeur: 0, source: 'PLU', reference: 'UA 6', statut: 'lue' },   // refusée ensuite par regleValide, comme avant
  ]);
  assert.deepEqual(lots[0].manquantes, []);
});

/** Préparation telle que la fiche « Espace 3D » la reçoit du serveur (volume du moteur + règles de la conception). */
const preparation = (volume: VolumePropose, brut: unknown[] = PAR_BANDE): PreparationFiche => ({ idu: IDU, commune: 'Montreuil', volume, regles: lireRegles(brut), programme: prog('30 logements'), gabaritNiveaux: null });

test('A — formes : volume du moteur DANS la bande → formes placées dans la bande, avec ses règles ; sinon plafond prudent', () => {
  // Parcelle D'ESSAI large (60 × 50 m, voie au sud) : des plots tiennent dans une bande de 20 m.
  const { g, cote } = rectangleSurVoie(60, 50);
  const brut = PAR_BANDE.map(r => ({ ...r, alternatives: r.alternatives.map(a => ({ ...a, libelle: a.libelle.replace('18 m', '20 m') })) }));
  const bandes = mesurerBandes(cote, 20)!;
  const plafond = empriseMaxParBande(bandes, 80, null)!.principaleM2;
  const moteur = volumeEnBande(brut, prog('30 logements'), g, cote, bandes, plafond);
  assert.equal(verifierBandeVolume(moteur).prouvee, true);
  const pf = preparation(moteur, brut);
  const ctx = contexteForme(pf);
  assert.ok(ctx.bande, 'contexte : bande prouvée');
  assert.equal(ctx.bande!.empriseMaxM2, plafond);
  // Plots : placés DANS la bande, emprise ≤ plafond de la bande.
  const plots = placerForme(ctx, 'plots');
  assert.ok(plots.corps.length >= 2, plots.raison ?? '');
  const comparee = comparerFormes(pf).find(x => x.forme === 'plots')!;
  assert.ok(comparee.ev, comparee.raison ?? '');
  assert.equal(verifierBandeVolume(comparee.ev!.volume).prouvee, true, 'les plots de la comparaison sont prouvés dans la bande');
  assert.ok(comparee.ev!.empriseM2 <= plafond);
  // Cour fermée : ne tient pas dans 20 m de profondeur → dite telle, jamais posée hors bande avec les règles de la bande.
  const cour = placerForme(ctx, 'cour');
  assert.equal(cour.corps.length, 0);
  assert.equal(cour.raison, 'Cette forme ne tient pas dans la bande principale (20 m depuis le côté voie présumé) avec les reculs et l’épaisseur du moteur.');
  // Même parcelle, volume PRUDENT (bande non appliquée) : pas de bande dans le contexte, formes au plafond prudent (20 %, 4 niveaux).
  const prudent = calculerVolumeProgramme(g, prog('30 logements'), reglesVolume(lireRegles(brut), null, null));
  const ctxPrudent = contexteForme(preparation(prudent, brut));
  assert.equal(ctxPrudent.bande, undefined);
  const plotsPrudents = placerForme(ctxPrudent, 'plots');
  assert.ok(plotsPrudents.corps.length >= 2, plotsPrudents.raison ?? '');
  assert.ok(plotsPrudents.niveaux <= 4, `niveaux ${plotsPrudents.niveaux}`);
  assert.ok(plotsPrudents.corps.reduce((s, c) => s + c.longueurM * c.largeurM, 0) <= 0.2 * 3000 + 1e-6);
});

test('A — fiche, hauteur dessinée : la mention « côté voie non identifié par le volume » n’est écrite que si c’est vrai', () => {
  const moteur = volumeEnBande(PAR_BANDE, prog('30 logements'));
  const pf = preparation(moteur);
  const ev = evaluerSaisie(pf, saisieDepuisVolume(moteur));
  // Volume prouvé dans la bande : hauteur de la bande principale, condition mise à jour.
  assert.equal(ev.hauteurStudio!.verdict, 'a_verifier');
  assert.match(ev.hauteurStudio!.texte, /pour 19,5 m max\. \(Règlement GPU — PLUi Est Ensemble, indice b2, p\. 263\) : à vérifier\. Condition complémentaire : règle par bande — bande principale de 18 m depuis la voie : 19,5 m ; bande secondaire : 13,5 m ; volume d’étude contenu dans la bande principale \(vérifié par le calcul\), côté voie présumé d’après le cadastre, à confirmer\.$/);
  assert.doesNotMatch(ev.hauteurStudio!.texte, /côté voie non identifié par le volume/);
  // Volume prudent (pas de bande) : hauteur la plus contraignante, mention d'origine conservée (elle est vraie).
  const prudent = calculerVolumeProgramme(PARCELLE, prog('30 logements'), reglesVolume(lireRegles(PAR_BANDE), null, null));
  const evPrudent = evaluerSaisie(preparation(prudent), saisieDepuisVolume(prudent));
  assert.equal(evPrudent.hauteurStudio!.verdict, 'a_verifier');
  assert.match(evPrudent.hauteurStudio!.texte, /13,5 m max\. — hauteur la plus contraignante des bandes/);
  assert.match(evPrudent.hauteurStudio!.texte, /Condition complémentaire non vérifiée : .*côté voie non identifié par le volume\.$/);
  // Sans volume (ancien appel) : jamais la hauteur de la bande principale par défaut.
  assert.match(controleHauteurStudio(ev.corps, pf.regles, false)!.texte, /hauteur la plus contraignante des bandes/);
  // Règle ordinaire : texte d'origine.
  const ordinaire = lireRegles([{ cle: 'hauteur_max_m', valeur: 25, statut: 'confirme', source: 'PLU', article: 'UA 10' }]);
  assert.match(controleHauteurStudio(ev.corps, ordinaire, false, moteur)!.texte, /: dans la limite de la règle citée \(25 m max\. \(PLU, UA 10\)\)\.$/);
});
