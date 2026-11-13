// src/spaces/copilot/studio3d/lotP9VolumeRegles.test.ts — LOT P9 (node --test, données réelles Montfermeil P0646)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poserVolumeSurVoie, ligneHauteurFiche } from './implantationVoieVolume.ts';
import { reglesFicheDepuisReglesLues } from './reglesFiche.ts';
import { implantationDepuisVolume } from './confirmationRapide.ts';
import type { VolumePropose, ReglesPluVolume } from './volumeParcelle.ts';
import type { RegleLue } from './controlesVolume.ts';

// studio_preparations c36fcd30 (travail c3584258), lu en lecture seule le 13/11/2026.
const GEOM = { type: 'MultiPolygon' as const, coordinates: [[[[2.54999713, 48.89137322], [2.55000455, 48.8913987], [2.55005347, 48.89170321], [2.55031807, 48.89168585], [2.55031109, 48.89164113], [2.55030398, 48.89159623], [2.55026501, 48.89135489], [2.54999713, 48.89137322]]]] };
const E = { coins: [{ x: 7.266112272001388, y: 12.902387774729505 }, { x: -3.672414463229723, y: 14.063694307318645 }, { x: -5.3615876015412, y: -1.8468900348357 }, { x: 5.576939133689911, y: -3.0081965674248408 }],
  centre: { x: 0.9522623352300943, y: 5.527748869946902 }, angleDeg: 173.9, largeurM: 11, surfaceM2: 176, centreWgs84: { lat: 48.89157870638583, lon: 2.550170610574395 }, profondeurM: 16 };
const V = { statut: 'calcule', emprise: E, niveaux: 3, hauteurM: 9, reculM: 4, origine: { lat: 48.89152905, lon: 2.5501576 }, contour: [], alertes: [],
  hypotheses: ['Recul de 4 m sur toutes les limites : le plus fort des reculs PLU (côté voie non identifié).'], batiments: [{ id: 'mz-vol-1', nom: 'Plot A', forme: 'plot', ...E, niveaux: 3, hauteurM: 9, sdpM2: 528, unites: 7, uniteLibelle: 'logement' }] } as unknown as VolumePropose;
const FACADES = [{ debut: [2.550265, 48.8913549], fin: [2.5499971, 48.8913732] }];
const GPU = 'get_prescriptions_urbanisme GPU';
/** Copie conforme de mimmozia-studio src/core/panoramax/implantationVoie.ts reculVoieDesRegles (e24f58a) : vérifie que le worker lit la règle. */
function reculVoieDesReglesStudio(regles: unknown): { valeurM: number; source: string } | null {
  if (!Array.isArray(regles)) return null;
  let meilleur: { valeurM: number; source: string } | null = null;
  for (const r of regles) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const champ = typeof o['champ'] === 'string' ? o['champ'] : '';
    const cat = typeof o['categorie'] === 'string' ? o['categorie'] : '';
    const v = o['valeur'];
    const unite = typeof o['unite'] === 'string' ? o['unite'].trim().toLowerCase() : 'm';
    const voie = /recul.*(voi|rue|alignement)|setback-road/i.test(champ) || /setback-road|recul.*voi/i.test(cat);
    if (!voie || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 50 || (unite !== 'm' && unite !== '')) continue;
    if (!meilleur || v > meilleur.valeurM) meilleur = { valeurM: v, source: `règle de la fiche « ${champ || cat} »` };
  }
  return meilleur;
}
const REGLES: ReglesPluVolume = { source: 'plu-chiffre', nonAppliquees: [], regles: [
  { cle: 'hauteur_max_m', valeur: 9, source: GPU, statut: 'estimee' }, { cle: 'emprise_max_ratio', valeur: 0.4, source: GPU, statut: 'estimee' },
  { cle: 'recul_voie_m', valeur: 4, source: GPU, statut: 'estimee' }, { cle: 'pleine_terre_min_ratio', valeur: 0.45, source: GPU, statut: 'estimee' }] };

test('P9 — Montfermeil : le volume est posé façade avant au recul de 4 m (règle GPU estimée), parallèle à la voie', () => {
  const r = poserVolumeSurVoie(V, GEOM, FACADES, REGLES);
  assert.equal(r.pose?.statut, 'posee');
  assert.equal(r.pose?.reculVoieSuppose, false);
  assert.ok(r.pose!.reculAvantM > 15, `avant ${r.pose!.reculAvantM}`);
  assert.ok(r.pose!.reculApresM >= 4 && r.pose!.reculApresM < 4.1, `après ${r.pose!.reculApresM}`);
  assert.ok(Math.abs(r.volume.emprise!.angleDeg - 174.1) < 0.2);         // largeur (11 m) le long de la voie
  assert.equal(r.volume.emprise!.largeurM, 11); assert.equal(r.volume.emprise!.profondeurM, 16);
  assert.deepEqual(r.volume.batiments![0].centre, r.volume.emprise!.centre);
  assert.ok(!r.volume.hypotheses.some((h) => /côté voie non identifié/.test(h)));
  assert.match(r.volume.hypotheses.at(-1)!, /parallèlement à la voie.*4,05 m/);
});

test('P9 — idempotent ; sans règle de recul : 4 m SUPPOSÉS et dit ; sans façade : rien ne change', () => {
  const r = poserVolumeSurVoie(V, GEOM, FACADES, REGLES);
  assert.equal(poserVolumeSurVoie(r.volume, GEOM, FACADES, REGLES).pose?.statut, 'inchangee');
  const s = poserVolumeSurVoie(V, GEOM, FACADES, { ...REGLES, regles: REGLES.regles.filter((x) => x.cle !== 'recul_voie_m') });
  assert.equal(s.pose?.reculVoieSuppose, true); assert.match(s.pose!.message, /SUPPOSÉ/);
  const n = poserVolumeSurVoie(V, GEOM, [], REGLES); assert.equal(n.pose, null); assert.equal(n.volume, V);
});

test('P9 — volume 28,5 × 8 m plus long que la façade (19,7 m) : posé perpendiculaire, dans la parcelle', () => {
  const big = { ...V, batiments: undefined, emprise: { ...E, largeurM: 28.5, profondeurM: 8 } } as unknown as VolumePropose;
  const r = poserVolumeSurVoie(big, GEOM, FACADES, REGLES);
  assert.equal(r.pose?.statut, 'posee');
  assert.ok(Math.abs(r.volume.emprise!.angleDeg - 84.1) < 0.2);
  assert.ok(r.pose!.reculApresM >= 4);
});

test('P9 — pose du Studio : orientation = axe de la LONGUEUR (le Studio prend le plus grand côté de « 11 m x 16 m »)', () => {
  const p = implantationDepuisVolume({ emprise: { ...E, angleDeg: 174.1 } } as VolumePropose)!;
  assert.equal(p.orientationDeg, 95.9);   // −(174,1 + 90) ramené dans ]−180, 180]
  const q = implantationDepuisVolume({ emprise: { ...E, largeurM: 16, profondeurM: 11 } } as VolumePropose)!;
  assert.equal(q.orientationDeg, -173.9); // largeur = longueur : inchangé
});

test('P9 — charge.regles : règles chiffrées seulement, source et statut, clés lues par le Studio', () => {
  const lues = [
    { cle: 'hauteur_max_m', valeur: 9, statut: 'estime', source: GPU, article: null, nature: null, texte: 'Hauteur max 9 m', regle_relative: null },
    { cle: 'niveaux_max', valeur: null, statut: 'manquant', source: 'aucune source trouvée', article: null, nature: null, texte: null, regle_relative: null },
    { cle: 'emprise_sol_max_pct', valeur: 40, statut: 'estime', source: GPU, article: null, nature: null, texte: null, regle_relative: null },
    { cle: 'recul_voie_m', valeur: 4, statut: 'estime', source: GPU, article: null, nature: null, texte: null, regle_relative: null },
    { cle: 'recul_limites_m', valeur: 3, statut: 'confirme', source: 'Règlement UC', article: 'UC 7', nature: null, texte: null, regle_relative: null },
    { cle: 'pleine_terre_min_pct', valeur: 45, statut: 'estime', source: GPU, article: null, nature: null, texte: null, regle_relative: null },
    { cle: 'stationnement_par_logement', valeur: 1, statut: 'estime', source: GPU, article: null, nature: null, texte: null, regle_relative: null },
  ] as RegleLue[];
  const r = reglesFicheDepuisReglesLues(lues);
  assert.deepEqual(r.map((x) => x.id), ['emprise-sol-max', 'hauteur-max', 'pleine-terre-min', 'recul-separative', 'recul-voirie']);
  const voie = r.find((x) => x.id === 'recul-voirie')!;
  assert.equal(voie.categorie, 'voirie'); assert.equal(voie.champ, 'reculs.voirie.min_m'); assert.equal(voie.provenance, 'ia');
  assert.match(voie.source.intitule!, /GPU — estimée, non lue dans le règlement/);
  assert.equal(r.find((x) => x.id === 'recul-separative')!.provenance, 'document');
  assert.deepEqual(reculVoieDesReglesStudio(r), { valeurM: 4, source: 'règle de la fiche « reculs.voirie.min_m »' });
});

test('P9 — ligne hauteur : mode de calcul SUPPOSÉ et dit', () => {
  assert.match(ligneHauteurFiche(V, REGLES), /9 m max\..*ACROTÈRE COMPRIS/);
  assert.match(reglesFicheDepuisReglesLues([{ cle: 'hauteur_max_m', valeur: 9, statut: 'estime', source: GPU, article: null, nature: null, texte: null, regle_relative: null } as RegleLue])[0].source.intitule!, /acrotère compris/);
});
