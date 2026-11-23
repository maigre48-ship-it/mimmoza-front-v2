// node --test src/spaces/copilot/studio3d/preparationBase.test.ts
// 23/11 — 3D préparée par l'action directe « Préparer » / « Ouvrir mon projet en 3D » (studio_preparations, hors
// messages) : l'étape 3 du parcours passe « faite » et l'aperçu (7) n'est plus bloqué. Cas réel : Ascain a7cca310,
// préparation 43fbacf6 (3 plots R+1, 960 m², 12 logements ; R+2 demandé, R+1 retenu car 7 m max).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblerSourcesEcran, resumePreparationBase, type EntreeEcran } from './parcoursEcran.ts';
import { calculerParcours } from '../../../lib/studio/parcours.ts';

const base = (preparationBase: EntreeEcran['preparationBase']): EntreeEcran => ({
  messages: [], conversationId: 'a7cca310-82fc-4be7-84f3-d4b3cb25a5f1', typeChoisi: 'film',
  missions: [{ id: 'd1cde026-7f59-460f-bae4-e41125555b4c', type: 'conception', statut: 'terminee', conversation_id: 'a7cca310-82fc-4be7-84f3-d4b3cb25a5f1', criteres: { parcel_ids: ['64065000AI0002'] } } as never],
  travaux: [], parcelle: '64065000AI0002 · Ascain', brief: null, film: null, visite: null, preparationBase,
});

test('résumé lisible de studio_preparations.resume', () => {
  const r = resumePreparationBase({ batiments: 3, gabarit: 'R+1', sdp_estimee_m2: 960, logements_places: 12,
    gabarit_retenu: 'R+2 demandé, R+1 retenu dans la 3D car hauteur max 7 m (règle du PLU) — modifiable' });
  assert.equal(r, '3 bâtiments en R+1 · ≈ 960 m² de surface de plancher · 12 logements · R+2 demandé, R+1 retenu dans la 3D car hauteur max 7 m (règle du PLU) — modifiable');
  assert.equal(resumePreparationBase(null), null);
});

test('3D préparée en base → étape 3 faite, action « Voir / ajuster », aperçu plus bloqué par la 3D', () => {
  const sans = calculerParcours(assemblerSourcesEcran(base(null)));
  assert.equal(sans.etapes.find((e) => e.cle === 'volume')!.statut, 'a_faire');
  const avec = calculerParcours(assemblerSourcesEcran(base({ resume: '3 bâtiments en R+1' })));
  const volume = avec.etapes.find((e) => e.cle === 'volume')!;
  assert.equal(volume.statut, 'fait');
  assert.equal(volume.action.cible, 'dimensions');
  const apercu = avec.etapes.find((e) => e.cle === 'apercu')!;
  assert.notEqual(apercu.debloquePar, 'volume');
});
