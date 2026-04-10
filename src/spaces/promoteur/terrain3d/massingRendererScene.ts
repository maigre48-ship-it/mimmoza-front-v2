// massingRendererScene.ts — V3.1
// ═══════════════════════════════════════════════════════════════════════════════
// V3.1 vs V3 premium :
// - fitCameraToBox repositionnée : caméra AU SUD du centre, regardant NORD
//   → la vue 3D est nord-haut, alignée avec la carte 2D
// - heightFactor augmenté pour vue plus aérienne (bird's eye)
// - légère translation ouest pour perspective naturelle
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
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

// ─── Factory scène ───────────────────────────────────────────────────────────

export function createSceneContext(mount: HTMLDivElement): SceneContext {
  const w = mount.clientWidth || 800;
  const h = mount.clientHeight || 600;

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.sortObjects = true;
  mount.appendChild(renderer.domElement);

  // ── Scène ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7e3ee);
  scene.fog = new THREE.FogExp2(0xd7e3ee, 0.00135);

  // ── Lighting ──────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xddebf7, 0xb49b7f, 0.88);
  hemi.name = "hemi";
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff7ea, 2.25);
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

  const fill = new THREE.DirectionalLight(0xcbd9f0, 0.52);
  fill.name = "fill";
  fill.position.set(-75, 58, -46);
  scene.add(fill);

  const back = new THREE.DirectionalLight(0xf1e8d8, 0.22);
  back.name = "back";
  back.position.set(-20, 42, -135);
  scene.add(back);

  const front = new THREE.DirectionalLight(0xf3f6fb, 0.18);
  front.name = "front";
  front.position.set(20, 35, 110);
  scene.add(front);

  // ── Caméra ────────────────────────────────────────────────────────────────
  // Position initiale provisoire — sera remplacée par fitCameraToBox
  const camera = new THREE.PerspectiveCamera(42, w / h, 0.35, 3000);
  camera.position.set(0, 120, -80);   // Au-dessus, légèrement au SUD
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

  // ── Boucle de rendu ───────────────────────────────────────────────────────
  let animId = 0;
  const tick = () => {
    animId = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  return { scene, camera, renderer, controls, buildingsGroup, groundGroup, labelContainer, animId };
}

// ─── Resize ──────────────────────────────────────────────────────────────────

export function handleResize(ctx: SceneContext, mount: HTMLDivElement): void {
  const w = mount.clientWidth;
  const h = mount.clientHeight;
  if (!w || !h) return;
  ctx.camera.aspect = w / h;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(w, h);
  ctx.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}

// ─── Fit caméra ──────────────────────────────────────────────────────────────
// Orientation nord-haut, alignée avec la carte 2D.
//
// Système de coordonnées de la scène :
//   +X = est (longitude croissante)
//   +Z = nord (latitude croissante)
//   +Y = altitude
//
// Pour une vue nord-haut (comme la carte 2D) :
//   → caméra positionnée AU SUD du centre (Z négatif par rapport au centre)
//   → regardant vers le NORD (vers Z positif / le centre)
//   → légèrement à l'OUEST pour une perspective naturelle
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

  // Caméra au SUD du centre, haute, légèrement à l'ouest
  // → vue nord-haut comme la carte 2D
  const southOffset  = dist * 0.72;   // Distance vers le sud (Z négatif)
  const westOffset   = dist * 0.08;   // Très légère décalage ouest pour perspective
  const heightOffset = dist * 0.88;   // Hauteur au-dessus du centre

  ctx.camera.position.set(
    center.x - westOffset,             // Légèrement à l'OUEST
    center.y + heightOffset,            // AU-DESSUS
    center.z - southOffset,             // AU SUD (Z négatif = sud dans notre scène)
  );

  ctx.camera.near = Math.max(0.1, dist / 800);
  ctx.camera.far  = Math.max(2000, dist * 8);
  ctx.camera.updateProjectionMatrix();

  ctx.controls.target.copy(center);
  ctx.controls.update();

  // Ajustement shadow frustum au volume de la scène
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
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
  }
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

export function disposeSceneContext(ctx: SceneContext, mount: HTMLDivElement): void {
  cancelAnimationFrame(ctx.animId);
  ctx.controls.dispose();
  disposeGroup(ctx.buildingsGroup);
  disposeGroup(ctx.groundGroup);
  ctx.scene.traverse((obj) => {
    const light = obj as THREE.Light;
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