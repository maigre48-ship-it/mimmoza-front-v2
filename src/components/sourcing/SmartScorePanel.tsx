import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Clock, Hash, User, ChevronDown, ChevronUp, Lightbulb, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { ScoreGauge } from './ScoreGauge';
import { SubScoreBar } from './SubScoreBar';
import { SUB_SCORE_LABELS, PROFILE_LABELS, getScoreLevel, type SmartScoreResult, type SubScoreKey } from '../../types/sourcing.types';

interface SmartScorePanelProps {
  score: SmartScoreResult;
  hints?: string[];
  showMeta?: boolean;
  compact?: boolean;
}

const SUB_SCORE_ORDER: SubScoreKey[] = ['value', 'location', 'liquidity', 'worksRisk', 'dealStructure', 'legalUrbanism', 'risk'];

export const SmartScorePanel: React.FC<SmartScorePanelProps> = ({ score, hints = [], showMeta = true, compact = false }) => {
  const [showAllSubScores, setShowAllSubScores] = useState(!compact);
  const [showWarnings, setShowWarnings] = useState(false);
  const level = getScoreLevel(score.globalScore);
  const visibleSubScores = showAllSubScores ? SUB_SCORE_ORDER : SUB_SCORE_ORDER.slice(0, 3);

  const verdictConfig: Record<string, { icon: React.ReactNode; bg: string; border: string; text: string }> = {
    excellent: { icon: <CheckCircle className="text-emerald-500" size={24} />, bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
    good: { icon: <TrendingUp className="text-green-500" size={24} />, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
    average: { icon: <Minus className="text-amber-500" size={24} />, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
    poor: { icon: <TrendingDown className="text-orange-500" size={24} />, bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
    bad: { icon: <XCircle className="text-red-500" size={24} />, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
  };
  const verdict = verdictConfig[level];

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="flex-shrink-0"><ScoreGauge score={score.globalScore} size="xl" /></div>
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-2xl font-bold text-white mb-2">SmartScore</h2>
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${verdict.bg} ${verdict.border} border mb-3`}>
              {verdict.icon}
              <span className={`font-semibold ${verdict.text}`}>{score.globalRationale}</span>
            </div>
            <div className="flex items-center justify-center sm:justify-start gap-2 text-slate-400">
              <User size={16} />
              <span className="text-sm">Profil: <span className="text-white font-medium">{PROFILE_LABELS[score.profileTarget]}</span></span>
            </div>
            <div className="mt-2 flex items-center justify-center sm:justify-start gap-2">
              <div className="h-1.5 w-24 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${score.globalConfidence * 100}%` }} />
              </div>
              <span className="text-xs text-slate-400">Confiance: {Math.round(score.globalConfidence * 100)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {score.warnings.length > 0 && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
          <button onClick={() => setShowWarnings(!showWarnings)} className="w-full flex items-center justify-between text-left">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle size={18} />
              <span className="font-medium text-sm">{score.warnings.length} point{score.warnings.length > 1 ? 's' : ''} d'attention</span>
            </div>
            {showWarnings ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showWarnings && (
            <ul className="mt-3 space-y-1">
              {score.warnings.map((w, i) => <li key={i} className="text-sm text-amber-600 pl-6 relative before:content-['•'] before:absolute before:left-2">{w.replace(/^\[.*?\]\s*/, '')}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Hints */}
      {hints.length > 0 && (
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-200">
          <div className="flex items-start gap-2">
            <Lightbulb size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-blue-700 mb-1">Pour améliorer la précision :</p>
              <ul className="text-sm text-blue-600 space-y-0.5">
                {hints.slice(0, 3).map((h, i) => <li key={i} className="pl-4 relative before:content-['?'] before:absolute before:left-0">{h}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Sub-scores */}
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Détail par critère</h3>
        <div className="space-y-3">
          {visibleSubScores.map((key) => {
            const subScore = score.subScores[key];
            const meta = SUB_SCORE_LABELS[key];
            return <SubScoreBar key={key} label={meta.label} icon={meta.icon} subScore={subScore} />;
          })}
        </div>
        {compact && SUB_SCORE_ORDER.length > 3 && (
          <button onClick={() => setShowAllSubScores(!showAllSubScores)} className="mt-4 w-full py-2 text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1">
            {showAllSubScores ? <><ChevronUp size={16} />Voir moins</> : <><ChevronDown size={16} />Voir tous les critères ({SUB_SCORE_ORDER.length - 3} de plus)</>}
          </button>
        )}
      </div>

      {/* Penalties */}
      {score.penaltiesApplied.length > 0 && (
        <div className="px-6 pb-4">
          <div className="p-3 bg-red-50 rounded-lg border border-red-200">
            <h4 className="text-sm font-semibold text-red-700 mb-2">Pénalités appliquées</h4>
            <ul className="space-y-1">
              {score.penaltiesApplied.map((p, i) => <li key={i} className="flex justify-between text-sm"><span className="text-red-600">{p.reason}</span><span className="font-bold text-red-700">{p.points} pts</span></li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Meta */}
      {showMeta && (
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5"><Hash size={12} /><span className="font-mono">{score.inputHash}</span></div>
          <div className="flex items-center gap-1.5"><Clock size={12} /><span>{new Date(score.computedAt).toLocaleString('fr-FR')}</span></div>
          <div className="ml-auto"><span className="font-medium">v{score.version}</span></div>
        </div>
      )}
    </div>
  );
};

export default SmartScorePanel;
