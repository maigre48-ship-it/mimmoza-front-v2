// src/spaces/promoteur/services/promoteurPdf.formatters.ts
// Formatting helpers for the Promoteur PDF export
// Handles EUR, %, m², dates, N/A cases, and French-safe text sanitization

import type { RecommendationType, RisqueNiveau } from './promoteurSynthese.types';
import { C, type RGB } from './promoteurPdf.theme';

// ============================================================================
// FRENCH-SAFE TEXT SANITIZER
// ============================================================================
// jsPDF's built-in Helvetica supports Latin-1 (U+0000–U+00FF).
// French accented letters (àéèêëîïôöùûüç) ARE in Latin-1 and render fine.
// We only need to sanitize characters OUTSIDE Latin-1.
// ============================================================================

export function sanitize(str: string): string {
  if (!str) return '';
  return str
    // Normalize exotic whitespace to regular space
    .replace(/[\u00a0\u202f\u2009\u2007\u2008\u200b]/g, ' ')
    // Characters outside Latin-1 that need mapping
    .replace(/[œ]/g, 'oe').replace(/[Œ]/g, 'OE')
    .replace(/[æ]/g, 'ae').replace(/[Æ]/g, 'AE')
    // Typographic punctuation → ASCII equivalents
    .replace(/[–—]/g, '-')
    .replace(/[''‛]/g, "'")
    .replace(/[""‟]/g, '"')
    // Symbols outside Latin-1
    .replace(/€/g, 'EUR')
    .replace(/²/g, '\u00B2')  // ² IS in Latin-1 at U+00B2 — keep it
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    // Strip anything remaining above U+00FF
    .replace(/[^\x00-\xFF]/g, '?');
}

// Alias for brevity in rendering code
export const s = sanitize;

// ============================================================================
// NUMBER FORMATTING
// ============================================================================

export function fmtNum(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return 'N/A';
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function eur(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return 'N/A';
  const abs = Math.abs(Math.round(v));
  const str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return v < 0 ? `-${str} EUR` : `${str} EUR`;
}

export function eurM(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return 'N/A';
  return `${(v / 1e6).toFixed(2)} M EUR`;
}

export function pct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return 'N/A';
  return `${v.toFixed(1)}%`;
}

export function m2v(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v <= 0) return 'N/A';
  return `${fmtNum(v)} m²`;
}

/** Safe percentage: returns N/A if denominator is 0 */
export function safePct(num: number, den: number): string {
  if (!den || !isFinite(num) || !isFinite(den)) return 'N/A';
  return pct((num / den) * 100);
}

/** Safe division returning null if not computable */
export function safeDiv(num: number, den: number): number | null {
  if (!den || !isFinite(num) || !isFinite(den)) return null;
  return num / den;
}

// ============================================================================
// SEMANTIC HELPERS
// ============================================================================

export function recColor(r: RecommendationType): RGB {
  return r === 'GO' ? C.green : r === 'GO_CONDITION' ? C.amber : C.red;
}

export function risqueColor(n: RisqueNiveau): RGB {
  if (n === 'CRITIQUE') return C.red;
  if (n === 'ELEVE')    return C.orange;
  if (n === 'MODERE')   return C.amber;
  return C.green;
}

export const REC_LABELS: Record<RecommendationType, string> = {
  GO:           'GO — OPÉRATION RECOMMANDÉE',
  GO_CONDITION: 'GO CONDITIONNEL — AJUSTEMENTS REQUIS',
  NO_GO:        'NO GO — OPÉRATION NON VIABLE EN L\'ÉTAT',
};

export const REC_LABELS_SHORT: Record<RecommendationType, string> = {
  GO:           'GO',
  GO_CONDITION: 'GO CONDITIONNEL',
  NO_GO:        'NO GO',
};

// ============================================================================
// DOCUMENT STATUS LABELS
// ============================================================================

export type DocumentStatus = 'committee_ready' | 'provisional' | 'incomplete';

export const DOC_STATUS_LABELS: Record<DocumentStatus, string> = {
  committee_ready: 'DOSSIER COMITÉ — PRÊT POUR DÉCISION',
  provisional:     'PRÉ-ÉTUDE — DONNÉES PARTIELLES',
  incomplete:      'DOSSIER INCOMPLET — NON PRÉSENTABLE EN COMITÉ',
};

export const DOC_STATUS_COLORS: Record<DocumentStatus, RGB> = {
  committee_ready: C.green,
  provisional:     C.amber,
  incomplete:      C.red,
};

export const DOC_USAGE_LABELS: Record<DocumentStatus, string> = {
  committee_ready: 'Comité d\'investissement',
  provisional:     'Pré-étude / Validation complémentaire requise',
  incomplete:      'Brouillon interne uniquement',
};

// ============================================================================
// DATE FORMATTING
// ============================================================================

export function fmtDate(dateStr: string | Date): string {
  try {
    const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return 'N/A';
  }
}

export function fmtDateLong(dateStr: string | Date): string {
  try {
    const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return 'N/A';
  }
}

export function fmtTime(): string {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}