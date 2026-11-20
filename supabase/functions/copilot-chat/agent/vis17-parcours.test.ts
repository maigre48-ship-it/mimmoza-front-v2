// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis17-parcours.test.ts
// LOT VIS-17 — parcours guidé (20/11/2026) côté serveur :
//   · bloc « PARCOURS — FAIT FOI » relu à chaque message, statuts calculés depuis la base (mission, 3D préparée, rendus,
//     aperçu validé) + instantané de l'écran ; rien n'est déclaré par le modèle ;
//   · étape « Aperçu » possible depuis le chat : studio_lancer_rendu accepte `qualite: "apercu"` (rendu rapide, sans
//     livraison commerciale), durée annoncée de l'aperçu ; sans `qualite`, sortie identique à avant.
// Ligne RÉELLE studio_preparations 7b3a3a3b (conversation f9fa5476…, Ascain AI0001 + AI0002), mission 51029769 terminée.
import * as na from 'node:assert/strict';
import { blocParcoursServeur, parcoursPertinent, resumePreparation, sourcesServeur, type EntreeParcoursServeur } from './parcours-chat.ts';
import { dureeAnnoncee, resumeOptions, validerOptionsRendu } from './studio.ts';
import { OUTIL_STUDIO_LANCER_RENDU } from './outils.ts';
import { messageValidationApercu } from '../../../../src/lib/studio/parcours.ts';
import { avecLivraisonParDefaut } from '../../../../src/lib/studio/livraisonCommerciale.ts';

const APERCU = '33333333-3333-4333-8333-333333333333';
/** studio_preparations 7b3a3a3b… — champs du résumé RÉEL utilisés par le parcours. */
const PREP_ASCAIN = {
  idu: '64065000AI0001',
  resume: { assiette: 'AI0001 + AI0002 (2 349 m²)', batiments: 3, gabarit: 'R+1', niveaux: 2, logements_places: 12, logements_vises: 12, sdp_estimee_m2: 960, statut: 'calcule' },
};
const base = (extra: Partial<EntreeParcoursServeur> = {}): EntreeParcoursServeur => ({
  instantane: null, mission: { type: 'conception', statut: 'terminee' }, preparation: PREP_ASCAIN, travaux: [],
  textesUtilisateur: ['Lance une conception sur AI0001 + AI0002 à Ascain', 'Prépare le pack plaquette de ce projet (visuels de commercialisation), à partir de la 3D de la conception.'],
  messageCourant: 'Et maintenant ?', ...extra,
});

Deno.test('VIS17-1 : cas réel Ascain — terrain, conception, 3D faits ; prochaine étape « Style & façades » ; rendu final bloqué', () => {
  na.deepEqual(resumePreparation(PREP_ASCAIN), { terrain: 'AI0001 + AI0002 (2 349 m²)', volume: '3 bâtiments en R+1 · ≈ 960 m² de surface de plancher (estimée) · 12 logements placés' });
  const { bloc, parcours } = blocParcoursServeur(base());
  na.ok(parcours);
  na.equal(parcours!.type, 'image'); // « plaquette » dans le fil
  na.deepEqual(parcours!.etapes.map((e) => e.statut), ['fait', 'fait', 'fait', 'a_faire', 'a_faire', 'a_faire', 'a_faire', 'bloquee']);
  na.match(bloc, /# PARCOURS IMAGES — FAIT FOI/);
  na.match(bloc, /1\. Terrain — FAIT — AI0001 \+ AI0002 \(2 349 m²\)/);
  na.match(bloc, /3\. Volume 3D — FAIT — 3 bâtiments en R\+1/);
  na.match(bloc, /5\. Intérieurs — À FAIRE — .*\(Vue intérieure prévue : le logement témoin doit être défini\.\)/);
  na.match(bloc, /8\. Images finales & livraison — BLOQUÉE/);
  na.match(bloc, /PROCHAINE ÉTAPE : 4\. Style & façades\./);
  na.match(bloc, /Ne lance JAMAIS de rendu final/);
});

Deno.test('VIS17-2 : mission seulement en devis → conception à valider ; sans rien de visuel → pas de bloc', () => {
  const criteres = { idu: '64065000AI0001', commune: 'Ascain', programme: 'petit collectif R+2', parcel_ids: ['64065000AI0001', '64065000AI0002'] };
  const { parcours, bloc } = blocParcoursServeur(base({ mission: { type: 'conception', statut: 'devis', criteres }, preparation: null }));
  na.equal(parcours!.etapes[0].statut, 'fait');
  na.match(bloc, /1\. Terrain — FAIT — AI0001 \+ AI0002 · Ascain/);
  na.equal(parcours!.etapes[1].statut, 'a_faire');
  na.match(parcours!.etapes[1].resume, /devis/);
  // Conversation DVF sans projet : aucun bloc (économie de contexte).
  const vide = base({ mission: null, preparation: null, textesUtilisateur: ['Prix au m² à Ascain ?'], messageCourant: 'Et à Sare ?' });
  na.equal(parcoursPertinent(vide), false);
  na.equal(blocParcoursServeur(vide).bloc, '');
  // Une demande de film suffit à afficher le parcours FILM.
  const film = blocParcoursServeur({ ...vide, messageCourant: 'Je voudrais un film du projet' });
  na.equal(film.parcours?.type, 'film');
  na.match(film.bloc, /# PARCOURS FILM — FAIT FOI/);
});

Deno.test('VIS17-3 : instantané de l’écran (brief projet local) relu défensivement ; la base garde la main', () => {
  const s = sourcesServeur(base({
    instantane: {
      type: 'image', habillage: 'Brique claire · menuiseries anthracite · balcons filants', interieurs: { gamme: 'premium', typologie: 'T3' },
      rendu: { vues: ['aerienne', 'angle_rue'], vuesChoisies: true, ambiance: 'fin_de_journee', saison: null, etudeRattachee: true },
      // Tentative de déclarer un état : ignorée (la base fait foi).
      volume: { pret: false }, travaux: [{ id: 'x' }], apercuValide: APERCU,
    },
  }));
  na.equal(s.habillage.resume, 'Brique claire · menuiseries anthracite · balcons filants');
  na.equal(s.volume.pret, true);
  na.deepEqual(s.travaux, []);
  na.equal(s.apercuValide, null);
  const { parcours, bloc } = blocParcoursServeur(base({ instantane: { type: 'image', habillage: 'Brique claire', interieurs: { gamme: 'premium', typologie: 'T3' }, rendu: { vues: ['aerienne'], vuesChoisies: true, etudeRattachee: true } } }));
  na.deepEqual(parcours!.etapes.map((e) => e.statut).slice(3, 7), ['fait', 'fait', 'fait', 'a_faire']);
  na.match(bloc, /PROCHAINE ÉTAPE : 7\. Aperçu\./);
  // Habillage validé dans le fil (bloc mimmoza-brief) sans instantané : reconnu.
  const fil = sourcesServeur(base({ textesUtilisateur: ['Brief créatif validé\n```mimmoza-brief\n{}\n```'] }));
  na.equal(fil.habillage.resume, 'Habillage choisi dans la conversation.');
});

Deno.test('VIS17-4 : aperçu validé par le message de l’utilisateur (même au tour courant) → rendu final à faire', () => {
  const travaux = [{ id: APERCU, type: 'image', statut: 'termine', options: { vues: ['aerienne'], qualite: 'apercu' }, resultat: { images: [{}] }, cree_le: '2026-11-20T09:00:00Z' }];
  const avant = blocParcoursServeur(base({ travaux }));
  na.equal(avant.parcours!.etapes[6].statut, 'en_cours');
  na.match(avant.bloc, /7\. Aperçu — EN COURS — Aperçu prêt/);
  const apres = blocParcoursServeur(base({ travaux, messageCourant: messageValidationApercu(APERCU, 'image') }));
  na.equal(apres.parcours!.etapes[6].statut, 'fait');
  na.equal(apres.parcours!.etapes[7].statut, 'a_faire');
  na.match(apres.bloc, /8\. Images finales & livraison — À FAIRE/);
});

Deno.test('VIS17-5 : studio_lancer_rendu — `qualite: "apercu"` acceptée (sans livraison), durée de l’aperçu ; sans qualite : inchangé', () => {
  const sans = validerOptionsRendu('image', { vues: ['aerienne'] });
  na.ok(sans.ok); na.deepEqual(sans.ok && sans.valeur, { vues: ['aerienne'] });
  const finale = validerOptionsRendu('image', { vues: ['aerienne'], qualite: 'finale' });
  na.deepEqual(finale.ok && finale.valeur, { vues: ['aerienne'] });
  const ap = validerOptionsRendu('image', { vues: ['aerienne', 'sejour'], qualite: 'apercu', livraison: { active: true } });
  na.ok(ap.ok); na.deepEqual(ap.ok && ap.valeur, { vues: ['aerienne', 'sejour'], qualite: 'apercu' });
  const ko = validerOptionsRendu('image', { qualite: 'brouillon' });
  na.equal(ko.ok, false);
  // VIS-18b : le film a désormais son aperçu (migration 20261120080000) ; une valeur inconnue reste refusée.
  na.equal(validerOptionsRendu('film', { qualite: 'apercu' }).ok, true);
  na.equal(validerOptionsRendu('film', { qualite: 'brouillon' }).ok, false);
  na.equal(dureeAnnoncee('image', { vues: ['aerienne', 'sejour'], qualite: 'apercu' }), 'environ 20 min à 30 min une fois le rendu démarré (aperçu rapide en 1200 px, pour valider le cadrage et l’habillage avant le rendu final)');
  na.match(dureeAnnoncee('image', { vues: ['aerienne'] }), /20 à 60 min par vue/);
  na.match(resumeOptions('image', { vues: ['aerienne'], qualite: 'apercu' }), /aperçu rapide$/);
  // À l'insertion : aucune livraison commerciale ajoutée pour un aperçu.
  na.deepEqual(avecLivraisonParDefaut('image', { vues: ['aerienne'], qualite: 'apercu' }, { actif: true }), { vues: ['aerienne'], qualite: 'apercu' });
  const outil = OUTIL_STUDIO_LANCER_RENDU as unknown as { input_schema: { properties: { options: { description: string } } } };
  na.match(outil.input_schema.properties.options.description, /qualite \('apercu' = APERÇU RAPIDE/);
});
