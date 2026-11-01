// deno test supabase/functions/copilot-chat/pieces-jointes.test.ts — orchestration avec un dépôt FACTICE (sans réseau).
import * as na from 'node:assert/strict';
import { consigneDocuments, preparerDocumentsDuTour, type DepotPiecesJointes, type LignePieceJointe } from './pieces-jointes.ts';

const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);
const assert = (v: unknown, msg?: string) => na.ok(v, msg);

const UID = '11111111-2222-4333-8444-555555555555';
const CONV = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const P = (nom: string) => `${UID}/${CONV}/20261101-093000-${nom}`;

const page = (s: string) => `${s} ${'Les constructions respectent les règles du présent article. '.repeat(30)}`;
function reglement(): string[] {
  const p = [page('Règlement'), page('TITRE I – DISPOSITIONS GÉNÉRALES')];
  while (p.length < 10) p.push(page('Dispositions générales'));
  p.push(page('CHAPITRE 1 – DISPOSITIONS APPLICABLES À LA ZONE UA'));
  while (p.length < 120) p.push(page('PLU – Zone UA'));
  p.push(page('CHAPITRE 2 – DISPOSITIONS APPLICABLES À LA ZONE UC'));
  while (p.length < 150) p.push(page('PLU – Zone UC'));
  p.push(page('CHAPITRE 3 – DISPOSITIONS APPLICABLES À LA ZONE N'));
  while (p.length < 240) p.push(page('PLU – Zone N'));
  return p;
}

function depotFactice(o: { fichiers: Record<string, number>; textes?: Record<string, unknown>; existantes?: LignePieceJointe[]; messages?: number; compter?: (b: unknown[]) => number | null }) {
  const journal: string[] = [];
  const lignes: LignePieceJointe[] = [];
  const depot: DepotPiecesJointes = {
    metaFichier: async (c) => (c in o.fichiers ? { taille: o.fichiers[c] } : null),
    telechargerJson: async (c) => o.textes?.[c] ?? null,
    urlSignee: async (c) => `https://stockage.test/signe/${encodeURIComponent(c)}?t=1`,
    piecesConversation: async () => o.existantes ?? [],
    enregistrerPiece: async (l) => {
      const ligne: LignePieceJointe = { id: `id-${lignes.length + 1}`, nom: l.nom, media_type: l.media_type, chemin: l.chemin, texte_chemin: l.texte_chemin,
        taille_octets: l.taille_octets, nb_pages: null, tour_ajout: l.tour_ajout, tour_derniere_lecture: l.tour_ajout, tokens_derniere_lecture: null };
      lignes.push(ligne);
      journal.push(`enregistrer ${l.nom} tour ${l.tour_ajout}`);
      return ligne;
    },
    noterLecture: async (id, l) => { journal.push(`lecture ${id} ${l.lecture.mode} ${l.tokens}`); },
    nombreMessagesUtilisateur: async () => o.messages ?? 0,
    compterTokens: async (b) => (o.compter ? o.compter(b) : null),
  };
  return { depot, journal };
}

Deno.test('gros règlement : lecture ciblée de la zone du contexte, comptage exact, consigne de coût', async () => {
  const chemin = P('plu.pdf');
  const { depot, journal } = depotFactice({
    fichiers: { [chemin]: 24_000_000 },
    textes: { [`${chemin}.texte.json`]: { version: 1, pages: reglement() } },
    messages: 2,
    compter: (b) => JSON.stringify(b).length / 4,
  });
  const r = await preparerDocumentsDuTour({
    userId: UID, conversationId: CONV, message: 'Quelle hauteur maximale ?', zone: 'UC', budgetTokens: 120_000, depot,
    refs: [{ mediaType: 'application/pdf', storagePath: chemin, size: 1, name: 'PLU Testville.pdf', textePath: `${chemin}.texte.json` }],
  });
  assertEquals(r.erreurs, []);
  assertEquals(r.documents.length, 1);
  const d = r.documents[0];
  assertEquals(d.plan.mode, 'texte_cible');
  assertEquals(d.tokensExacts, true);
  assert(d.plan.pages.includes(121) && !d.plan.pages.includes(60));
  const bloc = d.blocs[0] as { type: string; source: { type: string; data: string }; title: string };
  assertEquals([bloc.type, bloc.source.type, bloc.title], ['document', 'text', 'PLU Testville.pdf']);
  assert(bloc.source.data.startsWith('[Page 2]'));
  assertEquals(r.nouvelles, [{ nom: 'PLU Testville.pdf', mediaType: 'application/pdf' }]);
  assert(journal[0] === 'enregistrer PLU Testville.pdf tour 3', 'tour = messages déjà en base + 1');
  assert(r.consigne.includes('lecture ciblée de la zone UC'));
  assert(r.consigne.includes('consomme davantage de crédits'));
});

Deno.test('zone inconnue : la zone de la parcelle est cherchée une seule fois, à la demande', async () => {
  const chemin = P('plu.pdf');
  let appels = 0;
  const { depot } = depotFactice({ fichiers: { [chemin]: 24_000_000 }, textes: { [`${chemin}.texte.json`]: { version: 1, pages: reglement() } } });
  const r = await preparerDocumentsDuTour({
    userId: UID, conversationId: CONV, message: 'Résume', zone: null, budgetTokens: 120_000, depot,
    zoneParcelle: async () => { appels++; return 'N'; },
    refs: [{ mediaType: 'application/pdf', storagePath: chemin, size: 1, textePath: `${chemin}.texte.json` }],
  });
  assertEquals(appels, 1);
  assertEquals(r.documents[0].plan.mode, 'texte_cible');
  assertEquals(r.documents[0].plan.zone, 'N');
  assertEquals(r.documents[0].nom, 'plu.pdf', 'nom déduit du chemin');
});

Deno.test('petites pièces : PDF entier et image par URL signée ; pièces refusées listées', async () => {
  const pdf = P('dpe.pdf'), img = P('photo.png');
  const { depot } = depotFactice({
    fichiers: { [pdf]: 800_000, [img]: 4_000_000 },
    textes: { [`${pdf}.texte.json`]: { version: 1, pages: Array(6).fill(page('DPE')) } },
  });
  const r = await preparerDocumentsDuTour({
    userId: UID, conversationId: CONV, message: 'Analyse', zone: null, budgetTokens: 60_000, depot,
    refs: [
      { mediaType: 'application/pdf', storagePath: pdf, size: 800_000, textePath: `${pdf}.texte.json` },
      { mediaType: 'image/png', storagePath: img, size: 4_000_000 },
      { mediaType: 'application/pdf', storagePath: `99999999-2222-4333-8444-555555555555/${CONV}/20261101-093000-x.pdf`, size: 10 },
      { mediaType: 'application/pdf', storagePath: P('absent.pdf'), size: 10 },
    ],
  });
  assertEquals(r.documents.map((d) => d.plan.mode), ['pdf_entier', 'image']);
  assertEquals((r.documents[0].blocs[0] as { source: { type: string } }).source.type, 'url');
  assertEquals((r.documents[1].blocs[0] as { type: string }).type, 'image');
  assertEquals(r.erreurs.length, 2);
  assert(r.erreurs[0].includes("hors du dossier"));
  assert(r.erreurs[1].includes('introuvable'));
  assertEquals(r.documents[0].tokensExacts, false, 'count_tokens indisponible → estimation');
});

Deno.test('taille réelle > plafond : refus même si la taille annoncée était petite', async () => {
  const pdf = P('enorme.pdf');
  const { depot } = depotFactice({ fichiers: { [pdf]: 60 * 1024 * 1024 } });   // > 50 Mo
  const r = await preparerDocumentsDuTour({ userId: UID, conversationId: CONV, message: '', zone: null, budgetTokens: 60_000, depot,
    refs: [{ mediaType: 'application/pdf', storagePath: pdf, size: 1000 }] });
  assertEquals(r.documents, []);
  assert(r.erreurs[0].includes('trop volumineuse'));
});

Deno.test('pièce conservée : re-transmise au tour suivant, puis écartée quand elle n\'est plus pertinente', async () => {
  const chemin = P('plu.pdf');
  const ligne: LignePieceJointe = { id: 'pj-1', nom: 'plu.pdf', media_type: 'application/pdf', chemin, texte_chemin: `${chemin}.texte.json`,
    taille_octets: 24_000_000, nb_pages: 240, tour_ajout: 1, tour_derniere_lecture: 1, tokens_derniere_lecture: 30_000 };
  const textes = { [`${chemin}.texte.json`]: { version: 1, pages: reglement() } };
  const suivant = await preparerDocumentsDuTour({ userId: UID, conversationId: CONV, refs: [], message: 'Et le stationnement ?', zone: 'UC',
    budgetTokens: 120_000, depot: depotFactice({ fichiers: {}, textes, existantes: [ligne], messages: 1 }).depot });
  assertEquals(suivant.documents.map((d) => [d.nom, d.nouvelle, d.plan.mode]), [['plu.pdf', false, 'texte_cible']]);
  assert(suivant.consigne.includes('Re-transmis'));
  const tard = await preparerDocumentsDuTour({ userId: UID, conversationId: CONV, refs: [], message: 'Parlons DVF', zone: 'UC',
    budgetTokens: 120_000, depot: depotFactice({ fichiers: {}, textes, existantes: [ligne], messages: 9 }).depot });
  assertEquals(tard.documents, []);
  assertEquals(tard.consigne, '');
});

Deno.test('sans pièce ni historique : rien, sans requête inutile', async () => {
  const { depot } = depotFactice({ fichiers: {} });
  const r = await preparerDocumentsDuTour({ userId: UID, conversationId: CONV, refs: [], message: 'Bonjour', zone: null, budgetTokens: 60_000, depot });
  assertEquals(r.documents, []);
  assertEquals(consigneDocuments([], []), '');
});
