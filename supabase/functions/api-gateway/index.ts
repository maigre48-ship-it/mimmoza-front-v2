// supabase/functions/api-gateway/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// API publique Mimmoza — point d'entrée Edge Function (verify_jwt = false : la
// passerelle authentifie elle-même par clé API mk_live_ / mk_test_).
//
// Toute la logique est dans gateway.ts (testée par index.test.ts) ; ce fichier
// ne fait que brancher les vraies dépendances. Catalogue et coûts :
// _shared/apiCatalogue.ts ; contrat : docs/api/CONTRAT_API.md.
//
// Déploiement : supabase functions deploy api-gateway --project-ref fwvrqngbafqdaekbdfnm
// ─────────────────────────────────────────────────────────────────────────────

import { cleServiceDepuisEnv, creerAppelInterne, creerClientBase } from "../_shared/apiBase.ts";
import { traiterRequete } from "./gateway.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const cle = cleServiceDepuisEnv((k) => Deno.env.get(k));

if (!url || !cle) console.error("[api-gateway] configuration incomplète (SUPABASE_URL ou clé service)");

const base = creerClientBase({ url, cle });
const appeler = creerAppelInterne({ url, cle });

/** Code INSEE → EPCI via l'API Découpage administratif (geo.api.gouv.fr, sans clé). */
async function resoudreEpci(codeInsee: string): Promise<string | null | "erreur"> {
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes/${encodeURIComponent(codeInsee)}?fields=codeEpci`,
      { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } },
    );
    if (r.status === 404) {
      await r.body?.cancel();
      return null;
    }
    if (!r.ok) {
      await r.body?.cancel();
      return "erreur";
    }
    const j = await r.json();
    return typeof j?.codeEpci === "string" && /^\d{9}$/.test(j.codeEpci) ? j.codeEpci : null;
  } catch {
    return "erreur";
  }
}

Deno.serve((req: Request) => traiterRequete(req, { base, appeler, resoudreEpci }));
