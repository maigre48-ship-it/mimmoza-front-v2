import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cheminPieceJointe, cheminTexte, dossierConversation, estimerLecture, horodatage, modeEnvoi, nomFichierStockage, resumePiece,
  semblerScanne, TAILLE_MAX_PIECE_JOINTE, texteExtraitJson,
} from './piecesJointesLogique.ts';

const Mo = 1024 * 1024;

test('voie d’envoi : PDF par stockage jusqu’à 50 Mo, petites images en base64, grosses images par stockage', () => {
  assert.deepEqual(modeEnvoi({ name: 'plu.pdf', type: 'application/pdf', size: 25 * Mo }), { ok: true, mode: 'stockage' });
  assert.deepEqual(modeEnvoi({ name: 'dpe.pdf', type: 'application/pdf', size: 200_000 }), { ok: true, mode: 'stockage' }, 'même petit, un PDF est conservé');
  assert.equal(modeEnvoi({ name: 'plu.pdf', type: 'application/pdf', size: TAILLE_MAX_PIECE_JOINTE + 1 }).ok, false);
  assert.deepEqual(modeEnvoi({ name: 'a.png', type: 'image/png', size: 2 * Mo }), { ok: true, mode: 'inline' });
  assert.deepEqual(modeEnvoi({ name: 'a.jpg', type: 'image/jpeg', size: 4 * Mo }), { ok: true, mode: 'stockage' });
  const r = modeEnvoi({ name: 'a.jpg', type: 'image/jpeg', size: 6 * Mo });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.erreur : '', /5 Mo/);
  assert.equal(modeEnvoi({ name: 'a.zip', type: 'application/zip', size: 10 }).ok, false);
});

test('chemin : <uid>/<conversation|brouillon>/<horodatage>-<nom sûr>, conforme à la politique du bucket', () => {
  const d = new Date('2026-11-01T09:30:05Z');
  assert.equal(horodatage(d), '20261101-093005');
  assert.equal(nomFichierStockage('Règlement PLU (version 2).PDF', 'application/pdf'), 'reglement-plu-version-2.pdf');
  assert.equal(nomFichierStockage('???', 'image/jpeg'), 'piece-jointe.jpg');
  const conv = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
  assert.equal(dossierConversation(conv, () => 'x'), conv.toLowerCase());
  assert.equal(dossierConversation(null, () => '12345678-1234-4123-8123-123456789abc'), 'brouillon-12345678-1234-4123-8123-123456789abc');
  assert.equal(dossierConversation('pas-un-uuid', () => '12345678-1234-4123-8123-123456789abc'), 'brouillon-12345678-1234-4123-8123-123456789abc');
  const c = cheminPieceJointe('11111111-2222-4333-8444-555555555555', conv.toLowerCase(), 'Règlement PLU.pdf', 'application/pdf', d);
  assert.equal(c, '11111111-2222-4333-8444-555555555555/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/20261101-093005-reglement-plu.pdf');
  // Motif de la politique storage (migration 20261101) et du serveur (validerReference).
  assert.match(c.split('/')[2], /^[0-9]{8}-[0-9]{6}-[a-z0-9._-]{1,120}(\.(png|jpe?g|gif|webp)|\.pdf(\.texte\.json)?)$/);
  assert.match(cheminTexte(c).split('/')[2], /^[0-9]{8}-[0-9]{6}-[a-z0-9._-]{1,120}\.pdf\.texte\.json$/);
  assert.deepEqual(JSON.parse(texteExtraitJson(['a', 'b'])), { version: 1, pages: ['a', 'b'] });
});

test('estimation avant envoi : petit PDF entier, gros règlement plafonné et ciblé, scanné signalé', () => {
  const petit = estimerLecture({ nbPages: 6, caracteres: 18_000, scanne: false }, 'sonnet');
  assert.deepEqual([petit.tokens, petit.lectureCiblee], [18_000, false]);
  const gros = estimerLecture({ nbPages: 240, caracteres: 900_000, scanne: false }, 'sonnet');
  assert.deepEqual([gros.tokens, gros.lectureCiblee], [120_000, true]);
  assert.ok(gros.jetons > petit.jetons);
  assert.ok(estimerLecture({ nbPages: 240, caracteres: 900_000, scanne: false }, 'haiku').jetons < gros.jetons, 'Haiku coûte moins');
  assert.equal(resumePiece({ nbPages: 240, estimation: gros, scanne: false }), `240 p. · lecture ciblée · ≤ ~${gros.jetons} jetons`);
  assert.equal(resumePiece({ nbPages: 3, estimation: null, scanne: true }), '3 p. · scanné');
  assert.ok(semblerScanne(['', ' ', '']));
  assert.ok(!semblerScanne(['Article UC 10 – Hauteur '.repeat(20)]));
});

test('avis affiché après l’événement « documents »', async () => {
  const { avisDocuments } = await import('./piecesJointesLogique.ts');
  assert.equal(avisDocuments({ documents: [], erreurs: [], tokens: 0, jetons_supplementaires: 0 }), null);
  const a = avisDocuments({
    documents: [{ nom: 'PLU.pdf', mode: 'texte_cible', description: '« PLU.pdf » (240 pages) : lecture ciblée de la zone UC', tokens: 38_000, nouvelle: true },
      { nom: 'dpe.pdf', mode: 'pdf_entier', description: '« dpe.pdf » : document entier (6 pages)', tokens: 18_000, nouvelle: false }],
    erreurs: ['« x.pdf » introuvable dans le stockage'], tokens: 56_000, jetons_supplementaires: 6,
  })!;
  assert.match(a, /lecture ciblée de la zone UC ; \(relu\) « dpe\.pdf »/);
  assert.match(a, /non lu : « x\.pdf »/);
  assert.match(a, /environ 6 jetons de plus/);
});

test('V1.8 — plafond unique 50 Mo et avertissement de coût', async () => {
  const { TAILLE_MAX_PIECE_JOINTE: max, AVERTISSEMENT_TAILLE, modeEnvoi: mode } = await import('./piecesJointesLogique.ts');
  assert.equal(max, 50 * Mo);
  assert.deepEqual(mode({ name: 'plu.pdf', type: 'application/pdf', size: 50 * Mo }), { ok: true, mode: 'stockage' });
  const r = mode({ name: 'plu.pdf', type: 'application/pdf', size: 50 * Mo + 1 });
  assert.match(!r.ok ? r.erreur : '', /dépasse 50 Mo/);
  assert.match(AVERTISSEMENT_TAILLE, /plus le document est lourd, plus sa lecture consomme de jetons/i);
});
