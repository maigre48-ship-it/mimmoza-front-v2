// src/components/billing/RequirePlan.tsx
//
// Garde de route des modules métier payants (Promotion, Marchand de biens,
// Réhabilitation) — audit du 21/10/2026, P0 n°5.
//
// Le plan est LU EN BASE : billing_profiles.plan_code + subscription_status,
// la même source que copilot-chat (getUserPlan). syncPlanFromServer aligne au
// passage le cache local utilisé par les onglets. Une ligne absente, un
// abonnement inactif ou une erreur de lecture valent « Découverte » (aucun
// module) : on n'ouvre jamais un module par défaut.
//
// Les administrateurs actifs (admin_users, RPC is_current_user_admin) ont
// accès à tout.
//
// Le choix du module de la formule Indépendant (1 au choix) reste mémorisé
// localement (selectModule) : il n'existe pas encore de colonne serveur.
//
// À placer À L'INTÉRIEUR d'un <PrivateRoute /> (session déjà vérifiée).

import { Lock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { ChargementGarde } from "@/components/ChargementGarde";
import { supabase } from "@/lib/supabase";
import {
  MODULE_LABEL,
  PLAN_LABEL,
  canAccessPath,
  getSpaceAccess,
  moduleSpaceForPath,
  type PlanId,
} from "@/lib/billing/planAccess";
import { syncPlanFromServer } from "@/lib/billing/syncPlanFromServer";
import { usePlanAccess } from "@/lib/billing/usePlanAccess";

type EtatPlan =
  | { chargement: true }
  | { chargement: false; plan: PlanId; admin: boolean };

/** Lit le plan serveur et le statut administrateur de l'utilisateur connecté. */
export function usePlanServeur(): EtatPlan {
  const [etat, setEtat] = useState<EtatPlan>({ chargement: true });

  useEffect(() => {
    let actif = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user.id;
        if (!userId) {
          if (actif) setEtat({ chargement: false, plan: "basique", admin: false });
          return;
        }
        const [adminRes, sync] = await Promise.all([
          supabase.rpc("is_current_user_admin"),
          syncPlanFromServer(userId),
        ]);
        if (!actif) return;
        setEtat({
          chargement: false,
          plan: sync?.plan ?? "basique",
          admin: !adminRes.error && adminRes.data === true,
        });
      } catch {
        if (actif) setEtat({ chargement: false, plan: "basique", admin: false });
      }
    })();
    return () => { actif = false; };
  }, []);

  return etat;
}

export function RequirePlan({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const etat = usePlanServeur();
  // Choix du module (formule Indépendant), réactif.
  const { selectedModules, selectModule } = usePlanAccess();

  if (etat.chargement) return <ChargementGarde libelle="Vérification de votre formule…" />;

  const autorise = etat.admin || canAccessPath(location.pathname, etat.plan, selectedModules);
  if (autorise) return children ? <>{children}</> : <Outlet />;

  const module = moduleSpaceForPath(location.pathname);
  const nomModule = module ? MODULE_LABEL[module] : "ce module";
  const acces = module ? getSpaceAccess(module, etat.plan, selectedModules) : null;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50">
          <Lock className="h-7 w-7 text-violet-600" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          Votre formule n'inclut pas ce module
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Le module <strong>{nomModule}</strong> n'est pas compris dans votre formule actuelle
          (<strong>{PLAN_LABEL[etat.plan]}</strong>).{" "}
          {acces?.selectable
            ? "Votre formule Indépendant inclut un module métier au choix : vous pouvez choisir celui-ci."
            : "Il est inclus dans les formules Indépendant (1 module au choix), Pro et Équipe."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {acces?.selectable && module ? (
            <button
              type="button"
              onClick={() => selectModule(module)}
              className="inline-flex items-center rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Choisir {nomModule}
            </button>
          ) : null}
          <Link
            to="/tarifs"
            className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Voir les tarifs
          </Link>
          <Link
            to="/accueil"
            className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RequirePlan;
