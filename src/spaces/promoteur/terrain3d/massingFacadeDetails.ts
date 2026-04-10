// massingFacadeDetails.ts — V1.0
// ═══════════════════════════════════════════════════════════════════════════════
// Module de détails architecturaux secondaires pour le Massing 3D
//
// Responsabilités :
//   - Balcon individuel + garde-corps
//   - Balcon continu + garde-corps
//   - Loggia complète (dalle, plafond, joues, vitrage fond, rambarde)
//   - Shading : brise-soleil, store banne, volets battants, volet roulant,
//               roller blind, panneau coulissant
//
// Ce module est appelé par massingFacadeEngine.ts — il ne touche jamais
// directement à FacadeConfig ni à la logique de structure de façade.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from "three";
import {
  pushBox,
  facadeRotation,
  facadeAngle,
  translateOnFacade,
  clamp,
  safeNumber,
  type FacadePt,
  type LocalFacadeAxes,
  type FacadeResult,
  type ShadingDeviceType,
} from "./massingFacadeEngine";

// ═══════════════════════════════════════════════════════════════════════════════
// BALCON INDIVIDUEL
// ═══════════════════════════════════════════════════════════════════════════════

export interface BalconyParams {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  wyBot: number;
  winW: number;
  depthS: number;
  thickS: number;
  railH: number;
}

export function addIndividualBalcony(r: FacadeResult, p: BalconyParams): void {
  const { cx, cz, ux, uz, nx, nz, wyBot, winW, depthS, thickS, railH } = p;
  const rotM = facadeRotation(ux, uz);

  // Dalle
  const slab = new THREE.BoxGeometry(winW, thickS, depthS);
  slab.applyMatrix4(rotM);
  slab.translate(
    cx + nx * (depthS / 2),
    wyBot - thickS / 2,
    cz + nz * (depthS / 2),
  );
  r.balconies.push(slab);

  // Lisse haute frontale
  const front = new THREE.BoxGeometry(winW, 0.042, 0.025);
  front.applyMatrix4(rotM);
  front.translate(cx + nx * depthS, wyBot + railH, cz + nz * depthS);
  r.railings.push(front);

  // Joues latérales
  for (const s of [-1, 1] as const) {
    const joue = new THREE.BoxGeometry(0.025, 0.042, depthS);
    joue.applyMatrix4(rotM);
    joue.translate(
      cx + nx * (depthS / 2) + ux * (winW / 2 + 0.012) * s,
      wyBot + railH,
      cz + nz * (depthS / 2) + uz * (winW / 2 + 0.012) * s,
    );
    r.railings.push(joue);
  }

  // Barreaux
  const nP = Math.max(2, Math.round(winW / 0.85));
  const postGeo = new THREE.BoxGeometry(0.026, railH, 0.026);

  for (let i = 0; i < nP; i++) {
    const t = (i + 0.5) / nP - 0.5;
    const pg = postGeo.clone();
    pg.applyMatrix4(rotM);
    pg.translate(
      cx + ux * winW * t + nx * depthS,
      wyBot + railH / 2,
      cz + uz * winW * t + nz * depthS,
    );
    r.railings.push(pg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BALCON CONTINU
// ═══════════════════════════════════════════════════════════════════════════════

export interface ContinuousBalconyParams {
  ptA: FacadePt;
  ptB: FacadePt;
  len: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  floorBaseY: number;
  depthS: number;
  thickS: number;
  railH: number;
}

export function addContinuousBalcony(r: FacadeResult, p: ContinuousBalconyParams): void {
  const { ptA, ptB, len, ux, uz, nx, nz, floorBaseY, depthS, thickS, railH } = p;
  const rotM = facadeRotation(ux, uz);

  const cx = (ptA.x + ptB.x) / 2 + nx * (depthS / 2);
  const cz = (ptA.z + ptB.z) / 2 + nz * (depthS / 2);

  // Dalle filante
  const slab = new THREE.BoxGeometry(len, thickS, depthS);
  slab.applyMatrix4(rotM);
  slab.translate(cx, floorBaseY - thickS / 2, cz);
  r.balconies.push(slab);

  // Lisse haute frontale
  const front = new THREE.BoxGeometry(len, 0.042, 0.025);
  front.applyMatrix4(rotM);
  front.translate(
    (ptA.x + ptB.x) / 2 + nx * depthS,
    floorBaseY + railH,
    (ptA.z + ptB.z) / 2 + nz * depthS,
  );
  r.railings.push(front);

  // Barreaux
  const nP = Math.max(2, Math.round(len / 1.2));
  const postGeo = new THREE.BoxGeometry(0.028, railH, 0.028);

  for (let i = 0; i < nP; i++) {
    const t = (i + 0.5) / nP;
    const pg = postGeo.clone();
    pg.applyMatrix4(rotM);
    pg.translate(
      ptA.x + ux * len * t + nx * depthS,
      floorBaseY + railH / 2,
      ptA.z + uz * len * t + nz * depthS,
    );
    r.railings.push(pg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGIA
// ═══════════════════════════════════════════════════════════════════════════════

export interface LoggiaParams {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  wyBot: number;
  wyTop: number;
  winW: number;
  loggiaDepth: number;
  frameT: number;
  outerFrameT: number;
  revealDepth: number;
}

export function addLoggiaGeo(r: FacadeResult, p: LoggiaParams): void {
  const {
    cx, cz, ux, uz, nx, nz,
    wyBot, wyTop, winW,
    loggiaDepth, frameT, outerFrameT, revealDepth,
  } = p;

  const loggiaH = wyTop - wyBot;
  const axes: LocalFacadeAxes = { ux, uz, nx, nz };
  const rotM = facadeRotation(ux, uz);

  // Encadrement extérieur — montants + linteau
  {
    const revealFaceOffset = -revealDepth / 2;

    for (const s of [-1, 1] as const) {
      const c = translateOnFacade(
        cx, cz, axes,
        s * (winW / 2 + outerFrameT / 2),
        revealFaceOffset,
      );
      pushBox(
        r.frames,
        outerFrameT,
        loggiaH + outerFrameT * 1.2,
        revealDepth,
        c.x,
        wyBot + loggiaH / 2,
        c.z,
        ux, uz,
      );
    }

    {
      const c = translateOnFacade(cx, cz, axes, 0, revealFaceOffset);
      pushBox(
        r.frames,
        winW + outerFrameT * 2,
        outerFrameT,
        revealDepth,
        c.x,
        wyTop + outerFrameT / 2,
        c.z,
        ux, uz,
      );
    }
  }

  // Dalle de plancher
  {
    const slab = new THREE.BoxGeometry(winW, 0.085, loggiaDepth);
    slab.applyMatrix4(rotM);
    slab.translate(
      cx - nx * (loggiaDepth / 2),
      wyBot + 0.0425,
      cz - nz * (loggiaDepth / 2),
    );
    r.balconies.push(slab);
  }

  // Plafond
  {
    const ceil = new THREE.BoxGeometry(winW, 0.08, loggiaDepth);
    ceil.applyMatrix4(rotM);
    ceil.translate(
      cx - nx * (loggiaDepth / 2),
      wyTop - 0.04,
      cz - nz * (loggiaDepth / 2),
    );
    r.loggias.push(ceil);
  }

  // Joues latérales
  for (const s of [-1, 1] as const) {
    const side = new THREE.BoxGeometry(frameT, loggiaH, loggiaDepth);
    side.applyMatrix4(rotM);
    side.translate(
      cx + ux * (winW / 2 + frameT / 2) * s - nx * (loggiaDepth / 2),
      wyBot + loggiaH / 2,
      cz + uz * (winW / 2 + frameT / 2) * s - nz * (loggiaDepth / 2),
    );
    r.loggias.push(side);
  }

  // Vitrage de fond
  {
    const bg = new THREE.BoxGeometry(
      Math.max(0.08, winW - frameT * 2),
      Math.max(0.08, loggiaH - frameT * 1.2),
      0.022,
    );
    bg.applyMatrix4(rotM);
    bg.translate(
      cx - nx * (loggiaDepth - 0.02),
      wyBot + loggiaH / 2,
      cz - nz * (loggiaDepth - 0.02),
    );
    r.glass.push(bg);
  }

  // Garde-corps frontal
  const railH = Math.min(loggiaH * 0.42, 1.0);

  {
    const frontRail = new THREE.BoxGeometry(winW, 0.042, 0.025);
    frontRail.applyMatrix4(rotM);
    frontRail.translate(cx, wyBot + railH, cz);
    r.railings.push(frontRail);
  }

  // Potelets de garde-corps
  const nP = Math.max(2, Math.round(winW / 0.9));
  const postGeo = new THREE.BoxGeometry(0.028, railH, 0.028);

  for (let i = 0; i < nP; i++) {
    const t = (i + 0.5) / nP - 0.5;
    const pg = postGeo.clone();
    pg.applyMatrix4(rotM);
    pg.translate(
      cx + ux * winW * t,
      wyBot + railH / 2,
      cz + uz * winW * t,
    );
    r.railings.push(pg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHADING — dispatch principal
// ═══════════════════════════════════════════════════════════════════════════════

export interface ShadingParams {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  wyBot: number;
  wyTop: number;
  winW: number;
  fhM: number;
  type: ShadingDeviceType;
  openRatio: number;
  color?: number;
}

export function addShading(r: FacadeResult, p: ShadingParams): void {
  const { cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, fhM, type, openRatio } = p;

  switch (type) {
    case "brise_soleil": {
      const projD = fhM * 0.16;
      const thick = fhM * 0.018;
      const rotM = facadeRotation(ux, uz);
      const geo = new THREE.BoxGeometry(winW + 0.08, thick, projD);
      geo.applyMatrix4(rotM);
      geo.translate(
        cx - nx * (projD / 2),
        wyTop + thick / 2,
        cz - nz * (projD / 2),
      );
      r.shading.push(geo);
      break;
    }

    case "awning":
      addAwning(r, { cx, cz, ux, uz, nx, nz, wyTop, winW, fhM, openRatio });
      break;

    case "swing_shutters":
      addSwingShutters(r, {
        cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, openRatio,
      });
      break;

    case "roller_shutter":
      addRollerShutter(r, {
        cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, fhM, openRatio,
      });
      break;

    case "roller_blind": {
      const closedH = fhM * (1 - openRatio) * 0.55;
      if (closedH > 0.05) {
        const rotM = facadeRotation(ux, uz);
        const geo = new THREE.BoxGeometry(winW, closedH, 0.025);
        geo.applyMatrix4(rotM);
        geo.translate(cx - nx * 0.012, wyTop - closedH / 2, cz - nz * 0.012);
        r.shading.push(geo);
      }
      break;
    }

    case "sliding_panel": {
      const pW = winW * 0.56;
      const pH = fhM * 0.72;
      const slide = (openRatio - 0.5) * winW * 0.6;
      const rotM = facadeRotation(ux, uz);
      const geo = new THREE.BoxGeometry(pW, pH, 0.03);
      geo.applyMatrix4(rotM);
      geo.translate(
        cx + ux * slide - nx * 0.03,
        wyTop - pH / 2,
        cz + uz * slide - nz * 0.03,
      );
      r.shading.push(geo);
      break;
    }

    default:
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE BANNE
// ═══════════════════════════════════════════════════════════════════════════════

interface AwningP {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  wyTop: number;
  winW: number;
  fhM: number;
  openRatio: number;
}

function addAwning(r: FacadeResult, p: AwningP): void {
  const { cx, cz, ux, uz, nx, nz, wyTop, winW, fhM, openRatio } = p;
  const rotM = facadeRotation(ux, uz);

  const boxW = winW + 0.12;
  const boxH = fhM * 0.055;
  const boxD = fhM * 0.065;

  // Coffre
  const coffre = new THREE.BoxGeometry(boxW, boxH, boxD);
  coffre.applyMatrix4(rotM);
  coffre.translate(
    cx - nx * (boxD / 2),
    wyTop + boxH / 2,
    cz - nz * (boxD / 2),
  );
  r.shading.push(coffre);

  const projection = fhM * 0.75 * openRatio;
  if (projection < 0.08) return;

  const tiltAxis = new THREE.Vector3(ux, 0, uz).normalize();
  const tiltRot = new THREE.Matrix4().makeRotationAxis(tiltAxis, -Math.PI / 8.2);

  // Toile
  const cloth = new THREE.BoxGeometry(winW + 0.04, 0.012, projection);
  cloth.applyMatrix4(rotM);
  cloth.applyMatrix4(tiltRot);
  cloth.translate(
    cx - nx * (projection / 2 + boxD),
    wyTop - projection * 0.19,
    cz - nz * (projection / 2 + boxD),
  );
  r.shading.push(cloth);

  // Bras articulés
  const armLen = Math.hypot(projection, projection * 0.3);

  for (const s of [-1, 1] as const) {
    const arm = new THREE.BoxGeometry(0.022, 0.022, armLen);
    arm.applyMatrix4(rotM);
    arm.applyMatrix4(tiltRot);
    arm.translate(
      cx + ux * (winW / 2 - 0.06) * s - nx * (projection / 2 + boxD),
      wyTop - projection * 0.19,
      cz + uz * (winW / 2 - 0.06) * s - nz * (projection / 2 + boxD),
    );
    r.shading.push(arm);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLETS BATTANTS
// ═══════════════════════════════════════════════════════════════════════════════

interface SwingShutterP {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  wyBot: number;
  wyTop: number;
  winW: number;
  openRatio: number;
}

function addSwingShutters(r: FacadeResult, p: SwingShutterP): void {
  const { cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, openRatio } = p;
  const shutH = wyTop - wyBot;
  const shutW = winW / 2 - 0.018;
  const midY = wyBot + shutH / 2;
  const thick = 0.03;

  const angleFac = facadeAngle(ux, uz);
  const swingAngle = clamp(openRatio, 0, 1) * (Math.PI / 2);

  for (const s of [-1, 1] as const) {
    const pivotX = cx + ux * (winW / 2) * s;
    const pivotZ = cz + uz * (winW / 2) * s;

    const panelCenterX =
      pivotX + (ux * s * Math.cos(swingAngle) - nx * Math.sin(swingAngle)) * (shutW / 2);
    const panelCenterZ =
      pivotZ + (uz * s * Math.cos(swingAngle) - nz * Math.sin(swingAngle)) * (shutW / 2);

    const panelAngle = angleFac + s * swingAngle;
    const rotM = new THREE.Matrix4().makeRotationY(panelAngle);

    // Panneau
    const shutter = new THREE.BoxGeometry(shutW, shutH, thick);
    shutter.applyMatrix4(rotM);
    shutter.translate(panelCenterX, midY, panelCenterZ);
    r.shading.push(shutter);

    // Lames persiennes
    const nLames = Math.max(3, Math.round(shutH / 0.14));
    for (let l = 0; l < nLames; l++) {
      const ly = wyBot + (l + 0.5) * (shutH / nLames);
      const lame = new THREE.BoxGeometry(shutW - 0.012, 0.008, thick * 0.4);
      lame.applyMatrix4(rotM);
      lame.translate(panelCenterX, ly, panelCenterZ);
      r.shading.push(lame);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLET ROULANT
// ═══════════════════════════════════════════════════════════════════════════════

interface RollerShutterP {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  wyBot: number;
  wyTop: number;
  winW: number;
  fhM: number;
  openRatio: number;
}

function addRollerShutter(r: FacadeResult, p: RollerShutterP): void {
  const { cx, cz, ux, uz, nx, nz, wyBot, wyTop, winW, fhM, openRatio } = p;
  const winH = wyTop - wyBot;
  const rotM = facadeRotation(ux, uz);

  // Coffre
  const coffH = fhM * 0.058;
  const coffD = fhM * 0.058;
  const coffre = new THREE.BoxGeometry(winW + 0.08, coffH, coffD);
  coffre.applyMatrix4(rotM);
  coffre.translate(
    cx - nx * (coffD / 2),
    wyTop + coffH / 2,
    cz - nz * (coffD / 2),
  );
  r.shading.push(coffre);

  // Tablier déroulé
  const descH = winH * (1 - clamp(openRatio, 0, 1));
  if (descH > 0.04) {
    const tablier = new THREE.BoxGeometry(winW, descH, 0.024);
    tablier.applyMatrix4(rotM);
    tablier.translate(
      cx - nx * 0.016,
      wyTop - descH / 2,
      cz - nz * 0.016,
    );
    r.shading.push(tablier);

    // Lames
    const nLames = Math.max(2, Math.round(descH / 0.08));
    for (let l = 0; l < nLames; l++) {
      const ly = wyTop - (l + 0.5) * (descH / nLames);
      const lame = new THREE.BoxGeometry(winW - 0.02, 0.006, 0.028);
      lame.applyMatrix4(rotM);
      lame.translate(cx - nx * 0.006, ly, cz - nz * 0.006);
      r.shading.push(lame);
    }
  }
}