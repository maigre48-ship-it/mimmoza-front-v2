// FILE: src/spaces/promoteur/etudes/layout/components/EtudesSectionCard.tsx

import { FC, useState, useId } from 'react';
import type { EtudesSectionCardProps, ActionVariant } from '../etudesLayout.types';

const buttonVariants: Record<ActionVariant, string> = {
  primary: 'text-blue-600 hover:text-blue-800 hover:bg-blue-50',
  secondary: 'text-slate-600 hover:text-slate-800 hover:bg-slate-100',
  danger: 'text-red-600 hover:text-red-800 hover:bg-red-50',
  ghost: 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
};

const ChevronIcon: FC<{ expanded: boolean; className?: string }> = ({
  expanded,
  className = '',
}) => (
  <svg
    className={`w-5 h-5 transition-transform duration-200 ${
      expanded ? 'rotate-180' : ''
    } ${className}`}
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

const LoadingSpinner: FC = () => (
  <div className="flex items-center justify-center py-8" aria-busy="true">
    <svg
      className="animate-spin h-6 w-6 text-blue-500"
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
    <span className="sr-only">Chargement en cours</span>
  </div>
);

const ErrorState: FC<{ message?: string }> = ({ message }) => (
  <div
    className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-md"
    role="alert"
  >
    <svg
      className="w-5 h-5 text-red-500 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
        clipRule="evenodd"
      />
    </svg>
    <p className="text-sm text-red-700">{message ?? 'Une erreur est survenue'}</p>
  </div>
);

export const EtudesSectionCard: FC<EtudesSectionCardProps> = ({
  title,
  icon,
  state = 'idle',
  stateMessage,
  actions = [],
  children,
  emptyContent,
  className = '',
  collapsible = false,
  defaultCollapsed = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const headerId = useId();
  const contentId = useId();

  const renderContent = () => {
    switch (state) {
      case 'loading':
        return <LoadingSpinner />;
      case 'error':
        return <ErrorState message={stateMessage} />;
      case 'empty':
        return emptyContent ?? (
          <p className="text-sm text-slate-500 text-center py-6">
            {stateMessage ?? 'Aucune donnée disponible'}
          </p>
        );
      default:
        return children;
    }
  };

  return (
    <section
      className={`
        bg-white border border-slate-200 rounded-lg shadow-sm
        ${className}
      `}
      aria-labelledby={headerId}
    >
      {/* Header */}
      <div
        className={`
          flex items-center justify-between gap-4 px-4 py-3
          border-b border-slate-100
          ${collapsible ? 'cursor-pointer select-none' : ''}
        `}
        onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsCollapsed(!isCollapsed);
                }
              }
            : undefined
        }
        tabIndex={collapsible ? 0 : undefined}
        role={collapsible ? 'button' : undefined}
        aria-expanded={collapsible ? !isCollapsed : undefined}
        aria-controls={collapsible ? contentId : undefined}
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <span className="text-slate-400 flex-shrink-0" aria-hidden="true">
              {icon}
            </span>
          )}
          <h3
            id={headerId}
            className="text-sm font-semibold text-slate-800 truncate"
          >
            {title}
          </h3>
          {state === 'loading' && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded-full">
              Chargement
            </span>
          )}
          {state === 'error' && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-red-700 bg-red-100 rounded-full">
              Erreur
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {actions.map((action, idx) => (
            <button
              key={idx}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
              disabled={action.disabled || action.loading}
              className={`
                inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium
                rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500
                disabled:opacity-50 disabled:cursor-not-allowed
                ${buttonVariants[action.variant ?? 'ghost']}
              `}
              aria-label={action.label}
            >
              {action.loading ? (
                <svg
                  className="animate-spin h-3.5 w-3.5"
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
              <span>{action.label}</span>
            </button>
          ))}
          {collapsible && (
            <ChevronIcon expanded={!isCollapsed} className="text-slate-400 ml-1" />
          )}
        </div>
      </div>

      {/* Content */}
      {(!collapsible || !isCollapsed) && (
        <div id={contentId} className="p-4">
          {renderContent()}
        </div>
      )}
    </section>
  );
};

export default EtudesSectionCard;