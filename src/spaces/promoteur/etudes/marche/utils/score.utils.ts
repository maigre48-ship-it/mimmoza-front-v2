// src/spaces/promoteur/etudes/marche/utils/score.utils.ts

export function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Normalise une valeur sur une plage [min..max] => [0..100]
 * - Si higherIsBetter=true : min -> 0, max -> 100
 * - Sinon : min -> 100, max -> 0
 */
export function scoreFromRange(
  value: number | null | undefined,
  min: number,
  max: number,
  higherIsBetter = true
): number {
  if (value == null || !Number.isFinite(value)) return 0;

  if (max === min) return 0;
  const t = (value - min) / (max - min);
  const p = clamp(t * 100, 0, 100);
  return higherIsBetter ? p : 100 - p;
}

/**
 * Combine plusieurs sous-critères (0..100) avec des poids.
 * - Si aucun item, retourne 0.
 */
export function weightedMean(items: Array<{ score: number; weight: number }>): number {
  if (!items.length) return 0;
  let wsum = 0;
  let ssum = 0;
  for (const it of items) {
    const w = Number.isFinite(it.weight) ? it.weight : 0;
    const s = clamp(it.score, 0, 100);
    if (w <= 0) continue;
    wsum += w;
    ssum += s * w;
  }
  if (wsum <= 0) return 0;
  return clamp(ssum / wsum, 0, 100);
}

/**
 * Arrondis cohérents pour affichage (ex: 72.4 => 72)
 */
export function roundScore(n: number, decimals = 0): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
