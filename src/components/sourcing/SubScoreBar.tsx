import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { getScoreColor } from '../../types/sourcing.types';
import type { SubScore } from '../../types/sourcing.types';

interface SubScoreBarProps {
  label: string;
  icon: string;
  subScore: SubScore;
}

export const SubScoreBar: React.FC<SubScoreBarProps> = ({ label, icon, subScore }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const color = getScoreColor(subScore.value);
  const hasDetails = subScore.components.length > 0 || subScore.blockers.length > 0;
  const weightPercent = Math.round(subScore.weight * 100);
  const confidencePercent = Math.round(subScore.confidence * 100);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      <button
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        disabled={!hasDetails}
        className={`w-full px-4 py-3 flex items-center gap-3 text-left ${hasDetails ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'}`}
      >
        <span className="text-2xl flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-gray-900 truncate">{label}</span>
            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
              <span className="text-lg font-bold" style={{ color }}>{subScore.value}</span>
              <span className="text-xs text-gray-400">/ 100</span>
            </div>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${subScore.value}%`, backgroundColor: color }} />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span>Poids: {weightPercent}%</span>
            <span className="text-gray-300">•</span>
            <span>Confiance: {confidencePercent}%</span>
            {subScore.blockers.length > 0 && (
              <>
                <span className="text-gray-300">•</span>
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertTriangle size={12} />
                  {subScore.blockers.length} alerte{subScore.blockers.length > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>
        {hasDetails && <div className="flex-shrink-0 text-gray-400">{isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</div>}
      </button>

      {isExpanded && hasDetails && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50">
          <p className="text-sm text-gray-600 mb-3 flex items-start gap-2">
            <Info size={16} className="flex-shrink-0 mt-0.5 text-blue-500" />
            {subScore.rationale}
          </p>
          {subScore.components.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Détail des points</h4>
              <div className="space-y-2">
                {subScore.components.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-white rounded-lg border border-gray-100">
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.label}</p>
                      {c.rationale && <p className="text-xs text-gray-500 truncate">{c.rationale}</p>}
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">{c.inputUsed}</p>
                    </div>
                    <div className={`flex items-center gap-1 font-bold text-sm ${c.points >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      <span>{c.points >= 0 ? '+' : ''}{c.points}</span>
                      <span className="text-gray-400 font-normal">/ {c.maxPoints}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {subScore.blockers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Alertes</h4>
              <div className="space-y-2">
                {subScore.blockers.map((b, i) => (
                  <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border ${b.severity === 'critical' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                    {b.severity === 'critical' ? <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-500" /> : <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${b.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}`}>{b.label}</p>
                      <p className={`text-xs ${b.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>{b.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SubScoreBar;
