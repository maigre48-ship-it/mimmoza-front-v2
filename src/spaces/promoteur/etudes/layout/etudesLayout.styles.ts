// FILE: src/spaces/promoteur/etudes/layout/etudesLayout.styles.ts

/**
 * Constantes de styles réutilisables pour le layout Etudes
 * Peut être importé pour maintenir la cohérence visuelle
 */

export const spacing = {
  xs: 'p-2',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  xl: 'p-8',
} as const;

export const cardBase = 'bg-white border border-slate-200 rounded-lg shadow-sm';

export const statusColors = {
  idle: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
  },
  loading: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },
  success: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
  error: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-200',
  },
  partial: {
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },
} as const;

export const typography = {
  h1: 'text-xl font-semibold text-slate-900',
  h2: 'text-lg font-semibold text-slate-800',
  h3: 'text-sm font-semibold text-slate-800',
  body: 'text-sm text-slate-600',
  caption: 'text-xs text-slate-500',
  label: 'text-xs font-medium text-slate-500 uppercase tracking-wide',
} as const;

export const transitions = {
  fast: 'transition-all duration-150 ease-in-out',
  normal: 'transition-all duration-200 ease-in-out',
  slow: 'transition-all duration-300 ease-in-out',
} as const;

export const focusRing = 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';

export const buttonBase = `
  inline-flex items-center justify-center gap-2
  font-medium rounded-md
  transition-colors
  disabled:opacity-50 disabled:cursor-not-allowed
  ${focusRing}
`;

export const buttonSizes = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-2.5 text-sm',
} as const;