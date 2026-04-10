// src/spaces/promoteur/terrain3d/blender/exportRenderSpecJson.ts

import type { SceneRenderSpec } from "./blenderExport.types";

// ─────────────────────────────────────────────────────────────
// OPTIONS
// ─────────────────────────────────────────────────────────────

export interface ExportRenderSpecJsonOptions {
  fileName?: string;       // default: "scene.render-spec.json"
  pretty?: boolean;        // default: true
  space?: number;          // default: 2
  autoDownload?: boolean;  // default: true
  log?: boolean;           // debug console
}

// ─────────────────────────────────────────────────────────────
// API PRINCIPALE
// ─────────────────────────────────────────────────────────────

export function exportRenderSpecJson(
  spec: SceneRenderSpec,
  options: ExportRenderSpecJsonOptions = {},
): string {
  const {
    fileName = "scene.render-spec.json",
    pretty = true,
    space = 2,
    autoDownload = true,
    log = false,
  } = options;

  const jsonString = JSON.stringify(spec, null, pretty ? space : 0);

  if (log) {
    console.log("[Mimmoza][Blender] RenderSpec JSON:", spec);
  }

  if (autoDownload && isBrowser()) {
    downloadJson(jsonString, fileName);
  }

  return jsonString;
}

// ─────────────────────────────────────────────────────────────
// DOWNLOAD
// ─────────────────────────────────────────────────────────────

function downloadJson(json: string, fileName: string) {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";

  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);

  // nettoyage mémoire
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}