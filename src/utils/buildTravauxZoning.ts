// src/utils/buildTravauxZoning.ts
//
// V3 — Zoning & Mask builder (canvas)
// - Zones simples par défaut (floor/walls/ceiling/fixtures)
// - Overrides possibles depuis le front
// - Génère un mask PNG (base64) pour /images/edits
//

export type TravauxZone =
  | "floor"
  | "walls"
  | "ceiling"
  | "kitchen"
  | "bathroom"
  | "openings"   // fenêtres / portes
  | "all";

export interface ZoningConfig {
  width: number;   // largeur image (px)
  height: number;  // hauteur image (px)
  zones: TravauxZone[]; // zones à modifier
  // overrides optionnels (coords en % [0..1])
  overrides?: Partial<Record<TravauxZone, Array<{ x: number; y: number; w: number; h: number }>>>;
}

// Rect normalisé
export interface NormalizedRect {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
}

// ── Heuristiques par zone ──────────────────────────────────────────

/**
 * Zoning par défaut (heuristiques simples image intérieure).
 *
 * Conventions :
 *  - floor   : bas (y > 65%)
 *  - walls   : centre (y 20%→80%)
 *  - ceiling : haut (y < 25%)
 *  - openings: rectangles verticaux latéraux (~20% de large)
 *  - kitchen : quadrant droite basse (plan de travail / meubles hauts)
 *  - bathroom: centre élargi
 *  - all     : pleine image
 */
function defaultRectsForZone(zone: TravauxZone): NormalizedRect[] {
  switch (zone) {
    case "floor":
      return [{ x: 0, y: 0.65, w: 1, h: 0.35 }];

    case "walls":
      return [
        { x: 0,    y: 0.20, w: 0.10, h: 0.55 },   // mur gauche (stop avant le bas)
        { x: 0.90, y: 0.20, w: 0.10, h: 0.55 },   // mur droit (stop avant le bas)
        { x: 0.10, y: 0.20, w: 0.80, h: 0.45 },   // mur du fond (centre)
      ];

    case "ceiling":
      return [{ x: 0, y: 0, w: 1, h: 0.25 }];

    case "openings":
      return [
        { x: 0.05, y: 0.25, w: 0.18, h: 0.50 }, // ouverture gauche
        { x: 0.77, y: 0.25, w: 0.18, h: 0.50 }, // ouverture droite
      ];

    case "kitchen":
      return [
        { x: 0.40, y: 0.35, w: 0.60, h: 0.55 }, // zone cuisine / plan de travail
        { x: 0.40, y: 0.20, w: 0.60, h: 0.20 }, // meubles hauts cuisine
      ];

    case "bathroom":
      return [
        { x: 0.15, y: 0.30, w: 0.70, h: 0.60 }, // ensemble sanitaires
      ];

    case "all":
      return [{ x: 0, y: 0, w: 1, h: 1 }];

    default:
      return [];
  }
}

// ── Génération du mask ─────────────────────────────────────────────

/**
 * Génère un mask PNG base64 pour DALL-E 2 /images/edits.
 *
 * Convention DALL-E :
 *   - BLANC (255,255,255,255) = zone ÉDITÉE par l'IA
 *   - NOIR  (0,0,0,255)       = zone VERROUILLÉE (inchangée)
 *
 * Retourne une data URL : "data:image/png;base64,..."
 */
export async function buildMaskBase64(config: ZoningConfig): Promise<string> {
  const { width, height, zones, overrides } = config;

  if (width <= 0 || height <= 0) {
    throw new Error(`[buildMaskBase64] Dimensions invalides : ${width}×${height}`);
  }

  if (zones.length === 0) {
    console.warn("[buildMaskBase64] Aucune zone sélectionnée — fallback floor+walls");
  }

  // Canvas offscreen (compatible navigateur moderne)
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[buildMaskBase64] Canvas context unavailable");

  // ── 1) Fond noir → tout verrouillé ──────────────────────────────
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // ── 2) Zones blanches → éditables ───────────────────────────────
  ctx.fillStyle = "#ffffff";

  const effectiveZones: TravauxZone[] = zones.length > 0 ? zones : ["floor", "walls"];

  for (const zone of effectiveZones) {
    const rects: NormalizedRect[] =
      overrides?.[zone] && overrides[zone]!.length > 0
        ? overrides[zone]!
        : defaultRectsForZone(zone);

    for (const r of rects) {
      const x = Math.round(r.x * width);
      const y = Math.round(r.y * height);
      const w = Math.round(r.w * width);
      const h = Math.round(r.h * height);

      ctx.fillRect(x, y, w, h);
    }
  }

  // ── 3) Export PNG base64 ─────────────────────────────────────────
  const dataUrl = canvas.toDataURL("image/png");

  // Debug : surface blanche approx
  if (import.meta.env.DEV) {
    const totalPx = width * height;
    const imageData = ctx.getImageData(0, 0, width, height).data;
    let whitePx = 0;
    for (let i = 0; i < imageData.length; i += 4) {
      if (imageData[i] > 200) whitePx++; // canal R
    }
    const pct = ((whitePx / totalPx) * 100).toFixed(1);
    console.log(`[buildMaskBase64] Mask généré ${width}×${height} | zones: [${effectiveZones.join(", ")}] | surface éditée: ~${pct}%`);
  }

  return dataUrl; // "data:image/png;base64,..."
}

// ── Helper : zones → lots ──────────────────────────────────────────

/**
 * Déduit les zones à éditer à partir des lots de travaux.
 *
 * Correspondances :
 *  revetements_sols        → floor
 *  peinture                → walls
 *  revetements_murs        → walls
 *  faux_plafonds           → ceiling
 *  cuisine                 → kitchen
 *  salle_de_bain / bain    → bathroom
 *  menuiseries_ext*        → openings
 *
 * Fallback : floor + walls si aucun lot reconnu.
 */
export function inferZonesFromLots(lots: string[]): TravauxZone[] {
  const set = new Set<TravauxZone>();

  for (const lot of lots) {
    const l = lot.toLowerCase().trim();

    if (l.includes("revetements_sols") || l.includes("sol") || l.includes("parquet") || l.includes("carrelage")) {
      set.add("floor");
    }
    if (
      l.includes("peinture") ||
      l.includes("revetements_murs") ||
      l.includes("enduit") ||
      l.includes("papier_peint") ||
      l.includes("toile")
    ) {
      set.add("walls");
    }
    if (l.includes("faux_plafond") || l.includes("plafond")) {
      set.add("ceiling");
    }
    if (l.includes("cuisine")) {
      set.add("kitchen");
    }
    if (l.includes("salle_de_bain") || l.includes("bain") || l.includes("sanitaire")) {
      set.add("bathroom");
    }
    if (l.includes("menuiseries_ext") || l.includes("fenetre") || l.includes("porte_fen")) {
      set.add("openings");
    }
  }

  // Fallback
  if (set.size === 0) {
    console.warn("[inferZonesFromLots] Aucun lot reconnu — fallback floor+walls");
    set.add("floor");
    set.add("walls");
  }

  const result = Array.from(set);
  console.log(`[inferZonesFromLots] lots: [${lots.join(", ")}] → zones: [${result.join(", ")}]`);
  return result;
}

// ── Debug helper ───────────────────────────────────────────────────

/**
 * Génère une image PNG visible du mask pour debug (à injecter dans un <img>).
 * Ajoute un contour rouge sur les zones blanches.
 */
export async function buildDebugMaskDataUrl(config: ZoningConfig): Promise<string> {
  const { width, height } = config;

  // Générer le mask
  const maskDataUrl = await buildMaskBase64(config);

  // Créer un canvas de superposition
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return maskDataUrl;

  // Dessiner le mask
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.src = maskDataUrl;
  });

  // Coloriser en rouge semi-transparent les zones blanches
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200) { // pixel blanc
      data[i] = 255;     // R
      data[i + 1] = 80;  // G
      data[i + 2] = 80;  // B
      data[i + 3] = 160; // A (semi-transparent)
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}