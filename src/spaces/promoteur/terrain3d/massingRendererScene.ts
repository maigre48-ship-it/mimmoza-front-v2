// massingRendererScene.ts — V3.3
// ═══════════════════════════════════════════════════════════════════════════════
// V3.3 vs V3.2 — post-processing À SÉCURITÉ INTÉGRÉE (fini l'écran blanc) :
//   • Le composer ne peut plus casser le rendu :
//       - construction dans un try/catch (si une passe échoue → composer = null)
//       - renderFrame() : composer.render() dans un try ; au MOINDRE throw, on
//         bascule définitivement sur renderer.render(scene, camera).
//     → si quoi que ce soit foire, tu vois le rendu de base (lumière améliorée),
//       jamais un écran blanc.
//   • Construction progressive et tolérante aux versions de three :
//       - OutputPass absent (< r152) → repli sur GammaCorrectionShader (ShaderPass)
//       - SSAO / SMAA protégés individuellement
//   • Diagnostic : chaque échec est loggé en console (préfixe [MassingScene]).
//
// V3.2 — lumière : soleil dominant + ambiant modéré (conservé tel quel).
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ─── Réglages globaux ──────────────────────────────────────────────────────────

const TONE_EXPOSURE = 1.15;   // exposition ACES (source unique)
const ENABLE_POST   = false;  // ← false = rendu direct renderer.render, aucun post-processing
const ENABLE_SSAO   = false;  // ← false = pas d'occlusion ambiante (mais AA + tone mapping gardés)
const ENABLE_SMAA   = true;  // ← false = pas d'anti-aliasing post (le MSAA du renderer reste off sous composer)

const SSAO_KERNEL_RADIUS = 6;
const SSAO_MIN_DISTANCE  = 0.001;
const SSAO_MAX_DISTANCE  = 0.06;

// ─── Types ───────────────────────────────────────────────────────────────────

// EffectComposer typé en `any` : import dynamique tolérant, pas de dépendance dure.
type AnyComposer = {
  setPixelRatio: (r: number) => void;
  setSize: (w: number, h: number) => void;
  addPass: (p: unknown) => void;
  render: () => void;
  dispose: () => void;
};

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  composer: AnyComposer | null;
  controls: OrbitControls;
  buildingsGroup: THREE.Group;
  groundGroup: THREE.Group;
  labelContainer: HTMLDivElement;
  animId: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function disposeMaterial(material: THREE.Material): void {
  const m = material as THREE.Material & {
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
    bumpMap?: THREE.Texture | null;
    displacementMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
    envMap?: THREE.Texture | null;
    lightMap?: THREE.Texture | null;
  };

  const textures = [
    m.map, m.normalMap, m.roughnessMap, m.aoMap, m.metalnessMap,
    m.alphaMap, m.bumpMap, m.displacementMap, m.emissiveMap, m.envMap, m.lightMap,
  ];
  for (const tex of textures) {
    if (tex && typeof tex.dispose === "function") tex.dispose();
  }
  m.dispose();
}

function disposeObject3D(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach(disposeMaterial);
  else if (material) disposeMaterial(material);
}

// ─── Construction du composer (tolérante aux versions, jamais bloquante) ───────
//
// Retourne null si l'EffectComposer ou ses passes essentielles ne sont pas
// disponibles → le rendu retombera sur renderer.render(scene, camera).
//
// Imports dynamiques : on tente les modules ; si l'un manque dans la version de
// three installée, l'erreur est attrapée et on renvoie null (rendu direct).

async function tryBuildComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  dpr: number,
): Promise<AnyComposer | null> {
  try {
    const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
    const { RenderPass }     = await import("three/addons/postprocessing/RenderPass.js");

    const composer = new EffectComposer(renderer) as unknown as AnyComposer;
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);

    // ── Passe de base : SSAO si possible, sinon RenderPass ──
    let basePassAdded = false;
    if (ENABLE_SSAO) {
      try {
        const { SSAOPass } = await import("three/addons/postprocessing/SSAOPass.js");
        const ssao = new SSAOPass(scene, camera, w, h);
        (ssao as unknown as { kernelRadius: number }).kernelRadius = SSAO_KERNEL_RADIUS;
        (ssao as unknown as { minDistance: number }).minDistance   = SSAO_MIN_DISTANCE;
        (ssao as unknown as { maxDistance: number }).maxDistance   = SSAO_MAX_DISTANCE;
        composer.addPass(ssao);
        basePassAdded = true;
      } catch (e) {
        console.warn("[MassingScene] SSAO indisponible, repli RenderPass :", e);
      }
    }
    if (!basePassAdded) {
      composer.addPass(new RenderPass(scene, camera));
    }

    // ── Anti-aliasing (optionnel) ──
    if (ENABLE_SMAA) {
      try {
        const { SMAAPass } = await import("three/addons/postprocessing/SMAAPass.js");
        composer.addPass(new SMAAPass());
      } catch (e) {
        console.warn("[MassingScene] SMAA indisponible, ignoré :", e);
      }
    }

    // ── Sortie : OutputPass (ACES + sRGB) ; repli GammaCorrection si absent ──
    let outputAdded = false;
    try {
      const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");
      composer.addPass(new OutputPass());
      outputAdded = true;
    } catch {
      // three < r152 : pas d'OutputPass.
    }
    if (!outputAdded) {
      try {
        const { ShaderPass }            = await import("three/addons/postprocessing/ShaderPass.js");
        const { GammaCorrectionShader } = await import("three/addons/shaders/GammaCorrectionShader.js");
        composer.addPass(new ShaderPass(GammaCorrectionShader));
        console.info("[MassingScene] OutputPass absent → GammaCorrectionShader utilisé.");
      } catch (e) {
        console.warn("[MassingScene] Aucune passe de sortie disponible :", e);
      }
    }

    return composer;
  } catch (e) {
    console.warn("[MassingScene] EffectComposer indisponible → rendu direct :", e);
    return null;
  }
}

// ─── Factory scène ───────────────────────────────────────────────────────────

export function createSceneContext(mount: HTMLDivElement): SceneContext {
  const w = mount.clientWidth || 800;
  const h = mount.clientHeight || 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setSize(w, h);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = TONE_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.sortObjects = true;
  mount.appendChild(renderer.domElement);

  // ── Scène ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7e3ee);
  scene.fog = new THREE.FogExp2(0xd7e3ee, 0.00135);

  // ── Lighting (V3.2 : soleil dominant + ambiant modéré) ──────────────────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  ambient.name = "ambient";
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xddebf7, 0xb49b7f, 0.90);
  hemi.name = "hemi";
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff7ea, 1.7);
  sun.name = "sun";
  sun.position.set(95, 135, 72);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.bias = -0.00045;
  sun.shadow.normalBias = 0.02;

  const fill = new THREE.DirectionalLight(0xcbd9f0, 0.28);
  fill.name = "fill";
  fill.position.set(-75, 58, -46);
  scene.add(fill);

  const back = new THREE.DirectionalLight(0xf1e8d8, 0.12);
  back.name = "back";
  back.position.set(-20, 42, -135);
  scene.add(back);

  const front = new THREE.DirectionalLight(0xf3f6fb, 0.10);
  front.name = "front";
  front.position.set(20, 35, 110);
  scene.add(front);

  // ── Caméra ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(42, w / h, 0.35, 3000);
  camera.position.set(0, 120, -80);
  camera.lookAt(0, 10, 0);

  // ── Controls ──────────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 5;
  controls.maxDistance = 900;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 8, 0);
  controls.update();

  // ── Groupes ───────────────────────────────────────────────────────────────
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = "buildings";
  scene.add(buildingsGroup);

  const groundGroup = new THREE.Group();
  groundGroup.name = "ground";
  scene.add(groundGroup);

  // ── Labels HTML ───────────────────────────────────────────────────────────
  const labelContainer = document.createElement("div");
  labelContainer.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;";
  mount.appendChild(labelContainer);

  // ── Contexte (composer rempli en asynchrone ci-dessous) ─────────────────────
  const ctx: SceneContext = {
    scene, camera, renderer, composer: null, controls,
    buildingsGroup, groundGroup, labelContainer, animId: 0,
  };

  // ── Boucle de rendu — À SÉCURITÉ INTÉGRÉE ───────────────────────────────────
  // Tant que le composer n'est pas prêt (ou s'il a échoué), on rend en direct.
  // Si composer.render() lève une exception une seule fois, on le désactive
  // définitivement et on bascule sur renderer.render → jamais d'écran blanc.
  let composerBroken = false;
  const renderFrame = () => {
    if (ENABLE_POST && ctx.composer && !composerBroken) {
      try {
        ctx.composer.render();
        return;
      } catch (e) {
        composerBroken = true;
        ctx.composer = null;
        console.error("[MassingScene] composer.render a échoué → rendu direct définitif :", e);
      }
    }
    renderer.render(scene, camera);
  };

  const tick = () => {
    ctx.animId = requestAnimationFrame(tick);
    controls.update();
    renderFrame();
  };
  tick();

  // ── Tentative de branchement du post-processing (non bloquante) ─────────────
  if (ENABLE_POST) {
    tryBuildComposer(renderer, scene, camera, w, h, dpr)
      .then((composer) => {
        if (composer && !composerBroken) {
          ctx.composer = composer;
          console.info("[MassingScene] post-processing actif.");
        } else if (!composer) {
          console.info("[MassingScene] post-processing indisponible → rendu direct.");
        }
      })
      .catch((e) => {
        console.warn("[MassingScene] init post-processing échouée → rendu direct :", e);
      });
  }

  return ctx;
}

// ─── Resize ──────────────────────────────────────────────────────────────────

export function handleResize(ctx: SceneContext, mount: HTMLDivElement): void {
  const w = mount.clientWidth;
  const h = mount.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.camera.aspect = w / h;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(w, h);
  ctx.renderer.setPixelRatio(dpr);
  if (ctx.composer) {
    try {
      ctx.composer.setPixelRatio(dpr);
      ctx.composer.setSize(w, h);
    } catch (e) {
      console.warn("[MassingScene] composer.setSize a échoué :", e);
    }
  }
}

// ─── Fit caméra ──────────────────────────────────────────────────────────────
// Vue nord-haut, alignée avec la carte 2D.
//   +X = est · +Z = nord · +Y = altitude
//   → caméra au SUD du centre, regardant le NORD, légèrement à l'OUEST.
// ─────────────────────────────────────────────────────────────────────────────

export function fitCameraToBox(
  ctx: SceneContext,
  center: THREE.Vector3,
  size: THREE.Vector3,
): void {
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim < 0.1) return;

  const fov = ctx.camera.fov * (Math.PI / 180);
  const dist = ((maxDim / 2) / Math.tan(fov / 2)) * 1.75;

  const southOffset  = dist * 0.72;
  const westOffset   = dist * 0.08;
  const heightOffset = dist * 0.88;

  ctx.camera.position.set(
    center.x - westOffset,
    center.y + heightOffset,
    center.z - southOffset,
  );

  ctx.camera.near = Math.max(0.1, dist / 800);
  ctx.camera.far  = Math.max(2000, dist * 8);
  ctx.camera.updateProjectionMatrix();

  ctx.controls.target.copy(center);
  ctx.controls.update();

  const sun = ctx.scene.getObjectByName("sun") as THREE.DirectionalLight | undefined;
  if (sun) {
    const margin = Math.max(maxDim * 1.35, 60);
    sun.shadow.camera.left   = -margin;
    sun.shadow.camera.right  =  margin;
    sun.shadow.camera.top    =  margin;
    sun.shadow.camera.bottom = -margin;
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = Math.max(600, maxDim * 6);
    sun.shadow.camera.updateProjectionMatrix();

    // Direction solaire stable, recalée sur le centre.
    const sunDist = Math.max(maxDim * 1.6, 120);
    sun.position.set(
      center.x + sunDist * 0.55,
      center.y + sunDist * 0.85,
      center.z + sunDist * 0.42,
    );
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
  }
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

export function disposeSceneContext(ctx: SceneContext, mount: HTMLDivElement): void {
  cancelAnimationFrame(ctx.animId);
  ctx.controls.dispose();
  if (ctx.composer) {
    try { ctx.composer.dispose(); } catch { /* no-op */ }
  }
  disposeGroup(ctx.buildingsGroup);
  disposeGroup(ctx.groundGroup);
  ctx.scene.traverse((obj) => {
    const light = obj as THREE.DirectionalLight;
    if ((light as any).isLight && light.shadow?.map) light.shadow.map.dispose();
  });
  ctx.renderer.dispose();
  if (ctx.renderer.domElement.parentNode === mount) mount.removeChild(ctx.renderer.domElement);
  if (ctx.labelContainer.parentNode === mount) mount.removeChild(ctx.labelContainer);
}

// ─── Dispose group ────────────────────────────────────────────────────────────

export function disposeGroup(group: THREE.Group): void {
  const children = [...group.children];
  for (const child of children) {
    child.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) disposeObject3D(obj);
    });
    group.remove(child);
  }
}