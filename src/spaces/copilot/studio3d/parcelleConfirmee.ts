// src/spaces/copilot/studio3d/parcelleConfirmee.ts
//
// R2 — LA PARCELLE CONFIRMÉE EST RETENUE PAR CONVERSATION.
//
// Avant : la parcelle confirmée par le parcours photo/GPS vivait dans un état
// React ; à l'ouverture suivante, la fenêtre de transfert redemandait
// l'adresse et la parcelle (PreparationStudio3D.tsx:222-234). Ici, elle est
// gardée sur ce poste (localStorage, ~quelques ko) avec son implantation et
// ses accès ; le relief, plus lourd, est dans le cache IndexedDB (reliefCache).
// La photo (File) n'est jamais stockée.

import type { ConfirmedTerrain } from "./terrainCadastre.ts";
import type { StockageCle } from "./projetChat.ts";

const cle = (conversationId: string) => `mzia.studio.parcelle.${conversationId}`;
const TAILLE_MAX = 400_000;

export type ParcelleRetenue = Omit<ConfirmedTerrain, "panorama" | "terrainData"> & { adresse?: string | null; retenueLe: string };

function stockageParDefaut(): StockageCle | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function retenirParcelle(conversationId: string, terrain: ConfirmedTerrain & { adresse?: string | null }, stockage: StockageCle | null = stockageParDefaut()): boolean {
  const { panorama: _p, terrainData: _t, ...reste } = terrain;
  const valeur = JSON.stringify({ ...reste, retenueLe: new Date().toISOString() } satisfies ParcelleRetenue);
  if (valeur.length > TAILLE_MAX || !stockage) return false;
  try { stockage.setItem(cle(conversationId), valeur); return true; } catch { return false; }
}

export function parcelleRetenue(conversationId: string, stockage: StockageCle | null = stockageParDefaut()): ParcelleRetenue | null {
  try {
    const o = JSON.parse(stockage?.getItem(cle(conversationId)) ?? "null") as ParcelleRetenue | null;
    const g = o?.parcel?.geometry;
    if (!o || o.parcel?.type !== "Feature" || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
    if (!o.point || !Number.isFinite(o.point.lat) || !Number.isFinite(o.point.lon)) return null;
    return o;
  } catch { return null; }
}
