// deno test -A supabase/functions/copilot-chat/agent/choix.test.ts
// LOT CHOIX-CLIQUABLES (06/11/2026) — consigne de format ```mimmoza-choix et garde-fou « question d'habillage
// écrite par le modèle » (capture du 06/11 : studio_preparer_3d puis question en texte, sans studio_lancer_rendu).
import * as na from 'node:assert/strict';
import { CHOIX_OPTION_LONGUEUR_MAX, CHOIX_OPTIONS_MAX, CHOIX_QUESTIONS_MAX, CONSIGNE_CHOIX, LANGUE_BLOC_CHOIX } from './choix.ts';
import { CONSIGNE_RENDU_STUDIO, doitForcerLancerRendu, renduTypeDemande } from './studio.ts';
import { OUTIL_STUDIO_LANCER_RENDU, OUTIL_STUDIO_PREPARER_3D } from './outils.ts';
import * as front from '../../../../src/spaces/copilot/utils/choixCliquables.ts';

const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

Deno.test('CHOIX-1 : la consigne décrit le bloc, ses bornes (= celles du front) et son exemple est valide pour le front', () => {
  eq([LANGUE_BLOC_CHOIX, CHOIX_QUESTIONS_MAX, CHOIX_OPTIONS_MAX, CHOIX_OPTION_LONGUEUR_MAX],
    [front.LANGUE_BLOC_CHOIX, front.CHOIX_QUESTIONS_MAX, front.CHOIX_OPTIONS_MAX, front.CHOIX_OPTION_LONGUEUR_MAX]);
  ok(CONSIGNE_CHOIX.includes('```mimmoza-choix\n{'), 'exemple de bloc fermé');
  ok(/1 à 6 questions/.test(CONSIGNE_CHOIX) && /2 à 10 options COURTES \(60 caractères au plus/.test(CONSIGNE_CHOIX));
  ok(/jamais de liste « \(1\)… \(2\)… » en ligne/.test(CONSIGNE_CHOIX));
  ok(/tout à la fin, après un éventuel bloc mimmoza-3d/.test(CONSIGNE_CHOIX));
  ok(/« Libellé : option · Libellé : option »/.test(CONSIGNE_CHOIX), 'forme de la réponse composée par le front');
  ok(/l’HABILLAGE d’un rendu Studio .* ne se demande jamais ainsi/.test(CONSIGNE_CHOIX));
  // L'exemple de la consigne, tel que le modèle le recopierait, est lu par le validateur du front.
  const lu = front.lireBlocChoix(`Quel programme ?\n\n${CONSIGNE_CHOIX.slice(CONSIGNE_CHOIX.indexOf('```mimmoza-choix'), CONSIGNE_CHOIX.indexOf('```\n', CONSIGNE_CHOIX.indexOf('```mimmoza-choix') + 5) + 3)}`);
  ok(lu.bloc, 'exemple valide');
  eq(lu.visible, 'Quel programme ?');
  eq(lu.bloc!.questions[0].options, ['Logements', 'Bureaux', 'Mixte']);
});

Deno.test('CHOIX-2 : descriptions d’outils et consigne Studio — la question d’habillage n’est jamais posée par le modèle', () => {
  ok(/ne pose JAMAIS toi-même la question d'habillage/.test(OUTIL_STUDIO_PREPARER_3D.description));
  ok(/appelle studio_lancer_rendu juste après, dans le même tour/.test(OUTIL_STUDIO_PREPARER_3D.description));
  ok(/HABILLAGE : ne pose JAMAIS toi-même la question d'habillage .* ni en texte ni en bloc mimmoza-choix/.test(OUTIL_STUDIO_LANCER_RENDU.description));
  ok(/appelle cet outil sans `brief`, c'est lui qui la pose/.test(OUTIL_STUDIO_LANCER_RENDU.description));
  ok(/ne pose JAMAIS toi-même la question d’habillage/.test(CONSIGNE_RENDU_STUDIO));
  ok(/appelle studio_lancer_rendu dans le même tour \(après studio_preparer_3d/.test(CONSIGNE_RENDU_STUDIO));
});

Deno.test('CHOIX-3 : rendu typé demandé — film, vidéo, visite virtuelle / 360°, image photoréaliste ; négations et faux amis exclus', () => {
  for (const t of ['Prépare la 3D et fais-moi un film', 'je veux une vidéo du projet', 'Une visite virtuelle', 'visite 360 svp',
    'en 360° ce serait top', 'une image photoréaliste de la façade', 'Images photo des deux bâtiments', 'Lance un FILM de nuit']) ok(renduTypeDemande(t), t);
  for (const t of ['Prépare la 3D', 'fais un rendu', 'pas de film pour l’instant, juste la 3D', 'sans vidéo', 'la visite du terrain est prévue mardi',
    'dans une perspective de revente', 'compte rendu de la réunion', 'filmographie', '', 'Ajoute une image du cadastre']) ok(!renduTypeDemande(t), t);
});

Deno.test('CHOIX-4 : garde-fou — tour imposé sur studio_lancer_rendu seulement après une préparation réussie, une fois, sans doublon', () => {
  const base = {
    texteUtilisateur: 'Prépare la 3D de ma conception et fais-moi un film',
    appels: [{ name: 'studio_preparer_3d', status: 'success' }],
    outilDisponible: true, dejaForce: false, briefCarte: false,
  };
  // Cas de la capture du 06/11 : préparation faite, aucun appel au rendu → imposé.
  eq(doitForcerLancerRendu(base), true);
  eq(doitForcerLancerRendu({ ...base, dejaForce: true }), false, 'une seule fois par requête');
  eq(doitForcerLancerRendu({ ...base, appels: [...base.appels, { name: 'studio_lancer_rendu', status: 'success' }] }), false, 'déjà appelé');
  eq(doitForcerLancerRendu({ ...base, appels: [{ name: 'studio_preparer_3d', status: 'error' }] }), false, 'préparation en échec');
  eq(doitForcerLancerRendu({ ...base, appels: [] }), false, 'pas de préparation dans la requête');
  eq(doitForcerLancerRendu({ ...base, outilDisponible: false }), false, 'outil absent du tour');
  eq(doitForcerLancerRendu({ ...base, briefCarte: true }), false, 'brief de carte : sa propre consigne');
  eq(doitForcerLancerRendu({ ...base, texteUtilisateur: 'Prépare la 3D' }), false, 'aucun rendu demandé');
  eq(doitForcerLancerRendu({ ...base, texteUtilisateur: 'Fais un rendu' }), false, 'type non précisé : le modèle peut le demander');
});
