// src/pages/NotFoundPage.tsx
// Vraie page 404 (audit du 21/10/2026) : une adresse inconnue n'est plus
// redirigée en silence vers la connexion.

import { Compass } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

export default function NotFoundPage() {
  const { pathname } = useLocation();

  useEffect(() => {
    const precedent = document.title;
    document.title = "Page introuvable — Mimmoza";
    return () => { document.title = precedent; };
  }, []);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Compass className="h-7 w-7 text-slate-600" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Erreur 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Page introuvable</h1>
        <p className="mt-3 break-words text-sm leading-6 text-slate-600">
          L'adresse <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">{pathname}</code> ne
          correspond à aucune page de Mimmoza.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/" className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            Retour à l'accueil
          </Link>
          <Link to="/tarifs" className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Voir les tarifs
          </Link>
        </div>
      </div>
    </div>
  );
}
