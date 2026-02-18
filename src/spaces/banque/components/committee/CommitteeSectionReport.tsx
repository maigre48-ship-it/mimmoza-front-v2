// src/spaces/banque/components/committee/CommitteeSectionReport.tsx
import React, { useState } from "react";

interface CommitteeData {
  decision: "GO" | "GO_AVEC_RESERVES" | "NO_GO" | null;
  confidence: number | null;
  totalScore: number | null;
  riskScore: number | null;
  riskDetails: { label: string; impact: number; detail?: string }[];
  markdown?: string | null;
}

export default function CommitteeSectionReport({
  operation,
  committee,
}: {
  operation: any;
  committee: CommitteeData;
}) {
  const [copied, setCopied] = useState(false);

  // Robust getter — try multiple paths for markdown
  const markdown: string | null =
    committee.markdown ??
    (operation as any)?.committee?.markdown ??
    (operation as any)?.committeeMarkdown ??
    (operation as any)?.committee?.committeeMarkdown ??
    (operation as any)?.committee?.smartscore?.markdown ??
    null;

  const handleCopy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = markdown;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <details className="group">
      <summary className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-900">📄 Rapport comité</span>
        <span className="text-xs text-gray-400 group-open:rotate-90 transition-transform">▶</span>
      </summary>

      <div className="mt-2 pl-1">
        {!markdown ? (
          <p className="text-sm text-gray-400 italic">
            Rapport indisponible — lancez l'enrichissement.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="bg-gray-50 rounded-lg p-3 max-h-[400px] overflow-y-auto">
              <div className="whitespace-pre-wrap text-xs text-gray-700 leading-relaxed font-mono">
                {markdown}
              </div>
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
            >
              {copied ? "✓ Copié !" : "📋 Copier le rapport"}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}