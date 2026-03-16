import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert, Loader2 } from "lucide-react";
import { requireAdmin } from "../services/adminAccess";

type GuardState = "loading" | "allowed" | "denied-auth" | "denied-admin";

type Props = {
  children: ReactNode;
};

export function AdminGuard({ children }: Props) {
  const location = useLocation();
  const [state, setState] = useState<GuardState>("loading");

  useEffect(() => {
    let mounted = true;

    async function check() {
      const result = await requireAdmin();

      if (!mounted) return;

      if (result.ok) {
        setState("allowed");
        return;
      }

      if (result.reason === "not_authenticated") {
        setState("denied-auth");
        return;
      }

      setState("denied-admin");
    }

    void check();

    return () => {
      mounted = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-6">
        <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-500">
                Vérification sécurité
              </div>
              <div className="text-lg font-semibold text-slate-900">
                Contrôle de l’accès administrateur…
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "denied-auth") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (state === "denied-admin") {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-6">
        <div className="w-full max-w-lg rounded-[28px] border border-rose-200 bg-white p-8 shadow-sm">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50">
            <ShieldAlert className="h-7 w-7 text-rose-600" />
          </div>

          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-600">
            Accès refusé
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Espace administrateur protégé
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Votre compte est bien connecté, mais il n’est pas autorisé à accéder
            à l’interface d’administration Mimmoza.
          </p>

          <div className="mt-6">
            <a
              href="/"
              className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Retour à l’accueil
            </a>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}