// src/lib/billing/parcelKey.ts
// Construit une cle de projet STABLE par parcelle pour le paywall.
// Principe : 1 jeton = 1 parcelle. La cle depend de la parcelle selectionnee,
// PAS de l'etude (sinon changement de parcelle dans la meme etude sans repayer).
//
// Pour le promoteur, parcel_id est l'identifiant cadastral (ex 64065000AI0001),
// unique et deterministe. On l'utilise directement.

import { getCurrentPromoteurParcelSelection } from "../../spaces/promoteur/shared/getCurrentPromoteurParcelSelection";

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type ParcelKeyResult = {
  /** Cle a passer a unlockProject (null si aucune parcelle valide). */
  key: string | null;
  /** Label lisible pour la modal. */
  label: string;
  /** Nombre de parcelles dans la selection courante. */
  parcelCount: number;
};

/**
 * Construit la cle de deverrouillage pour la parcelle promoteur courante.
 */
export function buildPromoteurParcelKey(): ParcelKeyResult {
  const sel = getCurrentPromoteurParcelSelection();
  const ids = sel.selectedParcels
    .map((p) => p.id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  if (ids.length === 0) {
    return { key: null, label: "Parcelle", parcelCount: 0 };
  }

  const sorted = [...ids].sort();
  const key = "cad:" + sorted.join("+");

  const focus = sel.focusParcelId ?? sorted[0];
  const communePart = sel.communeInsee ? ` (INSEE ${sel.communeInsee})` : "";
  const label =
    ids.length > 1
      ? `${ids.length} parcelles${communePart}`
      : `Parcelle ${focus}${communePart}`;

  return { key, label, parcelCount: ids.length };
}

/**
 * Fallback generique (autres espaces sans id cadastral) : cle depuis une adresse.
 */
export function buildAddressKey(address: string | null | undefined): string | null {
  if (!address || !address.trim()) return null;
  return "addr:" + normalizeText(address);
}