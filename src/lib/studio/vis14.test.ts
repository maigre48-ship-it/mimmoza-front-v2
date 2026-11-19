// VIS-14 (19/11/2026) — corrections de la relecture, côté front : badge PAR VUE et « réalisme non vérifié » (I5),
// livraison non produite avec sa raison (M3/M4), ambiance non forcée (I2), durée des vues décentrées (I1 a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeRealisme, lireNiveauRealisme } from './livraisonCommerciale.ts';
import { dureeEstimeeImage, facteurDureeVue, lireTravail, resumeOptions, validerOptions, type ResultatImage } from './travauxLogique.ts';

const base = { id: 'j', type: 'image', statut: 'termine', progression: 100, elements_omis: [], cree_le: '2026-11-19T10:00:00Z', maj_le: '2026-11-19T11:00:00Z' };

test('I5 — « non_verifie » lu et affiché « Réalisme non vérifié » (jamais « photoréaliste »)', () => {
  assert.equal(lireNiveauRealisme('non_verifie'), 'non_verifie');
  const b = badgeRealisme('non_verifie');
  assert.equal(b.libelle, 'Réalisme non vérifié');
  assert.equal(b.ton, 'inconnu');
  assert.match(b.detail ?? '', /pas pu être relu/);
  assert.equal(badgeRealisme(null).detail, null);
});

test('I5 — badge par vue : niveau et manques de chaque image, lus seulement s’ils sont lisibles', () => {
  const t = lireTravail({ ...base, resultat: {
    image_path: 'u/j/image-face.jpg', niveau_realisme: 'etude', manques_realisme: ['ni chaussée ni trottoir modélisés'],
    images: [
      { vue: 'face', libelle: 'Face', jpeg_path: 'u/j/image-face.jpg', largeur: 2880, hauteur: 1620, niveau_realisme: 'etude', manques_realisme: ['ni chaussée ni trottoir modélisés'] },
      { vue: 'sejour', libelle: 'Séjour', jpeg_path: 'u/j/image-sejour.jpg', largeur: 2880, hauteur: 1620, niveau_realisme: 'photorealiste' },
      { vue: 'chambre', libelle: 'Chambre', jpeg_path: 'u/j/image-chambre.jpg', niveau_realisme: 'magnifique' },
    ] } });
  const r = t!.resultat as ResultatImage;
  assert.equal(r.images[0]!.niveau_realisme, 'etude');
  assert.equal(r.images[1]!.niveau_realisme, 'photorealiste');
  assert.equal('niveau_realisme' in r.images[2]!, false, 'niveau illisible : rien d’affirmé');
  assert.equal(r.images[0]!.largeur, 2880, 'définition réellement livrée conservée');
});

test('M3/M4 — livraison non produite : la raison est lue (et absente si une livraison existe)', () => {
  const t = lireTravail({ ...base, resultat: { image_path: 'u/j/a.jpg', images: [{ vue: 'face', libelle: 'Face', jpeg_path: 'u/j/a.jpg' }], livraison_non_produite: 'la machine de rendu est réglée en aperçu' } });
  assert.equal((t!.resultat as ResultatImage).livraison_non_produite, 'la machine de rendu est réglée en aperçu');
  const sans = lireTravail({ ...base, resultat: { image_path: 'u/j/a.jpg', images: [{ vue: 'face', libelle: 'Face', jpeg_path: 'u/j/a.jpg' }] } });
  assert.equal('livraison_non_produite' in (sans!.resultat as ResultatImage), false);
});

test('I2 — ambiance absente non forcée ; ambiance choisie gardée ; résumé honnête', () => {
  const v = validerOptions('image', { vues: ['face'] });
  assert.ok(v.ok && !('ambiance' in v.valeur));
  const c = validerOptions('image', { vues: ['face'], ambiance: 'crepuscule' });
  assert.ok(c.ok && (c.valeur as { ambiance?: string }).ambiance === 'crepuscule');
  assert.equal(resumeOptions('image', { vues: ['face'] }), 'Face · lumière du brief projet');
});

test('I1 a — durée : facteur par vue, pack plaquette, vues décentrées et aérienne comptées', () => {
  assert.deepEqual(facteurDureeVue('aerienne'), [1.6, 2.3]);
  assert.deepEqual(facteurDureeVue('sejour'), [1, 1]);
  const pack = ['trois_quarts_gauche', 'trois_quarts_droite', 'aerienne', 'coeur_ilot', 'terrasse', 'sejour'] as const;
  assert.equal(dureeEstimeeImage(6, 'finale', undefined, [...pack]), 'environ 2 h 29 à 9 h 23');
  assert.equal(dureeEstimeeImage(6, 'finale'), 'environ 2 h 17 à 6 h 17');
});
