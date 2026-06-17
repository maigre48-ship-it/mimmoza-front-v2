// src/spaces/rehabilitation/plan-reader/planMetadataExtractor.ts
// ---------------------------------------------------------------------------
// Étape 1 du pipeline : extraction des métadonnées textuelles visibles
// sur le plan (cartouche, légende, cotations imprimées).
//
// Source d'entrée : texte OCR + sortie IA Vision.
// Aucune hypothèse silencieuse : tout ce qui n'est pas extrait reste null
// avec confiance "a-confirmer".
// ---------------------------------------------------------------------------

import type { DetectedCotation, MetadataField, PlanMetadata } from './types';
import { emptyMetadata } from './types';

// ---------------------------------------------------------------------------
// Regex métier — chacune produit son propre champ MetadataField indépendant.
// ---------------------------------------------------------------------------

// "576,5 m²"  /  "576.5 m2"  /  "Surface totale : 120 m²"
const SURFACE_RE =
  /(?:surface(?:\s+(?:totale|habitable|utile|de\s+plancher))?\s*[:=]?\s*)?(\d{1,5}(?:[.,]\d{1,3})?)\s*m\s*[²2]/gi;

// "1/100"  "1 / 100"  "1:50"  "Échelle 1/100"
const ECHELLE_RE = /(?:é?chelle\s*[:=]?\s*)?1\s*[\/:]\s*(\d{1,4})/i;

// "RDC", "R+1", "R-1", "Sous-sol", "Niveau 2"
const NIVEAU_RE = /\b(R(?:DC|\+\d|-\d)|sous-?sol|combles?|niveau\s*\d+)\b/i;

// "HSP 2,50 m"  "Hauteur sous plafond : 2.7m"
const HSP_RE =
  /(?:H(?:SP)?\s*|hauteur\s+sous\s+plafond\s*[:=]?\s*)(\d(?:[.,]\d{1,2})?)\s*m\b/i;

// "12/03/2024"  "12-03-2024"  "mars 2024"
const DATE_RE =
  /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/;

// "A4", "A3", "A2", "A1"
const FORMAT_RE = /\b(A[0-5])\b/i;

// Cotations isolées du type "5,20" ou "5200" suivis ou non d'une unité
const COTATION_RE = /\b(\d{1,2}[.,]\d{1,3})\s*m\b|\b(\d{3,5})\s*mm\b/gi;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toNumber = (s: string): number => Number(s.replace(',', '.'));

const fieldFromMatch = <T>(value: T | null, raw?: string): MetadataField<T> => ({
  value,
  raw,
  confidence: value === null ? 'a-confirmer' : 'certain',
  source: value === null ? null : 'plan-text',
});

// ---------------------------------------------------------------------------
// Surface : on cherche la plus grande valeur plausible (le plan peut citer
// la surface d'une pièce — on garde le max comme candidat "surface totale").
// ---------------------------------------------------------------------------

const extractSurface = (text: string): MetadataField<number> => {
  const candidates: Array<{ value: number; raw: string; isExplicit: boolean }> = [];
  for (const m of text.matchAll(SURFACE_RE)) {
    const value = toNumber(m[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
    const ctx = (m[0] || '').toLowerCase();
    const isExplicit = /surface\s+(?:totale|habitable|utile|de\s+plancher)/.test(ctx);
    candidates.push({ value, raw: m[0], isExplicit });
  }
  if (candidates.length === 0) return fieldFromMatch<number>(null);

  // Priorité à un libellé explicite "Surface totale" — sinon plus grand candidat.
  const explicit = candidates.filter(c => c.isExplicit);
  const chosen = explicit.length
    ? explicit.reduce((a, b) => (b.value > a.value ? b : a))
    : candidates.reduce((a, b) => (b.value > a.value ? b : a));

  return {
    value: chosen.value,
    raw: chosen.raw,
    confidence: chosen.isExplicit ? 'certain' : 'a-confirmer',
    source: 'plan-text',
  };
};

const extractEchelle = (text: string): MetadataField<number> => {
  const m = text.match(ECHELLE_RE);
  if (!m) return fieldFromMatch<number>(null);
  const denom = Number(m[1]);
  if (!Number.isFinite(denom) || denom <= 0 || denom > 5000) {
    return fieldFromMatch<number>(null);
  }
  return { value: denom, raw: m[0], confidence: 'certain', source: 'plan-text' };
};

const extractNiveau = (text: string): MetadataField<string> => {
  const m = text.match(NIVEAU_RE);
  if (!m) return fieldFromMatch<string>(null);
  return { value: m[1].toUpperCase(), raw: m[0], confidence: 'certain', source: 'plan-text' };
};

const extractHSP = (text: string): MetadataField<number> => {
  const m = text.match(HSP_RE);
  if (!m) return fieldFromMatch<number>(null);
  const v = toNumber(m[1]);
  if (!Number.isFinite(v) || v < 1.8 || v > 6) {
    // Borne sanitaire : HSP plausible entre 1,80 m et 6 m
    return fieldFromMatch<number>(null);
  }
  return { value: v, raw: m[0], confidence: 'certain', source: 'plan-text' };
};

const extractDate = (text: string): MetadataField<string> => {
  const m = text.match(DATE_RE);
  if (!m) return fieldFromMatch<string>(null);
  return { value: m[1], raw: m[0], confidence: 'a-confirmer', source: 'plan-text' };
};

const extractFormat = (text: string): MetadataField<string> => {
  const m = text.match(FORMAT_RE);
  if (!m) return fieldFromMatch<string>(null);
  return { value: m[1].toUpperCase(), raw: m[0], confidence: 'a-confirmer', source: 'plan-text' };
};

const extractCotations = (text: string): DetectedCotation[] => {
  const cotations: DetectedCotation[] = [];
  for (const m of text.matchAll(COTATION_RE)) {
    const mm = m[1]
      ? toNumber(m[1]) * 1000          // "5,20 m" → 5200 mm
      : Number(m[2]);                  // "5200 mm"
    if (!Number.isFinite(mm) || mm < 100 || mm > 100_000) continue;
    cotations.push({
      valeurMm: mm,
      orientationDeg: 0, // L'OCR pur ne donne pas l'orientation : à confirmer en aval.
      fromNormalized: { x: 0, y: 0 },
      toNormalized: { x: 0, y: 0 },
      raw: m[0],
    });
  }
  return cotations;
};

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export interface MetadataExtractionInput {
  /** Texte OCR brut (cartouche, légende…) */
  ocrText?: string;
  /** Texte produit par l'IA Vision en libellés clairs */
  aiText?: string;
  /** Cotations vectorielles déjà localisées (depuis l'IA) */
  geometryCotations?: DetectedCotation[];
}

export const extractPlanMetadata = (input: MetadataExtractionInput): PlanMetadata => {
  const text = [input.ocrText ?? '', input.aiText ?? ''].join('\n');
  if (!text.trim()) return emptyMetadata();

  const metadata: PlanMetadata = {
    surfaceTotale: extractSurface(text),
    echelle: extractEchelle(text),
    niveau: extractNiveau(text),
    hauteurSousPlafond: extractHSP(text),
    dateDocument: extractDate(text),
    formatPapier: extractFormat(text),
    cotationsDetectees: [
      ...(input.geometryCotations ?? []),
      ...extractCotations(text),
    ],
  };

  return metadata;
};

// ---------------------------------------------------------------------------
// Fusion de deux extractions (ex : OCR puis IA Vision)
// On garde la valeur la plus confiante.
// ---------------------------------------------------------------------------

const mergeField = <T>(a: MetadataField<T>, b: MetadataField<T>): MetadataField<T> => {
  const score = (c: MetadataField<T>): number =>
    c.value === null ? 0 : c.confidence === 'certain' ? 2 : 1;
  return score(b) > score(a) ? b : a;
};

export const mergePlanMetadata = (a: PlanMetadata, b: PlanMetadata): PlanMetadata => ({
  surfaceTotale: mergeField(a.surfaceTotale, b.surfaceTotale),
  echelle: mergeField(a.echelle, b.echelle),
  niveau: mergeField(a.niveau, b.niveau),
  hauteurSousPlafond: mergeField(a.hauteurSousPlafond, b.hauteurSousPlafond),
  dateDocument: mergeField(a.dateDocument, b.dateDocument),
  formatPapier: mergeField(a.formatPapier, b.formatPapier),
  cotationsDetectees: [...a.cotationsDetectees, ...b.cotationsDetectees],
});