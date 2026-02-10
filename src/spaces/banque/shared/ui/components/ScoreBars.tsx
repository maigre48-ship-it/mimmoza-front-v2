import type { BanqueSmartScore } from "../../types/banque.types";
import { scoreColor, scoreLabel } from "../../services/banqueSmartscore";

interface ScoreBarsProps { smartscore: BanqueSmartScore; }

export function ScoreBars({ smartscore }: ScoreBarsProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-4" style={{ borderColor: scoreColor(smartscore.global) }}>
          <div>
            <div className="text-2xl font-bold" style={{ color: scoreColor(smartscore.global) }}>{smartscore.global}</div>
            <div className="text-[10px] text-gray-500">/ 100</div>
          </div>
        </div>
        <p className="mt-2 text-sm font-medium" style={{ color: scoreColor(smartscore.global) }}>{scoreLabel(smartscore.global)}</p>
      </div>
      <div className="space-y-3">
        {smartscore.subscores.map((sub) => (
          <div key={sub.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-700">{sub.label}</span>
              <span className="text-xs text-gray-500">{sub.value}/100 <span className="text-[10px] text-gray-400">(×{(sub.weight * 100).toFixed(0)}%)</span></span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${sub.value}%`, backgroundColor: scoreColor(sub.value) }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{sub.justification}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return (<span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">N/A</span>);
  return (<span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: scoreColor(score), backgroundColor: `${scoreColor(score)}15` }}>{score}/100</span>);
}
