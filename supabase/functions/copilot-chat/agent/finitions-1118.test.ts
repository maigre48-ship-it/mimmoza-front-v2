// FINITIONS DU 18/11/2026 — accord sur la photo jointe (mode « bouton »), plus grandes dimensions qui passent, intérieur
// du plan lu transmis aux plans, puce « Recevoir les plans » de la maison neuve.
// deno test --no-lock --no-check -A --node-modules-dir=none supabase/functions/copilot-chat/agent/finitions-1118.test.ts
import * as na from 'node:assert/strict';
import {
  ACCORD_PHOTO_JOINTE, accordPhotoDuTexte, appliquerAccordPhoto, CHOIX_ACCORD_PHOTO, demandeAccordPhoto, lignesPhotoProjet,
  lirePhotoProjet, photoProjetUtilisableCommeFond, type PhotoProjet,
} from './photo-projet.ts';
import { dimensionsQuiPassent, DIM_MIN_PROPOSEE_M } from '../../_shared/extension/parcours.ts';
import { existantLuPourFiche, lireInterieurPlanLu, lirePlanLu } from '../../_shared/extension/planLu.ts';

const PHOTO: PhotoProjet = {
  v: 1, chemin: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg', octets: 1000, media_type: 'image/jpeg',
  recue_le: '2026-11-18', nom: 'maison.jpg', position: null, cap_deg: null, depuis_terrain: null, idu: null,
};

Deno.test('FIN-A1 : accord photo — défaut inchangé (implicite), aucune carte ; en mode « bouton », carte jusqu’à la réponse', () => {
  na.equal(ACCORD_PHOTO_JOINTE, 'implicite', 'décision d’Albé en attente : le défaut ne change pas');
  na.equal(demandeAccordPhoto(PHOTO), null);
  na.equal(photoProjetUtilisableCommeFond(PHOTO), true);
  const d = demandeAccordPhoto(PHOTO, 'bouton')!;
  na.deepEqual(d.choix, [CHOIX_ACCORD_PHOTO.oui, CHOIX_ACCORD_PHOTO.non]);
  na.match(d.texte, /visages et les plaques d’immatriculation ne sont pas floutés/);
  na.equal(photoProjetUtilisableCommeFond(PHOTO, 'bouton'), false);
  na.match(lignesPhotoProjet(PHOTO, true, null, 'bouton')[0]!, /qu’avec votre accord/);
  na.match(lignesPhotoProjet(PHOTO, true, null)[0]!, /servira de fond/);
});

Deno.test('FIN-A2 : réponses EXACTES des boutons (apostrophes comprises), mémorisées et relues ; un autre texte ne change rien', () => {
  na.equal(accordPhotoDuTexte("Oui, utiliser ma photo pour l'image"), 'oui');
  na.equal(accordPhotoDuTexte('  Non, ne pas utiliser ma photo. '), 'non');
  na.equal(accordPhotoDuTexte('oui'), null);
  na.equal(accordPhotoDuTexte('Oui, utiliser ma photo pour l’image et faire une extension de 4 × 5 m'), null);
  const oui = appliquerAccordPhoto(PHOTO, CHOIX_ACCORD_PHOTO.oui, '2026-11-18T08:00:00.000Z');
  na.equal(oui.reponse, 'oui');
  na.equal(photoProjetUtilisableCommeFond(oui.photo!, 'bouton'), true);
  na.equal(demandeAccordPhoto(oui.photo, 'bouton'), null, 'plus de carte après la réponse');
  na.equal(lirePhotoProjet(JSON.parse(JSON.stringify(oui.photo)))!.accord_le, '2026-11-18T08:00:00.000Z');
  const non = appliquerAccordPhoto(oui.photo, CHOIX_ACCORD_PHOTO.non, '2026-11-18T08:05:00.000Z');
  na.equal(photoProjetUtilisableCommeFond(non.photo!, 'bouton'), false);
  na.equal(lirePhotoProjet(JSON.parse(JSON.stringify(non.photo)))!.accord_refuse_le, '2026-11-18T08:05:00.000Z');
  na.equal(demandeAccordPhoto(non.photo, 'bouton'), null, 'refus : la carte ne revient pas');
  na.match(non.ligne!, /ne sera pas utilisée/);
  const rien = appliquerAccordPhoto(PHOTO, 'extension de 4 × 5 m', 'x');
  na.equal(rien.photo, PHOTO); na.equal(rien.reponse, null); na.equal(rien.ligne, null);
});

Deno.test('FIN-D1 : plus grandes dimensions qui passent — vérifiées une à une, jamais au-dessus de la demande ni sous 2 m, non dominées', () => {
  // « Moteur » de test : passe si largeur ≤ 3,5 et profondeur ≤ 3 (rectangle libre de 3,5 × 3 m).
  const appels: string[] = [];
  const passe = (l: number, p: number) => { appels.push(`${l}×${p}`); return l <= 3.5 && p <= 3; };
  const r = dimensionsQuiPassent(4, 5, passe);
  na.ok(r.length >= 1 && r.length <= 3);
  for (const d of r) {
    na.ok(passe(d.largeurM, d.profondeurM), 'chaque proposition passe');
    na.ok(d.largeurM <= 4 && d.profondeurM <= 5 && d.largeurM >= DIM_MIN_PROPOSEE_M && d.profondeurM >= DIM_MIN_PROPOSEE_M);
    na.equal((d.largeurM * 2) % 1, 0); na.equal((d.profondeurM * 2) % 1, 0);
  }
  na.deepEqual(r[0], { largeurM: 3.5, profondeurM: 3 }, 'la plus grande surface d’abord');
  for (let i = 0; i < r.length; i += 1) for (let j = 0; j < r.length; j += 1) {
    if (i !== j) na.ok(!(r[j]!.largeurM <= r[i]!.largeurM && r[j]!.profondeurM <= r[i]!.profondeurM), 'aucune proposition dominée');
  }
  na.deepEqual(dimensionsQuiPassent(4, 5, () => false), [], 'rien ne passe : rien n’est proposé');
});

const INTERIEUR = { reference: 'centre-emprise-v1', batiment_id: 'BATIMENT0000000312987650', pieces: [
  { nom: 'Séjour', niveau: 'L0', surface_m2: 28.4, statut: 'lu', anneau: [[-5, -3], [1, -3], [1, 2], [-5, 2]] },
  { nom: 'Cuisine', niveau: 'L0', surface_m2: 12, statut: 'deduit', anneau: [[1, -3], [5, -3], [5, 0], [1, 0]] },
  { nom: 'mauvaise', niveau: 'R+1', surface_m2: 10, statut: 'lu', anneau: [[0, 0], [1, 0], [1, 1]] },
] };

Deno.test('FIN-I1 : intérieur du plan lu — relu du contexte de la page (JSON), gardé dans l’état, transmis à la fiche des plans', () => {
  na.equal(lireInterieurPlanLu(INTERIEUR)!.pieces.length, 2, 'pièce au niveau mal formé écartée');
  na.equal(lireInterieurPlanLu('{pas du json'), null);
  na.equal(lireInterieurPlanLu({ ...INTERIEUR, reference: 'autre' }), null);
  const ctx = {
    plan_lu_v: 1, plan_lu_source: 'import-plan', plan_lu_origine: 'plan.pdf', plan_lu_le: '2026-11-18',
    plan_lu_longueur_m: 11.9, plan_lu_largeur_m: 8, plan_lu_dimensions_statut: 'confirme',
    plan_lu_interieur: JSON.stringify(INTERIEUR),
  };
  const p = lirePlanLu(ctx)!;
  na.equal(p.interieur!.pieces.length, 2);
  const relu = lirePlanLu(JSON.parse(JSON.stringify(p)))!;
  na.deepEqual(relu.interieur, p.interieur, 'forme stockée relue à l’identique');
  const f = existantLuPourFiche(relu, 100);
  na.equal((f.interieur as Record<string, unknown>).batiment_id, 'BATIMENT0000000312987650');
  // Cotes saisies : aucun intérieur.
  na.equal(lirePlanLu({ ...ctx, plan_lu_source: 'saisie' })!.interieur, undefined);
});

Deno.test('FIN-M1 : maison neuve placée → puce « Recevoir les plans de mon projet » (même texte que le serveur)', async () => {
  const { OPTION_PLANS_SEULS_MAISON } = await import('../../_shared/maisonNeuve/parcoursMaison.ts');
  const { DEMANDE_PLANS_SEULS } = await import('./studio.ts');
  na.equal(OPTION_PLANS_SEULS_MAISON, DEMANDE_PLANS_SEULS);
});
