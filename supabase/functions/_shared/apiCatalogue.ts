// supabase/functions/_shared/apiCatalogue.ts
// ─────────────────────────────────────────────────────────────────────────────
// Catalogue de l'API publique Mimmoza — SOURCE UNIQUE des coûts en crédits.
//
// ⚠️ `API_ENDPOINT_COSTS` est lu PAR EXPRESSION RÉGULIÈRE par un test node du
// front (catalogue affiché aux clients). Garder un objet littéral sur une ligne
// par endpoint : `"/v1/chemin": n,`. Pas de calcul, pas de spread.
//
// Règle du contrat (docs/api/CONTRAT_API.md) : chaque endpoint facturé coûte
// ≥ 1 crédit ; un coût ne peut être ajusté qu'À LA HAUSSE.
// Module PUR (aucun import réseau) : testable avec `deno test` sans réseau.
// ─────────────────────────────────────────────────────────────────────────────

export const API_ENDPOINT_COSTS = {
  "/health": 0,
  "/v1/scoring/smart": 10,
  "/v1/market/dvf": 3,
  "/v1/risks": 3,
  "/v1/parcelle": 1,
  "/v1/plu": 4,
  "/v1/servitudes": 2,
  "/v1/faisabilite": 25,
  "/v1/permis": 2,
  "/v1/dpe": 1,
  "/v1/batiment": 2,
  "/v1/loyers": 1,
  "/v1/fiscalite": 2,
  "/v1/environnement": 3,
  "/v1/mobilite": 2,
  "/v1/couts": 2,
  "/v1/estimation": 15,
} as const;

export type ApiEndpoint = keyof typeof API_ENDPOINT_COSTS;

export type StatutEndpoint = "live" | "beta";

export interface DefinitionEndpoint {
  chemin: ApiEndpoint;
  methode: "GET" | "POST";
  statut: StatutEndpoint;
  /** Durée de mise en cache de NOTRE côté (0 = pas de cache). Le client paie quand même. */
  cacheSecondes: number;
  /** Délai maximal accordé à l'ensemble des appels internes de la route. */
  delaiMs: number;
}

const H = 3600;
const J = 24 * H;

export const API_CATALOGUE: Record<ApiEndpoint, DefinitionEndpoint> = {
  "/health": { chemin: "/health", methode: "GET", statut: "live", cacheSecondes: 0, delaiMs: 1000 },
  "/v1/scoring/smart": { chemin: "/v1/scoring/smart", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 40000 },
  "/v1/market/dvf": { chemin: "/v1/market/dvf", methode: "POST", statut: "live", cacheSecondes: 7 * J, delaiMs: 30000 },
  "/v1/risks": { chemin: "/v1/risks", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 30000 },
  "/v1/parcelle": { chemin: "/v1/parcelle", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 12000 },
  "/v1/plu": { chemin: "/v1/plu", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 15000 },
  "/v1/servitudes": { chemin: "/v1/servitudes", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 25000 },
  "/v1/faisabilite": { chemin: "/v1/faisabilite", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 35000 },
  "/v1/permis": { chemin: "/v1/permis", methode: "POST", statut: "live", cacheSecondes: 7 * J, delaiMs: 30000 },
  "/v1/dpe": { chemin: "/v1/dpe", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 15000 },
  "/v1/batiment": { chemin: "/v1/batiment", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 15000 },
  "/v1/loyers": { chemin: "/v1/loyers", methode: "POST", statut: "live", cacheSecondes: 7 * J, delaiMs: 12000 },
  "/v1/fiscalite": { chemin: "/v1/fiscalite", methode: "POST", statut: "live", cacheSecondes: 7 * J, delaiMs: 15000 },
  "/v1/environnement": { chemin: "/v1/environnement", methode: "POST", statut: "live", cacheSecondes: 1 * J, delaiMs: 25000 },
  "/v1/mobilite": { chemin: "/v1/mobilite", methode: "POST", statut: "live", cacheSecondes: 7 * J, delaiMs: 15000 },
  "/v1/couts": { chemin: "/v1/couts", methode: "POST", statut: "beta", cacheSecondes: 0, delaiMs: 12000 },
  "/v1/estimation": { chemin: "/v1/estimation", methode: "POST", statut: "beta", cacheSecondes: 0, delaiMs: 40000 },
};

export function coutEndpoint(chemin: string): number | null {
  return Object.prototype.hasOwnProperty.call(API_ENDPOINT_COSTS, chemin)
    ? API_ENDPOINT_COSTS[chemin as ApiEndpoint]
    : null;
}

export function estEndpointConnu(chemin: string): chemin is ApiEndpoint {
  return coutEndpoint(chemin) !== null;
}

/** Taille maximale du corps de requête accepté par la passerelle. */
export const TAILLE_MAX_CORPS_OCTETS = 32 * 1024;
