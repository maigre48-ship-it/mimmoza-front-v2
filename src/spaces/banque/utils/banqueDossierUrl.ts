// ============================================================================
// banqueDossierUrl.ts — URL convention for dossier context
// Strategy: query param ?dossier=xxx  (same pattern as Promoteur ?study=xxx)
// ============================================================================

const DOSSIER_PARAM = "dossier";

/**
 * Extract dossier ID from current location search string.
 * Falls back to selectedDossierId from snapshot if not in URL.
 */
export function getDossierIdFromLocation(search?: string): string | null {
  const s = search ?? window.location.search;
  const params = new URLSearchParams(s);
  return params.get(DOSSIER_PARAM) ?? null;
}

/**
 * Append ?dossier=xxx to a target path, preserving any existing query params.
 * If dossierId is null/undefined, returns path unchanged.
 */
export function preserveDossierInPath(
  targetPath: string,
  dossierId: string | null | undefined
): string {
  if (!dossierId) return targetPath;

  const [base, existingQuery] = targetPath.split("?");
  const params = new URLSearchParams(existingQuery ?? "");
  params.set(DOSSIER_PARAM, dossierId);
  return `${base}?${params.toString()}`;
}

/**
 * Build a Banque navigation path with dossier preserved.
 * Usage in sidebar/top-nav: `buildBanquePath("/banque/analyse", dossierId)`
 */
export function buildBanquePath(
  page: string,
  dossierId: string | null | undefined
): string {
  return preserveDossierInPath(page, dossierId);
}

/**
 * Extract dossierId from current URL OR from snapshot's selectedDossierId.
 * URL takes precedence.
 */
export function resolveDossierId(
  search: string,
  snapshotSelectedId: string | null
): string | null {
  return getDossierIdFromLocation(search) ?? snapshotSelectedId;
}