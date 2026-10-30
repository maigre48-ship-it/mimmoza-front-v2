import test from 'node:test';
import assert from 'node:assert/strict';
import {
  construireReponseRegles, creerMessageConception, lireControles, lireMessageConception, lireMetriques, lireQuestionRegles,
  lireRegle, lireRegles, lireSuiteProposee, REGLES_CLES, TAILLE_MAX_REPONSE, VERSION_CONCEPTION, type MetriquesModele,
} from './conception.ts';

const ID = '7a7c855a-1828-4253-8a8b-3e53d0183ca6';
const SESSION = 'b4b0a7f2-1111-4222-8333-944445555666';
const METRIQUES: MetriquesModele = {
  emprise_m2: 900, sdp_m2: 3200, shab_m2: 2800, nb_logements: 40,
  typologies: { T1: 4, T2: 12, T3: 14, T4: 8, T5: 2 }, niveaux: 5, hauteur_m: 15.5, pleine_terre_m2: 1100,
  places_stationnement: 40, precision: 'dessin',
};
const PARCELLE = { idu: '93048000AJ0209', geometrie: { type: 'Polygon', coordinates: [[[2.44, 48.86], [2.45, 48.86], [2.45, 48.87], [2.44, 48.86]]] }, surface_m2: 3554, source: 'cadastre' };

test('règles : source obligatoire, valeur absente ⇒ manquant, doublons écartés', () => {
  assert.equal(lireRegle({ cle: 'hauteur_max_m', valeur: 18, unite: 'm', statut: 'confirme' }), null, 'sans source');
  assert.equal(lireRegle({ cle: 'inconnue', valeur: 1, statut: 'estime', source: 'x' }), null);
  const r = lireRegle({ cle: 'emprise_sol_max_pct', valeur: null, unite: '%', statut: 'confirme', source: 'moteur' });
  assert.equal(r?.statut, 'manquant');
  assert.equal(lireRegle({ cle: 'recul_limites_formule', valeur: 'H/2 min 4 m', statut: 'confirme', source: 'règlement', article: 'UC 7' })?.valeur, 'H/2 min 4 m');
  assert.equal(lireRegle({ cle: 'hauteur_max_m', valeur: -3, statut: 'estime', source: 's' })?.statut, 'manquant');
  assert.equal(lireRegles([{ cle: 'niveaux_max', valeur: 5, statut: 'estime', source: 'a' }, { cle: 'niveaux_max', valeur: 6, statut: 'estime', source: 'b' }]).length, 1);
});

test('métriques et contrôles : validation, typologies complétées, limite inconnue ⇒ ok null', () => {
  assert.deepEqual(lireMetriques(METRIQUES), METRIQUES);
  assert.equal(lireMetriques({ ...METRIQUES, sdp_m2: -1 }), null);
  assert.equal(lireMetriques({ ...METRIQUES, precision: 'magie' }), null);
  assert.equal(lireMetriques({ ...METRIQUES, typologies: { T2: 3 } })?.typologies.T1, 0);
  assert.equal(lireMetriques({ ...METRIQUES, nb_logements: null })?.nb_logements, null, 'logements non comptables : null accepté');
  assert.equal(lireMetriques({ ...METRIQUES, nb_logements: undefined })?.nb_logements, null);
  assert.equal(lireMetriques({ ...METRIQUES, nb_logements: -2 }), null);
  assert.equal(lireMetriques({ ...METRIQUES, nb_logements: '40' }), null);
  const c = lireControles([{ cle: 'hauteur_max_m', valeur_modele: 15.5, limite: 18, ok: true }, { cle: 'recul_voie_m', valeur_modele: 2, limite: null, ok: true }]);
  assert.equal(c[0].ok, true);
  assert.equal(c[1].ok, null, 'une règle inconnue ne peut pas être respectée');
});

test('messages : aller-retour de chaque canal, session et version contrôlées', () => {
  const signee = 'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/agent-conception/u/c/plan-1.pdf?token=abc';
  const ouvrir = creerMessageConception('conception.ouvrir', SESSION, { conception_id: ID, parcelle: PARCELLE as never, regles: [], programme: null, plan_source: 'auto', plan_url: signee });
  const lu = lireMessageConception(JSON.parse(JSON.stringify(ouvrir)));
  assert.ok(lu.ok);
  if (lu.ok && lu.message.canal === 'conception.ouvrir') assert.equal(lu.message.charge.plan_url, signee);
  for (const autre of ['https://x.supabase.co/storage/v1/object/sign/a', 'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/public/a', '/studio/plan.pdf', 'https://fwvrqngbafqdaekbdfnm.supabase.co.evil.fr/storage/v1/object/sign/a']) {
    const l = lireMessageConception({ ...ouvrir, charge: { ...ouvrir.charge, plan_url: autre } });
    assert.ok(l.ok && l.message.canal === 'conception.ouvrir' && l.message.charge.plan_url === undefined, autre);
  }
  const metr = creerMessageConception('conception.metriques', SESSION, { conception_id: ID, version_locale: 3, metriques: METRIQUES, conformite: [], resume: 'R+4' });
  assert.ok(lireMessageConception(metr).ok);
  const enr = { ...creerMessageConception('conception.enregistrer', SESSION, { conception_id: ID, version_locale: 4, metriques: METRIQUES, conformite: [], resume: '', modele: { a: 1 }, origine: 'generation' }) };
  assert.ok(lireMessageConception(enr).ok);
  assert.ok(lireMessageConception(creerMessageConception('conception.demander_enregistrement', SESSION, { conception_id: ID })).ok);
  assert.ok(lireMessageConception(creerMessageConception('conception.enregistre', SESSION, { conception_id: ID, version_locale: 4, ok: true, n: 2 })).ok);
  assert.ok(lireMessageConception(creerMessageConception('conception.pret', SESSION, { capacites: ['dessin', 'auto'] })).ok);
  assert.equal(lireMessageConception({ ...metr, version: VERSION_CONCEPTION + 1 }).ok, false);
  assert.equal(lireMessageConception({ ...metr, sessionId: 'x' }).ok, false);
  assert.equal(lireMessageConception({ ...metr, canal: 'conception.inconnu' }).ok, false);
  assert.equal(lireMessageConception({ ...enr, charge: { ...enr.charge, modele: null } }).ok, false);
  const piege = lireMessageConception({ ...ouvrir, charge: { ...ouvrir.charge, plan_url: 'javascript:alert(1)' } });
  assert.ok(piege.ok && piege.message.canal === 'conception.ouvrir' && piege.message.charge.plan_url === undefined);
});

test('question structurée : toutes les règles clés présentes, texte libre ignoré', () => {
  assert.equal(lireQuestionRegles('Quel est votre budget ?'), null);
  const q = lireQuestionRegles(JSON.stringify({ type: 'regles_conception', version: 1, idu: '93048000AJ0209', conception_id: ID, message: 'Vérifiez', regles: [{ cle: 'hauteur_max_m', valeur: 18, unite: 'm', statut: 'estime', source: 'moteur de règles' }] }));
  assert.ok(q);
  assert.equal(q!.regles.length, REGLES_CLES.length);
  assert.equal(q!.regles.find((r) => r.cle === 'hauteur_max_m')!.valeur, 18);
  assert.equal(q!.regles.find((r) => r.cle === 'emprise_sol_max_pct')!.statut, 'manquant');
});

test('réponse : JSON ≤ 4 000 caractères, vide ⇒ manquant, lecture du règlement seulement si déposé', () => {
  const json = construireReponseRegles(
    [{ cle: 'hauteur_max_m', valeur: 18, unite: 'm', article: 'UC 10' }, { cle: 'emprise_sol_max_pct', valeur: null, unite: '%' }, { cle: 'recul_limites_formule', valeur: '  ', unite: 'formule' }],
    { reglement: null, lire_reglement: true, commentaire: 'x'.repeat(5000) },
  );
  assert.ok(json.length <= TAILLE_MAX_REPONSE);
  const o = JSON.parse(json);
  assert.equal(o.type, 'reponse_regles_conception');
  assert.deepEqual(o.regles.map((r: { statut: string }) => r.statut), ['confirme', 'manquant', 'manquant']);
  assert.equal(o.regles[0].source, 'utilisateur');
  assert.equal(o.regles[0].article, 'UC 10');
  assert.equal(o.lire_reglement, false, 'pas de règlement déposé');
  const avec = JSON.parse(construireReponseRegles([], { reglement: 'u/c/reglement-1.pdf', lire_reglement: true }));
  assert.equal(avec.lire_reglement, true);
});

test('suite proposée : terrains triés par rang', () => {
  const s = lireSuiteProposee({ type: 'conception', texte: 'Concevoir ?', terrains: [{ idu: 'B', rang: 2, raison: 'r2' }, { idu: 'A', rang: 1 }] });
  assert.deepEqual(s?.terrains.map((t) => t.idu), ['A', 'B']);
  assert.equal(lireSuiteProposee({ type: 'autre', terrains: [] }), null);
});
