// src/spaces/particulier/pages/AbonnementPage.tsx
// ─── Abonnements Mimmoza (connecté) ───────────────────────────────────────────
// Grille unique : src/lib/billing/grille.ts (Découverte / Indépendant / Pro —
// codes techniques basique / avance / pro). La formule « Équipe » (proplus) a
// été retirée le 23/10/2026 : un lien ?plan=proplus met Pro en avant.
//
// Audit du 21/10/2026 :
//  • les prix ne sont plus lus dans localStorage["mimmoza.pricing"] (clés
//    absentes en production → « Sur devis » partout) ;
//  • le bouton d'une formule payante n'accorde PLUS le plan en local
//    (setPlan) : le paiement n'est pas branché, l'accès s'ouvre sur demande.
//    Le plan réel vient du serveur (billing_profiles, cf. syncPlanFromServer).

import { HeartHandshake, Sparkles, TrendingUp, Zap } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { GrilleTarifaire } from "@/components/billing/GrilleTarifaire";
import { getCurrentPlanState } from "@/lib/billing/usePlanAccess";
import { normaliserPlan, type PlanId } from "@/lib/billing/planAccess";

const PLANS_VALIDES: PlanId[] = ["basique", "avance", "pro", "proplus"];

export default function AbonnementPage() {
  const [params] = useSearchParams();
  const current = useMemo(() => getCurrentPlanState(), []);
  const demande = params.get("plan") as PlanId | null;
  const highlighted = demande && PLANS_VALIDES.includes(demande) ? normaliserPlan(demande) : undefined;

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <style>{`
        @keyframes gx { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .agx { background-size:200% 200%; animation:gx 7s ease infinite; }
      `}</style>

      <div className="flex min-h-[calc(100vh-6rem)]">
        <aside
          className="hidden shrink-0 flex-col overflow-hidden lg:flex"
          style={{ width: "320px", background: "linear-gradient(180deg,#eef4ff 0%,#f0f7ff 40%,#e8f3ff 100%)" }}
        >
          <img
            src="/illustrations/colone_abonnement.png"
            alt="" aria-hidden="true" draggable={false}
            className="h-full w-full object-contain object-center"
          />
        </aside>

        <div className="flex flex-1 flex-col px-8 py-10 lg:px-10 lg:py-12">
          <div className="mb-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              Abonnements Mimmoza
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-[2.6rem]">
              Choisissez votre{" "}
              <span className="agx bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400 bg-clip-text text-transparent">
                formule
              </span>
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-500">
              Mimmo pour tous, avec les modules métier selon votre formule.
            </p>
          </div>

          <GrilleTarifaire formuleActuelle={current.plan} enAvant={highlighted} />

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: <Zap className="h-4 w-4 text-violet-500" />, label: "Sans engagement", sub: "Formule mensuelle résiliable" },
              { icon: <HeartHandshake className="h-4 w-4 text-indigo-500" />, label: "Support", sub: "Une équipe à votre écoute" },
              { icon: <TrendingUp className="h-4 w-4 text-orange-500" />, label: "Évolutif", sub: "Changez de formule à tout moment" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="shrink-0">{item.icon}</div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{item.label}</p>
                  <p className="truncate text-[11px] text-slate-400">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
