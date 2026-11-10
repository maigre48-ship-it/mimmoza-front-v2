// node --test src/spaces/copilot/results/cartesAffichees.test.ts
// LOT C3 — données de l'essai témoin du 10/11/2026 (Montreuil, zone UC91Jb2, PLUi Est Ensemble, règlement de 635 pages).
// Forme des sorties : celle de get_parcel_plu / get_zonage_plu dans supabase/functions/copilot-chat/index.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { preparerCartes } from './cartesAffichees.ts';
import type { ActiveToolCall } from '../types/copilot.types';

const SOURCE = "plu-reglement-v1 — Géoportail de l'urbanisme";
const document = { type: 'PLUi', territoire: 'Est Ensemble', idurba: null, date_approbation: null };
const lu = (id: string, pages: string): ActiveToolCall => ({
  id, name: 'get_parcel_plu', status: 'success', input: { pages },
  output: { status: 'ok', source: SOURCE, data: {
    niveau_de_detail: 'reglement_lu', statut_lecture: 'lu dans le règlement', regle_ecrite_disponible: true,
    zone: 'UC91Jb2', zone_lue: 'UC', type_zone: 'U', document,
    pages_lues: { chapitre_zone: pages, total_document: 635, fin_de_chapitre_non_lue: false },
    consignes: 'Le champ reglement_extrait est le TEXTE du règlement écrit officiel…',
    reglement_extrait: '[48211 caractères du règlement transmis au modèle — non conservés]',
  } },
});
const aPreciser: ActiveToolCall = {
  id: 'plu-1', name: 'get_parcel_plu', status: 'success',
  output: { status: 'ok', source: SOURCE, data: {
    niveau_de_detail: 'a_preciser', statut_lecture: "règlement trouvé — à préciser par l'utilisateur avant lecture",
    regle_ecrite_disponible: false, raison: 'choix_requis', zone: 'UC91Jb2', type_zone: 'U', document, nb_pages: 635,
    consignes: 'NE LIS RIEN et NE CONCLUS RIEN sur les règles à ce stade.',
  } },
};
const zonage: ActiveToolCall = {
  id: 'gpu-1', name: 'get_zonage_plu', status: 'success',
  output: { status: 'ok', source: 'gpu-parcelle-v1', data: {
    empty: false, zone_principale: { zone: 'UC91Jb2', libelle_long: null, type_zone: 'U' }, zones: [{ zone: 'UC91Jb2', libelle_long: null, type_zone: 'U' }],
  } },
};

test('défaut du 10/11 : deux lectures du même règlement au contenu affiché identique → une seule carte', () => {
  const cartes = preparerCartes([zonage, aPreciser, lu('plu-2', '157-160'), lu('plu-3', '186-275')], 'complete');
  assert.deepEqual(cartes.get('plu-2'), { masquee: false, occurrences: 2, interrompue: false });
  assert.deepEqual(cartes.get('plu-3'), { masquee: true, occurrences: 1, interrompue: false });
  // Contenu différent (lecture à préciser, zonage) : cartes conservées.
  assert.deepEqual(cartes.get('plu-1'), { masquee: false, occurrences: 1, interrompue: false });
  assert.deepEqual(cartes.get('gpu-1'), { masquee: false, occurrences: 1, interrompue: false });
});

test('trois appels identiques → une carte qui en représente trois', () => {
  const cartes = preparerCartes([lu('a', '157-160'), lu('b', '157-160'), lu('c', '157-160')], 'complete');
  assert.equal(cartes.get('a')!.occurrences, 3);
  assert.deepEqual([cartes.get('a')!.masquee, cartes.get('b')!.masquee, cartes.get('c')!.masquee], [false, true, true]);
});

test('un contenu visible différent n’est jamais masqué', () => {
  const autreZone = lu('b', '157-160');
  (autreZone.output as { data: { zone: string } }).data.zone = 'UM';
  const cartes = preparerCartes([lu('a', '157-160'), autreZone], 'complete');
  assert.equal(cartes.get('a')!.masquee, false);
  assert.equal(cartes.get('b')!.masquee, false);
  // Même contenu mais outil différent : deux cartes.
  const dvf = (id: string, name: string): ActiveToolCall => ({ id, name, status: 'success', output: { status: 'ok', source: 'S', data: { total: 3 } } });
  const deux = preparerCartes([dvf('x', 'get_servitudes'), dvf('y', 'get_ppr_detail')], 'complete');
  assert.equal(deux.get('y')!.masquee, false);
});

test('appel resté « en cours » : en attente pendant la réception, interrompu une fois la réponse terminée', () => {
  const enCours: ActiveToolCall = { id: 'plu-9', name: 'get_parcel_plu', status: 'running', input: {} };
  assert.deepEqual(preparerCartes([lu('a', '1'), enCours], 'streaming').get('plu-9'), { masquee: false, occurrences: 1, interrompue: false });
  assert.deepEqual(preparerCartes([lu('a', '1'), enCours], 'complete').get('plu-9'), { masquee: false, occurrences: 1, interrompue: true });
  assert.deepEqual(preparerCartes([lu('a', '1'), enCours], 'error').get('plu-9'), { masquee: false, occurrences: 1, interrompue: true });
  // Deux appels en cours ne sont pas des doublons : on ne sait pas encore ce qu'ils rendront.
  const deux = preparerCartes([enCours, { ...enCours, id: 'plu-10' }], 'streaming');
  assert.equal(deux.get('plu-10')!.masquee, false);
});

test('les outils sans carte de résultat (devis, actions, Studio) ne sont jamais masqués', () => {
  const devis = (id: string): ActiveToolCall => ({ id, name: 'proposer_mission', status: 'success', output: { status: 'ok', data: { mission_id: 'm1' } } });
  const cartes = preparerCartes([devis('d1'), devis('d2')], 'complete');
  assert.deepEqual(cartes.get('d2'), { masquee: false, occurrences: 1, interrompue: false });
});
