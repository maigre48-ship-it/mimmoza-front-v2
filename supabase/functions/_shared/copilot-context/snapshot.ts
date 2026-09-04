export const CONTEXT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const CONTEXT_SNAPSHOT_LIMITS = { maxDepth: 12, maxArrayItems: 200, maxObjectKeys: 300, maxStringLength: 16_000, maxSerializedBytes: 96_000 } as const;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface ContextSnapshot {
  schema_version: typeof CONTEXT_SNAPSHOT_SCHEMA_VERSION;
  captured_at: string;
  context: Record<string, JsonValue>;
  context_hash: string;
}

const BLOCKED_KEYS = /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|attachments?|file|files)$/i;
const LONG_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  return /^data:[^;,]+;base64,/i.test(value) || (compact.length > 512 && compact.length % 4 === 0 && LONG_BASE64.test(compact));
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return looksLikeBase64(value) ? undefined : value.slice(0, CONTEXT_SNAPSHOT_LIMITS.maxStringLength);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || depth >= CONTEXT_SNAPSHOT_LIMITS.maxDepth || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, CONTEXT_SNAPSHOT_LIMITS.maxArrayItems)
      .map((item) => sanitizeValue(item, depth + 1, seen)).filter((item): item is JsonValue => item !== undefined);
    seen.delete(value);
    return result;
  }
  const result: Record<string, JsonValue> = {};
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !BLOCKED_KEYS.test(key))
    .sort(([a], [b]) => a.localeCompare(b)).slice(0, CONTEXT_SNAPSHOT_LIMITS.maxObjectKeys);
  for (const [key, item] of entries) {
    const sanitized = sanitizeValue(item, depth + 1, seen);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  seen.delete(value);
  return result;
}

function stableStringify(value: JsonValue | Record<string, JsonValue>): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sanitizeContext(value: unknown): Record<string, JsonValue> {
  const sanitized = sanitizeValue(value, 0, new WeakSet());
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') return {};
  let result = sanitized as Record<string, JsonValue>;
  while (new TextEncoder().encode(stableStringify(result)).length > CONTEXT_SNAPSHOT_LIMITS.maxSerializedBytes) {
    const keys = Object.keys(result);
    if (!keys.length) break;
    const next = { ...result };
    delete next[keys[keys.length - 1]];
    result = next;
  }
  return result;
}

function mergeObjects(persisted: Record<string, JsonValue>, current: Record<string, JsonValue>): Record<string, JsonValue> {
  const merged = { ...persisted };
  for (const [key, value] of Object.entries(current)) {
    const old = merged[key];
    merged[key] = old && value && !Array.isArray(old) && !Array.isArray(value) && typeof old === 'object' && typeof value === 'object'
      ? mergeObjects(old as Record<string, JsonValue>, value as Record<string, JsonValue>) : value;
  }
  return merged;
}

/**
 * Champs ATTACHÉS À UN BIEN PRÉCIS, purgés dès que le client annonce une
 * nouvelle route sans les fournir.
 *
 * Le problème corrigé : seul `pageContext` était purgé au changement de route.
 * `parcel`, `activeDeal`, `risk_study`, `pageSnapshot`, `implantation_2d`,
 * `predictive_snapshot` et `valuation_engine` ne sont envoyés par le front que
 * lorsqu'ils existent (spread conditionnel côté client) : leur absence n'était
 * donc jamais interprétée comme « il n'y en a plus », et la fusion les
 * reconduisait indéfiniment. Un « autour de mon projet » posé vingt messages
 * plus tard pouvait porter sur une parcelle abandonnée depuis longtemps — sans
 * qu'aucun écran ne le signale.
 *
 * `study` et `promoteur_chain` ne sont PAS dans cette liste : ils décrivent
 * l'opération promoteur active, qui survit légitimement à un changement de
 * page à l'intérieur de la chaîne d'études.
 */
const CHAMPS_LIES_AU_BIEN = [
  'parcel',
  'activeDeal',
  'risk_study',
  'pageSnapshot',
  'implantation_2d',
  'predictive_snapshot',
  'valuation_engine',
  'listing_id',
  'listing_url',
] as const;

export function mergeContexts(persisted: unknown, current: unknown): Record<string, JsonValue> {
  const previous = sanitizeContext(persisted);
  const incoming = sanitizeContext(current);
  const merged = mergeObjects(previous, incoming);

  const aRoute = Object.prototype.hasOwnProperty.call(incoming, 'route');
  const has = (o: Record<string, JsonValue>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

  if (aRoute) {
    if (!has(incoming, 'pageContext')) delete merged.pageContext;

    // Le client vient de décrire où il se trouve. Tout ce qui décrit un BIEN et
    // qu'il n'a pas redonné n'est plus d'actualité : on ne le reconduit pas.
    const routeChangee = previous.route !== incoming.route;
    if (routeChangee) {
      for (const champ of CHAMPS_LIES_AU_BIEN) {
        if (!has(incoming, champ)) delete merged[champ];
      }
    }
  }

  return sanitizeContext(merged);
}

export async function createContextSnapshot(context: unknown, capturedAt = new Date().toISOString()): Promise<ContextSnapshot> {
  const sanitized = sanitizeContext(context);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(sanitized)));
  return {
    schema_version: CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    captured_at: capturedAt,
    context: sanitized,
    context_hash: Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}
