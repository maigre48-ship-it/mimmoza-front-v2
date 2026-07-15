// src/components/ui/ToastProvider.tsx
// Provider de toasts du module Agent commercial. Monté par AgentCommercialLayout,
// donc les toasts sont limités au module. Auto-fermeture après 4,5 s.

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { ToastContext } from "./toastContext";
import type { ToastApi, ToastItem, ToastKind } from "./toastContext";

const KIND_STYLES: Record<ToastKind, { border: string; icon: ReactNode }> = {
  success: {
    border: "border-emerald-200",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  },
  error: {
    border: "border-rose-200",
    icon: <AlertCircle className="h-5 w-5 text-rose-600" />,
  },
  info: {
    border: "border-sky-200",
    icon: <Info className="h-5 w-5 text-sky-600" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => {
          const style = KIND_STYLES[t.kind];
          return (
            <div
              key={t.id}
              className={[
                "pointer-events-auto flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 shadow-lg",
                style.border,
              ].join(" ")}
            >
              <span className="mt-0.5 shrink-0">{style.icon}</span>
              <p className="flex-1 text-sm text-slate-700">{t.message}</p>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
