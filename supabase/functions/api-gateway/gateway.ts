// supabase/functions/api-gateway/gateway.ts
// ─────────────────────────────────────────────────────────────────────────────
// Passerelle de l'API publique Mimmoza — logique complète, dépendances injectées
// (base de données, appels internes) pour être testée sans réseau.
//
// Ordre de traitement d'une requête :
//   1. OPTIONS → 204 (CORS) ; route inconnue → 404 ; méthode → 405 ;
//   2. GET /health → 200, sans clé ni crédit ;
//   3. Content-Type application/json (415), corps ≤ 32 Ko (413), JSON objet (400) ;
//   4. clé API : format puis empreinte (401 / 503) ;
//   5. validation stricte du corps → 400 AVANT toute réservation ;
//   6. réservation atomique api_reserver_credits (402 / 403 / 429 / 401 / 503) ;
//   7. cache (api_cache) puis appel(s) interne(s) borné(s) dans le temps ;
//   8. échec (HTTP ≥ 400, exception, délai, statut métier « error ») →
//      api_rembourser_credits, réponse d'erreur générique ;
//   9. increment_api_usage(p_cost = 0) pour le journal.
//
// Journaux : identifiant de requête, endpoint, codes. JAMAIS de corps, de clé,
// d'en-tête d'authentification ni de réponse.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppelInterne, ClientBase } from "../_shared/apiBase.ts";
import { API_CATALOGUE, type ApiEndpoint, coutEndpoint, estEndpointConnu, TAILLE_MAX_CORPS_OCTETS } from "../_shared/apiCatalogue.ts";
import { journaliserUsage, rembourserCredits, reponsePourRefus, reserverCredits } from "../_shared/apiFacturation.ts";
import { corsHeaders, empreinteSha256, identifierCle } from "../_shared/apiKeyAuth.ts";
import { attributions } from "../_shared/apiSources.ts";
import { type IssueRoute, ROUTES } from "./routes.ts";

export const VERSION_API = "2026-10-22";

export interface Dependances {
  base: ClientBase;
  appeler: AppelInterne;
  resoudreEpci: (codeInsee: string) => Promise<string | null | "erreur">;
  maintenant?: () => Date;
  idRequete?: () => string;
  journal?: (ligne: string) => void;
  /** Désactive la lecture/écriture du cache (tests). */
  sansCache?: boolean;
}

// ── Réponses ───────────────────────────────────────────────────────────────

function reponse(status: number, corps: unknown, entetes: Record<string, string>): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...entetes,
    },
  });
}

function erreur(
  status: number,
  requestId: string,
  code: string,
  message: string,
  entetes: Record<string, string> = {},
  details?: unknown,
): Response {
  return reponse(status, {
    request_id: requestId,
    erreur: { code, message, ...(details ? { details } : {}) },
  }, { "X-Request-Id": requestId, "X-Credits-Cout": "0", ...entetes });
}

/** Chemin public, quel que soit le préfixe (/api-gateway, /functions/v1/api-gateway). */
export function cheminPublic(pathname: string): string {
  const i = pathname.indexOf("/api-gateway");
  let p = i >= 0 ? pathname.slice(i + "/api-gateway".length) : pathname;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

type LectureCorps =
  | { ok: true; corps: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

export async function lireCorpsJson(req: Request): Promise<LectureCorps> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(ct)) {
    return { ok: false, status: 415, code: "type_contenu_invalide", message: "En-tête Content-Type: application/json obligatoire." };
  }
  const annonce = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(annonce) && annonce > TAILLE_MAX_CORPS_OCTETS) {
    return { ok: false, status: 413, code: "corps_trop_volumineux", message: `Corps limité à ${TAILLE_MAX_CORPS_OCTETS / 1024} Ko.` };
  }
  // Lecture bornée : on n'accumule jamais plus que la limite, même sans Content-Length.
  const morceaux: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const lecteur = req.body.getReader();
    while (true) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.byteLength;
      if (total > TAILLE_MAX_CORPS_OCTETS) {
        await lecteur.cancel().catch(() => {});
        return { ok: false, status: 413, code: "corps_trop_volumineux", message: `Corps limité à ${TAILLE_MAX_CORPS_OCTETS / 1024} Ko.` };
      }
      morceaux.push(value);
    }
  }
  const tampon = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) {
    tampon.set(m, pos);
    pos += m.byteLength;
  }
  let texte: string;
  try {
    texte = new TextDecoder("utf-8", { fatal: true }).decode(tampon);
  } catch {
    return { ok: false, status: 400, code: "corps_invalide", message: "Corps non encodé en UTF-8." };
  }
  if (!texte.trim()) return { ok: false, status: 400, code: "corps_invalide", message: "Corps JSON vide : un objet est attendu." };
  let v: unknown;
  try {
    v = JSON.parse(texte);
  } catch {
    return { ok: false, status: 400, code: "corps_invalide", message: "Corps JSON illisible." };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, status: 400, code: "corps_invalide", message: "Le corps doit être un objet JSON." };
  }
  return { ok: true, corps: v as Record<string, unknown> };
}

/** JSON canonique (clés triées) pour la clé de cache. */
export function jsonCanonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonique).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${
      Object.keys(v as Record<string, unknown>).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
        .map((k) => `${JSON.stringify(k)}:${jsonCanonique((v as Record<string, unknown>)[k])}`).join(",")
    }}`;
  }
  return JSON.stringify(v ?? null);
}

const PREFIXE_CACHE = "api-gateway:";

type IssueSucces = Extract<IssueRoute, { issue: "succes" }>;

async function lireCache(base: ClientBase, endpoint: string, cle: string): Promise<IssueSucces | null> {
  const { data, error } = await base.rpc<Array<{ response: unknown }>>("api_cache_get", { p_provider: PREFIXE_CACHE + endpoint, p_cache_key: cle }, 3000);
  if (error || !Array.isArray(data) || !data[0]?.response) return null;
  const r = data[0].response as Partial<IssueSucces>;
  if (r?.issue !== "succes" || !r.statut || !Array.isArray(r.sources)) return null;
  return r as IssueSucces;
}

async function ecrireCache(base: ClientBase, endpoint: string, cle: string, issue: IssueSucces, ttl: number): Promise<void> {
  // Seule la réponse PUBLIQUE (déjà anonymisée) est stockée ; la requête n'est pas recopiée.
  await base.rpc("api_cache_put", {
    p_provider: PREFIXE_CACHE + endpoint,
    p_cache_key: cle,
    p_request: { endpoint },
    p_response: issue,
    p_status: 200,
    p_ttl_seconds: ttl,
  }, 3000);
}

function avecDelai<T>(p: Promise<T>, ms: number, surDelai: () => T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((res) => {
      t = setTimeout(() => res(surDelai()), ms);
    }),
  ]);
}

// ── Traitement ─────────────────────────────────────────────────────────────

export async function traiterRequete(req: Request, deps: Dependances): Promise<Response> {
  const debut = Date.now();
  const requestId = deps.idRequete?.() ?? crypto.randomUUID();
  const journal = deps.journal ?? ((l: string) => console.error(l));
  const maintenant = deps.maintenant ?? (() => new Date());
  const tempsReponse = () => ({ "X-Response-Time": `${Date.now() - debut}ms` });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const chemin = cheminPublic(new URL(req.url).pathname);
  if (!estEndpointConnu(chemin)) {
    return erreur(404, requestId, "route_inconnue", "Route inconnue. Consultez la documentation de l'API Mimmoza.", tempsReponse());
  }
  const endpoint: ApiEndpoint = chemin;
  const defn = API_CATALOGUE[endpoint];
  if (req.method !== defn.methode) {
    return erreur(405, requestId, "methode_non_autorisee", `Méthode ${defn.methode} attendue.`, { Allow: `${defn.methode}, OPTIONS`, ...tempsReponse() });
  }

  if (endpoint === "/health") {
    return reponse(200, { statut: "ok", service: "api-gateway", version: VERSION_API, request_id: requestId }, {
      "X-Request-Id": requestId,
      "X-Credits-Cout": "0",
      ...tempsReponse(),
    });
  }

  // 3. Corps
  const lu = await lireCorpsJson(req);
  if (!lu.ok) return erreur(lu.status, requestId, lu.code, lu.message, tempsReponse());

  // 4. Clé
  const auth = await identifierCle(deps.base, req.headers.get("authorization"), req.headers.get("x-api-key"));
  if (!auth.ok) {
    if (auth.status === 503) journal(`[api-gateway] ${requestId} ${endpoint} identification indisponible`);
    return erreur(auth.status, requestId, auth.code, auth.message, tempsReponse());
  }
  const keyId = auth.cle.id;

  // 5. Validation stricte — AVANT toute réservation
  const route = ROUTES[endpoint as Exclude<ApiEndpoint, "/health">];
  const v = route.valider(lu.corps);
  if (!v.ok) {
    return erreur(400, requestId, "requete_invalide", "Paramètres invalides : aucun crédit n'a été débité.", tempsReponse(), v.erreurs);
  }

  // 6. Réservation
  const cout = coutEndpoint(endpoint) ?? 1;
  const res = await reserverCredits(deps.base, keyId, endpoint, cout);
  if (res.etat === "indisponible") {
    journal(`[api-gateway] ${requestId} ${endpoint} reservation indisponible`);
    return erreur(503, requestId, "service_indisponible", "Service de facturation momentanément indisponible : la requête n'a pas été exécutée, réessayez.", { "Retry-After": "5", ...tempsReponse() });
  }
  if (!res.reservation.ok) {
    const refus = reponsePourRefus(res.reservation);
    return erreur(refus.status, requestId, refus.code, refus.message, { ...refus.entetes, ...tempsReponse() });
  }
  const reservation = res.reservation;

  // 7. Cache puis exécution
  let issue: IssueRoute | null = null;
  let depuisCache = false;
  const cleCache = defn.cacheSecondes > 0 && !deps.sansCache ? await empreinteSha256(jsonCanonique(v.valeur)) : null;
  if (cleCache) {
    issue = await lireCache(deps.base, endpoint, cleCache).catch(() => null);
    depuisCache = issue !== null;
  }
  if (!issue) {
    const ctx = { appeler: deps.appeler, delaiMs: defn.delaiMs, resoudreEpci: deps.resoudreEpci, maintenant };
    try {
      issue = await avecDelai(
        route.executer(ctx, v.valeur),
        defn.delaiMs + 5000,
        (): IssueRoute => ({ issue: "echec", status: 504, code: "delai_depasse", message: "Délai de traitement dépassé. Aucun crédit n'a été débité.", diagnostic: "delai global" }),
      );
    } catch (e) {
      issue = {
        issue: "echec",
        status: 502,
        code: "erreur_interne",
        message: "Erreur interne. Aucun crédit n'a été débité.",
        diagnostic: `exception ${e instanceof Error ? e.name : "inconnue"}`,
      };
    }
  }

  // 8. Échec → remboursement intégral
  if (issue.issue === "echec") {
    const rembourse = await rembourserCredits(deps.base, keyId, reservation);
    if (!rembourse) {
      // Identifiant de clé + montants (aucun secret) pour régularisation manuelle.
      journal(`[api-gateway] ${requestId} REMBOURSEMENT EN ECHEC key_id=${keyId} mois=${reservation.source_mois} recharge=${reservation.source_recharge}`);
    }
    journal(`[api-gateway] ${requestId} ${endpoint} echec ${issue.code} ${issue.diagnostic ?? ""}`.trim());
    await journaliserUsage(deps.base, keyId, endpoint, true, Date.now() - debut).catch(() => {});
    const entetes: Record<string, string> = { ...tempsReponse() };
    if (reservation.restant !== null) entetes["X-Credits-Restants"] = String(Math.max(0, Math.trunc(reservation.restant + (rembourse ? cout : 0))));
    if (!rembourse) entetes["X-Credits-Cout"] = String(cout);
    return erreur(issue.status, requestId, issue.code, rembourse ? issue.message : issue.message.replace(" Aucun crédit n'a été débité.", " Le remboursement des crédits est en cours de régularisation."), entetes);
  }

  // 9. Succès
  if (cleCache && !depuisCache && issue.statut !== "partiel") {
    await ecrireCache(deps.base, endpoint, cleCache, issue, defn.cacheSecondes).catch(() => {});
  }
  await journaliserUsage(deps.base, keyId, endpoint, false, Date.now() - debut).catch(() => {});

  const restants = reservation.restant !== null ? Math.max(0, Math.trunc(reservation.restant)) : null;
  const entetes: Record<string, string> = { "X-Request-Id": requestId, "X-Credits-Cout": String(cout), ...tempsReponse() };
  if (restants !== null) entetes["X-Credits-Restants"] = String(restants);
  return reponse(200, {
    request_id: requestId,
    endpoint,
    version: VERSION_API,
    beta: defn.statut === "beta",
    statut: issue.statut,
    donnees: issue.donnees,
    sources: attributions(issue.sources),
    avertissements: issue.avertissements,
    credits: { cout, restants },
    depuis_cache: depuisCache,
  }, entetes);
}
