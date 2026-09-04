// FILE: supabase/functions/quick-function/index.ts
// =============================================================================
// FONCTION NEUTRALISÉE — doublon exact de `trigger-create-user`
// =============================================================================
//
// Ce fichier était une copie octet pour octet de `trigger-create-user`, sous un
// nom qui ne dit rien de ce qu'il fait — c'est d'ailleurs ainsi qu'il est passé
// inaperçu. Il déclenchait le workflow GitHub `create-supabase-user.yml` sans
// aucune authentification, CORS ouvert à `*`, avec `email_confirmed` à true par
// défaut : n'importe qui pouvait obtenir un compte Supabase vérifié sur une
// adresse e-mail qu'il ne possédait pas.
//
// Le raisonnement complet et les conditions d'un éventuel rétablissement sont
// documentés dans `trigger-create-user/index.ts`. Celui-ci n'a pas vocation à
// être rétabli : c'était un doublon, il doit être supprimé.
// =============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

serve(() =>
  new Response(
    JSON.stringify({
      error: "Gone",
      message:
        "Ce point d'entrée a été retiré. Il permettait de créer un compte " +
        "vérifié sans authentification.",
    }),
    { status: 410, headers: HEADERS },
  )
);
