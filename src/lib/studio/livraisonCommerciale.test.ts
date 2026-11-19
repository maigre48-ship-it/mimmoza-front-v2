// VIS-10 (19/11/2026) — livraison commerciale et résultats enrichis de l'image, côté front : option `livraison`
// (mêmes règles que le worker), lecture de resultat.livraison_commerciale / rendu_mimmoza / niveau_realisme,
// pronostic des vues « sous condition » dans le devis, rétrocompatibilité d'un résultat d'avant VIS-10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avecLivraisonParDefaut, badgeRealisme, lireLivraisonCommerciale, lireRenduMimmoza, nomTelechargement, validerOptionLivraison } from './livraisonCommerciale.ts';
import { lireTravail, validerOptions, type ResultatImage } from './travauxLogique.ts';
import { phrasesPronosticVues, pronosticVues } from './catalogueVues.ts';
import { lirePronosticDevis } from '../../spaces/copilot/studio3d/choixFond.ts';

const U = '11111111-1111-4111-8111-111111111111';
const J = '22222222-2222-4222-8222-222222222222';
const L = `${U}/${J}/livraison`;

/** Bloc tel qu'écrit par le worker (worker/src/livraison/index.ts, version 1 ; noms : paquet.ts nomFichierVisuel). */
const BLOC = {
  version: 1,
  mention: 'Illustration non contractuelle à caractère d’ambiance', credit: 'Perspective : Mimmoza', sans_mention_dans_zip: true,
  zips: [{ chemin: `${L}/livraison-22222222.zip`, taille_mo: 17.4, entrees: 17, vues: ['trois_quarts_droite'] }],
  vues: [{
    vue: 'trois_quarts_droite', libelle: '3/4 droite', centrage: 'batiment',
    formats: [
      { format: 'original', libelle: 'Original pleine définition', chemin: `${L}/trois_quarts_droite/trois_quarts_droite-original.jpg`, largeur: 2880, hauteur: 1620, agrandi: false, avertissements: [] },
      { format: 'web_bandeau', libelle: 'Bandeau web 1920 × 800', chemin: `${L}/trois_quarts_droite/trois_quarts_droite-web-bandeau.jpg`, largeur: 1920, hauteur: 800, agrandi: false, avertissements: [] },
      { format: 'web_16_9', libelle: 'x', chemin: `${L}/trois_quarts_droite/trois_quarts_droite-web-16-9.jpg`, largeur: 2560, hauteur: 1440, agrandi: false, avertissements: [] },
      { format: 'mobile_portrait', libelle: 'x', chemin: `${L}/trois_quarts_droite/trois_quarts_droite-mobile-portrait.jpg`, largeur: 1080, hauteur: 1350, agrandi: false, avertissements: ['Mobile portrait 1080 × 1350 : le bâtiment déborde du cadre (69 % de sa largeur visible).'] },
      { format: 'vignette', libelle: 'x', chemin: `${L}/trois_quarts_droite/trois_quarts_droite-vignette.jpg`, largeur: 600, hauteur: 400, agrandi: false, avertissements: [] },
      { format: 'impression_a4', libelle: 'x', chemin: `${L}/trois_quarts_droite/trois_quarts_droite-impression-a4.jpg`, largeur: 3508, hauteur: 2480, agrandi: true, avertissements: ['image AGRANDIE ×1,53'] },
      { format: 'poster', libelle: 'inconnu', chemin: `${L}/x.jpg` },
    ],
  }],
  plan_vente: { lot: 'A204', typologie: 'T3', echelle: '1/50', surface_m2: 61.2, surface_indicative: true, pdf_path: `${L}/plan-de-vente/lot-A204.pdf`, png_path: `${L}/plan-de-vente/lot-A204.png`, avertissements: ['Orientation non renseignée.'] },
  avertissements: ['Mobile portrait : bâtiment coupé.'],
};

test('option livraison : mêmes règles que le worker (null = absent, formats connus, mention jamais vide)', () => {
  assert.deepEqual(validerOptionLivraison({}), { ok: true, valeur: {} });
  assert.deepEqual(validerOptionLivraison({ active: true, formats: ['web_16_9', 'impression_a4'], credit: null, position: 'bas_droite' }),
    { ok: true, valeur: { active: true, formats: ['web_16_9', 'impression_a4'], credit: null, position: 'bas_droite' } });
  assert.equal(validerOptionLivraison({ active: null }).ok, true);
  for (const mauvais of [{ formats: [] }, { formats: ['poster'] }, { formats: ['vignette', 'vignette'] }, { mention: ' ' }, { mention: 'x'.repeat(121) }, { credit: 'y'.repeat(61) }, { position: 'haut' }, { zip: true }, null, 'oui']) {
    assert.equal(validerOptionLivraison(mauvais).ok, false, JSON.stringify(mauvais));
  }
  // Options du travail image (FilmVisitePanel / creerTravail) : clé admise, recopiée validée ; refus motivé sinon.
  const r = validerOptions('image', { vues: ['face'], livraison: { formats: ['vignette'] } });
  assert.equal(r.ok, true);
  assert.deepEqual((r as { valeur: { livraison?: unknown } }).valeur.livraison, { formats: ['vignette'] });
  const sans = validerOptions('image', { vues: ['face'] });
  assert.equal(sans.ok && 'livraison' in sans.valeur, false, 'absente : non ajoutée (défaut du worker)');
  const ko = validerOptions('image', { vues: ['face'], livraison: { mention: '' } });
  assert.equal(ko.ok, false);
  assert.match((ko as { erreur: string }).erreur, /mention/);
});

test('resultat.livraison_commerciale : ZIP, vues × formats (inconnus écartés), plan de vente ; illisible → null', () => {
  const l = lireLivraisonCommerciale(BLOC)!;
  assert.equal(l.zips.length, 1);
  assert.equal(l.zips[0].tailleMo, 17.4);
  assert.deepEqual(l.vues[0].formats.map((f) => f.format), ['original', 'web_bandeau', 'web_16_9', 'mobile_portrait', 'vignette', 'impression_a4']);
  assert.deepEqual(l.vues[0].formats.map((f) => f.libelle), ['Original', 'Bandeau web', '16:9', 'Portrait mobile', 'Vignette', 'A4 impression']);
  assert.equal(l.vues[0].formats[5].agrandi, true);
  assert.equal(l.planVente?.present, true);
  assert.equal(l.planVente?.present && l.planVente.png, `${L}/plan-de-vente/lot-A204.png`);
  assert.equal(l.sansMentionDansZip, true);
  assert.deepEqual(lireLivraisonCommerciale({ ...BLOC, plan_vente: { absent: 'aucun logement témoin pour ce projet' } })?.planVente, { present: false, raison: 'aucun logement témoin pour ce projet' });
  assert.equal(lireLivraisonCommerciale({ ...BLOC, version: 2 }), null);
  assert.equal(lireLivraisonCommerciale('x'), null);
  assert.equal(nomTelechargement(`${L}/plan-de-vente/lot-A204.pdf`), 'mimmoza-lot-A204.pdf');
  assert.equal(nomTelechargement(`${L}/livraison-22222222.zip`), 'mimmoza-livraison-22222222.zip');
});

test('rendu_mimmoza et niveau de réalisme : lus tels quels ; « photoréaliste » seulement si établi', () => {
  const r = lireRenduMimmoza({ demande: { vues: ['sejour'], ambiance: null, saison: 'automne', heure: 'midi' }, appliques: ['vues du brief : séjour'], non_appliques: ['saison « automne » : non appliqué (aucune variante saisonnière)', 'heure « midi » : non appliqué'] })!;
  assert.equal(r.demande.saison, 'automne');
  assert.equal(r.nonAppliques.length, 2);
  assert.equal(lireRenduMimmoza({}), null);
  assert.equal(badgeRealisme('photorealiste').libelle, 'Photoréaliste');
  assert.equal(badgeRealisme('etude', ['voirie non modélisée.']).detail, 'Image d’étude : voirie non modélisée.');
  assert.equal(badgeRealisme(null).libelle, 'Réalisme non vérifié');
});

test('lireTravail : champs VIS-10 lus ; résultat d’avant VIS-10 strictement inchangé', () => {
  const ancien = { image_path: `${U}/${J}/image-face.jpg`, images: [{ vue: 'face', libelle: 'Face', jpeg_path: `${U}/${J}/image-face.jpg`, png_path: null, largeur: 2880, hauteur: 1620 }], qualite: 'finale', avertissements: [] };
  const ligne = (resultat: unknown) => ({ id: J, type: 'image', statut: 'termine', resultat });
  const avant = lireTravail(ligne(ancien))!.resultat as ResultatImage;
  assert.deepEqual(Object.keys(avant).sort(), ['avertissements', 'image_path', 'images', 'photomontage', 'qualite']);
  const apres = lireTravail(ligne({ ...ancien, niveau_realisme: 'etude', manques_realisme: ['voirie'], rendu_mimmoza: { demande: { saison: 'hiver' }, appliques: [], non_appliques: ['saison'] }, livraison_commerciale: BLOC }))!.resultat as ResultatImage;
  assert.equal(apres.niveau_realisme, 'etude');
  assert.deepEqual(apres.manques_realisme, ['voirie']);
  assert.deepEqual(apres.rendu_mimmoza?.nonAppliques, ['saison']);
  assert.equal(apres.livraison_commerciale?.vues[0].formats.length, 6);
  const illisible = lireTravail(ligne({ ...ancien, niveau_realisme: 'superbe', livraison_commerciale: { version: 9 } }))!.resultat as ResultatImage;
  assert.equal('niveau_realisme' in illisible || 'livraison_commerciale' in illisible, false);
});

test('devis : vues « sous condition » — probablement refusées d’après l’habillage, sinon « selon le projet »', () => {
  const vues = ['trois_quarts_gauche', 'balcon', 'terrasse', 'rooftop', 'jardin_prive', 'sejour', 'hall'];
  const sans = pronosticVues(vues, null);
  assert.deepEqual(sans.map((p) => [p.vue, p.pronostic]), [['terrasse', 'selon_projet'], ['balcon', 'selon_projet'], ['jardin_prive', 'selon_projet'], ['rooftop', 'selon_projet'], ['sejour', 'selon_projet']]);
  const avec = pronosticVues(vues, { balcons: 'aucun', attique: false, toiture: 'deux_pans_tuiles', rdc: 'commerces' });
  assert.ok(avec.filter((p) => p.vue !== 'sejour').every((p) => p.pronostic === 'probablement_refusee'), JSON.stringify(avec));
  assert.equal(avec.find((p) => p.vue === 'sejour')?.pronostic, 'selon_projet');
  assert.deepEqual(pronosticVues(vues, { balcons: 'loggias', attique: true, toiture: 'terrasse', rdc: 'logements' }).map((p) => p.pronostic).filter((x) => x !== 'selon_projet'), []);
  assert.deepEqual(pronosticVues(vues, null, false), [], 'repli VIS-10 : aucun pronostic');
  assert.match(phrasesPronosticVues(avec)[0], /^Vue « Terrasse » : sera probablement refusée/);
  // Lecture par la carte sous le devis (data.pronostic_vues du serveur).
  const call = { name: 'studio_lancer_rendu', status: 'done', output: { status: 'confirmation_requise', data: { type: 'image', pronostic_vues: [...avec, { vue: 'vue_mer', pronostic: 'selon_projet', raison: 'x' }, { vue: 'balcon', pronostic: 'peut-etre', raison: 'x' }] } } };
  assert.deepEqual(lirePronosticDevis(call).map((p) => p.vue), ['terrasse', 'balcon', 'jardin_prive', 'rooftop', 'sejour']);
  assert.deepEqual(lirePronosticDevis({ name: 'autre', output: call.output }), []);
});

test('livraison par défaut : image finale ⇒ { active: true } ; aperçu, film, plans seuls ⇒ rien ; drapeau à false ⇒ aucune clé', () => {
  const finale = { vues: ['face'], ambiance: 'jour', qualite: 'finale' };
  assert.deepEqual(avecLivraisonParDefaut('image', finale), { ...finale, livraison: { active: true } });
  assert.deepEqual(finale, { vues: ['face'], ambiance: 'jour', qualite: 'finale' }, 'objet reçu jamais modifié');
  // Qualité absente = finale (défaut du worker et de la base) — cas du chat.
  assert.deepEqual(avecLivraisonParDefaut('image', { vues: ['face'] }), { vues: ['face'], livraison: { active: true } });
  // Aperçu : aucune clé.
  const apercu = { vues: ['face'], qualite: 'apercu' };
  assert.equal(avecLivraisonParDefaut('image', apercu), apercu);
  assert.equal('livraison' in avecLivraisonParDefaut('image', apercu), false);
  // Option explicite gardée telle quelle.
  const explicite = { vues: ['face'], livraison: { formats: ['vignette'] } };
  assert.equal(avecLivraisonParDefaut('image', explicite), explicite);
  // Film, visite, plans seuls : inchangés.
  const film = { duree_s: 60 };
  assert.equal(avecLivraisonParDefaut('film', film), film);
  assert.equal(avecLivraisonParDefaut('visite360', {}).livraison, undefined);
  assert.equal('livraison' in avecLivraisonParDefaut('image', { vues: ['face'] }, { plansSeuls: true }), false);
  // Drapeau de repli à false : AUCUNE clé livraison envoyée (même explicite) — comportement d'avant VIS-10.
  assert.equal('livraison' in avecLivraisonParDefaut('image', finale, { actif: false }), false);
  assert.deepEqual(avecLivraisonParDefaut('image', explicite, { actif: false }), { vues: ['face'] });
  assert.equal(avecLivraisonParDefaut('image', apercu, { actif: false }), apercu);
  // La clé produite est valide pour la base / le worker.
  assert.equal(validerOptionLivraison(avecLivraisonParDefaut('image', finale).livraison).ok, true);
  assert.equal(validerOptions('image', avecLivraisonParDefaut('image', finale)).ok, true);
});
