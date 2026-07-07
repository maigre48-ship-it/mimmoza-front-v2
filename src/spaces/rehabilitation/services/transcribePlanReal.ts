// -----------------------------------------------------------------------------
// transcribePlanReal.ts  v1
// Service front — Envoi du plan à la Edge Function `transcribe-rehab-plan`
// (vectorisation prudente : enveloppe, murs, pièces, ouvertures, zones humides).
// Renvoie la sortie brute typée, à passer dans transcriptionToGeometry().
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabaseClient";
import type { PlanUpload } from "../shared/planAnalysis.types";
import type { TranscriptionResult } from "../plan-reader/transcriptionToGeometry";

interface TranscribePlanRealInput {
  plan: PlanUpload | null;
}

interface TranscribePlanRealError {
  code: string;
  message: string;
  status?: number;
  debug?: unknown;
}

const FUNCTION_NAME = "transcribe-rehab-plan";
const TIMEOUT_MS = 120_000;

// La transcription accepte png/jpeg/webp (pas le PDF, comme la fonction).
const ACCEPTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export async function transcribePlanReal(
  input: TranscribePlanRealInput
): Promise<TranscriptionResult> {
  const { plan } = input;

  if (!plan?.file) {
    throw makeError("NO_FILE", "Aucun plan fourni pour la transcription.");
  }

  const file = plan.file;

  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw makeError(
      "UNSUPPORTED_FORMAT",
      `Transcription : format non supporté (${file.type || "inconnu"}). Utilisez PNG, JPG ou WEBP.`
    );
  }
  if (file.size <= 0) {
    throw makeError("EMPTY_FILE", "Le fichier est vide.");
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !supabaseKey) {
    throw makeError(
      "SUPABASE_ENV_MISSING",
      "Variables Supabase manquantes : VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY."
    );
  }

  const functionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${FUNCTION_NAME}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? supabaseKey;

  const formData = new FormData();
  formData.append("file", file, file.name || "plan");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        // Pas de Content-Type : le browser gère le boundary multipart.
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    window.clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw makeError("TIMEOUT", "La transcription a dépassé le délai imparti.");
    }
    throw makeError(
      "NETWORK_ERROR",
      "Impossible de joindre le service de transcription.",
      undefined,
      err
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw makeError(
        "PARSE_ERROR",
        `Réponse transcription illisible. HTTP ${response.status}.`,
        response.status,
        text.slice(0, 800)
      );
    }
  }

  if (!response.ok || (body && (body as { success?: boolean }).success === false)) {
    const errObj = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw makeError(
      errObj?.code ?? `HTTP_${response.status}`,
      errObj?.message ?? `Erreur transcription (${response.status}).`,
      response.status,
      body
    );
  }

  const rawData =
    body && typeof body === "object" && "data" in body
      ? (body.data as unknown)
      : body;

  if (!rawData || typeof rawData !== "object") {
    throw makeError(
      "INVALID_RESPONSE",
      "La transcription a répondu, mais le format est invalide.",
      response.status,
      body
    );
  }

  return rawData as TranscriptionResult;
}

function makeError(
  code: string,
  message: string,
  status?: number,
  debug?: unknown
): TranscribePlanRealError & Error {
  const err = new Error(message) as TranscribePlanRealError & Error;
  err.code = code;
  err.message = message;
  err.status = status;
  err.debug = debug;
  if (import.meta.env.DEV && debug !== undefined) {
    console.warn("[transcribePlanReal]", code, message, debug);
  }
  return err;
}