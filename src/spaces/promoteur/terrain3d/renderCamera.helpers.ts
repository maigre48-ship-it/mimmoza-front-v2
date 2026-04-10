// src/spaces/promoteur/terrain3d/renderCamera.helpers.ts
// Helpers de cadrage caméra Three.js depuis BuildingBlenderSpec.
// ─────────────────────────────────────────────────────────────────────────────
// Champs lus depuis le spec réel :
//   spec.render.cameraView     → "aerial_3q" | "pedestrian" | "street_front" | "parcel_corner"
//   spec.render.focalLengthMm  → focale (défaut 50mm)
// ─────────────────────────────────────────────────────────────────────────────
// L'intégration se fait via fitCameraFromSpec() qui délègue à fitCameraToBox()
// (existant dans massingRendererScene) si le spec ne demande pas de vue spéciale.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import type { ResolvedCamera } from "./buildingRenderMapper";

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface SceneBBox {
  centerX: number;
  centerY: number;
  centerZ: number;
  sizeX:   number;
  sizeY:   number;
  sizeZ:   number;
  radius:  number;
}

export interface CameraFraming {
  position: THREE.Vector3;
  target:   THREE.Vector3;
  near:     number;
  far:      number;
}

// ═════════════════════════════════════════════════════════════════════════════
// BBOX DEPUIS Box3
// ═════════════════════════════════════════════════════════════════════════════

export function bboxFromBox3(box: THREE.Box3): SceneBBox | null {
  if (box.isEmpty()) return null;

  const center = new THREE.Vector3();
  const size   = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const radius = Math.max(Math.hypot(size.x, size.z) / 2, 5);

  return {
    centerX: center.x,
    centerY: center.y,
    centerZ: center.z,
    sizeX:   size.x,
    sizeY:   size.y,
    sizeZ:   size.z,
    radius,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// FACTEUR FOCALE (35mm = référence neutre)
// ═════════════════════════════════════════════════════════════════════════════

function focalFactor(focalMm: number): number {
  return Math.max(0.5, focalMm / 35);
}

// ═════════════════════════════════════════════════════════════════════════════
// CALCULS PAR TYPE DE VUE
// ═════════════════════════════════════════════════════════════════════════════

function frameAerial3q(bbox: SceneBBox, focalMm: number): CameraFraming {
  const dist = bbox.radius * 2.0 * focalFactor(focalMm);
  const h    = Math.max(bbox.sizeY * 0.9, bbox.radius * 0.7);

  return {
    position: new THREE.Vector3(
      bbox.centerX - dist * 0.08,
      bbox.centerY + h + dist * 0.55,
      bbox.centerZ - dist * 0.72,
    ),
    target: new THREE.Vector3(bbox.centerX, bbox.centerY + bbox.sizeY * 0.35, bbox.centerZ),
    near: 0.5,
    far:  Math.max(1000, dist * 5),
  };
}

function framePedestrian(bbox: SceneBBox, focalMm: number): CameraFraming {
  const EYE_HEIGHT = 1.65;
  const dist       = bbox.radius * 1.6 * focalFactor(focalMm);

  return {
    position: new THREE.Vector3(
      bbox.centerX,
      EYE_HEIGHT,
      bbox.centerZ - bbox.sizeZ / 2 - dist,
    ),
    target: new THREE.Vector3(bbox.centerX, bbox.centerY + bbox.sizeY * 0.4, bbox.centerZ),
    near: 0.3,
    far:  Math.max(500, dist * 4),
  };
}

function frameStreetFront(bbox: SceneBBox, focalMm: number): CameraFraming {
  const dist = bbox.radius * 1.4 * focalFactor(focalMm);
  const h    = Math.max(3, bbox.sizeY * 0.30);

  return {
    position: new THREE.Vector3(
      bbox.centerX,
      h,
      bbox.centerZ - bbox.sizeZ / 2 - dist,
    ),
    target: new THREE.Vector3(bbox.centerX, bbox.centerY + bbox.sizeY * 0.45, bbox.centerZ),
    near: 0.5,
    far:  Math.max(600, dist * 4),
  };
}

function frameParcelCorner(bbox: SceneBBox, focalMm: number): CameraFraming {
  const dist = bbox.radius * 1.8 * focalFactor(focalMm);
  const h    = Math.max(bbox.sizeY * 0.6, 5);

  return {
    position: new THREE.Vector3(
      bbox.centerX - bbox.sizeX / 2 - dist * 0.4,
      h,
      bbox.centerZ - bbox.sizeZ / 2 - dist * 0.4,
    ),
    target: new THREE.Vector3(bbox.centerX, bbox.centerY + bbox.sizeY * 0.4, bbox.centerZ),
    near: 0.5,
    far:  Math.max(800, dist * 5),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Calcule un CameraFraming depuis une ResolvedCamera et la bbox de la scène.
 *
 * @param camera — spec.render résolu (view + focalLengthMm)
 * @param bbox   — bbox calculée depuis Box3 des meshes de la scène
 */
export function computeCameraFraming(
  camera: ResolvedCamera,
  bbox:   SceneBBox,
): CameraFraming {
  const focal = camera.focalLengthMm ?? 50;

  switch (camera.view) {
    case "pedestrian":    return framePedestrian(bbox, focal);
    case "street_front":  return frameStreetFront(bbox, focal);
    case "parcel_corner": return frameParcelCorner(bbox, focal);
    case "aerial_3q":
    default:              return frameAerial3q(bbox, focal);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// APPLICATEUR TROIS.JS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Applique un CameraFraming sur la caméra + les controls OrbitControls.
 * Compatible avec l'OrbitControls de createSceneContext.
 */
export function applyCameraFraming(
  camera:   THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void } | null,
  framing:  CameraFraming,
): void {
  camera.position.copy(framing.position);
  camera.near = framing.near;
  camera.far  = framing.far;
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(framing.target);
    controls.update();
  } else {
    camera.lookAt(framing.target);
  }
}

/**
 * Fit caméra standard sur une Box3 — utilisé quand cameraView = "aerial_3q"
 * (même comportement que l'existant fitCameraToBox dans massingRendererScene).
 * Exporté pour que MassingRenderer puisse l'utiliser directement.
 */
export function fitCameraToBox3(
  camera:   THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void } | null,
  box:      THREE.Box3,
  offset    = 1.25,
): void {
  if (box.isEmpty()) return;

  const center = new THREE.Vector3();
  const size   = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fovRad = (camera.fov * Math.PI) / 180;
  const dist   = (maxDim / 2 / Math.tan(fovRad / 2)) * offset;

  const dir = camera.position.clone().sub(center).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);

  if (controls) {
    controls.target.copy(center);
    controls.update();
  } else {
    camera.lookAt(center);
  }

  camera.near = dist * 0.01;
  camera.far  = dist * 10;
  camera.updateProjectionMatrix();
}