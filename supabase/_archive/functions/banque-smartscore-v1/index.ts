/// <reference lib="deno.ns" />

// FILE: supabase/functions/banque-smartscore-v1/index.ts
// =============================================================================
// SMARTSCORE D'UN DOSSIER BANQUE
// =============================================================================
//
// Ce qui a été corrigé, et pourquoi
// ---------------------------------
// La version précédente présentait trois défauts qui se cumulaient :
//
//   1. AUCUNE AUTHENTIFICATION. Le handler ne lisait jamais l'en-tête
//      Authorization. N'importe qui connaissant l'URL et un identifiant de
//      dossier pouvait appeler la fonction.
//
//   2. CLÉ service_role. Le client était construit avec SUPABASE_SERVICE_ROLE_KEY,
//      qui contourne la RLS par conception. Or `banque_dossiers` porte quatre
//      politiques (select/insert/update/delete) toutes fondées sur
//      `user_id = auth.uid()` : elles étaient donc intégralement neutralisées.
//      Combiné au point 1, cela rendait lisible et modifiable le dossier de
//      n'importe quel utilisateur.
//
//   3. ÉCRITURE DESTRUCTRICE. Le commentaire annonçait un « placeholder propre,
//      non destructif », mais le code écrasait `market_data` et `risks_data`
//      par `{status: "pending"}` — écrasant donc de vraies données d'étude par
//      un marqueur vide. `persist` valait true par défaut, si bien qu'un appel
//      minimal `{dossierId}` suffisait à déclencher cet écrasement.
//
// Le correctif
// ------------
// La fonction n'utilise plus la clé service_role du tout. Elle rejoue le JWT
// de l'appelant, ce qui a deux effets : la RLS retrouve son autorité (un
// utilisateur ne voit et ne modifie que ses propres dossiers), et la fonction
// ne peut plus rien faire que son appelant ne pourrait faire lui-même. C'est
// la seule posture qui reste correcte si un jour cette fonction est appelée
// depuis un contexte moins contrôlé.
//
// La clé anon ne suffit PAS : elle est publique par nature (elle est embarquée
// dans le bundle front), et `auth.getUser()` ne renvoie aucun utilisateur pour
// elle. Le refus est donc explicite.
//
// `persist` est désormais opt-in, et l'écriture ne porte plus que sur
// `smartscore_data` — le seul champ que cette fonction calcule réellement.
// =============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
type InputPayload = {
  dossierId: string;
  /**
   * Écrire le résultat dans le dossier. Opt-in : un appel de lecture ne doit
   * jamais modifier la base par inadvertance.
   */
  persist?: boolean;
};

type BanqueDossier = {
  id: string;
  lat?: number | null;
  lng?: number | null;
};

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "POST only" }, 405);
    }

    // ── 1. Authentification ────────────────────────────────────────────────
    // On exige un porteur, puis un utilisateur RÉEL derrière ce porteur.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    // Client porteur du JWT de l'appelant : la RLS s'appliquera à toutes les
    // requêtes qui en découlent.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      // Cas typique : la clé anon a été envoyée telle quelle. Elle est publique,
      // elle ne désigne aucun utilisateur, elle ne donne donc aucun droit ici.
      return jsonResponse({ error: "Invalid or anonymous token" }, 401);
    }

    // ── 2. Entrée ──────────────────────────────────────────────────────────
    const payload = (await req.json()) as InputPayload;

    if (!payload?.dossierId || typeof payload.dossierId !== "string") {
      return jsonResponse({ error: "Missing dossierId" }, 400);
    }

    // Opt-in explicite (l'ancien défaut était `true`).
    const persist = payload.persist === true;

    // ── 3. Charger le dossier (sous RLS) ───────────────────────────────────
    // Un dossier appartenant à quelqu'un d'autre est simplement invisible :
    // la réponse est un 404, qui ne révèle pas son existence.
    const { data: dossier, error: dossierError } = await supabase
      .from("banque_dossiers")
      .select("id, lat, lng")
      .eq("id", payload.dossierId)
      .maybeSingle<BanqueDossier>();

    if (dossierError) {
      return jsonResponse(
        { error: "Dossier lookup failed", details: dossierError.message },
        500,
      );
    }
    if (!dossier) {
      return jsonResponse({ error: "Dossier not found" }, 404);
    }

    const lat = dossier.lat;
    const lng = dossier.lng;

    if (lat == null || lng == null) {
      return jsonResponse({ error: "Dossier missing lat/lng" }, 400);
    }

    // ── 4. SmartScore ──────────────────────────────────────────────────────
    const { data: smartscoreData, error: smartscoreError } = await supabase.rpc(
      "compute_smartscore_v1",
      { lat, lng },
    );

    if (smartscoreError) {
      return jsonResponse(
        { error: "SmartScore failed", details: smartscoreError.message },
        500,
      );
    }

    // ── 5. Persistance (sous RLS, et sur le seul champ calculé) ────────────
    // On n'écrit PLUS `market_data` ni `risks_data` : cette fonction ne les
    // calcule pas, et y déposer un marqueur `pending` détruisait les études
    // produites par les outils qui, eux, les calculent réellement.
    if (persist) {
      const { error: updateError } = await supabase
        .from("banque_dossiers")
        .update({
          smartscore_data: smartscoreData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dossier.id);

      if (updateError) {
        return jsonResponse(
          { error: "Persist failed", details: updateError.message },
          500,
        );
      }
    }

    // ── 6. Réponse ─────────────────────────────────────────────────────────
    return jsonResponse({
      dossierId: dossier.id,
      smartscore: smartscoreData,
      persisted: persist,
      // Champs non calculés par cette fonction : annoncés comme tels plutôt
      // que renvoyés sous forme de placeholders qu'un appelant pourrait
      // prendre pour un résultat.
      market: null,
      risk: null,
      notice:
        "market et risk ne sont pas calculés par cette fonction et ne sont " +
        "plus écrits en base. Utilise les outils dédiés (étude de marché, " +
        "Géorisques) pour ces deux volets.",
    });
  } catch (e) {
    return jsonResponse(
      { error: "Unhandled error", details: String(e) },
      500,
    );
  }
});
