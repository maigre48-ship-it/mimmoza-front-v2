// deno test supabase/functions/copilot-chat/agent/conception.test.ts — logique pure, sans réseau.
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);

import {
  appliquerReponseFormulaire, cheminReglementAutorise, chercherContourParcelle, completerRegles, construireQuestionRegles,
  controlerProgramme, fusionnerRegles, normaliserProgramme, normaliserRegle, QUESTION_MAX_CARS, reglesDepuisLecture,
  reglesDepuisRulesets, reglesManquantes, signalementsFormules, suiteProposee,
} from './conception.ts';
import { depotSupabase, estLigneDeTest } from './depot.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;

Deno.test('règle : jamais sans source ; le statut dépend de la PROVENANCE, jamais du champ reçu', () => {
  assertEquals(normaliserRegle({ cle: 'hauteur_max_m', valeur: 15 }, 'modele'), null, 'sans source → refusée');
  assertEquals(normaliserRegle({ cle: 'inconnue', valeur: 1, source: 'x' }, 'modele'), null);
  // B2 : le modèle ne confirme JAMAIS, même avec un article (inventé ou non).
  assertEquals(normaliserRegle({ cle: 'hauteur_max_m', valeur: 15, statut: 'confirme', source: 'règlement', article: 'UC 10' }, 'modele')?.statut, 'estime');
  assertEquals(normaliserRegle({ cle: 'hauteur_max_m', valeur: 15, source: 'règlement', article: 'UC 10' }, 'reglement')?.statut, 'confirme');
  assertEquals(normaliserRegle({ cle: 'hauteur_max_m', valeur: 15, source: 'règlement' }, 'reglement')?.statut, 'estime');
  assertEquals(normaliserRegle({ cle: 'hauteur_max_m', valeur: 15, statut: 'estime', source: 'utilisateur' }, 'utilisateur')?.statut, 'confirme');
  assertEquals(normaliserRegle({ cle: 'emprise_sol_max_pct', valeur: 150, source: 'x' }, 'modele')?.statut, 'manquant', 'hors bornes → inconnue');
  assertEquals(normaliserRegle({ cle: 'recul_limites_formule', valeur: 'H/2 min 4 m', source: 'x' }, 'modele')?.valeur, 'H/2 min 4 m');
  assertEquals(completerRegles([]).length, 9);
  assertEquals(reglesManquantes([]).length, 9);
});

Deno.test('fusion (B2) : la saisie de l’utilisateur ne peut être remplacée que par l’utilisateur ; conflit PDF signalé', () => {
  const utilisateur = normaliserRegle({ cle: 'hauteur_max_m', valeur: 15, source: 'utilisateur' }, 'utilisateur')!;
  const modele = normaliserRegle({ cle: 'hauteur_max_m', valeur: 21, statut: 'confirme', source: 'get_x', article: 'UC 10' }, 'modele')!;
  const pdf = normaliserRegle({ cle: 'hauteur_max_m', valeur: 18, source: 'Règlement PDF', article: 'UC 10' }, 'reglement')!;
  const f1 = fusionnerRegles([utilisateur], [modele], 'modele');
  assertEquals(f1.regles.find((r) => r.cle === 'hauteur_max_m')!.valeur, 15, 'le modèle n’écrase pas l’utilisateur');
  const f2 = fusionnerRegles([utilisateur], [pdf], 'reglement');
  assertEquals(f2.regles.find((r) => r.cle === 'hauteur_max_m')!.valeur, 15, 'le PDF n’écrase pas l’utilisateur');
  assertEquals(f2.conflits, [{ cle: 'hauteur_max_m', valeur_utilisateur: 15, valeur_proposee: 18, source_proposee: 'Règlement PDF', article: 'UC 10' }]);
  const f3 = fusionnerRegles([pdf], [normaliserRegle({ cle: 'hauteur_max_m', valeur: 12, source: 'utilisateur' }, 'utilisateur')!], 'utilisateur');
  assertEquals(f3.regles.find((r) => r.cle === 'hauteur_max_m')!.valeur, 12, 'l’utilisateur l’emporte');
  const estimee = normaliserRegle({ cle: 'emprise_sol_max_pct', valeur: 40, source: 'import' }, 'import')!;
  const autreEstimee = normaliserRegle({ cle: 'emprise_sol_max_pct', valeur: 70, source: 'get_x' }, 'modele')!;
  assertEquals(fusionnerRegles([estimee], [autreEstimee], 'modele').regles.find((r) => r.cle === 'emprise_sol_max_pct')!.valeur, 40, 'à sûreté égale, la première reste');
});

Deno.test('règlements importés (formats réels des tables plu_*) → règles « estime » sourcées', () => {
  const r = reglesDepuisRulesets([
    { table: 'plu_manual_rulesets', libelle: 'PLU Ascain 2025', document: null, ruleset: { reculs: { voirie: { note: 'H/2 avec min 5m', min_m: 5, regle: 'H_OVER_2_MIN' } } } },
    { table: 'plu_rulesets_universal', libelle: 'PLU Ascain 2025', document: 'x.pdf', ruleset: { emprise: { emprise_max_ratio: 0.4 }, hauteur: { max_hauteur_m: 12 }, stationnement: { commentaire: 'Non spécifié' } } },
    { table: 'plu_rulesets_ai', libelle: 'extraction IA', document: null, ruleset: { hauteur: { hauteur_max: { unit: 'm', value: null } } } },
  ], 'UB');
  const par = Object.fromEntries(r.map((x) => [x.cle, x]));
  assertEquals(par.recul_voie_m.valeur, 5);
  // I2 : formule conservée et signalée, statut estimé.
  assert(String(par.recul_voie_m.texte).includes('H/2') && String(par.recul_voie_m.texte).includes('seulement le minimum'));
  assertEquals(par.recul_voie_m.statut, 'estime');
  assert(signalementsFormules(r).some((x) => x.startsWith('recul_voie_m')));
  // Nantes UA : emprise.emprise_sol_max.
  assertEquals(reglesDepuisRulesets([{ table: 'plu_manual_rulesets', libelle: 'PLU Nantes', document: null, ruleset: { emprise: { emprise_sol_max: 0.5 } } }], 'UA')[0].valeur, 50);
  assertEquals(par.emprise_sol_max_pct.valeur, 40, 'ratio 0,4 → 40 %');
  assertEquals(par.hauteur_max_m.valeur, 12);
  assert(r.every((x) => x.statut === 'estime' && x.source.includes('Règlement importé Mimmoza')));
  assert(!('stationnement_par_logement' in par), '« Non spécifié » n’est pas une règle');
});

Deno.test('question structurée : format imposé par le front, ≤ 4 000 caractères', () => {
  const longues = completerRegles([]).map((r) => ({ ...r, source: 'x'.repeat(190), texte: 'y'.repeat(390) }));
  const q = construireQuestionRegles(longues, 'Complétez les règles.', '93048000AJ0209', 'c1', 'u1');
  assert(q.length <= QUESTION_MAX_CARS);
  const j = JSON.parse(q);   // jamais de JSON tronqué : toujours analysable
  const tresLongues = completerRegles([]).map((r) => ({ ...r, source: 'z'.repeat(200), article: 'a'.repeat(60), texte: 'y'.repeat(400) }));
  const q2 = construireQuestionRegles(tresLongues, 'm'.repeat(600), '93048000AJ0209', 'c1', 'u1');
  assert(q2.length <= QUESTION_MAX_CARS && JSON.parse(q2).regles.length === 9);
  assertEquals([j.type, j.version, j.idu, j.conception_id, j.dossier_reglement, j.regles.length], ['regles_conception', 1, '93048000AJ0209', 'c1', 'u1/c1/', 9]);
});

Deno.test('réponse du formulaire : confirmé par l’utilisateur, inconnu = manquant, lecture du règlement demandée', () => {
  const actuelles = [normaliserRegle({ cle: 'hauteur_max_m', valeur: 12, source: 'import' }, 'import')!,
    normaliserRegle({ cle: 'recul_voie_m', valeur: 5, source: 'Règlement PDF déposé (x.pdf)', article: 'UC 6', texte: 'cit.' }, 'reglement')!];
  const a = appliquerReponseFormulaire(actuelles, JSON.stringify({
    type: 'reponse_regles_conception', version: 1, lire_reglement: true, reglement: 'u1/c1/reglement-plui.pdf',
    regles: [
      { cle: 'hauteur_max_m', valeur: 15, unite: 'm', statut: 'confirme', source: 'utilisateur', article: 'UC 10' },
      { cle: 'emprise_sol_max_pct', valeur: null, unite: '%', statut: 'manquant', source: 'utilisateur' },
      { cle: 'mixite_sociale_pct', valeur: 30, unite: '%', statut: 'confirme', source: 'utilisateur' },
      { cle: 'recul_voie_m', valeur: 5, unite: 'm', statut: 'confirme', source: 'utilisateur' },          // validée inchangée
      { cle: 'pleine_terre_min_pct', valeur: 250, unite: '%', statut: 'confirme', source: 'utilisateur' }, // hors bornes
    ],
  }));
  assert(a.ok);
  const par = Object.fromEntries(a.regles.map((r) => [r.cle, r]));
  assertEquals([par.hauteur_max_m.valeur, par.hauteur_max_m.statut, par.hauteur_max_m.source, par.hauteur_max_m.article], [15, 'confirme', 'utilisateur', 'UC 10']);
  assertEquals(par.emprise_sol_max_pct.statut, 'manquant');
  assertEquals(par.mixite_sociale_pct.valeur, 30);
  assertEquals([a.lire_reglement, a.reglement], [true, 'u1/c1/reglement-plui.pdf']);
  assertEquals([par.recul_voie_m.statut, par.recul_voie_m.source, par.recul_voie_m.article, par.recul_voie_m.texte],
    ['confirme', "Règlement PDF déposé (x.pdf) — confirmée par l'utilisateur", 'UC 6', 'cit.'], 'source et article d’origine gardés');
  assertEquals(par.pleine_terre_min_pct.statut, 'manquant', 'hors bornes : non appliquée');
  assert(a.hors_bornes.some((x) => x.startsWith('pleine_terre_min_pct')), 'hors bornes : signalée');
  assertEquals(appliquerReponseFormulaire(actuelles, 'texte libre').ok, false);
  assertEquals(appliquerReponseFormulaire(actuelles, JSON.stringify({ type: 'reponse_regles_conception', regles: [], lire_reglement: true })).lire_reglement, false, 'pas de chemin → pas de lecture');
});

Deno.test('chemin de règlement : uniquement dans le dossier de la conception', () => {
  assert(cheminReglementAutorise('u1/c1/reglement-plui.pdf', 'u1', 'c1'));
  assert(!cheminReglementAutorise('u2/c1/reglement-plui.pdf', 'u1', 'c1'));
  assert(!cheminReglementAutorise('u1/c1/../c2/reglement-x.pdf', 'u1', 'c1'));
  assert(!cheminReglementAutorise('u1/c1/plan-1.pdf', 'u1', 'c1'));
  assert(!cheminReglementAutorise('u1/c1/reglement-x.pdf', 'u1', null));
});

Deno.test('lecture du règlement : article cité → confirmé, sinon estimé', () => {
  const r = reglesDepuisLecture({ regles: [
    { cle: 'hauteur_max_m', valeur: 16, article: 'UC 10', texte: 'La hauteur… 16 m' },
    { cle: 'emprise_sol_max_pct', valeur: 50 },
    { cle: 'n_importe_quoi', valeur: 1, article: 'X' },
  ] }, 'u1/c1/reglement-plui.pdf');
  assertEquals(r.map((x) => [x.cle, x.statut]), [['hauteur_max_m', 'confirme'], ['emprise_sol_max_pct', 'estime']]);
  assert(r[0].source.includes('reglement-plui.pdf'));
});

Deno.test('contour cadastral : requête API Carto et forme ParcelleConception (fetch simulé)', async () => {
  const urls: string[] = [];
  const faux = (async (u: string) => {
    urls.push(String(u));
    return new Response(JSON.stringify({ features: [{ geometry: { type: 'Polygon', coordinates: [[[2.44, 48.86], [2.45, 48.86], [2.45, 48.87], [2.44, 48.86]]] }, properties: { contenance: 3554 } }] }));
  }) as unknown as typeof fetch;
  const p = await chercherContourParcelle('93048000AJ0209', faux);
  assertEquals([p?.idu, p?.surface_m2, p?.geometrie.type], ['93048000AJ0209', 3554, 'Polygon']);
  assert(urls[0].includes('code_insee=93048') && urls[0].includes('section=AJ') && urls[0].includes('numero=0209'));
  assertEquals(await chercherContourParcelle('pas-un-idu', faux), null);
});

Deno.test('programme et suite proposée', () => {
  const p = normaliserProgramme({ nb_logements: 40, typologies: { T2: 15, T3: 20, T4: 4 }, shab_cible_m2: 2800, sdp_cible_m2: 3200, gabarit: 'R+4' });
  assertEquals(controlerProgramme(p), ['La somme des typologies (39) diffère du nombre de logements (40).']);
  const s = suiteProposee([
    { idu: 'A', verdict: 'a_etudier', rang: 2 }, { idu: 'B', verdict: 'prioritaire', rang: 1 }, { idu: 'C', verdict: 'ecarte', rang: null },
  ], [{ idu: 'B', rang: 1, justification: 'Meilleure charge foncière' }]);
  assertEquals((s!.terrains as Array<{ idu: string }>).map((t) => t.idu), ['B', 'A']);
  assertEquals((s!.terrains as Array<{ raison: string }>)[0].raison, 'Meilleure charge foncière');
  assertEquals(s!.type, 'conception');
  assertEquals(suiteProposee([{ idu: 'C', verdict: 'ecarte' }], []), null);
});

Deno.test('dépôt : taille du PDF vérifiée AVANT téléchargement ; lignes de test écartées', async () => {
  let telecharge = false;
  const faux = {
    from: () => { throw new Error('non utilisé'); }, rpc: () => { throw new Error('non utilisé'); },
    storage: { from: () => ({
      list: async () => ({ data: [{ name: 'reglement-gros.pdf', metadata: { size: 50_000_000 } }], error: null }),
      download: async () => { telecharge = true; return { data: new Blob([new Uint8Array(10)]), error: null }; },
    }) },
  };
  const r = await depotSupabase(faux).telechargerFichier('agent-conception', 'u1/c1/reglement-gros.pdf', 3 * 1024 * 1024);
  assertEquals(r, { trop_gros: true, octets: 50_000_000 });
  assertEquals(telecharge, false);
  assert(estLigneDeTest({ plu_version_label: 'PLU test ingestion', zone_libelle: 'Zone UG test', ruleset: {} }));
  assert(estLigneDeTest({ commentaire: 'x', raw_rules: { notes: 'Jeu de règles simplifié pour tests Mimmoza.' } }));
  assert(!estLigneDeTest({ plu_version_label: 'PLU Ascain 2025', ruleset: { hauteur: { max_hauteur_m: 12 } } }));
  assert(estLigneDeTest({ plu_version_label: 'PLU Nantes 2024 – version test Mimmoza', ruleset: { emprise: { emprise_sol_max: 0.5 } } }), 'Nantes UA (test) écartée');
  assert(estLigneDeTest({ plu_version_label: 'Jeu Test MIMMOZA' }));
});
