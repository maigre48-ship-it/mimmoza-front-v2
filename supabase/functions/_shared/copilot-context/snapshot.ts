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

export function mergeContexts(persisted: unknown, current: unknown): Record<string, JsonValue> {
  const previous = sanitizeContext(persisted);
  const incoming = sanitizeContext(current);
  const merged = mergeObjects(previous, incoming);
  if (Object.prototype.hasOwnProperty.call(incoming, 'route') && !Object.prototype.hasOwnProperty.call(incoming, 'pageContext')) delete merged.pageContext;
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
