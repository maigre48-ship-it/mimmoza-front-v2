/**
 * SmartScoreCard Component
 * Carte compacte affichant le SmartScore pour les listes
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronRight, AlertTriangle } from 'lucide-react';
import { ScoreGauge } from './ScoreGauge';
import {
  getScoreLevel,
  getScoreColor,
  PROFILE_LABELS,
  SUB_SCORE_LABELS,
  type SmartScoreResult,
  type SubScoreKey,
} from '@/types/sourcing.types';

interface SmartScoreCardProps {
  score: SmartScoreResult;
  title?: string;
  subtitle?: string;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

const TOP_SUB_SCORES: SubScoreKey[] = ['value', 'location', 'liquidity'];

export const SmartScoreCard: React.FC<SmartScoreCardProps> = ({
  score,
  title,
  subtitle,
  onClick,
  selected = false,
  className = '',
}) => {
  const level = getScoreLevel(score.globalScore);
  const hasWarnings = score.warnings.length > 0;

  const TrendIcon = level === 'excellent' || level === 'good' 
    ? TrendingUp 
    : level === 'average' 
      ? Minus 
      : TrendingDown;

  const trendColor = level === 'excellent' || level === 'good'
    ? 'text-emerald-500'
    : level === 'average'
      ? 'text-amber-500'
      : 'text-red-500';

  return (
    <div
      onClick={onClick}
      className={`
        relative bg-white dark:bg-gray-800 rounded-xl border-2 overflow-hidden
        transition-all duration-200
        ${selected 
          ? 'border-blue-500 shadow-lg shadow-blue-500/20' 
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }
        ${onClick ? 'cursor-pointer hover:shadow-md' : ''}
        ${className}
      `}
    >
      <div className="p-4 flex items-center gap-4">
        <div className="flex-shrink-0">
          <ScoreGauge score={score.globalScore} size="md" showLabel={false} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {title && (
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                {title}
              </h3>
            )}
            <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {PROFILE_LABELS[score.profileTarget]}
            </span>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <TrendIcon size={14} className={trendColor} />
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {subtitle || score.globalRationale}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {TOP_SUB_SCORES.map((key) => {
              const subScore = score.subScores[key];
              const meta = SUB_SCORE_LABELS[key];
              const color = getScoreColor(subScore.value);
              
              return (
                <div
                  key={key}
                  className="flex items-center gap-1.5"
                  title={`${meta.label}: ${subScore.value}/100`}
                >
                  <span className="text-sm">{meta.icon}</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color }}>
                    {subScore.value}
                  </span>
                </div>
              );
            })}
            
            {hasWarnings && (
              <div
                className="flex items-center gap-1 text-amber-500"
                title={`${score.warnings.length} point(s) d'attention`}
              >
                <AlertTriangle size={14} />
                <span className="text-xs font-medium">{score.warnings.length}</span>
              </div>
            )}
          </div>
        </div>

        {onClick && (
          <ChevronRight size={20} className="flex-shrink-0 text-gray-400" />
        )}
      </div>

      <div className="h-1 bg-gray-100 dark:bg-gray-700">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: `${score.globalConfidence * 100}%` }}
        />
      </div>
    </div>
  );
};

export default SmartScoreCard;
