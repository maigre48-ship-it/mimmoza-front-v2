// src/spaces/copilot/document/documentModele.test.ts — LOT D1 (réponse en document).
// node --test (npm test) : fonctions pures.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  construireDocumentReponse, estReponseDocument, nettoyerTitre, pointsListe, resumeChat, typeDocument,
  RESUME_CHAT_MAX_CARS, titreObjectif,
} from './documentModele.ts';

const PARAGRAPHE = 'Le prix médian des maisons vendues sur la commune ressort à 5 357 €/m², nettement au-dessus de la moyenne tous biens. ';

const REPONSE_ANALYSE = [
  'Le terrain est constructible en R+3. La marge estimée est de **14 %**, à confirmer par un devis.',
  '',
  '## 1. Urbanisme (PLU)',
  '- Zone UC, emprise au sol 50 %.',
  '- Hauteur 15 m à l’égout (art. UC 10-1).',
  '',
  '## 2. Marché',
  PARAGRAPHE.repeat(6),
  '',
  '| Indicateur | Valeur |',
  '|---|---|',
  '| €/m² | 5 300 |',
  '',
  '### Comparables retenus',
  'Deux ventes atypiques écartées.',
  '',
  '## Réserves',
  '- Amiante possible (construction antérieure à 1997).',
  '',
  '## Sources',
  '- DVF 2024',
  '- PLU de la commune',
  '',
  '```mimmoza-choix',
  '{"options":["Lancer le bilan"]}',
  '```',
].join('\n');

test('D1 — une réponse courte reste un message de chat', () => {
  assert.equal(estReponseDocument('Oui, la parcelle est en zone UC.'), false);
  assert.equal(estReponseDocument(''), false);
  assert.equal(estReponseDocument(null), false);
});

test('D1 — une réponse longue ou structurée devient un document', () => {
  assert.equal(estReponseDocument(REPONSE_ANALYSE), true);
  const structuree = `Réponse courte.\n\n## A\n${PARAGRAPHE.repeat(3)}\n\n## B\n${PARAGRAPHE.repeat(3)}`;
  assert.equal(estReponseDocument(structuree), true);
  // Longue mais les blocs techniques ne comptent pas.
  assert.equal(estReponseDocument('Court.\n```mimmoza-choix\n' + 'x'.repeat(3000) + '\n```'), false);
});

test('D1 — conclusion, sections numérotées, réserves et sources en pied', () => {
  const d = construireDocumentReponse({ texte: REPONSE_ANALYSE, question: 'Analyse la parcelle AE0414 à Ascain', createdAt: '2026-11-09T10:00:00Z' });
  assert.equal(d.type, 'Analyse de parcelle');
  assert.equal(d.titre, 'Analyse la parcelle AE0414 à Ascain');
  assert.equal(d.date, '9 novembre 2026');
  assert.match(d.conclusion, /^Le terrain est constructible en R\+3\./);
  assert.deepEqual(d.sections.map((s) => s.titre), ['Urbanisme (PLU)', 'Marché']);
  // Le sous-titre ### reste dans sa section, le tableau aussi.
  assert.match(d.sections[1].markdown, /### Comparables retenus/);
  assert.match(d.sections[1].markdown, /\| €\/m² \| 5 300 \|/);
  assert.match(d.reserves ?? '', /Amiante/);
  assert.match(d.sources ?? '', /DVF 2024/);
  // Les puces cliquables ne sont jamais dans le document.
  assert.doesNotMatch(JSON.stringify(d), /mimmoza-choix/);
});

test('D1 — mots inchangés : chaque ligne de contenu se retrouve telle quelle', () => {
  const d = construireDocumentReponse({ texte: REPONSE_ANALYSE });
  const tout = [d.conclusion, ...d.sections.map((s) => s.markdown), d.reserves, d.sources].join('\n');
  for (const ligne of ['- Hauteur 15 m à l’égout (art. UC 10-1).', 'Deux ventes atypiques écartées.', '- PLU de la commune']) {
    assert.ok(tout.includes(ligne), ligne);
  }
});

test('D1 — section « Ce qu’il faut retenir » utilisée comme conclusion quand rien ne précède', () => {
  const texte = `## Ce qu'il faut retenir\nAchat cohérent au prix affiché.\n\n## Analyse\n${PARAGRAPHE.repeat(5)}`;
  const d = construireDocumentReponse({ texte });
  assert.equal(d.conclusion, 'Achat cohérent au prix affiché.');
  assert.deepEqual(d.sections.map((s) => s.titre), ['Analyse']);
});

test('D1 — titre de niveau 1 repris comme titre du document', () => {
  const d = construireDocumentReponse({ texte: `# Étude de marché — Bayonne\nSynthèse.\n\n## Prix\n${PARAGRAPHE}`, question: 'prix ?' });
  assert.equal(d.titre, 'Étude de marché — Bayonne');
  assert.equal(d.conclusion, 'Synthèse.');
});

test('D1 — un ``` dans un bloc de code ne crée pas de faux titre', () => {
  const d = construireDocumentReponse({ texte: 'Intro.\n\n## Vrai\n```\n## pas un titre\n```\nfin' });
  assert.deepEqual(d.sections.map((s) => s.titre), ['Vrai']);
});

test('D1 — nettoyage des numéros de titres', () => {
  assert.equal(nettoyerTitre('1. Urbanisme'), 'Urbanisme');
  assert.equal(nettoyerTitre('2) Marché :'), 'Marché');
  assert.equal(nettoyerTitre('**Bilan**'), 'Bilan');
  assert.equal(nettoyerTitre('UC 10-1 gabarit'), 'UC 10-1 gabarit');
  assert.equal(nettoyerTitre('R+3 possible'), 'R+3 possible');
});

test('D1 — type de document', () => {
  assert.equal(typeDocument('fais le bilan promoteur', ''), 'Bilan d’opération');
  assert.equal(typeDocument('combien de travaux ?', ''), 'Estimation de travaux');
  assert.equal(typeDocument('bonjour', 'rien'), 'Note d’analyse');
});

test('D1 — résumé du chat : 1 à 3 phrases, borné', () => {
  const d = construireDocumentReponse({ texte: REPONSE_ANALYSE });
  assert.equal(resumeChat(d), 'Le terrain est constructible en R+3. La marge estimée est de **14 %**, à confirmer par un devis.');
  const long = construireDocumentReponse({ texte: `${PARAGRAPHE.repeat(8)}\n\n## A\nx` });
  assert.ok(resumeChat(long).length <= RESUME_CHAT_MAX_CARS);
  // Pas de coupure après « art. ».
  const art = construireDocumentReponse({ texte: 'Recul de 4 m (art. UC 6-1) obligatoire. Deuxième phrase.\n\n## A\nx' });
  assert.equal(resumeChat(art), 'Recul de 4 m (art. UC 6-1) obligatoire. Deuxième phrase.');
});

test('D1 — points d’un objectif de mission', () => {
  assert.deepEqual(pointsListe('- vérifier le gabarit\n- appliquer les hauteurs\n3. calculer les reculs'), ['vérifier le gabarit', 'appliquer les hauteurs', 'calculer les reculs']);
  assert.deepEqual(pointsListe(null), []);
});

test('D1 — titre d’objectif sans la phrase d’annonce « La mission doit : »', () => {
  assert.equal(titreObjectif('Conception de 40 logements sur la parcelle AB0123 (Saint-Cloud, zone UC). La mission doit :'), 'Conception de 40 logements sur la parcelle AB0123 (Saint-Cloud, zone UC).');
  assert.equal(titreObjectif('Points à traiter :'), 'Points à traiter');
  assert.equal(titreObjectif('Prospection foncière à Montreuil'), 'Prospection foncière à Montreuil');
  assert.equal(titreObjectif(null), '');
});
