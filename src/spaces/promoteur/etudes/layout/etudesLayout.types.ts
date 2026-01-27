// FILE: src/spaces/promoteur/etudes/layout/etudesLayout.types.ts

import { ReactNode } from 'react';

// ============================================================================
// STATUS
// ============================================================================

export type EtudesStatusKind = 'idle' | 'loading' | 'success' | 'error' | 'partial';

export interface EtudesStatus {
  kind: EtudesStatusKind;
  message?: string;
}

// ============================================================================
// ACTIONS
// ============================================================================

export type ActionVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface EtudesAction {
  label: string;
  onClick: () => void;
  variant?: ActionVariant;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
}

// ============================================================================
// LAYOUT PROPS
// ============================================================================

export interface EtudesLayoutProps {
  /** Titre principal de l'étude */
  title: string;
  /** Sous-titre ou description courte */
  subtitle?: string;
  /** Statut global de l'étude */
  status?: EtudesStatus;
  /** Actions disponibles dans la top bar */
  actions?: EtudesAction[];
  /** Panneau latéral gauche (paramètres, filtres) */
  sidePanel?: ReactNode;
  /** Contenu principal (cartes, graphiques, tableaux) */
  main: ReactNode;
  /** Colonne droite optionnelle (KPIs, résumé, alertes) */
  right?: ReactNode;
  /** Classes CSS additionnelles pour le conteneur */
  className?: string;
}

// ============================================================================
// TOPBAR PROPS
// ============================================================================

export interface EtudesTopBarProps {
  title: string;
  subtitle?: string;
  status?: EtudesStatus;
  actions?: EtudesAction[];
}

// ============================================================================
// SIDE PANEL PROPS
// ============================================================================

export interface EtudesSidePanelProps {
  /** Titre du panneau */
  title?: string;
  /** Contenu du panneau */
  children: ReactNode;
  /** Collapsé par défaut sur mobile */
  defaultCollapsed?: boolean;
  /** Largeur du panneau */
  width?: 'narrow' | 'normal' | 'wide';
  /** Classes CSS additionnelles */
  className?: string;
}

// ============================================================================
// SECTION CARD PROPS
// ============================================================================

export type SectionCardState = 'idle' | 'loading' | 'success' | 'error' | 'empty';

export interface EtudesSectionCardProps {
  /** Titre de la section */
  title: string;
  /** Icône optionnelle (ReactNode) */
  icon?: ReactNode;
  /** État de la section */
  state?: SectionCardState;
  /** Message d'erreur ou d'état */
  stateMessage?: string;
  /** Actions de la carte (boutons header) */
  actions?: EtudesAction[];
  /** Contenu principal */
  children?: ReactNode;
  /** Contenu affiché en cas d'état empty */
  emptyContent?: ReactNode;
  /** Classes CSS additionnelles */
  className?: string;
  /** Carte collapsible */
  collapsible?: boolean;
  /** Collapsed par défaut */
  defaultCollapsed?: boolean;
}

// ============================================================================
// KPI GRID PROPS
// ============================================================================

export type KpiTrend = 'up' | 'down' | 'neutral';

export interface KpiItem {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  trend?: KpiTrend;
  trendValue?: string;
  description?: string;
  loading?: boolean;
  error?: boolean;
}

export interface EtudesKpiGridProps {
  items: KpiItem[];
  columns?: 1 | 2 | 3 | 4;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// ============================================================================
// EMPTY STATE PROPS
// ============================================================================

export interface EtudesEmptyStateProps {
  /** Icône ou illustration */
  icon?: ReactNode;
  /** Titre du message */
  title: string;
  /** Description */
  description?: string;
  /** Action principale */
  action?: EtudesAction;
  /** Actions secondaires */
  secondaryActions?: EtudesAction[];
  /** Variante visuelle */
  variant?: 'default' | 'error' | 'warning' | 'info';
  /** Classes CSS additionnelles */
  className?: string;
}