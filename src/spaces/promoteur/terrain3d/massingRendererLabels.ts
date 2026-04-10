// massingRendererLabels.ts — HTML overlay labels for 3D buildings
// Creates floating labels, projects them to screen, manages hover/selection labels

import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LabelDef {
  /** Building ID */
  bldId: string;
  /** World position (center-top of building) */
  worldPos: THREE.Vector3;
  /** Display text */
  text: string;
  /** Is this the selected building? */
  isSelected: boolean;
}

// ─── Reusable vector for projection ───────────────────────────────────────────
const _v = new THREE.Vector3();

// ─── Create labels ────────────────────────────────────────────────────────────

/**
 * Clear existing labels and create new ones from definitions.
 */
export function rebuildLabels(
  container: HTMLDivElement,
  labels: LabelDef[],
): void {
  // Remove existing label elements
  clearLabels(container);

  for (const lbl of labels) {
    const el = document.createElement("div");
    el.dataset.bldId = lbl.bldId;
    el.dataset.wp = `${lbl.worldPos.x},${lbl.worldPos.y},${lbl.worldPos.z}`;
    el.style.cssText = [
      "position:absolute;top:0;left:0;opacity:0;transition:opacity .12s",
      "padding:3px 8px",
      `background:${lbl.isSelected ? "rgba(82,71,184,0.92)" : "rgba(255,255,255,0.88)"}`,
      `border:1px solid ${lbl.isSelected ? "rgba(82,71,184,0.5)" : "rgba(0,0,0,0.08)"}`,
      "border-radius:5px",
      `font-size:${lbl.isSelected ? "11px" : "10px"}`,
      "font-weight:600",
      `color:${lbl.isSelected ? "#fff" : "#374151"}`,
      "font-family:system-ui,sans-serif",
      "pointer-events:none",
      "white-space:nowrap",
      "backdrop-filter:blur(4px)",
      "box-shadow:0 1px 6px rgba(0,0,0,0.08)",
      `z-index:${lbl.isSelected ? 10 : 1}`,
    ].join(";");
    el.textContent = lbl.text;
    container.appendChild(el);
  }
}

/**
 * Add a hover label (temporary, shown on mouseover).
 */
export function addHoverLabel(
  container: HTMLDivElement,
  worldPos: THREE.Vector3,
  text: string,
  bldId: string,
): void {
  const el = document.createElement("div");
  el.dataset.bldId = bldId;
  el.dataset.wp = `${worldPos.x},${worldPos.y},${worldPos.z}`;
  el.dataset.hover = "1";
  el.style.cssText = [
    "position:absolute;top:0;left:0;opacity:0;transition:opacity .10s",
    "padding:3px 8px",
    "background:rgba(255,255,255,0.90)",
    "border:1px solid rgba(82,71,184,0.20)",
    "border-radius:5px",
    "font-size:10px;font-weight:600;color:#374151",
    "font-family:system-ui,sans-serif",
    "pointer-events:none;white-space:nowrap",
    "backdrop-filter:blur(4px)",
    "box-shadow:0 1px 6px rgba(0,0,0,0.08)",
  ].join(";");
  el.textContent = text;
  container.appendChild(el);
}

/**
 * Remove hover labels from container.
 */
export function removeHoverLabels(container: HTMLDivElement): void {
  const hovers = container.querySelectorAll("[data-hover]");
  hovers.forEach((el) => el.remove());
}

// ─── Update projection ───────────────────────────────────────────────────────

/**
 * Project all label world positions to screen and update CSS transforms.
 * Should be called each frame or on camera change.
 */
export function updateLabelPositions(
  container: HTMLDivElement,
  camera: THREE.PerspectiveCamera,
  rendererW: number,
  rendererH: number,
): void {
  const els = container.children;
  for (let i = 0; i < els.length; i++) {
    const el = els[i] as HTMLElement;
    const wp = el.dataset.wp;
    if (!wp) continue;

    const [wx, wy, wz] = wp.split(",").map(Number);
    _v.set(wx, wy, wz).project(camera);

    const sx = (_v.x * 0.5 + 0.5) * rendererW;
    const sy = (1 - (_v.y * 0.5 + 0.5)) * rendererH;

    // Visibility: behind camera or offscreen
    const visible = _v.z < 1 && sx > 10 && sx < rendererW - 10 && sy > 10 && sy < rendererH - 10;

    el.style.transform = `translate(-50%,-50%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
    el.style.opacity = visible ? "1" : "0";
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export function clearLabels(container: HTMLDivElement): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}