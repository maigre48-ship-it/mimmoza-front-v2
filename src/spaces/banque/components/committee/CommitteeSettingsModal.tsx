import React, { useMemo, useState } from "react";

export type CommitteeScoringSettings = {
  goThreshold: number;        // default 70
  reserveThreshold: number;   // default 40
  topDetailsCount: number;    // default 5 (BPE details shown)
  showInsights: boolean;      // default true
};

export const COMMITTEE_SETTINGS_STORAGE_KEY = "banque_committee_scoring_settings";

export function getDefaultCommitteeSettings(): CommitteeScoringSettings {
  return {
    goThreshold: 70,
    reserveThreshold: 40,
    topDetailsCount: 5,
    showInsights: true,
  };
}

export function loadCommitteeSettings(): CommitteeScoringSettings {
  try {
    const raw = localStorage.getItem(COMMITTEE_SETTINGS_STORAGE_KEY);
    if (!raw) return getDefaultCommitteeSettings();
    const parsed = JSON.parse(raw);

    const d = getDefaultCommitteeSettings();
    const next: CommitteeScoringSettings = {
      goThreshold: typeof parsed?.goThreshold === "number" ? parsed.goThreshold : d.goThreshold,
      reserveThreshold: typeof parsed?.reserveThreshold === "number" ? parsed.reserveThreshold : d.reserveThreshold,
      topDetailsCount: typeof parsed?.topDetailsCount === "number" ? parsed.topDetailsCount : d.topDetailsCount,
      showInsights: typeof parsed?.showInsights === "boolean" ? parsed.showInsights : d.showInsights,
    };

    // clamp & sanity
    next.goThreshold = Math.max(0, Math.min(100, Math.round(next.goThreshold)));
    next.reserveThreshold = Math.max(0, Math.min(100, Math.round(next.reserveThreshold)));
    next.topDetailsCount = Math.max(0, Math.min(10, Math.round(next.topDetailsCount)));

    // ensure reserve <= go
    if (next.reserveThreshold > next.goThreshold) {
      next.reserveThreshold = Math.max(0, next.goThreshold - 1);
    }

    return next;
  } catch {
    return getDefaultCommitteeSettings();
  }
}

export function saveCommitteeSettings(s: CommitteeScoringSettings) {
  try {
    localStorage.setItem(COMMITTEE_SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export default function CommitteeSettingsModal({
  value,
  onSave,
  onClose,
}: {
  value: CommitteeScoringSettings;
  onSave: (v: CommitteeScoringSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CommitteeScoringSettings>({ ...value });

  const isValid = useMemo(() => {
    if (draft.goThreshold < 0 || draft.goThreshold > 100) return false;
    if (draft.reserveThreshold < 0 || draft.reserveThreshold > 100) return false;
    if (draft.reserveThreshold > draft.goThreshold) return false;
    if (draft.topDetailsCount < 0 || draft.topDetailsCount > 10) return false;
    return true;
  }, [draft]);

  const handleReset = () => setDraft(getDefaultCommitteeSettings());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">⚙️ Paramètres comité</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Seuils de lecture du score risque + options d’affichage. (UI uniquement)
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-gray-700 mb-2">Seuils “pré-filtre risques”</p>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-40 shrink-0">Seuil GO (≥)</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.goThreshold}
                  onChange={(e) =>
                    setDraft((p) => {
                      const v = parseInt(e.target.value, 10) || 0;
                      return { ...p, goThreshold: v, reserveThreshold: Math.min(p.reserveThreshold, v - 1) };
                    })
                  }
                  className="flex-1 accent-indigo-600"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.goThreshold}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    setDraft((p) => ({ ...p, goThreshold: v, reserveThreshold: Math.min(p.reserveThreshold, v - 1) }));
                  }}
                  className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-40 shrink-0">Seuil réserves (≥)</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.reserveThreshold}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    setDraft((p) => ({ ...p, reserveThreshold: Math.min(v, p.goThreshold - 1) }));
                  }}
                  className="flex-1 accent-indigo-600"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.reserveThreshold}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    setDraft((p) => ({ ...p, reserveThreshold: Math.min(v, p.goThreshold - 1) }));
                  }}
                  className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                />
              </div>

              <p className="text-xs text-gray-500">
                Lecture: ≥{draft.goThreshold} = <span className="font-semibold">Faible</span>,{" "}
                {draft.reserveThreshold}–{draft.goThreshold - 1} = <span className="font-semibold">Modéré</span>,{" "}
                &lt;{draft.reserveThreshold} = <span className="font-semibold">Élevé</span>.
              </p>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-3">
            <p className="text-xs font-semibold text-gray-700">Affichage marché</p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Afficher Insights</span>
              <button
                onClick={() => setDraft((p) => ({ ...p, showInsights: !p.showInsights }))}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  draft.showInsights ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"
                }`}
              >
                {draft.showInsights ? "Activé" : "Désactivé"}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-40 shrink-0">Top détails (BPE)</label>
              <input
                type="range"
                min={0}
                max={10}
                value={draft.topDetailsCount}
                onChange={(e) => setDraft((p) => ({ ...p, topDetailsCount: parseInt(e.target.value, 10) || 0 }))}
                className="flex-1 accent-indigo-600"
              />
              <input
                type="number"
                min={0}
                max={10}
                value={draft.topDetailsCount}
                onChange={(e) => setDraft((p) => ({ ...p, topDetailsCount: parseInt(e.target.value, 10) || 0 }))}
                className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Réinitialiser
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={() => {
              if (!isValid) return;
              onSave(draft);
              onClose();
            }}
            disabled={!isValid}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
