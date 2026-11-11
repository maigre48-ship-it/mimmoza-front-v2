import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chargeValide, construireFiche, construireTravail, dureeEstimeeImage, estActif, fileIndisponible, libelleStatut, lienVisite, lireTravail,
  LIBELLES_TYPE, messageErreurTravail, optionsParDefaut, phraseElementsOmis, phraseSuivi, resumeOptions, titreDepuisFiche, validerOptions,
  type ResultatImage,
} from './travauxLogique.ts';
import { lireElementsOmis, lireManifesteVisite } from './manifesteVisite.ts';

const draft = {
  version: 1, objectif: 'Film de présentation de la résidence', localisation: '12 rue des Lilas, Lyon',
  programme: '12 logements', dimensions: null, style: 'contemporain, façade en brique', contraintes: null, questions: [], pieces: [],
};
// Charge Studio telle que produite par preparerChargeVoirEn3D (extrait : projet Mimmoza v2).
const charge = {
  format: 'mimmoza-projet', version: 2, projetId: 'mzchat-conv-1', etudeId: null, revision: 3,
  site: { parcelles: [{ id: '69123000AB0012' }], adresse: '12 Rue des Lilas 69003 Lyon' },
  batiments: [], omissions: [],
};

describe('options du film et de la visite', () => {
  it('pré-remplit les choix du fondateur', () => {
    assert.deepEqual(optionsParDefaut('film'), { duree_s: 60, ambiance: 'jour', format: '16:9', interieurs: true, musique: true });
    assert.deepEqual(optionsParDefaut('visite360'), { ambiance: 'jour', interieurs: true, resolution: '6k' });
  });
  it('complète les options absentes et accepte les valeurs prévues', () => {
    const v = validerOptions('film', { duree_s: 90, ambiance: 'nuit' });
    assert.ok(v.ok);
    assert.deepEqual(v.ok && v.valeur, { duree_s: 90, ambiance: 'nuit', format: '16:9', interieurs: true, musique: true });
    assert.ok(validerOptions('visite360', { resolution: '8k', ambiance: 'fin_de_journee', interieurs: false }).ok);
    assert.ok(validerOptions('film', undefined).ok);
  });
  it('refuse les valeurs hors contrat avec un message clair', () => {
    const duree = validerOptions('film', { duree_s: 45 });
    assert.equal(duree.ok, false);
    assert.match(!duree.ok ? duree.erreur : '', /30, 60 ou 90/);
    assert.equal(validerOptions('film', { format: '4:3' }).ok, false);
    assert.equal(validerOptions('film', { musique: 'oui' }).ok, false);
    assert.equal(validerOptions('visite360', { resolution: '12k' }).ok, false);
    assert.equal(validerOptions('visite360', { duree_s: 60 }).ok, false, 'option de film refusée pour une visite');
    assert.equal(validerOptions('film', { ambiance: 'aube' }).ok, false);
    assert.equal(validerOptions('film', 'texte').ok, false);
    assert.equal(validerOptions('photo' as never, {}).ok, false);
  });
});

describe('construction du travail depuis la fiche', () => {
  it('joint la charge « Voir en 3D » telle quelle, avec le draft, le titre et la conversation', () => {
    const t = construireTravail('film', draft, 'conv-1', charge, optionsParDefaut('film'));
    assert.ok(t.ok);
    if (!t.ok) return;
    assert.equal(t.valeur.type, 'film');
    assert.equal(t.valeur.conversation_id, 'conv-1');
    assert.deepEqual(Object.keys(t.valeur.fiche).sort(), ['charge', 'conversation_id', 'draft', 'titre', 'version']);
    assert.equal(t.valeur.fiche.version, 1);
    assert.equal(t.valeur.fiche.charge, charge, 'même objet : aucune reconstruction');
    assert.equal(t.valeur.fiche.draft.programme, '12 logements');
    assert.equal(t.valeur.fiche.titre, '12 logements — 12 rue des Lilas, Lyon');
    assert.equal(t.valeur.options.ambiance, 'jour');
    assert.doesNotThrow(() => JSON.stringify(t.valeur));
  });
  it('refuse un draft seul, sans charge Studio', () => {
    const sansCharge = construireFiche(draft, 'conv-1', null);
    assert.equal(sansCharge.ok, false);
    assert.match(!sansCharge.ok ? sansCharge.erreur : '', /Studio/);
    assert.equal(construireFiche(draft, 'conv-1', draft).ok, false, 'le JarvisDraft n’est pas une charge');
    assert.equal(chargeValide({ projetId: '' }), false);
    assert.equal(chargeValide(charge), true);
  });
  it('demande ce qui manque, sans rien deviner', () => {
    const sansObjectif = construireFiche({ ...draft, objectif: null }, 'conv-1', charge);
    assert.match(!sansObjectif.ok ? sansObjectif.erreur : '', /Décrivez/);
    assert.equal(construireFiche(draft, '', charge).ok, false);
    assert.equal(construireTravail('visite360', draft, 'conv-1', charge, { resolution: '12k' }).ok, false);
  });
  it('donne un titre lisible et borné', () => {
    assert.equal(titreDepuisFiche({ ...draft, programme: null, localisation: null } as never), 'Film de présentation de la résidence');
    assert.ok(titreDepuisFiche({ ...draft, programme: 'x'.repeat(300) } as never).length <= 120);
  });
});

describe('libellés d’état en français courant', () => {
  it('donne un libellé court pour chaque statut', () => {
    assert.equal(libelleStatut('en_attente'), 'En attente');
    assert.equal(libelleStatut('en_cours'), 'En préparation');
    assert.equal(libelleStatut('termine'), 'Prêt');
    assert.equal(libelleStatut('echec'), 'Échec');
    assert.equal(libelleStatut('annule'), 'Annulé');
    assert.ok(estActif('en_attente') && estActif('en_cours') && !estActif('termine') && !estActif('annule'));
  });
  it('décrit le suivi avec l’étape et la progression bornée', () => {
    assert.equal(phraseSuivi({ type: 'film', statut: 'en_cours', etape: 'Rendu 12/40', progression: 31.6, erreur: null }), 'Rendu 12/40 — 32 %');
    assert.equal(phraseSuivi({ type: 'film', statut: 'en_cours', etape: null, progression: 140, erreur: null }), 'Préparation en cours — 100 %');
    assert.match(phraseSuivi({ type: 'visite360', statut: 'en_attente', etape: null, progression: 0, erreur: null }), /Votre visite 360° est dans la file/);
    assert.equal(phraseSuivi({ type: 'visite360', statut: 'termine', etape: null, progression: 100, erreur: null }), 'Votre visite 360° est prête.');
    assert.equal(phraseSuivi({ type: 'film', statut: 'termine', etape: null, progression: 100, erreur: null }), 'Votre film est prêt.');
    assert.match(phraseSuivi({ type: 'film', statut: 'echec', etape: null, progression: 10, erreur: 'Unreal fermé' }), /Unreal fermé/);
  });
  it('résume les options pour l’historique', () => {
    assert.equal(resumeOptions('film', optionsParDefaut('film')), '60 s · en journée · paysage · intérieurs · musique');
    assert.equal(resumeOptions('visite360', { ambiance: 'nuit', interieurs: false, resolution: '8k' }), 'de nuit · 8K');
  });
});

describe('éléments omis faute d’asset photoréaliste', () => {
  it('forme la phrase affichée à l’utilisateur', () => {
    assert.equal(phraseElementsOmis([{ categorie: 'voitures', raison: 'aucun asset photoréaliste installé' }, { categorie: 'personnes', raison: 'x' }]),
      'Pour garder un rendu photoréaliste, ces éléments n’ont pas été ajoutés : voitures, personnes.');
    assert.equal(phraseElementsOmis([]), null);
    assert.equal(phraseElementsOmis(null), null);
  });
  it('ignore les entrées mal formées et les doublons', () => {
    assert.deepEqual(lireElementsOmis([{ categorie: 'Voitures' }, { categorie: 'voitures', raison: 'x' }, 3, { raison: 'sans catégorie' }, 'mobilier urbain']), [
      { categorie: 'Voitures', raison: 'aucun asset photoréaliste disponible' },
      { categorie: 'mobilier urbain', raison: 'aucun asset photoréaliste disponible' },
    ]);
  });
});

describe('lecture d’une ligne studio_jobs', () => {
  it('normalise un film terminé', () => {
    const t = lireTravail({ id: 'a', type: 'film', statut: 'termine', progression: 100, conversation_id: 'c', options: {}, cree_le: '2026-10-26T10:00:00Z', maj_le: 'x',
      resultat: { video_path: 'u/a/film.mp4', poster_path: 'u/a/poster.jpg', duree_s: 60, avertissements: ['ok', 3] }, elements_omis: [{ categorie: 'arbres', raison: 'r' }] });
    assert.equal(t?.resultat && 'video_path' in t.resultat ? t.resultat.video_path : null, 'u/a/film.mp4');
    assert.deepEqual(t?.resultat?.avertissements, ['ok']);
    assert.equal(t?.elements_omis.length, 1);
  });
  it('refuse un identifiant de visite suspect et une ligne incomplète', () => {
    const t = lireTravail({ id: 'b', type: 'visite360', statut: 'termine', resultat: { visite_id: '../../x' } });
    assert.equal(t?.resultat, null);
    assert.equal(lireTravail({ id: 'b', type: 'photo', statut: 'termine' }), null);
    assert.equal(lireTravail(null), null);
  });
  it('construit le lien public de la visite', () => {
    assert.equal(lienVisite('3f2a9c1e-0000-4000-8000-000000000000', 'https://mimmoza.fr/'), 'https://mimmoza.fr/visite/3f2a9c1e-0000-4000-8000-000000000000');
  });
});

describe('file absente (migration non appliquée)', () => {
  it('reconnaît les erreurs « table introuvable »', () => {
    assert.ok(fileIndisponible({ code: '42P01', message: 'relation "public.studio_jobs" does not exist' }));
    assert.ok(fileIndisponible({ code: 'PGRST205', message: "Could not find the table 'public.studio_jobs' in the schema cache" }));
    assert.ok(!fileIndisponible({ code: '23505', message: 'duplicate key' }));
    assert.equal(messageErreurTravail({ code: 'PGRST205', message: '' }), 'Films, visites 360° et images : bientôt disponible.');
  });
  it('relaie le message du plafond tel quel', () => {
    const m = 'Vous avez déjà 2 films ou visites en préparation. Attendez qu\'un des deux se termine.';
    assert.equal(messageErreurTravail({ code: 'P0001', message: m }), m);
    assert.match(messageErreurTravail({ message: 'boom' }), /Réessayez/);
  });
});

describe('manifeste de visite 360°', () => {
  const manifeste = {
    version: 1, titre: 'Résidence des Lilas', depart: 'sejour',
    panoramas: [
      { id: 'sejour', titre: 'Séjour', image: 'pano-sejour.jpg', largeur: 8192, hauteur: 4096, cap_initial_deg: 0, niveau: 0, position_m: [1, 1.6, 2],
        liens: [{ vers: 'cuisine', cap_deg: 75, inclinaison_deg: -10, libelle: 'Cuisine' }, { vers: 'fantome', cap_deg: 0, inclinaison_deg: 0 }] },
      { id: 'cuisine', titre: 'Cuisine', image: 'pano-cuisine.jpg', largeur: 8192, hauteur: 4096, cap_initial_deg: 90, niveau: 0, position_m: [4, 1.6, 2], liens: [] },
      { id: 'pirate', image: '../../secret.jpg' },
    ],
    plan: { image: 'plan-niveau-0.png', niveaux: [0, 1] },
    mentions: ['Images de synthèse non contractuelles'],
    elements_omis: [{ categorie: 'voitures', raison: 'aucun asset photoréaliste installé' }],
  };
  it('lit un manifeste valide et retire les liens orphelins et chemins dangereux', () => {
    const m = lireManifesteVisite(manifeste);
    assert.ok(m);
    assert.equal(m?.panoramas.length, 2);
    assert.deepEqual(m?.panoramas[0].liens.map(l => l.vers), ['cuisine']);
    assert.equal(m?.elements_omis[0].categorie, 'voitures');
    assert.deepEqual(m?.plan, { image: 'plan-niveau-0.png', niveaux: [0, 1] });
  });
  it('corrige un départ inconnu et refuse une version inconnue', () => {
    assert.equal(lireManifesteVisite({ ...manifeste, depart: 'grenier' })?.depart, 'sejour');
    assert.equal(lireManifesteVisite({ ...manifeste, version: 2 }), null);
    assert.equal(lireManifesteVisite({ ...manifeste, panoramas: [] }), null);
  });
});

describe('image photoréaliste (3e type de rendu)', () => {
  it('options par défaut : une vue 3/4 gauche, en journée', () => {
    assert.deepEqual(optionsParDefaut('image'), { vues: ['trois_quarts_gauche'], ambiance: 'jour', qualite: 'finale' });
    // LOT P2 : le type s'appelle « Image du projet » ; le résultat dit lui-même s'il est inséré dans une photo ou une image d'étude.
    assert.equal(LIBELLES_TYPE.image, 'Image du projet');
  });
  it('accepte 1 à 3 vues (remises dans l’ordre) et la fin de journée ; refuse la nuit et le hors contrat', () => {
    const v = validerOptions('image', { vues: ['face', 'trois_quarts_gauche'], ambiance: 'fin_de_journee' });
    assert.ok(v.ok);
    assert.deepEqual(v.ok && v.valeur, { vues: ['trois_quarts_gauche', 'face'], ambiance: 'fin_de_journee', qualite: 'finale' });
    assert.ok(validerOptions('image', undefined).ok);
    for (const o of [{ ambiance: 'nuit' }, { vues: [] }, { vues: ['face', 'face'] }, { vues: ['dessus'] }, { vues: 'face' },
      { vues: ['face', 'trois_quarts_gauche', 'trois_quarts_droite', 'face'] }, { duree_s: 30 }]) {
      assert.equal(validerOptions('image', o).ok, false, JSON.stringify(o));
    }
    assert.match((() => { const r = validerOptions('image', { ambiance: 'nuit' }); return r.ok ? '' : r.erreur; })(), /journée ou fin de journée/);
  });
  it('construit le travail comme pour le film (même fiche « Voir en 3D »)', () => {
    const t = construireTravail('image', draft, 'conv-1', charge, { vues: ['face'] });
    assert.ok(t.ok);
    assert.equal(t.ok && t.valeur.type, 'image');
    assert.deepEqual(t.ok && t.valeur.options, { vues: ['face'], ambiance: 'jour', qualite: 'finale' });
    assert.equal(t.ok && t.valeur.fiche.charge, charge);
  });
  it('durée estimée affichée selon le nombre de vues', () => {
    assert.equal(dureeEstimeeImage(1), 'environ 37 min à 1 h 17');
    assert.equal(dureeEstimeeImage(3), 'environ 1 h 17 à 3 h 17');
    assert.equal(dureeEstimeeImage(Number.NaN), dureeEstimeeImage(1));
    assert.equal(dureeEstimeeImage(1, 'apercu'), 'environ 15 min à 20 min');
    assert.equal(dureeEstimeeImage(3, 'apercu'), 'environ 25 min à 40 min');
  });
  it('LOT E0 — définition : haute définition par défaut, aperçu rapide possible, rien d’autre', () => {
    const v = validerOptions('image', { qualite: 'apercu' });
    assert.deepEqual(v.ok && v.valeur, { vues: ['trois_quarts_gauche'], ambiance: 'jour', qualite: 'apercu' });
    for (const q of ['8k', '4k', 1, true]) assert.equal(validerOptions('image', { qualite: q }).ok, false, String(q));
    assert.match((() => { const r = validerOptions('image', { qualite: '8k' }); return r.ok ? '' : r.erreur; })(), /haute définition ou aperçu rapide/);
    assert.equal(validerOptions('film', { qualite: 'apercu' }).ok, false, 'pas de qualité sur le film');
    assert.equal(resumeOptions('image', { vues: ['face'], qualite: 'apercu' }), 'Face · en journée · aperçu rapide');
    assert.equal(resumeOptions('image', { vues: ['face'] }), 'Face · en journée');
  });
  it('LOT E0 — base pas encore migrée : l’image est « bientôt disponible », le plafond (ancien et nouveau message) est relayé', () => {
    const options = { code: '22023', message: 'Options du travail invalides.' };
    assert.equal(messageErreurTravail(options, 'image'), 'L’image photoréaliste sera bientôt disponible.');
    assert.equal(messageErreurTravail({ code: '23514', message: 'new row for relation "studio_jobs" violates check constraint "studio_jobs_type_check"' }, 'image'), 'L’image photoréaliste sera bientôt disponible.');
    assert.equal(messageErreurTravail(options, 'film'), 'Ces options ne sont pas acceptées. Rechargez la page puis réessayez.');
    assert.equal(messageErreurTravail(options), 'Ces options ne sont pas acceptées. Rechargez la page puis réessayez.');
    const nouveau = 'Vous avez déjà 2 rendus en préparation (film, visite ou image). Attendez qu\'un des deux se termine.';
    assert.equal(messageErreurTravail({ code: 'P0001', message: nouveau }, 'image'), nouveau);
  });
  it('lit le résultat du worker (images JPEG + PNG) et en fait un suivi lisible', () => {
    const t = lireTravail({
      id: 'j-img', type: 'image', statut: 'termine', progression: 100,
      resultat: { image_path: 'u/j/image-face.jpg', images: [{ vue: 'face', libelle: 'Face', jpeg_path: 'u/j/image-face.jpg', png_path: 'u/j/image-face.png', largeur: 2880, hauteur: 1620 }, { vue: 'inconnue', jpeg_path: 'x.jpg' }], avertissements: ['note'] },
      elements_omis: [{ categorie: 'voitures', raison: 'aucun asset' }], cree_le: '2026-11-02T10:00:00Z', maj_le: '2026-11-02T11:00:00Z',
    });
    assert.ok(t);
    const r = t!.resultat as ResultatImage;
    assert.equal(r.image_path, 'u/j/image-face.jpg');
    assert.equal(r.images.length, 1, 'vue inconnue écartée');
    assert.equal(r.images[0]!.png_path, 'u/j/image-face.png');
    assert.equal(r.qualite, null, 'qualité absente du résultat : null');
    const t2 = lireTravail({ id: 'j2', type: 'image', statut: 'termine', resultat: { image_path: 'a.jpg', images: [], qualite: 'apercu', avertissements: [] } });
    assert.equal((t2!.resultat as ResultatImage).qualite, 'apercu');
    assert.equal(phraseSuivi(t!), 'Votre image est prête.');
    assert.equal(phraseSuivi({ ...t!, statut: 'en_attente' }), 'Votre image est dans la file : la préparation démarre dès que le Studio est libre.');
    assert.equal(resumeOptions('image', { vues: ['trois_quarts_gauche', 'face'], ambiance: 'fin_de_journee' }), '3/4 gauche, Face · fin de journée');
    assert.equal(lireTravail({ id: 'j', type: 'image', statut: 'termine', resultat: { avertissements: [] } })!.resultat, null, 'sans image : pas de résultat');
  });
});
