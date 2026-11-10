// node --test src/spaces/copilot/results/texteVisible.test.ts
// LOT C3 — les textes ci-dessous sont COPIÉS du serveur (supabase/functions/copilot-chat/index.ts, état du 10/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { texteVisible } from './texteVisible.ts';
import { textesRepliZonageSeul } from '../../../../supabase/functions/copilot-chat/agent/cartes-plu.ts';

/** note_repli telle qu'elle était écrite avant le lot C3 — et telle qu'elle est enregistrée dans les conversations passées. */
const NOTE_REPLI_AVANT_C3 =
  "Aucun règlement de PLU n'a été importé sur la page Foncier et le règlement écrit n'a pas pu être lu automatiquement au Géoportail de l'urbanisme (voir lecture_reglement_gpu)" +
  " : ces éléments se limitent au ZONAGE OPPOSABLE (code de zone, type U/AU/A/N). " +
  "Les règles CHIFFRÉES — hauteur maximale, emprise au sol, retraits, stationnement, OAP — ne " +
  "sont PAS disponibles ici : ne les invente sous aucun prétexte. Dis à l'utilisateur que pour " +
  "les obtenir il peut joindre le PDF du règlement au chat (lecture ciblée de sa zone, jusqu'à 50 Mo) " +
  "ou l'importer sur la page Foncier de Mimmoza.";

test('défaut du 10/11 : la consigne « ne les invente sous aucun prétexte. Dis à l’utilisateur… » n’est plus visible', () => {
  const visible = texteVisible(NOTE_REPLI_AVANT_C3)!;
  assert.equal(/invente|prétexte|utilisateur|Dis |lecture_reglement_gpu/.test(visible), false, visible);
  assert.equal(visible,
    "Aucun règlement de PLU n'a été importé sur la page Foncier et le règlement écrit n'a pas pu être lu automatiquement au Géoportail de l'urbanisme" +
    " : ces éléments se limitent au ZONAGE OPPOSABLE (code de zone, type U/AU/A/N). " +
    "Les règles CHIFFRÉES — hauteur maximale, emprise au sol, retraits, stationnement, OAP — ne sont PAS disponibles ici.");
});

test('la note écrite par le serveur après le lot C3 passe telle quelle', () => {
  for (const tentee of [true, false]) {
    const { note_repli, consignes } = textesRepliZonageSeul(tentee);
    assert.equal(texteVisible(note_repli), note_repli);
    // Même si le champ `consignes` était affiché par erreur, sa consigne ne passerait pas.
    assert.equal(/invente|utilisateur|lecture_reglement_gpu/.test(texteVisible(consignes) ?? ''), false);
  }
});

test('messages d’outil du serveur : le constat reste, la consigne part', () => {
  const cas: [string, string | null][] = [
    ["Aucune donnée PLU disponible : le règlement n'a pas été importé sur la page Foncier de Mimmoza, " +
      "et le Géoportail de l'urbanisme ne renvoie aucun zonage sur ce point (commune non numérisée, " +
      "localisation trop imprécise, ou commune au RNU). " +
      "Invite l'utilisateur à uploader le PDF du PLU. N'invente aucune règle d'urbanisme ni aucune OAP, " +
      "et ne conclus SURTOUT PAS que le terrain est constructible ou non.",
     "Aucune donnée PLU disponible : le règlement n'a pas été importé sur la page Foncier de Mimmoza, " +
      "et le Géoportail de l'urbanisme ne renvoie aucun zonage sur ce point (commune non numérisée, " +
      "localisation trop imprécise, ou commune au RNU)."],
    ["Le service Zonage ABC n'est pas encore branché (COPILOT_FN_ZONAGE non défini). Signale-le sans inventer de zone.",
     "Le service Zonage ABC n'est pas encore branché."],
    ["Aucune adresse fournie. Demande l'adresse complète (numéro, voie, commune).", 'Aucune adresse fournie.'],
    ["Aucune parcelle identifiée. Demande à l'utilisateur d'en sélectionner une.", 'Aucune parcelle identifiée.'],
    ["Identifiant absent ou invalide. Appelle lister_watchlists pour l'obtenir — ne l'invente pas.", 'Identifiant absent ou invalide.'],
    ['Le suivi enregistré n’a pas pu être lu. Ne conclus pas qu’il est vide.', 'Le suivi enregistré n’a pas pu être lu.'],
    ["Erreur GPU. Ne conclus RIEN sur la constructibilité tant que la couche n'a pas répondu.", 'Erreur GPU.'],
    ["NE LIS RIEN et NE CONCLUS RIEN sur les règles à ce stade. Pose à l'utilisateur UNE question précise.", null],
    ["Lecture du règlement en cours (120 / 635 pages extraites) : elle reprendra là où elle s'est arrêtée — propose à l'utilisateur de reposer la question dans une minute.",
     "Lecture du règlement en cours (120 / 635 pages extraites) : elle reprendra là où elle s'est arrêtée."],
  ];
  for (const [serveur, attendu] of cas) assert.equal(texteVisible(serveur), attendu, serveur);
});

test('un constat n’est pas pris pour une consigne', () => {
  for (const constat of [
    'Demande locale non mesurée.',
    'Demande de permis déposée en 2024.',
    'La zone seule ne valide pas la constructibilité du projet ; vérifier le règlement et les contraintes applicables.',
    'Le numéro 100 n’est pas reconnu par la Base Adresse Nationale.',
    'Zone UC91Jb2 (type U) à Montreuil (93048). Document : PLUi Est Ensemble.',
    'Parcelle 93048000AS0249, 804 m² (unité foncière non confirmée).',
    'Stationnement : 0,59 place par logement créé (p. 89).',
  ]) assert.equal(texteVisible(constat), constat);
  assert.equal(texteVisible(null), null);
  assert.equal(texteVisible('   '), null);
  assert.equal(texteVisible(42), null);
});

test('toutes les notes écrites en dur dans apiResultModel.ts passent sans modification', () => {
  const source = readFileSync(new URL('./apiResultModel.ts', import.meta.url), 'utf8');
  const notes = [...source.matchAll(/note\('((?:[^'\\]|\\.)+)'\)/g)].map((m) => m[1]);
  assert.ok(notes.length >= 30, `seulement ${notes.length} notes trouvées`);
  for (const n of notes) assert.equal(texteVisible(n), n);
});
