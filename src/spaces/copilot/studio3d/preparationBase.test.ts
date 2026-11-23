// node --test src/spaces/copilot/studio3d/preparationBase.test.ts
// 23/11 — 3D préparée par l'action directe « Préparer » / « Ouvrir mon projet en 3D » (studio_preparations, hors
// messages) : l'étape 3 du parcours passe « faite » et l'aperçu (7) n'est plus bloqué. Cas réel : Ascain a7cca310,
// préparation 43fbacf6 (3 plots R+1, 960 m², 12 logements ; R+2 demandé, R+1 retenu car 7 m max).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblerSourcesEcran, type EntreeEcran } from './parcoursEcran.ts';
import { calculerParcours } from '../../../lib/studio/parcours.ts';
import { referenceDepuisLigne } from './preparationStudio.ts';

const LIGNE = { id: '43fbacf6-dbb8-45b3-a23c-fe5bb1d6a18f', conception_id: 'c6fa3aff-2f80-4721-b6b5-2845832e9bb0', idu: '64065000AI0002', commune: 'Ascain',
  resume: { batiments: 3, gabarit: 'R+1', sdp_estimee_m2: 960, logements_places: 12, logements_vises: 12,
    alertes: ['R+2 demandé, R+1 retenu dans la 3D car hauteur max 7 m (règle du PLU) — modifiable'] } };

const base = (preparationRef: EntreeEcran['preparationRef']): EntreeEcran => ({
  messages: [], conversationId: 'a7cca310-82fc-4be7-84f3-d4b3cb25a5f1', typeChoisi: 'image',
  missions: [{ id: 'd1cde026-7f59-460f-bae4-e41125555b4c', type: 'conception', statut: 'terminee', conversation_id: 'a7cca310-82fc-4be7-84f3-d4b3cb25a5f1', criteres: { parcel_ids: ['64065000AI0002'] } } as never],
  travaux: [], parcelle: '64065000AI0002 · Ascain', brief: null, film: null, visite: null, preparationRef,
});

test('ligne studio_preparations → même référence que celle des messages', () => {
  const r = referenceDepuisLigne(LIGNE)!;
  assert.equal(r.preparationId, LIGNE.id);
  assert.equal(r.batiments, 3); assert.equal(r.gabarit, 'R+1'); assert.equal(r.sdpM2, 960); assert.equal(r.logementsPlaces, 12);
  assert.equal(r.commune, 'Ascain');
  assert.equal(referenceDepuisLigne({ id: 'x' }), null);
  assert.equal(referenceDepuisLigne({ ...LIGNE, resume: null }), null);
});

test('3D préparée en base → étape 3 faite (résumé + R+1 retenu), « Voir / ajuster », aperçu à lancer', () => {
  const sans = calculerParcours(assemblerSourcesEcran(base(null)));
  assert.equal(sans.etapes.find((e) => e.cle === 'volume')!.statut, 'a_faire');
  const avec = calculerParcours(assemblerSourcesEcran(base(referenceDepuisLigne(LIGNE))));
  const volume = avec.etapes.find((e) => e.cle === 'volume')!;
  assert.equal(volume.statut, 'fait');
  assert.match(volume.resume, /3 bâtiments en R\+1/);
  assert.match(volume.resume, /R\+1 retenu/);
  assert.equal(volume.action.cible, 'dimensions');
  const apercu = avec.etapes.find((e) => e.cle === 'apercu')!;
  assert.equal(apercu.statut, 'a_faire');
  assert.equal(apercu.action.cible, 'apercu');
});
