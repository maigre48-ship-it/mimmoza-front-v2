// src/pages/BientotDisponiblePage.tsx
// Page « Bientôt disponible » pour les espaces masqués (src/lib/espacesEnPreparation.ts).

import { Hourglass } from "lucide-react";
import { Link } from "react-router-dom";

export default function BientotDisponiblePage({ titre = "Cet espace" }: { titre?: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50">
          <Hourglass className="h-7 w-7 text-sky-600" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Bientôt disponible</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {titre} est en préparation et sera ouvert prochainement.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
