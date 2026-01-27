// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/components/Controls3D.tsx
// ============================================================================

import React from 'react';
import type { FC } from 'react';
import type { SceneVisibility, TerrainViewMode } from '../hooks/useMassingScene';

/**
 * Props du composant Controls3D
 */
export interface Controls3DProps {
  /** État de visibilité actuel */
  visibility: SceneVisibility;
  /** Mode de visualisation du terrain */
  viewMode: TerrainViewMode;
  /** Callback pour toggle un élément */
  onToggleVisibility: (key: keyof SceneVisibility) => void;
  /** Callback pour changer le mode de vue */
  onViewModeChange: (mode: TerrainViewMode) => void;
  /** Désactiver les contrôles */
  disabled?: boolean;
}

/**
 * Composant de contrôles UI pour la scène 3D
 * 
 * Affiche les toggles de visibilité et les options de vue
 */
export const Controls3D: FC<Controls3DProps> = ({
  visibility,
  viewMode,
  onToggleVisibility,
  onViewModeChange,
  disabled = false,
}) => {
  const checkboxStyle: React.CSSProperties = {
    marginRight: '8px',
  };
  
  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
  
  const sectionStyle: React.CSSProperties = {
    marginBottom: '16px',
  };
  
  const titleStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '8px',
  };
  
  return (
    <div
      style={{
        padding: '16px',
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        minWidth: '200px',
      }}
    >
      {/* Section Visibilité */}
      <div style={sectionStyle}>
        <div style={titleStyle}>Affichage</div>
        
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={visibility.terrain}
            onChange={() => onToggleVisibility('terrain')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Terrain
        </label>
        
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={visibility.buildings}
            onChange={() => onToggleVisibility('buildings')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Bâtiments
        </label>
        
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={visibility.parkings}
            onChange={() => onToggleVisibility('parkings')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Parkings
        </label>
        
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={visibility.wireframe}
            onChange={() => onToggleVisibility('wireframe')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Wireframe
        </label>
        
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={visibility.earthworks}
            onChange={() => onToggleVisibility('earthworks')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Terrassements
        </label>
      </div>
      
      {/* Section Mode de vue */}
      <div style={sectionStyle}>
        <div style={titleStyle}>Terrain</div>
        
        <label style={labelStyle}>
          <input
            type="radio"
            name="viewMode"
            checked={viewMode === 'natural'}
            onChange={() => onViewModeChange('natural')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Naturel
        </label>
        
        <label style={labelStyle}>
          <input
            type="radio"
            name="viewMode"
            checked={viewMode === 'project'}
            onChange={() => onViewModeChange('project')}
            disabled={disabled}
            style={checkboxStyle}
          />
          Projet
        </label>
      </div>
      
      {/* Note placeholder */}
      <div
        style={{
          fontSize: '11px',
          color: '#9ca3af',
          fontStyle: 'italic',
          borderTop: '1px solid #e5e7eb',
          paddingTop: '12px',
          marginTop: '8px',
        }}
      >
        💡 Contrôles 3D à venir (rotation, zoom, pan)
      </div>
    </div>
  );
};

Controls3D.displayName = 'Controls3D';