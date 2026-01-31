// src/utils/preserveStudyParam.ts
// Helpers pour préserver le ?study= dans les routes Promoteur

/**
 * Extrait le studyId depuis une query string (?study=xxx)
 */
export function extractStudyId(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  return params.get("study");
}

/**
 * Préserve le param ?study= lors d'un changement de route
 * ex: preserveStudyInPath("/promoteur/marche", location.search)
 */
export function preserveStudyInPath(
  targetPath: string,
  search: string
): string {
  const studyId = extractStudyId(search);
  if (!studyId) return targetPath;

  const hasQuery = targetPath.includes("?");
  return `${targetPath}${hasQuery ? "&" : "?"}study=${encodeURIComponent(
    studyId
  )}`;
}
