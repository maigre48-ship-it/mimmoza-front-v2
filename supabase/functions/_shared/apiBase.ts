// supabase/functions/_shared/apiBase.ts
// ─────────────────────────────────────────────────────────────────────────────
// Accès service_role minimal (PostgREST + appels de fonctions internes) pour la
// passerelle API, SANS dépendance réseau à l'import (fetch natif) : les tests
// injectent un `fetch` simulé.
//
// Aucun journal ne contient de clé, d'en-tête, de corps de requête ni de
// réponse : seulement des noms de RPC / de fonctions et des statuts HTTP.
// ─────────────────────────────────────────────────────────────────────────────

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Lit la première valeur d'un dictionnaire JSON de clés (SUPABASE_SECRET_KEYS). */
export function lirePremiereCleJson(brut: string | undefined | null): string | null {
  if (!brut) return null;
  try {
    const p = JSON.parse(brut);
    if (typeof p === "string") return p;
    if (p && typeof p === "object") {
      const v = Object.values(p).find((x) => typeof x === "string");
      return typeof v === "string" ? v : null;
    }
  } catch {
    return brut;
  }
  return null;
}

/**
 * Clé service_role. Même ordre que etude-parcelle-v1 / loyers-reference-v1 :
 * le projet est passé aux JWT Signing Keys, SUPABASE_SECRET_KEYS d'abord
 * (la clé héritée a déjà provoqué des 401 entre fonctions).
 */
export function cleServiceDepuisEnv(env: (k: string) => string | undefined): string {
  return lirePremiereCleJson(env("SUPABASE_SECRET_KEYS")) ??
    env("SUPABASE_SERVICE_ROLE_KEY") ??
    env("SERVICE_ROLE_KEY") ??
    "";
}

export interface ResultatRpc<T = unknown> {
  data: T | null;
  /** Message court, sans donnée sensible. null si succès. */
  error: string | null;
}

export interface ClientBase {
  rpc<T = unknown>(nom: string, args: Record<string, unknown>, delaiMs?: number): Promise<ResultatRpc<T>>;
  /** SELECT sur une table, filtres d'égalité uniquement. */
  selectionner<T = unknown>(table: string, colonnes: string, egalites: Record<string, string>, limite?: number): Promise<ResultatRpc<T[]>>;
}

export function creerClientBase(o: { url: string; cle: string; fetch?: Fetch }): ClientBase {
  const f = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, "");
  const entetes = {
    apikey: o.cle,
    Authorization: `Bearer ${o.cle}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  return {
    async rpc<T>(nom: string, args: Record<string, unknown>, delaiMs = 8000): Promise<ResultatRpc<T>> {
      try {
        const r = await f(`${base}/rest/v1/rpc/${encodeURIComponent(nom)}`, {
          method: "POST",
          headers: entetes,
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(delaiMs),
        });
        const texte = await r.text();
        if (!r.ok) return { data: null, error: `rpc ${nom} HTTP ${r.status}` };
        return { data: texte ? JSON.parse(texte) as T : null, error: null };
      } catch (e) {
        return { data: null, error: `rpc ${nom} ${e instanceof Error ? e.name : "erreur"}` };
      }
    },
    async selectionner<T>(table: string, colonnes: string, egalites: Record<string, string>, limite = 1): Promise<ResultatRpc<T[]>> {
      const q = new URLSearchParams({ select: colonnes, limit: String(limite) });
      for (const [k, v] of Object.entries(egalites)) q.set(k, `eq.${v}`);
      try {
        const r = await f(`${base}/rest/v1/${encodeURIComponent(table)}?${q.toString()}`, {
          method: "GET",
          headers: entetes,
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) {
          await r.body?.cancel();
          return { data: null, error: `select ${table} HTTP ${r.status}` };
        }
        return { data: await r.json() as T[], error: null };
      } catch (e) {
        return { data: null, error: `select ${table} ${e instanceof Error ? e.name : "erreur"}` };
      }
    },
  };
}

// ── Appel d'une fonction Edge interne ──────────────────────────────────────

export interface ReponseInterne {
  /** true si HTTP 2xx ET corps JSON lisible. */
  ok: boolean;
  status: number;
  // deno-lint-ignore no-explicit-any
  json: any;
  /** Cause d'échec technique (jamais le corps). */
  cause?: "http" | "delai" | "exception" | "json";
}

export type AppelInterne = (fonction: string, corps: Record<string, unknown>, delaiMs: number) => Promise<ReponseInterne>;

export function creerAppelInterne(o: { url: string; cle: string; fetch?: Fetch }): AppelInterne {
  const f = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, "");
  return async (fonction, corps, delaiMs) => {
    try {
      const r = await f(`${base}/functions/v1/${fonction}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: o.cle,
          Authorization: `Bearer ${o.cle}`,
        },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(delaiMs),
      });
      let json: unknown = null;
      const texte = await r.text();
      try {
        json = texte ? JSON.parse(texte) : null;
      } catch {
        return { ok: false, status: r.status, json: null, cause: "json" };
      }
      if (!r.ok) return { ok: false, status: r.status, json, cause: "http" };
      return { ok: true, status: r.status, json };
    } catch (e) {
      const delai = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, status: 0, json: null, cause: delai ? "delai" : "exception" };
    }
  };
}
