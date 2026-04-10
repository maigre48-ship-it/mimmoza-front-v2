// src/spaces/promoteur/terrain3d/renderScenePresets.ts
import * as THREE from "three";

export interface SceneRenderPreset {
  shadowStrength:   number;
  lightIntensity:   number;
  ambientIntensity: number;
  contrast:         number;
  saturation:       number;
  exposure:         number;
  shadowRadius:     number;
}

export const SCENE_PRESETS: Record<string, SceneRenderPreset> = {
  esquisse_blanche:      { shadowStrength: 0.20, lightIntensity: 0.60, ambientIntensity: 1.80, contrast: 0.88, saturation: 0.12, exposure: 1.10, shadowRadius: 10 },
  aquarelle:             { shadowStrength: 0.35, lightIntensity: 0.80, ambientIntensity: 1.60, contrast: 0.90, saturation: 0.65, exposure: 1.08, shadowRadius: 8  },
  realiste_doux:         { shadowStrength: 0.55, lightIntensity: 1.40, ambientIntensity: 1.20, contrast: 1.00, saturation: 1.00, exposure: 1.12, shadowRadius: 5  },
  promoteur_premium:     { shadowStrength: 0.70, lightIntensity: 1.80, ambientIntensity: 1.00, contrast: 1.08, saturation: 1.10, exposure: 1.15, shadowRadius: 4  },
  comite_investissement: { shadowStrength: 0.50, lightIntensity: 1.20, ambientIntensity: 1.40, contrast: 1.05, saturation: 0.85, exposure: 1.10, shadowRadius: 6  },
};

export const FALLBACK_SCENE: SceneRenderPreset = SCENE_PRESETS.promoteur_premium;

export function getScenePreset(intent: string | undefined): SceneRenderPreset {
  return SCENE_PRESETS[intent ?? ""] ?? FALLBACK_SCENE;
}

const INTENT_PRIORITY = ["comite_investissement","promoteur_premium","realiste_doux","aquarelle","esquisse_blanche"] as const;

export function pickDominantIntent(intents: Set<string>, fallback = "promoteur_premium"): string {
  for (const p of INTENT_PRIORITY) { if (intents.has(p)) return p; }
  return fallback;
}

export interface SceneAmbiance {
  intent: string; lightIntensity: number; ambientIntensity: number; shadowRadius: number; exposure: number;
}

export function buildAmbianceFromIntent(intent: string): SceneAmbiance {
  const p = getScenePreset(intent);
  return { intent, lightIntensity: p.lightIntensity, ambientIntensity: p.ambientIntensity, shadowRadius: p.shadowRadius, exposure: p.exposure };
}

export function applySceneAmbiance(scene: THREE.Scene, renderer: THREE.WebGLRenderer, ambiance: SceneAmbiance): void {
  renderer.toneMappingExposure = ambiance.exposure;
  scene.traverse((obj) => {
    if (obj instanceof THREE.HemisphereLight) obj.intensity = ambiance.ambientIntensity;
    if (obj instanceof THREE.DirectionalLight) { obj.intensity = ambiance.lightIntensity; if (obj.shadow) obj.shadow.radius = ambiance.shadowRadius; }
  });
}

export function applyIntentToColor(hex: string, intent: string | undefined): string {
  const preset = getScenePreset(intent);
  if (preset.saturation >= 0.98) return hex;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * preset.saturation, hsl.l);
  return "#" + c.getHexString();
}

export function applyIntentToScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer, intent: string | undefined): void {
  applySceneAmbiance(scene, renderer, buildAmbianceFromIntent(intent ?? "promoteur_premium"));
}
