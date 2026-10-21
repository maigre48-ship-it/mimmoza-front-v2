// src/lib/cartes/fondPlanIgn.ts
//
// Fond de carte unique : Plan IGN v2 de la Géoplateforme (audit du 21/10/2026).
//
// Remplace les tuiles tile.openstreetmap.org, dont la politique d'usage
// interdit l'utilisation intensive par une application commerciale sans
// accord. Le service WMTS de la Géoplateforme est public, sans clé, et
// l'attribution « © IGN » suffit.
//
// Format XYZ (TILEMATRIXSET=PM = Web Mercator) : utilisable tel quel par
// Leaflet (L.tileLayer / <TileLayer>) et MapLibre (source raster « tiles »).

export const FOND_PLAN_IGN_URL =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
  "&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

/** Attribution HTML (Leaflet). */
export const FOND_PLAN_IGN_ATTRIBUTION =
  '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN</a> — Géoplateforme';

/** Attribution texte (MapLibre, contextes sans HTML). */
export const FOND_PLAN_IGN_ATTRIBUTION_TEXTE = "© IGN — Géoplateforme";

/** Dernier niveau de zoom servi par le Plan IGN v2 (au-delà : agrandissement). */
export const FOND_PLAN_IGN_ZOOM_NATIF_MAX = 19;
