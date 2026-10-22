// src/pages/aide/rechercheAide.ts — recherche simple du centre d'aide (sans dépendance).

/** Minuscules, sans accents, espaces normalisés : « Réhabilitation » ≈ « rehabilitation ». */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Vrai si TOUS les mots de la recherche figurent dans le texte (recherche vide : tout correspond). */
export function correspond(texte: string, recherche: string): boolean {
  const mots = normaliser(recherche).split(" ").filter(Boolean);
  if (mots.length === 0) return true;
  const cible = normaliser(texte);
  return mots.every((m) => cible.includes(m));
}
