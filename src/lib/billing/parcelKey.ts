// src/lib/billing/parcelKey.ts
// PATCH V2.0 — Modèle A : 1 jeton = 1 ÉTUDE (débité à la création).
//
// L'ancien modèle « 1 jeton = 1 parcelle » (clé dérivée de la parcelle cadastrale
// sélectionnée, via getCurrentPromoteurParcelSelection) est ABANDONNÉ pour le
// promoteur : il dérivait la clé de facturation d'un localStorage global,
// manipulable et non scopé par étude. La clé de facturation est désormais
// study.id (UUID serveur), gérée dans NouvelleOpportunitePage (unlockProject à la
// création) et AppShell (isProjectUnlocked sur ?study=).
//
// Ce fichier ne conserve que le fallback générique par adresse (autres espaces).

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fallback generique (espaces sans id de projet serveur) : cle depuis une adresse.
 */
export function buildAddressKey(address: string | null | undefined): string | null {
  if (!address || !address.trim()) return null;
  return "addr:" + normalizeText(address);
}
