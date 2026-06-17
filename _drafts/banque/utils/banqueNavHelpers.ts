// ============================================================================
// banqueNavHelpers.ts — Navigation helpers for AppShell integration
//
// USAGE IN AppShell.tsx:
//   Import and call `preserveBanqueDossier(targetPath, locationSearch)`
//   in the same way `preserveStudyInPath` is used for Promoteur.
// ============================================================================

/**
 * Extract the dossier ID from a search string.
 */
export function extractBanqueDossierId(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("dossier") ?? null;
}

/**
 * Preserve the ?dossier= param when navigating within /banque/*.
 * If the target path starts with /banque, append the dossier param.
 */
export function preserveBanqueDossierInPath(
  targetPath: string,
  currentSearch: string
): string {
  // Only preserve for banque paths
  if (!targetPath.startsWith("/banque")) return targetPath;

  const dossierId = extractBanqueDossierId(currentSearch);
  if (!dossierId) return targetPath;

  const [base, existingQuery] = targetPath.split("?");
  const params = new URLSearchParams(existingQuery ?? "");
  params.set("dossier", dossierId);
  return `${base}?${params.toString()}`;
}