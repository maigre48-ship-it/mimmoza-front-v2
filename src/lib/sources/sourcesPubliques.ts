// src/lib/sources/sourcesPubliques.ts
//
// Mention des sources publiques réutilisées par Mimmoza (audit du 21/10/2026).
// Affichée sous les résultats de l'analyse rapide et dans son export PDF.
//
// DVF est diffusé par la DGFiP sous licence ouverte Etalab 2.0 : la
// réutilisation impose de citer la source et la date de dernière mise à jour.

export const SOURCES_PUBLIQUES: readonly string[] = [
  "DVF (DGFiP, licence ouverte Etalab 2.0)",
  "cadastre (DGFiP)",
  "Géorisques (ministère de la Transition écologique)",
  "IGN",
  "INSEE",
  "Géoportail de l'urbanisme (GPU)",
];

/** Date la plus récente d'une liste de dates ISO ou JJ/MM/AAAA (null si aucune). */
export function dateLaPlusRecente(dates: ReadonlyArray<string | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const brut of dates) {
    if (!brut) continue;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brut.trim());
    const d = m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : new Date(brut);
    if (!Number.isNaN(d.getTime()) && (!max || d > max)) max = d;
  }
  return max;
}

/**
 * Phrase « Sources : … » prête à afficher.
 * @param dvfDerniereVente date de la vente DVF la plus récente utilisée, si connue
 */
export function mentionSources(dvfDerniereVente?: Date | null): string {
  const date = dvfDerniereVente
    ? ` — DVF : ventes jusqu'au ${dvfDerniereVente.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })}`
    : "";
  return `Sources : ${SOURCES_PUBLIQUES.join(", ")}${date}. Traitements et estimations : Mimmoza.`;
}
