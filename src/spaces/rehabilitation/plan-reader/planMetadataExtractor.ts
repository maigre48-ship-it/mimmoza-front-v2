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

// Libellé explicite de SURFACE TOTALE du bâtiment (jamais une pièce).
// Doit apparaître juste avant la valeur (ex : "Surface totale : 576,5 m²",
// "SHON 120 m²", "Surface de plancher 240 m²", "SDP : 90 m²").
const SURFACE_TOTALE_LABEL_RE =
  /(?:surface\s+(?:totale|habitable|utile|de\s+plancher)|SHON|SHOB|SDP|surface\s+de\s+plancher)\s*[:=]?\s*(\d{1,5}(?:[.,]\d{1,3})?)\s*m\s*[²2]/gi;

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
// Surface TOTALE : on ne retient QUE une valeur accompagnée d'un libellé
// explicite ("Surface totale", "SHON", "Surface de plancher"…).
//
// RÈGLE STRICTE (anti-faux positif) : une valeur en m² collée à un nom de
// pièce ("Séjour 23 m²", "Cuisine 21 m²") N'EST JAMAIS la surface totale.
// En l'absence de libellé de synthèse → null ("non détectée"). On ne devine
// plus la surface totale à partir du plus grand candidat : ça prenait
// systématiquement la plus grande pièce.
//
// Garde-fou supplémentaire : même avec un libellé, si la valeur candidate est
// ≤ à la plus grande surface de pièce détectée dans le texte, on la rejette
// (probable confusion de l'IA entre une pièce et le total).
// ---------------------------------------------------------------------------

const extractSurface = (text: string): MetadataField<number> => {
  // 1. Plus grande surface de PIÈCE trouvée (tout "N m²"), pour le garde-fou.
  let maxAnySurface = 0;
  for (const m of text.matchAll(SURFACE_RE)) {
    const v = toNumber(m[1]);
    if (Number.isFinite(v) && v > 0 && v < 100_000 && v > maxAnySurface) {
      maxAnySurface = v;
    }
  }

  // 2. Surfaces avec libellé explicite de surface totale UNIQUEMENT.
  const explicit: Array<{ value: number; raw: string }> = [];
  for (const m of text.matchAll(SURFACE_TOTALE_LABEL_RE)) {
    const value = toNumber(m[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
    explicit.push({ value, raw: m[0] });
  }

  // Aucun libellé explicite → on NE devine PAS. Surface non détectée.
  if (explicit.length === 0) return fieldFromMatch<number>(null);

  // On garde la plus grande valeur explicitement libellée.
  const chosen = explicit.reduce((a, b) => (b.value > a.value ? b : a));

  // Garde-fou : une surface totale est forcément > à la plus grande pièce.
  // Si ce n'est pas le cas, c'est une confusion pièce/total → on rejette.
  if (maxAnySurface > 0 && chosen.value <= maxAnySurface && chosen.value < maxAnySurface * 1.0001) {
    // chosen fait partie des "N m²" et n'excède aucune pièce → suspect.
    // On ne retient que s'il domine strictement la plus grande pièce.
    const dominatesRooms = chosen.value > maxAnySurface;
    if (!dominatesRooms) return fieldFromMatch<number>(null);
  }

  return {
    value: chosen.value,
    raw: chosen.raw,
    confidence: 'certain',
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