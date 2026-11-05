// deno test supabase/functions/copilot-chat/agent/conception.test.ts — logique pure, sans réseau.
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);

import {
  appliquerReponseFormulaire, cheminReglementAutorise, chercherContourParcelle, completerRegles, construireQuestionRegles,
  controlerProgramme, fusionnerRegles, normaliserProgramme, normaliserRegle, QUESTION_MAX_CARS, reglesDepuisLecture,
  reglesDepuisRulesets, reglesManquantes, signalementsFormules, suiteProposee,
  centroideParcelle, cheminTexteReglement, CONSIGNE_LECTURE_REGLEMENT, REGLEMENT_LECTURE_DIRECTE_MAX_OCTETS, REGLEMENT_MAX_OCTETS,
  ajusterToiture, appliquerSecteur, decrireRegle, questionSecteur, reglesAPreciser, secteurDepuisReponse, toitureDuProjet, valeurRetenue,
  appliquerSecteursDeclares, cleSecteur, estSecteurGeographique, fusionnerSecteursDeclares, secteursDepuisCriteres, secteursDepuisTexte,
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

Deno.test('V1.8 — règlement jusqu’à 50 Mo, texte extrait à côté, centroïde de la parcelle', () => {
  assertEquals(REGLEMENT_MAX_OCTETS, 50 * 1024 * 1024);
  assertEquals(REGLEMENT_LECTURE_DIRECTE_MAX_OCTETS, 3 * 1024 * 1024);
  assertEquals(cheminTexteReglement('u/c/reglement-1.pdf'), 'u/c/reglement-1.pdf.texte.json');
  const p = { idu: 'X', surface_m2: 1, source: 't', geometrie: { type: 'Polygon' as const, coordinates: [[[2, 48], [4, 48], [4, 50], [2, 48]]] } };
  const c = centroideParcelle(p)!;
  assert(Math.abs(c.lon - 10 / 3) < 1e-9 && Math.abs(c.lat - 146 / 3) < 1e-9, 'anneau fermé : dernier sommet écarté');
  assertEquals(centroideParcelle({ ...p, geometrie: { type: 'MultiPolygon', coordinates: [[[[1, 1], [3, 1], [3, 3], [1, 1]]]] } }), { lat: 5 / 3, lon: 7 / 3 });
  assertEquals(centroideParcelle(null), null);
  assertEquals(centroideParcelle({ ...p, geometrie: { type: 'Polygon', coordinates: [] } }), null);
  assert(CONSIGNE_LECTURE_REGLEMENT('UC', 'gpu').includes("Géoportail de l'urbanisme"));
  assert(CONSIGNE_LECTURE_REGLEMENT('UC').includes('déposé par l\'utilisateur'));
  assertEquals(reglesDepuisLecture({ regles: [{ cle: 'hauteur_max_m', valeur: 12, article: 'UC 10' }] }, 'gpu', 'Règlement GPU — PLU')[0].source, 'Règlement GPU — PLU');
});

// ── Lot Q1 (A) : « pas de règle » et « règle par secteur » ne sont plus perdues ─────────
// Textes RÉELS du règlement 92050_PLU_20251209 (Nanterre, zone UC, p. 109), mission du 04/11/2026
// sur la parcelle 92050000AE0414. Aucune autre valeur réglementaire n'est utilisée ici.
const SOURCE_GPU_NANTERRE = 'Règlement GPU — 92050_PLU_20251209';
const UC9 = { cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.' };
const UC10 = {
  cle: 'hauteur_max_m', nature: 'par_secteur',
  valeur: 52,   // le modèle propose une valeur unique : elle doit être IGNORÉE tant que le secteur n'est pas connu
  article: 'UC 10, p. 109',
  texte: 'UC 10-2 : hauteur maximale fixée selon les secteurs repérés sur les documents graphiques.',
  valeurs_par_secteur: [
    // Mesures citées séparément ; `valeur` volontairement optimiste (faîtage) : elle doit être RECALCULÉE.
    { secteur: '1', valeur: 28, acrotere_terrasse: 28, egout: 26, faitage: 28, texte: '28 m à l’acrotère (toiture terrasse) ; 26 m à l’égout et 28 m au faîtage' },
    { secteur: '2', valeur: 24, acrotere_terrasse: 21, egout: 21, faitage: 24, exceptions: 'bureaux av. Clemenceau : 24 m / 26 m', texte: '21 m à l’acrotère ; 21 m à l’égout et 24 m au faîtage' },
    { secteur: '3', valeur: 12, egout: 9, faitage: 12, texte: '9 m à l’égout et 12 m au faîtage' },
    { secteur: '4', acrotere_terrasse: 52, texte: '52 m à l’acrotère' },
  ],
  renvoi_document_graphique: 'Secteurs de hauteur 1 à 4 repérés sur les documents graphiques',
  regle_relative: 'UC 10-1 : hauteur ≤ distance à l’alignement opposé + 2 m',
};

Deno.test('Q1-A : UC 9 « Il n’est pas fixé de règle » → règle NON RÉGLEMENTÉE, citée, connue (pas « inconnue »)', () => {
  const lues = reglesDepuisLecture({ regles: [UC9] }, 'gpu', SOURCE_GPU_NANTERRE);
  assertEquals(lues.length, 1, 'la règle n’est plus perdue');
  const r = lues[0];
  assertEquals([r.cle, r.nature, r.valeur, r.statut, r.article, r.source], ['emprise_sol_max_pct', 'non_reglementee', null, 'confirme', 'UC 9, p. 109', SOURCE_GPU_NANTERRE]);
  assert(!reglesManquantes(lues).includes('emprise_sol_max_pct'), 'comptée comme connue');
  assertEquals(completerRegles(lues).filter((x) => x.statut !== 'manquant').length, 1, '« 1 règle connue sur 9 »');
  // « Non réglementée » sans article cité : refusée (jamais affirmée sans preuve).
  assertEquals(normaliserRegle({ ...UC9, article: undefined, source: SOURCE_GPU_NANTERRE }, 'reglement'), null);
  // Relue depuis la base : identique (stockage rétrocompatible).
  assertEquals(normaliserRegle(r, 'base'), r);
  assertEquals(decrireRegle(r), 'emprise_sol_max_pct : non réglementée (art. UC 9, p. 109)');
});

Deno.test('Q1-A : UC 10 → règle CONDITIONNELLE PAR SECTEUR (4 secteurs, renvoi graphique, règle relative), question sur le secteur', () => {
  const lues = reglesDepuisLecture({ regles: [UC9, UC10] }, 'gpu', SOURCE_GPU_NANTERRE);
  const h = lues.find((x) => x.cle === 'hauteur_max_m')!;
  assertEquals([h.nature, h.valeur, h.statut, h.article], ['par_secteur', null, 'manquant', 'UC 10, p. 109'], 'aucune valeur choisie au jugé');
  // Détail par mesure, uniquement ce que le texte cite ; `valeur` = acrotère, sinon égout, sinon la plus petite mesure.
  const det = h.valeurs_par_secteur!.map((e) => [e.secteur, e.acrotere_terrasse ?? null, e.egout ?? null, e.faitage ?? null, e.valeur, e.exceptions ?? null]);
  assertEquals(det, [
    ['1', 28, 26, 28, 28, null],
    ['2', 21, 21, 24, 21, 'bureaux av. Clemenceau : 24 m / 26 m'],
    ['3', null, 9, 12, 9, null],
    ['4', 52, null, null, 52, null],
  ]);
  // Règle de choix : toiture non précisée → la plus restrictive ; terrasse → acrotère ; pentes → égout.
  const choix = (t: 'terrasse' | 'pentes' | null) => h.valeurs_par_secteur!.map((e) => valeurRetenue(e, t).valeur);
  assertEquals(choix(null), [26, 21, 9, 52]);
  assertEquals(choix('terrasse'), [28, 21, 9, 52]);
  assertEquals(choix('pentes'), [26, 21, 9, 52]);
  assert(valeurRetenue(h.valeurs_par_secteur![0], null).mesure.includes('type de toiture non précisé : valeur la plus restrictive retenue'));
  assert(valeurRetenue(h.valeurs_par_secteur![1], 'pentes').mesure.includes('faîtage 24 m à contrôler aussi'));
  // L'exception « bureaux » n'est jamais retenue (aucun choix ne vaut 24 ou 26 en secteur 2).
  assert(!['terrasse', 'pentes', null].some((t) => [24, 26].includes(valeurRetenue(h.valeurs_par_secteur![1], t as 'terrasse' | null).valeur as number)));
  assertEquals(h.renvoi_document_graphique, UC10.renvoi_document_graphique);
  assertEquals(h.regle_relative, UC10.regle_relative);
  // Ni « manquante », ni « connue » : à préciser.
  assertEquals(reglesAPreciser(lues), ['hauteur_max_m']);
  assert(!reglesManquantes(lues).includes('hauteur_max_m'));
  assertEquals(questionSecteur(lues), 'Dans quel secteur de hauteur (1 à 4, plan graphique) se trouve la parcelle ?');
  assertEquals(questionSecteur([lues[0]]), null, 'rien à préciser : pas de question');
  assert(signalementsFormules(lues).some((s) => s.includes('UC 10-1') && s.includes('alignement opposé')), 'règle relative signalée');
  // Une estimation antérieure (outil, import) ne masque pas la règle citée par secteur.
  const estimee = normaliserRegle({ cle: 'hauteur_max_m', valeur: 28, source: 'get_parcel_plu' }, 'modele')!;
  const f = fusionnerRegles([estimee], lues, 'reglement');
  assertEquals(f.regles.find((x) => x.cle === 'hauteur_max_m')!.nature, 'par_secteur');
  // Et une estimation postérieure ne l'écrase pas.
  assertEquals(fusionnerRegles(f.regles, [estimee], 'modele').regles.find((x) => x.cle === 'hauteur_max_m')!.nature, 'par_secteur');
  // Formulaire : les valeurs par secteur partent avec la règle, le JSON reste sous 4 000 caractères.
  const q = JSON.parse(construireQuestionRegles(lues, questionSecteur(lues)!, '92050000AE0414', null, 'u'));
  assertEquals(q.regles.find((x: { cle: string }) => x.cle === 'hauteur_max_m').valeurs_par_secteur.length, 4);
  // Relue depuis la base : identique.
  assertEquals(normaliserRegle(h, 'base'), h);
});

Deno.test('Q1-A : le secteur indiqué par l’utilisateur fixe la valeur citée (réponse libre, formulaire, case laissée vide)', () => {
  const lues = reglesDepuisLecture({ regles: [UC9, UC10] }, 'gpu', SOURCE_GPU_NANTERRE);
  assertEquals(secteurDepuisReponse('La parcelle est en secteur 2.'), '2');
  assertEquals(secteurDepuisReponse(' 3 '), '3');
  assertEquals(secteurDepuisReponse('je ne sais pas'), null);
  const a = appliquerSecteur(lues, 'Secteur 2');
  const h = a.regles.find((x) => x.cle === 'hauteur_max_m')!;
  // Secteur 2, toiture non précisée : 21 m (jamais 24 m, faîtage), sous réserve de UC 10-1.
  assertEquals([h.valeur, h.secteur, h.statut, h.article], [21, '2', 'confirme', 'UC 10, p. 109']);
  assert(h.source.includes("secteur 2 indiqué par l'utilisateur"));
  assert(h.texte!.includes('Exception non retenue : bureaux av. Clemenceau') && h.texte!.includes('Sous réserve de « UC 10-1'), h.texte);
  const sig = signalementsFormules(a.regles);
  assert(sig.some((x) => x.includes('21 m retenue SOUS RÉSERVE de « UC 10-1')), 'UC 10-1 jamais ignorée');
  assert(sig.some((x) => x.includes('type de toiture non précisé : valeur la plus restrictive retenue')));
  assert(decrireRegle(h).includes('sous réserve de « UC 10-1'));
  // Secteur 1 : 26 m sans toiture connue ; 28 m (acrotère) en toiture terrasse ; 26 m (égout) en toiture à pentes.
  assertEquals(appliquerSecteur(lues, 'secteur 1').regles.find((x) => x.cle === 'hauteur_max_m')!.valeur, 26);
  assertEquals(appliquerSecteur(lues, 'secteur 1', 'terrasse').regles.find((x) => x.cle === 'hauteur_max_m')!.valeur, 28);
  assertEquals(appliquerSecteur(lues, 'secteur 1', 'pentes').regles.find((x) => x.cle === 'hauteur_max_m')!.valeur, 26);
  // Toiture connue plus tard (programme) : recalcul ; relue depuis la base : même valeur (jamais reprise telle quelle).
  const terrasse = ajusterToiture(appliquerSecteur(lues, 'secteur 1').regles, 'terrasse').find((x) => x.cle === 'hauteur_max_m')!;
  assertEquals([terrasse.valeur, terrasse.toiture, terrasse.mesure_retenue], [28, 'terrasse', 'acrotère (toiture terrasse)']);
  assertEquals(normaliserRegle(terrasse, 'base')!.valeur, 28);
  assertEquals(normaliserRegle({ ...h, valeur: 24 }, 'base')!.valeur, 21, 'une valeur stockée trop permissive est recalculée');
  assertEquals(toitureDuProjet({ gabarit: 'R+4 toiture terrasse' }, null), 'terrasse');
  assertEquals(toitureDuProjet({ gabarit: 'R+4' }, { toiture: 'pentes' }), 'pentes');
  assertEquals(toitureDuProjet({ gabarit: 'R+4' }, null), null);
  assertEquals(reglesAPreciser(a.regles), []);
  assertEquals(questionSecteur(a.regles), null);
  assertEquals(appliquerSecteur(lues, 'secteur 7').appliquees, [], 'secteur absent du règlement : rien appliqué');
  // Formulaire : case vide → les règles citées (non réglementée, par secteur) ne sont PAS effacées.
  const vide = appliquerReponseFormulaire(lues, JSON.stringify({ type: 'reponse_regles_conception', version: 1, regles: [
    { cle: 'emprise_sol_max_pct', valeur: null, statut: 'manquant' }, { cle: 'hauteur_max_m', valeur: null, statut: 'manquant' },
  ] }));
  assertEquals(vide.regles.find((x) => x.cle === 'emprise_sol_max_pct')!.nature, 'non_reglementee');
  assertEquals(vide.regles.find((x) => x.cle === 'hauteur_max_m')!.nature, 'par_secteur');
  // Formulaire : champ `secteur` sur la règle.
  const parSecteur = appliquerReponseFormulaire(lues, JSON.stringify({ type: 'reponse_regles_conception', version: 1, regles: [
    { cle: 'hauteur_max_m', valeur: null, statut: 'manquant', secteur: '3' },
  ] }));
  assertEquals(parSecteur.regles.find((x) => x.cle === 'hauteur_max_m')!.valeur, 9, 'secteur 3 : égout 9 m (jamais le faîtage 12 m)');
});

Deno.test('Q1-A : consigne de lecture — « non réglementée » et « par secteur » demandées explicitement', () => {
  const c = CONSIGNE_LECTURE_REGLEMENT('UC', 'gpu');
  assert(c.includes('non_reglementee') && c.includes('par_secteur') && c.includes('valeurs_par_secteur'));
  assert(c.includes('"acrotere_terrasse"') && c.includes('"egout"') && c.includes('"faitage"') && c.includes('"exceptions"'));
  assert(c.includes('Ne choisis JAMAIS le secteur'));
});

// ── Lot Q3 ───────────────────────────────────────────────────────────────────
// Valeurs réglementaires : UNIQUEMENT celles des preuves du 05/11/2026 (AE0414, 92050_PLU_20251209) —
// UC 6-1 « alignement OU recul minimum de 4 m », UC 12 « Zone 3 – logements : 1 places/logement » —
// et la fixture UC 9 / UC 10 ci-dessus (lecture réelle du 04/11/2026, p. 109).
const UC12 = {
  cle: 'stationnement_par_logement', nature: 'par_secteur', valeur: null, article: 'UC 12',
  texte: 'Zone 3 – logements : 1 places/logement',
  valeurs_par_secteur: [{ secteur: 'Zone 3', valeur: 1, texte: 'Zone 3 – logements : 1 places/logement' }],
};
const UC61_ALTERNATIVE = {
  cle: 'recul_voie_m', nature: 'alternative', valeur: null, article: 'UC 6-1, p. 106',
  texte: 'implantation à l’alignement ou en recul minimum de 4 m',
  alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }],
};
// Ce que la mission du 05/11 avait produit : l'alternative rangée « par secteur ».
const UC61_COMME_SECTEUR = {
  cle: 'recul_voie_m', nature: 'par_secteur', valeur: null, article: 'UC 6-1, p. 106',
  texte: 'implantation à l’alignement ou en recul minimum de 4 m',
  valeurs_par_secteur: [{ secteur: 'Règle générale', valeur: 0, exceptions: 'recul minimum de 4 m' }],
};

Deno.test('Q3-5 : secteurs déclarés (objectif, réponse, critères) → mémorisés puis appliqués à la lecture (hauteur ET stationnement)', () => {
  const objectif = 'Concevoir sur 92050000AE0414 : secteur de hauteur 1, zone de stationnement n° 3, toiture terrasse.';
  const d = secteursDepuisTexte(objectif);
  assertEquals(d, { hauteur: '1', stationnement: '3', toiture: 'terrasse' });
  // Réponse libre à la question des pages (avant la lecture de UC 10) : même lecture.
  assertEquals(secteursDepuisTexte('Lisez UC 10 et UC 12. Secteur de hauteur 1, zone de stationnement n°3, toiture-terrasse.'), { hauteur: '1', stationnement: '3', toiture: 'terrasse' });
  assertEquals(secteursDepuisTexte('le secteur a été vu'), {}, 'pas de « secteur a » deviné dans un texte libre');
  assertEquals(secteursDepuisTexte('secteur 2', { generique: true }), { generique: '2' });
  assertEquals(secteursDepuisCriteres({ secteur_hauteur: '1', zone_stationnement: 'Zone 3', toiture: 'terrasse' }), { hauteur: '1', stationnement: '3', toiture: 'terrasse' });
  const mem = fusionnerSecteursDeclares({}, d, 'objectif de la mission');
  assertEquals(mem.provenance, ['objectif de la mission']);
  // Lecture de UC 10 (par secteur) et UC 12 (par zone) → appliquées automatiquement.
  const lues = reglesDepuisLecture({ regles: [UC10, UC12] }, 'gpu', SOURCE_GPU_NANTERRE);
  assertEquals(reglesAPreciser(lues), ['hauteur_max_m', 'stationnement_par_logement']);
  const a = appliquerSecteursDeclares(lues, mem);
  const h = a.regles.find((x) => x.cle === 'hauteur_max_m')!;
  const st = a.regles.find((x) => x.cle === 'stationnement_par_logement')!;
  // Secteur 1 + toiture terrasse déclarée : acrotère (fixture UC 10 : 28 m).
  assertEquals([h.valeur, h.secteur, h.statut, h.toiture], [28, '1', 'confirme', 'terrasse']);
  assert(h.source.includes("secteur 1 déclaré par l'utilisateur"), h.source);
  assertEquals([st.valeur, st.secteur, st.statut], [1, 'Zone 3', 'confirme']);
  assert(st.source.includes("secteur Zone 3 déclaré par l'utilisateur"), st.source);
  assertEquals(reglesAPreciser(a.regles), []);
  assertEquals(questionSecteur(a.regles), null, 'la question du secteur n’est plus posée');
  // « Zone 3 » et « 3 » désignent le même secteur.
  assertEquals([cleSecteur('Zone 3'), cleSecteur('secteur n° 3'), cleSecteur('3')], ['3', '3', '3']);
  // Secteur déclaré absent de la règle : rien n'est appliqué (jamais de valeur au jugé).
  assertEquals(appliquerSecteursDeclares(lues, { stationnement: '7' }).appliquees, []);
});

Deno.test('Q3-6 : UC 6-1 « alignement OU recul ≥ 4 m » = ALTERNATIVE (chiffrée, valeur 0), jamais « par secteur »', () => {
  for (const brut of [UC61_ALTERNATIVE, UC61_COMME_SECTEUR]) {
    const [r] = reglesDepuisLecture({ regles: [brut] }, 'gpu', SOURCE_GPU_NANTERRE);
    assertEquals([r.cle, r.nature, r.valeur, r.statut, r.article], ['recul_voie_m', 'chiffree', 0, 'confirme', 'UC 6-1, p. 106']);
    assert(r.alternatives!.some((x) => x.valeur === 0) && r.alternatives!.some((x) => x.valeur === 4), JSON.stringify(r.alternatives));
    assert(/au choix du constructeur/.test(r.texte!) && /4 m/.test(r.texte!), r.texte);
    assert(/0 m = implantation à l’alignement autorisée/.test(r.mesure_retenue!));
    assert(!/exception non retenue/i.test(decrireRegle(r)) && !/par secteur/.test(decrireRegle(r)), decrireRegle(r));
    assertEquals(reglesAPreciser([r]), [], 'pas de question de secteur pour une alternative');
    assertEquals(normaliserRegle(r, 'base'), r, 'relue depuis la base : identique');
  }
  assert(estSecteurGeographique('1') && estSecteurGeographique('Zone 3') && estSecteurGeographique('secteur n° 4') && estSecteurGeographique('UCa'));
  assert(!estSecteurGeographique('Règle générale') && !estSecteurGeographique('alignement'));
  // Validée telle quelle dans le formulaire : l'alternative garde ses options.
  const [r] = reglesDepuisLecture({ regles: [UC61_ALTERNATIVE] }, 'gpu', SOURCE_GPU_NANTERRE);
  const f = appliquerReponseFormulaire([r], JSON.stringify({ type: 'reponse_regles_conception', version: 1, regles: [{ cle: 'recul_voie_m', valeur: 0, statut: 'confirme', source: 'utilisateur' }] }));
  assertEquals(f.regles.find((x) => x.cle === 'recul_voie_m')!.alternatives, r.alternatives);
  // Consigne de lecture : secteurs géographiques ≠ alternatives au choix du constructeur.
  const c = CONSIGNE_LECTURE_REGLEMENT('UC', 'gpu');
  assert(c.includes('"nature": "alternative"') && c.includes('CHOIX AU CONSTRUCTEUR') && c.includes('jamais « Règle générale »'));
});
