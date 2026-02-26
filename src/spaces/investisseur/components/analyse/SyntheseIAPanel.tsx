// SyntheseIAPanel.tsx
// ─────────────────────────────────────────────────────────────────────
// v3 changelog:
// - Prop optionnelle onExportPdf?: (markdown) => void
// - Bouton "📄 Exporter PDF" affiché à côté de "Régénérer" quand
//   status === success + onExportPdf fourni
//
// v2:
// - Ajout barre de progression via event mimmoza:synthese:progress
// - State interne { pct, label } écouté depuis window CustomEvent
// - Barre Tailwind violette animée (transition smooth, % affiché)
// - Reset propre au lancement / succès / erreur
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from "react";

type GenerateResult = { markdown: string };
type GenerateReturn = GenerateResult | string | null | undefined;

type SyntheseIAPanelProps = {
  dealLabel?: string;
  isAvailable?: boolean;
  onGenerate?: () => Promise<GenerateReturn> | GenerateReturn;
  onExportPdf?: (markdown: string) => void;
};

const ITEMS = [
  { icon: "💰", label: "Rentabilité & scénarios optimaux" },
  { icon: "📋", label: "Points bloquants Due Diligence" },
  { icon: "📊", label: "Positionnement marché local" },
  { icon: "⚠️", label: "Risques majeurs & mitigations" },
  { icon: "🎯", label: "Recommandation go/no-go" },
  { icon: "💬", label: "Points de négociation suggérés" },
];

function Pill({
  children,
  tone = "purple",
}: {
  children: React.ReactNode;
  tone?: "purple" | "gray" | "green" | "red";
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "gray"
      ? "bg-gray-100 text-gray-600 border-gray-200"
      : tone === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-purple-50 text-purple-700 border-purple-200";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {children}
    </span>
  );
}

/** Mini renderer markdown simple */
function SimpleMarkdown({ markdown }: { markdown: string }) {
  const lines = useMemo(() => markdown.split("\n"), [markdown]);

  const blocks: Array<{ type: "h3" | "li" | "p" | "sp"; text?: string }> = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ type: "sp" });
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "h3", text: line.replace(/^##\s+/, "") });
      continue;
    }
    if (line.startsWith("- ")) {
      blocks.push({ type: "li", text: line.replace(/^-+\s+/, "") });
      continue;
    }
    blocks.push({ type: "p", text: line });
  }

  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];

    if (b.type === "sp") {
      i++;
      continue;
    }

    if (b.type === "h3") {
      out.push(
        <h3 key={`h-${i}`} className="text-sm font-bold text-gray-900 mt-4">
          {b.text}
        </h3>
      );
      i++;
      continue;
    }

    if (b.type === "li") {
      const lis: string[] = [];
      while (i < blocks.length && blocks[i].type === "li") {
        lis.push(blocks[i].text ?? "");
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1 mt-2">
          {lis.map((t, idx) => (
            <li key={idx} className="text-sm text-gray-700">
              {t}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (b.type === "p") {
      out.push(
        <p key={`p-${i}`} className="text-sm text-gray-700 mt-2 leading-relaxed">
          {b.text}
        </p>
      );
      i++;
      continue;
    }

    i++;
  }

  return <div>{out}</div>;
}

function extractMarkdown(out: GenerateReturn): string | null {
  if (typeof out === "string") return out;
  if (out && typeof out === "object" && typeof (out as any).markdown === "string") {
    return (out as any).markdown;
  }
  return null;
}

// ─── Progress event type ─────────────────────────────────────────────

interface ProgressDetail {
  pct: number;
  label: string;
}

const PROGRESS_EVENT = "mimmoza:synthese:progress";
const INITIAL_PROGRESS: ProgressDetail = { pct: 0, label: "" };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Component ───────────────────────────────────────────────────────

export default function SyntheseIAPanel({
  dealLabel = "Nouveau deal",
  isAvailable = false,
  onGenerate,
  onExportPdf,
}: SyntheseIAPanelProps) {
  const disabled = !isAvailable;

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // v2: progress state driven by CustomEvent
  const [progress, setProgress] = useState<ProgressDetail>(INITIAL_PROGRESS);

  // v2: listen to progress events
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || typeof detail !== "object") return;

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

  async function handleGenerate() {
    if (disabled) return;

    if (!onGenerate) {
      setStatus("error");
      setErrorMsg("Génération non branchée (onGenerate manquant).");
      return;
    }

    // v2: reset progress on start
    setProgress(INITIAL_PROGRESS);
    setStatus("loading");
    setErrorMsg(null);

    try {
      const out = await onGenerate();
      console.log("[SyntheseIA] onGenerate() raw result:", out);

      const md = extractMarkdown(out);

      if (!md || md.trim().length === 0) {
        throw new Error("Réponse invalide: markdown manquant (onGenerate doit retourner une string ou { markdown }).");
      }

      setMarkdown(md);
      setStatus("success");
      setProgress(INITIAL_PROGRESS); // v2: reset on success
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message ? String(e.message) : "Erreur lors de la génération.");
      setProgress(INITIAL_PROGRESS); // v2: reset on error
    }
  }

  const pill = disabled
    ? <Pill tone="purple">✨ Bientôt disponible</Pill>
    : status === "loading"
    ? <Pill tone="gray">⏳ Génération…</Pill>
    : status === "error"
    ? <Pill tone="red">❌ Erreur</Pill>
    : status === "success"
    ? <Pill tone="green">✅ Générée</Pill>
    : <Pill tone="green">✅ Disponible</Pill>;

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
              Analyse complète générée par intelligence artificielle pour{" "}
              <span className="font-semibold text-gray-700">{dealLabel}</span>
            </p>
          </div>
        </div>
        {pill}
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <p className="text-sm text-gray-600">La synthèse IA analysera automatiquement:</p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {ITEMS.map((it) => (
              <div
                key={it.label}
                className="flex items-center gap-3 bg-gray-50/70 border border-gray-100 rounded-xl px-4 py-3"
              >
                <span className="text-lg">{it.icon}</span>
                <span className="text-sm text-gray-800">{it.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-10">
          {status === "idle" && (
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                📄
              </div>

              <h3 className="text-base font-semibold text-gray-800">
                La synthèse apparaîtra ici une fois générée.
              </h3>
              <p className="text-sm text-gray-500 mt-2 max-w-xl">
                Elle combinera les données de rentabilité, due diligence, marché et risques en un rapport actionnable.
              </p>

              <div className="mt-6">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={handleGenerate}
                  className={[
                    "inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-colors",
                    disabled
                      ? "bg-purple-200 text-white/80 cursor-not-allowed"
                      : "bg-purple-600 text-white hover:bg-purple-700",
                  ].join(" ")}
                >
                  ✨ Générer la synthèse
                </button>
              </div>
            </div>
          )}

          {/* ── v2: Loading with progress bar ──────────────────────── */}
          {status === "loading" && (
            <div className="flex flex-col items-center text-center py-8 w-full max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
                ⏳
              </div>

              <p className="text-sm font-semibold text-gray-800">
                {progress.label || "Génération en cours…"}
              </p>
              <p className="text-xs text-gray-500 mt-1 mb-4">
                Nous compilons rentabilité, due diligence, marché et risques.
              </p>

              {/* Progress bar */}
              <div className="w-full flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-500 tabular-nums w-9 text-right">
                  {progress.pct}%
                </span>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-700">Erreur</p>
              <p className="text-sm text-red-600 mt-1">{errorMsg ?? "Erreur inconnue"}</p>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700"
                >
                  🔄 Réessayer
                </button>
              </div>
            </div>
          )}

          {status === "success" && markdown && (
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-gray-900">🧠 Synthèse IA</h3>
                <div className="flex items-center gap-3">
                  {onExportPdf && (
                    <button
                      type="button"
                      onClick={() => onExportPdf(markdown)}
                      className="text-xs font-semibold text-gray-600 hover:text-gray-900"
                    >
                      📄 Exporter PDF
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerate}
                    className="text-xs font-semibold text-purple-700 hover:text-purple-900"
                  >
                    🔄 Régénérer
                  </button>
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl p-5 bg-white">
                <SimpleMarkdown markdown={markdown} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}