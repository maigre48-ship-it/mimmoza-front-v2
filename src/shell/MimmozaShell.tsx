// MimmozaShell.tsx
// Shell applicatif unique. Les deux surfaces (conversation MimmozIA + modules Expert)
// vivent DANS ce shell et partagent le même MimmozaContext. Le "mode" n'est pas un
// state à synchroniser : il se déduit de la route. Aucun code de module n'est dupliqué.

import { useCallback } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { ResolvedPlan, IntentSlots } from "./intentRegistry";

// --- À brancher sur tes implémentations existantes -------------------------
// Ton provider de contexte prédictif (predictive_snapshot, 17 sources, vertical…).
import { MimmozaContextProvider } from "@/spaces/copilot/MimmozaContext";
// Ton système de clés scopées par utilisateur (localStorage isolé).
import { useUserStorage } from "@/lib/userStorage";
// Ta surface de conversation (l'actuel /copilot, promu en page d'accueil).
import { ConversationSurface } from "@/spaces/copilot/ConversationSurface";
// ---------------------------------------------------------------------------

/**
 * Arbre de routes à monter (App.tsx) — tes routes actuelles sont INCHANGÉES,
 * on ajoute seulement l'index conversationnel au-dessus :
 *
 * <Route path="/" element={<MimmozaShell />}>
 *   <Route index element={<ConversationSurface />} />
 *   <Route path="promoteur/*"      element={<PromoteurRoutes />} />
 *   <Route path="investisseur/*"   element={<InvestisseurRoutes />} />
 *   <Route path="rehabilitation/*" element={<RehabRoutes />} />
 *   <Route path="apporteur/*"      element={<ApporteurRoutes />} />
 *   <Route path="banque/*"         element={<BanqueRoutes />} />
 * </Route>
 *
 * Alias de transition, pour ne casser aucun lien existant :
 * <Route path="/copilot" element={<Navigate to="/" replace />} />
 */
export function MimmozaShell() {
  const { pathname } = useLocation();
  const isConversation = pathname === "/";

  // Un expert aguerri peut choisir d'atterrir directement dans un module.
  // Le mode Expert n'est PAS un échafaudage : c'est une préférence durable.
  const [expertDefault] = useUserStorage<boolean>("mode:expert-default", false);

  if (isConversation && expertDefault) {
    return <Navigate to="/promoteur" replace />;
  }

  return (
    <MimmozaContextProvider>
      <div className="mimmoza-shell">
        {/* Chrome commun aux deux surfaces (barre haute, thème vertical…). */}
        <ExpertLauncher />
        {/* Rend la conversation OU le module actif — même chrome, même contexte. */}
        <Outlet />
      </div>
    </MimmozaContextProvider>
  );
}

/**
 * Le "bouton discret" vers le mode Expert. Squelette neutre : habille-le
 * avec ton design system (couleur du vertical actif, etc.).
 * En conversation → ouvre le sélecteur de modules. Dans un module → revient au chat.
 */
function ExpertLauncher() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const inConversation = pathname === "/";

  return (
    <button
      type="button"
      className="mimmoza-expert-launcher"
      aria-label={inConversation ? "Ouvrir le mode expert" : "Revenir à MimmozIA"}
      onClick={() => navigate(inConversation ? "/promoteur" : "/")}
    >
      {inConversation ? "Mode expert" : "MimmozIA"}
    </button>
  );
}

/**
 * LE PONT (sens chat → module).
 * Depuis un CTA de fin de réponse MimmozIA : ouvre le module Expert du plan,
 * déjà pré-rempli avec les slots résolus. L'utilisateur ne re-saisit rien.
 */
export function useOpenInExpert() {
  const navigate = useNavigate();
  return useCallback(
    (plan: ResolvedPlan) => {
      if (!plan.deeplink) return; // pas de deep-link → on reste dans le chat
      navigate(plan.deeplink, {
        state: { slots: plan.slots, from: "mimmozia" as const },
      });
    },
    [navigate],
  );
}

/**
 * LE PONT (côté module).
 * À appeler en tête d'un module Expert pour s'hydrater du contexte transmis
 * par MimmozIA. Retourne null si l'utilisateur est arrivé directement (parcours expert).
 */
export function useExpertHandoff(): IntentSlots | null {
  const location = useLocation();
  const state = location.state as
    | { slots?: IntentSlots; from?: string }
    | null;
  if (state?.from === "mimmozia" && state.slots) return state.slots;
  return null;
}