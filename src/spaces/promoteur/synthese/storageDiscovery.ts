// src/spaces/promoteur/synthese/storageDiscovery.ts
// SAFE: read-only scan de sessionStorage/localStorage, aucun write.

export type StorageSource = "session" | "local";

export type ModuleFound = {
  status: "EMPTY" | "FOUND" | "UNKNOWN";
  source?: StorageSource;
  key?: string;
  bytes?: number;
  value?: any;        // JSON parsé si possible
  rawText?: string;   // fallback string
  reason?: string;
};

export type SyntheseDiscovered = {
  market: ModuleFound;
  risques: ModuleFound;
  bilan: ModuleFound;
  implantation: ModuleFound;
  terrain3d: ModuleFound;
  // debug
  candidates: Array<{
    source: StorageSource;
    key: string;
    bytes: number;
    parsed: boolean;
    containsParcelId: boolean;
    hints: string[];
  }>;
};

const MAX_PARSE_BYTES = 2_000_000; // 2MB safety
const KEY_HINTS = {
  market: ["marche", "market", "dvf", "prix", "tension", "transactions"],
  risques: ["risque", "risques", "ppr", "radon", "inond", "sismic", "argile", "ernmt"],
  bilan: ["bilan", "cout", "coû", "ca", "marge", "promoteur", "financial"],
  implantation: ["implant", "plan2d", "2d", "sdp", "emprise", "recul", "plu", "conform"],
  terrain3d: ["terrain3d", "3d", "alti", "altitude", "pente", "volume", "grid", "terrassement"],
};

function safeGetAllKeys(
  storage: Storage,
  source: StorageSource
): Array<{ source: StorageSource; key: string; value: string; bytes: number }> {
  const out: Array<{ source: StorageSource; key: string; value: string; bytes: number }> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    const value = storage.getItem(key);
    if (value == null) continue;
    out.push({ source, key, value, bytes: value.length });
  }
  return out;
}

function looksRelevantKey(key: string): boolean {
  const k = key.toLowerCase();
  const allHints = Object.values(KEY_HINTS).flat();
  return allHints.some((h) => k.includes(h));
}

function guessHints(key: string, text: string): string[] {
  const blob = (key + " " + text).toLowerCase();
  const hints: string[] = [];
  for (const [mod, arr] of Object.entries(KEY_HINTS)) {
    if (arr.some((h) => blob.includes(h))) hints.push(mod);
  }
  return Array.from(new Set(hints));
}

function tryParseJSON(text: string): { ok: boolean; value?: any } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function pickBestModuleMatch(
  moduleName: keyof SyntheseDiscovered,
  candidates: Array<{ source: StorageSource; key: string; value: string; bytes: number }>,
  parcelId: string
): ModuleFound {
  const hints = (KEY_HINTS as any)[moduleName] as string[] | undefined;
  if (!hints) return { status: "UNKNOWN", reason: "Module inconnu" };

  const scored = candidates
    .map((c) => {
      const k = c.key.toLowerCase();
      const v = c.value.toLowerCase();
      const scoreKey = hints.reduce((s, h) => s + (k.includes(h) ? 3 : 0), 0);
      const scoreVal = hints.reduce((s, h) => s + (v.includes(h) ? 1 : 0), 0);
      const scoreParcel =
        parcelId && v.includes(parcelId.toLowerCase()) ? 5 : 0;
      const score = scoreKey + scoreVal + scoreParcel;
      return { ...c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "EMPTY", reason: "Aucune clé candidate" };

  const best = scored[0];
  if (best.bytes > MAX_PARSE_BYTES) {
    return {
      status: "FOUND",
      source: best.source,
      key: best.key,
      bytes: best.bytes,
      rawText: best.value.slice(0, 50_000),
      reason: `Valeur volumineuse (> ${MAX_PARSE_BYTES} bytes), parse JSON ignoré`,
    };
  }

  const parsed = tryParseJSON(best.value);
  if (parsed.ok) {
    return {
      status: "FOUND",
      source: best.source,
      key: best.key,
      bytes: best.bytes,
      value: parsed.value,
    };
  }

  return {
    status: "FOUND",
    source: best.source,
    key: best.key,
    bytes: best.bytes,
    rawText: best.value,
    reason: "Non JSON (ou JSON invalide)",
  };
}

export function scanStorages(parcelId: string): SyntheseDiscovered {
  const sessionItems = safeGetAllKeys(sessionStorage, "session");
  const localItems = safeGetAllKeys(localStorage, "local");
  const all = [...sessionItems, ...localItems];

  // On réduit le volume : clés pertinentes ou valeur contenant le parcelId
  const reduced = all.filter(
    (x) =>
      looksRelevantKey(x.key) ||
      (parcelId && x.value.toLowerCase().includes(parcelId.toLowerCase()))
  );

  const candidates = reduced
    .map((x) => {
      const containsParcelId = parcelId
        ? x.value.toLowerCase().includes(parcelId.toLowerCase())
        : false;
      const hints = guessHints(x.key, x.value);
      const parsed = tryParseJSON(x.value).ok;
      return { source: x.source, key: x.key, bytes: x.bytes, parsed, containsParcelId, hints };
    })
    .sort((a, b) => Number(b.containsParcelId) - Number(a.containsParcelId));

  return {
    market: pickBestModuleMatch("market", reduced, parcelId),
    risques: pickBestModuleMatch("risques", reduced, parcelId),
    bilan: pickBestModuleMatch("bilan", reduced, parcelId),
    implantation: pickBestModuleMatch("implantation", reduced, parcelId),
    terrain3d: pickBestModuleMatch("terrain3d", reduced, parcelId),
    candidates,
  };
}
