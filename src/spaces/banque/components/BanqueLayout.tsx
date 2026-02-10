// ============================================================================
// BanqueLayout.tsx — Layout unique espace Banque
// SEULE source de navigation workflow Banque.
// Contient: étapes linéaires + ID dossier actif + "Changer de dossier".
// Les pages enfants NE DOIVENT PAS afficher de nav workflow.
// ============================================================================

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";

const STEPS = [
  { label: "Dossiers",  path: "/banque/dossiers", needsId: false },
  { label: "Dossier",   path: "/banque/dossier",  needsId: true  },
  { label: "Analyse",   path: "/banque/analyse",  needsId: true  },
  { label: "Comité",    path: "/banque/comite",   needsId: true  },
] as const;

export default function BanqueLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { dossierId } = useBanqueDossierContext();

  const goTo = (step: (typeof STEPS)[number]) => {
    if (step.needsId) {
      if (!dossierId) {
        navigate("/banque/dossiers");
        return;
      }
      navigate(`${step.path}/${dossierId}`);
    } else {
      navigate(step.path);
    }
  };

  const isActive = (basePath: string) => {
    if (basePath === "/banque/dossiers") {
      return location.pathname === "/banque/dossiers";
    }
    return (
      location.pathname === basePath ||
      location.pathname.startsWith(`${basePath}/`)
    );
  };

  // Current step index (for the step-indicator style)
  const currentIdx = STEPS.findIndex((s) => isActive(s.path));

  return (
    <div className="w-full">
      {/* ── Workflow bar (unique) ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-4 mb-6">
        {/* Steps */}
        <div className="flex items-center gap-1">
          {STEPS.map((step, idx) => {
            const active = isActive(step.path);
            const disabled = step.needsId && !dossierId;
            const past = currentIdx >= 0 && idx < currentIdx;
            return (
              <button
                key={step.path}
                type="button"
                onClick={() => goTo(step)}
                disabled={disabled}
                className={[
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150",
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : past
                      ? "text-slate-700 hover:bg-slate-100"
                      : disabled
                        ? "text-slate-300 cursor-not-allowed"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
                ].join(" ")}
              >
                {step.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Dossier actif indicator + Changer (unique endroit) */}
        {dossierId && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono truncate max-w-[160px]">
              {dossierId.length > 12
                ? `${dossierId.slice(0, 6)}…${dossierId.slice(-4)}`
                : dossierId}
            </span>
            <button
              type="button"
              onClick={() => navigate("/banque/dossiers")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150"
            >
              Changer de dossier
            </button>
          </div>
        )}
      </div>

      {/* ── Contenu page ── */}
      <Outlet />
    </div>
  );
}