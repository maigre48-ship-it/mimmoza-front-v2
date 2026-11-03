import assert from 'node:assert/strict';
import test from 'node:test';
import { imagesAMonter, indiceVoisin, lireManifeste, MAX_IMAGES_CARROUSEL, sensGlissement, sourcesImage } from './carrouselStudio3DLogique.ts';

test('manifeste : entrées valides gardées dans l’ordre, invalides écartées', () => {
  const images = lireManifeste({ images: [
    { fichier: 'vue-aerienne', titre: '  Vue aérienne ', alt: 'Maison vue du ciel', demo: true },
    { fichier: 'Sans Alt', alt: 'x' },               // nom refusé
    { fichier: 'facade', alt: '   ' },               // alt vide
    { fichier: 'vue-aerienne', alt: 'doublon' },     // doublon
    { fichier: 'jardin', alt: 'Jardin' },
    null, 'texte',
  ] });
  assert.deepEqual(images, [
    { fichier: 'vue-aerienne', titre: 'Vue aérienne', alt: 'Maison vue du ciel', demo: true },
    { fichier: 'jardin', titre: null, alt: 'Jardin', demo: false },
  ]);
});

test('manifeste : 4 images au plus, manifeste absent ou cassé = aucune image', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ fichier: `img-${i}`, alt: `Image ${i}` }));
  assert.equal(lireManifeste({ images: six }).length, MAX_IMAGES_CARROUSEL);
  assert.deepEqual(lireManifeste(null), []);
  assert.deepEqual(lireManifeste({ images: 'non' }), []);
  assert.deepEqual(lireManifeste([]), []);
});

test('sources : srcset 1x/2x en AVIF, WebP et JPEG de repli', () => {
  const s = sourcesImage({ fichier: 'sejour' });
  assert.equal(s.avif, '/accueil/studio-3d/sejour-800.avif 1x, /accueil/studio-3d/sejour-1600.avif 2x');
  assert.equal(s.webp, '/accueil/studio-3d/sejour-800.webp 1x, /accueil/studio-3d/sejour-1600.webp 2x');
  assert.equal(s.jpeg, '/accueil/studio-3d/sejour-800.jpg 1x, /accueil/studio-3d/sejour-1600.jpg 2x');
  assert.equal(s.src, '/accueil/studio-3d/sejour-800.jpg');
});

test('navigation en boucle', () => {
  assert.equal(indiceVoisin(3, 4, 1), 0);
  assert.equal(indiceVoisin(0, 4, -1), 3);
  assert.equal(indiceVoisin(0, 1, 1), 0);
  assert.equal(indiceVoisin(2, 0, 1), 0);
});

test('glissement : horizontal net seulement', () => {
  assert.equal(sensGlissement(-80, 5), 1);
  assert.equal(sensGlissement(80, 5), -1);
  assert.equal(sensGlissement(20, 0), 0);
  assert.equal(sensGlissement(-60, 70), 0); // geste surtout vertical : on laisse défiler la page
});

test('chargement paresseux : image affichée + suivante + déjà vues', () => {
  assert.deepEqual([...imagesAMonter(0, 4, new Set())].sort(), [0, 1]);
  assert.deepEqual([...imagesAMonter(3, 4, new Set([0, 1]))].sort(), [0, 1, 3]);
  assert.deepEqual([...imagesAMonter(0, 1, new Set())], [0]);
});
