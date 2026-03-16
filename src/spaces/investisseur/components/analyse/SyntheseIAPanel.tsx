// SyntheseIAPanel.tsx
// ─────────────────────────────────────────────────────────────────────
// v6.1 (PDF-only UX + export context passthrough, FIX context merge):
// - Toujours PDF-only (pas de viewer)
// - Conserve EXACTEMENT l’action d’export existante via onExportPdf(markdown)
// - ✅ Transmet un "exportContext" optionnel à onExportPdf(markdown, exportContext)
// - ✅ Peut récupérer un context depuis onGenerate() si onGenerate renvoie { markdown, context }
// - ✅ FIX: merge context (prop + generated) au lieu d’écraser, pour éviter de perdre wikimedia
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";

type GenerateResult = {
  markdown: string;
  context?: Record<string, unknown>; // ✅ ex: { wikimedia: ... }
};
type GenerateReturn = GenerateResult | string | null | undefined;

type SyntheseIAPanelProps = {
  dealLabel?: string;
  isAvailable?: boolean;

  /**
   * Optionnel : peut renvoyer soit une string markdown, soit { markdown, context }
   * - context permet de transmettre des infos (ex: wikimedia) jusqu’à l’export PDF.
   */
  onGenerate?: () => Promise<GenerateReturn> | GenerateReturn;

  /**
   * Export PDF (handler parent).
   * ✅ Non-breaking: le 2e param est optionnel, un handler (markdown) reste compatible.
   */
  onExportPdf?: (markdown: string, exportContext?: Record<string, unknown>) => void;

  /**
   * Optionnel : contexte déjà disponible côté parent (ex: { wikimedia: response.computed.wikimedia }).
   * Sera transmis à onExportPdf(markdown, exportContext).
   */
  exportContext?: Record<string, unknown>;
};

interface ProgressDetail {
  pct: number;
  label: string;
}

const PROGRESS_EVENT = "mimmoza:synthese:progress";
const INITIAL_PROGRESS: ProgressDetail = { pct: 0, label: "" };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function extractMarkdown(out: GenerateReturn): string | null {
  if (typeof out === "string") return out;
  if (
    out &&
    typeof out === "object" &&
    typeof (out as { markdown?: unknown }).markdown === "string"
  ) {
    return (out as { markdown: string }).markdown;
  }
  return null;
}

function extractContext(out: GenerateReturn): Record<string, unknown> | null {
  if (!out || typeof out !== "object") return null;
  const ctx = (out as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return null;
  return ctx as Record<string, unknown>;
}

function mergeContext(
  base: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!base && !next) return null;
  if (!base) return next;
  if (!next) return base;
  // next wins on key conflict (so latest context overrides)
  return { ...base, ...next };
}

type Status = "idle" | "loading" | "success" | "error";

export default function SyntheseIAPanel({
  dealLabel = "Nouveau deal",
  isAvailable = false,
  onGenerate,
  onExportPdf,
  exportContext: exportContextProp,
}: SyntheseIAPanelProps) {
  const disabled = !isAvailable;

  const [status, setStatus] = useState<Status>("idle");
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressDetail>(INITIAL_PROGRESS);

  // ✅ Local export context (can be hydrated from onGenerate result)
  const [exportContext, setExportContext] = useState<Record<string, unknown> | null>(
    exportContextProp ?? null,
  );

  // Keep local exportContext in sync if parent updates it (MERGE to avoid losing keys)
  useEffect(() => {
    setExportContext((prev) => mergeContext(prev, exportContextProp ?? null));
  }, [exportContextProp]);

  // ─── Progress listener (optionnel) ────────────────────────────────
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<ProgressDetail>).detail;
      if (!detail) return;

      const rawPct = typeof detail.pct === "number" ? detail.pct : 0;
      const rawLabel = typeof detail.label === "string" ? detail.label : "";

      setProgress({
        pct: clamp(Math.round(rawPct), 0, 100),
        label: rawLabel,
      });
    }

    window.addEventListener(PROGRESS_EVENT, handler);
    return () => window.removeEventListener(PROGRESS_EVENT, handler);
  }, []);

  const canGenerate = !disabled && typeof onGenerate === "function";
  const canExport =
    typeof onExportPdf === "function" &&
    typeof markdown === "string" &&
    markdown.trim().length > 0;

  async function handleGenerate(): Promise<void> {
    if (disabled) return;

    if (!onGenerate) {
      setStatus("error");
      setErrorMsg("Génération non branchée (onGenerate manquant).");
      return;
    }

    setProgress(INITIAL_PROGRESS);
    setStatus("loading");
    setErrorMsg(null);

    try {
      const out = await onGenerate();
      const md = extractMarkdown(out);

      if (!md || md.trim().length === 0) {
        throw new Error("Réponse invalide: contenu manquant.");
      }

      // ✅ If generator provides context (e.g., wikimedia), store it for export (MERGE)
      const ctx = extractContext(out);
      if (ctx) {
        setExportContext((prev) => mergeContext(prev, ctx));
      }

      setMarkdown(md);
      setStatus("success");
      setProgress(INITIAL_PROGRESS);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Erreur lors de la génération.";
      setStatus("error");
      setErrorMsg(message);
      setProgress(INITIAL_PROGRESS);
    }
  }

  function handleDownload(): void {
    if (!onExportPdf) return;
    if (!markdown || markdown.trim().length === 0) return;
    // IMPORTANT: déclenche EXACTEMENT la même action que l’ancien bouton "Exporter PDF"
    // ✅ + transmet (optionnellement) le contexte d’export (ex: wikimedia)
    onExportPdf(markdown, exportContext ?? undefined);
  }

  // "Actualiser" discret : on conserve l’intention d’update sans viewer -> relance une génération
  function handleRefresh(): void {
    if (!canGenerate) return;
    void handleGenerate();
  }

  const pill = disabled ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-purple-50 text-purple-700 border-purple-200">
      ✨ Bientôt disponible
    </span>
  ) : status === "loading" ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-gray-100 text-gray-700 border-gray-200">
      ⏳ Génération…
    </span>
  ) : status === "error" ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-red-50 text-red-700 border-red-200">
      ❌ Erreur
    </span>
  ) : status === "success" ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
      ✅ PDF prêt
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-gray-50 text-gray-700 border-gray-200">
      📄 PDF
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-lg">
            🤖
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Synthèse IA</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Dossier investisseur pour{" "}
              <span className="font-semibold text-gray-700">{dealLabel}</span>
            </p>
          </div>
        </div>
        {pill}
      </div>

      {/* Content (PDF-only) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-6">
        {/* Loading */}
        {status === "loading" && (
          <div className="space-y-5">
            <div className="animate-pulse space-y-3">
              <div className="h-6 bg-gray-100 rounded w-1/3" />
              <div className="h-4 bg-gray-100 rounded w-2/3" />
              <div className="h-10 bg-gray-100 rounded-xl w-full" />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">
                {progress.label && progress.pct > 0
                  ? `${progress.label} (${progress.pct}%)`
                  : "Génération en cours…"}
              </span>
              <span className="text-gray-400">Veuillez patienter</span>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <div>
              <p className="text-sm font-semibold text-red-700">Analyse indisponible</p>
              <p className="text-sm text-red-600 mt-1">{errorMsg ?? "Erreur inconnue."}</p>
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={[
                "shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                canGenerate
                  ? "bg-purple-600 text-white hover:bg-purple-700"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed",
              ].join(" ")}
            >
              🔄 Réessayer
            </button>
          </div>
        )}

        {/* Success (PDF ready) */}
        {status === "success" && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Votre analyse est prête à être téléchargée en PDF.
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Téléchargez le dossier investisseur (6–8 pages) pour lecture/partage.
                  </p>
                </div>

                <span className="hidden sm:inline-flex items-center gap-2 rounded-full bg-white border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
                  ✅ PDF prêt
                </span>
              </div>

              <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!canExport}
                  className={[
                    "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors",
                    canExport
                      ? "bg-purple-600 text-white hover:bg-purple-700"
                      : "bg-gray-200 text-gray-500 cursor-not-allowed",
                  ].join(" ")}
                >
                  📥 Télécharger le PDF
                </button>

                {/* Actions secondaires conservées (discrètes) */}
                <div className="flex items-center gap-3 sm:ml-auto">
                  {canGenerate && (
                    <button
                      type="button"
                      onClick={handleRefresh}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-800"
                      aria-label="Actualiser"
                    >
                      🔁 Actualiser
                    </button>
                  )}

                  {canGenerate && (
                    <button
                      type="button"
                      onClick={handleGenerate}
                      className="text-xs font-semibold text-purple-700 hover:text-purple-900"
                      aria-label="Régénérer"
                    >
                      🔄 Régénérer
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Idle / Not ready */}
        {status === "idle" && (
          <div className="text-center py-10">
            <p className="text-sm font-semibold text-gray-900">Analyse non disponible</p>
            <p className="text-sm text-gray-500 mt-1">
              Générez le dossier PDF pour le consulter et le partager.
            </p>

            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                disabled={!canGenerate}
                onClick={handleGenerate}
                className={[
                  "inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-colors",
                  canGenerate
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : disabled
                    ? "bg-purple-200 text-white/80 cursor-not-allowed"
                    : "bg-gray-200 text-gray-500 cursor-not-allowed",
                ].join(" ")}
              >
                ✨ Générer le PDF
              </button>

              {/* Si l’export était déjà possible (cas rare), on garde un accès */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={!canExport}
                className={[
                  "inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-colors border",
                  canExport
                    ? "bg-white text-gray-900 border-gray-200 hover:bg-gray-50"
                    : "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed",
                ].join(" ")}
              >
                📄 Télécharger le PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}