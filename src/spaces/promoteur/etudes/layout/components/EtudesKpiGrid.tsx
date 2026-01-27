// FILE: src/spaces/promoteur/etudes/layout/components/EtudesKpiGrid.tsx

import { FC } from 'react';
import type { EtudesKpiGridProps, KpiItem, KpiTrend } from '../etudesLayout.types';

const TrendIcon: FC<{ trend: KpiTrend; className?: string }> = ({
  trend,
  className = '',
}) => {
  if (trend === 'up') {
    return (
      <svg
        className={`w-4 h-4 text-emerald-500 ${className}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 17a.75.75 0 01-.75-.75V5.56l-2.72 2.72a.75.75 0 11-1.06-1.06l4-4a.75.75 0 011.06 0l4 4a.75.75 0 11-1.06 1.06l-2.72-2.72v10.69A.75.75 0 0110 17z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg
        className={`w-4 h-4 text-red-500 ${className}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 3a.75.75 0 01.75.75v10.69l2.72-2.72a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 111.06-1.06l2.72 2.72V3.75A.75.75 0 0110 3z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      className={`w-4 h-4 text-slate-400 ${className}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z"
        clipRule="evenodd"
      />
    </svg>
  );
};

const trendTextColor: Record<KpiTrend, string> = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  neutral: 'text-slate-500',
};

const sizeStyles = {
  sm: { card: 'p-3', label: 'text-xs', value: 'text-lg', unit: 'text-xs' },
  md: { card: 'p-4', label: 'text-xs', value: 'text-xl', unit: 'text-sm' },
  lg: { card: 'p-5', label: 'text-sm', value: 'text-2xl', unit: 'text-sm' },
};

const columnStyles: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4',
};

const KpiCard: FC<{ item: KpiItem; size: 'sm' | 'md' | 'lg' }> = ({
  item,
  size,
}) => {
  const styles = sizeStyles[size];

  if (item.loading) {
    return (
      <div
        className={`bg-white border border-slate-200 rounded-lg ${styles.card} animate-pulse`}
        aria-busy="true"
        aria-label={`Chargement de ${item.label}`}
      >
        <div className="h-3 bg-slate-200 rounded w-2/3 mb-3" />
        <div className="h-6 bg-slate-200 rounded w-1/2" />
      </div>
    );
  }

  if (item.error) {
    return (
      <div
        className={`bg-red-50 border border-red-200 rounded-lg ${styles.card}`}
        role="alert"
      >
        <p className={`${styles.label} font-medium text-slate-600 mb-1`}>
          {item.label}
        </p>
        <p className="text-sm text-red-600">Erreur de chargement</p>
      </div>
    );
  }

  return (
    <div
      className={`
        bg-white border border-slate-200 rounded-lg ${styles.card}
        hover:border-slate-300 hover:shadow-sm transition-all
      `}
    >
      <p
        className={`${styles.label} font-medium text-slate-500 uppercase tracking-wide mb-1`}
      >
        {item.label}
      </p>
      <div className="flex items-baseline gap-1.5">
        <span className={`${styles.value} font-semibold text-slate-900`}>
          {item.value}
        </span>
        {item.unit && (
          <span className={`${styles.unit} text-slate-500`}>{item.unit}</span>
        )}
      </div>
      {item.trend && item.trendValue && (
        <div className="flex items-center gap-1 mt-2">
          <TrendIcon trend={item.trend} />
          <span className={`text-xs font-medium ${trendTextColor[item.trend]}`}>
            {item.trendValue}
          </span>
        </div>
      )}
      {item.description && (
        <p className="text-xs text-slate-400 mt-2 line-clamp-2">
          {item.description}
        </p>
      )}
    </div>
  );
};

export const EtudesKpiGrid: FC<EtudesKpiGridProps> = ({
  items,
  columns = 2,
  size = 'md',
  className = '',
}) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`grid gap-3 ${columnStyles[columns]} ${className}`}
      role="list"
      aria-label="Indicateurs clés"
    >
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <KpiCard item={item} size={size} />
        </div>
      ))}
    </div>
  );
};

export default EtudesKpiGrid;