import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCopilotResponsePrintHtml, markdownToSafeHtml } from './exportCopilotPdf.ts';

test('produit du HTML structuré sans réintroduire de HTML utilisateur', () => {
  const html = markdownToSafeHtml([
    '## Section',
    '<script>alert(1)</script>',
    '> Avertissement',
    '| Source | Valeur |',
    '| --- | --- |',
    '| IGN | 42 |',
    '[Source sûre](https://example.com/data)',
    '[Lien refusé](javascript:alert(1))',
  ].join('\n'));

  assert.match(html, /<h2/);
  assert.match(html, /<blockquote/);
  assert.match(html, /<table/);
  assert.match(html, /href="https:\/\/example\.com\/data"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test('le rapport imprimable possède un titre et un pied final non superposé', () => {
  const html = buildCopilotResponsePrintHtml({
    response: { role: 'assistant', text: '## Résultat\n\n| A | B |\n|---|---|\n| 1 | 2 |' },
    question: 'Quelle analyse ?',
  }, { generatedAt: '21 août 2026' });

  assert.match(html, /<title>Rapport MimmozIA — Analyse immobilière<\/title>/);
  assert.match(html, /<footer class="report-end">/);
  assert.match(html, /\.report-end\{position:static/);
  assert.doesNotMatch(html, /position:fixed/);
  assert.doesNotMatch(html, /about:blank/);
});
