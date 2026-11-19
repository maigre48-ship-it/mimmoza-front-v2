import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DUREE_IMAGE_PHOTO_S, dureeAnnonceeImagePhoto, dureeEcoulee, dureeImagePhotoCourte, estFondPhoto, ligneTempsRendu } from './dureeRendu.ts';
import { dureeEstimeeImage } from './travauxLogique.ts';
import { dureeAnnoncee } from '../../../supabase/functions/copilot-chat/agent/studio.ts';
import { vueCarteSuivi } from '../../spaces/copilot/studio3d/suiviRenduChat.ts';

describe('LOT G8 — durée d’une image dans une photo', () => {
  it('le devis d’une image dans une photo ne reprend plus la formule de l’image d’étude (57 min à 2 h 17)', () => {
    const extension = dureeAnnoncee('image', { fond: 'photo_client', vues: ['trois_quarts_gauche', 'face'] }, true);
    assert.equal(extension, 'environ 4 à 6 min une fois le rendu démarré (estimé ; 3 à 5 min si la scène n’a pas changé depuis le dernier rendu ; mesuré avant les derniers réglages : 5 à 7 min)');
    assert.doesNotMatch(extension, /57 min|aperçu de contrôle/);
    const projet = dureeAnnoncee('image', { fond: 'photo_rue', vues: ['trois_quarts_gauche', 'face'] });
    assert.match(projet, /^environ 4 à 6 min/);
    assert.match(projet, /l’image d’étude demande 57 min à 2 h 17 de plus$/);
    // Image d'étude : VIS-14 (I1 a) — une vue de rue piéton peut être rendue plus grande (décentrement, image livrée
    // ≥ 2880 px) : jusqu'à × 1,6 ; une vue sans décentrement (intérieure) garde la formule d'avant.
    assert.equal(dureeAnnoncee('image', { vues: ['face'] }), 'environ 37 min à 1 h 53 une fois le rendu démarré (préparation, aperçu de contrôle, puis 20 à 60 min par vue, jusqu’au double pour une vue décentrée ou aérienne rendue plus grande)');
    assert.match(dureeAnnoncee('image', { vues: ['sejour'] }), /^environ 37 min à 1 h 17 /);
    assert.match(dureeAnnoncee('film', {}), /12 h/);
  });
  it('carte du site et atelier', () => {
    assert.equal(dureeImagePhotoCourte(), 'environ 4 à 6 min (estimé)');
    assert.equal(dureeEstimeeImage(2, 'finale', 'photo_rue'), 'environ 4 à 6 min (estimé)');
    assert.equal(dureeEstimeeImage(1), 'environ 37 min à 1 h 17');
    assert.equal(dureeEstimeeImage(1, 'finale', 'etude'), 'environ 37 min à 1 h 17');
    assert.ok(estFondPhoto('photo_client') && !estFondPhoto('etude') && !estFondPhoto(undefined));
    assert.ok(DUREE_IMAGE_PHOTO_S.express.max < DUREE_IMAGE_PHOTO_S.mesuree.max);
  });
  it('ligne de suivi d’un rendu en cours', () => {
    const t0 = Date.parse('2026-11-18T08:00:00Z');
    const t = { type: 'image', options: { fond: 'photo_rue' }, demarre_le: '2026-11-18T08:00:00Z' };
    assert.equal(ligneTempsRendu(t, t0 + 130_000), 'Démarré il y a 2 min 10 — une image dans une photo prend habituellement 4 à 6 min (estimé).');
    assert.match(ligneTempsRendu(t, t0 + 600_000)!, /plus longue que d’habitude/);
    assert.equal(ligneTempsRendu({ ...t, options: { fond: 'etude' } }, t0), null);
    assert.equal(ligneTempsRendu({ ...t, type: 'film' }, t0), null);
    assert.equal(ligneTempsRendu({ ...t, demarre_le: null }, t0), null);
    assert.equal(dureeEcoulee(45_000), '45 s');
    assert.equal(dureeEcoulee(120_000), '2 min');
  });
  it('la carte de suivi d’une image dans une photo en cours affiche le temps écoulé', () => {
    const maintenant = Date.parse('2026-11-18T08:03:00Z');
    const travail = {
      id: '11111111-1111-4111-8111-111111111111', type: 'image', statut: 'en_cours', progression: 40, etape: 'Rendu du projet dans la photo de rue',
      options: { fond: 'photo_rue', vues: ['face'], ambiance: 'jour', qualite: 'finale' }, fiche: {}, resultat: null, erreur: null, elements_omis: null,
      cree_le: '2026-11-18T07:59:00Z', demarre_le: '2026-11-18T08:00:00Z', termine_le: null, maj_le: '2026-11-18T08:02:50Z',
    };
    const vue = vueCarteSuivi(travail as never, { origine: 'lancement', positionFile: null, machine: null } as never, maintenant);
    assert.deepEqual(vue.details, ['Démarré il y a 3 min — une image dans une photo prend habituellement 4 à 6 min (estimé).']);
  });
});
