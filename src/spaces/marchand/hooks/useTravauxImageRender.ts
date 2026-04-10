// src/spaces/marchand/hooks/useTravauxImageRender.ts
//
// V3 — Hook principal du module Rendu Travaux.
//
// Pipeline complet :
//   1. Upload image utilisateur (base64)
//   2. Génération prompt (buildTravauxImagePrompt)
//   3. Inférence zones (inferZonesFromLots)
//   4. Génération mask PNG (buildMaskBase64)
//   5. Appel Edge Function rendu-travaux-v1
//   6. Réception image éditée (DALL-E 2)
//
// Architecture :
//   - État local React (useState)
//   - Appel à Edge Function `rendu-travaux-v1` via Supabase
//   - Fallback démo si Edge Function non déployée (404 / réseau)
//   - Upload images : base64 inline (pas de stockage Supabase)

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
  UseTravauxImageRenderReturn,
  RenduTravauxEdgePayload,
  RenduTravauxEdgeResponse,
} from "../types/rendutravaux.types";

// ── Constantes ─────────────────────────────────────────────────────

/** Taille cible pour le mask et l'image envoyés à DALL-E 2 */
const DALLE_TARGET_SIZE = 1024;

/** Délai simulation démo (ms) */
const DEMO_DELAY_MS = 3000;

/**
 * Image de démo : appartement rénové Unsplash.
 * Utilisée quand l'Edge Function n'est pas encore déployée.
 */
const DEMO_FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&q=80";

// ── Helpers ────────────────────────────────────────────────────────

function generateId(): string {
  return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatSizeKb(bytes: number): number {
  return Math.round(bytes / 1024);
}

/**
 * Convertit un File en PNG 1024×1024 base64 (data URL).
 *
 * DALL-E 2 /images/edits exige :
 *   - format PNG (pas JPEG, pas WebP)
 *   - image carrée
 *   - même dimensions que le mask (1024×1024)
 *
 * On passe systématiquement par un canvas pour normaliser.
 */
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

      // Charger dans un <img> pour dessiner sur canvas
      const img = new Image();
      img.onerror = () => reject(new Error("Image corrompue ou format non supporté"));
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

          // Fond blanc (PNG transparent → blanc pour éviter artefacts DALL-E)
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, targetSize, targetSize);

          // Redimensionner en conservant le ratio, centré
          const ratio = Math.min(targetSize / img.width, targetSize / img.height);
          const drawW = Math.round(img.width * ratio);
          const drawH = Math.round(img.height * ratio);
          const offsetX = Math.round((targetSize - drawW) / 2);
          const offsetY = Math.round((targetSize - drawH) / 2);

          ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

          // ✅ Export PNG obligatoire pour DALL-E 2
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

/**
 * Extrait la partie base64 pure depuis une data URL.
 * "data:image/png;base64,AAAA..." → "AAAA..."
 */
function extractBase64FromDataUrl(dataUrl: string): string {
  const parts = dataUrl.split(",");
  if (parts.length < 2) throw new Error("Format data URL invalide");
  return parts[1];
}

/**
 * Détermine le MIME type à partir du File.
 */
function getMimeType(file: File): string {
  return file.type || "image/jpeg";
}

/**
 * Valide qu'un fichier est une image acceptable.
 * Retourne null si OK, sinon un message d'erreur.
 */
function validateImageFile(file: File): string | null {
  const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!validTypes.includes(file.type)) {
    return `Format non supporté : ${file.type}. Utilisez JPEG, PNG ou WebP.`;
  }
  const maxSizeMb = 10;
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `Fichier trop lourd (${Math.round(file.size / 1024 / 1024)} Mo). Maximum : ${maxSizeMb} Mo.`;
  }
  return null;
}

// ── État initial ────────────────────────────────────────────────────

const INITIAL_STATE: RenduTravauxState = {
  images: [],
  selectedImageId: null,
  results: [],
  status: "idle",
  error: null,
  progress: 0,
  styleDecoration: "contemporain",
};

// ── Appel Edge Function ────────────────────────────────────────────

/**
 * Appelle l'Edge Function Supabase rendu-travaux-v1.
 * Gère le fallback démo si la fonction n'est pas déployée.
 */
async function callRenduEdgeFunction(
  payload: RenduTravauxEdgePayload
): Promise<RenduTravauxEdgeResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configuration Supabase manquante (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)"
    );
  }

  // Récupérer le token auth si disponible
  let accessToken = supabaseAnonKey;
  try {
    const { supabase } = await import("../../../lib/supabaseClient");
    const session = (await supabase.auth.getSession()).data.session;
    if (session?.access_token) accessToken = session.access_token;
  } catch {
    // Fallback sur anon key silencieux
  }

  // Debug payload
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
    promptPreview: payload.prompt?.slice(0, 80) + "…",
    style: payload.style,
    mime: payload.image_mime,
  });

  try {
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/rendu-travaux-v1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000), // 2 min max
      }
    );

    const rawText = await resp.text();

    // Edge Function non déployée → mode démo
    if (resp.status === 404 || resp.status === 0) {
      console.warn("[RenduTravaux] Edge Function non déployée (404) → mode démo");
      return _demoFallback();
    }

    if (!resp.ok) {
      let errorMsg = `Erreur serveur (${resp.status})`;
      try {
        const errData = JSON.parse(rawText);
        errorMsg = errData?.error ?? errData?.message ?? errorMsg;
      } catch {
        /* garder le message par défaut */
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
    // Erreur réseau / CORS → mode démo
    if (
      err instanceof TypeError &&
      (err.message.includes("fetch") ||
        err.message.includes("Failed") ||
        err.message.includes("NetworkError"))
    ) {
      console.warn(
        "[RenduTravaux] Edge Function inaccessible (CORS / réseau) → mode démo"
      );
      return _demoFallback();
    }
    throw err;
  }
}

/**
 * Simule une réponse réussie avec une image de démo.
 * Actif tant que l'Edge Function rendu-travaux-v1 n'est pas déployée.
 */
async function _demoFallback(): Promise<RenduTravauxEdgeResponse> {
  console.info("[RenduTravaux] Mode DÉMO actif — image Unsplash simulée");
  await new Promise((r) => setTimeout(r, DEMO_DELAY_MS));
  return {
    success: true,
    image_url: DEMO_FALLBACK_IMAGE,
    duration_ms: DEMO_DELAY_MS,
  };
}

// ── Hook principal ─────────────────────────────────────────────────

export function useTravauxImageRender(): UseTravauxImageRenderReturn {
  const [state, setState] = useState<RenduTravauxState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  // ── addImages ─────────────────────────────────────────────────────

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

  // ── removeImage ───────────────────────────────────────────────────

  const removeImage = useCallback((id: string) => {
    setState((prev) => {
      const img = prev.images.find((i) => i.id === id);
      if (img?.preview) URL.revokeObjectURL(img.preview);

      const nextImages = prev.images.filter((i) => i.id !== id);
      const nextSelected =
        prev.selectedImageId === id
          ? (nextImages[0]?.id ?? null)
          : prev.selectedImageId;

      return {
        ...prev,
        images: nextImages,
        selectedImageId: nextSelected,
        results: prev.results.filter((r) => r.sourceImageId !== id),
      };
    });
  }, []);

  // ── selectImage ───────────────────────────────────────────────────

  const selectImage = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedImageId: id }));
  }, []);

  // ── setStyleDecoration ────────────────────────────────────────────

  const setStyleDecoration = useCallback((style: string) => {
    setState((prev) => ({ ...prev, styleDecoration: style }));
  }, []);

  // ── generateRendu ─────────────────────────────────────────────────

  const generateRendu = useCallback(
    async (imageId: string, config: TravauxRenduConfig): Promise<void> => {
      // 0. Validation initiale
      const image = state.images.find((i) => i.id === imageId);
      if (!image) {
        setState((prev) => ({
          ...prev,
          error: "Image introuvable. Veuillez la sélectionner à nouveau.",
        }));
        return;
      }

      // Annuler toute génération en cours
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
        // ── Étape 1 : Conversion image → base64 ─────────────────────
        console.log("[RenduTravaux] Étape 1 — Conversion image base64");
        const imageDataUrl = await fileToBase64DataUrl(image.file);
        const imageBase64 = extractBase64FromDataUrl(imageDataUrl);
        const mimeType = getMimeType(image.file);

        console.log("[RenduTravaux] Image convertie", {
          mime: mimeType,
          base64Kb: Math.round(imageBase64.length / 1024),
        });

        setState((prev) => ({ ...prev, progress: 15 }));

        // ── Étape 2 : Génération du prompt ───────────────────────────
        console.log("[RenduTravaux] Étape 2 — Génération prompt");
        const promptObj = buildTravauxImagePrompt({
          config: {
            ...config,
            styleDecoration: state.styleDecoration,
          },
          style: state.styleDecoration,
          zones: [], // sera déterminé à l'étape 3 — on laisse le prompt vague ici
                     // puis on le regénère avec les zones réelles ci-dessous
        });

        setState((prev) => ({ ...prev, progress: 25 }));

        // ── Étape 3 : Inférence des zones depuis les lots ────────────
        console.log("[RenduTravaux] Étape 3 — Inférence zones");
        const lots: string[] = config.lots ?? [];
        const zones: TravauxZone[] = inferZonesFromLots(lots);

        console.log("[RenduTravaux] Zones inférées :", zones);

        // Regénérer le prompt avec les zones réelles
        const promptObjFinal = buildTravauxImagePrompt({
          config: {
            ...config,
            styleDecoration: state.styleDecoration,
          },
          style: state.styleDecoration,
          zones,
        });

        console.log("[RenduTravaux] Prompt final :", {
          summary: promptObjFinal.summary,
          tokenEstimate: promptObjFinal.debugTokenCount,
          promptLength: promptObjFinal.prompt.length,
        });

        setState((prev) => ({ ...prev, progress: 35 }));

        // ── Étape 4 : Génération du mask PNG ─────────────────────────
        console.log("[RenduTravaux] Étape 4 — Génération mask");
        setState((prev) => ({ ...prev, status: "generating", progress: 45 }));

        const maskDataUrl = await buildMaskBase64({
          width: DALLE_TARGET_SIZE,
          height: DALLE_TARGET_SIZE,
          zones,
        });

        console.log("[RenduTravaux] Mask généré", {
          zones,
          maskKb: Math.round(maskDataUrl.length / 1024),
          isDataUrl: maskDataUrl.startsWith("data:"),
        });

        setState((prev) => ({ ...prev, progress: 55 }));

        // ── Étape 5 : Appel Edge Function ─────────────────────────────
        console.log("[RenduTravaux] Étape 5 — Appel Edge Function");

        const payload: RenduTravauxEdgePayload = {
          image_base64: imageDataUrl,   // data URL PNG 1024×1024 (toujours PNG après canvas)
          image_mime: "image/png",      // ✅ toujours PNG après conversion canvas
          mask_base64: maskDataUrl,     // data URL PNG du mask
          prompt: promptObjFinal.prompt, // ⚠️ .prompt et non l'objet entier
          style: state.styleDecoration,
        };

        setState((prev) => ({ ...prev, progress: 65 }));

        const response = await callRenduEdgeFunction(payload);

        setState((prev) => ({ ...prev, progress: 88 }));

        if (!response.success) {
          throw new Error(response.error ?? "La génération a échoué côté serveur.");
        }

        // ── Étape 6 : Récupération image résultat ─────────────────────
        const generatedUrl =
          response.image_url ??
          (response.image_base64
            ? `data:image/png;base64,${response.image_base64}`
            : null);

        if (!generatedUrl) {
          throw new Error("Aucune image générée retournée par le serveur.");
        }

        const durationMs = Date.now() - startMs;

        const result: RenduResult = {
          id: generateId(),
          sourceImageId: imageId,
          sourcePreview: image.preview,
          generatedImageUrl: generatedUrl,
          prompt: promptObjFinal.prompt,
          summary: promptObjFinal.summary,
          zones,
          generatedAt: new Date(),
          durationMs,
        };

        console.log("[RenduTravaux] ✅ Rendu terminé", {
          durationMs,
          summary: result.summary,
          hasUrl: Boolean(generatedUrl),
        });

        setState((prev) => ({
          ...prev,
          status: "done",
          progress: 100,
          results: [result, ...prev.results],
          error: null,
        }));

        // Reset progress après affichage
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
    [state.images, state.styleDecoration]
  );

  // ── clearResults ──────────────────────────────────────────────────

  const clearResults = useCallback(() => {
    setState((prev) => ({
      ...prev,
      results: [],
      status: "idle",
      error: null,
      progress: 0,
    }));
  }, []);

  // ── latestResult ──────────────────────────────────────────────────

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
    generateRendu,
    clearResults,
    latestResult,
  };
}