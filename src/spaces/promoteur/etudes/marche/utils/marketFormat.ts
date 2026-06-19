// src/spaces/promoteur/etudes/marche/utils/marketFormat.ts
// Helpers de formatage pour l'etude de marche (distance, nombre, prix).

const FALLBACK = "—";

export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || Number.isNaN(km)) return FALLBACK;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(n)) return FALLBACK;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return FALLBACK;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}