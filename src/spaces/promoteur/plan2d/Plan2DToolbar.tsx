// ─── Plan2DToolbar.tsx ────────────────────────────────────────────────────────
// Toolbar horizontale des outils — intégrable dans l'existant de la page

import React from 'react';
import { MousePointer2, Building2, ParkingSquare, Ruler, Trash2, Copy } from 'lucide-react';
import { useEditor2DStore } from './editor2d.store';
import type { Tool } from './editor2d.types';

interface ToolDef {
  id:       Tool;
  label:    string;
  icon:     React.ReactNode;
  shortcut: string;
  /** Si true, toggles une option sans changer l'outil actif */
  toggle?:  true;
}

const TOOLS: ToolDef[] = [
  { id: 'selection', label: 'Sélection', icon: <MousePointer2 size={15} />, shortcut: 'V' },
  { id: 'building',  label: 'Bâtiment',  icon: <Building2    size={15} />, shortcut: 'B' },
  { id: 'parking',   label: 'Parking',   icon: <ParkingSquare size={15} />, shortcut: 'P' },
  { id: 'cotes',     label: 'Cotes',     icon: <Ruler         size={15} />, shortcut: 'C', toggle: true },
];

export function Plan2DToolbar() {
  const {
    activeTool,
    setTool,
    cotesVisible,
    setCotesVisible,
    selectedIds,
    deleteSelected,
    duplicateSelected,
    buildings,
    parkings,
  } = useEditor2DStore();

  const hasSelection   = selectedIds.length > 0;
  const totalBuildings = buildings.length;
  const totalParkings  = parkings.length;

  const handleClick = (tool: ToolDef) => {
    if (tool.toggle) {
      setCotesVisible(!cotesVisible);
    } else {
      setTool(tool.id as Tool);
    }
  };

  const isActive = (tool: ToolDef): boolean => {
    if (tool.toggle) return cotesVisible;
    return activeTool === tool.id;
  };

  return (
    <div className="flex items-center gap-2">
      {/* ── Outils ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            onClick={() => handleClick(tool)}
            title={`${tool.label} (${tool.shortcut})`}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium',
              'transition-all duration-100',
              isActive(tool)
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
            ].join(' ')}
          >
            {tool.icon}
            <span className="hidden md:inline">{tool.label}</span>
          </button>
        ))}
      </div>

      {/* ── Actions contextuelle sélection ────────────────────────────── */}
      {hasSelection && (
        <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          <button
            onClick={duplicateSelected}
            title="Dupliquer (Ctrl+D)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
                       text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-all"
          >
            <Copy size={14} />
            <span className="hidden md:inline">Dupliquer</span>
          </button>
          <button
            onClick={deleteSelected}
            title="Supprimer (Suppr)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
                       text-red-500 hover:bg-red-50 hover:text-red-700 transition-all"
          >
            <Trash2 size={14} />
            <span className="hidden md:inline">Supprimer</span>
          </button>
        </div>
      )}

      {/* ── Compteurs ────────────────────────────────────────────────── */}
      {(totalBuildings > 0 || totalParkings > 0) && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {totalBuildings > 0 && (
            <span className="flex items-center gap-1">
              <Building2 size={12} className="text-violet-400" />
              {totalBuildings}
            </span>
          )}
          {totalParkings > 0 && (
            <span className="flex items-center gap-1">
              <ParkingSquare size={12} className="text-blue-400" />
              {totalParkings}
            </span>
          )}
        </div>
      )}
    </div>
  );
}