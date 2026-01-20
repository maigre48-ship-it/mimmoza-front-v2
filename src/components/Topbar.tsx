
import {
  Brain,
  Building2,
  Briefcase,
  Banknote,
  ShieldCheck,
  LayoutDashboard,
} from "lucide-react";

type Space =
  | "none"
  | "audit"
  | "promoteur"
  | "agence"
  | "marchand"
  | "banque"
  | "assurance";

export function Topbar({
  currentSpace,
  onChangeSpace,
}: {
  currentSpace: Space;
  onChangeSpace: (s: Space) => void;
}) {
  const spaces = [
    { id: "audit", label: "Audit", icon: Brain },
    { id: "promoteur", label: "Promoteur", icon: Building2 },
    { id: "agence", label: "Agence", icon: Briefcase },
    { id: "marchand", label: "Marchand", icon: Banknote },
    { id: "banque", label: "Banque", icon: ShieldCheck },
    { id: "assurance", label: "Assurance", icon: LayoutDashboard },
  ];

  return (
    <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-40">
      {/* Barre principale */}
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        {/* Logo / nom */}
        <button
          onClick={() => onChangeSpace("none")}
          className="flex items-center gap-3"
        >
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow text-white text-xl font-bold">
            M
          </div>

          <div className="flex flex-col text-left">
            <span className="text-xl font-semibold text-slate-900">
              Mimmoza
            </span>
            <span className="text-xs text-slate-600 -mt-0.5">
              Lâ€™intelligence immobiliÃ¨re
            </span>
          </div>
        </button>

        <div className="text-xs text-slate-500 hidden sm:block">
          PLU Engine â€” Prototype local
        </div>
      </div>

      {/* Barre secondaire : espaces */}
      {currentSpace !== "none" && (
        <div className="border-t border-slate-100 bg-slate-50 overflow-x-auto">
          <div className="mx-auto max-w-7xl px-4 py-2 flex gap-2">
            {spaces.map((s) => {
              const Icon = s.icon;
              const active = currentSpace === s.id;

              return (
                <button
                  key={s.id}
                  onClick={() => onChangeSpace(s.id)}
                  className={[
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all",
                    active
                      ? "bg-white shadow border border-slate-200"
                      : "text-slate-600 hover:bg-white/60",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}

