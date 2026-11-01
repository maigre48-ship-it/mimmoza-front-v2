// deno test supabase/functions/_shared/documents/piecesJointes.test.ts — logique pure, sans réseau.
import * as na from 'node:assert/strict';
import {
  cheminTexte, estReferenceStockage, jetonsSupplementairesDocuments, lireTexteExtrait, marqueurPieces,
  piecesARetransmettre, planifierLecture, TAILLE_MAX_PIECE_JOINTE, validerReference, type PieceConservee,
} from './piecesJointes.ts';

const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);
const assert = (v: unknown, msg?: string) => na.ok(v, msg);

const UID = '11111111-2222-4333-8444-555555555555';
const CONV = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const chemin = `${UID}/${CONV}/20261101-093000-reglement-plu.pdf`;

Deno.test('référence : le chemin doit être dans le dossier de l\'utilisateur', () => {
  const ok = validerReference({ mediaType: 'application/pdf', storagePath: chemin, size: 12_000_000, name: 'Règlement PLU.pdf', textePath: cheminTexte(chemin) }, UID);
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.dossier, `${UID}/${CONV}`);
    assertEquals(ok.ref.textePath, `${chemin}.texte.json`);
  }
  const brouillon = validerReference({ mediaType: 'image/png', storagePath: `${UID}/brouillon-${CONV}/20261101-093000-photo.png`, size: 4_000_000 }, UID);
  assert(brouillon.ok, 'dossier brouillon accepté (conversation pas encore créée)');

  const autre = '99999999-2222-4333-8444-555555555555';
  assertEquals(validerReference({ mediaType: 'application/pdf', storagePath: chemin, size: 10 }, autre),
    { ok: false, erreur: "pièce jointe hors du dossier de l'utilisateur" });
  for (const p of [`${UID}/${CONV}/../x.pdf`, `/${chemin}`, `${UID}\\${CONV}\\20261101-093000-a.pdf`, `${UID}/20261101-093000-a.pdf`,
    `${UID}/${CONV}/sous/20261101-093000-a.pdf`, `${UID}/${CONV}/20261101-093000-A.PDF`]) {
    assertEquals(validerReference({ mediaType: 'application/pdf', storagePath: p, size: 10 }, UID).ok, false, p);
  }
});

Deno.test('référence : type, extension, taille et texte extrait', () => {
  assertEquals(validerReference({ mediaType: 'application/zip', storagePath: chemin, size: 10 }, UID).ok, false);
  assertEquals(validerReference({ mediaType: 'image/png', storagePath: chemin, size: 10 }, UID).ok, false, 'extension .pdf pour une image');
  assertEquals(TAILLE_MAX_PIECE_JOINTE, 50 * 1024 * 1024, '50 Mo : maximum de Supabase Storage (plan Free)');
  assert(validerReference({ mediaType: 'application/pdf', storagePath: chemin, size: 50 * 1024 * 1024 }, UID).ok, '50 Mo pile acceptés');
  assertEquals(validerReference({ mediaType: 'application/pdf', storagePath: chemin, size: TAILLE_MAX_PIECE_JOINTE + 1 }, UID).ok, false);
  assertEquals(validerReference({ mediaType: 'application/pdf', storagePath: chemin, size: 0 }, UID).ok, false);
  assertEquals(validerReference({ mediaType: 'image/png', storagePath: `${UID}/${CONV}/20261101-093000-a.png`, size: 6 * 1024 * 1024 }, UID).ok, false, 'image > 5 Mo');
  assertEquals(validerReference({ mediaType: 'application/pdf', storagePath: chemin, size: 10, textePath: `${UID}/${CONV}/autre.texte.json` }, UID).ok, false);
  assert(estReferenceStockage({ storagePath: 'x' }));
  assert(!estReferenceStockage({ data: 'AAAA', mediaType: 'image/png' }));
});

Deno.test('texte extrait : forme stricte', () => {
  assertEquals(lireTexteExtrait({ version: 1, pages: ['a', 'b'] }), ['a', 'b']);
  assertEquals(lireTexteExtrait({ version: 2, pages: ['a'] }), null);
  assertEquals(lireTexteExtrait({ version: 1, pages: [1] }), null);
  assertEquals(lireTexteExtrait({ version: 1, pages: [] }), null);
  assertEquals(lireTexteExtrait(null), null);
  assertEquals(lireTexteExtrait({ version: 1, pages: ['x'.repeat(70_000)] })![0].length, 60_000);
});

const page = (s: string) => `${s} ${'Les constructions respectent les règles du présent article. '.repeat(30)}`;
function gros(nb: number): string[] {
  const p = [page('Règlement'), page('TITRE I – DISPOSITIONS GÉNÉRALES')];
  while (p.length < 10) p.push(page('Dispositions générales'));
  p.push(page('CHAPITRE 1 – DISPOSITIONS APPLICABLES À LA ZONE UA'));
  while (p.length < 60) p.push(page('PLU – Zone UA'));
  p.push(page('CHAPITRE 2 – DISPOSITIONS APPLICABLES À LA ZONE UC'));
  while (p.length < 90) p.push(page('PLU – Zone UC'));
  p.push(page('CHAPITRE 3 – DISPOSITIONS APPLICABLES À LA ZONE N'));
  while (p.length < nb) p.push(page('PLU – Zone N'));
  return p;
}

Deno.test('plan : image, petit PDF entier, texte intégral', () => {
  assertEquals(planifierLecture({ mediaType: 'image/png', taille: 10, nom: 'a.png', pages: null, zone: null, message: '', budgetTokens: 60_000 }).mode, 'image');
  const petit = planifierLecture({ mediaType: 'application/pdf', taille: 900_000, nom: 'dpe.pdf', pages: Array(8).fill(page('DPE')), zone: null, message: '', budgetTokens: 60_000 });
  assertEquals(petit.mode, 'pdf_entier');
  assertEquals(petit.tokensEstimes, 24_000);
  const moyen = planifierLecture({ mediaType: 'application/pdf', taille: 5_000_000, nom: 'rapport.pdf', pages: Array(40).fill(page('Rapport')), zone: null, message: '', budgetTokens: 60_000 });
  assertEquals(moyen.mode, 'texte_integral');
  assertEquals(moyen.pages.length, 40);
  assert(moyen.texte!.startsWith('[Page 1]'));
});

Deno.test('plan : gros règlement → lecture ciblée de la zone, ou sommaire si zone inconnue', () => {
  const pages = gros(200);
  const cible = planifierLecture({ mediaType: 'application/pdf', taille: 22_000_000, nom: 'PLU.pdf', pages, zone: 'UC', message: 'hauteur max ?', budgetTokens: 60_000 });
  assertEquals(cible.mode, 'texte_cible');
  assertEquals(cible.zone, 'UC');
  assert(cible.pages.includes(61) && cible.pages.includes(90) && !cible.pages.includes(91) && !cible.pages.includes(30));
  assert(cible.description.includes('lecture ciblée de la zone UC'));
  assert(cible.tokensEstimes <= 60_000);

  const zoneMsg = planifierLecture({ mediaType: 'application/pdf', taille: 22_000_000, nom: 'PLU.pdf', pages, zone: null, message: 'et en zone N ?', budgetTokens: 60_000 });
  assertEquals(zoneMsg.mode, 'sommaire', 'la zone du message est passée par l’appelant, pas devinée ici');

  const sommaire = planifierLecture({ mediaType: 'application/pdf', taille: 22_000_000, nom: 'PLU.pdf', pages, zone: null, message: 'résume', budgetTokens: 60_000 });
  assertEquals(sommaire.mode, 'sommaire');
  assert(sommaire.texte!.includes('zone UC (p. 61-90)'));
  assert(sommaire.tokensEstimes < 5000);
});

Deno.test('plan : pages demandées, PDF scanné, refus motivé', () => {
  const pages = gros(200);
  const dem = planifierLecture({ mediaType: 'application/pdf', taille: 22_000_000, nom: 'PLU.pdf', pages, zone: 'UC', message: 'lis les pages 12 à 14', budgetTokens: 60_000 });
  assertEquals(dem.mode, 'pages_demandees');
  assertEquals(dem.pages, [12, 13, 14]);

  const scanne = Array(60).fill('');
  assertEquals(planifierLecture({ mediaType: 'application/pdf', taille: 9_000_000, nom: 's.pdf', pages: scanne, zone: 'UC', message: '', budgetTokens: 200_000 }).mode, 'pdf_entier');
  const refus = planifierLecture({ mediaType: 'application/pdf', taille: 25_000_000, nom: 's.pdf', pages: Array(300).fill(''), zone: 'UC', message: '', budgetTokens: 200_000 });
  assertEquals(refus.mode, 'refus');
  assert(refus.description.includes('scanné'));
  assertEquals(planifierLecture({ mediaType: 'application/pdf', taille: 2_000_000, nom: 'x.pdf', pages: null, zone: null, message: '', budgetTokens: 60_000 }).mode, 'pdf_entier', 'ancien comportement ≤ 3 Mo');
  assertEquals(planifierLecture({ mediaType: 'application/pdf', taille: 20_000_000, nom: 'x.pdf', pages: null, zone: null, message: '', budgetTokens: 60_000 }).mode, 'refus');
});

Deno.test('pièces conservées : récentes ou citées, dans le budget', () => {
  const p = (id: string, nom: string, tour: number, tokens: number): PieceConservee =>
    ({ id, nom, media_type: 'application/pdf', tour_ajout: tour, tour_derniere_lecture: tour, tokens_derniere_lecture: tokens });
  const pieces = [p('a', 'reglement-plu.pdf', 1, 30_000), p('b', 'dpe-maison.pdf', 6, 10_000), p('c', 'photo.png', 7, 1600)];
  const r = piecesARetransmettre(pieces, { tour: 8, message: 'et la hauteur ?', budgetTokens: 100_000 });
  assertEquals(r.retenues.map((x) => x.id), ['c', 'b']);
  assertEquals(r.ecartees.map((x) => [x.piece.id, x.raison]), [['a', 'ancienne']]);
  const citee = piecesARetransmettre(pieces, { tour: 8, message: 'Reviens au REGLEMENT-PLU stp', budgetTokens: 100_000 });
  assert(citee.retenues.some((x) => x.id === 'a'));
  const budget = piecesARetransmettre(pieces, { tour: 8, message: 'reglement-plu', budgetTokens: 12_000 });
  assertEquals(budget.retenues.map((x) => x.id), ['c', 'b']);
  assert(budget.ecartees.some((x) => x.piece.id === 'a' && x.raison === 'budget'));
});

Deno.test('réservation : supplément couvrant la lecture, sans double minimum', () => {
  // Barème sonnet de copilot-chat : 3 $/M en entrée × 0,95 × marge 3 / 0,10 € par jeton.
  const debit = (t: number) => Math.max(1, Math.ceil(((t * 3) / 1e6) * 0.95 * 3 / 0.10));
  assertEquals(jetonsSupplementairesDocuments(0, debit), 0);
  assertEquals(jetonsSupplementairesDocuments(30_000, debit), debit(60_000) - 1);
  assertEquals(jetonsSupplementairesDocuments(30_000, debit, 1), debit(30_000) - 1);
  assert(jetonsSupplementairesDocuments(100_000, debit) > jetonsSupplementairesDocuments(30_000, debit));
});

Deno.test('marqueur : texte historique inchangé sans pièce conservée', () => {
  assertEquals(marqueurPieces([]), '');
  assertEquals(marqueurPieces([{ nom: 'dpe.pdf', mediaType: 'application/pdf', conservee: false }]),
    "\n\n[PIÈCES JOINTES À CE MESSAGE : dpe.pdf (PDF). Le contenu de ces fichiers a été lu à ce tour-là UNIQUEMENT. " +
    "Il n'est PAS conservé dans l'historique : aux tours suivants, tu ne disposes plus du document.]");
  const m = marqueurPieces([{ nom: 'plu [v2].pdf', mediaType: 'application/pdf', conservee: true }, { mediaType: 'image/png', conservee: false }]);
  assert(m.includes('plu v2.pdf (PDF, conservée), image n°2 (non conservée)'));
  assert(/^\n\n\[PIÈCES JOINTES À CE MESSAGE :[^\]]*\]$/.test(m), 'un seul crochet fermant : la regex de retrait du tour courant reste valable');
});

Deno.test('V1.8 — demander quoi lire : zone inconnue, chapitre trop long, pages imposées', () => {
  // Chapitre UC (borné à 80 pages, p. 11-90) : trop long pour 30 000 tokens → on DEMANDE (aucune coupe à l'aveugle).
  const pg = (t: string) => `${t}\n${'Les constructions respectent les règles du présent article. '.repeat(30)}`;
  const p = [pg('Règlement'), pg('TITRE I – DISPOSITIONS GÉNÉRALES')];
  while (p.length < 10) p.push(pg('Dispositions générales'));
  p.push(pg('CHAPITRE 1 – DISPOSITIONS APPLICABLES À LA ZONE UC\nArticle UC 1 – Occupations interdites'));
  while (p.length < 130) p.push(pg(`PLU – Zone UC${p.length === 60 ? '\nArticle UC 10 – Hauteur maximale' : ''}`));
  p.push(pg('CHAPITRE 2 – DISPOSITIONS APPLICABLES À LA ZONE N'));
  const long = planifierLecture({ mediaType: 'application/pdf', taille: 30_000_000, nom: 'PLU.pdf', pages: p, zone: 'UC', message: 'hauteur ?', budgetTokens: 30_000 });
  assertEquals(long.mode, 'sommaire');
  assert(long.question!.includes('pages 11 à 90'), long.question);
  assert(long.question!.includes('Article UC 10 – Hauteur maximale (p. 61)'));
  assert(long.description.includes('dépasse'));
  const inconnue = planifierLecture({ mediaType: 'application/pdf', taille: 30_000_000, nom: 'PLU.pdf', pages: p, zone: null, message: '', budgetTokens: 60_000 });
  assert(inconnue.question!.startsWith('Quelle est la zone de votre parcelle'));
  assert(inconnue.question!.includes('zone UC (p. 11-90)'), inconnue.question);
  const choisies = planifierLecture({ mediaType: 'application/pdf', taille: 30_000_000, nom: 'PLU.pdf', pages: p, zone: 'UC', message: '', budgetTokens: 60_000, pagesDemandees: [61, 62, 999] });
  assertEquals([choisies.mode, choisies.pages], ['pages_demandees', [61, 62]]);
});
