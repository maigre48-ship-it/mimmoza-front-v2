// src/pages/TarifsPage.tsx
//
// Page PUBLIQUE des tarifs (/tarifs) — indexable (cf. RobotsPolicy), sans
// aucune donnée DVF : uniquement la grille de src/lib/billing/grille.ts.

import { Sparkles } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";

import { GrilleTarifaire } from "@/components/billing/GrilleTarifaire";

export default function TarifsPage() {
  useEffect(() => {
    const precedent = document.title;
    document.title = "Tarifs — Mimmoza";
    return () => { document.title = precedent; };
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10 lg:py-14">
      <div className="mb-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          Tarifs Mimmoza
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-[2.6rem]">
          Des formules simples, de la parcelle au permis
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-500">
          Commencez gratuitement avec 3 analyses rapides par mois, puis choisissez la formule adaptée à votre
          activité : promotion, marchand de biens, réhabilitation.
        </p>
      </div>

      <GrilleTarifaire publique />

      <p className="mt-8 text-sm text-slate-500">
        Déjà un compte ?{" "}
        <Link to="/connexion" className="font-semibold text-violet-600 hover:underline">Se connecter</Link>
        {" · "}
        <Link to="/cgv" className="hover:underline">Conditions générales de vente</Link>
      </p>
    </div>
  );
}
