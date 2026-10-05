import test from 'node:test';
import assert from 'node:assert/strict';
import { anthropicWebTools, citationLinks, isWebToolUnavailable, successfulWebSearches, webResultSummary, WEB_LIMITS } from './webTools.ts';

test('la recherche et la lecture web complètent les outils métier avec des limites', () => {
  const tools = anthropicWebTools(WEB_LIMITS.quick);
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'web_fetch']);
  assert.equal(tools[0].max_uses, 2);
  assert.equal(tools[1].max_content_tokens, 6000);
  assert.deepEqual(anthropicWebTools({ search: 0, fetch: 0 }), []);
});

test('les citations structurées deviennent des liens lisibles et sûrs', () => {
  const text = citationLinks([
    { url: 'https://www.insee.fr/fr/statistiques/123', title: 'Population INSEE' },
    { url: 'https://www.insee.fr/fr/statistiques/123', title: 'Doublon' },
    { url: 'javascript:alert(1)', title: 'Piège' },
  ]);
  assert.match(text, /\[Population INSEE\]\(https:\/\/www.insee.fr\/fr\/statistiques\/123\)/);
  assert.doesNotMatch(text, /javascript|Doublon/);
});

test('un échec de recherche ne compte pas comme recherche facturée', () => {
  assert.equal(successfulWebSearches({ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } }), 0);
  assert.equal(successfulWebSearches({ type: 'web_search_tool_result', content: [] }), 1);
  assert.deepEqual(webResultSummary({ content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } }),
    { status: 'error', sources: [], error: 'unavailable' });
  assert.deepEqual(webResultSummary({ content: [{ type: 'web_search_result', url: 'https://insee.fr/page', title: 'INSEE' }] }),
    { status: 'success', sources: [{ title: 'INSEE', url: 'https://insee.fr/page' }] });
});

test('si la console Anthropic désactive le web, le chat peut reprendre sans cet outil', () => {
  assert.equal(isWebToolUnavailable(400, 'invalid_request_error: web search is not enabled'), true);
  assert.equal(isWebToolUnavailable(500, 'web search unavailable'), false);
  assert.equal(isWebToolUnavailable(400, 'invalid_request_error: invalid model'), false);
});
