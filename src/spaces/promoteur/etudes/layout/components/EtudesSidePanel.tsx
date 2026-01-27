// FILE: src/spaces/promoteur/etudes/layout/components/EtudesSidePanel.tsx

import { FC, useState, useId } from 'react';
import type { EtudesSidePanelProps } from '../etudesLayout.types';

const widthClasses: Record<string, string> = {
  narrow: 'w-64',
  normal: 'w-72',
  wide: 'w-80',
};

const MenuIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const CloseIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SettingsIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

export const EtudesSidePanel: FC<EtudesSidePanelProps> = ({
  title = 'Paramètres',
  children,
  defaultCollapsed = true,
  width = 'normal',
  className = '',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const panelId = useId();

  return (
    <>
      {/* Mobile toggle button */}
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        className={`
          lg:hidden fixed bottom-4 left-4 z-40
          p-3 bg-blue-600 text-white rounded-full shadow-lg
          hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          transition-transform
          ${isCollapsed ? 'translate-x-0' : '-translate-x-full opacity-0'}
        `}
        aria-label="Ouvrir les paramètres"
        aria-expanded={!isCollapsed}
        aria-controls={panelId}
      >
        <MenuIcon />
      </button>

      {/* Backdrop for mobile */}
      {!isCollapsed && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setIsCollapsed(true)}
          aria-hidden="true"
        />
      )}

      {/* Side Panel */}
      <aside
        id={panelId}
        className={`
          fixed lg:static inset-y-0 left-0 z-50 lg:z-0
          flex flex-col
          bg-white border-r border-slate-200
          transform transition-transform duration-300 ease-in-out
          ${isCollapsed ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}
          ${widthClasses[width]}
          ${className}
        `}
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <SettingsIcon className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Fermer les paramètres"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </aside>
    </>
  );
};

export default EtudesSidePanel;