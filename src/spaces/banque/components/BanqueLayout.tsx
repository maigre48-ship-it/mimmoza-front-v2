// ============================================================================
// BanqueLayout.tsx — Layout unique espace Banque (FIXED v3)
// ============================================================================
// Navigation LIBRE entre tous les onglets.
// dossierId résolu depuis 2 sources (priorité URL > store).
// Aucun disabled basé sur complétude/validation/étape.
// Seul cas de fallback: needsId && aucun dossierId nulle part → Pipeline.
// ============================================================================

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  readBanqueSnapshot,
  selectActiveDossierId,
} from "../store/banqueSnapshot.store";

const STEPS = [
  { label: "Pipeline", path: "/banque/dossiers", needsId: false },
  { label: "Dossier",  path: "/banque/dossier",  needsId: true  },
  { label: "Analyse",  path: "/banque/analyse",  needsId: true  },
  { label: "Comité",   path: "/banque/comite",   needsId: true  },
] as const;

const ID_SEGMENTS = new Set(["dossier", "analyse", "comite"]);

/** Extrait le dossierId depuis le pathname (source 1 : URL) */
function extractDossierIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  // Ex: ["banque", "analyse", "abc123"]
  if (parts[0] !== "banque" || parts.length < 3) return null;
  if (ID_SEGMENTS.has(parts[1])) return parts[2] || null;
  return null;
}

/** Lit le dossierId actif depuis le store (source 2 : fallback) */
function readDossierIdFromStore(): string | null {
  try {
    const snap = readBanqueSnapshot();
    return selectActiveDossierId(snap) ?? null;
  } catch {
    return null;
  }
}

export default function BanqueLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  // ✅ Double source: URL d'abord, store ensuite
  const dossierIdFromUrl = extractDossierIdFromPath(location.pathname);
  const dossierIdFromStore = readDossierIdFromStore();
  const dossierId = dossierIdFromUrl ?? dossierIdFromStore;

  const goTo = (step: (typeof STEPS)[number]) => {
    if (step.needsId) {
      if (!dossierId) {
        // Aucun dossier nulle part → retour pipeline (seul cas de fallback)
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

  const currentIdx = STEPS.findIndex((s) => isActive(s.path));

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 border-b border-slate-200 pb-4 mb-6">
        {/* ── Onglets — toujours cliquables ── */}
        <div className="flex items-center gap-1">
          {STEPS.map((step, idx) => {
            const active = isActive(step.path);
            const past = currentIdx >= 0 && idx < currentIdx;
            return (
              <button
                key={step.path}
                type="button"
                onClick={() => goTo(step)}
                className={[
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150",
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : past
                      ? "text-slate-700 hover:bg-slate-100"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
                ].join(" ")}
              >
                {step.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* ── Dossier actif + Changer ── */}
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