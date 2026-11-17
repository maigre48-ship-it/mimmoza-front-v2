// LOT X9 (17/11/2026) — photo réelle obligatoire pour une image d'EXTENSION (décision d'Albé, 17/11 13 h 50).
// Une image d'extension n'est montrée QUE si l'extension a été insérée dans une vraie photo de la maison ; sinon la
// carte du chat ne montre aucune image (même livrée par une ancienne machine de rendu) et demande une photo.
// Cas réel rejoué : travail 8b123a95 du 17/11/2026 (930470000P0646, photo de rue au calage insuffisant ± 3,85 m).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSIGNES_PHOTO_MAISON, contourDeLaFiche, estTravailExtension, imageSurPhotoReelle, lireDemandePhotoMaison, photoRequiseDuResultat,
  TEXTES_PHOTO_REQUISE, TITRE_PHOTO_NECESSAIRE,
} from './photoReelle.ts';
import { lireTravail } from './travauxLogique.ts';
import { extensionSansPhotoReelle, fichiersResultat, vueCarteSuivi, type IndiceSuivi } from '../../spaces/copilot/studio3d/suiviRenduChat.ts';
import { messagePhotoMaison } from '../../spaces/copilot/studio3d/choixFond.ts';
import { BRIEF_BLOC_LANGUE } from '../../spaces/copilot/studio3d/briefCreatif.ts';

const INTERNES = /\b(lot|moteur|serveur|worker|unreal|blender|panoramax)\b/i;
const INDICE: IndiceSuivi = { jobId: '8b123a95-69d6-4b37-935a-f78dabc13329', type: 'image', statut: 'termine', origine: 'etat', positionFile: null, machine: null } as IndiceSuivi;
const MAINTENANT = Date.parse('2026-11-17T12:50:00Z');

/** Ligne `studio_jobs` du 17/11 (résultat réduit à ce qui compte ici). */
const LIGNE_17_11 = {
  id: '8b123a95-69d6-4b37-935a-f78dabc13329', conversation_id: '90af3ef2-9dd4-4943-bce6-d1e052c1c802', type: 'image', statut: 'termine', progression: 100, etape: 'Terminé',
  options: { fond: 'photo_rue', vues: ['trois_quarts_gauche'], ambiance: 'jour', existant: 'conserver' }, elements_omis: [], erreur: null,
  cree_le: '2026-11-17T12:39:32Z', maj_le: '2026-11-17T12:44:52Z', demarre_le: '2026-11-17T12:40:00Z', termine_le: '2026-11-17T12:44:52Z',
  projet_extension: { format: 'mimmoza-projet-extension', version: 1, nature: 'extension' },
  resultat: {
    image_path: 'u/8b123a95/image-trois_quarts_gauche.jpg',
    images: [{ vue: 'trois_quarts_gauche', libelle: '3/4 gauche', jpeg_path: 'u/8b123a95/image-trois_quarts_gauche.jpg', png_path: null, largeur: 2880, hauteur: 1620 }],
    qualite: 'finale',
    avertissements: [
      'Image d’étude, pas une image photoréaliste : le bâtiment est rendu sans son contexte urbain réel.',
      'Photo de rue non utilisée pour l’instant : le placement du projet dans la photo reste à valider. Image d’étude livrée en attendant ; « Ajuster le placement » permet de caler le projet dans la photo.',
      'Le relief du terrain n’était pas disponible : le rendu est calculé sur un terrain supposé plat.',
    ],
    extension: { ok: true, type: 'laterale', livrable: false, statut_x7: 'a_valider' },
    photomontage: {
      tente: true, statut: 'a_valider', verdict: 'insuffisant', incertitude_m: 3.85,
      raison: 'Placement automatique dans la photo de rue non validé : Calage automatique insuffisant (précision ± 3,8 m). Ajustez le placement par quelques clics.',
      source_photo: { id: '18ac1ae2-5fa7-450d-957c-4a586ca96f66', date: '2026-03-06', type: 'panoramax', licence: 'etalab-2.0', producteur: 'immergis' },
      mention: 'Photo : Panoramax / IGN — immergis, 06/03/2026 — Licence Ouverte 2.0',
      atelier: { plan_path: 'u/8b123a95/atelier/plan.json', photo_path: 'u/8b123a95/atelier/photo.jpg' },
    },
  },
};

test('X9-F1 : l’essai du 17/11 (ancienne machine, image de synthèse livrée) → AUCUNE image montrée, photo demandée, atelier proposé', () => {
  const t = lireTravail(LIGNE_17_11)!;
  assert.ok(t);
  assert.equal(estTravailExtension(t), true);
  assert.equal(imageSurPhotoReelle(t.resultat), false);
  assert.equal(extensionSansPhotoReelle(t), true);
  assert.deepEqual(fichiersResultat(t), [], 'aucun fichier image présenté');
  const v = vueCarteSuivi(t, INDICE, MAINTENANT);
  assert.equal(v.etat, 'termine');
  assert.equal(v.titre, TITRE_PHOTO_NECESSAIRE);
  assert.equal(v.pastille, 'Photo nécessaire');
  assert.equal(v.image, null, 'pas de libellé « image d’étude »');
  assert.equal(v.photoRequise?.code, 'calage_insuffisant');
  assert.equal(v.photoRequise?.atelier, true);
  assert.equal(v.phrase, TEXTES_PHOTO_REQUISE.calage_insuffisant);
  assert.ok(!v.avertissements.some((a) => /image d[’']étude/i.test(a)), JSON.stringify(v.avertissements));
  assert.ok(v.avertissements.some((a) => /terrain supposé plat/.test(a)));
});

test('X9-F2 : machine à jour (aucune image, `photo_requise`) → résultat lisible, aucune image, textes du site', () => {
  const ligne = { ...LIGNE_17_11, resultat: { image_path: null, images: [], qualite: 'finale', avertissements: ['Texte reçu'], extension: { ok: true, livrable: false },
    photo_requise: { code: 'aucune_photo', texte: 'texte reçu jamais affiché tel quel', raison: 'Pas de photo de rue à moins de 60 m.', atelier: false, source: null } } };
  const t = lireTravail(ligne)!;
  assert.ok(t.resultat, 'un résultat sans image reste lisible');
  assert.deepEqual(fichiersResultat(t), []);
  const v = vueCarteSuivi(t, INDICE, MAINTENANT);
  assert.equal(v.photoRequise?.code, 'aucune_photo');
  assert.equal(v.photoRequise?.texte, TEXTES_PHOTO_REQUISE.aucune_photo);
  assert.equal(v.photoRequise?.raison, 'Pas de photo de rue à moins de 60 m.');
  assert.equal(v.photoRequise?.atelier, false);
});

test('X9-F3 : extension insérée dans une vraie photo → images montrées ; projet NEUF : comportement inchangé', () => {
  const livre = { ...LIGNE_17_11, resultat: { ...LIGNE_17_11.resultat, avertissements: [], extension: { ok: true, livrable: true, statut_x7: 'livrable' },
    image_path: 'u/8b123a95/photo-rue.jpg', images: [{ vue: 'photo_rue', libelle: 'Photo de rue', jpeg_path: 'u/8b123a95/photo-rue.jpg' }],
    photomontage: { ...LIGNE_17_11.resultat.photomontage, statut: 'livre', verdict: 'cale', atelier: undefined } } };
  const t = lireTravail(livre)!;
  assert.equal(imageSurPhotoReelle(t.resultat), true);
  assert.equal(extensionSansPhotoReelle(t), false);
  assert.equal(fichiersResultat(t).length, 1);
  assert.equal(vueCarteSuivi(t, INDICE, MAINTENANT).photoRequise, null);
  // Projet neuf (pas d'extension) : l'image d'étude reste montrée comme avant (hors périmètre de la décision).
  const { projet_extension: _p, ...neuf } = LIGNE_17_11;
  const tn = lireTravail({ ...neuf, resultat: { ...LIGNE_17_11.resultat, extension: undefined } })!;
  assert.equal(estTravailExtension(tn), false);
  assert.equal(fichiersResultat(tn).length, 1);
});

test('X9-F4 : codes déduits d’une ancienne machine (repli, fond étude) ; jamais de « livré » sans photo source', () => {
  assert.equal(photoRequiseDuResultat({ images: [{ jpeg_path: 'a.jpg' }], photomontage: null })?.code, 'aucune_photo');
  assert.equal(photoRequiseDuResultat({ photomontage: { statut: 'repli_etude', raison: 'Pas de photo de rue.', source_photo: null } })?.code, 'aucune_photo');
  assert.equal(photoRequiseDuResultat({ photomontage: { statut: 'repli_etude', raison: 'Photo de nuit.', source_photo: { type: 'client' } } })?.code, 'photo_inutilisable');
  assert.equal(photoRequiseDuResultat({ photomontage: { statut: 'livre', source_photo: null } })?.code, 'aucune_photo');
  const sansAtelier = photoRequiseDuResultat({ photomontage: { statut: 'a_valider', source_photo: { type: 'client' } } })!;
  assert.equal(sansAtelier.atelier, false);
  assert.doesNotMatch(sansAtelier.texte, /Ajustez le placement/);
});

test('X9-F5 : message « photo de ma maison » (bloc sans brief), demande de l’outil, contour de la fiche, textes sans nom interne', () => {
  const m = messagePhotoMaison({ chemin: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg', octets: 1000 });
  const bloc = JSON.parse(new RegExp('```' + BRIEF_BLOC_LANGUE + '\\n([\\s\\S]*?)\\n```').exec(m)![1]!);
  assert.deepEqual(bloc, { v: 1, type: 'image', fond: { fond: 'photo_client', photo_client: { chemin: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg', octets: 1000 } } });
  const lu = lireDemandePhotoMaison({ name: 'studio_lancer_rendu', status: 'partial', output: { status: 'partial', data: { photo_maison: { code: 'aucune_photo', raison: 'Aucune photo à moins de 60 m.', contour: [[2.55, 48.89], [2.551, 48.89], [2.551, 48.891]] } } } });
  assert.equal(lu?.code, 'aucune_photo');
  assert.equal(lu?.contour?.length, 3);
  assert.equal(lireDemandePhotoMaison({ name: 'studio_lancer_rendu', status: 'ok', output: { status: 'ok', data: {} } }), null);
  const fiche = { charge: { site: { parcelles: [{ id: '930470000P0646', geometrie: { type: 'MultiPolygon', coordinates: [[[[2.54999713, 48.89137322], [2.55000455, 48.8913987], [2.55005347, 48.89170321], [2.55031807, 48.89168585], [2.55026501, 48.89135489], [2.54999713, 48.89137322]]]] } }] } } };
  assert.equal(contourDeLaFiche(fiche)?.length, 5);
  assert.equal(contourDeLaFiche({}), null);
  for (const t of [...Object.values(TEXTES_PHOTO_REQUISE), ...CONSIGNES_PHOTO_MAISON, TITRE_PHOTO_NECESSAIRE, m.split('\n')[0]!]) assert.doesNotMatch(t, INTERNES);
});
