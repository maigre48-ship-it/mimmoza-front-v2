import test from 'node:test';
import assert from 'node:assert/strict';
import type { MetriquesModele, RegleConception } from '../../../promoteur/shared/echangeStudio/conception.ts';
import { construireModeleRapport } from '../rapport/rapportModele.ts';
import { construireClasseurBilan, LIGNE_HYP } from '../rapport/bilanExcel.ts';
import {
  avertissementSaisie, ouvertureInitiale, RE_NOM_MODELE, suffixeAleatoire, transitionOuverture, type EtatOuverture, type EvenementOuverture,
  lireConceptionPrete, bilanVersion, cheminModele, cheminPlan, cheminReglement, conformiteAffichee, dossierReglement, ecartsBilan, entreesConception,
  lignesFormulaire, lireConception, lireSaisie, messageLancerConception, modeleRapportVersion, peutTraiter, prochainNumero,
  resumeConformite, texteDelta,
} from './conceptionLogique.ts';
import { calculerChargeFonciere, hypothesesVides } from '../../../../../supabase/functions/copilot-chat/agent/rapport.ts';

const M: MetriquesModele = {
  emprise_m2: 1000, sdp_m2: 3000, shab_m2: 2600, nb_logements: 38, typologies: { T1: 2, T2: 12, T3: 14, T4: 8, T5: 2 },
  niveaux: 5, hauteur_m: 16, pleine_terre_m2: 700, places_stationnement: 30, precision: 'dessin',
};
const HC = {
  programme: { nb_logements: 40, shab_m2: 2800, sdp_m2: 3200, gabarit: 'R+4' },
  prix_vente_libre_eur_m2_shab: 5850, source_prix: 'DVF', part_lls_pct: 0, prix_cession_lls_eur_m2_shab: 2600,
  cout_travaux_eur_m2_sdp: 2100, source_couts: 'barème', honoraires_pct_travaux: 12, aleas_pct_travaux: 5,
  commercialisation_pct_ca: 5, frais_financiers_pct_ca: 2, frais_acquisition_pct_foncier: 8,
  taxes_urbanisme_eur: 250000, vrd_eur: 150000, demolition_eur: 0, marge_cible_pct_ca: 10,
};
const RAPPORT = construireModeleRapport({ objectif: 'x', type: 'prospection_fonciere' }, {
  version: 2, titre: 'T', synthese: 's', hypotheses_communes: HC,
  terrains: [{ idu: '93048000AJ0209', rang: 1, commune: 'Montreuil', surface_m2: 3554, bilan: { hypotheses_specifiques: { demolition_eur: 120000 }, statut: 'complet', manques: [] } }],
})!;
const regle = (cle: RegleConception['cle'], valeur: number | string | null, statut: RegleConception['statut'] = 'confirme'): RegleConception =>
  ({ cle, valeur, unite: '', statut, source: 'règlement PLUi', article: 'UC' });

test('entrées du bilan : surfaces et logements du modèle, part sociale de la règle, hypothèses du terrain', () => {
  const e = entreesConception(RAPPORT, RAPPORT.terrains[0], M, [regle('mixite_sociale_pct', 30)], 3554);
  assert.equal(e.entrees.shab_m2, 2600);
  assert.equal(e.entrees.sdp_m2, 3000);
  assert.equal(e.entrees.nb_logements, 38);
  assert.equal(e.entrees.part_lls_pct, 0.3);
  assert.equal(e.entrees.demolition_eur, 120000, 'hypothèse propre au terrain conservée');
  assert.equal(e.entrees.prix_vente_libre_eur_m2_shab, 5850);
  assert.match(e.remplacees.part_lls_pct!, /mixité sociale/);
  const sansRegle = entreesConception(RAPPORT, RAPPORT.terrains[0], M, [regle('mixite_sociale_pct', null, 'manquant')], 3554);
  assert.equal(sansRegle.entrees.part_lls_pct, 0, 'règle inconnue : on garde l’hypothèse du rapport');
});

test('bilan d’une version = moteur (calculerChargeFonciere) sur les mêmes hypothèses', () => {
  const e = entreesConception(RAPPORT, RAPPORT.terrains[0], M, [regle('mixite_sociale_pct', 30)], 3554);
  const { bilan, resultat } = bilanVersion(e);
  const moteur = calculerChargeFonciere(
    { ...hypothesesVides(), ...HC, programme: { ...HC.programme } } as never,
    { programme: { shab_m2: 2600, sdp_m2: 3000, nb_logements: 38 }, part_lls_pct: 30, demolition_eur: 120000 } as never,
    3554,
  );
  assert.equal(bilan.charge_fonciere_admissible_ht, moteur.charge_fonciere_admissible_ht);
  assert.equal(bilan.ca_ht, moteur.ca_ht);
  assert.equal(bilan.statut, 'complet');
  assert.equal(bilan.marge_cible_pct_ca, 10, 'pourcentages en POURCENT comme le rapport v2');
  assert.equal(bilan.hypotheses_specifiques.part_lls_pct, 30);
  assert.equal(bilan.source, 'bilan_vivant');
  assert.ok(resultat.chargeFonciere! > 0);
  const sansRapport = bilanVersion(entreesConception(null, null, M, [], 3554));
  assert.equal(sansRapport.bilan.charge_fonciere_admissible_ht, null, 'sans hypothèses de prix : pas de chiffre inventé');
  assert.ok(sansRapport.bilan.manques.includes('Prix de vente libre (par m² SHAB)'));
});

test('écarts entre versions et texte des écarts', () => {
  const avant = { resultat: { ca: 100, coutsHorsFoncier: 50, chargeFonciere: 40 }, sdp: 3000 };
  const apres = { resultat: { ca: 130, coutsHorsFoncier: 50, chargeFonciere: null }, sdp: 3200 };
  const e = ecartsBilan(avant, apres)!;
  assert.equal(e.ca!.delta, 30);
  assert.equal(e.chargeFonciere, null);
  assert.equal(ecartsBilan(null, apres), null);
  assert.equal(texteDelta(120000), '+120 000 €');
  assert.equal(texteDelta(-4500), '−4 500 €');
  assert.equal(texteDelta(0.2), '=');
});

test('conformité : studio prioritaire, calcul depuis les métriques, inconnue jamais « respectée »', () => {
  const regles = [regle('hauteur_max_m', 15), regle('niveaux_max', 5), regle('emprise_sol_max_pct', 40), regle('pleine_terre_min_pct', 25),
    regle('stationnement_par_logement', 1), regle('recul_voie_m', 5), regle('recul_limites_m', null, 'manquant')];
  const l = conformiteAffichee(regles, [{ cle: 'recul_voie_m', valeur_modele: 4, limite: 5, ok: false, ecart: 'Recul de 4 m' }], M, 3554);
  const par = Object.fromEntries(l.map((x) => [x.cle, x]));
  assert.equal(par.hauteur_max_m.ok, false);
  assert.match(par.hauteur_max_m.ecart!, /Dépasse de 1 m/);
  assert.equal(par.niveaux_max.ok, true);
  assert.equal(par.emprise_sol_max_pct.ok, true); // 1000 / 3554 = 28 %
  assert.equal(par.pleine_terre_min_pct.ok, false); // 700 / 3554 = 19,7 %
  assert.equal(par.stationnement_par_logement.ok, false); // 30 < 38
  assert.equal(par.stationnement_par_logement.unite, 'places', 'limite calculée en places, pas en places/logement');
  assert.equal(par.stationnement_par_logement.limite, 38);
  assert.equal(par.recul_voie_m.origine, 'studio');
  assert.equal(par.recul_limites_m.ok, null);
  assert.equal(par.mixite_sociale_pct.ok, null);
  assert.deepEqual(resumeConformite(l), { ok: 2, depassements: 4, inconnues: 3 });
  assert.equal(conformiteAffichee([regle('emprise_sol_max_pct', 40)], [], M, null).find((x) => x.cle === 'emprise_sol_max_pct')!.ok, null, 'sans surface : non contrôlée');
});

test('formulaire : pré-remplissage et saisies (vide/inconnu ⇒ null, bornes)', () => {
  const lignes = lignesFormulaire({ type: 'regles_conception', version: 1, message: 'm', idu: 'X', regles: [regle('hauteur_max_m', 18.5, 'estime')] });
  assert.equal(lignes[0].saisie, '18,5');
  const l = { cle: 'emprise_sol_max_pct' as const, formule: false, unite: '%' };
  assert.deepEqual(lireSaisie(l, '45,5', false), { ok: true, valeur: 45.5 });
  assert.deepEqual(lireSaisie(l, '', false), { ok: true, valeur: null });
  assert.deepEqual(lireSaisie(l, '12', true), { ok: true, valeur: null });
  assert.equal(lireSaisie(l, '140', false).ok, false);
  assert.equal(lireSaisie({ cle: 'niveaux_max', formule: false, unite: 'niveaux' }, '4,5', false).ok, false);
  assert.deepEqual(lireSaisie({ cle: 'recul_limites_formule', formule: true, unite: 'formule' }, 'H/2', false), { ok: true, valeur: 'H/2' });
});

test('chemins du bucket : <uid>/<conception>/<nom> en minuscules, formats et tailles', () => {
  const d = new Date('2026-10-31T09:05:07Z');
  const p = cheminPlan('u1', 'c1', { type: 'application/pdf', size: 1000 }, d);
  assert.deepEqual(p, { ok: true, chemin: 'u1/c1/plan-20261031-090507.pdf', type: 'application/pdf' });
  assert.equal(cheminPlan('u1', 'c1', { type: 'image/gif', size: 10 }).ok, false);
  assert.equal(cheminReglement('u1', 'c1', { type: 'application/pdf', size: 4 * 1024 * 1024 }).ok, false, 'au-delà de 3 Mo, l’agent ne lit pas');
  assert.equal(cheminReglement('u1', 'c1', { type: 'application/pdf', size: 2 * 1024 * 1024 }, d).ok, true);
  assert.equal(cheminModele('u1', 'c1', 3, 'a1b2c3d4'), 'u1/c1/modele-v3-a1b2c3d4.mstudio.json');
  assert.equal(suffixeAleatoire(new Uint8Array([1, 171, 255, 16])), '01abff10');
  assert.match(suffixeAleatoire(), /^[a-f0-9]{8}$/);
  assert.notEqual(suffixeAleatoire(), suffixeAleatoire(), 'un nom neuf à chaque essai');
  assert.ok(RE_NOM_MODELE.test('modele-v3-a1b2c3d4.mstudio.json'));
  assert.ok(!RE_NOM_MODELE.test('modele-v3-A1B2.mstudio.json'));
  assert.ok(!RE_NOM_MODELE.test('modele-v03-a1b2c3d4.mstudio.json'));
  assert.ok(RE_NOM_MODELE.test(cheminModele('u', 'c', 12, suffixeAleatoire()).split('/')[2]), 'le nom produit respecte la politique du bucket');
  assert.equal(dossierReglement({ conception_id: 'abcdef12-0000' }, 'u1'), 'abcdef12-0000');
  assert.equal(dossierReglement({ dossier_reglement: 'u1/abcdef12-3456/' }, 'u1'), 'abcdef12-3456');
  assert.equal(dossierReglement({ dossier_reglement: 'autre/abcdef12-3456' }, 'u1'), null);
  assert.equal(dossierReglement({}, 'u1'), null);
});

test('divers : conception lue, numéro de version, débit, message de lancement', () => {
  const c = lireConception({ id: 'c1', idu: 'I', regles_plu: [regle('hauteur_max_m', 12)], parcelle: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, statut: 'plan', version_courante: 2 });
  assert.equal(c?.parcelle?.geometrie.type, 'Polygon');
  assert.equal(c?.regles.length, 1);
  assert.equal(prochainNumero([{ n: 1 }, { n: 3 }]), 4);
  assert.equal(peutTraiter(null, 0), true);
  assert.equal(peutTraiter(1000, 1500), false);
  assert.match(messageLancerConception({ idu: 'I', commune: 'Montreuil' }, 'm1'), /mission_origine_id m1/);
});

test('bilan Excel de la version : surfaces du modèle en valeurs propres au terrain', () => {
  const e = entreesConception(RAPPORT, RAPPORT.terrains[0], M, [regle('mixite_sociale_pct', 30)], 3554);
  const m = modeleRapportVersion(RAPPORT, { idu: '93048000AJ0209', commune: 'Montreuil', parcelle: null }, e, 2);
  assert.equal(m.terrains.length, 1);
  const h = construireClasseurBilan(m).getWorksheet('Hypothèses')!;
  assert.equal(h.getCell(`D${LIGNE_HYP.sdp_m2}`).value, 3000);
  assert.equal(h.getCell(`D${LIGNE_HYP.part_lls_pct}`).value, 0.3);
  assert.equal(h.getCell(`C${LIGNE_HYP.sdp_m2}`).value, 3200, 'valeur commune du rapport conservée pour comparaison');
  assert.match(m.titre, /version 2/);
});

test('rapport de conception : règles, manquantes en libellés, prochaine étape', () => {
  const c = lireConceptionPrete({ conception: { conception_id: 'abc12345-0000', idu: 'I', commune: 'Montreuil', parcelle: { surface_m2: 3554, source: 'cadastre' },
    regles: [regle('hauteur_max_m', 15)], regles_manquantes: ['emprise_sol_max_pct'], alertes_programme: ['SHAB élevée'], prochaine_etape: 'Choisir la voie du plan' } });
  assert.equal(c?.surface_m2, 3554);
  assert.deepEqual(c?.regles_manquantes, ['Emprise au sol maximale']);
  assert.equal(lireConceptionPrete({ titre: 'x' }), null);
});

test('ouverture : conception.ouvrir envoyé UNE fois par session malgré les « prêt » répétés', () => {
  const jouer = (evs: EvenementOuverture[]) => {
    let e: EtatOuverture = ouvertureInitiale(); let envois = 0;
    for (const ev of evs) { const t = transitionOuverture(e, ev); e = t.etat; if (t.envoyer) envois++; }
    return { e, envois };
  };
  // Studio récent : prêt (×3, toutes les 2 s), conception.pret, puis le délai de secours tombe.
  assert.equal(jouer(['cadre_pret', 'cadre_pret', 'conception_pret', 'cadre_pret', 'delai_envoi', 'conception_pret', 'metriques', 'delai_ancien']).envois, 1);
  // Studio qui n'annonce pas conception.pret : un seul envoi, au délai de secours.
  const ancien = jouer(['cadre_pret', 'cadre_pret', 'delai_envoi', 'cadre_pret', 'delai_envoi', 'delai_ancien']);
  assert.equal(ancien.envois, 1);
  assert.equal(ancien.e.studioAncien, true, 'ni conception.pret ni métriques en 10 s : Atelier à mettre à jour');
  // Des métriques arrivent quand même : plus « ancien ».
  assert.equal(jouer(['cadre_pret', 'delai_envoi', 'metriques', 'delai_ancien']).e.studioAncien, false);
  // Rien avant le premier « prêt ».
  assert.equal(jouer(['delai_envoi']).envois, 0);
});

test('saisie : une fraction pour une règle en % déclenche un avertissement', () => {
  assert.equal(avertissementSaisie({ unite: '%', inconnu: false }, 0.4), 'Vouliez-vous dire 40 % ?');
  assert.equal(avertissementSaisie({ unite: '%', inconnu: false }, 40), null);
  assert.equal(avertissementSaisie({ unite: 'm', inconnu: false }, 0.5), null);
  assert.equal(avertissementSaisie({ unite: '%', inconnu: true }, 0.4), null);
});

test('logements non comptables (null) : bilan calculé sur la SHAB, stationnement non contrôlé, jamais 0', () => {
  const m0 = { ...M, nb_logements: null };
  const e = entreesConception(RAPPORT, RAPPORT.terrains[0], m0, [], 3554);
  assert.equal(e.entrees.nb_logements, null);
  assert.match(e.remplacees.nb_logements!, /à préciser/);
  const { bilan } = bilanVersion(e);
  assert.ok(bilan.ca_ht! > 0, 'le CA reste calculé sur la SHAB');
  assert.equal(bilan.hypotheses_specifiques.nb_logements, null);
  const st = conformiteAffichee([regle('stationnement_par_logement', 1)], [], m0, 3554).find((x) => x.cle === 'stationnement_par_logement')!;
  assert.equal(st.ok, null);
  assert.match(st.ecart!, /à préciser/);
});
