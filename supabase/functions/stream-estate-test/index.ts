// FILE: supabase/functions/stream-estate-test/index.ts
// =============================================================================
// FONCTION NEUTRALISÉE — endpoint de test laissé en production
// =============================================================================
//
// Ce que faisait cette fonction
// -----------------------------
// Un GET sans corps ni paramètre interrogeait l'API tierce Stream Estate avec
// STREAM_ESTATE_API_KEY, sur une requête codée en dur (code postal 92210,
// 5 résultats), et renvoyait la réponse brute.
//
// Pourquoi elle a été neutralisée
// -------------------------------
// Aucune authentification, aucune vérification de méthode : n'importe qui
// connaissant l'URL consommait le quota de l'abonnement Stream Estate, et
// récupérait des données d'annonces facturées au compte. La clé elle-même
// n'était pas renvoyée dans la réponse, mais son usage était offert à tous —
// et le coût avec.
//
// C'était un test de connectivité, écrit pour vérifier une fois que la clé
// fonctionnait. Il n'a aucun appelant dans le dépôt. Il n'a rien à faire en
// production : supprime-le depuis le dashboard.
//
// À FAIRE : vérifier la consommation du compte Stream Estate. Si elle est
// anormale, faire tourner la clé (STREAM_ESTATE_API_KEY) côté fournisseur puis
// dans les secrets Supabase.
// =============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(() =>
  new Response(
    JSON.stringify({
      error: "Gone",
      message:
        "Point d'entrée de test retiré. Il exposait l'API Stream Estate sans " +
        "authentification.",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  )
);
