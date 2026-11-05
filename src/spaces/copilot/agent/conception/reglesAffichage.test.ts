// src/spaces/copilot/agent/conception/reglesAffichage.test.ts — LOT A (finition du rapport de conception).
// node --experimental-strip-types --test : fonctions pures.
// Défauts RÉELS du rapport de la mission du 05/11/2026 12:00-12:03 (parcelle 92050000AE0414, Nanterre,
// règlement 92050_PLU_20251209, « 9 règle(s) connue(s) sur 9 »). Valeurs : uniquement celles citées
// (UC 7-3 p. 107 « 8 m avec baie / 3 m sans baie » ; UC 12 « 1 places/logement »). Les citations
// marquées « forme de test » ne sont pas des extraits du PLU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lireRegles, type RegleConception } from '../../../promoteur/shared/echangeStudio/conception.ts';
import {
  accorderUnite, harmoniserReglesAffichees, MOTS_SUJET, nonReglementeeAdmise, nouvellesInconnues, sujetCitation, SUJET_DE_CLE,
  TEXTE_NON_TROUVEE, TEXTE_VOIR_RECUL, valeurAffichee, detailSecteurAffiche,
} from './reglesAffichage.ts';
import * as serveur from '../../../../../supabase/functions/copilot-chat/agent/conception.ts';

const SOURCE = 'Règlement GPU — 92050_PLU_20251209';
// Règles telles que stockées dans le rapport défectueux (forme relevée ; citations exactes non conservées).
const STOCKEES = lireRegles([
  { cle: 'recul_limites_m', valeur: 8, unite: 'm', statut: 'confirme', source: SOURCE, article: 'UC 7-3, p. 107', nature: 'chiffree',
    texte: 'façade avec baie(s) (8 m) ou façade sans baie (3 m), selon la façade (condition, pas un choix libre) — « 8 m pour une façade avec baie, 3 m pour une façade sans baie »' },
  { cle: 'recul_limites_formule', valeur: null, unite: '', statut: 'confirme', source: SOURCE, article: 'UC 7-3, p. 107', nature: 'non_reglementee', texte: 'Il n’est pas fixé de règle.' },
  { cle: 'stationnement_par_logement', valeur: 1, unite: 'places/logement', statut: 'confirme', source: SOURCE, article: 'UC 12', nature: 'par_secteur', secteur: 'Zone 3',
    valeurs_par_secteur: [{ secteur: 'Zone 3', valeur: 1, texte: 'Zone 3 – logements : 1 places/logement' }] },
  { cle: 'mixite_sociale_pct', valeur: null, unite: '%', statut: 'confirme', source: SOURCE, article: 'UC 12-1.2, p. 117', nature: 'non_reglementee', texte: 'Il n’est pas fixé de règle.' },
  { cle: 'emprise_sol_max_pct', valeur: null, unite: '%', statut: 'confirme', source: SOURCE, article: 'UC 9, p. 109', nature: 'non_reglementee', texte: 'Il n’est pas fixé de règle.' },
]);

test('lot A-1 : formule « non réglementée » (UC 7-3) alors que le recul aux limites est chiffré → « voir recul aux limites »', () => {
  const h = harmoniserReglesAffichees(STOCKEES);
  const f = h.find((r) => r.cle === 'recul_limites_formule')!;
  assert.deepEqual([f.valeur, f.statut, f.article, f.nature], [TEXTE_VOIR_RECUL, 'confirme', 'UC 7-3, p. 107', undefined]);
  assert.equal(valeurAffichee(f), 'voir recul aux limites séparatives', 'jamais « non réglementée », jamais « … formule »');
  assert.equal(valeurAffichee(h.find((r) => r.cle === 'recul_limites_m')!), '8 m');
  // Formule déjà corrigée par le serveur (valeur texte, unité vide relue « formule ») : affichée sans unité.
  const [srv] = lireRegles([{ cle: 'recul_limites_formule', valeur: '8 m (façade avec baie(s)) / 3 m (façade sans baie)', unite: '', statut: 'confirme', source: SOURCE, article: 'UC 7-3, p. 107' }]);
  assert.equal(valeurAffichee(srv), '8 m (façade avec baie(s)) / 3 m (façade sans baie)');
});

test('lot A-2 : « part de logements sociaux : non réglementée (UC 12-1.2, p. 117) » → inconnue, « non trouvée dans les articles lus »', () => {
  const h = harmoniserReglesAffichees(STOCKEES);
  const m = h.find((r) => r.cle === 'mixite_sociale_pct')!;
  assert.deepEqual([m.valeur, m.statut, m.nature], [null, 'manquant', undefined]);
  assert.ok(m.texte!.startsWith(TEXTE_NON_TROUVEE) && m.texte!.includes('UC 12-1.2, p. 117'));
  assert.deepEqual(nouvellesInconnues(STOCKEES, h), ['Part de logements sociaux imposée']);
  // UC 9 (texte réel, neutre, sous l'article « emprise au sol ») : reste « non réglementée ».
  assert.equal(h.find((r) => r.cle === 'emprise_sol_max_pct')!.nature, 'non_reglementee');
  // Le compte affiché passe de « 5 sur 5 » (ici) à 4 : la mixité n'est plus comptée connue.
  assert.equal(STOCKEES.filter((r) => r.statut !== 'manquant').length, 5);
  assert.equal(h.filter((r) => r.statut !== 'manquant').length, 4);
});

test('lot A-4 : « 1 place/logement », « 1,1 places/logement » (citations intactes)', () => {
  const st = harmoniserReglesAffichees(STOCKEES).find((r) => r.cle === 'stationnement_par_logement')!;
  assert.equal(valeurAffichee(st), '1 place/logement (secteur Zone 3)');
  assert.equal(valeurAffichee({ ...st, valeur: 1.1, secteur: undefined, nature: undefined } as RegleConception), '1,1 places/logement');
  assert.equal(detailSecteurAffiche(st.valeurs_par_secteur![0], st.unite), '1 place/logement');
  assert.equal(st.valeurs_par_secteur![0].texte, 'Zone 3 – logements : 1 places/logement', 'citation du PLU non modifiée');
  assert.deepEqual([accorderUnite(1, 'niveaux'), accorderUnite(2, 'niveaux'), accorderUnite(0.5, '%')], ['niveau', 'niveaux', '%']);
});

test('lot A : parité avec le serveur (mêmes mots-clés, même verdict sujet)', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MOTS_SUJET).map(([k, v]) => [k, v.source])),
    Object.fromEntries(Object.entries(serveur.MOTS_SUJET).map(([k, v]) => [k, (v as RegExp).source])));
  assert.deepEqual(SUJET_DE_CLE, serveur.SUJET_DE_CLE);
  const cas: Array<[string, string | null]> = [
    ['Il n’est pas fixé de règle.', null], ['Il n’est pas fixé de règle.', 'ARTICLE UC 12 – LES OBLIGATIONS IMPOSEES AUX CONSTRUCTEURS EN'],
    ['Il n’est pas exigé de places de stationnement supplémentaires pour les logements locatifs sociaux.', null], // forme de test
    ['Il n’est pas fixé de pourcentage de logements sociaux.', null], // forme de test
    ['8 m pour une façade avec baie, 3 m pour une façade sans baie', null], ['Non réglementé.', 'ARTICLE UC 10 – HAUTEUR MAXIMALE'],
  ];
  for (const cle of Object.keys(SUJET_DE_CLE) as Array<keyof typeof SUJET_DE_CLE>) {
    for (const [c, t] of cas) {
      assert.equal(sujetCitation(cle, c, t), serveur.sujetCitation(cle, c, t), `${cle} / ${c}`);
      assert.equal(nonReglementeeAdmise(cle, c, t), serveur.nonReglementeeAdmise(cle, c, t), `${cle} / ${c}`);
    }
  }
});
