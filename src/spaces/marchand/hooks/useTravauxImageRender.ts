// src/spaces/marchand/hooks/useTravauxImageRender.ts
//
// V4 — Hook principal du module Rendu Travaux.
// Ajout : solType, solColor, murColor, configSnapshot, payload config.

import { useState, useCallback, useRef } from "react";
import { buildTravauxImagePrompt } from "../../../utils/buildTravauxImagePrompt";
import {
  buildMaskBase64,
  inferZonesFromLots,
  type TravauxZone,
} from "../../../utils/buildTravauxZoning";
import type {
  TravauxImage,
  RenduResult,
  RenduTravauxState,
  TravauxRenduConfig,
  TravauxSolType,
  UseTravauxImageRenderReturn,
  RenduTravauxEdgePayload,
  RenduTravauxEdgeResponse,
} from "../types/rendutravaux.types";

const DALLE_TARGET_SIZE = 1024;
const DEMO_DELAY_MS = 3000;

const DEMO_FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&q=80";

type RenduTravauxEdgePayloadV4 = RenduTravauxEdgePayload & {
  mask_base64?: string;
};

type RenduResultV4 = RenduResult & {
  summary?: string;
  zones?: TravauxZone[];
};

function generateId(): string {
  return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatSizeKb(bytes: number): number {
  return Math.round(bytes / 1024);
}

async function fileToBase64DataUrl(
  file: File,
  targetSize = DALLE_TARGET_SIZE
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Erreur de lecture du fichier"));

    reader.onload = () => {
      const dataUrl = reader.result as string;

      if (!dataUrl?.includes("base64,")) {
        reject(new Error("Impossible de lire l'image"));
        return;
      }

      const img = new Image();

      img.onerror = () =>
        reject(new Error("Image corrompue ou format non supporté"));

      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = targetSize;
          canvas.height = targetSize;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context unavailable"));
            return;
          }

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, targetSize, targetSize);

          const ratio = Math.min(targetSize / img.width, targetSize / img.height);
          const drawW = Math.round(img.width * ratio);
          const drawH = Math.round(img.height * ratio);
          const offsetX = Math.round((targetSize - drawW) / 2);
          const offsetY = Math.round((targetSize - drawH) / 2);

          ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

          const pngDataUrl = canvas.toDataURL("image/png");

          console.log("[fileToBase64DataUrl] Converti en PNG 1024×1024", {
            originalType: file.type,
            originalSize: `${img.width}×${img.height}`,
            outputSizeKb: Math.round(pngDataUrl.length / 1024),
          });

          resolve(pngDataUrl);
        } catch (e) {
          reject(new Error(`Erreur canvas : ${e}`));
        }
      };

      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}

function extractBase64FromDataUrl(dataUrl: string): string {
  const parts = dataUrl.split(",");
  if (parts.length < 2) throw new Error("Format data URL invalide");
  return parts[1];
}

function validateImageFile(file: File): string | null {
  const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  if (!validTypes.includes(file.type)) {
    return `Format non supporté : ${file.type}. Utilisez JPEG, PNG ou WebP.`;
  }

  const maxSizeMb = 10;
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `Fichier trop lourd (${Math.round(
      file.size / 1024 / 1024
    )} Mo). Maximum : ${maxSizeMb} Mo.`;
  }

  return null;
}

const INITIAL_STATE: RenduTravauxState = {
  images: [],
  selectedImageId: null,
  results: [],
  status: "idle",
  error: null,
  progress: 0,
  styleDecoration: "contemporain",

  solType: null,
  solColor: null,
  murColor: null,
};

async function callRenduEdgeFunction(
  payload: RenduTravauxEdgePayloadV4
): Promise<RenduTravauxEdgeResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configuration Supabase manquante (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)"
    );
  }

  let accessToken = supabaseAnonKey;

  try {
    const { supabase } = await import("../../../lib/supabaseClient");
    const session = (await supabase.auth.getSession()).data.session;
    if (session?.access_token) accessToken = session.access_token;
  } catch {
    // fallback anon key
  }

  console.log("[RenduTravaux] PAYLOAD →", {
    hasImage: Boolean(payload.image_base64),
    imageSizeKb: payload.image_base64
      ? Math.round(payload.image_base64.length / 1024)
      : 0,
    hasMask: Boolean(payload.mask_base64),
    maskSizeKb: payload.mask_base64
      ? Math.round(payload.mask_base64.length / 1024)
      : 0,
    hasPrompt: Boolean(payload.prompt),
    promptLength: payload.prompt?.length ?? 0,
    promptPreview: payload.prompt?.slice(0, 100) + "…",
    style: payload.style,
    mime: payload.image_mime,
    config: payload.config,
  });

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/rendu-travaux-v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    const rawText = await resp.text();

    if (resp.status === 404 || resp.status === 0) {
      console.warn("[RenduTravaux] Edge Function non déployée → mode démo");
      return _demoFallback();
    }

    if (!resp.ok) {
      let errorMsg = `Erreur serveur (${resp.status})`;
      try {
        const errData = JSON.parse(rawText);
        errorMsg = errData?.error ?? errData?.message ?? errorMsg;
      } catch {
        // keep default
      }
      throw new Error(errorMsg);
    }

    try {
      const parsed = JSON.parse(rawText) as RenduTravauxEdgeResponse;

      console.log("[RenduTravaux] Edge Function OK →", {
        success: parsed.success,
        hasUrl: Boolean(parsed.image_url),
        hasBase64: Boolean(parsed.image_base64),
        durationMs: parsed.duration_ms,
      });

      return parsed;
    } catch {
      throw new Error("Réponse invalide du serveur (JSON mal formé)");
    }
  } catch (err) {
    if (
      err instanceof TypeError &&
      (err.message.includes("fetch") ||
        err.message.includes("Failed") ||
        err.message.includes("NetworkError"))
    ) {
      console.warn("[RenduTravaux] Edge Function inaccessible → mode démo");
      return _demoFallback();
    }

    throw err;
  }
}

async function _demoFallback(): Promise<RenduTravauxEdgeResponse> {
  console.info("[RenduTravaux] Mode DÉMO actif — image Unsplash simulée");

  await new Promise((r) => setTimeout(r, DEMO_DELAY_MS));

  return {
    success: true,
    image_url: DEMO_FALLBACK_IMAGE,
    duration_ms: DEMO_DELAY_MS,
  };
}

export function useTravauxImageRender(): UseTravauxImageRenderReturn {
  const [state, setState] = useState<RenduTravauxState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const addImages = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles: TravauxImage[] = [];
    const errors: string[] = [];

    for (const file of fileArray) {
      const err = validateImageFile(file);

      if (err) {
        errors.push(`${file.name} : ${err}`);
        continue;
      }

      const id = generateId();
      const preview = URL.createObjectURL(file);

      validFiles.push({
        id,
        file,
        preview,
        name: file.name,
        sizeKb: formatSizeKb(file.size),
        uploadedAt: new Date(),
      });
    }

    if (errors.length > 0) {
      console.warn("[RenduTravaux] Fichiers rejetés :", errors);
    }

    if (validFiles.length === 0) {
      setState((prev) => ({
        ...prev,
        error: errors.join("\n"),
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      images: [...prev.images, ...validFiles],
      selectedImageId: prev.selectedImageId ?? validFiles[0].id,
      error: errors.length > 0 ? errors.join("\n") : null,
    }));
  }, []);

  const removeImage = useCallback((id: string) => {
    setState((prev) => {
      const img = prev.images.find((i) => i.id === id);
      if (img?.preview) URL.revokeObjectURL(img.preview);

      const nextImages = prev.images.filter((i) => i.id !== id);

      const nextSelected =
        prev.selectedImageId === id
          ? nextImages[0]?.id ?? null
          : prev.selectedImageId;

      return {
        ...prev,
        images: nextImages,
        selectedImageId: nextSelected,
        results: prev.results.filter((r) => r.sourceImageId !== id),
      };
    });
  }, []);

  const selectImage = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedImageId: id }));
  }, []);

  const setStyleDecoration = useCallback((style: string) => {
    setState((prev) => ({ ...prev, styleDecoration: style }));
  }, []);

  const setSolType = useCallback((type: TravauxSolType | null) => {
    setState((prev) => ({ ...prev, solType: type }));
  }, []);

  const setSolColor = useCallback((color: string | null) => {
    setState((prev) => ({ ...prev, solColor: color }));
  }, []);

  const setMurColor = useCallback((color: string | null) => {
    setState((prev) => ({ ...prev, murColor: color }));
  }, []);

  const generateRendu = useCallback(
    async (imageId: string, config: TravauxRenduConfig): Promise<void> => {
      const image = state.images.find((i) => i.id === imageId);

      if (!image) {
        setState((prev) => ({
          ...prev,
          error: "Image introuvable. Veuillez la sélectionner à nouveau.",
        }));
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      const startMs = Date.now();

      setState((prev) => ({
        ...prev,
        status: "uploading",
        error: null,
        progress: 5,
      }));

      try {
        console.log("[RenduTravaux] Étape 1 — Conversion image base64");

        const imageDataUrl = await fileToBase64DataUrl(image.file);
        const imageBase64 = extractBase64FromDataUrl(imageDataUrl);

        console.log("[RenduTravaux] Image convertie", {
          mime: "image/png",
          base64Kb: Math.round(imageBase64.length / 1024),
        });

        setState((prev) => ({ ...prev, progress: 15 }));

        console.log("[RenduTravaux] Étape 2 — Préparation configuration");

        const finalConfig: TravauxRenduConfig = {
          ...config,
          styleDecoration: config.styleDecoration ?? state.styleDecoration,
          solType: config.solType ?? state.solType ?? undefined,
          solColor: config.solColor ?? state.solColor ?? undefined,
          murColor: config.murColor ?? state.murColor ?? undefined,
        };

        setState((prev) => ({ ...prev, progress: 25 }));

        console.log("[RenduTravaux] Étape 3 — Inférence zones");

        const lots: string[] = finalConfig.lots ?? [];
        const zones: TravauxZone[] = inferZonesFromLots(lots);

        const effectiveZones: TravauxZone[] = Array.from(
          new Set<TravauxZone>([
            ...zones,
            ...(finalConfig.solType || finalConfig.solColor ? ["floor"] : []),
            ...(finalConfig.murColor ? ["walls"] : []),
          ])
        );

        console.log("[RenduTravaux] Zones inférées :", {
          lots,
          zones,
          effectiveZones,
          solType: finalConfig.solType,
          solColor: finalConfig.solColor,
          murColor: finalConfig.murColor,
        });

        const promptObjFinal = buildTravauxImagePrompt({
          config: finalConfig,
          style: state.styleDecoration,
          zones: effectiveZones,
        });

        console.log("[RenduTravaux] Prompt final :", {
          summary: promptObjFinal.summary,
          tokenEstimate: promptObjFinal.debugTokenCount,
          promptLength: promptObjFinal.prompt.length,
        });

        setState((prev) => ({ ...prev, progress: 35 }));

        console.log("[RenduTravaux] Étape 4 — Génération mask");

        setState((prev) => ({
          ...prev,
          status: "generating",
          progress: 45,
        }));

        const maskDataUrl = await buildMaskBase64({
          width: DALLE_TARGET_SIZE,
          height: DALLE_TARGET_SIZE,
          zones: effectiveZones,
        });

        console.log("[RenduTravaux] Mask généré", {
          zones: effectiveZones,
          maskKb: Math.round(maskDataUrl.length / 1024),
          isDataUrl: maskDataUrl.startsWith("data:"),
        });

        setState((prev) => ({ ...prev, progress: 55 }));

        console.log("[RenduTravaux] Étape 5 — Appel Edge Function");

        const payload: RenduTravauxEdgePayloadV4 = {
          image_base64: imageDataUrl,
          image_mime: "image/png",
          mask_base64: maskDataUrl,
          prompt: promptObjFinal.prompt,
          style: state.styleDecoration,
          config: finalConfig,
        };

        setState((prev) => ({ ...prev, progress: 65 }));

        const response = await callRenduEdgeFunction(payload);

        setState((prev) => ({ ...prev, progress: 88 }));

        if (!response.success) {
          throw new Error(
            response.error ?? "La génération a échoué côté serveur."
          );
        }

        const generatedUrl =
          response.image_url ??
          (response.image_base64
            ? `data:image/png;base64,${response.image_base64}`
            : null);

        if (!generatedUrl) {
          throw new Error("Aucune image générée retournée par le serveur.");
        }

        const durationMs = Date.now() - startMs;

        const result: RenduResultV4 = {
          id: generateId(),
          sourceImageId: imageId,
          sourcePreview: image.preview,
          generatedImageUrl: generatedUrl,
          prompt: promptObjFinal.prompt,
          generatedAt: new Date(),
          durationMs,
          configSnapshot: finalConfig,
          summary: promptObjFinal.summary,
          zones: effectiveZones,
        };

        console.log("[RenduTravaux] ✅ Rendu terminé", {
          durationMs,
          summary: result.summary,
          hasUrl: Boolean(generatedUrl),
          configSnapshot: result.configSnapshot,
        });

        setState((prev) => ({
          ...prev,
          status: "done",
          progress: 100,
          results: [result, ...prev.results],
          error: null,
        }));

        setTimeout(() => {
          setState((prev) => ({ ...prev, progress: 0 }));
        }, 1500);
      } catch (err) {
        const errMsg =
          err instanceof Error
            ? err.message
            : "Une erreur inattendue est survenue.";

        console.error("[RenduTravaux] ❌ Erreur génération :", err);

        setState((prev) => ({
          ...prev,
          status: "error",
          error: errMsg,
          progress: 0,
        }));
      }
    },
    [
      state.images,
      state.styleDecoration,
      state.solType,
      state.solColor,
      state.murColor,
    ]
  );

  const clearResults = useCallback(() => {
    setState((prev) => ({
      ...prev,
      results: [],
      status: "idle",
      error: null,
      progress: 0,
    }));
  }, []);

  const latestResult =
    state.results.find((r) => r.sourceImageId === state.selectedImageId) ??
    state.results[0] ??
    null;

  return {
    state,
    addImages,
    removeImage,
    selectImage,

    setStyleDecoration,
    setSolType,
    setSolColor,
    setMurColor,

    generateRendu,
    clearResults,
    latestResult,
  };
}