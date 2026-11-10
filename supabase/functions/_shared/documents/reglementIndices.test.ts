// deno test --no-check supabase/functions/_shared/documents/reglementIndices.test.ts
// Extraits RÉELS du règlement du PLUi Est Ensemble (200057875_reglement_20260223.pdf, 635 pages), tels
// qu'extraits par Mimmoza le 10/11/2026 (texte aplati). Les pages 258 et 263 sont recomposées :
// en-tête de page de la fiche « hauteur » (celui de la p. 260) + passage réel de la page.
import * as na from 'node:assert/strict';
import { decouperCodeZone, enteteDecoupage, familleDeLaPage, indicePresent, pagesFiches, pagesLegendeIndices } from './reglementIndices.ts';

const P: Record<number, string> = {
  5: 'SOMMAIRE … 1. Fonctionnement général du système d’indices ........ 152',
  154: '154 I. Les constructions autorisées ou interdites : 1. Fonctionnement général du système d’indices IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) IV. Nom de la zone à laquelle le secteur appartient Numéro se rapportant : • à la règle d’implantation des constructions par rapport aux voies et emprises publiques Numéro se rapportant : • à la règle d’implantation sur les limites séparatives • à la règle de retrait entre deux constructions sur un même terrain Ces deux règles sont liées. Lettre se rapportant : • à la règle d’emprise au sol • à la règle de pleine terre',
  200: '200 a. Implantation des constructions par rapport aux voies et emprises publiques 3. Fiche d’indices : Nom De l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : 9 Il n’est pas fixé de règle. Vue 3D isométrique Règles particulières en zones UC et UM : L’implantation des constructions doit prendre en compte l’implantation des constructions voisines pour s’insérer de manière harmonieuse au sein du tissu existant.',
  208: 'b. Implantation par rapport aux limites séparatives et implantation des constructions les unes par rapport aux autres sur un même terrain 208 3. Fiche d’indices : IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) Nom de l’indice Règle générale d’implantation par rapport aux limites séparatives Règle générale d’implantation des constructions les unes par rapport aux autres sur un même terrain Communes ayant de dispositions spécifiques 0 Sur les limites séparatives ou en retrait. • Retrait minimum si vues : H/2 et 6 mètres • Retrait minimum si absence de vues : H/4 et 3 mètres • Distance minimum si vues : H/2 et 8 mètres • Distance minimum si absence de vues : H/4 et 6 mètres • Bondy • Les Lilas • Pantin 1 Sur les limites séparatives ou en retrait. • Retrait minimum : H/2 et 3 mètres • Distance minimum : H/2 et 6 mètres • Bagnolet • Les Lilas 2 Sur au moins une limite',
  231: '231 c. Emprise au sol des constructions et nature en ville 3. Fiche d’indices : L’emprise au sol des constructions est limitée à 80% maximum de la superficie du terrain. Emprise au sol des constructions : • Une part de 15% minimum de la superficie du terrain doit être traitée en espace de pleine terre. • En plus de la règle ci-dessus, une part de 20% minimum de la superficie du terrain doit être traitée en coefficient de biotope. A Nom De l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : Nature en ville : B L’emprise au sol des constructions est limitée à 70% maximum de la superficie du terrain.',
  237: '237 c. Emprise au sol des constructions et nature en ville 3. Fiche d’indices : Nom De l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) IV. J Dans la bande principale d’une profondeur de 18 mètres, l’emprise au sol des constructions est limitée à 80% maximum de la superficie du terrain située dans cette bande. Dans la bande secondaire, l’emprise au sol des constructions est limitée à 20 % maximum de la superficie du terrain située dans cette bande.',
  258: '258 d. Hauteur des constructions 3. Fiche d’indices : Nom de l’indice (les largeurs des bandes principales peuvent varier, se référer au détail des indices pages suivantes) b1 BP : 25 BS : 19 BP : R+7 BS : R+5 b2 BP : 19,5 BS : 13,5 BP : R+5 BS : R+3 b3 BP : 20 BS : 6 BP : R+5 BS : R+1 b4 BP : 7 BS : 3 BP : R+1 BS : R',
  260: '260 d. Hauteur des constructions 3. Fiche d’indices : Nom de l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : • La hauteur des constructions est limitée à 13 mètres maximum ; • Le nombre de niveaux est limité à R+3 maximum. 13 IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) • La hauteur des constructions est limitée à 13,5 mètres maximum ; • Le nombre de niveaux est limité à R+3 maximum. Sur la commune de Montreuil',
  263: '263 d. Hauteur des constructions 3. Fiche d’indices : Nom de l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : b3 b2 Dans la bande principale d’une profondeur de 18 mètres : • La hauteur des constructions est limitée à 19,5 mètres maximum • Le nombre de niveaux est limité à R+5 maximum. Dans la bande secondaire : • La hauteur des constructions est limitée à 13,5 mètres maximum • Le nombre de niveaux est limité à R+3 maximum.',
};
const pages = Array.from({ length: 270 }, (_, i) => P[i + 1] ?? '');
const ZONES = ['UA', 'UC', 'UM', 'UR', 'UH'];

Deno.test('familles et légende reconnues sur les pages réelles', () => {
  na.equal(familleDeLaPage(P[200]), 'voies');
  na.equal(familleDeLaPage(P[208]), 'limites');     // l'en-tête ne parle pas de « voies »
  na.equal(familleDeLaPage(P[237]), 'emprise');
  na.equal(familleDeLaPage(P[263]), 'hauteur');
  na.equal(familleDeLaPage(P[154]), null);           // la légende n'est pas une fiche
  na.deepEqual(pagesFiches(pages), { voies: [200], limites: [208], emprise: [231, 237], hauteur: [258, 260, 263] });
  na.deepEqual(pagesLegendeIndices(pages), [154]);   // le sommaire (p. 5) n'est pas une légende
});

Deno.test('indicePresent : nom d’indice isolé, sensible à la casse', () => {
  na.ok(indicePresent(P[200], '9'));
  na.ok(indicePresent(P[208], '1') && indicePresent(P[208], '0'));
  na.ok(indicePresent(P[237], 'J'));
  na.ok(indicePresent(P[231], 'B') && !indicePresent(P[231], 'b'));   // « B » (emprise) n'est pas « b »
  na.ok(indicePresent(P[258], 'b2') && indicePresent(P[263], 'b2'));
  na.ok(!indicePresent(P[237], '18'));               // « 18 mètres » n'est pas un nom d'indice
  na.ok(!indicePresent(P[263], '2'));                // « b2 » ne vaut pas « 2 »
  na.ok(!indicePresent(P[200], ''));
});

Deno.test('cas réel du 10/11 : UC91Jb2 = UC · 9 · 1 · J · b2, et rien d’autre', () => {
  const d = decouperCodeZone(pages, 'UC91Jb2', ZONES);
  na.equal(d.statut, 'decoupe');
  na.equal(d.zoneMere, 'UC');
  na.equal(d.suffixe, '91Jb2');
  na.deepEqual(d.indices!.map((x) => [x.famille, x.indice, x.pages]), [
    ['voies', '9', [200]], ['limites', '1', [208]], ['emprise', 'J', [237]], ['hauteur', 'b2', [258, 263]],
  ]);
  na.deepEqual(d.pages, [154, 200, 208, 237, 258, 263]);   // la p. 231 (indice B, 70 %) n'est PAS lue
});

Deno.test('la lecture fausse du 10/11 (emprise « b », hauteur « 2 ») ne peut plus être produite', () => {
  // « b » n'est pas un indice d'emprise (la fiche connaît « B »), « 2 » n'est pas un indice de hauteur ici.
  na.ok(!pagesFiches(pages).emprise.some((n) => indicePresent(pages[n - 1], 'b')));
  na.ok(!pagesFiches(pages).hauteur.some((n) => indicePresent(pages[n - 1], '2')));
});

Deno.test('on ne tranche pas : code sans indice, zone mère inconnue, découpage non attesté', () => {
  na.equal(decouperCodeZone(pages, 'UC', ZONES).statut, 'non_decoupe');           // pas de suffixe
  na.equal(decouperCodeZone(pages, 'UZ91Jb2', ZONES).statut, 'non_decoupe');      // zone mère inconnue
  na.equal(decouperCodeZone(pages, 'UC91Kb2', ZONES).statut, 'non_decoupe');      // « K » absent des fiches d'emprise
  na.equal(decouperCodeZone(pages, 'UC91JB2', ZONES).statut, 'non_decoupe');      // casse perdue : « B2 » n'existe pas
  na.equal(decouperCodeZone(pages, null, ZONES).statut, 'sans_indices');
  na.equal(decouperCodeZone(['Article UC 10 – Hauteur maximale', 'Article UC 9'], 'UCa', ['UC']).statut, 'sans_indices');
});

Deno.test('ambigu : deux découpages attestés → aucun n’est retenu', () => {
  const p2 = [...pages];
  // On ajoute une fiche « voies » définissant l'indice « 91 » et une fiche « limites » définissant « J » :
  // « 91 · J · b · 2 » ne tient pas (pas de « b » en emprise), donc toujours un seul découpage…
  p2[190] = '191 a. Implantation des constructions par rapport aux voies et emprises publiques 3. Fiche d’indices : 91 Implantation à l’alignement.';
  na.equal(decouperCodeZone(p2, 'UC91Jb2', ZONES).statut, 'decoupe');
  // …mais « 99 · 9 · … » : avec un indice « 99 » ET « 9 » en voies, et « 9 » en limites, UC991Jb2 admet 99·1 et 9·91 ? Non : on force un vrai doublon.
  const p3 = [...pages];
  p3[190] = '191 a. Implantation des constructions par rapport aux voies et emprises publiques 3. Fiche d’indices : 91 Implantation à l’alignement.';
  p3[209] = '210 b. Implantation par rapport aux limites séparatives 3. Fiche d’indices : J Sur les limites séparatives.';
  p3[240] = '241 c. Emprise au sol des constructions et nature en ville 3. Fiche d’indices : b L’emprise est limitée à 50 %.';
  p3[265] = '266 d. Hauteur des constructions 3. Fiche d’indices : 2 La hauteur est limitée à 9 mètres.';
  const d = decouperCodeZone(p3, 'UC91Jb2', ZONES);                               // 9·1·J·b2 et 91·J·b·2
  na.equal(d.statut, 'ambigu');
  na.ok(d.motif.includes('9·1·J·b2') && d.motif.includes('91·J·b·2'));
  na.equal(d.indices, undefined);
});

Deno.test('en-tête : nomme chaque indice, ses pages, et écarte les autres indices', () => {
  const e = enteteDecoupage(decouperCodeZone(pages, 'UC91Jb2', ZONES));
  for (const mot of ['« UC91Jb2 »', 'zone UC', 'indice « 9 » (fiche p. 200)', 'indice « J » (fiche p. 237)', 'indice « b2 » (fiche p. 258, 263)', "ne s'appliquent PAS", 'indice J, p. 237']) {
    na.ok(e.includes(mot), mot);
  }
  na.equal(enteteDecoupage(decouperCodeZone(pages, 'UC', ZONES)), '');
});
