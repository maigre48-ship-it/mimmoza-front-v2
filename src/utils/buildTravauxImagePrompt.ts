// src/utils/buildTravauxImagePrompt.ts
//
// V6 — Prompt affirmatif + type de sol + couleurs personnalisées sol/murs + mobilier

import type {
  TravauxRenduConfig,
  TravauxSolType,
} from "../spaces/marchand/types/rendutravaux.types";
import type { TravauxZone } from "./buildTravauxZoning";

// ── Config étendue / rétrocompatibilité ────────────────────────────
interface TravauxRenduConfigV6 extends TravauxRenduConfig {
  mobilier?: string; // "none" | "scandinave" | "contemporain" | ...

  // Anciens champs encore tolérés si présents dans du vieux code
  couleurSol?: string;
  couleurMurs?: string;
}

// ── Types ──────────────────────────────────────────────────────────

export interface TravauxPromptConfig {
  config: TravauxRenduConfigV6;
  style?: string;
  roomHint?: string;
  zones?: TravauxZone[];
  extraInstructions?: string;
}

export interface TravauxPromptResult {
  prompt: string;
  negativePrompt: string;
  summary: string;
  debugTokenCount: number;
}

// ── Mappings matériaux par type de sol ─────────────────────────────

const FLOOR_TYPE_DESCRIPTIONS: Record<TravauxSolType, string> = {
  carrelage: "large-format porcelain tile flooring with visible fine grout lines",
  parquet: "natural wood parquet flooring with long planks and realistic grain",
  moquette: "soft fitted carpet flooring with subtle textile texture",
  tapis: "a large decorative area rug placed over the existing floor",
  coco: "natural coir fiber flooring with woven texture",
  beton_cire: "seamless polished micro-cement flooring with mineral matte finish",
  pierre_naturelle: "natural stone flooring with subtle irregular mineral texture",
  vinyle: "high-quality vinyl plank flooring with realistic texture",
  stratifie: "laminate flooring with realistic wood effect",
  terre_cuite: "terracotta tile flooring with warm clay tone and visible joints",
  resine: "smooth resin flooring with seamless satin finish",
  marbre: "large-format marble flooring with elegant natural veining",
};

// ── Mappings matériaux par gamme + style ───────────────────────────

const FLOOR_MATERIALS: Record<string, Record<string, string>> = {
  economique: {
    contemporain: "light grey laminate flooring with fine wood grain",
    haussmannien: "light oak laminate with chevron pattern",
    scandinave: "white-washed pine laminate",
    industriel: "dark grey vinyl plank flooring",
    minimaliste: "smooth light beige laminate",
    default: "mid-tone laminate flooring",
  },
  standard: {
    contemporain: "light natural oak engineered parquet",
    haussmannien: "classic herringbone oak parquet, warm honey tone",
    scandinave: "wide-plank light birch parquet",
    industriel: "dark stained wide-plank wood flooring",
    minimaliste: "pale ash engineered parquet, matte finish",
    default: "engineered oak parquet",
  },
  premium: {
    contemporain: "wide-plank light ash solid wood floor, matte oiled finish",
    haussmannien: "antique-style chevron oak parquet, deep amber tone",
    scandinave: "wide plank natural pine, lightly oiled",
    industriel: "dark fumed oak solid wood, raw finish",
    minimaliste: "extra-wide pale oak planks, totally flat matte",
    default: "solid oak floor, oiled finish",
  },
  luxe: {
    contemporain: "large format Calacatta marble-look porcelain tiles, book-matched",
    haussmannien: "Versailles pattern solid oak parquet, antique finish",
    scandinave: "seamless white micro-cement floor",
    industriel: "polished concrete floor with aggregate visible",
    minimaliste: "seamless large-format stone-look porcelain",
    default: "marble or high-end stone flooring",
  },
};

const WALL_MATERIALS: Record<string, Record<string, string>> = {
  economique: {
    contemporain: "smooth matte paint",
    haussmannien: "satin paint with subtle texture",
    scandinave: "matte paint",
    industriel: "matte paint",
    minimaliste: "flat paint, perfectly smooth",
    default: "matte paint",
  },
  standard: {
    contemporain: "satin paint, clean finish",
    haussmannien: "satin paint with subtle texture",
    scandinave: "matte paint with soft finish",
    industriel: "matte paint",
    minimaliste: "eggshell paint, perfectly smooth",
    default: "neutral satin paint",
  },
  premium: {
    contemporain: "smooth plaster, fine texture, matte",
    haussmannien: "Haussmann-style decorative plaster with cornice moldings",
    scandinave: "smooth limewash walls, subtle texture",
    industriel: "exposed raw concrete wall, lightly sealed",
    minimaliste: "seamless micro-cement walls",
    default: "premium plaster finish",
  },
  luxe: {
    contemporain: "full-height stone cladding panels",
    haussmannien: "gilded Haussmann moldings, hand-applied marmorino plaster",
    scandinave: "bespoke shiplap paneling",
    industriel: "raw brick wall with protective clear sealant",
    minimaliste: "floor-to-ceiling seamless stone veneer panels",
    default: "luxury wall finish",
  },
};

const CEILING_MATERIALS: Record<string, Record<string, string>> = {
  economique: { default: "clean flat white paint ceiling" },
  standard: { default: "white satin ceiling with recessed LED spots" },
  premium: {
    contemporain: "smooth white ceiling with integrated LED strip lighting",
    haussmannien: "white ornate plaster ceiling with central rosette and cornice",
    default: "white ceiling with subtle architectural detail",
  },
  luxe: {
    contemporain: "backlit coffered ceiling with hidden LED",
    haussmannien: "elaborate Haussmann plaster ceiling with gilded rosette",
    default: "luxury ceiling with decorative lighting",
  },
};

function floorDesc(gamme: string, style: string, solType?: TravauxSolType): string {
  if (solType) {
    return FLOOR_TYPE_DESCRIPTIONS[solType] ?? "new flooring";
  }

  const g = FLOOR_MATERIALS[gamme] ?? FLOOR_MATERIALS.standard;
  return g[style] ?? g.default ?? "new flooring";
}

function wallDesc(gamme: string, style: string): string {
  const g = WALL_MATERIALS[gamme] ?? WALL_MATERIALS.standard;
  return g[style] ?? g.default ?? "new wall finish";
}

function ceilingDesc(gamme: string, style: string): string {
  const g = CEILING_MATERIALS[gamme] ?? CEILING_MATERIALS.standard;
  return g[style] ?? g.default ?? "new ceiling finish";
}

function kitchenDesc(gamme: string): string {
  return (
    {
      economique: "flat-panel white kitchen cabinets with laminate worktop",
      standard: "shaker-style kitchen in light grey with quartz worktop",
      premium: "handleless kitchen in matte lacquer with stone worktop",
      luxe: "bespoke kitchen in solid wood veneer with Calacatta marble worktop",
    }[gamme] ?? "new modern kitchen"
  );
}

function bathroomDesc(gamme: string): string {
  return (
    {
      economique: "white ceramic tiles, basic white sanitaryware",
      standard: "large-format light grey porcelain tiles, wall-hung toilet, modern basin",
      premium: "book-matched Statuario marble tiles, freestanding bathtub, brushed brass fixtures",
      luxe: "full Calacatta marble bathroom, custom vanity, rain shower, heated floors",
    }[gamme] ?? "renovated bathroom"
  );
}

function openingsDesc(gamme: string): string {
  return (
    {
      economique: "white-painted wooden window frames",
      standard: "new white PVC double-glazed windows",
      premium: "anthracite aluminium windows, slim frames",
      luxe: "steel Crittal-style windows, black slim frames",
    }[gamme] ?? "new windows"
  );
}

function floorTypeLabel(solType?: TravauxSolType): string | null {
  if (!solType) return null;

  return (
    {
      carrelage: "carrelage / tile",
      parquet: "parquet / wood flooring",
      moquette: "moquette / carpet",
      tapis: "tapis / area rug",
      coco: "coco / natural coir fiber",
      beton_cire: "béton ciré / polished micro-cement",
      pierre_naturelle: "pierre naturelle / natural stone",
      vinyle: "vinyle / vinyl flooring",
      stratifie: "stratifié / laminate flooring",
      terre_cuite: "terre cuite / terracotta tiles",
      resine: "résine / resin flooring",
      marbre: "marbre / marble flooring",
    }[solType] ?? solType
  );
}

// ── Builder principal ──────────────────────────────────────────────

export function buildTravauxImagePrompt(params: TravauxPromptConfig): TravauxPromptResult {
  const { config, style, roomHint, zones = ["floor", "walls"], extraInstructions } = params;

  const {
    gamme = "standard",
    niveau = "renovation_complete",
    surfaceM2,
    typeBien,
    ville,
    styleDecoration,
    mobilier,
    solType,
    solColor,
    murColor,
    couleurSol,
    couleurMurs,
  } = config;

  const effectiveStyle = style || styleDecoration || "contemporain";

  // Nouveaux champs prioritaires, anciens champs en fallback.
  const finalSolColor = solColor ?? couleurSol;
  const finalMurColor = murColor ?? couleurMurs;

  // ── Contexte ─────────────────────────────────────────────────────
  const contextParts: string[] = [];
  if (typeBien) contextParts.push(typeBien);
  if (surfaceM2) contextParts.push(`${surfaceM2} m²`);
  if (ville) contextParts.push(ville);

  const contextStr = contextParts.length > 0 ? contextParts.join(", ") : "residential interior";
  const roomStr = roomHint || "interior room";

  // ── Descriptions par zone avec matériaux/couleurs ────────────────
  const zoneDescLines: string[] = [];

  for (const zone of zones) {
    switch (zone) {
      case "floor": {
        const mat = floorDesc(gamme, effectiveStyle, solType);
        const color = finalSolColor ? ` The floor color tone must be ${finalSolColor}.` : "";
        const strictType = solType
          ? ` The floor material/type is strictly ${floorTypeLabel(solType)}; do not replace it with another floor material.`
          : "";

        zoneDescLines.push(`FLOOR: Replace the visible floor with ${mat}.${color}${strictType}`);
        break;
      }

      case "walls": {
        const mat = wallDesc(gamme, effectiveStyle);
        const color = finalMurColor ? ` Wall color must be ${finalMurColor}.` : "";

        zoneDescLines.push(`WALLS: Apply ${mat}.${color}`);
        break;
      }

      case "ceiling":
        zoneDescLines.push(`CEILING: Apply ${ceilingDesc(gamme, effectiveStyle)}.`);
        break;

      case "kitchen":
        zoneDescLines.push(`KITCHEN: Install ${kitchenDesc(gamme)}.`);
        break;

      case "bathroom":
        zoneDescLines.push(`BATHROOM: Install ${bathroomDesc(gamme)}.`);
        break;

      case "openings":
        zoneDescLines.push(`WINDOWS & DOORS: Replace frames with ${openingsDesc(gamme)}.`);
        break;

      case "all":
        zoneDescLines.push(`ALL SURFACES: Full ${effectiveStyle} style renovation with ${gamme}-grade materials.`);
        break;
    }
  }

  // ── Mobilier ─────────────────────────────────────────────────────
  const hasMobilier = mobilier && mobilier !== "none";

  const mobilierDesc: Record<string, string> = {
    scandinave: "Scandinavian furniture: light oak dining table, linen sofa, simple shelving, soft wool rug",
    contemporain: "contemporary furniture: low-profile sofa in grey, glass coffee table, minimalist shelves",
    industriel: "industrial furniture: metal and wood table, leather sofa, open steel shelving, Edison pendant",
    luxe: "luxury furniture: velvet sofa, marble side tables, designer armchairs, statement chandelier",
    japandi: "Japandi furniture: low platform sofa, natural linen, rattan details, wabi-sabi ceramics",
    vintage: "vintage furniture: mid-century modern sofa, retro armchair, warm teak sideboard, geometric rug",
  };

  const mobilierLine = hasMobilier
    ? `FURNISHING: Stage the room with ${mobilierDesc[mobilier!] ?? `${mobilier} style furniture`}. Arrange naturally for a real estate photo.`
    : `FURNISHING: Leave the room completely empty — no furniture, no objects.`;

  // ── Verrou architectural ─────────────────────────────────────────
  const architecturalLock = [
    `ABSOLUTE RULE — READ FIRST:`,
    `This is a surface-only renovation. You are ONLY allowed to change visible floor, wall, and ceiling finishes, plus furnishing only if explicitly requested.`,
    `You must NEVER add, create, suggest, or show: new doors, new openings, new passageways, adjacent rooms, bathrooms, hallways, or any space not already visible in the input image.`,
    `If the original image shows a wall, that wall must remain a solid wall — do NOT open it.`,
    `If the original image shows no door, there must be no door in the output.`,
    `The room boundary, shape, proportions, camera angle, perspective, window position, and all architectural openings must be identical to the original.`,
  ].join(" ");

  const floorLock = solType
    ? [
        `FLOOR MATERIAL LOCK:`,
        `The floor must visibly read as ${floorTypeLabel(solType)}.`,
        `Do not turn it into parquet, wood, tiles, carpet, rug, stone, marble, concrete, resin, or vinyl unless that exact type was selected.`,
      ].join(" ")
    : "";

  // ── Prompt ───────────────────────────────────────────────────────
  const sections: string[] = [
    architecturalLock,
    floorLock,
    `Interior renovation photo of a ${roomStr} (${contextStr}).`,
    `Renovation level: ${niveau}. Renovation style: ${effectiveStyle}. Material grade: ${gamme}.`,
    ...zoneDescLines,
    mobilierLine,
    `Preserve the exact camera angle, perspective, room layout, window locations, wall boundaries, ceiling height, and visible geometry.`,
    `Output: photorealistic real estate photography, natural daylight, professional interior photographer, sharp and clean.`,
    ...(extraInstructions ? [extraInstructions] : []),
  ].filter(Boolean);

  const prompt = sections.join(" ");

  // ── Summary ──────────────────────────────────────────────────────
  const summaryParts = [
    gamme,
    effectiveStyle,
    `zones: [${zones.join(", ")}]`,
    solType ? `sol type: ${floorTypeLabel(solType)}` : null,
    hasMobilier ? `🛋️ ${mobilier}` : "vide",
    finalSolColor ? `sol: ${finalSolColor}` : null,
    finalMurColor ? `murs: ${finalMurColor}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const debugTokenCount = Math.round(prompt.split(/\s+/).length * 1.3);

  console.log("[buildTravauxImagePrompt] Prompt V6", {
    zones,
    gamme,
    niveau,
    style: effectiveStyle,
    solType,
    solColor: finalSolColor,
    murColor: finalMurColor,
    mobilier,
    tokenEstimate: debugTokenCount,
    promptLength: prompt.length,
    promptPreview: prompt.slice(0, 180) + "…",
  });

  return {
    prompt,
    negativePrompt:
      "blurry, distorted, cartoon, overexposed, different room, changed layout, extra door, new opening, hallway, adjacent room, invented bathroom, invented kitchen, people, text, watermark, logo, low quality",
    summary: summaryParts,
    debugTokenCount,
  };
}