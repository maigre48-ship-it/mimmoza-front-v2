// ============================================================================
// BanqueLayout.tsx — Layout unique espace Banque (FIXED v3)
// ============================================================================
// Navigation LIBRE entre tous les onglets.
// dossierId résolu depuis 2 sources (priorité URL > store).
// Aucun disabled basé sur complétude/validation/étape.
// Seul cas de fallback: needsId && aucun dossierId nulle part → Pipeline.
// ✅ REDESIGN: Financeur visual tokens applied (GRAD_FIN / ACCENT_FIN).
// ============================================================================

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  readBanqueSnapshot,
  selectActiveDossierId,
} from "../store/banqueSnapshot.store";

// ── Design tokens Financeur ──
const GRAD_FIN = "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
const ACCENT_FIN = "#1a7a50";

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
      {/* ── Tab bar ── */}
      <div
        className="flex items-center gap-2 mb-6 pb-4"
        style={{ borderBottom: "1px solid #c0e8d4" }}
      >
        <div className="flex items-center gap-1">
          {STEPS.map((step, idx) => {
            const active = isActive(step.path);
            const past = currentIdx >= 0 && idx < currentIdx;

            if (active) {
              return (
                <button
                  key={step.path}
                  type="button"
                  onClick={() => goTo(step)}
                  style={{
                    background: GRAD_FIN,
                    color: "white",
                    border: "none",
                    borderRadius: 9,
                    padding: "7px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 1px 4px rgba(38,166,154,0.25)",
                    transition: "opacity 0.15s",
                  }}
                >
                  {step.label}
                </button>
              );
            }

            return (
              <button
                key={step.path}
                type="button"
                onClick={() => goTo(step)}
                className={[
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150",
                  past
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
            <span className="text-xs font-mono truncate max-w-[160px]" style={{ color: "#9ed4bc" }}>
              {dossierId.length > 12
                ? `${dossierId.slice(0, 6)}…${dossierId.slice(-4)}`
                : dossierId}
            </span>
            <button
              type="button"
              onClick={() => navigate("/banque/dossiers")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={{
                border: "1px solid #9ed4bc",
                color: ACCENT_FIN,
                background: "white",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(38,166,154,0.06)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "white";
              }}
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