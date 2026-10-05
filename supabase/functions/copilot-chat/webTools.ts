// Outils serveur Anthropic : les outils métier Mimmoza restent des outils client.
export type WebToolBudget = { search: number; fetch: number };
export const WEB_LIMITS = {
  quick: { search: 2, fetch: 1 },
  advanced: { search: 3, fetch: 2 },
  report: { search: 5, fetch: 3 },
} as const;

export function anthropicWebTools(budget: WebToolBudget): Record<string, unknown>[] {
  const tools: Record<string, unknown>[] = [];
  if (budget.search > 0) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: budget.search });
  if (budget.fetch > 0) tools.push({ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: budget.fetch,
    max_content_tokens: 6000, citations: { enabled: true } });
  return tools;
}

type Citation = { type?: string; url?: string; title?: string };
const safeUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  try { const url = new URL(raw); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null; }
  catch { return null; }
};

/** Ajout au flux texte : les citations structurées Anthropic ne doivent pas se perdre au streaming. */
export function citationLinks(citations: unknown): string {
  if (!Array.isArray(citations)) return '';
  const seen = new Set<string>();
  const links: string[] = [];
  for (const item of citations as Citation[]) {
    const url = safeUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = (typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : new URL(url).hostname)
      .replace(/[\[\]<>\n\r]/g, '').slice(0, 90);
    links.push(`[${title}](${url.replace(/[()]/g, (part) => encodeURIComponent(part))})`);
  }
  return links.length ? ` (Sources : ${links.join(' · ')})` : '';
}

export function successfulWebSearches(block: { type?: unknown; content?: unknown }): number {
  if (block.type !== 'web_search_tool_result') return 0;
  const content = block.content;
  return content && !Array.isArray(content) && typeof content === 'object'
    && (content as { type?: string }).type === 'web_search_tool_result_error' ? 0 : 1;
}

export function webResultSummary(block: Record<string, unknown>): { status: 'success' | 'error'; sources: { title: string; url: string }[]; error?: string } {
  const content = block.content;
  if (content && !Array.isArray(content) && typeof content === 'object'
    && typeof (content as { error_code?: unknown }).error_code === 'string') {
    return { status: 'error', sources: [], error: (content as { error_code: string }).error_code };
  }
  const sources = Array.isArray(content) ? content : content && typeof content === 'object' ? [content] : [];
  return { status: 'success', sources: sources.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as { title?: unknown; url?: unknown };
    const url = safeUrl(source.url);
    return url ? [{ title: typeof source.title === 'string' ? source.title.slice(0, 120) : new URL(url).hostname, url }] : [];
  }).slice(0, 5) };
}

export function isWebToolUnavailable(status: number, message: string): boolean {
  return status === 400 && /web[_ -]?(search|fetch)/i.test(message)
    && /(not enabled|disabled|not supported|unsupported|not available|invalid_request_error)/i.test(message);
}
