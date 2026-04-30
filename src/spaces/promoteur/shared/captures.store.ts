// src/spaces/promoteur/shared/captures.store.ts
// Gestion centralisée des captures d'écran du workflow Promoteur.
// Isolation par studyId : chaque projet a ses propres captures, plus de fuite.

export type CaptureSlot = "cadastre" | "impl2d" | "massing3d" | "facadeIA";

export interface PromoteurCaptures {
  cadastre?:    string;
  impl2d?:      string;
  massing3d?:   string;
  facadeIA?:    string;
  capturedAt?:  string;
}

// ── Clé legacy (globale v1) conservée pour fallback hors contexte d'étude ────
const LEGACY_KEY = "mimmoza.promoteur.captures.v1";

function capturesKey(studyId: string | null): string {
  return studyId ? `mimmoza.promoteur.captures.${studyId}` : LEGACY_KEY;
}

/** Lit toutes les captures de l'étude courante. Retourne {} si rien trouvé. */
export function readCaptures(studyId: string | null): PromoteurCaptures {
  try {
    const raw = localStorage.getItem(capturesKey(studyId));
    if (!raw) return {};
    return JSON.parse(raw) as PromoteurCaptures;
  } catch { return {}; }
}

/** Écrit une seule capture dans le slot donné pour l'étude courante. */
export function writeCapture(
  studyId: string | null,
  slot: CaptureSlot,
  dataUrl: string,
): boolean {
  try {
    const existing = readCaptures(studyId);
    const next: PromoteurCaptures = {
      ...existing,
      [slot]: dataUrl,
      capturedAt: new Date().toISOString(),
    };
    localStorage.setItem(capturesKey(studyId), JSON.stringify(next));
    return true;
  } catch (e) {
    console.warn(`[captures.store] writeCapture(${slot}) échec:`, e);
    return false;
  }
}

/** Supprime toutes les captures de l'étude donnée (utilisé au changement d'étude). */
export function clearCaptures(studyId: string | null): void {
  try { localStorage.removeItem(capturesKey(studyId)); } catch { /* ignore */ }
}

/** Nettoie la clé legacy globale v1 (à appeler au changement d'étude). */
export function clearLegacyCaptures(): void {
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}