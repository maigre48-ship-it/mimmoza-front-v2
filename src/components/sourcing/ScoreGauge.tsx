import React, { useMemo } from 'react';
import { getScoreColor, getScoreLevel } from '../../types/sourcing.types';

interface ScoreGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  label?: string;
}

const SIZE_CONFIG = {
  sm: { diameter: 64, strokeWidth: 5, fontSize: 'text-lg', labelSize: 'text-xs' },
  md: { diameter: 96, strokeWidth: 6, fontSize: 'text-2xl', labelSize: 'text-sm' },
  lg: { diameter: 140, strokeWidth: 8, fontSize: 'text-4xl', labelSize: 'text-base' },
  xl: { diameter: 180, strokeWidth: 10, fontSize: 'text-5xl', labelSize: 'text-lg' },
};

export const ScoreGauge: React.FC<ScoreGaugeProps> = ({ score, size = 'lg', showLabel = true, label }) => {
  const config = SIZE_CONFIG[size];
  const radius = (config.diameter - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(score, 0), 100) / 100;
  const strokeDashoffset = circumference * (1 - progress);
  const color = getScoreColor(score);
  const level = getScoreLevel(score);
  const levelLabels = { excellent: 'Excellent', good: 'Bon', average: 'Moyen', poor: 'Faible', bad: 'Mauvais' };
  const gradientId = useMemo(() => `score-gradient-${Math.random().toString(36).substr(2, 9)}`, []);

  return (
    <div className="relative inline-flex flex-col items-center">
      <svg width={config.diameter} height={config.diameter} viewBox={`0 0 ${config.diameter} ${config.diameter}`} className="transform -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <circle cx={config.diameter / 2} cy={config.diameter / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={config.strokeWidth} />
        <circle cx={config.diameter / 2} cy={config.diameter / 2} r={radius} fill="none" stroke={`url(#${gradientId})`} strokeWidth={config.strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${config.fontSize} font-bold`} style={{ color }}>{Math.round(score)}</span>
        {showLabel && <span className={`${config.labelSize} text-gray-500 font-medium`}>{label || levelLabels[level]}</span>}
      </div>
    </div>
  );
};

export default ScoreGauge;
