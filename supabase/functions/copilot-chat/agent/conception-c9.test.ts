// deno test --no-check supabase/functions/copilot-chat/agent/conception-c9.test.ts
// Lot C9 : lecture des règles — libellés de secteur coupés, « sur limites OU en retrait », dispositions
// communes (lot C8), état des parcelles voisines (lot C7b). Textes réels : PLUi Est Ensemble, p. 208
// (fiche d'indices des limites séparatives, reprise de _shared/documents/reglementIndices.test.ts) et
// p. 89 (« A Montreuil : 0,59 place par logement créé », essais du 10/11/2026).
import * as na from 'node:assert/strict';
import {
  appliquerDispositionsCommunes, appliquerSecteursDeclares, citationConfirme, completerRegles, CONSIGNE_LECTURE_REGLEMENT,
  contexteDispositionsCommunes, decrireRegle, estCitationDispositionsCommunes, estLimiteOuRetrait, fusionnerRegles,
  implantationEnLimitePermise, LIBELLE_SECTEUR_MAX, LIBELLE_SUR_LIMITE, lireDispositionsCommunes, normaliserRegle,
  reglesDepuisLecture, reglesManquantes, resumeVoisines, signalementsFormules, valeurAlternative, estNonTrouvee,
} from './conception.ts';
import { profondeurBandePrincipaleM } from '../../../../src/spaces/copilot/studio3d/reglesParBande.ts';

const SOURCE = 'Règlement GPU — PLUi Est Ensemble';
// Texte réel de la fiche, indice 1 (p. 208).
const INDICE_1 = 'Sur les limites séparatives ou en retrait. • Retrait minimum : H/2 et 3 mètres • Distance minimum : H/2 et 6 mètres';
// Texte réel de la fiche, indice 0 (p. 208).
const INDICE_0 = 'Sur les limites séparatives ou en retrait. • Retrait minimum si vues : H/2 et 6 mètres • Retrait minimum si absence de vues : H/4 et 3 mètres';

// ── 1. Libellés de secteur ───────────────────────────────────────────────────

Deno.test('C9-1 : un libellé de plus de 20 caractères n’est plus coupé (bande rangée « par secteur » par le modèle)', () => {
  na.equal(LIBELLE_SECTEUR_MAX, 80);
  const r = normaliserRegle({
    cle: 'emprise_sol_max_pct', nature: 'par_secteur', valeur: null, article: 'indice J, p. 237', source: SOURCE,
    valeurs_par_secteur: [{ secteur: 'bande principale (18 m)', valeur: 80 }, { secteur: 'bande secondaire', valeur: 20 }],
  }, 'reglement')!;
  na.deepEqual(r.alternatives, [{ libelle: 'bande principale (18 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }]);
  na.equal(r.valeur, 80);
  // Avant : « bande principale (18… » — la profondeur de la bande n'était plus lisible.
  na.equal(profondeurBandePrincipaleM(r.alternatives), 18);
  na.ok(!JSON.stringify(r).includes('…'), JSON.stringify(r));
});

Deno.test('C9-1 : deux secteurs qui partagent leurs 20 premiers caractères ne sont plus pris pour un doublon', () => {
  const r = normaliserRegle({
    cle: 'stationnement_par_logement', nature: 'par_secteur', valeur: null, article: 'UC 12, p. 117', source: SOURCE,
    valeurs_par_secteur: [{ secteur: 'Zone de stationnement 1', valeur: 0.5 }, { secteur: 'Zone de stationnement 2', valeur: 1 }],
  }, 'reglement')!;
  // Avant : un seul secteur gardé, « Zone de stationnemen… », qui n'était plus reconnu comme un secteur du plan.
  na.equal(r.nature, 'par_secteur');
  na.deepEqual(r.valeurs_par_secteur?.map((e) => e.secteur), ['Zone de stationnement 1', 'Zone de stationnement 2']);
  na.equal(r.valeur, null);
  const a = appliquerSecteursDeclares([r], { stationnement: '2' });
  const s = a.regles.find((x) => x.cle === 'stationnement_par_logement')!;
  na.equal(s.valeur, 1);
  na.equal(s.secteur, 'Zone de stationnement 2');
});

Deno.test('C9-1 : une conception enregistrée avec un libellé coupé reste lisible, sans changement', () => {
  const stockee = {
    cle: 'hauteur_max_m', valeur: null, unite: 'm', statut: 'manquant', source: SOURCE, article: 'UC 10, p. 109', nature: 'par_secteur',
    valeurs_par_secteur: [{ secteur: 'Secteur de hauteur n…', valeur: 21 }, { secteur: '2', valeur: 15 }],
  };
  // Comportement d'avant ce lot, conservé : un libellé qui n'est pas un secteur du plan fait lire les valeurs
  // comme des options (lot Q3). Le libellé coupé est gardé tel qu'il a été enregistré, les valeurs aussi.
  const r = normaliserRegle(stockee, 'base')!;
  na.deepEqual(r.alternatives, [{ libelle: 'Secteur de hauteur n…', valeur: 21 }, { libelle: '2', valeur: 15 }]);
  // Vrais secteurs du plan enregistrés : relus à l'identique.
  const secteurs = { ...stockee, valeurs_par_secteur: [{ secteur: '1', valeur: 21 }, { secteur: 'Zone 2', valeur: 15 }] };
  na.deepEqual(normaliserRegle(secteurs, 'base'), secteurs);
  const alt = normaliserRegle({ cle: 'emprise_sol_max_pct', valeur: 80, unite: '%', statut: 'confirme', source: SOURCE, article: 'indice J, p. 237',
    alternatives: [{ libelle: 'Bande principale (pr…', valeur: 80 }, { libelle: 'Bande secondaire', valeur: 20 }] }, 'base')!;
  na.equal(alt.valeur, 80);
  na.equal(alt.alternatives?.[0].libelle, 'Bande principale (pr…');
});

// ── 2. « Sur les limites séparatives ou en retrait » ─────────────────────────

Deno.test('C9-2 : le texte reconnu est étroit (permission d’implanter en limite, pas une obligation ni un simple retrait)', () => {
  na.ok(implantationEnLimitePermise(INDICE_1));
  na.ok(implantationEnLimitePermise('Les constructions s’implantent soit en limite séparative, soit en retrait.'));
  na.ok(implantationEnLimitePermise('en limite ou en recul de 3 m'));
  na.ok(!implantationEnLimitePermise('Sur au moins une limite séparative. Retrait minimum : H/2 et 3 mètres'));
  na.ok(!implantationEnLimitePermise('Retrait minimum : H/2 et 3 mètres'));
  na.ok(!implantationEnLimitePermise('En retrait des limites séparatives de 3 mètres au moins'));
  na.ok(!implantationEnLimitePermise(null, undefined, ''));
});

Deno.test('C9-2 : « 3 m » lu comme valeur unique + citation réelle (indice 1, p. 208) → les deux possibilités, 0 m retenu', () => {
  // Ce que le modèle a rendu à l'essai 5 : une valeur chiffrée unique.
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'recul_limites_m', valeur: 3, article: 'indice 1, p. 208', texte: INDICE_1 },
    { cle: 'recul_limites_formule', valeur: 'H/2 min 3 m', article: 'indice 1, p. 208', texte: INDICE_1 },
  ] }, 'gpu', SOURCE);
  const l = lues.find((r) => r.cle === 'recul_limites_m')!;
  na.equal(l.valeur, 0, 'aucun retrait obligatoire');
  na.equal(l.statut, 'confirme');
  na.deepEqual(l.alternatives, [{ libelle: LIBELLE_SUR_LIMITE, valeur: 0 }, { libelle: 'en retrait, minimum cité', valeur: 3 }]);
  na.match(l.regle_relative ?? '', /^H\/2 \(formule citée, à appliquer en cas de retrait\)$/);
  na.match(l.mesure_retenue ?? '', /implantation en limite séparative permise : 0 m retenu, aucun retrait obligatoire ; en cas de retrait : en retrait, minimum cité 3 m/);
  na.ok(l.texte?.includes('Sur les limites séparatives ou en retrait'), 'la citation est gardée');
  na.ok(l.texte?.includes('retrait non obligatoire'));
  // La formule ne se lit plus comme une obligation, et reste exploitable (H/2, minimum 3 m).
  const f = lues.find((r) => r.cle === 'recul_limites_formule')!;
  na.equal(f.valeur, 'en cas de retrait : H/2 min 3 m');
  // Rien n'est répété à la relecture de la base.
  const relues = completerRegles(lues.map((r) => normaliserRegle(r, 'base')!));
  na.equal(relues.find((r) => r.cle === 'recul_limites_formule')!.valeur, 'en cas de retrait : H/2 min 3 m');
  na.deepEqual(relues.find((r) => r.cle === 'recul_limites_m'), l);
  // Signalement : plus de « 3 m n'est que le minimum », plus de « largeur de la voie ».
  const s = signalementsFormules(lues).filter((x) => x.startsWith('recul_limites_m'));
  na.equal(s.length, 1, JSON.stringify(s));
  na.match(s[0], /implantation en limite séparative PERMISE \(0 m retenu, aucun retrait obligatoire\) \(art\. indice 1, p\. 208\)\. En cas de retrait : en retrait, minimum cité 3 m ; règle relative « H\/2/);
  na.ok(!/largeur de la voie|n'est que le minimum/.test(s[0]));
  na.match(decrireRegle(l), /^recul_limites_m = 0 \(sur limite séparative \(0 m\) ou en retrait, minimum cité \(3 m\), au choix du constructeur \(implantation en limite permise, retrait non obligatoire\)\) \(art\. indice 1, p\. 208\) — règle relative : « H\/2/);
});

Deno.test('C9-2 : forme demandée par la consigne (alternatives + regle_relative) → gardée telle quelle', () => {
  const l = reglesDepuisLecture({ regles: [{
    cle: 'recul_limites_m', nature: 'alternative', valeur: null, article: 'indice 1, p. 208', texte: INDICE_1, regle_relative: 'H/2 et 3 mètres',
    alternatives: [{ libelle: 'sur limite séparative', valeur: 0 }, { libelle: 'en retrait (minimum)', valeur: 3 }],
  }] }, 'gpu', SOURCE)[0];
  na.equal(l.valeur, 0);
  na.equal(l.regle_relative, 'H/2 et 3 mètres');
  na.deepEqual(l.alternatives, [{ libelle: 'sur limite séparative', valeur: 0 }, { libelle: 'en retrait (minimum)', valeur: 3 }]);
  na.ok(estLimiteOuRetrait(l.alternatives));
});

Deno.test('C9-2 : alternatives sans l’option « en limite » alors que le texte la permet → option ajoutée ; retrait selon la façade gardé', () => {
  const l = reglesDepuisLecture({ regles: [{
    cle: 'recul_limites_m', nature: 'alternative', valeur: null, article: 'indice 0, p. 208', texte: INDICE_0,
    alternatives: [{ libelle: 'façade avec vues', valeur: 6 }, { libelle: 'façade sans vues', valeur: 3 }],
  }] }, 'gpu', SOURCE)[0];
  na.equal(l.valeur, 0, 'avant : 6 m retenus comme une obligation');
  na.deepEqual(l.alternatives?.map((a) => a.valeur), [0, 6, 3]);
  na.ok(l.texte?.includes('implantation en limite permise ; en cas de retrait, selon la façade'));
});

Deno.test('C9-2 : rien ne change sans la phrase qui permet la limite, ni pour l’utilisateur, ni pour la base', () => {
  // Retrait seul : reste un recul chiffré.
  const seul = normaliserRegle({ cle: 'recul_limites_m', valeur: 3, article: 'UC 7, p. 40', texte: 'Retrait minimum : H/2 et 3 mètres', source: SOURCE }, 'reglement')!;
  na.equal(seul.valeur, 3);
  na.equal(seul.alternatives, undefined);
  // « Sur au moins une limite » (indice 2) : pas de conversion.
  const obligation = normaliserRegle({ cle: 'recul_limites_m', valeur: 3, article: 'indice 2, p. 208', texte: 'Sur au moins une limite séparative. Retrait minimum : H/2 et 3 mètres', source: SOURCE }, 'reglement')!;
  na.equal(obligation.valeur, 3);
  // Selon la façade, sans permission d'implanter en limite : inchangé (lot Q3-quinquies).
  na.equal(valeurAlternative('recul_limites_m', [{ libelle: 'façade avec baie', valeur: 8 }, { libelle: 'façade sans baie', valeur: 3 }]).valeur, 8);
  // Règle enregistrée avant ce lot (essai 5) : relue telle quelle.
  const ancienne = { cle: 'recul_limites_m', valeur: 3, unite: 'm', statut: 'confirme', source: SOURCE, article: 'indice 1, p. 214', texte: INDICE_1 };
  na.deepEqual(normaliserRegle(ancienne, 'base'), ancienne);
  // Saisie de l'utilisateur : jamais réinterprétée.
  na.equal(normaliserRegle({ ...ancienne, source: 'utilisateur' }, 'utilisateur')!.valeur, 3);
  // Autre clé : la phrase ne déclenche rien.
  na.equal(normaliserRegle({ cle: 'recul_voie_m', valeur: 3, article: 'UC 6', texte: INDICE_1, source: SOURCE }, 'reglement')!.valeur, 3);
  // Valeur 0 seule, ou aucune distance : rien n'est fabriqué.
  na.equal(normaliserRegle({ cle: 'recul_limites_m', valeur: null, article: 'indice 1, p. 208', texte: INDICE_1, source: SOURCE }, 'reglement')!.statut, 'manquant');
});

Deno.test('C9-2 : la nouvelle lecture remplace-t-elle l’ancienne valeur « 3 m confirmé » ? Non (même sûreté) — signalé au rapport', () => {
  const ancienne = normaliserRegle({ cle: 'recul_limites_m', valeur: 3, unite: 'm', statut: 'confirme', source: SOURCE, article: 'indice 1, p. 214', texte: INDICE_1 }, 'base')!;
  const nouvelle = reglesDepuisLecture({ regles: [{ cle: 'recul_limites_m', valeur: 3, article: 'indice 1, p. 208', texte: INDICE_1 }] }, 'gpu', SOURCE);
  const f = fusionnerRegles([ancienne], nouvelle, 'reglement');
  na.equal(f.regles.find((r) => r.cle === 'recul_limites_m')!.valeur, 3);
});

// ── 4. Dispositions communes ─────────────────────────────────────────────────

Deno.test('C9-4 : « dispositions communes, p. 89 » est une source valable ; sans page, la règle n’est qu’estimée', () => {
  na.ok(estCitationDispositionsCommunes('dispositions communes, p. 89'));
  na.ok(estCitationDispositionsCommunes('Dispositions générales, page 12'));
  na.ok(!estCitationDispositionsCommunes('UC 12, p. 117'));
  na.ok(citationConfirme('UC 12') && citationConfirme('indice J, p. 237') && citationConfirme('dispositions communes, p. 89'));
  na.ok(!citationConfirme('dispositions communes') && !citationConfirme(undefined) && !citationConfirme(''));
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'stationnement_par_logement', valeur: 0.59, article: 'dispositions communes, p. 89', texte: 'A Montreuil : 0,59 place par logement créé' },
    { cle: 'mixite_sociale_pct', valeur: 30, article: 'dispositions communes', texte: '30 % de logements locatifs sociaux' },
  ] }, 'gpu', SOURCE);
  const s = lues.find((r) => r.cle === 'stationnement_par_logement')!;
  na.deepEqual([s.valeur, s.statut, s.article], [0.59, 'confirme', 'dispositions communes, p. 89']);
  na.equal(lues.find((r) => r.cle === 'mixite_sociale_pct')!.statut, 'estime');
  // Les règles citées par un article ou un indice ne changent pas de statut.
  na.equal(normaliserRegle({ cle: 'hauteur_max_m', valeur: 15, article: 'UC 10', source: SOURCE }, 'reglement')!.statut, 'confirme');
});

Deno.test('C9-4 : « non réglementée » tirée des dispositions communes — seulement si le passage nomme le sujet', () => {
  const neutre = normaliserRegle({ cle: 'stationnement_par_logement', nature: 'non_reglementee', valeur: null, article: 'dispositions communes, p. 89', texte: 'Il n’est pas fixé de règle.', source: SOURCE }, 'reglement')!;
  na.equal(neutre.statut, 'manquant');
  na.ok(estNonTrouvee(neutre));
  na.equal(neutre.nature, undefined);
  const dite = normaliserRegle({ cle: 'stationnement_par_logement', nature: 'non_reglementee', valeur: null, article: 'dispositions communes, p. 89', texte: 'Il n’est pas exigé de place de stationnement pour les logements.', source: SOURCE }, 'reglement')!;
  na.deepEqual([dite.nature, dite.statut], ['non_reglementee', 'confirme']);
  // Article de zone, citation neutre : toujours admise (lot A).
  na.equal(normaliserRegle({ cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.', source: SOURCE }, 'reglement')!.nature, 'non_reglementee');
});

// Forme des éléments renvoyés par plu-reglement-v1 (lot C8, dispositionsCommunes.ts).
const NON_TROUVEE = {
  theme: 'stationnement', libelle: 'stationnement', essentiel: true, statut: 'non_trouvee', pages: [], plages: '', pages_reperees: [], autres_pages: [],
  message: 'Stationnement : non trouvé dans le document (aucune page des dispositions communes de ce fichier n\'en traite, 635 pages examinées). Ce n\'est pas une absence de règle : elle peut figurer dans une autre pièce du PLU (annexe, orientation d\'aménagement, règlement graphique) ou être formulée autrement.',
};
const JOINTE = { theme: 'mixite_sociale', libelle: 'mixité sociale', statut: 'jointe', pages: [111, 112, 113], plages: '111-113', pages_reperees: [111, 112, 113], message: 'Mixité sociale : dispositions communes, pages 111 à 113.' };

Deno.test('C9-4 : réponse SANS les champs du lot C8 → rien ne change', () => {
  const regles = completerRegles([]);
  for (const absent of [undefined, null, [], 'oui', [{ theme: 'inconnu', statut: 'jointe' }], [{ theme: 'stationnement', statut: 'autre' }]]) {
    const a = appliquerDispositionsCommunes(regles, absent, SOURCE);
    na.deepEqual(a.regles, regles);
    na.deepEqual(a.notes, []);
  }
  na.equal(contexteDispositionsCommunes({ statut: 'pret', texte: 'x' }), '');
  na.equal(contexteDispositionsCommunes(null), '');
  na.equal(contexteDispositionsCommunes({ pages_dispositions_communes: '' }), '');
  na.equal(contexteDispositionsCommunes({ pages_dispositions_communes: '88-90, 111-113' }), ', dispositions communes p. 88-90, 111-113');
});

Deno.test('C9-4 : thème « non trouvé » → la règle manquante porte le message, et le modèle est prié de ne pas relire', () => {
  na.deepEqual(lireDispositionsCommunes([NON_TROUVEE, JOINTE, { theme: 'mixite_fonctionnelle', statut: 'jointe' }, NON_TROUVEE]).map((d) => [d.theme, d.statut, d.plages]),
    [['stationnement', 'non_trouvee', ''], ['mixite_sociale', 'jointe', '111-113']]);
  const a = appliquerDispositionsCommunes(completerRegles([]), [NON_TROUVEE, JOINTE], SOURCE);
  const s = a.regles.find((r) => r.cle === 'stationnement_par_logement')!;
  na.deepEqual([s.valeur, s.statut, s.source], [null, 'manquant', SOURCE]);
  na.ok(s.texte!.startsWith('non trouvée dans les articles lus — Stationnement : non trouvé dans le document'), s.texte);
  na.ok(estNonTrouvee(s));
  const m = a.regles.find((r) => r.cle === 'mixite_sociale_pct')!;
  na.equal(m.texte, 'non trouvée dans les articles lus — dispositions communes lues (p. 111-113) : aucune valeur retenue pour la zone et la commune de la parcelle');
  na.equal(a.notes.length, 2);
  na.match(a.notes[0], /^stationnement_par_logement : Stationnement : non trouvé dans le document .* Ne relance PAS de lecture du règlement pour cette règle/);
  na.match(a.notes[1], /^mixite_sociale_pct : les dispositions communes ont été lues \(p\. 111-113\).* Ne relis PAS ces pages/);
  // Toujours « manquantes », jamais « non réglementées », aucune valeur posée ; la règle reste lisible après enregistrement.
  na.deepEqual(reglesManquantes(a.regles).filter((c) => c === 'stationnement_par_logement' || c === 'mixite_sociale_pct'), ['stationnement_par_logement', 'mixite_sociale_pct']);
  na.deepEqual(normaliserRegle(s, 'base'), s);
  // Une lecture ultérieure qui trouve la règle la remplace.
  const f = fusionnerRegles(a.regles, reglesDepuisLecture({ regles: [{ cle: 'stationnement_par_logement', valeur: 0.59, article: 'dispositions communes, p. 89', texte: 'A Montreuil : 0,59 place par logement créé' }] }, 'gpu', SOURCE), 'reglement');
  na.equal(f.regles.find((r) => r.cle === 'stationnement_par_logement')!.valeur, 0.59);
});

Deno.test('C9-4 : une règle connue, à préciser ou déclarée inconnue par l’utilisateur n’est jamais touchée', () => {
  const lue = reglesDepuisLecture({ regles: [{ cle: 'stationnement_par_logement', valeur: 0.59, article: 'dispositions communes, p. 89', texte: 'A Montreuil : 0,59 place par logement créé' }] }, 'gpu', SOURCE);
  const parSecteur = normaliserRegle({ cle: 'mixite_sociale_pct', nature: 'par_secteur', valeur: null, article: 'dispositions communes, p. 111', source: SOURCE,
    valeurs_par_secteur: [{ secteur: '1', valeur: 25 }, { secteur: '2', valeur: 30 }] }, 'reglement')!;
  const a = appliquerDispositionsCommunes([...lue, parSecteur], [NON_TROUVEE, { ...JOINTE, statut: 'non_trouvee' }], SOURCE);
  na.deepEqual(a.notes, []);
  na.equal(a.regles.find((r) => r.cle === 'stationnement_par_logement')!.valeur, 0.59);
  na.equal(a.regles.find((r) => r.cle === 'mixite_sociale_pct')!.nature, 'par_secteur');
  const inconnue = { cle: 'stationnement_par_logement' as const, valeur: null, unite: 'places/logement', statut: 'manquant' as const, source: 'utilisateur : inconnu' };
  na.deepEqual(appliquerDispositionsCommunes([inconnue], [NON_TROUVEE], SOURCE).notes, []);
});

Deno.test('C9-4 : thème repéré mais non joint → une lecture ciblée est indiquée, avec les pages', () => {
  const d = { theme: 'stationnement', statut: 'reperee_non_jointe', pages: [], plages: '', pages_reperees: [88, 89, 90], message: 'Stationnement : traité pages 88 à 90 des dispositions communes, pages non jointes (budget de lecture atteint). Redemander ces pages pour les lire.' };
  const a = appliquerDispositionsCommunes(completerRegles([]), [d], SOURCE);
  const s = a.regles.find((r) => r.cle === 'stationnement_par_logement')!;
  na.ok(s.texte!.startsWith('non lue — Stationnement : traité pages 88 à 90'));
  na.match(a.notes[0], /repérées p\. 88-90 mais NON jointes\. Une seule lecture ciblée est utile : lire_reglement_pdf \(source « gpu »\) avec ces pages/);
});

Deno.test('C9-4 et C9-2 : la consigne de lecture décrit les deux cas', () => {
  for (const origine of ['gpu', 'depot'] as const) {
    const c = CONSIGNE_LECTURE_REGLEMENT('UC91Jb2', origine);
    na.ok(c.includes('"article": "dispositions communes, p. N"'));
    na.ok(c.includes('[Dispositions communes — … — pages N à M]'));
    na.ok(c.includes('ne prends jamais la valeur d\'une autre commune'));
    na.ok(c.includes('« sur les limites séparatives OU en retrait »'));
    na.ok(c.includes('{ "libelle": "sur limite séparative", "valeur": 0 }'));
    na.ok(c.includes('Ne réduis jamais cette règle à la seule distance de retrait'));
  }
});

// ── 3. Parcelles voisines ────────────────────────────────────────────────────

Deno.test('C9-3 : le résultat de recuperer_parcelle dit si les voisines sont obtenues, et sinon pourquoi', () => {
  const geo = { type: 'Polygon' as const, coordinates: [[[2.45, 48.86], [2.451, 48.86], [2.451, 48.861], [2.45, 48.86]]] };
  na.deepEqual(resumeVoisines({ voisines: { statut: 'disponibles', source: 's', parcelles: [{ idu: 'A', geometrie: geo }, { idu: 'B', geometrie: geo }] } }),
    { voisines: 'disponibles', voisines_nombre: 2 });
  const ko = resumeVoisines({ voisines: { statut: 'indisponibles', source: 's', parcelles: [], raison: 'le cadastre n’a pas répondu (HTTP 503)' } });
  na.equal(ko.voisines, 'indisponibles');
  na.equal(ko.voisines_raison, 'le cadastre n’a pas répondu (HTTP 503)');
  na.match(String(ko.voisines_consequence), /Côté voie non situé/);
  na.equal(resumeVoisines({ voisines: { statut: 'indisponibles', source: 's', parcelles: [] } }).voisines_raison, 'raison non précisée');
  // Conception enregistrée avant le lot C7b (pas de champ) : rien n'est ajouté.
  na.deepEqual(resumeVoisines({}), {});
  na.deepEqual(resumeVoisines(null), {});
});

// ── Contrat SQL : les formes nouvelles passent la contrainte réelle de agent_conceptions ──────────────

Deno.test('C9 : les règles produites par ce lot passent agent_conception_regles_valides (migration 20261105090000, PGlite)', async () => {
  const { PGlite } = await import('npm:@electric-sql/pglite@0.5.15');
  const migration = await Deno.readTextFile(new URL('../../../migrations/20261105090000_regles_plu_non_reglementee.sql', import.meta.url));
  const fin = migration.indexOf('$$;');
  na.ok(fin > 0, 'fonction SQL trouvée dans la migration');
  const db = new PGlite();
  await db.exec(migration.slice(migration.indexOf('create or replace function'), fin + 3));
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'recul_limites_m', valeur: 3, article: 'indice 1, p. 208', texte: INDICE_1 },
    { cle: 'recul_limites_formule', valeur: 'H/2 min 3 m', article: 'indice 1, p. 208', texte: INDICE_1 },
    { cle: 'stationnement_par_logement', nature: 'par_secteur', valeur: null, article: 'UC 12, p. 117',
      valeurs_par_secteur: [{ secteur: 'Zone de stationnement 1', valeur: 0.5 }, { secteur: 'Zone de stationnement 2', valeur: 1 }] },
    { cle: 'emprise_sol_max_pct', nature: 'par_secteur', valeur: null, article: 'indice J, p. 237',
      valeurs_par_secteur: [{ secteur: 'bande principale (18 m)', valeur: 80 }, { secteur: 'bande secondaire', valeur: 20 }] },
  ] }, 'gpu', SOURCE);
  const avecRaisons = appliquerDispositionsCommunes(fusionnerRegles([], lues, 'reglement').regles, [{ ...JOINTE, statut: 'non_trouvee', message: 'Mixité sociale : non trouvé dans le document.' }], SOURCE).regles;
  const declare = appliquerSecteursDeclares(avecRaisons, { stationnement: '2' }).regles;
  for (const [nom, regles] of [['lecture', avecRaisons], ['secteur déclaré', declare]] as const) {
    na.equal(regles.length, 9);
    const r = await db.query<{ ok: boolean }>('select public.agent_conception_regles_valides($1::jsonb) as ok', [JSON.stringify(regles)]);
    na.equal(r.rows[0].ok, true, nom);
  }
  await db.close();
});
