// src/spaces/promoteur/terrain3d/buildingRenderPresets.ts
// Source de vérité pour tous les presets visuels du moteur de rendu Mimmoza.

export interface FacadePreset { roughness: number; metalness: number; reliefStrength: number; textureScale: number; defaultColor: string; frameColor: string; glazingOpacity: number; }
export interface GlazingPreset { color: string; opacity: number; roughness: number; metalness: number; emissiveStrength: number; }
export interface RoofPreset { color: string; roughness: number; metalness: number; }
export interface RailingPreset { color: string; metalness: number; roughness: number; }

export const FACADE_PRESETS: Record<string, FacadePreset> = {
  enduit:       { roughness: 0.82, metalness: 0.00, reliefStrength: 0.20, textureScale: 1.0, defaultColor: "#E8E2D8", frameColor: "#C0BAB0", glazingOpacity: 0.72 },
  beton:        { roughness: 0.78, metalness: 0.02, reliefStrength: 0.18, textureScale: 1.0, defaultColor: "#C8C4BC", frameColor: "#8A9298", glazingOpacity: 0.68 },
  brique:       { roughness: 0.86, metalness: 0.00, reliefStrength: 0.42, textureScale: 0.8, defaultColor: "#C4826A", frameColor: "#7A5848", glazingOpacity: 0.70 },
  pierre:       { roughness: 0.88, metalness: 0.00, reliefStrength: 0.50, textureScale: 1.2, defaultColor: "#D4C8A8", frameColor: "#B0A888", glazingOpacity: 0.65 },
  zinc_metal:   { roughness: 0.38, metalness: 0.72, reliefStrength: 0.10, textureScale: 1.0, defaultColor: "#8A9298", frameColor: "#5A6268", glazingOpacity: 0.60 },
  bois_bardage: { roughness: 0.80, metalness: 0.00, reliefStrength: 0.35, textureScale: 0.9, defaultColor: "#A88060", frameColor: "#785840", glazingOpacity: 0.72 },
  mur_rideau:   { roughness: 0.08, metalness: 0.30, reliefStrength: 0.05, textureScale: 1.0, defaultColor: "#A8C0D0", frameColor: "#506070", glazingOpacity: 0.45 },
};
export const FALLBACK_FACADE: FacadePreset = FACADE_PRESETS.enduit;
export function getFacadePreset(family: string | undefined): FacadePreset { return FACADE_PRESETS[family ?? ""] ?? FALLBACK_FACADE; }

export const GLAZING_PRESETS: Record<string, GlazingPreset> = {
  enduit:       { color: "#A8C4D8", opacity: 0.72, roughness: 0.06, metalness: 0.12, emissiveStrength: 0.00 },
  beton:        { color: "#A0C0D0", opacity: 0.68, roughness: 0.08, metalness: 0.10, emissiveStrength: 0.00 },
  brique:       { color: "#B0C8D8", opacity: 0.70, roughness: 0.06, metalness: 0.10, emissiveStrength: 0.00 },
  pierre:       { color: "#C4B88A", opacity: 0.65, roughness: 0.04, metalness: 0.08, emissiveStrength: 0.00 },
  zinc_metal:   { color: "#90B0C8", opacity: 0.60, roughness: 0.04, metalness: 0.18, emissiveStrength: 0.02 },
  bois_bardage: { color: "#A8C0CC", opacity: 0.72, roughness: 0.07, metalness: 0.08, emissiveStrength: 0.00 },
  mur_rideau:   { color: "#88A8C0", opacity: 0.45, roughness: 0.03, metalness: 0.28, emissiveStrength: 0.03 },
};
export const FALLBACK_GLAZING: GlazingPreset = GLAZING_PRESETS.enduit;
export function getGlazingForFamily(family: string | undefined): GlazingPreset { return GLAZING_PRESETS[family ?? ""] ?? FALLBACK_GLAZING; }

export const ROOF_PRESETS: Record<string, RoofPreset> = {
  terrasse:    { color: "#C0BCBA", roughness: 0.90, metalness: 0.00 },
  vegetalisee: { color: "#6A8858", roughness: 0.94, metalness: 0.00 },
  inclinee:    { color: "#788898", roughness: 0.55, metalness: 0.18 },
};
export const FALLBACK_ROOF: RoofPreset = ROOF_PRESETS.terrasse;
export function getRoofPreset(roofType: string | undefined): RoofPreset { return ROOF_PRESETS[roofType ?? ""] ?? FALLBACK_ROOF; }

export const RAILING_PRESETS: Record<string, RailingPreset> = {
  metal:   { color: "#58626A", metalness: 0.82, roughness: 0.28 },
  glass:   { color: "#A8C0D0", metalness: 0.15, roughness: 0.04 },
  masonry: { color: "#C8C4BE", metalness: 0.00, roughness: 0.88 },
};
export const FALLBACK_RAILING: RailingPreset = RAILING_PRESETS.metal;
export function getRailingPreset(railingType: string | undefined): RailingPreset { return RAILING_PRESETS[railingType ?? ""] ?? FALLBACK_RAILING; }

export function legacyFacadeToFamily(legacyStyle: string | undefined): string {
  switch (legacyStyle) {
    case "vitrage": return "mur_rideau"; case "beton": return "beton";
    case "brique":  return "brique";     case "zinc":  return "zinc_metal";
    case "bois":    return "bois_bardage"; case "pierre": return "pierre";
    default: return "enduit";
  }
}
export function vegetationDensityForSiteFinish(siteFinish: string | undefined): number {
  switch (siteFinish) {
    case "raw": return 0.05; case "simple": return 0.25;
    case "landscaped": return 0.55; case "premium": return 0.85;
    default: return 0.25;
  }
}
export function defaultTreeCount(siteFinish: string | undefined): number {
  switch (siteFinish) {
    case "raw": return 0; case "simple": return 1;
    case "landscaped": return 3; case "premium": return 5;
    default: return 1;
  }
}
