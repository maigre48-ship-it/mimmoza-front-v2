// deno test --no-lock --no-check -A supabase/functions/_shared/documents/dispositionsCommunes.test.ts
//
// FIXTURE « EST ENSEMBLE » : STRUCTURE RÉELLE RELEVÉE EN BASE LE 10/11/2026, CORPS DE PAGE ABRÉGÉ.
// Règlement du PLUi Est Ensemble (200057875_reglement_20260223.pdf, 635 pages). Sont RÉELS :
//   · le DÉBUT de chaque page 89 à 95, 110 à 113 (relevé par l'agent principal dans documents_pdf_pages,
//     espaces normalisés), et le début commun des pages 103 à 109 ;
//   · la mention courante « III DISPOSITIONS COMMUNES EN TOUTES ZONES III. », présente sur presque toutes
//     les pages 84 à 116 ;
//   · la phrase « A Montreuil : 0,59 place par logement créé » (p. 89, relevée le 10/11, essai 1 bis) ;
//   · les pages 5 (une ligne), 154, 200, 208, 237, 258, 263 (extraits réels repris du test du lot C5) ;
//   · les longueurs de page utilisées par le test de budget (p. 89 à 95 ; totaux des p. 103-109 et 110-113).
// Ne sont PAS réels, et sont marqués : « […] » = corps de page non relevé ; « [texte non relevé…] » = page
// dont seul le rôle est connu ; « [piège construit] » = page ajoutée pour le test. L'emplacement de la mention
// courante dans la page (ici à la fin) et la répartition des longueurs à l'intérieur des p. 103-109 et
// 111-113 sont SUPPOSÉS. Les retours à la ligne du texte réel ne sont pas connus : la fixture est d'un seul tenant.
//
// FIXTURE « PLU CLASSIQUE » (Testville) : entièrement CONSTRUITE.
import * as na from 'node:assert/strict';
import {
  entreeSommaire, estSommaire, joindreDispositionsCommunes, MAX_CARACTERES_COMMUNES, MAX_PAGES_PAR_THEME, normaliserPourReperage,
  noterPage, partieDeLaPage, porteUneZone, repererDispositionsCommunes, SEUIL_PAGE, termesDuChamp, THEMES_COMMUNS, titreDuTheme,
} from './dispositionsCommunes.ts';
import { assemblerTexte, selectionnerPages } from './lectureCiblee.ts';
import { decouperCodeZone } from './reglementIndices.ts';

const [STAT, SOC, FONC] = THEMES_COMMUNS;
const M = 'III DISPOSITIONS COMMUNES EN TOUTES ZONES III.';
const DEBUT_STAT = 'e. Stationnement 1. Dispositions écrites : Les destinations et sous destinations Au sein des périmètres autour des gares identifiés sur le plan de stationnement';
const DEBUT_FONC = '2. Dispositions graphiques : a. La mixité fonctionnelle Linéaires […] linéaires actifs […] linéaire de commerce […] article L. 151-16 […]';

const P: Record<number, string> = {
  5: 'SOMMAIRE … 1. Fonctionnement général du système d’indices ........ 152',
  84: `[texte non relevé ; contient le mot « stationnement » en passant] ${M}`,
  88: `[texte non relevé] ${M}`,
  89: `89 ${DEBUT_STAT} […] A Montreuil : 0,59 place par logement créé […] ${M}`,
  90: `${DEBUT_STAT} […] ${M}`,
  91: `91 ${DEBUT_STAT} […] ${M}`,
  92: `1. Dispositions écrites : Dispositions générales : En cas de changement de destination d'une construction, les obligations de stationnement doivent être réalisées […] ${M}`,
  93: 'Les systèmes d\'accès mécanisés de type « ascenseur à voiture » sont interdits, sauf : […]',
  94: `Règles concernant les locaux vélos, trottinettes, poussettes, etc. […] ${M}`,
  95: 'Constructions à sous-destination d\'industrie, entrepôt […] Au moins 15 % de l\'effectif […]',
  96: `Accès pour les véhicules motorisés […] ${M}`,
  101: 'III-2. Dispositions graphiques',
  102: 'III-2. Dispositions graphiques',
  103: `103 ${DEBUT_FONC} ${M}`, 104: `${DEBUT_FONC} ${M}`, 105: `105 ${DEBUT_FONC} ${M}`, 106: `${DEBUT_FONC} ${M}`,
  107: `107 ${DEBUT_FONC} ${M}`, 108: `${DEBUT_FONC} ${M}`, 109: `${DEBUT_FONC} ${M}`,
  110: '2. Dispositions graphiques : b. La mixité sociale III DISPOSITIONS COMMUNES EN TOUTES ZONES Périmètres de mixité sociale (voir détail page suivante) Emplacement […]',
  111: `b. La mixité sociale Au sein des périmètres identifiés sur le document graphique (plan des périmètres de mixité sociale), conformément […] ${M}`,
  112: `[…] Dans le cadre d'opérations d'aménagement de type ZAC, les obliga […] ${M}`,
  113: `• Sur les communes des Lilas, de Montreuil, de Pantin et du Pré Saint-Gervais : Les seuils de mixité sociale à respecter au sein des emplacements réservés figurent […] ${M}`,
  114: `[texte non relevé : périmètres d'attente] ${M}`,
  115: `[texte non relevé ; contient le mot « stationnement » en passant] ${M}`,
  116: `[texte non relevé] ${M}`,
  // p. 154 à 263 : extraits RÉELS repris du test du lot C5 (la p. 157, titre du chapitre UC, est construite).
  154: '154 I. Les constructions autorisées ou interdites : 1. Fonctionnement général du système d’indices IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) IV. Nom de la zone à laquelle le secteur appartient Numéro se rapportant : • à la règle d’implantation des constructions par rapport aux voies et emprises publiques Numéro se rapportant : • à la règle d’implantation sur les limites séparatives • à la règle de retrait entre deux constructions sur un même terrain Ces deux règles sont liées. Lettre se rapportant : • à la règle d’emprise au sol • à la règle de pleine terre',
  157: '[page construite : titre du chapitre de la zone UC, p. 157-160 d\'après le relevé du 10/11] DISPOSITIONS APPLICABLES À LA ZONE UC',
  200: '200 a. Implantation des constructions par rapport aux voies et emprises publiques 3. Fiche d’indices : Nom De l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : 9 Il n’est pas fixé de règle. Vue 3D isométrique Règles particulières en zones UC et UM : L’implantation des constructions doit prendre en compte l’implantation des constructions voisines pour s’insérer de manière harmonieuse au sein du tissu existant.',
  208: 'b. Implantation par rapport aux limites séparatives et implantation des constructions les unes par rapport aux autres sur un même terrain 208 3. Fiche d’indices : IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) Nom de l’indice Règle générale d’implantation par rapport aux limites séparatives 0 Sur les limites séparatives ou en retrait. • Retrait minimum si vues : H/2 et 6 mètres 1 Sur les limites séparatives ou en retrait. • Retrait minimum : H/2 et 3 mètres • Distance minimum : H/2 et 6 mètres • Bagnolet • Les Lilas 2 Sur au moins une limite',
  237: '237 c. Emprise au sol des constructions et nature en ville 3. Fiche d’indices : Nom De l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : IV DISPOSITIONS PARTICULIÈRES APPLICABLES AUX ZONES URBAINES (HORS ZONES DE PROJET) IV. J Dans la bande principale d’une profondeur de 18 mètres, l’emprise au sol des constructions est limitée à 80% maximum de la superficie du terrain située dans cette bande. Dans la bande secondaire, l’emprise au sol des constructions est limitée à 20 % maximum de la superficie du terrain située dans cette bande.',
  258: '258 d. Hauteur des constructions 3. Fiche d’indices : Nom de l’indice (les largeurs des bandes principales peuvent varier, se référer au détail des indices pages suivantes) b1 BP : 25 BS : 19 BP : R+7 BS : R+5 b2 BP : 19,5 BS : 13,5 BP : R+5 BS : R+3 b3 BP : 20 BS : 6 BP : R+5 BS : R+1 b4 BP : 7 BS : 3 BP : R+1 BS : R',
  263: '263 d. Hauteur des constructions 3. Fiche d’indices : Nom de l’indice Dispositions qui s’appliquent aux secteurs régis par cet indice : b3 b2 Dans la bande principale d’une profondeur de 18 mètres : • La hauteur des constructions est limitée à 19,5 mètres maximum • Le nombre de niveaux est limité à R+5 maximum. Dans la bande secondaire : • La hauteur des constructions est limitée à 13,5 mètres maximum • Le nombre de niveaux est limité à R+3 maximum.',
  // Pièges construits : une fiche d'indices et une zone de projet qui parlent de stationnement et de logements sociaux.
  265: '[piège construit] 265 d. Hauteur des constructions 3. Fiche d’indices : z1 Les normes de stationnement sont de 1 place par logement, le stationnement des vélos est exigé. Mixité sociale : 30 % de logements sociaux.',
  300: '[piège construit] DISPOSITIONS APPLICABLES À LA ZONE UP\nStationnement\nNormes de stationnement de la zone de projet : 1 place par logement. Le stationnement des vélos est exigé.\nMixité sociale : 40 % de logements locatifs sociaux, mixité sociale renforcée.',
};
const pagesEE = Array.from({ length: 635 }, (_, i) => P[i + 1] ?? '');
/** Chapitres de zone tels que le lot C5 les suppose (UC p. 157-160) ; le premier chapitre réel n'a pas été relevé. */
const CHAPITRES_EE = [{ zone: 'UA', debut: 155, fin: 156 }, { zone: 'UC', debut: 157, fin: 160 }, { zone: 'UP', debut: 300, fin: 379 }];
const LUES_EE = [154, 157, 158, 159, 160, 200, 208, 237, 258, 263];
const OPTS = { chapitres: CHAPITRES_EE, pagesLues: LUES_EE, maxCaracteres: 80_000 };

/** Les mêmes pages, portées à leur LONGUEUR RÉELLE par un remplissage neutre (aucun mot du règlement). */
const LONGUEURS: Record<number, number> = {
  89: 3055, 90: 952, 91: 2465, 92: 3351, 93: 791, 94: 3273, 95: 1258,           // réelles
  103: 1930, 104: 1930, 105: 1930, 106: 1930, 107: 1930, 108: 1930, 109: 1920,  // total réel ≈ 13 500, répartition supposée
  110: 249, 111: 3220, 112: 3220, 113: 3211,                                    // p. 110 réelle ; total réel ≈ 9 900, répartition supposée
};
const pagesEELongues = pagesEE.map((p, i) => {
  const l = LONGUEURS[i + 1];
  return l && p.length < l ? p + ' ·'.repeat(Math.ceil((l - p.length) / 2)).slice(0, l - p.length) : p;
});

Deno.test('normalisation : casse, accents, césure en fin de ligne, césure aplatie, lettres espacées', () => {
  na.equal(normaliserPourReperage('Station-\nnement'), 'stationnement');
  na.equal(normaliserPourReperage('station- nement des véhi-\n cules'), 'stationnement des vehicules');
  na.equal(normaliserPourReperage('S T A T I O N N E M E N T'), 'stationnement');
  na.equal(normaliserPourReperage('MIXITÉ  SOCIALE­'), 'mixite sociale');
  na.equal(normaliserPourReperage('article L.151-15 ; rez-de-chaussée'), 'article l.151-15 ; rez-de-chaussee');   // un trait d'union n'est pas une césure
  na.ok(noterPage('OBLIGATIONS EN MATIÈRE DE STATION-\nNEMENT\nNORMES DE STATIONNEMENT : 1 PLACE PAR LOGEMENT', STAT).note >= SEUIL_PAGE);
});

Deno.test('débuts de page réels : noyaux, suites, pages hors thème', () => {
  // Noyaux du stationnement : p. 89, 90, 91 (titre « e. Stationnement », avec ou sans numéro de page en tête).
  for (const n of [89, 90, 91]) na.ok(noterPage(P[n], STAT).note >= SEUIL_PAGE, `p. ${n}`);
  na.equal(noterPage(P[89], STAT).titre, 'e. Stationnement');
  na.equal(noterPage(P[90], STAT).titre, 'e. Stationnement');
  na.ok(noterPage(P[89], STAT).norme && !noterPage(P[90], STAT).norme);       // seule la p. 89 porte « place par logement »
  // p. 92 à 95 : sous le seuil d'un noyau sur leur seul début, mais dans le champ lexical → pages de suite.
  for (const n of [92, 93, 94, 95]) {
    na.ok(noterPage(P[n], STAT).note < SEUIL_PAGE, `p. ${n} n'est pas un noyau`);
    na.ok(termesDuChamp(P[n], STAT) >= 1, `p. ${n} est une suite`);
  }
  na.equal(termesDuChamp(P[96], STAT), 0);                                    // « Accès pour les véhicules motorisés » : hors thème
  // La mention courante « DISPOSITIONS COMMUNES » ne note AUCUN thème ; un mot en passant non plus.
  for (const n of [84, 88, 115, 116]) for (const d of THEMES_COMMUNS) na.ok(noterPage(P[n], d).note < SEUIL_PAGE, `p. ${n} ${d.theme}`);
  // Mixité sociale : p. 110 et 111 noyaux ; fonctionnelle : p. 103 à 109 ; aucun croisement.
  na.ok(noterPage(P[110], SOC).note >= SEUIL_PAGE && noterPage(P[111], SOC).note >= SEUIL_PAGE);
  na.equal(noterPage(P[110], SOC).titre, 'b. La mixité sociale');
  na.equal(noterPage(P[103], FONC).titre, 'a. La mixité fonctionnelle');
  for (let n = 103; n <= 109; n++) { na.ok(noterPage(P[n], FONC).note >= SEUIL_PAGE, `p. ${n}`); na.equal(noterPage(P[n], SOC).note, 0); }
  for (const n of [110, 111, 112, 113]) na.ok(noterPage(P[n], FONC).note < SEUIL_PAGE, `p. ${n}`);
  na.equal(noterPage(P[89], SOC).note, 0);
  // « places … pour les logements sociaux » : c'est du stationnement, pas une norme de mixité.
  na.ok(!noterPage('Stationnement : 0,5 place par logement pour les logements locatifs sociaux.', SOC).norme);
  na.equal(noterPage('', STAT).note, 0);
});

Deno.test('titres, sommaire, partie de la page', () => {
  na.equal(titreDuTheme('III DISPOSITIONS COMMUNES\n4. Stationnement\nLes obligations…', STAT), '4. Stationnement');
  na.equal(titreDuTheme('ARTICLE UC 12 – OBLIGATIONS EN MATIÈRE DE STATIONNEMENT\ntexte', STAT), 'ARTICLE UC 12 – OBLIGATIONS EN MATIÈRE DE STATIONNEMENT');
  na.equal(titreDuTheme('Les constructions nouvelles doivent prévoir, en dehors des voies publiques, des aires de stationnement,\nsuite', STAT), null);
  na.equal(titreDuTheme('4. Stationnement ........ 86', STAT), null);                 // ligne de sommaire
  // Texte d'un seul tenant : un mot en minuscules dans une phrase n'est pas un titre.
  na.equal(titreDuTheme('Dans les opérations, le stationnement des véhicules est assuré hors des voies.', STAT), null);
  na.equal(titreDuTheme('Stationnement des véhicules : dispositions.', STAT), 'Stationnement');
  na.ok(estSommaire('A ........ 1\nB ........ 2\nC ........ 3\nD ........ 4') && !estSommaire(P[89]));
  const som = ['SOMMAIRE\ne. Stationnement ........ 87\nb. La mixité sociale ........ 108\nLexique ........ 20\nDispositions générales ........ 9'];
  na.deepEqual(entreeSommaire(som, [1], STAT), { titre: 'e. Stationnement', page_annoncee: 87 });
  na.deepEqual(entreeSommaire(som, [1], SOC), { titre: 'b. La mixité sociale', page_annoncee: 108 });
  na.equal(entreeSommaire(som, [1], FONC), null);
  na.equal(partieDeLaPage(P[89]), 'commune');             // mention courante RÉELLE de la partie III
  na.equal(partieDeLaPage(P[110]), 'commune');
  na.equal(partieDeLaPage(P[154]), 'particuliere');       // mention courante RÉELLE de la partie IV
  na.equal(partieDeLaPage(P[93]), null);                  // page sans mention
  na.ok(porteUneZone('ARTICLE UA 12 – STATIONNEMENT') && porteUneZone(P[300]) && !porteUneZone(P[89]));
});

Deno.test('Est Ensemble (structure réelle) : stationnement p. 89-95, mixité sociale p. 110-113, mixité fonctionnelle p. 103-109', () => {
  // Le découpage du lot C5 reste celui du 10/11 sur ces pages.
  na.equal(decouperCodeZone(pagesEE, 'UC91Jb2', ['UA', 'UC', 'UP']).statut, 'decoupe');
  const r = repererDispositionsCommunes(pagesEE, OPTS);
  na.deepEqual(r.themes.map((t) => [t.theme, t.statut, t.plages, t.essentiel]), [
    ['stationnement', 'jointe', '89-95', true],
    ['mixite_sociale', 'jointe', '110-113', true],
    ['mixite_fonctionnelle', 'jointe', '103-109', false],     // la fixture abrégée est courte : tout tient
  ]);
  const [s, m, f] = r.themes;
  na.deepEqual(s.pages, [89, 90, 91, 92, 93, 94, 95]);        // 7 pages : la p. 96 (accès des véhicules) n'en est pas
  na.equal(s.titre, 'e. Stationnement'); na.equal(s.contexte, 'mention_dispositions_communes'); na.equal(s.tronque, false);
  na.deepEqual(s.autres_pages, []);                           // p. 84 et 115 (mot en passant) : ni jointes ni signalées
  na.deepEqual(m.pages, [110, 111, 112, 113]);                // la p. 114 (périmètres d'attente) n'en est pas
  na.equal(m.titre, 'b. La mixité sociale');
  na.deepEqual(f.pages, [103, 104, 105, 106, 107, 108, 109]); // s'arrête au titre « b. La mixité sociale »
  na.deepEqual(r.pages, [89, 90, 91, 92, 93, 94, 95, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113]);
  // Étiquettes et texte : celui du règlement, non réécrit ; ordre stationnement, mixité sociale, mixité fonctionnelle.
  na.ok(r.texte.startsWith('[Dispositions communes du règlement — pages ajoutées par Mimmoza'));
  na.ok(r.texte.includes('[Dispositions communes — stationnement — pages 89 à 95]\n[Page 89]'));
  na.ok(r.texte.includes('[Dispositions communes — mixité sociale — pages 110 à 113]\n[Page 110]'));
  na.ok(r.texte.includes('[Dispositions communes — mixité fonctionnelle — pages 103 à 109]\n[Page 103]'));
  na.ok(r.texte.includes('A Montreuil : 0,59 place par logement créé'));
  na.ok(r.texte.includes(assemblerTexte(pagesEE, [89])));
  na.ok(r.texte.indexOf('[Page 95]') < r.texte.indexOf('— mixité sociale —') && r.texte.indexOf('[Page 113]') < r.texte.indexOf('— mixité fonctionnelle —'));
  for (const n of [5, 84, 88, 96, 114, 115, 265, 300]) na.ok(!r.pages.includes(n), `page ${n}`);
  na.ok(s.message.includes('pages 89 à 95') && s.message.includes('« e. Stationnement »'));
});

Deno.test('Est Ensemble aux longueurs réelles : la mixité sociale n’est jamais évincée par la mixité fonctionnelle', () => {
  const r = repererDispositionsCommunes(pagesEELongues, { ...OPTS, maxCaracteres: 120_000 });
  const [s, m, f] = r.themes;
  // ≈ 15 100 caractères de stationnement + ≈ 9 900 de mixité sociale tiennent sous le plafond de 36 000.
  na.equal(s.statut, 'jointe'); na.deepEqual(s.pages, [89, 90, 91, 92, 93, 94, 95]); na.equal(s.tronque, false);
  na.equal(m.statut, 'jointe'); na.deepEqual(m.pages, [110, 111, 112, 113]); na.equal(m.tronque, false);
  // Les ≈ 13 500 caractères de mixité fonctionnelle ne tiennent plus : signalée avec ses pages, jamais coupée ni jointe à moitié.
  na.equal(f.statut, 'reperee_non_jointe');
  na.deepEqual(f.pages, []); na.deepEqual(f.pages_reperees, [103, 104, 105, 106, 107, 108, 109]);
  na.ok(f.message.includes('pages 103 à 109') && f.message.includes('thème secondaire'));
  na.ok(r.texte.includes('[Dispositions communes — mixité fonctionnelle : repéré pages 103 à 109, NON JOINT'));
  na.ok(!r.texte.includes('[Page 103]'));
  na.equal(r.tronque, true);
  na.ok(r.texte.length <= MAX_CARACTERES_COMMUNES, String(r.texte.length));
  console.log(`  longueurs réelles : bloc ajouté ${r.texte.length} caractères (plafond ${MAX_CARACTERES_COMMUNES})`);

  // Budget serré (15 000 caractères restants) : les deux thèmes essentiels se partagent la place, le social garde sa part.
  const c = repererDispositionsCommunes(pagesEELongues, { ...OPTS, maxCaracteres: 15_000 });
  na.equal(c.themes[1].statut, 'jointe');
  na.ok(c.themes[1].pages.includes(110) && c.themes[1].pages.includes(111));
  na.equal(c.themes[0].statut, 'jointe');
  na.ok(c.themes[0].pages.includes(89));                      // la page de la norme chiffrée d'abord
  na.equal(c.themes[0].tronque, true);
  na.ok(c.themes[0].message.includes("toutes ses pages n'ont pas pu être jointes"));
  na.equal(c.themes[2].statut, 'reperee_non_jointe');
  na.ok(c.texte.length <= 15_000);
  // Thème demandé seul : la mixité fonctionnelle peut être jointe en entier.
  const seul = repererDispositionsCommunes(pagesEELongues, { ...OPTS, themes: ['mixite_fonctionnelle'] });
  na.equal(seul.themes[0].statut, 'jointe'); na.equal(seul.themes[0].plages, '103-109');
});

Deno.test('rien n’est inventé : thème absent → « non trouvé dans le document », dit aussi dans le texte', () => {
  const sansSocial = pagesEE.map((p, i) => ([110, 111, 112, 113].includes(i + 1) ? '' : p));
  const r = repererDispositionsCommunes(sansSocial, OPTS);
  const m = r.themes[1];
  na.equal(m.statut, 'non_trouvee');
  na.deepEqual(m.pages, []); na.equal(m.titre, null); na.equal(m.sommaire, null);
  na.ok(m.message.startsWith('Mixité sociale : non trouvé dans le document'));
  na.ok(m.message.includes("Ce n'est pas une absence de règle"));
  na.ok(r.texte.includes('mixité sociale : NON TROUVÉ dans le document'));
  na.ok(r.texte.includes('Cela ne veut pas dire « non réglementé »'));
  na.equal(r.themes[0].statut, 'jointe');                  // le stationnement reste joint
  na.equal(r.themes[2].statut, 'jointe');                  // la mixité fonctionnelle ne tient pas lieu de mixité sociale
  // Document sans rien : trois « non trouvé », aucune page ; seuls les deux thèmes essentiels sont écrits dans le texte.
  const vide = repererDispositionsCommunes(['Couverture', 'Hauteur : 12 m.'], { chapitres: [], pagesLues: [], maxCaracteres: 50_000 });
  na.deepEqual(vide.themes.map((t) => t.statut), ['non_trouvee', 'non_trouvee', 'non_trouvee']);
  na.deepEqual(vide.pages, []);
  na.ok(!/\[Page \d+\]/.test(vide.texte));
  na.ok(vide.texte.includes('stationnement : NON TROUVÉ') && vide.texte.includes('mixité sociale : NON TROUVÉ') && !vide.texte.includes('fonctionnelle'));
});

Deno.test('les règles d’une AUTRE zone ne sont jamais présentées comme communes', () => {
  // Seules la zone de projet UP (p. 300) et une fiche (p. 265) parlent de stationnement et de logements sociaux.
  const p2 = pagesEE.map((p, i) => (i + 1 >= 84 && i + 1 <= 116 ? '' : p));
  const r = repererDispositionsCommunes(p2, OPTS);
  na.deepEqual(r.themes.map((t) => t.statut), ['non_trouvee', 'non_trouvee', 'non_trouvee']);
  na.deepEqual(r.pages, []);
  // Page orpheline après un chapitre borné à 80 pages (p. 380 > fin du chapitre UP), sans mention de partie : pas commune.
  p2[379] = '[piège construit] Stationnement\nNormes de stationnement : 1 place par logement. Stationnement des vélos exigé.';
  na.equal(repererDispositionsCommunes(p2, OPTS).themes[0].statut, 'non_trouvee');
});

Deno.test('critère « partie commune » : la mention portée par la page prime, la position avant les zones sert de repli', () => {
  // Chapitre de zone repéré à tort dès la p. 20 : les pages 89-95 ne sont plus « avant les zones », la mention suffit.
  const tot = [{ zone: 'UA', debut: 20, fin: 99 }, ...CHAPITRES_EE.slice(1)];
  const r = repererDispositionsCommunes(pagesEE, { ...OPTS, chapitres: tot });
  na.deepEqual(r.themes.map((t) => [t.statut, t.plages, t.contexte]), [
    ['jointe', '89-95', 'mention_dispositions_communes'],     // p. 93 et 95 (sans mention) suivent le passage
    ['jointe', '110-113', 'mention_dispositions_communes'],
    ['jointe', '103-109', 'mention_dispositions_communes'],
  ]);
  // Règlement SANS mention courante : c'est la position avant le premier chapitre de zone qui fait foi.
  const sans = pagesEE.map((p) => p.replaceAll(M, '').replace('III DISPOSITIONS COMMUNES EN TOUTES ZONES ', ''));
  const a = repererDispositionsCommunes(sans, OPTS);
  na.deepEqual(a.themes.map((t) => [t.statut, t.plages, t.contexte]), [
    ['jointe', '89-95', 'avant_les_chapitres_de_zone'],
    ['jointe', '110-113', 'avant_les_chapitres_de_zone'],
    ['jointe', '103-109', 'avant_les_chapitres_de_zone'],
  ]);
  // Ni mention, ni position : on ne devine pas.
  na.deepEqual(repererDispositionsCommunes(sans, { ...OPTS, chapitres: tot }).themes.map((t) => t.statut), ['non_trouvee', 'non_trouvee', 'non_trouvee']);
});

// ── PLU classique (fixture CONSTRUITE) : stationnement dans le chapitre de zone ──────────────────
const remplissage = (n: number) => `Les constructions respectent les prescriptions du présent règlement, alinéa ${n}. `.repeat(10);
function pluClassique(opts: { renvoi?: boolean; mixiteDG?: boolean } = {}): string[] {
  const p: string[] = [];
  p.push(`PLAN LOCAL D'URBANISME DE TESTVILLE\nRèglement écrit\n${remplissage(1)}`);
  p.push('SOMMAIRE\nTITRE I – DISPOSITIONS GÉNÉRALES ........ 3\nCHAPITRE 1 – ZONE UA ........ 5\nCHAPITRE 2 – ZONE UC ........ 9\nCHAPITRE 3 – ZONE N ........ 13');
  p.push(`TITRE I – DISPOSITIONS GÉNÉRALES\n${remplissage(3)}`);
  p.push(opts.mixiteDG
    ? `PLU de Testville – Dispositions générales\nArticle 6 – Mixité sociale\nEn application de l'article L. 151-15 du code de l'urbanisme, tout programme de plus de 12 logements comporte 30 % de logements locatifs sociaux. ${remplissage(4)}`
    : `PLU de Testville – Dispositions générales\n${remplissage(4)}`);
  p.push(`CHAPITRE 1 – DISPOSITIONS APPLICABLES À LA ZONE UA\nArticle UA 1\n${remplissage(5)}`);
  p.push(`PLU de Testville – Zone UA\nARTICLE UA 12 – STATIONNEMENT\nNormes de stationnement : 2 places par logement. Stationnement des vélos : 1 place pour 40 m².\n${remplissage(6)}`);
  p.push(`PLU de Testville – Zone UA\nArticle UA 13\n${remplissage(7)}`);
  p.push(`PLU de Testville – Zone UA\nArticle UA 14\n${remplissage(8)}`);
  p.push(`CHAPITRE 2 – DISPOSITIONS APPLICABLES À LA ZONE UC\nArticle UC 1\n${remplissage(9)}`);
  p.push(`PLU de Testville – Zone UC\nArticle UC 10 – Hauteur : 12 m\n${remplissage(10)}`);
  p.push(opts.renvoi
    ? `PLU de Testville – Zone UC\nARTICLE UC 12 – STATIONNEMENT\nLes normes de stationnement sont fixées par les dispositions générales du présent règlement.\n${remplissage(11)}`
    : `PLU de Testville – Zone UC\nARTICLE UC 12 – STATIONNEMENT\nNormes de stationnement : 1,2 place par logement. Stationnement des vélos : 1 place pour 50 m² de surface de plancher.\n${remplissage(11)}`);
  p.push(`PLU de Testville – Zone UC\nArticle UC 13\n${remplissage(12)}`);
  p.push(`CHAPITRE 3 – DISPOSITIONS APPLICABLES À LA ZONE N\n${remplissage(13)}`);
  return p;
}

Deno.test('PLU classique : stationnement déjà dans le chapitre de zone → rien en double', () => {
  const pages = pluClassique({ mixiteDG: true });
  const sel = selectionnerPages(pages, 'UC', 120_000);
  na.equal(sel.statut, 'zone_trouvee');
  na.deepEqual(sel.pagesZone, [9, 10, 11, 12]);
  na.deepEqual(sel.pagesDispositionsGenerales, [3, 4]);
  const r = repererDispositionsCommunes(pages, { chapitres: sel.chapitres, pagesLues: sel.pages, maxCaracteres: 50_000 });
  na.deepEqual(r.themes.map((t) => [t.theme, t.statut, t.pages]), [
    ['stationnement', 'deja_dans_les_pages_lues', [11]],   // Article UC 12, lu avec le chapitre
    ['mixite_sociale', 'deja_dans_les_pages_lues', [4]],   // dispositions générales, déjà lues
    ['mixite_fonctionnelle', 'non_trouvee', []],           // thème secondaire : dit dans le champ, pas dans le texte
  ]);
  na.equal(r.texte, '');                                   // aucun caractère ajouté
  na.deepEqual(r.pages, []);
  na.equal(r.themes[0].titre, 'ARTICLE UC 12 – STATIONNEMENT');
  na.ok(r.themes[0].message.includes('aucune page ajoutée'));
});

Deno.test('PLU classique sans mixité : stationnement non doublé, mixité sociale « non trouvé » (jamais la zone UA)', () => {
  const pages = pluClassique();
  const sel = selectionnerPages(pages, 'UC', 120_000);
  const r = repererDispositionsCommunes(pages, { chapitres: sel.chapitres, pagesLues: sel.pages, maxCaracteres: 50_000 });
  na.equal(r.themes[0].statut, 'deja_dans_les_pages_lues');
  na.equal(r.themes[1].statut, 'non_trouvee');
  na.deepEqual(r.pages, []);
  na.ok(r.texte.startsWith('[Dispositions communes — mixité sociale : NON TROUVÉ'));
  na.ok(!r.texte.includes('[Page'));
});

Deno.test('PLU classique : l’article de zone renvoie aux dispositions générales sans rien chiffrer → pas « déjà traité »', () => {
  const pages = pluClassique({ renvoi: true });
  const sel = selectionnerPages(pages, 'UC', 120_000);
  const r = repererDispositionsCommunes(pages, { chapitres: sel.chapitres, pagesLues: sel.pages, maxCaracteres: 50_000 });
  // Le renvoi ne chiffre rien, et les dispositions générales de CE règlement ne traitent pas du stationnement :
  // on le dit, et on ne va pas chercher la norme de la zone UA (p. 6).
  na.equal(r.themes[0].statut, 'non_trouvee');
  na.ok(!r.pages.includes(6));
});

Deno.test('plafonds : pages par thème, garde-fou de longueur d’un passage, budgets courts', () => {
  // Passage de 12 pages (p. 89-100) : 8 pages jointes au plus, la première et la norme chiffrée gardées, et c'est dit.
  const long = [...pagesEE];
  for (let n = 96; n <= 100; n++) long[n - 1] = `${DEBUT_STAT} […] ${M}`;
  const s = repererDispositionsCommunes(long, OPTS).themes[0];
  na.deepEqual(s.pages_reperees, [89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  na.equal(s.pages.length, MAX_PAGES_PAR_THEME);
  na.ok(s.pages.includes(89));
  na.equal(s.tronque, true);
  na.ok(s.message.includes('pages 89 à 100') && s.message.includes("toutes ses pages n'ont pas pu être jointes"));

  // Budgets courts : rien ne dépasse, et le repérage reste donné pour redemander les pages.
  for (const max of [0, 200, 900, 2_500, 5_000, 12_000, 30_000]) {
    const c = repererDispositionsCommunes(pagesEELongues, { ...OPTS, maxCaracteres: max });
    na.ok(c.texte.length <= max, `budget ${max} : ${c.texte.length}`);
    for (const t of c.themes) {
      na.ok(t.statut === 'jointe' || t.statut === 'reperee_non_jointe', `${max} ${t.theme} ${t.statut}`);
      na.ok(t.pages_reperees.length > 0);
      if (t.statut === 'reperee_non_jointe') { na.deepEqual(t.pages, []); na.ok(t.message.includes('non jointes')); }
    }
  }
  const zero = repererDispositionsCommunes(pagesEELongues, { ...OPTS, maxCaracteres: 0 });
  na.equal(zero.texte, '');
  na.deepEqual(zero.themes.map((t) => [t.statut, t.pages_reperees[0], t.pages_reperees.length]), [
    ['reperee_non_jointe', 89, 7], ['reperee_non_jointe', 110, 4], ['reperee_non_jointe', 103, 7],
  ]);
});

Deno.test('déterministe, et rapide sur 635 pages denses', () => {
  const dense = pagesEELongues.map((p, i) => p || `Page ${i + 1}. ${remplissage(i).repeat(4)} Les aires de stationnement sont admises.`);
  const a = repererDispositionsCommunes(dense, OPTS);
  const t0 = performance.now();
  const b = repererDispositionsCommunes(dense, OPTS);
  const ms = performance.now() - t0;
  na.deepEqual(a, b);
  na.deepEqual(a.themes.map((t) => t.pages_reperees.length), [7, 4, 7]);
  console.log(`  repérage sur ${dense.length} pages (${Math.round(dense.reduce((s, p) => s + p.length, 0) / 1000)} k caractères) : ${ms.toFixed(0)} ms`);
  na.ok(ms < 1_000, `${ms} ms`);
});

Deno.test('PLU classique dont les dispositions générales lues recouvrent une partie du passage : pas de page en double', () => {
  // Les pages 92 à 95 sont déjà lues avec la zone : seules 89 à 91 sont jointes, et c'est dit.
  const r = repererDispositionsCommunes(pagesEE, { ...OPTS, pagesLues: [...LUES_EE, 92, 93, 94, 95] });
  const s = r.themes[0];
  na.equal(s.statut, 'jointe'); na.deepEqual(s.pages, [89, 90, 91]);
  na.deepEqual(s.pages_reperees, [89, 90, 91, 92, 93, 94, 95]);
  na.equal(s.tronque, false);
  na.ok(s.message.includes('pages 92 à 95 du même passage déjà lue(s) avec la zone'));
  na.ok(!r.texte.includes('[Page 92]'));
  // Tout le passage déjà lu : rien n'est ajouté.
  const tout = repererDispositionsCommunes(pagesEE, { ...OPTS, pagesLues: [...LUES_EE, 110, 111, 112, 113] });
  na.equal(tout.themes[1].statut, 'deja_dans_les_pages_lues');
  na.deepEqual(tout.themes[1].pages, [110, 111, 112, 113]);
  na.ok(!tout.texte.includes('[Page 110]'));
});

// ── Assemblage final (ce que plu-reglement-v1 renvoie) ───────────────────────────────────────────
Deno.test('joindre : le texte de la zone est rendu tel quel en tête, le bloc tient dans le budget total', () => {
  const zone = `[Découpage du code de zone]\n\n${assemblerTexte(pagesEELongues, LUES_EE)}`;
  const j = joindreDispositionsCommunes(pagesEELongues, zone, { chapitres: CHAPITRES_EE, pagesLues: LUES_EE, maxCaracteres: 120_000 });
  na.ok(j.texte.startsWith(zone));
  na.equal(j.texte.slice(0, j.champs.caracteres_texte_zone), zone);              // l'ancien texte se retrouve à l'identique
  na.equal(j.champs.pages_dispositions_communes, '89-95, 110-113');
  na.equal(j.champs.dispositions_communes_tronque, true);                        // la mixité fonctionnelle est repérée, non jointe
  na.deepEqual(j.champs.dispositions_communes.map((t) => [t.theme, t.statut, t.plages]), [
    ['stationnement', 'jointe', '89-95'], ['mixite_sociale', 'jointe', '110-113'], ['mixite_fonctionnelle', 'reperee_non_jointe', ''],
  ]);
  na.ok(j.texte.length <= 120_000);
  // Budget presque épuisé par la zone : rien n'est joint, c'est dit dans les champs, le total ne dépasse pas.
  const serre = joindreDispositionsCommunes(pagesEELongues, zone, { chapitres: CHAPITRES_EE, pagesLues: LUES_EE, maxCaracteres: zone.length + 100 });
  na.equal(serre.texte, zone);
  na.deepEqual(serre.champs.dispositions_communes.map((t) => t.statut), ['reperee_non_jointe', 'reperee_non_jointe', 'reperee_non_jointe']);
  na.equal(serre.champs.dispositions_communes_tronque, true);
  // PLU classique où tout est dans le chapitre : texte strictement identique à celui d'avant le lot.
  const pc = pluClassique({ mixiteDG: true });
  const sel = selectionnerPages(pc, 'UC', 120_000);
  const avant = assemblerTexte(pc, sel.pages, 120_000);
  const c = joindreDispositionsCommunes(pc, avant, { chapitres: sel.chapitres, pagesLues: sel.pages, maxCaracteres: 120_000 });
  na.equal(c.texte, avant);
  na.equal(c.champs.pages_dispositions_communes, '');
});
