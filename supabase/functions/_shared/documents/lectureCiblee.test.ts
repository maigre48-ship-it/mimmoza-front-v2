// deno test supabase/functions/_shared/documents/lectureCiblee.test.ts — logique pure, sans réseau.
import * as na from 'node:assert/strict';
import {
  assemblerTexte, chapitresZones, enTetesZones, estimerTokensTexte, normaliserCodeZone, pagesDepuisMessage,
  plagesLisibles, resumeChapitres, selectionnerPages, semblerScanne, zoneDepuisMessage, zonesCandidates,
} from './lectureCiblee.ts';

const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);
const assert = (v: unknown, msg?: string) => na.ok(v, msg);

const corps = (n: number) => `Les constructions doivent respecter les règles suivantes, paragraphe ${n}. `.repeat(12);

/**
 * Règlement fictif de 40 pages, à la manière d'un PLU réel :
 *  p1 couverture, p2 sommaire (cite toutes les zones), p3-6 dispositions générales,
 *  p7-14 zone UA, p15-24 zone UC (avec sous-secteur UCa cité en titre p20),
 *  p25-30 zone 1AU, p31-36 zone N, p37-40 lexique. En-tête courant de page « PLU de Testville – Zone UC ».
 */
function reglement(): string[] {
  const p: string[] = [];
  p.push('PLAN LOCAL D\'URBANISME DE TESTVILLE\nRèglement écrit\nApprouvé le 15 juin 2023');
  p.push('SOMMAIRE\nTITRE I – DISPOSITIONS GÉNÉRALES ........ 3\nCHAPITRE 1 – ZONE UA ........ 7\nCHAPITRE 2 – ZONE UC ........ 15\nCHAPITRE 3 – ZONE 1AU ........ 25\nCHAPITRE 4 – ZONE N ........ 31\nLEXIQUE ........ 37');
  p.push('TITRE I – DISPOSITIONS GÉNÉRALES\n' + corps(3));
  for (let i = 4; i <= 6; i++) p.push(`PLU de Testville – Dispositions générales\n${corps(i)} Les règles de la zone UC ne s'appliquent pas ici.`);
  p.push('TITRE II\nCHAPITRE 1 – DISPOSITIONS APPLICABLES À LA ZONE UA\nArticle UA 1 ' + corps(7));
  for (let i = 8; i <= 14; i++) p.push(`PLU de Testville – Zone UA\nArticle UA ${i - 6}\n${corps(i)} Voir aussi en zone UC.`);
  p.push('CHAPITRE 2 – DISPOSITIONS APPLICABLES À LA ZONE UC\nArticle UC 1 – Occupations interdites\n' + corps(15));
  for (let i = 16; i <= 24; i++) {
    p.push(i === 20
      ? 'PLU de Testville – Zone UC\nDispositions applicables à la zone UCa (secteur)\nArticle UC 10 – Hauteur : 12 m\n' + corps(i)
      : `PLU de Testville – Zone UC\nArticle UC ${i - 14}\n${corps(i)}`);
  }
  p.push('CHAPITRE 3 – DISPOSITIONS APPLICABLES À LA ZONE 1AU\n' + corps(25));
  for (let i = 26; i <= 30; i++) p.push(`PLU de Testville – Zone 1AU\n${corps(i)}`);
  p.push('CHAPITRE 4 – DISPOSITIONS APPLICABLES À LA ZONE N\n' + corps(31));
  for (let i = 32; i <= 36; i++) p.push(`PLU de Testville – Zone N\n${corps(i)}`);
  p.push('LEXIQUE\nAlignement : limite entre le domaine public et la propriété privée. ' + corps(37));
  for (let i = 38; i <= 40; i++) p.push(`Lexique (suite)\n${corps(i)}`);
  return p;
}

Deno.test('codes de zone : normalisation et candidates (zone mère)', () => {
  assertEquals(normaliserCodeZone('Zone Uc'), 'UC');
  assertEquals(normaliserCodeZone(' 1AUh '), '1AUH');
  assertEquals(normaliserCodeZone('Toto'), null);
  assertEquals(normaliserCodeZone(42), null);
  assertEquals(zonesCandidates('UCa'), ['UCA', 'UC']);
  assertEquals(zonesCandidates('UB1'), ['UB1', 'UB']);
  assertEquals(zonesCandidates('1AUh'), ['1AUH', '1AU']);
  assertEquals(zonesCandidates('Ap'), ['AP', 'A']);
  assertEquals(zonesCandidates('UC'), ['UC'], 'jamais UC → U');
  assertEquals(zonesCandidates('n'), ['N']);
});

Deno.test('zone et pages lues dans le message de l\'utilisateur', () => {
  assertEquals(zoneDepuisMessage('Quelle hauteur en zone UCa pour ma parcelle ?'), 'UCA');
  assertEquals(zoneDepuisMessage('quelle hauteur ?'), null);
  assertEquals(pagesDepuisMessage('lis les pages 40 à 43', 300), [40, 41, 42, 43]);
  assertEquals(pagesDepuisMessage('voir p. 12-14 et page 20', 300), [12, 13, 14, 20]);
  assertEquals(pagesDepuisMessage('pages 3, 5 et 9', 300), [3, 5, 9]);
  assertEquals(pagesDepuisMessage('pages 8 à 12', 10), [8, 9, 10], 'borné au document');
  assertEquals(pagesDepuisMessage('aucune page ici', 10), null);
});

Deno.test('en-têtes : le sommaire est ignoré, les mentions dans le corps ne comptent pas', () => {
  const pages = reglement();
  const { entetes, sommaires } = enTetesZones(pages);
  assertEquals(sommaires, [2]);
  assert(!entetes.some((e) => e.page >= 3 && e.page <= 6), 'les dispositions générales citent « zone UC » dans le corps : pas un en-tête');
  assert(entetes.some((e) => e.page === 15 && e.zone === 'UC' && e.force === 'titre'));
  assert(entetes.some((e) => e.page === 18 && e.zone === 'UC' && e.force === 'entete'), 'en-tête courant de page');
});

Deno.test('chapitres : bornes justes, sous-secteur UCa inclus dans UC', () => {
  const ch = chapitresZones(reglement());
  const parZone = Object.fromEntries(ch.map((c) => [c.zone, [c.debut, c.fin]]));
  assertEquals(parZone.UA, [7, 14]);
  assertEquals(parZone.UC, [15, 24], 'UCa (p.20) ne coupe pas le chapitre UC');
  assertEquals(parZone['1AU'], [25, 30]);
  assertEquals(parZone.N, [31, 40]);
  assertEquals(parZone.UCA, [20, 24], 'le sous-secteur a son propre repère');
  assertEquals(resumeChapitres(ch).startsWith('Chapitres de zone repérés : zone UA (p. 7-14)'), true);
});

Deno.test('sélection UC : chapitre + dispositions générales + lexique, sans autre zone', () => {
  const pages = reglement();
  const s = selectionnerPages(pages, 'UC', 1_000_000);
  assertEquals(s.statut, 'zone_trouvee');
  assertEquals(s.zoneRetenue, 'UC');
  assertEquals(s.pagesZone, [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assertEquals(s.pagesDispositionsGenerales, [3, 4, 5, 6]);
  assertEquals(s.pagesLexique, [37, 38, 39, 40]);
  assert(!s.pages.some((p) => p >= 7 && p <= 14), 'aucune page de la zone UA');
  assertEquals(s.tronque, false);
  assertEquals(plagesLisibles(s.pages), '3-6, 15-24, 37-40');
});

Deno.test('sélection d\'un sous-secteur : UCa → chapitre UC (zone mère)', () => {
  const s = selectionnerPages(reglement(), 'UCa', 1_000_000);
  assertEquals(s.statut, 'zone_trouvee');
  assertEquals(s.zone, 'UCA');
  assertEquals(s.zoneRetenue, 'UC', 'la zone mère englobe le sous-secteur');
  assertEquals(s.pagesZone[0], 15, 'les articles communs de UC sont lus');
  assert(s.pagesZone.includes(20));
});

Deno.test('zone absente du règlement ou inconnue : rien d\'inventé', () => {
  const pages = reglement();
  const absente = selectionnerPages(pages, 'UX', 1_000_000);
  assertEquals(absente.statut, 'zone_introuvable');
  assertEquals(absente.pagesZone, []);
  assertEquals(absente.pagesLexique, [], 'pas de lexique sans chapitre');
  const inconnue = selectionnerPages(pages, null, 1_000_000);
  assertEquals(inconnue.statut, 'zone_inconnue');
  assertEquals(inconnue.chapitres.map((c) => c.zone), ['UA', 'UC', 'UCA', '1AU', 'N']);
});

Deno.test('budget : le chapitre de zone passe avant les dispositions générales', () => {
  const pages = reglement();
  const l = (p: number) => pages[p - 1].length + 16;
  let budget = l(3);
  for (let p = 15; p <= 24; p++) budget += l(p);
  const s = selectionnerPages(pages, 'UC', budget);
  assertEquals(s.pagesZone.length, 10);
  assertEquals(s.pagesDispositionsGenerales.length, 1);
  assertEquals(s.tronque, true);
});

Deno.test('assemblage : numéros de page, budget annoncé', () => {
  const pages = ['Alpha  beta', 'Gamma\n\n\n\nDelta', 'Epsilon'];
  assertEquals(assemblerTexte(pages, [1, 2]), '[Page 1]\nAlpha beta\n\n[Page 2]\nGamma\n\nDelta');
  const coupe = assemblerTexte(['x'.repeat(1000)], [1], 400);
  assert(coupe.includes('page 1 coupée'));
  assert(coupe.length < 500);
});

Deno.test('document scanné et estimation de tokens', () => {
  assert(semblerScanne(['', ' ', 'p. 3', '']));
  assert(!semblerScanne(reglement()));
  assert(semblerScanne([]));
  assertEquals(estimerTokensTexte(3000), 1000);
  assertEquals(estimerTokensTexte(-5), 0);
});

Deno.test('titres d\'articles d\'un chapitre (pour demander quoi lire)', async () => {
  const { titresArticles, listeArticles } = await import('./lectureCiblee.ts');
  const pages = ['CHAPITRE 2 – ZONE UC\nArticle UC 1 – Occupations interdites\ntexte', 'Article UC 10 – Hauteur maximale : 12 m\nconformément à l\'article UC 7 ci-dessus', 'ARTICLE UC 12 - Stationnement\nArticle UC 12 - Stationnement (suite)'];
  const t = titresArticles(pages, 1, 3);
  assertEquals(t.map((x) => [x.titre, x.page]), [['Article UC 1 – Occupations interdites', 1], ['Article UC 10 – Hauteur maximale : 12 m', 2], ['ARTICLE UC 12 - Stationnement', 3]]);
  assertEquals(listeArticles(t.slice(1, 2)), 'Article UC 10 – Hauteur maximale : 12 m (p. 2)');
  assertEquals(titresArticles(pages, 1, 3, 1).length, 1);
});
