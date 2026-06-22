// postProcessing.ts
// Pipeline "qualité plaquette" : SSAO (occlusion ambiante, ancre le bâtiment au sol et creuse
// les embrasures), léger bloom sur les hautes lumières, anti-aliasing SMAA, sortie ACES.
//
// ⚠️ Compatibilité : OutputPass requiert three >= r150. Vérifie ta version (`npm ls three`).
//   - Si three >= r150 : garde tel quel (OutputPass applique tone mapping + espace colorimétrique).
//   - Si plus ancien : retire OutputPass et ajoute un GammaCorrectionShader en dernier
//     (`import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js'`).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface PostOptions {
  ssao?: {
    kernelRadius?: number; // rayon d'échantillonnage (m d'échelle scène) — défaut 6
    minDistance?: number;  // défaut 0.002
    maxDistance?: number;  // défaut 0.08
    intensity?: number;    // 0..1 via output, géré par la passe — laissé par défaut
  };
  bloom?: {
    strength?: number;  // défaut 0.18 (subtil — plaquette, pas néon)
    radius?: number;    // défaut 0.5
    threshold?: number; // défaut 0.85
  };
  enableSSAO?: boolean;  // défaut true
  enableBloom?: boolean; // défaut true
  enableSMAA?: boolean;  // défaut true
}

export interface PostHandle {
  composer: EffectComposer;
  setSize: (w: number, h: number) => void;
  render: () => void;
  dispose: () => void;
}

export function setupPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  opts: PostOptions = {},
): PostHandle {
  const dpr = renderer.getPixelRatio();
  // cible multi-échantillonnée : AA propre même avec composer (three >= r138)
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);

  composer.addPass(new RenderPass(scene, camera));

  if (opts.enableSSAO !== false) {
    const ssao = new SSAOPass(scene, camera, width, height);
    ssao.kernelRadius = opts.ssao?.kernelRadius ?? 6;
    ssao.minDistance = opts.ssao?.minDistance ?? 0.002;
    ssao.maxDistance = opts.ssao?.maxDistance ?? 0.08;
    composer.addPass(ssao);
  }

  if (opts.enableBloom !== false) {
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      opts.bloom?.strength ?? 0.18,
      opts.bloom?.radius ?? 0.5,
      opts.bloom?.threshold ?? 0.85,
    );
    composer.addPass(bloom);
  }

  if (opts.enableSMAA !== false) {
    composer.addPass(new SMAAPass());
  }

  // OutputPass : tone mapping (ACES réglé sur le renderer) + conversion espace colorimétrique
  composer.addPass(new OutputPass());

  const setSize = (w: number, h: number) => composer.setSize(w, h);
  const render = () => composer.render();
  const dispose = () => composer.dispose();

  return { composer, setSize, render, dispose };
}