// LOT FICHE-3D — « Dimensions » et « Programme » de la fiche « Espace 3D » : chiffres du MOTEUR.
// Données : __fixtures__/preparation-AE0414.json = ligne studio_preparations RECALCULÉE par le code réel du
// serveur (copilot-chat/agent/studio.ts::preparerVolume) sur la conception AE0414 des tests E1-19 (contour
// cadastral réel, règles de la fiche réelle du 05/11/2026). Aucune donnée de la base de production.
// La parité avec le serveur est vérifiée sur son CODE RÉEL (preparerVolume, apercuVolume).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { apercuVolume, preparerVolume, type ConceptionLue } from '../../../../supabase/functions/copilot-chat/agent/studio.ts';
import { lirePreparationStockee, ouverturePreparation, type PreparationStockee } from './preparationStudio.ts';
import {
  FORMES, apercuDepuisEvaluation, appliquerForme, bornerValeur, ecartsProgramme, evaluerSaisie, modifierCorps, programmeMoteur,
  raisonFormeIndisponible, saisieDepuisVolume, schemaForme, type PreparationFiche,
} from './ficheDimensions.ts';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/preparation-AE0414.json', import.meta.url), 'utf8'));
const DEMANDE = JSON.parse(readFileSync(new URL('./__fixtures__/demande-brief-AE0414.json', import.meta.url), 'utf8'));
const P = lirePreparationStockee(FIX.ligne) as PreparationStockee;
const sp = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

test('relecture : la ligne stockée porte les règles de la conception (lireRegles), sans confiance', () => {
  assert.ok(P);
  assert.ok(P.regles.length >= 5);
  assert.deepEqual(P.regles.find((r) => r.cle === 'recul_limites_m')?.valeur, 8);
  assert.deepEqual(lirePreparationStockee({ ...FIX.ligne, entree: { ...FIX.ligne.entree, regles: 'x' } })?.regles, []);
});

test('préremplissage AE0414 : 2 barres R+2 du MOTEUR (29,5 × 16 et 29 × 16 m), jamais le texte du modèle', () => {
  const s = saisieDepuisVolume(P.volume);
  assert.equal(s.forme, 'barres');
  assert.deepEqual(s.corps.map((c) => [c.nom, c.longueurM, c.largeurM, c.niveaux, c.angleDeg]), [
    ['Barre A — 21 logements R+2', 29.5, 16, 3, 120.4], ['Barre B — 19 logements R+2', 29, 16, 3, 120.4]]);
  const ev = evaluerSaisie(P, s);
  assert.equal(ev.modifie, false);
  assert.deepEqual([ev.sdpM2, ev.logementsPlaces, ev.logementsVises, ev.capaciteLogements], [2808, 40, 40, 40]);
  // Hauteurs aux cotes du Studio (lot brief-créatif) : R+2 = 9,34 m ; avec attique 12,26 m.
  assert.deepEqual(ev.corps.map((c) => [c.hauteurStudioM, c.hauteurStudioAttiqueM, c.hauteurMoteurM]), [[9.34, 12.26, 9], [9.34, 12.26, 9]]);
  assert.equal(sp(programmeMoteur(ev)), '40 logements visés · 2 bâtiments en R+2 · SDP ≈ 2 808 m² (estimée) · 40 logements placés');
});

test('vérifications : MÊME fonction que le serveur → mêmes verdicts que la préparation (aucun « conforme »)', () => {
  const ev = evaluerSaisie(P, saisieDepuisVolume(P.volume));
  assert.deepEqual(ev.controles, FIX.resume.controles);
  assert.deepEqual(ev.controles.map((c) => [c.cle, c.verdict]), [
    ['hauteur_max_m', 'a_verifier'], ['emprise_sol_max_pct', 'dans_la_limite'], ['recul_voie_m', 'dans_la_limite'],
    ['recul_limites_m', 'dans_la_limite'], ['pleine_terre_min_pct', 'a_verifier'], ['stationnement_par_logement', 'non_controle']]);
  // Hauteur dessinée par le Studio : règle citée MAIS condition UC 10-1 non vérifiée → « à vérifier ».
  assert.equal(ev.hauteurStudio?.verdict, 'a_verifier');
  assert.match(sp(ev.hauteurStudio!.texte), /9,34 m pour 28 m max\..*UC 10-1/);
  assert.equal(evaluerSaisie(P, saisieDepuisVolume(P.volume), true).hauteurStudio?.texte.includes('12,26 m (attique compris)'), true);
  assert.ok(!/conforme/i.test(JSON.stringify(ev)));
});

test('programme du modèle divergent : le moteur gagne, chaque écart est listé (R+4, 3 200 m², SHAB)', () => {
  const ev = evaluerSaisie(P, saisieDepuisVolume(P.volume));
  const e = ecartsProgramme('40 logements collectifs R+4, SDP ≈ 3 200 m², SHAB ≈ 2 800 m²', ev).map((x) => [x.libelle, sp(x.modele), sp(x.moteur)]);
  assert.deepEqual(e, [
    ['Gabarit', 'R+4', 'R+2'], ['Surface de plancher', '≈ 3 200 m²', '≈ 2 808 m²'], ['Surface habitable', '≈ 2 800 m²', 'non calculée par le moteur']]);
  assert.deepEqual(ecartsProgramme('350m2', ev).map((x) => x.libelle), ['Surface']);
  assert.deepEqual(ecartsProgramme('40 logements R+2, SDP ≈ 2 808 m²', ev), []);
  assert.deepEqual(ecartsProgramme(null, ev), []);
});

test('modification : bâtiment A en R+4 → SDP, capacité, hauteurs et verdicts recalculés par le moteur', () => {
  const s = modifierCorps(saisieDepuisVolume(P.volume), 0, 'niveaux', 5);
  const ev = evaluerSaisie(P, s);
  assert.equal(ev.modifie, true);
  assert.equal(ev.sdpM2, 29.5 * 16 * 5 + 29 * 16 * 3);
  assert.deepEqual([ev.capaciteLogements, ev.logementsPlaces], [53, 40]);
  assert.equal(ev.corps[0].hauteurStudioM, 15.38);
  assert.equal(ev.corps[0].nom, 'Barre A — 25 logements R+4');
  assert.ok(ev.reculMinM >= 7.99 && ev.reculMinM < 9, String(ev.reculMinM));
  const v = Object.fromEntries(ev.controles.map((c) => [c.cle, c]));
  assert.equal(v.hauteur_max_m.valeur_volume, '≈ 15 m');
  assert.equal(v.hauteur_max_m.verdict, 'a_verifier');
  assert.equal(v.recul_limites_m.verdict, 'dans_la_limite');
  // Écart entre les deux barres inférieur à l'écart supposé par le moteur (H = 15 m) : signalé, hypothèse.
  assert.ok(ev.alertes.some((a) => /écart supposé par le moteur/.test(a)), ev.alertes.join(' | '));
  assert.ok(!/conforme/i.test(JSON.stringify(ev)));
});

test('modification : barre trop longue → déborde, recul au-delà de la règle ; trop basse → programme non atteint', () => {
  const ev = evaluerSaisie(P, modifierCorps(saisieDepuisVolume(P.volume), 0, 'longueurM', 120));
  assert.equal(ev.corps[0].reculReelM, 0);
  assert.ok(ev.alertes.some((a) => /déborde de la parcelle/.test(a)));
  assert.equal(ev.controles.find((c) => c.cle === 'recul_limites_m')?.verdict, 'au_dela');
  const bas = evaluerSaisie(P, modifierCorps(modifierCorps(saisieDepuisVolume(P.volume), 0, 'niveaux', 1), 1, 'niveaux', 1));
  assert.ok(bas.alertes.some((a) => /Programme non atteint : 13 logements possibles pour 40 visés/.test(a)), bas.alertes.join(' | '));
});

test('formes : seules barre, barres parallèles et plot sont choisissables ; L, U, cour « bientôt »', () => {
  assert.deepEqual(FORMES.filter((f) => f.disponible).map((f) => f.valeur), ['barre', 'barres', 'plot']);
  const s = saisieDepuisVolume(P.volume);
  for (const f of ['l', 'u', 'cour'] as const) assert.equal(raisonFormeIndisponible(f, s), 'Bientôt disponible.');
  assert.equal(appliquerForme(P, s, 'l'), s);
  const une = appliquerForme(P, s, 'barre');
  assert.deepEqual(une.corps.map((c) => [c.longueurM, c.largeurM, c.niveaux]), [[29.5, 16, 3]]);
  const ev1 = evaluerSaisie(P, une);
  assert.equal(ev1.sdpM2, 1416);
  assert.ok(ev1.alertes.some((a) => /Programme non atteint : 20 logements possibles pour 40 visés/.test(a)));
  const plot = appliquerForme(P, une, 'plot');
  assert.deepEqual(plot.corps.map((c) => [c.longueurM, c.largeurM]), [[22, 16]]);
  assert.equal(plot.forme, 'plot');
  // Retour aux barres parallèles : exactement le volume du moteur.
  assert.equal(evaluerSaisie(P, appliquerForme(P, plot, 'barres')).modifie, false);
  // Un bâtiment seul allongé redevient une barre, raccourci un plot.
  assert.equal(modifierCorps(plot, 0, 'longueurM', 40).forme, 'barre');
});

test('barre unique → barres parallèles : 2ᵉ barre identique, parallèle, à l’écart du moteur (max(H, 8 m)), dans la parcelle', async () => {
  const LON = 2.2068, LAT = 48.892, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
  const ring = [[0, 0], [60, 0], [60, 70], [0, 70]].map(([x, y]) => [LON + x / KX, LAT + y / 111_320]);
  const c: ConceptionLue = { id: '5a1c0e00-0000-4000-8000-0000000000c2', idu: '92050000AE0001', commune: 'Nanterre',
    parcelle: { idu: '92050000AE0001', geometrie: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, surface_m2: 4200, source: 'synthétique (test)' },
    regles_plu: FIX.ligne.entree.regles, programme: { nb_logements: 12, gabarit: 'R+2' } };
  const prep = await preparerVolume(c);
  assert.ok(prep.ok);
  const p: PreparationFiche = { idu: c.idu, commune: c.commune, volume: prep.volume, regles: prep.entree.regles, programme: prep.entree.programme_volume };
  const s = saisieDepuisVolume(p.volume);
  assert.equal(s.corps.length, 1);
  const deux = appliquerForme(p, s, 'barres');
  assert.equal(deux.corps.length, 2);
  const [a, b] = deux.corps;
  assert.equal(a.angleDeg, b.angleDeg);
  const d = Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y);
  assert.ok(Math.abs(d - (a.largeurM + Math.max(a.niveaux * 3, 8))) < 1e-6, String(d));
  const ev = evaluerSaisie(p, deux);
  assert.ok(ev.corps.every((k) => k.reculReelM >= 7.99), ev.corps.map((k) => k.reculReelM).join(', '));
  assert.ok(!ev.alertes.some((x) => /chevauchent|écart supposé/.test(x)), ev.alertes.join(' | '));
});

test('saisie bornée : virgule, pas de 0,5 m, côtés ≥ 6 m, 1 à 30 niveaux ; saisie illisible ignorée', () => {
  assert.equal(bornerValeur('longueurM', '12,3'), 12.5);
  assert.equal(bornerValeur('largeurM', 2), 6);
  assert.equal(bornerValeur('largeurM', 80), 40);
  assert.equal(bornerValeur('niveaux', 0), 1);
  assert.equal(bornerValeur('niveaux', 99), 30);
  assert.equal(bornerValeur('niveaux', 'abc'), null);
  const s = saisieDepuisVolume(P.volume);
  assert.equal(modifierCorps(s, 0, 'longueurM', ''), s);
  assert.equal(modifierCorps(s, 0, 'niveaux', 'x'), s);
  assert.equal(modifierCorps(s, 9, 'niveaux', 2), s);
});

test('aperçu de la carte « Brief créatif » : mêmes corps que le serveur (apercuVolume) ; schéma coté', () => {
  const ev = evaluerSaisie(P, saisieDepuisVolume(P.volume));
  assert.deepEqual(apercuDepuisEvaluation(ev), apercuVolume(P.volume));
  assert.deepEqual(apercuDepuisEvaluation(ev).corps, DEMANDE.data.apercu.corps);
  const sch = schemaForme(ev);
  assert.equal(sch.corps.length, 2);
  assert.deepEqual(sch.corps.map((c) => c.cotes.map((k) => sp(k.texte))), [['29,5 m', '16 m'], ['29 m', '16 m']]);
  assert.ok(sch.vue.w > 60 && sch.vue.h > 60);
  assert.ok(sch.parcelle.split(' ').length >= 10);
});

test('ouverture dans le Studio avec les dimensions modifiées : mêmes fonctions que « Ouvrir la 3D préparée »', () => {
  const ev = evaluerSaisie(P, modifierCorps(saisieDepuisVolume(P.volume), 0, 'niveaux', 5));
  const o = ouverturePreparation({ ...P, volume: ev.volume });
  assert.ok(o.ok);
  const bats = o.ok ? o.terrain.volumeBatiments?.batiments ?? [] : [];
  assert.deepEqual(bats.map((b) => [b.largeurM, b.profondeurM, b.niveaux]), [[29.5, 16, 5], [29, 16, 3]]);
  // Volume du moteur inchangé : ouverture identique à la carte « 3D préparée ».
  assert.deepEqual(ouverturePreparation({ ...P, volume: evaluerSaisie(P, saisieDepuisVolume(P.volume)).volume }), ouverturePreparation(P));
});
