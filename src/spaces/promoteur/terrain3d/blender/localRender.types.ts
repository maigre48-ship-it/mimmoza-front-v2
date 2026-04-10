// src/spaces/promoteur/terrain3d/blender/localRender.types.ts

export type LocalBlenderRenderStatus =
  | "idle"
  | "exporting"
  | "uploading"
  | "rendering"
  | "done"
  | "error";

export type LocalBlenderRenderResponse = {
  ok: boolean;
  jobId: string;
  imageUrl?: string;
  logPath?: string;
  logs?: string[];       // contenu du blender.log, chargé après le rendu
  error?: string;
  durationMs?: number;
};