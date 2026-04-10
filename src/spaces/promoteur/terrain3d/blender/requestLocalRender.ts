// src/spaces/promoteur/terrain3d/blender/requestLocalRender.ts

import { LOCAL_BLENDER_RENDER_ENDPOINT } from "./localRender.config";
import type { LocalBlenderRenderResponse } from "./localRender.types";

// Dérive la base URL depuis l'endpoint de rendu
// ex: "http://localhost:3333/render" → "http://localhost:3333"
function getBaseUrl(): string {
  try {
    const url = new URL(LOCAL_BLENDER_RENDER_ENDPOINT);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://localhost:3333";
  }
}

async function fetchJobLogs(jobId: string): Promise<string[]> {
  try {
    const base = getBaseUrl();
    const res = await fetch(`${base}/jobs/${jobId}/log`, {
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return [];

    const text = await res.text();
    return text.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

export async function requestLocalRender(input: {
  gltfBlob: Blob;
  renderSpecBlob: Blob;
}): Promise<LocalBlenderRenderResponse> {
  const formData = new FormData();
  formData.append("scene", input.gltfBlob, "scene.gltf");
  formData.append("spec", input.renderSpecBlob, "scene.renderSpec.json");

  const response = await fetch(LOCAL_BLENDER_RENDER_ENDPOINT, {
    method: "POST",
    body: formData,
  });

  const json = (await response.json()) as LocalBlenderRenderResponse;

  // Charger les logs du job dans tous les cas (succès ou erreur)
  const logs = json.jobId ? await fetchJobLogs(json.jobId) : [];

  if (!response.ok || !json.ok) {
    const err = new Error(json.error ?? `Local render failed (HTTP ${response.status})`);
    (err as any).logs = logs;
    throw err;
  }

  return { ...json, logs };
}