// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/implantation-limite.test.ts
// Lot C11 : préparation du volume (preparerVolume) avec les règles EXACTES de la mission de conception du
// 10/11/2026 à 17 h 01 (parcelle 93048000AS0249, Montreuil, zone UC91Jb2, 30 logements collectifs demandés).
// Ce jour-là : 7 logements, R+2, 527 m² de SDP (175,5 m² d'emprise, recul de 4,5 m partout).
import * as na from 'node:assert/strict';
import { preparerVolume, resumeCompact, VERSION_CALCUL, type ConceptionLue, type IssuePreparation } from './studio.ts';
import { mesurerReculsVolume, verifierBandeVolume } from '../../../../src/spaces/copilot/studio3d/bandePrincipale.ts';
import { RESULTAT_OUTIL_MAX_CARS } from './mission.ts';

const IDU = '93048000AS0249';
const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PARCELLE = { idu: IDU, geometrie: FX.parcelle.geometry, surface_m2: 804, source: 'API Carto IGN — cadastre',
  voisines: { statut: 'disponibles', source: 'API Carto IGN — cadastre', parcelles: FX.voisines.map((v: { idu?: string; geometry: unknown }) => ({ idu: v.idu ?? null, geometrie: v.geometry })) } };
const SRC = 'Règlement GPU — PLUi Est Ensemble';
const bande = (principale: number, secondaire: number) => [{ libelle: 'bande principale (18 m)', valeur: principale }, { libelle: 'bande secondaire', valeur: secondaire }];
const REGLES_17H01: Record<string, unknown>[] = [
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(19.5, 13.5) },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(6, 4) },
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(80, 20) },
  { cle: 'pleine_terre_min_pct', valeur: 15, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(15, 50) },
  { cle: 'recul_voie_m', valeur: null, statut: 'confirme', source: SRC, article: 'indice 9, p. 200', nature: 'non_reglementee',
    regle_relative: 'L\'implantation des constructions doit prendre en compte l\'implantation des constructions voisines pour s\'insérer de manière harmonieuse au sein du tissu existant.' },
  { cle: 'recul_limites_m', valeur: 0, statut: 'confirme', source: SRC, article: 'indice 1, p. 214', nature: 'alternative',
    alternatives: [{ libelle: 'sur limite séparative', valeur: 0 }, { libelle: 'en retrait (minimum)', valeur: 3 }] },
  { cle: 'recul_limites_formule', valeur: 'en cas de retrait : H/2 et 3 mètres minimum', statut: 'confirme', source: SRC, article: 'indice 1, p. 214' },
  { cle: 'stationnement_par_logement', valeur: 0.5, statut: 'confirme', source: SRC, article: 'dispositions communes, p. 89' },
  { cle: 'mixite_sociale_pct', valeur: null, statut: 'manquant', source: 'aucune' },
];
const conception = (logements: number, regles: unknown[], parcelle: unknown = PARCELLE): ConceptionLue =>
  ({ id: 'c-montreuil-c11', idu: IDU, commune: 'Montreuil', parcelle, regles_plu: regles, programme: { nb_logements: logements } }) as ConceptionLue;
type Prete = Extract<IssuePreparation, { ok: true }>;
const prete = (r: IssuePreparation): Prete => { na.ok(r.ok, r.ok ? '' : r.raison); return r as Prete; };
const controle = (r: Prete, cle: string) => r.resume.controles.find((k) => k.cle === cle)!;
const modifier = (cle: string, champs: Record<string, unknown>) => REGLES_17H01.map((r) => (r.cle === cle ? { ...r, ...champs } : r));

Deno.test('C11-1 : version du calcul incrémentée', () => {
  na.equal(VERSION_CALCUL, 'e1-studio-3');
});

Deno.test('C11-2 : Montreuil, règles EXACTES de 17 h 01, 30 logements — 30 logements placés (R+5, 367 m², SDP 2 199 m²) au lieu de 7', async () => {
  const r = prete(await preparerVolume(conception(30, REGLES_17H01)));
  na.deepEqual([r.resume.batiments, r.resume.formes, r.resume.gabarit, r.resume.niveaux, r.resume.hauteur_indicative_m], [1, ['barre'], 'R+5', 6, 18]);
  na.deepEqual([r.resume.emprise_batie_m2, r.resume.emprise_pct, r.resume.sdp_estimee_m2, r.resume.logements_places, r.resume.logements_vises, r.resume.programme_atteint],
    [367, 45, 2199, 30, 30, true]);
  na.deepEqual(r.resume.alertes, []);
  // Reculs par côté : voie 0 (alignement retenu), limites latérales 0 (en limite), fond 9 m (H/2).
  const b = r.volume.bande!;
  na.deepEqual([b.statut, b.reculVoieM, b.reculLateralM, b.reculLimitesM, b.profondeurM, b.empriseMaxM2, b.surfaceBandeM2], ['appliquee', 0, 0, 9, 18, 368, 461]);
  na.equal(r.resume.recul_applique_m, 9);
  na.deepEqual(r.volume.batiments!.map((x) => [x.largeurM, x.profondeurM, x.niveaux, x.unites]), [[22.91, 16, 6, 30]]);
  // Mesures indépendantes du placement : 0,75 m de la voie (façade en deux segments non alignés), 17,7 m du fond, les deux limites latérales touchées.
  const m = mesurerReculsVolume(r.volume)!;
  na.deepEqual([m.voieM, m.limitesM, m.laterales!.map((l) => l.distancesM.every((d) => d <= 0.05))], [0.75, 17.7, [true]]);
  const preuve = verifierBandeVolume(r.volume);
  na.equal(preuve.prouvee, true);
  na.ok(preuve.empriseM2 <= 368 && preuve.distanceMaxVoieM! <= 18, JSON.stringify(preuve));
  na.ok(r.resume.hauteur_indicative_m <= 19.5 && r.resume.niveaux <= 6);
  // Hypothèses du résumé (12 lignes au plus) : l'alignement retenu et sa réserve, l'implantation en limite.
  na.ok(r.volume.hypotheses.length <= 12);
  na.ok(r.resume.hypotheses.includes('Recul sur voie non réglementé (indice 9, p. 200) : alignement retenu ; le règlement demande de tenir compte de l’implantation des constructions voisines — à vérifier sur place.'));
  na.match(r.resume.hypotheses[0], /RETENUE par le volume d’étude, le recul sur voie n’étant pas réglementé .* implantation en limite séparative permise par la règle lue \(Règlement GPU — PLUi Est Ensemble, indice 1, p\. 214\) — 2 sur 2 touchées par ce volume ; limite non parallèle au pignon : contact en un point, vide en biais jusqu’à 5,2 m à traiter au plan ; retrait de 9 m sur le fond de parcelle/);
  // Contrôles : jamais « conforme » ; pleine terre par bande dite non contrôlée par le moteur.
  na.deepEqual(r.resume.controles.map((c) => `${c.cle}:${c.verdict}`), ['hauteur_max_m:a_verifier', 'niveaux_max:a_verifier', 'emprise_sol_max_pct:a_verifier', 'recul_voie_m:a_verifier',
    'recul_limites_m:a_verifier', 'pleine_terre_min_pct:a_verifier', 'stationnement_par_logement:non_controle']);
  na.match(controle(r, 'pleine_terre_min_pct').explication, /^Pleine terre par bande : NON contrôlée par le moteur de volume\. Mesure : 94 m² non bâtis dans la bande principale, soit 20,5 % pour 15 % de pleine terre exigés ; la bande secondaire \(355 m²\) n’est pas construite \(50 % de pleine terre exigés\)/);
  na.equal(controle(r, 'stationnement_par_logement').explication, '15 places requises pour 30 logements : stationnement non modélisé dans le volume d’étude.');
  na.ok(r.resume.regles_non_appliquees.length <= 12 && r.resume.regles_non_appliquees.some((l) => /pleine terre .* NON contrôlée bande par bande par le moteur de volume/.test(l)));
  na.ok(!JSON.stringify(r.resume).includes('conforme'));
});

Deno.test('C11-3 : mêmes règles NON confirmées ou non citées — comportement prudent du lot C10, inchangé (7 logements, recul de 4,5 m partout)', async () => {
  const attendu = [176, 3, 527, 7, 4.5];
  const cas: [string, unknown[]][] = [
    ['voie et limites estimées', REGLES_17H01.map((r) => (r.cle === 'recul_voie_m' || r.cle === 'recul_limites_m' ? { ...r, statut: 'estime' } : r))],
    ['voie et limites sans article', REGLES_17H01.map((r) => (r.cle === 'recul_voie_m' || r.cle === 'recul_limites_m' ? { ...r, article: null } : r))],
    ['voie absente, limite sans option « sur limite »', REGLES_17H01.filter((r) => r.cle !== 'recul_voie_m').map((r) => (r.cle === 'recul_limites_m' ? { ...r, alternatives: [] } : r))],
  ];
  for (const [nom, regles] of cas) {
    const r = prete(await preparerVolume(conception(30, regles)));
    na.deepEqual([r.resume.emprise_batie_m2, r.resume.niveaux, r.resume.sdp_estimee_m2, r.resume.logements_places, r.resume.recul_applique_m], attendu, nom);
    na.deepEqual([r.volume.bande?.statut, r.volume.bande?.reculVoieM, r.volume.bande?.reculLateralM], ['appliquee', undefined, undefined], nom);
    na.match(r.resume.hypotheses[0], /^Recul de 4,5 m sur toutes les limites, côté voie compris/, nom);
    const m = mesurerReculsVolume(r.volume)!;
    na.ok(m.voieM >= 4.48 && m.limitesM! >= 4.48, `${nom} : ${JSON.stringify(m)}`);
  }
});

Deno.test('C11-4 : sans parcelles voisines (côté voie non situé) — ni alignement ni implantation en limite : calcul prudent sur toute la parcelle', async () => {
  const r = prete(await preparerVolume(conception(30, REGLES_17H01, { ...PARCELLE, voisines: undefined })));
  na.equal('bande' in r.volume, false);
  na.ok(r.resume.emprise_batie_m2 <= 0.2 * r.resume.surface_parcelle_m2, `${r.resume.emprise_batie_m2} m² pour 20 % de ${r.resume.surface_parcelle_m2} m²`);
  na.ok(r.resume.niveaux <= 4 && r.resume.hauteur_indicative_m <= 13.5);
  na.match(r.resume.hypotheses[0], /sur toutes les limites/);
  na.match(r.resume.regles_non_appliquees.join(' | '), /recul_limites_m : 0 m \(implantation en limite séparative permise\) — non appliqué : le volume garde un retrait sur les limites séparatives/);
  na.match(controle(r, 'recul_voie_m').explication, /n’en déduit pas l’implantation à l’alignement/);
  // Tout bâtiment tient au retrait de la formule (H/2, minimum 3 m) de TOUTES les limites.
  na.ok(r.resume.recul_applique_m >= Math.max(3, r.resume.hauteur_indicative_m / 2) - 1e-9);
});

Deno.test('C11-5 : formule « H/2 et 3 mètres minimum » — le minimum de 3 m est lu (il était perdu) et affiché avec la règle appliquée', async () => {
  // Un collectif part de R+2 (H/2 = 4,5 m) : le minimum ne change pas ce volume ; il compte pour un bâtiment bas (maisons : test du site).
  const r = prete(await preparerVolume(conception(6, modifier('recul_limites_m', { valeur: 3, alternatives: [] }))));
  na.ok(r.resume.regles_appliquees.some((l) => /^Recul aux limites séparatives : H\/2, min\. 3 m — recul recalculé pour H = /.test(l)), r.resume.regles_appliquees.join(' | '));
  na.ok(r.volume.bande!.reculLimitesM! >= 3);
});

Deno.test('C11-6 : résumé compact de la mission — implantation, plafonds et recul transmis, sans dépasser le plafond du résultat d’outil', async () => {
  // Programme non atteint (règles estimées → calcul prudent en bande) : le modèle reçoit de quoi dire POURQUOI.
  const r = prete(await preparerVolume(conception(30, REGLES_17H01.map((x) => (x.cle === 'recul_voie_m' || x.cle === 'recul_limites_m' ? { ...x, statut: 'estime' } : x)))));
  const c = resumeCompact(r.resume) as Record<string, unknown>;
  na.deepEqual([c.logements_places, c.logements_vises, c.programme_atteint, c.recul_applique_m], [7, 30, false, 4.5]);
  na.match(String(c.implantation), /^Recul de 4,5 m sur toutes les limites, côté voie compris/);
  na.equal((c.plafonds as string[]).length, 3);
  na.match((c.plafonds as string[]).join(' | '), /Emprise au sol : .* pour 368 m² max\. dans la bande principale/);
  na.ok(JSON.stringify(c).length < RESULTAT_OUTIL_MAX_CARS - 900, `résumé compact de ${JSON.stringify(c).length} caractères`);
  // Volume de 17 h 01 corrigé (programme atteint) : ni implantation ni plafonds dans le résumé compact, seulement le recul.
  const ok = resumeCompact(prete(await preparerVolume(conception(30, REGLES_17H01))).resume) as Record<string, unknown>;
  na.deepEqual([ok.programme_atteint, ok.recul_applique_m, 'implantation' in ok, 'plafonds' in ok], [true, 9, false, false]);
});
