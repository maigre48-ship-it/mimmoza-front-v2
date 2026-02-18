import React, { useMemo, useState } from "react";
import CommitteeOverview from "./CommitteeOverview";
import CommitteeSectionLocalization from "./CommitteeSectionLocalization";
import CommitteeSectionRisks from "./CommitteeSectionRisks";
import CommitteeSectionMarket from "./CommitteeSectionMarket";
import CommitteeDevRaw from "./CommitteeDevRaw";

import CommitteeSettingsModal, {
  loadCommitteeSettings,
  saveCommitteeSettings,
  type CommitteeScoringSettings,
} from "./CommitteeSettingsModal";

interface CommitteeData {
  decision: "GO" | "GO_AVEC_RESERVES" | "NO_GO" | null;
  confidence: number | null;
  totalScore: number | null;
  riskScore: number | null;
  riskDetails: { label: string; impact: number; detail?: string }[];
  markdown?: string | null;
}

export default function CommitteePanel({
  operation,
  committee,
  enrichSources,
  enrichedAt,
}: {
  operation: any;
  committee: CommitteeData;
  enrichSources?: string[];
  enrichedAt?: string | null;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<CommitteeScoringSettings>(() => loadCommitteeSettings());

  const handleSave = (s: CommitteeScoringSettings) => {
    setSettings(s);
    saveCommitteeSettings(s);
  };

  const isGeoAuto = (operation as any)?.committee?.source === "geo-auto";

  const headerHint = useMemo(() => {
    if (isGeoAuto) return "⚡ Décision synthétisée depuis Géorisques — lancez l'enrichissement pour une analyse complète";
    if (enrichSources && enrichSources.length > 0) return `Sources: ${enrichSources.join(", ")}`;
    return null;
  }, [isGeoAuto, enrichSources]);

  return (
    <div className="space-y-4">
      {showSettings && (
        <CommitteeSettingsModal
          value={settings}
          onSave={handleSave}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Top row: overview + settings */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <CommitteeOverview committee={committee} />
          {headerHint && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
              {headerHint}
            </p>
          )}
        </div>

        {/* Gear */}
        <button
          onClick={() => setShowSettings(true)}
          className="w-9 h-9 mt-1 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Paramètres de notation comité"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>

      {/* Sections order: Localization FIRST */}
      <CommitteeSectionLocalization operation={operation} />
      <CommitteeSectionRisks operation={operation} committee={committee} settings={settings} />
      <CommitteeSectionMarket operation={operation} settings={settings} />

      {/* DEV raw */}
      {import.meta.env.DEV && (
        <CommitteeDevRaw operation={operation} committee={committee} />
      )}
    </div>
  );
}
