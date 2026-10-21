// src/lib/auth/useSessionSupabase.ts
//
// Session Supabase réactive (audit du 21/10/2026, P0 n°5).
// Remplace la lecture de localStorage["mimmoza.user"].logged, falsifiable
// depuis la console du navigateur.
//
//   chargement : true tant que getSession() n'a pas répondu — les gardes de
//                route affichent alors un écran neutre (pas de flash de la
//                page de connexion pour un utilisateur déjà connecté).

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

export interface EtatSession {
  chargement: boolean;
  session: Session | null;
}

export function useSessionSupabase(): EtatSession {
  const [etat, setEtat] = useState<EtatSession>({ chargement: true, session: null });

  useEffect(() => {
    let actif = true;

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (actif) setEtat({ chargement: false, session: data.session });
      })
      .catch(() => {
        if (actif) setEtat({ chargement: false, session: null });
      });

    const { data } = supabase.auth.onAuthStateChange((_evenement, session) => {
      if (actif) setEtat({ chargement: false, session });
    });

    return () => {
      actif = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return etat;
}
