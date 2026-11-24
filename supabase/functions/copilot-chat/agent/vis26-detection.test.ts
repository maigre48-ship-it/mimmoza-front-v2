// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis26-detection.test.ts
// VIS-26 lot D — Mimmo appelle-t-il l'outil du dessin ? Détection du TOUR (index.ts) sur des formulations réelles :
// « dessine-moi… », « je veux une maison comme ça » + photo, « ajoute / décale / un étage de plus ». Une phrase
// reconnue impose l'outil au tour (consigne + outil dans la liste) ; une phrase non reconnue laisse le modèle libre.
import * as na from 'node:assert/strict';
import { intentionDessinModele, intentionRetoucheModele, nouveauDessinDemande } from './dessin-batiment.ts';
import { dessinPlutotQuExtension } from './description-batiment.ts';
import { detecterIntentionExtension } from './extension.ts';

/** [phrase, photo jointe] — dessiner un bâtiment (texte ou photo). */
const DESSINS: readonly [string, boolean][] = [
  ['Dessine-moi une maison contemporaine avec un toit plat', false],
  ['dessine moi une longère bretonne en pierre', false],
  ['Je veux une maison comme ça', true],
  ['je voudrais une maison dans ce style', true],
  ['Tu peux me dessiner une petite maison avec un garage ?', false],
  ['Fais-moi un chalet savoyard en 3D', false],
  ['Une maison qui ressemble à celle-ci, c’est possible ?', true],
  ['Peux-tu reproduire ce bâtiment ?', true],
  ['Crée-moi une maison basque R+1 avec colombages rouges et volets verts', false],
  ['Esquisse un petit immeuble de 3 étages en brique', false],
  ['Imagine une villa avec un toit-terrasse et une grande baie vitrée', false],
  ['j’aimerais un bâtiment comme sur la photo', true],
  ['dessine un phare avec la maison du gardien', false],
  ['Modélise-moi une chapelle romane', false],
  ['je veux la même maison que sur l’image mais avec un étage', true],
];
/** Retouches du dernier dessin. */
const RETOUCHES: readonly string[] = [
  'ajoute une lucarne côté rue',
  'décale le garage de 2 m vers la gauche',
  'un étage de plus',
  'mets le toit en ardoise',
  'rajoute un balcon au premier',
  'enlève la véranda',
  'plus haut d’un niveau',
  'fais la façade en bois',
  'le garage plus large de 1 m',
  'un niveau de moins sur l’aile',
  'remplace les volets par des volets roulants',
  'déplace la porte d’entrée au centre',
  'la tourelle plus haute',
  'toiture en zinc plutôt',
  'retire la cheminée',
];
const PAS_DESSIN: readonly [string, boolean][] = [
  ['quel est le PLU de cette parcelle ?', false],
  ['dessine-moi le graphique du bilan', false],
  ['Je veux une maison à Nanterre, quel budget faut-il ?', false],
  ['lance le rendu', false],
  ['merci, c’est parfait', false],
];
const PAS_RETOUCHE: readonly string[] = ['merci, c’est parfait', 'ajoute une extension à ma maison', 'lance les images', 'combien ça coûte ?'];

Deno.test('dessin : 15 formulations réelles → outil studio_dessiner_batiment imposé au tour', () => {
  const rates = DESSINS.filter(([t, p]) => !intentionDessinModele(t, p));
  na.deepEqual(rates, [], `non reconnues : ${rates.map(([t]) => t).join(' | ')}`);
});

Deno.test('retouche : 15 formulations réelles → outil studio_retoucher_batiment imposé au tour', () => {
  const rates = RETOUCHES.filter((t) => !intentionRetoucheModele(t));
  na.deepEqual(rates, [], `non reconnues : ${rates.join(' | ')}`);
  na.ok(RETOUCHES.every((t) => !nouveauDessinDemande(t)), 'aucune retouche prise pour un nouveau dessin');
});

Deno.test('rien n’est imposé hors dessin ; une extension de maison EXISTANTE garde son parcours', () => {
  const faux = PAS_DESSIN.filter(([t, p]) => intentionDessinModele(t, p));
  na.deepEqual(faux, [], `reconnues à tort : ${faux.map(([t]) => t).join(' | ')}`);
  const fauxR = PAS_RETOUCHE.filter((t) => intentionRetoucheModele(t));
  na.deepEqual(fauxR, [], `retouches à tort : ${fauxR.join(' | ')}`);
  na.ok(nouveauDessinDemande('dessine-moi plutôt un autre bâtiment'));
  // « agrandir ma maison de 20 m² » : parcours d'extension, jamais un dessin.
  na.ok(!dessinPlutotQuExtension('je veux agrandir ma maison de 20 m² avec une véranda', false));
  na.ok(detecterIntentionExtension('je veux agrandir ma maison de 20 m² avec une véranda').extension);
});
