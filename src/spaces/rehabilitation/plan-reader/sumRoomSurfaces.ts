// src/spaces/rehabilitation/plan-reader/sumRoomSurfaces.ts
// ---------------------------------------------------------------------------
// Calcule une surface plancher approchée en ADDITIONNANT les surfaces de
// pièces détectées ("Séjour 23 m²", "Cuisine 21 m²", …) quand aucune surface
// officielle (cartouche) n'est lisible.
//
// C'est une surface CALCULÉE (somme des pièces), à distinguer explicitement
// d'une surface OFFICIELLE lue au cartouche. On exclut les espaces extérieurs
// (terrasse, jardin, balcon) et les surfaces aberrantes.
// ---------------------------------------------------------------------------

// Pièces exclues de la somme "surface plancher" (extérieurs / non clos).
const EXCLUDED_KEYWORDS = [
  "terrasse", "jardin", "balcon", "loggia", "cour", "parking extérieur",
  "préau", "patio",
];

// Capture "23 m²", "23,0 m²", "23.0 m2", "23m²"
const SURFACE_IN_LABEL_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/i;

function isExcluded(label: string): boolean {
  const l = label.toLowerCase();
  return EXCLUDED_KEYWORDS.some((k) => l.includes(k));
}

/**
 * Aplati tous les tableaux de detectedSpatialElements en une liste de chaînes.
 * Chaque item peut être une string ("Séjour 23 m²") ou un objet { description }.
 */
function collectStrings(spatial: unknown): string[] {
  if (!spatial || typeof spatial !== "object") return [];
  const out: string[] = [];
  for (const val of Object.values(spatial as Record<string, unknown>)) {
    if (!Array.isArray(val)) continue;
    for (const item of val) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const s = o.description ?? o.label ?? o.name ?? o.text;
        if (typeof s === "string") out.push(s);
      }
    }
  }
  return out;
}

export interface RoomSum {
  /** Somme des surfaces de pièces (m²), ou null si aucune pièce chiffrée. */
  total: number | null;
  /** Nombre de pièces prises en compte. */
  count: number;
  /** Détail (label + surface) pour transparence / debug. */
  rooms: Array<{ label: string; surfaceM2: number }>;
}

/**
 * Additionne les surfaces de pièces détectées.
 * Ne compte chaque libellé qu'une fois (déduplication sur label normalisé)
 * pour éviter les doublons entre catégories (ex : une pièce listée à la fois
 * dans "rooms" et "therapyAreas").
 */
export function sumRoomSurfaces(result: {
  detectedSpatialElements?: unknown;
} | null | undefined): RoomSum {
  if (!result) return { total: null, count: 0, rooms: [] };

  const strings = collectStrings(result.detectedSpatialElements);
  const seen = new Set<string>();
  const rooms: Array<{ label: string; surfaceM2: number }> = [];

  for (const raw of strings) {
    if (isExcluded(raw)) continue;
    const m = raw.match(SURFACE_IN_LABEL_RE);
    if (!m) continue;
    const surfaceM2 = Number(m[1].replace(",", "."));
    if (!Number.isFinite(surfaceM2) || surfaceM2 <= 0 || surfaceM2 > 5000) continue;

    // Clé de dédup : le libellé sans la partie surface, normalisé.
    const key = raw
      .replace(SURFACE_IN_LABEL_RE, "")
      .toLowerCase()
      .replace(/[^a-zàâäéèêëïîôöùûüç0-9]/gi, "")
      .trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    rooms.push({ label: raw.trim(), surfaceM2 });
  }

  if (rooms.length === 0) return { total: null, count: 0, rooms: [] };

  const total = rooms.reduce((acc, r) => acc + r.surfaceM2, 0);
  return { total: Math.round(total * 10) / 10, count: rooms.length, rooms };
}