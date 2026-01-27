// FILE: src/spaces/promoteur/etudes/layout/components/EtudesEmptyState.tsx

import { FC } from 'react';
import type { EtudesEmptyStateProps, ActionVariant } from '../etudesLayout.types';

const variantStyles: Record<string, { container: string; icon: string }> = {
  default: {
    container: 'bg-slate-50 border-slate-200',
    icon: 'text-slate-400',
  },
  error: {
    container: 'bg-red-50 border-red-200',
    icon: 'text-red-400',
  },
  warning: {
    container: 'bg-amber-50 border-amber-200',
    icon: 'text-amber-500',
  },
  info: {
    container: 'bg-blue-50 border-blue-200',
    icon: 'text-blue-400',
  },
};

const buttonVariants: Record<ActionVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
  ghost:
    'text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:ring-slate-500',
};

const DefaultIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

export const EtudesEmptyState: FC<EtudesEmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryActions = [],
  variant = 'default',
  className = '',
}) => {
  const styles = variantStyles[variant];

  return (
    <div
      className={`
        flex flex-col items-center justify-center py-12 px-6
        border border-dashed rounded-lg text-center
        ${styles.container}
        ${className}
      `}
      role="status"
      aria-label={title}
    >
      {/* Icon */}
      <div className={`mb-4 ${styles.icon}`}>
        {icon ?? <DefaultIcon className={styles.icon} />}
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-slate-900 mb-1">{title}</h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-slate-500 max-w-sm mb-6">{description}</p>
      )}

      {/* Actions */}
      {(action || secondaryActions.length > 0) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={`
                inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
                rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
                ${buttonVariants[action.variant ?? 'primary']}
              `}
            >
              {action.loading && (
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {action.icon}
              {action.label}
            </button>
          )}
          {secondaryActions.map((sa, idx) => (
            <button
              key={idx}
              type="button"
              onClick={sa.onClick}
              disabled={sa.disabled || sa.loading}
              className={`
                inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
                rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
                ${buttonVariants[sa.variant ?? 'secondary']}
              `}
            >
              {sa.icon}
              {sa.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EtudesEmptyState;