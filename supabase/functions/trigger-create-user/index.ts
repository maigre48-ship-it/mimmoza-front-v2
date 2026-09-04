// FILE: supabase/functions/trigger-create-user/index.ts
// =============================================================================
// FONCTION NEUTRALISÉE — ne rétablis pas le comportement précédent tel quel
// =============================================================================
//
// Ce que faisait cette fonction
// -----------------------------
// Elle déclenchait le workflow GitHub `create-supabase-user.yml` du dépôt
// backend, via un `workflow_dispatch` signé avec GITHUB_TOKEN, en transmettant
// `email`, `password` et `email_confirmed` reçus dans le corps de la requête.
//
// Pourquoi elle a été neutralisée
// -------------------------------
// Elle ne lisait jamais l'en-tête Authorization, et ouvrait CORS à `*`. Autrement
// dit : toute personne connaissant l'URL pouvait déclencher la création d'un
// compte Supabase déjà vérifié (`email_confirmed` par défaut à true), avec le
// mot de passe de son choix — sans jamais posséder l'adresse e-mail associée.
// Le jeton GitHub n'était pas divulgué, mais sa capacité l'était : dispatch de
// workflow à volonté, sur le dépôt backend.
//
// `quick-function` était une copie octet pour octet de ce fichier. Les deux ont
// été neutralisées ensemble.
//
// Si ce déclencheur redevient nécessaire
// --------------------------------------
// Trois conditions, aucune facultative :
//   1. un secret d'administration comparé en temps constant, PAS la clé anon
//      (publique par nature, embarquée dans le bundle front) ;
//   2. CORS restreint à l'origine d'administration, pas `*` ;
//   3. `email_confirmed` par défaut à FALSE — confirmer une adresse qu'on n'a
//      pas vérifiée est exactement ce qui rendait la faille exploitable.
//
// À FAIRE côté GitHub : vérifier l'historique des exécutions de
// `create-supabase-user.yml` (Actions → workflow → Runs) pour s'assurer
// qu'aucun déclenchement inattendu n'a eu lieu, et supprimer les comptes
// correspondants le cas échéant.
// =============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  // Pas de CORS permissif : plus rien ici n'est destiné à un navigateur.
  "Cache-Control": "no-store",
};

serve(() =>
  new Response(
    JSON.stringify({
      error: "Gone",
      message:
        "Ce point d'entrée a été retiré. Il permettait de créer un compte " +
        "vérifié sans authentification. La création de comptes passe " +
        "désormais par le parcours d'inscription normal.",
    }),
    { status: 410, headers: HEADERS },
  )
);
