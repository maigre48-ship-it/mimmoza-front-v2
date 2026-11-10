// node --test src/spaces/copilot/results/apiResultModel.cartesPlu.test.ts
// LOT C3 — cartes « Règles du PLU », « Zonage d'urbanisme » et « parcelle » : formes RÉELLES des sorties du serveur
// (index.ts : donneesReglementLu, donneesReglementAPreciser, summarizeGpu ; gpu-parcelle-v1 : zone_principale = { zone, … }).
// Valeurs : essais témoins du 10/11/2026 à Montreuil (zone UC91Jb2, parcelle 93048000AS0249 de 804 m²).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiResult } from './apiResultModel.ts';

const carte = (name: string, data: unknown, status = 'ok', message?: string) =>
  buildApiResult({ id: 't', name, status: status === 'ok' ? 'success' : 'error', output: { status, source: 'Source de test', data, ...(message ? { message } : {}) } })!;
const valeur = (m: ReturnType<typeof carte>, label: string) => m.metrics.find((x) => x.label === label)?.value;
const sansNonRenseigne = (m: ReturnType<typeof carte>) => assert.deepEqual(m.metrics.filter((x) => x.value === 'Non renseigné'), []);

const ZONE_GPU = { zone: 'UC91Jb2', libelle_long: null, type_zone: 'U', sens_type_zone: 'zone urbaine', document_urbanisme: '200057875_PLUi', reglement_fichier: null, date_validite: null, statut_gpu: null };

test('défaut du 10/11 : la zone connue du serveur s’affiche (« Zone au point : Non renseigné » venait d’une clé non lue)', () => {
  // get_zonage_plu → summarizeGpu : zone_principale est l'objet de gpu-parcelle-v1, dont le code est sous `zone`.
  const zonage = carte('get_zonage_plu', { empty: false, zone_principale: ZONE_GPU, zones: [ZONE_GPU] });
  assert.equal(valeur(zonage, 'Zone au point'), 'UC91Jb2');
  assert.deepEqual(zonage.tables[0].rows[0], ['UC91Jb2', 'Non renseigné', 'U']);
  // get_parcel_plu, règlement lu au Géoportail : le code est sous `zone`.
  const lu = carte('get_parcel_plu', { niveau_de_detail: 'reglement_lu', statut_lecture: 'lu dans le règlement', regle_ecrite_disponible: true, zone: 'UC91Jb2', zone_lue: 'UC', type_zone: 'U' });
  assert.equal(valeur(lu, 'Zone au point'), 'UC91Jb2');
  // get_parcel_plu, règlement trouvé mais à préciser.
  const aPreciser = carte('get_parcel_plu', { niveau_de_detail: 'a_preciser', raison: 'choix_requis', zone: 'UC91Jb2', type_zone: 'U', nb_pages: 635 });
  assert.equal(valeur(aPreciser, 'Zone au point'), 'UC91Jb2');
  // get_parcel_plu, repli sur le zonage : sortie du GPU + niveau_de_detail.
  const repli = carte('get_parcel_plu', { empty: false, zone_principale: ZONE_GPU, zones: [ZONE_GPU], niveau_de_detail: 'zonage_seul', statut_lecture: 'zonage seul', regle_ecrite_disponible: false });
  assert.equal(valeur(repli, 'Zone au point'), 'UC91Jb2');
  for (const m of [zonage, lu, aPreciser, repli]) sansNonRenseigne(m);
});

test('sans règles structurées, la carte ne liste pas cinq règles « Non renseigné » : elle dit ce qui manque', () => {
  const lu = carte('get_parcel_plu', { niveau_de_detail: 'reglement_lu', zone: 'UC91Jb2' });
  assert.deepEqual(lu.metrics.map((x) => [x.label, x.value]), [['Zone au point', 'UC91Jb2'], ['Lecture', 'Règlement écrit lu']]);
  assert.equal(lu.state, 'ready');
  assert.match(lu.notes.join(' '), /règlement écrit a été lu.*aucune valeur chiffrée/);
  assert.equal(/Zonage seul/.test(lu.notes.join(' ')), false);

  const aPreciser = carte('get_parcel_plu', { niveau_de_detail: 'a_preciser', zone: 'UC91Jb2' });
  assert.deepEqual(aPreciser.metrics.map((x) => x.value), ['UC91Jb2', 'Règlement trouvé, lecture à préciser']);
  assert.equal(aPreciser.state, 'partial');
  assert.match(aPreciser.notes.join(' '), /pas encore lu/);

  const repli = carte('get_parcel_plu', { zone_principale: ZONE_GPU, zones: [ZONE_GPU], niveau_de_detail: 'zonage_seul' });
  assert.deepEqual(repli.metrics.map((x) => x.value), ['UC91Jb2', 'Zonage seul']);
  assert.equal(repli.state, 'partial');
  assert.match(repli.notes.join(' '), /règles.*ne sont pas connues/);

  // Zone inconnue du serveur : aucune ligne, plutôt qu'une ligne « Non renseigné ».
  const sansZone = carte('get_parcel_plu', { niveau_de_detail: 'a_preciser', zone: null });
  assert.equal(valeur(sansZone, 'Zone au point'), undefined);
});

test('avec des règles structurées (PLU importé), une règle absente reste dite : le contrat existant est inchangé', () => {
  const m = carte('get_parcel_plu', { zone_code: 'UA', regles: { hauteur_max_m: 12, emprise_sol_max_ratio: 0.4, recul_voirie_m: null } });
  assert.deepEqual(m.metrics.map((x) => [x.label, x.value]), [
    ['Zone au point', 'UA'], ['Hauteur maximale', '12 m'], ['Emprise maximale', '40 %'], ['Recul sur voie', 'Non renseigné'],
    ['Recul séparatif', 'Non renseigné'], ['Stationnement', 'Non renseigné'],
  ]);
  assert.equal(m.state, 'partial');
});

test('défaut du 10/11 : la consigne interne de note_repli n’est plus dans la carte (réponses déjà enregistrées comprises)', () => {
  const ancienne =
    "Aucun règlement de PLU n'a été importé sur la page Foncier et le règlement écrit n'a pas pu être lu automatiquement au Géoportail de l'urbanisme (voir lecture_reglement_gpu)" +
    " : ces éléments se limitent au ZONAGE OPPOSABLE (code de zone, type U/AU/A/N). " +
    "Les règles CHIFFRÉES — hauteur maximale, emprise au sol, retraits, stationnement, OAP — ne " +
    "sont PAS disponibles ici : ne les invente sous aucun prétexte. Dis à l'utilisateur que pour " +
    "les obtenir il peut joindre le PDF du règlement au chat (lecture ciblée de sa zone, jusqu'à 50 Mo) " +
    "ou l'importer sur la page Foncier de Mimmoza.";
  const m = carte('get_parcel_plu', { zone_principale: ZONE_GPU, zones: [ZONE_GPU], niveau_de_detail: 'zonage_seul', note_repli: ancienne,
    consignes: "Ne les invente sous aucun prétexte. Dis à l'utilisateur…" });
  const visible = JSON.stringify(m);
  assert.equal(/invente|prétexte|utilisateur|lecture_reglement_gpu/.test(visible), false, visible);
  assert.match(m.notes.join(' '), /ne sont PAS disponibles ici\./);
});

test('le message d’un outil sans résultat n’affiche que son constat', () => {
  const m = carte('get_parcel_plu', undefined, 'not_found',
    "Aucune donnée PLU disponible : le règlement n'a pas été importé sur la page Foncier de Mimmoza, " +
    "et le Géoportail de l'urbanisme ne renvoie aucun zonage sur ce point (commune non numérisée, " +
    "localisation trop imprécise, ou commune au RNU). " +
    "Invite l'utilisateur à uploader le PDF du PLU. N'invente aucune règle d'urbanisme ni aucune OAP, " +
    "et ne conclus SURTOUT PAS que le terrain est constructible ou non.");
  assert.equal(m.state, 'empty');
  assert.match(m.summary!, /^Aucune donnée PLU disponible .*commune au RNU\)\.$/);
  assert.equal(/utilisateur|invente|conclus/i.test(m.summary!), false);
  const abc = carte('get_zonage_abc', undefined, 'not_found', "Aucune zone identifiable. Demande à l'utilisateur le code postal ou la commune.");
  assert.equal(abc.summary, 'Aucune zone identifiable.');
});

test('carte parcelle : pas de ligne « Zone : Non renseigné » quand l’outil ne porte pas la zone', () => {
  // get_parcelle_depuis_adresse ne renvoie pas de zone (data : adresse, parcelle, …).
  const m = carte('get_parcelle_depuis_adresse', { adresse: { libelle: '98 Rue de Paris 93100 Montreuil', commune: 'Montreuil' }, parcelle: { idu: '93048000AS0249', contenance_m2: 804 } });
  assert.deepEqual(m.metrics.map((x) => [x.label, x.value]), [['Référence cadastrale', '93048000AS0249'], ['Surface cadastrale', '804 m²'], ['Commune', 'Montreuil']]);
  assert.equal(m.state, 'ready');
  // get_parcel_summary porte plu_zone : affichée quand elle est connue, omise quand elle est nulle.
  assert.equal(valeur(carte('get_parcel_summary', { parcel_id: '93048000AS0249', surface_m2: 804, commune: 'Montreuil', plu_zone: 'UC91Jb2' }), 'Zone'), 'UC91Jb2');
  assert.equal(valeur(carte('get_parcel_summary', { parcel_id: '93048000AS0249', surface_m2: 804, commune: 'Montreuil', plu_zone: null }), 'Zone'), undefined);
});
