// FILE: src/spaces/promoteur/etudes/layout/components/EtudesTopBar.tsx

import { FC } from 'react';
import type { EtudesTopBarProps, EtudesStatusKind, ActionVariant } from '../etudesLayout.types';

const statusConfig: Record<EtudesStatusKind, { bg: string; text: string; dot: string; label: string }> = {
  idle: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    label: 'En attente',
  },
  loading: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    dot: 'bg-blue-500 animate-pulse',
    label: 'Chargement',
  },
  success: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Succès',
  },
  error: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    dot: 'bg-red-500',
    label: 'Erreur',
  },
  partial: {
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    label: 'Partiel',
  },
};

const buttonVariants: Record<ActionVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
  ghost: 'text-slate-600 hover:text-slate-800 hover:bg-slate-100 focus:ring-slate-500',
};

export const EtudesTopBar: FC<EtudesTopBarProps> = ({
  title,
  subtitle,
  status,
  actions = [],
}) => {
  const statusStyle = status ? statusConfig[status.kind] : null;

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
      <div className="px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: Title + Status */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-slate-900 truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-slate-500 mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>

            {/* Status Badge */}
            {status && statusStyle && (
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                role="status"
                aria-live="polite"
              >
                <span
                  className={`w-2 h-2 rounded-full ${statusStyle.dot}`}
                  aria-hidden="true"
                />
                <span>{status.message ?? statusStyle.label}</span>
              </div>
            )}
          </div>

          {/* Right: Actions */}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled || action.loading}
                  className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${buttonVariants[action.variant ?? 'secondary']}`}
                  aria-label={action.label}
                >
                  {action.loading ? (
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
                  ) : (
                    action.icon
                  )}
                  <span className="hidden sm:inline">{action.label}</span>
                  <span className="sm:hidden">
                    {action.icon ? null : action.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default EtudesTopBar;